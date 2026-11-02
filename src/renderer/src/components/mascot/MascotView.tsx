import type { JSX } from 'react'
import { artFor, type Mascot } from './state'

// Presentational part of the mascot (no hooks, no images imported) — rendered statically in
// tests/mascot-component.test.ts. Mascot.tsx owns the recorder, timers and voice.

export interface MascotViewProps {
  mascot: Mascot
  art: Record<'idle' | 'listening' | 'thinking' | 'speaking', string>
  muted: boolean
  recording: boolean
  /** A run is active: a new voice turn is refused (no double send). */
  busy: boolean
  /** Error or hint shown under the mascot. */
  message: string | null
  onClick: () => void
  onCancel: () => void
  onToggleMute: () => void
}

const STATUS: Record<Mascot['state'], string> = {
  idle: 'Click me and ask a question',
  listening: 'Listening… click again when you are done',
  confirming: '',
  thinking: 'Thinking…',
  speaking: 'Speaking…'
}

export default function MascotView(p: MascotViewProps): JSX.Element {
  const { state, label, transcript } = p.mascot
  const status = state === 'listening' && !p.recording ? 'Transcribing…' : STATUS[state]
  return (
    <div className={`mascot mascot-${state}`}>
      <div className="mascot-bubble" role="status" aria-live="polite">
        {state === 'confirming' ? (
          <>
            <div className="mascot-transcript">“{transcript}”</div>
            <div className="mascot-confirm">
              <span>Sending in 2s</span>
              <button type="button" className="mascot-cancel" onClick={p.onCancel}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <span>{state === 'thinking' && label ? label : status}</span>
        )}
        {p.message && <div className="mascot-message">{p.message}</div>}
      </div>
      <button
        type="button"
        className="mascot-figure"
        aria-label="Talk to AIRA"
        title={p.busy ? 'AIRA is answering — wait or press Stop' : 'Talk to AIRA'}
        onClick={p.onClick}
        disabled={p.busy && state !== 'listening'}
      >
        <img src={p.art[artFor(state)]} alt="" draggable={false} />
        {state === 'thinking' && (
          <span className="mascot-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        )}
      </button>
      <button type="button" className="mascot-mute" onClick={p.onToggleMute}>
        {p.muted ? 'Unmute' : 'Mute'}
      </button>
    </div>
  )
}
