// Hackathon copy: Master Data SQL was written for MariaDB (`?` placeholders) and now runs on Postgres.
// Converting placeholders in one place keeps every query string unchanged.
// Only for Master Data SQL: it knows single-quoted literals, not comments, "identifiers" or dollar-quoted blocks.
import { types as pgTypes } from 'pg'

/** DATE, TIMESTAMP, TIMESTAMPTZ — returned as text, like mysql2's `dateStrings: true`. */
const DATE_OIDS = new Set([1082, 1114, 1184])
const NUMERIC_OID = 1700

/**
 * Type parsers for the Master Data pool ONLY (passed as the pool's `types`, never set process-wide).
 * The validity rules slice dates as 'YYYY-MM-DD' strings; pg's default Date objects made every price
 * look "not started yet". NUMERIC becomes a number so prices sum instead of concatenating.
 */
export const INNO_PG_TYPES = {
  getTypeParser(oid: number, format?: 'text' | 'binary'): (value: string) => unknown {
    if (DATE_OIDS.has(oid)) return (value: string) => value
    if (oid === NUMERIC_OID) return (value: string) => parseFloat(value)
    return pgTypes.getTypeParser(oid, format as 'text')
  }
}

/** Replaces each `?` outside single-quoted literals with `$1..$n`, in order. */
export function toPgPlaceholders(sql: string): string {
  let out = ''
  let n = 0
  let inString = false
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    if (ch === "'") {
      // '' inside a literal is an escaped quote: stays in the literal.
      if (inString && sql[i + 1] === "'") {
        out += "''"
        i++
        continue
      }
      inString = !inString
      out += ch
    } else if (ch === '?' && !inString) {
      out += `$${++n}`
    } else {
      out += ch
    }
  }
  return out
}
