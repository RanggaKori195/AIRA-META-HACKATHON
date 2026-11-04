// npm run voices [-- --force] — voices the user's three requests (Brian) and the narrator's cards (George) with
// ElevenLabs text-to-speech-with-timestamps; writes public/voice/*.mp3 and src/voices.json. The key comes from
// ../.env.local through node --env-file (the SDK reads ELEVENLABS_API_KEY); this script never reads or prints it.
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
import { MODEL, wordsFromCharacters, writeTimeline, type ScriptLine, type VoiceClient } from '../src/voice-core'
import { NARRATION, USER_TURNS } from '../src/lines'
import { TUTORIAL_LINES } from '../src/tutorial-lines'

const reason = (e: unknown): string => {
  const x = e as { statusCode?: number; message?: string }
  return x.statusCode ? `HTTP ${x.statusCode}: ${String(x.message).split('\n')[0]}` : String(x.message ?? e)
}

async function main(): Promise<void> {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY is not set — fill ../.env.local.')
  const el = new ElevenLabsClient()
  const client: VoiceClient = {
    speak: async (voiceId, text) => {
      const r = await el.textToSpeech.convertWithTimestamps(voiceId, {
        text,
        modelId: MODEL,
        outputFormat: 'mp3_44100_128',
        applyTextNormalization: 'on',
        languageCode: 'en',
        voiceSettings: { stability: 0.55, similarityBoost: 0.8 }
      })
      if (!r.alignment) throw new Error('ElevenLabs returned audio without timestamps.')
      return {
        mp3: new Uint8Array(Buffer.from(r.audioBase64, 'base64')),
        words: wordsFromCharacters(r.alignment.characters, r.alignment.characterStartTimesSeconds, r.alignment.characterEndTimesSeconds)
      }
    }
  }
  const lines: ScriptLine[] = [
    ...USER_TURNS.map((u) => ({ id: `user-${u.id}`, speaker: 'user' as const, text: u.text })),
    ...NARRATION.map((n) => ({ id: `narrator-${n.id}`, speaker: 'narrator' as const, text: n.text })),
    ...TUTORIAL_LINES.map((n) => ({ id: n.id, speaker: 'narrator' as const, text: n.text }))
  ]
  const out = await writeTimeline(lines, client, 'public', 'src/voices.json', { force: process.argv.includes('--force') })
  for (const l of out) console.log(`${l.id.padEnd(18)} ${l.duration.toFixed(2)} s  ${l.words.length} words`)
}

main().catch((e) => {
  console.error(`Voices failed — ${reason(e)}`)
  process.exit(1)
})
