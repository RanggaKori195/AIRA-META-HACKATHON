import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { app } from 'electron'
import { logger } from '../logger'
import { bahasaDari, simbolDariNode, type Simbol } from './simbol-rules'

// Pembacaan kode berbasis POHON SINTAKS (tree-sitter), bukan regex.
//
// Bedanya nyata pada pertanyaan yang paling sering diajukan orang: "di mana
// fungsi X didefinisikan?". Grep mengembalikan setiap baris yang menyebut X —
// puluhan pemanggilan, satu definisi, tercampur tanpa cara membedakannya.
// Tree-sitter tahu mana yang DEFINISI.
//
// ⚠️ WASM, BUKAN native module. Ini syarat masuk: native module menabrak
// pipeline bytenode/electron-builder yang sudah jadi alasan Whisper-GPU dan
// Docker ditolak (§5b). Berjalan di WebAssembly, jadi tidak perlu dikompilasi
// ulang per versi Electron dan tidak ikut rusak saat Electron dinaikkan.
//
// ⚠️ Runtime DAN grammar diambil dari SATU paket (`@vscode/tree-sitter-wasm`),
// dan itu keputusan yang dibayar sekali. Percobaan pertama memasangkan runtime
// `web-tree-sitter@0.27` dengan grammar `tree-sitter-wasms@0.1.13` yang dibangun
// memakai tree-sitter 0.20 — ABI-nya tidak cocok, dan `Language.load` gagal
// dengan `Error` BERPESAN KOSONG. Tidak ada satu pun petunjuk bahwa masalahnya
// versi. Memakai paket yang runtime & grammar-nya sudah sepasang (paket yang
// dipakai VS Code sendiri) menghilangkan seluruh kelas kegagalan itu.
// Konsekuensinya: JANGAN menaikkan salah satunya sendirian.

/** Bahasa yang grammar-nya ikut dibundel. Menambah = salin .wasm ke resources. */
export const BAHASA_DIDUKUNG = [
  'typescript',
  'tsx',
  'javascript',
  'python',
  'java',
  'go'
] as const

export type BahasaKode = (typeof BAHASA_DIDUKUNG)[number]

/**
 * Tempat berkas `.wasm` mungkin berada.
 *
 * ⚠️ Daftarnya panjang dengan sengaja, dan alasannya sama persis dengan
 * `folderFont()`: `app.getAppPath()` mengembalikan hal yang BERBEDA tergantung
 * cara proses dijalankan — dari `scripts/` ia mengembalikan folder `scripts`
 * sendiri. Kalau kandidatnya cuma satu, kegagalannya sunyi: tool tetap jalan,
 * hanya jatuh ke grep tanpa ada yang tahu kenapa.
 */
function kandidatDir(): string[] {
  const appPath = (() => {
    try {
      return app.getAppPath()
    } catch {
      return ''
    }
  })()
  const jangkar = [appPath, join(appPath, '..'), process.cwd(), join(__dirname, '..', '..')]
  const dir: string[] = [join(process.resourcesPath ?? '', 'tree-sitter')]
  for (const j of jangkar) {
    if (!j) continue
    dir.push(join(j, 'resources', 'tree-sitter'))
    dir.push(join(j, 'node_modules', '@vscode', 'tree-sitter-wasm', 'wasm'))
  }
  return [...new Set(dir)]
}

export function folderGrammar(): string | null {
  for (const dir of kandidatDir()) {
    if (existsSync(join(dir, 'tree-sitter-typescript.wasm')) && existsSync(join(dir, 'tree-sitter.js'))) {
      return dir
    }
  }
  return null
}

// Parser & grammar dimuat sekali lalu dipakai seumur aplikasi. Memuat ulang
// WASM per panggilan menghabiskan ratusan milidetik tanpa manfaat apa pun.
let siap: Promise<boolean> | null = null
/* eslint-disable @typescript-eslint/no-explicit-any */
let Parser: any = null
let Language: any = null
const grammar = new Map<BahasaKode, unknown>()

async function pastikanSiap(): Promise<boolean> {
  if (!siap) {
    siap = (async () => {
      const dir = folderGrammar()
      if (!dir) {
        logger().warn(
          { dicari: kandidatDir() },
          'grammar tree-sitter tidak ditemukan — pencarian simbol tidak tersedia'
        )
        return false
      }
      try {
        // Dimuat dari BERKAS, bukan lewat `import` nama paket: di aplikasi
        // terpasang berkasnya ada di `resources/`, di luar app.asar.
        const muat = createRequire(__filename)
        const mod = muat(join(dir, 'tree-sitter.js'))
        Parser = mod.Parser
        Language = mod.Language
        // Runtime WASM-nya berkas terpisah; letaknya diberi tahu eksplisit
        // karena resolusi bawaan mengandaikan konteks browser.
        const inti = join(dir, 'tree-sitter.wasm')
        await Parser.init({ locateFile: (): string => inti })
        return true
      } catch (err) {
        logger().warn({ err: String(err) }, 'tree-sitter gagal disiapkan')
        return false
      }
    })()
  }
  return siap
}

async function muatBahasa(bahasa: BahasaKode): Promise<unknown | null> {
  if (grammar.has(bahasa)) return grammar.get(bahasa)
  if (!(await pastikanSiap()) || !Language) return null
  const dir = folderGrammar()
  if (!dir) return null
  const berkas = join(dir, `tree-sitter-${bahasa}.wasm`)
  if (!existsSync(berkas)) {
    logger().warn({ bahasa, berkas }, 'grammar bahasa ini tidak ikut dibundel')
    return null
  }
  try {
    const lang = await Language.load(berkas)
    grammar.set(bahasa, lang)
    return lang
  } catch (err) {
    logger().warn({ bahasa, err: String(err) }, 'grammar gagal dimuat')
    return null
  }
}

/** Apakah pembacaan berbasis pohon sintaks bisa dipakai sama sekali. */
export async function treeSitterTersedia(): Promise<boolean> {
  return pastikanSiap()
}

export interface HasilBaca {
  simbol: Simbol[]
  /** `false` bila berkas ini tidak bisa dibaca sebagai pohon sintaks. */
  terbaca: boolean
  alasan?: string
}

/** Batas ukuran berkas yang di-parse. Berkas raksasa biasanya hasil generate. */
const MAKS_BYTE = 2 * 1024 * 1024

/**
 * Membaca satu berkas dan mengembalikan simbol yang DIDEFINISIKAN di dalamnya.
 *
 * ⚠️ Selalu mengembalikan alasan bila gagal — tidak pernah diam. Berkas yang
 * dilewati tanpa keterangan membuat model menyimpulkan "fungsinya tidak ada"
 * padahal berkasnya cuma tidak sempat dibaca.
 */
export async function bacaSimbol(berkas: string): Promise<HasilBaca> {
  const bahasa = bahasaDari(berkas) as BahasaKode | null
  if (!bahasa || !(BAHASA_DIDUKUNG as readonly string[]).includes(bahasa)) {
    return { simbol: [], terbaca: false, alasan: 'jenis berkas ini tidak punya grammar' }
  }
  let isi: string
  try {
    const buf = readFileSync(berkas)
    if (buf.length > MAKS_BYTE) {
      return {
        simbol: [],
        terbaca: false,
        alasan: `berkas ${(buf.length / 1024 / 1024).toFixed(1)} MB melebihi batas parse`
      }
    }
    isi = buf.toString('utf-8')
  } catch {
    return { simbol: [], terbaca: false, alasan: 'berkas tidak bisa dibaca' }
  }

  const lang = await muatBahasa(bahasa)
  if (!lang || !Parser) {
    return { simbol: [], terbaca: false, alasan: 'grammar tidak tersedia di build ini' }
  }

  const parser = new Parser()
  try {
    parser.setLanguage(lang)
    const pohon = parser.parse(isi)
    if (!pohon) return { simbol: [], terbaca: false, alasan: 'berkas gagal di-parse' }
    const simbol: Simbol[] = []
    // Penelusuran iteratif, bukan rekursif: berkas dalam bisa membuat tumpukan
    // panggilan meledak, dan crash main process jauh lebih mahal daripada
    // hasil pencarian yang kurang lengkap.
    const antre: Array<{ node: any; induk: string | null }> = [
      { node: pohon.rootNode, induk: null }
    ]
    while (antre.length > 0) {
      const { node, induk } = antre.pop() as { node: any; induk: string | null }
      const ketemu = simbolDariNode(node, bahasa, induk)
      if (ketemu) simbol.push(ketemu)
      const indukBaru = ketemu && ketemu.jenis === 'kelas' ? ketemu.nama : induk
      for (let i = 0; i < node.namedChildCount; i++) {
        const anak = node.namedChild(i)
        if (anak) antre.push({ node: anak, induk: indukBaru })
      }
    }
    simbol.sort((a, b) => a.baris - b.baris)
    return { simbol, terbaca: true }
  } catch (err) {
    return { simbol: [], terbaca: false, alasan: `gagal di-parse: ${String(err).slice(0, 80)}` }
  } finally {
    parser.delete()
  }
}

export type { Simbol }
