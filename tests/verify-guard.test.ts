import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  CATATAN_BELUM_DIUJI,
  adaKlaimUji,
  adalahKlaimUji,
  buangKlaimUji,
  guardUjiBerlakuDiMode,
  toolMelaporkanUjiSukses
} from '../src/main/agent/verify-guard'

// Guard "sudah saya uji" — permintaan manajemen 21 Agu 2026.
//
// Keluhannya persis pola yang sudah dikenal:
//   user -> "betulkan kodingan ini: xxx"
//   LLM  -> menyerahkan berkas TANPA menjalankannya, terdengar yakin
//   user -> dicoba, error lagi
//
// ⚠️ Guard ini punya DUA cara gagal, dan yang kedua lebih berbahaya:
//   (a) membiarkan klaim palsu lolos — user tertipu sekali;
//   (b) MEMBUANG kalimat yang BENAR — jawaban jujur jadi rusak, dan tidak ada
//       yang bisa melihat sebabnya. Karena itu separuh test di bawah menguji
//       kalimat yang HARUS DIPERTAHANKAN.

const KLAIM_PALSU = 'Kode di atas sudah saya jalankan dan berjalan tanpa error.'

describe('mengenali klaim sudah diuji', () => {
  test('kalimat khas yang dikeluhkan manajemen tertangkap', () => {
    for (const k of [
      KLAIM_PALSU,
      'Sudah saya tes, hasilnya sesuai.',
      'Script-nya sudah saya jalankan dan outputnya benar.',
      'Saya sudah memverifikasi fungsinya berjalan normal.',
      'Sudah dicoba dan tidak ada error.',
      'Berhasil dikompilasi tanpa error.',
      'Kodenya sudah diuji dan lolos.'
    ]) {
      assert.ok(adalahKlaimUji(k), k)
    }
  })

  // ⚠️ Versi pertama guard ini memakai `\b` di kedua ujung kata dan akibatnya
  // DIAM pada bentuk yang paling sering dipakai orang. Guard yang terpasang
  // tapi tidak pernah menyala lebih buruk daripada tidak ada: ia memberi rasa
  // aman tanpa menahan apa pun.
  test('bentuk berimbuhan (-nya, me-, di-) tetap tertangkap', () => {
    for (const k of [
      'Kodenya sudah saya jalankan.',
      'Scriptnya sudah saya tes dan lolos.',
      'Fungsinya sudah saya verifikasi.',
      'Saya sudah memverifikasi fungsinya berjalan normal.',
      'Programnya sudah dikompilasi tanpa masalah.'
    ]) {
      assert.ok(adalahKlaimUji(k), k)
    }
  })

  test('terdeteksi di mana pun dalam jawaban', () => {
    const jawaban = `Berikut perbaikannya:\n\n\`\`\`js\nconst a = 1\n\`\`\`\n\n${KLAIM_PALSU}`
    assert.equal(adaKlaimUji(jawaban), true)
  })
})

describe('kalimat yang HARUS dipertahankan', () => {
  // Kejujuran adalah hasil yang diinginkan. Guard yang menghapus pengakuan
  // "belum saya uji" justru membalik tujuannya sendiri.
  test('pengakuan belum diuji tidak dianggap klaim', () => {
    for (const k of [
      'Kode ini belum saya uji, jadi tolong dicek dulu.',
      'Saya tidak menjalankan kodenya karena butuh database.',
      'Belum dites di ruang uji.',
      'Fungsinya belum saya coba dengan data sungguhan.'
    ]) {
      assert.equal(adalahKlaimUji(k), false, k)
    }
  })

  test('arahan agar USER yang menguji tidak dianggap klaim', () => {
    for (const k of [
      'Silakan jalankan node tes.js untuk memastikan.',
      'Kamu bisa mengetesnya dengan npm test.',
      'Untuk menguji fungsinya, jalankan perintah berikut.',
      'Sebaiknya kode ini dites dulu sebelum dipakai.'
    ]) {
      assert.equal(adalahKlaimUji(k), false, k)
    }
  })

  // Pembeda yang sama dengan KONTEKS_BACA pada guard pemotongan: tanpa syarat
  // konteks kode, guard ini akan menjaring jawaban di mode data.
  test('kalimat di luar konteks kode tidak dianggap klaim', () => {
    for (const k of [
      'Angkanya sudah saya cek ke database dan cocok.',
      'Sudah saya jalankan laporan bulanannya lewat menu Sales.',
      'Dokumen itu sudah saya baca sampai halaman terakhir.'
    ]) {
      assert.equal(adalahKlaimUji(k), false, k)
    }
  })

  // ⚠️ KALIMAT SUNGGUHAN DARI LAPANGAN, 21 Agu 2026 — beberapa menit setelah
  // guard ini dipasang, ia MEMBUANG keempat kalimat di bawah. Tak satu pun
  // mengaku sudah menguji: semuanya narasi jujur AIRA tentang dirinya sedang
  // kesulitan. Penyebabnya `KLAIM_SELESAI` versi pertama yang cukup dengan kata
  // "saya"/"sudah" DI MANA PUN dalam kalimat, sehingga kalimat orang-pertama apa
  // pun yang menyebut "test"/"file" ikut terjaring.
  //
  // Ini failure mode yang ditulis di kepala berkas guard-nya sendiri: menghapus
  // KEBENARAN lebih buruk daripada tidak ada guard, karena kerusakannya tidak
  // terlihat siapa pun — user hanya melihat jawaban yang bolong.
  test('narasi jujur AIRA saat kesulitan TIDAK boleh dibuang (kejadian nyata 21 Agu 2026)', () => {
    for (const k of [
      'Test file-nya ada sintaks yang salah ketik, saya rapikan dulu:',
      'Saya terjebak loop menulis ulang file test yang isinya sama.',
      'Berhenti dan saya bersihkan dengan pendekatan berbeda — tulis ulang file test secara benar (tanpa operator `:=` yang tidak valid di JavaScript):',
      '- ✅ `totalPenjualan.js` (fungsi utamanya) sudah tertulis dengan benar di ruang uji.'
    ]) {
      assert.equal(adalahKlaimUji(k), false, k)
    }
  })

  test('menyebut rencana/proses menguji bukan klaim sudah menguji', () => {
    for (const k of [
      'Saya buat dulu file test-nya, lalu jalankan.',
      'File test sudah saya tulis di ruang uji.',
      'Saya sedang menjalankan uji untuk fungsi ini.',
      'Ada error di file test, saya perbaiki dulu.'
    ]) {
      assert.equal(adalahKlaimUji(k), false, k)
    }
  })

  // Harga melonggarkan `\b` menjadi `\w*`: kata pendek jadi bisa menjaring kata
  // lain. Yang berbahaya sudah dipertahankan ketat — ini menguncinya.
  test('kata yang kebetulan berawalan sama tidak menjaring', () => {
    for (const k of [
      'Sudah saya kumpulkan testimoni pelanggannya.',
      'Badannya sudah lebih bugar setelah cuti.',
      'Sudah saya cek, semua sudah beres.'
    ]) {
      assert.equal(adalahKlaimUji(k), false, k)
    }
  })
})

describe('bukti eksekusi dari hasil tool', () => {
  test('uji_jalankan yang lolos dihitung sebagai bukti', () => {
    assert.equal(toolMelaporkanUjiSukses(['{"perintah":"node tes.js","ujiSukses":true}']), true)
  })

  test('uji_jalankan yang GAGAL bukan bukti', () => {
    assert.equal(
      toolMelaporkanUjiSukses(['{"perintah":"node tes.js","exitCode":1,"ujiSukses":false}']),
      false
    )
  })

  // ⚠️ Tanpa ini guard membuang kalimat yang BENAR: user menyetujui sebuah
  // perintah lewat run_command, perintahnya jalan, dan AIRA melaporkannya jujur.
  test('run_command yang sukses juga dihitung sebagai bukti', () => {
    assert.equal(toolMelaporkanUjiSukses(['{"exitCode":0,"stdout":"ok","stderr":""}']), true)
  })

  test('run_command yang gagal bukan bukti', () => {
    assert.equal(toolMelaporkanUjiSukses(['{"exitCode":2,"stdout":"","stderr":"boom"}']), false)
  })

  test('hasil tool lain (baca file) bukan bukti', () => {
    assert.equal(
      toolMelaporkanUjiSukses(['{"path":"a.md","truncated":false,"catatanHasil":"lengkap"}']),
      false
    )
  })

  test('tanpa tool sama sekali, tidak ada bukti', () => {
    assert.equal(toolMelaporkanUjiSukses([]), false)
  })
})

describe('membuang klaim dan menggantinya dengan yang jujur', () => {
  test('klaim dibuang, isi jawaban lain utuh', () => {
    const jawaban = [
      'Masalahnya ada di pembagian dengan nol.',
      'Berikut perbaikannya:',
      '',
      '```js',
      'const bagi = (a, b) => (b === 0 ? null : a / b)',
      '```',
      '',
      KLAIM_PALSU
    ].join('\n')

    const { hasil, dibuang } = buangKlaimUji(jawaban)
    assert.equal(dibuang.length, 1)
    assert.match(hasil, /pembagian dengan nol/)
    assert.match(hasil, /const bagi/)
    assert.doesNotMatch(hasil, /sudah saya jalankan/i)
  })

  test('butir daftar yang seluruhnya klaim dibuang utuh, tanpa menyisakan penanda', () => {
    const jawaban = ['- Menambahkan penjagaan nol', '- Sudah saya tes dan hasilnya benar'].join('\n')
    const { hasil } = buangKlaimUji(jawaban)
    assert.match(hasil, /penjagaan nol/)
    assert.doesNotMatch(hasil, /sudah saya tes/i)
    // Tidak boleh menyisakan baris "-" yatim.
    assert.doesNotMatch(hasil, /^-\s*$/m)
  })

  test('jawaban yang jujur tidak berubah sama sekali', () => {
    const jujur =
      'Berikut perbaikannya. Kode ini belum saya uji karena butuh koneksi database. ' +
      'Silakan jalankan npm test untuk memastikan.'
    const { hasil, dibuang } = buangKlaimUji(jujur)
    assert.equal(dibuang.length, 0)
    assert.equal(hasil, jujur)
  })

  // Menghapus kalimat tanpa menggantinya membuat jawaban terasa netral, padahal
  // keadaannya tidak netral: kodenya memang belum terbukti jalan.
  test('catatan pengganti menyebut keadaannya dan langkah berikutnya', () => {
    assert.match(CATATAN_BELUM_DIUJI, /belum dijalankan di ruang uji/i)
    assert.match(CATATAN_BELUM_DIUJI, /uji dulu/i)
  })
})

describe('kalimat yang MELAPORKAN KEGAGALAN tidak boleh dibuang (lapangan 27 Agu 2026)', () => {
  // Kalimat ini benar-benar dibuang di depan user saat menguji perbaikan
  // browser. Terekam di aira.log: msg="klaim \"sudah diuji\" dibuang".
  //
  // Lolos semua syarat karena alasan yang keliru: KONTEKS_KODE cocok pada
  // "error" (padahal error KONEKSI), KLAIM_SELESAI cocok pada "sudah mencoba"
  // (padahal "coba" di situ berarti "berusaha", bukan "menguji"). Yang hilang
  // justru kalimat paling informatif di seluruh jawaban, dan penggantinya
  // menyuruh user "minta AIRA menguji dulu" untuk kode yang tidak ada.
  const ASLI =
    'Maaf, saya sudah mencoba dua kali (dengan dan tanpa `www`) dan keduanya gagal dengan error koneksi (`ERR_FAILED`).'

  test('kalimat asli dari lapangan TIDAK dianggap klaim uji', () => {
    assert.equal(adalahKlaimUji(ASLI), false)
  })

  test('kalimat asli lolos utuh dari buangKlaimUji', () => {
    const { hasil, dibuang } = buangKlaimUji(ASLI)
    assert.equal(dibuang.length, 0)
    assert.equal(hasil, ASLI)
  })

  test('jawaban browser yang gagal tidak memicu catatan "belum diuji"', () => {
    const jawaban =
      'Baik, saya buka detik.com di browser AIRA sekarang.\n' +
      ASLI +
      '\nIni bukan masalah di sisi URL — tampaknya koneksi jaringan bermasalah.'
    assert.equal(adaKlaimUji(jawaban), false)
  })

  test('bentuk kegagalan lain juga aman', () => {
    assert.equal(adalahKlaimUji('Sudah saya jalankan tapi masih error di baris 12.'), false)
    assert.equal(adalahKlaimUji('Saya sudah coba build-nya, tidak berhasil.'), false)
    assert.equal(adalahKlaimUji('Sudah saya tes dan scriptnya gagal jalan.'), false)
  })

  // ⚠️ Batas perbaikannya: klaim KEBERHASILAN yang menyebut "error" dalam
  // bentuk yang dinegasikan HARUS tetap terjaring. Tanpa test ini, memperlebar
  // KABAR_GAGAL akan mematikan guard-nya diam-diam.
  test('klaim sukses yang menyebut "tidak ada error" TETAP terjaring', () => {
    assert.equal(adalahKlaimUji('Sudah saya jalankan, tidak ada error sama sekali.'), true)
    assert.equal(adalahKlaimUji('Saya sudah menguji kodenya dan semua test lolos.'), true)
  })
})

describe('mode data dikecualikan (lapangan 29–30 Sep 2026)', () => {
  // Dua kalimat ASLI yang dibuang guard di mode data — keduanya kalimat terpenting jawabannya.
  const TAT =
    '**Yang menarik justru kecil tapi kronis:** 41 baris berstatus *Result Validated by Lab* — hasilnya sudah ' +
    'tervalidasi tapi belum dikirim keluar, dengan umur median 406 hari dan yang tertua hampir 785 hari ' +
    '(sebagian besar KALCT Histologi).'
  const INNO =
    '**Namun, isinya belum bisa saya pastikan.** Saya sudah mencoba membuka isi paketnya berkali-kali ' +
    '(dengan kode, nama lengkap, dan fragmen nama), dan sistem melaporkan bahwa **tidak ada isi paket yang ' +
    'terdaftar untuk item ini** — padahal itemnya sendiri tercatat berjenis Paket.'

  test('kedua kalimat itu memang tertangkap pola kosakata — karena itu pengecualiannya di MODE', () => {
    assert.equal(adaKlaimUji(TAT), true)
    assert.equal(adaKlaimUji(INNO), true)
  })

  test('guard TIDAK berjalan di Sales, Master Data, dan TAT Sample', () => {
    for (const m of ['sales', 'masterdata', 'lab']) assert.equal(guardUjiBerlakuDiMode(m), false, m)
  })

  test('guard TETAP berjalan di Task Baru & Microsoft 365 — klaim palsu di sana tetap dibuang', () => {
    for (const m of ['general', 'onedrive']) assert.equal(guardUjiBerlakuDiMode(m), true, m)
    assert.equal(adaKlaimUji(KLAIM_PALSU), true)
  })
})
