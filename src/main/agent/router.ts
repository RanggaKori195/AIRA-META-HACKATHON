// Pemilihan model per pesan. Tujuannya: pertanyaan ringan dijawab model cepat
// (~0,7 detik) alih-alih model reasoning (~4 detik), tanpa mengorbankan kualitas
// pada task agentic. Modul murni supaya ter-cover unit test.

export type ModelRole = 'chat' | 'agent' | 'coder'
export type ModelChoice = 'auto' | ModelRole

const CODING_HINT =
  /\b(kode|koding|coding|source ?code|script|program|fungsi|function|method|class|refactor|debug|bug|error|exception|compile|build|npm|yarn|pip|python|typescript|javascript|java|golang|git|commit|repo|endpoint|query sql|schema|migration|unit test)\b|\.(ts|tsx|js|jsx|py|java|cs|go|rb|php|sql|json|ya?ml|sh|bat|ps1)\b/i

const ACTION_HINT =
  /\b(buka|bukakan|baca|bacakan|rapikan|rapihkan|cari|carikan|temukan|buat|buatkan|bikin|jalankan|eksekusi|cek|periksa|hapus|pindah|pindahkan|ganti|ubah|edit|update|susun|analisis|analisa|ringkas|rangkum|tulis|tuliskan|simpan|ekspor|konversi|convert|indeks|index|query|tes|test|kirim|unduh|download|bandingkan)\b/i

// Path Windows/UNC atau URL menandakan pekerjaan yang butuh tool.
const RESOURCE_HINT = /[a-zA-Z]:\\|\\\\[^\\]|https?:\/\//

export interface RouteInput {
  text: string
  hasAttachments: boolean
  /** Sesi ini sudah pernah memakai tool -> pertahankan model agent. */
  sessionUsedTools: boolean
}

export function routeModel(input: RouteInput): ModelRole {
  const text = input.text

  if (CODING_HINT.test(text)) return 'coder'
  if (input.hasAttachments || input.sessionUsedTools) return 'agent'
  if (ACTION_HINT.test(text) || RESOURCE_HINT.test(text)) return 'agent'

  // Pertanyaan/percakapan biasa tanpa tanda pekerjaan -> model cepat.
  return 'chat'
}

export function resolveRole(choice: ModelChoice, input: RouteInput): ModelRole {
  return choice === 'auto' ? routeModel(input) : choice
}
