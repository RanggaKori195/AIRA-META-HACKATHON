import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { scrubHits, shippedFiles } from '../scripts/scrub-check'

// Hackathon build: no employer identity in anything shipped (UI, prompts, tool text, documents, resources).

describe('scrub check', () => {
  test('finds names in text and ignores identifiers and comments', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scrub-'))
    const f = join(dir, 'x.ts')
    writeFileSync(
      f,
      [
        '// the company in a comment is not shipped text',
        "const a = 'Made by the lab'",
        "const sql = 'SELECT order_id FROM t'",
        "const scope = 'erp'",
        "import x from '../masterdata/db'",
        'const b = `Sent to ERP`'
      ].join('\n')
    )
    assert.deepEqual(
      scrubHits([f]).map((h) => h.line),
      [2, 6]
    )
  })

  test('shipped files carry no employer identity', () => {
    const hits = scrubHits(shippedFiles())
    assert.equal(hits.length, 0, hits.slice(0, 40).map((h) => `${h.file}:${h.line} ${h.term}`).join('\n'))
  })
})
