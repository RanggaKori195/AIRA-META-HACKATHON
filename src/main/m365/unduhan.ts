import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * Folder tempat `onedrive_ambil` menaruh berkas yang diunduh.
 *
 * SATU definisi untuk tiga pemakai: pengunduh (`drive.ts`), batas folder tool
 * (`effectiveAllowedDirs` — supaya `read_*` bisa langsung membacanya tanpa user
 * diminta mengizinkan folder), dan auto-index (yang WAJIB melewatinya, aturan 44).
 */
export function folderUnduhanOneDrive(): string {
  const dir = join(app.getPath('userData'), 'onedrive-cache')
  mkdirSync(dir, { recursive: true })
  return dir
}
