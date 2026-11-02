import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHash, randomBytes } from 'node:crypto'
import { shell } from 'electron'
import { BUNDLED } from '../bundled-config'
import { getSecret, setSecret, deleteSecret, hasSecret } from '../secrets'
import { logger } from '../logger'
import { M365_LANJUTAN, terjemahkanGalatEntra } from './rules'
import { penandaAktif } from './berkas'

// Login Microsoft 365 untuk AIRA Desktop.
//
// ⚠️ TANPA client secret, dan itu bukan penyederhanaan melainkan keharusan.
// Seluruh string di dalam `.exe` tetap terbaca, termasuk yang sudah dikompilasi
// ke bytecode — terbukti 19 Agu 2026 ketika connection string Postgres berhasil
// ditarik dari hasil build. Client secret akan bernasib sama, dan akibatnya
// lebih berat: siapa pun yang memegang installer bisa memakai identitas
// aplikasinya. Aplikasi desktop memang dirancang sebagai PUBLIC CLIENT: yang
// mengamankan penukaran token adalah PKCE, bukan rahasia yang disembunyikan.
//
// Client ID & Tenant ID sengaja ikut ke installer — keduanya memang publik
// menurut desain OAuth, jadi keterbacaannya bukan kebocoran.
//
// ⚠️ Login dibuka di BROWSER SISTEM, bukan jendela Chromium bawaan Electron.
// Conditional Access kerap menolak embedded webview, dan gejalanya menyesatkan:
// halaman login muncul lalu diam tanpa pesan apa pun.

/**
 * Scope yang diminta. Semuanya DELEGATED — AIRA bertindak sebagai orang yang
 * sedang login, jadi ia tidak pernah melihat apa pun yang orang itu sendiri
 * tidak boleh lihat.
 *
 * ⚠️ Yang SENGAJA TIDAK diminta, dan alasannya:
 *   - `Mail.Send`      — mengirim email tidak bisa ditarik. AIRA hanya membuat
 *                        DRAF (`Mail.ReadWrite`); yang menekan Send tetap orangnya.
 *   - `Files.Read.All` versi Application — itu memberi akses OneDrive SELURUH
 *                        karyawan tanpa ada user yang login.
 *   - transkrip Teams  — butuh keputusan kebijakan, bukan keputusan teknis.
 *
 * Menambah scope di sini WAJIB diikuti penambahan izin di App Registration +
 * admin consent. Kalau tidak, gejalanya menyesatkan: login sukses, lalu
 * panggilan Graph ditolak 403 seolah berkasnya terlarang.
 */
const SCOPE_DASAR = ['openid', 'profile', 'offline_access', 'User.Read', 'Files.Read.All']

/**
 * ⚠️ Hanya diminta bila `M365_LANJUTAN` menyala.
 *
 * `Sites.Read.All` & `Files.ReadWrite.All` menuntut admin consent. Selama
 * consent itu belum ada, memintanya membuat Microsoft menahan SELURUH
 * permintaan — termasuk `Files.Read.All` yang sudah disetujui — sehingga
 * pembacaan berkas yang tadinya jalan ikut mati di layar "Need admin approval".
 * Meminta lebih sedikit justru mengembalikan yang dasar.
 */
const SCOPE_LANJUTAN = ['Files.ReadWrite.All', 'Sites.Read.All', 'Mail.ReadWrite', 'Calendars.Read']

const SCOPE = (
  M365_LANJUTAN ? [...SCOPE_DASAR.filter((s) => s !== 'Files.Read.All'), ...SCOPE_LANJUTAN] : SCOPE_DASAR
).join(' ')
const KUNCI_REFRESH = 'm365RefreshToken'
/** Batas menunggu user menyelesaikan login di browser. */
const BATAS_LOGIN_MS = 5 * 60_000
/** Token diperbarui sedikit lebih awal supaya tidak kedaluwarsa di tengah permintaan. */
const AMBANG_SEGAR_MS = 120_000

function authority(): string {
  return `https://login.microsoftonline.com/${BUNDLED.m365TenantId}`
}

export function m365Configured(): boolean {
  return BUNDLED.m365TenantId.length > 0 && BUNDLED.m365ClientId.length > 0
}

/** Sudah pernah login dan refresh token-nya masih tersimpan. */
export function m365SudahLogin(): boolean {
  return hasSecret(KUNCI_REFRESH)
}

export function m365Logout(): void {
  deleteSecret(KUNCI_REFRESH)
  akses = null
  akunTerakhir = null
  // Penanda berkas milik akun ini tidak boleh terbawa ke akun berikutnya.
  penandaAktif.kosongkan()
  logger().info('sesi Microsoft 365 dihapus')
}

interface Akses {
  token: string
  kedaluwarsa: number
}

let akses: Akses | null = null
let akunTerakhir: string | null = null
/** Login yang sedang berjalan — supaya dua tool tidak membuka dua browser. */
let loginBerjalan: Promise<string> | null = null

export function m365Akun(): string | null {
  return akunTerakhir
}

function b64url(b: Buffer): string {
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function galat(pesan: string): Error {
  const saran = terjemahkanGalatEntra(pesan)
  return new Error(saran ? `${pesan.slice(0, 200)} → ${saran}` : pesan.slice(0, 300))
}

interface JawabanToken {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

async function tukar(body: Record<string, string>): Promise<JawabanToken> {
  const res = await fetch(`${authority()}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: BUNDLED.m365ClientId, scope: SCOPE, ...body }).toString()
  })
  const data = (await res.json().catch(() => ({}))) as JawabanToken
  if (!res.ok) {
    throw galat(data.error_description ?? data.error ?? `HTTP ${res.status}`)
  }
  return data
}

/**
 * Izin yang WAJIB ada di token. Kalau salah satunya tidak diberikan, token itu
 * tidak berguna untuk sebagian menu.
 *
 * ⚠️ Ini menutup kegagalan yang paling membingungkan saat scope DITAMBAH:
 * refresh token yang tersimpan terikat pada izin LAMA. Sesudah admin menambah
 * `Mail.ReadWrite` di Entra, AIRA tetap memperbarui token dari refresh token
 * lama, mendapat token yang sah — lalu setiap panggilan email ditolak 403.
 * Dari layar itu terlihat seperti "izinnya belum di-consent" padahal sudah,
 * dan orang akan bolak-balik memeriksa portal Azure tanpa menemukan apa pun.
 *
 * Yang benar: sadari izinnya kurang, buang refresh token lama, dan minta login
 * sekali lagi. Sekali, otomatis, dengan sebab yang tercatat di log.
 */
const IZIN_WAJIB = M365_LANJUTAN ? SCOPE_LANJUTAN : ['Files.Read.All']

function izinKurang(diberikan: string | undefined): string[] {
  if (!diberikan) return []
  const punya = diberikan.toLowerCase().split(/\s+/)
  return IZIN_WAJIB.filter((w) => !punya.includes(w.toLowerCase()))
}

function simpan(data: JawabanToken): string {
  if (!data.access_token) throw new Error('Microsoft tidak mengembalikan access token')
  akses = {
    token: data.access_token,
    kedaluwarsa: Date.now() + (data.expires_in ?? 3600) * 1000
  }
  // ⚠️ Refresh token BERPUTAR: Microsoft mengembalikan yang baru setiap kali
  // dipakai, dan yang lama langsung mati. Kalau yang baru tidak disimpan, user
  // akan diminta login ulang pada pemakaian BERIKUTNYA — gejala yang muncul
  // besok, bukan hari ini, sehingga sulit dihubungkan ke sebabnya.
  if (data.refresh_token) setSecret(KUNCI_REFRESH, data.refresh_token)
  return akses.token
}

/** Menunggu balasan dari browser pada satu port loopback. */
function tungguKode(server: Server, state: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const batas = setTimeout(
      () => reject(new Error('login tidak diselesaikan dalam 5 menit')),
      BATAS_LOGIN_MS
    )
    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const kode = url.searchParams.get('code')
      const pesanGalat = url.searchParams.get('error_description') ?? url.searchParams.get('error')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(
        `<!doctype html><html><head><meta charset="utf-8"><title>AIRA</title></head>
         <body style="font-family:Segoe UI,sans-serif;padding:48px;color:#1d3b24">
         <h2 style="color:#2f6f3e">${kode ? 'Berhasil masuk.' : 'Login gagal.'}</h2>
         <p>${kode ? 'Silakan kembali ke AIRA — jendela ini boleh ditutup.' : (pesanGalat ?? 'tidak diketahui')}</p>
         </body></html>`
      )
      clearTimeout(batas)
      if (pesanGalat) reject(galat(pesanGalat))
      else if (!kode) reject(new Error('balasan login tanpa authorization code'))
      // State mengikat balasan ini pada permintaan yang kita mulai sendiri.
      else if (url.searchParams.get('state') !== state) {
        reject(new Error('state tidak cocok — balasan bukan milik permintaan ini'))
      } else resolve(kode)
    })
  })
}

/**
 * Login interaktif. Membuka browser sistem dan menunggu balasannya.
 *
 * Dipanggil hanya bila belum pernah login atau refresh token sudah mati —
 * bukan setiap kali token kedaluwarsa.
 */
async function login(): Promise<string> {
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(16))

  const server = createServer()
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  // 127.0.0.1, bukan "localhost": `localhost` bisa resolve ke IPv6 ::1 sementara
  // server ini mengikat IPv4, dan gejalanya halaman balik yang menggantung.
  const redirect = `http://127.0.0.1:${port}`

  const url =
    `${authority()}/oauth2/v2.0/authorize?` +
    new URLSearchParams({
      client_id: BUNDLED.m365ClientId,
      response_type: 'code',
      redirect_uri: redirect,
      response_mode: 'query',
      scope: SCOPE,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account'
    }).toString()

  logger().info({ redirect }, 'membuka login Microsoft 365 di browser sistem')
  await shell.openExternal(url)

  try {
    const kode = await tungguKode(server, state)
    const data = await tukar({
      grant_type: 'authorization_code',
      code: kode,
      redirect_uri: redirect,
      code_verifier: verifier
    })
    logger().info({ scope: data.scope }, 'login Microsoft 365 berhasil')
    return simpan(data)
  } finally {
    server.close()
  }
}

/**
 * Token yang siap dipakai. Memperbarui diam-diam bila perlu, dan hanya membuka
 * browser sebagai jalan terakhir.
 */
export async function m365Token(bolehLogin = true): Promise<string> {
  if (!m365Configured()) {
    throw new Error(
      'Microsoft 365 belum dikonfigurasi pada build ini (AIRA_M365_TENANT_ID / AIRA_M365_CLIENT_ID kosong).'
    )
  }
  if (akses && akses.kedaluwarsa - Date.now() > AMBANG_SEGAR_MS) return akses.token

  const refresh = getSecret(KUNCI_REFRESH)
  if (refresh) {
    try {
      const data = await tukar({ grant_type: 'refresh_token', refresh_token: refresh })
      // Token sah, tapi izinnya dari sesi LAMA — lihat catatan di `IZIN_WAJIB`.
      const kurang = izinKurang(data.scope)
      if (kurang.length > 0 && bolehLogin) {
        logger().warn(
          { kurang },
          'izin Microsoft 365 bertambah sejak login terakhir — meminta login ulang sekali'
        )
        deleteSecret(KUNCI_REFRESH)
        akses = null
      } else {
        return simpan(data)
      }
    } catch (err) {
      // ⚠️ Gagal JARINGAN (fetch melempar TypeError) bukan penolakan Microsoft:
      // refresh token-nya masih sah. Membuangnya membuat orang yang sekadar
      // sedang offline dipaksa login ulang — dan layar awal Microsoft 365 memeriksa
      // status setiap kali dibuka, jadi ini akan sering terjadi.
      if (err instanceof TypeError) {
        throw new Error('Tidak bisa menghubungi layanan login Microsoft — periksa koneksi internet.')
      }
      // Refresh token mati (kedaluwarsa, password diganti, sesi dicabut admin).
      // Dibuang supaya tidak dicoba terus-menerus setiap permintaan.
      logger().warn({ err: String(err).slice(0, 200) }, 'refresh token Microsoft 365 ditolak')
      deleteSecret(KUNCI_REFRESH)
    }
  }

  if (!bolehLogin) throw new Error('BELUM_LOGIN_M365')

  // Satu login pada satu waktu. Tanpa ini, dua tool yang berjalan berurutan
  // dalam satu jawaban bisa membuka dua tab login sekaligus.
  if (!loginBerjalan) {
    loginBerjalan = login().finally(() => {
      loginBerjalan = null
    })
  }
  return loginBerjalan
}

/** Nama & email akun yang sedang login. Dipakai untuk ditampilkan ke user. */
export async function m365Identitas(): Promise<{ nama: string; email: string }> {
  const token = await m365Token()
  const res = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${token}` }
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, string>
  if (!res.ok) throw new Error(`tidak bisa membaca identitas: HTTP ${res.status}`)
  const email = body.userPrincipalName ?? body.mail ?? ''
  akunTerakhir = email || null
  return { nama: body.displayName ?? '', email }
}
