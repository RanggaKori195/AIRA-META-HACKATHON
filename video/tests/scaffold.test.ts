import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { FPS, HEIGHT, TOTAL_FRAMES, WIDTH } from '../src/constants'

const json = (p: string): any => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'))

test('2:00 at 30 fps, 1920×1080', () => {
  assert.equal(FPS, 30)
  assert.equal(TOTAL_FRAMES, 3600)
  assert.equal(WIDTH, 1920)
  assert.equal(HEIGHT, 1080)
})

test('Remotion pinned to one exact version and the scripts exist', () => {
  const p = json('../package.json')
  for (const d of ['remotion', '@remotion/cli', '@remotion/media-utils']) assert.equal(p.dependencies[d], '4.0.536', d)
  for (const s of ['test', 'voices', 'render', 'studio']) assert.ok(p.scripts[s], s)
  assert.match(p.scripts.voices, /--env-file=\.\.\/\.env\.local/)
})

test('the app tsconfigs never include the video folder', () => {
  for (const f of ['../../tsconfig.node.json', '../../tsconfig.web.json']) {
    const inc: string[] = json(f).include
    assert.ok(!inc.some((x) => x.includes('video')), f)
  }
})
