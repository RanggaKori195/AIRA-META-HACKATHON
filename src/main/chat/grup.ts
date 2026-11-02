import { authQuery, loginDbConfigured } from '../auth/db'
import { logger } from '../logger'
import { AMBANG_ONLINE_MS, periksaLampiran, periksaPesan } from './rules'
import {
  MAKS_ANGGOTA,
  periksaJumlahAnggota,
  periksaNamaGrup,
  saringCalonAnggota,
  type PeranGrup
} from './grup-rules'
import { bentukPesan, pakaiKoneksiUjiLayanan, type LampiranMasuk, type PesanChat } from './service'

/*
 * Grup chat — tahap 3 "WhatsApp lite" (16 Sep 2026).
 *
 * ⚠️ ATURAN IZIN HIDUP DI KLAUSA WHERE, DI SINI. Setiap fungsi menerima `saya`
 * dari SESI main process; renderer tidak pernah mengirim "siapa saya" dan tidak
 * pernah mengirim "saya admin". Tombol yang disembunyikan di layar hanya
 * kenyamanan (pola §16/§32).
 *
 * ⚠️ TIDAK ADA TRANSAKSI MULTI-STATEMENT. Pool login `max: 1`, query-nya
 * diserialkan bersama detak kehadiran dan pengawas notifikasi, dan
 * `pool.connect()` dilarang di main process (terbukti gagal di Electron). Jadi
 * BEGIN/COMMIT lewat beberapa panggilan `authQuery` bisa disela query lain di
 * koneksi yang SAMA — detak yang gagal di tengah akan membatalkan grup yang
 * sedang dibuat. Karena itu setiap operasi berlangkah banyak ditulis sebagai
 * SATU statement dengan CTE: Postgres menjalankannya atomik.
 *
 * ⚠️ RENTANG KEANGGOTAAN memakai ID PESAN (`gabung_id` / `keluar_id`), bukan
 * waktu. Lihat komentar skema di `auth/schema.ts`.
 *
 * Bentuk klausa rentang yang dipakai berulang kali di bawah:
 *     p.id > a.gabung_id AND (a.keluar_id IS NULL OR p.id <= a.keluar_id)
 * Pesan grup yang TIDAK memenuhi ini tidak boleh keluar dari fungsi mana pun.
 */

export interface GrupRingkas {
  id: string
  nama: string
  jumlahAnggota: number
  peranSaya: PeranGrup
  aktif: boolean
  belumDibaca: number
  terakhir: PesanChat | null
}

export interface AnggotaGrup {
  username: string
  peran: PeranGrup
  online: boolean
  role: string | null
}

/**
 * Jalur query. Bawaannya pool login aplikasi.
 *
 * ⚠️ Bisa diganti HANYA oleh live-check (`tests/grup-live-check.ts`), supaya
 * yang diuji ke database sungguhan adalah statement yang SAMA PERSIS dengan
 * yang dipakai aplikasi — pola yang sama dengan `Exec` di `auth/schema.ts`.
 * Menyalin SQL ke berkas uji berarti menguji salinan, dan salinan menyimpang
 * diam-diam; di sini yang dipertaruhkan adalah aturan siapa boleh membaca grup.
 */
type Kueri = <T>(sql: string, params?: unknown[]) => Promise<T[]>
let kueri: Kueri = authQuery
let terhubung: () => boolean = loginDbConfigured

export function pakaiKoneksiUji(q: Kueri): void {
  kueri = q
  terhubung = () => true
  // Jalur lampiran & lencana di `service.ts` ikut memakai koneksi uji — dua
  // tempat itulah yang paling mudah tertinggal saat aturan grup berubah.
  pakaiKoneksiUjiLayanan(q)
}

const ID_GRUP = /^\d{1,19}$/

function pastikanId(grupId: string): void {
  if (!ID_GRUP.test(grupId)) throw new Error('Id grup tidak sah.')
}

function wajibDb(): void {
  if (!terhubung()) throw new Error('Database chat tidak tersambung.')
}

// ------------------------------------------------------------------ baca

/**
 * Grup milik saya — termasuk yang sudah saya tinggalkan (hanya bisa dibaca).
 *
 * Diurutkan menurut pesan terakhir yang BOLEH saya lihat, seperti WhatsApp:
 * percakapan yang paling baru aktif naik ke atas.
 */
export async function daftarGrup(saya: string): Promise<GrupRingkas[]> {
  if (!terhubung()) return []
  // `aktif` datang sebagai boolean asli dari driver pg; kolom lain teks/angka.
  const rows = await kueri<Record<string, string | null> & { aktif: boolean }>(
    `SELECT g.id::text AS gid, g.nama, a.peran,
            (a.keluar_id IS NULL) AS aktif,
            (SELECT count(*) FROM tb_chat_aira_grup_anggota x
              WHERE x.grup_id = g.id AND x.keluar_id IS NULL) AS jumlah,
            (SELECT count(*) FROM tb_chat_aira_pesan p
              WHERE p.grup_id = g.id
                AND p.id > a.dibaca_id
                AND p.id > a.gabung_id
                AND (a.keluar_id IS NULL OR p.id <= a.keluar_id)
                AND p.dihapus_at IS NULL
                AND p.jenis IS NULL
                AND lower(p.pengirim) <> $1) AS belum,
            t.id, t.pengirim, t.penerima, t.isi, t.lampiran_nama, t.lampiran_mime,
            t.lampiran_ukuran, t.created_at, t.dibaca_at, t.dihapus_at,
            t.grup_id, t.jenis, t.target
       FROM tb_chat_aira_grup_anggota a
       JOIN tb_chat_aira_grup g ON g.id = a.grup_id
       LEFT JOIN LATERAL (
         SELECT p.id, p.pengirim, p.penerima, p.isi, p.lampiran_nama, p.lampiran_mime,
                p.lampiran_ukuran, p.created_at, p.dibaca_at, p.dihapus_at,
                p.grup_id, p.jenis, p.target
           FROM tb_chat_aira_pesan p
          WHERE p.grup_id = g.id
            AND p.id > a.gabung_id
            AND (a.keluar_id IS NULL OR p.id <= a.keluar_id)
          ORDER BY p.id DESC
          LIMIT 1
       ) t ON true
      WHERE lower(a.username) = $1
      ORDER BY COALESCE(t.id, 0) DESC, g.id DESC`,
    [saya.toLowerCase()]
  )
  return rows.map((r) => ({
    id: String(r.gid),
    nama: String(r.nama),
    jumlahAnggota: Number(r.jumlah) || 0,
    peranSaya: r.peran === 'admin' ? 'admin' : 'anggota',
    aktif: r.aktif === true,
    belumDibaca: Number(r.belum) || 0,
    terakhir: r.id ? bentukPesan(r) : null
  }))
}

/**
 * Pesan grup yang boleh saya lihat, urut waktu.
 *
 * ⚠️ Bukan anggota (dan tidak pernah jadi anggota) = DITOLAK dengan galat,
 * bukan dikembalikan kosong. Daftar kosong terlihat seperti "grupnya sepi";
 * penolakan yang jelas membuat kesalahan di layar ketahuan saat itu juga.
 */
export async function pesanGrup(saya: string, grupId: string, batas = 200): Promise<PesanChat[]> {
  wajibDb()
  pastikanId(grupId)
  const [anggota] = await kueri<{ ada: string }>(
    `SELECT 1 AS ada FROM tb_chat_aira_grup_anggota
      WHERE grup_id = $1 AND lower(username) = lower($2)`,
    [grupId, saya]
  )
  if (!anggota) {
    logger().warn({ saya, grupId }, 'membaca grup yang bukan miliknya DITOLAK')
    throw new Error('Kamu bukan anggota grup ini.')
  }
  const rows = await kueri<Record<string, string | null>>(
    `SELECT p.id, p.pengirim, p.penerima, p.isi, p.lampiran_nama, p.lampiran_mime,
            p.lampiran_ukuran, p.created_at, p.dibaca_at, p.dihapus_at,
            p.grup_id, p.jenis, p.target
       FROM tb_chat_aira_pesan p
       JOIN tb_chat_aira_grup_anggota a
         ON a.grup_id = p.grup_id AND lower(a.username) = lower($2)
      WHERE p.grup_id = $1
        AND p.id > a.gabung_id
        AND (a.keluar_id IS NULL OR p.id <= a.keluar_id)
      ORDER BY p.id DESC
      LIMIT $3`,
    [grupId, saya, batas]
  )
  // Diambil terbaru-dulu supaya LIMIT memotong yang LAMA, lalu dibalik.
  return rows.reverse().map(bentukPesan)
}

/** Info grup + anggota aktif. Boleh dibuka anggota maupun mantan anggota. */
export async function infoGrup(
  saya: string,
  grupId: string
): Promise<{ grup: GrupRingkas; anggota: AnggotaGrup[] }> {
  wajibDb()
  pastikanId(grupId)
  const grup = (await daftarGrup(saya)).find((g) => g.id === grupId)
  if (!grup) throw new Error('Kamu bukan anggota grup ini.')

  const rows = await kueri<{
    username: string
    peran: string
    last_seen: string | null
    role: string | null
  }>(
    `SELECT a.username, a.peran, h.last_seen, u.role
       FROM tb_chat_aira_grup_anggota a
       LEFT JOIN tb_chat_aira_hadir h ON lower(h.username) = lower(a.username)
       LEFT JOIN tb_login_aira u ON lower(u.username) = lower(a.username)
      WHERE a.grup_id = $1 AND a.keluar_id IS NULL
      ORDER BY (a.peran = 'admin') DESC, lower(a.username)`,
    [grupId]
  )
  const batas = Date.now() - AMBANG_ONLINE_MS
  return {
    grup,
    anggota: rows.map((r) => ({
      username: r.username,
      peran: r.peran === 'admin' ? 'admin' : 'anggota',
      online: r.last_seen ? new Date(r.last_seen).getTime() >= batas : false,
      role: r.role
    }))
  }
}

/**
 * Pesan grup yang belum pernah diberitahukan — sumber notifikasi.
 *
 * Yang dibunyikan: pesan biasa dari ORANG LAIN di grup yang masih saya ikuti,
 * PLUS satu jenis pesan sistem — "X menambahkan kamu". Tanpa yang terakhir,
 * orang tidak pernah tahu ia baru dimasukkan ke sebuah grup sampai kebetulan
 * membuka panel chat.
 */
export async function pesanGrupMasukBaru(
  saya: string,
  sejakId: string | null,
  batas = 30
): Promise<Array<PesanChat & { grupNama: string }>> {
  if (!terhubung()) return []
  const rows = await kueri<Record<string, string | null>>(
    `SELECT p.id, p.pengirim, p.penerima, p.isi, p.lampiran_nama, p.lampiran_mime,
            p.lampiran_ukuran, p.created_at, p.dibaca_at, p.dihapus_at,
            p.grup_id, p.jenis, p.target, g.nama AS grup_nama
       FROM tb_chat_aira_pesan p
       JOIN tb_chat_aira_grup_anggota a
         ON a.grup_id = p.grup_id AND lower(a.username) = $1 AND a.keluar_id IS NULL
       JOIN tb_chat_aira_grup g ON g.id = p.grup_id
      WHERE ($2::bigint IS NULL OR p.id > $2::bigint)
        AND p.id > a.gabung_id
        AND p.id > a.dibaca_id
        AND p.dihapus_at IS NULL
        AND lower(p.pengirim) <> $1
        AND (p.jenis IS NULL OR (p.jenis = 'tambah' AND lower(p.target) = $1))
      ORDER BY p.id
      LIMIT $3`,
    [saya.toLowerCase(), sejakId, batas]
  )
  return rows.map((r) => ({ ...bentukPesan(r), grupNama: String(r.grup_nama) }))
}

// ------------------------------------------------------------------ tulis

/** Membuat grup. Pembuat otomatis jadi admin. */
export async function buatGrup(saya: string, nama: string, anggota: string[]): Promise<string> {
  wajibDb()
  const cekNama = periksaNamaGrup(nama)
  if (!cekNama.ok) throw new Error(cekNama.alasan)
  const calon = saringCalonAnggota(anggota, saya)
  if (calon.length === 0) throw new Error('Pilih minimal satu anggota selain kamu.')
  const cekJumlah = periksaJumlahAnggota(1, calon.length)
  if (!cekJumlah.ok) throw new Error(cekJumlah.alasan)

  // ⚠️ SATU statement: grup, seluruh anggota, dan pesan sistem "membuat grup"
  // lahir bersama atau tidak sama sekali. `batas` diambil dari snapshot yang
  // sama, jadi pesan sistem yang disisipkan di statement ini PASTI ber-id lebih
  // besar dan terlihat oleh semua anggota awal.
  //
  // Hanya user yang benar-benar ada dan tidak diblokir yang dimasukkan —
  // salah ketik nama tidak menghasilkan anggota hantu.
  const [row] = await kueri<{ gid: string; jumlah: string }>(
    `WITH g AS (
       INSERT INTO tb_chat_aira_grup (nama, dibuat_oleh) VALUES ($1, $2)
       RETURNING id
     ), batas AS (
       SELECT COALESCE(max(id), 0) AS m FROM tb_chat_aira_pesan
     ), calon AS (
       SELECT u.username,
              CASE WHEN lower(u.username) = lower($2) THEN 'admin' ELSE 'anggota' END AS peran
         FROM tb_login_aira u
        WHERE lower(u.username) = ANY($3::text[])
          AND u.is_banned = false
     ), ang AS (
       INSERT INTO tb_chat_aira_grup_anggota (grup_id, username, peran, gabung_id, dibaca_id)
       SELECT g.id, c.username, c.peran, b.m, b.m FROM g, calon c, batas b
       RETURNING username
     ), sis AS (
       INSERT INTO tb_chat_aira_pesan (pengirim, grup_id, isi, jenis)
       SELECT $2, g.id, '', 'buat' FROM g
       RETURNING id
     )
     SELECT g.id::text AS gid, (SELECT count(*) FROM ang) AS jumlah FROM g`,
    [cekNama.nama, saya, [saya.toLowerCase(), ...calon]]
  )
  const jumlah = Number(row?.jumlah) || 0
  logger().info({ grup: row?.gid, anggota: jumlah }, 'grup chat dibuat')
  if (jumlah < 2) {
    // Terjadi bila semua calon ternyata tidak ada / diblokir. Grupnya tetap
    // lahir (hanya berisi pembuat) — dikatakan apa adanya, bukan didiamkan.
    throw new Error(
      'Grup dibuat, tapi tidak ada satu pun anggota yang bisa ditambahkan (user tidak ditemukan atau diblokir).'
    )
  }
  return String(row.gid)
}

/** Mengirim pesan ke grup. Hanya anggota AKTIF. */
export async function kirimGrup(
  saya: string,
  grupId: string,
  isi: string,
  lampiran?: LampiranMasuk
): Promise<PesanChat> {
  wajibDb()
  pastikanId(grupId)
  const cekPesan = periksaPesan(isi, !!lampiran)
  if (!cekPesan.ok) throw new Error(cekPesan.alasan)
  if (lampiran) {
    const cek = periksaLampiran(lampiran.nama, lampiran.mime, lampiran.data.byteLength)
    if (!cek.ok) throw new Error(cek.alasan)
  }

  // ⚠️ Pemeriksaan keanggotaan DI DALAM statement INSERT itu sendiri — bukan
  // SELECT lalu INSERT. Dua langkah terpisah membuka celah: dikeluarkan admin
  // tepat di antara keduanya, pesannya tetap masuk.
  const rows = await kueri<Record<string, string | null>>(
    `INSERT INTO tb_chat_aira_pesan
       (pengirim, grup_id, isi, lampiran_nama, lampiran_mime, lampiran_ukuran, lampiran_data)
     SELECT a.username, a.grup_id, $3, $4, $5, $6, $7
       FROM tb_chat_aira_grup_anggota a
      WHERE a.grup_id = $1 AND lower(a.username) = lower($2) AND a.keluar_id IS NULL
     RETURNING id, pengirim, penerima, isi, lampiran_nama, lampiran_mime,
               lampiran_ukuran, created_at, dibaca_at, dihapus_at, grup_id, jenis, target`,
    [
      grupId,
      saya,
      isi.trim(),
      lampiran?.nama ?? null,
      lampiran?.mime ?? null,
      lampiran ? lampiran.data.byteLength : null,
      lampiran ? Buffer.from(lampiran.data) : null
    ]
  )
  if (rows.length === 0) throw new Error('Kamu bukan anggota grup ini lagi, pesan tidak terkirim.')
  logger().info({ grup: grupId, panjang: isi.trim().length, lampiran: !!lampiran }, 'pesan grup terkirim')
  return bentukPesan(rows[0])
}

/** Menandai semua pesan grup yang terlihat sebagai sudah dibaca. */
export async function tandaiDibacaGrup(saya: string, grupId: string): Promise<boolean> {
  if (!terhubung()) return false
  pastikanId(grupId)
  // GREATEST: penanda tidak pernah mundur, walau dua jendela menandai bersamaan.
  const rows = await kueri<{ ok: string }>(
    `UPDATE tb_chat_aira_grup_anggota a
        SET dibaca_id = GREATEST(a.dibaca_id, COALESCE((
          SELECT max(p.id) FROM tb_chat_aira_pesan p
           WHERE p.grup_id = a.grup_id
             AND (a.keluar_id IS NULL OR p.id <= a.keluar_id)
        ), 0))
      WHERE a.grup_id = $1 AND lower(a.username) = lower($2)
        AND a.dibaca_id < COALESCE((
          SELECT max(p.id) FROM tb_chat_aira_pesan p
           WHERE p.grup_id = a.grup_id
             AND (a.keluar_id IS NULL OR p.id <= a.keluar_id)
        ), 0)
      RETURNING 1 AS ok`,
    [grupId, saya]
  )
  return rows.length > 0
}

/** Klausa "saya admin aktif di grup ini" — dipakai semua operasi kelola. */
const CTE_ADMIN = `admin AS (
       SELECT a.username FROM tb_chat_aira_grup_anggota a
        WHERE a.grup_id = $1 AND lower(a.username) = lower($2)
          AND a.keluar_id IS NULL AND a.peran = 'admin'
     )`

function wajibAdmin(n: unknown): void {
  if (!Number(n)) throw new Error('Hanya admin grup yang bisa melakukan ini.')
}

/** Admin menambah anggota. Mantan anggota yang ditambah ulang diaktifkan lagi. */
export async function tambahAnggota(saya: string, grupId: string, usernames: string[]): Promise<string[]> {
  wajibDb()
  pastikanId(grupId)
  const calon = saringCalonAnggota(usernames, saya)
  if (calon.length === 0) throw new Error('Tidak ada anggota baru yang dipilih.')

  const [hitung] = await kueri<{ n: string }>(
    'SELECT count(*) AS n FROM tb_chat_aira_grup_anggota WHERE grup_id = $1 AND keluar_id IS NULL',
    [grupId]
  )
  const cek = periksaJumlahAnggota(Number(hitung?.n) || 0, calon.length)
  if (!cek.ok) throw new Error(cek.alasan)

  // ⚠️ Anggota yang DITAMBAH ULANG mendapat `gabung_id` baru: ia tidak melihat
  // apa pun yang dikirim selama ia bukan anggota. Riwayat keanggotaan
  // sebelumnya ikut tertutup — lebih baik kehilangan riwayat lama daripada
  // membuka percakapan yang terjadi tanpa dia.
  //
  // `ON CONFLICT ... WHERE keluar_id IS NOT NULL`: anggota yang MASIH aktif tidak
  // disentuh sama sekali (peran adminnya tidak turun jadi anggota).
  const [row] = await kueri<{ admin: string; ditambah: string[] | null }>(
    `WITH ${CTE_ADMIN},
     batas AS (SELECT COALESCE(max(id), 0) AS m FROM tb_chat_aira_pesan),
     calon AS (
       SELECT u.username FROM tb_login_aira u
        WHERE lower(u.username) = ANY($3::text[])
          AND u.is_banned = false
          AND EXISTS (SELECT 1 FROM admin)
          AND NOT EXISTS (
            SELECT 1 FROM tb_chat_aira_grup_anggota x
             WHERE x.grup_id = $1 AND lower(x.username) = lower(u.username) AND x.keluar_id IS NULL
          )
     ),
     ang AS (
       INSERT INTO tb_chat_aira_grup_anggota (grup_id, username, peran, gabung_id, dibaca_id, keluar_id)
       SELECT $1, c.username, 'anggota', b.m, b.m, NULL FROM calon c, batas b
       ON CONFLICT (grup_id, username) DO UPDATE
          SET peran = 'anggota', gabung_id = EXCLUDED.gabung_id, dibaca_id = EXCLUDED.dibaca_id,
              keluar_id = NULL, gabung_at = now()
        WHERE tb_chat_aira_grup_anggota.keluar_id IS NOT NULL
       RETURNING username
     ),
     sis AS (
       INSERT INTO tb_chat_aira_pesan (pengirim, grup_id, isi, jenis, target)
       SELECT (SELECT username FROM admin), $1, '', 'tambah', a.username FROM ang a
       RETURNING id
     )
     SELECT (SELECT count(*) FROM admin) AS admin,
            (SELECT array_agg(username) FROM ang) AS ditambah`,
    [grupId, saya, calon]
  )
  wajibAdmin(row?.admin)
  const ditambah = row?.ditambah ?? []
  logger().info({ grup: grupId, jumlah: ditambah.length }, 'anggota grup ditambah')
  return ditambah
}

/** Admin mengeluarkan anggota lain. */
export async function keluarkanAnggota(saya: string, grupId: string, username: string): Promise<void> {
  wajibDb()
  pastikanId(grupId)
  if (username.toLowerCase() === saya.toLowerCase()) {
    throw new Error('Untuk meninggalkan grup, pakai "Keluar dari grup".')
  }
  // ⚠️ Pesan sistem disisipkan DULU, lalu `keluar_id` disetel ke id pesan itu.
  // Dengan begitu orang yang dikeluarkan masih MELIHAT "Andi mengeluarkan kamu"
  // sebagai pesan terakhirnya — tanpa itu grupnya diam-diam berhenti bergerak dan
  // ia tidak tahu sebabnya.
  const [row] = await kueri<{ admin: string; keluar: string }>(
    `WITH ${CTE_ADMIN},
     sasaran AS (
       SELECT a.username FROM tb_chat_aira_grup_anggota a
        WHERE a.grup_id = $1 AND lower(a.username) = lower($3) AND a.keluar_id IS NULL
          AND EXISTS (SELECT 1 FROM admin)
     ),
     sis AS (
       INSERT INTO tb_chat_aira_pesan (pengirim, grup_id, isi, jenis, target)
       SELECT (SELECT username FROM admin), $1, '', 'keluarkan', s.username FROM sasaran s
       RETURNING id
     ),
     kel AS (
       UPDATE tb_chat_aira_grup_anggota a
          SET keluar_id = sis.id, peran = 'anggota'
         FROM sis, sasaran s
        WHERE a.grup_id = $1 AND a.username = s.username
       RETURNING a.username
     )
     SELECT (SELECT count(*) FROM admin) AS admin, (SELECT count(*) FROM kel) AS keluar`,
    [grupId, saya, username]
  )
  wajibAdmin(row?.admin)
  if (!Number(row?.keluar)) throw new Error(`${username} bukan anggota aktif grup ini.`)
  logger().info({ grup: grupId }, 'anggota grup dikeluarkan admin')
}

/**
 * Keluar dari grup atas kemauan sendiri.
 *
 * ⚠️ Bila yang keluar adalah admin TERAKHIR, anggota paling lama otomatis jadi
 * admin — di statement yang sama. Tanpa itu grup jadi yatim: tidak ada yang bisa
 * menambah atau mengeluarkan siapa pun, selamanya, dan tidak ada tombol di layar
 * yang bisa memperbaikinya.
 */
export async function keluarGrup(saya: string, grupId: string): Promise<void> {
  wajibDb()
  pastikanId(grupId)
  const [row] = await kueri<{ keluar: string; pengganti: string | null }>(
    `WITH aku AS (
       SELECT a.username, a.peran FROM tb_chat_aira_grup_anggota a
        WHERE a.grup_id = $1 AND lower(a.username) = lower($2) AND a.keluar_id IS NULL
     ),
     sis AS (
       INSERT INTO tb_chat_aira_pesan (pengirim, grup_id, isi, jenis)
       SELECT k.username, $1, '', 'keluar' FROM aku k
       RETURNING id
     ),
     kel AS (
       UPDATE tb_chat_aira_grup_anggota a
          SET keluar_id = sis.id, peran = 'anggota'
         FROM sis, aku k
        WHERE a.grup_id = $1 AND a.username = k.username
       RETURNING a.username
     ),
     pengganti AS (
       UPDATE tb_chat_aira_grup_anggota a
          SET peran = 'admin'
        WHERE a.grup_id = $1
          AND (SELECT peran FROM aku) = 'admin'
          AND NOT EXISTS (
            SELECT 1 FROM tb_chat_aira_grup_anggota x
             WHERE x.grup_id = $1 AND x.keluar_id IS NULL AND x.peran = 'admin'
               AND lower(x.username) <> lower($2)
          )
          AND a.username = (
            SELECT y.username FROM tb_chat_aira_grup_anggota y
             WHERE y.grup_id = $1 AND y.keluar_id IS NULL AND lower(y.username) <> lower($2)
             ORDER BY y.gabung_id, y.gabung_at, lower(y.username)
             LIMIT 1
          )
       RETURNING a.username
     ),
     sis_admin AS (
       INSERT INTO tb_chat_aira_pesan (pengirim, grup_id, isi, jenis, target)
       SELECT (SELECT username FROM aku), $1, '', 'admin_otomatis', p.username FROM pengganti p
       RETURNING id
     )
     SELECT (SELECT count(*) FROM kel) AS keluar, (SELECT username FROM pengganti) AS pengganti`,
    [grupId, saya]
  )
  if (!Number(row?.keluar)) throw new Error('Kamu sudah bukan anggota grup ini.')
  logger().info({ grup: grupId, pengganti: row?.pengganti ?? null }, 'keluar dari grup')
}

/**
 * Menjadikan / mencabut admin.
 *
 * ⚠️ Mencabut admin TERAKHIR ditolak — termasuk mencabut diri sendiri. Alasan
 * yang sama dengan pengganti otomatis di `keluarGrup`: grup tanpa admin tidak
 * bisa dikelola lagi oleh siapa pun.
 */
export async function aturAdmin(
  saya: string,
  grupId: string,
  username: string,
  jadikanAdmin: boolean
): Promise<void> {
  wajibDb()
  pastikanId(grupId)
  const peranBaru: PeranGrup = jadikanAdmin ? 'admin' : 'anggota'
  const [row] = await kueri<{ admin: string; ubah: string }>(
    `WITH ${CTE_ADMIN},
     ubah AS (
       UPDATE tb_chat_aira_grup_anggota a
          SET peran = $4
        WHERE a.grup_id = $1
          AND lower(a.username) = lower($3)
          AND a.keluar_id IS NULL
          AND a.peran <> $4
          AND EXISTS (SELECT 1 FROM admin)
          AND (
            $4 = 'admin'
            OR EXISTS (
              SELECT 1 FROM tb_chat_aira_grup_anggota x
               WHERE x.grup_id = $1 AND x.keluar_id IS NULL AND x.peran = 'admin'
                 AND lower(x.username) <> lower($3)
            )
          )
       RETURNING a.username
     ),
     sis AS (
       INSERT INTO tb_chat_aira_pesan (pengirim, grup_id, isi, jenis, target)
       SELECT (SELECT username FROM admin), $1, '',
              CASE WHEN $4 = 'admin' THEN 'jadi_admin' ELSE 'lepas_admin' END, u.username
         FROM ubah u
       RETURNING id
     )
     SELECT (SELECT count(*) FROM admin) AS admin, (SELECT count(*) FROM ubah) AS ubah`,
    [grupId, saya, username, peranBaru]
  )
  wajibAdmin(row?.admin)
  if (!Number(row?.ubah)) {
    throw new Error(
      jadikanAdmin
        ? `${username} sudah admin, atau bukan anggota aktif.`
        : 'Tidak bisa mencabut admin terakhir — jadikan anggota lain admin dulu.'
    )
  }
}

/** Admin mengganti nama grup. */
export async function gantiNamaGrup(saya: string, grupId: string, nama: string): Promise<void> {
  wajibDb()
  pastikanId(grupId)
  const cek = periksaNamaGrup(nama)
  if (!cek.ok) throw new Error(cek.alasan)
  const [row] = await kueri<{ admin: string }>(
    `WITH ${CTE_ADMIN},
     g AS (
       UPDATE tb_chat_aira_grup SET nama = $3
        WHERE id = $1 AND nama <> $3 AND EXISTS (SELECT 1 FROM admin)
       RETURNING nama
     ),
     sis AS (
       INSERT INTO tb_chat_aira_pesan (pengirim, grup_id, isi, jenis, target)
       SELECT (SELECT username FROM admin), $1, '', 'ganti_nama', g.nama FROM g
       RETURNING id
     )
     SELECT (SELECT count(*) FROM admin) AS admin`,
    [grupId, saya, cek.nama]
  )
  wajibAdmin(row?.admin)
}

export { MAKS_ANGGOTA }
