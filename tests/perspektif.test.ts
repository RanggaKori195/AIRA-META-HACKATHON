import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  ambilJson,
  angkaTakDidukung,
  deteksiKonflikAngka,
  klaimRagu,
  kumpulkanNilai,
  normalkanNama,
  parseKlaim,
  type KlaimPerspektif
} from '../src/main/perspektif/rules'
import {
  PERSPEKTIF,
  PERSPEKTIF_BELUM_ADA,
  promptPerspektif,
  susunLaporan
} from '../src/main/perspektif/laporan'

// Analisa lintas perspektif — ide dari `mcp-strategy` (the gateway admin), dikecilkan
// jadi satu giliran chat.
//
// Yang membuat fitur ini lebih dari "minta model menganalisa": fakta
// dikumpulkan deterministik LEBIH DULU, lalu set yang SAMA dikirim ke tiap
// perspektif. Karena itu dua hal bisa dipastikan tanpa menebak — dan test di
// bawah ini yang menjaga keduanya tetap bekerja.

const perspektif = (label: string, klaim: any[]): KlaimPerspektif => ({
  perspektif: label.toLowerCase(),
  label,
  klaim
})

describe('membaca keluaran model', () => {
  test('JSON polos terbaca', () => {
    const { klaim } = parseKlaim('{"klaim":[{"pernyataan":"Tumbuh","angka":[],"keyakinan":0.8}]}')
    assert.equal(klaim.length, 1)
    assert.equal(klaim[0].pernyataan, 'Tumbuh')
    assert.equal(klaim[0].keyakinan, 0.8)
  })

  // Model 27B sering membungkus JSON dengan ```json dan menambah kalimat
  // pengantar. Menolaknya berarti membuang jawaban yang isinya benar.
  test('JSON berpagar ```json dan berkalimat pengantar tetap terbaca', () => {
    const teks =
      'Baik, berikut analisanya:\n\n```json\n{"klaim":[{"pernyataan":"Turun","angka":[],' +
      '"keyakinan":0.6}]}\n```\n\nSemoga membantu.'
    const { klaim, gagal } = parseKlaim(teks)
    assert.equal(gagal, undefined)
    assert.equal(klaim[0].pernyataan, 'Turun')
  })

  test('angka format Indonesia dan bertanda Rp dinormalkan', () => {
    const { klaim } = parseKlaim(
      '{"klaim":[{"pernyataan":"x","angka":[{"nama":"nett","nilai":"Rp 4.112.345.678"},' +
        '{"nama":"persen","nilai":"12,5"}],"keyakinan":1}]}'
    )
    assert.deepEqual(klaim[0].angka, [
      { nama: 'nett', nilai: 4112345678 },
      { nama: 'persen', nilai: 12.5 }
    ])
  })

  test('baris yang bentuknya salah dilewati, bukan menggagalkan semuanya', () => {
    const { klaim } = parseKlaim(
      '{"klaim":[{"pernyataan":""},{"pernyataan":"Sah","angka":[],"keyakinan":0.9}]}'
    )
    assert.equal(klaim.length, 1)
    assert.equal(klaim[0].pernyataan, 'Sah')
  })

  test('keluaran tanpa JSON dilaporkan gagal, bukan dibuat-buat', () => {
    const { klaim, gagal } = parseKlaim('Maaf, saya tidak bisa menganalisa ini.')
    assert.equal(klaim.length, 0)
    assert.match(gagal ?? '', /JSON/i)
  })

  test('keyakinan yang hilang tidak jadi 0, dan yang di luar 0..1 dijepit', () => {
    const { klaim } = parseKlaim(
      '{"klaim":[{"pernyataan":"a","angka":[]},{"pernyataan":"b","angka":[],"keyakinan":5}]}'
    )
    assert.equal(klaim[0].keyakinan, 0.5)
    assert.equal(klaim[1].keyakinan, 1)
  })

  test('ambilJson mengembalikan null kalau memang tidak ada', () => {
    assert.equal(ambilJson('tidak ada apa-apa di sini'), null)
  })

  // ⚠️ KEJADIAN NYATA 25 Agu 2026, uji lapangan pertama pada item berdata kaya:
  // KEDUA perspektif gagal total dan laporannya kosong. Sebabnya `old-think-model`
  // model REASONING — untaian penalarannya ikut memakan `max_tokens`
  // (terukur: penalaran 3.558 karakter = 1.335 dari 1.400 token), jadi JSON-nya
  // berhenti di tengah array. Padahal 3 klaim pertamanya sudah utuh dan benar.
  describe('keluaran terpotong di tengah', () => {
    const TERPOTONG =
      '{"klaim":[' +
      '{"pernyataan":"Nett bulan ini 6.494.000","angka":[{"nama":"nett","nilai":6494000}],"keyakinan":0.92},' +
      '{"pernyataan":"Order 34 kali","angka":[{"nama":"order","nilai":34}],"keyakinan":0.9},' +
      '{"pernyataan":"Kontribusi kecil terhadap total","angka":[],"keyakinan":0.8},' +
      '{"pernyataan":"Pelanggan terkon'

    test('klaim yang sudah utuh diselamatkan, bukan dibuang semua', () => {
      const { klaim, gagal } = parseKlaim(TERPOTONG)
      assert.equal(klaim.length, 3, 'tiga klaim pertama harus selamat')
      assert.equal(klaim[0].angka[0].nilai, 6494000)
      assert.match(gagal ?? '', /terpotong/i)
    })

    test('klaim selamatan TETAP ikut pemeriksaan angka', () => {
      const { klaim } = parseKlaim(TERPOTONG)
      const hasil = angkaTakDidukung([perspektif('A', klaim)], [6494000])
      // 34 tidak ada di daftar fakta -> harus tertandai; 6494000 ada -> tidak.
      assert.equal(hasil.length, 1)
      assert.equal(hasil[0].nilai, 34)
    })

    test('kalau tidak ada satu pun klaim utuh, barulah dinyatakan gagal', () => {
      const { klaim, gagal } = parseKlaim('{"klaim":[{"pernyataan":"terpo')
      assert.equal(klaim.length, 0)
      assert.match(gagal ?? '', /tidak valid|terpotong/i)
    })
  })
})

describe('konflik angka antar perspektif', () => {
  // Semua perspektif membaca fakta yang IDENTIK, jadi selisih angka berarti
  // salah satu salah membaca — bukan beda pendapat yang sah.
  test('metrik sama dengan nilai berbeda terdeteksi', () => {
    const konflik = deteksiKonflikAngka([
      perspektif('Komersial', [{ pernyataan: 'a', angka: [{ nama: 'nett', nilai: 1000 }], keyakinan: 1 }]),
      perspektif('Operasional', [{ pernyataan: 'b', angka: [{ nama: 'Nett', nilai: 2000 }], keyakinan: 1 }])
    ])
    assert.equal(konflik.length, 1)
    assert.equal(konflik[0].nama, 'nett')
    assert.equal(konflik[0].nilai.length, 2)
  })

  // "Rp 4,11 M" untuk 4.112.345.678 itu pembulatan penyajian yang wajar,
  // bukan konflik. Guard yang terlalu galak di sini akan menandai semua
  // laporan sebagai bermasalah, dan lama-lama bagian konflik tidak dibaca.
  test('selisih dalam batas pembulatan wajar BUKAN konflik', () => {
    const konflik = deteksiKonflikAngka([
      perspektif('A', [{ pernyataan: 'x', angka: [{ nama: 'nett', nilai: 1_000_000 }], keyakinan: 1 }]),
      perspektif('B', [{ pernyataan: 'y', angka: [{ nama: 'nett', nilai: 1_005_000 }], keyakinan: 1 }])
    ])
    assert.equal(konflik.length, 0)
  })

  test('satu perspektif saja tidak pernah dianggap konflik', () => {
    const konflik = deteksiKonflikAngka([
      perspektif('A', [
        { pernyataan: 'x', angka: [{ nama: 'nett', nilai: 100 }], keyakinan: 1 },
        { pernyataan: 'y', angka: [{ nama: 'nett', nilai: 999 }], keyakinan: 1 }
      ])
    ])
    assert.equal(konflik.length, 0)
  })

  test('nama metrik dinormalkan sebelum dibandingkan', () => {
    assert.equal(normalkanNama('Nett Sales'), 'nett_sales')
    assert.equal(normalkanNama('nett_sales'), 'nett_sales')
    assert.equal(normalkanNama('  NETT-SALES  '), 'nett_sales')
  })
})

describe('angka yang tidak ada di fakta', () => {
  const fakta = { nett: 5_000_000, order: 42, pelanggan: [{ nett: 1_250_000 }] }

  test('semua nilai tergali, sedalam apa pun sarangnya', () => {
    const nilai = kumpulkanNilai(fakta)
    assert.ok(nilai.includes(5_000_000))
    assert.ok(nilai.includes(42))
    assert.ok(nilai.includes(1_250_000))
  })

  test('angka yang memang ada di fakta TIDAK ditandai', () => {
    const hasil = angkaTakDidukung(
      [perspektif('A', [{ pernyataan: 'x', angka: [{ nama: 'nett', nilai: 5_000_000 }], keyakinan: 1 }])],
      kumpulkanNilai(fakta)
    )
    assert.equal(hasil.length, 0)
  })

  // Pendeteksi karangan paling langsung yang bisa kita punya: fakta sudah
  // dikumpulkan lebih dulu, jadi angka yang tidak berasal dari sana pasti
  // bukan dari database.
  test('angka karangan ditandai', () => {
    const hasil = angkaTakDidukung(
      [perspektif('A', [{ pernyataan: 'x', angka: [{ nama: 'nett', nilai: 9_999_999 }], keyakinan: 1 }])],
      kumpulkanNilai(fakta)
    )
    assert.equal(hasil.length, 1)
    assert.equal(hasil[0].nilai, 9_999_999)
  })
})

describe('klaim berkeyakinan rendah', () => {
  test('dikumpulkan, bukan dibuang', () => {
    const ragu = klaimRagu([
      perspektif('A', [
        { pernyataan: 'yakin', angka: [], keyakinan: 0.9 },
        { pernyataan: 'ragu', angka: [], keyakinan: 0.3 }
      ])
    ])
    assert.equal(ragu.length, 1)
    assert.equal(ragu[0].pernyataan, 'ragu')
  })
})

describe('susunan laporan', () => {
  const bahan = {
    judul: 'Analisa — EKG',
    periode: 'bulan ini',
    perspektif: [
      perspektif('Komersial', [{ pernyataan: 'Tumbuh', angka: [], keyakinan: 0.9 }]),
      perspektif('Operasional Lab', [{ pernyataan: 'TAT stabil', angka: [], keyakinan: 0.8 }])
    ],
    konflik: [{ nama: 'nett', nilai: [{ perspektif: 'Komersial', nilai: 1 }, { perspektif: 'Operasional Lab', nilai: 2 }] }],
    takDidukung: [{ perspektif: 'Komersial', nama: 'margin', nilai: 77 }],
    ragu: [{ perspektif: 'Operasional Lab', pernyataan: 'mungkin naik', keyakinan: 0.3 }],
    belumAda: PERSPEKTIF_BELUM_ADA
  }

  // ⚠️ Ini janji struktural fiturnya. Kalau bagian konflik jatuh ke bawah, ia
  // tidak akan pernah dibaca — padahal justru di situ letak hal yang perlu
  // diperiksa manusia.
  test('bagian konflik ada SEBELUM temuan per perspektif', () => {
    const teks = susunLaporan(bahan)
    const iKonflik = teks.indexOf('Titik Konflik')
    const iPerspektif = teks.indexOf('## Komersial')
    assert.ok(iKonflik > 0, 'bagian konflik harus ada')
    assert.ok(iPerspektif > iKonflik, 'temuan per perspektif harus SESUDAH bagian konflik')
  })

  test('ketiga jenis temuan muncul', () => {
    const teks = susunLaporan(bahan)
    assert.match(teks, /nett/)
    assert.match(teks, /margin/)
    assert.match(teks, /mungkin naik/)
  })

  test('tanpa masalah pun bagiannya tetap ada dan menyatakan itu', () => {
    const teks = susunLaporan({ ...bahan, konflik: [], takDidukung: [], ragu: [] })
    assert.match(teks, /Titik Konflik/)
    assert.match(teks, /Tidak ada konflik angka/)
  })

  test('perspektif yang gagal dibaca disebutkan, tidak dihilangkan diam-diam', () => {
    const teks = susunLaporan({
      ...bahan,
      perspektif: [{ perspektif: 'a', label: 'Komersial', klaim: [], gagalParse: 'JSON tidak valid' }]
    })
    assert.match(teks, /Komersial/)
    assert.match(teks, /JSON tidak valid/)
  })

  // ⚠️ `gagalParse` terisi TIDAK otomatis berarti kosong: keluaran terpotong
  // tetap menyisakan klaim awal yang utuh. Versi pertama membuang semuanya
  // begitu ada catatan kegagalan — kerugian yang tidak perlu.
  test('klaim hasil selamatan TETAP ditampilkan beserta catatan terpotongnya', () => {
    const teks = susunLaporan({
      ...bahan,
      perspektif: [
        {
          perspektif: 'a',
          label: 'Komersial',
          klaim: [{ pernyataan: 'Nett naik', angka: [], keyakinan: 0.9 }],
          gagalParse: 'keluaran model terpotong; 1 klaim pertama diselamatkan'
        }
      ]
    })
    assert.match(teks, /Nett naik/, 'klaim selamatan harus tetap tampil')
    assert.match(teks, /terpotong/i, 'catatan terpotong harus ikut disebut')
    assert.doesNotMatch(teks, /Tidak ada temuan yang bisa dibaca/)
  })

  // Perspektif tanpa data TIDAK menghasilkan error — ia menghasilkan paragraf
  // meyakinkan yang seluruhnya karangan. Karena itu ketiadaannya harus
  // tertulis di laporan, bukan didiamkan.
  test('perspektif yang belum punya data dinyatakan apa adanya', () => {
    const teks = susunLaporan(bahan)
    assert.match(teks, /QA/)
    assert.match(teks, /belum ada sumber datanya/i)
  })
})

describe('perspektif & promptnya', () => {
  test('hanya perspektif yang punya sumber data yang aktif', () => {
    const kode = PERSPEKTIF.map((p) => p.kode)
    assert.deepEqual(kode, ['komersial', 'operasional'])
    assert.ok(PERSPEKTIF_BELUM_ADA.some((p) => /QA/i.test(p.label)))
  })

  test('prompt melarang mengarang angka dan meminta kejujuran keyakinan', () => {
    const p = promptPerspektif(PERSPEKTIF[0])
    assert.match(p, /WAJIB berasal dari data yang diberikan/i)
    assert.match(p, /Jangan menghitung angka baru di kepala/i)
    assert.match(p, /keyakinan/i)
    assert.match(p, /\{"klaim"/)
  })

  test('tiap perspektif menyuruh model TIDAK menyeberang ke wilayah lain', () => {
    for (const p of PERSPEKTIF) {
      assert.match(p.sudut, /TIDAK membahas/i, p.label)
    }
  })
})
