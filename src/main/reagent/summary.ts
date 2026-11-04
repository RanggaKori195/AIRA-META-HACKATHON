// Optional "AI draft" summary of the reagent actions. The model gets ONLY the code-computed facts and is told not to
// state any other number; the screen labels the text as a draft. `complete` is injected (Muse Wonder in the app,
// a stub in the tests).
import { REORDER_STATUS_LABEL, type ReagentActions } from '../../shared/reagent'

/** The facts the model is given — the number check (`checkNumbers`) looks every number up in the same list. */
export function summaryFacts(a: ReagentActions): string[] {
  const facts: string[] = []
  for (const i of a.investigation) facts.push(`- Finding: ${i.headline}.`)
  for (const l of a.reorder.filter((x) => x.status === 'order_now' || x.status === 'order_soon')) {
    facts.push(
      `- ${REORDER_STATUS_LABEL[l.status]} — ${l.itemName}: order ${l.orderPacks} ${l.packUnit}` +
        (l.sheetOrderPacks !== null ? ` (the sheet factor would order ${l.sheetOrderPacks} ${l.packUnit})` : '') +
        '.'
    )
  }
  for (const e of a.excluded) facts.push(`- Not computed — ${e.itemName}: ${e.reason}.`)
  if (facts.length === 0) facts.push('- No findings and nothing to order this month.')
  return facts
}

export async function draftSummary(a: ReagentActions, complete: (prompt: string) => Promise<string>): Promise<string> {
  const facts = summaryFacts(a)
  const prompt =
    `You are AIRA, an AI lab assistant. Write at most 5 short sentences in plain English for the lab team, ` +
    `summarising the reagent check for ${a.month}: what looks wrong, what to order now, and what to investigate first.\n` +
    `Use only the facts below. Do not state any number that is not listed below, and do not add advice about patients.\n` +
    `Facts:\n${facts.join('\n')}\n` +
    `Always answer in English.`
  const text = (await complete(prompt)).trim()
  if (!text) throw new Error('The model returned an empty summary — try again.')
  return text
}
