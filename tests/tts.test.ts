import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { AIRA_VOICE_ID, TTS_MODEL, MAX_TTS_CHARS, ttsRequest, createTts, explainTtsError } from '../src/main/suara/tts'

const src = (p: string): string => readFileSync(p, 'utf8')

function streamOf(...chunks: number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(new Uint8Array(ch))
      c.close()
    }
  })
}

describe('AIRA voice = ElevenLabs', () => {
  test('a good voice on the newest model, English, numbers read naturally', () => {
    assert.equal(TTS_MODEL, 'eleven_v4')
    assert.equal(AIRA_VOICE_ID, 'EXAVITQu4vr4xnSDxMaL') // Sarah — warm, clear assistant voice
    const r = ttsRequest('  Order 4 boxes of KRAS today.  ')
    assert.equal(r.text, 'Order 4 boxes of KRAS today.')
    assert.equal(r.modelId, 'eleven_v4')
    assert.equal(r.languageCode, 'en')
    assert.equal(r.applyTextNormalization, 'on')
    assert.equal(r.outputFormat, 'mp3_44100_128')
    // Eleven v4 takes only stability and similarity boost.
    assert.deepEqual(Object.keys(r.voiceSettings ?? {}).sort(), ['similarityBoost', 'stability'])
  })

  test('the text is capped, so one reply never burns many credits', () => {
    assert.ok(ttsRequest('a'.repeat(5000)).text.length <= MAX_TTS_CHARS)
  })
})

describe('speaking through the SDK', () => {
  test('audio chunks are joined into one mp3, and the same text is not paid for twice', async () => {
    const calls: Array<[string, string]> = []
    const tts = createTts(async (voice, req) => {
      calls.push([voice, req.text])
      return streamOf([1, 2], [3])
    })
    const a = await tts('Hello there.')
    assert.deepEqual([...a], [1, 2, 3])
    await tts('Hello there.')
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], AIRA_VOICE_ID)
  })

  test('empty text is refused before any call', async () => {
    let called = false
    const tts = createTts(async () => ((called = true), streamOf([1])))
    await assert.rejects(tts('   '), /Nothing to say/)
    assert.equal(called, false)
  })

  test('errors say what to fix', () => {
    assert.match(explainTtsError({ statusCode: 401, body: { detail: { message: 'The API key you used is missing the permission text_to_speech to execute this operation.' } } }), /text_to_speech permission/)
    assert.match(explainTtsError({ statusCode: 401 }), /ElevenLabs key/)
    assert.match(explainTtsError({ statusCode: 429 }), /limit|quota/i)
    assert.match(explainTtsError(new TypeError('fetch failed')), /reach ElevenLabs/)
  })
})

describe('the key stays out of the code and out of the renderer', () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f)
      return statSync(p).isDirectory() ? files(p) : [p]
    })
  }

  test('no ElevenLabs key literal anywhere in src', () => {
    for (const f of files('src')) assert.doesNotMatch(src(f), /\bsk_[A-Za-z0-9]{20,}/, f)
  })

  test('the build reads ELEVENLABS_API_KEY from .env.local into the main process only', () => {
    const cfg = src('electron.vite.config.ts')
    // Vite's loadEnv reads .env and .env.local (where the ElevenLabs onboarding put the key).
    assert.match(cfg, /loadEnv\(mode, process\.cwd\(\), ''\)/)
    assert.match(cfg, /__BUNDLED_ELEVENLABS_KEY__: JSON\.stringify\(env\.ELEVENLABS_API_KEY \?\? ''\)/)
    const renderer = files('src/renderer').map(src).join('\n')
    assert.doesNotMatch(renderer, /ELEVENLABS_API_KEY|elevenlabs-js/)
  })

  test('the SDK reads the key from the environment', () => {
    const t = src('src/main/suara/tts.ts')
    assert.match(t, /process\.env\.ELEVENLABS_API_KEY/)
    assert.match(t, /new ElevenLabsClient\(\)/)
  })

  test('the speech channel needs a login and validates its input', () => {
    const ipc = src('src/main/ipc.ts')
    const i = ipc.indexOf('IPC_CHANNELS.speechSynthesize,')
    assert.ok(i > 0, 'speechSynthesize handler')
    const h = ipc.slice(i, ipc.indexOf('ipcMain.handle(', i + 10))
    assert.match(h, /wajibLogin\(\)/)
    assert.match(h, /z\.string\(\)\.trim\(\)\.min\(1\)\.max\((\d+|MAX_TTS_CHARS)\)/)
  })

  test('the page may play the audio blob the main process sends', () => {
    assert.match(src('src/renderer/index.html'), /media-src 'self' blob:/)
  })
})
