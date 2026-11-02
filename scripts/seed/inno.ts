// Synthetic Master Data master data (schema `inno`): items, prices, customers, contracts, clinicians.
// Codes overlap the sales data so a test or customer can be looked up in both menus.
import type { Rng } from './prng'

type Rows = unknown[][]
export type InnoData = Record<
  | 'm_item'
  | 'm_item_group'
  | 'm_item_package'
  | 'm_customer'
  | 'm_clinician'
  | 'm_reguler_price'
  | 'm_special_price'
  | 'm_price_category'
  | 't_pks',
  Rows
>

const GROUPS: [string, string, string][] = [
  ['HEM', 'Hematology', 'PK'], ['CHE', 'Clinical Chemistry', 'PK'], ['IMM', 'Immunology', 'PK'], ['TUM', 'Tumor Markers', 'PK'],
  ['HIS', 'Histopathology', 'PA'], ['IHC', 'Immunohistochemistry', 'PA'], ['CYT', 'Cytology', 'PA'], ['MOL', 'Molecular Pathology', 'PA'],
  ['BAC', 'Bacteriology', 'MB'], ['MYC', 'Mycology', 'MB']
]
const CATEGORY_TO_GROUP: Record<string, string> = {
  PA: 'HIS', IHC: 'IHC', MOL: 'MOL', HPV: 'MOL', LBC: 'CYT', PK: 'CHE', MB: 'BAC', GEN: 'MOL'
}
const EXTRA_PANELS = ['Medical Check-Up Basic', 'Medical Check-Up Executive', 'Pre-Marital Panel', 'Diabetes Panel', 'Cardiac Risk Panel', 'Liver Function Panel', 'Kidney Function Panel', 'Thyroid Panel', 'Anemia Panel', 'Women Health Panel']
const CITIES: [string, string][] = [['3101', '31'], ['3102', '31'], ['3201', '32'], ['3301', '33'], ['3501', '35'], ['3601', '36'], ['5101', '51'], ['1201', '12']]
const NAME_PARTS_A = ['Harapan', 'Mitra', 'Cahaya', 'Sentosa', 'Permata', 'Kasih', 'Bakti', 'Medika', 'Pelita', 'Graha', 'Anugerah', 'Citra', 'Bunda', 'Sehat', 'Insan', 'Puri', 'Prima', 'Nusa', 'Arta', 'Mulia']
const NAME_PARTS_B = ['Sehat', 'Medika', 'Husada', 'Utama', 'Sejahtera', 'Insani', 'Bersama', 'Raya', 'Nusantara', 'Mandiri']
const TYPES: [string, string, number][] = [['RS', 'RS', 30], ['KL', 'Klinik', 20], ['LB', 'Laboratorium', 8], ['PH', 'PT', 8], ['DR', 'Praktik dr.', 6], ['PR', 'Pasien Pribadi RS', 28]]

function weighted<T>(rng: Rng, xs: readonly T[], w: (x: T) => number): T {
  const total = xs.reduce((s, x) => s + w(x), 0)
  let r = rng.next() * total
  for (const x of xs) {
    r -= w(x)
    if (r <= 0) return x
  }
  return xs[xs.length - 1]
}

const round5k = (n: number): number => Math.round(n / 5000) * 5000

export function generateInno(rng: Rng, salesCustomers: Rows, salesItems: Rows): InnoData {
  const m_item_group: Rows = GROUPS.map(([code, desc], i) => [i + 1, code, desc, 'LAB', null])

  // Items: every sales test (same code, status '5'), plus extra singles and panels.
  const m_item: Rows = []
  const m_reguler_price: Rows = []
  const itemCodes: { code: string; name: string; price: number; type: string }[] = []
  const seen = new Set<string>()
  const addItem = (code: string, name: string, type: string, lab: string, group: string, price: number): void => {
    const id = m_item.length + 1
    const pg = id % 15 === 0 ? '0' : weighted(rng, ['RP', 'CC', 'SB'] as const, (x) => (x === 'RP' ? 5 : x === 'CC' ? 3 : 1))
    const status = rng.chance(0.95) ? '5' : '1'
    m_item.push([id, code, `LIS${code}`, name, null, name, type, lab, group, `LA${group}`, pg, price, `${rng.int(1, 10)} days`, rng.chance(0.05), false, status, null, new Date('2026-06-01T10:00:00')])
    m_reguler_price.push([m_reguler_price.length + 1, code, price, round5k(price * 1.15), round5k(price * 0.9), null, null, null, null, '5', null, new Date('2026-06-01T10:00:00')])
    if (status === '5') itemCodes.push({ code, name, price, type })
  }
  for (const r of salesItems) {
    const code = String(r[1])
    if (seen.has(code) || r[3] !== '5') continue
    seen.add(code)
    const prefix = code.slice(0, 3)
    const cat = prefix === 'HPV' ? 'HPV' : prefix === 'GEN' ? 'GEN' : prefix === 'LBC' ? 'LBC' : prefix
    const lab = cat === 'PK' ? 'PK' : cat === 'MB' ? 'MB' : 'PA'
    addItem(code, String(r[2]), 'U', lab, CATEGORY_TO_GROUP[cat] ?? 'CHE', round5k(100_000 + rng.next() * 3_000_000))
  }
  for (let i = 0; m_item.length < 360; i++) {
    const [group, desc, lab] = rng.pick(GROUPS)
    addItem(`X${group}${String(100 + i)}`, `${desc} Test ${i + 1}`, 'U', lab, group, round5k(50_000 + rng.next() * 900_000))
  }
  // A duplicated item code with an older price row: exercises the "LIMIT 1, newest price" rule.
  m_reguler_price.push([m_reguler_price.length + 1, itemCodes[0].code, itemCodes[0].price * 0.8, null, null, null, null, null, null, '5', null, new Date('2025-01-01T10:00:00')])

  const m_item_package: Rows = []
  EXTRA_PANELS.forEach((name, i) => {
    const code = `PKG${String(101 + i)}`
    const type = i < 6 ? 'K' : 'P'
    addItem(code, name, type, 'PK', 'CHE', round5k(400_000 + rng.next() * 2_500_000))
    const singles = itemCodes.filter((x) => x.type === 'U')
    for (let k = 0; k < rng.int(4, 9); k++) {
      m_item_package.push([m_item_package.length + 1, code, rng.pick(singles).code, false, null])
    }
    if (rng.chance(0.4)) m_item_package.push([m_item_package.length + 1, code, 'NONLAB-CONSULT', true, null])
  })
  for (let i = 0; m_item.length < 400; i++) {
    const [group, desc, lab] = rng.pick(GROUPS)
    addItem(`Y${group}${String(100 + i)}`, `${desc} Profile ${i + 1}`, 'P', lab, group, round5k(300_000 + rng.next() * 1_500_000))
  }
  // Inactive (deleted) rows that live queries must ignore.
  m_item[5][16] = new Date('2026-02-01T00:00:00')

  // Customers: the sales customers first (same LIS codes), then generated ones.
  const m_customer: Rows = []
  const customerCodes: { code: string; name: string; type: string }[] = []
  const addCustomer = (codeLis: string, name: string, type: string): void => {
    const id = m_customer.length + 1
    const code = `0${String(11_000_000 + id * 37)}`
    const [city, prov] = rng.pick(CITIES)
    const status = rng.chance(0.93) ? '5' : '1'
    m_customer.push([id, code, codeLis, name, null, type, city, prov, rng.pick(['K1', 'K2']), type === 'PR' ? 'Cash' : 'Credit', type === 'PR' ? 'COD' : `${rng.pick([14, 30, 45])} days`, type === 'PR' ? 0 : rng.pick([14, 30, 45]), true, false, status, null])
    if (status === '5') customerCodes.push({ code, name, type })
  }
  const seenCust = new Set<string>()
  for (const r of salesCustomers) {
    if (seenCust.has(String(r[1])) || r[6] === false) continue
    seenCust.add(String(r[1]))
    addCustomer(String(r[1]), String(r[2]), String(r[3]))
  }
  for (let i = 0; m_customer.length < 600; i++) {
    const [type, prefix] = weighted(rng, TYPES, (t) => t[2])
    addCustomer(`G${String(5000 + i)}`, `${prefix} ${rng.pick(NAME_PARTS_A)} ${rng.pick(NAME_PARTS_B)} ${i + 1}`, type)
  }

  const m_price_category: Rows = [
    ['1', 'Special Price', null],
    ['2', 'BPJS', null],
    ['3', 'Contract Price', null],
    ['4', 'Promo', new Date('2025-06-01T00:00:00')]
  ]

  // Special prices: ~5 per institutional customer, some with two versions (old + current).
  const m_special_price: Rows = []
  const institutions = customerCodes.filter((c) => c.type !== 'PR' || rng.chance(0.3))
  for (const c of institutions) {
    const n = rng.int(2, 9)
    for (let k = 0; k < n && m_special_price.length < 3000; k++) {
      const it = rng.pick(itemCodes)
      const cat = weighted(rng, ['1', '2', '3', '5'] as const, (x) => (x === '1' ? 6 : 1))
      const special = round5k(it.price * (0.6 + rng.next() * 0.3))
      const versioned = rng.chance(0.1)
      if (versioned) {
        m_special_price.push([m_special_price.length + 1, c.code, it.code, it.name, cat, it.price, round5k(special * 1.1), '2025-01-01', '2025-12-31', '5', null])
      }
      const openEnded = rng.chance(0.4)
      m_special_price.push([m_special_price.length + 1, c.code, it.code, it.name, cat, it.price, special, versioned ? '2026-01-01' : '2025-06-01', openEnded ? '2222-12-30' : '2027-06-30', '5', null])
    }
  }

  const t_pks: Rows = []
  for (let i = 0; i < 150; i++) {
    const c = rng.pick(customerCodes.filter((x) => x.type !== 'PR'))
    const start = new Date(2025, rng.int(0, 20), rng.int(1, 28))
    const end = new Date(start)
    end.setFullYear(end.getFullYear() + rng.pick([1, 2]))
    const iso = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    t_pks.push([i + 1, `PKS/${start.getFullYear()}/${String(i + 1).padStart(4, '0')}`, iso(start), iso(end), c.code, c.name, rng.chance(0.9) ? '5' : '1', rng.pick(['Monthly', 'Per Transaction']), `${rng.pick([30, 45])} days`, 'Transfer', true, rng.chance(0.15), rng.chance(0.3), null, null])
  }

  const m_clinician: Rows = []
  const FIRST = ['Andi', 'Budi', 'Citra', 'Dewi', 'Eko', 'Fitri', 'Gita', 'Hadi', 'Indah', 'Joko', 'Kartika', 'Lukman', 'Maya', 'Nanda', 'Oki', 'Putri', 'Rizky', 'Sinta', 'Teguh', 'Wulan']
  const LAST = ['Pratama', 'Wijaya', 'Santoso', 'Kusuma', 'Halim', 'Saputra', 'Lestari', 'Nugroho', 'Hidayat', 'Permana', 'Utami', 'Setiawan', 'Gunawan', 'Siregar', 'Tanjung']
  for (let i = 0; i < 300; i++) {
    const pa = i % 12 === 0
    const name = `dr. ${FIRST[i % FIRST.length]} ${LAST[(i * 7 + Math.floor(i / 20)) % LAST.length]}${pa ? ', Sp.PA' : ''}`
    m_clinician.push([i + 1, `DR${String(1000 + i)}`, `LISDR${1000 + i}`, name, pa, pa ? 'SPPA' : rng.pick(['SPOG', 'SPPD', 'SPB', 'SPA', 'UMUM']), rng.chance(0.95) ? '5' : '1', null])
  }

  const data: InnoData = { m_item, m_item_group, m_item_package, m_customer, m_clinician, m_reguler_price, m_special_price, m_price_category, t_pks }
  // MariaDB flags are 0/1 numbers, not booleans.
  for (const rows of Object.values(data)) {
    for (const r of rows) for (let k = 0; k < r.length; k++) if (typeof r[k] === 'boolean') r[k] = r[k] ? 1 : 0
  }
  return data
}
