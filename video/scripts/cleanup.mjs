// node scripts/cleanup.mjs — deletes the conversations a take creates (the spoken sales question) from the sidebar
// of the dev app, through the app's own delete button + confirm dialog, then prints how many are left.
const TITLE = 'What were sales last month?'
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && t.url.startsWith('http://localhost:5173'))
if (!page) throw new Error('The AIRA dev app is not running with --remoteDebuggingPort 9222.')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (pending.has(d.id)) pending.get(d.id)(d), pending.delete(d.id)
}
await new Promise((r) => (ws.onopen = r))
const js = (expression) =>
  new Promise((r) => {
    const i = ++id
    pending.set(i, (d) => r(d.result?.result?.value))
    ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })
let deleted = 0
for (let n = 0; n < 30; n++) {
  const r = await js(`(async () => {
    const item = [...document.querySelectorAll('aside *, nav *')].find((e) => e.children.length < 4 && e.innerText?.trim() === ${JSON.stringify(TITLE)})
    if (!item) return 'none'
    let row = item
    for (let i = 0; i < 5 && row && !row.querySelector('button[title*=Delete],button[aria-label*=Delete]'); i++) row = row.parentElement
    const del = row?.querySelector('button[title*=Delete],button[aria-label*=Delete]')
    if (!del) return 'no delete button'
    del.click()
    await new Promise((r) => setTimeout(r, 600))
    const ok = [...document.querySelectorAll('button')].filter((b) => b.offsetParent && /^Delete$/i.test(b.innerText.trim()))
    if (!ok.length) return 'no confirm'
    ok.at(-1).click()
    await new Promise((r) => setTimeout(r, 1200))
    return 'deleted'
  })()`)
  if (r !== 'deleted') {
    if (r !== 'none') console.log(`Stopped: ${r}`)
    break
  }
  deleted++
}
const left = await js(`[...document.querySelectorAll('aside *, nav *')].filter((e) => e.children.length < 4 && e.innerText?.trim() === ${JSON.stringify(TITLE)}).length`)
console.log(`Deleted ${deleted} conversation(s) titled "${TITLE}"; ${left} left in the sidebar.`)
ws.close()
