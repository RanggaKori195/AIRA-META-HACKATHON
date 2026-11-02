// Guard: pertanyaan angka penjualan tidak boleh dijawab dengan mengaduk folder dokumen.
//
// Regresi nyata (18 Agustus 2026): "Item apa yang trennya menurun dibanding bulan lalu?"
// dijawab dengan search_docs → list_dir → read_excel → read_pdf, lalu AIRA menyimpulkan
// "data tidak ada" — padahal jawabannya ada di database dan tool sales_movers tersedia.
//
// Sesuai pola project: imbauan di prompt tidak cukup, penolakan di level tool selalu
// bekerja. Pesan penolakan sekaligus memberi tahu tool mana yang benar.

import { isSalesQuestion } from './tool-groups'

/** Tool penjelajah dokumen yang menjadi jalan sesat untuk pertanyaan penjualan. */
const DOC_TOOLS = new Set(['search_docs', 'list_dir', 'search_files'])

/**
 * Kalau user memang menyebut dokumen/file, pencarian dokumen justru yang diminta —
 * guard tidak boleh ikut campur di situ.
 */
const DOC_INTENT =
  /\b(dokumen|document|file|berkas|folder|direktori|laporan\s+\w*\.?(xlsx|pdf|docx)?|excel|xlsx|pdf|word|docx|ppt|pptx|lampiran|attachment)\b/i

/**
 * Mengembalikan pesan penolakan bila tool dokumen dipakai untuk pertanyaan penjualan,
 * atau null bila panggilan itu wajar.
 */
export function blockDocSearchForSales(toolName: string, userText: string): string | null {
  if (!DOC_TOOLS.has(toolName)) return null
  if (!isSalesQuestion(userText)) return null
  if (DOC_INTENT.test(userText)) return null
  return (
    `${toolName} ditolak: ini pertanyaan data penjualan, dan angkanya ADA di database — ` +
    'bukan di file dokumen. Pakai tool sales: sales_summary (total), sales_compare (banding periode), ' +
    'sales_breakdown (rincian per item/pelanggan/cabang; sort="bottom" untuk yang paling sedikit), ' +
    'sales_trend (deret waktu), sales_movers (item yang naik & turun antar periode). ' +
    'Panggil tool sales yang sesuai sekarang, JANGAN mencari dokumen dan JANGAN bilang datanya tidak ada.'
  )
}

// ---------------------------------------------------------------------------

/**
 * Sapaan / basa-basi yang TIDAK meminta data sama sekali.
 *
 * ⚠️ Dilaporkan user 25 Agu 2026. Di mode data, jawaban tanpa tool dibuang dan
 * model dipaksa memanggil tool (guard anti-halu, 18 Agu). Untuk "halo siapa
 * kamu" itu berarti: model menjawab BENAR tanpa tool, jawabannya dibuang, lalu
 * ia dipaksa memanggil tool apa pun — dan yang dipilih `analisa_lintas_perspektif`
 * dengan item "EKG" (contoh yang kebetulan ada di deskripsi tool). Hasilnya
 * 18 detik, dua panggilan model, dan tujuh query database untuk sebuah sapaan.
 *
 * Guard anti-halu itu sendiri BENAR dan tidak boleh dilonggarkan secara umum:
 * di mode data, angka dari ingatan model lebih berbahaya daripada tidak
 * menjawab. Yang salah adalah menerapkannya pada kalimat yang tidak meminta
 * angka apa pun.
 *
 * Karena itu pengecualiannya SEMPIT dan berlapis: harus pendek, harus cocok
 * pola basa-basi, DAN tidak boleh memuat satu pun kosakata data. Kalimat
 * seperti "halo, berapa sales bulan ini" tetap kena guard.
 */
const BASA_BASI =
  /^(\W*)(halo|hallo|hai|hi|hei|hello|pagi|selamat\s+(pagi|siang|sore|malam)|assalamu?'?alaikum|siapa\s+kamu|kamu\s+siapa|kenalan|perkenalkan|kamu\s+bisa\s+apa|apa\s+(saja\s+)?yang\s+bisa\s+kamu|bisa\s+bantu\s+apa|fungsi\s*(mu|kamu)|terima\s*kasih|makasih|thanks|thank\s+you|oke?|sip|mantap|siap|baik|test|tes)\b/i

/** Kosakata yang menandakan kalimat itu sebenarnya meminta data. */
const MINTA_DATA =
  /\b(sales|penjualan|omzet|omset|revenue|pendapatan|invoice|order|transaksi|pelanggan|customer|item|produk|pemeriksaan|harga|price|laporan|report|target|proyeksi|ramalan|forecast|tren|trend|growth|ytd|bulan|tahun|kuartal|cabang|wilayah|provinsi|kota|berapa|analisa|analisis|tat|backlog)\b/i

/** Batas panjang. Kalimat panjang yang diawali "halo" hampir selalu tetap berisi pertanyaan. */
const MAKS_BASA_BASI = 120

/**
 * Apakah pesan ini sapaan/basa-basi murni, sehingga jawaban tanpa tool memang
 * yang benar di mode data.
 */
export function hanyaBasaBasi(teks: string): boolean {
  const t = teks.trim()
  if (!t || t.length > MAKS_BASA_BASI) return false
  if (MINTA_DATA.test(t)) return false
  return BASA_BASI.test(t)
}
