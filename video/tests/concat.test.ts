import { test } from 'node:test'
import assert from 'node:assert/strict'
import { concatList } from '../src/concat'

test('frames last until the next one; the last frame is held to the end of the take', () => {
  const list = concatList([{ file: 'a.jpg', t: 1000 }, { file: 'b.jpg', t: 1040 }, { file: 'c.jpg', t: 1500 }], 2000)
  const durs = [...list.matchAll(/duration ([\d.]+)/g)].map((m) => Number(m[1]))
  assert.deepEqual(durs, [0.04, 0.46, 0.5])
  assert.ok(Math.abs(durs.reduce((s, d) => s + d, 0) - 1) < 0.001)
  assert.match(list, /^ffconcat version 1\.0\nfile 'a\.jpg'\nduration 0\.04\n/)
  // ffmpeg's concat demuxer ignores the last duration unless the last file is repeated
  assert.match(list, /file 'c\.jpg'\nduration 0\.5\nfile 'c\.jpg'\n$/)
})

test('irregular gaps are kept (an idle screen sends fewer frames)', () => {
  const list = concatList([{ file: 'a.jpg', t: 0 }, { file: 'b.jpg', t: 3000 }], 3100)
  assert.match(list, /duration 3\b/)
})
