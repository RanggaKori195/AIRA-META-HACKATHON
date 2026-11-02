import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { anggaran, barisDipakai, barisTeks, judulLanjutan, pecahBaris, pecahButir } from '../src/main/ppt/muat'
import {
  KOTAK,
  MAKS_JUDUL,
  SLIDE,
  UKURAN,
  susunSampul,
  ukuranJudul
} from '../src/main/ppt/tema'
import { IKON, NAMA_IKON, berkasIkon, ikonMirip } from '../src/main/ppt/ikon'
import {
  MAKS_AGENDA,
  MAKS_KARTU,
  pastikanAgenda,
  pastikanGrafik,
  pastikanIkon,
  pastikanJudul,
  pastikanKartu,
  pastikanTabel,
  bacaSlides,
  normalkanSlide
} from '../src/main/ppt/validasi'

// Test presentasi the company.
//
// Yang dikunci di sini adalah hal-hal yang gagalnya SUNYI di PowerPoint: teks
// yang meluber keluar slide, judul yang membungkus lalu naik menutupi garis
// template, ikon yang tidak ada jadi kotak kosong, dan baris tabel timpang yang
// menggeser angka ke kolom sebelah. Tidak satu pun dari itu menghasilkan error
// saat berkasnya dibuat.

describe('anggaran muat', () => {
  test('kotak lebih lebar memuat lebih banyak karakter per baris', () => {
    const sempit = anggaran(3, 2, 16)
    const lebar = anggaran(9, 2, 16)
    assert.ok(lebar.perBaris > sempit.perBaris)
  })

  test('huruf lebih besar memuat lebih sedikit baris', () => {
    assert.ok(anggaran(9, 4, 32).maksBaris < anggaran(9, 4, 16).maksBaris)
  })

  test('teks kosong tetap dihitung satu baris', () => {
    assert.equal(barisDipakai('   ', 40), 1)
  })

  test('teks dua kali lebar kotak dihitung dua baris', () => {
    assert.equal(barisDipakai('x'.repeat(80), 40), 2)
  })
})

describe('pemecahan slide', () => {
  const a = { perBaris: 50, maksBaris: 6 }

  test('butir yang muat tidak dipecah', () => {
    const hasil = pecahButir(['satu', 'dua', 'tiga'], (t) => t, a)
    assert.equal(hasil.length, 1)
    assert.deepEqual(hasil[0], ['satu', 'dua', 'tiga'])
  })

  test('butir yang kebanyakan dipecah ke slide berikutnya', () => {
    const butir = Array.from({ length: 12 }, (_, i) => `butir ${i + 1}`)
    const hasil = pecahButir(butir, (t) => t, a)
    assert.ok(hasil.length > 1)
    // Tidak ada yang hilang: jumlah butir sesudah dipecah harus sama persis.
    assert.equal(hasil.flat().length, butir.length)
    assert.deepEqual(hasil.flat(), butir)
  })

  test('butir yang sendirian lebih panjang dari slide TIDAK dipotong', () => {
    const panjang = 'x'.repeat(1000)
    const hasil = pecahButir([panjang, 'pendek'], (t) => t, a)
    assert.equal(hasil.flat().join('').length, panjang.length + 'pendek'.length)
    assert.ok(hasil[0].includes(panjang))
  })

  test('daftar kosong menghasilkan nol slide', () => {
    assert.deepEqual(pecahButir([], (t: string) => t, a), [])
  })

  test('baris tabel dipecah tanpa kehilangan baris', () => {
    const baris = Array.from({ length: 25 }, (_, i) => [String(i)])
    const hasil = pecahBaris(baris, 10)
    assert.equal(hasil.length, 3)
    assert.equal(hasil.flat().length, 25)
  })

  test('slide sambungan diberi penanda, slide pertama tidak', () => {
    assert.equal(judulLanjutan('Temuan', 0), 'Temuan')
    assert.match(judulLanjutan('Temuan', 1), /lanjutan 2/)
  })
})

describe('ukuran judul mengikuti lebar kotak', () => {
  // Regresi 21 Agu 2026: judul 29 karakter "Yang menguat dan yang melemah"
  // tetap 40pt karena ambangnya ditebak per jumlah karakter, lalu membungkus
  // jadi dua baris dan naik KELUAR dari slide. Ukurannya sekarang dihitung dari
  // lebar kotak memakai penaksir yang sama dengan penentu muat/tidak.
  test('judul yang tidak muat satu baris otomatis mengecil', () => {
    const judul = 'Yang menguat dan yang melemah'
    const sz = ukuranJudul(judul)
    assert.ok(sz < UKURAN.judul, `harusnya mengecil dari ${UKURAN.judul}, dapat ${sz}`)
    assert.equal(barisTeks(judul, KOTAK.judul[2], sz), 1)
  })

  test('judul pendek tetap ukuran penuh', () => {
    assert.equal(ukuranJudul('Agenda'), UKURAN.judul)
  })

  test('judul apa pun selalu muat satu baris pada kotak judul', () => {
    const contoh = [
      'Ringkasan',
      'Kinerja penjualan Juli 2026',
      'Perbandingan pencapaian tiap cabang terhadap target bulanan',
      'x'.repeat(MAKS_JUDUL)
    ]
    for (const j of contoh) {
      const sz = ukuranJudul(j)
      assert.ok(
        barisTeks(j, KOTAK.judul[2], sz) <= 2,
        `"${j.slice(0, 20)}..." butuh ${barisTeks(j, KOTAK.judul[2], sz)} baris pada ${sz}pt`
      )
    }
  })

  test('sampul boleh dua baris', () => {
    const judul = 'Kinerja the lab'
    const sz = ukuranJudul(judul, UKURAN.sampulJudul, KOTAK.sampulJudul[2], 2)
    assert.ok(barisTeks(judul, KOTAK.sampulJudul[2], sz) <= 2)
  })
})

describe('susunan sampul', () => {
  // Regresi dari deck SUNGGUHAN pertama (21 Agu 2026, "AURA Clinical GenAI"):
  // subjudul 78 karakter membungkus jadi 3 baris di kotak setinggi 1 baris,
  // sehingga menimpa judul di atasnya DAN catatan di bawahnya. Tidak ada error;
  // ketahuan hanya karena slidenya dipandang.
  const JUDUL = 'AURA Clinical GenAI'
  const SUB = 'Expertise Within — Platform AI Generatif On-Premise untuk the lab (the company)'
  const CATATAN = 'Disusun oleh AIRA - 21 Agustus 2026'

  test('tiga blok tidak pernah saling bertindih', () => {
    const blok = susunSampul(JUDUL, SUB, CATATAN)
    assert.equal(blok.length, 3)
    for (let i = 1; i < blok.length; i++) {
      const atas = blok[i - 1]
      assert.ok(
        atas.y + atas.h <= blok[i].y + 0.001,
        `${atas.bagian} (berakhir ${(atas.y + atas.h).toFixed(2)}) menimpa ${blok[i].bagian} (mulai ${blok[i].y.toFixed(2)})`
      )
    }
  })

  test('urutannya selalu judul, subjudul, catatan', () => {
    assert.deepEqual(
      susunSampul(JUDUL, SUB, CATATAN).map((b) => b.bagian),
      ['judul', 'subjudul', 'catatan']
    )
  })

  test('setiap blok muat menampung teksnya sendiri', () => {
    const lebar = KOTAK.sampulJudul[2]
    const isi = { judul: JUDUL, subjudul: SUB, catatan: CATATAN }
    for (const b of susunSampul(JUDUL, SUB, CATATAN)) {
      const perlu = barisTeks(isi[b.bagian], lebar, b.sz)
      const muat = anggaran(lebar, b.h, b.sz).maksBaris
      assert.ok(perlu <= muat, `${b.bagian}: perlu ${perlu} baris, kotaknya muat ${muat}`)
    }
  })

  test('seluruh blok tetap di dalam slide', () => {
    for (const kombinasi of [
      [JUDUL, SUB, CATATAN],
      [JUDUL, SUB, undefined],
      [JUDUL, undefined, undefined],
      ['Judul yang sangat panjang sekali sampai membutuhkan dua baris penuh', SUB, CATATAN]
    ] as Array<[string, string | undefined, string | undefined]>) {
      for (const b of susunSampul(...kombinasi)) {
        assert.ok(b.y >= 0, `blok ${b.bagian} mulai di ${b.y}`)
        assert.ok(b.y + b.h <= SLIDE.tinggi, `blok ${b.bagian} berakhir di ${b.y + b.h}`)
      }
    }
  })

  test('sampul tanpa subjudul & catatan tetap menghasilkan satu blok', () => {
    const blok = susunSampul(JUDUL, undefined, undefined)
    assert.equal(blok.length, 1)
    assert.equal(blok[0].bagian, 'judul')
  })
})

describe('bentuk argumen dari model', () => {
  // Regresi 21 Agu 2026: panggilan write_ppt PERTAMA gagal karena model
  // mengirim `slides` sebagai teks JSON, bukan array. Satu giliran penuh
  // terbuang sebelum ia mencoba lagi.
  test('slides sebagai teks JSON diterima', () => {
    const hasil = bacaSlides('[{"layout":"sampul","judul":"Uji"}]')
    assert.equal(hasil.length, 1)
    assert.deepEqual(hasil[0], { layout: 'sampul', judul: 'Uji' })
  })

  test('slides sebagai array tetap diterima apa adanya', () => {
    const asli = [{ layout: 'penutup' }]
    assert.deepEqual(bacaSlides(asli), asli)
  })

  test('teks yang bukan JSON ditolak dengan petunjuk bentuk yang benar', () => {
    assert.throws(() => bacaSlides('slide 1: sampul'), /bukan JSON|array/)
  })

  test('array kosong tetap ditolak', () => {
    assert.throws(() => bacaSlides([]), /minimal satu slide/)
  })

  test('field bersarang berupa teks JSON ikut dinormalkan', () => {
    const hasil = normalkanSlide({
      layout: 'poin',
      judul: 'Uji',
      poin: '["satu","dua"]'
    }) as { poin: unknown }
    assert.deepEqual(hasil.poin, ['satu', 'dua'])
  })

  test('teks biasa TIDAK ikut diparse jadi JSON', () => {
    const hasil = normalkanSlide({ layout: 'bagian', judul: 'Uji', subjudul: 'Basis invoice' }) as {
      subjudul: unknown
    }
    assert.equal(hasil.subjudul, 'Basis invoice')
  })

  test('field bersarang yang JSON-nya rusak dibiarkan untuk ditolak validasi layout', () => {
    const hasil = normalkanSlide({ layout: 'poin', poin: '[rusak' }) as { poin: unknown }
    assert.equal(hasil.poin, '[rusak')
  })
})

describe('geometri template', () => {
  test('semua kotak berada di dalam slide', () => {
    for (const [nama, [x, y, w, h]] of Object.entries(KOTAK)) {
      assert.ok(x >= 0 && y >= 0, `${nama} mulai di luar slide`)
      assert.ok(x + w <= SLIDE.lebar + 0.001, `${nama} melebihi lebar slide`)
      assert.ok(y + h <= SLIDE.tinggi + 0.001, `${nama} melebihi tinggi slide`)
    }
  })

  test('badan slide berhenti sebelum bilah hijau di kaki template', () => {
    // Bilah "a Journey of Purpose, Growth, and Hope" menyatu dengan gambar
    // latar mulai sekitar 5,0 inci. Teks yang melewatinya akan tertimpa.
    const [, y, , h] = KOTAK.badan
    assert.ok(y + h <= 4.95, `badan berakhir di ${y + h}, terlalu dekat bilah kaki`)
  })
})

describe('daftar ikon tertutup', () => {
  test('ikon yang tidak dikenal ditolak, bukan diabaikan', () => {
    assert.throws(() => pastikanIkon('kuda-terbang'), /tidak dikenal/)
  })

  test('ikon kosong boleh (poin memang tidak wajib berikon)', () => {
    assert.equal(pastikanIkon(undefined), undefined)
  })

  test('ikon yang dikenal diteruskan apa adanya', () => {
    assert.equal(pastikanIkon('tren-naik'), 'tren-naik')
  })

  test('pesan error menawarkan nama yang mirip', () => {
    assert.throws(() => pastikanIkon('tren'), /tren-naik|tren-turun/)
  })

  test('nama berkas ikon mengikuti nama Lucide, bukan nama Indonesianya', () => {
    assert.equal(berkasIkon('tren-naik', 'hijau'), 'trending-up-hijau.png')
  })

  test('setiap nama Indonesia menunjuk berkas Lucide yang berbeda-beda isinya', () => {
    for (const nama of NAMA_IKON) {
      assert.ok(IKON[nama], `${nama} tidak punya berkas`)
      assert.match(IKON[nama], /^[a-z0-9-]+$/)
    }
  })

  test('ikonMirip tidak pernah melempar untuk masukan aneh', () => {
    assert.doesNotThrow(() => ikonMirip(''))
    assert.doesNotThrow(() => ikonMirip('!!!'))
  })
})

describe('penolakan isi slide', () => {
  test('judul kosong ditolak', () => {
    assert.throws(() => pastikanJudul('   ', 'poin'), /wajib punya judul/)
  })

  test('judul kelewat panjang ditolak dengan angkanya', () => {
    assert.throws(() => pastikanJudul('x'.repeat(MAKS_JUDUL + 1), 'poin'), /terlalu panjang/)
  })

  test('agenda melebihi batas ditolak dan menyarankan layout lain', () => {
    const item = Array.from({ length: MAKS_AGENDA + 1 }, (_, i) => `item ${i}`)
    assert.throws(() => pastikanAgenda(item, 'Agenda'), /maksimal 12|layout "poin"/)
  })

  test('kartu angka lebih dari batas ditolak', () => {
    assert.throws(() => pastikanKartu(MAKS_KARTU + 1, 'KPI'), /maksimal/)
  })

  test('baris tabel timpang ditolak, bukan digeser diam-diam', () => {
    assert.throws(
      () => pastikanTabel(['a', 'b', 'c'], [['1', '2', '3'], ['1', '2']], 'Tabel'),
      /baris ke-2/
    )
  })

  test('tabel yang rapi lolos', () => {
    assert.doesNotThrow(() => pastikanTabel(['a', 'b'], [['1', '2']], 'Tabel'))
  })

  test('nilai grafik berupa teks berformat ditolak', () => {
    assert.throws(
      () =>
        pastikanGrafik(
          ['Jan', 'Feb'],
          [{ nama: 'Nett', nilai: ['Rp 4,11 M', 3] as unknown as number[] }],
          'Grafik'
        ),
      /bukan angka/
    )
  })

  test('jumlah nilai yang tidak cocok dengan label ditolak', () => {
    assert.throws(
      () => pastikanGrafik(['Jan', 'Feb', 'Mar'], [{ nama: 'Nett', nilai: [1, 2] }], 'Grafik'),
      /Jumlah angka tiap seri/
    )
  })

  test('grafik yang benar lolos', () => {
    assert.doesNotThrow(() => pastikanGrafik(['Jan'], [{ nama: 'Nett', nilai: [1] }], 'Grafik'))
  })
})
