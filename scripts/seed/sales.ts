// Synthetic SalesRepository + its master tables. Fictional customers and doctors; generic test names.
// Rows are arrays in the column order of ddl.ts.
import type { Rng } from './prng'

export interface OrderIdOrder {
  orderIdId: string
  dateReceived: string
  customerName: string
  payerName: string
  priceType: string
  cancelled: boolean
  tests: { itemCode: string; test: string; source: string; dateResult: string | null }[]
}

export interface SalesData {
  provinces: unknown[][]
  cities: unknown[][]
  customers: unknown[][]
  items: unknown[][]
  sales: unknown[][]
  orderIdOrders: OrderIdOrder[]
}

export const ERP_BRIDGING_START = '2025-12-01'
/** Lines received from here on may never get a result (fixed date, so it does not move with --until). */
export const STUCK_FROM = '2026-08-01'

const PROVINCES: [string, string, string[]][] = [
  ['31', 'DKI Jakarta', ['Jakarta Selatan', 'Jakarta Pusat', 'Jakarta Barat', 'Jakarta Timur']],
  ['32', 'Jawa Barat', ['Bandung', 'Bekasi', 'Bogor', 'Depok']],
  ['33', 'Jawa Tengah', ['Semarang', 'Surakarta']],
  ['34', 'DI Yogyakarta', ['Yogyakarta']],
  ['35', 'Jawa Timur', ['Surabaya', 'Malang']],
  ['36', 'Banten', ['Tangerang', 'Serang']],
  ['51', 'Bali', ['Denpasar']],
  ['12', 'Sumatera Utara', ['Medan']],
  ['73', 'Sulawesi Selatan', ['Makassar']],
  ['64', 'Kalimantan Timur', ['Balikpapan']]
]

/** [source, category code used by the lab tracker, tat days min, max, price min, max (IDR), weight] */
export const SOURCES: [string, string, number, number, number, number, number][] = [
  ['Histopathology', 'PA', 3, 7, 450_000, 1_800_000, 14],
  ['Immunohistochemistry', 'IHC', 4, 9, 900_000, 2_500_000, 8],
  ['Molecular', 'MOL', 5, 12, 2_500_000, 9_500_000, 9],
  ['HPV Testing', 'HPV DNA', 3, 8, 650_000, 1_600_000, 10],
  ['Cytology', 'LBC', 2, 6, 250_000, 700_000, 12],
  ['Clinical Pathology', 'PK', 0, 2, 60_000, 450_000, 30],
  ['Microbiology', 'MB', 2, 5, 150_000, 650_000, 9],
  ['Genomics', 'Genme', 14, 30, 3_500_000, 12_000_000, 3]
]

const TEST_NAMES: Record<string, string[]> = {
  Histopathology: ['Biopsy Small', 'Biopsy Medium', 'Biopsy Large', 'Frozen Section', 'Cell Block', 'Bone Marrow Biopsy', 'Excision Specimen', 'Second Opinion Slide Review', 'Radical Specimen', 'Endoscopy Biopsy', 'Skin Punch Biopsy', 'Prostate Core Biopsy', 'Lymph Node Excision', 'Gastric Biopsy', 'Colon Polyp'],
  Immunohistochemistry: ['ER', 'PR', 'HER2', 'Ki-67', 'PD-L1 22C3', 'CK7', 'CK20', 'TTF-1', 'p16', 'CD20', 'CD3', 'Synaptophysin', 'Chromogranin', 'ALK D5F3'],
  Molecular: ['EGFR Mutation', 'KRAS Mutation', 'NRAS Mutation', 'BRAF V600', 'ALLRAS Panel', 'IDH1-2', 'MGMT Methylation', 'MSI Analysis', 'POLE Mutation', 'BCR-ABL Quantitative', 'JAK2 V617F', 'HER2 FISH', 'ALK FISH', 'ROS1 Fusion', 'NGS Solid Tumor Panel'],
  'HPV Testing': ['HPV DNA High Risk', 'HPV Genotyping 14', 'HPV Genotyping 28', 'HPV mRNA E6/E7', 'HPV Self-Sampling'],
  Cytology: ['LBC (ThinPrep)', 'Pap Smear Conventional', 'FNAB Cytology', 'Body Fluid Cytology', 'Urine Cytology', 'Sputum Cytology', 'Co-testing LBC + HPV'],
  'Clinical Pathology': ['Complete Blood Count', 'HbA1c', 'Fasting Glucose', 'Lipid Profile', 'Creatinine', 'eGFR', 'SGOT', 'SGPT', 'Uric Acid', 'TSH', 'Free T4', 'Ferritin', 'CRP Quantitative', 'Procalcitonin', 'D-Dimer', 'Urinalysis', 'Electrolytes', 'Vitamin D 25-OH', 'PSA Total', 'CEA', 'CA 125', 'CA 15-3', 'AFP', 'Hepatitis B Surface Antigen', 'Anti-HCV', 'HIV Screening', 'Blood Group', 'PT/APTT', 'Albumin', 'Bilirubin Total', 'EKG Resting'],
  Microbiology: ['Blood Culture', 'Urine Culture', 'Sputum Culture', 'Wound Culture', 'Stool Culture', 'TB GeneXpert', 'AFB Smear', 'Fungal Culture', 'Antibiotic Susceptibility'],
  Genomics: ['Hereditary Cancer Panel', 'BRCA1/2 Full Gene', 'Nutrigenomics Panel', 'Pharmacogenomics Panel', 'Whole Exome Sequencing']
}

const CUSTOMER_BASE: [string, string, number][] = [
  // [name, type, weight]
  ['RS Harapan Sehat', 'RS', 10], ['RS Mitra Medika', 'RS', 9], ['RS Cahaya Bunda', 'RS', 7], ['RS Sentosa Prima', 'RS', 8],
  ['RS Permata Hati', 'RS', 6], ['RS Kasih Ibu Nusantara', 'RS', 6], ['RS Bakti Husada', 'RS', 5], ['RS Medika Utama', 'RS', 7],
  ['RS Pelita Insani', 'RS', 4], ['RS Graha Sehat', 'RS', 5], ['RS Anugerah Medical Center', 'RS', 5], ['RS Citra Husada', 'RS', 3],
  ['RS Bunda Mulia', 'RS', 4], ['RS Sehat Sejahtera', 'RS', 3], ['RS Taman Sari', 'RS', 3], ['RS Puri Medika', 'RS', 3],
  ['Klinik Medika Utama', 'KL', 3], ['Klinik Sehat Bersama', 'KL', 2], ['Klinik Pratama Sentosa', 'KL', 2], ['Klinik Onkologi Harmoni', 'KL', 3],
  ['Klinik Wanita Sejahtera', 'KL', 2], ['Klinik Utama Prima', 'KL', 2], ['Laboratorium Klinik Nusa', 'LB', 4], ['Laboratorium Medika Raya', 'LB', 3],
  ['Laboratorium Prima Diagnostika', 'LB', 2], ['PT Sinar Energi Nusantara', 'PH', 2], ['PT Mandala Logistik', 'PH', 1], ['PT Arunika Teknologi', 'PH', 1],
  ['Praktik dr. Hendra Wijaya, Sp.OG', 'DR', 1], ['Praktik dr. Ratna Sari, Sp.PD', 'DR', 1],
  ['Pasien Pribadi RS Harapan Sehat', 'PR', 3], ['Pasien Pribadi RS Mitra Medika', 'PR', 3], ['Pasien Pribadi RS Sentosa Prima', 'PR', 2],
  ['Pasien Pribadi Klinik Onkologi Harmoni', 'PR', 2], ['Pasien Pribadi RS Medika Utama', 'PR', 2], ['Walk-in Laboratorium', 'WA', 2],
  ['RS Sumber Waras Timur', 'RS', 2], ['RS Insan Medika', 'RS', 2]
]

/** Customers that stop ordering on this date — the "stopped customers" view has something to show. */
const CHURN: Record<string, string> = {
  'RS Taman Sari': '2026-05-15',
  'Klinik Utama Prima': '2026-03-01',
  'Laboratorium Prima Diagnostika': '2026-07-10',
  'Pasien Pribadi RS Sentosa Prima': '2026-04-20'
}

/** Customers that order but are missing from the master — the app labels them "(not in master)". */
const NOT_IN_MASTER: [string, number][] = [
  ['RS Baru Sejahtera', 1],
  ['Pasien Pribadi RS Baru Sejahtera', 1]
]

const DOCTOR_FIRST = ['Andi', 'Budi', 'Citra', 'Dewi', 'Eko', 'Fitri', 'Gita', 'Hadi', 'Indah', 'Joko', 'Kartika', 'Lukman', 'Maya', 'Nanda', 'Oki', 'Putri', 'Rizky', 'Sinta', 'Teguh', 'Wulan', 'Yusuf', 'Zahra']
const DOCTOR_LAST = ['Pratama', 'Wijaya', 'Santoso', 'Kusuma', 'Halim', 'Saputra', 'Lestari', 'Nugroho', 'Hidayat', 'Permana', 'Utami', 'Setiawan']
const SPECIALTIES = ['Sp.PA', 'Sp.OG', 'Sp.B', 'Sp.PD', 'Sp.PD-KHOM', 'Sp.P', 'Sp.U', 'Sp.A', 'Sp.BS', 'Sp.Onk.Rad']
const INSURERS = ['Asuransi Sehat Bersama', 'Asuransi Medika Nusantara', 'Asuransi Jiwa Sentosa']
const HOLIDAYS = new Set([
  '2025-01-01', '2025-01-29', '2025-03-31', '2025-04-01', '2025-04-18', '2025-05-01', '2025-05-29', '2025-06-06',
  '2025-08-17', '2025-12-25', '2026-01-01', '2026-02-17', '2026-03-20', '2026-03-21', '2026-04-03', '2026-05-01',
  '2026-05-14', '2026-05-27', '2026-08-17', '2026-12-25'
])

export function ymd(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00`)
  d.setDate(d.getDate() + n)
  return ymd(d)
}

function at(day: string, hour: number, minute: number): Date {
  const d = new Date(`${day}T00:00:00`)
  d.setHours(hour, minute, 0, 0)
  return d
}

function weighted<T>(rng: Rng, xs: readonly T[], w: (x: T) => number): T {
  const total = xs.reduce((s, x) => s + w(x), 0)
  let r = rng.next() * total
  for (const x of xs) {
    r -= w(x)
    if (r <= 0) return x
  }
  return xs[xs.length - 1]
}

function orderIdId(rng: Rng, day: string, seq: number): string {
  const date = `${day.slice(2, 4)}${day.slice(5, 7)}${day.slice(8, 10)}`
  const r = rng.next()
  if (r < 0.03) return `KG${date}${String(seq).padStart(4, '0')}`
  // 9 digits + ".05." — a real-world format the status check must accept as typed.
  if (r < 0.04) return `${date}${String(seq).padStart(3, '0')}.05.`
  return `${date}${String(seq).padStart(4, '0')}`
}

export function generateSales(rng: Rng, from: Date, until: Date): SalesData {
  const provinces = PROVINCES.map(([id, name]) => [id, name])
  const cities: unknown[][] = []
  const cityList: { id: string; province: string; name: string }[] = []
  for (const [pid, , names] of PROVINCES) {
    names.forEach((n, i) => {
      const id = `${pid}${String(i + 1).padStart(2, '0')}`
      cities.push([id, pid, n])
      cityList.push({ id, province: pid, name: n })
    })
  }

  // Customers (+3 duplicated codes: an older inactive row with the same code).
  const customers: unknown[][] = []
  const custInfo: { code: string; name: string; type: string; city: string; weight: number; stop?: string }[] = []
  CUSTOMER_BASE.forEach(([name, type, weight], i) => {
    const city = i < 12 ? cityList[i % 4] : rng.pick(cityList)
    const code = `C${String(1001 + i)}`
    custInfo.push({ code, name, type, city: city.name, weight, stop: CHURN[name] })
    customers.push([i + 1, code, name, type, city.id, city.province, true])
  })
  for (const i of [0, 3, 7]) {
    const c = customers[i]
    customers.push([customers.length + 1, c[1], `${c[2]} (old record)`, c[3], c[4], c[5], false])
  }
  NOT_IN_MASTER.forEach(([name, weight], i) => {
    custInfo.push({ code: `C${9001 + i}`, name, type: '', city: 'Jakarta Selatan', weight })
  })

  // Items (+3 duplicated codes).
  const items: unknown[][] = []
  const itemInfo: { code: string; name: string; source: string; category: string; price: number; tatMin: number; tatMax: number; weight: number }[] = []
  for (const [source, category, tatMin, tatMax, pMin, pMax, sWeight] of SOURCES) {
    const names = TEST_NAMES[source]
    names.forEach((name, i) => {
      const code = `${category.replace(/\s/g, '').slice(0, 3).toUpperCase()}${String(101 + i)}`
      const price = Math.round((pMin + rng.next() * (pMax - pMin)) / 5000) * 5000
      itemInfo.push({ code, name, source, category, price, tatMin, tatMax, weight: sWeight / names.length * (i < 3 ? 2 : 1) })
      items.push([items.length + 1, code, name, '5'])
    })
  }
  for (const i of [0, 20, 40]) {
    const it = items[i]
    items.push([items.length + 1, it[1], `${it[2]} (old name)`, '0'])
  }

  const doctors = Array.from({ length: 60 }, (_, i) =>
    `dr. ${DOCTOR_FIRST[i % DOCTOR_FIRST.length]} ${DOCTOR_LAST[(i * 7) % DOCTOR_LAST.length]}, ${SPECIALTIES[i % SPECIALTIES.length]}`
  )

  const sales: unknown[][] = []
  const orderIdOrders: OrderIdOrder[] = []
  const untilDay = ymd(until)
  /** Per month: target cancel share and running counts, so the share lands on target (3–8%). */
  const monthCancel = new Map<string, { rate: number; lines: number; cancelled: number }>()
  let id = 1
  let invoiceSeq = 1

  for (let day = ymd(from); day <= untilDay; day = addDays(day, 1)) {
    const d = new Date(`${day}T00:00:00`)
    const monthsIn = (d.getFullYear() - from.getFullYear()) * 12 + d.getMonth() - from.getMonth()
    const dow = d.getDay()
    let orders = 61 * Math.pow(1.035, monthsIn)
    if (dow === 0) orders *= 0.02
    else if (dow === 6) orders *= 0.45
    if (HOLIDAYS.has(day)) orders *= 0.08
    const nOrders = Math.max(0, Math.round(rng.normal(orders, orders * 0.12)))
    const month = day.slice(0, 7)
    if (!monthCancel.has(month)) monthCancel.set(month, { rate: 0.035 + rng.next() * 0.035, lines: 0, cancelled: 0 })
    const mc = monthCancel.get(month)!

    for (let o = 0; o < nOrders; o++) {
      const createdAt = at(day, rng.int(7, 17), rng.int(0, 59))
      if (createdAt.getTime() > until.getTime()) continue
      const cust = weighted(rng, custInfo, (c) => (c.stop && day >= c.stop ? 0 : c.weight))
      const kid = orderIdId(rng, day, o + 1)
      const doctor = rng.pick(doctors)
      const payerType = cust.type === 'PR' || cust.type === 'WA' ? 'Personal' : rng.chance(0.15) ? 'Insurance' : 'Corporate'
      const payerName = payerType === 'Insurance' ? rng.pick(INSURERS) : cust.name
      const priceType = cust.type === 'PR' ? 'Special' : rng.chance(0.1) ? 'Voucher' : 'Regular'
      const paymentMethod = payerType === 'Personal' ? rng.pick(['Cash', 'Debit Card', 'Transfer']) : 'Credit'
      const branch = cust.city.startsWith('Surabaya') || cust.city === 'Malang' ? 'SBY' : cust.city === 'Bandung' ? 'BDG' : 'JKT'
      const nTests = rng.chance(0.25) ? rng.int(2, 3) : 1
      const cancelled = mc.cancelled + nTests <= mc.rate * (mc.lines + nTests) && rng.chance(0.7)
      mc.lines += nTests
      if (cancelled) mc.cancelled += nTests
      const order: OrderIdOrder = { orderIdId: kid, dateReceived: day, customerName: cust.name, payerName, priceType, cancelled, tests: [] }

      for (let t = 0; t < nTests; t++) {
        const item = weighted(rng, itemInfo, (x) => x.weight)
        const tat = rng.int(item.tatMin, item.tatMax)
        // The lab does not release results on Sundays: those slide to Monday.
        const rawResultDay = addDays(day, tat)
        const resultDay = new Date(`${rawResultDay}T00:00:00`).getDay() === 0 ? addDays(rawResultDay, 1) : rawResultDay
        const resultAt = at(resultDay, rng.int(9, 18), rng.int(0, 59))
        // Every random draw happens unconditionally, so the stream — and all history — does not depend
        // on --until (a draw skipped by a condition shifts every later row).
        const r = {
          stuck: rng.next(), both: rng.next(), first: rng.next(), cancelH: rng.int(1, 48),
          to1: rng.next(), to2: rng.next(), res1: rng.next(), res2: rng.next()
        }
        // ~0.4% of lines since STUCK_FROM never got a result: an older month's backlog is not always zero
        // (tat-live-check), but there is no year-old pile either.
        const stuck = day >= STUCK_FROM && r.stuck < 0.004
        const dateResult = !stuck && resultAt.getTime() <= until.getTime() ? resultDay : null
        const gross = item.price
        const discount = priceType === 'Special' ? Math.round(gross * 0.15) : priceType === 'Voucher' ? Math.round(gross * 0.3) : 0
        const both = cancelled && day < '2025-07-01' && r.both < 0.08
        const firstMarker = cancelled && (both || r.first < 0.5)
        const cancelAt = cancelled ? new Date(createdAt.getTime() + r.cancelH * 3600_000) : null
        const bridged = day >= ERP_BRIDGING_START
        const statusTo = bridged ? (r.to1 < 0.93 ? 'SUCCESS' : r.to2 < 0.5 ? 'FAILED' : 'PENDING') : null
        const statusResult = bridged && dateResult ? (r.res1 < 0.9 ? 'SUCCESS' : r.res2 < 0.4 ? 'FAILED' : 'PENDING') : null
        const basis = dateResult ?? day
        const updatedAt = dateResult ? resultAt : createdAt
        sales.push([
          id++,
          dateResult ? `INV/${basis.slice(0, 4)}/${String(invoiceSeq++).padStart(6, '0')}` : null,
          kid,
          day,
          dateResult,
          cust.code,
          cust.name,
          item.code,
          item.name,
          item.source,
          1,
          gross,
          discount,
          gross - discount,
          Number(basis.slice(5, 7)),
          Number(basis.slice(0, 4)),
          doctor,
          payerName,
          payerType,
          paymentMethod,
          priceType,
          branch,
          cust.city,
          firstMarker ? cancelAt : null,
          cancelled && (both || !firstMarker) ? cancelAt : null,
          statusTo,
          statusResult,
          createdAt,
          updatedAt
        ])
        order.tests.push({ itemCode: item.code, test: item.name, source: item.source, dateResult })
      }
      orderIdOrders.push(order)
    }
  }

  return { provinces, cities, customers, items, sales, orderIdOrders }
}
