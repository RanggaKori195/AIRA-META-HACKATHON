import { useEffect, useMemo, useState, type JSX } from 'react'
import type { ItemPustaka, KategoriPustaka } from '@shared/ipc'
import {
  IconChat,
  IconFile,
  IconFileText,
  IconFolder,
  IconGrid,
  IconImage,
  IconLibrary,
  IconList,
  IconPresentation,
  IconSearch,
  IconTable,
  IconTimeline
} from '../components/Icons'

// Menu Pustaka (30 Sep 2026) — semua berkas yang pernah dibuat AIRA untuk user
// yang sedang login: laporan Word/PDF/Excel, presentasi, gambar.
//
// ⚠️ Isinya dari main (`pustaka:daftar`): riwayat chat + galeri MILIK user ini.
// Renderer tidak pernah mengirim path untuk dibaca; "Buka"/"Folder" lewat
// `berkasBuka` yang memeriksa DAFTAR-IZIN path milik user (pola §69/§71).
// ⚠️ Berkas yang sudah dihapus/dipindah di luar AIRA DITANDAI "Hilang", tidak
// disembunyikan — pustaka yang diam-diam menyusut terlihat seperti AIRA yang
// kehilangan data.

interface Props {
  /** Membuka percakapan asal berkas. false = percakapannya sudah tidak ada. */
  onBukaSesi: (sessionId: string) => boolean
}

const JENIS: Array<{ id: KategoriPustaka | 'all'; label: string; warna: string }> = [
  { id: 'all', label: 'All', warna: 'hijau' },
  { id: 'word', label: 'Word', warna: 'biru' },
  { id: 'pdf', label: 'PDF', warna: 'merah' },
  { id: 'excel', label: 'Excel', warna: 'hijau' },
  { id: 'ppt', label: 'PowerPoint', warna: 'oranye' },
  { id: 'gambar', label: 'Images', warna: 'ungu' },
  { id: 'diagram', label: 'Diagram', warna: 'kuning' },
  { id: 'lain', label: 'Other', warna: 'nila' }
]

const WARNA: Record<KategoriPustaka, string> = {
  word: 'biru',
  pdf: 'merah',
  excel: 'hijau',
  ppt: 'oranye',
  gambar: 'ungu',
  diagram: 'kuning',
  lain: 'nila'
}

function ikon(k: KategoriPustaka | 'all', s: number): JSX.Element {
  if (k === 'word' || k === 'pdf') return <IconFileText size={s} />
  if (k === 'excel') return <IconTable size={s} />
  if (k === 'ppt') return <IconPresentation size={s} />
  if (k === 'gambar') return <IconImage size={s} />
  if (k === 'diagram') return <IconTimeline size={s} />
  if (k === 'all') return <IconLibrary size={s} />
  return <IconFile size={s} />
}

type Urut = 'newest' | 'oldest' | 'name' | 'largest'

const ukuran = (b: number | null): string =>
  b === null ? '—' : b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`

const tanggal = (ms: number): string =>
  new Date(ms).toLocaleString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Thumbnail gambar dimuat per kartu, hanya saat kartunya tampil. */
function Thumb({ it }: { it: ItemPustaka }): JSX.Element {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!it.galeriId || it.hilang) return
    let batal = false
    void window.aira
      .pustakaThumb(it.galeriId)
      .then((d) => !batal && setSrc(d))
      .catch(() => undefined)
    return () => {
      batal = true
    }
  }, [it.galeriId, it.hilang])
  if (src) return <img className="pky-thumb-img" src={src} alt="" />
  return <span className={`tile-ikon ${WARNA[it.kategori]} pky-thumb-ikon`}>{ikon(it.kategori, 30)}</span>
}

export default function Pustaka({ onBukaSesi }: Props): JSX.Element {
  const [item, setItem] = useState<ItemPustaka[] | null>(null)
  const [galat, setGalat] = useState<string | null>(null)
  const [jenis, setJenis] = useState<KategoriPustaka | 'all'>('all')
  const [cari, setCari] = useState('')
  const [urut, setUrut] = useState<Urut>('newest')
  const [tampilan, setTampilan] = useState<'grid' | 'list'>('grid')
  const [pesan, setPesan] = useState<string | null>(null)

  const muat = (): void => {
    void window.aira
      .pustakaDaftar()
      .then((x) => {
        setItem(x)
        setGalat(null)
      })
      .catch((e) => setGalat(e instanceof Error ? e.message : String(e)))
  }
  useEffect(muat, [])

  const hitung = useMemo(() => {
    const h: Record<string, number> = { all: item?.length ?? 0 }
    for (const x of item ?? []) h[x.kategori] = (h[x.kategori] ?? 0) + 1
    return h
  }, [item])

  const tampil = useMemo(() => {
    const q = cari.trim().toLowerCase()
    const hasil = (item ?? []).filter(
      (x) =>
        (jenis === 'all' || x.kategori === jenis) &&
        (!q ||
          x.nama.toLowerCase().includes(q) ||
          (x.judulSesi ?? '').toLowerCase().includes(q) ||
          (x.keterangan ?? '').toLowerCase().includes(q))
    )
    const salin = [...hasil]
    if (urut === 'oldest') salin.sort((a, b) => a.dibuat - b.dibuat)
    else if (urut === 'name') salin.sort((a, b) => a.nama.localeCompare(b.nama, 'en'))
    else if (urut === 'largest') salin.sort((a, b) => (b.ukuran ?? -1) - (a.ukuran ?? -1))
    return salin
  }, [item, jenis, cari, urut])

  const jumlahHilang = (item ?? []).filter((x) => x.hilang).length

  const buka = async (it: ItemPustaka, aksi: 'buka' | 'folder'): Promise<void> => {
    try {
      const ok = await window.aira.berkasBuka(it.path, aksi)
      if (!ok) setPesan('The file "' + it.nama + '" could not be opened — there may be no app installed for this file type.')
    } catch (e) {
      setPesan(e instanceof Error ? e.message.split('Error: ').pop() ?? e.message : String(e))
    }
  }

  const sesi = (it: ItemPustaka): void => {
    if (it.sessionId && !onBukaSesi(it.sessionId)) setPesan('The conversation this file came from has been deleted from your history.')
  }

  /** Gambar dari galeri berjudul prompt-nya; nama berkasnya (UUID) tetap terlihat di tooltip. */
  const judul = (it: ItemPustaka): string => it.keterangan ?? it.nama

  const asal = (it: ItemPustaka): string =>
    it.asal === 'gambar' ? 'Created on the Images screen' : it.judulSesi ? `From: ${it.judulSesi}` : 'From a conversation'

  const aksi = (it: ItemPustaka): JSX.Element => (
    <div className="pky-aksi">
      <button disabled={it.hilang} onClick={() => void buka(it, 'buka')} title="Open file">
        Open
      </button>
      <button disabled={it.hilang} onClick={() => void buka(it, 'folder')} title="Show in folder">
        <IconFolder size={14} />
      </button>
      {it.sessionId && (
        <button onClick={() => sesi(it)} title="Open the source conversation">
          <IconChat size={14} />
        </button>
      )}
    </div>
  )

  return (
    <div className="pky">
      <header className="pky-hero">
        <span className="pky-hero-ikon">
          <IconLibrary size={28} />
        </span>
        <div className="pky-hero-teks">
          <span className="pdx-lencana">Library</span>
          <h1>File Library</h1>
          <p>
            Every file AIRA has created for you — Word and PDF reports, Excel sheets, presentations, and images — in one
            place. Only files that belong to your account are shown.
          </p>
        </div>
        <svg className="pky-seni" viewBox="0 0 240 120" aria-hidden="true">
          <circle cx="200" cy="30" r="44" fill="#d7eedf" opacity="0.6" />
          <rect x="40" y="30" width="62" height="80" rx="8" fill="#ffffff" stroke="#d6eadc" transform="rotate(-10 71 70)" />
          <rect x="52" y="48" width="36" height="5" rx="2.5" fill="#9ec3f0" transform="rotate(-10 71 70)" />
          <rect x="90" y="18" width="62" height="86" rx="8" fill="#ffffff" stroke="#d6eadc" />
          <rect x="102" y="34" width="38" height="24" rx="4" fill="#f5b9b0" />
          <rect x="102" y="66" width="38" height="5" rx="2.5" fill="#dcebe1" />
          <rect x="102" y="78" width="28" height="5" rx="2.5" fill="#e8f2eb" />
          <rect x="140" y="30" width="62" height="80" rx="8" fill="#ffffff" stroke="#d6eadc" transform="rotate(10 171 70)" />
          <rect x="152" y="50" width="12" height="30" rx="2" fill="#8fd0a3" transform="rotate(10 171 70)" />
          <rect x="168" y="42" width="12" height="38" rx="2" fill="#5cb97a" transform="rotate(10 171 70)" />
        </svg>
      </header>

      <div className="pky-jenis">
        {JENIS.filter((j) => j.id === 'all' || j.id !== 'lain' || (hitung.lain ?? 0) > 0).map((j) => (
          <button key={j.id} className={`pky-jenis-kartu ${jenis === j.id ? 'aktif' : ''}`} onClick={() => setJenis(j.id)}>
            <span className={`tile-ikon ${j.warna}`}>{ikon(j.id, 20)}</span>
            <span>
              <strong>{hitung[j.id] ?? 0}</strong>
              <small>{j.label}</small>
            </span>
          </button>
        ))}
      </div>

      <div className="pky-alat">
        <div className="pky-cari">
          <IconSearch size={16} />
          <input value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Search by file name or conversation title…" />
          {cari && (
            <button onClick={() => setCari('')} title="Clear">
              ×
            </button>
          )}
        </div>
        <label className="gambar-pilih">
          <select value={urut} onChange={(e) => setUrut(e.target.value as Urut)}>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="name">Name A–Z</option>
            <option value="largest">Largest size</option>
          </select>
        </label>
        <div className="pky-tampilan">
          <button className={tampilan === 'grid' ? 'aktif' : ''} onClick={() => setTampilan('grid')} title="Grid">
            <IconGrid size={16} />
          </button>
          <button className={tampilan === 'list' ? 'aktif' : ''} onClick={() => setTampilan('list')} title="List">
            <IconList size={16} />
          </button>
        </div>
      </div>

      {jumlahHilang > 0 && (
        <p className="pky-info">
          {jumlahHilang} {jumlahHilang === 1 ? 'file has' : 'files have'} been moved or deleted outside AIRA — still listed
          with a “Missing” tag so it is clear they were once created.
        </p>
      )}
      {pesan && (
        <div className="psn-galat-bar pky-pesan" onClick={() => setPesan(null)} title="Click to dismiss">
          {pesan}
        </div>
      )}

      {galat ? (
        <p className="pky-kosong">The library could not be loaded: {galat}</p>
      ) : item === null ? (
        <p className="pky-kosong">Loading library…</p>
      ) : tampil.length === 0 ? (
        <p className="pky-kosong">
          {item.length === 0
            ? 'No files yet. Ask AIRA to create a report, presentation, or image — the results will collect here.'
            : 'No files match this filter.'}
        </p>
      ) : tampilan === 'grid' ? (
        <div className="pky-grid">
          {tampil.map((it) => (
            <article key={it.path} className={`pky-kartu${it.hilang ? ' hilang' : ''}`}>
              <button className="pky-thumb" disabled={it.hilang} onClick={() => void buka(it, 'buka')} title={it.hilang ? 'File missing' : 'Open'}>
                <Thumb it={it} />
                <span className="pky-lencana-ext">{it.ekstensi.toUpperCase() || '?'}</span>
                {it.hilang && <span className="pky-lencana-hilang">Missing</span>}
              </button>
              <div className="pky-kartu-teks">
                <strong title={judul(it) + '\n' + it.nama}>{judul(it)}</strong>
                <small title={asal(it)}>{asal(it)}</small>
                <small>
                  {tanggal(it.dibuat)} · {ukuran(it.ukuran)}
                </small>
              </div>
              {aksi(it)}
            </article>
          ))}
        </div>
      ) : (
        <div className="pky-daftar-wadah">
          <table className="fbx-tabel pky-tabel">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Source</th>
                <th>Created</th>
                <th>Size</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tampil.map((it) => (
                <tr key={it.path} className={it.hilang ? 'hilang' : ''}>
                  <td>
                    <div className="pky-nama-sel">
                      <span className={`tile-ikon ${WARNA[it.kategori]} mini`}>{ikon(it.kategori, 14)}</span>
                      <span title={it.path}>{judul(it)}</span>
                      {it.hilang && <span className="fbx-tag merah">Missing</span>}
                    </div>
                  </td>
                  <td>{it.ekstensi.toUpperCase()}</td>
                  <td className="pky-asal-sel" title={asal(it)}>
                    {asal(it)}
                  </td>
                  <td className="nowrap">{tanggal(it.dibuat)}</td>
                  <td className="nowrap">{ukuran(it.ukuran)}</td>
                  <td>{aksi(it)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
