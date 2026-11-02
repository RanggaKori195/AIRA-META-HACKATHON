import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { EvidenceRow, Finding, ReagentEvidenceResult, ReagentRunResult, ReagentStatus } from '@shared/reagent'
import { TombolDikte } from '../components/TombolDikte'
import ReagentView from '../components/reagent/ReagentView'

// Reagent Check home: folder (chosen by a main-process dialog), month, Run reconciliation → findings table with
// evidence rows, and the question box for AIRA (chat in mode `reagent`; the mascot works as everywhere else).

interface Props {
  onSubmit: (text: string) => void | Promise<void>
}

export default function ReagentHome({ onSubmit }: Props): JSX.Element {
  const [status, setStatus] = useState<ReagentStatus | null>(null)
  const [month, setMonth] = useState<string | null>(null)
  const [result, setResult] = useState<ReagentRunResult | null>(null)
  const [running, setRunning] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [evidence, setEvidence] = useState<EvidenceRow[] | null>(null)
  const [evidenceError, setEvidenceError] = useState<string | null>(null)
  const [text, setText] = useState('')
  // The finding the user selected last: a slow response for A must never show under B.
  const latest = useRef<string | null>(null)

  const applyStatus = useCallback((s: ReagentStatus | null) => {
    setStatus(s)
    setMonth((m) => (s && m && s.months.includes(m) ? m : (s?.months[0] ?? null)))
  }, [])

  useEffect(() => {
    void window.aira.reagentStatus().then(applyStatus)
  }, [applyStatus])

  const run = useCallback(async () => {
    setRunning(true)
    latest.current = null
    setSelected(null)
    setEvidence(null)
    setEvidenceError(null)
    try {
      setResult(await window.aira.reagentRun(month ?? undefined))
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      setRunning(false)
    }
  }, [month])

  // The month of the result on screen (the dropdown may already show another month).
  const shownMonth = result && !('error' in result) ? result.summary.month : (month ?? undefined)

  const select = useCallback(
    async (id: string | null) => {
      latest.current = id
      setSelected(id)
      setEvidence(null)
      setEvidenceError(null)
      if (!id) return
      let r: ReagentEvidenceResult
      try {
        r = await window.aira.reagentEvidence({ findingId: id, month: shownMonth })
      } catch (e) {
        r = { error: e instanceof Error ? e.message : String(e) }
      }
      if (latest.current !== id) return
      if ('error' in r) setEvidenceError(r.error)
      else setEvidence(r.rows)
    },
    [shownMonth]
  )

  const chooseFolder = useCallback(async () => {
    applyStatus(await window.aira.reagentChooseFolder())
    setResult(null)
    latest.current = null
    setSelected(null)
  }, [applyStatus])

  const ask = useCallback((f: Finding) => {
    // Fills the box only — the user sends it (same rule as the other screens' example cards).
    setText(`Explain finding ${f.id}: ${f.explanation}`)
  }, [])

  const submit = useCallback(() => {
    const t = text.trim()
    if (!t) return
    setText('')
    void onSubmit(t)
  }, [text, onSubmit])

  return (
    <ReagentView
      status={status}
      month={month}
      result={result}
      running={running}
      selected={selected}
      evidence={evidence}
      evidenceError={evidenceError}
      text={text}
      onChooseFolder={() => void chooseFolder()}
      onRun={() => void run()}
      onMonth={(m) => {
        setMonth(m)
        setResult(null)
      }}
      onSelect={(id) => void select(id)}
      onAsk={ask}
      onText={setText}
      onSubmit={submit}
      dictation={<TombolDikte onTeks={(t) => setText((s) => (s.trim() ? `${s.trim()} ${t}` : t))} />}
    />
  )
}
