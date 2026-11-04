import { useCallback, useEffect, useRef, useState } from 'react'
import { enkodeWav, gabungPotongan, turunkanSampel, WAV_SAMPLE_RATE } from '@shared/wav'
import { rmsOf } from './silence'

/*
 * Microphone → 16 kHz mono WAV, shared by the dictation button and the mascot (one recorder, not two
 * copies). Web Audio → PCM → WAV written by hand: MediaRecorder's WebM/Opus would need ffmpeg (rule 50).
 */

export interface Recorder {
  recording: boolean
  /** Opens the mic. Throws a readable Error (permission denied, no microphone). */
  start(): Promise<void>
  /** Stops and returns the WAV, or null when nothing was recorded. */
  stop(): Promise<Uint8Array | null>
  /** Releases the mic and throws the recording away (nothing is encoded or transcribed). */
  discard(): void
}

export interface RecorderOptions {
  /** Level (RMS) of each audio block while recording — automatic turns use it to stop on silence. */
  onLevel?: (rms: number, blockMs: number) => void
}

export function useRecorder(options: RecorderOptions = {}): Recorder {
  const [recording, setRecording] = useState(false)
  // Read through a ref: the audio callback outlives renders and must call the latest handler.
  const onLevelRef = useRef(options.onLevel)
  onLevelRef.current = options.onLevel
  const ctxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const procRef = useRef<ScriptProcessorNode | null>(null)
  const chunksRef = useRef<Float32Array[]>([])
  const rateRef = useRef<number>(WAV_SAMPLE_RATE)
  /** True from the start() call until the stream is released — covers the getUserMedia wait too. */
  const openRef = useRef(false)

  /** Releases the microphone. Called on every way out. */
  const release = useCallback(() => {
    procRef.current?.disconnect()
    procRef.current = null
    // Tracks MUST be stopped, not just the context closed — otherwise Windows keeps the
    // "microphone in use" light on after the user stopped talking.
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    void ctxRef.current?.close().catch(() => {})
    ctxRef.current = null
    openRef.current = false
  }, [])

  useEffect(() => release, [release])

  const start = useCallback(async () => {
    // A second start would overwrite the first stream without stopping it: the Windows mic light stays on
    // and two recordings run at once. Refuse — BEFORE the try, so the catch never releases the live one.
    if (openRef.current) throw new Error('The microphone is already in use.')
    release() // leftovers of an earlier failed turn
    openRef.current = true
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      })
      streamRef.current = stream
      // 16 kHz is requested but not guaranteed — the real rate is read back and resampled if needed.
      const ctx = new AudioContext({ sampleRate: WAV_SAMPLE_RATE })
      ctxRef.current = ctx
      rateRef.current = ctx.sampleRate
      const source = ctx.createMediaStreamSource(stream)
      // ScriptProcessorNode is deprecated but chosen on purpose: AudioWorklet needs a module loaded by
      // URL, which fights Vite's renderer bundling. One 16 kHz channel is a small load.
      const proc = ctx.createScriptProcessor(4096, 1, 1)
      chunksRef.current = []
      proc.onaudioprocess = (e): void => {
        // Copied: Web Audio reuses the buffer for the next block.
        const block = new Float32Array(e.inputBuffer.getChannelData(0))
        chunksRef.current.push(block)
        onLevelRef.current?.(rmsOf(block), (block.length / ctx.sampleRate) * 1000)
      }
      source.connect(proc)
      proc.connect(ctx.destination)
      procRef.current = proc
      setRecording(true)
    } catch (e) {
      release()
      const name = e instanceof DOMException ? e.name : ''
      throw new Error(
        name === 'NotAllowedError'
          ? 'Microphone permission denied. Open Windows Settings > Privacy > Microphone and allow AIRA.'
          : name === 'NotFoundError'
            ? 'No microphone was found on this laptop.'
            : e instanceof Error
              ? e.message
              : 'The microphone could not be opened.'
      )
    }
  }, [release])

  const stop = useCallback(async () => {
    const chunks = chunksRef.current
    const rate = rateRef.current
    chunksRef.current = []
    release()
    setRecording(false)
    if (!chunks.length) return null
    return enkodeWav(turunkanSampel(gabungPotongan(chunks), rate, WAV_SAMPLE_RATE))
  }, [release])

  const discard = useCallback(() => {
    chunksRef.current = []
    release()
    setRecording(false)
  }, [release])

  return { recording, start, stop, discard }
}
