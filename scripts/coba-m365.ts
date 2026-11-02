/**
 * BUKTI bahwa App Registration "AIRA Desktop" benar-benar bisa membaca OneDrive.
 *
 * Dijalankan SEBELUM modul `m365/` dibangun, dengan sengaja: kalau registrasinya
 * salah setel, kesalahannya akan muncul di sini — bukan berminggu-minggu kemudian
 * di dalam kode yang sudah terlanjur ditulis mengelilinginya.
 *
 * TANPA dependensi baru. PKCE ditulis tangan (~80 baris) supaya pembuktian ini
 * tidak bergantung pada library yang belum tentu jadi dipakai. Keputusan
 * memakai `@azure/msal-node` untuk PRODUKSI tetap terpisah dari ini.
 *
 * ⚠️ Password tidak pernah melewati skrip ini. Login terjadi di browser milik
 * user; yang kembali ke sini hanya authorization code sekali pakai.
 *
 * Jalankan: npx tsx scripts/coba-m365.ts
 */
import 'dotenv/config'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'

const TENANT = process.env.AIRA_M365_TENANT_ID ?? ''
const CLIENT = process.env.AIRA_M365_CLIENT_ID ?? ''
const SCOPE = 'openid profile offline_access User.Read Files.Read.All'
const AUTHORITY = `https://login.microsoftonline.com/${TENANT}`
const GRAPH = 'https://graph.microsoft.com/v1.0'

const masalah: string[] = []
let no = 0

function periksa(judul: string, lolos: boolean, detail: string): void {
  no++
  console.log(`${lolos ? 'OK   ' : 'GAGAL'} ${no}. ${judul}`)
  console.log(`        ${detail}`)
  if (!lolos) masalah.push(`${judul} — ${detail}`)
}

function b64url(b: Buffer): string {
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Menerjemahkan kode galat Entra ke penyetelan yang harus diperbaiki.
 *
 * Tanpa ini pesannya menyesatkan dengan cara yang khas: `AADSTS7000218` berbunyi
 * seolah meminta client secret, padahal yang kurang justru saklar
 * "Allow public client flows".
 */
function terjemahkan(teks: string): string | null {
  if (teks.includes('AADSTS7000218')) {
    return 'Allow public client flows masih OFF. Authentication → Advanced settings → Yes → Save.'
  }
  if (teks.includes('AADSTS50011')) {
    return 'Redirect URI tidak cocok. Tambahkan http://localhost DAN http://127.0.0.1 di Custom redirect URIs (platform Mobile and desktop applications).'
  }
  if (teks.includes('AADSTS65001')) {
    return 'Belum ada consent. Klik "Grant admin consent for the company" di API permissions.'
  }
  if (teks.includes('AADSTS700016') || teks.includes('unauthorized_client')) {
    return 'Client ID tidak dikenal di tenant ini. Periksa AIRA_M365_CLIENT_ID.'
  }
  if (teks.includes('AADSTS900023') || teks.includes('AADSTS90002')) {
    return 'Tenant ID tidak dikenal. Periksa AIRA_M365_TENANT_ID.'
  }
  if (teks.includes('AADSTS53003') || teks.includes('AADSTS50005')) {
    return 'Diblokir Conditional Access. Login harus lewat browser sistem pada perangkat yang compliant.'
  }
  return null
}

async function graph(path: string, token: string): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch(`${GRAPH}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

/** Menunggu satu kunjungan balik dari browser, lalu menutup servernya. */
function tungguKode(server: Server, state: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const batas = setTimeout(() => reject(new Error('tidak ada balasan dari browser dalam 5 menit')), 300_000)
    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const kode = url.searchParams.get('code')
      const galat = url.searchParams.get('error_description') ?? url.searchParams.get('error')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(
        `<html><body style="font-family:sans-serif;padding:40px">
         <h2>${kode ? 'Berhasil.' : 'Gagal.'}</h2>
         <p>${kode ? 'Silakan kembali ke terminal.' : (galat ?? 'tidak diketahui')}</p>
         </body></html>`
      )
      clearTimeout(batas)
      if (galat) reject(new Error(galat))
      else if (!kode) reject(new Error('balasan tanpa code'))
      else if (url.searchParams.get('state') !== state) reject(new Error('state tidak cocok — balasan bukan milik permintaan ini'))
      else resolve(kode)
    })
  })
}

async function main(): Promise<void> {
  periksa('Tenant ID & Client ID terbaca dari .env',
    TENANT.length === 36 && CLIENT.length === 36,
    `tenant=${TENANT || '(kosong)'} client=${CLIENT || '(kosong)'}`)
  if (masalah.length) return

  // 1. Tenant benar-benar ada — dijawab tanpa login sama sekali.
  const meta = await fetch(`${AUTHORITY}/v2.0/.well-known/openid-configuration`)
  const metaBody: any = await meta.json().catch(() => ({}))
  periksa('tenant dikenal Microsoft (metadata OIDC terbaca)', meta.ok,
    meta.ok ? `issuer ${metaBody.issuer}` : `HTTP ${meta.status} ${JSON.stringify(metaBody).slice(0, 160)}`)
  if (!meta.ok) return

  // 2. PKCE + loopback.
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(16))

  const server = createServer()
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  const redirect = `http://127.0.0.1:${port}`

  const url =
    `${AUTHORITY}/oauth2/v2.0/authorize?` +
    new URLSearchParams({
      client_id: CLIENT,
      response_type: 'code',
      redirect_uri: redirect,
      response_mode: 'query',
      scope: SCOPE,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account'
    }).toString()

  console.log('\n--------------------------------------------------------------')
  console.log('Silakan login di browser yang terbuka (akun the company BIASA, bukan admin).')
  console.log('Kalau browsernya tidak terbuka sendiri, buka alamat ini:\n')
  console.log(url)
  console.log('--------------------------------------------------------------\n')
  // Dibuka di browser SISTEM, bukan jendela aplikasi: Conditional Access kerap
  // menolak embedded webview, dan gejalanya halaman login yang diam tanpa pesan.
  spawn('powershell', ['-NoProfile', '-Command', `Start-Process '${url}'`], { stdio: 'ignore' }).unref()

  let kode: string
  try {
    kode = await tungguKode(server, state)
    periksa('login selesai & authorization code diterima di loopback', true,
      `redirect_uri ${redirect} diterima Entra`)
  } catch (e: any) {
    const saran = terjemahkan(String(e.message))
    periksa('login selesai & authorization code diterima di loopback', false,
      `${e.message}${saran ? ` → ${saran}` : ''}`)
    server.close()
    return
  }
  server.close()

  // 3. Tukar code jadi token — TANPA client secret.
  const res = await fetch(`${AUTHORITY}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT,
      grant_type: 'authorization_code',
      code: kode,
      redirect_uri: redirect,
      code_verifier: verifier,
      scope: SCOPE
    }).toString()
  })
  const tok: any = await res.json().catch(() => ({}))
  const pesan = JSON.stringify(tok)
  if (!res.ok) {
    const saran = terjemahkan(pesan)
    periksa('token ditukar tanpa client secret (bukti PKCE + public client)', false,
      `HTTP ${res.status} ${(tok.error_description ?? '').split('\n')[0]}${saran ? `\n        → ${saran}` : ''}`)
    return
  }
  periksa('token ditukar tanpa client secret (bukti PKCE + public client aktif)', true,
    `access_token diterima, berlaku ${tok.expires_in}s`)

  // 4. offline_access — tanpa ini user harus login ulang tiap kali.
  periksa('refresh token diberikan (offline_access aktif)', Boolean(tok.refresh_token),
    tok.refresh_token ? 'ada — AIRA tidak perlu meminta login berulang' : 'TIDAK ADA: tambahkan scope offline_access')

  const granted: string = tok.scope ?? ''
  periksa('scope Files.Read.All benar-benar diberikan', /Files\.Read\.All/i.test(granted),
    `diberikan: ${granted || '(kosong)'}`)

  const token: string = tok.access_token

  // 5. Identitas — memastikan tokennya memang milik orang yang login.
  const me = await graph('/me', token)
  periksa('/me terbaca', me.ok,
    me.ok ? `${me.body.displayName} <${me.body.userPrincipalName}>` : `HTTP ${me.status} ${JSON.stringify(me.body).slice(0, 160)}`)

  // 6. OneDrive pribadi.
  const drive = await graph('/me/drive', token)
  periksa('OneDrive pribadi terjangkau', drive.ok,
    drive.ok
      ? `driveType=${drive.body.driveType} terpakai ${(Number(drive.body.quota?.used ?? 0) / 1e9).toFixed(1)} GB`
      : `HTTP ${drive.status} ${JSON.stringify(drive.body).slice(0, 200)}`)

  const akar = await graph('/me/drive/root/children?$top=5&$select=name,folder,size', token)
  periksa('isi folder utama OneDrive terbaca', akar.ok,
    akar.ok
      ? (akar.body.value ?? []).map((x: any) => `${x.name}${x.folder ? '/' : ''}`).join(' · ') || '(kosong)'
      : `HTTP ${akar.status}`)

  // 7. INI yang menentukan: file yang di-share orang lain.
  const share = await graph('/me/drive/sharedWithMe', token)
  const isi = share.ok ? (share.body.value ?? []) : []
  periksa('daftar "shared with me" terbaca', share.ok,
    share.ok
      ? `${isi.length} item terlihat`
      : `HTTP ${share.status} ${JSON.stringify(share.body).slice(0, 200)}`)

  if (share.ok) {
    // ⚠️ Yang di-share tinggal di drive ORANG LAIN. Membaca isinya butuh
    // driveId + itemId, bukan path — ini yang menentukan bentuk toolnya nanti.
    const contoh = isi.slice(0, 5).map((x: any) => {
      const dari = x.remoteItem?.createdBy?.user?.displayName ?? '?'
      return `${x.name}${x.remoteItem?.folder ? '/' : ''} (dari ${dari})`
    })
    periksa('item share membawa driveId + itemId (dibutuhkan untuk membacanya)',
      isi.length === 0 || Boolean(isi[0]?.remoteItem?.parentReference?.driveId && isi[0]?.remoteItem?.id),
      isi.length === 0
        ? 'daftar kosong — belum ada yang di-share ke akun ini, ATAU share-nya berasal dari SharePoint (perlu Sites.Read.All)'
        : contoh.join(' · '))
  }

  // 8. Pencarian — dipakai tool `onedrive_cari` nanti.
  const cari = await graph(`/me/drive/root/search(q='.docx')?$top=3&$select=name`, token)
  periksa('pencarian file berjalan', cari.ok,
    cari.ok ? `${(cari.body.value ?? []).length} hasil contoh` : `HTTP ${cari.status}`)

  console.log('')
  if (masalah.length) {
    console.log(`ADA ${masalah.length} MASALAH:`)
    for (const m of masalah) console.log(`  - ${m}`)
    process.exit(1)
  }
  console.log(`Semua ${no} pemeriksaan lolos.`)
}

main().catch((e) => {
  console.error('GAGAL:', e.message)
  process.exit(1)
})
