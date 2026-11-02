// Membuktikan --enable-prefix-caching benar-benar bekerja, dari sisi klien.
//
// Caranya: kirim AWALAN yang sama persis dua kali, ukur TTFT (time to first token).
// Kalau cache kena, panggilan kedua jauh lebih cepat karena KV cache awalannya
// tidak dihitung ulang. Panggilan ketiga memakai awalan BERBEDA sebagai kontrol —
// tanpa itu, "yang kedua lebih cepat" bisa saja cuma efek pemanasan biasa.
//
// Jalankan: node scripts/probe-prefix-cache.mjs
import { readFileSync } from 'fs'

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
)
const { AIRA_ENDPOINT: ENDPOINT, AIRA_API_KEY: KEY, AIRA_MODEL: MODEL } = env

/** Awalan besar & unik. Angka acak supaya tidak tercampur cache uji sebelumnya. */
function awalan(tanda) {
  const baris = []
  for (let i = 0; i < 1400; i++) {
    baris.push(`${tanda}-${i}: laporan pemeriksaan laboratorium pelanggan wilayah bulan nilai nett`)
  }
  return baris.join('\n')
}

/** Mengirim streaming, mengembalikan ms sampai token PERTAMA tiba. */
async function ttft(label, prefix, tanya) {
  const t0 = Date.now()
  const res = await fetch(`${ENDPOINT}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      max_tokens: 8,
      messages: [
        { role: 'system', content: prefix },
        { role: 'user', content: tanya }
      ]
    })
  })
  if (!res.ok) {
    console.log(`  ${label}: HTTP ${res.status} — ${(await res.text()).slice(0, 160)}`)
    return null
  }
  const reader = res.body.getReader()
  let pertama = null
  let promptTokens = null
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const teks = Buffer.from(value).toString('utf8')
    if (pertama === null && /"(content|reasoning_content)"\s*:\s*"[^"]/.test(teks)) {
      pertama = Date.now() - t0
    }
    const m = teks.match(/"prompt_tokens"\s*:\s*(\d+)/)
    if (m) promptTokens = Number(m[1])
  }
  const total = Date.now() - t0
  console.log(
    `  ${label.padEnd(34)} TTFT ${String(pertama ?? total).padStart(5)} ms   total ${String(total).padStart(5)} ms` +
      (promptTokens ? `   prompt_tokens=${promptTokens}` : '')
  )
  return pertama ?? total
}

const TANDA = Math.random().toString(36).slice(2, 8)
const A = awalan(TANDA)
const B = awalan(Math.random().toString(36).slice(2, 8))

console.log(`endpoint: ${ENDPOINT}   model: ${MODEL}`)
console.log(`\nAwalan uji ± ${Math.round(A.length / 4).toLocaleString('id-ID')} token (perkiraan)\n`)

const t1 = await ttft('1. awalan A (pertama kali)', A, 'Balas satu kata: SATU')
const t2 = await ttft('2. awalan A LAGI (sama persis)', A, 'Balas satu kata: DUA')
const t3 = await ttft('3. awalan B (berbeda) - kontrol', B, 'Balas satu kata: TIGA')
const t4 = await ttft('4. awalan A sekali lagi', A, 'Balas satu kata: EMPAT')

console.log('\n--- kesimpulan ---')
if (t1 && t2 && t3) {
  const hemat = (((t1 - t2) / t1) * 100).toFixed(0)
  console.log(`  A pertama : ${t1} ms`)
  console.log(`  A diulang : ${t2} ms  (${hemat}% lebih cepat)`)
  console.log(`  B berbeda : ${t3} ms  <- kontrol, harusnya kembali lambat`)
  if (t4) console.log(`  A lagi    : ${t4} ms`)
  const cacheKena = t2 < t1 * 0.6 && t3 > t2 * 1.4
  console.log(
    '\n  ' +
      (cacheKena
        ? 'PREFIX CACHING AKTIF — awalan sama jauh lebih cepat, awalan beda kembali lambat.'
        : 'BELUM TERBUKTI aktif — selisihnya tidak berpola seperti cache.')
  )
}
