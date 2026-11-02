import { innoQuery } from './db'

// Kategori harga (`m_price_category`). Satu pelanggan bisa punya harga khusus untuk
// item yang SAMA di kategori BERBEDA (dikonfirmasi user 18 Agu 2026) — mis. harga
// "Special Price" biasa dan harga "BPJS/PMK3". Karena itu kategori ikut jadi kunci
// saat menentukan harga yang berlaku, dan namanya wajib ditampilkan supaya satu item
// yang muncul dua kali tidak terbaca sebagai kesalahan.
//
// Tabelnya kecil (9 baris, `code` unik) dan nyaris tak pernah berubah, jadi dimuat
// sekali per sesi dan dipakai dari memori — jauh lebih murah daripada join ke tabel
// special price yang 190 ribu baris.

export interface PriceCategory {
  code: string
  name: string
  /** Kategori yang sudah dihapus di master (mis. "4 — PMK3") tetap ada di data lama. */
  nonaktif: boolean
}

/**
 * Kode yang DIPAKAI di data tapi tidak ada barisnya di `m_price_category`.
 * Artinya diberi tahu langsung oleh pemilik data (user, 18 Agu 2026) — ini bukan
 * tebakan, tapi juga bukan berasal dari master, jadi sumbernya ditandai di label.
 * Terukur: kode "5" dipakai 154 kali.
 */
const KETERANGAN_LUAR_MASTER: Record<string, string> = {
  '5': 'Voucher'
}

let cache: Map<string, PriceCategory> | null = null

export async function loadPriceCategories(): Promise<Map<string, PriceCategory>> {
  if (cache) return cache
  const rows = await innoQuery<{ code: string; name: string; deleted_at: string | null }>(
    `SELECT code, name, deleted_at FROM m_price_category WHERE code IS NOT NULL AND code <> ''`
  )
  const map = new Map<string, PriceCategory>()
  for (const r of rows) {
    map.set(String(r.code), {
      code: String(r.code),
      name: r.name ?? '',
      nonaktif: r.deleted_at !== null
    })
  }
  cache = map
  return map
}

/** Hanya untuk test — memaksa muat ulang. */
export function resetPriceCategoryCache(): void {
  cache = null
}

/**
 * Nama kategori untuk ditampilkan. Kode yang TIDAK ADA di master tidak ditebak:
 * terukur kategori "5" dipakai 154 kali padahal tidak terdaftar, dan 8 baris
 * berkategori kosong. Menamainya asal akan jadi fakta palsu di jawaban.
 */
export function categoryLabel(
  code: string | null | undefined,
  master: Map<string, PriceCategory>
): string {
  const key = code === null || code === undefined ? '' : String(code).trim()
  if (!key) return '(kategori tidak diisi)'
  const found = master.get(key)
  if (found) {
    return found.nonaktif ? `${found.name} (kategori sudah dihapus di master)` : found.name
  }
  const luar = KETERANGAN_LUAR_MASTER[key]
  if (luar) return `${luar} (kode ${key}, tidak terdaftar di master kategori)`
  return `${key} (tidak terdaftar di master kategori)`
}
