# AIRA — AI Lab Assistant

AIRA is a Windows desktop AI co-worker for a clinical diagnostics lab (Electron + TypeScript + React), running
entirely on **Meta Muse** models. You can talk to it: it greets you, reads a morning briefing, opens the right
screen when you ask by voice, reconciles reagent stock against the tests the lab ran, and answers in its own voice.

**Demo video (3:00):** recorded live in the app on synthetic data — every feature marked **NEW** in it was built
during the event.

## What was built during the event

AIRA existed before the hackathon (an internal assistant, published here de-branded on synthetic data).

- **In this repository**, the FIRST commit — "Pre-existing AIRA (built before the hackathon, de-branded)" — is the
  pre-event baseline. Every later commit is hackathon work, one snapshot per milestone:

  ```bash
  git log --oneline                                  # baseline first, then the hackathon milestones
  git diff --stat $(git rev-list --max-parents=0 HEAD) HEAD   # everything changed during the event
  ```

- This public history was cut from our development repository, where the baseline is commit **`a693286`**
  ("Baseline: AIRA 0.5.0 copy before META hackathon rework", 2 Nov 2026) followed by 66 event commits. The demo
  video's first card shows those development-repository numbers.

**NEW during the event**

- **Meta Muse brain** — Muse Wonder answers with tools, Muse Spark makes quick decisions (the voice agent), Muse
  Image makes images, Muse Voice Transcribe turns speech into text (`src/main/hackathon/models.ts`). The Meta API
  only accepts `tool_choice: "auto"`; guards that must force a tool use a closing instruction instead
  (`src/main/llm/openai-compat.ts`).
- **Voice co-worker** — on start AIRA greets you by name (asked once), reads the morning briefing, and opens the
  microphone. A spoken request becomes ONE action from a closed list, picked by Muse Spark, validated and checked
  against the user's menu permissions (`src/shared/agent-actions.ts`, `src/main/agent-voice/route.ts`).
- **AIRA's voice (ElevenLabs)** and an animated mascot that listens, thinks and speaks
  (`src/main/suara/tts.ts`, `src/renderer/src/components/mascot/`). Without an ElevenLabs key the Windows voice
  is used.
- **Morning briefing** — sales month to date vs the same days last month and the rising/falling tests (from the
  app's sales tools), what to order, one suggestion, and a "Trend" line from a web search of health news
  (`src/main/briefing/`). The Meta Muse API itself cannot search the web, so the trend uses the app's web search
  tool (You.com, optional key); its results are treated as untrusted data and listed as sources.
- **Number check** — every number Muse writes is looked up in the facts the code computed and marked if it is not
  there; a spoken briefing with an unmatched number falls back to a code-written one (`src/shared/number-check.ts`).
- **Reagent Check** — reconciles the weekly reagent usage sheet and the month-end stock count against the tests
  the lab ran. Four rules (wrong item code, per-test factor too high, used faster than estimated, unit mismatch),
  each finding with the exact file › sheet › row evidence (`src/main/reagent/`, `views/ReagentHome.tsx`).
- **Reorder & actions + Voice recount** — reorder list computed by code (whole packs, lead time + safety stock),
  an AI-drafted summary with its number check, Excel export, and a shelf recount by voice compared with the stock
  sheet.
- **Local synthetic demo database**, English UI, no employer identity in shipped files (`npm run scrub:public`).
- **`video/`** — the demo video, made with Remotion from a real recording of the app.

**EXISTING before the event (AIRA 0.5.0)** — chat with tools, the Ask Sales Data / Ask Master Data / Ask Sample
TAT menus and their dashboards, documents (PDF/Word/Excel/PowerPoint), images gallery, schedule, user/permission
admin. Where the video shows one of these (Ask Sales Data), it is labelled EXISTING and only what is new about it
(asked by voice, answer read aloud) is claimed.

## Setup (Windows)

**Requirements:** Windows 10/11, Node.js 22, a local **PostgreSQL 13+**, a Meta Model API key. Optional: an
ElevenLabs API key (voice) and a You.com API key (briefing trend).

1. **Create the database** (local only — the build refuses any non-local host):

   ```bash
   createdb -U postgres metahackton
   ```

   (or `CREATE DATABASE metahackton;` in psql / pgAdmin).

2. **Environment:** copy `.env.example` to `.env` and fill in the keys. All key variables are empty in the
   example; never commit `.env` or `.env.local` (both are git-ignored).

   | Variable | Needed | What |
   |---|---|---|
   | `AIRA_API_KEY` | yes | Meta Model API key (`AIRA_ENDPOINT=https://api.meta.ai`, `AIRA_MODEL=muse-wonder-1.0`) |
   | `AIRA_SALES_DB`, `AIRA_LOGIN_DB`, `AIRA_INNO_DB` | yes | `postgresql://postgres:<your password>@localhost:5432/metahackton` (all three the same) |
   | `ELEVENLABS_API_KEY` | optional | AIRA's voice (else the Windows voice); `ELEVENLABS_VOICE_ID` optional |
   | `AIRA_YOU_API_KEY` | optional | web search for the briefing's Trend line |

3. **Install:** `npm install`

4. **Tables + dummy data:**

   ```bash
   npm run seed:dummy
   npm run seed:reagent
   ```

   - There is **no Prisma/ORM**: the app talks to PostgreSQL with `pg` and plain SQL. The **DDL** for the source
     tables is in `scripts/seed/ddl.ts` (`public."SalesRepository"`, customer/item/province/city masters, the sample
     tracker, and the master-data schema `inno`).
   - `seed:dummy` drops and recreates ONLY those source tables and fills them with **synthetic, deterministic**
     data up to the current hour (no patient columns at all). Re-run it on the day you test: the proactive monitor
     flags "data stalled" after 24 h without new rows, and the briefing compares this month with last month.
   - `seed:reagent` writes the Reagent Check demo workbooks to `demo-data/reagent/` (four planted anomalies, plus a
     voice-recount script and WAV).
   - The app's own tables (`tb_*_aira`: users, permissions, chat, monitoring…) are created automatically on the
     first start.

5. **Run:** `npm run dev`, then sign in with the local demo account **`superadmin` / `12345`** (created on first
   start; local dummy database only).

## Try it

- **Home** → the morning briefing (or press **Brief me**). Click the mascot and say:
  - "Please check the reagents for this month." → AIRA opens Reagent Check and runs it.
  - "Summarize the reagent check." → reorder list + AI summary with its number check.
  - "What were sales last month?" → AIRA opens Ask Sales Data, answers, and reads the answer aloud.
- **Reagent Check** → choose `demo-data/reagent`, **Run reconciliation**, press **Evidence** on a finding,
  **Reorder & actions**, **Voice recount** (record, or paste `demo-data/reagent/voice-count-2026-10.txt`).

## Checks

```bash
npm test                 # unit tests (1,887)
npm run typecheck
npm run smoke:tools      # every data tool once, in the Electron runtime
npx tsx tests/reagent-live-check.ts
npm run scrub:public     # no employer identity in public files
cd video && npm test     # the demo-video pipeline
```

## Principles carried over from AIRA

- Approved query tools instead of text-to-SQL; business rules enforced in code.
- Guardrails in code, not prompts: unproven claims ("I tested it", "the document was cut") are removed, tool
  results always state what was skipped, numbers come from code.
- Patient data stays aggregate-only; a role × division permission matrix is enforced at the toolset and at tool
  execution.

All data in this repository is synthetic.
