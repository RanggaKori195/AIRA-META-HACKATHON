import type { MenuId } from '../../shared/ipc'
import type { ToolGroup } from './tool-groups'

// Which menu permission guards each DATA tool group — the single table the execution-layer check reads.
// ⚠️ Rule 18: the hand-written check once covered only sales/inno/db, so lab and onedrive tools (added later)
// ran without a permission check. A new data group must be added HERE; tests/reagent-mode.test.ts fails for any
// registered tool whose group is neither listed here nor a known non-data group.
export const DATA_GROUP_MENU = {
  sales: 'sales',
  inno: 'masterdata',
  lab: 'lab',
  onedrive: 'onedrive',
  reagent: 'reagent'
} as const satisfies Partial<Record<ToolGroup, MenuId>>

export function menuUntukGrup(g: ToolGroup): MenuId | null {
  return Object.prototype.hasOwnProperty.call(DATA_GROUP_MENU, g)
    ? DATA_GROUP_MENU[g as keyof typeof DATA_GROUP_MENU]
    : null
}
