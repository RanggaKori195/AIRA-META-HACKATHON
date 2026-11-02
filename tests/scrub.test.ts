import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { scrubHits, shippedFiles } from '../scripts/scrub-check'

// Hackathon build: no employer identity in anything shipped (UI, prompts, tool text, documents, resources).

/** Company terms for the fixture, stored reversed so this file stays clean in the public repository. */
const rev = (s: string): string => s.split('').reverse().join('')
const T = { a: rev('eblaK'), b: rev('baloNNI NeGLAK'), c: rev('tfosnalrO') }

describe('scrub check', () => {
  test('finds names in text and ignores identifiers and comments', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scrub-'))
    const f = join(dir, 'x.ts')
    writeFileSync(
      f,
      [
        `// ${T.a} in a comment is not shipped text`,
        `const a = 'Made by ${T.b}'`,
        "const sql = 'SELECT order_id FROM t'",
        "const scope = 'erp'",
        `const b = \`Sent to ${T.c} ERP\``
      ].join('\n')
    )
    assert.deepEqual(
      scrubHits([f]).map((h) => h.line),
      [2, 5]
    )
  })

  test('shipped files carry no employer identity', () => {
    const hits = scrubHits(shippedFiles())
    assert.equal(hits.length, 0, hits.slice(0, 40).map((h) => `${h.file}:${h.line} ${h.term}`).join('\n'))
  })
})

describe('public repository', () => {
  test('no company term anywhere in public files — comments, identifiers and paths included', async () => {
    const { publicScrubHits } = await import('../scripts/scrub-check')
    const { publicFiles, isPrivate } = await import('../scripts/public-files')
    assert.equal(isPrivate('HANDOFF.md'), true)
    assert.equal(isPrivate('src/main/index.ts'), false)
    const hits = publicScrubHits(publicFiles())
    assert.equal(hits.length, 0, `${hits.length} hits:\n` + hits.slice(0, 40).map((h) => `${h.file}:${h.line} ${h.term}`).join('\n'))
  })
})
