import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import type { MenuId, PanduanBagian } from '../src/shared/ipc'
import { bagianKeTeks, cariBagian, susunPanduan, type KeadaanPanduan } from '../src/main/panduan/isi'
import { menyinggungPanduan } from '../src/main/agent/panduan-guard'
import { getTool } from '../src/main/tools/registry'
import { groupOf } from '../src/main/agent/tool-groups'
import { RETENSI_PROMPT_HARI } from '../src/main/monitoring/rules'
import { PEMICU, kalimatAturan } from '../src/main/pemantau/rules'

// ⚠️ INI TEST YANG MENGGANTIKAN "membaca ulang panduannya".
//
// Panduan yang ditulis tangan selalu menyimpang dari kode, dan penyimpangannya
// SUNYI: tidak ada error, cuma kalimat yang salah. Yang menahan di sini bukan
// review manusia melainkan test — sama seperti daftar kode provinsi pada
// validator NIK (§27) yang lolos review dan tetap salah.

const SEMUA_MENU: MenuId[] = ['sales', 'masterdata', 'lab', 'onedrive']

const keadaan = (ubah: Partial<KeadaanPanduan> = {}): KeadaanPanduan => ({
  izinMenu: SEMUA_MENU,
  m365Lanjutan: false,
  suaraTersedia: true,
  ...ubah
})

const semuaTeks = (bagian: PanduanBagian[]): string => bagian.map(bagianKeTeks).join('\n')

describe('panduan hanya menyebut menu yang boleh dibuka user', () => {
  test('user tanpa izin menu apa pun tidak diajari menu data', () => {
    const teks = semuaTeks(susunPanduan(keadaan({ izinMenu: [] })))
    for (const larangan of [
      'Tanya Data Sales',
      'Ask Master Data',
      'Tanya TAT Sample',
      'Tanya Microsoft 365'
    ]) {
      assert.ok(!teks.includes(larangan), `menu "${larangan}" bocor ke panduan user tanpa izin`)
    }
    // Tapi ia TETAP diberi jalan keluar, bukan dibiarkan bingung.
    assert.match(teks, /Masukan & Usulan/)
  })

  test('user hanya berizin sales tidak melihat menu lain', () => {
    const teks = semuaTeks(susunPanduan(keadaan({ izinMenu: ['sales'] })))
    assert.ok(teks.includes('Tanya Data Sales'))
    assert.ok(!teks.includes('Tanya TAT Sample'))
    assert.ok(!teks.includes('Ask Master Data'))
  })

  test('contoh pertanyaan tidak pernah memakai mode yang tidak diizinkan', () => {
    for (const izin of [[], ['sales'], ['lab', 'onedrive'], SEMUA_MENU] as MenuId[][]) {
      for (const b of susunPanduan(keadaan({ izinMenu: izin }))) {
        for (const blok of b.isi) {
          if (blok.jenis !== 'contoh') continue
          if (blok.mode === 'general') continue
          assert.ok(
            izin.includes(blok.mode as MenuId),
            `contoh bermode "${blok.mode}" muncul untuk user berizin [${izin.join(',')}]`
          )
        }
      }
    }
  })
})

describe('panduan mengikuti saklar fitur, bukan angan-angan', () => {
  // ⚠️ Diuji di KEDUA keadaan saklar (pola §46). Kalau hanya keadaan sekarang
  // yang diuji, menyalakan saklar kelak akan membuat panduan berbohong ke arah
  // sebaliknya tanpa ada yang menyadarinya.
  test('M365_LANJUTAN mati: email & kalender dinyatakan BELUM aktif', () => {
    const teks = semuaTeks(susunPanduan(keadaan({ m365Lanjutan: false })))
    assert.match(teks, /Email Outlook dan kalender BELUM aktif/)
    assert.ok(
      !/AIRA (bisa|dapat) membaca email/i.test(teks),
      'panduan menjanjikan pembacaan email padahal saklarnya mati'
    )
  })

  test('M365_LANJUTAN hidup: email jadi draf saja, tidak pernah terkirim', () => {
    const teks = semuaTeks(susunPanduan(keadaan({ m365Lanjutan: true })))
    assert.match(teks, /hanya dibuat sebagai DRAF/)
    assert.match(teks, /Tidak ada jalur mengirim email/)
    assert.ok(!/BELUM aktif/.test(teks))
  })

  test('dikte suara: isinya berbeda saat model suara tidak terpasang', () => {
    const ada = semuaTeks(susunPanduan(keadaan({ suaraTersedia: true })))
    const tiada = semuaTeks(susunPanduan(keadaan({ suaraTersedia: false })))
    assert.match(ada, /Tombol mikrofon/)
    assert.match(tiada, /tidak aktif di laptop ini/)
  })
})

describe('setiap nama tool yang disebut panduan benar-benar ada', () => {
  // Nama tool di dalam prosa SELALU ditulis di antara backtick. Jadi: apa pun
  // yang ber-backtick dan mengandung garis bawah WAJIB terdaftar di registry.
  // Tanpa ini, panduan bisa menyuruh orang memakai tool yang sudah dihapus atau
  // yang saklarnya mati — dan ia akan terdengar sangat meyakinkan.
  const BUKAN_TOOL = new Set(['tb_feedback_aira', 'tb_memori_aira', 'v_sample_tracker'])

  test('tidak ada nama tool karangan di seluruh panduan', () => {
    const kombinasi: KeadaanPanduan[] = [
      keadaan(),
      keadaan({ m365Lanjutan: true }),
      keadaan({ izinMenu: [] }),
      keadaan({ suaraTersedia: false })
    ]
    for (const k of kombinasi) {
      const teks = semuaTeks(susunPanduan(k))
      for (const m of teks.matchAll(/`([a-z0-9_]+)`/g)) {
        const nama = m[1]
        if (!nama.includes('_') || BUKAN_TOOL.has(nama)) continue
        assert.ok(getTool(nama), `panduan menyebut tool "${nama}" yang tidak terdaftar`)
      }
    }
  })

  test('cari_panduan terdaftar dan masuk kelompok core', () => {
    const tool = getTool('cari_panduan')
    assert.ok(tool, 'cari_panduan tidak terdaftar')
    // ⚠️ Kalau ia jatuh ke kelompok lain, ia hilang dari mode data & mode umum
    // sekaligus — dan pertanyaan "gimana caranya" justru muncul di sana.
    assert.equal(groupOf('cari_panduan'), 'core')
    assert.equal(tool?.tier, 'read')
  })
})

describe('panduan menyatakan batasnya, bukan hanya kemampuannya', () => {
  test('ada bagian khusus "yang TIDAK bisa"', () => {
    const bagian = susunPanduan(keadaan())
    const batas = bagian.find((b) => b.id === 'batas')
    assert.ok(batas, 'bagian batas hilang')
    assert.ok(batas!.isi.some((b) => b.jenis === 'batas'))
  })

  test('setiap menu data membawa blok batasnya sendiri', () => {
    // Kemampuan tanpa batas adalah setengah kebenaran. Untuk menu sales, batas
    // "hanya agregat" adalah bagian yang paling penting justru bagi manajemen.
    const teks = semuaTeks(susunPanduan(keadaan({ izinMenu: ['sales'] })))
    assert.match(teks, /BATAS: Hanya angka AGREGAT/)
  })

  test('tidak ada klaim integrasi yang memang tidak ada', () => {
    const teks = semuaTeks(susunPanduan(keadaan({ m365Lanjutan: true }))).toLowerCase()
    // Daftar ini lahir dari transkrip asisten lain yang menjanjikan semuanya
    // (n8n, OCR terjadwal, ARIMA, template eksekutif) padahal tidak punya.
    for (const hantu of ['n8n', 'arima', 'holt-winters', 'zapier', 'power automate']) {
      assert.ok(!teks.includes(hantu), `panduan menjanjikan integrasi "${hantu}"`)
    }
  })
})

describe('panduan chat rekan jujur soal batasnya', () => {
  // ⚠️ Orang memindahkan percakapan dari WhatsApp ke sini karena WhatsApp
  // diblokir. Dua anggapan yang salah paling mahal: "ini sama rahasianya dengan
  // WhatsApp" dan "pesan pasti sampai seperti di HP". Keduanya wajib dibantah
  // di panduan, dan test ini yang menjaga kalimatnya tidak hilang diam-diam.
  const teks = semuaTeks(susunPanduan(keadaan()))

  test('menyatakan BUKAN saluran rahasia', () => {
    assert.match(teks, /BUKAN saluran rahasia/)
  })

  test('menyatakan tidak ada aplikasi HP & pesan tidak sampai saat AIRA mati', () => {
    assert.match(teks, /tidak ada aplikasi HP/)
    assert.match(teks, /pesan untukmu tidak akan sampai/)
  })

  test('pertanyaan soal grup menemukan bagian chat', () => {
    assert.equal(cariBagian(susunPanduan(keadaan()), 'gimana cara bikin grup chat', 1)[0].id, 'suara-chat')
  })
})

describe('pencarian bagian panduan', () => {
  const bagian = susunPanduan(keadaan())

  test('pertanyaan nyata menemukan bagian yang benar', () => {
    assert.equal(cariBagian(bagian, 'apakah kamu bisa buat ppt?', 1)[0].id, 'laporan')
    assert.equal(cariBagian(bagian, 'cara baca file excel', 1)[0].id, 'dokumen')
    // "kenapa menu saya tidak muncul" mendarat di bagian "Kalau ada yang salah",
    // bukan di "Menu yang kamu punya" — dan itu memang jawaban yang benar:
    // yang dibutuhkan orang ini adalah CARA MELAPOR, bukan daftar menu.
    assert.equal(cariBagian(bagian, 'kenapa menu saya tidak muncul', 1)[0].id, 'masalah')
  })

  test('query kosong atau tak dikenal TIDAK mengembalikan kosong', () => {
    // Panduan yang mengembalikan nol bagian membuat model menjawab dari
    // ingatannya sendiri — persis yang mau dicegah tool ini.
    assert.ok(cariBagian(bagian, '', 3).length > 0)
    assert.ok(cariBagian(bagian, 'qwertyuiop zxcvbnm', 3).length > 0)
  })
})

describe('guard: pertanyaan tentang AIRA sendiri', () => {
  test('kalimat asli dari transkrip yang jadi alasan fitur ini dibuat', () => {
    for (const t of [
      'apakah kamu bisa buat ppt? gmn langkahnya? dan punya template apa aja bawaan mu?',
      'kamu bisa apa aja',
      'apa saja yang bisa kamu lakukan',
      'fitur apa saja yang ada di aira',
      'gimana caranya pakai menu ini',
      'ada panduannya ga?',
      'tutorialnya di mana ya',
      'siapa kamu',
      'apakah kamu bisa bantu saya membuat dokumen'
    ]) {
      assert.equal(menyinggungPanduan(t), true, t)
    }
  })

  test('TIDAK menyandera pekerjaan nyata', () => {
    // ⚠️ Sisi ini diuji lebih keras daripada sisi positifnya. Guard yang
    // melewatkan pertanyaan panduan cuma kehilangan satu jawaban rapi; guard
    // yang salah menyala menunda pekerjaan orang demi ceramah tentang fitur.
    for (const t of [
      'apakah kamu bisa hitung sales bulan ini',
      'kamu bisa apa saja untuk data penjualan Agustus',
      'gimana cara menghitung TAT sampel bulan lalu',
      'berapa sales hari ini?',
      'tolong ringkas dokumen ini',
      'buatkan presentasi 8 slide tentang rencana kerja Q4',
      'apakah kamu bisa membaca file ini',
      'bagaimana cara kerja backlog di lab',
      'cari pelanggan dengan nama Kariadi'
    ]) {
      assert.equal(menyinggungPanduan(t), false, t)
    }
  })

  test('kalimat kosong & paragraf panjang tidak memicu', () => {
    assert.equal(menyinggungPanduan(''), false)
    assert.equal(menyinggungPanduan('   '), false)
    assert.equal(menyinggungPanduan(`apa saja yang bisa kamu lakukan ${'x'.repeat(230)}`), false)
  })
})

describe('panduan jujur soal monitoring pemakaian', () => {
  // ⚠️ Pemakaian dicatat dan dibaca Super Admin (16 Sep 2026). Monitoring yang
  // tidak diberitahukan adalah masalah kepercayaan, bukan fitur. Kalimat ini
  // wajib ada, dan wajib menyebut apa yang TIDAK dicatat.
  const teks = semuaTeks(susunPanduan(keadaan()))

  test('menyatakan pemakaian dicatat & apa yang tidak ikut', () => {
    assert.match(teks, /Pemakaian AIRA DICATAT/)
    assert.match(teks, /Jawaban AIRA dan isi berkas TIDAK ikut dicatat/)
  })

  test('masa simpan disebut dari konstanta kode, bukan angka ketikan', () => {
    assert.ok(teks.includes(`sesudah ${RETENSI_PROMPT_HARI} hari`))
  })

  test('pertanyaan "apakah saya dipantau" menemukan bagiannya', () => {
    assert.equal(cariBagian(susunPanduan(keadaan()), 'apakah pemakaian saya dicatat', 1)[0].id, 'ingatan')
  })
})

describe('panduan pemantau proaktif (20 Okt 2026)', () => {
  const bagianPemantau = (izinMenu: MenuId[]): PanduanBagian | undefined =>
    susunPanduan(keadaan({ izinMenu })).find((b) => b.id === 'pemantau')

  test('tidak muncul untuk user tanpa menu Sales maupun TAT', () => {
    assert.equal(bagianPemantau(['masterdata', 'onedrive']), undefined)
    assert.equal(bagianPemantau([]), undefined)
  })

  test('hanya pemicu menu milik user yang disebut (aturan 61)', () => {
    const sales = bagianKeTeks(bagianPemantau(['sales'])!)
    assert.ok(sales.includes('data Sales'))
    assert.ok(!sales.includes('TAT Sample') && !sales.includes('sampel lab'), sales)
    const lab = bagianKeTeks(bagianPemantau(['lab'])!)
    assert.ok(lab.includes('TAT Sample'))
    assert.ok(!lab.includes('data Sales') && !lab.includes('Sales kemarin'), lab)
  })

  test('angka di panduan = konstanta (kalimat aturan dibangkitkan kode)', () => {
    const teks = bagianKeTeks(bagianPemantau(SEMUA_MENU)!)
    for (const p of PEMICU) assert.ok(teks.includes(kalimatAturan(p.id)), p.id)
  })

  test('menyatakan batasnya: hanya selama AIRA menyala, toast tanpa rincian Rupiah', () => {
    const teks = bagianKeTeks(bagianPemantau(SEMUA_MENU)!)
    assert.match(teks, /selama AIRA menyala di laptop ini/i)
    assert.match(teks, /jumlah & persen/)
    assert.match(teks, /tidak dipantau/i)
  })

  test('pertanyaan tentang data macet menemukan bagian pemantau', () => {
    assert.equal(cariBagian(susunPanduan(keadaan()), 'notifikasi data belum diperbarui', 1)[0].id, 'pemantau')
  })

  test('regresi: bagian baru tidak merebut pertanyaan soal monitoring pemakaian', () => {
    // Review Focus 5: "pemantau" (data) dan "monitoring pemakaian" (orang) mudah tertukar.
    assert.equal(cariBagian(susunPanduan(keadaan()), 'apakah pemakaian saya dicatat', 1)[0].id, 'ingatan')
    const teks = bagianKeTeks(bagianPemantau(SEMUA_MENU)!)
    assert.ok(!/pemakaian|dicatat/i.test(teks), 'bagian pemantau tidak memakai kosakata monitoring pemakaian')
  })
})
