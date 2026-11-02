// Aturan ruang uji (sandbox) — modul MURNI supaya ter-cover unit test.
//
// Ruang uji menjawab keluhan manajemen 21 Agu 2026: "LLM kasih file tanpa
// testing, pas dicoba error lagi". Yang dibutuhkan bukan sekadar kemampuan
// menjalankan kode — AIRA SUDAH punya `run_command` — melainkan tempat yang
// aman untuk mencoba TANPA gerbang persetujuan di setiap putaran.
//
// ⚠️ Justru karena popupnya dihilangkan, batasan di modul ini adalah
// satu-satunya yang tersisa. `run_command` boleh menerima shell bebas karena
// user membaca dan menyetujui tiap perintah; `uji_jalankan` TIDAK, jadi
// perintahnya harus dibatasi di kode.
//
// Apa yang ditahan di sini, dan apa yang TIDAK:
//   ✅ ditahan  — perintah di luar daftar-izin, rangkaian shell (&& | ; > `),
//                 lompat keluar ruang uji lewat `..` atau path absolut
//   ❌ TIDAK    — proses yang sudah terlanjur jalan. Ini isolasi FOLDER, bukan
//                 isolasi kernel. Windows tidak menyediakan padanan Docker /
//                 seatbelt tanpa native module (menabrak risiko bytenode §5b),
//                 jadi jangan pernah mengklaim ruang ini "aman dari kode jahat".
//                 Yang benar: ia menahan KESALAHAN, bukan NIAT JAHAT.

/** Runner yang boleh dipanggil tanpa persetujuan user. JS/TS saja (ketentuan user 21 Agu 2026). */
const RUNNER_DIIZINKAN = new Set([
  'node',
  'npm',
  'npx',
  'yarn',
  'pnpm',
  'tsc',
  'tsx',
  'vitest',
  'jest',
  'eslint',
  'prettier'
])

/**
 * Rangkaian & pengalihan shell. Tanpa ini daftar-izin runner tidak berarti
 * apa-apa: `node tes.js && del C:\Users\...` lolos hanya karena token
 * pertamanya "node".
 */
const OPERATOR_SHELL = /[&|;<>`\n\r]|\$\(/

/** Sub-perintah yang menarik paket dari internet. */
const SUBPERINTAH_PASANG = new Set(['install', 'i', 'add', 'ci', 'update', 'upgrade'])

export interface VerdictPerintah {
  ok: boolean
  /** Alasan penolakan, siap dikirim apa adanya ke model. */
  alasan?: string
  /** Token pertama (huruf kecil, tanpa .cmd/.exe). */
  runner?: string
  argv?: string[]
  /** Perintah ini menarik dependensi dari internet — butuh izin user. */
  butuhJaringan?: boolean
}

/** Memecah baris perintah menjadi token, menghormati tanda kutip. */
export function pecahPerintah(command: string): string[] {
  const token: string[] = []
  let sekarang = ''
  let kutip: '"' | "'" | null = null
  for (const ch of command) {
    if (kutip) {
      if (ch === kutip) kutip = null
      else sekarang += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      kutip = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (sekarang) token.push(sekarang)
      sekarang = ''
      continue
    }
    sekarang += ch
  }
  if (sekarang) token.push(sekarang)
  return token
}

/**
 * Apakah sebuah argumen mencoba keluar dari ruang uji.
 *
 * `cwd` sudah diperiksa `resolveInBoundary`, tapi ISI perintahnya tidak —
 * `node ..\..\..\Windows\jahat.js` berjalan dari cwd yang sah menuju berkas
 * yang tidak sah. Karena itu argumen wajib relatif dan tanpa `..`.
 */
export function argumenKeluarRuang(arg: string): boolean {
  if (/^[a-zA-Z]:[\\/]/.test(arg)) return true // C:\...
  if (arg.startsWith('\\\\')) return true // UNC \\server\share
  if (arg.startsWith('/') || arg.startsWith('\\')) return true // akar drive
  const segmen = arg.split(/[\\/]/)
  return segmen.includes('..')
}

/** Menormalkan token runner: "NPM.CMD" -> "npm". */
function normalkanRunner(token: string): string {
  return token.toLowerCase().replace(/\.(cmd|exe|bat|ps1)$/, '')
}

export function periksaPerintah(command: string): VerdictPerintah {
  const teks = command.trim()
  if (!teks) return { ok: false, alasan: 'perintah kosong' }

  if (OPERATOR_SHELL.test(teks)) {
    return {
      ok: false,
      alasan:
        'perintah berantai/pengalihan (&&, |, ;, >, backtick) tidak diizinkan di ruang uji. ' +
        'Jalankan satu perintah per panggilan. Kalau memang butuh shell penuh, pakai run_command ' +
        '(user akan diminta menyetujuinya).'
    }
  }

  const token = pecahPerintah(teks)
  const runner = normalkanRunner(token[0] ?? '')
  if (!RUNNER_DIIZINKAN.has(runner)) {
    return {
      ok: false,
      alasan:
        `"${token[0]}" bukan runner yang diizinkan di ruang uji. Yang boleh: ` +
        `${[...RUNNER_DIIZINKAN].join(', ')}. Ruang uji sengaja hanya untuk menjalankan kode ` +
        'JS/TS. Untuk perintah lain pakai run_command (user akan diminta menyetujuinya).'
    }
  }

  const argv = token.slice(1)
  const nakal = argv.find((a) => !a.startsWith('-') && argumenKeluarRuang(a))
  if (nakal) {
    return {
      ok: false,
      alasan:
        `argumen "${nakal}" menunjuk ke luar ruang uji. Di ruang uji semua path harus RELATIF ` +
        'dan tidak boleh memuat "..". Salin dulu berkas yang dibutuhkan ke dalam ruang uji ' +
        '(read_file lalu write_file).'
    }
  }

  return { ok: true, runner, argv, butuhJaringan: butuhJaringan(runner, argv) }
}

/**
 * Apakah perintah ini menarik paket dari internet.
 *
 * `npx` selalu dihitung butuh jaringan: ia mengunduh paket yang belum ada
 * secara diam-diam, dan kita tidak bisa tahu dari baris perintahnya saja
 * apakah paketnya sudah terpasang lokal.
 */
export function butuhJaringan(runner: string, argv: string[]): boolean {
  if (runner === 'npx') return true
  if (runner !== 'npm' && runner !== 'yarn' && runner !== 'pnpm') return false
  const sub = argv.find((a) => !a.startsWith('-'))?.toLowerCase()
  if (!sub) return runner === 'yarn' // `yarn` tanpa argumen = install
  return SUBPERINTAH_PASANG.has(sub)
}

const BATAS_KELUARAN = 8000

export function potongKeluaran(teks: string): { teks: string; dipotong: boolean } {
  if (teks.length <= BATAS_KELUARAN) return { teks, dipotong: false }
  // Ekor lebih berguna daripada kepala: pesan error ada di akhir.
  return { teks: '…[awal keluaran dipotong]…\n' + teks.slice(-BATAS_KELUARAN), dipotong: true }
}

export interface RingkasanUji {
  exitCode: number | null
  stdoutDipotong: boolean
  stderrDipotong: boolean
  timeout: boolean
  /** Runner yang tidak terpasang di laptop ini, mis. "npx". */
  runnerHilang?: string | null
}

/**
 * Kalimat yang menyatakan apa yang terjadi — TIDAK PERNAH string kosong.
 *
 * ⚠️ Aturan project: hasil tool tidak boleh diam soal kelengkapannya. Bendera
 * boolean sudah terbukti tidak cukup (§ CLAUDE.md) — model tetap mengarang
 * cerita tentang apa yang hilang. Yang menahan adalah KALIMAT, ditutup larangan
 * harfiah.
 *
 * Kasus paling berbahaya di sini adalah `runnerHilang`: uji TIDAK BERJALAN sama
 * sekali, dan bila itu tidak dinyatakan keras-keras, model akan menganggapnya
 * kegagalan biasa lalu tetap menyimpulkan kodenya sudah beres.
 */
export function catatanUji(r: RingkasanUji): string {
  const bagian: string[] = []

  if (r.runnerHilang) {
    bagian.push(
      `UJI TIDAK BERJALAN: "${r.runnerHilang}" tidak terpasang di laptop ini. Kodenya BELUM ` +
        'terbukti jalan. Katakan itu apa adanya ke user — jangan menyimpulkan kodenya sudah benar, ' +
        'dan jangan mengaku sudah mengujinya.'
    )
    if (r.runnerHilang !== 'node') {
      bagian.push('Untuk JavaScript polos, runner "node" SELALU tersedia di ruang uji — coba itu.')
    }
    return bagian.join(' ')
  }

  if (r.timeout) {
    bagian.push(
      'UJI DIHENTIKAN karena melewati batas waktu. Prosesnya tidak selesai, jadi hasilnya belum ' +
        'membuktikan apa pun. Kalau ini server/watcher yang memang hidup terus, pakai run_background.'
    )
    return bagian.join(' ')
  }

  if (r.exitCode === 0) {
    bagian.push('Perintah selesai dengan exit code 0 (berhasil).')
  } else {
    bagian.push(
      `Perintah GAGAL dengan exit code ${r.exitCode}. Baca stderr di atas, perbaiki kodenya, ` +
        'lalu jalankan uji lagi. Jangan menyerahkan kode ini ke user sebelum exit code 0.'
    )
  }

  if (r.stdoutDipotong || r.stderrDipotong) {
    const mana = [r.stdoutDipotong ? 'stdout' : null, r.stderrDipotong ? 'stderr' : null]
      .filter(Boolean)
      .join(' dan ')
    bagian.push(`Keluaran ${mana} terlalu panjang sehingga BAGIAN AWALNYA dipotong; bagian akhir utuh.`)
  } else {
    bagian.push('Seluruh keluaran perintah ditampilkan utuh, tidak ada yang dipotong.')
  }

  bagian.push(
    'Jangan menyebut ada bagian keluaran yang terpotong selain yang dinyatakan kalimat ini.'
  )
  return bagian.join(' ')
}
