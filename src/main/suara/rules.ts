// Aturan murni untuk transkripsi suara (voice input). Tidak menyentuh disk,
// tidak menjalankan proses — supaya seluruhnya bisa diuji tanpa `whisper-cli.exe`
// maupun runtime Electron.
//
// Latar: HANDOFF §10 no. 8. Voice MASUK saja — AIRA tetap menjawab teks.
// Jalur yang dipilih `whisper.cpp` lewat `whisper-cli.exe` sebagai proses
// terpisah, jadi TANPA native module (tidak menyentuh risiko bytenode §5b).

import { join } from 'path'

/** Whisper meminta audio 16 kHz mono. Nilai ini dipakai perekam DAN pemeriksa. */
export const SAMPLE_RATE = 16_000

/**
 * Batas panjang rekaman.
 *
 * ⚠️ Bukan angka hiasan. Transkripsi berjalan di CPU laptop user: terukur di
 * laptop pengembangan (Ryzen 7 5700U) kalimat 5 detik ≈ 2–4 detik. Rekaman 5
 * menit berarti menunggu menit-menitan sambil aplikasi terlihat menggantung.
 * Voice input di sini untuk PERTANYAAN, bukan dikte dokumen.
 */
export const MAKS_DETIK = 60

/** Batas waktu proses whisper. Selalu lebih longgar dari MAKS_DETIK. */
export const TIMEOUT_MS = 120_000

/**
 * Bahasa dipatok `id`.
 *
 * ⚠️ JANGAN dibiarkan auto-detect. Kalimat pendek berisi istilah Inggris
 * ("berapa nett sales bulan ini") gampang terdeteksi sebagai bahasa Inggris,
 * dan begitu salah bahasa seluruh kalimat ikut kacau — bukan cuma satu kata.
 */
export const BAHASA = 'id'

export type LetakWhisper = { exe: string; model: string }

/**
 * Tempat `whisper-cli.exe` dan model mungkin berada.
 *
 * ⚠️ Banyak jangkar dengan sengaja — pola yang sama persis dengan `fonts.ts`
 * (§20), templat PPT (§24), dan tree-sitter (§47). `app.getAppPath()`
 * mengembalikan hal berbeda tergantung cara proses dijalankan, dan kegagalan
 * jenis ini SUNYI: di dev jalan normal, di aplikasi terpasang mati — baru
 * ketahuan SESUDAH dibagikan ke orang.
 */
export function kandidatDirWhisper(appPath: string, resourcesPath: string, dirname: string): string[] {
  const jangkar = [appPath, join(appPath, '..'), process.cwd(), join(dirname, '..', '..', '..')]
  const dir: string[] = []
  if (resourcesPath) dir.push(join(resourcesPath, 'whisper'))
  for (const j of jangkar) {
    if (!j) continue
    dir.push(join(j, 'resources', 'whisper'))
  }
  return [...new Set(dir)]
}

/** Nama berkas yang dicari di dalam folder whisper. */
export const NAMA_EXE = 'whisper-cli.exe'
export const NAMA_MODEL = 'ggml-small-q5_1.bin'

/**
 * Argumen `whisper-cli.exe`.
 *
 * `-nt` mematikan cap waktu supaya keluarannya teks polos; `-np` mematikan
 * cetakan kemajuan yang akan mengotori stdout. Keduanya membuat penguraian
 * hasil sederhana dan tidak perlu menebak format.
 */
export function argumenWhisper(model: string, wav: string, benang: number): string[] {
  return [
    '-m', model,
    '-f', wav,
    '-l', BAHASA,
    '-t', String(Math.max(1, Math.min(8, benang))),
    '-nt',
    '-np'
  ]
}

/**
 * Membersihkan keluaran whisper jadi satu kalimat.
 *
 * Menangani DUA bentuk dengan sengaja: teks polos (karena `-nt`) dan bentuk
 * bercap waktu `[00:00:00.000 --> 00:00:03.000]  teks`. Bentuk kedua tidak
 * seharusnya muncul, tapi menguraikannya defensif jauh lebih murah daripada
 * menaruh cap waktu ke kotak chat user bila kelak flag-nya berubah.
 */
export function bacaTranskrip(stdout: string): string {
  return stdout
    .split(/\r?\n/)
    .map((b) => b.replace(/^\s*\[[\d:.]+\s*-->\s*[\d:.]+\]\s*/, '').trim())
    /*
     * Membuang baris yang SELURUHNYA satu token di dalam kurung.
     *
     * ⚠️ Ini bukan kehati-hatian teoretis — terukur 6 Sep 2026 saat menguji
     * binary sungguhan: diberi NADA MURNI 220 Hz (jelas bukan ucapan),
     * whisper mengembalikan `[singgung]`. Daftar-larangan berisi
     * `[BLANK_AUDIO]`/`(Music)` tidak menjaringnya, jadi kata karangan itu
     * akan mendarat di kotak chat sebagai kalimat user.
     *
     * Karena itu bentuknya yang ditolak, bukan daftar kata: whisper memakai
     * kurung untuk anotasi non-ucapan, dan ucapan sungguhan tidak pernah
     * seluruhnya terbungkus kurung. Pola daftar-IZIN yang sama dengan
     * `KOLOM_AMAN` (§35) — yang tak dikenal ditolak, bukan diloloskan.
     */
    .filter((b) => b && !/^[[(][^\][()]*[\])][.,!?]?$/.test(b))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export type PeriksaWav =
  | { ok: true; detik: number; sampleRate: number; kanal: number }
  | { ok: false; alasan: string }

/**
 * Memeriksa bahwa yang dikirim renderer benar-benar WAV PCM 16 kHz mono.
 *
 * ⚠️ Diperiksa di MAIN, bukan hanya di renderer. Renderer boleh salah kirim,
 * dan `whisper-cli` yang diberi berkas cacat tidak mengeluh dengan jelas — ia
 * menghasilkan transkrip kosong atau ngawur, yang di layar terlihat seperti
 * "Whisper-nya jelek" padahal audionya yang salah bentuk.
 */
export function periksaWav(buf: Uint8Array): PeriksaWav {
  if (buf.length < 44) return { ok: false, alasan: 'berkas audio terlalu pendek (header WAV tidak utuh)' }
  const teks = (o: number, n: number): string => String.fromCharCode(...buf.slice(o, o + n))
  if (teks(0, 4) !== 'RIFF' || teks(8, 4) !== 'WAVE') {
    return { ok: false, alasan: 'bukan berkas WAV (header RIFF/WAVE tidak ditemukan)' }
  }
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const kanal = dv.getUint16(22, true)
  const sampleRate = dv.getUint32(24, true)
  const bit = dv.getUint16(34, true)
  if (kanal !== 1) return { ok: false, alasan: `audio harus mono, terbaca ${kanal} kanal` }
  if (sampleRate !== SAMPLE_RATE) {
    return { ok: false, alasan: `audio harus ${SAMPLE_RATE} Hz, terbaca ${sampleRate} Hz` }
  }
  if (bit !== 16) return { ok: false, alasan: `audio harus 16-bit, terbaca ${bit}-bit` }
  const detik = (buf.length - 44) / (sampleRate * 2)
  if (detik <= 0.2) return { ok: false, alasan: 'rekaman terlalu pendek — tidak ada yang terdengar' }
  if (detik > MAKS_DETIK + 5) {
    return { ok: false, alasan: `rekaman ${detik.toFixed(0)} detik melebihi batas ${MAKS_DETIK} detik` }
  }
  return { ok: true, detik, sampleRate, kanal }
}

/**
 * Kalimat yang menyertai hasil transkripsi.
 *
 * ⚠️ TIDAK PERNAH kosong — pelajaran `read_pdf`/`read_word` (§ "hasil tool
 * jangan pernah diam soal kelengkapannya"). Di sini fungsinya berbeda tapi
 * satu nyawa: user WAJIB tahu bahwa yang muncul di kotak chat adalah hasil
 * dengar mesin yang belum dikoreksi, bukan kalimat yang sudah pasti benar.
 */
export function catatanTranskrip(teks: string): string {
  if (!teks) {
    return 'Tidak ada kata yang terdengar. Coba bicara lebih dekat ke mikrofon.'
  }
  return 'Hasil suara belum dikoreksi — pastikan sudah benar sebelum mengirim.'
}

// Penjelasan panjangnya (tooltip) ada di `src/shared/dikte.ts` — renderer
// tidak boleh mengimpor dari `main`.
