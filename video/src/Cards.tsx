// The narrator's two cards around the real demo: the problem and who AIRA is (intro), what it is built on (outro).
// The chips light up on the narrator's words that name them.
import { AbsoluteFill, Audio, Img, Sequence, staticFile, useCurrentFrame } from 'remotion'
import { voice } from './data2'
import { NARRATOR_LEAD } from './Captions2'
import { Background, C, Chip, FONT, prog } from './ui'

const wordFrame = (id: string, word: string): number => {
  const w = voice(id).words.find((x) => x.text.toLowerCase().replace(/[^a-z]/g, '') === word)
  if (!w) throw new Error(`The narrator line ${id} has no word "${word}".`)
  return NARRATOR_LEAD + Math.round(w.start * 30)
}

export const IntroCard: React.FC = () => {
  const f = useCurrentFrame()
  const meet = wordFrame('narrator-intro', 'meet')
  return (
    <AbsoluteFill>
      <Background />
      <Sequence from={NARRATOR_LEAD} layout="none">
        <Audio src={staticFile(voice('narrator-intro').file)} />
      </Sequence>
      <div style={{ position: 'absolute', left: 160, top: 170, fontFamily: FONT, color: C.ink, width: 1100 }}>
        <div style={{ fontSize: 30, fontWeight: 700, color: C.accent, letterSpacing: 3, opacity: prog(f, 0, 16) }}>REAGENT RECONCILIATION</div>
        <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.1, marginTop: 14, whiteSpace: 'nowrap', opacity: prog(f, 8, 18) }}>
          One day a month.
          <br />
          <span style={{ color: C.red }}>Numbers that don’t match.</span>
        </div>
        <div style={{ marginTop: 60, opacity: prog(f, meet, 16), transform: `translateY(${(1 - prog(f, meet, 16)) * 20}px)` }}>
          <div style={{ fontSize: 120, fontWeight: 800, color: C.accent, letterSpacing: -3 }}>AIRA</div>
          <div style={{ fontSize: 40, color: C.muted }}>A lab co-worker you can talk to.</div>
        </div>
      </div>
      <Img
        src={staticFile('icon.png')}
        style={{ position: 'absolute', right: 180, top: 220, width: 520, height: 520, borderRadius: '50%', boxShadow: '0 30px 80px rgba(30,42,59,0.2)', opacity: prog(f, meet - 10, 20) }}
      />
    </AbsoluteFill>
  )
}

export const OutroCard: React.FC = () => {
  const f = useCurrentFrame()
  const chips: [string, string, number][] = [
    ['Muse Wonder', 'answers & tools', wordFrame('narrator-outro', 'wonder')],
    ['Muse Spark', 'picks the action', wordFrame('narrator-outro', 'spark')],
    ['Muse Voice Transcribe', 'listens', wordFrame('narrator-outro', 'transcribe')],
    ['ElevenLabs', 'AIRA’s voice', wordFrame('narrator-outro', 'every')]
  ]
  return (
    <AbsoluteFill>
      <Background />
      <Sequence from={NARRATOR_LEAD} layout="none">
        <Audio src={staticFile(voice('narrator-outro').file)} />
      </Sequence>
      <Img src={staticFile('icon.png')} style={{ position: 'absolute', left: 160, top: 240, width: 440, height: 440, borderRadius: '50%', boxShadow: '0 30px 80px rgba(30,42,59,0.2)' }} />
      <div style={{ position: 'absolute', left: 700, top: 190, fontFamily: FONT, color: C.ink }}>
        <div style={{ fontSize: 110, fontWeight: 800, color: C.accent, letterSpacing: -3, opacity: prog(f, 0, 16) }}>AIRA</div>
        <div style={{ fontSize: 26, fontWeight: 700, color: C.accent, letterSpacing: 3, marginTop: 20, opacity: prog(f, 6, 16) }}>BUILT ON META MUSE</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 18, width: 960 }}>
          {chips.map(([name, what, t]) => {
            const p = prog(f, t, 12)
            return (
              <div key={name} style={{ opacity: 0.35 + 0.65 * p }}>
                <Chip on={p > 0.5} style={{ display: 'block', textAlign: 'center', fontSize: 30 }}>
                  {name}
                </Chip>
                <div style={{ textAlign: 'center', fontSize: 22, color: C.muted, marginTop: 6 }}>{what}</div>
              </div>
            )
          })}
        </div>
        <div style={{ fontSize: 26, color: C.muted, marginTop: 40, opacity: prog(f, 40, 16) }}>Recorded live in the app · demo data is synthetic</div>
      </div>
    </AbsoluteFill>
  )
}
