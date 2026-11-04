import type { JSX } from 'react'
import type { Briefing } from '../../../shared/ipc'
import { NumberMarks, numberCheckLine } from './NumberMarks'

// Morning briefing card on Home: the text the mascot reads, with its numbers marked by the number check, where it
// came from (Muse Wonder's wording, or code when Muse's wording failed the check), and a Brief me button.

/** localStorage key of the day the briefing last played for this user (one laptop, several users). */
export const briefingKey = (username: string): string => `aira.briefing.played.${username}`

/** Plays by itself once per user per day — never when the mascot is muted. */
export function shouldAutoPlay(lastPlayed: string | null, today: string, muted: boolean): boolean {
  return !muted && lastPlayed !== today
}

let pending: { key: string; promise: Promise<Briefing> } | null = null

/**
 * The automatic briefing of one user for one day, fetched (and spoken) once. React dev mounts Home twice; without
 * this the first mount's briefing is lost and the second sees today's marker and shows nothing.
 */
export function autoBriefing(key: string, start: () => Promise<Briefing>): Promise<Briefing> {
  if (pending?.key !== key) pending = { key, promise: start() }
  return pending.promise
}

/** True while (or after) today's automatic briefing for `key` was started in this window. */
export const autoBriefingStarted = (key: string): boolean => pending?.key === key

interface Props {
  briefing: Briefing | null
  /** The greeting shown as text when AIRA is muted (nothing is spoken then). */
  greeting?: string | null
  loading: boolean
  error: string | null
  onBriefMe: () => void
}

export function BriefingCard({ briefing, greeting = null, loading, error, onBriefMe }: Props): JSX.Element {
  return (
    <section className="briefing">
      <div className="briefing-kepala">
        <strong>Morning briefing</strong>
        {briefing && (
          <span className="briefing-sumber">
            {briefing.source === 'muse' ? 'AI draft · numbers checked' : 'Written by code from the data'}
          </span>
        )}
        <button type="button" className="briefing-tombol" onClick={onBriefMe} disabled={loading}>
          {loading ? 'Preparing…' : 'Brief me'}
        </button>
      </div>
      {greeting && <p className="briefing-teks">{greeting}</p>}
      {error && <p className="rg-galat">{error}</p>}
      {briefing && (
        <>
          <p className="briefing-teks">
            <NumberMarks text={briefing.text} check={briefing.check} />
          </p>
          {briefing.check.hits.length > 0 && <p className="num-line">Number check: {numberCheckLine(briefing.check, 'data')}</p>}
          {briefing.note && <p className="num-line num-line-warn">{briefing.note}</p>}
          {briefing.sources && briefing.sources.length > 0 && (
            <div className="briefing-sumber-web">
              <span className="num-line">From the web (You.com) — check before acting:</span>
              <ul>
                {briefing.sources.slice(0, 3).map((s) => (
                  <li key={s.url}>
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {briefing.trendNote && <p className="num-line num-line-warn">{briefing.trendNote}</p>}
        </>
      )}
      {!briefing && !loading && !error && <p className="num-line">Press Brief me to hear what needs attention today.</p>}
    </section>
  )
}
