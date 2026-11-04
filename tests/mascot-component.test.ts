import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import MascotView, { type MascotViewProps } from '../src/renderer/src/components/mascot/MascotView'
import { INITIAL } from '../src/renderer/src/components/mascot/state'

// tsx compiles renderer JSX with the classic runtime (React.createElement) — see tests/pemantau.test.ts.
;(globalThis as { React?: unknown }).React = React

const src = (p: string): string => readFileSync(p, 'utf8')
const ART = { idle: 'idle.png', listening: 'listening.png', thinking: 'thinking.png', speaking: 'speaking.png' }
const view = (p: Partial<MascotViewProps>): string =>
  renderToStaticMarkup(
    React.createElement(MascotView, {
      mascot: INITIAL,
      art: ART,
      muted: false,
      recording: false,
      busy: false,
      message: null,
      onClick: () => undefined,
      onCancel: () => undefined,
      onToggleMute: () => undefined,
      ...p
    })
  )

describe('mascot view', () => {
  test('idle shows the idle pose and an accessible "Talk to AIRA" control', () => {
    const html = view({})
    assert.match(html, /src="idle\.png"/)
    assert.match(html, /aria-label="Talk to AIRA"/)
  })

  test('confirming shows the transcript, a Cancel button and the 2 s countdown', () => {
    const html = view({ mascot: { state: 'confirming', label: null, transcript: 'How much stock?' } })
    assert.match(html, /How much stock\?/)
    assert.match(html, />Cancel</)
    assert.match(html, /Sending in 2s/)
    assert.match(html, /src="listening\.png"/)
  })

  test('thinking shows the current step label', () => {
    const html = view({ mascot: { state: 'thinking', label: 'Checking stock', transcript: null } })
    assert.match(html, /Checking stock/)
    assert.match(html, /src="thinking\.png"/)
  })

  test('muted shows the Unmute control', () => {
    assert.match(view({ muted: true }), /Unmute/)
    assert.match(view({ muted: false }), /Mute/)
  })

  test('the button stays clickable while listening, even if a run is busy (the recording can be stopped)', () => {
    const html = view({ busy: true, recording: true, mascot: { state: 'listening', label: null, transcript: null } })
    assert.doesNotMatch(html, /<button[^>]*aria-label="Talk to AIRA"[^>]*disabled/)
  })

  test('busy refuses a new voice turn (button disabled)', () => {
    assert.match(view({ busy: true }), /<button[^>]*aria-label="Talk to AIRA"[^>]*disabled/)
  })
})

describe('mascot wiring', () => {
  test('dictation button uses the shared recorder and still cannot send (rule 50)', () => {
    const s = src('src/renderer/src/components/TombolDikte.tsx')
    assert.match(s, /useRecorder\(\)/)
    assert.doesNotMatch(s, /onSend|sendChat/)
  })

  test('starting a send or pressing Stop silences the mascot', () => {
    const app = src('src/renderer/src/App.tsx')
    const send = app.slice(app.indexOf('const handleSend = useCallback'), app.indexOf('const handleStop'))
    assert.match(send, /stopSpeaking\(\)/)
    const stop = app.slice(app.indexOf('const handleStop'), app.indexOf('const handleRetry'))
    assert.match(stop, /stopSpeaking\(\)/)
    // Stop silences both voices: the ElevenLabs audio and the Windows fallback (behaviour in mascot-player.test.ts).
    const voice = src('src/renderer/src/components/mascot/voice.ts')
    assert.match(voice, /audio\?\.pause\(\)/)
    assert.match(voice, /synth\(\)\?\.cancel\(\)/)
  })

  test('voice turn auto-sends after 2000 ms and Cancel clears the timer', () => {
    const s = src('src/renderer/src/components/mascot/Mascot.tsx')
    assert.match(s, /AUTO_SEND_MS = 2000/)
    assert.match(s, /clearTimeout/)
  })
})

describe('mascot run tracking and voice-turn safety', () => {
  const mascot = (): string => src('src/renderer/src/components/mascot/Mascot.tsx')
  const rec = (): string => src('src/renderer/src/components/mascot/useRecorder.ts')
  const app = (): string => src('src/renderer/src/App.tsx')

  test('App routes chat events through routeChatEvent with a tracked messageId ref', () => {
    const a = app()
    assert.match(a, /routeChatEvent\(/)
    assert.match(a, /trackedRunRef/)
    assert.doesNotMatch(a, /if \(event\.sessionId === activeSessionRef\.current\) \{\s*if \(event\.type === 'tool_start'\)/)
  })

  test('handleSend and handleRetry track the assistant messageId they get back', () => {
    const a = app()
    const send = a.slice(a.indexOf('const handleSend = useCallback'), a.indexOf('const handleStop'))
    assert.match(send, /trackedRunRef\.current = result\.assistantMessageId/)
    const retry = a.slice(a.indexOf('const handleRetry'), a.indexOf('const handleDeleteSession'))
    assert.match(retry, /trackedRunRef\.current = result\.assistantMessageId/)
  })

  test('a failing sendChat / retryChat returns the mascot to idle', () => {
    const a = app()
    const send = a.slice(a.indexOf('const handleSend = useCallback'), a.indexOf('const handleStop'))
    assert.match(send, /catch[\s\S]*emitMascot\(\{ t: 'error' \}\)/)
    const retry = a.slice(a.indexOf('const handleRetry'), a.indexOf('const handleDeleteSession'))
    assert.match(retry, /catch[\s\S]*emitMascot\(\{ t: 'error' \}\)/)
  })

  test('recorder start refuses a second recording and releases leftovers first', () => {
    const r = rec()
    const start = r.slice(r.indexOf('const start = useCallback'), r.indexOf('const stop = useCallback'))
    assert.match(start, /already/i)
    assert.ok(start.indexOf('release()') < start.indexOf('getUserMedia'), 'release() before opening a new stream')
    assert.match(r, /discard/)
  })

  test('click is refused unless a voice turn may start (no recording while thinking/busy)', () => {
    const m = mascot()
    const click = m.slice(m.indexOf('const startTurn'), m.indexOf('const handleCancel'))
    assert.match(click, /canStartVoiceTurn\(/)
  })

  test('the 2 s timer reads busy through a ref and skips when busy', () => {
    const m = mascot()
    assert.match(m, /busyRef\.current = busy/)
    assert.match(m, /autoSendAction\(busyRef\.current\)/)
  })

  test('a runStart on the bus aborts the voice turn: timer cleared, recording discarded, not transcribed', () => {
    const m = mascot()
    assert.match(m, /e\.t === 'runStart'/)
    assert.match(m, /rec\.discard\(\)/)
    assert.match(m, /generationRef/)
  })
})

describe('mascot on Home: one robot at rest, voice still one click away', () => {
  test('hidden while idle when the screen already shows the mascot', () => {
    assert.match(view({ hidden: true }), /class="mascot mascot-idle mascot-hidden"/)
    assert.doesNotMatch(view({}), /mascot-hidden/)
  })

  test('the hero mascot asks the floating mascot to start a voice turn', async () => {
    const { requestVoiceTurn, onVoiceTurnRequest } = await import('../src/renderer/src/components/mascot/voice')
    let asked = 0
    const off = onVoiceTurnRequest(() => asked++)
    requestVoiceTurn()
    off()
    requestVoiceTurn()
    assert.equal(asked, 1)
  })

  test('Mascot hides only at rest (idle, no message) and App hides it on Home', () => {
    const m = src('src/renderer/src/components/mascot/Mascot.tsx')
    // The fake-microphone warning keeps the mascot visible on Home too (test-mic-guard.test.ts).
    assert.match(m, /hidden=\{hideWhenIdle && mascot\.state === 'idle' && !message && !testMic\}/)
    assert.match(m, /onVoiceTurnRequest\(/)
    assert.match(src('src/renderer/src/App.tsx'), /hideWhenIdle=\{isHome\}/)
    assert.match(src('src/renderer/src/views/Home.tsx'), /onClick=\{\(\) => void requestVoiceTurn\(\)\}/)
  })
})
