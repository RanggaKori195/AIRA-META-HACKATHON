// Hackathon build: every model call goes to the Meta Model API.
//
// One place for the Muse model ids, so config defaults, image and voice code cannot drift apart.
// Contributor tiers (`*-contributor`) are never used: their inputs train Meta's models.

export const META_ENDPOINT = 'https://api.meta.ai'

export const MUSE = {
  /** User-facing answers with tools (agent and coding turns). */
  agent: 'muse-wonder-1.0',
  /** Quick turns and background calls (memory extraction, perspective sub-calls). */
  quick: 'muse-spark-1.3',
  /** Reading images and scanned PDF pages. */
  vision: 'muse-spark-1.3',
  image: 'muse-image-1.0',
  speech: 'muse-voice-transcribe-1.0'
} as const

export type ModelRole = 'agent' | 'chat' | 'coder' | 'parser'

const ROLE_DEFAULT: Record<ModelRole, string> = {
  agent: MUSE.agent,
  coder: MUSE.agent,
  chat: MUSE.quick,
  parser: MUSE.vision
}

/**
 * A config saved by an older run may still hold a company-gateway id (`old-think-model`) — sending it to
 * Meta fails every turn. Empty, `AURA*` and contributor ids become the Muse id for that role.
 */
export function migrateModelId(id: string | undefined, role: ModelRole): string {
  if (!id || /^AURA/i.test(id) || /-contributor$/i.test(id)) return ROLE_DEFAULT[role]
  return id
}

const FIELD_ROLE: Record<string, ModelRole> = {
  modelId: 'agent',
  chatModelId: 'chat',
  coderModelId: 'coder',
  parserModelId: 'parser'
}

/** Applies `migrateModelId` to the four model fields of a raw config object (other fields untouched). */
export function migrateRawModels(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const out: Record<string, unknown> = { ...(raw as Record<string, unknown>) }
  for (const [field, role] of Object.entries(FIELD_ROLE)) {
    const v = out[field]
    if (v === undefined) continue
    out[field] = migrateModelId(typeof v === 'string' ? v : undefined, role)
  }
  // Muse Wonder is the default answer model. A config saved before that holds `auto` (which sends plain
  // questions to Muse Spark) only because Auto used to be the default — it moves to Wonder ONCE; Auto picked
  // again afterwards is kept (the flag is saved with it).
  if (out.wonderDefault !== true) {
    if (out.modelChoice === 'auto') out.modelChoice = 'agent'
    out.wonderDefault = true
  }
  return out
}
