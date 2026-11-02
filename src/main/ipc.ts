import { ipcMain, BrowserWindow, clipboard, dialog, shell } from 'electron'
import type {
  ReagentActionsResult,
  ReagentEvidenceResult,
  ReagentExportResult,
  ReagentRunResult,
  ReagentStatus,
  ReagentSummaryResult
} from '../shared/reagent'
import { actions, availableMonths, evidenceRows, runReconciliation } from './reagent/service'
import { buildActionsWorkbook } from './reagent/export'
import { draftSummary } from './reagent/summary'
import { MUSE } from './hackathon/models'
import { reagentFolderFor, setReagentFolder } from './reagent/folder'
import { ReagentEvidenceInput, ReagentExportInput, ReagentMonth } from './reagent/ipc-schema'
import { readFileSync, statSync, writeFileSync } from 'fs'
import { hostname } from 'os'
import { statusKoneksiSales } from './sales/db'
import { statusKoneksiInno } from './masterdata/db'
import { statusDrive } from './m365/status'
import { daftarPustaka } from './pustaka/service'
import { basename } from 'path'
import { z } from 'zod'
import {
  FEEDBACK_DAMPAK,
  FEEDBACK_JENIS,
  FEEDBACK_STATUS,
  IPC_CHANNELS,
  MENU_VALUES,
  PEMICU_PEMANTAU,
  ROLE_VALUES,
  type AccessConfig,
  type KeadaanPemantau,
  type Attachment,
  type AuthLogRow,
  type AuthState,
  type AuthUserRow,
  type FeedbackRow,
  type HasilTranskripIpc,
  type PesanChatIpc,
  type RekanChat,
  type MemoriRow,
  type LoginResult,
  type ModelChoice,
  type PanduanBagian,
  type SetelanChat,
  type GrupRingkas,
  type InfoGrup,
  type LinimasaHasil,
  type MonitoringRingkasan,
  type SaveSetupResult,
  type StatusUpdate,
  type GaleriHasil,
  type ItemGaleri,
  type ItemJadwal,
  type JalanDenganTugas,
  type BerkasTerbaru,
  type StatusKoneksiSales,
  type StatusDrive,
  type ItemPustaka,
  type SetupState
} from '../shared/ipc'
import * as auth from './auth/service'
import * as feedback from './feedback/service'
import * as monitoring from './monitoring/service'
import * as pembaruan from './update/service'
import * as galeri from './gambar/galeri'
import * as jadwal from './jadwal/service'
import { JadwalError } from './jadwal/rules'
import * as pemantau from './pemantau/nyata'
import { MAKS_ISI, MAKS_LAMPIRAN_MASUKAN } from './feedback/rules'
import * as memori from './memori/service'
import { bolehKelolaUser } from './auth/roles'
import { PASSWORD_MAX, PASSWORD_MIN } from './auth/password'
import { loadConfig, saveConfig } from './config'
import { getSecret, hasSecret, setSecret } from './secrets'
import { OpenAICompatProvider } from './llm/openai-compat'
import { buildProvider } from './llm/factory'
import { triggerAutoIndex } from './rag/auto'
import { stageFile, effectiveAllowedDirs } from './attachments'
import { resolveInBoundary } from './tools/boundary'
import { hapusRuangUji, lupakanIzinJaringan } from './uji/ruang'
import { notify } from './notify'
import { suaraTersedia, transkripsikan } from './suara/transkrip'
import { panduanSekarang } from './panduan/keadaan'
import * as chat from './chat/service'
import {
  DETAK_MS as DETAK_CHAT_MS,
  MAKS_ISI as MAKS_ISI_CHAT,
  MAKS_LAMPIRAN as MAKS_LAMPIRAN_CHAT,
  kunciSenyap
} from './chat/rules'
import { segarkanLencana } from './chat/notifikasi'
import * as grup from './chat/grup'
import { MAKS_ANGGOTA as MAKS_ANGGOTA_GRUP } from './chat/grup-rules'
import { autoStartAktif, setAutoStart } from './tray'
import * as db from './db'
import { modeEfektif } from '../shared/mode-chat'
import {
  berkasBolehDipratinjau,
  sendChat,
  cancelChat,
  cancelSessionRuns,
  resolveApproval,
  resolveCredential
} from './agent/orchestrator'
import { logger } from './logger'

const SaveSetupSchema = z.object({
  endpoint: z.string().url().max(500),
  modelId: z.string().min(1).max(200),
  // Boleh kosong saat mengubah endpoint/model dari Settings — key tersimpan dipakai ulang.
  apiKey: z.string().max(500)
})

const AttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  kind: z.enum(['image', 'document']),
  size: z.number()
})

const SendChatSchema = z.object({
  sessionId: z.string().uuid().nullable(),
  text: z.string().min(1).max(100_000),
  attachments: z.array(AttachmentSchema).max(10).optional(),
  // WAJIB ADA DI SINI. Zod membuang field yang tidak dideklarasikan, dan karena
  // `mode` dulu tidak terdaftar, mode "Tanya Data Sales" tidak pernah sampai ke
  // agent: system prompt khusus, penguncian toolset, dan guard anti-halu semuanya
  // tidak pernah aktif (terbukti di log: "groups":["sales"] tidak pernah muncul,
  // yang ada selalu ["core","sales"]). Ditemukan 18 Agu 2026.
  mode: z.enum(['general', 'sales', 'masterdata', 'lab', 'onedrive', 'reagent']).optional()
})

const LoginSchema = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX)
})


// Kode divisi selalu hasil `kodeDivisi()`, jadi bentuknya pasti huruf kecil,
// angka, dan garis bawah. Dibatasi di sini supaya nilai asing tidak sampai ke query.
const DivisiKodeSchema = z.string().regex(/^[a-z0-9_]{1,40}$/)

const CreateUserSchema = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
  role: z.enum(ROLE_VALUES),
  divisi: z.array(DivisiKodeSchema).max(30),
  expDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()
})

// Seluruh draf layar Akses Menu, disimpan sekaligus. Role terkunci (Direktur/Super
// Admin) sengaja tidak ada di enum: aksesnya tidak diatur matriks.
// Batas 2.000 = 4 menu × 3 role × ±160 divisi — jauh di atas 19 divisi hari ini.
const SetAksesSchema = z.object({
  perubahan: z
    .array(
      z.object({
        menu: z.enum(MENU_VALUES),
        role: z.enum(['manager', 'spv', 'staff']),
        divisi: DivisiKodeSchema,
        diizinkan: z.boolean()
      })
    )
    .min(1)
    .max(2000)
})

const SetDivisiAktifSchema = z.object({ kode: DivisiKodeSchema, aktif: z.boolean() })

const CreateDivisionSchema = z.object({ nama: z.string().min(1).max(60) })

const SetUserDivisionsSchema = z.object({
  username: z.string().min(1).max(200),
  divisi: z.array(DivisiKodeSchema).max(30)
})

const SetBannedSchema = z.object({
  username: z.string().min(1).max(200),
  banned: z.boolean(),
  reason: z.string().max(500).nullable()
})

const SetExpDateSchema = z.object({
  username: z.string().min(1).max(200),
  // Format ISO tanggal saja. Dikirim apa adanya ke `$1::date`, jadi bentuknya
  // harus dipastikan di sini — bukan diserahkan ke Postgres untuk menebak.
  expDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()
})

const ResetPasswordSchema = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX)
})

/**
 * Masukan user.
 *
 * ⚠️ SETIAP field konteks harus ada di sini. Zod object membuang field yang tidak
 * dideklarasikan TANPA error — dan itu sudah pernah menghabiskan berbulan-bulan
 * di project ini: `mode` yang lupa didaftarkan membuat seluruh mode "Tanya Data
 * Sales" mati diam-diam (system prompt, penguncian toolset, dan guard anti-halu
 * semuanya tidak pernah aktif). Di sini gejalanya akan berupa "laporan masuk tapi
 * kolom konteksnya kosong" — kegagalan diam yang persis sama jenisnya, dan baru
 * ketahuan berminggu-minggu kemudian saat ada yang mencoba menelusuri laporan.
 *
 * Identitas (username/role/divisi/hostname/versi) SENGAJA tidak ada di schema
 * ini: main process mengisinya sendiri dari sesi. Kalau ikut divalidasi di sini,
 * artinya ia diterima dari renderer — dan siapa pun bisa melapor atas nama orang lain.
 */
const ToolActivitySchema = z.object({
  callId: z.string(),
  name: z.string(),
  label: z.string().optional(),
  argsSummary: z.string(),
  tier: z.enum(['read', 'write', 'mutate', 'execute']),
  status: z.enum(['running', 'awaiting_approval', 'ok', 'error', 'denied']),
  resultSummary: z.string().optional(),
  outputPath: z.string().optional()
})

const KirimFeedbackSchema = z.object({
  jenis: z.enum(FEEDBACK_JENIS),
  isi: z.string().min(1).max(MAKS_ISI),
  dampak: z.enum(FEEDBACK_DAMPAK).nullable(),
  sesiId: z.string().max(100).nullable(),
  pesanId: z.string().max(100).nullable(),
  mode: z.enum(['general', 'sales', 'masterdata', 'lab', 'onedrive', 'reagent']).nullable(),
  model: z.string().max(200).nullable(),
  // Batas panjang di sini SENGAJA lebih longgar dari `MAKS_CUPLIKAN`: yang
  // memotong adalah `potongCuplikan` di service, dan potongannya menyertakan
  // keterangan berapa yang dibuang. Kalau Zod yang menolak lebih dulu, user
  // hanya melihat "input tidak valid" tanpa tahu sebabnya panjang jawaban AIRA.
  pertanyaan: z.string().max(200_000).nullable(),
  jawaban: z.string().max(200_000).nullable(),
  toolLog: z.array(ToolActivitySchema).max(100).nullable(),
  sertakanChat: z.boolean(),
  // Aturan 11: field baru WAJIB di sini, kalau tidak lampirannya dibuang diam-diam.
  lampiran: z
    .object({
      nama: z.string().min(1).max(260),
      mime: z.string().min(1).max(200),
      data: z.instanceof(Uint8Array).refine((b) => b.byteLength <= MAKS_LAMPIRAN_MASUKAN)
    })
    .nullable()
    .optional()
})

const SetFeedbackStatusSchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(FEEDBACK_STATUS),
  catatan: z.string().max(2_000).nullable()
})

// Monitoring pemakaian. ⚠️ Setiap field WAJIB terdaftar di sini (aturan 11) —
// Zod membuang field tak dikenal tanpa error, dan filter yang hilang diam-diam
// menampilkan pemakaian SEMUA orang padahal yang diminta satu orang.
const MonitoringFilterSchema = z.object({
  periodeHari: z.union([z.literal(1), z.literal(7), z.literal(30), z.literal(90)]),
  username: z.string().max(100).nullable(),
  mode: z.enum(['general', 'sales', 'masterdata', 'lab', 'onedrive', 'reagent']).nullable(),
  cari: z.string().max(100).nullable()
})

const LinimasaSchema = MonitoringFilterSchema.extend({
  sebelum: z
    .object({ waktu: z.string().datetime(), id: z.number().int().positive() })
    .nullable()
})

/**
 * Jenis berkas yang boleh ditampilkan sebagai pratinjau di chat.
 *
 * Daftar-IZIN, bukan daftar-larangan (pola `KOLOM_AMAN`, §35): format baru yang
 * muncul kelak tidak otomatis ikut dikirim ke renderer sebagai data URL.
 */
const MIME_PRATINJAU: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

/**
 * Batas ukuran pratinjau. Data URL membengkak ~33% dan seluruhnya masuk memori
 * renderer; gambar 1024×1024 dari old-image-model saja sudah 4 MB.
 */
const MAKS_PRATINJAU_BYTE = 12 * 1024 * 1024

export function registerIpcHandlers(): void {
  /**
   * Gerbang untuk semua handler yang hanya boleh dipakai Super Admin.
   *
   * Rolenya dibaca dari sesi di MAIN PROCESS, bukan dari argumen yang dikirim
   * renderer — renderer hanya menentukan apa yang TAMPIL. Menyembunyikan tombol
   * bukan penguncian: siapa pun yang bisa memanggil channel ini langsung akan
   * berhenti di sini, bukan di UI.
   */
  const wajibSuperAdmin = (): auth.SesiUser => {
    const sesi = auth.sesiSekarang()
    if (!sesi || !bolehKelolaUser(sesi.role)) {
      throw new Error('AKSES_DITOLAK: hanya Super Admin yang bisa mengelola user')
    }
    return sesi
  }

  ipcMain.handle(
    IPC_CHANNELS.authState,
    (): AuthState => ({
      ready: auth.authSiap(),
      initialized: auth.authSelesaiInit(),
      session: auth.sesiSekarang()
    })
  )

  ipcMain.handle(IPC_CHANNELS.authLogin, async (_event, raw): Promise<LoginResult> => {
    const parsed = LoginSchema.safeParse(raw)
    // Pesan sengaja sama dengan pesan kredensial salah: panjang password yang
    // tidak lolos schema tidak boleh membocorkan aturan panjang password ke
    // layar login.
    if (!parsed.success) return { ok: false, error: 'Username atau password salah.' }
    const hasil = await auth.login(parsed.data.username, parsed.data.password)
    return { ok: hasil.ok, session: hasil.sesi, error: hasil.error }
  })

  ipcMain.handle(IPC_CHANNELS.authLogout, async (): Promise<boolean> => {
    await auth.logout()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.authUsers, async (): Promise<AuthUserRow[]> => {
    wajibSuperAdmin()
    return auth.daftarUser()
  })

  ipcMain.handle(IPC_CHANNELS.authCreateUser, async (_event, raw): Promise<AuthUserRow[]> => {
    const sesi = wajibSuperAdmin()
    const input = CreateUserSchema.parse(raw)
    return auth.buatUser(
      input.username,
      input.password,
      input.role,
      input.divisi,
      input.expDate,
      sesi.username
    )
  })

  ipcMain.handle(IPC_CHANNELS.authSetUserDivisions, async (_event, raw): Promise<AuthUserRow[]> => {
    const sesi = wajibSuperAdmin()
    const input = SetUserDivisionsSchema.parse(raw)
    return auth.setDivisiUser(input.username, input.divisi, sesi.username)
  })

  ipcMain.handle(IPC_CHANNELS.authSetAkses, async (_event, raw): Promise<AccessConfig> => {
    const sesi = wajibSuperAdmin()
    const input = SetAksesSchema.parse(raw)
    return auth.simpanAkses(input.perubahan, sesi.username)
  })

  ipcMain.handle(IPC_CHANNELS.authSetDivisionActive, async (_event, raw): Promise<AccessConfig> => {
    const sesi = wajibSuperAdmin()
    const input = SetDivisiAktifSchema.parse(raw)
    return auth.setDivisiAktif(input.kode, input.aktif, sesi.username)
  })

  ipcMain.handle(IPC_CHANNELS.authCreateDivision, async (_event, raw): Promise<AccessConfig> => {
    const sesi = wajibSuperAdmin()
    const input = CreateDivisionSchema.parse(raw)
    return auth.buatDivisi(input.nama, sesi.username)
  })

  ipcMain.handle(IPC_CHANNELS.authSetBanned, async (_event, raw): Promise<AuthUserRow[]> => {
    const sesi = wajibSuperAdmin()
    const input = SetBannedSchema.parse(raw)
    return auth.setBanned(input.username, input.banned, input.reason, sesi.username)
  })

  ipcMain.handle(IPC_CHANNELS.authSetExpDate, async (_event, raw): Promise<AuthUserRow[]> => {
    const sesi = wajibSuperAdmin()
    const input = SetExpDateSchema.parse(raw)
    return auth.setExpDate(input.username, input.expDate, sesi.username)
  })

  ipcMain.handle(IPC_CHANNELS.authResetPassword, async (_event, raw): Promise<boolean> => {
    const sesi = wajibSuperAdmin()
    const input = ResetPasswordSchema.parse(raw)
    await auth.resetPassword(input.username, input.password, sesi.username)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.authMatrix, async (): Promise<AccessConfig> => {
    wajibSuperAdmin()
    return auth.bacaKonfigAkses()
  })

  ipcMain.handle(IPC_CHANNELS.authLog, async (_event, raw): Promise<AuthLogRow[]> => {
    wajibSuperAdmin()
    const limit = z.number().int().min(1).max(500).optional().parse(raw) ?? 100
    return auth.riwayatLogin(limit)
  })

  // ------------------------------------------------- masukan & lapor masalah
  //
  // Dua channel pertama terbuka untuk SEMUA role yang sudah login — termasuk
  // Staff. Disengaja: menu ini justru dipakai untuk melaporkan bahwa sesuatu
  // tidak jalan, termasuk "menu saya tidak muncul". Kalau ia sendiri tunduk pada
  // matriks akses, ia akan hilang tepat pada orang yang paling perlu melapor.
  //
  // Yang tetap dijaga: harus sudah login (identitas pelapor tidak boleh kosong),
  // dan daftar yang dikembalikan hanya miliknya sendiri.
  const wajibLogin = (): auth.SesiUser => {
    const sesi = auth.sesiSekarang()
    if (!sesi) throw new Error('AKSES_DITOLAK: harus login dulu')
    return sesi
  }

  // Memori: user melihat dan menghapus apa yang diingat AIRA tentang dirinya.
  // Tidak ada channel "tambah" — memori lahir dari kalimat di chat ("ingat …"),
  // dibaca kode di orchestrator. Menambah pintu kedua lewat form berarti dua
  // jalur yang harus dijaga aturannya (mis. larangan menyimpan angka).
  ipcMain.handle(IPC_CHANNELS.memoriDaftar, async (): Promise<MemoriRow[]> => {
    const sesi = wajibLogin()
    return memori.daftarMemori(sesi.username)
  })

  ipcMain.handle(IPC_CHANNELS.memoriHapus, async (_event, raw): Promise<MemoriRow[]> => {
    const sesi = wajibLogin()
    const id = z.number().int().positive().parse(raw)
    // Username diambil dari sesi, bukan dari renderer — `hapusMemori`
    // memakainya di klausa WHERE supaya id tebakan tidak bisa menghapus
    // memori orang lain.
    return memori.hapusMemori(sesi.username, id)
  })

  ipcMain.handle(IPC_CHANNELS.feedbackKirim, async (_event, raw): Promise<FeedbackRow[]> => {
    const sesi = wajibLogin()
    const input = KirimFeedbackSchema.parse(raw)
    return feedback.kirimFeedback(sesi, input)
  })

  ipcMain.handle(IPC_CHANNELS.feedbackMilikSaya, async (): Promise<FeedbackRow[]> => {
    const sesi = wajibLogin()
    return feedback.feedbackMilikSaya(sesi)
  })

  ipcMain.handle(IPC_CHANNELS.feedbackDaftar, async (_event, raw): Promise<FeedbackRow[]> => {
    wajibSuperAdmin()
    const limit = z.number().int().min(1).max(500).optional().parse(raw) ?? 100
    return feedback.daftarFeedback(limit)
  })

  ipcMain.handle(IPC_CHANNELS.feedbackSetStatus, async (_event, raw): Promise<FeedbackRow[]> => {
    const sesi = wajibSuperAdmin()
    const input = SetFeedbackStatusSchema.parse(raw)
    return feedback.setStatusFeedback(input.id, input.status, input.catatan, sesi.username)
  })

  ipcMain.handle(IPC_CHANNELS.feedbackSimpanLampiran, async (event, raw): Promise<string | null> => {
    const sesi = wajibLogin()
    const id = z.number().int().positive().parse(raw)
    const lampiran = await feedback.ambilLampiranFeedback(sesi, id, bolehKelolaUser(sesi.role))
    if (!lampiran) return null
    const window = BrowserWindow.fromWebContents(event.sender)
    const hasil = window
      ? await dialog.showSaveDialog(window, { defaultPath: basename(lampiran.nama) })
      : await dialog.showSaveDialog({ defaultPath: basename(lampiran.nama) })
    if (hasil.canceled || !hasil.filePath) return null
    writeFileSync(hasil.filePath, lampiran.data)
    return hasil.filePath
  })

  // ------------------------------------------------- auto-update
  //
  // Terbuka untuk semua yang sudah login: setiap orang perlu bisa memasang
  // versi baru di laptopnya sendiri. Tidak ada argumen dari renderer — alamat
  // server tidak pernah bisa diubah dari layar.
  ipcMain.handle(IPC_CHANNELS.updateStatus, (): StatusUpdate => pembaruan.statusUpdate())
  ipcMain.handle(IPC_CHANNELS.updateCek, async (): Promise<StatusUpdate> => {
    wajibLogin()
    return pembaruan.cekSekarang()
  })
  ipcMain.handle(IPC_CHANNELS.updatePasang, (): { ok: boolean; pesan: string } => {
    wajibLogin()
    return pembaruan.pasangSekarang()
  })

  // ------------------------------------------------- monitoring pemakaian
  //
  // Hanya Super Admin (keputusan 16 Sep 2026). Filter username datang dari
  // renderer — itu sah di sini karena yang memanggil sudah pasti Super Admin, dan
  // setiap pembukaan ringkasan tercatat di tb_aktivitas_akses_aira.
  ipcMain.handle(
    IPC_CHANNELS.monitoringRingkasan,
    async (_event, raw): Promise<MonitoringRingkasan> => {
      const sesi = wajibSuperAdmin()
      return monitoring.ringkasan(sesi, MonitoringFilterSchema.parse(raw))
    }
  )

  ipcMain.handle(IPC_CHANNELS.monitoringLinimasa, async (_event, raw): Promise<LinimasaHasil> => {
    wajibSuperAdmin()
    return monitoring.linimasa(LinimasaSchema.parse(raw))
  })

  ipcMain.handle(IPC_CHANNELS.monitoringAntrean, async (): Promise<number> => {
    wajibSuperAdmin()
    // Sekalian didorong terkirim: Super Admin yang membuka layar ini ingin
    // melihat pemakaiannya sendiri barusan, bukan menunggu satu menit.
    await monitoring.kirimAntrean()
    return monitoring.jumlahBelumTerkirim()
  })

  ipcMain.handle(IPC_CHANNELS.setupGet, (): SetupState => {
    const config = loadConfig()
    return { configured: hasSecret('llmApiKey'), endpoint: config.endpoint, modelId: config.modelId }
  })

  ipcMain.handle(IPC_CHANNELS.setupSave, async (_event, raw): Promise<SaveSetupResult> => {
    const parsed = SaveSetupSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: 'Input tidak valid' }
    const { endpoint, modelId } = parsed.data
    const apiKey = parsed.data.apiKey || getSecret('llmApiKey') || ''
    if (apiKey.length < 8) return { ok: false, error: 'API key belum ada — isi API key terlebih dahulu' }

    // Validasi key terhadap gateway SEBELUM disimpan.
    const probe = new OpenAICompatProvider(endpoint, apiKey)
    try {
      const models = await probe.listModels()
      if (!models.includes(modelId)) {
        return { ok: false, error: `Model "${modelId}" tidak tersedia di gateway`, models }
      }
      setSecret('llmApiKey', apiKey)
      saveConfig({ ...loadConfig(), endpoint, modelId })
      db.audit('setup', 'save', `endpoint=${endpoint} model=${modelId}`)
      return { ok: true, models }
    } catch (err: any) {
      logger().warn({ err: String(err) }, 'setup validation failed')
      return { ok: false, error: err?.message ?? 'Gagal terhubung ke gateway' }
    }
  })

  ipcMain.handle(IPC_CHANNELS.llmModels, async (): Promise<string[]> => {
    const provider = buildProvider()
    if (!provider) return []
    try {
      return await provider.listModels()
    } catch {
      return []
    }
  })

  // Riwayat chat milik ORANG, bukan laptop. Ketiga channel di bawah memakai
  // username dari sesi main process — bukan dari argumen renderer, dan bukan
  // sekadar menyaring apa yang tampil di sidebar.
  //
  // ⚠️ Menyaring daftar saja TIDAK cukup: `sessionsMessages` menerima id apa pun
  // yang dikirim, dan id sesi orang lain tetap sah bentuknya. Karena itu
  // kepemilikannya diperiksa ulang sebelum isi dibuka maupun dihapus.
  ipcMain.handle(IPC_CHANNELS.sessionsList, () => {
    const sesi = auth.sesiSekarang()
    return sesi ? db.listSessions(sesi.username) : []
  })

  ipcMain.handle(IPC_CHANNELS.sessionsMessages, (_event, sessionId) => {
    const sesi = wajibLogin()
    const id = z.string().uuid().parse(sessionId)
    if (!db.sessionMilik(id, sesi.username)) {
      db.audit('session', 'akses_ditolak', `session=${id} oleh=${sesi.username}`)
      logger().warn({ session: id, user: sesi.username }, 'percobaan membuka sesi milik orang lain')
      throw new Error('AKSES_DITOLAK: percakapan ini bukan milikmu')
    }
    return db.listMessages(id)
  })

  ipcMain.handle(IPC_CHANNELS.sessionsDelete, (_event, sessionId) => {
    const sesi = wajibLogin()
    const id = z.string().uuid().parse(sessionId)
    if (!db.sessionMilik(id, sesi.username)) {
      throw new Error('AKSES_DITOLAK: percakapan ini bukan milikmu')
    }
    // Hentikan dulu run yang masih berjalan di sesi ini — kalau tidak, run yatim
    // tetap jalan dan event penutupnya menyusul mengacaukan percakapan berikutnya.
    const dibatalkan = cancelSessionRuns(id)
    db.deleteSession(id)
    // Ruang uji ikut dibuang bersama percakapannya. Isinya bisa memuat potongan
    // kode kerja user, dan tidak ada gunanya bertahan setelah percakapannya
    // hilang — sama alasannya dengan membuang cache memori saat logout.
    hapusRuangUji(id)
    lupakanIzinJaringan(id)
    db.audit('session', 'delete', `session=${id} run_dibatalkan=${dibatalkan}`)
    return db.listSessions(sesi.username)
  })

  ipcMain.handle(IPC_CHANNELS.chatSend, async (event, raw) => {
    const input = SendChatSchema.parse(raw)

    // Penguncian akses menu ditegakkan DI SINI, bukan dengan menyembunyikan tombol
    // di sidebar. Tombol yang tidak tampil hanya berarti user tidak melihat jalan
    // masuknya — sesi lama yang masih terbuka, atau `mode` yang dikirim dari
    // renderer, tetap bisa membawa mode terlarang sampai ke agent. Polanya sama
    // dengan `applyErpScope`/`applyBasisRule`: keputusan diambil di kode, dari
    // keadaan yang dipegang main process, bukan dari apa yang dikirim pemanggil.
    const sesi = auth.sesiSekarang()
    if (!sesi) throw new Error('BELUM_LOGIN')
    // ⚠️ Mode yang DIPERIKSA = mode yang akan DIPAKAI `sendChat`: untuk percakapan
    // yang sudah ada itu mode tersimpannya (aturan 31), bukan kiriman renderer.
    // Tanpa ini, percakapan TAT/Microsoft 365 lama yang dibuka saat renderer
    // mengirim "general" lolos pemeriksaan untuk mode yang salah (13 Okt 2026).
    const mode = modeEfektif(input.sessionId ? db.sessionMode(input.sessionId) : null, input.mode)
    if (!auth.bolehModeSekarang(mode)) {
      db.audit('auth', 'mode_ditolak', `user=${sesi.username} role=${sesi.role} mode=${mode}`)
      logger().warn({ user: sesi.username, role: sesi.role, mode }, 'mode ditolak: role tidak berizin')
      throw new Error(`AKSES_DITOLAK: role ${sesi.role} tidak berizin membuka mode "${mode}"`)
    }

    const provider = buildProvider()
    if (!provider) throw new Error('NOT_CONFIGURED')
    const sender = BrowserWindow.fromWebContents(event.sender)?.webContents ?? event.sender
    return sendChat(provider, sender, input)
  })

  ipcMain.handle(IPC_CHANNELS.modelChoiceSet, (_event, raw): ModelChoice => {
    const choice = z.enum(['auto', 'chat', 'agent', 'coder']).parse(raw)
    saveConfig({ ...loadConfig(), modelChoice: choice })
    return choice
  })

  ipcMain.handle(IPC_CHANNELS.modelChoiceGet, (): ModelChoice => loadConfig().modelChoice)

  /**
   * "Coba lagi" — mengulang giliran terakhir yang gagal.
   *
   * Giliran yang gagal DIBUANG lebih dulu, bukan ditinggalkan: kalau tidak,
   * riwayat memuat jawaban setengah jadi yang ikut terkirim ke model pada
   * giliran berikutnya, dan pertanyaan yang sama tampil dua kali di layar.
   *
   * ⚠️ Kepemilikan diperiksa ulang di sini, bukan dipercayakan ke sidebar
   * (aturan 16): handler ini menerima sessionId apa pun yang dikirim renderer.
   * Tanpa pemeriksaan, siapa pun yang tahu sebuah id bisa MENGHAPUS giliran
   * terakhir percakapan orang lain — kerusakan, bukan cuma kebocoran.
   *
   * `mode` sengaja TIDAK dikirim: untuk sesi yang sudah ada, mode TERSIMPAN
   * yang menang di `sendChat`, jadi mengulang tidak bisa memindahkan
   * percakapan ke menu lain.
   */
  ipcMain.handle(IPC_CHANNELS.chatRetry, async (event, raw) => {
    const sesi = wajibLogin()
    const sessionId = z.string().uuid().parse(raw)
    if (!db.sessionMilik(sessionId, sesi.username)) {
      throw new Error('AKSES_DITOLAK: percakapan ini bukan milikmu')
    }
    // Izin menu diperiksa untuk mode percakapan ini SEBELUM giliran lama dibuang —
    // sama dengan `chatSend`. Kalau tidak, menu yang sudah dicabut tetap bisa
    // "dicoba lagi", dan giliran yang gagal terbuang sebelum penolakannya muncul.
    const mode = modeEfektif(db.sessionMode(sessionId), undefined)
    if (!auth.bolehModeSekarang(mode)) {
      db.audit('auth', 'mode_ditolak', `user=${sesi.username} role=${sesi.role} mode=${mode} (coba lagi)`)
      throw new Error(`AKSES_DITOLAK: role ${sesi.role} tidak berizin membuka mode "${mode}"`)
    }
    // Run yang mungkin masih hidup di sesi ini dihentikan dulu — kalau tidak,
    // run lama menulis ke pesan yang barusan dihapus.
    cancelSessionRuns(sessionId)
    const teks = db.buangGiliranTerakhir(sessionId)
    if (!teks) throw new Error('Tidak ada pertanyaan yang bisa diulang di percakapan ini.')

    const provider = buildProvider()
    if (!provider) throw new Error('NOT_CONFIGURED')
    const sender = BrowserWindow.fromWebContents(event.sender)?.webContents ?? event.sender
    db.audit('session', 'retry', `session=${sessionId}`)
    logger().info({ sessionId }, 'giliran terakhir diulang')
    return sendChat(provider, sender, { sessionId, text: teks, attachments: [] })
  })

  ipcMain.handle(IPC_CHANNELS.chatCancel, (_event, messageId) => {
    const id = z.string().uuid().parse(messageId)
    return cancelChat(id)
  })

  ipcMain.handle(IPC_CHANNELS.agentApprove, (_event, raw) => {
    const input = z.object({ requestId: z.string().uuid(), approved: z.boolean() }).parse(raw)
    const resolved = resolveApproval(input.requestId, input.approved)
    db.audit('approval', input.approved ? 'granted' : 'denied', `request=${input.requestId}`)
    return resolved
  })

  ipcMain.handle(IPC_CHANNELS.workspaceList, () => loadConfig().allowedDirs)

  ipcMain.handle(IPC_CHANNELS.workspaceAdd, async (event): Promise<string[]> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = window
      ? await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    const config = loadConfig()
    if (!result.canceled && result.filePaths[0]) {
      const dir = result.filePaths[0]
      if (!config.allowedDirs.includes(dir)) {
        config.allowedDirs.push(dir)
        saveConfig(config)
        db.audit('workspace', 'add', dir)
        triggerAutoIndex('workspace_add')
      }
    }
    return config.allowedDirs
  })

  ipcMain.handle(IPC_CHANNELS.workspaceRemove, (_event, raw): string[] => {
    const dir = z.string().min(1).parse(raw)
    const config = loadConfig()
    config.allowedDirs = config.allowedDirs.filter((d) => d !== dir)
    saveConfig(config)
    db.audit('workspace', 'remove', dir)
    return config.allowedDirs
  })

  const stageAll = (paths: string[]): Attachment[] => {
    const staged: Attachment[] = []
    for (const source of paths.slice(0, 10)) {
      try {
        staged.push(stageFile(source))
      } catch (err) {
        logger().warn({ source, err: String(err) }, 'gagal melampirkan file')
      }
    }
    if (staged.length > 0) db.audit('attachment', 'add', `count=${staged.length}`)
    return staged
  }

  // Membuka file/folder hanya diizinkan di dalam folder akses user — mencegah
  // path sembarangan dari hasil tool membuka lokasi mana pun di sistem.
  const safePath = (raw: unknown): string => {
    const target = z.string().min(1).max(1000).parse(raw)
    resolveInBoundary(target, effectiveAllowedDirs())
    return target
  }

  ipcMain.handle(IPC_CHANNELS.revealFile, (_event, raw): boolean => {
    shell.showItemInFolder(safePath(raw))
    return true
  })

  ipcMain.handle(IPC_CHANNELS.openFile, async (_event, raw): Promise<string> => {
    return shell.openPath(safePath(raw))
  })

  /**
   * Isi gambar untuk PRATINJAU di gelembung chat (data URL).
   *
   * ⚠️ Path divalidasi ULANG terhadap folder akses lewat `resolveInBoundary` —
   * renderer boleh mengirim path apa pun, dan tanpa itu channel ini jadi cara
   * membaca berkas mana pun di komputer dari layar chat.
   *
   * ⚠️ Mengembalikan `null` (bukan error) untuk berkas yang tidak layak
   * ditampilkan: yang gagal cuma pratinjaunya, sedangkan tombol "buka file" di
   * chip tool tetap bekerja.
   */
  ipcMain.handle(IPC_CHANNELS.fileGambar, (_event, raw): string | null => {
    const diminta = z.string().max(4_000).parse(raw)
    try {
      // ⚠️ Daftar-IZIN berkas hasil tool, BUKAN `resolveInBoundary`. Alasannya
      // terukur (lihat `berkasBolehDipratinjau` di orchestrator): di path yang
      // diredireksi, pemeriksaan realpath menolak berkas yang ditulis AIRA
      // sendiri, dan pratinjaunya tidak pernah muncul.
      if (!berkasBolehDipratinjau(diminta) && !db.pathAdaDiRiwayat(diminta)) {
        logger().info({ file: diminta }, 'pratinjau ditolak: bukan berkas hasil tool')
        return null
      }
      const ext = diminta.slice(diminta.lastIndexOf('.')).toLowerCase()
      const mime = MIME_PRATINJAU[ext]
      if (!mime) return null
      const ukuran = statSync(diminta).size
      if (ukuran > MAKS_PRATINJAU_BYTE) {
        logger().info({ file: diminta, ukuran }, 'pratinjau gambar dilewati — terlalu besar')
        return null
      }
      return `data:${mime};base64,${readFileSync(diminta).toString('base64')}`
    } catch (err) {
      logger().warn({ file: diminta, err: String(err).slice(0, 200) }, 'pratinjau gambar gagal')
      return null
    }
  })

  // ------------------------------------------------- galeri gambar
  //
  // Semua channel mengambil "siapa saya" dari SESI (`wajibLogin`), tidak pernah
  // dari renderer. Galat aturan (prompt kosong, ukuran asing) dikirim sebagai
  // pesan biasa supaya layar bisa menampilkannya apa adanya.
  const IdGaleri = z.string().uuid()

  ipcMain.handle(IPC_CHANNELS.galeriDaftar, (_event, raw): GaleriHasil => {
    const sesi = wajibLogin()
    const opsi = z
      .object({ sebelum: z.number().int().positive().nullable(), cari: z.string().max(100).nullable() })
      .parse(raw)
    return galeri.daftarDiGaleri(sesi, opsi)
  })

  ipcMain.handle(IPC_CHANNELS.galeriBuat, async (_event, raw): Promise<ItemGaleri[]> => {
    const sesi = wajibLogin()
    const input = z
      .object({ prompt: z.string().max(5_000), ukuran: z.string().max(20), jumlah: z.number().int() })
      .parse(raw)
    return galeri.buatDiGaleri(sesi, input)
  })

  ipcMain.handle(IPC_CHANNELS.galeriUbah, async (_event, raw): Promise<ItemGaleri> => {
    const sesi = wajibLogin()
    const input = z.object({ id: IdGaleri, prompt: z.string().max(5_000) }).parse(raw)
    return galeri.ubahDiGaleri(sesi, input)
  })

  ipcMain.handle(IPC_CHANNELS.galeriPenuh, (_event, raw): string | null => {
    const sesi = wajibLogin()
    return galeri.gambarPenuh(sesi, IdGaleri.parse(raw))
  })

  ipcMain.handle(IPC_CHANNELS.galeriHapus, async (_event, raw): Promise<boolean> => {
    const sesi = wajibLogin()
    return galeri.hapusDiGaleri(sesi, IdGaleri.parse(raw))
  })

  // Tanpa argumen: dialog pilih berkas dibuka di main, renderer tidak mengirim path.
  ipcMain.handle(IPC_CHANNELS.galeriUnggah, async (): Promise<ItemGaleri | null> => {
    return galeri.unggahUntukUbah(wajibLogin())
  })

  ipcMain.handle(IPC_CHANNELS.galeriSimpan, async (_event, raw): Promise<string | null> => {
    const sesi = wajibLogin()
    return galeri.simpanSebagai(sesi, IdGaleri.parse(raw))
  })

  // Hanya yang boleh membuka menu Sales yang boleh tahu keadaan database-nya.
  ipcMain.handle(IPC_CHANNELS.salesStatus, (): StatusKoneksiSales | null => {
    wajibLogin()
    return auth.bolehModeSekarang('sales') ? statusKoneksiSales() : null
  })

  ipcMain.handle(IPC_CHANNELS.labStatus, (): StatusKoneksiSales | null => {
    wajibLogin()
    return auth.bolehModeSekarang('lab') ? statusKoneksiSales() : null
  })

  // Reagent Check. The folder is chosen ONLY through this dialog — the renderer never sends a path.
  const reagentStatusFor = (username: string): ReagentStatus => {
    const folder = reagentFolderFor(username)
    return { folder, months: folder ? availableMonths(folder) : [] }
  }

  ipcMain.handle(IPC_CHANNELS.reagentStatus, (): ReagentStatus | null => {
    const sesi = wajibLogin()
    return auth.bolehModeSekarang('reagent') ? reagentStatusFor(sesi.username) : null
  })

  ipcMain.handle(IPC_CHANNELS.reagentChooseFolder, async (): Promise<ReagentStatus | null> => {
    const sesi = wajibLogin()
    if (!auth.bolehModeSekarang('reagent')) return null
    const win = BrowserWindow.getFocusedWindow()
    const opts = { title: 'Choose the folder with the usage and stock-opname files', properties: ['openDirectory' as const] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (!res.canceled && res.filePaths[0]) setReagentFolder(sesi.username, res.filePaths[0])
    return reagentStatusFor(sesi.username)
  })

  ipcMain.handle(IPC_CHANNELS.reagentRun, async (_event, raw): Promise<ReagentRunResult> => {
    const sesi = wajibLogin()
    if (!auth.bolehModeSekarang('reagent')) return { error: 'This account is not permitted to open Reagent Check.' }
    const folder = reagentFolderFor(sesi.username)
    if (!folder) return { error: 'Choose the folder with the usage and stock-opname files first.' }
    return runReconciliation({ folder, month: ReagentMonth.parse(raw ?? undefined) })
  })

  // Evidence is re-read from the signed-in user's folder for the month asked for — never from another user's run.
  ipcMain.handle(IPC_CHANNELS.reagentEvidence, async (_event, raw): Promise<ReagentEvidenceResult> => {
    const sesi = wajibLogin()
    if (!auth.bolehModeSekarang('reagent')) return { error: 'This account is not permitted to open Reagent Check.' }
    const input = ReagentEvidenceInput.safeParse(raw)
    if (!input.success) return { error: 'Invalid evidence request (finding id and month YYYY-MM).' }
    const folder = reagentFolderFor(sesi.username)
    if (!folder) return { error: 'Choose the folder with the usage and stock-opname files first.' }
    try {
      return { rows: await evidenceRows({ folder, month: input.data.month, findingId: input.data.findingId }) }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.reagentActions, async (_event, raw): Promise<ReagentActionsResult> => {
    const sesi = wajibLogin()
    if (!auth.bolehModeSekarang('reagent')) return { error: 'This account is not permitted to open Reagent Check.' }
    const folder = reagentFolderFor(sesi.username)
    if (!folder) return { error: 'Choose the folder with the usage and stock-opname files first.' }
    const month = ReagentMonth.safeParse(raw ?? undefined)
    if (!month.success) return { error: 'Invalid month (YYYY-MM).' }
    return actions({ folder, month: month.data })
  })

  // AI draft summary (Muse Wonder) of the code-computed actions; the screen labels it as a draft.
  ipcMain.handle(IPC_CHANNELS.reagentSummary, async (_event, raw): Promise<ReagentSummaryResult> => {
    const sesi = wajibLogin()
    if (!auth.bolehModeSekarang('reagent')) return { error: 'This account is not permitted to open Reagent Check.' }
    const folder = reagentFolderFor(sesi.username)
    if (!folder) return { error: 'Choose the folder with the usage and stock-opname files first.' }
    const month = ReagentMonth.safeParse(raw ?? undefined)
    if (!month.success) return { error: 'Invalid month (YYYY-MM).' }
    const a = await actions({ folder, month: month.data })
    if ('error' in a) return a
    const provider = buildProvider()
    if (!provider) return { error: 'No API key is set up for the model.' }
    try {
      const text = await draftSummary(a, async (prompt) => {
        const d = await provider.completeDetail([{ role: 'user', content: prompt }], MUSE.agent, 8000)
        if (d.finishReason === 'length') throw new Error('The summary was cut off — try again.')
        return d.text
      })
      return { text }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Excel export: recomputed from the session's folder + the month asked for; the path comes from a save dialog.
  ipcMain.handle(IPC_CHANNELS.reagentExport, async (event, raw): Promise<ReagentExportResult> => {
    const sesi = wajibLogin()
    if (!auth.bolehModeSekarang('reagent')) return { error: 'This account is not permitted to open Reagent Check.' }
    const input = ReagentExportInput.safeParse(raw)
    if (!input.success) return { error: 'Invalid export request (month YYYY-MM and recount rows).' }
    const folder = reagentFolderFor(sesi.username)
    if (!folder) return { error: 'Choose the folder with the usage and stock-opname files first.' }
    const a = await actions({ folder, month: input.data.month })
    if ('error' in a) return a
    try {
      const buf = await buildActionsWorkbook(a, input.data.recount)
      const win = BrowserWindow.fromWebContents(event.sender)
      const opts = { title: 'Save the reagent actions', defaultPath: `Reagent_Actions_${a.month}.xlsx`, filters: [{ name: 'Excel', extensions: ['xlsx'] }] }
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (res.canceled || !res.filePath) return { cancelled: true }
      writeFileSync(res.filePath, buf)
      return { path: res.filePath }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.innoStatus, (): StatusKoneksiSales | null => {
    wajibLogin()
    return auth.bolehModeSekarang('masterdata') ? statusKoneksiInno() : null
  })

  // Tidak membuka login browser — lihat catatan di m365/status.ts.
  ipcMain.handle(IPC_CHANNELS.driveStatus, async (): Promise<StatusDrive | null> => {
    wajibLogin()
    return auth.bolehModeSekarang('onedrive') ? statusDrive() : null
  })

  // ------------------------------------------------- berkas terbaru (Beranda)
  //
  // Hanya berkas yang DIHASILKAN AIRA di percakapan milik user ini. Berkas yang
  // sudah dihapus/dipindah di luar AIRA tidak ditampilkan — panel ini "terbaru",
  // bukan arsip; arsip lengkap (termasuk yang hilang) milik menu Pustaka kelak.
  const daftarBerkas = (username: string, batas: number): BerkasTerbaru[] =>
    db
      .berkasDiRiwayat(username, batas * 3)
      .filter((b) => {
        try {
          return statSync(b.path).isFile()
        } catch {
          return false
        }
      })
      .slice(0, batas)
      .map((b) => {
        const nama = basename(b.path)
        const titik = nama.lastIndexOf('.')
        return {
          path: b.path,
          nama,
          jenis: titik > 0 ? nama.slice(titik + 1).toLowerCase() : '',
          dibuat: b.dibuat,
          sessionId: b.sessionId,
          judulSesi: b.judul
        }
      })

  ipcMain.handle(IPC_CHANNELS.berkasTerbaru, (_event, raw): BerkasTerbaru[] => {
    const sesi = wajibLogin()
    return daftarBerkas(sesi.username, z.number().int().min(1).max(50).parse(raw))
  })

  // Menu Pustaka: seluruh berkas hasil AIRA milik user ini, termasuk yang hilang.
  ipcMain.handle(IPC_CHANNELS.pustakaDaftar, (): ItemPustaka[] => daftarPustaka(wajibLogin()))
  ipcMain.handle(IPC_CHANNELS.pustakaThumb, (_event, raw): string | null =>
    galeri.thumbMilik(wajibLogin(), z.string().uuid().parse(raw))
  )

  ipcMain.handle(IPC_CHANNELS.berkasBuka, async (_event, raw): Promise<boolean> => {
    const sesi = wajibLogin()
    const input = z.object({ path: z.string().min(1).max(1000), aksi: z.enum(['buka', 'folder']) }).parse(raw)
    // DAFTAR-IZIN: path wajib ada di riwayat berkas milik user ini. Renderer
    // boleh mengirim path apa pun; tanpa ini channel ini membuka berkas mana pun.
    // Gambar yang dibuat di layar Gambar tidak ada di riwayat chat — ia sah bila
    // tercatat di galeri MILIK user ini (menu Pustaka).
    const sah =
      db.berkasDiRiwayat(sesi.username, 500).some((b) => b.path.toLowerCase() === input.path.toLowerCase()) ||
      db.pathDiGaleri(input.path, sesi.username)
    if (!sah) throw new Error('AKSES_DITOLAK: berkas ini bukan hasil AIRA untukmu')
    if (input.aksi === 'folder') {
      shell.showItemInFolder(input.path)
      return true
    }
    return (await shell.openPath(input.path)) === ''
  })

  // ------------------------------------------------- jadwal (tugas terjadwal)
  //
  // Pemilik dari SESI (`wajibLogin`); renderer hanya mengirim id. Galat aturan
  // (JadwalError) dikirim sebagai pesan polos supaya layar bisa menampilkannya.
  const IdJadwal = z.string().uuid()
  const JamSchema = z.string().regex(/^\d{2}:\d{2}$/)
  const PolaSchema = z.discriminatedUnion('jenis', [
    z.object({ jenis: z.literal('sekali'), tanggal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), jam: JamSchema }),
    z.object({ jenis: z.literal('harian'), jam: JamSchema }),
    z.object({ jenis: z.literal('hari_kerja'), jam: JamSchema }),
    z.object({ jenis: z.literal('mingguan'), hari: z.array(z.number().int()).max(7), jam: JamSchema }),
    z.object({ jenis: z.literal('bulanan'), tanggal: z.number().int(), jam: JamSchema })
  ])
  // ⚠️ Setiap field WAJIB terdaftar (aturan 11) — `mode` yang hilang diam-diam
  // membuat semua tugas berjalan di Task Baru.
  const SimpanJadwalSchema = z.object({
    id: IdJadwal.nullable(),
    jenis: z.enum(['aira', 'pengingat']),
    nama: z.string().max(200),
    prompt: z.string().max(10_000),
    mode: z.enum(['general', 'sales', 'masterdata', 'lab', 'onedrive', 'reagent']),
    pola: PolaSchema
  })
  const pesanJadwal = <T>(fn: () => T): T => {
    try {
      return fn()
    } catch (err) {
      if (err instanceof JadwalError) throw new Error(err.message)
      throw err
    }
  }

  ipcMain.handle(IPC_CHANNELS.jadwalDaftar, (): ItemJadwal[] => jadwal.daftarJadwal(wajibLogin()))
  ipcMain.handle(IPC_CHANNELS.jadwalSimpan, (_event, raw): ItemJadwal[] => {
    const sesi = wajibLogin()
    const input = SimpanJadwalSchema.parse(raw)
    return pesanJadwal(() => jadwal.simpanJadwal(sesi, input))
  })
  ipcMain.handle(IPC_CHANNELS.jadwalHapus, (_event, raw): ItemJadwal[] =>
    jadwal.hapusJadwal(wajibLogin(), IdJadwal.parse(raw))
  )
  ipcMain.handle(IPC_CHANNELS.jadwalSaklar, (_event, raw): ItemJadwal[] => {
    const sesi = wajibLogin()
    const input = z.object({ id: IdJadwal, aktif: z.boolean() }).parse(raw)
    return pesanJadwal(() => jadwal.saklarJadwal(sesi, input.id, input.aktif))
  })
  ipcMain.handle(IPC_CHANNELS.jadwalJalanRentang, (_event, raw): JalanDenganTugas[] => {
    const sesi = wajibLogin()
    const r = z.object({ dari: z.number().int(), sampai: z.number().int() }).parse(raw)
    return jadwal.jalanDalamRentang(sesi, r.dari, r.sampai)
  })
  ipcMain.handle(IPC_CHANNELS.jadwalJalankan, async (_event, raw): Promise<ItemJadwal[]> => {
    const sesi = wajibLogin()
    try {
      return await jadwal.jalankanSekarang(sesi, IdJadwal.parse(raw))
    } catch (err) {
      if (err instanceof JadwalError) throw new Error(err.message)
      throw err
    }
  })

  // ------------------------------------------------- pemantau proaktif
  //
  // Siapa & menu apa SELALU dari sesi main process (aturan 18); keluaran sudah disaring
  // ke menu yang diizinkan saat itu di `keadaanPemantau`. Renderer hanya mengirim id
  // pemicu, dan id itu divalidasi terhadap daftar yang sama dengan main (aturan 11).
  ipcMain.handle(IPC_CHANNELS.pemantauStatus, (): KeadaanPemantau => {
    wajibLogin()
    return pemantau.keadaanPemantau()
  })
  ipcMain.handle(IPC_CHANNELS.pemantauSetel, (_event, raw): KeadaanPemantau => {
    wajibLogin()
    const input = z.object({ id: z.enum(PEMICU_PEMANTAU), aktif: z.boolean() }).parse(raw)
    return pemantau.setelPemicu(input.id, input.aktif)
  })
  ipcMain.handle(IPC_CHANNELS.pemantauPeriksa, async (): Promise<KeadaanPemantau> => {
    wajibLogin()
    return pemantau.periksaSekarang()
  })

  ipcMain.handle(IPC_CHANNELS.clipboardWrite, (_event, raw): boolean => {
    const text = z.string().max(2_000_000).parse(raw)
    clipboard.writeText(text)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.notifyTest, (): boolean =>
    notify({
      title: '🔔 Notifikasi AIRA aktif',
      body: 'Kalau kamu melihat pesan ini, notifikasi bekerja dengan benar.',
      force: true
    })
  )

  ipcMain.handle(IPC_CHANNELS.credentialsSubmit, (_event, raw): boolean => {
    const input = z
      .object({
        requestId: z.string().uuid(),
        value: z
          .object({
            username: z.string().min(1).max(200),
            password: z.string().min(1).max(300),
            remember: z.boolean()
          })
          .nullable()
      })
      .parse(raw)
    return resolveCredential(input.requestId, input.value)
  })

  ipcMain.handle(IPC_CHANNELS.attachmentsPick, async (event): Promise<Attachment[]> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = { properties: ['openFile', 'multiSelections'] as const }
    const result = window
      ? await dialog.showOpenDialog(window, { properties: [...options.properties] })
      : await dialog.showOpenDialog({ properties: [...options.properties] })
    if (result.canceled) return []
    return stageAll(result.filePaths)
  })

  ipcMain.handle(IPC_CHANNELS.attachmentsAdd, (_event, raw): Attachment[] => {
    const paths = z.array(z.string().min(1)).max(10).parse(raw)
    return stageAll(paths)
  })

  // --- Panduan pemakaian -----------------------------------------------------
  // ⚠️ Tidak menerima argumen apa pun, dan itu disengaja. Isi panduan ditentukan
  // `izinMenu` SESI + saklar fitur di main process. Kalau renderer boleh mengirim
  // izin atau daftar menu, layar Panduan bisa mengajari orang memakai menu yang
  // tidak boleh ia buka — lengkap dengan contoh pertanyaan siap klik.
  ipcMain.handle(IPC_CHANNELS.panduanIsi, (): PanduanBagian[] => {
    wajibLogin()
    return panduanSekarang()
  })

  // --- Suara (voice input) ---------------------------------------------------
  // Voice MASUK saja: hasilnya mendarat di kotak chat untuk DIKOREKSI user,
  // tidak pernah dikirim otomatis. Lihat HANDOFF §10 no. 8.

  ipcMain.handle(IPC_CHANNELS.suaraTersedia, (): boolean => {
    wajibLogin()
    return suaraTersedia()
  })

  ipcMain.handle(IPC_CHANNELS.suaraTranskrip, async (_event, raw): Promise<HasilTranskripIpc> => {
    // Login diwajibkan seperti channel lain: transkripsi memakai CPU laptop,
    // dan tidak ada alasan jendela yang belum login bisa memicunya.
    wajibLogin()
    /*
     * ⚠️ Aturan 11 — apa pun yang menyeberang IPC WAJIB divalidasi di sini.
     *
     * Audio datang sebagai Uint8Array. Batas atas dihitung dari batas rekaman:
     * 60 detik × 16.000 sample × 2 byte ≈ 1,92 MB. Diberi kelonggaran jadi 4 MB
     * supaya header dan pembulatan tidak menolak rekaman yang sah, tapi tetap
     * ada batasnya — tanpa batas, renderer yang keliru bisa mengirim ratusan MB
     * ke main process dan membekukan aplikasi.
     *
     * Bentuk WAV-nya sendiri (16 kHz, mono, 16-bit) diperiksa `periksaWav` di
     * dalam `transkripsikan`, bukan di sini: satu definisi, dan ia ikut terpakai
     * bila kelak ada pemanggil lain.
     */
    const wav = z
      .instanceof(Uint8Array)
      .refine((b) => b.byteLength <= 4_000_000, 'rekaman terlalu besar')
      .parse(raw)
    return transkripsikan(wav)
  })

  /*
   * Detak kehadiran, dijalankan MAIN PROCESS — bukan renderer.
   *
   * ⚠️ Sengaja bukan timer di React. Renderer bisa dimuat ulang, jendelanya bisa
   * disembunyikan, dan komponennya bisa ter-unmount saat user pindah layar —
   * ketiganya membuat orang tampak offline padahal aplikasinya terbuka. Status
   * kehadiran adalah fakta tentang APLIKASI, jadi tempatnya di proses aplikasi.
   *
   * Timer ini juga memeriksa sesi tiap putaran: begitu user logout, detaknya
   * berhenti sendiri tanpa perlu ada yang mematikannya.
   */
  setInterval(() => {
    const sesi = auth.sesiSekarang()
    if (!sesi) return
    void chat.detak(sesi.username, hostname()).catch((e) => {
      // Sengaja hanya dicatat: kegagalan detak TIDAK boleh mengganggu pemakaian
      // AIRA. Paling buruk, titik hijau orang ini telat muncul.
      logger().debug({ err: String(e) }, 'detak kehadiran gagal')
    })
  }, DETAK_CHAT_MS).unref()

  // --- Chat antar pengguna ---------------------------------------------------
  /*
   * ⚠️ Pola yang WAJIB dipegang seluruh handler di bawah: "siapa saya" datang dari
   * `wajibLogin()` (sesi main process), TIDAK PERNAH dari argumen renderer. Renderer
   * boleh mengirim nama siapa pun; yang menahan adalah `sesi.username` yang
   * diteruskan ke klausa WHERE di `chat/service.ts`.
   *
   * Ini pelajaran §16 dan §32 yang sudah dibayar dua kali: menyaring daftar di layar
   * tidak pernah cukup, karena handler menerima id/nama apa pun yang dikirim.
   */

  ipcMain.handle(IPC_CHANNELS.chatRekan, async (): Promise<RekanChat[]> => {
    const sesi = wajibLogin()
    return chat.daftarRekan(sesi.username)
  })

  ipcMain.handle(IPC_CHANNELS.chatPercakapan, async (_event, raw): Promise<PesanChatIpc[]> => {
    const sesi = wajibLogin()
    const lawan = z.string().min(1).max(200).parse(raw)
    return chat.ambilPercakapan(sesi.username, lawan)
  })

  ipcMain.handle(IPC_CHANNELS.chatKirim, async (_event, raw): Promise<PesanChatIpc> => {
    const sesi = wajibLogin()
    const input = z
      .object({
        ke: z.string().min(1).max(200),
        isi: z.string().max(MAKS_ISI_CHAT),
        lampiran: z
          .object({
            nama: z.string().min(1).max(255),
            mime: z.string().min(1).max(200),
            // Batas juga ditegakkan `periksaLampiran` di service; di sini supaya
            // muatan raksasa ditolak SEBELUM disalin ke memori main process.
            data: z.instanceof(Uint8Array).refine((b) => b.byteLength <= MAKS_LAMPIRAN_CHAT)
          })
          .optional()
      })
      .parse(raw)
    return chat.kirimPesan(sesi.username, input.ke, input.isi, input.lampiran)
  })

  ipcMain.handle(IPC_CHANNELS.chatTandaiDibaca, async (_event, raw): Promise<number> => {
    const sesi = wajibLogin()
    const lawan = z.string().min(1).max(200).parse(raw)
    const n = await chat.tandaiDibaca(sesi.username, lawan)
    // Lencana taskbar diturunkan SEKARANG, bukan pada putaran 10 detik
    // berikutnya. Angka yang tertinggal membuat orang mencari pesan yang sudah
    // dibacanya, lalu menyimpulkan lencananya tidak bisa dipercaya.
    if (n > 0) segarkanLencana()
    return n
  })

  /**
   * Menghapus pesan sendiri.
   *
   * ⚠️ `sesi.username` yang diteruskan ke klausa WHERE — renderer TIDAK pernah
   * mengirim "siapa saya". Ini handler yang MENGHAPUS, jadi berlaku aturan §32:
   * tanpa pemeriksaan kepemilikan di main process, siapa pun yang menebak sebuah
   * id bisa membuang pesan orang lain. Kerusakan, bukan sekadar kebocoran.
   */
  ipcMain.handle(IPC_CHANNELS.chatHapusPesan, async (_event, raw): Promise<boolean> => {
    const sesi = wajibLogin()
    const pesanId = z.string().regex(/^\d{1,19}$/).parse(raw)
    const ok = await chat.hapusPesan(sesi.username, pesanId)
    // Dicatat di audit, bukan hanya di log aplikasi: SOUL.md menjanjikan
    // "harus bisa dijawab: AIRA melakukan apa kemarin". Yang dicatat tindakannya
    // — siapa menghapus pesan mana — BUKAN isi pesannya.
    db.audit('chat', ok ? 'pesan_dihapus' : 'pesan_hapus_ditolak', `id=${pesanId}`)
    // Pesan yang dihapus tidak lagi dihitung "belum dibaca" di sisi penerima,
    // jadi lencananya harus ikut turun sekarang.
    if (ok) segarkanLencana()
    return ok
  })

  // --- Grup chat --------------------------------------------------------------
  /*
   * ⚠️ Tidak satu pun handler di bawah menerima "siapa saya" atau "saya admin".
   * `sesi.username` diteruskan ke klausa WHERE di `chat/grup.ts`, dan DI SANALAH
   * diputuskan apakah ia anggota / admin. Renderer hanya memilih tombol mana yang
   * TAMPIL. Diuji ke database sungguhan: `npx tsx tests/grup-live-check.ts`.
   */
  const GrupIdSchema = z.string().regex(/^\d{1,19}$/)
  const UsernameSchema = z.string().min(1).max(200)
  const LampiranSchema = z
    .object({
      nama: z.string().min(1).max(255),
      mime: z.string().min(1).max(200),
      data: z.instanceof(Uint8Array).refine((b) => b.byteLength <= MAKS_LAMPIRAN_CHAT)
    })
    .optional()

  ipcMain.handle(IPC_CHANNELS.chatGrupDaftar, async (): Promise<GrupRingkas[]> => {
    const sesi = wajibLogin()
    return grup.daftarGrup(sesi.username)
  })

  ipcMain.handle(IPC_CHANNELS.chatGrupBuat, async (_event, raw): Promise<string> => {
    const sesi = wajibLogin()
    const input = z
      .object({
        nama: z.string().max(200),
        anggota: z.array(UsernameSchema).min(1).max(MAKS_ANGGOTA_GRUP)
      })
      .parse(raw)
    const id = await grup.buatGrup(sesi.username, input.nama, input.anggota)
    db.audit('chat', 'grup_dibuat', `grup=${id} anggota=${input.anggota.length}`)
    return id
  })

  ipcMain.handle(IPC_CHANNELS.chatGrupPesan, async (_event, raw): Promise<PesanChatIpc[]> => {
    const sesi = wajibLogin()
    return grup.pesanGrup(sesi.username, GrupIdSchema.parse(raw))
  })

  ipcMain.handle(IPC_CHANNELS.chatGrupKirim, async (_event, raw): Promise<PesanChatIpc> => {
    const sesi = wajibLogin()
    const input = z
      .object({ grupId: GrupIdSchema, isi: z.string().max(MAKS_ISI_CHAT), lampiran: LampiranSchema })
      .parse(raw)
    return grup.kirimGrup(sesi.username, input.grupId, input.isi, input.lampiran)
  })

  ipcMain.handle(IPC_CHANNELS.chatGrupTandaiDibaca, async (_event, raw): Promise<boolean> => {
    const sesi = wajibLogin()
    const ok = await grup.tandaiDibacaGrup(sesi.username, GrupIdSchema.parse(raw))
    if (ok) segarkanLencana()
    return ok
  })

  ipcMain.handle(IPC_CHANNELS.chatGrupInfo, async (_event, raw): Promise<InfoGrup> => {
    const sesi = wajibLogin()
    return grup.infoGrup(sesi.username, GrupIdSchema.parse(raw))
  })

  ipcMain.handle(IPC_CHANNELS.chatGrupTambah, async (_event, raw): Promise<string[]> => {
    const sesi = wajibLogin()
    const input = z
      .object({ grupId: GrupIdSchema, anggota: z.array(UsernameSchema).min(1).max(MAKS_ANGGOTA_GRUP) })
      .parse(raw)
    const ditambah = await grup.tambahAnggota(sesi.username, input.grupId, input.anggota)
    // Yang dicatat tindakannya dan siapa sasarannya — keanggotaan grup adalah
    // hal yang kelak akan ditanyakan ("sejak kapan dia bisa membaca ini?").
    db.audit('chat', 'grup_tambah', `grup=${input.grupId} anggota=${ditambah.join('|')}`)
    return ditambah
  })

  ipcMain.handle(IPC_CHANNELS.chatGrupKeluarkan, async (_event, raw): Promise<boolean> => {
    const sesi = wajibLogin()
    const input = z.object({ grupId: GrupIdSchema, username: UsernameSchema }).parse(raw)
    await grup.keluarkanAnggota(sesi.username, input.grupId, input.username)
    db.audit('chat', 'grup_keluarkan', `grup=${input.grupId} anggota=${input.username}`)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.chatGrupAturAdmin, async (_event, raw): Promise<boolean> => {
    const sesi = wajibLogin()
    const input = z
      .object({ grupId: GrupIdSchema, username: UsernameSchema, admin: z.boolean() })
      .parse(raw)
    await grup.aturAdmin(sesi.username, input.grupId, input.username, input.admin)
    db.audit('chat', input.admin ? 'grup_jadi_admin' : 'grup_lepas_admin', `grup=${input.grupId} anggota=${input.username}`)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.chatGrupGantiNama, async (_event, raw): Promise<boolean> => {
    const sesi = wajibLogin()
    const input = z.object({ grupId: GrupIdSchema, nama: z.string().max(200) }).parse(raw)
    await grup.gantiNamaGrup(sesi.username, input.grupId, input.nama)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.chatGrupKeluar, async (_event, raw): Promise<boolean> => {
    const sesi = wajibLogin()
    const grupId = GrupIdSchema.parse(raw)
    await grup.keluarGrup(sesi.username, grupId)
    db.audit('chat', 'grup_keluar', `grup=${grupId}`)
    segarkanLencana()
    return true
  })

  // --- Senyap per percakapan -------------------------------------------------
  /*
   * ⚠️ Daftar senyap dikunci per USERNAME dari sesi, bukan satu daftar untuk
   * seluruh laptop. Satu laptop dipakai bergantian; tanpa kunci ini orang
   * berikutnya mewarisi daftar senyap orang sebelumnya diam-diam, dan pesan yang
   * ia tunggu tidak pernah berbunyi tanpa sebab yang terlihat (pola §16).
   */
  ipcMain.handle(IPC_CHANNELS.chatSenyapDaftar, async (): Promise<string[]> => {
    const sesi = wajibLogin()
    return loadConfig().chatSenyap[kunciSenyap(sesi.username)] ?? []
  })

  ipcMain.handle(IPC_CHANNELS.chatSenyapSetel, async (_event, raw): Promise<string[]> => {
    const sesi = wajibLogin()
    const input = z
      .object({ lawan: z.string().min(1).max(200), senyap: z.boolean() })
      .parse(raw)
    const config = loadConfig()
    const kunci = kunciSenyap(sesi.username)
    const sekarang = config.chatSenyap[kunci] ?? []
    const tanpa = sekarang.filter((x) => x.toLowerCase() !== input.lawan.toLowerCase())
    const baru = input.senyap ? [...tanpa, input.lawan.toLowerCase()] : tanpa
    config.chatSenyap = { ...config.chatSenyap, [kunci]: baru }
    saveConfig(config)
    logger().info({ lawan: input.lawan, senyap: input.senyap }, 'senyap chat diubah')
    return baru
  })

  // --- Setelan notifikasi & autostart ----------------------------------------
  ipcMain.handle(IPC_CHANNELS.chatSetelan, async (): Promise<SetelanChat> => {
    wajibLogin()
    const config = loadConfig()
    return {
      pratinjau: config.chatPratinjau,
      // ⚠️ Dibaca dari OS, bukan dari config: kalau admin atau Task Manager
      // mematikannya, saklar yang tetap menyala di layar akan berbohong.
      autoStart: autoStartAktif(),
      sudahDitanya: config.autoStartDitanya
    }
  })

  ipcMain.handle(IPC_CHANNELS.chatSetelanSetel, async (_event, raw): Promise<SetelanChat> => {
    wajibLogin()
    const input = z
      .object({
        pratinjau: z.boolean().optional(),
        autoStart: z.boolean().optional(),
        // Dipakai tombol "Nanti" pada tawaran autostart: menandai sudah ditanya
        // tanpa mengubah keadaannya.
        tandaiDitanya: z.boolean().optional()
      })
      .parse(raw)

    if (input.autoStart !== undefined) setAutoStart(input.autoStart)
    if (input.pratinjau !== undefined || input.tandaiDitanya) {
      const config = loadConfig()
      if (input.pratinjau !== undefined) config.chatPratinjau = input.pratinjau
      if (input.tandaiDitanya) config.autoStartDitanya = true
      saveConfig(config)
    }
    const config = loadConfig()
    return {
      pratinjau: config.chatPratinjau,
      autoStart: autoStartAktif(),
      sudahDitanya: config.autoStartDitanya
    }
  })

  /**
   * Menyimpan lampiran ke berkas pilihan user.
   *
   * Sengaja lewat dialog Simpan, bukan mengunduh diam-diam ke folder unduhan:
   * berkas yang muncul sendiri di laptop orang adalah kejutan, dan pemilihan
   * tempatnya sekaligus jadi persetujuan bahwa ia memang mau berkas itu.
   */
  ipcMain.handle(IPC_CHANNELS.chatSimpanLampiran, async (event, raw): Promise<string | null> => {
    const sesi = wajibLogin()
    const pesanId = z.string().min(1).max(40).parse(raw)
    const lampiran = await chat.ambilLampiran(sesi.username, pesanId)
    if (!lampiran) return null
    const window = BrowserWindow.fromWebContents(event.sender)
    const hasil = window
      ? await dialog.showSaveDialog(window, { defaultPath: lampiran.nama })
      : await dialog.showSaveDialog({ defaultPath: lampiran.nama })
    if (hasil.canceled || !hasil.filePath) return null
    writeFileSync(hasil.filePath, lampiran.data)
    return hasil.filePath
  })
}
