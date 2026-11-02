import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { hashPassword, verifyPassword, sudahDihash } from '../src/main/auth/password'
import {
  normalkanUsername,
  periksaAkun,
  sudahKedaluwarsa,
  PESAN_KREDENSIAL_SALAH,
  type Akun
} from '../src/main/auth/account'
import {
  AKSES_TAK_TERCABUT,
  bolehKelolaUser,
  butuhDivisi,
  kodeDivisi,
  matriksDariLama,
  MENUS,
  menuDiizinkan,
  menuDiizinkanLama,
  menuUntuk,
  validasiDivisi,
  type MatriksAksesMenu,
  type MatriksDivisiLama,
  type MatriksRoleLama
} from '../src/main/auth/roles'
import { applySchema } from '../src/main/auth/schema'
import { assertBukanTabelAuth, assertReadOnly } from '../src/main/tools/db-safety'
import { LOCKED_ROLES, ROLE_DIATUR, ROLE_VALUES } from '../src/shared/ipc'
import { alamatLan, ringkasIdentitas } from '../src/main/auth/identity'
import { masalahKoneksi } from '../src/main/db-retry'

// Test regresi untuk login & akses menu. Setiap perilaku yang diputuskan sadar
// dikunci di sini — terutama yang kalau rusak GAGALNYA DIAM: menu yang seharusnya
// tertutup jadi terbuka, atau hash password yang ternyata bisa ditarik lewat tool.

const akun = (patch: Partial<Akun> = {}): Akun => ({
  username: 'spv',
  role: 'spv',
  expDate: null,
  isBanned: false,
  bannedReason: null,
  ...patch
})

describe('password (scrypt)', () => {
  test('hash bukan password polos, dan verifikasinya cocok', async () => {
    const hash = await hashPassword('12345')
    assert.notEqual(hash, '12345')
    assert.ok(sudahDihash(hash))
    assert.equal(await verifyPassword('12345', hash), true)
  })

  test('password salah ditolak', async () => {
    const hash = await hashPassword('12345')
    assert.equal(await verifyPassword('12346', hash), false)
    assert.equal(await verifyPassword('', hash), false)
    assert.equal(await verifyPassword('12345 ', hash), false)
  })

  test('dua hash dari password sama berbeda (salt acak)', async () => {
    const a = await hashPassword('12345')
    const b = await hashPassword('12345')
    assert.notEqual(a, b)
    // Tapi keduanya tetap membuka password yang sama.
    assert.equal(await verifyPassword('12345', a), true)
    assert.equal(await verifyPassword('12345', b), true)
  })

  test('hash rusak/asing dijawab false, bukan melempar error', async () => {
    // Baris database yang korup tidak boleh naik jadi exception yang mungkin
    // tertangkap di tempat lain sebagai "kesalahan sementara" lalu diabaikan.
    for (const rusak of [
      '',
      '12345',
      'scrypt$16384$8$1$AA==',
      'scrypt$abc$8$1$AA==$AA==',
      'bcrypt$16384$8$1$AA==$AA==',
      'scrypt$16384$8$1$$'
    ]) {
      assert.equal(await verifyPassword('12345', rusak), false, `hash: ${rusak}`)
    }
  })

  test('parameter biaya ikut di hash, jadi hash lama tetap terverifikasi', async () => {
    const hash = await hashPassword('rahasia')
    const [algo, n, r, p] = hash.split('$')
    assert.equal(algo, 'scrypt')
    assert.ok(Number(n) >= 16384)
    assert.equal(Number(r), 8)
    assert.equal(Number(p), 1)
  })
})

describe('username user baru', () => {
  test('dinormalkan ke huruf kecil dan dipangkas spasi tepinya', () => {
    // Login mencocokkan tanpa memandang huruf besar-kecil. Kalau yang DISIMPAN
    // masih "Budi.Santoso", daftar user menampilkan satu bentuk sementara aturan
    // yang berlaku bentuk lain — beda yang tidak bisa dilihat user.
    assert.equal(normalkanUsername('  Budi.Santoso '), 'budi.santoso')
    assert.equal(normalkanUsername('SPV2'), 'spv2')
  })

  test('bentuk yang sah diterima', () => {
    for (const u of ['abc', 'budi.santoso', 'spv_cikarang', 'user-01', 'a1b2c3']) {
      assert.equal(normalkanUsername(u), u, u)
    }
  })

  test('bentuk yang menyusahkan ditolak', () => {
    for (const u of [
      'ab', // terlalu pendek
      'budi santoso', // spasi — "budi  santoso" akan terlihat sama di layar
      '.budi', // diawali tanda baca
      '-budi',
      'budi@company', // karakter yang gampang tertukar saat didikte
      'budi/santoso',
      '',
      '   ',
      'a'.repeat(51)
    ]) {
      assert.equal(normalkanUsername(u), null, JSON.stringify(u))
    }
  })
})

describe('masa berlaku akun', () => {
  const hariIni = new Date(2026, 7, 18, 14, 30) // 18 Agu 2026 siang

  test('tanpa exp_date = tidak pernah kedaluwarsa', () => {
    assert.equal(sudahKedaluwarsa(null, hariIni), false)
  })

  test('kedaluwarsa TEPAT hari ini masih berlaku sepanjang hari', () => {
    // exp_date bertipe DATE (tanpa jam). Kalau perbandingannya memakai jam,
    // akun yang berlaku "sampai 18 Agustus" mati sejak tengah malam 18 Agustus.
    assert.equal(sudahKedaluwarsa(new Date(2026, 7, 18), hariIni), false)
    assert.equal(sudahKedaluwarsa(new Date(2026, 7, 18, 23, 59), hariIni), false)
  })

  test('kemarin sudah kedaluwarsa, besok belum', () => {
    assert.equal(sudahKedaluwarsa(new Date(2026, 7, 17), hariIni), true)
    assert.equal(sudahKedaluwarsa(new Date(2026, 7, 19), hariIni), false)
  })

  test('akun kedaluwarsa ditolak dengan tanggalnya disebut', () => {
    const hasil = periksaAkun(akun({ expDate: new Date(2026, 6, 1) }), hariIni)
    assert.equal(hasil.ok, false)
    assert.equal(hasil.alasan, 'kedaluwarsa')
    assert.match(hasil.pesan!, /2026/)
  })
})

describe('blokir akun', () => {
  const hariIni = new Date(2026, 7, 18)

  test('akun diblokir ditolak, alasannya ikut ditampilkan', () => {
    const hasil = periksaAkun(akun({ isBanned: true, bannedReason: 'sudah resign' }), hariIni)
    assert.equal(hasil.ok, false)
    assert.equal(hasil.alasan, 'diblokir')
    assert.match(hasil.pesan!, /sudah resign/)
  })

  test('diblokir tanpa alasan tetap ditolak dengan kalimat yang bisa ditindaklanjuti', () => {
    const hasil = periksaAkun(akun({ isBanned: true }), hariIni)
    assert.equal(hasil.ok, false)
    assert.match(hasil.pesan!, /Super Admin/)
  })

  test('BLOKIR menang atas kedaluwarsa', () => {
    // Akun yang diblokir DAN kedaluwarsa harus tercatat "diblokir" di log —
    // itu tindakan sengaja seseorang, dan tidak boleh tersamar jadi kejadian
    // administratif biasa saat riwayatnya ditelusuri.
    const hasil = periksaAkun(
      akun({ isBanned: true, bannedReason: 'nakal', expDate: new Date(2020, 0, 1) }),
      hariIni
    )
    assert.equal(hasil.alasan, 'diblokir')
  })

  test('akun sehat lolos', () => {
    assert.equal(periksaAkun(akun(), hariIni).ok, true)
    assert.equal(periksaAkun(akun({ expDate: new Date(2030, 0, 1) }), hariIni).ok, true)
  })
})

describe('akses menu: matriks role × divisi per menu', () => {
  // Keadaan yang diminta user 30 Sep 2026 dan TIDAK BISA diatur dengan dua
  // matriks lama (lihat blok "kenapa matriks lama diganti" di bawah).
  const kasusUser: MatriksAksesMenu = {
    sales: {
      manager: { pa_tp: true },
      spv: { it: true, pa_tp: false }
    }
  }

  test('kasus user: Manager PA TP boleh, SPV PA TP tidak, SPV IT boleh', () => {
    assert.equal(menuDiizinkan({ role: 'manager', divisi: ['pa_tp'] }, 'sales', kasusUser), true)
    assert.equal(menuDiizinkan({ role: 'spv', divisi: ['pa_tp'] }, 'sales', kasusUser), false)
    assert.equal(menuDiizinkan({ role: 'spv', divisi: ['it'] }, 'sales', kasusUser), true)
  })

  test('centangan role LAIN di divisi yang sama tidak berlaku', () => {
    // Inti perbaikannya. Di matriks lama centangan divisi berlaku untuk semua role.
    assert.equal(menuDiizinkan({ role: 'staff', divisi: ['pa_tp'] }, 'sales', kasusUser), false)
    assert.equal(menuDiizinkan({ role: 'manager', divisi: ['it'] }, 'sales', kasusUser), false)
  })

  test('Direktur & Super Admin selalu boleh, matriks diabaikan', () => {
    // ⚠️ Dibandingkan dengan MENUS, bukan daftar harfiah: menu yang ditambahkan
    // kelak wajib ikut terbuka untuk kedua role ini (pelajaran 27 Agu 2026).
    const semuaFalse: MatriksAksesMenu = {
      sales: { direktur: { it: false }, super_admin: { it: false } }
    }
    assert.deepEqual(menuUntuk({ role: 'direktur', divisi: [] }, semuaFalse), [...MENUS])
    assert.deepEqual(menuUntuk({ role: 'super_admin', divisi: [] }, {}), [...MENUS])
  })

  test('cukup SATU divisi yang cocok dari beberapa yang dipegang', () => {
    // SPV/Manager kerap memegang 2-3 divisi; menuntut semuanya cocok akan
    // membuat orang justru kehilangan akses saat diberi divisi tambahan.
    const ctx = { role: 'spv' as const, divisi: ['hrga', 'logistik', 'it'] }
    assert.equal(menuDiizinkan(ctx, 'sales', kasusUser), true)
  })

  test('tanpa baris = tertutup (menu baru & divisi baru lahir tertutup)', () => {
    assert.deepEqual(menuUntuk({ role: 'manager', divisi: ['pa_tp'] }, {}), [])
    // Divisi yang tidak punya sel (mis. baru dibuat lewat panel).
    assert.equal(menuDiizinkan({ role: 'manager', divisi: ['divisi_baru'] }, 'sales', kasusUser), false)
    // Menu yang belum punya baris sama sekali.
    assert.equal(menuDiizinkan({ role: 'manager', divisi: ['pa_tp'] }, 'lab', kasusUser), false)
  })

  test('user tanpa divisi tidak melihat menu apa pun (selain role terkunci)', () => {
    assert.deepEqual(menuUntuk({ role: 'staff', divisi: [] }, kasusUser), [])
  })

  test('nilai selain true dianggap tidak diizinkan', () => {
    const aneh = { sales: { manager: { pa_tp: 'true' as unknown as boolean } } }
    assert.equal(menuDiizinkan({ role: 'manager', divisi: ['pa_tp'] }, 'sales', aneh), false)
  })

  test('tiap menu dinilai sendiri-sendiri', () => {
    const m: MatriksAksesMenu = { masterdata: { spv: { pa_tp: true } } }
    assert.deepEqual(menuUntuk({ role: 'spv', divisi: ['pa_tp'] }, m), ['masterdata'])
  })

  test('ROLE_DIATUR = semua role selain yang terkunci', () => {
    // Kolom matriks di panel Super Admin DAN enum Zod `SetAksesSchema` memakai
    // himpunan ini. Kalau role baru ditambahkan, ia wajib ikut bisa diatur.
    assert.deepEqual(
      [...ROLE_DIATUR].sort(),
      ROLE_VALUES.filter((r) => !LOCKED_ROLES.includes(r)).sort()
    )
    assert.deepEqual([...ROLE_DIATUR].sort(), ['manager', 'spv', 'staff'])
  })

  test('hanya Super Admin yang boleh mengelola user', () => {
    assert.equal(bolehKelolaUser('super_admin'), true)
    for (const role of ['direktur', 'manager', 'spv', 'staff'] as const) {
      assert.equal(bolehKelolaUser(role), false, role)
    }
  })

  test('daftar role terkunci di main = yang dipakai UI', () => {
    // UI mengunci checkbox berdasarkan LOCKED_ROLES; main menegakkan
    // AKSES_TAK_TERCABUT. Kalau keduanya berbeda, UI menjanjikan sesuatu yang
    // tidak ditepati - atau mengunci checkbox untuk role yang sebenarnya bebas.
    assert.deepEqual([...AKSES_TAK_TERCABUT], [...LOCKED_ROLES])
  })

  test('role yang dikunci akses = role yang tidak punya divisi', () => {
    // Dua aturan terpisah yang HARUS sejalan. Kalau ada role tanpa divisi yang
    // tidak terkunci, ia tidak akan pernah melihat menu apa pun; kalau ada role
    // terkunci yang wajib berdivisi, divisinya jadi pajangan yang menyesatkan.
    for (const role of ROLE_VALUES) {
      assert.equal(
        AKSES_TAK_TERCABUT.includes(role),
        !butuhDivisi(role),
        role + ': terkunci=' + AKSES_TAK_TERCABUT.includes(role) + ' butuhDivisi=' + butuhDivisi(role)
      )
    }
  })
})

describe('kenapa matriks lama diganti (laporan user 30 Sep 2026)', () => {
  test('TIDAK ADA satu pun pengaturan matriks lama yang menghasilkan keinginan user', () => {
    // Dicoba SELURUH kemungkinan centangan lama untuk menu Sales dengan dua role
    // (Manager, SPV) dan dua divisi (PA TP, IT): 2^2 × 2^2 = 16 pengaturan.
    // Yang diinginkan: Manager PA TP boleh, SPV PA TP tidak, SPV IT boleh.
    // Kalau test ini kelak gagal, berarti aturan lama berubah — bukan berarti
    // matriks baru tidak perlu.
    let cocok = 0
    for (const mgr of [false, true])
      for (const spv of [false, true])
        for (const paTp of [false, true])
          for (const it of [false, true]) {
            const r: MatriksRoleLama = { manager: { sales: mgr }, spv: { sales: spv } }
            const d: MatriksDivisiLama = { sales: { pa_tp: paTp, it } }
            const hasil = [
              menuDiizinkanLama({ role: 'manager', divisi: ['pa_tp'] }, 'sales', r, d),
              menuDiizinkanLama({ role: 'spv', divisi: ['pa_tp'] }, 'sales', r, d),
              menuDiizinkanLama({ role: 'spv', divisi: ['it'] }, 'sales', r, d)
            ]
            if (hasil[0] && !hasil[1] && hasil[2]) cocok++
          }
    assert.equal(cocok, 0)
  })
})

describe('migrasi matriks lama → matriks role × divisi', () => {
  // Acak tapi TERULANG (seed tetap) — kegagalan harus bisa diulang persis.
  const acak = (seed: number): (() => number) => {
    let x = seed
    return () => {
      x = (x * 1103515245 + 12345) % 2147483648
      return x / 2147483648
    }
  }
  const DIVISI = ['ip', 'pk', 'pa_tp', 'pa_ihc', 'it', 'qms', 'sales']

  test('hasil akses SETIAP orang identik sebelum dan sesudah migrasi', () => {
    // Janji ke user: tidak ada satu orang pun yang aksesnya berubah hari ini.
    for (let seed = 1; seed <= 200; seed++) {
      const r = acak(seed)
      const roleLama: MatriksRoleLama = {}
      const divLama: MatriksDivisiLama = {}
      for (const role of ROLE_VALUES) {
        for (const menu of MENUS) roleLama[role] = { ...roleLama[role], [menu]: r() < 0.5 }
      }
      for (const menu of MENUS) {
        const sel: Record<string, boolean> = {}
        for (const k of DIVISI) if (r() < 0.8) sel[k] = r() < 0.5
        divLama[menu] = sel
      }
      const baru = matriksDariLama(roleLama, divLama, DIVISI)

      for (const role of ROLE_VALUES) {
        // Kombinasi divisi 0, 1, dan beberapa.
        for (const divisi of [[], [DIVISI[seed % DIVISI.length]], DIVISI.filter(() => r() < 0.4)]) {
          for (const menu of MENUS) {
            assert.equal(
              menuDiizinkan({ role, divisi }, menu, baru),
              menuDiizinkanLama({ role, divisi }, menu, roleLama, divLama),
              `seed=${seed} role=${role} menu=${menu} divisi=${divisi.join('|')}`
            )
          }
        }
      }
    }
  })

  test('keadaan produksi 30 Sep: SPV Sales tertutup, Manager PA terbuka — tetap sama', () => {
    // Potongan matriks produksi yang dilaporkan user, dibaca langsung dari database.
    const roleLama: MatriksRoleLama = {
      manager: { sales: true, masterdata: true, lab: true, onedrive: true },
      spv: { sales: false, masterdata: true, lab: true, onedrive: true }
    }
    const divLama: MatriksDivisiLama = {
      sales: { pa_tp: true, pa_ihc: true, pa_mol: true, it: true, qms: true, hrga: false },
      masterdata: { pa_tp: true, it: true }
    }
    const baru = matriksDariLama(roleLama, divLama, ['pa_tp', 'pa_ihc', 'pa_mol', 'it', 'qms', 'hrga'])
    const pa = ['pa_mol', 'pa_ihc', 'pa_tp']
    assert.deepEqual(menuUntuk({ role: 'manager', divisi: pa }, baru), ['sales', 'masterdata'])
    assert.deepEqual(menuUntuk({ role: 'spv', divisi: pa }, baru), ['masterdata'])
    assert.deepEqual(menuUntuk({ role: 'spv', divisi: ['it'] }, baru), ['masterdata'])
  })

  test('divisi yang tidak ada di tabel divisi lama ikut mendapat sel false, bukan terbuka', () => {
    const baru = matriksDariLama({ manager: { sales: true } }, { sales: {} }, ['baru'])
    assert.equal(baru.sales?.manager?.baru, false)
  })

  test('role terkunci tidak ikut dimigrasi (tidak ada baris untuk mereka)', () => {
    const baru = matriksDariLama({ direktur: { sales: true } }, { sales: { it: true } }, ['it'])
    for (const menu of MENUS) {
      assert.equal(baru[menu]?.direktur, undefined)
      assert.equal(baru[menu]?.super_admin, undefined)
    }
  })
})

describe('skema: pengisian awal matriks', () => {
  // Menjalankan applySchema dengan executor PALSU yang mencatat setiap SQL.
  const jalankanSkema = async (): Promise<string[]> => {
    const sql: string[] = []
    await applySchema(
      async (q) => {
        sql.push(q)
        return undefined
      },
      async () => [{ u: 'superadmin' }, { u: 'direktur' }]
    )
    return sql
  }

  test('tidak ada lagi pengisian matriks lama yang membuka divisi baru', async () => {
    // Bug 30 Sep 2026: "Sales + Master Data untuk SEMUA divisi" berjalan tiap start
    // dengan CROSS JOIN ke tb_divisi_aira. Divisi yang dibuat lewat panel ikut
    // terbuka di start berikutnya, di laptop mana pun.
    const sql = await jalankanSkema()
    const tulisLama = sql.filter((q) =>
      /INSERT\s+INTO\s+tb_menu_(divisi|akses)_aira\b/i.test(q)
    )
    assert.deepEqual(tulisLama, [])
  })

  test('migrasi ke matriks baru hanya berjalan selama tabel baru KOSONG', async () => {
    // Tanpa syarat ini, migrasi berjalan tiap start dan membuka kembali apa yang
    // baru saja ditutup Super Admin (ON CONFLICT DO NOTHING tidak menolong untuk
    // sel yang barisnya belum pernah ada).
    const sql = await jalankanSkema()
    const migrasi = sql.filter((q) => /INSERT\s+INTO\s+tb_menu_role_divisi_aira/i.test(q))
    assert.equal(migrasi.length, 1)
    assert.match(migrasi[0], /NOT EXISTS \(SELECT 1 FROM tb_menu_role_divisi_aira\)/)
    // Rumus sel = role DAN divisi, sama dengan matriksDariLama.
    assert.match(migrasi[0], /r\.diizinkan AND coalesce\(md\.diizinkan, false\)/)
    // Direktur & Super Admin tidak ikut.
    assert.match(migrasi[0], /r\.role IN \('manager', 'spv', 'staff'\)/)
  })

  test('tabel matriks baru dan larangan role terkuncinya ada di DDL', async () => {
    const sql = (await jalankanSkema()).join('\n')
    assert.match(sql, /CREATE TABLE IF NOT EXISTS tb_menu_role_divisi_aira/)
    assert.match(sql, /CHECK \(role IN \('manager', 'spv', 'staff'\)\)/)
  })
})

describe('aturan jumlah divisi per role', () => {
  test('Direktur & Super Admin tidak boleh diberi divisi', () => {
    for (const role of ['direktur', 'super_admin'] as const) {
      assert.equal(validasiDivisi(role, []), null, role)
      assert.match(validasiDivisi(role, ['pk'])!, /tidak perlu/, role)
    }
  })

  test('Staff tepat satu divisi', () => {
    assert.equal(validasiDivisi('staff', ['pk']), null)
    assert.match(validasiDivisi('staff', [])!, /wajib/)
    assert.match(validasiDivisi('staff', ['pk', 'it'])!, /hanya boleh satu/)
  })

  test('Manager & SPV minimal satu, boleh banyak', () => {
    for (const role of ['manager', 'spv'] as const) {
      assert.match(validasiDivisi(role, [])!, /minimal/, role)
      assert.equal(validasiDivisi(role, ['pk']), null, role)
      assert.equal(validasiDivisi(role, ['pk', 'it', 'genomics']), null, role)
    }
  })

  test('divisi kembar dihitung sekali', () => {
    // Kalau tidak, "pk" terkirim dua kali membuat Staff tampak punya 2 divisi
    // dan ditolak, padahal user hanya mencentang satu.
    assert.equal(validasiDivisi('staff', ['pk', 'pk']), null)
  })

  test('string kosong diabaikan', () => {
    assert.match(validasiDivisi('staff', ['', '  '])!, /wajib/)
  })
})

describe('kode divisi', () => {
  test('nama diubah jadi kode yang aman untuk kolom', () => {
    assert.equal(kodeDivisi('PA TP'), 'pa_tp')
    assert.equal(kodeDivisi('PA IHC'), 'pa_ihc')
    assert.equal(kodeDivisi('Mikrobiologi'), 'mikrobiologi')
    assert.equal(kodeDivisi('  HRGA  '), 'hrga')
    assert.equal(kodeDivisi('R&D Lab'), 'r_d_lab')
  })

  test('nama tanpa karakter sah ditolak', () => {
    for (const n of ['', '   ', '!!!', '---']) {
      assert.equal(kodeDivisi(n), null, JSON.stringify(n))
    }
  })

  test('kode cocok dengan pola yang diterima schema Zod IPC', () => {
    // Zod di main/ipc.ts menolak kode di luar /^[a-z0-9_]{1,40}$/. Kalau
    // kodeDivisi menghasilkan bentuk lain, divisi baru lolos dibuat tapi tidak
    // pernah bisa dipakai - gagal jauh dari tempat sebabnya.
    for (const n of ['PA TP', 'CRIO', 'Intern', 'R&D Lab', 'Sales']) {
      assert.match(kodeDivisi(n)!, /^[a-z0-9_]{1,40}$/, n)
    }
  })
})

describe('tabel login tidak bisa disentuh tool database', () => {
  const terlarang = [
    'SELECT * FROM tb_login_aira',
    'select username, password from public.tb_login_aira',
    'SELECT * FROM TB_LOGIN_AIRA',
    'SELECT * FROM tb_login_aira_log ORDER BY ts DESC',
    'SELECT * FROM tb_menu_akses_aira',
    // Matriks pengganti (30 Sep 2026) dan matriks divisi lama — yang terakhir dulu
    // lolos: tidak pernah ada di daftar larangan.
    "UPDATE tb_menu_role_divisi_aira SET diizinkan = true WHERE role = 'spv'",
    'SELECT * FROM tb_menu_divisi_aira',
    'WITH x AS (SELECT password FROM tb_login_aira) SELECT * FROM x',
    'SELECT a.password FROM tb_login_aira a JOIN m_customer c ON true',
    "UPDATE tb_login_aira SET role = 'super_admin' WHERE username = 'spv'",
    'DROP TABLE tb_login_aira',
    'SELECT (SELECT password FROM tb_login_aira LIMIT 1) AS bocor'
  ]

  for (const sql of terlarang) {
    test(`ditolak: ${sql.slice(0, 52)}`, () => {
      // ⚠️ Yang diuji PENOLAKANNYA, bukan kalimat spesifik satu tabel.
      // Versi sebelumnya menuntut /kredensial login/ untuk SEMUA tabel di daftar —
      // termasuk tb_login_aira_log (riwayat masuk) dan tb_menu_akses_aira (matriks
      // izin), yang isinya bukan kredensial. Jadi test itu justru MENGUNCI pesan
      // penolakan yang salah alasan, dan ia baru ketahuan saat tabel chat
      // ditambahkan 8 Sep 2026. Alasan per tabel diuji terpisah di bawah.
      assert.throws(() => assertBukanTabelAuth(sql), /tidak bisa diakses lewat tool database/)
    })
  }

  test('alasan penolakan sesuai isi tabelnya, bukan satu kalimat untuk semua', () => {
    assert.throws(() => assertBukanTabelAuth('select * from tb_login_aira'), /kredensial login/)
    assert.throws(
      () => assertBukanTabelAuth('select * from tb_login_aira_log'),
      /riwayat percobaan masuk/
    )
    assert.throws(
      () => assertBukanTabelAuth('select * from tb_menu_akses_aira'),
      /matriks hak akses/
    )
  })

  test('query biasa tetap boleh', () => {
    for (const sql of [
      'SELECT count(*) FROM "SalesRepository"',
      'SELECT * FROM m_customer LIMIT 10',
      'SELECT * FROM tb_login_aira_lain'
    ]) {
      assert.doesNotThrow(() => assertBukanTabelAuth(sql))
    }
  })

  test('SELECT ke tabel login lolos assertReadOnly — jadi guard ini memang perlu', () => {
    // Membuktikan kenapa daftar-tolak dibutuhkan: pemeriksaan read-only yang
    // sudah ada TIDAK menahan pembacaan hash password sama sekali.
    assert.doesNotThrow(() => assertReadOnly('SELECT * FROM tb_login_aira'))
  })
})

describe('kegagalan koneksi yang layak dicoba ulang', () => {
  // Membuka koneksi BARU dari main process Electron tidak andal — sudah terlihat
  // tiga kali (pool.connect 18 Agu; panel Settings kosong 19 Agu; sales_summary
  // gagal 3x sesudah menganggur 66 detik 19 Agu). Percobaan ulang menutup celah itu.
  test('kegagalan mendapatkan koneksi diulang', () => {
    for (const pesan of [
      'Connection terminated due to connection timeout',
      'timeout exceeded when trying to connect',
      'Connection terminated unexpectedly',
      'read ECONNRESET',
      'connect ECONNREFUSED 10.0.0.10:5432',
      'socket hang up'
    ]) {
      assert.equal(masalahKoneksi(new Error(pesan)), true, pesan)
    }
  })

  test('query yang KELAMAAN tidak diulang', () => {
    // Mengulang query berat yang kena statement_timeout menggandakan beban di
    // database produksi dan hampir pasti gagal lagi dengan cara yang sama.
    for (const pesan of [
      'canceling statement due to statement timeout',
      'ERROR: canceling statement due to user request'
    ]) {
      assert.equal(masalahKoneksi(new Error(pesan)), false, pesan)
    }
  })

  test('kesalahan SQL biasa tidak diulang', () => {
    for (const pesan of [
      'relation "tb_tidak_ada" does not exist',
      'syntax error at or near "SELCT"',
      'permission denied for table SalesRepository'
    ]) {
      assert.equal(masalahKoneksi(new Error(pesan)), false, pesan)
    }
  })

  test('nilai aneh tidak menjatuhkan pemeriksaan', () => {
    for (const nilai of [null, undefined, '', 0, {}, 'Connection terminated due to connection timeout']) {
      assert.equal(typeof masalahKoneksi(nilai), 'boolean', JSON.stringify(nilai))
    }
    // String telanjang pun dikenali — pg tidak selalu membungkusnya sebagai Error.
    assert.equal(masalahKoneksi('Connection terminated due to connection timeout'), true)
  })
})

describe('identitas mesin', () => {
  test('alamat LAN berupa IPv4 atau null', () => {
    const ip = alamatLan()
    if (ip !== null) assert.match(ip, /^\d{1,3}(\.\d{1,3}){3}$/)
  })

  test('ringkasan tetap terbaca saat sebagian kosong', () => {
    assert.equal(ringkasIdentitas({ hostname: 'PC-1', osUser: 'budi', ip: '10.1.2.3' }), 'PC-1 (budi) 10.1.2.3')
    assert.equal(ringkasIdentitas({ hostname: null, osUser: null, ip: null }), '—')
  })
})

describe('pesan ke user tidak membocorkan akun mana yang ada', () => {
  test('username tidak terdaftar & password salah memakai kalimat yang sama', () => {
    // Kalau dibedakan, layar login berubah jadi alat memastikan username direksi
    // mana yang benar-benar terdaftar. Log tetap menyimpan alasan sebenarnya.
    assert.match(PESAN_KREDENSIAL_SALAH, /Username atau password salah/)
  })
})
