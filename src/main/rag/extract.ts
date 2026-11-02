import { readFileSync } from 'fs'
import ExcelJS from 'exceljs'
import mammoth from 'mammoth'
import JSZip from 'jszip'
import WordExtractor from 'word-extractor'
import { PDFParse } from 'pdf-parse'
import { ocrPdf } from '../ocr'
import { hasTextLayer } from '../pdf-text'

// Ekstraksi teks untuk indexing RAG. Return null = format tidak didukung / bukan teks.

export const SUPPORTED_EXTENSIONS = [
  '.txt',
  '.md',
  '.csv',
  '.json',
  '.log',
  '.xml',
  '.html',
  '.docx',
  '.doc',
  '.xlsx',
  '.pptx',
  '.pdf'
]

const MAX_CHARS = 500_000

function plainText(file: string): string | null {
  const buffer = readFileSync(file)
  if (buffer.subarray(0, 4096).includes(0)) return null
  return buffer.toString('utf-8')
}

async function excelText(file: string): Promise<string> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(file)
  const parts: string[] = []
  for (const sheet of workbook.worksheets) {
    parts.push(`[Sheet: ${sheet.name}]`)
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = []
      row.eachCell({ includeEmpty: false }, (cell) => {
        const value = cell.value
        if (value === null || value === undefined) return
        if (typeof value === 'object' && 'richText' in (value as object)) {
          cells.push((value as { richText: Array<{ text: string }> }).richText.map((r) => r.text).join(''))
        } else if (typeof value === 'object' && 'result' in (value as object)) {
          cells.push(String((value as { result: unknown }).result ?? ''))
        } else {
          cells.push(String(value))
        }
      })
      if (cells.length) parts.push(cells.join(' | '))
    })
  }
  return parts.join('\n')
}

async function pptxText(file: string): Promise<string> {
  const zip = await JSZip.loadAsync(readFileSync(file))
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
  const parts: string[] = []
  for (const [index, name] of slideFiles.entries()) {
    const xml = await zip.files[name].async('string')
    const texts = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((m) => m[1].trim()).filter(Boolean)
    if (texts.length) parts.push(`[Slide ${index + 1}] ${texts.join(' ')}`)
  }
  return parts.join('\n')
}

// PDF hasil scan tetap diindeks lewat OCR, tapi dibatasi beberapa halaman awal
// saja supaya indexing massal tidak membebani GPU.
const OCR_PAGES_FOR_INDEX = 3

async function pdfText(file: string): Promise<string | null> {
  const parser = new PDFParse({ data: readFileSync(file) })
  let text: string
  try {
    text = (await parser.getText()).text ?? ''
  } finally {
    await parser.destroy().catch(() => undefined)
  }
  if (hasTextLayer(text)) return text

  try {
    const ocr = await ocrPdf(file, OCR_PAGES_FOR_INDEX)
    const combined = ocr.pages.map((p) => p.text).join('\n').trim()
    return combined || null
  } catch {
    return null
  }
}

export async function extractText(file: string): Promise<string | null> {
  const lower = file.toLowerCase()
  let text: string | null
  if (lower.endsWith('.pdf')) {
    text = await pdfText(file)
  } else if (lower.endsWith('.docx')) {
    text = (await mammoth.extractRawText({ path: file })).value ?? ''
  } else if (lower.endsWith('.doc')) {
    text = (await new WordExtractor().extract(file)).getBody() ?? ''
  } else if (lower.endsWith('.xlsx')) {
    text = await excelText(file)
  } else if (lower.endsWith('.pptx')) {
    text = await pptxText(file)
  } else if (SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    text = plainText(file)
  } else {
    return null
  }
  if (!text || !text.trim()) return null
  return text.slice(0, MAX_CHARS)
}
