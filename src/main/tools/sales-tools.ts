import { existsSync, writeFileSync } from 'fs'
import { Document, HeadingLevel, ImageRun, Packer, Paragraph } from 'docx'
import { catatanGrafik, grafikLaporan } from '../grafik/laporan'
import { sisipkanGrafik } from '../grafik/sisip'
import { keSvg } from '../grafik/svg'
import { keSvgPng } from '../grafik/raster'
import { resolveInBoundary } from './boundary'
import { ToolError, type ToolDefinition } from './types'
import { salesQuery, salesDbConfigured } from '../sales/db'
import { pdfSiap, tulisPdfDariHtml } from '../pdf/render'
import { markdownToHtml } from '../pdf/markdown'
import { logger } from '../logger'
import {
  jakartaToday,
  previousRange,
  alignBaseline,
  resolvePeriod,
  parseMonth,
  ytdRange,
  ytdCompareRange,
  MONTH_NAMES,
  PERIOD_NAMES,
  type DateRange,
  type PeriodName
} from '../sales/periods'
import {
  ERP_SCOPES,
  ERP_BRIDGING_START,
  erpClause,
  erpNote,
  isErpScope,
  type ErpScope
} from '../sales/erp'
import { computeMovers } from '../sales/movers'
import { DEFAULT_BASIS } from '../sales/basis'
import { withShare } from '../sales/contribution'
import { RECOGNIZED_CLAUSE, RECOGNIZED_NOTE } from '../sales/recognition'
import {
  bulanBerikut,
  catatanRamalan,
  harapanTren,
  mapeBacktest,
  momentum,
  proyeksiBulanBerjalan,
  ramal,
  JENDELA,
  MAKS_HORIZON,
  MIN_RIWAYAT
} from '../sales/forecast'
import { BEError, catatanBE, susunBE } from '../sales/full-year'
import {
  kandidatOrderId,
  normalkanOrderId,
  susunStatusOrderId,
  SQL_DATA_TERBARU,
  SQL_STATUS_ORDER,
  type RingkasOrderId
} from '../sales/order-status'
import ExcelJS from 'exceljs'
import { rapikanSheet } from './doc-tools'
import {
  blokKeMarkdown,
  labelPeriode,
  moverDariHasil,
  susunLaporan,
  susunLaporanExcel,
  type BarisRingkas,
  type DataLaporan
} from '../sales/report'
import {
  DEFAULT_DIAM_HARI,
  DEFAULT_JENDELA_HARI,
  DEFAULT_MIN_BULAN_AKTIF,
  DEFAULT_MIN_TURUN_PERSEN,
  SEGMEN_PELANGGAN,
  STATUS_PELANGGAN,
  isSegmenPelanggan,
  isStatusPelanggan,
  customerHistorySql,
  pilihPelanggan,
  type BarisPelanggan
} from '../sales/customers'
import {
  CUSTOMER_DIMENSIONS,
  CITY_MATCH_SQL,
  PROVINCE_MATCH_SQL,
  customerDimensionSql,
  customerTypeLabel,
  regionFilter
} from '../sales/region'

// Tool analitik penjualan. Prinsipnya: model TIDAK PERNAH menulis SQL — dia hanya
// memilih tool dan mengisi parameter. SQL-nya ditulis & diuji manusia, memakai
// index yang ada, dan SELURUHNYA AGREGAT.
//
// PENTING: tabel SalesRepository juga memuat data pasien (nama, tanggal lahir,
// diagnosis, hasil). Tidak satu pun query di sini menyentuh kolom tersebut —
// analisis penjualan tidak boleh membocorkan data medis.

const TABLE = 'public."SalesRepository"'
const ITEM_MASTER = 'public.m_item_repository'

// Nama item diambil dari master m_item_repository (item_code = item_code_erp).
//
// ⚠️ MASTER TIDAK UNIK: 2.633 baris hanya berisi 2.464 kode unik, 109 baris malah
// berkode kosong. LEFT JOIN langsung ke SalesRepository menggandakan baris —
// terukur: nett Agustus 2026 melonjak dari Rp 4,61 M menjadi Rp 5,67 M (+23%),
// yaitu persis jenis "angka salah yang terdengar meyakinkan" yang harus dihindari.
//
// Pola aman yang dipakai di sini: AGREGAT DULU per item_code, baru ambil SATU nama
// per kode lewat LATERAL ... LIMIT 1. Angka tidak pernah tersentuh join.
const ITEM_NAME_LOOKUP = `
  LEFT JOIN LATERAL (
    SELECT m.item_name
    FROM ${ITEM_MASTER} m
    WHERE m.item_code_erp = a.kode AND m.item_code_erp <> ''
    ORDER BY (m.status = '5') DESC, m.item_name
    LIMIT 1
  ) m ON true`

/** Label item: nama master, jatuh ke kode bila item tidak ada di master. */
const ITEM_LABEL = `coalesce(nullif(trim(m.item_name), ''), a.kode, '(tidak diisi)')`

/** Dua dasar pengakuan penjualan yang berlaku di the lab. */
const BASIS_COLUMN: Record<string, { column: string; note: string }> = {
  order: {
    column: 'date_received',
    note: 'ORDER YANG MASUK — dihitung dari tanggal order diterima (date_received). Ini BUKAN sales yang diakui.'
  },
  invoice: {
    column: 'date_result',
    note: 'SALES YANG DIAKUI — dihitung dari tanggal hasil/invoice keluar (date_result).'
  }
}

function basisOf(args: Record<string, unknown>): { column: string; note: string; key: string } {
  // Default = invoice (date_result): itulah dasar yang DIAKUI sebagai sales oleh
  // pemilik data. date_received hanya untuk pertanyaan "order yang masuk".
  const key = typeof args.basis === 'string' ? args.basis.toLowerCase() : DEFAULT_BASIS
  const found = BASIS_COLUMN[key]
  if (!found) throw new ToolError('basis harus "order" atau "invoice"')
  return { ...found, key }
}

function scopeOf(args: Record<string, unknown>): ErpScope {
  if (args.scope === undefined || args.scope === null || args.scope === '') return 'all'
  if (!isErpScope(args.scope)) {
    throw new ToolError(`scope harus salah satu dari: ${ERP_SCOPES.join(', ')}`)
  }
  return args.scope
}

function rangeOf(args: Record<string, unknown>): DateRange {
  const period = (typeof args.period === 'string' ? args.period : 'today') as PeriodName
  if (!PERIOD_NAMES.includes(period)) {
    /*
     * ⚠️ Pesan galat WAJIB menyebutkan CARA memperbaikinya, bukan cuma daftar
     * nilai yang sah.
     *
     * Bug lapangan 8 Sep 2026: model mengisi `period` dengan rentang tanggal
     * ("2026-08-01 s/d 2026-08-08"), ditolak dengan daftar pilihan saja, lalu
     * mencoba lagi dengan bentuk salah yang lain — dua panggilan terbuang, dan
     * penalaran yang membengkak mencari sebabnya MENGHABISKAN jatah keluaran
     * sehingga jawabannya terbit KOSONG. Galat yang tidak memberi jalan keluar
     * ongkosnya bukan satu panggilan, melainkan seluruh jawaban.
     */
    const sepertiTanggal = /\d{4}-\d{2}-\d{2}/.test(period)
    throw new ToolError(
      `period "${period}" tidak dikenal. Pilihan: ${PERIOD_NAMES.join(', ')}.` +
        (sepertiTanggal
          ? ' Untuk rentang tanggal sendiri, JANGAN menaruh tanggalnya di `period`:' +
            ' isi `period: "custom"` lalu `from` dan `to` terpisah,' +
            ' mis. {"period":"custom","from":"2026-08-01","to":"2026-08-08"}.'
          : '')
    )
  }
  try {
    return resolvePeriod(period, jakartaToday(), {
      from: typeof args.from === 'string' ? args.from : undefined,
      to: typeof args.to === 'string' ? args.to : undefined
    })
  } catch (err: any) {
    throw new ToolError(String(err?.message ?? err))
  }
}

/**
 * Filter opsional yang aman: nilai dari model SELALU lewat parameter, tidak pernah
 * di-concat ke SQL. Klausa cakupan ERP ikut di sini karena berlaku di semua tool —
 * potongannya konstan (dipilih dari daftar tertutup di sales/erp.ts).
 *
 * Fungsi ini adalah SATU-SATUNYA jalur filter untuk seluruh query tool sales (sudah
 * dicek: ketujuh query ke SalesRepository memakai `f.clause`), jadi di sinilah dasar
 * pengakuan dipasang supaya tidak ada tool yang bisa melewatinya.
 */
function filters(
  args: Record<string, unknown>,
  startIndex: number,
  basisKey: string
): { clause: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []
  let i = startIndex
  if (typeof args.source === 'string' && args.source.trim()) {
    clauses.push(`"source" = $${i++}`)
    params.push(args.source.trim())
  }
  if (typeof args.branch === 'string' && args.branch.trim()) {
    clauses.push(`kd_cabang = $${i++}`)
    params.push(args.branch.trim())
  }
  // Filter wilayah lewat master pelanggan. Semi-join (IN), bukan JOIN — baris tidak
  // tergandakan walaupun kode di master ada yang dobel.
  const region = regionFilter(args, i)
  const base = clauses.length ? ` AND ${clauses.join(' AND ')}` : ''
  return {
    // RECOGNIZED_CLAUSE selalu ikut: transfer yang dibatalkan tidak diakui sebagai
    // order/sales/invoice. Ini bukan filter opsional — model tidak bisa mematikannya.
    clause: base + region.clause + erpClause(scopeOf(args), basisKey) + RECOGNIZED_CLAUSE,
    params: [...params, ...region.params]
  }
}

/**
 * Memastikan nama wilayah yang diisi model memang ada di master, lalu mengembalikan
 * nama resmi yang cocok supaya AIRA menyebutkannya apa adanya.
 *
 * Ini guard, bukan kenyamanan: tanpa ini "Jawa Barrat" salah ketik akan menghasilkan
 * Rp 0 yang terlihat seperti fakta. Pesan errornya sekaligus memberi daftar yang sah.
 */
async function regionLabels(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  const lookup = async (
    value: unknown,
    sql: string,
    daftarSql: string,
    jenis: string
  ): Promise<string[] | undefined> => {
    const teks = typeof value === 'string' ? value.trim() : ''
    if (!teks) return undefined
    const rows = await salesQuery<{ description: string }>(sql, [teks])
    if (rows.length === 0) {
      const semua = await salesQuery<{ description: string }>(daftarSql, [])
      throw new ToolError(
        `${jenis} "${teks}" tidak ada di master wilayah. Pilihan yang tersedia: ` +
          semua.map((r) => r.description).join(', ')
      )
    }
    return rows.map((r) => r.description)
  }

  const prov = await lookup(
    args.province,
    PROVINCE_MATCH_SQL,
    'SELECT description FROM public.m_provinces ORDER BY 1',
    'provinsi'
  )
  if (prov) out.filterProvinsi = prov
  const city = await lookup(
    args.city,
    CITY_MATCH_SQL,
    'SELECT description FROM public.m_cities ORDER BY 1 LIMIT 60',
    'kota'
  )
  if (city) out.filterKota = city
  return out
}

// Tiga cara menghitung "banyaknya", dan ketiganya BEDA — dulu hanya count(*) yang
// dikirim dengan nama "transaksi", sehingga pertanyaan "berapa order bulan ini"
// dijawab dengan jumlah BARIS ITEM. Terukur Agustus 2026: 6.489 baris item tapi
// hanya 5.334 order dan 3.928 invoice — selisihnya 22%, dan konsisten tiap bulan.
// order_id sudah diverifikasi berperilaku sebagai nomor order (satu pelanggan,
// satu tanggal, beberapa item) dan terisi 100%.
const SUMMARY_SELECT = `
  count(DISTINCT order_id)::int       AS "jumlahOrder",
  count(*)::int                        AS "barisItem",
  count(DISTINCT invoice_no)::int      AS "jumlahInvoice",
  coalesce(sum(nett_sales),0)::float8  AS nett,
  coalesce(sum(gross_sales),0)::float8 AS gross,
  coalesce(sum(discount),0)::float8    AS diskon,
  count(DISTINCT customer_id)::int     AS pelanggan,
  count(DISTINCT item_code)::int       AS jenis_item`

const CATATAN_HITUNG =
  'jumlahOrder = banyaknya order (order_id); barisItem = banyaknya baris pemeriksaan ' +
  '(satu order bisa berisi beberapa pemeriksaan); jumlahInvoice = banyaknya nomor invoice. ' +
  'Ketiganya BERBEDA — kalau user bertanya "berapa order/transaksi", pakai jumlahOrder dan ' +
  'sebutkan istilahnya, jangan memakai barisItem seolah-olah itu jumlah order.'

async function summarize(
  range: DateRange,
  basis: { column: string; key: string },
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const f = filters(args, 3, basis.key)
  const rows = await salesQuery(
    `SELECT ${SUMMARY_SELECT} FROM ${TABLE}
     WHERE ${basis.column} BETWEEN $1::date AND $2::date${f.clause}`,
    [range.from, range.to, ...f.params]
  )
  return rows[0] ?? {}
}

/**
 * Dimensi yang boleh dipecah — daftar tertutup, tidak ada kolom data pasien.
 * `item` ditandai khusus: dikelompokkan per item_code lalu diberi nama dari master,
 * supaya satu item tidak terpecah gara-gara penulisan kolom `test` yang berbeda-beda.
 *
 * Catatan `city`: kolom teks bebas di tabel transaksi, penulisannya TIDAK konsisten
 * (satu kota bisa muncul sebagai "KOTA ADM. JAKARTA TIMUR", "Kota Jakarta Timur", dan
 * "KOTA JAKARTA TIMUR" sekaligus) dan isinya condong ke kota pasien, bukan kota
 * instansi. Untuk pertanyaan wilayah pakai `city_customer`/`province` yang bersumber
 * dari master — steerRegionDimension() di sales/region.ts mengalihkannya otomatis.
 */
const DIMENSIONS: Record<string, { column: string; label: string; viaMaster?: true }> = {
  item: { column: 'item_code', label: 'jenis pemeriksaan', viaMaster: true },
  item_code: { column: 'item_code', label: 'kode item' },
  customer: { column: 'customer_name', label: 'pelanggan/instansi' },
  source: { column: '"source"', label: 'kategori layanan' },
  branch: { column: 'kd_cabang', label: 'cabang' },
  payer: { column: 'payer_name', label: 'penjamin' },
  payer_type: { column: 'payer_type', label: 'tipe penjamin' },
  city: { column: 'city', label: 'kota pada transaksi (teks bebas, penulisan tidak konsisten)' },
  clinician: { column: 'clinician', label: 'dokter pengirim' },
  price_type: { column: 'price_type', label: 'tipe harga' },
  payment_method: { column: 'payment_method', label: 'metode pembayaran' }
}

/** Semua dimensi yang sah: kolom tabel transaksi + dimensi dari master pelanggan. */
const DIMENSION_NAMES = [...Object.keys(DIMENSIONS), ...Object.keys(CUSTOMER_DIMENSIONS)]

const PERIOD_DESC = `Periode: ${PERIOD_NAMES.join(' | ')}. Untuk "custom" wajib isi from & to (YYYY-MM-DD).`
const BASIS_DESC =
  'Dasar pengakuan. "invoice" (date_result) = SALES YANG DIAKUI perusahaan — INI DEFAULT dan dipakai ' +
  'untuk semua pertanyaan "berapa sales/omzet/penjualan/growth". "order" (date_received) HANYA untuk ' +
  'pertanyaan "berapa ORDER YANG MASUK".'

const SCOPE_DESC =
  'Cakupan data. "all" (default) = semua transaksi lab. "erp" = HANYA yang sudah masuk ERP ' +
  '(basis order memakai flag bridging_status_to=SUCCESS, basis invoice memakai bridging_status_result=SUCCESS). ' +
  '"not_erp" = yang belum/gagal masuk ERP. WAJIB pakai "erp" bila user menyebut ERP atau ERP.'

const commonProps = {
  period: { type: 'string', description: PERIOD_DESC },
  from: { type: 'string', description: 'Tanggal awal YYYY-MM-DD (khusus period=custom)' },
  to: { type: 'string', description: 'Tanggal akhir YYYY-MM-DD (khusus period=custom)' },
  basis: { type: 'string', enum: ['order', 'invoice'], description: BASIS_DESC },
  scope: { type: 'string', enum: [...ERP_SCOPES], description: SCOPE_DESC },
  source: { type: 'string', description: 'Filter kategori layanan, mis. Molekuler, PK, Histologi' },
  branch: { type: 'string', description: 'Filter kode cabang, mis. 01' },
  province: {
    type: 'string',
    description:
      'Filter provinsi asal pelanggan, mis. "Jawa Barat", "DKI Jakarta". Dicocokkan ke master wilayah.'
  },
  city: {
    type: 'string',
    description:
      'Filter kota/kabupaten asal pelanggan, mis. "Bekasi", "Jakarta Selatan". Dicocokkan ke master wilayah.'
  }
}

function guard(): void {
  if (!salesDbConfigured()) {
    throw new ToolError('database penjualan belum dikonfigurasi pada aplikasi ini')
  }
}

export const salesTools: ToolDefinition[] = [
  {
    name: 'sales_summary',
    label: 'Ringkasan Penjualan',
    description:
      'Total penjualan pada suatu periode: nett, gross, diskon, jumlah pelanggan, jumlah jenis item, ' +
      'serta TIGA hitungan yang berbeda — jumlahOrder (banyaknya order), barisItem (baris pemeriksaan), ' +
      'dan jumlahInvoice. Untuk "berapa order/transaksi", pakai jumlahOrder. ' +
      'Pakai untuk pertanyaan seperti "berapa sales hari ini / bulan ini". ' +
      'Bisa dibatasi ke data yang sudah masuk ERP lewat parameter scope.',
    parameters: { type: 'object', properties: commonProps, required: ['period'] },
    tier: 'read',
    timeoutMs: 45_000,
    summarize: (a) =>
      `Ringkasan penjualan: ${a.period ?? 'today'} (${a.basis ?? 'order'}${a.scope && a.scope !== 'all' ? `, ${a.scope}` : ''})`,
    execute: async (args) => {
      guard()
      const range = rangeOf(args)
      const basis = basisOf(args)
      const scope = scopeOf(args)
      const wilayah = await regionLabels(args)
      const data = await summarize(range, basis, args)
      return JSON.stringify({
        periode: range.label,
        rentang: `${range.from} s/d ${range.to}`,
        basis: basis.key,
        catatanBasis: basis.note,
        cakupan: scope,
        catatanCakupan: erpNote(scope, basis.key, range.from),
        catatanPengakuan: RECOGNIZED_NOTE,
        ...wilayah,
        ...data,
        catatanHitung: CATATAN_HITUNG,
        mataUang: 'IDR'
      })
    }
  },
  {
    name: 'sales_compare',
    label: 'Bandingkan Penjualan',
    description:
      'Membandingkan penjualan dua periode dan menghitung selisih serta persentasenya. ' +
      'Bila comparePeriod tidak diisi, pembandingnya adalah periode sepadan tepat sebelumnya. ' +
      'Pakai untuk "naik atau turun dibanding kemarin/bulan lalu".',
    parameters: {
      type: 'object',
      properties: {
        ...commonProps,
        comparePeriod: { type: 'string', description: `Periode pembanding. ${PERIOD_DESC}` }
      },
      required: ['period']
    },
    tier: 'read',
    timeoutMs: 60_000,
    summarize: (a) => `Banding penjualan: ${a.period ?? 'today'} vs ${a.comparePeriod ?? 'periode sebelumnya'}`,
    execute: async (args) => {
      guard()
      const basis = basisOf(args)
      const current = rangeOf(args)
      // Periode pembanding yang dipilih model bisa jauh lebih panjang dari periode
      // berjalan (klasik: "bulan ini" 18 hari vs "bulan lalu" 31 hari) — disamakan
      // dulu supaya persentasenya tidak menyesatkan.
      const rawBaseline =
        typeof args.comparePeriod === 'string' && args.comparePeriod
          ? rangeOf({ ...args, period: args.comparePeriod })
          : previousRange(current)
      const aligned = alignBaseline(current, rawBaseline, jakartaToday())
      const baseline = aligned.range

      const wilayah = await regionLabels(args)
      const [now, before] = await Promise.all([
        summarize(current, basis, args),
        summarize(baseline, basis, args)
      ])

      const nettNow = Number(now.nett ?? 0)
      const nettBefore = Number(before.nett ?? 0)
      const selisih = nettNow - nettBefore
      const persen = nettBefore === 0 ? null : Math.round((selisih / nettBefore) * 1000) / 10

      const scope = scopeOf(args)
      return JSON.stringify({
        basis: basis.key,
        catatanBasis: basis.note,
        cakupan: scope,
        catatanCakupan: erpNote(scope, basis.key, baseline.from),
        catatanPengakuan: RECOGNIZED_NOTE,
        ...wilayah,
        periodeUtama: { label: current.label, rentang: `${current.from} s/d ${current.to}`, ...now },
        periodePembanding: {
          label: baseline.label,
          rentang: `${baseline.from} s/d ${baseline.to}`,
          ...before
        },
        ...(aligned.disamakan
          ? {
              catatanPerbandingan:
                'Periode berjalan belum genap, jadi periode pembanding DIPOTONG ke jumlah hari yang sama agar setara. ' +
                'Sebutkan hal ini ke user, dan sebutkan rentang tanggal pembandingnya.'
            }
          : {}),
        catatanHitung: CATATAN_HITUNG,
        selisihNett: selisih,
        persenPerubahan: persen,
        arah: selisih > 0 ? 'naik' : selisih < 0 ? 'turun' : 'sama',
        mataUang: 'IDR'
      })
    }
  },
  {
    name: 'sales_breakdown',
    label: 'Rincian Penjualan',
    description:
      'Memecah penjualan menurut satu dimensi: item/jenis pemeriksaan, pelanggan, kategori layanan, cabang, ' +
      'penjamin, kota, dokter pengirim, tipe harga, atau metode pembayaran. Pakai untuk "item apa yang paling laku", ' +
      '"pelanggan terbesar", "penjualan per cabang". Untuk yang PALING SEDIKIT/tidak laris, pakai sort="bottom". ' +
      'Dimensi "item" memakai nama pemeriksaan dari master item. ' +
      'Hasilnya SUDAH memuat persen kontribusi tiap baris dan total nett periode — pakai angka itu, ' +
      'jangan menghitung persentase sendiri.',
    parameters: {
      type: 'object',
      properties: {
        ...commonProps,
        dimension: {
          type: 'string',
          enum: DIMENSION_NAMES,
          description:
            'Dimensi rincian. Untuk pertanyaan WILAYAH pakai "province" (provinsi) atau ' +
            '"city_customer" (kota/kabupaten) — keduanya dari master pelanggan. ' +
            'Dimensi "city" adalah teks bebas di tabel transaksi yang penulisannya tidak ' +
            'konsisten dan condong ke kota pasien; jangan dipakai untuk peringkat wilayah. ' +
            '"customer_type" memecah per jenis pelanggan (rumah sakit, klinik, lab, apotek, dll).'
        },
        sort: {
          type: 'string',
          enum: ['top', 'bottom'],
          description:
            'Urutan: "top" (default) = terbesar, untuk "paling laris". "bottom" = terkecil, untuk "paling tidak laris/paling sepi".'
        },
        limit: { type: 'number', description: 'Jumlah baris (default 10, maks 50)' }
      },
      required: ['period', 'dimension']
    },
    tier: 'read',
    timeoutMs: 60_000,
    summarize: (a) =>
      `Rincian penjualan per ${a.dimension} (${a.sort === 'bottom' ? 'terkecil' : 'terbesar'}) — ${a.period ?? 'today'}`,
    execute: async (args) => {
      guard()
      const dimKey = String(args.dimension)
      const dim = DIMENSIONS[dimKey]
      const master = CUSTOMER_DIMENSIONS[dimKey]
      if (!dim && !master) {
        throw new ToolError(`dimension tidak dikenal. Pilihan: ${DIMENSION_NAMES.join(', ')}`)
      }
      const range = rangeOf(args)
      const basis = basisOf(args)
      const scope = scopeOf(args)
      const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 50)
      const f = filters(args, 3, basis.key)
      const sort = args.sort === 'bottom' ? 'bottom' : 'top'
      const arah = sort === 'bottom' ? 'ASC' : 'DESC'

      const wilayah = await regionLabels(args)

      // Dimensi dari master pelanggan (provinsi/kota/tipe): agregat dulu per
      // customer_id, master menyusul lewat LATERAL, baru dijumlahkan per wilayah.
      // JANGAN diubah jadi LEFT JOIN langsung — customer_code_lis tidak unik dan
      // terukur menggelembungkan nett Agustus 2026 sebesar +12,1%.
      const rows = master
        ? await salesQuery(
            customerDimensionSql({
              table: TABLE,
              basisColumn: basis.column,
              filterClause: f.clause,
              expr: master.expr,
              arah,
              limit
            }),
            [range.from, range.to, ...f.params]
          ).then((r) =>
            master.asCode
              ? r.map((row) => ({ ...row, kategori: customerTypeLabel(String(row.kategori)) }))
              : r
          )
        : // Dimensi item: agregat dulu, nama menyusul lewat LATERAL — angka tidak
          // boleh tersentuh join ke master yang kodenya tidak unik.
          dim.viaMaster
        ? await salesQuery(
            `WITH a AS (
               SELECT coalesce(item_code, '(tidak diisi)') AS kode,
                      count(DISTINCT order_id)::int      AS orderan,
                      count(*)::int                       AS baris,
                      coalesce(sum(nett_sales),0)::float8 AS nett
               FROM ${TABLE}
               WHERE ${basis.column} BETWEEN $1::date AND $2::date${f.clause}
               GROUP BY 1
             )
             SELECT CASE WHEN count(*) OVER (PARTITION BY t.nama) > 1 AND t.nama <> t.kode_item
                         THEN t.nama || ' [' || t.kode_item || ']'
                         ELSE t.nama END AS kategori,
                    t.kode_item, t."jumlahOrder", t."barisItem", t.nett
             FROM (
               SELECT ${ITEM_LABEL} AS nama, a.kode AS kode_item,
                      a.orderan AS "jumlahOrder", a.baris AS "barisItem", a.nett
               FROM a${ITEM_NAME_LOOKUP}
               ORDER BY a.nett ${arah} LIMIT ${limit}
             ) t
             ORDER BY t.nett ${arah}`,
            [range.from, range.to, ...f.params]
          )
        : await salesQuery(
            `SELECT coalesce(${dim.column}, '(tidak diisi)') AS kategori,
                    count(DISTINCT order_id)::int      AS "jumlahOrder",
                    count(*)::int                       AS "barisItem",
                    coalesce(sum(nett_sales),0)::float8 AS nett
             FROM ${TABLE}
             WHERE ${basis.column} BETWEEN $1::date AND $2::date${f.clause}
             GROUP BY 1 ORDER BY 4 ${arah} LIMIT ${limit}`,
            [range.from, range.to, ...f.params]
          )
      // Persen kontribusi dihitung di sini, BUKAN diserahkan ke model. "10 pelanggan
      // itu berapa persen dari total?" hampir selalu menyusul, dan tanpa total yang
      // ikut dikirim satu-satunya cara model menjawab adalah mengarang.
      const total = await summarize(range, basis, args)
      const share = withShare(
        rows as unknown as { nett: number }[],
        Number(total.nett ?? 0)
      )

      return JSON.stringify({
        periode: range.label,
        rentang: `${range.from} s/d ${range.to}`,
        basis: basis.key,
        cakupan: scope,
        catatanCakupan: erpNote(scope, basis.key, range.from),
        catatanPengakuan: RECOGNIZED_NOTE,
        ...wilayah,
        dimensi: (dim ?? master).label,
        ...(master
          ? {
              catatanDimensi:
                'Wilayah/tipe berasal dari master pelanggan (m_customer), yaitu lokasi INSTANSI pelanggan — ' +
                'bukan domisili pasien. Baris "(pelanggan tidak ada di master)" adalah transaksi yang kode ' +
                'pelanggannya belum terdaftar di master; sebutkan bila nilainya besar.'
            }
          : {}),
        urutan: sort === 'bottom' ? 'terkecil ke atas' : 'terbesar ke bawah',
        ...(sort === 'bottom'
          ? {
              catatanUrutan:
                'hanya mencakup yang PUNYA transaksi di periode ini; item yang sama sekali tidak ada ordernya tidak muncul di daftar'
            }
          : {}),
        totalNettPeriode: share.totalNett,
        persenTercakupDaftarIni: share.persenTercakup,
        catatanHitung:
          `${CATATAN_HITUNG} Kolom "persen" adalah kontribusi baris itu terhadap totalNettPeriode — ` +
          'SUDAH dihitung, pakai apa adanya dan JANGAN menghitung ulang sendiri. ' +
          'jumlahOrder per baris = order yang MEMUAT kategori itu; untuk dimensi yang satu ordernya ' +
          'bisa masuk beberapa kategori (mis. item/pemeriksaan), angka antar baris tumpang tindih ' +
          'sehingga tidak boleh dijumlahkan.',
        baris: share.baris,
        mataUang: 'IDR'
      })
    }
  },
  {
    name: 'sales_trend',
    label: 'Tren Penjualan',
    description:
      'Deret penjualan per hari/minggu/bulan dalam suatu periode. Pakai untuk melihat pola, tren naik-turun, ' +
      'atau menyiapkan bahan grafik.',
    parameters: {
      type: 'object',
      properties: {
        ...commonProps,
        granularity: {
          type: 'string',
          enum: ['day', 'week', 'month'],
          description: 'Granularitas deret (default: day)'
        }
      },
      required: ['period']
    },
    tier: 'read',
    timeoutMs: 60_000,
    summarize: (a) => `Tren penjualan ${a.period ?? 'today'} per ${a.granularity ?? 'day'}`,
    execute: async (args) => {
      guard()
      const range = rangeOf(args)
      const basis = basisOf(args)
      const scope = scopeOf(args)
      const granularity = ['day', 'week', 'month'].includes(String(args.granularity))
        ? String(args.granularity)
        : 'day'
      const f = filters(args, 3, basis.key)
      const wilayah = await regionLabels(args)
      const rows = await salesQuery(
        `SELECT to_char(date_trunc('${granularity}', ${basis.column}), 'YYYY-MM-DD') AS periode,
                count(DISTINCT order_id)::int      AS "jumlahOrder",
                count(*)::int                       AS "barisItem",
                coalesce(sum(nett_sales),0)::float8 AS nett
         FROM ${TABLE}
         WHERE ${basis.column} BETWEEN $1::date AND $2::date${f.clause}
         GROUP BY 1 ORDER BY 1 LIMIT 400`,
        [range.from, range.to, ...f.params]
      )
      return JSON.stringify({
        periode: range.label,
        rentang: `${range.from} s/d ${range.to}`,
        basis: basis.key,
        cakupan: scope,
        catatanCakupan: erpNote(scope, basis.key, range.from),
        catatanPengakuan: RECOGNIZED_NOTE,
        ...wilayah,
        catatanHitung: CATATAN_HITUNG,
        granularitas: granularity,
        deret: rows,
        mataUang: 'IDR'
      })
    }
  },
  {
    name: 'sales_movers',
    label: 'Item Naik & Turun',
    description:
      'Membandingkan penjualan PER ITEM antara dua periode, lalu menampilkan item yang paling naik dan ' +
      'paling turun beserta selisih rupiah dan persentasenya. Pakai untuk "item apa yang sedang naik", ' +
      '"item apa yang trennya menurun/jelek", "pemeriksaan apa yang mulai ditinggalkan", ' +
      '"apa yang berubah dibanding bulan lalu". Bila comparePeriod tidak diisi, pembandingnya periode sepadan sebelumnya.',
    parameters: {
      type: 'object',
      properties: {
        ...commonProps,
        comparePeriod: { type: 'string', description: `Periode pembanding. ${PERIOD_DESC}` },
        limit: { type: 'number', description: 'Jumlah item per arah (default 5, maks 20)' }
      },
      required: ['period']
    },
    tier: 'read',
    timeoutMs: 90_000,
    summarize: (a) => `Item naik & turun: ${a.period ?? 'today'} vs ${a.comparePeriod ?? 'periode sebelumnya'}`,
    execute: async (args) => {
      guard()
      const basis = basisOf(args)
      const scope = scopeOf(args)
      const current = rangeOf(args)
      // Periode pembanding yang dipilih model bisa jauh lebih panjang dari periode
      // berjalan (klasik: "bulan ini" 18 hari vs "bulan lalu" 31 hari) — disamakan
      // dulu supaya persentasenya tidak menyesatkan.
      const rawBaseline =
        typeof args.comparePeriod === 'string' && args.comparePeriod
          ? rangeOf({ ...args, period: args.comparePeriod })
          : previousRange(current)
      const aligned = alignBaseline(current, rawBaseline, jakartaToday())
      const baseline = aligned.range
      const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 20)
      const f = filters(args, 5, basis.key)
      const wilayah = await regionLabels(args)

      // Dua agregat terpisah lalu FULL OUTER JOIN: item yang hanya ada di salah satu
      // periode (baru muncul / berhenti sama sekali) tetap ikut terhitung.
      const rows = await salesQuery<{
        kode: string
        nama: string | null
        nett: number
        nettSebelum: number
        transaksi: number
        transaksiSebelum: number
      }>(
        `WITH kini AS (
           SELECT coalesce(item_code, '(tidak diisi)') AS kode,
                  count(*)::int AS trx, coalesce(sum(nett_sales),0)::float8 AS nett
           FROM ${TABLE}
           WHERE ${basis.column} BETWEEN $1::date AND $2::date${f.clause}
           GROUP BY 1
         ), dulu AS (
           SELECT coalesce(item_code, '(tidak diisi)') AS kode,
                  count(*)::int AS trx, coalesce(sum(nett_sales),0)::float8 AS nett
           FROM ${TABLE}
           WHERE ${basis.column} BETWEEN $3::date AND $4::date${f.clause}
           GROUP BY 1
         ), a AS (
           SELECT coalesce(k.kode, d.kode)          AS kode,
                  coalesce(k.nett, 0)::float8       AS nett,
                  coalesce(d.nett, 0)::float8       AS nett_sebelum,
                  coalesce(k.trx, 0)::int           AS transaksi,
                  coalesce(d.trx, 0)::int           AS transaksi_sebelum
           FROM kini k FULL OUTER JOIN dulu d ON k.kode = d.kode
         )
         SELECT a.kode, m.item_name AS nama, a.nett, a.nett_sebelum AS "nettSebelum",
                a.transaksi, a.transaksi_sebelum AS "transaksiSebelum"
         FROM a${ITEM_NAME_LOOKUP}
         WHERE a.nett <> a.nett_sebelum
         ORDER BY abs(a.nett - a.nett_sebelum) DESC
         LIMIT 300`,
        [current.from, current.to, baseline.from, baseline.to, ...f.params]
      )

      const { naik, turun } = computeMovers(rows, limit)
      return JSON.stringify({
        basis: basis.key,
        catatanBasis: basis.note,
        cakupan: scope,
        catatanCakupan: erpNote(scope, basis.key, baseline.from),
        catatanPengakuan: RECOGNIZED_NOTE,
        ...wilayah,
        periodeUtama: { label: current.label, rentang: `${current.from} s/d ${current.to}` },
        periodePembanding: { label: baseline.label, rentang: `${baseline.from} s/d ${baseline.to}` },
        ...(aligned.disamakan
          ? {
              catatanPerbandingan:
                'Periode berjalan belum genap, jadi periode pembanding DIPOTONG ke jumlah hari yang sama agar setara. ' +
                'Sebutkan hal ini ke user beserta rentang tanggalnya.'
            }
          : {}),
        catatan:
          'Diurutkan menurut SELISIH RUPIAH, bukan persentase. status "baru" = tidak ada penjualan di periode pembanding ' +
          '(persen tidak terdefinisi), status "berhenti" = ada sebelumnya tapi nol di periode ini.',
        itemNaik: naik,
        itemTurun: turun,
        mataUang: 'IDR'
      })
    }
  },
  {
    name: 'sales_ytd',
    label: 'YTD & Pertumbuhan',
    description:
      'Membandingkan YEAR-TO-DATE dua tahun dan menghitung pertumbuhannya — mis. "YTD Juli 2026 vs 2025". ' +
      'Pakai untuk pertanyaan pertumbuhan tahunan: "sales tahun ini tumbuh atau tidak", "growth YTD", ' +
      '"bandingkan tahun ini dengan tahun lalu sampai bulan X", "YTD Juni 2026 vs 2025". ' +
      'Menghasilkan nett, jumlah order, dan pertumbuhan persen; bisa disertai rincian per bulan.',
    parameters: {
      type: 'object',
      properties: {
        throughMonth: {
          type: 'string',
          description:
            'YTD sampai bulan apa. Boleh nama ("Juli") atau angka 1-12. Default: bulan berjalan.'
        },
        year: { type: 'number', description: 'Tahun utama. Default: tahun berjalan.' },
        compareYear: { type: 'number', description: 'Tahun pembanding. Default: tahun utama dikurangi 1.' },
        perBulan: {
          type: 'boolean',
          description: 'Sertakan rincian per bulan kedua tahun (default true) — berguna untuk melihat polanya.'
        },
        basis: { type: 'string', enum: ['order', 'invoice'], description: BASIS_DESC },
        scope: { type: 'string', enum: [...ERP_SCOPES], description: SCOPE_DESC },
        source: { type: 'string', description: 'Filter kategori layanan, mis. Molekuler, PK, Histologi' },
        branch: { type: 'string', description: 'Filter kode cabang, mis. 01' },
        province: { type: 'string', description: 'Filter provinsi asal pelanggan' },
        city: { type: 'string', description: 'Filter kota/kabupaten asal pelanggan' }
      },
      required: []
    },
    tier: 'read',
    timeoutMs: 90_000,
    summarize: (a) =>
      `YTD ${a.throughMonth ?? 'bulan berjalan'} ${a.year ?? ''} vs ${a.compareYear ?? 'tahun sebelumnya'}`.replace(
        /\s+/g,
        ' '
      ),
    execute: async (args) => {
      guard()
      const today = jakartaToday()
      const tahunIni = Number(today.slice(0, 4))
      const bulanIni = Number(today.slice(5, 7))

      const year = Number.isInteger(Number(args.year)) && Number(args.year) > 2000
        ? Number(args.year)
        : tahunIni
      const bulan =
        args.throughMonth === undefined || args.throughMonth === null || args.throughMonth === ''
          ? year === tahunIni
            ? bulanIni
            : 12
          : parseMonth(args.throughMonth)
      if (!bulan) {
        throw new ToolError(
          `throughMonth tidak dikenal. Pakai angka 1-12 atau nama bulan, mis. "Juli". Pilihan: ${MONTH_NAMES.join(', ')}`
        )
      }
      const compareYear =
        Number.isInteger(Number(args.compareYear)) && Number(args.compareYear) > 2000
          ? Number(args.compareYear)
          : year - 1
      if (compareYear === year) throw new ToolError('compareYear tidak boleh sama dengan year')

      let current: DateRange
      try {
        current = ytdRange(year, bulan, today)
      } catch (err: any) {
        throw new ToolError(String(err?.message ?? err))
      }
      // Hari potong tahun pembanding SELALU disamakan — ini inti keadilan YTD.
      const baseline = ytdCompareRange(current, compareYear)

      const basis = basisOf(args)
      const scope = scopeOf(args)
      const [kini, dulu] = await Promise.all([
        summarize(current, basis, args),
        summarize(baseline, basis, args)
      ])

      const nettKini = Number(kini.nett ?? 0)
      const nettDulu = Number(dulu.nett ?? 0)
      const selisih = nettKini - nettDulu
      const growthMentah = nettDulu === 0 ? null : Math.round((selisih / nettDulu) * 1000) / 10

      const orderKini = Number(kini.jumlahOrder ?? 0)
      const orderDulu = Number(dulu.jumlahOrder ?? 0)
      const growthOrderMentah =
        orderDulu === 0 ? null : Math.round(((orderKini - orderDulu) / orderDulu) * 1000) / 10

      // Growth lintas tahun TIDAK BERMAKNA bila cakupannya ERP sedangkan tahun
      // pembanding ada di masa sebelum bridging berjalan: terukur YTD Juli 2026 vs 2025
      // dengan scope=erp menghasilkan "+3.512.884%", karena 2025 nyaris nol bukan
      // karena bisnisnya meledak. Angka mentahnya tetap dikirim, tapi growthPersen
      // sengaja dikosongkan supaya tidak dikutip sebagai pertumbuhan bisnis.
      const growthMenyesatkan = scope !== 'all' && baseline.from < ERP_BRIDGING_START
      const growth = growthMenyesatkan ? null : growthMentah
      const growthOrder = growthMenyesatkan ? null : growthOrderMentah

      const perBulan = args.perBulan !== false
      let deret: unknown[] | undefined
      if (perBulan) {
        const f = filters(args, 3, basis.key)
        const bulanan = await salesQuery<Record<string, any>>(
          `SELECT to_char(date_trunc('month', ${basis.column}), 'YYYY-MM') AS bulan,
                  count(DISTINCT order_id)::int       AS "jumlahOrder",
                  coalesce(sum(nett_sales),0)::float8  AS nett
           FROM ${TABLE}
           WHERE (${basis.column} BETWEEN $1::date AND $2::date
                  OR ${basis.column} BETWEEN $${3 + f.params.length}::date AND $${4 + f.params.length}::date)${f.clause}
           GROUP BY 1 ORDER BY 1`,
          [current.from, current.to, ...f.params, baseline.from, baseline.to]
        )
        // Disusun berpasangan per nomor bulan supaya mudah dibaca & dibuat grafik.
        const map = new Map(bulanan.map((r) => [String(r.bulan), r]))
        deret = Array.from({ length: bulan }, (_, i) => {
          const mm = String(i + 1).padStart(2, '0')
          const a = map.get(`${year}-${mm}`)
          const b = map.get(`${compareYear}-${mm}`)
          const nettA = Number(a?.nett ?? 0)
          const nettB = Number(b?.nett ?? 0)
          return {
            bulan: MONTH_NAMES[i],
            [`nett${year}`]: nettA,
            [`nett${compareYear}`]: nettB,
            selisih: nettA - nettB,
            growthPersen: nettB === 0 ? null : Math.round(((nettA - nettB) / nettB) * 1000) / 10
          }
        })
      }

      return JSON.stringify({
        basis: basis.key,
        catatanBasis: basis.note,
        cakupan: scope,
        catatanCakupan: erpNote(scope, basis.key, baseline.from),
        catatanPengakuan: RECOGNIZED_NOTE,
        ytdUtama: { label: current.label, rentang: `${current.from} s/d ${current.to}`, ...kini },
        ytdPembanding: { label: baseline.label, rentang: `${baseline.from} s/d ${baseline.to}`, ...dulu },
        selisihNett: selisih,
        growthPersen: growth,
        growthOrderPersen: growthOrder,
        arah: selisih > 0 ? 'tumbuh' : selisih < 0 ? 'turun' : 'sama',
        ...(growthMenyesatkan
          ? {
              growthPersenMentah: growthMentah,
              peringatanGrowth:
                `Persentase pertumbuhan SENGAJA tidak dihitung: cakupan "${scope}" bergantung pada flag ` +
                `bridging ERP yang baru berjalan penuh sejak ${ERP_BRIDGING_START}, sedangkan periode ` +
                'pembanding ada sebelum itu. Angkanya akan terlihat melonjak ribuan persen padahal itu ' +
                'efek bridging, BUKAN pertumbuhan bisnis. Sampaikan hal ini ke user dan sarankan memakai ' +
                'cakupan "all" untuk mengukur pertumbuhan lintas tahun.'
            }
          : {}),
        catatanPerbandingan:
          `Kedua tahun dipotong pada hari yang sama (${current.to.slice(5)} vs ${baseline.to.slice(5)}) ` +
          'supaya setara. Sebutkan rentang tanggalnya saat menjawab.',
        catatanHitung: CATATAN_HITUNG,
        ...(deret ? { perBulan: deret } : {}),
        mataUang: 'IDR'
      })
    }
  },
  {
    name: 'sales_customers',
    label: 'Pelanggan Berhenti & Baru',
    description:
      'Menilai PELANGGAN, bukan item: siapa yang BERHENTI order (dulu rutin, sekarang diam), ' +
      'siapa yang MELEMAH (masih order tapi turun jauh), dan siapa yang BARU. ' +
      'Pakai untuk "pelanggan mana yang berhenti order", "pelanggan mana yang sudah lama tidak order", ' +
      '"siapa yang ordernya turun drastis", "pelanggan baru bulan ini siapa saja", "customer yang hilang". ' +
      'Penilaiannya memakai irama order tiap pelanggan (berapa bulan aktif) + berapa lama diam + nilainya, ' +
      'BUKAN sekadar membandingkan dua bulan. Hasilnya diurutkan menurut RUPIAH yang dipertaruhkan. ' +
      'Akun "Pasien Pribadi" dikecualikan secara default karena itu pasien perorangan berharga khusus ' +
      'dari dokter, bukan instansi yang bisa ditindaklanjuti sales.',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: [...STATUS_PELANGGAN],
          description:
            '"berhenti" (default) = dulu rutin, sekarang diam lama. "melemah" = masih order tapi ' +
            'nilainya turun jauh. "baru" = order pertamanya di jendela terkini.'
        },
        segmen: {
          type: 'string',
          enum: [...SEGMEN_PELANGGAN],
          description:
            '"institusi" (default) = RS, klinik, lab, apotek — yang bisa ditindaklanjuti sales. ' +
            '"pasien_pribadi" = akun pasien perorangan. "semua" = keduanya digabung.'
        },
        pengamatanBulan: {
          type: 'number',
          description: 'Rentang pengamatan irama order, dalam bulan (default 12, maks 24)'
        },
        minBulanAktif: {
          type: 'number',
          description: 'Minimal berapa bulan pelanggan pernah aktif agar dianggap rutin (default 4)'
        },
        diamHari: {
          type: 'number',
          description: 'Berapa hari tanpa order sampai dianggap berhenti (default 60)'
        },
        jendelaHari: {
          type: 'number',
          description: 'Panjang jendela terkini untuk status "melemah" dan "baru" (default 90)'
        },
        limit: { type: 'number', description: 'Jumlah baris (default 15, maks 50)' },
        basis: { type: 'string', enum: ['order', 'invoice'], description: BASIS_DESC },
        scope: { type: 'string', enum: [...ERP_SCOPES], description: SCOPE_DESC },
        source: commonProps.source,
        branch: commonProps.branch,
        province: commonProps.province,
        city: commonProps.city
      },
      required: []
    },
    tier: 'read',
    timeoutMs: 90_000,
    summarize: (a) =>
      `Pelanggan ${a.status ?? 'berhenti'} (${a.segmen ?? 'institusi'})`,
    execute: async (args) => {
      guard()
      const basis = basisOf(args)
      const scope = scopeOf(args)
      const status = isStatusPelanggan(args.status) ? args.status : 'berhenti'
      const segmen = isSegmenPelanggan(args.segmen) ? args.segmen : 'institusi'
      const bulanPengamatan = Math.min(Math.max(Number(args.pengamatanBulan) || 12, 3), 24)
      const jendelaHari = Math.min(Math.max(Number(args.jendelaHari) || DEFAULT_JENDELA_HARI, 7), 365)
      const limit = Math.min(Math.max(Number(args.limit) || 15, 1), 50)
      const ambang = {
        minBulanAktif: Math.min(Math.max(Number(args.minBulanAktif) || DEFAULT_MIN_BULAN_AKTIF, 1), 24),
        diamHari: Math.min(Math.max(Number(args.diamHari) || DEFAULT_DIAM_HARI, 7), 365),
        jendelaHari
      }

      const hariIni = jakartaToday()
      const mulai = new Date(`${hariIni}T00:00:00Z`)
      mulai.setUTCMonth(mulai.getUTCMonth() - bulanPengamatan)
      const dari = mulai.toISOString().slice(0, 10)

      const wilayah = await regionLabels(args)
      const f = filters(args, 4, basis.key)

      // Satu kali jalan per pelanggan: irama, order terakhir, order pertama, dan nilai
      // pada dua jendela berurutan. Nama diambil dari master lewat LATERAL (master tidak
      // unik — lihat aturan), dengan cadangan nama dari tabel transaksi karena 156
      // pelanggan yang bertransaksi 12 bulan terakhir belum terdaftar di master.
      const rows = await salesQuery<BarisPelanggan>(
        customerHistorySql({ table: TABLE, basisColumn: basis.column, filterClause: f.clause }),
        [dari, hariIni, jendelaHari, ...f.params],
        // Membaca 12 bulan penuh: 2–3 detik saat cache hangat, tapi bisa 40 detik pada
        // pemanggilan pertama (tabelnya ~500 MB). Batas bawaan 20 detik tidak cukup.
        { heavy: true }
      )

      const terpilih = pilihPelanggan(rows, status, segmen, ambang)
      const totalNett = terpilih.reduce((s, r) => s + Number(r.nettTotal || 0), 0)

      return JSON.stringify({
        status,
        segmen,
        rentangPengamatan: `${dari} s/d ${hariIni} (${bulanPengamatan} bulan)`,
        basis: basis.key,
        catatanBasis: basis.note,
        cakupan: scope,
        catatanCakupan: erpNote(scope, basis.key, dari),
        catatanPengakuan: RECOGNIZED_NOTE,
        ...wilayah,
        kriteria:
          status === 'berhenti'
            ? `pernah aktif minimal ${ambang.minBulanAktif} bulan DAN sudah lebih dari ${ambang.diamHari} hari tidak order`
            : status === 'melemah'
              ? `masih order (diam <= ${ambang.diamHari} hari) tetapi nett ${jendelaHari} hari terakhir turun minimal ${DEFAULT_MIN_TURUN_PERSEN}% dibanding ${jendelaHari} hari sebelumnya`
              : `order pertamanya jatuh dalam ${jendelaHari} hari terakhir`,
        catatanSegmen:
          segmen === 'institusi'
            ? 'Akun "Pasien Pribadi" DIKECUALIKAN — itu pasien perorangan dengan harga khusus dari dokter, ' +
              'bukan instansi yang bisa ditindaklanjuti sales. Sebutkan hal ini saat menjawab.'
            : segmen === 'pasien_pribadi'
              ? 'HANYA akun pasien perorangan; institusi tidak termasuk.'
              : 'Institusi dan pasien perorangan digabung — hati-hati, keduanya jalur komersial yang berbeda.',
        catatan:
          'Diurutkan menurut RUPIAH yang dipertaruhkan, bukan lamanya diam — kehilangan satu pelanggan besar ' +
          'lebih penting daripada beberapa pelanggan kecil. "Baru" berarti order pertamanya ada di dalam ' +
          'rentang pengamatan ini saja, bukan seumur hidup pelanggan.',
        jumlahPelanggan: terpilih.length,
        totalNettPengamatan: totalNett,
        baris: terpilih.slice(0, limit),
        mataUang: 'IDR'
      })
    }
  },
  {
    name: 'sales_report',
    label: 'Laporan Penjualan',
    description:
      'Membuat LAPORAN PENJUALAN lengkap sebagai file Word (.docx), PDF (.pdf), ATAU Excel (.xlsx) '
      + '— tentukan lewat akhiran path — dalam satu langkah: ringkasan ' +
      'eksekutif, kinerja periode, perbandingan periode sebelumnya, pertumbuhan YTD, kontribusi per ' +
      'kategori layanan, pemeriksaan & pelanggan terbesar, sebaran wilayah, item naik-turun, ' +
      'pelanggan yang berhenti order, dan catatan metodologi. ' +
      'Pakai untuk "buatkan laporan penjualan bulan ini", "bikin laporan sales Agustus", ' +
      '"laporan bulanan untuk manajemen". ' +
      'Tool ini MENULIS FILENYA SENDIRI — JANGAN memanggil write_word sesudahnya, dan JANGAN ' +
      'menyalin ulang angkanya; cukup sebutkan lokasi file dan ringkas 2-3 temuan utamanya.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path file .docx yang akan dibuat, mis. D:\\Laporan\\sales-agustus-2026.docx'
        },
        period: { type: 'string', description: PERIOD_DESC },
        from: { type: 'string', description: 'Tanggal awal YYYY-MM-DD (khusus period=custom)' },
        to: { type: 'string', description: 'Tanggal akhir YYYY-MM-DD (khusus period=custom)' },
        judul: { type: 'string', description: 'Judul laporan (opsional)' },
        basis: { type: 'string', enum: ['order', 'invoice'], description: BASIS_DESC },
        scope: { type: 'string', enum: [...ERP_SCOPES], description: SCOPE_DESC },
        source: commonProps.source,
        branch: commonProps.branch,
        province: commonProps.province,
        city: commonProps.city
      },
      required: ['path']
    },
    tier: 'write',
    timeoutMs: 180_000,
    summarize: (a) => `Buat laporan penjualan ${a.period ?? 'this_month'} → ${a.path}`,
    execute: async (args, ctx) => {
      guard()
      const file = resolveInBoundary(String(args.path ?? ''), ctx.allowedDirs)
      const rendah = file.toLowerCase()
      const format = rendah.endsWith('.pdf')
        ? 'pdf'
        : rendah.endsWith('.xlsx')
          ? 'xlsx'
          : rendah.endsWith('.docx')
            ? 'docx'
            : null
      if (format === null) {
        throw new ToolError('path laporan harus berakhiran .docx, .pdf, atau .xlsx')
      }
      if (format === 'pdf' && !pdfSiap()) {
        throw new ToolError('pembuatan PDF belum siap — aplikasi masih memuat, coba lagi sebentar')
      }
      if (existsSync(file)) {
        throw new ToolError(`file "${file}" sudah ada — pilih nama lain agar tidak menimpa`)
      }

      const range = rangeOf({ ...args, period: args.period ?? 'this_month' })
      const basis = basisOf(args)
      const scope = scopeOf(args)
      const hariIni = jakartaToday()

      // Pembanding untuk laporan BULANAN adalah bulan sebelumnya pada rentang tanggal
      // yang sama (1-18 Agustus vs 1-18 Juli), bukan "18 hari terakhir sebelum periode"
      // (14-31 Juli) yang dihasilkan previousRange. Ekor bulan memuat lonjakan akhir
      // bulan sehingga perbandingannya menyesatkan — terukur -30,9% semu pada percobaan
      // pertama. Untuk periode non-bulanan, periode sepadan sebelumnya tetap dipakai.
      const periodeArg = typeof args.period === 'string' ? args.period : 'this_month'
      const kasar =
        periodeArg === 'this_month'
          ? resolvePeriod('last_month', hariIni, {})
          : previousRange(range)
      const aligned = alignBaseline(range, kasar, hariIni)
      const baseline = aligned.range

      const wilayah = await regionLabels(args)
      const [kini, lalu] = await Promise.all([
        summarize(range, basis, args),
        summarize(baseline, basis, args)
      ])

      const ambil = async (dimensi: string, limit: number): Promise<BarisRingkas[]> => {
        const hasil = JSON.parse(
          await (salesTools.find((t) => t.name === 'sales_breakdown') as ToolDefinition).execute(
            { ...args, period: 'custom', from: range.from, to: range.to, dimension: dimensi, limit },
            ctx
          )
        ) as { baris?: Array<Record<string, unknown>> }
        return (hasil.baris ?? []).map((r) => ({
          kategori: String(r.kategori ?? '-'),
          nett: Number(r.nett ?? 0),
          persen: r.persen === null || r.persen === undefined ? null : Number(r.persen),
          jumlahOrder: r.jumlahOrder === undefined ? undefined : Number(r.jumlahOrder)
        }))
      }

      const [perSource, topItem, topPelanggan, perProvinsi] = await Promise.all([
        ambil('source', 10),
        ambil('item', 10),
        ambil('customer', 10),
        ambil('province', 10)
      ])

      const moversJson = JSON.parse(
        await (salesTools.find((t) => t.name === 'sales_movers') as ToolDefinition).execute(
          { ...args, period: 'custom', from: range.from, to: range.to, limit: 5 },
          ctx
        )
      ) as { itemNaik?: Array<Record<string, unknown>>; itemTurun?: Array<Record<string, unknown>> }
      const asMover = moverDariHasil

      const pelJson = JSON.parse(
        await (salesTools.find((t) => t.name === 'sales_customers') as ToolDefinition).execute(
          { ...args, status: 'berhenti', segmen: 'institusi', limit: 10 },
          ctx
        )
      ) as {
        baris?: Array<Record<string, unknown>>
        jumlahPelanggan?: number
        totalNettPengamatan?: number
      }

      let ytd: DataLaporan['ytd']
      try {
        const y = JSON.parse(
          await (salesTools.find((t) => t.name === 'sales_ytd') as ToolDefinition).execute(
            { ...args, throughMonth: Number(range.to.slice(5, 7)), year: Number(range.to.slice(0, 4)), perBulan: false },
            ctx
          )
        ) as Record<string, any>
        ytd = {
          label: String(y.ytdUtama?.label ?? 'YTD tahun ini'),
          labelPembanding: String(y.ytdPembanding?.label ?? 'YTD tahun lalu'),
          nett: Number(y.ytdUtama?.nett ?? 0),
          nettPembanding: Number(y.ytdPembanding?.nett ?? 0),
          growthPersen: y.growthPersen === null || y.growthPersen === undefined ? null : Number(y.growthPersen),
          peringatan: typeof y.peringatanGrowth === 'string' ? y.peringatanGrowth : undefined
        }
      } catch {
        // YTD hanya pelengkap — laporan tetap dibuat kalau bagian ini gagal.
        ytd = undefined
      }

      const data: DataLaporan = {
        judul:
          typeof args.judul === 'string' && args.judul.trim()
            ? args.judul.trim()
            : `Laporan Penjualan — ${labelPeriode(range.from, range.to)}`,
        periodeLabel: labelPeriode(range.from, range.to),
        periodeRentang: `${range.from} s/d ${range.to}`,
        pembandingLabel: labelPeriode(baseline.from, baseline.to),
        pembandingRentang: `${baseline.from} s/d ${baseline.to}`,
        dibuatPada: hariIni,
        basisKey: basis.key,
        catatanBasis: basis.note,
        catatanCakupan: erpNote(scope, basis.key, range.from),
        catatanPengakuan: RECOGNIZED_NOTE,
        catatanPerbandingan: aligned.disamakan
          ? 'Periode berjalan belum genap, sehingga periode pembanding dipotong ke jumlah hari yang sama agar setara.'
          : undefined,
        kini: {
          nett: Number(kini.nett ?? 0),
          gross: Number(kini.gross ?? 0),
          diskon: Number(kini.diskon ?? 0),
          jumlahOrder: Number(kini.jumlahOrder ?? 0),
          barisItem: Number(kini.barisItem ?? 0),
          jumlahInvoice: Number(kini.jumlahInvoice ?? 0),
          pelanggan: Number(kini.pelanggan ?? 0),
          jenisItem: Number(kini.jenis_item ?? 0)
        },
        lalu: {
          nett: Number(lalu.nett ?? 0),
          jumlahOrder: Number(lalu.jumlahOrder ?? 0),
          pelanggan: Number(lalu.pelanggan ?? 0)
        },
        ytd,
        perSource,
        topItem,
        topPelanggan,
        perProvinsi,
        itemNaik: (moversJson.itemNaik ?? []).map(asMover),
        itemTurun: (moversJson.itemTurun ?? []).map(asMover),
        pelangganBerhenti: (pelJson.baris ?? []).map((r) => ({
          nama: String(r.nama ?? '-'),
          bulanAktif: Number(r.bulanAktif ?? 0),
          hariDiam: Number(r.hariDiam ?? 0),
          nettTotal: Number(r.nettTotal ?? 0)
        })),
        jumlahPelangganBerhenti: Number(pelJson.jumlahPelanggan ?? 0),
        nilaiPelangganBerhenti: Number(pelJson.totalNettPengamatan ?? 0)
      }

      const blocks = susunLaporan(data)

      // Grafik dibuat dari `data` yang SAMA dengan tabelnya — tidak ada angka
      // yang dihitung ulang di jalur grafik. Grafik yang berbeda dari tabel di
      // dokumen yang sama adalah kesalahan terburuk: dua-duanya terlihat resmi
      // dan pembaca tidak tahu mana yang benar.
      const rencanaGrafik = grafikLaporan(data)
      let grafikJadi = 0
      const HEADINGS: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
        h1: HeadingLevel.HEADING_1,
        h2: HeadingLevel.HEADING_2,
        h3: HeadingLevel.HEADING_3
      }
      let halaman: number | null = null
      let jumlahSheet: number | null = null
      if (format === 'xlsx') {
        // Excel dipakai untuk dihitung ulang & disaring, bukan dibaca sebagai
        // narasi — jadi bentuknya tabel per sheet, bukan prosa yang dipindahkan
        // ke dalam sel. Angkanya tetap dari `data` yang sama dengan Word/PDF.
        const sheets = susunLaporanExcel(data)
        const workbook = new ExcelJS.Workbook()
        workbook.creator = 'AIRA'
        workbook.created = new Date()
        for (const sheet of sheets) {
          const ws = workbook.addWorksheet(sheet.name.slice(0, 31))
          for (const row of sheet.rows) ws.addRow(row)
          rapikanSheet(ws)
        }
        // Grafik ditaruh di sheet SENDIRI, bukan menumpang sheet data: Excel
        // dipakai orang untuk menyaring & menjumlah ulang, dan gambar yang
        // mengambang di atas baris ikut bergeser saat difilter.
        if (rencanaGrafik.length > 0) {
          const wsGrafik = workbook.addWorksheet('Grafik')
          let baris = 1
          for (const g of rencanaGrafik) {
            const png = await keSvgPng(g.spek)
            if (!png) continue
            const id = workbook.addImage({ buffer: png as unknown as ExcelJS.Buffer, extension: 'png' })
            wsGrafik.addImage(id, {
              tl: { col: 0, row: baris },
              ext: { width: 720, height: (g.spek.tinggi ?? 460) * 0.8 }
            })
            baris += Math.ceil(((g.spek.tinggi ?? 460) * 0.8) / 20) + 2
            grafikJadi++
          }
        }
        await workbook.xlsx.writeFile(file)
        jumlahSheet = sheets.length + (grafikJadi > 0 ? 1 : 0)
      } else if (format === 'pdf') {
        // Isi laporan tetap disusun `susunLaporan` yang SAMA dengan versi Word —
        // hanya wadahnya yang berbeda. Menyusunnya terpisah berarti laporan Word
        // dan PDF untuk periode yang sama bisa berbeda isi.
        // PDF memakai SVG APA ADANYA — Chromium yang menggambarnya saat
        // mencetak, jadi hasilnya vektor dan tetap tajam di zoom berapa pun.
        // Tidak ada rasterisasi di jalur ini.
        const svg: string[] = []
        for (const g of rencanaGrafik) {
          try {
            svg.push(keSvg(g.spek))
            grafikJadi++
          } catch (err) {
            logger().warn({ judul: g.spek.judul, err: String(err) }, 'grafik PDF gagal digambar')
          }
        }
        const htmlIsi = sisipkanGrafik(markdownToHtml(blokKeMarkdown(blocks)), svg)
        const hasil = await tulisPdfDariHtml(htmlIsi, file, {
          judul: data.judul,
          subjudul: `${range.label} (${range.from} s/d ${range.to}) · basis ${basis.key}`,
          catatanKaki: data.judul
        })
        halaman = hasil.halaman
      } else {
        // Word tidak bisa menampilkan SVG dengan andal di semua versi Office,
        // jadi grafiknya dirasterisasi jadi PNG. PDF tidak melewati jalur ini —
        // di sana SVG dipakai apa adanya supaya tetap vektor.
        const gambarWord: Paragraph[] = []
        for (const g of rencanaGrafik) {
          const png = await keSvgPng(g.spek)
          if (!png) continue
          gambarWord.push(
            new Paragraph({
              children: [
                new ImageRun({
                  type: 'png',
                  data: png,
                  transformation: {
                    width: 600,
                    height: Math.round((g.spek.tinggi ?? 460) * 0.66)
                  }
                })
              ]
            })
          )
          grafikJadi++
        }

        const paragraf = blocks.map((b) =>
          b.type in HEADINGS
            ? new Paragraph({ text: b.text, heading: HEADINGS[b.type] })
            : b.type === 'bullet'
              ? new Paragraph({ text: b.text, bullet: { level: 0 } })
              : new Paragraph({ text: b.text })
        )
        // Grafik ditaruh SEBELUM bagian pertama (h2), bukan di akhir dokumen:
        // pembaca manajemen membaca halaman pertama lalu berhenti, jadi gambar
        // di belakang praktis tidak pernah sampai.
        const bagianPertama = blocks.findIndex((b) => b.type === 'h2')
        const isi =
          bagianPertama > 0
            ? [
                ...paragraf.slice(0, bagianPertama),
                ...gambarWord,
                ...paragraf.slice(bagianPertama)
              ]
            : [...paragraf, ...gambarWord]

        const doc = new Document({
          // Font korporat juga di dokumen Word. ⚠️ Berbeda dari PDF, font di
          // .docx TIDAK ikut tertanam — Word memakai yang terpasang di komputer
          // PEMBACA. Di lingkungan the company fontnya ada; di luar itu Word memilih
          // penggantinya sendiri. Itulah salah satu alasan PDF lebih cocok untuk
          // laporan yang dikirim keluar.
          styles: { default: { document: { run: { font: 'company serif font' } } } },
          sections: [{ children: isi }]
        })
        writeFileSync(file, await Packer.toBuffer(doc))
      }

      return JSON.stringify({
        laporanDibuat: file,
        format,
        halaman,
        jumlahSheet,
        periode: range.label,
        rentang: `${range.from} s/d ${range.to}`,
        basis: basis.key,
        ...wilayah,
        jumlahBagian: blocks.filter((b) => b.type === 'h2').length,
        nett: Number(kini.nett ?? 0),
        jumlahOrder: Number(kini.jumlahOrder ?? 0),
        pelangganBerhenti: Number(pelJson.jumlahPelanggan ?? 0),
        grafik: grafikJadi,
        // ⚠️ Grafik yang GAGAL wajib disebut. Dokumen yang kehilangan grafiknya
        // tanpa keterangan terlihat persis seperti dokumen yang memang tidak
        // bergrafik, dan tidak ada yang bisa tahu ada yang hilang.
        catatanGrafik: catatanGrafik(rencanaGrafik.length, grafikJadi),
        catatan:
          `File ${format.toUpperCase()} SUDAH ditulis oleh tool ini. JANGAN memanggil write_word, ` +
          'write_pdf, maupun write_excel sesudahnya. Sampaikan lokasi filenya ke user dan ringkas ' +
          '2-3 temuan utama saja — jangan mengulang seluruh isi laporan.' +
          (format === 'xlsx'
            ? ' Versi Excel berisi beberapa sheet (Ringkasan, per kategori, pemeriksaan & pelanggan ' +
              'terbesar, wilayah, naik-turun, pelanggan berhenti, metodologi) dengan angka sebagai ' +
              'ANGKA sehingga bisa langsung dijumlahkan penerimanya.'
            : '')
      })
    }
  },
  {
    name: 'sales_projection',
    label: 'Proyeksi Bulan Berjalan',
    description:
      'Memproyeksikan penjualan bulan BERJALAN sampai tutup bulan, berdasarkan yang sudah ' +
      'terkumpul sampai hari ini dan pola penumpukan historis. Pakai untuk "kira-kira bulan ini ' +
      'tutup di berapa", "sampai akhir bulan bisa berapa". Untuk bulan-bulan YANG AKAN DATANG ' +
      'pakai sales_forecast, bukan tool ini.',
    parameters: {
      type: 'object',
      properties: {
        basis: { type: 'string', enum: ['order', 'invoice'], description: BASIS_DESC },
        scope: { type: 'string', enum: [...ERP_SCOPES], description: SCOPE_DESC },
        source: commonProps.source,
        branch: commonProps.branch,
        province: commonProps.province,
        city: commonProps.city
      }
    },
    tier: 'read',
    timeoutMs: 60_000,
    summarize: () => 'Proyeksi penjualan bulan berjalan',
    execute: async (args) => {
      guard()
      const basis = basisOf(args)
      const scope = scopeOf(args)
      const f = filters(args, 1, basis.key)
      const hariIni = jakartaToday()
      const hariKe = Number(hariIni.slice(8, 10))
      const [tahun, bulan] = hariIni.slice(0, 7).split('-').map(Number)
      const hariDalamBulan = new Date(tahun, bulan, 0).getDate()

      // Sejauh ini bulan berjalan.
      const [kini] = await salesQuery<{ nett: string; order: string }>(
        `SELECT coalesce(sum(nett_sales), 0) AS nett,
                count(DISTINCT order_id)     AS "order"
           FROM public."SalesRepository"
          WHERE ${basis.column} >= date_trunc('month', now())
            AND ${basis.column} <= now()${f.clause}`,
        f.params
      )

      // Kurva penumpukan: rata-rata porsi nett yang sudah terkumpul sampai
      // tanggal-ke pada 6 bulan penuh terakhir.
      //
      // ⚠️ Dihitung dari database, BUKAN konstanta di kode — kebiasaan lab
      // bergeser (hari libur, pola rujukan), dan kurva yang membeku akan
      // diam-diam makin meleset tanpa ada yang tahu sebabnya.
      const kurva = await salesQuery<{ hari: number; porsi: string }>(
        `WITH per_hari AS (
           SELECT to_char(date_trunc('month', ${basis.column}), 'YYYY-MM') AS bln,
                  extract(day FROM ${basis.column})::int AS hari,
                  sum(nett_sales) AS nett
             FROM public."SalesRepository"
            WHERE ${basis.column} >= date_trunc('month', now()) - interval '6 months'
              AND ${basis.column} < date_trunc('month', now())${f.clause}
            GROUP BY 1, 2
         ), kum AS (
           SELECT bln, hari,
                  sum(nett) OVER (PARTITION BY bln ORDER BY hari)
                    / NULLIF(sum(nett) OVER (PARTITION BY bln), 0) AS porsi
             FROM per_hari
         )
         SELECT hari, avg(porsi) AS porsi FROM kum GROUP BY hari ORDER BY hari`,
        f.params
      )
      const peta = new Map<number, number>()
      for (const k of kurva) peta.set(Number(k.hari), Number(k.porsi))

      const nett = Number(kini?.nett ?? 0)
      const p = proyeksiBulanBerjalan(nett, hariKe, hariDalamBulan, peta)

      // Riwayat bulan penuh — untuk menjawab pertanyaan yang SELALU menyusul:
      // "Rp 8 M itu bagus atau jelek?". Proyeksi sendirian tidak menjawabnya;
      // ia baru berarti setelah dibandingkan dengan yang seharusnya menurut tren.
      const riwayat = (
        await salesQuery<{ bulan: string; nett: string }>(
          `SELECT to_char(date_trunc('month', ${basis.column}), 'YYYY-MM') AS bulan,
                  sum(nett_sales) AS nett
             FROM public."SalesRepository"
            WHERE ${basis.column} IS NOT NULL
              AND ${basis.column} < date_trunc('month', now())${f.clause}
            GROUP BY 1 ORDER BY 1`,
          f.params
        )
      ).map((r) => ({ bulan: r.bulan, nett: Number(r.nett) }))
      const harapan = harapanTren(riwayat, hariIni.slice(0, 7))
      const selisihTren =
        harapan === null || harapan <= 0
          ? null
          : Math.round(((p.proyeksiNett - harapan) / harapan) * 1000) / 10

      return JSON.stringify({
        bulanBerjalan: hariIni.slice(0, 7),
        sampaiTanggal: hariIni,
        hariKe,
        hariDalamBulan,
        basis: basis.key,
        catatanBasis: basis.note,
        cakupan: scope,
        catatanPengakuan: RECOGNIZED_NOTE,
        nettSejauhIni: nett,
        jumlahOrderSejauhIni: Number(kini?.order ?? 0),
        porsiBulanTerlewatiPersen: Math.round(p.porsiTerlewati * 1000) / 10,
        proyeksiNettTutupBulan: Math.round(p.proyeksiNett),
        dasarProyeksi: p.dasar,
        harapanMenurutTren: harapan === null ? null : Math.round(harapan),
        selisihTerhadapTrenPersen: selisihTren,
        mataUang: 'IDR',
        catatanHasil:
          p.dasar === 'kurva historis'
            ? 'Proyeksi memakai pola penumpukan 6 bulan terakhir (porsi nett yang biasanya sudah ' +
              `terkumpul sampai tanggal ${hariKe}), bukan pembagian rata per hari — penjualan tidak ` +
              'menumpuk merata sepanjang bulan. Ini PERKIRAAN; angka pastinya baru ada saat bulan ' +
              'ditutup. Sebutkan bahwa ini proyeksi, jangan sajikan sebagai realisasi. ' +
              (selisihTren === null
                ? ''
                : `"selisihTerhadapTrenPersen" menjawab "bulan ini bagus atau jelek": ${selisihTren}% ` +
                  'dibanding yang diharapkan tren 12 bulan terakhir. Sebutkan angka itu, tapi JANGAN ' +
                  'menebak sebabnya — data ini tidak memuat sebab.')
            : 'Pola historis belum cukup untuk tanggal ini, jadi proyeksi memakai pembagian rata per ' +
              'hari — lebih kasar. Katakan itu apa adanya.'
      })
    }
  },
  {
    name: 'sales_forecast',
    label: 'Ramalan Penjualan',
    description:
      'Meramalkan penjualan 1-3 BULAN KE DEPAN dari tren riwayat bulanan, lengkap dengan rentang ' +
      'ketidakpastian dan akurasi historis metodenya. Dengan dimensi "item", ia menjawab ' +
      '"pemeriksaan mana yang sedang naik/turun" beserta laju dan penyimpangan bulan terakhir ' +
      'dari trennya sendiri (deteksi anomali). Untuk bulan BERJALAN pakai sales_projection.',
    parameters: {
      type: 'object',
      properties: {
        horizon: {
          type: 'number',
          description: 'Berapa bulan ke depan (1-3, default 1). Lebih dari 3 ditolak.'
        },
        dimensi: {
          type: 'string',
          enum: ['total', 'item'],
          description:
            'total = ramalan nett perusahaan. item = arah & laju tiap pemeriksaan (untuk ' +
            '"pemeriksaan apa yang akan naik").'
        },
        topK: { type: 'number', description: 'Jumlah item yang dilihat saat dimensi=item (default 10, maks 25)' },
        basis: { type: 'string', enum: ['order', 'invoice'], description: BASIS_DESC },
        scope: { type: 'string', enum: [...ERP_SCOPES], description: SCOPE_DESC },
        source: commonProps.source,
        branch: commonProps.branch,
        province: commonProps.province,
        city: commonProps.city
      }
    },
    tier: 'read',
    timeoutMs: 90_000,
    summarize: (a) =>
      `Ramalan penjualan ${a.horizon ?? 1} bulan ke depan${a.dimensi === 'item' ? ' (per item)' : ''}`,
    execute: async (args) => {
      guard()
      const basis = basisOf(args)
      const scope = scopeOf(args)
      const f = filters(args, 1, basis.key)
      const horizon = Math.min(Math.max(Number(args.horizon) || 1, 1), MAKS_HORIZON)
      const dimensi = args.dimensi === 'item' ? 'item' : 'total'

      // ⚠️ Bulan BERJALAN sengaja dikeluarkan dari riwayat (`< date_trunc('month', now())`).
      // Bulan yang baru jalan 20 hari akan terbaca sebagai penurunan tajam, dan
      // tren yang dilatih di atasnya meramalkan kejatuhan yang tidak ada.
      // Batas atas `<= now()` juga menahan baris bertanggal MASA DEPAN — ada
      // transaksi bertanggal 21 Agu 2026 di data (lihat HANDOFF §13).
      if (dimensi === 'total') {
        const rows = await salesQuery<{ bulan: string; nett: string }>(
          `SELECT to_char(date_trunc('month', ${basis.column}), 'YYYY-MM') AS bulan,
                  sum(nett_sales) AS nett
             FROM public."SalesRepository"
            WHERE ${basis.column} IS NOT NULL
              AND ${basis.column} < date_trunc('month', now())${f.clause}
            GROUP BY 1 ORDER BY 1`,
          f.params
        )
        const riwayat = rows.map((r) => ({ bulan: r.bulan, nett: Number(r.nett) }))
        if (riwayat.length < MIN_RIWAYAT) {
          throw new ToolError(
            `riwayat baru ${riwayat.length} bulan penuh — minimal ${MIN_RIWAYAT} bulan untuk meramal. ` +
              'Katakan apa adadanya ke user, jangan menaksir sendiri.'
          )
        }
        const nilai = riwayat.map((r) => r.nett)
        const mape = mapeBacktest(nilai)
        // ⚠️ Ramalan dimulai dari bulan SESUDAH bulan berjalan. Riwayat berakhir
        // di bulan penuh terakhir, jadi tanpa ini langkah-1 jatuh ke bulan yang
        // SEDANG berjalan — dan menabrak `sales_projection` yang membaca
        // transaksi bulan itu yang sudah benar-benar terjadi. Terukur 20 Agu
        // 2026: ramalan Rp 10,13 M vs proyeksi Rp 8,17 M untuk bulan yang sama.
        const bulanDepan = bulanBerikut(jakartaToday().slice(0, 7), 1)
        const hasil = ramal(riwayat, horizon, mape, bulanDepan)

        return JSON.stringify({
          basis: basis.key,
          catatanBasis: basis.note,
          cakupan: scope,
          catatanPengakuan: RECOGNIZED_NOTE,
          riwayatBulan: riwayat.length,
          bulanTerakhirLengkap: riwayat[riwayat.length - 1].bulan,
          nettBulanTerakhir: riwayat[riwayat.length - 1].nett,
          akurasiHistorisPersen: mape === null ? null : Math.round(mape * 10) / 10,
          ramalan: hasil.map((r) => ({
            bulan: r.bulan,
            nett: Math.round(r.nett),
            rentangBawah: r.bawah === null ? null : Math.round(r.bawah),
            rentangAtas: r.atas === null ? null : Math.round(r.atas)
          })),
          mataUang: 'IDR',
          catatanHasil:
            catatanRamalan(mape, riwayat.length) +
            ` Ramalan ini mulai dari ${bulanDepan} — bulan yang SEDANG berjalan sengaja tidak ` +
            'diramal di sini karena transaksinya sudah sebagian terjadi; untuk itu pakai ' +
            'sales_projection yang membaca angka nyatanya.'
        })
      }

      // --- per item ---
      const topK = Math.min(Math.max(Number(args.topK) || 10, 1), 25)
      const rows = await salesQuery<{ item_code: string; nama: string; bulan: string; nett: string }>(
        `WITH besar AS (
           SELECT item_code
             FROM public."SalesRepository"
            WHERE ${basis.column} >= date_trunc('month', now()) - interval '12 months'
              AND ${basis.column} < date_trunc('month', now())${f.clause}
            GROUP BY item_code
            ORDER BY sum(nett_sales) DESC
            LIMIT $${f.params.length + 1}
         )
         SELECT s.item_code,
                to_char(date_trunc('month', s.${basis.column}), 'YYYY-MM') AS bulan,
                sum(s.nett_sales) AS nett,
                (SELECT m.item_name FROM m_item_repository m
                  WHERE m.item_code_erp = s.item_code LIMIT 1) AS nama
           FROM public."SalesRepository" s
          WHERE s.item_code IN (SELECT item_code FROM besar)
            AND s.${basis.column} IS NOT NULL
            AND s.${basis.column} < date_trunc('month', now())${f.clause}
          GROUP BY s.item_code, 2
          ORDER BY s.item_code, 2`,
        [...f.params, topK]
      )

      const perItem = new Map<string, { nama: string; seri: Map<string, number> }>()
      for (const r of rows) {
        if (!perItem.has(r.item_code)) {
          perItem.set(r.item_code, { nama: r.nama ?? '(nama tidak ada di master)', seri: new Map() })
        }
        perItem.get(r.item_code)!.seri.set(r.bulan, Number(r.nett))
      }
      const semuaBulan = [...new Set(rows.map((r) => r.bulan))].sort().slice(-JENDELA)

      const daftar = [...perItem.entries()]
        .map(([kode, v]) => {
          // Bulan tanpa transaksi diisi 0, bukan dilewati — item yang berhenti
          // dijual harus terbaca TURUN, bukan datar karena barisnya hilang.
          const nilai = semuaBulan.map((b) => v.seri.get(b) ?? 0)
          const m = momentum(nilai)
          return {
            item: v.nama,
            kode,
            nettBulanTerakhir: Math.round(nilai[nilai.length - 1] ?? 0),
            arah: m.arah,
            lajuPerBulan: Math.round(m.lajuPerBulan),
            lajuPersenPerBulan: m.lajuPersen === null ? null : Math.round(m.lajuPersen * 10) / 10,
            penyimpanganBulanTerakhirPersen:
              m.penyimpangan === null ? null : Math.round(m.penyimpangan * 10) / 10
          }
        })
        .sort((a, b) => b.lajuPerBulan - a.lajuPerBulan)

      return JSON.stringify({
        basis: basis.key,
        catatanBasis: basis.note,
        cakupan: scope,
        catatanPengakuan: RECOGNIZED_NOTE,
        jendelaBulan: semuaBulan.length,
        rentangBulan: `${semuaBulan[0]} s/d ${semuaBulan[semuaBulan.length - 1]}`,
        item: daftar,
        mataUang: 'IDR',
        catatanHasil:
          `Arah & laju dihitung dari tren ${semuaBulan.length} bulan terakhir tiap item (regresi ` +
          'linier). "lajuPersenPerBulan" = perubahan rata-rata per bulan terhadap rata-ratanya; ' +
          'di bawah 2% dianggap datar. "penyimpanganBulanTerakhirPersen" = seberapa jauh bulan ' +
          'terakhir meleset dari tren item itu sendiri — nilai besar berarti bulan itu ANEH, dan ' +
          'itu peringatan dini, bukan ramalan. ⚠️ Ini EKSTRAPOLASI tren, bukan ramalan bermusim: ' +
          'pola musiman terbukti TIDAK berulang pada data ini (korelasi antar tahun -0,17 pada item ' +
          'terbesar), jadi JANGAN menjelaskan kenaikan/penurunan dengan musim, wabah, atau cuaca. ' +
          'Kalau user bertanya sebabnya, katakan bahwa data ini tidak memuat sebabnya.'
      })
    }
  },
  {
    name: 'sales_full_year',
    label: 'Best Estimate Setahun',
    description:
      'Best Estimate (BE) penjualan SATU TAHUN PENUH: aktual Januari s/d bulan lalu + proyeksi bulan ' +
      'berjalan + ramalan sisa bulan, DIJUMLAH tool lengkap dengan rentang, akurasi historis, dan ' +
      'pertumbuhan vs tahun lalu penuh. Pakai untuk "forecast/BE full year", "tahun ini tutup di ' +
      'berapa", "perkiraan setahun penuh". BE = perkiraan dari data, BUKAN target/budget. Bila sisa ' +
      'tahun lebih dari 3 bulan, BE tidak dihitung (di luar batas ramalan) dan tool menyebut alasannya.',
    parameters: {
      type: 'object',
      properties: {
        tahun: { type: 'number', description: 'Tahun yang ditanyakan. Bawaan tahun berjalan.' },
        basis: { type: 'string', enum: ['order', 'invoice'], description: BASIS_DESC },
        scope: { type: 'string', enum: [...ERP_SCOPES], description: SCOPE_DESC },
        source: commonProps.source,
        branch: commonProps.branch,
        province: commonProps.province,
        city: commonProps.city
      }
    },
    tier: 'read',
    timeoutMs: 120_000,
    summarize: (a) => `Best Estimate setahun ${a.tahun ?? ''}`.trim(),
    execute: async (args, ctx) => {
      guard()
      const basis = basisOf(args)
      const scope = scopeOf(args)
      const f = filters(args, 1, basis.key)
      const hariIni = jakartaToday()
      const tahun = Number.isInteger(Number(args.tahun)) && Number(args.tahun) > 2000 ? Number(args.tahun) : Number(hariIni.slice(0, 4))

      // Riwayat bulanan PENUH — query yang sama dengan sales_forecast (bulan berjalan dikeluarkan).
      const rows = await salesQuery<{ bulan: string; nett: string }>(
        `SELECT to_char(date_trunc('month', ${basis.column}), 'YYYY-MM') AS bulan,
                sum(nett_sales) AS nett
           FROM public."SalesRepository"
          WHERE ${basis.column} IS NOT NULL
            AND ${basis.column} < date_trunc('month', now())${f.clause}
          GROUP BY 1 ORDER BY 1`,
        f.params
      )
      const riwayat = rows.map((r) => ({ bulan: r.bulan, nett: Number(r.nett) }))
      const mape = riwayat.length >= MIN_RIWAYAT + 2 ? mapeBacktest(riwayat.map((r) => r.nett)) : null

      // Proyeksi bulan berjalan lewat tool yang SAMA (kurva penumpukan) — satu angka untuk satu bulan.
      let proyeksi: number | null = null
      let dasarProyeksi: string | null = null
      if (tahun === Number(hariIni.slice(0, 4))) {
        const pr = JSON.parse(
          await (salesTools.find((t) => t.name === 'sales_projection') as ToolDefinition).execute(
            { basis: args.basis, scope: args.scope, source: args.source, branch: args.branch, province: args.province, city: args.city },
            ctx
          )
        ) as Record<string, unknown>
        proyeksi = typeof pr.proyeksiNettTutupBulan === 'number' ? pr.proyeksiNettTutupBulan : null
        dasarProyeksi = typeof pr.dasarProyeksi === 'string' ? pr.dasarProyeksi : null
      }

      let h
      try {
        h = susunBE({ tahun, hariIni, riwayat, proyeksiBulanIni: proyeksi, dasarProyeksi, mape })
      } catch (err) {
        if (err instanceof BEError) throw new ToolError(err.message)
        throw err
      }
      const r = (v: number | null): number | null => (v === null ? null : Math.round(v))
      return JSON.stringify({
        tahun,
        jenis: h.jenis,
        basis: basis.key,
        catatanBasis: basis.note,
        cakupan: scope,
        catatanPengakuan: RECOGNIZED_NOTE,
        sampaiTanggal: hariIni,
        bestEstimate: r(h.be),
        rentangBawah: r(h.bawah),
        rentangAtas: r(h.atas),
        totalAktual: r(h.totalAktual),
        aktualPerBulan: h.aktual.map((t) => ({ bulan: t.bulan, nett: Math.round(t.nett) })),
        bulanKosong: h.bulanKosong,
        proyeksiBulanBerjalan: h.proyeksi ? { bulan: h.proyeksi.bulan, nett: Math.round(h.proyeksi.nett), dasar: h.proyeksi.dasar } : null,
        ramalanSisaBulan: h.ramalan.map((x) => ({ bulan: x.bulan, nett: Math.round(x.nett), rentangBawah: r(x.bawah), rentangAtas: r(x.atas) })),
        // Jumlah ramalan sudah dihitung di sini — terbukti dari aplikasi 30 Sep: tanpa kolom ini
        // model menjumlah sendiri "Ramalan Okt–Des" untuk tabel jawabannya.
        totalRamalanSisaBulan: h.ramalan.length ? Math.round(h.ramalan.reduce((t, x) => t + x.nett, 0)) : null,
        bulanTakDiramal: h.takDiramal,
        fullYearTahunLalu: r(h.fullYearLalu),
        pertumbuhanVsTahunLaluPersen: h.pertumbuhanPersen,
        akurasiHistorisPersen: h.akurasiHistorisPersen,
        mataUang: 'IDR',
        catatanHasil: catatanBE(h)
      })
    }
  },
  {
    // Status SATU transaksi per Order ID (2 Okt 2026) — satu-satunya tool sales yang
    // menjawab per order. Batas & alasannya di `sales/order-status.ts`: daftar-izin kolom, tanpa
    // data pasien/harga/pelanggan, wajib satu ID eksplisit.
    name: 'sales_order_status',
    label: 'Cek Order ID',
    description:
      'Cek status SATU transaksi berdasarkan Order ID: sudah masuk SalesRepository atau belum, diakui ' +
      'atau dibatalkan, hasil/invoice sudah keluar atau belum, dan sudah ter-bridging ke ERP ' +
      'atau belum. Pakai untuk "Order ID X sudah masuk?", "sudah invoice?", "sudah masuk ERP?". ' +
      'Tidak memberi data pasien, jenis pemeriksaan, harga, nett, maupun pelanggan.',
    parameters: {
      type: 'object',
      properties: {
        order_id: {
          type: 'string',
          description:
            'Order ID yang ditanyakan user. WAJIB disalin dari kalimat user — jangan pernah mengarang atau menebak.'
        }
      },
      required: ['order_id']
    },
    tier: 'read',
    timeoutMs: 60_000,
    summarize: (a) => `Cek Order ID ${a.order_id ?? ''}`.trim(),
    execute: async (args) => {
      guard()
      const id = normalkanOrderId(args.order_id)
      if (!id) {
        throw new ToolError(
          'order_id tidak sah. Salin Order ID persis dari kalimat user (huruf/angka, boleh titik), ' +
            'contoh bentuk: angka 10 digit atau berawalan huruf. Satu ID per panggilan, tanpa tanda bintang/persen. ' +
            'Kalau user belum menyebut Order ID, tanyakan dulu.'
        )
      }
      // Berurutan, bukan Promise.all — pool sales `max: 1` (aturan koneksi serentak).
      const ringkas = await salesQuery<RingkasOrderId>(SQL_STATUS_ORDER, [kandidatOrderId(id)])
      const terbaru = await salesQuery<{ terbaru: string | null }>(SQL_DATA_TERBARU, [])
      return JSON.stringify(susunStatusOrderId(id, ringkas, terbaru[0]?.terbaru ?? null))
    }
  }
]
