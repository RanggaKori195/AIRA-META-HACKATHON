// Penerjemah hasil tool LAB (TAT Sample) -> kartu visual (29 Sep 2026).
//
// ⚠️ MURNI, sama seperti `visual/sales.ts`: hanya membaca JSON hasil tool. Tool
// lab sudah memakai daftar-IZIN kolom (`KOLOM_AMAN`, aturan 35) — kartu hanya
// menampilkan kolom yang memang sudah keluar dari tool itu, jadi nama pasien
// tidak mungkin muncul di sini.
// ⚠️ Kesegaran data (hasil ETL, bukan real-time) WAJIB ikut di setiap kartu.

import type { KartuVisual, Sel } from '../../shared/visual'

type J = Record<string, any>

const angka = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null

const hari = (v: unknown): Sel => ({ nilai: angka(v), satuan: 'hari' })
const n = (v: unknown): Sel => ({ nilai: angka(v), satuan: 'angka' })

/** "…last updated 2026-09-29 06:00. Mention…" -> "ETL data (not real-time), updated 2026-09-29 06:00". */
export function kesegaran(j: J): string | null {
  const m = /(?:terakhir diperbarui|last updated|updated) (.+?)\. (?:Sebutkan|Mention|State|Cite)/i.exec(String(j.catatanKesegaran ?? ''))
  return m ? `ETL data (not real-time), updated ${m[1]}` : null
}

const SUMBER = 'Sample tracking (Anatomical Pathology)'

function backlog(j: J): KartuVisual | null {
  if (!Array.isArray(j.perStatus)) return null
  const perStatus = j.perStatus as J[]
  const daftar = (Array.isArray(j.daftarTerlama) ? j.daftarTerlama : []) as J[]
  const tertua = perStatus.reduce((m, s) => Math.max(m, angka(s.umur_tertua) ?? 0), 0)
  return {
    tool: 'lab_backlog',
    judul: 'Samples Without Results Yet',
    sub: [SUMBER, kesegaran(j)].filter(Boolean).join(' · '),
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: 'Orders not released', nilai: angka(j.totalOrder), satuan: 'angka' },
          { label: 'Test lines', nilai: angka(j.totalBaris), satuan: 'angka', catatan: 'one order can have several tests' },
          { label: 'Stages/statuses', nilai: perStatus.length, satuan: 'angka' },
          { label: 'Longest stuck', nilai: tertua || null, satuan: 'hari' }
        ]
      },
      {
        jenis: 'batang',
        judul: 'By stage / status (lines)',
        satuan: 'angka',
        baris: perStatus.map((s) => ({
          label: String(s.sample_status),
          nilai: angka(s.baris) ?? 0,
          catatan: angka(s.umur_median) !== null ? `median ${String(s.umur_median)} days` : undefined
        }))
      },
      {
        jenis: 'tabel',
        judul: 'Summary by status',
        kolom: [{ label: 'Status' }, { label: 'Orders', kanan: true }, { label: 'Lines', kanan: true }, { label: 'Median age', kanan: true }, { label: 'Oldest', kanan: true }],
        baris: perStatus.map((s) => [String(s.sample_status), n(s.order), n(s.baris), hari(s.umur_median), hari(s.umur_tertua)])
      },
      ...(daftar.length
        ? [
            {
              jenis: 'tabel' as const,
              judul: 'Stuck the longest',
              kolom: [{ label: 'Order ID' }, { label: 'Test' }, { label: 'Category' }, { label: 'Customer' }, { label: 'Status' }, { label: 'Age', kanan: true }],
              baris: daftar.map((d) => [
                String(d.order_id),
                String(d.test),
                String(d.category),
                String(d.account ?? '—'),
                `${d.sample_status}${d.is_rns ? ' · RNS' : ''}`,
                hari(d.umur_hari)
              ])
            }
          ]
        : [])
    ],
    catatan: [
      'Age is counted from when the lab received the sample; if not received yet, from order validation; if that is empty too, from order creation.',
      ...(daftar.length < (angka(j.totalBaris) ?? 0) ? [`The list shows ${daftar.length} of ${j.totalBaris} lines (the oldest).`] : [])
    ]
  }
}

function lacak(j: J): KartuVisual | null {
  if (j.ditemukan === false) {
    return {
      tool: 'lab_lacak',
      judul: `Track Order ID ${j.order_id}`,
      sub: [SUMBER, kesegaran(j)].filter(Boolean).join(' · '),
      panel: [{ jenis: 'kpi', item: [{ label: 'Search result', nilai: 0, satuan: 'angka', catatan: 'Order ID is not in the tracking data' }] }],
      catatan: ['Tracking data only covers Anatomical Pathology from January 2026 — orders outside that will not be found.']
    }
  }
  if (!Array.isArray(j.pemeriksaan)) return null
  const p = j.pemeriksaan as J[]
  return {
    tool: 'lab_lacak',
    judul: `Track Order ID ${j.order_id}`,
    sub: [SUMBER, kesegaran(j)].filter(Boolean).join(' · '),
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: 'Number of tests', nilai: p.length, satuan: 'angka' },
          { label: 'Status', nilai: null, satuan: 'angka', catatan: [...new Set(p.map((x) => String(x.sample_status)))].join(', ') },
          { label: 'Oldest age', nilai: p.reduce((m, x) => Math.max(m, angka(x.umur_hari) ?? 0), 0) || null, satuan: 'hari' }
        ]
      },
      ...p.map((x) => ({
        jenis: 'tabel' as const,
        judul: `${x.test} — ${x.category}${x.is_rns ? ' (RNS)' : ''}`,
        kolom: [{ label: 'Stage' }, { label: 'Time', kanan: true }],
        baris: ((Array.isArray(x.jejak) ? x.jejak : []) as J[]).map((t): Sel[] => [String(t.tahap), t.waktu ? String(t.waktu).replace('T', ' ').slice(0, 16) : '—'])
      }))
    ],
    catatan: [
      'The trail only lists stages that actually happened; a stage that does not appear has not happened yet OR does not apply to that test.',
      ...(Array.isArray(j.tahapTidakTersedia) && j.tahapTidakTersedia.length
        ? [`Stage ${j.tahapTidakTersedia.join(', ')} is not available in the data source at the moment — that does not mean it has not happened.`]
        : [])
    ]
  }
}

function rns(j: J): KartuVisual | null {
  const r = j.ringkasan
  if (!r || angka(r.total) === null) return null
  const perJumlah = (Array.isArray(j.peringkatPerJumlah) ? j.peringkatPerJumlah : []) as J[]
  const perPersen = (Array.isArray(j.peringkatPerPersen) ? j.peringkatPerPersen : []) as J[]
  return {
    tool: 'lab_rns',
    judul: 'RNS — Recollected Samples',
    sub: [SUMBER, kesegaran(j)].filter(Boolean).join(' · '),
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: 'Total RNS', nilai: angka(r.total), satuan: 'angka' },
          { label: 'Replacement arrived', nilai: angka(r.penggantiDatang), satuan: 'angka' },
          { label: 'Still waiting for replacement', nilai: angka(r.masihMenunggu), satuan: 'angka', arah: (angka(r.masihMenunggu) ?? 0) > 0 ? 'turun' : undefined, catatan: 'needs the most follow-up' },
          { label: 'Wait for replacement (median)', nilai: angka(r.tungguMedianHari), satuan: 'hari', catatan: angka(r.tungguP90Hari) !== null ? `p90 ${String(r.tungguP90Hari)} days` : undefined }
        ]
      },
      {
        jenis: 'batang',
        judul: 'Most by COUNT',
        satuan: 'angka',
        baris: perJumlah.map((b) => ({ label: String(b.test), nilai: angka(b.rns) ?? 0, catatan: `of ${b.total}` }))
      },
      {
        jenis: 'tabel',
        judul: 'Highest by PERCENT (ratio to volume)',
        kolom: [{ label: 'Test' }, { label: 'RNS', kanan: true }, { label: 'Volume', kanan: true }, { label: 'Ratio', kanan: true }],
        baris: perPersen.map((b) => [String(b.test), n(b.rns), n(b.total), { nilai: angka(b.persen), satuan: 'persen' }])
      }
    ],
    catatan: [
      (r.hasilKeluarTanpaPengganti ?? 0) + ' RNS had results released without a replacement sample on record; ' + (r.batal ?? 0) + ' were cancelled.',
      '"Most" by count and by percent are two different rankings; the percent ranking only covers tests with enough volume.'
    ]
  }
}

function tat(j: J): KartuVisual | null {
  if (!Array.isArray(j.baris)) return null
  const baris = j.baris as J[]
  const per = j.dikelompokkanPer === 'test' ? 'test' : 'category'
  const cakupan = /^(\d+) baris ikut dihitung untuk tahap ini; (\d+) baris TIDAK bisa dihitung/.exec(String(j.catatanCakupan ?? ''))
  return {
    tool: 'lab_tat',
    judul: 'TAT — ' + (j.tahapLabel ?? j.tahap) + ' by ' + per,
    sub: [SUMBER, kesegaran(j)].filter(Boolean).join(' · '),
    panel: [
      {
        jenis: 'batang',
        judul: 'Median (days)',
        satuan: 'hari',
        baris: baris.map((b) => ({ label: String(b.kelompok), nilai: angka(b.median) ?? 0, catatan: `n=${b.n}` }))
      },
      {
        jenis: 'tabel',
        judul: 'Time distribution',
        kolom: [{ label: per.charAt(0).toUpperCase() + per.slice(1) }, { label: 'Samples', kanan: true }, { label: 'Median', kanan: true }, { label: 'p90', kanan: true }, { label: 'Longest', kanan: true }],
        baris: baris.map((b) => [String(b.kelompok), n(b.n), hari(b.median), hari(b.p90), hari(b.terlama)])
      }
    ],
    catatan: [
      ...(cakupan ? [`${cakupan[1]} lines counted; ${cakupan[2]} lines could not be calculated (the stage endpoint is empty) — that is NOT zero and not a delay.`] : []),
      'p90 = 90% of samples finish within this time or faster.',
      // catatanTahap ditulis untuk MODEL (berisi larangan) — diringkas untuk pembaca.
      ...(/HARI KALENDER/.test(String(j.catatanTahap ?? '')) ? ['This stage is counted in calendar days (the source does not store the time of day).'] : []),
      ...(/TIDAK berlaku untuk semua kategori/.test(String(j.catatanTahap ?? '')) ? ['Not every test passes through this stage (e.g. HPV DNA & LBC) — tests that skip it are not counted.'] : [])
    ]
  }
}

export const PENERJEMAH_LAB: Record<string, (j: J) => KartuVisual | null> = {
  lab_backlog: backlog,
  lab_lacak: lacak,
  lab_rns: rns,
  lab_tat: tat
}
