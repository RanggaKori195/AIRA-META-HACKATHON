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
  if (!tool) throw new Error('tool inno_special_price tidak terdaftar')
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
  const potong = (n: number, tampil: number): boolean => n > tampil
  const catatanSisa = [
    ...(potong(a.aktif, a.baris.length) ? [`${a.nama}: dibandingkan ${a.baris.length} dari ${a.aktif} harga khusus aktif (batas 50).`] : []),
    ...(potong(b.aktif, b.baris.length) ? [`${b.nama}: dibandingkan ${b.baris.length} dari ${b.aktif} harga khusus aktif (batas 50).`] : [])
  ]

  const kartu: KartuVisual = {
    tool: 'dashboard_inno',
    judul: `Perbandingan Special Price — ${a.nama} vs ${b.nama}`,
    sub: `Master data Master Data · kode ${kodeA} vs ${kodeB} · hanya harga yang aktif hari ini`,
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: `Harga khusus ${a.nama}`, nilai: a.aktif, satuan: 'angka', catatan: 'aktif hari ini' },
          { label: `Harga khusus ${b.nama}`, nilai: b.aktif, satuan: 'angka', catatan: 'aktif hari ini' },
          { label: 'Item yang sama-sama punya', nilai: h.sama.length, satuan: 'angka', catatan: 'item + kategori harga yang sama' },
          { label: 'Lebih murah di', nilai: null, satuan: 'angka', catatan: `${a.nama}: ${h.aLebihMurah} · ${b.nama}: ${h.bLebihMurah} · sama: ${h.setara}` }
        ]
      },
      ...(h.sama.length
        ? [
            {
              jenis: 'tabel' as const,
              judul: 'Item yang dimiliki keduanya',
              kolom: [{ label: 'Item' }, { label: 'Kategori' }, { label: a.nama, kanan: true }, { label: b.nama, kanan: true }, { label: 'Lebih murah' }],
              baris: h.sama.map((r): Sel[] => [
                r.item,
                r.kategori,
                rp(r.a),
                rp(r.b),
                r.a === null || r.b === null ? '—' : r.a < r.b ? a.nama : r.a > r.b ? b.nama : 'sama'
              ])
            }
          ]
        : []),
      ...(h.hanyaA.length
        ? [{ jenis: 'tabel' as const, judul: `Hanya di ${a.nama} (${h.hanyaA.length})`, kolom: [{ label: 'Item' }, { label: 'Kategori' }, { label: 'Harga khusus', kanan: true }], baris: h.hanyaA.map((r): Sel[] => [r.item, r.kategori, rp(r.harga)]) }]
        : []),
      ...(h.hanyaB.length
        ? [{ jenis: 'tabel' as const, judul: `Hanya di ${b.nama} (${h.hanyaB.length})`, kolom: [{ label: 'Item' }, { label: 'Kategori' }, { label: 'Harga khusus', kanan: true }], baris: h.hanyaB.map((r): Sel[] => [r.item, r.kategori, rp(r.harga)]) }]
        : [])
    ],
    catatan: [
      'Dibandingkan per item DAN kategori harga — harga BPJS tidak dibandingkan dengan Special Price.',
      'Harga daftar (K1/K2) tidak ikut di sini; lihat item-nya bila perlu harga reguler.',
      ...catatanSisa
    ]
  }

  const insight: string[] = []
  if (h.sama.length) {
    insight.push(`${h.sama.length} item punya harga khusus di kedua pelanggan; ${a.nama} lebih murah di ${h.aLebihMurah}, ${b.nama} lebih murah di ${h.bLebihMurah}, sama di ${h.setara}.`)
  } else insight.push('Tidak ada item + kategori harga yang sama di kedua daftar yang dibandingkan.')
  if (h.hanyaA.length) insight.push(`${h.hanyaA.length} harga khusus hanya dimiliki ${a.nama}.`)
  if (h.hanyaB.length) insight.push(`${h.hanyaB.length} harga khusus hanya dimiliki ${b.nama}.`)

  logger().info({ ms: Date.now() - t0 }, 'dashboard inno tersusun')
  return {
    jenis: 'inno',
    versi: 1,
    dibuat: Date.now(),
    kartu,
    insight,
    saran: [`Apakah ${a.nama} sudah ada PKS?`, `Apakah ${b.nama} sudah ada PKS?`, 'Siapa saja yang dapat harga khusus untuk item tertentu?'],
    gagal: [],
    sumber: 'Master Data (master data)'
  }
}
