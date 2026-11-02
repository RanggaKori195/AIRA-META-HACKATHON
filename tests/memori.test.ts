import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  adalahTolakan,
  blokIdentitas,
  blokMemori,
  deteksiPermintaanIngat,
  memuatNilaiData,
  MAKS_PANJANG,
  type HasilDeteksi,
  type HasilTolak
} from '../src/main/memori/rules'
import {
  MAKS_USULAN,
  parseUsulan,
  pesanUntukEkstraksi,
  saringUsulan,
  type HasilSaring
} from '../src/main/memori/ekstrak'

// Test regresi memori AIRA. Yang dikunci di sini adalah perilaku yang kalau
// rusak GAGALNYA DIAM: angka penjualan yang diam-diam masuk memori lalu ikut ke
// setiap percakapan berikutnya, dan kalimat biasa yang tanpa sengaja tersimpan.

const isi = (h: HasilDeteksi | HasilTolak | null): string | null =>
  h && !adalahTolakan(h) ? h.isi : null

const tolakan = (h: HasilDeteksi | HasilTolak | null): HasilTolak | null =>
  h && adalahTolakan(h) ? h : null

describe('deteksi perintah mengingat', () => {
  test('bentuk yang jelas dikenali', () => {
    assert.equal(isi(deteksiPermintaanIngat('ingat saya pegang produk Genomics')), 'saya pegang produk Genomics')
    assert.equal(isi(deteksiPermintaanIngat('tolong ingat bahwa saya di divisi FA')), 'saya di divisi FA')
    assert.equal(isi(deteksiPermintaanIngat('catat ya: jawab saya selalu pakai tabel')), 'jawab saya selalu pakai tabel')
    assert.equal(
      isi(deteksiPermintaanIngat('mulai sekarang panggil saya Pak Fachrudin')),
      'panggil saya Pak Fachrudin'
    )
  })

  test('tanda baca penutup dibuang', () => {
    assert.equal(isi(deteksiPermintaanIngat('ingat, saya di divisi FA.')), 'saya di divisi FA')
  })

  test('kalimat biasa TIDAK tersimpan diam-diam', () => {
    // Ini yang paling penting dari seluruh deteksi: memori yang lahir dari
    // percakapan biasa tidak akan pernah disadari siapa pun.
    assert.equal(deteksiPermintaanIngat('berapa sales bulan ini?'), null)
    assert.equal(deteksiPermintaanIngat('saya lupa ingat-ingat lagi'), null)
    assert.equal(deteksiPermintaanIngat('apakah kamu ingat percakapan kemarin?'), null)
    assert.equal(deteksiPermintaanIngat('tolong buatkan laporan penjualan'), null)
  })

  test('pertanyaan berandai-andai tidak jadi memori sampah', () => {
    // Regresi: pola "kalau saya tanya …, …" sempat ada dan menangkap kalimat ini,
    // menyimpan "hasilnya beda?" sebagai memori yang ikut ke semua percakapan
    // berikutnya. Pola itu dibuang — kalau ragu, jangan diingat.
    assert.equal(deteksiPermintaanIngat('kalau saya tanya bulan lalu, hasilnya beda?'), null)
    assert.equal(deteksiPermintaanIngat('kalau saya tanya ERP, itu termasuk?'), null)
  })
})

describe('memori menolak NILAI DATA', () => {
  // Alasannya: angka yang diingat ikut disuntikkan ke setiap percakapan
  // berikutnya dan akan disebut ulang berbulan-bulan kemudian sebagai fakta yang
  // masih berlaku — padahal SalesRepository berubah tiap jam.
  test('angka penjualan ditolak', () => {
    const h = tolakan(deteksiPermintaanIngat('ingat nett Agustus 2026 Rp 4.110.000.000'))
    assert.equal(h?.alasan, 'data')
    assert.match(h!.pesan, /tidak mengingat ANGKA/)
  })

  test('istilah omzet & revenue ditolak walau tanpa angka', () => {
    assert.equal(tolakan(deteksiPermintaanIngat('ingat omzet cabang Jakarta naik'))?.alasan, 'data')
    assert.equal(tolakan(deteksiPermintaanIngat('catat total sales kemarin'))?.alasan, 'data')
  })

  test('data pasien ditolak', () => {
    assert.equal(tolakan(deteksiPermintaanIngat('ingat pasien Budi hasilnya positif'))?.alasan, 'data')
  })

  test('fakta tentang ORANGNYA tetap diterima', () => {
    assert.equal(
      isi(deteksiPermintaanIngat('ingat saya bertanggung jawab untuk cabang Jakarta')),
      'saya bertanggung jawab untuk cabang Jakarta'
    )
  })

  test('penolakan selalu punya alasan yang bisa dibaca user', () => {
    // Diam adalah kegagalan terburuk di sini: user mengira AIRA sudah mengingat.
    const h = tolakan(deteksiPermintaanIngat('ingat nett bulan ini Rp 123.456.789'))
    assert.ok(h!.pesan.length > 40)
  })

  test('terlalu panjang ditolak dengan batasnya disebut', () => {
    const h = tolakan(deteksiPermintaanIngat(`ingat ${'x'.repeat(MAKS_PANJANG + 5)}`))
    assert.equal(h?.alasan, 'panjang')
    assert.match(h!.pesan, new RegExp(String(MAKS_PANJANG)))
  })
})

describe('Lapis 4: ekstraksi memori otomatis', () => {
  // ⚠️ Ini SATU-SATUNYA bagian memori yang isinya diputuskan model. Semua test di
  // blok ini berangkat dari asumsi bahwa modelnya akan salah, dan yang diuji
  // adalah saringannya — bukan kepandaian modelnya.
  const saring = (usulan: string[], sudahAda: string[] = []): HasilSaring =>
    saringUsulan(usulan, sudahAda, memuatNilaiData)

  test('hanya pesan USER yang dibaca — jawaban AIRA tidak pernah', () => {
    // Di jawaban AIRA-lah nilai data berada: nett, nama pelanggan, hasil
    // pemeriksaan. Membatasi sumbernya jauh lebih kuat daripada menyaring
    // akibatnya.
    const dibaca = pesanUntukEkstraksi([
      { role: 'user', content: 'saya pegang produk Genomics' },
      { role: 'assistant', content: 'Nett Agustus Rp 4.988.000.000 dari 405 pelanggan' },
      { role: 'user', content: 'tolong pakai tabel ya' }
    ])
    assert.deepEqual(dibaca, ['saya pegang produk Genomics', 'tolong pakai tabel ya'])
  })

  test('fakta tentang orangnya diterima', () => {
    const h = saring(['bertanggung jawab atas produk Genomics', 'ingin jawaban selalu pakai tabel'])
    assert.equal(h.diterima.length, 2)
  })

  test('kalimat tentang PERCAKAPAN ditolak', () => {
    // Kesalahan paling sering model saat diminta meringkas: benar sebagai
    // ringkasan, tapi tidak ada gunanya sebagai memori — ia akan disuntikkan ke
    // setiap percakapan berikutnya sebagai kebenaran tentang orangnya.
    const h = saring([
      'user meminta laporan Word',
      'user bertanya tentang special price',
      'user menyuruh merapikan folder'
    ])
    assert.equal(h.diterima.length, 0)
    assert.ok(h.ditolak.every((d) => d.alasan.includes('percakapan')))

    // Kalimat yang kena DUA saringan sekaligus tetap ditolak — alasan mana yang
    // tercatat tidak penting, yang penting ia tidak lolos.
    assert.equal(saring(['user menanyakan data penjualan bulan ini']).diterima.length, 0)
  })

  test('nilai data ditolak — aturan yang SAMA dengan jalur "ingat …"', () => {
    const h = saring(['nett Agustus 2026 mencapai Rp 4.988.000.000', 'pasien Budi hasilnya positif'])
    assert.equal(h.diterima.length, 0)
    assert.ok(h.ditolak.every((d) => d.alasan === 'memuat nilai data'))
  })

  test('fakta SEMENTARA ditolak — memori tidak punya kedaluwarsa', () => {
    // "Sedang mengerjakan laporan Agustus" akan tetap disebut AIRA di Desember
    // sebagai keadaan yang masih berlaku.
    const h = saring(['sedang mengerjakan laporan Agustus', 'hari ini sedang rapat dengan direksi'])
    assert.equal(h.diterima.length, 0)
  })

  test('kalimat hampa ditolak', () => {
    assert.equal(saring(['user adalah pengguna aplikasi']).diterima.length, 0)
  })

  test('duplikat & yang saling memuat ditolak', () => {
    const h = saring(
      ['pegang produk Genomics', 'user pegang produk Genomics'],
      ['pegang produk Genomics']
    )
    assert.equal(h.diterima.length, 0)
    assert.ok(h.ditolak.every((d) => d.alasan === 'sudah diingat'))
  })

  test('tidak pernah menyimpan lebih dari batas sekali jalan', () => {
    const h = saring(['memegang wilayah Jawa Barat', 'memakai istilah TAT', 'menyukai ringkasan singkat', 'memimpin divisi PA IHC'])
    assert.ok(h.diterima.length <= MAKS_USULAN)
  })

  test('setiap penolakan punya alasan yang bisa dibaca di log', () => {
    // Saringan yang terlalu ketat GAGALNYA SUNYI: "kenapa AIRA tidak mengingat
    // apa-apa" hanya bisa dijawab kalau alasannya tercatat.
    const h = saring(['x', 'user menanyakan sesuatu'])
    assert.equal(h.diterima.length, 0)
    assert.ok(h.ditolak.every((d) => d.alasan.length > 0))
  })
})

describe('penguraian jawaban model saat ekstraksi', () => {
  // Model 27B kerap tidak menjawab dengan JSON bersih. Menolak semuanya berarti
  // fitur ini mati diam-diam di lapangan sementara di meja kita tampak bekerja.
  test('array JSON bersih', () => {
    assert.deepEqual(parseUsulan('["pegang Genomics", "suka tabel"]'), [
      'pegang Genomics',
      'suka tabel'
    ])
  })

  test('dibungkus pagar kode', () => {
    assert.deepEqual(parseUsulan('```json\n["pegang Genomics"]\n```'), ['pegang Genomics'])
  })

  test('ada kalimat pengantar sebelum JSON', () => {
    assert.deepEqual(parseUsulan('Berikut hasilnya:\n["pegang Genomics"]'), ['pegang Genomics'])
  })

  test('jatuh ke daftar bertanda hubung bila bukan JSON', () => {
    assert.deepEqual(parseUsulan('- pegang Genomics\n- suka tabel'), [
      'pegang Genomics',
      'suka tabel'
    ])
  })

  test('array kosong = tidak ada yang layak diingat (kasus WAJAR)', () => {
    assert.deepEqual(parseUsulan('[]'), [])
    assert.deepEqual(parseUsulan(''), [])
  })

  test('nilai non-string diabaikan, tidak melempar', () => {
    assert.deepEqual(parseUsulan('["oke", 123, null]'), ['oke'])
  })
})

describe('blok system prompt', () => {
  test('memori kosong = string kosong, bukan judul menggantung', () => {
    // Judul "Yang kamu ingat:" tanpa isi justru memberi tahu model bahwa ada
    // bagian memori yang kebetulan kosong — dan model 27B pernah mengarang
    // penjelasan untuk kekosongan semacam itu.
    assert.equal(blokMemori([]), '')
  })

  test('memori terisi menyebut larangan menganggapnya data berlaku', () => {
    const blok = blokMemori(['saya pegang produk Genomics'])
    assert.match(blok, /saya pegang produk Genomics/)
    assert.match(blok, /jangan pernah menganggapnya angka atau data yang masih berlaku/i)
  })

  test('identitas memuat nama, peran, dan divisi', () => {
    const blok = blokIdentitas({ username: 'evan', role: 'spv', divisi: ['sales', 'marketing'] })
    assert.match(blok, /evan/)
    assert.match(blok, /SPV/)
    assert.match(blok, /sales, marketing/)
  })

  test('role tanpa divisi tidak menyebut divisi kosong', () => {
    const blok = blokIdentitas({ username: 'direktur', role: 'direktur', divisi: [] })
    assert.match(blok, /Direktur/)
    assert.doesNotMatch(blok, /divisi/)
  })
})
