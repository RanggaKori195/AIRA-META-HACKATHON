// Aturan pembacaan master data the lab. Murni (tanpa I/O) supaya ter-cover unit test:
// SQL hanya mengambil baris, seluruh penafsiran "mana yang berlaku" dihitung di sini.

/**
 * Tanggal sentinel "tidak ada batas akhir". Master memakai tahun 2222 untuk ini
 * (terverifikasi: 765 dari 1.062 PKS aktif dan mayoritas special price memakainya).
 * Menampilkannya apa adanya sebagai "berlaku sampai 30 Desember 2222" membuat
 * jawaban terlihat konyol dan menyesatkan.
 */
export const SENTINEL_YEAR = 2100

export function isOpenEnded(date: string | null | undefined): boolean {
  if (!date) return true
  const year = Number(String(date).slice(0, 4))
  return Number.isFinite(year) && year >= SENTINEL_YEAR
}

export type ValidityStatus = 'aktif' | 'belum_mulai' | 'kadaluarsa'

/** Status masa berlaku sebuah baris harga/PKS terhadap tanggal acuan. */
export function validityOf(
  start: string | null | undefined,
  end: string | null | undefined,
  today: string
): ValidityStatus {
  const startDay = start ? String(start).slice(0, 10) : null
  if (startDay && startDay > today) return 'belum_mulai'
  if (isOpenEnded(end)) return 'aktif'
  const endDay = String(end).slice(0, 10)
  return endDay < today ? 'kadaluarsa' : 'aktif'
}

/** Keterangan masa berlaku yang layak dibaca manusia. */
export function validityLabel(
  start: string | null | undefined,
  end: string | null | undefined,
  today: string
): string {
  const status = validityOf(start, end, today)
  const mulai = start ? String(start).slice(0, 10) : '(tanpa tanggal mulai)'
  if (isOpenEnded(end)) return `${status} · mulai ${mulai}, tanpa batas akhir`
  return `${status} · ${mulai} s/d ${String(end).slice(0, 10)}`
}

export interface PriceRow {
  itemCode: string
  itemName: string | null
  specialPrice: number | null
  regulerPrice: number | null
  priceCategory: string | null
  startDate: string | null
  endDate: string | null
}

export interface ResolvedPrice extends PriceRow {
  status: ValidityStatus
  masaBerlaku: string
  diskonPersen: number | null
  /** Jumlah baris lain untuk item yang sama yang dikalahkan baris ini. */
  versiLain: number
}

function discountPercent(reguler: number | null, special: number | null): number | null {
  if (!reguler || reguler <= 0 || special === null || special === undefined) return null
  return Math.round(((reguler - special) / reguler) * 1000) / 10
}

/**
 * Satu pelanggan bisa punya BEBERAPA baris untuk item yang sama — terverifikasi 693
 * pasangan. Contoh nyata: item JHOPAMOLSPT002 pada pelanggan 0112710002 punya
 * Rp 8.075.000 (mulai 2023-10-10) dan Rp 7.225.000 (mulai 2025-01-20), keduanya
 * tanpa batas akhir. Menampilkan dua-duanya membuat harga jadi ambigu, dan memilih
 * asal bisa membuat kutipan harga ke pelanggan salah.
 *
 * Aturan: yang berlaku adalah baris AKTIF dengan `start_date` PALING BARU. Baris
 * yang kalah tetap dihitung dan dilaporkan lewat `versiLain` supaya tidak ada yang
 * disembunyikan diam-diam.
 */
export function resolveActivePrices(rows: PriceRow[], today: string): ResolvedPrice[] {
  const byItem = new Map<string, PriceRow[]>()
  for (const row of rows) {
    const key = `${row.itemCode}|${row.priceCategory ?? ''}`
    const list = byItem.get(key)
    if (list) list.push(row)
    else byItem.set(key, [row])
  }

  const out: ResolvedPrice[] = []
  for (const list of byItem.values()) {
    const ranked = [...list].sort((a, b) => {
      const sa = validityOf(a.startDate, a.endDate, today) === 'aktif' ? 0 : 1
      const sb = validityOf(b.startDate, b.endDate, today) === 'aktif' ? 0 : 1
      if (sa !== sb) return sa - sb
      return String(b.startDate ?? '').localeCompare(String(a.startDate ?? ''))
    })
    const winner = ranked[0]
    out.push({
      ...winner,
      status: validityOf(winner.startDate, winner.endDate, today),
      masaBerlaku: validityLabel(winner.startDate, winner.endDate, today),
      diskonPersen: discountPercent(winner.regulerPrice, winner.specialPrice),
      versiLain: ranked.length - 1
    })
  }
  return out.sort((a, b) => (a.itemName ?? a.itemCode).localeCompare(b.itemName ?? b.itemCode))
}

/**
 * Beberapa KODE item berbeda bisa punya nama master yang identik — terverifikasi:
 * "ER KALDx" ada pada `JHOPAPATOTH173` dan `SBOPAPGEIHD001`, dua-duanya aktif dan
 * dua-duanya dimiliki pelanggan yang sama dengan harga sama. Tanpa penanda, hasilnya
 * terbaca seperti satu item yang tercetak dua kali (dan bisa disangka bug data).
 * Jebakan yang sama sudah pernah muncul di modul sales.
 */
export function disambiguateItems<T extends { itemCode: string; itemName: string | null }>(
  rows: T[]
): T[] {
  const count = new Map<string, number>()
  for (const r of rows) {
    const nama = r.itemName ?? ''
    if (nama) count.set(nama, (count.get(nama) ?? 0) + 1)
  }
  return rows.map((r) => {
    const nama = r.itemName ?? ''
    if (nama && (count.get(nama) ?? 0) > 1 && r.itemCode && nama !== r.itemCode) {
      return { ...r, itemName: `${nama} [${r.itemCode}]` }
    }
    return r
  })
}

/**
 * Arti kolom harga di `m_reguler_price`.
 *
 * ⚠️ HANYA k1 & k2 yang ditampilkan (ketentuan user 21 Agu 2026). k3 (BPJS)
 * sebelumnya ikut, sekarang tidak lagi — bukan karena kolomnya hilang, tapi
 * karena bukan harga yang dipakai bicara ke pelanggan. Terukur saat keputusan
 * diambil: k1 terisi pada 1.670 baris, k2 pada 1.663, k3 hanya 882 — jadi k3
 * juga yang paling sering kosong dan paling mudah disalahartikan sebagai
 * "harga tidak ada". k4–k7 tidak pernah ditampilkan karena artinya tidak pernah
 * dipastikan.
 */
export const REGULER_PRICE_COLUMNS = [
  { column: 'k1', label: 'B2B (Corporate)' },
  { column: 'k2', label: 'B2C' }
] as const

// --------------------------------------------------- pengenal item (21 Agu 2026)
//
// Semua peta di bawah ini memakai pola yang sama dengan CUSTOMER_TYPE_LABELS dan
// kategori harga: kode yang TIDAK dikenal ditampilkan apa adanya, tidak ditebak.
// Sudah terbukti perlu — kategori harga "5" ternyata Voucher dan tidak ada di
// master mana pun.

/** Jenis item di `m_item.item_type`. Terukur: U 1.057 · K 383 · P 158 · kosong 11. */
export const ITEM_TYPE_LABELS: Record<string, string> = {
  U: 'Single Test',
  K: 'Paket',
  P: 'Profile'
}

/** Laboratorium pemeriksa di `m_item.lab_code`. Terukur: PK 1.149 · PA 307 · MB 153. */
export const LAB_CODE_LABELS: Record<string, string> = {
  PK: 'Patologi Klinik',
  PA: 'Patologi Anatomi',
  MB: 'Mikrobiologi'
}

/**
 * Kelompok harga di `m_item.price_group_code` — dipakai tim marketing.
 *
 * ⚠️ Data memuat kode KEEMPAT yang tidak ada di ketentuan: `'0'` pada 307 item
 * (19% dari master), plus 2 item kosong. Terukur 21 Agu 2026: CC 549 · SB 400 ·
 * RP 351 · '0' 307 · null 2. Artinya TIDAK ditebak di sini; ia ditampilkan apa
 * adanya dan ditandai belum terdefinisi, supaya tidak diam-diam ikut terhitung
 * sebagai salah satu dari tiga kelompok yang sah.
 */
export const PRICE_GROUP_LABELS: Record<string, string> = {
  RP: 'Reguler Price',
  CC: 'C Coret',
  SB: 'Segitiga Bertanda'
}

function beriLabel(peta: Record<string, string>, kode: unknown): string | null {
  if (kode === null || kode === undefined || String(kode).trim() === '') return null
  const k = String(kode).trim().toUpperCase()
  return peta[k] ? `${peta[k]} (${k})` : `${k} (tidak terdaftar artinya)`
}

export const labelJenisItem = (kode: unknown): string | null => beriLabel(ITEM_TYPE_LABELS, kode)
export const labelLab = (kode: unknown): string | null => beriLabel(LAB_CODE_LABELS, kode)
export const labelKelompokHarga = (kode: unknown): string | null =>
  beriLabel(PRICE_GROUP_LABELS, kode)

/**
 * Menerjemahkan kata user jadi kode `item_type`.
 *
 * Dipakai supaya "pemeriksaan paket apa saja yang ada" tidak perlu user
 * menyebut huruf K. Model 27B tidak bisa diandalkan menghafal pemetaan kode di
 * prompt — ini pola yang sama dengan `applyBasisRule`: kata user dibaca kode.
 */
export function jenisItemDari(teks: unknown): string | null {
  if (typeof teks !== 'string') return null
  const t = teks.trim().toLowerCase()
  if (!t) return null
  if (t === 'u' || t === 'k' || t === 'p') return t.toUpperCase()
  if (/\bpaket\b|\bpackage\b/.test(t)) return 'K'
  if (/\bprofile?\b|\bprofil\b/.test(t)) return 'P'
  if (/single|satuan|tunggal/.test(t)) return 'U'
  return null
}

/** Menerjemahkan kata user jadi kode `lab_code`. */
export function labDari(teks: unknown): string | null {
  if (typeof teks !== 'string') return null
  const t = teks.trim().toLowerCase()
  if (!t) return null
  if (['pk', 'pa', 'mb'].includes(t)) return t.toUpperCase()
  if (/patologi\s*klinik|klinik(al)?\s*patolog/.test(t)) return 'PK'
  if (/patologi\s*anatomi|anatom/.test(t)) return 'PA'
  if (/mikro\s*bio|microbio/.test(t)) return 'MB'
  return null
}

/**
 * Menerjemahkan kata user jadi `price_group_code`.
 *
 * "C Coret" dan "Segitiga Bertanda" adalah istilah lisan tim marketing — user
 * hampir pasti mengetiknya begitu, bukan sebagai kode CC/SB.
 */
export function kelompokHargaDari(teks: unknown): string | null {
  if (typeof teks !== 'string') return null
  const t = teks.trim().toLowerCase()
  if (!t) return null
  if (['rp', 'cc', 'sb'].includes(t)) return t.toUpperCase()
  if (/c\s*-?\s*coret/.test(t)) return 'CC'
  if (/segitiga/.test(t)) return 'SB'
  if (/reguler|reguller|regular/.test(t)) return 'RP'
  return null
}

/** Tipe pelanggan di master Master Data (sama dengan yang dipakai modul sales). */
export const CUSTOMER_TYPE_LABELS: Record<string, string> = {
  RS: 'Rumah Sakit',
  KL: 'Klinik',
  PR: 'Pasien Pribadi',
  LB: 'Laboratorium',
  DR: 'Dokter',
  PH: 'Perusahaan/Korporat',
  WA: 'Walk-in',
  IN: 'Internal',
  OT: 'Lainnya'
}

export function customerTypeLabel(code: string | null | undefined): string {
  if (!code) return '(tidak diisi)'
  return CUSTOMER_TYPE_LABELS[code.toUpperCase()] ?? code
}
