// Guard: pertanyaan TENTANG AIRA SENDIRI wajib dijawab dari `cari_panduan`,
// bukan dari ingatan model.
//
// ⚠️ Kenapa ini butuh guard, bukan imbauan di prompt. Pertanyaan "kamu bisa apa
// saja" adalah pertanyaan yang PALING MUDAH dijawab model tanpa tool — ia merasa
// tahu jawabannya. Dan jawaban yang lahir begitu selalu berbentuk daftar rapi
// berisi kemampuan yang kedengarannya masuk akal: template presentasi yang tidak
// ada, integrasi email yang saklarnya mati, folder kerja yang bukan milik
// aplikasi ini. Tidak ada satu pun yang error — semuanya cuma salah.
//
// Bahayanya bukan di layar: user memercayai daftar itu, lalu MENJANJIKANNYA ke
// orang lain. Yang malu kemudian adalah orang yang menjanjikan.
//
// Modul murni supaya ter-cover unit test, dan dipasang di `runAgentLoop` dengan
// pola yang sama persis dengan `menyinggungRiwayat` (aturan 19).

/**
 * Kosakata yang menandakan pertanyaan tentang DATA, bukan tentang aplikasinya.
 *
 * ⚠️ Ini yang menjaga guard tetap sempit. "apakah kamu bisa hitung sales bulan
 * ini" berbentuk sama persis dengan "apakah kamu bisa buat PPT", tapi yang
 * pertama minta pekerjaan dan yang kedua minta penjelasan. Memaksa panggilan
 * `cari_panduan` pada yang pertama berarti menunda pekerjaan demi ceramah.
 */
const KOSAKATA_KERJA =
  /\b(sales|penjualan|omzet|omset|revenue|order|invoice|backlog|tat|rns|sampel|pasien|pelanggan|customer|item|harga|price|pks|dokter|provinsi|cabang|ytd|ramalan|forecast|proyeksi|budget|tagihan|log|server|utilisasi)\b/i

/**
 * Tanda bahwa user menunjuk BERKAS atau DATA konkret di percakapan ini.
 *
 * ⚠️ Kata "ini"/"itu" sendirian SENGAJA tidak masuk. Versi pertama memasukkannya
 * dan langsung mematikan "gimana caranya pakai menu INI" — pertanyaan panduan
 * yang paling wajar diucapkan orang. Ditemukan test, bukan saat dipakai.
 * Yang ditunjuk harus bendanya: berkas, dokumen, tabel, lampiran.
 */
const MENUNJUK_PEKERJAAN =
  /\b(berikut|terlampir|lampiran)\b|\b(file|berkas|dokumen|data|tabel|gambar|foto)\s+(ini|itu|berikut)\b/i

/**
 * "apa saja yang bisa kamu lakukan", "kamu bisa apa", "fitur apa saja",
 * "kemampuan kamu apa".
 */
const TANYA_KEMAMPUAN =
  /\b(kamu|kau|aira|lu|anda)\s+(bisa|dapat|mampu)\s+(apa|ngapain)\b|\bapa\s+(saja\s+)?yang\s+(bisa|dapat)\s+(kamu|kau|aira|anda)\b|\b(fitur|kemampuan|kebisaan)\b.*\b(apa|saja|daftar)\b|\bapa\s+(saja\s+)?(fitur|kemampuan)\b/i

/** "apakah kamu bisa membuat PPT?" — bentuk yang paling sering dipakai orang. */
const TANYA_APAKAH_BISA = /\bapa(kah)?\s+(kamu|kau|aira|anda)\s+(bisa|dapat|mampu)\b/i

/**
 * "gimana cara pakai menu ini", "cara menggunakan AIRA", "ada panduannya?".
 *
 * ⚠️ Akhiran bahasa Indonesia mematikan `\b` di ujung kanan (aturan 26):
 * "panduannya", "tutorialnya", "caranya". Karena itu `\w*`.
 */
const TANYA_CARA_PAKAI =
  /\b(panduan|tutorial|user guide|manual)\w*\b|\bcara(nya)?\s+(pakai|pake|memakai|menggunakan|guna(kan)?)\b|\b(gimana|bagaimana)\s+(cara(nya)?|langkah(nya)?)\b|\blangkah[- ]?langkah\w*\b/i

/** "AIRA itu apa sih", "kamu ini apa" — pertanyaan jati diri. */
const TANYA_SIAPA = /\b(siapa|apa)\s+(kamu|kau|aira|anda)\b|\b(kamu|aira)\s+(itu\s+)?(siapa|apa)\b/i

/**
 * Apakah kalimat ini pertanyaan TENTANG AIRA yang jawabannya ada di panduan.
 *
 * Sengaja mengembalikan `false` untuk kalimat yang membawa kosakata pekerjaan —
 * lihat komentar `KOSAKATA_KERJA`. Lebih baik melewatkan beberapa pertanyaan
 * panduan (model masih punya toolnya dan bisa memanggilnya sendiri) daripada
 * menyandera pekerjaan nyata di balik satu panggilan tool yang tidak diminta.
 */
export function menyinggungPanduan(teks: string): boolean {
  const t = teks.trim()
  if (!t) return false
  // Kalimat panjang hampir selalu berisi tugas, bukan pertanyaan tentang AIRA.
  if (t.length > 220) return false
  if (KOSAKATA_KERJA.test(t)) return false
  if (MENUNJUK_PEKERJAAN.test(t)) return false

  return (
    TANYA_KEMAMPUAN.test(t) ||
    TANYA_APAKAH_BISA.test(t) ||
    TANYA_CARA_PAKAI.test(t) ||
    TANYA_SIAPA.test(t)
  )
}
