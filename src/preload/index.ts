import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  ReagentActionsResult,
  ReagentEvidenceResult,
  ReagentExportResult,
  ReagentRunResult,
  ReagentStatus,
  ReagentSummaryResult,
  RecountRow
} from '../shared/reagent'
import {
  IPC_CHANNELS,
  type AccessConfig,
  type AuthSession,
  type CreateDivisionInput,
  type SetUserDivisionsInput,
  type AuthLogRow,
  type AuthState,
  type AuthUserRow,
  type CreateUserInput,
  type LoginInput,
  type LoginResult,
  type SetBannedInput,
  type SetAksesInput,
  type SetDivisiAktifInput,
  type ApproveInput,
  type Attachment,
  type ChatMessage,
  type ChatStreamEvent,
  type FeedbackRow,
  type HasilTranskripIpc,
  type KirimFeedbackInput,
  type LinimasaHasil,
  type LinimasaInput,
  type MonitoringFilter,
  type MonitoringRingkasan,
  type StatusUpdate,
  type GaleriHasil,
  type ItemGaleri,
  type ItemJadwal,
  type JalanDenganTugas,
  type AksiPemantau,
  type KeadaanPemantau,
  type PemicuId,
  type BerkasTerbaru,
  type StatusKoneksiSales,
  type StatusDrive,
  type ItemPustaka,
  type SimpanJadwalInput,
  type KirimPesanInput,
  type PesanChatIpc,
  type RekanChat,
  type MemoriRow,
  type PanduanBagian,
  type SetelanChat,
  type GrupRingkas,
  type InfoGrup,
  type KirimGrupInput,
  type SetFeedbackStatusInput,
  type ModelChoice,
  type SubmitCredentialInput,
  type SaveSetupInput,
  type SaveSetupResult,
  type SendChatInput,
  type SendChatResult,
  type SessionMeta,
  type SetupState
} from '../shared/ipc'

// Satu-satunya jembatan renderer -> main. Tidak ada API lain yang diekspos.
const api = {
  getSetupState: (): Promise<SetupState> => ipcRenderer.invoke(IPC_CHANNELS.setupGet),
  saveSetup: (input: SaveSetupInput): Promise<SaveSetupResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.setupSave, input),
  listModels: (): Promise<string[]> => ipcRenderer.invoke(IPC_CHANNELS.llmModels),
  listSessions: (): Promise<SessionMeta[]> => ipcRenderer.invoke(IPC_CHANNELS.sessionsList),
  getMessages: (sessionId: string): Promise<ChatMessage[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.sessionsMessages, sessionId),
  deleteSession: (sessionId: string): Promise<SessionMeta[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.sessionsDelete, sessionId),
  sendChat: (input: SendChatInput): Promise<SendChatResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.chatSend, input),
  retryChat: (sessionId: string): Promise<SendChatResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.chatRetry, sessionId),
  cancelChat: (messageId: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.chatCancel, messageId),
  approve: (input: ApproveInput): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.agentApprove, input),
  listWorkspace: (): Promise<string[]> => ipcRenderer.invoke(IPC_CHANNELS.workspaceList),
  addWorkspace: (): Promise<string[]> => ipcRenderer.invoke(IPC_CHANNELS.workspaceAdd),
  removeWorkspace: (dir: string): Promise<string[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceRemove, dir),
  // Preload berjalan ber-sandbox, jadi modul `clipboard` TIDAK tersedia di sini —
  // penulisan clipboard harus lewat main process.
  copyText: (text: string): void => {
    void ipcRenderer.invoke(IPC_CHANNELS.clipboardWrite, text)
  },
  pickAttachments: (): Promise<Attachment[]> => ipcRenderer.invoke(IPC_CHANNELS.attachmentsPick),
  addAttachments: (paths: string[]): Promise<Attachment[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.attachmentsAdd, paths),
  // File hasil drag & drop: sejak Electron 32 path hanya bisa lewat webUtils.
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  testNotification: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.notifyTest),
  revealFile: (path: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.revealFile, path),
  openFile: (path: string): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.openFile, path),
  submitCredential: (input: SubmitCredentialInput): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.credentialsSubmit, input),
  getModelChoice: (): Promise<ModelChoice> => ipcRenderer.invoke(IPC_CHANNELS.modelChoiceGet),
  setModelChoice: (choice: ModelChoice): Promise<ModelChoice> =>
    ipcRenderer.invoke(IPC_CHANNELS.modelChoiceSet, choice),
  // --- Login & pengelolaan user -------------------------------------------
  getAuthState: (): Promise<AuthState> => ipcRenderer.invoke(IPC_CHANNELS.authState),
  login: (input: LoginInput): Promise<LoginResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.authLogin, input),
  logout: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.authLogout),
  // Semua yang di bawah ini dijaga main process: rolenya diperiksa dari sesi,
  // bukan dari apa yang dikirim renderer. Dipanggil tanpa hak = error, bukan data.
  listAuthUsers: (): Promise<AuthUserRow[]> => ipcRenderer.invoke(IPC_CHANNELS.authUsers),
  createAuthUser: (input: CreateUserInput): Promise<AuthUserRow[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.authCreateUser, input),
  setUserBanned: (input: SetBannedInput): Promise<AuthUserRow[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.authSetBanned, input),
  setUserExpDate: (input: { username: string; expDate: string | null }): Promise<AuthUserRow[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.authSetExpDate, input),
  resetUserPassword: (input: { username: string; password: string }): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.authResetPassword, input),
  getAccessMatrix: (): Promise<AccessConfig> => ipcRenderer.invoke(IPC_CHANNELS.authMatrix),
  setAkses: (input: SetAksesInput): Promise<AccessConfig> =>
    ipcRenderer.invoke(IPC_CHANNELS.authSetAkses, input),
  setDivisiAktif: (input: SetDivisiAktifInput): Promise<AccessConfig> =>
    ipcRenderer.invoke(IPC_CHANNELS.authSetDivisionActive, input),
  createDivision: (input: CreateDivisionInput): Promise<AccessConfig> =>
    ipcRenderer.invoke(IPC_CHANNELS.authCreateDivision, input),
  setUserDivisions: (input: SetUserDivisionsInput): Promise<AuthUserRow[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.authSetUserDivisions, input),
  getLoginLog: (limit?: number): Promise<AuthLogRow[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.authLog, limit),
  // --- Memori AIRA ----------------------------------------------------------
  // Hanya baca & hapus. Menambah memori dilakukan lewat kalimat di chat.
  listMemori: (): Promise<MemoriRow[]> => ipcRenderer.invoke(IPC_CHANNELS.memoriDaftar),
  hapusMemori: (id: number): Promise<MemoriRow[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.memoriHapus, id),
  // --- Masukan & lapor masalah ---------------------------------------------
  // Dua yang pertama terbuka untuk semua user yang login; dua terakhir dijaga
  // `wajibSuperAdmin` di main process.
  kirimFeedback: (input: KirimFeedbackInput): Promise<FeedbackRow[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.feedbackKirim, input),
  feedbackMilikSaya: (): Promise<FeedbackRow[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.feedbackMilikSaya),
  feedbackSimpanLampiran: (id: number): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.feedbackSimpanLampiran, id),
  listFeedback: (limit?: number): Promise<FeedbackRow[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.feedbackDaftar, limit),
  setFeedbackStatus: (input: SetFeedbackStatusInput): Promise<FeedbackRow[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.feedbackSetStatus, input),
  monitoringRingkasan: (filter: MonitoringFilter): Promise<MonitoringRingkasan> =>
    ipcRenderer.invoke(IPC_CHANNELS.monitoringRingkasan, filter),
  monitoringLinimasa: (input: LinimasaInput): Promise<LinimasaHasil> =>
    ipcRenderer.invoke(IPC_CHANNELS.monitoringLinimasa, input),
  monitoringAntrean: (): Promise<number> => ipcRenderer.invoke(IPC_CHANNELS.monitoringAntrean),
  galeriDaftar: (opsi: { sebelum: number | null; cari: string | null }): Promise<GaleriHasil> =>
    ipcRenderer.invoke(IPC_CHANNELS.galeriDaftar, opsi),
  galeriBuat: (input: { prompt: string; ukuran: string; jumlah: number }): Promise<ItemGaleri[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.galeriBuat, input),
  galeriUbah: (input: { id: string; prompt: string }): Promise<ItemGaleri> =>
    ipcRenderer.invoke(IPC_CHANNELS.galeriUbah, input),
  galeriPenuh: (id: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.galeriPenuh, id),
  galeriHapus: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.galeriHapus, id),
  galeriUnggah: (): Promise<ItemGaleri | null> => ipcRenderer.invoke(IPC_CHANNELS.galeriUnggah),
  galeriSimpan: (id: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.galeriSimpan, id),
  salesStatus: (): Promise<StatusKoneksiSales | null> => ipcRenderer.invoke(IPC_CHANNELS.salesStatus),
  innoStatus: (): Promise<StatusKoneksiSales | null> => ipcRenderer.invoke(IPC_CHANNELS.innoStatus),
  labStatus: (): Promise<StatusKoneksiSales | null> => ipcRenderer.invoke(IPC_CHANNELS.labStatus),
  reagentStatus: (): Promise<ReagentStatus | null> => ipcRenderer.invoke(IPC_CHANNELS.reagentStatus),
  reagentChooseFolder: (): Promise<ReagentStatus | null> => ipcRenderer.invoke(IPC_CHANNELS.reagentChooseFolder),
  reagentRun: (month?: string): Promise<ReagentRunResult> => ipcRenderer.invoke(IPC_CHANNELS.reagentRun, month),
  reagentEvidence: (input: { findingId: string; month?: string }): Promise<ReagentEvidenceResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.reagentEvidence, input),
  reagentActions: (month?: string): Promise<ReagentActionsResult> => ipcRenderer.invoke(IPC_CHANNELS.reagentActions, month),
  reagentSummary: (month?: string): Promise<ReagentSummaryResult> => ipcRenderer.invoke(IPC_CHANNELS.reagentSummary, month),
  /** The save path is chosen in a main-process dialog — the renderer never sends one. */
  reagentExport: (input: { month?: string; recount: RecountRow[] }): Promise<ReagentExportResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.reagentExport, input),
  driveStatus: (): Promise<StatusDrive | null> => ipcRenderer.invoke(IPC_CHANNELS.driveStatus),
  berkasTerbaru: (batas: number): Promise<BerkasTerbaru[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.berkasTerbaru, batas),
  pustakaDaftar: (): Promise<ItemPustaka[]> => ipcRenderer.invoke(IPC_CHANNELS.pustakaDaftar),
  pustakaThumb: (galeriId: string): Promise<string | null> => ipcRenderer.invoke(IPC_CHANNELS.pustakaThumb, galeriId),
  berkasBuka: (path: string, aksi: 'buka' | 'folder'): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.berkasBuka, { path, aksi }),
  // --- Jadwal: pemilik diambil dari sesi di main process ------------------------
  jadwalDaftar: (): Promise<ItemJadwal[]> => ipcRenderer.invoke(IPC_CHANNELS.jadwalDaftar),
  jadwalSimpan: (input: SimpanJadwalInput): Promise<ItemJadwal[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.jadwalSimpan, input),
  jadwalHapus: (id: string): Promise<ItemJadwal[]> => ipcRenderer.invoke(IPC_CHANNELS.jadwalHapus, id),
  jadwalSaklar: (id: string, aktif: boolean): Promise<ItemJadwal[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.jadwalSaklar, { id, aktif }),
  jadwalJalanRentang: (dari: number, sampai: number): Promise<JalanDenganTugas[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.jadwalJalanRentang, { dari, sampai }),
  jadwalJalankan: (id: string): Promise<ItemJadwal[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.jadwalJalankan, id),
  onJadwalBerubah: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on(IPC_CHANNELS.jadwalBerubah, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.jadwalBerubah, handler)
  },
  // --- Pemantau proaktif: siapa & menu apa diambil dari sesi di main process ------
  pemantauStatus: (): Promise<KeadaanPemantau> => ipcRenderer.invoke(IPC_CHANNELS.pemantauStatus),
  pemantauSetel: (id: PemicuId, aktif: boolean): Promise<KeadaanPemantau> =>
    ipcRenderer.invoke(IPC_CHANNELS.pemantauSetel, { id, aktif }),
  pemantauPeriksa: (): Promise<KeadaanPemantau> => ipcRenderer.invoke(IPC_CHANNELS.pemantauPeriksa),
  /** Notifikasi pemantau diklik: buka panel atau menu dengan kotak terisi. */
  onPemantauBuka: (cb: (aksi: AksiPemantau) => void): (() => void) => {
    const handler = (_e: unknown, aksi: AksiPemantau): void => cb(aksi)
    ipcRenderer.on(IPC_CHANNELS.pemantauBuka, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.pemantauBuka, handler)
  },
  onPemantauBerubah: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on(IPC_CHANNELS.pemantauBerubah, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.pemantauBerubah, handler)
  },
  gambarDataUrl: (path: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.fileGambar, path),
  updateStatus: (): Promise<StatusUpdate> => ipcRenderer.invoke(IPC_CHANNELS.updateStatus),
  updateCek: (): Promise<StatusUpdate> => ipcRenderer.invoke(IPC_CHANNELS.updateCek),
  updatePasang: (): Promise<{ ok: boolean; pesan: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.updatePasang),
  onUpdateBerubah: (callback: (s: StatusUpdate) => void): (() => void) => {
    const listener = (_e: unknown, s: StatusUpdate): void => callback(s)
    ipcRenderer.on(IPC_CHANNELS.updateBerubah, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.updateBerubah, listener)
  },
  /** Menghapus pesan sendiri. Kepemilikan diperiksa ULANG di main process. */
  chatHapusPesan: (pesanId: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.chatHapusPesan, pesanId),
  // --- Grup chat ---------------------------------------------------------------
  // ⚠️ Tidak ada fungsi yang menerima "siapa saya" atau "saya admin". Main process
  // memutuskan keduanya dari sesi di klausa WHERE.
  chatGrupDaftar: (): Promise<GrupRingkas[]> => ipcRenderer.invoke(IPC_CHANNELS.chatGrupDaftar),
  chatGrupBuat: (nama: string, anggota: string[]): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.chatGrupBuat, { nama, anggota }),
  chatGrupPesan: (grupId: string): Promise<PesanChatIpc[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.chatGrupPesan, grupId),
  chatGrupKirim: (input: KirimGrupInput): Promise<PesanChatIpc> =>
    ipcRenderer.invoke(IPC_CHANNELS.chatGrupKirim, input),
  chatGrupTandaiDibaca: (grupId: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.chatGrupTandaiDibaca, grupId),
  chatGrupInfo: (grupId: string): Promise<InfoGrup> =>
    ipcRenderer.invoke(IPC_CHANNELS.chatGrupInfo, grupId),
  chatGrupTambah: (grupId: string, anggota: string[]): Promise<string[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.chatGrupTambah, { grupId, anggota }),
  chatGrupKeluarkan: (grupId: string, username: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.chatGrupKeluarkan, { grupId, username }),
  chatGrupAturAdmin: (grupId: string, username: string, admin: boolean): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.chatGrupAturAdmin, { grupId, username, admin }),
  chatGrupGantiNama: (grupId: string, nama: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.chatGrupGantiNama, { grupId, nama }),
  chatGrupKeluar: (grupId: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.chatGrupKeluar, grupId),
  // --- Notifikasi chat, senyap & autostart -----------------------------------
  // Daftar senyap dikunci per username DI MAIN PROCESS — renderer tidak pernah
  // mengirim "siapa saya".
  chatSenyapDaftar: (): Promise<string[]> => ipcRenderer.invoke(IPC_CHANNELS.chatSenyapDaftar),
  chatSenyapSetel: (lawan: string, senyap: boolean): Promise<string[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.chatSenyapSetel, { lawan, senyap }),
  chatSetelan: (): Promise<SetelanChat> => ipcRenderer.invoke(IPC_CHANNELS.chatSetelan),
  chatSetelanSetel: (input: {
    pratinjau?: boolean
    autoStart?: boolean
    tandaiDitanya?: boolean
  }): Promise<SetelanChat> => ipcRenderer.invoke(IPC_CHANNELS.chatSetelanSetel, input),
  /** Main process menemukan pesan masuk baru — widget chat menyegarkan diri. */
  onChatPesanBaru: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on(IPC_CHANNELS.chatPesanBaru, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.chatPesanBaru, handler)
  },
  // --- Panduan pemakaian -----------------------------------------------------
  // Tanpa argumen: isinya ditentukan izin menu sesi + saklar fitur di main process.
  panduanIsi: (): Promise<PanduanBagian[]> => ipcRenderer.invoke(IPC_CHANNELS.panduanIsi),
  // --- Suara (voice input) ---------------------------------------------------
  // Hasilnya SELALU masuk kotak chat untuk dikoreksi user, tidak pernah dikirim
  // otomatis: salah dengar satu nama ("ERP") menghasilkan angka salah yang
  // tetap terdengar meyakinkan.
  suaraTersedia: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.suaraTersedia),
  transkripsikanSuara: (wav: Uint8Array): Promise<HasilTranskripIpc> =>
    ipcRenderer.invoke(IPC_CHANNELS.suaraTranskrip, wav),
  // --- Chat antar pengguna ---------------------------------------------------
  // Tidak ada satu pun fungsi di sini yang menerima "siapa saya" — main process
  // mengambilnya dari sesi. Kalau kelak ada yang menambahkan parameter pengirim,
  // saat itulah orang bisa berkirim pesan atas nama orang lain.
  chatRekan: (): Promise<RekanChat[]> => ipcRenderer.invoke(IPC_CHANNELS.chatRekan),
  chatPercakapan: (lawan: string): Promise<PesanChatIpc[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.chatPercakapan, lawan),
  chatKirim: (input: KirimPesanInput): Promise<PesanChatIpc> =>
    ipcRenderer.invoke(IPC_CHANNELS.chatKirim, input),
  chatTandaiDibaca: (lawan: string): Promise<number> =>
    ipcRenderer.invoke(IPC_CHANNELS.chatTandaiDibaca, lawan),
  chatSimpanLampiran: (pesanId: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.chatSimpanLampiran, pesanId),
  onAuthRevoked: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(IPC_CHANNELS.authRevoked, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.authRevoked, listener)
  },
  onAuthSessionChanged: (callback: (session: AuthSession) => void): (() => void) => {
    const listener = (_e: unknown, session: AuthSession): void => callback(session)
    ipcRenderer.on(IPC_CHANNELS.authSessionChanged, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.authSessionChanged, listener)
  },
  onChatEvent: (callback: (event: ChatStreamEvent) => void): (() => void) => {
    const listener = (_e: unknown, event: ChatStreamEvent): void => callback(event)
    ipcRenderer.on(IPC_CHANNELS.chatEvent, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.chatEvent, listener)
  }
}

export type AiraApi = typeof api

contextBridge.exposeInMainWorld('aira', api)
