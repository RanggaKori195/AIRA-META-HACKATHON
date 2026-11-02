import type { MascotEvent } from './state'
import { pickVoice, speechText } from './speech'

/*
 * The mascot's voice (Chromium speechSynthesis — Meta has no text-to-speech model) and a tiny event bus,
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

/** The Home hero mascot is a second way in: it asks the floating mascot to start the same voice turn. */
const turnRequests = new Set<() => void>()

export function onVoiceTurnRequest(fn: () => void): () => void {
  turnRequests.add(fn)
  return () => turnRequests.delete(fn)
}

export function requestVoiceTurn(): void {
  for (const fn of turnRequests) fn()
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

/** Reads the spoken summary of an answer, unless muted. */
export function speakAnswer(answer: string): void {
  const s = synth()
  if (!s || isMuted()) return
  s.cancel()
  const u = new SpeechSynthesisUtterance(speechText(answer))
  const voice = pickVoice(s.getVoices())
  if (voice) u.voice = voice
  u.lang = voice?.lang ?? 'en-US'
  u.onstart = (): void => emitMascot({ t: 'speakStart' })
  u.onend = (): void => emitMascot({ t: 'speakEnd' })
  u.onerror = (): void => emitMascot({ t: 'speakEnd' })
  s.speak(u)
}

/** A new question or Stop: silence immediately. */
export function stopSpeaking(): void {
  if (synth()) window.speechSynthesis.cancel()
  emitMascot({ t: 'speakEnd' })
}
