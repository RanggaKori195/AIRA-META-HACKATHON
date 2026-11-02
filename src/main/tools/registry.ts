import { RAG_DISABLED } from '../hackathon/flags'
import type { ToolDefinition } from './types'
import { fsTools } from './fs-tools'
import { docTools } from './doc-tools'
import { webTools } from './web-tools'
import { ragTools } from './rag-tools'
import { riwayatTools } from './riwayat-tools'
import { codeTools } from './code-tools'
import { httpTools } from './http-tools'
import { dbTools } from './db-tools'
import { processTools } from './process-tools'
import { browserTools } from './browser-tools'
import { skillTools } from './skill-tools'
import { salesTools } from './sales-tools'
import { innoTools } from './inno-tools'
import { labTools } from './lab-tools'
import { onedriveTools } from './onedrive-tools'
import { m365Tools } from './m365-tools'
import { simbolTools } from './simbol-tools'
import { panduanTools } from './panduan-tools'
import { M365_LANJUTAN } from '../m365/rules'
import { ujiTools } from '../uji/uji-tools'
import { perspektifTools } from './perspektif-tools'
import { gambarTools } from './gambar-tools'
import { diagramTools } from './diagram-tools'

const registry = new Map<string, ToolDefinition>()

for (const tool of fsTools) registry.set(tool.name, tool)
for (const tool of docTools) registry.set(tool.name, tool)
// Pembuat & pengubah gambar (old-image-model). Kelompok "core": permintaan "buatkan
// gambar ..." datang di Task Baru, dan ilustrasi slide dipakai bersama write_ppt
// yang juga ada di core.
for (const tool of gambarTools) registry.set(tool.name, tool)
// Diagram interaktif (30 Sep 2026) — "core" dengan alasan yang sama: diminta di Task
// Baru, dan PNG-nya dipakai bersama write_ppt/write_word.
for (const tool of diagramTools) registry.set(tool.name, tool)
for (const tool of webTools) registry.set(tool.name, tool)
if (!RAG_DISABLED) for (const tool of ragTools) registry.set(tool.name, tool)
// Masuk kelompok "core" (lihat `groupOf`): pertanyaan tentang percakapan
// sebelumnya bisa muncul di tengah topik apa pun, jadi tool ini harus selalu
// ikut terkirim — bukan hanya saat kata pemicu tertentu terdeteksi.
for (const tool of riwayatTools) registry.set(tool.name, tool)
// Masuk kelompok "core" dengan alasan yang sama seperti `search_history`:
// pertanyaan "gimana caranya" / "kamu bisa apa" muncul di tengah pekerjaan apa
// pun, bukan hanya saat user sedang membuka layar Panduan.
for (const tool of panduanTools) registry.set(tool.name, tool)
for (const tool of codeTools) registry.set(tool.name, tool)
for (const tool of httpTools) registry.set(tool.name, tool)
for (const tool of dbTools) registry.set(tool.name, tool)
for (const tool of processTools) registry.set(tool.name, tool)
for (const tool of browserTools) registry.set(tool.name, tool)
for (const tool of skillTools) registry.set(tool.name, tool)
for (const tool of salesTools) registry.set(tool.name, tool)
for (const tool of innoTools) registry.set(tool.name, tool)
for (const tool of labTools) registry.set(tool.name, tool)
// ⚠️ Tool M365 lanjutan (email, kalender, simpan, index) TIDAK didaftarkan
// selama `M365_LANJUTAN` mati. Bukan dikomentari — dibiarkan hidup di kode dan
// ter-test, hanya tidak dikirim ke model. Tool yang ada tapi selalu gagal jauh
// lebih buruk daripada tool yang memang tidak ada: model akan mencobanya
// berulang lalu mengarang alasan kegagalannya.
const LANJUTAN = new Set(['onedrive_simpan', 'onedrive_index'])
for (const tool of simbolTools) registry.set(tool.name, tool)
for (const tool of onedriveTools) {
  if (!M365_LANJUTAN && LANJUTAN.has(tool.name)) continue
  registry.set(tool.name, tool)
}
if (M365_LANJUTAN) for (const tool of m365Tools) registry.set(tool.name, tool)
// Ruang uji — masuk kelompok "dev" (lihat `groupOf`).
for (const tool of ujiTools) registry.set(tool.name, tool)
// Analisa lintas perspektif — masuk kelompok "sales" (lihat `groupOf`):
// sumbernya SalesRepository, jadi ia milik mode "Tanya Data Sales".
for (const tool of perspektifTools) registry.set(tool.name, tool)

export function getTool(name: string): ToolDefinition | undefined {
  return registry.get(name)
}

/** Spesifikasi tools dalam format OpenAI-compatible untuk dikirim ke LLM. */
export function toolSpecs(): Array<Record<string, unknown>> {
  return [...registry.values()].map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }))
}
