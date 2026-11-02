import { z } from 'zod'

// Inputs crossing IPC for Reagent Check (rule 11: every field is declared, unknown fields are dropped).
export const ReagentMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .optional()
export const ReagentFindingId = z.string().min(1).max(120)
/** Evidence request: the finding id and the month it came from; the folder is taken from the session. */
export const ReagentEvidenceInput = z.object({ findingId: ReagentFindingId, month: ReagentMonth })

const Ref = z.object({ file: z.string().max(260), sheet: z.string().max(120), row: z.number().int().positive() })
const Num = z.number().finite().nullable()
/** One reviewed voice-recount row (src/shared/recount.ts); export re-checks its item code against the month. */
export const RecountRowSchema = z.object({
  id: z.string().max(40),
  phrase: z.string().max(500),
  itemCode: z.string().max(80).nullable(),
  candidates: z.array(z.string().max(80)).max(20),
  count: Num,
  heardUnit: z.string().max(40).nullable(),
  unit: z.string().max(40).nullable(),
  unitAssumed: z.boolean(),
  voiceBase: Num,
  fileBase: Num,
  diffBase: Num,
  diffPacks: Num,
  status: z.enum(['matches', 'differs', 'unclear', 'said_twice', 'not_recognized', 'not_comparable']),
  reason: z.string().max(300).optional(),
  refs: z.array(Ref).max(50)
})
/** Export request: the month and the reviewed recount rows; the folder comes from the session, the path from a dialog. */
export const ReagentExportInput = z.object({ month: ReagentMonth, recount: z.array(RecountRowSchema).max(500) })
