import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { MUSE, META_ENDPOINT, migrateModelId, migrateRawModels } from '../src/main/hackathon/models'
import { ConfigSchema } from '../src/main/config'

const src = (p: string): string => readFileSync(p, 'utf8')

describe('Muse model ids by role', () => {
  test('ids and endpoint', () => {
    assert.equal(MUSE.agent, 'muse-wonder-1.0')
    assert.equal(MUSE.quick, 'muse-spark-1.3')
    assert.equal(MUSE.vision, 'muse-spark-1.3')
    assert.equal(MUSE.image, 'muse-image-1.0')
    assert.equal(MUSE.speech, 'muse-voice-transcribe-1.0')
    assert.equal(META_ENDPOINT, 'https://api.meta.ai')
  })

  test('old AURA ids migrate to the Muse id of their role', () => {
    // Legacy company-gateway ids, assembled so the public repository carries no gateway model names.
    const legacy = (s: string): string => ['AURA', s].join('-')
    assert.equal(migrateModelId(legacy('think'), 'agent'), 'muse-wonder-1.0')
    assert.equal(migrateModelId('AURA', 'chat'), 'muse-spark-1.3')
    assert.equal(migrateModelId(legacy('parser'), 'parser'), 'muse-spark-1.3')
    assert.equal(migrateModelId(legacy('coder'), 'coder'), 'muse-wonder-1.0')
  })

  test('contributor tiers are never kept (inputs train Meta models)', () => {
    assert.equal(migrateModelId('muse-spark-1.3-contributor', 'chat'), 'muse-spark-1.3')
  })

  test('empty becomes the role default, a valid Muse id is kept', () => {
    assert.equal(migrateModelId(undefined, 'coder'), 'muse-wonder-1.0')
    assert.equal(migrateModelId('', 'agent'), 'muse-wonder-1.0')
    assert.equal(migrateModelId('muse-wonder-1.0', 'chat'), 'muse-wonder-1.0')
  })

  test('config defaults are Muse', () => {
    const c = ConfigSchema.parse({})
    assert.equal(c.modelId, 'muse-wonder-1.0')
    assert.equal(c.chatModelId, 'muse-spark-1.3')
    assert.equal(c.coderModelId, 'muse-wonder-1.0')
    assert.equal(c.parserModelId, 'muse-spark-1.3')
  })

  test('loadConfig migrates the four model fields before parsing', () => {
    const s = src('src/main/config.ts')
    const load = s.slice(s.indexOf('export function loadConfig'))
    assert.match(load, /migrateRawModels\(raw\)/)
  })

  test('no AURA literal left in config, bundled fallback or setup screen', () => {
    for (const f of ['src/main/config.ts', 'src/main/bundled-config.ts', 'src/renderer/src/views/Setup.tsx']) {
      assert.doesNotMatch(src(f), /'AURA/, f)
    }
    assert.doesNotMatch(src('src/main/bundled-config.ts'), /gateway/)
  })

  test('model picker labels name the Muse models', () => {
    const s = src('src/renderer/src/components/ModelPicker.tsx')
    for (const label of ["'Auto'", "'Fast (Muse Spark)'", "'Smart (Muse Wonder)'", "'Coding (Muse Wonder)'"]) {
      assert.ok(s.includes(`label: ${label}`), label)
    }
  })
})

describe('Muse Wonder is the default model', () => {
  test('a fresh config answers with Muse Wonder, not Auto', () => {
    const c = ConfigSchema.parse({})
    assert.equal(c.modelChoice, 'agent')
    assert.equal(c.modelId, MUSE.agent)
  })

  test('a saved Auto from before this change moves to Muse Wonder once', () => {
    const out = migrateRawModels({ modelChoice: 'auto' }) as Record<string, unknown>
    assert.equal(out.modelChoice, 'agent')
    assert.equal(out.wonderDefault, true)
    // The flag survives the schema, so the move happens once.
    assert.equal(ConfigSchema.parse(out).wonderDefault, true)
  })

  test('Auto chosen after the move is kept', () => {
    const out = migrateRawModels({ modelChoice: 'auto', wonderDefault: true }) as Record<string, unknown>
    assert.equal(out.modelChoice, 'auto')
  })

  test('an explicit Fast or Coding choice is never overwritten', () => {
    for (const choice of ['chat', 'coder']) {
      assert.equal((migrateRawModels({ modelChoice: choice }) as Record<string, unknown>).modelChoice, choice)
    }
  })

  test('the screen starts on Muse Wonder before the saved choice loads', () => {
    assert.match(src('src/renderer/src/App.tsx'), /useState<ModelChoice>\('agent'\)/)
  })

  test('the picker lists Muse Wonder first', () => {
    const picker = src('src/renderer/src/components/ModelPicker.tsx')
    assert.ok(picker.indexOf("value: 'agent'") < picker.indexOf("value: 'auto'"), 'Wonder is not the first option')
  })
})
