// Bukti bahwa RUANG UJI benar-benar bekerja — dijalankan di runtime ELECTRON,
// sama seperti aplikasinya.
//
// Jalankan:  npm run coba:uji
//
// Kenapa ada: unit test hanya menguji `periksaPerintah` (modul murni). Yang
// TIDAK bisa dibuktikan unit test justru bagian yang paling menentukan:
//
//   1. "node SELALU tersedia, bahkan bila laptop tidak punya Node terpasang".
//      Itu klaim tentang RUNTIME — bergantung pada `process.execPath` di dalam
//      Electron dan pada ELECTRON_RUN_AS_NODE. Dijalankan dari `npx tsx` klaim
//      itu palsu-lolos, karena di sana process.execPath MEMANG node.
//      Pelajaran project ini persis itu: `pool.connect()` normal di Node dan
//      selalu timeout di Electron (HANDOFF §7).
//   2. Perintah berbahaya ditolak di TITIK EKSEKUSI, bukan cuma di modul murni.
//   3. Kredensial AIRA tidak diwariskan ke proses anak — kode yang diuji
//      ditulis MODEL, dan kegagalan di sini akan sunyi sepenuhnya.
//   4. Batas waktu benar-benar menghentikan proses yang menggantung.

process.env.AIRA_LOG_SILENT = '1'

import { app } from 'electron'
import { writeFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { ujiTools } from '../src/main/uji/uji-tools'
import { ruangUji, ruangUjiRoot, hapusRuangUji, catatIzinJaringan } from '../src/main/uji/ruang'

const SESI = 'coba-uji-sesi'
const uji = ujiTools[0]

const masalah: string[] = []
function periksa(nama: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'OK  ' : 'GAGAL'}  ${nama}${detail ? ` — ${detail}` : ''}`)
  if (!ok) masalah.push(nama + (detail ? ` (${detail}) ` : ''))
}

interface Hasil {
  exitCode: number | null
  ujiSukses: boolean
  stdout: string
  stderr: string
  catatanHasil: string
}

async function jalankan(args: Record<string, unknown>): Promise<Hasil | { error: string }> {
  try {
    const keluar = await uji.execute(args, { allowedDirs: [ruangUjiRoot()], sessionId: SESI })
    return JSON.parse(keluar) as Hasil
  } catch (err: any) {
    return { error: String(err?.message ?? err) }
  }
}

async function main(): Promise<void> {
  await app.whenReady()
  const ruang = ruangUji(SESI)
  console.log(`ruang uji: ${ruang}\n`)

  // Kredensial palsu untuk membuktikan proses anak TIDAK mewarisinya.
  process.env.AIRA_RAHASIA_PALSU = 'postgresql://postgres:123@10.0.0.10:5432/DB-REPOSITORY'

  // ── 1. Kode yang benar: harus jalan & exit code 0 ────────────────────────
  writeFileSync(
    join(ruang, 'tes.js'),
    [
      'const bagi = (a, b) => (b === 0 ? null : a / b)',
      'if (bagi(10, 2) !== 5) { console.error("salah"); process.exit(1) }',
      'if (bagi(1, 0) !== null) { console.error("nol tidak dijaga"); process.exit(1) }',
      'console.log("HASIL_BENAR")',
      'console.log("EXECPATH=" + process.execPath)',
      'console.log("PUNYA_RAHASIA=" + Object.keys(process.env).some((k) => k.startsWith("AIRA_")))'
    ].join('\n'),
    'utf-8'
  )

  console.log('1. menjalankan kode yang benar')
  const baik = await jalankan({ perintah: 'node tes.js' })
  if ('error' in baik) {
    periksa('kode benar berjalan', false, baik.error)
  } else {
    periksa('exit code 0', baik.exitCode === 0, `exitCode=${baik.exitCode}`)
    periksa('ujiSukses true', baik.ujiSukses === true)
    periksa('keluaran benar', baik.stdout.includes('HASIL_BENAR'))

    // ⚠️ INI pemeriksaan yang tidak bisa dilakukan di luar Electron.
    const execPath = /EXECPATH=(.+)/.exec(baik.stdout)?.[1]?.trim() ?? ''
    periksa(
      'node dijalankan lewat binary Electron (bukan Node di PATH)',
      execPath.toLowerCase() === process.execPath.toLowerCase(),
      execPath
    )

    // Kegagalan di sini sepenuhnya sunyi: kode model tetap jalan, hanya saja
    // ia bisa membaca connection string database pasien.
    periksa(
      'kredensial AIRA_* TIDAK diwariskan ke proses anak',
      baik.stdout.includes('PUNYA_RAHASIA=false'),
      /PUNYA_RAHASIA=(\w+)/.exec(baik.stdout)?.[1] ?? '?'
    )
    periksa('catatan menyatakan keluaran utuh', /utuh, tidak ada yang dipotong/i.test(baik.catatanHasil))
  }

  // ── 2. Kode yang salah: harus GAGAL, dan catatannya menyuruh perbaiki ────
  console.log('\n2. menjalankan kode yang salah (harus gagal)')
  writeFileSync(join(ruang, 'rusak.js'), 'const x = ;\n', 'utf-8')
  const rusak = await jalankan({ perintah: 'node rusak.js' })
  if ('error' in rusak) {
    periksa('kode rusak terdeteksi', false, rusak.error)
  } else {
    periksa('exit code bukan 0', rusak.exitCode !== 0, `exitCode=${rusak.exitCode}`)
    periksa('ujiSukses false', rusak.ujiSukses === false)
    periksa('stderr memuat pesan syntax error', /SyntaxError/i.test(rusak.stderr))
    periksa(
      'catatan melarang menyerahkan kode yang belum lolos',
      /Jangan menyerahkan kode ini/i.test(rusak.catatanHasil)
    )
  }

  // ── 3. Perintah berbahaya ditolak di titik eksekusi ──────────────────────
  console.log('\n3. perintah berbahaya (semua harus DITOLAK)')
  const sasaran = join(ruangUjiRoot(), 'JANGAN-TERHAPUS.txt')
  writeFileSync(sasaran, 'berkas ini tidak boleh hilang', 'utf-8')

  for (const perintah of [
    `node tes.js & del "${sasaran}"`,
    'node tes.js && echo tembus',
    'node ..\\..\\..\\Windows\\System32\\calc.js',
    'powershell -c "Get-Process"',
    'del tes.js',
    'node tes.js > bocor.txt'
  ]) {
    const hasil = await jalankan({ perintah })
    periksa(`ditolak: ${perintah}`, 'error' in hasil, 'error' in hasil ? '' : 'JUSTRU DIJALANKAN')
  }
  periksa('berkas di luar ruang uji masih ada', existsSync(sasaran))
  periksa(
    'tidak ada berkas hasil pengalihan',
    !existsSync(join(ruang, 'bocor.txt')) && !existsSync(join(ruang, 'tembus'))
  )

  // ── 4. Tidak bisa keluar ruang uji lewat subfolder ───────────────────────
  console.log('\n4. lompat keluar ruang uji lewat subfolder')
  const keluar = await jalankan({ perintah: 'node tes.js', subfolder: '..\\..' })
  periksa('subfolder ".." ditolak', 'error' in keluar, 'error' in keluar ? '' : 'JUSTRU DIJALANKAN')

  // ── 5. Batas waktu benar-benar menghentikan proses ───────────────────────
  console.log('\n5. batas waktu')
  writeFileSync(join(ruang, 'gantung.js'), 'setInterval(() => {}, 1000)\n', 'utf-8')
  const t0 = Date.now()
  const gantung = await jalankan({ perintah: 'node gantung.js', timeoutDetik: 2 })
  const lama = Date.now() - t0
  if ('error' in gantung) {
    periksa('proses menggantung dihentikan', false, gantung.error)
  } else {
    periksa('berhenti dalam < 10 detik', lama < 10_000, `${lama} ms`)
    periksa('ujiSukses false', gantung.ujiSukses === false)
    periksa(
      'catatan menyatakan belum membuktikan apa pun',
      /belum .*membuktikan/i.test(gantung.catatanHasil),
      gantung.catatanHasil.slice(0, 60)
    )
  }

  // ── 6. Runner yang tidak terpasang dilaporkan, bukan didiamkan ───────────
  console.log('\n6. runner yang mungkin tidak terpasang (informasional)')
  catatIzinJaringan(SESI) // lewati gerbang persetujuan untuk pemeriksaan ini
  for (const runner of ['npm', 'npx', 'pnpm']) {
    const hasil = await jalankan({ perintah: `${runner} --version`, timeoutDetik: 30 })
    if ('error' in hasil) {
      console.log(`  ????  ${runner}: ditolak — ${hasil.error}`)
      continue
    }
    const hilang = /UJI TIDAK BERJALAN/.test(hasil.catatanHasil)
    console.log(
      `  ${hilang ? 'n/a ' : 'ada '}  ${runner}: ${hilang ? 'TIDAK terpasang — dan itu dinyatakan' : hasil.stdout.trim()}`
    )
    if (hilang) {
      periksa(
        `${runner} tidak terpasang dinyatakan sebagai uji TIDAK berjalan`,
        /jangan mengaku sudah mengujinya/i.test(hasil.catatanHasil)
      )
    }
  }

  // Bersih-bersih, kecuali diminta disimpan untuk dilihat.
  if (process.env.AIRA_COBA_UJI_SIMPAN === '1') {
    console.log(`\nruang uji disimpan: ${ruang}`)
  } else {
    hapusRuangUji(SESI)
    try {
      readFileSync(sasaran)
      require('fs').unlinkSync(sasaran)
    } catch {
      /* sudah tidak ada */
    }
  }

  if (masalah.length) {
    console.error('\nGAGAL:')
    for (const m of masalah) console.error(`  - ${m}`)
    app.exit(1)
    return
  }
  console.log('\nsemua pemeriksaan lolos.')
  app.exit(0)
}

main().catch((err) => {
  console.error('coba-uji gagal:', err)
  app.exit(1)
})
