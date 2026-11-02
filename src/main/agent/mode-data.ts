import type { ChatMode } from '../../shared/ipc'

// The DATA modes: toolset locked to one data group (rules 10/17), no coding tools. ONE definition for every guard
// that behaves differently there — they used to be three hand-written `mode === 'sales' || …` chains, and a new
// mode (`reagent`, 2 Nov 2026) was added to none of them:
//   - orchestrator: an answer without any tool call is discarded and a tool call is forced (rule 30),
//   - sales-guard `toolChoiceUntuk`: a pure greeting gets no tools,
//   - verify-guard `guardUjiBerlakuDiMode`: the "I tested it" guard does NOT run (rule 79).
// ⚠️ `onedrive` is deliberately NOT here: follow-ups about an already-read file are legitimately answered from the
// conversation, and the "tested it" guard keeps running there (orchestrator comment, 25 Aug 2026).
// A new data mode is added HERE; tests/mode-data.test.ts iterates every ChatMode and fails for an unclassified one.
export const MODE_DATA = ['sales', 'masterdata', 'lab', 'reagent'] as const satisfies readonly ChatMode[]

export function adalahModeData(mode: string | undefined): boolean {
  return (MODE_DATA as readonly string[]).includes(mode ?? '')
}
