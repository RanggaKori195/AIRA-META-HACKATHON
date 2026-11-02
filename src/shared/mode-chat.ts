import type { ChatMode } from './ipc'

// Mode percakapan yang sah — SATU definisi untuk penyimpanan (db.ts), penegakan
// (chatSend & sendChat), dan tampilan riwayat.
//
// ⚠️ Lahir 13 Okt 2026: db.ts dulu mencocokkan daftar tangan
// 'sales' | 'masterdata' | 'general'. Mode `lab` dan `onedrive` yang ditambahkan
// kemudian tidak pernah masuk daftar itu, sehingga percakapan TAT Sample dan
// Microsoft 365 yang dibuka lagi dari riwayat berjalan sebagai Task Baru —
// aturan 31 terulang tanpa satu pun galat.
//
// `Record<ChatMode, true>` membuat tsc MENOLAK build bila kelak ada mode baru di
// `ChatMode` yang lupa ditambahkan di sini.
const SEMUA: Record<ChatMode, true> = {
  general: true,
  sales: true,
  masterdata: true,
  lab: true,
  reagent: true,
  onedrive: true
}

export const MODE_CHAT = Object.keys(SEMUA) as readonly ChatMode[]

/** Mode tersimpan yang sah, atau `null` (sesi lama tanpa mode / nilai asing — tidak ditebak). */
export function modeSah(nilai: unknown): ChatMode | null {
  return typeof nilai === 'string' && Object.prototype.hasOwnProperty.call(SEMUA, nilai)
    ? (nilai as ChatMode)
    : null
}

/**
 * Mode yang BENAR-BENAR dipakai sebuah giliran: mode tersimpan percakapan menang
 * atas kiriman renderer (aturan 31); percakapan baru memakai kiriman renderer.
 */
export function modeEfektif(tersimpan: ChatMode | null, diminta: ChatMode | undefined): ChatMode {
  return tersimpan ?? diminta ?? 'general'
}
