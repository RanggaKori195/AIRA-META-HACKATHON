// Guard: pertanyaan angka penjualan tidak boleh dijawab dengan mengaduk folder dokumen.
//
// Regresi nyata (18 Agustus 2026): "Item apa yang trennya menurun dibanding bulan lalu?"
// dijawab dengan search_docs → list_dir → read_excel → read_pdf, lalu AIRA menyimpulkan
// "data tidak ada" — padahal jawabannya ada di database dan tool sales_movers tersedia.
//
// Sesuai pola project: imbauan di prompt tidak cukup, penolakan di level tool selalu
// bekerja. Pesan penolakan sekaligus memberi tahu tool mana yang benar.

import { isSalesQuestion } from './tool-groups'
import { adalahModeData } from './mode-data'

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
  /^(\W*)(halo|hallo|hai|hi|hei|hello|pagi|selamat\s+(pagi|siang|sore|malam)|assalamu?'?alaikum|siapa\s+kamu|kamu\s+siapa|kenalan|perkenalkan|kamu\s+bisa\s+apa|apa\s+(saja\s+)?yang\s+bisa\s+kamu|bisa\s+bantu\s+apa|fungsi\s*(mu|kamu)|terima\s*kasih|makasih|thanks|thank\s+you|oke?|sip|mantap|siap|baik|test|tes|hey|good\s+(morning|afternoon|evening)|who\s+are\s+you|what\s+(can|do)\s+you\s+do|how\s+can\s+you\s+help|nice\s+to\s+meet\s+you|okay|great|cool)\b/i

/** Kosakata yang menandakan kalimat itu sebenarnya meminta data. */
const MINTA_DATA =
  /\b(sales|penjualan|omzet|omset|revenue|pendapatan|invoice|order|transaksi|pelanggan|customer|item|produk|pemeriksaan|harga|price|laporan|report|target|proyeksi|ramalan|forecast|tren|trend|growth|ytd|bulan|tahun|kuartal|cabang|wilayah|provinsi|kota|berapa|analisa|analisis|tat|backlog|orders?|customers?|items?|products?|tests|prices?|reports?|months?|years?|quarters?|weeks?|branch(es)?|regions?|provinces?|cit(y|ies)|how\s+(many|much)|analy[sz]e|analysis|samples?|today|yesterday|stock|reagents?)\b/i

/** Batas panjang. Kalimat panjang yang diawali "halo" hampir selalu tetap berisi pertanyaan. */
const MAKS_BASA_BASI = 120

/**
 * tool_choice for one model call. A pure greeting in a data menu gets NO tools on the first call: with tools
 * offered, Muse Wonder answered "hi, who are you?" by also pulling today's sales (measured 2 Nov 2026) —
 * a database query and seconds of latency for a greeting.
 */
export function toolChoiceUntuk(o: {
  paksa: boolean
  mode: string | undefined
  pertanyaan: string
  iterasi: number
}): 'auto' | 'required' | 'none' {
  if (o.paksa) return 'required'
  if (o.iterasi === 0 && adalahModeData(o.mode) && sapaanUtuh(o.pertanyaan)) return 'none'
  return 'auto'
}

/**
 * One greeting / small-talk phrase, anchored on BOTH ends (checked per chunk by `sapaanUtuh`).
 *
 * ⚠️ Final review 2 Nov 2026: `toolChoiceUntuk` used `hanyaBasaBasi`, which only looks at how the message
 * STARTS. "great, now break it down by payer" / "ok, and the top 5?" / "oke, kalau Surabaya?" — follow-ups
 * that begin with a courtesy word — were sent with NO tools, so the model answered a data follow-up from
 * memory. Removing tools is a guard that FORCES behaviour, so it must only fire when the whole message is
 * a greeting.
 */
const FRASA_SAPAAN =
  /^(?:halo|hallo|hai|hi|hei|hey|hello|pagi|selamat\s+(?:pagi|siang|sore|malam)|assalamu'?alaikum|siapa\s+kamu|kamu\s+siapa|kenalan(?:\s+dong)?|perkenalkan(?:\s+diri(?:mu)?)?|kamu\s+bisa\s+apa(?:\s+saja)?|apa\s+(?:saja\s+)?yang\s+bisa\s+kamu(?:\s+(?:lakukan|bantu|kerjakan))?|bisa\s+bantu\s+apa(?:\s+saja)?|fungsi\s*(?:mu|kamu)\s*(?:apa)?|terima\s*kasih|makasih|thanks|thank\s+you|oke?|okay|sip|mantap|siap|baik|test|tes|good\s+(?:morning|afternoon|evening)|who\s+are\s+you|what\s+(?:can|do)\s+you\s+do|how\s+can\s+you\s+help(?:\s+me)?|nice\s+to\s+meet\s+you|great|cool)(?:\s+(?:aira|there|team|kak|semua|all))?$/i

/**
 * True only when EVERY chunk of the message (split on punctuation) is a greeting phrase:
 * "hi, who are you?" → true; "hi, what about RSUP Kariadi?" → false.
 */
export function sapaanUtuh(teks: string): boolean {
  const t = teks.trim()
  if (!t || t.length > MAKS_BASA_BASI) return false
  const potongan = t
    .split(/[^\p{L}\p{N}\s']+/u)
    .map((k) => k.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
  return potongan.length > 0 && potongan.every((k) => FRASA_SAPAAN.test(k))
}

/**
 * Apakah pesan ini sapaan/basa-basi murni, sehingga jawaban tanpa tool memang
 * yang benar di mode data. (Dipakai untuk melewati guard anti-halu; untuk
 * mencabut tool dipakai `sapaanUtuh` yang lebih ketat.)
 */
export function hanyaBasaBasi(teks: string): boolean {
  const t = teks.trim()
  if (!t || t.length > MAKS_BASA_BASI) return false
  if (MINTA_DATA.test(t)) return false
  return BASA_BASI.test(t)
}
