import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import * as path from 'path'
import { resolveInBoundary } from './boundary'
import { ToolError, type ToolDefinition } from './types'

// Coding tools ala Claude Code: edit presisi (search & replace unik) + grep codebase.

const MAX_EDIT_FILE_BYTES = 2 * 1024 * 1024
const MAX_SEARCH_RESULTS = 200
const MAX_SEARCH_VISITS = 8000
const MAX_LINE_CHARS = 300

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string') throw new ToolError(`argumen "${key}" wajib berupa string`)
  return value
}

function shortPreview(text: string, max = 160): string {
  const oneline = text.replace(/\n/g, '⏎')
  return oneline.length > max ? oneline.slice(0, max) + '…' : oneline
}

export const codeTools: ToolDefinition[] = [
  {
    name: 'edit_file',
    label: 'Edit File',
    description:
      'Mengedit file teks/kode dengan mengganti potongan teks EKSAK. old_string harus muncul persis ' +
      'dan unik di file (sertakan beberapa baris konteks agar unik). Untuk mengganti semua kemunculan, ' +
      'set replace_all=true. Butuh persetujuan user (ditampilkan sebagai diff).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path file yang diedit' },
        old_string: { type: 'string', description: 'Teks lama, persis seperti di file' },
        new_string: { type: 'string', description: 'Teks pengganti' },
        replace_all: { type: 'boolean', description: 'Ganti semua kemunculan (default false)' }
      },
      required: ['path', 'old_string', 'new_string']
    },
    tier: 'mutate',
    summarize: (a) =>
      `Edit ${a.path}\n--- lama\n${shortPreview(String(a.old_string ?? ''), 300)}\n+++ baru\n${shortPreview(String(a.new_string ?? ''), 300)}`,
    execute: async (args, ctx) => {
      const file = resolveInBoundary(str(args, 'path'), ctx.allowedDirs)
      const oldString = str(args, 'old_string')
      const newString = str(args, 'new_string')
      if (!oldString) throw new ToolError('old_string tidak boleh kosong')
      if (oldString === newString) throw new ToolError('old_string dan new_string sama')
      const stats = statSync(file)
      if (!stats.isFile()) throw new ToolError('path bukan file')
      if (stats.size > MAX_EDIT_FILE_BYTES) throw new ToolError('file terlalu besar untuk diedit')
      const buffer = readFileSync(file)
      if (buffer.subarray(0, 4096).includes(0)) throw new ToolError('file binary tidak bisa diedit')
      const content = buffer.toString('utf-8')

      const occurrences = content.split(oldString).length - 1
      if (occurrences === 0) {
        throw new ToolError('old_string tidak ditemukan di file — baca ulang file dan cocokkan persis')
      }
      if (occurrences > 1 && !args.replace_all) {
        throw new ToolError(
          `old_string muncul ${occurrences} kali — tambahkan konteks agar unik, atau set replace_all=true`
        )
      }
      const updated = args.replace_all
        ? content.split(oldString).join(newString)
        : content.replace(oldString, newString)
      writeFileSync(file, updated, 'utf-8')
      return JSON.stringify({ edited: file, replacements: args.replace_all ? occurrences : 1 })
    }
  },
  {
    name: 'search_code',
    label: 'Cari di Kode',
    description:
      'Mencari teks/pola di dalam ISI file (seperti grep), rekursif. Mengembalikan file, nomor baris, ' +
      'dan isi barisnya. Gunakan untuk menemukan fungsi, variabel, konfigurasi, atau string di codebase.',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Folder awal pencarian' },
        query: { type: 'string', description: 'Teks yang dicari' },
        isRegex: { type: 'boolean', description: 'true bila query adalah regular expression' },
        extension: { type: 'string', description: 'Filter ekstensi, mis. ".ts" (opsional)' }
      },
      required: ['dir', 'query']
    },
    tier: 'read',
    timeoutMs: 60_000,
    summarize: (a) => `Grep "${a.query}" di ${a.dir}`,
    execute: async (args, ctx) => {
      const root = resolveInBoundary(str(args, 'dir'), ctx.allowedDirs)
      const query = str(args, 'query')
      if (!query) throw new ToolError('query tidak boleh kosong')
      let matcher: (line: string) => boolean
      if (args.isRegex) {
        let regex: RegExp
        try {
          regex = new RegExp(query, 'i')
        } catch {
          throw new ToolError('regex tidak valid')
        }
        matcher = (line) => regex.test(line)
      } else {
        const lowered = query.toLowerCase()
        matcher = (line) => line.toLowerCase().includes(lowered)
      }
      const extension = typeof args.extension === 'string' ? args.extension.toLowerCase() : null

      const results: Array<{ file: string; line: number; text: string }> = []
      let visited = 0
      const walk = (dir: string, depth: number): void => {
        if (depth > 10 || results.length >= MAX_SEARCH_RESULTS || visited >= MAX_SEARCH_VISITS) return
        let entries
        try {
          entries = readdirSync(dir, { withFileTypes: true })
        } catch {
          return
        }
        for (const entry of entries) {
          if (results.length >= MAX_SEARCH_RESULTS || ++visited >= MAX_SEARCH_VISITS) return
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            walk(full, depth + 1)
            continue
          }
          if (extension && !entry.name.toLowerCase().endsWith(extension)) continue
          let buffer: Buffer
          try {
            if (statSync(full).size > 1024 * 1024) continue
            buffer = readFileSync(full)
          } catch {
            continue
          }
          if (buffer.subarray(0, 4096).includes(0)) continue
          const lines = buffer.toString('utf-8').split('\n')
          for (let i = 0; i < lines.length; i++) {
            if (matcher(lines[i])) {
              results.push({ file: full, line: i + 1, text: lines[i].trim().slice(0, MAX_LINE_CHARS) })
              if (results.length >= MAX_SEARCH_RESULTS) break
            }
          }
        }
      }
      walk(root, 0)
      return JSON.stringify({ query, matches: results, complete: visited < MAX_SEARCH_VISITS })
    }
  }
]
