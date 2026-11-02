import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAKS_ANGGOTA,
  MAKS_NAMA_GRUP,
  dalamRentang,
  kunciSenyapGrup,
  periksaJumlahAnggota,
  periksaNamaGrup,
  saringCalonAnggota,
  teksSistem
} from '../src/main/chat/grup-rules'
import { ringkasNotifikasi } from '../src/main/chat/rules'
import { assertBukanTabelAuth } from '../src/main/tools/db-safety'
import { normalkanUsername } from '../src/main/auth/account'

// Grup chat (tahap 3 "WhatsApp lite", 16 Sep 2026) — bagian MURNI.
//
// ⚠️ Aturan IZIN grup tidak diuji di sini, dan itu disengaja: ia hidup di klausa
// WHERE, jadi ia diuji ke database sungguhan lewat `tests/grup-live-check.ts`
// (47 pemeriksaan, dan terbukti GAGAL saat aturan rentang keanggotaan dirusak).

describe('tabel grup tidak bisa dibaca tool database', () => {
  test('kedua tabel grup ditolak', () => {
    assert.throws(() => assertBukanTabelAuth('SELECT * FROM tb_chat_aira_grup'), /grup chat/)
    assert.throws(
      () => assertBukanTabelAuth('select username from tb_chat_aira_grup_anggota'),
      /anggota tiap grup/
    )
  })

  test('tabel anggota TIDAK lolos hanya karena namanya lebih panjang', () => {
    // ⚠️ `\b` tidak menyala di antara "grup" dan "_anggota" (garis bawah adalah
    // karakter kata). Kalau hanya `tb_chat_aira_grup` yang dilarang, tabel
    // anggotanya lolos — dan tabel itulah yang memetakan siapa berkelompok
    // dengan siapa di seluruh kantor.
    assert.throws(() =>
      assertBukanTabelAuth(
        'WITH x AS (SELECT * FROM public.tb_chat_aira_grup_anggota) SELECT count(*) FROM x'
      )
    )
  })
})

describe('nama grup', () => {
  test('spasi dirapikan — "Tim  Lab" dan "Tim Lab" bukan dua grup berbeda', () => {
    const h = periksaNamaGrup('   Tim    Lab  ')
    assert.equal(h.ok, true)
    assert.equal(h.ok && h.nama, 'Tim Lab')
  })

  test('kosong ditolak', () => {
    assert.equal(periksaNamaGrup('').ok, false)
    assert.equal(periksaNamaGrup('    ').ok, false)
  })

  test('terlalu panjang ditolak', () => {
    assert.equal(periksaNamaGrup('x'.repeat(MAKS_NAMA_GRUP)).ok, true)
    assert.equal(periksaNamaGrup('x'.repeat(MAKS_NAMA_GRUP + 1)).ok, false)
  })
})

describe('calon anggota', () => {
  test('diri sendiri, duplikat, dan beda huruf besar dibuang', () => {
    assert.deepEqual(saringCalonAnggota(['Budi', 'budi', 'Andi', 'siti', ' '], 'andi'), ['budi', 'siti'])
  })

  test('yang sudah anggota tidak ditambah lagi', () => {
    assert.deepEqual(saringCalonAnggota(['budi', 'siti', 'dewi'], 'andi', ['Siti']), ['budi', 'dewi'])
  })

  test('batas anggota', () => {
    assert.equal(periksaJumlahAnggota(MAKS_ANGGOTA - 1, 1).ok, true)
    const lebih = periksaJumlahAnggota(MAKS_ANGGOTA - 1, 2)
    assert.equal(lebih.ok, false)
    // Pesan galat menyebut jalan keluarnya, bukan sekadar "melebihi batas" (§55).
    assert.match(lebih.ok ? '' : lebih.alasan, /email/i)
  })
})

describe('teks pesan sistem', () => {
  test('"kamu" mengikuti siapa yang membaca', () => {
    // Pesan yang sama, tiga pembaca.
    assert.equal(teksSistem('tambah', 'andi', 'budi', 'andi'), 'You added budi')
    assert.equal(teksSistem('tambah', 'andi', 'budi', 'budi'), 'andi added you')
    assert.equal(teksSistem('tambah', 'andi', 'budi', 'siti'), 'andi added budi')
  })

  test('tidak peka huruf besar', () => {
    assert.equal(teksSistem('keluar', 'Andi', null, 'andi'), 'You left the group')
  })

  test('pengganti admin otomatis TIDAK menyebut orang yang keluar sebagai pelaku', () => {
    // Menulis "andi menjadikan budi admin" padahal andi sekadar keluar adalah
    // cerita yang tidak pernah terjadi.
    const t = teksSistem('admin_otomatis', 'andi', 'budi', 'siti')
    assert.equal(t, 'budi is now a group admin')
    assert.ok(!t.includes('andi'))
    assert.equal(teksSistem('admin_otomatis', 'andi', 'budi', 'budi'), 'You are now a group admin')
  })

  test('ganti nama memakai target sebagai NAMA BARU, bukan username', () => {
    assert.equal(
      teksSistem('ganti_nama', 'andi', 'Tim Lab', 'budi'),
      'andi renamed the group to “Tim Lab”'
    )
  })

  test('semua jenis yang dikenal menghasilkan teks', () => {
    for (const j of [
      'buat',
      'tambah',
      'keluar',
      'keluarkan',
      'jadi_admin',
      'lepas_admin',
      'admin_otomatis',
      'ganti_nama'
    ]) {
      assert.ok(teksSistem(j, 'andi', 'budi', 'siti').trim().length > 0, j)
    }
  })

  test('jenis tak dikenal (dari versi AIRA yang lebih baru) TIDAK menghasilkan baris kosong', () => {
    assert.ok(teksSistem('jenis_masa_depan', 'andi', null, 'budi').trim().length > 0)
  })
})

describe('rentang keanggotaan (penjelasan aturan SQL)', () => {
  test('pesan sebelum bergabung tidak terlihat', () => {
    assert.equal(dalamRentang(10n, 10n, null), false)
    assert.equal(dalamRentang(11n, 10n, null), true)
  })

  test('pesan sesudah keluar tidak terlihat, tapi pesan "kamu dikeluarkan" masih', () => {
    // keluar_id = id pesan sistem "mengeluarkan kamu" -> pesan itu sendiri
    // masih terlihat oleh yang dikeluarkan.
    assert.equal(dalamRentang(20n, 10n, 20n), true)
    assert.equal(dalamRentang(21n, 10n, 20n), false)
  })
})

describe('notifikasi grup', () => {
  test('pesan grup dikelompokkan per GRUP, bukan per pengirim', () => {
    const g = { id: '7', nama: 'Tim Lab' }
    const hasil = ringkasNotifikasi(
      [
        { pengirim: 'andi', isi: 'a', adaLampiran: false, grup: g },
        { pengirim: 'budi', isi: 'b', adaLampiran: false, grup: g },
        { pengirim: 'siti', isi: 'c', adaLampiran: false, grup: g }
      ],
      true
    )
    assert.equal(hasil.length, 1)
    assert.equal(hasil[0].judul, 'Tim Lab (3 pesan)')
    assert.equal(hasil[0].grupId, '7')
  })

  test('isi notifikasi grup menyebut SIAPA yang menulis', () => {
    const hasil = ringkasNotifikasi(
      [{ pengirim: 'budi', isi: 'oke setuju', adaLampiran: false, grup: { id: '7', nama: 'Tim Lab' } }],
      true
    )
    assert.equal(hasil[0].isi, 'budi: oke setuju')
  })

  test('pesan pribadi Budi TIDAK digabung dengan pesan Budi di grup', () => {
    const hasil = ringkasNotifikasi(
      [
        { pengirim: 'budi', isi: 'pribadi', adaLampiran: false },
        { pengirim: 'budi', isi: 'di grup', adaLampiran: false, grup: { id: '7', nama: 'Tim Lab' } }
      ],
      true
    )
    assert.equal(hasil.length, 2)
  })

  test('pratinjau mati: isi pesan grup tidak bocor, nama pengirim pun tidak', () => {
    const hasil = ringkasNotifikasi(
      [{ pengirim: 'budi', isi: 'harga penawaran 4,2 M', adaLampiran: false, grup: { id: '7', nama: 'Tim Lab' } }],
      false
    )
    assert.ok(!hasil[0].isi.includes('4,2'))
    assert.ok(!hasil[0].isi.includes('budi'), 'nama pengirim ikut bocor saat pratinjau mati')
    assert.equal(hasil[0].judul, 'Tim Lab')
  })

  test('"X menambahkan kamu" tetap berbunyi walau pratinjau mati', () => {
    const hasil = ringkasNotifikasi(
      [
        {
          pengirim: 'andi',
          isi: '',
          adaLampiran: false,
          grup: { id: '7', nama: 'Tim Lab' },
          sistem: 'andi added you'
        }
      ],
      false
    )
    assert.equal(hasil[0].isi, 'andi added you')
  })
})

describe('kunci senyap grup', () => {
  test('tidak mungkin bertabrakan dengan username', () => {
    // Daftar senyap menyimpan username DAN kunci grup di satu tempat. Yang
    // mencegah tabrakan adalah aturan username (`USERNAME_POLA`) yang tidak
    // mengizinkan titik dua — diuji di sini, bukan diandaikan. Kalau kelak aturan
    // username dilonggarkan, test ini yang pertama berbunyi.
    const kunci = kunciSenyapGrup('7')
    assert.equal(kunci, 'grup:7')
    assert.equal(normalkanUsername(kunci), null, 'username boleh mengandung ":" — kunci senyap grup bisa bertabrakan')
  })
})
