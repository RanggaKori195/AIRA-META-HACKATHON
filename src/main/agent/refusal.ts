// Deteksi "false refusal": model mengaku tidak punya tool padahal tool-nya dikirim.
// Gejala tool overload pada model lokal (makin sering seiring bertambahnya tool).
// Modul murni supaya ter-cover unit test.

/** Bentuk umum: "tidak memiliki tool ...", "belum punya akses ..." */
const GENERIC_REFUSAL =
  /(tidak|belum)\s+(memiliki|punya|tersedia|mendukung|dapat mengakses|bisa mengakses)[^.\n]{0,60}\b(tool|akses|kemampuan|fitur|internet|browser|pencarian)\b|(don'?t|do not|cannot|can'?t)\s+(have|access)[^.\n]{0,40}\b(tool|access|browser|internet)\b|\bno\s+(browser|internet|search)\s+(tool|access)\b/i

/**
 * Bentuk terbalik: "tool browser (browser_open) tidak tersedia".
 * Kata negasinya muncul SETELAH nama tool, sehingga pola generik di atas meleset.
 */
const NEGATION_AFTER =
  /\b(tidak|belum)\s+(tersedia|aktif|bisa digunakan|dapat digunakan|didukung|terpasang|diaktifkan)\b|\b(not available|unavailable|is disabled|not enabled)\b/i

export function isFalseRefusal(content: string, toolNames: string[] = []): boolean {
  if (!content) return false
  if (GENERIC_REFUSAL.test(content)) return true
  // Menyebut nama tool yang NYATA ada di daftar, dibarengi kalimat negasi.
  if (NEGATION_AFTER.test(content) && toolNames.some((name) => content.includes(name))) return true
  return false
}
