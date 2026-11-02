// Aturan pencarian riwayat percakapan — modul MURNI, bisa diuji tanpa database.

/**
 * Kata yang tidak membedakan apa pun dalam pertanyaan bahasa Indonesia.
 *
 * Dibuang dari query pencarian. Tanpa ini, "kapan saya pernah tanya soal
 * Kariadi" akan mencari juga "kapan", "saya", "pernah", "tanya", "soal" — dan
 * karena SETIAP percakapan memuat kata-kata itu, hasil teratasnya jadi percakapan
 * acak yang kebetulan paling banyak mengulang kata sambung. Yang dicari adalah
 * kata yang khas: "Kariadi".
 */
const KATA_UMUM = new Set([
  'yang', 'saya', 'aku', 'kamu', 'kita', 'dulu', 'kemarin', 'lalu', 'pernah', 'sudah',
  'belum', 'apa', 'apakah', 'siapa', 'kapan', 'mana', 'kenapa', 'mengapa', 'bagaimana',
  'gimana', 'berapa', 'soal', 'tentang', 'tanya', 'nanya', 'menanyakan', 'bertanya',
  'cari', 'carikan', 'coba', 'tolong', 'itu', 'ini', 'dan', 'atau', 'dengan', 'untuk',
  'dari', 'pada', 'ke', 'di', 'ada', 'adalah', 'jadi', 'bisa', 'waktu', 'minggu',
  'bulan', 'hari', 'chat', 'percakapan', 'riwayat', 'history', 'obrolan', 'ingat',
  'lagi', 'kok', 'ya', 'sih', 'aja', 'saja', 'juga', 'akan', 'kalau', 'bahwa'
])

/**
 * Menyusun ekspresi MATCH untuk FTS5 dari kalimat bebas.
 *
 * ⚠️ Query user TIDAK BOLEH masuk apa adanya ke `MATCH`. FTS5 punya sintaksnya
 * sendiri — tanda kutip, `*`, `-`, `NEAR`, `OR`, dan tanda kurung semuanya
 * bermakna — sehingga pertanyaan sewajarnya seperti «pelanggan "Pasien Pribadi"
 * (yang berhenti)» akan dijawab dengan SQL error, bukan hasil pencarian. Setiap
 * kata karena itu dikutip sebagai frasa literal.
 *
 * Digabung dengan OR, bukan AND: pertanyaan orang memuat kata yang tidak persis
 * ada di percakapan lamanya, dan AND membuat satu kata meleset saja menghasilkan
 * nol hasil. Urutannya nanti ditentukan bm25 lalu reranker.
 *
 * Mengembalikan `null` bila tidak ada kata yang layak dicari — pemanggil harus
 * menanganinya sebagai "tidak bisa dicari", bukan mengirim MATCH kosong.
 */
export function ekspresiFts(query: string): string | null {
  const kata = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((k) => k.length >= 3 && !KATA_UMUM.has(k))
    // Angka murni dibuang: "2026" ada di hampir semua percakapan tentang
    // penjualan dan tidak membedakan apa pun.
    .filter((k) => !/^\d+$/.test(k))

  const unik = [...new Set(kata)].slice(0, 12)
  if (unik.length === 0) return null
  // Kutip ganda di dalam kata dilipat-gandakan — itu cara FTS5 meloloskan tanda
  // kutip literal di dalam frasa berkutip.
  return unik.map((k) => `"${k.replace(/"/g, '""')}"`).join(' OR ')
}

/**
 * Potongan teks di sekitar kata yang cocok.
 *
 * Dipakai supaya hasil pencarian tidak mengembalikan seluruh jawaban AIRA yang
 * bisa puluhan ribu karakter — itu akan membanjiri context model dan memicu
 * overflow yang penanganannya sudah jadi masalah tersendiri.
 */
export function cuplikSekitar(teks: string, kataKunci: string[], maks = 320): string {
  const bersih = teks.replace(/\s+/g, ' ').trim()
  if (bersih.length <= maks) return bersih

  const rendah = bersih.toLowerCase()
  let posisi = -1
  for (const k of kataKunci) {
    const p = rendah.indexOf(k.toLowerCase())
    if (p >= 0 && (posisi < 0 || p < posisi)) posisi = p
  }
  if (posisi < 0) return `${bersih.slice(0, maks)}…`

  const mulai = Math.max(0, posisi - Math.floor(maks / 3))
  const akhir = Math.min(bersih.length, mulai + maks)
  return `${mulai > 0 ? '…' : ''}${bersih.slice(mulai, akhir)}${akhir < bersih.length ? '…' : ''}`
}

/**
 * Apakah kalimat user menyinggung percakapan SEBELUMNYA.
 *
 * ⚠️ Dipakai guard di `orchestrator.ts`: kalau pertanyaannya seperti ini dan
 * model menjawab TANPA memanggil `search_history`, jawabannya dibuang dan run
 * diulang dengan `tool_choice: 'required'`. Pola yang sama dengan guard anti-halu
 * mode data.
 *
 * Alasannya keras: riwayat chat TIDAK ADA di dalam context model — yang dikirim
 * hanya beberapa pesan terakhir dari sesi yang sedang dibuka. Jadi jawaban atas
 * "kemarin saya tanya apa" yang lahir tanpa tool bukan ingatan yang samar,
 * melainkan karangan utuh yang terdengar meyakinkan.
 *
 * Sengaja menuntut DUA unsur — penunjuk waktu lampau DAN kata percakapan —
 * supaya "bulan lalu penjualannya berapa" (pertanyaan data, bukan riwayat) tidak
 * ikut tertangkap.
 */
const PENUNJUK_LAMPAU =
  /\b(kemarin|kemaren|tadi|dulu|sebelumnya|lalu|waktu itu|minggu lalu|bulan lalu|pernah|terakhir kali|sempat)\b/i

// ⚠️ Berakhiran `\w*` — bukan kata utuh.
//
// Versi pertama memakai `\b(jawab|tanya|bahas)\b` dan MELEWATKAN "waktu itu
// jawabANNYA berapa ya" — kalimat paling wajar untuk menanyakan percakapan lama.
// Bahasa Indonesia menempelkan imbuhan langsung ke katanya (jawaban, jawabnya,
// menanyakan, dibahas), jadi batas kata di ujung kanan justru mematikan
// deteksinya. Tertangkap unit test, bukan saat dipakai.
// Imbuhan bahasa Indonesia menempel di KEDUA ujung: "membahas", "dibahas",
// "jawabannya", "menanyakan". Karena itu akarnya dikelilingi awalan yang
// mungkin (`me|mem|men|meng|di|ber|ter|per`) dan akhiran bebas (`\w*`) — bukan
// batas kata di dua sisi seperti versi pertama, yang melewatkan justru bentuk
// yang paling sering dipakai orang.
const KATA_PERCAKAPAN =
  /\b(?:me|mem|men|meng|di|ber|ter|per)?(tanya|nanya|jawab|bahas|obrol|omong|bilang|diskusi|cakap)\w*\b|\b(percakapan|chat|riwayat chat)\b/i

export function menyinggungRiwayat(teks: string): boolean {
  return PENUNJUK_LAMPAU.test(teks) && KATA_PERCAKAPAN.test(teks)
}

/** Kata yang benar-benar dipakai mencari — untuk ditampilkan & untuk cuplikan. */
export function kataPencarian(query: string): string[] {
  const ekspresi = ekspresiFts(query)
  if (!ekspresi) return []
  return [...ekspresi.matchAll(/"([^"]+)"/g)].map((m) => m[1])
}
