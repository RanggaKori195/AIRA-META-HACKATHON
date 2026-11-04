import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { OpenAICompatProvider, interpretCompletion } from '../src/main/llm/openai-compat'
import { LLMError } from '../src/main/llm/provider'
import { pesanUntukUser } from '../src/main/agent/context-limit'
import { OCR_INCOMPLETE_NOTE, tandaiBilaTerpotong } from '../src/main/ocr'

// Muse spends hidden reasoning tokens before the visible answer. A capped background call (OCR page 3000,
// screenshot description, perspectives, memory extraction) can therefore come back empty or cut off while the
// HTTP status is 200. Reporting that as a finished answer is the "silent limit" failure of the project notes.

const reply = (content: string | null, finish: string | null, reasoning?: number) => ({
  choices: [{ message: { content }, finish_reason: finish }],
  usage: { completion_tokens: 900, completion_tokens_details: reasoning === undefined ? undefined : { reasoning_tokens: reasoning } }
})

describe('interpretCompletion (pure reading of a chat/completions body)', () => {
  test('reads text, finish reason and hidden reasoning tokens', () => {
    const r = interpretCompletion(reply('Hello', 'stop', 412))
    assert.deepEqual(r, { text: 'Hello', finishReason: 'stop', reasoningTokens: 412, contentChars: 5 })
  })

  test('missing fields do not throw: empty text, unknown finish reason', () => {
    assert.deepEqual(interpretCompletion({}), { text: '', finishReason: undefined, reasoningTokens: undefined, contentChars: 0 })
    assert.equal(interpretCompletion(reply(null, 'length', 298)).text, '')
    assert.equal(interpretCompletion(null).text, '')
  })
})

/** Provider whose fetch is replaced by a canned 200 reply. */
function providerWith(body: unknown): OpenAICompatProvider {
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    globalThis.fetch = realFetch
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return new OpenAICompatProvider('http://localhost:1', 'k')
}
const msgs = [{ role: 'user' as const, content: 'hi' }]

describe('complete() / completeDetail()', () => {
  test('a normal answer is returned as plain text', async () => {
    assert.equal(await providerWith(reply('Done', 'stop', 10)).complete(msgs, 'm', 100), 'Done')
  })

  test('length + EMPTY content throws LLM_TRUNCATED instead of returning an empty "answer"', async () => {
    await assert.rejects(providerWith(reply('', 'length', 298)).complete(msgs, 'm', 300), (e: unknown) => {
      assert.ok(e instanceof LLMError)
      assert.equal((e as LLMError).code, 'LLM_TRUNCATED')
      assert.match((e as LLMError).message, /output limit/i)
      return true
    })
  })

  test('length + content still returns the cut text unchanged (nothing appended)', async () => {
    assert.equal(await providerWith(reply('partial te', 'length', 50)).complete(msgs, 'm', 100), 'partial te')
  })

  test('completeDetail exposes the finish reason, and does not throw on a cut reply', async () => {
    const d = await providerWith(reply('partial', 'length', 50)).completeDetail(msgs, 'm', 100)
    assert.equal(d.text, 'partial')
    assert.equal(d.finishReason, 'length')
    const e = await providerWith(reply('', 'length', 50)).completeDetail(msgs, 'm', 100)
    assert.equal(e.text, '')
    assert.equal(e.finishReason, 'length')
  })

  test('the user-facing message for the new code is English and actionable', () => {
    const p = pesanUntukUser('LLM_TRUNCATED', 'x')
    assert.match(p, /output limit/i)
    assert.match(p, /try again/i)
  })
})

describe('OCR does not present a length-cut page as complete', () => {
  test('a cut page carries the English incompleteness note', () => {
    const t = tandaiBilaTerpotong('Line one\nLine two', 'length')
    assert.ok(t.startsWith('Line one\nLine two'))
    assert.ok(t.includes("[page text may be incomplete: the model's output limit was reached]"))
    assert.equal(OCR_INCOMPLETE_NOTE, "[page text may be incomplete: the model's output limit was reached]")
  })

  test('a cut page with NO text is just the note (never a silent empty page)', () => {
    assert.equal(tandaiBilaTerpotong('', 'length').trim(), OCR_INCOMPLETE_NOTE)
  })

  test('a finished page is untouched', () => {
    assert.equal(tandaiBilaTerpotong('Text', 'stop'), 'Text')
    assert.equal(tandaiBilaTerpotong('Text', undefined), 'Text')
  })

  test('ocrImage reads the finish reason through completeDetail', () => {
    const src = readFileSync('src/main/ocr.ts', 'utf8')
    assert.match(src, /completeDetail\(/)
    assert.match(src, /tandaiBilaTerpotong\(/)
  })
})

describe('background sub-call settings', () => {
  test('screenshot description cap is 3000, not 1200 (Muse reasons first)', () => {
    const src = readFileSync('src/main/tools/browser-tools.ts', 'utf8')
    assert.doesNotMatch(src, /parserModelId,\s*1200/)
    assert.match(src, /parserModelId,\s*3000/)
  })

  test('perspectives use the quick model (chatModelId), not the agent model', () => {
    const src = readFileSync('src/main/tools/perspektif-tools.ts', 'utf8')
    assert.match(src, /const model = loadConfig\(\)\.chatModelId/)
    assert.doesNotMatch(src, /loadConfig\(\)\.modelId/)
  })

  test('complete() logs model, finish reason, reasoning tokens and content size', () => {
    const src = readFileSync('src/main/llm/openai-compat.ts', 'utf8')
    for (const k of ['finishReason', 'reasoningTokens', 'contentChars', 'model']) assert.ok(src.includes(k), k)
  })
})
