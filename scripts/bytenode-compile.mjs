// Mengubah bundle main process menjadi bytecode V8 (.jsc).
//
// Dijalankan SETELAH `electron-vite build`, SEBELUM `electron-builder`.
//
// ⚠️ WAJIB dijalankan di bawah runtime Electron, bukan Node biasa:
//     ELECTRON_RUN_AS_NODE=1 electron scripts/bytenode-compile.mjs
// Bytecode V8 terikat pada versi V8 yang menghasilkannya. Dikompilasi dengan Node
// biasa, hasilnya ditolak Electron saat start dan aplikasi TIDAK TERBUKA SAMA
// SEKALI — bukan gagal sebagian, melainkan mati di detik pertama. Skrip ini
// memeriksa sendiri bahwa ia berjalan di Electron dan berhenti bila tidak.
//
// ⚠️ Yang DILINDUNGI hanya bentuk logikanya. String literal tetap tersimpan apa
// adanya di constant pool bytecode dan bisa ditarik dengan `strings` — jadi
// connection string, SQL, dan system prompt TETAP terbaca. Bytenode bukan jawaban
// untuk kredensial; jawabannya user database berhak minimal.

import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

const MAIN = join(process.cwd(), 'out', 'main', 'index.js')
const JSC = join(process.cwd(), 'out', 'main', 'index.jsc')
const ASLI = join(process.cwd(), 'out', 'main', 'index.js.asli')

function keluar(pesan) {
  console.error(`bytenode: ${pesan}`)
  process.exit(1)
}

// `process.versions.electron` hanya ada bila dijalankan oleh binary Electron.
if (!process.versions.electron) {
  keluar(
    'harus dijalankan di bawah Electron.\n' +
      '  Pakai: npm run dist  (yang sudah menyetel ELECTRON_RUN_AS_NODE=1)\n' +
      '  Bytecode dari Node biasa akan ditolak saat aplikasi start.'
  )
}

if (!existsSync(MAIN)) keluar(`${MAIN} tidak ada — jalankan "electron-vite build" dulu`)

const sebelum = statSync(MAIN).size
const sumber = readFileSync(MAIN, 'utf8')

if (sumber.includes('index.jsc')) {
  console.log('bytenode: sudah dikompilasi sebelumnya, dilewati')
  process.exit(0)
}

const bytenode = require('bytenode')

bytenode.compileFile({
  filename: MAIN,
  output: JSC,
  // Tanpa ini V8 menunda kompilasi isi fungsi, sehingga sebagian besar kode
  // justru tersimpan sebagai sumber di dalam .jsc — persis yang ingin dihindari.
  compileAsModule: true
})

if (!existsSync(JSC)) keluar('kompilasi tidak menghasilkan index.jsc')

// Simpan sumbernya untuk penelusuran, TAPI di luar `out/**` yang ikut dipaket?
// Tidak: electron-builder hanya membawa out/**, jadi file ini ikut. Karena itu
// namanya diberi akhiran yang dikecualikan di electron-builder.yml.
renameSync(MAIN, ASLI)

// Loader tipis. Inilah satu-satunya JavaScript terbaca yang tersisa di main process.
writeFileSync(
  MAIN,
  "'use strict';\nrequire('bytenode');\nrequire('./index.jsc');\n",
  'utf8'
)

const sesudah = statSync(JSC).size
console.log(
  `bytenode: index.js (${sebelum.toLocaleString('id-ID')} B) -> index.jsc (${sesudah.toLocaleString('id-ID')} B)` +
    ` | electron=${process.versions.electron} v8=${process.versions.v8}`
)
