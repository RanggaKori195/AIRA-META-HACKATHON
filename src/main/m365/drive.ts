import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { m365Akun, m365Token } from './auth'
import { MAKS_UNDUH_BYTE, terjemahkanGalatGraph, ukuranManusiawi } from './rules'
import {
  asingMenurutDrive,
  catatanTakTerjangkau,
  gabungTanpaDobel,
  mungkinFolderDariPencarian,
  petakan,
  refDariInsight,
  type Berkas,
  type InsightShared,
  type Mentah,
  type RefShare
} from './berkas'
import { folderUnduhanOneDrive } from './unduhan'
import { logger } from '../logger'

// Pembacaan OneDrive lewat Microsoft Graph.
//
// Delegated permission: AIRA hanya melihat apa yang ORANG YANG SEDANG LOGIN
// sudah boleh lihat. Tidak ada satu pun jalur di sini yang bisa menjangkau
// OneDrive karyawan lain — itu butuh Application permission yang sengaja tidak
// diminta.

const GRAPH = 'https://graph.microsoft.com/v1.0'
/** Kolom yang diminta; sengaja sempit supaya jawabannya kecil dan cepat. */
const PILIH = 'id,name,size,lastModifiedDateTime,webUrl,folder,file,parentReference'

export type { Berkas } from './berkas'

async function graph<T>(path: string): Promise<T> {
  const token = await m365Token()
  const res = await fetch(`${GRAPH}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } }
    const kode = body.error?.code ?? ''
    const saran = terjemahkanGalatGraph(res.status, kode)
    throw new Error(
      saran ?? `Microsoft Graph menolak (HTTP ${res.status}${kode ? ` ${kode}` : ''}).`
    )
  }
  return (await res.json()) as T
}

/** Alamat Graph sebuah item lewat drive asalnya — satu-satunya cara menjangkau item share. */
function alamatItem(b: Berkas): string {
  return b.driveId ? `/drives/${b.driveId}/items/${b.id}` : `/me/drive/items/${b.id}`
}

let driveSayaCache: { akun: string | null; id: string } | null = null

/**
 * ID drive OneDrive milik user. Dipakai untuk memutuskan hasil pencarian
 * lintas tempat mana yang milik sendiri (boleh berjalur) dan mana yang milik
 * orang lain (hanya lewat penanda). Disimpan per akun: satu laptop bisa
 * dipakai bergantian.
 */
async function driveSaya(): Promise<string> {
  const akun = m365Akun()
  if (driveSayaCache && driveSayaCache.akun === akun) return driveSayaCache.id
  const d = await graph<{ id: string }>('/me/drive?$select=id')
  driveSayaCache = { akun: m365Akun(), id: d.id }
  return d.id
}

export interface HasilDaftar {
  berkas: Berkas[]
  adaLagi: boolean
  /** Keterangan tambahan yang WAJIB sampai ke model (mis. item yang tidak terjangkau). */
  catatan?: string
}

/** Isi sebuah folder. `jalur` kosong = folder utama OneDrive user. */
export async function daftarFolder(jalur: string, batas: number): Promise<HasilDaftar> {
  const bersih = jalur.replace(/^\/+|\/+$/g, '')
  const dasar = bersih
    ? `/me/drive/root:/${encodeURI(bersih)}:/children`
    : '/me/drive/root/children'
  const data = await graph<{ value: Mentah[]; '@odata.nextLink'?: string }>(
    `${dasar}?$top=${batas}&$select=${PILIH}`
  )
  return {
    berkas: (data.value ?? []).map((m) => petakan(m)),
    adaLagi: Boolean(data['@odata.nextLink'])
  }
}

/** Pencarian di seluruh OneDrive milik user. */
export async function cariBerkas(kata: string, batas: number): Promise<HasilDaftar> {
  const q = kata.replace(/'/g, "''")
  const data = await graph<{ value: Mentah[]; '@odata.nextLink'?: string }>(
    `/me/drive/root/search(q='${encodeURIComponent(q)}')?$top=${batas}&$select=${PILIH}`
  )
  return {
    berkas: (data.value ?? []).map((m) => petakan(m)),
    adaLagi: Boolean(data['@odata.nextLink'])
  }
}

/** Ukuran satu permintaan JSON batch Graph (batas Microsoft: 20). */
const UKURAN_BATCH = 20

/**
 * Metadata banyak item sekaligus lewat `$batch` — satu permintaan per 20 item,
 * bukan satu per item. Item yang ditolak (404 dihapus / 403 dicabut) dihitung.
 */
async function metadataItem(refs: RefShare[]): Promise<{ hasil: Array<{ ref: RefShare; m: Mentah }>; gagal: number }> {
  const hasil: Array<{ ref: RefShare; m: Mentah }> = []
  let gagal = 0
  for (let i = 0; i < refs.length; i += UKURAN_BATCH) {
    const potong = refs.slice(i, i + UKURAN_BATCH)
    const token = await m365Token()
    const res = await fetch(`${GRAPH}/$batch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        requests: potong.map((r, j) => ({
          id: String(j),
          method: 'GET',
          url: `/drives/${r.driveId}/items/${r.itemId}?$select=${PILIH}`
        }))
      })
    })
    if (!res.ok) {
      const saran = terjemahkanGalatGraph(res.status, '')
      throw new Error(saran ?? `Microsoft Graph menolak permintaan batch (HTTP ${res.status}).`)
    }
    const data = (await res.json()) as { responses?: Array<{ id: string; status: number; body?: Mentah }> }
    for (const r of data.responses ?? []) {
      const ref = potong[Number(r.id)]
      if (ref && r.status === 200 && r.body) hasil.push({ ref, m: r.body })
      else gagal++
    }
  }
  return { hasil, gagal }
}

/**
 * Riwayat berbagi Microsoft 365 (`/me/insights/shared`) — sumber UTAMA.
 * Lampiran email dibuang di `refDariInsight`; sisanya diambil metadatanya
 * supaya nama (berikut ekstensinya), ukuran, dan penanda folder akurat.
 */
async function shareDariInsights(batas: number): Promise<HasilDaftar & { takTerjangkau: number }> {
  const data = await graph<{ value?: InsightShared[]; '@odata.nextLink'?: string }>(
    '/me/insights/shared?$top=100'
  )
  // ⚠️ Riwayat berbagi juga memuat berkas MILIK USER yang ia bagikan sendiri
  // (terukur: AIRA-Setup-0.3.0.rar "dari Rangga") — itu bukan "di-share ke saya".
  // Drive user tak terbaca → tidak disaring (salah ke arah aman: item tetap muncul).
  const saya = await driveSaya().catch(() => null)
  const refs: RefShare[] = []
  const terlihat = new Set<string>()
  for (const v of data.value ?? []) {
    const r = refDariInsight(v)
    if (!r || terlihat.has(`${r.driveId}:${r.itemId}`)) continue
    if (saya && r.driveId === saya) continue
    terlihat.add(`${r.driveId}:${r.itemId}`)
    refs.push(r)
  }
  const { hasil, gagal } = await metadataItem(refs.slice(0, batas))
  return {
    berkas: hasil.map(({ ref, m }) => petakan(m, { asing: true, pemilik: ref.oleh })),
    adaLagi: refs.length > batas || Boolean(data['@odata.nextLink']),
    takTerjangkau: gagal
  }
}

/**
 * Berkas & folder yang di-share orang lain.
 *
 * ⚠️ Item share tinggal di drive ORANG LAIN, jadi membacanya butuh
 * `driveId` + `itemId` — bukan jalur. Itu sebabnya `Berkas.driveId` dibawa
 * ke mana-mana dan bukan hanya `id`.
 *
 * ⚠️ DUA sumber (13 Okt 2026, dilaporkan user): folder yang di-share pagi itu
 * tidak muncul karena `/me/drive/sharedWithMe` DEPRECATED — "degraded" (terukur
 * 1 item) dan berhenti mengembalikan data sesudah November 2026. Sumber utama kini
 * riwayat berbagi (`/me/insights/shared`); `sharedWithMe` tetap dipakai sebagai
 * pelengkap selama masih hidup. Satu sumber gagal tidak menggagalkan daftar.
 */
export async function daftarShare(batas: number): Promise<HasilDaftar> {
  const [ins, lama] = await Promise.allSettled([
    shareDariInsights(batas),
    graph<{ value: Mentah[]; '@odata.nextLink'?: string }>(`/me/drive/sharedWithMe?$top=${batas}`)
  ])
  if (ins.status === 'rejected' && lama.status === 'rejected') throw ins.reason
  if (ins.status === 'rejected') {
    logger().warn({ err: String(ins.reason).slice(0, 200) }, 'riwayat berbagi (insights) gagal dibaca — memakai sharedWithMe saja')
  }
  const dariInsights = ins.status === 'fulfilled' ? ins.value : null
  // Tiap item sharedWithMe membawa `remoteItem`, jadi `petakan` menandainya milik orang lain.
  const dariLama = lama.status === 'fulfilled' ? (lama.value.value ?? []).map((m) => petakan(m)) : []
  const gabung = gabungTanpaDobel([dariInsights?.berkas ?? [], dariLama])
  const catatan = [
    catatanTakTerjangkau(dariInsights?.takTerjangkau ?? 0),
    dariInsights ? '' : 'Riwayat berbagi Microsoft gagal dibaca, jadi daftar ini MUNGKIN TIDAK LENGKAP — katakan begitu ke user.'
  ].filter(Boolean).join(' ')
  return {
    berkas: gabung.slice(0, batas),
    adaLagi:
      gabung.length > batas ||
      (dariInsights?.adaLagi ?? false) ||
      (lama.status === 'fulfilled' && Boolean(lama.value['@odata.nextLink'])),
    ...(catatan ? { catatan } : {})
  }
}

/**
 * Isi sebuah folder lewat drive asalnya — termasuk folder yang di-share orang
 * lain, yang tidak punya jalur di OneDrive user. Isi folder share mewarisi
 * pemilik dan lokasi induknya, dan TIDAK diberi jalur (lihat `ringkasUntukModel`).
 */
export async function daftarIsiFolder(induk: Berkas, batas: number): Promise<HasilDaftar> {
  const data = await graph<{ value: Mentah[]; '@odata.nextLink'?: string }>(
    `${alamatItem(induk)}/children?$top=${batas}&$select=${PILIH}`
  )
  const opsi = induk.dariShare
    ? { asing: true, pemilik: induk.pemilik, lokasiInduk: induk.lokasi }
    : {}
  return {
    berkas: (data.value ?? []).map((m) => petakan(m, opsi)),
    adaLagi: Boolean(data['@odata.nextLink'])
  }
}

/**
 * Data TERBARU sebuah berkas yang sudah dikenal lewat penanda. Sekaligus
 * memeriksa aksesnya masih ada: share yang sudah dicabut ditolak Graph di sini
 * dengan pesan yang menyebut kemungkinan itu (404/403), bukan saat mengunduh.
 * Identitas, pemilik, dan lokasi tetap dari acuannya — Graph tidak mengulang
 * keterangan share pada item yang diambil langsung.
 */
export async function berkasDariId(acuan: Berkas): Promise<Berkas> {
  const segar = petakan(await graph<Mentah>(`${alamatItem(acuan)}?$select=${PILIH}`))
  return {
    ...acuan,
    nama: segar.nama,
    ukuran: segar.ukuran,
    diubah: segar.diubah,
    folder: segar.folder,
    webUrl: segar.webUrl || acuan.webUrl
  }
}

/** Satu berkas berdasarkan jalurnya di OneDrive user. */
export async function berkasDariJalur(jalur: string): Promise<Berkas> {
  const bersih = jalur.replace(/^\/+|\/+$/g, '')
  const m = await graph<Mentah>(`/me/drive/root:/${encodeURI(bersih)}?$select=${PILIH}`)
  return petakan(m)
}

/**
 * Pencarian yang IKUT menjangkau SharePoint & Teams, bukan hanya OneDrive.
 *
 * ⚠️ Ini menutup lubang yang terlihat saat uji 27 Agu 2026: `sharedWithMe`
 * hanya menampilkan SATU item, dan berkas yang di-share lewat library
 * SharePoint/Teams tidak muncul sama sekali. Dari sisi user itu terlihat
 * seperti "AIRA tidak bisa melihat file saya", padahal scope-nya yang kurang.
 *
 * Memakai Microsoft Search API — endpoint yang berbeda dari `/me/drive/search`,
 * dan satu-satunya yang menyapu seluruh tempat sekaligus.
 */
export async function cariSemuaTempat(kata: string, batas: number): Promise<HasilDaftar> {
  const token = await m365Token()
  const res = await fetch(`${GRAPH}/search/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      requests: [
        {
          entityTypes: ['driveItem'],
          query: { queryString: kata },
          from: 0,
          size: Math.min(batas, 25)
        }
      ]
    })
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } }
    const saran = terjemahkanGalatGraph(res.status, body.error?.code ?? '')
    throw new Error(saran ?? `pencarian lintas tempat ditolak (HTTP ${res.status}).`)
  }
  const data = (await res.json()) as {
    value?: Array<{
      hitsContainers?: Array<{ hits?: Array<{ resource?: Mentah }>; moreResultsAvailable?: boolean }>
    }>
  }
  const wadah = data.value?.[0]?.hitsContainers?.[0]
  const hits = wadah?.hits ?? []
  // ⚠️ Hasil di sini bisa milik user, milik rekan, atau dari SharePoint. Yang
  // bukan dari drive user diperlakukan sebagai milik orang lain (tanpa jalur),
  // dan bila drive user tidak bisa dipastikan, SEMUANYA — salah ke arah itu
  // hanya berarti dibuka lewat penanda.
  const saya = await driveSaya().catch(() => null)
  return {
    berkas: hits
      .filter((h) => h.resource)
      .map((h) => {
        const m = h.resource as Mentah
        // Search API melabeli folder sebagai berkas berukuran 0 — diduga di sini,
        // dipastikan dengan metadata segar sebelum dibuka/diunduh.
        const b = petakan(m, { asing: asingMenurutDrive(m.parentReference?.driveId ?? '', saya) })
        return mungkinFolderDariPencarian(m) ? { ...b, folder: true } : b
      }),
    adaLagi: wadah?.moreResultsAvailable === true
  }
}

/**
 * Menyimpan berkas dari komputer ke OneDrive user.
 *
 * ⚠️ Sengaja `@microsoft.graph.conflictBehavior=rename`, BUKAN `replace`.
 * Menimpa berkas orang tanpa diminta adalah kerusakan yang tidak terlihat: yang
 * lama hilang, yang baru terlihat wajar, dan tidak ada yang tahu sampai
 * seseorang mencari versi sebelumnya. Kalau namanya bentrok, Graph membuat
 * "Laporan 1.docx" dan nama sesungguhnya dikembalikan supaya bisa disebut.
 */
export async function simpanKeDrive(
  lokal: string,
  folderTujuan: string,
  namaTujuan: string
): Promise<{ nama: string; webUrl: string }> {
  const isi = readFileSync(lokal)
  if (isi.length > MAKS_UNDUH_BYTE) {
    throw new Error(
      `berkas ${ukuranManusiawi(isi.length)} melebihi batas unggah ${ukuranManusiawi(MAKS_UNDUH_BYTE)}.`
    )
  }
  const aman = namaTujuan.replace(/[\\/:*?"<>|]/g, '_')
  const folder = folderTujuan.replace(/^\/+|\/+$/g, '')
  const jalur = folder ? `${folder}/${aman}` : aman
  const token = await m365Token()
  const res = await fetch(
    `${GRAPH}/me/drive/root:/${encodeURI(jalur)}:/content?@microsoft.graph.conflictBehavior=rename`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
      body: new Uint8Array(isi)
    }
  )
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } }
    const saran = terjemahkanGalatGraph(res.status, body.error?.code ?? '')
    throw new Error(saran ?? `gagal menyimpan ke OneDrive (HTTP ${res.status}).`)
  }
  const hasil = (await res.json()) as { name?: string; webUrl?: string }
  logger().info({ nama: hasil.name, byte: isi.length }, 'berkas disimpan ke OneDrive')
  return { nama: hasil.name ?? aman, webUrl: hasil.webUrl ?? '' }
}

/**
 * Mengunduh berkas ke folder kerja AIRA, lalu MENGEMBALIKAN JALURNYA.
 *
 * Sengaja tidak mengembalikan isinya: pembacaan diserahkan ke `read_word`,
 * `read_excel`, `read_pdf` yang sudah ada — lengkap dengan pembacaan bertahap
 * per halaman dan catatan anti-karangan yang sudah terbukti. Membuat jalur
 * pembacaan kedua berarti mengulang seluruh pelajaran itu dari nol.
 */
export async function unduh(berkas: Berkas): Promise<string> {
  if (berkas.folder) throw new Error(`"${berkas.nama}" adalah folder, bukan berkas.`)
  if (berkas.ukuran > MAKS_UNDUH_BYTE) {
    throw new Error(
      `"${berkas.nama}" berukuran ${ukuranManusiawi(berkas.ukuran)}, melebihi batas ` +
        `${ukuranManusiawi(MAKS_UNDUH_BYTE)}. Berkas sebesar itu tidak diunduh — ` +
        'sampaikan batasnya ke user, jangan menebak isinya.'
    )
  }
  const token = await m365Token()
  const res = await fetch(`${GRAPH}${alamatItem(berkas)}/content`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const saran = terjemahkanGalatGraph(res.status, '')
    throw new Error(saran ?? `gagal mengunduh "${berkas.nama}" (HTTP ${res.status})`)
  }
  const isi = Buffer.from(await res.arrayBuffer())
  // Pemeriksaan kedua: ukuran dari daftar share kadang tidak terisi (dibaca 0),
  // sehingga pemeriksaan di atas lolos untuk berkas sebesar apa pun.
  if (isi.length > MAKS_UNDUH_BYTE) {
    throw new Error(
      `"${berkas.nama}" berukuran ${ukuranManusiawi(isi.length)}, melebihi batas ` +
        `${ukuranManusiawi(MAKS_UNDUH_BYTE)}. Berkas sebesar itu tidak disimpan — ` +
        'sampaikan batasnya ke user, jangan menebak isinya.'
    )
  }
  // Nama berkas dibersihkan: nama dari OneDrive adalah masukan tak tepercaya,
  // dan "../" di dalamnya tidak boleh bisa menulis ke luar folder unduhan.
  const aman = berkas.nama.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120)
  const tujuan = join(folderUnduhanOneDrive(), `${berkas.id.slice(-8)}-${aman}`)
  writeFileSync(tujuan, isi)
  logger().info({ nama: berkas.nama, byte: isi.length }, 'berkas OneDrive diunduh')
  return tujuan
}
