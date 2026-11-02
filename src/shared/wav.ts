// Enkoder WAV — JS murni, tanpa dependensi.
//
// Kenapa ditulis sendiri dan bukan memakai `MediaRecorder`: MediaRecorder
// menghasilkan WebM/Opus, dan whisper.cpp TIDAK bisa membacanya tanpa ffmpeg.
// ffmpeg berarti binary kedua yang harus ikut installer, ikut ditandatangani,
// dan ikut jadi hal yang diperiksa tiap naik versi. Web Audio API memberi PCM
// mentah, dan membungkus PCM jadi WAV cuma soal menulis header 44 byte.
//
// Tinggal di `shared` dengan sengaja: yang MEMBUAT wav (renderer) dan yang
// MEMERIKSA wav (main, `suara/rules.ts`) harus sepakat soal bentuknya. Ketika
// dua sisi menulis asumsinya masing-masing, salah satunya bergeser diam-diam
// dan gejalanya bukan error melainkan transkrip ngawur.

/** Whisper meminta 16 kHz mono. Nilai ini dibagi dengan `suara/rules.ts`. */
export const WAV_SAMPLE_RATE = 16_000

/**
 * Menurunkan laju cuplikan ke `tujuan` secara linier.
 *
 * ⚠️ Dibutuhkan meski `AudioContext` sudah diminta 16 kHz: permintaan itu
 * TIDAK dijamin dituruti — sebagian perangkat/driver mengembalikan 44,1 atau
 * 48 kHz apa adanya. Kalau perbedaannya diabaikan, audio masuk whisper dengan
 * kecepatan salah dan hasilnya transkrip ngawur TANPA satu pun pesan galat;
 * di layar itu terlihat seperti "Whisper-nya jelek".
 */
export function turunkanSampel(input: Float32Array, dari: number, tujuan: number): Float32Array {
  if (dari === tujuan) return input
  if (dari < tujuan) return input // menaikkan laju tidak menambah informasi apa pun
  const rasio = dari / tujuan
  const panjang = Math.floor(input.length / rasio)
  const keluar = new Float32Array(panjang)
  for (let i = 0; i < panjang; i++) {
    const posisi = i * rasio
    const kiri = Math.floor(posisi)
    const kanan = Math.min(kiri + 1, input.length - 1)
    const beda = posisi - kiri
    keluar[i] = input[kiri] * (1 - beda) + input[kanan] * beda
  }
  return keluar
}

/**
 * Membungkus PCM float (-1..1) jadi berkas WAV 16-bit mono.
 *
 * Nilai di luar -1..1 DIJEPIT, bukan dibiarkan meluap. Meluap membuat sampel
 * keras berbalik tanda dan terdengar sebagai derak keras — dan derak itu
 * ditranskripsikan whisper sebagai kata-kata yang tidak pernah diucapkan.
 */
export function enkodeWav(pcm: Float32Array, sampleRate = WAV_SAMPLE_RATE): Uint8Array {
  const buf = new Uint8Array(44 + pcm.length * 2)
  const dv = new DataView(buf.buffer)
  const tulis = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) buf[o + i] = s.charCodeAt(i)
  }
  tulis(0, 'RIFF')
  dv.setUint32(4, 36 + pcm.length * 2, true)
  tulis(8, 'WAVE')
  tulis(12, 'fmt ')
  dv.setUint32(16, 16, true) // panjang blok fmt
  dv.setUint16(20, 1, true) // 1 = PCM tanpa kompresi
  dv.setUint16(22, 1, true) // mono
  dv.setUint32(24, sampleRate, true)
  dv.setUint32(28, sampleRate * 2, true) // byte per detik
  dv.setUint16(32, 2, true) // byte per blok
  dv.setUint16(34, 16, true) // bit per sampel
  tulis(36, 'data')
  dv.setUint32(40, pcm.length * 2, true)
  for (let i = 0; i < pcm.length; i++) {
    const n = Math.max(-1, Math.min(1, pcm[i]))
    dv.setInt16(44 + i * 2, n < 0 ? n * 0x8000 : n * 0x7fff, true)
  }
  return buf
}

/** Menggabungkan potongan-potongan rekaman jadi satu deret. */
export function gabungPotongan(potongan: Float32Array[]): Float32Array {
  let panjang = 0
  for (const p of potongan) panjang += p.length
  const keluar = new Float32Array(panjang)
  let o = 0
  for (const p of potongan) {
    keluar.set(p, o)
    o += p.length
  }
  return keluar
}
