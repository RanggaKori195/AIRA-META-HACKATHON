import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { hanyaBasaBasi } from '../src/main/agent/sales-guard'

// ⚠️ KEJADIAN NYATA, DILAPORKAN USER 25 Agu 2026.
//
// Di mode data, jawaban tanpa tool dibuang dan model dipaksa memanggil tool
// (guard anti-halu, 18 Agu). Untuk "halo siapa kamu" itu berarti: model
// menjawab BENAR tanpa tool, jawabannya dibuang, lalu ia dipaksa memanggil tool
// apa pun — dan yang dipilih tool analisa termahal dengan item "EKG" (contoh
// yang kebetulan tertulis di deskripsi tool). Hasilnya 18 detik, dua panggilan
// model, dan tujuh query database untuk sebuah sapaan.
//
// Guard anti-halunya sendiri BENAR dan tidak boleh dilonggarkan secara umum.
// Yang salah adalah menerapkannya pada kalimat yang tidak meminta angka apa pun.

describe('sapaan & basa-basi dikenali', () => {
  test('kalimat asli dari lapangan', () => {
    assert.equal(hanyaBasaBasi('halo siapa kamu'), true)
  })

  test('ragam sapaan lain', () => {
    for (const t of [
      'halo',
      'Hai',
      'selamat pagi',
      'pagi',
      'siapa kamu?',
      'kamu siapa',
      'kamu bisa apa',
      'apa saja yang bisa kamu lakukan',
      'bisa bantu apa',
      'terima kasih',
      'makasih ya',
      'oke',
      'sip',
      'tes'
    ]) {
      assert.equal(hanyaBasaBasi(t), true, t)
    }
  })
})

describe('yang TIDAK boleh dianggap basa-basi', () => {
  // Inti keamanannya: begitu ada kosakata data, guard anti-halu WAJIB tetap
  // menyala. Angka dari ingatan model di depan manajemen lebih berbahaya
  // daripada tidak menjawab.
  test('sapaan yang disusul pertanyaan data tetap kena guard', () => {
    for (const t of [
      'halo, berapa sales bulan ini',
      'pagi pak, tolong cek penjualan EKG',
      'hai, item apa yang paling laris',
      'oke sekarang analisa MCU',
      'makasih, sekalian proyeksi tutup bulan dong'
    ]) {
      assert.equal(hanyaBasaBasi(t), false, t)
    }
  })

  test('pertanyaan data polos jelas bukan basa-basi', () => {
    for (const t of [
      'berapa sales bulan ini',
      'item apa yang trennya menurun',
      'pelanggan mana yang berhenti order',
      'analisa lintas perspektif untuk MCU (STD+EKG)'
    ]) {
      assert.equal(hanyaBasaBasi(t), false, t)
    }
  })

  // Kalimat panjang yang kebetulan diawali sapaan hampir selalu tetap berisi
  // permintaan — jangan dibebaskan hanya karena kata pertamanya "halo".
  test('kalimat panjang tidak dibebaskan walau diawali sapaan', () => {
    const panjang =
      'halo, saya mau minta tolong dibuatkan rekap lengkap untuk seluruh cabang beserta ' +
      'rinciannya per wilayah dan per kategori supaya bisa saya bawa ke rapat besok pagi'
    assert.equal(hanyaBasaBasi(panjang), false)
  })

  test('teks kosong bukan basa-basi', () => {
    assert.equal(hanyaBasaBasi(''), false)
    assert.equal(hanyaBasaBasi('   '), false)
  })

  test('kata sapaan di TENGAH kalimat tidak membebaskan', () => {
    assert.equal(hanyaBasaBasi('tolong cek dulu ya, oke'), false)
  })
})
