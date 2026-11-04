import type { JSX } from 'react'
import type { NumberCheck } from '../../../shared/number-check'

// Muse text with its numbers marked by the number check: a number found in the data points at its fact, a number
// that is not in the data gets a warning. The text itself is never changed or shortened.

export function NumberMarks({ text, check }: { text: string; check: NumberCheck }): JSX.Element {
  const parts: Array<string | JSX.Element> = []
  let at = 0
  check.hits.forEach((h, i) => {
    if (h.index < at) return
    parts.push(text.slice(at, h.index))
    parts.push(
      h.ok ? (
        <span key={i} className="num-ok" title={`From the data: ${h.source ?? ''}`}>
          {h.raw}
        </span>
      ) : (
        <span key={i} className="num-warn" title="Not in the reagent data">
          ⚠ {h.raw}
        </span>
      )
    )
    at = h.index + h.raw.length
  })
  parts.push(text.slice(at))
  return <>{parts}</>
}

/** Strip under a Reagent Check chat answer: how many numbers match, and which ones are not in the data. */
export function NumberCheckStrip({ check }: { check: NumberCheck }): JSX.Element {
  const missing = check.hits.filter((h) => !h.ok).map((h) => h.raw)
  return (
    <div className={missing.length ? 'num-strip num-strip-warn' : 'num-strip'}>
      <strong>Number check</strong>
      <span>✓ {check.matched} match the reagent data</span>
      {missing.length > 0 && <span>⚠ {missing.length} not in the reagent data: {missing.join(', ')}</span>}
    </div>
  )
}

/** One line under the text: how many of its numbers were found in the data. */
export function numberCheckLine(check: NumberCheck, data: string): string {
  const n = check.hits.length
  if (n === 0) return 'No numbers to check.'
  if (check.unmatched === 0) return `All ${n} ${n === 1 ? 'number matches' : 'numbers match'} the ${data}.`
  return `${check.matched} of ${n} numbers match the ${data} — check the marked ${check.unmatched === 1 ? 'one' : 'ones'} before sharing.`
}
