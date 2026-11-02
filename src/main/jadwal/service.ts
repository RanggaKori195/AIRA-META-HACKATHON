// Menu "Jadwal" — penyimpanan + penjadwal tugas (29 Sep 2026).
//
// Cara kerja: tiap 30 detik main process memeriksa apakah ada tugas milik user
// yang SEDANG LOGIN yang sudah jatuh tempo. Kalau ada, kalimat tugasnya dikirim
// lewat jalur yang SAMA PERSIS dengan kotak chat (`sendChat`) sebagai percakapan
// baru — jadi izin menu, guard anti-halu, monitoring (§65), dan toolset berlaku
// tanpa salinan aturan. Hasilnya percakapan biasa yang bisa dibuka dari riwayat.
//
// ⚠️ Dijalankan di MAIN process, bukan React: jendela yang tersembunyi di tray
// tetap menjalankan tugas (alasan yang sama dengan pengawas chat, §62).
// ⚠️ SATU tugas per putaran, dan tidak saat user sedang menunggu jawaban
// (`jumlahRunAktif`). Tugas yang terlambat beberapa detik lebih murah daripada
// jawaban user yang melambat karena gateway & pool database `max: 1` direbut.

import { randomUUID } from 'crypto'
import {
  IPC_CHANNELS,
  type ItemJadwal,
  type JalanDenganTugas,
  type JalanJadwal,
  type JenisJadwal,
  type PolaJadwal,
  type SimpanJadwalInput
} from '../../shared/ipc'
import * as auth from '../auth/service'
import { rawDb, audit } from '../db'
import { buildProvider } from '../llm/factory'
import { jumlahRunAktif, sendChat } from '../agent/orchestrator'
import { mainWindow, notify } from '../notify'
import { logger } from '../logger'
import { periksaPemantau, tutupNotifikasiPemantau } from '../pemantau/nyata'
import {
  JadwalError,
  MAKS_JADWAL_PER_USER,
  MAKS_NAMA,
  MAKS_PROMPT,
  MAKS_RIWAYAT,
  MAKS_SIMPAN_RIWAYAT,
  MODE_JADWAL,
  berikutnya,
  menitTerlambat,
  pastikanPola,
  uraianPola
} from './rules'

const PERIKSA_MS = 30_000

interface BarisJadwal {
  id: string
  jenis: string
  username: string
  nama: string
  prompt: string
  mode: string
  pola: string
  aktif: number
  berikut: number | null
}

interface BarisJalan {
  dijadwalkan: number
  mulai: number
  status: JalanJadwal['status']
  keterangan: string | null
  session_id: string | null
}

/** Tugas yang sedang berjalan — mencegah satu tugas ditembakkan dua kali. */
const berjalan = new Set<string>()
let timer: NodeJS.Timeout | null = null
let sedangMemeriksa = false

function beritahuLayar(): void {
  const wc = mainWindow()?.webContents
  if (wc && !wc.isDestroyed()) wc.send(IPC_CHANNELS.jadwalBerubah)
}

function keJenis(j: string): JenisJadwal {
  return j === 'pengingat' ? 'pengingat' : 'aira'
}

function keItem(r: BarisJadwal): ItemJadwal {
  const pola = JSON.parse(r.pola) as PolaJadwal
  const riwayat = (
    rawDb()
      .prepare(
        `SELECT dijadwalkan, mulai, status, keterangan, session_id
           FROM jadwal_jalan WHERE jadwal_id = ? ORDER BY id DESC LIMIT ?`
      )
      .all(r.id, MAKS_RIWAYAT) as BarisJalan[]
  ).map((j) => ({
    dijadwalkan: j.dijadwalkan,
    mulai: j.mulai,
    status: j.status,
    keterangan: j.keterangan,
    sessionId: j.session_id
  }))
  return {
    id: r.id,
    jenis: keJenis(r.jenis),
    nama: r.nama,
    prompt: r.prompt,
    mode: r.mode as ItemJadwal['mode'],
    pola,
    uraian: uraianPola(pola),
    aktif: r.aktif === 1,
    berikut: r.berikut,
    riwayat
  }
}

/** Baris milik user ini, atau null. Kepemilikan di KLAUSA WHERE (aturan 16/32). */
function barisMilik(id: string, username: string): BarisJadwal | null {
  return (
    (rawDb()
      .prepare('SELECT * FROM jadwal WHERE id = ? AND username = ?')
      .get(id, username.toLowerCase()) as BarisJadwal | undefined) ?? null
  )
}

export function daftarJadwal(sesi: auth.SesiUser): ItemJadwal[] {
  const rows = rawDb()
    .prepare('SELECT * FROM jadwal WHERE username = ? ORDER BY dibuat')
    .all(sesi.username.toLowerCase()) as BarisJadwal[]
  return rows.map(keItem)
}

export function simpanJadwal(sesi: auth.SesiUser, input: SimpanJadwalInput): ItemJadwal[] {
  const nama = input.nama.trim()
  const prompt = input.prompt.trim()
  if (!nama) throw new JadwalError('Nama tugas wajib diisi.')
  if (nama.length > MAKS_NAMA) throw new JadwalError(`Nama tugas maksimal ${MAKS_NAMA} karakter.`)
  if (!prompt) throw new JadwalError('Perintah untuk AIRA wajib diisi.')
  if (prompt.length > MAKS_PROMPT) throw new JadwalError(`Perintah maksimal ${MAKS_PROMPT} karakter.`)
  const jenis: JenisJadwal = input.jenis === 'pengingat' ? 'pengingat' : 'aira'
  // Pengingat tidak menyentuh model maupun data — selalu di mode umum.
  const mode = jenis === 'pengingat' ? 'general' : input.mode
  if (!MODE_JADWAL.includes(mode)) throw new JadwalError('Menu tidak dikenal.')
  // Izin menu diperiksa saat MENYIMPAN (umpan balik langsung) DAN saat JALAN
  // (izin bisa dicabut Super Admin sesudahnya).
  if (!auth.bolehModeSekarang(mode)) {
    throw new JadwalError('Kamu tidak punya akses ke menu itu.')
  }
  const pola = pastikanPola(input.pola)
  const berikut = berikutnya(pola, new Date())
  if (berikut === null) throw new JadwalError('Waktunya sudah lewat — pilih waktu yang akan datang.')

  const user = sesi.username.toLowerCase()
  if (input.id) {
    if (!barisMilik(input.id, user)) throw new JadwalError('Tugas ini bukan milikmu.')
    rawDb()
      .prepare(
        `UPDATE jadwal SET nama = ?, prompt = ?, mode = ?, jenis = ?, pola = ?, berikut = ?, aktif = 1
          WHERE id = ? AND username = ?`
      )
      .run(nama, prompt, mode, jenis, JSON.stringify(pola), berikut.getTime(), input.id, user)
    audit('jadwal', 'ubah', `id=${input.id} oleh=${user}`)
  } else {
    const n = (
      rawDb().prepare('SELECT count(*) AS n FROM jadwal WHERE username = ?').get(user) as { n: number }
    ).n
    if (n >= MAKS_JADWAL_PER_USER) {
      throw new JadwalError(`Maksimal ${MAKS_JADWAL_PER_USER} tugas terjadwal per orang.`)
    }
    const id = randomUUID()
    rawDb()
      .prepare(
        `INSERT INTO jadwal (id, username, nama, prompt, mode, jenis, pola, aktif, berikut, dibuat)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .run(id, user, nama, prompt, mode, jenis, JSON.stringify(pola), berikut.getTime(), Date.now())
    audit('jadwal', 'buat', `id=${id} oleh=${user} mode=${mode} jenis=${jenis}`)
  }
  return daftarJadwal(sesi)
}

export function hapusJadwal(sesi: auth.SesiUser, id: string): ItemJadwal[] {
  const user = sesi.username.toLowerCase()
  // Riwayat jalan ikut terhapus (FK CASCADE); percakapan hasilnya TIDAK —
  // itu milik riwayat chat dan dihapus dari sana kalau user mau.
  const r = rawDb().prepare('DELETE FROM jadwal WHERE id = ? AND username = ?').run(id, user)
  if (r.changes > 0) audit('jadwal', 'hapus', `id=${id} oleh=${user}`)
  return daftarJadwal(sesi)
}

export function saklarJadwal(sesi: auth.SesiUser, id: string, aktif: boolean): ItemJadwal[] {
  const user = sesi.username.toLowerCase()
  const baris = barisMilik(id, user)
  if (!baris) throw new JadwalError('Tugas ini bukan milikmu.')
  // Dinyalakan lagi = dihitung ulang dari SEKARANG. Kalau `berikut` lama yang
  // dipakai, tugas yang dimatikan seminggu langsung "tertunda" dan disusulkan
  // begitu dinyalakan — padahal user baru saja memilih untuk tidak menjalankannya.
  const berikut = aktif ? berikutnya(JSON.parse(baris.pola) as PolaJadwal, new Date()) : baris.berikut
  if (aktif && berikut === null) {
    throw new JadwalError('Waktunya sudah lewat — ubah tanggalnya dulu.')
  }
  rawDb()
    .prepare('UPDATE jadwal SET aktif = ?, berikut = ? WHERE id = ? AND username = ?')
    .run(aktif ? 1 : 0, berikut instanceof Date ? berikut.getTime() : berikut, id, user)
  audit('jadwal', aktif ? 'nyala' : 'mati', `id=${id} oleh=${user}`)
  return daftarJadwal(sesi)
}

/**
 * Riwayat jalan milik user dalam rentang waktu `dijadwalkan` — untuk kalender
 * (titik di hari yang sudah lewat) dan statistik. Kepemilikan lewat JOIN ke
 * `jadwal.username`, di klausa WHERE (aturan 16).
 */
export function jalanDalamRentang(sesi: auth.SesiUser, dari: number, sampai: number): JalanDenganTugas[] {
  const rows = rawDb()
    .prepare(
      `SELECT j.id AS jadwal_id, j.nama, j.mode, j.jenis,
              r.dijadwalkan, r.mulai, r.status, r.keterangan, r.session_id
         FROM jadwal_jalan r JOIN jadwal j ON j.id = r.jadwal_id
        WHERE j.username = ? AND r.dijadwalkan >= ? AND r.dijadwalkan < ?
        ORDER BY r.dijadwalkan
        LIMIT 2000`
    )
    .all(sesi.username.toLowerCase(), dari, sampai) as Array<
    BarisJalan & { jadwal_id: string; nama: string; mode: string; jenis: string }
  >
  return rows.map((r) => ({
    jadwalId: r.jadwal_id,
    nama: r.nama,
    mode: r.mode as ItemJadwal['mode'],
    jenis: keJenis(r.jenis),
    dijadwalkan: r.dijadwalkan,
    mulai: r.mulai,
    status: r.status,
    keterangan: r.keterangan,
    sessionId: r.session_id
  }))
}

/** "Jalankan sekarang" dari layar — tidak menggeser jadwal berikutnya. */
export async function jalankanSekarang(sesi: auth.SesiUser, id: string): Promise<ItemJadwal[]> {
  const baris = barisMilik(id, sesi.username)
  if (!baris) throw new JadwalError('Tugas ini bukan milikmu.')
  if (berjalan.has(id)) throw new JadwalError('Tugas ini sedang berjalan.')
  await jalankan(baris, sesi, Date.now(), true)
  return daftarJadwal(sesi)
}

function catatJalan(
  jadwalId: string,
  dijadwalkan: number,
  status: JalanJadwal['status'],
  keterangan: string | null
): number {
  const r = rawDb()
    .prepare(
      `INSERT INTO jadwal_jalan (jadwal_id, dijadwalkan, mulai, status, keterangan)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(jadwalId, dijadwalkan, Date.now(), status, keterangan)
  // Riwayat dipangkas di sini supaya tabelnya tidak tumbuh tanpa batas.
  rawDb()
    .prepare(
      `DELETE FROM jadwal_jalan WHERE jadwal_id = ? AND id NOT IN
         (SELECT id FROM jadwal_jalan WHERE jadwal_id = ? ORDER BY id DESC LIMIT ?)`
    )
    .run(jadwalId, jadwalId, MAKS_SIMPAN_RIWAYAT)
  return Number(r.lastInsertRowid)
}

function selesaiJalan(jalanId: number, status: JalanJadwal['status'], keterangan: string | null): void {
  rawDb()
    .prepare('UPDATE jadwal_jalan SET status = ?, keterangan = ? WHERE id = ?')
    .run(status, keterangan, jalanId)
}

function keteranganGalat(kode: string): string {
  if (kode === 'LLM_CANCELLED') return 'Dibatalkan.'
  if (kode === 'TIDAK_SELESAI') return 'Berhenti sebelum selesai.'
  return `Gagal (${kode}).`
}

async function jalankan(
  baris: BarisJadwal,
  sesi: auth.SesiUser,
  dijadwalkan: number,
  manual: boolean
): Promise<void> {
  const pola = JSON.parse(baris.pola) as PolaJadwal
  const mode = baris.mode as ItemJadwal['mode']

  // Geser jadwal berikutnya DULU, sebelum mengirim apa pun. Kalau pengiriman
  // melempar, tugas yang sama tidak boleh ditembakkan ulang tiap 30 detik.
  if (!manual) {
    const lanjut = berikutnya(pola, new Date())
    rawDb()
      .prepare('UPDATE jadwal SET berikut = ?, aktif = ? WHERE id = ?')
      .run(lanjut ? lanjut.getTime() : null, lanjut ? 1 : 0, baris.id)
  }

  const telat = manual ? 0 : menitTerlambat(dijadwalkan, Date.now())
  const catatanTelat = telat > 0 ? `Disusulkan, terlambat ${telat} menit (AIRA/laptop tidak menyala tepat waktu).` : null

  // Pengingat: HANYA notifikasi. Tidak ada model, tidak ada data, tidak ada
  // percakapan baru — jadi tidak ada yang perlu diperiksa selain pemiliknya.
  if (keJenis(baris.jenis) === 'pengingat') {
    catatJalan(baris.id, dijadwalkan, 'ok', catatanTelat)
    audit('jadwal', 'pengingat', `id=${baris.id} manual=${manual} telat_menit=${telat}`)
    notify({ title: `Pengingat: ${baris.nama}`, body: baris.prompt, force: true })
    beritahuLayar()
    return
  }

  if (!auth.bolehModeSekarang(mode)) {
    catatJalan(baris.id, dijadwalkan, 'ditolak', 'Akses ke menu tugas ini sudah dicabut.')
    audit('jadwal', 'ditolak', `id=${baris.id} mode=${mode} user=${sesi.username}`)
    notify({ title: 'Tugas terjadwal tidak dijalankan', body: `${baris.nama}: akses menunya sudah dicabut.`, force: true })
    beritahuLayar()
    return
  }

  const provider = buildProvider()
  const wc = mainWindow()?.webContents
  if (!provider || !wc || wc.isDestroyed()) {
    catatJalan(baris.id, dijadwalkan, 'gagal', provider ? 'Jendela AIRA tidak tersedia.' : 'Model belum dikonfigurasi.')
    beritahuLayar()
    return
  }

  const jalanId = catatJalan(baris.id, dijadwalkan, 'jalan', catatanTelat)
  berjalan.add(baris.id)
  logger().info({ jadwal: baris.id, mode, manual, telat }, 'tugas terjadwal dimulai')
  audit('jadwal', 'jalan', `id=${baris.id} manual=${manual} telat_menit=${telat}`)
  beritahuLayar()

  try {
    const hasil = await sendChat(
      provider,
      wc,
      { sessionId: null, text: baris.prompt, attachments: [], mode },
      {
        terjadwal: true,
        judul: `Jadwal: ${baris.nama}`,
        onSelesai: (kodeGalat) => {
          berjalan.delete(baris.id)
          const ok = kodeGalat === null
          const ket = ok ? catatanTelat : [keteranganGalat(kodeGalat), catatanTelat].filter(Boolean).join(' ')
          selesaiJalan(jalanId, ok ? 'ok' : 'gagal', ket)
          logger().info({ jadwal: baris.id, kodeGalat }, 'tugas terjadwal selesai')
          notify({
            title: ok ? 'Tugas terjadwal selesai' : 'Tugas terjadwal gagal',
            body: `${baris.nama}${catatanTelat ? ' (disusulkan)' : ''} — buka menu Jadwal untuk melihat hasilnya.`,
            force: true
          })
          beritahuLayar()
        }
      }
    )
    rawDb().prepare('UPDATE jadwal_jalan SET session_id = ? WHERE id = ?').run(hasil.sessionId, jalanId)
    beritahuLayar()
  } catch (err) {
    berjalan.delete(baris.id)
    selesaiJalan(jalanId, 'gagal', `Gagal dimulai: ${String(err).slice(0, 200)}`)
    logger().warn({ jadwal: baris.id, err: String(err) }, 'tugas terjadwal gagal dimulai')
    beritahuLayar()
  }
}

async function periksa(): Promise<void> {
  if (sedangMemeriksa) return
  sedangMemeriksa = true
  try {
    const sesi = auth.sesiSekarang()
    // Hanya tugas milik orang yang SEDANG login. Tugas orang lain menunggu sampai
    // pemiliknya login di laptop ini, lalu disusulkan sekali.
    if (!sesi) {
      // Logout: toast pemantau berisi keadaan data orang yang baru keluar ditutup.
      tutupNotifikasiPemantau()
      return
    }
    if (jumlahRunAktif() > 0) return
    const kandidat = rawDb()
      .prepare(
        `SELECT * FROM jadwal
          WHERE username = ? AND aktif = 1 AND berikut IS NOT NULL AND berikut <= ?
          ORDER BY berikut LIMIT 5`
      )
      .all(sesi.username.toLowerCase(), Date.now()) as BarisJadwal[]
    const baris = kandidat.find((b) => !berjalan.has(b.id))
    // Tidak ada tugas jatuh tempo → giliran pemantau proaktif (RANCANGAN-PEMANTAU.md).
    // Satu penjadwal untuk semua yang dikerjakan AIRA sendiri: pemantau ikut berhenti
    // saat tidak ada sesi atau user sedang menunggu jawaban (penjagaan di atas), dan
    // query-nya tidak pernah berbarengan dengan tugas Jadwal.
    if (!baris) {
      await periksaPemantau()
      return
    }
    await jalankan(baris, sesi, baris.berikut ?? Date.now(), false)
  } catch (err) {
    logger().warn({ err: String(err) }, 'pemeriksaan jadwal gagal')
  } finally {
    sedangMemeriksa = false
  }
}

export function mulaiJadwal(): void {
  // Riwayat berstatus "jalan" dari sesi aplikasi sebelumnya = AIRA ditutup di
  // tengah tugas. Ditandai jujur, bukan dibiarkan berputar selamanya di layar.
  const r = rawDb()
    .prepare(
      `UPDATE jadwal_jalan SET status = 'gagal',
              keterangan = 'AIRA ditutup saat tugas masih berjalan.'
        WHERE status = 'jalan'`
    )
    .run()
  if (r.changes > 0) logger().info({ n: r.changes }, 'riwayat jadwal yatim ditandai gagal')
  // Pemeriksaan pertama ditunda: login & pemanasan database lebih dulu.
  setTimeout(() => void periksa(), 20_000)
  timer = setInterval(() => void periksa(), PERIKSA_MS)
}

export function hentikanJadwal(): void {
  if (timer) clearInterval(timer)
  timer = null
}
