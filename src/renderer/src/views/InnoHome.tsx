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
    judul: 'Pelanggan & PKS',
    ket: 'Data pelanggan terdaftar, special price, dan perjanjian kerja sama (PKS).',
    ikon: <IconUsers size={24} />,
    warna: 'hijau',
    contoh: [
      'Apakah RS Brawijaya sudah terdaftar?',
      'Tolong carikan special price RSUP Dr. Kariadi',
      'Apakah RSUD Dr. Soebandi sudah ada PKS?'
    ]
  },
  {
    judul: 'Harga Pemeriksaan',
    ket: 'Harga K1 (B2B/Corporate) & K2 (B2C), dan harga khusus per pelanggan.',
    ikon: <IconRupiah />,
    warna: 'biru',
    contoh: [
      'Berapa harga pemeriksaan TB-IGRA Quantiferon Gold?',
      'Siapa saja yang dapat harga khusus untuk MammaPrint?',
      'Berapa harga B2B dan B2C untuk HPV DNA?'
    ]
  },
  {
    judul: 'Jenis & Kelompok Item',
    ket: 'Item pemeriksaan per jenis, lab, grup, dan kelompok harga.',
    ikon: <IconLayers size={24} />,
    warna: 'ungu',
    contoh: [
      'Pemeriksaan paket apa saja yang terdaftar?',
      'Item Patologi Anatomi apa saja yang ada?',
      'Keluarkan item pemeriksaan C Coret',
      'Pemeriksaan apa saja di grup Hematologi?'
    ]
  },
  {
    judul: 'Isi Paket',
    ket: 'Rincian isi paket pemeriksaan dan item di dalamnya.',
    ikon: <IconList size={24} />,
    warna: 'oranye',
    contoh: ['Paket MCU itu isinya apa saja?', 'Berapa item di dalam paket itu, dan mana yang non lab?']
  },
  {
    judul: 'Dokter',
    ket: 'Dokter/klinisi yang terdaftar di master, dicari per nama atau kode.',
    ikon: <IconUser size={24} />,
    warna: 'merah',
    contoh: ['Apakah dr. Citra Dewi terdaftar?', 'Berapa dokter yang terdaftar?']
  }
]

/**
 * "Jenis data" DITEMPELKAN ke kalimat saat dikirim — terlihat utuh di gelembung
 * chat. Membantu model memilih tool yang tepat tanpa filter tersembunyi.
 */
const JENIS_DATA = ['pelanggan', 'item & harga', 'special price', 'PKS', 'dokter', 'isi paket']

const TIPS = [
  'Gunakan nama RS, item, atau dokter yang jelas dan spesifik',
  'Sebutkan jenis data yang dibutuhkan (harga, PKS, item, dll)',
  'Harga yang disajikan hanya K1 (B2B/Corporate) dan K2 (B2C)',
  'Gunakan bahasa yang natural dan sederhana'
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
  if (menit < 1) return 'baru saja'
  if (menit < 60) return `${menit} menit yang lalu`
  const jam = Math.round(menit / 60)
  if (jam < 24) return `${jam} jam yang lalu`
  const hari = Math.round(jam / 24)
  if (hari < 30) return `${hari} hari yang lalu`
  return new Date(ms).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
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
    onSubmit(jenis && !trimmed.toLowerCase().includes(jenis.toLowerCase()) ? `${trimmed} (jenis data: ${jenis})` : trimmed)
    setText('')
  }

  const riwayat = useMemo(() => sessions.filter((s) => s.mode === 'masterdata'), [sessions])

  const labelStatus =
    status === null
      ? null
      : !status.terkonfigurasi
        ? { teks: 'Belum dikonfigurasi', kelas: 'gagal', judul: 'Koneksi Master Data tidak tertanam di aplikasi ini.' }
        : status.keadaan === 'terhubung'
          ? { teks: 'Terhubung', kelas: 'ok', judul: `Query terakhir berhasil, ${sejak(status.waktu!)}.` }
          : status.keadaan === 'gagal'
            ? { teks: 'Tidak terhubung', kelas: 'gagal', judul: `Koneksi terakhir gagal, ${sejak(status.waktu!)}. Periksa VPN/jaringan the company.` }
            : { teks: 'Belum diperiksa', kelas: 'belum', judul: 'Belum ada pertanyaan Master Data sejak AIRA dibuka — status terlihat sesudah pertanyaan pertama.' }

  return (
    <div className="sales-baru">
      <div className="sales-utama">
        <header className="sales-kepala inno-kepala">
          <span className="tile-ikon hijau sales-kepala-ikon inno-kepala-ikon">
            <IconDatabase size={34} />
          </span>
          <div className="sales-kepala-teks">
            <h1 className="inno-judul">Ask Master Data</h1>
            <p>Pelanggan terdaftar, item &amp; harga, special price, PKS, dan dokter — langsung dari master data the lab.</p>
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
            placeholder="Contoh: tolong carikan special price RS Kariadi"
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
              <span className="gambar-pilih sales-sumber" title="Menu ini hanya membaca master data Master Data">
                <IconDatabase size={16} /> Sumber: Master Data (master data)
              </span>
              <label className="gambar-pilih" title="Jenis data ditempelkan ke pertanyaanmu saat dikirim">
                <IconFileText size={16} />
                <select value={jenis} onChange={(e) => setJenis(e.target.value)}>
                  <option value="">Jenis data</option>
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
                Tanya <IconArrowRight size={15} />
              </button>
            </div>
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
              <IconInfo size={17} /> Tentang Menu Ini
            </h4>
          </div>
          <p className="panel-kosong">
            AIRA memakai master data Master Data untuk menjawab pertanyaan tentang pelanggan, item &amp; harga,
            special price, PKS, isi paket, dan dokter. Data diambil langsung dari master data the lab. Menu ini tidak
            membaca data transaksi — untuk angka penjualan, pakai Tanya Data Sales.
          </p>
        </div>

        <div className="kartu-panel">
          <div className="kartu-panel-kepala">
            <h4>
              <IconDatabase size={17} /> Sumber Data
            </h4>
          </div>
          <div className="sales-sumber-baris">
            <span>
              <IconDatabase size={14} /> Master Data (master data)
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
              <IconBook size={17} /> Tips Menggunakan
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
