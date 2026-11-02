import { existsSync, mkdirSync, statSync, writeFileSync } from 'fs'
import * as path from 'path'
import { ToolError, type ToolDefinition } from './types'
import { resolveInBoundary } from './boundary'
import { ARAH, BENTUK, DiagramError, MAKS_SIMPUL, pastikanBerkasHtml, periksaSpek } from '../diagram/rules'
import { tataLetak } from '../diagram/tata-letak'
import { TINGGI_JUDUL, keSvg } from '../diagram/svg'
import { keHtml } from '../diagram/html'
import { svgKePng } from '../grafik/raster'

// Tool diagram interaktif (30 Sep 2026, permintaan 18 Sep).
//
// ⚠️ Pola aturan 24: model hanya mengisi ISI (simpul, hubungan, kelompok). Tata
// letak, bentuk, warna milik kode (`diagram/tata-letak.ts`, `diagram/svg.ts`).
// ⚠️ Tier `write`: menulis dua berkas baru ke folder akses user (HTML + PNG).
// ⚠️ Diagram yang isinya dikarang terlihat seresmi diagram yang benar — deskripsi
// tool melarang mengarang langkah/pihak yang tidak disebut user atau dokumennya.

function jalankan<T>(kerja: () => T): T {
  try {
    return kerja()
  } catch (err) {
    if (err instanceof DiagramError) throw new ToolError(err.message)
    throw err
  }
}

export const diagramTools: ToolDefinition[] = [
  {
    name: 'buat_diagram',
    label: 'Create diagram',
    description:
      'Membuat DIAGRAM INTERAKTIF: diagram alur/SOP, alur sampel, struktur organisasi, arsitektur ' +
      'sistem, atau hubungan antar pihak. Hasilnya berkas .html (dibuka di browser: geser, zoom, klik ' +
      'simpul untuk detail, unduh PNG) PLUS gambar .png di sebelahnya untuk ditempel ke PPT/Word. ' +
      'Kamu HANYA mengisi isi: simpul, hubungan, dan kelompok — tata letak, warna, dan posisi diatur ' +
      'otomatis, jangan menyebut koordinat. Isi simpul WAJIB berasal dari kalimat user atau dokumen ' +
      'yang sudah dibaca; kalau langkah/pihaknya belum jelas, TANYAKAN dulu — jangan mengarang ' +
      'langkah demi diagram yang terlihat lengkap. Bukan untuk grafik angka (itu write_excel/' +
      'write_ppt/sales_report) dan bukan untuk ilustrasi (itu buat_gambar). ' +
      `Maksimal ${MAKS_SIMPUL} simpul; lebih dari itu pecah per tahap.`,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path berkas .html baru (PNG ditulis di sebelahnya dengan nama sama)' },
        judul: { type: 'string', description: 'Judul diagram' },
        arah: {
          type: 'string',
          enum: [...ARAH],
          description: 'atas-bawah untuk alur/hierarki (bawaan); kiri-kanan untuk proses panjang/timeline'
        },
        simpul: {
          type: 'array',
          description: 'Kotak-kotak diagram',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Id pendek unik, mis. "s1"' },
              label: { type: 'string', description: 'Short phrase (≤ 80 characters) — put details in keterangan' },
              bentuk: {
                type: 'string',
                enum: [...BENTUK],
                description:
                  'proses (bawaan), keputusan (pertanyaan ya/tidak), terminal (mulai/selesai), ' +
                  'data (masukan/keluaran/dokumen), database (penyimpanan/sistem), orang (peran/pihak)'
              },
              kelompok: { type: 'string', description: 'Opsional: id kelompok (mis. bagian/divisi/lajur)' },
              keterangan: { type: 'string', description: 'Opsional: penjelasan yang muncul saat simpul diklik' }
            },
            required: ['id', 'label']
          }
        },
        hubungan: {
          type: 'array',
          description: 'Panah antar simpul — pakai ID simpul, bukan labelnya',
          items: {
            type: 'object',
            properties: {
              dari: { type: 'string' },
              ke: { type: 'string' },
              label: { type: 'string', description: 'Optional, short (e.g. "yes", "no", "if it fails")' },
              putus: { type: 'boolean', description: 'true = garis putus-putus (alur opsional/tidak langsung)' }
            },
            required: ['dari', 'ke']
          }
        },
        kelompok: {
          type: 'array',
          description: 'Opsional: pengelompokan simpul (bagian, divisi, lajur)',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, label: { type: 'string' } },
            required: ['id', 'label']
          }
        }
      },
      required: ['path', 'judul', 'simpul', 'hubungan']
    },
    tier: 'write',
    timeoutMs: 60_000,
    summarize: (a) => `Create diagram ${a.path}`,
    execute: async (args, ctx) => {
      const mentah = typeof args.path === 'string' ? args.path.trim() : ''
      if (!mentah) throw new ToolError('argumen "path" wajib — berkas .html tujuan')
      const file = resolveInBoundary(mentah, ctx.allowedDirs)
      jalankan(() => pastikanBerkasHtml(file))
      const filePng = file.replace(/\.html?$/i, '.png')
      if (existsSync(file) || existsSync(filePng)) {
        throw new ToolError('berkas sudah ada — pilih nama lain, atau hapus/pindahkan dulu berkas lama')
      }
      const spek = jalankan(() => periksaSpek(args))
      const tata = tataLetak(spek)
      const svg = keSvg(spek, tata)

      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, keHtml(spek, svg, new Date()), 'utf8')

      const lebar = Math.max(tata.lebar, 420)
      const tinggi = tata.tinggi + TINGGI_JUDUL
      const png = await svgKePng(svg, lebar, tinggi, spek.judul)
      if (png) writeFileSync(filePng, png)

      return JSON.stringify({
        written: file,
        pratinjau: png ? filePng : null,
        jumlahSimpul: spek.simpul.length,
        jumlahHubungan: spek.hubungan.length,
        jumlahKelompok: spek.kelompok.length,
        ukuranHtml: statSync(file).size,
        catatanHasil:
          `Diagram interaktif tersimpan di ${file} — buka di browser untuk menggeser, zoom, klik simpul, ` +
          'dan mengunduh PNG. ' +
          (png
            ? `Versi gambar untuk PPT/Word: ${filePng}. `
            : 'Versi PNG GAGAL dibuat — katakan itu ke user; berkas HTML tetap bisa dipakai dan punya tombol "Unduh PNG". ') +
          'Tata letak diatur otomatis. Sebutkan kedua berkas ke user, dan minta ia memeriksa isinya — ' +
          'diagram hanya sebenar keterangan yang menjadi dasarnya.'
      })
    }
  }
]
