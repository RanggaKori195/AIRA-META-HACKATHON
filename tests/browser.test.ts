import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { ToolError } from '../src/main/tools/types'
import {
  BrowserRefusal,
  galatBelumDibuka,
  galatDitutup,
  galatDitutupSaatMemuat,
  galatNavigasiGagal,
  galatJanganBukaUlang,
  galatNavigasiTimeout,
  galatUrlTidakSah,
  kunciSitus
} from '../src/main/browser/rules'

const SEMUA = [
  galatBelumDibuka(),
  galatDitutup('https://www.detik.com'),
  galatDitutupSaatMemuat('https://www.detik.com'),
  galatNavigasiTimeout('https://www.detik.com', 45),
  galatUrlTidakSah('detik.com')
]

describe('galat browser sampai ke model, bukan ditelan jadi "tool gagal dijalankan"', () => {
  // Ini inti regresinya. `executeToolCall` hanya meneruskan pesan dari
  // ToolError/BoundaryError; Error biasa diganti jadi "tool gagal dijalankan"
  // dan dicatat "tool crashed" — persis yang terekam di aira.log 16 Agu 2026
  // untuk browser_click & browser_read, dan yang terlihat lagi saat demo 26 Agu.
  test('SEMUA galat browser berjenis ToolError', () => {
    for (const galat of SEMUA) {
      assert.ok(galat instanceof ToolError, `bukan ToolError: ${galat.message}`)
    }
  })

  test('tidak ada pesan yang kosong atau sekadar satu kata', () => {
    for (const galat of SEMUA) {
      assert.ok(galat.message.trim().length > 40, `pesan terlalu pendek: ${galat.message}`)
    }
  })
})

describe('pesan menyebut langkah pemulihan beserta nama toolnya', () => {
  // Pelajaran yang sama dengan catatanHasil di pdf-paging.ts: model 27B tidak
  // menyimpulkan langkah berikutnya sendiri. Kalau nama toolnya tidak disebut
  // harfiah, ia menebak atau menyerah.
  const wajibMenyebutTool = [galatBelumDibuka(), galatDitutupSaatMemuat('https://www.detik.com')]

  test('menyebut browser_open secara harfiah', () => {
    for (const galat of wajibMenyebutTool) {
      assert.match(galat.message, /browser_open/)
    }
  })

  // ⚠️ SATU pengecualian, dan ini disengaja — dulu justru sebaliknya.
  //
  // Versi 26 Agu pesan ini ikut menyebut "panggil browser_open dengan URL-nya
  // lagi", dan akibatnya terlihat langsung di lapangan 27 Agu: user menutup
  // jendela, model membukanya lagi, user menutup lagi, model minta izin untuk
  // ketiga kalinya. Menutup jendela adalah tindakan SENGAJA; menyebut nama
  // toolnya di sini sama saja menyuruh model melawan keputusan user.
  test('KECUALI "ditutup user" — di situ nama toolnya sengaja TIDAK disebut', () => {
    assert.doesNotMatch(galatDitutup('https://www.detik.com').message, /panggil browser_open/i)
  })
})

describe('"belum pernah dibuka" dibedakan dari "sudah ditutup"', () => {
  // Dua keadaan ini menuntut langkah berbeda. Menyamakannya membuat model
  // menebak — dan tebakan yang sering muncul adalah menjawab seolah halamannya
  // masih terbaca.
  test('pesannya tidak sama', () => {
    assert.notEqual(galatBelumDibuka().message, galatDitutup('https://www.detik.com').message)
  })

  test('hanya yang sudah ditutup yang menyebut penutupan', () => {
    assert.match(galatDitutup().message, /DITUTUP/)
    assert.doesNotMatch(galatBelumDibuka().message, /DITUTUP/)
  })

  test('yang sudah ditutup menyatakan isi halaman TIDAK tersimpan', () => {
    assert.match(galatDitutup('https://www.detik.com').message, /TIDAK tersimpan/)
  })

  test('URL terakhir ikut disebut bila diketahui, dan tidak memaksa bila tidak', () => {
    assert.match(galatDitutup('https://www.detik.com').message, /https:\/\/www\.detik\.com/)
    // Tanpa URL, kalimatnya harus tetap utuh — bukan "Halaman terakhir: ."
    assert.doesNotMatch(galatDitutup().message, /Halaman terakhir/)
  })
})

describe('pesan melarang menjawab seolah halamannya masih terbaca', () => {
  // Guard anti-karangan. Browser yang tertutup adalah kekosongan informasi,
  // dan kekosongan informasi selama ini selalu diisi model dengan karangan
  // (HANDOFF §7, terjadi berulang di read_pdf dan inno_item_search).
  test('galat ditutup melarang menjawab dari halaman yang sudah hilang', () => {
    assert.match(galatDitutup().message, /jangan menjawab seolah/i)
  })

  test('galat timeout melarang mengarang isi halaman', () => {
    assert.match(galatNavigasiTimeout('https://www.detik.com', 45).message, /jangan mengarang/i)
  })

  test('galat timeout menyebut angka detiknya, bukan "beberapa saat"', () => {
    assert.match(galatNavigasiTimeout('https://www.detik.com', 45).message, /45 detik/)
  })
})

describe('galat URL tidak sah menyebut URL yang ditolak', () => {
  test('URL-nya dikutip supaya model tahu mana yang salah', () => {
    assert.match(galatUrlTidakSah('detik.com').message, /detik\.com/)
    assert.match(galatUrlTidakSah('detik.com').message, /https:\/\//)
  })
})

describe('navigasi yang benar-benar gagal (lapangan 27 Agu 2026)', () => {
  // ⚠️ Konteksnya: `loadURL()` JUGA menolak untuk halaman yang sebenarnya
  // terbuka dengan baik, begitu ada navigasi susulan (iklan) membatalkan yang
  // pertama. Terjadi nyata pada detik.com — situsnya terpampang di layar,
  // `loadURL()` menolak ERR_FAILED, dan AIRA melaporkan "koneksi bermasalah"
  // dua kali dengan yakin. Karena itu `navigate()` mempercayai `did-navigate`,
  // bukan `loadURL()`, dan galat di bawah ini hanya dipakai bila TIDAK ada
  // navigasi yang ter-commit sama sekali.
  test('menyebut URL dan sebab aslinya', () => {
    const galat = galatNavigasiGagal('https://www.detik.com', 'ERR_NAME_NOT_RESOLVED (-105)')
    assert.match(galat.message, /https:\/\/www\.detik\.com/)
    assert.match(galat.message, /ERR_NAME_NOT_RESOLVED/)
  })

  test('berjenis ToolError supaya sebabnya sampai ke model', () => {
    assert.ok(galatNavigasiGagal('https://x.test', 'ERR_FAILED') instanceof ToolError)
  })

  test('melarang mengarang isi halaman yang tidak pernah termuat', () => {
    assert.match(galatNavigasiGagal('https://x.test', 'ERR_FAILED').message, /jangan mengarang/i)
  })
})

describe('jangan buka ulang jendela yang baru ditutup user (lapangan 27 Agu 2026)', () => {
  // Terekam di log: user menutup jendela detik.com, model membukanya lagi,
  // user menutup lagi, model minta izin membuka untuk KETIGA kalinya. Tiga
  // popup izin untuk satu kalimat "buka detik.com". Penyebabnya pesan galat
  // versi pertama yang berbunyi "panggil browser_open dengan URL-nya lagi".
  test('varian www dan telanjang dianggap situs yang SAMA', () => {
    // Kalau tidak, penolakannya bisa dilangkahi hanya dengan membuang "www" —
    // dan itu persis yang dilakukan model di lapangan.
    assert.equal(kunciSitus('https://www.detik.com/'), 'detik.com')
    assert.equal(kunciSitus('https://detik.com'), 'detik.com')
    assert.equal(kunciSitus('detik.com'), 'detik.com')
    assert.equal(kunciSitus('https://www.detik.com/#google_vignette'), 'detik.com')
  })

  test('situs yang benar-benar berbeda tidak ikut terblokir', () => {
    assert.notEqual(kunciSitus('https://www.detik.com'), kunciSitus('https://kompas.com'))
  })

  test('URL rusak tidak melempar, cukup jadi kunci apa adanya', () => {
    assert.equal(typeof kunciSitus('bukan url sama sekali'), 'string')
  })

  test('penolakan berjenis BrowserRefusal supaya tidak ditelan browser_open', () => {
    const galat = galatJanganBukaUlang('https://www.detik.com')
    assert.ok(galat instanceof BrowserRefusal)
    assert.ok(galat instanceof ToolError)
  })

  test('pesannya menyuruh BERHENTI dan BERTANYA, bukan mencoba lagi', () => {
    const pesan = galatJanganBukaUlang('https://www.detik.com').message
    assert.match(pesan, /DITOLAK dengan sengaja/)
    assert.match(pesan, /tanyakan/i)
    assert.doesNotMatch(pesan, /panggil browser_open/i)
  })

  // ⚠️ Ini yang membuat bug-nya lahir: pesan "sudah ditutup" versi pertama
  // menyuruh model memanggil browser_open lagi. Imbauan sopan yang justru
  // menyuruh mengulang.
  test('pesan "sudah ditutup" tidak lagi menyuruh membuka ulang', () => {
    const pesan = galatDitutup('https://www.detik.com').message
    assert.match(pesan, /JANGAN membukanya ulang/)
    assert.match(pesan, /DITUTUP OLEH USER/)
  })

  test('pesan "sudah ditutup" melarang menyalahkan jaringan atau user', () => {
    // Jawaban nyata 27 Agu: "koneksi jaringan bermasalah" lalu "mungkin Anda
    // sengaja menolak" — dua tuduhan untuk satu tindakan user yang wajar.
    assert.match(galatDitutup().message, /jangan menyalahkan jaringan/i)
  })
})
