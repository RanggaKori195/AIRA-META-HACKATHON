import { existsSync, readFileSync, mkdirSync, writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import * as path from 'path'
import { execFile } from 'child_process'
import ExcelJS from 'exceljs'
import mammoth from 'mammoth'
import { Document, HeadingLevel, Packer, Paragraph } from 'docx'
import JSZip from 'jszip'
import WordExtractor from 'word-extractor'
import { PDFParse } from 'pdf-parse'
import { resolveInBoundary } from './boundary'
import { ToolError, type ToolDefinition } from './types'
import { pdfSiap, tulisPdfDariMarkdown } from '../pdf/render'
import { FITUR_TIDAK_DIDUKUNG } from '../pdf/markdown'
import { MAX_OCR_PAGES, ocrPdf } from '../ocr'
import { catatanHasil, halamanNyarisKosong, potongHalaman, type HalamanPdf } from './pdf-paging'
import { catatanBaca, potongTeks } from './text-read'
import { hasTextLayer } from '../pdf-text'
import { LAYOUT_TERSEDIA, tulisPresentasi, type SlideSpec } from '../ppt/render'
import { IKON_CONTOH, NAMA_IKON } from '../ppt/ikon'
import { bacaSlides, normalkanSlide, pastikanJumlahGambar } from '../ppt/validasi'
import { buatGambar, kecilkanPng } from '../gambar/omni'
import { TAWARKAN_ILUSTRASI, pastikanPrompt, type UkuranGambar } from '../gambar/rules'

/**
 * Ukuran ilustrasi slide, dan berapa piksel sisi terpanjang setelah diperkecil.
 *
 * 1024 dipilih karena slide dilihat di proyektor; 512 terlihat lembut saat
 * dibesarkan. Tapi PNG mentah dari gateway berukuran ±4 MB, jadi diperkecil
 * dulu ke 900 px — cukup untuk layar proyektor 1920 px, dan deck 6 ilustrasi
 * tetap di bawah batas lampiran email kebanyakan kantor.
 */
const UKURAN_GAMBAR_PPT: UkuranGambar = '1024x1024'
const SISI_GAMBAR_PPT = 900


// Tools dokumen Office (.xlsx, .docx, .pptx). Format lama (.xls/.doc/.ppt) tidak didukung.

const MAX_ROWS = 1000
const MAX_COLS = 60
const MAX_CELLS_WRITE = 20_000

/**
 * Font korporat untuk dokumen Office.
 *
 * ⚠️ Berbeda dari PDF: font di .xlsx/.docx TIDAK ikut tertanam. Excel/Word
 * memakai font yang terpasang di komputer PEMBACA, dan memilih penggantinya
 * sendiri bila tidak ada. Di lingkungan the company fontnya ada; untuk kiriman ke
 * luar, PDF lebih aman karena hurufnya pasti sama di mana pun dibuka.
 */
const FONT_DOKUMEN = 'company serif font'
const MAX_TEXT_CHARS = 100_000

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new ToolError(`argumen "${key}" wajib berupa string`)
  }
  return value
}

function requireExt(file: string, ext: string): void {
  if (!file.toLowerCase().endsWith(ext)) {
    throw new ToolError(
      `file harus berekstensi ${ext} — untuk format Office lama (.doc/.xls/.ppt) gunakan tool convert_office dulu`
    )
  }
}

// Konversi format Office lama via COM automation (butuh MS Office terinstall di laptop).
// Macro dinonaktifkan paksa (AutomationSecurity=3), aplikasi tidak menampilkan window.
// Konversi via cscript + VBScript (IDispatch murni) — sengaja TIDAK memakai
// PowerShell COM interop karena rusak di mesin dengan sisa typelib Office lama
// (TYPE_E_CANTLOADLIBRARY). Macro dinonaktifkan paksa (AutomationSecurity=3),
// path dilewatkan sebagai argumen sehingga bebas masalah escaping.
function vbsScript(body: string, appName: string): string {
  return (
    'On Error Resume Next\n' +
    `Set app = CreateObject("${appName}")\n` +
    'If Err.Number <> 0 Then\n' +
    `  WScript.Echo "ERROR: ${appName} tidak tersedia - " & Err.Description\n` +
    '  WScript.Quit 1\n' +
    'End If\n' +
    body +
    'If Err.Number <> 0 Then\n' +
    '  WScript.Echo "ERROR: " & Err.Description\n' +
    '  app.Quit\n' +
    '  WScript.Quit 1\n' +
    'End If\n' +
    'app.Quit\n' +
    'WScript.Echo "CONVERTED"\n'
  )
}

const CONVERSIONS: Record<string, { to: string; vbs: string }> = {
  '.doc': {
    to: '.docx',
    vbs: vbsScript(
      'app.DisplayAlerts = 0\n' +
        'app.AutomationSecurity = 3\n' +
        'Set doc = app.Documents.Open(WScript.Arguments(0), False, True)\n' +
        'doc.SaveAs2 WScript.Arguments(1), 16\n' +
        'doc.Close False\n',
      'Word.Application'
    )
  },
  '.xls': {
    to: '.xlsx',
    vbs: vbsScript(
      'app.DisplayAlerts = False\n' +
        'app.AutomationSecurity = 3\n' +
        'Set wb = app.Workbooks.Open(WScript.Arguments(0), 0, True)\n' +
        'wb.SaveAs WScript.Arguments(1), 51\n' +
        'wb.Close False\n',
      'Excel.Application'
    )
  },
  '.ppt': {
    to: '.pptx',
    vbs: vbsScript(
      'app.AutomationSecurity = 3\n' +
        'Set pres = app.Presentations.Open(WScript.Arguments(0), True, True, False)\n' +
        'pres.SaveAs WScript.Arguments(1), 24\n' +
        'pres.Close\n',
      'PowerPoint.Application'
    )
  }
}

function runConversion(vbs: string, src: string, dst: string, timeoutMs: number): Promise<void> {
  const scriptPath = path.join(
    tmpdir(),
    `aira-convert-${Date.now()}-${Math.random().toString(36).slice(2)}.vbs`
  )
  writeFileSync(scriptPath, vbs, 'utf-8')
  return new Promise((resolve, reject) => {
    execFile(
      'cscript',
      ['//nologo', scriptPath, src, dst],
      { timeout: timeoutMs, windowsHide: true },
      (error, stdout, stderr) => {
        try {
          unlinkSync(scriptPath)
        } catch {
          /* temp file cleanup best-effort */
        }
        const out = String(stdout).trim()
        if (out.includes('CONVERTED')) resolve()
        else
          reject(
            new ToolError(
              `konversi gagal: ${(out || String(stderr) || error?.message || 'unknown').slice(0, 300)}`
            )
          )
      }
    )
  })
}

/**
 * Merapikan satu sheet: header berwarna, kolom angka rata kanan berpemisah
 * ribuan, lebar kolom mengikuti isi, header dibekukan, filter otomatis.
 *
 * ⚠️ Dikerjakan KODE, bukan diserahkan ke model lewat parameter tambahan.
 * Model 27B sudah terbukti rapuh soal mengisi parameter yang banyak, dan
 * "rapi" bukan sesuatu yang perlu diputuskan per pemanggilan — file Excel yang
 * dikirim ke manajemen harus rapi setiap kali, bukan kalau modelnya ingat.
 */
export function rapikanSheet(ws: ExcelJS.Worksheet): void {
  if (ws.rowCount === 0) return

  const header = ws.getRow(1)
  header.font = { name: FONT_DOKUMEN, bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F6F3E' } }
  header.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
  header.height = 22

  const jumlahKolom = ws.columnCount
  for (let k = 1; k <= jumlahKolom; k++) {
    const kolom = ws.getColumn(k)

    // Kolom dianggap angka bila SELURUH sel isinya angka. Sekali ada teks di
    // dalamnya, memaksa format angka akan menyembunyikan isi yang sebenarnya.
    let semuaAngka = true
    let adaIsi = false
    let lebar = String(ws.getCell(1, k).value ?? '').length
    for (let b = 2; b <= ws.rowCount; b++) {
      const nilai = ws.getCell(b, k).value
      if (nilai === null || nilai === undefined || nilai === '') continue
      adaIsi = true
      if (typeof nilai !== 'number') semuaAngka = false
      lebar = Math.max(lebar, String(nilai).length)
    }

    if (adaIsi && semuaAngka) {
      // Pemisah ribuan gaya Indonesia diserahkan ke Excel lewat format, bukan
      // diubah jadi teks — angka yang disimpan sebagai teks tidak bisa
      // dijumlahkan penerimanya, dan itu keluhan klasik penerima laporan.
      kolom.numFmt = '#,##0'
      kolom.alignment = { horizontal: 'right' }
    }
    // Batas 42 supaya satu sel berisi kalimat panjang tidak melebarkan kolom
    // sampai tabelnya tidak muat di layar.
    kolom.width = Math.min(Math.max(lebar + 2, 10), 42)
  }

  // Font korporat untuk baris isi. Diterapkan per baris (bukan per sel) supaya
  // tetap murah pada tabel besar — sampai 20.000 sel, ini ratusan baris saja.
  for (let b = 2; b <= ws.rowCount; b++) {
    ws.getRow(b).font = { name: FONT_DOKUMEN, size: 11 }
  }

  // Header tetap terlihat saat digulir, dan bisa langsung disaring/diurutkan —
  // dua hal pertama yang dilakukan orang saat menerima tabel panjang.
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  if (ws.rowCount > 1) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: jumlahKolom } }
  }
}

function requireNewFile(file: string): void {
  if (existsSync(file)) {
    throw new ToolError('file sudah ada — pilih nama lain, atau hapus/pindahkan dulu file lama')
  }
  mkdirSync(path.dirname(file), { recursive: true })
}

function cellToString(value: ExcelJS.CellValue): string | number | boolean | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    if ('result' in value && value.result !== undefined) return cellToString(value.result as ExcelJS.CellValue)
    if ('text' in value && typeof value.text === 'string') return value.text
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((r) => r.text).join('')
    }
  }
  return String(value)
}

export const docTools: ToolDefinition[] = [
  {
    name: 'read_excel',
    description:
      'Membaca isi file Excel (.xlsx). Mengembalikan daftar sheet dan isi baris dari satu sheet (default sheet pertama).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path file .xlsx' },
        sheet: { type: 'string', description: 'Nama sheet (opsional, default sheet pertama)' },
        maxRows: { type: 'number', description: `Batas baris (default 200, maksimum ${MAX_ROWS})` }
      },
      required: ['path']
    },
    tier: 'read',
    timeoutMs: 60_000,
    summarize: (a) => `Baca Excel ${a.path}${a.sheet ? ` (sheet ${a.sheet})` : ''}`,
    execute: async (args, ctx) => {
      const file = resolveInBoundary(str(args, 'path'), ctx.allowedDirs)
      requireExt(file, '.xlsx')
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.readFile(file)
      const sheetNames = workbook.worksheets.map((w) => w.name)
      const target =
        typeof args.sheet === 'string'
          ? workbook.getWorksheet(args.sheet)
          : workbook.worksheets[0]
      if (!target) throw new ToolError(`sheet tidak ditemukan — tersedia: ${sheetNames.join(', ')}`)
      const limit = Math.min(Number(args.maxRows) || 200, MAX_ROWS)
      const rows: Array<Array<string | number | boolean | null>> = []
      target.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rows.length >= limit) return
        const values: Array<string | number | boolean | null> = []
        for (let col = 1; col <= Math.min(row.cellCount, MAX_COLS); col++) {
          values.push(cellToString(row.getCell(col).value))
        }
        rows.push(values)
        void rowNumber
      })
      const adaSisa = target.actualRowCount > limit
      return JSON.stringify({
        sheets: sheetNames,
        sheet: target.name,
        totalRows: target.actualRowCount,
        barisTerbaca: rows.length,
        // Kalimat, bukan hanya bendera — alasan yang sama dengan read_file.
        catatanHasil: adaSisa
          ? `Sheet "${target.name}" punya ${target.actualRowCount} baris; ditampilkan ${rows.length} ` +
            'baris pertama. Sisanya BELUM dibaca — naikkan parameter limit bila user meminta lebih. ' +
            'Jangan menyimpulkan isi baris yang belum terbaca.'
          : `SELURUH ${target.actualRowCount} baris sheet "${target.name}" terbaca lengkap; tidak ada ` +
            'yang dipotong. DILARANG menyatakan ada data yang terpotong di luar yang disebutkan ini. ' +
            (sheetNames.length > 1
              ? `Sheet lain di file ini: ${sheetNames.filter((n) => n !== target.name).join(', ')} — ` +
                'belum dibaca kecuali diminta.'
              : ''),
        rows
      })
    }
  },
  {
    name: 'write_excel',
    description:
      'Membuat file Excel (.xlsx) BARU. Baris pertama tiap sheet otomatis dijadikan header (bold). ' +
      'rows adalah array baris; tiap baris adalah array nilai sel (string/angka).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path file .xlsx baru' },
        sheets: {
          type: 'array',
          description: 'Daftar sheet',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              rows: {
                type: 'array',
                items: { type: 'array', items: { type: ['string', 'number', 'boolean', 'null'] } }
              }
            },
            required: ['name', 'rows']
          }
        }
      },
      required: ['path', 'sheets']
    },
    tier: 'write',
    timeoutMs: 60_000,
    summarize: (a) => `Buat Excel baru ${a.path}`,
    execute: async (args, ctx) => {
      const file = resolveInBoundary(str(args, 'path'), ctx.allowedDirs)
      requireExt(file, '.xlsx')
      requireNewFile(file)
      const sheets = args.sheets
      if (!Array.isArray(sheets) || sheets.length === 0) {
        throw new ToolError('argumen "sheets" wajib berupa array berisi minimal satu sheet')
      }
      const workbook = new ExcelJS.Workbook()
      workbook.creator = 'AIRA'
      workbook.created = new Date()
      let totalCells = 0
      for (const sheet of sheets as Array<{ name?: unknown; rows?: unknown }>) {
        if (typeof sheet?.name !== 'string' || !Array.isArray(sheet.rows)) {
          throw new ToolError('setiap sheet butuh "name" (string) dan "rows" (array baris)')
        }
        const worksheet = workbook.addWorksheet(sheet.name.slice(0, 31))
        for (const row of sheet.rows as unknown[]) {
          if (!Array.isArray(row)) throw new ToolError('setiap baris harus berupa array nilai sel')
          totalCells += row.length
          if (totalCells > MAX_CELLS_WRITE) {
            throw new ToolError(`terlalu besar — maksimum ${MAX_CELLS_WRITE} sel`)
          }
          worksheet.addRow(row)
        }
        rapikanSheet(worksheet)
      }
      await workbook.xlsx.writeFile(file)
      return JSON.stringify({
        written: file,
        sheets: sheets.length,
        catatan:
          'Header sudah ditebalkan & diberi warna, kolom angka rata kanan dengan pemisah ribuan, ' +
          'baris header dibekukan, dan filter otomatis dipasang. Tidak perlu merapikan lagi lewat tool lain.'
      })
    }
  },
  {
    name: 'read_word',
    // `fromLine` sengaja ditambahkan bersamaan dengan catatan kelengkapan:
    // menyatakan "ada sisa" tanpa memberi cara melanjutkan adalah setengah
    // perbaikan — model akan menyerah atau mengarang sisanya (persis yang
    // terjadi pada read_pdf 19 Agu 2026 sebelum diberi fromPage).
    description:
      'Membaca isi teks dari file Word — mendukung .docx maupun format lama .doc. Hasilnya SELALU ' +
      'menyatakan apakah dokumen terbaca seluruhnya; kalau ada sisa, ia menyebut fromLine untuk ' +
      'melanjutkan. JANGAN menyimpulkan ada bagian yang terpotong kecuali hasil tool mengatakannya.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path file .docx atau .doc' },
        fromLine: {
          type: 'number',
          description:
            'Mulai dari baris ke berapa (1-based). Diisi HANYA untuk melanjutkan bacaan yang hasil ' +
            'sebelumnya menyebut "lanjutkanDari".'
        }
      },
      required: ['path']
    },
    tier: 'read',
    timeoutMs: 60_000,
    summarize: (a) => `Baca Word ${a.path}`,
    execute: async (args, ctx) => {
      const file = resolveInBoundary(str(args, 'path'), ctx.allowedDirs)
      const lower = file.toLowerCase()
      let text: string
      if (lower.endsWith('.docx')) {
        text = (await mammoth.extractRawText({ path: file })).value ?? ''
      } else if (lower.endsWith('.doc')) {
        const extracted = await new WordExtractor().extract(file)
        text = extracted.getBody() ?? ''
      } else {
        throw new ToolError('file harus berekstensi .docx atau .doc')
      }
      // ⚠️ Bendera `truncated` SAJA tidak cukup — lihat catatan panjang di
      // `text-read.ts`. Pada 21 Agu 2026 model menulis "sebagian tengah dokumen
      // terpotong" untuk file yang terbaca UTUH, padahal hasil tool sudah
      // menyertakan truncated: false. Yang bekerja adalah KALIMAT.
      const totalBarisWord = text.split('\n').length
      const potonganWord = potongTeks(text, Number(args.fromLine) || 1, MAX_TEXT_CHARS)
      return JSON.stringify({
        path: file,
        totalBaris: totalBarisWord,
        barisTerbaca: `${potonganWord.dariBaris}-${potonganWord.sampaiBaris}`,
        lanjutkanDari: potonganWord.lanjutkanDari,
        catatanHasil: catatanBaca(potonganWord, totalBarisWord, path.basename(file)),
        text: potonganWord.teks
      })
    }
  },
  {
    name: 'read_pdf',
    label: 'Baca PDF',
    description:
      'Membaca isi teks dari file PDF. Bila PDF adalah hasil SCAN (tidak ada lapisan teks), ' +
      'halamannya otomatis dibaca dengan OCR. Untuk tabel, pakai read_pdf_tables agar lebih rapi. ' +
      'DOKUMEN PANJANG dibaca bertahap. JANGAN mengisi toPage kecuali user memang meminta ' +
      'halaman tertentu — tool ini otomatis mengambil sebanyak yang muat. Hasilnya selalu memuat ' +
      'field catatan yang menyatakan halaman mana yang lengkap dan halaman mana yang belum ' +
      'terbaca; ikuti catatan itu apa adanya dan JANGAN menyimpulkan sendiri ada teks yang ' +
      'terpotong. Bila lanjutkanDari berisi angka, panggil tool ini lagi dengan fromPage berisi ' +
      'angka tersebut sampai lanjutkanDari bernilai null.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path file .pdf' },
        fromPage: {
          type: 'number',
          description: 'Mulai dari halaman ke berapa (default 1). Dipakai untuk melanjutkan dokumen panjang.'
        },
        toPage: {
          type: 'number',
          description: 'Berhenti di halaman ke berapa (default: halaman terakhir).'
        },
        ocrPages: {
          type: 'number',
          description: `Batas halaman yang di-OCR bila PDF hasil scan (default 8, maksimum ${MAX_OCR_PAGES})`
        }
      },
      required: ['path']
    },
    tier: 'read',
    timeoutMs: 10 * 60_000,
    summarize: (a) => `Baca PDF ${a.path}`,
    execute: async (args, ctx) => {
      const file = resolveInBoundary(str(args, 'path'), ctx.allowedDirs)
      requireExt(file, '.pdf')
      const dari = Math.max(Math.floor(Number(args.fromPage) || 1), 1)
      const sampaiDiminta = Math.floor(Number(args.toPage) || 0)

      const parser = new PDFParse({ data: readFileSync(file) })
      let text = ''
      let halaman: HalamanPdf[] = []
      try {
        const hasil = await parser.getText()
        text = hasil.text ?? ''
        // pdf-parse 2.x mengembalikan teks PER HALAMAN. Ini yang membuat dokumen
        // panjang bisa dibaca bertahap alih-alih dipotong di tengah kalimat.
        halaman = Array.isArray((hasil as { pages?: unknown }).pages)
          ? ((hasil as { pages: Array<{ num?: number; text?: string }> }).pages.map((p, i) => ({
              num: typeof p.num === 'number' ? p.num : i + 1,
              text: p.text ?? ''
            })) as HalamanPdf[])
          : []
      } finally {
        await parser.destroy().catch(() => undefined)
      }

      if (hasTextLayer(text)) {
        // Tanpa data per halaman (PDF aneh / versi library lain), jatuh ke perilaku
        // lama supaya tidak ada dokumen yang tiba-tiba gagal dibaca sama sekali.
        if (halaman.length === 0) {
          return JSON.stringify({
            path: file,
            source: 'text-layer',
            truncated: text.length > MAX_TEXT_CHARS,
            text: text.slice(0, MAX_TEXT_CHARS)
          })
        }

        const potongan = potongHalaman(
          halaman,
          dari,
          sampaiDiminta > 0 ? sampaiDiminta : halaman.length,
          MAX_TEXT_CHARS
        )
        return JSON.stringify({
          path: file,
          source: 'text-layer',
          totalHalaman: halaman.length,
          halamanTerbaca: `${potongan.dariHalaman}-${potongan.sampaiHalaman}`,
          lanjutkanDari: potongan.lanjutkanDari,
          truncated: potongan.lanjutkanDari !== null,
          catatan: catatanHasil(
            potongan,
            halaman.length,
            halamanNyarisKosong(halaman, potongan.dariHalaman, potongan.sampaiHalaman)
          ),
          text: potongan.teks
        })
      }

      // Tidak ada lapisan teks -> PDF hasil scan, jalankan OCR.
      const limit = Math.min(Number(args.ocrPages) || 8, MAX_OCR_PAGES)
      const ocr = await ocrPdf(file, limit, dari)
      const combined = ocr.pages.map((p) => `[Halaman ${p.page}]\n${p.text}`).join('\n\n')
      if (!combined.replace(/\[Halaman \d+\]/g, '').trim()) {
        throw new ToolError('OCR tidak menemukan teks — kemungkinan halaman kosong atau tulisan tangan')
      }
      const halamanTerakhirOcr = ocr.pages[ocr.pages.length - 1]?.page ?? dari
      const adaLagi = ocr.truncated || combined.length > MAX_TEXT_CHARS
      return JSON.stringify({
        path: file,
        source: 'ocr',
        pagesProcessed: ocr.pages.length,
        halamanTerbaca: `${dari}-${halamanTerakhirOcr}`,
        lanjutkanDari: adaLagi ? halamanTerakhirOcr + 1 : null,
        truncated: adaLagi,
        catatan:
          (adaLagi
            ? `Hasil OCR halaman ${dari}-${halamanTerakhirOcr} disertakan. Masih ada halaman berikutnya — panggil read_pdf lagi dengan fromPage: ${halamanTerakhirOcr + 1}. `
            : `Hasil OCR halaman ${dari}-${halamanTerakhirOcr} disertakan LENGKAP. `) +
          'JANGAN menyatakan ada teks yang terpotong selain yang disebutkan di catatan ini.',
        text: combined.slice(0, MAX_TEXT_CHARS)
      })
    }
  },
  {
    name: 'read_pdf_tables',
    label: 'Baca Tabel PDF',
    description:
      'Mengekstrak TABEL dari PDF sebagai baris/kolom terstruktur (bukan teks acak). ' +
      'Gunakan sebelum write_excel bila user ingin mengubah tabel PDF menjadi Excel.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path file .pdf' },
        page: { type: 'number', description: 'Nomor halaman tertentu (opsional, default semua)' }
      },
      required: ['path']
    },
    tier: 'read',
    timeoutMs: 120_000,
    summarize: (a) => `Baca tabel PDF ${a.path}${a.page ? ` (hal. ${a.page})` : ''}`,
    execute: async (args, ctx) => {
      const file = resolveInBoundary(str(args, 'path'), ctx.allowedDirs)
      requireExt(file, '.pdf')
      const parser = new PDFParse({ data: readFileSync(file) })
      try {
        const result = await parser.getTable()
        const wanted = Number(args.page)
        const pages = (result.pages ?? [])
          .filter((p) => (Number.isFinite(wanted) && wanted > 0 ? p.num === wanted : true))
          .map((p) => ({
            page: p.num,
            tables: (p.tables ?? []).map((rows) =>
              (rows as unknown[][]).slice(0, MAX_ROWS).map((row) =>
                row.map((cell) => String(cell ?? '').replace(/\s+/g, ' ').trim().slice(0, 300))
              )
            )
          }))
          .filter((p) => p.tables.length > 0)
        if (pages.length === 0) {
          throw new ToolError('tidak ditemukan tabel — untuk PDF hasil scan gunakan read_pdf (OCR)')
        }
        return JSON.stringify({ path: file, pages })
      } finally {
        await parser.destroy().catch(() => undefined)
      }
    }
  },
  {
    name: 'convert_office',
    description:
      'Mengonversi file Office format lama ke format baru: .doc -> .docx, .xls -> .xlsx, .ppt -> .pptx. ' +
      'Menghasilkan file BARU di sebelah file asli (file asli tidak diubah). Butuh Microsoft Office terinstall. ' +
      'Setelah konversi, baca hasilnya dengan read_word / read_excel / read_ppt.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path file .doc / .xls / .ppt' } },
      required: ['path']
    },
    tier: 'write',
    timeoutMs: 180_000,
    summarize: (a) => `Konversi ${a.path} ke format Office baru`,
    execute: async (args, ctx) => {
      const file = resolveInBoundary(str(args, 'path'), ctx.allowedDirs)
      if (!existsSync(file)) throw new ToolError('file tidak ditemukan')
      const ext = path.extname(file).toLowerCase()
      const conversion = CONVERSIONS[ext]
      if (!conversion) {
        throw new ToolError(`ekstensi "${ext}" tidak didukung — hanya .doc, .xls, .ppt`)
      }
      const target = file.slice(0, -ext.length) + conversion.to
      if (existsSync(target)) {
        return JSON.stringify({ alreadyExists: target, note: 'versi baru sudah ada, langsung baca file ini' })
      }
      await runConversion(conversion.vbs, file, target, 170_000)
      if (!existsSync(target)) throw new ToolError('konversi selesai tapi file hasil tidak ditemukan')
      return JSON.stringify({ converted: file, to: target })
    }
  },
  {
    name: 'write_word',
    description:
      'Membuat file Word (.docx) BARU dari blok konten. ' +
      'Tipe blok: "h1" | "h2" | "h3" (heading), "p" (paragraf), "bullet" (poin).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path file .docx baru' },
        blocks: {
          type: 'array',
          description: 'Isi dokumen, urut dari atas ke bawah',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['h1', 'h2', 'h3', 'p', 'bullet'] },
              text: { type: 'string' }
            },
            required: ['type', 'text']
          }
        }
      },
      required: ['path', 'blocks']
    },
    tier: 'write',
    timeoutMs: 60_000,
    summarize: (a) => `Buat Word baru ${a.path}`,
    execute: async (args, ctx) => {
      const file = resolveInBoundary(str(args, 'path'), ctx.allowedDirs)
      requireExt(file, '.docx')
      requireNewFile(file)
      const blocks = args.blocks
      if (!Array.isArray(blocks) || blocks.length === 0) {
        throw new ToolError('argumen "blocks" wajib berupa array berisi minimal satu blok')
      }
      const HEADINGS: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
        h1: HeadingLevel.HEADING_1,
        h2: HeadingLevel.HEADING_2,
        h3: HeadingLevel.HEADING_3
      }
      const children = (blocks as Array<{ type?: unknown; text?: unknown }>).map((block) => {
        const type = typeof block?.type === 'string' ? block.type : 'p'
        const text = typeof block?.text === 'string' ? block.text : ''
        if (type in HEADINGS) return new Paragraph({ text, heading: HEADINGS[type] })
        if (type === 'bullet') return new Paragraph({ text, bullet: { level: 0 } })
        return new Paragraph({ text })
      })
      // Font korporat. Tidak tertanam di .docx — bergantung font yang terpasang
      // di komputer pembaca (lihat catatan di sales-tools.ts).
      const doc = new Document({
        styles: { default: { document: { run: { font: 'company serif font' } } } },
        sections: [{ children }]
      })
      writeFileSync(file, await Packer.toBuffer(doc))
      return JSON.stringify({ written: file, blocks: blocks.length })
    }
  },
  {
    name: 'write_pdf',
    label: 'Buat PDF',
    description:
      'Membuat file PDF (.pdf) BARU dari teks Markdown. Mendukung judul (#, ##, ###), tebal ' +
      '(**teks**), miring, poin, penomoran, blok kode, garis pemisah, dan TABEL gaya Markdown ' +
      '(| kolom | kolom |). Kolom yang isinya angka otomatis rata kanan. Pakai untuk laporan atau ' +
      'ringkasan yang akan dikirim/dicetak — PDF tidak berubah di tangan penerima seperti .docx. ' +
      'Untuk laporan penjualan resmi, pakai sales_report yang mengisi angkanya sendiri.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path file .pdf baru' },
        markdown: { type: 'string', description: 'Isi dokumen dalam format Markdown' },
        title: { type: 'string', description: 'Judul yang tampil di kepala halaman pertama' },
        subtitle: { type: 'string', description: 'Baris kecil di bawah judul, mis. periode' },
        landscape: {
          type: 'boolean',
          description: 'true untuk orientasi mendatar — pakai bila tabelnya lebar'
        }
      },
      required: ['path', 'markdown']
    },
    tier: 'write',
    timeoutMs: 90_000,
    summarize: (a) => `Buat PDF ${a.path}`,
    execute: async (args, ctx) => {
      const file = resolveInBoundary(str(args, 'path'), ctx.allowedDirs)
      requireExt(file, '.pdf')
      requireNewFile(file)
      const markdown = str(args, 'markdown')
      if (markdown.trim().length === 0) {
        throw new ToolError('argumen "markdown" tidak boleh kosong')
      }
      if (!pdfSiap()) {
        throw new ToolError('pembuatan PDF belum siap — aplikasi masih memuat, coba lagi sebentar')
      }

      const judul = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : undefined
      const hasil = await tulisPdfDariMarkdown(markdown, file, {
        judul,
        subjudul:
          typeof args.subtitle === 'string' && args.subtitle.trim() ? args.subtitle.trim() : undefined,
        catatanKaki: judul,
        mendatar: args.landscape === true
      })

      return JSON.stringify({
        written: hasil.path,
        halaman: hasil.halaman,
        ukuranByte: hasil.bytes,
        catatanHasil:
          `PDF sudah ditulis (${hasil.halaman} halaman, A4${args.landscape === true ? ' mendatar' : ''}), ` +
          'lengkap dengan nomor halaman. Sampaikan lokasi filenya ke user; JANGAN menyalin ulang ' +
          `seluruh isinya ke chat. Catatan keterbatasan: ${FITUR_TIDAK_DIDUKUNG}.`
      })
    }
  },
  {
    name: 'read_ppt',
    description: 'Membaca teks dari file PowerPoint (.pptx), per slide.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path file .pptx' } },
      required: ['path']
    },
    tier: 'read',
    timeoutMs: 60_000,
    summarize: (a) => `Baca PowerPoint ${a.path}`,
    execute: async (args, ctx) => {
      const file = resolveInBoundary(str(args, 'path'), ctx.allowedDirs)
      requireExt(file, '.pptx')
      const zip = await JSZip.loadAsync(readFileSync(file))
      const slideFiles = Object.keys(zip.files)
        .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
      const slides: Array<{ slide: number; texts: string[] }> = []
      for (const [index, name] of slideFiles.entries()) {
        const xml = await zip.files[name].async('string')
        const texts = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)]
          .map((m) => m[1].trim())
          .filter(Boolean)
        slides.push({ slide: index + 1, texts })
      }
      return JSON.stringify({ path: file, slideCount: slides.length, slides })
    }
  },
  {
    name: 'write_ppt',
    label: 'Buat presentasi',
    description:
      'Membuat presentasi PowerPoint (.pptx) BARU memakai template korporat the company (16:9, logo & ' +
      'warna hijau the company sudah terpasang otomatis). Setiap slide WAJIB memilih satu "layout"; ' +
      'jangan menyebut posisi, ukuran huruf, atau warna — tata letaknya sudah diatur template.\n' +
      'Layout yang tersedia:\n' +
      '- sampul: {judul, subjudul?, catatan?} — slide pembuka, wajib jadi slide pertama\n' +
      '- agenda: {judul?, item:[teks]} — daftar bernomor, maksimal 12 item\n' +
      '- bagian: {judul, subjudul?} — pembatas antar bagian\n' +
      '- poin: {judul, poin:[teks ATAU {teks, ikon}]} — poin-poin isi, boleh berikon\n' +
      '- dua-kolom: {judul, kiri:{judul?,poin[]}, kanan:{judul?,poin[]}} — perbandingan\n' +
      '- angka: {judul, kartu:[{nilai,label,ikon?}], catatan?} — 1-4 angka penting (KPI)\n' +
      '- tabel: {judul, kolom:[..], baris:[[..]], catatan?}\n' +
      '- grafik: {judul, jenis:"batang"|"garis"|"pai", label:[..], seri:[{nama,nilai:[angka]}], catatan?} ' +
      '— grafik PowerPoint asli yang bisa diedit; nilai harus angka murni\n' +
      '- gambar: {judul, gambar:"deskripsi ilustrasi", keterangan?} — slide ilustrasi; gambarnya ' +
      'DIBUAT OLEH AIRA dari deskripsi itu, maksimal 6 per presentasi, ±8 detik per gambar. ' +
      'JANGAN dipakai untuk grafik data (pakai layout "grafik"), diagram alur, atau logo resmi. ' +
      'Pakai HANYA bila user memang meminta atau menyetujui ilustrasi\n' +
      '- penutup: {} — slide terima kasih, taruh paling akhir\n' +
      // Daftar ikonnya 71 nama (646 karakter). Deskripsi tool dikirim ULANG
      // setiap giliran dan `--enable-prefix-caching` belum aktif di gateway,
      // jadi yang dikirim cuma contohnya. Nama yang salah tidak berakhir
      // sebagai kotak kosong: tool menolak dan menyarankan nama yang mirip.
      `Ikon (opsional) disebut dengan nama Indonesia, mis. ${IKON_CONTOH.join(', ')} — ` +
      `${NAMA_IKON.length} nama tersedia; bila namanya tidak ada, tool menolak sambil ` +
      'menyarankan yang mirip.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path file .pptx baru' },
        title: { type: 'string', description: 'Judul presentasi (masuk ke properti file)' },
        slides: {
          type: 'array',
          description: 'Daftar slide; tiap slide wajib punya "layout"',
          items: {
            type: 'object',
            properties: {
              layout: {
                type: 'string',
                enum: [...LAYOUT_TERSEDIA],
                description: 'Jenis slide'
              },
              judul: { type: 'string' },
              subjudul: { type: 'string' },
              catatan: { type: 'string' },
              item: { type: 'array', items: { type: 'string' } },
              poin: {
                type: 'array',
                description: 'Poin isi: string, atau objek {teks, ikon}',
                items: {}
              },
              kiri: { type: 'object' },
              kanan: { type: 'object' },
              kartu: { type: 'array', items: { type: 'object' } },
              kolom: { type: 'array', items: { type: 'string' } },
              baris: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
              jenis: { type: 'string', enum: ['batang', 'garis', 'pai'] },
              gambar: {
                type: 'string',
                description:
                  'Layout "gambar": deskripsi ilustrasi yang akan dibuat AI — objek, gaya, warna, latar'
              },
              keterangan: { type: 'string', description: 'Layout "gambar": keterangan di bawah gambar' },
              label: { type: 'array', items: { type: 'string' } },
              seri: { type: 'array', items: { type: 'object' } }
            },
            required: ['layout']
          }
        }
      },
      required: ['path', 'slides']
    },
    tier: 'write',
    // Ilustrasi AI menambah ±8 detik PER GAMBAR (terukur 1024×1024). Deck
    // berisi 6 ilustrasi = ±50 detik hanya untuk gambarnya, di luar render.
    timeoutMs: 300_000,
    summarize: (a) =>
      `Buat presentasi ${a.path}` +
      (Array.isArray(a.slides) ? ` (${(a.slides as unknown[]).length} slide)` : ''),
    execute: async (args, ctx) => {
      const file = resolveInBoundary(str(args, 'path'), ctx.allowedDirs)
      requireExt(file, '.pptx')
      requireNewFile(file)
      // Bentuk `slides` (array atau teks JSON) dinormalkan DI SINI supaya
      // ilustrasi bisa dibuat sebelum render — `tulisPresentasi` menormalkan
      // lagi, dan itu tidak apa-apa (idempoten).
      const daftar = bacaSlides(args.slides).map(normalkanSlide) as SlideSpec[]
      const judul = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : undefined

      // Ilustrasi AI: dibuat SEKARANG, satu per satu.
      //
      // ⚠️ Berurutan, bukan Promise.all. Gateway gambar dipakai bersama aplikasi
      // lain di the company, dan menembakkan enam permintaan sekaligus adalah pola
      // yang sudah terbukti rapuh di project ini (pemanasan pool, §koneksi).
      const slideGambar = daftar.filter(
        (s): s is Extract<SlideSpec, { layout: 'gambar' }> =>
          !!s && typeof s === 'object' && (s as { layout?: string }).layout === 'gambar'
      )
      pastikanJumlahGambar(slideGambar.length)
      const gagal: string[] = []
      for (const s of slideGambar) {
        const prompt = pastikanPrompt(s.gambar)
        try {
          const png = await buatGambar({ prompt, ukuran: UKURAN_GAMBAR_PPT, jumlah: 1 })
          // Diperkecil supaya deck tetap bisa dikirim lewat email (§gambar).
          s.png = kecilkanPng(png[0], SISI_GAMBAR_PPT)
        } catch (err) {
          // Satu gambar gagal TIDAK membatalkan presentasinya. Slidenya tetap
          // dibuat dan kegagalannya disebut di catatan hasil — yang berbahaya
          // adalah deck yang kehilangan isi tanpa keterangan (§49).
          gagal.push(`${s.judul}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      const hasil = await tulisPresentasi(daftar, file, { judulDokumen: judul })
      return JSON.stringify({
        written: hasil.path,
        slides: hasil.slides,
        gambar: slideGambar.length - gagal.length,
        catatanHasil:
          hasil.catatan.join(' ') +
          (gagal.length ? ` Sebab kegagalan ilustrasi: ${gagal.join(' | ')}.` : '') +
          (slideGambar.length === 0 ? ` ${TAWARKAN_ILUSTRASI}` : '') +
          ' Sampaikan lokasi filenya ke user dan ringkas isinya singkat; JANGAN menyalin ulang ' +
          'seluruh isi slide ke chat.'
      })
    }
  }
]
