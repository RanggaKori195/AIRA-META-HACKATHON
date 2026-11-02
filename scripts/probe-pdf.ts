// Menakar PDF besar: berapa halaman, berapa karakter, dan apakah pdf-parse bisa
// mengambil per-halaman (supaya bisa dibaca bertahap alih-alih dipotong di tengah).
import { readFileSync } from 'fs'
import { PDFParse } from 'pdf-parse'

const file = process.argv[2]
if (!file) {
  console.error('pakai: npx tsx scripts/probe-pdf.ts <path.pdf>')
  process.exit(1)
}

async function main(): Promise<void> {
  const data = readFileSync(file)
  console.log('ukuran file:', (data.length / 1024 / 1024).toFixed(1), 'MB')

  const parser = new PDFParse({ data })
  try {
    const t0 = Date.now()
    const info: any = await parser.getInfo()
    console.log('halaman:', info?.total ?? info?.numPages ?? '(tidak diketahui)', `— getInfo ${Date.now() - t0} ms`)

    const t1 = Date.now()
    const hasil: any = await parser.getText()
    const msText = Date.now() - t1
    console.log('getText:', msText, 'ms | total karakter:', (hasil.text ?? '').length.toLocaleString('id-ID'))
    console.log('kunci hasil getText:', Object.keys(hasil).join(', '))

    if (Array.isArray(hasil.pages)) {
      console.log('ADA data per-halaman:', hasil.pages.length, 'halaman')
      console.log('  kunci tiap halaman:', Object.keys(hasil.pages[0] ?? {}).join(', '))
      const panjang = hasil.pages.map((p: any) => String(p.text ?? '').length)
      console.log('  karakter hal 1-5:', panjang.slice(0, 5).join(', '))
      console.log('  rata-rata per halaman:', Math.round(panjang.reduce((a: number, b: number) => a + b, 0) / panjang.length))
    } else {
      console.log('TIDAK ada data per-halaman di getText()')
    }

    // Apakah bisa minta rentang halaman saja?
    for (const opts of [{ first: 1, last: 3 }, { partial: [1, 2, 3] }]) {
      try {
        const t = Date.now()
        const sebagian: any = await parser.getText(opts as any)
        console.log(
          `getText(${JSON.stringify(opts)}):`,
          Date.now() - t,
          'ms | karakter:',
          (sebagian.text ?? '').length.toLocaleString('id-ID')
        )
      } catch (e) {
        console.log(`getText(${JSON.stringify(opts)}): DITOLAK — ${(e as Error).message.slice(0, 80)}`)
      }
    }
  } finally {
    await parser.destroy().catch(() => undefined)
  }
}

void main()
