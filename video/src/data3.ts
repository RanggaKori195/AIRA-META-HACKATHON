// The 3:00 tutorial's inputs: the voice take (take.json), the Reagent Check tour (tour.json), the narrator lines
// (voices.json) and the chapters. Captions get the app's spelling of names.
import takeJson from './take.json'
import tourJson from './tour.json'
import voicesJson from './voices.json'
import { planTutorial, type Chapter, type Narr } from './tutorial'
import { CAPTION_FIXES, fixWords } from './caption-fixes'
import type { Take } from './take'

export const TUTORIAL_FRAMES = 180 * 30

const fix = (t: Take): Take => ({ ...t, clips: t.clips.map((c) => ({ ...c, words: fixWords(c.words, CAPTION_FIXES) })) })
export const takes = { take: fix(takeJson as Take), tour: fix(tourJson as Take) }
export const narr: Record<string, Narr> = Object.fromEntries((voicesJson as (Narr & { id: string })[]).map((v) => [v.id, v]))

/** Chapter cuts sit between voice clips of the takes (times in seconds of each recording). */
export const CHAPTERS: Chapter[] = [
  { id: 'intro', title: 'What is AIRA', badge: 'NEW', narration: 'tut-intro' },
  { id: 'start', title: 'Greeting + morning briefing', badge: 'NEW', narration: 'tut-start', slice: { source: 'take', from: 0, to: 143.5 } },
  { id: 'voice', title: 'Voice agent opens Reagent Check', badge: 'NEW', narration: 'tut-voice', slice: { source: 'take', from: 143.5, to: 166.3 } },
  { id: 'evidence', title: 'Reagent Check — evidence', badge: 'NEW', narration: 'tut-evidence', slice: { source: 'tour', from: 0, to: 11.4 } },
  { id: 'summary', title: 'AI summary + number check', badge: 'NEW', narration: 'tut-summary', slice: { source: 'take', from: 166.3, to: 198.0 } },
  { id: 'recount', title: 'Voice recount', badge: 'NEW', narration: 'tut-recount', slice: { source: 'tour', from: 11.4, to: 22.9 } },
  {
    id: 'sales',
    title: 'Ask Sales Data',
    badge: 'EXISTING',
    newPart: 'NEW: asked by voice · answer read aloud (ElevenLabs)',
    narration: 'tut-sales',
    slice: { source: 'take', from: 198.0, to: 266.7 }
  },
  { id: 'outro', title: 'Built on Meta Muse', badge: 'NEW', narration: 'tut-outro' }
]

/** Zoom moments keep 1× for 2 s so the viewer can read them. */
export const ZOOMS = ['reagent:findings', 'reorder:numbers-match', 'tour:evidence', 'tour:differs'] as const
const KEY = (n: string): boolean => n.startsWith('tour:') || (ZOOMS as readonly string[]).includes(n)

export const tutorial = planTutorial(CHAPTERS, takes, narr, {
  totalFrames: TUTORIAL_FRAMES,
  padSeconds: 0.25,
  // Waiting for Muse/You.com is sped up (badge on screen); the user asked for a faster pace.
  maxFactor: 12,
  extraEvents: (t) =>
    t.events.filter((e) => KEY(e.name)).flatMap((e) => ((ZOOMS as readonly string[]).includes(e.name) ? [0, 1, 2].map((d) => ({ name: e.name, at: e.at + d })) : [e]))
})
