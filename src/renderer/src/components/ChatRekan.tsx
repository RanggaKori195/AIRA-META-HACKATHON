import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { GrupRingkas, PesanChatIpc, RekanChat, SetelanChat } from '@shared/ipc'
import { IconChat, IconClose } from './Icons'
import { BuatGrup } from './chat/BuatGrup'
import { DaftarPercakapan } from './chat/DaftarPercakapan'
import { RuangPercakapan } from './chat/RuangPercakapan'
import { ProfilPanel } from './chat/ProfilPanel'
import { Avatar } from './chat/Avatar'
import { belumItem, kunciGrup, susunDaftar, type ItemPercakapan } from './chat/bantu'

/*
 * Pesan antar rekan — "WhatsApp lite" di dalam AIRA (tahap 1–3, 16 Sep 2026;
 * tampilan tiga kolom 30 Sep 2026 mengikuti mockup user).
 *
 * Tombol di pojok kanan bawah membuka panel: daftar percakapan (kiri), ruang
 * chat (tengah), profil & berkas (kanan).
 *
 * ⚠️ Komponen ini TIDAK PERNAH mengirim "siapa saya" atau "saya admin". `saya`
 * di bawah hanya dipakai untuk MENAMPILKAN ("Kamu: …", gelembung kanan). Semua
 * keputusan izin ada di main process, dari sesi, di klausa WHERE.
 */

/** Selang memuat ulang daftar. Lebih lambat dari pesan: daftar tidak mendesak. */
const POLL_DAFTAR_MS = 10_000

type Tanda = { sematan: string[]; favorit: string[] }

/**
 * Sematan & favorit: preferensi TAMPILAN, disimpan di laptop ini per username
 * (pola senyap §62 — laptop dipakai bergantian). Bukan data percakapan, jadi
 * tidak ke server. Gagal baca/tulis = daftar polos, tidak mengganggu chat.
 */
function kunciTanda(saya: string): string {
  return `aira.pesan.tanda.${saya.toLowerCase()}`
}

function bacaTanda(saya: string): Tanda {
  try {
    const x = JSON.parse(localStorage.getItem(kunciTanda(saya)) ?? '{}') as Partial<Tanda>
    return {
      sematan: Array.isArray(x.sematan) ? x.sematan.filter((v) => typeof v === 'string') : [],
      favorit: Array.isArray(x.favorit) ? x.favorit.filter((v) => typeof v === 'string') : []
    }
  } catch {
    return { sematan: [], favorit: [] }
  }
}

function IconPerbesar({ besar }: { besar: boolean }): JSX.Element {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {besar ? <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" /> : <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />}
    </svg>
  )
}

export function ChatRekan({ saya }: { saya: string }): JSX.Element | null {
  const [buka, setBuka] = useState(false)
  const [besar, setBesar] = useState(false)
  const [rekan, setRekan] = useState<RekanChat[]>([])
  const [grup, setGrup] = useState<GrupRingkas[]>([])
  const [siap, setSiap] = useState<boolean | null>(null)
  const [terpilih, setTerpilih] = useState<string | null>(null)
  const [kiri, setKiri] = useState<{ mode: 'daftar' } | { mode: 'buat'; awal: string[] }>({ mode: 'daftar' })
  const [senyap, setSenyap] = useState<string[]>([])
  const [setelan, setSetelan] = useState<SetelanChat | null>(null)
  const [tanda, setTanda] = useState<Tanda>(() => bacaTanda(saya))
  const [pesanTampil, setPesanTampil] = useState<PesanChatIpc[]>([])

  useEffect(() => setTanda(bacaTanda(saya)), [saya])

  const ubahTanda = useCallback(
    (jenis: keyof Tanda, kunci: string) => {
      setTanda((t) => {
        const ada = t[jenis].includes(kunci)
        const baru = { ...t, [jenis]: ada ? t[jenis].filter((k) => k !== kunci) : [...t[jenis], kunci] }
        try {
          localStorage.setItem(kunciTanda(saya), JSON.stringify(baru))
        } catch {
          /* penyimpanan lokal tidak tersedia — tanda berlaku sampai aplikasi ditutup */
        }
        return baru
      })
    },
    [saya]
  )

  const muat = useCallback(async () => {
    try {
      const [r, g] = await Promise.all([window.aira.chatRekan(), window.aira.chatGrupDaftar()])
      setRekan(r)
      setGrup(g)
      setSiap(true)
    } catch {
      // Database chat tidak terjangkau (jaringan putus). Tombol disembunyikan,
      // bukan ditampilkan dengan daftar kosong yang membingungkan.
      setSiap(false)
    }
  }, [])

  useEffect(() => {
    void muat()
    const t = setInterval(() => void muat(), POLL_DAFTAR_MS)
    // Main process menemukan pesan masuk -> segarkan SEKARANG. Tanpa ini pesan
    // baru muncul di daftar beberapa detik sesudah toast-nya berbunyi.
    const lepas = window.aira.onChatPesanBaru(() => void muat())
    return () => {
      clearInterval(t)
      lepas()
    }
  }, [muat])

  useEffect(() => {
    void (async () => {
      try {
        setSenyap(await window.aira.chatSenyapDaftar())
        setSetelan(await window.aira.chatSetelan())
      } catch {
        /* belum login / config tak terbaca — panel tetap jalan tanpa ini */
      }
    })()
  }, [])

  // Esc menutup panel — kebiasaan yang sama dengan jendela obrolan mana pun.
  useEffect(() => {
    if (!buka) return
    const tekan = (e: KeyboardEvent): void => {
      // Dialog konfirmasi punya Esc-nya sendiri; jangan ikut menutup panel.
      if (e.key === 'Escape' && !document.querySelector('.dialog-backdrop')) setBuka(false)
    }
    window.addEventListener('keydown', tekan)
    return () => window.removeEventListener('keydown', tekan)
  }, [buka])

  const { percakapan, rekanLain } = useMemo(() => susunDaftar(rekan, grup), [rekan, grup])
  const semua = useMemo(() => [...percakapan, ...rekanLain], [percakapan, rekanLain])
  const item = semua.find((x) => x.kunci === terpilih) ?? null
  const sematan = useMemo(() => new Set(tanda.sematan), [tanda.sematan])
  const favorit = useMemo(() => new Set(tanda.favorit), [tanda.favorit])

  useEffect(() => setPesanTampil([]), [terpilih])

  const disenyapkan = useCallback(
    (x: ItemPercakapan): boolean => {
      const k = kunciSenyapItem(x)
      return senyap.some((s) => s.toLowerCase() === k)
    },
    [senyap]
  )

  const ubahSenyap = useCallback(
    async (x: ItemPercakapan) => {
      try {
        setSenyap(await window.aira.chatSenyapSetel(kunciSenyapItem(x), !disenyapkan(x)))
      } catch {
        /* gagal menyimpan preferensi bukan alasan mengganggu percakapan */
      }
    },
    [disenyapkan]
  )

  const jawabAutoStart = useCallback(async (nyalakan: boolean) => {
    try {
      setSetelan(
        await window.aira.chatSetelanSetel(nyalakan ? { autoStart: true } : { tandaiDitanya: true })
      )
    } catch {
      /* noop */
    }
  }, [])

  if (siap === false) return null

  const totalBelum = semua.reduce((n, x) => n + belumItem(x), 0)
  const online = rekan.filter((r) => r.online).length
  const grupDengan = (x: ItemPercakapan | null): void =>
    setKiri({ mode: 'buat', awal: x && x.jenis === 'orang' ? [x.rekan.username] : [] })

  return (
    <div className="chatr-pojok">
      {buka && (
        <div className={`psn-panel${besar ? ' besar' : ''}`} role="dialog" aria-label="Pesan">
          <header className="psn-panel-kepala">
            <span className="psn-panel-ikon">
              <IconChat size={22} />
            </span>
            <strong>Pesan</strong>
            <button className="psn-ikon" onClick={() => setBesar((b) => !b)} title={besar ? 'Perkecil' : 'Perbesar'}>
              <IconPerbesar besar={besar} />
            </button>
            <button className="psn-ikon" onClick={() => setBuka(false)} title="Tutup (Esc)">
              <IconClose size={17} />
            </button>
          </header>

          <div className="psn-panel-badan">
            <div className="psn-kiri">
              {kiri.mode === 'buat' ? (
                <BuatGrup
                  rekan={rekan}
                  awal={kiri.awal}
                  onBatal={() => setKiri({ mode: 'daftar' })}
                  onJadi={(id) => {
                    setKiri({ mode: 'daftar' })
                    setTerpilih(kunciGrup(id))
                    void muat()
                  }}
                />
              ) : (
                <DaftarPercakapan
                  saya={saya}
                  percakapan={percakapan}
                  rekanLain={rekanLain}
                  terpilih={terpilih}
                  senyap={disenyapkan}
                  disematkan={sematan}
                  favorit={favorit}
                  setelan={setelan}
                  onPilih={setTerpilih}
                  onGrupBaru={() => grupDengan(null)}
                  onAutoStart={(n) => void jawabAutoStart(n)}
                />
              )}
            </div>

            <div className="psn-kanan">
              {item ? (
                <RuangPercakapan
                  key={item.kunci}
                  saya={saya}
                  item={item}
                  rekan={rekan}
                  senyap={disenyapkan(item)}
                  disematkan={sematan.has(item.kunci)}
                  favorit={favorit.has(item.kunci)}
                  onSenyap={() => void ubahSenyap(item)}
                  onSematkan={() => ubahTanda('sematan', item.kunci)}
                  onFavorit={() => ubahTanda('favorit', item.kunci)}
                  onTambahOrang={() => grupDengan(item)}
                  onPesan={setPesanTampil}
                  onBerubah={() => void muat()}
                />
              ) : (
                <div className="psn-sambut">
                  <span className="psn-sambut-ikon">
                    <IconChat size={30} />
                  </span>
                  <h3>Pesan AIRA</h3>
                  <p>Pilih percakapan di kiri, atau buat grup baru lewat ikon di sebelah kotak cari.</p>
                  <p className="psn-sambut-kecil">
                    {online} rekan sedang online. Pesan untuk rekan yang offline tetap tersimpan dan
                    sampai saat mereka membuka AIRA.
                  </p>
                </div>
              )}
            </div>

            {item && (
              <ProfilPanel
                key={item.kunci}
                item={item}
                grup={grup}
                pesan={pesanTampil}
                onTambahOrang={() => grupDengan(item)}
              />
            )}
          </div>
        </div>
      )}

      <button
        className={`chatr-tombol${buka ? ' buka' : ''}`}
        onClick={() => setBuka((v) => !v)}
        title={buka ? 'Tutup pesan (Esc)' : 'Buka pesan'}
      >
        <Avatar nama={saya} ukuran={20} />
        Pesan
        {online > 0 && (
          <span className="chatr-hitung" title={`${online} rekan online`}>
            {online}
          </span>
        )}
        {totalBelum > 0 && (
          <span className="chatr-lencana">{totalBelum > 99 ? '99+' : totalBelum}</span>
        )}
      </button>
    </div>
  )
}

/**
 * Kunci senyap: username untuk orang, `grup:<id>` untuk grup — format yang sama
 * dengan yang dibaca pengawas notifikasi di main process (`kunciSenyapGrup`).
 */
function kunciSenyapItem(x: ItemPercakapan): string {
  return x.jenis === 'grup' ? kunciGrup(x.grup.id) : x.rekan.username.toLowerCase()
}
