// The name AIRA calls the user, read from what they said when asked "What should I call you?". Pure — tested in
// tests/agent-pure.test.ts and tests/agent-review-fixes.test.ts. Read by code, never by the model: a name AIRA
// invents would be said back every morning.

const PATTERNS = [
  /\bcall me\s+(.+)/i,
  /\bmy name'?s\s+(.+)/i,
  /\bmy name is\s+(.+)/i,
  /\bi am\s+(.+)/i,
  /\bi'm\s+(.+)/i,
  /\bit'?s\s+(.+)/i,
  /\bthis is\s+(.+)/i
]
const FILLER = new Set(['uh', 'um', 'er', 'erm', 'please', 'just', 'hi', 'hello', 'hey', 'so', 'well'])
// Answers, pattern words said without a name, greetings and "not now" — none of them is a name.
const NOT_A_NAME = new Set([
  'yes', 'yeah', 'no', 'nope', 'okay', 'ok', 'sure', 'nothing', 'none', 'aira', 'thanks', 'thank', 'you', 'me',
  "i'm", 'im', 'i', 'am', 'this', 'is', 'my', 'name', "it's", 'its', 'call',
  'good', 'morning', 'afternoon', 'evening', 'night', 'there',
  'sorry', 'what', 'who', 'pardon', 'huh', 'not', 'now', 'later'
])
const WORD = /^\p{L}[\p{L}'-]*$/u
const MAX_NAME = 24

const capitalise = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()

export function parseCallName(transcript: string): string | null {
  // Transcripts often use a curly apostrophe ("I’m Rangga").
  const said = transcript.trim().replace(/[’‘]/g, "'")
  // "Sorry?", "Rangga?" — a question back is not an answer.
  if (said.endsWith('?')) return null
  const named = PATTERNS.map((p) => p.exec(said)).find((m) => m)?.[1] ?? said
  const words = named
    .replace(/[.!,;:]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w.toLowerCase()))
  if (words.length < 1 || words.length > 2) return null
  if (words.some((w) => NOT_A_NAME.has(w.toLowerCase()) || !WORD.test(w))) return null
  const name = words.map(capitalise).join(' ')
  return name.length <= MAX_NAME ? name : null
}
