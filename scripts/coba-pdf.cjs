// Bukti bahwa pembuatan PDF benar-benar bekerja — dijalankan di runtime
// ELECTRON, bukan Node biasa, karena `printToPDF` butuh Chromium.
//
// Jalankan:  npm run coba:pdf
//
// Kenapa ada: pelajaran berulang di project ini adalah "jalan di skrip, gagal di
// aplikasi". Modul PDF diuji unit test hanya sampai Markdown -> HTML; yang
// TIDAK bisa dibuktikan unit test adalah bahwa Chromium mau memuat halamannya,
// mencetaknya, dan menghasilkan berkas PDF yang sah. Itu yang dibuktikan di sini.
//
// Skripnya memuat kode PDF yang SUDAH DI-BUNDLE dari sumber TypeScript-nya
// (lihat script npm), jadi yang diuji memang kode yang dipakai aplikasi — bukan
// salinan yang bisa menyimpang diam-diam.

// Log dimatikan SEBELUM kode main dimuat: skrip ini keluar segera setelah
// selesai, dan tujuan log asinkron pino belum tentu sempat siap — lihat
// catatan di src/main/logger.ts.
process.env.AIRA_LOG_SILENT = '1'

const { app } = require('electron')
const { join } = require('path')
const { tmpdir } = require('os')
const { statSync, readFileSync, unlinkSync } = require('fs')

const { tulisPdfDariMarkdown } = require('./.pdf-bundle.cjs')

const CONTOH = `# Laporan Penjualan the lab

Periode: 1-20 Agustus 2026 - basis invoice

## Ringkasan Eksekutif

Nett **Rp 4.988.000.000** dari 6.171 order. Proyeksi tutup bulan
Rp 8.168.000.000, atau *19,4% di bawah* tren 12 bulan terakhir.

## Pemeriksaan Terbesar

| Pemeriksaan | Nett | Order |
|---|---|---|
| HPV DNA Genotyping + LBC Thinprep | 7.460.000.000 | 1.234 |
| KALCT - Jaringan Small | 2.440.000.000 | 890 |
| Liquid Based Cytology (LBC) | 1.050.000.000 | 456 |
| HPV DNA Genotyping | 900.000.000 | 321 |

## Catatan Metodologi

- Basis invoice (date_result); transaksi yang dibatalkan dikeluarkan
- Angka disusun oleh tool, bukan disalin model
- Perbandingan periode disetarakan panjang harinya

## Lampiran

Teks yang panjang untuk menguji pemenggalan halaman. ${'Kalimat percobaan. '.repeat(220)}

### Penutup

Laporan ini dihasilkan otomatis oleh AIRA.
`

app.whenReady().then(async () => {
  const keluar = join(tmpdir(), `aira-coba-${Date.now()}.pdf`)
  let kode = 0
  try {
    const hasil = await tulisPdfDariMarkdown(CONTOH, keluar, {
      judul: 'Laporan Penjualan the lab',
      subjudul: '1-20 Agustus 2026 · basis invoice',
      catatanKaki: 'Laporan Penjualan - AIRA'
    })

    const ukuran = statSync(keluar).size
    const kepala = readFileSync(keluar).subarray(0, 5).toString('latin1')

    const cek = (nama, ok, detail) => {
      console.log(`${ok ? 'OK   ' : 'GAGAL'} ${nama}${detail ? ' — ' + detail : ''}`)
      if (!ok) kode = 1
    }

    cek('berkas PDF terbentuk', ukuran > 0, `${(ukuran / 1024).toFixed(1)} KB`)
    cek('berkasnya PDF yang sah', kepala === '%PDF-', `header "${kepala}"`)
    cek('lebih dari satu halaman (pemenggalan bekerja)', hasil.halaman > 1, `${hasil.halaman} halaman`)
    cek('jumlah halaman terbaca, bukan ditaksir', Number.isInteger(hasil.halaman))

    // ⚠️ Pemeriksaan font WAJIB ada di sini, bukan cukup dilihat sekali.
    // Kegagalan memuat font itu SUNYI: PDF tetap terbit, ukurannya mirip, dan
    // satu-satunya bedanya adalah hurufnya. Terjadi nyata 21 Agu 2026 —
    // seluruh dokumen tercetak dengan Segoe UI dan tidak ada satu pun pesan.
    const isi = readFileSync(keluar).toString('latin1')
    const font = [...new Set((isi.match(/\/BaseFont\s*\/[A-Za-z0-9+\-,._]+/g) || [])
      .map((x) => x.split('+').pop()))]
    // Hackathon build: system font Segoe UI, no company font.
    cek('font Segoe UI tertanam di PDF', font.some((f) => f.includes('SegoeUI')), font.join(', '))
    cek(
      'tidak ada font perusahaan atau serif cadangan',
      !font.some((f) => /the company|Times/i.test(f)),
      font.join(', ')
    )
    console.log(`\nBerkas contoh: ${keluar}`)
    console.log('Buka dan LIHAT hasilnya — ini bagian yang tidak bisa dibuktikan test.')
  } catch (err) {
    console.error('GAGAL:', err)
    kode = 1
  }
  app.exit(kode)
})
