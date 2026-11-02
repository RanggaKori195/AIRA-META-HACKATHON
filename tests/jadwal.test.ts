import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import {
  JadwalError,
  TOLAK_TERJADWAL,
  berikutnya,
  jatuhTempo,
  menitTerlambat,
  pastikanPola,
  uraianPola
} from '../src/main/jadwal/rules'

// Semua tanggal lokal (zona waktu laptop), sama seperti penjadwalnya.
const t = (y: number, mo: number, d: number, h = 0, mi = 0): Date => new Date(y, mo - 1, d, h, mi)

describe('jadwal: berikutnya', () => {
  test('harian: hari ini bila jamnya belum lewat, besok bila sudah', () => {
    const pola = { jenis: 'harian' as const, jam: '08:00' }
    assert.deepEqual(berikutnya(pola, t(2026, 9, 29, 7, 0)), t(2026, 9, 29, 8, 0))
    assert.deepEqual(berikutnya(pola, t(2026, 9, 29, 9, 0)), t(2026, 9, 30, 8, 0))
  })

  test('TEPAT pada jamnya dihitung ke jadwal berikutnya, bukan menit yang sama (tidak berputar)', () => {
    const pola = { jenis: 'harian' as const, jam: '08:00' }
    assert.deepEqual(berikutnya(pola, t(2026, 9, 29, 8, 0)), t(2026, 9, 30, 8, 0))
  })

  test('hari kerja melompati Sabtu & Minggu', () => {
    // 2 Okt 2026 = Jumat
    const pola = { jenis: 'hari_kerja' as const, jam: '16:00' }
    assert.deepEqual(berikutnya(pola, t(2026, 10, 2, 17, 0)), t(2026, 10, 5, 16, 0))
  })

  test('mingguan: hari terdekat dari daftar', () => {
    // 29 Sep 2026 = Selasa. Senin & Kamis -> Kamis 1 Okt.
    const pola = { jenis: 'mingguan' as const, hari: [1, 4], jam: '08:00' }
    assert.deepEqual(berikutnya(pola, t(2026, 9, 29, 10, 0)), t(2026, 10, 1, 8, 0))
    // Kamis sesudah jam 8 -> Senin berikutnya.
    assert.deepEqual(berikutnya(pola, t(2026, 10, 1, 9, 0)), t(2026, 10, 5, 8, 0))
  })

  test('bulanan tanggal 31 jatuh ke hari terakhir bulan yang pendek, tidak melompati bulan', () => {
    const pola = { jenis: 'bulanan' as const, tanggal: 31, jam: '07:30' }
    assert.deepEqual(berikutnya(pola, t(2026, 2, 1)), t(2026, 2, 28, 7, 30))
    assert.deepEqual(berikutnya(pola, t(2026, 9, 29)), t(2026, 9, 30, 7, 30))
    assert.deepEqual(berikutnya(pola, t(2026, 9, 30, 8, 0)), t(2026, 10, 31, 7, 30))
  })

  test('bulanan: sudah lewat bulan ini -> bulan depan, pergantian tahun benar', () => {
    const pola = { jenis: 'bulanan' as const, tanggal: 1, jam: '07:30' }
    assert.deepEqual(berikutnya(pola, t(2026, 12, 5)), t(2027, 1, 1, 7, 30))
  })

  test('sekali: null bila waktunya sudah lewat', () => {
    const pola = { jenis: 'sekali' as const, tanggal: '2026-10-01', jam: '09:00' }
    assert.deepEqual(berikutnya(pola, t(2026, 9, 29)), t(2026, 10, 1, 9, 0))
    assert.equal(berikutnya(pola, t(2026, 10, 1, 9, 0)), null)
  })
})

describe('jadwal: validasi pola', () => {
  test('jam, tanggal, dan hari yang tidak sah ditolak', () => {
    assert.throws(() => pastikanPola({ jenis: 'harian', jam: '24:00' }), JadwalError)
    assert.throws(() => pastikanPola({ jenis: 'harian', jam: '8:00' }), JadwalError)
    assert.throws(() => pastikanPola({ jenis: 'sekali', tanggal: '2026-02-30', jam: '08:00' }), JadwalError)
    assert.throws(() => pastikanPola({ jenis: 'mingguan', hari: [], jam: '08:00' }), JadwalError)
    assert.throws(() => pastikanPola({ jenis: 'mingguan', hari: [7], jam: '08:00' }), JadwalError)
    assert.throws(() => pastikanPola({ jenis: 'bulanan', tanggal: 0, jam: '08:00' }), JadwalError)
  })

  test('hari mingguan dirapikan (urut, tanpa dobel)', () => {
    const p = pastikanPola({ jenis: 'mingguan', hari: [4, 1, 4], jam: '08:00' })
    assert.deepEqual(p.jenis === 'mingguan' && p.hari, [1, 4])
  })

  test('uraian terbaca manusia', () => {
    assert.equal(uraianPola({ jenis: 'mingguan', hari: [1, 4], jam: '08:00' }), 'Every Monday & Thursday, 08:00')
    assert.match(uraianPola({ jenis: 'bulanan', tanggal: 31, jam: '07:30' }), /last day of the month/)
  })
})

describe('jadwal: jatuh tempo & susulan', () => {
  test('hanya tugas aktif yang waktunya sudah tiba', () => {
    assert.equal(jatuhTempo(1000, true, 1000), true)
    assert.equal(jatuhTempo(1001, true, 1000), false)
    assert.equal(jatuhTempo(1000, false, 5000), false)
    assert.equal(jatuhTempo(null, true, 5000), false)
  })

  test('laptop mati seminggu: susulan SEKALI, jadwal berikutnya dihitung dari sekarang', () => {
    // Pola ini yang dipakai penjadwal: sesudah jalan, `berikut` = berikutnya(pola, SEKARANG).
    const pola = { jenis: 'harian' as const, jam: '08:00' }
    const nyala = t(2026, 10, 6, 10, 0)
    assert.deepEqual(berikutnya(pola, nyala), t(2026, 10, 7, 8, 0))
  })

  test('jitter pemeriksaan bukan keterlambatan; laptop mati adalah keterlambatan', () => {
    assert.equal(menitTerlambat(0, 60_000), 0)
    assert.equal(menitTerlambat(0, 2 * 3600_000), 120)
  })
})

describe('jadwal: tanpa penonton tidak ada operasi berisiko', () => {
  test('orchestrator menolak mutate/execute & permintaan login untuk run terjadwal', () => {
    const src = readFileSync('src/main/agent/orchestrator.ts', 'utf8')
    assert.match(src, /\(tier === 'mutate' \|\| tier === 'execute'\) && runState\.terjadwal/)
    assert.match(src, /if \(runState\.terjadwal\) return null/)
    // Pesan penolakan menyebut jalan keluarnya, supaya model tidak mengarang alasan.
    assert.match(TOLAK_TERJADWAL, /user sendiri/)
  })

  test('penjadwal hanya menjalankan tugas milik user yang sedang login', () => {
    const src = readFileSync('src/main/jadwal/service.ts', 'utf8')
    assert.match(src, /WHERE username = \? AND aktif = 1 AND berikut IS NOT NULL AND berikut <= \?/)
    // Kepemilikan di klausa WHERE untuk ubah & hapus.
    assert.match(src, /DELETE FROM jadwal WHERE id = \? AND username = \?/)
    assert.match(src, /SELECT \* FROM jadwal WHERE id = \? AND username = \?/)
  })

  test('mode diperiksa lagi saat JALAN, bukan hanya saat disimpan', () => {
    const src = readFileSync('src/main/jadwal/service.ts', 'utf8')
    const jalankan = src.slice(src.indexOf('async function jalankan('))
    assert.match(jalankan, /bolehModeSekarang\(mode\)/)
  })
})

// ------------------------------------------------------------ kalender & "Minta AIRA menjadwalkan"
import { kejadianDalam as kejadian, tafsirkanKalimat } from '../src/shared/jadwal-pola'

describe('jadwal: kejadian dalam rentang (kalender)', () => {
  test('hari kerja September 2026 = 22 kali, tanpa Sabtu/Minggu', () => {
    const k = kejadian({ jenis: 'hari_kerja', jam: '09:00' }, t(2026, 9, 1), t(2026, 10, 1))
    assert.equal(k.length, 22)
    assert.ok(k.every((d) => d.getDay() >= 1 && d.getDay() <= 5))
  })

  test('kejadian TEPAT di awal rentang ikut terhitung', () => {
    const k = kejadian({ jenis: 'harian', jam: '00:00' }, t(2026, 9, 29), t(2026, 9, 30))
    assert.deepEqual(k, [t(2026, 9, 29)])
  })

  test('sekali: tepat satu kejadian', () => {
    const k = kejadian({ jenis: 'sekali', tanggal: '2026-10-01', jam: '09:00' }, t(2026, 9, 1), t(2026, 12, 1))
    assert.deepEqual(k, [t(2026, 10, 1, 9, 0)])
  })
})

describe('jadwal: tafsirkan kalimat bebas', () => {
  const kini = t(2026, 9, 29, 10, 0) // Selasa

  test('pengingat bulanan dengan jam', () => {
    const r = tafsirkanKalimat('ingatkan saya setiap tanggal 1 jam 8 untuk kirim laporan sales', kini)
    assert.equal(r.jenis, 'pengingat')
    assert.equal(r.mode, 'general')
    assert.deepEqual(r.pola, { jenis: 'bulanan', tanggal: 1, jam: '08:00' })
    assert.equal(r.prompt, 'kirim laporan sales')
  })

  test('setiap Senin pagi + kosakata sales -> tugas AIRA di menu Sales', () => {
    const r = tafsirkanKalimat('setiap Senin pagi buatkan ringkasan sales minggu lalu', kini)
    assert.equal(r.jenis, 'aira')
    assert.equal(r.mode, 'sales')
    assert.deepEqual(r.pola, { jenis: 'mingguan', hari: [1], jam: '08:00' })
  })

  test('"setiap minggu" tanpa nama hari = mingguan (Senin), bukan hari Minggu', () => {
    const r = tafsirkanKalimat('cek backlog sampel setiap minggu', kini)
    assert.deepEqual(r.pola, { jenis: 'mingguan', hari: [1], jam: '08:00' })
    assert.equal(r.mode, 'lab')
  })

  test('beberapa hari + jam sore', () => {
    const r = tafsirkanKalimat('tiap Selasa dan Kamis jam 4 sore ingatkan rapat', kini)
    assert.deepEqual(r.pola, { jenis: 'mingguan', hari: [2, 4], jam: '16:00' })
  })

  test('hari kerja & besok', () => {
    assert.deepEqual(tafsirkanKalimat('setiap hari kerja jam 07.30 cek backlog', kini).pola, {
      jenis: 'hari_kerja',
      jam: '07:30'
    })
    assert.deepEqual(tafsirkanKalimat('besok jam 9 ingatkan kirim email ke manajer', kini).pola, {
      jenis: 'sekali',
      tanggal: '2026-09-30',
      jam: '09:00'
    })
  })

  test('tanpa keterangan waktu -> pola null (tidak ditebak)', () => {
    const r = tafsirkanKalimat('buatkan ringkasan dokumen rapat', kini)
    assert.equal(r.pola, null)
    assert.equal(r.prompt, 'buatkan ringkasan dokumen rapat')
  })
})
