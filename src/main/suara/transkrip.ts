import { spawn } from 'child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { cpus, tmpdir } from 'os'
import { join } from 'path'
import { app } from 'electron'
import { logger } from '../logger'
import {
  argumenWhisper,
  bacaTranskrip,
  catatanTranskrip,
  kandidatDirWhisper,
  NAMA_EXE,
  NAMA_MODEL,
  periksaWav,
  TIMEOUT_MS,
  type LetakWhisper
} from './rules'

// Menjalankan `whisper-cli.exe` sebagai PROSES TERPISAH.
//
// ⚠️ Sengaja bukan native module / binding. Node-binding whisper akan menabrak
// pipeline bytenode + electron-builder — alasan yang sama yang menolak
// Whisper-GPU, Docker, sharp, canvas, dan resvg (§5b). Proses terpisah tidak
// menyentuh risiko itu sama sekali.

export type HasilTranskrip = {
  teks: string
  catatan: string
  ms: number
  detik: number
}

let letakCache: LetakWhisper | null | undefined

/**
 * Mencari `whisper-cli.exe` + model.
 *
 * Hasilnya di-cache termasuk hasil NEGATIF: kalau tidak ada, tidak ada gunanya
 * menyisir folder berulang kali setiap user menekan tombol mikrofon.
 */
export function cariWhisper(): LetakWhisper | null {
  if (letakCache !== undefined) return letakCache
  const appPath = (() => {
    try {
      return app.getAppPath()
    } catch {
      return ''
    }
  })()
  const kandidat = kandidatDirWhisper(appPath, process.resourcesPath ?? '', __dirname)
  for (const dir of kandidat) {
    const exe = join(dir, NAMA_EXE)
    const model = join(dir, NAMA_MODEL)
    if (existsSync(exe) && existsSync(model)) {
      logger().info({ dir }, 'whisper ditemukan')
      letakCache = { exe, model }
      return letakCache
    }
  }
  // ⚠️ Dicatat sebagai peringatan BERISI DAFTAR yang dicari. Tanpa itu,
  // "tombol mikrofon tidak berfungsi" jadi laporan tanpa petunjuk apa pun —
  // pola kegagalan yang sama dengan font company serif font yang hilang diam-diam.
  logger().warn({ dicari: kandidat }, 'whisper-cli / model tidak ditemukan — voice input dimatikan')
  letakCache = null
  return null
}

/** Apakah fitur suara tersedia di laptop ini. Dipakai renderer untuk menyembunyikan tombol. */
export function suaraTersedia(): boolean {
  return cariWhisper() !== null
}

export async function transkripsikan(wav: Uint8Array): Promise<HasilTranskrip> {
  const letak = cariWhisper()
  if (!letak) {
    throw new Error(
      'Fitur suara belum terpasang di aplikasi ini (whisper-cli.exe / model tidak ditemukan). ' +
        'Hubungi tim IT untuk memasang ulang AIRA versi yang menyertakannya.'
    )
  }

  const periksa = periksaWav(wav)
  if (!periksa.ok) throw new Error(periksa.alasan)

  // Folder sementara sendiri per panggilan, dibuang di `finally`. Nama acak
  // supaya dua jendela AIRA yang merekam bersamaan tidak saling menimpa.
  const dir = mkdtempSync(join(tmpdir(), 'aira-suara-'))
  const wavPath = join(dir, 'rekaman.wav')
  const t0 = Date.now()
  try {
    writeFileSync(wavPath, wav)
    // Sisakan inti untuk UI; whisper memakan seluruh CPU kalau dibiarkan.
    const benang = Math.max(1, Math.min(8, Math.floor((cpus().length || 4) / 2)))
    const stdout = await jalankan(letak.exe, argumenWhisper(letak.model, wavPath, benang))
    const teks = bacaTranskrip(stdout)
    const ms = Date.now() - t0
    // ⚠️ Durasi & kecepatan dicatat DI SINI, bukan ditampilkan ke user (permintaan
    // 6 Sep 2026). Angkanya tetap bisa diukur kapan pun dari log — yang hilang
    // hanya keberadaannya di layar, tempat ia cuma jadi bising.
    logger().info({ ms, detik: periksa.detik, panjang: teks.length }, 'transkripsi selesai')
    return { teks, catatan: catatanTranskrip(teks), ms, detik: periksa.detik }
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* berkas sementara yang tertinggal tidak sepadan dengan gagalnya transkripsi */
    }
  }
}

function jalankan(exe: string, argv: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, argv, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    let kenaTimeout = false
    const timer = setTimeout(() => {
      kenaTimeout = true
      child.kill()
    }, TIMEOUT_MS)

    child.stdout.on('data', (d) => (stdout += String(d)))
    child.stderr.on('data', (d) => (stderr += String(d)))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`whisper-cli gagal dijalankan: ${e.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (kenaTimeout) {
        reject(new Error(`Transkripsi melebihi ${TIMEOUT_MS / 1000} detik dan dihentikan.`))
        return
      }
      if (code !== 0) {
        // stderr whisper panjang; ambil ekornya saja supaya pesan di layar terbaca.
        const ekor = stderr.trim().split(/\r?\n/).slice(-3).join(' ').slice(0, 300)
        reject(new Error(`whisper-cli berhenti dengan kode ${code}${ekor ? `: ${ekor}` : ''}`))
        return
      }
      resolve(stdout)
    })
  })
}
