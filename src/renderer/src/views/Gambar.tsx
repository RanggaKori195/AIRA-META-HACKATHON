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
import lambang from '../assets/mascot/idle.png'

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
  /**
   * Akhiran versi lama (bahasa Indonesia) yang mungkin tersimpan di prompt gambar
   * lama. HANYA untuk mengenali label gaya — tidak pernah ditempelkan lagi.
   */
  akhiranLama: string
}

/**
 * Gaya siap pakai (padanan "Templates" di Codex). Dipilih untuk kebutuhan kerja
 * di the lab — ilustrasi slide, ikon, poster acara — bukan gaya hiburan.
 * Warna the company disebut eksplisit karena model tidak mengenal "warna the company".
 */
const GAYA: Gaya[] = [
  {
    id: 'slide',
    judul: 'Slide illustration',
    keterangan: 'Flat and clean, great for presentations',
    akhiran:
      'modern flat illustration style, clean, dark green #2f6f3e and teal with white accents, plain background, no text',
    akhiranLama:
      'gaya ilustrasi flat modern, bersih, warna hijau tua #2f6f3e dan hijau tosca dengan aksen putih, latar polos, tanpa tulisan'
  },
  {
    id: 'ikon',
    judul: 'Icon',
    keterangan: 'One simple object, bold lines',
    akhiran: 'simple single-object icon, bold line style, green #2f6f3e, plain white background, no text',
    akhiranLama: 'ikon sederhana satu objek, gaya garis tebal, warna hijau #2f6f3e, latar putih polos, tanpa tulisan'
  },
  {
    id: 'poster',
    judul: 'Event poster',
    keterangan: 'An eye-catching layout for announcements',
    akhiran:
      'eye-catching office event poster, tidy composition, green and white colors, empty space for a title, no small text',
    akhiranLama:
      'poster acara kantor yang menarik, komposisi rapi, warna hijau dan putih, ruang kosong untuk judul, tanpa tulisan kecil'
  },
  {
    id: 'foto',
    judul: 'Realistic photo',
    keterangan: 'Like a studio photo',
    akhiran: 'realistic studio-quality photo, soft lighting, clean background',
    akhiranLama: 'foto realistis kualitas studio, pencahayaan lembut, latar bersih'
  },
  {
    id: 'infografis',
    judul: 'Infographic background',
    keterangan: 'A backdrop for your own text',
    akhiran:
      'abstract infographic background, subtle geometric pattern, soft green colors, lots of empty space, no text',
    akhiranLama:
      'latar infografis abstrak, pola geometris halus, warna hijau lembut, banyak ruang kosong, tanpa tulisan'
  },
  {
    id: 'kartun',
    judul: 'Cartoon',
    keterangan: 'Cute and friendly',
    akhiran: 'cute and friendly cartoon illustration, soft bright colors, clean lines',
    akhiranLama: 'ilustrasi kartun lucu dan ramah, warna cerah lembut, garis bersih'
  }
]

const UKURAN: Array<{ nilai: string; label: string; tag: string }> = [
  { nilai: '512x512', label: 'Square · 1:1 (fast)', tag: 'Square 1:1' },
  { nilai: '1024x1024', label: 'Square · 1:1 (sharp)', tag: 'Square 1:1' },
  { nilai: '1536x1024', label: 'Landscape · 3:2', tag: 'Landscape 3:2' },
  { nilai: '1024x1536', label: 'Portrait · 2:3', tag: 'Portrait 2:3' }
]

/**
 * "Coba ide ini" — mengisi kotak DAN memilih gaya. Tidak langsung membuat:
 * tiap gambar memakan gateway bersama, dan contoh yang terkirim sendiri
 * membakar kuota untuk gambar yang tidak diminta siapa pun.
 */
const IDE: Array<{ judul: string; prompt: string; gaya: string; ikon: JSX.Element }> = [
  { judul: 'Lab product', prompt: 'A test tube and a microscope on a clean laboratory bench', gaya: 'slide', ikon: <IconFlask size={17} /> },
  { judul: 'Cute illustration', prompt: 'A test tube mascot with a cute face and a waving hand', gaya: 'kartun', ikon: <IconSmile size={17} /> },
  { judul: 'Realistic photo', prompt: 'A golden retriever with a cheerful expression', gaya: 'foto', ikon: <IconImage size={17} /> },
  { judul: 'Icon', prompt: 'A blood bag icon for a donation service', gaya: 'ikon', ikon: <IconGrid size={17} /> },
  { judul: 'Poster', prompt: 'A poster for a blood donation event at the office', gaya: 'poster', ikon: <IconFileText size={17} /> }
]

/** Tab "Inspirasi": kalimat contoh yang sudah jelas (subjek + gaya + latar). */
const INSPIRASI = [
  'Flat illustration of a lab analyst holding a pipette, clean white background',
  'Realistic photo of a rack of blood samples in a laboratory with soft lighting',
  'Soft green abstract background with a molecule pattern for an opening slide',
  'Simple microscope icon with bold green lines',
  'Cartoon of a cute cat wearing a lab coat and safety goggles',
  'Educational poster on proper handwashing for lab staff'
]

const TIPS_PROMPT = [
  { judul: 'Describe the subject in detail', ket: 'e.g. object, color, mood', ikon: <IconUser size={17} /> },
  { judul: 'Choose an image style', ket: 'e.g. realistic photo, illustration, icon', ikon: <IconPalette size={17} /> },
  { judul: 'Mention the setting or context', ket: 'e.g. in the lab, in a park, at the office', ikon: <IconImage size={17} /> },
  { judul: 'Use adjectives', ket: 'e.g. bright, professional, minimalist', ikon: <IconTag size={17} /> },
  { judul: 'Pick an aspect ratio', ket: 'e.g. square, landscape, portrait', ikon: <IconCrop size={17} /> }
]

const waktu = (ms: number): string =>
  new Date(ms).toLocaleString('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })

function sejak(ms: number): string {
  const menit = Math.max(0, Math.round((Date.now() - ms) / 60_000))
  if (menit < 1) return 'just now'
  if (menit < 60) return menit + ' min ago'
  const jam = Math.round(menit / 60)
  if (jam < 24) return jam + ' h ago'
  const hari = Math.round(jam / 24)
  if (hari < 30) return hari + ' d ago'
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
    // Akhiran Inggris (baru) DAN Indonesia (prompt lama yang sudah tersimpan).
    for (const teks of [g.akhiran, g.akhiranLama]) {
      const akhir = `. ${teks}`
      if (prompt.endsWith(akhir)) return { inti: tampilkanInti(prompt.slice(0, -akhir.length)), gaya: g }
    }
  }
  return { inti: tampilkanInti(prompt), gaya: null }
}

/** Awalan "Gambar unggahan: " ditulis main process; di layar tampil dalam bahasa Inggris. */
const AWALAN_UNGGAH_LAMA = /^Gambar unggahan: /
const AWALAN_UNGGAH = 'Uploaded image: '
const tampilkanInti = (inti: string): string => inti.replace(AWALAN_UNGGAH_LAMA, AWALAN_UNGGAH)

/** Label rasio untuk kartu; null bila ukurannya tidak tercatat (gambar lama dari chat). */
const tagUkuran = (u: string): string | null =>
  UKURAN.find((x) => x.nilai === u)?.tag ?? (/^\d+x\d+$/.test(u) ? u : null)

export default function Gambar({ onPanduan }: { onPanduan: () => void }): JSX.Element {
  const [prompt, setPrompt] = useState('')
  const [gaya, setGaya] = useState<string | null>(null)
  const [ukuran, setUkuran] = useState('512x512')
  const [jumlah, setJumlah] = useState(1)
  const [tab, setTab] = useState<'mine' | 'inspiration' | 'styles'>('mine')
  const [urut, setUrut] = useState<'newest' | 'oldest'>('newest')
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
      setTab('mine')
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
    setTab('mine')
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
    if (p) setPesan(`Saved to ${p}`)
  }

  const perkiraan = ukuran === '512x512' ? 2 : ukuran === '1024x1024' ? 8 : 13
  const tampil = urut === 'newest' ? item : [...item].reverse()
  // Riwayat prompt = kalimat UNIK dari galeri milik user, terbaru dulu.
  const riwayat = item.filter((g, i) => item.findIndex((x) => x.prompt === g.prompt) === i)

  return (
    <div className="gambar gambar-baru">
      <div className="gambar-utama">
        <section className="gambar-hero">
          <div className="gambar-hero-teks">
            <span className="hero-lencana">
              <IconSparkle size={14} /> AI Lab Assistant
            </span>
            <h1>
              Create Images with <span>AIRA</span>
            </h1>
            <p>
              Turn your ideas and imagination into high-quality images. Describe the image you want,
              pick your settings, and let AIRA bring it to life.
            </p>
          </div>
          {/* Hiasan: dua ubin (gambar + lambang AIRA) di atas pita hijau + kilau. */}
          <div className="gambar-hero-seni" aria-hidden="true">
            <svg className="seni-pita" viewBox="0 0 420 220" preserveAspectRatio="none">
              <defs>
                <linearGradient id="pita-g" x1="0" y1="1" x2="1" y2="0">
                  <stop offset="0" stopColor="#bdcde5" stopOpacity="0" />
                  <stop offset="0.5" stopColor="#bdcde5" stopOpacity="0.9" />
                  <stop offset="1" stopColor="#e2e9f4" stopOpacity="0.3" />
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
                <strong>Image to be edited</strong>
                <span>
                  {dasar.sumber === 'unggah' ? dasar.prompt.replace(AWALAN_UNGGAH_LAMA, '').replace(/^Uploaded image: /, '') : uraiPrompt(dasar.prompt).inti}
                  {' — '}describe the change you want. The result is saved as a new image; this one stays.
                </span>
              </span>
              <button className="btn-mini" title="Cancel editing this image" onClick={() => setDasar(null)}>
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
                ? 'Describe the change you want… (e.g. make the background plain white, switch to a cartoon style, add a lab coat)'
                : 'Describe the image you want to create… (e.g. a test tube on a lab bench, a dog playing in a park, a cute cat illustration, an educational poster)'
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
              title="Upload an image from your computer (PNG/JPG) for AIRA to edit"
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
              title={dasar ? 'Editing keeps the original image ratio' : 'Size & ratio'}
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
            <label className="gambar-pilih" title="Image style">
              <IconPalette size={16} />
              <select value={gaya ?? ''} onChange={(e) => setGaya(e.target.value || null)}>
                <option value="">Style: Auto</option>
                {GAYA.map((g) => (
                  <option key={g.id} value={g.id}>
                    Style: {g.judul}
                  </option>
                ))}
              </select>
            </label>
            <label
              className={`gambar-pilih ${dasar ? 'terkunci' : ''}`}
              title={dasar ? 'Editing produces a single image' : 'How many variations'}
            >
              <IconLayers size={16} />
              <select value={dasar ? 1 : jumlah} disabled={!!dasar} onChange={(e) => setJumlah(Number(e.target.value))}>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n} {n === 1 ? 'image' : 'images'}
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
              {sedangBuat > 0 ? (dasar ? 'Editing' : 'Creating') + '… ' + detik + 's' : dasar ? 'Edit Image' : 'Create Image'}
              {sedangBuat === 0 && <IconArrowRight size={15} />}
            </button>
          </div>
        </div>
        <p className="gambar-catatan">
          Created by AIRA — not a real photograph and not an official brand asset. Text inside images is often
          misspelled; check it before use.
        </p>

        <div className="gambar-ide">
          <strong>
            <IconZap size={17} /> Try an idea
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
              ['mine', 'My images'],
              ['inspiration', 'Inspiration'],
              ['styles', 'Styles']
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={`gambar-tab-btn ${tab === id ? 'aktif' : ''}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
          {tab === 'mine' && (
            <>
              <label className="gambar-cari">
                <IconSearch size={15} />
                <input
                  value={cari}
                  maxLength={100}
                  placeholder="Search image descriptions..."
                  onChange={(e) => setCari(e.target.value)}
                />
              </label>
              <label className="gambar-pilih gambar-urut" title="Sort order">
                <IconSort size={15} />
                <select value={urut} onChange={(e) => setUrut(e.target.value as 'newest' | 'oldest')}>
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                </select>
              </label>
            </>
          )}
        </div>

        {tab === 'styles' ? (
          <div className="gambar-grid">
            {GAYA.map((g) => (
              <button
                key={g.id}
                className={`gambar-gaya ${gaya === g.id ? 'aktif' : ''}`}
                onClick={() => {
                  setGaya(g.id)
                  setTab('mine')
                  kotak.current?.focus()
                }}
              >
                <strong>{g.judul}</strong>
                <span>{g.keterangan}</span>
              </button>
            ))}
          </div>
        ) : tab === 'inspiration' ? (
          <div className="gambar-grid">
            {INSPIRASI.map((t) => (
              <button key={t} className="gambar-gaya" onClick={() => isi(t, null)}>
                <strong>
                  <IconBulb size={15} /> Idea
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
                    Creating… {detik}s
                    {detik > perkiraan * 2 && ' (taking longer than usual)'}
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
                        <span className="gambar-hilang">File no longer exists</span>
                      )}
                    </button>
                    <button
                      className="gambar-kartu-menu"
                      title="More options"
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
                          Open &amp; edit
                        </button>
                        <button disabled={g.hilang} onClick={() => pakaiSebagaiDasar(g)}>
                          Edit with AI
                        </button>
                        <button disabled={g.hilang} onClick={() => void unduh(g)}>
                          Download
                        </button>
                        <button
                          onClick={() => {
                            setMenu(null)
                            isi(u.inti, u.gaya?.id ?? null)
                          }}
                        >
                          Reuse this prompt
                        </button>
                        <button
                          onClick={() => {
                            setMenu(null)
                            setHapus(g)
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                    <div className="gambar-kartu-isi">
                      <strong title={u.inti}>{u.inti}</strong>
                      <div className="gambar-tag">
                        <span className="tag-gaya">
                          {u.gaya ? u.gaya.judul : g.sumber === 'chat' ? 'From chat' : g.sumber === 'unggah' ? 'Upload' : 'Auto'}
                        </span>
                        {tagUkuran(g.ukuran) && <span>{tagUkuran(g.ukuran)}</span>}
                      </div>
                      <div className="gambar-kartu-kaki">
                        <span>
                          <IconClock size={13} /> {sejak(g.dibuat)}
                        </span>
                        <button className="btn-mini" title="Download" disabled={g.hilang} onClick={() => void unduh(g)}>
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
                  ? 'No images have a description containing “' + cari.trim() + '”.'
                  : 'No images yet. Describe what you want above, or try one of the ideas.'}
              </p>
            )}
            {adaLagi && (
              <button className="btn-teks gambar-lagi" onClick={() => void lanjut()}>
                Load more
              </button>
            )}
          </>
        )}
      </div>

      <aside className="gambar-kanan">
        <div className="kartu-panel">
          <div className="kartu-panel-kepala">
            <h4>
              <IconBulb size={17} /> Prompt tips
            </h4>
            <button className="beranda-tautan" onClick={onPanduan}>
              View all <IconArrowRight size={14} />
            </button>
          </div>
          <p className="panel-kosong">Use a clear prompt for the best results.</p>
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
              <IconHistory size={17} /> Prompt history
            </h4>
            {riwayat.length > 4 && (
              <button className="beranda-tautan" onClick={() => setSemuaRiwayat((x) => !x)}>
                {semuaRiwayat ? 'Show less' : 'View all'} <IconArrowRight size={14} />
              </button>
            )}
          </div>
          {riwayat.length === 0 ? (
            <p className="panel-kosong">Prompts you have used will appear here.</p>
          ) : (
            <ul className="daftar-riwayat">
              {riwayat.slice(0, semuaRiwayat ? 20 : 4).map((g) => {
                const u = uraiPrompt(g.prompt)
                return (
                  <li key={g.id}>
                    <button onClick={() => isi(u.inti, u.gaya?.id ?? null)} title="Reuse this prompt">
                      {g.thumb ? <img src={g.thumb} alt="" /> : <span className="riwayat-kosong" />}
                      <span>
                        <strong>{u.inti}</strong>
                        <span>{sejak(g.dibuat)}</span>
                      </span>
                    </button>
                    <button
                      className="btn-mini"
                      title="Copy prompt"
                      onClick={() => {
                        window.aira.copyText(g.prompt)
                        setPesan('Prompt copied.')
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
          title="Delete this image from the gallery?"
          body={
            hapus.sumber === 'chat'
              ? 'Only its gallery entry is removed. The file itself stays in the folder where AIRA saved it.'
              : 'The file is moved to the Recycle Bin — you can still restore it from there.'
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
        <button className="btn-mini lightbox-tutup" title="Close (Esc)" onClick={onTutup}>
          <IconClose size={16} />
        </button>
        <div className="lightbox-gambar">
          {item.hilang ? (
            <span className="gambar-hilang">This image file has been deleted or moved.</span>
          ) : penuh ? (
            <img src={penuh} alt={item.prompt} />
          ) : (
            <IconSpinner size={24} />
          )}
        </div>
        <div className="lightbox-sisi">
          <p className="lightbox-prompt">{item.prompt}</p>
          <p className="hint">
            {item.ukuran} · {waktu(item.dibuat)} · {item.sumber === 'chat' ? 'created in chat' : 'created on the Images screen'}
          </p>
          <div className="lightbox-aksi">
            <button
              className="btn-teks"
              disabled={item.hilang}
              onClick={() =>
                void window.aira.galeriSimpan(item.id).then((p) => p && setPesan(`Saved to ${p}`))
              }
            >
              <IconDownload size={14} /> Download
            </button>
            <button className="btn-teks" disabled={item.hilang} onClick={() => void window.aira.revealFile(item.path)}>
              <IconFolder size={14} /> Show in folder
            </button>
            <button className="btn-teks" onClick={() => window.aira.copyText(item.prompt)}>
              <IconCopy size={14} /> Copy description
            </button>
            <button className="btn-teks" onClick={() => onPakaiLagi(item.prompt)}>
              <IconPencil size={14} /> Reuse
            </button>
            <button className="btn-teks bahaya" onClick={() => setKonfirmasi(true)}>
              <IconTrash size={14} /> Delete
            </button>
          </div>

          {!item.hilang && (
            <div className="lightbox-ubah">
              <label htmlFor="ubah-gambar">Edit this image</label>
              <textarea
                id="ubah-gambar"
                rows={2}
                value={ubah}
                maxLength={900}
                placeholder="e.g. make the background light blue"
                onChange={(e) => setUbah(e.target.value)}
              />
              <button className="btn-send" disabled={!ubah.trim() || sibuk} onClick={() => void jalankanUbah()}>
                {sibuk ? 'Editing…' : 'Edit'}
              </button>
              <p className="hint">The result is saved as a new image; this one stays.</p>
            </div>
          )}
          {pesan && <p className="hint">{pesan}</p>}
        </div>
      </div>
    </div>

      {konfirmasi && (
        <ConfirmDialog
          title="Delete this image from the gallery?"
          body={
            item.sumber === 'chat'
              ? 'Only its gallery entry is removed. The file itself stays in the folder where AIRA saved it.'
              : 'The file is moved to the Recycle Bin — you can still restore it from there.'
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
