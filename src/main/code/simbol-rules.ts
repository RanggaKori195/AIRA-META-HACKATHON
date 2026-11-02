// Aturan murni untuk pembacaan simbol kode.
//
// Dipisahkan dari `tree.ts` yang memuat WASM & Electron, supaya pemetaan
// ekstensi→bahasa dan jenis node→jenis simbol bisa diuji tanpa memuat apa pun.

/** Jenis simbol yang dikenali. Sengaja sedikit — ini yang dicari orang. */
export type JenisSimbol = 'fungsi' | 'kelas' | 'metode' | 'tipe' | 'konstanta'

export interface Simbol {
  nama: string
  jenis: JenisSimbol
  /** Baris definisi, 1-based (sama dengan yang dilihat orang di editor). */
  baris: number
  /** Nama kelas induk bila simbol ini metode di dalamnya. */
  induk?: string
  /** Tanda tangan singkat untuk ditampilkan. */
  cuplikan: string
}

const EKSTENSI: Record<string, string> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.java': 'java',
  '.go': 'go'
}

/**
 * Bahasa dari nama berkas, atau `null` bila tidak ada grammar-nya.
 *
 * ⚠️ `.tsx` TIDAK boleh dipetakan ke grammar `typescript`. Keduanya grammar
 * yang berbeda; memakai yang salah membuat seluruh berkas React gagal di-parse
 * — dan gagalnya diam, hanya menghasilkan nol simbol.
 */
export function bahasaDari(berkas: string): string | null {
  const titik = berkas.lastIndexOf('.')
  if (titik < 0) return null
  return EKSTENSI[berkas.slice(titik).toLowerCase()] ?? null
}

/**
 * Jenis node tree-sitter yang menandai sebuah DEFINISI, per bahasa.
 *
 * ⚠️ Yang dicatat hanya definisi, bukan pemanggilan. Itu seluruh alasan tool
 * ini ada: grep untuk `hitungTotal` mengembalikan setiap baris yang menyebutnya
 * — puluhan pemanggilan bercampur satu definisi, tanpa cara membedakannya.
 */
const NODE_DEFINISI: Record<string, JenisSimbol> = {
  // TypeScript / JavaScript / TSX
  function_declaration: 'fungsi',
  generator_function_declaration: 'fungsi',
  class_declaration: 'kelas',
  method_definition: 'metode',
  interface_declaration: 'tipe',
  type_alias_declaration: 'tipe',
  enum_declaration: 'tipe',
  abstract_class_declaration: 'kelas',
  // Python
  function_definition: 'fungsi',
  class_definition: 'kelas',
  // Java
  method_declaration: 'metode',
  constructor_declaration: 'metode',
  // Go
  type_declaration: 'tipe',
  method_spec: 'metode'
}

/** Node minimal yang dibutuhkan — sengaja bukan tipe milik web-tree-sitter,
 *  supaya modul ini tetap murni dan bisa diuji tanpa memuat WASM. */
export interface NodeMirip {
  type: string
  startPosition: { row: number }
  text: string
  childForFieldName(nama: string): { text: string } | null
}

/**
 * Nama fungsi yang ditulis sebagai variabel — bentuk yang paling umum di
 * TypeScript modern dan tidak tertangkap `function_declaration`.
 *
 * ⚠️ Tanpa ini, `export const hitungTotal = () => {}` tidak akan pernah muncul
 * sebagai fungsi, dan justru bentuk itulah yang dipakai di hampir seluruh kode
 * project ini. Pemeriksaannya sempit: hanya variabel yang nilainya fungsi —
 * bukan setiap `const`.
 */
function variabelFungsi(node: NodeMirip): string | null {
  if (node.type !== 'variable_declarator' && node.type !== 'public_field_definition') return null
  const nilai = node.childForFieldName('value')
  if (!nilai) return null
  const t = (nilai as { text?: string }).text ?? ''
  const bentuk = t.slice(0, 40)
  if (/^(async\s+)?(\(|function\b)/.test(bentuk) || /^[A-Za-z_$][\w$]*\s*=>/.test(bentuk)) {
    return node.childForFieldName('name')?.text ?? null
  }
  return null
}

/** Baris pertama sebuah definisi, dipangkas — untuk ditampilkan ke user. */
export function cuplikanDari(teks: string, maks = 110): string {
  const baris = teks.split('\n')[0].trim()
  return baris.length > maks ? `${baris.slice(0, maks)}…` : baris
}

/**
 * Mengubah satu node jadi `Simbol`, atau `null` bila node itu bukan definisi.
 */
export function simbolDariNode(
  node: NodeMirip,
  _bahasa: string,
  induk: string | null
): Simbol | null {
  const jenisVar = variabelFungsi(node)
  if (jenisVar) {
    return {
      nama: jenisVar,
      jenis: 'fungsi',
      baris: node.startPosition.row + 1,
      ...(induk ? { induk } : {}),
      cuplikan: cuplikanDari(node.text)
    }
  }

  const jenis = NODE_DEFINISI[node.type]
  if (!jenis) return null
  const nama = node.childForFieldName('name')?.text
  // Fungsi anonim tidak punya nama dan tidak berguna dicari — dilewati diam,
  // karena ia memang bukan sesuatu yang bisa dituju orang.
  if (!nama) return null
  return {
    nama,
    jenis,
    baris: node.startPosition.row + 1,
    ...(induk && jenis === 'metode' ? { induk } : {}),
    cuplikan: cuplikanDari(node.text)
  }
}

/** Apakah nama simbol cocok dengan yang dicari user. */
export function cocok(nama: string, cari: string): boolean {
  if (!cari) return true
  return nama.toLowerCase().includes(cari.toLowerCase())
}

/**
 * Kalimat pertanggungjawaban hasil — TIDAK PERNAH kosong.
 *
 * Pelajaran berulang di project ini: hasil tool yang diam soal apa yang
 * dilewatkan membuat model mengarang. Di sini yang paling berbahaya adalah
 * berkas yang gagal di-parse: tanpa disebut, model menyimpulkan "fungsinya
 * tidak ada" padahal berkasnya cuma tidak sempat dibaca.
 */
export function catatanSimbol(
  ditemukan: number,
  berkasDibaca: number,
  gagal: Array<{ berkas: string; alasan: string }>,
  cari: string
): string {
  const bagian: string[] = []
  if (ditemukan === 0) {
    bagian.push(
      cari
        ? `Tidak ada DEFINISI bernama "${cari}" di ${berkasDibaca} berkas yang terbaca. Nama itu mungkin cuma dipanggil, bukan didefinisikan di sini — pakai search_code untuk mencari pemanggilannya.`
        : `Tidak ada simbol yang terbaca dari ${berkasDibaca} berkas.`
    )
  } else {
    bagian.push(`${ditemukan} definisi ditemukan dari ${berkasDibaca} berkas yang berhasil dibaca.`)
  }
  if (gagal.length > 0) {
    const contoh = gagal.slice(0, 5).map((g) => `${g.berkas} (${g.alasan})`).join('; ')
    bagian.push(
      `⚠️ ${gagal.length} berkas TIDAK terbaca sebagai kode: ${contoh}${gagal.length > 5 ? ' …' : ''}. ` +
        'Jangan menyimpulkan simbolnya tidak ada hanya karena tidak muncul — sebutkan berkas yang tidak terbaca.'
    )
  }
  bagian.push('Yang dikembalikan hanya DEFINISI, bukan pemanggilan.')
  return bagian.join(' ')
}
