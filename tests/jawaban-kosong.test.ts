import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PESAN_KOSONG_TANPA_TOOL,
  PESAN_TANPA_JAWABAN,
  PESAN_TOKEN_HABIS,
  pesanBilaKosong,
  DORONGAN_JAWAB
} from '../src/main/agent/jawaban-kosong'

describe('jawaban kosong tidak boleh sampai ke layar (lapangan 8 Sep 2026)', () => {
  test('KASUS ASLI: model berhenti sendiri tanpa menulis jawaban', () => {
    // Kejadian nyata yang dilaporkan user dengan tangkapan layar:
    // "item apa sih yang menurun penjualannya" -> 3 chip tool, lalu KOSONG.
    //
    // ⚠️ finish_reason-nya `stop`, BUKAN `length`. Gateway the company tidak
    // membatasi keluaran — terukur 7.469 token dengan `stop`
    // (`scripts/probe-token.mjs`, 8 Sep 2026). Diagnosis pertama yang
    // menyalahkan `max_tokens` keliru; test ini mengunci kasus yang BENAR.
    const pesan = pesanBilaKosong({ content: '', finishReason: 'stop', jumlahTool: 3 })
    assert.equal(pesan, PESAN_TANPA_JAWABAN)
    assert.match(pesan!, /did not produce any answer text/)
  })

  test('jatah token habis tetap dibedakan — gejalanya identik, sebabnya lain', () => {
    // Terbukti bisa terjadi: `max_tokens: 100` menghasilkan reasoning 388 char
    // dan content 0 char. Kalau kelak ada yang menyetel max_tokens di AIRA,
    // cabang ini yang menyalakan pesan yang tepat.
    const pesan = pesanBilaKosong({ content: '', finishReason: 'length', jumlahTool: 3 })
    assert.equal(pesan, PESAN_TOKEN_HABIS)
    assert.match(pesan!, /ran out of its output allowance/)
  })

  test('pesan token habis MENYEBUT bahwa datanya sudah terambil', () => {
    // Penting: user melihat chip tool yang berhasil. Kalau pesannya berbunyi
    // seperti kegagalan total, ia akan mengira datanya juga gagal diambil.
    assert.match(PESAN_TOKEN_HABIS, /already\s+retrieved/)
  })

  test('pesan token habis memberi LANGKAH, bukan cuma keluhan', () => {
    assert.match(PESAN_TOKEN_HABIS, /asking again/i)
  })

  test('berhenti tanpa teks sesudah tool jalan', () => {
    assert.equal(pesanBilaKosong({ content: '', finishReason: 'stop', jumlahTool: 2 }), PESAN_TANPA_JAWABAN)
  })

  test('kosong tanpa tool sama sekali', () => {
    assert.equal(pesanBilaKosong({ content: '', jumlahTool: 0 }), PESAN_KOSONG_TANPA_TOOL)
  })

  test('spasi/baris kosong tetap dianggap kosong', () => {
    assert.notEqual(pesanBilaKosong({ content: '   \n\n  ', jumlahTool: 1 }), null)
  })
})

describe('guard TIDAK boleh menyentuh jawaban yang sudah berisi', () => {
  test('jawaban normal dilewatkan apa adanya', () => {
    // Pelajaran §26: guard yang menempel pada jawaban yang baik lebih berbahaya
    // daripada tidak ada guard — `verify-guard` versi pertama membuang kalimat
    // jujur tiga menit sesudah dipasang.
    assert.equal(pesanBilaKosong({ content: 'Nett bulan ini Rp 1,37 M.', jumlahTool: 3 }), null)
  })

  test('jawaban berisi TETAP dilewatkan walau jatah token habis', () => {
    // Jawaban yang terpotong di tengah tetap lebih berguna daripada diganti
    // pesan galat — dan penggantian akan MENGHAPUS teks yang sudah dibaca user.
    assert.equal(
      pesanBilaKosong({ content: 'Nett bulan ini Rp 1,3', finishReason: 'length', jumlahTool: 3 }),
      null
    )
  })

  test('satu karakter pun dianggap ada isi', () => {
    assert.equal(pesanBilaKosong({ content: '.', jumlahTool: 0 }), null)
  })
})

describe('dorongan menulis jawaban (pengulangan sekali)', () => {
  test('menyuruh menulis jawaban, BUKAN memanggil tool lagi', () => {
    // Memaksa panggilan tool di sini mengulang kegagalan 25 Agu 2026: model yang
    // dipaksa tanpa tahu harus mengisi apa akan mengarang argumennya.
    assert.match(DORONGAN_JAWAB, /Write the answer for the user now/)
    assert.match(DORONGAN_JAWAB, /Do not call any tool again/)
  })

  test('memberi JALAN KELUAR bila data memang belum cukup', () => {
    // Tanpa ini, dorongan berubah jadi tekanan menjawab apa pun — dan model yang
    // ditekan menjawab akan mengarang, persis yang dihindari seluruh arsitektur.
    assert.match(DORONGAN_JAWAB, /say so plainly/)
    assert.match(DORONGAN_JAWAB, /do not make up numbers/)
  })

  test('menyebut hasil tool sebagai sumber, bukan ingatan model', () => {
    assert.match(DORONGAN_JAWAB, /tool results/)
  })
})
