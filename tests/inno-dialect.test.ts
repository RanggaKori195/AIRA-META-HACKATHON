import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { toPgPlaceholders, INNO_PG_TYPES } from '../src/main/masterdata/sql-dialect'
import { validityOf } from '../src/main/masterdata/rules'

describe('toPgPlaceholders: MySQL ? placeholders become Postgres $n', () => {
  test('numbers placeholders in order', () => {
    assert.equal(
      toPgPlaceholders('SELECT * FROM m_item WHERE a = ? AND b LIKE ? LIMIT 5'),
      'SELECT * FROM m_item WHERE a = $1 AND b LIKE $2 LIMIT 5'
    )
  })

  test('leaves ? inside string literals alone', () => {
    assert.equal(toPgPlaceholders("SELECT '?' AS q, x FROM t WHERE y = ?"), "SELECT '?' AS q, x FROM t WHERE y = $1")
    assert.equal(toPgPlaceholders("WHERE n = 'it''s ?' AND m = ?"), "WHERE n = 'it''s ?' AND m = $1")
  })

  test('works inside expressions', () => {
    assert.equal(toPgPlaceholders('ORDER BY (i.item_code = ?) DESC'), 'ORDER BY (i.item_code = $1) DESC')
  })
})

// SQL in these files runs on Postgres in the hackathon copy.
const INNO_SQL_FILES = [
  'src/main/tools/inno-tools.ts',
  'src/main/masterdata/db.ts',
  'src/main/masterdata/rules.ts',
  'src/main/masterdata/categories.ts',
  'src/main/dashboard/inno.ts'
]

function codeLines(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
}

describe('Master Data SQL is Postgres-safe', () => {
  test('LIKE stays case-insensitive (MySQL default) → every LIKE is ILIKE', () => {
    for (const f of INNO_SQL_FILES) {
      const bad = codeLines(f).filter((l) => /(^|[^I])LIKE\s+\?/.test(l))
      assert.deepEqual(bad, [], f)
    }
  })

  test('the pool is pg, not mysql2, and is guarded as local-only', () => {
    const src = readFileSync('src/main/masterdata/db.ts', 'utf8')
    assert.doesNotMatch(src, /from 'mysql2/)
    assert.match(src, /assertLocalDb\(BUNDLED\.innoDb, 'AIRA_INNO_DB'\)/)
    assert.match(src, /search_path=inno/)
  })
})

describe('Master Data pool types mirror mysql2 (dateStrings, numeric numbers)', () => {
  test('DATE and TIMESTAMP stay strings — validity rules slice them as YYYY-MM-DD', () => {
    assert.equal(INNO_PG_TYPES.getTypeParser(1082)('2026-06-01'), '2026-06-01')
    assert.equal(INNO_PG_TYPES.getTypeParser(1114)('2026-06-01 10:00:00'), '2026-06-01 10:00:00')
    assert.equal(INNO_PG_TYPES.getTypeParser(1184)('2026-06-01 10:00:00+07'), '2026-06-01 10:00:00+07')
  })

  test('a special price that started in the past is active (regression: Date objects made every row "not started")', () => {
    const start = INNO_PG_TYPES.getTypeParser(1082)('2025-06-01') as unknown as string
    const end = INNO_PG_TYPES.getTypeParser(1082)('2222-12-30') as unknown as string
    assert.equal(validityOf(start, end, '2026-11-02'), 'aktif')
  })

  test('NUMERIC becomes a number; other types keep pg defaults', () => {
    assert.equal(INNO_PG_TYPES.getTypeParser(1700)('123.50'), 123.5)
    assert.equal(INNO_PG_TYPES.getTypeParser(23)('5'), 5)
  })

  test('the parsers are scoped to the Master Data pool, not set process-wide', () => {
    const src = readFileSync('src/main/masterdata/db.ts', 'utf8')
    assert.match(src, /types: INNO_PG_TYPES/)
    assert.doesNotMatch(src, /types\.setTypeParser\(/)
  })
})
