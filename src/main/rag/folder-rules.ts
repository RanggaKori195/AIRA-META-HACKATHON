import path from 'node:path'

// Aturan murni: folder mana yang boleh masuk auto-index RAG.
//
// ⚠️ Lahir 13 Okt 2026 dari uji di aplikasi: berkas OneDrive yang diunduh
// `onedrive_ambil` ditolak `read_excel` karena folder unduhannya di luar folder
// akses, lalu model meminta izin folder itu — dan begitu disetujui, auto-index
// ikut MENGINDEKS salinan berkas OneDrive (isinya terkirim ke layanan embedding).
// Padahal mengindeks OneDrive harus pilihan sadar lewat `onedrive_index`
// (aturan 44) yang saklarnya sedang mati. Folder unduhan kini dibaca tool lewat
// `effectiveAllowedDirs`, dan di sini DIKECUALIKAN dari indeks walau user
// pernah mengizinkannya.

function normal(p: string): string {
  const r = path.resolve(p).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? r.toLowerCase() : r
}

/** `p` sama dengan `root` atau berada di dalamnya (tanpa peka huruf besar di Windows). */
export function samaAtauDiBawah(p: string, root: string): boolean {
  const a = normal(p)
  const b = normal(root)
  return a === b || a.startsWith(b + path.sep)
}

/** Memisahkan folder akses yang boleh diindeks dari yang wajib dikecualikan. */
export function pisahkanFolderIndeks(
  folder: string[],
  dikecualikan: string[]
): { indeks: string[]; dikecualikan: string[] } {
  const indeks: string[] = []
  const keluar: string[] = []
  for (const f of folder) {
    if (dikecualikan.some((x) => samaAtauDiBawah(f, x))) keluar.push(f)
    else indeks.push(f)
  }
  return { indeks, dikecualikan: keluar }
}
