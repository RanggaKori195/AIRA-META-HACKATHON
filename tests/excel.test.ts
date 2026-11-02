import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { rapikanSheet } from '../src/main/tools/doc-tools'

// Test regresi kerapian file Excel yang dihasilkan AIRA.
//
// Kerapian dikerjakan KODE, bukan diserahkan ke model lewat parameter tambahan —
// file yang dikirim ke manajemen harus rapi SETIAP kali, bukan kalau modelnya
// ingat mengisi parameter. Karena itu aturannya layak dikunci di sini.

const sheetDari = (rows: unknown[][]): ExcelJS.Worksheet => {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Uji')
  for (const r of rows) ws.addRow(r)
  rapikanSheet(ws)
  return ws
}

describe('header', () => {
  const ws = sheetDari([
    ['Pelanggan', 'Nett'],
    ['RS Kariadi', 1_234_567],
    ['RS Brawijaya', 890_123]
  ])

  test('tebal, putih, berlatar hijau the lab', () => {
    const h = ws.getRow(1)
    assert.equal(h.font?.bold, true)
    assert.equal((h.font?.color as { argb?: string })?.argb, 'FFFFFFFF')
    assert.equal((h.fill as ExcelJS.FillPattern)?.fgColor?.argb, 'FF2F6F3E')
  })

  test('dibekukan supaya tetap terlihat saat digulir', () => {
    assert.equal(ws.views?.[0]?.state, 'frozen')
    assert.equal((ws.views?.[0] as { ySplit?: number })?.ySplit, 1)
  })

  test('filter otomatis dipasang — orang bisa langsung menyaring & mengurutkan', () => {
    assert.ok(ws.autoFilter)
  })
})

describe('kolom angka', () => {
  test('diberi pemisah ribuan dan rata kanan', () => {
    const ws = sheetDari([
      ['Pelanggan', 'Nett'],
      ['RS A', 1_234_567],
      ['RS B', 890_123]
    ])
    assert.equal(ws.getColumn(2).numFmt, '#,##0')
    assert.equal(ws.getColumn(2).alignment?.horizontal, 'right')
  })

  test('kolom teks TIDAK dipaksa format angka', () => {
    const ws = sheetDari([
      ['Pelanggan', 'Nett'],
      ['RS A', 1_000]
    ])
    assert.equal(ws.getColumn(1).numFmt, undefined)
  })

  test('kolom campur angka & teks dibiarkan apa adanya', () => {
    // Memaksa format angka pada kolom yang memuat teks akan menyembunyikan isi
    // yang sebenarnya — "belum ada" bisa tampil sebagai sel kosong.
    const ws = sheetDari([
      ['Item', 'Nilai'],
      ['A', 1_000],
      ['B', 'belum ada']
    ])
    assert.equal(ws.getColumn(2).numFmt, undefined)
  })

  test('angka disimpan sebagai ANGKA, bukan teks', () => {
    // Angka yang disimpan sebagai teks tidak bisa dijumlahkan penerimanya —
    // keluhan klasik penerima laporan.
    const ws = sheetDari([
      ['Pelanggan', 'Nett'],
      ['RS A', 1_234_567]
    ])
    assert.equal(typeof ws.getCell(2, 2).value, 'number')
  })
})

describe('lebar kolom', () => {
  test('mengikuti isi terpanjang, tidak dipatok satu ukuran', () => {
    const ws = sheetDari([
      ['Pemeriksaan', 'Kode'],
      ['HPV DNA Genotyping + LBC Thinprep', 'A1']
    ])
    assert.ok(ws.getColumn(1).width! > ws.getColumn(2).width!)
  })

  test('sel berisi kalimat panjang tidak melebarkan kolom tanpa batas', () => {
    const ws = sheetDari([['Catatan'], ['x'.repeat(400)]])
    assert.ok(ws.getColumn(1).width! <= 42)
  })

  test('kolom berisi sangat pendek tetap punya lebar minimum yang wajar', () => {
    const ws = sheetDari([['A'], ['b']])
    assert.ok(ws.getColumn(1).width! >= 10)
  })
})

describe('kasus batas', () => {
  test('sheet kosong tidak melempar', () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Kosong')
    assert.doesNotThrow(() => rapikanSheet(ws))
  })

  test('sheet hanya berisi header tidak dipasangi filter', () => {
    // AutoFilter pada tabel tanpa isi membingungkan saat dibuka.
    const ws = sheetDari([['A', 'B']])
    // ExcelJS mengembalikan `null` (bukan `undefined`) untuk filter yang belum
    // dipasang — jadi yang diperiksa "tidak ada isinya", bukan tipenya.
    assert.ok(!ws.autoFilter, String(ws.autoFilter))
  })

  test('sel kosong tidak membuat kolom angka dianggap teks', () => {
    const ws = sheetDari([
      ['Bulan', 'Nett'],
      ['Jan', 1_000],
      ['Feb', null],
      ['Mar', 3_000]
    ])
    assert.equal(ws.getColumn(2).numFmt, '#,##0')
  })
})
