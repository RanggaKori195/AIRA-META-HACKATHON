// Dimensi wilayah & tipe pelanggan, diambil dari master pelanggan.
//
// SalesRepository.customer_id = m_customer.customer_code_lis
// m_customer.customer_province -> m_provinces.province_id
// m_customer.customer_city     -> m_cities.city_id
//
// ⚠️ JANGAN LEFT JOIN m_customer LANGSUNG KE SalesRepository.
// customer_code_lis TIDAK unik: 4.075 baris master hanya berisi 4.071 kode, dan salah
// satu yang berulang adalah "Pasien Pribadi" yang bervolume besar. Terukur 18 Agu 2026:
// nett Agustus 2026 melonjak dari Rp 4.621.948.235 menjadi Rp 5.180.336.535 (+12,1%)
// hanya karena join itu. Ini jebakan yang sama persis dengan master item.
//
// Pola wajib (sama dengan ITEM_NAME_LOOKUP di sales-tools.ts): AGREGAT DULU per
// customer_id, baru ambil SATU baris master lewat LATERAL ... LIMIT 1. Sudah diuji:
// total lewat pola ini identik dengan total tanpa join sama sekali.
//
// m_provinces.province_id (35 baris) dan m_cities.city_id (515 baris) TERBUKTI UNIK,
// jadi join di dalam LATERAL aman.

const CUSTOMER_MASTER = 'public.m_customer'
const PROVINCE_MASTER = 'public.m_provinces'
const CITY_MASTER = 'public.m_cities'

/**
 * Satu baris master per kode pelanggan. Dipakai setelah agregat, dengan alias `a`
 * yang punya kolom `kode` (= customer_id).
 *
 * `ketemu` membedakan dua hal yang tidak boleh tertukar:
 * pelanggan tidak ada di master  vs  ada di master tapi wilayahnya tidak diisi.
 */
export const CUSTOMER_LOOKUP = `
  LEFT JOIN LATERAL (
    SELECT p.description AS provinsi,
           t.description AS kota,
           c.customer_type AS tipe,
           true AS ketemu
    FROM ${CUSTOMER_MASTER} c
    LEFT JOIN ${PROVINCE_MASTER} p ON p.province_id = c.customer_province
    LEFT JOIN ${CITY_MASTER} t     ON t.city_id     = c.customer_city
    WHERE c.customer_code_lis = a.kode
    ORDER BY (c.is_active = '1') DESC, c.id
    LIMIT 1
  ) w ON true`

const UNMATCHED = '(pelanggan tidak ada di master)'

function labelExpr(column: string, kosong: string): string {
  return `CASE WHEN w.ketemu IS NULL THEN '${UNMATCHED}'
               ELSE coalesce(nullif(trim(w.${column}), ''), '${kosong}') END`
}

/**
 * Dimensi yang bersumber dari master pelanggan. Semuanya agregat murni — tidak satu
 * pun kolom data pasien tersentuh.
 */
export const CUSTOMER_DIMENSIONS: Record<
  string,
  { label: string; expr: string; asCode?: true }
> = {
  province: {
    label: 'provinsi pelanggan',
    expr: labelExpr('provinsi', '(provinsi tidak diisi)')
  },
  city_customer: {
    label: 'kota/kabupaten pelanggan',
    expr: labelExpr('kota', '(kota tidak diisi)')
  },
  customer_type: {
    label: 'tipe pelanggan',
    expr: labelExpr('tipe', '(tipe tidak diisi)'),
    asCode: true
  }
}

/**
 * SQL rincian penjualan menurut dimensi master pelanggan.
 *
 * Bentuknya dikunci di sini — bukan di sales-tools.ts — supaya string yang diuji
 * benar-benar string yang dipakai produksi. Urutannya WAJIB: agregat per customer_id
 * dulu (CTE `a`), baru LATERAL ke master, baru dijumlahkan per wilayah.
 *
 * `arah` dan `limit` berasal dari daftar tertutup / angka yang sudah di-clamp di
 * pemanggil — tidak ada teks dari model yang masuk ke sini.
 */
export function customerDimensionSql(opts: {
  table: string
  basisColumn: string
  filterClause: string
  expr: string
  arah: 'ASC' | 'DESC'
  limit: number
}): string {
  return `WITH a AS (
               SELECT coalesce(customer_id, '(tidak diisi)') AS kode,
                      count(DISTINCT order_id)::int         AS orderan,
                      count(*)::int                          AS baris,
                      coalesce(sum(nett_sales),0)::float8    AS nett
               FROM ${opts.table}
               WHERE ${opts.basisColumn} BETWEEN $1::date AND $2::date${opts.filterClause}
               GROUP BY 1
             )
             SELECT ${opts.expr}        AS kategori,
                    count(*)::int       AS pelanggan,
                    sum(a.orderan)::int AS "jumlahOrder",
                    sum(a.baris)::int   AS "barisItem",
                    sum(a.nett)::float8 AS nett
             FROM a${CUSTOMER_LOOKUP}
             GROUP BY 1 ORDER BY 5 ${opts.arah} LIMIT ${opts.limit}`
}

/**
 * Arti kode `m_customer.customer_type`. Tidak ada tabel master untuk ini di database
 * (sudah dicek: tidak ada tabel m_customer_type), jadi dipetakan di sini dari contoh
 * nama pelanggan tiap kode. Kode yang tak dikenal dikembalikan apa adanya — lebih baik
 * menampilkan kode mentah daripada menebak artinya.
 */
export const CUSTOMER_TYPE_LABELS: Record<string, string> = {
  RS: 'Rumah Sakit',
  KL: 'Klinik',
  PR: 'Pasien Pribadi',
  LB: 'Laboratorium',
  DR: 'Praktek Dokter',
  PH: 'Apotek / Farmasi',
  WA: 'Wellness & Estetika',
  IN: 'Asuransi',
  OT: 'Lainnya (institusi, BPJS, dinas)'
}

/** Label tipe pelanggan; kode tetap ditempelkan supaya angka bisa ditelusuri. */
export function customerTypeLabel(code: string): string {
  const key = code.trim().toUpperCase()
  const found = CUSTOMER_TYPE_LABELS[key]
  return found ? `${found} (${key})` : code
}

// ---------------------------------------------------------------------------
// Filter wilayah — "berapa penjualan di Jawa Barat bulan ini"
// ---------------------------------------------------------------------------

/**
 * Semi-join (IN subquery), BUKAN join — jadi tidak ada baris yang tergandakan
 * walaupun kode pelanggan di master ada yang dobel.
 * Nilai dari model SELALU lewat parameter, tidak pernah di-concat ke SQL.
 */
export function regionFilter(
  args: Record<string, unknown>,
  startIndex: number
): { clause: string; params: unknown[]; province?: string; city?: string } {
  const clauses: string[] = []
  const params: unknown[] = []
  let i = startIndex
  const province = typeof args.province === 'string' ? args.province.trim() : ''
  const city = typeof args.city === 'string' ? args.city.trim() : ''

  if (province) {
    clauses.push(`customer_id IN (
      SELECT c.customer_code_lis FROM ${CUSTOMER_MASTER} c
      JOIN ${PROVINCE_MASTER} p ON p.province_id = c.customer_province
      WHERE upper(p.description) LIKE '%' || upper($${i++}) || '%')`)
    params.push(province)
  }
  if (city) {
    clauses.push(`customer_id IN (
      SELECT c.customer_code_lis FROM ${CUSTOMER_MASTER} c
      JOIN ${CITY_MASTER} t ON t.city_id = c.customer_city
      WHERE upper(t.description) LIKE '%' || upper($${i++}) || '%')`)
    params.push(city)
  }
  return {
    clause: clauses.length ? ` AND ${clauses.join(' AND ')}` : '',
    params,
    province: province || undefined,
    city: city || undefined
  }
}

/** Query untuk memastikan nama wilayah yang diketik user memang ada di master. */
export const PROVINCE_MATCH_SQL = `SELECT description FROM ${PROVINCE_MASTER}
  WHERE upper(description) LIKE '%' || upper($1) || '%' ORDER BY 1 LIMIT 20`
export const CITY_MATCH_SQL = `SELECT description FROM ${CITY_MASTER}
  WHERE upper(description) LIKE '%' || upper($1) || '%' ORDER BY 1 LIMIT 20`

// ---------------------------------------------------------------------------
// Guard pemilihan dimensi
// ---------------------------------------------------------------------------

// English words added in the final review (2 Nov 2026): "which city has the highest sales?" kept the
// free-text patient-city column that splits one city into several rows (see below).
const REGION_WORD =
  /\b(wilayah|daerah|provinsi|propinsi|kota|kabupaten|kab|region|regions|area|areas|geografis?|lokasi|city|cities|province|provinces|location|locations)\b/i
const PROVINCE_WORD = /\b(provinsi|propinsi|province|provinces)\b/i
const PATIENT_WORD = /\b(pasien|patients?)\b/i

/**
 * Guard di level KODE, bukan imbauan di prompt.
 *
 * Dimensi `city` yang lama berasal dari kolom teks bebas SalesRepository.city dan
 * TERBUKTI memecah satu kota jadi beberapa baris — "KOTA ADM. JAKARTA TIMUR" (15.667),
 * "Kota Jakarta Timur" (8.948), "KOTA JAKARTA TIMUR" (8.061). Dipakai untuk pertanyaan
 * "kota mana penjualannya terbesar", hasilnya peringkat yang salah tapi terdengar meyakinkan.
 * Isinya juga tampak kota PASIEN, bukan kota instansi (pelanggan ber-master KOTA MEDAN
 * muncul sebagai KOTA SIBOLGA).
 *
 * Jadi: untuk pertanyaan wilayah, dimensi dialihkan ke versi master. Kolom lama tetap
 * bisa dipakai bila user memang menyebut "pasien".
 */
export function steerRegionDimension(
  toolName: string,
  args: Record<string, unknown>,
  userText: string
): Record<string, unknown> {
  if (toolName !== 'sales_breakdown') return args
  if (!REGION_WORD.test(userText)) return args
  const dim = typeof args.dimension === 'string' ? args.dimension : ''

  if (PROVINCE_WORD.test(userText)) {
    return dim === 'city' || dim === 'city_customer' ? { ...args, dimension: 'province' } : args
  }
  if (dim === 'city' && !PATIENT_WORD.test(userText)) {
    return { ...args, dimension: 'city_customer' }
  }
  return args
}
