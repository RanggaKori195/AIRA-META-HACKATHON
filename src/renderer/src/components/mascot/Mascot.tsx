import { useCallback, useEffect, useReducer, useRef, useState, type JSX } from 'react'
import MascotView from './MascotView'
import { INITIAL, next } from './state'
import { autoSendAction, canStartVoiceTurn } from './turn'
import { useRecorder } from './useRecorder'
import { emitMascot, isMuted, onMascotEvent, setMascotUser, setMuted, stopSpeaking } from './voice'
import idle from '../../assets/mascot/idle.png'
import listening from '../../assets/mascot/listening.png'
import thinking from '../../assets/mascot/thinking.png'
import speaking from '../../assets/mascot/speaking.png'
import './mascot.css'

/*
 * The AIRA mascot: click → record → Muse Voice Transcribe → transcript shown → sent after 2 s unless the
 * user presses Cancel (mis-hearing must stay correctable — rule 50's reason; the dictation button stays
 * insert-only). Thinking/speaking follow the chat events App emits on the mascot bus.
 */

const ART = { idle, listening, thinking, speaking }
/** Same as MAKS_DETIK in main: recording stops by itself at this limit. */
const MAX_SECONDS = 60
const AUTO_SEND_MS = 2000

interface Props {
  username: string
  busy: boolean
  onSend: (text: string) => void
}

export default function Mascot({ username, busy, onSend }: Props): JSX.Element {
  const [mascot, dispatch] = useReducer(next, INITIAL)
  const [muted, setMutedState] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const rec = useRecorder()
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onSendRef = useRef(onSend)
  onSendRef.current = onSend
  // The timer and the bus listener outlive a render: they read the latest busy / recorder through refs.
  const busyRef = useRef(busy)
  busyRef.current = busy
  const recRef = useRef(rec)
  recRef.current = rec
  // Bumped on every run start: an in-flight voice turn that began before it is stale and is dropped.
  const generationRef = useRef(0)

  useEffect(() => {
    setMascotUser(username)
    setMutedState(isMuted())
  }, [username])

  const clearSendTimer = (): void => {
    if (sendTimer.current) clearTimeout(sendTimer.current)
    sendTimer.current = null
  }

  useEffect(
    () =>
      onMascotEvent((e) => {
        if (e.t === 'runStart') {
          // A send from elsewhere (typed question, retry): this voice turn must not also send. Stop the
          // 60 s timer, drop the pending 2 s send, and throw an open recording away (the mic is released).
          generationRef.current++
          clearSendTimer()
          if (stopTimer.current) clearTimeout(stopTimer.current)
          stopTimer.current = null
          recRef.current.discard()
        }
        dispatch(e)
      }),
    []
  )
  useEffect(() => () => {
    clearSendTimer()
    if (stopTimer.current) clearTimeout(stopTimer.current)
  }, [])

  const finishRecording = useCallback(async () => {
    if (stopTimer.current) clearTimeout(stopTimer.current)
    stopTimer.current = null
    const generation = generationRef.current
    const wav = await rec.stop()
    if (generation !== generationRef.current) return // a run started meanwhile: this turn is stale
    if (!wav) {
      setMessage('No sound was recorded.')
      dispatch({ t: 'transcript', text: '' })
      return
    }
    try {
      const { teks } = await window.aira.transkripsikanSuara(wav)
      if (generation !== generationRef.current) return
      if (!teks.trim()) setMessage('I did not catch that. Try speaking closer to the microphone.')
      dispatch({ t: 'transcript', text: teks })
      if (!teks.trim()) return
      clearSendTimer()
      sendTimer.current = setTimeout(() => {
        sendTimer.current = null
        if (autoSendAction(busyRef.current) === 'skip') {
          setMessage('AIRA is still answering, so your voice question was not sent.')
          dispatch({ t: 'cancel' })
          return
        }
        dispatch({ t: 'send' })
        onSendRef.current(teks.trim())
      }, AUTO_SEND_MS)
    } catch (e) {
      if (generation !== generationRef.current) return
      setMessage(e instanceof Error ? e.message : 'Transcription failed.')
      dispatch({ t: 'error' })
    }
  }, [rec])

  const handleClick = useCallback(async () => {
    setMessage(null)
    if (mascot.state === 'listening') {
      if (rec.recording) await finishRecording()
      return
    }
    // One voice turn at a time: a pending transcript, a running answer or a thinking mascot refuses a new
    // one — recording then would be ignored by the state machine and leak the microphone.
    if (!canStartVoiceTurn(busy, mascot.state)) return
    stopSpeaking()
    const generation = generationRef.current
    try {
      await rec.start()
      if (generation !== generationRef.current) {
        rec.discard() // a run started while the mic was opening
        return
      }
      dispatch({ t: 'micStart' })
      stopTimer.current = setTimeout(() => void finishRecording(), MAX_SECONDS * 1000)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'The microphone could not be opened.')
      dispatch({ t: 'error' })
    }
  }, [busy, mascot.state, rec, finishRecording])

  const handleCancel = useCallback(() => {
    clearSendTimer()
    dispatch({ t: 'cancel' })
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
      message={message}
      onClick={() => void handleClick()}
      onCancel={handleCancel}
      onToggleMute={toggleMute}
    />
  )
}

export { emitMascot }
