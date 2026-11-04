import type { MascotEvent } from './state'
import { pickVoice, speechText } from './speech'
import { createSpeaker } from './player'

/** Same cap as the ElevenLabs request (MAX_TTS_CHARS in src/main/suara/tts.ts). */
const AGENT_SPEECH_MAX = 600

/*
 * The mascot's voice (ElevenLabs, made in the main process; Windows speechSynthesis only as fallback) and a tiny event bus,
 * so App can feed chat events to the mascot without threading props through every screen.
 */

type Listener = (e: MascotEvent) => void
const listeners = new Set<Listener>()

export function onMascotEvent(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function emitMascot(e: MascotEvent): void {
  for (const fn of listeners) fn(e)
}

/**
 * Asks the floating mascot to start a voice turn: the Home hero mascot (click) and the startup sequence (automatic).
 * `auto` turns stop on silence and close quietly; `name` turns hand the transcript back instead of sending it.
 * Resolves with the transcript ('' when nothing was heard, the turn was refused or cancelled).
 */
export interface VoiceTurnRequest {
  auto?: boolean
  purpose?: 'request' | 'name'
}
type TurnHandler = (o: VoiceTurnRequest, resolve: (transcript: string) => void) => void
const turnRequests = new Set<TurnHandler>()

export function onVoiceTurnRequest(fn: TurnHandler): () => void {
  turnRequests.add(fn)
  return () => turnRequests.delete(fn)
}

export function requestVoiceTurn(o: VoiceTurnRequest = {}): Promise<string> {
  return new Promise((resolve) => {
    if (turnRequests.size === 0) return resolve('')
    for (const fn of turnRequests) fn(o, resolve)
  })
}

let user = ''
const muteKey = (): string => `aira.mascot.muted.${user}`

export function setMascotUser(username: string): void {
  user = username
}

export function isMuted(): boolean {
  try {
    return localStorage.getItem(muteKey()) === '1'
  } catch {
    return false
  }
}

export function setMuted(muted: boolean): void {
  try {
    localStorage.setItem(muteKey(), muted ? '1' : '0')
  } catch {
    /* a lost preference is not worth an error */
  }
  if (muted) stopSpeaking()
}

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null
}

/** Windows voice — only the fallback when ElevenLabs cannot answer. */
function speakWindows(text: string): void {
  const s = synth()
  if (!s) {
    emitMascot({ t: 'speakEnd' })
    return
  }
  s.cancel()
  const u = new SpeechSynthesisUtterance(text)
  const voice = pickVoice(s.getVoices())
  if (voice) u.voice = voice
  u.lang = voice?.lang ?? 'en-US'
  u.onstart = (): void => emitMascot({ t: 'speakStart' })
  u.onend = (): void => emitMascot({ t: 'speakEnd' })
  u.onerror = (): void => emitMascot({ t: 'speakEnd' })
  s.speak(u)
}

let audio: HTMLAudioElement | null = null

const speaker = createSpeaker({
  muted: isMuted,
  synthesize: (text) => window.aira.speechSynthesize(text),
  play: async (bytes, onEnd) => {
    const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: 'audio/mpeg' }))
    const a = new Audio(url)
    audio = a
    const done = (): void => {
      URL.revokeObjectURL(url)
      onEnd()
    }
    a.onended = done
    a.onerror = done
    try {
      await a.play()
    } catch {
      done()
    }
  },
  stopAudio: () => {
    audio?.pause()
    audio = null
  },
  fallback: speakWindows,
  stopFallback: () => synth()?.cancel(),
  emit: (t) => emitMascot({ t })
})

/** Reads the spoken summary of an answer with AIRA's ElevenLabs voice, unless muted. */
export function speakAnswer(answer: string): void {
  void speaker.speak(speechText(answer))
}

/**
 * What the voice co-worker says itself (greeting, "Opening Reagent Check…"): the whole text up to the ElevenLabs cap,
 * not cut to three sentences like an answer summary. Resolves when the speech ends (or at once when muted).
 */
export function speakAgent(text: string): Promise<void> {
  if (isMuted() || !text.trim()) return Promise.resolve()
  return new Promise((resolve) => {
    let started = false
    const finish = (): void => {
      off()
      clearTimeout(safety)
      resolve()
    }
    const off = onMascotEvent((e) => {
      if (e.t === 'speakStart') started = true
      else if (e.t === 'speakEnd' && started) finish()
    })
    // A dropped turn (a newer one started) never ends on its own: give up after the longest clip.
    const safety = setTimeout(finish, 45_000)
    void speaker.speak(text.trim().slice(0, AGENT_SPEECH_MAX))
  })
}

/** A new question or Stop: silence immediately. */
export function stopSpeaking(): void {
  speaker.stop()
}
