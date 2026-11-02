import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { SessionMeta, StatusKoneksiSales } from '@shared/ipc'
import { TombolDikte } from '../components/TombolDikte'
import {
  IconArrowRight,
  IconBook,
  IconCalendar,
  IconChart,
  IconCheck,
  IconDatabase,
  IconFileText,
  IconHistory,
  IconInfo,
  IconMore,
  IconStar,
  IconTrend,
  IconUsers,
  IconZap
} from '../components/Icons'

// Layar awal "Tanya Data Sales" — tata letak baru 29 Sep 2026 mengikuti mockup
// user: header, kotak tanya (sumber + periode), contoh populer, kategori
// pertanyaan, dan panel kanan (tentang menu, sumber data, tips, pertanyaan
// terakhir).
//
// ⚠️ Contoh pertanyaan TIDAK ditambah di luar daftar lama yang sudah teruji.
// Contoh yang tidak bisa dijawab tool sales membuat model mengarang (aturan 17)
// — dan contoh itu justru yang diklik orang tanpa mengetik apa pun.
// ⚠️ "Terhubung" dibaca dari keadaan koneksi TERAKHIR yang teramati di main
// process (`salesStatus`), tidak ditulis mati.

interface Props {
  onSubmit: (text: string) => void
  sessions: SessionMeta[]
  onOpenSession: (s: SessionMeta) => void
  onPanduan: () => void
  /** Pertanyaan lanjutan dari klik notifikasi pemantau — MENGISI kotak, tidak dikirim. */
  isiAwal?: { teks: string; kunci: number } | null
  /** Dipanggil sesudah `isiAwal` dipakai, supaya tidak terisi ulang saat layar dibuka lagi. */
  onIsiTerpakai?: () => void
}

interface Kelompok {
  judul: string
  ikon: JSX.Element
  warna: string
  contoh: string[]
}

/**
 * Dikelompokkan per PERTANYAAN YANG DIAJUKAN ORANG, bukan per nama tool: user
 * datang dengan "mau tahu pelanggan yang berhenti", bukan "mau memanggil
 * sales_customers". Tiga pertama tampil; sisanya di balik "Lihat semua (n)".
 */
const KELOMPOK: Kelompok[] = [
  {
    judul: 'Summary & Comparison',
    ikon: <IconChart size={18} />,
    warna: 'hijau',
    contoh: [
      "What are today's sales?",
      'Sales this month vs last month',
      'Daily sales trend this month',
      'YTD this year vs last year',
      'Create a sales report for this month',
      'Create a sales report for this month as an Excel file'
    ]
  },
  {
    judul: 'Tests',
    ikon: <IconCalendar size={18} />,
    warna: 'biru',
    contoh: [
      'Which tests sold the most this month?',
      'Which items are trending down?',
      'Which service category is the largest this month?',
      'Which tests sold the least this month?'
    ]
  },
  {
    judul: 'Customers',
    ikon: <IconUsers size={18} />,
    warna: 'ungu',
    contoh: [
      'Top 10 customers in the last 30 days',
      'Which customers have had a sharp drop in orders?',
      'Who are the new customers in the last 90 days?',
      'Which customers stopped ordering?'
    ]
  },
  {
    judul: 'Regions',
    ikon: <IconPin size={18} />,
    warna: 'oranye',
    contoh: [
      'Which province is the largest this month?',
      'Sales by customer type this month',
      'What are the sales in West Java this month?'
    ]
  },
  {
    // Ditambahkan 21 Agu 2026. Tanpa dicontohkan di sini, tool ramalan praktis
    // tidak akan pernah ditemukan user.
    judul: 'Projection & Forecast',
    ikon: <IconTrend size={18} />,
    warna: 'merah',
    contoh: [
      'What is the projected month-end close?',
      'Forecast sales for the next 3 months',
      'Which tests are trending up?'
    ]
  },
  {
    judul: 'ERP',
    ikon: <IconDatabase size={18} />,
    warna: 'hijau',
    contoh: ['ERP sales orders this month', 'Orders not yet in the ERP this month']
  }
]

const POPULER: Array<{ judul: string; tanya: string; ket: string; ikon: JSX.Element; warna: string }> = [
  {
    judul: "What are today's sales?",
    tanya: "What are today's sales?",
    ket: 'Total sales today with a comparison.',
    ikon: <IconChart size={22} />,
    warna: 'hijau'
  },
  {
    judul: 'Sales this month vs last month',
    tanya: 'Sales this month vs last month',
    ket: 'Comparison with the equivalent period last month.',
    ikon: <IconCalendar size={22} />,
    warna: 'biru'
  },
  {
    judul: 'Sales by region',
    tanya: 'Which province is the largest this month?',
    ket: 'The province with the highest sales this month.',
    ikon: <IconTrend size={22} />,
    warna: 'ungu'
  },
  {
    judul: 'Top 10 customers',
    tanya: 'Top 10 customers in the last 30 days',
    ket: 'Largest customers in the last 30 days.',
    ikon: <IconStar size={22} />,
    warna: 'kuning'
  }
]

/**
 * Periode yang DITEMPELKAN ke kalimat saat dikirim — terlihat utuh di gelembung
 * chat, jadi user tahu persis apa yang ditanyakan. Tidak ada filter tersembunyi.
 */
const PERIODE = ['today', 'yesterday', 'this week', 'this month', 'last month', 'this year (YTD)']

const TIPS = [
  'Use clear, specific wording',
  'State the time period',
  'Ask for a PDF/Word/Excel report if you need tables & charts',
  'Combine with filters (region, test, customer)'
]

function IconPin({ size = 16 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
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

export default function SalesHome({
  onSubmit,
  sessions,
  onOpenSession,
  onPanduan,
  isiAwal,
  onIsiTerpakai
}: Props): JSX.Element {
  const [text, setText] = useState('')
  const [periode, setPeriode] = useState('')
  const kotak = useRef<HTMLTextAreaElement>(null)

  // Klik notifikasi/riwayat pemantau: pertanyaan lanjutan MENGISI kotak, tidak
  // dikirim — yang menekan kirim tetap orangnya. Periode yang tadi dipilih DIBUANG:
  // pertanyaannya sudah menyebut tanggalnya sendiri, dan "(periode: …)" yang ikut
  // tertempel saat dikirim membuatnya bertentangan (temuan review akhir 20 Okt 2026).
  useEffect(() => {
    if (!isiAwal) return
    setText(isiAwal.teks)
    setPeriode('')
    onIsiTerpakai?.()
    requestAnimationFrame(() => {
      kotak.current?.focus()
      kotak.current?.setSelectionRange(isiAwal.teks.length, isiAwal.teks.length)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isiAwal])
  const [dibuka, setDibuka] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const [status, setStatus] = useState<StatusKoneksiSales | null>(null)
  const [semuaRiwayat, setSemuaRiwayat] = useState(false)

  useEffect(() => {
    void window.aira.salesStatus().then(setStatus).catch(() => setStatus(null))
    const tutup = (): void => setMenu(false)
    window.addEventListener('click', tutup)
    return () => window.removeEventListener('click', tutup)
  }, [])

  const submit = (): void => {
    const trimmed = text.trim()
    if (!trimmed) return
    onSubmit(periode && !trimmed.toLowerCase().includes(periode.toLowerCase()) ? trimmed + ' (period: ' + periode + ')' : trimmed)
    setText('')
  }

  // Pertanyaan terakhir = percakapan menu Sales milik user ini (sidebar sudah
  // tersaring per pemilik di main process).
  const riwayat = useMemo(() => sessions.filter((s) => s.mode === 'sales'), [sessions])

  const labelStatus =
    status === null
      ? null
      : !status.terkonfigurasi
        ? { teks: 'Not configured', kelas: 'gagal', judul: 'The sales database connection is not built into this app.' }
        : status.keadaan === 'terhubung'
          ? { teks: 'Connected', kelas: 'ok', judul: 'Last query succeeded, ' + sejak(status.waktu!) + '.' }
          : status.keadaan === 'gagal'
            ? { teks: 'Not connected', kelas: 'gagal', judul: 'Last connection failed, ' + sejak(status.waktu!) + '. Check your VPN/network.' }
            : { teks: 'Not checked yet', kelas: 'belum', judul: 'No queries since AIRA was opened.' }

  return (
    <div className="sales-baru">
      <div className="sales-utama">
        <header className="sales-kepala">
          <span className="tile-ikon utama sales-kepala-ikon">
            <IconChart size={28} />
          </span>
          <div className="sales-kepala-teks">
            <h1>Ask Sales Data</h1>
            <p>
              Ask questions about sales data — AIRA pulls the numbers straight from the database and
              explains them, no guesswork.
            </p>
          </div>
          {/* Hiasan: kartu grafik kecil, meniru mockup. */}
          <svg className="sales-seni" viewBox="0 0 220 110" aria-hidden="true">
            <rect x="8" y="10" width="150" height="92" rx="12" fill="#f2f8f4" stroke="#e0e6f0" />
            <rect x="22" y="30" width="54" height="6" rx="3" fill="#ced8e6" />
            <rect x="22" y="44" width="38" height="6" rx="3" fill="#dee5ef" />
            <polyline points="24,86 52,70 78,76 104,56 132,40" fill="none" stroke="#386ab5" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="132" cy="40" r="4" fill="#386ab5" />
            <rect x="150" y="62" width="14" height="36" rx="3" fill="#bdcde5" />
            <rect x="170" y="46" width="14" height="52" rx="3" fill="#8ba8d4" />
            <rect x="190" y="28" width="14" height="70" rx="3" fill="#386ab5" />
            <path d="M188 16 L204 16 L204 32" fill="none" stroke="#386ab5" strokeWidth="2.5" strokeLinecap="round" />
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
            ref={kotak}
            placeholder="Type your question about sales data..."
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
              <span className="gambar-pilih sales-sumber" title="This menu only reads the sales database (SalesRepository)">
                <IconDatabase size={16} /> Source: SalesRepository
              </span>
              <label className="gambar-pilih" title="The period is appended to your question when sent">
                <IconCalendar size={16} />
                <select value={periode} onChange={(e) => setPeriode(e.target.value)}>
                  <option value="">Period</option>
                  {PERIODE.map((p) => (
                    <option key={p} value={p}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
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
          <button className="beranda-tautan" onClick={() => setDibuka(dibuka === 'all' ? null : 'all')}>
            {dibuka === 'all' ? 'Collapse examples' : 'Show all examples'} <IconArrowRight size={14} />
          </button>
        </div>
        <div className="sales-populer">
          {POPULER.map((p) => (
            <button key={p.judul} className="kartu-populer" onClick={() => onSubmit(p.tanya)} title={p.tanya}>
              <span className={`tile-ikon ${p.warna}`}>{p.ikon}</span>
              <span>
                <strong>{p.judul}</strong>
                <span>{p.ket}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="beranda-kepala">
          <h3>Question Categories</h3>
          <span className="sales-kanan-teks">Pick a category or type your question</span>
        </div>
        <div className="sales-kategori">
          {KELOMPOK.map((k) => {
            const semua = dibuka === 'all' || dibuka === k.judul
            return (
              <section key={k.judul} className="kartu-kategori">
                <h4>
                  <span className={`tile-ikon mini ${k.warna}`}>{k.ikon}</span> {k.judul}
                </h4>
                <div className="kategori-daftar">
                  {(semua ? k.contoh : k.contoh.slice(0, 3)).map((q) => (
                    <button key={q} onClick={() => onSubmit(q)}>
                      <span>{q}</span>
                      <IconChevron />
                    </button>
                  ))}
                </div>
                {k.contoh.length > 3 && dibuka !== 'all' && (
                  <button className="beranda-tautan kategori-lagi" onClick={() => setDibuka(semua ? null : k.judul)}>
                    {semua ? 'Show less' : 'View all (' + k.contoh.length + ')'} <IconArrowRight size={13} />
                  </button>
                )}
              </section>
            )
          })}
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
            AIRA uses transaction data from SalesRepository to answer questions about sales,
            customers, tests, and regions. Figures are calculated by the system from the database (summaries only, no
            patient data); sales are counted from the result/invoice date. Results can be requested as a PDF, Word,
            or Excel report complete with charts.
          </p>
          <div className="kartu-panel-kepala sales-sumber-kepala">
            <h4>
              <IconDatabase size={17} /> Data Source
            </h4>
          </div>
          <div className="sales-sumber-baris">
            <span>
              <IconDatabase size={14} /> SalesRepository
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
            {riwayat.length > 4 && (
              <button className="beranda-tautan" onClick={() => setSemuaRiwayat((x) => !x)}>
                {semuaRiwayat ? 'Show less' : 'View all'}
              </button>
            )}
          </div>
          {riwayat.length === 0 ? (
            <p className="panel-kosong">Questions you ask in this menu will appear here.</p>
          ) : (
            <ul className="sales-riwayat">
              {riwayat.slice(0, semuaRiwayat ? 15 : 4).map((s) => (
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

function IconChevron(): JSX.Element {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}
