import { mkdirSync, existsSync, statSync, writeFileSync } from 'fs'
import * as path from 'path'
import { ToolError, type ToolDefinition } from './types'
import { resolveInBoundary } from './boundary'
import { buatGambar, ubahGambar } from '../gambar/omni'
import {
  GambarError,
  MAKS_JUMLAH,
  UKURAN_GAMBAR,
  UKURAN_BAWAAN,
  catatanGambar,
  dimensiPng,
  pastikanBerkasPng,
  pastikanJumlah,
  pastikanPrompt,
  pastikanUkuran
} from '../gambar/rules'

// Tool pembuat & pengubah gambar (old-image-model).
//
// ⚠️ Tier `write`: keduanya MENULIS berkas baru ke folder akses user, jadi
// tunduk pada gerbang persetujuan seperti write_word/write_pdf. Bukan karena
// membuat gambar itu berbahaya, melainkan karena menulis berkas ke komputer
// orang selalu butuh izin.
//
// ⚠️ Gambarnya TIDAK pernah dikembalikan sebagai data ke model — hanya path,
// ukuran, dan kalimat catatan. Lihat alasannya di `gambar/omni.ts`.

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new ToolError(`argumen "${key}" wajib berupa string`)
  }
  return value
}

/** Galat aturan gambar diubah jadi ToolError supaya sampai ke model apa adanya. */
function jalankan<T>(kerja: () => T): T {
  try {
    return kerja()
  } catch (err) {
    if (err instanceof GambarError) throw new ToolError(err.message)
    throw err
  }
}

function siapkanTujuan(file: string): void {
  jalankan(() => pastikanBerkasPng(file))
  if (existsSync(file)) {
    throw new ToolError('file sudah ada — pilih nama lain, atau hapus/pindahkan dulu file lama')
  }
  mkdirSync(path.dirname(file), { recursive: true })
}

/** Menyimpan beberapa gambar: file pertama apa adanya, sisanya diberi -2, -3, … */
function simpan(file: string, png: Buffer[]): { daftar: string[]; bytes: number } {
  const dasar = file.slice(0, -4)
  const daftar: string[] = []
  let bytes = 0
  png.forEach((buf, i) => {
    const tujuan = i === 0 ? file : `${dasar}-${i + 1}.png`
    if (i > 0 && existsSync(tujuan)) {
      throw new ToolError(`file "${tujuan}" sudah ada — pilih nama dasar lain untuk beberapa gambar`)
    }
    writeFileSync(tujuan, buf)
    daftar.push(tujuan)
    bytes += statSync(tujuan).size
  })
  return { daftar, bytes }
}

export const gambarTools: ToolDefinition[] = [
  {
    name: 'buat_gambar',
    label: 'Create image',
    description:
      'Membuat GAMBAR BARU (.png) dari deskripsi teks memakai pembuat gambar AIRA. Ke user, sebut ' +
      'pembuatnya "AIRA" saja — jangan menyebut nama model atau gateway. Pakai bila user minta dibuatkan gambar, ilustrasi, ikon, atau latar — bukan untuk ' +
      'grafik data (itu write_excel/write_ppt/sales_report) dan bukan untuk diagram teknis. ' +
      `Ukuran: ${UKURAN_GAMBAR.join(', ')}; bawaan ${UKURAN_BAWAAN} (±2 detik). Ukuran besar ` +
      'jauh lebih lambat dan berkasnya beberapa MB. Hasilnya PNG — SELALU, apa pun format yang ' +
      'diminta user. Tulis prompt yang menyebut objek, gaya, warna, dan latar; bahasa Indonesia ' +
      'boleh. Gambar yang dihasilkan buatan AI: katakan itu ke user.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path file .png baru' },
        prompt: {
          type: 'string',
          description:
            'Deskripsi gambar yang diinginkan — wajib berasal dari permintaan user, jangan menambah ' +
            'objek yang tidak ia sebut'
        },
        ukuran: { type: 'string', enum: [...UKURAN_GAMBAR], description: `Bawaan ${UKURAN_BAWAAN}` },
        jumlah: {
          type: 'integer',
          description: `Berapa variasi gambar (1–${MAKS_JUMLAH}); berkas kedua dst. diberi akhiran -2, -3`
        }
      },
      required: ['path', 'prompt']
    },
    tier: 'write',
    timeoutMs: 150_000,
    summarize: (a) => `Create image ${a.path}`,
    execute: async (args, ctx) => {
      const file = resolveInBoundary(str(args, 'path'), ctx.allowedDirs)
      siapkanTujuan(file)
      const prompt = jalankan(() => pastikanPrompt(args.prompt))
      const ukuran = jalankan(() => pastikanUkuran(args.ukuran))
      const jumlah = jalankan(() => pastikanJumlah(args.jumlah))

      let png: Buffer[]
      try {
        png = await buatGambar({ prompt, ukuran, jumlah })
      } catch (err) {
        throw new ToolError(err instanceof Error ? err.message : String(err))
      }
      const { daftar, bytes } = simpan(file, png)
      const dim = dimensiPng(png[0]) ?? { lebar: 0, tinggi: 0 }

      return JSON.stringify({
        written: daftar[0],
        berkas: daftar,
        lebar: dim.lebar,
        tinggi: dim.tinggi,
        ukuranByte: bytes,
        catatanHasil: catatanGambar({
          file: daftar.join(', '),
          lebar: dim.lebar,
          tinggi: dim.tinggi,
          bytes,
          jumlah: daftar.length
        })
      })
    }
  },
  {
    name: 'ubah_gambar',
    label: 'Edit image',
    description:
      'Mengubah gambar PNG yang SUDAH ADA sesuai instruksi teks (mis. ganti warna, ganti latar, ' +
      'tambah/hapus objek), lalu menyimpannya sebagai berkas BARU — berkas asal tidak disentuh. ' +
      'Berkas asal wajib PNG. Pakai bila user minta gambar sebelumnya diubah, bukan dibuat ulang ' +
      'dari nol. Hasilnya buatan AI: katakan itu ke user.',
    parameters: {
      type: 'object',
      properties: {
        path_asal: { type: 'string', description: 'Path gambar .png yang akan diubah' },
        path: { type: 'string', description: 'Path file .png hasil (baru)' },
        prompt: { type: 'string', description: 'Perubahan yang diminta user' },
        ukuran: { type: 'string', enum: [...UKURAN_GAMBAR], description: `Bawaan ${UKURAN_BAWAAN}` }
      },
      required: ['path_asal', 'path', 'prompt']
    },
    tier: 'write',
    timeoutMs: 150_000,
    summarize: (a) => `Edit image ${a.path_asal} -> ${a.path}`,
    execute: async (args, ctx) => {
      const asal = resolveInBoundary(str(args, 'path_asal'), ctx.allowedDirs)
      if (!existsSync(asal)) throw new ToolError(`file "${asal}" tidak ditemukan`)
      const file = resolveInBoundary(str(args, 'path'), ctx.allowedDirs)
      if (path.resolve(asal) === path.resolve(file)) {
        throw new ToolError(
          'hasil tidak boleh menimpa gambar asal — beri nama berkas baru supaya versi lamanya tetap ada'
        )
      }
      siapkanTujuan(file)
      const prompt = jalankan(() => pastikanPrompt(args.prompt))
      const ukuran = jalankan(() => pastikanUkuran(args.ukuran))

      let png: Buffer[]
      try {
        png = await ubahGambar({ asal, prompt, ukuran })
      } catch (err) {
        throw new ToolError(err instanceof Error ? err.message : String(err))
      }
      const { daftar, bytes } = simpan(file, png)
      const dim = dimensiPng(png[0]) ?? { lebar: 0, tinggi: 0 }

      return JSON.stringify({
        written: daftar[0],
        asal,
        lebar: dim.lebar,
        tinggi: dim.tinggi,
        ukuranByte: bytes,
        catatanHasil:
          `Gambar hasil perubahan tersimpan di ${daftar[0]}; berkas asal (${asal}) tetap utuh. ` +
          catatanGambar({ file: daftar[0], lebar: dim.lebar, tinggi: dim.tinggi, bytes, jumlah: 1 })
      })
    }
  }
]
