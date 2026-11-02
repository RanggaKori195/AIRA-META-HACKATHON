// Reads the reagent workbooks (exceljs). Every row keeps its origin {file, sheet, row} so a finding can always be
// traced back; rows that cannot be read are reported with a reason (never dropped silently) and blank rows are
// ignored. Columns are found by header name (aliases, any order, header within the first 10 rows).
import { basename } from 'path'
import ExcelJS from 'exceljs'
import { canonCode } from './normalize'
import type { ItemRow, OpnameRow, Skipped, SourceRef, UsageRow } from './types'

type Cell = string | number | null

interface FieldSpec {
  aliases: string[]
  kind: 'text' | 'number' | 'list'
  optional?: boolean
  /** A bad value does not drop the row: the field becomes null and the reason is reported in `skipped`. */
  soft?: boolean
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

const CODE: FieldSpec = { aliases: ['Item Code', 'Code', 'Kode Item', 'Kode'], kind: 'text' }
const NAME: FieldSpec = { aliases: ['Item Name', 'Name', 'Nama Item', 'Nama'], kind: 'text', optional: true }
const UNIT: FieldSpec = { aliases: ['Unit', 'Satuan', 'UoM'], kind: 'text' }

const USAGE = {
  week: { aliases: ['Week', 'Minggu'], kind: 'text' },
  code: CODE,
  name: NAME,
  tests: { aliases: ['Test Code', 'Test Code(s)', 'Kode Tes'], kind: 'list', optional: true },
  volume: { aliases: ['Test Volume', 'Volume', 'Jumlah Tes'], kind: 'number' },
  factor: { aliases: ['Factor per Test', 'Factor', 'Faktor'], kind: 'number' },
  estimated: { aliases: ['Estimated Usage', 'Estimasi Pemakaian'], kind: 'number', optional: true },
  // Optional: a blank or missing unit means the item's base unit (filled in once the Item List is read).
  unit: { ...UNIT, optional: true }
} satisfies Record<string, FieldSpec>

const ITEMS = {
  code: CODE,
  name: NAME,
  baseUnit: { aliases: ['Base Unit', 'Satuan Dasar'], kind: 'text' },
  packSize: { aliases: ['Pack Size', 'Isi per Kemasan'], kind: 'number' },
  packUnit: { aliases: ['Pack Unit', 'Satuan Kemasan'], kind: 'text' },
  tests: { aliases: ['Test Code(s)', 'Test Code', 'Kode Tes'], kind: 'list', optional: true },
  factor: { aliases: ['Standard Factor', 'Factor per Test', 'Faktor'], kind: 'number' },
  // Reorder inputs (optional; blank → the default stated on the screen).
  leadDays: { aliases: ['Lead Time (days)', 'Lead Time', 'Lead Days'], kind: 'number', optional: true, soft: true },
  safetyDays: { aliases: ['Safety Stock (days)', 'Safety Stock', 'Safety Days'], kind: 'number', optional: true, soft: true }
} satisfies Record<string, FieldSpec>

const OPNAME = {
  code: CODE,
  name: NAME,
  opening: { aliases: ['Opening Stock', 'Stok Awal'], kind: 'number' },
  received: { aliases: ['Received', 'Diterima', 'Penerimaan'], kind: 'number' },
  closing: { aliases: ['Closing Count', 'Physical Count', 'Stok Akhir'], kind: 'number' },
  unit: UNIT
} satisfies Record<string, FieldSpec>

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return v
  if (typeof v === 'string') return v
  if (typeof v === 'boolean') return String(v)
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    if ('result' in v) return cellValue((v as { result: ExcelJS.CellValue }).result)
    if ('richText' in v) return (v as { richText: Array<{ text: string }> }).richText.map((t) => t.text).join('')
    if ('text' in v) return String((v as { text: unknown }).text)
  }
  return String(v)
}

interface SheetData {
  name: string
  /** rows[i] = Excel row i+1, cells 0-based. */
  rows: Cell[][]
}

async function readSheets(path: string): Promise<SheetData[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path)
  return wb.worksheets.map((ws) => {
    const rows: Cell[][] = []
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      const cells: Cell[] = []
      for (let c = 1; c <= Math.max(row.cellCount, ws.columnCount); c++) cells.push(cellValue(row.getCell(c).value))
      rows.push(cells)
    }
    return { name: ws.name, rows }
  })
}

/** Index of the header row and the column of each field, or null. */
function findHeader<F extends Record<string, FieldSpec>>(rows: Cell[][], spec: F): { at: number; cols: Record<keyof F, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cells = rows[i].map((c) => (typeof c === 'string' ? norm(c) : ''))
    const cols = {} as Record<keyof F, number>
    let ok = true
    for (const [field, f] of Object.entries(spec)) {
      const idx = cells.findIndex((c) => c && f.aliases.some((a) => norm(a) === c))
      if (idx < 0 && !f.optional) {
        ok = false
        break
      }
      cols[field as keyof F] = idx
    }
    if (ok) return { at: i, cols }
  }
  return null
}

const blank = (r: Cell[]): boolean => r.every((c) => c === null || (typeof c === 'string' && c.trim() === ''))

/**
 * A cell as a number. Text is accepted only when its meaning is certain: a plain number, or a single decimal
 * separator ("1,5" / "0.25"). "1,200" and "1.200" could be 1.2 or 1200 → 'ambiguous' (the row is skipped with
 * that reason, never read as 1.2). Grouped text is read only when it cannot be anything else: both separators
 * ("1.200,5", "1,200.5") or the same separator repeated ("1.200.000").
 */
function toNumber(c: Cell): number | null | 'ambiguous' {
  if (typeof c === 'number') return Number.isFinite(c) ? c : null
  if (typeof c !== 'string' || c.trim() === '') return null
  const s = c.trim()
  const sign = /^[+-]/.test(s) ? s[0] : ''
  const body = sign ? s.slice(1) : s
  const num = (t: string): number | null => {
    const n = Number(sign + t)
    return Number.isFinite(n) ? n : null
  }
  if (/^\d+$/.test(body)) return num(body)
  // One group of three after a non-zero lead: thousands or decimal — cannot tell.
  if (/^[1-9]\d{0,2}[.,]\d{3}$/.test(body)) return 'ambiguous'
  if (/^\d*[.,]\d+$/.test(body)) return num(body.replace(',', '.'))
  // Same separator repeated → grouping only.
  if (/^[1-9]\d{0,2}(\.\d{3}){2,}$/.test(body)) return num(body.replace(/\./g, ''))
  if (/^[1-9]\d{0,2}(,\d{3}){2,}$/.test(body)) return num(body.replace(/,/g, ''))
  // Both separators → the last one is the decimal.
  if (/^[1-9]\d{0,2}(\.\d{3})+,\d+$/.test(body)) return num(body.replace(/\./g, '').replace(',', '.'))
  if (/^[1-9]\d{0,2}(,\d{3})+\.\d+$/.test(body)) return num(body.replace(/,/g, ''))
  if (/^[\d.,]+$/.test(body) && /\d/.test(body)) return 'ambiguous'
  return num(body)
}

/** Reads one data row by spec; returns the values or the reason it cannot be read. */
function readRow<F extends Record<string, FieldSpec>>(
  cells: Cell[],
  spec: F,
  cols: Record<keyof F, number>
): { values: Record<keyof F, unknown>; warnings: string[] } | { reason: string } {
  const values = {} as Record<keyof F, unknown>
  const warnings: string[] = []
  for (const [field, f] of Object.entries(spec) as Array<[keyof F, FieldSpec]>) {
    const idx = cols[field]
    const c = idx >= 0 ? cells[idx] ?? null : null
    if (f.kind === 'number') {
      const n = toNumber(c)
      if (f.soft && (n === 'ambiguous' || (n === null && c !== null && c !== ''))) {
        values[field] = null
        warnings.push(`"${f.aliases[0]}" is not a number (${JSON.stringify(c)}) — the default is used for this item`)
        continue
      }
      if (n === 'ambiguous') {
        return { reason: `ambiguous number ${JSON.stringify(c)} in "${f.aliases[0]}" — write it as a plain number` }
      }
      if (n === null) {
        if (f.optional && (c === null || c === '')) {
          values[field] = null
          continue
        }
        return { reason: `"${f.aliases[0]}" is not a number (${c === null ? 'empty' : JSON.stringify(c)})` }
      }
      values[field] = n
    } else if (f.kind === 'list') {
      values[field] = c === null ? [] : String(c).split(/[,;/]\s*/).map((s) => s.trim()).filter(Boolean)
    } else {
      const s = c === null ? '' : String(c).trim()
      if (!s && !f.optional) return { reason: field === 'code' ? 'missing item code' : `missing "${f.aliases[0]}"` }
      values[field] = s
    }
  }
  return { values, warnings }
}

function rowsOf<F extends Record<string, FieldSpec>>(
  sheet: SheetData,
  file: string,
  header: { at: number; cols: Record<keyof F, number> },
  spec: F,
  skipped: Skipped[]
): Array<{ v: Record<keyof F, unknown>; ref: SourceRef }> {
  const out: Array<{ v: Record<keyof F, unknown>; ref: SourceRef }> = []
  for (let i = header.at + 1; i < sheet.rows.length; i++) {
    const cells = sheet.rows[i]
    if (blank(cells)) continue
    const ref = { file, sheet: sheet.name, row: i + 1 }
    const r = readRow(cells, spec, header.cols)
    if ('reason' in r) skipped.push({ ref, reason: r.reason })
    else {
      for (const reason of r.warnings) skipped.push({ ref, reason })
      out.push({ v: r.values, ref })
    }
  }
  return out
}

export async function parseUsageWorkbook(path: string): Promise<{ usage: UsageRow[]; items: ItemRow[]; skipped: Skipped[] }> {
  const file = basename(path)
  const usage: UsageRow[] = []
  const items: ItemRow[] = []
  const skipped: Skipped[] = []
  for (const sheet of await readSheets(path)) {
    const hu = findHeader(sheet.rows, USAGE)
    if (hu) {
      for (const { v, ref } of rowsOf(sheet, file, hu, USAGE, skipped)) {
        usage.push({
          week: String(v.week),
          code: canonCode(String(v.code)),
          rawCode: String(v.code),
          name: String(v.name),
          tests: v.tests as string[],
          volume: v.volume as number,
          factor: v.factor as number,
          estimated: v.estimated as number | null,
          unit: String(v.unit),
          ref
        })
      }
      continue
    }
    const hi = findHeader(sheet.rows, ITEMS)
    if (hi) {
      for (const { v, ref } of rowsOf(sheet, file, hi, ITEMS, skipped)) {
        items.push({
          code: canonCode(String(v.code)),
          rawCode: String(v.code),
          name: String(v.name),
          baseUnit: String(v.baseUnit),
          packSize: v.packSize as number,
          packUnit: String(v.packUnit),
          tests: v.tests as string[],
          factor: v.factor as number,
          leadDays: (v.leadDays as number | null) ?? null,
          safetyDays: (v.safetyDays as number | null) ?? null,
          ref
        })
      }
      continue
    }
    skipped.push({ ref: { file, sheet: sheet.name, row: 1 }, reason: 'header not found (not a usage or item-list sheet)' })
  }
  // Blank usage unit → the item's base unit (the factor is per test in the row's unit).
  const baseUnit = new Map(items.map((i) => [i.code, i.baseUnit]))
  for (const u of usage) if (!u.unit.trim()) u.unit = baseUnit.get(u.code) ?? ''
  return { usage, items, skipped }
}

export async function parseOpnameWorkbook(path: string): Promise<{ opname: OpnameRow[]; skipped: Skipped[] }> {
  const file = basename(path)
  const opname: OpnameRow[] = []
  const skipped: Skipped[] = []
  for (const sheet of await readSheets(path)) {
    const h = findHeader(sheet.rows, OPNAME)
    if (!h) {
      skipped.push({ ref: { file, sheet: sheet.name, row: 1 }, reason: 'header not found (not a stock-opname sheet)' })
      continue
    }
    for (const { v, ref } of rowsOf(sheet, file, h, OPNAME, skipped)) {
      opname.push({
        code: canonCode(String(v.code)),
        rawCode: String(v.code),
        name: String(v.name),
        opening: v.opening as number,
        received: v.received as number,
        closing: v.closing as number,
        unit: String(v.unit),
        ref
      })
    }
  }
  return { opname, skipped }
}

/** The cells of one row keyed by its sheet's header names — the evidence shown to the user. */
export async function rowCells(path: string, sheetName: string, row: number): Promise<Record<string, Cell>> {
  const sheet = (await readSheets(path)).find((s) => s.name === sheetName)
  if (!sheet) throw new Error(`sheet "${sheetName}" not found in ${basename(path)}`)
  const header = findHeader(sheet.rows, USAGE) ?? findHeader(sheet.rows, ITEMS) ?? findHeader(sheet.rows, OPNAME)
  const names = header ? sheet.rows[header.at].map((c, i) => (c === null ? `Column ${i + 1}` : String(c))) : []
  const cells = sheet.rows[row - 1] ?? []
  return Object.fromEntries(cells.map((c, i) => [names[i] ?? `Column ${i + 1}`, c]))
}
