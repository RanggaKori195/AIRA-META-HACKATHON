import { ToolError, type ToolDefinition } from './types'
import { listSkills, readSkill } from '../skills'

// Tool pemuat skill. Daftar nama+deskripsi sudah ada di system prompt; tool ini
// mengambil isi lengkapnya hanya saat skill tersebut memang relevan dengan tugas.

export const skillTools: ToolDefinition[] = [
  {
    name: 'load_skill',
    label: 'Muat Panduan',
    description:
      'Memuat panduan kerja (skill) sesuai daftar yang tersedia. Panggil ini SEBELUM mengerjakan ' +
      'tugas yang cocok dengan salah satu skill, lalu ikuti instruksinya. Sebutkan nama skill-nya persis.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Nama skill yang akan dimuat' } },
      required: ['name']
    },
    tier: 'read',
    summarize: (a) => `Muat panduan "${a.name}"`,
    execute: async (args) => {
      const name = args.name
      if (typeof name !== 'string' || !name.trim()) {
        throw new ToolError('argumen "name" wajib berupa string')
      }
      const body = readSkill(name)
      if (!body) {
        const available = listSkills().map((s) => s.name)
        throw new ToolError(
          `skill "${name}" tidak ditemukan.` +
            (available.length ? ` Tersedia: ${available.join(', ')}` : ' Belum ada skill terpasang.')
        )
      }
      return JSON.stringify({ skill: name, instructions: body })
    }
  }
]
