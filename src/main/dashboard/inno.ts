// Pengumpul DASHBOARD perbandingan Master Data (30 Sep 2026).
//
// Master data tidak punya dimensi waktu, jadi "perbandingan" di sini berarti DUA
// PELANGGAN: special price A vs B. Dipicu hanya bila model sudah berhasil
// mengambil special price dua pelanggan berbeda di giliran yang sama.
// ⚠️ Lewat `execute` tool `inno_special_price` yang SAMA dengan model (aturan 14:
// query ber-index + LIMIT, `max_statement_time`), BERURUTAN, dengan kode pelanggan
// yang sudah dipastikan tool — tidak menebak dari nama.

import { getTool } from '../tools/registry'
import { logger } from '../logger'
import type { DashboardUmum } from '../../shared/dashboard'
import type { KartuVisual, Sel } from '../../shared/visual'
import { bandingHarga, type BarisHarga } from './rules-lab-inno'

async function ambil(kode: string): Promise<{ nama: string; aktif: number; baris: BarisHarga[] }> {
  const tool = getTool('inno_special_price')
  if (!tool) throw new Error('tool inno_special_price is not registered')
  const j = JSON.parse(await tool.execute({ customer: kode, limit: 50 }, { allowedDirs: [] })) as Record<string, any>
  if (j.error) throw new Error(String(j.error))
  return {
    nama: String(j.pelanggan?.nama ?? kode),
    aktif: Number(j.jumlahAktifHariIni ?? 0),
    baris: (Array.isArray(j.hargaKhusus) ? j.hargaKhusus : []).map((r: any) => ({
      kodeItem: String(r.kodeItem ?? ''),
      item: String(r.item ?? r.kodeItem ?? ''),
      kategori: String(r.kategoriHarga ?? ''),
      kodeKategori: String(r.kodeKategori ?? ''),
      harga: typeof r.hargaKhusus === 'number' ? r.hargaKhusus : null
    }))
  }
}

const rp = (v: number | null): Sel => ({ nilai: v, satuan: 'rp' })

export async function kumpulkanDashboardInno(kodeA: string, kodeB: string): Promise<DashboardUmum> {
  const t0 = Date.now()
  const a = await ambil(kodeA)
  const b = await ambil(kodeB)
  const h = bandingHarga(a.baris, b.baris)
  const A = a.nama
  const B = b.nama
  const nA = a.baris.length
  const nB = b.baris.length
  const aktifA = a.aktif
  const aktifB = b.aktif
  const potong = (n: number, tampil: number): boolean => n > tampil
  const catatanSisa = [
    ...(potong(a.aktif, a.baris.length) ? [`${A}: compared ${nA} of ${aktifA} active special prices (limit 50).`] : []),
    ...(potong(b.aktif, b.baris.length) ? [`${B}: compared ${nB} of ${aktifB} active special prices (limit 50).`] : [])
  ]

  const kartu: KartuVisual = {
    tool: 'dashboard_inno',
    judul: `Special Price Comparison — ${A} vs ${B}`,
    sub: `Master Data · code ${kodeA} vs ${kodeB} · only prices active today`,
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: `Special prices ${A}`, nilai: a.aktif, satuan: 'angka', catatan: 'active today' },
          { label: `Special prices ${B}`, nilai: b.aktif, satuan: 'angka', catatan: 'active today' },
          { label: 'Items both have', nilai: h.sama.length, satuan: 'angka', catatan: 'same item + price category' },
          { label: 'Cheaper at', nilai: null, satuan: 'angka', catatan: `${A}: ${h.aLebihMurah} · ${B}: ${h.bLebihMurah} · same: ${h.setara}` }
        ]
      },
      ...(h.sama.length
        ? [
            {
              jenis: 'tabel' as const,
              judul: 'Items both have',
              kolom: [{ label: 'Item' }, { label: 'Category' }, { label: a.nama, kanan: true }, { label: b.nama, kanan: true }, { label: 'Cheaper' }],
              baris: h.sama.map((r): Sel[] => [
                r.item,
                r.kategori,
                rp(r.a),
                rp(r.b),
                r.a === null || r.b === null ? '—' : r.a < r.b ? A : r.a > r.b ? B : 'same'
              ])
            }
          ]
        : []),
      ...(h.hanyaA.length
        ? [{ jenis: 'tabel' as const, judul: `Only at ${A} (${h.hanyaA.length})`, kolom: [{ label: 'Item' }, { label: 'Category' }, { label: 'Special price', kanan: true }], baris: h.hanyaA.map((r): Sel[] => [r.item, r.kategori, rp(r.harga)]) }]
        : []),
      ...(h.hanyaB.length
        ? [{ jenis: 'tabel' as const, judul: `Only at ${B} (${h.hanyaB.length})`, kolom: [{ label: 'Item' }, { label: 'Category' }, { label: 'Special price', kanan: true }], baris: h.hanyaB.map((r): Sel[] => [r.item, r.kategori, rp(r.harga)]) }]
        : [])
    ],
    catatan: [
      'Compared per item AND price category — BPJS prices are not compared with Special Price.',
      'List prices (K1/K2) are not included here; look up the item if you need the regular price.',
      ...catatanSisa
    ]
  }

  const insight: string[] = []
  if (h.sama.length) {
    insight.push(`${h.sama.length} items have special prices at both customers; ${A} is cheaper on ${h.aLebihMurah}, ${B} is cheaper on ${h.bLebihMurah}, same on ${h.setara}.`)
  } else insight.push('No item + price category appears in both lists being compared.')
  if (h.hanyaA.length) insight.push(`${h.hanyaA.length} special prices belong only to ${A}.`)
  if (h.hanyaB.length) insight.push(`${h.hanyaB.length} special prices belong only to ${B}.`)

  logger().info({ ms: Date.now() - t0 }, 'dashboard inno tersusun')
  return {
    jenis: 'inno',
    versi: 1,
    dibuat: Date.now(),
    kartu,
    insight,
    saran: [`Does ${A} already have a PKS?`, `Does ${B} already have a PKS?`, 'Who gets a special price for a specific item?'],
    gagal: [],
    sumber: 'Master Data'
  }
}
