import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { Attachment, BerkasTerbaru, Briefing, ModelChoice, SessionMeta } from '@shared/ipc'
import AttachBar, { useDropHandlers } from '../components/AttachBar'
import ModelPicker from '../components/ModelPicker'
import { TombolDikte } from '../components/TombolDikte'
import {
  IconArrowRight,
  IconAttach,
  IconBulb,
  IconChat,
  IconClose,
  IconCode,
  IconMic,
  IconDatabase,
  IconFileText,
  IconFolder,
  IconHelp,
  IconLayers,
  IconMore,
  IconNote,
  IconPresentation,
  IconSearch,
  IconSend,
  IconSparkle,
  IconStar,
  IconTable,
  IconTrend,
  IconUpload,
  IconZap
} from '../components/Icons'
import logo from '../assets/mascot/hello.png'
import { isMuted, requestVoiceTurn, setMascotUser, speakAgent, speakAnswer } from '../components/mascot/voice'
import { runStartup, startupBriefing, startupGreeting, startupOnce } from '../components/agent/startup'
import { autoBriefing, BriefingCard, briefingKey, shouldAutoPlay } from '../components/BriefingCard'
import { onAgent, takePending } from '../components/agent/bus'

// Beranda (Task Baru) — tata letak baru 29 Sep 2026 mengikuti mockup user:
// hero + kotak tugas di tengah, "Mulai Cepat" & "Fitur Utama" di bawahnya, dan
// panel kanan (cari, File Terbaru, Tips, Butuh bantuan).
//
// ⚠️ "File Terbaru" berisi berkas ASLI hasil AIRA untuk user ini (dari riwayat
// chat, lewat main process) — bukan contoh. Daftar yang dikarang di layar orang
// sungguhan adalah janji yang tidak ditepati. Kosong = ditulis kosong.

interface Props {
  modelChoice: ModelChoice
  onModelChoice: (choice: ModelChoice) => void
  workspaceCount: number
  attachments: Attachment[]
  onAttach: () => void
  onDropFiles: (paths: string[]) => void
  onRemoveAttachment: (id: string) => void
  onSubmit: (text: string) => void
  onPanduan: () => void
  sessions: SessionMeta[]
  onOpenSession: (s: SessionMeta) => void
  /** Signed-in user: the morning briefing plays once a day per user. */
  username: string
}

interface Kartu {
  judul: string
  prompt: string
  ikon: JSX.Element
  warna: string
}

/**
 * Enam contoh — isi tetap sama dengan versi sebelumnya (dipilih dari bidang
 * berbeda untuk menunjukkan LUASNYA). Mengklik MENGISI kotak, tidak langsung
 * mengirim: separuh contoh butuh lampiran, dan terkirim tanpa lampiran berarti
 * jawaban pertama AIRA adalah "lampirannya mana?".
 */
const MULAI_CEPAT: Kartu[] = [
  { judul: 'Summarize a Document', prompt: 'Summarize the document I attached in 5 points', ikon: <IconFileText size={22} />, warna: 'biru' },
  { judul: 'Create a Presentation', prompt: 'Create an 8-slide presentation about the Q4 work plan', ikon: <IconPresentation size={22} />, warna: 'ungu' },
  { judul: 'Excel from PDF', prompt: 'Take the table in this PDF and turn it into Excel', ikon: <IconTable size={22} />, warna: 'hijau' },
  { judul: 'Analyze Data', prompt: 'Which document in my work folder discusses the 2026 budget?', ikon: <IconTrend size={22} />, warna: 'oranye' },
  { judul: 'Meeting Minutes', prompt: 'Write meeting minutes from these rough notes', ikon: <IconNote size={22} />, warna: 'merah' },
  { judul: 'Write a Script', prompt: 'Write a script to tidy up the file names in this folder', ikon: <IconCode size={22} />, warna: 'nila' }
]

const FITUR_UTAMA = [
  { judul: 'Understand Documents', ket: 'Reads many file formats accurately', ikon: <IconFileText size={20} />, warna: 'hijau' },
  { judul: 'Data Integration', ket: 'Accesses internal data safely', ikon: <IconDatabase size={20} />, warna: 'biru' },
  { judul: 'Smart Analysis', ket: 'Provides insights and recommendations', ikon: <IconTrend size={20} />, warna: 'ungu' },
  { judul: 'Productivity', ket: 'Automates everyday tasks', ikon: <IconZap size={20} />, warna: 'kuning' }
]

const TIPS = [
  { judul: 'Drag & drop files', ket: 'You can drag files straight into the chat box.', ikon: <IconUpload size={18} /> },
  { judul: 'Give clear instructions', ket: 'The more specific your request, the better the result.', ikon: <IconSparkle size={18} /> },
  { judul: 'Access work folders', ket: 'Add a folder in the sidebar for quick access.', ikon: <IconFolder size={18} /> },
  { judul: 'Combine data sources', ket: 'I can combine information from several files at once.', ikon: <IconLayers size={18} /> }
]

/** Warna tile per jenis berkas — mengikuti warna aplikasi Office masing-masing. */
function warnaBerkas(jenis: string): string {
  if (['xlsx', 'xls', 'csv'].includes(jenis)) return 'hijau'
  if (jenis === 'pdf') return 'merah'
  if (['docx', 'doc'].includes(jenis)) return 'biru'
  if (['pptx', 'ppt'].includes(jenis)) return 'oranye'
  if (['png', 'jpg', 'jpeg', 'webp'].includes(jenis)) return 'ungu'
  return 'abu'
}

function sejak(ms: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - ms) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} d ago`
  return new Date(ms).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
}

const KUNCI_BANTUAN = 'aira.beranda.bantuanDitutup'

function bacaBantuanDitutup(): boolean {
  try {
    return localStorage.getItem(KUNCI_BANTUAN) === '1'
  } catch {
    return false
  }
}

function TileBerkas({ jenis }: { jenis: string }): JSX.Element {
  return <span className={`tile-berkas ${warnaBerkas(jenis)}`}>{(jenis || '?').slice(0, 4).toUpperCase()}</span>
}

export default function Home({
  modelChoice,
  onModelChoice,
  workspaceCount,
  attachments,
  onAttach,
  onDropFiles,
  onRemoveAttachment,
  onSubmit,
  onPanduan,
  sessions,
  onOpenSession,
  username
}: Props): JSX.Element {
  const drop = useDropHandlers(onDropFiles)
  const [text, setText] = useState('')
  const kotak = useRef<HTMLTextAreaElement>(null)
  const cariRef = useRef<HTMLInputElement>(null)
  const [cari, setCari] = useState('')
  const [berkas, setBerkas] = useState<BerkasTerbaru[] | null>(null)
  const [semuaBerkas, setSemuaBerkas] = useState(false)
  const [menuBerkas, setMenuBerkas] = useState<string | null>(null)
  const [bantuanDitutup, setBantuanDitutup] = useState(bacaBantuanDitutup)
  const [galatBerkas, setGalatBerkas] = useState<string | null>(null)

  const muatBerkas = useCallback(async () => {
    try {
      setBerkas(await window.aira.berkasTerbaru(20))
    } catch {
      setBerkas([])
    }
  }, [])

  useEffect(() => {
    void muatBerkas()
  }, [muatBerkas, sessions])

  // Morning briefing: read aloud by itself once per user per day (unless muted); Brief me replays it any time.
  const [briefing, setBriefing] = useState<Briefing | null>(null)
  const [briefingLoading, setBriefingLoading] = useState(false)
  const [briefingError, setBriefingError] = useState<string | null>(null)
  const playBriefing = useCallback(async () => {
    setBriefingLoading(true)
    setBriefingError(null)
    try {
      const b = await window.aira.briefingGet()
      setBriefing(b)
      speakAnswer(b.text)
    } catch (e) {
      setBriefingError(e instanceof Error ? e.message : String(e))
    } finally {
      setBriefingLoading(false)
    }
  }, [])
  // Voice co-worker: "play my briefing" (sent while App was switching to Home, or while Home is open).
  useEffect(() => {
    if (takePending('brief')) void playBriefing()
    return onAgent('brief', () => void playBriefing())
  }, [playBriefing])
  // Voice co-worker startup (spec §2): once per user per app start — greet by name, the briefing on the first start
  // of the day, then listen. React dev mounts Home twice and the sequence runs in the first mount: what it shows goes
  // through the shared stores, which the Home on screen subscribes to.
  const [greeting, setGreeting] = useState<string | null>(null)
  useEffect(() => startupGreeting.subscribe(setGreeting), [])
  useEffect(() => {
    let alive = true
    const off = startupBriefing.subscribe((p) => {
      setBriefingLoading(true)
      p.then((b) => alive && setBriefing(b))
        .catch((e) => alive && setBriefingError(e instanceof Error ? e.message : String(e)))
        .finally(() => alive && setBriefingLoading(false))
    })
    return () => {
      alive = false
      off()
    }
  }, [])
  useEffect(() => {
    // Kept per signed-in user: one laptop, several users — never under an empty name.
    if (!username) return
    setMascotUser(username) // the mute setting is per user; Home's effect may run before the mascot's
    const key = briefingKey(username)
    const today = new Date().toLocaleDateString('en-CA')
    const run = `${key}:${today}`
    const fetchBriefing = (): Promise<Briefing> => autoBriefing(run, () => window.aira.briefingGet())
    const begin = (): void => startupOnce(username, () =>
      runStartup({
        getName: () => window.aira.agentNameGet(),
        setName: async (n) => void (await window.aira.agentNameSet(n)),
        speak: speakAgent,
        listenForName: () => requestVoiceTurn({ auto: true, purpose: 'name' }),
        getBriefing: async () => {
          const p = fetchBriefing()
          startupBriefing.publish(p)
          return p.then((b) => b.text).catch(() => null)
        },
        briefedToday: () => {
          try {
            return !shouldAutoPlay(localStorage.getItem(key), today, false)
          } catch {
            return false
          }
        },
        markBriefed: () => {
          try {
            localStorage.setItem(key, today)
          } catch {
            /* a lost marker only means one more briefing */
          }
        },
        muted: isMuted,
        hour: () => new Date().getHours(),
        listen: async () => void (await requestVoiceTurn({ auto: true, purpose: 'request' })),
        showText: (t) => startupGreeting.publish(t)
      })
    )
    // Started hidden in the tray (Windows autostart): no greeting and no open microphone nobody can see — the
    // sequence waits until the window is shown.
    if (document.visibilityState === 'visible') {
      begin()
      return
    }
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return
      document.removeEventListener('visibilitychange', onVisible)
      begin()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [username])

  // Ctrl+K memfokuskan kotak cari, seperti yang dijanjikan tulisannya.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        cariRef.current?.focus()
      } else if (e.key === 'Escape') {
        setMenuBerkas(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const submit = (): void => {
    const trimmed = text.trim()
    if (!trimmed && attachments.length === 0) return
    onSubmit(trimmed || 'Please analyze this attachment.')
    setText('')
  }

  const isiContoh = (prompt: string): void => {
    setText(prompt)
    requestAnimationFrame(() => {
      kotak.current?.focus()
      kotak.current?.setSelectionRange(prompt.length, prompt.length)
    })
  }

  const buka = async (b: BerkasTerbaru, aksi: 'buka' | 'folder'): Promise<void> => {
    setMenuBerkas(null)
    setGalatBerkas(null)
    try {
      const ok = await window.aira.berkasBuka(b.path, aksi)
      if (!ok) setGalatBerkas(`${b.nama} could not be opened — it may have been moved or deleted.`)
    } catch {
      setGalatBerkas(`${b.nama} could not be opened.`)
      void muatBerkas()
    }
  }

  const q = cari.trim().toLowerCase()
  const hasilCari = useMemo(() => {
    if (!q) return null
    return {
      sesi: sessions.filter((s) => s.title.toLowerCase().includes(q)).slice(0, 6),
      berkas: (berkas ?? []).filter((b) => b.nama.toLowerCase().includes(q)).slice(0, 6)
    }
  }, [q, sessions, berkas])

  const berkasTampil = (berkas ?? []).slice(0, semuaBerkas ? 20 : 5)

  return (
    <div className="beranda" onClick={() => setMenuBerkas(null)}>
      <div className="beranda-utama">
        <section className="beranda-hero">
          {/* Hiasan latar: pita gelombang lembut + pola titik, meniru mockup. */}
          <svg className="hero-gelombang" viewBox="0 0 640 340" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="gel-a" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#ced9ea" stopOpacity="0" />
                <stop offset="0.55" stopColor="#ced9ea" stopOpacity="0.9" />
                <stop offset="1" stopColor="#e8eef6" stopOpacity="0.4" />
              </linearGradient>
              <linearGradient id="gel-b" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0" stopColor="#b7c7de" stopOpacity="0" />
                <stop offset="0.6" stopColor="#b7c7de" stopOpacity="0.55" />
                <stop offset="1" stopColor="#dee6f1" stopOpacity="0.2" />
              </linearGradient>
              <pattern id="gel-titik" width="14" height="14" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="1.2" fill="#99adcc" />
              </pattern>
            </defs>
            <path fill="url(#gel-a)" d="M640 0 H470 C 420 60 470 130 400 200 C 350 250 300 290 260 340 H640 Z" />
            <path fill="url(#gel-b)" d="M640 40 C 560 70 540 150 500 210 C 470 260 420 300 380 340 H640 Z" />
            <path fill="none" stroke="#a5b9d6" strokeOpacity="0.7" strokeWidth="1.2" d="M480 0 C 430 80 480 150 380 230 C 330 270 300 310 280 340" />
            <path fill="none" stroke="#c2d0e4" strokeWidth="1" d="M520 0 C 470 90 520 160 430 240 C 390 280 360 315 345 340" />
            <rect x="190" y="30" width="130" height="120" fill="url(#gel-titik)" opacity="0.5" />
          </svg>
          <div className="hero-teks">
            <span className="hero-lencana">
              <IconSparkle size={14} /> AI Lab Assistant · powered by Meta Muse
            </span>
            <h1>
              Hi, I&apos;m <span>AIRA</span> <span className="hero-lambai">👋</span>
            </h1>
            <p>
              I can read, search, analyze and tidy up files in the folders you allow — or simply
              answer your questions.
            </p>
          </div>
          <button type="button" className="hero-maskot" onClick={() => void requestVoiceTurn()} title="Talk to AIRA">
            <img className="hero-logo" src={logo} alt="AIRA" draggable={false} />
            <span className="hero-maskot-ajak">
              <IconMic size={14} /> Click me and ask by voice
            </span>
          </button>
        </section>

        <BriefingCard briefing={briefing} greeting={greeting} loading={briefingLoading} error={briefingError} onBriefMe={() => void playBriefing()} />

        {workspaceCount === 0 && (
          <p className="beranda-peringatan">
            ⚠ No access folders yet. Add one with the “+” button in Access Folders (sidebar) so I
            can work with your files.
          </p>
        )}

        <div className="task-box beranda-kotak" {...drop}>
          <AttachBar attachments={attachments} onRemove={onRemoveAttachment} />
          <textarea
            ref={kotak}
            placeholder="What can I do for you today?  (you can also drag files here)"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            autoFocus
          />
          <div className="row">
            <div className="row-left">
              <button className="btn-attach" onClick={onAttach} title="Attach a file or image">
                <IconAttach />
              </button>
              {/* Hasil dikte DISISIPKAN ke kotak teks, tidak dikirim otomatis. */}
              <TombolDikte onTeks={(t) => setText((s) => (s.trim() ? `${s.trim()} ${t}` : t))} />
              <ModelPicker value={modelChoice} onChange={onModelChoice} />
            </div>
            <button className="btn-send" disabled={!text.trim() && attachments.length === 0} onClick={submit}>
              Send <IconSend size={14} />
            </button>
          </div>
        </div>

        <div className="beranda-kepala">
          <h3>
            <IconZap size={17} /> Quick Start
          </h3>
          <span>Pick an example task or use your own prompt</span>
          {/* Jalan keluar yang TIDAK lewat model — tetap bekerja saat gateway mati. */}
          <button className="beranda-tautan" onClick={onPanduan}>
            View all <IconArrowRight size={14} />
          </button>
        </div>
        <div className="mulai-cepat">
          {MULAI_CEPAT.map((k) => (
            <button key={k.judul} className="kartu-cepat" onClick={() => isiContoh(k.prompt)} title="Fill the task box">
              <span className={`tile-ikon ${k.warna}`}>{k.ikon}</span>
              <span className="kartu-cepat-teks">
                <strong>{k.judul}</strong>
                <span>{k.prompt}</span>
              </span>
              <span className="kartu-panah">
                <IconArrowRight size={15} />
              </span>
            </button>
          ))}
        </div>

        <div className="beranda-kepala">
          <h3>
            <IconStar size={17} /> Key Features
          </h3>
        </div>
        <div className="fitur-utama">
          {FITUR_UTAMA.map((f) => (
            <div key={f.judul} className={`kartu-fitur ${f.warna}`}>
              <span className={`tile-ikon ${f.warna}`}>{f.ikon}</span>
              <span>
                <strong>{f.judul}</strong>
                <span>{f.ket}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <aside className="beranda-kanan">
        <div className="beranda-cari">
          <IconSearch size={16} />
          <input
            ref={cariRef}
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder="Search files, conversations, or topics..."
            maxLength={100}
          />
          {cari ? (
            <button className="btn-mini" onClick={() => setCari('')} title="Clear">
              <IconClose size={13} />
            </button>
          ) : (
            <kbd>Ctrl K</kbd>
          )}
          {hasilCari && (
            <div className="hasil-cari">
              {hasilCari.sesi.length === 0 && hasilCari.berkas.length === 0 && (
                <div className="hasil-kosong">Nothing matches “{cari.trim()}”.</div>
              )}
              {hasilCari.sesi.map((s) => (
                <button key={s.id} onClick={() => onOpenSession(s)}>
                  <IconChat size={15} /> <span>{s.title}</span>
                </button>
              ))}
              {hasilCari.berkas.map((b) => (
                <button key={b.path} onClick={() => void buka(b, 'buka')} title={b.path}>
                  <TileBerkas jenis={b.jenis} /> <span>{b.nama}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="kartu-panel">
          <div className="kartu-panel-kepala">
            <h4>
              <IconFolder size={16} /> Recent Files
            </h4>
            {(berkas?.length ?? 0) > 5 && (
              <button className="beranda-tautan" onClick={() => setSemuaBerkas((x) => !x)}>
                {semuaBerkas ? 'Show less' : 'View all'}
              </button>
            )}
          </div>
          {galatBerkas && <div className="berkas-galat">{galatBerkas}</div>}
          {berkas === null ? (
            <p className="panel-kosong">Loading…</p>
          ) : berkas.length === 0 ? (
            <p className="panel-kosong">
              No files yet. Reports, Excel files, presentations and images AIRA creates for you will appear here.
            </p>
          ) : (
            <ul className="daftar-berkas">
              {berkasTampil.map((b) => (
                <li key={b.path}>
                  <button className="berkas-utama" onClick={() => void buka(b, 'buka')} title={b.path}>
                    <TileBerkas jenis={b.jenis} />
                    <span>
                      <strong>{b.nama}</strong>
                      <span>Created {sejak(b.dibuat)}</span>
                    </span>
                  </button>
                  <button
                    className="btn-mini"
                    title="More options"
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenuBerkas((m) => (m === b.path ? null : b.path))
                    }}
                  >
                    <IconMore size={16} />
                  </button>
                  {menuBerkas === b.path && (
                    <div className="menu-berkas" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => void buka(b, 'buka')}>Open</button>
                      <button onClick={() => void buka(b, 'folder')}>Show in folder</button>
                      <button
                        onClick={() => {
                          setMenuBerkas(null)
                          const s = sessions.find((x) => x.id === b.sessionId)
                          if (s) onOpenSession(s)
                        }}
                        disabled={!sessions.some((x) => x.id === b.sessionId)}
                      >
                        Open its conversation
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="kartu-panel">
          <div className="kartu-panel-kepala">
            <h4>
              <IconBulb size={16} /> Usage Tips
            </h4>
          </div>
          <ul className="daftar-tips">
            {TIPS.map((t) => (
              <li key={t.judul}>
                <span className="tile-tips">{t.ikon}</span>
                <span>
                  <strong>{t.judul}</strong>
                  <span>{t.ket}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        {!bantuanDitutup && (
          <div className="kartu-bantuan">
            <span className="bantuan-ikon">
              <IconHelp size={22} />
            </span>
            <span>
              <strong>Need help?</strong>
              <span>See the full AIRA guide or contact the IT team.</span>
              <button className="beranda-tautan" onClick={onPanduan}>
                Open Guide <IconArrowRight size={14} />
              </button>
            </span>
            <button
              className="btn-mini bantuan-tutup"
              title="Close"
              onClick={() => {
                setBantuanDitutup(true)
                try {
                  localStorage.setItem(KUNCI_BANTUAN, '1')
                } catch {
                  /* tidak tersimpan — muncul lagi lain kali, tidak apa-apa */
                }
              }}
            >
              <IconClose size={14} />
            </button>
          </div>
        )}
      </aside>
    </div>
  )
}
