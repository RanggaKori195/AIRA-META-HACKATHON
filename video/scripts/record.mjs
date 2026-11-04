// node scripts/record.mjs — records one take of the live demo from the dev app (CDP port 9222, dummy data).
// Sets the call name, clears today's briefing marker, injects scripts/harness.js (fake mic queue + audio capture +
// screen moments), screencasts 1920×1080 frames, reloads so AIRA really starts, and drives only what a person would:
// clicking the mascot for the next request. Any step that does not happen fails the take, naming it.
// Output: rec/take/{frames/*.jpg, frames.json, events.json, audio/aira-N.mp3}. Never shows Settings › Sign-in History.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'
import { afterClip, takeProblems } from '../src/harness-queue.ts'

const OUT = 'rec/take'
const voices = JSON.parse(readFileSync('src/voices.json', 'utf8'))
const ORDER = ['user-reagent', 'user-summary', 'user-sales']
const clips = ORDER.map((id) => {
  const v = voices.find((x) => x.id === id)
  if (!v) throw new Error(`${id} is missing from src/voices.json — run npm run voices.`)
  return { id, b64: readFileSync(join('public', v.file)).toString('base64') }
})
const harness = readFileSync('scripts/harness.js', 'utf8').replace('/*CLIPS*/ []', JSON.stringify(clips))

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && t.url.startsWith('http://localhost:5173'))
if (!page) throw new Error('The AIRA dev app is not running with --remoteDebuggingPort 9222.')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const events = []
const frames = []
const audio = new Map()
let recording = false
rmSync(OUT, { recursive: true, force: true })
mkdirSync(join(OUT, 'frames'), { recursive: true })
mkdirSync(join(OUT, 'audio'), { recursive: true })

ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d)
    pending.delete(d.id)
    return
  }
  if (d.method === 'Page.screencastFrame') {
    const { data, metadata, sessionId } = d.params
    send('Page.screencastFrameAck', { sessionId })
    if (!recording) return
    const file = `f${String(frames.length).padStart(5, '0')}.jpg`
    writeFileSync(join(OUT, 'frames', file), Buffer.from(data, 'base64'))
    frames.push({ file, t: metadata.timestamp * 1000 })
  } else if (d.method === 'Runtime.bindingCalled' && d.params.name === '__take') {
    const e = JSON.parse(d.params.payload)
    if (e.kind === 'aira-audio') {
      const file = `aira-${e.id}.mp3`
      writeFileSync(join(OUT, 'audio', file), Buffer.from(e.b64, 'base64'))
      audio.set(e.id, file)
      delete e.b64
      e.file = file
    }
    events.push(e)
    console.log(`  ${new Date(e.t).toISOString().slice(11, 23)} ${e.kind}${e.name ? ' ' + e.name : ''}${e.id ? ' #' + e.id : ''}`)
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
const has = (pred) => events.some(pred)
async function until(label, pred, ms) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const homeAt = events.findIndex((e) => e.name === 'home')
    if (homeAt >= 0 && events.slice(homeAt).some((e) => e.kind === 'visibility' && e.state === 'hidden')) throw new Error('The AIRA window went hidden during the take (frames stop) — keep it in front and run again.')
    checkProblems()
    if (pred()) return
    await wait(200)
  }
  const last = events.slice(-10).map((e) => `${e.kind}${e.name ? ' ' + e.name : ''}`).join(', ')
  throw new Error(`Timed out waiting for ${label}. Last events: ${last || 'none'}`)
}
/** Clicks the mascot like a person would; clicks again if it did not start listening (it can still be busy). */
async function clickMascot(label) {
  for (let i = 0; i < 4; i++) {
    await js(`document.querySelector('.mascot-figure')?.click()`)
    const t0 = Date.now()
    while (Date.now() - t0 < 2500) {
      if (/listening/.test(await js(`document.querySelector('.mascot')?.className ?? ''`))) return
      await wait(150)
    }
  }
  throw new Error(`The mascot did not start listening for ${label}.`)
}
const mascotState = () => [...events].reverse().find((e) => e.kind === 'event' && e.name.startsWith('mascot:'))?.name ?? ''
const playing = () => {
  const started = events.filter((e) => e.kind === 'aira-audio').map((e) => e.id)
  const done = new Set(events.filter((e) => e.kind === 'aira-end' || e.kind === 'aira-stop').map((e) => e.id))
  return started.some((i) => !done.has(i))
}
function checkProblems() {
  const p = takeProblems(events, Date.now())
  if (p.length) throw new Error(`The take is not usable: ${p.join(' ')}`)
}
/** AIRA quiet: not speaking or thinking, no audio playing, for `ms`. */
async function quiet(label, ms = 1500, timeout = 120000) {
  const t0 = Date.now()
  let since = 0
  while (Date.now() - t0 < timeout) {
    checkProblems()
    const busy = playing() || /speaking|thinking|listening/.test(mascotState())
    if (busy) since = 0
    else if (!since) since = Date.now()
    else if (Date.now() - since >= ms) return
    await wait(150)
  }
  throw new Error(`AIRA did not go quiet after ${label}.`)
}

const user = await js(`(async () => (await window.aira.authSession?.())?.username ?? null)()`).catch(() => null)
const markerKeys = await js(`Object.keys(localStorage).filter((k) => k.startsWith('aira.briefing.played.'))`)
const markers = Object.fromEntries(await Promise.all(markerKeys.map(async (k) => [k, await js(`localStorage.getItem(${JSON.stringify(k)})`)])))
let scriptId = null
let keepFront = null
// AIRA greets only while its window is visible (Home waits for visibilitychange): a hidden window = no take.
if ((await js('document.visibilityState')) !== 'visible')
  throw new Error('The AIRA window is hidden behind other windows — bring it to the front (scratchpad topmost.ps1) and run again.')
try {
  await js(`window.aira.agentNameSet('Rangga')`)
  for (const k of markerKeys) await js(`localStorage.removeItem(${JSON.stringify(k)})`)
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Runtime.addBinding', { name: '__take' })
  scriptId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: harness })).result.identifier
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
  await send('Page.bringToFront')
  await send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 })
  // Keep the window in front for the whole take: Chromium stops painting (and screencasting) an occluded window.
  const TOPMOST = process.env.AIRA_TOPMOST_PS1
  const front = () => TOPMOST && spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-File', TOPMOST, '-On', '1'], { stdio: 'ignore' })
  front()
  keepFront = setInterval(front, 4000)
  await wait(1500)
  recording = true
  const startedAt = Date.now()
  console.log(`Recording${user ? ' as ' + user : ''} — reloading so AIRA starts for real`)
  await send('Page.reload', { ignoreCache: false })

  // 1. Greeting + briefing, then the mic opens by itself and hears the first request.
  await until('the greeting (AIRA audio)', () => has((e) => e.kind === 'aira-audio'), 60000)
  await until('the first request to be heard', () => has((e) => e.kind === 'user-clip' && e.id === 'user-reagent'), 120000)
  await until('Reagent Check findings on screen', () => afterClip(events, 'user-reagent', 'reagent:findings'), 120000)
  await quiet('the reagent check')

  // 2. Click the mascot: the summary request.
  await clickMascot('the summary request')
  await until('the summary request to be heard', () => has((e) => e.kind === 'user-clip' && e.id === 'user-summary'), 20000)
  await until('the AI draft with its number check', () => afterClip(events, 'user-summary', 'reorder:numbers-match'), 180000)
  await quiet('the summary')

  // 3. Click the mascot: the sales question; wait for the answer and AIRA reading it aloud.
  await clickMascot('the sales question')
  await until('the sales question to be heard', () => has((e) => e.kind === 'user-clip' && e.id === 'user-sales'), 20000)
  await until('the sales answer', () => afterClip(events, 'user-sales', 'sales:answer'), 240000)
  // AIRA reads a short summary of the answer aloud once ElevenLabs returns it — wait for that clip and its end.
  const answerAt = events.find((e) => e.name === 'sales:answer' && e.t >= events.find((x) => x.id === 'user-sales').t).t
  await until('AIRA reading the sales answer aloud', () => has((e) => e.kind === 'aira-audio' && e.t > answerAt), 60000)
  await quiet('the sales read-aloud', 2000, 120000)
  await wait(1500)
  checkProblems()
  if (await js(`document.body.innerText.includes('Sign-in History')`)) throw new Error('Sign-in History was on screen — not usable.')
  recording = false
  await send('Page.stopScreencast')
  writeFileSync(join(OUT, 'frames.json'), JSON.stringify({ startedAt, endedAt: Date.now(), frames }, null, 1))
  writeFileSync(join(OUT, 'events.json'), JSON.stringify(events, null, 1))
  console.log(`Take done: ${frames.length} frames, ${audio.size} AIRA clips, ${events.length} events, ${((Date.now() - startedAt) / 1000).toFixed(1)} s`)
} finally {
  recording = false
  if (keepFront) clearInterval(keepFront)
  if (process.env.AIRA_TOPMOST_PS1) spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-File', process.env.AIRA_TOPMOST_PS1, '-On', '0'], { stdio: 'ignore' })
  await send('Page.stopScreencast').catch(() => {})
  for (const [k, v] of Object.entries(markers)) if (v !== null) await js(`localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})`).catch(() => {})
  if (scriptId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId })
  await send('Emulation.clearDeviceMetricsOverride').catch(() => {})
  ws.close()
}
