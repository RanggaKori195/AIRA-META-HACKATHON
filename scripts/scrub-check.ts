// Fails when an employer term is visible in shipped files: string literals and JSX text in code (what a
// user, the model or a generated document can see), and every line of shipped text resources.
// --public scans every line and path of the files that go to the public repository (comments and identifiers too).
// Run: npm run scrub:check / npm run scrub:public
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, extname } from 'path'

// The terms are assembled at runtime (stored reversed) so this file itself stays clean in the public repository.
const rev = (s: string): string => s.split('').reverse().join('')
export const TERMS = new RegExp(
  [...['eblak', 'neglak', 'balonni', 'tfosnalro', 'retsamonni', 'ipirua'.replace('ir', 'ar')].map(rev), rev(')inmo|resrap|redoc|kniht(-ARUA')].join('|'),
  'i'
)

export interface ScrubHit {
  file: string
  line: number
  term: string
}

const CODE = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs'])
const TEXT = new Set(['.md', '.txt', '.json', '.yml', '.yaml', '.html', '.css', '.svg', '.xml'])

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (CODE.has(extname(name)) || TEXT.has(extname(name))) out.push(p)
  }
  return out
}

/** The files this build ships (source of the bundle + resources copied next to it). */
export function shippedFiles(): string[] {
  return [
    ...walk('src'),
    ...walk('resources'),
    ...walk('skills'),
    'package.json',
    'electron-builder.yml'
  ].filter((f) => existsSync(f) && !f.endsWith('.d.ts'))
}

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
}

/** A literal that is an identifier, enum value or module path — not text anyone reads. */
function notText(literal: string): boolean {
  const t = literal.trim()
  return /^[a-z0-9_]+$/.test(t) || (/^[\w@.\-/]+$/.test(t) && t.includes('/'))
}

function termInText(text: string): string | null {
  const m = text.match(TERMS)
  return m ? m[0] : null
}

export function scrubHits(files: string[]): ScrubHit[] {
  const hits: ScrubHit[] = []
  for (const file of files) {
    const raw = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
    const ext = extname(file)
    if (!CODE.has(ext)) {
      raw.split('\n').forEach((l, i) => {
        const term = termInText(l)
        if (term) hits.push({ file, line: i + 1, term })
      })
      continue
    }
    const s = stripComments(raw)
    const lineOf = (index: number): number => s.slice(0, index).split('\n').length
    const check = (text: string, index: number): void => {
      if (notText(text)) return
      const term = termInText(text)
      if (term) hits.push({ file, line: lineOf(index), term })
    }
    if (ext === '.tsx') for (const m of s.matchAll(/>([^<>{}]+)</g)) check(m[1], m.index!)
    for (const m of s.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
      check(m[1] ?? m[2] ?? m[3] ?? '', m.index!)
    }
  }
  return hits
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/scrub-check.ts')) {
  // --public: whole-file scan of every file that goes to the public repository (comments, identifiers, paths).
  void import('./public-files').then(({ publicFiles }) => {
    const pub = process.argv.includes('--public')
    const hits = pub ? publicScrubHits(publicFiles()) : scrubHits(shippedFiles())
    for (const h of hits.slice(0, 300)) console.log(`${h.file}:${h.line}  ${h.term}`)
    console.log(`${hits.length} hit(s)${pub ? ' in public files' : ''}`)
    process.exit(hits.length ? 1 : 0)
  })
}

/** Company infrastructure and people that must not be published: internal server addresses, colleagues' names. */
// Also catches the regex-escaped form (10\.x\.y\.z) used in test expectations; "125" is assembled so this line
// does not match itself.
export const INFRA = new RegExp(
  [String.raw`\b10\\?\.${'12' + '5'}\\?\.\d+\\?\.\d+\b`, ['Pak', 'Maman'].join(' '), String.raw`\b${'Ann' + 'es'}\b`].join('|')
)

/** Whole-file scan for the public repository: every line (comments and identifiers included) and every path. */
export function publicScrubHits(files: string[]): ScrubHit[] {
  const ANY = new RegExp(`${TERMS.source}|${INFRA.source}`, 'i')
  const hits: ScrubHit[] = []
  for (const file of files) {
    const name = file.match(ANY)
    if (name) hits.push({ file, line: 0, term: `path: ${name[0]}` })
    if (!(CODE.has(extname(file)) || TEXT.has(extname(file)) || /\.(cjs|mjs|gitignore|env\.example)$/.test(file))) continue
    if (!existsSync(file)) continue
    readFileSync(file, 'utf8')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .forEach((l, i) => {
        const m = l.match(ANY)
        if (m) hits.push({ file, line: i + 1, term: m[0] })
      })
  }
  return hits
}
