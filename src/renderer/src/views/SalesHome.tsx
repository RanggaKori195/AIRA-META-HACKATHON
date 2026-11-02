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
    judul: 'Ringkasan & Perbandingan',
    ikon: <IconChart size={18} />,
    warna: 'hijau',
    contoh: [
      'Berapa sales hari ini?',
      'Sales bulan ini dibanding bulan lalu',
      'Tren penjualan harian bulan ini',
      'YTD tahun ini dibanding tahun lalu',
      'Buatkan laporan penjualan bulan ini',
      'Buatkan laporan penjualan bulan ini versi Excel'
    ]
  },
  {
    judul: 'Pemeriksaan',
    ikon: <IconCalendar size={18} />,
    warna: 'biru',
    contoh: [
      'Pemeriksaan apa yang paling laris bulan ini?',
      'Item apa yang trennya menurun?',
      'Kategori layanan apa yang paling besar bulan ini?',
      'Pemeriksaan apa yang paling sepi bulan ini?'
    ]
  },
  {
    judul: 'Pelanggan',
    ikon: <IconUsers size={18} />,
    warna: 'ungu',
    contoh: [
      '10 pelanggan terbesar 30 hari terakhir',
      'Pelanggan mana yang ordernya turun drastis?',
      'Pelanggan baru 90 hari terakhir siapa saja?',
      'Pelanggan mana yang berhenti order?'
    ]
  },
  {
    judul: 'Wilayah',
    ikon: <IconPin size={18} />,
    warna: 'oranye',
    contoh: [
      'Provinsi mana yang terbesar bulan ini?',
      'Sales per jenis pelanggan bulan ini',
      'Berapa sales di Jawa Barat bulan ini?'
    ]
  },
  {
    // Ditambahkan 21 Agu 2026. Tanpa dicontohkan di sini, tool ramalan praktis
    // tidak akan pernah ditemukan user.
    judul: 'Proyeksi & Ramalan',
    ikon: <IconTrend size={18} />,
    warna: 'merah',
    contoh: [
      'Proyeksi tutup bulan ini berapa?',
      'Prediksi penjualan 3 bulan ke depan',
      'Pemeriksaan apa yang sedang naik?'
    ]
  },
  {
    judul: 'ERP (ERP)',
    ikon: <IconDatabase size={18} />,
    warna: 'hijau',
    contoh: ['Sales order ERP bulan ini', 'Order yang belum masuk ERP bulan ini']
  }
]

const POPULER: Array<{ judul: string; tanya: string; ket: string; ikon: JSX.Element; warna: string }> = [
  {
    judul: 'Berapa sales hari ini?',
    tanya: 'Berapa sales hari ini?',
    ket: 'Total penjualan hari ini dengan perbandingannya.',
    ikon: <IconChart size={22} />,
    warna: 'hijau'
  },
  {
    judul: 'Sales bulan ini dibanding bulan lalu',
    tanya: 'Sales bulan ini dibanding bulan lalu',
    ket: 'Perbandingan periode sepadan bulan lalu.',
    ikon: <IconCalendar size={22} />,
    warna: 'biru'
  },
  {
    judul: 'Sales per wilayah',
    tanya: 'Provinsi mana yang terbesar bulan ini?',
    ket: 'Provinsi dengan penjualan terbesar bulan ini.',
    ikon: <IconTrend size={22} />,
    warna: 'ungu'
  },
  {
    judul: 'Top 10 pelanggan',
    tanya: '10 pelanggan terbesar 30 hari terakhir',
    ket: 'Pelanggan terbesar 30 hari terakhir.',
    ikon: <IconStar size={22} />,
    warna: 'kuning'
  }
]

/**
 * Periode yang DITEMPELKAN ke kalimat saat dikirim — terlihat utuh di gelembung
 * chat, jadi user tahu persis apa yang ditanyakan. Tidak ada filter tersembunyi.
 */
const PERIODE = ['hari ini', 'kemarin', 'minggu ini', 'bulan ini', 'bulan lalu', 'tahun ini (YTD)']

const TIPS = [
  'Gunakan bahasa yang jelas dan spesifik',
  'Sebutkan periode waktu',
  'Minta laporan PDF/Word/Excel bila perlu tabel & grafik',
  'Kombinasikan dengan filter (wilayah, pemeriksaan, pelanggan)'
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
  if (menit < 1) return 'baru saja'
  if (menit < 60) return `${menit} menit yang lalu`
  const jam = Math.round(menit / 60)
  if (jam < 24) return `${jam} jam yang lalu`
  const hari = Math.round(jam / 24)
  if (hari < 30) return `${hari} hari yang lalu`
  return new Date(ms).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
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
    onSubmit(periode && !trimmed.toLowerCase().includes(periode.toLowerCase()) ? `${trimmed} (periode: ${periode})` : trimmed)
    setText('')
  }

  // Pertanyaan terakhir = percakapan menu Sales milik user ini (sidebar sudah
  // tersaring per pemilik di main process).
  const riwayat = useMemo(() => sessions.filter((s) => s.mode === 'sales'), [sessions])

  const labelStatus =
    status === null
      ? null
      : !status.terkonfigurasi
        ? { teks: 'Belum dikonfigurasi', kelas: 'gagal', judul: 'Koneksi database sales tidak tertanam di aplikasi ini.' }
        : status.keadaan === 'terhubung'
          ? { teks: 'Terhubung', kelas: 'ok', judul: `Query terakhir berhasil, ${sejak(status.waktu!)}.` }
          : status.keadaan === 'gagal'
            ? { teks: 'Tidak terhubung', kelas: 'gagal', judul: `Koneksi terakhir gagal, ${sejak(status.waktu!)}. Periksa VPN/jaringan the company.` }
            : { teks: 'Belum diperiksa', kelas: 'belum', judul: 'Belum ada query sejak AIRA dibuka.' }

  return (
    <div className="sales-baru">
      <div className="sales-utama">
        <header className="sales-kepala">
          <span className="tile-ikon hijau sales-kepala-ikon">
            <IconChart size={28} />
          </span>
          <div className="sales-kepala-teks">
            <h1>Tanya Data Sales</h1>
            <p>
              Tanyakan pertanyaan seputar data penjualan — AIRA mengambil angkanya langsung dari database dan
              menjelaskannya, bukan perkiraan.
            </p>
          </div>
          {/* Hiasan: kartu grafik kecil, meniru mockup. */}
          <svg className="sales-seni" viewBox="0 0 220 110" aria-hidden="true">
            <rect x="8" y="10" width="150" height="92" rx="12" fill="#f2f8f4" stroke="#e1efe5" />
            <rect x="22" y="30" width="54" height="6" rx="3" fill="#cfe5d6" />
            <rect x="22" y="44" width="38" height="6" rx="3" fill="#dfeee4" />
            <polyline points="24,86 52,70 78,76 104,56 132,40" fill="none" stroke="#3fae63" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="132" cy="40" r="4" fill="#3fae63" />
            <rect x="150" y="62" width="14" height="36" rx="3" fill="#bfe3c9" />
            <rect x="170" y="46" width="14" height="52" rx="3" fill="#8fd0a3" />
            <rect x="190" y="28" width="14" height="70" rx="3" fill="#3fae63" />
            <path d="M188 16 L204 16 L204 32" fill="none" stroke="#3fae63" strokeWidth="2.5" strokeLinecap="round" />
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
            placeholder="Tulis pertanyaan Anda tentang data sales..."
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
              <span className="gambar-pilih sales-sumber" title="Menu ini hanya membaca database penjualan (SalesRepository)">
                <IconDatabase size={16} /> Sumber: SalesRepository
              </span>
              <label className="gambar-pilih" title="Periode ditempelkan ke pertanyaanmu saat dikirim">
                <IconCalendar size={16} />
                <select value={periode} onChange={(e) => setPeriode(e.target.value)}>
                  <option value="">Periode</option>
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
          <button className="beranda-tautan" onClick={() => setDibuka(dibuka === 'semua' ? null : 'semua')}>
            {dibuka === 'semua' ? 'Ringkas contoh' : 'Lihat semua contoh'} <IconArrowRight size={14} />
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
          <h3>Kategori Pertanyaan</h3>
          <span className="sales-kanan-teks">Pilih kategori atau langsung ketik pertanyaan</span>
        </div>
        <div className="sales-kategori">
          {KELOMPOK.map((k) => {
            const semua = dibuka === 'semua' || dibuka === k.judul
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
                {k.contoh.length > 3 && dibuka !== 'semua' && (
                  <button className="beranda-tautan kategori-lagi" onClick={() => setDibuka(semua ? null : k.judul)}>
                    {semua ? 'Lebih sedikit' : `Lihat semua (${k.contoh.length})`} <IconArrowRight size={13} />
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
              <IconInfo size={17} /> Tentang Menu Ini
            </h4>
          </div>
          <p className="panel-kosong">
            AIRA memakai data transaksi dari SalesRepository untuk menjawab pertanyaan tentang penjualan,
            pelanggan, pemeriksaan, dan wilayah. Angkanya dihitung sistem dari database (ringkasan, tanpa data
            pasien); sales dihitung dari tanggal hasil/invoice. Hasil bisa diminta sebagai laporan PDF, Word,
            atau Excel lengkap dengan grafik.
          </p>
          <div className="kartu-panel-kepala sales-sumber-kepala">
            <h4>
              <IconDatabase size={17} /> Sumber Data
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
            {riwayat.length > 4 && (
              <button className="beranda-tautan" onClick={() => setSemuaRiwayat((x) => !x)}>
                {semuaRiwayat ? 'Lebih sedikit' : 'Lihat semua'}
              </button>
            )}
          </div>
          {riwayat.length === 0 ? (
            <p className="panel-kosong">Pertanyaan yang kamu ajukan di menu ini akan muncul di sini.</p>
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
