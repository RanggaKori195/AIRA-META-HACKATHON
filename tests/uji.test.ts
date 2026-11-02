import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  argumenKeluarRuang,
  butuhJaringan,
  catatanUji,
  pecahPerintah,
  periksaPerintah,
  potongKeluaran
} from '../src/main/uji/rules'
import { selectGroups } from '../src/main/agent/tool-groups'

// Ruang uji — permintaan manajemen 21 Agu 2026: "AIRA bisa testing dulu sebelum
// kasih ke user, biar jangan salah".
//
// ⚠️ Yang diuji di sini adalah SATU-SATUNYA pengaman yang tersisa. `uji_jalankan`
// sengaja TIDAK meminta persetujuan user di tiap panggilan — kalau tidak, loop
// perbaikan memunculkan 5-6 popup dan user menekan "izinkan" tanpa membaca.
// Konsekuensinya: apa pun yang lolos `periksaPerintah` akan benar-benar
// dijalankan tanpa ada manusia yang melihatnya lebih dulu.

describe('memecah perintah', () => {
  test('token dipisah spasi, tanda kutip dihormati', () => {
    assert.deepEqual(pecahPerintah('node tes.js'), ['node', 'tes.js'])
    assert.deepEqual(pecahPerintah('node "sub folder/tes.js"'), ['node', 'sub folder/tes.js'])
    assert.deepEqual(pecahPerintah("npx tsc --noEmit 'a b.ts'"), ['npx', 'tsc', '--noEmit', 'a b.ts'])
  })

  test('spasi berlebih tidak menghasilkan token kosong', () => {
    assert.deepEqual(pecahPerintah('  node    tes.js  '), ['node', 'tes.js'])
  })
})

describe('daftar-izin runner', () => {
  test('runner JS/TS diterima', () => {
    for (const p of [
      'node tes.js',
      'node --version',
      'npm test',
      'npx tsc --noEmit hitung.ts',
      'tsx tes.ts',
      'vitest run',
      'eslint index.js'
    ]) {
      assert.equal(periksaPerintah(p).ok, true, p)
    }
  })

  test('runner di luar daftar ditolak, disertai jalan keluarnya', () => {
    for (const p of ['python x.py', 'del tes.js', 'powershell -c ls', 'curl https://x.id', 'go run x.go']) {
      const v = periksaPerintah(p)
      assert.equal(v.ok, false, p)
      assert.match(v.alasan ?? '', /run_command/, `alasan untuk "${p}" harus menyebut jalan keluarnya`)
    }
  })

  test('ekstensi .cmd/.exe tidak bisa dipakai menyelundupkan runner lain', () => {
    assert.equal(periksaPerintah('npm.cmd test').ok, true)
    assert.equal(periksaPerintah('cmd.exe /c del x').ok, false)
  })

  test('perintah kosong ditolak', () => {
    assert.equal(periksaPerintah('   ').ok, false)
  })
})

describe('rangkaian shell', () => {
  // ⚠️ Ini yang membuat daftar-izin runner ada artinya. Tanpa penolakan
  // operator, `node tes.js && <apa pun>` lolos hanya karena token pertamanya
  // "node" — dan berjalan TANPA persetujuan user.
  test('operator berantai & pengalihan ditolak', () => {
    for (const p of [
      'node tes.js && del C:\\Users\\Admin\\Desktop\\penting.docx',
      'node tes.js; rm -rf .',
      'node tes.js | powershell -',
      'node tes.js > keluar.txt',
      'node $(whoami).js',
      'node tes.js `whoami`',
      'node tes.js\ndel x'
    ]) {
      const v = periksaPerintah(p)
      assert.equal(v.ok, false, p)
    }
  })
})

describe('tidak boleh keluar ruang uji', () => {
  test('argumen yang menunjuk ke luar dikenali', () => {
    for (const a of ['..\\..\\evil.js', '../../evil.js', 'C:\\Windows\\x.js', '\\\\server\\share\\x.js', '/etc/passwd']) {
      assert.equal(argumenKeluarRuang(a), true, a)
    }
  })

  test('argumen relatif yang wajar diterima', () => {
    for (const a of ['tes.js', 'sub/tes.js', 'sub\\tes.js', 'a..b.js', '--noEmit']) {
      assert.equal(argumenKeluarRuang(a), false, a)
    }
  })

  test('perintah dengan path keluar ruang ditolak', () => {
    const v = periksaPerintah('node ..\\..\\..\\Windows\\jahat.js')
    assert.equal(v.ok, false)
    assert.match(v.alasan ?? '', /ruang uji/i)
  })

  test('flag berawalan - tidak dianggap path', () => {
    // "--out=/tmp" berbentuk flag; yang dijaga adalah argumen posisional.
    assert.equal(periksaPerintah('tsc --noEmit').ok, true)
  })
})

describe('deteksi perintah yang menarik paket', () => {
  test('install/add/ci terdeteksi', () => {
    assert.equal(butuhJaringan('npm', ['install', 'lodash']), true)
    assert.equal(butuhJaringan('npm', ['i', 'lodash']), true)
    assert.equal(butuhJaringan('npm', ['ci']), true)
    assert.equal(butuhJaringan('yarn', ['add', 'dayjs']), true)
    assert.equal(butuhJaringan('pnpm', ['install']), true)
  })

  test('menjalankan test/build TIDAK dianggap menarik paket', () => {
    assert.equal(butuhJaringan('npm', ['test']), false)
    assert.equal(butuhJaringan('npm', ['run', 'build']), false)
    assert.equal(butuhJaringan('node', ['tes.js']), false)
  })

  test('yarn tanpa argumen = install', () => {
    assert.equal(butuhJaringan('yarn', []), true)
  })

  // npx mengunduh paket yang belum ada secara diam-diam, dan dari baris
  // perintahnya saja kita tidak bisa tahu apakah paketnya sudah lokal.
  test('npx selalu dianggap butuh jaringan', () => {
    assert.equal(butuhJaringan('npx', ['tsc', '--noEmit']), true)
    assert.equal(periksaPerintah('npx tsc --noEmit').butuhJaringan, true)
  })
})

describe('catatan hasil uji', () => {
  const dasar = { stdoutDipotong: false, stderrDipotong: false, timeout: false }

  test('tidak pernah kosong', () => {
    for (const r of [
      { ...dasar, exitCode: 0 },
      { ...dasar, exitCode: 1 },
      { ...dasar, exitCode: null, timeout: true },
      { ...dasar, exitCode: 9009, runnerHilang: 'npx' }
    ]) {
      assert.ok(catatanUji(r).length > 0, JSON.stringify(r))
    }
  })

  // ⚠️ Kasus paling berbahaya: uji TIDAK BERJALAN sama sekali. Kalau itu
  // dilaporkan seperti kegagalan biasa, model menyimpulkan "ada error kecil"
  // lalu tetap menyerahkan kodenya sebagai sudah beres.
  test('runner tidak terpasang dinyatakan sebagai UJI TIDAK BERJALAN', () => {
    const c = catatanUji({ ...dasar, exitCode: 9009, runnerHilang: 'npx' })
    assert.match(c, /UJI TIDAK BERJALAN/)
    assert.match(c, /npx/)
    assert.match(c, /jangan mengaku sudah mengujinya/i)
    // node selalu ada — arahkan ke sana.
    assert.match(c, /node/)
  })

  test('node yang hilang tidak menyarankan node lagi', () => {
    const c = catatanUji({ ...dasar, exitCode: 9009, runnerHilang: 'node' })
    assert.doesNotMatch(c, /SELALU tersedia/)
  })

  test('exit code bukan 0 menyuruh perbaiki dan uji lagi, bukan menyerahkan', () => {
    const c = catatanUji({ ...dasar, exitCode: 1 })
    assert.match(c, /GAGAL/)
    assert.match(c, /uji lagi|jalankan uji lagi/i)
    assert.match(c, /Jangan menyerahkan kode ini/i)
  })

  // Aturan project: hasil tool tidak boleh diam soal kelengkapannya, dan harus
  // menutup pintu bagi model untuk mengarang pemotongan yang tidak terjadi.
  test('kelengkapan keluaran selalu dinyatakan, lengkap dengan larangannya', () => {
    const utuh = catatanUji({ ...dasar, exitCode: 0 })
    assert.match(utuh, /utuh, tidak ada yang dipotong/i)
    assert.match(utuh, /Jangan menyebut ada bagian keluaran yang terpotong/i)

    const potong = catatanUji({ ...dasar, exitCode: 0, stdoutDipotong: true })
    assert.match(potong, /stdout/)
    assert.match(potong, /BAGIAN AWALNYA dipotong/i)
  })

  test('timeout dinyatakan belum membuktikan apa pun', () => {
    const c = catatanUji({ ...dasar, exitCode: null, timeout: true })
    assert.match(c, /belum .*membuktikan/i)
    assert.match(c, /run_background/)
  })
})

describe('pemotongan keluaran', () => {
  test('keluaran pendek tidak disentuh', () => {
    const { teks, dipotong } = potongKeluaran('halo')
    assert.equal(teks, 'halo')
    assert.equal(dipotong, false)
  })

  // Pesan error ada di AKHIR keluaran, jadi yang dipertahankan harus ekornya.
  test('keluaran panjang menyisakan bagian AKHIR', () => {
    const panjang = 'x'.repeat(20_000) + 'ERROR DI BARIS TERAKHIR'
    const { teks, dipotong } = potongKeluaran(panjang)
    assert.equal(dipotong, true)
    assert.match(teks, /ERROR DI BARIS TERAKHIR$/)
    assert.match(teks, /awal keluaran dipotong/)
  })
})

describe('kalimat permintaan kode membawa tool coding', () => {
  const groups = (text: string): Set<string> =>
    selectGroups({ text, usedTools: [], mode: 'general', izinMenu: [], superAdmin: false }) as Set<string>

  // ⚠️ Regresi yang sama bentuknya dengan item 18 Agu 2026: kalau kalimatnya
  // tidak memicu satu pun kata kunci, tool-nya tidak pernah terkirim dan model
  // menjawab dari ingatan. Akhiran -nya/-ku/-an mematikan `\b` di ujung kata,
  // dan justru itu bentuk yang dipakai orang sehari-hari.
  test('kalimat sehari-hari yang meminta perbaikan kode', () => {
    for (const t of [
      'betulkan kodingan ini',
      'ada yang salah di kodinganku',
      'tolong perbaiki scriptnya',
      'buatkan file koding untuk hitung diskon',
      'programnya error terus',
      'fungsinya kenapa hasilnya salah',
      'coba cek skripku'
    ]) {
      assert.ok(groups(t).has('dev'), `"${t}" harus membawa tool coding`)
    }
  })

  test('chat biasa TIDAK ikut membawa tool coding', () => {
    for (const t of ['siapa kamu', 'terima kasih ya', 'tolong ringkas dokumen ini']) {
      assert.equal(groups(t).has('dev'), false, `"${t}" tidak boleh membawa tool coding`)
    }
  })
})
