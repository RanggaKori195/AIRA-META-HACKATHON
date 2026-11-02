import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import {
  FEEDBACK_DAMPAK,
  FEEDBACK_DAMPAK_LABELS,
  FEEDBACK_JENIS,
  FEEDBACK_JENIS_LABELS,
  FEEDBACK_STATUS_LABELS,
  type FeedbackDampak,
  type FeedbackJenis,
  type FeedbackRow
} from '@shared/ipc'
import {
  IconAlert,
  IconBulb,
  IconChart,
  IconCheck,
  IconClock,
  IconClose,
  IconHelp,
  IconInfo,
  IconList,
  IconMore,
  IconSend,
  IconUpload
} from '../components/Icons'

// Menu "Masukan & Usulan" — jalur B. Tata letak baru 30 Sep 2026 mengikuti
// mockup user: hero, 3 kartu statistik, form, tips, riwayat bertabel.
//
// ⚠️ Menu ini TIDAK tunduk pada matriks akses role × divisi, dan itu keputusan
// sadar. Ia justru dipakai untuk melaporkan bahwa sesuatu tidak jalan — termasuk
// "menu saya tidak muncul". Kalau aksesnya sendiri diatur matriks, ia akan hilang
// tepat pada orang yang paling perlu melapor (kegagalan diam 19 Agu 2026).
//
// ⚠️ Statistik dihitung dari masukan MILIK user ini (maks 100 terakhir) — bukan
// seluruh masukan. Mockup tidak menyebut cakupannya; angka yang tampak seperti
// "antrean tim IT" padahal cuma milik sendiri akan menyesatkan, jadi judulnya
// menyebut "masukan saya".
// ⚠️ Lampiran dibaca lewat File API (isi berkas), renderer TIDAK PERNAH
// mengirim path (pola §71). Jenis & ukuran ditegakkan ulang di main.

const MAKS_ISI = 4000
const MAKS_LAMPIRAN = 5 * 1024 * 1024

const KELAS_STATUS: Record<string, string> = {
  baru: 'fbx-tag biru',
  dibaca: 'fbx-tag biru',
  dikerjakan: 'fbx-tag oranye',
  selesai: 'fbx-tag hijau',
  ditolak: 'fbx-tag merah'
}

const KELAS_DAMPAK: Record<string, string> = {
  menghalangi: 'fbx-tag merah',
  mengganggu: 'fbx-tag kuning',
  kecil: 'fbx-tag hijau'
}

/** Jenis berkas bila File.type kosong (Windows kadang tidak mengisinya). */
const MIME_EKSTENSI: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
}

const TIPS = [
  { judul: 'Explain the context', isi: 'Describe what you were doing when the problem happened.' },
  { judul: 'Include the steps', isi: 'List the steps you took, in order.' },
  { judul: 'Attach evidence if you have it', isi: 'A screenshot or a sample file helps a lot.' },
  { judul: 'Say what you expect', isi: 'Describe the result you expected or suggest a solution.' }
]

function IconBug({ size = 16 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="7" y="7" width="10" height="13" rx="5" />
      <path d="M9 7a3 3 0 0 1 6 0M12 11v9M3 13h4M17 13h4M4 7l3 2M20 7l-3 2M4 19l3-2M20 19l-3-2" />
    </svg>
  )
}

function IconPesan({ size = 22 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
    </svg>
  )
}

function IconChevron(): JSX.Element {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

const IKON_JENIS: Record<FeedbackJenis, (size: number) => JSX.Element> = {
  bug: (s) => <IconBug size={s} />,
  usulan: (s) => <IconBulb size={s} />,
  tidak_terjawab: (s) => <IconHelp size={s} />,
  lain: (s) => <IconMore size={s} />
}

const IKON_DAMPAK: Record<FeedbackDampak, JSX.Element> = {
  menghalangi: <IconAlert size={15} />,
  mengganggu: <IconInfo size={15} />,
  kecil: <IconChart size={15} />
}

const waktuSingkat = (iso: string): string =>
  new Date(iso).toLocaleString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })

const ukuranManusiawi = (b: number): string =>
  b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`

interface Lampiran {
  nama: string
  mime: string
  data: Uint8Array
}

export default function Feedback(): JSX.Element {
  const [jenis, setJenis] = useState<FeedbackJenis>('usulan')
  const [isi, setIsi] = useState('')
  const [dampak, setDampak] = useState<FeedbackDampak>('kecil')
  const [lampiran, setLampiran] = useState<Lampiran | null>(null)
  const [seret, setSeret] = useState(false)
  const [milikSaya, setMilikSaya] = useState<FeedbackRow[]>([])
  const [saring, setSaring] = useState('')
  const [rinci, setRinci] = useState<FeedbackRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [pesan, setPesan] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pilihBerkas = useRef<HTMLInputElement>(null)

  const muat = useCallback(async () => {
    try {
      setMilikSaya(await window.aira.feedbackMilikSaya())
      setError(null)
    } catch (err) {
      setError(bersihkanError(err))
    }
  }, [])

  useEffect(() => {
    void muat()
  }, [muat])

  const ambilBerkas = async (f: File | undefined): Promise<void> => {
    if (!f) return
    const ekstensi = f.name.split('.').pop()?.toLowerCase() ?? ''
    const mime = f.type || MIME_EKSTENSI[ekstensi] || ''
    if (!Object.values(MIME_EKSTENSI).includes(mime)) {
      setError('This file type cannot be attached (images, PDF, text, and Office documents only).')
      return
    }
    if (f.size > MAKS_LAMPIRAN) {
      setError(`The file (${ukuranManusiawi(f.size)}) exceeds the 5 MB limit.`)
      return
    }
    setError(null)
    setLampiran({ nama: f.name, mime, data: new Uint8Array(await f.arrayBuffer()) })
  }

  const kirim = async (): Promise<void> => {
    if (busy || isi.trim().length === 0) return
    setBusy(true)
    setPesan(null)
    setError(null)
    try {
      const daftar = await window.aira.kirimFeedback({
        jenis,
        isi,
        dampak,
        // Jalur B tidak terikat satu jawaban — seluruh konteks percakapan null.
        sesiId: null,
        pesanId: null,
        mode: null,
        model: null,
        pertanyaan: null,
        jawaban: null,
        toolLog: null,
        sertakanChat: false,
        lampiran
      })
      setMilikSaya(daftar)
      setIsi('')
      setLampiran(null)
      setPesan('Thank you — your feedback has been sent to the IT team.')
    } catch (err) {
      setError(bersihkanError(err))
    } finally {
      setBusy(false)
    }
  }

  const hitung = useMemo(() => {
    const n = (...s: string[]): number => milikSaya.filter((f) => s.includes(f.status)).length
    return { baru: n('baru', 'dibaca'), proses: n('dikerjakan'), selesai: n('selesai'), ditolak: n('ditolak') }
  }, [milikSaya])

  const tampil = useMemo(
    () =>
      saring === ''
        ? milikSaya
        : milikSaya.filter((f) => (saring === 'baru' ? f.status === 'baru' || f.status === 'dibaca' : f.status === saring)),
    [milikSaya, saring]
  )

  const labelStatus = (s: string): string =>
    FEEDBACK_STATUS_LABELS[s as keyof typeof FEEDBACK_STATUS_LABELS] ?? s

  return (
    <div className="fbx">
      <header className="fbx-hero">
        <span className="fbx-hero-ikon">
          <IconPesan size={28} />
        </span>
        <div className="fbx-hero-teks">
          <h1>Feedback</h1>
          <p>
            Share feedback, report a problem, or suggest a feature to make AIRA better.
            <br />
            Every submission is read directly by the IT team and helps us shape AIRA around your needs.
          </p>
        </div>
        {/* Hiasan: gelembung chat + kartu bola lampu, meniru mockup. */}
        <svg className="fbx-seni" viewBox="0 0 260 120" aria-hidden="true">
          <circle cx="230" cy="20" r="40" fill="#d7eedf" opacity="0.6" />
          <rect x="40" y="38" width="86" height="58" rx="12" fill="#2f8a52" />
          <path d="M58 96l-4 16 18-16z" fill="#2f8a52" />
          <rect x="56" y="54" width="54" height="5" rx="2.5" fill="#dff2e6" />
          <rect x="56" y="66" width="54" height="5" rx="2.5" fill="#dff2e6" />
          <rect x="56" y="78" width="36" height="5" rx="2.5" fill="#dff2e6" />
          <rect x="136" y="12" width="84" height="98" rx="14" fill="#ffffff" stroke="#d6eadc" transform="rotate(6 178 61)" />
          <path d="M178 38a16 16 0 0 0-9 29v7h18v-7a16 16 0 0 0-9-29z" fill="#3aa05f" transform="rotate(6 178 61)" />
          <rect x="170" y="78" width="16" height="5" rx="2" fill="#2f7d49" transform="rotate(6 178 61)" />
          <path d="M232 52l12-6M234 64h14M232 76l12 6" stroke="#e6b52e" strokeWidth="3.5" strokeLinecap="round" />
        </svg>
      </header>

      <div className="fbx-stat">
        <div className="fbx-stat-kartu biru">
          <span className="tile-ikon biru"><IconPesan size={24} /></span>
          <span>
            <strong>{hitung.baru}</strong>
            <b>New Feedback</b>
            <small>Waiting to be processed</small>
          </span>
        </div>
        <div className="fbx-stat-kartu oranye">
          <span className="tile-ikon oranye"><IconClock size={24} /></span>
          <span>
            <strong>{hitung.proses}</strong>
            <b>In Progress</b>
            <small>Being followed up</small>
          </span>
        </div>
        <div className="fbx-stat-kartu hijau">
          <span className="tile-ikon hijau"><IconCheck size={24} /></span>
          <span>
            <strong>{hitung.selesai}</strong>
            <b>Done</b>
            <small>
              Followed up{hitung.ditolak > 0 ? ' · ' + hitung.ditolak + ' declined' : ''}
            </small>
          </span>
        </div>
      </div>
      <p className="fbx-cakupan">The numbers above count the feedback <strong>you</strong> submitted.</p>

      <div className="fbx-tengah">
        <section className="fbx-kartu fbx-form">
          <h3>
            <IconSend size={18} /> Send New Feedback / Suggestion
          </h3>
          <p className="fbx-petunjuk">
            Want to report a wrong AIRA answer? Use the <strong>Report</strong> button on that answer —
            the context is sent automatically, which makes it much easier to trace.
          </p>

          <label className="fbx-label">Feedback type</label>
          <div className="fbx-pil-baris">
            {FEEDBACK_JENIS.map((j) => (
              <button key={j} className={`fbx-pil ${jenis === j ? 'aktif' : ''}`} onClick={() => setJenis(j)}>
                {IKON_JENIS[j](15)} {FEEDBACK_JENIS_LABELS[j]}
              </button>
            ))}
          </div>

          <label className="fbx-label" htmlFor="fbx-isi">
            Your feedback
          </label>
          <textarea
            id="fbx-isi"
            className="fbx-isi"
            rows={4}
            value={isi}
            maxLength={MAKS_ISI}
            placeholder={'Example: please add support for the question "who receives the biggest discount?"'}
            onChange={(e) => setIsi(e.target.value)}
          />
          <div className="fbx-hitung">
            {isi.length}/{MAKS_ISI}
          </div>

          <label className="fbx-label">How disruptive is it?</label>
          <div className="fbx-pil-baris">
            {FEEDBACK_DAMPAK.map((d) => (
              <button
                key={d}
                className={`fbx-pil dampak-${d} ${dampak === d ? 'aktif' : ''}`}
                onClick={() => setDampak(d)}
              >
                {IKON_DAMPAK[d]} {FEEDBACK_DAMPAK_LABELS[d]}
              </button>
            ))}
          </div>

          <label className="fbx-label">Attachment (optional)</label>
          <div className="fbx-bawah">
            <div
              className={`fbx-unggah ${seret ? 'seret' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => pilihBerkas.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') pilihBerkas.current?.click()
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setSeret(true)
              }}
              onDragLeave={() => setSeret(false)}
              onDrop={(e) => {
                e.preventDefault()
                setSeret(false)
                void ambilBerkas(e.dataTransfer.files[0])
              }}
            >
              <span className="fbx-unggah-ikon">
                <IconUpload size={18} />
              </span>
              {lampiran ? (
                <span className="fbx-unggah-teks">
                  <strong>📎 {lampiran.nama}</strong>
                  <small>{ukuranManusiawi(lampiran.data.byteLength)} · click to replace</small>
                </span>
              ) : (
                <span className="fbx-unggah-teks">
                  <strong>Click to upload a file or drag it here</strong>
                  <small>Max. 5 MB (PNG, JPG, PDF, Word, Excel, PowerPoint, text)</small>
                </span>
              )}
              {lampiran && (
                <button
                  className="btn-mini"
                  title="Remove attachment"
                  onClick={(e) => {
                    e.stopPropagation()
                    setLampiran(null)
                  }}
                >
                  <IconClose size={14} />
                </button>
              )}
              <input
                ref={pilihBerkas}
                type="file"
                hidden
                accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.csv,.docx,.xlsx,.pptx"
                onChange={(e) => {
                  void ambilBerkas(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </div>
            <button
              className="btn-send fbx-kirim"
              onClick={() => void kirim()}
              disabled={busy || isi.trim().length === 0}
            >
              <IconSend size={16} /> {busy ? 'Sending…' : 'Send feedback'}
            </button>
          </div>

          {pesan && <div className="fb-sukses">{pesan}</div>}
          {error && <div className="error">{error}</div>}
        </section>

        <aside className="fbx-kartu fbx-tips">
          <h3>
            <span className="fbx-tips-ikon"><IconBulb size={18} /></span> Tips for writing feedback
          </h3>
          <p className="fbx-petunjuk">So your feedback is easy to understand and quick for the IT team to act on.</p>
          <ol>
            {TIPS.map((t, i) => (
              <li key={t.judul}>
                <span>{i + 1}</span>
                <div>
                  <strong>{t.judul}</strong>
                  <small>{t.isi}</small>
                </div>
              </li>
            ))}
          </ol>
        </aside>
      </div>

      {/*
        Daftar "Riwayat masukan saya" wajib ada, bukan pelengkap. Kalau orang mengirim
        masukan dan tidak pernah melihat apa pun terjadi, minggu ketiga tidak ada lagi
        yang mengirim. Status di sini adalah yang diubah Super Admin — itulah umpan baliknya.
      */}
      <section className="fbx-kartu fbx-riwayat">
        <div className="fbx-riwayat-kepala">
          <h3>
            <IconList size={18} /> My feedback history
          </h3>
          <label className="gambar-pilih">
            <select value={saring} onChange={(e) => setSaring(e.target.value)}>
              <option value="">All statuses</option>
              <option value="baru">New</option>
              <option value="dikerjakan">In progress</option>
              <option value="selesai">Done</option>
              <option value="ditolak">Declined</option>
            </select>
          </label>
        </div>
        {tampil.length === 0 ? (
          <p className="panel-kosong">
            {milikSaya.length === 0
              ? 'Nothing yet. Feedback you send will appear here.'
              : 'No feedback with this status.'}
          </p>
        ) : (
          <table className="fbx-tabel">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Summary</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {tampil.map((f) => {
                const j = f.jenis as FeedbackJenis
                return (
                  <tr key={f.id}>
                    <td className="nowrap">{waktuSingkat(f.createdAt)}</td>
                    <td className="nowrap">
                      <span className={`fbx-jenis ${j}`}>
                        {IKON_JENIS[j]?.(15)} {FEEDBACK_JENIS_LABELS[j] ?? f.jenis}
                      </span>
                    </td>
                    <td className="fbx-isi-sel" title={f.isi}>
                      {f.lampiranNama && <span title={f.lampiranNama}>📎 </span>}
                      {f.isi}
                    </td>
                    <td className="nowrap">
                      {f.dampak ? (
                        <span className={KELAS_DAMPAK[f.dampak] ?? 'fbx-tag'}>
                          {FEEDBACK_DAMPAK_LABELS[f.dampak as FeedbackDampak] ?? f.dampak}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="nowrap">
                      <span className={KELAS_STATUS[f.status] ?? 'fbx-tag'}>{labelStatus(f.status)}</span>
                    </td>
                    <td className="nowrap">
                      <button className="fbx-lihat" onClick={() => setRinci(f)}>
                        View <IconChevron />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      {rinci && (
        <div className="dialog-backdrop" onClick={() => setRinci(null)}>
          <div className="dialog dialog-lebar" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-head">
              <h3>Feedback #{rinci.id}</h3>
            </div>
            <div className="fbx-rinci">
              <div className="fbx-rinci-meta">
                <span>{waktuSingkat(rinci.createdAt)}</span>
                <span>{FEEDBACK_JENIS_LABELS[rinci.jenis as FeedbackJenis] ?? rinci.jenis}</span>
                {rinci.dampak && (
                  <span className={KELAS_DAMPAK[rinci.dampak] ?? 'fbx-tag'}>
                    {FEEDBACK_DAMPAK_LABELS[rinci.dampak as FeedbackDampak] ?? rinci.dampak}
                  </span>
                )}
                <span className={KELAS_STATUS[rinci.status] ?? 'fbx-tag'}>{labelStatus(rinci.status)}</span>
              </div>
              <p className="fbx-rinci-isi">{rinci.isi}</p>
              {rinci.lampiranNama && (
                <button className="fbx-lihat" onClick={() => void window.aira.feedbackSimpanLampiran(rinci.id)}>
                  📎 {rinci.lampiranNama}
                  {rinci.lampiranUkuran ? ` (${ukuranManusiawi(rinci.lampiranUkuran)})` : ''} — save
                </button>
              )}
              <div className="fbx-rinci-tanggapan">
                <strong>IT team response</strong>
                <p>
                  {rinci.catatanAdmin
                    ? `${rinci.catatanAdmin}${rinci.ditanganiOleh ? ` — ${rinci.ditanganiOleh}` : ''}`
                    : 'No response yet.'}
                </p>
              </div>
            </div>
            <div className="dialog-actions">
              <button className="btn-send" onClick={() => setRinci(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function bersihkanError(err: unknown): string {
  const teks = err instanceof Error ? err.message : String(err)
  return teks.split('Error: ').pop() ?? teks
}
