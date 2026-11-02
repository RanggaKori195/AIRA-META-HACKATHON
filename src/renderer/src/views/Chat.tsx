import { useEffect, useRef, useState, type JSX } from 'react'
import type { Attachment, ChatMessage, ChatMode, ModelChoice, StatusKoneksiSales, ToolActivity } from '@shared/ipc'
import { DashboardJawaban } from '../components/DashboardJawaban'
import { KartuVisual } from '../components/KartuVisual'
import type { PendingApproval } from '../App'
import Markdown from '../components/Markdown'
import AttachBar, { useDropHandlers } from '../components/AttachBar'
import ModelPicker from '../components/ModelPicker'
import CredentialCard, { type CredentialRequest } from '../components/CredentialCard'
import FeedbackDialog from '../components/FeedbackDialog'
import { TombolDikte } from '../components/TombolDikte'
import {
  IconAlert,
  IconBulb,
  IconChart,
  IconDatabase,
  IconClock,
  IconSparkleSolid,
  IconAttach,
  IconBan,
  IconCheck,
  IconCopy,
  IconFile,
  IconFlag,
  IconFolder,
  IconHand,
  IconSend,
  IconSpinner,
  IconStop
} from '../components/Icons'
import watermark from '../assets/mascot/hello.png'
import mark from '../assets/mascot/idle.png'

/** Header percakapan menu data — mengingatkan sumber yang sedang dipakai. */
const KEPALA_DATA: Partial<Record<ChatMode, { judul: string; ket: string }>> = {
  sales: { judul: 'Ask Sales Data', ket: 'Ask anything about sales — the numbers come straight from the database, not estimates.' },
  lab: { judul: 'Ask Sample TAT', ket: 'Sample journey: backlog, stages, TAT and RNS — ETL data, patient identities are not shown.' },
  masterdata: { judul: 'Ask Master Data', ket: 'Customers, items & prices, special prices, partnership agreements, and doctors — from the master data.' }
}

interface Props {
  messages: ChatMessage[]
  streamingId: string | null
  error: string | null
  pendingApproval: PendingApproval | null
  pendingCredential: CredentialRequest | null
  onCredential: (
    requestId: string,
    value: { username: string; password: string; remember: boolean } | null
  ) => void
  attachments: Attachment[]
  modelChoice: ModelChoice
  onModelChoice: (choice: ModelChoice) => void
  onAttach: () => void
  onDropFiles: (paths: string[]) => void
  onRemoveAttachment: (id: string) => void
  onApprove: (requestId: string, approved: boolean) => void
  onSend: (text: string) => void
  onStop: () => void
  /** null = tidak ada yang bisa diulang (mis. belum ada pertanyaan di sesi ini). */
  onRetry: (() => void) | null
  /** Mode percakapan — menentukan header & panel samping menu data. */
  mode?: ChatMode
}

function StatusIcon({ status }: { status: ToolActivity['status'] }): JSX.Element {
  if (status === 'ok') return <IconCheck size={14} />
  if (status === 'error') return <IconAlert size={14} />
  if (status === 'denied') return <IconBan size={14} />
  if (status === 'awaiting_approval') return <IconHand size={14} />
  return <IconSpinner size={14} />
}

/** Ekstensi yang ditampilkan sebagai gambar di chat — sama dengan daftar-izin di main. */
const EKS_GAMBAR = ['.png', '.jpg', '.jpeg', '.webp', '.gif']

/**
 * Pratinjau gambar di dalam gelembung jawaban.
 *
 * ⚠️ Isi berkasnya diminta ke MAIN process sebagai data URL, bukan dirujuk
 * `file:///` dari renderer: renderer berjalan ber-sandbox dengan `webSecurity`
 * menyala, jadi `<img src="file:///...">` diblokir diam-diam — gambarnya tidak
 * muncul dan tidak ada pesan apa pun.
 *
 * Gagal memuat = TIDAK menampilkan apa-apa (chip tool beserta tombol "buka
 * file" tetap ada). Kotak gambar rusak lebih membingungkan daripada tidak ada
 * pratinjau.
 */
function PratinjauGambar({ path }: { path: string }): JSX.Element | null {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let hidup = true
    setSrc(null)
    void window.aira
      .gambarDataUrl(path)
      .then((d) => hidup && setSrc(d))
      .catch(() => undefined)
    return () => {
      hidup = false
    }
  }, [path])
  if (!src) return null
  return (
    <button
      className="tool-gambar"
      title={`Open image — ${path}`}
      onClick={() => void window.aira.openFile(path)}
    >
      <img src={src} alt={path.split(/[\\/]/).pop() ?? 'image'} />
    </button>
  )
}

function ToolChip({ activity }: { activity: ToolActivity }): JSX.Element {
  const fileName = activity.outputPath?.split('\\').pop()
  return (
    <div className={`tool-chip ${activity.status}`} title={activity.resultSummary ?? ''}>
      <span className="tool-icon">
        <StatusIcon status={activity.status} />
      </span>
      <code>{activity.label ?? activity.name}</code>
      <span className="tool-args">{activity.argsSummary}</span>
      {activity.outputPath && (
        <span className="tool-file-actions">
          <button
            className="tool-file-btn"
            title={`Open file — ${activity.outputPath}`}
            onClick={() => void window.aira.openFile(activity.outputPath!)}
          >
            <IconFile size={12} /> {fileName}
          </button>
          <button
            className="tool-file-btn"
            title="Show in folder"
            onClick={() => void window.aira.revealFile(activity.outputPath!)}
          >
            <IconFolder size={12} />
          </button>
        </span>
      )}
    </div>
  )
}

/** Chip tool + pratinjau gambarnya (bila hasilnya memang gambar). */
function ToolBaris({ activity }: { activity: ToolActivity }): JSX.Element {
  const path = activity.outputPath
  const gambar =
    activity.status === 'ok' && path && EKS_GAMBAR.some((e) => path.toLowerCase().endsWith(e))
  // Diagram: berkas utamanya HTML interaktif; PNG bernama sama ditulis di sebelahnya.
  // Kalau PNG-nya gagal dibuat, main mengembalikan null dan pratinjau diam — chip tetap ada.
  const pngDiagram =
    activity.status === 'ok' && activity.name === 'buat_diagram' && path && /\.html?$/i.test(path)
      ? path.replace(/\.html?$/i, '.png')
      : null
  return (
    <>
      <ToolChip activity={activity} />
      {gambar && <PratinjauGambar path={path!} />}
      {pngDiagram && <PratinjauGambar path={pngDiagram} />}
    </>
  )
}

export default function Chat({
  messages,
  streamingId,
  error,
  onRetry,
  pendingApproval,
  pendingCredential,
  onCredential,
  attachments,
  modelChoice,
  onModelChoice,
  onAttach,
  onDropFiles,
  onRemoveAttachment,
  onApprove,
  onSend,
  onStop,
  mode
}: Props): JSX.Element {
  const [text, setText] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  /** Jawaban yang sedang dilaporkan lewat dialog. */
  const [laporTarget, setLaporTarget] = useState<ChatMessage | null>(null)
  /**
   * Jawaban yang sudah dilaporkan di layar ini. Ditandai ✓ supaya tidak
   * dilaporkan dua kali tanpa sadar — sengaja hanya di memori, bukan disimpan:
   * satu jawaban yang benar-benar dilaporkan dua kali dari sesi berbeda adalah
   * informasi, bukan kesalahan.
   */
  const [sudahLapor, setSudahLapor] = useState<string[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const kotakRef = useRef<HTMLTextAreaElement>(null)
  const drop = useDropHandlers(onDropFiles)
  // Dashboard TERAKHIR di percakapan ini — sumber panel samping (saran & insight).
  const dashboardTerakhir = [...messages].reverse().find((m) => m.dashboard)?.dashboard ?? null
  const [statusSales, setStatusSales] = useState<StatusKoneksiSales | null>(null)
  useEffect(() => {
    if (mode !== 'sales') return
    void window.aira.salesStatus().then(setStatusSales).catch(() => setStatusSales(null))
  }, [mode, dashboardTerakhir])
  const isiKotak = (t: string): void => {
    setText(t)
    requestAnimationFrame(() => {
      kotakRef.current?.focus()
      kotakRef.current?.setSelectionRange(t.length, t.length)
    })
  }
  const kirimLanjutan = (t: string): void => {
    if (streamingId) return
    onSend(t)
  }

  /**
   * Pertanyaan user yang mendahului sebuah jawaban.
   *
   * Dicari mundur dari posisi jawaban, bukan diambil dari `messages[i - 1]`:
   * kartu kredensial dan giliran tool bisa menyisipkan pesan di antaranya, dan
   * laporan yang membawa pertanyaan yang SALAH lebih menyesatkan daripada
   * laporan tanpa pertanyaan sama sekali.
   */
  const pertanyaanUntuk = (pesan: ChatMessage): string | null => {
    const idx = messages.findIndex((m) => m.id === pesan.id)
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return messages[i].content
    }
    return null
  }

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, streamingId, pendingApproval, pendingCredential])

  const submit = (): void => {
    const trimmed = text.trim()
    if ((!trimmed && attachments.length === 0) || streamingId) return
    onSend(trimmed || 'Please analyze this attachment.')
    setText('')
  }

  const denganSamping = (mode === 'sales' || mode === 'lab' || mode === 'masterdata') && dashboardTerakhir !== null

  const inti = (
    <div className={`chat ${denganSamping ? 'chat-lebar' : ''}`}>
      {mode && KEPALA_DATA[mode] && (
        <header className="chat-kepala-data">
          <span className="tile-ikon utama">
            {mode === 'masterdata' ? <IconDatabase size={22} /> : <IconChart size={22} />}
          </span>
          <div>
            <h2>{KEPALA_DATA[mode]!.judul}</h2>
            <p>{KEPALA_DATA[mode]!.ket}</p>
          </div>
        </header>
      )}
      {laporTarget && (
        <FeedbackDialog
          pesan={laporTarget}
          pertanyaan={pertanyaanUntuk(laporTarget)}
          onBatal={() => setLaporTarget(null)}
          onSelesai={() => {
            setSudahLapor((prev) => [...prev, laporTarget.id])
            setLaporTarget(null)
          }}
        />
      )}
      <img className="chat-watermark" src={watermark} alt="" />
      <div className="messages" ref={scrollRef}>
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role} ${m.dashboard || m.visual?.length ? 'msg-lebar' : ''}`}>
            <div className="role">
              {m.role === 'user' ? 'You' : 'AIRA'}
              {m.role === 'assistant' && m.modelUsed && (
                <span className="model-badge">{m.modelUsed}</span>
              )}
              {m.content.length > 0 && (
                <button
                  className="msg-copy"
                  title="Copy the whole answer"
                  onClick={() => {
                    window.aira.copyText(m.content)
                    setCopiedId(m.id)
                    setTimeout(() => setCopiedId(null), 1500)
                  }}
                >
                  {copiedId === m.id ? (
                    <>
                      <IconCheck size={12} /> Copied
                    </>
                  ) : (
                    <>
                      <IconCopy size={12} /> Copy
                    </>
                  )}
                </button>
              )}
            </div>
            {/*
              Isi "thinking" (reasoning Qwen3) SENGAJA tidak ditampilkan.
              Permintaan manajer IT 19 Agu 2026: untuk pembaca laporan — direksi
              dan manajer — untaian penalaran mentah lebih membingungkan daripada
              membantu, dan panjangnya mendorong jawaban yang sesungguhnya keluar
              layar. Diganti penanda proses seperti Claude Desktop / Codex.

              Reasoning-nya TETAP disimpan di SQLite (`messages.reasoning`) — jadi
              kalau suatu saat perlu menelusuri kenapa model mengambil keputusan
              tertentu, datanya masih ada. Yang dihilangkan hanya tampilannya.
            */}
            {m.toolLog && m.toolLog.length > 0 && (
              <div className="tools">
                {m.toolLog.map((a) => (
                  <ToolBaris key={a.callId} activity={a} />
                ))}
              </div>
            )}
            {m.id === streamingId && !m.content ? (
              // Belum ada satu huruf pun jawaban: tampilkan penanda proses saja,
              // bukan gelembung kosong berisi kursor berkedip.
              <div className="berpikir" role="status" aria-live="polite">
                <img src={mark} alt="" className="berpikir-logo" />
                <span className="berpikir-teks">AIRA is thinking…</span>
              </div>
            ) : (
              <div className="bubble">
                {m.role === 'assistant' ? <Markdown text={m.content} /> : m.content}
                {m.id === streamingId && <span className="cursor" />}
              </div>
            )}
            {m.dashboard?.jenis === 'sales' && <DashboardJawaban d={m.dashboard} onTanya={kirimLanjutan} onIsi={isiKotak} />}
            {/* Dashboard TAT & Master Data: bentuk kartu visual yang sama, diberi pita "Dashboard". */}
            {m.dashboard && m.dashboard.jenis !== 'sales' && (
              <div className="dashboard-umum">
                <span className="dashboard-umum-pita">Comparison dashboard</span>
                <KartuVisual k={m.dashboard.kartu} />
              </div>
            )}
            {m.visual && m.visual.length > 0 && (
              <div className="kv-daftar">
                {m.visual.map((k, i) => (
                  <KartuVisual key={`${k.tool}-${i}`} k={k} />
                ))}
              </div>
            )}
            {/*
              Tombol lapor DI BAWAH gelembung, bukan di header.
              Orang membaca jawaban dari atas ke bawah, dan keputusan "ini
              salah" lahir SESUDAH ia selesai membaca — di situlah tombolnya
              harus berada. Di header, jawaban sepanjang satu layar berarti user
              harus menggulir balik ke atas untuk melaporkannya, dan yang
              terjadi di lapangan bukan ia menggulir, melainkan ia tidak
              melapor sama sekali. (Masukan user 20 Agu 2026.)

              "Salin" sengaja TETAP di atas: yang disalin adalah seluruh
              jawaban, jadi tombolnya masuk akal terlihat sebelum membaca —
              dan memindahkan dua-duanya membuat header jawaban jadi kosong.

              Hanya untuk jawaban AIRA yang sudah selesai. Inilah jalur masukan
              yang paling berharga: konteksnya (sesi, pesan, model, tool yang
              dipakai) terisi otomatis, sehingga keluhan "angkanya salah" bisa
              ditelusuri. Lewat menu terpisah, user harus mengetik ulang
              konteks yang tidak akan pernah ia tulis.
            */}
            {m.role === 'assistant' && m.content.length > 0 && m.id !== streamingId && (
              <div className="msg-footer">
                <button
                  className="msg-copy"
                  title="Report this answer to the IT team"
                  disabled={sudahLapor.includes(m.id)}
                  onClick={() => setLaporTarget(m)}
                >
                  {sudahLapor.includes(m.id) ? (
                    <>
                      <IconCheck size={12} /> Reported
                    </>
                  ) : (
                    <>
                      <IconFlag size={12} /> Report this answer
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        ))}
        {pendingCredential && (
          <div className="msg">
            <CredentialCard request={pendingCredential} onSubmit={onCredential} />
          </div>
        )}
        {pendingApproval && (
          <div className="msg">
            <div className="approval-card">
              <div className="approval-title">
                <IconHand size={16} /> AIRA is asking for permission
              </div>
              <div className="approval-detail">{pendingApproval.detail}</div>
              <div className="approval-tier">
                Category: <code>{pendingApproval.activity.tier}</code> ·{' '}
                <code>{pendingApproval.activity.label ?? pendingApproval.activity.name}</code>
              </div>
              <div className="approval-actions">
                <button
                  className="btn-send"
                  onClick={() => onApprove(pendingApproval.requestId, true)}
                >
                  Allow
                </button>
                <button
                  className="btn-stop"
                  onClick={() => onApprove(pendingApproval.requestId, false)}
                >
                  Deny
                </button>
              </div>
            </div>
          </div>
        )}
        {error && (
          <div className="msg">
            <div className="error">
              <div>{error}</div>
              {onRetry && (
                <button type="button" className="btn-retry" onClick={onRetry}>
                  Try again
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="composer">
        <div className="inner">
          <div className="task-box" {...drop}>
            <AttachBar attachments={attachments} onRemove={onRemoveAttachment} />
            <textarea
              ref={kotakRef}
              placeholder={
                mode === 'sales'
                  ? 'Ask something else about the sales data…'
                  : 'Continue the conversation…  (you can also drag files here)'
              }
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
              }}
              rows={2}
            />
            <div className="row">
              <div className="row-left">
                <button className="btn-attach" onClick={onAttach} title="Attach a file or image">
                  <IconAttach />
                </button>
                {/* Hasil dikte DISISIPKAN, tidak dikirim — user mengoreksi dulu. */}
                <TombolDikte
                  onTeks={(t) => setText((s) => (s.trim() ? `${s.trim()} ${t}` : t))}
                  disabled={!!streamingId}
                />
                <ModelPicker value={modelChoice} onChange={onModelChoice} />
              </div>
              {streamingId ? (
                <button className="btn-stop" onClick={onStop}>
                  <IconStop size={14} /> Stop
                </button>
              ) : (
                <button
                  className="btn-send"
                  disabled={!text.trim() && attachments.length === 0}
                  onClick={submit}
                >
                  Send <IconSend size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  if (!denganSamping || !dashboardTerakhir) return inti

  const waktuDashboard = new Date(dashboardTerakhir.dibuat).toLocaleString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
  const status =
    statusSales === null
      ? null
      : statusSales.keadaan === 'terhubung'
        ? { teks: 'Connected', kelas: 'ok' }
        : statusSales.keadaan === 'gagal'
          ? { teks: 'Not connected', kelas: 'gagal' }
          : { teks: 'Not checked yet', kelas: 'belum' }

  return (
    <div className="chat-dengan-samping">
      {inti}
      <aside className="chat-samping">
        <div className="kartu-panel">
          <div className="kartu-panel-kepala">
            <h4>
              <IconBulb size={17} /> Suggested Follow-up Questions
            </h4>
          </div>
          <div className="kategori-daftar">
            {dashboardTerakhir.saran.map((q) => (
              <button key={q} disabled={!!streamingId} onClick={() => kirimLanjutan(q)} title={q}>
                <span>{q}</span>
                <span aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        </div>
        <div className="kartu-panel">
          <div className="kartu-panel-kepala">
            <h4>
              <IconSparkleSolid size={17} /> Insights from AIRA
            </h4>
          </div>
          {dashboardTerakhir.insight.length === 0 ? (
            <p className="panel-kosong">No insights for this data yet.</p>
          ) : (
            <ul className="insight-daftar">
              {dashboardTerakhir.insight.map((k) => (
                <li key={k}>
                  <span className="tile-tips hijau">
                    <IconChart size={15} />
                  </span>
                  <span>{k}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="insight-catatan">Generated automatically from the dashboard numbers — not guesses.</p>
        </div>
        <div className="kartu-panel">
          <div className="kartu-panel-kepala">
            <h4>
              <IconDatabase size={17} /> Data Source
            </h4>
          </div>
          <div className="sales-sumber-baris">
            <span>
              <IconDatabase size={14} /> {dashboardTerakhir.jenis === 'sales' ? 'SalesRepository' : dashboardTerakhir.sumber}
            </span>
            {dashboardTerakhir.jenis === 'sales' && status && (
              <span className={`status-koneksi ${status.kelas}`}>
                <i /> {status.teks}
              </span>
            )}
          </div>
          <div className="sales-sumber-baris">
            <span>
              <IconClock size={14} /> Dashboard built {waktuDashboard}
            </span>
          </div>
        </div>
      </aside>
    </div>
  )
}
