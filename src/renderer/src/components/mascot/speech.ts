// What the mascot reads aloud after an answer: a short spoken summary, never the tables or code.
// Pure — tested in tests/mascot-speech.test.ts. Numbers come from the answer text as written (they
// already came from tools); nothing here computes or rounds them.

const MAX_SENTENCES = 3
const MAX_CHARS = 400
const FALLBACK = 'Here are the results.'

function cleanLine(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/(\*\*|__|`)/g, '')
    .replace(/(^|\s)[*_](\S)/g, '$1$2')
    .replace(/(\S)[*_](?=\s|$|[.,!?:;])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

export function speechText(answer: string): string {
  const withoutCode = answer.replace(/```[\s\S]*?(```|$)/g, '\n')
  const lines = withoutCode
    .split(/\r?\n/)
    .filter((l) => !l.includes('|'))
    .map(cleanLine)
    .filter((l) => /[\p{L}\p{N}]/u.test(l))
    .map((l) => (/[.!?:]$/.test(l) ? l : `${l}.`))
  const text = lines.join(' ').replace(/\s+([.,!?:;])/g, '$1')
  if (!text) return FALLBACK

  const sentences = text.split(/(?<=[.!?])\s+/).slice(0, MAX_SENTENCES)
  while (sentences.length > 1 && sentences.join(' ').length > MAX_CHARS) sentences.pop()
  let out = sentences.join(' ')
  if (out.length > MAX_CHARS) {
    const cut = out.slice(0, MAX_CHARS)
    out = cut.slice(0, Math.max(cut.lastIndexOf(' '), 1)).trim()
  }
  return out || FALLBACK
}

export function pickVoice<V extends { name: string; lang: string }>(voices: V[]): V | null {
  return (
    voices.find((v) => /zira/i.test(v.name)) ??
    voices.find((v) => /david/i.test(v.name)) ??
    voices.find((v) => /^en-US$/i.test(v.lang.replace('_', '-'))) ??
    voices.find((v) => /^en\b/i.test(v.lang)) ??
    null
  )
}
