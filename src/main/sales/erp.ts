// Cakupan ERP.
//
// Data di SalesRepository adalah data operasional lab. Sebagian sudah ter-bridging
// ke ERP (sistem yang dipakai keuangan/manajemen), sebagian belum.
// Dua kolom penanda, sejalan dengan dua dasar pengakuan yang sudah dipakai AIRA:
//
//   basis order   -> bridging_status_to     = 'SUCCESS'  (ORDER sudah masuk ERP)
//   basis invoice -> bridging_status_result = 'SUCCESS'  (SALES/INVOICE sudah diakui di ERP)
//
// Modul ini murni (tanpa I/O) supaya bisa diuji: hanya memetakan scope+basis ke
// potongan SQL konstan — TIDAK ADA nilai dari model yang masuk ke string SQL.

export const ERP_SCOPES = ['all', 'erp', 'not_erp'] as const
export type ErpScope = (typeof ERP_SCOPES)[number]

/** Kolom flag bridging per dasar pengakuan. */
const FLAG_COLUMN: Record<string, string> = {
  order: 'bridging_status_to',
  invoice: 'bridging_status_result'
}

/**
 * Bridging ERP baru berjalan penuh sejak Desember 2025 (terverifikasi dari
 * data: seluruh transaksi sebelum 2025-12 berstatus NULL). Angka "ERP" untuk
 * periode sebelum itu wajar mendekati nol — bukan kehilangan data.
 */
export const ERP_BRIDGING_START = '2025-12-01'

export function isErpScope(value: unknown): value is ErpScope {
  return typeof value === 'string' && (ERP_SCOPES as readonly string[]).includes(value)
}

/** Potongan WHERE untuk scope tertentu. Konstan — aman digabung ke SQL. */
export function erpClause(scope: ErpScope, basisKey: string): string {
  if (scope === 'all') return ''
  const column = FLAG_COLUMN[basisKey]
  if (!column) return ''
  return scope === 'erp'
    ? ` AND ${column} = 'SUCCESS'`
    : ` AND ${column} IS DISTINCT FROM 'SUCCESS'`
}

/**
 * Keterangan yang WAJIB ikut di hasil tool supaya AIRA menyebutkannya ke user.
 * Peringatan "bridging baru mulai Des 2025" hanya disertakan bila periode yang
 * ditanya memang menyentuh masa itu — untuk periode berjalan cuma jadi kebisingan.
 */
export function erpNote(scope: ErpScope, basisKey: string, rangeFrom?: string): string {
  const column = FLAG_COLUMN[basisKey] ?? 'bridging_status_to'
  if (scope === 'all') {
    return 'seluruh transaksi di database lab, termasuk yang belum ter-bridging ke ERP'
  }
  const preBridging = typeof rangeFrom === 'string' && rangeFrom < ERP_BRIDGING_START
  if (scope === 'erp') {
    const base = `hanya yang sudah masuk ERP (${column} = 'SUCCESS')`
    return preBridging
      ? `${base}; bridging ERP baru berjalan penuh sejak ${ERP_BRIDGING_START}, ` +
          'jadi bagian periode sebelum itu wajar mendekati nol'
      : base
  }
  const base = `hanya yang BELUM/GAGAL masuk ERP (${column} <> 'SUCCESS')`
  return preBridging
    ? `${base}; sebagian besar berasal dari masa sebelum bridging jalan (${ERP_BRIDGING_START})`
    : base
}

const ERP_WORD = /\b(erp|orlan\s?soft|erp)\b/i
// English negation (final review 2 Nov 2026): "sales not yet in the ERP" / "orders missing from the ERP"
// were read as 'erp' — the exact opposite set of rows.
const NEGATIVE =
  /\b(belum|blm|tidak|belom|gagal|failed|pending|outstanding|unbridg\w*|not|missing|haven't|hasn't|isn't|aren't|wasn't|weren't)\b/i

/**
 * Guard di level KODE (bukan imbauan di prompt): kalau user menyebut ERP/ERP,
 * scope dipaksa — model 27B terbukti sering mengabaikan parameter opsional.
 * Scope yang sudah diisi model secara eksplisit tetap dihormati kecuali 'all'.
 */
export function scopeFromText(text: string): ErpScope | null {
  if (!ERP_WORD.test(text)) return null
  return NEGATIVE.test(text) ? 'not_erp' : 'erp'
}

const SALES_TOOL = /^sales_/

/** Normalisasi argumen tool sales sebelum dieksekusi. */
export function applyErpScope(
  toolName: string,
  args: Record<string, unknown>,
  userText: string
): Record<string, unknown> {
  if (!SALES_TOOL.test(toolName)) return args
  const forced = scopeFromText(userText)
  if (!forced) return args
  if (isErpScope(args.scope) && args.scope !== 'all') return args
  return { ...args, scope: forced }
}
