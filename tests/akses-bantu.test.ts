import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  daftarPerubahan,
  halamanDari,
  kunciSel,
  nilaiTampil,
  statistik,
  susunBaris,
  ubahDraf
} from '../src/renderer/src/components/akses/bantu'
import type { AuthUserRow, Divisi, RoleDivisionMatrix } from '../src/shared/ipc'

// Layar Akses Menu per Role & Divisi (30 Sep 2026): centangan masuk DRAF dulu, lalu
// disimpan sekaligus. Yang dikunci di sini: draf tidak pernah mengirim sel yang
// sebenarnya tidak berubah, dan saringan/urutan/halaman tidak menyembunyikan baris.

const tersimpan: RoleDivisionMatrix = {
  sales: { manager: { pa_tp: true, it: true }, spv: { pa_tp: false } }
}

const user = (username: string, role: AuthUserRow['role'], divisi: string[], menu: AuthUserRow['menuTerlihat'] = []): AuthUserRow => ({
  username,
  role,
  divisi,
  menuTerlihat: menu,
  expDate: null,
  isBanned: false,
  bannedReason: null,
  lastLoginAt: null,
  lastLoginIp: null,
  lastLoginHost: null
})

describe('draf centangan', () => {
  test('centang lalu batal centang = bukan perubahan', () => {
    // Kalau tidak, tombol "Simpan Perubahan 1" menyala padahal tidak ada yang berubah,
    // dan menyimpannya menulis ulang updated_by/updated_at tanpa alasan.
    let d = ubahDraf(tersimpan, {}, [{ menu: 'sales', role: 'spv', divisi: 'it', diizinkan: true }])
    assert.equal(daftarPerubahan(tersimpan, d).length, 1)
    d = ubahDraf(tersimpan, d, [{ menu: 'sales', role: 'spv', divisi: 'it', diizinkan: false }])
    assert.deepEqual(d, {})
    assert.deepEqual(daftarPerubahan(tersimpan, d), [])
  })

  test('mengubah ke nilai yang sudah tersimpan tidak masuk draf', () => {
    const d = ubahDraf(tersimpan, {}, [{ menu: 'sales', role: 'manager', divisi: 'pa_tp', diizinkan: true }])
    assert.deepEqual(d, {})
  })

  test('nilai yang TAMPIL mengikuti draf, lalu tersimpan', () => {
    const d = ubahDraf(tersimpan, {}, [{ menu: 'sales', role: 'manager', divisi: 'it', diizinkan: false }])
    assert.equal(nilaiTampil(tersimpan, d, 'sales', 'manager', 'it'), false)
    assert.equal(nilaiTampil(tersimpan, d, 'sales', 'manager', 'pa_tp'), true)
    // Tanpa baris = tertutup, sama dengan menuDiizinkan di main.
    assert.equal(nilaiTampil(tersimpan, d, 'lab', 'staff', 'ip'), false)
  })

  test('daftar perubahan membawa menu, role, divisi yang benar (termasuk kode bergaris bawah)', () => {
    const d = ubahDraf(tersimpan, {}, [
      { menu: 'sales', role: 'spv', divisi: 'pa_tp', diizinkan: true },
      { menu: 'masterdata', role: 'staff', divisi: 'pa_ihc', diizinkan: true }
    ])
    assert.deepEqual(
      daftarPerubahan(tersimpan, d).sort((a, b) => a.menu.localeCompare(b.menu)),
      [
        { menu: 'masterdata', role: 'staff', divisi: 'pa_ihc', diizinkan: true },
        { menu: 'sales', role: 'spv', divisi: 'pa_tp', diizinkan: true }
      ]
    )
  })

  test('draf lintas menu disimpan bersama', () => {
    // Pindah tab tidak membuang draf menu lain — tombol Simpan menyimpan semuanya.
    const d = ubahDraf(tersimpan, {}, [
      { menu: 'sales', role: 'spv', divisi: 'it', diizinkan: true },
      { menu: 'lab', role: 'spv', divisi: 'it', diizinkan: true }
    ])
    assert.equal(daftarPerubahan(tersimpan, d).length, 2)
    assert.ok(kunciSel('lab', 'spv', 'it') in d)
  })
})

describe('saringan, urutan, halaman', () => {
  const daftar: Divisi[] = [
    { kode: 'ip', nama: 'IP', aktif: true },
    { kode: 'pa_tp', nama: 'PA TP', aktif: true },
    { kode: 'it', nama: 'IT', aktif: true },
    { kode: 'lama', nama: 'Divisi Lama', aktif: false }
  ]
  const nilai = (role: string, kode: string): boolean => nilaiTampil(tersimpan, {}, 'sales', role as never, kode)
  const jumlah = (): number => 0
  const opsi = { cari: '', status: 'all' as const, urutan: { kolom: 'no' as const, naik: true }, nilai, jumlahUser: jumlah }

  test('nomor urut asli dipertahankan walau disaring', () => {
    const b = susunBaris(daftar, { ...opsi, cari: 'it' })
    assert.deepEqual(b.map((x) => [x.no, x.nama]), [[3, 'IT']])
  })

  test('cari tidak peka huruf besar-kecil', () => {
    assert.equal(susunBaris(daftar, { ...opsi, cari: 'pa t' }).length, 1)
  })

  test('saringan status aktif/nonaktif', () => {
    assert.deepEqual(susunBaris(daftar, { ...opsi, status: 'inactive' }).map((x) => x.kode), ['lama'])
    assert.equal(susunBaris(daftar, { ...opsi, status: 'active' }).length, 3)
  })

  test('urut kolom role: yang tercentang dulu', () => {
    const b = susunBaris(daftar, { ...opsi, urutan: { kolom: 'manager', naik: true } })
    assert.deepEqual(b.slice(0, 2).map((x) => x.kode).sort(), ['it', 'pa_tp'])
  })

  test('urut divisi naik & turun', () => {
    assert.equal(susunBaris(daftar, { ...opsi, urutan: { kolom: 'division', naik: true } })[0].nama, 'Divisi Lama')
    assert.equal(susunBaris(daftar, { ...opsi, urutan: { kolom: 'division', naik: false } })[0].nama, 'PA TP')
  })

  test('halaman di luar jangkauan dijepit, tidak menghasilkan tabel kosong', () => {
    // Terjadi bila saringan mempersempit hasil saat user berada di halaman 3.
    const h = halamanDari([1, 2, 3, 4, 5], 9, 2)
    assert.equal(h.halaman, 3)
    assert.deepEqual(h.isi, [5])
    assert.equal(halamanDari([], 1, 20).jumlahHalaman, 1)
  })
})

describe('kartu statistik', () => {
  test('dihitung dari data tersimpan; Direktur & Super Admin tidak dihitung sebagai user berdivisi', () => {
    const daftar: Divisi[] = [
      { kode: 'it', nama: 'IT', aktif: true },
      { kode: 'x', nama: 'X', aktif: false }
    ]
    const users = [
      user('a', 'spv', ['it']),
      user('b', 'manager', []),
      user('direktur', 'direktur', []),
      user('superadmin', 'super_admin', [])
    ]
    const s = statistik(daftar, tersimpan, users, ['sales', 'masterdata', 'lab', 'onedrive'])
    assert.deepEqual(s, { divisi: 2, divisiNonaktif: 1, menuTerbuka: 1, role: 3, userBerdivisi: 1 })
  })
})
