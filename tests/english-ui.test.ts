import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// Hackathon build: every user-visible string is English. Scans string literals and JSX text (comments
// stripped) for whole Indonesian words. Identifiers, comments and SQL are not user-visible and are ignored.

export const ID_WORDS = [
  'dan', 'yang', 'untuk', 'tidak', 'dengan', 'belum', 'sudah', 'pilih', 'simpan', 'hapus', 'cari', 'tanya',
  'kirim', 'buka', 'tutup', 'batal', 'semua', 'baru', 'hari', 'bulan', 'minggu', 'masuk', 'keluar', 'berkas',
  'percakapan', 'pengguna', 'lihat', 'tambah', 'ubah', 'memuat', 'gagal', 'berhasil', 'ini', 'itu', 'ada',
  'akan', 'bisa', 'dari', 'pada', 'atau', 'saya', 'kamu', 'anda', 'sedang', 'jawaban', 'pertanyaan', 'data\\s+sales',
  'beranda', 'gambar', 'jadwal', 'pustaka', 'panduan', 'masukan', 'usulan', 'pesan', 'rekan', 'pelanggan',
  'penjualan', 'harga', 'sampel', 'dokumen', 'laporan', 'tugas', 'pengaturan', 'jumlah', 'nama', 'tanggal',
  'waktu', 'terakhir', 'contoh', 'kategori', 'periode', 'sumber', 'tentang', 'bantuan', 'selesai', 'aktif',
  'nonaktif', 'diproses', 'ditolak', 'menunggu', 'kemarin', 'tahun', 'jam', 'detik', 'menit', 'ke', 'di',
  'tahap', 'umur', 'pemeriksaan', 'perbandingan', 'naik', 'turun', 'tren', 'ringkasan', 'divisi', 'anggota',
  'menyiapkan', 'asisten', 'sebentar', 'mohon', 'tunggu', 'selamat', 'pagi', 'siang', 'sore', 'malam'
]

const WORD = new RegExp(`(?<![\\w-])(${ID_WORDS.join('|')})(?![\\w-])`, 'i')

/**
 * Allowed although Indonesian — not shown to anyone:
 * - old style suffixes stored inside earlier saved image prompts, still matched so old images keep their label
 * - patterns that read the user's Indonesian sentence (Indonesian input keeps working)
 * - the "not in master" marker the sales queries write, compared in the card code (displayed in English)
 */
const ALLOW: RegExp[] = [
  /^gaya ilustrasi flat modern/,
  /^poster acara kantor/,
  /^ilustrasi kartun lucu/,
  /sabtu\)\(\?:/,
  /^\((pelanggan )?tidak ada di master/
]

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?|css)$/.test(name) && !name.endsWith('.d.ts') && !name.endsWith('.css')) out.push(p)
  }
  return out
}

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
}

export interface Hit {
  file: string
  line: number
  text: string
}

function lineOf(s: string, index: number): number {
  return s.slice(0, index).split('\n').length
}

/** Literals and JSX text that contain an Indonesian word. `onlyLines` limits the scan to matching lines (+2). */
export function indonesianHits(file: string, onlyLines?: RegExp): Hit[] {
  const raw = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  // Log messages are for developers, who search the log by exact text (see CLAUDE.md): not user-visible.
  let s = stripComments(raw)
    .split('\n')
    .map((l) => (/logger\(\)\.\w+\(/.test(l) ? '' : l))
    .join('\n')
  if (onlyLines) {
    const lines = s.split('\n')
    const keep = new Set<number>()
    lines.forEach((l, i) => {
      if (!onlyLines.test(l)) return
      keep.add(i)
      // Continuation lines only while the statement visibly continues (`=>`, `+`, `(`, `?`, `:` at the end).
      for (let k = i; k < i + 3 && /(=>|\+|\(|\?|:|`)\s*$/.test(lines[k]); k++) keep.add(k + 1)
    })
    s = lines.map((l, i) => (keep.has(i) ? l : '')).join('\n')
  }
  const hits: Hit[] = []
  const check = (text: string, index: number): void => {
    const t = text.trim()
    if (!t || !WORD.test(t) || ALLOW.some((a) => a.test(t))) return
    // Dotted keys (localStorage / i18n-like ids) and JSX-text artefacts spanning code are not copy.
    if (/^\w+(\.\w+)+$/.test(t) || /^[.@\w-]*\/[\w./-]+$/.test(t) ||/\b(const|return|let)\s|===|!==|&&|\?\s*\(|\s\?\s.*\s:\s/.test(t)) return
    // Lowercase tokens / hyphenated lists are ids, enum values or CSS class names compared in code, not
    // display text (UI copy is capitalised or a sentence). Spans with code punctuation are the regex pairing
    // quotes across code (an apostrophe in JSX text), not a string.
    if (/^[a-z0-9_]+$/.test(t) || (/^[a-z0-9_\- ]+$/.test(t) && /[-_]/.test(t))) return
    if (/[;{}]|\)\.|=>|\(\)|\w\(|\$\{/.test(t)) return
    hits.push({ file, line: lineOf(s, index), text: t.slice(0, 80) })
  }
  if (file.endsWith('.tsx')) {
    for (const m of s.matchAll(/>([^<>{}]+)</g)) check(m[1], m.index!)
  }
  for (const m of s.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    check(m[1] ?? m[2] ?? m[3] ?? '', m.index!)
  }
  return hits
}

const RENDERER = walk('src/renderer/src')

/** Main/shared files whose strings reach the screen verbatim (cards, dashboards, Guide, menu labels, toasts). */
const MAIN_SHOWN = [
  ...walk('src/main/visual'),
  ...walk('src/main/dashboard'),
  'src/main/panduan/isi.ts',
  'src/main/sales/order-status.ts',
  'src/main/auth/roles.ts',
  'src/main/pemantau/rules.ts',
  'src/shared/chat-sistem.ts',
  'src/shared/jadwal-pola.ts',
  'src/shared/dikte.ts',
  'src/main/suara/rules.ts',
  'src/main/agent/context-limit.ts',
  'src/main/agent/jawaban-kosong.ts',
  'src/main/gambar/omni.ts',
  'src/main/gambar/rules.ts',
  // Splash window shown while the app starts.
  'src/main/splash.ts'
]

/** Tool step labels shown in the chat and under the mascot. */
const TOOL_FILES = walk('src/main/tools').filter((f) => !f.includes('.test.'))

const report = (hits: Hit[]): string =>
  hits.slice(0, 60).map((h) => `${h.file}:${h.line}  ${h.text}`).join('\n') + (hits.length > 60 ? `\n… +${hits.length - 60} more` : '')

describe('English UI', () => {
  test('renderer strings are English', () => {
    const hits = RENDERER.flatMap((f) => indonesianHits(f))
    assert.equal(hits.length, 0, `${hits.length} Indonesian strings:\n${report(hits)}`)
  })

  test('main-side strings shown verbatim are English', () => {
    const hits = MAIN_SHOWN.flatMap((f) => indonesianHits(f))
    assert.equal(hits.length, 0, `${hits.length} Indonesian strings:\n${report(hits)}`)
  })

  test('tool labels and step summaries are English', () => {
    const hits = TOOL_FILES.flatMap((f) => indonesianHits(f, /^\s*(label|summarize)\s*:/))
    assert.equal(hits.length, 0, `${hits.length} Indonesian strings:\n${report(hits)}`)
  })

  test('the scanner catches Indonesian and ignores English', () => {
    const { writeFileSync, mkdtempSync } = require('fs') as typeof import('fs')
    const { tmpdir } = require('os') as typeof import('os')
    const dir = mkdtempSync(join(tmpdir(), 'scan-'))
    const f = join(dir, 'x.tsx')
    writeFileSync(f, `// tidak ada\nconst a = 'Simpan perubahan'\nconst b = 'Save changes'\nconst c = <p>Belum ada data</p>\nconst d = <p>No data yet</p>\nconst e = 'kartu-baru'\n`)
    assert.deepEqual(indonesianHits(f).map((h) => h.line).sort(), [2, 4])
    const g = join(dir, 'y.ts')
    writeFileSync(g, `logger().warn({ a: 1 }, 'gateway gambar menolak')
const m = 'Gambar tidak ditemukan'
`)
    assert.deepEqual(indonesianHits(g).map((h) => h.line), [2])
  })
})

describe('splash window', () => {
  // The splash HTML lives in a template string the generic scan treats as code — so its visible text is checked here.
  test('the text under the logo while AIRA starts is English', () => {
    const html = readFileSync('src/main/splash.ts', 'utf8')
    const texts = [...html.matchAll(/<p>([^<]*)<\/p>/g)].map((m) => m[1])
    assert.ok(texts.length > 0)
    for (const t of texts) assert.doesNotMatch(t, WORD, t)
  })
})
