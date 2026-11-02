// Penerjemah hasil tool SALES -> kartu visual (29 Sep 2026).
//
// ⚠️ MURNI: hanya membaca JSON hasil tool, tidak menyentuh database. Angka yang
// tampil = angka yang dibaca model dari hasil yang sama, jadi teks jawaban dan
// kartu tidak mungkin berbeda sumber (aturan 49). Satu-satunya hitungan di sini
// adalah penjumlahan deret yang TAMPIL (total tren) — tidak ada persentase baru.
//
// ⚠️ Hasil galat (`{error: …}`) atau bentuk yang tidak dikenal -> null (tanpa
// kartu). Kartu yang salah bentuk lebih buruk daripada tidak ada kartu.

import type { KartuVisual, Panel, Sel } from '../../shared/visual'
import { reagentCard } from './reagent'
import { PENERJEMAH_LAB } from './lab'
import { PENERJEMAH_INNO } from './inno'
import { bulanSingkat, labelArah, labelDimensi, labelPeriode } from '../sales/display-en'

type J = Record<string, any>

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const angka = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null)

function persenSel(p: unknown): Sel {
  const n = angka(p)
  if (n === null) return null
  return { nilai: n, satuan: 'persen', arah: n > 0 ? 'naik' : n < 0 ? 'turun' : undefined }
}

/** Rupiah ringkas untuk catatan kartu ("IDR 102.3B"). */
function fmtRp(n: number): string {
  if (Math.abs(n) >= 1e9) return `IDR ${(n / 1e9).toLocaleString('en-US', { maximumFractionDigits: 1 })}B`
  if (Math.abs(n) >= 1e6) return `IDR ${(n / 1e6).toLocaleString('en-US', { maximumFractionDigits: 0 })}M`
  return `IDR ${Math.round(n).toLocaleString('en-US')}`
}

const rpSel = (v: unknown): Sel => ({ nilai: angka(v), satuan: 'rp' })
const nSel = (v: unknown): Sel => ({ nilai: angka(v), satuan: 'angka' })

/** "This month (2026-09-01 to 2026-09-29) · basis: invoice · Province: Jawa Barat" */
function sub(j: J, periode?: string, rentang?: string): string | null {
  const bagian: string[] = []
  const p = periode ?? j.periode
  const r = rentang ?? j.rentang
  if (p) bagian.push(r ? `${kapital(labelPeriode(String(p)))} (${labelPeriode(String(r))})` : kapital(labelPeriode(String(p))))
  if (j.basis) bagian.push(j.basis === 'order' ? 'basis: incoming orders' : 'basis: invoice (result date)')
  if (Array.isArray(j.filterProvinsi)) bagian.push(`Province: ${j.filterProvinsi.join(', ')}`)
  if (Array.isArray(j.filterKota)) bagian.push(`City: ${j.filterKota.join(', ')}`)
  if (j.cakupan && j.cakupan !== 'all') bagian.push(j.cakupan === 'erp' ? 'only orders already in the ERP' : 'orders not yet in the ERP')
  return bagian.length ? bagian.join(' · ') : null
}

const kapital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** Label sumbu deret: 2026-09-17 -> "17 Sep" (harian), 2026-09-01 -> "Sep 2026" (bulanan). */
export function labelDeret(periode: string, granularitas: string): string {
  const [y, m, d] = periode.split('-').map(Number)
  if (!y || !m) return periode
  if (granularitas === 'month' || !d) return `${MONTHS[m - 1]} ${y}`
  if (granularitas === 'week') return `wk ${d} ${MONTHS[m - 1]}`
  return `${d} ${MONTHS[m - 1]}`
}

/**
 * Status satu transaksi per Order ID (2 Okt 2026). Hanya menggambar ulang field yang
 * dikembalikan `sales_order_status` — yang memang tidak memuat data pasien/harga/pelanggan.
 */
function cekOrderId(j: J): KartuVisual | null {
  if (typeof j.ditemukan !== 'boolean' || typeof j.order_id !== 'string') return null
  const catatan = [
    typeof j.catatanKesegaran === 'string' ? j.catatanKesegaran : null,
    'Patient data, test type, price, and customer are deliberately not shown.'
  ].filter((x): x is string => x !== null)
  if (!j.ditemukan) {
    return {
      tool: 'sales_order_status',
      judul: `Order ID ${j.order_id}`,
      sub: 'Not in SalesRepository yet',
      panel: [
        {
          jenis: 'tabel',
          judul: 'Possible causes',
          kolom: [{ label: 'Cause' }],
          baris: (Array.isArray(j.sebabMungkin) ? j.sebabMungkin : []).map((s: unknown) => [String(s)])
        }
      ],
      catatan
    }
  }
  const hasil: J[] = Array.isArray(j.hasil) ? j.hasil : []
  if (hasil.length === 0) return null
  const teksSel = (v: unknown): Sel => (v == null || v === '' ? '—' : String(v))
  return {
    tool: 'sales_order_status',
    judul: hasil.length === 1 ? `Order ID ${hasil[0].order_id}` : `Order ID ${j.order_id} (${hasil.length} matches)`,
    sub: typeof j.ringkasan === 'string' ? j.ringkasan : null,
    panel: hasil.map((h) => ({
      jenis: 'tabel' as const,
      judul: hasil.length > 1 ? String(h.order_id) : undefined,
      kolom: [{ label: 'Status' }, { label: 'Details' }],
      baris: [
        ['Recognized as a transaction', h.diakui ? 'Yes' : 'No — transfer cancelled'],
        ['Number of tests', nSel(h.jumlahPemeriksaan)],
        ...(angka(h.pemeriksaanDibatalkan) ? [['Cancelled tests', nSel(h.pemeriksaanDibatalkan)] as Sel[]] : []),
        ['Order received date', teksSel(h.tanggalOrderMasuk)],
        ['Result / invoice released', teksSel(h.hasilInvoice)],
        ['Result / invoice date', teksSel(h.tanggalHasilInvoice)],
        ['Order in the ERP', teksSel(h.orderDiERP)],
        ['Invoice in the ERP', teksSel(h.invoiceDiERP)],
        ['Data last updated', teksSel(h.terakhirDiperbarui)]
      ]
    })),
    catatan: h0Catatan(hasil, catatan)
  }
}

/** Catatan "dicocokkan sebagai" (mis. titik di ujung) ikut terlihat di kartu. */
function h0Catatan(hasil: J[], dasar: string[]): string[] {
  const cocok = hasil.map((h) => h.dicocokkanSebagai).filter((x): x is string => typeof x === 'string')
  return [...cocok.map((c) => `Order ID ${c}.`), ...dasar]
}

function summary(j: J): KartuVisual | null {
  if (angka(j.nett) === null) return null
  return {
    tool: 'sales_summary',
    judul: 'Sales Summary',
    sub: sub(j),
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: 'Sales (nett)', nilai: angka(j.nett), satuan: 'rp' },
          { label: 'Orders', nilai: angka(j.jumlahOrder), satuan: 'angka', catatan: `${angka(j.barisItem) ?? '—'} test lines` },
          { label: 'Customers', nilai: angka(j.pelanggan), satuan: 'angka' },
          { label: 'Test types', nilai: angka(j.jenis_item), satuan: 'angka' }
        ]
      },
      {
        jenis: 'tabel',
        kolom: [{ label: 'Component' }, { label: 'Value', kanan: true }],
        baris: [
          ['Gross', rpSel(j.gross)],
          ['Discount', rpSel(j.diskon)],
          ['Nett', rpSel(j.nett)],
          ['Invoices', nSel(j.jumlahInvoice)]
        ]
      }
    ],
    catatan: []
  }
}

function compare(j: J): KartuVisual | null {
  const a = j.periodeUtama
  const b = j.periodePembanding
  if (!a || !b || angka(a.nett) === null) return null
  const baris: Sel[][] = [
    ['Nett', rpSel(a.nett), rpSel(b.nett), persenSel(pers(a.nett, b.nett))],
    ['Gross', rpSel(a.gross), rpSel(b.gross), persenSel(pers(a.gross, b.gross))],
    ['Discount', rpSel(a.diskon), rpSel(b.diskon), persenSel(pers(a.diskon, b.diskon))],
    ['Orders', nSel(a.jumlahOrder), nSel(b.jumlahOrder), persenSel(pers(a.jumlahOrder, b.jumlahOrder))],
    ['Customers', nSel(a.pelanggan), nSel(b.pelanggan), persenSel(pers(a.pelanggan, b.pelanggan))],
    ['Test types', nSel(a.jenis_item), nSel(b.jenis_item), persenSel(pers(a.jenis_item, b.jenis_item))]
  ]
  const p = angka(j.persenPerubahan)
  return {
    tool: 'sales_compare',
    judul: 'Sales Comparison',
    sub: sub(j, `${labelPeriode(a.label)} vs ${labelPeriode(String(b.label).split(' (')[0])}`, `${a.rentang} vs ${b.rentang}`),
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: kapital(labelPeriode(String(a.label))), nilai: angka(a.nett), satuan: 'rp' },
          { label: kapital(labelPeriode(String(b.label).split(' (')[0])), nilai: angka(b.nett), satuan: 'rp' },
          { label: 'Difference', nilai: angka(j.selisihNett), satuan: 'rp' },
          { label: 'Growth', nilai: p, satuan: 'persen', arah: p === null ? undefined : p >= 0 ? 'naik' : 'turun' }
        ]
      },
      {
        jenis: 'tabel',
        kolom: [{ label: 'Indicator' }, { label: kapital(labelPeriode(String(a.label))), kanan: true }, { label: 'Comparison', kanan: true }, { label: '% Change', kanan: true }],
        baris
      }
    ],
    catatan: j.catatanPerbandingan ? [`The comparison is trimmed to the same number of days (${labelPeriode(String(b.rentang))}).`] : []
  }
}

/** Persen perubahan untuk BARIS TABEL perbandingan — satu desimal, null bila pembanding 0. */
function pers(kini: unknown, lalu: unknown): number | null {
  const a = angka(kini)
  const b = angka(lalu)
  if (a === null || b === null || b === 0) return null
  return Math.round(((a - b) / b) * 1000) / 10
}

function breakdown(j: J): KartuVisual | null {
  if (!Array.isArray(j.baris)) return null
  const baris = j.baris as J[]
  const dim = labelDimensi(String(j.dimensi ?? 'category'))
  const catatan: string[] = []
  if (angka(j.persenTercakupDaftarIni) !== null) {
    catatan.push(`This list covers ${String(j.persenTercakupDaftarIni)}% of the period's total nett (IDR ${Math.round(angka(j.totalNettPeriode) ?? 0).toLocaleString('en-US')}).`)
  }
  if (j.catatanUrutan) catatan.push('Only rows WITH transactions in this period; zero rows are not shown.')
  const penandaTanpaMaster = '(pelanggan tidak ada di master)' // marker written by the region/customer queries
  if (baris.some((r) => String(r.kategori).startsWith(penandaTanpaMaster))) {
    catatan.push('"' + penandaTanpaMaster + '" = transactions whose customer code is not registered in the master data.')
  }
  return {
    tool: 'sales_breakdown',
    judul: `Sales by ${dim}${j.urutan?.startsWith('terkecil') ? ' (smallest)' : ''}`,
    sub: sub(j),
    panel: [
      {
        jenis: 'batang',
        satuan: 'rp',
        baris: baris.slice(0, 15).map((r) => ({
          label: String(r.kategori),
          nilai: angka(r.nett) ?? 0,
          catatan: angka(r.persen) !== null ? `${String(r.persen)}%` : undefined
        }))
      },
      {
        jenis: 'tabel',
        kolom: [{ label: '#' }, { label: kapital(dim) }, { label: 'Orders', kanan: true }, { label: 'Nett', kanan: true }, { label: 'Contribution', kanan: true }],
        baris: baris.map((r, i) => [i + 1, String(r.kategori), nSel(r.jumlahOrder), rpSel(r.nett), angka(r.persen) === null ? null : { nilai: angka(r.persen), satuan: 'persen' }])
      }
    ],
    catatan
  }
}

function trend(j: J): KartuVisual | null {
  if (!Array.isArray(j.deret) || j.deret.length === 0) return null
  const g = String(j.granularitas ?? 'day')
  const deret = j.deret as J[]
  const total = deret.reduce((s, r) => s + (angka(r.nett) ?? 0), 0)
  const order = deret.reduce((s, r) => s + (angka(r.jumlahOrder) ?? 0), 0)
  const puncak = deret.reduce((a, b) => ((angka(b.nett) ?? 0) > (angka(a.nett) ?? 0) ? b : a))
  return {
    tool: 'sales_trend',
    judul: `Sales Trend by ${g === 'month' ? 'Month' : g === 'week' ? 'Week' : 'Day'}`,
    sub: sub(j),
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: 'Total nett for the period', nilai: total, satuan: 'rp' },
          { label: g === 'day' ? 'Orders (daily sum)' : 'Orders (sum per period)', nilai: order, satuan: 'angka', catatan: g === 'day' ? 'orders spanning several days may be counted twice' : undefined },
          { label: 'Highest', nilai: angka(puncak.nett), satuan: 'rp', catatan: labelDeret(String(puncak.periode), g) }
        ]
      },
      {
        jenis: 'deret',
        satuan: 'rp',
        namaSeri: 'Nett',
        titik: deret.map((r) => ({ label: labelDeret(String(r.periode), g), nilai: angka(r.nett) ?? 0 }))
      }
    ],
    catatan: []
  }
}

function movers(j: J): KartuVisual | null {
  if (!Array.isArray(j.itemNaik) && !Array.isArray(j.itemTurun)) return null
  const baris = (rows: J[]): Sel[][] =>
    rows.map((r) => [
      String(r.item),
      rpSel(r.nett),
      rpSel(r.nettSebelum),
      { nilai: angka(r.selisih), satuan: 'rp', arah: (angka(r.selisih) ?? 0) >= 0 ? 'naik' : 'turun' },
      r.status === 'baru' ? 'new' : r.status === 'berhenti' ? 'stopped' : persenSel(r.persen)
    ])
  const kolom = [{ label: 'Test' }, { label: 'Current', kanan: true }, { label: 'Comparison', kanan: true }, { label: 'Difference', kanan: true }, { label: '%', kanan: true }]
  const a = j.periodeUtama ?? {}
  const b = j.periodePembanding ?? {}
  return {
    tool: 'sales_movers',
    judul: 'Tests Rising & Falling the Most',
    sub: sub(j, `${labelPeriode(a.label)} vs ${labelPeriode(String(b.label ?? '').split(' (')[0])}`, `${a.rentang} vs ${b.rentang}`),
    panel: [
      { jenis: 'tabel', judul: 'Rising the most', kolom, baris: baris(j.itemNaik ?? []) },
      { jenis: 'tabel', judul: 'Falling the most', kolom, baris: baris(j.itemTurun ?? []) }
    ],
    catatan: ['Sorted by rupiah difference, not percentage. "new" = zero in the comparison period; "stopped" = zero in this period.']
  }
}

function ytd(j: J): KartuVisual | null {
  const a = j.ytdUtama
  const b = j.ytdPembanding
  if (!a || !b) return null
  const g = angka(j.growthPersen)
  const panel: Panel[] = [
    {
      jenis: 'kpi',
      item: [
        { label: labelPeriode(String(a.label)), nilai: angka(a.nett), satuan: 'rp' },
        { label: labelPeriode(String(b.label)), nilai: angka(b.nett), satuan: 'rp' },
        { label: 'Difference', nilai: angka(j.selisihNett), satuan: 'rp' },
        { label: 'Growth', nilai: g, satuan: 'persen', arah: g === null ? undefined : g >= 0 ? 'naik' : 'turun', catatan: g === null && j.peringatanGrowth ? 'deliberately not calculated — see note' : undefined }
      ]
    }
  ]
  if (Array.isArray(j.perBulan) && j.perBulan.length) {
    const rows = j.perBulan as J[]
    const kunci = Object.keys(rows[0]).filter((k) => /^nett\d{4}$/.test(k)).sort()
    const [lama, baru] = [kunci[0], kunci[kunci.length - 1]]
    if (lama && baru && lama !== baru) {
      panel.push({
        jenis: 'deret',
        satuan: 'rp',
        namaSeri: baru.slice(4),
        titik: rows.map((r) => ({ label: bulanSingkat(String(r.bulan)), nilai: angka(r[baru]) ?? 0 })),
        pembanding: { nama: lama.slice(4), nilai: rows.map((r) => angka(r[lama])) }
      })
    }
  }
  return {
    tool: 'sales_ytd',
    judul: 'Year-to-Date (YTD)',
    sub: sub(j, `${labelPeriode(String(a.label))} vs ${labelPeriode(String(b.label))}`, `${a.rentang} vs ${b.rentang}`),
    panel,
    catatan: j.peringatanGrowth ? ['The growth percentage is deliberately not calculated: ERP coverage is only complete since the bridging date.'] : []
  }
}

/** Criteria sentence of the customers tool, in English for the card. Unknown wording passes through. */
function kriteriaEn(k: string): string {
  let m = /^pernah aktif minimal (\d+) bulan DAN sudah lebih dari (\d+) hari tidak order$/.exec(k)
  if (m) return `was active for at least ${m[1]} months AND has not ordered for more than ${m[2]} days`
  m = /^masih order \(diam <= (\d+) hari\) tetapi nett (\d+) hari terakhir turun minimal (\d+)% dibanding (\d+) hari sebelumnya$/.exec(k)
  if (m) return `still ordering (inactive <= ${m[1]} days) but nett over the last ${m[2]} days dropped by at least ${m[3]}% vs the previous ${m[4]} days`
  m = /^order pertamanya jatuh dalam (\d+) hari terakhir$/.exec(k)
  if (m) return `first order falls within the last ${m[1]} days`
  return k
}

function customers(j: J): KartuVisual | null {
  if (!Array.isArray(j.baris)) return null
  const status = String(j.status ?? 'berhenti')
  const rows = j.baris as J[]
  const kolom =
    status === 'melemah'
      ? [{ label: 'Customer' }, { label: 'Current nett', kanan: true }, { label: 'Previous', kanan: true }, { label: 'Drop', kanan: true }]
      : status === 'baru'
        ? [{ label: 'Customer' }, { label: 'First order', kanan: true }, { label: 'Nett', kanan: true }]
        : [{ label: 'Customer' }, { label: 'Inactive', kanan: true }, { label: 'Active months', kanan: true }, { label: 'Observed nett', kanan: true }]
  const baris: Sel[][] = rows.map((r) =>
    status === 'melemah'
      ? [String(r.nama), rpSel(r.nettTerkini), rpSel(r.nettSebelum), angka(r.persenTurun) === null ? null : { nilai: -(angka(r.persenTurun) as number), satuan: 'persen', arah: 'turun' }]
      : status === 'baru'
        ? [String(r.nama), `${r.hariSejakPertama} days ago`, rpSel(r.nettTotal)]
        : [String(r.nama), { nilai: angka(r.hariDiam), satuan: 'hari' }, nSel(r.bulanAktif), rpSel(r.nettTotal)]
  )
  const judul = status === 'melemah' ? 'Declining Customers' : status === 'baru' ? 'New Customers' : 'Customers Who Stopped Ordering'
  return {
    tool: 'sales_customers',
    judul,
    sub: [j.rentangPengamatan ? `Observation ${labelPeriode(String(j.rentangPengamatan))}` : null, sub(j)].filter(Boolean).join(' · ') || null,
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: 'Number of ' + (status === 'melemah' ? 'declining' : status === 'baru' ? 'new' : 'lapsed') + ' customers', nilai: angka(j.jumlahPelanggan), satuan: 'angka', catatan: rows.length < (angka(j.jumlahPelanggan) ?? 0) ? `top ${rows.length} shown` : undefined },
          { label: 'Nett in the observation window', nilai: angka(j.totalNettPengamatan), satuan: 'rp' }
        ]
      },
      { jenis: 'tabel', kolom, baris }
    ],
    catatan: [kriteriaEn(String(j.kriteria ?? '')), j.segmen === 'institusi' ? 'The "Pasien Pribadi" (private patient) account is not included.' : ''].filter(Boolean).map((k) => kapital(k))
  }
}

function projection(j: J): KartuVisual | null {
  if (angka(j.proyeksiNettTutupBulan) === null) return null
  const s = angka(j.selisihTerhadapTrenPersen)
  return {
    tool: 'sales_projection',
    judul: 'Month-End Projection',
    sub: `Month ${j.bulanBerjalan} · data up to ${j.sampaiTanggal} (day ${j.hariKe} of ${j.hariDalamBulan}) · basis ${j.basis}`,
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: 'Nett so far', nilai: angka(j.nettSejauhIni), satuan: 'rp', catatan: `${j.jumlahOrderSejauhIni ?? '—'} orders` },
          { label: 'Month-end projection', nilai: angka(j.proyeksiNettTutupBulan), satuan: 'rp', catatan: 'ESTIMATE' },
          { label: 'Expected from trend', nilai: angka(j.harapanMenurutTren), satuan: 'rp' },
          { label: 'Difference vs trend', nilai: s, satuan: 'persen', arah: s === null ? undefined : s >= 0 ? 'naik' : 'turun' }
        ]
      }
    ],
    catatan: [`Estimate (basis: ${j.dasarProyeksi}), not actuals — the exact figure is only known when the month closes.`]
  }
}

function forecast(j: J): KartuVisual | null {
  if (Array.isArray(j.ramalan)) {
    const r = j.ramalan as J[]
    return {
      tool: 'sales_forecast',
      judul: 'Sales Forecast',
      sub: `From ${j.riwayatBulan} months of history · last complete month ${j.bulanTerakhirLengkap} · basis ${j.basis}`,
      panel: [
        {
          jenis: 'kpi',
          item: [
            { label: `Nett ${j.bulanTerakhirLengkap} (actual)`, nilai: angka(j.nettBulanTerakhir), satuan: 'rp' },
            { label: 'Historical accuracy (MAPE)', nilai: angka(j.akurasiHistorisPersen), satuan: 'persen', catatan: 'lower is more accurate' }
          ]
        },
        {
          jenis: 'deret',
          satuan: 'rp',
          namaSeri: 'Forecast',
          titik: r.map((x) => {
            const [y, m] = String(x.bulan).split('-').map(Number)
            return { label: `${MONTHS[m - 1]} ${y}`, nilai: angka(x.nett) ?? 0, bawah: angka(x.rentangBawah), atas: angka(x.rentangAtas), perkiraan: true }
          })
        }
      ],
      catatan: ['Forecast = an estimate with a range, not an exact figure. The current month is not forecast (use the projection).']
    }
  }
  if (Array.isArray(j.item)) {
    return {
      tool: 'sales_forecast',
      judul: 'Trend Direction by Test',
      sub: `${j.jendelaBulan}-month trend (${j.rentangBulan}) · basis ${j.basis}`,
      panel: [
        {
          jenis: 'tabel',
          kolom: [{ label: 'Test' }, { label: 'Direction' }, { label: 'Rate/month', kanan: true }, { label: 'Rate %/month', kanan: true }, { label: 'Last month nett', kanan: true }],
          baris: (j.item as J[]).map((x) => [String(x.item), labelArah(x.arah), { nilai: angka(x.lajuPerBulan), satuan: 'rp', arah: (angka(x.lajuPerBulan) ?? 0) >= 0 ? 'naik' : 'turun' }, persenSel(x.lajuPersenPerBulan), rpSel(x.nettBulanTerakhir)])
        }
      ],
      catatan: ['Trend extrapolation, not a seasonal forecast; this data does not explain why values rise or fall.']
    }
  }
  return null
}


/**
 * Best Estimate setahun (30 Sep 2026). Angka dari tool apa adanya — kartu tidak
 * menjumlah ulang. Bulan aktual digambar utuh, proyeksi & ramalan bertanda perkiraan.
 */
function fullYear(j: J): KartuVisual | null {
  if (!Array.isArray(j.aktualPerBulan) || typeof j.jenis !== 'string') return null
  const aktual = j.aktualPerBulan as J[]
  const ramalan = (Array.isArray(j.ramalanSisaBulan) ? j.ramalanSisaBulan : []) as J[]
  const pr = j.proyeksiBulanBerjalan as J | null
  const titik = [
    ...aktual.map((t) => ({ label: labelDeret(String(t.bulan), 'month'), nilai: angka(t.nett) ?? 0 })),
    ...(pr ? [{ label: labelDeret(String(pr.bulan), 'month'), nilai: angka(pr.nett) ?? 0, perkiraan: true }] : []),
    ...ramalan.map((t) => ({ label: labelDeret(String(t.bulan), 'month'), nilai: angka(t.nett) ?? 0, bawah: angka(t.rentangBawah), atas: angka(t.rentangAtas), perkiraan: true }))
  ]
  const be = angka(j.bestEstimate)
  const judul = (j.jenis === 'realisasi' ? 'Sales Actuals ' : 'Sales Best Estimate ') + j.tahun
  const pTahun = angka(j.pertumbuhanVsTahunLaluPersen)
  return {
    tool: 'sales_full_year',
    judul,
    sub: `up to ${j.sampaiTanggal} · basis: ${j.basis === 'order' ? 'incoming orders' : 'invoice (result date)'}`,
    panel: [
      {
        jenis: 'kpi',
        item: [
          j.jenis === 'tidak_lengkap'
            ? { label: 'Best Estimate', nilai: null, satuan: 'rp', catatan: 'not calculated — the rest of the year is beyond the 3-month forecast limit' }
            : {
                label: j.jenis === 'realisasi' ? 'Full-year total' : 'Full-year Best Estimate',
                nilai: be,
                satuan: 'rp',
                catatan: angka(j.rentangBawah) !== null ? `range ${fmtRp(angka(j.rentangBawah) as number)} – ${fmtRp(angka(j.rentangAtas) as number)}` : j.jenis === 'realisasi' ? 'actuals' : undefined
              },
          { label: `Actual ${aktual.length} months`, nilai: angka(j.totalAktual), satuan: 'rp' },
          ...(pr ? [{ label: 'Projection ' + labelDeret(String(pr.bulan), 'month'), nilai: angka(pr.nett), satuan: 'rp' as const, catatan: 'ESTIMATE for the current month' }] : []),
          ...(pTahun !== null ? [{ label: 'vs full year ' + (Number(j.tahun) - 1), nilai: pTahun, satuan: 'persen' as const, arah: pTahun >= 0 ? ('naik' as const) : ('turun' as const), catatan: fmtRp(angka(j.fullYearTahunLalu) ?? 0) }] : [])
        ]
      },
      ...(titik.length ? [{ jenis: 'deret' as const, judul: 'Nett per month — actual, then estimate', satuan: 'rp' as const, namaSeri: 'Nett', titik }] : [])
    ],
    catatan: [
      ...(j.jenis === 'best_estimate' ? ['ESTIMATE, not actuals: the current month comes from the accumulation pattern, the remaining months from the 12-month trend.', `Historical forecast accuracy (MAPE): ${String(j.akurasiHistorisPersen ?? '—')}%.`] : []),
      ...(j.jenis === 'tidak_lengkap' ? [`Months ${(j.bulanTakDiramal as string[]).join(', ')} are not forecast — beyond the 3-month limit a linear trend cannot be trusted.`] : []),
      ...(Array.isArray(j.bulanKosong) && j.bulanKosong.length ? [`Months without data: ${j.bulanKosong.join(', ')} (not zero).`] : []),
      'Best Estimate = an estimate from the data, not a target/budget.'
    ]
  }
}

const PENERJEMAH: Record<string, (j: J) => KartuVisual | null> = {
  reagent_reconcile: reagentCard,
  sales_summary: summary,
  sales_compare: compare,
  sales_breakdown: breakdown,
  sales_trend: trend,
  sales_movers: movers,
  sales_ytd: ytd,
  sales_customers: customers,
  sales_projection: projection,
  sales_forecast: forecast,
  sales_full_year: fullYear,
  sales_order_status: cekOrderId,
  // TAT Sample (29 Sep 2026) — penerjemahnya di visual/lab.ts.
  ...PENERJEMAH_LAB,
  // Master Data / master data (30 Sep 2026) — penerjemahnya di visual/inno.ts.
  ...PENERJEMAH_INNO
}

/** Nama tool yang punya kartu visual (untuk uji & dokumentasi). */
export const TOOL_BERVISUAL = Object.keys(PENERJEMAH)

/**
 * Kartu visual dari hasil satu tool, atau null (tool tanpa kartu, hasil galat,
 * atau bentuk tak dikenal). Tidak pernah melempar.
 */
export function visualDariHasil(tool: string, hasil: string): KartuVisual | null {
  const f = PENERJEMAH[tool]
  if (!f) return null
  try {
    const j = JSON.parse(hasil) as J
    if (!j || typeof j !== 'object' || j.error) return null
    return f(j)
  } catch {
    return null
  }
}
