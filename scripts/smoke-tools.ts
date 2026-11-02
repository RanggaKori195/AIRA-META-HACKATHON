// Smoke test: run EVERY Sales, TAT and Master Data tool once against the dummy database, inside the
// Electron runtime (pools behave differently there than in plain Node — CLAUDE.md).
// Catches columns the seed forgot and SQL that Postgres rejects, before the demo does.
//
//   npm run smoke:tools
//
// Exit code = number of failing tool calls.
import 'dotenv/config'
import { app } from 'electron'
import { Client } from 'pg'

process.env.AIRA_LOG_SILENT = '1'

// bundled-config reads these Vite defines; esbuild does not set them, so provide them from .env
// BEFORE any app module is imported (imports below are dynamic on purpose).
const g = globalThis as Record<string, unknown>
g.__BUNDLED_SALES_DB__ = process.env.AIRA_SALES_DB ?? ''
g.__BUNDLED_INNO_DB__ = process.env.AIRA_INNO_DB ?? ''
g.__BUNDLED_LOGIN_DB__ = process.env.AIRA_LOGIN_DB ?? ''

app.on('window-all-closed', () => {})

interface Call {
  tool: string
  args: Record<string, unknown>
  /** Output must match — "did not throw" is not enough (dates once parsed wrong silently). */
  expect?: RegExp
}

async function sampleValues(cs: string): Promise<{ orderId: string; orderIdTracked: string; pksCustomer: string; specialCustomerCode: string }> {
  const c = new Client({ connectionString: cs })
  await c.connect()
  try {
    const k = await c.query(`SELECT order_id FROM public."SalesRepository" WHERE date_result IS NOT NULL ORDER BY id DESC LIMIT 1`)
    const t = await c.query(`SELECT order_id FROM public.t_sample_tracker WHERE lab_sample_received_at IS NOT NULL ORDER BY order_created_at DESC LIMIT 1`)
    const p = await c.query(`SELECT customer_name FROM inno.t_pks WHERE status = '5' AND deleted_at IS NULL ORDER BY id LIMIT 1`)
    // A name like "RS Harapan Sehat" matches several customers and the tool rightly asks which one — use a code.
    const sp = await c.query(`SELECT customer_code FROM inno.m_special_price WHERE status = '5' GROUP BY customer_code ORDER BY count(*) DESC LIMIT 1`)
    return { orderId: k.rows[0].order_id, orderIdTracked: t.rows[0].order_id, pksCustomer: p.rows[0].customer_name, specialCustomerCode: sp.rows[0].customer_code }
  } finally {
    await c.end()
  }
}

async function run(): Promise<number> {
  const { assertLocalDb } = await import('../src/main/hackathon/local-db')
  const cs = String(g.__BUNDLED_SALES_DB__)
  assertLocalDb(cs, 'AIRA_SALES_DB')
  const { salesTools } = await import('../src/main/tools/sales-tools')
  const { labTools } = await import('../src/main/tools/lab-tools')
  const { innoTools } = await import('../src/main/tools/inno-tools')
  const all = [...salesTools, ...labTools, ...innoTools]
  const s = await sampleValues(cs)

  const breakdown = salesTools.find((t) => t.name === 'sales_breakdown')!
  const dims = ((breakdown.parameters as { properties: Record<string, { enum?: string[] }> }).properties.dimension
    ?.enum ?? []) as string[]

  const calls: Call[] = [
    { tool: 'sales_summary', args: { period: 'this_month' } },
    { tool: 'sales_summary', args: { period: 'last_month', basis: 'order' } },
    { tool: 'sales_compare', args: { period: 'this_month', comparePeriod: 'last_month' } },
    ...dims.map((d) => ({ tool: 'sales_breakdown', args: { period: 'last_month', dimension: d } })),
    { tool: 'sales_trend', args: { period: 'this_year' } },
    { tool: 'sales_movers', args: { period: 'last_month' } },
    { tool: 'sales_ytd', args: {} },
    { tool: 'sales_customers', args: {} },
    { tool: 'sales_projection', args: {} },
    { tool: 'sales_forecast', args: {} },
    { tool: 'sales_full_year', args: {} },
    { tool: 'sales_order_status', args: { order_id: s.orderId } },
    { tool: 'lab_backlog', args: {} },
    { tool: 'lab_lacak', args: { order_id: s.orderIdTracked } },
    { tool: 'lab_rns', args: {} },
    { tool: 'lab_tat', args: {} },
    { tool: 'inno_customer_search', args: { keyword: 'harapan' } },
    { tool: 'inno_customer_count', args: {} },
    { tool: 'inno_item_search', args: { keyword: 'hba1c' } },
    { tool: 'inno_item_count', args: {} },
    { tool: 'inno_special_price', args: { customer: s.specialCustomerCode }, expect: /aktif/ },
    { tool: 'inno_item_special_price', args: { item: 'HbA1c' }, expect: /"jumlahPelangganAktif":[1-9]/ },
    { tool: 'inno_pks', args: { customer: s.pksCustomer } },
    { tool: 'inno_clinician_search', args: { keyword: 'Andi' } },
    { tool: 'inno_item_package', args: { paket: 'Medical Check-Up Basic' } }
  ]

  // Every data tool must appear at least once (sales_report writes a document — covered by coba:pdf).
  const covered = new Set(calls.map((c) => c.tool))
  const missing = all.map((t) => t.name).filter((n) => n !== 'sales_report' && !covered.has(n))
  let failures = 0
  for (const m of missing) {
    console.log(`FAIL ${m}: no smoke call defined`)
    failures++
  }

  for (const call of calls) {
    const def = all.find((t) => t.name === call.tool)
    if (!def) {
      console.log(`FAIL ${call.tool}: tool not found`)
      failures++
      continue
    }
    const t0 = Date.now()
    try {
      const out = await def.execute(call.args, {} as never)
      if (call.expect && !call.expect.test(out)) throw new Error(`output does not match ${call.expect}: ${out.slice(0, 200)}`)
      const preview = out.replace(/\s+/g, ' ').slice(0, 90)
      console.log(`OK   ${call.tool} ${JSON.stringify(call.args)} (${Date.now() - t0} ms) ${preview}`)
    } catch (err) {
      console.log(`FAIL ${call.tool} ${JSON.stringify(call.args)}: ${(err as Error).message}`)
      failures++
    }
  }
  console.log(`\n${calls.length} calls, ${failures} failed`)
  return failures
}

app.whenReady().then(async () => {
  let code = 1
  try {
    code = await run()
  } catch (err) {
    console.error(err)
  }
  app.exit(code)
})
