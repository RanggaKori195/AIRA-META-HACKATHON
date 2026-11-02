import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { perintahHanyaBaca } from '../src/main/tools/command-readonly'

describe('perintah baca boleh lewat tanpa dialog', () => {
  const boleh = [
    'claude --version',
    'node --version',
    'npm --version',
    'git --version',
    'npm list -g',
    'npm outdated',
    'git status',
    'git log --oneline',
    'git diff',
    'winget list',
    'winget search claude',
    'pip list',
    'where node',
    'which git',
    'whoami',
    'hostname',
    'docker ps'
  ]
  for (const c of boleh) {
    test(`lolos: ${c}`, () => assert.equal(perintahHanyaBaca(c), true))
  }
})

describe('perintah yang MENGUBAH tetap minta izin', () => {
  const tanya = [
    'npm install -g @anthropic-ai/claude-code',
    'npm update',
    'npm uninstall express',
    'winget install Git.Git',
    'winget upgrade --all',
    'pip install requests',
    'git push',
    'git reset --hard',
    'git clean -fd',
    'git checkout main',
    'del /s /q C:\\data',
    'rmdir /s /q D:\\API',
    'format C:',
    'shutdown /r'
  ]
  for (const c of tanya) {
    test(`ditahan: ${c}`, () => assert.equal(perintahHanyaBaca(c), false))
  }
})

describe('operator shell membatalkan seluruh daftar-izin', () => {
  test('KUNCI: token pertama yang aman tidak boleh meloloskan sisanya', () => {
    // Pelajaran §25 yang sudah dibayar sekali di ruang uji. Tanpa penolakan
    // operator, daftar-izin tidak berarti apa-apa — perintah di bawah lolos
    // hanya karena kata pertamanya "npm".
    assert.equal(perintahHanyaBaca('npm --version && del /s /q C:\\'), false)
    assert.equal(perintahHanyaBaca('git status; rm -rf /'), false)
    assert.equal(perintahHanyaBaca('whoami | powershell -c "hapus"'), false)
    assert.equal(perintahHanyaBaca('node --version > C:\\jahat.txt'), false)
    assert.equal(perintahHanyaBaca('git log `curl jahat.com`'), false)
    assert.equal(perintahHanyaBaca('npm ls $(rm -rf ~)'), false)
  })
})

describe('perintah PEMBACA BERKAS tidak boleh lolos', () => {
  test('type/cat/Get-Content ditahan walau "cuma membaca"', () => {
    // `type .env` mencetak kredensial ke jendela chat, lalu ikut terkirim ke
    // model. Untuk membaca berkas ada read_file, yang dibatasi folder akses.
    assert.equal(perintahHanyaBaca('type .env'), false)
    assert.equal(perintahHanyaBaca('cat .env'), false)
    assert.equal(perintahHanyaBaca('more secrets.json'), false)
    assert.equal(perintahHanyaBaca('Get-Content .env'), false)
  })
})

describe('sub-perintah baca yang diberi bendera penulis tetap ditahan', () => {
  test('config set / add / rm ditahan', () => {
    // `npm config set` dan `git config --global user.email` lolos pemeriksaan
    // sub-perintah, padahal keduanya MENULIS.
    assert.equal(perintahHanyaBaca('npm config set registry http://jahat'), false)
    assert.equal(perintahHanyaBaca('git config --global user.email x@y.z'), false)
    assert.equal(perintahHanyaBaca('git remote add jahat http://jahat'), false)
    assert.equal(perintahHanyaBaca('npm config get registry'), true)
  })
})

describe('yang tidak dikenal DITAHAN, bukan diloloskan', () => {
  test('daftar-IZIN, bukan daftar-larangan', () => {
    // Perintah yang belum terpikirkan harus tetap minta izin (pola §35).
    assert.equal(perintahHanyaBaca('programaneh --version'), false)
    assert.equal(perintahHanyaBaca('sesuatu-yang-baru list'), false)
    assert.equal(perintahHanyaBaca(''), false)
    assert.equal(perintahHanyaBaca('   '), false)
  })

  test('runner dengan path lengkap tetap dinilai dari namanya', () => {
    assert.equal(perintahHanyaBaca('C:\\nodejs\\node.exe --version'), true)
    assert.equal(perintahHanyaBaca('C:\\jahat\\virus.exe --version'), false)
  })

  test('path BERSPASI tanpa tanda kutip ditahan — bukan diloloskan', () => {
    // `C:\Program Files\nodejs\node.exe` tanpa kutip pecah jadi dua token, dan
    // token pertamanya "C:\Program". Bentuk ambigu seperti ini TIDAK boleh
    // ditebak baik-baik saja; kalau memang mau, tulis dengan tanda kutip.
    assert.equal(perintahHanyaBaca('C:\\Program Files\\nodejs\\node.exe --version'), false)
    assert.equal(perintahHanyaBaca('"C:\\Program Files\\nodejs\\node.exe" --version'), true)
  })
})

describe('pemeriksa lingkungan yang dipakai model di lapangan (8 Sep 2026)', () => {
  test('bentuk SEDERHANA lolos tanpa dialog', () => {
    // Ini yang sebenarnya ingin dilakukan model saat diminta upgrade Node.js.
    assert.equal(perintahHanyaBaca('nvm version'), true)
    assert.equal(perintahHanyaBaca('nvm list'), true)
    assert.equal(perintahHanyaBaca('choco version nodejs'), true)
    assert.equal(perintahHanyaBaca('winget list nodejs'), true)
    assert.equal(perintahHanyaBaca('where node'), true)
  })

  test('bentuk BEROPERATOR tetap minta izin — guard tidak dilonggarkan', () => {
    // Bentuk asli yang ditulis model. Niatnya membaca, tapi operator shell tetap
    // membatalkan daftar-izin: jalan keluarnya mengarahkan MODEL ke bentuk aman
    // (lihat deskripsi run_command), bukan melemahkan guardnya.
    assert.equal(perintahHanyaBaca('nvm version 2>nul || echo NVM_TIDAK_ADA'), false)
    assert.equal(perintahHanyaBaca('winget list nodejs 2>nul || echo WINGET_TIDAK_ADA'), false)
  })

  test('nvm yang MENGUBAH Node aktif tetap minta izin', () => {
    // `nvm use` mengganti Node untuk seluruh laptop — itu bukan pemeriksaan.
    assert.equal(perintahHanyaBaca('nvm install 26'), false)
    assert.equal(perintahHanyaBaca('nvm use 26'), false)
    assert.equal(perintahHanyaBaca('nvm uninstall 22'), false)
  })
})
