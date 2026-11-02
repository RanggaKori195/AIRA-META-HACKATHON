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

/** "…terakhir diperbarui 2026-09-29 06:00. Sebutkan…" -> "Data ETL, diperbarui 2026-09-29 06:00". */
export function kesegaran(j: J): string | null {
  const m = /terakhir diperbarui (.+?)\. Sebutkan/.exec(String(j.catatanKesegaran ?? ''))
  return m ? `Data hasil ETL (bukan real-time), diperbarui ${m[1]}` : null
}

const SUMBER = 'Pelacakan sampel (Patologi Anatomi)'

function backlog(j: J): KartuVisual | null {
  if (!Array.isArray(j.perStatus)) return null
  const perStatus = j.perStatus as J[]
  const daftar = (Array.isArray(j.daftarTerlama) ? j.daftarTerlama : []) as J[]
  const tertua = perStatus.reduce((m, s) => Math.max(m, angka(s.umur_tertua) ?? 0), 0)
  return {
    tool: 'lab_backlog',
    judul: 'Sampel yang Belum Keluar Hasilnya',
    sub: [SUMBER, kesegaran(j)].filter(Boolean).join(' · '),
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: 'Order belum keluar', nilai: angka(j.totalOrder), satuan: 'angka' },
          { label: 'Baris pemeriksaan', nilai: angka(j.totalBaris), satuan: 'angka', catatan: 'satu order bisa beberapa pemeriksaan' },
          { label: 'Jumlah tahap/status', nilai: perStatus.length, satuan: 'angka' },
          { label: 'Paling lama menggantung', nilai: tertua || null, satuan: 'hari' }
        ]
      },
      {
        jenis: 'batang',
        judul: 'Per tahap / status (baris)',
        satuan: 'angka',
        baris: perStatus.map((s) => ({
          label: String(s.sample_status),
          nilai: angka(s.baris) ?? 0,
          catatan: angka(s.umur_median) !== null ? `median ${String(s.umur_median).replace('.', ',')} hari` : undefined
        }))
      },
      {
        jenis: 'tabel',
        judul: 'Ringkasan per status',
        kolom: [{ label: 'Status' }, { label: 'Order', kanan: true }, { label: 'Baris', kanan: true }, { label: 'Umur median', kanan: true }, { label: 'Tertua', kanan: true }],
        baris: perStatus.map((s) => [String(s.sample_status), n(s.order), n(s.baris), hari(s.umur_median), hari(s.umur_tertua)])
      },
      ...(daftar.length
        ? [
            {
              jenis: 'tabel' as const,
              judul: 'Paling lama menggantung',
              kolom: [{ label: 'Order ID' }, { label: 'Pemeriksaan' }, { label: 'Kategori' }, { label: 'Pelanggan' }, { label: 'Status' }, { label: 'Umur', kanan: true }],
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
      'Umur dihitung sejak sampel diterima lab; bila belum diterima, sejak order divalidasi; bila itu pun kosong, sejak order dibuat.',
      ...(daftar.length < (angka(j.totalBaris) ?? 0) ? [`Daftar menampilkan ${daftar.length} dari ${j.totalBaris} baris (yang terlama).`] : [])
    ]
  }
}

function lacak(j: J): KartuVisual | null {
  if (j.ditemukan === false) {
    return {
      tool: 'lab_lacak',
      judul: `Lacak Order ID ${j.order_id}`,
      sub: [SUMBER, kesegaran(j)].filter(Boolean).join(' · '),
      panel: [{ jenis: 'kpi', item: [{ label: 'Hasil pencarian', nilai: 0, satuan: 'angka', catatan: 'Order ID tidak ada di data pelacakan' }] }],
      catatan: ['Data pelacakan hanya memuat Patologi Anatomi mulai Januari 2026 — order di luar itu memang tidak akan ketemu.']
    }
  }
  if (!Array.isArray(j.pemeriksaan)) return null
  const p = j.pemeriksaan as J[]
  return {
    tool: 'lab_lacak',
    judul: `Lacak Order ID ${j.order_id}`,
    sub: [SUMBER, kesegaran(j)].filter(Boolean).join(' · '),
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: 'Jumlah pemeriksaan', nilai: p.length, satuan: 'angka' },
          { label: 'Status', nilai: null, satuan: 'angka', catatan: [...new Set(p.map((x) => String(x.sample_status)))].join(', ') },
          { label: 'Umur terlama', nilai: p.reduce((m, x) => Math.max(m, angka(x.umur_hari) ?? 0), 0) || null, satuan: 'hari' }
        ]
      },
      ...p.map((x) => ({
        jenis: 'tabel' as const,
        judul: `${x.test} — ${x.category}${x.is_rns ? ' (RNS)' : ''}`,
        kolom: [{ label: 'Tahap' }, { label: 'Waktu', kanan: true }],
        baris: ((Array.isArray(x.jejak) ? x.jejak : []) as J[]).map((t): Sel[] => [String(t.tahap), t.waktu ? String(t.waktu).replace('T', ' ').slice(0, 16) : '—'])
      }))
    ],
    catatan: [
      'Jejak hanya memuat tahap yang benar-benar terjadi; tahap yang tidak muncul belum terjadi ATAU tidak berlaku untuk pemeriksaan itu.',
      ...(Array.isArray(j.tahapTidakTersedia) && j.tahapTidakTersedia.length
        ? [`Tahap ${j.tahapTidakTersedia.join(', ')} tidak tersedia di sumber data saat ini — bukan berarti belum terjadi.`]
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
    judul: 'RNS — Sampel yang Diambil Ulang',
    sub: [SUMBER, kesegaran(j)].filter(Boolean).join(' · '),
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: 'Total RNS', nilai: angka(r.total), satuan: 'angka' },
          { label: 'Pengganti sudah datang', nilai: angka(r.penggantiDatang), satuan: 'angka' },
          { label: 'Masih menunggu pengganti', nilai: angka(r.masihMenunggu), satuan: 'angka', arah: (angka(r.masihMenunggu) ?? 0) > 0 ? 'turun' : undefined, catatan: 'paling perlu ditindaklanjuti' },
          { label: 'Tunggu pengganti (median)', nilai: angka(r.tungguMedianHari), satuan: 'hari', catatan: angka(r.tungguP90Hari) !== null ? `p90 ${String(r.tungguP90Hari).replace('.', ',')} hari` : undefined }
        ]
      },
      {
        jenis: 'batang',
        judul: 'Terbanyak per JUMLAH',
        satuan: 'angka',
        baris: perJumlah.map((b) => ({ label: String(b.test), nilai: angka(b.rns) ?? 0, catatan: `dari ${b.total}` }))
      },
      {
        jenis: 'tabel',
        judul: 'Tertinggi per PERSEN (rasio terhadap volume)',
        kolom: [{ label: 'Pemeriksaan' }, { label: 'RNS', kanan: true }, { label: 'Volume', kanan: true }, { label: 'Rasio', kanan: true }],
        baris: perPersen.map((b) => [String(b.test), n(b.rns), n(b.total), { nilai: angka(b.persen), satuan: 'persen' }])
      }
    ],
    catatan: [
      `${r.hasilKeluarTanpaPengganti ?? 0} RNS hasilnya keluar tanpa catatan sampel pengganti; ${r.batal ?? 0} dibatalkan.`,
      '"Terbanyak" per jumlah dan per persen adalah dua peringkat berbeda; peringkat persen hanya untuk pemeriksaan bervolume cukup.'
    ]
  }
}

function tat(j: J): KartuVisual | null {
  if (!Array.isArray(j.baris)) return null
  const baris = j.baris as J[]
  const per = j.dikelompokkanPer === 'test' ? 'pemeriksaan' : 'kategori'
  const cakupan = /^(\d+) baris ikut dihitung untuk tahap ini; (\d+) baris TIDAK bisa dihitung/.exec(String(j.catatanCakupan ?? ''))
  return {
    tool: 'lab_tat',
    judul: `TAT — ${j.tahapLabel ?? j.tahap} per ${per}`,
    sub: [SUMBER, kesegaran(j)].filter(Boolean).join(' · '),
    panel: [
      {
        jenis: 'batang',
        judul: 'Median (hari)',
        satuan: 'hari',
        baris: baris.map((b) => ({ label: String(b.kelompok), nilai: angka(b.median) ?? 0, catatan: `n=${b.n}` }))
      },
      {
        jenis: 'tabel',
        judul: 'Sebaran waktu',
        kolom: [{ label: per.charAt(0).toUpperCase() + per.slice(1) }, { label: 'Sampel', kanan: true }, { label: 'Median', kanan: true }, { label: 'p90', kanan: true }, { label: 'Terlama', kanan: true }],
        baris: baris.map((b) => [String(b.kelompok), n(b.n), hari(b.median), hari(b.p90), hari(b.terlama)])
      }
    ],
    catatan: [
      ...(cakupan ? [`${cakupan[1]} baris dihitung; ${cakupan[2]} baris tidak bisa dihitung (ujung tahapnya kosong) — itu BUKAN nol dan bukan keterlambatan.`] : []),
      'p90 = 90% sampel selesai dalam waktu ini atau lebih cepat.',
      // catatanTahap ditulis untuk MODEL (berisi larangan) — diringkas untuk pembaca.
      ...(/HARI KALENDER/.test(String(j.catatanTahap ?? '')) ? ['Tahap ini dihitung dalam hari kalender (sumbernya tidak menyimpan jam).'] : []),
      ...(/TIDAK berlaku untuk semua kategori/.test(String(j.catatanTahap ?? '')) ? ['Tahap ini tidak dilalui semua pemeriksaan (mis. HPV DNA & LBC) — yang tidak melewatinya tidak dihitung.'] : [])
    ]
  }
}

export const PENERJEMAH_LAB: Record<string, (j: J) => KartuVisual | null> = {
  lab_backlog: backlog,
  lab_lacak: lacak,
  lab_rns: rns,
  lab_tat: tat
}
