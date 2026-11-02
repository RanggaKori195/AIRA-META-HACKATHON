// Menguji LANGSUNG ke gateway: apakah keluaran dibatasi, dan apa finish_reason-nya.
// Tidak lewat AIRA sama sekali — supaya yang terukur gateway, bukan kode kita.
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

async function uji(label, body) {
  const t0 = Date.now()
  const res = await fetch(`${ENDPOINT}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    console.log(`${label}: HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`)
    return
  }
  const j = await res.json()
  const c = j.choices?.[0]
  const isi = c?.message?.content ?? ''
  const nalar = c?.message?.reasoning_content ?? ''
  console.log(
    `${label}\n` +
      `   finish_reason   : ${c?.finish_reason}\n` +
      `   completion_tokens: ${j.usage?.completion_tokens}\n` +
      `   isi              : ${isi.length} char\n` +
      `   reasoning        : ${nalar.length} char\n` +
      `   durasi           : ${((Date.now() - t0) / 1000).toFixed(1)} dtk`
  )
}

const panjang = {
  model: MODEL,
  messages: [
    {
      role: 'user',
      content:
        'Tulis daftar 120 nomor, satu per baris, dari 1 sampai 120, masing-masing ' +
        'diikuti satu kalimat penjelasan panjang tentang angka itu. Jangan disingkat.'
    }
  ]
}

console.log(`endpoint: ${ENDPOINT}  model: ${MODEL}\n`)
await uji('[1] TANPA max_tokens (persis seperti AIRA sekarang)', panjang)
await uji('[2] max_tokens: 100 (pembanding — pasti kena batas)', { ...panjang, max_tokens: 100 })
await uji('[3] max_tokens: 8000 (eksplisit besar)', { ...panjang, max_tokens: 8000 })
