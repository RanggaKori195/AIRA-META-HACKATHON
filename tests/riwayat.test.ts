import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  cuplikSekitar,
  ekspresiFts,
  kataPencarian,
  menyinggungRiwayat
} from '../src/main/riwayat/rules'

// Test regresi pencarian riwayat percakapan sendiri.

describe('ekspresi FTS5', () => {
  test('kata khas dipertahankan, kata umum dibuang', () => {
    const e = ekspresiFts('kemarin saya tanya apa soal Kariadi ya')!
    assert.match(e, /"kariadi"/)
    // Kalau kata umum ikut, hasil teratas jadi percakapan acak yang kebetulan
    // paling banyak mengulang kata sambung — bukan yang menyebut Kariadi.
    assert.doesNotMatch(e, /"saya"|"tanya"|"soal"|"kemarin"/)
  })

  test('digabung OR, bukan AND', () => {
    // AND membuat satu kata meleset saja menghasilkan nol hasil, padahal
    // pertanyaan orang jarang memakai kata yang persis sama dengan dulu.
    const e = ekspresiFts('special price Kariadi genomics')!
    assert.match(e, / OR /)
  })

  test('karakter sintaks FTS5 tidak lolos mentah', () => {
    // ⚠️ Ini yang membuat tool-nya tidak meledak: tanda kutip, tanda kurung, dan
    // tanda hubung semuanya bermakna di FTS5, dan query mentah = SQL error.
    const e = ekspresiFts('pelanggan "Pasien Pribadi" (yang berhenti) -order')!
    assert.doesNotMatch(e, /[()]/)
    // Setiap kata terbungkus kutip sebagai frasa literal.
    assert.match(e, /^"[^"]+"( OR "[^"]+")*$/)
  })

  test('tanda kutip di input tidak pernah menghasilkan frasa yang menggantung', () => {
    // Tokenizer memecah pada karakter non-huruf, jadi kutip tidak pernah ikut ke
    // dalam kata. Yang dijaga di sini bentuk akhirnya: selalu pasangan kutip
    // yang tertutup — kutip ganjil satu saja membuat FTS5 menolak seluruh query.
    const e = ekspresiFts('cari ab"cd efgh')!
    assert.equal((e.match(/"/g) ?? []).length % 2, 0)
    assert.match(e, /^"[^"]+"( OR "[^"]+")*$/)
  })

  test('angka murni dibuang, kata di sekitarnya tetap dipakai', () => {
    // "2026" ada di hampir semua percakapan penjualan dan tidak membedakan
    // apa pun.
    assert.equal(ekspresiFts('penjualan 2026 2025'), '"penjualan"')
    assert.equal(ekspresiFts('2026 2025'), null)
  })

  test('kalimat tanpa kata khas menghasilkan null, bukan MATCH kosong', () => {
    // MATCH dengan string kosong adalah error SQL; pemanggil harus menanganinya
    // sebagai "tidak bisa dicari" dan jatuh ke cadangan.
    assert.equal(ekspresiFts('apa yang saya tanya kemarin ya'), null)
    assert.equal(ekspresiFts('   '), null)
  })

  test('kataPencarian mengembalikan kata yang benar-benar dipakai', () => {
    assert.deepEqual(kataPencarian('soal Kariadi dan Genomics'), ['kariadi', 'genomics'])
  })
})

describe('cuplikan hasil', () => {
  test('teks pendek dikembalikan utuh', () => {
    assert.equal(cuplikSekitar('nett Agustus naik', ['nett']), 'nett Agustus naik')
  })

  test('potongan diambil di sekitar kata yang cocok, bukan dari awal', () => {
    const teks = `${'a'.repeat(600)} KARIADI ${'b'.repeat(600)}`
    const hasil = cuplikSekitar(teks, ['kariadi'], 200)
    assert.match(hasil, /KARIADI/)
    assert.ok(hasil.length < 260)
  })

  test('kata tidak ketemu = potong dari awal, tetap ditandai terpotong', () => {
    const hasil = cuplikSekitar('x'.repeat(500), ['zzz'], 100)
    assert.match(hasil, /…$/)
  })
})

describe('guard: pertanyaan yang menyinggung percakapan lama', () => {
  test('dikenali', () => {
    assert.ok(menyinggungRiwayat('kemarin saya tanya apa soal Kariadi?'))
    // Regresi: versi pertama `\bjawab\b` melewatkan bentuk berimbuhan —
    // "jawabANNYA" — padahal itu bentuk paling wajar dalam bahasa Indonesia.
    assert.ok(menyinggungRiwayat('waktu itu jawabannya berapa ya'))
    assert.ok(menyinggungRiwayat('kemarin kita membahas apa'))
    assert.ok(menyinggungRiwayat('minggu lalu kita bahas apa'))
  })

  test('pertanyaan DATA berperiode lampau TIDAK ikut tertangkap', () => {
    // Ini yang membuat guard-nya aman dipasang: "bulan lalu" pada pertanyaan
    // penjualan bukan rujukan ke percakapan, dan memaksanya mencari riwayat akan
    // merusak alur mode Sales.
    assert.equal(menyinggungRiwayat('berapa sales bulan lalu?'), false)
    assert.equal(menyinggungRiwayat('bandingkan dengan bulan lalu'), false)
    assert.equal(menyinggungRiwayat('pelanggan mana yang berhenti order minggu lalu'), false)
  })

  test('pertanyaan biasa tidak tertangkap', () => {
    assert.equal(menyinggungRiwayat('tolong buatkan laporan penjualan'), false)
    assert.equal(menyinggungRiwayat('siapa pelanggan terbesar'), false)
  })
})
