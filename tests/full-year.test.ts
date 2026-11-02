import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { BEError, catatanBE, susunBE } from '../src/main/sales/full-year'
import { groupOf } from '../src/main/agent/tool-groups'
import { TOOL_BERVISUAL, visualDariHasil } from '../src/main/visual/sales'

// Best Estimate setahun (30 Sep 2026, BE = Best Estimate — dikonfirmasi user).

const bulan = (tahun: number, dari: number, sampai: number, nilai: (m: number) => number) =>
  Array.from({ length: sampai - dari + 1 }, (_, i) => ({ bulan: `${tahun}-${String(dari + i).padStart(2, '0')}`, nett: nilai(dari + i) }))
const riwayat = [...bulan(2025, 1, 12, (m) => 4e9 + m * 1e8), ...bulan(2026, 1, 8, (m) => 8e9 + m * 1e8)]

describe('Best Estimate setahun', () => {
  test('30 Sep: aktual Jan–Agu + proyeksi Sep + ramalan Okt–Des, dijumlah kode', () => {
    const h = susunBE({ tahun: 2026, hariIni: '2026-09-30', riwayat, proyeksiBulanIni: 9.5e9, dasarProyeksi: 'kurva historis', mape: 6.9 })
    assert.equal(h.jenis, 'best_estimate')
    assert.equal(h.aktual.length, 8)
    assert.deepEqual(h.ramalan.map((r) => r.bulan), ['2026-10', '2026-11', '2026-12'])
    const harap = h.totalAktual + 9.5e9 + h.ramalan.reduce((s, r) => s + r.nett, 0)
    assert.equal(h.be, harap)
    assert.ok((h.bawah as number) < (h.be as number) && (h.atas as number) > (h.be as number))
    assert.equal(h.fullYearLalu, riwayat.slice(0, 12).reduce((s, t) => s + t.nett, 0))
    assert.ok(h.pertumbuhanPersen !== null)
  })

  test('sisa tahun > 3 bulan: BE TIDAK dihitung dan alasannya disebut (batas horizon aturan 22)', () => {
    const h = susunBE({ tahun: 2026, hariIni: '2026-06-15', riwayat: riwayat.slice(0, 17), proyeksiBulanIni: 8e9, dasarProyeksi: 'kurva historis', mape: 6.9 })
    assert.equal(h.jenis, 'tidak_lengkap')
    assert.equal(h.be, null)
    assert.deepEqual(h.takDiramal, ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'])
    assert.match(catatanBE(h), /melewati batas ramalan 3 bulan/)
    assert.match(catatanBE(h), /JANGAN menaksir sendiri/)
  })

  test('Desember: tidak ada sisa bulan, BE = aktual + proyeksi Desember', () => {
    const r = [...bulan(2025, 1, 12, () => 5e9), ...bulan(2026, 1, 11, () => 6e9)]
    const h = susunBE({ tahun: 2026, hariIni: '2026-12-10', riwayat: r, proyeksiBulanIni: 7e9, dasarProyeksi: 'kurva historis', mape: 5 })
    assert.equal(h.jenis, 'best_estimate')
    assert.equal(h.ramalan.length, 0)
    assert.equal(h.be, 66e9 + 7e9)
  })

  test('tahun lalu = REALISASI, bukan perkiraan; tahun depan ditolak', () => {
    const h = susunBE({ tahun: 2025, hariIni: '2026-09-30', riwayat, proyeksiBulanIni: null, dasarProyeksi: null, mape: 6.9 })
    assert.equal(h.jenis, 'realisasi')
    assert.equal(h.be, h.totalAktual)
    assert.throws(() => susunBE({ tahun: 2027, hariIni: '2026-09-30', riwayat, proyeksiBulanIni: null, dasarProyeksi: null, mape: null }), BEError)
  })

  test('bulan tanpa data disebut, tidak dianggap nol diam-diam', () => {
    const bolong = riwayat.filter((t) => t.bulan !== '2026-03')
    const h = susunBE({ tahun: 2026, hariIni: '2026-09-30', riwayat: bolong, proyeksiBulanIni: 9e9, dasarProyeksi: 'kurva historis', mape: 6.9 })
    assert.deepEqual(h.bulanKosong, ['2026-03'])
    assert.match(catatanBE(h), /2026-03/)
  })

  test('catatan menegaskan BE bukan target/budget', () => {
    const h = susunBE({ tahun: 2026, hariIni: '2026-09-30', riwayat, proyeksiBulanIni: 9.5e9, dasarProyeksi: 'kurva historis', mape: 6.9 })
    assert.match(catatanBE(h), /BUKAN target\/budget/)
  })
})

describe('sales_full_year: kelompok tool & kartu', () => {
  test('masuk kelompok SALES — tidak pernah terkirim di Task Baru (aturan 17)', () => {
    assert.equal(groupOf('sales_full_year'), 'sales')
  })

  test('kartu: bulan aktual utuh, proyeksi & ramalan bertanda perkiraan; rentang ikut', () => {
    assert.ok(TOOL_BERVISUAL.includes('sales_full_year'))
    const k = visualDariHasil('sales_full_year', JSON.stringify({
      tahun: 2026, jenis: 'best_estimate', basis: 'invoice', sampaiTanggal: '2026-09-30', bestEstimate: 110e9, rentangBawah: 106e9, rentangAtas: 114e9,
      totalAktual: 70e9, aktualPerBulan: [{ bulan: '2026-07', nett: 9e9 }, { bulan: '2026-08', nett: 9.4e9 }],
      proyeksiBulanBerjalan: { bulan: '2026-09', nett: 9.6e9, dasar: 'kurva historis' },
      ramalanSisaBulan: [{ bulan: '2026-10', nett: 10e9, rentangBawah: 9.3e9, rentangAtas: 10.7e9 }],
      bulanTakDiramal: [], bulanKosong: [], fullYearTahunLalu: 60e9, pertumbuhanVsTahunLaluPersen: 83.3, akurasiHistorisPersen: 6.9
    }))!
    const kpi = k.panel[0]
    assert.ok(kpi.jenis === 'kpi')
    assert.equal(kpi.item[0].nilai, 110e9)
    assert.match(String(kpi.item[0].catatan), /range/)
    const d = k.panel[1]
    assert.ok(d.jenis === 'deret')
    assert.deepEqual(d.titik.map((t) => !!t.perkiraan), [false, false, true, true])
    assert.ok(k.catatan.some((c) => /not a target/.test(c)))
  })
})
