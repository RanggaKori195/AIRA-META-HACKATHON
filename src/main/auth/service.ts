import { authQuery, loginDbConfigured } from './db'
import { migrateAuthSchema } from './schema'
import { hashPassword, verifyPassword, PASSWORD_MAX, PASSWORD_MIN } from './password'
import {
  normalkanUsername,
  periksaAkun,
  PESAN_KREDENSIAL_SALAH,
  USERNAME_ATURAN,
  type Akun,
  type AlasanTolak
} from './account'
import { identitasMesin } from './identity'
import * as memori from '../memori/service'
import { lupakanSemuaIzin } from '../uji/ruang'
import {
  AKSES_TAK_TERCABUT,
  MENUS,
  isMenu,
  isRole,
  kodeDivisi,
  menuUntuk,
  validasiDivisi,
  type MatriksAksesMenu,
  type Menu,
  type Role
} from './roles'
import type { Divisi, MenuId } from '../../shared/ipc'
import { logger } from '../logger'
import * as localDb from '../db'
import { getSecret, setSecret, deleteSecret } from '../secrets'

// Alur login, log, dan pengaturan akses. Ini lapisan yang menyentuh database;
// semua KEPUTUSAN-nya diambil modul murni (`account.ts`, `roles.ts`) supaya bisa
// diuji tanpa jaringan.

/** Kunci sesi yang diingat di laptop (DPAPI). Hanya username — role & izin selalu dibaca ulang dari database. */
const SESSION_KEY = 'authSession'

/** Seberapa sering sesi yang sedang berjalan dicocokkan ulang ke database. */
const REVALIDASI_MS = 5 * 60_000

export interface SesiUser {
  username: string
  role: Role
  /** Kode divisi milik user. Kosong untuk Direktur & Super Admin. */
  divisi: string[]
  /** Menu yang boleh dibuka — sudah memperhitungkan role, divisi, dan lantai Direktur. */
  menu: Menu[]
  expDate: string | null
}

export interface HasilLogin {
  ok: boolean
  sesi?: SesiUser
  error?: string
}

let sesi: SesiUser | null = null
let timerRevalidasi: NodeJS.Timeout | null = null
let siap = false
let selesaiInit = false

export function sesiSekarang(): SesiUser | null {
  return sesi
}

/**
 * Apakah skema login berhasil disiapkan. `false` berarti database tidak terjangkau,
 * dan layar login akan menolak semua percobaan — user perlu tahu itu sebelum
 * mengetik password berkali-kali.
 */
export function authSiap(): boolean {
  return siap
}

/**
 * Apakah `initAuth` sudah selesai — terlepas dari berhasil atau tidak.
 *
 * Dibutuhkan karena `siap === false` sendirian bermakna ganda: bisa "gagal
 * terhubung", bisa juga "masih berjalan". Renderer memakai ini untuk membedakan
 * layar tunggu dari layar login yang menampilkan pesan kegagalan — tanpa itu,
 * jendela yang terbuka lebih cepat dari migrasi akan langsung memberi tahu user
 * bahwa database tidak terjangkau, padahal migrasinya baru berjalan 200 ms.
 */
export function authSelesaiInit(): boolean {
  return selesaiInit
}

/** Dipakai guard IPC. Sengaja menjawab dari `sesi` yang sudah tervalidasi, bukan dari renderer. */
export function bolehModeSekarang(
  mode: 'general' | MenuId
): boolean {
  if (mode === 'general') return true
  if (!sesi) return false
  return sesi.menu.includes(mode)
}

// ---------------------------------------------------------------- matriks akses

export interface KonfigAkses {
  akses: MatriksAksesMenu
  daftarDivisi: Divisi[]
}

/**
 * Konfigurasi terakhir yang BERHASIL dibaca. Cadangan saat database sedang
 * lambat/putus — lihat `konfigUntukSesi`.
 */
let konfigTerakhir: KonfigAkses | null = null

/**
 * Membaca matriks akses + daftar divisi dari database. MELEMPAR bila gagal.
 *
 * Dipakai panel Super Admin apa adanya: di sana galat harus terlihat, bukan
 * diganti matriks cadangan yang bisa saja sudah basi.
 */
export async function bacaKonfigAkses(): Promise<KonfigAkses> {
  const [barisAkses, barisDaftar] = await Promise.all([
    authQuery<{ menu: string; role: string; divisi_kode: string; diizinkan: boolean }>(
      'SELECT menu, role, divisi_kode, diizinkan FROM tb_menu_role_divisi_aira'
    ),
    authQuery<{ kode: string; nama: string; aktif: boolean }>(
      'SELECT kode, nama, aktif FROM tb_divisi_aira ORDER BY urutan, lower(nama)'
    )
  ])

  const akses: MatriksAksesMenu = {}
  for (const row of barisAkses) {
    // Baris ber-menu/role asing diabaikan — tidak ada yang bisa membuka menu lewat SQL.
    if (!isMenu(row.menu) || !isRole(row.role) || AKSES_TAK_TERCABUT.includes(row.role)) continue
    const perRole = (akses[row.menu] ??= {})
    const sel = (perRole[row.role] ??= {})
    sel[row.divisi_kode] = row.diizinkan === true
  }

  const hasil: KonfigAkses = {
    akses,
    daftarDivisi: barisDaftar.map((d) => ({ kode: d.kode, nama: d.nama, aktif: d.aktif === true }))
  }
  konfigTerakhir = hasil
  return hasil
}

/**
 * Konfigurasi untuk menghitung menu SESI (login, pemulihan, revalidasi).
 *
 * ⚠️ Gagal baca ≠ semua tertutup. Versi sebelumnya jatuh ke "semua tertutup" tiap
 * kali query ini kena `statement timeout`/koneksi putus — terjadi 5 kali di log
 * laptop pengembang (25 Agu, 22 Sep). Akibatnya menu Manager/SPV HILANG diam-diam
 * sampai pemeriksaan berikutnya, dan pertanyaan ditolak "tidak berizin" padahal
 * izinnya ada. Sekarang: matriks terakhir yang berhasil dibaca. Tertutup hanya
 * bila belum pernah berhasil sekali pun — kegagalan jaringan tetap tidak pernah
 * MEMBUKA menu.
 */
async function konfigUntukSesi(): Promise<KonfigAkses> {
  try {
    return await bacaKonfigAkses()
  } catch (err) {
    logger().warn(
      { err: String(err), cadangan: konfigTerakhir ? 'terakhir-berhasil' : 'tertutup' },
      'gagal membaca konfigurasi akses'
    )
    return konfigTerakhir ?? { akses: {}, daftarDivisi: [] }
  }
}

/** Dipasang `index.ts`: mengabari renderer bahwa isi sesi (menu/divisi/role) berubah. */
let onSesiBerubah: ((s: SesiUser) => void) | null = null
export function setOnSesiBerubah(fn: (s: SesiUser) => void): void {
  onSesiBerubah = fn
}

function samaSesi(a: SesiUser, b: SesiUser): boolean {
  return (
    a.role === b.role &&
    a.expDate === b.expDate &&
    a.menu.join('|') === b.menu.join('|') &&
    a.divisi.join('|') === b.divisi.join('|')
  )
}

/**
 * Mengganti sesi yang SEDANG BERJALAN dan mengabari renderer bila isinya berubah.
 *
 * ⚠️ Semua jalur yang mengubah `sesi` sesudah login wajib lewat sini. Sebelumnya
 * renderer memegang daftar menu dari saat login selamanya — pemeriksaan ulang
 * tiap 5 menit hanya memperbarui main process, sehingga menu yang baru dibuka
 * tidak pernah muncul dan menu yang dicabut tetap tampil lalu ditolak.
 */
function gantiSesi(baru: SesiUser): void {
  const lama = sesi
  sesi = baru
  if (lama && !samaSesi(lama, baru)) onSesiBerubah?.(baru)
}

/** Menghitung ulang menu sesi yang sedang berjalan sesudah aturannya berubah. */
async function segarkanMenuSesi(): Promise<void> {
  if (!sesi) return
  const konfig = await konfigUntukSesi()
  gantiSesi({ ...sesi, menu: menuUntuk({ role: sesi.role, divisi: sesi.divisi }, konfig.akses) })
}

/**
 * Menyimpan seluruh perubahan draf dari layar Akses Menu SEKALIGUS.
 *
 * SATU statement (`unnest` empat larik) — semua sel masuk atau tidak sama sekali.
 * Menyimpan per sel lewat banyak panggilan bisa berhenti di tengah dan meninggalkan
 * matriks separuh jadi yang tidak pernah dilihat siapa pun di layar; pool login juga
 * `max: 1` dan dipakai bersama detak kehadiran chat.
 * Divisi yang tidak dikenal ditolak dengan nama, bukan dengan pesan foreign key.
 */
export async function simpanAkses(
  perubahan: { menu: Menu; role: Role; divisi: string; diizinkan: boolean }[],
  olehUsername: string
): Promise<KonfigAkses> {
  if (perubahan.length === 0) throw new Error('Tidak ada perubahan untuk disimpan.')
  if (perubahan.some((p) => AKSES_TAK_TERCABUT.includes(p.role))) {
    throw new Error('Akses Direktur & Super Admin selalu terbuka dan tidak diatur lewat matriks.')
  }

  // Sel yang sama dikirim dua kali: yang TERAKHIR menang (urutan klik user).
  // Tanpa ini `ON CONFLICT DO UPDATE` menolak seluruh statement ("cannot affect
  // row a second time").
  const unik = new Map<string, (typeof perubahan)[number]>()
  for (const p of perubahan) unik.set(`${p.menu}|${p.role}|${p.divisi}`, p)
  const daftar = [...unik.values()]

  const kode = [...new Set(daftar.map((p) => p.divisi))]
  const ada = await authQuery<{ kode: string }>(
    'SELECT kode FROM tb_divisi_aira WHERE kode = ANY($1::text[])',
    [kode]
  )
  const dikenal = new Set(ada.map((d) => d.kode))
  const asing = kode.filter((d) => !dikenal.has(d))
  if (asing.length > 0) throw new Error(`Divisi tidak dikenal: ${asing.join(', ')}`)

  await authQuery(
    `INSERT INTO tb_menu_role_divisi_aira (menu, role, divisi_kode, diizinkan, updated_at, updated_by)
     SELECT m, r, d, z, now(), $5
       FROM unnest($1::text[], $2::text[], $3::text[], $4::boolean[]) AS t(m, r, d, z)
     ON CONFLICT (menu, role, divisi_kode)
       DO UPDATE SET diizinkan = EXCLUDED.diizinkan,
                     updated_at = now(),
                     updated_by = EXCLUDED.updated_by`,
    [
      daftar.map((p) => p.menu),
      daftar.map((p) => p.role),
      daftar.map((p) => p.divisi),
      daftar.map((p) => p.diizinkan),
      olehUsername
    ]
  )
  localDb.audit(
    'auth',
    'menu_akses',
    `${daftar.map((p) => `${p.menu}/${p.role}/${p.divisi}=${p.diizinkan}`).join(' ')} oleh=${olehUsername}`
  )
  logger().info({ jumlah: daftar.length, oleh: olehUsername }, 'matriks akses disimpan')
  await segarkanMenuSesi()
  return bacaKonfigAkses()
}

// ---------------------------------------------------------------------- divisi

export async function buatDivisi(nama: string, olehUsername: string): Promise<KonfigAkses> {
  const bersih = nama.trim()
  const kode = kodeDivisi(bersih)
  if (!kode) throw new Error('Nama divisi tidak sah.')

  try {
    await authQuery(
      `INSERT INTO tb_divisi_aira (kode, nama, urutan)
       VALUES ($1, $2, (SELECT coalesce(max(urutan), 0) + 1 FROM tb_divisi_aira))`,
      [kode, bersih]
    )
  } catch (err) {
    if ((err as { code?: string })?.code === '23505') {
      throw new Error(`Divisi "${bersih}" sudah terdaftar.`)
    }
    throw err
  }
  localDb.audit('auth', 'buat_divisi', `divisi=${kode} oleh=${olehUsername}`)
  logger().info({ kode, nama: bersih, oleh: olehUsername }, 'divisi baru dibuat')
  return bacaKonfigAkses()
}

/**
 * Menonaktifkan/mengaktifkan divisi. Sengaja TIDAK menghapus barisnya: user dan
 * menu bisa sudah menunjuk ke divisi ini, dan `ON DELETE CASCADE` akan mencabut
 * akses mereka diam-diam. Divisi nonaktif tidak lagi bisa dipilih untuk user baru,
 * tapi yang sudah terlanjur menempel tetap terbaca.
 */
export async function setDivisiAktif(
  kode: string,
  aktif: boolean,
  olehUsername: string
): Promise<KonfigAkses> {
  await authQuery('UPDATE tb_divisi_aira SET aktif = $2 WHERE kode = $1', [kode, aktif])
  localDb.audit('auth', 'divisi_aktif', `divisi=${kode} aktif=${aktif} oleh=${olehUsername}`)
  await segarkanMenuSesi()
  return bacaKonfigAkses()
}

/** Divisi milik satu user. */
async function divisiUser(username: string): Promise<string[]> {
  const rows = await authQuery<{ divisi_kode: string }>(
    'SELECT divisi_kode FROM tb_user_divisi_aira WHERE lower(username) = lower($1) ORDER BY divisi_kode',
    [username]
  )
  return rows.map((r) => r.divisi_kode)
}

/**
 * Mengganti seluruh divisi seorang user.
 *
 * Hapus-lalu-masukkan, bukan menghitung selisihnya: jumlah divisi per user paling
 * banyak beberapa baris, dan cara ini tidak bisa meninggalkan sisa dari keadaan
 * sebelumnya. Aturan jumlah per role diperiksa `validasiDivisi` lebih dulu.
 */
export async function setDivisiUser(
  username: string,
  divisi: string[],
  olehUsername: string
): Promise<BarisUser[]> {
  const rows = await authQuery<{ role: string }>(
    'SELECT role FROM tb_login_aira WHERE lower(username) = lower($1) LIMIT 1',
    [username]
  )
  const role = rows[0]?.role
  if (!isRole(role)) throw new Error(`User "${username}" tidak ditemukan.`)

  const unik = [...new Set(divisi.map((d) => d.trim()).filter((d) => d.length > 0))]
  const salah = validasiDivisi(role, unik)
  if (salah) throw new Error(salah)

  // Divisi diperiksa SEBELUM baris lama dihapus. Dulu tidak diperiksa sama sekali:
  // satu kode yang ditolak foreign key di tengah loop meninggalkan user TANPA
  // divisi — dan tanpa menu apa pun. Divisi yang sudah menempel boleh tetap
  // walau kini nonaktif; yang BARU ditambahkan wajib aktif (sama dengan buatUser).
  if (unik.length > 0) {
    const [ada, milik] = await Promise.all([
      authQuery<{ kode: string; aktif: boolean }>(
        'SELECT kode, aktif FROM tb_divisi_aira WHERE kode = ANY($1::text[])',
        [unik]
      ),
      divisiUser(username)
    ])
    const status = new Map(ada.map((d) => [d.kode, d.aktif === true]))
    const tidakSah = unik.filter((d) => !status.has(d) || (!status.get(d) && !milik.includes(d)))
    if (tidakSah.length > 0) {
      throw new Error(`Divisi tidak dikenal atau nonaktif: ${tidakSah.join(', ')}`)
    }
  }

  await authQuery('DELETE FROM tb_user_divisi_aira WHERE lower(username) = lower($1)', [username])
  if (unik.length > 0) {
    await authQuery(
      `INSERT INTO tb_user_divisi_aira (username, divisi_kode)
       SELECT $1, kode FROM unnest($2::text[]) AS kode
       ON CONFLICT DO NOTHING`,
      [username.toLowerCase(), unik]
    )
  }
  localDb.audit('auth', 'divisi_user', `user=${username} divisi=${unik.join('|')} oleh=${olehUsername}`)

  // Kalau yang diubah adalah user yang sedang login, sesinya ikut disegarkan —
  // divisi menentukan menu, jadi membiarkannya basi berarti menu yang salah.
  if (sesi && sesi.username.toLowerCase() === username.toLowerCase()) {
    const konfig = await konfigUntukSesi()
    gantiSesi({
      ...sesi,
      divisi: [...unik].sort(),
      menu: menuUntuk({ role: sesi.role, divisi: unik }, konfig.akses)
    })
  }
  return daftarUser()
}

// ---------------------------------------------------------------------- login

function baris(row: {
  username: string
  role: string
  exp_date: Date | string | null
  is_banned: boolean
  banned_reason: string | null
}): Akun | null {
  if (!isRole(row.role)) return null
  const exp = row.exp_date === null ? null : new Date(row.exp_date)
  return {
    username: row.username,
    role: row.role,
    expDate: exp !== null && !Number.isNaN(exp.getTime()) ? exp : null,
    isBanned: row.is_banned === true,
    bannedReason: row.banned_reason
  }
}

async function catatLog(
  username: string,
  role: Role | null,
  status: AlasanTolak | 'sukses' | 'logout'
): Promise<void> {
  const id = identitasMesin()
  try {
    await authQuery(
      `INSERT INTO tb_login_aira_log (username, role, status, ip, hostname, os_user, app_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [username, role, status, id.ip, id.hostname, id.osUser, process.env.npm_package_version ?? null]
    )
  } catch (err) {
    // Log gagal tidak boleh menggagalkan login itu sendiri — tapi harus terlihat.
    logger().warn({ err: String(err), username, status }, 'gagal menulis log login')
  }
}

export async function login(usernameRaw: string, password: string): Promise<HasilLogin> {
  const t0 = Date.now()
  const username = usernameRaw.trim()
  if (username.length === 0 || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return { ok: false, error: PESAN_KREDENSIAL_SALAH }
  }
  if (!loginDbConfigured()) {
    return { ok: false, error: 'Database login belum dikonfigurasi pada aplikasi ini.' }
  }

  let rows: any[]
  try {
    rows = await authQuery(
      `SELECT username, password, role, exp_date, is_banned, banned_reason
         FROM tb_login_aira
        WHERE lower(username) = lower($1)
        LIMIT 1`,
      [username]
    )
  } catch (err) {
    logger().error({ err: String(err) }, 'login gagal: database tidak terjangkau')
    return {
      ok: false,
      error:
        'Tidak bisa menghubungi database login. Periksa koneksi jaringan kamu.'
    }
  }

  const row = rows[0]
  if (!row) {
    await catatLog(username, null, 'user_tidak_ada')
    return { ok: false, error: PESAN_KREDENSIAL_SALAH }
  }

  const akun = baris(row)
  if (!akun) {
    logger().warn({ username, role: row.role }, 'baris login memuat role tak dikenal')
    await catatLog(username, null, 'user_tidak_ada')
    return { ok: false, error: PESAN_KREDENSIAL_SALAH }
  }

  // Password diperiksa LEBIH DULU daripada blokir/kedaluwarsa. Kalau urutannya
  // dibalik, layar login berubah jadi alat untuk memastikan akun mana yang
  // diblokir — cukup dengan menebak username, tanpa perlu tahu passwordnya.
  if (!(await verifyPassword(password, row.password))) {
    await catatLog(akun.username, akun.role, 'password_salah')
    return { ok: false, error: PESAN_KREDENSIAL_SALAH }
  }

  const periksa = periksaAkun(akun, new Date())
  if (!periksa.ok) {
    await catatLog(akun.username, akun.role, periksa.alasan!)
    return { ok: false, error: periksa.pesan }
  }

  const id = identitasMesin()
  // Ketiganya tidak saling bergantung, jadi dijalankan bersamaan alih-alih
  // berurutan — user menunggu satu round-trip, bukan tiga. (Pool `max: 2`, jadi
  // ketiganya tidak benar-benar serentak, tapi tetap jauh lebih cepat.)
  const [, , konfig, divisi] = await Promise.all([
    authQuery(
      `UPDATE tb_login_aira
          SET last_login_at = now(), last_login_ip = $2, last_login_host = $3, updated_at = now()
        WHERE lower(username) = lower($1)`,
      [akun.username, id.ip, id.hostname]
    ),
    catatLog(akun.username, akun.role, 'sukses'),
    konfigUntukSesi(),
    divisiUser(akun.username)
  ])

  sesi = {
    username: akun.username,
    role: akun.role,
    divisi,
    menu: menuUntuk({ role: akun.role, divisi }, konfig.akses),
    expDate: akun.expDate ? akun.expDate.toISOString().slice(0, 10) : null
  }
  ingatSesi(akun.username)
  mulaiRevalidasi()
  // Memori dimuat sekali di sini, bukan per giliran chat. Sengaja TIDAK
  // di-await: kegagalan memuat memori tidak boleh menunda — apalagi
  // menggagalkan — login. Bila gagal, AIRA jalan tanpa memori (lihat
  // `muatMemori`), dan itu tetap aplikasi yang berfungsi.
  void memori.muatMemori(akun.username)
  localDb.audit('auth', 'login', `user=${akun.username} role=${akun.role} host=${id.hostname}`)
  // `ms` diikutkan supaya keluhan "login lama" bisa dijawab dengan angka dari log,
  // bukan dengan tebakan. Ini seluruh waktu di main process: query, scrypt, dan
  // penyimpanan sesi — belum termasuk waktu render di layar.
  logger().info({ username: akun.username, role: akun.role, ms: Date.now() - t0 }, 'login sukses')
  return { ok: true, sesi }
}

export async function logout(): Promise<void> {
  const sebelumnya = sesi
  sesi = null
  hentikanRevalidasi()
  // ⚠️ Cache memori WAJIB dibuang saat logout. Kalau tidak, orang berikutnya yang
  // login di laptop yang sama membawa memori orang sebelumnya ke dalam system
  // prompt-nya — dan sifatnya diam: tidak ada yang tampil di layar, hanya
  // jawaban AIRA yang tiba-tiba menyesuaikan diri dengan orang lain.
  memori.lupakanCache()
  // Izin "boleh menarik paket dari internet" juga milik ORANG, bukan laptop —
  // alasan yang sama persis dengan cache memori di atas. Tanpa ini, orang
  // berikutnya di laptop yang sama mewarisi persetujuan yang tidak pernah ia
  // berikan, dan diam-diam pula.
  lupakanSemuaIzin()
  deleteSecret(SESSION_KEY)
  if (sebelumnya) {
    localDb.audit('auth', 'logout', `user=${sebelumnya.username}`)
    await catatLog(sebelumnya.username, sebelumnya.role, 'logout')
  }
}

// ------------------------------------------------------- sesi yang diingat

function ingatSesi(username: string): void {
  try {
    // Hanya username. Role dan izin SENGAJA tidak ikut disimpan — kalau ikut,
    // menurunkan role atau memblokir seseorang tidak akan berpengaruh selama
    // laptopnya belum pernah logout.
    setSecret(SESSION_KEY, JSON.stringify({ username, at: Date.now() }))
  } catch (err) {
    logger().warn({ err: String(err) }, 'sesi tidak bisa diingat (DPAPI tidak tersedia)')
  }
}

/**
 * Memulihkan sesi yang diingat, dengan MEMERIKSA ULANG ke database.
 *
 * Ini titik penting dari pilihan "ingat sampai logout manual": tanpa pemeriksaan
 * ulang, user yang diblokir Super Admin tetap bisa memakai aplikasi selamanya
 * karena ia memang tidak pernah menekan Logout.
 */
export async function pulihkanSesi(): Promise<SesiUser | null> {
  const disimpan = getSecret(SESSION_KEY)
  if (!disimpan) return null
  let username: string
  try {
    username = String(JSON.parse(disimpan).username ?? '')
  } catch {
    deleteSecret(SESSION_KEY)
    return null
  }
  if (!username) return null

  const hidup = await validasiUlang(username)
  if (!hidup) {
    deleteSecret(SESSION_KEY)
    return null
  }
  sesi = hidup
  mulaiRevalidasi()
  void memori.muatMemori(hidup.username)
  logger().info({ username, role: hidup.role }, 'sesi dipulihkan')
  return hidup
}

/** Membaca ulang keadaan akun dari database. `null` = tidak boleh lanjut. */
async function validasiUlang(username: string): Promise<SesiUser | null> {
  let rows: any[]
  try {
    rows = await authQuery(
      `SELECT username, role, exp_date, is_banned, banned_reason
         FROM tb_login_aira
        WHERE lower(username) = lower($1)
        LIMIT 1`,
      [username]
    )
  } catch (err) {
    // Database tidak terjangkau. Sesi yang SUDAH berjalan sengaja dibiarkan hidup
    // — memutuskan user di tengah kerja hanya karena jaringan sedang putus lebih
    // merugikan daripada risikonya, dan pemeriksaan berikutnya menyusul 5 menit lagi.
    // Untuk sesi yang baru dipulihkan saat start, `sesi` masih null → tetap ditolak.
    logger().warn({ err: String(err) }, 'revalidasi sesi gagal, database tidak terjangkau')
    return sesi
  }
  const row = rows[0]
  if (!row) return null
  const akun = baris(row)
  if (!akun) return null
  if (!periksaAkun(akun, new Date()).ok) return null
  const konfig = await konfigUntukSesi()
  let divisi: string[]
  try {
    divisi = await divisiUser(akun.username)
  } catch (err) {
    // Sama dengan kegagalan query pertama di atas: sesi yang SUDAH berjalan
    // dibiarkan dengan divisi terakhirnya. Dulu galat ini lolos dari setInterval
    // sebagai `unhandledRejection` (log 25 Agu 2026). Untuk pemulihan saat start
    // tidak ada divisi lama yang bisa dipakai, jadi galatnya diteruskan.
    if (!sesi || sesi.username.toLowerCase() !== akun.username.toLowerCase()) throw err
    logger().warn({ err: String(err) }, 'revalidasi: divisi gagal dibaca, memakai divisi terakhir')
    divisi = sesi.divisi
  }
  return {
    username: akun.username,
    role: akun.role,
    divisi,
    menu: menuUntuk({ role: akun.role, divisi }, konfig.akses),
    expDate: akun.expDate ? akun.expDate.toISOString().slice(0, 10) : null
  }
}

function mulaiRevalidasi(): void {
  hentikanRevalidasi()
  timerRevalidasi = setInterval(() => {
    void (async () => {
      if (!sesi) return
      const username = sesi.username
      let hidup: SesiUser | null
      try {
        hidup = await validasiUlang(username)
      } catch (err) {
        logger().warn({ err: String(err) }, 'revalidasi sesi gagal, dicoba lagi putaran berikutnya')
        return
      }
      // Logout / ganti user selama menunggu database: hasil ini milik sesi yang sudah tidak ada.
      if (!sesi || sesi.username !== username) return
      if (!hidup) {
        logger().warn({ username: sesi?.username }, 'sesi dicabut saat revalidasi')
        sesi = null
        memori.lupakanCache()
        deleteSecret(SESSION_KEY)
        hentikanRevalidasi()
        onSesiDicabut?.()
        return
      }
      gantiSesi(hidup)
    })()
  }, REVALIDASI_MS)
  // Timer ini tidak boleh menahan proses tetap hidup saat aplikasi ditutup.
  timerRevalidasi.unref?.()
}

function hentikanRevalidasi(): void {
  if (timerRevalidasi) clearInterval(timerRevalidasi)
  timerRevalidasi = null
}

/** Dipasang oleh `ipc.ts` untuk memberi tahu renderer bahwa user harus kembali ke layar login. */
let onSesiDicabut: (() => void) | null = null
export function setOnSesiDicabut(fn: () => void): void {
  onSesiDicabut = fn
}

// ------------------------------------------------------------ kelola user

export interface BarisUser {
  username: string
  role: Role
  divisi: string[]
  /**
   * Menu yang BENAR-BENAR terlihat oleh user ini sekarang.
   *
   * Dihitung di sini dengan `menuUntuk` — fungsi yang sama yang dipakai saat login —
   * bukan disusun ulang di renderer. Aturannya "role DAN divisi", dan seorang Super
   * Admin tidak seharusnya perlu menggabungkan dua tabel di kepalanya untuk tahu
   * hasilnya. Terbukti perlu: 19 Agu 2026 matriks divisi diatur rapi sementara
   * matriks role tidak tersentuh, dan user yang bersangkutan tidak melihat menu apa
   * pun tanpa ada satu pun petunjuk di layar tentang sebabnya.
   */
  menuTerlihat: Menu[]
  expDate: string | null
  isBanned: boolean
  bannedReason: string | null
  lastLoginAt: string | null
  lastLoginIp: string | null
  lastLoginHost: string | null
}

export async function daftarUser(): Promise<BarisUser[]> {
  // Divisi diambil lewat agregat di sisi database, bukan satu query per user —
  // dengan puluhan user, pola "query di dalam loop" berarti puluhan round-trip
  // setiap kali panel Settings dibuka.
  const rows = await authQuery<any>(
    `SELECT u.username, u.role, u.exp_date, u.is_banned, u.banned_reason,
            u.last_login_at, u.last_login_ip, u.last_login_host,
            coalesce(d.divisi, ARRAY[]::text[]) AS divisi
       FROM tb_login_aira u
       LEFT JOIN (
         SELECT lower(username) AS u, array_agg(divisi_kode ORDER BY divisi_kode) AS divisi
           FROM tb_user_divisi_aira
          GROUP BY lower(username)
       ) d ON d.u = lower(u.username)
      ORDER BY u.role, lower(u.username)`
  )
  const konfig = await bacaKonfigAkses()
  return rows
    .filter((r) => isRole(r.role))
    .map((r) => {
      const divisi: string[] = Array.isArray(r.divisi) ? r.divisi : []
      return {
      username: r.username,
      role: r.role as Role,
      divisi,
      menuTerlihat: menuUntuk({ role: r.role as Role, divisi }, konfig.akses),
      expDate: r.exp_date ? new Date(r.exp_date).toISOString().slice(0, 10) : null,
      isBanned: r.is_banned === true,
      bannedReason: r.banned_reason,
        lastLoginAt: r.last_login_at ? new Date(r.last_login_at).toISOString() : null,
        lastLoginIp: r.last_login_ip,
        lastLoginHost: r.last_login_host
      }
    })
}

export async function buatUser(
  usernameRaw: string,
  password: string,
  role: Role,
  divisi: string[],
  expDate: string | null,
  olehUsername: string
): Promise<BarisUser[]> {
  const username = normalkanUsername(usernameRaw)
  if (username === null) throw new Error(USERNAME_ATURAN)
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new Error(`Password minimal ${PASSWORD_MIN} karakter.`)
  }

  // Divisi diperiksa SEBELUM baris user dibuat. Kalau dibalik, kegagalan aturan
  // divisi meninggalkan user tanpa divisi yang tidak bisa melihat menu apa pun —
  // dan Super Admin tidak punya petunjuk kenapa.
  const unik = [...new Set(divisi.map((d) => d.trim()).filter((d) => d.length > 0))]
  const salah = validasiDivisi(role, unik)
  if (salah) throw new Error(salah)

  if (unik.length > 0) {
    const ada = await authQuery<{ kode: string }>(
      'SELECT kode FROM tb_divisi_aira WHERE kode = ANY($1::text[]) AND aktif',
      [unik]
    )
    const dikenal = new Set(ada.map((d) => d.kode))
    const asing = unik.filter((d) => !dikenal.has(d))
    if (asing.length > 0) throw new Error(`Divisi tidak dikenal atau nonaktif: ${asing.join(', ')}`)
  }

  const hash = await hashPassword(password)
  try {
    await authQuery(
      `INSERT INTO tb_login_aira (username, password, role, exp_date)
       VALUES ($1, $2, $3, $4::date)`,
      [username, hash, role, expDate]
    )
  } catch (err) {
    // 23505 = unique_violation. Dijawab dengan kalimat yang bisa ditindaklanjuti;
    // pesan mentah Postgres menyebut nama index, yang tidak berarti apa-apa bagi user.
    if ((err as { code?: string })?.code === '23505') {
      throw new Error(`Username "${username}" sudah terdaftar.`)
    }
    throw err
  }

  for (const kode of unik) {
    await authQuery(
      'INSERT INTO tb_user_divisi_aira (username, divisi_kode) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [username, kode]
    )
  }

  // Password polos TIDAK ikut ke audit maupun log.
  localDb.audit(
    'auth',
    'buat_user',
    `user=${username} role=${role} divisi=${unik.join('|') || '-'} oleh=${olehUsername}`
  )
  logger().info({ username, role, divisi: unik, oleh: olehUsername }, 'user baru dibuat')
  return daftarUser()
}

export async function setBanned(
  username: string,
  banned: boolean,
  alasan: string | null,
  olehUsername: string
): Promise<BarisUser[]> {
  // Super Admin tidak boleh memblokir dirinya sendiri — itu mengunci satu-satunya
  // akun yang bisa membatalkan blokir, dan tidak ada jalan pulih dari dalam aplikasi.
  if (banned && username.toLowerCase() === olehUsername.toLowerCase()) {
    throw new Error('Tidak bisa memblokir akun sendiri')
  }
  await authQuery(
    `UPDATE tb_login_aira
        SET is_banned = $2,
            banned_reason = CASE WHEN $2 THEN $3 ELSE NULL END,
            banned_at = CASE WHEN $2 THEN now() ELSE NULL END,
            banned_by = CASE WHEN $2 THEN $4 ELSE NULL END,
            updated_at = now()
      WHERE lower(username) = lower($1)`,
    [username, banned, alasan, olehUsername]
  )
  localDb.audit('auth', banned ? 'ban' : 'unban', `user=${username} oleh=${olehUsername}`)
  logger().info({ username, banned, oleh: olehUsername }, 'status blokir user diubah')
  return daftarUser()
}

export async function setExpDate(
  username: string,
  expDate: string | null,
  olehUsername: string
): Promise<BarisUser[]> {
  await authQuery(
    `UPDATE tb_login_aira SET exp_date = $2::date, updated_at = now()
      WHERE lower(username) = lower($1)`,
    [username, expDate]
  )
  localDb.audit('auth', 'exp_date', `user=${username} exp=${expDate ?? 'tanpa batas'} oleh=${olehUsername}`)
  return daftarUser()
}

export async function resetPassword(
  username: string,
  passwordBaru: string,
  olehUsername: string
): Promise<void> {
  if (passwordBaru.length < PASSWORD_MIN || passwordBaru.length > PASSWORD_MAX) {
    throw new Error(`Password minimal ${PASSWORD_MIN} karakter`)
  }
  const hash = await hashPassword(passwordBaru)
  await authQuery(
    'UPDATE tb_login_aira SET password = $2, updated_at = now() WHERE lower(username) = lower($1)',
    [username, hash]
  )
  // Password polos TIDAK ikut ke audit maupun log.
  localDb.audit('auth', 'reset_password', `user=${username} oleh=${olehUsername}`)
}

export interface BarisLog {
  username: string
  role: string | null
  status: string
  ip: string | null
  hostname: string | null
  osUser: string | null
  ts: string
}

export async function riwayatLogin(limit = 100): Promise<BarisLog[]> {
  const rows = await authQuery<any>(
    `SELECT username, role, status, ip, hostname, os_user, ts
       FROM tb_login_aira_log
      ORDER BY ts DESC
      LIMIT $1`,
    [Math.min(Math.max(limit, 1), 500)]
  )
  return rows.map((r) => ({
    username: r.username,
    role: r.role,
    status: r.status,
    ip: r.ip,
    hostname: r.hostname,
    osUser: r.os_user,
    ts: new Date(r.ts).toISOString()
  }))
}

// ------------------------------------------------------------------- start

/**
 * Dipanggil sekali saat aplikasi start. Migrasi skema TIDAK boleh menjatuhkan
 * aplikasi kalau database sedang tidak terjangkau — user harus tetap sampai ke
 * layar login dan melihat pesan yang bisa ditindaklanjuti, bukan splash yang
 * menggantung selamanya.
 */
export async function initAuth(): Promise<SesiUser | null> {
  try {
    if (!loginDbConfigured()) {
      logger().warn('database login belum dikonfigurasi — layar login akan menolak semua percobaan')
      return null
    }
    // Dicoba dua kali sebelum menyerah.
    //
    // ⚠️ Terjadi nyata 19 Agu 2026 pada peluncuran PERTAMA build `.exe`: migrasi
    // gagal "Connection terminated due to connection timeout" tepat di 15 detik,
    // padahal database terjangkau normal dari Node saat itu juga (TCP 20 ms,
    // query 185 ms) dan peluncuran kedua berhasil dalam 233 ms. Dugaan terkuat:
    // antivirus memindai binary baru yang belum ditandatangani (109 MB exe +
    // 84 MB asar) sehingga I/O proses tertahan melewati batas waktu.
    //
    // Tanpa percobaan ulang, gejalanya di lapangan adalah "login pertama sesudah
    // pemasangan selalu gagal" di sebagian laptop — keluhan yang mahal ditelusuri
    // karena percobaan kedua selalu berhasil dan tidak bisa diulang di meja kita.
    for (let percobaan = 1; percobaan <= 2; percobaan++) {
      try {
        await migrateAuthSchema()
        siap = true
        break
      } catch (err) {
        logger().error(
          { err: String(err), percobaan },
          percobaan < 2 ? 'migrasi skema login gagal, mencoba sekali lagi' : 'migrasi skema login gagal'
        )
        if (percobaan >= 2) return null
        await new Promise((r) => setTimeout(r, 2_000))
      }
    }
    try {
      return await pulihkanSesi()
    } catch (err) {
      logger().warn({ err: String(err) }, 'gagal memulihkan sesi')
      return null
    }
  } finally {
    // Selalu ditandai selesai, termasuk saat gagal — kalau tidak, renderer
    // menunggu selamanya di layar "Menyiapkan…" setiap kali jaringan putus.
    selesaiInit = true
  }
}

export { MENUS }
