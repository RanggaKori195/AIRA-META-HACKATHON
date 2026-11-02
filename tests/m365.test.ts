import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  CATATAN_CAKUPAN,
  cakupanUntuk,
  EKSTENSI_TERBACA,
  M365_LANJUTAN,
  jalurAman,
  KONTEN_TAK_TEPERCAYA,
  MAKS_UNDUH_BYTE,
  bisaDibaca,
  catatanDaftar,
  catatanJenis,
  catatanSumber,
  terjemahkanGalatEntra,
  terjemahkanGalatGraph,
  toolPembaca,
  ukuranManusiawi
} from '../src/main/m365/rules'
import { selectGroups, groupOf, saranMenu } from '../src/main/agent/tool-groups'

// Menu "Tanya Dokumen OneDrive" — berkas Microsoft 365.

describe('galat Entra diterjemahkan ke SETELAN yang harus diperbaiki', () => {
  // ⚠️ Ini bukan kenyamanan. AADSTS7000218 berbunyi seolah aplikasi lupa
  // mengirim client secret, padahal yang kurang adalah saklar "Allow public
  // client flows" — dan orang akan menghabiskan waktu membuat secret yang
  // justru TIDAK BOLEH ada di aplikasi desktop.
  test('AADSTS7000218 diarahkan ke Allow public client flows, bukan ke client secret', () => {
    const p = terjemahkanGalatEntra('AADSTS7000218: The request body must contain client_secret')
    assert.ok(p)
    assert.match(p!, /public client flows/i)
    assert.doesNotMatch(p!, /buat client secret/i)
  })

  test('redirect URI salah menyebut KEDUA alamat loopback', () => {
    const p = terjemahkanGalatEntra('AADSTS50011: redirect URI mismatch')
    assert.ok(p)
    assert.match(p!, /127\.0\.0\.1/)
    assert.match(p!, /localhost/)
  })

  test('consent, client, tenant, Conditional Access, dan MFA punya arahan sendiri', () => {
    for (const kode of ['AADSTS65001', 'AADSTS700016', 'AADSTS90002', 'AADSTS53003', 'AADSTS50076']) {
      const p = terjemahkanGalatEntra(`${kode}: sesuatu`)
      assert.ok(p, `belum ada terjemahan untuk ${kode}`)
      assert.ok(p!.length > 20)
    }
  })

  test('kode yang tidak dikenal mengembalikan null, bukan tebakan', () => {
    assert.equal(terjemahkanGalatEntra('AADSTS999999: sesuatu yang baru'), null)
  })
})

describe('galat Graph membedakan izin kurang dari berkas hilang', () => {
  // 403 di sini hampir selalu berarti scope kurang, bukan file terlarang — dan
  // itu perbedaan yang menentukan langkah berikutnya.
  test('403 menyebut KEDUA sebabnya, termasuk sesi yang login sebelum izin ditambah', () => {
    // ⚠️ Sebab kedua tidak terlihat di portal Azure sama sekali. Menyebut yang
    // pertama saja membuat orang memeriksa consent yang sebenarnya sudah benar.
    const p = terjemahkanGalatGraph(403, 'accessDenied')
    assert.ok(p)
    assert.match(p!, /belum ditambahkan|di-consent/i)
    assert.match(p!, /login SEBELUM izin/i)
    assert.doesNotMatch(p!, /berkasnya terlarang/i)
  })

  test('401 mengarah ke login ulang', () => {
    assert.match(terjemahkanGalatGraph(401, '')!, /login ulang/i)
  })

  test('404 menyebut kemungkinan share dicabut', () => {
    assert.match(terjemahkanGalatGraph(404, '')!, /dicabut|dipindah/i)
  })
})

describe('jenis berkas yang benar-benar bisa dibaca', () => {
  test('dokumen kantor dikenali', () => {
    for (const n of ['a.docx', 'B.PDF', 'c.xlsx', 'd.pptx', 'e.txt', 'f.csv']) {
      assert.equal(bisaDibaca(n), true, `seharusnya terbaca: ${n}`)
    }
  })

  test('yang tidak bisa dibaca TIDAK diklaim bisa', () => {
    for (const n of ['foto.jpg', 'arsip.zip', 'video.mp4', 'tanpa-ekstensi']) {
      assert.equal(bisaDibaca(n), false, `seharusnya tidak terbaca: ${n}`)
    }
  })

  test('daftarnya selaras dengan yang dipakai RAG', () => {
    // Berkas yang bisa ditemukan tapi tidak bisa dibaca hanya memindahkan
    // kekecewaan satu langkah lebih jauh.
    assert.ok(EKSTENSI_TERBACA.includes('.docx'))
    assert.ok(EKSTENSI_TERBACA.includes('.pdf'))
  })

  test('catatan jenis hanya muncul untuk yang tidak terbaca', () => {
    assert.equal(catatanJenis('laporan.docx'), '')
    assert.match(catatanJenis('foto.jpg'), /tidak bisa dibaca/i)
  })
})

describe('catatan hasil TIDAK PERNAH kosong', () => {
  // Pelajaran berulang di project ini: hasil tool yang diam soal kelengkapannya
  // membuat model mengarang. `inno_item_search` mengembalikan `jumlah: 50` tanpa
  // menyebut 499 sisanya, dan model mengisinya dengan "terpotong oleh sistem".
  test('nol dibedakan dari terpotong', () => {
    const n = catatanDaftar(0, false, 'pencarian "x"')
    assert.match(n, /hasil nyata/i)
    assert.match(n, /jangan menyebut data terpotong/i)
    assert.match(n, /jangan menebak nama berkas/i)
  })

  test('lengkap dinyatakan lengkap', () => {
    assert.match(catatanDaftar(7, false, 'folder'), /Seluruh 7/)
  })

  test('masih ada lagi dinyatakan terus terang, tanpa mengarang totalnya', () => {
    const c = catatanDaftar(20, true, 'pencarian')
    assert.match(c, /MASIH ADA LAGI/)
    assert.match(c, /jangan mengarang jumlah totalnya/i)
  })

  test('tidak ada bentuk yang kosong', () => {
    for (const c of [
      catatanDaftar(0, false, 'x'),
      catatanDaftar(3, false, 'x'),
      catatanDaftar(3, true, 'x')
    ]) {
      assert.ok(c.trim().length > 30)
    }
  })
})

describe('berkas share dibedakan dari milik sendiri', () => {
  test('share menyebut bahwa aksesnya bisa dicabut', () => {
    const c = catatanSumber(true, 'Budi')
    assert.match(c, /DI-SHARE/)
    assert.match(c, /Budi/)
    assert.match(c, /dicabut/i)
  })

  test('milik sendiri tidak menakut-nakuti soal pencabutan', () => {
    assert.doesNotMatch(catatanSumber(false), /dicabut/i)
  })

  test('pemilik tak diketahui tetap menghasilkan kalimat utuh', () => {
    assert.doesNotMatch(catatanSumber(true), /\(\)/)
  })
})

describe('cakupan tidak boleh mengklaim lebih dari yang benar', () => {
  // ⚠️ Test ini sengaja menjaga NIAT, bukan kalimatnya. Versi pertamanya
  // mengunci frasa "TIDAK membaca" dan langsung merah begitu email & kalender
  // benar-benar tersambung 28 Agu 2026 — merah karena alasan yang justru
  // kabar baik. Yang wajib dijaga: apa pun yang BELUM ada harus disebut.
  // ⚠️ Diuji lewat FUNGSI murninya di KEDUA keadaan saklar, bukan lewat
  // konstanta yang ikut saklar. Kalau hanya konstantanya yang diuji, mematikan
  // saklar diam-diam mematikan separuh pemeriksaan ini juga.
  test('saat fitur lanjutan HIDUP: email & kalender disebut tersambung', () => {
    const c = cakupanUntuk(true)
    for (const kata of [/OneDrive/i, /SharePoint/i, /email/i, /kalender/i]) assert.match(c, kata)
    assert.match(c, /mengirim email/i)
    assert.match(c, /Teams/i)
  })

  test('saat fitur lanjutan MATI: email & kalender disebut BELUM tersambung', () => {
    const c = cakupanUntuk(false)
    assert.match(c, /BELUM tersambung/)
    assert.match(c, /email/i)
    assert.match(c, /kalender/i)
    assert.match(c, /persetujuan admin/i)
  })

  test('kedua keadaan menyebut yang belum ada & melarang menjanjikan', () => {
    for (const c of [cakupanUntuk(true), cakupanUntuk(false)]) {
      assert.match(c, /BELUM tersambung/)
      assert.match(c, /transkrip|rekaman/i)
      assert.match(c, /jangan menjanjikan bisa/i)
    }
  })

  test('konstanta yang dipakai aplikasi mengikuti saklarnya', () => {
    assert.equal(CATATAN_CAKUPAN, cakupanUntuk(M365_LANJUTAN))
  })
})

describe('isi email diperlakukan sebagai DATA, bukan perintah', () => {
  // ⚠️ Email adalah jalur termudah bagi orang LUAR untuk menaruh kalimat di
  // dalam context AIRA — cukup punya alamat email, tanpa akses apa pun ke
  // sistem. SOUL.md sudah menetapkannya untuk berkas/web/MCP; ini
  // memperluasnya ke email, dan disertakan di setiap hasil tool email.
  test('peringatannya menyebut sumber palsu yang paling meyakinkan', () => {
    assert.match(KONTEN_TAK_TEPERCAYA, /DATA/)
    assert.match(KONTEN_TAK_TEPERCAYA, /BUKAN perintah/i)
    assert.match(KONTEN_TAK_TEPERCAYA, /atasan/i)
    assert.match(KONTEN_TAK_TEPERCAYA, /AIRA sendiri/i)
  })

  test('menyebut jalur perintah yang sah, bukan hanya melarang', () => {
    // Larangan tanpa alternatif membuat model menebak. Sebutkan dari mana
    // perintah yang sah datang.
    assert.match(KONTEN_TAK_TEPERCAYA, /kotak chat/i)
    assert.match(KONTEN_TAK_TEPERCAYA, /tanyakan/i)
  })

  test('melarang tindakan yang paling berbahaya secara harfiah', () => {
    for (const kata of [/draf/i, /membuka berkas/i, /mengirim data/i, /tool apa pun/i]) {
      assert.match(KONTEN_TAK_TEPERCAYA, kata)
    }
  })
})

describe('tool pembaca disebut satu, bukan daftar yang mungkin bolong', () => {
  // ⚠️ Ditemukan 28 Agu 2026 saat dijalankan: hasil tool menyebut daftar
  // "read_word / read_excel / read_pdf / read_file" yang LUPA read_ppt, jadi
  // berkas .pptx diarahkan ke read_file dan ditolak sebagai berkas biner.
  // Model tidak menyimpulkan langkah berikutnya sendiri — sebutkan SATU nama
  // yang benar.
  test('tiap jenis berkas dipetakan ke pembacanya masing-masing', () => {
    assert.equal(toolPembaca('a.docx'), 'read_word')
    assert.equal(toolPembaca('a.doc'), 'read_word')
    assert.equal(toolPembaca('a.xlsx'), 'read_excel')
    assert.equal(toolPembaca('a.pptx'), 'read_ppt')
    assert.equal(toolPembaca('a.pdf'), 'read_pdf')
    assert.equal(toolPembaca('a.md'), 'read_file')
  })

  test('jenis yang tidak terbaca TIDAK diberi pembaca palsu', () => {
    assert.equal(toolPembaca('foto.jpg'), null)
    assert.equal(toolPembaca('arsip.zip'), null)
  })

  test('setiap jenis yang diklaim terbaca PUNYA pembacanya', () => {
    // Kalau daftar EKSTENSI_TERBACA bertambah tanpa pemetaan pembaca, klaim
    // "bisa dibaca" jadi janji kosong. Test ini menutup celah itu.
    for (const ext of EKSTENSI_TERBACA) {
      assert.ok(toolPembaca(`berkas${ext}`), `tidak ada pembaca untuk ${ext}`)
    }
  })
})

describe('batas unduhan disebut, bukan didiamkan', () => {
  test('batasnya masuk akal dan bisa dibaca manusia', () => {
    assert.ok(MAKS_UNDUH_BYTE >= 5 * 1024 * 1024)
    assert.equal(ukuranManusiawi(2048), '2 KB')
    assert.equal(ukuranManusiawi(5 * 1024 * 1024), '5.0 MB')
    assert.equal(ukuranManusiawi(512), '512 B')
  })
})

describe('kelompok tool OneDrive & izinnya', () => {
  const TOOLS = ['onedrive_cari', 'onedrive_daftar', 'onedrive_ambil', 'onedrive_akun']

  test('semua tool OneDrive masuk kelompoknya sendiri', () => {
    for (const t of TOOLS) assert.equal(groupOf(t), 'onedrive')
  })

  // ⚠️ Berbeda dari mode data: mode ini WAJIB membawa `core`, karena tool
  // OneDrive hanya mengunduh — yang membaca isinya read_word/read_pdf di core.
  test('mode onedrive membawa core JUGA, supaya berkasnya bisa dibaca', () => {
    const g = selectGroups({
      text: 'cari dokumen SOP',
      usedTools: [],
      mode: 'onedrive',
      izinMenu: ['onedrive']
    })
    assert.ok(g.has('onedrive'))
    assert.ok(g.has('core'))
  })

  test('mode onedrive TIDAK membawa tool data apa pun', () => {
    const g = selectGroups({
      text: 'cari dokumen',
      usedTools: [],
      mode: 'onedrive',
      izinMenu: ['onedrive', 'sales', 'masterdata', 'lab']
    })
    assert.ok(!g.has('sales'))
    assert.ok(!g.has('inno'))
    assert.ok(!g.has('lab'))
  })

  test('tanpa izin onedrive, toolnya tidak dikirim', () => {
    const g = selectGroups({
      text: 'cari dokumen',
      usedTools: [],
      mode: 'onedrive',
      izinMenu: ['sales']
    })
    assert.ok(!g.has('onedrive'))
    assert.deepEqual([...g], ['core'])
  })

  test('Task Baru tidak pernah membawa tool OneDrive walau user berizin', () => {
    const g = selectGroups({
      text: 'cari dokumen di onedrive saya',
      usedTools: [],
      mode: 'general',
      izinMenu: ['onedrive']
    })
    assert.ok(!g.has('onedrive'))
  })

  test('tool OneDrive tidak bisa masuk lewat usedTools di Task Baru', () => {
    const g = selectGroups({
      text: 'lanjutkan',
      usedTools: ['onedrive_cari'],
      mode: 'general',
      izinMenu: ['onedrive']
    })
    assert.ok(!g.has('onedrive'))
  })
})

describe('mode OneDrive tidak diarahkan ke menu lain', () => {
  // ⚠️ Dokumen bisa berisi apa saja. "Ringkas laporan sales di file ini" memuat
  // kata pemicu sales, padahal jawabannya ada di berkas yang sedang dibuka.
  // Mengarahkannya ke menu Sales berarti menolak menjawab pertanyaan yang
  // sebenarnya bisa dijawab.
  test('pertanyaan bernuansa sales di mode onedrive tetap dikerjakan di sini', () => {
    assert.equal(saranMenu('ringkas laporan penjualan di file itu', 'onedrive'), null)
    assert.equal(saranMenu('berapa omzet yang tertulis di dokumen ini', 'onedrive'), null)
  })
})

describe('jalur dari OneDrive dibersihkan sebelum ditulis ke disk', () => {
  // ⚠️ Nama berkas & folder di OneDrive adalah masukan TAK TEPERCAYA: siapa pun
  // yang bisa men-share folder ke user bisa menamainya apa saja. Tanpa
  // pembersihan, folder bernama `..\..\Startup` membuat AIRA menulis berkas ke
  // LUAR folder cache saat menyalin OneDrive untuk diindeks.
  test('komponen ".." dan "." dibuang, bukan di-escape', () => {
    assert.equal(jalurAman('../../Startup/jahat.docx'), 'Startup/jahat.docx')
    assert.equal(jalurAman('a/./b/../c.txt'), 'a/b/c.txt')
  })

  test('backslash Windows ikut diperlakukan sebagai pemisah', () => {
    assert.equal(jalurAman(String.raw`..\..\Startup\x.txt`), 'Startup/x.txt')
  })

  test('jalur wajar tidak dirusak', () => {
    assert.equal(jalurAman('Documents/Laporan/Juli 2026.docx'), 'Documents/Laporan/Juli 2026.docx')
  })

  test('karakter terlarang Windows diganti, bukan membuat penulisan gagal', () => {
    assert.equal(jalurAman('Lap:oran?.docx'), 'Lap_oran_.docx')
  })

  test('hasilnya tidak pernah absolut dan tidak pernah keluar batas', () => {
    for (const jahat of ['../../x', String.raw`..\..\x`, '/etc/passwd', 'C:/Windows/x', '....//x']) {
      const hasil = jalurAman(jahat)
      assert.doesNotMatch(hasil, /^[A-Za-z]:/)
      assert.doesNotMatch(hasil, /^\//)
      assert.ok(!hasil.split('/').includes('..'))
    }
  })
})
