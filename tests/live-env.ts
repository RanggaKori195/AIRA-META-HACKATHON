// Live-check helper: the ONE way a live-check gets a database connection string.
// Hackathon build: the value is checked by assertLocalDb, so a live-check can never run against production.
import { readFileSync } from 'fs'
import { assertLocalDb } from '../src/main/hackathon/local-db'

type DbVar = 'AIRA_SALES_DB' | 'AIRA_LOGIN_DB' | 'AIRA_INNO_DB'

function fromEnvFile(name: DbVar): string | null {
  const line = readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`))
  const value = line?.slice(name.length + 1).trim()
  return value ? value : null
}

export function envDb(name: DbVar): string {
  const value = fromEnvFile(name) ?? (name === 'AIRA_LOGIN_DB' ? fromEnvFile('AIRA_SALES_DB') : null)
  if (!value) {
    console.error(`${name} is missing from .env`)
    process.exit(1)
  }
  try {
    assertLocalDb(value, name)
  } catch (err) {
    console.error((err as Error).message)
    process.exit(1)
  }
  return value
}
