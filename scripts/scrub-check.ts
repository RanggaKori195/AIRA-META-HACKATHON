// Fails when an employer term is visible in shipped files: string literals and JSX text in code (what a
// user, the model or a generated document can see), and every line of shipped text resources.
// Code identifiers (`order_id` column, `sales_order_status` tool, `not_erp` scope value, module paths)
// stay until the public-repo pass; comments are not shipped as text and are scrubbed there too.
// Run: npm run scrub:check
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, extname } from 'path'

export const TERMS = /company|orderId|lab|erp|masterdata|gateway|AURA-(think|coder|parser|omni)/i

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

/** Term occurrences inside snake_case identifiers (order_id, sales_order_status, is_erp) are code. */
function termInText(text: string): string | null {
  // All-lowercase `erp` / `masterdata` are identifiers (scope value, mode id, CSS class), not names.
  const cleaned = text.replace(/\b\w*_\w*\b/g, ' ').replace(/\b(erp|masterdata)\b/g, ' ')
  const m = cleaned.match(TERMS)
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
  const hits = scrubHits(shippedFiles())
  for (const h of hits.slice(0, 200)) console.log(`${h.file}:${h.line}  ${h.term}`)
  console.log(`${hits.length} hit(s)`)
  process.exit(hits.length ? 1 : 0)
}
