import { ToolError, type ToolDefinition } from './types'
import { innoQuery, innoDbConfigured } from '../masterdata/db'
import {
  REGULER_PRICE_COLUMNS,
  CUSTOMER_TYPE_LABELS,
  customerTypeLabel,
  disambiguateItems,
  jenisItemDari,
  kelompokHargaDari,
  labDari,
  labelJenisItem,
  labelKelompokHarga,
  labelLab,
  resolveActivePrices,
  validityLabel,
  validityOf,
  isOpenEnded,
  type PriceRow
} from '../masterdata/rules'
import { categoryLabel, loadPriceCategories } from '../masterdata/categories'
import { jakartaToday } from '../sales/periods'

// Tool master data the lab (database `inno_collection`, MariaDB).
//
// Prinsipnya sama dengan tool sales: model TIDAK PERNAH menulis SQL — dia hanya
// memilih tool dan mengisi parameter. Bedanya, di sini yang ditanyakan adalah
// MASTER DATA (pelanggan terdaftar, item, harga, PKS, dokter), bukan transaksi.
//
// Dua rem yang berlaku di seluruh file ini:
//   1. Semua query memakai kolom ber-index + LIMIT — server ini dipakai aplikasi produksi.
//   2. Baris "hidup" selalu `deleted_at IS NULL`, dan master yang punya alur approval
//      dibatasi `status = '5'` (approved) sesuai ketentuan tim Master Data.

/**
 * Baris master yang "hidup": sudah disetujui (status 5) dan belum dihapus.
 * SELALU memakai alias tabel — tanpa itu `deleted_at` jadi ambigu begitu querynya
 * ikut menyentuh tabel lain, dan MariaDB menolak querynya (terjadi 18 Agu 2026).
 */
export function alive(alias: string): string {
  return `${alias}.status = '5' AND ${alias}.deleted_at IS NULL`
}

const MAX_ROWS = 50

function guard(): void {
  if (!innoDbConfigured()) {
    throw new ToolError('database Master Data belum dikonfigurasi pada aplikasi ini')
  }
}

function limitOf(args: Record<string, unknown>, fallback: number): number {
  return Math.min(Math.max(Number(args.limit) || fallback, 1), MAX_ROWS)
}

function requiredText(args: Record<string, unknown>, key: string, label: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new ToolError(`${label} wajib diisi`)
  }
  return value.trim()
}

/** Pencarian teks: dipakai untuk nama & kode sekaligus, selalu lewat parameter. */
function likeParam(text: string): string {
  return `%${text.replace(/[%_]/g, (m) => `\\${m}`)}%`
}

/**
 * Saringan item yang SAMA untuk mencari (inno_item_search) dan menghitung
 * (inno_item_count) — dua salinan akan menyimpang diam-diam, dan "ada 1.200 item
 * single" yang tidak cocok dengan daftarnya adalah angka salah yang terlihat resmi.
 */
export function saringanItem(args: Record<string, unknown>): {
  keyword: string
  jenis: string | null
  lab: string | null
  kelompok: string | null
  grup: string
  syarat: string[]
  params: unknown[]
} {
  const keyword = typeof args.keyword === 'string' ? args.keyword.trim() : ''
  const jenis = jenisItemDari(args.jenis)
  const lab = labDari(args.lab)
  const kelompok = kelompokHargaDari(args.kelompokHarga)
  const grup = typeof args.grup === 'string' ? args.grup.trim() : ''

  // Kata penyaring yang TIDAK dikenali ditolak, bukan diabaikan diam-diam.
  // Kalau diabaikan, user meminta "item paket" lalu menerima SELURUH item —
  // jawabannya terlihat wajar dan salahnya tidak ketahuan siapa pun.
  const pemeriksaan: Array<[unknown, string | null, string, string]> = [
    [args.jenis, jenis, 'jenis', 'paket / profile / single (atau K/P/U)'],
    [args.lab, lab, 'lab', 'PK / PA / MB'],
    [args.kelompokHarga, kelompok, 'kelompokHarga', 'RP / CC (C Coret) / SB (Segitiga Bertanda)']
  ]
  for (const [nilaiAsli, hasil, label, sah] of pemeriksaan) {
    if (typeof nilaiAsli === 'string' && nilaiAsli.trim() && hasil === null) {
      throw new ToolError(`nilai "${nilaiAsli}" tidak dikenal untuk ${label} — yang sah: ${sah}`)
    }
  }

  const syarat: string[] = []
  const params: unknown[] = []
  if (keyword) {
    const like = likeParam(keyword)
    syarat.push(
      '(i.item_name ILIKE ? OR i.item_code = ? OR i.item_code_lis = ?' +
        ' OR i.item_name_alias ILIKE ? OR i.item_name_eng ILIKE ?)'
    )
    params.push(like, keyword, keyword, like, like)
  }
  if (jenis) {
    syarat.push('i.item_type = ?')
    params.push(jenis)
  }
  if (lab) {
    syarat.push('i.lab_code = ?')
    params.push(lab)
  }
  if (kelompok) {
    syarat.push('i.price_group_code = ?')
    params.push(kelompok)
  }
  if (grup) {
    syarat.push('(i.group_code = ? OR g.description ILIKE ?)')
    params.push(grup, likeParam(grup))
  }
  return { keyword, jenis, lab, kelompok, grup, syarat, params }
}

/** Kode `customer_type` dari kode ("RS") atau nama ("rumah sakit"); tak dikenal = null. */
export function tipePelangganDari(teks: string): string | null {
  const t = teks.trim().toLowerCase()
  if (!t) return null
  for (const [kode, label] of Object.entries(CUSTOMER_TYPE_LABELS)) {
    if (t === kode.toLowerCase()) return kode
    if ((t.length >= 4 && label.toLowerCase().includes(t)) || t.includes(label.toLowerCase())) return kode
  }
  if (/\brs\b|rumah ?sakit|hospital/.test(t)) return 'RS'
  if (/korporat|perusahaan|corporate/.test(t)) return 'PH'
  if (/\blab/.test(t)) return 'LB'
  return null
}

/** Ringkasan langkah di layar — dulu "Cari item: undefined" saat hanya menyaring. */
function ringkasSaringanItem(awalan: string): (a: Record<string, unknown>) => string {
  return (a) => {
    const bagian = (['keyword', 'jenis', 'lab', 'grup', 'kelompokHarga'] as const)
      .map((k) => (typeof a[k] === 'string' && (a[k] as string).trim() ? `${k} ${(a[k] as string).trim()}` : ''))
      .filter(Boolean)
    return `${awalan}: ${bagian.length ? bagian.join(', ') : 'all'}`
  }
}

interface CustomerRow {
  customer_code: string
  customer_code_lis: string | null
  customer_name: string | null
  customer_type: string | null
  customer_city: string | null
  customer_province: string | null
  is_erp: number | null
  top_days: string | null
  group_price: number | null
  is_active: string | null
}

function shapeCustomer(r: CustomerRow): Record<string, unknown> {
  return {
    kode: r.customer_code,
    kodeLis: r.customer_code_lis,
    nama: r.customer_name,
    tipe: customerTypeLabel(r.customer_type),
    kodeTipe: r.customer_type,
    kodeKota: r.customer_city,
    kodeProvinsi: r.customer_province,
    terhubungERP: r.is_erp === 1,
    terminPembayaranHari: r.top_days,
    grupHarga: r.group_price
  }
}

const CUSTOMER_SELECT = `customer_code, customer_code_lis, customer_name, customer_type,
  customer_city, customer_province, is_erp, top_days, group_price, is_active`

/**
 * Nama pelanggan sangat ambigu di master ini — "kariadi" cocok ke 5 baris berbeda
 * (RSUP Dr. Kariadi, Pasien Pribadi RSUP Dr. Kariadi, PT Biozatix (RSUP Dr. Kariadi), …).
 * Karena itu pencarian SELALU mengembalikan daftar kandidat, tidak pernah menebak satu.
 */
async function findCustomers(keyword: string, limit: number): Promise<CustomerRow[]> {
  const like = likeParam(keyword)
  return innoQuery<CustomerRow>(
    `SELECT ${CUSTOMER_SELECT} FROM m_customer
     WHERE ${alive('m_customer')}
       AND (customer_name ILIKE ? OR customer_code = ? OR customer_code_lis = ?
            OR customer_name_alias ILIKE ?)
     ORDER BY (customer_code = ?) DESC, char_length(customer_name), customer_name
     LIMIT ${limit}`,
    [like, keyword, keyword, like, keyword]
  )
}

/** Satu pelanggan pasti: kode persis, atau nama yang hanya cocok ke satu baris. */
async function resolveOneCustomer(keyword: string): Promise<CustomerRow> {
  const found = await findCustomers(keyword, 12)
  if (found.length === 0) {
    throw new ToolError(
      `pelanggan "${keyword}" tidak ditemukan di master (yang terdaftar & disetujui). ` +
        'Coba kata kunci lain, atau pakai inno_customer_search untuk melihat kandidatnya.'
    )
  }
  const exact = found.find(
    (c) => c.customer_code === keyword || c.customer_code_lis === keyword
  )
  if (exact) return exact
  if (found.length > 1) {
    const daftar = found
      .slice(0, 8)
      .map((c) => `${c.customer_code} — ${c.customer_name}`)
      .join(' | ')
    throw new ToolError(
      `nama "${keyword}" cocok ke ${found.length} pelanggan, jadi belum pasti yang mana. ` +
        `Tanyakan ke user yang mana yang dimaksud, ATAU panggil lagi dengan kode pelanggannya. Kandidat: ${daftar}`
    )
  }
  return found[0]
}

export const innoTools: ToolDefinition[] = [
  {
    name: 'inno_customer_search',
    label: 'Search Customers',
    description:
      'Searches customers REGISTERED in the Master Data by name or code. ' +
      'Use for "is hospital X registered", "customer code for clinic Y", ' +
      'and as the first step before asking about the special price/PKS of a specific customer.',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Sebagian nama pelanggan, atau kode pelanggan persis' },
        limit: { type: 'number', description: 'Jumlah hasil (default 10, maks 50)' }
      },
      required: ['keyword']
    },
    tier: 'read',
    timeoutMs: 45_000,
    summarize: (a) => `Search customers: ${a.keyword}`,
    execute: async (args) => {
      guard()
      const keyword = requiredText(args, 'keyword', 'keyword')
      const rows = await findCustomers(keyword, limitOf(args, 10))
      return JSON.stringify({
        pencarian: keyword,
        jumlah: rows.length,
        catatan:
          'Hanya pelanggan berstatus disetujui (status=5) dan belum dihapus. Nama pelanggan sering mirip ' +
          '(mis. "RSUP X" vs "Pasien Pribadi RSUP X") — pastikan ke user mana yang dimaksud bila lebih dari satu.',
        pelanggan: rows.map(shapeCustomer)
      })
    }
  },
  {
    name: 'inno_customer_count',
    label: 'Count Customers',
    description:
      'MENGHITUNG jumlah pelanggan TERDAFTAR di master (agregat COUNT, bukan daftar) — total beserta ' +
      'rincian per tipe pelanggan (Rumah Sakit, Klinik, Pasien Pribadi, Laboratorium, dst.). Pakai untuk ' +
      '"customer kita ada berapa", "jumlah rumah sakit yang terdaftar". Saringan opsional.',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Sebagian nama pelanggan (opsional)' },
        tipe: {
          type: 'string',
          description:
            'Kode atau nama tipe: ' +
            Object.entries(CUSTOMER_TYPE_LABELS).map(([k, v]) => `${k}=${v}`).join(', ') + ' (opsional)'
        }
      }
    },
    tier: 'read',
    timeoutMs: 45_000,
    summarize: (a) => {
      const bagian = (['keyword', 'tipe'] as const)
        .map((k) => (typeof a[k] === 'string' && (a[k] as string).trim() ? `${k} ${(a[k] as string).trim()}` : ''))
        .filter(Boolean)
      return `Count customers: ${bagian.length ? bagian.join(', ') : 'all'}`
    },
    execute: async (args) => {
      guard()
      const keyword = typeof args.keyword === 'string' ? args.keyword.trim() : ''
      const tipeAsli = typeof args.tipe === 'string' ? args.tipe.trim() : ''
      const tipe = tipeAsli ? tipePelangganDari(tipeAsli) : null
      if (tipeAsli && !tipe) {
        throw new ToolError(
          `tipe "${tipeAsli}" tidak dikenal — yang sah: ` +
            Object.entries(CUSTOMER_TYPE_LABELS).map(([k, v]) => `${k} (${v})`).join(', ')
        )
      }
      const syarat: string[] = []
      const params: unknown[] = []
      if (keyword) {
        const like = likeParam(keyword)
        syarat.push('(customer_name ILIKE ? OR customer_name_alias ILIKE ?)')
        params.push(like, like)
      }
      if (tipe) {
        syarat.push('customer_type = ?')
        params.push(tipe)
      }
      // customer_code terbukti unik pada baris hidup (4.088/4.088, 5 Okt 2026) — count(*) tidak menggelembung.
      const rows = await innoQuery<{ customer_type: string | null; is_active: string | null; n: number }>(
        `SELECT customer_type, is_active, count(*) AS n FROM m_customer
         WHERE ${alive('m_customer')}${syarat.length ? ` AND ${syarat.join(' AND ')}` : ''}
         GROUP BY customer_type, is_active`,
        params
      )
      const total = rows.reduce((s, r) => s + Number(r.n), 0)
      const nonaktif = rows.filter((r) => String(r.is_active) !== '1').reduce((s, r) => s + Number(r.n), 0)
      const peta = new Map<string, number>()
      for (const r of rows) {
        const k = customerTypeLabel(r.customer_type)
        peta.set(k, (peta.get(k) ?? 0) + Number(r.n))
      }
      return JSON.stringify({
        saringan: { keyword: keyword || null, tipe: tipe ? customerTypeLabel(tipe) : null },
        totalPelanggan: total,
        tidakAktif: nonaktif,
        perTipe: [...peta].map(([nama, jumlah]) => ({ nama, jumlah })).sort((a, b) => b.jumlah - a.jumlah),
        catatanHasil:
          `Hasil COUNT langsung di database atas SELURUH pelanggan terdaftar yang cocok (status disetujui, ` +
          `belum dihapus) — total ${total}, tanpa batas baris. Ini jumlah pelanggan TERDAFTAR di master, ` +
          'BUKAN pelanggan yang bertransaksi (itu pertanyaan menu Tanya Data Sales). "Pasien Pribadi" ' +
          'adalah tipe pelanggan tersendiri — sebutkan porsinya bila user menanyakan jumlah institusi.'
      })
    }
  },
  {
    name: 'inno_item_search',
    label: 'Search Test Items',
    description:
      'Mencari item/pemeriksaan yang terdaftar di master beserta HARGA REGULER-nya ' +
      '(B2B/Corporate dan B2C), jenis item, laboratorium, grup pemeriksaan, dan kelompok harga. ' +
      'Pakai untuk "apakah pemeriksaan X ada", "berapa harga X", "kode item untuk Y", ' +
      '"berapa TAT-nya", "pemeriksaan paket apa saja", "item PA apa saja", ' +
      '"keluarkan item C Coret". Bisa dipanggil TANPA keyword bila hanya menyaring ' +
      '(mis. semua item paket di Patologi Anatomi).',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Sebagian nama pemeriksaan, atau kode item persis' },
        jenis: {
          type: 'string',
          description:
            'Jenis item: "paket" (K), "profile" (P), atau "single" (U). Boleh diisi kodenya langsung.'
        },
        lab: {
          type: 'string',
          description:
            'Laboratorium: "PK"/Patologi Klinik, "PA"/Patologi Anatomi, "MB"/Mikrobiologi.'
        },
        grup: {
          type: 'string',
          description: 'Kode atau sebagian nama grup pemeriksaan, mis. "HMT", "hematologi".'
        },
        kelompokHarga: {
          type: 'string',
          description:
            'Kelompok harga marketing: "RP"/Reguler Price, "CC"/C Coret, "SB"/Segitiga Bertanda.'
        },
        limit: { type: 'number', description: 'Jumlah hasil (default 10, maks 50)' }
      }
    },
    tier: 'read',
    timeoutMs: 45_000,
    summarize: ringkasSaringanItem('Search items'),
    execute: async (args) => {
      guard()
      const { keyword, jenis, lab, kelompok, grup, syarat, params } = saringanItem(args)
      if (!syarat.length) {
        throw new ToolError(
          'isi minimal satu: keyword, jenis, lab, grup, atau kelompokHarga — master item terlalu ' +
            'besar untuk ditampilkan seluruhnya. Untuk pertanyaan JUMLAH ("ada berapa item"), ' +
            'pakai inno_item_count, bukan tool ini.'
        )
      }
      // m_item.item_code terbukti UNIK pada status=5 & belum dihapus (1.608/1.608).
      //
      // m_reguler_price TIDAK dijamin unik (terukur 1.770 baris / 1.769 kode: item
      // JHOPAPGELYM007 punya dua baris harga). Join langsung ke tabel harga akan
      // menggandakan baris item begitu kode dobel itu ikut aktif — jebakan yang sama
      // yang sudah dua kali menggelembungkan angka di modul sales. Karena MariaDB
      // tidak punya LATERAL, padanannya: join ke SATU id hasil subquery ber-LIMIT 1.
      // Join ke m_item_group AMAN: terukur 29 baris / 29 kode unik, jadi tidak
      // bisa menggandakan baris item. Bandingkan dengan m_reguler_price yang
      // TIDAK unik dan karena itu tetap diambil lewat subquery LIMIT 1.
      // Diambil SATU LEBIH dari batas semata-mata untuk tahu apakah masih ada
      // sisa. Tanpa ini hasil tool DIAM soal kelengkapannya, dan model akan
      // mengisi kekosongan itu dengan karangan — terjadi nyata 21 Agu 2026:
      // pencarian mengembalikan tepat 50 baris, model tidak punya cara tahu
      // apakah 50 itu seluruhnya atau cuma yang muat, lalu menulis "bagian
      // tengah hasil terpotong oleh sistem". Menghitung count(*) terpisah
      // ditolak: server MariaDB ini dipakai aplikasi produksi (aturan 14), dan
      // satu baris ekstra jauh lebih murah daripada satu query tambahan.
      const batas = limitOf(args, 10)
      const rowsPlus = await innoQuery<Record<string, any>>(
        `SELECT i.item_code, i.item_name, i.item_type, i.lab_code, i.group_la,
                i.group_code, g.description AS grup_nama, g.item_headgroup_code,
                i.tat_rutin, i.is_outsource, i.price_group_code, i.reguler_price AS harga_pada_item,
                rp.k1, rp.k2
         FROM m_item i
         LEFT JOIN m_item_group g ON g.code = i.group_code AND g.deleted_at IS NULL
         LEFT JOIN m_reguler_price rp ON rp.id = (
           SELECT rp2.id FROM m_reguler_price rp2
           WHERE rp2.item_code = i.item_code AND rp2.deleted_at IS NULL AND rp2.status = '5'
           ORDER BY rp2.updated_at DESC, rp2.id
           LIMIT 1
         )
         WHERE ${alive('i')}
           AND ${syarat.join(' AND ')}
         ORDER BY (i.item_code = ?) DESC, char_length(i.item_name), i.item_name
         LIMIT ${batas + 1}`,
        [...params, keyword]
      )
      const adaLagi = rowsPlus.length > batas
      const rows = adaLagi ? rowsPlus.slice(0, batas) : rowsPlus

      return JSON.stringify({
        pencarian: keyword || '(tanpa kata kunci)',
        saringan: {
          jenis: jenis ? labelJenisItem(jenis) : null,
          lab: lab ? labelLab(lab) : null,
          kelompokHarga: kelompok ? labelKelompokHarga(kelompok) : null,
          grup: grup || null
        },
        jumlah: rows.length,
        catatanHarga:
          'Harga reguler dari m_reguler_price: ' +
          REGULER_PRICE_COLUMNS.map((c) => `${c.column}=${c.label}`).join(', ') +
          '. HANYA dua harga ini yang disajikan (ketentuan pemilik data). Ini harga DAFTAR; ' +
          'pelanggan tertentu bisa punya SPECIAL PRICE yang mengalahkan harga daftar — cek ' +
          'inno_special_price, dan sebutkan kemungkinan itu bila user menanyakan harga untuk ' +
          'pelanggan tertentu.',
        item: rows.map((r) => ({
          kode: r.item_code,
          nama: r.item_name,
          jenis: labelJenisItem(r.item_type),
          lab: labelLab(r.lab_code),
          grup: r.grup_nama ? `${r.grup_nama} (${r.group_code})` : r.group_code || null,
          grupLa: r.group_la,
          kelompokHarga: labelKelompokHarga(r.price_group_code),
          tatRutinJam: r.tat_rutin,
          outsource: String(r.is_outsource) === '1',
          hargaB2B: r.k1 === null ? null : Number(r.k1),
          hargaB2C: r.k2 === null ? null : Number(r.k2),
          hargaTercatatDiItem: r.harga_pada_item,
          isiPaketBisaDilihat: String(r.item_type ?? '').toUpperCase() === 'K'
        })),
        adaLagi,
        // Hasil tool TIDAK BOLEH diam soal kelengkapannya — kalimat, bukan
        // sekadar bendera (aturan project; bendera boolean sudah terbukti tidak
        // cukup untuk menahan karangan).
        catatanHasil:
          (adaLagi
            ? `Ditampilkan ${rows.length} item PERTAMA; MASIH ADA item lain yang cocok tapi belum ` +
              'ditampilkan. Naikkan parameter limit, atau persempit dengan saringan jenis/lab/grup, ' +
              'bila user meminta daftar lengkap. Bila user menanyakan JUMLAH/TOTAL, JANGAN menghitung ' +
              'dari daftar ini — panggil inno_item_count dengan saringan yang sama. '
            : `Ini SELURUH item yang cocok (${rows.length}); tidak ada sisa yang belum ditampilkan. `) +
          'Sebutkan kelengkapan itu apa adanya, dan JANGAN menyatakan ada bagian hasil yang ' +
          'terpotong di luar yang dinyatakan kalimat ini. ' +
          'Untuk item berjenis Paket, isinya dibuka dengan inno_item_package. Kode yang tidak ' +
          'terdaftar artinya ditampilkan apa adanya — JANGAN menebak maknanya.'
      })
    }
  },
  {
    name: 'inno_item_count',
    label: 'Count Test Items',
    description:
      'MENGHITUNG jumlah item/pemeriksaan di master (agregat COUNT, bukan daftar) — total beserta ' +
      'rincian per laboratorium, per jenis item, dan per grup pemeriksaan. Pakai untuk "ada berapa ' +
      'item single test", "total pemeriksaan PA", "jumlah item paket per lab". Saringan sama dengan ' +
      'inno_item_search dan semuanya opsional (tanpa saringan = seluruh master item).',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Sebagian nama pemeriksaan (opsional)' },
        jenis: {
          type: 'string',
          description: 'Jenis item: "paket" (K), "profile" (P), atau "single" (U).'
        },
        lab: {
          type: 'string',
          description: 'Laboratorium: "PK"/Patologi Klinik, "PA"/Patologi Anatomi, "MB"/Mikrobiologi.'
        },
        grup: { type: 'string', description: 'Kode atau sebagian nama grup pemeriksaan.' },
        kelompokHarga: {
          type: 'string',
          description: 'Kelompok harga marketing: "RP"/Reguler Price, "CC"/C Coret, "SB"/Segitiga Bertanda.'
        }
      }
    },
    tier: 'read',
    timeoutMs: 45_000,
    summarize: ringkasSaringanItem('Count items'),
    execute: async (args) => {
      guard()
      const { keyword, jenis, lab, kelompok, grup, syarat, params } = saringanItem(args)
      // Satu GROUP BY berisi tiga dimensi; total & rincian per dimensi dijumlah KODE dari
      // baris yang sama, jadi angkanya pasti saling cocok. m_item ±1.600 baris dan join ke
      // m_item_group unik per kode (lihat inno_item_search) — tidak menggandakan hitungan.
      const rows = await innoQuery<{ lab_code: string | null; item_type: string | null; grup: string | null; n: number }>(
        `SELECT i.lab_code, i.item_type,
                COALESCE(g.description, i.group_code) AS grup, count(*) AS n
         FROM m_item i
         LEFT JOIN m_item_group g ON g.code = i.group_code AND g.deleted_at IS NULL
         WHERE ${alive('i')}${syarat.length ? ` AND ${syarat.join(' AND ')}` : ''}
         GROUP BY i.lab_code, i.item_type, COALESCE(g.description, i.group_code)`,
        params
      )
      const rincian = (kunci: (r: (typeof rows)[number]) => string): Array<{ nama: string; jumlah: number }> => {
        const peta = new Map<string, number>()
        for (const r of rows) peta.set(kunci(r), (peta.get(kunci(r)) ?? 0) + Number(r.n))
        return [...peta].map(([nama, jumlah]) => ({ nama, jumlah })).sort((a, b) => b.jumlah - a.jumlah)
      }
      const total = rows.reduce((s, r) => s + Number(r.n), 0)
      return JSON.stringify({
        saringan: {
          keyword: keyword || null,
          jenis: jenis ? labelJenisItem(jenis) : null,
          lab: lab ? labelLab(lab) : null,
          kelompokHarga: kelompok ? labelKelompokHarga(kelompok) : null,
          grup: grup || null
        },
        totalItem: total,
        perLab: rincian((r) => labelLab(r.lab_code) ?? '(tanpa lab)'),
        perJenis: rincian((r) => labelJenisItem(r.item_type) ?? '(tanpa jenis)'),
        perGrup: rincian((r) => r.grup ?? '(tanpa grup)'),
        catatanHasil:
          `Angka ini hasil COUNT langsung di database atas SELURUH item yang cocok (status disetujui, ` +
          `belum dihapus) — total ${total}, tanpa batas baris. Sebutkan angkanya apa adanya; ` +
          'rincian per lab/jenis/grup dijumlah dari hitungan yang sama.'
      })
    }
  },
  {
    name: 'inno_special_price',
    label: 'Customer Special Price',
    description:
      'Harga khusus (special price) yang dimiliki SATU pelanggan. Pakai untuk ' +
      '"tolong carikan special price dari rumah sakit X", "harga khusus klinik Y untuk pemeriksaan Z", ' +
      '"apakah pelanggan ini punya harga khusus". Bisa disaring ke satu item lewat parameter item.',
    parameters: {
      type: 'object',
      properties: {
        customer: {
          type: 'string',
          description: 'Nama pelanggan (sebagian boleh) ATAU kode pelanggan. Wajib.'
        },
        item: { type: 'string', description: 'Opsional: saring ke pemeriksaan tertentu (nama/kode)' },
        priceCategory: {
          type: 'string',
          description:
            'Opsional: saring ke satu kategori harga. Kode di master: 1=Special Price, 2=BPJS/PMK3, ' +
            '3=Discount Group, 6=IHK CSR, 7=Internal Memo Nominal, 8=Internal Memo Persen, ' +
            '9=Special Price Clinician, 10=EGFR One Onco. Isi KODE-nya, mis. "2" untuk BPJS.'
        },
        includeExpired: {
          type: 'boolean',
          description: 'Sertakan yang sudah kadaluarsa/belum berlaku (default false)'
        },
        limit: { type: 'number', description: 'Jumlah baris (default 25, maks 50)' }
      },
      required: ['customer']
    },
    tier: 'read',
    timeoutMs: 60_000,
    summarize: (a) => `Special price: ${a.customer}${a.item ? ` — ${a.item}` : ''}`,
    execute: async (args) => {
      guard()
      const keyword = requiredText(args, 'customer', 'customer')
      const customer = await resolveOneCustomer(keyword)
      const today = jakartaToday()
      const itemFilter = typeof args.item === 'string' && args.item.trim() ? args.item.trim() : null

      const params: unknown[] = [customer.customer_code]
      let itemClause = ''
      if (itemFilter) {
        itemClause = ` AND (sp.item_code = ? OR sp.item_name ILIKE ? OR mi.item_name ILIKE ?)`
        params.push(itemFilter, likeParam(itemFilter), likeParam(itemFilter))
      }
      const categoryFilter =
        typeof args.priceCategory === 'string' && args.priceCategory.trim()
          ? args.priceCategory.trim()
          : null
      if (categoryFilter) {
        itemClause += ` AND sp.price_category = ?`
        params.push(categoryFilter)
      }

      // Index idx_msp_cust_item_live membuat filter per pelanggan cepat.
      const rows = await innoQuery<Record<string, any>>(
        `SELECT sp.item_code, coalesce(mi.item_name, sp.item_name) AS item_name,
                sp.price_category, sp.reguler_price, sp.special_price,
                sp.start_date, sp.end_date
         FROM m_special_price sp
         LEFT JOIN m_item mi ON mi.item_code = sp.item_code AND ${alive('mi')}
         WHERE sp.customer_code = ? AND sp.deleted_at IS NULL${itemClause}
         LIMIT 400`,
        params
      )

      const mapped: PriceRow[] = rows.map((r) => ({
        itemCode: r.item_code,
        itemName: r.item_name,
        specialPrice: r.special_price === null ? null : Number(r.special_price),
        regulerPrice: r.reguler_price === null ? null : Number(r.reguler_price),
        priceCategory: r.price_category,
        startDate: r.start_date,
        endDate: r.end_date
      }))
      // Nama item dibedakan SESUDAH versi diringkas, supaya penanda kode hanya
      // menempel pada baris yang benar-benar tampil bersebelahan.
      const resolved = disambiguateItems(resolveActivePrices(mapped, today))
      const kategori = await loadPriceCategories()
      const includeExpired = args.includeExpired === true
      const shown = (includeExpired ? resolved : resolved.filter((r) => r.status === 'aktif')).slice(
        0,
        limitOf(args, 25)
      )
      const jumlahAktif = resolved.filter((r) => r.status === 'aktif').length

      return JSON.stringify({
        pelanggan: shapeCustomer(customer),
        tanggalAcuan: today,
        jumlahItemPunyaHargaKhusus: resolved.length,
        jumlahAktifHariIni: jumlahAktif,
        ditampilkan: shown.length,
        catatan:
          'Satu item bisa muncul LEBIH DARI SEKALI dengan KATEGORI HARGA berbeda (mis. "Special Price" ' +
          'dan "BPJS/PMK3") — itu wajar, bukan duplikat; sebutkan kategorinya saat mengutip harga. ' +
          'Dalam satu kategori, bila ada beberapa VERSI, yang ditampilkan adalah versi aktif dengan tanggal ' +
          'mulai paling baru dan "versiLain" menunjukkan berapa versi lama yang dikalahkan. ' +
          'Tanggal akhir tahun 2222 di master berarti TANPA BATAS AKHIR — jangan sebut "berlaku sampai 2222".' +
          (includeExpired ? '' : ' Hanya yang aktif hari ini yang ditampilkan.'),
        hargaKhusus: shown.map((r) => ({
          kodeItem: r.itemCode,
          item: r.itemName,
          hargaKhusus: r.specialPrice,
          hargaReguler: r.regulerPrice,
          diskonPersen: r.diskonPersen,
          kategoriHarga: categoryLabel(r.priceCategory, kategori),
          kodeKategori: r.priceCategory,
          status: r.status,
          masaBerlaku: r.masaBerlaku,
          versiLain: r.versiLain
        })),
        mataUang: 'IDR'
      })
    }
  },
  {
    name: 'inno_item_special_price',
    label: 'Customers with Special Price',
    description:
      'Kebalikan dari inno_special_price: menampilkan PELANGGAN MANA SAJA yang punya harga khusus ' +
      'untuk SATU item. Pakai untuk "siapa saja yang dapat harga khusus untuk pemeriksaan X", ' +
      '"berapa harga khusus terendah untuk X".',
    parameters: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'Kode item persis, atau sebagian nama pemeriksaan' },
        limit: { type: 'number', description: 'Jumlah baris (default 20, maks 50)' }
      },
      required: ['item']
    },
    tier: 'read',
    timeoutMs: 60_000,
    summarize: (a) => `Customers with special price: ${a.item}`,
    execute: async (args) => {
      guard()
      const keyword = requiredText(args, 'item', 'item')
      const today = jakartaToday()

      // Item dipastikan dulu ke satu kode — filter LIKE langsung ke m_special_price
      // (190 ribu baris) tidak memakai index dan pernah menggantung >16 menit.
      const items = await innoQuery<{ item_code: string; item_name: string }>(
        `SELECT item_code, item_name FROM m_item
         WHERE ${alive('m_item')} AND (item_code = ? OR item_name ILIKE ? OR item_code_lis = ?)
         ORDER BY (item_code = ?) DESC, char_length(item_name) LIMIT 8`,
        [keyword, likeParam(keyword), keyword, keyword]
      )
      if (items.length === 0) {
        throw new ToolError(`item "${keyword}" tidak ditemukan di master item yang aktif`)
      }
      if (items.length > 1 && items[0].item_code !== keyword) {
        throw new ToolError(
          `"${keyword}" cocok ke ${items.length} item. Sebutkan yang mana (pakai kode item). Kandidat: ` +
            items.map((i) => `${i.item_code} — ${i.item_name}`).join(' | ')
        )
      }
      const item = items[0]

      const rows = await innoQuery<Record<string, any>>(
        `SELECT sp.customer_code, mc.customer_name, mc.customer_type, sp.price_category,
                sp.special_price, sp.reguler_price, sp.start_date, sp.end_date
         FROM m_special_price sp
         LEFT JOIN m_customer mc ON mc.customer_code = sp.customer_code AND ${alive('mc')}
         WHERE sp.item_code = ? AND sp.deleted_at IS NULL
         LIMIT 400`,
        [item.item_code]
      )
      const kategori = await loadPriceCategories()
      const aktif = rows
        .map((r) => ({
          kodePelanggan: r.customer_code,
          pelanggan: r.customer_name ?? '(tidak ada di master pelanggan aktif)',
          tipe: customerTypeLabel(r.customer_type),
          hargaKhusus: r.special_price === null ? null : Number(r.special_price),
          hargaReguler: r.reguler_price === null ? null : Number(r.reguler_price),
          kategoriHarga: categoryLabel(r.price_category, kategori),
          status: validityOf(r.start_date, r.end_date, today),
          masaBerlaku: validityLabel(r.start_date, r.end_date, today)
        }))
        .filter((r) => r.status === 'aktif')
        .sort((a, b) => (a.hargaKhusus ?? 0) - (b.hargaKhusus ?? 0))

      return JSON.stringify({
        item: { kode: item.item_code, nama: item.item_name },
        tanggalAcuan: today,
        jumlahPelangganAktif: aktif.length,
        catatan:
          'Hanya harga khusus yang aktif hari ini. Diurutkan dari harga terendah. ' +
          'Satu pelanggan bisa muncul lebih dari sekali bila punya harga di KATEGORI berbeda ' +
          '(mis. Special Price dan BPJS/PMK3) — sebutkan kategorinya. ' +
          'Pelanggan yang tidak ada di master aktif ditandai apa adanya, tidak ditebak.',
        pelanggan: aktif.slice(0, limitOf(args, 20)),
        mataUang: 'IDR'
      })
    }
  },
  {
    name: 'inno_pks',
    label: 'Customer Agreement (PKS)',
    description:
      'Perjanjian Kerja Sama (PKS) milik pelanggan: apakah ada, nomornya, masa berlaku, termin pembayaran. ' +
      'Pakai untuk "apakah RS X sudah ada PKS", "PKS-nya berlaku sampai kapan", "PKS mana yang akan habis".',
    parameters: {
      type: 'object',
      properties: {
        customer: { type: 'string', description: 'Nama pelanggan (sebagian boleh) ATAU kode pelanggan' },
        limit: { type: 'number', description: 'Jumlah baris (default 10, maks 50)' }
      },
      required: ['customer']
    },
    tier: 'read',
    timeoutMs: 45_000,
    summarize: (a) => `PKS: ${a.customer}`,
    execute: async (args) => {
      guard()
      const keyword = requiredText(args, 'customer', 'customer')
      const customer = await resolveOneCustomer(keyword)
      const today = jakartaToday()
      const rows = await innoQuery<Record<string, any>>(
        `SELECT trx_no, trx_date, trx_end_date, customer_name, term_of_payment,
                payment_method, invoicing, is_pks, is_voucher, is_package, remarks
         FROM t_pks
         WHERE customer_code = ? AND status = '5' AND deleted_at IS NULL
         ORDER BY trx_date DESC
         LIMIT ${limitOf(args, 10)}`,
        [customer.customer_code]
      )
      return JSON.stringify({
        pelanggan: shapeCustomer(customer),
        tanggalAcuan: today,
        adaPKS: rows.length > 0,
        jumlah: rows.length,
        catatan:
          rows.length === 0
            ? 'Tidak ada PKS berstatus disetujui (status=5) untuk pelanggan ini. Bisa berarti memang belum ada, ' +
              'atau PKS-nya masih dalam proses persetujuan — katakan apa adanya, jangan disimpulkan lebih jauh.'
            : 'Tanggal akhir tahun 2222 berarti TANPA BATAS AKHIR (perpanjangan otomatis), bukan berlaku sampai 2222.',
        pks: rows.map((r) => ({
          nomor: r.trx_no,
          mulai: r.trx_date ? String(r.trx_date).slice(0, 10) : null,
          berakhir: isOpenEnded(r.trx_end_date)
            ? 'tanpa batas akhir'
            : String(r.trx_end_date).slice(0, 10),
          status: validityOf(r.trx_date, r.trx_end_date, today),
          masaBerlaku: validityLabel(r.trx_date, r.trx_end_date, today),
          terminPembayaranHari: r.term_of_payment,
          metodePembayaran: r.payment_method,
          penagihan: r.invoicing
        }))
      })
    }
  },
  {
    name: 'inno_clinician_search',
    label: 'Search Doctors',
    description:
      'Mencari dokter/klinisi yang terdaftar di master. Pakai untuk "apakah dr. X terdaftar", ' +
      '"kode dokter untuk dr. Y", "berapa dokter yang terdaftar".',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Sebagian nama dokter, atau kode dokter persis' },
        limit: { type: 'number', description: 'Jumlah hasil (default 10, maks 50)' }
      },
      required: ['keyword']
    },
    tier: 'read',
    timeoutMs: 45_000,
    summarize: (a) => `Search doctors: ${a.keyword}`,
    execute: async (args) => {
      guard()
      const keyword = typeof args.keyword === 'string' ? args.keyword.trim() : ''
      const jenis = jenisItemDari(args.jenis)
      const lab = labDari(args.lab)
      const kelompok = kelompokHargaDari(args.kelompokHarga)
      const grup = typeof args.grup === 'string' ? args.grup.trim() : ''

      // Kata penyaring yang TIDAK dikenali ditolak, bukan diabaikan diam-diam.
      // Kalau diabaikan, user meminta "item paket" lalu menerima SELURUH item —
      // jawabannya terlihat wajar dan salahnya tidak ketahuan siapa pun.
      const pemeriksaan: Array<[unknown, string | null, string, string]> = [
        [args.jenis, jenis, 'jenis', 'paket / profile / single (atau K/P/U)'],
        [args.lab, lab, 'lab', 'PK / PA / MB'],
        [args.kelompokHarga, kelompok, 'kelompokHarga', 'RP / CC (C Coret) / SB (Segitiga Bertanda)']
      ]
      for (const [nilaiAsli, hasil, label, sah] of pemeriksaan) {
        if (typeof nilaiAsli === 'string' && nilaiAsli.trim() && hasil === null) {
          throw new ToolError(`nilai "${nilaiAsli}" tidak dikenal untuk ${label} — yang sah: ${sah}`)
        }
      }
      if (!keyword && !jenis && !lab && !kelompok && !grup) {
        throw new ToolError(
          'isi minimal satu: keyword, jenis, lab, grup, atau kelompokHarga — master item terlalu ' +
            'besar untuk ditampilkan seluruhnya'
        )
      }

      const like = likeParam(keyword)
      const syarat: string[] = []
      const params: unknown[] = []
      if (keyword) {
        syarat.push(
          '(i.item_name ILIKE ? OR i.item_code = ? OR i.item_code_lis = ?' +
            ' OR i.item_name_alias ILIKE ? OR i.item_name_eng ILIKE ?)'
        )
        params.push(like, keyword, keyword, like, like)
      }
      if (jenis) {
        syarat.push('i.item_type = ?')
        params.push(jenis)
      }
      if (lab) {
        syarat.push('i.lab_code = ?')
        params.push(lab)
      }
      if (kelompok) {
        syarat.push('i.price_group_code = ?')
        params.push(kelompok)
      }
      if (grup) {
        syarat.push('(i.group_code = ? OR g.description ILIKE ?)')
        params.push(grup, likeParam(grup))
      }
      // Kolom email & phone dokter SENGAJA tidak diambil: itu data pribadi
      // perorangan, dan pertanyaan "dokter terdaftar" tidak membutuhkannya.
      const rows = await innoQuery<Record<string, any>>(
        `SELECT code, code_lis, name, is_patologist, code_specialist
         FROM m_clinician
         WHERE status = '5' AND deleted_at IS NULL
           AND (name ILIKE ? OR code = ? OR code_lis = ?)
         ORDER BY char_length(name), name
         LIMIT ${limitOf(args, 10)}`,
        [like, keyword, keyword]
      )
      return JSON.stringify({
        pencarian: keyword,
        jumlah: rows.length,
        catatan:
          'Hanya dokter berstatus disetujui & belum dihapus. Email dan nomor telepon dokter tidak ' +
          'dikeluarkan oleh tool ini (data pribadi). Kode spesialisasi ditampilkan apa adanya — ' +
          'tabel master spesialisasi di database masih kosong, jadi artinya tidak ditebak.',
        dokter: rows.map((r) => ({
          kode: r.code,
          kodeLis: r.code_lis,
          nama: r.name,
          patologis: r.is_patologist === 1,
          kodeSpesialisasi: r.code_specialist
        }))
      })
    }
  },
  {
    name: 'inno_item_package',
    label: 'Test Package Contents',
    description:
      'Menampilkan ISI sebuah paket pemeriksaan — pemeriksaan apa saja yang tercakup di dalamnya. ' +
      'Pakai untuk "paket X isinya apa saja", "apa saja yang termasuk dalam paket MCU Y", ' +
      '"berapa item di paket Z". Terima nama paket atau kode itemnya. Tiap isi ditandai LAB atau ' +
      'NON LAB.',
    parameters: {
      type: 'object',
      properties: {
        paket: {
          type: 'string',
          description: 'Nama paket (sebagian) atau kode item paketnya persis'
        },
        limit: { type: 'number', description: 'Jumlah isi yang ditampilkan (default 50, maks 50)' }
      },
      required: ['paket']
    },
    tier: 'read',
    timeoutMs: 45_000,
    summarize: (a) => `Package contents: ${a.paket}`,
    execute: async (args) => {
      guard()
      const cari = requiredText(args, 'paket', 'paket')
      const like = likeParam(cari)

      // Induk paket dicari dulu jadi SATU kode — pola yang sama dengan pencarian
      // pelanggan: nama paket ambigu, dan menebak salah satunya berarti
      // menampilkan isi paket yang bukan diminta tanpa ada yang tahu.
      //
      // ⚠️ Pencarian TIDAK dibatasi item_type = 'K'. Terukur 21 Agu 2026: dari 457
      // induk paket di m_item_package, hanya 325 yang ber-item_type 'K' — 127 kode
      // induknya bahkan tidak ada di master item aktif, 3 ber-type P, 2 ber-type U.
      // Membatasi ke 'K' berarti sebagian paket yang benar-benar punya isi akan
      // dijawab "tidak ada", padahal datanya ada.
      const kandidat = await innoQuery<Record<string, any>>(
        `SELECT i.item_code, i.item_name, i.item_type, i.lab_code
           FROM m_item i
          WHERE ${alive('i')}
            AND (i.item_name ILIKE ? OR i.item_code = ? OR i.item_code_lis = ?
                 OR i.item_name_alias ILIKE ?)
            AND EXISTS (
              SELECT 1 FROM m_item_package p
               WHERE p.item_code_main = i.item_code AND p.deleted_at IS NULL
            )
          ORDER BY (i.item_code = ?) DESC, char_length(i.item_name), i.item_name
          LIMIT 10`,
        [like, cari, cari, like, cari]
      )

      if (kandidat.length === 0) {
        // Bisa jadi kodenya memang induk paket tapi tidak ada di master item aktif
        // (127 kode seperti itu). Jangan langsung bilang "tidak ada".
        const langsung = await innoQuery<Record<string, any>>(
          `SELECT DISTINCT p.item_code_main FROM m_item_package p
            WHERE p.deleted_at IS NULL AND p.item_code_main = ? LIMIT 1`,
          [cari]
        )
        if (langsung.length === 0) {
          return JSON.stringify({
            paketDicari: cari,
            ditemukan: false,
            catatanHasil:
              'Tidak ada paket dengan nama/kode itu yang punya isi terdaftar. Mungkin namanya ' +
              'berbeda di master, atau item itu bukan paket. Coba inno_item_search dengan ' +
              'jenis="paket" untuk melihat daftar paket yang ada. JANGAN mengarang isinya.'
          })
        }
        kandidat.push({
          item_code: cari,
          item_name: '(induk paket tidak terdaftar di master item aktif)',
          item_type: null,
          lab_code: null
        })
      }

      if (kandidat.length > 1) {
        return JSON.stringify({
          paketDicari: cari,
          ditemukan: false,
          perluDipilih: true,
          kandidat: kandidat.map((k) => ({
            kode: k.item_code,
            nama: k.item_name,
            jenis: labelJenisItem(k.item_type),
            lab: labelLab(k.lab_code)
          })),
          catatanHasil:
            'Nama paket cocok ke lebih dari satu item. TANYAKAN ke user mana yang dimaksud, ' +
            'lalu panggil ulang dengan KODE itemnya. Jangan memilih sendiri.'
        })
      }

      const induk = kandidat[0]
      const isi = await innoQuery<Record<string, any>>(
        `SELECT p.item_code_child, p.is_non_lab,
                c.item_name, c.lab_code, c.item_type, c.group_code,
                g.description AS grup_nama
           FROM m_item_package p
           LEFT JOIN m_item c ON c.item_code = p.item_code_child AND c.deleted_at IS NULL
           LEFT JOIN m_item_group g ON g.code = c.group_code AND g.deleted_at IS NULL
          WHERE p.deleted_at IS NULL AND p.item_code_main = ?
          ORDER BY (p.is_non_lab = '1'), c.item_name
          LIMIT ${limitOf(args, 50)}`,
        [induk.item_code]
      )

      const [hitung] = await innoQuery<Record<string, any>>(
        `SELECT count(*) AS total,
                sum(CASE WHEN is_non_lab = '1' THEN 1 ELSE 0 END) AS non_lab
           FROM m_item_package
          WHERE deleted_at IS NULL AND item_code_main = ?`,
        [induk.item_code]
      )
      const total = Number(hitung?.total ?? 0)
      const nonLab = Number(hitung?.non_lab ?? 0)

      return JSON.stringify({
        ditemukan: true,
        paket: {
          kode: induk.item_code,
          nama: induk.item_name,
          jenis: labelJenisItem(induk.item_type),
          lab: labelLab(induk.lab_code)
        },
        jumlahIsi: total,
        jumlahLab: total - nonLab,
        jumlahNonLab: nonLab,
        ditampilkan: isi.length,
        isi: isi.map((r) => ({
          kode: r.item_code_child,
          nama: r.item_name ?? '(tidak terdaftar di master item aktif)',
          lab: labelLab(r.lab_code),
          jenis: labelJenisItem(r.item_type),
          grup: r.grup_nama ? `${r.grup_nama} (${r.group_code})` : r.group_code || null,
          kategori: String(r.is_non_lab) === '1' ? 'NON LAB' : 'LAB'
        })),
        // Hasil tool tidak boleh diam soal kelengkapannya — kalau sebagian isi
        // tidak ditampilkan, model akan mengarang jumlahnya.
        catatanHasil:
          (isi.length < total
            ? `Ditampilkan ${isi.length} dari ${total} isi paket; sisanya belum ditampilkan — ` +
              'naikkan parameter limit bila user meminta daftar lengkap. '
            : `Seluruh ${total} isi paket ditampilkan. `) +
          `Terdiri dari ${total - nonLab} pemeriksaan LAB dan ${nonLab} item NON LAB ` +
          '(non-lab mis. jasa/pemeriksaan penunjang di luar laboratorium). ' +
          'Isi paket TIDAK memuat harga; harga yang berlaku adalah harga PAKETNYA, bukan ' +
          'penjumlahan harga isinya — jangan menjumlahkan sendiri.'
      })
    }
  }
]
