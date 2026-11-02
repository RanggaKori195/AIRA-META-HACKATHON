import type { GrupRingkas, PesanChatIpc, RekanChat } from '@shared/ipc'
// ⚠️ Impor NILAI memakai jalur relatif, bukan alias `@shared`. Berkas ini diuji
// lewat `npx tsx --test`, yang tidak membaca alias milik tsconfig renderer —
// alias di sini membuat test gagal dimuat. (Impor tipe di atas aman: ia hilang
// saat dikompilasi.)
import { teksSistem } from '../../../../shared/chat-sistem'

// Pembantu MURNI untuk panel pesan. Tanpa React, tanpa window — supaya bisa
// diuji (`tests/chat-ui.test.ts`). Semua yang menentukan APA yang tampil ada di
// sini; komponen hanya menentukan BAGAIMANA ia tampil.

/** Satu baris di daftar percakapan: grup atau orang. */
export type ItemPercakapan =
  | { jenis: 'grup'; kunci: string; grup: GrupRingkas }
  | { jenis: 'orang'; kunci: string; rekan: RekanChat }

export function kunciGrup(id: string): string {
  return `grup:${id}`
}

export function kunciOrang(username: string): string {
  return `orang:${username.toLowerCase()}`
}

/**
 * Menyusun daftar ala WhatsApp: percakapan yang punya pesan di atas, diurutkan
 * menurut pesan terakhir; rekan yang belum pernah diajak bicara di bawahnya.
 *
 * ⚠️ Diurutkan menurut ID pesan, bukan jam. Pesan pribadi dan pesan grup memakai
 * urutan id yang SAMA di database, jadi id yang lebih besar pasti lebih baru —
 * sementara jam laptop pengirim bisa meleset beberapa menit.
 */
export function susunDaftar(
  rekan: readonly RekanChat[],
  grup: readonly GrupRingkas[]
): { percakapan: ItemPercakapan[]; rekanLain: ItemPercakapan[] } {
  const denganPesan: Array<{ item: ItemPercakapan; id: bigint }> = []
  const rekanLain: ItemPercakapan[] = []

  for (const g of grup) {
    const item: ItemPercakapan = { jenis: 'grup', kunci: kunciGrup(g.id), grup: g }
    // Grup yang baru dibuat SELALU punya pesan sistem "membuat grup", jadi
    // hampir tidak pernah jatuh ke sini — tapi kalau jatuh, tetap ditampilkan.
    denganPesan.push({ item, id: g.terakhir ? BigInt(g.terakhir.id) : 0n })
  }
  for (const r of rekan) {
    const item: ItemPercakapan = { jenis: 'orang', kunci: kunciOrang(r.username), rekan: r }
    if (r.terakhir) denganPesan.push({ item, id: BigInt(r.terakhir.id) })
    else rekanLain.push(item)
  }

  denganPesan.sort((a, b) => (a.id === b.id ? 0 : a.id > b.id ? -1 : 1))
  return { percakapan: denganPesan.map((x) => x.item), rekanLain }
}

export function namaItem(item: ItemPercakapan): string {
  return item.jenis === 'grup' ? item.grup.nama : item.rekan.username
}

export function belumItem(item: ItemPercakapan): number {
  return item.jenis === 'grup' ? item.grup.belumDibaca : item.rekan.belumDibaca
}

export function terakhirItem(item: ItemPercakapan): PesanChatIpc | null {
  return item.jenis === 'grup' ? item.grup.terakhir : item.rekan.terakhir
}

/** Pencarian di daftar: nama grup / username, tanpa peka huruf besar. */
export function cocokCari(item: ItemPercakapan, q: string): boolean {
  const kata = q.trim().toLowerCase()
  if (!kata) return true
  return namaItem(item).toLowerCase().includes(kata)
}

/** "budi.santoso" -> "BS", "andi" -> "AN", "Tim Lab QA" -> "TL". */
export function inisial(nama: string): string {
  const bagian = nama
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean)
  if (bagian.length === 0) return '?'
  if (bagian.length === 1) return bagian[0].slice(0, 2).toUpperCase()
  return (bagian[0][0] + bagian[1][0]).toUpperCase()
}

/**
 * Warna avatar & nama pengirim — tetap untuk orang yang sama.
 *
 * Di grup, warna nama adalah cara tercepat membedakan siapa yang bicara tanpa
 * membaca namanya. Warna yang berubah tiap dimuat ulang merusak itu.
 */
const PALET = ['#2f6f3e', '#1f6f8b', '#8a5a00', '#7b3fa0', '#b3261e', '#3a5a9b', '#00796b', '#9c4221']

export function warnaNama(nama: string): string {
  let h = 0
  for (const c of nama.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PALET[h % PALET.length]
}

function awalHari(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

const HARI = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const HARI_PENDEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function selisihHari(iso: string, sekarang: Date): number {
  return Math.round((awalHari(sekarang) - awalHari(new Date(iso))) / 86_400_000)
}

export function jamPesan(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Pemisah tanggal di dalam percakapan: "Hari ini", "Kemarin", "Senin", "12 Sep 2026". */
export function labelTanggal(iso: string, sekarang: Date = new Date()): string {
  const beda = selisihHari(iso, sekarang)
  if (beda <= 0) return 'Today'
  if (beda === 1) return 'Yesterday'
  const d = new Date(iso)
  if (beda < 7) return HARI[d.getDay()]
  return `${BULAN[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

/** Waktu di daftar percakapan — ringkas, seperti WhatsApp. */
export function waktuDaftar(iso: string, sekarang: Date = new Date()): string {
  const beda = selisihHari(iso, sekarang)
  if (beda <= 0) return jamPesan(iso)
  if (beda === 1) return 'Yesterday'
  const d = new Date(iso)
  if (beda < 7) return HARI_PENDEK[d.getDay()]
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`
}

/** Apakah dua pesan jatuh di hari yang berbeda — penentu pemisah tanggal. */
export function hariBaru(sebelum: PesanChatIpc | undefined, ini: PesanChatIpc): boolean {
  if (!sebelum) return true
  return awalHari(new Date(sebelum.createdAt)) !== awalHari(new Date(ini.createdAt))
}

/** Status di bawah nama orang pada kepala ruang chat. */
export function statusOrang(rekan: RekanChat, sekarang: Date = new Date()): string {
  if (rekan.online) return 'online'
  if (!rekan.lastSeen) return 'never seen online'
  const beda = selisihHari(rekan.lastSeen, sekarang)
  if (beda <= 0) return `last seen today ${jamPesan(rekan.lastSeen)}`
  if (beda === 1) return `last seen yesterday ${jamPesan(rekan.lastSeen)}`
  return `last seen ${labelTanggal(rekan.lastSeen, sekarang)}`
}

/**
 * Cuplikan pesan terakhir di daftar percakapan.
 *
 * ⚠️ Pesan yang dihapus WAJIB tampil sebagai "Pesan ini dihapus", bukan string
 * kosong — baris daftar yang kosong terlihat seperti percakapan yang rusak.
 */
export function cuplikan(p: PesanChatIpc | null, saya: string, diGrup: boolean): string {
  if (!p) return ''
  if (p.jenis) return teksSistem(p.jenis, p.pengirim, p.target, saya)
  if (p.dihapusAt) return '🚫 This message was deleted'
  const dariSaya = p.pengirim.toLowerCase() === saya.toLowerCase()
  const isi = p.isi.trim() || (p.lampiranNama ? `📎 ${p.lampiranNama}` : '')
  const awalan = dariSaya ? 'You: ' : diGrup ? `${p.pengirim}: ` : ''
  return `${awalan}${isi}`.replace(/\s+/g, ' ')
}

/**
 * Tanda terkirim/dibaca untuk pesan pribadi SAYA.
 *
 * Grup sengaja tanpa tanda "dibaca": itu butuh satu baris per pesan per anggota
 * di database produksi. Pesan orang lain juga tanpa tanda.
 */
export function tandaBaca(p: PesanChatIpc, saya: string): '✓' | '✓✓' | null {
  if (p.grupId || p.jenis || p.dihapusAt) return null
  if (p.pengirim.toLowerCase() !== saya.toLowerCase()) return null
  return p.dibacaAt ? '✓✓' : '✓'
}

// --- Tampilan Pesan tiga kolom (30 Sep 2026) ---------------------------------

const LABEL_ROLE: Record<string, string> = {
  super_admin: 'Super Admin',
  direktur: 'Director',
  manager: 'Manager',
  spv: 'SPV',
  staff: 'Staff'
}

/** "super_admin" -> "Super Admin". Role asing ditampilkan apa adanya, tidak ditebak. */
export function labelRole(role: string | null): string {
  if (!role) return ''
  return LABEL_ROLE[role] ?? role
}

/** Keterangan di bawah nama orang: divisi bila ada, kalau tidak role-nya. */
export function jabatanRekan(r: RekanChat): string {
  return r.divisi?.trim() || labelRole(r.role)
}

const BULAN_PANJANG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

/** Pemisah tanggal panjang: "Hari ini, 26 September 2026" / "Kemarin, …" / "Senin, …". */
export function labelTanggalPanjang(iso: string, sekarang: Date = new Date()): string {
  const d = new Date(iso)
  const tanggal = `${BULAN_PANJANG[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
  const beda = selisihHari(iso, sekarang)
  if (beda <= 0) return `Today, ${tanggal}`
  if (beda === 1) return `Yesterday, ${tanggal}`
  return `${HARI[d.getDay()]}, ${tanggal}`
}

export type SaringPesan = 'semua' | 'belum' | 'grup' | 'favorit'

/**
 * Saringan tab di atas daftar. Murni: `favorit` diberikan pemanggil (disimpan per
 * username di laptop), jadi aturan "apa masuk tab mana" bisa diuji tanpa layar.
 */
export function saringItem(
  item: ItemPercakapan,
  saring: SaringPesan,
  favorit: ReadonlySet<string>
): boolean {
  if (saring === 'belum') return belumItem(item) > 0
  if (saring === 'grup') return item.jenis === 'grup'
  if (saring === 'favorit') return favorit.has(item.kunci)
  return true
}
