import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DaftarPenanda,
  asingMenurutDrive,
  buatPenanda,
  catatanTakTerjangkau,
  gabungTanpaDobel,
  mungkinFolderDariPencarian,
  refDariInsight,
  pesanNamaKembar,
  pesanPenandaTakDikenal,
  petakan,
  ringkasUntukModel,
  type Mentah
} from '../src/main/m365/berkas'
import { onedriveTools } from '../src/main/tools/onedrive-tools'
import { pisahkanFolderIndeks, samaAtauDiBawah } from '../src/main/rag/folder-rules'

// Berkas & folder yang DI-SHARE orang lain (13 Okt 2026, ditanyakan user).
//
// Sebelum ini AIRA bisa MENDAFTAR apa yang di-share, tapi tidak bisa membuka
// folder share maupun membaca berkasnya: `onedrive_ambil` dan isi folder selalu
// dicari lewat JALUR di OneDrive user sendiri (`/me/drive/root:/…`), sementara
// item share tinggal di drive ORANG LAIN dan hanya bisa dijangkau lewat
// `driveId` + `itemId` — dua hal yang dibuang sebelum hasil sampai ke model.
// Lebih buruk dari gagal: berkas share bernama sama dengan berkas di folder
// utama user akan terbaca sebagai berkas MILIK USER, tanpa satu pun tanda.

/** Bentuk asli `/me/drive/sharedWithMe` (dokumentasi Graph). */
const SHARE_BERKAS: Mentah = {
  id: 'luar-1',
  name: 'Stok Kit Mol.xlsx',
  remoteItem: {
    id: '01REMOTEITEM',
    name: 'Stok Kit Mol.xlsx',
    size: 19121,
    file: {},
    lastModifiedDateTime: '2026-10-10T03:15:00Z',
    webUrl: 'https://company-my.sharepoint.com/personal/budi/Stok%20Kit%20Mol.xlsx',
    parentReference: { driveId: 'b!DRIVEBUDI' },
    shared: { owner: { user: { displayName: 'Budi Santoso' } } },
    createdBy: { user: { displayName: 'Rekan Lain' } }
  }
}

const SHARE_FOLDER: Mentah = {
  id: 'luar-2',
  name: 'Data Lab',
  remoteItem: {
    id: '01REMOTEFOLDER',
    name: 'Data Lab',
    folder: { childCount: 4 },
    parentReference: { driveId: 'b!DRIVEBUDI' },
    shared: { owner: { user: { displayName: 'Budi Santoso' } } }
  }
}

const MILIK_SENDIRI: Mentah = {
  id: '01MILIKKU',
  name: 'Stok Kit Mol.xlsx',
  size: 2048,
  file: {},
  lastModifiedDateTime: '2026-09-01T01:00:00Z',
  parentReference: { driveId: 'b!DRIVEKU', path: '/drive/root:' }
}

describe('item share membawa driveId + itemId MILIK DRIVE ASALNYA', () => {
  test('berkas share memakai id & drive dari remoteItem, bukan dari salinan di daftar', () => {
    const b = petakan(SHARE_BERKAS)
    assert.equal(b.id, '01REMOTEITEM')
    assert.equal(b.driveId, 'b!DRIVEBUDI')
    assert.equal(b.dariShare, true)
    assert.equal(b.ukuran, 19121)
  })

  test('pemilik diambil dari shared.owner, bukan dari pembuat berkas', () => {
    assert.equal(petakan(SHARE_BERKAS).pemilik, 'Budi Santoso')
  })

  test('pintasan "Add to My files" di folder utama tetap dikenali sebagai milik orang lain', () => {
    // Bentuknya item biasa di folder utama user, tapi membawa remoteItem.
    const pintasan = petakan({ ...SHARE_FOLDER, parentReference: { driveId: 'b!DRIVEKU', path: '/drive/root:' } })
    assert.equal(pintasan.dariShare, true)
    assert.equal(pintasan.driveId, 'b!DRIVEBUDI')
    assert.equal(pintasan.folder, true)
  })

  test('isi folder share mewarisi pemilik & lokasi induk walau Graph memberi parentReference.path', () => {
    const anak = petakan(
      {
        id: '01ANAK',
        name: 'Januari.xlsx',
        size: 10,
        file: {},
        parentReference: { driveId: 'b!DRIVEBUDI', path: '/drives/b!DRIVEBUDI/root:/Data Lab' }
      },
      { asing: true, pemilik: 'Budi Santoso', lokasiInduk: 'Di-share oleh Budi Santoso › Data Lab' }
    )
    assert.equal(anak.dariShare, true)
    assert.equal(anak.pemilik, 'Budi Santoso')
    assert.equal(anak.lokasi, 'Di-share oleh Budi Santoso › Data Lab › Januari.xlsx')
  })

  test('berkas milik sendiri tidak ditandai share', () => {
    const b = petakan(MILIK_SENDIRI)
    assert.equal(b.dariShare, undefined)
    assert.equal(b.jalur, '/Stok Kit Mol.xlsx')
  })
})

describe('yang dikirim ke model: berkas share TIDAK PERNAH punya jalur', () => {
  // ⚠️ Inti perbaikannya. Jalur selalu diselesaikan di OneDrive USER SENDIRI;
  // memberi berkas share sebuah "jalur" berarti mengundang model membaca
  // berkas lain yang kebetulan bernama sama.
  test('berkas share: ada penanda & lokasi, tanpa kunci jalur', () => {
    const b = petakan(SHARE_BERKAS)
    const r = ringkasUntukModel(b, buatPenanda(b.driveId, b.id))
    assert.match(String(r.penanda), /^od-[0-9a-f]{8}$/)
    assert.equal('jalur' in r, false)
    assert.equal(r.dariShare, true)
    assert.equal(r.pemilik, 'Budi Santoso')
    assert.match(String(r.lokasi), /Budi Santoso/)
  })

  test('lokasi berkas share tidak berbentuk jalur (tanpa / atau \\)', () => {
    // Kalau model tetap menyalin lokasi sebagai jalur, pencarian di drive
    // user harus GAGAL — bukan menemukan berkas lain bernama sama.
    for (const m of [SHARE_BERKAS, SHARE_FOLDER]) {
      const b = petakan(m)
      const r = ringkasUntukModel(b, buatPenanda(b.driveId, b.id))
      assert.doesNotMatch(String(r.lokasi), /[\\/]/)
      assert.notEqual(String(r.lokasi), b.nama)
    }
  })

  test('berkas milik sendiri tetap punya jalur DAN penanda', () => {
    const b = petakan(MILIK_SENDIRI)
    const r = ringkasUntukModel(b, buatPenanda(b.driveId, b.id))
    assert.equal(r.jalur, '/Stok Kit Mol.xlsx')
    assert.match(String(r.penanda), /^od-/)
    assert.equal('lokasi' in r, false)
  })

  test('pemilik tak diketahui tetap menghasilkan lokasi yang utuh', () => {
    const b = petakan({ id: 'x', name: 'A.docx', remoteItem: { id: 'r', parentReference: { driveId: 'd' } } })
    const r = ringkasUntukModel(b, buatPenanda(b.driveId, b.id))
    assert.ok(String(r.lokasi).length > 'A.docx'.length)
    assert.doesNotMatch(String(r.lokasi), /undefined/)
  })
})

describe('penanda: pendek, tetap, dan unik per drive', () => {
  test('item yang sama selalu mendapat penanda yang sama (bertahan saat didaftar ulang)', () => {
    assert.equal(buatPenanda('b!D', '01X'), buatPenanda('b!D', '01X'))
  })

  test('itemId sama di drive berbeda = penanda berbeda', () => {
    assert.notEqual(buatPenanda('b!DRIVEBUDI', '01X'), buatPenanda('b!DRIVEKU', '01X'))
  })

  test('daftar penanda menyimpan dan menemukan kembali berkasnya', () => {
    const d = new DaftarPenanda()
    const b = petakan(SHARE_BERKAS)
    const p = d.catat(b)
    assert.equal(d.cari(p)?.id, '01REMOTEITEM')
    assert.equal(d.cari('od-00000000'), undefined)
  })

  test('penanda dibaca toleran terhadap spasi & huruf besar', () => {
    const d = new DaftarPenanda()
    const p = d.catat(petakan(SHARE_BERKAS))
    assert.equal(d.cari(`  ${p.toUpperCase()} `)?.id, '01REMOTEITEM')
  })

  test('daftar dibatasi — yang paling lama dibuang, bukan tumbuh tanpa batas', () => {
    const d = new DaftarPenanda(3)
    const ps = ['a', 'b', 'c', 'd'].map((id) => d.catat({ ...petakan(MILIK_SENDIRI), id }))
    assert.equal(d.cari(ps[0]), undefined)
    assert.ok(d.cari(ps[3]))
  })

  test('dikosongkan saat ganti akun', () => {
    const d = new DaftarPenanda()
    const p = d.catat(petakan(SHARE_BERKAS))
    d.kosongkan()
    assert.equal(d.cari(p), undefined)
  })

  test('penanda tak dikenal: galat menyebut CARA mendapat penanda baru (aturan 55)', () => {
    const pesan = pesanPenandaTakDikenal('od-12345678')
    assert.match(pesan, /od-12345678/)
    assert.match(pesan, /onedrive_daftar/)
    assert.match(pesan, /onedrive_cari/)
    assert.match(pesan, /jangan/i)
  })
})

describe('nama kembar: berkas share TIDAK BOLEH tertukar dengan berkas milik user', () => {
  test('berkas sendiri bernama sama dengan berkas share yang sudah terlihat → kembarannya ditemukan', () => {
    const d = new DaftarPenanda()
    const pShare = d.catat(petakan(SHARE_BERKAS))
    const sendiri = { ...petakan(MILIK_SENDIRI), nama: 'stok kit mol.XLSX' }
    const kembar = d.kembaranAsing(sendiri)
    assert.deepEqual(kembar.map((k) => k.penanda), [pShare])
  })

  test('berkas tidak dianggap kembaran dirinya sendiri, dan berkas sendiri lain nama tidak terjaring', () => {
    const d = new DaftarPenanda()
    d.catat(petakan(MILIK_SENDIRI))
    d.catat(petakan({ ...SHARE_BERKAS, name: 'Lain.xlsx', remoteItem: { ...SHARE_BERKAS.remoteItem!, name: 'Lain.xlsx' } }))
    assert.deepEqual(d.kembaranAsing(petakan(MILIK_SENDIRI)), [])
  })

  test('pesan nama kembar menyebut KEDUA penanda & pemiliknya, tanpa memilihkan', () => {
    const d = new DaftarPenanda()
    const share = petakan(SHARE_BERKAS)
    const pShare = d.catat(share)
    const sendiri = petakan(MILIK_SENDIRI)
    const pSendiri = d.catat(sendiri)
    const pesan = pesanNamaKembar(sendiri, pSendiri, [{ penanda: pShare, berkas: share }])
    assert.match(pesan, new RegExp(pSendiri))
    assert.match(pesan, new RegExp(pShare))
    assert.match(pesan, /Budi Santoso/)
    assert.match(pesan, /tanya/i)
  })
})

describe('hasil pencarian lintas tempat: milik siapa?', () => {
  test('drive berbeda dari drive user = milik orang lain', () => {
    assert.equal(asingMenurutDrive('b!DRIVEBUDI', 'b!DRIVEKU'), true)
    assert.equal(asingMenurutDrive('b!DRIVEKU', 'b!DRIVEKU'), false)
  })

  test('drive user tidak diketahui → dianggap milik orang lain (aman: tanpa jalur)', () => {
    assert.equal(asingMenurutDrive('b!DRIVEKU', null), true)
  })

  test('driveId kosong dari Graph → tidak bisa dipastikan, dianggap milik orang lain', () => {
    assert.equal(asingMenurutDrive('', 'b!DRIVEKU'), true)
  })
})

describe('definisi tool: penanda adalah jalan untuk berkas share', () => {
  const tool = (nama: string) => onedriveTools.find((t) => t.name === nama)!

  test('onedrive_ambil menerima penanda dan tidak lagi mewajibkan jalur', () => {
    const p = tool('onedrive_ambil').parameters as { properties: Record<string, unknown>; required?: string[] }
    assert.ok(p.properties.penanda)
    assert.ok(!(p.required ?? []).includes('jalur'))
  })

  test('onedrive_daftar bisa membuka isi folder lewat penanda', () => {
    const p = tool('onedrive_daftar').parameters as { properties: Record<string, unknown> }
    assert.ok(p.properties.penanda)
  })

  test('deskripsi menyebut bahwa berkas share hanya bisa dibuka lewat penanda', () => {
    assert.match(tool('onedrive_ambil').description, /share/i)
    assert.match(tool('onedrive_ambil').description, /penanda/i)
    assert.match(tool('onedrive_daftar').description, /penanda/i)
  })

  test('ringkasan langkah di layar tidak menulis "undefined" saat memakai penanda', () => {
    const s = tool('onedrive_ambil').summarize!({ penanda: 'od-12345678' })
    assert.doesNotMatch(s, /undefined/)
    const s2 = tool('onedrive_daftar').summarize!({ penanda: 'od-12345678' })
    assert.doesNotMatch(s2, /undefined|\(utama\)/)
  })

  test('ambil tanpa penanda maupun jalur ditolak dengan arahan', async () => {
    await assert.rejects(tool('onedrive_ambil').execute({}, { allowedDirs: [] }), /penanda/)
  })

  test('penanda yang tidak dikenal TIDAK pernah jatuh ke pencarian jalur', async () => {
    // Bukan penanda dari hasil tool mana pun. Jalurnya sengaja menunjuk nama
    // berkas share: kalau penanda gagal lalu diam-diam jatuh ke jalur, yang
    // terbaca berkas lain bernama sama di folder utama user.
    await assert.rejects(
      tool('onedrive_ambil').execute(
        { penanda: 'od-ffffffff', jalur: 'Stok Kit Mol.xlsx' },
        { allowedDirs: [] }
      ),
      /tidak dikenal/
    )
  })
})

describe('folder unduhan OneDrive: dibaca tool, TIDAK PERNAH diindeks (aturan 44)', () => {
  // Uji dari aplikasi 13 Okt 2026: read_excel ditolak untuk berkas hasil
  // onedrive_ambil, model meminta izin folder unduhan, dan sesudah disetujui
  // auto-index mengindeks salinan berkas OneDrive itu tanpa pernah diminta.
  const cache = path.join(os.tmpdir(), 'aira-desktop', 'onedrive-cache')
  const laporan = path.join(os.tmpdir(), 'Laporan')

  test('folder unduhan yang terlanjur diizinkan dikeluarkan dari indeks', () => {
    const r = pisahkanFolderIndeks([laporan, cache], [cache])
    assert.deepEqual(r.indeks, [laporan])
    assert.deepEqual(r.dikecualikan, [cache])
  })

  test('beda huruf besar & garis miring penutup tetap dikenali (Windows)', { skip: process.platform !== 'win32' }, () => {
    const r = pisahkanFolderIndeks([cache.toUpperCase() + path.sep], [cache])
    assert.deepEqual(r.indeks, [])
  })

  test('subfolder di dalam folder unduhan ikut dikecualikan', () => {
    assert.equal(samaAtauDiBawah(path.join(cache, 'sub'), cache), true)
  })

  test('folder lain yang namanya berawalan sama TIDAK ikut dikecualikan', () => {
    assert.equal(samaAtauDiBawah(cache + '-lama', cache), false)
    assert.deepEqual(pisahkanFolderIndeks([laporan], [cache]).dikecualikan, [])
  })
})

describe('instruksi model: penanda giliran lalu tidak terlihat', () => {
  // Uji dari aplikasi 13 Okt 2026: di pertanyaan lanjutan model mengarang
  // penanda `od-2b619360-…` (bentuk UUID) karena riwayat yang dikirim hanya
  // teks — hasil tool berisi penanda asli tidak pernah ikut. Penolakan di kode
  // menangkapnya; kalimat di prompt menghemat panggilan yang pasti gagal.
  const src = readFileSync(join(__dirname, '..', 'src', 'main', 'agent', 'orchestrator.ts'), 'utf8')

  test('ONEDRIVE_PROMPT menyuruh mendaftar ulang, bukan menebak penanda', () => {
    const awal = src.indexOf('const ONEDRIVE_PROMPT')
    const prompt = src.slice(awal, src.indexOf('const LAB_PROMPT'))
    assert.match(prompt, /PENANDA VALUES FROM EARLIER TURNS ARE NOT VISIBLE TO YOU/)
    assert.match(prompt, /onedrive_daftar or onedrive_cari again/)
    assert.match(prompt, /DO NOT guess/)
  })

  test('premisnya masih benar: riwayat ke model hanya role + content', () => {
    // ⚠️ Kalau test ini gagal karena hasil tool kini ikut di riwayat, kalimat di
    // atas BERBOHONG ke model — tinjau ulang, jangan cuma menyesuaikan test.
    assert.match(src, /\.map\(\(m\) => \(\{ role: m\.role, content: m\.content \}\) as ChatTurn\)/)
  })
})

describe('daftar share: sharedWithMe usang → riwayat berbagi (insights) jadi sumber utama', () => {
  // 13 Okt 2026, dilaporkan user: folder yang di-share Dana pagi itu tidak muncul.
  // Terukur: /me/drive/sharedWithMe hanya 1 item (API itu DEPRECATED, "degraded",
  // berhenti mengembalikan data sesudah Nov 2026); /me/insights/shared memuat
  // folder tsb. Insights juga memuat LAMPIRAN EMAIL — itu wajib dibuang.
  const folderAnnes = {
    resourceReference: { type: 'microsoft.graph.driveItem', id: 'drives/b!DRIVEANNES/items/01FOLDER' },
    resourceVisualization: { title: 'Monitoring Material to IT', type: 'Folder' },
    lastShared: { sharedBy: { displayName: 'Dana Putri Anggraeni' }, sharedDateTime: '2026-10-13T01:52:36Z' }
  }
  const lampiranEmail = {
    resourceReference: { type: 'microsoft.graph.fileAttachment', id: 'users/x/messages/y=/attachments/z=' },
    resourceVisualization: { title: 'Kunci Bank', type: 'Archive' }
  }

  test('item driveItem diurai jadi driveId + itemId + yang membagikan', () => {
    assert.deepEqual(refDariInsight(folderAnnes), {
      driveId: 'b!DRIVEANNES',
      itemId: '01FOLDER',
      oleh: 'Dana Putri Anggraeni'
    })
  })

  test('lampiran email TIDAK ikut — bukan berkas OneDrive, dan namanya bisa sensitif', () => {
    assert.equal(refDariInsight(lampiranEmail), null)
  })

  test('id yang bentuknya asing ditolak, tidak ditebak', () => {
    assert.equal(refDariInsight({ resourceReference: { type: 'microsoft.graph.driveItem', id: 'sites/x/lists/y' } }), null)
    assert.equal(refDariInsight({}), null)
  })

  test('dua sumber digabung tanpa dobel; urutan sumber pertama dipertahankan', () => {
    const a = petakan({ id: '01FOLDER', name: 'Monitoring Material to IT', folder: {}, parentReference: { driveId: 'b!DRIVEANNES' } }, { asing: true })
    const b = petakan(SHARE_BERKAS)
    const a2 = { ...a, nama: 'salinan dari sumber lain' }
    const hasil = gabungTanpaDobel([[a, b], [a2]])
    assert.deepEqual(hasil.map((x) => x.nama), ['Monitoring Material to IT', 'Stok Kit Mol.xlsx'])
  })

  test('item share yang tidak terjangkau lagi DISEBUT, bukan didiamkan', () => {
    assert.match(catatanTakTerjangkau(2), /2 item/)
    assert.match(catatanTakTerjangkau(2), /dicabut|dihapus/)
    assert.equal(catatanTakTerjangkau(0), '')
  })
})

describe('folder dari pencarian: Search API melabeli folder sebagai berkas berukuran 0', () => {
  // Terukur 13 Okt 2026: hasil /search/query untuk folder "Monitoring Material to
  // IT" membawa kunci `file` dan size 0, tanpa `folder`.
  test('tanpa ekstensi + ukuran 0 → diduga folder', () => {
    assert.equal(mungkinFolderDariPencarian({ id: 'x', name: 'Monitoring Material to IT', size: 0, file: {} }), true)
  })

  test('berkas berekstensi, atau berisi, tetap berkas', () => {
    assert.equal(mungkinFolderDariPencarian({ id: 'x', name: 'Kosong.xlsx', size: 0, file: {} }), false)
    assert.equal(mungkinFolderDariPencarian({ id: 'x', name: 'README', size: 120, file: {} }), false)
  })

  test('folder yang memang berlabel folder tetap folder', () => {
    assert.equal(mungkinFolderDariPencarian({ id: 'x', name: 'Laporan', folder: {} }), true)
  })
})
