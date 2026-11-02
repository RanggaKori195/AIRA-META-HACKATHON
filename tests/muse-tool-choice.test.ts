import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { chatRequestBody, FORCE_TOOL_NUDGE } from '../src/main/llm/openai-compat'
import { toolChoiceUntuk } from '../src/main/agent/sales-guard'

// Measured 2 Nov 2026: the Meta Model API accepts only tool_choice "auto" — "required"/"none" return HTTP 400.
// The guards that force a tool (anti-hallucination, history, false-refusal recovery) must not break the turn.
const TOOLS = [{ type: 'function', function: { name: 'sales_summary', parameters: { type: 'object', properties: {} } } }]
const MSGS = [{ role: 'user' as const, content: 'sales this month' }]

describe('chat request body on the Meta Model API', () => {
  test('tool_choice is always "auto"', () => {
    for (const toolChoice of ['auto', 'required'] as const) {
      const b = chatRequestBody(MSGS, { model: 'm', tools: TOOLS, toolChoice }, 'https://api.meta.ai')
      assert.equal(b.tool_choice, 'auto', toolChoice)
    }
  })

  test('"required" becomes a closing instruction to call a tool', () => {
    const b = chatRequestBody(MSGS, { model: 'm', tools: TOOLS, toolChoice: 'required' }, 'https://api.meta.ai')
    const msgs = b.messages as Array<{ role: string; content: string }>
    assert.equal(msgs.length, 2)
    assert.deepEqual(msgs.at(-1), { role: 'system', content: FORCE_TOOL_NUDGE })
    assert.equal(MSGS.length, 1, 'history passed in is not mutated')
  })

  test('"none" sends no tools at all', () => {
    const b = chatRequestBody(MSGS, { model: 'm', tools: TOOLS, toolChoice: 'none' }, 'https://api.meta.ai')
    assert.ok(!('tools' in b) && !('tool_choice' in b))
  })

  test('other OpenAI-compatible endpoints keep tool_choice as asked', () => {
    const b = chatRequestBody(MSGS, { model: 'm', tools: TOOLS, toolChoice: 'required' }, 'http://localhost:8000')
    assert.equal(b.tool_choice, 'required')
    assert.equal((b.messages as unknown[]).length, 1)
  })
})

describe('a greeting in a data menu gets no tools', () => {
  test('first iteration, data mode, pure greeting → none', () => {
    assert.equal(toolChoiceUntuk({ paksa: false, mode: 'sales', pertanyaan: 'hi, who are you?', iterasi: 0 }), 'none')
    assert.equal(toolChoiceUntuk({ paksa: false, mode: 'lab', pertanyaan: 'hello', iterasi: 0 }), 'none')
    assert.equal(toolChoiceUntuk({ paksa: false, mode: 'reagent', pertanyaan: 'hi, who are you?', iterasi: 0 }), 'none')
  })
  test('Reagent Check: a data question keeps its tools', () => {
    assert.equal(
      toolChoiceUntuk({ paksa: false, mode: 'reagent', pertanyaan: 'hi, which reagents are short today?', iterasi: 0 }),
      'auto'
    )
  })
  test('data questions, later iterations, forced calls and New Task are unchanged', () => {
    assert.equal(toolChoiceUntuk({ paksa: false, mode: 'sales', pertanyaan: 'hi, what were sales yesterday?', iterasi: 0 }), 'auto')
    assert.equal(toolChoiceUntuk({ paksa: false, mode: 'sales', pertanyaan: 'hi', iterasi: 1 }), 'auto')
    assert.equal(toolChoiceUntuk({ paksa: true, mode: 'sales', pertanyaan: 'hi', iterasi: 0 }), 'required')
    assert.equal(toolChoiceUntuk({ paksa: false, mode: 'general', pertanyaan: 'hi', iterasi: 0 }), 'auto')
  })
})

describe('"none" tells the model to answer directly', () => {
  test('a closing instruction says no tools are needed', async () => {
    const { NO_TOOLS_NUDGE } = await import('../src/main/llm/openai-compat')
    const b = chatRequestBody(MSGS, { model: 'm', tools: TOOLS, toolChoice: 'none' }, 'https://api.meta.ai')
    assert.deepEqual((b.messages as unknown[]).at(-1), { role: 'system', content: NO_TOOLS_NUDGE })
    assert.match(NO_TOOLS_NUDGE, /do not (say|mention).*(fetch|pull|look up)/i)
  })
})

describe('review #1: only a WHOLE greeting gets no tools', () => {
  const tc = (pertanyaan: string, mode = 'sales') => toolChoiceUntuk({ paksa: false, mode, pertanyaan, iterasi: 0 })
  test('pure greetings / small talk → none', () => {
    for (const s of ['hi', 'Hello!', 'hi, who are you?', 'who are you?', 'what can you do?', 'good morning', 'thanks', 'halo', 'siapa kamu?']) {
      assert.equal(tc(s), 'none', s)
    }
  })
  test('a follow-up that starts with a courtesy word keeps its tools', () => {
    for (const s of [
      'great, now break it down by payer',
      'ok, and the top 5?',
      'okay, what about Surabaya?',
      'thanks! and for Jakarta?',
      'cool, show it as a chart',
      'hi, what about RSUP Kariadi?',
      'oke, kalau Surabaya?',
      'makasih, sekarang per penjamin'
    ]) {
      assert.equal(tc(s), 'auto', s)
    }
  })
})
