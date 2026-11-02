// Lanjutan probe old-image-model: parameter apa saja yang benar-benar didukung.
// node scripts/probe-omni2.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'fs'

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
)
const ENDPOINT = env.AIRA_ENDPOINT
const H = { 'content-type': 'application/json', authorization: `Bearer ${env.AIRA_API_KEY}` }
const OUT = 'C:/Users/Admin/AppData/Local/Temp/claude/omni'
mkdirSync(OUT, { recursive: true })

const PROMPT = 'Ikon sederhana mikroskop, gaya flat, warna hijau tosca, latar putih'

async function gen(label, body, simpanKe) {
  const t0 = Date.now()
  const res = await fetch(`${ENDPOINT}/v1/images/generations`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ model: 'old-image-model', prompt: PROMPT, ...body })
  })
  const ms = Date.now() - t0
  const teks = await res.text()
  if (!res.ok) {
    console.log(`${label.padEnd(34)} HTTP ${res.status} (${ms} ms) — ${teks.slice(0, 160).replace(/\s+/g, ' ')}`)
    return null
  }
  const j = JSON.parse(teks)
  const n = (j.data ?? []).length
  const buf = j.data?.[0]?.b64_json ? Buffer.from(j.data[0].b64_json, 'base64') : null
  const dim = buf && buf[1] === 0x50 ? `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}` : '?'
  const kb = buf ? Math.round(buf.length / 1024) : 0
  console.log(
    `${label.padEnd(34)} OK ${String(ms).padStart(6)} ms · ${n} gambar · ${dim} · ${kb} KB · ` +
      `size=${j.size} quality=${j.quality} fmt=${j.output_format} bg=${j.background} ` +
      `usage=${JSON.stringify(j.usage ?? {})}`
  )
  if (buf && simpanKe) writeFileSync(`${OUT}/${simpanKe}`, buf)
  return { j, buf }
}

console.log('--- ukuran')
await gen('size 1024x1024', { size: '1024x1024' }, 'sz-1024.png')
await gen('size 1536x1024 (landscape)', { size: '1536x1024' }, 'sz-1536.png')
await gen('size 256x256', { size: '256x256' })
await gen('tanpa size', {})

console.log('\n--- jumlah & format')
await gen('n=2', { size: '512x512', n: 2 })
await gen('response_format=url', { size: '512x512', response_format: 'url' })
await gen('output_format=jpeg', { size: '512x512', output_format: 'jpeg' }, 'fmt.jpeg')
await gen('background=transparent', { size: '512x512', background: 'transparent' }, 'transparan.png')

console.log('\n--- kualitas')
await gen('quality=low', { size: '512x512', quality: 'low' })
await gen('quality=high', { size: '512x512', quality: 'high' })

console.log('\n--- teks di dalam gambar (uji kemampuan)')
await gen(
  'tulisan "the lab"',
  { size: '512x512', prompt: 'Spanduk sederhana bertuliskan "the lab" huruf tebal, latar hijau tosca' },
  'teks.png'
)

console.log('\n--- edit gambar (images/edits, multipart)')
try {
  const asal = readFileSync(`${OUT}/hasil1.png`)
  const fd = new FormData()
  fd.append('model', 'old-image-model')
  fd.append('image', new Blob([asal], { type: 'image/png' }), 'asal.png')
  fd.append('prompt', 'Ubah warna cairan di tabung jadi merah')
  fd.append('size', '512x512')
  const t0 = Date.now()
  const res = await fetch(`${ENDPOINT}/v1/images/edits`, {
    method: 'POST',
    headers: { authorization: H.authorization },
    body: fd
  })
  const ms = Date.now() - t0
  const teks = await res.text()
  if (!res.ok) {
    console.log(`images/edits                       HTTP ${res.status} (${ms} ms) — ${teks.slice(0, 200).replace(/\s+/g, ' ')}`)
  } else {
    const j = JSON.parse(teks)
    const buf = Buffer.from(j.data[0].b64_json, 'base64')
    writeFileSync(`${OUT}/edit.png`, buf)
    console.log(`images/edits                       OK ${ms} ms · ${Math.round(buf.length / 1024)} KB -> edit.png`)
  }
} catch (err) {
  console.log(`images/edits GAGAL: ${String(err).slice(0, 200)}`)
}
