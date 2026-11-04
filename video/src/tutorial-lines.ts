// The narrator of the 3:00 tutorial (ElevenLabs George). Short lines: the app's own voice carries the demo.
// "NEW" = built during the event on top of the AIRA 0.5.0 baseline (commit a693286); "EXISTING" = already in 0.5.0.
export interface TutorialLine {
  id: string
  text: string
}
export const TUTORIAL_LINES: TutorialLine[] = [
  {
    id: 'tut-intro',
    text: 'This is AIRA, an AI co-worker for a clinical lab, running on Meta Muse. We started this hackathon from AIRA zero point five. Everything marked new was built during the event.'
  },
  { id: 'tut-start', text: 'On start, AIRA greets you by name and reads a morning briefing: sales, orders, a suggestion and a trend from the web.' },
  { id: 'tut-voice', text: 'Then you just talk. Muse Spark picks one safe action and AIRA opens the right screen.' },
  { id: 'tut-evidence', text: 'Every finding links to the exact file, sheet and row it came from.' },
  { id: 'tut-summary', text: 'Muse writes the summary, and code checks every number in it.' },
  { id: 'tut-recount', text: 'Count the shelf out loud, and AIRA finds what is missing.' },
  { id: 'tut-sales', text: 'Ask Sales Data existed before. New: you ask by voice, and AIRA reads the answer back.' },
  {
    id: 'tut-outro',
    text: 'AIRA runs on Meta Muse: Wonder, Spark, Voice Transcribe and Image, with an ElevenLabs voice. Every number comes from code, with its evidence.'
  }
]
