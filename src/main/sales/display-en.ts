// Display-only English wording (kept outside src/main/visual so the English-UI scan does not flag its Indonesian lookup keys)
// Display-only English wording for values that come from the data tools in Indonesian
// (period labels, dimension names, master-data labels). MURNI: unknown text passes through
// unchanged, so a tool that is already English (or a customer/item name) is never altered.

const BULAN_ID = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember']
const BULAN_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Indonesian month name (any case, full or abbreviated) -> English 3-letter label. Unknown -> first 3 letters. */
export function bulanSingkat(nama: string): string {
  const k = nama.trim().toLowerCase()
  const i = BULAN_ID.findIndex((b) => b === k || b.slice(0, 3) === k.slice(0, 3))
  if (i >= 0) return BULAN_EN[i].slice(0, 3)
  return nama.slice(0, 3)
}

function bulanPenuh(nama: string): string {
  const i = BULAN_ID.indexOf(nama.trim().toLowerCase())
  return i >= 0 ? BULAN_EN[i] : nama
}

const PERIODE: Record<string, string> = {
  'hari ini': 'today',
  kemarin: 'yesterday',
  'minggu ini': 'this week',
  'minggu lalu': 'last week',
  'bulan ini': 'this month',
  'bulan lalu': 'last month',
  '7 hari terakhir': 'last 7 days',
  '30 hari terakhir': 'last 30 days'
}

/** Period label from the sales tools ("bulan ini", "2026-09-01 s/d 2026-09-29", "YTD 2026 (Januari–September 29)"). */
export function labelPeriode(label: string): string {
  const s = String(label)
  const tepat = PERIODE[s.trim().toLowerCase()]
  if (tepat) return tepat
  return s
    .replace(/^tahun (\d{4})$/i, 'year $1')
    .replace(/ s\/d /g, ' to ')
    .replace(/^(\d+) hari sebelumnya/i, 'previous $1 days')
    .replace(/\((\d+) hari pertama, disamakan dengan periode berjalan\)/i, '(first $1 days, matched to the current period)')
    .replace(/\((\p{L}+)–/u, (_m, b: string) => `(${bulanPenuh(b)}–`)
    .replace(/^(bulan ini|bulan lalu|minggu ini|minggu lalu)\b/i, (m) => PERIODE[m.toLowerCase()] ?? m)
}

const DIMENSI: Record<string, string> = {
  'jenis pemeriksaan': 'test type',
  'kode item': 'item code',
  'pelanggan/instansi': 'customer/institution',
  'kategori layanan': 'service category',
  cabang: 'branch',
  penjamin: 'payer',
  'tipe penjamin': 'payer type',
  'kota pada transaksi (teks bebas, penulisan tidak konsisten)': 'city on the transaction (free text, inconsistent spelling)',
  'dokter pengirim': 'referring doctor',
  'tipe harga': 'price type',
  'metode pembayaran': 'payment method',
  'provinsi pelanggan': 'customer province',
  'kota/kabupaten pelanggan': 'customer city/regency',
  'tipe pelanggan': 'customer type',
  kategori: 'category',
  pelanggan: 'customer'
}

/** Name of a breakdown dimension as the sales tool labels it. */
export function labelDimensi(label: string): string {
  return DIMENSI[String(label).trim().toLowerCase()] ?? String(label)
}

const ARAH: Record<string, string> = { naik: 'Up', turun: 'Down', datar: 'Flat', baru: 'New', tumbuh: 'Growing', sama: 'Same' }

/** Trend direction word from the forecast tool. */
export function labelArah(v: unknown): string {
  const k = String(v ?? '').toLowerCase()
  return ARAH[k] ?? String(v ?? '—')
}

const DATA: Record<string, string> = {
  paket: 'Package',
  'single test': 'Single Test',
  profile: 'Profile',
  'patologi klinik': 'Clinical Pathology',
  'patologi anatomi': 'Anatomical Pathology',
  mikrobiologi: 'Microbiology',
  'rumah sakit': 'Hospital',
  klinik: 'Clinic',
  'pasien pribadi': 'Private Patient',
  laboratorium: 'Laboratory',
  dokter: 'Doctor',
  'perusahaan/korporat': 'Company/Corporate',
  lainnya: 'Other',
  'reguler price': 'Regular Price',
  'special price': 'Special Price',
  '(tidak diisi)': '(not filled in)',
  '(pelanggan tidak ada di master)': '(customer not in master)',
  '(provinsi tidak diisi)': '(province not filled in)',
  '(kota tidak diisi)': '(city not filled in)',
  '(tipe tidak diisi)': '(type not filled in)'
}

/**
 * Master-data label cell, matched as a WHOLE value (or "Label (CODE)") — never inside a longer
 * string, so customer and item names that happen to contain one of these words stay untouched.
 */
export function labelData(v: unknown): string {
  const s = v == null ? '' : String(v)
  const m = /^(.*?)( \([A-Z0-9]{1,3}\))?$/.exec(s)
  const dasar = m ? m[1] : s
  const hasil = DATA[dasar.trim().toLowerCase()]
  if (hasil) return `${hasil}${m?.[2] ?? ''}`
  return s.replace(/\(tidak terdaftar artinya\)/, '(meaning not registered)')
}

/** "aktif · 2026-01-01 s/d 2026-12-31" / "aktif · mulai X, tanpa batas akhir" -> English. */
export function masaBerlaku(v: unknown): string {
  const s = v == null || v === '' ? '—' : String(v)
  return s
    .replace(/^aktif\b/, 'Active')
    .replace(/^kadaluarsa\b/, 'Expired')
    .replace(/^belum_mulai\b/, 'Not started')
    .replace(/ s\/d /g, ' to ')
    .replace(/ mulai (\S+?), tanpa batas akhir/, ' from $1, no end date')
    .replace('tanpa batas akhir', 'no end date')
    .replace('(tanpa tanggal mulai)', '(no start date)')
}
