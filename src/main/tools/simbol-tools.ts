import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { resolveInBoundary } from './boundary'
import { ToolError, type ToolDefinition } from './types'
import { BAHASA_DIDUKUNG, bacaSimbol, treeSitterTersedia } from '../code/tree'
import { bahasaDari, catatanSimbol, cocok, type Simbol } from '../code/simbol-rules'

// Pencarian kode berbasis POHON SINTAKS.
//
// ⚠️ Ini melengkapi `search_code`, bukan menggantikannya. Keduanya menjawab
// pertanyaan yang berbeda dan sama-sama dibutuhkan:
//   - "di mana fungsi X DIDEFINISIKAN?"  -> cari_simbol  (satu jawaban)
//   - "di mana X DIPAKAI?"                -> search_code  (semua pemanggilan)
// Menghapus salah satunya membuat separuh pertanyaan tidak terjawab.

const MAKS_BERKAS = 400
const MAKS_HASIL = 150
const LEWATI = new Set([
  'node_modules', '.git', 'dist', 'out', 'build', 'release', '.next', 'coverage', '__pycache__'
])

interface Temuan extends Simbol {
  berkas: string
}

function kumpulkanBerkas(akar: string): { berkas: string[]; terpotong: boolean } {
  const berkas: string[] = []
  let terpotong = false
  const jalan = (dir: string, dalam: number): void => {
    if (dalam > 8 || berkas.length >= MAKS_BERKAS) return
    let isi: Array<{ name: string; isDirectory(): boolean }>
    try {
      isi = readdirSync(dir, { withFileTypes: true }) as unknown as Array<{
        name: string
        isDirectory(): boolean
      }>
    } catch {
      return
    }
    for (const e of isi) {
      if (berkas.length >= MAKS_BERKAS) {
        terpotong = true
        return
      }
      const penuh = join(dir, e.name)
      if (e.isDirectory()) {
        if (LEWATI.has(e.name) || e.name.startsWith('.')) continue
        jalan(penuh, dalam + 1)
      } else if (bahasaDari(e.name)) {
        berkas.push(penuh)
      }
    }
  }
  try {
    if (statSync(akar).isFile()) return { berkas: [akar], terpotong: false }
  } catch {
    return { berkas: [], terpotong: false }
  }
  jalan(akar, 0)
  return { berkas, terpotong }
}

export const simbolTools: ToolDefinition[] = [
  {
    name: 'cari_simbol',
    label: 'Cari Definisi Kode',
    description:
      'Mencari DEFINISI fungsi, kelas, metode, atau tipe di dalam kode — bukan pemanggilannya. ' +
      'Membaca pohon sintaks, jadi jauh lebih tepat daripada grep untuk pertanyaan ' +
      '"di mana fungsi X didefinisikan" atau "ada fungsi apa saja di berkas/folder ini". ' +
      'Untuk mencari di MANA SAJA sebuah nama dipakai (pemanggilannya), pakai search_code.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Berkas atau folder yang diperiksa. Wajib di dalam folder akses.'
        },
        nama: {
          type: 'string',
          description:
            'Nama simbol yang dicari (cocok sebagian, tidak peduli besar-kecil huruf). ' +
            'Kosongkan untuk menampilkan SEMUA definisi di situ. ' +
            'Wajib berasal dari kalimat user, jangan diisi sendiri.'
        },
        jenis: {
          type: 'string',
          enum: ['fungsi', 'kelas', 'metode', 'tipe'],
          description: 'Batasi ke satu jenis saja. Kosongkan untuk semua jenis.'
        }
      },
      required: ['path']
    },
    tier: 'read',
    timeoutMs: 120_000,
    summarize: (a) =>
      a.nama ? `Cari definisi "${a.nama}" di ${a.path}` : `Daftar definisi di ${a.path}`,
    execute: async (args, ctx) => {
      const akar = resolveInBoundary(
        typeof args.path === 'string' ? args.path : '',
        ctx.allowedDirs
      )
      const nama = typeof args.nama === 'string' ? args.nama.trim() : ''
      const jenis = typeof args.jenis === 'string' ? args.jenis : ''

      // ⚠️ Ketidaktersediaan disebut TERUS TERANG, bukan diam-diam jatuh ke
      // hasil kosong. Nol simbol tanpa keterangan terbaca oleh model sebagai
      // "fungsinya tidak ada" — kesimpulan yang salah dan meyakinkan.
      if (!(await treeSitterTersedia())) {
        throw new ToolError(
          'Pembacaan pohon sintaks tidak tersedia di build ini (grammar tree-sitter tidak ' +
            'ditemukan). Pakai search_code sebagai gantinya, dan katakan ke user bahwa ' +
            'pencarian definisi sedang tidak aktif — jangan menyimpulkan simbolnya tidak ada.'
        )
      }

      const { berkas, terpotong } = kumpulkanBerkas(akar)
      if (berkas.length === 0) {
        return JSON.stringify({
          hasil: [],
          catatan:
            `Tidak ada berkas kode yang bisa dibaca di "${akar}". Bahasa yang didukung: ` +
            `${BAHASA_DIDUKUNG.join(', ')}. Ini bukan berarti kodenya tidak ada — bisa jadi ` +
            'bahasanya memang belum didukung; sebutkan itu ke user.'
        })
      }

      const temuan: Temuan[] = []
      const gagal: Array<{ berkas: string; alasan: string }> = []
      let dibaca = 0

      for (const f of berkas) {
        const hasil = await bacaSimbol(f)
        if (!hasil.terbaca) {
          gagal.push({ berkas: relative(akar, f) || f, alasan: hasil.alasan ?? 'tidak diketahui' })
          continue
        }
        dibaca++
        for (const s of hasil.simbol) {
          if (!cocok(s.nama, nama)) continue
          if (jenis && s.jenis !== jenis) continue
          temuan.push({ ...s, berkas: relative(akar, f) || f })
          if (temuan.length >= MAKS_HASIL) break
        }
        if (temuan.length >= MAKS_HASIL) break
      }

      // Definisi yang namanya PERSIS sama didahulukan — itu yang dicari orang.
      if (nama) {
        const tepat = nama.toLowerCase()
        temuan.sort((a, b) => {
          const skorA = a.nama.toLowerCase() === tepat ? 0 : 1
          const skorB = b.nama.toLowerCase() === tepat ? 0 : 1
          return skorA - skorB
        })
      }

      return JSON.stringify({
        akar,
        dicari: nama || '(semua)',
        berkasDiperiksa: berkas.length,
        berkasTerbaca: dibaca,
        hasil: temuan,
        catatan: catatanSimbol(temuan.length, dibaca, gagal, nama),
        ...(terpotong
          ? {
              catatanBatas:
                `Hanya ${MAKS_BERKAS} berkas pertama yang diperiksa. Persempit "path" ke ` +
                'sub-folder bila yang dicari belum ketemu — jangan menyimpulkan tidak ada.'
            }
          : {}),
        ...(temuan.length >= MAKS_HASIL
          ? {
              catatanHasil:
                `Hasil dipotong di ${MAKS_HASIL} definisi. Persempit dengan "nama" atau "jenis"; ` +
                'jangan mengarang jumlah totalnya.'
            }
          : {}),
        bandingkanDengan:
          'Yang dikembalikan hanya DEFINISI. Untuk melihat di mana saja nama ini DIPAKAI, ' +
          'panggil search_code dengan nama yang sama.'
      })
    }
  }
]

export const SIMBOL_TOOL_NAMES = simbolTools.map((t) => t.name)
