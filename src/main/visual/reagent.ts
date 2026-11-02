import type { KartuVisual, Sel } from '../../shared/visual'

// Visual card for reagent_reconcile — redraws the SAME result the model read (no extra query, no new numbers).

type J = Record<string, any>

const TYPE_LABEL: Record<string, string> = {
  wrong_item_code: 'Wrong item code',
  factor_too_high: 'Factor too high',
  used_faster: 'Used faster',
  unit_mismatch: 'Unit mismatch',
  no_physical_count: 'No physical count'
}

const num = (v: unknown): Sel => (typeof v === 'number' ? { nilai: v, satuan: 'angka' } : '—')

export function reagentCard(j: J): KartuVisual | null {
  if (!Array.isArray(j.findings) || !j.summary) return null
  const findings = j.findings as J[]
  const t = j.thresholds ?? {}
  const notChecked = Array.isArray(j.notChecked) ? (j.notChecked as J[]) : []
  const ncCount = Number(j.summary.notCheckedCount ?? notChecked.length)
  return {
    tool: 'reagent_reconcile',
    judul: 'Reagent reconciliation',
    sub: `${j.month} · ${(j.filesRead ?? []).join(' + ')}`,
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: 'Items checked', nilai: Number(j.summary.itemsChecked ?? 0), satuan: 'angka' },
          { label: 'Findings', nilai: findings.length, satuan: 'angka' },
          { label: 'Not checked', nilai: ncCount, satuan: 'angka' },
          { label: 'Rows skipped', nilai: Number(j.summary.skippedCount ?? 0), satuan: 'angka' }
        ]
      },
      {
        jenis: 'tabel',
        judul: 'Findings',
        kolom: [
          { label: 'Type' },
          { label: 'Item' },
          { label: 'Estimated', kanan: true },
          { label: 'Actual', kanan: true },
          { label: 'Actual ÷ est.', kanan: true },
          { label: 'Evidence' }
        ],
        baris: findings.map((f): Sel[] => [
          TYPE_LABEL[f.type] ?? String(f.type),
          `${f.itemCode} — ${f.itemName}`,
          num(f.estimated),
          num(f.actual),
          typeof f.ratio === 'number' ? `${f.ratio.toFixed(2)}×` : '—',
          (f.evidence ?? []).map((e: J) => `${e.file} › ${e.sheet} › row ${e.row}`).join('; ')
        ])
      }
    ],
    catatan: [
      `Flagged when the estimate is ≥ ${t.factorHigh ?? 2}× the actual use (factor too high) or the actual use is ≥ ${t.usedFaster ?? 1.5}× the estimate (used faster).`,
      'Actual use = opening stock + received − physical closing count; estimated = tests run × the sheet factor.',
      ...(ncCount > 0
        ? [
            `${ncCount} item${ncCount > 1 ? 's' : ''} could not be checked (not confirmed as fine): ` +
              notChecked.map((n) => `${n.itemCode} — ${n.reason}`).join('; ') +
              (notChecked.length < ncCount ? `; and ${ncCount - notChecked.length} more` : '') +
              '.'
          ]
        : [])
    ]
  }
}
