import type { JSX } from 'react'
import { RECOUNT_STATUS_LABEL, type RecountItem, type RecountRow, type RecountStatus } from '../../../../shared/reagent'
import { fmtNum } from './bantu'

// Presentational "Voice recount" tab (no hooks, no IPC). The transcript is editable and every row can be fixed;
// nothing is sent or saved from here (rule 50: speech must stay correctable).

export interface RecountState {
  transcript: string
  rows: RecountRow[]
  notCounted: RecountItem[]
  recording: boolean
  transcribing: boolean
  error: string | null
}

export type RowPatch = Partial<Pick<RecountRow, 'itemCode' | 'count' | 'unit'>>

export interface RecountPanelProps {
  state: RecountState
  items: RecountItem[]
  onTranscript: (t: string) => void
  onRecord: () => void
  onReadCounts: () => void
  onEditRow: (id: string, patch: RowPatch) => void
  onRemoveRow: (id: string) => void
}

const STATUS_CLASS: Record<RecountStatus, string> = {
  matches: 'rg-hijau',
  differs: 'rg-merah',
  unclear: 'rg-oranye',
  said_twice: 'rg-oranye',
  not_recognized: 'rg-abu',
  not_comparable: 'rg-ungu'
}

export default function RecountPanel(p: RecountPanelProps): JSX.Element {
  const s = p.state
  const count = (st: RecountStatus[]): number => s.rows.filter((r) => st.includes(r.status)).length
  const byCode = new Map(p.items.map((i) => [i.itemCode, i]))
  return (
    <section className="rg-aksi">
      <h2>Recount by voice</h2>
      <p className="rg-catatan">
        Count the shelf out loud — for example "EGFR mutation kit, two boxes." Each recording is up to 60 seconds and is
        transcribed by Muse Voice Transcribe. Check the text, then press Read counts. Nothing is saved until you export.
      </p>
      <div className="rg-alat">
        <button type="button" className="rg-jalan" onClick={p.onRecord} disabled={s.transcribing}>
          {s.transcribing ? 'Transcribing…' : s.recording ? '■ Stop recording' : '● Record'}
        </button>
        <button type="button" className="rg-tanya" onClick={p.onReadCounts} disabled={!s.transcript.trim() || s.recording || s.transcribing}>
          Read counts
        </button>
      </div>
      {s.error && <div className="rg-galat">{s.error}</div>}
      <textarea
        className="rg-transkrip"
        value={s.transcript}
        onChange={(e) => p.onTranscript(e.target.value)}
        placeholder="The transcript appears here — you can also type or paste the count."
        rows={4}
      />

      {s.rows.length > 0 && (
        <>
          <section className="rg-kartu">
            <div className={count(['matches']) ? 'rg-hijau' : ''}>
              <span>Matches</span>
              <strong>{count(['matches'])}</strong>
            </div>
            <div className={count(['differs']) ? 'rg-merah' : ''}>
              <span>Differs</span>
              <strong>{count(['differs'])}</strong>
            </div>
            <div className={count(['unclear', 'said_twice', 'not_recognized', 'not_comparable']) ? 'rg-oranye' : ''}>
              <span>Needs a look</span>
              <strong>{count(['unclear', 'said_twice', 'not_recognized', 'not_comparable'])}</strong>
            </div>
          </section>
          <table className="rg-tabel">
            <thead>
              <tr>
                <th>Heard</th>
                <th>Item</th>
                <th className="kanan">Count</th>
                <th>Unit</th>
                <th className="kanan">Voice</th>
                <th className="kanan">File</th>
                <th className="kanan">Difference</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r) => {
                const it = r.itemCode ? byCode.get(r.itemCode) : undefined
                return (
                  <tr key={r.id}>
                    <td className="rg-redup">“{r.phrase}”</td>
                    <td>
                      <select value={r.itemCode ?? ''} onChange={(e) => p.onEditRow(r.id, { itemCode: e.target.value || null })} aria-label="Item">
                        <option value="">—</option>
                        {(r.candidates.length > 1 ? p.items.filter((i) => r.candidates.includes(i.itemCode)) : p.items).map((i) => (
                          <option key={i.itemCode} value={i.itemCode}>
                            {i.itemCode} — {i.itemName}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="kanan">
                      <input
                        type="number"
                        value={r.count ?? ''}
                        onChange={(e) => p.onEditRow(r.id, { count: e.target.value === '' ? null : Number(e.target.value) })}
                        aria-label="Count"
                      />
                    </td>
                    <td>
                      {it ? (
                        <select value={r.unit ?? ''} onChange={(e) => p.onEditRow(r.id, { unit: e.target.value || null })} aria-label="Unit">
                          <option value="">—</option>
                          {[...new Set([it.packUnit, it.baseUnit])].map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="rg-redup">{r.heardUnit ?? '—'}</span>
                      )}
                      {r.unitAssumed && <div className="rg-redup">unit assumed</div>}
                    </td>
                    <td className="kanan">{fmtNum(r.voiceBase)}</td>
                    <td className="kanan">{fmtNum(r.fileBase)}</td>
                    <td className="kanan">
                      {r.diffBase !== null && it ? (
                        <>
                          {fmtNum(r.diffBase)} {it.baseUnit}
                          {r.diffPacks !== null && (
                            <div className="rg-redup">
                              {fmtNum(r.diffPacks)} {it.packUnit}
                            </div>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <span className={`rg-lencana ${STATUS_CLASS[r.status]}`}>{RECOUNT_STATUS_LABEL[r.status]}</span>
                      {r.reason && <div className="rg-redup">{r.reason}</div>}
                    </td>
                    <td>
                      <button type="button" className="rg-bukti" onClick={() => p.onRemoveRow(r.id)} aria-label="Remove row">
                        ×
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {count(['differs']) > 0 && (
            <p className="rg-catatan">Rows that differ are added to the investigation list in the Excel export (Reorder &amp; actions tab).</p>
          )}
          {s.notCounted.length > 0 && (
            <p className="rg-redup">
              Not counted by voice ({s.notCounted.length}): {s.notCounted.map((i) => i.itemCode).join(', ')} — a partial
              recount is fine.
            </p>
          )}
        </>
      )}
    </section>
  )
}
