import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'os'
import { RAG_DISABLED } from '../src/main/hackathon/flags'
import type { systemPrompt as SystemPromptFn } from '../src/main/agent/orchestrator'

// `skillSection()` reads the skills folders through Electron's `app`; outside Electron that module is only a
// path string, so give it the three calls the prompt builder makes.
const Module = require('module') as { _load: (request: string, ...rest: unknown[]) => unknown }
const realLoad = Module._load
Module._load = function (request: string, ...rest: unknown[]) {
  if (request === 'electron') {
    return { app: { getAppPath: () => process.cwd(), getPath: () => tmpdir(), isPackaged: false } }
  }
  return realLoad.call(this, request, ...rest)
}
const { systemPrompt } = require('../src/main/agent/orchestrator') as { systemPrompt: typeof SystemPromptFn }
Module._load = realLoad

// Hackathon build: the document index is off, so tools `search_docs` / `index_folder` are not registered.
// A New Task prompt that tells the model to call them makes it try a tool that does not exist (rule 17 of
// CLAUDE.md: a missing tool needs an explicit pointer to the alternative, or the model answers from memory).

describe('New Task system prompt without the document index', () => {
  const off = systemPrompt([], 'C:\ruang-uji', true)

  test('this build has the document index off', () => {
    assert.equal(RAG_DISABLED, true)
  })

  test('never names the unregistered document-search tools', () => {
    assert.doesNotMatch(off, /search_docs/)
    assert.doesNotMatch(off, /index_folder/)
  })

  test('says plainly that search by meaning is unavailable and points to the readers', () => {
    assert.match(off, /not available in this build/i)
    for (const t of ['read_file', 'read_word', 'read_excel', 'read_pdf', 'read_ppt', 'search_code']) {
      assert.ok(off.includes(t), t)
    }
  })

  test('keeps the language rule and the keep-reading-in-full intent', () => {
    assert.ok(off.includes('Always answer in English.'))
    assert.match(off, /DO NOT re-read the same document many times/)
    assert.match(off, /Read the source file IN FULL/)
  })

  test('with the index on (other builds) the original rules are unchanged', () => {
    const on = systemPrompt([], 'C:\ruang-uji', false)
    assert.match(on, /search_docs/)
    assert.match(on, /index_folder/)
    assert.ok(on.includes('Always answer in English.'))
  })
})
