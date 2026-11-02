import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AMBANG_ONLINE_MS,
  bolehBaca,
  DETAK_MS,
  kunciRuang,
  MAKS_ISI,
  MAKS_LAMPIRAN,
  masihOnline,
  periksaLampiran,
  periksaPesan
} from '../src/main/chat/rules'
import { assertBukanTabelAuth } from '../src/main/tools/db-safety'

describe('chat / kepemilikan', () => {
  test('pengirim dan penerima boleh membaca', () => {
    assert.equal(bolehBaca('andi', 'andi', 'budi'), true)
    assert.equal(bolehBaca('budi', 'andi', 'budi'), true)
  })

  test('ORANG KETIGA TIDAK boleh membaca', () => {
    // Pemeriksaan terpenting di berkas ini. Handler IPC menerima nama siapa pun
    // yang dikirim renderer; yang menahan adalah pemeriksaan ini memakai username
    // dari SESI. Tanpa itu, menebak nama orang = membaca percakapannya (§16/§32).
    assert.equal(bolehBaca('citra', 'andi', 'budi'), false)
    assert.equal(bolehBaca('superadmin', 'andi', 'budi'), false)
  })

  test('besar-kecil huruf tidak membuka celah', () => {
    assert.equal(bolehBaca('ANDI', 'andi', 'budi'), true)
    assert.equal(bolehBaca('andi', 'ANDI', 'budi'), true)
  })
})

describe('chat / kunciRuang', () => {
  test('urutan siapa-dulu tidak mengubah kunci', () => {
    // Kalau ini gagal, satu percakapan terbelah jadi dua ruang dan tiap orang
    // hanya melihat separuhnya — tanpa error, tanpa tanda apa pun di layar.
    assert.equal(kunciRuang('andi', 'budi'), kunciRuang('budi', 'andi'))
  })

  test('besar-kecil huruf tidak membuat ruang kembar', () => {
    assert.equal(kunciRuang('Andi', 'budi'), kunciRuang('andi', 'BUDI'))
  })

  test('dua pasangan berbeda tidak bertabrakan', () => {
    assert.notEqual(kunciRuang('andi', 'budi'), kunciRuang('andi', 'citra'))
  })
})

describe('chat / periksaLampiran', () => {
  test('gambar dan dokumen Office diterima', () => {
    assert.equal(periksaLampiran('foto.png', 'image/png', 1000).ok, true)
    assert.equal(
      periksaLampiran(
        'laporan.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        5000
      ).ok,
      true
    )
  })

  test('berkas yang BISA DIJALANKAN ditolak', () => {
    // Chat internal adalah jalur sempurna untuk menyebar berkas berbahaya:
    // penerimanya percaya karena datang dari rekan yang ia kenal.
    for (const mime of [
      'application/x-msdownload',
      'application/x-bat',
      'application/octet-stream',
      'text/javascript'
    ]) {
      const h = periksaLampiran('jahat.exe', mime, 1000)
      assert.equal(h.ok, false, `${mime} seharusnya ditolak`)
    }
  })

  test('jenis yang belum terpikirkan otomatis DITOLAK, bukan lolos', () => {
    // Daftar-IZIN, bukan daftar-larangan (§35).
    assert.equal(periksaLampiran('a.xyz', 'application/vnd.jenis-baru', 100).ok, false)
  })

  test('berkas melebihi batas ditolak dengan saran, bukan sekadar "gagal"', () => {
    const h = periksaLampiran('besar.pdf', 'application/pdf', MAKS_LAMPIRAN + 1)
    assert.equal(h.ok, false)
    if (!h.ok) assert.match(h.alasan, /OneDrive/)
  })

  test('berkas kosong ditolak', () => {
    assert.equal(periksaLampiran('a.png', 'image/png', 0).ok, false)
  })
})

describe('chat / periksaPesan', () => {
  test('pesan biasa diterima', () => {
    assert.equal(periksaPesan('halo', false).ok, true)
  })

  test('pesan kosong tanpa lampiran ditolak', () => {
    assert.equal(periksaPesan('   ', false).ok, false)
  })

  test('lampiran tanpa teks tetap boleh — kirim gambar saja itu wajar', () => {
    assert.equal(periksaPesan('', true).ok, true)
  })

  test('pesan kepanjangan ditolak', () => {
    assert.equal(periksaPesan('x'.repeat(MAKS_ISI + 1), false).ok, false)
  })
})

describe('chat / kehadiran', () => {
  test('detak baru = online', () => {
    assert.equal(masihOnline(new Date()), true)
  })

  test('detak lama = offline', () => {
    assert.equal(masihOnline(new Date(Date.now() - AMBANG_ONLINE_MS - 1000)), false)
  })

  test('ambang online lebih longgar dari selang detak', () => {
    // Kalau ambangnya sama dengan detaknya, satu detak yang telat sedikit membuat
    // orang berkedip hilang-muncul di daftar. Daftar yang berkedip terlihat rusak.
    assert.ok(AMBANG_ONLINE_MS >= DETAK_MS * 2)
  })

  test('detak yang telat satu putaran TIDAK membuat orang hilang', () => {
    assert.equal(masihOnline(new Date(Date.now() - DETAK_MS - 2000)), true)
  })
})

describe('chat / tabel chat TIDAK bisa disentuh tool database', () => {
  test('tabel pesan & kehadiran ditolak db_query', () => {
    // Pemeriksaan paling penting untuk privasi fitur ini. Tabel chat duduk di
    // database YANG SAMA dengan SalesRepository, jadi connection string yang sah
    // untuk pertanyaan penjualan juga sah untuk membaca chat pribadi orang.
    // Aturan 12 berlaku lebih keras di sini daripada untuk tb_feedback_aira.
    for (const sql of [
      'SELECT * FROM tb_chat_aira_pesan',
      'select isi from public.tb_chat_aira_pesan where penerima = $1',
      'WITH x AS (SELECT * FROM tb_chat_aira_pesan) SELECT * FROM x',
      'SELECT * FROM tb_chat_aira_hadir'
    ]) {
      assert.throws(() => assertBukanTabelAuth(sql), /tidak bisa diakses lewat tool database/, sql)
    }
  })

  test('alasan penolakan menyebut sebab yang BENAR per tabel', () => {
    // Versi sebelumnya memakai ternary yang menyebut "kredensial login" untuk apa
    // pun selain feedback — begitu tabel chat ditambahkan, penolakannya berbohong
    // soal sebabnya dan mengirim orang menelusuri hal yang keliru.
    assert.throws(() => assertBukanTabelAuth('select * from tb_chat_aira_pesan'), /percakapan pribadi/)
    assert.throws(() => assertBukanTabelAuth('select * from tb_chat_aira_hadir'), /siapa membuka AIRA/)
    assert.throws(() => assertBukanTabelAuth('select * from tb_login_aira'), /kredensial login/)
  })

  test('tabel lain tetap boleh — guard tidak boleh kebablasan', () => {
    assert.doesNotThrow(() => assertBukanTabelAuth('SELECT * FROM "SalesRepository" LIMIT 1'))
    assert.doesNotThrow(() => assertBukanTabelAuth('SELECT * FROM m_customer'))
  })
})
