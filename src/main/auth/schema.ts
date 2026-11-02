import { authExec, authQuery } from './db'
import { hashPassword } from './password'
import { logger } from '../logger'
import { kodeDivisi, MENUS, type Role } from './roles'

/**
 * Penjalankan statement. Sengaja disuntikkan dari luar supaya `tests/auth-live-check.ts`
 * bisa menerapkan skema yang SAMA PERSIS lewat pool-nya sendiri — kalau DDL disalin
 * ke file test, yang diuji bukan lagi skema yang dipakai aplikasi.
 */
export type Exec = (sql: string, params?: unknown[]) => Promise<unknown>

/** Seperti `Exec`, tapi hasilnya dipakai — untuk memeriksa apa yang sudah ter-seed. */
export type QueryRows = (sql: string, params?: unknown[]) => Promise<unknown[]>

// Skema tabel login + seed user dummy.
//
// Idempoten: seluruhnya `IF NOT EXISTS` / `ON CONFLICT DO NOTHING`, jadi aman
// dijalankan setiap kali aplikasi start. Ini juga yang membuat pemasangan ke
// laptop baru tidak butuh langkah manual apa pun.
//
// ⚠️ Tabel-tabel ini duduk di `DB-REPOSITORY` — database yang sama dengan
// `SalesRepository` yang memuat data pasien. Karena itu `tb_login_aira` masuk
// daftar-tolak `db_query` (lihat `tools/db-safety.ts`): tanpa itu, user bisa
// menyuruh model `SELECT * FROM tb_login_aira` dan hash password seluruh
// direksi keluar ke jendela chat.

// ⚠️ SELURUH blok di bawah ini satu template literal. JANGAN memakai petik
// terbalik di dalam komentar SQL-nya — satu saja memutus berkasnya, dan galatnya
// menunjuk ke tempat lain ("Expected ; but found ...") sehingga tidak terbaca
// sebagai masalah tanda kutip. Pakai petik ganda untuk mengutip nama tabel/kolom.
// Terjadi nyata 8 Sep 2026 saat menambahkan tabel chat; jebakan yang sama sudah
// tertulis untuk `pdf/style.ts` di CLAUDE.md §49 dan tetap tertabrak lagi di sini.
const DDL = `
CREATE TABLE IF NOT EXISTS tb_login_aira (
  id            bigserial PRIMARY KEY,
  username      text        NOT NULL UNIQUE,
  password      text        NOT NULL,
  role          text        NOT NULL,
  exp_date      date,
  is_banned     boolean     NOT NULL DEFAULT false,
  banned_reason text,
  banned_at     timestamptz,
  banned_by     text,
  last_login_at timestamptz,
  last_login_ip text,
  last_login_host text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tb_login_aira_role_chk
    CHECK (role IN ('super_admin', 'direktur', 'manager', 'spv', 'staff'))
);

-- Penambahan role 'staff' pada instalasi yang sudah berjalan. CHECK constraint
-- lama hanya mengenal empat role, dan "CREATE TABLE IF NOT EXISTS" di atas tidak
-- menyentuh tabel yang sudah ada — tanpa blok ini, membuat user Staff ditolak
-- database di tempat yang skemanya dibuat sebelum 19 Agu 2026.
ALTER TABLE tb_login_aira DROP CONSTRAINT IF EXISTS tb_login_aira_role_chk;
ALTER TABLE tb_login_aira ADD CONSTRAINT tb_login_aira_role_chk
  CHECK (role IN ('super_admin', 'direktur', 'manager', 'spv', 'staff'));

-- Username dibandingkan tanpa memandang besar-kecil huruf. Tanpa index ini,
-- "Direktur" dan "direktur" bisa terdaftar sebagai DUA akun berbeda sementara
-- keduanya lolos login — dan mana yang terpakai jadi bergantung urutan baris.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tb_login_aira_username_lower
  ON tb_login_aira (lower(username));

CREATE TABLE IF NOT EXISTS tb_login_aira_log (
  id          bigserial PRIMARY KEY,
  username    text        NOT NULL,
  role        text,
  status      text        NOT NULL,
  ip          text,
  hostname    text,
  os_user     text,
  app_version text,
  ts          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tb_login_aira_log_user_ts
  ON tb_login_aira_log (lower(username), ts DESC);
CREATE INDEX IF NOT EXISTS idx_tb_login_aira_log_ts
  ON tb_login_aira_log (ts DESC);

CREATE TABLE IF NOT EXISTS tb_menu_akses_aira (
  role       text        NOT NULL,
  menu       text        NOT NULL,
  diizinkan  boolean     NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  PRIMARY KEY (role, menu)
);

-- Sengaja TANPA CHECK pada kolom menu.
-- Daftar menu hidup di kode ("MENUS" di roles.ts) karena tiap menu butuh mode,
-- prompt, dan toolset-nya sendiri. Kalau daftarnya juga dipatok sebagai constraint
-- di sini, menambah "Tanya Data Laboratorium" berarti mengubah skema database
-- produksi — bukan sekadar menambah baris kode. Baris bermenu asing diabaikan
-- saat dibaca ("isMenu"), jadi tidak ada yang bisa membuka menu lewat SQL.
ALTER TABLE tb_menu_akses_aira DROP CONSTRAINT IF EXISTS tb_menu_akses_aira_role_chk;
ALTER TABLE tb_menu_akses_aira DROP CONSTRAINT IF EXISTS tb_menu_akses_aira_menu_chk;

-- Daftar divisi. Tabel, bukan konstanta di kode: divisi berubah lebih sering
-- daripada aplikasi dibangun ulang, dan menambah divisi tidak boleh berarti
-- mengirim .exe baru ke semua laptop.
CREATE TABLE IF NOT EXISTS tb_divisi_aira (
  kode       text        PRIMARY KEY,
  nama       text        NOT NULL,
  aktif      boolean     NOT NULL DEFAULT true,
  urutan     integer     NOT NULL DEFAULT 999,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tb_divisi_aira_nama_lower
  ON tb_divisi_aira (lower(nama));

-- Divisi milik tiap user. Banyak-ke-banyak: satu SPV/Manager bisa memegang 2–3
-- divisi sekaligus (ketentuan user 19 Agu 2026).
CREATE TABLE IF NOT EXISTS tb_user_divisi_aira (
  username    text NOT NULL,
  divisi_kode text NOT NULL REFERENCES tb_divisi_aira(kode) ON DELETE CASCADE,
  PRIMARY KEY (username, divisi_kode)
);

CREATE INDEX IF NOT EXISTS idx_tb_user_divisi_aira_user
  ON tb_user_divisi_aira (lower(username));

-- Divisi mana yang boleh melihat tiap menu.
CREATE TABLE IF NOT EXISTS tb_menu_divisi_aira (
  menu        text        NOT NULL,
  divisi_kode text        NOT NULL REFERENCES tb_divisi_aira(kode) ON DELETE CASCADE,
  diizinkan   boolean     NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  PRIMARY KEY (menu, divisi_kode)
);

-- Matriks akses (30 Sep 2026): menu × role × divisi dalam SATU tabel.
-- Menggantikan tb_menu_akses_aira + tb_menu_divisi_aira sebagai sumber keputusan.
-- Dua tabel lama TIDAK dihapus: build lama yang masih terpasang tetap membacanya,
-- dan isinya jadi bahan migrasi sekali jalan (lihat applySchema).
-- Centangan divisi di tabel lama berlaku untuk SEMUA role sekaligus, sehingga
-- "Manager PA TP boleh Sales, SPV PA TP tidak, SPV IT boleh" tidak bisa diatur.
-- Hanya role yang bisa diatur yang punya baris: Direktur & Super Admin dikunci di
-- kode (AKSES_TAK_TERCABUT), baris untuk mereka hanya akan menyesatkan pembaca SQL.
CREATE TABLE IF NOT EXISTS tb_menu_role_divisi_aira (
  menu        text        NOT NULL,
  role        text        NOT NULL CHECK (role IN ('manager', 'spv', 'staff')),
  divisi_kode text        NOT NULL REFERENCES tb_divisi_aira(kode) ON DELETE CASCADE,
  diizinkan   boolean     NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  PRIMARY KEY (menu, role, divisi_kode)
);

-- Masukan & laporan masalah dari user uji coba.
--
-- Di Postgres, BUKAN di SQLite lokal. Ini keputusan yang menentukan: masukan yang
-- tersimpan di laptop masing-masing user tidak akan pernah terbaca siapa pun —
-- tidak ada auto-update, tidak ada mekanisme lain yang menariknya keluar, dan
-- justru orang yang paling perlu didengar (direksi/manajer) adalah yang paling
-- kecil kemungkinannya mengirim file secara manual.
--
-- ⚠️ Tabel ini masuk daftar-tolak "tools/db-safety.ts" bersama tabel login.
-- Alasannya sama persis: ia duduk di DB-REPOSITORY yang sama dengan
-- SalesRepository, jadi connection string yang sah untuk pertanyaan penjualan
-- juga sah untuk membacanya — dan kolom "pertanyaan"/"jawaban" bisa memuat angka
-- omzet maupun cuplikan dokumen pasien yang dilampirkan user.
CREATE TABLE IF NOT EXISTS tb_feedback_aira (
  id             bigserial   PRIMARY KEY,

  -- SIAPA. Semuanya diisi main process dari sesi + identitasMesin(), tidak
  -- satu pun berasal dari renderer.
  username       text        NOT NULL,
  role           text,
  -- Snapshot, sengaja bukan FK ke tb_divisi_aira: kalau user dipindah divisi
  -- bulan depan, laporan lamanya tidak boleh ikut berubah artinya.
  divisi         text,
  hostname       text,
  os_user        text,
  ip             text,
  app_version    text,

  -- APA
  jenis          text        NOT NULL,
  dampak         text,
  isi            text        NOT NULL,

  -- KONTEKS. Terisi untuk laporan yang datang dari tombol di gelembung jawaban;
  -- NULL untuk masukan umum lewat menu.
  sesi_id        text,
  pesan_id       text,
  mode           text,
  model          text,
  -- Disimpan UTUH, bukan sekadar pesan_id. Riwayat chat ada di SQLite di laptop
  -- user dan bisa dihapus kapan saja lewat tombol hapus riwayat — kalau hanya
  -- id-nya yang dikirim, laporan tentang jawaban yang salah akan menunjuk ke
  -- sesuatu yang sudah tidak ada saat dibuka. Panjangnya dipotong di kode
  -- ("potongCuplikan") supaya satu laporan tidak membawa hasil read_pdf.
  pertanyaan     text,
  jawaban        text,
  tool_log       jsonb,
  sertakan_chat  boolean     NOT NULL DEFAULT false,

  -- TINDAK LANJUT
  status         text        NOT NULL DEFAULT 'baru',
  catatan_admin  text,
  ditangani_oleh text,
  ditangani_at   timestamptz,

  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tb_feedback_aira_jenis_chk
    CHECK (jenis IN ('bug', 'usulan', 'tidak_terjawab', 'lain'))
);

-- ⚠️ "status" sengaja TANPA CHECK, sementara "jenis" diberi CHECK.
-- Bedanya disengaja: "jenis" menentukan bentuk form, jadi ia memang harus
-- berubah bersama kode. "status" adalah alur kerja tindak lanjut, yang akan
-- berubah lebih sering daripada aplikasi dibangun ulang — dan menambah satu
-- status tidak boleh berarti mengubah skema database produksi. Alasan yang sama
-- dengan kolom "menu" di tb_menu_akses_aira.

CREATE INDEX IF NOT EXISTS idx_tb_feedback_aira_status_ts
  ON tb_feedback_aira (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tb_feedback_aira_user
  ON tb_feedback_aira (lower(username), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tb_feedback_aira_ts
  ON tb_feedback_aira (created_at DESC);

-- Lampiran masukan (30 Sep 2026) — tangkapan layar / berkas bukti.
-- ⚠️ bytea di database produksi: batas ukuran & daftar-IZIN jenis berkas ditegakkan
-- "periksaLampiranMasukan" (feedback/rules.ts), memakai MIME_DIIZINKAN chat — SATU
-- daftar untuk dua jalur. Isi berkas tidak pernah ikut di daftar masukan; hanya
-- diunduh saat diminta (pemilik atau Super Admin).
ALTER TABLE tb_feedback_aira ADD COLUMN IF NOT EXISTS lampiran_nama   text;
ALTER TABLE tb_feedback_aira ADD COLUMN IF NOT EXISTS lampiran_mime   text;
ALTER TABLE tb_feedback_aira ADD COLUMN IF NOT EXISTS lampiran_ukuran integer;
ALTER TABLE tb_feedback_aira ADD COLUMN IF NOT EXISTS lampiran_data   bytea;

-- Memori AIRA: hal yang diingat TENTANG ORANGNYA.
--
-- Di Postgres, bukan SQLite lokal — berbeda dari riwayat chat, dan itu
-- disengaja. Memori melekat pada orang, dan orangnya login dari laptop mana pun.
-- Disimpan lokal, AIRA akan "mengenali" seseorang di satu laptop lalu
-- melupakannya di laptop sebelah.
--
-- ⚠️ Kolom "isi" TIDAK BOLEH memuat nilai data (angka penjualan, nama pasien).
-- Ditegakkan di kode ("memori/rules.ts", PENANDA_DATA) sebelum baris ditulis,
-- bukan lewat CHECK: aturannya berupa pengenalan kalimat, bukan bentuk nilai.
-- Alasannya: angka yang diingat ikut disuntikkan ke setiap percakapan
-- berikutnya dan akan disebut ulang berbulan-bulan kemudian sebagai fakta yang
-- masih berlaku, padahal tabel sumbernya berubah tiap jam.
CREATE TABLE IF NOT EXISTS tb_memori_aira (
  id         bigserial   PRIMARY KEY,
  username   text        NOT NULL,
  isi        text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tb_memori_aira_user
  ON tb_memori_aira (lower(username), created_at);

-- Dari mana memori ini berasal: "user" (ia menyuruh "ingat …") atau "otomatis"
-- (disimpulkan AIRA dari percakapan, Lapis 4).
--
-- ⚠️ Dibedakan karena aturannya berbeda, bukan sekadar untuk label di layar:
-- memori dari user TIDAK PERNAH dibuang otomatis (ia memintanya sendiri, dan
-- hilangnya tanpa keterangan adalah kegagalan diam), sedangkan memori otomatis
-- BOLEH digilir saat kuotanya penuh — ia tidak pernah dijanjikan kepada siapa pun.
ALTER TABLE tb_memori_aira ADD COLUMN IF NOT EXISTS sumber text NOT NULL DEFAULT 'user';

-- ---------------------------------------------------------------- chat antar user
-- Pesan langsung antar pengguna AIRA (permintaan user 8 Sep 2026), beserta daftar
-- siapa yang sedang membuka aplikasi.
--
-- ⚠️ KEDUA tabel ini WAJIB ada di "TABEL_TERLARANG" (tools/db-safety.ts). Alasannya
-- lebih keras daripada "tb_feedback_aira": isinya percakapan pribadi antar karyawan,
-- dan connection string yang sah untuk pertanyaan penjualan juga sah untuk
-- membacanya. Tanpa larangan itu, siapa pun yang boleh memakai "db_query" bisa
-- membaca chat direktur.
--
-- ⚠️ Kehadiran disimpan di tabel SENDIRI, bukan sebagai kolom di "tb_login_aira".
-- Tabel itu memuat hash password seluruh user; menulisinya tiap belasan detik demi
-- status "online" berarti trafik tulis terus-menerus ke tabel kredensial — risiko
-- yang tidak sepadan dengan sebuah titik hijau.
CREATE TABLE IF NOT EXISTS tb_chat_aira_hadir (
  username  text        PRIMARY KEY,
  last_seen timestamptz NOT NULL DEFAULT now(),
  hostname  text
);

CREATE INDEX IF NOT EXISTS idx_tb_chat_aira_hadir_seen
  ON tb_chat_aira_hadir (last_seen);

-- Kolom lampiran sengaja SUDAH ADA sejak awal walau pengiriman berkas menyusul di
-- tahap berikutnya — supaya tidak perlu migrasi kedua di database produksi.
--
-- ⚠️ "lampiran_data" bytea: berkas ikut membesarkan database produksi yang dipakai
-- bersama aplikasi lain. Karena itu ukurannya dibatasi keras di "chat/rules.ts" dan
-- lampiran lama dibuang berkala — batas yang tidak ditegakkan akan jadi tabel
-- puluhan giga yang tidak ada yang berani hapus.
CREATE TABLE IF NOT EXISTS tb_chat_aira_pesan (
  id              bigserial   PRIMARY KEY,
  pengirim        text        NOT NULL,
  penerima        text        NOT NULL,
  isi             text        NOT NULL DEFAULT '',
  lampiran_nama   text,
  lampiran_mime   text,
  lampiran_ukuran integer,
  lampiran_data   bytea,
  created_at      timestamptz NOT NULL DEFAULT now(),
  dibaca_at       timestamptz
);

-- Untuk membuka satu ruang chat: seluruh pesan antara DUA orang, urut waktu.
CREATE INDEX IF NOT EXISTS idx_tb_chat_aira_pesan_pasangan
  ON tb_chat_aira_pesan (lower(pengirim), lower(penerima), created_at);

-- Untuk lencana "belum dibaca" tanpa memindai seluruh tabel.
CREATE INDEX IF NOT EXISTS idx_tb_chat_aira_pesan_masuk
  ON tb_chat_aira_pesan (lower(penerima), dibaca_at);

-- Hapus pesan (16 Sep 2026) — SOFT DELETE, barisnya TIDAK pernah dibuang.
--
-- ⚠️ Yang dihapus adalah ISINYA (teks + lampiran); barisnya tinggal sebagai nisan
-- yang di layar berbunyi "Pesan ini dihapus". Alasannya sama dengan pembersihan
-- lampiran 30 hari: percakapan yang tiba-tiba berlubang membuat orang mengira ada
-- yang hilang karena aplikasinya rusak, bukan karena seseorang menghapusnya. Dan
-- SOUL.md menjanjikan "harus bisa dijawab: AIRA melakukan apa kemarin" — nisan +
-- "dihapus_oleh" menjaga janji itu tanpa memperlihatkan isinya kepada siapa pun.
ALTER TABLE tb_chat_aira_pesan ADD COLUMN IF NOT EXISTS dihapus_at  timestamptz;
ALTER TABLE tb_chat_aira_pesan ADD COLUMN IF NOT EXISTS dihapus_oleh text;

-- Grup chat (16 Sep 2026, tahap 3 "WhatsApp lite").
CREATE TABLE IF NOT EXISTS tb_chat_aira_grup (
  id          bigserial   PRIMARY KEY,
  nama        text        NOT NULL,
  dibuat_oleh text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ⚠️ Rentang keanggotaan dicatat dengan ID PESAN, bukan waktu — pelajaran yang
-- sama dengan penanda notifikasi: jam laptop dan jam server berbeda beberapa
-- detik, dan selisih itu cukup untuk memperlihatkan satu pesan dari SEBELUM
-- seseorang bergabung. Di sini akibatnya bukan bunyi ganda, melainkan kebocoran.
--
--   gabung_id  = id pesan terakhir di seluruh tabel saat ia ditambahkan.
--                Ia hanya melihat pesan grup dengan id > gabung_id.
--   keluar_id  = id pesan terakhir saat ia keluar/dikeluarkan (NULL = masih anggota).
--                Ia tetap bisa membaca pesan sampai titik itu, tidak sesudahnya.
--   dibaca_id  = pesan grup terakhir yang sudah ia lihat — sumber hitungan belum dibaca.
--
-- Satu baris per (grup, orang). Bergabung ulang MENIMPA gabung_id: yang pernah ia
-- baca di keanggotaan sebelumnya tidak terlihat lagi. Disengaja — lebih baik
-- kehilangan riwayat lama daripada memperlihatkan pesan yang dikirim saat ia
-- sedang bukan anggota.
CREATE TABLE IF NOT EXISTS tb_chat_aira_grup_anggota (
  grup_id    bigint      NOT NULL REFERENCES tb_chat_aira_grup(id),
  username   text        NOT NULL,
  peran      text        NOT NULL DEFAULT 'anggota',
  gabung_id  bigint      NOT NULL DEFAULT 0,
  keluar_id  bigint,
  dibaca_id  bigint      NOT NULL DEFAULT 0,
  gabung_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (grup_id, username)
);

-- ⚠️ Constraint & ubah-kolom di bawah dibungkus pemeriksaan "sudah ada belum".
-- Blok skema ini berjalan SETIAP kali AIRA dibuka, di SETIAP laptop. Pola
-- DROP-lalu-ADD mengambil kunci ACCESS EXCLUSIVE dan memvalidasi ulang seluruh
-- tabel tiap kali — pada tabel chat yang terus tumbuh, dengan puluhan laptop
-- menyala bersamaan jam 8 pagi, itu antrean kunci di database produksi yang
-- dipakai bersama aplikasi lain. Cukup sekali seumur tabel.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tb_chat_aira_grup_anggota_peran_chk') THEN
    ALTER TABLE tb_chat_aira_grup_anggota ADD CONSTRAINT tb_chat_aira_grup_anggota_peran_chk
      CHECK (peran IN ('admin', 'anggota'));
  END IF;
END $$;

-- "Grup mana saja milik saya" — dipanggil tiap 10 detik oleh pengawas notifikasi.
CREATE INDEX IF NOT EXISTS idx_tb_chat_aira_grup_anggota_user
  ON tb_chat_aira_grup_anggota (lower(username));

-- Pesan grup: penerima KOSONG, grup_id terisi.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'tb_chat_aira_pesan' AND column_name = 'penerima' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE tb_chat_aira_pesan ALTER COLUMN penerima DROP NOT NULL;
  END IF;
END $$;
ALTER TABLE tb_chat_aira_pesan ADD COLUMN IF NOT EXISTS grup_id bigint REFERENCES tb_chat_aira_grup(id);
-- Pesan sistem ("budi menambahkan siti"). jenis NULL = pesan biasa.
ALTER TABLE tb_chat_aira_pesan ADD COLUMN IF NOT EXISTS jenis  text;
ALTER TABLE tb_chat_aira_pesan ADD COLUMN IF NOT EXISTS target text;

-- ⚠️ Tepat SATU tujuan: orang ATAU grup. Ditegakkan DATABASE, bukan kesepakatan
-- antar-programmer. Tanpa ini, satu jalur yang lupa mengisi salah satunya
-- menghasilkan pesan tak bertuan yang tidak terlihat oleh siapa pun — atau, lebih
-- buruk, pesan ber-penerima DAN ber-grup yang muncul di dua tempat sekaligus.
-- Baris lama (penerima terisi, grup_id kosong) lolos pemeriksaan ini.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tb_chat_aira_pesan_tujuan_chk') THEN
    ALTER TABLE tb_chat_aira_pesan ADD CONSTRAINT tb_chat_aira_pesan_tujuan_chk
      CHECK ((penerima IS NULL) <> (grup_id IS NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tb_chat_aira_pesan_grup
  ON tb_chat_aira_pesan (grup_id, id) WHERE grup_id IS NOT NULL;

-- ---------------------------------------------------------- monitoring pemakaian
-- Satu baris per pertanyaan ke AIRA (permintaan atasan user, 16 Sep 2026).
-- Riwayat chat tinggal di SQLite tiap laptop; tabel ini satu-satunya tempat
-- Super Admin bisa melihat "siapa memakai AIRA untuk apa, kapan".
--
-- ⚠️ YANG DICATAT: metadata + teks pertanyaan. JAWABAN AIRA TIDAK PERNAH ADA DI
-- SINI, begitu pula argumen tool dan isi lampiran (hanya namanya). Nilai data
-- ada di jawaban, dan connection string database ini bisa ditarik dari ".exe"
-- (aturan 13) — yang tidak dikirim adalah satu-satunya yang benar-benar aman.
--
-- ⚠️ WAJIB di TABEL_TERLARANG (tools/db-safety.ts), KEDUA nama tabel.
--
-- "event_id" UNIK: baris dikirim dari antrean lokal dan bisa terkirim dua kali
-- (koneksi putus SESUDAH INSERT berhasil, sebelum antrean dibersihkan). Tanpa
-- kunci ini satu pertanyaan terhitung dua kali, dan statistik pemakaian yang
-- menggelembung sama buruknya dengan omzet yang menggelembung.
--
-- "waktu" = jam LAPTOP saat pertanyaan dikirim, "diterima_at" = jam server.
-- Keduanya disimpan: laptop yang offline mengirim belakangan, dan yang ingin
-- diketahui adalah kapan orangnya bertanya, bukan kapan barisnya tiba.
CREATE TABLE IF NOT EXISTS tb_aktivitas_aira (
  id                bigserial   PRIMARY KEY,
  event_id          uuid        NOT NULL UNIQUE,
  username          text        NOT NULL,
  role              text,
  divisi            text,
  hostname          text,
  os_user           text,
  app_version       text,
  waktu             timestamptz NOT NULL,
  diterima_at       timestamptz NOT NULL DEFAULT now(),
  mode              text,
  model             text,
  sesi_id           text,
  -- Dikosongkan otomatis sesudah RETENSI_PROMPT_HARI (monitoring/rules.ts).
  prompt            text,
  prompt_dipotong   boolean     NOT NULL DEFAULT false,
  lampiran          text[],
  tools             jsonb,
  jumlah_tool       integer     NOT NULL DEFAULT 0,
  status            text        NOT NULL,
  kode_galat        text,
  durasi_ms         integer,
  prompt_tokens     integer,
  completion_tokens integer
);

CREATE INDEX IF NOT EXISTS idx_tb_aktivitas_aira_waktu
  ON tb_aktivitas_aira (waktu DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_tb_aktivitas_aira_user
  ON tb_aktivitas_aira (lower(username), waktu DESC);
-- Pembersihan retensi jalan tiap start di tiap laptop; index parsial ini
-- membuatnya hanya menyentuh baris yang teksnya MASIH ada.
CREATE INDEX IF NOT EXISTS idx_tb_aktivitas_aira_retensi
  ON tb_aktivitas_aira (waktu) WHERE prompt IS NOT NULL;

-- Siapa membuka layar monitoring, melihat siapa, kapan. Pengawas ikut terawasi:
-- tanpa ini, "Super Admin membaca pertanyaan direktur" tidak meninggalkan jejak.
CREATE TABLE IF NOT EXISTS tb_aktivitas_akses_aira (
  id               bigserial   PRIMARY KEY,
  admin            text        NOT NULL,
  username_dilihat text,
  periode_hari     integer,
  cari             text,
  hostname         text,
  waktu            timestamptz NOT NULL DEFAULT now()
);
`

/**
 * User dummy. Username sengaja disamakan dengan nama role (permintaan user),
 * password default `12345` untuk semuanya.
 *
 * ⚠️ Yang masuk kolom `password` adalah HASH scrypt, bukan `12345`. Password polos
 * tidak pernah menyentuh database maupun log — lihat `password.ts`.
 */
const DUMMY: Array<{ username: string; role: Role }> = [
  { username: 'superadmin', role: 'super_admin' },
  { username: 'direktur', role: 'direktur' }
  /*
   * ⚠️ `manager`, `spv`, dan `staff` DIHAPUS dari seed (9 Sep 2026, permintaan user
   * menjelang sebar `.exe`). JANGAN dikembalikan tanpa alasan kuat.
   *
   * Sebabnya bukan kerapian: SEMUA user seed berpassword `12345` (PASSWORD_DUMMY).
   * Selama mereka ada di daftar ini, menghapusnya lewat panel Super Admin TIDAK
   * BERTAHAN — `applySchema` di bawah memasukkannya kembali pada start berikutnya,
   * di SETIAP laptop yang memasang AIRA. Jadi akun berpassword lemah itu akan
   * terus hidup lagi tanpa ada yang menyadarinya.
   *
   * Yang tersisa hanya dua akun yang memang dibutuhkan agar instalasi baru bisa
   * dimasuki. Akun sungguhan dibuat Super Admin lewat panel User.
   */
]

export const PASSWORD_DUMMY = '12345'

/**
 * Divisi awal (daftar dari user, 19 Agu 2026). Hanya SEED — sesudah tabelnya ada,
 * Super Admin yang menambah/menonaktifkan lewat Settings. Divisi yang dihapus dari
 * daftar ini TIDAK ikut hilang dari database, karena user bisa saja sudah
 * ditempelkan padanya.
 */
export const DIVISI_AWAL = [
  'IP',
  'PK',
  'Phlebo',
  'Mikrobiologi',
  'HRGA',
  'Biosafety',
  'Genomics',
  'PA TP',
  'PA IHC',
  'PA Mol',
  'Logistik',
  'CDM',
  'QMS',
  'FA',
  'IT',
  'Sales',
  'Marketing',
  'CRIO',
  'Intern'
] as const

/**
 * Menerapkan skema + seed lewat executor mana pun. Idempoten.
 *
 * ⚠️ Seed hanya dikerjakan bila memang ADA yang belum terisi.
 *
 * Versi pertama menjalankannya tanpa syarat dan mengandalkan `ON CONFLICT DO NOTHING`
 * untuk kerapiannya. Itu benar hasilnya tapi mahal: `hashPassword` dipanggil empat
 * kali SETIAP aplikasi start (terukur 84 ms sekali jalan) dan hasilnya langsung
 * dibuang karena usernya sudah ada, ditambah 12 round-trip ke database yang semuanya
 * tidak mengubah apa pun. Terukur 2.061 ms untuk pekerjaan yang biasanya nol.
 *
 * Sekarang: satu SELECT murah dulu, dan jalur normal (semua sudah ter-seed) berhenti
 * di situ. `queryRows` dipisah dari `exec` karena `exec` hanya perlu menjalankan,
 * sedangkan pemeriksaan ini butuh hasilnya.
 */
export async function applySchema(exec: Exec, queryRows?: QueryRows): Promise<void> {
  await exec(DDL)

  const sudahAda = queryRows ? await usernameYangAda(queryRows) : new Set<string>()
  const kurang = DUMMY.filter((d) => !sudahAda.has(d.username.toLowerCase()))

  // ON CONFLICT DO NOTHING tetap dipertahankan sebagai jaring pengaman: dua instance
  // AIRA bisa start bersamaan dan lolos pemeriksaan di atas pada saat yang sama.
  for (const { username, role } of kurang) {
    const hash = await hashPassword(PASSWORD_DUMMY)
    await exec(
      `INSERT INTO tb_login_aira (username, password, role)
       VALUES ($1, $2, $3)
       -- Tanpa menyebut kolom: ada DUA batasan unik di sini (kolom username dan
       -- index lower(username)). Menyebut salah satunya membuat bentrokan pada
       -- yang lain naik sebagai error dan menggagalkan startup.
       ON CONFLICT DO NOTHING`,
      [username, hash, role]
    )
  }

  // Divisi awal.
  const nilaiDiv: unknown[] = []
  const tupleDiv: string[] = []
  DIVISI_AWAL.forEach((nama, i) => {
    const kode = kodeDivisi(nama)
    if (!kode) return
    tupleDiv.push(`($${nilaiDiv.length + 1}, $${nilaiDiv.length + 2}, $${nilaiDiv.length + 3})`)
    nilaiDiv.push(kode, nama, i)
  })
  if (tupleDiv.length > 0) {
    await exec(
      `INSERT INTO tb_divisi_aira (kode, nama, urutan)
       VALUES ${tupleDiv.join(', ')}
       ON CONFLICT (kode) DO NOTHING`,
      nilaiDiv
    )
  }

  // Matriks akses (30 Sep 2026): pindahkan SEKALI dari dua matriks lama.
  //
  // Sel (menu, role, divisi) = role dicentang DI tb_menu_akses_aira DAN divisi
  // dicentang DI tb_menu_divisi_aira — persis aturan lama, sehingga tidak ada satu
  // orang pun yang aksesnya berubah hari ini (dibuktikan `matriksDariLama` di test
  // dan `auth-live-check` terhadap seluruh user sungguhan).
  //
  // ⚠️ Hanya berjalan selama tabel baru KOSONG, dan menulis baris untuk SEMUA
  // kombinasi (juga yang false) supaya sesudahnya tabel tidak pernah kosong lagi.
  // Kalau hanya baris true yang ditulis, Super Admin yang menutup semuanya akan
  // membuat migrasi berjalan ULANG saat start berikutnya dan membuka kembali apa
  // yang baru ia tutup dari isi tabel lama. Dua laptop yang start bersamaan aman:
  // `ON CONFLICT DO NOTHING`.
  //
  // ⚠️ Pengisian awal matriks lama (role × menu dan "Sales + Master Data untuk
  // SEMUA divisi") SENGAJA dibuang dari sini. Yang kedua berjalan tiap start dengan
  // CROSS JOIN ke seluruh divisi: setiap divisi yang dibuat lewat panel ikut
  // terbuka ke Sales & Master Data di start berikutnya. Divisi baru kini lahir
  // tertutup di tabel baru (tidak ada baris = tertutup).
  await exec(
    `INSERT INTO tb_menu_role_divisi_aira (menu, role, divisi_kode, diizinkan, updated_by)
     SELECT r.menu, r.role, d.kode,
            r.diizinkan AND coalesce(md.diizinkan, false),
            'migrasi'
       FROM tb_menu_akses_aira r
       CROSS JOIN tb_divisi_aira d
       LEFT JOIN tb_menu_divisi_aira md
              ON md.menu = r.menu AND md.divisi_kode = d.kode
      WHERE r.role IN ('manager', 'spv', 'staff')
        AND r.menu = ANY($1::text[])
        AND NOT EXISTS (SELECT 1 FROM tb_menu_role_divisi_aira)
     ON CONFLICT (menu, role, divisi_kode) DO NOTHING`,
    [[...MENUS]]
  )
}

async function usernameYangAda(queryRows: QueryRows): Promise<Set<string>> {
  const rows = await queryRows('SELECT lower(username) AS u FROM tb_login_aira')
  return new Set(rows.map((r) => String((r as { u: string }).u)))
}

export async function migrateAuthSchema(): Promise<void> {
  const t0 = Date.now()
  await applySchema(
    (sql, params) => (params === undefined ? authExec(sql) : authQuery(sql, params)),
    (sql, params) => authQuery(sql, params ?? [])
  )
  logger().info({ ms: Date.now() - t0 }, 'skema login siap')
}
