import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { logger } from './logger'

// Secret disimpan terenkripsi via Windows DPAPI (safeStorage), terikat ke akun
// Windows user. Plaintext hanya hidup di memory main process saat dipakai.

// Key bebas (mis. 'llmApiKey', 'youApiKey', 'mcp:<server>:headers')
type SecretKey = string

function secretsPath(): string {
  return join(app.getPath('userData'), 'secrets.json')
}

function readStore(): Record<string, string> {
  try {
    if (existsSync(secretsPath())) {
      return JSON.parse(readFileSync(secretsPath(), 'utf-8'))
    }
  } catch {
    logger().warn('secrets store unreadable, starting empty')
  }
  return {}
}

export function setSecret(key: SecretKey, value: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption (DPAPI) is not available')
  }
  const store = readStore()
  store[key] = safeStorage.encryptString(value).toString('base64')
  const path = secretsPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(store, null, 2), 'utf-8')
}

export function getSecret(key: SecretKey): string | null {
  const store = readStore()
  const encrypted = store[key]
  if (!encrypted) return null
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  } catch {
    logger().warn({ key }, 'failed to decrypt secret')
    return null
  }
}

export function hasSecret(key: SecretKey): boolean {
  return getSecret(key) !== null
}

export function deleteSecret(key: SecretKey): void {
  const store = readStore()
  if (!(key in store)) return
  delete store[key]
  writeFileSync(secretsPath(), JSON.stringify(store, null, 2), 'utf-8')
}
