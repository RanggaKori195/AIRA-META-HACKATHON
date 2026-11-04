// Pure rules the recording relies on (tests/harness.test.ts): the fake microphone hands out each voice clip once,
// then silence; an AIRA clip lasts until it stops or the next one starts (the app cuts its own speech short).

export function nextClip<T>(queue: T[], used: number): { clip: T | null; used: number } {
  return { clip: used < queue.length ? queue[used] : null, used: used + 1 }
}

export function trimClips<P extends { at: number; duration: number; stop?: number }>(plays: P[]): (Omit<P, 'stop'> & { at: number; duration: number })[] {
  const sorted = [...plays].sort((a, b) => a.at - b.at)
  return sorted.map((p, i) => {
    const next = sorted[i + 1]?.at ?? Infinity
    const end = Math.min(p.at + p.duration, p.stop ?? Infinity, next)
    const { stop: _stop, ...rest } = p
    return { ...rest, at: p.at, duration: Math.round((end - p.at) * 1000) / 1000 }
  })
}

/** Words of a clip that was cut short: only those that started before the cut, the last one ending at the cut. */
export function clipWords<W extends { start: number; end: number }>(words: W[], duration: number): W[] {
  return words.filter((w) => w.start < duration).map((w) => ({ ...w, end: Math.min(w.end, duration) }))
}

type Ev = { t: number; kind: string; name?: string; id?: number | string }

/** True when the screen moment `name` was logged after the user clip `clipId` started — not left over from earlier. */
export function afterClip(events: Ev[], clipId: string, name: string): boolean {
  const clip = events.find((e) => e.kind === 'user-clip' && e.id === clipId)
  return !!clip && events.some((e) => e.kind === 'event' && e.name === name && e.t >= clip.t)
}

/** Why a take cannot be used: the Windows fallback voice, or AIRA's mascot speaking with no captured ElevenLabs mp3. */
/** `now`: speaking moments younger than `withinMs` are not judged yet (their audio may still be on its way). */
export function takeProblems(events: Ev[], now = Infinity, withinMs = 1500): string[] {
  const out: string[] = []
  if (events.some((e) => e.kind === 'fallback-voice')) out.push('AIRA used the Windows fallback voice (ElevenLabs failed).')
  const audio = events.filter((e) => e.kind === 'aira-audio').map((e) => e.t)
  for (const s of events.filter((e) => e.kind === 'event' && e.name === 'mascot:speaking' && e.t + withinMs < now)) {
    if (!audio.some((t) => t >= s.t - 200 && t <= s.t + withinMs)) out.push(`AIRA spoke without ElevenLabs audio at ${new Date(s.t).toISOString().slice(11, 23)}.`)
  }
  return out
}
