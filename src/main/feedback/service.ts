import { app } from 'electron'
import { authQuery } from '../auth/db'
import { identitasMesin } from '../auth/identity'
import { cuplikanUntukKirim, periksaLampiranMasukan, validasiIsi } from './rules'
import { logger } from '../logger'
import * as localDb from '../db'
import type {
  FeedbackRow,
  FeedbackStatus,
  KirimFeedbackInput,
  ToolActivity
} from '../../shared/ipc'
import type { SesiUser } from '../auth/service'

// Penyimpanan masukan user. Lapisan yang menyentuh database; keputusannya
// (potong cuplikan, hormati pilihan user) diambil modul murni `rules.ts`.
//
// ⚠️ Memakai pool auth yang SUDAH ADA (`auth/db.ts`), bukan pool baru.
//
// Ini bukan kemalasan. `max_connections` server hanya 100 untuk SELURUH aplikasi
// di the company dan ~26 sudah terpakai; karena koneksi AIRA tidak pernah ditutup
// (`idleTimeoutMillis: 0`, keputusan sadar 19 Agu 2026), tiap AIRA yang terbuka
// menahan slotnya selama aplikasi hidup. Sekarang 3 slot per orang. Menambah
// pool keempat untuk fitur yang dipakai beberapa kali seminggu berarti 25 pemakai
// menghabiskan seperempat server — dan yang jatuh bukan cuma AIRA.
//
// Bonusnya: pool auth sudah menyerialkan seluruh query lewat `serialkan`, jadi
// masukan yang dikirim bersamaan dengan pemuatan panel tidak bisa memicu
// pembukaan koneksi serentak yang terbukti rapuh di dalam main process Electron.

/**
 * Versi aplikasi.
 *
 * `app.getVersion()`, BUKAN `process.env.npm_package_version` yang dipakai
 * `tb_login_aira_log`. Yang terakhir hanya terisi kalau proses dijalankan lewat
 * npm script — di `.exe` hasil build nilainya `undefined`, jadi justru kosong
 * tepat di tempat yang paling dibutuhkan. Untuk masukan dari lapangan, versi
 * adalah hal PERTAMA yang ditanyakan ("bug ini masih ada di build terbaru?"),
 * jadi ia harus terisi di aplikasi terpasang.
 */
function versiAplikasi(): string {
  try {
    return app.getVersion()
  } catch {
    return process.env.npm_package_version ?? 'dev'
  }
}

function baris(r: any): FeedbackRow {
  let toolLog: ToolActivity[] | null = null
  if (r.tool_log) {
    // Kolom jsonb dikembalikan pg sudah sebagai objek. Tapi baris lama, baris
    // yang ditulis tangan lewat SQL, atau driver yang berubah perilaku bisa
    // memberi string — dan satu baris rusak tidak boleh mengosongkan seluruh
    // daftar masukan Super Admin.
    try {
      const nilai = typeof r.tool_log === 'string' ? JSON.parse(r.tool_log) : r.tool_log
      toolLog = Array.isArray(nilai) ? (nilai as ToolActivity[]) : null
    } catch {
      toolLog = null
    }
  }
  return {
    id: Number(r.id),
    username: r.username,
    role: r.role,
    divisi: r.divisi,
    hostname: r.hostname,
    osUser: r.os_user,
    ip: r.ip,
    appVersion: r.app_version,
    jenis: r.jenis,
    dampak: r.dampak,
    isi: r.isi,
    sesiId: r.sesi_id,
    pesanId: r.pesan_id,
    mode: r.mode,
    model: r.model,
    pertanyaan: r.pertanyaan,
    jawaban: r.jawaban,
    toolLog,
    sertakanChat: r.sertakan_chat === true,
    status: r.status,
    catatanAdmin: r.catatan_admin,
    ditanganiOleh: r.ditangani_oleh,
    createdAt: new Date(r.created_at).toISOString(),
    lampiranNama: r.lampiran_nama ?? null,
    lampiranUkuran: r.lampiran_ukuran == null ? null : Number(r.lampiran_ukuran)
  }
}

/**
 * Menyimpan satu masukan.
 *
 * Identitas diambil dari `sesi` yang dipegang main process dan dari mesin ini —
 * TIDAK ada satu pun field identitas yang berasal dari renderer. Kalau renderer
 * boleh mengirimkannya, seorang user bisa melapor atas nama direktur dan seluruh
 * daftar berhenti bisa dipercaya sebagai catatan siapa mengeluhkan apa.
 */
export async function kirimFeedback(
  sesi: SesiUser,
  input: KirimFeedbackInput
): Promise<FeedbackRow[]> {
  const salah = validasiIsi(input.isi)
  if (salah) throw new Error(salah)
  const lampiran = input.lampiran ?? null
  if (lampiran) {
    const cek = periksaLampiranMasukan(lampiran.nama, lampiran.mime, lampiran.data.byteLength)
    if (!cek.ok) throw new Error(cek.alasan)
  }

  const id = identitasMesin()
  const { pertanyaan, jawaban } = cuplikanUntukKirim({
    sertakanChat: input.sertakanChat,
    pertanyaan: input.pertanyaan,
    jawaban: input.jawaban
  })

  await authQuery(
    `INSERT INTO tb_feedback_aira
       (username, role, divisi, hostname, os_user, ip, app_version,
        jenis, dampak, isi,
        sesi_id, pesan_id, mode, model, pertanyaan, jawaban, tool_log, sertakan_chat,
        lampiran_nama, lampiran_mime, lampiran_ukuran, lampiran_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7,
             $8, $9, $10,
             $11, $12, $13, $14, $15, $16, $17::jsonb, $18,
             $19, $20, $21, $22)`,
    [
      sesi.username,
      sesi.role,
      // Divisi digabung jadi satu teks: seorang Manager bisa memegang beberapa,
      // dan yang dibutuhkan saat membaca laporan adalah "dari divisi mana ini",
      // bukan relasi yang bisa di-join.
      sesi.divisi.length > 0 ? sesi.divisi.join(', ') : null,
      id.hostname,
      id.osUser,
      id.ip,
      versiAplikasi(),
      input.jenis,
      input.dampak,
      input.isi.trim(),
      input.sesiId,
      input.pesanId,
      input.mode,
      input.model,
      pertanyaan,
      jawaban,
      input.toolLog ? JSON.stringify(input.toolLog) : null,
      input.sertakanChat,
      lampiran ? lampiran.nama.trim().slice(0, 200) : null,
      lampiran ? lampiran.mime : null,
      lampiran ? lampiran.data.byteLength : null,
      lampiran ? Buffer.from(lampiran.data) : null
    ]
  )

  // Isi masukan TIDAK ikut ke audit lokal — hanya jenisnya. Audit log ada di
  // SQLite laptop user dan tidak punya guna menyimpan salinan kedua dari
  // cuplikan percakapan yang sudah dikirim ke server.
  localDb.audit('feedback', 'kirim', `jenis=${input.jenis} oleh=${sesi.username}`)
  logger().info(
    { jenis: input.jenis, mode: input.mode, sertakanChat: input.sertakanChat },
    'masukan user terkirim'
  )
  return feedbackMilikSaya(sesi)
}

/**
 * Masukan milik user yang sedang login.
 *
 * ⚠️ Difilter di SQL berdasarkan username SESI, bukan berdasarkan parameter dari
 * renderer — kalau usernamenya boleh dikirim dari layar, channel ini jadi cara
 * siapa pun membaca masukan orang lain tanpa perlu jadi Super Admin.
 *
 * Kolom `pertanyaan`/`jawaban` sengaja tidak ikut: user sudah tahu isinya, dan
 * daftar ini hanya perlu menjawab "masukan saya sudah ditindaklanjuti belum".
 */
export async function feedbackMilikSaya(sesi: SesiUser, limit = 100): Promise<FeedbackRow[]> {
  const rows = await authQuery<any>(
    `SELECT id, username, role, divisi, hostname, os_user, ip, app_version,
            jenis, dampak, isi, sesi_id, pesan_id, mode, model,
            NULL::text AS pertanyaan, NULL::text AS jawaban, NULL::jsonb AS tool_log,
            sertakan_chat, status, catatan_admin, ditangani_oleh, created_at,
            lampiran_nama, lampiran_ukuran
       FROM tb_feedback_aira
      WHERE lower(username) = lower($1)
      ORDER BY created_at DESC
      LIMIT $2`,
    [sesi.username, Math.min(Math.max(limit, 1), 100)]
  )
  return rows.map(baris)
}

/** Seluruh masukan — hanya untuk Super Admin (dijaga `wajibSuperAdmin` di ipc.ts). */
export async function daftarFeedback(limit = 100): Promise<FeedbackRow[]> {
  const rows = await authQuery<any>(
    `SELECT id, username, role, divisi, hostname, os_user, ip, app_version,
            jenis, dampak, isi, sesi_id, pesan_id, mode, model,
            pertanyaan, jawaban, tool_log, sertakan_chat,
            status, catatan_admin, ditangani_oleh, created_at,
            lampiran_nama, lampiran_ukuran
       FROM tb_feedback_aira
      ORDER BY created_at DESC
      LIMIT $1`,
    [Math.min(Math.max(limit, 1), 500)]
  )
  return rows.map(baris)
}

export async function setStatusFeedback(
  id: number,
  status: FeedbackStatus,
  catatan: string | null,
  olehUsername: string
): Promise<FeedbackRow[]> {
  await authQuery(
    `UPDATE tb_feedback_aira
        SET status = $2,
            catatan_admin = $3,
            ditangani_oleh = $4,
            ditangani_at = now()
      WHERE id = $1`,
    [id, status, catatan, olehUsername]
  )
  localDb.audit('feedback', 'status', `id=${id} status=${status} oleh=${olehUsername}`)
  return daftarFeedback()
}

/**
 * Isi lampiran satu masukan.
 *
 * ⚠️ Kepemilikan di KLAUSA WHERE (pola §32/§63): pemilik masukan, atau Super
 * Admin. Renderer hanya mengirim id — tanpa ini siapa pun yang menebak id bisa
 * mengunduh tangkapan layar yang dilaporkan direktur.
 */
export async function ambilLampiranFeedback(
  sesi: SesiUser,
  id: number,
  superAdmin: boolean
): Promise<{ nama: string; data: Buffer } | null> {
  const rows = await authQuery<any>(
    `SELECT lampiran_nama, lampiran_data
       FROM tb_feedback_aira
      WHERE id = $1
        AND lampiran_data IS NOT NULL
        AND ($3::boolean OR lower(username) = lower($2))`,
    [id, sesi.username, superAdmin]
  )
  const r = rows[0]
  if (!r) return null
  return { nama: r.lampiran_nama ?? `lampiran-masukan-${id}`, data: Buffer.from(r.lampiran_data) }
}
