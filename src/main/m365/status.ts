import type { StatusDrive } from '../../shared/ipc'
import { m365Configured, m365Identitas, m365SudahLogin, m365Token } from './auth'
import { daftarFolder } from './drive'
import { M365_LANJUTAN } from './rules'
import { logger } from '../logger'

// Keadaan sambungan untuk layar awal "Tanya Microsoft 365".
//
// ⚠️ TIDAK PERNAH membuka login di browser. Layar ini dibuka orang hanya untuk
// melihat-lihat; tab login Microsoft yang muncul sendiri tanpa diminta akan
// dikira jebakan phishing. Login tetap terjadi seperti biasa saat pertanyaan
// pertama benar-benar butuh OneDrive.

/** Jumlah folder utama yang ditawarkan di dropdown. */
const MAKS_FOLDER = 100

export async function statusDrive(): Promise<StatusDrive> {
  const dasar: StatusDrive = {
    terkonfigurasi: m365Configured(),
    keadaan: 'belum-login',
    akun: null,
    folder: [],
    folderAdaLagi: false,
    lanjutan: M365_LANJUTAN,
    galat: null,
    waktu: Date.now()
  }
  if (!dasar.terkonfigurasi || !m365SudahLogin()) return dasar

  try {
    // Hanya dari refresh token. Token hasilnya ter-cache di auth.ts, jadi dua
    // panggilan di bawah memakai token yang sama tanpa jalur login.
    await m365Token(false)
  } catch (err) {
    const pesan = String(err instanceof Error ? err.message : err)
    if (pesan.includes('BELUM_LOGIN_M365')) return dasar
    return { ...dasar, keadaan: 'gagal', galat: pesan.slice(0, 200) }
  }

  try {
    const id = await m365Identitas()
    const isi = await daftarFolder('', MAKS_FOLDER)
    return {
      ...dasar,
      keadaan: 'terhubung',
      akun: id.email || null,
      folder: isi.berkas.filter((b) => b.folder).map((b) => b.nama),
      folderAdaLagi: isi.adaLagi
    }
  } catch (err) {
    const pesan = String(err instanceof Error ? err.message : err)
    logger().warn({ err: pesan.slice(0, 200) }, 'status OneDrive gagal dibaca')
    return { ...dasar, keadaan: 'gagal', galat: pesan.slice(0, 200) }
  }
}
