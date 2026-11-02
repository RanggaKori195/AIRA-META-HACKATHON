// What "--until" means for the seed: same argument within the same hour → same data.

/** Past date → end of that day (23:59). Today, a future date, or no argument → start of the current hour. */
export function resolveUntil(arg: string | undefined, now: Date): Date {
  const hour = new Date(now)
  hour.setMinutes(0, 0, 0)
  if (arg === undefined) return hour
  if (!/^\d{4}-\d{2}-\d{2}$/.test(arg)) throw new Error(`--until must be YYYY-MM-DD, got "${arg}"`)
  const endOfDay = new Date(`${arg}T23:59:00`)
  return endOfDay.getTime() > hour.getTime() ? hour : endOfDay
}
