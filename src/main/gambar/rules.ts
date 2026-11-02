// Aturan pembuatan gambar (model old-image-model di gateway the company) — modul MURNI.
//
// ⚠️ Yang TERUKUR tentang old-image-model (probe 27 Sep 2026, `scripts/probe-omni.mjs`
// dan `probe-omni2.mjs`) — jangan diandaikan berbeda tanpa mengukur ulang:
//   - BUKAN model chat. `/v1/chat/completions` SELALU HTTP 500 untuk model ini,
//     termasuk untuk teks biasa. Tidak ada tool calling, tidak bisa MEMBACA
//     gambar (untuk itu: old-vision-model / Unlimited-OCR).
//   - Yang jalan: `/v1/images/generations` dan `/v1/images/edits` (multipart).
//   - Balasannya SELALU `data[i].b64_json` berisi PNG. `response_format: "url"`
//     ditolak HTTP 500.
//   - `output_format: "jpeg"` DITERIMA tapi DIABAIKAN — yang kembali tetap PNG.
//     Karena itu berkas hasil WAJIB `.png`: nama berkas yang berbohong soal
//     isinya adalah kegagalan yang sama dengan PPT 21 Agu 2026 (§24c).
//   - `quality` dan `background: "transparent"` juga tampak diabaikan.
//   - `usage` selalu nol — gateway tidak melaporkan pemakaian untuk model ini.

/** Ukuran yang SUDAH diuji ke gateway. */
export const UKURAN_GAMBAR = ['256x256', '512x512', '1024x1024', '1536x1024', '1024x1536'] as const
export type UkuranGambar = (typeof UKURAN_GAMBAR)[number]

/**
 * Bawaan 512×512 (±2 detik, ±1 MB), BUKAN 1024 (±8 detik, ±4 MB).
 *
 * Bawaan yang besar tidak terasa saat mencoba satu gambar, tapi deck 8 slide
 * berilustrasi jadi 30+ MB dan tiap kiriman email menolaknya. Yang butuh besar
 * bisa memintanya; yang tidak tahu apa-apa dapat yang wajar.
 */
export const UKURAN_BAWAAN: UkuranGambar = '512x512'

export const MAKS_PROMPT_GAMBAR = 1_000
export const MAKS_JUMLAH = 4

/** Berapa gambar yang boleh dibuat dalam SATU presentasi. */
export const MAKS_GAMBAR_PPT = 6

export class GambarError extends Error {}

export function pastikanUkuran(nilai: unknown): UkuranGambar {
  if (nilai === undefined || nilai === null || nilai === '') return UKURAN_BAWAAN
  const teks = String(nilai).toLowerCase().replace(/\s|×/g, (c) => (c === '×' ? 'x' : ''))
  if ((UKURAN_GAMBAR as readonly string[]).includes(teks)) return teks as UkuranGambar
  throw new GambarError(
    `size "${nilai}" is not supported. Choose one of: ${UKURAN_GAMBAR.join(', ')} — ` +
      `write it exactly like that (e.g. "${UKURAN_BAWAAN}").`
  )
}

export function pastikanPrompt(nilai: unknown): string {
  const teks = typeof nilai === 'string' ? nilai.trim() : ''
  if (!teks) {
    throw new GambarError(
      'the "prompt" argument is required: describe the wanted image in plain sentences ' +
        '(object, style, colors, background).'
    )
  }
  if (teks.length > MAKS_PROMPT_GAMBAR) {
    throw new GambarError(
      `the prompt is too long (${teks.length} characters, limit ${MAKS_PROMPT_GAMBAR}). ` +
        'Shorten it to one or two core sentences.'
    )
  }
  return teks
}

export function pastikanJumlah(nilai: unknown): number {
  if (nilai === undefined || nilai === null || nilai === '') return 1
  const n = Number(nilai)
  if (!Number.isInteger(n) || n < 1 || n > MAKS_JUMLAH) {
    throw new GambarError(`"jumlah" must be a whole number from 1 to ${MAKS_JUMLAH}.`)
  }
  return n
}

/**
 * Nama berkas hasil WAJIB `.png`.
 *
 * Gateway selalu mengembalikan PNG apa pun yang diminta, jadi `.jpg` berarti
 * berkas yang isinya berbeda dari namanya — Office dan sebagian aplikasi lain
 * menolaknya, dan penyebabnya tidak terlihat dari mana pun.
 */
export function pastikanBerkasPng(path: string): void {
  if (!path.toLowerCase().endsWith('.png')) {
    throw new GambarError(
      'the image file must end in .png — AIRA images are always PNG whatever format was ' +
        'requested, so any other name would misstate what is inside.'
    )
  }
}

/** PNG dikenali dari MAGIC BYTE, bukan dari namanya (§24c). */
export function adalahPng(buf: Uint8Array): boolean {
  return (
    buf.length > 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  )
}

/** Lebar × tinggi dari header PNG — dipakai memastikan ukuran yang diminta memang terjadi. */
export function dimensiPng(buf: Uint8Array): { lebar: number; tinggi: number } | null {
  if (!adalahPng(buf) || buf.length < 24) return null
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  return { lebar: dv.getUint32(16), tinggi: dv.getUint32(20) }
}

/**
 * Kalimat wajib di setiap hasil tool gambar.
 *
 * ⚠️ Bukan basa-basi. Gambar buatan model terlihat seperti foto/logo sungguhan,
 * dan begitu masuk deck manajemen atau materi ke pelanggan, tidak ada lagi yang
 * bisa membedakannya. Dua hal yang WAJIB sampai ke user: ini gambar buatan AI,
 * dan tulisan di dalam gambar sering salah eja (terukur pada uji "the lab
 * the lab" — huruf benar, tapi ada coretan yang bukan huruf).
 */
export const PENANDA_AI =
  'Tell the user that this image was MADE BY AIRA (an AI-generated image), not a real photo and ' +
  'not an official company logo. Name the maker "AIRA" only — DO NOT mention the model, gateway, or ' +
  'engine behind it. Never call it a photo, documentation, or an official asset. If there is ' +
  'text inside the image, remind the user to check it — letters in AI images are often wrong.'

export function catatanGambar(input: {
  file: string
  lebar: number
  tinggi: number
  bytes: number
  jumlah: number
}): string {
  const mb = (input.bytes / 1048576).toFixed(2)
  return (
    `Image saved at ${input.file} (${input.lebar}×${input.tinggi} pixels, ${mb} MB` +
    `${input.jumlah > 1 ? `, ${input.jumlah} files` : ''}). Tell the user where the file is. ` +
    PENANDA_AI
  )
}

/**
 * Menerjemahkan galat gateway jadi kalimat yang bisa ditindaklanjuti (§55).
 *
 * HTTP 500 "Invalid response object" adalah bentuk kegagalan yang PALING sering
 * muncul untuk model ini, dan bunyinya sama sekali tidak menjelaskan apa pun ke
 * user.
 */
export function terjemahkanGalatGambar(status: number, isi: string): string {
  const t = isi.toLowerCase()
  if (status === 401 || status === 403) {
    return 'The gateway rejected the AIRA API key for the image model. The IT team needs to check it.'
  }
  if (status === 404 || t.includes('model not found') || t.includes('not a valid model')) {
    return 'The AIRA image maker is not available right now. Try again later or contact the IT team.'
  }
  if (status === 429 || t.includes('rate limit')) {
    return 'The gateway is busy (rate limit). Try again in a moment.'
  }
  if (t.includes('content') && (t.includes('policy') || t.includes('filter') || t.includes('safety'))) {
    return 'The image request was rejected by the gateway content filter. Reword the request.'
  }
  if (t.includes('invalid response object') || status >= 500) {
    return (
      'The AIRA image maker is having trouble (server error). Try once more; ' +
      'if it still fails, report it to the IT team — it is not a mistake in your request.'
    )
  }
  return `The gateway rejected the image request (HTTP ${status}).`
}

/**
 * Kalimat yang WAJIB ikut saat presentasi dibuat TANPA ilustrasi.
 *
 * ⚠️ Permintaan user (27 Sep 2026): AIRA MENAWARKAN gambar, tidak memutuskan
 * sendiri. Ditaruh di HASIL TOOL, bukan cuma di system prompt — imbauan di
 * prompt terbukti sering diabaikan model 27B (§"perbaiki di kode"), sedangkan
 * kalimat di hasil tool terbaca tepat sebelum ia menulis jawaban.
 */
export const TAWARKAN_ILUSTRASI =
  'This deck does not use illustrations yet. OFFER ONCE to the user (one sentence at the end of the answer): ' +
  'would they like AIRA-made illustrations added to a few slides? Mention that the images are ' +
  'made by AIRA and add about 8 seconds per image. Do not rebuild the presentation ' +
  'before the user answers, and do not offer repeatedly.'
