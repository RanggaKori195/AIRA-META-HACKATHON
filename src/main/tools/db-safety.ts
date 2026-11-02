import { ToolError } from './types'

// Logika keamanan database — modul murni (tanpa driver native) supaya bisa di-test langsung.

export type Engine = 'postgres' | 'mysql' | 'mssql' | 'sqlite'

export function detectEngine(connectionString: string): Engine {
  const lower = connectionString.toLowerCase().trim()
  if (lower.startsWith('postgres://') || lower.startsWith('postgresql://')) return 'postgres'
  if (lower.startsWith('mysql://')) return 'mysql'
  if (lower.startsWith('mssql://') || lower.startsWith('sqlserver://') || /(^|;)\s*server\s*=/.test(lower))
    return 'mssql'
  if (
    lower.startsWith('sqlite:') ||
    lower.endsWith('.db') ||
    lower.endsWith('.sqlite') ||
    lower.endsWith('.sqlite3')
  )
    return 'sqlite'
  throw new ToolError(
    'format connection string tidak dikenal — dukung: postgres://, mysql://, mssql:// / Server=...;, dan path file SQLite'
  )
}

export function maskConnectionString(connectionString: string): string {
  return connectionString
    .replace(/:\/\/([^:@/]+):([^@/]+)@/g, '://$1:***@')
    .replace(/(password\s*=\s*)[^;]+/gi, '$1***')
}

const WRITE_PATTERN =
  /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|merge|exec|execute|call|replace|attach)\b|into\s+(outfile|dumpfile)/i

/**
 * Tabel yang tidak boleh disentuh tool database mana pun — baik baca maupun tulis.
 *
 * `tb_login_aira` memuat hash password seluruh user beserta rolenya, dan ia duduk
 * di `DB-REPOSITORY` — database yang SAMA dengan `SalesRepository`. Artinya
 * connection string yang sah untuk pertanyaan penjualan juga sah untuk membaca
 * tabel ini. Tanpa daftar ini, "coba lihat isi tabel tb_login_aira" adalah SELECT
 * biasa yang lolos `assertReadOnly`, dan hash password direksi muncul di jendela
 * chat — lalu ikut tersimpan di riwayat SQLite dan dikirim ulang ke model setiap
 * giliran berikutnya.
 *
 * Sisi tulisnya sama seriusnya: lewat `db_execute` satu UPDATE bisa menaikkan role
 * sendiri jadi super_admin atau membatalkan blokir. Karena itu larangannya dipasang
 * di `runQuery`, bukan hanya di `assertReadOnly` — supaya berlaku untuk kedua tool.
 *
 * `tb_feedback_aira` ikut di sini karena alasan yang berbeda tapi sama seriusnya:
 * ia tidak memuat password, tapi kolom `pertanyaan`/`jawaban` memuat CUPLIKAN
 * PERCAKAPAN yang dilaporkan user — bisa berisi angka omzet, bisa berisi isi
 * dokumen yang dilampirkan (termasuk laporan pasien). Membiarkannya terbaca lewat
 * `db_query` berarti seorang SPV bisa membaca apa yang dilaporkan direktur, cukup
 * dengan meminta AIRA melihat isi tabel.
 */
const TABEL_TERLARANG = [
  'tb_login_aira',
  'tb_login_aira_log',
  'tb_menu_akses_aira',
  // Pengganti matriks di atas (30 Sep 2026). Tabel lama TETAP dilarang: masih ada
  // dan masih dibaca build lama.
  'tb_menu_role_divisi_aira',
  'tb_menu_divisi_aira',
  'tb_feedback_aira',
  // Chat antar user (8 Sep 2026). Alasannya lebih keras daripada tb_feedback_aira:
  // isinya percakapan PRIBADI antar karyawan beserta lampirannya, dan ia duduk di
  // database yang sama dengan SalesRepository — jadi connection string yang sah
  // untuk pertanyaan penjualan juga sah untuk membacanya.
  'tb_chat_aira_pesan',
  // Kehadiran ikut dilarang: ia menjawab "siapa membuka AIRA, kapan, dari laptop
  // mana" untuk SELURUH karyawan sekaligus — pemantauan yang tidak pernah diminta
  // siapa pun saat mereka menyalakan aplikasi.
  'tb_chat_aira_hadir',
  // Grup chat (16 Sep 2026). ⚠️ KEDUA nama wajib ditulis: `` tidak menyala di
  // antara "grup" dan "_anggota" (garis bawah termasuk karakter kata), jadi
  // melarang `tb_chat_aira_grup` saja TIDAK ikut melarang tabel anggotanya.
  'tb_chat_aira_grup',
  'tb_chat_aira_grup_anggota',
  // Monitoring pemakaian (16 Sep 2026): pertanyaan seluruh karyawan beserta
  // jam & laptopnya. Tabel akses ikut dilarang — ia menjawab "siapa mengawasi
  // siapa".
  'tb_aktivitas_aira',
  'tb_aktivitas_akses_aira'
]

/**
 * Menolak query yang menyebut tabel login.
 *
 * Sengaja pencocokan NAMA, bukan analisis SQL: alias, subquery, CTE, dan
 * `information_schema` semuanya tetap harus menyebut namanya untuk bisa membacanya.
 * Batas kata (`\b`) dipakai supaya `tb_login_aira` juga menangkap `tb_login_aira_log`
 * tidak sebaliknya menangkap tabel lain yang kebetulan berawalan sama.
 */
/**
 * Alasan per tabel.
 *
 * ⚠️ Ditulis per tabel, bukan satu kalimat untuk semua. Versi sebelumnya memakai
 * ternary yang menyebut "berisi kredensial login" untuk apa pun selain feedback —
 * begitu tabel chat ditambahkan, penolakannya jadi BERBOHONG soal sebabnya. Pesan
 * penolakan yang salah alasan lebih buruk daripada pesan umum: ia mengirim orang
 * menelusuri hal yang keliru.
 */
const ALASAN_TERLARANG: Record<string, string> = {
  tb_login_aira: 'berisi kredensial login AIRA',
  tb_login_aira_log: 'berisi riwayat percobaan masuk beserta identitas mesinnya',
  tb_menu_akses_aira: 'berisi matriks hak akses menu',
  tb_menu_role_divisi_aira: 'berisi matriks hak akses menu per role dan divisi',
  tb_menu_divisi_aira: 'berisi matriks hak akses menu per divisi',
  tb_feedback_aira: 'berisi masukan user beserta cuplikan percakapannya',
  tb_chat_aira_pesan: 'berisi percakapan pribadi antar pengguna beserta lampirannya',
  tb_chat_aira_hadir: 'berisi catatan siapa membuka AIRA dan kapan',
  tb_chat_aira_grup: 'berisi daftar grup chat antar pengguna',
  // Keanggotaan menjawab "siapa berkelompok dengan siapa" — struktur sosial di
  // dalam kantor yang tidak pernah diminta untuk disajikan kepada siapa pun.
  tb_chat_aira_grup_anggota: 'berisi siapa saja anggota tiap grup chat',
  tb_aktivitas_aira: 'berisi catatan pemakaian AIRA seluruh pengguna beserta pertanyaannya',
  tb_aktivitas_akses_aira: 'berisi catatan siapa membuka monitoring pemakaian'
}

export function assertBukanTabelAuth(query: string): void {
  const lower = query.toLowerCase()
  for (const tabel of TABEL_TERLARANG) {
    if (new RegExp(`\\b${tabel}\\b`).test(lower)) {
      const alasan = ALASAN_TERLARANG[tabel] ?? 'berisi data internal AIRA'
      throw new ToolError(
        `tabel "${tabel}" ${alasan}, dan tidak bisa diakses lewat tool database. ` +
          'Datanya dibuka lewat antarmuka AIRA oleh orang yang berhak, bukan lewat query.'
      )
    }
  }
}

export function assertReadOnly(query: string): void {
  const first = query.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  const readStarters = ['select', 'show', 'describe', 'desc', 'explain', 'with', 'pragma']
  if (!readStarters.includes(first) || WRITE_PATTERN.test(query)) {
    throw new ToolError('db_query hanya untuk statement baca — untuk perubahan data gunakan db_execute')
  }
}
