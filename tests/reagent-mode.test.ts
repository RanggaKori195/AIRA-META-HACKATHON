import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { DATA_GROUP_MENU, menuUntukGrup } from '../src/main/agent/data-groups'
import { groupOf, selectGroups, saranMenu } from '../src/main/agent/tool-groups'
import { modeSah } from '../src/shared/mode-chat'
import { MENU_LABELS } from '../src/main/auth/roles'
import { toolSpecs } from '../src/main/tools/registry'

const src = (p: string): string => readFileSync(p, 'utf8')

describe('Reagent Check mode and menu', () => {
  test('mode and menu are registered', () => {
    assert.equal(modeSah('reagent'), 'reagent')
    assert.equal(MENU_LABELS.reagent, 'Reagent Check')
    assert.equal(groupOf('reagent_reconcile'), 'reagent')
    assert.equal(groupOf('reagent_evidence'), 'reagent')
  })

  test('the reagent mode is locked to the reagent group, and only with permission', () => {
    assert.deepEqual([...selectGroups({ text: 'x', usedTools: [], mode: 'reagent', izinMenu: ['reagent'] })], ['reagent'])
    assert.deepEqual([...selectGroups({ text: 'x', usedTools: [], mode: 'reagent', izinMenu: [] })], ['core'])
  })

  test('reagent tools never come back through used tools in New Task', () => {
    const g = selectGroups({ text: 'hello', usedTools: ['reagent_reconcile'], mode: 'general', izinMenu: ['reagent'] })
    assert.ok(!g.has('reagent'))
  })

  test('no wrong-menu redirect inside Reagent Check', () => {
    assert.equal(saranMenu('what were sales last month?', 'reagent'), null)
  })
})

describe('execution-layer permission covers every data group', () => {
  test('each data group maps to its menu, other groups to none', () => {
    for (const [g, m] of Object.entries(DATA_GROUP_MENU)) assert.equal(menuUntukGrup(g as never), m, g)
    for (const g of ['core', 'dev', 'browser', 'data', 'mcp', 'db'] as const) assert.equal(menuUntukGrup(g), null, g)
  })

  test('every group a registered tool belongs to is either a data group or a known non-data group', () => {
    const nonData = new Set(['core', 'browser', 'dev', 'db', 'data', 'mcp'])
    for (const spec of toolSpecs()) {
      const name = (spec as { function: { name: string } }).function.name
      const g = groupOf(name)
      assert.ok(nonData.has(g) || g in DATA_GROUP_MENU, `${name} → ${g} is not covered by DATA_GROUP_MENU`)
    }
  })

  test('tolakBilaTakBerizin is table-driven', () => {
    const s = src('src/main/agent/orchestrator.ts')
    const fn = s.slice(s.indexOf('function tolakBilaTakBerizin'), s.indexOf('function skillSection'))
    assert.match(fn, /menuUntukGrup\(/)
    assert.doesNotMatch(fn, /grup !== 'sales' && grup !== 'inno'/)
  })
})
