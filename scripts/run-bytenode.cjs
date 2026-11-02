// Menjalankan `bytenode-compile.mjs` di bawah runtime Electron.
//
// Perantara ini ada karena satu alasan: bytecode V8 HARUS dihasilkan oleh V8 yang
// sama dengan yang akan menjalankannya. `ELECTRON_RUN_AS_NODE=1` membuat binary
// Electron berperilaku seperti Node — Node-nya Electron, dengan V8-nya Electron.
//
// Ditulis sebagai skrip Node (bukan langsung di package.json) supaya penyetelan
// variabel lingkungannya bekerja sama di PowerShell, cmd, dan bash. `VAR=x cmd`
// adalah sintaks bash yang TIDAK berlaku di PowerShell, dan npm di Windows
// menjalankan script lewat cmd.

const { spawnSync } = require('child_process')
const { join } = require('path')

const electron = require('electron')
if (typeof electron !== 'string') {
  console.error('bytenode: path binary Electron tidak ditemukan')
  process.exit(1)
}

const hasil = spawnSync(electron, [join(__dirname, 'bytenode-compile.mjs')], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})

// Kegagalan di sini WAJIB menghentikan build. Kalau dibiarkan lanjut,
// electron-builder akan membungkus main process yang tidak terkompilasi dan
// installer-nya terlihat sukses padahal proteksinya tidak terpasang.
process.exit(hasil.status ?? 1)
