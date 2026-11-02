// Menyusun DAFTAR UJI transkripsi suara dari data SUNGGUHAN, bukan karangan.
//
// Alasan (aturan §27, pelajaran validator NIK): daftar acuan yang ditulis dari
// ingatan akan lolos ujinya sendiri lalu gagal di lapangan. Istilah yang benar-benar
// diucapkan orang di OrderId ada di master item & master pelanggan, jadi dari situlah
// daftarnya diambil.
//
// Read-only. TIDAK menyentuh satu pun kolom pasien — hanya master item, master
// pelanggan (nama instansi), dan master wilayah.
//
// Jalankan: node scripts/ambil-istilah-uji.mjs
import { readFileSync, writeFileSync } from 'fs'
import pg from 'pg'

function envVar(nama) {
  const baris = readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${nama}=`))
  return baris ? baris.slice(nama.length + 1).trim() : null
}

const cs = envVar('AIRA_SALES_DB')
if (!cs) {
  console.error('AIRA_SALES_DB tidak ada di .env')
  process.exit(1)
}

// Istilah yang TIDAK ada di database tapi pasti diucapkan. Ini satu-satunya
// bagian yang ditulis tangan, dan sengaja dibatasi pada nama sistem/menu AIRA.
const ISTILAH_SISTEM = [
  'ERP',
  'the lab',
  'the lab',
  'Master Data',
  'Order ID',
  'RNS',
  'TAT',
  'nett sales',
  'backlog',
  'bridging'
]

const pool = new pg.Pool({
  connectionString: cs,
  max: 1,
  connectionTimeoutMillis: 15_000,
  statement_timeout: 60_000
})

const q = async (sql) => (await pool.query(sql)).rows

try {
  // Item yang paling sering muncul — inilah yang paling sering diucapkan.
  const item = await q(`
    SELECT m.item_name AS nama, count(*) AS n
      FROM public."SalesRepository" s
      JOIN LATERAL (
        SELECT item_name FROM public.m_item_repository
         WHERE item_code_erp = s.item_code LIMIT 1
      ) m ON true
     WHERE s.transfer_test_deleted_at IS NULL
       AND s.transaction_transfer_deleted_at IS NULL
       AND s.date_received >= now() - interval '6 months'
       AND m.item_name <> ''
     GROUP BY m.item_name ORDER BY n DESC LIMIT 25`)

  // Pelanggan INSTANSI terbesar. "Pasien Pribadi" dibuang: itu perorangan.
  const pelanggan = await q(`
    SELECT m.nama, count(*) AS n
      FROM public."SalesRepository" s
      JOIN LATERAL (
        SELECT customer_name AS nama, customer_type AS tipe
          FROM public.m_customer WHERE customer_code_lis = s.customer_id LIMIT 1
      ) m ON true
     WHERE s.transfer_test_deleted_at IS NULL
       AND s.transaction_transfer_deleted_at IS NULL
       AND s.date_received >= now() - interval '6 months'
       AND m.tipe <> 'PR' AND m.nama <> ''
     GROUP BY m.nama ORDER BY n DESC LIMIT 20`)

  // ⚠️ Nama provinsi ada di kolom `description`, BUKAN `province_name`.
  const wilayah = await q(`
    SELECT description AS nama FROM public.m_provinces
     WHERE description <> '' AND description IS NOT NULL
     ORDER BY description LIMIT 15`)

  const daftar = {
    dibuat: new Date().toISOString(),
    sumber: 'SalesRepository + master (6 bulan terakhir), read-only, tanpa kolom pasien',
    kelompok: {
      sistem: ISTILAH_SISTEM,
      item: item.map((r) => r.nama),
      pelanggan: pelanggan.map((r) => r.nama),
      wilayah: wilayah.map((r) => r.nama)
    }
  }

  writeFileSync('tests/istilah-uji-suara.json', JSON.stringify(daftar, null, 2), 'utf8')
  console.log('tersimpan: tests/istilah-uji-suara.json')
  for (const [k, v] of Object.entries(daftar.kelompok)) {
    console.log(`  ${k.padEnd(10)}: ${v.length} istilah`)
  }
  console.log('\ncontoh item     :', item.slice(0, 5).map((r) => r.nama).join(' · '))
  console.log('contoh pelanggan:', pelanggan.slice(0, 4).map((r) => r.nama).join(' · '))
} catch (e) {
  console.error('GAGAL:', e.message)
  process.exitCode = 1
} finally {
  await pool.end().catch(() => {})
}
