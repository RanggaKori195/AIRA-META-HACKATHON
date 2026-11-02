import { app } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import pino from 'pino'
import { redactText } from './security/redact'

export { redactText }

function createLogger(): pino.Logger {
  const logDir = join(app.getPath('userData'), 'logs')
  mkdirSync(logDir, { recursive: true })
  return pino(
    {
      level: 'info',
      hooks: {
        logMethod(args, method) {
          const safe = args.map((a) => (typeof a === 'string' ? redactText(a) : a)) as Parameters<
            typeof method
          >
          method.apply(this, safe)
        }
      }
    },
    pino.destination({ dest: join(logDir, 'aira.log'), sync: false })
  )
}

let instance: pino.Logger | null = null

export function logger(): pino.Logger {
  if (!instance) {
    // ⚠️ Saklar untuk SKRIP, bukan untuk aplikasi.
    //
    // Tujuan log pino bersifat asinkron (sonic-boom). Skrip pendek yang memuat
    // kode main lalu langsung keluar — mis. `npm run coba:pdf` — bisa memanggil
    // `app.exit()` SEBELUM berkas lognya selesai dibuka, dan sonic-boom melempar
    // "sonic boom is not ready yet" saat proses ditutup. Di Electron itu muncul
    // sebagai kotak dialog merah "A JavaScript error occurred in the main
    // process", padahal pekerjaannya sendiri sudah selesai dengan benar
    // (terjadi 21 Agu 2026 saat menguji pembuatan PDF).
    //
    // Efek sampingnya juga tidak diinginkan: skrip yang dijalankan lewat binary
    // Electron memakai nama aplikasi "Electron", jadi lognya menumpuk di folder
    // %APPDATA%\Electron — bukan folder AIRA, dan tidak ada yang membacanya.
    if (process.env.AIRA_LOG_SILENT === '1') {
      instance = pino({ level: 'silent' })
      return instance
    }
    try {
      instance = createLogger()
    } catch {
      // Di luar Electron (mis. `npx tsx tests/inno-live-check.ts`) `app` tidak ada,
      // jadi folder log tidak bisa ditentukan. Jangan sampai itu menggagalkan
      // pemeriksaan ke database sungguhan — cukup buang lognya.
      instance = pino({ level: 'silent' })
    }
  }
  return instance
}
