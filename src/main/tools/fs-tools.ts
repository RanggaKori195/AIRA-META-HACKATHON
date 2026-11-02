import { app, shell } from 'electron'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  copyFileSync,
  renameSync
} from 'fs'
import * as path from 'path'
import { exec } from 'child_process'
import { resolveInBoundary } from './boundary'
import { ToolError, type ToolDefinition } from './types'
import { catatanBaca, potongTeks } from './text-read'
import { loadConfig, saveConfig } from '../config'
import { triggerAutoIndex } from '../rag/auto'
import { assertNotBrowserLaunch } from './command-guard'

const MAX_READ_BYTES = 256 * 1024
const MAX_DIR_ENTRIES = 500
const MAX_SEARCH_RESULTS = 200
const MAX_SEARCH_VISITS = 5000
const MAX_COMMAND_OUTPUT = 20 * 1024

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new ToolError(`argumen "${key}" wajib berupa string`)
  }
  return value
}

// Format yang HARUS dibuat lewat tool khususnya. Menulis teks polos dengan
// ekstensi ini menghasilkan file rusak yang tidak bisa dibuka aplikasinya.
const STRUCTURED_FORMATS: Record<string, string> = {
  '.docx': 'write_word',
  '.doc': 'write_word',
  '.xlsx': 'write_excel',
  '.xls': 'write_excel',
  '.pptx': 'write_ppt',
  '.ppt': 'write_ppt',
  '.pdf': 'write_word (lalu user bisa export ke PDF)'
}

export function assertPlainTextTarget(file: string): void {
  const ext = path.extname(file).toLowerCase()
  const proper = STRUCTURED_FORMATS[ext]
  if (proper) {
    throw new ToolError(
      `file "${ext}" tidak boleh dibuat dengan tool teks biasa — hasilnya akan rusak dan tidak bisa dibuka. ` +
        `Gunakan ${proper}.`
    )
  }
}

// Model kadang menghindari write_word (kadang malah mengaku tool-nya "tidak tersedia"
// padahal ada) lalu menurunkan dokumen kerja jadi .md. Penerima materi ini membuka
// file dengan Office, jadi penurunan format itu harus dicegah — kecuali user memang
// meminta format teks secara eksplisit.
const DOCUMENT_NAME_HINT =
  /battlecard|strategi|strategy|laporan|report|proposal|memo|notulen|risalah|rencana|analisis|analisa|ringkasan|rangkuman|materi|presentasi|kebijakan|prosedur|panduan|profil|penawaran|kajian/i

export function assertNotDocumentAsText(file: string, plainTextIntended: boolean): void {
  if (plainTextIntended) return
  const ext = path.extname(file).toLowerCase()
  if (ext !== '.md' && ext !== '.txt') return
  const base = path.basename(file, ext)
  if (DOCUMENT_NAME_HINT.test(base)) {
    throw new ToolError(
      `"${base}" adalah dokumen kerja — buat sebagai Word dengan write_word ` +
        '(atau write_excel/write_ppt bila lebih sesuai). File .md tidak bisa dibuka rapi oleh penerimanya. ' +
        'CATATAN: tool write_word TERSEDIA — jangan mengaku sebaliknya. ' +
        'Hanya bila user secara eksplisit meminta format teks/markdown, panggil ulang dengan plainTextIntended=true.'
    )
  }
}

function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 4096)
  return sample.includes(0)
}

/**
 * Folder kerja bawaan untuk perintah yang TIDAK terikat folder tertentu
 * (mis. `npm install -g`). Milik aplikasi, dibuat sekali.
 *
 * ⚠️ Sengaja BUKAN Documents/Desktop user. Perintah yang tidak menyebut folder
 * tidak boleh diam-diam berjalan di tempat berisi berkas orang — kalau ia
 * kebetulan membuat berkas, ia mengotori folder pribadi tanpa ada yang tahu.
 */
function folderKerjaBebas(): string {
  const dir = path.join(app.getPath('userData'), 'kerja')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export const fsTools: ToolDefinition[] = [
  {
    name: 'request_folder_access',
    description:
      'Meminta izin user untuk mengakses sebuah folder yang berada di luar folder akses saat ini. ' +
      'Panggil tool ini ketika user menyebut path yang belum boleh kamu akses, lalu lanjutkan task setelah disetujui.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path folder yang dibutuhkan' } },
      required: ['path']
    },
    tier: 'mutate',
    summarize: (a) => `Give AIRA access to folder ${a.path}`,
    execute: async (args) => {
      const dir = path.resolve(str(args, 'path'))
      if (!existsSync(dir)) throw new ToolError(`folder "${dir}" tidak ditemukan`)
      if (!statSync(dir).isDirectory()) throw new ToolError(`"${dir}" bukan folder`)
      const config = loadConfig()
      if (!config.allowedDirs.includes(dir)) {
        config.allowedDirs.push(dir)
        saveConfig(config)
        triggerAutoIndex('folder_grant')
      }
      return JSON.stringify({ granted: dir, allowedDirs: config.allowedDirs })
    }
  },
  {
    name: 'list_dir',
    description:
      'Melihat isi sebuah folder: nama, tipe (file/folder), dan ukuran. Gunakan untuk eksplorasi.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path folder absolut' } },
      required: ['path']
    },
    tier: 'read',
    summarize: (a) => `List folder ${a.path}`,
    execute: async (args, ctx) => {
      const dir = resolveInBoundary(str(args, 'path'), ctx.allowedDirs)
      const entries = readdirSync(dir, { withFileTypes: true }).slice(0, MAX_DIR_ENTRIES)
      const rows = entries.map((e) => {
        if (e.isDirectory()) return { name: e.name, type: 'dir' }
        try {
          return { name: e.name, type: 'file', size: statSync(path.join(dir, e.name)).size }
        } catch {
          return { name: e.name, type: 'file' }
        }
      })
      return JSON.stringify({ path: dir, entries: rows })
    }
  },
  {
    name: 'read_file',
    description:
      `Membaca isi file teks. Sekali panggil membaca sampai ${MAX_READ_BYTES / 1024} KB, dipotong ` +
      'di BATAS BARIS. File binary ditolak. Hasilnya SELALU menyatakan apakah file terbaca ' +
      'seluruhnya; kalau ada sisa, ia menyebut fromLine untuk melanjutkan. JANGAN menyimpulkan ' +
      'ada bagian yang terpotong kecuali hasil tool memang mengatakannya.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path file absolut' },
        fromLine: {
          type: 'number',
          description:
            'Mulai membaca dari baris ke berapa (1-based). Diisi HANYA untuk melanjutkan bacaan ' +
            'yang hasil sebelumnya menyebut "lanjutkanDari". Jangan diisi sendiri pada panggilan pertama.'
        }
      },
      required: ['path']
    },
    tier: 'read',
    summarize: (a) => `Read file ${a.path}${a.fromLine ? ` (from line ${a.fromLine})` : ''}`,
    execute: async (args, ctx) => {
      const file = resolveInBoundary(str(args, 'path'), ctx.allowedDirs)
      const stats = statSync(file)
      if (!stats.isFile()) throw new ToolError('path bukan file')
      const buffer = readFileSync(file)
      if (looksBinary(buffer)) throw new ToolError('file binary, tidak bisa dibaca sebagai teks')

      const isi = buffer.toString('utf-8')
      const totalBaris = isi.split('\n').length
      const potongan = potongTeks(isi, Number(args.fromLine) || 1, MAX_READ_BYTES)

      return JSON.stringify({
        path: file,
        ukuranByte: stats.size,
        totalBaris,
        barisTerbaca: `${potongan.dariBaris}-${potongan.sampaiBaris}`,
        lanjutkanDari: potongan.lanjutkanDari,
        // ⚠️ Bendera boolean SAJA tidak cukup. Versi sebelumnya mengembalikan
        // `truncated: false` dan model tetap menulis "sebagian tengah dokumen
        // terpotong" untuk file 11 KB (dilaporkan manajemen 21 Agu 2026).
        // Yang bekerja adalah KALIMAT yang menyatakan kelengkapannya.
        catatanHasil: catatanBaca(potongan, totalBaris, path.basename(file)),
        content: potongan.teks
      })
    }
  },
  {
    name: 'search_files',
    description:
      'Mencari file berdasarkan potongan nama (case-insensitive) secara rekursif di dalam sebuah folder.',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Folder awal pencarian' },
        query: { type: 'string', description: 'Potongan nama file yang dicari' }
      },
      required: ['dir', 'query']
    },
    tier: 'read',
    summarize: (a) => `Search "${a.query}" in ${a.dir}`,
    execute: async (args, ctx) => {
      const root = resolveInBoundary(str(args, 'dir'), ctx.allowedDirs)
      const query = str(args, 'query').toLowerCase()
      const results: string[] = []
      let visited = 0
      const walk = (dir: string, depth: number): void => {
        if (depth > 10 || results.length >= MAX_SEARCH_RESULTS || visited >= MAX_SEARCH_VISITS) return
        let entries
        try {
          entries = readdirSync(dir, { withFileTypes: true })
        } catch {
          return
        }
        for (const e of entries) {
          if (results.length >= MAX_SEARCH_RESULTS || ++visited >= MAX_SEARCH_VISITS) return
          const full = path.join(dir, e.name)
          if (e.name.toLowerCase().includes(query)) results.push(full)
          if (e.isDirectory()) walk(full, depth + 1)
        }
      }
      walk(root, 0)
      return JSON.stringify({ query, results, complete: visited < MAX_SEARCH_VISITS })
    }
  },
  {
    name: 'create_dir',
    description: 'Membuat folder baru (termasuk parent folder bila belum ada).',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path folder baru' } },
      required: ['path']
    },
    tier: 'write',
    summarize: (a) => `Create folder ${a.path}`,
    execute: async (args, ctx) => {
      const dir = resolveInBoundary(str(args, 'path'), ctx.allowedDirs)
      mkdirSync(dir, { recursive: true })
      return JSON.stringify({ created: dir })
    }
  },
  {
    name: 'write_file',
    description:
      'Menulis file TEKS BIASA baru (.txt, .md, .csv, .json, kode, dsb). ' +
      'JANGAN dipakai untuk .docx/.xlsx/.pptx/.pdf — pakai write_word/write_excel/write_ppt, ' +
      'karena file Office bukan teks polos dan akan rusak. Menimpa file yang sudah ada tidak diizinkan.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path file baru' },
        content: { type: 'string', description: 'Isi file' },
        plainTextIntended: {
          type: 'boolean',
          description:
            'Set true HANYA bila user memang meminta format teks/markdown untuk dokumen kerja'
        }
      },
      required: ['path', 'content']
    },
    tier: 'write',
    summarize: (a) => `Write new file ${a.path}`,
    execute: async (args, ctx) => {
      const file = resolveInBoundary(str(args, 'path'), ctx.allowedDirs)
      assertPlainTextTarget(file)
      assertNotDocumentAsText(file, args.plainTextIntended === true)
      if (existsSync(file)) throw new ToolError('file sudah ada — gunakan overwrite_file')
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, String(args.content ?? ''), 'utf-8')
      return JSON.stringify({ written: file })
    }
  },
  {
    name: 'overwrite_file',
    description: 'Menimpa isi file yang SUDAH ADA dengan konten baru. Butuh persetujuan user.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path file yang ditimpa' },
        content: { type: 'string', description: 'Isi baru' }
      },
      required: ['path', 'content']
    },
    tier: 'mutate',
    summarize: (a) => `OVERWRITE file ${a.path}`,
    execute: async (args, ctx) => {
      const file = resolveInBoundary(str(args, 'path'), ctx.allowedDirs)
      assertPlainTextTarget(file)
      if (!existsSync(file)) throw new ToolError('file tidak ada — gunakan write_file')
      writeFileSync(file, String(args.content ?? ''), 'utf-8')
      return JSON.stringify({ overwritten: file })
    }
  },
  {
    name: 'copy_item',
    description: 'Menyalin file ke lokasi baru (tidak menimpa yang sudah ada).',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string' },
        destination: { type: 'string' }
      },
      required: ['source', 'destination']
    },
    tier: 'write',
    summarize: (a) => `Copy ${a.source} -> ${a.destination}`,
    execute: async (args, ctx) => {
      const source = resolveInBoundary(str(args, 'source'), ctx.allowedDirs)
      const destination = resolveInBoundary(str(args, 'destination'), ctx.allowedDirs)
      if (existsSync(destination)) throw new ToolError('tujuan sudah ada')
      mkdirSync(path.dirname(destination), { recursive: true })
      copyFileSync(source, destination)
      return JSON.stringify({ copied: source, to: destination })
    }
  },
  {
    name: 'move_item',
    description: 'Memindahkan atau me-rename file/folder. Butuh persetujuan user.',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string' },
        destination: { type: 'string' }
      },
      required: ['source', 'destination']
    },
    tier: 'mutate',
    summarize: (a) => `Move ${a.source} -> ${a.destination}`,
    execute: async (args, ctx) => {
      const source = resolveInBoundary(str(args, 'source'), ctx.allowedDirs)
      const destination = resolveInBoundary(str(args, 'destination'), ctx.allowedDirs)
      if (existsSync(destination)) throw new ToolError('tujuan sudah ada')
      mkdirSync(path.dirname(destination), { recursive: true })
      renameSync(source, destination)
      return JSON.stringify({ moved: source, to: destination })
    }
  },
  {
    name: 'delete_item',
    description:
      'Menghapus file/folder — dikirim ke Recycle Bin (bisa dikembalikan). Butuh persetujuan user.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path']
    },
    tier: 'mutate',
    summarize: (a) => `DELETE ${a.path} (to Recycle Bin)`,
    execute: async (args, ctx) => {
      const target = resolveInBoundary(str(args, 'path'), ctx.allowedDirs)
      if (!existsSync(target)) throw new ToolError('path tidak ditemukan')
      await shell.trashItem(target)
      return JSON.stringify({ trashed: target })
    }
  },
  {
    name: 'run_command',
    description:
      'Menjalankan perintah shell. Perintah yang MENGUBAH sesuatu (install, update, hapus) ' +
      'butuh persetujuan user; perintah yang hanya membaca (cek versi, lihat daftar) langsung ' +
      'jalan. Output maksimal 20 KB. ' +
      // ⚠️ Instruksi ini menyelesaikan masalah NYATA yang terlihat 8 Sep 2026:
      // model menulis `nvm version 2>nul || echo NVM_TIDAK_ADA` untuk memeriksa
      // keberadaan program. Niatnya murni membaca, tapi operator shell membuatnya
      // WAJIB minta izin — sehingga tiap pemeriksaan memunculkan dialog dan
      // kelelahan popup yang mau dicegah justru kembali. Jangan longgarkan
      // guardnya; arahkan modelnya ke bentuk yang aman.
      'PENTING: tulis SATU perintah sederhana per panggilan, TANPA operator shell ' +
      '(&&, ||, |, ;, >, 2>nul). Perintah tanpa operator yang sifatnya membaca akan ' +
      'jalan LANGSUNG tanpa mengganggu user; begitu ada operator, user harus menyetujuinya. ' +
      'Tidak perlu menambahkan penanganan galat sendiri: kalau perintahnya gagal atau ' +
      'programnya tidak ada, exitCode dan stderr dikembalikan apa adanya kepadamu — ' +
      'cukup panggil "nvm version" saja, jangan "nvm version 2>nul || echo TIDAK_ADA". ' +
      'KOSONGKAN `cwd` untuk perintah yang tidak terikat folder tertentu — misalnya ' +
      '"npm install -g ...", "winget install ...", atau cek versi. Isi `cwd` HANYA bila ' +
      'perintahnya memang harus jalan di dalam folder tertentu, dan folder itu wajib sudah ' +
      'ada di daftar folder akses.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Perintah yang dijalankan' },
        cwd: {
          type: 'string',
          description:
            'Opsional. Folder tempat perintah dijalankan; wajib di dalam folder akses. ' +
            'Kosongkan untuk perintah global/tidak terikat folder.'
        }
      },
      required: ['command']
    },
    tier: 'execute',
    timeoutMs: 120_000,
    // ⚠️ `cwd` opsional sejak 8 Sep 2026 — tanpa penjagaan ini ringkasannya
    // tertulis "(di undefined)" di kartu persetujuan yang dibaca user.
    summarize: (a) => `Run: ${a.command}${a.cwd ? `  (in ${a.cwd})` : ''}`,
    execute: async (args, ctx) => {
      /*
       * `cwd` opsional (8 Sep 2026, permintaan user).
       *
       * ⚠️ Alasannya bukan kemudahan semata. Untuk perintah global seperti
       * `npm install -g ...`, folder kerja TIDAK MEMBATASI APA PUN — perintahnya
       * melakukan hal yang sama dari folder mana pun. Menuntut folder di-grant
       * lebih dulu hanya menambah langkah tanpa menambah keamanan sedikit pun,
       * dan memberi rasa aman yang keliru: batas `cwd` membatasi tempat perintah
       * DIMULAI, bukan apa yang bisa disentuhnya.
       *
       * Yang benar-benar menjaga adalah gerbang persetujuan — user melihat
       * perintah persisnya sebelum ia jalan.
       *
       * Kalau model MENYEBUT folder, aturan grant tetap berlaku penuh: di situ
       * foldernya memang bermakna, dan menjalankan sesuatu di folder yang tidak
       * diizinkan tetap harus ditolak.
       */
      const cwdArg = typeof args.cwd === 'string' ? args.cwd.trim() : ''
      const cwd = cwdArg ? resolveInBoundary(cwdArg, ctx.allowedDirs) : folderKerjaBebas()
      const command = str(args, 'command')
      assertNotBrowserLaunch(command)
      return await new Promise<string>((resolve) => {
        exec(
          command,
          { cwd, timeout: 110_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
          (error, stdout, stderr) => {
            resolve(
              JSON.stringify({
                exitCode: error ? (error.code ?? 1) : 0,
                stdout: String(stdout).slice(0, MAX_COMMAND_OUTPUT),
                stderr: String(stderr).slice(0, MAX_COMMAND_OUTPUT)
              })
            )
          }
        )
      })
    }
  }
]
