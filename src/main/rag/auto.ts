import { RAG_DISABLED } from '../hackathon/flags'
import { loadConfig } from '../config'
import { folderCache, salinFolder, siapDiindeks } from '../m365/index-drive'
import { buildProvider } from '../llm/factory'
import { indexFolder, lupakanFolder, type IndexReport } from './indexer'
import { pisahkanFolderIndeks } from './folder-rules'
import { folderUnduhanOneDrive } from '../m365/unduhan'
import { audit } from '../db'
import { logger } from '../logger'

// Auto-indexing ala editor AI: user tidak pernah menyuruh "index".
// Dipicu saat: app start, folder akses di-grant, dan sebelum search (refresh).
// Satu run pada satu waktu; pemicu saat run aktif ikut menunggu run yang sama.

const EMPTY: IndexReport = {
  indexed: 0, unchanged: 0, failed: 0, removed: 0, totalChunks: 0, dilewati: []
}

let current: Promise<IndexReport> | null = null

async function runIndexAll(): Promise<IndexReport> {
  if (!buildProvider()) return EMPTY // belum setup — diam saja
  const total: IndexReport = { ...EMPTY, dilewati: [] }

  // Folder OneDrive disalin dulu ke cache lokal, lalu diindeks seperti folder
  // biasa. Berkas yang HILANG dari OneDrive (dihapus, dipindah, atau share-nya
  // dicabut) ikut terhapus dari cache, sehingga pembersihan entri basi di
  // `indexFolder` membuang potongannya dari indeks — tanpa itu, kutipan dari
  // dokumen yang aksesnya sudah dicabut masih bisa muncul berbulan-bulan.
  const folderDrive = loadConfig().onedriveFolders
  if (folderDrive.length > 0 && siapDiindeks()) {
    for (const folder of folderDrive) {
      try {
        const salin = await salinFolder(folder)
        // Berkas yang dilewati saat MENYALIN wajib ikut dilaporkan bersama yang
        // dilewati saat mengindeks — kalau tidak, ia hilang di antara dua tahap.
        total.dilewati.push(
          ...salin.dilewati.map((d) => ({ file: `OneDrive:${d.berkas}`, alasan: d.alasan }))
        )
        if (salin.masihAdaSisa) {
          logger().info({ folder }, 'masih ada berkas OneDrive yang belum tersalin — menyusul di jalan berikutnya')
        }
      } catch (err) {
        logger().warn({ folder, err: String(err) }, 'penyalinan folder OneDrive gagal')
      }
    }
  }

  // ⚠️ Folder unduhan `onedrive_ambil` TIDAK PERNAH diindeks, walau user pernah
  // mengizinkannya sebagai folder akses (terjadi 13 Okt 2026 sebelum folder itu
  // masuk `effectiveAllowedDirs`). Mengindeks OneDrive adalah pilihan sadar lewat
  // `onedrive_index` (aturan 44); potongan yang terlanjur masuk ikut dibuang.
  const unduhan = folderUnduhanOneDrive()
  const pilah = pisahkanFolderIndeks(loadConfig().allowedDirs, [unduhan])
  const terbuang = lupakanFolder(unduhan)
  if (pilah.dikecualikan.length > 0 || terbuang > 0) {
    logger().info(
      { dikecualikan: pilah.dikecualikan, berkasDibuangDariIndeks: terbuang },
      'folder unduhan OneDrive tidak diindeks (aturan 44)'
    )
    total.removed += terbuang
  }
  const daftarFolder = [
    ...pilah.indeks,
    ...(folderDrive.length > 0 ? [folderCache()] : [])
  ]
  for (const dir of daftarFolder) {
    try {
      const report = await indexFolder(dir)
      total.indexed += report.indexed
      total.unchanged += report.unchanged
      total.failed += report.failed
      total.removed += report.removed
      total.totalChunks += report.totalChunks
      total.dilewati.push(...report.dilewati)
    } catch (err) {
      logger().warn({ dir, err: String(err) }, 'auto-index folder failed')
    }
  }
  // File yang dilewati SELALU dilaporkan, walau tidak ada yang berhasil diindeks.
  // Dulu ringkasan hanya dicatat bila ada yang berhasil, sehingga folder yang seluruh
  // isinya dilewati tidak meninggalkan jejak apa pun — dokumen user diam-diam tidak
  // pernah masuk pengetahuan AIRA (terjadi nyata pada PDF 22,8 MB, 19 Agu 2026).
  if (total.dilewati.length > 0) {
    logger().warn(
      { jumlah: total.dilewati.length, dilewati: total.dilewati.slice(0, 10) },
      'ada dokumen yang TIDAK masuk pengetahuan AIRA'
    )
  }
  if (total.indexed > 0 || total.removed > 0 || total.dilewati.length > 0) {
    audit('rag', 'auto_index', JSON.stringify(total))
    logger().info(
      { ...total, dilewati: total.dilewati.length },
      'auto-index completed'
    )
  }
  return total
}

/** Jalankan (atau gabung ke) proses indexing semua folder akses. */
export function indexAllAllowed(): Promise<IndexReport> {
  if (!current) {
    current = runIndexAll().finally(() => {
      current = null
    })
  }
  return current
}

/** Fire-and-forget untuk pemicu background. */
export function triggerAutoIndex(reason: string): void {
  if (RAG_DISABLED) return
  void indexAllAllowed().then((report) => {
    if (report.indexed > 0) logger().info({ reason }, 'background index refreshed')
  })
}
