// Excel export of the reagent actions (reorder list, investigation checklist, voice recount). The workbook is
// built from the values the screen shows — nothing is recomputed differently here — and written to the path the
// user picks in a main-process save dialog. The lab's own Excel files are never touched.
import ExcelJS from 'exceljs'
import { buildInvestigation } from './investigation'
import { compareRecount } from '../../shared/recount'
import {
  RECOUNT_STATUS_LABEL,
  REORDER_STATUS_LABEL,
  type ReagentActions,
  type RecountDiffer,
  type RecountRow,
  type SourceRef
} from '../../shared/reagent'

const src = (refs: SourceRef[]): string => refs.map((r) => `${r.file} › ${r.sheet} › row ${r.row}`).join('; ')

function sheet(wb: ExcelJS.Workbook, name: string, header: string[], rows: (string | number | null)[][]): void {
  const ws = wb.addWorksheet(name)
  ws.addRow(header).font = { bold: true }
  for (const r of rows) ws.addRow(r)
  ws.columns.forEach((c, i) => {
    c.width = Math.min(60, Math.max(10, header[i].length + 2, ...rows.map((r) => String(r[i] ?? '').length + 2)))
  })
  ws.views = [{ state: 'frozen', ySplit: 1 }]
}

export async function buildActionsWorkbook(a: ReagentActions, recountRows: RecountRow[]): Promise<Buffer> {
  // Recount rows must belong to THIS month's stock count — rows read against another folder or month are refused.
  const items = new Map(a.recount.map((i) => [i.itemCode, i]))
  for (const r of recountRows) {
    if (r.itemCode && !items.has(r.itemCode)) {
      throw new Error(`Recount row for ${r.itemCode} is not in the ${a.month} stock count — read the counts again before exporting.`)
    }
  }
  // Every number in the file is computed here: the reviewed rows are compared again with this month's stock count
  // (the renderer's voice/file/difference values are never written as given).
  const rows = compareRecount(recountRows, a.recount).rows
  const wb = new ExcelJS.Workbook()
  sheet(
    wb,
    'Reorder',
    ['Status', 'Item Code', 'Item Name', 'Closing (base)', 'Base Unit', 'Daily Use', 'Lead (days)', 'Safety (days)', 'Reorder Point', 'Target', 'Order (packs)', 'Pack Unit', 'Order (base)', 'Sheet-factor order (packs)', 'Reaches reorder point', 'Source'],
    [
      ...a.reorder.map((l) => [
        REORDER_STATUS_LABEL[l.status], l.itemCode, l.itemName, l.closing, l.baseUnit, l.dailyUse,
        l.leadDefault ? `${l.leadDays} (default)` : l.leadDays, l.safetyDefault ? `${l.safetyDays} (default)` : l.safetyDays,
        l.reorderPoint, l.target, l.orderPacks, l.packUnit, l.orderBase, l.sheetOrderPacks, l.reachesReorderPointOn, src(l.evidence)
      ]),
      ...a.excluded.map((e) => ['Not computed', e.itemCode, e.itemName, null, null, null, null, null, null, null, null, null, null, null, null, e.reason])
    ]
  )
  const differs: RecountDiffer[] = rows
    .filter((r) => r.status === 'differs' && r.itemCode && r.diffBase !== null)
    .map((r) => {
      const it = items.get(r.itemCode as string)!
      return { itemCode: it.itemCode, itemName: it.itemName, diffBase: r.diffBase as number, diffPacks: r.diffPacks, unit: it.baseUnit, refs: r.refs }
    })
  const investigation = [...a.investigation, ...buildInvestigation([], differs)]
  sheet(
    wb,
    'Investigation',
    ['Kind', 'Item Code', 'Item Name', 'Issue', 'Step', 'Role', 'Evidence'],
    investigation.flatMap((i) => i.steps.map((s) => [i.kind, i.itemCode, i.itemName, i.headline, s.text, s.role, src(i.evidence)]))
  )
  sheet(
    wb,
    'Recount',
    ['Phrase', 'Item Code', 'Count', 'Unit', 'Voice (base)', 'File (base)', 'Difference (base)', 'Difference (packs)', 'Status', 'Reason', 'Source'],
    rows.map((r) => [
      r.phrase, r.itemCode, r.count, r.unit ? r.unit + (r.unitAssumed ? ' (assumed)' : '') : null, r.voiceBase, r.fileBase,
      r.diffBase, r.diffPacks, RECOUNT_STATUS_LABEL[r.status], r.reason ?? null, src(r.refs)
    ])
  )
  return Buffer.from(await wb.xlsx.writeBuffer())
}
