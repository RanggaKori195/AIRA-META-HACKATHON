import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  URL_UPDATE_BAWAAN,
  lebihBaru,
  terjemahkanGalatUpdate,
  urlUpdateSah
} from '../src/main/update/rules'

// Auto-update (17 Sep 2026). Yang dikunci: alamat server hanya HTTPS, galat
// diterjemahkan jadi kalimat yang bisa ditindaklanjuti, dan konfigurasi build
// sepakat dengan kode. Ketiganya gagal DIAM bila rusak — aplikasi tetap jalan,
// hanya tidak pernah diperbarui.

const yml = readFileSync(join(__dirname, '../electron-builder.yml'), 'utf8')

describe('alamat server update', () => {
  test('HTTPS diterima dan diberi garis miring akhir', () => {
    assert.equal(urlUpdateSah('https://updates.internal.example/update'), 'https://updates.internal.example/update/')
  })

  test('HTTP biasa DITOLAK (installer bisa ditukar di jaringan)', () => {
    assert.equal(urlUpdateSah('http://updates.internal.example/update/'), null)
  })

  test('HTTP localhost boleh — hanya untuk uji di laptop pengembang', () => {
    assert.equal(urlUpdateSah('http://127.0.0.1:8123/'), 'http://127.0.0.1:8123/')
    assert.equal(urlUpdateSah('http://localhost:8123'), 'http://localhost:8123/')
  })

  test('kosong, rusak, protokol lain, dan kredensial di URL ditolak', () => {
    for (const x of ['', '   ', null, undefined, 'bukan url', 'file:///C:/update/', 'ftp://x/', 'https://u:p@x.co.id/']) {
      assert.equal(urlUpdateSah(x), null, String(x))
    }
  })

  test('alamat bawaan sendiri sah', () => {
    assert.equal(urlUpdateSah(URL_UPDATE_BAWAAN), URL_UPDATE_BAWAAN)
  })
})

describe('konfigurasi build sepakat dengan kode', () => {
  test('publish.url di electron-builder.yml = URL_UPDATE_BAWAAN', () => {
    const m = yml.match(/provider:\s*generic\s*\n\s*url:\s*(\S+)/)
    assert.ok(m, 'publish generic tidak ditemukan di electron-builder.yml')
    assert.equal(urlUpdateSah(m![1]), URL_UPDATE_BAWAAN)
  })

  test('nama installer tanpa spasi (latest.yml menulisnya dengan tanda hubung)', () => {
    const m = yml.match(/artifactName:\s*(\S+)/)
    assert.ok(m, 'nsis.artifactName wajib dipatok')
    assert.ok(!/\s/.test(m![1]))
  })

  test('installer tetap PER-USER — syarat update tanpa hak admin', () => {
    assert.match(yml, /perMachine:\s*false/)
  })
})

describe('galat update diterjemahkan', () => {
  const kasus: Array<[unknown, RegExp]> = [
    [Object.assign(new Error('getaddrinfo ENOTFOUND updates.internal.example'), { code: 'ENOTFOUND' }), /tidak ditemukan/],
    [new Error('connect ECONNREFUSED 10.1.1.1:443'), /tidak terjangkau/],
    [new Error('net::ERR_CONNECTION_TIMED_OUT'), /tidak terjangkau/],
    [new Error('unable to verify the first certificate'), /Sertifikat/],
    [new Error('Cannot find latest.yml in the latest release artifacts (HttpError: 404)'), /Belum ada rilis/],
    [new Error('sha512 checksum mismatch, expected abc, got def'), /TIDAK dipasang/],
    [new Error("EPERM: operation not permitted, rename '...\\installer.exe'"), /antivirus/],
    [new Error('Operation did not complete successfully because the file contains a virus'), /antivirus/],
    [new Error('New version 0.2.1 is not signed by the application owner: publisherNames: the company'), /Tanda tangan/],
    [new Error('sesuatu yang aneh'), /tercatat di log/]
  ]
  for (const [err, pola] of kasus) {
    test(String((err as Error).message).slice(0, 50), () => {
      assert.match(terjemahkanGalatUpdate(err), pola)
    })
  }
})

describe('perbandingan versi', () => {
  test('lebih baru', () => {
    assert.equal(lebihBaru('0.2.1', '0.2.0'), true)
    assert.equal(lebihBaru('0.10.0', '0.9.9'), true)
    assert.equal(lebihBaru('1.0.0', '0.99.99'), true)
  })
  test('sama atau lebih lama', () => {
    assert.equal(lebihBaru('0.2.0', '0.2.0'), false)
    assert.equal(lebihBaru('0.1.9', '0.2.0'), false)
  })
})
