import { spawn, execFile, type ChildProcess } from 'child_process'
import { logger } from '../logger'

// Manajemen proses background (dev server, watcher, script panjang) ala Claude Code.
// Semua proses dimatikan saat aplikasi ditutup — tidak ada proses yatim.

const MAX_OUTPUT_LINES = 500
const MAX_PROCESSES = 10

export interface ManagedProcess {
  id: string
  command: string
  cwd: string
  child: ChildProcess
  output: string[]
  startedAt: number
  exitCode: number | null
}

const processes = new Map<string, ManagedProcess>()
let counter = 0

function appendOutput(proc: ManagedProcess, chunk: Buffer): void {
  const lines = chunk.toString('utf-8').split('\n')
  for (const line of lines) {
    if (line.trim().length === 0) continue
    proc.output.push(line.slice(0, 500))
    if (proc.output.length > MAX_OUTPUT_LINES) proc.output.shift()
  }
}

export function startProcess(command: string, cwd: string): ManagedProcess {
  const active = [...processes.values()].filter((p) => p.exitCode === null)
  if (active.length >= MAX_PROCESSES) {
    throw new Error(`maksimum ${MAX_PROCESSES} proses background — hentikan yang lama dulu (stop_process)`)
  }
  const id = `p${++counter}`
  const child = spawn(command, { cwd, shell: true, windowsHide: true })
  const proc: ManagedProcess = {
    id,
    command,
    cwd,
    child,
    output: [],
    startedAt: Date.now(),
    exitCode: null
  }
  child.stdout?.on('data', (chunk: Buffer) => appendOutput(proc, chunk))
  child.stderr?.on('data', (chunk: Buffer) => appendOutput(proc, chunk))
  child.on('exit', (code) => {
    proc.exitCode = code ?? -1
    logger().info({ id, code }, 'background process exited')
  })
  child.on('error', (err) => {
    proc.exitCode = -1
    proc.output.push(`[spawn error] ${err.message}`)
  })
  processes.set(id, proc)
  logger().info({ id, command }, 'background process started')
  return proc
}

export function listProcesses(): Array<{
  id: string
  command: string
  running: boolean
  exitCode: number | null
  uptimeMs: number
  lastOutput: string[]
}> {
  return [...processes.values()].map((p) => ({
    id: p.id,
    command: p.command.slice(0, 120),
    running: p.exitCode === null,
    exitCode: p.exitCode,
    uptimeMs: Date.now() - p.startedAt,
    lastOutput: p.output.slice(-3)
  }))
}

export function readProcessOutput(
  id: string,
  tail: number
): { id: string; running: boolean; exitCode: number | null; output: string[] } | null {
  const proc = processes.get(id)
  if (!proc) return null
  return {
    id,
    running: proc.exitCode === null,
    exitCode: proc.exitCode,
    output: proc.output.slice(-tail)
  }
}

export function stopProcess(id: string): boolean {
  const proc = processes.get(id)
  if (!proc) return false
  if (proc.exitCode !== null) return true
  const pid = proc.child.pid
  if (pid) {
    // /T = beserta child tree — dev server biasanya spawn anak proses.
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => undefined)
  }
  return true
}

export function killAll(): void {
  for (const id of processes.keys()) stopProcess(id)
}
