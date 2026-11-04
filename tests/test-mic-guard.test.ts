import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { fakeMicActive, FAKE_MIC_WARNING } from '../src/shared/test-mic'

const src = (p: string): string => readFileSync(p, 'utf8')

// Found 3 Nov 2026: the app was left running with Chromium's fake-microphone switches from a test, so every voice
// turn heard the same recording ("What were sales last month?") instead of the user. Never silent again.

describe('fake microphone guard', () => {
  test('either Chromium fake-audio switch counts', () => {
    assert.equal(fakeMicActive((s) => s === 'use-file-for-fake-audio-capture'), true)
    assert.equal(fakeMicActive((s) => s === 'use-fake-device-for-media-stream'), true)
    assert.equal(fakeMicActive(() => false), false)
  })

  test('the warning says what is wrong and what to do, in English', () => {
    assert.match(FAKE_MIC_WARNING, /test recording/i)
    assert.match(FAKE_MIC_WARNING, /not your microphone/i)
    assert.match(FAKE_MIC_WARNING, /restart AIRA/i)
  })

  test('main logs it at start and tells the renderer; the mascot shows it while it lasts', () => {
    assert.match(src('src/main/index.ts'), /fakeMicActive\(\(s\) => app\.commandLine\.hasSwitch\(s\)\)/)
    const ipc = src('src/main/ipc.ts')
    const i = ipc.indexOf('IPC_CHANNELS.voiceTestMic,')
    assert.ok(i > 0, 'voiceTestMic handler')
    assert.match(src('src/preload/index.ts'), /voiceTestMic: \(\): Promise<boolean>/)
    const m = src('src/renderer/src/components/mascot/Mascot.tsx')
    assert.match(m, /window\.aira\.voiceTestMic\(\)/)
    assert.match(m, /FAKE_MIC_WARNING/)
  })
})
