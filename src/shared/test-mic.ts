// Guard against a test launch left running: with Chromium's fake-microphone switches every voice turn hears the same
// recording instead of the user (happened 3 Nov 2026 — AIRA kept "hearing" "What were sales last month?").
// Pure — tests/test-mic-guard.test.ts. Main checks its command line; the mascot shows the warning while it lasts.

export const FAKE_MIC_SWITCHES = ['use-file-for-fake-audio-capture', 'use-fake-device-for-media-stream'] as const

export const FAKE_MIC_WARNING =
  'Test microphone is on: AIRA hears a test recording, not your microphone. Close AIRA and restart AIRA normally to talk.'

export function fakeMicActive(hasSwitch: (name: string) => boolean): boolean {
  return FAKE_MIC_SWITCHES.some((s) => hasSwitch(s))
}
