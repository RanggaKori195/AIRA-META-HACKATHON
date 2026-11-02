import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type {
  AksiPemantau,
  AuthSession,
  ChatMode,
  Attachment,
  ChatMessage,
  ModelChoice,
  SessionMeta,
  SetupState,
  ToolActivity
} from '@shared/ipc'
import Login from './views/Login'
import Setup from './views/Setup'
import Home from './views/Home'
import Chat from './views/Chat'
import Settings from './views/Settings'
import { SpandukPembaruan } from './components/Pembaruan'
import SalesHome from './views/SalesHome'
import InnoHome from './views/InnoHome'
import LabHome from './views/LabHome'
import DriveHome from './views/DriveHome'
import Feedback from './views/Feedback'
import Panduan from './views/Panduan'
import Gambar from './views/Gambar'
import Pustaka from './views/Pustaka'
import Jadwal from './views/Jadwal'
import type { CredentialRequest } from './components/CredentialCard'
import ConfirmDialog from './components/ConfirmDialog'
import { ChatRekan } from './components/ChatRekan'
import {
  IconArrowRight,
  IconBook,
  IconFileText,
  IconHome,
  IconSparkle,
  IconCalendar,
  IconLibrary,
  IconChart,
  IconClose,
  IconDatabase,
  IconInbox,
  IconLogout,
  IconFolder,
  IconImage,
  IconPlus,
  IconSearch,
  IconSettings,
  IconTrash
} from './components/Icons'
import logo from './assets/aira-mark.png'
import { afterClosingEvent, afterSessionDeleted } from './run-state'
import { aksiBoleh } from './components/pemantau-bantu'

/** Jumlah percakapan yang tampil di sidebar sebelum "Lihat semua percakapan". */
const SESI_RINGKAS = 6

type Phase = 'loading' | 'setup' | 'login' | 'ready'

/** Layar selain percakapan. Bukan `ChatMode` — tidak ada satu pun yang mengirim apa pun ke model. */
type Layar = 'chat' | 'settings' | 'feedback' | 'panduan' | 'gambar' | 'pustaka' | 'jadwal'

const ROLE_LABELS: Record<AuthSession['role'], string> = {
  super_admin: 'Super Admin',
  direktur: 'Direktur',
  manager: 'Manager',
  spv: 'SPV',
  staff: 'Staff'
}

export interface PendingApproval {
  requestId: string
  messageId: string
  sessionId: string
  activity: ToolActivity
  detail: string
}

export default function App(): JSX.Element {
  const [phase, setPhase] = useState<Phase>('loading')
  const [setup, setSetup] = useState<SetupState | null>(null)
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  /** Sidebar hanya menampilkan beberapa percakapan terakhir; sisanya di balik "Lihat semua". */
  const [semuaSesi, setSemuaSesi] = useState(false)
  const [workspace, setWorkspace] = useState<string[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  // Run yang sedang berjalan disimpan BESERTA sesinya. Dulu hanya messageId, sehingga
  // saat riwayat dihapus tidak ada cara tahu run itu milik sesi yang mana — akibatnya
  // penanda "sedang streaming" tertinggal menyala dan composer terkunci di tombol Stop.
  const [streaming, setStreaming] = useState<{ messageId: string; sessionId: string } | null>(null)
  const streamingId = streaming?.messageId ?? null
  const [streamError, setStreamError] = useState<string | null>(null)
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null)
  /**
   * Layar yang sedang tampil selain percakapan.
   *
   * ⚠️ SATU state, bukan satu boolean per layar. Dengan boolean terpisah, setiap
   * layar baru harus diingat untuk dimatikan di SEMUA tempat yang membuka layar
   * lain — dan yang terlupa menghasilkan dua layar yang merasa sama-sama aktif.
   * Pemanggil lama (`setShowSettings(false)` dst.) tetap bekerja lewat
   * pembungkus di bawah: mematikan satu layar hanya mengembalikan ke percakapan
   * bila layar ITULAH yang sedang tampil.
   */
  const [layar, setLayar] = useState<Layar>('chat')
  const showSettings = layar === 'settings'
  const showFeedback = layar === 'feedback'
  const showPanduan = layar === 'panduan'
  const setelLayar = useCallback(
    (nama: Layar) => (nyala: boolean) =>
      setLayar((kini) => (nyala ? nama : kini === nama ? 'chat' : kini)),
    []
  )
  const setShowSettings = useMemo(() => setelLayar('settings'), [setelLayar])
  const setShowFeedback = useMemo(() => setelLayar('feedback'), [setelLayar])
  const setShowPanduan = useMemo(() => setelLayar('panduan'), [setelLayar])
  /**
   * Menu "Masukan & Usulan". Bukan `ChatMode` — ia tidak mengirim apa pun ke
   * model, jadi menumpangkannya ke `mode` berarti menambah nilai yang harus
   * diperiksa di setiap guard mode di main process tanpa alasan.
   */

  /**
   * Layar "Panduan". Sama seperti Masukan: BUKAN `ChatMode`, dan sengaja TIDAK
   * dijaga `session.menu` — orang yang paling butuh panduan adalah orang yang
   * izinnya paling belum diatur. Bantuan yang perlu izin untuk dibuka adalah
   * bantuan yang hilang tepat pada orang yang mencarinya.
   */

  // Konfirmasi hapus riwayat. DULU memakai window.confirm() — dialog modal native itu
  // menjalankan nested message loop yang memblokir main process, dan di Windows jendela
  // induknya butuh beberapa detik untuk mendapatkan fokus input kembali. Gejalanya:
  // sesudah klik Yes, kotak chat tidak bisa dipakai selama beberapa detik lalu pulih
  // sendiri. Dialog di dalam aplikasi tidak memblokir apa pun.
  const [confirmDelete, setConfirmDelete] = useState<SessionMeta | null>(null)
  const [mode, setMode] = useState<ChatMode>('general')
  const [session, setSession] = useState<AuthSession | null>(null)
  const [authReady, setAuthReady] = useState(true)
  /** Diisi saat sesi dicabut di tengah jalan, supaya user tahu kenapa ia terlempar keluar. */
  const [authNotice, setAuthNotice] = useState<string | null>(null)

  const startMode = useCallback((next: ChatMode) => {
    setMode(next)
    setLayar('chat')
    setActiveSessionId(null)
    setMessages([])
    setStreamError(null)
  }, [])

  // --- Pemantau proaktif: klik notifikasi / riwayat peringatan --------------------
  /** Pertanyaan lanjutan untuk layar awal menu — MENGISI kotak, tidak dikirim. */
  const [isiAwal, setIsiAwal] = useState<{ teks: string; kunci: number } | null>(null)
  /** Settings dibuka dari klik notifikasi: gulir ke kartu Pemantau. */
  const [fokusPemantau, setFokusPemantau] = useState(false)
  // Langganan event dibuat sekali; sesi TERBARU dibaca lewat ref (menu bisa dicabut
  // sesudah notifikasinya muncul).
  const sesiRef = useRef<AuthSession | null>(null)
  useEffect(() => {
    sesiRef.current = session
  }, [session])
  const jalankanAksiPemantau = useCallback(
    (aksi: AksiPemantau) => {
      const s = sesiRef.current
      if (!s || !aksiBoleh(aksi, s.menu)) return
      if (aksi.tujuan === 'panel') {
        setFokusPemantau(true)
        setLayar('settings')
        return
      }
      startMode(aksi.mode)
      setIsiAwal({ teks: aksi.tanya, kunci: Date.now() })
    },
    [startMode]
  )
  useEffect(() => window.aira.onPemantauBuka(jalankanAksiPemantau), [jalankanAksiPemantau])
  useEffect(() => {
    if (layar !== 'settings') setFokusPemantau(false)
  }, [layar])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [modelChoice, setModelChoice] = useState<ModelChoice>('auto')
  const [pendingCredential, setPendingCredential] = useState<CredentialRequest | null>(null)

  const handleCredential = useCallback(
    (requestId: string, value: { username: string; password: string; remember: boolean } | null) => {
      setPendingCredential(null)
      void window.aira.submitCredential({ requestId, value })
    },
    []
  )

  const handleModelChoice = useCallback((choice: ModelChoice) => {
    setModelChoice(choice)
    void window.aira.setModelChoice(choice)
  }, [])

  const handleAttach = useCallback(() => {
    void window.aira.pickAttachments().then((added) => setAttachments((prev) => [...prev, ...added]))
  }, [])

  const handleDropFiles = useCallback((paths: string[]) => {
    void window.aira.addAttachments(paths).then((added) => setAttachments((prev) => [...prev, ...added]))
  }, [])

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }, [])

  const refreshSessions = useCallback(async () => {
    setSessions(await window.aira.listSessions())
  }, [])

  // Subscription event dibuat sekali seumur hidup komponen, jadi ia tidak bisa membaca
  // state terbaru lewat closure. Ref ini yang dipakai untuk tahu sesi mana yang sedang
  // dilihat user saat sebuah event datang.
  const activeSessionRef = useRef<string | null>(null)
  useEffect(() => {
    activeSessionRef.current = activeSessionId
  }, [activeSessionId])

  /** Data yang hanya masuk akal dimuat setelah ada user yang login. */
  const muatRuangKerja = useCallback(async () => {
    void refreshSessions()
    setWorkspace(await window.aira.listWorkspace())
    setModelChoice(await window.aira.getModelChoice())
  }, [refreshSessions])

  useEffect(() => {
    let batal = false
    void (async () => {
      const state = await window.aira.getSetupState()
      if (batal) return
      setSetup(state)
      if (!state.configured) {
        setPhase('setup')
        return
      }

      // Penyiapan login (migrasi skema + pemulihan sesi) berjalan di latar main
      // process dan bisa selesai sebelum ATAU sesudah jendela ini memuat. Karena
      // itu keadaannya ditanyakan berulang alih-alih menunggu event: event yang
      // dikirim sebelum kita sempat berlangganan akan hilang tanpa jejak.
      for (let i = 0; i < 60; i++) {
        const auth = await window.aira.getAuthState()
        if (batal) return
        if (auth.initialized) {
          setAuthReady(auth.ready)
          if (auth.session) {
            setSession(auth.session)
            setPhase('ready')
            void muatRuangKerja()
          } else {
            setPhase('login')
          }
          return
        }
        await new Promise((r) => setTimeout(r, 400))
      }
      // Tidak pernah selesai dalam 24 detik — tampilkan layar login dengan sebabnya,
      // jangan biarkan user menatap "Memuat AIRA…" tanpa akhir.
      if (!batal) {
        setAuthReady(false)
        setPhase('login')
      }
    })()
    return () => {
      batal = true
    }
  }, [muatRuangKerja])

  // Sesi dicabut di tengah jalan: user diblokir Super Admin, atau masa berlaku
  // akunnya habis saat aplikasi sedang terbuka.
  useEffect(() => {
    return window.aira.onAuthRevoked(() => {
      setSession(null)
      setPhase('login')
      setActiveSessionId(null)
      setMessages([])
      setStreaming(null)
      setShowSettings(false)
      setAuthNotice(
        'Sesi kamu berakhir — akun diblokir atau masa berlakunya habis. Hubungi Super Admin.'
      )
    })
  }, [])

  // Menu/divisi/role berubah saat aplikasi terbuka — Super Admin mengubah matriks,
  // atau revalidasi 5 menit menemukan perubahan. Dulu daftar menu di sini dipegang
  // dari saat login selamanya: menu yang baru dibuka tidak muncul, yang dicabut
  // tetap tampil lalu ditolak "tidak berizin" saat dipakai.
  useEffect(() => {
    return window.aira.onAuthSessionChanged((s) => {
      setSession(s)
    })
  }, [])

  // Menu yang sedang dibuka dicabut: layar awal menu itu tidak boleh tertinggal
  // (kotak tanyanya pasti ditolak). Percakapan yang SEDANG dibuka dibiarkan —
  // isinya tetap boleh dibaca, dan mengirim pesan baru ditolak dengan sebabnya.
  useEffect(() => {
    if (!session || mode === 'general') return
    if (!session.menu.includes(mode) && activeSessionId === null) setMode('general')
  }, [session, mode, activeSessionId])

  const handleLogout = useCallback(async () => {
    await window.aira.logout()
    setSession(null)
    setPhase('login')
    setActiveSessionId(null)
    setMessages([])
    setStreaming(null)
    setShowSettings(false)
    setMode('general')
    setAuthNotice(null)
  }, [])

  // Satu subscription global untuk event streaming dari main process.
  useEffect(() => {
    return window.aira.onChatEvent((event) => {
      if (event.type === 'reset') {
        setMessages((prev) =>
          prev.map((m) => (m.id === event.messageId ? { ...m, content: '', reasoning: null } : m))
        )
      } else if (event.type === 'reasoning' || event.type === 'content') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === event.messageId
              ? event.type === 'content'
                ? { ...m, content: m.content + event.delta }
                : { ...m, reasoning: (m.reasoning ?? '') + event.delta }
              : m
          )
        )
      } else if (event.type === 'visual') {
        setMessages((prev) =>
          prev.map((m) => (m.id === event.messageId ? { ...m, visual: event.visual } : m))
        )
      } else if (event.type === 'dashboard') {
        setMessages((prev) =>
          prev.map((m) => (m.id === event.messageId ? { ...m, dashboard: event.dashboard } : m))
        )
      } else if (event.type === 'tool_start') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === event.messageId ? { ...m, toolLog: [...(m.toolLog ?? []), event.activity] } : m
          )
        )
      } else if (event.type === 'tool_end') {
        setPendingApproval((p) => (p && p.activity.callId === event.callId ? null : p))
        setMessages((prev) =>
          prev.map((m) =>
            m.id === event.messageId
              ? {
                  ...m,
                  toolLog: (m.toolLog ?? []).map((a) =>
                    a.callId === event.callId
                      ? {
                          ...a,
                          status: event.status,
                          resultSummary: event.resultSummary,
                          outputPath: event.outputPath
                        }
                      : a
                  )
                }
              : m
          )
        )
      } else if (event.type === 'credential_request') {
        setPendingCredential({
          requestId: event.requestId,
          sessionId: event.sessionId,
          credentialName: event.credentialName,
          url: event.url
        })
      } else if (event.type === 'approval') {
        setPendingApproval({
          requestId: event.requestId,
          messageId: event.messageId,
          sessionId: event.sessionId,
          activity: event.activity,
          detail: event.detail
        })
        setMessages((prev) =>
          prev.map((m) =>
            m.id === event.messageId
              ? {
                  ...m,
                  toolLog: (m.toolLog ?? []).map((a) =>
                    a.callId === event.activity.callId ? { ...a, status: 'awaiting_approval' } : a
                  )
                }
              : m
          )
        )
      } else if (event.type === 'done' || event.type === 'error') {
        // Event penutup hanya boleh mematikan run yang memang miliknya. Dulu ini
        // tidak dicek, jadi run lama yang selesai belakangan (mis. sesinya sudah
        // dihapus) ikut mematikan indikator percakapan yang sedang berjalan.
        setStreaming((cur) => afterClosingEvent(cur, event.messageId))
        setPendingApproval((p) => afterSessionDeleted(p, event.sessionId))
        setPendingCredential((c) => afterSessionDeleted(c, event.sessionId))
        if (event.type === 'done') {
          void refreshSessions()
          // Grant folder bisa terjadi di tengah run — sinkronkan sidebar.
          void window.aira.listWorkspace().then(setWorkspace)
        } else if (event.sessionId === activeSessionRef.current) {
          // Error dari sesi lain tidak boleh muncul sebagai banner di layar ini.
          setStreamError(`${event.code}: ${event.message}`)
        }
      }
    })
  }, [refreshSessions])

  const openSession = useCallback(
    async (sesi: SessionMeta) => {
      setActiveSessionId(sesi.id)
      // ⚠️ MODE IKUT PERCAKAPANNYA, bukan menu yang sedang aktif.
      //
      // Dilaporkan user 21 Agu 2026: membuka percakapan Task Baru dari riwayat
      // sementara menu Master Data aktif membuat AIRA menjawab sebagai asisten
      // master data dan menolak menulis kode. Sorotan menu di sidebar juga ikut
      // salah, jadi tidak ada satu pun petunjuk di layar bahwa modenya berbeda.
      //
      // Ini perbaikan sisi TAMPILAN — yang menegakkan tetap main process
      // (`sendChat` memakai mode tersimpan). Keduanya perlu: tanpa yang ini,
      // menu yang tersorot berbohong tentang apa yang sebenarnya berjalan.
      setMode(sesi.mode)
      // Membuka riwayat harus benar-benar pindah layar. Tanpa ini, mengklik sebuah
      // percakapan sementara menu Masukan terbuka tidak mengubah apa pun di layar —
      // terlihat seperti tombol yang mati.
      setLayar('chat')
      setStreamError(null)
      setMessages(await window.aira.getMessages(sesi.id))
    },
    []
  )

  /**
   * @param paksaModeBaru Dipakai layar Panduan: contoh pertanyaannya milik menu
   *   tertentu, jadi ia harus membuka PERCAKAPAN BARU di mode itu. Tanpa ini,
   *   `mode` dan `activeSessionId` yang terbaca di sini masih nilai lama (state
   *   React baru berubah pada render berikutnya) — akibatnya pertanyaan menu
   *   Sales menempel di percakapan yang sedang terbuka, dengan mode yang salah.
   */
  const handleSend = useCallback(
    async (text: string, paksaModeBaru?: ChatMode) => {
      setStreamError(null)
      const sent = attachments
      setAttachments([])
      const result = await window.aira.sendChat({
        sessionId: paksaModeBaru ? null : activeSessionId,
        text,
        attachments: sent,
        mode: paksaModeBaru ?? mode
      })
      const annotations = sent
        .map((a) =>
          a.kind === 'image' ? `[Gambar terlampir: ${a.name}]` : `[File terlampir: ${a.name}]`
        )
        .join('\n')
      const now = Date.now()
      const userMsg: ChatMessage = {
        id: result.userMessageId,
        sessionId: result.sessionId,
        role: 'user',
        content: annotations ? `${text}\n\n${annotations}` : text,
        reasoning: null,
        toolLog: null,
        modelUsed: null,
        createdAt: now
      }
      const assistantMsg: ChatMessage = {
        id: result.assistantMessageId,
        sessionId: result.sessionId,
        role: 'assistant',
        content: '',
        reasoning: null,
        toolLog: null,
        modelUsed: result.modelUsed,
        createdAt: now
      }
      setMessages((prev) =>
        !paksaModeBaru && activeSessionId === result.sessionId
          ? [...prev, userMsg, assistantMsg]
          : [userMsg, assistantMsg]
      )
      setActiveSessionId(result.sessionId)
      setStreaming({ messageId: result.assistantMessageId, sessionId: result.sessionId })
      void refreshSessions()
    },
    [activeSessionId, attachments, mode, refreshSessions]
  )

  const handleStop = useCallback(() => {
    if (streamingId) void window.aira.cancelChat(streamingId)
  }, [streamingId])

  /**
   * "Coba lagi" — mengulang giliran terakhir yang gagal.
   *
   * Giliran gagalnya DIBUANG di main process, lalu pertanyaan yang sama
   * dikirim ulang. Pesan di layar dimuat ulang dari database (bukan disusun
   * sendiri di sini) supaya yang tampil persis sama dengan yang tersimpan —
   * termasuk hilangnya jawaban setengah jadi tadi.
   */
  const handleRetry = useCallback(async () => {
    const sessionId = activeSessionRef.current
    if (!sessionId) return
    setStreamError(null)
    try {
      const result = await window.aira.retryChat(sessionId)
      setMessages(await window.aira.getMessages(result.sessionId))
      setStreaming({ messageId: result.assistantMessageId, sessionId: result.sessionId })
      void refreshSessions()
    } catch (err) {
      setStreamError(err instanceof Error ? err.message : String(err))
    }
  }, [refreshSessions])

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      setConfirmDelete(null)
      const remaining = await window.aira.deleteSession(sessionId)
      setSessions(remaining)
      // Run milik sesi ini sudah dihentikan di main process, tapi state di layar harus
      // ikut dibersihkan — kalau tidak, composer tetap terkunci menampilkan tombol Stop
      // dan pesan tidak bisa dikirim.
      setStreaming((cur) => afterSessionDeleted(cur, sessionId))
      setPendingApproval((p) => afterSessionDeleted(p, sessionId))
      setPendingCredential((c) => afterSessionDeleted(c, sessionId))
      if (sessionId === activeSessionRef.current) {
        setActiveSessionId(null)
        setMessages([])
        setStreamError(null)
      }
    },
    []
  )

  const handleApprove = useCallback((requestId: string, approved: boolean) => {
    setPendingApproval((p) => (p && p.requestId === requestId ? null : p))
    void window.aira.approve({ requestId, approved })
  }, [])

  if (phase === 'loading') {
    return (
      <div className="app">
        <div className="loading-screen">Memuat AIRA…</div>
      </div>
    )
  }

  if (phase === 'setup' || !setup) {
    return (
      <div className="app">
        <Setup
          defaults={setup}
          onDone={(state) => {
            setSetup(state)
            // Konfigurasi gateway selesai bukan berarti sudah login — gerbangnya
            // masih di depan.
            setPhase('login')
          }}
        />
      </div>
    )
  }

  if (phase === 'login' || !session) {
    return (
      <div className="app">
        {authNotice && <div className="auth-notice">{authNotice}</div>}
        <Login
          ready={authReady}
          onLoggedIn={(s) => {
            setSession(s)
            setAuthNotice(null)
            setPhase('ready')
            void muatRuangKerja()
          }}
        />
      </div>
    )
  }

  /** "Beranda" = layar Task Baru yang masih kosong (belum ada percakapan terbuka). */
  const beranda = layar === 'chat' && mode === 'general' && activeSessionId === null

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img src={logo} alt="" />
          <div className="brand-teks">
            <strong>AIRA</strong>
            <span>AI Lab Assistant</span>
          </div>
        </div>
        <button className="btn-new" onClick={() => startMode('general')}>
          <IconPlus size={16} /> Task Baru <IconSparkle size={15} />
        </button>
        {/*
          Alat kerja di luar percakapan (ala "Images" di Codex). Terbuka untuk
          semua role — tidak menyentuh data penjualan/master sama sekali.
        */}
        <div className="menu-alat">
          <button
            className={`menu-item ${beranda ? 'active' : ''}`}
            onClick={() => startMode('general')}
            title="Halaman utama AIRA"
          >
            <IconHome size={16} /> Beranda
          </button>
          <button
            className={`menu-item ${layar === 'gambar' ? 'active' : ''}`}
            onClick={() => setLayar('gambar')}
            title="Buat gambar dengan AIRA dan lihat semua gambarmu"
          >
            <IconImage size={16} /> Gambar
          </button>
          <button
            className={`menu-item ${layar === 'jadwal' ? 'active' : ''}`}
            onClick={() => setLayar('jadwal')}
            title="Tugas yang dijalankan AIRA sendiri pada jam tertentu"
          >
            <IconCalendar size={16} /> Jadwal
          </button>
          <button
            className={`menu-item ${layar === 'pustaka' ? 'active' : ''}`}
            onClick={() => setLayar('pustaka')}
            title="Semua berkas yang pernah dibuat AIRA untukmu"
          >
            <IconLibrary size={16} /> Pustaka
          </button>
        </div>
        {/*
          Tombol disembunyikan mengikuti izin role. Ini KENYAMANAN, bukan
          penguncian — `chatSend` di main process menolak mode yang tidak
          diizinkan, jadi tombol yang tidak tampil bukan satu-satunya penghalang.
        */}
        {session.menu.includes('sales') && (
          <button
            className={`menu-item ${layar === 'chat' && mode === 'sales' ? 'active' : ''}`}
            onClick={() => startMode('sales')}
            title="Tanya data penjualan langsung dari database"
          >
            <IconChart size={16} /> Tanya Data Sales
          </button>
        )}
        {session.menu.includes('masterdata') && (
          <button
            className={`menu-item ${layar === 'chat' && mode === 'masterdata' ? 'active' : ''}`}
            onClick={() => startMode('masterdata')}
            title="Tanya master data the lab: pelanggan, item, harga, special price, PKS, dokter"
          >
            <IconDatabase size={16} /> Ask Master Data
          </button>
        )}
        {session.menu.includes('lab') && (
          <button
            className={`menu-item ${layar === 'chat' && mode === 'lab' ? 'active' : ''}`}
            onClick={() => startMode('lab')}
            title="Perjalanan sampel: backlog, tahap, TAT, dan RNS"
          >
            <IconSearch size={16} /> Tanya TAT Sample
          </button>
        )}
        {session.menu.includes('onedrive') && (
          <button
            className={`menu-item ${layar === 'chat' && mode === 'onedrive' ? 'active' : ''}`}
            onClick={() => startMode('onedrive')}
            title="Berkas OneDrive & SharePoint, email Outlook, dan kalender"
          >
            <IconFolder size={16} /> Tanya Microsoft 365
          </button>
        )}
        {/*
          Menu masukan TIDAK dijaga `session.menu` — sengaja terlihat semua role.
          Ia justru dipakai untuk melaporkan bahwa sesuatu tidak jalan, termasuk
          "menu saya tidak muncul"; kalau aksesnya sendiri diatur matriks role ×
          divisi, ia hilang tepat pada orang yang paling perlu melapor.
        */}
        <button
          className={`menu-item ${showFeedback ? 'active' : ''}`}
          onClick={() => {
            setShowFeedback(true)
            setShowSettings(false)
            setShowPanduan(false)
          }}
          title="Kirim bug, usulan fitur, atau pertanyaan yang belum bisa dijawab AIRA"
        >
          <IconInbox size={16} /> Masukan &amp; Usulan
        </button>
        {/*
          Panduan — terbuka untuk SEMUA role, sama alasannya dengan Masukan.
          Ditaruh tepat di atas daftar riwayat supaya terlihat orang baru: ia
          bagian dari "tempat memulai", bukan pelengkap di kaki jendela.
        */}
        <button
          className={`menu-item ${showPanduan ? 'active' : ''}`}
          onClick={() => {
            setShowPanduan(true)
            setShowFeedback(false)
            setShowSettings(false)
          }}
          title="Cara memakai AIRA: menu, berkas, laporan, dan batasnya"
        >
          <IconBook size={16} /> Panduan
        </button>
        <div className="session-list">
          {(semuaSesi ? sessions : sessions.slice(0, SESI_RINGKAS)).map((s) => (
            <div key={s.id} className="session-row">
              <button
                className={`session-item ${s.id === activeSessionId ? 'active' : ''}`}
                onClick={() => void openSession(s)}
                title={s.title}
              >
                <IconFileText size={14} />
                <span>{s.title}</span>
              </button>
              <button
                className="btn-mini btn-del"
                title="Hapus riwayat ini"
                onClick={() => setConfirmDelete(s)}
              >
                <IconTrash size={14} />
              </button>
            </div>
          ))}
          {sessions.length > SESI_RINGKAS && (
            <button className="lihat-semua-sesi" onClick={() => setSemuaSesi((x) => !x)}>
              {semuaSesi ? 'Tampilkan lebih sedikit' : 'Lihat semua percakapan'} <IconArrowRight size={13} />
            </button>
          )}
        </div>
        <div className="workspace">
          <div className="workspace-head">
            <span>Folder Akses</span>
            <button
              className="btn-mini"
              title="Tambah folder yang boleh diakses AIRA"
              onClick={() => void window.aira.addWorkspace().then(setWorkspace)}
            >
              <IconPlus size={14} />
            </button>
          </div>
          {workspace.length === 0 && <div className="workspace-empty">Belum ada folder</div>}
          {workspace.map((dir) => (
            <div key={dir} className="workspace-item" title={dir}>
              <span>{dir}</span>
              <button
                className="btn-mini"
                title="Cabut akses"
                onClick={() => void window.aira.removeWorkspace(dir).then(setWorkspace)}
              >
                <IconClose size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="user-bar" title={`Masuk sebagai ${session.username}`}>
          <span className="avatar">{session.username.slice(0, 2).toUpperCase()}</span>
          <div className="user-bar-id">
            <strong>{session.username}</strong>
            <span>{ROLE_LABELS[session.role]}</span>
          </div>
          <button
            className={`btn-mini ${showSettings ? 'aktif' : ''}`}
            title="Settings"
            onClick={() => {
              setShowSettings(true)
              setShowFeedback(false)
            }}
          >
            <IconSettings size={16} />
          </button>
          <button className="btn-mini" title="Keluar dari AIRA" onClick={() => void handleLogout()}>
            <IconLogout size={15} />
          </button>
        </div>
        <div className="footer">
          <span>
            {setup.modelId} · {new URL(setup.endpoint).host}
          </span>
        </div>
      </aside>

      {confirmDelete && (
        <ConfirmDialog
          title="Hapus riwayat ini?"
          body={confirmDelete.title}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void handleDeleteSession(confirmDelete.id)}
        />
      )}

      {showSettings ? (
        <Settings
          onBack={() => setShowSettings(false)}
          sesi={session}
          fokusPemantau={fokusPemantau}
          onAksiPemantau={jalankanAksiPemantau}
        />
      ) : layar === 'gambar' ? (
        <Gambar onPanduan={() => setShowPanduan(true)} />
      ) : layar === 'pustaka' ? (
        <Pustaka
          onBukaSesi={(id) => {
            const ada = sessions.find((x) => x.id === id)
            if (!ada) return false
            setLayar('chat')
            void openSession(ada)
            return true
          }}
        />
      ) : layar === 'jadwal' ? (
        <Jadwal
          menu={session.menu}
          onBukaSesi={(id, m) => {
            // Percakapan hasil jadwal dibuka seperti dari riwayat. Metadata
            // lengkapnya tidak dibutuhkan `openSession` selain id & mode.
            const ada = sessions.find((x) => x.id === id)
            setLayar('chat')
            void openSession(ada ?? { id, title: '', createdAt: 0, updatedAt: 0, mode: m })
          }}
        />
      ) : showPanduan ? (
        <Panduan
          onAjukan={(m, teks) => { startMode(m); void handleSend(teks, m) }}
          onMasukan={() => setShowFeedback(true)}
        />
      ) : showFeedback ? (
        <Feedback />
      ) : activeSessionId === null && mode === 'sales' ? (
        <SalesHome
          onSubmit={handleSend}
          sessions={sessions}
          onOpenSession={(x) => void openSession(x)}
          onPanduan={() => setShowPanduan(true)}
          isiAwal={isiAwal}
          onIsiTerpakai={() => setIsiAwal(null)}
        />
      ) : activeSessionId === null && mode === 'masterdata' ? (
        <InnoHome
          onSubmit={handleSend}
          sessions={sessions}
          onOpenSession={(x) => void openSession(x)}
          onPanduan={() => setShowPanduan(true)}
        />
      ) : activeSessionId === null && mode === 'lab' ? (
        <LabHome
          onSubmit={handleSend}
          sessions={sessions}
          onOpenSession={(x) => void openSession(x)}
          onPanduan={() => setShowPanduan(true)}
          isiAwal={isiAwal}
          onIsiTerpakai={() => setIsiAwal(null)}
        />
      ) : activeSessionId === null && mode === 'onedrive' ? (
        <DriveHome
          onSubmit={handleSend}
          sessions={sessions}
          onOpenSession={(x) => void openSession(x)}
        />
      ) : activeSessionId === null ? (
        <Home
          sessions={sessions}
          onOpenSession={(s) => void openSession(s)}
          modelChoice={modelChoice}
          onModelChoice={handleModelChoice}
          workspaceCount={workspace.length}
          attachments={attachments}
          onAttach={handleAttach}
          onDropFiles={handleDropFiles}
          onRemoveAttachment={handleRemoveAttachment}
          onSubmit={handleSend}
          onPanduan={() => {
            setShowPanduan(true)
            setShowFeedback(false)
            setShowSettings(false)
          }}
        />
      ) : (
        <Chat
          mode={mode}
          messages={messages}
          streamingId={streamingId}
          error={streamError}
          // Hanya ada gunanya kalau memang ada percakapan berjalan yang bisa diulang.
          onRetry={activeSessionId && messages.length > 0 ? () => void handleRetry() : null}
          pendingApproval={
            pendingApproval && pendingApproval.sessionId === activeSessionId ? pendingApproval : null
          }
          attachments={attachments}
          modelChoice={modelChoice}
          onModelChoice={handleModelChoice}
          onAttach={handleAttach}
          onDropFiles={handleDropFiles}
          onRemoveAttachment={handleRemoveAttachment}
          pendingCredential={
            pendingCredential && pendingCredential.sessionId === activeSessionId
              ? pendingCredential
              : null
          }
          onCredential={handleCredential}
          onApprove={handleApprove}
          onSend={handleSend}
          onStop={handleStop}
        />
      )}

      {/*
        Chat antar rekan — pojok kanan bawah.
        Hanya saat sudah login: tanpa sesi, main process menolak channelnya
        (`wajibLogin`), dan widget yang selalu gagal lebih buruk daripada widget
        yang tidak ada. Sengaja DI LUAR percabangan layar di atas supaya ia tetap
        ada di layar mana pun — itu gunanya pojok yang menetap.
      */}
      {session && <ChatRekan saya={session.username} />}
      {/* Muncul hanya saat versi baru sudah terunduh (auto-update). */}
      {session && <SpandukPembaruan />}
    </div>
  )
}
