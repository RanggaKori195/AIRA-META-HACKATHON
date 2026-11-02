import { readFileSync } from 'fs'
import { PDFParse } from 'pdf-parse'
import { loadConfig } from './config'
import { buildProvider } from './llm/factory'
import { logger } from './logger'

// OCR dokumen hasil scan: halaman PDF dirender jadi gambar lalu dibaca model vision
// (old-vision-model). Parser TIDAK mendukung tool calling, jadi dipanggil lewat complete().

export const MAX_OCR_PAGES = 20
const RENDER_SCALE = 2

const OCR_PROMPT =
  'Ekstrak SELURUH teks yang terlihat pada gambar halaman dokumen ini. ' +
  'Pertahankan urutan bacaan dan struktur baris. Jika ada tabel, tulis sebagai baris teks yang dipisah " | ". ' +
  'Keluarkan HANYA teksnya — tanpa komentar, tanpa penjelasan, tanpa rencana.'

/**
 * Model parser kadang menambahkan preamble "rencana eksekusi" sebelum hasil OCR.
 * Preamble itu dibuang supaya yang tersimpan/terindeks hanya isi dokumen.
 */
export function cleanOcrOutput(raw: string): string {
  let text = raw.trim()
  const separator = text.match(/\n\s*(\*{3,}|-{3,}|_{3,})\s*\n/)
  if (separator?.index !== undefined) {
    const head = text.slice(0, separator.index)
    if (/rencana|langkah|saya telah|berikut adalah/i.test(head)) {
      text = text.slice(separator.index + separator[0].length)
    }
  }
  text = text.replace(
    /^(berikut adalah rencana[^\n]*|\*{0,2}rencana[:*]{0,3}[^\n]*|\d+\.\s+\*\*[^\n]*|saya telah menyelesaikan[^\n]*|silakan (lanjutkan|konfirmasi)[^\n]*|\*{0,2}(langkah|tindak lanjut)\s*\d*[:*]{0,3}[^\n]*)\n?/gim,
    ''
  )
  return text.trim()
}

/** Added to a page whose OCR text ended at the model's output limit, so it is never shown as complete. */
export const OCR_INCOMPLETE_NOTE = "[page text may be incomplete: the model's output limit was reached]"

/** `text` as read, plus the incompleteness note when the model stopped because of the output limit. */
export function tandaiBilaTerpotong(text: string, finishReason: string | undefined): string {
  if (finishReason !== 'length') return text
  return text.trim() ? `${text}\n\n${OCR_INCOMPLETE_NOTE}` : OCR_INCOMPLETE_NOTE
}

export async function pdfPageImages(
  filePath: string,
  first: number,
  last: number
): Promise<Array<{ pageNumber: number; dataUrl: string }>> {
  const parser = new PDFParse({ data: readFileSync(filePath) })
  try {
    const result = await parser.getScreenshot({ first, last, scale: RENDER_SCALE })
    return (result.pages ?? [])
      .filter((p): p is typeof p & { dataUrl: string } => typeof p.dataUrl === 'string')
      .map((p) => ({ pageNumber: p.pageNumber, dataUrl: p.dataUrl }))
  } finally {
    await parser.destroy().catch(() => undefined)
  }
}

async function ocrImage(dataUrl: string): Promise<string> {
  const provider = buildProvider()
  if (!provider) throw new Error('LLM belum di-setup')
  const model = loadConfig().parserModelId
  const { text, finishReason } = await provider.completeDetail(
    [
      {
        role: 'user',
        content: [
          { type: 'text', text: OCR_PROMPT },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }
    ],
    model,
    3000
  )
  return tandaiBilaTerpotong(cleanOcrOutput(text), finishReason)
}

/** OCR halaman-per-halaman supaya payload tetap kecil dan hasil per halaman jelas. */
export async function ocrPdf(
  filePath: string,
  maxPages: number,
  /** Halaman awal — dipakai membaca PDF scan yang panjang secara bertahap. */
  fromPage = 1
): Promise<{ pages: Array<{ page: number; text: string }>; truncated: boolean }> {
  const limit = Math.min(Math.max(maxPages, 1), MAX_OCR_PAGES)
  const mulai = Math.max(Math.floor(fromPage) || 1, 1)
  const images = await pdfPageImages(filePath, mulai, mulai + limit - 1)
  const pages: Array<{ page: number; text: string }> = []
  for (const image of images) {
    try {
      pages.push({ page: image.pageNumber, text: await ocrImage(image.dataUrl) })
    } catch (err) {
      logger().warn({ page: image.pageNumber, err: String(err) }, 'OCR halaman gagal')
      pages.push({ page: image.pageNumber, text: '' })
    }
  }
  return { pages, truncated: images.length >= limit }
}

export async function ocrImageFile(filePath: string): Promise<string> {
  const base64 = readFileSync(filePath).toString('base64')
  return ocrImage(`data:image/png;base64,${base64}`)
}
