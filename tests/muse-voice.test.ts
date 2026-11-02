import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { asrRequestJson, readAsrResponse } from '../src/main/suara/transkrip'
import { getTool } from '../src/main/tools/registry'

const src = (p: string): string => readFileSync(p, 'utf8')

describe('Muse Voice Transcribe request', () => {
  test('request part is exactly the push-to-talk WAV English request', () => {
    assert.equal(
      asrRequestJson(),
      JSON.stringify({
        model: 'muse-voice-transcribe-1.0',
        mode: 'PUSH_TO_TALK',
        audioEncoding: 'WAV',
        languageBias: ['English']
      })
    )
  })

  test('response transcript is trimmed', () => {
    assert.equal(readAsrResponse({ transcript: ' How much stock? ' }), 'How much stock?')
  })

  test('a response without transcript is an error, not an empty question', () => {
    assert.throws(() => readAsrResponse({}), /unexpected transcription response/)
    assert.throws(() => readAsrResponse(null), /unexpected transcription response/)
  })

  test('no local whisper process any more', () => {
    assert.doesNotMatch(src('src/main/suara/transkrip.ts'), /spawn\(/)
  })
})

describe('RAG off (Meta has no embedding or rerank model)', () => {
  test('document index tools are not registered', () => {
    assert.equal(getTool('index_folder'), undefined)
    assert.equal(getTool('search_docs'), undefined)
  })

  test('auto-index returns early', () => {
    const s = src('src/main/rag/auto.ts')
    const fn = s.slice(s.indexOf('export function triggerAutoIndex'))
    assert.match(fn.slice(0, 200), /if \(RAG_DISABLED\) return/)
  })

  test('history search skips the reranker', () => {
    assert.match(src('src/main/tools/riwayat-tools.ts'), /if \(provider && !RAG_DISABLED\)/)
  })
})

describe('background calls leave room for Muse hidden reasoning', () => {
  test('memory extraction cap is 2000 (300 returned empty: 298 reasoning tokens, finish length)', () => {
    const s = src('src/main/memori/service.ts')
    assert.match(s, /promptEkstraksi\(pesanUser, sudahAda\) \}\],\s*model,\s*(\/\/[^\n]*\n\s*)?2000\s*\)/)
  })
})
