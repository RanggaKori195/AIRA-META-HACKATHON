import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MODE_CHAT, modeEfektif, modeSah } from '../src/shared/mode-chat'

// Mode milik PERCAKAPAN (aturan 31) — untuk SEMUA mode, bukan hanya yang ada
// saat aturan itu ditulis (13 Okt 2026).
//
// `sessionMode` & `listSessions` di db.ts dulu mencocokkan daftar tangan
// 'sales' | 'masterdata' | 'general'. Mode `lab` (TAT Sample) dan `onedrive`
// (Microsoft 365) yang lahir sesudahnya jatuh ke null / 'general', jadi
// percakapan TAT & Microsoft 365 yang dibuka lagi dari riwayat berjalan sebagai
// Task Baru — tanpa tool OneDrive/lab untuk pertanyaan lanjutan. Ditemukan saat
// membersihkan data uji: dua percakapan Microsoft 365 tercatat `mode: general`.

describe('setiap mode percakapan dikenali', () => {
  test('lab dan onedrive dikenali — dua mode yang dulu jatuh ke general', () => {
    assert.equal(modeSah('lab'), 'lab')
    assert.equal(modeSah('onedrive'), 'onedrive')
  })

  test('mode lama tetap dikenali', () => {
    for (const m of ['general', 'sales', 'masterdata'] as const) assert.equal(modeSah(m), m)
  })

  test('sesi lama (NULL) dan nilai asing → null, tidak ditebak', () => {
    assert.equal(modeSah(null), null)
    assert.equal(modeSah(undefined), null)
    assert.equal(modeSah('Sales'), null)
    assert.equal(modeSah('admin'), null)
    assert.equal(modeSah(''), null)
  })

  test('daftar mode sah memuat keenam mode (Reagent Check ditambahkan)', () => {
    assert.deepEqual([...MODE_CHAT].sort(), ['general', 'masterdata', 'lab', 'onedrive', 'reagent', 'sales'])
  })
})

describe('mode yang dipakai: tersimpan menang atas kiriman renderer', () => {
  test('percakapan Microsoft 365 yang dibuka saat menu lain aktif tetap onedrive', () => {
    assert.equal(modeEfektif('onedrive', 'general'), 'onedrive')
    assert.equal(modeEfektif('lab', 'sales'), 'lab')
  })

  test('percakapan baru / sesi lama tanpa mode memakai kiriman renderer', () => {
    assert.equal(modeEfektif(null, 'sales'), 'sales')
    assert.equal(modeEfektif(null, undefined), 'general')
  })
})

describe('db.ts tidak lagi memakai daftar mode tulisan tangan', () => {
  // ⚠️ Daftar tangan inilah yang tertinggal saat dua mode baru ditambahkan.
  // Satu definisi (`modeSah`) supaya mode berikutnya tidak bernasib sama.
  const src = readFileSync(join(__dirname, '..', 'src', 'main', 'db.ts'), 'utf8')

  test('sessionMode & listSessions memakai modeSah', () => {
    assert.match(src, /export function sessionMode[\s\S]{0,400}modeSah\(/)
    assert.match(src, /export function listSessions[\s\S]{0,900}modeSah\(/)
  })

  test('tidak ada pencocokan mode satu per satu yang tersisa', () => {
    assert.doesNotMatch(src, /mode === 'sales' \|\| [a-z.]*mode === 'masterdata'/)
  })
})
