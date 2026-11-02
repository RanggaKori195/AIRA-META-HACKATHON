// Menyiapkan berkas yang diunggah ke server update AIRA.
// Jalankan SESUDAH `npm run dist`:  npm run rilis:siapkan
//
// Hasil: folder `release/unggah/<versi>/` berisi TIGA berkas yang disalin apa
// adanya ke https://updates.internal.example/update/ :
//   latest.yml, AIRA Setup x.y.z.exe, AIRA Setup x.y.z.exe.blockmap
//
// ⚠️ Skrip ini MEMERIKSA, bukan sekadar menyalin: hash SHA-512 installer harus
// sama dengan yang tertulis di latest.yml. Kalau berbeda (mis. installer dibangun
// ulang tapi latest.yml tertinggal), SETIAP laptop akan mengunduh 460 MB lalu
// menolaknya — berulang tiap 4 jam, tanpa ada yang tahu sebabnya.
//
// ⚠️ Urutan unggah: installer + blockmap DULU, latest.yml TERAKHIR. latest.yml
// adalah pengumuman "ada versi baru"; kalau ia lebih dulu tiba, laptop yang
// mengecek di sela unggahan akan mengunduh installer yang belum lengkap.
import { createHash } from 'crypto'
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

const rilis = 'release'
const ymlPath = join(rilis, 'latest.yml')
if (!existsSync(ymlPath)) {
  console.error('release/latest.yml tidak ada. Jalankan `npm run dist` dulu.')
  process.exit(1)
}
const yml = readFileSync(ymlPath, 'utf8')
const versi = yml.match(/^version:\s*(\S+)/m)?.[1]
const berkas = yml.match(/^path:\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '')
const sha = yml.match(/^sha512:\s*(\S+)/m)?.[1]
if (!versi || !berkas || !sha) {
  console.error('latest.yml tidak memuat version/path/sha512 yang dikenali.')
  process.exit(1)
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
if (pkg.version !== versi) {
  console.error(`Versi package.json (${pkg.version}) ≠ latest.yml (${versi}). Build ulang dulu.`)
  process.exit(1)
}

const exe = join(rilis, berkas)
const blockmap = `${exe}.blockmap`
for (const f of [exe, blockmap]) {
  if (!existsSync(f)) {
    console.error(`Tidak ada: ${f}`)
    process.exit(1)
  }
}

const hash = await new Promise((resolve, reject) => {
  const h = createHash('sha512')
  createReadStream(exe)
    .on('data', (d) => h.update(d))
    .on('end', () => resolve(h.digest('base64')))
    .on('error', reject)
})
if (hash !== sha) {
  console.error('SHA-512 installer TIDAK cocok dengan latest.yml — jangan diunggah.')
  console.error(`  latest.yml: ${sha}\n  installer : ${hash}`)
  process.exit(1)
}

const tujuan = join(rilis, 'unggah', versi)
mkdirSync(tujuan, { recursive: true })
for (const f of [exe, blockmap, ymlPath]) copyFileSync(f, join(tujuan, f.split(/[\\/]/).pop()))

const mb = (f) => (statSync(f).size / 1048576).toFixed(1)
console.log(`Siap unggah AIRA ${versi} -> ${tujuan}`)
console.log(`  1. ${berkas}  (${mb(exe)} MB)`)
console.log(`  2. ${berkas}.blockmap  (${mb(blockmap)} MB)`)
console.log('  3. latest.yml   <- unggah PALING AKHIR')
console.log('SHA-512 installer cocok dengan latest.yml.')
