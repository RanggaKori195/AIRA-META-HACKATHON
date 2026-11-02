import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'

// The hackathon dummy DB is PostgreSQL 13; production is 16. In PG13 EXTRACT() returns double
// precision and round(double precision, integer) does not exist — the value must be cast to numeric.
test('round(EXTRACT(...) / n, d) always casts to numeric first (works on PG13 and PG16)', () => {
  for (const f of ['src/main/lab/tracker.ts', 'src/main/pemantau/sql.ts', 'src/main/sales/tat.ts']) {
    const bad = readFileSync(f, 'utf8')
      .split(/\r?\n/)
      .filter((l) => /round\(EXTRACT\(/.test(l) && !/::numeric, \d\)/.test(l))
    assert.deepEqual(bad, [], f)
  }
})
