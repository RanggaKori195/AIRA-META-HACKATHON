import { app } from 'electron'
import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { ChatMessage, ChatMode, SessionMeta } from '../shared/ipc'
import { modeSah } from '../shared/mode-chat'
import { DDL_PEMANTAU } from './pemantau/simpan'

let db: Database.Database | null = null

const MIGRATIONS: string[] = [
  `
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    reasoning TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_messages_session ON messages(session_id, created_at);
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    component TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT
  );
  `,
  `
  ALTER TABLE messages ADD COLUMN tool_log TEXT;
  `,
  `
  CREATE TABLE rag_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    mtime INTEGER NOT NULL,
    size INTEGER NOT NULL,
    chunk_count INTEGER NOT NULL,
    indexed_at INTEGER NOT NULL
  );
  CREATE TABLE rag_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES rag_files(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    embedding BLOB NOT NULL
  );
  CREATE INDEX idx_rag_chunks_file ON rag_chunks(file_id);
  `,
  `
  ALTER TABLE messages ADD COLUMN model_used TEXT;
  `,
  // Riwayat chat milik ORANG, bukan milik laptop.
  //
  // ⚠️ Sebelum ini `sessions` tidak punya kolom pemilik sama sekali, dan
  // `listSessions()` mengembalikan semuanya tanpa filter. Akibatnya: dua orang
  // yang login bergantian di laptop yang sama saling melihat riwayat chat —
  // termasuk jawaban mode Sales berisi omzet dan isi dokumen yang pernah
  // dilampirkan. Bukan skenario karangan: riwayat login menunjukkan akun dipakai
  // lintas laptop dan lintas orang.
  //
  // Baris lama sengaja dibiarkan ber-username NULL, TIDAK ditebak pemiliknya.
  // Menebak berarti menyerahkan riwayat orang lain ke siapa pun yang kebetulan
  // login pertama sesudah pembaruan — persis kebocoran yang sedang ditutup.
  // Konsekuensinya sesi lama tidak lagi muncul di sidebar; itu kegagalan yang
  // TERLIHAT dan bisa dilaporkan, sementara datanya sendiri tidak dihapus.
  `
  ALTER TABLE sessions ADD COLUMN username TEXT;
  CREATE INDEX idx_sessions_username ON sessions(username, updated_at DESC);
  `,
  // Index pencarian riwayat percakapan sendiri ("minggu lalu saya nanya apa soal
  // Kariadi?").
  //
  // ⚠️ FTS5 dengan external content (`content='messages'`), BUKAN salinan teks
  // terpisah. Isi pesan bisa sangat besar — satu jawaban pernah memuat hasil
  // read_pdf 131 ribu karakter — dan menyalinnya berarti menggandakan ukuran
  // database di laptop user untuk data yang sudah ada di sebelahnya.
  //
  // ⚠️ Sengaja BUKAN embedding per pesan. Meng-embed setiap pesan berarti satu
  // panggilan HTTP ke gateway pada SETIAP giliran chat — gateway yang sama yang
  // sedang melayani percakapannya, dan yang mati total saat user tidak ber-VPN.
  // FTS5 berjalan lokal, gratis, dan tetap hidup tanpa jaringan; pemeringkatan
  // maknanya diserahkan ke reranker yang hanya dipanggil SAAT mencari.
  `
  CREATE VIRTUAL TABLE messages_fts USING fts5(
    content,
    content='messages',
    content_rowid='rowid'
  );

  INSERT INTO messages_fts(rowid, content) SELECT rowid, content FROM messages;

  CREATE TRIGGER messages_fts_ins AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
  END;

  -- Pesan assistant lahir kosong lalu diisi saat streaming selesai
  -- ("updateMessage"), jadi tanpa trigger UPDATE seluruh jawaban AIRA tidak akan
  -- pernah bisa dicari — yang tercatat hanya string kosong saat baris dibuat.
  CREATE TRIGGER messages_fts_upd AFTER UPDATE OF content ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
    INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
  END;

  CREATE TRIGGER messages_fts_del AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  END;
  `,
  // Sampai pesan ke berapa sebuah sesi sudah dibaca oleh ekstraksi memori
  // otomatis (Lapis 4).
  //
  // Di SQLite lokal, bukan Postgres — ini penanda pemrosesan yang terikat pada
  // riwayat chat, dan riwayat chat memang tinggal di laptop. Kalau disimpan di
  // server sementara riwayatnya lokal, penanda dan sumbernya bisa berpisah
  // (mis. laptop diinstal ulang) dan ekstraksi akan melewatkan percakapan yang
  // belum pernah dibaca.
  `
  CREATE TABLE memori_ekstrak (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    diproses   INTEGER NOT NULL,
    ts         INTEGER NOT NULL
  );
  `,
  // MODE ADALAH MILIK PERCAKAPAN, BUKAN MILIK SIDEBAR.
  //
  // ⚠️ Dilaporkan user 21 Agu 2026. Sebelum ini `mode` hanya hidup di state
  // React: ia ikut tombol menu yang terakhir diklik, dan `openSession` tidak
  // pernah menyentuhnya. Akibatnya membuka percakapan LAMA dari riwayat
  // membawa mode yang sedang aktif, bukan mode percakapan itu sendiri.
  //
  // Terekam di log: sesi `fd6f0348` yang lahir di Task Baru (permintaan menulis
  // kode) dijalankan dengan `groups=[inno]`, sehingga AIRA menjawab sebagai
  // asisten master data dan MENOLAK menulis kode — jawaban yang terdengar
  // yakin, sepenuhnya salah, dan mustahil dipahami user.
  //
  // Baris lama sengaja dibiarkan NULL, TIDAK ditebak. Yang NULL diperlakukan
  // sebagai `general` saat dibuka: mode umum tidak pernah menyentuh database
  // (aturan 17), jadi menebak ke arah itu paling buruk hanya mengarahkan user
  // ke menu yang benar. Menebak ke arah sebaliknya akan menjalankan percakapan
  // biasa dengan toolset data.
  `
  ALTER TABLE sessions ADD COLUMN mode TEXT;
  `,
  // Antrean catatan pemakaian yang belum terkirim ke `tb_aktivitas_aira`.
  //
  // ⚠️ Dicatat LOKAL dulu, baru dikirim. Menulis langsung ke server di akhir
  // tiap jawaban berarti catatan hilang diam-diam setiap kali VPN putus — dan
  // statistik yang bolong tidak bisa dibedakan dari orang yang memang tidak
  // memakai AIRA. Isinya (pertanyaan user) memang sudah ada di tabel `messages`
  // di sebelahnya, jadi antrean ini tidak menambah apa yang tersimpan di laptop.
  `
  CREATE TABLE aktivitas_antrean (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT    NOT NULL UNIQUE,
    payload  TEXT    NOT NULL,
    dibuat   INTEGER NOT NULL
  );
  `,
  // Galeri gambar (menu "Gambar", 27 Sep 2026). Satu baris per gambar, dari
  // halaman Gambar maupun dari chat (`buat_gambar`/`ubah_gambar`).
  //
  // ⚠️ `username` WAJIB dan diperiksa di setiap jalur baca/ubah/hapus — galeri
  // milik ORANG, bukan laptop (aturan 16). Laptop dipakai bergantian.
  // `asal_id` menunjuk gambar yang diubah, supaya riwayat "versi" terlacak.
  `
  CREATE TABLE galeri (
    id         TEXT PRIMARY KEY,
    username   TEXT NOT NULL,
    path       TEXT NOT NULL,
    thumb      TEXT,
    prompt     TEXT NOT NULL,
    ukuran     TEXT NOT NULL,
    sumber     TEXT NOT NULL,
    asal_id    TEXT,
    session_id TEXT,
    dibuat     INTEGER NOT NULL
  );
  CREATE INDEX idx_galeri_user ON galeri(username, dibuat DESC);
  `,
  // Tugas terjadwal (menu "Jadwal", 29 Sep 2026). Berjalan DI LAPTOP selama AIRA
  // menyala — keputusan user, lihat `jadwal/rules.ts`.
  //
  // ⚠️ `username` WAJIB dan diperiksa di setiap jalur (aturan 16). Tugas hanya
  // dijalankan saat PEMILIKNYA yang sedang login: laptop dipakai bergantian, dan
  // tugas milik direktur tidak boleh berjalan dengan izin menu orang lain.
  // `pola` = JSON `PolaJadwal`. `berikut` = epoch ms, NULL = tidak ada lagi.
  // Riwayat jalan menunjuk percakapan hasilnya; percakapan yang dihapus user
  // tidak menghapus barisnya (sesi_id jadi basi, ditandai di layar).
  `
  CREATE TABLE jadwal (
    id       TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    nama     TEXT NOT NULL,
    prompt   TEXT NOT NULL,
    mode     TEXT NOT NULL,
    pola     TEXT NOT NULL,
    aktif    INTEGER NOT NULL DEFAULT 1,
    berikut  INTEGER,
    dibuat   INTEGER NOT NULL
  );
  CREATE INDEX idx_jadwal_user ON jadwal(username);
  CREATE TABLE jadwal_jalan (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    jadwal_id   TEXT NOT NULL REFERENCES jadwal(id) ON DELETE CASCADE,
    dijadwalkan INTEGER NOT NULL,
    mulai       INTEGER NOT NULL,
    status      TEXT NOT NULL,
    keterangan  TEXT,
    session_id  TEXT
  );
  CREATE INDEX idx_jadwal_jalan ON jadwal_jalan(jadwal_id, id DESC);
  `,
  // Jenis tugas terjadwal (29 Sep 2026): 'aira' = perintah dijalankan AIRA,
  // 'pengingat' = HANYA notifikasi, tanpa model. Baris lama = 'aira'.
  `
  ALTER TABLE jadwal ADD COLUMN jenis TEXT NOT NULL DEFAULT 'aira';
  CREATE INDEX idx_jadwal_jalan_waktu ON jadwal_jalan(dijadwalkan);
  `,
  // Dashboard jawaban (29 Sep 2026): JSON `Dashboard` yang disusun kode dari
  // hasil tool. Disimpan bersama pesannya supaya tetap tampil saat percakapan
  // dibuka ulang — dan TIDAK ikut ke riwayat yang dikirim ke model.
  `
  ALTER TABLE messages ADD COLUMN dashboard TEXT;
  `,
  // Kartu visual per hasil tool data (29 Sep 2026). JSON `KartuVisual[]`,
  // disusun dari hasil tool — tidak ikut ke riwayat yang dikirim ke model.
  `
  ALTER TABLE messages ADD COLUMN visual TEXT;
  `,
  // Pemantau proaktif (20 Okt 2026): penanda anti-ulang per username × pemicu dan
  // riwayat peringatan. DDL-nya tinggal di `pemantau/simpan.ts` supaya test
  // menjalankan SQL yang SAMA di node:sqlite. Lihat RANCANGAN-PEMANTAU.md.
  DDL_PEMANTAU
]

export function initDb(): void {
  const dataDir = join(app.getPath('userData'), 'data')
  mkdirSync(dataDir, { recursive: true })
  db = new Database(join(dataDir, 'aira.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[v])
      db.pragma(`user_version = ${v + 1}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
}

function conn(): Database.Database {
  if (!db) throw new Error('database not initialized')
  return db
}

/** Akses langsung untuk modul lain (mis. RAG store). */
export function rawDb(): Database.Database {
  return conn()
}

/**
 * Membuat sesi baru milik `username`.
 *
 * `username` wajib — bukan opsional dengan bawaan null. Sesi tanpa pemilik tidak
 * akan pernah terlihat lagi oleh siapa pun (lihat `listSessions`), jadi kalau
 * pemanggil lupa mengisinya gejalanya adalah "chat saya hilang begitu dikirim".
 * Disimpan huruf kecil supaya cocok dengan pembandingan login yang memang
 * case-insensitive.
 */
export function createSession(title: string, username: string, mode: ChatMode): SessionMeta {
  const now = Date.now()
  const session: SessionMeta = { id: randomUUID(), title, createdAt: now, updatedAt: now, mode }
  conn()
    .prepare(
      'INSERT INTO sessions (id, title, created_at, updated_at, username, mode) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(
      session.id,
      session.title,
      session.createdAt,
      session.updatedAt,
      username.toLowerCase(),
      mode
    )
  return session
}

/**
 * Mode milik sebuah percakapan. `null` = sesi lama dari sebelum kolom ini ada.
 *
 * Dipakai `chatSend` untuk MENEGAKKAN mode, bukan sekadar menampilkannya:
 * renderer boleh salah kirim (dan sudah terbukti salah kirim), tapi percakapan
 * yang lahir di Task Baru tidak boleh dijalankan dengan toolset data hanya
 * karena user terakhir kali mengklik menu lain.
 */
export function sessionMode(sessionId: string): ChatMode | null {
  const row = conn()
    .prepare('SELECT mode FROM sessions WHERE id = ?')
    .get(sessionId) as { mode?: string } | undefined
  // ⚠️ `modeSah`, bukan daftar tangan: daftar tangan di sini dulu lupa `lab` &
  // `onedrive`, jadi percakapan TAT & Microsoft 365 jalan sebagai Task Baru.
  return modeSah(row?.mode)
}

/**
 * Riwayat milik satu user saja.
 *
 * ⚠️ Baris ber-`username` NULL (sesi dari sebelum pemisahan pemilik) sengaja
 * TIDAK ikut. Menampilkannya ke siapa pun berarti membuka kembali kebocoran yang
 * migrasi ini tutup: di laptop yang dipakai bergantian, isinya bisa milik orang
 * lain. Datanya tetap ada di database, hanya tidak ditampilkan.
 */
export function listSessions(username: string): SessionMeta[] {
  return conn()
    .prepare(
      `SELECT id, title, created_at, updated_at, mode
         FROM sessions
        WHERE username = ?
        ORDER BY updated_at DESC
        LIMIT 200`
    )
    .all(username.toLowerCase())
    .map((r: any) => ({
      id: r.id,
      title: r.title,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      // Sesi lama (sebelum kolom `mode` ada) dibuka sebagai Task Baru — lihat
      // alasannya di migrasi.
      mode: modeSah(r.mode) ?? 'general'
    }))
}

/**
 * Apakah sesi ini milik user tersebut.
 *
 * Dipakai `ipc.ts` sebelum membuka isi maupun menghapus sesi. Menyaring daftar
 * di sidebar saja tidak cukup: `sessionsMessages` menerima id apa pun yang
 * dikirim renderer, dan id sesi orang lain tetap sah bentuknya. Sesi lama tanpa
 * pemilik (`username` NULL) tidak dimiliki siapa pun, jadi ikut tertolak.
 */
export function sessionMilik(sessionId: string, username: string): boolean {
  const row = conn()
    .prepare('SELECT 1 AS x FROM sessions WHERE id = ? AND username = ?')
    .get(sessionId, username.toLowerCase()) as { x: number } | undefined
  return row !== undefined
}

/** Berapa sesi lama yang tidak punya pemilik — dicatat sekali saat start. */
export function jumlahSesiTanpaPemilik(): number {
  const row = conn()
    .prepare('SELECT count(*) AS n FROM sessions WHERE username IS NULL')
    .get() as { n: number }
  return row.n
}

export function deleteSession(sessionId: string): void {
  // messages ikut terhapus otomatis (FK ON DELETE CASCADE)
  conn().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
}

export function touchSession(sessionId: string): void {
  conn().prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(Date.now(), sessionId)
}

export function insertMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  reasoning: string | null = null
): ChatMessage {
  const msg: ChatMessage = {
    id: randomUUID(),
    sessionId,
    role,
    content,
    reasoning,
    toolLog: null,
    modelUsed: null,
    createdAt: Date.now()
  }
  conn()
    .prepare(
      'INSERT INTO messages (id, session_id, role, content, reasoning, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(msg.id, msg.sessionId, msg.role, msg.content, msg.reasoning, msg.createdAt)
  touchSession(sessionId)
  return msg
}

export function updateMessage(
  id: string,
  content: string,
  reasoning: string | null,
  toolLog: ChatMessage['toolLog'] = null
): void {
  conn()
    .prepare('UPDATE messages SET content = ?, reasoning = ?, tool_log = ? WHERE id = ?')
    .run(content, reasoning, toolLog ? JSON.stringify(toolLog) : null, id)
}

export function setMessageVisual(id: string, visual: unknown): void {
  conn().prepare('UPDATE messages SET visual = ? WHERE id = ?').run(JSON.stringify(visual), id)
}

export function setMessageDashboard(id: string, dashboard: unknown): void {
  conn().prepare('UPDATE messages SET dashboard = ? WHERE id = ?').run(JSON.stringify(dashboard), id)
}

export function setMessageModel(id: string, model: string): void {
  conn().prepare('UPDATE messages SET model_used = ? WHERE id = ?').run(model, id)
}

/**
 * Membuang giliran TERAKHIR sebuah percakapan (satu pesan user + jawaban
 * assistant sesudahnya), lalu mengembalikan teks user-nya supaya bisa diulang.
 *
 * Dipakai tombol "Coba lagi". Giliran yang gagal DIHAPUS, bukan ditinggalkan —
 * kalau tidak, riwayat berisi jawaban setengah jadi yang ikut terkirim ke model
 * pada giliran berikutnya, dan pertanyaan yang sama muncul dua kali di layar.
 *
 * Mengembalikan null bila tidak ada pesan user sama sekali (tidak ada yang bisa
 * diulang). Pemeriksaan kepemilikan sesi BUKAN urusan fungsi ini — pemanggil
 * yang wajib melakukannya lebih dulu (lihat `sessionMilik`, aturan 16).
 */
export function buangGiliranTerakhir(sessionId: string): string | null {
  const pesan = listMessages(sessionId)
  let indeksUser = -1
  for (let i = pesan.length - 1; i >= 0; i--) {
    if (pesan[i].role === 'user') {
      indeksUser = i
      break
    }
  }
  if (indeksUser < 0) return null
  const teks = pesan[indeksUser].content
  const dibuang = pesan.slice(indeksUser).map((m) => m.id)
  const hapus = conn().prepare('DELETE FROM messages WHERE id = ?')
  const transaksi = conn().transaction((ids: string[]) => {
    for (const id of ids) hapus.run(id)
  })
  transaksi(dibuang)
  return teks
}

/** JSON dashboard yang rusak tidak boleh mematikan pembukaan percakapan. */
function bacaDashboard(teks: string | null | undefined): any {
  if (!teks) return null
  try {
    return JSON.parse(teks)
  } catch {
    return null
  }
}

export function listMessages(sessionId: string): ChatMessage[] {
  return conn()
    .prepare(
      'SELECT id, session_id, role, content, reasoning, tool_log, model_used, created_at, dashboard, visual FROM messages WHERE session_id = ? ORDER BY created_at ASC'
    )
    .all(sessionId)
    .map((r: any) => ({
      id: r.id,
      sessionId: r.session_id,
      role: r.role,
      content: r.content,
      reasoning: r.reasoning,
      toolLog: r.tool_log ? JSON.parse(r.tool_log) : null,
      modelUsed: r.model_used ?? null,
      createdAt: r.created_at,
      dashboard: bacaDashboard(r.dashboard),
      visual: bacaDashboard(r.visual) as ChatMessage['visual']
    }))
}

/** Nama tool yang pernah dipakai di sesi ini — dipakai untuk mempertahankan kelompok tool. */
export function sessionToolNames(sessionId: string): string[] {
  const rows = conn()
    .prepare('SELECT tool_log FROM messages WHERE session_id = ? AND tool_log IS NOT NULL')
    .all(sessionId) as Array<{ tool_log: string }>
  const names = new Set<string>()
  for (const row of rows) {
    try {
      for (const activity of JSON.parse(row.tool_log) as Array<{ name?: string }>) {
        if (activity.name) names.add(activity.name)
      }
    } catch {
      /* baris korup diabaikan */
    }
  }
  return [...names]
}

export interface CalonRiwayat {
  sessionId: string
  judul: string
  peran: 'user' | 'assistant'
  teks: string
  createdAt: number
}

/**
 * Kandidat hasil pencarian riwayat — HANYA milik `username`.
 *
 * ⚠️ Filter pemilik ada di JOIN ke `sessions`, bukan disaring belakangan di
 * TypeScript. Kalau disaring belakangan, satu `return` yang lupa akan
 * membocorkan percakapan orang lain ke jendela chat — dan sesi lama tanpa
 * pemilik (`username` NULL) juga ikut tertolak di sini, sebagaimana mestinya.
 *
 * `bm25()` bernilai makin kecil makin relevan, jadi diurutkan menaik.
 */
export function cariPesan(
  username: string,
  ekspresiFts: string,
  limit: number
): CalonRiwayat[] {
  return conn()
    .prepare(
      `SELECT s.id AS session_id, s.title, m.role, m.content, m.created_at
         FROM messages_fts f
         JOIN messages m ON m.rowid = f.rowid
         JOIN sessions s ON s.id = m.session_id
        WHERE messages_fts MATCH ?
          AND s.username = ?
          AND length(m.content) > 0
        ORDER BY bm25(messages_fts)
        LIMIT ?`
    )
    .all(ekspresiFts, username.toLowerCase(), limit)
    .map((r: any) => ({
      sessionId: r.session_id,
      judul: r.title,
      peran: r.role,
      teks: r.content,
      createdAt: r.created_at
    }))
}

/**
 * Pesan terbaru milik user — cadangan ketika pencarian kata tidak menemukan apa pun.
 *
 * FTS5 mencocokkan KATA. Pertanyaan yang diparafrasekan ("pelanggan yang kabur"
 * untuk percakapan bertuliskan "pelanggan berhenti order") tidak akan cocok satu
 * kata pun. Untuk kasus itu, kandidatnya diambil dari yang terbaru lalu
 * diperingkat ulang oleh reranker yang memang mengerti makna.
 */
export function pesanTerbaru(username: string, limit: number): CalonRiwayat[] {
  return conn()
    .prepare(
      `SELECT s.id AS session_id, s.title, m.role, m.content, m.created_at
         FROM messages m
         JOIN sessions s ON s.id = m.session_id
        WHERE s.username = ?
          AND length(m.content) > 0
        ORDER BY m.created_at DESC
        LIMIT ?`
    )
    .all(username.toLowerCase(), limit)
    .map((r: any) => ({
      sessionId: r.session_id,
      judul: r.title,
      peran: r.role,
      teks: r.content,
      createdAt: r.created_at
    }))
}

/** Berapa pesan user di sesi ini yang sudah dibaca ekstraksi memori otomatis. */
export function memoriDiproses(sessionId: string): number {
  const row = conn()
    .prepare('SELECT diproses FROM memori_ekstrak WHERE session_id = ?')
    .get(sessionId) as { diproses: number } | undefined
  return row?.diproses ?? 0
}

export function setMemoriDiproses(sessionId: string, jumlah: number): void {
  conn()
    .prepare(
      `INSERT INTO memori_ekstrak (session_id, diproses, ts) VALUES (?, ?, ?)
       ON CONFLICT (session_id) DO UPDATE SET diproses = excluded.diproses, ts = excluded.ts`
    )
    .run(sessionId, jumlah, Date.now())
}

/** Apakah sesi ini sudah pernah memakai tool (dipakai router untuk konsistensi). */
export function sessionUsedTools(sessionId: string): boolean {
  const row = conn()
    .prepare('SELECT 1 AS x FROM messages WHERE session_id = ? AND tool_log IS NOT NULL LIMIT 1')
    .get(sessionId) as { x: number } | undefined
  return row !== undefined
}

// ------------------------------------------------ antrean monitoring pemakaian

export function antreAktivitas(eventId: string, payload: string): void {
  conn()
    .prepare('INSERT OR IGNORE INTO aktivitas_antrean (event_id, payload, dibuat) VALUES (?, ?, ?)')
    .run(eventId, payload, Date.now())
}

export function ambilAntrean(limit: number): Array<{ id: number; payload: string }> {
  return conn()
    .prepare('SELECT id, payload FROM aktivitas_antrean ORDER BY id ASC LIMIT ?')
    .all(limit) as Array<{ id: number; payload: string }>
}

export function buangAntrean(ids: readonly number[]): void {
  const hapus = conn().prepare('DELETE FROM aktivitas_antrean WHERE id = ?')
  conn().transaction((daftar: readonly number[]) => {
    for (const id of daftar) hapus.run(id)
  })(ids)
}

export function jumlahAntrean(): number {
  const row = conn().prepare('SELECT count(*) AS n FROM aktivitas_antrean').get() as { n: number }
  return row.n
}

/** Membuang antrean TERTUA bila melebihi `maks`. Mengembalikan berapa yang dibuang. */
export function pangkasAntrean(maks: number): number {
  const lebih = jumlahAntrean() - maks
  if (lebih <= 0) return 0
  conn()
    .prepare(
      'DELETE FROM aktivitas_antrean WHERE id IN (SELECT id FROM aktivitas_antrean ORDER BY id ASC LIMIT ?)'
    )
    .run(lebih)
  return lebih
}

/**
 * Apakah path ini pernah tercatat sebagai hasil tool di riwayat percakapan.
 *
 * Dipakai pratinjau gambar untuk percakapan LAMA: daftar di memori
 * (`berkasBolehDipratinjau`) hilang setiap aplikasi ditutup, sedangkan riwayat
 * chat tetap ada — tanpa ini, gambar yang dibuat kemarin tidak pernah tampil
 * lagi saat percakapannya dibuka.
 *
 * Dicocokkan sebagai teks di dalam `tool_log` (JSON), termasuk escape-nya.
 */
export function pathAdaDiRiwayat(file: string): boolean {
  // JSON.stringify memberi bentuk yang PERSIS seperti tersimpan (backslash
  // Windows tertulis ganda). Membandingkan path mentah tidak akan pernah cocok.
  const needle = JSON.stringify(file).slice(1, -1)
  const row = conn()
    .prepare("SELECT 1 AS x FROM messages WHERE tool_log LIKE '%' || ? || '%' LIMIT 1")
    .get(needle) as { x: number } | undefined
  return row !== undefined
}

// ------------------------------------------------------------------ galeri

export interface BarisGaleri {
  id: string
  username: string
  path: string
  thumb: string | null
  prompt: string
  ukuran: string
  sumber: 'halaman' | 'chat' | 'unggah'
  asalId: string | null
  sessionId: string | null
  dibuat: number
}

function barisGaleri(r: any): BarisGaleri {
  return {
    id: r.id,
    username: r.username,
    path: r.path,
    thumb: r.thumb ?? null,
    prompt: r.prompt,
    ukuran: r.ukuran,
    sumber: r.sumber === 'chat' || r.sumber === 'unggah' ? r.sumber : 'halaman',
    asalId: r.asal_id ?? null,
    sessionId: r.session_id ?? null,
    dibuat: r.dibuat
  }
}

export function simpanGaleri(b: BarisGaleri): void {
  conn()
    .prepare(
      `INSERT INTO galeri (id, username, path, thumb, prompt, ukuran, sumber, asal_id, session_id, dibuat)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      b.id,
      b.username.toLowerCase(),
      b.path,
      b.thumb,
      b.prompt,
      b.ukuran,
      b.sumber,
      b.asalId,
      b.sessionId,
      b.dibuat
    )
}

/**
 * Galeri milik SATU user. Filter pemilik di SQL, bukan disaring belakangan
 * (pola `cariPesan`): satu `return` yang lupa menyaring akan membocorkan gambar
 * orang lain yang memakai laptop yang sama.
 */
export function daftarGaleri(
  username: string,
  opsi: { sebelum?: number | null; cari?: string | null; limit: number }
): BarisGaleri[] {
  const cari = (opsi.cari ?? '').trim()
  return conn()
    .prepare(
      `SELECT * FROM galeri
        WHERE username = ?
          AND (? IS NULL OR dibuat < ?)
          AND (? = '' OR prompt LIKE '%' || ? || '%' ESCAPE '!')
        ORDER BY dibuat DESC
        LIMIT ?`
    )
    .all(
      username.toLowerCase(),
      opsi.sebelum ?? null,
      opsi.sebelum ?? null,
      cari,
      // "!" sebagai karakter escape, bukan backslash: backslash di dalam
      // template literal TS dan SQL sekaligus mudah salah hitung, dan salahnya
      // DIAM — pencarian "100%" mencocokkan apa saja.
      cari.replace(/[!%_]/g, (c) => `!${c}`),
      opsi.limit
    )
    .map(barisGaleri)
}

/** Satu gambar — HANYA bila milik user ini. null = tidak ada ATAU milik orang lain. */
export function galeriMilik(id: string, username: string): BarisGaleri | null {
  const r = conn()
    .prepare('SELECT * FROM galeri WHERE id = ? AND username = ?')
    .get(id, username.toLowerCase())
  return r ? barisGaleri(r) : null
}

export function hapusGaleri(id: string, username: string): boolean {
  const info = conn()
    .prepare('DELETE FROM galeri WHERE id = ? AND username = ?')
    .run(id, username.toLowerCase())
  return info.changes > 0
}

/**
 * Gambar yang pernah dibuat AIRA di CHAT milik user ini, dibaca dari riwayat.
 *
 * Dipakai sekali untuk mengisi galeri dengan gambar yang dibuat SEBELUM layar
 * Gambar ada — tanpa ini galeri tampak kosong padahal user sudah membuat
 * gambar kemarin, dan terlihat seperti AIRA kehilangan data.
 */
export function gambarDiRiwayat(
  username: string
): Array<{ path: string; sessionId: string; judul: string; dibuat: number }> {
  const rows = conn()
    .prepare(
      `SELECT m.tool_log, m.session_id, m.created_at, s.title
         FROM messages m JOIN sessions s ON s.id = m.session_id
        WHERE s.username = ?
          AND m.tool_log IS NOT NULL
          AND (m.tool_log LIKE '%buat_gambar%' OR m.tool_log LIKE '%ubah_gambar%')
        ORDER BY m.created_at ASC`
    )
    .all(username.toLowerCase()) as Array<{
    tool_log: string
    session_id: string
    created_at: number
    title: string
  }>
  const hasil: Array<{ path: string; sessionId: string; judul: string; dibuat: number }> = []
  for (const r of rows) {
    try {
      for (const a of JSON.parse(r.tool_log) as Array<{ name?: string; status?: string; outputPath?: string }>) {
        if ((a.name === 'buat_gambar' || a.name === 'ubah_gambar') && a.status === 'ok' && a.outputPath) {
          hasil.push({ path: a.outputPath, sessionId: r.session_id, judul: r.title, dibuat: r.created_at })
        }
      }
    } catch {
      /* baris korup diabaikan */
    }
  }
  return hasil
}

/**
 * Berkas yang pernah DIHASILKAN AIRA untuk user ini (panel "File Terbaru" di
 * Beranda), terbaru dulu, satu baris per path.
 *
 * Sumbernya `outputPath` tool yang SUKSES di riwayat chat milik user — bukan
 * pindaian folder. Yang tampil hanya apa yang memang dibuat AIRA untuknya
 * (aturan 16: riwayat milik orang), dan daftar ini juga dipakai sebagai
 * DAFTAR-IZIN untuk membuka berkasnya (pola §69, bukan `resolveInBoundary`).
 * Keberadaan berkas diperiksa pemanggil; di sini murni riwayat.
 */
export function berkasDiRiwayat(
  username: string,
  batas: number
): Array<{ path: string; sessionId: string; judul: string; dibuat: number }> {
  const rows = conn()
    .prepare(
      `SELECT m.tool_log, m.session_id, m.created_at, s.title
         FROM messages m JOIN sessions s ON s.id = m.session_id
        WHERE s.username = ?
          AND m.tool_log LIKE '%outputPath%'
        ORDER BY m.created_at DESC
        LIMIT 400`
    )
    .all(username.toLowerCase()) as Array<{
    tool_log: string
    session_id: string
    created_at: number
    title: string
  }>
  const dilihat = new Set<string>()
  const hasil: Array<{ path: string; sessionId: string; judul: string; dibuat: number }> = []
  for (const r of rows) {
    try {
      const log = JSON.parse(r.tool_log) as Array<{ status?: string; outputPath?: string }>
      for (const a of [...log].reverse()) {
        if (a.status !== 'ok' || !a.outputPath) continue
        const kunci = a.outputPath.toLowerCase()
        if (dilihat.has(kunci)) continue
        dilihat.add(kunci)
        hasil.push({ path: a.outputPath, sessionId: r.session_id, judul: r.title, dibuat: r.created_at })
        if (hasil.length >= batas) return hasil
      }
    } catch {
      /* baris korup diabaikan */
    }
  }
  return hasil
}

/** Apakah path ini tercatat di galeri SIAPA PUN — dipakai pratinjau di chat. */
export function pathDiGaleri(file: string, username: string): boolean {
  const r = conn()
    .prepare('SELECT 1 AS x FROM galeri WHERE lower(path) = lower(?) AND username = ? LIMIT 1')
    .get(file, username.toLowerCase())
  return r !== undefined
}

export function audit(component: string, action: string, detail?: string): void {
  conn()
    .prepare('INSERT INTO audit_log (ts, component, action, detail) VALUES (?, ?, ?, ?)')
    .run(Date.now(), component, action, detail ?? null)
}
