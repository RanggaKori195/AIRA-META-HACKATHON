// What is said in the demo besides AIRA itself: the user's three spoken requests (each must route to the intended
// action — tests/lines.test.ts checks them with the app's own keyword router) and the narrator's two short cards.

export interface UserTurn {
  id: 'reagent' | 'summary' | 'sales'
  text: string
  /** The event the recorder waits for after this request. */
  expect: string
}
export const USER_TURNS: UserTurn[] = [
  { id: 'reagent', text: 'Please check the reagents for this month.', expect: 'reagent:findings' },
  { id: 'summary', text: 'Summarize the reagent check.', expect: 'reorder:numbers-match' },
  { id: 'sales', text: 'What were sales last month?', expect: 'sales:answer' }
]

export const NARRATION: { id: 'intro' | 'outro'; text: string }[] = [
  {
    id: 'intro',
    text: "Every month, a lab reconciles reagent usage against its stock count by hand. It takes a day, and the numbers rarely match. Meet AIRA, a co-worker you can simply talk to."
  },
  {
    id: 'outro',
    text: 'AIRA is built on Meta Muse. Wonder answers, Spark picks the action, Voice Transcribe listens. Every number comes from code, with its evidence.'
  }
]
