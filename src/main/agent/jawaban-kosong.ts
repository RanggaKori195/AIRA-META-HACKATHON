/**
 * Menjaga agar AIRA TIDAK PERNAH menyerahkan jawaban kosong.
 *
 * Latar (bug lapangan 8 Sep 2026, dilaporkan user dengan tangkapan layar):
 * pertanyaan "item apa sih yang menurun penjualannya" berakhir dengan gelembung
 * jawaban KOSONG — tiga chip tool, lalu tidak ada apa-apa. Di layar itu terlihat
 * seperti AIRA berhenti tiba-tiba/rusak.
 *
 * Sebabnya bukan crash: run-nya selesai normal. Model menulis penalaran lalu
 * BERHENTI SENDIRI tanpa menulis jawaban maupun memanggil tool — kemungkinan
 * besar setelah dua penolakan `period` beruntun membuatnya menyerah.
 *
 * ⚠️ DUGAAN PERTAMA SAYA SALAH, dan dicatat di sini supaya tidak diulang:
 * awalnya ini disimpulkan sebagai "jatah `max_tokens` habis dimakan penalaran"
 * (§33). Kesimpulan itu lahir dari membandingkan `reasoning` — yang DIAKUMULASI
 * sepanjang run — dengan `usage`, yang DITIMPA tiap iterasi sehingga hanya
 * mewakili panggilan terakhir. Dua angka itu bukan perbandingan yang sah.
 * Diuji langsung ke gateway 8 Sep 2026 (`scripts/probe-token.mjs`): tanpa
 * `max_tokens`, gateway mengembalikan `finish_reason: stop` pada 7.469 token —
 * TIDAK ADA batas yang bisa habis. the gateway admin benar.
 *
 * Yang tetap terbukti dari probe itu: saat batas MEMANG ada (`max_tokens: 100`),
 * penalaran memakannya lebih dulu dan `content` terbit 0 karakter — gejala yang
 * identik. Karena itu kedua sebab dibedakan lewat `finish_reason`, bukan ditebak.
 *
 * ⚠️ Modul ini TIDAK memperbaiki sebab model menyerah. Ia memastikan
 * kegagalannya TERLIHAT dan bisa ditindaklanjuti user, bukan muncul sebagai
 * layar hampa yang tidak bisa dibedakan dari aplikasi rusak.
 */

/** Ditambahkan saat jatah keluaran habis sebelum jawaban sempat ditulis. */
export const PESAN_TOKEN_HABIS =
  'AIRA kehabisan jatah keluaran sebelum sempat menulis jawabannya — ' +
  'seluruh jatah terpakai untuk penalaran internal. Datanya sendiri sudah ' +
  'terambil (lihat langkah di atas). Coba tanyakan ulang dengan lebih spesifik, ' +
  'misalnya sebut periode dan jenis rinciannya, supaya penalarannya lebih pendek.'

/** Ditambahkan saat model berhenti tanpa menulis apa pun, sebab lain. */
export const PESAN_TANPA_JAWABAN =
  'AIRA selesai memproses tapi tidak menghasilkan teks jawaban. ' +
  'Ini bukan hasil yang benar — silakan tanyakan ulang, dan kalau berulang, ' +
  'laporkan lewat tombol Laporkan.'

/** Ditambahkan saat tidak ada tool yang jalan DAN tidak ada teks. */
export const PESAN_KOSONG_TANPA_TOOL =
  'AIRA tidak menghasilkan jawaban apa pun untuk pertanyaan ini. ' +
  'Coba ulangi dengan kalimat yang berbeda.'

/**
 * Dorongan yang disisipkan ke riwayat saat model berhenti tanpa menulis apa pun,
 * sebelum diulang SEKALI.
 *
 * ⚠️ Sengaja TIDAK memaksa `tool_choice: 'required'`. Toolnya sudah jalan dan
 * hasilnya sudah ada di riwayat; yang kurang adalah jawabannya. Memaksa panggilan
 * tool lagi akan mengulang kegagalan 25 Agu 2026 — model yang dipaksa tanpa tahu
 * harus mengisi apa akan mengarang argumennya.
 *
 * ⚠️ Kalimat terakhir wajib ada. Tanpa jalan keluar "katakan apa adanya", dorongan
 * ini berubah jadi tekanan untuk menjawab apa pun — dan model yang ditekan
 * menjawab akan mengarang, persis yang seluruh arsitektur AIRA hindari.
 */
export const DORONGAN_JAWAB =
  'Kamu belum menuliskan jawaban apa pun. Tulis jawabannya sekarang untuk user, ' +
  'berdasarkan hasil tool yang sudah ada di atas. Jangan memanggil tool lagi. ' +
  'Kalau hasil tool memang belum cukup untuk menjawab, katakan apa adanya dan ' +
  'sebutkan apa yang kurang — jangan mengarang angka.'

export interface KeadaanAkhir {
  /** Teks jawaban yang terkumpul. */
  content: string
  /** `finish_reason` dari gateway pada giliran terakhir. */
  finishReason?: string
  /** Berapa tool yang benar-benar dijalankan sepanjang run. */
  jumlahTool: number
}

/**
 * Mengembalikan teks pengganti bila jawabannya kosong, atau `null` bila
 * jawabannya memang ada (dan karena itu tidak perlu disentuh).
 *
 * ⚠️ Hanya menambah saat BENAR-BENAR kosong. Guard yang ikut menempel pada
 * jawaban yang sudah berisi akan mengotori jawaban yang baik — kesalahan yang
 * sudah pernah terjadi pada `verify-guard` versi pertama (§26), yang membuang
 * kalimat jujur tiga menit setelah dipasang.
 */
export function pesanBilaKosong({ content, finishReason, jumlahTool }: KeadaanAkhir): string | null {
  if (content.trim().length > 0) return null
  if (finishReason === 'length') return PESAN_TOKEN_HABIS
  if (jumlahTool > 0) return PESAN_TANPA_JAWABAN
  return PESAN_KOSONG_TANPA_TOOL
}
