import { readdirSync, statSync } from 'fs'
import * as path from 'path'
import { rawDb } from '../db'
import { loadConfig } from '../config'
import { buildProvider } from '../llm/factory'
import { ToolError } from '../tools/types'
import { extractText, SUPPORTED_EXTENSIONS } from './extract'
import { logger } from '../logger'
import { samaAtauDiBawah } from './folder-rules'

// Indexer RAG: chunk -> embed (bge-m3 via gateway) -> simpan BLOB float32 di SQLite.
// Search: brute-force cosine (dot product atas vektor ternormalisasi) — cukup cepat
// untuk skala desktop dan bebas dependensi native tambahan.

const CHUNK_SIZE = 1000
const CHUNK_OVERLAP = 150
const EMBED_BATCH = 8
const MAX_FILES_PER_RUN = 300

/**
 * Batas ukuran file yang boleh diindeks.
 *
 * Dulu 8 MB, dan itu menjaga hal yang salah. Terukur 19 Agu 2026: laporan PDF 92 halaman
 * berukuran 22,8 MB dilewati diam-diam, padahal teks hasil ekstraksinya hanya 131 ribu
 * karakter — jauh di bawah MAX_CHARS (500 ribu) yang memang membatasi biaya embedding.
 * Ukuran PDF didominasi gambar, bukan teks, jadi ukuran file bukan ukuran biaya.
 *
 * Akibat nyata dari batas lama: dokumen user tidak pernah masuk pengetahuan AIRA, dan
 * setiap pertanyaan tentangnya memaksa membaca ulang seluruh PDF dari awal.
 */
const MAX_FILE_BYTES = 64 * 1024 * 1024
const MAX_WALK_DEPTH = 8

function chunkText(text: string): string[] {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ')
  const chunks: string[] = []
  let start = 0
  while (start < clean.length) {
    let end = Math.min(start + CHUNK_SIZE, clean.length)
    // Usahakan putus di batas kalimat/baris terdekat.
    if (end < clean.length) {
      const window = clean.slice(start, end)
      const breakAt = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('. '))
      if (breakAt > CHUNK_SIZE * 0.5) end = start + breakAt + 1
    }
    const chunk = clean.slice(start, end).trim()
    if (chunk.length > 20) chunks.push(chunk)
    if (end >= clean.length) break
    start = end - CHUNK_OVERLAP
  }
  return chunks
}

function normalize(vector: number[]): Float32Array {
  let norm = 0
  for (const v of vector) norm += v * v
  norm = Math.sqrt(norm) || 1
  const out = new Float32Array(vector.length)
  for (let i = 0; i < vector.length; i++) out[i] = vector[i] / norm
  return out
}

async function embedBatched(texts: string[]): Promise<Float32Array[]> {
  const provider = buildProvider()
  if (!provider) throw new ToolError('LLM belum di-setup')
  const model = loadConfig().embedModel
  const out: Float32Array[] = []
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH)
    const vectors = await provider.embed(batch, model)
    for (const v of vectors) out.push(normalize(v))
  }
  return out
}

function collectFiles(root: string): string[] {
  const files: string[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_WALK_DEPTH || files.length >= MAX_FILES_PER_RUN * 2) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, depth + 1)
      else if (SUPPORTED_EXTENSIONS.some((ext) => entry.name.toLowerCase().endsWith(ext))) {
        files.push(full)
      }
    }
  }
  walk(root, 0)
  return files
}

export interface IndexReport {
  indexed: number
  unchanged: number
  failed: number
  removed: number
  totalChunks: number
  /**
   * File yang SENGAJA dilewati beserta alasannya. Dulu semuanya dilebur ke `failed`
   * tanpa jejak, sehingga dokumen yang tidak pernah masuk pengetahuan AIRA tidak
   * terlihat oleh siapa pun — user maupun yang membaca log.
   */
  dilewati: Array<{ file: string; alasan: string }>
}

export async function indexFolder(root: string): Promise<IndexReport> {
  const db = rawDb()
  const report: IndexReport = {
    indexed: 0, unchanged: 0, failed: 0, removed: 0, totalChunks: 0, dilewati: []
  }
  const lewati = (file: string, alasan: string): void => {
    report.failed++
    report.dilewati.push({ file, alasan })
    logger().warn({ file, alasan }, 'RAG melewati file')
  }
  const files = collectFiles(root).slice(0, MAX_FILES_PER_RUN)
  const seen = new Set<string>()

  for (const file of files) {
    seen.add(file)
    let stats
    try {
      stats = statSync(file)
    } catch {
      lewati(file, 'tidak bisa dibaca')
      continue
    }
    if (stats.size > MAX_FILE_BYTES) {
      const mb = (stats.size / 1024 / 1024).toFixed(1)
      lewati(file, `ukuran ${mb} MB melebihi batas ${MAX_FILE_BYTES / 1024 / 1024} MB`)
      continue
    }
    const existing = db
      .prepare('SELECT id, mtime, size FROM rag_files WHERE path = ?')
      .get(file) as { id: number; mtime: number; size: number } | undefined
    if (existing && existing.mtime === stats.mtimeMs && existing.size === stats.size) {
      report.unchanged++
      continue
    }
    try {
      const text = await extractText(file)
      if (!text) {
        lewati(file, 'tidak ada teks yang bisa diambil (mungkin PDF hasil scan tanpa OCR)')
        continue
      }
      const chunks = chunkText(text)
      if (chunks.length === 0) {
        lewati(file, 'teksnya kosong setelah dipotong-potong')
        continue
      }
      const embeddings = await embedBatched(chunks)

      const replace = db.transaction(() => {
        if (existing) db.prepare('DELETE FROM rag_files WHERE id = ?').run(existing.id)
        const info = db
          .prepare(
            'INSERT INTO rag_files (path, mtime, size, chunk_count, indexed_at) VALUES (?, ?, ?, ?, ?)'
          )
          .run(file, stats.mtimeMs, stats.size, chunks.length, Date.now())
        const insertChunk = db.prepare(
          'INSERT INTO rag_chunks (file_id, chunk_index, text, embedding) VALUES (?, ?, ?, ?)'
        )
        for (let i = 0; i < chunks.length; i++) {
          insertChunk.run(info.lastInsertRowid, i, chunks[i], Buffer.from(embeddings[i].buffer))
        }
      })
      replace()
      report.indexed++
      report.totalChunks += chunks.length
    } catch (err) {
      lewati(file, `error saat mengindeks: ${String(err).slice(0, 120)}`)
    }
  }

  // Bersihkan entri file yang sudah tidak ada di folder ini.
  const stale = db
    .prepare('SELECT id, path FROM rag_files WHERE path LIKE ?')
    .all(root.replace(/[%_]/g, '') + path.sep + '%') as Array<{ id: number; path: string }>
  for (const row of stale) {
    if (!seen.has(row.path)) {
      try {
        statSync(row.path)
      } catch {
        db.prepare('DELETE FROM rag_files WHERE id = ?').run(row.id)
        report.removed++
      }
    }
  }

  return report
}

/**
 * Membuang dari indeks SEMUA berkas di bawah `root`, walau berkasnya masih ada
 * di disk — untuk folder yang tidak boleh diindeks sama sekali (folder unduhan
 * OneDrive, aturan 44). Pembersihan di `indexFolder` hanya membuang berkas yang
 * sudah HILANG, dan hanya untuk folder yang memang sedang diindeks.
 * Potongan teksnya ikut terhapus lewat ON DELETE CASCADE.
 */
export function lupakanFolder(root: string): number {
  const db = rawDb()
  const semua = db.prepare('SELECT id, path FROM rag_files').all() as Array<{ id: number; path: string }>
  const buang = semua.filter((r) => samaAtauDiBawah(r.path, root))
  const hapus = db.prepare('DELETE FROM rag_files WHERE id = ?')
  db.transaction(() => {
    for (const r of buang) hapus.run(r.id)
  })()
  return buang.length
}

export interface SearchHit {
  path: string
  score: number
  snippet: string
}

const RERANK_CANDIDATES = 30

export async function searchDocs(query: string, topK: number): Promise<SearchHit[]> {
  const db = rawDb()
  const total = (db.prepare('SELECT COUNT(*) AS n FROM rag_chunks').get() as { n: number }).n
  if (total === 0) {
    throw new ToolError('belum ada dokumen terindeks — jalankan index_folder dulu pada folder akses')
  }
  const [queryVec] = await embedBatched([query])

  const rows = db
    .prepare(
      'SELECT c.text, c.embedding, f.path FROM rag_chunks c JOIN rag_files f ON f.id = c.file_id'
    )
    .all() as Array<{ text: string; embedding: Buffer; path: string }>

  const scored = rows.map((row) => {
    const vec = new Float32Array(
      row.embedding.buffer,
      row.embedding.byteOffset,
      row.embedding.byteLength / 4
    )
    let dot = 0
    const len = Math.min(vec.length, queryVec.length)
    for (let i = 0; i < len; i++) dot += vec[i] * queryVec[i]
    return { path: row.path, score: dot, snippet: row.text }
  })

  scored.sort((a, b) => b.score - a.score)

  // Tahap 2: rerank kandidat teratas dengan cross-encoder (bge-reranker) —
  // jauh lebih presisi daripada cosine murni. Gagal rerank -> fallback cosine.
  const candidates = scored.slice(0, RERANK_CANDIDATES)
  try {
    const provider = buildProvider()
    if (provider) {
      const rerankScores = await provider.rerank(
        query,
        candidates.map((c) => c.snippet),
        loadConfig().rerankModel
      )
      for (let i = 0; i < candidates.length; i++) candidates[i].score = rerankScores[i]
      candidates.sort((a, b) => b.score - a.score)
    }
  } catch (err) {
    logger().warn({ err: String(err) }, 'rerank failed, falling back to cosine order')
  }

  // Diversifikasi: maksimal 2 chunk per file — tapi kalau slot belum penuh,
  // isi lagi dari kandidat terbaik berikutnya (korpus kecil tidak boleh kelaparan).
  const perFile = new Map<string, number>()
  const hits: SearchHit[] = []
  const picked = new Set<number>()
  for (const [i, s] of candidates.entries()) {
    if (hits.length >= topK) break
    const count = perFile.get(s.path) ?? 0
    if (count >= 2) continue
    perFile.set(s.path, count + 1)
    picked.add(i)
    hits.push({ path: s.path, score: Math.round(s.score * 1000) / 1000, snippet: s.snippet.slice(0, 500) })
  }
  for (const [i, s] of candidates.entries()) {
    if (hits.length >= topK) break
    if (picked.has(i)) continue
    hits.push({ path: s.path, score: Math.round(s.score * 1000) / 1000, snippet: s.snippet.slice(0, 500) })
  }
  return hits
}

export function indexStats(): { files: number; chunks: number } {
  const db = rawDb()
  return {
    files: (db.prepare('SELECT COUNT(*) AS n FROM rag_files').get() as { n: number }).n,
    chunks: (db.prepare('SELECT COUNT(*) AS n FROM rag_chunks').get() as { n: number }).n
  }
}
