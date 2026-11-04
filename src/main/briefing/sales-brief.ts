// Sales and trend inputs for the morning briefing. Pure — tested in tests/briefing-sales.test.ts.
//
// Sales: read from the results of the app's own sales tools (sales_compare month to date vs the same days last
// month, sales_movers rising/falling tests), so every number comes from code. Percentages and order counts only —
// no Rupiah, the room may hear the briefing. Trend: one web search through the app's web_search tool (You.com —
// the Meta Muse API itself cannot search the web); its text is untrusted data, its links are shown as sources.

export interface SalesMover {
  item: string
  persen: number | null
  status: string
}
export interface SalesBrief {
  now: { range: string; orders: number | null }
  before: { range: string; orders: number | null }
  persen: number | null
  arah: 'naik' | 'turun' | 'sama'
  naik: SalesMover[]
  turun: SalesMover[]
}
export interface WebSource {
  title: string
  url: string
}
export interface WebTrend {
  sources: WebSource[]
  items: { title: string; text: string }[]
}
export type WebInput = WebTrend | { error: string } | null

const MOVERS = 3
const range = (r: unknown): string => String(r ?? '').replace(' s/d ', ' to ')
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const mover = (m: Record<string, unknown>): SalesMover => ({ item: String(m.item ?? ''), persen: num(m.persen), status: String(m.status ?? '') })

/** Reads the JSON the sales_compare and sales_movers tools return. */
export function salesBriefFromTools(compareJson: string, moversJson: string): SalesBrief {
  const c = JSON.parse(compareJson) as Record<string, any>
  const m = JSON.parse(moversJson) as Record<string, any>
  const arah = c.arah === 'naik' || c.arah === 'turun' ? c.arah : 'sama'
  return {
    now: { range: range(c.periodeUtama?.rentang), orders: num(c.periodeUtama?.jumlahOrder) },
    before: { range: range(c.periodePembanding?.rentang), orders: num(c.periodePembanding?.jumlahOrder) },
    persen: num(c.persenPerubahan),
    arah,
    naik: ((m.itemNaik ?? []) as Record<string, unknown>[]).slice(0, MOVERS).map(mover),
    turun: ((m.itemTurun ?? []) as Record<string, unknown>[]).slice(0, MOVERS).map(mover)
  }
}

const pct = (p: number): string => `${p > 0 ? '+' : ''}${p}%`
const moverText = (m: SalesMover): string =>
  m.status === 'baru' ? `${m.item} (new this period)` : m.status === 'berhenti' ? `${m.item} (no sales this period)` : m.persen === null ? m.item : `${m.item} ${pct(m.persen)}`

/** Sales facts for the briefing, every number from the tools. */
export function salesFacts(s: SalesBrief): string[] {
  const change =
    s.persen === null ? 'no comparison (no sales in the earlier period)' : s.arah === 'sama' ? 'unchanged' : `${s.arah === 'naik' ? 'up' : 'down'} ${Math.abs(s.persen)}%`
  const orders = s.now.orders !== null && s.before.orders !== null ? `; orders ${s.now.orders} vs ${s.before.orders}` : ''
  const facts = [`- Sales month to date (${s.now.range}) vs the same days last month (${s.before.range}): ${change}${orders}.`]
  if (s.naik.length) facts.push(`- Rising tests: ${s.naik.map(moverText).join(', ')}.`)
  if (s.turun.length) facts.push(`- Falling tests: ${s.turun.map(moverText).join(', ')}.`)
  return facts
}

/** The code-written sales sentence (numbers only from the facts). */
export function salesSentence(s: SalesBrief): string {
  const head =
    s.persen === null
      ? 'Sales this month cannot be compared with last month'
      : s.arah === 'sama'
        ? 'Sales this month are level with the same days last month'
        : `Sales this month are ${s.arah === 'naik' ? 'up' : 'down'} ${Math.abs(s.persen)}% on the same days last month`
  const up = s.naik[0] ? `; ${s.naik[0].item} is rising fastest` : ''
  const down = s.turun[0] ? `${up ? ' and' : ';'} ${s.turun[0].item} is falling most` : ''
  return `${head}${up}${down}.`
}

/** Reads the JSON the web_search tool returns: links become sources, text is kept short for the prompt. */
export function webTrendFromSearch(json: string): WebTrend {
  const r = JSON.parse(json) as { results?: { title?: string; url?: string; description?: string; snippet?: string }[] }
  const hits = (r.results ?? []).filter((h) => h.title && h.url).slice(0, 5)
  return {
    sources: hits.map((h) => ({ title: String(h.title), url: String(h.url) })),
    items: hits.map((h) => ({ title: String(h.title), text: `${h.description ?? ''} ${h.snippet ?? ''}`.trim().slice(0, 400) }))
  }
}

/** The search the briefing runs (one query, the current month). */
export function trendQuery(now: Date): string {
  const month = now.toLocaleString('en-US', { month: 'long', year: 'numeric' })
  // News, not market reports: what is in the health news now (outbreaks, rising cases, screening drives).
  return `Indonesia health news this week rising cases outbreak screening campaign ${month}`
}
