import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  DDL_PUBLIC,
  DDL_INNO,
  DROP_STATEMENTS,
  PATIENT_COLUMNS,
  SALES_REPOSITORY,
  SAMPLE_TRACKER,
  ALL_TABLES
} from '../scripts/seed/ddl'
import { makeRng } from '../scripts/seed/prng'
import { KOLOM_AMAN } from '../src/main/lab/rules'
import { KOLOM_DIBACA } from '../src/main/sales/order-status'

const allDdl = [...DDL_PUBLIC, ...DDL_INNO].join('\n')

describe('seed DDL: patient data cannot exist in the dummy DB', () => {
  test('no table has a patient column', () => {
    for (const t of ALL_TABLES) {
      for (const [col] of t.columns) {
        assert.ok(!(PATIENT_COLUMNS as readonly string[]).includes(col), `${t.name}.${col}`)
      }
    }
    for (const c of PATIENT_COLUMNS) assert.doesNotMatch(allDdl, new RegExp(`\\b${c}\\b`), c)
  })

  test('m_sales_cr (full PII table) is never created', () => {
    assert.doesNotMatch(allDdl, /m_sales_cr/)
  })

  test('drops never touch app-owned tb_* tables', () => {
    for (const s of DROP_STATEMENTS) assert.doesNotMatch(s, /\btb_/, s)
  })
})

describe('seed DDL: covers every column the app reads', () => {
  test('tracker has every KOLOM_AMAN column (lab tools allow-list)', () => {
    const cols = SAMPLE_TRACKER.columns.map(([c]) => c)
    for (const k of KOLOM_AMAN) assert.ok(cols.includes(k), k)
  })

  test('SalesRepository has every column sales_order_status reads', () => {
    const cols = SALES_REPOSITORY.columns.map(([c]) => c)
    for (const k of KOLOM_DIBACA) assert.ok(cols.includes(k), k)
  })

  test('v_sample_tracker view is created over t_sample_tracker', () => {
    assert.match(allDdl, /CREATE VIEW public\.v_sample_tracker AS SELECT .+ FROM public\.t_sample_tracker/s)
  })
})

describe('seed PRNG is deterministic', () => {
  test('same seed, same sequence', () => {
    const a = makeRng(42)
    const b = makeRng(42)
    assert.deepEqual([1, 2, 3, 4, 5].map(() => a.next()), [1, 2, 3, 4, 5].map(() => b.next()))
  })

  test('int(min, max) stays inclusive in range', () => {
    const r = makeRng(7)
    const seen = new Set<number>()
    for (let i = 0; i < 1000; i++) {
      const v = r.int(1, 3)
      assert.ok(v >= 1 && v <= 3, String(v))
      seen.add(v)
    }
    assert.deepEqual([...seen].sort(), [1, 2, 3])
  })
})
