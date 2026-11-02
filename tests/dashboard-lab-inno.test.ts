import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  bandingHarga,
  gabungTat,
  geserHari,
  insightLab,
  kalimatSelisihHari,
  periodeBanding,
  saranLab,
  type BarisHarga
} from '../src/main/dashboard/rules-lab-inno'

// Dashboard perbandingan TAT Sample & Master Data (30 Sep 2026).

describe('periode pembanding TAT', () => {
  test('tanpa tanggal: bulan ini s/d hari ini vs bulan lalu pada tanggal yang sama', () => {
    const p = periodeBanding({}, '2026-09-30')
    assert.deepEqual(p.kini, { dari: '2026-09-01', sampai: '2026-09-30' })
    assert.deepEqual(p.lalu, { dari: '2026-08-01', sampai: '2026-08-30' })
  })

  test('bulan pendek: tanggal dipotong ke akhir bulan pembanding (31 Mar -> 28 Feb)', () => {
    const p = periodeBanding({ dari: '2026-03-01', sampai: '2026-03-31' }, '2026-04-02')
    assert.deepEqual(p.lalu, { dari: '2026-02-01', sampai: '2026-02-28' })
  })

  test('Januari -> Desember tahun sebelumnya', () => {
    assert.deepEqual(periodeBanding({ dari: '2026-01-01', sampai: '2026-01-15' }, '2026-01-15').lalu, { dari: '2025-12-01', sampai: '2025-12-15' })
  })

  test('minggu penuh yang sudah lewat -> 7 hari tepat sebelumnya', () => {
    const p = periodeBanding({ dari: '2026-09-21', sampai: '2026-09-27' }, '2026-09-30')
    assert.deepEqual(p.lalu, { dari: '2026-09-14', sampai: '2026-09-20' })
    assert.match(p.cara, /7 days immediately before/)
  })

  test('"minggu ini" yang melewati hari ini: dipotong ke hari ini, pembanding hari yang SAMA (layar 30 Sep)', () => {
    const p = periodeBanding({ dari: '2026-09-28', sampai: '2026-10-04' }, '2026-09-30')
    assert.deepEqual(p.kini, { dari: '2026-09-28', sampai: '2026-09-30' })
    assert.deepEqual(p.lalu, { dari: '2026-09-21', sampai: '2026-09-23' })
    assert.match(p.cara, /first 3 days/)
  })

  test('"bulan ini" sampai akhir bulan yang belum tiba: dipotong ke hari ini', () => {
    const p = periodeBanding({ dari: '2026-09-01', sampai: '2026-09-30' }, '2026-09-12')
    assert.deepEqual(p.kini, { dari: '2026-09-01', sampai: '2026-09-12' })
    assert.deepEqual(p.lalu, { dari: '2026-08-01', sampai: '2026-08-12' })
  })

  test('tanggal rusak dari model diabaikan (bukan dipakai)', () => {
    assert.deepEqual(periodeBanding({ dari: 'bulan ini', sampai: 12 }, '2026-09-10').kini, { dari: '2026-09-01', sampai: '2026-09-10' })
  })

  test('geserHari melewati batas bulan/tahun', () => {
    assert.equal(geserHari('2026-03-01', -1), '2026-02-28')
    assert.equal(geserHari('2025-12-31', 1), '2026-01-01')
  })
})

describe('TAT: turun = lebih baik, kosong bukan nol', () => {
  test('kalimat selisih', () => {
    assert.equal(kalimatSelisihHari(3.2, 3.8), '0.6 days faster')
    assert.equal(kalimatSelisihHari(4, 3.5), '0.5 days slower')
    assert.equal(kalimatSelisihHari(2, 2), 'same')
    assert.equal(kalimatSelisihHari(null, 2), '—')
  })

  test('gabungTat: kategori yang tidak ada di pembanding = null, bukan 0', () => {
    const g = gabungTat([{ kelompok: 'Histologi', n: 40, median: 5 }, { kelompok: 'Baru', n: 3, median: 2 }], [{ kelompok: 'Histologi', n: 35, median: 6 }])
    assert.deepEqual(g.map((x) => x.medianLalu), [6, null])
  })

  test('insight: kategori terlama wajib bervolume cukup; perlambatan terbesar disebut', () => {
    const h = insightLab({
      medianKini: 3.2,
      medianLalu: 3.8,
      selesaiKini: 100,
      selesaiLalu: 90,
      orderKini: 120,
      orderLalu: 100,
      perKategori: [
        { kategori: 'Kecil', nKini: 2, medianKini: 20, medianLalu: 1 },
        { kategori: 'Histologi', nKini: 40, medianKini: 6, medianLalu: 4 },
        { kategori: 'Sitologi', nKini: 30, medianKini: 2, medianLalu: 3 }
      ],
      backlogPerStatus: [{ sample_status: 'Preparasi', order: 5, umur_tertua: 40 }],
      rnsKini: 4,
      rnsLalu: 2,
      rnsMenunggu: 1
    })
    assert.match(h[0], /3\.2 days — 0\.6 days faster/)
    assert.match(h[1], /Incoming orders rose 20%/)
    assert.ok(h.some((x) => /longest median TAT: Histologi/.test(x)), 'kategori 2 sampel tidak boleh jadi "terlama"')
    assert.ok(h.some((x) => /Largest slowdown: Histologi — 2 days slower/.test(x)))
    assert.ok(h.some((x) => /Current backlog/.test(x)))
  })

  test('saran lanjutan tidak menjanjikan backlog masa lalu', () => {
    assert.ok(saranLab().every((q) => !/minggu lalu|bulan lalu/i.test(q)))
  })
})

describe('Master Data: perbandingan special price dua pelanggan', () => {
  const r = (kodeItem: string, kodeKategori: string, harga: number | null): BarisHarga => ({ kodeItem, item: kodeItem, kategori: kodeKategori === '2' ? 'BPJS' : 'Special Price', kodeKategori, harga })

  test('dicocokkan per item DAN kategori: BPJS A tidak dibandingkan dengan Special Price B', () => {
    const h = bandingHarga([r('X', '2', 100), r('Y', '1', 200), r('Z', '1', 50)], [r('X', '1', 150), r('Y', '1', 180), r('Z', '1', 50)])
    assert.deepEqual(h.sama.map((x) => x.item), ['Y', 'Z'])
    assert.equal(h.aLebihMurah, 0)
    assert.equal(h.bLebihMurah, 1)
    assert.equal(h.setara, 1)
    assert.deepEqual(h.hanyaA.map((x) => `${x.kodeItem}|${x.kodeKategori}`), ['X|2'])
    assert.deepEqual(h.hanyaB.map((x) => `${x.kodeItem}|${x.kodeKategori}`), ['X|1'])
  })

  test('harga kosong tidak dihitung lebih murah/mahal', () => {
    const h = bandingHarga([r('A', '1', null)], [r('A', '1', 100)])
    assert.equal(h.aLebihMurah + h.bLebihMurah + h.setara, 0)
    assert.equal(h.sama.length, 1)
  })
})
