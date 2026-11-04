// Number check: every number Muse writes is looked up in the facts code gave it. Pure — tested in
// tests/number-check.test.ts, used by the AI draft summary, the Reagent Check chat and the morning briefing.
//
// It MARKS, it never deletes: a check that erases a true sentence is worse than one that misses a false number.
// What it can say is "this number is in the data", never "this sentence is right". Numbers written as words
// ("two boxes") are not checked.

export interface NumberHit {
  /** The number as written, e.g. "3,840" or "38%". */
  raw: string
  /** Position of `raw` in the checked text. */
  index: number
  value: number
  ok: boolean
  /** The fact the number was found in; null when it is not in the data. */
  source: string | null
}

export interface NumberCheck {
  hits: NumberHit[]
  matched: number
  unmatched: number
}

const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\\.?'
// Dates and list markers are not quantities: blanked out (same length, so positions stay right) before reading.
const SKIP = [
  /\b\d{4}-\d{2}(?:-\d{2})?\b/g,
  new RegExp(`\\b${MONTH}\\s+\\d{4}\\b`, 'gi'),
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}(?:,?\\s+\\d{4})?`, 'gi'),
  new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?`, 'gi'),
  /^\s*\d+[.)](?=\s)/gm
]

// A number standing on its own: not glued to a letter, digit, code hyphen or decimal point ("RGT-24", "HbA1c").
const NUMBER = /(?<![\p{L}\p{N}_.-])-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?(?![\p{L}\p{N}])/gu
const FACT_NUMBER = /-?\d+(?:,\d{3})*(?:\.\d+)?/g

const blank = (s: string): string => s.replace(/[^\n]/g, ' ')

function factNumbers(facts: string[]): Array<{ value: number; source: string }> {
  const out: Array<{ value: number; source: string }> = []
  for (const f of facts) {
    for (const m of f.matchAll(FACT_NUMBER)) out.push({ value: Math.abs(Number(m[0].replace(/,/g, ''))), source: f })
  }
  return out
}

const roundTo = (n: number, decimals: number): number => Number(n.toFixed(decimals))

export function checkNumbers(text: string, facts: string[]): NumberCheck {
  let scan = text
  for (const re of SKIP) scan = scan.replace(re, blank)
  const known = factNumbers(facts)
  const hits: NumberHit[] = []
  for (const m of scan.matchAll(NUMBER)) {
    const raw = m[0]
    const percent = raw.endsWith('%')
    const digits = raw.replace(/[%,]/g, '')
    const value = Number(digits)
    const decimals = digits.includes('.') ? digits.split('.')[1].length : 0
    const target = Math.abs(value)
    // A fact matches when it rounds to the number as written ("19.9" from 19.87); a percent may be a fraction.
    const found = known.find(
      (k) => roundTo(k.value, decimals) === target || (percent && roundTo(k.value * 100, decimals) === target)
    )
    hits.push({ raw, index: m.index ?? 0, value, ok: found !== undefined, source: found?.source ?? null })
  }
  const matched = hits.filter((h) => h.ok).length
  return { hits, matched, unmatched: hits.length - matched }
}
