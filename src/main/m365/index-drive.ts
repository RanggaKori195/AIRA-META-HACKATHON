import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { app } from 'electron'
import { m365Token, m365Configured, m365SudahLogin } from './auth'
import { MAKS_UNDUH_BYTE, bisaDibaca, jalurAman, terjemahkanGalatGraph } from './rules'
import { logger } from '../logger'

// Menyalin folder OneDrive pilihan user ke cache lokal, supaya indexer RAG yang
// SUDAH ADA bisa mengindeksnya seperti folder biasa.
//
// Kenapa lewat cache dan bukan jalur indexing baru: `rag/indexer.ts` sudah
// membawa pemotongan teks, embedding berkelompok, pembersihan entri basi, dan —
// yang paling penting — pelaporan berkas yang DILEWATI beserta alasannya
// (pelajaran PDF 22,8 MB, 19 Agu 2026). Membuat jalur kedua berarti mengulang
// semua itu, dan yang baru pasti lebih longgar.
//
// ⚠️ Ini juga yang menjawab kekhawatiran pencabutan akses: berkas yang hilang
// dari `delta` (dihapus, dipindah, atau share-nya dicabut) ikut DIHAPUS dari
// cache, dan pembersihan entri basi milik indexer otomatis membuang potongannya
// dari indeks. Tanpa itu, kutipan dari dokumen yang aksesnya sudah dicabut masih
// bisa muncul berbulan-bulan kemudian.

const GRAPH = 'https://graph.microsoft.com/v1.0'

/**
 * Batas berkas yang diunduh per sekali jalan.
 *
 * ⚠️ Bukan batas kenyamanan. Tiap berkas berujung pada panggilan embedding ke
 * `bge-m3` di gateway the company yang dipakai bersama seluruh aplikasi. Menyapu
 * OneDrive 50 GB dalam satu kali jalan berarti ribuan panggilan beruntun, dan
 * gejalanya bukan "index lambat" melainkan "AURA lambat" untuk semua orang.
 * Sisanya menyusul pada jalan berikutnya — delta membuat itu murah.
 */
const MAKS_BERKAS_PER_JALAN = 60

export function folderCache(): string {
  const dir = join(app.getPath('userData'), 'onedrive-index')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function berkasPenanda(): string {
  return join(folderCache(), '.delta.json')
}

type Penanda = Record<string, string>

function bacaPenanda(): Penanda {
  try {
    return JSON.parse(readFileSync(berkasPenanda(), 'utf-8')) as Penanda
  } catch {
    return {}
  }
}

function tulisPenanda(p: Penanda): void {
  writeFileSync(berkasPenanda(), JSON.stringify(p, null, 2))
}

/** Membuang penanda delta sebuah folder — jalan berikutnya menyalin dari nol. */
export function lupakanPenanda(folder: string): void {
  const p = bacaPenanda()
  delete p[folder]
  tulisPenanda(p)
}

interface ItemDelta {
  id: string
  name?: string
  size?: number
  file?: unknown
  folder?: unknown
  deleted?: unknown
  parentReference?: { path?: string }
}

async function graph<T>(url: string): Promise<T> {
  const token = await m365Token()
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } }
    const saran = terjemahkanGalatGraph(res.status, body.error?.code ?? '')
    throw new Error(saran ?? `Microsoft Graph menolak (HTTP ${res.status}).`)
  }
  return (await res.json()) as T
}

export interface LaporanSalin {
  folder: string
  diunduh: number
  dihapus: number
  takBerubah: number
  /** Berkas yang SENGAJA dilewati beserta alasannya — tidak pernah didiamkan. */
  dilewati: Array<{ berkas: string; alasan: string }>
  /** Masih ada sisa yang belum sempat diambil pada jalan ini. */
  masihAdaSisa: boolean
  /** Penyalinan pertama untuk folder ini (tanpa penanda delta sebelumnya). */
  pertamaKali: boolean
}

/**
 * Menyalin satu folder OneDrive ke cache, memakai delta supaya jalan kedua dan
 * seterusnya hanya menyentuh yang berubah.
 */
export async function salinFolder(folderOneDrive: string): Promise<LaporanSalin> {
  const laporan: LaporanSalin = {
    folder: folderOneDrive,
    diunduh: 0,
    dihapus: 0,
    takBerubah: 0,
    dilewati: [],
    masihAdaSisa: false,
    pertamaKali: false
  }

  const penanda = bacaPenanda()
  const akar = join(folderCache(), jalurAman(folderOneDrive || 'root'))
  mkdirSync(akar, { recursive: true })

  let url = penanda[folderOneDrive]
  if (!url) {
    laporan.pertamaKali = true
    const bersih = folderOneDrive.replace(/^\/+|\/+$/g, '')
    url = bersih
      ? `${GRAPH}/me/drive/root:/${encodeURI(bersih)}:/delta`
      : `${GRAPH}/me/drive/root/delta`
  }

  let deltaBaru: string | null = null

  while (url) {
    const data: {
      value?: ItemDelta[]
      '@odata.nextLink'?: string
      '@odata.deltaLink'?: string
    } = await graph(url)

    for (const item of data.value ?? []) {
      const nama = item.name ?? ''
      if (!nama || item.folder) continue

      // Jalur relatif di dalam folder yang diminta.
      const indukMentah = item.parentReference?.path ?? ''
      const induk = indukMentah.slice(indukMentah.indexOf(':') + 1).replace(/^\/+/, '')
      const relatif = jalurAman(induk ? `${induk}/${nama}` : nama)
      const tujuan = join(akar, relatif)

      if (item.deleted) {
        // ⚠️ Termasuk share yang DICABUT. Dihapus dari cache supaya pembersihan
        // entri basi milik indexer ikut membuang potongannya dari indeks.
        if (existsSync(tujuan)) {
          rmSync(tujuan, { force: true })
          laporan.dihapus++
        }
        continue
      }

      if (!item.file) continue
      if (!bisaDibaca(nama)) {
        laporan.dilewati.push({ berkas: relatif, alasan: 'jenis berkasnya tidak bisa dibaca AIRA' })
        continue
      }
      const ukuran = item.size ?? 0
      if (ukuran > MAKS_UNDUH_BYTE) {
        laporan.dilewati.push({
          berkas: relatif,
          alasan: `ukuran ${(ukuran / 1024 / 1024).toFixed(1)} MB melebihi batas unduh`
        })
        continue
      }
      if (laporan.diunduh >= MAKS_BERKAS_PER_JALAN) {
        laporan.masihAdaSisa = true
        continue
      }

      const token = await m365Token()
      const res = await fetch(`${GRAPH}/me/drive/items/${item.id}/content`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) {
        laporan.dilewati.push({ berkas: relatif, alasan: `gagal diunduh (HTTP ${res.status})` })
        continue
      }
      mkdirSync(dirname(tujuan), { recursive: true })
      writeFileSync(tujuan, Buffer.from(await res.arrayBuffer()))
      laporan.diunduh++
    }

    // ⚠️ Penanda hanya disimpan bila SELURUH halaman delta habis dibaca. Kalau
    // disimpan saat masih ada sisa, jalan berikutnya melompati berkas yang
    // belum sempat diambil — dan berkas itu tidak akan pernah masuk indeks,
    // tanpa jejak apa pun.
    if (data['@odata.deltaLink']) {
      deltaBaru = laporan.masihAdaSisa ? null : data['@odata.deltaLink']
      break
    }
    url = data['@odata.nextLink'] ?? ''
  }

  if (deltaBaru) {
    const p = bacaPenanda()
    p[folderOneDrive] = deltaBaru
    tulisPenanda(p)
  }

  logger().info(
    {
      folder: folderOneDrive,
      diunduh: laporan.diunduh,
      dihapus: laporan.dihapus,
      dilewati: laporan.dilewati.length,
      masihAdaSisa: laporan.masihAdaSisa
    },
    'folder OneDrive disalin untuk indexing'
  )
  return laporan
}

/** Apakah penyalinan OneDrive layak dijalankan sama sekali. */
export function siapDiindeks(): boolean {
  return m365Configured() && m365SudahLogin()
}

/** Nama folder cache yang sudah ada, untuk ditampilkan ke user. */
export function folderTersalin(): string[] {
  const p = bacaPenanda()
  return Object.keys(p)
}

export { MAKS_BERKAS_PER_JALAN, sep }
