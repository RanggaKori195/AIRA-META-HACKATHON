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
import { PENERJEMAH_LAB } from './lab'
import { PENERJEMAH_INNO } from './inno'

type J = Record<string, any>

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

const angka = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null)

function persenSel(p: unknown): Sel {
  const n = angka(p)
  if (n === null) return null
  return { nilai: n, satuan: 'persen', arah: n > 0 ? 'naik' : n < 0 ? 'turun' : undefined }
}

/** Rupiah ringkas untuk catatan kartu ("Rp 102,3 M"). */
function fmtRp(n: number): string {
  if (Math.abs(n) >= 1e9) return `Rp ${(n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M`
  if (Math.abs(n) >= 1e6) return `Rp ${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 0 })} jt`
  return `Rp ${Math.round(n).toLocaleString('id-ID')}`
}

const rpSel = (v: unknown): Sel => ({ nilai: angka(v), satuan: 'rp' })
const nSel = (v: unknown): Sel => ({ nilai: angka(v), satuan: 'angka' })

/** "bulan ini (2026-09-01 s/d 2026-09-29) · basis invoice · Provinsi: Jawa Barat" */
function sub(j: J, periode?: string, rentang?: string): string | null {
  const bagian: string[] = []
  const p = periode ?? j.periode
  const r = rentang ?? j.rentang
  if (p) bagian.push(r ? `${kapital(String(p))} (${r})` : kapital(String(p)))
  if (j.basis) bagian.push(j.basis === 'order' ? 'basis order masuk' : 'basis invoice (tanggal hasil)')
  if (Array.isArray(j.filterProvinsi)) bagian.push(`Provinsi: ${j.filterProvinsi.join(', ')}`)
  if (Array.isArray(j.filterKota)) bagian.push(`Kota: ${j.filterKota.join(', ')}`)
  if (j.cakupan && j.cakupan !== 'all') bagian.push(j.cakupan === 'erp' ? 'hanya yang sudah masuk ERP' : 'yang belum masuk ERP')
  return bagian.length ? bagian.join(' · ') : null
}

const kapital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** Label sumbu deret: 2026-09-17 -> "17 Sep" (harian), 2026-09-01 -> "Sep 2026" (bulanan). */
export function labelDeret(periode: string, granularitas: string): string {
  const [y, m, d] = periode.split('-').map(Number)
  if (!y || !m) return periode
  if (granularitas === 'month' || !d) return `${BULAN[m - 1]} ${y}`
  if (granularitas === 'week') return `mg ${d} ${BULAN[m - 1]}`
  return `${d} ${BULAN[m - 1]}`
}

/**
 * Status satu transaksi per Order ID (2 Okt 2026). Hanya menggambar ulang field yang
 * dikembalikan `sales_order_status` — yang memang tidak memuat data pasien/harga/pelanggan.
 */
function cekOrderId(j: J): KartuVisual | null {
  if (typeof j.ditemukan !== 'boolean' || typeof j.order_id !== 'string') return null
  const catatan = [
    typeof j.catatanKesegaran === 'string' ? j.catatanKesegaran : null,
    'Data pasien, jenis pemeriksaan, harga, dan pelanggan sengaja tidak ditampilkan.'
  ].filter((x): x is string => x !== null)
  if (!j.ditemukan) {
    return {
      tool: 'sales_order_status',
      judul: `Order ID ${j.order_id}`,
      sub: 'Belum ada di SalesRepository',
      panel: [
        {
          jenis: 'tabel',
          judul: 'Kemungkinan sebabnya',
          kolom: [{ label: 'Sebab' }],
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
    judul: hasil.length === 1 ? `Order ID ${hasil[0].order_id}` : `Order ID ${j.order_id} (${hasil.length} cocok)`,
    sub: typeof j.ringkasan === 'string' ? j.ringkasan : null,
    panel: hasil.map((h) => ({
      jenis: 'tabel' as const,
      judul: hasil.length > 1 ? String(h.order_id) : undefined,
      kolom: [{ label: 'Status' }, { label: 'Keterangan' }],
      baris: [
        ['Diakui sebagai transaksi', h.diakui ? 'Ya' : 'Tidak — transfer dibatalkan'],
        ['Jumlah pemeriksaan', nSel(h.jumlahPemeriksaan)],
        ...(angka(h.pemeriksaanDibatalkan) ? [['Pemeriksaan dibatalkan', nSel(h.pemeriksaanDibatalkan)] as Sel[]] : []),
        ['Tanggal order masuk', teksSel(h.tanggalOrderMasuk)],
        ['Hasil / invoice keluar', teksSel(h.hasilInvoice)],
        ['Tanggal hasil / invoice', teksSel(h.tanggalHasilInvoice)],
        ['Order di ERP', teksSel(h.orderDiERP)],
        ['Invoice di ERP', teksSel(h.invoiceDiERP)],
        ['Data terakhir diperbarui', teksSel(h.terakhirDiperbarui)]
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
    judul: 'Ringkasan Penjualan',
    sub: sub(j),
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: 'Sales (nett)', nilai: angka(j.nett), satuan: 'rp' },
          { label: 'Jumlah order', nilai: angka(j.jumlahOrder), satuan: 'angka', catatan: `${angka(j.barisItem) ?? '—'} baris pemeriksaan` },
          { label: 'Pelanggan', nilai: angka(j.pelanggan), satuan: 'angka' },
          { label: 'Jenis pemeriksaan', nilai: angka(j.jenis_item), satuan: 'angka' }
        ]
      },
      {
        jenis: 'tabel',
        kolom: [{ label: 'Komponen' }, { label: 'Nilai', kanan: true }],
        baris: [
          ['Gross', rpSel(j.gross)],
          ['Diskon', rpSel(j.diskon)],
          ['Nett', rpSel(j.nett)],
          ['Jumlah invoice', nSel(j.jumlahInvoice)]
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
    ['Diskon', rpSel(a.diskon), rpSel(b.diskon), persenSel(pers(a.diskon, b.diskon))],
    ['Jumlah order', nSel(a.jumlahOrder), nSel(b.jumlahOrder), persenSel(pers(a.jumlahOrder, b.jumlahOrder))],
    ['Pelanggan', nSel(a.pelanggan), nSel(b.pelanggan), persenSel(pers(a.pelanggan, b.pelanggan))],
    ['Jenis pemeriksaan', nSel(a.jenis_item), nSel(b.jenis_item), persenSel(pers(a.jenis_item, b.jenis_item))]
  ]
  const p = angka(j.persenPerubahan)
  return {
    tool: 'sales_compare',
    judul: 'Perbandingan Penjualan',
    sub: sub(j, `${a.label} vs ${String(b.label).split(' (')[0]}`, `${a.rentang} vs ${b.rentang}`),
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: kapital(String(a.label)), nilai: angka(a.nett), satuan: 'rp' },
          { label: kapital(String(b.label).split(' (')[0]), nilai: angka(b.nett), satuan: 'rp' },
          { label: 'Selisih', nilai: angka(j.selisihNett), satuan: 'rp' },
          { label: 'Pertumbuhan', nilai: p, satuan: 'persen', arah: p === null ? undefined : p >= 0 ? 'naik' : 'turun' }
        ]
      },
      {
        jenis: 'tabel',
        kolom: [{ label: 'Indikator' }, { label: kapital(String(a.label)), kanan: true }, { label: 'Pembanding', kanan: true }, { label: '% Change', kanan: true }],
        baris
      }
    ],
    catatan: j.catatanPerbandingan ? [`Pembanding dipotong ke jumlah hari yang sama (${b.rentang}).`] : []
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
  const dim = String(j.dimensi ?? 'kategori')
  const catatan: string[] = []
  if (angka(j.persenTercakupDaftarIni) !== null) {
    catatan.push(`Daftar ini mencakup ${String(j.persenTercakupDaftarIni).replace('.', ',')}% dari total nett periode (Rp ${Math.round(angka(j.totalNettPeriode) ?? 0).toLocaleString('id-ID')}).`)
  }
  if (j.catatanUrutan) catatan.push('Hanya yang PUNYA transaksi di periode ini; yang nol tidak muncul.')
  if (baris.some((r) => String(r.kategori).startsWith('(pelanggan tidak ada di master)'))) {
    catatan.push('"(pelanggan tidak ada di master)" = transaksi yang kode pelanggannya belum terdaftar di master.')
  }
  return {
    tool: 'sales_breakdown',
    judul: `Penjualan per ${dim}${j.urutan?.startsWith('terkecil') ? ' (terkecil)' : ''}`,
    sub: sub(j),
    panel: [
      {
        jenis: 'batang',
        satuan: 'rp',
        baris: baris.slice(0, 15).map((r) => ({
          label: String(r.kategori),
          nilai: angka(r.nett) ?? 0,
          catatan: angka(r.persen) !== null ? `${String(r.persen).replace('.', ',')}%` : undefined
        }))
      },
      {
        jenis: 'tabel',
        kolom: [{ label: '#' }, { label: kapital(dim) }, { label: 'Order', kanan: true }, { label: 'Nett', kanan: true }, { label: 'Kontribusi', kanan: true }],
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
    judul: `Tren Penjualan per ${g === 'month' ? 'Bulan' : g === 'week' ? 'Minggu' : 'Hari'}`,
    sub: sub(j),
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: 'Total nett periode', nilai: total, satuan: 'rp' },
          { label: g === 'day' ? 'Order (jumlah harian)' : 'Order (jumlah per periode)', nilai: order, satuan: 'angka', catatan: g === 'day' ? 'order lintas hari bisa terhitung dua kali' : undefined },
          { label: 'Tertinggi', nilai: angka(puncak.nett), satuan: 'rp', catatan: labelDeret(String(puncak.periode), g) }
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
      r.status === 'baru' ? 'baru' : r.status === 'berhenti' ? 'berhenti' : persenSel(r.persen)
    ])
  const kolom = [{ label: 'Pemeriksaan' }, { label: 'Kini', kanan: true }, { label: 'Pembanding', kanan: true }, { label: 'Selisih', kanan: true }, { label: '%', kanan: true }]
  const a = j.periodeUtama ?? {}
  const b = j.periodePembanding ?? {}
  return {
    tool: 'sales_movers',
    judul: 'Pemeriksaan yang Paling Naik & Turun',
    sub: sub(j, `${a.label} vs ${String(b.label ?? '').split(' (')[0]}`, `${a.rentang} vs ${b.rentang}`),
    panel: [
      { jenis: 'tabel', judul: 'Paling naik', kolom, baris: baris(j.itemNaik ?? []) },
      { jenis: 'tabel', judul: 'Paling turun', kolom, baris: baris(j.itemTurun ?? []) }
    ],
    catatan: ['Diurutkan menurut selisih rupiah, bukan persentase. "baru" = nol di periode pembanding; "berhenti" = nol di periode ini.']
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
        { label: String(a.label), nilai: angka(a.nett), satuan: 'rp' },
        { label: String(b.label), nilai: angka(b.nett), satuan: 'rp' },
        { label: 'Selisih', nilai: angka(j.selisihNett), satuan: 'rp' },
        { label: 'Pertumbuhan', nilai: g, satuan: 'persen', arah: g === null ? undefined : g >= 0 ? 'naik' : 'turun', catatan: g === null && j.peringatanGrowth ? 'sengaja tidak dihitung — lihat catatan' : undefined }
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
        titik: rows.map((r) => ({ label: String(r.bulan).slice(0, 3), nilai: angka(r[baru]) ?? 0 })),
        pembanding: { nama: lama.slice(4), nilai: rows.map((r) => angka(r[lama])) }
      })
    }
  }
  return {
    tool: 'sales_ytd',
    judul: 'Year-to-Date (YTD)',
    sub: sub(j, `${a.label} vs ${b.label}`, `${a.rentang} vs ${b.rentang}`),
    panel,
    catatan: j.peringatanGrowth ? ['Persentase pertumbuhan sengaja tidak dihitung: cakupan ERP baru lengkap sejak tanggal bridging.'] : []
  }
}

function customers(j: J): KartuVisual | null {
  if (!Array.isArray(j.baris)) return null
  const status = String(j.status ?? 'berhenti')
  const rows = j.baris as J[]
  const kolom =
    status === 'melemah'
      ? [{ label: 'Pelanggan' }, { label: 'Nett terkini', kanan: true }, { label: 'Sebelumnya', kanan: true }, { label: 'Turun', kanan: true }]
      : status === 'baru'
        ? [{ label: 'Pelanggan' }, { label: 'Order pertama', kanan: true }, { label: 'Nett', kanan: true }]
        : [{ label: 'Pelanggan' }, { label: 'Diam', kanan: true }, { label: 'Bulan aktif', kanan: true }, { label: 'Nett pengamatan', kanan: true }]
  const baris: Sel[][] = rows.map((r) =>
    status === 'melemah'
      ? [String(r.nama), rpSel(r.nettTerkini), rpSel(r.nettSebelum), angka(r.persenTurun) === null ? null : { nilai: -(angka(r.persenTurun) as number), satuan: 'persen', arah: 'turun' }]
      : status === 'baru'
        ? [String(r.nama), `${r.hariSejakPertama} hari lalu`, rpSel(r.nettTotal)]
        : [String(r.nama), { nilai: angka(r.hariDiam), satuan: 'hari' }, nSel(r.bulanAktif), rpSel(r.nettTotal)]
  )
  const judul = status === 'melemah' ? 'Pelanggan yang Melemah' : status === 'baru' ? 'Pelanggan Baru' : 'Pelanggan yang Berhenti Order'
  return {
    tool: 'sales_customers',
    judul,
    sub: [j.rentangPengamatan ? `Pengamatan ${j.rentangPengamatan}` : null, sub(j)].filter(Boolean).join(' · ') || null,
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: `Jumlah pelanggan ${status}`, nilai: angka(j.jumlahPelanggan), satuan: 'angka', catatan: rows.length < (angka(j.jumlahPelanggan) ?? 0) ? `${rows.length} teratas ditampilkan` : undefined },
          { label: 'Nett dalam pengamatan', nilai: angka(j.totalNettPengamatan), satuan: 'rp' }
        ]
      },
      { jenis: 'tabel', kolom, baris }
    ],
    catatan: [String(j.kriteria ?? ''), j.segmen === 'institusi' ? 'Akun "Pasien Pribadi" tidak termasuk.' : ''].filter(Boolean).map((k) => kapital(k))
  }
}

function projection(j: J): KartuVisual | null {
  if (angka(j.proyeksiNettTutupBulan) === null) return null
  const s = angka(j.selisihTerhadapTrenPersen)
  return {
    tool: 'sales_projection',
    judul: 'Proyeksi Tutup Bulan',
    sub: `Bulan ${j.bulanBerjalan} · data sampai ${j.sampaiTanggal} (hari ke-${j.hariKe} dari ${j.hariDalamBulan}) · basis ${j.basis}`,
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: 'Nett sejauh ini', nilai: angka(j.nettSejauhIni), satuan: 'rp', catatan: `${j.jumlahOrderSejauhIni ?? '—'} order` },
          { label: 'Proyeksi tutup bulan', nilai: angka(j.proyeksiNettTutupBulan), satuan: 'rp', catatan: 'PERKIRAAN' },
          { label: 'Harapan menurut tren', nilai: angka(j.harapanMenurutTren), satuan: 'rp' },
          { label: 'Selisih vs tren', nilai: s, satuan: 'persen', arah: s === null ? undefined : s >= 0 ? 'naik' : 'turun' }
        ]
      }
    ],
    catatan: [`Perkiraan (dasar: ${j.dasarProyeksi}), bukan realisasi — angka pastinya baru ada saat bulan ditutup.`]
  }
}

function forecast(j: J): KartuVisual | null {
  if (Array.isArray(j.ramalan)) {
    const r = j.ramalan as J[]
    return {
      tool: 'sales_forecast',
      judul: 'Ramalan Penjualan',
      sub: `Dari ${j.riwayatBulan} bulan riwayat · bulan lengkap terakhir ${j.bulanTerakhirLengkap} · basis ${j.basis}`,
      panel: [
        {
          jenis: 'kpi',
          item: [
            { label: `Nett ${j.bulanTerakhirLengkap} (aktual)`, nilai: angka(j.nettBulanTerakhir), satuan: 'rp' },
            { label: 'Akurasi historis (MAPE)', nilai: angka(j.akurasiHistorisPersen), satuan: 'persen', catatan: 'makin kecil makin akurat' }
          ]
        },
        {
          jenis: 'deret',
          satuan: 'rp',
          namaSeri: 'Ramalan',
          titik: r.map((x) => {
            const [y, m] = String(x.bulan).split('-').map(Number)
            return { label: `${BULAN[m - 1]} ${y}`, nilai: angka(x.nett) ?? 0, bawah: angka(x.rentangBawah), atas: angka(x.rentangAtas), perkiraan: true }
          })
        }
      ],
      catatan: ['Ramalan = perkiraan dengan rentang, bukan angka pasti. Bulan berjalan tidak diramal (pakai proyeksi).']
    }
  }
  if (Array.isArray(j.item)) {
    return {
      tool: 'sales_forecast',
      judul: 'Arah Tren per Pemeriksaan',
      sub: `Tren ${j.jendelaBulan} bulan (${j.rentangBulan}) · basis ${j.basis}`,
      panel: [
        {
          jenis: 'tabel',
          kolom: [{ label: 'Pemeriksaan' }, { label: 'Arah' }, { label: 'Laju/bulan', kanan: true }, { label: 'Laju %/bulan', kanan: true }, { label: 'Nett bulan terakhir', kanan: true }],
          baris: (j.item as J[]).map((x) => [String(x.item), String(x.arah), { nilai: angka(x.lajuPerBulan), satuan: 'rp', arah: (angka(x.lajuPerBulan) ?? 0) >= 0 ? 'naik' : 'turun' }, persenSel(x.lajuPersenPerBulan), rpSel(x.nettBulanTerakhir)])
        }
      ],
      catatan: ['Ekstrapolasi tren, bukan ramalan bermusim; data ini tidak memuat sebab naik/turunnya.']
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
  const judul = j.jenis === 'realisasi' ? `Realisasi Penjualan ${j.tahun}` : `Best Estimate Penjualan ${j.tahun}`
  const pTahun = angka(j.pertumbuhanVsTahunLaluPersen)
  return {
    tool: 'sales_full_year',
    judul,
    sub: `sampai ${j.sampaiTanggal} · basis ${j.basis === 'order' ? 'order masuk' : 'invoice (tanggal hasil)'}`,
    panel: [
      {
        jenis: 'kpi',
        item: [
          j.jenis === 'tidak_lengkap'
            ? { label: 'Best Estimate', nilai: null, satuan: 'rp', catatan: 'tidak dihitung — sisa tahun melewati batas ramalan 3 bulan' }
            : {
                label: j.jenis === 'realisasi' ? 'Total setahun' : 'Best Estimate setahun',
                nilai: be,
                satuan: 'rp',
                catatan: angka(j.rentangBawah) !== null ? `rentang ${fmtRp(angka(j.rentangBawah) as number)} – ${fmtRp(angka(j.rentangAtas) as number)}` : j.jenis === 'realisasi' ? 'realisasi' : undefined
              },
          { label: `Aktual ${aktual.length} bulan`, nilai: angka(j.totalAktual), satuan: 'rp' },
          ...(pr ? [{ label: `Proyeksi ${labelDeret(String(pr.bulan), 'month')}`, nilai: angka(pr.nett), satuan: 'rp' as const, catatan: 'PERKIRAAN bulan berjalan' }] : []),
          ...(pTahun !== null ? [{ label: `vs full year ${Number(j.tahun) - 1}`, nilai: pTahun, satuan: 'persen' as const, arah: pTahun >= 0 ? ('naik' as const) : ('turun' as const), catatan: fmtRp(angka(j.fullYearTahunLalu) ?? 0) }] : [])
        ]
      },
      ...(titik.length ? [{ jenis: 'deret' as const, judul: 'Nett per bulan — aktual lalu perkiraan', satuan: 'rp' as const, namaSeri: 'Nett', titik }] : [])
    ],
    catatan: [
      ...(j.jenis === 'best_estimate' ? ['PERKIRAAN, bukan realisasi: bulan berjalan dari pola penumpukan, sisa bulan dari tren 12 bulan.', `Akurasi historis ramalan (MAPE): ${String(j.akurasiHistorisPersen ?? '—').replace('.', ',')}%.`] : []),
      ...(j.jenis === 'tidak_lengkap' ? [`Bulan ${(j.bulanTakDiramal as string[]).join(', ')} tidak diramal — di luar batas 3 bulan, tren linier tidak dapat dipercaya.`] : []),
      ...(Array.isArray(j.bulanKosong) && j.bulanKosong.length ? [`Bulan tanpa data: ${j.bulanKosong.join(', ')} (bukan nol).`] : []),
      'Best Estimate = perkiraan dari data, bukan target/budget.'
    ]
  }
}

const PENERJEMAH: Record<string, (j: J) => KartuVisual | null> = {
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
