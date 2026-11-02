import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { PesanChatIpc, RekanChat } from '@shared/ipc'
import { teksSistem } from '@shared/chat-sistem'
import ConfirmDialog from '../ConfirmDialog'
import { IconAttach, IconMore, IconSend, IconSmile, IconTrash } from '../Icons'
import { Avatar } from './Avatar'
import { InfoGrup } from './InfoGrup'
import { bersih } from './BuatGrup'
import {
  hariBaru,
  jabatanRekan,
  jamPesan,
  labelTanggalPanjang,
  statusOrang,
  tandaBaca,
  warnaNama,
  type ItemPercakapan
} from './bantu'

/** Emoji yang paling sering dipakai di chat kantor — cukup satu panel pilihan, bukan katalog. */
const EMOJI = ['😀', '😂', '😊', '😍', '😅', '🤔', '😮', '😢', '🙏', '👍', '👌', '👏', '🙌', '💪', '🤝', '👋', '🎉', '🔥', '✨', '❤️', '✅', '📎', '📊', '⏰']

/** Event dari panel profil ("Chat") untuk memfokuskan kotak tulis. */
export const EVENT_FOKUS_TULIS = 'psn-fokus-tulis'

function IconVideo(): JSX.Element {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="m16 10 5-3v10l-5-3z" />
    </svg>
  )
}

function IconTelepon(): JSX.Element {
  return (
    <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
    </svg>
  )
}

function IconTambahOrang(): JSX.Element {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6" />
    </svg>
  )
}

/** Panggilan belum ada di AIRA — tombolnya tampil (mengikuti mockup) tapi mati dan MENGATAKANNYA. */
export const BELUM_ADA_PANGGILAN = 'Panggilan suara & video belum tersedia di AIRA'
export { IconVideo, IconTelepon, IconTambahOrang }

/** Selang memuat pesan baru saat ruang terbuka. Sama dengan `chat/rules.ts`. */
const POLL_PESAN_MS = 4_000
/** Batas yang sama dengan `chat/rules.ts`. Ditegakkan ulang di main process. */
const MAKS_LAMPIRAN = 5 * 1024 * 1024

function ukuran(byte: number | null): string {
  if (byte === null) return ''
  if (byte < 1024) return `${byte} B`
  if (byte < 1048576) return `${(byte / 1024).toFixed(0)} KB`
  return `${(byte / 1048576).toFixed(1)} MB`
}

/**
 * Ruang percakapan — satu komponen untuk chat pribadi DAN grup.
 *
 * Satu komponen, bukan dua: perilaku yang sama (hapus, lampiran, tanda baca,
 * pemisah tanggal) tidak boleh punya dua salinan yang suatu hari menyimpang —
 * pola yang sama dengan `TombolDikte` untuk keenam kotak chat AIRA.
 */
export function RuangPercakapan({
  saya,
  item,
  rekan,
  senyap,
  disematkan,
  favorit,
  onSenyap,
  onSematkan,
  onFavorit,
  onTambahOrang,
  onPesan,
  onBerubah
}: {
  saya: string
  item: ItemPercakapan
  rekan: readonly RekanChat[]
  senyap: boolean
  disematkan: boolean
  favorit: boolean
  onSenyap: () => void
  onSematkan: () => void
  onFavorit: () => void
  /** Chat pribadi: buat grup bersama orang ini. (Grup: tambah anggota lewat Info grup.) */
  onTambahOrang: () => void
  /** Pesan yang sedang tampil — panel profil memakainya untuk tab File. */
  onPesan: (pesan: PesanChatIpc[]) => void
  /** Ada perubahan — daftar percakapan di kiri perlu dimuat ulang. */
  onBerubah: () => void
}): JSX.Element {
  const [pesan, setPesan] = useState<PesanChatIpc[]>([])
  const [teks, setTeks] = useState('')
  const [sibuk, setSibuk] = useState(false)
  const [galat, setGalat] = useState<string | null>(null)
  const [hapus, setHapus] = useState<PesanChatIpc | null>(null)
  const [info, setInfo] = useState(false)
  const [menu, setMenu] = useState(false)
  const [emoji, setEmoji] = useState(false)
  const bawahRef = useRef<HTMLDivElement | null>(null)
  const berkasRef = useRef<HTMLInputElement | null>(null)
  const teksRef = useRef<HTMLTextAreaElement | null>(null)

  const diGrup = item.jenis === 'grup'
  const aktif = item.jenis === 'orang' || item.grup.aktif
  const kunciMuat = item.kunci

  const muat = useCallback(async () => {
    try {
      if (item.jenis === 'grup') {
        setPesan(await window.aira.chatGrupPesan(item.grup.id))
        await window.aira.chatGrupTandaiDibaca(item.grup.id)
      } else {
        setPesan(await window.aira.chatPercakapan(item.rekan.username))
        // Ditandai dibaca setiap kali dimuat: ruangnya sedang terbuka di depan mata.
        await window.aira.chatTandaiDibaca(item.rekan.username)
      }
    } catch (e) {
      setGalat(bersih(e))
    }
    // `kunciMuat` sengaja jadi satu-satunya ketergantungan: objek `item` berganti
    // tiap daftar dimuat ulang (10 detik), dan menjadikannya ketergantungan
    // membuat polling di bawah dipasang ulang terus-menerus. Id grup / username
    // yang dipakai di atas tidak pernah berubah untuk kunci yang sama.
  }, [kunciMuat])

  // Ganti percakapan -> kosongkan dulu, supaya pesan ruang sebelumnya tidak
  // sempat terlihat di bawah nama orang lain.
  useEffect(() => {
    setPesan([])
    setTeks('')
    setGalat(null)
    setInfo(false)
    void muat()
    const t = setInterval(() => void muat(), POLL_PESAN_MS)
    const lepas = window.aira.onChatPesanBaru(() => void muat())
    teksRef.current?.focus()
    return () => {
      clearInterval(t)
      lepas()
    }
  }, [muat])

  useEffect(() => {
    onPesan(pesan)
    // `onPesan` sengaja bukan ketergantungan: fungsi induknya dibuat ulang tiap render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pesan])

  useEffect(() => {
    const fokus = (): void => teksRef.current?.focus()
    const tutup = (): void => {
      setMenu(false)
      setEmoji(false)
    }
    // 'psn-info-grup' = EVENT_INFO_GRUP di ProfilPanel (literal supaya tidak saling impor).
    const bukaInfo = (): void => setInfo(true)
    window.addEventListener(EVENT_FOKUS_TULIS, fokus)
    window.addEventListener('psn-info-grup', bukaInfo)
    window.addEventListener('click', tutup)
    return () => {
      window.removeEventListener(EVENT_FOKUS_TULIS, fokus)
      window.removeEventListener('psn-info-grup', bukaInfo)
      window.removeEventListener('click', tutup)
    }
  }, [])

  // Selalu menggulir ke pesan terbaru saat jumlah pesan bertambah.
  useEffect(() => {
    bawahRef.current?.scrollIntoView({ block: 'end' })
  }, [pesan.length])

  const kirim = useCallback(
    async (lampiran?: { nama: string; mime: string; data: Uint8Array }) => {
      const isi = teks.trim()
      if (!isi && !lampiran) return
      setSibuk(true)
      setGalat(null)
      try {
        if (item.jenis === 'grup') {
          await window.aira.chatGrupKirim({ grupId: item.grup.id, isi, lampiran })
        } else {
          await window.aira.chatKirim({ ke: item.rekan.username, isi, lampiran })
        }
        setTeks('')
        await muat()
        onBerubah()
      } catch (e) {
        setGalat(bersih(e))
      } finally {
        setSibuk(false)
        teksRef.current?.focus()
      }
    },
    [teks, item, muat, onBerubah]
  )

  const pilihBerkas = useCallback(
    async (file: File) => {
      // Batas diperiksa di sini HANYA supaya pesan galatnya cepat; yang
      // sebenarnya menahan tetap `periksaLampiran` di main process.
      if (file.size > MAKS_LAMPIRAN) {
        setGalat(`Berkas melebihi ${MAKS_LAMPIRAN / 1048576} MB. Taruh di OneDrive lalu kirim tautannya.`)
        return
      }
      const buf = new Uint8Array(await file.arrayBuffer())
      await kirim({ nama: file.name, mime: file.type || 'application/octet-stream', data: buf })
    },
    [kirim]
  )

  const jalankanHapus = useCallback(
    async (id: string) => {
      setHapus(null)
      try {
        const ok = await window.aira.chatHapusPesan(id)
        // `false` BUKAN galat jaringan: main process menolak karena pesannya
        // bukan milik kita atau sudah dihapus. Dikatakan apa adanya.
        if (!ok) setGalat('Pesan tidak bisa dihapus — hanya pengirimnya yang bisa menghapus.')
        await muat()
        onBerubah()
      } catch (e) {
        setGalat(bersih(e))
      }
    },
    [muat, onBerubah]
  )

  // Tinggi kotak tulis mengikuti isinya, sampai batas tertentu.
  useEffect(() => {
    const el = teksRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [teks])

  const nama = item.jenis === 'grup' ? item.grup.nama : item.rekan.username
  const online = item.jenis === 'orang' && item.rekan.online
  const sub =
    item.jenis === 'grup'
      ? item.grup.aktif
        ? `${item.grup.jumlahAnggota} anggota`
        : 'Kamu sudah bukan anggota'
      : [online ? 'Online' : statusOrang(item.rekan), jabatanRekan(item.rekan)].filter(Boolean).join(' • ')

  const menuItem = (label: string, aksi: () => void): JSX.Element => (
    <button
      onClick={() => {
        setMenu(false)
        aksi()
      }}
    >
      {label}
    </button>
  )

  return (
    <section className="psn-ruang">
      <header className="psn-ruang-kepala">
        <button
          className="psn-ruang-identitas"
          onClick={() => diGrup && setInfo(true)}
          disabled={!diGrup}
          title={diGrup ? 'Info grup' : undefined}
        >
          <Avatar nama={nama} grup={diGrup} online={online} ukuran={40} />
          <span className="psn-kepala-teks">
            <strong>{nama}</strong>
            <span className={online ? 'online' : ''}>{sub}</span>
          </span>
        </button>
        <button className="psn-ikon" disabled title={BELUM_ADA_PANGGILAN}>
          <IconVideo />
        </button>
        <button className="psn-ikon" disabled title={BELUM_ADA_PANGGILAN}>
          <IconTelepon />
        </button>
        {aktif && (
          <button
            className="psn-ikon"
            onClick={() => (diGrup ? setInfo(true) : onTambahOrang())}
            title={diGrup ? 'Tambah anggota (Info grup)' : `Buat grup bersama ${nama}`}
          >
            <IconTambahOrang />
          </button>
        )}
        <div className="psn-menu-wadah" onClick={(e) => e.stopPropagation()}>
          <button className="psn-ikon" onClick={() => setMenu((m) => !m)} title="Pilihan lain">
            <IconMore size={18} />
          </button>
          {menu && (
            <div className="psn-menu">
              {menuItem(disematkan ? 'Lepas sematan' : 'Sematkan percakapan', onSematkan)}
              {menuItem(favorit ? 'Hapus dari favorit' : 'Tambah ke favorit', onFavorit)}
              {menuItem(senyap ? 'Nyalakan notifikasi' : 'Matikan notifikasi', onSenyap)}
              {diGrup && menuItem('Info grup', () => setInfo(true))}
            </div>
          )}
        </div>
      </header>

      <div className="psn-pesan">
        {pesan.length === 0 && !galat && (
          <p className="psn-kosong-ruang">
            {diGrup ? 'Belum ada pesan di grup ini.' : `Belum ada pesan. Sapa ${nama} duluan.`}
          </p>
        )}

        {pesan.map((p, i) => {
          const sebelum = pesan[i - 1]
          const pemisah = hariBaru(sebelum, p) ? (
            <div className="psn-tanggal" key={`t-${p.id}`}>
              <span>{labelTanggalPanjang(p.createdAt)}</span>
            </div>
          ) : null

          // Pesan sistem: pil di tengah, bukan gelembung — ia keterangan,
          // bukan ucapan seseorang.
          if (p.jenis) {
            return (
              <div key={p.id}>
                {pemisah}
                <div className="psn-sistem">
                  <span>{teksSistem(p.jenis, p.pengirim, p.target, saya)}</span>
                </div>
              </div>
            )
          }

          const dariSaya = p.pengirim.toLowerCase() === saya.toLowerCase()
          // Nama pengirim di grup cukup sekali untuk rentetan pesan dari orang
          // yang sama — mengulangnya di tiap gelembung membuat kolom sempit ini
          // penuh nama dan sulit dibaca.
          const tampilNama =
            diGrup &&
            !dariSaya &&
            (!sebelum || !!pemisah || !!sebelum.jenis || sebelum.pengirim.toLowerCase() !== p.pengirim.toLowerCase())
          const tanda = tandaBaca(p, saya)

          return (
            <div key={p.id}>
              {pemisah}
              <div className={`psn-baris${dariSaya ? ' saya' : ''}${tampilNama ? ' awal' : ''}`}>
                {p.dihapusAt ? (
                  // Nisan: barisnya tetap ada supaya percakapan tidak berlubang.
                  <div className="psn-gelembung nisan">
                    <span className="psn-isi">🚫 Pesan ini dihapus</span>
                    <span className="psn-meta">{jamPesan(p.createdAt)}</span>
                  </div>
                ) : (
                  <div className="psn-gelembung">
                    {tampilNama && (
                      <span className="psn-pengirim" style={{ color: warnaNama(p.pengirim) }}>
                        {p.pengirim}
                      </span>
                    )}
                    {p.lampiranNama && (
                      <button
                        className="psn-lampiran"
                        onClick={() =>
                          void window.aira.chatSimpanLampiran(p.id).catch((e) => setGalat(bersih(e)))
                        }
                        title="Klik untuk menyimpan berkas"
                      >
                        <span className="psn-lampiran-ikon">
                          <IconAttach size={16} />
                        </span>
                        <span className="psn-lampiran-teks">
                          <strong>{p.lampiranNama}</strong>
                          <span>{ukuran(p.lampiranUkuran)} · klik untuk simpan</span>
                        </span>
                      </button>
                    )}
                    {p.isi && <span className="psn-isi">{p.isi}</span>}
                    <span className="psn-meta">
                      {jamPesan(p.createdAt)}
                      {tanda && (
                        <span className={`psn-centang${tanda === '✓✓' ? ' dibaca' : ''}`} title={tanda === '✓✓' ? 'Sudah dibaca' : 'Terkirim'}>
                          {tanda}
                        </span>
                      )}
                    </span>
                  </div>
                )}
                {/* Tombol hapus hanya pada pesan SENDIRI. Kenyamanan, bukan
                    penguncian — main process menolak yang bukan miliknya. */}
                {dariSaya && !p.dihapusAt && (
                  <button className="psn-hapus" title="Hapus pesan ini" onClick={() => setHapus(p)}>
                    <IconTrash size={13} />
                  </button>
                )}
              </div>
            </div>
          )
        })}
        <div ref={bawahRef} />
      </div>

      {galat && (
        <div className="psn-galat-bar" onClick={() => setGalat(null)} title="Klik untuk menutup">
          {galat}
        </div>
      )}

      {aktif ? (
        <footer className="psn-tulis">
          <input
            ref={berkasRef}
            type="file"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void pilihBerkas(f)
              e.target.value = ''
            }}
          />
          <button
            className="psn-ikon"
            onClick={() => berkasRef.current?.click()}
            disabled={sibuk}
            title="Kirim gambar atau berkas (maks 5 MB)"
          >
            <IconAttach size={18} />
          </button>
          <div className="psn-menu-wadah" onClick={(e) => e.stopPropagation()}>
            <button className="psn-ikon" onClick={() => setEmoji((x) => !x)} disabled={sibuk} title="Emoji">
              <IconSmile size={18} />
            </button>
            {emoji && (
              <div className="psn-emoji">
                {EMOJI.map((em) => (
                  <button
                    key={em}
                    onClick={() => {
                      setTeks((t) => t + em)
                      teksRef.current?.focus()
                    }}
                  >
                    {em}
                  </button>
                ))}
              </div>
            )}
          </div>
          <textarea
            ref={teksRef}
            rows={1}
            placeholder="Tulis pesan..."
            value={teks}
            disabled={sibuk}
            onChange={(e) => setTeks(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void kirim()
              }
            }}
          />
          <button
            className="psn-kirim"
            onClick={() => void kirim()}
            disabled={sibuk || !teks.trim()}
            title="Kirim (Enter)"
          >
            <IconSend size={16} />
          </button>
        </footer>
      ) : (
        <footer className="psn-tulis-tutup">
          Kamu tidak bisa mengirim pesan ke grup ini karena kamu sudah bukan anggota.
        </footer>
      )}

      {info && item.jenis === 'grup' && (
        <InfoGrup
          grupId={item.grup.id}
          saya={saya}
          rekan={rekan}
          senyap={senyap}
          onSenyap={onSenyap}
          onTutup={() => setInfo(false)}
          onBerubah={() => {
            void muat()
            onBerubah()
          }}
          onKeluar={() => {
            setInfo(false)
            void muat()
            onBerubah()
          }}
        />
      )}

      {hapus && (
        <ConfirmDialog
          title="Hapus pesan ini?"
          body={
            'Isi pesan dibuang untuk kamu DAN untuk ' +
            (diGrup ? 'semua anggota grup' : nama) +
            '. Yang tertinggal keterangan "Pesan ini dihapus" — tidak bisa dibatalkan.'
          }
          onCancel={() => setHapus(null)}
          onConfirm={() => void jalankanHapus(hapus.id)}
        />
      )}
    </section>
  )
}
