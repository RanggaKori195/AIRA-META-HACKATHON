import type { Dashboard } from './dashboard'
import type { KartuVisual } from './visual'
import type { NumberCheck } from './number-check'
import type { AgentAction } from './agent-actions'
// Kontrak IPC — satu-satunya sumber kebenaran untuk komunikasi renderer <-> main.
// Dipakai oleh main (validasi), preload (expose), dan renderer (typing).

export const IPC_CHANNELS = {
  setupGet: 'setup:get',
  setupSave: 'setup:save',
  llmModels: 'llm:models',
  sessionsList: 'sessions:list',
  sessionsMessages: 'sessions:messages',
  sessionsDelete: 'sessions:delete',
  chatSend: 'chat:send',
  chatCancel: 'chat:cancel',
  chatRetry: 'chat:retry',
  chatEvent: 'chat:event',
  agentApprove: 'agent:approve',
  workspaceList: 'workspace:list',
  workspaceAdd: 'workspace:add',
  workspaceRemove: 'workspace:remove',
  attachmentsPick: 'attachments:pick',
  attachmentsAdd: 'attachments:add',
  modelChoiceGet: 'model:choiceGet',
  modelChoiceSet: 'model:choiceSet',
  credentialsSubmit: 'credentials:submit',
  notifyTest: 'notify:test',
  clipboardWrite: 'clipboard:write',
  revealFile: 'shell:revealFile',
  openFile: 'shell:openFile',
  authState: 'auth:state',
  authLogin: 'auth:login',
  authLogout: 'auth:logout',
  authUsers: 'auth:users',
  authCreateUser: 'auth:createUser',
  authSetBanned: 'auth:setBanned',
  authSetExpDate: 'auth:setExpDate',
  authResetPassword: 'auth:resetPassword',
  authMatrix: 'auth:matrix',
  /** Satu matriks role × divisi per menu (30 Sep 2026) — menggantikan setMatrix + setDivisionMatrix. */
  authSetAkses: 'auth:setAkses',
  authSetDivisionActive: 'auth:setDivisionActive',
  authCreateDivision: 'auth:createDivision',
  authSetUserDivisions: 'auth:setUserDivisions',
  authLog: 'auth:log',
  /** Sesi dicabut di tengah jalan (diblokir/kedaluwarsa) — renderer harus kembali ke layar login. */
  authRevoked: 'auth:revoked',
  /**
   * Sesi yang sedang berjalan berubah (menu/divisi/role) — dikirim main process.
   * Tanpa ini sidebar memegang daftar menu dari saat login selamanya: menu yang
   * baru dibuka Super Admin tidak muncul, yang dicabut tetap tampil lalu ditolak.
   */
  authSessionChanged: 'auth:sessionChanged',
  memoriDaftar: 'memori:daftar',
  memoriHapus: 'memori:hapus',
  feedbackKirim: 'feedback:kirim',
  feedbackMilikSaya: 'feedback:milikSaya',
  feedbackDaftar: 'feedback:daftar',
  feedbackSetStatus: 'feedback:setStatus',
  /** Unduh lampiran masukan — pemilik masukan atau Super Admin (diperiksa di WHERE). */
  feedbackSimpanLampiran: 'feedback:simpanLampiran',
  /**
   * Isi berkas GAMBAR sebagai data URL, untuk pratinjau di dalam chat.
   *
   * ⚠️ Path-nya divalidasi ULANG di main process terhadap folder akses —
   * renderer boleh mengirim path apa pun, dan tanpa pemeriksaan itu channel ini
   * jadi cara membaca berkas mana pun di komputer lewat layar chat.
   */
  fileGambar: 'file:gambar',
  // --- Galeri gambar (layar "Gambar") -------------------------------------------
  // ⚠️ Semua milik ORANG: main process mengambil "siapa saya" dari sesi, dan
  // kepemilikan diperiksa di klausa WHERE. Renderer hanya mengirim id.
  galeriDaftar: 'galeri:daftar',
  galeriBuat: 'galeri:buat',
  galeriUbah: 'galeri:ubah',
  galeriPenuh: 'galeri:penuh',
  galeriHapus: 'galeri:hapus',
  galeriSimpan: 'galeri:simpan',
  /** Pilih gambar dari komputer (dialog di MAIN) -> salinan PNG di galeri, siap diubah. */
  galeriUnggah: 'galeri:unggah',
  // --- Jadwal (tugas terjadwal) ------------------------------------------------
  // ⚠️ Milik ORANG, sama seperti galeri: pemilik dari sesi, id dari renderer.
  /** Berkas hasil AIRA milik user (panel "File Terbaru" di Beranda). */
  berkasTerbaru: 'berkas:terbaru',
  /** Buka / tampilkan di folder — HANYA berkas yang ada di `berkasTerbaru` user itu. */
  berkasBuka: 'berkas:buka',
  /** Keadaan koneksi database sales TERAKHIR yang teramati (tanpa membuka koneksi baru). */
  salesStatus: 'sales:status',
  /** Keadaan koneksi Master Data TERAKHIR yang teramati (tanpa membuka koneksi baru). */
  innoStatus: 'inno:status',
  /** TAT Sample membaca lewat koneksi SALES (aturan 51) — status koneksi yang sama, izin menu lab. */
  labStatus: 'lab:status',
  /** Reagent Check: folder + available months, choose folder (main dialog), run, evidence rows. */
  reagentStatus: 'reagent:status',
  reagentChooseFolder: 'reagent:choose-folder',
  reagentRun: 'reagent:run',
  reagentEvidence: 'reagent:evidence',
  /** Reorder list + investigation checklist + recount source; AI draft summary; Excel export (main save dialog). */
  reagentActions: 'reagent:actions',
  reagentSummary: 'reagent:summary',
  reagentExport: 'reagent:export',
  /** Morning briefing: code facts (reagent + monitor), worded by Muse Wonder, number-checked. */
  briefingGet: 'briefing:get',
  /** Voice co-worker: the name AIRA calls the signed-in user, and one spoken request → one in-app action. */
  agentNameGet: 'agent:nameGet',
  agentNameSet: 'agent:nameSet',
  agentRoute: 'agent:route',
  /** True when started with Chromium's fake-microphone switches (a test launch) — the mascot shows a warning. */
  voiceTestMic: 'agent:voiceTestMic',
  /** Keadaan sambungan OneDrive + folder utama — TIDAK PERNAH membuka login browser. */
  driveStatus: 'drive:status',
  /** Menu Pustaka: semua berkas hasil AIRA milik user (riwayat chat + galeri), termasuk yang hilang. */
  pustakaDaftar: 'pustaka:daftar',
  /** Thumbnail gambar di Pustaka — id galeri dari renderer, pemilik dari sesi. */
  pustakaThumb: 'pustaka:thumb',
  jadwalDaftar: 'jadwal:daftar',
  jadwalSimpan: 'jadwal:simpan',
  jadwalHapus: 'jadwal:hapus',
  jadwalSaklar: 'jadwal:saklar',
  jadwalJalankan: 'jadwal:jalankan',
  /** Riwayat jalan dalam rentang waktu (kalender & statistik). */
  jadwalJalanRentang: 'jadwal:jalan-rentang',
  /** Event main -> renderer: daftar jadwal berubah (tugas mulai/selesai jalan). */
  jadwalBerubah: 'jadwal:berubah',
  // --- Pemantau proaktif ---------------------------------------------------------
  // ⚠️ Pemilik & izin menu dari SESI; renderer hanya mengirim id pemicu.
  /** Status tiap pemicu + riwayat peringatan milik user (disaring menu yang diizinkan). */
  pemantauStatus: 'pemantau:status',
  /** Saklar "Beri tahu saya" satu pemicu. */
  pemantauSetel: 'pemantau:setel',
  /** Tombol "Periksa sekarang". */
  pemantauPeriksa: 'pemantau:periksa',
  /** Event main -> renderer: notifikasi diklik — buka panel atau menu dengan kotak terisi. */
  pemantauBuka: 'pemantau:buka',
  /** Event main -> renderer: status/riwayat pemantau berubah. */
  pemantauBerubah: 'pemantau:berubah',
  // --- Auto-update -------------------------------------------------------------
  updateStatus: 'update:status',
  updateCek: 'update:cek',
  /** Tutup AIRA, pasang versi yang sudah terunduh, lalu buka lagi. */
  updatePasang: 'update:pasang',
  /** Event main -> renderer setiap status update berubah. */
  updateBerubah: 'update:berubah',
  // --- Monitoring pemakaian (Super Admin) -------------------------------------
  // ⚠️ Role diperiksa ULANG di main process (`wajibSuperAdmin`), dan setiap
  // pembukaan dicatat ke `tb_aktivitas_akses_aira` — pengawasnya ikut terawasi.
  monitoringRingkasan: 'monitoring:ringkasan',
  monitoringLinimasa: 'monitoring:linimasa',
  /** Apakah aktivitas dari laptop ini masih menunggu terkirim. */
  monitoringAntrean: 'monitoring:antrean',
  /** Apakah whisper-cli + model ada di laptop ini. Tombol mikrofon disembunyikan bila tidak. */
  suaraTersedia: 'suara:tersedia',
  /** WAV 16 kHz mono -> teks. Hasilnya masuk kotak chat untuk DIKOREKSI, tidak dikirim. */
  suaraTranskrip: 'suara:transkrip',
  /** AIRA's voice: text → ElevenLabs mp3, made in main (the key never reaches the renderer). */
  speechSynthesize: 'suara:bicara',
  // --- Chat antar pengguna ---------------------------------------------------
  // ⚠️ Semua handler mengambil "siapa saya" dari SESI main process, tidak pernah
  // dari argumen renderer. Lihat main/chat/service.ts.
  chatRekan: 'chatUser:rekan',
  chatKirim: 'chatUser:kirim',
  chatPercakapan: 'chatUser:percakapan',
  chatTandaiDibaca: 'chatUser:tandaiDibaca',
  chatSimpanLampiran: 'chatUser:simpanLampiran',
  /** Hapus pesan sendiri. Kepemilikan diperiksa ULANG di main process. */
  chatHapusPesan: 'chatUser:hapusPesan',
  // --- Grup chat -------------------------------------------------------------
  // ⚠️ Semua izin grup (anggota? admin?) diputuskan di KLAUSA WHERE main process,
  // tidak pernah dari apa yang tampil di layar.
  chatGrupDaftar: 'chatGrup:daftar',
  chatGrupBuat: 'chatGrup:buat',
  chatGrupPesan: 'chatGrup:pesan',
  chatGrupKirim: 'chatGrup:kirim',
  chatGrupTandaiDibaca: 'chatGrup:tandaiDibaca',
  chatGrupInfo: 'chatGrup:info',
  chatGrupTambah: 'chatGrup:tambah',
  chatGrupKeluarkan: 'chatGrup:keluarkan',
  chatGrupAturAdmin: 'chatGrup:aturAdmin',
  chatGrupGantiNama: 'chatGrup:gantiNama',
  chatGrupKeluar: 'chatGrup:keluar',
  /**
   * Main process menemukan pesan masuk baru (event, bukan permintaan).
   *
   * Renderer memakainya untuk menyegarkan widget chat seketika. Tanpa ini,
   * pesannya baru muncul di layar beberapa detik sesudah toast-nya berbunyi —
   * terlihat seperti aplikasi yang lambat.
   */
  chatPesanBaru: 'chatUser:pesanBaru',
  /** Daftar percakapan yang disenyapkan milik user yang sedang login. */
  chatSenyapDaftar: 'chatUser:senyapDaftar',
  /** Menyalakan/mematikan senyap untuk satu lawan bicara. */
  chatSenyapSetel: 'chatUser:senyapSetel',
  /** Setelan notifikasi & autostart (dibaca panel Settings dan widget chat). */
  chatSetelan: 'chatUser:setelan',
  chatSetelanSetel: 'chatUser:setelanSetel',
  /**
   * Panduan pemakaian AIRA.
   *
   * ⚠️ Isinya DISUSUN DI MAIN PROCESS dari `izinMenu` sesi + saklar fitur, bukan
   * ditulis di renderer. Panduan yang ditulis di layar akan menyebut menu yang
   * tidak dipunyai orang itu dan fitur yang saklarnya mati — persis kegagalan
   * yang membuat aturan 61 lahir.
   */
  panduanIsi: 'panduan:isi'
} as const

export const ROLE_VALUES = ['super_admin', 'direktur', 'manager', 'spv', 'staff'] as const
export type RoleId = (typeof ROLE_VALUES)[number]

export const MENU_VALUES = ['sales', 'masterdata', 'lab', 'onedrive', 'reagent'] as const
export type MenuId = (typeof MENU_VALUES)[number]

/**
 * Role yang akses menunya TIDAK bisa dicabut lewat Settings.
 *
 * Tinggal di `shared` supaya main process (yang menegakkannya) dan panel Super
 * Admin (yang mengunci checkbox-nya) membaca daftar yang SAMA. Ketika ini pernah
 * ditulis dua kali, UI bisa menjanjikan sesuatu yang tidak ditepati main process
 * — atau sebaliknya, mengunci checkbox untuk role yang sebenarnya bisa dicabut.
 *
 * Direktur: ketentuan user 18 Agu 2026, selalu melihat kedua menu data.
 * Super Admin: dialah yang mengatur matriks ini; kalau ia bisa mencabut aksesnya
 * sendiri, ia mengunci dirinya keluar dari satu-satunya panel yang bisa
 * membatalkannya lagi.
 */
export const LOCKED_ROLES: readonly RoleId[] = ['super_admin', 'direktur']

/** Satu divisi, dari `tb_divisi_aira`. */
export interface Divisi {
  kode: string
  nama: string
  aktif: boolean
}

/** User yang sedang login. Password & hash TIDAK pernah menyeberang ke renderer. */
export interface AuthSession {
  username: string
  role: RoleId
  /** Kode divisi milik user. Kosong untuk Direktur & Super Admin. */
  divisi: string[]
  /**
   * Menu yang boleh dibuka — sudah memperhitungkan role, divisi, dan role yang
   * aksesnya tak tercabut. Renderer TIDAK menghitung ulang aturannya.
   */
  menu: MenuId[]
  expDate: string | null
}

export interface AuthState {
  /** false = database login tidak terjangkau / belum dikonfigurasi. */
  ready: boolean
  /**
   * Apakah penyiapan login sudah selesai (berhasil maupun gagal). Renderer memakai
   * ini untuk membedakan "masih menyiapkan" dari "gagal terhubung" — `ready: false`
   * sendirian bermakna dua-duanya.
   */
  initialized: boolean
  session: AuthSession | null
}

export interface LoginInput {
  username: string
  password: string
}

export interface LoginResult {
  ok: boolean
  session?: AuthSession
  error?: string
}

export interface AuthUserRow {
  username: string
  role: RoleId
  /** Kode divisi milik user. */
  divisi: string[]
  /**
   * Menu yang benar-benar terlihat oleh user ini — hasil akhir aturan "role DAN
   * divisi", dihitung di main process. Ditampilkan supaya Super Admin melihat
   * akibat pengaturannya, bukan menebaknya dari dua tabel terpisah.
   */
  menuTerlihat: MenuId[]
  expDate: string | null
  isBanned: boolean
  bannedReason: string | null
  lastLoginAt: string | null
  lastLoginIp: string | null
  lastLoginHost: string | null
}

export interface AuthLogRow {
  username: string
  role: string | null
  status: string
  ip: string | null
  hostname: string | null
  osUser: string | null
  ts: string
}

/** Role yang aksesnya diatur lewat matriks — semua role selain `LOCKED_ROLES`. */
export const ROLE_DIATUR = ROLE_VALUES.filter((r) => !LOCKED_ROLES.includes(r))

/**
 * Matriks akses: menu → role → kode divisi → boleh (30 Sep 2026).
 *
 * ⚠️ SATU matriks tiga dimensi, bukan dua matriks dua dimensi. Versi 19 Agu memakai
 * "role × menu" DAN "divisi × menu" terpisah, dan centangan divisi berlaku untuk
 * SEMUA role sekaligus. Akibatnya "Manager PA TP boleh Sales, SPV PA TP tidak, SPV
 * IT boleh" TIDAK BISA diatur sama sekali: membuka SPV IT ikut membuka SPV PA TP,
 * menutup PA TP ikut menutup Manager-nya (dilaporkan user 30 Sep 2026).
 * Kombinasi yang tidak punya baris = tertutup.
 */
export type RoleDivisionMatrix = Partial<
  Record<MenuId, Partial<Record<RoleId, Record<string, boolean>>>>
>

/** Dikirim sekali agar panel Super Admin tidak perlu dua panggilan terpisah. */
export interface AccessConfig {
  akses: RoleDivisionMatrix
  daftarDivisi: Divisi[]
}

/** Satu sel matriks akses. */
export interface SelAkses {
  menu: MenuId
  role: RoleId
  divisi: string
  diizinkan: boolean
}

/**
 * Seluruh perubahan draf dari layar Akses Menu, disimpan SEKALIGUS (tombol
 * "Simpan Perubahan") dalam satu statement — semua masuk atau tidak sama sekali,
 * tidak pernah separuh.
 */
export interface SetAksesInput {
  perubahan: SelAkses[]
}

export interface SetDivisiAktifInput {
  kode: string
  aktif: boolean
}

/**
 * Satu catatan yang diingat AIRA tentang user.
 *
 * Ditampilkan di Settings supaya user bisa melihat dan menghapusnya. Kalau ia
 * tidak bisa melihat apa yang diingat tentangnya, ia juga tidak bisa
 * membetulkan yang salah — dan memori yang salah ikut ke setiap percakapan
 * berikutnya.
 */
export interface MemoriRow {
  id: number
  isi: string
  /**
   * `user` = ia sendiri yang menyuruh "ingat …".
   * `otomatis` = disimpulkan AIRA dari percakapan (Lapis 4).
   *
   * Dibedakan di layar karena keduanya menuntut kepercayaan yang berbeda: yang
   * otomatis adalah kesimpulan model, dan user berhak tahu mana yang ia sendiri
   * tidak pernah katakan.
   */
  sumber: 'user' | 'otomatis'
  createdAt: string
}

// ------------------------------------------------------- galeri gambar

export interface ItemGaleri {
  id: string
  prompt: string
  ukuran: string
  /**
   * 'halaman' = dibuat di layar Gambar; 'chat' = dibuat AIRA di percakapan;
   * 'unggah' = SALINAN gambar dari komputer user, diunggah untuk diubah AIRA.
   */
  sumber: 'halaman' | 'chat' | 'unggah'
  /** Gambar yang diubah untuk menghasilkan gambar ini. */
  asalId: string | null
  dibuat: number
  path: string
  /** Berkasnya sudah dihapus/dipindah di luar AIRA. */
  hilang: boolean
  /** Thumbnail sebagai data URL (null bila berkas hilang). */
  thumb: string | null
}

export interface GaleriHasil {
  item: ItemGaleri[]
  adaLagi: boolean
}

export interface StatusKoneksiSales {
  terkonfigurasi: boolean
  keadaan: 'terhubung' | 'gagal' | 'belum'
  /** Kapan keadaan itu teramati (epoch ms), null bila belum ada query. */
  waktu: number | null
}

/** Layar awal Tanya Microsoft 365. */
export interface StatusDrive {
  terkonfigurasi: boolean
  keadaan: 'terhubung' | 'belum-login' | 'gagal'
  /** Email akun Microsoft yang tersambung (bila terbaca). */
  akun: string | null
  /** Nama folder di folder utama OneDrive user — hanya diisi saat terhubung. */
  folder: string[]
  folderAdaLagi: boolean
  /** Saklar `M365_LANJUTAN`: false = berkas saja (email/kalender belum tersambung). */
  lanjutan: boolean
  galat: string | null
  waktu: number
}

// ------------------------------------------------------- berkas terbaru

export interface BerkasTerbaru {
  path: string
  nama: string
  /** Ekstensi huruf kecil tanpa titik, mis. "xlsx". */
  jenis: string
  /** Kapan AIRA membuatnya (epoch ms). */
  dibuat: number
  sessionId: string
  judulSesi: string
}

// ------------------------------------------------------- pustaka

export type KategoriPustaka = 'word' | 'pdf' | 'excel' | 'ppt' | 'gambar' | 'diagram' | 'lain'

/** Satu berkas di menu Pustaka. */
export interface ItemPustaka {
  path: string
  nama: string
  /** Ekstensi huruf kecil tanpa titik. */
  ekstensi: string
  kategori: KategoriPustaka
  dibuat: number
  /** Byte; null bila berkasnya hilang. */
  ukuran: number | null
  /** Berkasnya sudah dihapus/dipindah di luar AIRA — DITANDAI, tidak disembunyikan. */
  hilang: boolean
  /** 'chat' = dari percakapan; 'gambar' = dibuat di layar Gambar. */
  asal: 'chat' | 'gambar'
  sessionId: string | null
  judulSesi: string | null
  /** Id galeri untuk gambar — dipakai mengambil thumbnail. */
  galeriId: string | null
  /** Prompt gambar (dari galeri) — judul yang terbaca; nama berkas gambar berupa UUID. */
  keterangan: string | null
}

// ------------------------------------------------------- jadwal

/** Pola pengulangan tugas terjadwal. Jam `HH:MM` waktu laptop. */
export type PolaJadwal =
  | { jenis: 'sekali'; tanggal: string; jam: string }
  | { jenis: 'harian'; jam: string }
  | { jenis: 'hari_kerja'; jam: string }
  /** `hari`: 0 = Minggu … 6 = Sabtu. */
  | { jenis: 'mingguan'; hari: number[]; jam: string }
  /** 29–31 jatuh ke hari terakhir bulan yang lebih pendek. */
  | { jenis: 'bulanan'; tanggal: number; jam: string }

export interface JalanJadwal {
  /** Waktu yang dijadwalkan (bisa lebih awal dari `mulai` bila tertunda). */
  dijadwalkan: number
  mulai: number
  /** 'jalan' = sedang berjalan; 'ok'; 'gagal'; 'ditolak' = mode tidak lagi diizinkan. */
  status: 'jalan' | 'ok' | 'gagal' | 'ditolak'
  keterangan: string | null
  /** Percakapan berisi hasilnya (null bila tidak sempat jalan). */
  sessionId: string | null
}

/** 'aira' = perintah dijalankan AIRA; 'pengingat' = hanya notifikasi, tanpa model. */
export type JenisJadwal = 'aira' | 'pengingat'

export interface ItemJadwal {
  id: string
  jenis: JenisJadwal
  nama: string
  prompt: string
  mode: ChatMode
  pola: PolaJadwal
  /** Kalimat pola siap tampil, mis. "Tiap Senin, 08:00". */
  uraian: string
  aktif: boolean
  /** Epoch ms jalan berikutnya; null = tidak ada lagi. */
  berikut: number | null
  riwayat: JalanJadwal[]
}

/** Satu kali jalan beserta tugasnya — untuk kalender & statistik. */
export interface JalanDenganTugas extends JalanJadwal {
  jadwalId: string
  nama: string
  mode: ChatMode
  jenis: JenisJadwal
}

export interface SimpanJadwalInput {
  /** null = tugas baru. */
  id: string | null
  jenis: JenisJadwal
  nama: string
  prompt: string
  mode: ChatMode
  pola: PolaJadwal
}

// ------------------------------------------------------- pemantau proaktif
//
// Pemeriksaan berkala yang HANYA MEMBACA lalu memberi tahu (20 Okt 2026,
// RANCANGAN-PEMANTAU.md). Daftar pemicu di sini dipakai main (validasi Zod) dan
// renderer (tipe) — satu daftar, bukan salinan.

export const PEMICU_PEMANTAU = ['data_sales', 'data_tat', 'sampel_terlambat', 'sales_anjlok'] as const
export type PemicuId = (typeof PEMICU_PEMANTAU)[number]

/** Hasil pemeriksaan terakhir satu pemicu. 'berbunyi' = keadaan yang diberitahukan sedang berlaku. */
export type HasilPemicu =
  | 'belum'
  | 'normal'
  | 'berbunyi'
  | 'ditahan'
  | 'menunggu'
  | 'libur'
  | 'kurang_data'
  | 'gagal'

/** Yang terjadi saat notifikasi/riwayat diklik. Menu diisi pertanyaan lanjutan, TIDAK dikirim. */
export type AksiPemantau = { tujuan: 'panel' } | { tujuan: 'menu'; mode: 'sales' | 'lab'; tanya: string }

export interface StatusPemicu {
  id: PemicuId
  menu: 'sales' | 'lab'
  judul: string
  /** Kalimat aturan, dibangkitkan dari konstanta kode. */
  aturan: string
  /** Saklar "Beri tahu saya" milik user ini. */
  aktif: boolean
  /** Epoch ms pemeriksaan terakhir; null = belum pernah. */
  diperiksa: number | null
  hasil: HasilPemicu
  ringkas: string
  /** Hanya `sampel_terlambat`: kategori yang tidak bisa dipantau beserta sebabnya. */
  tidakDipantau: string[]
}

/** Voice co-worker: the one action Muse Spark (or the keyword fallback) picked, and what AIRA says before it. */
export interface AgentRouteResult {
  action: AgentAction
  say: string
  source: 'muse' | 'keywords' | 'fallback'
}

/** Morning briefing (src/main/briefing/briefing.ts). */
export interface Briefing {
  text: string
  /** 'muse' = Muse Wonder's wording passed the number check; 'code' = written by code. */
  source: 'muse' | 'code'
  check: NumberCheck
  /** Why the Muse wording was not used, when it was not (or which sentence was left out). */
  note?: string
  /** Links of the web search behind the trend sentence (You.com), shown on the card. */
  sources?: { title: string; url: string }[]
  /** Said when the web trend could not be fetched — never silently missing. */
  trendNote?: string
}

export interface ItemRiwayatPemantau {
  id: number
  pemicu: PemicuId
  judul: string
  /** Rincian berangka (boleh Rupiah) — hanya tampil di dalam aplikasi, tidak di toast. */
  isi: string
  aksi: AksiPemantau
  dibuat: number
}

export interface KeadaanPemantau {
  pemicu: StatusPemicu[]
  riwayat: ItemRiwayatPemantau[]
  /** Hanya dari "Periksa sekarang" yang TIDAK dijalankan karena batasnya — kalimat untuk kartu. */
  catatanPeriksa?: string
}

// ------------------------------------------------------- auto-update

export interface StatusUpdate {
  tahap: 'mati' | 'diam' | 'memeriksa' | 'mengunduh' | 'siap' | 'terbaru' | 'galat'
  versiSekarang: string
  /** Versi di server (terisi saat mengunduh/siap). */
  versiBaru: string | null
  /** 0–100 saat mengunduh. */
  persen: number | null
  /** Kalimat untuk user (alasan mati, galat, dsb.). */
  pesan: string | null
  /** ISO — kapan terakhir berhasil menghubungi server. */
  terakhirCek: string | null
}

// ------------------------------------------------------- monitoring pemakaian

export interface MonitoringFilter {
  /** 1, 7, 30, atau 90 hari terakhir. */
  periodeHari: number
  username: string | null
  mode: ChatMode | null
  /** Kata di dalam teks pertanyaan. */
  cari: string | null
}

export interface ToolTercatatIpc {
  nama: string
  kali: number
  gagal: number
}

export interface MonitoringPengguna {
  username: string
  role: string | null
  divisi: string | null
  pertanyaan: number
  gagal: number
  hariAktif: number
  terakhir: string
  menuTersering: string | null
}

export interface MonitoringRingkasan {
  totalPertanyaan: number
  penggunaAktif: number
  gagal: number
  pakaiTool: number
  perPengguna: MonitoringPengguna[]
  perMenu: Array<{ mode: string; jumlah: number }>
  perHari: Array<{ tanggal: string; jumlah: number; pengguna: number }>
  toolTeratas: Array<{ nama: string; jumlah: number }>
  /** Jam 0–23 (WIB) -> jumlah pertanyaan. */
  perJam: number[]
}

export interface AktivitasRow {
  id: number
  username: string
  role: string | null
  divisi: string | null
  hostname: string | null
  appVersion: string | null
  waktu: string
  mode: string | null
  model: string | null
  /** NULL = sudah dihapus karena melewati masa simpan. */
  prompt: string | null
  promptDipotong: boolean
  lampiran: string[]
  tools: ToolTercatatIpc[]
  jumlahTool: number
  status: string
  kodeGalat: string | null
  durasiMs: number | null
  promptTokens: number | null
  completionTokens: number | null
}

export interface LinimasaInput extends MonitoringFilter {
  /** Kursor halaman berikutnya: baris terakhir yang sudah tampil. */
  sebelum: { waktu: string; id: number } | null
}

export interface LinimasaHasil {
  baris: AktivitasRow[]
  adaLagi: boolean
}

// ------------------------------------------------------- masukan & lapor masalah

export const FEEDBACK_JENIS = ['bug', 'usulan', 'tidak_terjawab', 'lain'] as const
export type FeedbackJenis = (typeof FEEDBACK_JENIS)[number]

export const FEEDBACK_DAMPAK = ['menghalangi', 'mengganggu', 'kecil'] as const
export type FeedbackDampak = (typeof FEEDBACK_DAMPAK)[number]

export const FEEDBACK_STATUS = ['baru', 'dibaca', 'dikerjakan', 'selesai', 'ditolak'] as const
export type FeedbackStatus = (typeof FEEDBACK_STATUS)[number]

export const FEEDBACK_JENIS_LABELS: Record<FeedbackJenis, string> = {
  bug: 'Bug / error',
  usulan: 'Feature request',
  tidak_terjawab: 'Could not answer',
  lain: 'Other'
}

export const FEEDBACK_DAMPAK_LABELS: Record<FeedbackDampak, string> = {
  menghalangi: 'Blocks my work',
  mengganggu: 'Annoying, but I can continue',
  kecil: 'Minor / suggestion only'
}

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  baru: 'New',
  dibaca: 'Read',
  dikerjakan: 'In progress',
  selesai: 'Done',
  ditolak: 'Declined'
}

/**
 * Masukan yang dikirim dari renderer.
 *
 * ⚠️ Identitas TIDAK ada di sini, dan itu disengaja. Username, role, divisi,
 * hostname, IP, dan versi aplikasi semuanya diisi main process dari sesi yang
 * dipegangnya sendiri. Kalau renderer yang mengirimnya, seorang user bisa
 * melapor atas nama direktur — dan seluruh daftar masukan jadi tidak bisa
 * dipercaya sebagai catatan siapa mengeluhkan apa.
 */
export interface KirimFeedbackInput {
  jenis: FeedbackJenis
  isi: string
  dampak: FeedbackDampak | null
  /** Konteks jalur A (tombol di gelembung jawaban). Semuanya null untuk jalur B. */
  sesiId: string | null
  pesanId: string | null
  mode: ChatMode | null
  model: string | null
  pertanyaan: string | null
  jawaban: string | null
  toolLog: ToolActivity[] | null
  /**
   * Apakah user mengizinkan cuplikan percakapan ikut terkirim.
   *
   * Dikirim eksplisit, bukan disimpulkan dari "pertanyaan tidak null" — supaya
   * pilihan user tercatat apa adanya di database, dan Super Admin bisa
   * membedakan "tidak ada cuplikan karena ini usulan umum" dari "user memang
   * tidak mau mengirimkannya".
   */
  sertakanChat: boolean
  /** Opsional — tangkapan layar/berkas bukti. Jalur A (tombol Laporkan) tidak mengirimnya. */
  lampiran?: { nama: string; mime: string; data: Uint8Array } | null
}

export interface FeedbackRow {
  id: number
  username: string
  role: string | null
  divisi: string | null
  hostname: string | null
  osUser: string | null
  ip: string | null
  appVersion: string | null
  jenis: string
  dampak: string | null
  isi: string
  sesiId: string | null
  pesanId: string | null
  mode: string | null
  model: string | null
  pertanyaan: string | null
  jawaban: string | null
  toolLog: ToolActivity[] | null
  sertakanChat: boolean
  status: string
  catatanAdmin: string | null
  ditanganiOleh: string | null
  createdAt: string
  /** Metadata saja — isi berkas hanya lewat `feedbackSimpanLampiran`. */
  lampiranNama: string | null
  lampiranUkuran: number | null
}

export interface SetFeedbackStatusInput {
  id: number
  status: FeedbackStatus
  catatan: string | null
}

export interface CreateDivisionInput {
  nama: string
}

export interface SetUserDivisionsInput {
  username: string
  divisi: string[]
}

export interface CreateUserInput {
  username: string
  password: string
  role: RoleId
  /** Kode divisi. Wajib untuk Manager/SPV (boleh banyak) dan Staff (tepat satu). */
  divisi: string[]
  /** `null` = tanpa batas berlaku. */
  expDate: string | null
}

export interface SetBannedInput {
  username: string
  banned: boolean
  reason: string | null
}

export interface SubmitCredentialInput {
  requestId: string
  /** null = user membatalkan */
  value: { username: string; password: string; remember: boolean } | null
}

/** Metadata kredensial situs. Username & password TIDAK pernah dikirim ke renderer. */
export interface WebCredentialInfo {
  name: string
  url: string
}

export interface SaveCredentialInput {
  name: string
  url: string
  username: string
  password: string
}

export interface Attachment {
  id: string
  name: string
  /** Path salinan di folder lampiran aplikasi — aman diakses tools. */
  path: string
  kind: 'image' | 'document'
  size: number
}

export interface SetupState {
  configured: boolean
  endpoint: string
  modelId: string
}

export interface SaveSetupInput {
  endpoint: string
  modelId: string
  apiKey: string
}

export interface SaveSetupResult {
  ok: boolean
  error?: string
  models?: string[]
}

export interface SessionMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /**
   * Menu tempat percakapan ini lahir. Dikirim ke renderer supaya membuka
   * riwayat mengembalikan modenya — bukan mewarisi menu yang sedang aktif.
   */
  mode: ChatMode
}

// Tingkat bahaya tool. read = auto, write = auto+tercatat,
// mutate/execute = WAJIB persetujuan user lewat UI.
export type ToolTier = 'read' | 'write' | 'mutate' | 'execute'

export type ToolStatus = 'running' | 'awaiting_approval' | 'ok' | 'error' | 'denied'

export interface ToolActivity {
  callId: string
  /** Nama teknis tool (untuk audit/debug). */
  name: string
  /** Label ramah untuk UI — provider tidak diekspos (mis. "Web Search"). */
  label?: string
  argsSummary: string
  tier: ToolTier
  status: ToolStatus
  resultSummary?: string
  /** Path file yang dihasilkan tool — dipakai UI untuk tombol "buka folder". */
  outputPath?: string
}

export interface ChatMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  reasoning: string | null
  toolLog: ToolActivity[] | null
  /** Model yang benar-benar dipakai menjawab (hasil routing). */
  modelUsed: string | null
  createdAt: number
  /** Dashboard data yang disusun KODE dari hasil tool (menu data). */
  dashboard?: Dashboard | null
  /** Kartu visual per hasil tool data — disusun kode, tanpa query tambahan. */
  visual?: KartuVisual[] | null
  /** Number check of a Reagent Check answer — every number looked up in the turn's reagent results. */
  numberCheck?: NumberCheck | null
}

export type ModelChoice = 'auto' | 'chat' | 'agent' | 'coder'

/**
 * Mode kerja — sekaligus penentu SUMBER DATA:
 * - "sales"      → hanya transaksi penjualan (Postgres `DB-REPOSITORY`)
 * - "masterdata" → hanya master data the lab (MariaDB `inno_collection`)
 */
export type ChatMode = 'general' | 'sales' | 'masterdata' | 'lab' | 'onedrive' | 'reagent'

// --- Panduan pemakaian -------------------------------------------------------
//
// Tipenya tinggal di `shared` supaya SATU definisi dipakai tiga tempat: penyusun
// isi (`main/panduan/isi.ts`), tool `cari_panduan`, dan layar Panduan. Kalau
// renderer punya tipe sendiri, layar dan jawaban AIRA bisa menyimpang tanpa ada
// yang menyadarinya — dan yang menyimpang selalu yang tidak dilihat orang.

export type PanduanBlok =
  | { jenis: 'paragraf'; teks: string }
  | { jenis: 'langkah'; butir: string[] }
  | { jenis: 'daftar'; butir: string[] }
  /** Kalimat siap klik. `mode` = menu yang harus aktif saat pertanyaan itu dikirim. */
  | { jenis: 'contoh'; mode: ChatMode; contoh: string[] }
  /** Batas / hal yang TIDAK bisa. Sengaja jenis sendiri supaya tidak bisa dilewat saat dirender. */
  | { jenis: 'batas'; butir: string[] }

/** Setelan notifikasi chat + autostart Windows. */
export interface SetelanChat {
  /** Tampilkan cuplikan isi pesan di notifikasi Windows. */
  pratinjau: boolean
  /** AIRA ikut menyala saat Windows login (tersembunyi di tray). */
  autoStart: boolean
  /** Tawaran autostart sudah pernah ditampilkan — widget tidak menanyakannya lagi. */
  sudahDitanya: boolean
}

export interface PanduanBagian {
  id: string
  judul: string
  /** Satu kalimat untuk kartu & daftar isi. */
  ringkas: string
  /** Kata kunci tambahan untuk pencarian — istilah yang dipakai orang, bukan istilah kode. */
  kunci: string[]
  isi: PanduanBlok[]
}

export interface SendChatInput {
  sessionId: string | null
  text: string
  attachments?: Attachment[]
  mode?: ChatMode
}

export interface SendChatResult {
  sessionId: string
  userMessageId: string
  assistantMessageId: string
  modelUsed: string
}

export type ChatStreamEvent =
  | { type: 'reasoning'; messageId: string; sessionId: string; delta: string }
  | { type: 'content'; messageId: string; sessionId: string; delta: string }
  /** Buang teks yang sudah tampil dan tulis ulang (dipakai saat koreksi false-refusal). */
  | { type: 'reset'; messageId: string; sessionId: string }
  | { type: 'tool_start'; messageId: string; sessionId: string; activity: ToolActivity }
  | {
      type: 'tool_end'
      messageId: string
      sessionId: string
      callId: string
      status: 'ok' | 'error' | 'denied'
      resultSummary: string
      outputPath?: string
    }
  | {
      type: 'approval'
      messageId: string
      sessionId: string
      requestId: string
      activity: ToolActivity
      detail: string
    }
  /** AIRA butuh login: form diisi di dalam chat, nilainya tidak pernah jadi teks pesan. */
  | {
      type: 'credential_request'
      messageId: string
      sessionId: string
      requestId: string
      credentialName: string
      url: string
    }
  | {
      type: 'done'
      messageId: string
      sessionId: string
      usage?: { promptTokens: number; completionTokens: number }
    }
  | { type: 'error'; messageId: string; sessionId: string; code: string; message: string }
  /** Dashboard jawaban selesai disusun (sebelum `done`). */
  | { type: 'dashboard'; messageId: string; sessionId: string; dashboard: Dashboard }
  /** Kartu visual jawaban (sebelum `done`). */
  | { type: 'visual'; messageId: string; sessionId: string; visual: KartuVisual[] }
  /** Number check of a Reagent Check answer (before `done`). */
  | { type: 'number_check'; messageId: string; sessionId: string; check: NumberCheck }

export interface ApproveInput {
  requestId: string
  approved: boolean
}

export interface McpServerInfo {
  name: string
  url: string
  requireApproval: boolean
  enabled: boolean
  ok?: boolean
  toolCount?: number
  error?: string
}

export interface SettingsState {
  youKeySet: boolean
  servers: McpServerInfo[]
  credentials: WebCredentialInfo[]
}

export interface McpAddInput {
  name: string
  url: string
  headerName?: string
  headerValue?: string
  requireApproval: boolean
}

export interface McpAddResult {
  ok: boolean
  error?: string
  toolCount?: number
  servers: McpServerInfo[]
}

/**
 * Hasil transkripsi suara.
 *
 * ⚠️ `catatan` TIDAK PERNAH kosong dan wajib ditampilkan ke user. Yang muncul
 * di kotak chat adalah hasil dengar mesin yang BELUM dikoreksi; membiarkannya
 * tampil polos membuat orang mengira kalimatnya sudah pasti benar, lalu
 * mengirim pertanyaan yang salah dengar dan menerima angka yang salah.
 */
/** AIRA's spoken voice (ElevenLabs mp3), or why it could not be made — the renderer then uses the Windows voice. */
export type HasilSuaraAira = { audio: Uint8Array } | { error: string }

export interface HasilTranskripIpc {
  teks: string
  catatan: string
  ms: number
  detik: number
}

/** Satu rekan di daftar chat pojok kanan bawah. */
export interface RekanChat {
  username: string
  role: string | null
  /** Nama divisi, digabung koma. null = tidak punya divisi (Direktur/Super Admin). */
  divisi: string | null
  online: boolean
  lastSeen: string | null
  belumDibaca: number
  /**
   * Pesan terakhir antara saya dan orang ini. null = belum pernah bercakap.
   * Dipakai mengurutkan daftar menurut aktivitas, seperti WhatsApp.
   */
  terakhir: PesanChatIpc | null
}

/**
 * Satu pesan chat antar pengguna.
 *
 * ⚠️ `lampiranData` sengaja TIDAK ada di sini. Isi berkas hanya menyeberang saat
 * user benar-benar menyimpannya (`chatSimpanLampiran`) — kalau ikut di setiap
 * pemuatan percakapan, membuka satu ruang chat berarti menarik semua berkasnya
 * dari database produksi tiap beberapa detik.
 */
export interface PesanChatIpc {
  id: string
  pengirim: string
  /** Kosong untuk pesan grup. */
  penerima: string | null
  isi: string
  lampiranNama: string | null
  lampiranMime: string | null
  lampiranUkuran: number | null
  createdAt: string
  dibacaAt: string | null
  /**
   * Terisi = pesan ini DIHAPUS pengirimnya. Isi & lampirannya sudah dibuang di
   * database; barisnya tinggal sebagai nisan supaya percakapan tidak berlubang.
   */
  dihapusAt: string | null
  /** Terisi = pesan grup. */
  grupId: string | null
  /** Terisi = pesan sistem. Teksnya disusun di layar lewat `teksSistem`. */
  jenis: string | null
  /** Sasaran pesan sistem (username; untuk `ganti_nama` berisi nama baru grup). */
  target: string | null
}

// --- Grup chat ---------------------------------------------------------------

export type PeranGrupIpc = 'admin' | 'anggota'

/** Satu baris di daftar grup. */
export interface GrupRingkas {
  id: string
  nama: string
  /** Jumlah anggota yang MASIH aktif. */
  jumlahAnggota: number
  peranSaya: PeranGrupIpc
  /** false = saya sudah keluar/dikeluarkan — grup tetap terlihat, tapi hanya bisa dibaca. */
  aktif: boolean
  belumDibaca: number
  /** Pesan terakhir yang BOLEH saya lihat. null = belum ada pesan. */
  terakhir: PesanChatIpc | null
}

export interface AnggotaGrup {
  username: string
  peran: PeranGrupIpc
  online: boolean
  role: string | null
}

export interface InfoGrup {
  grup: GrupRingkas
  /** Anggota AKTIF saja. */
  anggota: AnggotaGrup[]
}

export interface KirimGrupInput {
  grupId: string
  isi: string
  lampiran?: { nama: string; mime: string; data: Uint8Array }
}

export interface KirimPesanInput {
  ke: string
  isi: string
  lampiran?: {
    nama: string
    mime: string
    data: Uint8Array
  }
}
