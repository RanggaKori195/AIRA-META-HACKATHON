// Menguji dugaan: apakah MEMBUKA beberapa koneksi SERENTAK yang bermasalah,
// bukan membuka koneksi itu sendiri.
import { readFileSync } from 'fs'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { Pool } = require('pg')

const cs = readFileSync('.env', 'utf8').split(/\r?\n/)
  .find((l) => l.startsWith('AIRA_SALES_DB=')).slice('AIRA_SALES_DB='.length).trim()

const rt = process.versions.electron ? `electron ${process.versions.electron}` : `node ${process.versions.node}`
console.log(`runtime: ${rt}`)

const buat = () => new Pool({ connectionString: cs, max: 4, connectionTimeoutMillis: 12_000 })

async function coba(nama, n, poolsTerpisah) {
  const t = Date.now()
  const pools = poolsTerpisah ? Array.from({ length: n }, buat) : [buat()]
  try {
    await Promise.all(
      Array.from({ length: n }, (_, i) => (poolsTerpisah ? pools[i] : pools[0]).query('select 1'))
    )
    console.log(`${nama}: OK ${Date.now() - t} ms`)
  } catch (e) {
    console.log(`${nama}: GAGAL ${e.message} (${Date.now() - t} ms)`)
  } finally {
    for (const p of pools) await p.end().catch(() => undefined)
  }
}

await coba('1 pool, 1 query           ', 1, false)
await coba('1 pool, 6 query serentak  ', 6, false)
await coba('3 POOL TERPISAH serentak  ', 3, true)
await coba('6 POOL TERPISAH serentak  ', 6, true)
process.exit(0)
