// The composition's inputs: the take (take.json from npm run prepare_take), the narrator and user voices
// (voices.json), and the timeline that fits them into 2:00. Captions get the app's spelling of names.
import takeJson from './take.json'
import voicesJson from './voices.json'
import { planTimeline, type Timeline } from './timeline2'
import { CAPTION_FIXES, fixWords } from './caption-fixes'
import { FPS } from './constants'
import type { Clip, Take, Word } from './take'

interface Voice {
  id: string
  file: string
  duration: number
  words: Word[]
}
const voices = voicesJson as Voice[]
export const voice = (id: string): Voice => {
  const v = voices.find((x) => x.id === id)
  if (!v) throw new Error(`${id} is missing from voices.json — run npm run voices.`)
  return v
}

/** Moments that matter on screen; the zoom moments keep 1× for 4 s so the viewer can read them. */
export const ZOOM_EVENTS = ['reagent:findings', 'reorder:numbers-match', 'sales:answer'] as const
const KEY = (name: string): boolean => name === 'brief:shown' || name.startsWith('heard:') || (ZOOM_EVENTS as readonly string[]).includes(name)

export const CARD_PAD = 1.5
export const introFrames = Math.round((voice('narrator-intro').duration + CARD_PAD) * FPS)
export const outroFrames = Math.round((voice('narrator-outro').duration + CARD_PAD) * FPS)

export function buildTimeline(t: Take): Timeline {
  const events = t.events.filter((e) => KEY(e.name)).flatMap((e) => ((ZOOM_EVENTS as readonly string[]).includes(e.name) ? [0, 1, 2, 3, 4].map((d) => ({ name: e.name, at: Math.min(t.duration, e.at + d) })) : [e]))
  return planTimeline({ ...t, events }, { introFrames, outroFrames })
}

const raw = takeJson as Take
export const take: Take = { ...raw, clips: raw.clips.map((c): Clip => ({ ...c, words: fixWords(c.words, CAPTION_FIXES) })) }
export const timeline = buildTimeline(take)
