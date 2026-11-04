import type { JSX } from 'react'
import { REORDER_STATUS_LABEL, type ReagentActionsResult, type ReorderStatus, type SourceRef } from '../../../../shared/reagent'
import { fmtNum } from './bantu'
import type { NumberCheck } from '../../../../shared/number-check'
import { NumberMarks, numberCheckLine } from '../NumberMarks'

// Presentational "Reorder & actions" tab (no hooks, no IPC). Every number comes from the reorder engine via IPC;
// the only model text is the optional summary, which is labelled as a draft.

export interface SummaryState {
  text?: string
  /** Every number in `text` looked up in the facts the model was given. */
  check?: NumberCheck
  error?: string
  loading: boolean
}

export interface ReorderPanelProps {
  actions: ReagentActionsResult | null
  summary: SummaryState | null
  exportNote: string | null
  onSummary: () => void
  onExport: () => void
}

const STATUS_CLASS: Record<ReorderStatus, string> = { order_now: 'rg-merah', order_soon: 'rg-oranye', ok: 'rg-hijau', no_use: 'rg-abu' }
const refs = (r: SourceRef[]): string => r.map((e) => `${e.file} › ${e.sheet} › row ${e.row}`).join('; ')
const days = (n: number, isDefault: boolean): string => `${n} days${isDefault ? ' (default)' : ''}`

export default function ReorderPanel(p: ReorderPanelProps): JSX.Element {
  if (!p.actions) return <div className="rg-redup">Building the reorder list…</div>
  if ('error' in p.actions) return <div className="rg-galat">{p.actions.error}</div>
  const a = p.actions
  return (
    <section className="rg-aksi">
      <div className="rg-aksi-kepala">
        <div>
          <h2>What to order</h2>
          <p className="rg-catatan">
            From the {a.month} physical count: daily use = consumption ÷ days in the month; order up to lead time + safety
            stock + a 30-day cycle, rounded up to whole packs. Lead time 14 days and safety stock 7 days are used where the
            Item List leaves them blank (marked "default").
          </p>
        </div>
        <div className="rg-aksi-tombol">
          <button type="button" className="rg-tanya" onClick={p.onSummary} disabled={p.summary?.loading}>
            Draft summary
          </button>
          <button type="button" className="rg-jalan" onClick={p.onExport}>
            Export to Excel
          </button>
        </div>
      </div>
      {p.exportNote && <div className="rg-catatan">{p.exportNote}</div>}
      {p.summary && (
        <div className="rg-ringkas">
          <span className="rg-label-ai">AI draft — check before sharing</span>
          {p.summary.loading && <p className="rg-redup">Writing a draft…</p>}
          {p.summary.error && <p className="rg-galat">{p.summary.error}</p>}
          {p.summary.text && !p.summary.check && <p>{p.summary.text}</p>}
          {p.summary.text && p.summary.check && (
            <>
              <p>
                <NumberMarks text={p.summary.text} check={p.summary.check} />
              </p>
              <p className={p.summary.check.unmatched ? 'num-line num-line-warn' : 'num-line'}>
                Number check: {numberCheckLine(p.summary.check, 'reagent data')}
              </p>
            </>
          )}
        </div>
      )}

      <table className="rg-tabel">
        <thead>
          <tr>
            <th>Status</th>
            <th>Item</th>
            <th className="kanan">In stock</th>
            <th className="kanan">Daily use</th>
            <th>Lead / safety</th>
            <th className="kanan">Order</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {a.reorder.length === 0 && (
            <tr>
              <td colSpan={7}>No item could be evaluated this month.</td>
            </tr>
          )}
          {a.reorder.map((l) => (
            <tr key={l.itemCode}>
              <td>
                <span className={`rg-lencana ${STATUS_CLASS[l.status]}`}>{REORDER_STATUS_LABEL[l.status]}</span>
              </td>
              <td>
                <strong>{l.itemCode}</strong>
                <div className="rg-redup">{l.itemName}</div>
              </td>
              <td className="kanan">
                {fmtNum(l.closing)} {l.baseUnit}
              </td>
              <td className="kanan">{fmtNum(l.dailyUse)}</td>
              <td>
                {days(l.leadDays, l.leadDefault)} / {days(l.safetyDays, l.safetyDefault)}
              </td>
              <td className="kanan">
                <strong>
                  {l.orderPacks} {l.packUnit}
                </strong>
              </td>
              <td>
                {l.sheetOrderPacks !== null && (
                  <div className="rg-hemat">
                    Sheet factor would order {l.sheetOrderPacks} {l.packUnit} — {l.sheetOrderPacks - l.orderPacks} {l.packUnit} more
                  </div>
                )}
                {l.reachesReorderPointOn && <div className="rg-redup">Reaches the reorder point on {l.reachesReorderPointOn}</div>}
                <div className="rg-redup">{refs(l.evidence)}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {a.excluded.length > 0 && (
        <section className="rg-belum">
          <h4>Not computed ({a.excluded.length}) — consumption cannot be trusted, so no order is suggested</h4>
          <ul>
            {a.excluded.map((e) => (
              <li key={`${e.itemCode}|${e.reason}`}>
                <strong>{e.itemCode}</strong> <span className="rg-redup">{e.itemName}</span> — {e.reason}
              </li>
            ))}
          </ul>
        </section>
      )}

      <h2>What to investigate</h2>
      {a.investigation.length === 0 && <p className="rg-redup">No findings this month.</p>}
      <div className="rg-investigasi">
        {a.investigation.map((i) => (
          <article key={i.id} className="rg-baris">
            <h4>{i.headline}</h4>
            <ol>
              {i.steps.map((s) => (
                <li key={s.text}>
                  {s.text} <span className="rg-redup">— {s.role}</span>
                </li>
              ))}
            </ol>
            <div className="rg-redup">{refs(i.evidence)}</div>
          </article>
        ))}
      </div>
    </section>
  )
}
