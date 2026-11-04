import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { routePrompt, routeRequest } from '../src/main/agent-voice/route'
import { allowedTargets } from '../src/shared/agent-actions'
import { ConfigSchema } from '../src/main/config'

const src = (p: string): string => readFileSync(p, 'utf8')
const handler = (s: string, ch: string): string => {
  const i = s.indexOf(`IPC_CHANNELS.${ch},`)
  return i < 0 ? '' : s.slice(i, s.indexOf('ipcMain.handle(', i + 10))
}
const ALL = ['sales', 'masterdata', 'lab', 'reagent']

describe('Muse Spark picks one action', () => {
  test('a clean JSON reply is used', async () => {
    const r = await routeRequest('check the reagents', { menu: ALL, current: 'general', complete: async () => '{"action":"reagent","step":"run"}' })
    assert.deepEqual(r.action, { action: 'reagent', step: 'run' })
    assert.equal(r.source, 'muse')
    assert.equal(r.say, "Opening Reagent Check and running this month's check.")
  })

  test('JSON wrapped in prose or a code fence is still read', async () => {
    const r = await routeRequest('open sales', { menu: ALL, current: 'general', complete: async () => 'Sure! ```json\n{"action":"open","screen":"sales"}\n```' })
    assert.deepEqual(r.action, { action: 'open', screen: 'sales' })
    assert.equal(r.source, 'muse')
  })

  test('a menu the user may not open is never chosen', async () => {
    const r = await routeRequest('open the TAT screen', { menu: ['sales'], current: 'general', complete: async () => '{"action":"open","screen":"lab"}' })
    // Refused → none (review fix 1), not a chat in another menu.
    assert.deepEqual(r.action, { action: 'none' })
  })

  test('Muse failing: keywords, then "ask in the current menu" — the request is never lost', async () => {
    const boom = async (): Promise<string> => {
      throw new Error('network')
    }
    const k = await routeRequest('show me the reorder list', { menu: ALL, current: 'general', complete: boom })
    assert.deepEqual(k.action, { action: 'reagent', step: 'reorder' })
    assert.equal(k.source, 'keywords')
    const f = await routeRequest('tell me a joke', { menu: ALL, current: 'sales', complete: async () => 'not json' })
    assert.deepEqual(f.action, { action: 'ask', menu: 'sales', question: 'tell me a joke' })
    assert.equal(f.source, 'fallback')
  })

  test('the prompt lists only permitted menus, asks for one JSON object, offers no export/delete/send', () => {
    const p = routePrompt('hello', allowedTargets(['sales', 'reagent']))
    assert.match(p, /sales/)
    assert.match(p, /reagent/)
    assert.doesNotMatch(p, /"masterdata"|"lab"/)
    assert.match(p, /Reply with ONE JSON object only/)
    assert.match(p, /Always answer in English/)
    assert.doesNotMatch(p, /"(export|delete|send)"/)
  })
})

describe('call names and routing over IPC', () => {
  const ipc = src('src/main/ipc.ts')

  test('the name is stored per account in the config', () => {
    assert.deepEqual(ConfigSchema.parse({}).callNames, {})
    assert.equal(ConfigSchema.safeParse({ callNames: { ana: 'A'.repeat(25) } }).success, false)
  })

  test('handlers need a login and validate their input', () => {
    for (const ch of ['agentNameGet', 'agentNameSet', 'agentRoute']) assert.match(handler(ipc, ch), /wajibLogin\(\)/, ch)
    assert.match(handler(ipc, 'agentNameSet'), /z\.string\(\)\.trim\(\)\.min\(1\)\.max\(24\)\.nullable\(\)/)
    const route = handler(ipc, 'agentRoute')
    assert.match(route, /z\.string\(\)\.trim\(\)\.min\(1\)\.max\(500\)/)
    assert.match(route, /z\.enum\(\[\.\.\.DATA_MENUS, 'general'\]\)/)
    const m = /completeDetail\([\s\S]*?MUSE\.quick,\s*(\d+)\)/.exec(route)
    assert.ok(m && Number(m[1]) >= 2000, m?.[1])
  })

  test('preload exposes the three calls', () => {
    const p = src('src/preload/index.ts')
    assert.match(p, /agentNameGet: \(\): Promise<string \| null>/)
    assert.match(p, /agentNameSet: \(name: string \| null\): Promise<string \| null>/)
    assert.match(p, /agentRoute: \(text: string, current: string\): Promise<AgentRouteResult>/)
  })
})
