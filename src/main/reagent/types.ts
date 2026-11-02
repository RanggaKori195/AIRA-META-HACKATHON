// Reagent Check — shared types (engine, tools, IPC, screen, seed).

export type { FindingType, SourceRef, Skipped } from '../../shared/reagent'
export { FINDING_TYPES } from '../../shared/reagent'
import type { SourceRef } from '../../shared/reagent'

export interface ItemRow {
  code: string
  rawCode: string
  name: string
  baseUnit: string
  packSize: number
  packUnit: string
  tests: string[]
  factor: number
  ref: SourceRef
}

export interface UsageRow {
  week: string
  code: string
  rawCode: string
  name: string
  tests: string[]
  volume: number
  factor: number
  estimated: number | null
  unit: string
  ref: SourceRef
}

export interface OpnameRow {
  code: string
  rawCode: string
  name: string
  opening: number
  received: number
  closing: number
  unit: string
  ref: SourceRef
}
