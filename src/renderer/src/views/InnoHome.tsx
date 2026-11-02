import { useEffect, useMemo, useState, type JSX } from 'react'
import type { SessionMeta, StatusKoneksiSales } from '@shared/ipc'
import { TombolDikte } from '../components/TombolDikte'
import {
  IconArrowRight,
  IconBook,
  IconCheck,
  IconDatabase,
  IconFileText,
  IconHistory,
  IconInfo,
  IconLayers,
  IconList,
  IconMore,
  IconUser,
  IconUsers,
  IconZap
} from '../components/Icons'

// Layar awal "Ask Master Data" — tata letak baru 29 Sep 2026 mengikuti
// mockup user (pola yang sama dengan layar Tanya Data Sales).
//
// ⚠️ Contoh pertanyaan HANYA yang bisa dijawab tool Master Data. Mockup memuat
// "dokter yang bekerja sama dengan RS Kariadi" dan "dokter untuk layanan
// Patologi Anatomi" — `inno_clinician_search` hanya mencari per NAMA, jadi
// contoh itu akan dijawab model dari ingatan (aturan 17). Sengaja tidak dipasang.
// ⚠️ Dropdown "Cabang" di mockup TIDAK dipasang: master Master Data yang
// tersambung tidak punya dimensi cabang, dan filter yang tidak berpengaruh
// memberi rasa pasti yang palsu.
// ⚠️ "Terhubung" = keadaan query TERAKHIR yang teramati di main process.

interface Props {
  onSubmit: (text: string) => void
  sessions: SessionMeta[]
  onOpenSession: (s: SessionMeta) => void
  onPanduan: () => void
}

interface Kelompok {
  judul: string
  ket: string
  ikon: JSX.Element
  warna: string
  contoh: string[]
}

/**
 * Kelompok "Jenis & kelompok item" ditambahkan 21 Agu 2026 bersama pengetahuan
 * master item — tanpa dicontohkan, kemampuan menyaring per jenis/lab/kelompok
 * harga ("C Coret") tidak akan pernah ditemukan user.
 */
const KELOMPOK: Kelompok[] = [
  {
    judul: 'Customers & PKS',
    ket: 'Registered customers, special prices, and cooperation agreements (PKS).',
    ikon: <IconUsers size={24} />,
    warna: 'hijau',
    contoh: [
      'Is RS Brawijaya registered yet?',
      'Please find the special price for RSUP Dr. Kariadi',
      'Does RSUD Dr. Soebandi already have a PKS?'
    ]
  },
  {
    judul: 'Test Prices',
    ket: 'K1 (B2B/Corporate) & K2 (B2C) prices, and special prices per customer.',
    ikon: <IconRupiah />,
    warna: 'biru',
    contoh: [
      'What is the price of the TB-IGRA Quantiferon Gold test?',
      'Who gets a special price for MammaPrint?',
      'What are the B2B and B2C prices for HPV DNA?'
    ]
  },
  {
    judul: 'Item Types & Groups',
    ket: 'Test items by type, lab, group, and price group.',
    ikon: <IconLayers size={24} />,
    warna: 'ungu',
    contoh: [
      'Which package tests are registered?',
      'Which Anatomical Pathology items exist?',
      'List the C Coret test items',
      'Which tests are in the Hematology group?'
    ]
  },
  {
    judul: 'Package Contents',
    ket: 'Breakdown of a test package and the items inside it.',
    ikon: <IconList size={24} />,
    warna: 'oranye',
    contoh: ['What is in the MCU package?', 'How many items are in that package, and which are non-lab?']
  },
  {
    judul: 'Doctors',
    ket: 'Doctors/clinicians registered in the master data, searched by name or code.',
    ikon: <IconUser size={24} />,
    warna: 'merah',
    contoh: ['Is dr. Citra Dewi registered?', 'How many doctors are registered?']
  }
]

/**
 * "Jenis data" DITEMPELKAN ke kalimat saat dikirim — terlihat utuh di gelembung
 * chat. Membantu model memilih tool yang tepat tanpa filter tersembunyi.
 */
const JENIS_DATA = ['customers', 'items & prices', 'special price', 'PKS', 'doctors', 'package contents']

const TIPS = [
  'Use a clear, specific hospital, item, or doctor name',
  'State the type of data you need (price, PKS, item, etc.)',
  'Only K1 (B2B/Corporate) and K2 (B2C) prices are shown',
  'Use natural, simple wording'
]

function IconRupiah(): JSX.Element {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 16V8h2.6a2.2 2.2 0 0 1 0 4.4H8.5M11 12.4 13 16M14.5 16v-5.5M14.5 11.5c.4-.7 1.1-1 2-1" />
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

export default function InnoHome({ onSubmit, sessions, onOpenSession, onPanduan }: Props): JSX.Element {
  const [text, setText] = useState('')
  const [jenis, setJenis] = useState('')
  const [menu, setMenu] = useState(false)
  const [semua, setSemua] = useState(false)
  const [status, setStatus] = useState<StatusKoneksiSales | null>(null)
  const [semuaRiwayat, setSemuaRiwayat] = useState(false)

  useEffect(() => {
    void window.aira.innoStatus().then(setStatus).catch(() => setStatus(null))
    const tutup = (): void => setMenu(false)
    window.addEventListener('click', tutup)
    return () => window.removeEventListener('click', tutup)
  }, [])

  const submit = (): void => {
    const trimmed = text.trim()
    if (!trimmed) return
    onSubmit(jenis && !trimmed.toLowerCase().includes(jenis.toLowerCase()) ? trimmed + ' (data type: ' + jenis + ')' : trimmed)
    setText('')
  }

  const riwayat = useMemo(() => sessions.filter((s) => s.mode === 'masterdata'), [sessions])

  const labelStatus =
    status === null
      ? null
      : !status.terkonfigurasi
        ? { teks: 'Not configured', kelas: 'gagal', judul: 'The Master Data connection is not built into this app.' }
        : status.keadaan === 'terhubung'
          ? { teks: 'Connected', kelas: 'ok', judul: 'Last query succeeded, ' + sejak(status.waktu!) + '.' }
          : status.keadaan === 'gagal'
            ? { teks: 'Not connected', kelas: 'gagal', judul: 'Last connection failed, ' + sejak(status.waktu!) + '. Check your VPN/network.' }
            : { teks: 'Not checked yet', kelas: 'belum', judul: 'No Master Data questions since AIRA was opened — the status appears after the first question.' }

  return (
    <div className="sales-baru">
      <div className="sales-utama">
        <header className="sales-kepala inno-kepala">
          <span className="tile-ikon hijau sales-kepala-ikon inno-kepala-ikon">
            <IconDatabase size={34} />
          </span>
          <div className="sales-kepala-teks">
            <h1 className="inno-judul">Ask Master Data</h1>
            <p>Registered customers, items &amp; prices, special prices, PKS, and doctors — straight from the lab master data.</p>
          </div>
          {/* Hiasan: tumpukan database + kartu data, meniru mockup. */}
          <svg className="sales-seni inno-seni" viewBox="0 0 260 130" aria-hidden="true">
            <rect x="10" y="18" width="92" height="56" rx="10" fill="#f2f8f4" stroke="#e1efe5" transform="rotate(-8 56 46)" />
            <rect x="24" y="34" width="46" height="6" rx="3" fill="#cfe5d6" transform="rotate(-8 56 46)" />
            <rect x="24" y="48" width="30" height="6" rx="3" fill="#dfeee4" transform="rotate(-8 56 46)" />
            <ellipse cx="150" cy="44" rx="44" ry="14" fill="#8fd0a3" />
            <path d="M106 44v56c0 8 20 14 44 14s44-6 44-14V44" fill="#bfe3c9" />
            <path d="M106 64c0 8 20 14 44 14s44-6 44-14M106 84c0 8 20 14 44 14s44-6 44-14" fill="none" stroke="#8fd0a3" strokeWidth="3" />
            <ellipse cx="150" cy="44" rx="44" ry="14" fill="none" stroke="#6cc28a" strokeWidth="2" />
            <rect x="176" y="62" width="74" height="54" rx="10" fill="#ffffff" stroke="#d6eadc" transform="rotate(6 213 89)" />
            <rect x="188" y="76" width="40" height="5" rx="2.5" fill="#6cc28a" transform="rotate(6 213 89)" />
            <rect x="188" y="88" width="48" height="5" rx="2.5" fill="#cfe5d6" transform="rotate(6 213 89)" />
            <rect x="188" y="100" width="30" height="5" rx="2.5" fill="#cfe5d6" transform="rotate(6 213 89)" />
            <circle cx="98" cy="112" r="10" fill="#d6eadc" />
            <path d="M226 14l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#6cc28a" />
          </svg>
          <div className="sales-titik3" onClick={(e) => e.stopPropagation()}>
            <button className="btn-mini" title="Options" onClick={() => setMenu((x) => !x)}>
              <IconMore size={16} />
            </button>
            {menu && (
              <div className="menu-berkas sales-menu">
                <button
                  onClick={() => {
                    setMenu(false)
                    onPanduan()
                  }}
                >
                  Guide for this menu
                </button>
              </div>
            )}
          </div>
        </header>

        <div className="task-box sales-kotak">
          <textarea
            placeholder="Example: please find the special price for RS Kariadi"
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
              <span className="gambar-pilih sales-sumber" title="This menu only reads the Master Data">
                <IconDatabase size={16} /> Source: Master Data
              </span>
              <label className="gambar-pilih" title="The data type is appended to your question when sent">
                <IconFileText size={16} />
                <select value={jenis} onChange={(e) => setJenis(e.target.value)}>
                  <option value="">Data type</option>
                  {JENIS_DATA.map((j) => (
                    <option key={j} value={j}>
                      {j.charAt(0).toUpperCase() + j.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="row-left">
              {/* Hasil dikte DISISIPKAN ke kotak teks, tidak dikirim otomatis. */}
              <TombolDikte onTeks={(t) => setText((s) => (s.trim() ? `${s.trim()} ${t}` : t))} />
              <button className="btn-send sales-tanya" disabled={!text.trim()} onClick={submit}>
                Ask <IconArrowRight size={15} />
              </button>
            </div>
          </div>
        </div>

        <div className="beranda-kepala">
          <h3>
            <IconZap size={17} /> Popular example questions
          </h3>
          <span>Click one to ask right away</span>
          <button className="beranda-tautan" onClick={() => setSemua((x) => !x)}>
            {semua ? 'Collapse examples' : 'Show all examples'} <IconArrowRight size={14} />
          </button>
        </div>
        <div className="inno-kategori">
          {KELOMPOK.map((k) => (
            <section key={k.judul} className={`kartu-kategori inno-kartu ${k.warna}`}>
              <div className="inno-kartu-kepala">
                <span className={`tile-ikon ${k.warna}`}>{k.ikon}</span>
                <span>
                  <strong>{k.judul}</strong>
                  <span>{k.ket}</span>
                </span>
              </div>
              <div className="kategori-daftar">
                {(semua ? k.contoh : k.contoh.slice(0, 3)).map((q) => (
                  <button key={q} onClick={() => onSubmit(q)}>
                    <span>{q}</span>
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
            AIRA uses the Master Data to answer questions about customers, items &amp; prices,
            special prices, PKS, package contents, and doctors. Data is taken straight from the lab master data. This menu does not
            read transaction data — for sales figures, use Ask Sales Data.
          </p>
        </div>

        <div className="kartu-panel">
          <div className="kartu-panel-kepala">
            <h4>
              <IconDatabase size={17} /> Data Source
            </h4>
          </div>
          <div className="sales-sumber-baris">
            <span>
              <IconDatabase size={14} /> Master Data
            </span>
            {labelStatus && (
              <span className={`status-koneksi ${labelStatus.kelas}`} title={labelStatus.judul}>
                <i /> {labelStatus.teks}
              </span>
            )}
          </div>
        </div>

        <div className="kartu-panel">
          <div className="kartu-panel-kepala">
            <h4>
              <IconBook size={17} /> Usage Tips
            </h4>
          </div>
          <ul className="sales-tips">
            {TIPS.map((t) => (
              <li key={t}>
                <span className="centang">
                  <IconCheck size={13} />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="kartu-panel">
          <div className="kartu-panel-kepala">
            <h4>
              <IconHistory size={17} /> Recent Questions
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
