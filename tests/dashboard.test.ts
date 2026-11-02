import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import {
  awalBulanMundur,
  bacaRentang,
  bulanBelumGenap,
  gabungBanding,
  perluDashboardSales,
  persenUbah,
  saranLanjutanSales,
  susunInsight
} from '../src/main/dashboard/rules'

describe('dashboard: kapan muncul', () => {
  test('pertanyaan perbandingan/ringkasan -> dashboard', () => {
    for (const k of [
      'Berapa sales bulan ini dibanding bulan lalu?',
      'Sales bulan ini dibandingkan bulan lalu gimana',
      'bandingkan penjualan minggu ini vs minggu lalu',
      'Ringkasan sales bulan lalu',
      'performa penjualan kuartal ini',
      'sales turun berapa persen dari bulan lalu?'
    ]) {
      assert.equal(perluDashboardSales(k), true, k)
    }
  })

  test('English comparison questions -> dashboard', () => {
    for (const k of ['Sales this month vs last month', 'Compare sales this month with last month', 'give me a sales overview', 'how did sales grow this year']) {
      assert.equal(perluDashboardSales(k), true, k)
    }
  })

  test('pertanyaan satu angka / daftar / dokumen -> TIDAK', () => {
    for (const k of [
      'Berapa sales hari ini?',
      'Berapa sales di Jawa Barat bulan ini?',
      'Pelanggan baru 90 hari terakhir siapa saja?',
      'Buatkan laporan penjualan bulan ini dibanding bulan lalu versi Excel',
      'halo'
    ]) {
      assert.equal(perluDashboardSales(k), false, k)
    }
  })
})

describe('dashboard: angka', () => {
  test('persen satu desimal; pembanding nol/kosong = null (bukan tak hingga)', () => {
    assert.equal(persenUbah(112.5, 100), 12.5)
    assert.equal(persenUbah(90, 100), -10)
    assert.equal(persenUbah(50, 0), null)
    assert.equal(persenUbah(50, null), null)
  })

  test('gabung dua periode: urutan ikut periode kini; yang tak ada di pembanding = null, BUKAN nol', () => {
    const r = gabungBanding(
      [
        { nama: 'RS A', nett: 200 },
        { nama: 'RS Baru', nett: 150 }
      ],
      [{ nama: 'RS A', nett: 100 }]
    )
    assert.deepEqual(r, [
      { nama: 'RS A', kini: 200, lalu: 100, persen: 100 },
      { nama: 'RS Baru', kini: 150, lalu: null, persen: null }
    ])
  })

  test('rentang, 6 bulan mundur (lintas tahun), bulan belum genap', () => {
    assert.deepEqual(bacaRentang('2026-09-01 s/d 2026-09-17'), { from: '2026-09-01', to: '2026-09-17' })
    assert.equal(bacaRentang('bulan ini'), null)
    assert.deepEqual(bacaRentang('2026-09-01 to 2026-09-17'), { from: '2026-09-01', to: '2026-09-17' })
    assert.equal(awalBulanMundur('2026-09-17', 5), '2026-04-01')
    assert.equal(awalBulanMundur('2026-02-10', 5), '2025-09-01')
    assert.equal(bulanBelumGenap('2026-09-17'), true)
    assert.equal(bulanBelumGenap('2026-08-31'), false)
    assert.equal(bulanBelumGenap('2026-02-28'), false)
  })
})

describe('dashboard: insight dari kode', () => {
  const dasar = {
    jenis: 'sales' as const,
    versi: 1 as const,
    dibuat: 0,
    basis: 'invoice',
    labelKini: 'this month',
    labelLalu: 'last month',
    rentangKini: '2026-09-01 s/d 2026-09-17',
    rentangLalu: '2026-08-01 s/d 2026-08-17',
    catatanPeriode: null,
    filter: [],
    kpi: { nettKini: 1_000_000_000, nettLalu: 800_000_000, selisih: 200_000_000, persen: 25, orderKini: 10, orderLalu: 8, pelangganKini: 5 },
    tren: [
      { bulan: 'Jun 2026', nett: 9e9, sebagian: false },
      { bulan: 'Jul 2026', nett: 9.9e9, sebagian: false },
      { bulan: 'Agu 2026', nett: 9.4e9, sebagian: false },
      { bulan: 'Sep 2026', nett: 1e9, sebagian: true }
    ],
    kategori: [{ nama: 'Molekuler', kini: 400_000_000, lalu: 300_000_000, persen: 33.3 }],
    pelanggan: [
      { nama: 'RS A', kini: 100_000_000, lalu: 90_000_000, persen: 11.1 },
      { nama: 'RS B', kini: 80_000_000, lalu: 40_000_000, persen: 100 }
    ],
    wilayah: [
      { nama: '(pelanggan tidak ada di master)', kini: 500_000_000, lalu: null, persen: null },
      { nama: 'Jawa Barat', kini: 300_000_000, lalu: 250_000_000, persen: 20 }
    ],
    gagal: []
  }

  test('setiap kalimat memakai angka yang ADA di data', () => {
    const k = susunInsight(dasar)
    assert.match(k[0], /up 25% vs last month/)
    assert.ok(k.some((x) => /Molekuler — 40% of total nett/.test(x)), k.join(' | '))
    // Baris "(…tidak ada di master)" bukan wilayah — yang disebut Jawa Barat.
    assert.ok(k.some((x) => /Largest contributing region: Jawa Barat \(30%\)/.test(x)), k.join(' | '))
    assert.ok(k.some((x) => /RS B \(\+100%\)/.test(x)), k.join(' | '))
    // Bulan berjalan (sebagian) TIDAK boleh jadi "bulan tertinggi".
    assert.ok(k.some((x) => /Jul 2026/.test(x)), k.join(' | '))
  })

  test('saran lanjutan hanya pertanyaan yang ada tool-nya', () => {
    const s = saranLanjutanSales('this month')
    assert.ok(s.length >= 4)
    assert.ok(!s.some((x) => /detail transaksi|nama pasien/i.test(x)))
  })
})

describe('dashboard: pengaman struktural', () => {
  test('ketiga pengumpul data BERURUTAN (tanpa Promise.all) — pool database max: 1', () => {
    for (const f of ['sales', 'lab', 'inno']) {
      const src = readFileSync(`src/main/dashboard/${f}.ts`, 'utf8')
      assert.ok(!/Promise\.all/.test(src.replace(/\/\/.*$/gm, '')), f)
    }
    assert.match(readFileSync('src/main/dashboard/sales.ts', 'utf8'), /getTool\(nama\)/)
    assert.match(readFileSync('src/main/dashboard/inno.ts', 'utf8'), /getTool\('inno_special_price'\)/)
  })

  test('tiap dashboard dijaga MODE-nya sendiri + argumen dari tool model di giliran itu', () => {
    const src = readFileSync('src/main/agent/orchestrator.ts', 'utf8')
    assert.match(src, /mode === 'sales' && runState\.argsSales && perbandingan/)
    assert.match(src, /mode === 'lab' && runState\.argsLab && perbandingan/)
    assert.match(src, /mode === 'masterdata' && \(runState\.pelangganSp\?\.length \?\? 0\) >= 2 && perbandingan/)
  })
})

// ------------------------------------------------------------ pembanding dari kalimat
import { applyComparePeriod } from '../src/main/sales/pembanding'

describe('sales_compare: pembanding ditentukan kalimat user', () => {
  test('"dibanding bulan lalu" -> last_month (bukan 29 hari sebelumnya)', () => {
    assert.deepEqual(
      applyComparePeriod('sales_compare', { period: 'this_month' }, 'Berapa sales bulan ini dibanding bulan lalu?'),
      { period: 'this_month', comparePeriod: 'last_month' }
    )
  })
  test('minggu lalu, kemarin, tahun lalu', () => {
    assert.equal(applyComparePeriod('sales_compare', { period: 'this_week' }, 'minggu ini vs minggu lalu').comparePeriod, 'last_week')
    assert.equal(applyComparePeriod('sales_compare', { period: 'today' }, 'hari ini dibanding kemarin').comparePeriod, 'yesterday')
    assert.equal(applyComparePeriod('sales_compare', { period: 'this_year' }, 'tahun ini vs tahun lalu').comparePeriod, 'last_year')
  })
  test('pilihan model TIDAK ditimpa; tool lain & kalimat tanpa pasangan tidak disentuh', () => {
    const a = { period: 'this_month', comparePeriod: 'last_year' }
    assert.deepEqual(applyComparePeriod('sales_compare', a, 'dibanding bulan lalu'), a)
    assert.deepEqual(applyComparePeriod('sales_summary', { period: 'this_month' }, 'bulan lalu'), { period: 'this_month' })
    assert.deepEqual(applyComparePeriod('sales_compare', { period: 'this_month' }, 'sales naik?'), { period: 'this_month' })
  })
})

test('dashboard row markers from the region query read in English', async () => {
  const { labelData } = await import('../src/main/sales/display-en')
  assert.equal(labelData('(pelanggan tidak ada di master)'), '(customer not in master)')
  assert.equal(labelData('(provinsi tidak diisi)'), '(province not filled in)')
  assert.equal(labelData('(tipe tidak diisi)'), '(type not filled in)')
  assert.equal(labelData('Jawa Barat'), 'Jawa Barat')
  const s = (await import('fs')).readFileSync('src/main/dashboard/sales.ts', 'utf8')
  assert.match(s, /nama: labelData\(r\.kategori/)
  assert.doesNotMatch((await import('fs')).readFileSync('src/renderer/src/components/DashboardJawaban.tsx', 'utf8'), /`Rp /)
})
