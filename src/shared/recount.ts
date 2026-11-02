// Voice recount (pure — used by the Reagent Check screen and the tests). Reads a spoken stock count ("EGFR
// mutation kit, three boxes. Filter tips two hundred microliter, forty racks.") into rows and compares each
// with the stock-opname closing count. Nothing is guessed: an ambiguous item, a missing count or an unknown unit
// is shown as "unclear" for the user to fix in the review table, and nothing is sent or saved by this module.
import type { RecountItem, RecountRow, RecountStatus } from './reagent'

export type { RecountRow, RecountStatus } from './reagent'

/** The best item match must reach this share of its name tokens, and beat the second best. */
export const MATCH_THRESHOLD = 0.6

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19
}
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
/** Container words people say for "a pack" whatever the Item List calls it. */
const PACK_WORDS = new Set(['box', 'kit', 'pack', 'bottle', 'rack', 'vial', 'bag', 'tube', 'case', 'carton'])
/** Words for one test / one piece. */
const PIECE_WORDS = new Set(['test', 'pc', 'pcs', 'piece'])

const isNum = (t: string | undefined): boolean => !!t && /^\d+(\.\d+)?$/.test(t)
const isNumWord = (t: string | undefined): boolean => !!t && (t in ONES || t in TENS || t === 'hundred' || t === 'thousand')
const r3 = (n: number): number => Math.round(n * 1000) / 1000

function singular(w: string): string {
  if (isNum(w) || w.length <= 3) return w
  if (/(x|sh|ch|ss)es$/.test(w)) return w.slice(0, -2)
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

/** Number words → digits: "two hundred and thirteen" → "213", "twenty-four" → "24", "a box" → "1 box". */
function wordsToDigits(tokens: string[], unitWords: Set<string>): string[] {
  const out: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if ((t === 'a' || t === 'an') && unitWords.has(singular(tokens[i + 1] ?? ''))) {
      out.push('1')
      continue
    }
    if (!isNumWord(t)) {
      out.push(t)
      continue
    }
    let cur = 0
    let thousands = 0
    while (i < tokens.length) {
      const w = tokens[i]
      if (w in ONES || w in TENS) cur += ONES[w] ?? TENS[w]
      else if (w === 'hundred') cur = (cur || 1) * 100
      else if (w === 'thousand') {
        thousands += (cur || 1) * 1000
        cur = 0
      } else if (w === 'and' && thousands + cur >= 100 && isNumWord(tokens[i + 1])) {
        // "two hundred and thirteen": skip the "and"
      } else break
      i++
    }
    i--
    out.push(String(thousands + cur))
  }
  return out
}

function tokens(text: string, unitWords: Set<string> = PACK_WORDS): string[] {
  const s = text
    .toLowerCase()
    .replace(/[µμ]/g, 'u')
    .replace(/\bmicrolit(?:er|re)s?\b/g, 'ul')
    .replace(/\bmillilit(?:er|re)s?\b/g, 'ml')
    .replace(/(\d),(\d{3})(?!\d)/g, '$1$2') // "3,840" is a thousands separator
    .replace(/(\d)\.(\d)/g, '$1\u0000$2') // keep decimal points
    .replace(/[^a-z0-9\u0000\s]/g, ' ')
    .replace(/\u0000/g, '.')
  return wordsToDigits(s.split(/\s+/).filter(Boolean), unitWords).map(singular)
}

/** A spoken or written number ("16", "2.5", "sixteen", "two hundred and thirteen", "a"), or null. */
export function parseNumber(words: string): number | null {
  const t = words.trim().toLowerCase()
  if (t === 'a' || t === 'an') return 1
  const toks = tokens(t)
  return toks.length === 1 && isNum(toks[0]) ? Number(toks[0]) : null
}

const compact = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** The unit a heard word means for this item (its pack or base unit name), or null when it cannot be mapped. */
function unitFor(heard: string | null, item: RecountItem): { unit: string | null; assumed: boolean } {
  if (heard === null) return { unit: item.packUnit, assumed: true }
  const w = singular(heard.toLowerCase())
  const pack = singular(item.packUnit.toLowerCase())
  const base = singular(item.baseUnit.toLowerCase())
  if (w === base || (PIECE_WORDS.has(w) && PIECE_WORDS.has(base))) return { unit: item.baseUnit, assumed: false }
  // A count noun that names the item itself ("21 vials" of a vial item, "2213 tubes" of PCR tubes) counts single
  // pieces when the item is counted in pieces; a kit of tests ("three kits" of a test kit) stays the pack.
  if (w !== pack && PIECE_WORDS.has(base) && base !== 'test' && tokens(item.itemName).includes(w)) return { unit: item.baseUnit, assumed: false }
  if (w === pack || PACK_WORDS.has(w)) return { unit: item.packUnit, assumed: false }
  return { unit: null, assumed: false }
}

/**
 * Phrases end at sentence ends and newlines. A comma joins the next chunk when that chunk starts with a number
 * ("Filter tips 200 microliter, forty racks"); otherwise it starts the next item ("…3 boxes, DNA extraction kit…").
 */
function splitPhrases(text: string, unitWords: Set<string>, countUnits: Set<string>): string[] {
  const out: string[] = []
  for (const piece of text.split(/(?<=[.;!?])\s+|\n+/)) {
    let current: string[] = []
    for (const chunk of piece.split(/,(?!\d{3}(?!\d))\s*/).map((c) => c.trim()).filter(Boolean)) {
      if (current.length && !isNum(tokens(chunk, unitWords)[0])) {
        out.push(current.join(', '))
        current = []
      }
      current.push(chunk)
    }
    if (current.length) out.push(current.join(', '))
  }
  const phrases = out.map((p) => p.replace(/[.;!?]+$/, '').trim()).filter(Boolean).flatMap((p) => splitRunOn(p, countUnits))
  // "DNA high risk kit. Three boxes." — a phrase that is only a count joins the phrase before it when that one
  // has no count yet (speech-to-text often puts a full stop between the name and the count).
  const merged: string[] = []
  for (const p of phrases) {
    const t = tokens(p, unitWords)
    const countOnly = t.length > 0 && isNum(t[0]) && t.slice(1).every((w) => unitWords.has(w))
    const prev = merged[merged.length - 1]
    if (countOnly && prev !== undefined && !tokens(prev, unitWords).some(isNum)) merged[merged.length - 1] = `${prev}. ${p}`
    else merged.push(p)
  }
  return merged
}

const rawNum = (w: string): boolean => {
  const s = w.toLowerCase().replace(/[^a-z0-9.,-]/g, '')
  return /^\d[\d,.]*$/.test(s) || s.split('-').every((x) => isNumWord(x))
}

/**
 * Run-on speech without punctuation ("56 tests crass mutation kit 8 tests NRAS…"): a count followed by a count
 * unit (box, rack, test, piece … — not mL/µL, which appear inside names) ends a phrase when more words follow.
 */
function splitRunOn(phrase: string, countUnits: Set<string>): string[] {
  const words = phrase.split(/\s+/)
  const out: string[] = []
  let start = 0
  for (let i = 1; i < words.length - 1; i++) {
    const unit = singular(words[i].toLowerCase().replace(/[^a-z]/g, ''))
    if (countUnits.has(unit) && rawNum(words[i - 1])) {
      out.push(words.slice(start, i + 1).join(' '))
      start = i + 1
    }
  }
  out.push(words.slice(start).join(' '))
  return out.map((s) => s.replace(/^[,\s]+|[,\s]+$/g, '')).filter(Boolean)
}

/**
 * Indexes of the segment tokens that match a name token: the same word, two adjacent words that together spell it
 * ("thin prep" → "thinprep"), or a shared start of at least 6 letters ("preserve" ~ "preservcyt").
 */
function matchToken(name: string, seg: string[], used: Set<number>): number[] | null {
  const at = seg.findIndex((s, i) => !used.has(i) && s === name)
  if (at >= 0) return [at]
  for (let i = 0; i + 1 < seg.length; i++) {
    if (!used.has(i) && !used.has(i + 1) && seg[i] + seg[i + 1] === name) return [i, i + 1]
  }
  if (name.length >= 6 && !isNum(name)) {
    const j = seg.findIndex((s, i) => !used.has(i) && s.length >= 6 && commonStart(s, name) >= 6)
    if (j >= 0) return [j]
  }
  return null
}

function commonStart(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n
}

/** Longest phrase kept on a row (the export schema accepts 500 characters). */
const MAX_PHRASE = 500

const unitWordsFor = (items: RecountItem[]): Set<string> =>
  new Set([...PACK_WORDS, ...PIECE_WORDS, ...items.flatMap((i) => [i.packUnit, i.baseUnit].map((u) => singular(u.toLowerCase())))])

/** How well an item's name (or its spoken code) matches the phrase, and which phrase tokens it used. */
function nameMatch(item: RecountItem, seg: string[], segCompact: string, unitWords: Set<string>): { score: number; used: Set<number> } {
  const used = new Set<number>()
  const code = compact(item.itemCode)
  if (code.length >= 4 && segCompact.includes(code)) {
    for (const w of tokens(item.itemCode.replace(/-/g, ' '), unitWords)) matchToken(w, seg, used)?.forEach((i) => used.add(i))
    return { score: 1, used }
  }
  const name = tokens(item.itemName, unitWords)
  let hit = 0
  for (const n of name) {
    const m = matchToken(n, seg, used)
    if (m) {
      hit++
      m.forEach((i) => used.add(i))
    }
  }
  return { score: name.length ? hit / name.length : 0, used }
}

/** The count left after the item's own words are removed (so "200 ul" in a name is never the count), and the word after it. */
function countAfter(seg: string[], used: Set<number>): { count: number | null; heardUnit: string | null } {
  const rest = seg.filter((_w, i) => !used.has(i))
  const nums = rest.map((w, i) => (isNum(w) ? i : -1)).filter((i) => i >= 0)
  if (nums.length !== 1) return { count: null, heardUnit: null }
  const after = rest[nums[0] + 1]
  return { count: Number(rest[nums[0]]), heardUnit: after && !isNum(after) ? after : null }
}

export function parseRecount(transcript: string, items: RecountItem[]): RecountRow[] {
  const unitWords = unitWordsFor(items)
  const countUnits = new Set([...PACK_WORDS, ...PIECE_WORDS, ...items.map((i) => singular(i.packUnit.toLowerCase()))])
  const rows: RecountRow[] = splitPhrases(transcript, unitWords, countUnits).map((phrase, idx) => {
    const seg = tokens(phrase, unitWords)
    const segCompact = compact(phrase)
    const scored = items.map((item) => ({ item, ...nameMatch(item, seg, segCompact, unitWords) }))
    const best = Math.max(0, ...scored.map((s) => s.score))
    const top = best >= MATCH_THRESHOLD ? scored.filter((s) => s.score === best) : []
    // An ambiguous match reads no count: which number is the count depends on the item ("Genotyping 28 …, fourteen
    // tests" — 14 is part of the other candidate's name). It is read again once the user picks the item.
    const read = top.length === 1 ? countAfter(seg, top[0].used) : { count: null, heardUnit: null }
    return {
      id: `r${idx + 1}`,
      // Kept short enough to export (a 60-second run-on without unit words can be one long phrase).
      phrase: phrase.length > MAX_PHRASE ? phrase.slice(0, MAX_PHRASE - 1) + '…' : phrase,
      itemCode: top.length === 1 ? top[0].item.itemCode : null,
      candidates: top.map((s) => s.item.itemCode),
      count: read.count,
      heardUnit: read.heardUnit,
      unit: null,
      unitAssumed: false,
      voiceBase: null,
      fileBase: null,
      diffBase: null,
      diffPacks: null,
      status: 'unclear' as RecountStatus,
      refs: []
    }
  })
  return compareRecount(rows, items).rows
}

/** Recomputes every row's status (after parsing or after the user edited item / count / unit / removed rows). */
export function compareRecount(rows: RecountRow[], items: RecountItem[]): { rows: RecountRow[]; notCounted: RecountItem[] } {
  const byCode = new Map(items.map((i) => [i.itemCode, i]))
  const unitWords = unitWordsFor(items)
  const seen = new Map<string, number>()
  for (const r of rows) if (r.itemCode) seen.set(r.itemCode, (seen.get(r.itemCode) ?? 0) + 1)
  const out = rows.map((r): RecountRow => {
    const clean: RecountRow = { ...r, voiceBase: null, fileBase: null, diffBase: null, diffPacks: null, refs: [], reason: undefined }
    const item = r.itemCode ? byCode.get(r.itemCode) : undefined
    if (!item) {
      if (r.itemCode) return { ...clean, status: 'not_recognized', reason: `${r.itemCode} is not in this month's stock count` }
      return r.candidates.length > 1
        ? { ...clean, status: 'unclear', reason: `more than one item matches: ${r.candidates.join(', ')} — pick one` }
        : { ...clean, status: 'not_recognized', reason: 'no item in the Item List matches this phrase' }
    }
    // No count yet (an ambiguous match the user has now resolved): read it from the phrase for THIS item.
    if (r.count === null) {
      const seg = tokens(r.phrase, unitWords)
      const again = countAfter(seg, nameMatch(item, seg, compact(r.phrase), unitWords).used)
      if (again.count !== null) r = { ...r, count: again.count, heardUnit: r.heardUnit ?? again.heardUnit }
    }
    const kept = r.unit && [item.packUnit, item.baseUnit].includes(r.unit) ? { unit: r.unit, assumed: r.unitAssumed } : unitFor(r.heardUnit, item)
    const withItem: RecountRow = { ...clean, count: r.count, heardUnit: r.heardUnit, unit: kept.unit, unitAssumed: kept.assumed, refs: item.refs }
    if (r.count === null) return { ...withItem, status: 'unclear', reason: 'no single count heard' }
    if (kept.unit === null) return { ...withItem, status: 'unclear', reason: `unit "${r.heardUnit}" is not recognized for ${item.itemName}` }
    if ((seen.get(item.itemCode) ?? 0) > 1) return { ...withItem, status: 'said_twice', reason: 'this item was counted more than once — remove one row' }
    const voiceBase = r3(kept.unit === item.packUnit ? r.count * item.packSize : r.count)
    if (item.closing === null) return { ...withItem, voiceBase, status: 'not_comparable', reason: item.reason ?? 'the stock count cannot be converted' }
    const diffBase = r3(voiceBase - item.closing)
    return {
      ...withItem,
      voiceBase,
      fileBase: item.closing,
      diffBase,
      diffPacks: r3(diffBase / item.packSize),
      status: diffBase === 0 ? 'matches' : 'differs'
    }
  })
  const spoken = new Set(out.map((r) => r.itemCode).filter(Boolean))
  return { rows: out, notCounted: items.filter((i) => !spoken.has(i.itemCode)) }
}
