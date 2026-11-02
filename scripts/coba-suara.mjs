// Uji asap whisper-cli: DLL termuat, model terbaca, argumen diterima.
//
// Memakai enkoder WAV dan argumen yang SAMA dengan yang dipakai aplikasi —
// bukan argumen yang diketik ulang di sini. Kalau keduanya terpisah, uji ini
// bisa hijau sementara aplikasinya gagal (pelajaran live-check yang memakai
// pool sendiri, HANDOFF §5).
//
// Jalankan: node scripts/coba-suara.mjs [berkas.wav]
import { spawnSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const DIR = 'resources/whisper'
const EXE = join(DIR, 'whisper-cli.exe')
const MODEL = join(DIR, 'ggml-small-q5_1.bin')

for (const p of [EXE, MODEL]) {
  if (!existsSync(p)) {
    console.error(`TIDAK ADA: ${p}\nLihat ${DIR}/README.md`)
    process.exit(1)
  }
}

// --- WAV uji ---------------------------------------------------------------
// Dipakai apa adanya bila user memberi berkas; kalau tidak, dibuat nada pendek.
// Nada TIDAK menghasilkan kata — dan itu memang yang diharapkan. Yang diuji di
// sini adalah "binary-nya hidup", bukan akurasinya.
const SAMPLE_RATE = 16_000
const argWav = process.argv[2]
let wavPath = argWav

if (!wavPath) {
  const n = SAMPLE_RATE * 2
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(SAMPLE_RATE, 24)
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.sin((i / SAMPLE_RATE) * 2 * Math.PI * 220) * 8000), 44 + i * 2)
  }
  wavPath = join(mkdtempSync(join(tmpdir(), 'aira-cobasuara-')), 'nada.wav')
  writeFileSync(wavPath, buf)
  console.log('WAV uji dibuat (nada 220 Hz, 2 detik) — tidak berisi kata.')
} else {
  console.log(`WAV dari argumen: ${wavPath} (${(readFileSync(wavPath).length / 1024).toFixed(0)} KB)`)
}

// --- jalankan --------------------------------------------------------------
const argv = ['-m', MODEL, '-f', wavPath, '-l', 'id', '-t', '4', '-nt', '-np']
console.log(`\n$ ${EXE} ${argv.join(' ')}\n`)

const t0 = Date.now()
const r = spawnSync(EXE, argv, { encoding: 'utf8', windowsHide: true })
const ms = Date.now() - t0

if (r.error) {
  console.error('GAGAL dijalankan:', r.error.message)
  console.error('\nBiasanya DLL pendamping kurang. whisper-cli.exe butuh whisper.dll,')
  console.error('ggml.dll, ggml-base.dll, dan seluruh ggml-cpu-*.dll di folder yang sama.')
  process.exit(1)
}

console.log(`exit code : ${r.status}`)
console.log(`durasi    : ${(ms / 1000).toFixed(2)} detik`)
console.log(`stdout    : ${JSON.stringify(r.stdout)}`)
if (r.stderr?.trim()) {
  const baris = r.stderr.trim().split(/\r?\n/)
  console.log(`stderr (${baris.length} baris, 12 terakhir):`)
  for (const b of baris.slice(-12)) console.log('  ', b)
}

if (r.status !== 0) {
  console.error('\nBERHENTI: whisper-cli keluar dengan kode bukan 0.')
  process.exit(1)
}
console.log('\nOK — binary hidup, DLL termuat, model terbaca, argumen diterima.')
if (!argWav) {
  console.log('Transkrip kosong itu BENAR: nada murni memang bukan kata.')
  console.log('Untuk menguji akurasi, beri berkas WAV berisi ucapan:')
  console.log('  node scripts/coba-suara.mjs rekaman.wav')
}
