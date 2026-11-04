// Style presets of the Gambar screen and the reader that recognises them in a saved prompt. Pure (no React, no
// window) so tests can import it directly.

export interface Gaya {
  id: string
  judul: string
  keterangan: string
  /** Ditempelkan di BELAKANG kalimat user — kalimat user tetap yang utama. */
  akhiran: string
  /**
   * Akhiran versi lama yang mungkin tersimpan di prompt gambar lama: bahasa Indonesia, lalu bahasa Inggris
   * berwarna hijau (sebelum tema biru). HANYA untuk mengenali label gaya — tidak pernah ditempelkan lagi.
   */
  akhiranLama: string[]
}

/**
 * Gaya siap pakai (padanan "Templates" di Codex). Dipilih untuk kebutuhan kerja
 * di the lab — ilustrasi slide, ikon, poster acara — bukan gaya hiburan.
 * Warna tema aplikasi disebut eksplisit karena model tidak mengenal "warna AIRA".
 */
export const GAYA: Gaya[] = [
  {
    id: 'slide',
    judul: 'Slide illustration',
    keterangan: 'Flat and clean, great for presentations',
    akhiran:
      'modern flat illustration style, clean, deep blue #1f5bb8 and sky blue #38b6f0 with white accents, plain background, no text',
    akhiranLama: [
      'gaya ilustrasi flat modern, bersih, warna hijau tua #2f6f3e dan hijau tosca dengan aksen putih, latar polos, tanpa tulisan',
      'modern flat illustration style, clean, dark green #2f6f3e and teal with white accents, plain background, no text'
    ]
  },
  {
    id: 'ikon',
    judul: 'Icon',
    keterangan: 'One simple object, bold lines',
    akhiran: 'simple single-object icon, bold line style, blue #1f5bb8, plain white background, no text',
    akhiranLama: [
      'ikon sederhana satu objek, gaya garis tebal, warna hijau #2f6f3e, latar putih polos, tanpa tulisan',
      'simple single-object icon, bold line style, green #2f6f3e, plain white background, no text'
    ]
  },
  {
    id: 'poster',
    judul: 'Event poster',
    keterangan: 'An eye-catching layout for announcements',
    akhiran:
      'eye-catching office event poster, tidy composition, blue and white colors, empty space for a title, no small text',
    akhiranLama: [
      'poster acara kantor yang menarik, komposisi rapi, warna hijau dan putih, ruang kosong untuk judul, tanpa tulisan kecil',
      'eye-catching office event poster, tidy composition, green and white colors, empty space for a title, no small text'
    ]
  },
  {
    id: 'foto',
    judul: 'Realistic photo',
    keterangan: 'Like a studio photo',
    akhiran: 'realistic studio-quality photo, soft lighting, clean background',
    akhiranLama: ['foto realistis kualitas studio, pencahayaan lembut, latar bersih']
  },
  {
    id: 'infografis',
    judul: 'Infographic background',
    keterangan: 'A backdrop for your own text',
    akhiran:
      'abstract infographic background, subtle geometric pattern, soft blue colors, lots of empty space, no text',
    akhiranLama: [
      'latar infografis abstrak, pola geometris halus, warna hijau lembut, banyak ruang kosong, tanpa tulisan',
      'abstract infographic background, subtle geometric pattern, soft green colors, lots of empty space, no text'
    ]
  },
  {
    id: 'kartun',
    judul: 'Cartoon',
    keterangan: 'Cute and friendly',
    akhiran: 'cute and friendly cartoon illustration, soft bright colors, clean lines',
    akhiranLama: ['ilustrasi kartun lucu dan ramah, warna cerah lembut, garis bersih']
  }
]

/** Awalan "Gambar unggahan: " ditulis main process; di layar tampil dalam bahasa Inggris. */
export const AWALAN_UNGGAH_LAMA = /^Gambar unggahan: /
const AWALAN_UNGGAH = 'Uploaded image: '
const tampilkanInti = (inti: string): string => inti.replace(AWALAN_UNGGAH_LAMA, AWALAN_UNGGAH)

/**
 * Memisahkan kalimat user dari akhiran gaya yang ditempel saat membuat.
 * Gaya DIKENALI dari teks yang tersimpan, bukan ditebak: prompt tanpa akhiran
 * yang cocok tampil tanpa label gaya.
 */
export function uraiPrompt(prompt: string): { inti: string; gaya: Gaya | null } {
  for (const g of GAYA) {
    // Akhiran sekarang DAN akhiran lama (prompt yang sudah tersimpan).
    for (const teks of [g.akhiran, ...g.akhiranLama]) {
      const akhir = `. ${teks}`
      if (prompt.endsWith(akhir)) return { inti: tampilkanInti(prompt.slice(0, -akhir.length)), gaya: g }
    }
  }
  return { inti: tampilkanInti(prompt), gaya: null }
}
