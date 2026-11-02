import { app } from 'electron'
import { MUSE, META_ENDPOINT, migrateRawModels } from './hackathon/models'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { z } from 'zod'

// Config non-sensitif saja. API key TIDAK PERNAH disimpan di sini — lihat secrets.ts.
const McpServerSchema = z.object({
  name: z.string().min(1).max(40),
  url: z.string().url(),
  // true = setiap pemanggilan tool server ini butuh persetujuan user
  requireApproval: z.boolean().default(false),
  enabled: z.boolean().default(true)
})

export type McpServerConfig = z.infer<typeof McpServerSchema>

export const ConfigSchema = z.object({
  endpoint: z.string().url().default(META_ENDPOINT),
  // modelId = model agent (utama). Model lain dipakai lewat routing per pesan.
  modelId: z.string().min(1).default(MUSE.agent),
  chatModelId: z.string().min(1).default(MUSE.quick),
  coderModelId: z.string().min(1).default(MUSE.agent),
  // Parser TIDAK mendukung tool calling — hanya untuk panggilan langsung (OCR).
  parserModelId: z.string().min(1).default(MUSE.vision),
  modelChoice: z.enum(['auto', 'chat', 'agent', 'coder']).default('auto'),
  embedModel: z.string().min(1).default('BAAI/bge-m3'),
  rerankModel: z.string().min(1).default('BAAI/bge-reranker-v2-m3'),
  // Folder yang boleh diakses agent (workspace). Kosong = agent tidak bisa menyentuh filesystem.
  allowedDirs: z.array(z.string()).default([]),
  /**
   * Folder OneDrive yang ikut diindeks RAG. Kosong = tidak ada.
   *
   * ⚠️ Sengaja daftar PILIHAN, bukan "seluruh drive". Tiap berkas berujung pada
   * panggilan embedding ke gateway the company yang dipakai bersama aplikasi lain, jadi
   * menyapu drive puluhan giga bukan keputusan yang boleh diambil diam-diam oleh
   * bawaan. User tetap bisa memilih folder utama bila memang menginginkannya —
   * yang penting itu jadi pilihan sadar.
   */
  onedriveFolders: z.array(z.string()).default([]),
  // External MCP server (header auth disimpan terenkripsi terpisah, bukan di sini)
  mcpServers: z.array(McpServerSchema).default([]),
  /**
   * Percakapan chat yang disenyapkan, per user: `{ "budi": ["andi"] }`.
   *
   * ⚠️ Disimpan per LAPTOP (config), bukan di database. Senyap adalah preferensi
   * orang di mejanya sendiri — dan menaruhnya di database berarti satu migrasi
   * lagi di server produksi untuk sesuatu yang tidak perlu ikut berpindah laptop.
   * Kalau kelak grup dibuat dan senyapnya perlu ikut orangnya, barulah dipindah.
   *
   * Dikunci per username karena satu laptop bisa dipakai bergantian — tanpa itu,
   * orang berikutnya mewarisi daftar senyap orang sebelumnya diam-diam (pola §16).
   */
  chatSenyap: z.record(z.string(), z.array(z.string()).max(200)).default({}),
  /**
   * Tampilkan cuplikan isi pesan di notifikasi Windows.
   *
   * Bawaannya menyala karena itu yang orang harapkan. Saklarnya ada karena laptop
   * sering di-share screen atau dicolok proyektor saat rapat, dan toast berisi
   * potongan chat muncul di layar besar tanpa bisa ditarik kembali.
   */
  chatPratinjau: z.boolean().default(true),
  /**
   * Pemicu pemantau proaktif yang DIMATIKAN, per user: `{ "budi": ["sales_anjlok"] }`.
   *
   * Bawaan kosong = semua pemicu menyala untuk siapa pun yang berizin menunya
   * (keputusan user 20 Okt 2026). Dikunci per username dengan alasan yang sama
   * dengan `chatSenyap`: satu laptop dipakai bergantian, dan pilihan "jangan beri
   * tahu saya" milik orangnya, bukan milik laptop.
   * ⚠️ Sengaja `z.string()`, BUKAN `z.enum(...)`: kalau kelak ada id pemicu yang
   * dihapus, enum membuat SELURUH config gagal di-parse dan `loadConfig` jatuh ke
   * bawaan — folder akses & senyap chat ikut hilang. Id asing disaring saat dibaca
   * (`saklarDariConfig`).
   */
  pemantauMati: z.record(z.string(), z.array(z.string().max(40)).max(10)).default({}),
  /** Reagent Check: the folder with the usage and stock-opname files, per username (lower case). */
  reagentFolders: z.record(z.string(), z.string().max(1000)).default({}),
  /**
   * AIRA ikut menyala saat Windows login (tersembunyi di tray).
   *
   * ⚠️ Bawaannya MATI. Menambahkan diri sendiri ke daftar startup Windows tanpa
   * diminta adalah hal yang benar-benar mengganggu, dan itu jenis keputusan yang
   * harus diambil orangnya sendiri — pola yang sama dengan `onedriveFolders`.
   * Widget chat menawarkannya SEKALI; sesudah dijawab, tidak ditanya lagi.
   */
  autoStart: z.boolean().default(false),
  /** Tawaran autostart sudah pernah ditampilkan — jangan tanya dua kali. */
  autoStartDitanya: z.boolean().default(false),
  // Daftar kredensial situs. Username & password TIDAK di sini — hanya di secret store.
  webCredentials: z
    .array(z.object({ name: z.string().min(1).max(60), url: z.string().max(300).default('') }))
    .default([])
})

export type AppConfig = z.infer<typeof ConfigSchema>

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

export function loadConfig(): AppConfig {
  try {
    if (existsSync(configPath())) {
      const raw = JSON.parse(readFileSync(configPath(), 'utf-8'))
      return ConfigSchema.parse(migrateRawModels(raw))
    }
  } catch {
    // config korup -> fallback ke default, jangan crash aplikasi
  }
  return ConfigSchema.parse({})
}

export function saveConfig(config: AppConfig): void {
  const path = configPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(ConfigSchema.parse(config), null, 2), 'utf-8')
}
