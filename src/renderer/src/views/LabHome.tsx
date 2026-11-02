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
    judul: 'Yang Belum Keluar',
    ket: 'Sampel yang hasilnya belum keluar beserta status dan backlog.',
    ikon: <IconClock size={26} />,
    warna: 'merah',
    contoh: [
      'Sample apa saja yang belum keluar hasilnya?',
      'Berapa backlog Molekuler bulan ini?',
      'Ada sampel yang sudah divalidasi analis tapi hasilnya belum keluar?',
      'Sampel mana yang paling lama menggantung di lab?'
    ]
  },
  {
    judul: 'Lacak Satu Order',
    ket: 'Telusuri perjalanan satu sampel dari penerimaan hingga hasil. Butuh Order ID.',
    ikon: <IconSearch size={26} />,
    warna: 'biru',
    isi: true,
    contoh: [
      'Order ID … tahapnya sedang di mana?',
      'Sudah sampai mana sampel untuk Order ID …?',
      'Berapa lama sampel dengan Order ID … sudah diproses?'
    ]
  },
  {
    judul: 'RNS (Sampel Diambil Ulang)',
    ket: 'Sampel yang harus diambil ulang dan penggantinya.',
    ikon: <IconFileText size={26} />,
    warna: 'ungu',
    contoh: [
      'Sample apa saja yang RNS terbanyak?',
      'Berapa RNS yang sampel penggantinya belum datang?',
      'Pemeriksaan mana yang rasio RNS-nya paling tinggi?'
    ]
  },
  {
    judul: 'TAT',
    ket: 'Waktu penyelesaian di tiap kategori dan tahap pemeriksaan.',
    ikon: <IconTrend size={26} />,
    warna: 'hijau',
    contoh: [
      'Berapa TAT rata-rata per kategori bulan ini?',
      'Pemeriksaan mana yang TAT-nya paling lama?',
      'Berapa lama tahap preparasi untuk Histologi?'
    ]
  },
  {
    judul: 'Analisis Bottleneck',
    ket: 'Temukan tahap dan pemeriksaan yang paling menghambat alur sampel.',
    ikon: <IconBars />,
    warna: 'oranye',
    contoh: [
      'Di tahap mana sampel paling banyak tertahan saat ini?',
      'Pemeriksaan apa yang p90 TAT-nya paling lama?',
      'Berapa jumlah sampel per tahap saat ini?'
    ]
  }
]

const TIPS = [
  'Untuk melacak, tulis Order ID lengkap',
  'Sebutkan periode, kategori, pemeriksaan, atau nama pelanggan',
  'Data berasal dari ETL (bukan real-time) — waktu pembaruannya selalu disebut',
  'Gunakan bahasa yang natural dan sederhana'
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
  if (menit < 1) return 'baru saja'
  if (menit < 60) return `${menit} menit yang lalu`
  const jam = Math.round(menit / 60)
  if (jam < 24) return `${jam} jam yang lalu`
  const hari = Math.round(jam / 24)
  if (hari < 30) return `${hari} hari yang lalu`
  return new Date(ms).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
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
        ? { teks: 'Belum dikonfigurasi', kelas: 'gagal', judul: 'Koneksi database tidak tertanam di aplikasi ini.' }
        : status.keadaan === 'terhubung'
          ? { teks: 'Terhubung', kelas: 'ok', judul: `Query terakhir berhasil, ${sejak(status.waktu!)}.` }
          : status.keadaan === 'gagal'
            ? { teks: 'Tidak terhubung', kelas: 'gagal', judul: `Koneksi terakhir gagal, ${sejak(status.waktu!)}. Periksa VPN/jaringan the company.` }
            : { teks: 'Belum diperiksa', kelas: 'belum', judul: 'Belum ada query sejak AIRA dibuka.' }

  return (
    <div className="sales-baru">
      <div className="sales-utama">
        <header className="sales-kepala inno-kepala">
          <span className="tile-ikon hijau sales-kepala-ikon inno-kepala-ikon">
            <IconTabung />
          </span>
          <div className="sales-kepala-teks">
            <h1 className="inno-judul">Tanya TAT Sample</h1>
            <p>Perjalanan sampel dari order sampai hasil keluar — backlog, tahap, TAT, dan RNS. Identitas pasien tidak disajikan.</p>
          </div>
          {/* Hiasan: mikroskop, rak tabung, kartu centang — meniru mockup. */}
          <svg className="sales-seni inno-seni" viewBox="0 0 260 130" aria-hidden="true">
            <rect x="8" y="112" width="130" height="10" rx="4" fill="#d6eadc" />
            <path d="M44 108h52M70 108V84" stroke="#8fd0a3" strokeWidth="8" strokeLinecap="round" />
            <path d="M58 86c-16-6-18-30-2-40" fill="none" stroke="#6cc28a" strokeWidth="7" strokeLinecap="round" />
            <rect x="60" y="16" width="18" height="46" rx="6" fill="#3fae63" transform="rotate(28 69 39)" />
            <rect x="52" y="10" width="26" height="10" rx="4" fill="#1f8a4c" transform="rotate(28 65 15)" />
            <rect x="112" y="72" width="70" height="40" rx="6" fill="#e5f4ea" stroke="#cfe5d6" />
            {[122, 140, 158].map((x) => (
              <g key={x}>
                <rect x={x} y="44" width="12" height="46" rx="6" fill="#ffffff" stroke="#bfe3c9" strokeWidth="2" />
                <rect x={x + 2} y="66" width="8" height="22" rx="4" fill="#8fd0a3" />
              </g>
            ))}
            <rect x="192" y="18" width="62" height="36" rx="8" fill="#ffffff" stroke="#d6eadc" />
            <circle cx="206" cy="36" r="7" fill="#6cc28a" />
            <path d="M203 36l2.5 2.5L210 33" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
            <rect x="218" y="32" width="28" height="5" rx="2.5" fill="#cfe5d6" />
            <rect x="192" y="62" width="62" height="36" rx="8" fill="#ffffff" stroke="#d6eadc" />
            <rect x="202" y="76" width="44" height="5" rx="2.5" fill="#e5f4ea" />
          </svg>
          <div className="sales-titik3" onClick={(e) => e.stopPropagation()}>
            <button className="btn-mini" title="Pilihan" onClick={() => setMenu((x) => !x)}>
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
                  Panduan menu ini
                </button>
              </div>
            )}
          </div>
        </header>

        <div className="task-box sales-kotak">
          <textarea
            ref={kotak}
            placeholder="Contoh: sample apa saja yang belum keluar hasilnya?"
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
              <span className="gambar-pilih sales-sumber" title="Tabel hasil ETL t_sample_tracker — Patologi Anatomi, mulai Januari 2026">
                Sumber: pelacakan sampel (Patologi Anatomi)
              </span>
            </div>
            <button className="btn-send sales-tanya" disabled={!text.trim()} onClick={submit}>
              <IconSend size={15} /> Tanya <IconArrowRight size={15} />
            </button>
          </div>
        </div>

        <div className="beranda-kepala">
          <h3>
            <IconZap size={17} /> Contoh pertanyaan populer
          </h3>
          <span>Klik salah satu untuk langsung bertanya</span>
          <button className="beranda-tautan" onClick={() => setSemua((x) => !x)}>
            {semua ? 'Ringkas contoh' : 'Lihat semua contoh'} <IconArrowRight size={14} />
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
                    title={k.isi ? 'Isi ke kotak — lengkapi Order ID-nya' : q}
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
              <IconInfo size={17} /> Tentang Menu Ini
            </h4>
          </div>
          <p className="panel-kosong">
            AIRA membantu menanyakan perjalanan sampel dari order sampai hasil keluar — backlog, tahap, TAT, dan RNS.
            Datanya hasil ETL tabel pelacakan sampel (Patologi Anatomi, mulai Januari 2026), bukan real-time. Identitas
            pasien tidak disajikan.
          </p>
        </div>

        <div className="kartu-panel">
          <div className="kartu-panel-kepala">
            <h4>
              <IconDbKecil /> Sumber Data
            </h4>
          </div>
          <div className="sales-sumber-baris">
            <span>Pelacakan sampel (Patologi Anatomi)</span>
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
              <IconInfo size={17} /> Tips Menggunakan
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
              <IconHistory size={17} /> Pertanyaan Terakhir
            </h4>
            {riwayat.length > 5 && (
              <button className="beranda-tautan" onClick={() => setSemuaRiwayat((x) => !x)}>
                {semuaRiwayat ? 'Lebih sedikit' : 'Lihat semua'}
              </button>
            )}
          </div>
          {riwayat.length === 0 ? (
            <p className="panel-kosong">Pertanyaan yang kamu ajukan di menu ini akan muncul di sini.</p>
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
