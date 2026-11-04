// Pengumpul data DASHBOARD Sales (29 Sep 2026).
//
// ⚠️ SATU paket data yang tetap, dikumpulkan KODE — bukan berharap model
// memanggil lima tool dengan benar (pola `analisa_lintas_perspektif`, aturan 28).
// Semua panggilan lewat `execute` tool sales yang SAMA dengan yang dipakai model,
// jadi aturan pengakuan transaksi (§5), anti-join master (§6), basis invoice/
// order (§4), dan cakupan ERP berlaku tanpa salinan SQL.
//
// ⚠️ BERURUTAN, tidak `Promise.all` — pool database `max: 1` dan membuka koneksi
// serentak adalah akar tiga bug lama (the project notes, "Cara kerja yang terbukti").
//
// ⚠️ Panel yang gagal DISEBUT di `gagal`, bukan disembunyikan: dashboard yang
// kehilangan satu panel tanpa keterangan terlihat seperti data yang memang kosong.

import { getTool } from '../tools/registry'
import { logger } from '../logger'
import { labelData, labelPeriode } from '../sales/display-en'
import type { BarisBanding, DashboardSales } from '../../shared/dashboard'
import {
  awalBulanMundur,
  bacaRentang,
  bulanBelumGenap,
  gabungBanding,
  saranLanjutanSales,
  susunInsight
} from './rules'

/** Argumen yang DIWARISI dari panggilan tool sales model (sesudah semua guard). */
const WARIS = ['basis', 'scope', 'source', 'branch', 'province', 'city'] as const

async function jalankan(nama: string, args: Record<string, unknown>): Promise<Record<string, any>> {
  const tool = getTool(nama)
  if (!tool) throw new Error('tool ' + nama + ' is not registered')
  // Tool sales tidak memakai folder akses; konteks kosong cukup.
  return JSON.parse(await tool.execute(args, { allowedDirs: [] })) as Record<string, any>
}

function barisDari(hasil: Record<string, any>): Array<{ nama: string; nett: number }> {
  return (Array.isArray(hasil.baris) ? hasil.baris : []).map((r: any) => ({
    nama: labelData(r.kategori ?? '(not filled in)'),
    nett: Number(r.nett ?? 0)
  }))
}

const NAMA_BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * @param dasar argumen tool sales PERTAMA yang dipanggil model di giliran ini —
 *   periode yang dimaksud user sudah ditafsirkan model, dan basis/cakupan/wilayah
 *   sudah melewati `applyBasisRule`/`applyErpScope`/`steerRegionDimension`.
 */
export async function kumpulkanDashboardSales(dasar: Record<string, unknown>): Promise<DashboardSales> {
  const warisan: Record<string, unknown> = {}
  for (const k of WARIS) if (dasar[k] !== undefined && dasar[k] !== '') warisan[k] = dasar[k]
  const periode: Record<string, unknown> = { period: dasar.period ?? 'this_month' }
  if (dasar.period === 'custom') {
    periode.from = dasar.from
    periode.to = dasar.to
  }
  if (typeof dasar.comparePeriod === 'string' && dasar.comparePeriod) periode.comparePeriod = dasar.comparePeriod

  const gagal: string[] = []
  const t0 = Date.now()

  // 1. KPI — sales_compare menyamakan pembanding bila periode berjalan belum genap.
  const cmp = await jalankan('sales_compare', { ...periode, ...warisan })
  const kini = cmp.periodeUtama ?? {}
  const lalu = cmp.periodePembanding ?? {}
  const rKini = bacaRentang(String(kini.rentang ?? ''))
  const rLalu = bacaRentang(String(lalu.rentang ?? ''))
  if (!rKini || !rLalu) throw new Error('period range could not be read from sales_compare')

  const filter: string[] = []
  if (Array.isArray(cmp.filterProvinsi)) filter.push(`Province: ${cmp.filterProvinsi.join(', ')}`)
  if (Array.isArray(cmp.filterKota)) filter.push(`City: ${cmp.filterKota.join(', ')}`)
  if (warisan.source) filter.push(`Category: ${String(warisan.source)}`)
  if (warisan.branch) filter.push(`Branch: ${String(warisan.branch)}`)
  if (cmp.cakupan && cmp.cakupan !== 'all') filter.push(cmp.cakupan === 'erp' ? 'Only orders already in the ERP' : 'Orders not yet in the ERP')

  const custom = (r: { from: string; to: string }): Record<string, unknown> => ({ period: 'custom', from: r.from, to: r.to, ...warisan })

  // 2. Tren 6 bulan sampai akhir periode kini.
  let tren: DashboardSales['tren'] = []
  try {
    const t = await jalankan('sales_trend', {
      ...warisan,
      period: 'custom',
      from: awalBulanMundur(rKini.to, 5),
      to: rKini.to,
      granularity: 'month'
    })
    tren = (Array.isArray(t.deret) ? t.deret : []).map((r: any) => {
      const [y, m] = String(r.periode).split('-').map(Number)
      const bulanAkhir = rKini.to.slice(0, 7) === `${y}-${String(m).padStart(2, '0')}`
      return {
        bulan: `${NAMA_BULAN[m - 1]} ${y}`,
        nett: Number(r.nett ?? 0),
        sebagian: bulanAkhir && bulanBelumGenap(rKini.to)
      }
    })
  } catch (err) {
    gagal.push('6-month trend')
    logger().warn({ err: String(err).slice(0, 200) }, 'dashboard: trend failed')
  }

  // 3–5. Per kategori layanan, pelanggan, wilayah — periode kini & pembanding.
  const banding = async (
    nama: string,
    dimension: string,
    limitKini: number,
    limitLalu: number
  ): Promise<BarisBanding[]> => {
    try {
      const a = await jalankan('sales_breakdown', { ...custom(rKini), dimension, limit: limitKini })
      const b = await jalankan('sales_breakdown', { ...custom(rLalu), dimension, limit: limitLalu })
      return gabungBanding(barisDari(a), barisDari(b))
    } catch (err) {
      gagal.push(nama)
      logger().warn({ dimension, err: String(err).slice(0, 200) }, 'dashboard: breakdown failed')
      return []
    }
  }
  const kategori = await banding('by service category', 'source', 8, 50)
  const pelanggan = await banding('top 10 customers', 'customer', 10, 50)
  const wilayah = await banding('by region', 'province', 8, 50)

  const inti: Omit<DashboardSales, 'insight' | 'saran'> = {
    jenis: 'sales',
    versi: 1,
    dibuat: Date.now(),
    basis: String(cmp.basis ?? 'invoice'),
    labelKini: labelPeriode(String(kini.label ?? '')),
    labelLalu: labelPeriode(String(lalu.label ?? '').split(' (')[0]),
    rentangKini: `${rKini.from} to ${rKini.to}`,
    rentangLalu: `${rLalu.from} to ${rLalu.to}`,
    catatanPeriode: cmp.catatanPerbandingan
      ? `The current period is not complete — the comparison is trimmed to the same number of days (${rLalu.from} to ${rLalu.to}).`
      : null,
    filter,
    kpi: {
      nettKini: Number(kini.nett ?? 0),
      nettLalu: Number(lalu.nett ?? 0),
      selisih: Number(cmp.selisihNett ?? 0),
      persen: typeof cmp.persenPerubahan === 'number' ? cmp.persenPerubahan : null,
      orderKini: typeof kini.jumlahOrder === 'number' ? kini.jumlahOrder : null,
      orderLalu: typeof lalu.jumlahOrder === 'number' ? lalu.jumlahOrder : null,
      pelangganKini: typeof kini.pelanggan === 'number' ? kini.pelanggan : null
    },
    tren,
    kategori,
    pelanggan,
    wilayah,
    gagal
  }
  logger().info({ ms: Date.now() - t0, gagal }, 'dashboard sales tersusun')
  return { ...inti, insight: susunInsight(inti), saran: saranLanjutanSales(inti.labelKini) }
}
