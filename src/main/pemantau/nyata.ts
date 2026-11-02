// Sambungan NYATA pemantau proaktif: `service.ts` (murni, dependensi disuntik) diberi
// `salesQuery`, sesi login, SQLite lokal, config, notifikasi Windows, dan log.
// Penjadwal Jadwal & handler IPC memanggil fungsi di berkas ini.

import { app } from 'electron'
import { IPC_CHANNELS, PEMICU_PEMANTAU, type KeadaanPemantau, type PemicuId } from '../../shared/ipc'
import * as auth from '../auth/service'
import { audit, rawDb } from '../db'
import { loadConfig, saveConfig } from '../config'
import { logger } from '../logger'
import { mainWindow, notify, tutupNotifikasi } from '../notify'
import { salesQuery } from '../sales/db'
import { jakartaToday } from '../sales/periods'
import { jedaAcakMs } from './rules'
import * as inti from './service'
import { buatPenyimpanan, type SaklarConfig } from './simpan'

/** Saklar per user di config. Id pemicu yang tidak dikenal (build lama/baru) disaring. */
export function saklarDariConfig(): SaklarConfig {
  return {
    baca(username) {
      try {
        const daftar = loadConfig().pemantauMati[username] ?? []
        return daftar.filter((x): x is PemicuId => (PEMICU_PEMANTAU as readonly string[]).includes(x))
      } catch {
        // Config tak terbaca: anggap semua menyala — lebih baik berbunyi daripada diam.
        return []
      }
    },
    tulis(username, mati) {
      const config = loadConfig()
      config.pemantauMati = { ...config.pemantauMati, [username]: mati }
      saveConfig(config)
    }
  }
}

type ModeUji = { sales: boolean; lab: boolean }

/**
 * Mode uji DEV (`AIRA_PEMANTAU_UJI=sales,lab`, pola `AIRA_UPDATE_DEV`): memaksa sales
 * "anjlok" & mengabaikan penahanan data TAT basi, supaya alur toast → klik → kotak
 * terisi bisa dibuktikan dari aplikasi saat datanya sedang normal. Judulnya berawalan
 * "[UJI]". ⚠️ Aplikasi terpasang TIDAK PERNAH membacanya.
 */
function modeUji(): ModeUji {
  if (app.isPackaged) return { sales: false, lab: false }
  const nilai = (process.env.AIRA_PEMANTAU_UJI ?? '').toLowerCase().split(',').map((s) => s.trim())
  return { sales: nilai.includes('sales'), lab: nilai.includes('lab') }
}

let dependensi: inti.Dependensi | null = null

function deps(): inti.Dependensi {
  if (dependensi) return dependensi
  const uji = modeUji()
  if (uji.sales || uji.lab) logger().warn({ uji }, 'pemantau: MODE UJI aktif (dev)')
  const kirim = (kanal: string, data?: unknown): void => {
    const wc = mainWindow()?.webContents
    if (wc && !wc.isDestroyed()) wc.send(kanal, data)
  }
  dependensi = {
    query: <T>(sql: string, params: unknown[]) => salesQuery<T>(sql, params),
    simpan: buatPenyimpanan(rawDb(), saklarDariConfig()),
    sesi: () => auth.sesiSekarang(),
    notify: (o) => notify(o),
    tutupNotifikasiLain: (user) => tutupNotifikasi(inti.GRUP_NOTIFIKASI, user),
    buka: (aksi) => kirim(IPC_CHANNELS.pemantauBuka, aksi),
    berubah: () => kirim(IPC_CHANNELS.pemantauBerubah),
    log: (pesan, data) => logger().info(data, pesan),
    audit: (aksi, detail) => audit('pemantau', aksi, detail),
    sekarang: () => new Date(),
    hariIniJakarta: () => jakartaToday(),
    // Jeda acak ditarik SEKALI per proses: puluhan laptop yang menyala 08.00 tidak
    // menembak database bersamaan. Mode uji tanpa jeda supaya bukti tidak menunggu.
    jedaMs: uji.sales || uji.lab ? 0 : jedaAcakMs(),
    uji
  }
  return dependensi
}

/**
 * Tidak ada sesi (logout / sesi dicabut): semua toast pemantau ditutup — isinya keadaan
 * data milik orang yang baru saja keluar. Dipanggil detak Jadwal; tanpa Electron lain.
 */
export function tutupNotifikasiPemantau(): void {
  tutupNotifikasi(inti.GRUP_NOTIFIKASI, null)
}

/** Dipanggil detak penjadwal Jadwal (tiap 30 dtk) saat tidak ada tugas yang jatuh tempo. */
export function periksaPemantau(opsi?: { paksa?: boolean }): Promise<void> {
  return inti.periksaPemantau(deps(), opsi)
}

export function keadaanPemantau(): KeadaanPemantau {
  return inti.keadaanPemantau(deps())
}

export function setelPemicu(id: PemicuId, aktif: boolean): KeadaanPemantau {
  return inti.setelPemicu(deps(), id, aktif)
}

export function periksaSekarang(): Promise<KeadaanPemantau> {
  return inti.periksaSekarang(deps())
}
