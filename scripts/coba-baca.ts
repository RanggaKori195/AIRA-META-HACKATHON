// Menjalankan tool `read_file` yang SUNGGUHAN pada file sungguhan, lalu
// menampilkan catatan kelengkapannya.
//
// Jalankan: npx tsx scripts/coba-baca.ts "D:\Laporan\Nama File.md"
//
// Ada karena kejadian 21 Agu 2026: AIRA menyatakan "sebagian tengah dokumen
// terpotong" pada file 11 KB yang terbaca UTUH. Test unit membuktikan kalimat
// catatannya benar; skrip ini membuktikan apa yang benar-benar diterima model
// ketika tool dipanggil pada berkas nyata.

import { fsTools } from '../src/main/tools/fs-tools'
import * as path from 'path'

const berkas = process.argv[2]
if (!berkas) {
  console.error('pakai: npx tsx scripts/coba-baca.ts "<path file>"')
  process.exit(1)
}

async function main(): Promise<void> {
  const tool = fsTools.find((t) => t.name === 'read_file')
  if (!tool) throw new Error('tool read_file tidak ditemukan')

  const hasil = await tool.execute(
    { path: berkas },
    { allowedDirs: [path.dirname(path.resolve(berkas))] }
  )
  const data = JSON.parse(hasil)

  console.log('path            :', data.path)
  console.log('ukuran (byte)   :', data.ukuranByte)
  console.log('total baris     :', data.totalBaris)
  console.log('baris terbaca   :', data.barisTerbaca)
  console.log('lanjutkan dari  :', data.lanjutkanDari)
  console.log('karakter isi    :', String(data.content).length)
  console.log('\ncatatanHasil yang DIBACA MODEL:\n')
  console.log(data.catatanHasil)

  // Pemeriksaan yang menentukan: apakah bagian yang dikira "terpotong" ada?
  const isi = String(data.content)
  const bagian = ['## 4', '## 5', '## 6', '## 7', '## 8']
  console.log('\nbagian yang sempat diklaim terpotong:')
  for (const b of bagian) {
    console.log(`  ${isi.includes(b) ? 'ADA   ' : 'TIDAK '} ${b}`)
  }
}

main().catch((err) => {
  console.error('GAGAL:', err)
  process.exit(1)
})
