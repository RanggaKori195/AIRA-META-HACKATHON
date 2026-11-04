// Speech-to-text spells some app words its own way ("Ranga", "Thin Prep PreserveSite"). Captions use the app's
// spelling instead — an explicit list of names from the app and its demo data, not a guess. Each replacement token
// takes the time span of the tokens it consumes, and keeps the trailing punctuation. Pure — tests/composition2.
import type { Word } from './take'

export interface CaptionFix {
  from: string[]
  /** [new token, how many old tokens it consumes] */
  to: [string, number][]
}
export const CAPTION_FIXES: CaptionFix[] = [
  { from: ['ranga'], to: [['Rangga', 1]] },
  { from: ['thin', 'prep', 'preservesite'], to: [['ThinPrep', 2], ['PreservCyt', 1]] },
  { from: ['ask', 'sales', 'data'], to: [['Ask', 1], ['Sales', 1], ['Data', 1]] },
  { from: ['reagent', 'check'], to: [['Reagent', 1], ['Check', 1]] }
]

const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
const tail = (s: string): string => s.match(/[^\p{L}\p{N}]*$/u)?.[0] ?? ''

export function fixWords(words: Word[], fixes: CaptionFix[]): Word[] {
  const out: Word[] = []
  for (let i = 0; i < words.length; ) {
    const fix = fixes.find((f) => f.from.every((w, k) => words[i + k] && norm(words[i + k].text) === w))
    if (!fix) {
      out.push(words[i++])
      continue
    }
    let k = i
    for (const [text, n] of fix.to) {
      const part = words.slice(k, k + n)
      out.push({ text: text + tail(part[part.length - 1].text), start: part[0].start, end: part[part.length - 1].end })
      k += n
    }
    i += fix.from.length
  }
  return out
}
