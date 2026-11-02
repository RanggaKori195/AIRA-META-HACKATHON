import { app, nativeImage } from 'electron'
import { copyFileSync, mkdirSync, statSync } from 'fs'
import { basename, extname, join } from 'path'
import { randomUUID } from 'crypto'
import type { Attachment } from '../shared/ipc'
import { loadConfig } from './config'
import { ruangUjiRoot } from './uji/ruang'
import { folderUnduhanOneDrive } from './m365/unduhan'

// Lampiran disalin ke folder khusus milik aplikasi, BUKAN dengan memberi agent
// akses ke folder asal file. Jadi melampirkan satu file tidak membuka seisi folder.

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])
const MAX_FILE_BYTES = 25 * 1024 * 1024
const MAX_IMAGE_DIM = 1600

export function attachmentsDir(): string {
  const dir = join(app.getPath('userData'), 'attachments')
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Folder yang boleh disentuh tools = folder akses user + folder lampiran +
 * ruang uji + folder unduhan OneDrive.
 *
 * Ruang uji ikut supaya write_file/read_file/edit_file bisa menyiapkan berkas
 * di sana tanpa tool baru. Folder ini milik APLIKASI, bukan milik user, jadi
 * menambahkannya tidak memperluas akses ke data siapa pun.
 *
 * ⚠️ Folder unduhan OneDrive ikut (13 Okt 2026): tanpa itu `read_excel` dkk.
 * menolak berkas yang BARU SAJA diunduh `onedrive_ambil`, model meminta izin
 * folder, dan izin itu menjadikannya folder akses biasa — yang kemudian ikut
 * diindeks auto-index (aturan 44 dilanggar diam-diam). Di sini ia hanya
 * menjadi batas baca tool, TIDAK masuk `config.allowedDirs`, jadi tidak diindeks.
 */
export function effectiveAllowedDirs(): string[] {
  return [...loadConfig().allowedDirs, attachmentsDir(), ruangUjiRoot(), folderUnduhanOneDrive()]
}

export function isImage(filePath: string): boolean {
  return IMAGE_EXT.has(extname(filePath).toLowerCase())
}

export function stageFile(sourcePath: string): Attachment {
  const stats = statSync(sourcePath)
  if (!stats.isFile()) throw new Error('bukan file')
  if (stats.size > MAX_FILE_BYTES) throw new Error('ukuran file melebihi 25 MB')
  const id = randomUUID()
  const safeName = basename(sourcePath).replace(/[^\w.\-() ]/g, '_')
  const dir = join(attachmentsDir(), id)
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, safeName)
  copyFileSync(sourcePath, dest)
  return {
    id,
    name: safeName,
    path: dest,
    kind: isImage(sourcePath) ? 'image' : 'document',
    size: stats.size
  }
}

/** Gambar dikecilkan dulu supaya konsumsi token wajar sebelum dikirim ke model. */
export function imageDataUrl(filePath: string): string {
  let image = nativeImage.createFromPath(filePath)
  if (image.isEmpty()) throw new Error('gambar tidak bisa dibaca')
  const size = image.getSize()
  if (Math.max(size.width, size.height) > MAX_IMAGE_DIM) {
    image =
      size.width >= size.height
        ? image.resize({ width: MAX_IMAGE_DIM })
        : image.resize({ height: MAX_IMAGE_DIM })
  }
  return `data:image/jpeg;base64,${image.toJPEG(85).toString('base64')}`
}
