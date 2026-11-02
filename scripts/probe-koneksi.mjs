// Menelusuri kenapa koneksi Postgres menggantung di dalam Electron.
//
// Jalankan tiga varian di runtime yang sama supaya perbedaannya bisa dibandingkan:
//   1. TCP telanjang (net.connect)  — apakah socket saja sudah bermasalah?
//   2. pg.Client                    — apakah handshake Postgres yang bermasalah?
//   3. pg.Pool.query                — jalur yang dipakai aplikasi
//
// Dipakai lewat:  node scripts/probe-koneksi.mjs          (Node biasa)
//                 ELECTRON_RUN_AS_NODE=1 electron scripts/probe-koneksi.mjs

import net from 'net'
import { readFileSync } from 'fs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { Client, Pool } = require('pg')

const cs = readFileSync('.env', 'utf8')
  .split(/\r?\n/)
  .find((l) => l.startsWith('AIRA_SALES_DB='))
  .slice('AIRA_SALES_DB='.length)
  .trim()

const host = cs.match(/@([^:/]+):(\d+)/)
const HOST = host[1]
const PORT = Number(host[2])

const runtime = process.versions.electron ? `electron ${process.versions.electron}` : `node ${process.versions.node}`
console.log(`runtime: ${runtime} | node ${process.versions.node} | target ${HOST}:${PORT}`)

function tcp() {
  return new Promise((resolve) => {
    const t = Date.now()
    const s = net.connect(PORT, HOST)
    s.setTimeout(12_000)
    s.on('connect', () => {
      s.destroy()
      resolve(`OK ${Date.now() - t} ms`)
    })
    s.on('timeout', () => {
      s.destroy()
      resolve(`TIMEOUT ${Date.now() - t} ms`)
    })
    s.on('error', (e) => resolve(`ERROR ${e.message} (${Date.now() - t} ms)`))
  })
}

async function client() {
  const t = Date.now()
  const c = new Client({ connectionString: cs, connectionTimeoutMillis: 12_000 })
  try {
    await c.connect()
    await c.query('select 1')
    await c.end()
    return `OK ${Date.now() - t} ms`
  } catch (e) {
    await c.end().catch(() => undefined)
    return `GAGAL ${e.message} (${Date.now() - t} ms)`
  }
}

async function pool() {
  const t = Date.now()
  const p = new Pool({ connectionString: cs, max: 2, connectionTimeoutMillis: 12_000 })
  try {
    await p.query('select 1')
    await p.end()
    return `OK ${Date.now() - t} ms`
  } catch (e) {
    await p.end().catch(() => undefined)
    return `GAGAL ${e.message} (${Date.now() - t} ms)`
  }
}

console.log('1. TCP telanjang :', await tcp())
console.log('2. pg.Client     :', await client())
console.log('3. pg.Pool.query :', await pool())
process.exit(0)
