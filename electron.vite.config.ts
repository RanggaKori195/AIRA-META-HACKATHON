import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { loadEnv } from 'vite'

// Kredensial default dibaca dari .env saat build lalu ditanam ke bundle main process.
// Tujuannya: user tidak perlu memasukkan API key sama sekali. Rotasi key cukup
// mengubah .env lalu build ulang — kode tidak perlu disentuh.

/**
 * Pengerasan terhadap pembacaan ulang kode (reverse engineering).
 *
 * ⚠️ Ini MENAIKKAN BIAYA membaca, bukan membuatnya mustahil. Isi `app.asar` selalu
 * bisa diekstrak — `asar` adalah format arsip, bukan enkripsi. Yang berubah: dari
 * "buka lalu baca kode sumber lengkap dengan komentar berbahasa Indonesia yang
 * menjelaskan setiap aturan bisnis" menjadi "baca JavaScript satu baris tanpa nama
 * yang berarti".
 *
 * Yang TIDAK diselesaikan di sini: kredensial. Aplikasi wajib memegangnya dalam
 * bentuk polos saat runtime untuk bisa connect, jadi seberapa pun kode diacak,
 * connection string tetap bisa diambil — bahkan tanpa menyentuh kode, cukup dengan
 * memantau koneksi keluar. Jawabannya bukan obfuscation, melainkan user database
 * berhak minimal (lihat HANDOFF §10).
 */
const HARDEN = {
  // Membuang komentar dan mengacak nama variabel/fungsi lokal. Komentar di project
  // ini memuat aturan bisnis yang tidak seharusnya dibaca dari luar (dasar pengakuan
  // baris, ambang pelanggan berhenti, cara harga special price dipilih).
  minify: 'esbuild' as const,
  // Sourcemap akan MENGEMBALIKAN nama asli dan komentar utuh — memasangnya di
  // produksi membatalkan seluruh minify di atas.
  sourcemap: false as const
}

/** `legalComments: 'none'` membuang juga komentar @license/@preserve, yang kalau
 *  dibiarkan menyisakan nama modul dan versinya di dalam bundle. */
const ESBUILD = { legalComments: 'none' as const }

export default defineConfig(({ mode }) => {
  // .env + .env.local (ELEVENLABS_API_KEY from the ElevenLabs onboarding). Prefix '' = every variable; they reach
  // the main process only, through `define` below — never the renderer.
  const env = loadEnv(mode, process.cwd(), '')
  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      build: HARDEN,
      esbuild: ESBUILD,
      define: {
        __BUNDLED_API_KEY__: JSON.stringify(env.AIRA_API_KEY ?? ''),
        __BUNDLED_ENDPOINT__: JSON.stringify(env.AIRA_ENDPOINT ?? 'https://gateway.internal.example'),
        __BUNDLED_MODEL__: JSON.stringify(env.AIRA_MODEL ?? 'old-think-model'),
        __BUNDLED_YOU_KEY__: JSON.stringify(env.AIRA_YOU_API_KEY ?? ''),
        __BUNDLED_EXA_KEY__: JSON.stringify(env.AIRA_EXA_API_KEY ?? ''),
        __BUNDLED_SALES_DB__: JSON.stringify(env.AIRA_SALES_DB ?? ''),
        __BUNDLED_INNO_DB__: JSON.stringify(env.AIRA_INNO_DB ?? ''),
        // Tabel login menumpang server yang sama dengan data penjualan, tapi diberi
        // variabel sendiri supaya bisa dipindah ke database lain (atau ke user
        // Postgres yang haknya lebih sempit) tanpa menyentuh kode.
        __BUNDLED_LOGIN_DB__: JSON.stringify(env.AIRA_LOGIN_DB ?? env.AIRA_SALES_DB ?? ''),
        // Microsoft 365. Keduanya publik menurut desain OAuth, jadi aman ditanam.
        // Client secret SENGAJA tidak ada — desktop memakai PKCE (lihat m365/auth.ts).
        __BUNDLED_M365_TENANT__: JSON.stringify(env.AIRA_M365_TENANT_ID ?? ''),
        __BUNDLED_M365_CLIENT__: JSON.stringify(env.AIRA_M365_CLIENT_ID ?? ''),
        __BUNDLED_UPDATE_URL__: JSON.stringify(env.AIRA_UPDATE_URL ?? ''),
        // AIRA's voice (ElevenLabs): main process only — set into process.env for the SDK (src/main/suara/tts.ts).
        __BUNDLED_ELEVENLABS_KEY__: JSON.stringify(env.ELEVENLABS_API_KEY ?? ''),
        __BUNDLED_ELEVENLABS_VOICE__: JSON.stringify(env.ELEVENLABS_VOICE_ID ?? '')
      }
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      build: HARDEN,
      esbuild: ESBUILD
    },
    renderer: {
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src'),
          '@shared': resolve('src/shared')
        }
      },
      plugins: [react()],
      build: HARDEN,
      esbuild: ESBUILD
    }
  }
})
