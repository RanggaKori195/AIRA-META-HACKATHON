// Pemeriksaan `sales_order_status` ke SalesRepository SUNGGUHAN (bukan unit test — butuh
// jaringan internal the company). Jalankan: npx tsx tests/order-status-live-check.ts
//
// ⚠️ Memakai SQL ASLI dari `sales/order-status.ts` (bukan salinan — pelajaran aturan 64), dan
// Order ID contoh DICARI dari data tiap kali jalan, tidak dipatok di berkas ini.
// Tidak ada data pasien yang keluar dari database: pemeriksaan "nama pasien/pelanggan
// tidak bocor" dilakukan DI SERVER (position(... in $hasil)), hasilnya cuma true/false.
import { readFileSync } from 'fs'
import { Pool } from 'pg'
import {
  SQL_DATA_TERBARU,
  SQL_STATUS_ORDER,
  kandidatOrderId,
  normalkanOrderId,
  susunStatusOrderId,
  type RingkasOrderId
} from '../src/main/sales/order-status'

function envVar(nama: string): string | null {
  const baris = readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${nama}=`))
  return baris ? baris.slice(nama.length + 1).trim() : null
}
const cs = envVar('AIRA_SALES_DB')
if (!cs) {
  console.error('AIRA_SALES_DB tidak ada di .env')
  process.exit(1)
}

let gagal = 0
function cek(nama: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'OK   ' : 'GAGAL'} ${nama}${detail ? ' — ' + detail : ''}`)
  if (!ok) gagal++
}

const DIAKUI = '(transfer_test_deleted_at IS NULL AND transaction_transfer_deleted_at IS NULL)'

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: cs, max: 1, connectionTimeoutMillis: 15_000 })
  const q = async <T = any>(sql: string, p: unknown[] = []): Promise<T[]> => (await pool.query(sql, p)).rows as T[]

  const jalankan = async (raw: string) => {
    const id = normalkanOrderId(raw)
    if (!id) throw new Error('ID tidak sah: ' + raw)
    const t0 = Date.now()
    const ringkas = await q<RingkasOrderId>(SQL_STATUS_ORDER, [kandidatOrderId(id)])
    const ms = Date.now() - t0
    const terbaru = (await q<{ terbaru: string }>(SQL_DATA_TERBARU))[0]?.terbaru ?? null
    return { hasil: susunStatusOrderId(id, ringkas, terbaru) as Record<string, any>, ms }
  }

  const contoh = async (where: string): Promise<string | null> =>
    (await q<{ order_id: string }>(
      `SELECT order_id FROM public."SalesRepository" GROUP BY order_id HAVING ${where}
        ORDER BY max(date_received) DESC NULLS LAST LIMIT 1`
    ))[0]?.order_id ?? null

  // Hitungan pembanding dari query TERPISAH (bukan SQL tool).
  const pembanding = async (id: string) =>
    (await q<{ diakui: number; batal: number; hasil: number }>(
      `SELECT count(*) FILTER (WHERE ${DIAKUI})::int AS diakui,
              count(*) FILTER (WHERE NOT ${DIAKUI})::int AS batal,
              count(*) FILTER (WHERE ${DIAKUI} AND date_result IS NOT NULL)::int AS hasil
         FROM public."SalesRepository" WHERE order_id = $1`,
      [id]
    ))[0]

  // Kebocoran diperiksa DI SERVER — nama pasien/pelanggan tidak pernah keluar ke skrip ini.
  const bocor = async (id: string, keluaran: string) =>
    (await q<{ pasien: boolean; pelanggan: boolean }>(
      `SELECT bool_or(length(patient_name) > 3 AND position(lower(patient_name) in lower($2)) > 0) AS pasien,
              bool_or(length(customer_name) > 3 AND position(lower(customer_name) in lower($2)) > 0) AS pelanggan
         FROM public."SalesRepository" WHERE order_id = $1`,
      [id, keluaran]
    ))[0]

  const kasus: Array<[string, string, (h: Record<string, any>) => boolean]> = [
    ['semua hasil keluar', `bool_and(${DIAKUI}) AND bool_and(date_result IS NOT NULL)`, (h) => /SUDAH diakui sebagai sales/.test(h.ringkasan)],
    ['belum ada hasil', `bool_and(${DIAKUI}) AND bool_and(date_result IS NULL)`, (h) => /BELUM keluar/.test(h.ringkasan)],
    ['sebagian hasil', `bool_and(${DIAKUI}) AND bool_or(date_result IS NULL) AND bool_or(date_result IS NOT NULL)`, (h) => /baru keluar untuk/.test(h.ringkasan)],
    ['semua dibatalkan', `bool_and(NOT ${DIAKUI})`, (h) => /DIBATALKAN/.test(h.ringkasan)],
    ['bridging gagal', `bool_or(${DIAKUI} AND bridging_status_to = 'FAILED')`, (h) => /GAGAL di-bridging/.test(h.hasil?.[0]?.orderDiERP ?? '') && /Perhatian: .*GAGAL/.test(h.ringkasan)]
  ]

  for (const [label, where, sesuai] of kasus) {
    const id = await contoh(where)
    if (!id) {
      console.log(`info  ${label}: tidak ada contoh di data saat ini — dilewati (bukan lolos)`)
      continue
    }
    const { hasil, ms } = await jalankan(id)
    const p = await pembanding(id)
    const h = hasil.hasil?.[0] ?? {}
    cek(`${label}: ditemukan`, hasil.ditemukan === true, `${ms} ms`)
    cek(`${label}: kalimat status sesuai keadaan`, sesuai(hasil), String(hasil.ringkasan))
    cek(
      `${label}: hitungan identik dengan query terpisah`,
      h.jumlahPemeriksaan === p.diakui && h.pemeriksaanDibatalkan === p.batal &&
        (p.diakui === 0 || h.hasilInvoice === `${p.hasil} dari ${p.diakui} pemeriksaan`),
      `diakui ${h.jumlahPemeriksaan}/${p.diakui}, batal ${h.pemeriksaanDibatalkan}/${p.batal}, hasil ${h.hasilInvoice} vs ${p.hasil}`
    )
    const b = await bocor(id, JSON.stringify(hasil))
    cek(`${label}: nama pasien & pelanggan TIDAK ada di keluaran`, !b.pasien && !b.pelanggan)
    cek(`${label}: cepat (< 2 dtk)`, ms < 2000, `${ms} ms`)
  }

  // Variasi penulisan.
  const huruf = await contoh(`order_id ~ '^[A-Z]' AND bool_and(${DIAKUI})`)
  if (huruf) {
    const { hasil } = await jalankan(huruf.toLowerCase())
    cek('ID berhuruf diketik huruf kecil tetap ketemu', hasil.ditemukan === true && hasil.hasil?.[0]?.order_id === huruf)
  }
  const bertitik = await contoh(`order_id ~ '\\.$' AND bool_and(${DIAKUI})`)
  if (bertitik) {
    const { hasil } = await jalankan(bertitik.replace(/\.+$/, ''))
    cek('ID bertitik tanpa titik terakhir tetap ketemu', hasil.ditemukan === true && /dicocokkanSebagai/.test(JSON.stringify(hasil)))
  }

  // Tidak ada.
  const { hasil: kosong } = await jalankan('ZZTIDAKADA0000')
  cek('ID yang tidak ada → ditemukan:false + sebab mungkin', kosong.ditemukan === false && Array.isArray(kosong.sebabMungkin))
  cek('catatan kesegaran menyebut tanggal order terbaru', /\d{4}-\d{2}-\d{2}/.test(String(kosong.catatanKesegaran)), String(kosong.catatanKesegaran))

  await pool.end()
  console.log(gagal === 0 ? '\nSEMUA LOLOS' : `\n${gagal} PEMERIKSAAN GAGAL`)
  process.exit(gagal === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('GAGAL:', err)
  process.exit(1)
})
