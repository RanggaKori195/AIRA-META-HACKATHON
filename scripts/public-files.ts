// Which tracked files belong in the public repository. The private ones describe the company's production
// setup (handoff notes, internal plans, local agent settings) and stay in this working copy only; the public
// repository is cut from `publicFiles()`.
import { execFileSync } from 'child_process'

export const PRIVATE_FILES: RegExp[] = [
  /^HANDOFF\.md(\.bak)?$/,
  /^CLAUDE\.md$/,
  /^SOUL\.md$/,
  /^RANCANGAN-.*\.md$/,
  /^RENCANA-.*\.md$/,
  /^\.claude\//,
  /^coba-pdf-tmp\.cjs$/,
  /^docs\/superpowers\//
]

export const isPrivate = (path: string): boolean => PRIVATE_FILES.some((re) => re.test(path))

/** Tracked files minus the private ones (paths with forward slashes, relative to the repo root). */
export function publicFiles(): string[] {
  return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s && !isPrivate(s))
}
