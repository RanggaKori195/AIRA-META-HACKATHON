/**
 * BUKTI grafik benar-benar masuk ke PDF, Word, dan Excel — di runtime Electron.
 *
 * Rasterisasi memakai Chromium, jadi tidak bisa dibuktikan dari `npx tsx`.
 * Dan pelajaran project: "file berhasil dibuat" BUKAN bukti. Di sini setiap
 * berkas DIBONGKAR dan diperiksa isinya.
 *
 * Jalankan: npm run coba:grafik
 */
import { app } from 'electron'
import { existsSync, readFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.AIRA_LOG_SILENT = '1'
app.on('window-all-closed', () => {})

const masalah: string[] = []
let no = 0
function periksa(judul: string, lolos: boolean, detail: string): void {
  no++
  console.log(`${lolos ? 'OK   ' : 'GAGAL'} ${no}. ${judul}`)
  console.log(`        ${detail}`)
  if (!lolos) masalah.push(`${judul} — ${detail}`)
}

async function jalan(): Promise<void> {
  const { keSvg } = await import('../src/main/grafik/svg')
  const { keSvgPng, tutupJendelaGrafik } = await import('../src/main/grafik/raster')
  const { sisipkanGrafik } = await import('../src/main/grafik/sisip')
  const { tulisPdfDariHtml } = await import('../src/main/pdf/render')
  const { markdownToHtml } = await import('../src/main/pdf/markdown')

  const dir = join(tmpdir(), `aira-grafik-${Date.now()}`)
  mkdirSync(dir, { recursive: true })

  const spek = {
    jenis: 'batang' as const,
    judul: 'Nett per pemeriksaan — Agustus 2026',
    label: ['EGFR', 'ALK EML4', 'MammaPrint', 'HPV DNA'],
    seri: [{ nama: 'Nett', nilai: [1_598_000_000, 1_068_000_000, 40_000_000, 4_730_000_000] }],
    satuan: 'Rp'
  }

  // 1. SVG
  const svg = keSvg(spek)
  periksa('SVG terbentuk & memuat data yang diberikan',
    svg.startsWith('<svg') && svg.includes('EGFR') && svg.includes('</svg>'),
    `${svg.length} karakter`)

  // 2. PNG lewat Chromium
  const png = await keSvgPng(spek)
  const magicPng = png ? png.subarray(0, 8).toString('hex') : ''
  periksa('PNG dirender Chromium & magic byte-nya sah',
    magicPng === '89504e470d0a1a0a' && (png?.length ?? 0) > 5000,
    png ? `${png.length} byte, magic ${magicPng}` : 'PNG null')

  // ⚠️ PNG putih polos juga punya magic byte yang sah. Ukuran yang wajar dan
  // adanya variasi warna yang membedakan "gambar jadi" dari "halaman kosong".
  periksa('PNG bukan halaman kosong', (png?.length ?? 0) > 12_000,
    `${png?.length ?? 0} byte (halaman putih polos jauh lebih kecil)`)

  // 3. PDF — SVG ditanam, harus tetap VEKTOR
  const pdf = join(dir, 'uji.pdf')
  const html = sisipkanGrafik(markdownToHtml('# Laporan Uji\n\n## Ringkasan\n\nIsi.'), [svg])
  periksa('grafik disisipkan SESUDAH judul, bukan di akhir',
    html.indexOf('grafik-ringkas') > html.indexOf('</h1>') &&
      html.indexOf('grafik-ringkas') < html.indexOf('Ringkasan'),
    'urutan: h1 -> grafik -> bagian pertama')
  await tulisPdfDariHtml(html, pdf, { judul: 'Uji Grafik' })
  const isiPdf = readFileSync(pdf)
  periksa('PDF terbit dan tidak kosong', existsSync(pdf) && isiPdf.length > 20_000,
    `${(isiPdf.length / 1024).toFixed(0)} KB`)
  // Grafik vektor menghasilkan operator penggambaran, bukan objek gambar.
  const teksPdf = isiPdf.toString('latin1')
  periksa('grafik di PDF berupa VEKTOR, bukan gambar tertanam',
    !teksPdf.includes('/Subtype /Image') && !teksPdf.includes('/Subtype/Image'),
    'tidak ada objek /Image di dalam PDF')

  // 4. Word
  const { Document, Packer, Paragraph, ImageRun } = await import('docx')
  const docx = join(dir, 'uji.docx')
  const doc = new Document({
    sections: [{ children: [
      new Paragraph({ text: 'Judul' }),
      new Paragraph({ children: [new ImageRun({ type: 'png', data: png!, transformation: { width: 600, height: 300 } })] })
    ] }]
  })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(docx, await Packer.toBuffer(doc))
  const JSZip = (await import('jszip')).default
  const zipDocx = await JSZip.loadAsync(readFileSync(docx))
  const mediaDocx = Object.keys(zipDocx.files).filter(
    (n) => n.startsWith('word/media/') && !zipDocx.files[n].dir
  )
  periksa('Word memuat berkas gambar di dalamnya', mediaDocx.length > 0,
    mediaDocx.join(', ') || 'TIDAK ADA media')
  if (mediaDocx.length > 0) {
    const isi = await zipDocx.files[mediaDocx[0]].async('nodebuffer')
    periksa('gambar di Word benar-benar PNG (magic byte diperiksa)',
      isi.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
      `${mediaDocx[0]} — ${isi.length} byte`)
  }

  // 5. Excel
  const ExcelJS = (await import('exceljs')).default
  const xlsx = join(dir, 'uji.xlsx')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Grafik')
  ws.addRow(['Uji'])
  const id = wb.addImage({ buffer: png as never, extension: 'png' })
  ws.addImage(id, { tl: { col: 0, row: 1 }, ext: { width: 720, height: 368 } })
  await wb.xlsx.writeFile(xlsx)
  const zipXlsx = await JSZip.loadAsync(readFileSync(xlsx))
  const mediaXlsx = Object.keys(zipXlsx.files).filter(
    (n) => n.startsWith('xl/media/') && !zipXlsx.files[n].dir
  )
  periksa('Excel memuat berkas gambar di dalamnya', mediaXlsx.length > 0,
    mediaXlsx.join(', ') || 'TIDAK ADA media')

  tutupJendelaGrafik()
  rmSync(dir, { recursive: true, force: true })
}

app.whenReady().then(async () => {
  try {
    await jalan()
  } catch (err) {
    masalah.push(`skrip berhenti: ${(err as Error)?.message ?? String(err)}`)
    console.error(err)
  }
  console.log('')
  console.log(masalah.length ? `ADA ${masalah.length} MASALAH:` : `Semua ${no} pemeriksaan lolos.`)
  for (const m of masalah) console.log(`  - ${m}`)
  app.exit(masalah.length ? 1 : 0)
})
