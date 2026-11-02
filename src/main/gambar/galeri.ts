import { app, dialog, nativeImage, shell, BrowserWindow } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { randomUUID } from 'crypto'
import * as db from '../db'
import { logger } from '../logger'
import { catatAktivitas } from '../monitoring/service'
import type { SesiUser } from '../auth/service'
import type { ItemGaleri } from '../../shared/ipc'
import { buatGambar, siapkanUnggahan, ubahGambar } from './omni'
import { GambarError, pastikanJumlah, pastikanPrompt, pastikanUkuran } from './rules'

/*
 * Galeri gambar — layar "Gambar" di sidebar (27 Sep 2026, permintaan user:
 * "seperti Images di Codex").
 *
 * Satu tempat untuk semua gambar milik seseorang: yang dibuat langsung dari
 * layar Gambar maupun yang dibuat AIRA di tengah chat (`buat_gambar`).
 *
 * ⚠️ MILIK ORANG, BUKAN LAPTOP (aturan 16). Setiap fungsi di sini menerima
 * `sesi` dari main process dan kepemilikan diperiksa di klausa WHERE
 * (`galeriMilik`, `hapusGaleri`). Renderer hanya mengirim id.
 *
 * ⚠️ Pembuatan dari layar ini TIDAK lewat model chat — langsung ke old-image-model.
 * Karena itu ia dicatat SENDIRI ke monitoring pemakaian (aturan 65); tanpa itu
 * pemakaian gambar tidak pernah terlihat di panel Super Admin.
 */

/** Sisi terpanjang thumbnail. Grid menampilkan ±240 px; 2× untuk layar HiDPI. */
const SISI_THUMB = 480
const HALAMAN = 40

function amanNamaUser(username: string): string {
  return username.toLowerCase().replace(/[^\w.-]/g, '_').slice(0, 64) || 'tanpa-nama'
}

export function folderGaleri(username: string): string {
  const dir = join(app.getPath('userData'), 'galeri', amanNamaUser(username))
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Thumbnail kecil untuk grid.
 *
 * ⚠️ Grid TIDAK memuat gambar asli: 40 gambar × 1–4 MB sebagai data URL membuat
 * layar terasa beku saat dibuka. Thumbnail ±50–150 KB. Gagal membuat thumbnail
 * tidak menggagalkan apa pun — grid memakai gambar aslinya.
 */
function buatThumb(png: Buffer, tujuan: string): string | null {
  try {
    const img = nativeImage.createFromBuffer(png)
    const uk = img.getSize()
    if (uk.width === 0) return null
    const skala = Math.min(1, SISI_THUMB / Math.max(uk.width, uk.height))
    const kecil =
      skala < 1
        ? img.resize({
            width: Math.round(uk.width * skala),
            height: Math.round(uk.height * skala),
            quality: 'good'
          })
        : img
    writeFileSync(tujuan, kecil.toPNG())
    return tujuan
  } catch (err) {
    logger().warn({ err: String(err).slice(0, 160) }, 'thumbnail galeri gagal dibuat')
    return null
  }
}

function dataUrl(file: string | null): string | null {
  if (!file || !existsSync(file)) return null
  return `data:image/png;base64,${readFileSync(file).toString('base64')}`
}

function keItem(b: db.BarisGaleri): ItemGaleri {
  const ada = existsSync(b.path)
  return {
    id: b.id,
    prompt: b.prompt,
    ukuran: b.ukuran,
    sumber: b.sumber,
    asalId: b.asalId,
    dibuat: b.dibuat,
    path: b.path,
    // Berkas yang sudah dihapus/dipindah user di luar AIRA ditandai, BUKAN
    // disembunyikan: galeri yang diam-diam menyusut terlihat seperti AIRA yang
    // kehilangan data.
    hilang: !ada,
    thumb: ada ? (dataUrl(b.thumb) ?? dataUrl(b.path)) : null
  }
}

function simpanBaru(
  sesi: SesiUser,
  png: Buffer,
  info: { prompt: string; ukuran: string; sumber: 'halaman' | 'chat' | 'unggah'; asalId?: string | null }
): db.BarisGaleri {
  const id = randomUUID()
  const dir = folderGaleri(sesi.username)
  const path = join(dir, `${id}.png`)
  writeFileSync(path, png)
  const baris: db.BarisGaleri = {
    id,
    username: sesi.username,
    path,
    thumb: buatThumb(png, join(dir, `${id}.thumb.png`)),
    prompt: info.prompt,
    ukuran: info.ukuran,
    sumber: info.sumber,
    asalId: info.asalId ?? null,
    sessionId: null,
    dibuat: Date.now()
  }
  db.simpanGaleri(baris)
  return baris
}

function catatPemakaian(
  sesi: SesiUser,
  mulai: number,
  prompt: string,
  tool: 'buat_gambar' | 'ubah_gambar',
  jumlah: number,
  kodeGalat: string | null
): void {
  catatAktivitas({
    sesi,
    mulai,
    mode: 'general',
    model: 'old-image-model',
    // Bukan sesi chat — ditandai supaya di panel monitoring terbaca asalnya.
    sesiId: 'layar-gambar',
    teks: prompt,
    lampiran: [],
    activities: Array.from({ length: Math.max(1, jumlah) }, (_, i) => ({
      callId: `galeri-${mulai}-${i}`,
      name: tool,
      label: 'Layar Gambar',
      argsSummary: '',
      tier: 'write' as const,
      status: kodeGalat ? ('error' as const) : ('ok' as const)
    })),
    kodeGalat
  })
}

export async function buatDiGaleri(
  sesi: SesiUser,
  input: { prompt: unknown; ukuran: unknown; jumlah: unknown }
): Promise<ItemGaleri[]> {
  const prompt = pastikanPrompt(input.prompt)
  const ukuran = pastikanUkuran(input.ukuran)
  const jumlah = pastikanJumlah(input.jumlah)
  const mulai = Date.now()
  try {
    const png = await buatGambar({ prompt, ukuran, jumlah })
    const hasil = png.map((b) => keItem(simpanBaru(sesi, b, { prompt, ukuran, sumber: 'halaman' })))
    catatPemakaian(sesi, mulai, prompt, 'buat_gambar', hasil.length, null)
    db.audit('galeri', 'buat', `oleh=${sesi.username} jumlah=${hasil.length} ukuran=${ukuran}`)
    return hasil
  } catch (err) {
    catatPemakaian(sesi, mulai, prompt, 'buat_gambar', jumlah, 'GAMBAR_GAGAL')
    throw err
  }
}

export async function ubahDiGaleri(
  sesi: SesiUser,
  input: { id: string; prompt: unknown }
): Promise<ItemGaleri> {
  const asal = db.galeriMilik(input.id, sesi.username)
  if (!asal) throw new GambarError('Gambar tidak ditemukan.')
  if (!existsSync(asal.path)) {
    throw new GambarError('Berkas gambar asalnya sudah tidak ada di komputer ini.')
  }
  const prompt = pastikanPrompt(input.prompt)
  const ukuran = pastikanUkuran(asal.ukuran)
  const mulai = Date.now()
  try {
    const [png] = await ubahGambar({ asal: asal.path, prompt, ukuran })
    const baru = simpanBaru(sesi, png, { prompt, ukuran, sumber: 'halaman', asalId: asal.id })
    catatPemakaian(sesi, mulai, prompt, 'ubah_gambar', 1, null)
    db.audit('galeri', 'ubah', `oleh=${sesi.username} asal=${asal.id}`)
    return keItem(baru)
  } catch (err) {
    catatPemakaian(sesi, mulai, prompt, 'ubah_gambar', 1, 'GAMBAR_GAGAL')
    throw err
  }
}

/** User yang riwayat chat-nya sudah diimpor pada jalannya aplikasi ini. */
const sudahImpor = new Set<string>()

/**
 * Sekali per user per jalannya aplikasi: gambar dari chat lama yang belum ada
 * di galeri dimasukkan. Keterangannya judul percakapan — prompt aslinya tidak
 * tersimpan di riwayat, dan menebaknya berarti mengarang.
 */
function imporDariRiwayat(username: string): void {
  const kunci = username.toLowerCase()
  if (sudahImpor.has(kunci)) return
  sudahImpor.add(kunci)
  try {
    const dir = folderGaleri(username)
    let n = 0
    for (const g of db.gambarDiRiwayat(username)) {
      if (!existsSync(g.path) || db.pathDiGaleri(g.path, username)) continue
      const id = randomUUID()
      db.simpanGaleri({
        id,
        username,
        path: g.path,
        thumb: buatThumb(readFileSync(g.path), join(dir, `${id}.thumb.png`)),
        prompt: g.judul || '(dari percakapan)',
        ukuran: '-',
        sumber: 'chat',
        asalId: null,
        sessionId: g.sessionId,
        dibuat: g.dibuat
      })
      n++
    }
    if (n > 0) logger().info({ n }, 'gambar dari riwayat chat dimasukkan ke galeri')
  } catch (err) {
    logger().warn({ err: String(err).slice(0, 160) }, 'impor galeri dari riwayat gagal')
  }
}

export function daftarDiGaleri(
  sesi: SesiUser,
  opsi: { sebelum: number | null; cari: string | null }
): { item: ItemGaleri[]; adaLagi: boolean } {
  imporDariRiwayat(sesi.username)
  const baris = db.daftarGaleri(sesi.username, { ...opsi, limit: HALAMAN + 1 })
  return { item: baris.slice(0, HALAMAN).map(keItem), adaLagi: baris.length > HALAMAN }
}

/**
 * Thumbnail satu gambar — hanya milik user ini (menu Pustaka). Sengaja TIDAK
 * jatuh ke gambar penuh bila thumbnail tidak ada: 4 MB per kartu membekukan layar.
 */
export function thumbMilik(sesi: SesiUser, id: string): string | null {
  const b = db.galeriMilik(id, sesi.username)
  return b ? dataUrl(b.thumb) : null
}

/** Gambar ukuran penuh untuk tampilan besar — hanya milik user ini. */
export function gambarPenuh(sesi: SesiUser, id: string): string | null {
  const b = db.galeriMilik(id, sesi.username)
  return b ? dataUrl(b.path) : null
}

/**
 * Menghapus dari galeri. Berkas yang AIRA simpan sendiri (folder galeri) masuk
 * RECYCLE BIN, bukan dihapus permanen — janji SOUL.md "selalu ada jalan
 * pulang". Berkas hasil chat yang tinggal di folder kerja user TIDAK disentuh:
 * yang dihapus hanya catatannya di galeri, karena berkas itu bisa saja sudah
 * dipakai di dokumen lain.
 */
export async function hapusDiGaleri(sesi: SesiUser, id: string): Promise<boolean> {
  const b = db.galeriMilik(id, sesi.username)
  if (!b) return false
  const milikGaleri = b.path.toLowerCase().startsWith(folderGaleri(sesi.username).toLowerCase())
  if (milikGaleri) {
    for (const f of [b.path, b.thumb]) {
      if (f && existsSync(f)) {
        await shell.trashItem(f).catch((err) =>
          logger().warn({ f, err: String(err).slice(0, 120) }, 'gagal memindah ke Recycle Bin')
        )
      }
    }
  }
  const ok = db.hapusGaleri(id, sesi.username)
  db.audit('galeri', 'hapus', `oleh=${sesi.username} id=${id} berkas=${milikGaleri ? 'recycle-bin' : 'dibiarkan'}`)
  return ok
}

/**
 * "Unggah gambar untuk diubah" dari layar Gambar (29 Sep 2026, permintaan user).
 *
 * ⚠️ Dialog pilih berkas dibuka DI MAIN PROCESS, dan renderer tidak pernah
 * mengirim path. Channel yang menerima path dari renderer lalu membacanya adalah
 * cara membaca berkas apa pun di komputer dari layar — pola yang sama dengan
 * daftar-izin pratinjau (§69). Karena itu seret-lepas sengaja TIDAK dipakai.
 *
 * ⚠️ Yang disimpan SALINAN (PNG) di folder galeri user; berkas aslinya tidak
 * pernah disentuh. Menghapus unggahan dari galeri hanya membuang salinannya.
 * JPG diubah ke PNG di sini karena `images/edits` hanya menerima PNG (§68);
 * magic byte hasilnya tetap diperiksa di `ubahGambar`.
 */
export async function unggahUntukUbah(sesi: SesiUser): Promise<ItemGaleri | null> {
  const jendela = BrowserWindow.getFocusedWindow()
  const opsi = {
    title: 'Pilih gambar untuk diubah AIRA',
    properties: ['openFile' as const],
    filters: [{ name: 'Gambar (PNG, JPG)', extensions: ['png', 'jpg', 'jpeg'] }]
  }
  const hasil = jendela ? await dialog.showOpenDialog(jendela, opsi) : await dialog.showOpenDialog(opsi)
  const asal = hasil.filePaths[0]
  if (hasil.canceled || !asal) return null

  const { png, ukuran, lebar, tinggi } = siapkanUnggahan(asal)
  const baru = simpanBaru(sesi, png, { prompt: `Gambar unggahan: ${basename(asal)}`, ukuran, sumber: 'unggah' })
  db.audit('galeri', 'unggah', `oleh=${sesi.username} id=${baru.id} ${lebar}x${tinggi} -> ${ukuran}`)
  logger().info({ id: baru.id, lebar, tinggi, ukuran }, 'gambar diunggah untuk diubah')
  return keItem(baru)
}

/** "Unduh": salin ke lokasi yang dipilih user lewat dialog simpan. */
export async function simpanSebagai(sesi: SesiUser, id: string): Promise<string | null> {
  const b = db.galeriMilik(id, sesi.username)
  if (!b || !existsSync(b.path)) return null
  const namaAwal =
    b.prompt
      .slice(0, 40)
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase() || 'gambar-aira'
  const jendela = BrowserWindow.getFocusedWindow()
  const opsi = {
    defaultPath: join(app.getPath('pictures'), `${namaAwal}.png`),
    // Hanya PNG — gateway selalu mengembalikan PNG, dan nama berkas yang
    // berbohong soal isinya ditolak di jalur lain juga (§24c).
    filters: [{ name: 'Gambar PNG', extensions: ['png'] }]
  }
  const hasil = jendela ? await dialog.showSaveDialog(jendela, opsi) : await dialog.showSaveDialog(opsi)
  if (hasil.canceled || !hasil.filePath) return null
  const tujuan = hasil.filePath.toLowerCase().endsWith('.png') ? hasil.filePath : `${hasil.filePath}.png`
  copyFileSync(b.path, tujuan)
  return tujuan
}

/**
 * Mencatat gambar yang dibuat AIRA di CHAT ke galeri, supaya layar Gambar jadi
 * satu tempat untuk semuanya. Dipanggil orchestrator sesudah `buat_gambar` /
 * `ubah_gambar` sukses. Berkasnya TIDAK disalin — galeri menunjuk ke lokasi
 * aslinya; yang dibuat hanya thumbnail.
 */
export function catatDariChat(
  username: string,
  sessionId: string,
  paths: readonly string[],
  prompt: string,
  ukuran: string
): void {
  try {
    const dir = folderGaleri(username)
    for (const path of paths) {
      if (!existsSync(path) || db.pathDiGaleri(path, username)) continue
      const id = randomUUID()
      db.simpanGaleri({
        id,
        username,
        path,
        thumb: buatThumb(readFileSync(path), join(dir, `${id}.thumb.png`)),
        prompt: prompt || '(tanpa keterangan)',
        ukuran,
        sumber: 'chat',
        asalId: null,
        sessionId,
        dibuat: Date.now()
      })
    }
  } catch (err) {
    // Gagal mencatat ke galeri tidak boleh menjatuhkan jawaban di chat.
    logger().warn({ err: String(err).slice(0, 160) }, 'gagal mencatat gambar chat ke galeri')
  }
}
