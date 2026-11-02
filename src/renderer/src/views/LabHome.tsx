import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { SessionMeta, StatusKoneksiSales } from '@shared/ipc'
import { TombolDikte } from '../components/TombolDikte'
import {
  IconArrowRight,
  IconClock,
  IconFileText,
  IconHistory,
  IconInfo,
  IconMore,
  IconSearch,
  IconSend,
  IconTrend,
  IconZap
} from '../components/Icons'

// Layar awal "Tanya TAT Sample" — tata letak baru 29 Sep 2026 mengikuti mockup
// user (pola yang sama dengan Sales & Master Data).
//
// ⚠️ Contoh HANYA yang bisa dijawab tool lab (backlog, lacak, RNS, TAT). Kartu
// "Informasi Umum" di mockup ("jenis pemeriksaan yang tersedia", "total sampel
// diterima bulan ini", "tren jumlah sampel 3 bulan") TIDAK dipasang — tidak ada
// tool yang menjawabnya, dan contoh yang tak terjawab membuat model mengarang
// (aturan 17).
// ⚠️ Contoh "Lacak Satu Order" MENGISI kotak, tidak langsung mengirim: tanpa
// Order ID, `lab_lacak` wajib menolak (aturan 35) dan user hanya mendapat
// pertanyaan balik.
// ⚠️ Menu ini membaca lewat koneksi SALES (aturan 51); statusnya pun dari sana.

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
  ket: string
  ikon: JSX.Element
  warna: string
  contoh: string[]
  /** true = klik mengisi kotak (butuh Order ID), bukan langsung bertanya. */
  isi?: boolean
}

const KELOMPOK: Kelompok[] = [
  {
    judul: 'Not Yet Released',
    ket: 'Samples whose results are not out yet, with status and backlog.',
    ikon: <IconClock size={26} />,
    warna: 'merah',
    contoh: [
      'Which samples do not have results yet?',
      'What is the Molecular backlog this month?',
      'Are there samples validated by the analyst whose results are not out yet?',
      'Which samples have been stuck in the lab the longest?'
    ]
  },
  {
    judul: 'Track One Order',
    ket: 'Trace one sample from receipt to result. Requires an Order ID.',
    ikon: <IconSearch size={26} />,
    warna: 'biru',
    isi: true,
    contoh: [
      'Which stage is Order ID … at?',
      'How far along is the sample for Order ID …?',
      'How long has the sample with Order ID … been in process?'
    ]
  },
  {
    judul: 'RNS (Recollected Samples)',
    ket: 'Samples that had to be recollected and their replacements.',
    ikon: <IconFileText size={26} />,
    warna: 'ungu',
    contoh: [
      'Which tests have the most RNS?',
      'How many RNS are still waiting for the replacement sample?',
      'Which tests have the highest RNS ratio?'
    ]
  },
  {
    judul: 'TAT',
    ket: 'Turnaround time per category and test stage.',
    ikon: <IconTrend size={26} />,
    warna: 'hijau',
    contoh: [
      'What is the average TAT per category this month?',
      'Which tests have the longest TAT?',
      'How long does the preparation stage take for Histology?'
    ]
  },
  {
    judul: 'Bottleneck Analysis',
    ket: 'Find the stages and tests that slow the sample flow the most.',
    ikon: <IconBars />,
    warna: 'oranye',
    contoh: [
      'At which stage are the most samples held up right now?',
      'Which tests have the longest p90 TAT?',
      'How many samples are at each stage right now?'
    ]
  }
]

const TIPS = [
  'To track a sample, write the full Order ID',
  'Mention the period, category, test, or customer name',
  'Data comes from an ETL (not real-time) — the update time is always stated',
  'Use natural, simple wording'
]

function IconBars(): JSX.Element {
  return (
    <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <path d="M5 20v-6M10 20V9M15 20v-8M20 20V5" />
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

export default function LabHome({
  onSubmit,
  sessions,
  onOpenSession,
  onPanduan,
  isiAwal,
  onIsiTerpakai
}: Props): JSX.Element {
  const [text, setText] = useState('')
  const [menu, setMenu] = useState(false)
  const [semua, setSemua] = useState(false)
  const [status, setStatus] = useState<StatusKoneksiSales | null>(null)
  const [semuaRiwayat, setSemuaRiwayat] = useState(false)
  const kotak = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    void window.aira.labStatus().then(setStatus).catch(() => setStatus(null))
    const tutup = (): void => setMenu(false)
    window.addEventListener('click', tutup)
    return () => window.removeEventListener('click', tutup)
  }, [])

  const submit = (): void => {
    const trimmed = text.trim()
    if (!trimmed) return
    onSubmit(trimmed)
    setText('')
  }

  /** Contoh berisi "…" = tempat Order ID; kursor diletakkan di sana. */
  const isiKotak = (q: string): void => {
    const pos = q.indexOf('…')
    const teks = q.replace('…', '')
    setText(teks)
    requestAnimationFrame(() => {
      kotak.current?.focus()
      const p = pos >= 0 ? pos : teks.length
      kotak.current?.setSelectionRange(p, p)
    })
  }

  // Klik notifikasi/riwayat pemantau: pertanyaan lanjutan MENGISI kotak (pola contoh
  // "Lacak Satu Order") — yang menekan kirim tetap orangnya.
  useEffect(() => {
    if (!isiAwal) return
    isiKotak(isiAwal.teks)
    onIsiTerpakai?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isiAwal])

  const riwayat = useMemo(() => sessions.filter((s) => s.mode === 'lab'), [sessions])

  const labelStatus =
    status === null
      ? null
      : !status.terkonfigurasi
        ? { teks: 'Not configured', kelas: 'gagal', judul: 'The database connection is not built into this app.' }
        : status.keadaan === 'terhubung'
          ? { teks: 'Connected', kelas: 'ok', judul: 'Last query succeeded, ' + sejak(status.waktu!) + '.' }
          : status.keadaan === 'gagal'
            ? { teks: 'Not connected', kelas: 'gagal', judul: 'Last connection failed, ' + sejak(status.waktu!) + '. Check your VPN/network.' }
            : { teks: 'Not checked yet', kelas: 'belum', judul: 'No queries since AIRA was opened.' }

  return (
    <div className="sales-baru">
      <div className="sales-utama">
        <header className="sales-kepala inno-kepala">
          <span className="tile-ikon utama sales-kepala-ikon inno-kepala-ikon">
            <IconTabung />
          </span>
          <div className="sales-kepala-teks">
            <h1 className="inno-judul">Ask Sample TAT</h1>
            <p>A sample's journey from order to result — backlog, stage, TAT, and RNS. Patient identity is not shown.</p>
          </div>
          {/* Hiasan: mikroskop, rak tabung, kartu centang — meniru mockup. */}
          <svg className="sales-seni inno-seni" viewBox="0 0 260 130" aria-hidden="true">
            <rect x="8" y="112" width="130" height="10" rx="4" fill="#d5deeb" />
            <path d="M44 108h52M70 108V84" stroke="#8ba8d4" strokeWidth="8" strokeLinecap="round" />
            <path d="M58 86c-16-6-18-30-2-40" fill="none" stroke="#678dc7" strokeWidth="7" strokeLinecap="round" />
            <rect x="60" y="16" width="18" height="46" rx="6" fill="#386ab5" transform="rotate(28 69 39)" />
            <rect x="52" y="10" width="26" height="10" rx="4" fill="#194990" transform="rotate(28 65 15)" />
            <rect x="112" y="72" width="70" height="40" rx="6" fill="#e4ebf5" stroke="#ced8e6" />
            {[122, 140, 158].map((x) => (
              <g key={x}>
                <rect x={x} y="44" width="12" height="46" rx="6" fill="#ffffff" stroke="#bdcde5" strokeWidth="2" />
                <rect x={x + 2} y="66" width="8" height="22" rx="4" fill="#8ba8d4" />
              </g>
            ))}
            <rect x="192" y="18" width="62" height="36" rx="8" fill="#ffffff" stroke="#d5deeb" />
            <circle cx="206" cy="36" r="7" fill="#678dc7" />
            <path d="M203 36l2.5 2.5L210 33" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
            <rect x="218" y="32" width="28" height="5" rx="2.5" fill="#ced8e6" />
            <rect x="192" y="62" width="62" height="36" rx="8" fill="#ffffff" stroke="#d5deeb" />
            <rect x="202" y="76" width="44" height="5" rx="2.5" fill="#e4ebf5" />
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
            placeholder="Example: which samples do not have results yet?"
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
              {/* Hasil dikte DISISIPKAN ke kotak teks, tidak dikirim otomatis. */}
              <TombolDikte onTeks={(t) => setText((s) => (s.trim() ? `${s.trim()} ${t}` : t))} />
              <span className="gambar-pilih sales-sumber" title="ETL result table t_sample_tracker — Anatomical Pathology, from January 2026">
                Source: sample tracking (Anatomical Pathology)
              </span>
            </div>
            <button className="btn-send sales-tanya" disabled={!text.trim()} onClick={submit}>
              <IconSend size={15} /> Ask <IconArrowRight size={15} />
            </button>
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
                  <button
                    key={q}
                    onClick={() => (k.isi ? isiKotak(q) : onSubmit(q))}
                    title={k.isi ? 'Fills the box — complete the Order ID' : q}
                  >
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
            AIRA helps you ask about a sample's journey from order to result — backlog, stage, TAT, and RNS.
            The data comes from the ETL of the sample tracking table (Anatomical Pathology, from January 2026), not
            real-time. Patient identity is not shown.
          </p>
        </div>

        <div className="kartu-panel">
          <div className="kartu-panel-kepala">
            <h4>
              <IconDbKecil /> Data Source
            </h4>
          </div>
          <div className="sales-sumber-baris">
            <span>Sample tracking (Anatomical Pathology)</span>
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
              <IconInfo size={17} /> Usage Tips
            </h4>
          </div>
          <ul className="sales-tips">
            {TIPS.map((t, i) => (
              <li key={t}>
                <span className="centang">{i + 1}</span>
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

function IconTabung(): JSX.Element {
  return (
    <svg width={36} height={36} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 3h6M8 3v13a2 2 0 0 0 4 0V3M8 10h4" />
      <circle cx="17" cy="16" r="4" />
      <path d="M17 14v2l1.3 1" />
    </svg>
  )
}

function IconDbKecil(): JSX.Element {
  return (
    <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
    </svg>
  )
}
