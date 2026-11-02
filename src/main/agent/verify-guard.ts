// Membuang klaim "sudah saya uji / sudah saya jalankan" yang tidak pernah
// terjadi. Modul MURNI, ter-test.
//
// Permintaan manajemen 21 Agu 2026, dan keluhannya persis pola yang sudah
// dikenal di seluruh industri:
//
//   user -> "betulkan kodingan ini: xxx"
//   LLM  -> menyerahkan berkas TANPA menjalankannya, sambil terdengar yakin
//   user -> dicoba, error lagi
//
// Yang menyakitkan bukan kodenya salah — itu wajar dan bisa diperbaiki.
// Yang menyakitkan adalah KALIMATNYA: "sudah saya tes, jalan normal". Kalimat
// itu memindahkan beban verifikasi ke user sambil meyakinkannya bahwa
// verifikasi sudah dilakukan. Persis kegagalan yang sama bentuknya dengan
// "dokumen terpotong" (lihat `truncation-guard.ts`): jawaban yang salah pada
// bagian yang paling dipercaya pembaca.
//
// Kenapa guard, bukan imbauan di system prompt: project ini sudah membayar
// pelajaran itu tiga kali (§11d HANDOFF). Imbauan menurunkan peluang; yang
// menutup adalah kode yang memeriksa BUKTI. Dan buktinya ada — hasil tool pada
// giliran ini menyatakan apakah ada perintah yang benar-benar jalan dan lolos.

import { buangKalimatYang } from './truncation-guard'

/**
 * Kata kerja yang menandakan "kode ini dijalankan/diperiksa", beserta imbuhan
 * bahasa Indonesia.
 *
 * ⚠️ Ditulis sebagai SATU definisi yang dipakai dua regex (kata & penyangkalan).
 * Daftar yang disalin akan menyimpang: menambah bentuk baru di daftar kata tapi
 * lupa di daftar penyangkalan berarti "belum saya <bentuk baru>" ikut terbuang —
 * guard menghapus justru kalimat yang paling jujur. Aturan yang sama dipakai
 * `memuatNilaiData` di memori/rules.ts.
 *
 * Daftar imbuhan sengaja TIDAK memuat "ber-": "berjalan" muncul di kalimat yang
 * bukan klaim pengujian ("programnya sudah berjalan lambat"), dan membuang
 * kalimat semacam itu adalah kerusakan, bukan perbaikan.
 */
const STEM_UJI =
  '(?:meng|mem|men|me|di|ter|pe|peng)?(?:uji|tes|test|jalankan|coba|verifikasi|validasi|eksekusi|kompilasi|compile|build|debug)\\w*'

// Kata kerja ujinya TIDAK lagi diperiksa sendirian — ia hanya berarti bila
// terikat pada penanda keberhasilan (lihat `KLAIM_SELESAI` di bawah).

/**
 * Penanda bahwa kalimatnya bicara tentang KODE, bukan hal lain.
 *
 * Tanpa ini guard akan menjaring kalimat seperti "sudah saya cek datanya" di
 * mode sales — pembeda yang sama dengan `KONTEKS_BACA` pada guard pemotongan.
 */
// ⚠️ Akhiran -nya/-ku/-mu/-an mematikan `\b` di ujung kata, dan justru bentuk
// itulah yang dipakai orang: "kodenya", "fungsinya", "scriptnya". Versi pertama
// guard ini memakai `\b` di kedua ujung dan akibatnya DIAM pada kalimat paling
// khas yang ingin ditangkap ("saya sudah memverifikasi fungsinya berjalan
// normal") — guard yang terlihat terpasang tapi tidak pernah menyala.
// Kata pendek yang berbahaya bila dilonggarkan tetap `\b`: "tes" akan menjaring
// "testimoni", "bug" menjaring "bugar".
const KONTEKS_KODE =
  /\b(kode|koding|code|coding|source|script|skrip|program|fungsi|function|method|berkas|file|perintah|command|terminal|typescript|javascript|error|exception|syntax|sintaks|compile|kompilasi|output|debug)\w*|\b(class|node|npm|npx|tsc|tsx|bug|test|tes|build|exit code|hasilnya)\b/i

/**
 * Penanda bahwa pengujiannya SUDAH SELESAI dan BERHASIL.
 *
 * ⚠️ Versi pertama cukup dengan kata "saya"/"sudah" di mana pun dalam kalimat,
 * dan itu SALAH BESAR — terbukti di lapangan 21 Agu 2026, beberapa menit setelah
 * dipasang. Yang dibuangnya justru narasi AIRA yang paling jujur:
 *
 *   "Test file-nya ada sintaks yang salah ketik, saya rapikan dulu"
 *   "Saya terjebak loop menulis ulang file test yang isinya sama."
 *   "tulis ulang file test secara benar"
 *
 * Ketiganya orang-pertama dan menyebut "test"/"file", jadi lolos semua syarat —
 * padahal tak satu pun mengaku sudah menguji. Ini persis failure mode yang
 * ditulis di kepala berkas ini: guard yang menghapus KEBENARAN lebih buruk
 * daripada tidak ada guard, karena kerusakannya tidak terlihat siapa pun.
 *
 * Karena itu penandanya sekarang harus MENGIKAT kata kerja ujinya:
 *   (a) "sudah/telah/berhasil" MENDAHULUI kata kerja uji, atau
 *   (b) kata kerja uji DIIKUTI penanda keberhasilan, atau
 *   (c) "semua … lolos/lulus".
 *
 * Kata "benar" & "normal" sengaja TIDAK dipakai sebagai penanda keberhasilan:
 * "tulis ulang file test secara benar" bukan klaim hasil uji.
 */
const KLAIM_SELESAI = new RegExp(
  `\\b(?:sudah|telah|berhasil)\\s+(?:\\w+[\\s,]+){0,3}${STEM_UJI}` +
    `|${STEM_UJI}[\\s,]+(?:\\w+[\\s,]+){0,2}(?:berhasil|lolos|lulus|sukses|aman|tanpa error|tanpa masalah)` +
    `|\\bsemua\\s+(?:\\w+[\\s,]+){0,2}(?:lolos|lulus|berhasil|sukses)`,
  'i'
)

/**
 * English claim: "I/we" + an explicit PAST-TENSE test verb, followed within a few words by a RESULT
 * ("… and it works", "… without errors"), or "all (the) tests passed".
 *
 * ⚠️ Final review 2 Nov 2026: the first English branch anchored on bare "have/has" and on the stems
 * `run`/`verif`/`execut`/`validat`, and deleted TRUE sentences — "The function has runtime complexity
 * O(n)", "I have created a test file", "I've added validation", "I ran into a limitation". A guard that
 * deletes the truth is worse than none (rule 26), so subject, verb AND result must all be there.
 */
const KLAIM_EN =
  /\b(?:I|we)(?:'ve|\s+have)?(?:\s+(?:also|already|successfully|just))?\s+(?:tested|ran|executed|verified|run)\b.{0,60}?(?:(?:\band\s+|,\s*)(?:it\s+|they\s+|everything\s+)?(?:works|worked|passed|passes|runs\s+fine)\b|\bwithout\s+(?:any\s+)?errors?\b)|\ball\s+(?:\w+\s+){0,2}(?:tests\s+)?passed\b/i

/**
 * Penyangkalan — "belum saya uji" JUGA memuat "saya" dan "uji", tapi maknanya
 * kebalikannya dan justru kalimat jujur yang harus DIPERTAHANKAN.
 *
 * Dibatasi 0–2 kata di antara supaya "berjalan tanpa error" tidak ikut
 * tertangkap ("error" bukan kata kerja uji).
 */
const PENYANGKALAN = new RegExp(
  `\\b(?:belum|tidak|tanpa|jangan|bukan|not|never|haven't|hasn't|didn't|without)\\s+(?:\\w+\\s+){0,2}(?:${STEM_UJI}|ran\\b|run\\b|executed\\b|verified\\b)`,
  'i'
)

/** Kalimat yang MENYURUH user menguji — itu jujur, jangan dibuang. */
const ARAHAN_KE_USER =
  /\b(silakan|silahkan|kamu bisa|anda bisa|bisa kamu|untuk (menguji|mengetes|mengetest|menjalankan|mencoba|memastikan)|sebaiknya|disarankan|jalankan sendiri|perlu (diuji|dites|dicoba)|you can|you could|you should|please|to test it|to verify it|try running)\b/i

/**
 * Kalimat yang MELAPORKAN KEGAGALAN. Itu tidak pernah klaim palsu.
 *
 * ⚠️ Dipasang 27 Agu 2026 sesudah guard ini membuang kalimat yang BENAR di
 * depan user, saat menguji perbaikan browser. Yang dibuang:
 *
 *   "Maaf, saya sudah mencoba dua kali (dengan dan tanpa `www`) dan keduanya
 *    gagal dengan error koneksi (`ERR_FAILED`)."
 *
 * Lolos semua syarat karena alasan yang keliru: `KONTEKS_KODE` cocok pada kata
 * "error" (padahal itu error KONEKSI), dan `KLAIM_SELESAI` cocok pada
 * "sudah mencoba" (padahal "coba" di situ berarti "berusaha", bukan "menguji").
 * Akibatnya kalimat paling informatif di seluruh jawaban lenyap, lalu
 * `CATATAN_BELUM_DIUJI` ditempelkan pada jawaban yang tidak memuat kode
 * sebaris pun — catatan yang menyuruh user "minta AIRA menguji dulu" untuk
 * sesuatu yang tidak ada.
 *
 * Aturannya sekarang lurus: kalimat yang mengaku GAGAL adalah pengakuan, bukan
 * klaim keberhasilan. Ini lapis yang sama dengan `PENYANGKALAN` ("belum saya
 * uji") — dua-duanya kejujuran yang harus dipertahankan, dan guard yang
 * menghapus kejujuran lebih buruk daripada tidak ada guard.
 *
 * Kata "error" TELANJANG sengaja TIDAK masuk daftar: "sudah saya jalankan,
 * tidak ada error" adalah klaim keberhasilan yang sah dan harus tetap terjaring.
 */
const KABAR_GAGAL =
  /\b(gagal|galat|error koneksi|tidak berhasil|belum berhasil|masih error|masih gagal|tidak bisa dijalankan|tidak jalan|failed|fails|did not work|didn't work|connection error|could not run|couldn't run)\b/i

/** Kalimat yang mengaku sudah menjalankan/menguji kodenya. */
export function adalahKlaimUji(kalimat: string): boolean {
  if (PENYANGKALAN.test(kalimat)) return false
  if (ARAHAN_KE_USER.test(kalimat)) return false
  if (KABAR_GAGAL.test(kalimat)) return false
  return KONTEKS_KODE.test(kalimat) && (KLAIM_SELESAI.test(kalimat) || KLAIM_EN.test(kalimat))
}

/** Apakah jawaban memuat klaim seperti itu di mana pun. */
export function adaKlaimUji(teks: string): boolean {
  for (const baris of teks.split('\n')) {
    for (const k of baris.split(/(?<=[.!?])\s+/)) {
      if (k.trim() && adalahKlaimUji(k)) return true
    }
  }
  return false
}

/**
 * Membuang klaim itu dari jawaban.
 *
 * Dipakai HANYA bila tidak ada satu pun perintah yang benar-benar jalan dan
 * lolos pada giliran ini — pemanggil yang memastikan lewat
 * `toolMelaporkanUjiSukses`.
 */
export function buangKlaimUji(teks: string): { hasil: string; dibuang: string[] } {
  return buangKalimatYang(teks, adalahKlaimUji)
}

/**
 * Apakah pada giliran ini MEMANG ada perintah yang jalan dan berhasil.
 *
 * Dua bentuk bukti, dan keduanya dibaca dari keluaran tool apa adanya:
 *   - `ujiSukses: true` dari `uji_jalankan` (ruang uji, tanpa persetujuan)
 *   - `exitCode: 0` dari `run_command`/`run_background` (disetujui user)
 *
 * ⚠️ `run_command` sengaja ikut dihitung. Kalau tidak, guard ini akan MEMBUANG
 * kalimat yang BENAR — user menyetujui sebuah perintah, perintahnya jalan, lalu
 * AIRA melaporkannya dengan jujur. Guard yang menghapus kebenaran lebih buruk
 * daripada tidak ada guard sama sekali, karena ia merusak jawaban yang benar
 * tanpa ada yang bisa melihat sebabnya.
 */
export function toolMelaporkanUjiSukses(hasilTool: readonly string[]): boolean {
  for (const h of hasilTool) {
    if (/"ujiSukses"\s*:\s*true/.test(h)) return true
    if (/"exitCode"\s*:\s*0\b/.test(h)) return true
  }
  return false
}

/**
 * Ditempelkan menggantikan klaim yang dibuang.
 *
 * Sengaja menyebut apa yang harus dilakukan berikutnya. Menghapus kalimat
 * tanpa menggantinya membuat jawaban terasa netral — padahal keadaannya tidak
 * netral: kodenya memang belum terbukti jalan, dan user berhak tahu itu.
 */
export const CATATAN_BELUM_DIUJI =
  '\n\n⚠️ **System note:** the code above **has not been run in the test sandbox**, so there is no proof ' +
  'yet that it works. Ask AIRA to test it first ("please test it first") before using it.'

/**
 * Mode tempat guard ini BOLEH berjalan.
 *
 * ⚠️ Mode data (Sales, Master Data, TAT Sample) DIKECUALIKAN — dipasang 30 Sep 2026
 * sesudah dua kejadian lapangan di mana guard membuang kalimat TERPENTING jawaban:
 *
 *   TAT (29 Sep):  "41 baris berstatus Result Validated by Lab — hasilnya sudah
 *                   tervalidasi tapi belum dikirim keluar …"
 *   Master Data (30 Sep): "Saya sudah mencoba membuka isi paketnya berkali-kali
 *                   (dengan kode, nama lengkap, …) dan sistem melaporkan bahwa
 *                   tidak ada isi paket yang terdaftar …"
 *
 * Di mode data kata "kode" berarti kode ITEM/pelanggan, "tervalidasi" adalah STATUS
 * sampel, dan "sudah mencoba" berarti mencari — tidak ada satu pun yang klaim
 * menguji program. Dan klaim itu memang TIDAK MUNGKIN benar-benar terjadi di sana:
 * toolset mode data dikunci ke satu kelompok tanpa tool koding (`selectGroups`,
 * aturan 10/17). Mengecualikan mode lebih kuat daripada menambal kosakata satu per
 * satu — pola "perbaiki di struktur, bukan di daftar kata".
 */
export function guardUjiBerlakuDiMode(mode: string): boolean {
  return mode !== 'sales' && mode !== 'masterdata' && mode !== 'lab'
}
