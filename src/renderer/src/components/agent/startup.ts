// What AIRA does when the app starts: ask the name once, greet by name, brief on the first start of the day, then
// listen. Pure — tested in tests/agent-pure.test.ts (steps, greeting) and tests/agent-startup.test.ts (runStartup).
import { parseCallName } from './name'
import type { Briefing } from '../../../../shared/ipc'

export type StartupStep = 'askName' | 'greet' | 'brief' | 'listen' | 'showText'

export const ASK_NAME = "Hi, I'm AIRA. What should I call you?"
export const NAME_MISSED = "Sorry, I didn't catch your name — you can set it in Settings."
export const CLOSING_QUESTION = 'What can I help you with?'
export const niceToMeet = (name: string): string => `Nice to meet you, ${name}.`
/** Same cap as the ElevenLabs request (MAX_TTS_CHARS in src/main/suara/tts.ts). */
const MAX_SPOKEN = 600

/** Muted = nothing spoken and no microphone: the greeting is shown as text only. */
export function startupSteps(s: { nameKnown: boolean; briefedToday: boolean; muted: boolean }): StartupStep[] {
  if (s.muted) return ['showText']
  return [...(s.nameKnown ? [] : (['askName'] as StartupStep[])), 'greet', ...(s.briefedToday ? [] : (['brief'] as StartupStep[])), 'listen']
}

export interface StartupDeps {
  getName(): Promise<string | null>
  setName(name: string): Promise<void>
  /** Speaks with AIRA's voice; resolves when the speech has ended. */
  speak(text: string): Promise<void>
  /** One automatic voice turn whose transcript is the name answer ('' when nothing was heard). */
  listenForName(): Promise<string>
  /** Today's briefing text (Muse wording, number-checked), or null when it could not be made. */
  getBriefing(): Promise<string | null>
  briefedToday(): boolean
  markBriefed(): void
  muted(): boolean
  hour(): number
  /** One automatic voice turn for a request (handed to the voice co-worker). */
  listen(): Promise<void>
  showText(text: string): void
}

/** The latest value plus subscribers: a screen that mounts later still gets what was published before it. */
export function latest<T>(): { publish(v: T): void; subscribe(fn: (v: T) => void): () => void } {
  let has = false
  let value: T
  const subs = new Set<(v: T) => void>()
  return {
    publish(v) {
      has = true
      value = v
      for (const fn of subs) fn(v)
    },
    subscribe(fn) {
      if (has) fn(value)
      subs.add(fn)
      return () => subs.delete(fn)
    }
  }
}

/** What the startup sequence shows on Home: React dev mounts Home twice and the sequence runs in the first mount. */
export const startupGreeting = latest<string>()
export const startupBriefing = latest<Promise<Briefing>>()

const started = new Set<string>()

/** Runs the startup sequence once per user per app start (React dev mounts Home twice; logout + login again too). */
export function startupOnce(username: string, run: () => Promise<void>): void {
  if (started.has(username)) return
  started.add(username)
  void run().catch(() => {
    /* a failed greeting must never break Home — the mascot and Brief me still work */
  })
}

/** The startup sequence (spec §2). Every decision is in `startupSteps`/`greetingText`; this only runs them. */
export async function runStartup(d: StartupDeps): Promise<void> {
  let name = await d.getName()
  const steps = startupSteps({ nameKnown: name !== null, briefedToday: d.briefedToday(), muted: d.muted() })
  const briefing = async (): Promise<string | null> => {
    if (!steps.includes('brief') && !(steps.includes('showText') && !d.briefedToday())) return null
    const text = await d.getBriefing()
    if (text) d.markBriefed()
    return text
  }
  if (steps.includes('showText')) {
    d.showText(greetingText({ name, hour: d.hour(), briefing: await briefing() }))
    return
  }
  if (steps.includes('askName')) {
    await d.speak(ASK_NAME)
    const heard = parseCallName(await d.listenForName())
    if (heard) {
      await d.setName(heard)
      name = heard
      await d.speak(niceToMeet(heard))
    } else await d.speak(NAME_MISSED)
  }
  await d.speak(greetingText({ name, hour: d.hour(), briefing: await briefing() }))
  await d.listen()
}

const partOfDay = (hour: number): string => (hour >= 5 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 18 ? 'Good afternoon' : 'Good evening')

/** One spoken clip: greeting, the briefing (cut at a sentence end to fit), the question. */
export function greetingText(g: { name: string | null; hour: number; briefing: string | null }): string {
  const head = `${partOfDay(g.hour)}${g.name ? `, ${g.name}` : ''}.`
  let middle = ''
  if (g.briefing?.trim()) {
    const room = MAX_SPOKEN - head.length - CLOSING_QUESTION.length - 2
    for (const sentence of g.briefing.trim().split(/(?<=[.!?])\s+/)) {
      const next = middle ? `${middle} ${sentence}` : sentence
      if (next.length > room) break
      middle = next
    }
  }
  return [head, middle, CLOSING_QUESTION].filter(Boolean).join(' ')
}
