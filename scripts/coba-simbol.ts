/**
 * BUKTI pencarian definisi kode (tree-sitter) di runtime Electron.
 *
 * Kenapa di Electron: `app.getAppPath()` dan `process.resourcesPath` yang
 * dipakai untuk menemukan grammar `.wasm` hanya ada di sana — dan pelajaran
 * font company serif font (21 Agu 2026) menunjukkan pencarian folder semacam ini gagal
 * dengan cara yang SUNYI: fiturnya tidak error, cuma diam-diam tidak jalan.
 *
 * Diuji pada kode AIRA SENDIRI, bukan berkas contoh. Berkas contoh yang rapi
 * membuktikan parser jalan; kode sungguhan membuktikan ia berguna.
 *
 * Jalankan: npm run coba:simbol
 */
import { app } from 'electron'
import { join } from 'node:path'

process.env.AIRA_LOG_SILENT = '1'

const masalah: string[] = []
let no = 0

function periksa(judul: string, lolos: boolean, detail: string): void {
  no++
  console.log(`${lolos ? 'OK   ' : 'GAGAL'} ${no}. ${judul}`)
  console.log(`        ${detail}`)
  if (!lolos) masalah.push(`${judul} — ${detail}`)
}

app.on('window-all-closed', () => {})

async function jalan(): Promise<void> {
  const { folderGrammar, treeSitterTersedia, bacaSimbol, BAHASA_DIDUKUNG } = await import(
    '../src/main/code/tree'
  )
  const { simbolTools } = await import('../src/main/tools/simbol-tools')
  const akar = process.cwd()

  periksa('grammar tree-sitter ditemukan', folderGrammar() !== null, String(folderGrammar()))
  periksa('runtime tree-sitter siap dipakai', await treeSitterTersedia(),
    `${BAHASA_DIDUKUNG.length} bahasa dibundel: ${BAHASA_DIDUKUNG.join(', ')}`)
  if (!(await treeSitterTersedia())) return

  // 1. Berkas TypeScript sungguhan.
  const ts = join(akar, 'src', 'main', 'lab', 'rules.ts')
  const hasilTs = await bacaSimbol(ts)
  periksa('TypeScript terbaca sebagai pohon sintaks', hasilTs.terbaca && hasilTs.simbol.length > 0,
    `${hasilTs.simbol.length} simbol; contoh: ${hasilTs.simbol.slice(0, 4).map((s) => `${s.nama}[${s.jenis}]:${s.baris}`).join(' · ')}`)

  // ⚠️ Bentuk yang paling sering dipakai di project ini: fungsi yang ditulis
  // sebagai `export function` DAN sebagai const arrow. Kalau salah satunya
  // luput, sebagian besar kode jadi tak terlihat.
  const adaFungsi = hasilTs.simbol.some((s) => s.nama === 'kolomBoleh' && s.jenis === 'fungsi')
  periksa('fungsi ber-`export function` tertangkap', adaFungsi,
    adaFungsi ? 'kolomBoleh ditemukan' : 'kolomBoleh TIDAK ditemukan')

  // 2. TSX — grammar BERBEDA dari typescript; memakai yang salah membuat
  //    seluruh berkas React menghasilkan nol simbol tanpa error.
  const tsx = join(akar, 'src', 'renderer', 'src', 'views', 'LabHome.tsx')
  const hasilTsx = await bacaSimbol(tsx)
  periksa('TSX dibaca dengan grammar tsx, bukan typescript',
    hasilTsx.terbaca && hasilTsx.simbol.length > 0,
    `${hasilTsx.simbol.length} simbol; contoh: ${hasilTsx.simbol.slice(0, 3).map((s) => s.nama).join(' · ')}`)

  // 3. Metode di dalam kelas membawa nama induknya.
  const kelas = await bacaSimbol(join(akar, 'src', 'main', 'llm', 'openai-compat.ts'))
  const metode = kelas.simbol.filter((s) => s.jenis === 'metode' && s.induk)
  periksa('metode membawa nama kelas induknya', metode.length > 0,
    metode.slice(0, 3).map((m) => `${m.induk}.${m.nama}`).join(' · ') || 'tidak ada metode ber-induk')

  // 4. Tool: mencari definisi yang SUDAH DIKETAHUI ada.
  const tool = simbolTools[0]
  const cari = JSON.parse(
    await tool.execute(
      { path: join(akar, 'src', 'main'), nama: 'catatanDaftar' },
      { allowedDirs: [akar] }
    )
  )
  const tepat = (cari.hasil ?? []).filter((h: { nama: string }) => h.nama === 'catatanDaftar')
  periksa('definisi yang dicari ketemu, dan yang PERSIS cocok didahulukan',
    tepat.length > 0 && cari.hasil[0]?.nama === 'catatanDaftar',
    tepat.map((h: { berkas: string; baris: number }) => `${h.berkas}:${h.baris}`).join(' · '))

  // ⚠️ Inti nilainya: definisi jauh lebih sedikit daripada penyebutan.
  const { readFileSync, readdirSync, statSync } = await import('node:fs')
  let sebutan = 0
  const sapu = (dir: string, dalam: number): void => {
    if (dalam > 6) return
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue
        sapu(p, dalam + 1)
      } else if (/\.tsx?$/.test(e.name) && statSync(p).size < 2_000_000) {
        sebutan += (readFileSync(p, 'utf-8').match(/catatanDaftar/g) ?? []).length
      }
    }
  }
  sapu(join(akar, 'src', 'main'), 0)
  periksa('definisi jauh lebih sedikit daripada penyebutan (inti kegunaannya)',
    tepat.length > 0 && sebutan > tepat.length,
    `grep menemukan ${sebutan} penyebutan; cari_simbol menemukan ${tepat.length} definisi`)

  // 5. Nama yang tidak ada harus menghasilkan catatan yang MENGARAHKAN,
  //    bukan hasil kosong yang membuat model menyimpulkan "tidak ada".
  const kosong = JSON.parse(
    await tool.execute(
      { path: join(akar, 'src', 'main', 'lab'), nama: 'FungsiYangTidakPernahAda' },
      { allowedDirs: [akar] }
    )
  )
  periksa('nama yang tidak ada dijawab dengan arahan, bukan kekosongan',
    kosong.hasil.length === 0 && /search_code/.test(String(kosong.catatan)),
    String(kosong.catatan).slice(0, 130))

  // 6. Daftar seluruh definisi dalam satu berkas.
  const daftar = JSON.parse(
    await tool.execute({ path: ts }, { allowedDirs: [akar] })
  )
  periksa('bisa mendaftar SEMUA definisi di satu berkas', daftar.hasil.length > 3,
    `${daftar.hasil.length} definisi di lab/rules.ts`)

  // 7. Berkas yang tidak terbaca WAJIB disebut, bukan didiamkan.
  periksa('catatan hasil tidak pernah kosong', String(daftar.catatan).length > 40,
    String(daftar.catatan).slice(0, 120))
}

app.whenReady().then(async () => {
  try {
    await jalan()
  } catch (err: unknown) {
    masalah.push(`skrip berhenti: ${(err as Error)?.message ?? String(err)}`)
    console.error(err)
  }
  console.log('')
  if (masalah.length) {
    console.log(`ADA ${masalah.length} MASALAH:`)
    for (const m of masalah) console.log(`  - ${m}`)
  } else {
    console.log(`Semua ${no} pemeriksaan lolos.`)
  }
  app.exit(masalah.length ? 1 : 0)
})
