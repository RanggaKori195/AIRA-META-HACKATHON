import { useCallback, useEffect, useState, type JSX } from 'react'
import type {
  AktivitasRow,
  ChatMode,
  MonitoringFilter,
  MonitoringRingkasan
} from '@shared/ipc'

// Monitoring pemakaian AIRA — hanya untuk Super Admin (16 Sep 2026).
//
// ⚠️ Panel ini KENYAMANAN, bukan penguncian (pola FeedbackAdmin). Ketiga channel
// memeriksa ulang role di main process, dan setiap pembukaan ringkasan
// tercatat di tb_aktivitas_akses_aira.
//
// ⚠️ Dimuat SAAT DIBUKA, bukan bersama Settings — alasan yang sama dengan
// FeedbackAdmin (panel Settings pernah kosong seluruhnya karena query serentak).

const LABEL_MODE: Record<string, string> = {
  general: 'New Task',
  sales: 'Ask Sales Data',
  masterdata: 'Ask Master Data',
  lab: 'Ask Sample TAT',
  onedrive: 'Ask Microsoft 365'
}

/** Status values come from the database (Indonesian codes); only the label is English. */
const LABEL_STATUS: Record<string, string> = {
  selesai: 'completed',
  gagal: 'failed',
  dibatalkan: 'cancelled'
}

const PERIODE: Array<{ hari: 1 | 7 | 30 | 90; label: string }> = [
  { hari: 1, label: '24 hours' },
  { hari: 7, label: '7 days' },
  { hari: 30, label: '30 days' },
  { hari: 90, label: '90 days' }
]

/** Harus sama dengan RETENSI_PROMPT_HARI di main/monitoring/rules.ts. */
const RETENSI_HARI = 90

const waktuSingkat = (iso: string): string =>
  new Date(iso).toLocaleString('en-US', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })

const detik = (ms: number | null): string =>
  ms === null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`

const angka = (n: number): string => n.toLocaleString('en-US')

export default function MonitoringAdmin(): JSX.Element {
  const [buka, setBuka] = useState(false)
  const [filter, setFilter] = useState<MonitoringFilter>({
    periodeHari: 7,
    username: null,
    mode: null,
    cari: null
  })
  const [cariKetik, setCariKetik] = useState('')
  const [ringkas, setRingkas] = useState<MonitoringRingkasan | null>(null)
  const [baris, setBaris] = useState<AktivitasRow[]>([])
  const [adaLagi, setAdaLagi] = useState(false)
  const [antrean, setAntrean] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const muat = useCallback(async (f: MonitoringFilter) => {
    setBusy(true)
    try {
      // Berurutan, bukan Promise.all — pool auth menyerialkannya juga, dan
      // antrean didorong terkirim dulu supaya pemakaian barusan ikut terlihat.
      setAntrean(await window.aira.monitoringAntrean())
      setRingkas(await window.aira.monitoringRingkasan(f))
      const hasil = await window.aira.monitoringLinimasa({ ...f, sebelum: null })
      setBaris(hasil.baris)
      setAdaLagi(hasil.adaLagi)
      setError(null)
    } catch (err) {
      setError(bersihkanError(err))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    if (buka) void muat(filter)
  }, [buka, filter, muat])

  const lanjut = async (): Promise<void> => {
    const akhir = baris.at(-1)
    if (!akhir) return
    setBusy(true)
    try {
      const hasil = await window.aira.monitoringLinimasa({
        ...filter,
        sebelum: { waktu: akhir.waktu, id: akhir.id }
      })
      setBaris((b) => [...b, ...hasil.baris])
      setAdaLagi(hasil.adaLagi)
    } catch (err) {
      setError(bersihkanError(err))
    } finally {
      setBusy(false)
    }
  }

  const ubah = (sebagian: Partial<MonitoringFilter>): void =>
    setFilter((f) => ({ ...f, ...sebagian }))

  const maksHari = Math.max(1, ...(ringkas?.perHari.map((h) => h.jumlah) ?? [0]))
  const maksJam = Math.max(1, ...(ringkas?.perJam ?? [0]))

  return (
    <section className="card">
      <div className="card-head">
        <h3>Usage monitoring</h3>
        <button className="btn-teks" onClick={() => setBuka((v) => !v)}>
          {buka ? 'Close' : 'Open monitoring'}
        </button>
      </div>

      {!buka && (
        <p className="hint">
          Who uses AIRA, when, in which menu, what questions, and which tools AIRA used.
          AIRA's answers and file contents are not recorded.
        </p>
      )}

      {buka && (
        <>
          <div className="fb-pilihan">
            {PERIODE.map((p) => (
              <button
                key={p.hari}
                className={`fb-pil ${filter.periodeHari === p.hari ? 'aktif' : ''}`}
                onClick={() => ubah({ periodeHari: p.hari })}
              >
                {p.label}
              </button>
            ))}
            <select
              className="mon-pilih"
              value={filter.mode ?? ''}
              onChange={(e) => ubah({ mode: (e.target.value || null) as ChatMode | null })}
            >
              <option value="">All menus</option>
              {Object.entries(LABEL_MODE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            {filter.username && (
              <button className="fb-pil aktif" onClick={() => ubah({ username: null })}>
                {filter.username} ✕
              </button>
            )}
            <form
              className="mon-cari"
              onSubmit={(e) => {
                e.preventDefault()
                ubah({ cari: cariKetik.trim() || null })
              }}
            >
              <input
                value={cariKetik}
                maxLength={100}
                placeholder="Search words in questions…"
                onChange={(e) => setCariKetik(e.target.value)}
              />
            </form>
            <button className="btn-teks" disabled={busy} onClick={() => void muat(filter)}>
              {busy ? 'Loading…' : 'Reload'}
            </button>
          </div>

          {error && <div className="error">{error}</div>}
          {antrean !== null && antrean > 0 && (
            <p className="hint">
              {angka(antrean)} records from this laptop have not been sent to the server yet (database
              unreachable). They will be sent automatically.
            </p>
          )}

          {ringkas && (
            <>
              <div className="mon-kartu">
                <div>
                  <b>{angka(ringkas.totalPertanyaan)}</b>
                  <span>questions</span>
                </div>
                <div>
                  <b>{angka(ringkas.penggunaAktif)}</b>
                  <span>active users</span>
                </div>
                <div>
                  <b>{angka(ringkas.pakaiTool)}</b>
                  <span>used tools</span>
                </div>
                <div>
                  <b className={ringkas.gagal > 0 ? 'mon-buruk' : ''}>{angka(ringkas.gagal)}</b>
                  <span>failed</span>
                </div>
              </div>

              {ringkas.totalPertanyaan === 0 ? (
                <p className="hint">No usage recorded for this filter yet.</p>
              ) : (
                <div className="mon-grid">
                  <div>
                    <h4>Per day</h4>
                    <div className="mon-batang">
                      {ringkas.perHari.map((h) => (
                        <div key={h.tanggal} className="mon-batang-baris">
                          <span className="mon-label">{h.tanggal.slice(5)}</span>
                          <span className="mon-isi">
                            <i style={{ width: `${(h.jumlah / maksHari) * 100}%` }} />
                          </span>
                          <span className="mon-nilai">
                            {h.jumlah} · {h.pengguna} users
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4>Per hour (WIB)</h4>
                    <div className="mon-jam">
                      {ringkas.perJam.map((n, jam) => (
                        <div key={jam} title={`${String(jam).padStart(2, '0')}:00 — ${n} questions`}>
                          <i style={{ height: `${(n / maksJam) * 100}%` }} />
                          {jam % 3 === 0 && <span>{jam}</span>}
                        </div>
                      ))}
                    </div>

                    <h4>Per menu</h4>
                    <ul className="mon-daftar">
                      {ringkas.perMenu.map((m) => (
                        <li key={m.mode}>
                          <span>{LABEL_MODE[m.mode] ?? m.mode}</span>
                          <b>{angka(m.jumlah)}</b>
                        </li>
                      ))}
                    </ul>

                    <h4>Most used tools</h4>
                    {ringkas.toolTeratas.length === 0 ? (
                      <p className="hint">No tools used yet.</p>
                    ) : (
                      <ul className="mon-daftar">
                        {ringkas.toolTeratas.map((t) => (
                          <li key={t.nama}>
                            <code>{t.nama}</code>
                            <b>{angka(t.jumlah)}</b>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}

              {ringkas.perPengguna.length > 0 && (
                <>
                  <h4>Per user</h4>
                  <div className="mon-tabel-wrap">
                    <table className="mon-tabel">
                      <thead>
                        <tr>
                          <th>User</th>
                          <th>Role · division</th>
                          <th>Questions</th>
                          <th>Active days</th>
                          <th>Failed</th>
                          <th>Top menu</th>
                          <th>Last</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ringkas.perPengguna.map((p) => (
                          <tr key={p.username}>
                            <td>
                              <button
                                className="mon-tautan"
                                title="Show only this person's activity"
                                onClick={() => ubah({ username: p.username })}
                              >
                                {p.username}
                              </button>
                            </td>
                            <td>{[p.role, p.divisi].filter(Boolean).join(' · ') || '—'}</td>
                            <td>{angka(p.pertanyaan)}</td>
                            <td>{p.hariAktif}</td>
                            <td className={p.gagal > 0 ? 'mon-buruk' : ''}>{p.gagal}</td>
                            <td>{p.menuTersering ? (LABEL_MODE[p.menuTersering] ?? p.menuTersering) : '—'}</td>
                            <td>{waktuSingkat(p.terakhir)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}

          <h4>Timeline{filter.username ? ` — ${filter.username}` : ''}</h4>
          <div className="fb-daftar">
            {baris.map((a) => (
              <BarisAktivitas key={a.id} a={a} onPilihUser={(u) => ubah({ username: u })} />
            ))}
          </div>
          {adaLagi && (
            <button className="btn-teks" disabled={busy} onClick={() => void lanjut()}>
              Load more
            </button>
          )}

          <p className="hint">
            What is recorded: time, menu, model, the question typed (max 2,000 characters; anything
            that looks like a password is masked), attachment names, tools AIRA used, processing
            time, and success/failure. AIRA's answers and file contents are NOT recorded. Question
            text is deleted automatically after {RETENSI_HARI} days. Every time this panel is
            opened, your name is recorded.
          </p>
        </>
      )}
    </section>
  )
}

function BarisAktivitas({
  a,
  onPilihUser
}: {
  a: AktivitasRow
  onPilihUser: (u: string) => void
}): JSX.Element {
  const kedaluwarsa =
    a.prompt === null && Date.now() - new Date(a.waktu).getTime() > RETENSI_HARI * 86_400_000
  const kelasStatus =
    a.status === 'selesai' ? 'tag tag-ok' : a.status === 'dibatalkan' ? 'tag tag-netral' : 'tag tag-gagal'
  return (
    <div className="fb-item">
      <div className="fb-item-head">
        <span className={kelasStatus}>{LABEL_STATUS[a.status] ?? a.status}</span>
        <button className="mon-tautan" onClick={() => onPilihUser(a.username)}>
          <strong>{a.username}</strong>
        </button>
        <span className="fb-meta">{waktuSingkat(a.waktu)}</span>
        <span className="fb-meta">{a.mode ? (LABEL_MODE[a.mode] ?? a.mode) : '—'}</span>
        <span className="fb-meta">{detik(a.durasiMs)}</span>
        {a.promptTokens !== null && (
          <span className="fb-meta">
            {angka(a.promptTokens)}+{angka(a.completionTokens ?? 0)} tokens
          </span>
        )}
      </div>
      <div className="fb-item-isi">
        {a.prompt ?? (
          <span className="hint">
            {kedaluwarsa
              ? `(question text already deleted — older than ${RETENSI_HARI} days)`
              : '(empty question)'}
          </span>
        )}
      </div>
      {a.lampiran.length > 0 && (
        <div className="fb-meta">Attachments: {a.lampiran.join(', ')}</div>
      )}
      {a.tools.length > 0 && (
        <div className="mon-alat">
          {a.tools.map((t) => (
            <span key={t.nama} className={t.gagal > 0 ? 'tag tag-peringatan' : 'tag tag-netral'}>
              {t.nama}
              {t.kali > 1 ? ` ×${t.kali}` : ''}
              {t.gagal > 0 ? ` (${t.gagal} failed)` : ''}
            </span>
          ))}
        </div>
      )}
      <div className="fb-meta">
        {[a.role, a.divisi, a.hostname, a.appVersion && `v${a.appVersion}`, a.model, a.kodeGalat]
          .filter(Boolean)
          .join(' · ')}
      </div>
    </div>
  )
}

function bersihkanError(err: unknown): string {
  const teks = err instanceof Error ? err.message : String(err)
  return teks.split('Error: ').pop() ?? teks
}
