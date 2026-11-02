// Penanganan percakapan yang melebihi context window model.
//
// Dulu gejalanya: user hanya melihat "LLM_BAD_RESPONSE: LLM returned HTTP 400" —
// tidak ada penjelasan, tidak ada jalan keluar, dan jawabannya hilang. Untuk aplikasi
// yang dipakai manajemen, itu memalukan sekaligus tidak bisa ditindaklanjuti.
//
// Tiga lapis penanganan:
//   1. KENALI  — baca body errornya, bedakan overflow dari kegagalan HTTP 400 lain
//   2. PULIHKAN— pangkas riwayat lama lalu ulangi sekali, jangan langsung menyerah
//   3. JELASKAN— kalau tetap gagal, sampaikan dalam bahasa manusia + saran tindakan
//
// Modul murni (tanpa I/O) supaya ter-cover unit test.

/** Giliran percakapan, sebentuk dengan ChatTurn di provider LLM. */
export interface Giliran {
  role: string
  content?: unknown
  tool_call_id?: string
  [key: string]: unknown
}

/**
 * Pola pesan "context penuh" dari vLLM / OpenAI-compatible gateway. Sengaja beberapa
 * varian: teksnya berbeda antar versi vLLM, dan LiteLLM kadang membungkusnya lagi.
 */
const POLA_OVERFLOW = [
  /maximum context length/i,
  /context[_ ]length[_ ]exceeded/i,
  /reduce the length of the messages/i,
  /too many tokens/i,
  /input is too long/i,
  /prompt is too long/i,
  /exceeds? the (model|maximum) (context|token)/i,
  /token limit/i
]

/**
 * Apakah kegagalan ini karena percakapan terlalu panjang?
 *
 * HTTP 400 saja TIDAK cukup — gateway juga mengembalikan 400 untuk argumen tool yang
 * salah bentuk atau model yang tidak dikenal. Salah menuduh "percakapan kepanjangan"
 * akan menyuruh user memulai chat baru padahal masalahnya lain.
 */
export function isContextOverflow(status: number, body: string): boolean {
  if (status !== 400 && status !== 413) return false
  const teks = String(body ?? '')
  return POLA_OVERFLOW.some((p) => p.test(teks))
}

/**
 * Mengambil pesan yang berguna dari body error gateway.
 *
 * Body-nya bisa panjang (kadang memuat seluruh prompt) dan bentuknya berbeda-beda:
 * vLLM memakai {error:{message}}, LiteLLM kadang {message}, FastAPI {detail}.
 * Dipendekkan supaya tidak membanjiri log maupun layar.
 */
export function ringkasPesanError(body: string): string {
  const teks = String(body ?? '').replace(/\s+/g, ' ').trim()
  if (!teks) return ''
  try {
    const j = JSON.parse(teks)
    const pesan = j?.error?.message ?? j?.message ?? j?.detail
    if (typeof pesan === 'string' && pesan.trim()) return pesan.trim().slice(0, 300)
  } catch {
    // bukan JSON — pakai teks mentahnya
  }
  return teks.slice(0, 300)
}

/**
 * Memangkas riwayat agar muat, TANPA merusak struktur percakapan.
 *
 * ⚠️ Tidak boleh memotong sembarangan: pesan `tool` wajib didahului pesan assistant
 * yang memuat tool_calls-nya. Potongan yang diawali `tool` akan ditolak gateway dengan
 * 400 lagi — jadi errornya berganti wujud, bukan hilang. Karena itu setelah dipotong,
 * awal potongan digeser maju sampai bertemu giliran `user`.
 *
 * Giliran `system` (indeks 0) selalu dipertahankan: di situlah seluruh aturan perilaku.
 */
export function pangkasRiwayat<T extends { role: string }>(history: T[], sisakan: number): T[] {
  if (history.length === 0) return history
  const adaSystem = history[0]?.role === 'system'
  const system = adaSystem ? [history[0]] : []
  const sisa = adaSystem ? history.slice(1) : history
  if (sisa.length <= sisakan) return history

  const potong = sisa.slice(-Math.max(sisakan, 1))
  // Geser maju ke giliran `user` pertama supaya potongan tidak diawali `tool`/`assistant`.
  const mulai = potong.findIndex((g) => g.role === 'user')
  const aman = mulai >= 0 ? potong.slice(mulai) : potong.filter((g) => g.role === 'user')
  // Kalau sama sekali tidak ada giliran user tersisa, pertahankan yang terakhir saja
  // daripada mengirim percakapan tanpa pertanyaan.
  return [...system, ...(aman.length > 0 ? aman : sisa.slice(-1))]
}

/** Berapa giliran yang disisakan pada percobaan pemulihan ke-n (1-based). */
export function sisaGiliranUntukPercobaan(percobaan: number): number {
  return percobaan <= 1 ? 8 : 3
}

/** Pesan yang ditempelkan ke jawaban saat riwayat dipangkas — user berhak tahu. */
export const CATATAN_DIPANGKAS =
  'This conversation has grown too long to process in one go, so its earliest part was ' +
  'set aside so the latest question could still be answered. If the answer seems to ' +
  'have lost context, start a new conversation and restate the important points.'

/**
 * Pesan gagal dalam bahasa manusia + saran tindakan. Kode teknisnya tetap dicatat di
 * log dan audit, tapi yang dilihat user harus bisa ditindaklanjuti.
 */
export function pesanUntukUser(code: string, message: string): string {
  switch (code) {
    case 'LLM_CONTEXT_OVERFLOW':
      return (
        'This conversation is too long for the model to process, even after its earliest part ' +
        'was trimmed. Start a new conversation with "New Task", then restate the important points ' +
        'you still need. Attaching a very large file can also be the cause.'
      )
    case 'LLM_UNREACHABLE':
      return (
        'Cannot reach the AI server. Check your network connection.'
      )
    case 'LLM_AUTH_FAILED':
      return 'The AI server rejected the app credentials. Contact the IT team to renew the access key.'
    case 'LLM_RATE_LIMITED':
      return 'The AI server is receiving too many requests. Try again in a moment.'
    case 'LLM_TRUNCATED':
      return (
        'The AI model used up its output limit before it wrote anything (its internal reasoning took ' +
        'all of it). Try again, and ask for something narrower if it keeps happening.'
      )
    case 'LLM_CANCELLED':
      return 'The request was stopped.'
    case 'LLM_BAD_RESPONSE':
      return `The AI server returned a response that was not recognised. Technical details: ${message}`
    default:
      return `An unexpected error occurred. Technical details: ${message}`
  }
}
