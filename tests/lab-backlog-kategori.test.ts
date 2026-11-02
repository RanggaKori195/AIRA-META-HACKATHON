import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'

// Found from the app (2 Nov 2026, Muse Wonder): "backlog per category" made the model call lab_backlog once per
// category, hit the 5-call limit and answer without PK and MB. One call must carry the per-category breakdown.
const src = (p: string): string => readFileSync(p, 'utf8')

test('backlog query returns a per-category breakdown from the same filter', () => {
  const s = src('src/main/lab/tracker.ts')
  const fn = s.slice(s.indexOf('export async function backlog'), s.indexOf('// -------------------------------------------------------------------- lacak'))
  assert.match(fn, /SELECT category,[\s\S]*FROM \$\{VIEW\} WHERE \$\{where\}\s*GROUP BY 1/)
  assert.match(fn, /perKategori:/)
})

test('lab_backlog result hands perKategori to the model', () => {
  assert.match(src('src/main/tools/lab-tools.ts'), /perKategori: hasil\.perKategori/)
})
