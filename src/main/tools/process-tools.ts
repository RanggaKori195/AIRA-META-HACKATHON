import { resolveInBoundary } from './boundary'
import { ToolError, type ToolDefinition } from './types'
import { listProcesses, readProcessOutput, startProcess, stopProcess } from './process-manager'
import { assertNotBrowserLaunch } from './command-guard'

// Tools proses background: start (lewat run_command background=true di fs-tools),
// pantau output, dan hentikan.

export const processTools: ToolDefinition[] = [
  {
    name: 'run_background',
    label: 'Run in Background',
    description:
      'Menjalankan perintah yang HIDUP TERUS di background (dev server, watcher, script panjang). ' +
      'Mengembalikan processId — pantau outputnya dengan check_process, hentikan dengan stop_process. ' +
      'Untuk perintah yang selesai sendiri, gunakan run_command biasa.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Perintah shell' },
        cwd: { type: 'string', description: 'Working directory (harus di dalam folder akses)' }
      },
      required: ['command', 'cwd']
    },
    tier: 'execute',
    summarize: (a) => `Background: ${a.command}  (in ${a.cwd})`,
    execute: async (args, ctx) => {
      const command = args.command
      if (typeof command !== 'string' || !command.trim()) {
        throw new ToolError('argumen "command" wajib berupa string')
      }
      assertNotBrowserLaunch(command)
      const cwd = resolveInBoundary(String(args.cwd ?? ''), ctx.allowedDirs)
      try {
        const proc = startProcess(command, cwd)
        return JSON.stringify({
          processId: proc.id,
          note: 'proses jalan di background — cek dengan check_process, hentikan dengan stop_process'
        })
      } catch (err: any) {
        throw new ToolError(err?.message ?? 'gagal memulai proses')
      }
    }
  },
  {
    name: 'check_process',
    label: 'Check Process',
    description:
      'Melihat status & output proses background. Tanpa processId: daftar semua proses. ' +
      'Dengan processId: output terakhir proses itu.',
    parameters: {
      type: 'object',
      properties: {
        processId: { type: 'string', description: 'ID proses (opsional)' },
        tail: { type: 'number', description: 'Jumlah baris output terakhir (default 50)' }
      }
    },
    tier: 'read',
    summarize: (a) => (a.processId ? `Check process ${a.processId}` : 'Background process list'),
    execute: async (args) => {
      if (typeof args.processId === 'string' && args.processId) {
        const tail = Math.min(Math.max(Number(args.tail) || 50, 1), 300)
        const result = readProcessOutput(args.processId, tail)
        if (!result) throw new ToolError(`proses "${args.processId}" tidak ditemukan`)
        return JSON.stringify(result)
      }
      return JSON.stringify({ processes: listProcesses() })
    }
  },
  {
    name: 'stop_process',
    label: 'Stop Process',
    description: 'Menghentikan proses background beserta child process-nya.',
    parameters: {
      type: 'object',
      properties: { processId: { type: 'string' } },
      required: ['processId']
    },
    tier: 'write',
    summarize: (a) => `Stop process ${a.processId}`,
    execute: async (args) => {
      const id = args.processId
      if (typeof id !== 'string' || !id) throw new ToolError('argumen "processId" wajib')
      if (!stopProcess(id)) throw new ToolError(`proses "${id}" tidak ditemukan`)
      return JSON.stringify({ stopped: id })
    }
  }
]
