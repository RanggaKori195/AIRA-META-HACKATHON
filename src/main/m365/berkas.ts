import { createHash } from 'node:crypto'
import { bisaDibaca, ukuranManusiawi } from './rules'

// Pemetaan item Microsoft Graph → berkas AIRA, dan PENANDA untuk menjangkaunya.
//
// Murni (tanpa Electron & jaringan) supaya bisa diuji dengan bentuk JSON asli
// dari Graph.
//
// ⚠️ Kenapa ada penanda (13 Okt 2026): berkas & folder yang DI-SHARE orang lain
// tinggal di drive MILIK ORANG ITU, dan hanya bisa dijangkau lewat
// `driveId` + `itemId`. Sebelum ini keduanya dibuang sebelum hasil sampai ke
// model, lalu `onedrive_ambil` mencari ulang lewat JALUR — yang selalu
// diselesaikan di OneDrive user sendiri. Akibatnya folder share tidak bisa
// dibuka, berkas share tidak bisa dibaca, dan yang terburuk: berkas share yang
// bernama sama dengan berkas di folder utama user terbaca sebagai berkas MILIK
// USER, tanpa satu pun tanda. Penanda pendek dipakai — bukan ID mentah ±100
// karakter — karena model 27B tidak andal menyalin string acak sepanjang itu.

export interface Berkas {
  id: string
  driveId: string
  nama: string
  ukuran: number
  diubah: string
  folder: boolean
  /** Jalur di OneDrive user. Hanya bermakna untuk berkas MILIK SENDIRI. */
  jalur: string
  webUrl: string
  /** Tinggal di drive orang lain (di-share, pintasan, atau SharePoint). */
  dariShare?: boolean
  pemilik?: string
  /** Letak yang dibaca manusia untuk berkas share. SENGAJA bukan jalur. */
  lokasi?: string
}

interface Orang {
  user?: { displayName?: string }
}

export interface Mentah {
  id: string
  name?: string
  size?: number
  lastModifiedDateTime?: string
  webUrl?: string
  folder?: unknown
  file?: unknown
  parentReference?: { driveId?: string; path?: string }
  createdBy?: Orang
  remoteItem?: {
    id: string
    name?: string
    size?: number
    folder?: unknown
    file?: unknown
    webUrl?: string
    lastModifiedDateTime?: string
    parentReference?: { driveId?: string; path?: string }
    createdBy?: Orang
    shared?: { owner?: Orang; sharedBy?: Orang }
  }
}

/** Jalur yang enak dibaca manusia, dari `parentReference.path` milik Graph. */
export function jalurDari(p: string | undefined, nama: string): string {
  if (!p) return nama
  // Bentuk aslinya "/drive/root:/Documents/Laporan" — bagian sebelum ":" dibuang.
  const potong = p.slice(p.indexOf(':') + 1)
  return `${potong}/${nama}`.replace(/\/+/g, '/')
}

/** Pemisah lokasi berkas share. BUKAN "/" — lokasi tidak boleh terbaca sebagai jalur. */
const PEMISAH = ' › '

export interface OpsiPetakan {
  /** Paksa dianggap milik orang lain (isi folder share, hasil pencarian drive lain). */
  asing?: boolean
  /** Pemilik yang diwarisi dari folder share induknya. */
  pemilik?: string
  /** Lokasi folder induk, untuk isi folder share. */
  lokasiInduk?: string
}

export function petakan(m: Mentah, opsi: OpsiPetakan = {}): Berkas {
  const r = m.remoteItem
  const sumber = r ?? m
  const nama = m.name ?? r?.name ?? '(tanpa nama)'
  // `remoteItem` = item yang sebenarnya tinggal di drive lain: daftar
  // sharedWithMe, dan pintasan "Add to My files" di folder utama user.
  const asing = Boolean(r) || opsi.asing === true
  const dasar: Berkas = {
    id: sumber.id ?? m.id,
    driveId: sumber.parentReference?.driveId ?? m.parentReference?.driveId ?? '',
    nama,
    ukuran: sumber.size ?? 0,
    diubah: (sumber.lastModifiedDateTime ?? '').slice(0, 16).replace('T', ' '),
    folder: Boolean(sumber.folder),
    jalur: jalurDari(sumber.parentReference?.path, nama),
    webUrl: sumber.webUrl ?? ''
  }
  if (!asing) return dasar
  const pemilik =
    opsi.pemilik ??
    r?.shared?.owner?.user?.displayName ??
    r?.shared?.sharedBy?.user?.displayName ??
    r?.createdBy?.user?.displayName ??
    m.createdBy?.user?.displayName
  const induk = opsi.lokasiInduk ?? (pemilik ? `Di-share oleh ${pemilik}` : 'Di luar OneDrive kamu')
  return {
    ...dasar,
    dariShare: true,
    ...(pemilik ? { pemilik } : {}),
    lokasi: `${induk}${PEMISAH}${nama}`
  }
}

/**
 * Hasil pencarian lintas tempat: milik orang lain bila drive-nya bukan drive
 * user. Drive user yang tidak diketahui → dianggap milik orang lain, karena
 * kesalahan ke arah itu hanya membuat berkas dibuka lewat penanda, sedangkan
 * kesalahan ke arah sebaliknya memberi "jalur" yang bisa menunjuk berkas lain.
 */
export function asingMenurutDrive(driveId: string, driveSaya: string | null): boolean {
  if (!driveSaya || !driveId) return true
  return driveId !== driveSaya
}

// ------------------------------------------------- daftar "di-share ke saya"

/**
 * Satu entri `/me/insights/shared` — riwayat berbagi Microsoft 365.
 *
 * ⚠️ Sumber UTAMA daftar share sejak 13 Okt 2026. `/me/drive/sharedWithMe`
 * DEPRECATED: "degraded" (terukur hanya 1 item, folder yang di-share pagi itu
 * tidak ada) dan berhenti mengembalikan data sesudah November 2026.
 */
export interface InsightShared {
  resourceReference?: { id?: string; type?: string }
  resourceVisualization?: { title?: string; type?: string }
  lastShared?: { sharedBy?: { displayName?: string }; sharedDateTime?: string }
}

export interface RefShare {
  driveId: string
  itemId: string
  oleh?: string
}

/**
 * Entri insights → alamat berkas OneDrive/SharePoint, atau `null`.
 *
 * ⚠️ Insights juga memuat LAMPIRAN EMAIL (`microsoft.graph.fileAttachment`) —
 * terukur 39 dari 50 entri, termasuk berkas kunci bank. Itu bukan berkas
 * OneDrive, izin email tidak ada, dan namanya pun tidak perlu sampai ke model:
 * dibuang di sini, bukan disaring belakangan.
 */
export function refDariInsight(v: InsightShared): RefShare | null {
  if (v.resourceReference?.type !== 'microsoft.graph.driveItem') return null
  const m = /^drives\/([^/]+)\/items\/([^/]+)$/.exec(v.resourceReference.id ?? '')
  if (!m) return null
  const oleh = v.lastShared?.sharedBy?.displayName
  return { driveId: m[1], itemId: m[2], ...(oleh ? { oleh } : {}) }
}

/** Gabungan beberapa sumber tanpa dobel (kunci drive + item); urutan sumber pertama menang. */
export function gabungTanpaDobel(sumber: Berkas[][]): Berkas[] {
  const terlihat = new Set<string>()
  const hasil: Berkas[] = []
  for (const daftar of sumber) {
    for (const b of daftar) {
      const kunci = `${b.driveId}:${b.id}`
      if (terlihat.has(kunci)) continue
      terlihat.add(kunci)
      hasil.push(b)
    }
  }
  return hasil
}

/** Kalimat untuk item share yang sudah tidak bisa dibuka. Kosong bila tidak ada. */
export function catatanTakTerjangkau(n: number): string {
  if (n <= 0) return ''
  return (
    `${n} item di riwayat berbagi tidak bisa dibuka lagi (dihapus pemiliknya atau aksesnya dicabut) ` +
    'dan tidak dicantumkan. Sebutkan ini bila user mencari berkas share yang tidak ada di daftar.'
  )
}

/**
 * Hasil Microsoft Search API: folder?
 *
 * ⚠️ Terukur 13 Okt 2026: Search API melabeli FOLDER sebagai `file` berukuran 0,
 * tanpa kunci `folder`. Dugaan di sini hanya untuk tampilan awal — sebelum
 * dibuka/diunduh, tool selalu membaca metadata SEGAR (`berkasDariId`), jadi
 * dugaan yang salah dikoreksi, bukan dipercaya.
 */
export function mungkinFolderDariPencarian(m: Mentah): boolean {
  if (m.folder) return true
  const nama = m.name ?? ''
  return (m.size ?? 0) === 0 && !/\.[A-Za-z0-9]{1,8}$/.test(nama)
}

// ------------------------------------------------------------------ penanda

/**
 * Penanda pendek & TETAP: item yang sama selalu mendapat penanda yang sama,
 * jadi penanda di riwayat percakapan tetap berlaku sesudah daftarnya diambil
 * ulang (mis. sesudah aplikasi dibuka ulang).
 */
export function buatPenanda(driveId: string, id: string): string {
  return 'od-' + createHash('sha1').update(`${driveId}!${id}`).digest('hex').slice(0, 8)
}

function normalkan(p: string): string {
  return p.trim().toLowerCase()
}

/**
 * Penanda yang pernah ditampilkan ke model, beserta berkasnya.
 *
 * Hanya di memori: penanda adalah PEGANGAN, bukan izin — setiap unduhan tetap
 * diperiksa Microsoft Graph memakai token orang yang sedang login. Batas jumlah
 * supaya sesi panjang tidak menumpuk tanpa akhir.
 */
export class DaftarPenanda {
  private readonly peta = new Map<string, Berkas>()

  constructor(private readonly maks = 2000) {}

  catat(b: Berkas): string {
    const p = buatPenanda(b.driveId, b.id)
    // Hapus dulu supaya urutan sisipan = urutan terakhir terlihat.
    this.peta.delete(p)
    this.peta.set(p, b)
    while (this.peta.size > this.maks) {
      const tertua = this.peta.keys().next().value as string
      this.peta.delete(tertua)
    }
    return p
  }

  cari(p: string): Berkas | undefined {
    return this.peta.get(normalkan(p))
  }

  /** Berkas milik orang lain yang namanya sama persis (tanpa peka huruf besar). */
  kembaranAsing(b: Berkas): Array<{ penanda: string; berkas: Berkas }> {
    const nama = b.nama.toLowerCase()
    const diri = buatPenanda(b.driveId, b.id)
    const hasil: Array<{ penanda: string; berkas: Berkas }> = []
    for (const [penanda, lain] of this.peta) {
      if (penanda !== diri && lain.dariShare && lain.nama.toLowerCase() === nama) {
        hasil.push({ penanda, berkas: lain })
      }
    }
    return hasil
  }

  kosongkan(): void {
    this.peta.clear()
  }
}

/** Daftar yang dipakai tool OneDrive. Dikosongkan saat logout Microsoft 365. */
export const penandaAktif = new DaftarPenanda()

export function pesanPenandaTakDikenal(p: string): string {
  return (
    `penanda "${p}" tidak dikenal — mungkin aplikasi sudah dibuka ulang atau penandanya salah salin. ` +
    'Panggil onedrive_daftar (share: true untuk yang di-share, atau penanda folder induknya) atau ' +
    'onedrive_cari lagi untuk mendapat penanda yang berlaku, lalu ulangi dengan penanda dari hasil ' +
    'itu. Jangan mengarang penanda, dan jangan memakai nama berkas share sebagai jalur.'
  )
}

/**
 * ⚠️ Jalur menunjuk berkas MILIK USER, padahal ada berkas share bernama sama
 * yang baru saja terlihat. Tidak dipilihkan: yang dimaksud user bisa salah satu
 * dari keduanya, dan salah tebak di sini berarti angka dari berkas yang salah.
 */
export function pesanNamaKembar(
  sendiri: Berkas,
  penandaSendiri: string,
  kembar: Array<{ penanda: string; berkas: Berkas }>
): string {
  const daftar = kembar
    .map((k) => `penanda "${k.penanda}" = di-share oleh ${k.berkas.pemilik ?? 'orang lain'}`)
    .join('; ')
  return (
    `Ada lebih dari satu berkas bernama "${sendiri.nama}": penanda "${penandaSendiri}" = milik user ` +
    `sendiri (${sendiri.jalur}); ${daftar}. Kalau dari percakapan sudah jelas mana yang dimaksud, ` +
    'panggil onedrive_ambil dengan penanda berkas itu. Kalau belum jelas, tanya user dulu — ' +
    'jangan menebak.'
  )
}

/** Bentuk ringkas untuk model — tanpa ID panjang yang tidak dipakainya. */
export function ringkasUntukModel(b: Berkas, penanda: string): Record<string, unknown> {
  return {
    penanda,
    nama: b.nama,
    // ⚠️ Berkas share TIDAK diberi jalur: jalur selalu dicari di OneDrive user
    // sendiri, jadi "jalur" untuk berkas share hanya bisa menunjuk berkas lain.
    ...(b.dariShare
      ? { lokasi: b.lokasi, dariShare: true, pemilik: b.pemilik ?? '(tidak diketahui)' }
      : { jalur: b.jalur }),
    jenis: b.folder ? 'folder' : 'berkas',
    ukuran: b.folder ? '-' : ukuranManusiawi(b.ukuran),
    diubah: b.diubah,
    bisaDibacaAira: b.folder ? false : bisaDibaca(b.nama)
  }
}
