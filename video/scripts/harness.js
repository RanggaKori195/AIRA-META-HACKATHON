// Page-side test harness for the demo recording (injected by record.mjs with Page.addScriptToEvaluateOnNewDocument;
// it exists only in that page, the app's code is unchanged). It
//  - answers getUserMedia with a stream that plays the NEXT queued voice clip once — the real recorder, Muse Voice
//    Transcribe and the agent run on it; once the queue is spent it hands out the real microphone again;
//  - captures every audio/mpeg blob the app plays (AIRA's ElevenLabs speech) with the time it started playing;
//  - reports the Windows fallback voice (a take with it fails) and screen moments, all on Date.now().
;(() => {
  const CLIPS = /*CLIPS*/ []
  const send = (o) => {
    try {
      window.__take(JSON.stringify({ t: Date.now(), ...o }))
    } catch (_) {}
  }
  const b64ToBuf = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer
  const bufToB64 = (buf) => {
    const u = new Uint8Array(buf)
    let s = ''
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000))
    return btoa(s)
  }

  // 1. The microphone: each request gets the next clip once, then silence (never a loop).
  let used = 0
  const LEAD_IN = 0.4
  const realGum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  navigator.mediaDevices.getUserMedia = async (c) => {
    if (!c || !c.audio) return realGum(c)
    const clip = used < CLIPS.length ? CLIPS[used] : null
    used++
    // Queue spent: the real microphone again, so the page behaves normally after the take.
    if (!clip) {
      send({ kind: 'mic-real' })
      return realGum(c)
    }
    const ctx = new AudioContext()
    const dest = ctx.createMediaStreamDestination()
    const buf = await ctx.decodeAudioData(b64ToBuf(clip.b64))
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(dest)
    src.start(ctx.currentTime + LEAD_IN)
    send({ kind: 'user-clip', id: clip.id, t: Date.now() + LEAD_IN * 1000 })
    for (const tr of dest.stream.getTracks()) {
      const stop = tr.stop.bind(tr)
      tr.stop = () => {
        stop()
        ctx.close()
      }
    }
    return dest.stream
  }

  // 2. AIRA's own speech: the blob behind each played <audio>, and when it really started / stopped.
  const blobs = new Map()
  const realUrl = URL.createObjectURL
  URL.createObjectURL = function (obj) {
    const url = realUrl.call(URL, obj)
    if (obj instanceof Blob && /audio/.test(obj.type)) blobs.set(url, obj)
    return url
  }
  let n = 0
  const realPlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function () {
    const blob = blobs.get(this.src)
    if (blob) {
      const id = ++n
      this.addEventListener(
        'playing',
        () => {
          const at = Date.now()
          blob.arrayBuffer().then((ab) => send({ kind: 'aira-audio', id, t: at, b64: bufToB64(ab) }))
        },
        { once: true }
      )
      this.addEventListener('pause', () => send({ kind: 'aira-stop', id }), { once: true })
      this.addEventListener('ended', () => send({ kind: 'aira-end', id }), { once: true })
    }
    return realPlay.call(this)
  }

  // 3. The Windows fallback voice means ElevenLabs failed — the take must not use it.
  if (window.speechSynthesis) {
    const realSpeak = speechSynthesis.speak.bind(speechSynthesis)
    speechSynthesis.speak = (u) => {
      send({ kind: 'fallback-voice', text: String(u && u.text).slice(0, 80) })
      return realSpeak(u)
    }
  }

  // 4. Screen moments, each once (the mascot state every time it changes).
  const seen = new Set()
  const once = (name, ok) => {
    if (!seen.has(name) && ok) {
      seen.add(name)
      send({ kind: 'event', name })
    }
  }
  let mascot = ''
  let queued = false
  const check = () => {
    queued = false
    const m = document.querySelector('.mascot')
    const state = m ? (String(m.className).match(/mascot-(\w+)/) || [])[1] || '' : ''
    if (state !== mascot) {
      mascot = state
      send({ kind: 'event', name: `mascot:${state || 'none'}` })
    }
    const heard = document.querySelector('.mascot-transcript')
    if (heard) once(`heard:${heard.textContent}`, true)
    const text = document.body ? document.body.innerText : ''
    once('home', /Morning briefing/.test(text))
    once('brief:shown', /Morning briefing/.test(text) && /Number check|AI draft|Order \d|findings/.test(text) && !/Press Brief me/.test(text))
    once('reagent:findings', /Reagent Check/.test(text) && /Wrong item code/.test(text) && /Evidence/.test(text))
    once('reorder:numbers-match', /What to order/.test(text) && /numbers? match/.test(text))
    // The sales chat header line, not the sidebar label (every menu's answers carry "Report this answer").
    once('sales:answer', /the numbers come straight from the database, not estimates/.test(text) && /Report this answer/.test(text))
  }
  const schedule = () => {
    if (!queued) {
      queued = true
      setTimeout(check, 60)
    }
  }
  document.addEventListener('visibilitychange', () => send({ kind: 'visibility', state: document.visibilityState }))
  const start = () => new MutationObserver(schedule).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
  if (document.documentElement) start()
  else document.addEventListener('DOMContentLoaded', start)
})()
