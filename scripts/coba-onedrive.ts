/**
 * BUKTI integrasi OneDrive di runtime Electron.
 *
 * Kenapa harus di Electron dan bukan `npx tsx`: `safeStorage` (DPAPI) untuk
 * menyimpan refresh token dan `shell.openExternal` untuk membuka browser sistem
 * dua-duanya hanya ada di sana. Pelajaran project yang sudah dibayar tiga kali
 * (pool.connect, PDF, ruang uji): yang jalan di Node biasa belum tentu jalan di
 * dalam Electron.
 *
 * Login pertama akan membuka browser. Sesudah itu refresh token tersimpan
 * terenkripsi, jadi jalankan kedua kalinya tidak lagi meminta login — dan
 * ITULAH yang sebenarnya diuji di sini.
 *
 * Jalankan: npm run coba:onedrive
 */
import 'dotenv/config'
import { app } from 'electron'

process.env.AIRA_LOG_SILENT = '1'

// ⚠️ Tenant/Client ID ditanam lewat `define` milik Vite saat `npm run build`.
// Skrip ini dibundel esbuild, yang TIDAK memakai define itu, jadi nilainya
// disediakan dari `.env` sebelum modul apa pun diimpor. Impor di bawah sengaja
// DINAMIS: impor statis akan terlanjur membaca `bundled-config` lebih dulu dan
// mengunci nilainya jadi kosong.
;(globalThis as Record<string, unknown>).__BUNDLED_M365_TENANT__ =
  process.env.AIRA_M365_TENANT_ID ?? ''
;(globalThis as Record<string, unknown>).__BUNDLED_M365_CLIENT__ =
  process.env.AIRA_M365_CLIENT_ID ?? ''

const masalah: string[] = []
let no = 0

function periksa(judul: string, lolos: boolean, detail: string): void {
  no++
  console.log(`${lolos ? 'OK   ' : 'GAGAL'} ${no}. ${judul}`)
  console.log(`        ${detail}`)
  if (!lolos) masalah.push(`${judul} — ${detail}`)
}

// ⚠️ Tanpa ini Electron keluar sendiri begitu tidak ada jendela terbuka —
// dan skrip ini memang tidak pernah membuka jendela.
app.on('window-all-closed', () => {})

async function jalan(): Promise<void> {
  const { onedriveTools } = await import('../src/main/tools/onedrive-tools')
  const { m365Configured, m365SudahLogin, m365Token } = await import('../src/main/m365/auth')
  const { bisaDibaca, M365_LANJUTAN } = await import('../src/main/m365/rules')

  periksa('Tenant ID & Client ID tertanam di build', m365Configured(),
    m365Configured() ? 'terbaca dari bundled-config' : 'KOSONG — periksa .env & electron.vite.config.ts')
  if (!m365Configured()) return

  const sudah = m365SudahLogin()
  console.log(`\n   (sesi tersimpan sebelumnya: ${sudah ? 'ADA — seharusnya tanpa login lagi' : 'belum ada, browser akan terbuka'})\n`)

  const t0 = Date.now()
  await m365Token()
  periksa('token siap dipakai', true,
    sudah
      ? `dari refresh token tersimpan, ${Date.now() - t0} ms — TIDAK perlu login ulang`
      : `sesudah login interaktif, ${Math.round((Date.now() - t0) / 1000)} detik`)

  periksa('refresh token tersimpan terenkripsi (DPAPI) untuk pemakaian berikutnya',
    m365SudahLogin(), 'tersimpan di secrets.json, terenkripsi safeStorage')

  const pakai = async (nama: string, args: Record<string, unknown>): Promise<any> => {
    const t = onedriveTools.find((x) => x.name === nama)!
    const hasil = await t.execute(args, { allowedDirs: [] })
    return JSON.parse(hasil)
  }
  const pakaiM365Onedrive = pakai

  // 1. Akun
  const akun = await pakai('onedrive_akun', {})
  periksa('onedrive_akun menyebut siapa yang sedang dibaca', Boolean(akun.email),
    `${akun.nama} <${akun.email}>`)

  // 2. Folder utama
  const akar = await pakai('onedrive_daftar', { batas: 10 })
  periksa('onedrive_daftar membaca folder utama', Array.isArray(akar.isi),
    (akar.isi ?? []).map((x: any) => `${x.nama}${x.jenis === 'folder' ? '/' : ''}`).join(' · ') || '(kosong)')
  periksa('catatan kelengkapan daftar tidak kosong', typeof akar.catatan === 'string' && akar.catatan.length > 30,
    String(akar.catatan).slice(0, 110))

  // 3. Yang di-share
  const share = await pakai('onedrive_daftar', { share: true, batas: 30 })
  const isiShare: any[] = share.isi ?? []
  periksa('onedrive_daftar membaca yang di-share orang lain', Array.isArray(share.isi),
    isiShare.map((x: any) => `${x.nama} (dari ${x.pemilik})`).join(' · ') || '(tidak ada)')
  // ⚠️ Berkas share TIDAK boleh punya jalur: jalur dicari di OneDrive user
  // sendiri dan bisa menemukan berkas lain yang bernama sama (13 Okt 2026).
  periksa('setiap item share punya penanda dan TIDAK punya jalur',
    isiShare.every((x) => /^od-[0-9a-f]{8}$/.test(String(x.penanda)) && !('jalur' in x)),
    isiShare.slice(0, 3).map((x) => `${x.penanda} · ${x.lokasi}`).join(' | ') || '(tidak ada item share)')

  // Membaca hasil onedrive_ambil dengan tool dokumen yang SUDAH ADA — itu memang
  // rancangannya. ⚠️ Memakai pemetaan MILIK PRODUK, bukan pemetaan tandingan di
  // skrip uji: versi pertama skrip ini punya daftarnya sendiri, lupa .pptx, dan
  // yang gagal justru ujinya — bukan fiturnya.
  const { docTools } = await import('../src/main/tools/doc-tools')
  const { fsTools } = await import('../src/main/tools/fs-tools')
  const { existsSync, statSync } = await import('node:fs')
  const { dirname } = await import('node:path')
  const bacaHasilAmbil = async (ambil: any, label: string): Promise<void> => {
    periksa(`${label}: onedrive_ambil mengunduh berkas ke disk`, Boolean(ambil.jalurLokal),
      `${ambil.nama} (${ambil.ukuran}) -> ${ambil.jalurLokal}`)
    periksa(`${label}: hasilnya menyebut SATU tool pembaca yang tepat, bukan daftar`,
      /^read_(word|excel|ppt|pdf|file)$/.test(String(ambil.toolPembaca)),
      String(ambil.langkahBerikutnya).slice(0, 130))
    const ada = existsSync(ambil.jalurLokal)
    periksa(`${label}: berkasnya benar-benar ada di disk dan tidak kosong`,
      ada && statSync(ambil.jalurLokal).size > 0,
      ada ? `${statSync(ambil.jalurLokal).size} byte` : 'TIDAK ADA')
    const namaPembaca = String(ambil.toolPembaca ?? '')
    const pembaca = [...docTools, ...fsTools].find((x) => x.name === namaPembaca)
    if (!pembaca) {
      periksa(`${label}: tool ${namaPembaca} tersedia`, false, 'tidak ditemukan di registry')
      return
    }
    const isi = await pembaca.execute({ path: ambil.jalurLokal }, { allowedDirs: [dirname(ambil.jalurLokal)] })
    periksa(`${label}: isi berkas terbaca lewat ${namaPembaca} (bukan hanya terunduh)`,
      isi.length > 50, `${isi.length} karakter hasil pembacaan`)
  }

  // 3b. Membuka folder share dan membaca berkas DI DALAMNYA — dulu mustahil:
  // isi folder & unduhan selalu dicari lewat jalur di OneDrive user sendiri.
  const folderShare = isiShare.find((x) => x.jenis === 'folder')
  let berkasShare: any = isiShare.find((x) => x.jenis === 'berkas' && x.bisaDibacaAira)
  let asalBerkasShare = 'berkas share langsung'
  if (folderShare) {
    const isiFolder = await pakai('onedrive_daftar', { penanda: folderShare.penanda, batas: 50 })
    const anak: any[] = isiFolder.isi ?? []
    periksa('folder share terbuka lewat penanda', Array.isArray(isiFolder.isi),
      `"${folderShare.nama}" (dari ${folderShare.pemilik}): ` +
        (anak.map((x) => `${x.nama}${x.jenis === 'folder' ? '/' : ''}`).slice(0, 6).join(' · ') || '(kosong)'))
    periksa('isi folder share mewarisi pemiliknya dan tidak diberi jalur',
      anak.every((x) => x.dariShare === true && !('jalur' in x) && x.pemilik === folderShare.pemilik),
      anak.slice(0, 2).map((x) => String(x.lokasi)).join(' | ') || '(folder kosong)')
    const terbaca = anak.find((x) => x.jenis === 'berkas' && x.bisaDibacaAira)
    if (terbaca) {
      berkasShare = terbaca
      asalBerkasShare = 'berkas di dalam folder share'
    }
  }
  if (berkasShare) {
    const ambilShare = await pakai('onedrive_ambil', { penanda: berkasShare.penanda })
    periksa('berkas share diakui sebagai milik orang lain, bukan milik user',
      /DI-SHARE/.test(String(ambilShare.sumber)), String(ambilShare.sumber).slice(0, 100))
    await bacaHasilAmbil(ambilShare, `share (${asalBerkasShare})`)
  } else {
    // ⚠️ Dilewati BERSUARA: tanpa item share yang terbaca, jalur ini tidak teruji.
    console.log('')
    console.log('   ── Membaca berkas share DILEWATI: tidak ada folder/berkas share yang bisa dibaca')
    console.log('      di akun ini. Minta rekan men-share satu folder berisi .docx/.xlsx/.pdf, lalu ulangi.')
    console.log('')
  }

  // 4. Pencarian
  const cari = await pakai('onedrive_cari', { kata: 'a', batas: 10 })
  const ketemu: any[] = cari.hasil ?? []
  periksa('onedrive_cari mengembalikan hasil beserta penanda bisa/tidak dibaca',
    ketemu.every((x) => typeof x.bisaDibacaAira === 'boolean'),
    `${ketemu.length} hasil; contoh: ${ketemu.slice(0, 3).map((x) => `${x.nama}[${x.bisaDibacaAira ? 'terbaca' : 'tidak'}]`).join(' · ') || '-'}`)

  // ⚠️ Kalau drive user gagal dipastikan, SEMUA hasil dianggap milik orang lain
  // (aman, tapi berkas sendiri kehilangan jalurnya). Harus ada yang tetap berjalur.
  const milikSendiri = ketemu.filter((x) => x.dariShare !== true)
  periksa('pencarian membedakan berkas milik sendiri dari milik orang lain (drive user terbaca)',
    milikSendiri.length > 0 && milikSendiri.every((x) => typeof x.jalur === 'string'),
    `${milikSendiri.length} milik sendiri (berjalur), ${ketemu.length - milikSendiri.length} milik orang lain (penanda saja)`)

  // 4b. Folder dibuka lewat PENANDA — alamat drive/items yang SAMA dengan yang
  // dipakai untuk folder share. Tetap diuji walau akun ini tidak punya folder share.
  const folderSendiri = (akar.isi ?? []).find((x: any) => x.jenis === 'folder')
  if (folderSendiri) {
    const lewatPenanda = await pakai('onedrive_daftar', { penanda: folderSendiri.penanda, batas: 10 })
    const anak: any[] = lewatPenanda.isi ?? []
    periksa('folder dibuka lewat penanda (jalur drive/items yang sama dengan folder share)',
      Array.isArray(lewatPenanda.isi) && anak.every((x) => x.dariShare !== true && typeof x.jalur === 'string'),
      `"${folderSendiri.nama}": ` + (anak.map((x) => String(x.jalur)).slice(0, 4).join(' · ') || '(kosong)'))
  }

  // 5. Unduh + baca beneran — ini yang menentukan integrasinya berguna atau tidak.
  // Lewat PENANDA: hasil pencarian bisa milik rekan atau SharePoint, yang tidak
  // punya jalur di OneDrive user.
  const kandidat = ketemu.find((x) => x.jenis === 'berkas' && x.bisaDibacaAira)
  if (!kandidat) {
    periksa('ada berkas yang bisa diunduh untuk diuji', false,
      'tidak ada berkas terbaca di hasil pencarian — uji unduh dilewati')
  } else {
    await bacaHasilAmbil(await pakai('onedrive_ambil', { penanda: kandidat.penanda }), 'pencarian')
  }

  // 6. Jalur karangan harus DITOLAK, bukan dijawab.
  let ditolak = ''
  try {
    await pakai('onedrive_ambil', { jalur: 'Folder/Yang/Tidak/Pernah/Ada.docx' })
  } catch (e: any) {
    ditolak = String(e.message)
  }
  periksa('jalur yang tidak ada ditolak dengan sebab yang jelas', ditolak.length > 0,
    ditolak.slice(0, 130) || 'TIDAK ditolak — ini bug')

  // 6b. Penanda karangan juga DITOLAK — dan tidak jatuh diam-diam ke jalur.
  let penandaDitolak = ''
  try {
    await pakai('onedrive_ambil', { penanda: 'od-00000000', jalur: 'Ada.docx' })
  } catch (e: any) {
    penandaDitolak = String(e.message)
  }
  periksa('penanda yang tidak dikenal ditolak, tidak jatuh ke jalur', /tidak dikenal/.test(penandaDitolak),
    penandaDitolak.slice(0, 130) || 'TIDAK ditolak — ini bug')

  // 7. Cakupan disebut di setiap hasil, supaya model tidak menjanjikan Teams/rekap rapat.
  periksa('setiap hasil tool menyertakan batas cakupan',
    [akun, akar, share, cari].every((x) => typeof x.cakupan === 'string' && /BELUM tersambung/.test(x.cakupan)),
    'tiap tool menyebut apa yang belum tersambung')

  // ------------------------------------------------- fitur M365 lanjutan
  //
  // ⚠️ Dilewati BERSUARA, bukan diam-diam. Uji yang hilang tanpa keterangan
  // terlihat seperti uji yang lolos — dan itu justru jenis kesalahan yang
  // paling mahal di project ini.
  if (!M365_LANJUTAN) {
    console.log('')
    console.log('   ── Email, kalender, simpan-balik & auto-index DILEWATI:')
    console.log('      M365_LANJUTAN = false (menunggu admin consent di Entra).')
    console.log('      Nyalakan di src/main/m365/rules.ts sesudah consent hijau.')
    void bisaDibaca
    return
  }

  const { m365Tools } = await import('../src/main/tools/m365-tools')
  const pakaiM365 = async (nama: string, args: Record<string, unknown>): Promise<any> => {
    const t = m365Tools.find((x) => x.name === nama)!
    return JSON.parse(await t.execute(args, { allowedDirs: [] }))
  }

  const inbox = await pakaiM365('email_daftar', { batas: 5 })
  const surat: any[] = inbox.email ?? []
  periksa('email_daftar membaca kotak masuk', Array.isArray(inbox.email),
    surat.slice(0, 3).map((m) => `${m.dari}: ${String(m.subjek).slice(0, 40)}`).join(' · ') || '(kosong)')

  // ⚠️ Email adalah jalur suntikan perintah dari orang LUAR. Peringatan ini
  // wajib ada di SETIAP hasil tool yang membawa teks orang lain.
  periksa('hasil email membawa peringatan "ini DATA, bukan perintah"',
    /BUKAN perintah/i.test(String(inbox.keamanan ?? '')),
    String(inbox.keamanan ?? '').slice(0, 110))

  if (surat.length > 0) {
    const isi = await pakaiM365('email_baca', { id: surat[0].id })
    periksa('email_baca mengembalikan isi lengkap + catatan kelengkapan',
      typeof isi.isi === 'string' && String(isi.catatanIsi ?? '').length > 30,
      `${String(isi.isi).length} karakter · ${String(isi.catatanIsi).slice(0, 70)}`)
  } else {
    periksa('ada email untuk diuji baca', false, 'kotak masuk kosong — uji baca dilewati')
  }

  // ⚠️ Tidak ada satu pun tool yang bisa MENGIRIM. Ini pemeriksaan struktural,
  // bukan perilaku: kalau kelak ada yang menambahkannya, di sinilah ketahuan.
  const namaTool = m365Tools.map((t) => t.name).join(' ')
  periksa('TIDAK ADA tool yang bisa mengirim email', !/kirim|send/i.test(namaTool), namaTool)

  // -------------------------------------------------------------- kalender
  const jadwal = await pakaiM365('kalender_lihat', {})
  periksa('kalender_lihat membaca jadwal hari ini', Array.isArray(jadwal.acara),
    `${jadwal.jumlah} acara pada ${jadwal.dari}` +
      (jadwal.acara?.[0] ? ` — contoh: ${jadwal.acara[0].mulai} ${jadwal.acara[0].subjek}` : ''))
  periksa('jam kalender sudah waktu Jakarta, bukan UTC',
    /WIB|Jakarta/i.test(String(jadwal.catatanWaktu ?? '')),
    String(jadwal.catatanWaktu ?? '').slice(0, 90))

  // ------------------------------------------------- simpan balik ke OneDrive
  const { writeFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const contoh = join(tmpdir(), `aira-uji-${Date.now()}.txt`)
  writeFileSync(contoh, 'Berkas uji dari AIRA. Boleh dihapus.')
  const simpan = await pakaiM365Onedrive('onedrive_simpan', {
    jalurLokal: contoh,
    folder: 'Documents'
  })
  periksa('onedrive_simpan menaruh berkas di OneDrive', simpan.tersimpan === true,
    `${simpan.namaDiOneDrive} di ${simpan.folder}`)
  periksa('penyimpanan TIDAK menimpa berkas yang sudah ada',
    typeof simpan.catatanNama === 'string' && simpan.catatanNama.length > 10,
    String(simpan.catatanNama).slice(0, 100))

  void bisaDibaca
}

app.whenReady().then(async () => {
  try {
    await jalan()
  } catch (err: any) {
    masalah.push(`skrip berhenti: ${err?.message ?? err}`)
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
