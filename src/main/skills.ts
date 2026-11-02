import { app } from 'electron'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { logger } from './logger'

// Skill = satu folder berisi SKILL.md (frontmatter name/description + isi instruksi).
// Pola progressive disclosure: hanya nama + deskripsi yang masuk system prompt,
// isi lengkapnya dibaca lewat tool load_skill saat memang dibutuhkan. Dengan begitu
// puluhan skill pun tidak membengkakkan context.

export interface SkillInfo {
  name: string
  description: string
  path: string
}

const MAX_SKILL_CHARS = 40_000

function skillRoots(): string[] {
  const roots = [
    join(app.getAppPath(), 'skills'), // mode dev
    join(process.resourcesPath ?? '', 'skills'), // hasil packaging
    join(app.getPath('userData'), 'skills') // ditambahkan user/tim tanpa rebuild
  ]
  return [...new Set(roots)].filter((dir) => existsSync(dir))
}

/** Parser frontmatter sederhana: cukup untuk `name:` dan `description:`. */
function parseFrontmatter(raw: string): { name?: string; description?: string; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { body: raw }
  const meta: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_-]+)\s*:\s*(.*)$/)
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, '')
  }
  return { name: meta.name, description: meta.description, body: match[2] }
}

export function listSkills(): SkillInfo[] {
  const skills = new Map<string, SkillInfo>()
  for (const root of skillRoots()) {
    let entries: string[]
    try {
      entries = readdirSync(root)
    } catch {
      continue
    }
    for (const entry of entries) {
      const dir = join(root, entry)
      const file = join(dir, 'SKILL.md')
      try {
        if (!statSync(dir).isDirectory() || !existsSync(file)) continue
        const parsed = parseFrontmatter(readFileSync(file, 'utf-8'))
        const name = parsed.name ?? entry
        // Skill milik user (root terakhir) menimpa bawaan dengan nama sama.
        skills.set(name, {
          name,
          description: parsed.description ?? '(tanpa deskripsi)',
          path: file
        })
      } catch (err) {
        logger().warn({ dir, err: String(err) }, 'skill tidak bisa dibaca')
      }
    }
  }
  return [...skills.values()]
}

export function readSkill(name: string): string | null {
  const skill = listSkills().find((s) => s.name.toLowerCase() === name.toLowerCase())
  if (!skill) return null
  try {
    const parsed = parseFrontmatter(readFileSync(skill.path, 'utf-8'))
    return parsed.body.slice(0, MAX_SKILL_CHARS).trim()
  } catch (err) {
    logger().warn({ name, err: String(err) }, 'gagal membaca isi skill')
    return null
  }
}
