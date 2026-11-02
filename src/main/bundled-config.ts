// Nilai-nilai ini disuntikkan saat build dari .env (lihat electron.vite.config.ts).
// Semua kredensial dibawa oleh aplikasi — user tidak perlu mengisi apa pun.
import { MUSE, META_ENDPOINT } from './hackathon/models'

declare const __BUNDLED_API_KEY__: string
declare const __BUNDLED_ENDPOINT__: string
declare const __BUNDLED_MODEL__: string
declare const __BUNDLED_YOU_KEY__: string
declare const __BUNDLED_EXA_KEY__: string
declare const __BUNDLED_SALES_DB__: string
declare const __BUNDLED_INNO_DB__: string
declare const __BUNDLED_LOGIN_DB__: string
declare const __BUNDLED_M365_TENANT__: string
declare const __BUNDLED_M365_CLIENT__: string
declare const __BUNDLED_UPDATE_URL__: string

function safe(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

export const BUNDLED = {
  apiKey: safe(typeof __BUNDLED_API_KEY__ !== 'undefined' ? __BUNDLED_API_KEY__ : '', ''),
  endpoint: safe(
    typeof __BUNDLED_ENDPOINT__ !== 'undefined' ? __BUNDLED_ENDPOINT__ : '',
    META_ENDPOINT
  ),
  modelId: safe(typeof __BUNDLED_MODEL__ !== 'undefined' ? __BUNDLED_MODEL__ : '', MUSE.agent),
  youKey: safe(typeof __BUNDLED_YOU_KEY__ !== 'undefined' ? __BUNDLED_YOU_KEY__ : '', ''),
  exaKey: safe(typeof __BUNDLED_EXA_KEY__ !== 'undefined' ? __BUNDLED_EXA_KEY__ : '', ''),
  salesDb: safe(typeof __BUNDLED_SALES_DB__ !== 'undefined' ? __BUNDLED_SALES_DB__ : '', ''),
  /** Master data the lab (MariaDB `inno_collection`) — mode "Ask Master Data". */
  innoDb: safe(typeof __BUNDLED_INNO_DB__ !== 'undefined' ? __BUNDLED_INNO_DB__ : '', ''),
  /**
   * Tabel login (`tb_login_aira` dkk). Satu-satunya koneksi di aplikasi ini yang
   * boleh MENULIS — pool sales & masterdata keduanya read-only. Default-nya sama
   * dengan `salesDb`; diberi variabel sendiri agar bisa dipindahkan tanpa ubah kode.
   */
  loginDb: safe(typeof __BUNDLED_LOGIN_DB__ !== 'undefined' ? __BUNDLED_LOGIN_DB__ : '', ''),
  /**
   * Microsoft 365 — App Registration "AIRA Desktop".
   *
   * ⚠️ Keduanya BUKAN rahasia: Tenant ID & Client ID memang publik menurut desain
   * OAuth, jadi keterbacaannya di dalam .exe bukan kebocoran. Yang TIDAK boleh ada
   * di sini adalah client secret — aplikasi desktop memakai PKCE justru karena
   * rahasia tidak bisa disembunyikan di dalam berkas yang dipegang user (aturan 13).
   */
  m365TenantId: safe(typeof __BUNDLED_M365_TENANT__ !== 'undefined' ? __BUNDLED_M365_TENANT__ : '', ''),
  m365ClientId: safe(typeof __BUNDLED_M365_CLIENT__ !== 'undefined' ? __BUNDLED_M365_CLIENT__ : '', ''),
  /**
   * Server auto-update (opsional). Kosong = memakai `URL_UPDATE_BAWAAN`
   * (`update/rules.ts`). Bukan rahasia — hanya alamat berkas statis.
   */
  updateUrl: safe(typeof __BUNDLED_UPDATE_URL__ !== 'undefined' ? __BUNDLED_UPDATE_URL__ : '', '')
}
