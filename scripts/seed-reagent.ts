// Writes the Reagent Check demo workbooks to demo-data/reagent/ (synthetic; volumes from the local dummy DB).
// Usage: npm run seed:reagent [-- 2026-10]
import 'dotenv/config'
import { execFileSync } from 'child_process'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import ExcelJS from 'exceljs'
import { Client } from 'pg'
import { assertLocalDb } from '../src/main/hackathon/local-db'
import { RECOGNIZED_CLAUSE } from '../src/main/sales/recognition'
import { buildReagentWorkbooks, buildVoiceScript, type SheetSpec } from './seed/reagent'

async function write(path: string, sheets: SheetSpec[]): Promise<void> {
  const wb = new ExcelJS.Workbook()
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name)
    for (const r of s.rows) ws.addRow(r)
    ws.columns.forEach((c) => (c.width = 22))
  }
  await wb.xlsx.writeFile(path)
}

async function main(): Promise<void> {
  const month = process.argv[2] ?? '2026-10'
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('month must be YYYY-MM')
  const cs = process.env.AIRA_SALES_DB ?? ''
  assertLocalDb(cs, 'AIRA_SALES_DB')
  const [y, m] = month.split('-').map(Number)
  const from = `${month}-01`
  const to = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  const db = new Client({ connectionString: cs })
  await db.connect()
  const res = await db.query<{ item_code: string; n: number }>(
    `SELECT item_code, count(*)::int AS n FROM public."SalesRepository"
      WHERE date_received >= $1 AND date_received < $2${RECOGNIZED_CLAUSE} GROUP BY 1`,
    [from, to]
  )
  await db.end()
  const volumes = Object.fromEntries(res.rows.map((r) => [r.item_code, r.n]))
  const { usage, opname } = buildReagentWorkbooks(volumes, month)
  const dir = join(process.cwd(), 'demo-data', 'reagent')
  mkdirSync(dir, { recursive: true })
  await write(join(dir, `Reagent_Usage_${month}.xlsx`), usage)
  await write(join(dir, `Stock_Opname_${month}.xlsx`), opname)
  // Voice-recount demo: the script as text (the tests read this) and spoken by a Windows voice as a 16 kHz mono
  // WAV for the fake microphone. No Windows speech → the WAV is skipped and said so.
  const script = buildVoiceScript(opname)
  const txt = join(dir, `voice-count-${month}.txt`)
  writeFileSync(txt, script + '\n')
  const wav = join(dir, `voice-count-${month}.wav`)
  const q = (s: string): string => `'${s.replace(/'/g, "''")}'`
  try {
    execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      'Add-Type -AssemblyName System.Speech; ' +
        '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ' +
        "$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'en-US' } | Select-Object -First 1; " +
        'if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }; ' +
        '$s.Rate = 1; ' +
        '$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono); ' +
        `$s.SetOutputToWaveFile(${q(wav)}, $f); ` +
        `$s.Speak((Get-Content -Raw ${q(txt)})); $s.Dispose()`
    ])
    console.log(`wrote ${txt} and ${wav}`)
  } catch (e) {
    console.log(`wrote ${txt}; the WAV was skipped (Windows speech not available: ${e instanceof Error ? e.message.split('\n')[0] : e})`)
  }
  console.log(`wrote ${dir} (${month}); volumes for ${res.rows.length} test codes`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
