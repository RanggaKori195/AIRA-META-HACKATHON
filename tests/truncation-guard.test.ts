import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  adaKlaimPemotongan,
  adalahKlaimPemotongan,
  buangKlaimPemotongan,
  toolMelaporkanPemotongan
} from '../src/main/agent/truncation-guard'

// ⚠️ Lapis KETIGA untuk satu masalah yang sama, dilaporkan manajemen 21 Agu 2026.
//
// Kalimat sungguhan yang harus ditahan guard ini:
//   "bagian tengah dokumen (sekitar Bagian 4-8 — detail modul, arsitektur
//    teknis, roadmap fase) terpotong otomatis oleh sistem untuk menghemat
//    context."
// Terverifikasi TIDAK BENAR: promptTokens 6.874, 248 dari 248 baris terkirim.

const KALIMAT_ASLI =
  '⚠️ Catatan jujur: bagian tengah dokumen (sekitar Bagian 4–8 — detail modul, arsitektur teknis, ' +
  'roadmap fase) terpotong otomatis oleh sistem untuk menghemat context.'

const KALIMAT_ASLI_LAMA =
  'Catatan kecil: ada sebagian tengah dokumen (sekitar Bagian 4–8, termasuk arsitektur detail dan ' +
  'fase roadmap) yang terpotong saat dibaca.'

// ⚠️ DILAPORKAN USER 21 Agu 2026: sebuah jawaban mode Master Data kehilangan
// TABELNYA di layar. Bukan tabelnya yang dibuang guard, melainkan baris PEMISAH
// markdown (`|---|---|`) — ia tidak memuat satu pun huruf/angka sehingga jatuh
// ke pemeriksaan "tinggal tanda baca". Tanpa baris pemisah, markdown berhenti
// mengenalinya sebagai tabel dan seluruh baris data menyatu jadi satu paragraf.
//
// Pelajarannya: guard yang MEMBUANG kalimat tidak boleh menyentuh baris yang
// tidak ada urusannya dengan kalimat itu.
describe('membuang klaim tidak boleh merusak isi jawaban', () => {
  const JAWABAN_BERTABEL = [
    'Berikut item dengan kelompok harga C Coret (CC) dari master.',
    '',
    '- Bagian tengah hasil terpotong oleh sistem, sehingga tabel di bawah hanya memuat sebagian baris.',
    '',
    '| Kode | Nama | Harga B2B |',
    '|---|---|---|',
    '| JHOPKURNKUR025 | pH | Rp 80.000 |',
    '| JHOPKLLNNNN009 | EKG | Rp 150.000 |',
    '',
    'Harga di atas adalah harga daftar reguler.'
  ].join('\n')

  test('baris pemisah tabel TIDAK ikut terbuang', () => {
    const { hasil, dibuang } = buangKlaimPemotongan(JAWABAN_BERTABEL)
    assert.equal(dibuang.length, 1, 'hanya kalimat klaimnya yang dibuang')
    assert.ok(hasil.includes('|---|---|---|'), 'baris pemisah markdown harus utuh')
  })

  test('seluruh baris tabel tetap berdiri sendiri, tidak menyatu jadi satu paragraf', () => {
    const { hasil } = buangKlaimPemotongan(JAWABAN_BERTABEL)
    for (const baris of ['| Kode | Nama | Harga B2B |', '| JHOPKURNKUR025 | pH | Rp 80.000 |']) {
      assert.ok(
        hasil.split('\n').includes(baris),
        `baris tabel harus utuh pada barisnya sendiri: ${baris}`
      )
    }
  })

  test('klaimnya sendiri tetap hilang', () => {
    const { hasil } = buangKlaimPemotongan(JAWABAN_BERTABEL)
    assert.doesNotMatch(hasil, /terpotong oleh sistem/i)
    assert.match(hasil, /harga daftar reguler/i)
  })

  // Baris yang MEMANG kehilangan isinya tetap dirapikan — perilaku lama ini
  // jangan ikut hilang saat memperbaiki yang di atas.
  test('penanda yatim pada baris yang isinya terbuang tetap dibersihkan', () => {
    const { hasil } = buangKlaimPemotongan('⚠️ Sebagian isi file tidak terbaca karena dipotong sistem.')
    assert.equal(hasil, '')
  })
})

describe('mengenali klaim pemotongan', () => {
  test('kedua kalimat sungguhan dari lapangan tertangkap', () => {
    assert.ok(adalahKlaimPemotongan(KALIMAT_ASLI), 'kalimat 21 Agu (versi context)')
    assert.ok(adalahKlaimPemotongan(KALIMAT_ASLI_LAMA), 'kalimat 21 Agu (versi dibaca)')
  })

  test('ragam kalimat lain ikut tertangkap', () => {
    for (const k of [
      'Sebagian isi file tidak terbaca karena dipotong sistem.',
      'Teks dokumen ini terpangkas di bagian tengah.',
      'Isi halaman 5 belum terbaca sepenuhnya.'
    ]) {
      assert.ok(adalahKlaimPemotongan(k), k)
    }
  })

  test('kalimat tentang ISI dokumen TIDAK ikut tertangkap', () => {
    // Pembeda yang menjaga guard tidak kebablasan: dokumen boleh saja MEMBAHAS
    // pemotongan, dan kalimat itu tidak boleh hilang dari ringkasan.
    assert.equal(adalahKlaimPemotongan('Anggaran tahun ini dipotong 20% dibanding tahun lalu.'), false)
    assert.equal(adalahKlaimPemotongan('Rencana pilot dipotong menjadi 3 bulan.'), false)
    assert.equal(adalahKlaimPemotongan('Ringkasan eksekutif menyebut tiga modul utama.'), false)
  })
})

describe('membuang klaim tanpa merusak jawaban', () => {
  const jawaban = [
    'Dokumen ini berisi proposal AURA Clinical GenAI.',
    '',
    '1. Ringkasan eksekutif — platform on-premise yang sudah live.',
    '2. Tiga modul: Ambient Documentation, Genomic Report Companion, Medical Affairs Copilot.',
    '',
    KALIMAT_ASLI,
    '',
    'Mau saya dalami bagian tertentu?'
  ].join('\n')

  test('kalimat klaim hilang, isi jawaban utuh', () => {
    const { hasil, dibuang } = buangKlaimPemotongan(jawaban)
    assert.equal(dibuang.length, 1)
    assert.doesNotMatch(hasil, /terpotong/)
    assert.match(hasil, /Ringkasan eksekutif/)
    assert.match(hasil, /Genomic Report Companion/)
    assert.match(hasil, /Mau saya dalami/)
  })

  test('tidak meninggalkan penanda yatim seperti "⚠️" sendirian', () => {
    const { hasil } = buangKlaimPemotongan(jawaban)
    for (const baris of hasil.split('\n')) {
      if (baris.trim().length > 0) assert.match(baris, /[a-zA-Z0-9]/, `baris yatim: ${baris}`)
    }
  })

  test('tidak meninggalkan baris kosong bertumpuk', () => {
    assert.doesNotMatch(buangKlaimPemotongan(jawaban).hasil, /\n{3,}/)
  })

  test('jawaban tanpa klaim tidak berubah sama sekali', () => {
    const bersih = 'Dokumen berisi tiga modul dan rencana pilot 6 bulan.'
    const { hasil, dibuang } = buangKlaimPemotongan(bersih)
    assert.equal(hasil, bersih)
    assert.equal(dibuang.length, 0)
  })

  test('kalimat di TENGAH paragraf dibuang tanpa membuang tetangganya', () => {
    const teks =
      'Isi dokumen jelas. Sebagian teks dokumen terpotong saat dibaca. Kesimpulannya kuat.'
    const { hasil } = buangKlaimPemotongan(teks)
    assert.match(hasil, /Isi dokumen jelas/)
    assert.match(hasil, /Kesimpulannya kuat/)
    assert.doesNotMatch(hasil, /terpotong/)
  })
})

describe('kapan guard TIDAK boleh aktif', () => {
  test('tool yang MEMANG melaporkan sisa dikenali', () => {
    // Kalau dokumennya benar-benar panjang, kalimat model itu BENAR dan harus
    // dibiarkan — membuangnya justru menyembunyikan fakta dari user.
    assert.ok(toolMelaporkanPemotongan(['{"lanjutkanDari":251,"totalBaris":900}']))
    assert.ok(toolMelaporkanPemotongan(['{"truncated":true}']))
    assert.ok(
      toolMelaporkanPemotongan(['{"lanjutkanDari":null}', '{"truncated":true,"path":"x"}'])
    )
  })

  test('hasil tool yang lengkap tidak dianggap terpotong', () => {
    assert.equal(toolMelaporkanPemotongan(['{"lanjutkanDari":null,"totalBaris":248}']), false)
    assert.equal(toolMelaporkanPemotongan(['{"truncated":false}']), false)
    assert.equal(toolMelaporkanPemotongan([]), false)
  })

  test('deteksi di tingkat jawaban utuh', () => {
    assert.ok(adaKlaimPemotongan(`Ringkasan bagus.\n${KALIMAT_ASLI}`))
    assert.equal(adaKlaimPemotongan('Ringkasan bagus tanpa catatan apa pun.'), false)
  })
})
