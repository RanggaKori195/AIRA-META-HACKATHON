// Shared look: the app's blue theme, Segoe UI, white cards, chips and titles.
import { Easing, interpolate, useCurrentFrame } from 'remotion'
import type { CSSProperties, ReactNode } from 'react'

export const C = {
  accent: '#1f5bb8',
  accentSoft: '#e7effb',
  ink: '#1e2a3b',
  muted: '#5f6b7a',
  line: '#dde4ee',
  bg1: '#eef3fb',
  bg2: '#ffffff',
  red: '#c0392b',
  redSoft: '#fdecea',
  green: '#1e8e5a',
  amber: '#b7791f'
}
export const FONT = '"Segoe UI", "Segoe UI Variable", Arial, sans-serif'

export const ease = Easing.bezier(0.22, 1, 0.36, 1)
/** 0→1 between two absolute frames, eased and clamped. */
export function prog(frame: number, from: number, dur = 18): number {
  return interpolate(frame, [from, from + dur], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease })
}

export const Background: React.FC = () => (
  <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(1200px 700px at 80% 10%, #dfe9fb 0%, transparent 60%), linear-gradient(160deg, ${C.bg1}, ${C.bg2})` }} />
)

export const Card: React.FC<{ style?: CSSProperties; children: ReactNode }> = ({ style, children }) => (
  <div style={{ background: '#fff', borderRadius: 22, boxShadow: '0 18px 50px rgba(30,42,59,0.12)', border: `1px solid ${C.line}`, fontFamily: FONT, color: C.ink, ...style }}>
    {children}
  </div>
)

export const Chip: React.FC<{ children: ReactNode; on?: boolean; style?: CSSProperties }> = ({ children, on = true, style }) => (
  <span style={{ display: 'inline-block', padding: '10px 22px', borderRadius: 999, background: on ? C.accent : C.accentSoft, color: on ? '#fff' : C.accent, fontFamily: FONT, fontWeight: 600, fontSize: 30, ...style }}>
    {children}
  </span>
)

export const SceneTitle: React.FC<{ kicker: string; title: string; at: number }> = ({ kicker, title, at }) => {
  const frame = useCurrentFrame()
  const p = prog(frame, at, 16)
  return (
    <div style={{ position: 'absolute', left: 120, top: 40, fontFamily: FONT, opacity: p, transform: `translateY(${(1 - p) * 20}px)` }}>
      <div style={{ color: C.accent, fontWeight: 700, fontSize: 24, letterSpacing: 2, textTransform: 'uppercase' }}>{kicker}</div>
      <div style={{ color: C.ink, fontWeight: 700, fontSize: 44, marginTop: 4 }}>{title}</div>
    </div>
  )
}
