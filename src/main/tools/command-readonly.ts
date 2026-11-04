import { pecahPerintah } from '../uji/rules'

/*
 * Perintah shell yang HANYA MEMBACA, boleh jalan tanpa dialog persetujuan.
 *
 * Latar (permintaan user 8 Sep 2026): "cek versi", "lihat daftar paket" memunculkan
 * dialog persetujuan yang sama beratnya dengan "install" atau "hapus". Efeknya persis
 * yang diperingatkan §25 tentang ruang uji: popup yang terlalu sering membuat user
 * menekan "izinkan" tanpa membaca — dan begitu itu terjadi, gerbang persetujuan
 * kehilangan artinya justru untuk perintah yang benar-benar berbahaya.
 *
 * Jadi tujuan modul ini BUKAN memberi AIRA lebih banyak kuasa. Tujuannya
 * MEMPERTAHANKAN arti dialog persetujuan, dengan menghapus dialog yang tidak
 * memberi informasi apa pun kepada user.
 *
 * ⚠️ Tiga aturan yang tidak boleh dilonggarkan:
 *
 * 1. DAFTAR-IZIN, bukan daftar-larangan. Perintah yang belum terpikirkan otomatis
 *    TETAP minta izin, bukan otomatis lolos (pola §35 `KOLOM_AMAN`).
 * 2. OPERATOR SHELL DITOLAK. Tanpa ini daftar-izin tidak berarti apa-apa:
 *    `npm --version && del /s /q C:\` lolos hanya karena token pertamanya "npm".
 *    Ini pelajaran §25 yang sudah dibayar sekali.
 * 3. TIDAK ADA perintah pembaca ISI BERKAS di sini (`type`, `cat`, `more`,
 *    `Get-Content`). Sekilas ia "cuma membaca", tapi `type .env` mencetak
 *    kredensial ke jendela chat lalu ikut terkirim ke model. Untuk membaca berkas
 *    ada `read_file`, yang dibatasi folder akses.
 */

/** Operator berantai/pengalihan. Sama persis dengan yang dipakai ruang uji. */
const OPERATOR_SHELL = /[&|;<>`\n\r]|\$\(/

/**
 * Perintah yang seluruhnya baca, apa pun argumennya.
 * Hanya untuk yang benar-benar tidak punya bentuk destruktif.
 */
const SELALU_BACA = new Set(['whoami', 'hostname', 'systeminfo', 'ver', 'date', 'time'])

/**
 * Runner beserta sub-perintah BACA yang diizinkan.
 * Sub-perintah di luar daftar ini tetap minta izin.
 */
const SUBPERINTAH_BACA: Record<string, Set<string>> = {
  npm: new Set(['list', 'ls', 'view', 'outdated', 'ping', 'root', 'prefix', 'config']),
  pnpm: new Set(['list', 'ls', 'outdated', 'why']),
  yarn: new Set(['list', 'why', 'info']),
  // ⚠️ `git` sengaja TERBATAS. `git clean`, `git reset`, `git checkout`, `git push`
  // semuanya merusak atau keluar mesin — tidak satu pun boleh lolos diam-diam.
  git: new Set(['status', 'log', 'diff', 'branch', 'show', 'remote', 'config']),
  winget: new Set(['list', 'search', 'show']),
  choco: new Set(['list', 'search', 'info', 'version']),
  // nvm: pemeriksa versi Node yang paling sering dipakai. `nvm install/use/uninstall`
  // TIDAK ikut — itu mengubah Node yang aktif untuk seluruh laptop.
  nvm: new Set(['version', 'list', 'ls', 'current']),
  pip: new Set(['list', 'show', 'freeze']),
  docker: new Set(['ps', 'images', 'version', 'info']),
  where: new Set([]),
  which: new Set([])
}

/** Bendera versi/bantuan — aman untuk runner apa pun yang dikenal. */
const FLAG_VERSI = new Set(['--version', '-v', '-V', 'version', '--help', '-h', 'help'])

/**
 * Runner yang boleh ditanyai versinya. Daftar terpisah supaya `--version` tidak
 * jadi celah untuk menjalankan program sembarangan yang kebetulan mengabaikannya.
 */
const RUNNER_DIKENAL = new Set([
  'node', 'npm', 'npx', 'pnpm', 'yarn', 'git', 'python', 'python3', 'pip', 'pip3',
  'codex', 'code', 'dotnet', 'java', 'go', 'rustc', 'cargo', 'docker',
  'winget', 'choco', 'nvm', 'tsc', 'where', 'which', 'powershell', 'pwsh'
])

/** Membuang akhiran `.exe`/`.cmd` dan menyeragamkan huruf. */
function normalkanRunner(token: string): string {
  return token
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|ps1)$/, '')
    .replace(/^.*[\\/]/, '')
}

/**
 * Apakah perintah ini boleh jalan TANPA dialog persetujuan.
 *
 * Mengembalikan `false` untuk apa pun yang meragukan — ragu berarti tanya.
 */
export function perintahHanyaBaca(command: string): boolean {
  const teks = command.trim()
  if (!teks) return false

  // Aturan 2: operator shell membatalkan seluruh daftar-izin.
  if (OPERATOR_SHELL.test(teks)) return false

  const token = pecahPerintah(teks)
  if (token.length === 0) return false

  const runner = normalkanRunner(token[0])
  const argv = token.slice(1)

  if (SELALU_BACA.has(runner)) return true

  // `<runner> --version` / `--help`, hanya untuk runner yang dikenal.
  if (RUNNER_DIKENAL.has(runner) && argv.length >= 1 && argv.every((a) => FLAG_VERSI.has(a))) {
    return true
  }

  const sub = SUBPERINTAH_BACA[runner]
  if (!sub) return false

  // `where node`, `which git` — argumennya cuma nama program.
  if (sub.size === 0) {
    return argv.length > 0 && argv.every((a) => /^[\w.\-+]+$/.test(a))
  }

  const pertama = argv.find((a) => !a.startsWith('-'))
  if (!pertama) return false
  if (!sub.has(pertama.toLowerCase())) return false

  /*
   * ⚠️ Sub-perintah baca pun bisa diberi bendera yang MENGUBAH.
   * Bentuk "set/unset/edit/add/rm" ditolak walau sub-perintahnya ada di daftar.
   */
  const menulis = argv.some((a) =>
    ['set', 'unset', 'edit', 'add', 'rm', 'remove', 'delete', 'replace'].includes(a.toLowerCase())
  )
  if (menulis) return false

  /*
   * ⚠️ `config` WAJIB punya penanda baca eksplisit — ditemukan oleh test sendiri.
   *
   * Daftar kata "set/add/rm" di atas TIDAK menangkap `git config --global
   * user.email x@y.z`: git menulis begitu saja begitu diberi nilai, tanpa kata
   * kerja apa pun. Jadi untuk `config`, diam berarti MENULIS — dan asumsi
   * bawaannya harus dibalik: hanya lolos bila jelas-jelas membaca.
   */
  if (pertama.toLowerCase() === 'config') {
    const penandaBaca = ['get', '--get', '--get-all', 'list', '--list', '-l']
    return argv.some((a) => penandaBaca.includes(a.toLowerCase()))
  }

  return true
}
