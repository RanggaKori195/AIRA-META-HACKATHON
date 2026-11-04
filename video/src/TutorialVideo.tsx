// The 3:00 tutorial: what AIRA is, what was built during the event (git proof on the first card), then one chapter
// per feature — a narrator card, then the real recording with a NEW / EXISTING label, zoom-ins on logged moments, a
// visible "⏩ N×" badge while waiting, and captions from the voices. Exactly TUTORIAL_FRAMES frames.
import { AbsoluteFill, Audio, Freeze, Img, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion'
import { CHAPTERS, TUTORIAL_FRAMES, ZOOMS, narr, tutorial } from './data3'
import type { TutorialSegment } from './tutorial'
import { Background, C, Card, Chip, FONT, ease, prog } from './ui'

const FPS = 30
const REC = { left: 115, top: 14, width: 1690, height: 951 }
const VIDEO = { take: 'rec/demo.mp4', tour: 'rec/tour.mp4' } as const

/** Output frame of a moment on the virtual timeline. */
export function vToFrame(t: number): number {
  const segs = tutorial.segments
  const s = segs.find((x) => t >= x.takeFrom && t < x.takeTo) ?? segs[segs.length - 1]
  if (s.rate === 0) return s.from
  return s.from + Math.min(s.frames - 1, Math.round(((t - s.takeFrom) / s.rate) * FPS))
}
const segAt = (frame: number): TutorialSegment | undefined => tutorial.segments.find((s) => frame >= s.from && frame < s.from + s.frames)
const chapterOf = (id: string) => CHAPTERS.find((c) => c.id === id)!

/** Zoom rectangles in recording pixels, measured on frames of the takes. */
const FOCUS: Record<(typeof ZOOMS)[number], { x: number; y: number; w: number; h: number }> = {
  'reagent:findings': { x: 660, y: 228, w: 900, h: 480 },
  'reorder:numbers-match': { x: 520, y: 240, w: 1170, h: 300 },
  'tour:evidence': { x: 1290, y: 460, w: 390, h: 620 },
  'tour:differs': { x: 530, y: 860, w: 1150, h: 160 }
}
const ZOOM_IN = 15
const ZOOM_HOLD = 60

function zoomAt(frame: number): { scale: number; tx: number; ty: number } {
  for (const name of ZOOMS) {
    const e = tutorial.take.events.find((x) => x.name === name)
    if (!e) continue
    const f = vToFrame(e.at) + 4
    if (frame < f || frame > f + ZOOM_HOLD + ZOOM_IN) continue
    const p = Math.min(
      interpolate(frame, [f, f + ZOOM_IN], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease }),
      interpolate(frame, [f + ZOOM_HOLD, f + ZOOM_HOLD + ZOOM_IN], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease })
    )
    const r = FOCUS[name]
    const scale = 1 + (Math.min(1920 / r.w, 1080 / r.h) - 1) * p
    return { scale, tx: (960 - (r.x + r.w / 2) * scale) * p, ty: (540 - (r.y + r.h / 2) * scale) * p }
  }
  return { scale: 1, tx: 0, ty: 0 }
}

/** One slice segment of a recording, at its rate (or its first frame held). */
const SliceVideo: React.FC<{ s: TutorialSegment }> = ({ s }) => {
  const p = tutorial.pieces[s.piece]
  const src = staticFile(VIDEO[p.source!])
  const start = Math.round((p.from! + (s.takeFrom - p.vFrom)) * FPS)
  return s.rate === 0 ? (
    <Freeze frame={0}>
      <OffthreadVideo src={src} startFrom={Math.max(0, start - 1)} muted />
    </Freeze>
  ) : (
    <OffthreadVideo src={src} startFrom={start} playbackRate={s.rate} muted />
  )
}

const Recording: React.FC = () => {
  const frame = useCurrentFrame()
  const z = zoomAt(frame)
  return (
    <div style={{ position: 'absolute', ...REC, borderRadius: 16, overflow: 'hidden', boxShadow: '0 24px 70px rgba(30,42,59,0.25)', border: `1px solid ${C.line}`, background: '#fff' }}>
      <div style={{ width: 1920, height: 1080, transformOrigin: '0 0', transform: `scale(${REC.width / 1920}) translate(${z.tx}px, ${z.ty}px) scale(${z.scale})` }}>
        {tutorial.segments.map((s, i) =>
          tutorial.pieces[s.piece].kind === 'slice' ? (
            <Sequence key={i} from={s.from} durationInFrames={s.frames} layout="none">
              <SliceVideo s={s} />
            </Sequence>
          ) : null
        )}
      </div>
    </div>
  )
}

const Badge: React.FC<{ kind: 'NEW' | 'EXISTING'; big?: boolean }> = ({ kind, big }) => (
  <span style={{ display: 'inline-block', padding: big ? '6px 16px' : '4px 12px', borderRadius: 8, fontFamily: FONT, fontWeight: 800, fontSize: big ? 26 : 20, letterSpacing: 1, color: '#fff', background: kind === 'NEW' ? C.green : C.muted }}>
    {kind === 'NEW' ? 'NEW' : 'EXISTING (AIRA 0.5.0)'}
  </span>
)

/** Over the recording: which chapter this is, NEW or EXISTING, and the speed-up badge while waiting. */
const SliceOverlay: React.FC = () => {
  const frame = useCurrentFrame()
  const s = segAt(frame)
  if (!s) return null
  const p = tutorial.pieces[s.piece]
  if (p.kind !== 'slice') return null
  const ch = chapterOf(p.chapter)
  return (
    <>
      <div style={{ position: 'absolute', left: REC.left + 20, top: REC.top + 18, display: 'flex', gap: 12, alignItems: 'center', background: 'rgba(255,255,255,0.94)', border: `1px solid ${C.line}`, borderRadius: 12, padding: '8px 14px', boxShadow: '0 6px 20px rgba(30,42,59,0.15)' }}>
        <Badge kind={ch.badge} />
        <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 24, color: C.ink }}>{ch.title}</span>
        {ch.newPart ? <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 20, color: C.green }}>{ch.newPart}</span> : null}
      </div>
      {s.rate > 1 ? (
        <div style={{ position: 'absolute', right: REC.left + 24, top: REC.top + 20, background: 'rgba(30,42,59,0.82)', color: '#fff', fontFamily: FONT, fontWeight: 700, fontSize: 26, padding: '8px 18px', borderRadius: 999 }}>
          ⏩ {s.rate.toFixed(1)}× — waiting for Muse
        </div>
      ) : null}
    </>
  )
}

const STATS = { baseline: 'a693286', date: '2 Nov 2026', commits: 66, files: 452, plus: '27,488', minus: '7,052' }
const BUILT = [
  'Brain swapped to Meta Muse — Wonder, Spark, Voice Transcribe, Image',
  'Voice co-worker: greets by name, opens screens by voice (Muse Spark)',
  'AIRA’s voice by ElevenLabs; mascot that listens, thinks and speaks',
  'Morning briefing: sales up/down, suggestion, trend from the web',
  'Reagent Check: Excel reconciliation, evidence, reorder, voice recount',
  'Number check on every number Muse writes; local synthetic demo database'
]

const IntroCard: React.FC = () => {
  const f = useCurrentFrame()
  return (
    <AbsoluteFill>
      <Background />
      <div style={{ position: 'absolute', left: 120, top: 90, fontFamily: FONT, color: C.ink, opacity: prog(f, 0, 14) }}>
        <div style={{ fontSize: 110, fontWeight: 800, color: C.accent, letterSpacing: -3 }}>AIRA</div>
        <div style={{ fontSize: 38, color: C.muted, marginTop: -6 }}>An AI co-worker for a clinical lab, running on Meta Muse</div>
      </div>
      <Img src={staticFile('icon.png')} style={{ position: 'absolute', right: 140, top: 70, width: 300, height: 300, borderRadius: '50%', boxShadow: '0 24px 60px rgba(30,42,59,0.2)', opacity: prog(f, 6, 16) }} />
      <Card style={{ position: 'absolute', left: 120, top: 330, width: 1680, padding: '28px 36px', opacity: prog(f, 40, 16) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Badge kind="NEW" big />
          <span style={{ fontSize: 36, fontWeight: 800 }}>What we built during the event</span>
        </div>
        <div style={{ fontSize: 26, color: C.muted, marginTop: 10, fontFamily: '"Consolas", monospace' }}>
          git: baseline AIRA 0.5.0 = commit {STATS.baseline} ({STATS.date}, before the event) → {STATS.commits} commits · {STATS.files} files · +{STATS.plus} / −{STATS.minus} lines
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 40px', marginTop: 22 }}>
          {BUILT.map((b, i) => (
            <div key={b} style={{ fontSize: 28, display: 'flex', gap: 12, opacity: prog(f, 60 + i * 12, 12) }}>
              <span style={{ color: C.green, fontWeight: 800 }}>✓</span>
              <span>{b}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 24, display: 'flex', gap: 14, alignItems: 'center', fontSize: 24, color: C.muted, opacity: prog(f, 150, 14) }}>
          <Badge kind="EXISTING" />
          <span>Already in AIRA 0.5.0, shown only where a new feature uses it: chat and the Ask Sales Data menu.</span>
        </div>
      </Card>
    </AbsoluteFill>
  )
}

const ChapterCard: React.FC<{ id: string }> = ({ id }) => {
  const f = useCurrentFrame()
  const ch = chapterOf(id)
  const n = CHAPTERS.filter((c) => c.slice).findIndex((c) => c.id === id) + 1
  const total = CHAPTERS.filter((c) => c.slice).length
  return (
    <AbsoluteFill>
      <Background />
      <div style={{ position: 'absolute', left: 160, top: 330, fontFamily: FONT, color: C.ink, opacity: prog(f, 0, 10), transform: `translateY(${(1 - prog(f, 0, 12)) * 24}px)` }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: C.accent, letterSpacing: 3 }}>
          FEATURE {n} / {total}
        </div>
        <div style={{ fontSize: 84, fontWeight: 800, marginTop: 10, maxWidth: 1600 }}>{ch.title}</div>
        <div style={{ marginTop: 22, display: 'flex', gap: 14, alignItems: 'center' }}>
          <Badge kind={ch.badge} big />
          {ch.newPart ? <span style={{ fontSize: 30, fontWeight: 700, color: C.green }}>{ch.newPart}</span> : null}
        </div>
      </div>
    </AbsoluteFill>
  )
}

const OutroCard: React.FC<{ startFrame: number }> = ({ startFrame }) => {
  const f = useCurrentFrame()
  const words = narr['tut-outro'].words
  const at = (w: string): number => {
    const hit = words.find((x) => x.text.toLowerCase().replace(/[^a-z]/g, '') === w)
    if (!hit) throw new Error(`The outro narration has no word "${w}".`)
    return Math.round((0.3 + hit.start) * FPS)
  }
  void startFrame
  const chips: [string, number][] = [
    ['Muse Wonder', at('wonder')],
    ['Muse Spark', at('spark')],
    ['Muse Voice Transcribe', at('transcribe')],
    ['Muse Image', at('image')],
    ['ElevenLabs voice', at('elevenlabs')]
  ]
  return (
    <AbsoluteFill>
      <Background />
      <Img src={staticFile('icon.png')} style={{ position: 'absolute', left: 160, top: 250, width: 420, height: 420, borderRadius: '50%', boxShadow: '0 30px 80px rgba(30,42,59,0.2)' }} />
      <div style={{ position: 'absolute', left: 680, top: 200, fontFamily: FONT, color: C.ink }}>
        <div style={{ fontSize: 110, fontWeight: 800, color: C.accent, letterSpacing: -3 }}>AIRA</div>
        <div style={{ fontSize: 26, fontWeight: 700, color: C.accent, letterSpacing: 3, marginTop: 16 }}>BUILT DURING THE EVENT ON</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 18, width: 1080 }}>
          {chips.map(([name, t]) => (
            <Chip key={name} on={f >= t} style={{ fontSize: 30, opacity: f >= t ? 1 : 0.4 }}>
              {name}
            </Chip>
          ))}
        </div>
        <div style={{ fontSize: 26, color: C.muted, marginTop: 40 }}>Recorded live in the app · demo data is synthetic · code: branch hackathon/public-scrub</div>
      </div>
    </AbsoluteFill>
  )
}

/** Captions from the voices: AIRA (speech-to-text of the audio the app played), You and the narrator (TTS times). */
const LINES = tutorial.take.clips.map((c) => ({
  who: c.who === 'user' ? 'You' : c.who === 'aira' ? 'AIRA' : 'NARRATOR',
  words: c.words.map((w) => {
    const from = vToFrame(c.at + w.start)
    return { text: w.text, from, to: Math.max(from + 1, vToFrame(c.at + w.end)) }
  })
}))
const HOLD = 12
const MAX_WORDS = 9
function phrase<T extends { text: string }>(words: T[], i: number): T[] {
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
const Captions: React.FC = () => {
  const frame = useCurrentFrame()
  const line = [...LINES].reverse().find((l) => l.words.length && frame >= l.words[0].from && frame < l.words[l.words.length - 1].to + HOLD)
  if (!line) return null
  const idx = line.words.findIndex((w) => frame < w.to)
  const shown = phrase(line.words, idx === -1 ? line.words.length - 1 : idx)
  const color = line.who === 'You' ? C.red : line.who === 'AIRA' ? C.accent : C.muted
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: 978, display: 'flex', justifyContent: 'center' }}>
      <div style={{ fontFamily: FONT, fontSize: 38, lineHeight: 1.2, color: C.muted, whiteSpace: 'nowrap', background: 'rgba(255,255,255,0.96)', border: `1px solid ${C.line}`, borderRadius: 14, padding: '10px 26px', boxShadow: '0 8px 30px rgba(30,42,59,0.12)' }}>
        <span style={{ fontWeight: 800, fontSize: 22, letterSpacing: 2, color, marginRight: 14, verticalAlign: 'middle' }}>{line.who}</span>
        {shown.map((w, k) => {
          const active = frame >= w.from && frame < w.to
          return (
            <span key={k} style={{ color: active ? '#1f5bb8' : frame >= w.from ? C.ink : '#a8b2c0', fontWeight: active ? 700 : 500 }}>
              {w.text}{' '}
            </span>
          )
        })}
      </div>
    </div>
  )
}

export const AiraTutorial: React.FC = () => {
  // One Sequence per card piece (frames of that piece), the recording underneath for slice pieces.
  const cards = tutorial.pieces
    .map((p, i) => ({ p, i, segs: tutorial.segments.filter((s) => s.piece === i) }))
    .filter((x) => x.p.kind === 'card' && x.segs.length)
  return (
    <AbsoluteFill style={{ backgroundColor: '#eef3fb' }}>
      <Background />
      <Recording />
      <SliceOverlay />
      {cards.map(({ p, i, segs }) => {
        const from = segs[0].from
        const frames = segs.reduce((n, s) => n + s.frames, 0)
        return (
          <Sequence key={i} from={from} durationInFrames={frames} name={`card ${p.chapter}`}>
            {p.chapter === 'intro' ? <IntroCard /> : p.chapter === 'outro' ? <OutroCard startFrame={from} /> : <ChapterCard id={p.chapter} />}
          </Sequence>
        )
      })}
      {tutorial.take.clips.map((c, i) => (
        <Sequence key={`a${i}`} from={vToFrame(c.at)} durationInFrames={Math.max(1, Math.round(c.duration * FPS))} layout="none">
          <Audio src={staticFile(c.file)} />
        </Sequence>
      ))}
      <Captions />
    </AbsoluteFill>
  )
}

export { TUTORIAL_FRAMES }
