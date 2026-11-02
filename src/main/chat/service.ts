import { authQuery, loginDbConfigured } from '../auth/db'
import { logger } from '../logger'
import {
  AMBANG_ONLINE_MS,
  LAMPIRAN_UMUR_HARI,
  bolehBaca,
  periksaLampiran,
  periksaPesan
} from './rules'

/*
 * Chat antar pengguna AIRA.
 *
 * ⚠️ SETIAP fungsi di sini menerima `saya` — username dari SESI main process,
 * BUKAN dari renderer. Renderer boleh mengirim nama siapa pun; yang menahan
 * adalah klausa WHERE di bawah yang selalu mengikat `saya`. Pola yang sama
 * dengan `sessionMilik` (§16) dan `chatRetry` (§32): menyaring daftar di layar
 * tidak pernah cukup, karena handler menerima argumen apa pun yang dikirim.
 *
 * Dipakai lewat pool login (`authQuery`) — satu-satunya pool yang boleh menulis.
 */

/**
 * Jalur query — bawaannya pool login aplikasi. Diganti HANYA oleh live-check,
 * supaya statement yang diuji ke database sungguhan sama persis dengan yang
 * dipakai aplikasi (lihat `pakaiKoneksiUji` di `grup.ts`).
 */
type Kueri = <T>(sql: string, params?: unknown[]) => Promise<T[]>
let kueri: Kueri = authQuery
let terhubung: () => boolean = loginDbConfigured

export function pakaiKoneksiUjiLayanan(q: Kueri): void {
  kueri = q
  terhubung = () => true
}

export interface OrangOnline {
  username: string
  role: string | null
  /** Nama divisi (digabung koma) — untuk kepala & panel profil di layar Pesan. */
  divisi: string | null
  online: boolean
  lastSeen: string | null
  belumDibaca: number
  terakhir: PesanChat | null
}

export interface PesanChat {
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
  /** Terisi = pesan ini dihapus pengirimnya. Isi & lampirannya sudah dibuang. */
  dihapusAt: string | null
  /** Terisi = pesan grup. */
  grupId: string | null
  /** Terisi = pesan sistem ("budi menambahkan siti"). Lihat `grup-rules.ts`. */
  jenis: string | null
  /** Sasaran pesan sistem (username; untuk `ganti_nama` berisi nama baru grup). */
  target: string | null
}

export interface LampiranMasuk {
  nama: string
  mime: string
  data: Uint8Array
}

/** Menyetorkan tanda "saya sedang membuka AIRA". */
export async function detak(saya: string, hostname: string | null): Promise<void> {
  if (!terhubung()) return
  await kueri(
    `INSERT INTO tb_chat_aira_hadir (username, last_seen, hostname)
     VALUES ($1, now(), $2)
     ON CONFLICT (username) DO UPDATE SET last_seen = now(), hostname = EXCLUDED.hostname`,
    [saya.toLowerCase(), hostname]
  )
}

/** Melepas kehadiran saat logout / aplikasi ditutup. */
export async function lepasKehadiran(saya: string): Promise<void> {
  if (!terhubung()) return
  // ⚠️ Dihapus, bukan disetel "offline". Kalau barisnya tinggal, orang yang sudah
  // pulang tetap tampak di daftar sampai ambangnya lewat — dan daftar yang salah
  // lebih buruk daripada daftar yang kosong.
  await kueri('DELETE FROM tb_chat_aira_hadir WHERE lower(username) = $1', [saya.toLowerCase()])
}

/**
 * Daftar rekan beserta status online dan jumlah pesan belum dibaca.
 *
 * Mengembalikan SEMUA user (bukan hanya yang online) supaya orang tetap bisa
 * mengirim pesan ke rekan yang sedang tutup aplikasinya — pesannya menunggu.
 * Yang offline ditandai, bukan disembunyikan.
 */
export async function daftarRekan(saya: string): Promise<OrangOnline[]> {
  if (!terhubung()) return []
  const aku = saya.toLowerCase()
  const rows = await kueri<
    Record<string, string | null> & {
      u_username: string
      u_role: string | null
      u_divisi: string | null
      last_seen: string | null
      belum: string
    }
  >(
    `SELECT u.username AS u_username,
            u.role AS u_role,
            (SELECT string_agg(d.nama, ', ' ORDER BY d.urutan, d.nama)
               FROM tb_user_divisi_aira ud
               JOIN tb_divisi_aira d ON d.kode = ud.divisi_kode
              WHERE lower(ud.username) = lower(u.username)) AS u_divisi,
            h.last_seen,
            (SELECT count(*) FROM tb_chat_aira_pesan p
              WHERE lower(p.penerima) = $1
                AND lower(p.pengirim) = lower(u.username)
                AND p.dibaca_at IS NULL
                AND p.dihapus_at IS NULL) AS belum,
            t.id, t.pengirim, t.penerima, t.isi, t.lampiran_nama, t.lampiran_mime,
            t.lampiran_ukuran, t.created_at, t.dibaca_at, t.dihapus_at,
            t.grup_id, t.jenis, t.target
       FROM tb_login_aira u
       LEFT JOIN tb_chat_aira_hadir h ON lower(h.username) = lower(u.username)
       -- Pesan terakhir di antara KAMI BERDUA saja — klausa ini mengikat saya di
       -- kedua arah, sama seperti ambilPercakapan. Tanpa ikatan itu, daftar ini
       -- akan menampilkan cuplikan percakapan orang lain.
       LEFT JOIN LATERAL (
         SELECT p.id, p.pengirim, p.penerima, p.isi, p.lampiran_nama, p.lampiran_mime,
                p.lampiran_ukuran, p.created_at, p.dibaca_at, p.dihapus_at,
                p.grup_id, p.jenis, p.target
           FROM tb_chat_aira_pesan p
          WHERE (lower(p.pengirim) = $1 AND lower(p.penerima) = lower(u.username))
             OR (lower(p.pengirim) = lower(u.username) AND lower(p.penerima) = $1)
          ORDER BY p.id DESC
          LIMIT 1
       ) t ON true
      WHERE lower(u.username) <> $1
        AND u.is_banned = false
      ORDER BY (h.last_seen IS NOT NULL AND h.last_seen > now() - ($2 || ' milliseconds')::interval) DESC,
               lower(u.username)`,
    [aku, String(AMBANG_ONLINE_MS)]
  )
  const batas = Date.now() - AMBANG_ONLINE_MS
  return rows.map((r) => ({
    username: r.u_username,
    role: r.u_role,
    divisi: r.u_divisi ?? null,
    lastSeen: r.last_seen,
    online: r.last_seen ? new Date(r.last_seen).getTime() >= batas : false,
    belumDibaca: Number(r.belum) || 0,
    terakhir: r.id ? bentukPesan(r) : null
  }))
}

/**
 * Total pesan belum dibaca — pribadi DAN grup — untuk lencana taskbar.
 *
 * ⚠️ Satu query, bukan dua. Fungsi ini dipanggil tiap 10 detik di setiap laptop;
 * dua query berarti dua kali beban tetap ke database produksi.
 *
 * Untuk grup: pesan sistem dan pesan sendiri TIDAK dihitung — "budi menambahkan
 * siti" bukan sesuatu yang perlu "dibaca", dan pesan yang kita kirim sendiri
 * tidak pernah belum kita baca.
 */
export async function totalBelumDibaca(saya: string): Promise<number> {
  if (!terhubung()) return 0
  const [r] = await kueri<{ n: string }>(
    `SELECT
       (SELECT count(*) FROM tb_chat_aira_pesan
         WHERE lower(penerima) = $1 AND dibaca_at IS NULL AND dihapus_at IS NULL)
       +
       (SELECT count(*) FROM tb_chat_aira_pesan p
          JOIN tb_chat_aira_grup_anggota a
            ON a.grup_id = p.grup_id AND lower(a.username) = $1 AND a.keluar_id IS NULL
         WHERE p.id > a.dibaca_id
           AND p.id > a.gabung_id
           AND p.dihapus_at IS NULL
           AND p.jenis IS NULL
           AND lower(p.pengirim) <> $1) AS n`,
    [saya.toLowerCase()]
  )
  return Number(r?.n) || 0
}

/**
 * Pesan MASUK yang belum pernah diberitahukan — sumber notifikasi.
 *
 * ⚠️ Disaring dengan `id > sejakId`, BUKAN dengan `created_at > waktu`. Jam
 * laptop dan jam server bisa berbeda beberapa detik, dan selisih itu cukup untuk
 * melewatkan pesan (kalau jam laptop lebih maju) atau memberitahukan pesan yang
 * sama berulang (kalau tertinggal). Id dari database tidak punya masalah itu.
 *
 * ⚠️ `isi` ikut diambil tapi lampirannya TIDAK (`lampiran_data` tidak disebut) —
 * tidak ada alasan menarik blob 5 MB tiap 10 detik hanya untuk tahu ada pesan.
 */
export async function pesanMasukBaru(
  saya: string,
  sejakId: string | null,
  batas = 30
): Promise<PesanChat[]> {
  if (!terhubung()) return []
  const rows = await kueri<Record<string, string | null>>(
    `SELECT id, pengirim, penerima, isi, lampiran_nama, lampiran_mime,
            lampiran_ukuran, created_at, dibaca_at, dihapus_at
       FROM tb_chat_aira_pesan
      WHERE lower(penerima) = $1
        AND dibaca_at IS NULL
        -- ⚠️ Pesan yang keburu dihapus pengirimnya JANGAN dibunyikan. Tanpa baris
        -- ini, menghapus pesan dalam 10 detik pertama tetap memunculkan toast
        -- berisi teks yang sudah tidak ada di mana pun — kebocoran yang justru
        -- terjadi tepat saat orang berusaha menariknya kembali.
        AND dihapus_at IS NULL
        AND ($2::bigint IS NULL OR id > $2::bigint)
      ORDER BY id
      LIMIT $3`,
    [saya.toLowerCase(), sejakId, batas]
  )
  return rows.map(bentukPesan)
}

/**
 * Id pesan terakhir di tabel — penanda awal saat aplikasi baru dibuka.
 *
 * Tanpa ini, orang yang membuka AIRA pagi hari akan dihujani notifikasi untuk
 * semua pesan yang masuk semalam. Yang belum dibaca tetap terlihat di lencana
 * dan di daftar rekan; yang tidak dilakukan hanyalah membunyikannya.
 */
export async function idPesanTerakhir(): Promise<string | null> {
  if (!terhubung()) return null
  const [r] = await kueri<{ id: string | null }>(
    'SELECT max(id)::text AS id FROM tb_chat_aira_pesan'
  )
  return r?.id ?? null
}

export async function kirimPesan(
  saya: string,
  ke: string,
  isi: string,
  lampiran?: LampiranMasuk
): Promise<PesanChat> {
  if (!terhubung()) throw new Error('Database chat tidak tersambung.')
  if (saya.toLowerCase() === ke.toLowerCase()) {
    throw new Error('Tidak bisa mengirim pesan ke diri sendiri.')
  }

  const cekPesan = periksaPesan(isi, !!lampiran)
  if (!cekPesan.ok) throw new Error(cekPesan.alasan)

  if (lampiran) {
    const cek = periksaLampiran(lampiran.nama, lampiran.mime, lampiran.data.byteLength)
    if (!cek.ok) throw new Error(cek.alasan)
  }

  // Penerima wajib user yang benar-benar ada — kalau tidak, salah ketik nama
  // menghasilkan pesan yang mengendap dan tidak pernah sampai ke siapa pun.
  const [ada] = await kueri<{ username: string }>(
    'SELECT username FROM tb_login_aira WHERE lower(username) = $1 AND is_banned = false',
    [ke.toLowerCase()]
  )
  if (!ada) throw new Error(`User "${ke}" tidak ditemukan atau sedang diblokir.`)

  const [row] = await kueri<Record<string, string | null>>(
    `INSERT INTO tb_chat_aira_pesan
       (pengirim, penerima, isi, lampiran_nama, lampiran_mime, lampiran_ukuran, lampiran_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, pengirim, penerima, isi, lampiran_nama, lampiran_mime,
               lampiran_ukuran, created_at, dibaca_at, dihapus_at`,
    [
      saya,
      ada.username,
      isi.trim(),
      lampiran?.nama ?? null,
      lampiran?.mime ?? null,
      lampiran ? lampiran.data.byteLength : null,
      lampiran ? Buffer.from(lampiran.data) : null
    ]
  )
  logger().info(
    { ke: ada.username, panjang: isi.trim().length, lampiran: !!lampiran },
    'pesan chat terkirim'
  )
  return bentukPesan(row)
}

/**
 * Percakapan antara `saya` dan `lawan`.
 *
 * ⚠️ Klausa WHERE mengikat `saya` di KEDUA sisi. Tanpa itu, mengirim nama dua
 * orang lain akan mengembalikan percakapan mereka berdua kepada penebak.
 */
export async function ambilPercakapan(
  saya: string,
  lawan: string,
  batas = 200
): Promise<PesanChat[]> {
  if (!terhubung()) return []
  const aku = saya.toLowerCase()
  const dia = lawan.toLowerCase()
  const rows = await kueri<Record<string, string | null>>(
    `SELECT id, pengirim, penerima, isi, lampiran_nama, lampiran_mime,
            lampiran_ukuran, created_at, dibaca_at, dihapus_at
       FROM tb_chat_aira_pesan
      WHERE (lower(pengirim) = $1 AND lower(penerima) = $2)
         OR (lower(pengirim) = $2 AND lower(penerima) = $1)
      ORDER BY created_at DESC, id DESC
      LIMIT $3`,
    [aku, dia, batas]
  )
  // Diambil terbaru-dulu supaya LIMIT memotong yang LAMA, lalu dibalik untuk
  // ditampilkan urut waktu. Memotong dari atas akan menyembunyikan pesan terbaru.
  return rows.reverse().map(bentukPesan)
}

/** Menandai pesan MASUK dari `lawan` sebagai sudah dibaca. */
export async function tandaiDibaca(saya: string, lawan: string): Promise<number> {
  if (!terhubung()) return 0
  const rows = await kueri<{ id: string }>(
    `UPDATE tb_chat_aira_pesan SET dibaca_at = now()
      WHERE lower(penerima) = $1 AND lower(pengirim) = $2 AND dibaca_at IS NULL
      RETURNING id`,
    [saya.toLowerCase(), lawan.toLowerCase()]
  )
  return rows.length
}

/**
 * Isi lampiran satu pesan.
 *
 * ⚠️ Kepemilikan diperiksa DI SINI dengan `bolehBaca`, memakai username sesi —
 * bukan dengan menyaring daftar di layar. Handler menerima id apa pun.
 */
export async function ambilLampiran(
  saya: string,
  pesanId: string
): Promise<{ nama: string; mime: string; data: Buffer } | null> {
  if (!terhubung()) return null
  const [row] = await kueri<{
    pengirim: string
    penerima: string
    lampiran_nama: string | null
    lampiran_mime: string | null
    lampiran_data: Buffer | null
    dihapus_at: string | null
    grup_id: string | null
    boleh_grup: boolean | null
  }>(
    // ⚠️ Untuk pesan GRUP, hak membaca ditentukan keanggotaan PADA SAAT pesan itu
    // dikirim — bukan perbandingan dua nama. Ini titik bocor nomor satu saat grup
    // dibuat: kalau jalur lampiran tertinggal, pesan grup tersembunyi dari orang
    // luar tapi LAMPIRANNYA bisa diunduh siapa pun yang menebak id. Rentangnya
    // sama persis dengan `pesanGrup` di `grup.ts`.
    `SELECT p.pengirim, p.penerima, p.lampiran_nama, p.lampiran_mime, p.lampiran_data,
            p.dihapus_at, p.grup_id::text AS grup_id,
            CASE WHEN p.grup_id IS NULL THEN NULL ELSE EXISTS (
              SELECT 1 FROM tb_chat_aira_grup_anggota a
               WHERE a.grup_id = p.grup_id
                 AND lower(a.username) = lower($2)
                 AND p.id > a.gabung_id
                 AND (a.keluar_id IS NULL OR p.id <= a.keluar_id)
            ) END AS boleh_grup
       FROM tb_chat_aira_pesan p WHERE p.id = $1`,
    [pesanId, saya]
  )
  if (!row || !row.lampiran_data || !row.lampiran_nama) return null
  // ⚠️ Pesan yang sudah dihapus tidak punya lampiran lagi (blob-nya di-NULL saat
  // menghapus), jadi baris di atas sudah menutupnya. Pemeriksaan ini tetap ada
  // sebagai lapis kedua: kalau kelak ada jalur hapus yang lupa membuang blob-nya,
  // yang terjadi bukan kebocoran diam-diam melainkan penolakan yang terlihat.
  if (row.dihapus_at) {
    logger().warn({ pesanId }, 'permintaan lampiran pada pesan yang sudah dihapus DITOLAK')
    throw new Error('Pesan ini sudah dihapus.')
  }
  const boleh = row.grup_id
    ? row.boleh_grup === true
    : row.penerima !== null && bolehBaca(saya, row.pengirim, row.penerima)
  if (!boleh) {
    logger().warn({ saya, pesanId }, 'percobaan membuka lampiran milik orang lain DITOLAK')
    throw new Error('Lampiran ini bukan milik percakapan Anda.')
  }
  return {
    nama: row.lampiran_nama,
    mime: row.lampiran_mime ?? 'application/octet-stream',
    data: row.lampiran_data
  }
}

/**
 * Menghapus SATU pesan milik sendiri.
 *
 * ⚠️ SOFT DELETE — barisnya tidak pernah dibuang. Yang dihapus isinya: teks
 * dikosongkan, lampiran (nama, jenis, ukuran, dan blob-nya) dibuang. Yang tinggal
 * adalah nisan yang di layar berbunyi "Pesan ini dihapus". Percakapan yang
 * tiba-tiba berlubang membuat orang mengira ada yang hilang karena aplikasinya
 * rusak — alasan yang sama dengan pembersihan lampiran 30 hari.
 *
 * ⚠️ Kepemilikan ditegakkan di KLAUSA WHERE (`lower(pengirim) = saya`), bukan
 * dengan menyembunyikan tombolnya di layar. Handler menerima id apa pun yang
 * dikirim renderer; tanpa klausa ini, siapa pun yang menebak sebuah id bisa
 * MENGHAPUS pesan orang lain — kerusakan, bukan sekadar kebocoran. Pola yang sama
 * persis dengan `chatRetry` (§32) dan `sessionsDelete` (§16).
 *
 * ⚠️ Tidak ada batas waktu, dan itu keputusan sadar: yang menjaga integritas
 * percakapan adalah NISAN + jejak `dihapus_oleh`, bukan jam dinding. Pesan yang
 * hilang tanpa bekas tidak akan pernah terjadi di sini.
 *
 * @returns true bila ada baris yang benar-benar terhapus.
 */
export async function hapusPesan(saya: string, pesanId: string): Promise<boolean> {
  if (!terhubung()) throw new Error('Database chat tidak tersambung.')
  const rows = await kueri<{ id: string; penerima: string | null }>(
    `UPDATE tb_chat_aira_pesan
        SET isi = '',
            lampiran_nama = NULL,
            lampiran_mime = NULL,
            lampiran_ukuran = NULL,
            lampiran_data = NULL,
            dihapus_at = now(),
            dihapus_oleh = $2
      WHERE id = $1
        AND lower(pengirim) = lower($2)
        AND dihapus_at IS NULL
        -- ⚠️ Pesan SISTEM tidak bisa dihapus. Kolom "pengirim"-nya berisi PELAKU
        -- ("budi mengeluarkan siti"), jadi tanpa baris ini pelaku bisa menghapus
        -- jejak tindakannya sendiri dari grup.
        AND jenis IS NULL
      RETURNING id, penerima`,
    [pesanId, saya]
  )
  if (rows.length === 0) {
    // Dua sebab berbeda dengan gejala sama: bukan milik dia, atau sudah dihapus
    // lebih dulu. Keduanya dijawab sama ke layar supaya orang tidak bisa memakai
    // pesan galat untuk menebak id pesan orang lain.
    logger().warn({ saya, pesanId }, 'permintaan hapus pesan ditolak (bukan pengirim / sudah dihapus)')
    return false
  }
  logger().info({ pesanId, penerima: rows[0].penerima }, 'pesan chat dihapus pengirimnya')
  return true
}

/**
 * Membuang ISI lampiran yang sudah tua. Baris pesannya TETAP tinggal.
 *
 * ⚠️ Sengaja hanya isinya yang dibuang, bukan barisnya: percakapan yang
 * tiba-tiba berlubang membuat orang mengira pesannya dihapus seseorang.
 * Yang tersisa menyebutkan bahwa berkasnya sudah kedaluwarsa.
 */
export async function bersihkanLampiranLama(): Promise<number> {
  if (!terhubung()) return 0
  const rows = await kueri<{ id: string }>(
    `UPDATE tb_chat_aira_pesan
        SET lampiran_data = NULL
      WHERE lampiran_data IS NOT NULL
        AND created_at < now() - ($1 || ' days')::interval
      RETURNING id`,
    [String(LAMPIRAN_UMUR_HARI)]
  )
  if (rows.length) logger().info({ jumlah: rows.length }, 'lampiran chat lama dibuang')
  return rows.length
}

export function bentukPesan(r: Record<string, string | null>): PesanChat {
  return {
    id: String(r.id),
    pengirim: String(r.pengirim),
    // ⚠️ `String(null)` menghasilkan teks "null" — dan pesan grup memang tidak
    // punya penerima. Tanpa penjagaan ini, pesan grup tampak dikirim kepada user
    // bernama "null".
    penerima: r.penerima ?? null,
    isi: r.isi ?? '',
    lampiranNama: r.lampiran_nama,
    lampiranMime: r.lampiran_mime,
    lampiranUkuran: r.lampiran_ukuran === null ? null : Number(r.lampiran_ukuran),
    createdAt: String(r.created_at),
    dibacaAt: r.dibaca_at,
    dihapusAt: r.dihapus_at,
    grupId: r.grup_id === undefined || r.grup_id === null ? null : String(r.grup_id),
    jenis: r.jenis ?? null,
    target: r.target ?? null
  }
}
