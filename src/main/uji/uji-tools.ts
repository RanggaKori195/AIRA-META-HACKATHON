import { spawn } from 'child_process'
import { isAbsolute, join } from 'path'
import { resolveInBoundary } from '../tools/boundary'
import { ToolError, type ToolDefinition } from '../tools/types'
import { catatanUji, periksaPerintah, potongKeluaran } from './rules'
import { catatIzinJaringan, ruangUji, sudahBolehJaringan } from './ruang'
import { logger } from '../logger'

// `uji_jalankan` — menjalankan kode di ruang uji, TANPA gerbang persetujuan.
//
// Ini satu-satunya tool baru untuk fitur ini, dan itu disengaja: `tool-groups.ts`
// mencatat bahwa mengirim banyak tool sekaligus menurunkan akurasi pemilihan
// tool pada model 27B. Menyiapkan berkas ke ruang uji memakai write_file yang
// sudah ada; menyerahkan hasil ke berkas asli user memakai edit_file/write_file
// yang sudah ada — dan keduanya TETAP lewat persetujuan user, sebagaimana
// mestinya.

const TIMEOUT_DEFAULT_MS = 60_000
const TIMEOUT_MAKS_MS = 120_000

/** Kode keluar cmd.exe untuk "perintah tidak dikenal". */
const EXIT_PERINTAH_TIDAK_ADA = 9009
const PESAN_TIDAK_DIKENAL = /is not recognized as an internal or external command|bukan merupakan perintah|command not found|ENOENT/i

function sesiDari(ctx: { sessionId?: string }): string {
  const id = ctx.sessionId
  if (!id) {
    // Tanpa sesi kita tidak tahu ruang uji mana yang dipakai, dan izin jaringan
    // tidak punya tempat bersandar. Lebih baik menolak daripada diam-diam
    // menulis ke ruang milik sesi lain.
    throw new ToolError('ruang uji tidak tersedia untuk percakapan ini')
  }
  return id
}

/** Folder kerja uji — WAJIB di dalam ruang uji, bukan sekadar di dalam `allowedDirs`. */
function folderKerja(sessionId: string, subfolder: unknown): string {
  const akar = ruangUji(sessionId)
  const diminta =
    typeof subfolder === 'string' && subfolder.trim()
      ? isAbsolute(subfolder)
        ? subfolder
        : join(akar, subfolder)
      : akar

  // Batasnya adalah ruang uji SESI INI — bukan `allowedDirs` biasa. Folder akses
  // user (Desktop, D:\Laporan, …) ada di dalam allowedDirs, jadi memakai itu
  // berarti `uji_jalankan` boleh berjalan di folder kerja user tanpa satu pun
  // popup persetujuan — tepat hal yang ruang uji ini ada untuk mencegahnya.
  //
  // ⚠️ Perbandingannya WAJIB diserahkan ke `resolveInBoundary`, jangan
  // dibandingkan sendiri dengan `path.relative`. Versi pertama fungsi ini
  // membandingkan hasil resolveInBoundary (sudah lewat realpath) dengan path
  // logis dari `ruangUji()` — dan keduanya BERBEDA JAUH begitu AppData
  // dialihkan lewat junction. Terukur 21 Agu 2026: path logis
  // `…\AppData\Roaming\Electron\uji\<sesi>` menunjuk ke
  // `…\AppData\Local\Packages\…\LocalCache\Roaming\Electron\uji\<sesi>`,
  // sehingga SETIAP pemanggilan ditolak — ruang ujinya sendiri dianggap di luar
  // ruang uji. Folder redirection / profil roaming adalah hal biasa di
  // lingkungan korporat, jadi ini akan kena di laptop the company, bukan cuma di sini.
  try {
    return resolveInBoundary(diminta, [akar])
  } catch {
    throw new ToolError(
      'folder kerja harus berada di dalam ruang uji percakapan ini. ' +
        'Untuk menjalankan sesuatu di folder user, pakai run_command (butuh persetujuan user).'
    )
  }
}

/** Baris perintah yang aman dirangkai ulang dari token yang sudah divalidasi. */
function rangkaiUlang(token: string[]): string {
  return token.map((t) => (/\s/.test(t) ? `"${t}"` : t)).join(' ')
}

/**
 * Lingkungan untuk proses anak.
 *
 * Kredensial AIRA dibuang: kode yang sedang diuji ditulis oleh MODEL, dan tidak
 * ada alasan ia perlu melihat connection string database pasien. Ini murah dan
 * menutup satu jalur keluar yang tidak akan terlihat kalau sampai terjadi.
 */
function lingkungan(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (/^AIRA_/i.test(k)) continue
    env[k] = v
  }
  // Nonaktifkan pewarnaan supaya keluaran yang dibaca model bersih dari escape ANSI.
  env.NO_COLOR = '1'
  env.FORCE_COLOR = '0'
  return env
}

interface HasilJalan {
  exitCode: number | null
  stdout: string
  stderr: string
  timeout: boolean
}

function jalankan(
  runner: string,
  argv: string[],
  cwd: string,
  timeoutMs: number
): Promise<HasilJalan> {
  return new Promise((resolve) => {
    // `node` TIDAK diandalkan ada di PATH. Electron membawa Node-nya sendiri,
    // jadi JavaScript polos SELALU bisa diuji — bahkan di laptop yang sama
    // sekali tidak punya Node terpasang. Ini yang membuat janji "AIRA menguji
    // dulu" bisa ditepati di laptop the company mana pun.
    const pakaiElectron = runner === 'node'
    const env = lingkungan()
    if (pakaiElectron) env.ELECTRON_RUN_AS_NODE = '1'

    const child = pakaiElectron
      ? spawn(process.execPath, argv, { cwd, env, windowsHide: true })
      : spawn(rangkaiUlang([runner, ...argv]), { cwd, env, shell: true, windowsHide: true })

    let stdout = ''
    let stderr = ''
    let timeout = false
    const timer = setTimeout(() => {
      timeout = true
      child.kill()
    }, timeoutMs)

    child.stdout?.on('data', (c: Buffer) => {
      stdout += c.toString('utf-8')
    })
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString('utf-8')
    })
    child.on('error', (err) => {
      stderr += `\n[gagal menjalankan] ${err.message}`
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ exitCode: code, stdout, stderr, timeout })
    })
  })
}

export const ujiTools: ToolDefinition[] = [
  {
    name: 'uji_jalankan',
    label: 'Uji di Ruang Uji',
    description:
      'Menjalankan kode JavaScript/TypeScript di RUANG UJI — folder terpisah milik AIRA yang tidak ' +
      'menyentuh berkas user. Dipakai untuk MEMBUKTIKAN kode berjalan sebelum diserahkan ke user. ' +
      'Alurnya: tulis berkas ke ruang uji dengan write_file, panggil uji_jalankan, baca exit code & ' +
      'stderr, perbaiki, ulangi sampai exit code 0 — baru serahkan hasilnya ke user. ' +
      'Runner yang boleh: node, npm, npx, yarn, pnpm, tsc, tsx, vitest, jest, eslint, prettier. ' +
      'Satu perintah per panggilan (tanpa &&, |, ;, >). Semua path harus RELATIF terhadap ruang uji. ' +
      'Runner "node" selalu tersedia; yang lain tergantung apa yang terpasang di laptop ini.',
    parameters: {
      type: 'object',
      properties: {
        perintah: {
          type: 'string',
          description: 'Satu perintah, mis. "node tes.js" atau "npx tsc --noEmit hitung.ts"'
        },
        subfolder: {
          type: 'string',
          description: 'Subfolder di dalam ruang uji (opsional, relatif)'
        },
        timeoutDetik: { type: 'number', description: 'Batas waktu, default 60, maksimum 120' }
      },
      required: ['perintah']
    },
    tier: 'write',
    // Menjalankan kode di ruang uji tidak minta izin — itu justru gunanya.
    // Yang minta izin hanya MENARIK PAKET dari internet, dan cukup sekali per
    // percakapan (ketentuan user 21 Agu 2026).
    tierFor: (args, ctx) => {
      const verdict = periksaPerintah(String(args.perintah ?? ''))
      if (!verdict.ok || !verdict.butuhJaringan) return 'write'
      return ctx.sessionId && sudahBolehJaringan(ctx.sessionId) ? 'write' : 'execute'
    },
    timeoutMs: TIMEOUT_MAKS_MS + 10_000,
    summarize: (a) =>
      `Uji di ruang uji: ${a.perintah}${a.subfolder ? `  (di ${a.subfolder})` : ''}`,
    execute: async (args, ctx) => {
      const perintah = args.perintah
      if (typeof perintah !== 'string' || !perintah.trim()) {
        throw new ToolError('argumen "perintah" wajib berupa string')
      }
      const sessionId = sesiDari(ctx)
      const verdict = periksaPerintah(perintah)
      if (!verdict.ok) throw new ToolError(verdict.alasan ?? 'perintah ditolak')

      const cwd = folderKerja(sessionId, args.subfolder)
      const timeoutMs = Math.min(
        Math.max(Number(args.timeoutDetik) * 1000 || TIMEOUT_DEFAULT_MS, 1000),
        TIMEOUT_MAKS_MS
      )

      // Sampai di sini artinya gerbang persetujuan sudah dilewati (lihat
      // `tierFor`), jadi izinnya dicatat untuk sisa percakapan ini.
      if (verdict.butuhJaringan) catatIzinJaringan(sessionId)

      const hasil = await jalankan(verdict.runner!, verdict.argv!, cwd, timeoutMs)

      const runnerHilang =
        !hasil.timeout &&
        (hasil.exitCode === EXIT_PERINTAH_TIDAK_ADA || PESAN_TIDAK_DIKENAL.test(hasil.stderr))
          ? verdict.runner!
          : null

      const out = potongKeluaran(hasil.stdout.trim())
      const err = potongKeluaran(hasil.stderr.trim())
      const sukses = !hasil.timeout && !runnerHilang && hasil.exitCode === 0

      logger().info(
        { sessionId, perintah, exitCode: hasil.exitCode, sukses, runnerHilang },
        'uji dijalankan di ruang uji'
      )

      return JSON.stringify({
        perintah,
        ruangUji: cwd,
        exitCode: hasil.exitCode,
        // Dibaca `verify-guard` di akhir run: inilah satu-satunya bukti sah
        // bahwa kode benar-benar dijalankan dan lolos.
        ujiSukses: sukses,
        stdout: out.teks,
        stderr: err.teks,
        catatanHasil: catatanUji({
          exitCode: hasil.exitCode,
          stdoutDipotong: out.dipotong,
          stderrDipotong: err.dipotong,
          timeout: hasil.timeout,
          runnerHilang
        })
      })
    }
  }
]
