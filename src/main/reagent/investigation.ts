// Investigation checklist (pure). The steps per finding type are fixed here, not written by the model, so the list
// is the same every time and never invents a step; roles are only suggestions. Numbers come from the finding.
import type { Finding, InvestigationItem, InvestigationKind, RecountDiffer, SourceRef } from '../../shared/reagent'

type Step = { text: string; role: string }
const SUPERVISOR = 'Lab supervisor (suggested)'
const INVENTORY = 'Inventory staff (suggested)'
const QA = 'QA officer (suggested)'

const fmt = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 3 })

interface Source {
  itemCode: string
  itemName: string
  unit: string
  impliedFactor: number | null
  diffBase: number | null
  diffPacks: number | null
}

const STEPS: Record<InvestigationKind, (s: Source) => Step[]> = {
  wrong_item_code: (s) => [
    { text: `Check the Item List / item master for the code used and for ${s.itemCode}.`, role: INVENTORY },
    { text: 'Find who booked the usage under the unknown code, and in which weeks (see the evidence rows).', role: SUPERVISOR },
    { text: `Correct the booking in the usage sheet to ${s.itemCode}.`, role: INVENTORY }
  ],
  factor_too_high: (s) => [
    { text: `Compare the per-test factor in the usage sheet with the kit insert / SOP for ${s.itemName}.`, role: QA },
    { text: 'Check which tests are linked to the item in the Item List.', role: SUPERVISOR },
    {
      text:
        'Update the per-test factor in the usage sheet' +
        (s.impliedFactor !== null ? ` (the count implies ${fmt(s.impliedFactor)} ${s.unit} per test).` : '.'),
      role: SUPERVISOR
    }
  ],
  used_faster: () => [
    { text: 'Check for repeat runs, failed runs and QC use in the period.', role: QA },
    { text: 'Check for waste, breakage or expiry write-offs.', role: INVENTORY },
    { text: 'Check for usage that was not recorded in the usage sheet.', role: SUPERVISOR }
  ],
  unit_mismatch: () => [
    { text: 'Confirm which unit was used in the stock count and in the usage sheet.', role: INVENTORY },
    { text: 'Fix the unit, or the pack size, in the Item List so both convert to the base unit.', role: INVENTORY }
  ],
  no_physical_count: (s) => [
    { text: `Count the item (${s.itemName}) physically.`, role: INVENTORY },
    { text: 'Add it to the stock-opname file.', role: INVENTORY }
  ],
  recount_differs: () => [
    { text: 'Recount the item a third time.', role: INVENTORY },
    { text: 'Check deliveries received after the count date.', role: INVENTORY },
    { text: 'If the recount stands, correct the Closing Count in the stock-opname file.', role: SUPERVISOR }
  ]
}

const HEADLINE: Record<InvestigationKind, (s: Source) => string> = {
  wrong_item_code: (s) => `Usage for ${s.itemName} (${s.itemCode}) was booked under a code that is not in the Item List`,
  factor_too_high: (s) => `Per-test factor looks too high for ${s.itemName}`,
  used_faster: (s) => `${s.itemName} was used faster than the tests explain`,
  unit_mismatch: (s) => `Unit of ${s.itemName} cannot be converted`,
  no_physical_count: (s) => `${s.itemName} has no physical count`,
  recount_differs: (s) =>
    `Voice recount of ${s.itemName} differs from the Closing Count by ${fmt(s.diffBase ?? 0)} ${s.unit}` +
    (s.diffPacks !== null ? ` (${fmt(s.diffPacks)} pack${Math.abs(s.diffPacks) === 1 ? '' : 's'})` : '')
}

function item(id: string, kind: InvestigationKind, s: Source, evidence: SourceRef[]): InvestigationItem {
  return { id, kind, itemCode: s.itemCode, itemName: s.itemName, headline: HEADLINE[kind](s), steps: STEPS[kind](s), evidence }
}

export function buildInvestigation(findings: Finding[], recountDiffers: RecountDiffer[] = []): InvestigationItem[] {
  return [
    ...findings.map((f) =>
      item(f.id, f.type, { itemCode: f.itemCode, itemName: f.itemName, unit: f.unit, impliedFactor: f.impliedFactor, diffBase: null, diffPacks: null }, f.evidence)
    ),
    ...recountDiffers.map((d) =>
      item(
        `recount_differs:${d.itemCode}`,
        'recount_differs',
        { itemCode: d.itemCode, itemName: d.itemName, unit: d.unit ?? 'base units', impliedFactor: null, diffBase: d.diffBase, diffPacks: d.diffPacks },
        d.refs
      )
    )
  ]
}
