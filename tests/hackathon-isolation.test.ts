import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { isLocalDb } from '../src/main/hackathon/local-db'
import { dbTools } from '../src/main/tools/db-tools'
import { menuUntuk } from '../src/main/auth/roles'
import type { ToolContext } from '../src/main/tools/types'

const src = (p: string): string => readFileSync(p, 'utf8')

function envValue(name: string): string {
  const line = src('.env').split(/\r?\n/).find((l) => l.startsWith(`${name}=`))
  return line ? line.slice(name.length + 1).trim() : ''
}

describe('hackathon isolation: no path to a production database', () => {
  test('every app pool calls assertLocalDb before connecting', () => {
    assert.match(src('src/main/sales/db.ts'), /assertLocalDb\(BUNDLED\.salesDb, 'AIRA_SALES_DB'\)/)
    assert.match(src('src/main/auth/db.ts'), /assertLocalDb\(BUNDLED\.loginDb, 'AIRA_LOGIN_DB'\)/)
  })

  test('Master Data pool calls assertLocalDb before connecting', () => {
    assert.match(src('src/main/masterdata/db.ts'), /assertLocalDb\(BUNDLED\.innoDb, 'AIRA_INNO_DB'\)/)
  })

  test('db_query refuses a non-local host before any network attempt', async () => {
    const dbQuery = dbTools.find((t) => t.name === 'db_query')!
    const started = Date.now()
    await assert.rejects(
      dbQuery.execute({ connectionString: 'postgresql://a:b@10.255.255.1/x', query: 'select 1' }, {} as ToolContext),
      /is not local/
    )
    assert.ok(Date.now() - started < 500, 'guard must run before connecting')
  })

  test('.env points all three databases at localhost', () => {
    for (const name of ['AIRA_SALES_DB', 'AIRA_LOGIN_DB', 'AIRA_INNO_DB']) {
      assert.equal(isLocalDb(envValue(name)), true, name)
    }
  })

  test('app identity is separate from the installed AIRA', () => {
    assert.equal(JSON.parse(src('package.json')).name, 'aira-hackathon')
    assert.match(src('electron-builder.yml'), /^appId: ai\.aira\.hackathon$/m)
  })

  test('Microsoft 365 menu is hidden, data menus stay', () => {
    const menus = menuUntuk({ role: 'super_admin', divisi: [] }, {})
    assert.ok(!menus.includes('onedrive'))
    for (const m of ['sales', 'masterdata', 'lab'] as const) assert.ok(menus.includes(m), m)
  })

  test('auto-update never starts in this build', () => {
    assert.match(src('src/main/update/service.ts'), /UPDATES_DISABLED/)
  })
})

describe('app start refuses a non-local database before anything else runs', () => {
  test('index.ts checks every DB variable first thing in whenReady and exits on failure', () => {
    const s = src('src/main/index.ts')
    const ready = s.indexOf('app.whenReady().then(')
    const check = s.indexOf('checkLocalDbs(', ready)
    const splash = s.indexOf('showSplash()', ready)
    assert.ok(check > ready && check < splash, 'checkLocalDbs must run before showSplash')
    assert.match(s.slice(check, splash), /AIRA_INNO_DB: BUNDLED\.innoDb/)
    assert.match(s.slice(check, splash), /app\.exit\(1\)/)
  })
})
