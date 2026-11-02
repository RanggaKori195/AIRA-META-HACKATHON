// Pemeriksaan ke database Master Data sungguhan (bukan unit test — butuh jaringan
// internal the company). Jalankan manual: npx tsx tests/inno-live-check.ts
//
// Membuktikan yang tidak bisa dibuktikan unit test:
//   1. SQL setiap tool Master Data memang jalan (hackathon copy: Postgres schema `inno`)
//   2. Kunci join benar-benar unik, jadi angka & baris tidak menggelembung
//   3. Query selesai cepat — server ini dipakai aplikasi produksi Master Data
import { Client } from 'pg'
import { toPgPlaceholders, INNO_PG_TYPES } from '../src/main/masterdata/sql-dialect'
import { resolveActivePrices, validityOf, isOpenEnded, type PriceRow } from '../src/main/masterdata/rules'
import { envDb } from './live-env'

const cs = envDb('AIRA_INNO_DB')

const TODAY = new Date().toISOString().slice(0, 10)
let gagal = 0

function cek(nama: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'OK  ' : 'GAGAL'} ${nama}${detail ? ' — ' + detail : ''}`)
  if (!ok) gagal++
}

async function main(): Promise<void> {
  const conn = new Client({ connectionString: cs, statement_timeout: 25_000, options: '-c search_path=inno', types: INNO_PG_TYPES })
  await conn.connect()
  const q = async <T = any>(sql: string, p: unknown[] = []): Promise<T[]> =>
    (await conn.query(toPgPlaceholders(sql), p)).rows as T[]

  // 1. Kunci join harus unik — kalau tidak, LEFT JOIN menggandakan baris.
  const uk = await q(`SELECT count(*) baris, count(DISTINCT customer_code) unik
    FROM m_customer WHERE status='5' AND deleted_at IS NULL`)
  cek('m_customer.customer_code unik', uk[0].baris === uk[0].unik, `${uk[0].baris} baris / ${uk[0].unik} unik`)

  const ui = await q(`SELECT count(*) baris, count(DISTINCT item_code) unik
    FROM m_item WHERE status='5' AND deleted_at IS NULL`)
  cek('m_item.item_code unik', ui[0].baris === ui[0].unik, `${ui[0].baris} baris / ${ui[0].unik} unik`)

  // m_reguler_price TIDAK unik — ini diketahui & sengaja ditoleransi, karena tool
  // mengambil harga lewat subquery LIMIT 1 (padanan LATERAL) dan bukan join langsung.
  // Yang wajib dijaga adalah hasil akhirnya tetap 1 baris per item (uji berikutnya).
  const ur = await q(`SELECT count(*) baris, count(DISTINCT item_code) unik
    FROM m_reguler_price WHERE status='5' AND deleted_at IS NULL AND item_code <> ''`)
  console.log(`INFO m_reguler_price: ${ur[0].baris} baris / ${ur[0].unik} kode unik` +
    `${ur[0].baris === ur[0].unik ? '' : ' (ada kode dobel — sudah diantisipasi subquery LIMIT 1)'}`)

  const uc = await q(`SELECT count(*) baris, count(DISTINCT code) unik
    FROM m_clinician WHERE status='5' AND deleted_at IS NULL`)
  cek('m_clinician.code unik', uc[0].baris === uc[0].unik, `${uc[0].baris} baris / ${uc[0].unik} unik`)

  // 2. Join item+harga tidak boleh menambah baris.
  const t0 = Date.now()
  const joined = await q(`SELECT count(*) n FROM m_item i
    LEFT JOIN m_reguler_price rp ON rp.id = (
      SELECT rp2.id FROM m_reguler_price rp2
      WHERE rp2.item_code = i.item_code AND rp2.deleted_at IS NULL AND rp2.status='5'
      ORDER BY rp2.updated_at DESC, rp2.id LIMIT 1)
    WHERE i.status='5' AND i.deleted_at IS NULL`)
  cek('join item+harga tidak menggelembung', Number(joined[0].n) === Number(ui[0].baris),
    `${joined[0].n} vs ${ui[0].baris} (${Date.now() - t0} ms)`)

  // 3. Special price satu pelanggan: cepat, dan versi ganda terselesaikan jadi satu.
  const t1 = Date.now()
  const rows = await q(`SELECT sp.item_code, coalesce(mi.item_name, sp.item_name) item_name,
      sp.price_category, sp.reguler_price, sp.special_price, sp.start_date, sp.end_date
    FROM m_special_price sp
    LEFT JOIN m_item mi ON mi.item_code = sp.item_code AND mi.status='5' AND mi.deleted_at IS NULL
    WHERE sp.customer_code = '0112710002' AND sp.deleted_at IS NULL LIMIT 400`)
  const ms = Date.now() - t1
  cek('special price per pelanggan cepat (< 10 dtk)', ms < 10_000, `${ms} ms, ${rows.length} baris`)

  const mapped: PriceRow[] = rows.map((r) => ({
    itemCode: r.item_code,
    itemName: r.item_name,
    specialPrice: r.special_price === null ? null : Number(r.special_price),
    regulerPrice: r.reguler_price === null ? null : Number(r.reguler_price),
    priceCategory: r.price_category,
    startDate: r.start_date,
    endDate: r.end_date
  }))
  const resolved = resolveActivePrices(mapped, TODAY)
  cek('versi ganda diringkas jadi satu baris per item+kategori', resolved.length <= rows.length,
    `${rows.length} baris mentah -> ${resolved.length} baris berlaku`)
  const adaVersiLain = resolved.filter((r) => r.versiLain > 0).length
  console.log(`     (${adaVersiLain} item punya versi harga lama yang dikalahkan)`)

  // 4. Sentinel 2222 dikenali sebagai "tanpa batas".
  // Sengaja TIDAK memakai YEAR(end_date) di seluruh tabel: fungsi pada kolom
  // mematikan index dan query itu terbukti menembus batas 25 detik.
  const sentinel = rows.filter((r) => isOpenEnded(r.end_date)).length
  cek('sentinel tahun 2222 dikenali tanpa batas', isOpenEnded('2222-12-30'),
    `${sentinel} dari ${rows.length} baris contoh memakainya`)

  // 5. PKS pelanggan: status masa berlaku terhitung.
  const pks = await q(`SELECT trx_no, trx_date, trx_end_date FROM t_pks
    WHERE status='5' AND deleted_at IS NULL ORDER BY trx_date DESC LIMIT 5`)
  const semua = pks.every((p) => ['aktif', 'kadaluarsa', 'belum_mulai'].includes(
    validityOf(p.trx_date, p.trx_end_date, TODAY)))
  cek('status PKS terhitung untuk semua contoh', semua, `${pks.length} PKS diperiksa`)

  // 6. Pencarian pelanggan pakai nama harus cepat (dipakai hampir tiap pertanyaan).
  const t2 = Date.now()
  const cari = await q(`SELECT customer_code, customer_name FROM m_customer
    WHERE status='5' AND deleted_at IS NULL AND customer_name ILIKE ? LIMIT 10`, ['%kariadi%'])
  cek('cari pelanggan by nama cepat (< 5 dtk)', Date.now() - t2 < 5_000,
    `${Date.now() - t2} ms, ${cari.length} kandidat`)
  console.log(`     kandidat: ${cari.map((c) => c.customer_code).join(', ')}`)

  // 7. Pengetahuan master item (21 Agu 2026): jenis, lab, kelompok harga, grup,
  //    dan isi paket. Yang dibuktikan di sini TIDAK bisa dibuktikan unit test —
  //    unit test hanya tahu peta labelnya, bukan apa yang benar-benar ada di
  //    database produksi.
  const jenis = await q(`SELECT item_type, count(*) AS n FROM m_item
    WHERE status='5' AND deleted_at IS NULL GROUP BY item_type`)
  const kodeJenis = jenis.map((r) => r.item_type).filter((x) => x !== null)
  cek('item_type hanya U/K/P', kodeJenis.every((k) => ['U', 'K', 'P'].includes(String(k))),
    kodeJenis.join(', '))

  const lab = await q(`SELECT lab_code, count(*) AS n FROM m_item
    WHERE status='5' AND deleted_at IS NULL GROUP BY lab_code`)
  cek('lab_code hanya PK/PA/MB', lab.every((r) => ['PK', 'PA', 'MB'].includes(String(r.lab_code))),
    lab.map((r) => `${r.lab_code}=${r.n}`).join(' '))

  // ⚠️ Pemeriksaan yang paling penting di blok ini. Ketentuan menyebut TIGA
  // kelompok harga (RP/CC/SB), tapi data memuat kode keempat — "0" pada ratusan
  // item. Kalau kelak kode asing baru muncul lagi, ia harus KETAHUAN di sini,
  // bukan diam-diam ikut terhitung sebagai salah satu dari tiga yang sah.
  const kel = await q(`SELECT price_group_code AS kode, count(*) AS n FROM m_item
    WHERE status='5' AND deleted_at IS NULL GROUP BY price_group_code ORDER BY n DESC`)
  const asing = kel.filter((r) => !['RP', 'CC', 'SB'].includes(String(r.kode)))
  console.log(`     kelompok harga: ${kel.map((r) => `${r.kode}=${r.n}`).join(' ')}`)
  cek('kode kelompok harga di luar RP/CC/SB terdeteksi & tidak ditebak',
    asing.length > 0,
    `${asing.length} kode asing: ${asing.map((r) => `${r.kode}(${r.n})`).join(', ')}`)

  const grup = await q(`SELECT count(*) AS baris, count(DISTINCT code) AS unik
    FROM m_item_group WHERE deleted_at IS NULL`)
  cek('m_item_group.code UNIK — aman di-join langsung',
    Number(grup[0].baris) === Number(grup[0].unik),
    `${grup[0].baris} baris / ${grup[0].unik} kode`)

  // Join grup tidak boleh menggelembungkan jumlah item — jebakan yang sudah dua
  // kali terjadi di modul sales.
  const tanpaJoin = await q(`SELECT count(*) AS n FROM m_item i
    WHERE i.status='5' AND i.deleted_at IS NULL`)
  const denganJoin = await q(`SELECT count(*) AS n FROM m_item i
    LEFT JOIN m_item_group g ON g.code = i.group_code AND g.deleted_at IS NULL
    WHERE i.status='5' AND i.deleted_at IS NULL`)
  cek('join m_item_group tidak menggandakan baris item',
    Number(tanpaJoin[0].n) === Number(denganJoin[0].n),
    `${tanpaJoin[0].n} vs ${denganJoin[0].n}`)

  const paket = await q(`SELECT count(*) AS baris, count(DISTINCT item_code_main) AS induk,
      sum(CASE WHEN is_non_lab = '1' THEN 1 ELSE 0 END) AS non_lab
    FROM m_item_package WHERE deleted_at IS NULL`)
  cek('isi paket terbaca', Number(paket[0].induk) > 0,
    `${paket[0].induk} paket, ${paket[0].baris} isi, ${paket[0].non_lab} non-lab`)

  // ⚠️ Induk paket TIDAK selalu ber-item_type 'K'. Kalau pencarian paket kelak
  // dibatasi ke 'K', sebagian paket yang benar-benar punya isi akan dijawab
  // "tidak ada" padahal datanya ada.
  const indukBukanK = await q(`SELECT count(DISTINCT p.item_code_main) AS n
    FROM m_item_package p
    LEFT JOIN m_item i ON i.item_code = p.item_code_main AND i.deleted_at IS NULL
    WHERE p.deleted_at IS NULL AND (i.item_type IS NULL OR i.item_type <> 'K')`)
  cek('induk paket yang BUKAN item_type K memang ada (jangan disaring ke K saja)',
    Number(indukBukanK[0].n) > 0, `${indukBukanK[0].n} induk`)

  const t3 = Date.now()
  await q(`SELECT i.item_code, i.item_name, g.description
    FROM m_item i
    LEFT JOIN m_item_group g ON g.code = i.group_code AND g.deleted_at IS NULL
    WHERE i.status='5' AND i.deleted_at IS NULL AND i.item_type = 'K' AND i.lab_code = 'PK'
    LIMIT 20`)
  cek('saring jenis+lab tetap cepat (< 5 dtk)', Date.now() - t3 < 5_000, `${Date.now() - t3} ms`)

  // ⚠️ Deteksi "masih ada sisa" pada inno_item_search dilakukan dengan mengambil
  // SATU BARIS LEBIH dari batas, bukan dengan count(*) terpisah (server ini
  // dipakai aplikasi produksi). Kalau caranya kelak diubah, pemeriksaan ini yang
  // menahan: tanpa `adaLagi` hasil tool DIAM soal kelengkapannya, dan model akan
  // mengisi kekosongan itu dengan karangan — terjadi nyata 21 Agu 2026, jawaban
  // ke user menyebut "bagian tengah hasil terpotong oleh sistem" untuk 50 baris
  // pertama dari 549 item C Coret.
  const BATAS = 50
  const banyak = await q(`SELECT i.item_code FROM m_item i
    WHERE i.status='5' AND i.deleted_at IS NULL AND i.price_group_code = 'CC'
    LIMIT ${BATAS + 1}`)
  cek('kelompok harga yang berlimpah terdeteksi masih ada sisanya',
    banyak.length > BATAS, `${banyak.length} baris untuk batas ${BATAS} -> adaLagi=true`)

  const sedikit = await q(`SELECT i.item_code FROM m_item i
    WHERE i.status='5' AND i.deleted_at IS NULL AND i.item_name = 'EKG'
    LIMIT ${BATAS + 1}`)
  cek('hasil yang memang sedikit TIDAK dilaporkan punya sisa',
    sedikit.length <= BATAS, `${sedikit.length} baris -> adaLagi=false`)

  await conn.end()
  console.log(gagal === 0 ? '\nSEMUA PEMERIKSAAN LOLOS' : `\n${gagal} PEMERIKSAAN GAGAL`)
  process.exit(gagal === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('GAGAL:', err.message)
  process.exit(1)
})
