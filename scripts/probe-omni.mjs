// Menguji model old-image-model LANGSUNG ke gateway the company — tanpa lewat AIRA.
// Jalankan: node scripts/probe-omni.mjs
//
// Yang dijawab probe ini:
//   1. old-image-model benar-benar terdaftar di /v1/models?
//   2. Ia bisa dipakai untuk chat biasa? Mendukung TOOL CALLING? (penting:
//      old-vision-model tidak, aturan 2 — jadi jangan diandaikan)
//   3. Bagaimana cara memintanya menghasilkan GAMBAR: endpoint
//      /v1/images/generations, atau chat completions dengan `modalities`?
//   4. Gambarnya kembali sebagai apa: base64 atau URL, dan formatnya apa
//      (diperiksa dari magic byte, bukan dari nama — pelajaran §24c).
import { readFileSync, writeFileSync, mkdirSync } from 'fs'

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
)
const ENDPOINT = env.AIRA_ENDPOINT
const KEY = env.AIRA_API_KEY
const MODEL = process.argv[2] ?? 'old-image-model'
const OUT = (process.env.TEMP || '.') + '/aira-omni'
mkdirSync(OUT, { recursive: true })

const H = { 'content-type': 'application/json', authorization: `Bearer ${KEY}` }

function jenisGambar(buf) {
  const h = buf.subarray(0, 12)
  if (h[0] === 0x89 && h[1] === 0x50) return 'PNG'
  if (h[0] === 0xff && h[1] === 0xd8) return 'JPEG'
  if (h.subarray(0, 4).toString('ascii') === 'RIFF' && h.subarray(8, 12).toString('ascii') === 'WEBP')
    return 'WEBP'
  if (h.subarray(0, 5).toString('ascii') === '<?xml' || h.subarray(0, 4).toString('ascii') === '<svg')
    return 'SVG'
  return `TIDAK DIKENAL (${[...h.subarray(0, 6)].map((b) => b.toString(16)).join(' ')})`
}

async function panggil(label, url, body) {
  const t0 = Date.now()
  try {
    const res = await fetch(url, { method: 'POST', headers: H, body: JSON.stringify(body) })
    const teks = await res.text()
    const ms = Date.now() - t0
    if (!res.ok) {
      console.log(`\n[${label}] HTTP ${res.status} (${ms} ms)\n  ${teks.slice(0, 400)}`)
      return null
    }
    let j
    try {
      j = JSON.parse(teks)
    } catch {
      console.log(`\n[${label}] OK ${ms} ms tapi bukan JSON: ${teks.slice(0, 200)}`)
      return null
    }
    console.log(`\n[${label}] OK — ${ms} ms`)
    return j
  } catch (err) {
    console.log(`\n[${label}] GAGAL: ${String(err).slice(0, 200)}`)
    return null
  }
}

/** Menyimpan gambar apa pun yang ditemukan di dalam respons, di mana pun letaknya. */
function simpanGambar(j, nama) {
  const hasil = []
  const lihat = (nilai, jalur) => {
    if (typeof nilai === 'string') {
      const m = nilai.match(/^data:(image\/[a-z+]+);base64,(.+)$/s)
      const b64 = m ? m[2] : /^[A-Za-z0-9+/=\s]{2000,}$/.test(nilai) ? nilai : null
      if (b64) {
        const buf = Buffer.from(b64.replace(/\s/g, ''), 'base64')
        const f = `${OUT}/${nama}-${hasil.length + 1}.bin`
        writeFileSync(f, buf)
        hasil.push({ jalur, bytes: buf.length, jenis: jenisGambar(buf), file: f })
      } else if (/^https?:\/\/\S+\.(png|jpg|jpeg|webp)/i.test(nilai)) {
        hasil.push({ jalur, url: nilai })
      }
      return
    }
    if (Array.isArray(nilai)) return nilai.forEach((v, i) => lihat(v, `${jalur}[${i}]`))
    if (nilai && typeof nilai === 'object') {
      for (const [k, v] of Object.entries(nilai)) lihat(v, `${jalur}.${k}`)
    }
  }
  lihat(j, '')
  return hasil
}

// ---------------------------------------------------------------- 1. daftar model
console.log(`Gateway: ${ENDPOINT}\nModel diuji: ${MODEL}`)
try {
  const res = await fetch(`${ENDPOINT}/v1/models`, { headers: H })
  const j = await res.json()
  const nama = (j.data ?? []).map((m) => m.id)
  console.log(`\n[models] HTTP ${res.status} — ${nama.length} model:`)
  for (const n of nama) console.log(`  - ${n}${n === MODEL ? '   <-- yang dicari' : ''}`)
  if (!nama.includes(MODEL)) console.log(`  ⚠️ "${MODEL}" TIDAK ada di daftar`)
} catch (err) {
  console.log(`[models] GAGAL: ${String(err).slice(0, 200)}`)
}

// ---------------------------------------------------------------- 2. chat teks biasa
const teks = await panggil('chat teks', `${ENDPOINT}/v1/chat/completions`, {
  model: MODEL,
  messages: [{ role: 'user', content: 'Jawab satu kata: siap' }],
  stream: false
})
if (teks) {
  const c = teks.choices?.[0]
  console.log(`  content: ${JSON.stringify(c?.message?.content ?? '').slice(0, 200)}`)
  console.log(`  finish_reason: ${c?.finish_reason} · usage: ${JSON.stringify(teks.usage ?? {})}`)
}

// ---------------------------------------------------------------- 3. tool calling
const tool = await panggil('tool calling', `${ENDPOINT}/v1/chat/completions`, {
  model: MODEL,
  messages: [{ role: 'user', content: 'Berapa sales bulan Agustus? Pakai tool yang ada.' }],
  tools: [
    {
      type: 'function',
      function: {
        name: 'sales_summary',
        description: 'Ringkasan penjualan satu periode',
        parameters: {
          type: 'object',
          properties: { period: { type: 'string' } },
          required: ['period']
        }
      }
    }
  ],
  tool_choice: 'auto',
  stream: false
})
if (tool) {
  const c = tool.choices?.[0]
  console.log(`  tool_calls: ${JSON.stringify(c?.message?.tool_calls ?? null).slice(0, 300)}`)
  console.log(`  finish_reason: ${c?.finish_reason}`)
}

// ---------------------------------------------------------------- 4. gambar: /v1/images/generations
const img = await panggil('images/generations', `${ENDPOINT}/v1/images/generations`, {
  model: MODEL,
  prompt: 'Logo sederhana tabung reaksi laboratorium, latar putih, warna hijau tosca',
  n: 1,
  size: '512x512'
})
if (img) {
  const g = simpanGambar(img, 'images-generations')
  console.log(`  kunci respons: ${Object.keys(img).join(', ')}`)
  console.log(`  gambar ditemukan: ${g.length}`)
  for (const x of g) console.log(`    ${JSON.stringify(x)}`)
  if (g.length === 0) console.log(`  respons: ${JSON.stringify(img).slice(0, 400)}`)
}

// ------------------------------------------------- 5. gambar lewat chat + modalities
const chatImg = await panggil('chat modalities', `${ENDPOINT}/v1/chat/completions`, {
  model: MODEL,
  messages: [
    {
      role: 'user',
      content: 'Gambarkan logo sederhana tabung reaksi laboratorium, latar putih, warna hijau tosca'
    }
  ],
  modalities: ['text', 'image'],
  stream: false
})
if (chatImg) {
  const g = simpanGambar(chatImg, 'chat-modalities')
  const c = chatImg.choices?.[0]
  console.log(`  content (200 pertama): ${JSON.stringify(c?.message?.content ?? '').slice(0, 200)}`)
  console.log(`  kunci message: ${Object.keys(c?.message ?? {}).join(', ')}`)
  console.log(`  gambar ditemukan: ${g.length}`)
  for (const x of g) console.log(`    ${JSON.stringify(x)}`)
}

// ------------------------------------------------- 6. vision: apakah bisa MEMBACA gambar
const png1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
const vision = await panggil('vision (baca gambar)', `${ENDPOINT}/v1/chat/completions`, {
  model: MODEL,
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Warna gambar ini apa? Satu kata.' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${png1x1}` } }
      ]
    }
  ],
  stream: false
})
if (vision) {
  console.log(`  content: ${JSON.stringify(vision.choices?.[0]?.message?.content ?? '').slice(0, 200)}`)
}

console.log(`\nBerkas hasil (bila ada) di: ${OUT}`)
