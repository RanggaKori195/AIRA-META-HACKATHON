import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  GrafikError,
  PALET,
  keSvg,
  pastikanSpek,
  potongLabel,
  ringkasAngka,
  skalaBagus,
  type SpekGrafik
} from '../src/main/grafik/svg'
import { catatanGrafik, ringkasEkor } from '../src/main/grafik/laporan'

const dasar: SpekGrafik = {
  jenis: 'batang',
  judul: 'Uji',
  label: ['Jan', 'Feb'],
  seri: [{ nama: 'Nett', nilai: [10, 20] }]
}

describe('nilai bukan angka DITOLAK, bukan dianggap nol', () => {
  // ⚠️ Pelajaran dari ppt/validasi.ts: model kerap mengirim "Rp 4,11 M" sebagai
  // nilai. Kalau dibiarkan, grafiknya rata tanah TANPA error — dan terlihat
  // persis seperti data yang memang nol.
  test('teks berformat ditolak dengan pesan yang menyebut bentuk benarnya', () => {
    const s = { ...dasar, seri: [{ nama: 'Nett', nilai: ['Rp 4,11 M' as unknown as number, 2] }] }
    assert.throws(() => pastikanSpek(s), (e: Error) => e instanceof GrafikError && /angka murni/.test(e.message))
  })

  test('NaN dan Infinity juga ditolak', () => {
    for (const jahat of [NaN, Infinity, -Infinity]) {
      assert.throws(() => pastikanSpek({ ...dasar, seri: [{ nama: 'N', nilai: [jahat, 1] }] }), GrafikError)
    }
  })

  test('jumlah nilai yang tidak sama dengan label ditolak, dan pesannya menyebut keduanya', () => {
    assert.throws(
      () => pastikanSpek({ ...dasar, seri: [{ nama: 'N', nilai: [1, 2, 3] }] }),
      (e: Error) => /3 angka/.test(e.message) && /2/.test(e.message)
    )
  })

  test('pai lebih dari satu seri ditolak', () => {
    assert.throws(
      () => pastikanSpek({ ...dasar, jenis: 'pai', seri: [{ nama: 'a', nilai: [1, 2] }, { nama: 'b', nilai: [1, 2] }] }),
      GrafikError
    )
  })
})

describe('skala sumbu enak dibaca', () => {
  test('dibulatkan ke kelipatan 1/2/5, bukan angka mentah', () => {
    for (const maks of [7, 23, 178, 1_733_000, 4_112_345_678]) {
      const { atas, garis } = skalaBagus(maks)
      assert.ok(atas >= maks, `atas (${atas}) harus menampung maks (${maks})`)
      assert.equal(garis[0], 0, 'sumbu selalu mulai dari nol')
      assert.ok(garis.length >= 3 && garis.length <= 8)
    }
  })

  test('nol dan nilai negatif tidak membuat pembagian nol', () => {
    for (const m of [0, -5]) {
      const { atas } = skalaBagus(m)
      assert.ok(atas > 0)
    }
  })
})

describe('angka diringkas dengan gaya Indonesia', () => {
  test('juta, miliar, triliun', () => {
    assert.match(ringkasAngka(4_110_000_000), /M$/)
    assert.match(ringkasAngka(1_500_000), /jt$/)
    assert.match(ringkasAngka(2500), /rb$/)
    assert.equal(ringkasAngka(0), '0')
  })

  test('memakai koma sebagai desimal, bukan titik', () => {
    assert.match(ringkasAngka(1_500_000), /1,5/)
  })
})

describe('label panjang dipotong supaya tidak tindih', () => {
  test('dipotong dengan penanda', () => {
    const p = potongLabel('PT Pelita Reliance Internasional Hospital', 14)
    assert.ok(p.length <= 14)
    assert.match(p, /…$/)
  })

  test('label pendek tidak disentuh', () => {
    assert.equal(potongLabel('EGFR', 14), 'EGFR')
  })
})

describe('SVG yang dihasilkan sah dan aman', () => {
  test('berupa SVG utuh dengan viewBox', () => {
    const svg = keSvg(dasar)
    assert.match(svg, /^<svg /)
    assert.match(svg, /viewBox="0 0 \d+ \d+"/)
    assert.match(svg, /<\/svg>$/)
  })

  // ⚠️ Judul & label bisa berasal dari kalimat user atau nama pelanggan di
  // database. Tanpa escape, satu tanda "<" merusak seluruh berkas SVG-nya.
  test('teks di-escape, tidak bisa menyuntik markup', () => {
    const svg = keSvg({ ...dasar, judul: '<script>x</script>', label: ['A&B', '"C"'] })
    assert.doesNotMatch(svg, /<script>/)
    assert.match(svg, /&lt;script&gt;/)
    assert.match(svg, /A&amp;B/)
  })

  test('keempat jenis grafik bisa digambar', () => {
    for (const jenis of ['batang', 'garis', 'pai', 'batang-tumpuk'] as const) {
      const spek: SpekGrafik = {
        jenis,
        label: ['A', 'B', 'C'],
        seri:
          jenis === 'pai'
            ? [{ nama: 'N', nilai: [3, 2, 1] }]
            : [{ nama: 'X', nilai: [3, 2, 1] }, { nama: 'Y', nilai: [1, 2, 3] }]
      }
      const svg = keSvg(spek)
      assert.match(svg, /<\/svg>$/, `gagal untuk ${jenis}`)
      assert.ok(svg.length > 300, `terlalu kosong untuk ${jenis}`)
    }
  })

  test('pai dengan total nol ditolak, bukan menghasilkan gambar kosong', () => {
    assert.throws(
      () => keSvg({ jenis: 'pai', label: ['A', 'B'], seri: [{ nama: 'N', nilai: [0, 0] }] }),
      GrafikError
    )
  })

  test('satu titik saja tidak membuat garis meledak', () => {
    const svg = keSvg({ jenis: 'garis', label: ['Jan'], seri: [{ nama: 'N', nilai: [5] }] })
    assert.match(svg, /<\/svg>$/)
  })

  test('memakai palet the company, bukan warna bawaan', () => {
    assert.ok(keSvg(dasar).includes(PALET[0]))
  })
})

describe('ekor daftar digabung, bukan dibuang', () => {
  // ⚠️ Grafik yang menampilkan 6 teratas dari 40 pelanggan tanpa "Lainnya"
  // membuat pembaca menyimpulkan enam itulah seluruh bisnisnya.
  test('sisanya jadi satu irisan "Lainnya" beserta jumlahnya', () => {
    const baris = Array.from({ length: 10 }, (_, i) => ({ nama: `P${i}`, nilai: 10 - i }))
    const hasil = ringkasEkor(baris, 6)
    assert.equal(hasil.length, 6)
    assert.match(hasil[5].nama, /Lainnya \(5\)/)
  })

  test('total TIDAK berubah setelah digabung', () => {
    const baris = Array.from({ length: 10 }, (_, i) => ({ nama: `P${i}`, nilai: i + 1 }))
    const jumlah = (a: Array<{ nilai: number }>): number => a.reduce((n, b) => n + b.nilai, 0)
    assert.equal(jumlah(ringkasEkor(baris, 6)), jumlah(baris))
  })

  test('daftar pendek tidak disentuh', () => {
    const baris = [{ nama: 'A', nilai: 1 }, { nama: 'B', nilai: 2 }]
    assert.deepEqual(ringkasEkor(baris, 6), baris)
  })
})

describe('grafik yang GAGAL wajib disebut', () => {
  // Dokumen yang kehilangan grafik tanpa keterangan terlihat persis seperti
  // dokumen yang memang tidak bergrafik — pola yang sama dengan PDF 22,8 MB
  // yang dilewati indexer diam-diam.
  test('semua jadi: dinyatakan sesuai tabel', () => {
    assert.match(catatanGrafik(3, 3), /sama persis dengan tabel/)
  })

  test('sebagian gagal: jumlahnya disebut dan disuruh diberitahukan', () => {
    const c = catatanGrafik(4, 1)
    assert.match(c, /1 dari 4/)
    assert.match(c, /Sebutkan ke user/i)
  })

  test('semua gagal: dokumen dinyatakan terbit TANPA grafik', () => {
    assert.match(catatanGrafik(3, 0), /GAGAL/)
    assert.match(catatanGrafik(3, 0), /tanpa grafik sama sekali/)
  })

  test('nol grafik dibedakan dari gagal', () => {
    assert.match(catatanGrafik(0, 0), /bukan kegagalan/i)
  })

  test('tidak ada bentuk catatan yang kosong', () => {
    for (const c of [catatanGrafik(0, 0), catatanGrafik(2, 2), catatanGrafik(2, 1), catatanGrafik(2, 0)]) {
      assert.ok(c.trim().length > 40)
    }
  })
})

// ------------------------------------------------ cacat yang tertangkap saat MEMBACA PDF uji (30 Sep)
import { lengkapiSampaiTotal, ringkasEkor as ringkas } from '../src/main/grafik/laporan'
import { moverDariHasil } from '../src/main/sales/report'

describe('laporan: grafik wajib sama dengan tabel (PDF uji 30 Sep)', () => {
  test('pai wilayah relatif terhadap TOTAL — DKI 45,5% seperti tabel, bukan 49,6%', () => {
    // Angka asli PDF uji: 10 provinsi teratas dari nett 9.418.341.390.
    const daftar = [4281797580, 1051386105, 770544750, 703928200, 654058650, 354453000, 270576250, 219076000, 185701375, 134150000].map((nilai, i) => ({ nama: `P${i}`, nilai }))
    const total = 9418341390
    const irisan = lengkapiSampaiTotal(ringkas(daftar), daftar, total)
    const jumlah = irisan.reduce((n, b) => n + b.nilai, 0)
    assert.ok(Math.abs(jumlah - total) < 1, 'irisan wajib berjumlah total periode')
    assert.equal(Math.round((irisan[0].nilai / jumlah) * 1000) / 10, 45.5)
    assert.equal(irisan[irisan.length - 1].nama, 'Lainnya')
  })

  test('daftar yang sudah mencakup seluruh total tidak diberi sisa palsu', () => {
    const daftar = [{ nama: 'A', nilai: 60 }, { nama: 'B', nilai: 40 }]
    assert.deepEqual(lengkapiSampaiTotal(daftar, daftar, 100), daftar)
  })

  test('mover: nama diambil dari kolom `item` hasil sales_movers (bukan "-")', () => {
    assert.equal(moverDariHasil({ item: 'NutriGEN-ME Life', kodeItem: 'X1', selisih: 261250000, persen: 343.5, status: 'naik' }).nama, 'NutriGEN-ME Life')
    assert.equal(moverDariHasil({ kodeItem: 'X2', selisih: 1 }).nama, 'X2')
    assert.equal(moverDariHasil({ selisih: 1 }).nama, '(tanpa nama)')
  })
})
