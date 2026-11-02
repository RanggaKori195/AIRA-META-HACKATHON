# AIRA — AI Lab Assistant

AIRA is a Windows desktop AI agent for a clinical diagnostics lab (Electron + TypeScript + React). This
repository is the **Meta hackathon build**: AIRA runs entirely on Meta's Muse models, talks and listens through
an animated mascot, and adds **Reagent Check**, a reagent reconciliation assistant.

AIRA itself existed before the hackathon (built internally for a lab and published here de-branded, on synthetic
data). The hackathon work is: the Muse integration, the talking mascot, the English UI, and Reagent Check — see
`git log` for the commits.

## What's new in this build

- **Meta Muse brain** — Muse Wonder answers with tools, Muse Spark handles quick and background calls, Muse
  Image creates and edits images, Muse Voice Transcribe turns speech into text (`src/main/hackathon/models.ts`).
  The Meta API only accepts `tool_choice: "auto"`; guards that must force a tool use a closing instruction
  instead (`src/main/llm/openai-compat.ts`).
- **Talking mascot** — click it, speak, check the transcript (sent after 2 s unless you cancel), and it reads a
  short spoken summary of the answer (`src/renderer/src/components/mascot/`).
- **Reagent Check** — reconciles the weekly reagent usage sheet (tests × per-test factor) and the month-end
  physical stock count against the tests the lab actually ran. It flags wrong item codes, per-test factors that
  are too high, consumables used faster than estimated, unit mismatches and missing counts — every finding with
  the file, sheet and row it came from. Every number is computed by code; the model only explains
  (`src/main/reagent/`, `src/renderer/src/views/ReagentHome.tsx`).

## Principles carried over from AIRA

- Approved query tools instead of text-to-SQL; business rules enforced in code.
- Guardrails in code, not prompts: unproven claims ("I tested it", "the document was cut") are removed, false
  refusals are recovered, tool results always state what was skipped.
- Patient data stays aggregate-only; a role × division permission matrix is enforced at the toolset and at tool
  execution.
- 1,600+ unit tests plus live checks against the database; behaviour fixes are locked by regression tests and
  verified in the running app.

## Run it

1. Node 22, a local PostgreSQL 13+ and a Meta Model API key.
2. Copy `.env.example` to `.env` and fill it in (`AIRA_API_KEY`, `AIRA_ENDPOINT=https://api.meta.ai`,
   `AIRA_MODEL=muse-wonder-1.0`, and the three local database URLs). This build refuses any non-local database.
3. `npm install`
4. `npm run seed:dummy` (synthetic sales, lab and master data) and `npm run seed:reagent` (Reagent Check demo
   files in `demo-data/reagent/`).
5. `npm run dev`, sign in with the seed account, open **Reagent Check**, choose `demo-data/reagent` and press
   **Run reconciliation**.

Checks: `npm test`, `npm run typecheck`, `npm run smoke:tools`, `npx tsx tests/reagent-live-check.ts`,
`npm run scrub:public`.

All data in this repository is synthetic.
