// npm run prepare_take — turns rec/take into what the video needs: public/rec/demo.mp4 (constant 30 fps, wall-clock
// time), AIRA's own mp3s in public/rec/, their words from ElevenLabs speech-to-text (word timestamps, cached), the
// user's clips placed where the harness played them, and src/take.json. The key comes from ../.env.local through
// node --env-file; this script never reads or prints it.
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { concatList } from '../src/concat'
import { clipWords, takeProblems, trimClips } from '../src/harness-queue'
import type { Clip, Take } from '../src/take'

// TAKE_NAME=tour prepares rec/tour → public/rec/tour.mp4 + src/tour.json (the voice take is the default).
const NAME = process.env.TAKE_NAME ?? 'take'
const TAKE = `rec/${NAME}`
const MP4 = NAME === 'take' ? 'public/rec/demo.mp4' : `public/rec/${NAME}.mp4`
const JSON_OUT = `src/${NAME}.json`
const BIN = 'node_modules/@remotion/compositor-win32-x64-msvc'
type Ev = { t: number; kind: string; name?: string; id?: number | string; file?: string }

const probe = (f: string): number => Number(execFileSync(join(BIN, 'ffprobe.exe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim())

async function main(): Promise<void> {
  const { startedAt, endedAt, frames } = JSON.parse(readFileSync(join(TAKE, 'frames.json'), 'utf8')) as { startedAt: number; endedAt: number; frames: { file: string; t: number }[] }
  const events = JSON.parse(readFileSync(join(TAKE, 'events.json'), 'utf8')) as Ev[]
  if (!frames.length) throw new Error('The take has no frames.')
  const problems = takeProblems(events)
  if (problems.length) throw new Error(`The take is not usable: ${problems.join(' ')}`)
  const t0 = frames[0].t
  const sec = (t: number): number => Math.round(((t - t0) / 1000) * 1000) / 1000
  mkdirSync('public/rec', { recursive: true })

  // 1. Frames → constant 30 fps H.264.
  writeFileSync(join(TAKE, 'frames', 'list.txt'), concatList(frames, endedAt))
  execFileSync(join(BIN, 'ffmpeg.exe'), ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(TAKE, 'frames', 'list.txt'), '-fps_mode', 'cfr', '-r', '30', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-bf', '0', '-g', '30', '-movflags', '+faststart', `${MP4}.tmp.mp4`])
  // A second, plain transcode gives evenly spaced timestamps: Remotion's frame lookup failed ("No frame found at
  // position …") on the concat-built file during a full render, and stills alone did not show it.
  execFileSync(join(BIN, 'ffmpeg.exe'), ['-v', 'error', '-y', '-i', `${MP4}.tmp.mp4`, '-an', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', '30', '-bf', '0', '-g', '15', '-video_track_timescale', '30000', '-movflags', '+faststart', MP4])
  rmSync(`${MP4}.tmp.mp4`)
  console.log(`${MP4}: ${probe(MP4).toFixed(2)} s (take ${((endedAt - t0) / 1000).toFixed(2)} s, ${frames.length} frames)`)

  // 2. AIRA's audio exactly as the app played it, trimmed where the app stopped it; words from speech-to-text.
  const el = new ElevenLabsClient()
  mkdirSync('rec/stt-cache', { recursive: true })
  const plays = events
    .filter((e) => e.kind === 'aira-audio')
    .map((e) => {
      const stop = events.find((x) => (x.kind === 'aira-stop' || x.kind === 'aira-end') && x.id === e.id)
      copyFileSync(join(TAKE, 'audio', e.file!), join('public/rec', e.file!))
      return { file: `rec/${e.file}`, at: sec(e.t), duration: probe(join('public/rec', e.file!)), stop: stop ? sec(stop.t) : undefined }
    })
  const aira: Clip[] = []
  for (const p of trimClips(plays)) {
    const bytes = readFileSync(join('public', p.file))
    const cache = join('rec/stt-cache', createHash('sha1').update(bytes).digest('hex') + '.json')
    let words: Clip['words']
    if (existsSync(cache)) words = JSON.parse(readFileSync(cache, 'utf8'))
    else {
      try {
        const r = await el.speechToText.convert({ file: new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' }), modelId: 'scribe_v1', timestampsGranularity: 'word', languageCode: 'en' })
        words = (r.words ?? []).filter((w) => w.type === 'word').map((w) => ({ text: w.text, start: w.start ?? 0, end: w.end ?? 0 }))
      } catch (e) {
        throw new Error(`Speech-to-text failed for ${p.file}: ${(e as Error).message.split('\n')[0]}`)
      }
      writeFileSync(cache, JSON.stringify(words))
    }
    // A clip the app cut short keeps only the words heard before the cut.
    aira.push({ who: 'aira', file: p.file, at: p.at, duration: p.duration, words: clipWords(words, p.duration) })
    console.log(`AIRA ${p.file} at ${p.at.toFixed(2)} s, ${p.duration.toFixed(2)} s: "${words.map((w) => w.text).join(' ').slice(0, 90)}"`)
  }

  // 3. The user's clips where the harness played them into the microphone.
  const voices = JSON.parse(readFileSync('src/voices.json', 'utf8')) as { id: string; file: string; duration: number; words: Clip['words'] }[]
  const user: Clip[] = events
    .filter((e) => e.kind === 'user-clip')
    .map((e) => {
      const v = voices.find((x) => x.id === e.id)
      if (!v) throw new Error(`Voice clip ${e.id} is not in src/voices.json.`)
      return { who: 'user' as const, file: v.file, at: sec(e.t), duration: v.duration, words: v.words }
    })

  const take: Take = {
    duration: sec(endedAt),
    clips: [...aira, ...user].sort((a, b) => a.at - b.at),
    events: events.filter((e) => e.kind === 'event').map((e) => ({ name: e.name!, at: Math.max(0, sec(e.t)) }))
  }
  writeFileSync(JSON_OUT, JSON.stringify(take, null, 1))
  console.log(`${JSON_OUT}: ${take.duration.toFixed(1)} s, ${take.clips.length} clips, ${take.events.length} events (recording started ${((t0 - startedAt) / 1000).toFixed(2)} s after the take began)`)
}

main().catch((e) => {
  console.error(`Prepare failed — ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})
