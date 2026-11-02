// Pengumpul DASHBOARD perbandingan TAT Sample (30 Sep 2026).
//
// ⚠️ Pola `dashboard/sales.ts`: SATU paket tetap, dikumpulkan KODE, BERURUTAN
// (pool `max: 1`). Penyaring (kategori/pemeriksaan/akun) diwarisi dari panggilan
// tool lab PERTAMA model, periode pembanding dihitung `periodeBanding`.
// ⚠️ Tiga kejujuran yang WAJIB tampil (bukan hiasan):
//   1. Backlog = KEADAAN SEKARANG. View tidak menyimpan riwayat status, jadi
//      "backlog minggu lalu" tidak bisa direkonstruksi — tidak dibandingkan.
//   2. TAT periode berjalan hanya menghitung sampel yang SUDAH selesai; yang lama
//      dan belum selesai belum ikut, jadi mediannya cenderung lebih rendah.
//   3. Data hasil ETL, bukan real-time — waktu pembaruan disebut.

import { logger } from '../logger'
import type { DashboardUmum } from '../../shared/dashboard'
import type { KartuVisual, Sel } from '../../shared/visual'
import { jakartaToday } from '../sales/periods'
import { backlog, ringkasanRns, tahapTakTerpakai, tat, tatBulanan, tatRingkas, terakhirDiperbarui, volumeOrder, type Saringan } from '../lab/tracker'
import { tahapDari } from '../lab/rules'
import { gabungTat, geserHari, insightLab, kalimatSelisihHari, periodeBanding, saranLab, type BarisTatBanding } from './rules-lab-inno'

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const teksHari = (n: number | null): string => (n === null ? '—' : `${n.toLocaleString('id-ID', { maximumFractionDigits: 1 })} hari`)
const hariSel = (v: number | null): Sel => ({ nilai: v, satuan: 'hari' })
const tgl = (iso: string): string => `${+iso.slice(8, 10)} ${BULAN[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`
const rentangTeks = (r: { dari: string; sampai: string }): string => `${tgl(r.dari)} – ${tgl(r.sampai)}`

export async function kumpulkanDashboardLab(dasar: Record<string, unknown>): Promise<DashboardUmum> {
  const t0 = Date.now()
  const tahap = tahapDari('total')!
  const hariIni = jakartaToday()
  const p = periodeBanding(dasar, hariIni)
  const saring: Saringan = {
    category: typeof dasar.category === 'string' && dasar.category.trim() ? dasar.category.trim() : undefined,
    test: typeof dasar.test === 'string' && dasar.test.trim() ? dasar.test.trim() : undefined,
    account: typeof dasar.account === 'string' && dasar.account.trim() ? dasar.account.trim() : undefined
  }
  const fKini: Saringan = { ...saring, dari: p.kini.dari, sampai: p.kini.sampai }
  const fLalu: Saringan = { ...saring, dari: p.lalu.dari, sampai: p.lalu.sampai }
  const gagal: string[] = []
  const coba = async <T>(nama: string, kerja: () => Promise<T>, cadangan: T): Promise<T> => {
    try {
      return await kerja()
    } catch (err) {
      gagal.push(nama)
      logger().warn({ nama, err: String(err).slice(0, 200) }, 'dashboard lab: panel gagal')
      return cadangan
    }
  }

  // KPI inti — gagal di sini = dashboard gagal (tidak ada yang bisa dibandingkan).
  const rKini = await tatRingkas(fKini, tahap)
  const rLalu = await tatRingkas(fLalu, tahap)
  const belumKini = await coba('sampel belum selesai', () => tahapTakTerpakai(fKini, tahap), null as number | null)
  const vKini = await coba('order masuk', () => volumeOrder(fKini), null as { order: number; baris: number } | null)
  const vLalu = vKini ? await coba('order masuk pembanding', () => volumeOrder(fLalu), null as { order: number; baris: number } | null) : null
  const rnsKini = await coba('RNS', () => ringkasanRns(fKini), null)
  const rnsLalu = rnsKini ? await coba('RNS pembanding', () => ringkasanRns(fLalu), null) : null

  const katKini = await coba('TAT per kategori', () => tat(fKini, tahap, 'category', 12), [])
  const katLalu = katKini.length ? await coba('TAT per kategori pembanding', () => tat(fLalu, tahap, 'category', 50), []) : []
  const perKategori: BarisTatBanding[] = gabungTat(katKini, katLalu)

  const awalTren = `${geserHari(`${p.kini.sampai.slice(0, 8)}01`, -155).slice(0, 8)}01`
  const tren = await coba('tren 6 bulan', () => tatBulanan({ ...saring, dari: awalTren, sampai: p.kini.sampai }, tahap), [])
  const bl = await coba('backlog saat ini', () => backlog(saring, 1), null)
  const segar = await coba('kesegaran data', () => terakhirDiperbarui(), null)

  const filter = [saring.category && `Kategori: ${saring.category}`, saring.test && `Pemeriksaan: ${saring.test}`, saring.account && `Pelanggan: ${saring.account}`].filter(Boolean)
  const kartu: KartuVisual = {
    tool: 'dashboard_lab',
    judul: 'Ringkasan Perbandingan TAT Sampel',
    sub: [`${rentangTeks(p.kini)} vs ${rentangTeks(p.lalu)}`, ...filter, segar ? `Data ETL diperbarui ${segar}` : null].filter(Boolean).join(' · '),
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: 'Median TAT total', nilai: rKini.median, satuan: 'hari', catatan: `pembanding ${teksHari(rLalu.median)} · ${kalimatSelisihHari(rKini.median, rLalu.median)}` },
          { label: 'p90 TAT', nilai: rKini.p90, satuan: 'hari', catatan: `pembanding ${teksHari(rLalu.p90)} · ${kalimatSelisihHari(rKini.p90, rLalu.p90)}` },
          { label: 'Sampel selesai', nilai: rKini.n, satuan: 'angka', catatan: `pembanding ${rLalu.n.toLocaleString('id-ID')}` },
          ...(vKini ? [{ label: 'Order masuk', nilai: vKini.order, satuan: 'angka' as const, catatan: vLalu ? `pembanding ${vLalu.order.toLocaleString('id-ID')}` : undefined }] : [])
        ]
      },
      ...(tren.length
        ? [
            {
              jenis: 'deret' as const,
              judul: 'Median TAT total per bulan order (hari)',
              satuan: 'hari' as const,
              namaSeri: 'Median TAT',
              titik: tren
                .filter((t) => t.median !== null)
                // ⚠️ TANPA `perkiraan`: penanda itu membuat grafik menggambar SELURUH garis putus-putus
                // (tertangkap dari screenshot) — seolah semua bulan ramalan. Bulan berjalan disebut di catatan.
                .map((t) => ({ label: `${BULAN[+t.bulan.slice(5, 7) - 1]} ${t.bulan.slice(0, 4)}`, nilai: t.median as number }))
            }
          ]
        : []),
      ...(perKategori.length
        ? [
            {
              jenis: 'tabel' as const,
              judul: 'TAT per kategori — periode ini vs pembanding',
              kolom: [{ label: 'Kategori' }, { label: 'Sampel', kanan: true }, { label: 'Median kini', kanan: true }, { label: 'Median pembanding', kanan: true }, { label: 'Selisih' }],
              baris: perKategori.map((k): Sel[] => [k.kategori, { nilai: k.nKini, satuan: 'angka' }, hariSel(k.medianKini), hariSel(k.medianLalu), kalimatSelisihHari(k.medianKini, k.medianLalu)])
            }
          ]
        : []),
      ...(rnsKini
        ? [
            {
              jenis: 'tabel' as const,
              judul: 'RNS (sampel diambil ulang)',
              kolom: [{ label: '' }, { label: 'Periode ini', kanan: true }, { label: 'Pembanding', kanan: true }],
              baris: [
                ['Total RNS', { nilai: rnsKini.total, satuan: 'angka' as const }, { nilai: rnsLalu?.total ?? null, satuan: 'angka' as const }],
                ['Masih menunggu pengganti', { nilai: rnsKini.masihMenunggu, satuan: 'angka' as const }, { nilai: rnsLalu?.masihMenunggu ?? null, satuan: 'angka' as const }]
              ] as Sel[][]
            }
          ]
        : []),
      ...(bl && bl.perStatus.length
        ? [
            {
              jenis: 'tabel' as const,
              judul: `Backlog SAAT INI per status — ${bl.totalOrder.toLocaleString('id-ID')} order (keadaan sekarang, tidak dibandingkan)`,
              kolom: [{ label: 'Status' }, { label: 'Order', kanan: true }, { label: 'Umur median', kanan: true }, { label: 'Tertua', kanan: true }],
              baris: bl.perStatus.map((s): Sel[] => [s.sample_status, { nilai: s.order, satuan: 'angka' }, hariSel(s.umur_median), hariSel(s.umur_tertua)])
            }
          ]
        : [])
    ],
    catatan: [
      p.cara,
      'Periode dihitung dari tanggal ORDER dibuat. TAT = sampel diterima lab sampai hasil keluar.',
      `Hanya sampel yang SUDAH selesai yang masuk TAT${belumKini ? ` (${belumKini.toLocaleString('id-ID')} baris periode ini belum selesai/tidak bisa dihitung)` : ''} — untuk periode berjalan mediannya cenderung lebih rendah karena sampel lama yang belum selesai belum ikut.`,
      'Backlog adalah keadaan sekarang: data pelacakan tidak menyimpan riwayat status, jadi backlog periode lalu tidak bisa dihitung ulang.',
      `Titik ${BULAN[+p.kini.sampai.slice(5, 7) - 1]} ${p.kini.sampai.slice(0, 4)} di grafik tren memakai data s/d ${tgl(p.kini.sampai)} — bulannya belum tentu selesai.`,
      ...(gagal.length ? [`Panel yang gagal diambil: ${gagal.join(', ')}.`] : [])
    ]
  }

  logger().info({ ms: Date.now() - t0, gagal }, 'dashboard lab tersusun')
  return {
    jenis: 'lab',
    versi: 1,
    dibuat: Date.now(),
    kartu,
    insight: insightLab({
      medianKini: rKini.median,
      medianLalu: rLalu.median,
      selesaiKini: rKini.n,
      selesaiLalu: rLalu.n,
      orderKini: vKini?.order ?? 0,
      orderLalu: vLalu?.order ?? 0,
      perKategori,
      backlogPerStatus: bl?.perStatus ?? [],
      rnsKini: rnsKini?.total ?? null,
      rnsLalu: rnsLalu?.total ?? null,
      rnsMenunggu: rnsKini?.masihMenunggu ?? null
    }),
    saran: saranLab(),
    gagal,
    sumber: 'Pelacakan sampel (ETL)'
  }
}
