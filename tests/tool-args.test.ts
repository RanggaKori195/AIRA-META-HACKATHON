import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { PESAN_ARGUMEN_RUSAK, argumenSah, argumenUntukRiwayat } from '../src/main/agent/tool-args'

// ⚠️ KEJADIAN NYATA, DILAPORKAN USER 25 Agu 2026.
//
// Model kehabisan jatah token DI TENGAH menulis argumen tool. `executeToolCall`
// sudah menanganinya dengan benar — tool tidak dijalankan, model diberi pesan
// error. Yang membunuh adalah SALINANNYA DI RIWAYAT: potongan itu ikut didorong
// apa adanya, dan begitu riwayat dikirim ulang gateway menolak SELURUH
// permintaan dengan HTTP 400 "Unterminated string ... (char 80)".
//
// Akibatnya bukan satu tool gagal, melainkan seluruh jawaban mati di tengah
// sesudah sebagian teksnya sempat tampil di layar.
const ARGUMEN_ASLI =
  '{"period": "custom", "from": "2026-05-25", "to": "2026-08-24", "comparePeriod": "custom'

describe('argumen tool-call yang terpotong', () => {
  test('argumen asli dari lapangan dikenali TIDAK sah', () => {
    assert.equal(argumenSah(ARGUMEN_ASLI), false)
  })

  test('yang masuk riwayat selalu JSON sah', () => {
    const aman = argumenUntukRiwayat(ARGUMEN_ASLI)
    assert.doesNotThrow(() => JSON.parse(aman))
    assert.deepEqual(JSON.parse(aman), {})
  })

  test('argumen yang benar TIDAK diubah sedikit pun', () => {
    const utuh = '{"period":"this_month","basis":"invoice"}'
    assert.equal(argumenSah(utuh), true)
    assert.equal(argumenUntukRiwayat(utuh), utuh)
  })

  test('argumen kosong itu sah — tool tanpa parameter', () => {
    assert.equal(argumenSah(''), true)
    assert.equal(argumenUntukRiwayat(''), '{}')
    assert.equal(argumenUntukRiwayat('{}'), '{}')
  })

  // Bentuk lain yang sama-sama ditolak gateway kalau lolos ke riwayat.
  test('bentuk tidak sah lain ikut ditahan', () => {
    for (const buruk of ['[1,2,3]', 'null', '"cuma string"', '42', '{"a":', 'bukan json']) {
      assert.equal(argumenSah(buruk), false, buruk)
      assert.deepEqual(JSON.parse(argumenUntukRiwayat(buruk)), {}, buruk)
    }
  })

  // Model 27B yang cuma diberi tahu "ada error" cenderung mengulang persis
  // kesalahan yang sama, jadi pesannya harus menyebut sebab DAN langkah.
  test('pesan errornya menyebutkan sebab dan langkah berikutnya', () => {
    assert.match(PESAN_ARGUMEN_RUSAK, /terpotong/i)
    assert.match(PESAN_ARGUMEN_RUSAK, /ringkas/i)
    assert.match(PESAN_ARGUMEN_RUSAK, /jangan mengarang/i)
  })
})
