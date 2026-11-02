// Dasar pengakuan: SALES diakui saat hasil/invoice keluar, bukan saat order diterima.
//
// Ketentuan pemilik data (18 Agu 2026):
//   - pertanyaan "SALES kita berapa"       -> date_result   (basis invoice)  ← YANG DIAKUI
//   - pertanyaan "ORDER YANG MASUK berapa" -> date_received (basis order)
//
// Karena itu DEFAULT-nya invoice. Sebelumnya default-nya order, sehingga pertanyaan
// "berapa sales bulan ini" dijawab memakai dasar yang tidak diakui — bedanya nyata:
// YTD Jan–Jul 2026 vs 2025 memberi +87,8% (order) versus +98,0% (invoice).
//
// Modul murni (tanpa I/O) supaya ter-cover unit test.

export type BasisKey = 'order' | 'invoice'

/** Dasar pengakuan yang dipakai bila tidak ada petunjuk sama sekali. */
export const DEFAULT_BASIS: BasisKey = 'invoice'

/** Menandakan user menanyakan ORDER YANG MASUK. */
const ORDER_WORDS =
  /\b(order|orders|orderan|pesanan|registrasi|registrations?|pendaftaran|sampel masuk|samples? received|date_received)\b/i

/**
 * "order" used as a SORTING word, removed before ORDER_WORDS is tested.
 *
 * ⚠️ Final review 2 Nov 2026: "top 10 customers by sales in descending order" / "list items ordered by
 * revenue" switched to order basis (date_received) — a sales ranking reported on the basis the company
 * does not recognise (rule 4). Bare "ordered" and "came in" were dropped from ORDER_WORDS for the same
 * reason ("how much revenue came in"). "sales order by branch" keeps its order meaning (lookbehind).
 */
const SORT_PHRASES =
  /\b(?:in|by)\s+(?:descending|ascending)\s+order(?:\s+of)?\b|\bin\s+order\s+of\b|\b(?<!sales\s)order\s+by\b|\bordered\s+by\b|\bsort(?:ed)?\s+by\b/gi

/** Menandakan user menanyakan invoice/tagihan secara eksplisit. */
const INVOICE_WORDS = /\b(invoice|invoices|invoiced|invois|faktur|tagihan|billing|billed|ditagih|date_result)\b/i

/** Kata penjualan biasa — semuanya berarti penjualan yang DIAKUI (date_result). */
const SALES_WORDS =
  /\b(sales|penjualan|omzet|omset|revenue|turnover|income|pendapatan|nett|netto|net|gross|growth|pertumbuhan|ytd)\b/i

/**
 * Menyimpulkan dasar pengakuan dari kalimat user.
 * `null` berarti kalimatnya tidak memberi petunjuk (mis. "kalau bulan lalu?") —
 * di situ pilihan model dihormati, dan bila model pun diam, DEFAULT_BASIS berlaku.
 *
 * Urutannya penting: "sales order ERP" adalah pertanyaan ORDER walaupun memuat
 * kata "sales", sedangkan "sales invoice ERP" adalah pertanyaan invoice.
 */
export function basisFromText(text: string): BasisKey | null {
  const adaOrder = ORDER_WORDS.test(text.replace(SORT_PHRASES, ' '))
  const adaInvoice = INVOICE_WORDS.test(text)
  if (adaOrder && !adaInvoice) return 'order'
  if (adaInvoice) return 'invoice'
  if (SALES_WORDS.test(text)) return 'invoice'
  return null
}

const SALES_TOOL = /^sales_/

/**
 * Guard di level KODE (bukan imbauan di prompt): dasar pengakuan ditentukan dari
 * kalimat user, bukan dari kebiasaan model. Model 27B terbukti sering mengisi
 * parameter opsional seenaknya, dan salah basis di sini berarti angka sales yang
 * dilaporkan ke manajemen memakai dasar yang tidak diakui perusahaan.
 */
export function applyBasisRule(
  toolName: string,
  args: Record<string, unknown>,
  userText: string
): Record<string, unknown> {
  if (!SALES_TOOL.test(toolName)) return args
  const dari = basisFromText(userText)
  if (dari) return { ...args, basis: dari }
  return args
}
