// Argumen tool-call dari model — modul MURNI, ter-test.
//
// ⚠️ DILAPORKAN USER 25 Agu 2026. Model kehabisan jatah token DI TENGAH menulis
// argumen tool, menghasilkan JSON yang putus:
//
//   {"period": "custom", "from": "2026-05-25", "to": "2026-08-24", "comparePeriod": "custom
//
// `executeToolCall` sebenarnya SUDAH menangani ini dengan benar — argumennya
// gagal diparse, tool tidak dijalankan, dan model diberi pesan error. Yang
// membunuh justru SALINANNYA DI RIWAYAT: potongan itu ikut didorong apa adanya
// ke `history`, dan begitu riwayat dikirim ulang pada iterasi berikutnya,
// gateway menolak SELURUH permintaan:
//
//   HTTP 400 — Unterminated string starting at: line 1 column 81 (char 80)
//
// Akibatnya bukan "satu tool gagal" melainkan seluruh jawaban mati di tengah,
// sesudah sebagian teksnya sempat tampil di layar. Satu argumen rusak
// meracuni percakapan yang sisanya sehat.
//
// Perbaikannya di sini: yang masuk RIWAYAT selalu JSON yang sah. Argumen
// aslinya tetap dipakai apa adanya saat mengeksekusi tool, supaya pesan
// errornya tetap jujur menggambarkan apa yang model tulis.

/** Apakah argumen ini JSON object yang sah (bukan array, bukan null, bukan potongan). */
export function argumenSah(raw: string): boolean {
  if (!raw || !raw.trim()) return true // kosong = tidak ada argumen, itu sah
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
  } catch {
    return false
  }
}

/**
 * Argumen yang aman didorong ke riwayat percakapan.
 *
 * Yang rusak diganti `{}` — BUKAN dibuang bersama tool call-nya. Tool call
 * tetap harus ada di riwayat karena setiap `tool_call_id` wajib punya pasangan
 * pesan `role: 'tool'`; menghapus salah satunya membuat percakapan tidak sah
 * dengan cara yang berbeda.
 */
export function argumenUntukRiwayat(raw: string): string {
  return argumenSah(raw) ? raw || '{}' : '{}'
}

/**
 * Pesan yang dikirim balik ke model saat argumennya rusak.
 *
 * Sengaja menyebutkan SEBABNYA (kehabisan ruang) dan LANGKAH BERIKUTNYA
 * (persingkat), bukan sekadar "tidak valid". Model 27B yang cuma diberi tahu
 * ada error cenderung mengulang persis kesalahan yang sama.
 */
export const PESAN_ARGUMEN_RUSAK =
  'Argumen tool yang kamu kirim BUKAN JSON yang lengkap — sepertinya terpotong di tengah. ' +
  'Panggil ulang tool ini dengan argumen yang LEBIH RINGKAS: isi hanya parameter yang benar-benar ' +
  'perlu, dan jangan menulis penjelasan panjang sebelum memanggil tool. Jangan mengarang hasilnya.'
