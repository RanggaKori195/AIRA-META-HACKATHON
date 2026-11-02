/**
 * Menakar view `v_sample_tracker` — struktur, cakupan, dan kualitas datanya.
 *
 * ⚠️ Skrip ini SENGAJA tidak pernah mencetak baris mentah. View ini bertetangga
 * dengan `SalesRepository` yang memuat `patient_name`, `dob`, `clin_diagnosis`
 * (aturan 3), jadi yang dicetak hanya: nama kolom, tipe, keterisian, jumlah
 * nilai unik, dan contoh nilai untuk kolom yang JELAS bukan PII.
 *
 * Dipakai sekali untuk merancang tool TAT — bukan bagian dari `npm test`.
 * Jalankan: npx tsx scripts/probe-sample-tracker.ts
 */
import 'dotenv/config'
import { Client } from 'pg'

const KATA_PII =
  /(patient|nama_pasien|pasien|dob|birth|lahir|nik|ktp|phone|telp|hp|email|address|alamat|diagnos|result_text|hasil_text|mrn|no_rm)/i

function rahasia(kolom: string): boolean {
  return KATA_PII.test(kolom)
}

async function main(): Promise<void> {
  const conn = process.env.AIRA_SALES_DB
  if (!conn) throw new Error('AIRA_SALES_DB tidak ada di .env')
  const db = new Client({ connectionString: conn, statement_timeout: 120_000 })
  await db.connect()

  // 1. Apakah view-nya ada, dan di schema mana
  const lokasi = await db.query(
    `SELECT table_schema, table_type
       FROM information_schema.tables
      WHERE table_name = 'v_sample_tracker'`
  )
  console.log('=== LOKASI ===')
  if (lokasi.rowCount === 0) {
    console.log('TIDAK DITEMUKAN di database ini.')
    // cari yang mirip supaya tidak buntu
    const mirip = await db.query(
      `SELECT table_schema, table_name, table_type
         FROM information_schema.tables
        WHERE table_name ILIKE '%sample%' OR table_name ILIKE '%tracker%'
        ORDER BY table_name LIMIT 30`
    )
    console.log('Yang namanya mirip:')
    for (const r of mirip.rows) console.log(`  ${r.table_schema}.${r.table_name} (${r.table_type})`)
    await db.end()
    return
  }
  for (const r of lokasi.rows) console.log(`  ${r.table_schema}.v_sample_tracker (${r.table_type})`)
  const schema = lokasi.rows[0].table_schema as string
  const full = `${schema}."v_sample_tracker"`

  // 2. Kolom
  const kolom = await db.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'v_sample_tracker'
      ORDER BY ordinal_position`,
    [schema]
  )
  console.log(`\n=== KOLOM (${kolom.rowCount}) ===`)
  for (const k of kolom.rows) {
    console.log(`  ${rahasia(k.column_name) ? '[PII?] ' : '       '}${k.column_name}  ${k.data_type}`)
  }

  // 3. Jumlah baris
  const jml = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${full}`)
  console.log(`\n=== JUMLAH BARIS ===\n  ${Number(jml.rows[0].n).toLocaleString('id-ID')}`)

  // 4. Keterisian + kardinalitas tiap kolom (satu query, sekali sapu)
  const bagian = kolom.rows
    .map(
      (k) =>
        `count("${k.column_name}")::text AS "isi_${k.column_name}", ` +
        `count(DISTINCT "${k.column_name}")::text AS "unik_${k.column_name}"`
    )
    .join(', ')
  const stat = await db.query(`SELECT ${bagian} FROM ${full}`)
  const s = stat.rows[0] as Record<string, string>
  const total = Number(jml.rows[0].n)
  console.log('\n=== KETERISIAN & NILAI UNIK ===')
  console.log('  kolom'.padEnd(38) + 'terisi'.padStart(12) + '%'.padStart(8) + 'unik'.padStart(10))
  for (const k of kolom.rows) {
    const isi = Number(s[`isi_${k.column_name}`])
    const unik = Number(s[`unik_${k.column_name}`])
    const pct = total ? ((isi / total) * 100).toFixed(1) : '0'
    console.log(
      `  ${k.column_name}`.padEnd(38) +
        isi.toLocaleString('id-ID').padStart(12) +
        `${pct}%`.padStart(8) +
        unik.toLocaleString('id-ID').padStart(10)
    )
  }

  // 5. Rentang tanggal
  const tanggal = kolom.rows.filter((k) => /date|timestamp/i.test(k.data_type))
  if (tanggal.length) {
    console.log('\n=== RENTANG TANGGAL ===')
    for (const k of tanggal) {
      const r = await db.query(
        `SELECT min("${k.column_name}")::text AS a, max("${k.column_name}")::text AS b FROM ${full}`
      )
      console.log(`  ${k.column_name}: ${r.rows[0].a ?? '-'}  ..  ${r.rows[0].b ?? '-'}`)
    }
  }

  // 6. Contoh nilai HANYA untuk kolom kategori yang bukan PII
  console.log('\n=== CONTOH NILAI (kolom kategori, bukan PII) ===')
  for (const k of kolom.rows) {
    if (rahasia(k.column_name)) continue
    const unik = Number(s[`unik_${k.column_name}`])
    if (unik === 0 || unik > 25) continue
    const r = await db.query(
      `SELECT "${k.column_name}"::text AS v, count(*)::text AS n
         FROM ${full} GROUP BY 1 ORDER BY count(*) DESC LIMIT 25`
    )
    console.log(
      `  ${k.column_name} (${unik} nilai): ` +
        r.rows.map((x) => `${x.v ?? 'NULL'}=${Number(x.n).toLocaleString('id-ID')}`).join(' · ')
    )
  }

  // 7. Definisi view — memperlihatkan tabel sumbernya
  const def = await db.query<{ d: string }>(
    `SELECT pg_get_viewdef($1::regclass, true) AS d`,
    [full]
  )
  console.log('\n=== DEFINISI VIEW ===')
  console.log(def.rows[0].d)

  await db.end()
}

main().catch((e) => {
  console.error('GAGAL:', e.message)
  process.exit(1)
})
