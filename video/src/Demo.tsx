// The real recording, fitted into the video: each timeline segment plays the recording at 1× (voice or a key
// moment), sped up (waiting — a visible "⏩ N×" badge), or holds its last frame. AIRA's own audio and the user's
// voice play at the frames they happened. Zoom-ins land on the moments the take logged. No drawn mascot: the app's
// own mascot is in the recording.
import { AbsoluteFill, Audio, Freeze, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion'
import { take, timeline, ZOOM_EVENTS } from './data2'
import { takeToFrame } from './timeline2'
import { C, FONT, ease } from './ui'

/** The recording sits at 88% so the caption strip below never covers the app. */
export const REC = { left: 115, top: 14, width: 1690, height: 951 }

/** Where each zoom moment looks, in recording pixels (1920×1080) — measured on frames of the take. The sales answer
 *  is not zoomed: the page is still scrolling while the answer streams in, so a fixed rectangle lands on the wrong part. */
const FOCUS: Partial<Record<(typeof ZOOM_EVENTS)[number], { x: number; y: number; w: number; h: number }>> = {
  'reagent:findings': { x: 660, y: 228, w: 900, h: 480 },
  'reorder:numbers-match': { x: 520, y: 240, w: 1170, h: 300 }
}
const ZOOM_IN = 18
const ZOOM_HOLD = 4 * 30

function useZoom(): { scale: number; tx: number; ty: number } {
  // Inside the demo Sequence frames are relative; event frames from takeToFrame are absolute.
  const frame = useCurrentFrame() + timeline.demoFrom
  for (const name of ZOOM_EVENTS) {
    const e = take.events.find((x) => x.name === name)
    const r = FOCUS[name]
    if (!e || !r) continue
    const f = takeToFrame(timeline, e.at) + 6
    if (frame < f || frame > f + ZOOM_HOLD + ZOOM_IN) continue
    const p = Math.min(
      interpolate(frame, [f, f + ZOOM_IN], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease }),
      interpolate(frame, [f + ZOOM_HOLD, f + ZOOM_HOLD + ZOOM_IN], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease })
    )
    const full = Math.min(1920 / r.w, 1080 / r.h)
    const scale = 1 + (full - 1) * p
    // Keep the focus centre in the middle of the frame as the scale grows.
    const cx = (r.x + r.w / 2) * scale
    const cy = (r.y + r.h / 2) * scale
    return { scale, tx: (960 - cx) * p, ty: (540 - cy) * p }
  }
  return { scale: 1, tx: 0, ty: 0 }
}

const Recording: React.FC = () => {
  const z = useZoom()
  return (
    <div style={{ position: 'absolute', ...REC, borderRadius: 16, overflow: 'hidden', boxShadow: '0 24px 70px rgba(30,42,59,0.25)', border: `1px solid ${C.line}`, background: '#fff' }}>
      <div style={{ width: 1920, height: 1080, transformOrigin: '0 0', transform: `scale(${REC.width / 1920}) translate(${z.tx}px, ${z.ty}px) scale(${z.scale})` }}>
        {timeline.segments.map((s, i) => (
          <Sequence key={i} from={s.from - timeline.demoFrom} durationInFrames={s.frames} layout="none">
            {s.rate === 0 ? (
              <Freeze frame={0}>
                <OffthreadVideo src={staticFile('rec/demo.mp4')} startFrom={Math.max(0, Math.round(s.takeFrom * 30) - 1)} muted />
              </Freeze>
            ) : (
              <OffthreadVideo src={staticFile('rec/demo.mp4')} startFrom={Math.round(s.takeFrom * 30)} playbackRate={s.rate} muted />
            )}
          </Sequence>
        ))}
      </div>
    </div>
  )
}

const SpeedBadge: React.FC = () => {
  const frame = useCurrentFrame() + timeline.demoFrom
  const s = timeline.segments.find((x) => frame >= x.from && frame < x.from + x.frames)
  if (!s || s.rate <= 1) return null
  return (
    <div style={{ position: 'absolute', right: REC.left + 24, top: REC.top + 20, background: 'rgba(30,42,59,0.82)', color: '#fff', fontFamily: FONT, fontWeight: 700, fontSize: 28, padding: '8px 18px', borderRadius: 999 }}>
      ⏩ {s.rate.toFixed(1)}× — waiting for Muse
    </div>
  )
}

export const Demo: React.FC = () => (
  <AbsoluteFill>
    <Recording />
    <SpeedBadge />
    {take.clips.map((c, i) => (
      <Sequence key={i} from={takeToFrame(timeline, c.at) - timeline.demoFrom} durationInFrames={Math.max(1, Math.round(c.duration * 30))} layout="none">
        <Audio src={staticFile(c.file)} />
      </Sequence>
    ))}
  </AbsoluteFill>
)
