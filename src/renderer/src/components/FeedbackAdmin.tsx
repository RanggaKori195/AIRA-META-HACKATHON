import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import {
  FEEDBACK_JENIS_LABELS,
  FEEDBACK_STATUS,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_DAMPAK_LABELS,
  type FeedbackDampak,
  type FeedbackJenis,
  type FeedbackRow,
  type FeedbackStatus
} from '@shared/ipc'

// Daftar masukan user — hanya tampil untuk Super Admin.
//
// ⚠️ Seperti UserAdmin: panel ini KENYAMANAN, bukan penguncian. Channel
// `feedbackDaftar` dan `feedbackSetStatus` memeriksa ulang role dari sesi di main
// process (`wajibSuperAdmin`). Menyembunyikan panel tidak menghalangi apa pun.
//
// ⚠️ Dimuat SAAT DIBUKA, bukan bersama panel Settings lainnya. Panel Settings
// pernah tampil KOSONG SELURUHNYA gara-gara ~8 query berangkat serentak dari main
// process Electron (19 Agu 2026) — pool auth memang menyerialkannya sekarang,
// tapi tidak ada gunanya menambah antrean untuk daftar yang belum tentu dibaca.

const KELAS_STATUS: Record<string, string> = {
  baru: 'tag tag-peringatan',
  dibaca: 'tag tag-netral',
  dikerjakan: 'tag tag-peringatan',
  selesai: 'tag tag-ok',
  ditolak: 'tag tag-gagal'
}

const waktuSingkat = (iso: string): string =>
  new Date(iso).toLocaleString('en-US', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })

type Saring = 'all' | 'unread' | FeedbackJenis

export default function FeedbackAdmin(): JSX.Element {
  const [buka, setBuka] = useState(false)
  const [rows, setRows] = useState<FeedbackRow[]>([])
  const [saring, setSaring] = useState<Saring>('all')
  const [rinci, setRinci] = useState<number | null>(null)
  const [catatan, setCatatan] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sudahMuat, setSudahMuat] = useState(false)

  const muat = useCallback(async () => {
    try {
      setRows(await window.aira.listFeedback(200))
      setError(null)
    } catch (err) {
      setError(bersihkanError(err))
    } finally {
      setSudahMuat(true)
    }
  }, [])

  useEffect(() => {
    if (buka && !sudahMuat) void muat()
  }, [buka, sudahMuat, muat])

  const belumDibaca = useMemo(() => rows.filter((r) => r.status === 'baru').length, [rows])

  const tampil = useMemo(() => {
    if (saring === 'all') return rows
    if (saring === 'unread') return rows.filter((r) => r.status === 'baru')
    return rows.filter((r) => r.jenis === saring)
  }, [rows, saring])

  const ubahStatus = async (id: number, status: FeedbackStatus): Promise<void> => {
    setBusy(true)
    try {
      setRows(
        await window.aira.setFeedbackStatus({
          id,
          status,
          catatan: catatan.trim().length > 0 ? catatan.trim() : null
        })
      )
      setCatatan('')
      setError(null)
    } catch (err) {
      setError(bersihkanError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h3>
          Feedback from users{' '}
          {sudahMuat && belumDibaca > 0 && <span className="tag tag-peringatan">{belumDibaca} new</span>}
        </h3>
        <button className="btn-teks" onClick={() => setBuka((v) => !v)}>
          {buka ? 'Close' : 'Open list'}
        </button>
      </div>

      {!buka && (
        <p className="hint">
          Bugs and suggestions that users sent through the Feedback screen or the Report button on
          AIRA's answers.
        </p>
      )}

      {buka && (
        <>
          <div className="fb-pilihan">
            {(['all', 'unread'] as const).map((s) => (
              <button
                key={s}
                className={`fb-pil ${saring === s ? 'aktif' : ''}`}
                onClick={() => setSaring(s)}
              >
                {s === 'all' ? 'All' : `Unread (${belumDibaca})`}
              </button>
            ))}
            {(Object.keys(FEEDBACK_JENIS_LABELS) as FeedbackJenis[]).map((j) => (
              <button
                key={j}
                className={`fb-pil ${saring === j ? 'aktif' : ''}`}
                onClick={() => setSaring(j)}
              >
                {FEEDBACK_JENIS_LABELS[j]}
              </button>
            ))}
          </div>

          {error && <div className="error">{error}</div>}
          {sudahMuat && tampil.length === 0 && <p className="hint">No feedback matches this filter.</p>}

          <div className="fb-daftar">
            {tampil.map((f) => (
              <div key={f.id} className={`fb-item ${f.status === 'baru' ? 'baru' : ''}`}>
                <div className="fb-item-head">
                  <span className={KELAS_STATUS[f.status] ?? 'tag tag-netral'}>
                    {FEEDBACK_STATUS_LABELS[f.status as FeedbackStatus] ?? f.status}
                  </span>
                  <strong>{f.username}</strong>
                  <span className="fb-meta">
                    {[f.role, f.divisi].filter(Boolean).join(' · ') || '—'}
                  </span>
                  <span className="fb-meta">{waktuSingkat(f.createdAt)}</span>
                  <span className="fb-meta">v{f.appVersion ?? '?'}</span>
                  {f.mode && <span className="fb-meta">{`mode ${f.mode}`}</span>}
                </div>

                <div className="fb-item-jenis">
                  {FEEDBACK_JENIS_LABELS[f.jenis as FeedbackJenis] ?? f.jenis}
                  {f.dampak && ` · ${FEEDBACK_DAMPAK_LABELS[f.dampak as FeedbackDampak] ?? f.dampak}`}
                </div>

                <div className="fb-item-isi">{f.isi}</div>

                {f.lampiranNama && (
                  <button
                    className="fb-lihat"
                    title="Save the attachment to this computer"
                    onClick={() => void window.aira.feedbackSimpanLampiran(f.id)}
                  >
                    📎 {f.lampiranNama}
                    {f.lampiranUkuran ? ` (${Math.max(1, Math.round(f.lampiranUkuran / 1024))} KB)` : ''} — download
                  </button>
                )}

                {f.catatanAdmin && (
                  <div className="hint">
                    Note {f.ditanganiOleh ? `(${f.ditanganiOleh})` : ''}: {f.catatanAdmin}
                  </div>
                )}

                <button
                  className="fb-lihat"
                  onClick={() => {
                    setRinci(rinci === f.id ? null : f.id)
                    setCatatan('')
                  }}
                >
                  {rinci === f.id ? '▾' : '▸'} Details &amp; follow-up
                </button>

                {rinci === f.id && (
                  <div className="fb-rinci">
                    <div className="fb-meta">
                      {[f.hostname, f.osUser && `(${f.osUser})`, f.ip].filter(Boolean).join(' ')}
                      {f.model && ` · model ${f.model}`}
                      {f.sesiId && ` · session ${f.sesiId.slice(0, 8)}`}
                    </div>

                    {/*
                      Dibedakan dengan tegas: "user mencabut centang" BUKAN sama
                      dengan "ini masukan umum tanpa percakapan". Kalau keduanya
                      tampil sebagai kolom kosong, Super Admin akan mengira
                      cuplikannya hilang karena bug.
                    */}
                    {f.pesanId === null ? (
                      <p className="hint">General feedback — not tied to a specific answer.</p>
                    ) : f.sertakanChat ? (
                      <>
                        <h4>User's question</h4>
                        <pre className="fb-pratinjau">{f.pertanyaan ?? '(none)'}</pre>
                        <h4>AIRA's answer</h4>
                        <pre className="fb-pratinjau">{f.jawaban ?? '(none)'}</pre>
                      </>
                    ) : (
                      <p className="hint">
                        The user chose NOT to include the conversation excerpt. The tools below were still
                        sent.
                      </p>
                    )}

                    <h4>Tools used</h4>
                    {f.toolLog && f.toolLog.length > 0 ? (
                      <pre className="fb-pratinjau">
                        {f.toolLog.map((t) => `· ${t.label ?? t.name} ${t.argsSummary}`).join('\n')}
                      </pre>
                    ) : (
                      <p className="hint">No tools were called.</p>
                    )}

                    <label className="fb-label" htmlFor={`fb-cat-${f.id}`}>
                      Note for the reporter (optional — they see it on the Feedback screen)
                    </label>
                    <textarea
                      id={`fb-cat-${f.id}`}
                      rows={2}
                      value={catatan}
                      maxLength={2000}
                      onChange={(e) => setCatatan(e.target.value)}
                    />

                    <div className="fb-aksi">
                      {FEEDBACK_STATUS.filter((s) => s !== 'baru').map((s) => (
                        // ⚠️ `.btn-teks`, BUKAN `.btn-mini` — yang terakhir ikon
                        // 24×24 dengan padding 0; teks di dalamnya meluber dan
                        // menimpa tombol sebelahnya ("Blekir password",
                        // 19 Agu 2026).
                        <button
                          key={s}
                          className="btn-teks"
                          disabled={busy || f.status === s}
                          onClick={() => void ubahStatus(f.id, s)}
                        >
                          {FEEDBACK_STATUS_LABELS[s]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function bersihkanError(err: unknown): string {
  const teks = err instanceof Error ? err.message : String(err)
  return teks.split('Error: ').pop() ?? teks
}
