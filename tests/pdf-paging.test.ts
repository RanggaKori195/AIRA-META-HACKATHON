import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  catatanHasil,
  halamanNyarisKosong,
  potongHalaman,
  type HalamanPdf
} from '../src/main/tools/pdf-paging'

// Dokumen panjang dibaca BERTAHAP per halaman. Dilaporkan 19 Agu 2026: laporan
// 92 halaman dipotong di tengah kalimat pada karakter ke-100.000, model tidak
// diberi cara melanjutkan, lalu menyerah dan mengarang jumlah yang terpotong.

const buat = (n: number, panjang: number): HalamanPdf[] =>
  Array.from({ length: n }, (_, i) => ({ num: i + 1, text: 'x'.repeat(panjang) }))

describe('membaca PDF panjang bertahap', () => {
  test('dokumen kecil terbaca sekali jalan, tanpa lanjutan', () => {
    const p = potongHalaman(buat(3, 100), 1, 3, 10_000)
    assert.equal(p.dariHalaman, 1)
    assert.equal(p.sampaiHalaman, 3)
    assert.equal(p.lanjutkanDari, null)
    assert.match(catatanHasil(p, 3), /LENGKAP/)
  })

  test('berhenti di BATAS HALAMAN, bukan di tengah kalimat', () => {
    // 5 halaman × 1000 karakter, batas 2500 -> hanya 2 halaman utuh yang muat.
    const p = potongHalaman(buat(5, 1000), 1, 5, 2500)
    assert.equal(p.sampaiHalaman, 2)
    assert.equal(p.lanjutkanDari, 3)
    // Isinya tetap utuh per halaman — tidak ada halaman yang terpotong separuh.
    assert.equal(p.halamanTerpotong.length, 0)
  })

  test('melanjutkan dari halaman berikutnya sampai habis', () => {
    const halaman = buat(5, 1000)
    const a = potongHalaman(halaman, 1, 5, 2500)
    const b = potongHalaman(halaman, a.lanjutkanDari!, 5, 2500)
    const c = potongHalaman(halaman, b.lanjutkanDari!, 5, 2500)
    assert.deepEqual(
      [a.sampaiHalaman, b.sampaiHalaman, c.sampaiHalaman],
      [2, 4, 5]
    )
    assert.equal(c.lanjutkanDari, null)
    // Tidak ada halaman yang terlewat maupun terbaca dua kali.
    assert.equal(b.dariHalaman, 3)
    assert.equal(c.dariHalaman, 5)
  })

  test('SATU halaman yang sendirian melebihi batas tetap ikut, dan tetap maju', () => {
    // Kalau halaman raksasa dilewati begitu saja, `lanjutkanDari` tidak pernah
    // bertambah dan model memanggil tool yang sama berulang pada halaman itu juga.
    const p = potongHalaman(buat(3, 50_000), 1, 3, 10_000)
    assert.equal(p.sampaiHalaman, 1)
    assert.equal(p.lanjutkanDari, 2, 'harus maju walau halamannya tidak muat')
    assert.deepEqual(p.halamanTerpotong, [1])
    assert.ok(p.teks.length <= 10_000)
  })

  test('rentang halaman yang diminta dihormati', () => {
    const p = potongHalaman(buat(20, 100), 5, 8, 10_000)
    assert.equal(p.dariHalaman, 5)
    assert.equal(p.sampaiHalaman, 8)
    // Masih ada halaman 9-20 di dokumen, jadi lanjutannya tetap ditawarkan.
    assert.equal(p.lanjutkanDari, 9)
    assert.match(p.teks, /Halaman 5/)
    assert.doesNotMatch(p.teks, /Halaman 4/)
    assert.doesNotMatch(p.teks, /Halaman 9/)
  })

  test('nilai di luar batas dijinakkan, bukan menghasilkan rentang kosong', () => {
    const halaman = buat(4, 100)
    assert.equal(potongHalaman(halaman, 0, 99, 10_000).dariHalaman, 1)
    assert.equal(potongHalaman(halaman, 99, 99, 10_000).dariHalaman, 4)
    assert.equal(potongHalaman(halaman, 3, 1, 10_000).sampaiHalaman, 3)
  })

  test('nomor halaman asli dari PDF dipakai, bukan urutan array', () => {
    // Sebagian PDF menomori halaman tidak dari 1; yang ditampilkan harus nomor
    // aslinya supaya user bisa mencocokkan dengan dokumen di tangannya.
    const halaman: HalamanPdf[] = [
      { num: 11, text: 'a' },
      { num: 12, text: 'b' }
    ]
    assert.match(potongHalaman(halaman, 1, 2, 10_000).teks, /Halaman 11/)
  })

  test('catatan menyebut nama parameter dan nilainya secara harfiah', () => {
    // Model 27B di project ini terbukti tidak menyimpulkan langkah berikutnya
    // sendiri — kalau tidak diberi tahu persis, ia berhenti dan bertanya ke user.
    const p = potongHalaman(buat(92, 1400), 1, 92, 100_000)
    const catatan = catatanHasil(p, 92)
    assert.match(catatan, /fromPage: \d+/)
    assert.match(catatan, /92/)
  })

  test('laporan 92 halaman terbaca HABIS dalam beberapa panggilan', () => {
    // Kasus nyata yang dilaporkan: 92 halaman, ~131 ribu karakter.
    const halaman = buat(92, 1424)
    const terbaca = new Set<number>()
    let mulai = 1
    let panggilan = 0
    while (panggilan < 20) {
      const p = potongHalaman(halaman, mulai, 92, 100_000)
      for (let n = p.dariHalaman; n <= p.sampaiHalaman; n++) terbaca.add(n)
      panggilan++
      if (p.lanjutkanDari === null) break
      mulai = p.lanjutkanDari
    }
    assert.equal(terbaca.size, 92, 'semua halaman harus terbaca')
    assert.ok(panggilan <= 3, `cukup sedikit panggilan, dapat ${panggilan}`)
  })
})

describe('catatan hasil: guard anti-karangan', () => {
  // Dilaporkan DUA KALI 19 Agu 2026: saat hasil tool tidak menyatakan apa pun
  // tentang kelengkapan, model mengarang bahwa ada yang terpotong — sekali
  // "~95 ribu karakter" (benarnya 31 ribu), sekali "halaman 14-27 terpotong"
  // (halaman itu justru penuh). Diam membuat model mengisi sendiri.
  const halaman = (n: number): HalamanPdf[] =>
    Array.from({ length: n }, (_, i) => ({ num: i + 1, text: 'x'.repeat(1000) }))

  test('catatan TIDAK PERNAH kosong, bahkan saat semuanya lengkap', () => {
    const p = potongHalaman(halaman(3), 1, 3, 100_000)
    const c = catatanHasil(p, 3)
    assert.ok(c.length > 0)
    assert.match(c, /LENGKAP/)
    assert.match(c, /JANGAN menyatakan ada teks yang terpotong/)
  })

  test('menyebut dengan tegas halaman mana yang BELUM terbaca', () => {
    const p = potongHalaman(halaman(92), 1, 92, 10_000)
    const c = catatanHasil(p, 92)
    assert.match(c, /belum terbaca/i)
    assert.match(c, /fromPage:/)
  })

  test('halaman nyaris kosong dinyatakan sebagai isi aslinya, bukan pemotongan', () => {
    // Kalau tidak dinyatakan, halaman gambar/sampul terbaca model sebagai
    // "ada yang hilang" dan ia melaporkannya sebagai teks yang terpotong.
    const h: HalamanPdf[] = [
      { num: 1, text: 'a'.repeat(1000) },
      { num: 2, text: '' },
      { num: 3, text: 'b'.repeat(1000) }
    ]
    const kosong = halamanNyarisKosong(h, 1, 3)
    assert.deepEqual(kosong, [2])
    const c = catatanHasil(potongHalaman(h, 1, 3, 100_000), 3, kosong)
    assert.match(c, /bukan akibat pemotongan/)
  })

  test('halaman kosong hanya dihitung di rentang yang dibaca', () => {
    const h: HalamanPdf[] = [
      { num: 1, text: '' },
      { num: 2, text: 'a'.repeat(1000) },
      { num: 3, text: '' }
    ]
    assert.deepEqual(halamanNyarisKosong(h, 2, 3), [3])
  })

  test('halaman yang dipotong karena kepanjangan disebutkan terpisah', () => {
    const p = potongHalaman([{ num: 1, text: 'x'.repeat(50_000) }], 1, 1, 10_000)
    assert.match(catatanHasil(p, 1), /sangat panjang/)
  })
})
