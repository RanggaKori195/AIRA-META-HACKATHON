// Skill yang dimuat OTOMATIS oleh kode dari kalimat user, bukan menunggu model
// memanggil `load_skill`.
//
// ⚠️ Kenapa di kode (18 Sep 2026). Skill di AIRA baru bekerja kalau model 27B
// memilih memanggil `load_skill` sendiri — dan project ini sudah berkali-kali
// mencatat model lokal TIDAK memanggil tool yang seharusnya (aturan 17/19, pola
// `menyinggungPanduan`). Untuk RCA, kegagalannya bukan error melainkan laporan
// yang terlihat rapi tapi kerangkanya dikarang: tanpa 5 Whys berbasis bukti,
// tanpa larangan menyalahkan orang, dan dengan kronologi yang diisi tebakan.
// Karena itu isi skill ditempelkan langsung ke system prompt giliran itu.
//
// Modul murni supaya ter-cover unit test.

/**
 * Kosakata RCA eksplisit. Cukup satu untuk memicu.
 *
 * ⚠️ Akhiran Indonesia ("penyebabnya", "masalahnya") mematikan `\b` di ujung
 * kanan (aturan 26), jadi pakai `\w*`.
 */
const RCA_EKSPLISIT =
  /\brca\b|\broot[- ]?cause\w*|\bakar\s+(masalah|penyebab|persoalan)\w*|\b5\s*(why|whys|kenapa|mengapa)\b|\bfive\s+whys?\b|\bfish\s?bone\w*|\bishikawa\b|\bcapa\b/i

/** "analisa/telusuri/investigasi penyebab…" */
const MINTA_TELUSUR =
  /\b(analisa|analisis|analisakan|analisislah|telusuri|telusur|investigasi|selidiki|cari(kan)?|temukan|bedah)\s+(apa\s+)?(penyebab|sebab|pemicu|biang)\w*|\b(analy[sz]e|investigate|find|trace|determine|identify)\s+(the\s+)?(cause|causes|reason)\b/i

/**
 * Tanda bahwa yang ditelusuri adalah KEJADIAN operasional.
 *
 * ⚠️ Ini yang menjaga pemicu tetap sempit. "sales turun, analisa penyebabnya"
 * adalah pertanyaan data untuk menu Sales — memaksakan kerangka 5 Whys di sana
 * mengganti jawaban angka dengan formulir.
 */
const KEJADIAN =
  /\b(mati|down|rusak|error|eror|gagal|insiden|kejadian|gangguan|terganggu|macet|mogok|hang|terlambat|telat|molor|tertunda|hilang|tertukar|ditolak|reject\w*|komplain\w*|keluhan|kontaminasi|terkontaminasi|salah\s+(hasil|label|sampel|kirim)|out\s+of\s+control|ooc|downtime|broke|broken|failure|failed|incident|outage|delay|delayed|late|lost|mix-?up|mixed\s+up|swapped|rejected|complaints?|contaminat\w*|wrong\s+(result|label|sample))\b/i

/**
 * Tanda pekerjaan KODE. "analisa penyebab error di script ini" adalah debugging,
 * dan untuk itu AIRA punya ruang uji + `search_code` — bukan laporan RCA
 * ber-Fishbone 6M.
 */
const KODE =
  /\b(kode|kodingan|coding|script|skrip|fungsi|function|stack\s*trace|typescript|javascript|python|exception|compile|kompil|npm|syntax)\w*/i

export interface SkillOtomatis {
  nama: string
  alasan: string
}

/**
 * Skill yang wajib dimuat untuk kalimat ini, atau null.
 *
 * Sengaja sempit: skill yang ikut pada pertanyaan yang tidak memintanya
 * menambah ribuan token dan membelokkan bentuk jawaban. Kalimat yang lolos dari
 * sini tetap bisa memakai skillnya lewat `load_skill` biasa.
 */
export function skillOtomatisUntuk(teks: string): SkillOtomatis | null {
  const t = teks.trim()
  if (!t) return null
  if (KODE.test(t)) return null
  if (RCA_EKSPLISIT.test(t)) return { nama: 'root-cause-analysis', alasan: 'kosakata RCA' }
  if (MINTA_TELUSUR.test(t) && KEJADIAN.test(t)) {
    return { nama: 'root-cause-analysis', alasan: 'telusur penyebab kejadian' }
  }
  return null
}

/** Blok system prompt untuk skill yang dimuat otomatis. */
export function blokSkillOtomatis(nama: string, isi: string): string {
  return (
    `\n\nPANDUAN KERJA "${nama}" SUDAH DIMUAT untuk permintaan ini (tidak perlu load_skill). ` +
    'Ikuti langkah dan aturannya:\n' +
    isi +
    '\n'
  )
}
