// Voice co-worker routing: one spoken request → ONE action from the closed list (src/shared/agent-actions.ts).
// Muse Spark picks; code validates (schema + permission); keywords catch what Muse misses; the last resort asks the
// request in the current menu, so it is never lost. Pure with an injected `complete` — tests/agent-route.test.ts.
import {
  AgentActionSchema,
  allowedTargets,
  isAllowed,
  matchByKeywords,
  sayFor,
  SCREEN_LABEL,
  type AgentAction,
  type AllowedTargets,
  type DataMenu
} from '../../shared/agent-actions'
import type { AgentRouteResult } from '../../shared/ipc'

export function routePrompt(text: string, allowed: AllowedTargets): string {
  const screens = [...allowed.screens, ...allowed.menus].map((s) => `"${s}" (${SCREEN_LABEL[s]})`).join(', ')
  const menus = ['general', ...allowed.menus].map((m) => `"${m}"`).join(', ')
  const reagent = allowed.menus.includes('reagent')
    ? `- {"action":"reagent","step":"run"|"reorder"|"summary"|"recount"} — run this month's reagent check, show the reorder list, draft its summary, or open the voice recount.\n`
    : ''
  return (
    `You are the action picker of AIRA, a desktop lab assistant. The user said one request by voice.\n` +
    `Pick exactly ONE action from this list:\n` +
    `- {"action":"open","screen":S} — open a screen. S is one of: ${screens}.\n` +
    `- {"action":"ask","menu":M,"question":Q} — answer a question in a menu. M is one of: ${menus}; use "general" for general questions that need no data menu. Q is the user's question.\n` +
    reagent +
    `- {"action":"brief"} — replay the morning briefing.\n` +
    `- {"action":"none"} — not a request: thanks, no, a greeting, or background talk.\n` +
    `Examples: "what were sales last month?" -> {"action":"ask","menu":"sales","question":"What were sales last month?"}; ` +
    `"open the guide" -> {"action":"open","screen":"guide"}.\n` +
    `Reply with ONE JSON object only, no other text.\n` +
    `Request: ${JSON.stringify(text)}\n` +
    `Always answer in English.`
  )
}

function firstJson(reply: string): unknown {
  const start = reply.indexOf('{')
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < reply.length; i++) {
    if (reply[i] === '{') depth++
    else if (reply[i] === '}' && --depth === 0) {
      try {
        return JSON.parse(reply.slice(start, i + 1))
      } catch {
        return null
      }
    }
  }
  return null
}

export async function routeRequest(
  text: string,
  o: { menu: readonly string[]; current: DataMenu | 'general'; complete: (prompt: string) => Promise<string> }
): Promise<AgentRouteResult> {
  const allowed = allowedTargets(o.menu)
  const done = (action: AgentAction, source: AgentRouteResult['source']): AgentRouteResult => ({ action, say: sayFor(action), source })
  try {
    const parsed = AgentActionSchema.safeParse(firstJson(await o.complete(routePrompt(text, allowed))))
    // Muse's pick is final when it is valid: its "none" (thanks, no, background talk on the auto-opened mic) makes
    // no conversation, and a menu this account may not open is refused — never turned into a chat elsewhere.
    if (parsed.success) return done(isAllowed(parsed.data, allowed) ? parsed.data : { action: 'none' }, 'muse')
  } catch {
    /* Muse unavailable: the keyword fallback below still answers */
  }
  const byKeywords = matchByKeywords(text, allowed)
  if (byKeywords) return done(byKeywords, 'keywords')
  const current = o.current === 'general' || allowed.menus.includes(o.current) ? o.current : 'general'
  return done({ action: 'ask', menu: current, question: text.trim().slice(0, 500) }, 'fallback')
}
