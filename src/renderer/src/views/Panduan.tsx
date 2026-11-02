import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { ChatMode, PanduanBagian, PanduanBlok } from '@shared/ipc'
import {
  IconAlert,
  IconArrowRight,
  IconBell,
  IconBook,
  IconBulb,
  IconCalendar,
  IconChat,
  IconCheck,
  IconCode,
  IconFileText,
  IconGrid,
  IconHelp,
  IconHistory,
  IconPresentation,
  IconSearch,
  IconStar,
  IconTable
} from '../components/Icons'

// Layar "Panduan" — pusat bantuan AIRA. Tata letak baru 30 Sep 2026 mengikuti
// mockup user: hero + cari, daftar panduan (kiri), satu bagian dibaca (tengah),
// Tips cepat / Topik pilihan / Butuh bantuan (kanan).
//
// ⚠️ Isinya TIDAK ditulis di berkas ini (aturan 61). Yang dirender datang dari main
// process (`panduan:isi`), karena daftar menu berbeda untuk tiap user dan sebagian
// fitur bergantung saklar. Berkas ini hanya memberi IKON, label kategori, dan
// teks pendek daftar isi per `id` — tidak ada klaim kemampuan di sini.
// ⚠️ "Topik populer" di mockup diberi nama "Topik pilihan": tidak ada data
// seberapa sering tiap topik dibuka, jadi "populer" akan jadi klaim karangan.
// "Menulis email profesional" dari mockup tidak dipasang — fitur email M365
// belum tersambung; topik yang ada hanya yang menunjuk ke bagian yang benar ada.

interface Props {
  /** Mengirim contoh pertanyaan ke AIRA pada mode yang benar. */
  onAjukan: (mode: ChatMode, teks: string) => void
  /** Membuka menu Masukan & Usulan. */
  onMasukan: () => void
}

const MODE_LABEL: Record<ChatMode, string> = {
  general: 'New Task',
  sales: 'Ask Sales Data',
  masterdata: 'Ask Master Data',
  lab: 'Ask Sample TAT',
  onedrive: 'Ask Microsoft 365'
}

interface Gaya {
  ikon: (s: number) => JSX.Element
  warna: string
  /** Teks pendek daftar isi (ringkas lengkapnya tetap dari main). */
  sub?: string
  kategori: string
}

const GAYA: Record<string, Gaya> = {
  mulai: { ikon: (s) => <IconPlay size={s} />, warna: 'hijau', sub: 'Introduction and first steps', kategori: 'Basics' },
  menu: { ikon: (s) => <IconGrid size={s} />, warna: 'hijau', sub: 'All menus and what they do', kategori: 'Basics' },
  files: { ikon: (s) => <IconFileText size={s} />, warna: 'oranye', sub: 'Read, summarize, work with content', kategori: 'Files' },
  reports: { ikon: (s) => <IconPresentation size={s} />, warna: 'biru', sub: 'Word, PDF, Excel, PowerPoint', kategori: 'Finished documents' },
  'kerja-lain': { ikon: (s) => <IconCode size={s} />, warna: 'ungu', sub: 'Find information, analysis, and code', kategori: 'Other work' },
  ingatan: { ikon: (s) => <IconHistory size={s} />, warna: 'oranye', sub: 'Old conversations and context', kategori: 'History' },
  schedule: { ikon: (s) => <IconCalendar size={s} />, warna: 'biru', sub: 'Ask AIRA to work automatically', kategori: 'Automation' },
  pemantau: { ikon: (s) => <IconBell size={s} />, warna: 'kuning', sub: 'Automatic alerts', kategori: 'Automation' },
  'suara-chat': { ikon: (s) => <IconChat size={s} />, warna: 'merah', sub: 'Working together and voice input', kategori: 'Collaboration' },
  tips: { ikon: (s) => <IconBulb size={s} />, warna: 'kuning', sub: 'Tips for writing effective questions', kategori: 'Tips' },
  batas: { ikon: (s) => <IconAlert size={s} />, warna: 'merah', sub: 'Limits and what is not available', kategori: 'Limits' },
  masalah: { ikon: (s) => <IconHelp size={s} />, warna: 'nila', sub: 'Wrong answer or missing menu', kategori: 'Help' }
}

const GAYA_LAIN: Gaya = { ikon: (s) => <IconBook size={s} />, warna: 'hijau', kategori: 'Guide' }

const TIPS_CEPAT = [
  'Use clear, specific sentences',
  'Include context (goal, period, format)',
  'Attach the document or say where the file is',
  'You can ask for the result as Word, Excel, PDF, or PowerPoint',
  'If the result is off, ask for a revision with an extra sentence'
]

/** Topik → bagian panduan yang MEMANG ada. Yang bagiannya tidak ada, tidak ditampilkan. */
const TOPIK = [
  { judul: 'How to make a presentation from a document', id: 'reports' },
  { judul: 'Reading and summarizing files', id: 'files' },
  { judul: 'Scheduling a recurring report', id: 'schedule' },
  { judul: 'Finding old conversations', id: 'ingatan' },
  { judul: 'When AIRA’s answer is wrong', id: 'masalah' }
]

function IconPlay({ size = 18 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="currentColor" />
      <path d="M10 8.5v7l5.5-3.5z" fill="#fff" />
    </svg>
  )
}

function IconChevron(): JSX.Element {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

/** Ikon & judul pendek kartu contoh — dikenali dari kata di kalimatnya, bukan ditebak isinya. */
function gayaContoh(q: string): { ikon: JSX.Element; warna: string; judul: string } {
  const k = q.toLowerCase()
  if (/presentation|slide|ppt/.test(k)) return { ikon: <IconPresentation size={20} />, warna: 'oranye', judul: 'Create a presentation' }
  if (/excel|table|chart/.test(k)) return { ikon: <IconTable size={20} />, warna: 'hijau', judul: 'Tidy tables & charts' }
  if (/^(find|search|list)|find |search /.test(k)) return { ikon: <IconSearch size={20} />, warna: 'oranye', judul: 'Find files' }
  if (/summarize|summary|points/.test(k)) return { ikon: <IconFileText size={20} />, warna: 'ungu', judul: 'Summarize a document' }
  if (/sales|revenue/.test(k)) return { ikon: <IconTable size={20} />, warna: 'biru', judul: 'Sales data' }
  if (/schedule|every|weekly|daily/.test(k)) return { ikon: <IconCalendar size={20} />, warna: 'biru', judul: 'Schedule it' }
  return { ikon: <IconChat size={20} />, warna: 'hijau', judul: 'Example question' }
}

/** "Judul. Keterangan…" → judul tebal + keterangan, seperti langkah di mockup. */
function pecahLangkah(teks: string): { judul: string; ket: string } {
  const i = teks.search(/[.:]\s/)
  if (i >= 0 && i <= 90) return { judul: teks.slice(0, i), ket: teks.slice(i + 2) }
  // Tanpa titik: potong di koma pertama yang dekat ("Kalau ada berkas, seret …").
  const k = teks.indexOf(', ')
  if (k > 0 && k <= 40) {
    const ket = teks.slice(k + 2)
    return { judul: teks.slice(0, k), ket: ket.charAt(0).toUpperCase() + ket.slice(1) }
  }
  return { judul: teks, ket: '' }
}

/** Ikon langkah dikenali dari katanya (pilih/tulis/berkas/baca), bukan dari urutan. */
function ikonLangkah(teks: string): JSX.Element {
  const k = teks.toLowerCase()
  if (/pick|click|open/.test(k)) return <IconStar size={18} />
  if (/write|type|sentence/.test(k)) return <IconChat size={18} />
  if (/file|folder|drag|attach/.test(k)) return <IconFileText size={18} />
  if (/read|correct|check/.test(k)) return <IconCheck size={18} />
  return <IconArrowRight size={18} />
}

/** Semua teks sebuah bagian — dipakai kotak cari. */
function teksBagian(b: PanduanBagian): string {
  const isi = b.isi
    .map((blok) => {
      if (blok.jenis === 'paragraf') return blok.teks
      if (blok.jenis === 'contoh') return blok.contoh.join(' ')
      return blok.butir.join(' ')
    })
    .join(' ')
  return `${b.judul} ${b.ringkas} ${b.kunci.join(' ')} ${isi}`.toLowerCase()
}

export default function Panduan({ onAjukan, onMasukan }: Props): JSX.Element {
  const [bagian, setBagian] = useState<PanduanBagian[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cari, setCari] = useState('')
  const [aktif, setAktif] = useState<string | null>(null)
  const kotakCari = useRef<HTMLInputElement>(null)
  const bacaan = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void (async () => {
      try {
        setBagian(await window.aira.panduanIsi())
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })()
  }, [])

  // Ctrl+K memfokuskan kotak cari, seperti yang dijanjikan tulisannya.
  useEffect(() => {
    const tekan = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        kotakCari.current?.focus()
      }
    }
    window.addEventListener('keydown', tekan)
    return () => window.removeEventListener('keydown', tekan)
  }, [])

  const terlihat = useMemo(() => {
    if (!bagian) return []
    const q = cari.trim().toLowerCase()
    if (!q) return bagian
    return bagian.filter((b) => teksBagian(b).includes(q))
  }, [bagian, cari])

  // Bagian yang sedang dibaca hilang karena pencarian — pindahkan sorotan,
  // jangan biarkan daftar isi menyorot sesuatu yang tidak ada di layar.
  useEffect(() => {
    if (terlihat.length > 0 && !terlihat.some((b) => b.id === aktif)) setAktif(terlihat[0].id)
  }, [aktif, terlihat])

  const buka = (id: string): void => {
    setAktif(id)
    bacaan.current?.scrollTo({ top: 0 })
  }

  if (error) {
    return (
      <div className="panduan">
        <div className="panduan-kosong">
          The guide could not be loaded: {error}
          <br />
          Report it through the Feedback menu if it keeps happening.
        </div>
      </div>
    )
  }

  if (!bagian) {
    return (
      <div className="panduan">
        <div className="panduan-kosong">Loading the guide…</div>
      </div>
    )
  }

  const dibaca = terlihat.find((b) => b.id === aktif) ?? null
  const gaya = (id: string): Gaya => GAYA[id] ?? GAYA_LAIN
  const topik = TOPIK.filter((t) => bagian.some((b) => b.id === t.id))

  const tanyaLangsung = (): void => {
    const q = cari.trim()
    onAjukan('general', q ? `How do I ${q} in AIRA?` : 'What can AIRA help me with in my work?')
  }

  return (
    <div className="pdx">
      <header className="pdx-hero">
        <span className="pdx-hero-ikon">
          <IconBook size={28} />
        </span>
        <div className="pdx-hero-teks">
          <span className="pdx-lencana">Help center</span>
          <h1>AIRA Guide</h1>
          <p>
            Find the best way to use AIRA for your everyday work.
            <br />
            The menus mentioned here are the ones actually open to your account.
          </p>
          <div className="pdx-cari">
            <IconSearch size={17} />
            <input
              ref={kotakCari}
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              placeholder="Search the guide… (e.g. ppt, excel, schedule, report)"
              aria-label="Search the guide"
            />
            {cari ? (
              <button className="pdx-cari-hapus" onClick={() => setCari('')} title="Clear">
                ×
              </button>
            ) : (
              <kbd>Ctrl + K</kbd>
            )}
          </div>
        </div>
        {/* Hiasan: gelembung chat, dokumen, kaca pembesar, bola lampu — meniru mockup. */}
        <svg className="pdx-seni" viewBox="0 0 380 190" aria-hidden="true">
          <ellipse cx="300" cy="80" rx="110" ry="90" fill="#d6ecdd" opacity="0.55" />
          <rect x="30" y="80" width="62" height="44" rx="12" fill="#63b27f" />
          <path d="M44 124l-6 14 16-14z" fill="#63b27f" />
          <rect x="44" y="94" width="34" height="5" rx="2.5" fill="#e3f4e8" />
          <rect x="44" y="106" width="24" height="5" rx="2.5" fill="#e3f4e8" />
          <rect x="100" y="30" width="86" height="104" rx="10" fill="#ffffff" stroke="#dcebe1" transform="rotate(-6 143 82)" />
          <rect x="114" y="52" width="56" height="6" rx="3" fill="#dcebe1" transform="rotate(-6 143 82)" />
          <rect x="114" y="66" width="50" height="6" rx="3" fill="#e8f2eb" transform="rotate(-6 143 82)" />
          <rect x="114" y="80" width="40" height="6" rx="3" fill="#e8f2eb" transform="rotate(-6 143 82)" />
          <rect x="210" y="20" width="96" height="150" rx="10" fill="#ffffff" stroke="#dcebe1" />
          <rect x="226" y="44" width="62" height="6" rx="3" fill="#dcebe1" />
          <rect x="226" y="58" width="52" height="6" rx="3" fill="#e8f2eb" />
          <circle cx="226" cy="100" r="30" fill="#eaf6ee" stroke="#2f7d49" strokeWidth="9" />
          <path d="M248 122l22 22" stroke="#2f7d49" strokeWidth="12" strokeLinecap="round" />
          <rect x="296" y="70" width="70" height="96" rx="10" fill="#ffffff" stroke="#dcebe1" transform="rotate(8 331 118)" />
          <path d="M332 60a18 18 0 0 0-10 33v8h20v-8a18 18 0 0 0-10-33z" fill="#8fd0a3" />
          <rect x="324" y="104" width="16" height="5" rx="2" fill="#6cc28a" />
          <path d="M306 50l-8-6M358 50l8-6M332 36v-9" stroke="#8fd0a3" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </header>

      <div className="pdx-badan">
        <nav className="pdx-kartu pdx-nav" aria-label="Guide list">
          <div className="pdx-nav-judul">Guide list</div>
          {terlihat.map((b) => {
            const g = gaya(b.id)
            return (
              <button key={b.id} className={`pdx-nav-item ${b.id === aktif ? 'aktif' : ''}`} onClick={() => buka(b.id)}>
                <span className={`tile-ikon ${g.warna}`}>{g.ikon(18)}</span>
                <span className="pdx-nav-teks">
                  <strong>{b.judul}</strong>
                  <small>{g.sub ?? b.ringkas}</small>
                </span>
                <IconChevron />
              </button>
            )
          })}
          {terlihat.length === 0 && (
            <div className="pdx-nav-kosong">
              No section matches “{cari}”.
              <br />
              Just ask AIRA directly — it reads the same guide.
            </div>
          )}
        </nav>

        <article className="pdx-kartu pdx-bacaan" ref={bacaan}>
          {dibaca ? (
            <>
              <span className="pdx-kategori">{gaya(dibaca.id).kategori}</span>
              <h2>{dibaca.judul}</h2>
              <p className="pdx-ringkas">{dibaca.ringkas}</p>
              {dibaca.isi.map((blok, i) => (
                <Blok key={i} blok={blok} onAjukan={onAjukan} />
              ))}
            </>
          ) : (
            <p className="pdx-ringkas">Pick a guide on the left.</p>
          )}
        </article>

        <aside className="pdx-samping">
          <div className="pdx-kartu pdx-tips">
            <div className="pdx-samping-kepala">
              <span className="tile-ikon kuning">
                <IconBulb size={20} />
              </span>
              <span>
                <strong>Quick tips</strong>
                <small>Simple ways to get better results.</small>
              </span>
            </div>
            <ul>
              {TIPS_CEPAT.map((t) => (
                <li key={t}>
                  <span className="centang">
                    <IconCheck size={12} />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>

          {topik.length > 0 && (
            <div className="pdx-kartu">
              <div className="pdx-samping-kepala">
                <span className="tile-ikon oranye">
                  <IconStar size={20} />
                </span>
                <span>
                  <strong>Featured topics</strong>
                </span>
              </div>
              <ol className="pdx-topik">
                {topik.map((t, i) => (
                  <li key={t.judul}>
                    <button onClick={() => { setCari(''); buka(t.id) }}>
                      <span className="pdx-nomor">{i + 1}</span>
                      <span>{t.judul}</span>
                      <IconChevron />
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="pdx-kartu">
            <div className="pdx-samping-kepala">
              <span className="tile-ikon hijau">
                <IconHelp size={20} />
              </span>
              <span>
                <strong>Need help?</strong>
                <small>Can’t find the answer you are looking for?</small>
              </span>
            </div>
            <button className="pdx-tanya" onClick={tanyaLangsung}>
              <IconChat size={16} /> Ask AIRA directly <IconArrowRight size={15} />
            </button>
            <div className="pdx-bantu-bawah">
              <button onClick={() => { setCari(''); buka('tips') }}>
                <IconBook size={18} /> See how to ask good questions
              </button>
              <button onClick={onMasukan}>
                <IconHelp size={18} /> Ask a new question
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

function Blok({ blok, onAjukan }: { blok: PanduanBlok; onAjukan: Props['onAjukan'] }): JSX.Element {
  if (blok.jenis === 'paragraf') {
    // Judul menu ditulis "— Nama Menu —" oleh penyusunnya; di layar ia jadi pemisah.
    const pemisah = /^—\s.*\s—$/.test(blok.teks)
    return pemisah ? (
      <h3 className="pdx-submenu">{blok.teks.replace(/^—\s|\s—$/g, '')}</h3>
    ) : (
      <p className="pdx-paragraf">{blok.teks}</p>
    )
  }
  if (blok.jenis === 'langkah') {
    return (
      <ol className="pdx-langkah">
        {blok.butir.map((x, j) => {
          const { judul, ket } = pecahLangkah(x)
          return (
            <li key={j}>
              <span className="pdx-langkah-nomor">{j + 1}</span>
              <span className="pdx-langkah-ikon">{ikonLangkah(x)}</span>
              <span className="pdx-langkah-teks">
                <strong>{judul}</strong>
                {ket && <small>{ket}</small>}
              </span>
            </li>
          )
        })}
      </ol>
    )
  }
  if (blok.jenis === 'daftar') {
    return (
      <ul className="pdx-daftar">
        {blok.butir.map((x, j) => (
          <li key={j}>
            <span className="centang">
              <IconCheck size={12} />
            </span>
            {x}
          </li>
        ))}
      </ul>
    )
  }
  if (blok.jenis === 'batas') {
    return (
      <div className="pdx-batas">
        <div className="pdx-batas-judul">
          <IconAlert size={16} /> Limits you should know about
        </div>
        <ul>
          {blok.butir.map((x, j) => (
            <li key={j}>{x}</li>
          ))}
        </ul>
      </div>
    )
  }
  return (
    <div className="pdx-contoh">
      <h4>Example questions</h4>
      <p>Click one to ask right away in {MODE_LABEL[blok.mode]}.</p>
      <div className="pdx-contoh-grid">
        {blok.contoh.map((q) => {
          const g = gayaContoh(q)
          return (
            <button key={q} onClick={() => onAjukan(blok.mode, q)}>
              <span className={`tile-ikon ${g.warna}`}>{g.ikon}</span>
              <span className="pdx-contoh-teks">
                <strong>{g.judul}</strong>
                <small>“{q}”</small>
              </span>
              <IconChevron />
            </button>
          )
        })}
      </div>
    </div>
  )
}
