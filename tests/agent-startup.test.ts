import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { runStartup, ASK_NAME, NAME_MISSED, type StartupDeps } from '../src/renderer/src/components/agent/startup'

const src = (p: string): string => readFileSync(p, 'utf8')

function deps(over: Partial<StartupDeps> & { name?: string | null; heard?: string; briefed?: boolean } = {}) {
  const log: string[] = []
  let stored: string | null = over.name ?? null
  let briefed = over.briefed ?? false
  const d: StartupDeps = {
    getName: async () => stored,
    setName: async (n) => {
      stored = n
      log.push(`setName:${n}`)
    },
    speak: async (t) => void log.push(`speak:${t}`),
    listenForName: async () => over.heard ?? '',
    getBriefing: async () => 'Order 4 boxes of KRAS today.',
    briefedToday: () => briefed,
    markBriefed: () => {
      briefed = true
      log.push('markBriefed')
    },
    muted: () => false,
    hour: () => 8,
    listen: async () => void log.push('listen'),
    showText: (t) => void log.push(`show:${t}`),
    ...over
  }
  return { d, log }
}

describe('startup sequence', () => {
  test('first start: asks the name, remembers it, greets with the briefing, then listens', async () => {
    const { d, log } = deps({ heard: 'Call me Rangga.' })
    await runStartup(d)
    assert.deepEqual(log, [
      `speak:${ASK_NAME}`,
      'setName:Rangga',
      'speak:Nice to meet you, Rangga.',
      'markBriefed',
      'speak:Good morning, Rangga. Order 4 boxes of KRAS today. What can I help you with?',
      'listen'
    ])
  })

  test('name known and briefed today: one greeting without the briefing, then listen', async () => {
    const { d, log } = deps({ name: 'Rangga', briefed: true })
    await runStartup(d)
    assert.deepEqual(log, ['speak:Good morning, Rangga. What can I help you with?', 'listen'])
  })

  test('muted: shown as text only — nothing spoken, no microphone', async () => {
    const { d, log } = deps({ name: 'Rangga', muted: () => true })
    await runStartup(d)
    assert.equal(log.filter((l) => l.startsWith('speak') || l === 'listen').length, 0)
    assert.ok(log.some((l) => l.startsWith('show:Good morning, Rangga. Order 4 boxes')), log.join(' | '))
  })

  test('a name that cannot be read: says so and greets without a name', async () => {
    const { d, log } = deps({ heard: 'yes' })
    await runStartup(d)
    assert.ok(log.includes(`speak:${NAME_MISSED}`))
    assert.ok(!log.some((l) => l.startsWith('setName')))
    assert.ok(log.some((l) => l.startsWith('speak:Good morning. ')))
  })

  test('a failed briefing still greets', async () => {
    const { d, log } = deps({ name: 'Rangga', getBriefing: async () => null })
    await runStartup(d)
    assert.ok(log.includes('speak:Good morning, Rangga. What can I help you with?'))
  })
})

describe('wiring', () => {
  test('Home runs the startup sequence once per user per app start', () => {
    const home = src('src/renderer/src/views/Home.tsx')
    assert.match(home, /runStartup\(/)
    assert.match(home, /startupOnce\(/)
    assert.match(home, /requestVoiceTurn\(\{ auto: true, purpose: 'name' \}\)/)
    assert.match(home, /requestVoiceTurn\(\{ auto: true, purpose: 'request' \}\)/)
  })

  test('Settings lets the user change the name AIRA calls them', () => {
    const s = src('src/renderer/src/views/Settings.tsx')
    assert.match(s, /What should AIRA call you\?/)
    assert.match(s, /window\.aira\.agentNameSet\(/)
  })
})

describe('what the startup sequence shows reaches the Home that is on screen', () => {
  // Found in the app: React dev mounts Home twice and the sequence runs once, in the first (unmounted) mount —
  // its greeting and briefing never reached the card.
  test('a value published before the screen subscribes is still delivered, and later ones too', async () => {
    const { latest } = await import('../src/renderer/src/components/agent/startup')
    const store = latest<string>()
    store.publish('Good morning, Rangga.')
    const got: string[] = []
    const off = store.subscribe((v) => got.push(v))
    store.publish('second')
    off()
    store.publish('after unsubscribe')
    assert.deepEqual(got, ['Good morning, Rangga.', 'second'])
  })

  test('Home shows the greeting and the briefing through the shared stores', () => {
    const home = src('src/renderer/src/views/Home.tsx')
    assert.match(home, /startupGreeting\.subscribe\(/)
    assert.match(home, /startupBriefing\.subscribe\(/)
    assert.match(home, /showText: \(t\) => startupGreeting\.publish\(t\)/)
  })
})
