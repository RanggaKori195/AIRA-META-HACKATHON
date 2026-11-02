import { useState, type JSX } from 'react'
import type { SetelanChat } from '@shared/ipc'
import { IconBellOff, IconSearch, IconStar, IconUsers } from '../Icons'
import { Avatar } from './Avatar'
import {
  belumItem,
  cocokCari,
  cuplikan,
  jabatanRekan,
  namaItem,
  saringItem,
  terakhirItem,
  waktuDaftar,
  type ItemPercakapan,
  type SaringPesan
} from './bantu'

/**
 * Kolom kiri: daftar percakapan (tampilan 30 Sep 2026 mengikuti mockup user).
 *
 * Tiga bagian — "Disematkan", "Terbaru" (grup & orang yang punya pesan, terbaru
 * di atas), dan "Rekan lain" (untuk memulai obrolan baru). Tab di atas menyaring
 * Semua / Belum dibaca / Grup / Favorit.
 *
 * ⚠️ Sematan & favorit disimpan PER USERNAME di laptop ini (pola senyap §62) —
 * bukan di server. Itu preferensi tampilan, bukan data percakapan.
 */
export function DaftarPercakapan({
  saya,
  percakapan,
  rekanLain,
  terpilih,
  senyap,
  disematkan,
  favorit,
  setelan,
  onPilih,
  onGrupBaru,
  onAutoStart
}: {
  saya: string
  percakapan: ItemPercakapan[]
  rekanLain: ItemPercakapan[]
  terpilih: string | null
  senyap: (item: ItemPercakapan) => boolean
  disematkan: ReadonlySet<string>
  favorit: ReadonlySet<string>
  setelan: SetelanChat | null
  onPilih: (kunci: string) => void
  onGrupBaru: () => void
  onAutoStart: (nyalakan: boolean) => void
}): JSX.Element {
  const [cari, setCari] = useState('')
  const [saring, setSaring] = useState<SaringPesan>('semua')

  const lolos = (x: ItemPercakapan): boolean => cocokCari(x, cari) && saringItem(x, saring, favorit)
  const semua = [...percakapan, ...rekanLain]
  const sematan = semua.filter((x) => disematkan.has(x.kunci) && lolos(x))
  const terbaru = percakapan.filter((x) => !disematkan.has(x.kunci) && lolos(x))
  // Rekan tanpa percakapan hanya relevan di tab Semua/Favorit — "belum dibaca" dan
  // "grup" tidak pernah berisi mereka.
  const lain = rekanLain.filter((x) => !disematkan.has(x.kunci) && lolos(x))
  const totalBelum = semua.filter((x) => belumItem(x) > 0).length

  const baris = (item: ItemPercakapan): JSX.Element => {
    const nama = namaItem(item)
    const terakhir = terakhirItem(item)
    const belum = belumItem(item)
    const grup = item.jenis === 'grup'
    const nonaktif = grup && !item.grup.aktif
    return (
      <button
        key={item.kunci}
        className={`psn-item${terpilih === item.kunci ? ' aktif' : ''}${belum > 0 ? ' belum' : ''}`}
        onClick={() => onPilih(item.kunci)}
      >
        <Avatar nama={nama} grup={grup} online={item.jenis === 'orang' && item.rekan.online} ukuran={42} />
        <span className="psn-item-teks">
          <span className="psn-item-atas">
            <strong className="psn-item-nama">{nama}</strong>
            {terakhir && <span className="psn-item-waktu">{waktuDaftar(terakhir.createdAt)}</span>}
          </span>
          <span className="psn-item-bawah">
            <span className="psn-item-cuplik">
              {terakhir
                ? cuplikan(terakhir, saya, grup)
                : item.jenis === 'orang'
                  ? item.rekan.online
                    ? 'online'
                    : jabatanRekan(item.rekan)
                  : ''}
            </span>
            {nonaktif && <span className="psn-item-tanda">left</span>}
            {favorit.has(item.kunci) && (
              <span className="psn-item-fav" title="Favorite">
                <IconStar size={12} />
              </span>
            )}
            {senyap(item) && (
              <span className="psn-item-senyap" title="Notifications off">
                <IconBellOff size={12} />
              </span>
            )}
            {belum > 0 ? (
              <span className="psn-item-belum">{belum > 99 ? '99+' : belum}</span>
            ) : (
              disematkan.has(item.kunci) && (
                <span className="psn-item-pin" title="Pinned">
                  <IconPin />
                </span>
              )
            )}
          </span>
        </span>
      </button>
    )
  }

  const TAB: Array<{ id: SaringPesan; label: string }> = [
    { id: 'semua', label: 'All' },
    { id: 'belum', label: 'Unread' },
    { id: 'grup', label: 'Groups' },
    { id: 'favorit', label: 'Favorites' }
  ]

  const kosong = sematan.length === 0 && terbaru.length === 0 && lain.length === 0

  return (
    <div className="psn-kiri-isi">
      <div className="psn-cari-baris">
        <div className="psn-cari">
          <IconSearch size={15} />
          <input value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Search conversations or people..." />
          {cari && (
            <button className="psn-cari-hapus" onClick={() => setCari('')} title="Clear">
              ×
            </button>
          )}
        </div>
        <button className="psn-ikon psn-ikon-kotak" onClick={onGrupBaru} title="Create a new group">
          <IconUsers size={17} />
          <span className="psn-ikon-plus">+</span>
        </button>
      </div>

      <div className="psn-tab">
        {TAB.map((t) => (
          <button key={t.id} className={saring === t.id ? 'aktif' : ''} onClick={() => setSaring(t.id)}>
            {t.label}
            {t.id === 'belum' && totalBelum > 0 && <span className="psn-tab-hitung">{totalBelum}</span>}
          </button>
        ))}
      </div>

      {/*
        Tawaran autostart — SEKALI saja. Ditaruh di sini karena inilah layar yang
        dibuka orang dengan niat "supaya bisa dihubungi": tanpa AIRA yang menyala,
        pesan untuknya tidak pernah sampai, dan pengirimnya tidak tahu.
      */}
      {setelan && !setelan.sudahDitanya && !setelan.autoStart && (
        <div className="psn-tawar">
          <p>
            To keep receiving messages, AIRA needs to be running. Start it automatically when Windows
            signs in? AIRA runs quietly in the tray without opening a window.
          </p>
          <div className="psn-tawar-tombol">
            <button className="psn-tombol-utama kecil" onClick={() => onAutoStart(true)}>
              Turn on
            </button>
            <button className="psn-tombol-biasa kecil" onClick={() => onAutoStart(false)}>
              Later
            </button>
          </div>
        </div>
      )}

      <div className="psn-daftar">
        {sematan.length > 0 && <div className="psn-bagian">Pinned</div>}
        {sematan.map(baris)}

        {terbaru.length > 0 && <div className="psn-bagian">Recent</div>}
        {terbaru.map(baris)}

        {lain.length > 0 && <div className="psn-bagian">{terbaru.length > 0 ? 'Other teammates' : 'Teammates'}</div>}
        {lain.map(baris)}

        {kosong && (
          <p className="psn-kosong">
            {cari
              ? `Nothing matches “${cari}”.`
              : saring === 'belum'
                ? 'All messages are read.'
                : saring === 'grup'
                  ? 'No groups yet. Create one with the icon next to the search box.'
                  : saring === 'favorit'
                    ? 'No favorites yet. Mark one from the ⋮ menu in a conversation.'
                    : 'No other teammates are registered yet.'}
          </p>
        )}
      </div>

      <div className="psn-kaki-catatan">AIRA internal chat · not a confidential channel</div>
    </div>
  )
}

export function IconPin({ size = 13 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 17v5M9 3h6l-1 6 4 4H6l4-4z" />
    </svg>
  )
}
