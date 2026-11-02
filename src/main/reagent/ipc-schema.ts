import { z } from 'zod'

// Inputs crossing IPC for Reagent Check (rule 11: every field is declared, unknown fields are dropped).
export const ReagentMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .optional()
export const ReagentFindingId = z.string().min(1).max(120)
/** Evidence request: the finding id and the month it came from; the folder is taken from the session. */
export const ReagentEvidenceInput = z.object({ findingId: ReagentFindingId, month: ReagentMonth })
