import { loadConfig } from '../config'
import { mainWindow, notify } from '../notify'
import { sesiSekarang } from '../auth/service'
import { logger } from '../logger'
import { IPC_CHANNELS } from '../../shared/ipc'
import { pasangLencana } from './lencana'
import {
  POLL_NOTIF_MS,
  kunciSenyap,
  ringkasNotifikasi,
  sedangSenyap,
  type PesanMasuk
} from './rules'
import { idPesanTerakhir, pesanMasukBaru, totalBelumDibaca } from './service'
import { pesanGrupMasukBaru } from './grup'
import { kunciSenyapGrup, teksSistem } from './grup-rules'

/*
 * Pengawas pesan masuk — DI MAIN PROCESS.
 *
 * ⚠️ Kenapa bukan di renderer, padahal renderer sudah punya polling sendiri:
 * polling renderer hanya hidup saat widget chatnya dibuka. Orang yang sedang
 * mengetik laporan, atau yang jendelanya diminimalkan ke tray, tidak akan tahu
 * ada pesan masuk sama sekali. Notifikasi yang hanya bekerja saat layarnya sudah
 * terbuka bukan notifikasi. Alasan yang sama membuat detak kehadiran dipindah
 * ke main.
 *
 * ⚠️ Siapa yang diawasi DIBACA ULANG dari sesi tiap putaran, bukan disetel saat
 * login. Dengan begitu login, logout, sesi yang dicabut Super Admin, dan
 * pergantian user di laptop yang sama semuanya tertangani di SATU tempat — tidak
 * ada titik penyambungan yang bisa terlupa. Pola yang sama dengan timer detak
 * kehadiran di `ipc.ts`.
 */

let timer: NodeJS.Timeout | null = null
/** User yang sedang diawasi. Berubah = penandanya wajib disetel ulang. */
let pemilik: string | null = null
/** Id pesan terakhir yang SUDAH diberitahukan. */
let sejakId: string | null = null
/** Jumlah pada lencana terakhir — supaya ikonnya tidak digambar ulang percuma. */
let lencanaTerpasang = -1
let sedangJalan = false

function daftarSenyap(saya: string): string[] {
  try {
    return loadConfig().chatSenyap[kunciSenyap(saya)] ?? []
  } catch {
    // Config korup tidak boleh mematikan notifikasi — lebih baik berbunyi semua
    // daripada diam semua.
    return []
  }
}

function pratinjauNyala(): boolean {
  try {
    return loadConfig().chatPratinjau
  } catch {
    return false
  }
}

async function setelLencana(jumlah: number): Promise<void> {
  if (jumlah === lencanaTerpasang) return
  lencanaTerpasang = jumlah
  await pasangLencana(mainWindow(), jumlah)
}

/** Tidak ada yang login (atau user berganti) — bersihkan jejak orang sebelumnya. */
async function lupakan(): Promise<void> {
  pemilik = null
  sejakId = null
  await setelLencana(0)
}

async function periksa(): Promise<void> {
  if (sedangJalan) return
  sedangJalan = true
  try {
    const sesi = sesiSekarang()
    if (!sesi) {
      if (pemilik !== null) await lupakan()
      return
    }

    const saya = sesi.username
    if (pemilik?.toLowerCase() !== saya.toLowerCase()) {
      // User baru (login pertama, atau ganti orang di laptop yang sama).
      //
      // ⚠️ Penanda disetel ke pesan TERAKHIR yang ada, bukan ke nol. Tanpa ini,
      // orang yang membuka AIRA pagi hari dihujani toast untuk semua pesan
      // semalam. Yang belum dibaca tetap terlihat di lencana dan di daftar
      // rekan — yang tidak dilakukan hanyalah membunyikannya.
      pemilik = saya
      sejakId = await idPesanTerakhir()
      lencanaTerpasang = -1
      await setelLencana(await totalBelumDibaca(saya))
      return
    }

    const BATAS = 30
    const [pribadi, grup] = await Promise.all([
      pesanMasukBaru(saya, sejakId, BATAS),
      pesanGrupMasukBaru(saya, sejakId, BATAS)
    ])
    if (pribadi.length > 0 || grup.length > 0) {
      // ⚠️ Penanda dimajukan LEBIH DULU, sebelum notifikasinya ditampilkan.
      // Kalau notifikasinya yang gagal, yang hilang cuma satu bunyi; kalau
      // penandanya yang tidak maju, pesan yang sama dibunyikan ulang tiap 10
      // detik selamanya — dan itu membuat orang mematikan notifikasi AIRA di
      // setelan Windows, yang ikut mematikan pesan yang benar-benar penting.
      //
      // ⚠️ Dua sumber, satu penanda. Kalau salah satu sumber mentok di BATAS,
      // penanda TIDAK boleh melompat melewati sisa yang belum terambil dari
      // sumber itu — kalau melompat, pesan-pesan itu tidak akan pernah
      // dibunyikan. Jadi penanda maju ke id terbesar, lalu ditahan di id
      // terakhir sumber yang penuh.
      const idTerakhir = (d: { id: string }[]): bigint => BigInt(d[d.length - 1].id)
      let maju = 0n
      for (const d of [pribadi, grup]) if (d.length > 0 && idTerakhir(d) > maju) maju = idTerakhir(d)
      for (const d of [pribadi, grup]) if (d.length >= BATAS && idTerakhir(d) < maju) maju = idTerakhir(d)
      sejakId = String(maju)

      const senyap = daftarSenyap(saya)
      const layak: PesanMasuk[] = [
        ...pribadi
          .filter((p) => !sedangSenyap(senyap, p.pengirim))
          .map((p) => ({
            pengirim: p.pengirim,
            isi: p.isi,
            adaLampiran: Boolean(p.lampiranNama)
          })),
        ...grup
          // "X menambahkan kamu" TETAP dibunyikan walau grupnya disenyapkan
          // (mis. bergabung ulang ke grup lama yang dulu disenyapkan) — itu
          // satu-satunya cara orang tahu ia baru dimasukkan.
          .filter((p) => p.jenis === 'tambah' || !sedangSenyap(senyap, kunciSenyapGrup(p.grupId ?? '')))
          .map((p) => ({
            pengirim: p.pengirim,
            isi: p.isi,
            adaLampiran: Boolean(p.lampiranNama),
            grup: { id: p.grupId ?? '', nama: p.grupNama },
            sistem: p.jenis ? teksSistem(p.jenis, p.pengirim, p.target, saya) : undefined
          }))
      ]
      const baru = [...pribadi, ...grup]

      if (layak.length > 0) {
        const pratinjau = pratinjauNyala()
        for (const n of ringkasNotifikasi(layak, pratinjau)) {
          notify({ title: n.judul, body: n.isi })
        }
        // Renderer disegarkan supaya widget chat tidak menunggu polling-nya
        // sendiri — pesan yang baru muncul beberapa detik sesudah toast-nya
        // berbunyi terlihat seperti aplikasi yang lambat.
        mainWindow()?.webContents.send(IPC_CHANNELS.chatPesanBaru)
        logger().info(
          { jumlah: layak.length, disenyapkan: baru.length - layak.length },
          'notifikasi chat'
        )
      }
    }

    await setelLencana(await totalBelumDibaca(saya))
  } catch (err) {
    // Database chat tidak terjangkau (mis. VPN putus) tidak boleh membanjiri log
    // tiap 10 detik. Dicatat sebagai debug; putaran berikutnya jalan seperti biasa.
    logger().debug({ err: String(err).slice(0, 160) }, 'pemeriksaan pesan masuk gagal')
  } finally {
    sedangJalan = false
  }
}

/** Dipanggil sekali saat aplikasi siap. */
export function mulaiPantauChat(): void {
  if (timer) return
  timer = setInterval(() => void periksa(), POLL_NOTIF_MS)
  timer.unref()
  void periksa()
}

/** Dipanggil saat aplikasi benar-benar keluar. */
export function hentikanPantauChat(): void {
  if (timer) clearInterval(timer)
  timer = null
  void lupakan()
}

/**
 * Menyegerakan satu putaran pemeriksaan.
 *
 * Dipakai sesudah user menandai percakapan terbaca: tanpa ini lencananya baru
 * turun pada putaran berikutnya, dan angka yang tertinggal membuat orang
 * mencari pesan yang sudah dibacanya.
 */
export function segarkanLencana(): void {
  void periksa()
}
