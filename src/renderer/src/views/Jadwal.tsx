import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { ChatMode, ItemJadwal, JalanDenganTugas, JenisJadwal, PolaJadwal } from '@shared/ipc'
import { berikutnya, kejadianDalam, tafsirkanKalimat } from '@shared/jadwal-pola'
import { TombolDikte } from '../components/TombolDikte'
import ConfirmDialog from '../components/ConfirmDialog'
import {
  IconArrowRight,
  IconBell,
  IconBulb,
  IconCalendar,
  IconChart,
  IconCheck,
  IconClock,
  IconClose,
  IconFileText,
  IconFlask,
  IconList,
  IconMore,
  IconPlus,
  IconSend,
  IconSparkle,
  IconSparkleSolid,
  IconSpinner,
  IconTimeline,
  IconUsers
} from '../components/Icons'

// Layar "Jadwal" — tugas yang dijalankan AIRA sendiri pada jam tertentu
// (29 Sep 2026; tata letak mengikuti mockup user: statistik, kalender, agenda
// harian, Tugas Mendatang, "Minta AIRA menjadwalkan", template).
//
// ⚠️ Keputusan user: tugas berjalan DI LAPTOP selama AIRA menyala (termasuk di
// tray), bukan di server. Batas itu WAJIB terbaca di layar — tugas yang diam-diam
// tidak jalan karena laptop mati terlihat seperti fitur yang rusak.
// ⚠️ Semua yang tampil di kalender berasal dari tugas ASLI user: hari yang sudah
// lewat = riwayat jalan yang tercatat; hari mendatang = dihitung dari pola lewat
// `@shared/jadwal-pola` — rumus yang SAMA dengan penjadwal di main process.
// ⚠️ Semua data lewat main process yang memeriksa pemilik dari SESI.

const LABEL_MODE: Record<ChatMode, string> = {
  general: 'Task Baru',
  sales: 'Data Sales',
  masterdata: 'Data Master Data',
  lab: 'TAT Sample',
  onedrive: 'Microsoft 365'
}

const LABEL_MODE_PANJANG: Record<ChatMode, string> = {
  general: 'Task Baru',
  sales: 'Tanya Data Sales',
  masterdata: 'Ask Master Data',
  lab: 'Tanya TAT Sample',
  onedrive: 'Tanya Microsoft 365'
}

/** Warna per sumber — dipakai titik kalender, ubin ikon, dan chip. */
function warna(jenis: JenisJadwal, mode: ChatMode): string {
  if (jenis === 'pengingat') return 'merah'
  return { general: 'hijau', sales: 'ungu', masterdata: 'oranye', lab: 'biru', onedrive: 'biru' }[mode]
}

function labelSumber(jenis: JenisJadwal, mode: ChatMode): string {
  return jenis === 'pengingat' ? 'Pengingat' : LABEL_MODE[mode]
}

function IkonSumber({ jenis, mode }: { jenis: JenisJadwal; mode: ChatMode }): JSX.Element {
  if (jenis === 'pengingat') return <IconBell size={17} />
  if (mode === 'sales') return <IconChart size={17} />
  if (mode === 'lab') return <IconFlask size={17} />
  if (mode === 'masterdata') return <IconList size={17} />
  return <IconFileText size={17} />
}

const HARI_PENDEK = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']

type Jenis = PolaJadwal['jenis']

const LABEL_JENIS: Record<Jenis, string> = {
  harian: 'Tiap hari',
  hari_kerja: 'Tiap hari kerja (Sen–Jum)',
  mingguan: 'Tiap minggu',
  bulanan: 'Tiap bulan',
  sekali: 'Sekali saja'
}

interface Templat {
  judul: string
  ket: string
  jenis: JenisJadwal
  mode: ChatMode
  nama: string
  prompt: string
  pola: PolaJadwal
  ikon: JSX.Element
  warna: string
}

/** Template — hanya ditampilkan bila menunya boleh dibuka user ini. Mengisi form, tidak menyimpan. */
const TEMPLAT: Templat[] = [
  {
    judul: 'Ringkasan sales harian',
    ket: 'Otomatis setiap pagi hari kerja',
    jenis: 'aira',
    mode: 'sales',
    nama: 'Ringkasan sales harian',
    prompt: 'Buatkan ringkasan sales kemarin dibanding hari yang sama minggu lalu.',
    pola: { jenis: 'hari_kerja', jam: '07:30' },
    ikon: <IconChart size={18} />,
    warna: 'oranye'
  },
  {
    judul: 'Laporan sales bulanan',
    ket: 'Setiap tanggal 1, untuk bulan lalu',
    jenis: 'aira',
    mode: 'sales',
    nama: 'Laporan sales bulanan',
    prompt: 'Buatkan laporan sales bulan lalu per region dalam Excel, lengkap dengan grafik.',
    pola: { jenis: 'bulanan', tanggal: 1, jam: '07:30' },
    ikon: <IconFileText size={18} />,
    warna: 'hijau'
  },
  {
    judul: 'Cek backlog sampel',
    ket: 'Setiap hari kerja sore',
    jenis: 'aira',
    mode: 'lab',
    nama: 'Cek backlog sampel',
    prompt: 'Tampilkan backlog sampel lab saat ini dan sebutkan yang umurnya lebih dari 3 hari.',
    pola: { jenis: 'hari_kerja', jam: '16:00' },
    ikon: <IconFlask size={18} />,
    warna: 'biru'
  },
  {
    judul: 'Rapat tim',
    ket: 'Pengingat setiap minggu',
    jenis: 'pengingat',
    mode: 'general',
    nama: 'Rapat tim mingguan',
    prompt: 'Rapat tim mingguan — siapkan update pekerjaanmu.',
    pola: { jenis: 'mingguan', hari: [1], jam: '09:00' },
    ikon: <IconUsers size={18} />,
    warna: 'hijau'
  },
  {
    judul: 'Reminder tugas',
    ket: 'Pengingat harian',
    jenis: 'pengingat',
    mode: 'general',
    nama: 'Cek daftar tugas',
    prompt: 'Periksa daftar tugas hari ini.',
    pola: { jenis: 'harian', jam: '08:00' },
    ikon: <IconBell size={18} />,
    warna: 'merah'
  }
]

interface Draf {
  id: string | null
  jenis: JenisJadwal
  nama: string
  prompt: string
  mode: ChatMode
  pola: Jenis
  jam: string
  hari: number[]
  tanggalBulan: number
  tanggal: string
  /** Catatan dari "Minta AIRA menjadwalkan" — apa yang dibaca & apa yang belum. */
  catatan: string | null
}

const dua = (n: number): string => String(n).padStart(2, '0')
const iso = (d: Date): string => `${d.getFullYear()}-${dua(d.getMonth() + 1)}-${dua(d.getDate())}`
const awalHari = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const tambahHari = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const hariSama = (a: Date, b: Date): boolean => iso(a) === iso(b)

function drafKosong(jenis: JenisJadwal): Draf {
  return {
    id: null,
    jenis,
    nama: '',
    prompt: '',
    mode: 'general',
    pola: jenis === 'pengingat' ? 'sekali' : 'hari_kerja',
    jam: '08:00',
    hari: [1],
    tanggalBulan: 1,
    tanggal: iso(tambahHari(new Date(), 1)),
    catatan: null
  }
}

function drafDari(x: {
  id?: string
  jenis: JenisJadwal
  nama: string
  prompt: string
  mode: ChatMode
  pola: PolaJadwal | null
}): Draf {
  const d: Draf = { ...drafKosong(x.jenis), id: x.id ?? null, nama: x.nama, prompt: x.prompt, mode: x.mode }
  if (x.pola) {
    d.pola = x.pola.jenis
    d.jam = x.pola.jam
    if (x.pola.jenis === 'mingguan') d.hari = x.pola.hari
    if (x.pola.jenis === 'bulanan') d.tanggalBulan = x.pola.tanggal
    if (x.pola.jenis === 'sekali') d.tanggal = x.pola.tanggal
  }
  return d
}

function polaDari(d: Draf): PolaJadwal {
  switch (d.pola) {
    case 'harian':
    case 'hari_kerja':
      return { jenis: d.pola, jam: d.jam }
    case 'mingguan':
      return { jenis: 'mingguan', hari: d.hari, jam: d.jam }
    case 'bulanan':
      return { jenis: 'bulanan', tanggal: d.tanggalBulan, jam: d.jam }
    case 'sekali':
      return { jenis: 'sekali', tanggal: d.tanggal, jam: d.jam }
  }
}

const jamDari = (ms: number): string => {
  const d = new Date(ms)
  return `${dua(d.getHours())}:${dua(d.getMinutes())}`
}

const tanggalPanjang = (d: Date): string =>
  d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

const tanggalPendek = (ms: number): string =>
  new Date(ms).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })

/** Pesan galat IPC tanpa awalan "Error invoking remote method …". */
function pesanGalat(err: unknown): string {
  const s = String(err instanceof Error ? err.message : err)
  return s.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** Satu baris di kalender/agenda/daftar: riwayat nyata ATAU hasil hitungan pola. */
interface Entri {
  kunci: string
  waktu: number
  jadwalId: string
  nama: string
  prompt: string
  mode: ChatMode
  jenis: JenisJadwal
  status: 'akan' | 'tertunda' | 'jalan' | 'ok' | 'gagal' | 'ditolak'
  keterangan: string | null
  sessionId: string | null
}

const LABEL_STATUS: Record<Entri['status'], string> = {
  akan: 'Akan datang',
  tertunda: 'Tertunda',
  jalan: 'Berjalan',
  ok: 'Selesai',
  gagal: 'Gagal',
  ditolak: 'Tidak dijalankan'
}

/**
 * Menyusun entri dalam `[dari, sampai)`: yang sudah lewat dari riwayat jalan,
 * yang akan datang dari pola. Tugas yang jatuh tempo tapi belum jalan (laptop
 * mati) ditandai "tertunda" pada waktu seharusnya — bukan dihilangkan.
 */
function susunEntri(item: ItemJadwal[], jalan: JalanDenganTugas[], dari: Date, sampai: Date, kini: number): Entri[] {
  const hasil: Entri[] = []
  const peta = new Map(item.map((i) => [i.id, i]))
  for (const r of jalan) {
    if (r.dijadwalkan < dari.getTime() || r.dijadwalkan >= sampai.getTime()) continue
    hasil.push({
      kunci: `r-${r.jadwalId}-${r.mulai}`,
      waktu: r.dijadwalkan,
      jadwalId: r.jadwalId,
      nama: r.nama,
      prompt: peta.get(r.jadwalId)?.prompt ?? '',
      mode: r.mode,
      jenis: r.jenis,
      status: r.status,
      keterangan: r.keterangan,
      sessionId: r.sessionId
    })
  }
  const mulaiProyeksi = new Date(Math.max(dari.getTime(), kini))
  for (const i of item) {
    if (!i.aktif) continue
    if (i.berikut !== null && i.berikut < kini && i.berikut >= dari.getTime() && i.berikut < sampai.getTime()) {
      hasil.push({ ...dasar(i), kunci: `t-${i.id}`, waktu: i.berikut, status: 'tertunda' })
    }
    for (const t of kejadianDalam(i.pola, mulaiProyeksi, sampai, 120)) {
      hasil.push({ ...dasar(i), kunci: `p-${i.id}-${t.getTime()}`, waktu: t.getTime(), status: 'akan' })
    }
  }
  return hasil.sort((a, b) => a.waktu - b.waktu)
}

function dasar(i: ItemJadwal): Omit<Entri, 'kunci' | 'waktu' | 'status'> {
  return {
    jadwalId: i.id,
    nama: i.nama,
    prompt: i.prompt,
    mode: i.mode,
    jenis: i.jenis,
    keterangan: null,
    sessionId: null
  }
}

const KUNCI_TIPS = 'aira.jadwal.tipsDitutup'

export default function Jadwal({
  menu,
  onBukaSesi
}: {
  /** Menu data yang boleh dibuka user ini (dari sesi). */
  menu: string[]
  onBukaSesi: (sessionId: string, mode: ChatMode) => void
}): JSX.Element {
  const [item, setItem] = useState<ItemJadwal[] | null>(null)
  const [jalan, setJalan] = useState<JalanDenganTugas[]>([])
  const [draf, setDraf] = useState<Draf | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sibuk, setSibuk] = useState(false)
  const [hapus, setHapus] = useState<ItemJadwal | null>(null)
  const [tampilan, setTampilan] = useState<'kalender' | 'daftar' | 'timeline'>('kalender')
  const [bulan, setBulan] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [dipilih, setDipilih] = useState(() => awalHari(new Date()))
  const [menuEntri, setMenuEntri] = useState<string | null>(null)
  const [menuBaru, setMenuBaru] = useState(false)
  const [minta, setMinta] = useState('')
  const [kini, setKini] = useState(() => Date.now())
  const [tipsDitutup, setTipsDitutup] = useState(() => {
    try {
      return localStorage.getItem(KUNCI_TIPS) === '1'
    } catch {
      return false
    }
  })

  const modeBoleh: ChatMode[] = (['general', 'sales', 'masterdata', 'lab', 'onedrive'] as ChatMode[]).filter(
    (m) => m === 'general' || menu.includes(m)
  )

  // Rentang riwayat yang diambil: bulan yang sedang dilihat + minggu & bulan
  // BERJALAN (untuk statistik), apa pun bulan yang sedang dibuka.
  const rentang = useMemo(() => {
    const h = awalHari(new Date(kini))
    const awalMinggu = tambahHari(h, -h.getDay())
    const awalBulanIni = new Date(h.getFullYear(), h.getMonth(), 1)
    const awalGrid = tambahHari(bulan, -bulan.getDay())
    const dari = Math.min(awalGrid.getTime(), awalMinggu.getTime(), awalBulanIni.getTime())
    const sampai = Math.max(
      tambahHari(awalGrid, 42).getTime(),
      tambahHari(awalMinggu, 7).getTime(),
      new Date(h.getFullYear(), h.getMonth() + 1, 1).getTime()
    )
    return { dari, sampai }
  }, [bulan, kini])

  const muat = useCallback(async () => {
    try {
      const [daftar, r] = await Promise.all([
        window.aira.jadwalDaftar(),
        window.aira.jadwalJalanRentang(rentang.dari, rentang.sampai)
      ])
      setItem(daftar)
      setJalan(r)
      setKini(Date.now())
    } catch (err) {
      setError(pesanGalat(err))
    }
  }, [rentang])

  useEffect(() => {
    void muat()
    return window.aira.onJadwalBerubah(() => void muat())
  }, [muat])

  // Jam dinding untuk status "akan datang/tertunda" — diperbarui tiap menit.
  useEffect(() => {
    const t = setInterval(() => setKini(Date.now()), 60_000)
    const tutup = (): void => {
      setMenuEntri(null)
      setMenuBaru(false)
    }
    window.addEventListener('click', tutup)
    return () => {
      clearInterval(t)
      window.removeEventListener('click', tutup)
    }
  }, [])

  const aksi = async (fn: () => Promise<ItemJadwal[]>): Promise<boolean> => {
    setSibuk(true)
    setError(null)
    try {
      setItem(await fn())
      void muat()
      return true
    } catch (err) {
      setError(pesanGalat(err))
      return false
    } finally {
      setSibuk(false)
    }
  }

  const simpan = async (): Promise<void> => {
    if (!draf) return
    const ok = await aksi(() =>
      window.aira.jadwalSimpan({
        id: draf.id,
        jenis: draf.jenis,
        nama: draf.nama,
        prompt: draf.prompt,
        mode: draf.jenis === 'pengingat' ? 'general' : draf.mode,
        pola: polaDari(draf)
      })
    )
    if (ok) setDraf(null)
  }

  const mintaAira = (): void => {
    const teks = minta.trim()
    if (!teks) return
    const t = tafsirkanKalimat(teks, new Date())
    const mode = modeBoleh.includes(t.mode) ? t.mode : 'general'
    const d = drafDari({ ...t, mode })
    d.catatan = t.pola
      ? 'Diisi dari kalimatmu — periksa dulu sebelum menyimpan.'
      : 'Kapan dijalankannya tidak terbaca dari kalimatmu — pilih sendiri di bawah.'
    if (t.mode !== mode) d.catatan += ` Menu "${LABEL_MODE_PANJANG[t.mode]}" tidak tersedia untukmu, jadi dipakai Task Baru.`
    setDraf(d)
    setMinta('')
  }

  const ubah = (patch: Partial<Draf>): void => setDraf((d) => (d ? { ...d, ...patch } : d))

  const semua = item ?? []
  const hariIni = awalHari(new Date(kini))

  // --- statistik
  const statistik = useMemo(() => {
    const awalMinggu = tambahHari(hariIni, -hariIni.getDay())
    const awalBulanIni = new Date(hariIni.getFullYear(), hariIni.getMonth(), 1)
    const akhirBulanIni = new Date(hariIni.getFullYear(), hariIni.getMonth() + 1, 1)
    return {
      hariIni: susunEntri(semua, jalan, hariIni, tambahHari(hariIni, 1), kini).length,
      minggu: susunEntri(semua, jalan, awalMinggu, tambahHari(awalMinggu, 7), kini).length,
      tertunda: semua.filter((i) => i.aktif && i.berikut !== null && i.berikut < kini - 5 * 60_000).length,
      selesai: jalan.filter(
        (r) => r.status === 'ok' && r.dijadwalkan >= awalBulanIni.getTime() && r.dijadwalkan < akhirBulanIni.getTime()
      ).length,
      namaBulan: hariIni.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' })
    }
  }, [semua, jalan, kini, hariIni])

  // --- kalender
  const awalGrid = tambahHari(bulan, -bulan.getDay())
  const entriGrid = useMemo(
    () => susunEntri(semua, jalan, awalGrid, tambahHari(awalGrid, 42), kini),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [semua, jalan, kini, bulan]
  )
  const perHari = useMemo(() => {
    const m = new Map<string, Entri[]>()
    for (const e of entriGrid) {
      const k = iso(new Date(e.waktu))
      m.set(k, [...(m.get(k) ?? []), e])
    }
    return m
  }, [entriGrid])

  const agenda = useMemo(
    () => susunEntri(semua, jalan, dipilih, tambahHari(dipilih, 1), kini),
    [semua, jalan, dipilih, kini]
  )
  const mendatang = useMemo(
    () => susunEntri(semua, [], new Date(kini), tambahHari(hariIni, 62), kini).slice(0, 8),
    [semua, kini, hariIni]
  )
  const timeline = useMemo(() => {
    const e = susunEntri(semua, jalan, tambahHari(hariIni, -3), tambahHari(hariIni, 15), kini)
    const m = new Map<string, Entri[]>()
    for (const x of e) {
      const k = iso(new Date(x.waktu))
      m.set(k, [...(m.get(k) ?? []), x])
    }
    return [...m.entries()]
  }, [semua, jalan, hariIni, kini])

  const pindahBulan = (n: number): void => setBulan((b) => new Date(b.getFullYear(), b.getMonth() + n, 1))
  const keHariIni = (): void => {
    setBulan(new Date(hariIni.getFullYear(), hariIni.getMonth(), 1))
    setDipilih(hariIni)
    setTampilan('kalender')
  }

  const MenuEntri = ({ e }: { e: Entri }): JSX.Element => {
    const i = semua.find((x) => x.id === e.jadwalId)
    return (
      <div className="menu-berkas jadwal-menu" onClick={(ev) => ev.stopPropagation()}>
        {e.sessionId && (
          <button
            onClick={() => {
              setMenuEntri(null)
              onBukaSesi(e.sessionId!, e.mode)
            }}
          >
            Buka hasil
          </button>
        )}
        {i && (
          <>
            <button
              disabled={sibuk}
              onClick={() => {
                setMenuEntri(null)
                void aksi(() => window.aira.jadwalJalankan(i.id))
              }}
            >
              Jalankan sekarang
            </button>
            <button
              onClick={() => {
                setMenuEntri(null)
                setDraf(drafDari(i))
              }}
            >
              Ubah
            </button>
            <button
              disabled={sibuk}
              onClick={() => {
                setMenuEntri(null)
                void aksi(() => window.aira.jadwalSaklar(i.id, !i.aktif))
              }}
            >
              {i.aktif ? 'Matikan tugas ini' : 'Nyalakan lagi'}
            </button>
            <button
              onClick={() => {
                setMenuEntri(null)
                setHapus(i)
              }}
            >
              Hapus tugas
            </button>
          </>
        )}
      </div>
    )
  }

  const TombolMenu = ({ id }: { id: string }): JSX.Element => (
    <button
      className="btn-mini jadwal-titik3"
      title="Pilihan lain"
      onClick={(ev) => {
        ev.stopPropagation()
        setMenuEntri((m) => (m === id ? null : id))
      }}
    >
      <IconMore size={16} />
    </button>
  )

  const StatKartu = ({
    angka,
    label,
    ikon,
    w,
    onKlik
  }: {
    angka: number
    label: string
    ikon: JSX.Element
    w: string
    onKlik: () => void
  }): JSX.Element => (
    <button className="jadwal-stat" onClick={onKlik}>
      <span className={`tile-ikon ${w}`}>{ikon}</span>
      <span>
        <strong>{angka}</strong>
        <span>
          {label} <IconArrowRight size={13} />
        </span>
      </span>
    </button>
  )

  return (
    <div className="jadwal-baru">
      <div className="jadwal-utama">
        <header className="jadwal-kepala-baru">
          <span className="tile-ikon hijau jadwal-kepala-ikon">
            <IconCalendar size={26} />
          </span>
          <div>
            <h1>Jadwal</h1>
            <p>
              AIRA membantu mengingatkan, merencanakan, dan menjalankan tugasmu. Atur jadwal, buat pengingat,
              dan biarkan AIRA yang menyiapkan semuanya.
            </p>
          </div>
          <div className="jadwal-baru-tombol" onClick={(e) => e.stopPropagation()}>
            <button className="btn-send" onClick={() => setDraf(drafKosong('aira'))}>
              <IconPlus size={16} /> Tugas baru
            </button>
            <button className="btn-send jadwal-panah" title="Pilih jenis" onClick={() => setMenuBaru((x) => !x)}>
              <span className="jadwal-caret" />
            </button>
            {menuBaru && (
              <div className="menu-berkas jadwal-menu-baru">
                <button
                  onClick={() => {
                    setMenuBaru(false)
                    setDraf(drafKosong('aira'))
                  }}
                >
                  <strong>Tugas AIRA</strong>
                  <span>AIRA menjalankan perintahmu pada jamnya</span>
                </button>
                <button
                  onClick={() => {
                    setMenuBaru(false)
                    setDraf(drafKosong('pengingat'))
                  }}
                >
                  <strong>Pengingat</strong>
                  <span>Hanya notifikasi, tanpa AIRA bekerja</span>
                </button>
              </div>
            )}
          </div>
        </header>

        <p className="jadwal-batas-baru">
          Tugas berjalan <strong>selama AIRA menyala di laptop ini</strong> (termasuk saat di tray) dan hanya saat
          kamu yang login. Terlewat karena laptop mati = disusulkan <strong>sekali</strong>. Tugas terjadwal tidak
          pernah menghapus, memindah, atau menjalankan perintah.
        </p>

        {error && <div className="error">{error}</div>}

        <div className="jadwal-statistik">
          <StatKartu angka={statistik.hariIni} label="Tugas hari ini" ikon={<IconCheck size={22} />} w="hijau" onKlik={keHariIni} />
          <StatKartu
            angka={statistik.minggu}
            label="Tugas minggu ini"
            ikon={<IconCalendar size={22} />}
            w="biru"
            onKlik={() => setTampilan('timeline')}
          />
          <StatKartu
            angka={statistik.tertunda}
            label="Tugas tertunda"
            ikon={<IconClock size={22} />}
            w="ungu"
            onKlik={() => setTampilan('daftar')}
          />
          <StatKartu
            angka={statistik.selesai}
            label={`Tugas selesai (${statistik.namaBulan})`}
            ikon={<IconCheck size={22} />}
            w="hijau"
            onKlik={() => setTampilan('timeline')}
          />
        </div>

        <div className="jadwal-atas">
          <section className="kartu-panel jadwal-kalender">
            <div className="jadwal-alat">
              <div className="jadwal-segmen">
                <button className={tampilan === 'kalender' ? 'aktif' : ''} onClick={() => setTampilan('kalender')}>
                  <IconCalendar size={15} /> Kalender
                </button>
                <button className={tampilan === 'daftar' ? 'aktif' : ''} onClick={() => setTampilan('daftar')}>
                  <IconList size={15} /> Daftar
                </button>
                <button className={tampilan === 'timeline' ? 'aktif' : ''} onClick={() => setTampilan('timeline')}>
                  <IconTimeline size={15} /> Timeline
                </button>
              </div>
              {tampilan === 'kalender' && (
                <div className="jadwal-navbulan">
                  <button className="btn-teks" onClick={keHariIni}>
                    Hari ini
                  </button>
                  <button className="btn-mini" title="Bulan sebelumnya" onClick={() => pindahBulan(-1)}>
                    ‹
                  </button>
                  <button className="btn-mini" title="Bulan berikutnya" onClick={() => pindahBulan(1)}>
                    ›
                  </button>
                  <strong>{bulan.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}</strong>
                </div>
              )}
            </div>

            {item === null ? (
              <p className="panel-kosong">Memuat…</p>
            ) : tampilan === 'kalender' ? (
              <div className="kalender">
                {HARI_PENDEK.map((h) => (
                  <div key={h} className="kalender-hari">
                    {h}
                  </div>
                ))}
                {Array.from({ length: 42 }, (_, n) => {
                  const d = tambahHari(awalGrid, n)
                  const e = perHari.get(iso(d)) ?? []
                  const warnaTitik = [...new Set(e.map((x) => warna(x.jenis, x.mode)))].slice(0, 3)
                  const luar = d.getMonth() !== bulan.getMonth()
                  return (
                    <button
                      key={n}
                      className={`kalender-sel ${luar ? 'luar' : ''} ${hariSama(d, dipilih) ? 'dipilih' : ''} ${
                        hariSama(d, hariIni) ? 'hari-ini' : ''
                      }`}
                      onClick={() => setDipilih(d)}
                      title={e.length ? `${e.length} tugas` : undefined}
                    >
                      <span className="kalender-angka">{d.getDate()}</span>
                      <span className="kalender-titik">
                        {warnaTitik.map((w) => (
                          <i key={w} className={`titik ${w}`} />
                        ))}
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : tampilan === 'daftar' ? (
              semua.length === 0 ? (
                <p className="panel-kosong">Belum ada tugas terjadwal. Pakai "Tugas baru" atau salah satu template.</p>
              ) : (
                <ul className="jadwal-daftar-baru">
                  {semua.map((i) => {
                    const terakhir = i.riwayat[0]
                    const tertunda = i.aktif && i.berikut !== null && i.berikut < kini - 5 * 60_000
                    return (
                      <li key={i.id} className={i.aktif ? '' : 'mati'}>
                        <span className={`tile-ikon kecil ${warna(i.jenis, i.mode)}`}>
                          <IkonSumber jenis={i.jenis} mode={i.mode} />
                        </span>
                        <span className="jadwal-daftar-isi">
                          <strong>{i.nama}</strong>
                          <span>
                            {i.uraian} · {labelSumber(i.jenis, i.mode)}
                          </span>
                          <span className={tertunda ? 'status-gagal' : ''}>
                            {!i.aktif
                              ? i.pola.jenis === 'sekali' && i.berikut === null
                                ? 'Sudah dijalankan — tidak dijadwalkan lagi.'
                                : 'Dimatikan.'
                              : i.berikut
                                ? `${tertunda ? 'Tertunda sejak' : 'Berikutnya'}: ${tanggalPendek(i.berikut)} ${jamDari(i.berikut)}`
                                : 'Tidak dijadwalkan lagi.'}
                            {terakhir && ` · Terakhir: ${LABEL_STATUS[terakhir.status]}`}
                          </span>
                        </span>
                        <label className="jadwal-saklar" title={i.aktif ? 'Matikan' : 'Nyalakan'}>
                          <input
                            type="checkbox"
                            checked={i.aktif}
                            disabled={sibuk}
                            onChange={(ev) => void aksi(() => window.aira.jadwalSaklar(i.id, ev.target.checked))}
                          />
                          <span />
                        </label>
                        <span className="jadwal-rel">
                          <TombolMenu id={`d-${i.id}`} />
                          {menuEntri === `d-${i.id}` && (
                            <MenuEntri e={{ ...dasar(i), kunci: '', waktu: 0, status: 'akan', sessionId: terakhir?.sessionId ?? null }} />
                          )}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )
            ) : timeline.length === 0 ? (
              <p className="panel-kosong">Tidak ada tugas dari 3 hari lalu sampai 2 minggu ke depan.</p>
            ) : (
              <div className="jadwal-timeline">
                {timeline.map(([k, e]) => (
                  <div key={k} className="timeline-hari">
                    <strong className={k === iso(hariIni) ? 'hari-ini' : ''}>
                      {tanggalPanjang(new Date(`${k}T00:00`))}
                    </strong>
                    {e.map((x) => (
                      <div key={x.kunci} className="timeline-baris">
                        <span className="timeline-jam">{jamDari(x.waktu)}</span>
                        <i className={`titik ${warna(x.jenis, x.mode)}`} />
                        <span className="timeline-nama">{x.nama}</span>
                        <span className={`chip-status s-${x.status}`}>{LABEL_STATUS[x.status]}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="kartu-panel jadwal-agenda">
            <div className="kartu-panel-kepala">
              <h4>{tanggalPanjang(dipilih)}</h4>
              <span className="chip-jumlah">{agenda.length} tugas</span>
            </div>
            {agenda.length === 0 ? (
              <p className="panel-kosong">Tidak ada tugas di hari ini.</p>
            ) : (
              <ul className="agenda">
                {agenda.map((e) => (
                  <li key={e.kunci}>
                    <span className={`agenda-jam ${warna(e.jenis, e.mode)}`}>
                      <i className={`titik ${warna(e.jenis, e.mode)}`} /> {jamDari(e.waktu)}
                    </span>
                    <span className={`tile-ikon kecil ${warna(e.jenis, e.mode)}`}>
                      {e.status === 'jalan' ? <IconSpinner size={17} /> : <IkonSumber jenis={e.jenis} mode={e.mode} />}
                    </span>
                    <span className="agenda-isi">
                      <strong>{e.nama}</strong>
                      <span title={e.prompt}>{e.prompt}</span>
                      <span className="agenda-chip">
                        <em className={`chip ${warna(e.jenis, e.mode)}`}>{labelSumber(e.jenis, e.mode)}</em>
                        {e.status !== 'akan' && <em className={`chip-status s-${e.status}`}>{LABEL_STATUS[e.status]}</em>}
                      </span>
                    </span>
                    <span className="jadwal-rel">
                      <TombolMenu id={e.kunci} />
                      {menuEntri === e.kunci && <MenuEntri e={e} />}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="kartu-panel jadwal-mendatang">
          <div className="kartu-panel-kepala">
            <h4>
              <IconCalendar size={17} /> Tugas Mendatang
            </h4>
            <button className="beranda-tautan" onClick={() => setTampilan('timeline')}>
              Lihat semua <IconArrowRight size={14} />
            </button>
          </div>
          {mendatang.length === 0 ? (
            <p className="panel-kosong">Belum ada tugas yang akan datang.</p>
          ) : (
            <table className="tabel-mendatang">
              <thead>
                <tr>
                  <th>Judul</th>
                  <th>Tanggal</th>
                  <th>Sumber</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {mendatang.map((e) => (
                  <tr key={e.kunci}>
                    <td>
                      <span className="mendatang-judul">
                        <span className={`tile-ikon mini ${warna(e.jenis, e.mode)}`}>
                          <IkonSumber jenis={e.jenis} mode={e.mode} />
                        </span>
                        <span>
                          <strong>{e.nama}</strong>
                          <span>{e.prompt}</span>
                        </span>
                      </span>
                    </td>
                    <td>
                      <span className="mendatang-tgl">
                        {tanggalPendek(e.waktu)}
                        <span>{jamDari(e.waktu)}</span>
                      </span>
                    </td>
                    <td>
                      <em className={`chip ${warna(e.jenis, e.mode)}`}>{labelSumber(e.jenis, e.mode)}</em>
                    </td>
                    <td>
                      <em className={`chip-status s-${e.status}`}>{LABEL_STATUS[e.status]}</em>
                    </td>
                    <td className="jadwal-rel">
                      <TombolMenu id={`m-${e.kunci}`} />
                      {menuEntri === `m-${e.kunci}` && <MenuEntri e={e} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <aside className="jadwal-kanan">
        <div className="kartu-minta">
          <div className="kartu-minta-kepala">
            <span className="tile-ikon hijau kecil">
              <IconCalendar size={18} />
            </span>
            <IconSparkleSolid size={22} className="minta-kilau" />
          </div>
          <h4>Minta AIRA menjadwalkan</h4>
          <p>Ceritakan apa yang ingin dijadwalkan, AIRA akan membantu membuat tugasnya.</p>
          <div className="minta-kotak">
            <textarea
              rows={3}
              value={minta}
              maxLength={500}
              placeholder="Mis. ingatkan saya setiap tanggal 1 jam 8 untuk kirim laporan sales"
              onChange={(e) => setMinta(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  mintaAira()
                }
              }}
            />
            <div className="minta-bawah">
              <TombolDikte onTeks={(t) => setMinta((p) => (p.trim() ? `${p.trim()} ${t}` : t))} />
              <button className="btn-send minta-kirim" disabled={!minta.trim()} onClick={mintaAira} title="Susun tugasnya">
                <IconSend size={15} />
              </button>
            </div>
          </div>
        </div>

        <div className="kartu-panel">
          <div className="kartu-panel-kepala">
            <h4>
              <IconCalendar size={17} /> Template Jadwal
            </h4>
          </div>
          <ul className="daftar-templat">
            {TEMPLAT.filter((t) => modeBoleh.includes(t.mode)).map((t) => (
              <li key={t.judul}>
                <button onClick={() => setDraf(drafDari(t))}>
                  <span className={`tile-ikon kecil ${t.warna}`}>{t.ikon}</span>
                  <span>
                    <strong>{t.judul}</strong>
                    <span>{t.ket}</span>
                  </span>
                  <IconArrowRight size={16} />
                </button>
              </li>
            ))}
          </ul>
        </div>

        {!tipsDitutup && (
          <div className="kartu-bantuan">
            <span className="bantuan-ikon kuning">
              <IconBulb size={20} />
            </span>
            <span>
              <strong>Tips Penggunaan</strong>
              <span>
                Kamu bisa menggunakan bahasa alami seperti “ingatkan saya setiap Senin pagi untuk cek data sales”.
              </span>
            </span>
            <button
              className="btn-mini bantuan-tutup"
              title="Tutup"
              onClick={() => {
                setTipsDitutup(true)
                try {
                  localStorage.setItem(KUNCI_TIPS, '1')
                } catch {
                  /* tidak tersimpan — muncul lagi lain kali */
                }
              }}
            >
              <IconClose size={14} />
            </button>
          </div>
        )}
      </aside>

      {draf && (
        <div className="lightbox" onClick={() => !sibuk && setDraf(null)}>
          <div className="jadwal-form jadwal-modal" onClick={(e) => e.stopPropagation()}>
            <div className="kartu-panel-kepala">
              <h4>
                <IconSparkle size={17} /> {draf.id ? 'Ubah tugas' : 'Tugas baru'}
              </h4>
              <button className="btn-mini" title="Tutup" onClick={() => setDraf(null)}>
                <IconClose size={14} />
              </button>
            </div>
            {draf.catatan && <p className="jadwal-catatan">{draf.catatan}</p>}
            <div className="jadwal-segmen penuh">
              <button className={draf.jenis === 'aira' ? 'aktif' : ''} onClick={() => ubah({ jenis: 'aira' })}>
                <IconSparkle size={15} /> AIRA menjalankan perintah
              </button>
              <button className={draf.jenis === 'pengingat' ? 'aktif' : ''} onClick={() => ubah({ jenis: 'pengingat' })}>
                <IconBell size={15} /> Pengingat saja
              </button>
            </div>
            <label>
              Nama tugas
              <input
                value={draf.nama}
                maxLength={80}
                placeholder="mis. Ringkasan sales mingguan"
                onChange={(e) => ubah({ nama: e.target.value })}
              />
            </label>
            <label>
              {draf.jenis === 'pengingat' ? 'Isi pengingat' : 'Perintah untuk AIRA'}
              <div className="jadwal-prompt">
                <textarea
                  rows={3}
                  value={draf.prompt}
                  maxLength={5000}
                  placeholder={
                    draf.jenis === 'pengingat'
                      ? 'mis. Kirim laporan ke manajer'
                      : 'Tulis seperti bertanya di chat, mis. buatkan ringkasan sales minggu lalu dalam PDF'
                  }
                  onChange={(e) => ubah({ prompt: e.target.value })}
                />
                <TombolDikte
                  onTeks={(t) => ubah({ prompt: draf.prompt.trim() ? `${draf.prompt.trim()} ${t}` : t })}
                />
              </div>
            </label>
            <div className="jadwal-baris">
              {draf.jenis === 'aira' && (
                <label>
                  Menu
                  <select value={draf.mode} onChange={(e) => ubah({ mode: e.target.value as ChatMode })}>
                    {modeBoleh.map((m) => (
                      <option key={m} value={m}>
                        {LABEL_MODE_PANJANG[m]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Ulangi
                <select value={draf.pola} onChange={(e) => ubah({ pola: e.target.value as Jenis })}>
                  {(Object.keys(LABEL_JENIS) as Jenis[]).map((j) => (
                    <option key={j} value={j}>
                      {LABEL_JENIS[j]}
                    </option>
                  ))}
                </select>
              </label>
              {draf.pola === 'sekali' && (
                <label>
                  Tanggal
                  <input type="date" value={draf.tanggal} onChange={(e) => ubah({ tanggal: e.target.value })} />
                </label>
              )}
              {draf.pola === 'bulanan' && (
                <label>
                  Tanggal
                  <select value={draf.tanggalBulan} onChange={(e) => ubah({ tanggalBulan: Number(e.target.value) })}>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Jam
                <input type="time" value={draf.jam} onChange={(e) => ubah({ jam: e.target.value })} />
              </label>
            </div>
            {draf.pola === 'mingguan' && (
              <div className="jadwal-hari">
                {HARI_PENDEK.map((h, i) => (
                  <button
                    key={h}
                    className={draf.hari.includes(i) ? 'aktif' : ''}
                    onClick={() =>
                      ubah({ hari: draf.hari.includes(i) ? draf.hari.filter((x) => x !== i) : [...draf.hari, i] })
                    }
                  >
                    {h}
                  </button>
                ))}
              </div>
            )}
            {draf.pola === 'bulanan' && draf.tanggalBulan > 28 && (
              <p className="hint">Di bulan yang lebih pendek, tugas jalan di hari terakhir bulan itu.</p>
            )}
            <PratinjauBerikut draf={draf} />
            {error && <div className="error">{error}</div>}
            <div className="jadwal-aksi">
              <button className="btn-teks" onClick={() => setDraf(null)} disabled={sibuk}>
                Batal
              </button>
              <button
                className="btn-send"
                onClick={() => void simpan()}
                disabled={sibuk || !draf.nama.trim() || !draf.prompt.trim()}
              >
                {sibuk ? <IconSpinner size={14} /> : null} Simpan
              </button>
            </div>
          </div>
        </div>
      )}

      {hapus && (
        <ConfirmDialog
          title="Hapus tugas terjadwal ini?"
          body={`${hapus.nama} — percakapan hasil yang sudah ada tetap tersimpan di riwayat chat.`}
          onCancel={() => setHapus(null)}
          onConfirm={() => {
            const id = hapus.id
            setHapus(null)
            void aksi(() => window.aira.jadwalHapus(id))
          }}
        />
      )}
    </div>
  )
}

/** "Jalan berikutnya: …" di form — user melihat akibat pilihannya sebelum menyimpan. */
function PratinjauBerikut({ draf }: { draf: Draf }): JSX.Element {
  let teks: string
  try {
    const t = berikutnya(polaDari(draf), new Date())
    teks = t
      ? `Jalan berikutnya: ${tanggalPanjang(t)}, ${jamDari(t.getTime())}`
      : 'Waktunya sudah lewat — pilih waktu yang akan datang.'
  } catch {
    teks = ''
  }
  if (draf.pola === 'mingguan' && draf.hari.length === 0) teks = 'Pilih minimal satu hari.'
  return <p className="jadwal-pratinjau">{teks}</p>
}
