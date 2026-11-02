import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { SessionMeta, StatusDrive } from '@shared/ipc'
import { TombolDikte } from '../components/TombolDikte'
import {
  IconArrowRight,
  IconBulb,
  IconCheck,
  IconDatabase,
  IconFileText,
  IconFolder,
  IconHistory,
  IconInfo,
  IconSearch,
  IconSparkle
} from '../components/Icons'

// Layar awal "Tanya Microsoft 365" (menu `onedrive`) — tata letak baru 29 Sep
// 2026 mengikuti mockup user, pola yang sama dengan layar Sales/Master Data/TAT.
//
// ⚠️ Contoh sengaja TIDAK memakai nama berkas/folder milik orang. Contoh yang
// terlihat konkret dipakai model sebagai nilai bawaan saat ia tidak tahu harus
// mengisi apa (kegagalan "EKG", 25 Agu 2026). "List semua file di folder
// Marketing" dari mockup diganti "berkas yang di-share ke saya": folder
// Marketing belum tentu ada, dan jawabannya akan "tidak ditemukan".
// ⚠️ Contoh membaca/membandingkan butuh NAMA berkas, jadi klik MENGISI kotak
// (pola "Lacak" di TAT) — dikirim apa adanya, "dokumen ini" tidak merujuk apa pun.
// ⚠️ "Tunjukkan perubahan antara versi dokumen" di mockup diubah jadi "dua versi
// dokumen": riwayat versi OneDrive TIDAK dibaca tool mana pun; yang bisa
// dibandingkan dua berkas yang disebut user.
// ⚠️ Sumber/folder/tipe DITEMPEL ke kalimat dan terlihat di gelembung chat —
// bukan filter tersembunyi (pola "periode" di Sales).

interface Props {
  onSubmit: (text: string) => void
  sessions: SessionMeta[]
  onOpenSession: (s: SessionMeta) => void
}

interface Contoh {
  tampil: string
  /** Diisi = klik MENGISI kotak dengan teks ini, bukan langsung mengirim. */
  isi?: string
}

interface Kelompok {
  judul: string
  ket: string
  ikon: JSX.Element
  warna: string
  contoh: Contoh[]
}

const KELOMPOK: Kelompok[] = [
  {
    judul: 'Find Files',
    ket: 'Find the documents you need',
    ikon: <IconSearch size={22} />,
    warna: 'hijau',
    contoh: [
      { tampil: 'Find documents about SOPs in my OneDrive' },
      { tampil: 'Find the 2024 sales report file' },
      { tampil: 'Find presentations with the keyword "product"' }
    ]
  },
  {
    judul: 'Folder Contents',
    ket: 'See what is inside a folder and explore documents',
    ikon: <IconFolder size={22} />,
    warna: 'biru',
    contoh: [
      { tampil: 'Which folders are in my OneDrive?' },
      { tampil: 'Show the contents of the Documents folder' },
      { tampil: 'Which files have been shared with me?' }
    ]
  },
  {
    judul: 'Read & Summarize',
    ket: 'Understand a document quickly — mention the file name',
    ikon: <IconFileText size={22} />,
    warna: 'ungu',
    contoh: [
      { tampil: 'Open and summarize this document', isi: 'Open and summarize the document ' },
      { tampil: 'Extract the key points from that file', isi: 'Extract the key points from the file ' },
      { tampil: 'Explain the document in simple terms', isi: 'Explain in simple terms the document ' }
    ]
  },
  {
    judul: 'Compare Documents',
    ket: 'Find the differences between documents — mention both files',
    ikon: <IconTimbangan />,
    warna: 'kuning',
    contoh: [
      { tampil: 'Compare two documents — what is different?', isi: 'Compare these two documents and tell me what is different: ' },
      {
        tampil: 'Show the changes between two versions of a document',
        isi: 'Show the changes between these two versions of a document: '
      },
      {
        tampil: 'Which is newer and what changed?',
        isi: 'Of these two documents, which is newer and what changed: '
      }
    ]
  }
]

const SUMBER = [
  { nilai: '', label: 'Source: My OneDrive' },
  { nilai: 'files shared with me', label: 'Source: Shared with me' }
]

const TIPE = ['Word', 'Excel', 'PowerPoint', 'PDF']

const TIPS = [
  'Use specific keywords for more relevant results.',
  'Pick a folder for a more focused search.',
  'You can ask for a summary, key points, or a comparison between files.',
  'AIRA only reads files you can access (per your OneDrive permissions).'
]

const MAKS_KARAKTER = 2000

function IconTimbangan(): JSX.Element {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v18M7 21h10M5 7h14M12 5l-7 2M12 5l7 2" />
      <path d="m5 7-3 7a3.5 3.5 0 0 0 6 0zM19 7l-3 7a3.5 3.5 0 0 0 6 0z" />
    </svg>
  )
}

function IconSegarkan(): JSX.Element {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5" />
    </svg>
  )
}

function IconAwan({ size = 22 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size * 0.7} viewBox="0 0 40 28" aria-hidden="true">
      <path d="M31 27H10a8 8 0 0 1-1.2-15.9A11 11 0 0 1 29.6 9 9 9 0 0 1 31 27z" fill="#2f86d6" />
      <path d="M31 27H14a7 7 0 0 1 3-13.3A9 9 0 0 1 33.5 13 7 7 0 0 1 31 27z" fill="#56a8f0" />
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

function sejak(ms: number): string {
  const menit = Math.max(0, Math.round((Date.now() - ms) / 60_000))
  if (menit < 1) return 'just now'
  if (menit < 60) return menit + ' min ago'
  const jam = Math.round(menit / 60)
  if (jam < 24) return jam + ' h ago'
  const hari = Math.round(jam / 24)
  if (hari < 30) return hari + ' d ago'
  return new Date(ms).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Tambahan konteks yang ditempel ke kalimat — hanya yang belum disebut user sendiri. */
function tempel(teks: string, sumber: string, folder: string, tipe: string): string {
  const kecil = teks.toLowerCase()
  const tambahan: string[] = []
  if (sumber && !kecil.includes('share')) tambahan.push('source: ' + sumber)
  if (folder && !kecil.includes(folder.toLowerCase())) tambahan.push(`folder: ${folder}`)
  if (tipe && !kecil.includes(tipe.toLowerCase())) tambahan.push(`file type: ${tipe}`)
  return tambahan.length ? `${teks} (${tambahan.join(', ')})` : teks
}

export default function DriveHome({ onSubmit, sessions, onOpenSession }: Props): JSX.Element {
  const [text, setText] = useState('')
  const [sumber, setSumber] = useState('')
  const [folder, setFolder] = useState('')
  const [tipe, setTipe] = useState('')
  const [status, setStatus] = useState<StatusDrive | null>(null)
  const [memuat, setMemuat] = useState(false)
  const [semuaRiwayat, setSemuaRiwayat] = useState(false)
  const kotak = useRef<HTMLTextAreaElement>(null)

  const periksa = (): void => {
    setMemuat(true)
    void window.aira
      .driveStatus()
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setMemuat(false))
  }

  useEffect(periksa, [])

  const submit = (): void => {
    const trimmed = text.trim()
    if (!trimmed) return
    onSubmit(tempel(trimmed, sumber, folder, tipe))
    setText('')
  }

  const pakaiContoh = (c: Contoh): void => {
    if (!c.isi) {
      onSubmit(c.tampil)
      return
    }
    setText(c.isi)
    // Kursor di akhir supaya orang langsung mengetik nama berkasnya.
    requestAnimationFrame(() => {
      const el = kotak.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
  }

  const riwayat = useMemo(() => sessions.filter((s) => s.mode === 'onedrive'), [sessions])
  const terhubung = status?.keadaan === 'terhubung'

  const labelStatus = memuat
    ? { teks: 'Checking…', kelas: 'belum', judul: 'Checking the Microsoft 365 connection.' }
    : status === null
      ? { teks: 'Unknown', kelas: 'belum', judul: 'The status could not be read.' }
      : !status.terkonfigurasi
        ? { teks: 'Not configured', kelas: 'gagal', judul: 'Microsoft 365 is not built into this app.' }
        : status.keadaan === 'terhubung'
          ? {
              teks: status.lanjutan ? 'Connected' : 'Connected (files only)',
              kelas: 'ok',
              judul: status.akun ? `Signed in as ${status.akun}` : 'Connected'
            }
          : status.keadaan === 'gagal'
            ? { teks: 'Not connected', kelas: 'gagal', judul: status.galat ?? 'The connection failed.' }
            : {
                teks: 'Not signed in',
                kelas: 'belum',
                judul: 'Microsoft sign-in is requested automatically when you send your first question.'
              }

  return (
    <div className="sales-baru">
      <div className="sales-utama">
        <header className="drive-hero">
          <div className="drive-hero-teks">
            <span className="hero-lencana">
              <IconFolder size={15} /> Ask Microsoft 365
            </span>
            <h1>Ask OneDrive Documents</h1>
            <p>
              Search, read, summarize, and compare files in your Microsoft 365 OneDrive quickly and
              easily. AIRA helps you find the key information in documents you can access.
            </p>
            <div className="drive-fitur">
              <span>
                <i><IconSearch size={17} /></i> Search documents<br />with context
              </span>
              <span>
                <i><IconFileText size={17} /></i> Read &amp; summarize<br />documents
              </span>
              <span>
                <i><IconTimbangan /></i> Compare<br />documents
              </span>
            </div>
          </div>
          {/* Hiasan: map + dokumen + kaca pembesar + awan, meniru mockup. */}
          <svg className="drive-seni" viewBox="0 0 330 220" aria-hidden="true">
            <circle cx="60" cy="190" r="16" fill="#d8e1ef" />
            <circle cx="300" cy="40" r="10" fill="#e2e9f3" />
            <rect x="120" y="14" width="110" height="140" rx="10" fill="#ffffff" stroke="#dbe2ec" transform="rotate(8 175 84)" />
            <rect x="100" y="24" width="110" height="140" rx="10" fill="#ffffff" stroke="#dbe2ec" />
            <circle cx="128" cy="50" r="9" fill="#678dc7" />
            <rect x="116" y="72" width="70" height="7" rx="3.5" fill="#dbe2ec" />
            <rect x="116" y="88" width="80" height="7" rx="3.5" fill="#e7ecf3" />
            <rect x="116" y="104" width="56" height="7" rx="3.5" fill="#e7ecf3" />
            <path d="M40 92h62l14 14h86a10 10 0 0 1 10 10v70a10 10 0 0 1-10 10H40a10 10 0 0 1-10-10v-84a10 10 0 0 1 10-10z" fill="#3a629f" />
            <path d="M34 122h178a8 8 0 0 1 8 9l-7 57a10 10 0 0 1-10 9H40a10 10 0 0 1-10-10z" fill="#5680bf" />
            <circle cx="150" cy="118" r="34" fill="#e9eff7" stroke="#2a4d82" strokeWidth="9" />
            <circle cx="150" cy="118" r="22" fill="#ffffff" opacity="0.7" />
            <path d="M174 142l30 30" stroke="#2a4d82" strokeWidth="13" strokeLinecap="round" />
            <rect x="120" y="170" width="170" height="36" rx="18" fill="#ffffff" stroke="#dbe2ec" />
            <circle cx="142" cy="188" r="6" fill="none" stroke="#6b717a" strokeWidth="2.5" />
            <path d="M146.5 192.5l4 4" stroke="#6b717a" strokeWidth="2.5" strokeLinecap="round" />
            <rect x="160" y="184" width="100" height="8" rx="4" fill="#e3e7ec" />
            <rect x="232" y="56" width="82" height="70" rx="16" fill="#ffffff" stroke="#dbe2ec" />
            <path d="M293 108h-45a12 12 0 0 1-1.8-23.8A16 16 0 0 1 276 80a13 13 0 0 1 17 28z" fill="#2f86d6" />
            <path d="M293 108h-37a10 10 0 0 1 4-19.2A13 13 0 0 1 283 86a10 10 0 0 1 10 22z" fill="#56a8f0" />
          </svg>
        </header>

        <div className="task-box sales-kotak drive-kotak">
          <textarea
            ref={kotak}
            placeholder="Example: find documents about SOPs in my OneDrive"
            value={text}
            maxLength={MAKS_KARAKTER}
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
              {/* Hasil dikte DISISIPKAN ke kotak teks, tidak dikirim otomatis. */}
              <TombolDikte onTeks={(t) => setText((s) => (s.trim() ? `${s.trim()} ${t}` : t).slice(0, MAKS_KARAKTER))} />
              <label className="gambar-pilih" title="The source is appended to your question when sent">
                <IconAwan size={18} />
                <select value={sumber} onChange={(e) => setSumber(e.target.value)}>
                  {SUMBER.map((s) => (
                    <option key={s.nilai} value={s.nilai}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label
                className="gambar-pilih"
                title={
                  terhubung
                    ? 'The folder is appended to your question when sent'
                    : 'The folder list appears after you sign in to Microsoft 365'
                }
              >
                <IconFolder size={16} />
                <select value={folder} onChange={(e) => setFolder(e.target.value)}>
                  <option value="">All folders</option>
                  {status?.folder.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                  {!terhubung && (
                    <option value="" disabled>
                      (sign in first to choose a folder)
                    </option>
                  )}
                </select>
              </label>
              <label className="gambar-pilih" title="The file type is appended to your question when sent">
                <IconFileText size={16} />
                <select value={tipe} onChange={(e) => setTipe(e.target.value)}>
                  <option value="">All file types</option>
                  {TIPE.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="row-left">
              <span className="drive-hitung">
                {text.length}/{MAKS_KARAKTER}
              </span>
              <button className="btn-send sales-tanya" disabled={!text.trim()} onClick={submit}>
                <IconSparkle size={15} /> Ask <IconArrowRight size={15} />
              </button>
            </div>
          </div>
        </div>

        <div className="beranda-kepala drive-kepala-contoh">
          <h3>
            <IconBulb size={18} /> Popular example questions
          </h3>
          <span>Pick an example question below or type your own.</span>
        </div>
        <div className="drive-kategori">
          {KELOMPOK.map((k) => (
            <section key={k.judul} className={`kartu-kategori drive-kartu ${k.warna}`}>
              <div className="inno-kartu-kepala">
                <span className={`tile-ikon ${k.warna}`}>{k.ikon}</span>
                <span>
                  <strong>{k.judul}</strong>
                  <span>{k.ket}</span>
                </span>
              </div>
              <div className="kategori-daftar">
                {k.contoh.map((c) => (
                  <button
                    key={c.tampil}
                    onClick={() => pakaiContoh(c)}
                    title={c.isi ? 'Fills the question box — complete it with the file name' : 'Ask right away'}
                  >
                    <span>{c.tampil}</span>
                    <IconChevron />
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      <aside className="sales-samping">
        <div className="kartu-panel">
          <div className="kartu-panel-kepala">
            <h4>
              <IconInfo size={17} /> About This Menu
            </h4>
          </div>
          <p className="panel-kosong">
            Use this menu to search, read, summarize, and compare files from your Microsoft 365 OneDrive
            — including those shared by other people.
          </p>
          <ul className="drive-centang">
            <li><IconCheck size={14} /> Search files &amp; view folder contents</li>
            <li><IconCheck size={14} /> Read Word, Excel, PowerPoint &amp; PDF</li>
            <li><IconCheck size={14} /> Summarize and compare documents</li>
            <li><IconCheck size={14} /> Only accesses files you have access to</li>
          </ul>
          {status && !status.lanjutan && (
            <p className="drive-catatan">Email, calendar, SharePoint &amp; Teams are not connected yet — waiting for admin approval.</p>
          )}
        </div>

        <div className="kartu-panel">
          <div className="kartu-panel-kepala">
            <h4>
              <IconDatabase size={17} /> Data Source
            </h4>
          </div>
          <div className="drive-sumber">
            <IconAwan size={34} />
            <span>
              <strong>OneDrive Microsoft 365</strong>
              <span className={`status-koneksi ${labelStatus.kelas}`} title={labelStatus.judul}>
                <i /> {labelStatus.teks}
              </span>
              {terhubung && status?.akun && <span className="drive-akun">{status.akun}</span>}
            </span>
            <button className="btn-mini" title="Check again" onClick={periksa} disabled={memuat}>
              <IconSegarkan />
            </button>
          </div>
        </div>

        <div className="kartu-panel">
          <div className="kartu-panel-kepala">
            <h4>
              <IconBulb size={17} /> Usage Tips
            </h4>
          </div>
          <ol className="drive-tips">
            {TIPS.map((t, i) => (
              <li key={t}>
                <span>{i + 1}</span>
                {t}
              </li>
            ))}
          </ol>
        </div>

        <div className="kartu-panel">
          <div className="kartu-panel-kepala">
            <h4>
              <IconHistory size={17} /> Recent Searches
            </h4>
            {riwayat.length > 5 && (
              <button className="beranda-tautan" onClick={() => setSemuaRiwayat((x) => !x)}>
                {semuaRiwayat ? 'Show less' : 'View all'}
              </button>
            )}
          </div>
          {riwayat.length === 0 ? (
            <p className="panel-kosong">Questions you ask in this menu will appear here.</p>
          ) : (
            <ul className="sales-riwayat">
              {riwayat.slice(0, semuaRiwayat ? 15 : 5).map((s) => (
                <li key={s.id}>
                  <button onClick={() => onOpenSession(s)} title={s.title}>
                    <span className="tile-tips">
                      <IconFileText size={15} />
                    </span>
                    <span>
                      <strong>{s.title}</strong>
                      <span>{sejak(s.updatedAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  )
}
