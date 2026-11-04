// Number check for a chat answer: only in Reagent Check, only against the reagent tool results of the same turn.
// Pure — tested in tests/number-check-chat.test.ts. Null means "nothing was checked", so no strip is shown
// (a strip saying "0 of 0" would read as a pass — rule 33).
import { checkNumbers, type NumberCheck } from '../../shared/number-check'

export function numberCheckForRun(mode: string, facts: string[], content: string): NumberCheck | null {
  if (mode !== 'reagent' || facts.length === 0) return null
  const check = checkNumbers(content, facts)
  return check.hits.length ? check : null
}
