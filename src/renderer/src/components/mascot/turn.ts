import type { MascotState } from './state'

// Pure rules for one voice turn (tests/mascot-state.test.ts); Mascot.tsx applies them.

/** A new recording starts only when nothing else owns the mascot and no run is busy. */
export function canStartVoiceTurn(busy: boolean, state: MascotState): boolean {
  return !busy && (state === 'idle' || state === 'speaking')
}

/** What the 2 s timer does when it fires: a run that started meanwhile means the voice send is dropped. */
export function autoSendAction(busy: boolean): 'send' | 'skip' {
  return busy ? 'skip' : 'send'
}
