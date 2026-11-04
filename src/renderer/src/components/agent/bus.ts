// Commands from the voice co-worker to the screen that carries them out (ReagentHome presses its buttons, Home
// replays the briefing). App navigates and emits in the same tick, before that screen has mounted — so the last
// command of each kind is kept until a listener OF THAT KIND receives it or the screen takes it on mount.
import type { ReagentStep } from '../../../../shared/agent-actions'

export type AgentCommand = { kind: 'reagent'; step: ReagentStep } | { kind: 'brief' }
type Kind = AgentCommand['kind']
type Of<K extends Kind> = Extract<AgentCommand, { kind: K }>

const listeners = new Map<Kind, Set<(c: AgentCommand) => void>>()
const pending = new Map<Kind, AgentCommand>()

export function emitAgent(c: AgentCommand): void {
  const fns = listeners.get(c.kind)
  if (!fns?.size) {
    pending.set(c.kind, c)
    return
  }
  pending.delete(c.kind)
  for (const fn of fns) fn(c)
}

export function onAgent<K extends Kind>(kind: K, fn: (c: Of<K>) => void): () => void {
  const set = listeners.get(kind) ?? new Set()
  listeners.set(kind, set)
  const f = fn as (c: AgentCommand) => void
  set.add(f)
  return () => set.delete(f)
}

/** The command of this kind sent before its screen was listening — returned once. */
export function takePending<K extends Kind>(kind: K): Of<K> | null {
  const c = pending.get(kind) ?? null
  pending.delete(kind)
  return c as Of<K> | null
}
