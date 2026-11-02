import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { LEGACY_MASTERDATA_ID, SQL_RENAME_MASTERDATA_MENU } from '../src/main/auth/schema'

// Public-repo rename: stored Master Data ids (access matrix in Postgres, conversations and schedules in SQLite)
// are migrated, so old conversations keep their menu and the matrix keeps its ticks.

test('access-matrix rows are renamed in all three menu tables, idempotently', () => {
  assert.equal(LEGACY_MASTERDATA_ID.length, 10)
  assert.equal(SQL_RENAME_MASTERDATA_MENU.length, 3)
  for (const sql of SQL_RENAME_MASTERDATA_MENU) {
    assert.match(sql, /^UPDATE tb_menu_\w+ SET menu = 'masterdata' WHERE menu = '/)
    assert.ok(sql.includes(`'${LEGACY_MASTERDATA_ID}'`))
  }
  assert.match(readFileSync('src/main/auth/schema.ts', 'utf8'), /for \(const sql of SQL_RENAME_MASTERDATA_MENU\) await exec\(sql\)/)
})

test('SQLite migration renames the mode of saved conversations and schedules', () => {
  const s = readFileSync('src/main/db.ts', 'utf8')
  assert.match(s, /UPDATE sessions SET mode = 'masterdata' WHERE mode = /)
  assert.match(s, /UPDATE jadwal SET mode = 'masterdata' WHERE mode = /)
})
