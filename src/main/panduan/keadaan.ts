import type { PanduanBagian } from '../../shared/ipc'
import { sesiSekarang } from '../auth/service'
import { M365_LANJUTAN } from '../m365/rules'
import { suaraTersedia } from '../suara/transkrip'
import { susunPanduan, type KeadaanPanduan } from './isi'

// Menjembatani panduan yang MURNI (`isi.ts`) dengan keadaan aplikasi yang nyata.
//
// ⚠️ `izinMenu` diambil dari SESI main process, tidak pernah dari argumen model
// maupun dari renderer — pola yang sama dengan `search_history` dan tool sales.
// Kalau izin boleh datang dari luar, satu halusinasi model cukup untuk membuat
// AIRA mengajari seorang staf cara memakai menu yang tidak boleh ia buka, lengkap
// dengan contoh pertanyaannya.

export function keadaanSekarang(): KeadaanPanduan {
  const sesi = sesiSekarang()
  return {
    izinMenu: sesi?.menu ?? [],
    m365Lanjutan: M365_LANJUTAN,
    // Dipanggil, bukan di-cache: model suara bisa saja baru dipasang tanpa
    // aplikasi direstart, dan panduan yang bilang "tidak aktif" untuk tombol
    // yang sudah muncul di layar lebih membingungkan daripada tidak ada panduan.
    suaraTersedia: suaraTersedia()
  }
}

export function panduanSekarang(): PanduanBagian[] {
  return susunPanduan(keadaanSekarang())
}
