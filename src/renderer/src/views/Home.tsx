import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { Attachment, BerkasTerbaru, ModelChoice, SessionMeta } from '@shared/ipc'
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
import logo from '../assets/aira-logo.png'

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
  { judul: 'Ringkas Dokumen', prompt: 'Ringkas dokumen yang saya lampirkan jadi 5 poin', ikon: <IconFileText size={22} />, warna: 'biru' },
  { judul: 'Buat Presentasi', prompt: 'Buatkan presentasi 8 slide tentang rencana kerja Q4', ikon: <IconPresentation size={22} />, warna: 'ungu' },
  { judul: 'Excel dari PDF', prompt: 'Ambil tabel di PDF ini lalu jadikan Excel', ikon: <IconTable size={22} />, warna: 'hijau' },
  { judul: 'Analisis Data', prompt: 'Dokumen mana di folder kerja saya yang membahas anggaran 2026?', ikon: <IconTrend size={22} />, warna: 'oranye' },
  { judul: 'Notulen Rapat', prompt: 'Buatkan notulen rapat dari catatan kasar ini', ikon: <IconNote size={22} />, warna: 'merah' },
  { judul: 'Buat Script', prompt: 'Tuliskan script untuk merapikan nama file di folder ini', ikon: <IconCode size={22} />, warna: 'nila' }
]

const FITUR_UTAMA = [
  { judul: 'Pahami Dokumen', ket: 'Membaca berbagai format file dengan akurat', ikon: <IconFileText size={20} />, warna: 'hijau' },
  { judul: 'Integrasi Data', ket: 'Mengakses data internal dengan aman', ikon: <IconDatabase size={20} />, warna: 'biru' },
  { judul: 'Analisis Cerdas', ket: 'Memberikan insight dan rekomendasi', ikon: <IconTrend size={20} />, warna: 'ungu' },
  { judul: 'Produktivitas', ket: 'Otomatisasi tugas sehari-hari', ikon: <IconZap size={20} />, warna: 'kuning' }
]

const TIPS = [
  { judul: 'Seret & lepas file', ket: 'Kamu bisa langsung menyeret file ke kolom chat.', ikon: <IconUpload size={18} /> },
  { judul: 'Gunakan perintah jelas', ket: 'Semakin spesifik perintahmu, semakin baik hasilnya.', ikon: <IconSparkle size={18} /> },
  { judul: 'Akses folder kerja', ket: 'Tambahkan folder di sidebar untuk akses cepat.', ikon: <IconFolder size={18} /> },
  { judul: 'Gabungkan sumber data', ket: 'Saya bisa menggabungkan informasi dari beberapa file sekaligus.', ikon: <IconLayers size={18} /> }
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
  const menit = Math.max(0, Math.round((Date.now() - ms) / 60_000))
  if (menit < 1) return 'baru saja'
  if (menit < 60) return `${menit} menit yang lalu`
  const jam = Math.round(menit / 60)
  if (jam < 24) return `${jam} jam yang lalu`
  const hari = Math.round(jam / 24)
  if (hari < 30) return `${hari} hari yang lalu`
  return new Date(ms).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
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
  onOpenSession
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
    onSubmit(trimmed || 'Tolong analisis lampiran ini.')
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
      if (!ok) setGalatBerkas(`${b.nama} tidak bisa dibuka — mungkin sudah dipindah atau dihapus.`)
    } catch {
      setGalatBerkas(`${b.nama} tidak bisa dibuka.`)
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
                <stop offset="0" stopColor="#cfe8d6" stopOpacity="0" />
                <stop offset="0.55" stopColor="#cfe8d6" stopOpacity="0.9" />
                <stop offset="1" stopColor="#e9f5ec" stopOpacity="0.4" />
              </linearGradient>
              <linearGradient id="gel-b" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0" stopColor="#b9dcc3" stopOpacity="0" />
                <stop offset="0.6" stopColor="#b9dcc3" stopOpacity="0.55" />
                <stop offset="1" stopColor="#dff0e4" stopOpacity="0.2" />
              </linearGradient>
              <pattern id="gel-titik" width="14" height="14" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="1.2" fill="#9cc9a8" />
              </pattern>
            </defs>
            <path fill="url(#gel-a)" d="M640 0 H470 C 420 60 470 130 400 200 C 350 250 300 290 260 340 H640 Z" />
            <path fill="url(#gel-b)" d="M640 40 C 560 70 540 150 500 210 C 470 260 420 300 380 340 H640 Z" />
            <path fill="none" stroke="#a8d3b4" strokeOpacity="0.7" strokeWidth="1.2" d="M480 0 C 430 80 480 150 380 230 C 330 270 300 310 280 340" />
            <path fill="none" stroke="#c4e2cc" strokeWidth="1" d="M520 0 C 470 90 520 160 430 240 C 390 280 360 315 345 340" />
            <rect x="190" y="30" width="130" height="120" fill="url(#gel-titik)" opacity="0.5" />
          </svg>
          <div className="hero-teks">
            <span className="hero-lencana">
              <IconSparkle size={14} /> AI Agent Internal the company
            </span>
            <h1>
              Halo, saya <span>AIRA</span> <span className="hero-lambai">👋</span>
            </h1>
            <p>
              Saya siap membantu membaca, mencari, menganalisis, dan merapikan file di folder yang kamu
              izinkan — atau sekadar menjawab pertanyaan.
            </p>
          </div>
          <img className="hero-logo" src={logo} alt="AIRA" />
        </section>

        {workspaceCount === 0 && (
          <p className="beranda-peringatan">
            ⚠ Belum ada folder akses. Tambahkan lewat tombol “+” di bagian Folder Akses (sidebar) supaya
            saya bisa bekerja dengan file kamu.
          </p>
        )}

        <div className="task-box beranda-kotak" {...drop}>
          <AttachBar attachments={attachments} onRemove={onRemoveAttachment} />
          <textarea
            ref={kotak}
            placeholder="Apa yang bisa saya kerjakan hari ini?  (seret file ke sini juga bisa)"
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
              <button className="btn-attach" onClick={onAttach} title="Lampirkan file atau gambar">
                <IconAttach />
              </button>
              {/* Hasil dikte DISISIPKAN ke kotak teks, tidak dikirim otomatis. */}
              <TombolDikte onTeks={(t) => setText((s) => (s.trim() ? `${s.trim()} ${t}` : t))} />
              <ModelPicker value={modelChoice} onChange={onModelChoice} />
            </div>
            <button className="btn-send" disabled={!text.trim() && attachments.length === 0} onClick={submit}>
              Kirim <IconSend size={14} />
            </button>
          </div>
        </div>

        <div className="beranda-kepala">
          <h3>
            <IconZap size={17} /> Mulai Cepat
          </h3>
          <span>Pilih contoh pekerjaan atau gunakan perintahmu sendiri</span>
          {/* Jalan keluar yang TIDAK lewat model — tetap bekerja saat gateway mati. */}
          <button className="beranda-tautan" onClick={onPanduan}>
            Lihat semua <IconArrowRight size={14} />
          </button>
        </div>
        <div className="mulai-cepat">
          {MULAI_CEPAT.map((k) => (
            <button key={k.judul} className="kartu-cepat" onClick={() => isiContoh(k.prompt)} title="Isi ke kotak tugas">
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
            <IconStar size={17} /> Fitur Utama
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
            placeholder="Cari file, percakapan, atau topik..."
            maxLength={100}
          />
          {cari ? (
            <button className="btn-mini" onClick={() => setCari('')} title="Bersihkan">
              <IconClose size={13} />
            </button>
          ) : (
            <kbd>Ctrl K</kbd>
          )}
          {hasilCari && (
            <div className="hasil-cari">
              {hasilCari.sesi.length === 0 && hasilCari.berkas.length === 0 && (
                <div className="hasil-kosong">Tidak ada yang cocok dengan “{cari.trim()}”.</div>
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
              <IconFolder size={16} /> File Terbaru
            </h4>
            {(berkas?.length ?? 0) > 5 && (
              <button className="beranda-tautan" onClick={() => setSemuaBerkas((x) => !x)}>
                {semuaBerkas ? 'Lebih sedikit' : 'Lihat semua'}
              </button>
            )}
          </div>
          {galatBerkas && <div className="berkas-galat">{galatBerkas}</div>}
          {berkas === null ? (
            <p className="panel-kosong">Memuat…</p>
          ) : berkas.length === 0 ? (
            <p className="panel-kosong">
              Belum ada berkas. Laporan, Excel, presentasi, dan gambar yang dibuat AIRA untukmu akan muncul di sini.
            </p>
          ) : (
            <ul className="daftar-berkas">
              {berkasTampil.map((b) => (
                <li key={b.path}>
                  <button className="berkas-utama" onClick={() => void buka(b, 'buka')} title={b.path}>
                    <TileBerkas jenis={b.jenis} />
                    <span>
                      <strong>{b.nama}</strong>
                      <span>Dibuat {sejak(b.dibuat)}</span>
                    </span>
                  </button>
                  <button
                    className="btn-mini"
                    title="Pilihan lain"
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenuBerkas((m) => (m === b.path ? null : b.path))
                    }}
                  >
                    <IconMore size={16} />
                  </button>
                  {menuBerkas === b.path && (
                    <div className="menu-berkas" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => void buka(b, 'buka')}>Buka</button>
                      <button onClick={() => void buka(b, 'folder')}>Tampilkan di folder</button>
                      <button
                        onClick={() => {
                          setMenuBerkas(null)
                          const s = sessions.find((x) => x.id === b.sessionId)
                          if (s) onOpenSession(s)
                        }}
                        disabled={!sessions.some((x) => x.id === b.sessionId)}
                      >
                        Buka percakapannya
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
              <IconBulb size={16} /> Tips Penggunaan
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
              <strong>Butuh bantuan?</strong>
              <span>Lihat panduan lengkap penggunaan AIRA atau hubungi tim IT.</span>
              <button className="beranda-tautan" onClick={onPanduan}>
                Buka Panduan <IconArrowRight size={14} />
              </button>
            </span>
            <button
              className="btn-mini bantuan-tutup"
              title="Tutup"
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
