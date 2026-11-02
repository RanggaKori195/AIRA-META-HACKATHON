import { app } from 'electron'
import { randomUUID } from 'crypto'
import { authQuery, loginDbConfigured } from '../auth/db'
import { identitasMesin } from '../auth/identity'
import type { SesiUser } from '../auth/service'
import * as localDb from '../db'
import { logger } from '../logger'
import {
  MAKS_ANTREAN,
  RETENSI_PROMPT_HARI,
  bentukAktivitas,
  polaCari,
  type AktivitasBaru
} from './rules'
import type {
  AktivitasRow,
  ChatMode,
  LinimasaHasil,
  LinimasaInput,
  MonitoringFilter,
  MonitoringRingkasan,
  ToolActivity
} from '../../shared/ipc'

/*
 * Monitoring pemakaian AIRA (permintaan atasan user, 16 Sep 2026).
 *
 * Alurnya: akhir tiap jawaban -> baris masuk ANTREAN SQLite lokal -> pengirim di
 * main process memindahkannya ke `tb_aktivitas_aira` -> Super Admin membacanya.
 *
 * ⚠️ Memakai pool auth yang SUDAH ADA (`auth/db.ts`), bukan pool baru — alasan
 * `max_connections` yang sama dengan `feedback/service.ts`. Query-nya ikut
 * diserialkan bersama detak kehadiran & pengawas notifikasi, jadi pengiriman ini
 * tidak bisa memicu pembukaan koneksi serentak yang terbukti rapuh di Electron.
 *
 * ⚠️ Kegagalan mencatat TIDAK BOLEH menjatuhkan jawaban. Semua jalur di sini
 * menelan galatnya sesudah dicatat di log.
 */

type Kueri = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>

let kueri: Kueri = authQuery
let terhubung: () => boolean = loginDbConfigured

/** Live-check memakai statement ASLI lewat koneksinya sendiri (pola `chat/grup.ts`). */
export function pakaiKoneksiUji(q: Kueri): void {
  kueri = q
  terhubung = () => true
}

const JEDA_KIRIM_MS = 60_000
const JEDA_SEGERA_MS = 5_000
const UKURAN_BATCH = 50
const MAKS_BATCH_PER_PUTARAN = 10

function versiAplikasi(): string {
  try {
    return app.getVersion()
  } catch {
    return process.env.npm_package_version ?? 'dev'
  }
}

// ------------------------------------------------------------------ mencatat

/**
 * Dipanggil orchestrator saat satu jawaban selesai (berhasil, gagal, atau batal).
 *
 * Identitas diambil dari SESI main process dan dari mesin ini — tidak ada satu
 * pun yang berasal dari renderer (pola `kirimFeedback`).
 */
export function catatAktivitas(input: {
  sesi: SesiUser
  mulai: number
  mode: ChatMode
  model: string
  sesiId: string
  teks: string
  lampiran: readonly string[]
  activities: readonly ToolActivity[]
  kodeGalat: string | null
  usage?: { promptTokens: number; completionTokens: number }
}): void {
  try {
    const baris = bentukAktivitas({
      ...input,
      eventId: randomUUID(),
      mesin: identitasMesin(),
      appVersion: versiAplikasi(),
      selesai: Date.now()
    })
    localDb.antreAktivitas(baris.eventId, JSON.stringify(baris))
    const dibuang = localDb.pangkasAntrean(MAKS_ANTREAN)
    if (dibuang > 0) {
      // Tidak diam: statistik laptop ini akan bolong, dan itu harus bisa dijawab.
      logger().warn({ dibuang }, 'antrean monitoring penuh — catatan tertua dibuang')
      localDb.audit('monitoring', 'antrean_dibuang', `n=${dibuang}`)
    }
    segerakanKirim()
  } catch (err) {
    logger().warn({ err: String(err) }, 'mencatat aktivitas gagal')
  }
}

// ------------------------------------------------------------------ mengirim

let timer: NodeJS.Timeout | null = null
let timerSegera: NodeJS.Timeout | null = null
let sedangKirim = false
let retensiSudah = false

/**
 * Memindahkan antrean ke server. SATU statement per batch: seluruh batch
 * dikirim sebagai satu parameter JSON, dan `ON CONFLICT (event_id)` membuat
 * pengiriman ulang aman (koneksi yang putus sesudah INSERT berhasil).
 */
export async function kirimAntrean(): Promise<number> {
  if (sedangKirim || !terhubung()) return 0
  sedangKirim = true
  let terkirim = 0
  try {
    for (let putaran = 0; putaran < MAKS_BATCH_PER_PUTARAN; putaran++) {
      const antre = localDb.ambilAntrean(UKURAN_BATCH)
      if (antre.length === 0) break
      const sah: AktivitasBaru[] = []
      const idSah: number[] = []
      const idRusak: number[] = []
      for (const a of antre) {
        try {
          sah.push(JSON.parse(a.payload) as AktivitasBaru)
          idSah.push(a.id)
        } catch {
          idRusak.push(a.id)
        }
      }
      if (idRusak.length > 0) {
        logger().warn({ n: idRusak.length }, 'antrean monitoring rusak dibuang')
        localDb.audit('monitoring', 'antrean_rusak', `n=${idRusak.length}`)
        localDb.buangAntrean(idRusak)
      }
      if (sah.length > 0) {
        await kirimBatch(sah)
        localDb.buangAntrean(idSah)
        terkirim += sah.length
      }
      if (antre.length < UKURAN_BATCH) break
    }
    if (!retensiSudah) {
      retensiSudah = true
      await terapkanRetensi()
    }
  } catch (err) {
    // VPN putus = hal biasa. Antrean tetap utuh dan dicoba lagi putaran berikutnya.
    logger().debug({ err: String(err).slice(0, 160) }, 'pengiriman aktivitas tertunda')
  } finally {
    sedangKirim = false
  }
  if (terkirim > 0) logger().info({ terkirim }, 'aktivitas terkirim ke server')
  return terkirim
}

export async function kirimBatch(baris: readonly AktivitasBaru[]): Promise<void> {
  await kueri(
    `INSERT INTO tb_aktivitas_aira
       (event_id, username, role, divisi, hostname, os_user, app_version, waktu,
        mode, model, sesi_id, prompt, prompt_dipotong, lampiran, tools, jumlah_tool,
        status, kode_galat, durasi_ms, prompt_tokens, completion_tokens)
     SELECT r."eventId", r.username, r.role, r.divisi, r.hostname, r."osUser",
            r."appVersion", r.waktu, r.mode, r.model, r."sesiId", r.prompt,
            coalesce(r."promptDipotong", false),
            ARRAY(SELECT jsonb_array_elements_text(coalesce(r.lampiran, '[]'::jsonb))),
            coalesce(r.tools, '[]'::jsonb), coalesce(r."jumlahTool", 0),
            r.status, r."kodeGalat", r."durasiMs", r."promptTokens", r."completionTokens"
       FROM jsonb_to_recordset($1::jsonb) AS r(
              "eventId" uuid, username text, role text, divisi text, hostname text,
              "osUser" text, "appVersion" text, waktu timestamptz, mode text, model text,
              "sesiId" text, prompt text, "promptDipotong" boolean, lampiran jsonb,
              tools jsonb, "jumlahTool" integer, status text, "kodeGalat" text,
              "durasiMs" integer, "promptTokens" integer, "completionTokens" integer)
     ON CONFLICT (event_id) DO NOTHING`,
    [JSON.stringify(baris)]
  )
}

/**
 * Teks pertanyaan yang melewati masa simpan dikosongkan; metadatanya tetap.
 * Dijalankan sekali per start aplikasi — murah karena index parsial
 * `idx_tb_aktivitas_aira_retensi` hanya memuat baris yang masih berteks.
 */
export async function terapkanRetensi(hari = RETENSI_PROMPT_HARI): Promise<number> {
  const rows = await kueri<{ n: number }>(
    `WITH x AS (
       UPDATE tb_aktivitas_aira
          SET prompt = NULL
        WHERE prompt IS NOT NULL
          AND waktu < now() - make_interval(days => $1::int)
       RETURNING 1)
     SELECT count(*)::int AS n FROM x`,
    [hari]
  )
  const n = rows[0]?.n ?? 0
  if (n > 0) logger().info({ n, hari }, 'teks pertanyaan lama dikosongkan (retensi)')
  return n
}

function segerakanKirim(): void {
  if (timerSegera) return
  timerSegera = setTimeout(() => {
    timerSegera = null
    void kirimAntrean()
  }, JEDA_SEGERA_MS)
  timerSegera.unref()
}

/** Dipanggil sekali saat aplikasi siap. */
export function mulaiKirimAktivitas(): void {
  if (timer) return
  timer = setInterval(() => void kirimAntrean(), JEDA_KIRIM_MS)
  timer.unref()
  // Tidak langsung: detik-detik pertama milik migrasi skema & pemulihan sesi.
  const awal = setTimeout(() => void kirimAntrean(), 20_000)
  awal.unref()
}

export function hentikanKirimAktivitas(): void {
  if (timer) clearInterval(timer)
  if (timerSegera) clearTimeout(timerSegera)
  timer = null
  timerSegera = null
}

export function jumlahBelumTerkirim(): number {
  try {
    return localDb.jumlahAntrean()
  } catch {
    return 0
  }
}

// ------------------------------------------------------------------ membaca

const SARING = `
      waktu >= now() - make_interval(days => $1::int)
  AND ($2::text IS NULL OR lower(username) = lower($2::text))
  AND ($3::text IS NULL OR mode = $3::text)
  AND ($4::text IS NULL OR prompt ILIKE $4::text)`

function paramSaring(f: MonitoringFilter): unknown[] {
  return [f.periodeHari, f.username?.trim() || null, f.mode, polaCari(f.cari)]
}

function larik<T>(nilai: unknown): T[] {
  if (Array.isArray(nilai)) return nilai as T[]
  if (typeof nilai === 'string') {
    try {
      const x = JSON.parse(nilai)
      return Array.isArray(x) ? (x as T[]) : []
    } catch {
      return []
    }
  }
  return []
}

/**
 * Ringkasan untuk layar monitoring. SATU statement — panel ini dibuka dari
 * main process yang sama dengan chat, dan tujuh round-trip berurutan terasa.
 *
 * Tiap pemanggilan dicatat ke `tb_aktivitas_akses_aira`.
 */
export async function ringkasan(admin: SesiUser, f: MonitoringFilter): Promise<MonitoringRingkasan> {
  const rows = await kueri<any>(
    `WITH f AS (
       SELECT lower(username) AS u, role, divisi, waktu, mode, status, jumlah_tool, tools
         FROM tb_aktivitas_aira
        WHERE ${SARING}
     )
     SELECT
       (SELECT count(*) FROM f)::int AS total,
       (SELECT count(DISTINCT u) FROM f)::int AS pengguna,
       (SELECT count(*) FROM f WHERE status = 'gagal')::int AS gagal,
       (SELECT count(*) FROM f WHERE jumlah_tool > 0)::int AS pakai_tool,
       (SELECT coalesce(json_agg(p ORDER BY p.pertanyaan DESC), '[]'::json) FROM (
          SELECT u AS username, max(role) AS role, max(divisi) AS divisi,
                 count(*)::int AS pertanyaan,
                 count(*) FILTER (WHERE status = 'gagal')::int AS gagal,
                 count(DISTINCT (waktu AT TIME ZONE 'Asia/Jakarta')::date)::int AS hari_aktif,
                 max(waktu) AS terakhir,
                 mode() WITHIN GROUP (ORDER BY mode) AS menu
            FROM f GROUP BY u) p) AS per_pengguna,
       (SELECT coalesce(json_agg(m ORDER BY m.jumlah DESC), '[]'::json) FROM (
          SELECT coalesce(mode, 'general') AS mode, count(*)::int AS jumlah
            FROM f GROUP BY 1) m) AS per_menu,
       (SELECT coalesce(json_agg(h ORDER BY h.tanggal), '[]'::json) FROM (
          SELECT to_char((waktu AT TIME ZONE 'Asia/Jakarta')::date, 'YYYY-MM-DD') AS tanggal,
                 count(*)::int AS jumlah, count(DISTINCT u)::int AS pengguna
            FROM f GROUP BY 1) h) AS per_hari,
       (SELECT coalesce(json_agg(t ORDER BY t.jumlah DESC), '[]'::json) FROM (
          SELECT e->>'nama' AS nama, sum(coalesce((e->>'kali')::int, 1))::int AS jumlah
            FROM f CROSS JOIN LATERAL jsonb_array_elements(coalesce(f.tools, '[]'::jsonb)) e
           GROUP BY 1 ORDER BY 2 DESC LIMIT 15) t) AS tool_teratas,
       (SELECT coalesce(json_agg(j), '[]'::json) FROM (
          SELECT extract(hour FROM waktu AT TIME ZONE 'Asia/Jakarta')::int AS jam,
                 count(*)::int AS jumlah
            FROM f GROUP BY 1) j) AS per_jam`,
    paramSaring(f)
  )
  await catatAkses(admin, f)

  const r = rows[0] ?? {}
  const perJam = new Array<number>(24).fill(0)
  for (const j of larik<{ jam: number; jumlah: number }>(r.per_jam)) {
    if (j.jam >= 0 && j.jam < 24) perJam[j.jam] = j.jumlah
  }
  return {
    totalPertanyaan: Number(r.total ?? 0),
    penggunaAktif: Number(r.pengguna ?? 0),
    gagal: Number(r.gagal ?? 0),
    pakaiTool: Number(r.pakai_tool ?? 0),
    perPengguna: larik<any>(r.per_pengguna).map((p) => ({
      username: p.username,
      role: p.role ?? null,
      divisi: p.divisi ?? null,
      pertanyaan: Number(p.pertanyaan),
      gagal: Number(p.gagal),
      hariAktif: Number(p.hari_aktif),
      terakhir: new Date(p.terakhir).toISOString(),
      menuTersering: p.menu ?? null
    })),
    perMenu: larik<{ mode: string; jumlah: number }>(r.per_menu),
    perHari: larik<{ tanggal: string; jumlah: number; pengguna: number }>(r.per_hari),
    toolTeratas: larik<{ nama: string; jumlah: number }>(r.tool_teratas),
    perJam
  }
}

const UKURAN_HALAMAN = 50

export async function linimasa(input: LinimasaInput): Promise<LinimasaHasil> {
  const rows = await kueri<any>(
    `SELECT id, username, role, divisi, hostname, app_version, waktu, mode, model,
            prompt, prompt_dipotong, lampiran, tools, jumlah_tool, status, kode_galat,
            durasi_ms, prompt_tokens, completion_tokens
       FROM tb_aktivitas_aira
      WHERE ${SARING}
        AND ($5::timestamptz IS NULL OR (waktu, id) < ($5::timestamptz, $6::bigint))
      ORDER BY waktu DESC, id DESC
      LIMIT $7`,
    [
      ...paramSaring(input),
      input.sebelum?.waktu ?? null,
      input.sebelum?.id ?? 0,
      UKURAN_HALAMAN + 1
    ]
  )
  const baris: AktivitasRow[] = rows.slice(0, UKURAN_HALAMAN).map((r) => ({
    id: Number(r.id),
    username: r.username,
    role: r.role,
    divisi: r.divisi,
    hostname: r.hostname,
    appVersion: r.app_version,
    waktu: new Date(r.waktu).toISOString(),
    mode: r.mode,
    model: r.model,
    prompt: r.prompt,
    promptDipotong: r.prompt_dipotong === true,
    lampiran: Array.isArray(r.lampiran) ? r.lampiran : [],
    tools: larik(r.tools),
    jumlahTool: Number(r.jumlah_tool ?? 0),
    status: r.status,
    kodeGalat: r.kode_galat,
    durasiMs: r.durasi_ms === null ? null : Number(r.durasi_ms),
    promptTokens: r.prompt_tokens === null ? null : Number(r.prompt_tokens),
    completionTokens: r.completion_tokens === null ? null : Number(r.completion_tokens)
  }))
  return { baris, adaLagi: rows.length > UKURAN_HALAMAN }
}

async function catatAkses(admin: SesiUser, f: MonitoringFilter): Promise<void> {
  await kueri(
    `INSERT INTO tb_aktivitas_akses_aira (admin, username_dilihat, periode_hari, cari, hostname)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      admin.username,
      f.username?.trim() || null,
      f.periodeHari,
      f.cari?.trim().slice(0, 100) || null,
      identitasMesin().hostname
    ]
  )
  try {
    localDb.audit(
      'monitoring',
      'dibuka',
      `oleh=${admin.username} lihat=${f.username ?? 'semua'} hari=${f.periodeHari}`
    )
  } catch {
    /* audit lokal belum siap (mis. live-check di luar Electron) — jejak server sudah tertulis */
  }
}
