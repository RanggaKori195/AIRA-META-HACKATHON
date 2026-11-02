import { useCallback, useEffect, useState, type JSX } from 'react'
import {
  LOCKED_ROLES,
  MENU_VALUES,
  ROLE_VALUES,
  type AccessConfig,
  type AuthLogRow,
  type AuthSession,
  type AuthUserRow,
  type MenuId,
  type RoleId
} from '@shared/ipc'
import { IconClose, IconPlus } from './Icons'
import DivisiPicker, { butuhDivisi, divisiValid } from './DivisiPicker'

// Panel pengelolaan user — hanya tampil untuk Super Admin.
//
// ⚠️ Panel ini adalah KENYAMANAN, bukan penguncian. Semua channel yang dipanggil
// di sini memeriksa ulang role dari sesi di main process (`wajibSuperAdmin` di
// `ipc.ts`). Menyembunyikan panel tidak menghalangi apa pun; yang menghalangi
// adalah pemeriksaan di sisi sana.

const ROLE_LABELS: Record<RoleId, string> = {
  super_admin: 'Super Admin',
  direktur: 'Director',
  manager: 'Manager',
  spv: 'SPV',
  staff: 'Staff'
}

const MENU_LABELS: Record<MenuId, string> = {
  sales: 'Ask Sales Data',
  masterdata: 'Ask Master Data',
  lab: 'Ask Sample TAT',
  onedrive: 'Ask Microsoft 365',
  reagent: 'Reagent Check'
}

/**
 * Role yang aksesnya tidak bisa dicabut — checkbox-nya dikunci dan selalu tercentang.
 * Diambil dari `shared/ipc.ts`, sumber yang sama dengan yang ditegakkan main process
 * (`AKSES_TAK_TERCABUT`), supaya keduanya tidak bisa berbeda diam-diam.
 */
const TERKUNCI = LOCKED_ROLES

const STATUS_LABEL: Record<string, string> = {
  sukses: 'Success',
  password_salah: 'Wrong password',
  user_tidak_ada: 'Username not registered',
  kedaluwarsa: 'Account expired',
  diblokir: 'Account blocked',
  logout: 'Sign-out'
}

/** Kelas warna per hasil login — supaya kegagalan menonjol saat daftar dibaca sekilas. */
const STATUS_KELAS: Record<string, string> = {
  sukses: 'tag tag-ok',
  logout: 'tag tag-netral',
  password_salah: 'tag tag-gagal',
  user_tidak_ada: 'tag tag-gagal',
  kedaluwarsa: 'tag tag-peringatan',
  diblokir: 'tag tag-gagal'
}

const waktuSingkat = (iso: string): string =>
  new Date(iso).toLocaleString('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })

interface Props {
  sesi: AuthSession
  /** Membuka halaman Akses Menu per Role & Divisi (views/AksesMenu.tsx). */
  onBukaAkses: () => void
}

export default function UserAdmin({ sesi, onBukaAkses }: Props): JSX.Element {
  const [users, setUsers] = useState<AuthUserRow[]>([])
  const [konfig, setKonfig] = useState<AccessConfig>({ akses: {}, daftarDivisi: [] })
  const [log, setLog] = useState<AuthLogRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pesan, setPesan] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [banTarget, setBanTarget] = useState<string | null>(null)
  const [banReason, setBanReason] = useState('')
  const [resetTarget, setResetTarget] = useState<string | null>(null)
  const [resetValue, setResetValue] = useState('')

  const [tambahBuka, setTambahBuka] = useState(false)
  const [baru, setBaru] = useState({
    username: '',
    password: '',
    role: 'spv' as RoleId,
    divisi: [] as string[],
    expDate: ''
  })
  /** Username yang divisinya sedang diubah, beserta pilihan sementaranya. */
  const [divisiTarget, setDivisiTarget] = useState<AuthUserRow | null>(null)
  const [divisiPilih, setDivisiPilih] = useState<string[]>([])

  const muat = useCallback(async () => {
    try {
      const [u, m, l] = await Promise.all([
        window.aira.listAuthUsers(),
        window.aira.getAccessMatrix(),
        window.aira.getLoginLog(50)
      ])
      setUsers(u)
      setKonfig(m)
      setLog(l)
      setError(null)
    } catch (err) {
      setError(bersihkanError(err))
    }
  }, [])

  useEffect(() => {
    void muat()
  }, [muat])

  /**
   * Error dari IPC datang terbungkus "Error invoking remote method '…': Error: pesan".
   * Yang berguna bagi user hanya kalimat terakhirnya.
   */
  const bersihkanError = (err: unknown): string => {
    const teks = String(err)
    const potong = teks.lastIndexOf('Error: ')
    return potong >= 0 ? teks.slice(potong + 7) : teks
  }

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

  const tambahUser = (): Promise<void> =>
    jalankan(async () => {
      setUsers(
        await window.aira.createAuthUser({
          username: baru.username,
          password: baru.password,
          role: baru.role,
          divisi: baru.divisi,
          expDate: baru.expDate === '' ? null : baru.expDate
        })
      )
      setPesan(
        `User "${baru.username.trim().toLowerCase()}" created as ${ROLE_LABELS[baru.role]}. ` +
          'Give the password to the person directly — not through AIRA chat.'
      )
      setBaru({ username: '', password: '', role: 'spv', divisi: [], expDate: '' })
      setTambahBuka(false)
      void muat()
    })

  const terapkanBan = (username: string, banned: boolean, reason: string | null): Promise<void> =>
    jalankan(async () => {
      setUsers(await window.aira.setUserBanned({ username, banned, reason }))
      setBanTarget(null)
      setBanReason('')
      setPesan(
        banned
          ? `${username} was blocked. If they have AIRA open, their session is revoked within 5 minutes.`
          : `${username} was unblocked.`
      )
      void muat()
    })

  const terapkanReset = (username: string): Promise<void> =>
    jalankan(async () => {
      await window.aira.resetUserPassword({ username, password: resetValue })
      setResetTarget(null)
      setResetValue('')
      setPesan(`${username}'s password was changed. Give it to the person directly, not through AIRA chat.`)
    })

  const simpanDivisiUser = (username: string): Promise<void> =>
    jalankan(async () => {
      setUsers(await window.aira.setUserDivisions({ username, divisi: divisiPilih }))
      setDivisiTarget(null)
      setPesan(`${username}'s divisions were updated.`)
    })

  const namaDivisi = (kode: string): string =>
    konfig.daftarDivisi.find((d) => d.kode === kode)?.nama ?? kode

  /** Ringkasan per menu untuk kartu masuk — hasil akhir dari main process (`menuUntuk`). */
  const jumlahDiMenu = (m: MenuId): number =>
    users.filter((u) => !TERKUNCI.includes(u.role) && u.menuTerlihat.includes(m)).length

  const ubahExp = (username: string, nilai: string): Promise<void> =>
    jalankan(async () => {
      setUsers(await window.aira.setUserExpDate({ username, expDate: nilai === '' ? null : nilai }))
      setPesan(
        nilai === ''
          ? `${username}'s expiry was set to no limit.`
          : `${username}'s expiry was changed to ${nilai}.`
      )
    })

  const usernameValid = /^[a-z0-9][a-z0-9._-]{2,49}$/.test(baru.username.trim().toLowerCase())
  // Divisi ikut diperiksa di sini supaya tombol tidak aktif untuk kombinasi yang
  // pasti ditolak main process — misalnya Staff tanpa divisi.
  const bisaSimpanBaru =
    usernameValid && baru.password.length >= 5 && divisiValid(baru.role, baru.divisi) && !busy

  return (
    <>
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

      {/* ---------------------------------------------------- akses menu */}
      <section className="card akses-masuk">
        <div className="card-head">
          <div>
            <h3>Menu Access by Role &amp; Division</h3>
            <p className="hint">
              One checkmark = one role in one division. Directors &amp; Super Admins can always open
              every menu.
            </p>
          </div>
          <button className="btn-send btn-kecil" onClick={onBukaAkses}>
            Manage Menu Access
          </button>
        </div>
        <div className="akses-masuk-ringkas">
          {MENU_VALUES.map((m) => (
            <span key={m} className="akses-masuk-item" title="Users (other than Directors & Super Admins) who see this menu">
              {MENU_LABELS[m]} <strong>{jumlahDiMenu(m)}</strong>
            </span>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------------- user */}
      <section className="card">
        <div className="card-head">
          <h3>User</h3>
          <button
            className={tambahBuka ? 'btn-teks' : 'btn-send btn-kecil'}
            disabled={busy}
            onClick={() => setTambahBuka((v) => !v)}
          >
            {tambahBuka ? (
              'Cancel'
            ) : (
              <>
                <IconPlus size={14} /> Add User
              </>
            )}
          </button>
        </div>

        {tambahBuka && (
          <div className="form-panel">
            <div className="form-grid">
              <label>
                Username
                <input
                  value={baru.username}
                  autoFocus
                  spellCheck={false}
                  placeholder="budi.santoso"
                  onChange={(e) => setBaru({ ...baru, username: e.target.value })}
                />
              </label>
              <label>
                Initial password
                <input
                  type="password"
                  value={baru.password}
                  onChange={(e) => setBaru({ ...baru, password: e.target.value })}
                />
              </label>
              <label>
                Role
                <select
                  value={baru.role}
                  onChange={(e) => {
                    const role = e.target.value as RoleId
                    // Ganti role = aturan divisinya ikut berubah. Pilihan lama
                    // dikosongkan supaya Direktur tidak terkirim membawa divisi,
                    // dan Staff tidak terlanjur memegang tiga divisi dari pilihan
                    // saat rolenya masih Manager.
                    setBaru({ ...baru, role, divisi: butuhDivisi(role) ? [] : [] })
                  }}
                >
                  {ROLE_VALUES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </label>
              {/* Keterangan ditaruh DI BAWAH input, bukan menyambung judulnya.
                  Kalau ikut di baris judul, label ini membungkus jadi dua baris
                  sementara tiga field lain satu baris — inputnya lalu turun
                  sendiri dan barisnya terlihat tidak sejajar. */}
              <label>
                Valid until
                <input
                  type="date"
                  value={baru.expDate}
                  onChange={(e) => setBaru({ ...baru, expDate: e.target.value })}
                />
                <span className="hint">Leave empty for no limit</span>
              </label>
            </div>
            <div className="form-divisi">
              <strong>Division</strong>
              <DivisiPicker
                role={baru.role}
                daftar={konfig.daftarDivisi}
                dipilih={baru.divisi}
                disabled={busy}
                onChange={(d) => setBaru({ ...baru, divisi: d })}
              />
            </div>
            <p className="hint">
              Username 3–50 characters: lowercase letters or digits; dots, underscores and hyphens
              allowed. No spaces.
              {baru.username.length > 0 && !usernameValid && (
                <span className="teks-gagal"> This username does not meet the rules above.</span>
              )}
            </p>
            <div className="form-aksi">
              <button className="btn-send" disabled={!bisaSimpanBaru} onClick={() => void tambahUser()}>
                Save User
              </button>
            </div>
          </div>
        )}

        <div className="table-scroll">
          <table className="admin-table tabel-user">
            <thead>
              <tr>
                <th>User</th>
                <th>Division</th>
                <th>Visible menus</th>
                <th>Valid until</th>
                <th>Last sign-in</th>
                <th>Status</th>
                <th className="kolom-aksi">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const diriSendiri = u.username.toLowerCase() === sesi.username.toLowerCase()
                return (
                  <tr key={u.username} className={u.isBanned ? 'row-banned' : undefined}>
                    <td>
                      <div className="sel-user">
                        <strong>{u.username}</strong>
                        <span className="hint">
                          {ROLE_LABELS[u.role]}
                          {diriSendiri && ' · you'}
                        </span>
                      </div>
                    </td>
                    <td>
                      {butuhDivisi(u.role) ? (
                        <div className="divisi-list">
                          {u.divisi.length > 0 ? (
                            u.divisi.map((k) => (
                              <span key={k} className="tag tag-netral">
                                {namaDivisi(k)}
                              </span>
                            ))
                          ) : (
                            <span className="tag tag-peringatan">not set</span>
                          )}
                        </div>
                      ) : (
                        <span className="hint">all divisions</span>
                      )}
                    </td>
                    <td>
                      {/* Hasil akhir aturan role DAN divisi, dihitung main process.
                          Inilah kolom yang menjawab "kenapa dia tidak lihat menunya"
                          tanpa perlu membaca matriks di atas. */}
                      {u.menuTerlihat.length > 0 ? (
                        <div className="divisi-list">
                          {u.menuTerlihat.map((m) => (
                            <span key={m} className="tag tag-ok">
                              {MENU_LABELS[m]}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="tag tag-peringatan" title="No checkmark for this person's role and division in the Menu Access matrix">
                          none
                        </span>
                      )}
                    </td>
                    <td>
                      <input
                        type="date"
                        value={u.expDate ?? ''}
                        disabled={busy}
                        title="Leave empty for no limit"
                        onChange={(e) => void ubahExp(u.username, e.target.value)}
                      />
                      {u.expDate === null && <div className="hint">no limit</div>}
                    </td>
                    <td>
                      {u.lastLoginAt ? (
                        <div className="sel-user">
                          <span>{waktuSingkat(u.lastLoginAt)}</span>
                          <span className="hint">
                            {[u.lastLoginHost, u.lastLoginIp].filter(Boolean).join(' · ') || '—'}
                          </span>
                        </div>
                      ) : (
                        <span className="hint">never</span>
                      )}
                    </td>
                    <td>
                      {u.isBanned ? (
                        <span className="tag tag-gagal" title={u.bannedReason ?? ''}>
                          Blocked
                        </span>
                      ) : (
                        <span className="tag tag-ok">Active</span>
                      )}
                    </td>
                    <td className="kolom-aksi">
                      <div className="aksi-baris">
                        {u.isBanned ? (
                          <button
                            className="btn-teks"
                            disabled={busy}
                            onClick={() => void terapkanBan(u.username, false, null)}
                          >
                            Unblock
                          </button>
                        ) : (
                          <button
                            className="btn-teks"
                            disabled={busy || diriSendiri}
                            title={
                              diriSendiri
                                ? 'You cannot block your own account'
                                : 'Block this user'
                            }
                            onClick={() => {
                              setBanTarget(u.username)
                              setResetTarget(null)
                              setBanReason('')
                            }}
                          >
                            Block
                          </button>
                        )}
                        <button
                          className="btn-teks"
                          disabled={busy}
                          onClick={() => {
                            setResetTarget(u.username)
                            setBanTarget(null)
                            setResetValue('')
                          }}
                        >
                          Change password
                        </button>
                        {butuhDivisi(u.role) && (
                          <button
                            className="btn-teks"
                            disabled={busy}
                            onClick={() => {
                              setDivisiTarget(u)
                              setDivisiPilih(u.divisi)
                              setBanTarget(null)
                              setResetTarget(null)
                            }}
                          >
                            Division
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {banTarget && (
          <div className="form-panel">
            <label>
              Reason for blocking <strong>{banTarget}</strong>
              <span className="hint">— this is the sentence the user sees when trying to sign in</span>
              <input
                value={banReason}
                autoFocus
                maxLength={500}
                placeholder="e.g. no longer in this division"
                onChange={(e) => setBanReason(e.target.value)}
              />
            </label>
            <div className="form-aksi">
              <button
                className="btn-send btn-bahaya"
                disabled={busy}
                onClick={() => void terapkanBan(banTarget, true, banReason.trim() || null)}
              >
                Block {banTarget}
              </button>
              <button className="btn-teks" onClick={() => setBanTarget(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {resetTarget && (
          <div className="form-panel">
            <label>
              New password for <strong>{resetTarget}</strong>
              <input
                type="password"
                value={resetValue}
                autoFocus
                onChange={(e) => setResetValue(e.target.value)}
              />
            </label>
            <div className="form-aksi">
              <button
                className="btn-send"
                disabled={busy || resetValue.length < 5}
                onClick={() => void terapkanReset(resetTarget)}
              >
                Save
              </button>
              <button className="btn-teks" onClick={() => setResetTarget(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {divisiTarget && (
          <div className="form-panel">
            <strong>
              Division for {divisiTarget.username} ({ROLE_LABELS[divisiTarget.role]})
            </strong>
            <DivisiPicker
              role={divisiTarget.role}
              daftar={konfig.daftarDivisi}
              dipilih={divisiPilih}
              disabled={busy}
              onChange={setDivisiPilih}
            />
            <div className="form-aksi">
              <button
                className="btn-send"
                disabled={busy || !divisiValid(divisiTarget.role, divisiPilih)}
                onClick={() => void simpanDivisiUser(divisiTarget.username)}
              >
                Save
              </button>
              <button className="btn-teks" onClick={() => setDivisiTarget(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ------------------------------------------------ riwayat login */}
      <section className="card">
        <div className="card-head">
          <h3>Sign-in History</h3>
          <button className="btn-teks" disabled={busy} onClick={() => void muat()}>
            Reload
          </button>
        </div>
        <p className="hint">
          The last 50 attempts, including failed ones. Several &ldquo;username not
          registered&rdquo; results in a row from one computer mean someone is guessing account names.
        </p>
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Username</th>
                <th>Result</th>
                <th>Computer</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {log.map((r, i) => (
                <tr key={i}>
                  <td className="nowrap">{waktuSingkat(r.ts)}</td>
                  <td>{r.username}</td>
                  <td>
                    <span className={STATUS_KELAS[r.status] ?? 'tag tag-netral'}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </td>
                  <td>
                    {r.hostname ?? '—'}
                    {r.osUser && <span className="hint"> ({r.osUser})</span>}
                  </td>
                  <td className="nowrap">{r.ip ?? '—'}</td>
                </tr>
              ))}
              {log.length === 0 && (
                <tr>
                  <td colSpan={5} className="hint">
                    No records yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
