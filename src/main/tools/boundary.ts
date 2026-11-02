import { existsSync, realpathSync } from 'fs'
import * as path from 'path'

// Batas akses filesystem untuk agent. Semua path yang dipakai tool WAJIB lewat
// resolveInBoundary — mencegah path traversal (..\..) dan escape via symlink/junction.

export class BoundaryError extends Error {}

const WINDOWS = process.platform === 'win32'

function normalizeForCompare(p: string): string {
  const normalized = path.normalize(p)
  return WINDOWS ? normalized.toLowerCase() : normalized
}

/** Ancestor terdalam yang sudah ada di disk (untuk resolusi symlink pada target baru). */
function deepestExistingAncestor(p: string): string {
  let current = p
  while (!existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) return current
    current = parent
  }
  return current
}

export function resolveInBoundary(rawPath: string, allowedDirs: string[]): string {
  if (allowedDirs.length === 0) {
    throw new BoundaryError(
      'Belum ada folder akses. Panggil tool request_folder_access dengan path folder yang dibutuhkan — user akan menyetujuinya lewat UI.'
    )
  }
  const resolved = path.resolve(rawPath)

  // Resolusi symlink pada bagian path yang sudah ada, supaya link keluar boundary terdeteksi.
  const existingPart = deepestExistingAncestor(resolved)
  let realExisting: string
  try {
    realExisting = realpathSync.native(existingPart)
  } catch {
    realExisting = existingPart
  }
  const realResolved = path.join(realExisting, path.relative(existingPart, resolved))

  for (const dir of allowedDirs) {
    let realDir: string
    try {
      realDir = realpathSync.native(dir)
    } catch {
      continue
    }
    const prefix = normalizeForCompare(realDir)
    const candidate = normalizeForCompare(realResolved)
    if (candidate === prefix || candidate.startsWith(prefix + path.sep)) {
      return realResolved
    }
  }
  throw new BoundaryError(
    `Path "${rawPath}" berada di luar folder akses yang diizinkan (${allowedDirs.join(', ')}). ` +
      'Panggil request_folder_access untuk meminta izin user.'
  )
}
