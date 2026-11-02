import { ToolError, type ToolDefinition } from './types'
import { bacaSurat, daftarSurat, drafBalasan } from '../m365/mail'
import { acaraRentang } from '../m365/calendar'
import { CATATAN_CAKUPAN, KONTEN_TAK_TEPERCAYA, catatanDaftar } from '../m365/rules'
import { jakartaToday } from '../sales/periods'

// Email & kalender Microsoft 365 — menu "Tanya Microsoft 365".
//
// ⚠️ TIDAK ADA tool yang mengirim email atau mengubah kalender. `Mail.Send`
// tidak diminta sama sekali; balasan hanya dibuat sebagai DRAF, dan yang
// menekan Send tetap orangnya. Email terkirim tidak bisa ditarik — itu masuk
// kategori "operasi yang tidak bisa di-undo" di SOUL.md.

function teks(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function angka(args: Record<string, unknown>, key: string, bawaan: number, maks: number): number {
  const v = args[key]
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : bawaan
  return Math.max(1, Math.min(n, maks))
}

export const m365Tools: ToolDefinition[] = [
  {
    name: 'email_daftar',
    label: 'Daftar Email',
    description:
      'Menampilkan email di kotak masuk user: yang terbaru, yang belum dibaca, atau hasil pencarian. ' +
      'Pakai untuk "email apa saja yang masuk hari ini", "ada yang belum saya baca?", ' +
      '"cari email tentang X". Mengembalikan pengirim, subjek, waktu, dan cuplikan — ' +
      'untuk isi lengkapnya lanjutkan dengan email_baca.',
    parameters: {
      type: 'object',
      properties: {
        cari: {
          type: 'string',
          description: 'Kata yang dicari. Wajib berasal dari kalimat user, jangan diisi sendiri.'
        },
        belumDibaca: { type: 'boolean', description: 'true = hanya yang belum dibaca.' },
        hariTerakhir: {
          type: 'number',
          description: 'Batasi ke sekian hari terakhir. Kosongkan bila user tidak menyebut waktu.'
        },
        batas: { type: 'number', description: 'Jumlah email (bawaan 15, maksimum 50).' }
      }
    },
    tier: 'read',
    timeoutMs: 60_000,
    summarize: (a) =>
      a.cari ? `Cari email: ${a.cari}` : a.belumDibaca ? 'Email belum dibaca' : 'Email terbaru',
    execute: async (args) => {
      const batas = angka(args, 'batas', 15, 50)
      const hasil = await daftarSurat(
        {
          cari: teks(args, 'cari'),
          belumDibaca: args.belumDibaca === true,
          hariTerakhir: typeof args.hariTerakhir === 'number' ? args.hariTerakhir : undefined
        },
        batas
      )
      const konteks = teks(args, 'cari')
        ? `pencarian email "${teks(args, 'cari')}"`
        : args.belumDibaca === true
          ? 'email yang belum dibaca'
          : 'email terbaru'
      return JSON.stringify({
        email: hasil.surat,
        catatan: catatanDaftar(hasil.surat.length, hasil.adaLagi, konteks),
        catatanCuplikan:
          'Kolom cuplikan hanya beberapa baris pertama. JANGAN meringkas atau menyimpulkan isi ' +
          'sebuah email dari cuplikannya — panggil email_baca untuk isi lengkapnya.',
        keamanan: KONTEN_TAK_TEPERCAYA,
        cakupan: CATATAN_CAKUPAN
      })
    }
  },

  {
    name: 'email_baca',
    label: 'Baca Email',
    description:
      'Membaca isi lengkap satu email berdasarkan id yang didapat dari email_daftar. ' +
      'Pakai sebelum meringkas, menjawab pertanyaan tentang isinya, atau membuat draf balasan.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'id email dari hasil email_daftar. WAJIB disalin, jangan pernah dikarang.'
        }
      },
      required: ['id']
    },
    tier: 'read',
    timeoutMs: 60_000,
    summarize: () => 'Baca isi email',
    execute: async (args) => {
      const id = teks(args, 'id')
      if (!id) throw new ToolError('id email wajib diisi, disalin dari hasil email_daftar')
      const surat = await bacaSurat(id)
      return JSON.stringify({
        ...surat,
        catatanIsi: surat.terpotong
          ? 'Isi email ini PANJANG dan dipotong pada batas yang ditentukan. Sampaikan ke user bahwa ' +
            'yang kamu baca sebagian awalnya, dan jangan mengarang bagian yang tidak terbaca.'
          : 'Seluruh isi email ini terbaca, tidak ada yang dipotong. Jangan menyebut isinya terpotong.',
        keamanan: KONTEN_TAK_TEPERCAYA,
        cakupan: CATATAN_CAKUPAN
      })
    }
  },

  {
    name: 'email_draf_balasan',
    label: 'Buat Draf Balasan',
    description:
      'Membuat DRAF balasan untuk sebuah email dan menyimpannya di Outlook. TIDAK MENGIRIM apa pun — ' +
      'user yang membuka Outlook, membaca ulang, lalu menekan Send sendiri. ' +
      'Pakai bila user meminta dibuatkan balasan.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'id email yang dibalas, dari hasil email_daftar. Jangan dikarang.'
        },
        isi: {
          type: 'string',
          description:
            'Teks balasan. Tulis lengkap dan siap dibaca orang — ini yang akan dilihat user di Outlook.'
        }
      },
      required: ['id', 'isi']
    },
    // ⚠️ `write`, jadi user dimintai persetujuan lebih dulu. Draf memang tidak
    // terkirim, tapi ia MUNCUL di Outlook orang dan bisa tidak sengaja terkirim
    // olehnya. Persetujuan di sini murah; kejutan di kotak keluar tidak.
    tier: 'write',
    timeoutMs: 60_000,
    summarize: (a) => `Buat draf balasan email (${String(a.isi ?? '').slice(0, 60)}…)`,
    execute: async (args) => {
      const id = teks(args, 'id')
      const isi = teks(args, 'isi')
      if (!id) throw new ToolError('id email wajib diisi, disalin dari hasil email_daftar')
      if (!isi) throw new ToolError('isi balasan wajib diisi')
      const draf = await drafBalasan(id, isi)
      return JSON.stringify({
        dibuat: true,
        terkirim: false,
        webLink: draf.webLink,
        catatan:
          'Draf sudah tersimpan di folder Draft Outlook dan BELUM DIKIRIM. Katakan ke user untuk ' +
          'membukanya di Outlook, membaca ulang, lalu menekan Send sendiri. Jangan sekali-kali ' +
          'menyatakan email sudah terkirim — AIRA tidak punya kemampuan mengirim email.',
        cakupan: CATATAN_CAKUPAN
      })
    }
  },

  {
    name: 'kalender_lihat',
    label: 'Lihat Kalender',
    description:
      'Menampilkan jadwal/rapat user pada rentang tanggal tertentu, lengkap dengan jam, lokasi, ' +
      'penyelenggara, peserta, dan agendanya. Pakai untuk "jadwal saya hari ini", ' +
      '"rapat apa besok", "minggu ini ada apa saja".',
    parameters: {
      type: 'object',
      properties: {
        dari: {
          type: 'string',
          description: 'Tanggal awal (YYYY-MM-DD). Kosongkan untuk hari ini.'
        },
        sampai: {
          type: 'string',
          description: 'Tanggal akhir (YYYY-MM-DD). Kosongkan untuk sama dengan tanggal awal.'
        },
        batas: { type: 'number', description: 'Jumlah acara (bawaan 30, maksimum 100).' }
      }
    },
    tier: 'read',
    timeoutMs: 60_000,
    summarize: (a) => `Kalender ${a.dari ?? 'hari ini'}${a.sampai ? ` s/d ${a.sampai}` : ''}`,
    execute: async (args) => {
      const hariIni = jakartaToday()
      const dari = teks(args, 'dari') ?? hariIni
      const sampai = teks(args, 'sampai') ?? dari
      if (sampai < dari) {
        throw new ToolError(`rentang terbalik: "sampai" (${sampai}) lebih awal dari "dari" (${dari}).`)
      }
      const acara = await acaraRentang(dari, sampai, angka(args, 'batas', 30, 100))
      return JSON.stringify({
        dari,
        sampai,
        hariIni,
        jumlah: acara.length,
        acara,
        catatan:
          acara.length === 0
            ? `Tidak ada acara terjadwal antara ${dari} dan ${sampai}. Ini hasil nyata dari kalender, ` +
              'bukan kegagalan membaca — katakan kosong, jangan menebak ada rapat.'
            : `Seluruh ${acara.length} acara pada rentang ini ditampilkan.`,
        catatanWaktu:
          'Semua jam sudah dalam waktu Jakarta (WIB). Sebutkan jamnya apa adanya, jangan dikonversi lagi.',
        catatanRekap:
          'AIRA TIDAK bisa membaca transkrip atau rekaman rapat Teams. Yang tersedia hanya ' +
          'informasi undangannya. Kalau user minta rekap isi rapat, katakan itu belum tersambung.',
        cakupan: CATATAN_CAKUPAN
      })
    }
  }
]

export const M365_TOOL_NAMES = m365Tools.map((t) => t.name)
