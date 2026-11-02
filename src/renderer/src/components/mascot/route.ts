import type { MascotEvent } from './state'

/*
 * Which chat events reach the mascot. The mascot follows the RUN IT STARTED (tracked by assistant
 * messageId), not the screen: if the user opens Home or another conversation mid-run, `done`/`error` of
 * that run must still arrive, otherwise the mascot shows "Thinking…" forever. Steps and the spoken answer
 * stay tied to the session on screen — narrating a hidden conversation would be noise.
 */

export interface RoutedChatEvent {
  type: string
  messageId: string
  sessionId: string
  activity?: { argsSummary?: string; label?: string; name?: string }
}

export interface RouteContext {
  activeSessionId: string | null
  trackedMessageId: string | null
}

export interface Routed {
  mascot: MascotEvent[]
  /** Read the final answer aloud (only when its session is the one on screen). */
  speak: boolean
  /** The tracked run ended — forget it. */
  clearTracked: boolean
}

export function routeChatEvent(event: RoutedChatEvent, ctx: RouteContext): Routed {
  const active = event.sessionId === ctx.activeSessionId
  const tracked = ctx.trackedMessageId !== null && event.messageId === ctx.trackedMessageId
  const out: Routed = { mascot: [], speak: false, clearTracked: false }
  if (event.type === 'tool_start') {
    if (active) {
      const a = event.activity
      out.mascot.push({ t: 'step', label: a?.argsSummary || a?.label || a?.name || '' })
    }
  } else if (event.type === 'done') {
    if (tracked) {
      out.mascot.push({ t: 'runDone' })
      out.clearTracked = true
    }
    out.speak = active
  } else if (event.type === 'error') {
    if (tracked) {
      out.mascot.push({ t: 'error' })
      out.clearTracked = true
    }
  }
  return out
}
