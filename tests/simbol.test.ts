import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  bahasaDari,
  catatanSimbol,
  cocok,
  cuplikanDari,
  simbolDariNode,
  type NodeMirip
} from '../src/main/code/simbol-rules'
import { groupOf } from '../src/main/agent/tool-groups'

// Pencarian definisi kode berbasis tree-sitter (`cari_simbol`).

/** Node palsu secukupnya — modul aturannya memang tidak butuh WASM. */
function node(
  type: string,
  nama: string | null,
  baris = 0,
  teks = '',
  nilai?: string
): NodeMirip {
  return {
    type,
    startPosition: { row: baris },
    text: teks || `${type} ${nama ?? ''}`,
    childForFieldName: (f) => {
      if (f === 'name') return nama === null ? null : { text: nama }
      if (f === 'value') return nilai === undefined ? null : { text: nilai }
      return null
    }
  }
}

describe('pemetaan ekstensi ke grammar', () => {
  test('TypeScript & varian modulnya', () => {
    for (const f of ['a.ts', 'a.mts', 'a.cts']) assert.equal(bahasaDari(f), 'typescript')
  })

  // ⚠️ `.tsx` punya grammar SENDIRI. Memetakannya ke `typescript` membuat
  // seluruh berkas React gagal di-parse — dan gagalnya diam: nol simbol, tanpa
  // error, sehingga terbaca sebagai "tidak ada fungsi di sini".
  test('TSX TIDAK dipetakan ke grammar typescript', () => {
    assert.equal(bahasaDari('Komponen.tsx'), 'tsx')
    assert.notEqual(bahasaDari('Komponen.tsx'), bahasaDari('modul.ts'))
  })

  test('bahasa lain yang dibundel', () => {
    assert.equal(bahasaDari('s.py'), 'python')
    assert.equal(bahasaDari('S.java'), 'java')
    assert.equal(bahasaDari('m.go'), 'go')
    assert.equal(bahasaDari('a.jsx'), 'javascript')
  })

  test('berkas non-kode dikembalikan null, bukan ditebak', () => {
    for (const f of ['catatan.md', 'data.json', 'tanpa-ekstensi', 'gambar.png']) {
      assert.equal(bahasaDari(f), null)
    }
  })
})

describe('yang dicatat hanya DEFINISI, bukan pemanggilan', () => {
  // Ini seluruh alasan tool ini ada. Grep untuk "hitungTotal" mengembalikan
  // setiap baris yang menyebutnya — puluhan pemanggilan bercampur satu
  // definisi, tanpa cara membedakannya.
  test('deklarasi fungsi, kelas, dan tipe dikenali', () => {
    assert.equal(simbolDariNode(node('function_declaration', 'hitungTotal'), 'typescript', null)?.jenis, 'fungsi')
    assert.equal(simbolDariNode(node('class_declaration', 'Pool'), 'typescript', null)?.jenis, 'kelas')
    assert.equal(simbolDariNode(node('interface_declaration', 'Opsi'), 'typescript', null)?.jenis, 'tipe')
    assert.equal(simbolDariNode(node('type_alias_declaration', 'Mode'), 'typescript', null)?.jenis, 'tipe')
  })

  test('pemanggilan dan ekspresi lain TIDAK dianggap definisi', () => {
    for (const t of ['call_expression', 'identifier', 'import_statement', 'return_statement']) {
      assert.equal(simbolDariNode(node(t, 'hitungTotal'), 'typescript', null), null)
    }
  })

  test('definisi tanpa nama dilewati, bukan dicatat sebagai "(anonim)"', () => {
    assert.equal(simbolDariNode(node('function_declaration', null), 'typescript', null), null)
  })
})

describe('fungsi yang ditulis sebagai const arrow', () => {
  // ⚠️ Tanpa ini, `export const hitungTotal = () => {}` tidak pernah muncul —
  // dan justru bentuk itulah yang dipakai di hampir seluruh kode project ini.
  test('arrow function dikenali sebagai fungsi', () => {
    const s = simbolDariNode(
      node('variable_declarator', 'hitungTotal', 4, 'hitungTotal = () => {}', '() => {}'),
      'typescript',
      null
    )
    assert.equal(s?.jenis, 'fungsi')
    assert.equal(s?.nama, 'hitungTotal')
    assert.equal(s?.baris, 5, 'baris wajib 1-based, seperti yang dilihat orang di editor')
  })

  test('arrow async dan function expression ikut dikenali', () => {
    for (const nilai of ['async () => {}', 'function () {}', 'x => x + 1']) {
      const s = simbolDariNode(node('variable_declarator', 'f', 0, 'f = ...', nilai), 'typescript', null)
      assert.ok(s, `belum dikenali: ${nilai}`)
    }
  })

  // Pemeriksaannya sempit dengan sengaja: bukan setiap `const` adalah fungsi.
  test('konstanta biasa TIDAK dianggap fungsi', () => {
    for (const nilai of ['42', "'teks'", '{ a: 1 }', '[1, 2, 3]', 'new Pool()']) {
      assert.equal(
        simbolDariNode(node('variable_declarator', 'BATAS', 0, 'BATAS = ...', nilai), 'typescript', null),
        null,
        `keliru dianggap fungsi: ${nilai}`
      )
    }
  })
})

describe('metode membawa nama kelas induknya', () => {
  test('induk diisi untuk metode', () => {
    const s = simbolDariNode(node('method_definition', 'query'), 'typescript', 'Pool')
    assert.equal(s?.jenis, 'metode')
    assert.equal(s?.induk, 'Pool')
  })

  // Fungsi tingkat atas tidak punya induk — mengisinya membuat hasil menyesatkan.
  test('fungsi biasa TIDAK diberi induk walau kebetulan bersarang', () => {
    const s = simbolDariNode(node('function_declaration', 'bantu'), 'typescript', 'Pool')
    assert.equal(s?.induk, undefined)
  })
})

describe('cuplikan dipangkas dan tidak pernah berbaris banyak', () => {
  test('hanya baris pertama yang diambil', () => {
    assert.equal(cuplikanDari('function a() {\n  return 1\n}'), 'function a() {')
  })

  test('baris panjang dipotong dengan penanda', () => {
    const c = cuplikanDari('x'.repeat(200))
    assert.ok(c.length <= 111)
    assert.match(c, /…$/)
  })
})

describe('pencocokan nama', () => {
  test('sebagian nama & tidak peduli besar-kecil huruf', () => {
    assert.equal(cocok('catatanDaftar', 'catatan'), true)
    assert.equal(cocok('catatanDaftar', 'DAFTAR'), true)
    assert.equal(cocok('catatanDaftar', 'tidakAda'), false)
  })

  test('pencarian kosong berarti SEMUA, bukan tidak ada', () => {
    assert.equal(cocok('apa pun', ''), true)
  })
})

describe('catatan hasil TIDAK PERNAH kosong', () => {
  // Pelajaran berulang di project ini. Yang paling berbahaya di sini: berkas
  // yang gagal di-parse. Tanpa disebut, model menyimpulkan "fungsinya tidak
  // ada" padahal berkasnya cuma tidak sempat dibaca.
  test('nol hasil MENGARAHKAN ke search_code, bukan berhenti', () => {
    const c = catatanSimbol(0, 12, [], 'hitungTotal')
    assert.match(c, /hitungTotal/)
    assert.match(c, /search_code/)
    assert.match(c, /cuma dipanggil/i)
  })

  test('berkas yang gagal dibaca DISEBUT beserta alasannya', () => {
    const c = catatanSimbol(3, 10, [{ berkas: 'a.ts', alasan: 'terlalu besar' }], '')
    assert.match(c, /a\.ts/)
    assert.match(c, /terlalu besar/)
    assert.match(c, /jangan menyimpulkan simbolnya tidak ada/i)
  })

  test('banyak kegagalan diringkas tapi jumlahnya tetap disebut utuh', () => {
    const gagal = Array.from({ length: 9 }, (_, i) => ({ berkas: `f${i}.ts`, alasan: 'rusak' }))
    const c = catatanSimbol(1, 3, gagal, '')
    assert.match(c, /9 berkas TIDAK terbaca/)
  })

  test('selalu mengingatkan bahwa isinya definisi, bukan pemanggilan', () => {
    for (const c of [catatanSimbol(0, 1, [], 'x'), catatanSimbol(5, 5, [], '')]) {
      assert.match(c, /DEFINISI/)
      assert.ok(c.trim().length > 40)
    }
  })
})

describe('cari_simbol masuk kelompok dev', () => {
  // Sekelompok dengan edit_file & search_code supaya ikut terkirim untuk
  // kalimat yang memang soal koding — bukan kelompok baru yang tidak pernah aktif.
  test('kelompoknya dev', () => {
    assert.equal(groupOf('cari_simbol'), 'dev')
  })
})
