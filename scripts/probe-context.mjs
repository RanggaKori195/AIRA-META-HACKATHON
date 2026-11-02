// Mengukur BATAS MASUKAN (context window) gateway — bukan batas keluaran.
//
// ⚠️ Dua hal berbeda yang sering tertukar:
//   max_tokens     = berapa model MENULIS  -> sudah terbukti tanpa batas
//   context window = berapa model MEMBACA  -> inilah yang membatasi baca PDF besar
//
// Jalankan: node scripts/probe-context.mjs
//
// Hasil terukur 9 Sep 2026: context window = 131.072 token (128k).
// 127.614 token diterima; di atas itu HTTP 400 ContextWindowExceededError.
import { readFileSync } from 'fs'

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
)

const ENDPOINT = env.AIRA_ENDPOINT
const KEY = env.AIRA_API_KEY
const MODEL = env.AIRA_MODEL

// Teks pengisi. Kata acak supaya tidak terkompresi jadi sedikit token.
const KATA = 'laporan penjualan pemeriksaan laboratorium pelanggan wilayah bulan tahun nilai '
function isian(perkiraanToken) {
  // ±1,4 token per kata Indonesia -> dibuat berlebih lalu dipotong.
  return KATA.repeat(Math.ceil(perkiraanToken / 10)).slice(0, perkiraanToken * 4)
}

async function uji(targetToken) {
  const body = {
    model: MODEL,
    max_tokens: 16,
    messages: [
      { role: 'user', content: 'Balas satu kata: OK.\n\n' + isian(targetToken) }
    ]
  }
  const t0 = Date.now()
  try {
    const res = await fetch(`${ENDPOINT}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body)
    })
    const teks = await res.text()
    const dtk = ((Date.now() - t0) / 1000).toFixed(1)
    if (!res.ok) {
      const pesan = teks.replace(/\s+/g, ' ').slice(0, 260)
      console.log(`  ~${String(targetToken).padStart(7)} token -> HTTP ${res.status} (${dtk} dtk)\n      ${pesan}`)
      return false
    }
    const j = JSON.parse(teks)
    console.log(
      `  ~${String(targetToken).padStart(7)} token -> OK  prompt_tokens=${j.usage?.prompt_tokens} (${dtk} dtk)`
    )
    return true
  } catch (e) {
    console.log(`  ~${String(targetToken).padStart(7)} token -> GAGAL: ${e.message}`)
    return false
  }
}

console.log(`endpoint: ${ENDPOINT}   model: ${MODEL}\n`)
console.log('Menaikkan ukuran MASUKAN sampai ditolak:\n')
for (const n of [16_000, 64_000, 128_000, 200_000, 280_000, 400_000]) {
  const ok = await uji(n)
  if (!ok) {
    console.log('\nBatas masukan tercapai di sekitar ukuran di atas.')
    break
  }
}
