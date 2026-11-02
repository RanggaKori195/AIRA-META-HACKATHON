import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { ItemGaleri } from '@shared/ipc'
import { TombolDikte } from '../components/TombolDikte'
import ConfirmDialog from '../components/ConfirmDialog'
import {
  IconArrowRight,
  IconAttach,
  IconBulb,
  IconClock,
  IconClose,
  IconCopy,
  IconCrop,
  IconDownload,
  IconFileText,
  IconFlask,
  IconFolder,
  IconGrid,
  IconHistory,
  IconImage,
  IconLayers,
  IconMore,
  IconPalette,
  IconPencil,
  IconSearch,
  IconSmile,
  IconSort,
  IconSparkle,
  IconSparkleSolid,
  IconSpinner,
  IconTag,
  IconTrash,
  IconUser,
  IconZap
} from '../components/Icons'
import lambang from '../assets/aira-mark.png'

// Layar "Gambar" — pembuat gambar old-image-model + galeri milik user (27 Sep 2026,
// permintaan user: "seperti Images di Codex").
//
// ⚠️ Gambar dibuat LANGSUNG ke model gambar, tidak lewat percakapan: tidak ada
// model chat di tengah yang bisa salah memilih tool atau mengarang prompt.
// Yang dikirim persis kalimat user (ditambah gaya yang ia pilih sendiri).
//
// ⚠️ Semua data (daftar, gambar penuh, hapus) diambil lewat main process yang
// memeriksa kepemilikan dari SESI. Layar ini hanya mengirim id.

interface Gaya {
  id: string
  judul: string
  keterangan: string
  /** Ditempelkan di BELAKANG kalimat user — kalimat user tetap yang utama. */
  akhiran: string
}

/**
 * Gaya siap pakai (padanan "Templates" di Codex). Dipilih untuk kebutuhan kerja
 * di the lab — ilustrasi slide, ikon, poster acara — bukan gaya hiburan.
 * Warna the company disebut eksplisit karena model tidak mengenal "warna the company".
 */
const GAYA: Gaya[] = [
  {
    id: 'slide',
    judul: 'Ilustrasi slide',
    keterangan: 'Flat, bersih, cocok untuk presentasi',
    akhiran:
      'gaya ilustrasi flat modern, bersih, warna hijau tua #2f6f3e dan hijau tosca dengan aksen putih, latar polos, tanpa tulisan'
  },
  {
    id: 'ikon',
    judul: 'Ikon',
    keterangan: 'Satu objek sederhana, garis tegas',
    akhiran: 'ikon sederhana satu objek, gaya garis tebal, warna hijau #2f6f3e, latar putih polos, tanpa tulisan'
  },
  {
    id: 'poster',
    judul: 'Poster acara',
    keterangan: 'Komposisi menarik untuk pengumuman',
    akhiran:
      'poster acara kantor yang menarik, komposisi rapi, warna hijau dan putih, ruang kosong untuk judul, tanpa tulisan kecil'
  },
  {
    id: 'foto',
    judul: 'Foto realistis',
    keterangan: 'Seperti foto studio',
    akhiran: 'foto realistis kualitas studio, pencahayaan lembut, latar bersih'
  },
  {
    id: 'infografis',
    judul: 'Latar infografis',
    keterangan: 'Latar untuk ditimpa teks sendiri',
    akhiran:
      'latar infografis abstrak, pola geometris halus, warna hijau lembut, banyak ruang kosong, tanpa tulisan'
  },
  {
    id: 'kartun',
    judul: 'Kartun',
    keterangan: 'Lucu dan ramah',
    akhiran: 'ilustrasi kartun lucu dan ramah, warna cerah lembut, garis bersih'
  }
]

const UKURAN: Array<{ nilai: string; label: string; tag: string }> = [
  { nilai: '512x512', label: 'Persegi · 1:1 (cepat)', tag: 'Persegi 1:1' },
  { nilai: '1024x1024', label: 'Persegi · 1:1 (tajam)', tag: 'Persegi 1:1' },
  { nilai: '1536x1024', label: 'Lanskap · 3:2', tag: 'Lanskap 3:2' },
  { nilai: '1024x1536', label: 'Potret · 2:3', tag: 'Potret 2:3' }
]

/**
 * "Coba ide ini" — mengisi kotak DAN memilih gaya. Tidak langsung membuat:
 * tiap gambar memakan gateway bersama, dan contoh yang terkirim sendiri
 * membakar kuota untuk gambar yang tidak diminta siapa pun.
 */
const IDE: Array<{ judul: string; prompt: string; gaya: string; ikon: JSX.Element }> = [
  { judul: 'Produk lab', prompt: 'Tabung reaksi dan mikroskop di meja laboratorium yang bersih', gaya: 'slide', ikon: <IconFlask size={17} /> },
  { judul: 'Ilustrasi lucu', prompt: 'Maskot tabung reaksi dengan wajah lucu dan tangan melambai', gaya: 'kartun', ikon: <IconSmile size={17} /> },
  { judul: 'Foto realistis', prompt: 'Anjing golden retriever dengan ekspresi ceria', gaya: 'foto', ikon: <IconImage size={17} /> },
  { judul: 'Ikon', prompt: 'Ikon kantong darah untuk layanan donor', gaya: 'ikon', ikon: <IconGrid size={17} /> },
  { judul: 'Poster', prompt: 'Poster acara donor darah di kantor', gaya: 'poster', ikon: <IconFileText size={17} /> }
]

/** Tab "Inspirasi": kalimat contoh yang sudah jelas (subjek + gaya + latar). */
const INSPIRASI = [
  'Ilustrasi flat seorang analis lab memegang pipet, latar putih bersih',
  'Foto realistis rak sampel darah di laboratorium dengan pencahayaan lembut',
  'Latar abstrak hijau lembut dengan pola molekul untuk slide pembuka',
  'Ikon sederhana mikroskop dengan garis tebal warna hijau',
  'Kartun kucing lucu memakai jas lab dan kacamata pelindung',
  'Poster edukasi cuci tangan yang benar untuk staf lab'
]

const TIPS_PROMPT = [
  { judul: 'Jelaskan subjek dengan detail', ket: 'mis. objek, warna, suasana', ikon: <IconUser size={17} /> },
  { judul: 'Tentukan gaya gambar', ket: 'mis. foto realistis, ilustrasi, ikon', ikon: <IconPalette size={17} /> },
  { judul: 'Sebutkan latar atau konteks', ket: 'mis. di lab, di taman, di kantor', ikon: <IconImage size={17} /> },
  { judul: 'Gunakan kata sifat', ket: 'mis. cerah, profesional, minimalis', ikon: <IconTag size={17} /> },
  { judul: 'Tentukan rasio gambar', ket: 'mis. persegi, lanskap, potret', ikon: <IconCrop size={17} /> }
]

const waktu = (ms: number): string =>
  new Date(ms).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })

function sejak(ms: number): string {
  const menit = Math.max(0, Math.round((Date.now() - ms) / 60_000))
  if (menit < 1) return 'baru saja'
  if (menit < 60) return `${menit} menit yang lalu`
  const jam = Math.round(menit / 60)
  if (jam < 24) return `${jam} jam yang lalu`
  const hari = Math.round(jam / 24)
  if (hari < 30) return `${hari} hari yang lalu`
  return waktu(ms)
}

function bersihkanError(err: unknown): string {
  const teks = err instanceof Error ? err.message : String(err)
  return teks.split('Error: ').pop() ?? teks
}

/**
 * Memisahkan kalimat user dari akhiran gaya yang ditempel saat membuat.
 * Gaya DIKENALI dari teks yang tersimpan, bukan ditebak: prompt tanpa akhiran
 * yang cocok tampil tanpa label gaya.
 */
function uraiPrompt(prompt: string): { inti: string; gaya: Gaya | null } {
  for (const g of GAYA) {
    const akhir = `. ${g.akhiran}`
    if (prompt.endsWith(akhir)) return { inti: prompt.slice(0, -akhir.length), gaya: g }
  }
  return { inti: prompt, gaya: null }
}

/** Label rasio untuk kartu; null bila ukurannya tidak tercatat (gambar lama dari chat). */
const tagUkuran = (u: string): string | null =>
  UKURAN.find((x) => x.nilai === u)?.tag ?? (/^\d+x\d+$/.test(u) ? u : null)

export default function Gambar({ onPanduan }: { onPanduan: () => void }): JSX.Element {
  const [prompt, setPrompt] = useState('')
  const [gaya, setGaya] = useState<string | null>(null)
  const [ukuran, setUkuran] = useState('512x512')
  const [jumlah, setJumlah] = useState(1)
  const [tab, setTab] = useState<'buatanku' | 'inspirasi' | 'gaya'>('buatanku')
  const [urut, setUrut] = useState<'baru' | 'lama'>('baru')
  const [item, setItem] = useState<ItemGaleri[]>([])
  const [adaLagi, setAdaLagi] = useState(false)
  const [cari, setCari] = useState('')
  const [sedangBuat, setSedangBuat] = useState(0)
  const [detik, setDetik] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [dibuka, setDibuka] = useState<ItemGaleri | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [hapus, setHapus] = useState<ItemGaleri | null>(null)
  const [pesan, setPesan] = useState<string | null>(null)
  const [semuaRiwayat, setSemuaRiwayat] = useState(false)
  /**
   * Gambar DASAR yang akan diubah (unggahan dari komputer, atau gambar galeri
   * yang dipilih "Ubah dengan AI"). Selama terisi, tombolnya "Ubah Gambar" dan
   * rasio/jumlah dikunci: `images/edits` memakai rasio gambar asal, satu hasil.
   */
  const [dasar, setDasar] = useState<ItemGaleri | null>(null)
  const [mengunggah, setMengunggah] = useState(false)
  const kotak = useRef<HTMLTextAreaElement>(null)

  // Nomor permintaan terakhir: hasil pencarian LAMA yang datang belakangan
  // tidak boleh menimpa hasil yang lebih baru (mengetik cepat = banyak permintaan).
  const nomorMuat = useRef(0)
  const muat = useCallback(async (kata: string) => {
    const nomor = ++nomorMuat.current
    try {
      const hasil = await window.aira.galeriDaftar({ sebelum: null, cari: kata.trim() || null })
      if (nomor !== nomorMuat.current) return
      setItem(hasil.item)
      setAdaLagi(hasil.adaLagi)
    } catch (err) {
      setError(bersihkanError(err))
    }
  }, [])

  // Pencarian berjalan sambil mengetik (jeda 300 ms).
  useEffect(() => {
    const t = setTimeout(() => void muat(cari), 300)
    return () => clearTimeout(t)
  }, [cari, muat])

  // Penghitung detik saat membuat — gambar 1024 bisa ±8 detik per buah, dan
  // layar yang diam selama itu terlihat seperti aplikasi macet.
  useEffect(() => {
    if (sedangBuat === 0) return
    setDetik(0)
    const t = setInterval(() => setDetik((d) => d + 1), 1000)
    return () => clearInterval(t)
  }, [sedangBuat])

  useEffect(() => {
    const tutup = (): void => setMenu(null)
    window.addEventListener('click', tutup)
    return () => window.removeEventListener('click', tutup)
  }, [])

  const lanjut = async (): Promise<void> => {
    const akhir = item.at(-1)
    if (!akhir) return
    const hasil = await window.aira.galeriDaftar({ sebelum: akhir.dibuat, cari: cari.trim() || null })
    setItem((l) => [...l, ...hasil.item])
    setAdaLagi(hasil.adaLagi)
  }

  const isi = (teks: string, idGaya: string | null): void => {
    setPrompt(teks)
    setGaya(idGaya)
    requestAnimationFrame(() => kotak.current?.focus())
  }

  const unggah = async (): Promise<void> => {
    setError(null)
    setMengunggah(true)
    try {
      const baru = await window.aira.galeriUnggah()
      if (!baru) return
      setItem((l) => [baru, ...l])
      setDasar(baru)
      setTab('buatanku')
      requestAnimationFrame(() => kotak.current?.focus())
    } catch (err) {
      setError(bersihkanError(err))
    } finally {
      setMengunggah(false)
    }
  }

  const pakaiSebagaiDasar = (g: ItemGaleri): void => {
    setMenu(null)
    setDasar(g)
    setPrompt('')
    requestAnimationFrame(() => kotak.current?.focus())
  }

  const buat = async (): Promise<void> => {
    const inti = prompt.trim()
    if (!inti || sedangBuat > 0) return
    const g = GAYA.find((x) => x.id === gaya)
    const lengkap = g ? `${inti}. ${g.akhiran}` : inti
    setError(null)
    setSedangBuat(dasar ? 1 : jumlah)
    setTab('buatanku')
    try {
      if (dasar) {
        const baru = await window.aira.galeriUbah({ id: dasar.id, prompt: lengkap })
        setItem((l) => [baru, ...l])
        setDasar(null)
        setPrompt('')
        return
      }
      const baru = await window.aira.galeriBuat({ prompt: lengkap, ukuran, jumlah })
      setItem((l) => [...baru, ...l])
    } catch (err) {
      setError(bersihkanError(err))
    } finally {
      setSedangBuat(0)
    }
  }

  const unduh = async (g: ItemGaleri): Promise<void> => {
    setMenu(null)
    const p = await window.aira.galeriSimpan(g.id)
    if (p) setPesan(`Tersimpan di ${p}`)
  }

  const perkiraan = ukuran === '512x512' ? 2 : ukuran === '1024x1024' ? 8 : 13
  const tampil = urut === 'baru' ? item : [...item].reverse()
  // Riwayat prompt = kalimat UNIK dari galeri milik user, terbaru dulu.
  const riwayat = item.filter((g, i) => item.findIndex((x) => x.prompt === g.prompt) === i)

  return (
    <div className="gambar gambar-baru">
      <div className="gambar-utama">
        <section className="gambar-hero">
          <div className="gambar-hero-teks">
            <span className="hero-lencana">
              <IconSparkle size={14} /> AI Agent Internal the company
            </span>
            <h1>
              Buat Gambar dengan <span>AIRA</span>
            </h1>
            <p>
              Ubah ide dan imajinasi Anda menjadi gambar berkualitas tinggi. Jelaskan gambar yang ingin
              dibuat, pilih pengaturan, lalu biarkan AIRA mewujudkannya.
            </p>
          </div>
          {/* Hiasan: dua ubin (gambar + lambang AIRA) di atas pita hijau + kilau. */}
          <div className="gambar-hero-seni" aria-hidden="true">
            <svg className="seni-pita" viewBox="0 0 420 220" preserveAspectRatio="none">
              <defs>
                <linearGradient id="pita-g" x1="0" y1="1" x2="1" y2="0">
                  <stop offset="0" stopColor="#bfe3c9" stopOpacity="0" />
                  <stop offset="0.5" stopColor="#bfe3c9" stopOpacity="0.9" />
                  <stop offset="1" stopColor="#e3f3e7" stopOpacity="0.3" />
                </linearGradient>
              </defs>
              <path
                fill="url(#pita-g)"
                d="M0 200 C 90 120 150 200 240 120 C 310 60 360 90 420 20 V 90 C 360 150 310 120 250 180 C 170 250 100 170 0 230 Z"
              />
            </svg>
            <span className="seni-ubin seni-gambar">
              <IconImage size={54} />
            </span>
            <span className="seni-ubin seni-logo">
              <img src={lambang} alt="" />
            </span>
            <IconSparkleSolid className="seni-kilau k1" size={26} />
            <IconSparkleSolid className="seni-kilau k2" size={18} />
            <IconSparkleSolid className="seni-kilau k3" size={34} />
          </div>
        </section>

        <div className="gambar-komposer">
          {dasar && (
            <div className="gambar-dasar">
              {dasar.thumb ? <img src={dasar.thumb} alt="" /> : <span className="riwayat-kosong" />}
              <span>
                <strong>Gambar yang akan diubah</strong>
                <span>
                  {dasar.sumber === 'unggah' ? dasar.prompt.replace(/^Gambar unggahan: /, '') : uraiPrompt(dasar.prompt).inti}
                  {' — '}tulis perubahan yang diinginkan. Hasilnya disimpan sebagai gambar baru; yang ini tetap ada.
                </span>
              </span>
              <button className="btn-mini" title="Batal mengubah gambar ini" onClick={() => setDasar(null)}>
                <IconClose size={14} />
              </button>
            </div>
          )}
          <textarea
            ref={kotak}
            rows={3}
            value={prompt}
            maxLength={900}
            placeholder={
              dasar
                ? 'Jelaskan perubahan yang diinginkan… (mis. ganti latarnya jadi putih polos, jadikan gaya kartun, tambahkan jas lab)'
                : 'Jelaskan gambar yang ingin dibuat… (mis. tabung reaksi di meja lab, anjing bermain di taman, ilustrasi kucing lucu, poster edukasi, dll)'
            }
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void buat()
              }
            }}
          />
          <div className="gambar-komposer-bawah">
            <button
              className="btn-attach gambar-lampir"
              title="Unggah gambar dari komputer (PNG/JPG) untuk diubah AIRA"
              disabled={mengunggah || sedangBuat > 0}
              onClick={() => void unggah()}
            >
              {mengunggah ? <IconSpinner size={16} /> : <IconAttach size={17} />}
            </button>
            <TombolDikte
              onTeks={(t) => setPrompt((p) => (p.trim() ? `${p.trim()} ${t}` : t))}
              disabled={sedangBuat > 0}
            />
            <label
              className={`gambar-pilih ${dasar ? 'terkunci' : ''}`}
              title={dasar ? 'Mengubah gambar memakai rasio gambar asalnya' : 'Ukuran & rasio'}
            >
              <IconCrop size={16} />
              <select value={ukuran} disabled={!!dasar} onChange={(e) => setUkuran(e.target.value)}>
                {UKURAN.map((u) => (
                  <option key={u.nilai} value={u.nilai}>
                    {u.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="gambar-pilih" title="Gaya gambar">
              <IconPalette size={16} />
              <select value={gaya ?? ''} onChange={(e) => setGaya(e.target.value || null)}>
                <option value="">Gaya: Otomatis</option>
                {GAYA.map((g) => (
                  <option key={g.id} value={g.id}>
                    Gaya: {g.judul}
                  </option>
                ))}
              </select>
            </label>
            <label
              className={`gambar-pilih ${dasar ? 'terkunci' : ''}`}
              title={dasar ? 'Mengubah gambar menghasilkan satu gambar' : 'Berapa variasi'}
            >
              <IconLayers size={16} />
              <select value={dasar ? 1 : jumlah} disabled={!!dasar} onChange={(e) => setJumlah(Number(e.target.value))}>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n} gambar
                  </option>
                ))}
              </select>
            </label>
            <span className="gambar-spasi" />
            <button
              className="btn-send gambar-buat"
              disabled={!prompt.trim() || sedangBuat > 0}
              onClick={() => void buat()}
            >
              {sedangBuat > 0 ? <IconSpinner size={16} /> : <IconSparkle size={16} />}
              {sedangBuat > 0 ? `${dasar ? 'Mengubah' : 'Membuat'}… ${detik} dtk` : dasar ? 'Ubah Gambar' : 'Buat Gambar'}
              {sedangBuat === 0 && <IconArrowRight size={15} />}
            </button>
          </div>
        </div>
        <p className="gambar-catatan">
          Dibuat oleh AIRA — bukan foto asli dan bukan aset resmi the company. Tulisan di dalam gambar sering
          salah eja; periksa sebelum dipakai.
        </p>

        <div className="gambar-ide">
          <strong>
            <IconZap size={17} /> Coba ide ini
          </strong>
          {IDE.map((i) => (
            <button key={i.judul} onClick={() => isi(i.prompt, i.gaya)} title={i.prompt}>
              {i.ikon} {i.judul}
            </button>
          ))}
        </div>

        {error && <div className="error">{error}</div>}
        {pesan && <div className="gambar-pesan">{pesan}</div>}

        <div className="gambar-tab">
          {(
            [
              ['buatanku', 'Buatanku'],
              ['inspirasi', 'Inspirasi'],
              ['gaya', 'Gaya']
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={`gambar-tab-btn ${tab === id ? 'aktif' : ''}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
          {tab === 'buatanku' && (
            <>
              <label className="gambar-cari">
                <IconSearch size={15} />
                <input
                  value={cari}
                  maxLength={100}
                  placeholder="Cari di keterangan gambar..."
                  onChange={(e) => setCari(e.target.value)}
                />
              </label>
              <label className="gambar-pilih gambar-urut" title="Urutan">
                <IconSort size={15} />
                <select value={urut} onChange={(e) => setUrut(e.target.value as 'baru' | 'lama')}>
                  <option value="baru">Terbaru</option>
                  <option value="lama">Terlama</option>
                </select>
              </label>
            </>
          )}
        </div>

        {tab === 'gaya' ? (
          <div className="gambar-grid">
            {GAYA.map((g) => (
              <button
                key={g.id}
                className={`gambar-gaya ${gaya === g.id ? 'aktif' : ''}`}
                onClick={() => {
                  setGaya(g.id)
                  setTab('buatanku')
                  kotak.current?.focus()
                }}
              >
                <strong>{g.judul}</strong>
                <span>{g.keterangan}</span>
              </button>
            ))}
          </div>
        ) : tab === 'inspirasi' ? (
          <div className="gambar-grid">
            {INSPIRASI.map((t) => (
              <button key={t} className="gambar-gaya" onClick={() => isi(t, null)}>
                <strong>
                  <IconBulb size={15} /> Ide
                </strong>
                <span>{t}</span>
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="gambar-grid">
              {Array.from({ length: sedangBuat }, (_, i) => (
                <div key={`muat-${i}`} className="gambar-kartu memuat">
                  <IconSpinner size={20} />
                  <span>
                    Membuat… {detik} dtk
                    {detik > perkiraan * 2 && ' (lebih lama dari biasanya)'}
                  </span>
                </div>
              ))}
              {tampil.map((g) => {
                const u = uraiPrompt(g.prompt)
                return (
                  <div key={g.id} className="gambar-kartu">
                    <button className="gambar-kartu-foto" onClick={() => setDibuka(g)} title={g.prompt}>
                      {g.thumb ? (
                        <img src={g.thumb} alt={u.inti} loading="lazy" />
                      ) : (
                        <span className="gambar-hilang">Berkas sudah tidak ada</span>
                      )}
                    </button>
                    <button
                      className="gambar-kartu-menu"
                      title="Pilihan lain"
                      onClick={(e) => {
                        e.stopPropagation()
                        setMenu((m) => (m === g.id ? null : g.id))
                      }}
                    >
                      <IconMore size={16} />
                    </button>
                    {menu === g.id && (
                      <div className="menu-berkas gambar-menu" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => {
                            setMenu(null)
                            setDibuka(g)
                          }}
                        >
                          Buka &amp; ubah
                        </button>
                        <button disabled={g.hilang} onClick={() => pakaiSebagaiDasar(g)}>
                          Ubah dengan AI
                        </button>
                        <button disabled={g.hilang} onClick={() => void unduh(g)}>
                          Unduh
                        </button>
                        <button
                          onClick={() => {
                            setMenu(null)
                            isi(u.inti, u.gaya?.id ?? null)
                          }}
                        >
                          Pakai lagi prompt-nya
                        </button>
                        <button
                          onClick={() => {
                            setMenu(null)
                            setHapus(g)
                          }}
                        >
                          Hapus
                        </button>
                      </div>
                    )}
                    <div className="gambar-kartu-isi">
                      <strong title={u.inti}>{u.inti}</strong>
                      <div className="gambar-tag">
                        <span className="tag-gaya">
                          {u.gaya ? u.gaya.judul : g.sumber === 'chat' ? 'Dari chat' : g.sumber === 'unggah' ? 'Unggahan' : 'Otomatis'}
                        </span>
                        {tagUkuran(g.ukuran) && <span>{tagUkuran(g.ukuran)}</span>}
                      </div>
                      <div className="gambar-kartu-kaki">
                        <span>
                          <IconClock size={13} /> {sejak(g.dibuat)}
                        </span>
                        <button className="btn-mini" title="Unduh" disabled={g.hilang} onClick={() => void unduh(g)}>
                          <IconDownload size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            {item.length === 0 && sedangBuat === 0 && (
              <p className="hint gambar-kosong">
                {cari.trim()
                  ? `Tidak ada gambar yang keterangannya memuat “${cari.trim()}”.`
                  : 'Belum ada gambar. Tulis apa yang ingin dibuat di atas, atau coba salah satu ide.'}
              </p>
            )}
            {adaLagi && (
              <button className="btn-teks gambar-lagi" onClick={() => void lanjut()}>
                Muat lebih banyak
              </button>
            )}
          </>
        )}
      </div>

      <aside className="gambar-kanan">
        <div className="kartu-panel">
          <div className="kartu-panel-kepala">
            <h4>
              <IconBulb size={17} /> Tips prompt
            </h4>
            <button className="beranda-tautan" onClick={onPanduan}>
              Lihat semua <IconArrowRight size={14} />
            </button>
          </div>
          <p className="panel-kosong">Gunakan prompt yang jelas untuk hasil gambar terbaik.</p>
          <ul className="daftar-tips">
            {TIPS_PROMPT.map((t) => (
              <li key={t.judul}>
                <span className="tile-tips hijau">{t.ikon}</span>
                <span>
                  <strong>{t.judul}</strong>
                  <span>{t.ket}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="kartu-panel">
          <div className="kartu-panel-kepala">
            <h4>
              <IconHistory size={17} /> Riwayat prompt
            </h4>
            {riwayat.length > 4 && (
              <button className="beranda-tautan" onClick={() => setSemuaRiwayat((x) => !x)}>
                {semuaRiwayat ? 'Lebih sedikit' : 'Lihat semua'} <IconArrowRight size={14} />
              </button>
            )}
          </div>
          {riwayat.length === 0 ? (
            <p className="panel-kosong">Prompt yang pernah kamu pakai akan muncul di sini.</p>
          ) : (
            <ul className="daftar-riwayat">
              {riwayat.slice(0, semuaRiwayat ? 20 : 4).map((g) => {
                const u = uraiPrompt(g.prompt)
                return (
                  <li key={g.id}>
                    <button onClick={() => isi(u.inti, u.gaya?.id ?? null)} title="Pakai lagi prompt ini">
                      {g.thumb ? <img src={g.thumb} alt="" /> : <span className="riwayat-kosong" />}
                      <span>
                        <strong>{u.inti}</strong>
                        <span>{sejak(g.dibuat)}</span>
                      </span>
                    </button>
                    <button
                      className="btn-mini"
                      title="Salin prompt"
                      onClick={() => {
                        window.aira.copyText(g.prompt)
                        setPesan('Prompt disalin.')
                      }}
                    >
                      <IconCopy size={14} />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </aside>

      {hapus && (
        <ConfirmDialog
          title="Hapus gambar ini dari galeri?"
          body={
            hapus.sumber === 'chat'
              ? 'Hanya catatannya di galeri yang dihapus. Berkasnya tetap ada di folder tempat AIRA menyimpannya.'
              : 'Berkasnya dipindah ke Recycle Bin — masih bisa dikembalikan dari sana.'
          }
          onCancel={() => setHapus(null)}
          onConfirm={() => {
            const id = hapus.id
            setHapus(null)
            void window.aira.galeriHapus(id).then((ok) => ok && setItem((l) => l.filter((x) => x.id !== id)))
          }}
        />
      )}

      {dibuka && (
        <Lightbox
          item={dibuka}
          onTutup={() => setDibuka(null)}
          onPakaiLagi={(p) => {
            const u = uraiPrompt(p)
            setDibuka(null)
            isi(u.inti, u.gaya?.id ?? null)
          }}
          onDiubah={(baru) => {
            setItem((l) => [baru, ...l])
            setDibuka(baru)
          }}
          onDihapus={(id) => {
            setItem((l) => l.filter((x) => x.id !== id))
            setDibuka(null)
          }}
        />
      )}
    </div>
  )
}

function Lightbox({
  item,
  onTutup,
  onPakaiLagi,
  onDiubah,
  onDihapus
}: {
  item: ItemGaleri
  onTutup: () => void
  onPakaiLagi: (prompt: string) => void
  onDiubah: (baru: ItemGaleri) => void
  onDihapus: (id: string) => void
}): JSX.Element {
  const [penuh, setPenuh] = useState<string | null>(null)
  const [ubah, setUbah] = useState('')
  const [sibuk, setSibuk] = useState(false)
  const [pesan, setPesan] = useState<string | null>(null)
  const [konfirmasi, setKonfirmasi] = useState(false)

  useEffect(() => {
    let hidup = true
    setPenuh(null)
    setPesan(null)
    void window.aira
      .galeriPenuh(item.id)
      .then((d) => hidup && setPenuh(d))
      .catch(() => undefined)
    return () => {
      hidup = false
    }
  }, [item.id])

  useEffect(() => {
    const tombol = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onTutup()
    }
    window.addEventListener('keydown', tombol)
    return () => window.removeEventListener('keydown', tombol)
  }, [onTutup])

  const jalankanUbah = async (): Promise<void> => {
    if (!ubah.trim()) return
    setSibuk(true)
    setPesan(null)
    try {
      onDiubah(await window.aira.galeriUbah({ id: item.id, prompt: ubah.trim() }))
      setUbah('')
    } catch (err) {
      setPesan(bersihkanError(err))
    } finally {
      setSibuk(false)
    }
  }

  // ⚠️ Dialog konfirmasi dirender DI LUAR `.lightbox`: klik di dalamnya akan
  // merambat ke latar lightbox dan menutupnya, sehingga tombol Hapus tampak
  // tidak bereaksi.
  return (
    <>
    <div className="lightbox" onClick={onTutup}>
      <div className="lightbox-isi" onClick={(e) => e.stopPropagation()}>
        <button className="btn-mini lightbox-tutup" title="Tutup (Esc)" onClick={onTutup}>
          <IconClose size={16} />
        </button>
        <div className="lightbox-gambar">
          {item.hilang ? (
            <span className="gambar-hilang">Berkas gambar ini sudah dihapus atau dipindahkan.</span>
          ) : penuh ? (
            <img src={penuh} alt={item.prompt} />
          ) : (
            <IconSpinner size={24} />
          )}
        </div>
        <div className="lightbox-sisi">
          <p className="lightbox-prompt">{item.prompt}</p>
          <p className="hint">
            {item.ukuran} · {waktu(item.dibuat)} · {item.sumber === 'chat' ? 'dibuat di chat' : 'dibuat di layar Gambar'}
          </p>
          <div className="lightbox-aksi">
            <button
              className="btn-teks"
              disabled={item.hilang}
              onClick={() =>
                void window.aira.galeriSimpan(item.id).then((p) => p && setPesan(`Tersimpan di ${p}`))
              }
            >
              <IconDownload size={14} /> Unduh
            </button>
            <button className="btn-teks" disabled={item.hilang} onClick={() => void window.aira.revealFile(item.path)}>
              <IconFolder size={14} /> Tampilkan di folder
            </button>
            <button className="btn-teks" onClick={() => window.aira.copyText(item.prompt)}>
              <IconCopy size={14} /> Salin keterangan
            </button>
            <button className="btn-teks" onClick={() => onPakaiLagi(item.prompt)}>
              <IconPencil size={14} /> Pakai lagi
            </button>
            <button className="btn-teks bahaya" onClick={() => setKonfirmasi(true)}>
              <IconTrash size={14} /> Hapus
            </button>
          </div>

          {!item.hilang && (
            <div className="lightbox-ubah">
              <label htmlFor="ubah-gambar">Ubah gambar ini</label>
              <textarea
                id="ubah-gambar"
                rows={2}
                value={ubah}
                maxLength={900}
                placeholder="mis. ganti latarnya jadi biru muda"
                onChange={(e) => setUbah(e.target.value)}
              />
              <button className="btn-send" disabled={!ubah.trim() || sibuk} onClick={() => void jalankanUbah()}>
                {sibuk ? 'Mengubah…' : 'Ubah'}
              </button>
              <p className="hint">Hasilnya disimpan sebagai gambar baru; yang ini tetap ada.</p>
            </div>
          )}
          {pesan && <p className="hint">{pesan}</p>}
        </div>
      </div>
    </div>

      {konfirmasi && (
        <ConfirmDialog
          title="Hapus gambar ini dari galeri?"
          body={
            item.sumber === 'chat'
              ? 'Hanya catatannya di galeri yang dihapus. Berkasnya tetap ada di folder tempat AIRA menyimpannya.'
              : 'Berkasnya dipindah ke Recycle Bin — masih bisa dikembalikan dari sana.'
          }
          onCancel={() => setKonfirmasi(false)}
          onConfirm={() => {
            setKonfirmasi(false)
            void window.aira.galeriHapus(item.id).then((ok) => ok && onDihapus(item.id))
          }}
        />
      )}
    </>
  )
}
