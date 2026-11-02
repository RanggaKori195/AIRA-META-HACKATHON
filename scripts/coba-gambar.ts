// Bukti bahwa pembuatan GAMBAR (old-image-model) benar-benar bekerja — dijalankan di
// runtime ELECTRON, sama seperti aplikasinya.
//
// Jalankan:  npm run coba:gambar      (butuh jaringan the company/VPN)
//
// Kenapa ada: unit test hanya mengunci aturan murni (ukuran sah, magic byte,
// kalimat catatan). Yang TIDAK bisa dibuktikan unit test:
//   1. gateway memang mengembalikan PNG yang sah, bukan JSON galat;
//   2. `kecilkanPng` (nativeImage) benar-benar memperkecil — ia hanya ada di
//      Electron, tidak bisa dijalankan dari `npx tsx`;
//   3. ilustrasi benar-benar TERTANAM di dalam .pptx sebagai media PNG;
//   4. deck TANPA ilustrasi membawa kalimat TAWARAN ke model — bagian yang
//      diminta user: AIRA menawarkan, bukan memutuskan sendiri.
import 'dotenv/config'

process.env.AIRA_LOG_SILENT = '1'


import { app } from 'electron'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import JSZip from 'jszip'
import { buatGambar, kecilkanPng, pakaiKunciUji, siapkanUnggahan, ubahGambar } from '../src/main/gambar/omni'
import { nativeImage } from 'electron'
import { adalahPng, dimensiPng, TAWARKAN_ILUSTRASI } from '../src/main/gambar/rules'
import { tulisPresentasi, type SlideSpec } from '../src/main/ppt/render'
import { getTool } from '../src/main/tools/registry'

let gagal = 0
function cek(nama: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'OK   ' : 'GAGAL'} ${nama}${detail ? ' — ' + detail : ''}`)
  if (!ok) gagal++
}

async function main(): Promise<void> {
  // Kredensial dari `.env` — skrip ini tidak melewati build yang menanamnya.
  pakaiKunciUji(
    process.env.AIRA_API_KEY ?? '',
    process.env.AIRA_ENDPOINT ?? 'https://api.meta.ai'
  )
  const dir = mkdtempSync(join(tmpdir(), 'aira-gambar-'))

  // 1. Gambar kecil: bukti jalur dasar ke gateway.
  const t0 = Date.now()
  const kecil = await buatGambar({
    prompt: 'Ikon sederhana tabung reaksi laboratorium, gaya flat, hijau tosca, latar putih',
    ukuran: '256x256'
  })
  cek('gateway mengembalikan gambar', kecil.length === 1, `${Date.now() - t0} ms`)
  cek('hasilnya PNG sungguhan (magic byte)', adalahPng(kecil[0]))
  cek(
    // Muse Image picks its own resolution (256 asked -> 1600 returned); only the aspect ratio is kept.
    'square request gives a square image',
    dimensiPng(kecil[0])?.lebar === dimensiPng(kecil[0])?.tinggi,
    JSON.stringify(dimensiPng(kecil[0]))
  )

  // 2. Perkecil: hanya bisa diuji di Electron (nativeImage).
  const besar = await buatGambar({
    prompt: 'Ilustrasi sederhana mikroskop di atas meja lab, gaya flat, hijau tosca',
    ukuran: '1024x1024'
  })
  const diperkecil = kecilkanPng(besar[0], 900)
  const dim = dimensiPng(diperkecil)
  cek('gambar 1024 diperkecil jadi <= 900 px', !!dim && Math.max(dim.lebar, dim.tinggi) <= 900,
    `${dim?.lebar}x${dim?.tinggi}`)
  cek('hasil perkecilan masih PNG sah', adalahPng(diperkecil))
  cek(
    'berkasnya jadi lebih kecil',
    diperkecil.length < besar[0].length,
    `${Math.round(besar[0].length / 1024)} KB -> ${Math.round(diperkecil.length / 1024)} KB`
  )

  // 3. Ubah gambar (images/edits, multipart).
  const asal = join(dir, 'asal.png')
  require('fs').writeFileSync(asal, kecil[0])
  const diubah = await ubahGambar({
    asal,
    prompt: 'Ubah warna cairan di tabung menjadi merah',
    ukuran: '256x256'
  })
  cek('ubah_gambar mengembalikan PNG sah', diubah.length === 1 && adalahPng(diubah[0]))
  cek('hasil ubahan BERBEDA dari aslinya', !diubah[0].equals(kecil[0]))

  // 3b. Unggah gambar dari komputer untuk diubah (layar Gambar, 29 Sep 2026):
  //     JPG lanskap 2000 px -> PNG <= 1536 px berasio lanskap -> diubah gateway.
  const jpg = join(dir, 'foto-user.jpg')
  const lanskap = nativeImage.createFromBuffer(besar[0]).resize({ width: 2000, height: 1200 })
  require('fs').writeFileSync(jpg, lanskap.toJPEG(85))
  const unggahan = siapkanUnggahan(jpg)
  const dimU = dimensiPng(unggahan.png)
  cek('unggahan JPG dijadikan PNG sungguhan (magic byte)', adalahPng(unggahan.png))
  cek('unggahan diperkecil ke <= 1536 px', !!dimU && Math.max(dimU.lebar, dimU.tinggi) <= 1536, `${dimU?.lebar}x${dimU?.tinggi}`)
  cek('rasio lanskap dipetakan ke 1536x1024', unggahan.ukuran === '1536x1024', unggahan.ukuran)
  const pngU = join(dir, 'unggahan.png')
  require('fs').writeFileSync(pngU, unggahan.png)
  const diubahU = await ubahGambar({ asal: pngU, prompt: 'Jadikan gaya kartun dengan latar putih polos', ukuran: '1536x1024' })
  cek('gambar unggahan berhasil diubah gateway (PNG sah)', diubahU.length === 1 && adalahPng(diubahU[0]),
    JSON.stringify(dimensiPng(diubahU[0])))
  let tolak = ''
  try {
    const teks = join(dir, 'bukan-gambar.jpg')
    require('fs').writeFileSync(teks, 'ini bukan gambar')
    siapkanUnggahan(teks)
  } catch (err) {
    tolak = String(err)
  }
  cek('berkas bukan gambar DITOLAK dengan pesan jelas', /tidak bisa dibaca sebagai gambar/.test(tolak), tolak.slice(0, 80))

  // 4. Ilustrasi benar-benar tertanam di dalam .pptx.
  const deck = join(dir, 'berilustrasi.pptx')
  const spec: SlideSpec[] = [
    { layout: 'sampul', judul: 'Uji ilustrasi', subjudul: 'coba:gambar' },
    {
      layout: 'gambar',
      judul: 'Ilustrasi laboratorium',
      gambar: '(tidak dipakai — png sudah diisi)',
      keterangan: 'Ilustrasi dibuat AI',
      png: diperkecil
    },
    { layout: 'penutup' }
  ]
  const hasil = await tulisPresentasi(spec, deck, { judulDokumen: 'Uji ilustrasi' })
  const zip = await JSZip.loadAsync(readFileSync(deck))
  const media = Object.keys(zip.files).filter((f) => f.startsWith('ppt/media/'))
  let pngSah = 0
  for (const m of media) {
    const buf = Buffer.from(await zip.files[m].async('uint8array'))
    if (m.toLowerCase().endsWith('.png') && adalahPng(buf)) pngSah++
  }
  cek('deck berisi 3 slide', hasil.slides === 3, String(hasil.slides))
  cek('ada berkas media PNG sah di dalam .pptx', pngSah >= 1, `${pngSah} dari ${media.length} media`)
  const slide2 = await zip.files['ppt/slides/slide2.xml'].async('text')
  cek('slide ilustrasi memuat gambar (a:blip)', slide2.includes('<a:blip'))
  cek(
    'catatan hasil menyatakan ilustrasi BUATAN AI',
    hasil.catatan.some((c) => c.includes('ILUSTRASI BUATAN AIRA')),
    hasil.catatan.find((c) => c.includes('ILUSTRASI')) ?? '(tidak ada)'
  )

  // 5. Deck TANPA ilustrasi WAJIB membawa kalimat tawaran ke model.
  const polos = join(dir, 'polos.pptx')
  const tool = getTool('write_ppt')
  const keluaran = await tool!.execute(
    {
      path: polos,
      title: 'Tanpa ilustrasi',
      slides: [
        { layout: 'sampul', judul: 'Tanpa ilustrasi' },
        { layout: 'poin', judul: 'Isi', poin: ['Satu', 'Dua'] }
      ]
    },
    { allowedDirs: [dir] }
  )
  const j = JSON.parse(keluaran)
  cek('write_ppt tanpa ilustrasi menawarkan gambar ke user', String(j.catatanHasil).includes(TAWARKAN_ILUSTRASI))
  cek('tawaran TIDAK muncul saat deck memang berilustrasi', !hasil.catatan.join(' ').includes('TAWARKAN SEKALI'))

  // 6. Tool buat_gambar menolak nama berkas yang berbohong soal isinya.
  const toolGambar = getTool('buat_gambar')
  let ditolak = ''
  try {
    await toolGambar!.execute({ path: join(dir, 'x.jpg'), prompt: 'apa saja' }, { allowedDirs: [dir] })
  } catch (err) {
    ditolak = err instanceof Error ? err.message : String(err)
  }
  cek('buat_gambar menolak berkas .jpg', /berakhiran \.png/.test(ditolak), ditolak.slice(0, 80))

  console.log(`\nBerkas uji: ${dir}`)
  rmSync(dir, { recursive: true, force: true })
}

app.whenReady().then(() =>
  main()
    .catch((err) => {
      console.error('GAGAL:', err instanceof Error ? (err.stack ?? err.message) : err)
      gagal++
    })
    .finally(() => {
      console.log(gagal ? `\n${gagal} PEMERIKSAAN GAGAL` : '\nSEMUA LOLOS')
      app.exit(gagal ? 1 : 0)
    })
)
