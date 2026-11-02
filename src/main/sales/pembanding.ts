/**
 * Periode PEMBANDING ditentukan kalimat user, bukan kebiasaan model (29 Sep 2026).
 *
 * Temuan saat membangun dashboard: "Berapa sales bulan ini dibanding bulan lalu?"
 * dipanggil model sebagai `sales_compare {period: this_month}` TANPA
 * `comparePeriod`, sehingga pembandingnya "29 hari sebelumnya" (3–31 Agustus) —
 * bukan bulan lalu. Angkanya sah, tapi menjawab pertanyaan yang berbeda, dan
 * persentasenya ikut berbeda. Pola yang sama dengan `applyBasisRule`: diputuskan
 * di kode dari kalimat user.
 *
 * Hanya mengisi bila model TIDAK mengisi `comparePeriod` dan pasangan periodenya
 * jelas (bulan ini ↔ bulan lalu, dst.). `alignBaseline` di tool tetap menyamakan
 * jumlah hari untuk periode berjalan, jadi "bulan lalu" menjadi 1–29 Agustus.
 */
const PASANGAN: Array<{ period: string; banding: string; kata: RegExp }> = [
  { period: 'this_month', banding: 'last_month', kata: /\bbulan\s+(lalu|kemarin|sebelumnya)\b/i },
  { period: 'this_week', banding: 'last_week', kata: /\bminggu\s+(lalu|kemarin|sebelumnya)\b/i },
  { period: 'today', banding: 'yesterday', kata: /\bkemarin\b/i },
  { period: 'this_year', banding: 'last_year', kata: /\btahun\s+(lalu|kemarin|sebelumnya)\b/i }
]

export function applyComparePeriod(
  toolName: string,
  args: Record<string, unknown>,
  userText: string
): Record<string, unknown> {
  if (toolName !== 'sales_compare') return args
  if (typeof args.comparePeriod === 'string' && args.comparePeriod) return args
  const p = PASANGAN.find((x) => x.period === args.period && x.kata.test(userText))
  return p ? { ...args, comparePeriod: p.banding } : args
}
