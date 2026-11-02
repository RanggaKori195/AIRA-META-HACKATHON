// Menakar pengetahuan baru Master Data sebelum dijadikan tool (21 Agu 2026):
// item_type, lab_code, group_code, price_group_code, dan isi paket.
//
// Jalankan: npx tsx scripts/probe-inno-item.ts   (butuh jaringan internal the company)
//
// ⚠️ Server ini melayani aplikasi produksi Master Data. Semua query di sini
// ber-LIMIT dan memakai SET SESSION max_statement_time — aturan 14 CLAUDE.md.

import { readFileSync } from 'fs'
import mysql from 'mysql2/promise'

function envVar(nama: string): string | null {
  const baris = readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${nama}=`))
  return baris ? baris.slice(nama.length + 1).trim() : null
}

const uri = envVar('AIRA_INNO_DB')
if (!uri) {
  console.error('AIRA_INNO_DB tidak ada di .env')
  process.exit(1)
}

async function main(): Promise<void> {
  const conn = await mysql.createConnection({ uri, connectTimeout: 15_000 })
  await conn.query('SET SESSION max_statement_time=20')
  const q = async (sql: string, p: unknown[] = []): Promise<any[]> =>
    (await conn.query(sql, p))[0] as any[]

  const tampil = (judul: string, rows: any[]): void => {
    console.log(`\n=== ${judul} ===`)
    console.table(rows)
  }

  // Kolom yang benar-benar ada di m_item — jangan percaya ingatan.
  const kolom = await q(
    `SELECT COLUMN_NAME FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'm_item'
        AND COLUMN_NAME IN ('item_type','lab_code','group_code','group_la','price_group_code','item_code')`
  )
  tampil('kolom m_item yang dicari', kolom)

  tampil(
    'sebaran item_type (U/K/P) — hanya status 5, belum dihapus',
    await q(
      `SELECT item_type, count(*) AS jumlah FROM m_item
        WHERE deleted_at IS NULL AND status = '5' GROUP BY item_type ORDER BY jumlah DESC LIMIT 20`
    )
  )

  tampil(
    'sebaran lab_code',
    await q(
      `SELECT lab_code, count(*) AS jumlah FROM m_item
        WHERE deleted_at IS NULL AND status = '5' GROUP BY lab_code ORDER BY jumlah DESC LIMIT 20`
    )
  )

  tampil(
    'sebaran price_group_code (RP/CC/SB)',
    await q(
      `SELECT price_group_code, count(*) AS jumlah FROM m_item
        WHERE deleted_at IS NULL AND status = '5' GROUP BY price_group_code ORDER BY jumlah DESC LIMIT 20`
    )
  )

  tampil(
    'kolom m_item_group',
    await q(
      `SELECT COLUMN_NAME FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'm_item_group' LIMIT 30`
    )
  )

  tampil(
    'contoh m_item_group',
    await q(
      `SELECT code, item_headgroup_code, description FROM m_item_group
        WHERE deleted_at IS NULL ORDER BY code LIMIT 12`
    )
  )

  // Apakah group_code di m_item benar-benar nyambung ke m_item_group.code?
  tampil(
    'kecocokan group_code -> m_item_group.code',
    await q(
      `SELECT count(*) AS item_total,
              sum(CASE WHEN g.code IS NULL THEN 1 ELSE 0 END) AS tidak_ketemu
         FROM m_item i
         LEFT JOIN m_item_group g ON g.code = i.group_code AND g.deleted_at IS NULL
        WHERE i.deleted_at IS NULL AND i.status = '5'`
    )
  )

  // Keunikan m_item_group.code — kalau dobel, join akan menggandakan baris item
  // (jebakan yang sudah dua kali terjadi di modul sales).
  tampil(
    'keunikan m_item_group.code',
    await q(
      `SELECT count(*) AS baris, count(DISTINCT code) AS kode_unik
         FROM m_item_group WHERE deleted_at IS NULL`
    )
  )

  tampil(
    'paket: berapa main & child di m_item_package',
    await q(
      `SELECT count(*) AS baris,
              count(DISTINCT item_code_main) AS paket_unik,
              sum(CASE WHEN is_non_lab = '1' THEN 1 ELSE 0 END) AS non_lab,
              sum(CASE WHEN is_non_lab = '0' THEN 1 ELSE 0 END) AS lab
         FROM m_item_package WHERE deleted_at IS NULL`
    )
  )

  // Apakah item_code_main benar-benar item ber-type K (paket)?
  tampil(
    'jenis item dari induk paket',
    await q(
      `SELECT i.item_type, count(DISTINCT p.item_code_main) AS jumlah_paket
         FROM m_item_package p
         LEFT JOIN m_item i ON i.item_code = p.item_code_main AND i.deleted_at IS NULL
        WHERE p.deleted_at IS NULL
        GROUP BY i.item_type ORDER BY jumlah_paket DESC LIMIT 10`
    )
  )

  // Contoh satu paket beserta isinya.
  const [contoh] = await q(
    `SELECT p.item_code_main, count(*) AS isi FROM m_item_package p
      WHERE p.deleted_at IS NULL GROUP BY p.item_code_main
      ORDER BY isi DESC LIMIT 1`
  )
  if (contoh) {
    console.log(`\npaket contoh: ${contoh.item_code_main} (${contoh.isi} isi)`)
    tampil(
      'isi paket contoh',
      await q(
        `SELECT p.item_code_child, c.item_name, c.lab_code, p.is_non_lab
           FROM m_item_package p
           LEFT JOIN m_item c ON c.item_code = p.item_code_child AND c.deleted_at IS NULL
          WHERE p.deleted_at IS NULL AND p.item_code_main = ?
          LIMIT 12`,
        [contoh.item_code_main]
      )
    )
  }

  // Harga: k1/k2 saja yang akan ditampilkan. Seberapa sering k3+ terisi?
  tampil(
    'keterisian kolom harga reguler',
    await q(
      `SELECT count(*) AS baris,
              sum(CASE WHEN k1 IS NOT NULL AND k1 > 0 THEN 1 ELSE 0 END) AS k1_terisi,
              sum(CASE WHEN k2 IS NOT NULL AND k2 > 0 THEN 1 ELSE 0 END) AS k2_terisi,
              sum(CASE WHEN k3 IS NOT NULL AND k3 > 0 THEN 1 ELSE 0 END) AS k3_terisi
         FROM m_reguler_price WHERE deleted_at IS NULL AND status = '5'`
    )
  )

  await conn.end()
}

main().catch((err) => {
  console.error('GAGAL:', err)
  process.exit(1)
})
