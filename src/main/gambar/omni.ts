import { readFileSync, statSync } from 'fs'
import { nativeImage } from 'electron'
import { BUNDLED } from '../bundled-config'
import { getSecret } from '../secrets'
import { logger } from '../logger'
import { MUSE, META_ENDPOINT } from '../hackathon/models'
import {
  GambarError,
  adalahPng,
  dimensiPng,
  terjemahkanGalatGambar,
  type UkuranGambar
} from './rules'

// Pemanggil model gambar old-image-model di gateway the company.
//
// ⚠️ Endpoint GAMBAR, bukan chat: `/v1/images/generations` & `/v1/images/edits`.
// old-image-model tidak bisa dipakai lewat `/v1/chat/completions` sama sekali (selalu
// HTTP 500) — lihat catatan terukur di `rules.ts`.
//
// ⚠️ Jangan pernah memasukkan gambarnya ke context model: 1024×1024 = ±4 MB PNG
// ≈ 5,5 MB base64, sementara jendela context 131.072 token (§56). Yang mengalir
// ke percakapan hanya PATH berkasnya.

export const MODEL_GAMBAR = MUSE.image
const TIMEOUT_MS = 120_000

/**
 * Kunci & alamat khusus SKRIP UJI (`npm run coba:gambar`).
 *
 * ⚠️ Hanya dipakai skrip: `coba-gambar.ts` tidak melewati build yang menanam
 * `.env`, jadi tanpa ini ia selalu berhenti di "kunci belum terpasang". TIDAK
 * dipakai aplikasi — dan sengaja BUKAN pembacaan `process.env` di jalur normal,
 * supaya variabel lingkungan di laptop user tidak bisa mengalihkan permintaan
 * gambar ke gateway lain (pola yang sama dengan alamat server update, §66).
 */
let kunciUji: { key: string; endpoint: string } | null = null

export function pakaiKunciUji(key: string, url: string): void {
  kunciUji = { key, endpoint: url }
}

function kunci(): string {
  if (kunciUji) return kunciUji.key
  // Sama dengan jalur LLM biasa: kunci dari `.env` ditanam saat build, lalu
  // disimpan terenkripsi (DPAPI). `BUNDLED` jadi cadangan bila secret store
  // belum terisi (mis. dijalankan dari skrip uji).
  return getSecret('llmApiKey') || BUNDLED.apiKey
}

function endpoint(): string {
  if (kunciUji) return kunciUji.endpoint.replace(/\/+$/, '')
  return (BUNDLED.endpoint || META_ENDPOINT).replace(/\/+$/, '')
}

export function gambarSiap(): boolean {
  return kunci().length > 0 && endpoint().length > 0
}

async function minta(url: string, init: RequestInit): Promise<any> {
  const ac = new AbortController()
  const jam = setTimeout(() => ac.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(url, { ...init, signal: ac.signal })
  } catch (err) {
    const pesan = String(err)
    throw new GambarError(
      pesan.includes('abort')
        ? `Image creation exceeded the ${TIMEOUT_MS / 1000}-second limit. Try a smaller size.`
        : 'The image gateway cannot be reached. Check the network connection.'
    )
  } finally {
    clearTimeout(jam)
  }
  const teks = await res.text()
  if (!res.ok) {
    logger().warn({ status: res.status, isi: teks.slice(0, 300) }, 'gateway gambar menolak')
    throw new GambarError(terjemahkanGalatGambar(res.status, teks))
  }
  try {
    return JSON.parse(teks)
  } catch {
    throw new GambarError('The image gateway reply is not valid JSON.')
  }
}

/**
 * Mengambil PNG dari balasan gateway.
 *
 * ⚠️ Diperiksa MAGIC BYTE-nya, bukan dipercaya. Gateway pernah mengabaikan
 * `output_format` tanpa berkata apa-apa; berkas yang isinya bukan PNG lalu
 * ditulis dengan nama `.png` akan gagal dibuka JAUH kemudian, di tangan user.
 */
function ambilPng(j: any, diminta: UkuranGambar): Buffer[] {
  const data = Array.isArray(j?.data) ? j.data : []
  if (data.length === 0) throw new GambarError('The gateway returned no image at all.')
  const hasil: Buffer[] = []
  for (const [i, d] of data.entries()) {
    const b64 = typeof d?.b64_json === 'string' ? d.b64_json : null
    if (!b64) {
      throw new GambarError(
        'The gateway returned the image in an unsupported form (not base64).'
      )
    }
    const buf = Buffer.from(b64, 'base64')
    if (!adalahPng(buf)) {
      throw new GambarError('The file returned by the gateway is not a valid PNG — it was not saved.')
    }
    const dim = dimensiPng(buf)
    const [lebarMinta, tinggiMinta] = diminta.split('x').map(Number)
    if (dim && (dim.lebar !== lebarMinta || dim.tinggi !== tinggiMinta)) {
      // Tidak fatal, tapi TIDAK didiamkan: ukuran yang tidak sesuai permintaan
      // akan terlihat sebagai tata letak slide yang melenceng.
      logger().warn({ diminta, jadi: `${dim.lebar}x${dim.tinggi}`, ke: i }, 'ukuran gambar berbeda')
    }
    hasil.push(buf)
  }
  return hasil
}

export interface PermintaanGambar {
  prompt: string
  ukuran: UkuranGambar
  jumlah?: number
}

/**
 * Muse Image returns WebP by default; `output_format: 'png'` gives a real PNG (measured 2 Nov 2026).
 * The PNG magic-byte check in `ambilPng` stays — a format the API ignores must not be saved as .png.
 */
export function imageRequestBody(p: PermintaanGambar): Record<string, unknown> {
  return { model: MODEL_GAMBAR, prompt: p.prompt, n: p.jumlah ?? 1, size: p.ukuran, output_format: 'png' }
}

export async function buatGambar(p: PermintaanGambar): Promise<Buffer[]> {
  if (!gambarSiap()) throw new GambarError('The gateway key is not installed in this app.')
  const t0 = Date.now()
  const j = await minta(`${endpoint()}/v1/images/generations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${kunci()}` },
    body: JSON.stringify(imageRequestBody(p))
  })
  const png = ambilPng(j, p.ukuran)
  logger().info({ ms: Date.now() - t0, ukuran: p.ukuran, jumlah: png.length }, 'gambar dibuat')
  return png
}

export async function ubahGambar(p: PermintaanGambar & { asal: string }): Promise<Buffer[]> {
  if (!gambarSiap()) throw new GambarError('The gateway key is not installed in this app.')
  const isi = readFileSync(p.asal)
  if (!adalahPng(isi)) {
    throw new GambarError(
      `The file "${p.asal}" is not a PNG. The image to edit must be a PNG — convert its format first.`
    )
  }
  const fd = new FormData()
  fd.append('model', MODEL_GAMBAR)
  fd.append('image', new Blob([new Uint8Array(isi)], { type: 'image/png' }), 'asal.png')
  fd.append('prompt', p.prompt)
  fd.append('size', p.ukuran)
  fd.append('output_format', 'png')
  const t0 = Date.now()
  const j = await minta(`${endpoint()}/v1/images/edits`, {
    method: 'POST',
    headers: { authorization: `Bearer ${kunci()}` },
    body: fd
  })
  const png = ambilPng(j, p.ukuran)
  logger().info({ ms: Date.now() - t0, ukuran: p.ukuran }, 'gambar diubah')
  return png
}

/**
 * Memperkecil PNG supaya presentasi tidak membengkak.
 *
 * Gateway mengembalikan PNG RGBA tanpa kompresi yang efisien (1024×1024 = ±4 MB).
 * Enam ilustrasi seukuran itu membuat deck 25 MB — ukuran yang ditolak banyak
 * kotak masuk email. Memakai Chromium yang SUDAH ADA di Electron, pola yang sama
 * dengan peraster grafik (§49): tanpa dependensi baru, tanpa native module.
 *
 * Gagal memperkecil TIDAK menggagalkan pembuatan gambar — yang asli dipakai, dan
 * ukurannya tetap dilaporkan apa adanya.
 */
export function kecilkanPng(buf: Buffer, maksSisi: number): Buffer {
  try {
    const img = nativeImage.createFromBuffer(buf)
    const uk = img.getSize()
    if (uk.width === 0 || Math.max(uk.width, uk.height) <= maksSisi) return buf
    const skala = maksSisi / Math.max(uk.width, uk.height)
    const kecil = img.resize({
      width: Math.round(uk.width * skala),
      height: Math.round(uk.height * skala),
      quality: 'best'
    })
    const png = kecil.toPNG()
    return png.length > 0 && png.length < buf.length ? png : buf
  } catch (err) {
    logger().warn({ err: String(err).slice(0, 160) }, 'gagal memperkecil gambar — memakai aslinya')
    return buf
  }
}

/** Batas berkas yang boleh diunggah untuk diubah — foto ponsel biasa 3–8 MB. */
export const MAKS_UNGGAH_BYTE = 20 * 1024 * 1024
/**
 * Sisi terpanjang gambar unggahan sesudah diperkecil. Gateway hanya membuat
 * 1024/1536; mengirim foto 4000 px hanya memperlambat unggahan ke gateway
 * bersama tanpa membuat hasilnya lebih tajam.
 */
export const SISI_UNGGAH = 1536

/** Ukuran keluaran yang paling dekat dengan rasio gambar asal. */
export function ukuranUntukRasio(lebar: number, tinggi: number): '1024x1024' | '1536x1024' | '1024x1536' {
  const r = lebar / Math.max(1, tinggi)
  if (r >= 1.2) return '1536x1024'
  if (r <= 0.83) return '1024x1536'
  return '1024x1024'
}

/**
 * Menyiapkan gambar dari komputer user untuk `images/edits`: dibaca lewat
 * nativeImage (PNG/JPG), diperkecil ke `SISI_UNGGAH`, dan SELALU dijadikan PNG —
 * gateway hanya menerima PNG (§68). Dipisah dari dialognya supaya bisa dibuktikan
 * di runtime Electron (`npm run coba:gambar`) tanpa jendela pilih berkas.
 */
export function siapkanUnggahan(path: string): { png: Buffer; ukuran: string; lebar: number; tinggi: number } {
  const besar = statSync(path).size
  if (besar > MAKS_UNGGAH_BYTE) {
    throw new GambarError(
      `The file is too large (${(besar / 1024 / 1024).toFixed(1)} MB). Maximum is ${MAKS_UNGGAH_BYTE / 1024 / 1024} MB.`
    )
  }
  let img = nativeImage.createFromPath(path)
  if (img.isEmpty()) throw new GambarError('This file cannot be read as an image. Use PNG or JPG.')
  const uk = img.getSize()
  const skala = Math.min(1, SISI_UNGGAH / Math.max(uk.width, uk.height))
  if (skala < 1) {
    img = img.resize({ width: Math.round(uk.width * skala), height: Math.round(uk.height * skala), quality: 'best' })
  }
  return { png: img.toPNG(), ukuran: ukuranUntukRasio(uk.width, uk.height), lebar: uk.width, tinggi: uk.height }
}
