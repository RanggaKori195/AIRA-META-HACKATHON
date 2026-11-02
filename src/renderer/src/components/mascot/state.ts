// The AIRA mascot's state as a pure function of events — tested without a DOM (tests/mascot-state.test.ts).
// `confirming` = a voice transcript is on screen and will be sent unless the user cancels.

export type MascotState = 'idle' | 'listening' | 'confirming' | 'thinking' | 'speaking'

export type MascotEvent =
  | { t: 'micStart' }
  | { t: 'micStop' }
  | { t: 'transcript'; text: string }
  | { t: 'cancel' }
  | { t: 'send' }
  | { t: 'runStart' }
  | { t: 'step'; label: string }
  | { t: 'runDone' }
  | { t: 'speakStart' }
  | { t: 'speakEnd' }
  | { t: 'error' }

export interface Mascot {
  state: MascotState
  label: string | null
  transcript: string | null
}

export const INITIAL: Mascot = { state: 'idle', label: null, transcript: null }

export function next(m: Mascot, e: MascotEvent): Mascot {
  switch (e.t) {
    case 'micStart':
      // A run in progress keeps thinking; the component also refuses a new voice turn then.
      return m.state === 'thinking' ? m : { ...INITIAL, state: 'listening' }
    case 'micStop':
      return m
    case 'transcript':
      return e.text.trim() ? { ...INITIAL, state: 'confirming', transcript: e.text.trim() } : INITIAL
    case 'cancel':
      return m.state === 'confirming' ? INITIAL : m
    case 'send':
    case 'runStart':
      return { ...INITIAL, state: 'thinking' }
    case 'step':
      return { ...INITIAL, state: 'thinking', label: e.label }
    case 'runDone':
      return m.state === 'thinking' ? INITIAL : m
    case 'speakStart':
      return { ...INITIAL, state: 'speaking' }
    case 'speakEnd':
      return m.state === 'speaking' ? INITIAL : m
    case 'error':
      return INITIAL
  }
}

/** Which pose image to show. */
export function artFor(state: MascotState): 'idle' | 'listening' | 'thinking' | 'speaking' {
  return state === 'confirming' ? 'listening' : state
}
