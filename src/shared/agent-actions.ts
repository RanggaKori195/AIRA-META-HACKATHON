// The closed list of things the voice co-worker may do from one spoken request. Pure — tested in
// tests/agent-pure.test.ts. Muse Spark picks one of these (src/main/agent-voice/route.ts); anything outside the list —
// export, delete, send, schedule — does not exist here, so it cannot be chosen.
import { z } from 'zod'

export const SCREENS = ['home', 'images', 'schedule', 'library', 'guide', 'feedback'] as const
export const DATA_MENUS = ['sales', 'masterdata', 'lab', 'reagent'] as const
export type Screen = (typeof SCREENS)[number]
export type DataMenu = (typeof DATA_MENUS)[number]
export type ReagentStep = 'run' | 'reorder' | 'summary' | 'recount'

export type AgentAction =
  | { action: 'open'; screen: Screen | DataMenu }
  | { action: 'ask'; menu: DataMenu | 'general'; question: string }
  | { action: 'reagent'; step: ReagentStep }
  | { action: 'brief' }
  | { action: 'none' }

export const AgentActionSchema: z.ZodType<AgentAction> = z.discriminatedUnion('action', [
  z.object({ action: z.literal('open'), screen: z.enum([...SCREENS, ...DATA_MENUS]) }),
  z.object({ action: z.literal('ask'), menu: z.enum([...DATA_MENUS, 'general']), question: z.string().trim().min(1).max(500) }),
  z.object({ action: z.literal('reagent'), step: z.enum(['run', 'reorder', 'summary', 'recount']) }),
  z.object({ action: z.literal('brief') }),
  z.object({ action: z.literal('none') })
])

export const SCREEN_LABEL: Record<Screen | DataMenu | 'general', string> = {
  home: 'Home',
  images: 'Images',
  schedule: 'Schedule',
  library: 'Library',
  guide: 'Guide',
  feedback: 'Feedback',
  sales: 'Ask Sales Data',
  masterdata: 'Ask Master Data',
  lab: 'Ask Sample TAT',
  reagent: 'Reagent Check',
  general: 'New Task'
}

export interface AllowedTargets {
  screens: Screen[]
  menus: DataMenu[]
}

/** Screens anyone may open + only the data menus in the session's menu list. */
export function allowedTargets(menu: readonly string[]): AllowedTargets {
  return { screens: [...SCREENS], menus: DATA_MENUS.filter((m) => menu.includes(m)) }
}

const menuAllowed = (m: string, allowed: AllowedTargets): boolean =>
  (allowed.screens as string[]).includes(m) || (allowed.menus as string[]).includes(m)

export function isAllowed(a: AgentAction, allowed: AllowedTargets): boolean {
  if (a.action === 'open') return menuAllowed(a.screen, allowed)
  if (a.action === 'ask') return a.menu === 'general' || menuAllowed(a.menu, allowed)
  if (a.action === 'reagent') return allowed.menus.includes('reagent')
  return true
}

const shorten = (s: string, max: number): string => {
  const t = s.trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 1))}…`
}

/** What AIRA says before it acts — written by code, so the confirmation always matches the action. */
export function sayFor(a: AgentAction): string {
  switch (a.action) {
    case 'open':
      return `Opening ${SCREEN_LABEL[a.screen]}.`
    case 'ask':
      return `Asking ${SCREEN_LABEL[a.menu]}: ${shorten(a.question, 80)}`
    case 'reagent':
      return {
        run: "Opening Reagent Check and running this month's check.",
        reorder: 'Opening Reagent Check and showing the reorder list.',
        summary: 'Opening Reagent Check and drafting the summary.',
        recount: 'Opening the voice recount.'
      }[a.step]
    case 'brief':
      return 'Here is your briefing.'
    case 'none':
      return "Sorry, I can't do that yet. You can ask me about sales, master data, sample TAT or the reagent check."
  }
}

const OPEN_VERB = /\b(open|go to|show|take me to|switch to)\b/i
const SCREEN_WORDS: Array<[RegExp, Screen | DataMenu]> = [
  [/\bsales\b/i, 'sales'],
  [/\bmaster ?data\b/i, 'masterdata'],
  [/\b(tat|turnaround|samples?)\b/i, 'lab'],
  [/\b(images?|pictures?)\b/i, 'images'],
  [/\bschedule\b/i, 'schedule'],
  [/\blibrary\b/i, 'library'],
  [/\b(guide|help)\b/i, 'guide'],
  [/\bfeedback\b/i, 'feedback'],
  [/\bhome\b/i, 'home']
]
const QUESTION = /\?|^\s*(what|how|which|who|when|why|list|compare|give|tell)\b/i
const ASK_WORDS: Array<[RegExp, DataMenu]> = [
  [/\b(sales|revenue|orders?|invoices?)\b/i, 'sales'],
  [/\b(prices?|customers?|items?|doctors?|master ?data)\b/i, 'masterdata'],
  [/\b(tat|turnaround|samples?|backlog)\b/i, 'lab']
]

/**
 * Code fallback when Muse cannot pick: menu names and obvious words. Null = no match; a match on a menu this account
 * may not open = `none` (refused — never turned into a question somewhere else).
 */
export function matchByKeywords(text: string, allowed: AllowedTargets): AgentAction | null {
  const t = text.trim()
  const NONE: AgentAction = { action: 'none' }
  const reagent = (step: ReagentStep): AgentAction => (allowed.menus.includes('reagent') ? { action: 'reagent', step } : NONE)
  if (/\bre-?order/i.test(t)) return reagent('reorder')
  if (/\brecount/i.test(t)) return reagent('recount')
  if (/\bsummar(y|i[sz]e)/i.test(t) && /\b(reagents?|stock)\b/i.test(t)) return reagent('summary')
  if (/\b(reagents?|stock|reconcil\w*)\b/i.test(t)) return reagent('run')
  if (/\bbrief(ing)?\b/i.test(t)) return { action: 'brief' }
  if (OPEN_VERB.test(t)) {
    const hit = SCREEN_WORDS.find(([re]) => re.test(t))
    if (hit) return menuAllowed(hit[1], allowed) ? { action: 'open', screen: hit[1] } : NONE
  }
  if (QUESTION.test(t)) {
    const hit = ASK_WORDS.find(([re]) => re.test(t))
    if (hit) return allowed.menus.includes(hit[1]) ? { action: 'ask', menu: hit[1], question: t } : NONE
  }
  return null
}
