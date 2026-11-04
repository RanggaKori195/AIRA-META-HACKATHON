// node scripts/tour.mjs — records a short click-through of the Reagent Check screens (dev app, CDP 9222, dummy data):
// run the check, open the Evidence of a finding, then Voice recount with the demo transcript typed in (no mic).
// Output: rec/tour/{frames/*.jpg, frames.json, events.json} — the same shape record.mjs writes, for prepare.ts.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

const OUT = 'rec/tour'
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && t.url.startsWith('http://localhost:5173'))
if (!page) throw new Error('The AIRA dev app is not running with --remoteDebuggingPort 9222.')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const frames = []
const events = []
let recording = false
rmSync(OUT, { recursive: true, force: true })
mkdirSync(join(OUT, 'frames'), { recursive: true })
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d)
    pending.delete(d.id)
  } else if (d.method === 'Page.screencastFrame') {
    send('Page.screencastFrameAck', { sessionId: d.params.sessionId })
    if (!recording) return
    const file = `f${String(frames.length).padStart(5, '0')}.jpg`
    writeFileSync(join(OUT, 'frames', file), Buffer.from(d.params.data, 'base64'))
    frames.push({ file, t: d.params.metadata.timestamp * 1000 })
  }
}
await new Promise((r) => (ws.onopen = r))
function send(method, params = {}) {
  return new Promise((r) => {
    const i = ++id
    pending.set(i, r)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
}
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed')
  return r.result?.result?.value
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const mark = (name) => {
  events.push({ t: Date.now(), kind: 'event', name })
  console.log(`  ${name}`)
}
const click = (text, nth = 0) =>
  js(`(() => { const b = [...document.querySelectorAll('button,a,[role=tab]')].filter(e => e.innerText.trim() === ${JSON.stringify(text)} && e.offsetParent)[${nth}]; if (!b) throw new Error('no button ' + ${JSON.stringify(text)}); b.scrollIntoView({ block: 'center' }); b.click(); return true })()`)
async function until(label, cond, ms = 60000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await js(cond)) return
    await wait(300)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

const text = readFileSync('../demo-data/reagent/voice-count-2026-10.txt', 'utf8').trim()
try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
  await send('Page.bringToFront')
  await send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 })
  await wait(800)
  recording = true
  const startedAt = Date.now()
  await click('Reagent Check')
  await wait(1500)
  await click('Run reconciliation')
  await until('findings', `/Wrong item code/.test(document.body.innerText) && /Evidence/.test(document.body.innerText)`)
  mark('tour:findings')
  await wait(2500)
  // The Evidence of the second finding (factor too high): the exact workbook row.
  await click('Evidence', 1)
  await wait(1200)
  mark('tour:evidence')
  await wait(5000)
  await click('Voice recount')
  await wait(1500)
  mark('tour:recount')
  // Typed in a few chunks so the viewer sees the transcript arrive (the real screen accepts typing or pasting).
  const lines = text.split(/\r?\n/)
  for (let i = 1; i <= lines.length; i++) {
    const part = lines.slice(0, i).join('\n')
    await js(`(() => { const t = [...document.querySelectorAll('textarea')].find(x => x.placeholder.startsWith('The transcript')); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, ${JSON.stringify(part)}); t.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
    await wait(250)
  }
  await wait(800)
  await click('Read counts')
  await until('the recount comparison', `document.body.innerText.includes('Differs')`)
  mark('tour:compared')
  await wait(1500)
  await js(`[...document.querySelectorAll('td, div, span')].find(e => e.children.length === 0 && e.textContent.trim() === 'Differs')?.scrollIntoView({ block: 'center', behavior: 'smooth' })`)
  await wait(1200)
  mark('tour:differs')
  await wait(4500)
  if (await js(`document.body.innerText.includes('Sign-in History')`)) throw new Error('Sign-in History was on screen.')
  recording = false
  await send('Page.stopScreencast')
  writeFileSync(join(OUT, 'frames.json'), JSON.stringify({ startedAt, endedAt: Date.now(), frames }, null, 1))
  writeFileSync(join(OUT, 'events.json'), JSON.stringify(events, null, 1))
  console.log(`Tour done: ${frames.length} frames, ${((Date.now() - startedAt) / 1000).toFixed(1)} s`)
} finally {
  recording = false
  await send('Page.stopScreencast').catch(() => {})
  await send('Emulation.clearDeviceMetricsOverride').catch(() => {})
  ws.close()
}
