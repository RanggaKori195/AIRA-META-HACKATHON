import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type {
  EvidenceRow,
  Finding,
  ReagentActionsResult,
  ReagentEvidenceResult,
  ReagentRunResult,
  ReagentStatus
} from '@shared/reagent'
import { compareRecount, parseRecount } from '@shared/recount'
import { TombolDikte } from '../components/TombolDikte'
import ReagentView, { type ReagentTab } from '../components/reagent/ReagentView'
import type { SummaryState } from '../components/reagent/ReorderPanel'
import type { RecountState, RowPatch } from '../components/reagent/RecountPanel'
import { useRecorder } from '../components/mascot/useRecorder'

/** Same as the recorder limit elsewhere: a clip stops by itself after this many seconds. */
const MAX_CLIP_SECONDS = 60
const NO_RECOUNT: RecountState = { transcript: '', rows: [], notCounted: [], recording: false, transcribing: false, error: null }
import mascotIdle from '../assets/mascot/idle.png'

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
  const [tab, setTab] = useState<ReagentTab>('findings')
  const [actions, setActions] = useState<ReagentActionsResult | null>(null)
  const [summary, setSummary] = useState<SummaryState | null>(null)
  const [exportNote, setExportNote] = useState<string | null>(null)
  const [recount, setRecount] = useState<RecountState>(NO_RECOUNT)
  const rec = useRecorder()
  const clipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
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
    setActions(null)
    setSummary(null)
    setExportNote(null)
    setRecount((r) => ({ ...r, rows: [], notCounted: [], error: null }))
    try {
      const r = await window.aira.reagentRun(month ?? undefined)
      setResult(r)
      if (!('error' in r)) setActions(await window.aira.reagentActions(r.summary.month))
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

  // A month or folder change ends the recount: an open recording is thrown away (the microphone is released) and
  // its timer cleared, so a clip never lands in the next month's transcript.
  const resetRecount = useCallback(() => {
    if (clipTimer.current) clearTimeout(clipTimer.current)
    clipTimer.current = null
    rec.discard()
    setRecount(NO_RECOUNT)
  }, [rec])

  const chooseFolder = useCallback(async () => {
    applyStatus(await window.aira.reagentChooseFolder())
    setResult(null)
    setActions(null)
    resetRecount()
    setTab('findings')
    latest.current = null
    setSelected(null)
  }, [applyStatus, resetRecount])

  // What a voice recount is compared with: the month's stock count from the actions result (or the run result).
  const recountItems = actions && !('error' in actions) ? actions.recount : result && !('error' in result) ? result.recount : []

  const stopClip = useCallback(async () => {
    if (clipTimer.current) clearTimeout(clipTimer.current)
    clipTimer.current = null
    const wav = await rec.stop()
    if (!wav) {
      setRecount((r) => ({ ...r, recording: false, error: 'No sound was recorded.' }))
      return
    }
    setRecount((r) => ({ ...r, recording: false, transcribing: true, error: null }))
    try {
      const { teks } = await window.aira.transkripsikanSuara(wav)
      // Appended to the editable transcript only — the user checks it, then presses Read counts.
      setRecount((r) => ({
        ...r,
        transcribing: false,
        transcript: teks.trim() ? (r.transcript.trim() ? `${r.transcript.trim()}\n${teks.trim()}` : teks.trim()) : r.transcript,
        error: teks.trim() ? null : 'Nothing was heard. Try speaking closer to the microphone.'
      }))
    } catch (e) {
      setRecount((r) => ({ ...r, transcribing: false, error: e instanceof Error ? e.message : 'Transcription failed.' }))
    }
  }, [rec])

  const record = useCallback(async () => {
    if (rec.recording) return stopClip()
    try {
      await rec.start()
      setRecount((r) => ({ ...r, recording: true, error: null }))
      clipTimer.current = setTimeout(() => void stopClip(), MAX_CLIP_SECONDS * 1000)
    } catch (e) {
      setRecount((r) => ({ ...r, recording: false, error: e instanceof Error ? e.message : 'The microphone could not be opened.' }))
    }
  }, [rec, stopClip])

  useEffect(
    () => () => {
      if (clipTimer.current) clearTimeout(clipTimer.current)
      rec.discard()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const readCounts = useCallback(() => {
    setRecount((r) => {
      const out = compareRecount(parseRecount(r.transcript, recountItems), recountItems)
      return { ...r, rows: out.rows, notCounted: out.notCounted }
    })
  }, [recountItems])

  const editRow = useCallback(
    (id: string, patch: RowPatch) => {
      setRecount((r) => {
        const out = compareRecount(
          r.rows.map((x) => (x.id === id ? { ...x, ...patch } : x)),
          recountItems
        )
        return { ...r, rows: out.rows, notCounted: out.notCounted }
      })
    },
    [recountItems]
  )

  const removeRow = useCallback(
    (id: string) => {
      setRecount((r) => {
        const out = compareRecount(
          r.rows.filter((x) => x.id !== id),
          recountItems
        )
        return { ...r, rows: out.rows, notCounted: out.notCounted }
      })
    },
    [recountItems]
  )

  const draftSummary = useCallback(async () => {
    setSummary({ loading: true })
    try {
      const r = await window.aira.reagentSummary(shownMonth)
      setSummary('error' in r ? { error: r.error, loading: false } : { text: r.text, loading: false })
    } catch (e) {
      setSummary({ error: e instanceof Error ? e.message : String(e), loading: false })
    }
  }, [shownMonth])

  const exportExcel = useCallback(async () => {
    setExportNote(null)
    try {
      const r = await window.aira.reagentExport({ month: shownMonth, recount: recount.rows })
      setExportNote('error' in r ? r.error : 'cancelled' in r ? 'Export cancelled.' : `Saved to ${r.path}`)
    } catch (e) {
      setExportNote(e instanceof Error ? e.message : String(e))
    }
  }, [shownMonth, recount.rows])

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
        setActions(null)
        resetRecount()
        setTab('findings')
      }}
      onSelect={(id) => void select(id)}
      onAsk={ask}
      onText={setText}
      onSubmit={submit}
      mascotArt={mascotIdle}
      tab={tab}
      onTab={setTab}
      actions={actions}
      summary={summary}
      exportNote={exportNote}
      onSummary={() => void draftSummary()}
      onExport={() => void exportExcel()}
      recount={recount}
      onRecountTranscript={(t) => setRecount((r) => ({ ...r, transcript: t }))}
      onRecord={() => void record()}
      onReadCounts={readCounts}
      onEditRow={editRow}
      onRemoveRow={removeRow}
      dictation={<TombolDikte onTeks={(t) => setText((s) => (s.trim() ? `${s.trim()} ${t}` : t))} />}
    />
  )
}
