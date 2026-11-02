import type { JSX, ReactNode } from 'react'
import { FINDING_TYPES, type EvidenceRow, type Finding, type ReagentRunResult, type ReagentStatus } from '../../../../shared/reagent'
import { TYPE_CLASS, TYPE_LABEL, fmtCell, fmtNum, fmtRatio } from './bantu'

// Presentational Reagent Check screen (no hooks, no IPC) — rendered statically in tests/reagent-ui.test.ts.
// Every number on it comes from the reconciliation engine via IPC, the same engine the chat tools use.

export interface ReagentViewProps {
  status: ReagentStatus | null
  month: string | null
  result: ReagentRunResult | null
  running: boolean
  selected: string | null
  evidence: EvidenceRow[] | null
  /** Why the source rows could not be loaded — shown in the panel instead of an empty list. */
  evidenceError?: string | null
  text: string
  onChooseFolder: () => void
  onRun: () => void
  onMonth: (m: string) => void
  onSelect: (id: string | null) => void
  onAsk: (f: Finding) => void
  onText: (t: string) => void
  onSubmit: () => void
  /** Dictation button (needs IPC, so the container passes it in). */
  dictation?: ReactNode
}

export default function ReagentView(p: ReagentViewProps): JSX.Element {
  const ok = p.result && !('error' in p.result) ? p.result : null
  const selected = ok?.findings.find((f) => f.id === p.selected) ?? null
  return (
    <div className="rg">
      <header className="rg-kepala">
        <div>
          <h1>Reagent Check</h1>
          <p>
            Reconciles the weekly reagent usage sheet and the month-end stock count against the tests the lab ran.
            Every figure is computed by code; each finding links to the file and row it came from.
          </p>
        </div>
      </header>

      <section className="rg-alat">
        <button type="button" className="rg-folder" onClick={p.onChooseFolder} title="Change folder">
          📁 {p.status?.folder ?? 'No folder chosen'} <span>Change folder</span>
        </button>
        {p.status && p.status.months.length > 0 && (
          <select value={p.month ?? ''} onChange={(e) => p.onMonth(e.target.value)} aria-label="Month">
            {p.status.months.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="rg-jalan" onClick={p.onRun} disabled={!p.status?.folder || p.running}>
          {p.running ? 'Reconciling…' : 'Run reconciliation'}
        </button>
      </section>

      {!p.status?.folder && (
        <div className="rg-kosong">Choose the folder with the usage and stock-opname files (Reagent_Usage_YYYY-MM.xlsx and Stock_Opname_YYYY-MM.xlsx).</div>
      )}
      {p.result && 'error' in p.result && <div className="rg-galat">{p.result.error}</div>}

      {ok && (
        <>
          <section className="rg-kartu">
            <div>
              <span>Items checked</span>
              <strong>{ok.summary.itemsChecked}</strong>
            </div>
            {FINDING_TYPES.map((t) => (
              <div key={t} className={ok.summary.byType[t] > 0 ? TYPE_CLASS[t] : ''}>
                <span>{TYPE_LABEL[t]}</span>
                <strong>{ok.summary.byType[t]}</strong>
              </div>
            ))}
            <div className={ok.summary.notChecked.length > 0 ? 'rg-abu' : ''}>
              <span>Not checked</span>
              <strong>{ok.summary.notChecked.length}</strong>
            </div>
            <div>
              <span>Rows skipped</span>
              <strong>{ok.summary.skipped.length}</strong>
            </div>
          </section>
          <p className="rg-catatan">
            {ok.summary.month} · {ok.summary.filesRead.join(' + ')} · flagged when the estimate is ≥{' '}
            {ok.summary.thresholds.factorHigh}× the actual use or the actual use is ≥ {ok.summary.thresholds.usedFaster}× the estimate.
          </p>

          <div className="rg-isi">
            <table className="rg-tabel">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Item</th>
                  <th className="kanan">Estimated</th>
                  <th className="kanan">Actual</th>
                  <th className="kanan" title="Actual consumption divided by the estimate">
                    Actual ÷ est.
                  </th>
                  <th className="kanan">Implied factor</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {ok.findings.length === 0 && (
                  <tr>
                    <td colSpan={7}>No discrepancies found for this month.</td>
                  </tr>
                )}
                {ok.findings.map((f) => (
                  <tr key={f.id} className={f.id === p.selected ? 'aktif' : ''} onClick={() => p.onSelect(f.id)}>
                    <td>
                      <span className={`rg-lencana ${TYPE_CLASS[f.type]}`}>{TYPE_LABEL[f.type]}</span>
                    </td>
                    <td>
                      <strong>{f.itemCode}</strong>
                      <div className="rg-redup">{f.itemName}</div>
                    </td>
                    <td className="kanan">{fmtNum(f.estimated)}</td>
                    <td className="kanan">{fmtNum(f.actual)}</td>
                    <td className="kanan">{fmtRatio(f.ratio)}</td>
                    <td className="kanan">{fmtNum(f.impliedFactor)}</td>
                    <td>
                      <button type="button" className="rg-bukti" onClick={(e) => (e.stopPropagation(), p.onSelect(f.id))}>
                        Evidence
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {selected && (
              <aside className="rg-panel">
                <div className="rg-panel-kepala">
                  <span className={`rg-lencana ${TYPE_CLASS[selected.type]}`}>{TYPE_LABEL[selected.type]}</span>
                  <button type="button" onClick={() => p.onSelect(null)} aria-label="Close">
                    ×
                  </button>
                </div>
                <h3>
                  {selected.itemCode} — {selected.itemName}
                </h3>
                <p>{selected.explanation}</p>
                <h4>Source rows</h4>
                {p.evidenceError && <div className="rg-galat">{p.evidenceError}</div>}
                {(p.evidence ?? []).map((r) => (
                  <div key={`${r.ref.file}|${r.ref.sheet}|${r.ref.row}`} className="rg-baris">
                    <div className="rg-redup">
                      {r.ref.file} › {r.ref.sheet} › row {r.ref.row}
                    </div>
                    <table>
                      <tbody>
                        {Object.entries(r.cells)
                          .filter(([, v]) => v !== null && v !== '')
                          .map(([k, v]) => (
                            <tr key={k}>
                              <th>{k}</th>
                              <td>{fmtCell(v)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ))}
                {p.evidence === null && !p.evidenceError && <div className="rg-redup">Loading source rows…</div>}
                <button type="button" className="rg-tanya" onClick={() => p.onAsk(selected)}>
                  Ask AIRA about this
                </button>
              </aside>
            )}
          </div>

          {ok.summary.notChecked.length > 0 && (
            <section className="rg-belum">
              <h4>
                Not checked ({ok.summary.notChecked.length}) — these items have data but could not be evaluated, so they are
                not confirmed as fine
              </h4>
              <ul>
                {ok.summary.notChecked.map((n) => (
                  <li key={`${n.itemCode}|${n.reason}`}>
                    <strong>{n.itemCode}</strong> {n.itemName !== n.itemCode && <span className="rg-redup">{n.itemName}</span>}{' '}
                    — {n.reason}
                    <div className="rg-redup">
                      {n.evidence.map((e) => `${e.file} › ${e.sheet} › row ${e.row}`).join('; ')}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <form
        className="rg-kotak"
        onSubmit={(e) => {
          e.preventDefault()
          p.onSubmit()
        }}
      >
        <textarea
          value={p.text}
          onChange={(e) => p.onText(e.target.value)}
          placeholder="Ask about the findings, e.g. why is the DNA extraction kit flagged?"
          rows={2}
        />
        <div className="rg-kotak-aksi">
          {p.dictation}
          <button type="submit" disabled={!p.text.trim()}>
            Ask
          </button>
        </div>
      </form>
    </div>
  )
}
