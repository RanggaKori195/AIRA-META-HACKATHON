// Synthetic t_sample_tracker (behind view v_sample_tracker): one row per test of each order.
// Reproduces the quirks the lab tools were built around (see the project notes rule 34).
import type { Rng } from './prng'
import { SOURCES, type OrderIdOrder } from './sales'

/** The tracker ETL "starts" in late 2025, like a real one would. */
export const TRACKER_START = '2025-11-01'

const CATEGORY_OF = new Map(SOURCES.map(([source, category]) => [source, category]))
/** Categories that never record when the lab received the sample. */
const NO_RECEIVED = new Set(['PK', 'MB'])
/** Categories that sometimes pass through a pathologist stage. */
const PATHOLOGY_SHARE: Record<string, number> = { PA: 0.4, IHC: 0.2, MOL: 0.17 }
/** RNS (sample re-request) share by category. */
const RNS_SHARE: Record<string, number> = { PA: 0.02, IHC: 0.03, MOL: 0.06, 'HPV DNA': 0.015, LBC: 0.025, PK: 0.01, MB: 0.02, Genme: 0.04 }

function plusHours(d: Date, h: number): Date {
  return new Date(d.getTime() + h * 3600_000)
}

function midnight(d: Date): Date {
  const m = new Date(d)
  m.setHours(0, 0, 0, 0)
  return m
}

export function generateTracker(rng: Rng, orders: readonly OrderIdOrder[], until: Date): unknown[][] {
  const rows: unknown[][] = []
  const etl = new Date(until)
  etl.setHours(2, 25, 0, 0)
  if (etl.getTime() > until.getTime()) etl.setDate(etl.getDate() - 1)
  const untilMs = until.getTime()
  const upTo = (d: Date | null): Date | null => (d && d.getTime() <= untilMs ? d : null)

  for (const order of orders) {
    if (order.dateReceived < TRACKER_START) continue
    order.tests.forEach((t, idx) => {
      const category = CATEGORY_OF.get(t.source) ?? 'PK'
      // Every random draw happens unconditionally, so tracker history does not depend on --until.
      const r = {
        createdH: rng.int(7, 17), createdM: rng.int(0, 59), sameDay: rng.next(), recvH: rng.int(9, 40),
        prepH: rng.int(1, 8), prepDurH: rng.int(2, 30), path: rng.next(), pathH: rng.int(4, 48),
        resH: rng.int(10, 18), resM: rng.int(0, 59), resBackH: rng.int(1, 6), rns: rng.next(),
        rnsH: rng.int(4, 30), newH: rng.int(24, 96), cancelH: rng.int(2, 48), late: rng.next()
      }
      const created = new Date(`${order.dateReceived}T00:00:00`)
      created.setHours(r.createdH, r.createdM)
      if (created.getTime() > untilMs) return
      // Rule 34a: validation is recorded as a DATE only — always midnight.
      const validated = upTo(midnight(plusHours(created, r.sameDay < 0.8 ? 0 : 24)))
      const received = NO_RECEIVED.has(category) ? null : upTo(validated && plusHours(validated, r.recvH))
      const anchor = received ?? validated ?? created
      const prepStart = upTo(plusHours(anchor, r.prepH))
      const prepDone = upTo(prepStart && plusHours(prepStart, r.prepDurH))
      const pathology = upTo(prepDone && r.path < (PATHOLOGY_SHARE[category] ?? 0) ? plusHours(prepDone, r.pathH) : null)
      let dateResult: string | null = t.dateResult
      let resultValidated: Date | null = null
      let resultCreated: Date | null = null
      if (t.dateResult) {
        resultValidated = upTo(new Date(`${t.dateResult}T00:00:00`))
        if (resultValidated) resultValidated.setHours(r.resH, r.resM)
        resultValidated = upTo(resultValidated)
        resultCreated = resultValidated && plusHours(resultValidated, -r.resBackH)
      }
      const rnsAt = r.rns < (RNS_SHARE[category] ?? 0.02) ? upTo(plusHours(anchor, r.rnsH)) : null
      // is_rns and rns_at must agree (lab-live-check #10): a decision after `until` has not happened yet.
      const rns = rnsAt !== null
      const newSample = rnsAt ? upTo(plusHours(rnsAt, r.newH)) : null
      const canceledAt = order.cancelled ? upTo(plusHours(created, r.cancelH)) : null

      // Late samples: a few recent, lab-received samples are still open — they age past their p90.
      const ageDays = (untilMs - anchor.getTime()) / 86_400_000
      if (received && !canceledAt && ageDays > 6 && ageDays < 25 && (category === 'PA' || category === 'MOL') && r.late < 0.06) {
        dateResult = null
        resultValidated = null
        resultCreated = null
      }

      const status = canceledAt
        ? 'Canceled'
        : resultValidated
          ? 'Result Validated'
          : resultCreated
            ? 'Result Created'
            : prepDone
              ? 'Preparation Completed'
              : prepStart
                ? 'In Preparation'
                : received
                  ? 'Sample Received'
                  : validated
                    ? 'Order Validated by IP'
                    : 'Order Created'

      rows.push([
        `${order.orderIdId}-${t.itemCode}-${idx + 1}`,
        order.orderIdId,
        category,
        order.customerName,
        order.payerName,
        order.priceType,
        t.itemCode,
        t.test,
        1,
        rns,
        status,
        'LIS',
        created,
        validated,
        received,
        rnsAt,
        newSample,
        prepStart,
        prepDone,
        pathology,
        resultCreated,
        resultValidated,
        dateResult,
        canceledAt,
        null,
        etl,
        status,
        etl
      ])
    })
  }
  return rows
}
