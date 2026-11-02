import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { DatabaseSync } from 'node:sqlite'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import PemantauPanel from '../src/renderer/src/components/PemantauPanel'
import { IPC_CHANNELS, PEMICU_PEMANTAU, type PemicuId } from '../src/shared/ipc'
import { DDL_PEMANTAU, buatPenyimpanan, type SaklarConfig } from '../src/main/pemantau/simpan'
import {
  keadaanPemantau,
  periksaPemantau,
  periksaSekarang,
  setelPemicu,
  type Dependensi,
  type SesiPemantau
} from '../src/main/pemantau/service'
import type { AksiPemantau } from '../src/shared/ipc'
import { aksiBoleh, langkahGulir, waktuRingkas } from '../src/renderer/src/components/pemantau-bantu'
import { buatPegangan } from '../src/main/notify-pegang'
import {
  AMBANG_DATA_SALES_JAM,
  AMBANG_DATA_TAT_JAM,
  LAB_JENDELA_HARI,
  LAB_PERSENTIL,
  LAB_UMUR_MAKS_HARI,
  MAKS_RIWAYAT,
  RINGKAS_GAGAL,
  RINGKAS_SAMPEL_KOSONG,
  SALES_RASIO_ANJLOK,
  SALES_RASIO_LIBUR,
  SALES_SUSULAN_HARI_KERJA,
  bolehDiperiksaManual,
  hariBelumDinilai,
  hariDinilai,
  jatuhTempo,
  jedaAcakMs,
  kabarDataMacet,
  kabarSales,
  kabarSampel,
  kalimatAturan,
  median,
  nilaiSalesAnjlok,
  putuskanDataMacet,
  putuskanSampel,
  ringkasDataMacet,
  ringkasSales,
  ringkasSampel,
  tambahHari,
  tanggalPembanding,
  tidakDipantau,
  umurTanpaMinggu,
  waktuMasaDepan,
  type PenilaianSales
} from '../src/main/pemantau/rules'
import {
  KOLOM_SALES_DIBACA,
  SQL_KATEGORI_BACKLOG,
  SQL_KESEGARAN_SALES,
  SQL_KESEGARAN_TAT,
  SQL_NETT_HARIAN,
  SQL_ORDER_HARIAN,
  SQL_SAMPEL_LEWAT_BATAS
} from '../src/main/pemantau/sql'
import { RECOGNIZED_CLAUSE } from '../src/main/sales/recognition'
import { rupiah } from '../src/main/sales/report'
import { BACKLOG_CLAUSE, DIAKUI_CLAUSE, JANGKAR_UMUR, KOLOM_AMAN } from '../src/main/lab/rules'

// Pemantau proaktif (20 Okt 2026) — pemeriksaan berkala yang HANYA MEMBACA lalu memberi
// tahu. Rancangan & keputusan user: RANCANGAN-PEMANTAU.md. Angka ambang datang dari
// konstanta `pemantau/rules.ts`; test ini mengunci perilakunya, bukan angkanya saja.

// Semua tanggal lokal (zona waktu laptop), sama seperti penjadwal Jadwal.
// 19 Okt 2026 = Senin, 24 Okt = Sabtu, 25 Okt = Minggu.
const t = (y: number, mo: number, d: number, h = 0, mi = 0): Date => new Date(y, mo - 1, d, h, mi)
const kosong = { nilai: null, diperiksa: null }

describe('pemantau: jatuh tempo', () => {
  test('data macet hanya 08.00 sampai sebelum 18.00', () => {
    assert.equal(jatuhTempo('data_tat', t(2026, 10, 20, 7, 59), 0, kosong, '2026-10-20'), false)
    assert.equal(jatuhTempo('data_tat', t(2026, 10, 20, 8, 0), 0, kosong, '2026-10-20'), true)
    assert.equal(jatuhTempo('data_tat', t(2026, 10, 20, 18, 0), 0, kosong, '2026-10-20'), false)
  })

  test('Sabtu: TAT dicek, data Sales tidak; Minggu: tidak ada', () => {
    assert.equal(jatuhTempo('data_tat', t(2026, 10, 24, 10), 0, kosong, '2026-10-24'), true)
    assert.equal(jatuhTempo('data_sales', t(2026, 10, 24, 10), 0, kosong, '2026-10-24'), false)
    for (const id of PEMICU_PEMANTAU) {
      assert.equal(jatuhTempo(id, t(2026, 10, 25, 10), 0, kosong, '2026-10-25'), false, id)
    }
  })

  test('diulang paling cepat tiap 60 menit', () => {
    const p = { nilai: null, diperiksa: t(2026, 10, 20, 10, 0).getTime() }
    assert.equal(jatuhTempo('data_sales', t(2026, 10, 20, 10, 59), 0, p, '2026-10-20'), false)
    assert.equal(jatuhTempo('data_sales', t(2026, 10, 20, 11, 0), 0, p, '2026-10-20'), true)
  })

  test('waktu periksa di MASA DEPAN (jam laptop melompat mundur) = jatuh tempo, bukan "baru saja diperiksa"', () => {
    // Temuan review akhir: tanpa ini pemeriksaan menunggu sampai jam menyusul — bisa sehari penuh.
    const besok = { nilai: null, diperiksa: t(2026, 10, 21, 10, 0).getTime() }
    assert.equal(jatuhTempo('data_tat', t(2026, 10, 20, 11, 0), 0, besok, '2026-10-20'), true)
    const setengahJamLagi = { nilai: null, diperiksa: t(2026, 10, 20, 11, 30).getTime() }
    assert.equal(jatuhTempo('data_sales', t(2026, 10, 20, 11, 0), 0, setengahJamLagi, '2026-10-20'), true)
  })

  test('jeda acak menggeser awal jam kerja', () => {
    assert.equal(jatuhTempo('data_tat', t(2026, 10, 20, 8, 5), 9 * 60_000, kosong, '2026-10-20'), false)
    assert.equal(jatuhTempo('data_tat', t(2026, 10, 20, 8, 10), 9 * 60_000, kosong, '2026-10-20'), true)
  })

  test('sampel: mulai 09.00, selesai bila sukses hari ini, diulang tiap jam bila belum', () => {
    assert.equal(jatuhTempo('sampel_terlambat', t(2026, 10, 20, 8, 59), 0, kosong, '2026-10-20'), false)
    assert.equal(jatuhTempo('sampel_terlambat', t(2026, 10, 20, 9, 0), 0, kosong, '2026-10-20'), true)
    const sukses = { nilai: t(2026, 10, 20, 9, 1).toISOString(), diperiksa: t(2026, 10, 20, 9, 1).getTime() }
    assert.equal(jatuhTempo('sampel_terlambat', t(2026, 10, 20, 11, 0), 0, sukses, '2026-10-20'), false)
    const kemarin = { nilai: t(2026, 10, 19, 9, 1).toISOString(), diperiksa: t(2026, 10, 20, 9, 30).getTime() }
    assert.equal(jatuhTempo('sampel_terlambat', t(2026, 10, 20, 10, 0), 0, kemarin, '2026-10-20'), false)
    assert.equal(jatuhTempo('sampel_terlambat', t(2026, 10, 20, 10, 30), 0, kemarin, '2026-10-20'), true)
  })

  test('sales: mulai 10.00, hanya bila hari yang dinilai belum dinilai', () => {
    assert.equal(jatuhTempo('sales_anjlok', t(2026, 10, 20, 9, 59), 0, kosong, '2026-10-20'), false)
    assert.equal(jatuhTempo('sales_anjlok', t(2026, 10, 20, 10, 0), 0, kosong, '2026-10-20'), true)
    const sudah = { nilai: '2026-10-19', diperiksa: null }
    assert.equal(jatuhTempo('sales_anjlok', t(2026, 10, 20, 10, 0), 0, sudah, '2026-10-20'), false)
    const lama = { nilai: '2026-10-17', diperiksa: null }
    assert.equal(jatuhTempo('sales_anjlok', t(2026, 10, 20, 10, 0), 0, lama, '2026-10-20'), true)
  })
})

describe('pemantau: pemeriksaan manual ("Periksa sekarang")', () => {
  // Temuan review akhir: tanpa ini, tombol memicu alarm palsu data Sales di akhir pekan
  // (ETL Sabtu tidak teratur) dan menilai sales sebelum 10.00 dengan data belum lengkap.
  test('mengikuti hari & jam mulai tiap pemicu, tapi tidak jam selesai', () => {
    assert.equal(bolehDiperiksaManual('data_sales', t(2026, 10, 24, 11)), false)
    assert.equal(bolehDiperiksaManual('data_tat', t(2026, 10, 24, 11)), true)
    for (const id of PEMICU_PEMANTAU) assert.equal(bolehDiperiksaManual(id, t(2026, 10, 25, 11)), false, id)
    assert.equal(bolehDiperiksaManual('sales_anjlok', t(2026, 10, 20, 9, 30)), false)
    assert.equal(bolehDiperiksaManual('sampel_terlambat', t(2026, 10, 20, 9, 30)), true)
    for (const id of PEMICU_PEMANTAU) assert.equal(bolehDiperiksaManual(id, t(2026, 10, 20, 19, 0)), true, id)
  })
})

describe('pemantau: tanggal', () => {
  test('hari yang dinilai: Selasa→Senin, Senin→Sabtu, Minggu→Sabtu', () => {
    assert.equal(hariDinilai('2026-10-20'), '2026-10-19')
    assert.equal(hariDinilai('2026-10-19'), '2026-10-17')
    assert.equal(hariDinilai('2026-10-25'), '2026-10-24')
  })

  test('pembanding = 4 hari yang sama sebelumnya', () => {
    assert.deepEqual(tanggalPembanding('2026-10-19'), ['2026-10-12', '2026-10-05', '2026-09-28', '2026-09-21'])
  })

  test('tambahHari melewati batas bulan', () => assert.equal(tambahHari('2026-10-31', 1), '2026-11-01'))

  // Susulan (22 Okt 2026, pilihan user): Sabtu sering tanpa baris baru sebelum 18.00, jadi Jumat
  // menunggu sinkronisasi — dan Senin dulu langsung menilai Sabtu. Replay 63 hari kerja (7 Agu–19 Okt):
  // 6 hari tidak pernah dinilai (Jumat 4 Sep, 11 Sep, 25 Sep, 2 Okt, 16 Okt + Sen 24 Agu).
  test('antrean sales: Senin menilai Jumat yang tertinggal dulu, baru Sabtu', () => {
    assert.deepEqual(hariBelumDinilai('2026-10-19', '2026-10-15'), ['2026-10-16', '2026-10-17'])
    assert.deepEqual(hariBelumDinilai('2026-10-19', '2026-10-16'), ['2026-10-17'])
    assert.deepEqual(hariBelumDinilai('2026-10-19', '2026-10-17'), [])
  })

  test('antrean sales: paling jauh 3 hari kerja ke belakang, hari Minggu tidak dihitung', () => {
    // Sel 20 Okt: Jum 16, Sab 17, Sen 19 — Kam 15 sudah di luar batas.
    assert.deepEqual(hariBelumDinilai('2026-10-20', '2026-10-14'), ['2026-10-16', '2026-10-17', '2026-10-19'])
    // Rab 21 Okt, penanda jauh di belakang (laptop lama mati): tetap hanya Sab 17, Sen 19, Sel 20.
    assert.deepEqual(hariBelumDinilai('2026-10-21', '2026-10-01'), ['2026-10-17', '2026-10-19', '2026-10-20'])
  })

  test('antrean sales: penanda kosong (user baru / saklar dinyalakan ulang) = hanya hari kerja terakhir', () => {
    // Janji saklar: dinyalakan ulang = keadaan SAAT ITU, bukan menyusul hari-hari sebelumnya.
    assert.deepEqual(hariBelumDinilai('2026-10-19', null), ['2026-10-17'])
    assert.deepEqual(hariBelumDinilai('2026-10-20', null), ['2026-10-19'])
  })

  test('kanal pemantau terdaftar', () => {
    assert.equal(IPC_CHANNELS.pemantauStatus, 'pemantau:status')
    assert.equal(IPC_CHANNELS.pemantauSetel, 'pemantau:setel')
    assert.equal(IPC_CHANNELS.pemantauPeriksa, 'pemantau:periksa')
    assert.equal(IPC_CHANNELS.pemantauBuka, 'pemantau:buka')
    assert.equal(IPC_CHANNELS.pemantauBerubah, 'pemantau:berubah')
  })

  test('jeda acak 0 sampai 10 menit', () => {
    assert.equal(jedaAcakMs(() => 0), 0)
    assert.ok(jedaAcakMs(() => 0.999999) <= 600_000)
  })
})

// ------------------------------------------------------------ keputusan & teks

// Angka contoh dari data nyata 8 Okt (Molekuler 43 terlambat, p90 9,3 hari).
const B = [
  { category: 'Molekuler', batas_hari: 9.3, terlambat: 43, baru: 5 },
  { category: 'Histologi', batas_hari: 6, terlambat: 5, baru: 2 },
  { category: 'HPV DNA & LBC', batas_hari: 3.2, terlambat: 0, baru: 0 }
]
const D = '2026-10-19'
const P = ['2026-10-12', '2026-10-05', '2026-09-28', '2026-09-21']
const rek = (kini: number, lalu: number[]): Record<string, number> =>
  Object.fromEntries([[D, kini], ...P.map((p, i) => [p, lalu[i]])])
const ORDER_NORMAL = rek(300, [310, 290, 305, 295])

describe('pemantau: data macet', () => {
  test('lebih dari ambang, bukan sama dengan', () => {
    assert.equal(putuskanDataMacet({ terakhir: '2026-10-08 02:25', umurJam: 72 }, 72, null).macet, false)
    assert.deepEqual(putuskanDataMacet({ terakhir: '2026-10-08 02:25', umurJam: 72.1 }, 72, null), {
      macet: true,
      berbunyi: true
    })
  })

  test('kemacetan yang sama tidak berbunyi dua kali; macet baru berbunyi', () => {
    const k = { terakhir: '2026-10-08 02:25', umurJam: 296 }
    assert.equal(putuskanDataMacet(k, 72, '2026-10-08 02:25').berbunyi, false)
    assert.equal(putuskanDataMacet(k, 72, '2026-10-01 14:00').berbunyi, true)
  })

  test('umur tak terbaca bukan macet', () => {
    assert.deepEqual(putuskanDataMacet({ terakhir: null, umurJam: null }, 72, null), { macet: false, berbunyi: false })
  })

  test('umur data Sales: jam hari Minggu tidak dihitung, Sabtu tetap dihitung', () => {
    // "Sekarang" = terakhir + umur (jam database). 10 Okt 2026 = Sabtu, 18 Okt = Minggu.
    assert.equal(umurTanpaMinggu({ terakhir: '2026-10-10 13:20', umurJam: 42.8 }), 18.8) // Sab 13.20 → Sen 08.08
    assert.equal(umurTanpaMinggu({ terakhir: '2026-08-24 14:35', umurJam: 24.5 }), 24.5) // Sen → Sel, tanpa Minggu
    assert.equal(umurTanpaMinggu({ terakhir: '2026-10-18 12:00', umurJam: 20 }), 8) // Min 12.00 → Sen 08.00
    assert.equal(umurTanpaMinggu({ terakhir: '2026-10-16 17:00', umurJam: 63 }), 39) // Jum → Sen: Sabtu ikut
    assert.equal(umurTanpaMinggu({ terakhir: '2026-10-24 10:00', umurJam: 24 }), 14) // Sab 10.00 → Min 10.00
  })

  test('umur data Sales tak terbaca / di masa depan / nol dikembalikan apa adanya', () => {
    // Masa depan & tak terbaca = urusan status "gagal" (aturan 33), bukan aturan hari Minggu.
    assert.equal(umurTanpaMinggu({ terakhir: null, umurJam: null }), null)
    assert.equal(umurTanpaMinggu({ terakhir: '2026-10-25 18:30', umurJam: -7.5 }), -7.5)
    assert.equal(umurTanpaMinggu({ terakhir: '2026-10-25 10:00', umurJam: 0 }), 0)
  })

  test('umur 0 (baru saja ditulis, dibulatkan 0,1 jam) segar; umur negatif = waktu di masa depan', () => {
    assert.equal(waktuMasaDepan({ terakhir: '2026-10-20 14:56', umurJam: 0 }), false)
    assert.equal(waktuMasaDepan({ terakhir: '2026-10-20 15:10', umurJam: -0.1 }), true)
    assert.equal(waktuMasaDepan({ terakhir: null, umurJam: null }), false)
    assert.equal(ringkasDataMacet('tat', { terakhir: '2026-10-20 14:56', umurJam: 0 }, false), 'Last data Tue Oct 20 14:56 — normal.')
  })
})

describe('pemantau: sampel terlambat', () => {
  test('pemeriksaan pertama kali: total', () => {
    assert.deepEqual(putuskanSampel(B, true), { berbunyi: true, baru: 7, terlambat: 48 })
  })

  test('berikutnya: hanya yang baru', () => {
    assert.equal(putuskanSampel(B.map((b) => ({ ...b, baru: 0 })), false).berbunyi, false)
    assert.equal(putuskanSampel(B, false).berbunyi, true)
  })

  test('kategori tak terpantau beserta sebab', () => {
    const backlog = [
      { category: 'PK', di_lab: 0, backlog: 1056 },
      { category: 'Molekuler', di_lab: 237, backlog: 240 },
      { category: 'Zeta', di_lab: 3, backlog: 3 }
    ]
    assert.deepEqual(tidakDipantau(backlog, ['Molekuler']), [
      'PK (lab receipt time not recorded)',
      'Zeta (not enough completed-sample history)'
    ])
  })
})

describe('pemantau: sales anjlok', () => {
  test('median: ganjil = tengah, genap = rata-rata dua tengah', () => {
    assert.equal(median([3, 1, 2]), 2)
    assert.equal(median([417, 191, 383, 214]), 298.5)
  })

  test('data asli Senin 19 Okt: normal', () => {
    const p = nilaiSalesAnjlok(D, rek(348e6, [417e6, 191e6, 383e6, 214e6]), ORDER_NORMAL)
    assert.equal(p.hasil, 'normal')
    assert.equal(p.medianNett, 298.5e6)
    assert.deepEqual(p.pembanding, P)
  })

  test('di bawah 40% dan order normal berbunyi; tepat 40% tidak', () => {
    const lalu = [417e6, 191e6, 383e6, 214e6]
    assert.equal(nilaiSalesAnjlok(D, rek(0.3999 * 298.5e6, lalu), ORDER_NORMAL).hasil, 'berbunyi')
    assert.equal(nilaiSalesAnjlok(D, rek(0.4 * 298.5e6, lalu), ORDER_NORMAL).hasil, 'normal')
  })

  test('order di bawah 50% dianggap libur; tepat 50% bukan libur', () => {
    const nett = rek(30e6, [417e6, 191e6, 383e6, 214e6])
    assert.equal(nilaiSalesAnjlok(D, nett, rek(149, [310, 290, 305, 295])).hasil, 'libur')
    assert.equal(nilaiSalesAnjlok(D, nett, rek(150, [310, 290, 305, 295])).hasil, 'berbunyi')
  })

  test('pembanding bernilai kurang dari 3 hari: kurang data', () => {
    assert.equal(nilaiSalesAnjlok(D, rek(100e6, [400e6, 0, 0, 390e6]), ORDER_NORMAL).hasil, 'kurang_data')
  })

  test('pembanding berisi satu hari libur kecil: median tetap wajar', () => {
    // Review Focus 4: satu dari empat pembanding adalah hari libur (nett kecil tapi > 0).
    const p = nilaiSalesAnjlok(D, rek(380e6, [400e6, 410e6, 20e6, 390e6]), ORDER_NORMAL)
    assert.equal(p.medianNett, 395e6)
    assert.equal(p.hasil, 'normal')
  })

  test('median order dihitung dari tanggal yang SAMA dengan median nett', () => {
    // Temuan review akhir: dulu order punya himpunan tanggalnya sendiri, jadi "median order"
    // di rincian bukan median dari tanggal yang disebut di sana.
    // 5 Okt tanpa sales (nett 0): keluar dari KEDUA median.
    const p = nilaiSalesAnjlok(D, rek(348e6, [417e6, 0, 383e6, 214e6]), rek(300, [310, 100, 305, 295]))
    assert.deepEqual(p.pembanding, ['2026-10-12', '2026-09-28', '2026-09-21'])
    assert.equal(p.medianNett, 383e6)
    assert.equal(p.medianOrder, 305)
    // 28 Sep tanpa order: keluar dari median nett juga.
    const q = nilaiSalesAnjlok(D, rek(348e6, [417e6, 191e6, 383e6, 214e6]), rek(300, [310, 290, 0, 295]))
    assert.deepEqual(q.pembanding, ['2026-10-12', '2026-10-05', '2026-09-21'])
    assert.equal(q.medianNett, 214e6)
    assert.equal(q.medianOrder, 295)
  })

  test('ambang bisa diganti (mode uji dev) tanpa mengubah konstanta', () => {
    const p = nilaiSalesAnjlok(D, rek(348e6, [417e6, 191e6, 383e6, 214e6]), ORDER_NORMAL, 10)
    assert.equal(p.hasil, 'berbunyi')
  })
})

describe('pemantau: kabar (teks notifikasi)', () => {
  const kTat = kabarDataMacet('tat', { terakhir: '2026-10-08 02:25', umurJam: 296 })
  const kSales = kabarDataMacet('sales', { terakhir: '2026-10-19 22:46', umurJam: 36 })
  const kSampel = kabarSampel(B, false, ['PK (lab receipt time not recorded)'])
  const kPertama = kabarSampel(B, true, [])
  const pSales: PenilaianSales = {
    hasil: 'berbunyi',
    tanggal: D,
    nett: 96e6,
    order: 294,
    medianNett: 300e6,
    medianOrder: 300,
    rasioNett: 0.32,
    rasioOrder: 0.98,
    pembanding: P
  }
  const kAnjlok = kabarSales(pSales)

  test('data TAT macet 12 hari', () => {
    assert.equal(kTat.judul, 'Sample TAT data not updated for 12 days')
    assert.match(kTat.isi, /Thu Oct 8 02:25/)
    assert.match(kTat.isi, /late-sample monitor is on hold/)
    assert.deepEqual(kTat.aksi, { tujuan: 'panel' })
  })

  test('data Sales macet 36 jam menyebut kemungkinan libur', () => {
    assert.equal(kSales.judul, 'Sales data not updated for ~36 hours')
    // "Baris baru", bukan "terakhir diperbarui": updated_at tabel bisa lebih baru (retry bridging),
    // dan pelaksana yang memeriksa database tidak boleh mengira toast-nya salah.
    assert.match(kSales.isi, /^Last new row arrived Mon Oct 19 22:46\./)
    assert.match(kSales.isi, /it may be a holiday/)
  })

  test('sampel: judul, isi per kategori, aksi mengisi kotak TAT', () => {
    assert.equal(kSampel.judul, '7 lab samples newly past their normal limit')
    assert.equal(kSampel.isi, 'Molekuler 5 (> 9.3 days), Histologi 2 (> 6.0 days). Total late: 48.')
    assert.match(kSampel.rincian, /Not monitored: PK \(lab receipt time not recorded\)\./)
    assert.deepEqual(kSampel.aksi, {
      tujuan: 'menu',
      mode: 'lab',
      tanya: 'Show Molekuler samples that the lab has received but whose results are not out yet, oldest first'
    })
  })

  test('sampel pertama kali: total yang sedang terlambat', () => {
    assert.equal(kPertama.judul, '48 lab samples are currently past their normal limit')
    assert.equal(kPertama.isi, 'Molekuler 43 (> 9.3 days), Histologi 5 (> 6.0 days).')
  })

  test('sales anjlok: persen tanpa Rupiah, rincian ber-Rupiah, aksi mengisi kotak Sales', () => {
    assert.equal(kAnjlok.judul, 'Sales Mon Oct 19 dropped: 32% of usual')
    assert.equal(kAnjlok.isi, 'Orders received 98% of usual (did not drop with it). Click to dig in.')
    // Review akhir: order 55% bukan "normal" — kalimatnya tidak boleh menyebutnya begitu.
    const order55 = kabarSales({ ...pSales, rasioOrder: 0.55 })
    assert.doesNotMatch(order55.isi, /normal/i)
    assert.match(order55.isi, /55% of usual/)
    for (const s of [rupiah(96e6), rupiah(300e6), 'Monday', 'Oct 12, Oct 5, Sep 28, Sep 21']) {
      assert.ok(kAnjlok.rincian.includes(s), s)
    }
    assert.deepEqual(kAnjlok.aksi, {
      tujuan: 'menu',
      mode: 'sales',
      tanya: 'Compare sales on October 19, 2026 with October 12, 2026 by service category'
    })
  })

  test('rincian sales menyebut jumlah pembanding yang SEBENARNYA dipakai', () => {
    // Temuan review akhir: rincian selalu menulis "4 minggu" walau pembanding yang dipakai 3.
    assert.ok(
      kAnjlok.rincian.includes(`Median of the previous 4 Mondays (Oct 12, Oct 5, Sep 28, Sep 21): ${rupiah(300e6)}.`),
      kAnjlok.rincian
    )
    const tiga = kabarSales({ ...pSales, pembanding: ['2026-10-12', '2026-09-28', '2026-09-21'] })
    assert.ok(
      tiga.rincian.includes(
        `Median of the previous 3 Mondays (Oct 12, Sep 28, Sep 21; Oct 5 not used — sales or orders were zero): ${rupiah(300e6)}.`
      ),
      tiga.rincian
    )
    assert.doesNotMatch(tiga.rincian, /4 weeks|4 Mondays/)
  })

  test('toast tidak pernah memuat Rupiah, Order ID, atau kolom pasien', () => {
    // Layar bisa sedang dibagikan/diproyeksikan (pola chatPratinjau): rincian
    // berangka hanya di riwayat di dalam aplikasi.
    for (const k of [kTat, kSales, kSampel, kPertama, kAnjlok]) {
      assert.doesNotMatch(`${k.judul} ${k.isi}`, /Rp|IDR|\b\d{8,18}\b|patient/i, k.judul)
    }
  })
})

describe('pemantau: kalimat status & aturan', () => {
  test('status data macet', () => {
    assert.equal(ringkasDataMacet('tat', { terakhir: null, umurJam: null }, false), 'The data update time could not be read.')
    assert.equal(
      ringkasDataMacet('tat', { terakhir: '2026-10-08 02:25', umurJam: 296 }, true),
      'Not updated since Thu Oct 8 02:25 (12 days).'
    )
    assert.equal(
      ringkasDataMacet('tat', { terakhir: '2026-10-20 10:36', umurJam: 0.5 }, false),
      'Last data Tue Oct 20 10:36 — normal.'
    )
    assert.equal(RINGKAS_GAGAL, 'Check failed: the database could not be reached.')
  })

  test('status sampel: ditahan & berjalan', () => {
    assert.equal(
      ringkasSampel({ ditahanSejak: '2026-10-08 02:25' }),
      'On hold: TAT data not updated since Thu Oct 8 02:25.'
    )
    assert.equal(ringkasSampel({ ditahanSejak: null }), 'On hold: TAT data not updated.')
    assert.equal(
      ringkasSampel({ baru: 7, terlambat: 1048 }),
      '1,048 samples currently late; 7 new since the previous check.'
    )
  })

  test('status sales di tiap keadaan', () => {
    const dasar = { tanggal: D, nett: 0, order: 0, medianNett: 1, medianOrder: 1, pembanding: P }
    assert.equal(ringkasSales({ hasil: 'menunggu', tanggal: D }), 'Waiting for the Mon Oct 19 data sync.')
    assert.equal(
      ringkasSales({ ...dasar, hasil: 'kurang_data', rasioNett: null, rasioOrder: null }),
      'Mon Oct 19: fewer than 3 comparison days — not assessed.'
    )
    assert.equal(
      ringkasSales({ ...dasar, hasil: 'libur', rasioNett: 0.1, rasioOrder: 0.04 }),
      'Mon Oct 19: orders received only 4% of usual — treated as a holiday.'
    )
    assert.equal(
      ringkasSales({ ...dasar, hasil: 'normal', rasioNett: 1.166, rasioOrder: 0.98 }),
      'Mon Oct 19: 117% of usual (orders 98%) — normal.'
    )
    assert.equal(
      ringkasSales({ ...dasar, hasil: 'berbunyi', rasioNett: 0.32, rasioOrder: 0.98 }),
      'Mon Oct 19: 32% of usual — notified.'
    )
  })

})

// ----------------------------------------------------------------- SQL baca-saja

// Seluruh kolom public."SalesRepository" — disalin dari tests/order-status.test.ts
// (information_schema 2 Okt 2026). Disalin, bukan diimpor: mengimpor berkas test
// lain ikut mendaftarkan test-nya.
const KOLOM_SALES = (
  'id invoice_no date_received customer_id customer_name order_id item_code test gross_sales discount ' +
  'nett_sales month year source created_at updated_at patient_name clinician date_result dob email_sent ' +
  'gender is_rns is_slide_only pathologist patient_cost payment_method price_type qty voucher_cost ' +
  'voucher_no clin_diagnosis pa_diagnosis specimen_type result city transfer_id transfer_test_deleted_at ' +
  'transaction_transfer_deleted_at payer_name transaction_test_id date_validated bridging_status_to ' +
  'bridging_attempts_to bridging_error_to bridging_job_id_to bridging_started_at_to bridged_at_to ' +
  'bridging_unique_id orl_no_to orl_lineno_to bridging_status_result bridging_attempts_result ' +
  'bridging_error_result bridging_job_id_result bridging_started_at_result bridged_at_result orl_no_result ' +
  'orl_lineno_result bridging_batch_id_to top_days account_code_masterdata item_code_masterdata ' +
  'payer_code_masterdata payer_code payer_type unit_price approval_buddle_id voucher_input ' +
  'new_sample_received_date pharma_id result_id item_code_lis kd_cabang bridging_batch_id_result shipment_no'
).split(' ')

// Seluruh kolom public.v_sample_tracker (information_schema 20 Okt 2026), termasuk `patient`.
const KOLOM_VIEW = (
  'unique_key category order_id account customer_id price_type payer_name payer_code test item_code qty ' +
  'is_rns current_status current_sequence current_status_at previous_action order_created_at ' +
  'order_validated_at lab_sample_received_at rns_at new_sample_received_date preparation_started_at ' +
  'preparation_completed_at result_created_at result_validated_at date_result canceled_at notes ' +
  'last_updated_at etl_updated_at source_sytem sample_status patient'
).split(' ')

const dipakai = (daftar: string[], sql: string): string[] =>
  daftar.filter((k) => new RegExp(`(^|[^a-z_])${k}([^a-z_]|$)`).test(sql))

const SQL_SALES: Record<string, string> = { SQL_KESEGARAN_SALES, SQL_NETT_HARIAN, SQL_ORDER_HARIAN }
const SQL_LAB: Record<string, string> = { SQL_KESEGARAN_TAT, SQL_SAMPEL_LEWAT_BATAS, SQL_KATEGORI_BACKLOG }

describe('pemantau: SQL baca-saja', () => {
  test('SQL sales memuat RECOGNIZED_CLAUSE (aturan 5)', () => {
    for (const [nama, sql] of Object.entries(SQL_SALES)) assert.ok(sql.includes(RECOGNIZED_CLAUSE.trim()), nama)
  })

  test('kesegaran Sales = baris BARU (created_at), bukan updated_at yang ikut ditulis retry bridging', () => {
    // Ukur 20 Okt 2026: job bridging ERP menulis updated_at di SETIAP percobaan (sukses =
    // bridged_at_*, gagal ≈ bridging_started_at_*) dan mencoba ulang baris gagal tiap hari ia
    // jalan (61 baris diakui pagi itu) — max(updated_at) tetap segar walau ETL berhenti, dan
    // syarat "sinkronisasi sesudah D" sales kemarin ikut lolos. created_at = DEFAULT database,
    // hanya terisi saat INSERT.
    assert.match(SQL_KESEGARAN_SALES, /max\(created_at\)/)
    assert.deepEqual(dipakai(KOLOM_SALES, SQL_KESEGARAN_SALES).sort(), [
      'created_at',
      'transaction_transfer_deleted_at',
      'transfer_test_deleted_at'
    ])
    assert.ok(!(KOLOM_SALES_DIBACA as readonly string[]).includes('updated_at'))
  })

  test('SQL sales hanya kolom KOLOM_SALES_DIBACA (tanpa kolom pasien/pelanggan)', () => {
    for (const [nama, sql] of Object.entries(SQL_SALES)) {
      const asing = dipakai(KOLOM_SALES, sql).filter((k) => !(KOLOM_SALES_DIBACA as readonly string[]).includes(k))
      assert.deepEqual(asing, [], nama)
    }
    for (const k of ['patient_name', 'dob', 'clin_diagnosis', 'result', 'customer_name', 'invoice_no']) {
      assert.ok(!(KOLOM_SALES_DIBACA as readonly string[]).includes(k), k)
    }
  })

  test('SQL lab hanya kolom KOLOM_AMAN dan tidak pernah menyebut patient (aturan 35)', () => {
    for (const [nama, sql] of Object.entries(SQL_LAB)) {
      const asing = dipakai(KOLOM_VIEW, sql).filter((k) => !(KOLOM_AMAN as readonly string[]).includes(k))
      assert.deepEqual(asing, [], nama)
      assert.doesNotMatch(sql, /patient/i, nama)
    }
  })

  test('SQL lab memakai klausa pengakuan dari lab/rules, bukan salinan', () => {
    assert.ok(SQL_SAMPEL_LEWAT_BATAS.includes(DIAKUI_CLAUSE))
    assert.ok(SQL_SAMPEL_LEWAT_BATAS.includes(BACKLOG_CLAUSE))
    assert.ok(SQL_KATEGORI_BACKLOG.includes(BACKLOG_CLAUSE))
    assert.ok(SQL_KATEGORI_BACKLOG.includes(JANGKAR_UMUR))
  })

  test('waktu "sekarang" di SQL sampel = parameter waktu database, bukan now() kedua', () => {
    assert.doesNotMatch(SQL_SAMPEL_LEWAT_BATAS, /now\(\)/)
    assert.doesNotMatch(SQL_KATEGORI_BACKLOG, /now\(\)/)
    assert.match(SQL_KESEGARAN_TAT, /now\(\) AS waktu_db/)
  })

  test('hanya SELECT/WITH, tanpa perintah yang mengubah', () => {
    for (const [nama, sql] of Object.entries({ ...SQL_SALES, ...SQL_LAB })) {
      assert.match(sql, /^\s*(SELECT|WITH)\b/i, nama)
      assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT)\b/i, nama)
    }
  })
})

describe('pemantau: kalimat aturan', () => {
  test('kalimat aturan memakai konstanta, bukan angka ketikan', () => {
    const ds = kalimatAturan('data_sales')
    assert.ok(ds.includes(`${AMBANG_DATA_SALES_JAM} hours`) && ds.includes('Monday–Friday 08:00–18:00'), ds)
    // Orang yang membaca aturannya harus tahu yang diukur BARIS BARU, dan kenapa Senin pagi diam.
    assert.ok(ds.includes('no new rows') && ds.includes('Sunday hours are not counted'), ds)
    const dt = kalimatAturan('data_tat')
    assert.ok(dt.includes(`${AMBANG_DATA_TAT_JAM} hours`) && dt.includes('Monday–Saturday 08:00–18:00'), dt)
    const sa = kalimatAturan('sales_anjlok')
    assert.ok(sa.includes(`${Math.round(SALES_RASIO_ANJLOK * 100)}%`), sa)
    assert.ok(sa.includes(`${Math.round(SALES_RASIO_LIBUR * 100)}%`), sa)
    // Orang yang melihat status "Jum 16 Okt" pada hari Senin harus bisa membaca sebabnya di aturan.
    assert.ok(sa.includes('assessed later') && sa.includes(`${SALES_SUSULAN_HARI_KERJA} working days`), sa)
    const st = kalimatAturan('sampel_terlambat')
    assert.ok(st.includes(`${LAB_UMUR_MAKS_HARI} days`), st)
    assert.ok(st.includes(`${Math.round(LAB_PERSENTIL * 100)}%`), st)
    assert.ok(st.includes(`${LAB_JENDELA_HARI} days`), st)
  })
})

// ------------------------------------------------------------------ penyimpanan
//
// SQL penyimpanan dijalankan sungguhan di `node:sqlite` (bawaan Node 22) — better-sqlite3
// milik aplikasi dibangun untuk Electron dan tidak bisa dibuka dari test.

function penyimpananUji(): { s: ReturnType<typeof buatPenyimpanan>; db: DatabaseSync; peta: Map<string, PemicuId[]> } {
  const db = new DatabaseSync(':memory:')
  db.exec(DDL_PEMANTAU)
  const peta = new Map<string, PemicuId[]>()
  const saklar: SaklarConfig = {
    baca: (u) => peta.get(u) ?? [],
    tulis: (u, mati) => {
      peta.set(u, mati)
    }
  }
  return { s: buatPenyimpanan(db, saklar), db, peta }
}

describe('pemantau: penyimpanan', () => {
  test('penanda per username × pemicu; huruf besar dianggap sama', () => {
    const { s } = penyimpananUji()
    assert.deepEqual(s.baca('budi', 'data_tat'), { nilai: null, diperiksa: null, status: null })
    const status = { hasil: 'berbunyi' as const, ringkas: 'Belum diperbarui.' }
    s.simpan('Budi', 'data_tat', { nilai: '2026-10-08 02:25', diperiksa: 5, status })
    assert.deepEqual(s.baca('budi', 'data_tat'), { nilai: '2026-10-08 02:25', diperiksa: 5, status })
    assert.equal(s.baca('budi', 'data_sales').nilai, null)
    assert.equal(s.baca('andi', 'data_tat').nilai, null)
    s.simpan('budi', 'data_tat', { nilai: 'kedua', diperiksa: 6, status: null })
    assert.deepEqual(s.baca('BUDI', 'data_tat'), { nilai: 'kedua', diperiksa: 6, status: null })
  })

  test('kosongkan hanya pemicu itu milik orang itu', () => {
    const { s } = penyimpananUji()
    s.simpan('budi', 'data_tat', { nilai: 'a', diperiksa: 1, status: null })
    s.simpan('budi', 'sales_anjlok', { nilai: '2026-10-19', diperiksa: 1, status: null })
    s.simpan('andi', 'data_tat', { nilai: 'b', diperiksa: 1, status: null })
    s.kosongkan('Budi', 'data_tat')
    assert.equal(s.baca('budi', 'data_tat').nilai, null)
    assert.equal(s.baca('budi', 'sales_anjlok').nilai, '2026-10-19')
    assert.equal(s.baca('andi', 'data_tat').nilai, 'b')
  })

  test('riwayat milik orang: user lain tidak melihat', () => {
    const { s } = penyimpananUji()
    s.catatRiwayat('budi', { pemicu: 'data_tat', judul: 'J', isi: 'I', aksi: { tujuan: 'panel' }, dibuat: 1 })
    assert.equal(s.riwayat('budi', 20).length, 1)
    assert.equal(s.riwayat('andi', 20).length, 0)
  })

  test('riwayat dipangkas ke MAKS_RIWAYAT per user, terbaru dulu', () => {
    const { s } = penyimpananUji()
    s.catatRiwayat('andi', { pemicu: 'data_tat', judul: 'andi', isi: 'x', aksi: { tujuan: 'panel' }, dibuat: 1 })
    for (let i = 0; i < MAKS_RIWAYAT + 5; i++) {
      s.catatRiwayat('budi', { pemicu: 'data_tat', judul: `j${i}`, isi: 'x', aksi: { tujuan: 'panel' }, dibuat: 1000 + i })
    }
    const r = s.riwayat('budi', 1000)
    assert.equal(r.length, MAKS_RIWAYAT)
    assert.equal(r[0].dibuat, 1000 + MAKS_RIWAYAT + 4)
    assert.equal(r[r.length - 1].dibuat, 1005)
    assert.equal(s.riwayat('andi', 1000).length, 1, 'pemangkasan milik budi tidak menyentuh riwayat andi')
    assert.equal(s.riwayat('budi', 20).length, 20)
  })

  test('aksi & status kembali sebagai objek; kolom sesuai spec', () => {
    const { s, db } = penyimpananUji()
    const aksi = { tujuan: 'menu' as const, mode: 'lab' as const, tanya: 'Tampilkan sampel Molekuler …' }
    s.catatRiwayat('budi', { pemicu: 'sampel_terlambat', judul: 'J', isi: 'I', aksi, dibuat: 7 })
    const [r] = s.riwayat('budi', 5)
    assert.deepEqual({ ...r, id: 0 }, { id: 0, pemicu: 'sampel_terlambat', judul: 'J', isi: 'I', aksi, dibuat: 7 })
    s.simpan('budi', 'sampel_terlambat', {
      nilai: null,
      diperiksa: 9,
      status: { hasil: 'ditahan', ringkas: 'Ditahan.', tidakDipantau: ['PK (lab receipt time not recorded)'] }
    })
    assert.deepEqual(s.baca('budi', 'sampel_terlambat').status?.tidakDipantau, ['PK (lab receipt time not recorded)'])
    const kolom = (t: string): string[] =>
      (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name)
    assert.deepEqual(kolom('pemantau_penanda'), ['username', 'pemicu', 'nilai', 'diperiksa', 'status'])
    assert.deepEqual(kolom('pemantau_riwayat'), ['id', 'username', 'pemicu', 'judul', 'isi', 'aksi', 'dibuat'])
  })

  test('saklar mati per user tanpa duplikat; menyalakan menghapusnya', () => {
    const { s, peta } = penyimpananUji()
    s.setelMati('Budi', 'data_tat', true)
    s.setelMati('budi', 'data_tat', true)
    assert.deepEqual(s.mati('budi'), ['data_tat'])
    assert.deepEqual(peta.get('budi'), ['data_tat'], 'kunci config huruf kecil')
    assert.deepEqual(s.mati('andi'), [])
    s.setelMati('budi', 'data_tat', false)
    assert.deepEqual(s.mati('budi'), [])
  })

  test('db.ts mendaftarkan DDL_PEMANTAU sesudah migrasi kolom visual (migrasi rename Master Data menyusul)', () => {
    const teks = readFileSync('src/main/db.ts', 'utf8')
    assert.ok(teks.includes("import { DDL_PEMANTAU } from './pemantau/simpan'"))
    const visual = teks.indexOf('ADD COLUMN visual TEXT')
    const ddl = teks.search(/DDL_PEMANTAU,\s*\n/)
    const rename = teks.indexOf("UPDATE sessions SET mode = 'masterdata'")
    assert.ok(visual > 0 && ddl > visual && rename > ddl, 'urutan: kolom visual → DDL_PEMANTAU → rename Master Data')
  })

  test('config punya pemantauMati bawaan kosong (semua pemicu menyala)', () => {
    const teks = readFileSync('src/main/config.ts', 'utf8')
    assert.match(teks, /pemantauMati: z\.record\(z\.string\(\), z\.array\(z\.string\(\)\.max\(40\)\)\.max\(10\)\)\.default\(\{\}\)/)
    // Enum di skema config = id pemicu yang kelak dihapus menggagalkan parse SELURUH
    // config, dan loadConfig jatuh ke bawaan (folder akses & senyap chat hilang).
    assert.doesNotMatch(teks, /pemantauMati:[^\n]*z\.enum/)
  })
})

// ---------------------------------------------------------------------- service
//
// Dependensi palsu: query dipetakan per konstanta SQL (urutan & parameter direkam),
// penyimpanan SUNGGUHAN di node:sqlite yang dibungkus perekam kejadian. Jam laptop
// default Selasa 20 Okt 2026 11.00; data TAT basi seperti keadaan nyata hari ini.

interface OpsiUji {
  sesi?: SesiPemantau | null
  sekarang?: Date
  hariIni?: string
  tat?: { terakhir: string | null; umur_jam: number | null; waktu_db: Date }
  sales?: { terakhir: string | null; umur_jam: number | null }
  nett?: Record<string, number>
  order?: Record<string, number>
  sampel?: typeof B
  gagal?: boolean
  tunda?: number
  uji?: { sales: boolean; lab: boolean }
  /** Dipanggil saat SQL_KESEGARAN_TAT dijalankan — untuk mensimulasikan sesi berganti. */
  saatTat?: () => void
}

const TAT_BASI = { terakhir: '2026-10-08 02:25', umur_jam: 296.5, waktu_db: new Date('2026-10-20T04:00:00Z') }
const NETT_NORMAL = rek(348e6, [417e6, 191e6, 383e6, 214e6])
const BACKLOG = [
  { category: 'Molekuler', di_lab: 237, backlog: 240 },
  { category: 'PK', di_lab: 0, backlog: 1056 }
]

function buatUji(o: OpsiUji = {}) {
  const kejadian: string[] = []
  const query: Array<{ sql: string; params: unknown[] }> = []
  const toast: Array<{ title: string; body: string; onClick: () => void; grup: string; pemilik: string }> = []
  const tutup: Array<string | null> = []
  const dibuka: AksiPemantau[] = []
  const log: string[] = []
  let sesi: SesiPemantau | null = o.sesi === undefined ? { username: 'Budi', menu: ['sales', 'lab'] } : o.sesi
  let sekarang = o.sekarang ?? t(2026, 10, 20, 11, 0)
  let hariIni = o.hariIni ?? '2026-10-20'
  let tat = o.tat ?? TAT_BASI
  let sales = o.sales ?? { terakhir: '2026-10-20 10:36', umur_jam: 0.4 }
  let gagal = o.gagal ?? false
  let simpanGagal = false
  const db = new DatabaseSync(':memory:')
  db.exec(DDL_PEMANTAU)
  const peta = new Map<string, PemicuId[]>()
  const asli = buatPenyimpanan(db, { baca: (u) => peta.get(u) ?? [], tulis: (u, m) => void peta.set(u, m) })
  const simpan: typeof asli = {
    ...asli,
    simpan: (u, id, p) => {
      kejadian.push(`simpan:${id}`)
      if (simpanGagal) throw new Error('database is locked')
      asli.simpan(u, id, p)
    },
    catatRiwayat: (u, r) => {
      kejadian.push(`riwayat:${r.pemicu}`)
      asli.catatRiwayat(u, r)
    }
  }
  const jawab: Record<string, () => unknown[]> = {
    [SQL_KESEGARAN_TAT]: () => {
      o.saatTat?.()
      return [tat]
    },
    [SQL_KESEGARAN_SALES]: () => [sales],
    [SQL_SAMPEL_LEWAT_BATAS]: () => o.sampel ?? B,
    [SQL_KATEGORI_BACKLOG]: () => BACKLOG,
    [SQL_NETT_HARIAN]: () => Object.entries(o.nett ?? NETT_NORMAL).map(([tgl, nett]) => ({ tgl, nett })),
    [SQL_ORDER_HARIAN]: () => Object.entries(o.order ?? ORDER_NORMAL).map(([tgl, order]) => ({ tgl, order }))
  }
  const deps: Dependensi = {
    query: async <T,>(sql: string, params: unknown[]): Promise<T[]> => {
      query.push({ sql, params })
      if (o.tunda) await new Promise((r) => setTimeout(r, o.tunda))
      if (gagal) throw new Error('Connection terminated due to connection timeout')
      const f = jawab[sql]
      if (!f) throw new Error('SQL tak dikenal di test')
      return f() as T[]
    },
    simpan,
    sesi: () => sesi,
    notify: (n) => {
      kejadian.push('notify')
      toast.push(n)
      return true
    },
    tutupNotifikasiLain: (u) => void tutup.push(u),
    buka: (a) => void dibuka.push(a),
    berubah: () => void kejadian.push('berubah'),
    log: (pesan, data) => void log.push(`${pesan} ${JSON.stringify(data)}`),
    audit: () => undefined,
    sekarang: () => sekarang,
    hariIniJakarta: () => hariIni,
    jedaMs: 0,
    uji: o.uji ?? { sales: false, lab: false }
  }
  return {
    deps,
    simpan: asli,
    kejadian,
    query,
    toast,
    tutup,
    dibuka,
    log,
    setSesi: (s: SesiPemantau | null) => void (sesi = s),
    setSekarang: (d: Date) => void (sekarang = d),
    setHariIni: (h: string) => void (hariIni = h),
    setTat: (x: typeof tat) => void (tat = x),
    setSales: (x: typeof sales) => void (sales = x),
    setGagal: (g: boolean) => void (gagal = g),
    setSimpanGagal: (g: boolean) => void (simpanGagal = g)
  }
}

const dipanggil = (u: ReturnType<typeof buatUji>, sql: string): boolean => u.query.some((q) => q.sql === sql)

// Kasus nyata 16–19 Okt 2026 (ukur 20 Okt): baris baru terakhir Jum 16 Okt 17.53, berikutnya baru
// Sab 17 Okt 17.24 — sesudah pemeriksaan terakhir hari Sabtu. Kamis sudah dinilai hari Jumat.
// Angka: Jumat anjlok (61 jt vs median 305 jt = 20%, order 96%), Sabtu normal (100%, order 100%).
const JUMAT_16 = ['2026-10-16', '2026-10-09', '2026-10-02', '2026-09-25', '2026-09-18']
const SABTU_17 = ['2026-10-17', '2026-10-10', '2026-10-03', '2026-09-26', '2026-09-19']
const isiTanggal = (tgl: string[], v: number[]): Record<string, number> =>
  Object.fromEntries(tgl.map((d, i) => [d, v[i]]))

/** Sabtu 17 Okt diperiksa tiap jam 10.05–17.05 tanpa baris baru; berhenti di Senin 19 Okt pagi, sebelum diperiksa. */
async function sabtuTanpaBarisBaruLaluSenin() {
  const u = buatUji({
    sesi: { username: 'budi', menu: ['sales'] },
    hariIni: '2026-10-17',
    sales: { terakhir: '2026-10-16 17:53', umur_jam: 16.2 },
    nett: {
      ...isiTanggal(JUMAT_16, [61e6, 300e6, 320e6, 280e6, 310e6]),
      ...isiTanggal(SABTU_17, [150e6, 140e6, 160e6, 155e6, 145e6])
    },
    order: { ...isiTanggal(JUMAT_16, [290, 300, 310, 295, 305]), ...isiTanggal(SABTU_17, [120, 118, 125, 122, 119]) }
  })
  u.simpan.simpan('budi', 'sales_anjlok', { nilai: '2026-10-15', diperiksa: t(2026, 10, 16, 10, 5).getTime(), status: null })
  for (let jam = 10; jam <= 17; jam++) {
    u.setSekarang(t(2026, 10, 17, jam, 5))
    await periksaPemantau(u.deps)
  }
  const sabtu = u.simpan.baca('budi', 'sales_anjlok')
  // Senin: baris baru sudah masuk lagi (Sab 17.24, Min 13.08, Sen pagi).
  u.setHariIni('2026-10-19')
  u.setSales({ terakhir: '2026-10-19 08:30', umur_jam: 1.6 })
  return { u, sabtu }
}

describe('pemantau: service', () => {
  test('izin: pemicu yang menunya tidak ada di sesi tidak di-query', async () => {
    const u = buatUji({ sesi: { username: 'budi', menu: ['lab'] } })
    await periksaPemantau(u.deps)
    for (const sql of [SQL_KESEGARAN_SALES, SQL_NETT_HARIAN, SQL_ORDER_HARIAN]) assert.equal(dipanggil(u, sql), false)
    assert.ok(dipanggil(u, SQL_KESEGARAN_TAT))
  })

  test('saklar mati tidak dievaluasi; kesegaran TAT tetap dibaca untuk sampel', async () => {
    const u = buatUji({ sesi: { username: 'budi', menu: ['lab'] } })
    u.simpan.setelMati('budi', 'data_tat', true)
    await periksaPemantau(u.deps)
    assert.equal(u.toast.length, 0)
    assert.ok(dipanggil(u, SQL_KESEGARAN_TAT))
    assert.equal(u.simpan.baca('budi', 'sampel_terlambat').status?.hasil, 'ditahan')
    assert.equal(u.simpan.baca('budi', 'data_tat').diperiksa, null)
  })

  test('urutan: penanda → riwayat → toast; klik toast membuka aksinya', async () => {
    const u = buatUji({ sesi: { username: 'Budi', menu: ['lab'] } })
    await periksaPemantau(u.deps)
    assert.deepEqual(u.kejadian.slice(0, 3), ['simpan:data_tat', 'riwayat:data_tat', 'notify'])
    assert.equal(u.toast[0].title, 'Sample TAT data not updated for 12 days')
    // Toast diberi grup & pemilik; toast pemantau milik user LAIN ditutup tiap putaran.
    assert.deepEqual([u.toast[0].grup, u.toast[0].pemilik], ['pemantau', 'budi'])
    assert.deepEqual(u.tutup, ['budi'])
    u.toast[0].onClick()
    assert.deepEqual(u.dibuka, [{ tujuan: 'panel' }])
    assert.equal(u.simpan.riwayat('budi', 5)[0].judul, 'Sample TAT data not updated for 12 days')
  })

  test('data TAT macet berbunyi sekali; jam berikutnya tidak', async () => {
    const u = buatUji({ sesi: { username: 'budi', menu: ['lab'] } })
    await periksaPemantau(u.deps)
    u.setSekarang(t(2026, 10, 20, 12, 0))
    await periksaPemantau(u.deps)
    assert.equal(u.toast.filter((x) => x.title.startsWith('Sample TAT data')).length, 1)
    assert.equal(u.query.filter((q) => q.sql === SQL_KESEGARAN_TAT).length, 2, 'jam berikutnya tetap diperiksa')
    // Log adalah bukti dari aplikasi: wajib membedakan "toast dikirim" dari "keadaan masih berlaku".
    const logTat = u.log.filter((l) => l.startsWith('pemantau: data_tat '))
    assert.match(logTat[0], /"diberitahukan":true/)
    assert.match(logTat[1], /"diberitahukan":false/)
  })

  test('sampel ditahan saat TAT basi: tanpa toast, penanda tidak maju', async () => {
    const u = buatUji({ sesi: { username: 'budi', menu: ['lab'] } })
    await periksaPemantau(u.deps)
    const p = u.simpan.baca('budi', 'sampel_terlambat')
    assert.equal(p.nilai, null)
    assert.equal(p.status?.hasil, 'ditahan')
    assert.equal(p.status?.ringkas, 'On hold: TAT data not updated since Thu Oct 8 02:25.')
    assert.equal(dipanggil(u, SQL_SAMPEL_LEWAT_BATAS), false)
    assert.equal(u.toast.filter((x) => /lab samples/.test(x.title)).length, 0)
  })

  test('jendela sampel memakai waktu database, bersambung tanpa celah', async () => {
    // Review Focus 3: jam laptop (11.00 lokal) sengaja beda 3 jam dari waktu database (08.00 WIB).
    const W1 = new Date('2026-10-20T01:00:00Z')
    const W2 = new Date('2026-10-21T01:00:00Z')
    const u = buatUji({
      sesi: { username: 'budi', menu: ['lab'] },
      tat: { terakhir: '2026-10-20 02:00', umur_jam: 6, waktu_db: W1 }
    })
    await periksaPemantau(u.deps)
    const q1 = u.query.find((q) => q.sql === SQL_SAMPEL_LEWAT_BATAS)
    assert.deepEqual(q1?.params, [W1.toISOString(), W1.toISOString()])
    assert.equal(u.simpan.baca('budi', 'sampel_terlambat').nilai, W1.toISOString())
    assert.equal(u.toast.filter((x) => x.title === '48 lab samples are currently past their normal limit').length, 1)
    u.setSekarang(t(2026, 10, 21, 11, 0))
    u.setTat({ terakhir: '2026-10-21 02:00', umur_jam: 6, waktu_db: W2 })
    await periksaPemantau(u.deps)
    const q2 = u.query.filter((q) => q.sql === SQL_SAMPEL_LEWAT_BATAS)[1]
    assert.deepEqual(q2?.params, [W1.toISOString(), W2.toISOString()])
  })

  test('tanpa kategori yang bisa dipantau: "kurang data", bukan "Normal — terlambat 0" (aturan 33)', async () => {
    const u = buatUji({
      sesi: { username: 'budi', menu: ['lab'] },
      tat: { terakhir: '2026-10-20 02:00', umur_jam: 6, waktu_db: new Date('2026-10-20T01:00:00Z') },
      sampel: []
    })
    await periksaPemantau(u.deps)
    const p = u.simpan.baca('budi', 'sampel_terlambat')
    assert.equal(p.status?.hasil, 'kurang_data')
    assert.equal(p.status?.ringkas, RINGKAS_SAMPEL_KOSONG)
    assert.deepEqual(p.status?.tidakDipantau, [
      'Molekuler (not enough completed-sample history)',
      'PK (lab receipt time not recorded)'
    ])
    assert.equal(u.toast.length, 0)
    assert.ok(u.log.some((l) => l.startsWith('pemantau: sampel_terlambat kurang_data') && l.includes('"kategori":0')))
  })

  test('sales menunggu sinkronisasi bila data belum bergerak sesudah hari yang dinilai', async () => {
    const u = buatUji({ sesi: { username: 'budi', menu: ['sales'] }, sales: { terakhir: '2026-10-19 22:46', umur_jam: 12 } })
    await periksaPemantau(u.deps)
    const p = u.simpan.baca('budi', 'sales_anjlok')
    assert.equal(p.status?.hasil, 'menunggu')
    assert.equal(p.nilai, null)
    assert.equal(dipanggil(u, SQL_NETT_HARIAN), false)
  })

  test('data Sales: jam hari Minggu tidak dihitung — Senin pagi diam, hari kerja 24,5 jam berbunyi', async () => {
    // Kasus nyata (ukur 20 Okt 2026). Sen 12 Okt 08.05: baris baru terakhir Sab 10 Okt 13.20 =
    // 42,8 jam, 24 di antaranya hari Minggu (lab tutup, Minggu itu tanpa insert); insert Senin
    // pertama baru 08.19 — tanpa aturan ini alarm palsu.
    const senin = buatUji({
      sesi: { username: 'budi', menu: ['sales'] },
      sekarang: t(2026, 10, 12, 8, 5),
      hariIni: '2026-10-12',
      sales: { terakhir: '2026-10-10 13:20', umur_jam: 42.8 }
    })
    await periksaPemantau(senin.deps)
    assert.deepEqual(
      { hasil: senin.simpan.baca('budi', 'data_sales').status?.hasil, ringkas: senin.simpan.baca('budi', 'data_sales').status?.ringkas },
      { hasil: 'normal', ringkas: 'Last new row Sat Oct 10 13:20 — normal.' }
    )
    assert.equal(senin.toast.length, 0)
    // Sel 25 Agu (libur Maulid Nabi) 15.05: 24,5 jam tanpa hari Minggu — tetap berbunyi; toast
    // menyebut "bisa karena libur". Hari kerja tidak boleh ikut longgar.
    const libur = buatUji({
      sesi: { username: 'budi', menu: ['sales'] },
      sekarang: t(2026, 8, 25, 15, 5),
      hariIni: '2026-08-25',
      sales: { terakhir: '2026-08-24 14:35', umur_jam: 24.5 }
    })
    await periksaPemantau(libur.deps)
    assert.equal(libur.simpan.baca('budi', 'data_sales').status?.ringkas, 'No new rows since Mon Aug 24 14:35 (~25 hours).')
    assert.deepEqual(libur.toast.map((x) => x.title), ['Sales data not updated for ~25 hours'])
  })

  test('sales dinilai sekali; Periksa sekarang tidak membunyikan ulang hari yang sama', async () => {
    const u = buatUji({ sesi: { username: 'budi', menu: ['sales'] }, nett: rek(50e6, [417e6, 191e6, 383e6, 214e6]) })
    await periksaPemantau(u.deps)
    assert.equal(u.toast.filter((x) => /^Sales .* dropped/.test(x.title)).length, 1)
    assert.equal(u.simpan.baca('budi', 'sales_anjlok').nilai, '2026-10-19')
    await periksaPemantau(u.deps, { paksa: true })
    assert.equal(u.toast.filter((x) => /^Sales .* dropped/.test(x.title)).length, 1)
    assert.match(u.simpan.riwayat('budi', 5)[0].isi, /Rp /, 'rincian Rupiah hanya di riwayat')
  })

  test('Sabtu tanpa baris baru sebelum 18.00, lalu Senin: Jumat dinilai menyusul sebelum Sabtu, satu toast', async () => {
    const { u, sabtu } = await sabtuTanpaBarisBaruLaluSenin()
    assert.deepEqual([sabtu.nilai, sabtu.status?.ringkas], ['2026-10-15', 'Waiting for the Fri Oct 16 data sync.'])
    const dinilai = (): unknown[] => u.query.filter((q) => q.sql === SQL_NETT_HARIAN).map((q) => q.params[0])
    assert.deepEqual(dinilai(), [], 'Sabtu: belum ada hari yang bisa dinilai')
    u.setSekarang(t(2026, 10, 19, 10, 5))
    await periksaPemantau(u.deps)
    assert.deepEqual(dinilai(), [JUMAT_16], 'Senin 10.05: Jumat dulu, dengan pembanding hari Jumat')
    u.setSekarang(t(2026, 10, 19, 11, 5))
    await periksaPemantau(u.deps)
    assert.deepEqual(dinilai(), [JUMAT_16, SABTU_17], 'Senin 11.05: Sabtu')
    assert.equal(u.simpan.baca('budi', 'sales_anjlok').status?.ringkas, 'Sat Oct 17: 100% of usual (orders 100%) — normal.')
    u.setSekarang(t(2026, 10, 19, 12, 5))
    await periksaPemantau(u.deps)
    assert.equal(dinilai().length, 2, 'antrean habis: tidak jatuh tempo lagi')
    await periksaPemantau(u.deps, { paksa: true })
    assert.deepEqual(
      u.toast.filter((x) => /^Sales .* dropped/.test(x.title)).map((x) => x.title),
      ['Sales Fri Oct 16 dropped: 20% of usual'],
      'Jumat diberitahukan sekali; Periksa sekarang sesudahnya tidak membunyikan ulang'
    )
    assert.equal(u.simpan.baca('budi', 'sales_anjlok').nilai, '2026-10-17')
  })

  test('penanda sales tidak pernah mundur: jam laptop mundur + Periksa sekarang tidak membuat hari yang sama berbunyi lagi', async () => {
    // Dengan susulan, penanda adalah SATU-SATUNYA penahan agar hari di jendela susulan tidak
    // dinilai ulang. Dulu menilai ulang hari yang lebih tua menimpanya ke belakang.
    const u = buatUji({ sesi: { username: 'budi', menu: ['sales'] }, nett: rek(50e6, [417e6, 191e6, 383e6, 214e6]) })
    await periksaPemantau(u.deps)
    assert.equal(u.simpan.baca('budi', 'sales_anjlok').nilai, '2026-10-19')
    u.setHariIni('2026-10-19')
    u.setSekarang(t(2026, 10, 19, 11, 0))
    await periksaPemantau(u.deps, { paksa: true })
    assert.equal(u.simpan.baca('budi', 'sales_anjlok').nilai, '2026-10-19', 'menilai ulang Sat Oct 17 tidak memundurkan penanda')
    u.setHariIni('2026-10-20')
    u.setSekarang(t(2026, 10, 20, 12, 0))
    await periksaPemantau(u.deps)
    assert.equal(u.toast.filter((x) => /^Sales .* dropped/.test(x.title)).length, 1)
  })

  test('log menandai hari yang dinilai menyusul (bukti saat diuji dari aplikasi)', async () => {
    const { u } = await sabtuTanpaBarisBaruLaluSenin()
    for (const jam of [10, 11]) {
      u.setSekarang(t(2026, 10, 19, jam, 5))
      await periksaPemantau(u.deps)
    }
    const log = u.log
      .filter((l) => l.startsWith('pemantau: sales_anjlok '))
      .map((l) => {
        const d = JSON.parse(l.slice(l.indexOf('{'))) as Record<string, unknown>
        return { D: d.D, antre: d.antre, susulan: d.susulan, diberitahukan: d.diberitahukan }
      })
    assert.deepEqual(
      log[0],
      { D: '2026-10-16', antre: ['2026-10-16'], susulan: false, diberitahukan: false },
      'Sabtu: Jumat = hari kerja terakhir, bukan susulan'
    )
    assert.deepEqual(log.slice(-2), [
      { D: '2026-10-16', antre: ['2026-10-16', '2026-10-17'], susulan: true, diberitahukan: true },
      { D: '2026-10-17', antre: ['2026-10-17'], susulan: false, diberitahukan: false }
    ])
  })

  test('waktu data di MASA DEPAN (umur negatif) = tidak bisa dinilai, bukan segar', async () => {
    // Temuan review akhir: satu baris bertanggal masa depan membuat max() selalu tampak baru —
    // kemacetan sungguhan tertutup selamanya. "Tidak bisa dinilai" ≠ "segar" (aturan 33).
    const u = buatUji({
      tat: { terakhir: '2026-10-21 09:00', umur_jam: -20, waktu_db: new Date('2026-10-20T06:00:00Z') },
      sales: { terakhir: '2026-10-20 18:30', umur_jam: -7.5 }
    })
    await periksaPemantau(u.deps)
    const status = (id: PemicuId): { hasil?: string; ringkas?: string; nilai: string | null } => {
      const p = u.simpan.baca('budi', id)
      return { hasil: p.status?.hasil, ringkas: p.status?.ringkas, nilai: p.nilai }
    }
    assert.deepEqual(status('data_tat'), {
      hasil: 'gagal',
      ringkas: 'The last data time is recorded in the future (Wed Oct 21 09:00) — a stall cannot be assessed.',
      nilai: null
    })
    assert.deepEqual(status('data_sales'), {
      hasil: 'gagal',
      ringkas: 'The last data time is recorded in the future (Tue Oct 20 18:30) — a stall cannot be assessed.',
      nilai: null
    })
    // Sampel: kesegaran TAT tidak bisa dipastikan = ditahan, seperti data basi.
    assert.deepEqual(status('sampel_terlambat'), {
      hasil: 'ditahan',
      ringkas: 'On hold: the TAT data time is recorded in the future (Wed Oct 21 09:00) — its freshness cannot be confirmed.',
      nilai: null
    })
    assert.equal(dipanggil(u, SQL_SAMPEL_LEWAT_BATAS), false)
    // Sales kemarin: "sinkronisasi sesudah hari itu sudah berjalan" tidak bisa dipastikan.
    assert.deepEqual(status('sales_anjlok'), {
      hasil: 'gagal',
      ringkas: 'The Sales data time is recorded in the future (Tue Oct 20 18:30) — the completeness of Mon Oct 19 data cannot be confirmed, not assessed yet.',
      nilai: null
    })
    assert.equal(dipanggil(u, SQL_NETT_HARIAN), false)
    assert.equal(u.toast.length, 0)
  })

  test('database gagal: status gagal, tanpa toast, penanda tidak maju', async () => {
    const u = buatUji({ sesi: { username: 'budi', menu: ['lab'] }, gagal: true })
    await periksaPemantau(u.deps)
    const p = u.simpan.baca('budi', 'data_tat')
    assert.equal(p.status?.hasil, 'gagal')
    assert.equal(p.status?.ringkas, RINGKAS_GAGAL)
    assert.equal(p.nilai, null)
    assert.equal(p.diperiksa, t(2026, 10, 20, 11, 0).getTime())
    assert.equal(u.toast.length, 0)
  })

  test('penanda gagal disimpan (SQLite terkunci/penuh): database tidak di-query ulang tiap detak', async () => {
    // Temuan review akhir: `diperiksa` yang tak tersimpan membuat pemicu jatuh tempo lagi di
    // detak berikutnya (30 dtk) — database produksi di-query terus selama SQLite bermasalah.
    const u = buatUji({ sesi: { username: 'budi', menu: ['lab'] } })
    u.simpan.setelMati('budi', 'sampel_terlambat', true)
    u.setSimpanGagal(true)
    const tat = (): number => u.query.filter((q) => q.sql === SQL_KESEGARAN_TAT).length
    await periksaPemantau(u.deps)
    assert.equal(tat(), 1)
    assert.equal(u.toast.length, 0, 'penanda tak tersimpan = tanpa toast (kalau tidak, toast yang sama berulang)')
    assert.ok(u.log.some((l) => l.startsWith('pemantau: putaran gagal')))
    u.setSekarang(new Date(t(2026, 10, 20, 11, 0).getTime() + 30_000))
    await periksaPemantau(u.deps)
    assert.equal(tat(), 1, 'detak 30 detik kemudian tidak meng-query lagi')
    u.setSekarang(t(2026, 10, 20, 12, 0))
    await periksaPemantau(u.deps)
    assert.equal(tat(), 2, 'sesudah jarak ulang biasa (60 menit) dicoba lagi')
  })

  test('sesi berganti di tengah pemeriksaan: hasil dibuang', async () => {
    // Review Focus 2: logout/login orang lain saat query berjalan.
    let u: ReturnType<typeof buatUji> | null = null
    u = buatUji({
      sesi: { username: 'budi', menu: ['lab'] },
      saatTat: () => u?.setSesi({ username: 'andi', menu: ['lab'] })
    })
    await periksaPemantau(u.deps)
    assert.equal(u.toast.length, 0)
    assert.equal(u.simpan.riwayat('budi', 5).length + u.simpan.riwayat('andi', 5).length, 0)
    assert.equal(u.simpan.baca('budi', 'data_tat').diperiksa, null)
    assert.equal(u.simpan.baca('andi', 'data_tat').diperiksa, null)
    assert.ok(u.log.some((l) => /hasil dibuang/.test(l)))
  })

  test('saklar dimatikan SELAMA query berjalan: hasilnya dibuang, tanpa toast', async () => {
    // Temuan review akhir: saklar hanya dibaca di awal putaran, jadi pemicu yang baru saja
    // dimatikan tetap membunyikan toast begitu query-nya selesai.
    let u: ReturnType<typeof buatUji> | null = null
    u = buatUji({
      sesi: { username: 'budi', menu: ['lab'] },
      saatTat: () => void setelPemicu(u!.deps, 'data_tat', false)
    })
    await periksaPemantau(u.deps)
    assert.equal(u.toast.length, 0)
    assert.equal(u.simpan.baca('budi', 'data_tat').diperiksa, null)
    assert.ok(u.log.some((l) => l.startsWith('pemantau: hasil dibuang') && l.includes('"pemicu":"data_tat"')))
  })

  test('saklar dinyalakan ulang SELAMA query berjalan: hasil lama tidak menimpa penanda yang dikosongkan', async () => {
    let aksi: (() => void) | null = null
    const u = buatUji({ sesi: { username: 'budi', menu: ['lab'] }, saatTat: () => aksi?.() })
    await periksaPemantau(u.deps)
    assert.equal(u.toast.length, 1)
    u.setSekarang(t(2026, 10, 20, 12, 0))
    aksi = () => {
      setelPemicu(u.deps, 'data_tat', false)
      setelPemicu(u.deps, 'data_tat', true)
    }
    await periksaPemantau(u.deps)
    aksi = null
    assert.equal(u.simpan.baca('budi', 'data_tat').nilai, null, 'pengosongan tidak tertimpa hasil dari penanda lama')
    u.setSekarang(new Date(t(2026, 10, 20, 12, 0).getTime() + 30_000))
    await periksaPemantau(u.deps)
    assert.equal(u.toast.length, 2, 'keadaan saat itu diberitahukan sekali lagi, seperti janji saklar')
  })

  test('periksa bersamaan tidak membunyikan dua kali', async () => {
    // Review Focus 1: detak Jadwal + tombol "Periksa sekarang" pada saat yang sama.
    const u = buatUji({ sesi: { username: 'budi', menu: ['lab'] }, tunda: 20 })
    await Promise.all([periksaPemantau(u.deps), periksaPemantau(u.deps, { paksa: true })])
    assert.equal(u.toast.length, 1)
  })

  test('menyalakan ulang saklar mengosongkan penanda: keadaan saat itu diberitahukan sekali lagi', async () => {
    const u = buatUji({ sesi: { username: 'budi', menu: ['lab'] } })
    await periksaPemantau(u.deps)
    setelPemicu(u.deps, 'data_tat', false)
    setelPemicu(u.deps, 'data_tat', true)
    assert.equal(u.simpan.baca('budi', 'data_tat').nilai, null)
    await periksaPemantau(u.deps)
    assert.equal(u.toast.length, 2)
    setelPemicu(u.deps, 'data_tat', true) // sudah menyala: tidak mengosongkan apa pun
    assert.notEqual(u.simpan.baca('budi', 'data_tat').nilai, null)
  })

  test('keadaan untuk layar disaring menu sesi', async () => {
    const u = buatUji({ sesi: { username: 'budi', menu: ['sales'] } })
    u.simpan.catatRiwayat('budi', { pemicu: 'data_tat', judul: 'TAT', isi: 'x', aksi: { tujuan: 'panel' }, dibuat: 1 })
    u.simpan.catatRiwayat('budi', { pemicu: 'sales_anjlok', judul: 'Sales', isi: 'x', aksi: { tujuan: 'panel' }, dibuat: 2 })
    const k = keadaanPemantau(u.deps)
    assert.deepEqual(k.pemicu.map((p) => p.id), ['data_sales', 'sales_anjlok'])
    assert.deepEqual(k.riwayat.map((r) => r.judul), ['Sales'])
    assert.equal(k.pemicu[0].hasil, 'belum')
    assert.equal(k.pemicu[0].aturan, kalimatAturan('data_sales'))
    assert.deepEqual(keadaanPemantau({ ...u.deps, sesi: () => null }), { pemicu: [], riwayat: [] })
  })

  test('di luar jam kerja tidak ada query kecuali "Periksa sekarang"', async () => {
    const u = buatUji({ sekarang: t(2026, 10, 20, 19, 0) })
    await periksaPemantau(u.deps)
    assert.equal(u.query.length, 0)
    await periksaPemantau(u.deps, { paksa: true })
    assert.ok(u.query.length > 0)
  })

  test('"Periksa sekarang" hari Sabtu tidak menilai data Sales', async () => {
    const u = buatUji({
      sesi: { username: 'budi', menu: ['sales'] },
      sekarang: t(2026, 10, 24, 11, 0),
      hariIni: '2026-10-24',
      sales: { terakhir: '2026-10-23 05:00', umur_jam: 30 }
    })
    await periksaPemantau(u.deps, { paksa: true })
    assert.equal(u.simpan.baca('budi', 'data_sales').diperiksa, null)
    assert.equal(u.toast.filter((x) => x.title.startsWith('Sales data')).length, 0)
    assert.notEqual(u.simpan.baca('budi', 'sales_anjlok').diperiksa, null, 'sales anjlok tetap Senin–Sabtu')
  })

  test('"Periksa sekarang" sebelum 10.00 tidak menilai sales kemarin dan tidak memajukan penandanya', async () => {
    const u = buatUji({
      sesi: { username: 'budi', menu: ['sales'] },
      sekarang: t(2026, 10, 20, 9, 30),
      nett: rek(50e6, [417e6, 191e6, 383e6, 214e6])
    })
    await periksaPemantau(u.deps, { paksa: true })
    assert.equal(dipanggil(u, SQL_NETT_HARIAN), false)
    assert.equal(u.simpan.baca('budi', 'sales_anjlok').nilai, null)
    assert.notEqual(u.simpan.baca('budi', 'data_sales').diperiksa, null)
  })

  test('"Periksa sekarang" dibatasi sekali per 60 detik per user', async () => {
    const u = buatUji()
    await periksaSekarang(u.deps)
    const sesudahPertama = u.query.length
    assert.ok(sesudahPertama > 0)
    const k = await periksaSekarang(u.deps)
    assert.equal(u.query.length, sesudahPertama)
    assert.equal(k.pemicu.length, 4)
  })

  test('"Periksa sekarang" yang kena batas DIBERI TAHU, bukan diam', async () => {
    // Temuan review akhir: tombol yang ditekan lagi dalam 60 detik tidak melakukan apa-apa
    // dan tidak berkata apa-apa — dari layar tampak seperti AIRA rusak.
    const u = buatUji()
    const detik = (n: number): Date => new Date(t(2026, 10, 20, 11, 0).getTime() + n * 1000)
    assert.equal((await periksaSekarang(u.deps)).catatanPeriksa, undefined)
    u.setSekarang(detik(20))
    const kena = await periksaSekarang(u.deps)
    assert.equal(kena.catatanPeriksa, 'Just checked — try again in 40 seconds (limited to once per 60 seconds).')
    assert.equal(kena.pemicu.length, 4, 'status tetap dikirim')
    u.setSekarang(detik(59.5))
    assert.match((await periksaSekarang(u.deps)).catatanPeriksa ?? '', /try again in 1 second /)
    u.setSekarang(detik(60))
    assert.equal((await periksaSekarang(u.deps)).catatanPeriksa, undefined)
  })

  test('"Periksa sekarang" sesudah jam laptop melompat mundur tetap berjalan', async () => {
    // Batas 60 detik yang tercatat di "masa depan" tidak boleh mengunci tombol sampai jam menyusul.
    const u = buatUji({ sesi: { username: 'budi', menu: ['lab'] } })
    await periksaSekarang(u.deps)
    const sesudahPertama = u.query.length
    u.setSekarang(t(2026, 10, 20, 10, 30))
    await periksaSekarang(u.deps)
    assert.ok(u.query.length > sesudahPertama, `query ${u.query.length} vs ${sesudahPertama}`)
  })

  test('mode uji dev berlabel [UJI]', async () => {
    const u = buatUji({ sesi: { username: 'budi', menu: ['sales'] }, uji: { sales: true, lab: false } })
    await periksaPemantau(u.deps)
    const sales = u.toast.filter((x) => /Sales Mon Oct 19 dropped/.test(x.title))
    assert.equal(sales.length, 1)
    assert.ok(sales[0].title.startsWith('[UJI] '), sales[0].title)
  })
})

describe('pemantau: tampilan (helper murni)', () => {
  test('aksi menu ke menu yang tidak diizinkan diabaikan', () => {
    assert.equal(aksiBoleh({ tujuan: 'menu', mode: 'lab', tanya: 'x' }, ['sales']), false)
    assert.equal(aksiBoleh({ tujuan: 'menu', mode: 'lab', tanya: 'x' }, ['lab']), true)
    assert.equal(aksiBoleh({ tujuan: 'panel' }, []), true)
  })

  test('gulir ke kartu SEKALI per aktivasi fokus, bukan tiap status dimuat ulang', () => {
    // Temuan review akhir: selama Settings terbuka dari klik notifikasi, tiap status yang dimuat
    // ulang (detak di latar, saklar, "Periksa sekarang") menggulir halaman kembali ke kartu.
    // `render` meniru efek kartu: ref `sudah` + hasil `gulir` per render.
    let sudah = false
    const render = (fokus: boolean, termuat: boolean): boolean => {
      const l = langkahGulir(sudah, fokus, termuat)
      sudah = l.sudah
      return l.gulir
    }
    assert.equal(render(false, true), false, 'Settings dibuka biasa: tidak menggulir')
    assert.equal(render(true, false), false, 'dari klik notifikasi: tunggu kartunya termuat')
    assert.equal(render(true, true), true, 'termuat: gulir sekali')
    assert.equal(render(true, true), false, 'status dimuat ulang: tidak menggulir lagi')
    assert.equal(render(true, true), false)
    assert.equal(render(false, true), false, 'keluar dari Settings')
    assert.equal(render(true, true), true, 'klik notifikasi berikutnya: gulir lagi, sekali')
  })

  test('waktu ringkas relatif ke hari ini', () => {
    const kini = t(2026, 10, 20, 11, 0).getTime()
    assert.equal(waktuRingkas(t(2026, 10, 20, 10, 32).getTime(), kini), 'today 10:32')
    assert.equal(waktuRingkas(t(2026, 10, 19, 9, 5).getTime(), kini), 'yesterday 09:05')
    assert.equal(waktuRingkas(t(2026, 10, 17, 10, 0).getTime(), kini), 'Sat Oct 17 10:00')
  })
})

describe('pemantau: kartu Settings (render)', () => {
  // tsx mengompilasi JSX berkas renderer dengan runtime KLASIK (`React.createElement`) —
  // `jsx: react-jsx` di tsconfig.web.json tidak terbaca dari test. `React` global hanya
  // untuk render statis di test ini; efek (IPC `window.aira`) tidak dijalankan.
  ;(globalThis as { React?: unknown }).React = React

  test('sebelum status termuat kartu TIDAK tampil — tanpa "Memuat…" sekilas bagi user tanpa menu Sales/TAT', () => {
    // Temuan review akhir: kartu "Memuat…" muncul lalu hilang lagi untuk user yang tidak
    // punya satu pun pemicu.
    assert.equal(renderToStaticMarkup(React.createElement(PemantauPanel, { onAksi: () => undefined })), '')
  })
})

describe('pemantau: pegangan notifikasi (klik dari Action Center)', () => {
  // Review akhir: objek Notification yang tidak dipegang bisa dibuang GC, dan klik dari
  // Action Center (berjam-jam kemudian) tidak pernah sampai — "klik untuk menggali" mati.
  const toast = (): { close: () => void; ditutup: boolean } => {
    const n = { ditutup: false, close: () => void (n.ditutup = true) }
    return n
  }

  test('dipegang sampai diklik', () => {
    const p = buatPegangan<ReturnType<typeof toast>>()
    const a = toast()
    p.pegang(a, 'pemantau', 'budi')
    assert.equal(p.jumlah(), 1)
    p.lepas(a)
    assert.equal(p.jumlah(), 0)
    assert.equal(a.ditutup, false, 'melepas pegangan tidak menutup toast')
  })

  test('berbatas: yang paling lama dilepas, TIDAK ditutup', () => {
    const p = buatPegangan<ReturnType<typeof toast>>(2)
    const [a, b, c] = [toast(), toast(), toast()]
    for (const n of [a, b, c]) p.pegang(n, 'pemantau', 'budi')
    assert.equal(p.jumlah(), 2)
    assert.equal(a.ditutup, false)
  })

  test('menutup hanya toast grup itu milik user lain (ganti user / logout)', () => {
    const p = buatPegangan<ReturnType<typeof toast>>()
    const [milikBudi, milikAndi, chatAndi] = [toast(), toast(), toast()]
    p.pegang(milikBudi, 'pemantau', 'budi')
    p.pegang(milikAndi, 'pemantau', 'andi')
    p.pegang(chatAndi, null, 'andi')
    assert.equal(p.tutupMilikSelain('pemantau', 'budi'), 1)
    assert.deepEqual([milikBudi.ditutup, milikAndi.ditutup, chatAndi.ditutup], [false, true, false])
    assert.equal(p.tutupMilikSelain('pemantau', null), 1, 'tanpa sesi: semua toast pemantau ditutup')
    assert.equal(milikBudi.ditutup, true)
    assert.equal(p.jumlah(), 1)
  })
})

describe('pemantau: sambungan (sumber)', () => {
  test('notify menjalankan onClick sesudah jendela dimunculkan & difokuskan', () => {
    const teks = readFileSync('src/main/notify.ts', 'utf8')
    assert.match(teks, /onClick\?: \(\) => void/)
    assert.match(teks, /notification\.on\('click'[\s\S]*?window\.focus\(\)[\s\S]*?onClick\?\.\(\)/)
    assert.match(teks, /if \(!window\.isVisible\(\)\) window\.show\(\)/)
    // Klik toast tercatat di log: tanpa itu "layar berpindah sendiri" tidak bisa
    // dibedakan dari klik sidebar (terjadi saat uji aplikasi 20 Okt 2026).
    assert.match(teks, /notification\.on\('click'[\s\S]*?logger\(\)\.info\(\{ title \}, 'notifikasi diklik'\)/)
    // Dipegang selama punya aksi klik; dilepas saat diklik.
    assert.match(teks, /if \(onClick\) pegangan\.pegang\(notification, grup \?\? null, pemilik \?\? null\)/)
    assert.match(teks, /notification\.on\('click'[\s\S]*?pegangan\.lepas\(notification\)/)
  })

  test('layar awal Sales: isi dari klik notifikasi membuang periode yang tadi dipilih', () => {
    // Temuan review akhir: "(periode: bulan ini)" yang tersisa ikut tertempel saat dikirim ke
    // pertanyaan perbandingan dua tanggal dari notifikasi — pertanyaannya jadi bertentangan.
    const teks = readFileSync('src/renderer/src/views/SalesHome.tsx', 'utf8')
    const awal = teks.indexOf('if (!isiAwal) return')
    const akhir = teks.indexOf('}, [isiAwal])', awal)
    assert.ok(awal > 0 && akhir > awal, 'efek isiAwal ditemukan')
    const efek = teks.slice(awal, akhir)
    assert.match(efek, /setText\(isiAwal\.teks\)/)
    assert.match(efek, /setPeriode\(''\)/)
  })

  test('kartu Pemantau menggulir HANYA lewat langkahGulir (sekali per aktivasi fokus), dan LANGSUNG', () => {
    const teks = readFileSync('src/renderer/src/components/PemantauPanel.tsx', 'utf8')
    assert.equal(teks.split('scrollIntoView').length - 1, 1, 'satu-satunya pemanggil gulir')
    const awal = teks.indexOf('langkahGulir(')
    assert.ok(awal > 0, 'efek gulir memakai langkahGulir')
    // Terukur dari aplikasi 20 Okt 2026: panel Super Admin di atas kartu selesai dimuat ±0,5 dtk
    // sesudah guliran dimulai; animasi 'smooth' berhenti di posisi lama dan kartu terdorong
    // ±3.600 px keluar layar. Guliran langsung dijaga scroll anchoring Chromium (kartu tetap di 10 px).
    assert.match(
      teks.slice(awal, teks.indexOf('scrollIntoView') + 60),
      /if \(l\.gulir\) kartu\.current\?\.scrollIntoView\(\{ behavior: 'auto'/
    )
  })

  test('jadwal menutup toast pemantau saat tidak ada sesi (logout)', () => {
    const teks = readFileSync('src/main/jadwal/service.ts', 'utf8')
    assert.match(teks, /if \(!sesi\) \{\s*(\/\/[^\n]*\n\s*)*tutupNotifikasiPemantau\(\)/)
  })

  test('jadwal memanggil pemantau hanya saat tidak ada tugas jatuh tempo', () => {
    const teks = readFileSync('src/main/jadwal/service.ts', 'utf8')
    assert.match(teks, /if \(!baris\) \{\s*await periksaPemantau\(\)/)
  })

  test('IPC: setel divalidasi Zod dengan daftar pemicu & ketiga handler wajibLogin (aturan 11)', () => {
    const teks = readFileSync('src/main/ipc.ts', 'utf8')
    const awal = teks.indexOf('IPC_CHANNELS.pemantauStatus')
    const akhir = teks.indexOf('IPC_CHANNELS.pemantauPeriksa', awal)
    assert.ok(awal > 0 && akhir > awal, 'ketiga handler pemantau terdaftar berurutan')
    const blok = teks.slice(awal, teks.indexOf('\n  })', akhir) + 5)
    assert.equal(blok.split('wajibLogin()').length - 1, 3)
    assert.match(blok, /z\.object\(\{ id: z\.enum\(PEMICU_PEMANTAU\), aktif: z\.boolean\(\) \}\)\.parse\(raw\)/)
  })

  test('preload mengekspos kelima fungsi pemantau', () => {
    const teks = readFileSync('src/preload/index.ts', 'utf8')
    for (const f of ['pemantauStatus:', 'pemantauSetel:', 'pemantauPeriksa:', 'onPemantauBuka:', 'onPemantauBerubah:']) {
      assert.ok(teks.includes(f), f)
    }
    assert.match(teks, /ipcRenderer\.on\(IPC_CHANNELS\.pemantauBuka/)
    assert.match(teks, /ipcRenderer\.removeListener\(IPC_CHANNELS\.pemantauBuka/)
  })

  test('tanpa koneksi serentak; mode uji hanya di dev', () => {
    for (const berkas of ['src/main/pemantau/service.ts', 'src/main/pemantau/nyata.ts']) {
      const teks = readFileSync(berkas, 'utf8')
      assert.doesNotMatch(teks, /Promise\.all|new Pool|\.connect\(/, berkas)
    }
    const nyata = readFileSync('src/main/pemantau/nyata.ts', 'utf8')
    assert.equal(nyata.split('process.env.AIRA_PEMANTAU_UJI').length - 1, 1)
    assert.match(nyata, /function modeUji\(\)[^{]*\{\s*if \(app\.isPackaged\) return \{ sales: false, lab: false \}/)
  })
})
