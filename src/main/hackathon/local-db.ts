// Hackathon build: every database connection must stay on this machine.
//
// The original AIRA writes to its login database on every start (tables + seed users), so a
// single leftover production connection string would put hackathon test data on company
// servers. This guard is called before any pool or client is created and refuses anything
// that is not a loopback host. Unparsable strings are refused too — "can't tell" is not "local".

export const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'] as const

function hostsOf(connectionString: string): string[] | null {
  let url: URL
  try {
    url = new URL(connectionString)
  } catch {
    return null
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host) return null
  // node-postgres honours a `host` query parameter over the URL host (the LAST one when repeated),
  // so every one of them must be local too.
  return [host, ...url.searchParams.getAll('host').map((h) => h.toLowerCase())]
}

export function isLocalDb(connectionString: string): boolean {
  const hosts = hostsOf(connectionString)
  return hosts !== null && hosts.every((h) => (LOCAL_HOSTS as readonly string[]).includes(h))
}

export function assertLocalDb(connectionString: string, label: string): void {
  if (isLocalDb(connectionString)) return
  const hosts = hostsOf(connectionString)
  const host = hosts?.find((h) => !(LOCAL_HOSTS as readonly string[]).includes(h)) ?? '(unparsable)'
  throw new Error(`${label}: database host "${host}" is not local. This hackathon build only connects to localhost.`)
}

/** Checks every database variable at once; an empty value means "not configured" (feature off), not an error. */
export function checkLocalDbs(vars: Record<string, string>): string[] {
  const errors: string[] = []
  for (const [name, value] of Object.entries(vars)) {
    if (!value) continue
    try {
      assertLocalDb(value, name)
    } catch (err) {
      errors.push((err as Error).message)
    }
  }
  return errors
}
