import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  cuplikanUntukKirim,
  isDampak,
  isJenis,
  isStatus,
  potongCuplikan,
  validasiIsi,
  MAKS_CUPLIKAN,
  MAKS_ISI,
  MAKS_LAMPIRAN_MASUKAN,
  periksaLampiranMasukan
} from '../src/main/feedback/rules'
import { MIME_DIIZINKAN } from '../src/main/chat/rules'
import { assertBukanTabelAuth, assertReadOnly } from '../src/main/tools/db-safety'
import { FEEDBACK_JENIS, FEEDBACK_STATUS } from '../src/shared/ipc'

// Test regresi untuk menu Masukan. Yang dikunci di sini adalah perilaku yang
// kalau rusak GAGALNYA DIAM: cuplikan yang tetap terkirim padahal user
// mencabutnya, potongan yang tidak mengaku dipotong, dan tabel masukan yang
// ternyata bisa dibaca lewat tool database.

describe('potongCuplikan', () => {
  test('teks pendek dikembalikan apa adanya', () => {
    assert.equal(potongCuplikan('nett Agustus salah'), 'nett Agustus salah')
  })

  test('teks kosong / hanya spasi jadi null', () => {
    assert.equal(potongCuplikan('   '), null)
    assert.equal(potongCuplikan(null), null)
  })

  test('teks panjang dipotong DAN menyatakan dirinya dipotong', () => {
    const panjang = 'x'.repeat(MAKS_CUPLIKAN + 500)
    const hasil = potongCuplikan(panjang)!
    assert.ok(hasil.length < panjang.length)
    // ⚠️ Inti test ini: potongan yang membisu membuat pembacanya menyimpulkan
    // yang salah. Di read_pdf yang tertipu model; di sini Super Admin, yang akan
    // mengira jawaban terputus itulah bug yang dilaporkan.
    assert.match(hasil, /dipotong/)
    assert.match(hasil, /500/)
  })

  test('tepat di batas tidak dipotong', () => {
    const pas = 'y'.repeat(MAKS_CUPLIKAN)
    assert.equal(potongCuplikan(pas), pas)
  })
})

describe('cuplikanUntukKirim', () => {
  test('centang dicabut = pertanyaan & jawaban TIDAK ikut', () => {
    const hasil = cuplikanUntukKirim({
      sertakanChat: false,
      pertanyaan: 'berapa sales bulan ini',
      jawaban: 'Rp 4,11 M'
    })
    assert.equal(hasil.pertanyaan, null)
    assert.equal(hasil.jawaban, null)
  })

  test('centang aktif = keduanya ikut', () => {
    const hasil = cuplikanUntukKirim({
      sertakanChat: true,
      pertanyaan: 'berapa sales bulan ini',
      jawaban: 'Rp 4,11 M'
    })
    assert.equal(hasil.pertanyaan, 'berapa sales bulan ini')
    assert.equal(hasil.jawaban, 'Rp 4,11 M')
  })

  test('centang aktif tetap memotong yang kepanjangan', () => {
    const hasil = cuplikanUntukKirim({
      sertakanChat: true,
      pertanyaan: null,
      jawaban: 'z'.repeat(MAKS_CUPLIKAN + 10)
    })
    assert.match(hasil.jawaban!, /dipotong/)
  })
})

describe('validasiIsi', () => {
  test('kosong ditolak', () => {
    assert.ok(validasiIsi('   ') !== null)
  })

  test('satu kalimat pendek diterima — form yang cerewet mengurangi pengisi', () => {
    assert.equal(validasiIsi('angkanya salah'), null)
  })

  test('melebihi batas ditolak', () => {
    assert.ok(validasiIsi('a'.repeat(MAKS_ISI + 1)) !== null)
  })
})

describe('pengenal nilai', () => {
  test('jenis & status yang sah dikenali', () => {
    for (const j of FEEDBACK_JENIS) assert.ok(isJenis(j))
    for (const s of FEEDBACK_STATUS) assert.ok(isStatus(s))
    assert.ok(isDampak('menghalangi'))
  })

  test('nilai asing ditolak, bukan diterima diam-diam', () => {
    assert.equal(isJenis('bukan_jenis'), false)
    assert.equal(isStatus('entah'), false)
    assert.equal(isDampak(''), false)
    assert.equal(isJenis(undefined), false)
  })
})

describe('tabel masukan tidak bisa disentuh tool database', () => {
  // Kolom pertanyaan/jawaban memuat cuplikan percakapan: bisa berisi angka
  // omzet, bisa berisi isi dokumen yang dilampirkan user. Tanpa daftar-tolak,
  // seorang SPV bisa membaca apa yang dilaporkan direktur cukup dengan meminta
  // AIRA melihat isi tabel.
  test('db_query ditolak', () => {
    assert.throws(() => assertBukanTabelAuth('SELECT * FROM tb_feedback_aira'), /tidak bisa diakses/)
  })

  test('ditolak juga saat namanya muncul di join / subquery / huruf besar', () => {
    assert.throws(() =>
      assertBukanTabelAuth('select f.isi from public.TB_FEEDBACK_AIRA f limit 1')
    )
    assert.throws(() =>
      assertBukanTabelAuth('WITH x AS (SELECT * FROM tb_feedback_aira) SELECT * FROM x')
    )
  })

  test('db_execute ditolak juga — bukan cuma yang membaca', () => {
    assert.throws(() => assertBukanTabelAuth("DELETE FROM tb_feedback_aira WHERE id = 1"))
  })

  test('assertReadOnly SENDIRIAN tidak menahannya', () => {
    // Bukti bahwa daftar-tolak memang perlu: SELECT ke tabel ini adalah
    // statement baca yang sah dan lolos begitu saja.
    assert.doesNotThrow(() => assertReadOnly('SELECT * FROM tb_feedback_aira'))
  })

  test('tabel lain yang berawalan mirip tetap boleh', () => {
    assert.doesNotThrow(() => assertBukanTabelAuth('SELECT * FROM tb_feedback_aira_arsip_lain'))
  })
})

describe('lampiran masukan (30 Sep 2026)', () => {
  test('gambar & PDF biasa diterima', () => {
    assert.equal(periksaLampiranMasukan('layar.png', 'image/png', 200_000).ok, true)
    assert.equal(periksaLampiranMasukan('bukti.pdf', 'application/pdf', 1_000_000).ok, true)
  })

  test('berkas yang bisa dijalankan DITOLAK — daftar-izin, bukan daftar-larangan', () => {
    for (const mime of ['application/x-msdownload', 'application/x-bat', 'text/javascript', '']) {
      assert.equal(periksaLampiranMasukan('x', mime, 10).ok, false, mime)
    }
  })

  test('batas ukuran ditegakkan dan alasannya menyebut batasnya', () => {
    const r = periksaLampiranMasukan('besar.png', 'image/png', MAKS_LAMPIRAN_MASUKAN + 1)
    assert.equal(r.ok, false)
    assert.match(r.ok ? '' : r.alasan, /5 MB/)
    assert.equal(periksaLampiranMasukan('pas.png', 'image/png', MAKS_LAMPIRAN_MASUKAN).ok, true)
  })

  test('berkas kosong ditolak', () => {
    assert.equal(periksaLampiranMasukan('kosong.png', 'image/png', 0).ok, false)
  })

  test('SATU daftar jenis berkas dengan chat — tidak ada salinan yang menyimpang', () => {
    for (const mime of MIME_DIIZINKAN) {
      assert.equal(periksaLampiranMasukan('a', mime, 10).ok, true, mime)
    }
  })
})
