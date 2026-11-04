import { useCallback, useEffect, useReducer, useRef, useState, type JSX } from 'react'
import MascotView from './MascotView'
import { INITIAL, next } from './state'
import { autoSendAction, canStartVoiceTurn } from './turn'
import { useRecorder } from './useRecorder'
import { createSilenceDetector } from './silence'
import { FAKE_MIC_WARNING } from '../../../../shared/test-mic'
import {
  emitMascot,
  isMuted,
  onMascotEvent,
  onVoiceTurnRequest,
  setMascotUser,
  setMuted,
  stopSpeaking,
  type VoiceTurnRequest
} from './voice'
import idle from '../../assets/mascot/idle.png'
import listening from '../../assets/mascot/listening.png'
import thinking from '../../assets/mascot/thinking.png'
import speaking from '../../assets/mascot/speaking.png'
import './mascot.css'

/*
 * The AIRA mascot: click (or the startup sequence) → record → Muse Voice Transcribe → transcript shown → handed to
 * the voice co-worker after 2 s unless the user presses Cancel (mis-hearing must stay correctable — rule 50's
 * reason; the dictation button stays insert-only). Automatic turns stop on silence and close quietly. Thinking /
 * speaking follow the chat events App emits on the mascot bus.
 */

const ART = { idle, listening, thinking, speaking }
/** Same as MAKS_DETIK in main: recording stops by itself at this limit. */
const MAX_SECONDS = 60
const AUTO_SEND_MS = 2000
const QUIET_CLOSE = "I'm here when you need me — click me to talk."

interface Props {
  username: string
  busy: boolean
  /** A spoken request, after the Cancel window: App hands it to the voice co-worker. */
  onVoiceRequest: (text: string) => void
  /** Home already shows a big mascot: the floating one appears only once a voice turn is under way. */
  hideWhenIdle?: boolean
}

export default function Mascot({ username, busy, onVoiceRequest, hideWhenIdle = false }: Props): JSX.Element {
  const [mascot, dispatch] = useReducer(next, INITIAL)
  const [muted, setMutedState] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  // The silence detector of the open turn; fed with the level of every audio block.
  const detectorRef = useRef<ReturnType<typeof createSilenceDetector> | null>(null)
  const finishRef = useRef<() => void>(() => {})
  const quietRef = useRef<() => void>(() => {})
  const rec = useRecorder({
    onLevel: (rms, ms) => {
      const verdict = detectorRef.current?.feed(rms, ms) ?? 'listening'
      if (verdict === 'listening') return
      detectorRef.current = null
      if (verdict === 'done') finishRef.current()
      else quietRef.current()
    }
  })
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onVoiceRequestRef = useRef(onVoiceRequest)
  onVoiceRequestRef.current = onVoiceRequest
  // The timer and the bus listener outlive a render: they read the latest busy / recorder through refs.
  const busyRef = useRef(busy)
  busyRef.current = busy
  const recRef = useRef(rec)
  recRef.current = rec
  // Bumped on every run start: an in-flight voice turn that began before it is stale and is dropped.
  const generationRef = useRef(0)
  // Who asked for this turn (startup sequence / hero click) and what the transcript is for.
  const resolveRef = useRef<((transcript: string) => void) | null>(null)
  const purposeRef = useRef<'request' | 'name'>('request')

  const resolveTurn = (transcript: string): void => {
    const r = resolveRef.current
    resolveRef.current = null
    r?.(transcript)
  }

  useEffect(() => {
    setMascotUser(username)
    setMutedState(isMuted())
  }, [username])

  // A test launch left running (fake microphone) hears a recording instead of the user: say so, permanently.
  const [testMic, setTestMic] = useState(false)
  useEffect(() => {
    void window.aira.voiceTestMic().then(setTestMic).catch(() => setTestMic(false))
  }, [])

  const clearSendTimer = (): void => {
    if (sendTimer.current) clearTimeout(sendTimer.current)
    sendTimer.current = null
  }
  const clearStopTimer = (): void => {
    if (stopTimer.current) clearTimeout(stopTimer.current)
    stopTimer.current = null
  }

  useEffect(
    () =>
      onMascotEvent((e) => {
        if (e.t === 'runStart') {
          // A send from elsewhere (typed question, retry): this voice turn must not also send. Stop the
          // 60 s timer, drop the pending 2 s send, and throw an open recording away (the mic is released).
          generationRef.current++
          clearSendTimer()
          clearStopTimer()
          detectorRef.current = null
          recRef.current.discard()
          resolveTurn('')
        }
        dispatch(e)
      }),
    []
  )
  useEffect(() => () => {
    clearSendTimer()
    clearStopTimer()
  }, [])

  const finishRecording = useCallback(async () => {
    clearStopTimer()
    detectorRef.current = null
    const generation = generationRef.current
    const wav = await rec.stop()
    if (generation !== generationRef.current) return // a run started meanwhile: this turn is stale
    if (!wav) {
      setMessage('No sound was recorded.')
      dispatch({ t: 'transcript', text: '' })
      resolveTurn('')
      return
    }
    try {
      const { teks } = await window.aira.transkripsikanSuara(wav)
      if (generation !== generationRef.current) return
      const said = teks.trim()
      if (!said) setMessage('I did not catch that. Try speaking closer to the microphone.')
      dispatch({ t: 'transcript', text: said })
      if (!said) return resolveTurn('')
      if (purposeRef.current === 'name') {
        // The name answer goes back to the startup sequence; it is never sent as a request.
        dispatch({ t: 'cancel' })
        return resolveTurn(said)
      }
      clearSendTimer()
      sendTimer.current = setTimeout(() => {
        sendTimer.current = null
        if (autoSendAction(busyRef.current) === 'skip') {
          setMessage('AIRA is still answering, so your voice question was not sent.')
          dispatch({ t: 'cancel' })
          resolveTurn('')
          return
        }
        dispatch({ t: 'send' })
        onVoiceRequestRef.current(said)
        resolveTurn(said)
      }, AUTO_SEND_MS)
    } catch (e) {
      if (generation !== generationRef.current) return
      setMessage(e instanceof Error ? e.message : 'Transcription failed.')
      dispatch({ t: 'error' })
      resolveTurn('')
    }
  }, [rec])
  finishRef.current = () => void finishRecording()

  // An automatic turn that heard nothing: close the microphone quietly.
  quietRef.current = () => {
    clearStopTimer()
    recRef.current.discard()
    dispatch({ t: 'transcript', text: '' })
    setMessage(QUIET_CLOSE)
    resolveTurn('')
  }

  const startTurn = useCallback(
    async (o: VoiceTurnRequest = {}, resolve?: (transcript: string) => void) => {
      setMessage(null)
      if (mascot.state === 'listening') {
        if (!o.auto && rec.recording) await finishRecording()
        resolve?.('')
        return
      }
      // The microphone never opens by itself while AIRA answers or when the user muted AIRA.
      if (o.auto && (busyRef.current || isMuted())) return resolve?.('')
      // One voice turn at a time: a pending transcript, a running answer or a thinking mascot refuses a new
      // one — recording then would be ignored by the state machine and leak the microphone.
      if (!canStartVoiceTurn(busy, mascot.state)) return resolve?.('')
      resolveTurn('')
      resolveRef.current = resolve ?? null
      purposeRef.current = o.purpose ?? 'request'
      stopSpeaking()
      const generation = generationRef.current
      try {
        await rec.start()
        if (generation !== generationRef.current) {
          rec.discard() // a run started while the mic was opening
          return resolveTurn('')
        }
        dispatch({ t: 'micStart' })
        // Automatic turns close by themselves; a clicked turn also stops on silence but never "hears nothing".
        detectorRef.current = createSilenceDetector(o.auto ? {} : { noSpeechMs: Infinity, maxMs: MAX_SECONDS * 1000 })
        stopTimer.current = setTimeout(() => void finishRecording(), MAX_SECONDS * 1000)
      } catch (e) {
        setMessage(e instanceof Error ? e.message : 'The microphone could not be opened.')
        dispatch({ t: 'error' })
        resolveTurn('')
      }
    },
    [busy, mascot.state, rec, finishRecording]
  )

  const startTurnRef = useRef(startTurn)
  startTurnRef.current = startTurn
  useEffect(() => onVoiceTurnRequest((o, resolve) => void startTurnRef.current(o, resolve)), [])

  const handleCancel = useCallback(() => {
    clearSendTimer()
    dispatch({ t: 'cancel' })
    resolveTurn('')
  }, [])

  const toggleMute = useCallback(() => {
    const m = !isMuted()
    setMuted(m)
    setMutedState(m)
  }, [])

  return (
    <MascotView
      mascot={mascot}
      art={ART}
      muted={muted}
      recording={rec.recording}
      busy={busy}
      message={testMic ? FAKE_MIC_WARNING : message}
      hidden={hideWhenIdle && mascot.state === 'idle' && !message && !testMic}
      onClick={() => void startTurn()}
      onCancel={handleCancel}
      onToggleMute={toggleMute}
    />
  )
}

export { emitMascot }
