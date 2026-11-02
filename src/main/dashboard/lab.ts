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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const teksHari = (n: number | null): string => (n === null ? '—' : `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })} days`)
const hariSel = (v: number | null): Sel => ({ nilai: v, satuan: 'hari' })
const tgl = (iso: string): string => `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`
const rentangTeks = (r: { dari: string; sampai: string }): string => tgl(r.dari) + ' – ' + tgl(r.sampai)

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
      logger().warn({ nama, err: String(err).slice(0, 200) }, 'dashboard lab: panel failed')
      return cadangan
    }
  }

  // KPI inti — gagal di sini = dashboard gagal (tidak ada yang bisa dibandingkan).
  const rKini = await tatRingkas(fKini, tahap)
  const rLalu = await tatRingkas(fLalu, tahap)
  const belumKini = await coba('samples not finished', () => tahapTakTerpakai(fKini, tahap), null as number | null)
  const vKini = await coba('incoming orders', () => volumeOrder(fKini), null as { order: number; baris: number } | null)
  const vLalu = vKini ? await coba('incoming orders (comparison)', () => volumeOrder(fLalu), null as { order: number; baris: number } | null) : null
  const rnsKini = await coba('RNS', () => ringkasanRns(fKini), null)
  const rnsLalu = rnsKini ? await coba('RNS (comparison)', () => ringkasanRns(fLalu), null) : null

  const katKini = await coba('TAT by category', () => tat(fKini, tahap, 'category', 12), [])
  const katLalu = katKini.length ? await coba('TAT by category (comparison)', () => tat(fLalu, tahap, 'category', 50), []) : []
  const perKategori: BarisTatBanding[] = gabungTat(katKini, katLalu)

  const awalTren = `${geserHari(`${p.kini.sampai.slice(0, 8)}01`, -155).slice(0, 8)}01`
  const tren = await coba('6-month trend', () => tatBulanan({ ...saring, dari: awalTren, sampai: p.kini.sampai }, tahap), [])
  const bl = await coba('current backlog', () => backlog(saring, 1), null)
  const segar = await coba('data freshness', () => terakhirDiperbarui(), null)

  const filter = [saring.category && `Category: ${saring.category}`, saring.test && `Test: ${saring.test}`, saring.account && `Customer: ${saring.account}`].filter(Boolean)
  const kartu: KartuVisual = {
    tool: 'dashboard_lab',
    judul: 'Sample TAT Comparison Summary',
    sub: [`${rentangTeks(p.kini)} vs ${rentangTeks(p.lalu)}`, ...filter, segar ? `ETL data updated ${segar}` : null].filter(Boolean).join(' · '),
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: 'Total median TAT', nilai: rKini.median, satuan: 'hari', catatan: `comparison ${teksHari(rLalu.median)} · ${kalimatSelisihHari(rKini.median, rLalu.median)}` },
          { label: 'p90 TAT', nilai: rKini.p90, satuan: 'hari', catatan: `comparison ${teksHari(rLalu.p90)} · ${kalimatSelisihHari(rKini.p90, rLalu.p90)}` },
          { label: 'Samples completed', nilai: rKini.n, satuan: 'angka', catatan: `comparison ${rLalu.n.toLocaleString('en-US')}` },
          ...(vKini ? [{ label: 'Incoming orders', nilai: vKini.order, satuan: 'angka' as const, catatan: vLalu ? `comparison ${vLalu.order.toLocaleString('en-US')}` : undefined }] : [])
        ]
      },
      ...(tren.length
        ? [
            {
              jenis: 'deret' as const,
              judul: 'Total median TAT by order month (days)',
              satuan: 'hari' as const,
              namaSeri: 'Median TAT',
              titik: tren
                .filter((t) => t.median !== null)
                // ⚠️ TANPA `perkiraan`: penanda itu membuat grafik menggambar SELURUH garis putus-putus
                // (tertangkap dari screenshot) — seolah semua bulan ramalan. Bulan berjalan disebut di catatan.
                .map((t) => ({ label: `${MONTHS[+t.bulan.slice(5, 7) - 1]} ${t.bulan.slice(0, 4)}`, nilai: t.median as number }))
            }
          ]
        : []),
      ...(perKategori.length
        ? [
            {
              jenis: 'tabel' as const,
              judul: 'TAT by category — this period vs comparison',
              kolom: [{ label: 'Category' }, { label: 'Samples', kanan: true }, { label: 'Current median', kanan: true }, { label: 'Comparison median', kanan: true }, { label: 'Difference' }],
              baris: perKategori.map((k): Sel[] => [k.kategori, { nilai: k.nKini, satuan: 'angka' }, hariSel(k.medianKini), hariSel(k.medianLalu), kalimatSelisihHari(k.medianKini, k.medianLalu)])
            }
          ]
        : []),
      ...(rnsKini
        ? [
            {
              jenis: 'tabel' as const,
              judul: 'RNS (recollected samples)',
              kolom: [{ label: '' }, { label: 'This period', kanan: true }, { label: 'Comparison', kanan: true }],
              baris: [
                ['Total RNS', { nilai: rnsKini.total, satuan: 'angka' as const }, { nilai: rnsLalu?.total ?? null, satuan: 'angka' as const }],
                ['Still waiting for replacement', { nilai: rnsKini.masihMenunggu, satuan: 'angka' as const }, { nilai: rnsLalu?.masihMenunggu ?? null, satuan: 'angka' as const }]
              ] as Sel[][]
            }
          ]
        : []),
      ...(bl && bl.perStatus.length
        ? [
            {
              jenis: 'tabel' as const,
              judul: `CURRENT backlog by status — ${bl.totalOrder.toLocaleString('en-US')} orders (current state, not compared)`,
              kolom: [{ label: 'Status' }, { label: 'Orders', kanan: true }, { label: 'Median age', kanan: true }, { label: 'Oldest', kanan: true }],
              baris: bl.perStatus.map((s): Sel[] => [s.sample_status, { nilai: s.order, satuan: 'angka' }, hariSel(s.umur_median), hariSel(s.umur_tertua)])
            }
          ]
        : [])
    ],
    catatan: [
      p.cara,
      'The period is based on the date the ORDER was created. TAT = from the lab receiving the sample until the result is out.',
      `Only samples that are ALREADY finished count toward TAT${belumKini ? ` (${belumKini.toLocaleString('en-US')} rows in this period are not finished or cannot be calculated)` : ''} — for a running period the median tends to be lower because older unfinished samples are not included yet.`,
      'Backlog is the current state: tracking data does not keep status history, so the backlog of the previous period cannot be recalculated.',
      `The ${MONTHS[+p.kini.sampai.slice(5, 7) - 1]} ${p.kini.sampai.slice(0, 4)} point on the trend chart uses data up to ${tgl(p.kini.sampai)} — that month may not be over yet.`,
      ...(gagal.length ? ['Panels that failed to load: ' + gagal.join(', ') + '.'] : [])
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
    sumber: 'Sample tracking (ETL)'
  }
}
