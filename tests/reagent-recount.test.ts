import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { compareRecount, parseNumber, parseRecount } from '../src/shared/recount'
import type { RecountItem } from '../src/shared/reagent'

let row = 1
const it = (itemCode: string, itemName: string, baseUnit: string, packSize: number, packUnit: string, closing: number | null, reason?: string): RecountItem => ({
  itemCode, itemName, baseUnit, packSize, packUnit, opnameUnit: baseUnit, closing, ...(reason ? { reason } : {}),
  refs: [{ file: 'Stock_Opname_2026-10.xlsx', sheet: 'Stock Opname', row: ++row }]
})
const ITEMS: RecountItem[] = [
  it('RGT-HPV-HR', 'HPV DNA High Risk Kit', 'test', 96, 'box', 288),
  it('RGT-HPV-GT14', 'HPV Genotyping 14 Reagent Kit', 'test', 48, 'box', 213),
  it('RGT-HPV-GT28', 'HPV Genotyping 28 Reagent Kit', 'test', 48, 'box', 96),
  it('KIT-DNA-EXT', 'DNA Extraction Kit', 'test', 50, 'box', 150),
  it('TIP-FLT-200', 'Filter Tips 200 uL', 'pcs', 96, 'rack', 3840),
  it('RGT-EGFR', 'EGFR Mutation Kit', 'test', 24, 'box', 72),
  it('ETH-ABS', 'Ethanol Absolute', 'mL', 1000, 'bottle', null, 'cannot convert "kit" to mL')
]
const one = (text: string) => {
  const rows = parseRecount(text, ITEMS)
  assert.equal(rows.length, 1, JSON.stringify(rows))
  return rows[0]
}

describe('voice recount: numbers', () => {
  test('digits and number words', () => {
    assert.equal(parseNumber('16'), 16)
    assert.equal(parseNumber('2.5'), 2.5)
    assert.equal(parseNumber('sixteen'), 16)
    assert.equal(parseNumber('a'), 1)
    assert.equal(parseNumber('box'), null)
  })

  test('number words with and/hyphen', () => {
    assert.equal(parseNumber('two hundred and thirteen'), 213)
    assert.equal(parseNumber('twenty-four'), 24)
    assert.equal(parseNumber('nine hundred ninety-nine'), 999)
  })
})

describe('voice recount: parsing phrases', () => {
  test('name digits are not the count', () => {
    const r = one('Filter tips two hundred microliter, forty racks')
    assert.equal(r.itemCode, 'TIP-FLT-200')
    assert.equal(r.count, 40)
    assert.equal(r.unit, 'rack')
    assert.equal(r.voiceBase, 3840)
    assert.equal(r.status, 'matches')
  })

  test('spoken code matches', () => {
    assert.equal(one('KIT DNA EXT 3 boxes').itemCode, 'KIT-DNA-EXT')
    assert.equal(one('kit-dna-ext, three boxes').count, 3)
  })

  test('ambiguous → unclear with candidates', () => {
    const r = one('HPV genotyping kit, five boxes')
    assert.equal(r.status, 'unclear')
    assert.equal(r.itemCode, null)
    assert.deepEqual([...r.candidates].sort(), ['RGT-HPV-GT14', 'RGT-HPV-GT28'])
    assert.equal(r.count, null) // read once the item is picked (final review fix)
    assert.equal(compareRecount([{ ...r, itemCode: 'RGT-HPV-GT14' }], ITEMS).rows[0].count, 5)
  })

  test('missing unit → pack unit, unitAssumed', () => {
    const r = one('EGFR mutation kit, three')
    assert.equal(r.unit, 'box')
    assert.equal(r.unitAssumed, true)
    assert.equal(r.voiceBase, 72)
    assert.equal(r.status, 'matches')
  })

  test('unknown unit → unclear', () => {
    const r = one('DNA extraction kit, 3 crates')
    assert.equal(r.status, 'unclear')
    assert.match(r.reason ?? '', /unit/)
  })

  test('said twice', () => {
    const rows = parseRecount('EGFR mutation kit, three boxes. EGFR mutation kit, two boxes.', ITEMS)
    assert.deepEqual(rows.map((r) => r.status), ['said_twice', 'said_twice'])
    assert.ok(rows.every((r) => r.diffBase === null))
  })

  test('not recognized', () => {
    const r = one('Proteinase K, five vials')
    assert.equal(r.status, 'not_recognized')
    assert.equal(r.phrase, 'Proteinase K, five vials')
  })

  test('not comparable', () => {
    const r = one('Ethanol absolute, two bottles')
    assert.equal(r.itemCode, 'ETH-ABS')
    assert.equal(r.status, 'not_comparable')
    assert.match(r.reason ?? '', /cannot convert "kit"/)
  })
})

describe('voice recount: compare', () => {
  test('differs vs matches and not counted', () => {
    const text =
      'HPV DNA high risk kit, three boxes. EGFR mutation kit, two boxes.\n' +
      'HPV genotyping fourteen reagent kit, two hundred and thirteen tests'
    const { rows, notCounted } = compareRecount(parseRecount(text, ITEMS), ITEMS)
    const by = Object.fromEntries(rows.map((r) => [r.itemCode, r]))
    assert.equal(by['RGT-HPV-HR'].status, 'matches')
    assert.equal(by['RGT-HPV-GT14'].status, 'matches')
    assert.equal(by['RGT-EGFR'].status, 'differs')
    assert.equal(by['RGT-EGFR'].diffBase, -24)
    assert.equal(by['RGT-EGFR'].diffPacks, -1)
    assert.deepEqual(by['RGT-EGFR'].refs, ITEMS[5].refs)
    assert.deepEqual(notCounted.map((i) => i.itemCode).sort(), ['ETH-ABS', 'KIT-DNA-EXT', 'RGT-HPV-GT28', 'TIP-FLT-200'])
  })

  test('compareRecount after an edit', () => {
    const [r] = parseRecount('HPV genotyping kit, two hundred and thirteen tests', ITEMS)
    assert.equal(r.status, 'unclear')
    const { rows } = compareRecount([{ ...r, itemCode: 'RGT-HPV-GT14' }], ITEMS)
    assert.equal(rows[0].status, 'matches')
    const { rows: rows2 } = compareRecount([{ ...r, itemCode: 'RGT-HPV-GT28' }], ITEMS)
    assert.equal(rows2[0].status, 'differs')
    assert.equal(rows2[0].diffBase, 117)
  })
})

describe('voice recount: a unit word inside the name', () => {
  test('"PCR tubes 0.2 milliliter, 600 pieces" stays one phrase even when an item counts in mL', () => {
    const items = [
      ...ITEMS,
      it('TUBE-PCR-02', 'PCR Tubes 0.2 mL', 'pcs', 1000, 'bag', 600),
      it('PCR-MM', 'PCR Master Mix', 'mL', 1.25, 'tube', 2.5)
    ]
    const rows = parseRecount('PCR tubes 0.2 milliliter, 600 pieces. HPV DNA high risk kit 3 boxes, DNA extraction kit 3 boxes', items)
    assert.deepEqual(rows.map((r) => [r.itemCode, r.status]), [['TUBE-PCR-02', 'matches'], ['RGT-HPV-HR', 'matches'], ['KIT-DNA-EXT', 'matches']])
  })
})

describe('voice recount: counts above 999', () => {
  test('thousands as digits with a separator, as plain digits, and as words', () => {
    assert.equal(parseNumber('seven thousand three hundred and seventy-two'), 7372)
    assert.equal(parseNumber('two thousand'), 2000)
    for (const t of ['Filter tips 200 microliter, 3,840 pieces', 'Filter tips 200 microliter, 3840 pieces', 'Filter tips two hundred microliter, three thousand eight hundred and forty pieces']) {
      const r = one(t)
      assert.equal(r.itemCode, 'TIP-FLT-200', t)
      assert.equal(r.count, 3840, t)
      assert.equal(r.status, 'matches', t)
    }
  })
})

describe('voice recount: a real Muse Voice Transcribe transcript (app test, 2 Nov 2026)', () => {
  // Recorded from the demo WAV through a fake microphone. Note the sentence break between name and count, the
  // run-on end without punctuation, "crass" for KRAS, "thin prep preserve vial", and the clip looping into a
  // second "HPV DNA high risk kit 3".
  const T =
    'DNA high risk kit. Three boxes. HPV genotyping 14 reagent kit, 240 tests. HPV genotyping 28 reagent kit, 236 tests. ' +
    'DNA extraction kit, 1193 tests. Filter tips 200 microliter, 7372 pieces. PCR tubes 0.2 milliliter, 2213 pieces. ' +
    'EGFR mutation kit, 56 tests crass mutation kit 8 tests NRAS mutation kit 100 tests thin prep preserve vial 21 pieces ' +
    'proteinase k 5 vials HPV HPV DNA high risk kit 3'
  const items = [
    it('RGT-HPV-HR', 'HPV DNA High Risk Kit', 'test', 96, 'box', 288),
    it('RGT-HPV-GT14', 'HPV Genotyping 14 Reagent Kit', 'test', 48, 'box', 240),
    it('RGT-HPV-GT28', 'HPV Genotyping 28 Reagent Kit', 'test', 48, 'box', 236),
    it('KIT-DNA-EXT', 'DNA Extraction Kit', 'test', 50, 'box', 1193),
    it('TIP-FLT-200', 'Filter Tips 200 uL', 'pcs', 96, 'rack', 7372),
    it('TUBE-PCR-02', 'PCR Tubes 0.2 mL', 'pcs', 1000, 'bag', 2213),
    it('RGT-EGFR', 'EGFR Mutation Kit', 'test', 24, 'box', 80),
    it('RGT-KRAS', 'KRAS Mutation Kit', 'test', 24, 'box', 8),
    it('RGT-NRAS', 'NRAS Mutation Kit', 'test', 24, 'box', 100),
    it('ETH-ABS', 'Ethanol Absolute', 'mL', 1000, 'bottle', null, 'cannot convert "kit" to mL'),
    it('PCR-MM', 'PCR Master Mix', 'mL', 1.25, 'tube', 6.31),
    it('LBC-VIAL', 'ThinPrep PreservCyt Vial', 'pcs', 100, 'box', 21)
  ]
  test('every spoken item is read; only the planted difference differs', () => {
    const rows = parseRecount(T, items)
    const got = rows.map((r) => `${r.itemCode ?? r.phrase}:${r.status}`)
    assert.deepEqual(got, [
      'RGT-HPV-HR:said_twice',
      'RGT-HPV-GT14:matches',
      'RGT-HPV-GT28:matches',
      'KIT-DNA-EXT:matches',
      'TIP-FLT-200:matches',
      'TUBE-PCR-02:matches',
      'RGT-EGFR:differs',
      'crass mutation kit 8 tests:unclear',
      'RGT-NRAS:matches',
      'LBC-VIAL:matches',
      'proteinase k 5 vials:not_recognized',
      'RGT-HPV-HR:said_twice'
    ])
    assert.equal(rows[0].count, 3)
    assert.ok(rows[7].candidates.includes('RGT-KRAS'))
  })
})

describe('final review fixes', () => {
  const more = [
    ...ITEMS,
    it('LBC-VIAL', 'ThinPrep PreservCyt Vial', 'pcs', 100, 'box', 21),
    it('TUBE-PCR-02', 'PCR Tubes 0.2 mL', 'pcs', 1000, 'bag', 2213)
  ]
  test('a count noun that names the item itself is a piece, not a pack', () => {
    const v = parseRecount('ThinPrep PreservCyt Vial, twenty-one vials', more)[0]
    assert.equal(v.unit, 'pcs')
    assert.equal(v.status, 'matches')
    const t = parseRecount('PCR tubes 0.2 milliliter, 2213 tubes', more)[0]
    assert.equal(t.unit, 'pcs')
    assert.equal(t.status, 'matches')
    // a kit of tests is still the pack
    const k = parseRecount('EGFR mutation kit, three kits', more)[0]
    assert.equal(k.unit, 'box')
    assert.equal(k.voiceBase, 72)
  })

  test('an ambiguous match reads no count; picking the item re-reads it from the phrase', () => {
    const [r] = parseRecount('HPV Genotyping 28 Reagent Kit, fourteen tests', ITEMS)
    if (r.status === 'unclear') {
      assert.equal(r.count, null)
      const { rows } = compareRecount([{ ...r, itemCode: 'RGT-HPV-GT28' }], ITEMS)
      assert.equal(rows[0].count, 14)
      assert.equal(rows[0].diffBase, 14 - 96)
    } else {
      assert.equal(r.itemCode, 'RGT-HPV-GT28')
      assert.equal(r.count, 14)
    }
  })

  test('a very long run-on phrase is shortened so it can still be exported', async () => {
    const { RecountRowSchema } = await import('../src/main/reagent/ipc-schema')
    const long = Array(60).fill('KRAS mutation kit eight NRAS mutation kit one hundred').join(' ')
    const rows = parseRecount(long, ITEMS)
    assert.ok(rows.every((r) => r.phrase.length <= 500))
    assert.ok(rows.every((r) => RecountRowSchema.safeParse(r).success))
  })
})
