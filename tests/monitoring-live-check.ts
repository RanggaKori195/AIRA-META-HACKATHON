// Pemeriksaan MONITORING PEMAKAIAN ke database SUNGGUHAN.
// Jalankan manual: npx tsx tests/monitoring-live-check.ts
//
// ⚠️ Yang diuji adalah statement ASLI dari `src/main/monitoring/service.ts`,
// disuntik lewat `pakaiKoneksiUji` — bukan salinan SQL (pelajaran aturan 64).
//
// Memakai username SEMENTARA berawalan `ujimon_` dan membersihkan semuanya di
// akhir, termasuk bila ada pemeriksaan yang gagal.
import { readFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { Pool } from 'pg'
import { applySchema } from '../src/main/auth/schema'
import * as mon from '../src/main/monitoring/service'
import { bentukAktivitas, type AktivitasBaru } from '../src/main/monitoring/rules'
import type { SesiUser } from '../src/main/auth/service'
import type { MonitoringFilter, ToolActivity } from '../src/shared/ipc'

function envVar(nama: string): string | null {
  const baris = readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${nama}=`))
  return baris ? baris.slice(nama.length + 1).trim() : null
}

const cs = envVar('AIRA_LOGIN_DB') ?? envVar('AIRA_SALES_DB')
if (!cs) {
  console.error('AIRA_LOGIN_DB / AIRA_SALES_DB tidak ada di .env')
  process.exit(1)
}

let gagal = 0
function cek(nama: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'OK   ' : 'GAGAL'} ${nama}${detail ? ' — ' + detail : ''}`)
  if (!ok) gagal++
}

const pool = new Pool({ connectionString: cs, max: 1, connectionTimeoutMillis: 15_000 })
const q = async <T>(sql: string, p: unknown[] = []): Promise<T[]> =>
  (await pool.query(sql, p)).rows as T[]

const A = 'ujimon_a'
const B = 'ujimon_b'
const ADMIN = 'ujimon_admin'
const admin: SesiUser = { username: ADMIN, role: 'super_admin', divisi: [], menu: [], expDate: null }

const alat = (name: string, status: ToolActivity['status'] = 'ok'): ToolActivity => ({
  callId: randomUUID(),
  name,
  argsSummary: 'path=C:\\rahasia.xlsx',
  tier: 'read',
  status
})

function baris(o: {
  user: string
  menitLalu: number
  teks: string
  mode?: AktivitasBaru['mode']
  tools?: ToolActivity[]
  kode?: string | null
  lampiran?: string[]
}): AktivitasBaru {
  const mulai = Date.now() - o.menitLalu * 60_000
  return bentukAktivitas({
    eventId: randomUUID(),
    sesi: { username: o.user, role: 'staff', divisi: ['IT'] },
    mesin: { hostname: 'UJI-LAPTOP', osUser: 'uji' },
    appVersion: '0.0.0-uji',
    mulai,
    selesai: mulai + 1500,
    mode: o.mode ?? 'general',
    model: 'AURA-uji',
    sesiId: 'sesi-uji',
    teks: o.teks,
    lampiran: o.lampiran ?? [],
    activities: o.tools ?? [],
    kodeGalat: o.kode ?? null,
    usage: { promptTokens: 100, completionTokens: 20 }
  })
}

const filter = (f: Partial<MonitoringFilter>): MonitoringFilter => ({
  periodeHari: 7,
  username: null,
  mode: null,
  cari: null,
  ...f
})

async function bersihkan(): Promise<void> {
  await q(`DELETE FROM tb_aktivitas_aira WHERE username LIKE 'ujimon\\_%'`)
  await q(`DELETE FROM tb_aktivitas_akses_aira WHERE admin LIKE 'ujimon\\_%'`)
}

async function main(): Promise<void> {
  await applySchema(
    async (sql, params) => {
      await pool.query(sql, params)
    },
    (sql, params) => q(sql, params ?? [])
  )
  mon.pakaiKoneksiUji(q)
  await bersihkan()

  // --- penulisan & anti-dobel
  const utama = [
    baris({
      user: A,
      menitLalu: 5,
      teks: 'naik 100% dibanding bulan lalu? password=RahasiaUji9',
      mode: 'sales',
      tools: [alat('sales_report'), alat('sales_report', 'error'), alat('read_excel')],
      lampiran: ['C:\\Users\\x\\target.xlsx']
    }),
    baris({ user: A, menitLalu: 10, teks: 'naik 1000 kali', mode: 'general', kode: 'LLM_HTTP_ERROR' }),
    baris({ user: B, menitLalu: 15, teks: 'punya B, jangan muncul di A', mode: 'lab' })
  ]
  await mon.kirimBatch(utama)
  await mon.kirimBatch(utama) // kirim ulang: koneksi putus sesudah INSERT berhasil
  const [{ n }] = await q<{ n: number }>(
    `SELECT count(*)::int n FROM tb_aktivitas_aira WHERE username IN ($1, $2)`,
    [A, B]
  )
  cek('kirim ulang TIDAK menggandakan baris (event_id unik)', n === 3, `n=${n}`)

  const [mentah] = await q<{ prompt: string; lampiran: string[]; tools: unknown; j: string | null }>(
    `SELECT prompt, lampiran, tools, to_jsonb(t)->>'jawaban' AS j
       FROM tb_aktivitas_aira t WHERE event_id = $1`,
    [utama[0].eventId]
  )
  cek('kata sandi tersamarkan di server', !mentah.prompt.includes('RahasiaUji9'), mentah.prompt)
  cek('lampiran tersimpan sebagai nama saja', mentah.lampiran.join() === 'target.xlsx', mentah.lampiran.join())
  cek(
    'argumen tool tidak ada di server',
    !JSON.stringify(mentah.tools).includes('rahasia.xlsx'),
    JSON.stringify(mentah.tools)
  )
  cek('tidak ada kolom jawaban di tabel', mentah.j === null)

  // --- ringkasan, disaring per orang
  const rA = await mon.ringkasan(admin, filter({ username: 'UJIMON_A' }))
  cek('ringkasan A: 2 pertanyaan (username tidak peka huruf)', rA.totalPertanyaan === 2, `${rA.totalPertanyaan}`)
  cek('ringkasan A: 1 pengguna', rA.penggunaAktif === 1)
  cek('ringkasan A: 1 gagal', rA.gagal === 1)
  cek('ringkasan A: 1 memakai alat', rA.pakaiTool === 1)
  cek(
    'ringkasan A: alat dijumlah per kali (sales_report=2)',
    rA.toolTeratas.find((t) => t.nama === 'sales_report')?.jumlah === 2,
    JSON.stringify(rA.toolTeratas)
  )
  cek(
    'ringkasan A: per menu',
    JSON.stringify([...rA.perMenu].sort((x, y) => x.mode.localeCompare(y.mode))) ===
      JSON.stringify([
        { mode: 'general', jumlah: 1 },
        { mode: 'sales', jumlah: 1 }
      ]),
    JSON.stringify(rA.perMenu)
  )
  cek('ringkasan A: per jam berjumlah 2', rA.perJam.reduce((s, x) => s + x, 0) === 2)
  cek('ringkasan A: per hari berjumlah 2', rA.perHari.reduce((s, x) => s + x.jumlah, 0) === 2)
  cek(
    'ringkasan A: baris pengguna',
    rA.perPengguna.length === 1 && rA.perPengguna[0].pertanyaan === 2 && rA.perPengguna[0].gagal === 1,
    JSON.stringify(rA.perPengguna)
  )

  const [akses] = await q<{ n: number }>(
    `SELECT count(*)::int n FROM tb_aktivitas_akses_aira WHERE admin = $1 AND username_dilihat = 'UJIMON_A'`,
    [ADMIN]
  )
  cek('pembukaan monitoring tercatat di tb_aktivitas_akses_aira', akses.n === 1, `n=${akses.n}`)

  // --- saringan
  const lA = await mon.linimasa({ ...filter({ username: A }), sebelum: null })
  cek('linimasa A tidak memuat baris B', lA.baris.every((b) => b.username === A) && lA.baris.length === 2)
  cek('linimasa urut terbaru dulu', lA.baris[0].prompt?.startsWith('naik 100%') === true)
  cek('linimasa membawa tools', lA.baris[0].tools.length === 2 && lA.baris[0].jumlahTool === 3)

  const persen = await mon.linimasa({ ...filter({ username: A, cari: '100%' }), sebelum: null })
  cek(
    'cari "100%" tidak mencocokkan "1000" (wildcard di-escape)',
    persen.baris.length === 1 && persen.baris[0].prompt!.includes('100%'),
    persen.baris.map((b) => b.prompt).join(' | ')
  )

  const lab = await mon.ringkasan(admin, filter({ mode: 'lab', username: B }))
  cek('saringan menu', lab.totalPertanyaan === 1)

  // --- halaman
  const banyak = Array.from({ length: 55 }, (_, i) =>
    baris({ user: A, menitLalu: 30 + i, teks: `halaman ${i}` })
  )
  await mon.kirimBatch(banyak)
  const h1 = await mon.linimasa({ ...filter({ username: A }), sebelum: null })
  const akhir = h1.baris.at(-1)!
  const h2 = await mon.linimasa({
    ...filter({ username: A }),
    sebelum: { waktu: akhir.waktu, id: akhir.id }
  })
  const semuaId = new Set([...h1.baris, ...h2.baris].map((b) => b.id))
  cek('halaman 1: 50 baris + adaLagi', h1.baris.length === 50 && h1.adaLagi)
  cek('halaman 2: sisa 7 baris, tanpa adaLagi', h2.baris.length === 7 && !h2.adaLagi, `${h2.baris.length}`)
  cek('tidak ada baris dobel antar halaman', semuaId.size === 57, `${semuaId.size}`)

  // --- periode & retensi
  const lama = baris({ user: A, menitLalu: 100 * 24 * 60, teks: 'pertanyaan 100 hari lalu' })
  await mon.kirimBatch([lama])
  const r7 = await mon.ringkasan(admin, filter({ username: A, periodeHari: 7 }))
  cek('baris 100 hari lalu tidak masuk periode 7 hari', r7.totalPertanyaan === 57, `${r7.totalPertanyaan}`)
  await mon.terapkanRetensi()
  const [sesudah] = await q<{ prompt: string | null }>(
    'SELECT prompt FROM tb_aktivitas_aira WHERE event_id = $1',
    [lama.eventId]
  )
  cek('retensi: teks > 90 hari dikosongkan', sesudah.prompt === null)
  const [masih] = await q<{ prompt: string | null }>(
    'SELECT prompt FROM tb_aktivitas_aira WHERE event_id = $1',
    [utama[0].eventId]
  )
  cek('retensi: teks baru tetap ada', masih.prompt !== null)
}

main()
  .catch((e) => {
    console.error('GAGAL:', e instanceof Error ? (e.stack ?? e.message) : e)
    gagal++
  })
  .finally(async () => {
    try {
      await bersihkan()
      const [sisa] = await q<{ n: number }>(
        `SELECT count(*)::int n FROM tb_aktivitas_aira WHERE username LIKE 'ujimon\\_%'`
      )
      cek('baris uji dibersihkan', sisa.n === 0)
    } catch (e) {
      console.error('PEMBERSIHAN GAGAL:', e instanceof Error ? e.message : e)
      gagal++
    }
    await pool.end().catch(() => {})
    console.log(gagal ? `\n${gagal} PEMERIKSAAN GAGAL` : '\nSEMUA LOLOS')
    process.exit(gagal ? 1 : 0)
  })
