import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  bulanBerikut,
  catatanRamalan,
  harapanTren,
  mapeBacktest,
  momentum,
  proyeksiBulanBerjalan,
  ramal,
  regresi,
  MAKS_HORIZON,
  MIN_RIWAYAT
} from '../src/main/sales/forecast'
import { isSalesQuestion } from '../src/main/agent/tool-groups'

// Test regresi peramalan penjualan.
//
// ⚠️ Forecast adalah angka yang TIDAK BISA DIVERIFIKASI hari ini tapi dipakai
// mengambil keputusan. Yang dikunci di sini bukan "modelnya pintar", melainkan
// bahwa angkanya dihitung deterministik, ketidakpastiannya selalu ikut, dan
// batas-batasnya tidak bisa dilanggar diam-diam.

const deret = (n: number, awal: number, naik: number): Array<{ bulan: string; nett: number }> =>
  Array.from({ length: n }, (_, i) => ({
    bulan: bulanBerikut('2025-01', i),
    nett: awal + naik * i
  }))

describe('regresi linier', () => {
  test('deret naik sempurna terbaca kemiringannya', () => {
    const g = regresi([100, 200, 300, 400])
    assert.equal(Math.round(g.kemiringan), 100)
    assert.equal(Math.round(g.potong), 100)
  })

  test('deret datar berkemiringan nol', () => {
    assert.equal(regresi([500, 500, 500]).kemiringan, 0)
  })

  test('deret kosong & satu titik tidak melempar', () => {
    assert.equal(regresi([]).kemiringan, 0)
    assert.equal(regresi([42]).potong, 42)
  })
})

describe('ramalan', () => {
  test('horizon dibatasi maksimal 3 bulan', () => {
    // Di luar 3 bulan ekstrapolasi linier jadi omong kosong. Menolak lebih jujur
    // daripada memberi angka tanpa dasar.
    assert.equal(ramal(deret(12, 1000, 100), 12, 5).length, MAKS_HORIZON)
    assert.equal(ramal(deret(12, 1000, 100), 0, 5).length, 1)
  })

  test('bulan ramalan menyambung dari bulan terakhir', () => {
    const r = ramal(deret(12, 1000, 100), 3, 5)
    assert.deepEqual(r.map((x) => x.bulan), ['2026-01', '2026-02', '2026-03'])
  })

  test('rentang MELEBAR makin jauh horizonnya', () => {
    // Meramal 3 bulan ke depan tidak sepasti 1 bulan; menyajikan lebar yang sama
    // untuk keduanya menyesatkan.
    const r = ramal(deret(12, 1000, 100), 3, 10)
    const lebar = r.map((x) => (x.atas! - x.bawah!) / x.nett)
    assert.ok(lebar[1] > lebar[0])
    assert.ok(lebar[2] > lebar[1])
  })

  test('tanpa MAPE, rentang dikirim null — bukan angka palsu', () => {
    const r = ramal(deret(12, 1000, 100), 1, null)
    assert.equal(r[0].bawah, null)
    assert.equal(r[0].atas, null)
  })

  test('bulan BERJALAN dilewati — tidak menabrak sales_projection', () => {
    // ⚠️ Regresi yang baru ketahuan saat live-check 20 Agu 2026: riwayat berakhir
    // di bulan penuh terakhir (Juli), jadi langkah-1 jatuh ke Agustus — bulan
    // yang sedang berjalan — dan memberi angka yang bertabrakan dengan proyeksi
    // dari transaksi Agustus yang SUDAH terjadi (Rp 10,13 M vs Rp 8,17 M).
    const riwayat = deret(12, 1000, 100) // berakhir 2025-12
    const r = ramal(riwayat, 2, 5, '2026-02') // bulan berjalan = 2026-01
    assert.deepEqual(r.map((x) => x.bulan), ['2026-02', '2026-03'])
  })

  test('melompati bulan berjalan tetap memperpanjang garisnya, bukan menggeser label', () => {
    const riwayat = deret(12, 1000, 100)
    const langsung = ramal(riwayat, 1, 5)
    const dilompati = ramal(riwayat, 1, 5, '2026-02')
    // Nilai bulan ke-2 harus lebih tinggi daripada bulan ke-1 pada tren naik —
    // kalau sama, berarti hanya labelnya yang diganti.
    assert.ok(dilompati[0].nett > langsung[0].nett)
  })

  test('rentang ikut melebar saat bulan berjalan dilompati', () => {
    const riwayat = deret(12, 1000, 100)
    const a = ramal(riwayat, 1, 10)[0]
    const b = ramal(riwayat, 1, 10, '2026-02')[0]
    assert.ok((b.atas! - b.bawah!) / b.nett > (a.atas! - a.bawah!) / a.nett)
  })

  test('tren menurun tidak pernah menghasilkan omzet negatif', () => {
    const r = ramal(deret(12, 1000, -200), 3, 10)
    assert.ok(r.every((x) => x.nett >= 0))
    assert.ok(r.every((x) => x.bawah === null || x.bawah >= 0))
  })
})

describe('akurasi historis (MAPE backtest)', () => {
  test('deret yang sangat teratur menghasilkan galat kecil', () => {
    const m = mapeBacktest(deret(24, 1000, 100).map((d) => d.nett))
    assert.ok(m !== null && m < 5, `MAPE=${m}`)
  })

  test('riwayat terlalu pendek = null, bukan angka yang dikarang', () => {
    // Menyajikan "akurasi 0%" untuk riwayat 3 bulan jauh lebih berbahaya
    // daripada mengaku belum bisa dihitung.
    assert.equal(mapeBacktest([100, 200, 300]), null)
  })

  test('deret acak menghasilkan galat besar — bukan disembunyikan', () => {
    const acak = [500, 120, 900, 300, 1500, 200, 1100, 250, 1400, 180, 1300, 260, 950, 210]
    const m = mapeBacktest(acak)
    assert.ok(m !== null && m > 20, `MAPE=${m}`)
  })
})

describe('proyeksi bulan berjalan', () => {
  // Kurva terukur 20 Agu 2026 pada 6 bulan penuh terakhir.
  const kurva = new Map([
    [5, 0.146],
    [10, 0.312],
    [15, 0.448],
    [20, 0.611],
    [25, 0.807],
    [28, 0.923]
  ])

  test('memakai kurva historis, bukan pro-rata hari', () => {
    const p = proyeksiBulanBerjalan(6_110_000_000, 20, 31, kurva)
    assert.equal(p.dasar, 'kurva historis')
    // 6,11 M / 0,611 = 10 M. Pro-rata naif (20/31) akan memberi 9,47 M —
    // selisih 5% pada angka yang dibawa ke rapat.
    assert.equal(Math.round(p.proyeksiNett / 1e8), 100)
  })

  test('jatuh ke pro-rata bila tanggalnya tidak ada di kurva', () => {
    const p = proyeksiBulanBerjalan(1_000_000, 7, 31, kurva)
    assert.equal(p.dasar, 'pro-rata hari')
  })

  test('porsi nyaris nol tidak meledakkan proyeksi', () => {
    // Pembagian dengan porsi 0,001 menghasilkan angka raksasa — persis jenis
    // angka meyakinkan yang paling berbahaya.
    const p = proyeksiBulanBerjalan(1_000_000, 1, 31, new Map([[1, 0.0005]]))
    assert.equal(p.dasar, 'pro-rata hari')
    assert.ok(p.proyeksiNett < 100_000_000)
  })
})

describe('momentum item', () => {
  test('naik, turun, dan datar dibedakan', () => {
    assert.equal(momentum([100, 110, 120, 130, 140, 150]).arah, 'naik')
    assert.equal(momentum([150, 140, 130, 120, 110, 100]).arah, 'turun')
    assert.equal(momentum([100, 101, 100, 99, 100, 101]).arah, 'datar')
  })

  test('deret terlalu pendek ditandai "baru", bukan dipaksa punya arah', () => {
    assert.equal(momentum([100, 200]).arah, 'baru')
  })

  test('penyimpangan menangkap bulan terakhir yang ANEH', () => {
    // Tren naik rapi lalu jatuh — peringatan dini yang tidak terlihat pada
    // peringkat naik-turun biasa.
    const m = momentum([100, 110, 120, 130, 140, 60])
    assert.ok(m.penyimpangan !== null && m.penyimpangan < -30, String(m.penyimpangan))
  })

  test('item yang berhenti dijual terbaca TURUN (bulan kosong = 0)', () => {
    assert.equal(momentum([500, 480, 500, 0, 0, 0]).arah, 'turun')
  })
})

describe('harapan tren untuk bulan berjalan', () => {
  test('menjawab "bulan ini bagus atau jelek"', () => {
    // Proyeksi sendirian tidak berarti apa-apa; ia baru bermakna setelah
    // dibandingkan dengan yang seharusnya menurut tren.
    const h = harapanTren(deret(12, 1000, 100), '2026-01')
    assert.ok(h !== null && h > 2000, String(h))
  })

  test('bulan yang sudah ada di riwayat tidak diberi harapan', () => {
    assert.equal(harapanTren(deret(12, 1000, 100), '2025-06'), null)
  })

  test('riwayat terlalu pendek = null, bukan angka yang dikarang', () => {
    assert.equal(harapanTren(deret(3, 1000, 100), '2025-06'), null)
  })
})

describe('catatan hasil ramalan', () => {
  test('selalu menyebut akurasi & melarang mengarang sebab', () => {
    const c = catatanRamalan(6.9, 24)
    assert.match(c, /6\.9%/)
    assert.match(c, /PERKIRAAN/)
    assert.match(c, /musim/i)
  })

  test('riwayat pendek: mengaku belum bisa dihitung', () => {
    assert.match(catatanRamalan(null, 7), /belum bisa dihitung/)
  })
})

describe('pertanyaan ramalan memicu kelompok sales', () => {
  // Regresi 18 Agu 2026 dalam wujud baru: kalimat ramalan bisa tidak memuat satu
  // pun kata di SALES_HINT, dan tanpa pemicu ini toolnya tidak pernah terkirim.
  test('dikenali', () => {
    assert.ok(isSalesQuestion('prediksi penjualan bulan depan berapa'))
    assert.ok(isSalesQuestion('proyeksi tutup bulan ini'))
    assert.ok(isSalesQuestion('pemeriksaan apa yang diperkirakan naik'))
    assert.ok(isSalesQuestion('forecast omzet 3 bulan ke depan'))
  })

  test('kalimat umum berkata "perkiraan" tidak ikut terjaring', () => {
    assert.equal(isSalesQuestion('kira-kira jam berapa rapatnya'), false)
    assert.equal(isSalesQuestion('perkiraan cuaca besok bagaimana'), false)
  })
})

describe('batas riwayat minimal', () => {
  test('MIN_RIWAYAT cukup besar untuk tidak meramal dari 2-3 titik', () => {
    assert.ok(MIN_RIWAYAT >= 6)
  })
})
