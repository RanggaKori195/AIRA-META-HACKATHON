import { authQuery } from '../auth/db'
import { logger } from '../logger'
import * as localDb from '../db'
import { MAKS_MEMORI, MAKS_PANJANG, memuatNilaiData } from './rules'
import {
  JEDA_PESAN,
  MAKS_OTOMATIS,
  parseUsulan,
  pesanUntukEkstraksi,
  promptEkstraksi,
  saringUsulan
} from './ekstrak'
import type { LLMProvider } from '../llm/provider'
import type { MemoriRow } from '../../shared/ipc'

// Penyimpanan memori AIRA.
//
// Di POSTGRES, bukan SQLite lokal — berbeda dari riwayat chat, dan itu disengaja.
// Memori adalah tentang ORANGNYA, dan orangnya login dari laptop mana pun. Kalau
// disimpan lokal, AIRA "mengenali" seseorang di satu laptop dan melupakannya di
// laptop sebelah — perilaku yang justru merusak kepercayaan pada fiturnya.
// Riwayat chat tetap lokal karena isinya besar dan memang terikat mesin.
//
// Memakai pool auth yang sudah ada, dengan alasan yang sama seperti feedback:
// `max_connections` server hanya 100 untuk SEMUA aplikasi.

/**
 * Cache memori user yang sedang login.
 *
 * ⚠️ Ini bukan optimasi kosmetik. Tanpa cache, setiap giliran chat menambah satu
 * query ke Postgres — dan query itu masuk antrean pool auth yang juga melayani
 * revalidasi sesi tiap 5 menit dan panel Super Admin. Menambah lalu lintas ke
 * lapisan koneksi yang sudah terbukti rapuh di dalam Electron, demi data yang
 * hampir tidak pernah berubah, adalah pertukaran yang salah.
 *
 * Diisi saat login/pemulihan sesi, dan disegarkan setiap kali memori ditulis
 * atau dihapus — jadi tidak pernah basi terhadap perbuatan user sendiri.
 */
let cache: { username: string; daftar: string[] } | null = null

/** Dibaca sinkron oleh orchestrator saat menyusun system prompt. */
export function memoriTersimpan(username: string): string[] {
  if (!cache || cache.username !== username.toLowerCase()) return []
  return cache.daftar
}

export async function muatMemori(username: string): Promise<string[]> {
  try {
    const rows = await authQuery<{ isi: string }>(
      `SELECT isi FROM tb_memori_aira
        WHERE lower(username) = lower($1)
        ORDER BY created_at
        LIMIT $2`,
      [username, MAKS_MEMORI]
    )
    const daftar = rows.map((r) => r.isi)
    cache = { username: username.toLowerCase(), daftar }
    return daftar
  } catch (err) {
    // Database tidak terjangkau: AIRA tetap jalan TANPA memori, bukan gagal.
    // Kehilangan penyesuaian jawaban jauh lebih ringan daripada chat yang tidak
    // bisa dipakai sama sekali karena jaringan sedang putus.
    logger().warn({ err: String(err) }, 'memori tidak bisa dimuat — AIRA jalan tanpa memori')
    cache = { username: username.toLowerCase(), daftar: [] }
    return []
  }
}

export function lupakanCache(): void {
  cache = null
}

export interface HasilSimpan {
  ok: boolean
  pesan: string
}

/**
 * Menyimpan satu memori.
 *
 * Duplikat ditolak dengan pesan yang jujur, bukan disimpan diam-diam jadi baris
 * kedua: memori yang sama tercatat dua kali akan dikirim dua kali ke model tiap
 * giliran, dan user tidak punya cara melihat kenapa daftarnya menggemuk.
 */
export async function simpanMemori(username: string, isi: string): Promise<HasilSimpan> {
  const bersih = isi.trim().slice(0, MAKS_PANJANG)
  if (bersih.length === 0) return { ok: false, pesan: 'Belum jelas apa yang harus diingat.' }

  const sekarang = await muatMemori(username)
  if (sekarang.some((m) => m.toLowerCase() === bersih.toLowerCase())) {
    return { ok: true, pesan: 'Itu sudah kuingat sebelumnya.' }
  }
  if (sekarang.length >= MAKS_MEMORI) {
    // Sengaja TIDAK membuang yang terlama secara diam-diam. Memori yang hilang
    // tanpa diketahui membuat AIRA "lupa" hal yang user yakin sudah disuruh
    // ingat, dan tidak ada satu pun cara baginya untuk mengetahui sebabnya.
    return {
      ok: false,
      pesan:
        `Memori sudah penuh (${MAKS_MEMORI} catatan). Hapus dulu yang tidak terpakai lewat ` +
        'Settings → Yang diingat AIRA, baru simpan yang baru.'
    }
  }

  await authQuery('INSERT INTO tb_memori_aira (username, isi) VALUES (lower($1), $2)', [
    username,
    bersih
  ])
  await muatMemori(username)
  // Isi memori TIDAK masuk audit lokal — hanya panjangnya. Audit ada di laptop
  // dan tidak berguna menyimpan salinan kedua dari kalimat yang sudah tersimpan
  // di server.
  localDb.audit('memori', 'simpan', `user=${username} panjang=${bersih.length}`)
  logger().info({ user: username }, 'memori baru disimpan')
  return { ok: true, pesan: 'Oke, kuingat.' }
}

export async function daftarMemori(username: string): Promise<MemoriRow[]> {
  const rows = await authQuery<any>(
    `SELECT id, isi, sumber, created_at FROM tb_memori_aira
      WHERE lower(username) = lower($1)
      ORDER BY created_at`,
    [username]
  )
  return rows.map((r) => ({
    id: Number(r.id),
    isi: r.isi,
    sumber: r.sumber === 'otomatis' ? 'otomatis' : 'user',
    createdAt: new Date(r.created_at).toISOString()
  }))
}

// ------------------------------------------------- Lapis 4: memori otomatis

/**
 * Menyimpan memori hasil ekstraksi otomatis.
 *
 * Bedanya dengan `simpanMemori`: kuotanya terpisah dan saat penuh yang TERLAMA
 * DIGILIR, bukan ditolak. Memori dari user tidak pernah digilir — ia memintanya
 * sendiri, dan hilang tanpa keterangan adalah kegagalan diam. Memori otomatis
 * tidak pernah dijanjikan kepada siapa pun, jadi menggilirnya jujur; yang tidak
 * boleh adalah menggilir milik user demi memberi tempat pada tebakan model.
 */
async function simpanOtomatis(username: string, isi: string): Promise<void> {
  const otomatis = await authQuery<{ id: string }>(
    `SELECT id FROM tb_memori_aira
      WHERE lower(username) = lower($1) AND sumber = 'otomatis'
      ORDER BY created_at`,
    [username]
  )
  const kelebihan = otomatis.length + 1 - MAKS_OTOMATIS
  for (let i = 0; i < kelebihan; i++) {
    if (!otomatis[i]) break
    await authQuery('DELETE FROM tb_memori_aira WHERE id = $1', [otomatis[i].id])
    localDb.audit('memori', 'gilir_otomatis', `user=${username} id=${otomatis[i].id}`)
  }
  await authQuery(
    "INSERT INTO tb_memori_aira (username, isi, sumber) VALUES (lower($1), $2, 'otomatis')",
    [username, isi]
  )
}

export interface HasilEkstraksi {
  dijalankan: boolean
  disimpan: string[]
  ditolak: number
}

/**
 * Membaca percakapan dan menyimpulkan fakta tentang orangnya.
 *
 * Dipanggil di LATAR sesudah sebuah run selesai — tidak pernah menahan jawaban
 * yang sedang ditunggu user. Gagal total pun tidak apa-apa: memori otomatis
 * adalah tambahan, bukan syarat aplikasi bekerja.
 *
 * ⚠️ Panggilan LLM tambahan. Karena itu dijeda `JEDA_PESAN` pesan user dan hanya
 * membaca `MAKS_PESAN_DIBACA` pesan terakhir. Menjalankannya tiap giliran berarti
 * melipatgandakan beban gateway yang sama yang melayani seluruh pemakai AIRA —
 * demi fakta tentang orang yang berubah beberapa kali setahun.
 */
export async function ekstrakMemori(
  username: string,
  sessionId: string,
  provider: LLMProvider,
  model: string
): Promise<HasilEkstraksi> {
  const semua = localDb.listMessages(sessionId)
  const pesanUser = pesanUntukEkstraksi(semua)
  const sudahDiproses = localDb.memoriDiproses(sessionId)
  if (pesanUser.length - sudahDiproses < JEDA_PESAN) {
    return { dijalankan: false, disimpan: [], ditolak: 0 }
  }

  const sudahAda = await muatMemori(username)
  const t0 = Date.now()
  let mentah: string
  try {
    mentah = await provider.complete(
      [{ role: 'user', content: promptEkstraksi(pesanUser, sudahAda) }],
      model,
      // Muse spends hidden reasoning tokens first: 300 returned empty (finish length, 298 reasoning), 2000 measured 920.
      2000
    )
  } catch (err) {
    // Gateway tidak terjangkau / model sibuk. Penanda TIDAK dimajukan, jadi
    // percakapan ini akan dicoba lagi nanti alih-alih terlewat diam-diam.
    logger().warn({ err: String(err) }, 'ekstraksi memori gagal — dicoba lagi lain kali')
    return { dijalankan: false, disimpan: [], ditolak: 0 }
  }

  const { diterima, ditolak } = saringUsulan(parseUsulan(mentah), sudahAda, memuatNilaiData)

  for (const isi of diterima) await simpanOtomatis(username, isi)
  if (diterima.length > 0) await muatMemori(username)

  // Penanda dimajukan meski tidak ada yang diterima — kalau tidak, percakapan
  // yang memang tidak memuat fakta apa pun akan diekstraksi berulang kali
  // selamanya, membakar panggilan LLM untuk hasil yang sudah pasti kosong.
  localDb.setMemoriDiproses(sessionId, pesanUser.length)

  // Yang DITOLAK ikut dicatat beserta alasannya. Tanpa ini, "kenapa AIRA tidak
  // mengingat apa-apa" hanya bisa dijawab dengan tebakan — dan saringan yang
  // terlalu ketat tidak akan pernah ketahuan karena kegagalannya sunyi.
  logger().info(
    {
      user: username,
      ms: Date.now() - t0,
      dibaca: pesanUser.length,
      disimpan: diterima,
      ditolak: ditolak.map((d) => `${d.alasan}: ${d.isi.slice(0, 60)}`)
    },
    'ekstraksi memori otomatis selesai'
  )
  if (diterima.length > 0) {
    localDb.audit('memori', 'ekstrak', `user=${username} jumlah=${diterima.length}`)
  }
  return { dijalankan: true, disimpan: diterima, ditolak: ditolak.length }
}

/**
 * Menghapus satu memori.
 *
 * ⚠️ `WHERE id = $1 AND lower(username) = lower($2)` — bukan `WHERE id = $1`.
 * Id datang dari renderer; tanpa syarat pemilik, siapa pun bisa menghapus memori
 * orang lain hanya dengan menebak angka.
 */
export async function hapusMemori(username: string, id: number): Promise<MemoriRow[]> {
  await authQuery('DELETE FROM tb_memori_aira WHERE id = $1 AND lower(username) = lower($2)', [
    id,
    username
  ])
  await muatMemori(username)
  localDb.audit('memori', 'hapus', `user=${username} id=${id}`)
  return daftarMemori(username)
}
