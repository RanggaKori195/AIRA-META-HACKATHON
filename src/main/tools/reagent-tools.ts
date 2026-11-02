import { ToolError, type ToolDefinition } from './types'
import type { ReconcileResult } from '../reagent/service'
import type { SourceRef } from '../reagent/types'

// Reagent Check tools (group `reagent`). Numbers come from the reconciliation engine; the model only explains
// them. Built from injected dependencies so they are tested without a session or a database.

export interface ReagentDeps {
  /** The folder the signed-in user chose on the Reagent Check screen, or null. */
  folder: () => string | null | Promise<string | null>
  run: (folder: string, month?: string) => Promise<ReconcileResult | { error: string }>
  /** Rows behind one finding, re-read from the user's folder for that month (never from "the last run"). */
  evidence: (
    folder: string,
    findingId: string,
    month?: string
  ) => Promise<Array<{ ref: SourceRef; cells: Record<string, string | number | null> }>>
}

const MAX_SKIPPED_SHOWN = 20
const MAX_NOT_CHECKED_SHOWN = 30

const NO_FOLDER =
  'No reagent folder has been chosen yet. Tell the user to open the Reagent Check screen and choose the ' +
  'folder with the usage and stock-opname files (Change folder).'

/** Empty -> undefined (newest month); YYYY-MM -> itself; anything else is refused, never run on the wrong month. */
function monthArg(v: unknown): string | undefined {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return undefined
  const s = typeof v === 'string' ? v.trim() : String(v)
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) return s
  throw new ToolError(`month must be YYYY-MM, e.g. 2026-10 (got ${JSON.stringify(v)}). Leave it empty for the newest month.`)
}

async function folderOrThrow(deps: ReagentDeps): Promise<string> {
  const folder = await deps.folder()
  if (!folder) throw new ToolError(NO_FOLDER)
  return folder
}

export function makeReagentTools(deps: ReagentDeps): ToolDefinition[] {
  return [
    {
      name: 'reagent_reconcile',
      label: 'Reagent reconciliation',
      description:
        'Reconciles the weekly reagent usage sheet and the month-end stock count (files in the folder the user ' +
        'chose on the Reagent Check screen) against the number of tests the lab ran. Returns findings — wrong item ' +
        'code, per-test factor too high, used faster than estimated, unit mismatch, no physical count — each with ' +
        'its numbers, a code-built explanation and the evidence rows (file, sheet, row). Call it before talking ' +
        'about any finding.',
      parameters: {
        type: 'object',
        properties: {
          month: {
            type: 'string',
            description: 'Month as YYYY-MM. Only if the user names a month; otherwise leave empty for the newest month.'
          }
        }
      },
      tier: 'read',
      timeoutMs: 120_000,
      summarize: (a) => 'Reconciling reagents' + (typeof a.month === 'string' && a.month ? ' — ' + a.month : ''),
      execute: async (args) => {
        const month = monthArg(args.month)
        const folder = await folderOrThrow(deps)
        const r = await deps.run(folder, month)
        if ('error' in r) throw new ToolError(r.error)
        const { summary, findings } = r
        const skipped = summary.skipped.length
        const notChecked = summary.notChecked.length
        const complete = skipped === 0 && notChecked === 0
        return JSON.stringify({
          month: summary.month,
          filesRead: summary.filesRead,
          thresholds: summary.thresholds,
          summary: { itemsChecked: summary.itemsChecked, byType: summary.byType, skippedCount: skipped, notCheckedCount: notChecked },
          findings: findings.map((f) => ({
            id: f.id,
            type: f.type,
            itemCode: f.itemCode,
            itemName: f.itemName,
            estimated: f.estimated,
            actual: f.actual,
            ratio: f.ratio,
            impliedFactor: f.impliedFactor,
            unit: f.unit,
            explanation: f.explanation,
            evidence: f.evidence
          })),
          skipped: summary.skipped.slice(0, MAX_SKIPPED_SHOWN),
          notChecked: summary.notChecked.slice(0, MAX_NOT_CHECKED_SHOWN),
          completenessNote:
            `Read ${summary.filesRead.join(' and ')}${complete ? ' completely' : ''}; ${summary.itemsChecked} item${summary.itemsChecked === 1 ? '' : 's'} fully checked. ` +
            (skipped === 0
              ? 'No rows were skipped. '
              : `${skipped} row${skipped > 1 ? 's were' : ' was'} skipped because they could not be read — the reasons are listed in "skipped"${skipped > MAX_SKIPPED_SHOWN ? ` (first ${MAX_SKIPPED_SHOWN} shown)` : ''}; mention them. `) +
            (notChecked === 0
              ? 'Every item with data was checked. '
              : `${notChecked} item${notChecked > 1 ? 's' : ''} could not be checked — they are NOT confirmed as fine; the reason for each is listed in "notChecked"${notChecked > MAX_NOT_CHECKED_SHOWN ? ` (first ${MAX_NOT_CHECKED_SHOWN} shown)` : ''}; tell the user which items and why. `) +
            (complete
              ? 'Do not claim anything was cut or missing beyond this.'
              : 'Apart from what is listed in "skipped" and "notChecked", every row was read.')
        })
      }
    },
    {
      name: 'reagent_evidence',
      label: 'Reagent evidence rows',
      description:
        'Returns the source rows (file, sheet, row number and the cell values) behind ONE finding from ' +
        'reagent_reconcile. Use it when the user asks to see the rows or the original numbers.',
      parameters: {
        type: 'object',
        properties: {
          findingId: { type: 'string', description: 'The "id" of a finding from the reagent_reconcile result.' },
          month: {
            type: 'string',
            description: 'The "month" of that reagent_reconcile result, as YYYY-MM. Leave empty for the newest month.'
          }
        },
        required: ['findingId']
      },
      tier: 'read',
      timeoutMs: 60_000,
      summarize: (a) => 'Showing evidence rows' + (typeof a.findingId === 'string' ? ' — ' + a.findingId : ''),
      execute: async (args) => {
        const id = typeof args.findingId === 'string' ? args.findingId : ''
        const month = monthArg(args.month)
        const folder = await folderOrThrow(deps)
        try {
          return JSON.stringify({ findingId: id, rows: await deps.evidence(folder, id, month) })
        } catch (err) {
          throw new ToolError(err instanceof Error ? err.message : String(err))
        }
      }
    }
  ]
}

/** Real dependencies: session user's folder (both tools), service, evidence (loaded lazily — electron/config/database). */
export const reagentTools: ToolDefinition[] = makeReagentTools({
  // Dynamic import, not CommonJS: the main process is bundled, so a source path does not exist at runtime.
  folder: async () => {
    const auth = await import('../auth/service')
    const { reagentFolderFor } = await import('../reagent/folder')
    const user = auth.sesiSekarang()?.username
    return user ? reagentFolderFor(user) : null
  },
  run: async (folder, month) => (await import('../reagent/service')).runReconciliation({ folder, month }),
  evidence: async (folder, findingId, month) =>
    (await import('../reagent/service')).evidenceRows({ folder, month, findingId })
})
