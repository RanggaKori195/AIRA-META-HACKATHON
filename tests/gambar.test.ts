import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  GambarError,
  MAKS_GAMBAR_PPT,
  MAKS_JUMLAH,
  MAKS_PROMPT_GAMBAR,
  PENANDA_AI,
  TAWARKAN_ILUSTRASI,
  UKURAN_BAWAAN,
  adalahPng,
  catatanGambar,
  dimensiPng,
  pastikanBerkasPng,
  pastikanJumlah,
  pastikanPrompt,
  pastikanUkuran,
  terjemahkanGalatGambar
} from '../src/main/gambar/rules'
import { pastikanJumlahGambar } from '../src/main/ppt/validasi'

// Gambar old-image-model (27 Sep 2026). Yang dikunci di sini adalah hal-hal yang
// kalau rusak GAGALNYA DIAM: berkas PNG bernama .jpg, gambar AI yang masuk deck
// manajemen tanpa keterangan, dan galat gateway yang tidak memberi jalan keluar.

/** PNG 1×1 sungguhan — dipakai menguji pengenalan magic byte & dimensi. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
)

describe('ukuran gambar', () => {
  test('bawaan dipakai bila tidak disebut', () => {
    assert.equal(pastikanUkuran(undefined), UKURAN_BAWAAN)
    assert.equal(pastikanUkuran(''), UKURAN_BAWAAN)
  })

  test('ukuran yang sudah diuji diterima, termasuk bentuk "1024 × 1024"', () => {
    assert.equal(pastikanUkuran('1024x1024'), '1024x1024')
    assert.equal(pastikanUkuran('1024 × 1024'), '1024x1024')
    assert.equal(pastikanUkuran('1536X1024'), '1536x1024')
  })

  test('ukuran asing DITOLAK dengan daftar pilihan (§55)', () => {
    assert.throws(() => pastikanUkuran('800x600'), (e: GambarError) => {
      assert.match(e.message, /is not supported/)
      assert.match(e.message, /512x512/)
      return true
    })
  })
})

describe('prompt & jumlah', () => {
  test('prompt kosong ditolak dengan arahan cara mengisinya', () => {
    assert.throws(() => pastikanPrompt('  '), /is required/)
  })
  test('prompt terlalu panjang ditolak sambil menyebut batasnya', () => {
    assert.throws(() => pastikanPrompt('a'.repeat(MAKS_PROMPT_GAMBAR + 1)), /limit 1,?000/)
  })
  test('jumlah dibatasi 1..MAKS_JUMLAH', () => {
    assert.equal(pastikanJumlah(undefined), 1)
    assert.equal(pastikanJumlah(3), 3)
    assert.throws(() => pastikanJumlah(0), /1 to/)
    assert.throws(() => pastikanJumlah(MAKS_JUMLAH + 1), /1 to/)
    assert.throws(() => pastikanJumlah(1.5), /1 to/)
  })
})

describe('berkas hasil wajib .png (gateway selalu PNG)', () => {
  test('.png lolos', () => {
    assert.doesNotThrow(() => pastikanBerkasPng('C:\\kerja\\ilustrasi.PNG'))
  })
  for (const nama of ['gambar.jpg', 'gambar.jpeg', 'gambar.webp', 'gambar']) {
    test(`${nama} ditolak`, () => {
      assert.throws(() => pastikanBerkasPng(nama), /must end in \.png/)
    })
  }
})

describe('PNG dikenali dari magic byte, bukan nama', () => {
  test('PNG sungguhan', () => {
    assert.equal(adalahPng(PNG_1X1), true)
    assert.deepEqual(dimensiPng(PNG_1X1), { lebar: 1, tinggi: 1 })
  })
  test('JPEG & sampah ditolak', () => {
    assert.equal(adalahPng(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5])), false)
    assert.equal(adalahPng(Buffer.from('bukan gambar sama sekali')), false)
    assert.equal(dimensiPng(Buffer.from('bukan gambar sama sekali')), null)
  })
})

describe('catatan hasil selalu menyatakan gambar buatan AI', () => {
  const c = catatanGambar({ file: 'a.png', lebar: 512, tinggi: 512, bytes: 1_048_576, jumlah: 1 })
  test('menyebut lokasi, ukuran, dan penanda AI', () => {
    assert.match(c, /a\.png/)
    assert.match(c, /512×512/)
    assert.match(c, /1\.00 MB/)
    assert.ok(c.includes(PENANDA_AI))
  })
  test('penanda melarang menyebutnya foto atau aset resmi', () => {
    assert.match(PENANDA_AI, /MADE BY AIRA/)
    assert.match(PENANDA_AI, /not a real photo/)
    assert.match(PENANDA_AI, /not an official company logo/i)
  })
})

describe('galat gateway diterjemahkan jadi jalan keluar (§55)', () => {
  const kasus: Array<[number, string, RegExp]> = [
    [500, 'litellm.InternalServerError: Invalid response object', /Try once more/],
    [401, 'invalid api key', /API key/],
    [404, 'model not found', /not available/],
    [429, 'rate limit exceeded', /busy/],
    [400, 'content policy violation', /content filter/],
    [418, 'aneh', /HTTP 418/]
  ]
  for (const [status, isi, pola] of kasus) {
    test(`${status} ${isi.slice(0, 30)}`, () => {
      assert.match(terjemahkanGalatGambar(status, isi), pola)
    })
  }
})

describe('ilustrasi presentasi', () => {
  test(`maksimal ${MAKS_GAMBAR_PPT} ilustrasi per deck`, () => {
    assert.doesNotThrow(() => pastikanJumlahGambar(MAKS_GAMBAR_PPT))
    assert.throws(() => pastikanJumlahGambar(MAKS_GAMBAR_PPT + 1), /batasnya 6/)
  })

  test('deck tanpa ilustrasi WAJIB menawarkan, bukan memutuskan sendiri', () => {
    assert.match(TAWARKAN_ILUSTRASI, /OFFER ONCE/)
    assert.match(TAWARKAN_ILUSTRASI, /made by AIRA/)
    assert.match(TAWARKAN_ILUSTRASI, /[Dd]o not rebuild/)
    assert.match(TAWARKAN_ILUSTRASI, /do not offer repeatedly/)
  })

  test('layout "gambar" terdaftar di daftar layout PPT', async () => {
    const { LAYOUT_TERSEDIA } = await import('../src/main/ppt/render')
    assert.ok((LAYOUT_TERSEDIA as readonly string[]).includes('gambar'))
  })
})

describe('merek: yang dilihat user selalu "AIRA", tidak pernah nama model', () => {
  // ⚠️ Permintaan user 27 Sep 2026: produk yang dijual adalah AIRA. Nama model
  // di gateway ("old-image-model") tidak boleh muncul di layar maupun di kalimat yang
  // diteruskan model ke user.
  const LARANGAN = /old-image-model/i

  test('kalimat catatan & tawaran tidak menyebut nama model', () => {
    assert.doesNotMatch(PENANDA_AI, LARANGAN)
    assert.doesNotMatch(TAWARKAN_ILUSTRASI, LARANGAN)
    assert.doesNotMatch(
      catatanGambar({ file: 'a.png', lebar: 1, tinggi: 1, bytes: 1, jumlah: 1 }),
      LARANGAN
    )
  })

  test('pesan galat tidak menyebut nama model', () => {
    for (const s of [401, 404, 429, 400, 500, 503]) {
      assert.doesNotMatch(terjemahkanGalatGambar(s, 'content policy invalid response object'), LARANGAN)
    }
  })

  test('penanda menyuruh model menyebut "AIRA" saja', () => {
    assert.match(PENANDA_AI, /DO NOT mention the model/)
  })

  test('teks layar (di luar komentar) tidak menyebut nama model', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    for (const f of [
      '../src/renderer/src/views/Gambar.tsx',
      '../src/renderer/src/App.tsx',
      '../src/main/tools/gambar-tools.ts',
      '../src/main/tools/doc-tools.ts',
      '../src/main/ppt/render.ts'
    ]) {
      const baris = readFileSync(join(__dirname, f), 'utf8')
        .split(/\r?\n/)
        .filter((b) => !/^\s*(\/\/|\*|\/\*)/.test(b))
      const kena = baris.filter((b) => LARANGAN.test(b))
      assert.deepEqual(kena, [], `${f} masih menyebut nama model: ${kena.join(' | ')}`)
    }
  })
})
