import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { makeRng } from '../scripts/seed/prng'
import { generateSales } from '../scripts/seed/sales'
import { generateTracker } from '../scripts/seed/tracker'
import { generateInno } from '../scripts/seed/inno'
import { resolveUntil } from '../scripts/seed/until'
import {
  columnNames,
  SALES_REPOSITORY,
  M_CUSTOMER,
  M_ITEM_REPOSITORY,
  SAMPLE_TRACKER,
  TABLES_INNO
} from '../scripts/seed/ddl'

const FROM = new Date('2025-01-01T00:00:00')
const UNTIL = new Date('2026-11-02T23:59:00')
const S = columnNames(SALES_REPOSITORY)
const col = (name: string): number => S.indexOf(name)

const sales = generateSales(makeRng(20261102), FROM, UNTIL)
const tracker = generateTracker(makeRng(20261102 + 1), sales.orderIdOrders, UNTIL)
const inno = generateInno(makeRng(20261102 + 2), sales.customers, sales.items)

function ymd(v: unknown): string {
  return String(v).slice(0, 10)
}

describe('generateSales: realistic, deterministic, traps included', () => {
  test('same seed gives identical data', () => {
    const again = generateSales(makeRng(20261102), FROM, UNTIL)
    assert.equal(again.sales.length, sales.sales.length)
    assert.deepEqual(again.sales[0], sales.sales[0])
    assert.deepEqual(again.sales.at(-1), sales.sales.at(-1))
  })

  test('volume is ~60k rows (±15%)', () => {
    assert.ok(sales.sales.length >= 51_000 && sales.sales.length <= 69_000, String(sales.sales.length))
  })

  test('rows match the DDL column count', () => {
    for (const r of sales.sales.slice(0, 50)) assert.equal(r.length, S.length)
    for (const r of sales.customers) assert.equal(r.length, columnNames(M_CUSTOMER).length)
    for (const r of sales.items) assert.equal(r.length, columnNames(M_ITEM_REPOSITORY).length)
  })

  test('cancelled share is 3–8% in every month, and some rows carry both markers', () => {
    const perMonth = new Map<string, { n: number; c: number }>()
    let both = 0
    for (const r of sales.sales) {
      const m = ymd(r[col('date_received')]).slice(0, 7)
      const e = perMonth.get(m) ?? { n: 0, c: 0 }
      const a = r[col('transfer_test_deleted_at')] !== null
      const b = r[col('transaction_transfer_deleted_at')] !== null
      e.n++
      if (a || b) e.c++
      if (a && b) both++
      perMonth.set(m, e)
    }
    for (const [m, e] of perMonth) {
      if (e.n < 300) continue // the partial last month can be small
      const share = e.c / e.n
      assert.ok(share >= 0.03 && share <= 0.08, `${m}: ${share.toFixed(3)}`)
    }
    assert.ok(both >= 5, `both markers: ${both}`)
  })

  test('master tables contain duplicate codes (the no-direct-JOIN rule has a reason)', () => {
    const dup = (rows: unknown[][], idx: number): number => {
      const seen = new Map<unknown, number>()
      for (const r of rows) seen.set(r[idx], (seen.get(r[idx]) ?? 0) + 1)
      return [...seen.values()].filter((n) => n > 1).length
    }
    assert.ok(dup(sales.customers, columnNames(M_CUSTOMER).indexOf('customer_code_lis')) >= 3)
    assert.ok(dup(sales.items, columnNames(M_ITEM_REPOSITORY).indexOf('item_code_erp')) >= 3)
  })

  test('nothing happens after `until`; month/year follow the sales date', () => {
    const untilDay = UNTIL.toISOString().slice(0, 10)
    for (const r of sales.sales) {
      assert.ok(ymd(r[col('date_received')]) <= untilDay)
      const basis = ymd(r[col('date_result')] ?? r[col('date_received')])
      assert.equal(r[col('year')], Number(basis.slice(0, 4)))
      assert.equal(r[col('month')], Number(basis.slice(5, 7)))
      assert.ok((r[col('created_at')] as Date).getTime() <= UNTIL.getTime())
    }
  })

  test('backlog exists and bridging starts at ERP_BRIDGING_START', () => {
    assert.ok(sales.sales.some((r) => r[col('date_result')] === null))
    for (const r of sales.sales) {
      if (ymd(r[col('date_received')]) < '2025-12-01') assert.equal(r[col('bridging_status_to')], null)
    }
    const statuses = new Set(sales.sales.map((r) => r[col('bridging_status_to')]))
    for (const s of ['SUCCESS', 'FAILED']) assert.ok(statuses.has(s), s)
  })

  test('results are never dated on a Sunday (the lab does not release on Sundays)', () => {
    for (const r of sales.sales) {
      const d = r[col('date_result')]
      if (d) assert.notEqual(new Date(`${d}T00:00:00`).getDay(), 0, String(d))
    }
  })

  test('lines that never got a result are recent (≤ 120 days), not a year-old pile', () => {
    const limit = new Date(UNTIL.getTime() - 120 * 86_400_000).toISOString().slice(0, 10)
    const pending = sales.sales.filter((r) => r[col('date_result')] === null)
    assert.ok(pending.length > 0)
    for (const r of pending) assert.ok(ymd(r[col('date_received')]) >= limit, ymd(r[col('date_received')]))
  })

  test('there is a Pasien Pribadi customer and Order IDs come in several formats', () => {
    const t = columnNames(M_CUSTOMER).indexOf('customer_type')
    assert.ok(sales.customers.some((r) => r[t] === 'PR'))
    const ids = sales.orderIdOrders.map((o) => o.orderIdId)
    assert.ok(ids.some((id) => /^\d{9,12}$/.test(id)))
    assert.ok(ids.some((id) => /^[A-Z]+\d+$/.test(id)))
    assert.ok(ids.some((id) => /\.05\.$/.test(id)))
  })
})

describe('generateTracker: lab-stage quirks the guards were built for', () => {
  const T = columnNames(SAMPLE_TRACKER)
  const t = (name: string): number => T.indexOf(name)

  test('rows match the DDL', () => {
    for (const r of tracker.slice(0, 50)) assert.equal(r.length, T.length)
    assert.ok(tracker.length >= 20_000 && tracker.length <= 45_000, String(tracker.length))
  })

  test('order_validated_at is always midnight', () => {
    for (const r of tracker) {
      const v = r[t('order_validated_at')] as Date | null
      if (v) assert.equal(v.getHours() * 60 + v.getMinutes(), 0)
    }
  })

  test('PK and MB never have a lab-received time', () => {
    for (const r of tracker) {
      if (r[t('category')] === 'PK' || r[t('category')] === 'MB') assert.equal(r[t('lab_sample_received_at')], null)
    }
  })

  test('Genme samples get a result date like every other category (no year-old phantom backlog)', () => {
    assert.ok(tracker.some((r) => r[t('category')] === 'Genme' && r[t('date_result')] !== null))
  })

  test('every tracked Order ID exists in sales orders', () => {
    const ids = new Set(sales.orderIdOrders.map((o) => o.orderIdId))
    for (const r of tracker) assert.ok(ids.has(r[t('order_id')] as string))
  })
})

describe('generateInno: master data shape', () => {
  test('every inno table is generated with DDL-sized rows', () => {
    for (const def of TABLES_INNO) {
      const key = def.name.replace('inno.', '') as keyof typeof inno
      assert.ok(inno[key]?.length > 0, def.name)
      for (const r of inno[key].slice(0, 20)) assert.equal(r.length, def.columns.length, def.name)
    }
  })

  test('price category 5 has no master row; some items have price_group_code 0', () => {
    assert.ok(!inno.m_price_category.some((r) => r[0] === '5'))
    const pg = columnNames(TABLES_INNO.find((d) => d.name === 'inno.m_item')!).indexOf('price_group_code')
    assert.ok(inno.m_item.filter((r) => r[pg] === '0').length >= 20)
  })
})

describe('no PII-shaped values anywhere', () => {
  test('no 16-digit (NIK-shaped) values', () => {
    const all = [sales.sales, sales.customers, tracker, ...Object.values(inno)]
    for (const rows of all) for (const r of rows) for (const v of r) assert.doesNotMatch(String(v), /^\d{16}$/)
  })
})

describe('seed history does not depend on --until', () => {
  const A = new Date('2026-10-01T23:59:00')
  const B = new Date('2026-10-20T23:59:00')
  const sa = generateSales(makeRng(20261102), FROM, A)
  const sb = generateSales(makeRng(20261102), FROM, B)
  const before = (rows: unknown[][], idx: number): unknown[][] => rows.filter((r) => ymd(r[idx]) < '2026-08-25')

  test('sales rows older than 5 weeks before the earlier --until are identical for two different --until dates', () => {
    const ra = before(sa.sales, col('date_received'))
    const rb = before(sb.sales, col('date_received'))
    assert.equal(ra.length, rb.length)
    assert.deepEqual(ra, rb)
  })

  test('tracker rows older than 5 weeks before the earlier --until are identical too', () => {
    const T = columnNames(SAMPLE_TRACKER)
    const ta = generateTracker(makeRng(20261103), sa.orderIdOrders, A)
    const tb = generateTracker(makeRng(20261103), sb.orderIdOrders, B)
    const old = (rows: unknown[][]): string[] =>
      rows.filter((r) => ymd(r[T.indexOf('order_created_at')] instanceof Date ? (r[T.indexOf('order_created_at')] as Date).toISOString() : r[T.indexOf('order_created_at')]) < '2026-08-25').map((r) => String(r[0]))
    assert.deepEqual(old(ta), old(tb))
  })
})

describe('resolveUntil: same --until, same data', () => {
  test('a past date means the end of that day', () => {
    assert.equal(resolveUntil('2026-10-01', new Date('2026-11-02T10:17:00')).getTime(), new Date('2026-10-01T23:59:00').getTime())
  })

  test('today (or no argument) clamps to the start of the current hour — two runs in one hour match', () => {
    const a = resolveUntil('2026-11-02', new Date('2026-11-02T10:05:00'))
    const b = resolveUntil(undefined, new Date('2026-11-02T10:55:00'))
    assert.equal(a.getTime(), new Date('2026-11-02T10:00:00').getTime())
    assert.equal(a.getTime(), b.getTime())
  })

  test('a bad value is refused', () => {
    assert.throws(() => resolveUntil('02-11-2026', new Date()), /YYYY-MM-DD/)
  })
})
