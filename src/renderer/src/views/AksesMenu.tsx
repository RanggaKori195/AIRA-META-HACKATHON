import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import {
  MENU_VALUES,
  ROLE_DIATUR,
  type AccessConfig,
  type AuthUserRow,
  type MenuId,
  type RoleId
} from '@shared/ipc'
import {
  IconBack,
  IconBuilding,
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconFileText,
  IconInfo,
  IconMore,
  IconPlus,
  IconReset,
  IconSave,
  IconSearch,
  IconUser,
  IconUsers
} from '../components/Icons'
import ConfirmDialog from '../components/ConfirmDialog'
import {
  daftarPerubahan,
  halamanDari,
  nilaiTampil,
  nilaiTersimpan,
  penghuni,
  statistik,
  susunBaris,
  ubahDraf,
  type Draf,
  type KolomUrut,
  type SaringStatus,
  type Urutan
} from '../components/akses/bantu'

// Layar "Akses Menu per Role & Divisi" (30 Sep 2026, mengikuti mockup user).
//
// ⚠️ Layar ini KENYAMANAN, bukan penguncian: setiap channel yang dipanggil
// memeriksa ulang role Super Admin dari sesi di main process (`wajibSuperAdmin`).
//
// ⚠️ Centangan masuk DRAF dulu dan baru dikirim lewat "Simpan Perubahan" — SATU
// statement untuk semua sel (`simpanAkses`), jadi tidak pernah tersimpan separuh.
// Kartu statistik & angka di tab dihitung dari data TERSIMPAN, bukan draf.

const MENU_LABELS: Record<MenuId, string> = {
  sales: 'Ask Sales Data',
  masterdata: 'Ask Master Data',
  lab: 'Ask Sample TAT',
  onedrive: 'Ask Microsoft 365',
  reagent: 'Reagent Check'
}

const ROLE_LABELS: Record<RoleId, string> = {
  super_admin: 'Super Admin',
  direktur: 'Director',
  manager: 'Manager',
  spv: 'SPV',
  staff: 'Staff'
}

/** Warna kepala kolom per role, seperti mockup: hijau, biru, oranye. */
const ROLE_KELAS: Partial<Record<RoleId, string>> = {
  manager: 'peran-hijau',
  spv: 'peran-biru',
  staff: 'peran-oranye'
}

/** Ikon orang berisi (mockup memakai ikon padat di kepala kolom role). */
function IkonOrang({ dua }: { dua?: boolean }): JSX.Element {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      {dua ? (
        <>
          <circle cx="9" cy="8" r="3.4" />
          <path d="M2.5 19.5c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6v.5h-13z" />
          <circle cx="16.8" cy="8.6" r="2.8" opacity="0.75" />
          <path d="M16.5 13.4c3 0 5.3 2.1 5.3 5.4v.7h-4.7c0-2.5-1-4.5-2.8-5.8.7-.2 1.4-.3 2.2-.3z" opacity="0.75" />
        </>
      ) : (
        <>
          <circle cx="12" cy="8" r="3.8" />
          <path d="M4.5 20c0-4 3.4-6.8 7.5-6.8s7.5 2.8 7.5 6.8v.5h-15z" />
        </>
      )}
    </svg>
  )
}

/** Ilustrasi perisai di spanduk "Cara Kerja" — SVG buatan sendiri, tanpa aset luar. */
function IlustrasiPerisai(): JSX.Element {
  return (
    <svg className="akses-ilustrasi" viewBox="0 0 280 110" aria-hidden="true">
      <rect x="20" y="62" width="120" height="40" rx="8" fill="#dff0e5" />
      <rect x="32" y="74" width="60" height="6" rx="3" fill="#b9dcc5" />
      <rect x="32" y="86" width="84" height="6" rx="3" fill="#cfe6d7" />
      <rect x="92" y="14" width="176" height="74" rx="10" fill="#ffffff" stroke="#e1ece5" />
      <rect x="170" y="34" width="80" height="7" rx="3.5" fill="#dcebe1" />
      <rect x="170" y="50" width="56" height="7" rx="3.5" fill="#e6f1ea" />
      <path
        d="M130 22l24 9v17c0 15-10 26-24 31-14-5-24-16-24-31V31z"
        fill="#1f7a45"
      />
      <path d="M130 22l24 9v17c0 15-10 26-24 31z" fill="#17643a" />
      <path d="M120 49l7 7 14-15" fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M58 20l2.2 6 6 2.2-6 2.2-2.2 6-2.2-6-6-2.2 6-2.2z" fill="#b9dcc5" />
      <path d="M44 38l1.3 3.5 3.5 1.3-3.5 1.3-1.3 3.5-1.3-3.5-3.5-1.3 3.5-1.3z" fill="#cfe6d7" />
    </svg>
  )
}

interface Props {
  /** Kembali ke halaman utama Settings. */
  onKembali: () => void
  /** Remah "Beranda". */
  onBeranda: () => void
}

type Keluar = 'back' | 'home'

export default function AksesMenu({ onKembali, onBeranda }: Props): JSX.Element {
  const [konfig, setKonfig] = useState<AccessConfig>({ akses: {}, daftarDivisi: [] })
  const [users, setUsers] = useState<AuthUserRow[]>([])
  const [dimuat, setDimuat] = useState(false)
  const [draf, setDraf] = useState<Draf>({})
  const [menu, setMenu] = useState<MenuId>('sales')
  const [cari, setCari] = useState('')
  const [saringRole, setSaringRole] = useState<RoleId | 'all'>('all')
  const [saringStatus, setSaringStatus] = useState<SaringStatus>('all')
  const [urutan, setUrutan] = useState<Urutan>({ kolom: 'no', naik: true })
  const [halaman, setHalaman] = useState(1)
  const [perHalaman, setPerHalaman] = useState(20)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pesan, setPesan] = useState<string | null>(null)
  const [menuBaris, setMenuBaris] = useState<string | null>(null)
  /**
   * Posisi menu ⋯ di LAYAR (position: fixed). Dirender di dalam bungkus tabel yang
   * `overflow: auto`, menu itu terpotong di baris-baris bawah (tertangkap screenshot).
   */
  const [posisiMenu, setPosisiMenu] = useState<{ top: number; right: number } | null>(null)
  const [lihatUser, setLihatUser] = useState<string | null>(null)
  const [tambahBuka, setTambahBuka] = useState(false)
  const [namaBaru, setNamaBaru] = useState('')
  const [konfirmasiKeluar, setKonfirmasiKeluar] = useState<Keluar | null>(null)
  const [konfirmasiReset, setKonfirmasiReset] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const bersihkanError = (err: unknown): string => {
    const teks = String(err)
    const potong = teks.lastIndexOf('Error: ')
    return potong >= 0 ? teks.slice(potong + 7) : teks
  }

  const muat = useCallback(async () => {
    try {
      const [k, u] = await Promise.all([window.aira.getAccessMatrix(), window.aira.listAuthUsers()])
      setKonfig(k)
      setUsers(u)
      setError(null)
    } catch (err) {
      setError(bersihkanError(err))
    } finally {
      setDimuat(true)
    }
  }, [])

  useEffect(() => {
    void muat()
  }, [muat])

  // Menu ⋯ per baris tertutup saat klik di luar.
  useEffect(() => {
    if (menuBaris === null) return
    const tutup = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuBaris(null)
    }
    // Menu melayang tidak ikut bergulir bersama tabel — tutup saat user menggulir.
    // `wheel`, bukan `scroll`: event scroll juga datang dari pengguliran terprogram
    // (scrollIntoView) dan menutup menu yang baru saja dibuka.
    const tutupGulir = (): void => setMenuBaris(null)
    document.addEventListener('mousedown', tutup)
    window.addEventListener('wheel', tutupGulir, true)
    return () => {
      document.removeEventListener('mousedown', tutup)
      window.removeEventListener('wheel', tutupGulir, true)
    }
  }, [menuBaris])

  const jalankan = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(bersihkanError(err))
    } finally {
      setBusy(false)
    }
  }

  const perubahan = useMemo(() => daftarPerubahan(konfig.akses, draf), [konfig.akses, draf])
  const nilai = (role: RoleId, kode: string): boolean => nilaiTampil(konfig.akses, draf, menu, role, kode)
  const jumlahUser = (role: RoleId, kode: string): number => penghuni(users, role, kode).length

  const roleTampil = saringRole === 'all' ? ROLE_DIATUR : ROLE_DIATUR.filter((r) => r === saringRole)

  const baris = susunBaris(konfig.daftarDivisi, {
    cari,
    status: saringStatus,
    urutan,
    nilai,
    jumlahUser
  })
  const hal = halamanDari(baris, halaman, perHalaman)

  // Sel yang dicakup "Pilih semua": semua divisi AKTIF hasil saringan (lintas halaman)
  // × role yang tampil. Divisi nonaktif tidak ikut dibuka diam-diam.
  const cakupanSemua = baris
    .filter((d) => d.aktif)
    .flatMap((d) => roleTampil.map((r) => ({ role: r, kode: d.kode })))
  const semuaTercentang = cakupanSemua.length > 0 && cakupanSemua.every((c) => nilai(c.role, c.kode))
  const sebagianTercentang = !semuaTercentang && cakupanSemua.some((c) => nilai(c.role, c.kode))

  const setSel = (sel: { role: RoleId; kode: string; diizinkan: boolean }[]): void => {
    setPesan(null)
    setDraf((d) =>
      ubahDraf(
        konfig.akses,
        d,
        sel.map((s) => ({ menu, role: s.role, divisi: s.kode, diizinkan: s.diizinkan }))
      )
    )
  }

  const simpan = (): Promise<void> =>
    jalankan(async () => {
      const jumlah = perubahan.length
      setKonfig(await window.aira.setAkses({ perubahan }))
      setDraf({})
      setUsers(await window.aira.listAuthUsers())
      setPesan(
        `${jumlah} access changes saved. Users who currently have AIRA open will see them within 5 minutes, without signing in again.`
      )
    })

  const tambahDivisi = (): Promise<void> =>
    jalankan(async () => {
      setKonfig(await window.aira.createDivision({ nama: namaBaru }))
      setPesan(`Division "${namaBaru.trim()}" added — still closed to every menu until it is checked.`)
      setNamaBaru('')
      setTambahBuka(false)
    })

  const ubahAktifDivisi = (kode: string, aktif: boolean): Promise<void> =>
    jalankan(async () => {
      setKonfig(await window.aira.setDivisiAktif({ kode, aktif }))
      setMenuBaris(null)
      const nama = konfig.daftarDivisi.find((d) => d.kode === kode)?.nama ?? kode
      setPesan(
        aktif
          ? `Division ${nama} was reactivated.`
          : `Division ${nama} was deactivated: it can no longer be chosen for new users. Existing users and access still apply.`
      )
    })

  const urutkan = (kolom: KolomUrut): void =>
    setUrutan((u) => (u.kolom === kolom ? { kolom, naik: !u.naik } : { kolom, naik: true }))

  const keluar = (arah: Keluar): void => {
    if (perubahan.length > 0) setKonfirmasiKeluar(arah)
    else if (arah === 'back') onKembali()
    else onBeranda()
  }

  const stat = statistik(konfig.daftarDivisi, konfig.akses, users, MENU_VALUES)
  const jumlahDiMenu = (m: MenuId): number =>
    users.filter((u) => ROLE_DIATUR.includes(u.role) && u.menuTerlihat.includes(m)).length
  const perubahanDiMenu = (m: MenuId): number => perubahan.filter((p) => p.menu === m).length

  const divisiLihat = lihatUser ? konfig.daftarDivisi.find((d) => d.kode === lihatUser) : null

  const TombolUrut = ({ kolom }: { kolom: KolomUrut }): JSX.Element => (
    <span className={`akses-urut ${urutan.kolom === kolom ? (urutan.naik ? 'naik' : 'turun') : ''}`}>
      <svg width="9" height="13" viewBox="0 0 9 13" aria-hidden="true">
        <path d="M4.5 1 8 5H1z" className="atas" />
        <path d="M4.5 12 1 8h7z" className="bawah" />
      </svg>
    </span>
  )

  return (
    <div className="akses-halaman">
      <div className="akses-kepala">
        <button className="akses-kembali" onClick={() => keluar('back')} title="Back to Settings">
          <IconBack size={16} />
        </button>
        <div>
          <h1>Settings</h1>
          <nav className="akses-remah" aria-label="Breadcrumb">
            <button onClick={() => keluar('home')}>Home</button>
            <IconChevronRight size={12} />
            <button onClick={() => keluar('back')}>Settings</button>
            <IconChevronRight size={12} />
            <span>Menu Access by Role &amp; Division</span>
          </nav>
        </div>
      </div>

      <div className="akses-statistik">
        <div className="akses-stat">
          <span className="akses-stat-ikon">
            <IconBuilding size={26} />
          </span>
          <div>
            <span className="akses-stat-label">Divisions</span>
            <strong>{stat.divisi}</strong>
            <span className="akses-stat-sub">
              Divisions in the system{stat.divisiNonaktif > 0 ? ` (${stat.divisiNonaktif} inactive)` : ''}
            </span>
          </div>
        </div>
        <div className="akses-stat">
          <span className="akses-stat-ikon">
            <IconFileText size={26} />
          </span>
          <div>
            <span className="akses-stat-label">Active Menus</span>
            <strong>{stat.menuTerbuka}</strong>
            <span className="akses-stat-sub">Menus that can be opened</span>
          </div>
        </div>
        <div className="akses-stat">
          <span className="akses-stat-ikon">
            <IconUsers size={26} />
          </span>
          <div>
            <span className="akses-stat-label">Active Roles</span>
            <strong>{stat.role}</strong>
            <span className="akses-stat-sub">{ROLE_DIATUR.map((r) => ROLE_LABELS[r]).join(', ')}</span>
          </div>
        </div>
        <div className="akses-stat">
          <span className="akses-stat-ikon">
            <IconUser size={26} />
          </span>
          <div>
            <span className="akses-stat-label">Registered Users</span>
            <strong>{stat.userBerdivisi}</strong>
            <span className="akses-stat-sub">Total users in divisions</span>
          </div>
        </div>
      </div>

      <div className="akses-info">
        <span className="akses-info-ikon">
          <IconInfo size={18} />
        </span>
        <div className="akses-info-teks">
          <h2>How Menu Access by Role &amp; Division Works</h2>
          <p>
            One checkmark = one role in one division. Checking SPV in IT does not also open SPV in
            another division, nor Manager in IT. Directors and Super Admins can always open every
            menu. General mode (New Task) is open to everyone.
          </p>
        </div>
        <IlustrasiPerisai />
      </div>

      <div className="akses-tab" role="tablist">
        {MENU_VALUES.map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={menu === m}
            className={menu === m ? 'akses-tab-btn aktif' : 'akses-tab-btn'}
            onClick={() => {
              setMenu(m)
              setMenuBaris(null)
            }}
          >
            {MENU_LABELS[m]}
            <span
              className="akses-tab-jumlah"
              title="Users (other than Directors & Super Admins) who see this menu — as saved"
            >
              {jumlahDiMenu(m)}
            </span>
            {perubahanDiMenu(m) > 0 && (
              <span className="akses-tab-draf" title="Unsaved changes in this menu" />
            )}
          </button>
        ))}
      </div>

      <section className="akses-kartu">
        {(error || pesan) && (
          <div className={error ? 'banner banner-gagal' : 'banner banner-ok'}>
            <span>{error ?? pesan}</span>
            <button
              className="btn-mini"
              title="Close"
              onClick={() => {
                setError(null)
                setPesan(null)
              }}
            >
              <IconClose size={13} />
            </button>
          </div>
        )}

        <div className="akses-alat">
          <label className="akses-cari">
            <IconSearch size={16} />
            <input
              type="text"
              placeholder="Search divisions..."
              value={cari}
              onChange={(e) => {
                setCari(e.target.value)
                setHalaman(1)
              }}
            />
          </label>
          <select
            className="akses-pilih"
            value={saringRole}
            onChange={(e) => setSaringRole(e.target.value as RoleId | 'all')}
          >
            <option value="all">All roles</option>
            {ROLE_DIATUR.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <select
            className="akses-pilih"
            value={saringStatus}
            onChange={(e) => {
              setSaringStatus(e.target.value as SaringStatus)
              setHalaman(1)
            }}
          >
            <option value="all">All statuses</option>
            <option value="active">Active divisions</option>
            <option value="inactive">Inactive divisions</option>
          </select>

          <div className="akses-alat-kanan">
            <label
              className="akses-tombol akses-pilih-semua"
              title="Check/uncheck all ACTIVE divisions shown (per search & filters) for the roles shown"
            >
              <input
                type="checkbox"
                checked={semuaTercentang}
                ref={(el) => {
                  if (el) el.indeterminate = sebagianTercentang
                }}
                disabled={busy || cakupanSemua.length === 0}
                onChange={() =>
                  setSel(cakupanSemua.map((c) => ({ ...c, diizinkan: !semuaTercentang })))
                }
              />
              Select all
            </label>
            <button
              className="akses-tombol"
              disabled={busy || perubahan.length === 0}
              onClick={() => setKonfirmasiReset(true)}
              title="Discard all unsaved changes"
            >
              <IconReset size={15} /> Reset
            </button>
            <button className="akses-tombol akses-tombol-garis" disabled={busy} onClick={() => setTambahBuka(true)}>
              <IconPlus size={15} /> Add Division
            </button>
            <button
              className="akses-tombol akses-tombol-utama"
              disabled={busy || perubahan.length === 0}
              onClick={() => void simpan()}
            >
              <IconSave size={15} /> Save Changes
              {perubahan.length > 0 && <span className="akses-hitung">{perubahan.length}</span>}
            </button>
          </div>
        </div>

        <div className="akses-tabel-bungkus">
          <table className="akses-tabel">
            <thead>
              <tr>
                <th className="kol-no">
                  <button onClick={() => urutkan('no')}>
                    No <TombolUrut kolom="no" />
                  </button>
                </th>
                <th className="kol-divisi">
                  <button onClick={() => urutkan('division')}>
                    Division <TombolUrut kolom="division" />
                  </button>
                </th>
                {roleTampil.map((r) => (
                  <th key={r} className={`kol-peran ${ROLE_KELAS[r] ?? ''}`}>
                    <button onClick={() => urutkan(r)}>
                      <span className="peran-ikon">
                        <IkonOrang dua={r === 'spv'} />
                      </span>
                      {ROLE_LABELS[r]} <TombolUrut kolom={r} />
                    </button>
                  </th>
                ))}
                <th className="kol-aksi" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {hal.isi.map((d) => (
                <tr key={d.kode} className={d.aktif ? '' : 'nonaktif'}>
                  <td className="kol-no">{d.no}</td>
                  <td className="kol-divisi">
                    {d.nama}
                    {!d.aktif && <span className="tag tag-netral">inactive</span>}
                  </td>
                  {roleTampil.map((r) => {
                    const orang = penghuni(users, r, d.kode)
                    const dicentang = nilai(r, d.kode)
                    const berubah = dicentang !== nilaiTersimpan(konfig.akses, menu, r, d.kode)
                    return (
                      <td key={r} className={`kol-peran ${berubah ? 'berubah' : ''}`}>
                        <label className="akses-sel">
                          <input
                            type="checkbox"
                            checked={dicentang}
                            disabled={busy}
                            title={`Allow ${ROLE_LABELS[r]} in division ${d.nama} to open ${MENU_LABELS[menu]}${berubah ? ' (not saved yet)' : ''}`}
                            onChange={(e) => setSel([{ role: r, kode: d.kode, diizinkan: e.target.checked }])}
                          />
                          <span
                            className={orang.length > 0 ? 'akses-orang' : 'akses-orang kosong'}
                            title={orang.length > 0 ? orang.join(', ') : 'No users with this role & division yet'}
                          >
                            {orang.length} users
                          </span>
                        </label>
                      </td>
                    )
                  })}
                  <td className="kol-aksi">
                    <div className="akses-aksi" ref={menuBaris === d.kode ? menuRef : undefined}>
                      <button
                        className="akses-titik"
                        title="More actions"
                        onClick={(e) => {
                          const r = e.currentTarget.getBoundingClientRect()
                          // Tinggi menu ±170 px: terbuka ke atas bila tidak muat di bawah.
                          const top = r.bottom + 176 > window.innerHeight ? r.top - 172 : r.bottom + 4
                          setPosisiMenu({ top, right: window.innerWidth - r.right })
                          setMenuBaris((m) => (m === d.kode ? null : d.kode))
                        }}
                      >
                        <IconMore size={16} />
                      </button>
                      {menuBaris === d.kode && posisiMenu && (
                        <div className="akses-menu" role="menu" style={posisiMenu}>
                          <button
                            role="menuitem"
                            onClick={() => {
                              setSel(roleTampil.map((r) => ({ role: r, kode: d.kode, diizinkan: true })))
                              setMenuBaris(null)
                            }}
                          >
                            Check all roles
                          </button>
                          <button
                            role="menuitem"
                            onClick={() => {
                              setSel(roleTampil.map((r) => ({ role: r, kode: d.kode, diizinkan: false })))
                              setMenuBaris(null)
                            }}
                          >
                            Uncheck all roles
                          </button>
                          <button
                            role="menuitem"
                            onClick={() => {
                              setLihatUser(d.kode)
                              setMenuBaris(null)
                            }}
                          >
                            View users in this division
                          </button>
                          <button
                            role="menuitem"
                            disabled={busy}
                            onClick={() => void ubahAktifDivisi(d.kode, !d.aktif)}
                          >
                            {d.aktif ? 'Deactivate division' : 'Activate division'}
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {dimuat && hal.isi.length === 0 && (
                <tr>
                  <td colSpan={roleTampil.length + 3} className="akses-kosong">
                    {konfig.daftarDivisi.length === 0 ? 'No divisions yet.' : 'No matching divisions.'}
                  </td>
                </tr>
              )}
              {!dimuat && (
                <tr>
                  <td colSpan={roleTampil.length + 3} className="akses-kosong">
                    Loading…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="akses-kaki">
          <span>
            Showing {hal.isi.length} of {baris.length} divisions
            {perubahan.length > 0 && (
              <span className="akses-kaki-draf"> · {perubahan.length} unsaved changes</span>
            )}
          </span>
          <div className="akses-halaman-nav">
            <span>Show</span>
            <select
              className="akses-pilih akses-pilih-kecil"
              value={perHalaman}
              onChange={(e) => {
                setPerHalaman(Number(e.target.value))
                setHalaman(1)
              }}
            >
              {[10, 20, 50].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span>per page</span>
            <button
              className="akses-hal"
              disabled={hal.halaman <= 1}
              onClick={() => setHalaman(hal.halaman - 1)}
              title="Previous page"
            >
              <IconChevronLeft size={14} />
            </button>
            {Array.from({ length: hal.jumlahHalaman }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                className={n === hal.halaman ? 'akses-hal aktif' : 'akses-hal'}
                onClick={() => setHalaman(n)}
              >
                {n}
              </button>
            ))}
            <button
              className="akses-hal"
              disabled={hal.halaman >= hal.jumlahHalaman}
              onClick={() => setHalaman(hal.halaman + 1)}
              title="Next page"
            >
              <IconChevronRight size={14} />
            </button>
          </div>
        </div>
      </section>

      {tambahBuka && (
        <div className="akses-latar" onMouseDown={() => !busy && setTambahBuka(false)}>
          <div className="akses-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <h3>Add Division</h3>
            <label>
              Division name
              <input
                type="text"
                value={namaBaru}
                autoFocus
                maxLength={60}
                placeholder="e.g. Bioinformatics"
                onChange={(e) => setNamaBaru(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && namaBaru.trim()) void tambahDivisi()
                  if (e.key === 'Escape') setTambahBuka(false)
                }}
              />
            </label>
            <p className="hint">
              A new division starts closed: it cannot open any menu until it is checked in the table.
            </p>
            <div className="akses-dialog-aksi">
              <button className="akses-tombol" disabled={busy} onClick={() => setTambahBuka(false)}>
                Cancel
              </button>
              <button
                className="akses-tombol akses-tombol-utama"
                disabled={busy || namaBaru.trim().length === 0}
                onClick={() => void tambahDivisi()}
              >
                Save Division
              </button>
            </div>
          </div>
        </div>
      )}

      {divisiLihat && (
        <div className="akses-latar" onMouseDown={() => setLihatUser(null)}>
          <div className="akses-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <h3>Users in division {divisiLihat.nama}</h3>
            {ROLE_DIATUR.map((r) => {
              const orang = penghuni(users, r, divisiLihat.kode)
              return (
                <div key={r} className="akses-daftar-user">
                  <span className={`akses-lencana ${ROLE_KELAS[r] ?? ''}`}>{ROLE_LABELS[r]}</span>
                  <span>{orang.length > 0 ? orang.join(', ') : '—'}</span>
                </div>
              )
            })}
            <p className="hint">
              Directors &amp; Super Admins have no division — they can always open every menu.
            </p>
            <div className="akses-dialog-aksi">
              <button className="akses-tombol" onClick={() => setLihatUser(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {konfirmasiKeluar && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          body={`There are ${perubahan.length} unsaved checkmarks. If you leave now, those changes are lost.`}
          confirmLabel="Discard & leave"
          onCancel={() => setKonfirmasiKeluar(null)}
          onConfirm={() => {
            const arah = konfirmasiKeluar
            setKonfirmasiKeluar(null)
            setDraf({})
            if (arah === 'back') onKembali()
            else onBeranda()
          }}
        />
      )}

      {konfirmasiReset && (
        <ConfirmDialog
          title="Reset changes?"
          body={`${perubahan.length} unsaved checkmarks will be restored to the saved state.`}
          confirmLabel="Reset"
          onCancel={() => setKonfirmasiReset(false)}
          onConfirm={() => {
            setKonfirmasiReset(false)
            setDraf({})
            setPesan(null)
          }}
        />
      )}
    </div>
  )
}
