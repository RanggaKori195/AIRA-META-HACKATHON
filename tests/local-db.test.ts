import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { assertLocalDb, checkLocalDbs, isLocalDb, LOCAL_HOSTS } from '../src/main/hackathon/local-db'

describe('assertLocalDb: hackathon build only talks to a local database', () => {
  test('accepts localhost in every common form', () => {
    for (const cs of [
      'postgresql://postgres:123@localhost:5432/metahackton',
      'postgres://u:p@127.0.0.1/x',
      'postgresql://u:p@[::1]:5432/x',
      'postgresql://u:p@LOCALHOST/x'
    ]) {
      assert.equal(isLocalDb(cs), true, cs)
      assert.doesNotThrow(() => assertLocalDb(cs, 'TEST'), cs)
    }
  })

  test('refuses production hosts, host overrides, and unparsable strings', () => {
    for (const cs of [
      'postgresql://adm:x@10.0.0.20:5455/dbSalesRepository',
      'mysql://u:p@10.0.0.10/inno_collection',
      'postgresql://u:p@localhost/x?host=10.0.0.5',
      '',
      'not a url'
    ]) {
      assert.equal(isLocalDb(cs), false, cs)
      assert.throws(() => assertLocalDb(cs, 'TEST'), /is not local/, cs)
    }
  })

  test('error names the variable and the host', () => {
    assert.throws(
      () => assertLocalDb('postgresql://a:b@10.1.1.1/x', 'AIRA_SALES_DB'),
      /AIRA_SALES_DB: database host "10\.1\.1\.1" is not local/
    )
    assert.throws(() => assertLocalDb('not a url', 'AIRA_INNO_DB'), /AIRA_INNO_DB: database host "\(unparsable\)"/)
  })

  test('the allow-list is exactly the three loopback names', () => {
    assert.deepEqual([...LOCAL_HOSTS], ['localhost', '127.0.0.1', '::1'])
  })
})

describe('assertLocalDb: pg reads the LAST host parameter', () => {
  test('a repeated host parameter cannot smuggle in a remote host', () => {
    const cs = 'postgresql://u@localhost/db?host=localhost&host=10.0.0.20'
    assert.equal(isLocalDb(cs), false)
    assert.throws(() => assertLocalDb(cs, 'TEST'), /database host "10\.0\.0\.20" is not local/)
  })
})

describe('checkLocalDbs: all three database variables are checked at app start', () => {
  test('returns one message per non-local variable, naming it', () => {
    const errs = checkLocalDbs({
      AIRA_SALES_DB: 'postgresql://postgres:123@localhost:5432/metahackton',
      AIRA_LOGIN_DB: 'postgresql://postgres:123@localhost:5432/metahackton',
      AIRA_INNO_DB: 'mysql://u:p@10.0.0.10/inno_collection'
    })
    assert.equal(errs.length, 1)
    assert.match(errs[0], /^AIRA_INNO_DB: database host "10\.0\.0\.10" is not local/)
  })

  test('an empty variable is "not configured", not an error', () => {
    assert.deepEqual(checkLocalDbs({ AIRA_SALES_DB: '', AIRA_LOGIN_DB: '', AIRA_INNO_DB: '' }), [])
  })
})
