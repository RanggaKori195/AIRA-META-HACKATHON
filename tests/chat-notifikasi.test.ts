import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAKS_PRATINJAU,
  POLL_NOTIF_MS,
  labelLencana,
  kunciSenyap,
  ringkasNotifikasi,
  sedangSenyap,
  type PesanMasuk
} from '../src/main/chat/rules'

// Notifikasi pesan masuk (tahap 1 "WhatsApp lite", 16 Sep 2026).
//
// Yang diuji di sini adalah bagian MURNI-nya. Yang tidak bisa diuji di sini —
// dan karena itu harus dicoba dari aplikasi — adalah: toast benar-benar tampil
// di Windows, lencana taskbar tergambar, tray menahan aplikasi tetap hidup
// sesudah jendelanya ditutup, dan autostart benar-benar terdaftar.

const pesan = (pengirim: string, isi: string, adaLampiran = false): PesanMasuk => ({
  pengirim,
  isi,
  adaLampiran
})

describe('beberapa pesan dari orang yang sama jadi SATU notifikasi', () => {
  test('lima pesan beruntun dari satu orang = satu toast', () => {
    const hasil = ringkasNotifikasi(
      [
        pesan('budi', 'halo'),
        pesan('budi', 'pak'),
        pesan('budi', 'soal laporan'),
        pesan('budi', 'yang kemarin'),
        pesan('budi', 'jadi tidak?')
      ],
      true
    )
    assert.equal(hasil.length, 1)
    assert.equal(hasil[0].judul, 'budi (5 pesan)')
    // Yang ditampilkan pesan TERAKHIR — itu yang paling relevan saat dibuka.
    assert.equal(hasil[0].isi, 'jadi tidak?')
  })

  test('pengirim berbeda tetap terpisah', () => {
    const hasil = ringkasNotifikasi([pesan('budi', 'a'), pesan('siti', 'b')], true)
    assert.equal(hasil.length, 2)
    assert.deepEqual(
      hasil.map((h) => h.pengirim).sort(),
      ['budi', 'siti']
    )
  })

  test('nama pengirim dikelompokkan tanpa peduli besar-kecil huruf', () => {
    const hasil = ringkasNotifikasi([pesan('Budi', 'a'), pesan('budi', 'b')], true)
    assert.equal(hasil.length, 1, 'Budi dan budi harus satu orang')
  })
})

describe('cuplikan isi pesan', () => {
  test('saat pratinjau dimatikan, isi pesan TIDAK ikut', () => {
    const rahasia = 'nominal penawaran 4,2 M jangan disebar dulu'
    const hasil = ringkasNotifikasi([pesan('budi', rahasia)], false)
    assert.equal(hasil.length, 1)
    assert.ok(!hasil[0].isi.includes('4,2'), 'isi pesan bocor padahal pratinjau dimatikan')
    assert.equal(hasil[0].isi, 'Pesan baru')
  })

  test('judul tetap menyebut pengirim walau pratinjau mati', () => {
    // Tanpa nama pengirim, notifikasinya tidak bisa ditindaklanjuti sama sekali.
    const hasil = ringkasNotifikasi([pesan('budi', 'rahasia')], false)
    assert.equal(hasil[0].judul, 'budi')
  })

  test('pesan panjang dipotong dan diberi tanda', () => {
    const hasil = ringkasNotifikasi([pesan('budi', 'x'.repeat(400))], true)
    assert.ok(hasil[0].isi.length <= MAKS_PRATINJAU)
    assert.ok(hasil[0].isi.endsWith('…'))
  })

  test('lampiran tanpa teks tetap berbunyi sesuatu', () => {
    // Notifikasi kosong terlihat seperti aplikasi rusak.
    const hasil = ringkasNotifikasi([pesan('budi', '', true)], true)
    assert.ok(hasil[0].isi.trim().length > 0)
    assert.match(hasil[0].isi, /lampiran/i)
  })

  test('pesan kosong tanpa lampiran pun tidak menghasilkan isi kosong', () => {
    const hasil = ringkasNotifikasi([pesan('budi', '   ')], true)
    assert.ok(hasil[0].isi.trim().length > 0)
  })
})

describe('senyap per percakapan', () => {
  test('cocok tanpa peduli besar-kecil huruf', () => {
    assert.equal(sedangSenyap(['budi'], 'Budi'), true)
    assert.equal(sedangSenyap(['Budi'], 'budi'), true)
  })

  test('daftar kosong / belum ada = tidak senyap', () => {
    assert.equal(sedangSenyap([], 'budi'), false)
    assert.equal(sedangSenyap(undefined, 'budi'), false)
  })

  test('orang lain tidak ikut terbungkam', () => {
    assert.equal(sedangSenyap(['budi'], 'siti'), false)
  })

  test('kunci senyap selalu huruf kecil — satu laptop dipakai bergantian', () => {
    // Kalau kuncinya peka huruf, "Budi" dan "budi" jadi dua daftar berbeda dan
    // senyap yang dipasang user seolah hilang sendiri setelah login ulang.
    assert.equal(kunciSenyap('Budi'), kunciSenyap('budi'))
  })
})

describe('lencana taskbar', () => {
  test('nol = tidak ada lencana', () => {
    assert.equal(labelLencana(0), null)
    assert.equal(labelLencana(-3), null)
  })

  test('1..9 ditulis apa adanya', () => {
    assert.equal(labelLencana(1), '1')
    assert.equal(labelLencana(9), '9')
  })

  test('di atas 9 jadi "9+" — dua digit tidak terbaca di 16 piksel', () => {
    assert.equal(labelLencana(10), '9+')
    assert.equal(labelLencana(238), '9+')
  })
})

describe('selang pemeriksaan tidak diperkecil tanpa sadar', () => {
  test('minimal 10 detik', () => {
    // ⚠️ Ini berjalan SELAMANYA di setiap laptop yang menyalakan AIRA, menembak
    // database produksi yang dipakai bersama aplikasi lain (`max_connections`
    // 100). Memperkecilnya adalah keputusan yang harus diukur, bukan diubah
    // karena "biar lebih responsif".
    assert.ok(POLL_NOTIF_MS >= 10_000, `POLL_NOTIF_MS terlalu kecil: ${POLL_NOTIF_MS}`)
  })
})
