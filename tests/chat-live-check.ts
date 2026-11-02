// Pemeriksaan chat ke database SUNGGUHAN, mensimulasikan DUA orang.
// Jalankan manual: npx tsx tests/chat-live-check.ts
//
// ⚠️ Kenapa ini ada: AIRA memakai single-instance lock (src/main/index.ts:36),
// jadi dua AIRA TIDAK bisa hidup bersamaan di satu laptop — chat antar user tidak
// mungkin diuji ujung-ke-ujung di satu mesin. Skrip ini menguji seluruh lapisan
// layanannya (kirim, baca, kepemilikan, kehadiran) tanpa UI, sehingga yang tersisa
// untuk diuji dua laptop hanyalah tampilannya.
//
// Membersihkan sendiri barisnya di akhir.
import { Pool } from 'pg'
import * as layanan from '../src/main/chat/service'
import { envDb } from './live-env'

const cs = envDb('AIRA_LOGIN_DB')
if (!cs) {
  console.error('AIRA_LOGIN_DB / AIRA_SALES_DB tidak ada di .env')
  process.exit(1)
}

let gagal = 0
function cek(nama: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'OK   ' : 'GAGAL'} ${nama}${detail ? ' — ' + detail : ''}`)
  if (!ok) gagal++
}

// Dua user dummy yang memang ada di seed.
const A = 'spv'
const B = 'manager'
const C = 'staff' // orang ketiga — tidak boleh bisa membaca

const pool = new Pool({ connectionString: cs, max: 1, connectionTimeoutMillis: 15_000 })
const q = async <T = any>(sql: string, p: unknown[] = []): Promise<T[]> =>
  (await pool.query(sql, p)).rows as T[]

async function main(): Promise<void> {
  // Bersihkan sisa jalan sebelumnya supaya hitungannya tidak tercampur.
  await q(
    `DELETE FROM tb_chat_aira_pesan
      WHERE lower(pengirim) = ANY($1) AND lower(penerima) = ANY($1)`,
    [[A, B, C]]
  )

  // --- kirim & baca --------------------------------------------------------
  const [p1] = await q<{ id: string }>(
    `INSERT INTO tb_chat_aira_pesan (pengirim, penerima, isi)
     VALUES ($1, $2, $3) RETURNING id`,
    [A, B, 'halo dari spv']
  )
  const [p2] = await q<{ id: string }>(
    `INSERT INTO tb_chat_aira_pesan (pengirim, penerima, isi)
     VALUES ($1, $2, $3) RETURNING id`,
    [B, A, 'balasan dari manager']
  )
  cek('dua pesan tertulis', !!p1?.id && !!p2?.id)

  // Query percakapan — SAMA PERSIS dengan yang dipakai service.ts
  const percakapan = await q(
    `SELECT id, pengirim, penerima, isi FROM tb_chat_aira_pesan
      WHERE (lower(pengirim) = $1 AND lower(penerima) = $2)
         OR (lower(pengirim) = $2 AND lower(penerima) = $1)
      ORDER BY created_at DESC, id DESC LIMIT 200`,
    [A, B]
  )
  cek('percakapan memuat KEDUA arah', percakapan.length === 2, `${percakapan.length} pesan`)

  // --- kepemilikan: orang ketiga -------------------------------------------
  const punyaC = await q(
    `SELECT id FROM tb_chat_aira_pesan
      WHERE (lower(pengirim) = $1 AND lower(penerima) = $2)
         OR (lower(pengirim) = $2 AND lower(penerima) = $1)`,
    [C, A]
  )
  cek(
    'orang ketiga TIDAK melihat percakapan orang lain',
    punyaC.length === 0,
    `${punyaC.length} baris (harus 0)`
  )

  // Yang menahan bukan penyaringan di layar: klausa WHERE mengikat si penanya.
  const kalauTanpaIkatan = await q(
    'SELECT id FROM tb_chat_aira_pesan WHERE lower(pengirim) = $1 OR lower(penerima) = $1',
    [A]
  )
  cek(
    'tanpa mengikat penanya, baris orang lain memang akan terbaca',
    kalauTanpaIkatan.length >= 2,
    `${kalauTanpaIkatan.length} baris — inilah yang dicegah klausa berikat`
  )

  // --- belum dibaca --------------------------------------------------------
  const [belumB] = await q<{ n: string }>(
    'SELECT count(*) n FROM tb_chat_aira_pesan WHERE lower(penerima) = $1 AND dibaca_at IS NULL',
    [B]
  )
  cek('pesan masuk terhitung belum dibaca', Number(belumB.n) === 1, `${belumB.n}`)

  const ditandai = await q(
    `UPDATE tb_chat_aira_pesan SET dibaca_at = now()
      WHERE lower(penerima) = $1 AND lower(pengirim) = $2 AND dibaca_at IS NULL RETURNING id`,
    [B, A]
  )
  cek('menandai dibaca hanya menyentuh pesan MASUK', ditandai.length === 1, `${ditandai.length}`)

  const [belumA] = await q<{ n: string }>(
    'SELECT count(*) n FROM tb_chat_aira_pesan WHERE lower(penerima) = $1 AND dibaca_at IS NULL',
    [A]
  )
  cek('pesan milik lawan tidak ikut tertandai', Number(belumA.n) === 1, `${belumA.n} (harus 1)`)

  // --- lampiran ------------------------------------------------------------
  const isiBerkas = Buffer.from('ini isi berkas uji');
  const [pl] = await q<{ id: string }>(
    `INSERT INTO tb_chat_aira_pesan
       (pengirim, penerima, isi, lampiran_nama, lampiran_mime, lampiran_ukuran, lampiran_data)
     VALUES ($1,$2,'',$3,$4,$5,$6) RETURNING id`,
    [A, B, 'uji.txt', 'text/plain', isiBerkas.length, isiBerkas]
  )
  const [kembali] = await q<{ lampiran_data: Buffer; lampiran_nama: string }>(
    'SELECT lampiran_nama, lampiran_data FROM tb_chat_aira_pesan WHERE id = $1',
    [pl.id]
  )
  cek(
    'lampiran tersimpan & terbaca utuh',
    kembali.lampiran_data.equals(isiBerkas),
    `${kembali.lampiran_nama}, ${kembali.lampiran_data.length} byte`
  )

  // Pembuangan lampiran lama TIDAK boleh menghapus barisnya.
  await q("UPDATE tb_chat_aira_pesan SET created_at = now() - interval '40 days' WHERE id = $1", [pl.id])
  const dibuang = await q(
    `UPDATE tb_chat_aira_pesan SET lampiran_data = NULL
      WHERE lampiran_data IS NOT NULL AND created_at < now() - ($1 || ' days')::interval
      RETURNING id`,
    ['30']
  )
  const [sisa] = await q<{ ada: boolean; nama: string | null }>(
    'SELECT (lampiran_data IS NOT NULL) AS ada, lampiran_nama AS nama FROM tb_chat_aira_pesan WHERE id = $1',
    [pl.id]
  )
  cek('lampiran tua dibuang isinya', dibuang.length >= 1 && sisa.ada === false)
  cek(
    'baris pesannya TETAP ada (percakapan tidak berlubang)',
    sisa.nama === 'uji.txt',
    `nama masih "${sisa.nama}"`
  )

  // --- kehadiran -----------------------------------------------------------
  await q(
    `INSERT INTO tb_chat_aira_hadir (username, last_seen, hostname) VALUES ($1, now(), 'uji')
     ON CONFLICT (username) DO UPDATE SET last_seen = now()`,
    [A]
  )
  const [onlineA] = await q<{ n: string }>(
    `SELECT count(*) n FROM tb_chat_aira_hadir
      WHERE lower(username) = $1 AND last_seen > now() - interval '60 seconds'`,
    [A]
  )
  cek('detak membuat orang tampak online', Number(onlineA.n) === 1)

  await q("UPDATE tb_chat_aira_hadir SET last_seen = now() - interval '5 minutes' WHERE lower(username) = $1", [A])
  const [masihOnline] = await q<{ n: string }>(
    `SELECT count(*) n FROM tb_chat_aira_hadir
      WHERE lower(username) = $1 AND last_seen > now() - interval '60 seconds'`,
    [A]
  )
  cek('detak basi = offline', Number(masihOnline.n) === 0)

  // --- hapus pesan (16 Sep 2026) -------------------------------------------
  //
  // ⚠️ Tidak bisa diuji unit test: seluruh aturannya ada di klausa WHERE, dan
  // yang paling penting justru yang MENOLAK — "orang lain tidak bisa menghapus
  // pesanku". Aturan di SQL hanya bisa dibuktikan ke SQL.
  //
  // ⚠️ Memakai `hapusPesan` ASLI lewat titik suntik, bukan salinan SQL-nya.
  // Versi pertama bagian ini menyalin statement-nya — dan salinan itu langsung
  // tertinggal saat grup menambahkan `AND jenis IS NULL` (16 Sep 2026). Salinan
  // yang tertinggal tetap hijau sambil menguji sesuatu yang tidak dipakai.
  layanan.pakaiKoneksiUjiLayanan(q)
  const hapus = async (pesanId: string, oleh: string): Promise<unknown[]> =>
    (await layanan.hapusPesan(oleh, pesanId)) ? [1] : []

  const [ph] = await q<{ id: string }>(
    `INSERT INTO tb_chat_aira_pesan
       (pengirim, penerima, isi, lampiran_nama, lampiran_mime, lampiran_ukuran, lampiran_data)
     VALUES ($1, $2, $3, 'rahasia.pdf', 'application/pdf', 4, $4) RETURNING id`,
    [A, B, 'nominal penawaran 4,2 M', Buffer.from('abcd')]
  )

  // Penerima mencoba menghapus pesan pengirim -> WAJIB ditolak.
  const olehPenerima = await hapus(ph.id, B)
  cek(
    'penerima TIDAK bisa menghapus pesan orang lain',
    olehPenerima.length === 0,
    `${olehPenerima.length} baris terhapus (harus 0)`
  )

  // Orang ketiga yang menebak id pun ditolak — inilah yang dijaga aturan §32.
  const olehC = await hapus(ph.id, C)
  cek('orang ketiga TIDAK bisa menghapus dengan menebak id', olehC.length === 0)

  const [utuh] = await q<{ isi: string; lampiran_nama: string | null }>(
    'SELECT isi, lampiran_nama FROM tb_chat_aira_pesan WHERE id = $1',
    [ph.id]
  )
  cek(
    'pesan tetap utuh setelah percobaan hapus yang ditolak',
    utuh.isi === 'nominal penawaran 4,2 M' && utuh.lampiran_nama === 'rahasia.pdf'
  )

  // Pengirim menghapus pesannya sendiri.
  const olehPengirim = await hapus(ph.id, A)
  cek('pengirim bisa menghapus pesannya sendiri', olehPengirim.length === 1)

  const [nisan] = await q<{
    isi: string
    lampiran_nama: string | null
    lampiran_data: Buffer | null
    dihapus_at: string | null
    dihapus_oleh: string | null
  }>(
    `SELECT isi, lampiran_nama, lampiran_data, dihapus_at, dihapus_oleh
       FROM tb_chat_aira_pesan WHERE id = $1`,
    [ph.id]
  )
  cek('barisnya TETAP ada (nisan, bukan lubang)', !!nisan)
  cek('isi teks benar-benar dibuang', nisan.isi === '')
  cek(
    'lampiran benar-benar dibuang, bukan sekadar disembunyikan',
    nisan.lampiran_nama === null && nisan.lampiran_data === null
  )
  cek('jejak siapa yang menghapus tercatat', nisan.dihapus_oleh?.toLowerCase() === A)

  // Hapus dua kali tidak menimpa waktu hapus yang pertama.
  const lagi = await hapus(ph.id, A)
  cek('menghapus dua kali tidak melakukan apa-apa', lagi.length === 0)

  // Pesan yang sudah dihapus tidak boleh ikut dihitung "belum dibaca" —
  // kalau ikut, lencana taskbar menampilkan angka untuk pesan yang isinya
  // sudah tidak ada, dan penerimanya akan mencari sesuatu yang tidak ada.
  const [belum] = await q<{ n: string }>(
    `SELECT count(*) n FROM tb_chat_aira_pesan
      WHERE lower(penerima) = $1 AND dibaca_at IS NULL AND dihapus_at IS NULL`,
    [B]
  )
  const [belumTanpaSaringan] = await q<{ n: string }>(
    `SELECT count(*) n FROM tb_chat_aira_pesan
      WHERE lower(penerima) = $1 AND dibaca_at IS NULL`,
    [B]
  )
  cek(
    'pesan terhapus tidak dihitung "belum dibaca"',
    Number(belum.n) < Number(belumTanpaSaringan.n),
    `${belum.n} vs ${belumTanpaSaringan.n} tanpa saringan`
  )

  // --- bersih-bersih -------------------------------------------------------
  await q(
    `DELETE FROM tb_chat_aira_pesan
      WHERE lower(pengirim) = ANY($1) AND lower(penerima) = ANY($1)`,
    [[A, B, C]]
  )
  await q('DELETE FROM tb_chat_aira_hadir WHERE lower(username) = ANY($1)', [[A, B, C]])
  const [sisaPesan] = await q<{ n: string }>(
    `SELECT count(*) n FROM tb_chat_aira_pesan
      WHERE lower(pengirim) = ANY($1) AND lower(penerima) = ANY($1)`,
    [[A, B, C]]
  )
  cek('baris uji dibersihkan', Number(sisaPesan.n) === 0)
}

main()
  .catch((e) => {
    console.error('GAGAL:', e instanceof Error ? e.message : e)
    gagal++
  })
  .finally(async () => {
    await pool.end().catch(() => {})
    console.log(gagal ? `\n${gagal} PEMERIKSAAN GAGAL` : '\nSEMUA LOLOS')
    process.exit(gagal ? 1 : 0)
  })
