// ffmpeg concat list for the screencast frames: each frame lasts until the next one arrives (Chromium sends fewer
// frames when the screen is still), the last is held to the end of the take — so the video keeps wall-clock time.
// Pure — tests/concat.test.ts.
export function concatList(frames: { file: string; t: number }[], endAt: number): string {
  const lines = ['ffconcat version 1.0']
  frames.forEach((f, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].t : endAt
    const d = Math.max(0.001, (next - f.t) / 1000)
    lines.push(`file '${f.file}'`, `duration ${Number(d.toFixed(3))}`)
  })
  // The demuxer ignores the last duration unless the last file is listed once more.
  if (frames.length) lines.push(`file '${frames[frames.length - 1].file}'`)
  return lines.join('\n') + '\n'
}
