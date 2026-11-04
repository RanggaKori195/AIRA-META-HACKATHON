// Captions from the voices themselves: AIRA's words from speech-to-text on the audio the app played, the user's and
// the narrator's from their text-to-speech timestamps. A strip under the recording shows the current phrase, the
// spoken word in the app's accent (#1f5bb8), tagged 'AIRA', 'You' or 'Narrator'.
import { useCurrentFrame } from 'remotion'
import { outroFrames, take, timeline, voice } from './data2'
import { takeToFrame } from './timeline2'
import { TOTAL_FRAMES } from './constants'
import { C, FONT } from './ui'
import type { Word } from './take'

export const NARRATOR_LEAD = 15
const HOLD = 12
const MAX_WORDS = 9

interface Line {
  who: 'AIRA' | 'You' | 'Narrator'
  words: { text: string; from: number; to: number }[]
}
const place = (base: number, words: Word[], map: (s: number) => number): Line['words'] =>
  words.map((w) => {
    const from = map(base + w.start)
    return { text: w.text, from, to: Math.max(from + 1, map(base + w.end)) }
  })

const outroStart = TOTAL_FRAMES - outroFrames + NARRATOR_LEAD
const LINES: Line[] = [
  { who: 'Narrator', words: place(0, voice('narrator-intro').words, (s) => NARRATOR_LEAD + Math.round(s * 30)) },
  ...take.clips.map((c) => ({
    who: c.who === 'user' ? ('You' as const) : ('AIRA' as const),
    words: place(c.at, c.words, (s) => takeToFrame(timeline, s))
  })),
  { who: 'Narrator', words: place(0, voice('narrator-outro').words, (s) => outroStart + Math.round(s * 30)) }
]

/** The phrase (at most MAX_WORDS words, broken after punctuation where possible) that holds word i. */
function phrase(words: Line['words'], i: number): Line['words'] {
  const chunks: [number, number][] = []
  let start = 0
  while (start < words.length) {
    let end = Math.min(words.length, start + MAX_WORDS)
    for (let k = end - 1; k > start + 3; k--) {
      if (/[.,?!;:]$/.test(words[k].text)) {
        end = k + 1
        break
      }
    }
    chunks.push([start, end])
    start = end
  }
  const [a, b] = chunks.find(([x, y]) => i >= x && i < y) ?? chunks[chunks.length - 1]
  return words.slice(a, b)
}

export const Captions2: React.FC = () => {
  const frame = useCurrentFrame()
  const line = [...LINES].reverse().find((l) => l.words.length && frame >= l.words[0].from && frame < l.words[l.words.length - 1].to + HOLD)
  if (!line) return null
  const idx = line.words.findIndex((w) => frame < w.to)
  const shown = phrase(line.words, idx === -1 ? line.words.length - 1 : idx)
  const color = line.who === 'You' ? C.red : line.who === 'AIRA' ? C.accent : C.muted
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: 978, display: 'flex', justifyContent: 'center' }}>
      <div
        style={{
          fontFamily: FONT,
          fontSize: 40,
          lineHeight: 1.2,
          color: C.muted,
          whiteSpace: 'nowrap',
          background: 'rgba(255,255,255,0.96)',
          border: `1px solid ${C.line}`,
          borderRadius: 14,
          padding: '10px 26px',
          boxShadow: '0 8px 30px rgba(30,42,59,0.12)'
        }}
      >
        <span style={{ fontWeight: 800, fontSize: 22, letterSpacing: 2, color, marginRight: 14, verticalAlign: 'middle' }}>
          {line.who === 'You' ? 'You' : line.who === 'AIRA' ? 'AIRA' : 'NARRATOR'}
        </span>
        {shown.map((w, k) => {
          const active = frame >= w.from && frame < w.to
          const spoken = frame >= w.from
          return (
            <span key={k} style={{ color: active ? '#1f5bb8' : spoken ? C.ink : '#a8b2c0', fontWeight: active ? 700 : 500 }}>
              {w.text}{' '}
            </span>
          )
        })}
      </div>
    </div>
  )
}
