import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import type { GrupRingkas, PesanChatIpc, RekanChat } from '../src/shared/ipc'
import { kunciSenyapGrup } from '../src/main/chat/grup-rules'
import {
  kunciGrup,
  cocokCari,
  cuplikan,
  hariBaru,
  inisial,
  labelTanggal,
  statusOrang,
  susunDaftar,
  tandaBaca,
  waktuDaftar,
  warnaNama,
  labelRole,
  jabatanRekan,
  labelTanggalPanjang,
  saringItem,
  type ItemPercakapan
} from '../src/renderer/src/components/chat/bantu'

// Pembantu panel pesan (tahap 3 "WhatsApp lite"). Yang diuji di sini: APA yang
// tampil. Tata letaknya diperiksa dari aplikasi, bukan dari test.

const pesan = (ubah: Partial<PesanChatIpc>): PesanChatIpc => ({
  id: '1',
  pengirim: 'budi',
  penerima: 'andi',
  isi: 'halo',
  lampiranNama: null,
  lampiranMime: null,
  lampiranUkuran: null,
  createdAt: '2026-09-16T07:00:00.000Z',
  dibacaAt: null,
  dihapusAt: null,
  grupId: null,
  jenis: null,
  target: null,
  ...ubah
})

const rekan = (
  username: string,
  terakhir: PesanChatIpc | null,
  ubah: Partial<RekanChat> = {}
): RekanChat => ({
  username,
  role: 'staff',
  divisi: null,
  online: false,
  lastSeen: null,
  belumDibaca: 0,
  terakhir,
  ...ubah
})

const grup = (id: string, nama: string, terakhir: PesanChatIpc | null): GrupRingkas => ({
  id,
  nama,
  jumlahAnggota: 3,
  peranSaya: 'anggota',
  aktif: true,
  belumDibaca: 0,
  terakhir
})

describe('daftar percakapan', () => {
  test('diurutkan menurut pesan terakhir, grup & orang bercampur', () => {
    const { percakapan, rekanLain } = susunDaftar(
      [rekan('budi', pesan({ id: '5' })), rekan('siti', null), rekan('dewi', pesan({ id: '12' }))],
      [grup('1', 'Tim Lab', pesan({ id: '9', grupId: '1', penerima: null }))]
    )
    assert.deepEqual(
      percakapan.map((x) => x.kunci),
      ['orang:dewi', 'grup:1', 'orang:budi']
    )
    assert.deepEqual(
      rekanLain.map((x) => x.kunci),
      ['orang:siti']
    )
  })

  test('diurutkan menurut ID, bukan jam — jam laptop pengirim bisa meleset', () => {
    const { percakapan } = susunDaftar(
      [
        // id lebih besar tapi jamnya lebih TUA (jam laptop pengirim terlambat)
        rekan('budi', pesan({ id: '20', createdAt: '2026-09-16T06:00:00.000Z' })),
        rekan('dewi', pesan({ id: '19', createdAt: '2026-09-16T07:00:00.000Z' }))
      ],
      []
    )
    assert.equal(percakapan[0].kunci, 'orang:budi')
  })

  test('id dibandingkan sebagai ANGKA, bukan teks ("10" > "9")', () => {
    const { percakapan } = susunDaftar(
      [rekan('budi', pesan({ id: '9' })), rekan('dewi', pesan({ id: '10' }))],
      []
    )
    assert.equal(percakapan[0].kunci, 'orang:dewi')
  })

  test('grup tanpa pesan tetap tampil, tidak hilang ke mana pun', () => {
    const { percakapan } = susunDaftar([], [grup('1', 'Tim Lab', null)])
    assert.equal(percakapan.length, 1)
  })

  test('pencarian tanpa peka huruf besar', () => {
    const { percakapan } = susunDaftar([], [grup('1', 'Tim Lab', null)])
    assert.equal(cocokCari(percakapan[0], 'lab'), true)
    assert.equal(cocokCari(percakapan[0], 'sales'), false)
    assert.equal(cocokCari(percakapan[0], '   '), true)
  })
})

describe('cuplikan pesan terakhir', () => {
  test('pesan terhapus tidak pernah tampil kosong', () => {
    assert.equal(
      cuplikan(pesan({ isi: '', dihapusAt: '2026-09-16T07:01:00Z' }), 'andi', false),
      '🚫 Pesan ini dihapus'
    )
  })

  test('pesan sistem memakai teks yang SAMA dengan notifikasi', () => {
    assert.equal(
      cuplikan(pesan({ jenis: 'tambah', pengirim: 'budi', target: 'andi', isi: '' }), 'andi', true),
      'budi menambahkan kamu'
    )
  })

  test('di grup pengirim disebut; pesan sendiri jadi "Kamu:"', () => {
    assert.equal(cuplikan(pesan({ pengirim: 'budi', isi: 'oke' }), 'andi', true), 'budi: oke')
    assert.equal(cuplikan(pesan({ pengirim: 'Andi', isi: 'siap' }), 'andi', true), 'Kamu: siap')
    assert.equal(cuplikan(pesan({ pengirim: 'budi', isi: 'oke' }), 'andi', false), 'oke')
  })

  test('lampiran tanpa teks menyebut nama berkasnya', () => {
    assert.equal(
      cuplikan(pesan({ isi: '', lampiranNama: 'laporan.pdf' }), 'andi', false),
      '📎 laporan.pdf'
    )
  })

  test('baris baru dirapikan jadi satu baris', () => {
    assert.equal(cuplikan(pesan({ isi: 'satu\n\ndua' }), 'andi', false), 'satu dua')
  })
})

describe('tanda baca ✓ / ✓✓', () => {
  test('hanya pada pesan pribadi MILIK saya', () => {
    assert.equal(tandaBaca(pesan({ pengirim: 'andi' }), 'andi'), '✓')
    assert.equal(tandaBaca(pesan({ pengirim: 'andi', dibacaAt: '2026-09-16T07:02:00Z' }), 'andi'), '✓✓')
    assert.equal(tandaBaca(pesan({ pengirim: 'budi' }), 'andi'), null)
  })

  test('grup, pesan sistem, dan nisan tidak bertanda', () => {
    assert.equal(tandaBaca(pesan({ pengirim: 'andi', grupId: '1', penerima: null }), 'andi'), null)
    assert.equal(tandaBaca(pesan({ pengirim: 'andi', jenis: 'buat' }), 'andi'), null)
    assert.equal(
      tandaBaca(pesan({ pengirim: 'andi', dihapusAt: '2026-09-16T07:02:00Z' }), 'andi'),
      null
    )
  })
})

describe('waktu & tanggal', () => {
  // Jam LOKAL dipakai dengan sengaja: yang dilihat orang adalah jam laptopnya.
  const sekarang = new Date(2026, 8, 16, 15, 30) // Rabu 16 Sep 2026 15:30
  const lokal = (hari: number, jam = 9, menit = 5): string =>
    new Date(2026, 8, hari, jam, menit).toISOString()

  test('label tanggal', () => {
    assert.equal(labelTanggal(lokal(16), sekarang), 'Hari ini')
    assert.equal(labelTanggal(lokal(15), sekarang), 'Kemarin')
    assert.equal(labelTanggal(lokal(13), sekarang), 'Minggu')
    assert.equal(labelTanggal(lokal(1), sekarang), '1 Sep 2026')
  })

  test('waktu di daftar', () => {
    assert.equal(waktuDaftar(lokal(16), sekarang), '09:05')
    assert.equal(waktuDaftar(lokal(15), sekarang), 'Kemarin')
    assert.equal(waktuDaftar(lokal(14), sekarang), 'Sen')
    assert.equal(waktuDaftar(lokal(1), sekarang), '01/09/26')
  })

  test('pemisah tanggal muncul hanya saat hari berganti', () => {
    const a = pesan({ createdAt: lokal(15, 23, 59) })
    const b = pesan({ createdAt: lokal(16, 0, 1) })
    const c = pesan({ createdAt: lokal(16, 8, 0) })
    assert.equal(hariBaru(undefined, a), true)
    assert.equal(hariBaru(a, b), true)
    assert.equal(hariBaru(b, c), false)
  })

  test('status orang', () => {
    assert.equal(statusOrang(rekan('budi', null, { online: true }), sekarang), 'online')
    assert.equal(statusOrang(rekan('budi', null), sekarang), 'belum pernah terlihat online')
    assert.equal(
      statusOrang(rekan('budi', null, { lastSeen: lokal(16, 14, 2) }), sekarang),
      'terakhir terlihat hari ini 14:02'
    )
  })
})

describe('kunci senyap', () => {
  test('layar dan pengawas notifikasi memakai kunci grup yang SAMA', () => {
    // Kalau keduanya menyimpang, tombol lonceng di layar menyala "senyap" tapi
    // notifikasi grupnya tetap berbunyi — saklar yang berbohong.
    for (const id of ['1', '42', '9007199254740993']) {
      assert.equal(kunciGrup(id), kunciSenyapGrup(id))
    }
  })
})

describe('avatar', () => {
  test('inisial', () => {
    assert.equal(inisial('budi.santoso'), 'BS')
    assert.equal(inisial('andi'), 'AN')
    assert.equal(inisial('Tim Lab QA'), 'TL')
    assert.equal(inisial('   '), '?')
  })

  test('warna tetap untuk orang yang sama, tanpa peka huruf besar', () => {
    assert.equal(warnaNama('Budi'), warnaNama('budi'))
    assert.match(warnaNama('budi'), /^#[0-9a-f]{6}$/)
  })
})

describe('tampilan Pesan tiga kolom (30 Sep 2026)', () => {
  const orang = (u: string, extra: Partial<RekanChat> = {}): RekanChat => ({
    username: u,
    role: 'staff',
    divisi: null,
    online: false,
    lastSeen: null,
    belumDibaca: 0,
    terakhir: null,
    ...extra
  })

  test('labelRole: kode dikenal diterjemahkan, yang asing apa adanya', () => {
    assert.equal(labelRole('super_admin'), 'Super Admin')
    assert.equal(labelRole('auditor'), 'auditor')
    assert.equal(labelRole(null), '')
  })

  test('jabatanRekan: divisi didahulukan, kalau kosong role', () => {
    assert.equal(jabatanRekan(orang('a', { divisi: 'Sales' })), 'Sales')
    assert.equal(jabatanRekan(orang('a', { divisi: '  ' })), 'Staff')
  })

  test('labelTanggalPanjang menyebut hari relatif DAN tanggal lengkap', () => {
    const kini = new Date(2026, 8, 26, 12, 0)
    assert.equal(labelTanggalPanjang(new Date(2026, 8, 26, 9).toISOString(), kini), 'Hari ini, 26 September 2026')
    assert.equal(labelTanggalPanjang(new Date(2026, 8, 25, 9).toISOString(), kini), 'Kemarin, 25 September 2026')
  })

  test('saringItem: belum/grup/favorit', () => {
    const a: ItemPercakapan = { jenis: 'orang', kunci: 'orang:a', rekan: orang('a', { belumDibaca: 2 }) }
    const b: ItemPercakapan = { jenis: 'orang', kunci: 'orang:b', rekan: orang('b') }
    const fav = new Set(['orang:b'])
    assert.equal(saringItem(a, 'belum', fav), true)
    assert.equal(saringItem(b, 'belum', fav), false)
    assert.equal(saringItem(a, 'grup', fav), false)
    assert.equal(saringItem(b, 'favorit', fav), true)
    assert.equal(saringItem(a, 'semua', fav), true)
  })
})
