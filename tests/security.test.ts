import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import * as path from 'path'
import { resolveInBoundary, BoundaryError } from '../src/main/tools/boundary'
import { redactText } from '../src/main/security/redact'
import { assertReadOnly, detectEngine, maskConnectionString } from '../src/main/tools/db-safety'
import { isFalseRefusal } from '../src/main/agent/refusal'
import { resolveRole, routeModel } from '../src/main/agent/router'
import { hasTextLayer } from '../src/main/pdf-text'
import { cleanOcrOutput } from '../src/main/ocr'
import { candidateUrls } from '../src/main/browser/url-candidates'
import { assertNotBrowserLaunch } from '../src/main/tools/command-guard'
import { assertPlainTextTarget, assertNotDocumentAsText } from '../src/main/tools/fs-tools'
import {
  groupOf,
  isInnoQuestion,
  isSalesQuestion,
  saranMenu,
  selectGroups
} from '../src/main/agent/tool-groups'
import {
  erpClause,
  erpNote,
  scopeFromText,
  applyErpScope,
  ERP_BRIDGING_START
} from '../src/main/sales/erp'
import { computeMovers } from '../src/main/sales/movers'
import { DEFAULT_BASIS, basisFromText, applyBasisRule } from '../src/main/sales/basis'
import { blockDocSearchForSales } from '../src/main/agent/sales-guard'
import { alive } from '../src/main/tools/inno-tools'
import { categoryLabel } from '../src/main/masterdata/categories'
import { disambiguateItems } from '../src/main/masterdata/rules'
import {
  alignBaseline,
  resolvePeriod,
  previousRange,
  ytdRange,
  ytdCompareRange,
  parseMonth
} from '../src/main/sales/periods'
import {
  isOpenEnded,
  validityOf,
  validityLabel,
  resolveActivePrices
} from '../src/main/masterdata/rules'
import {
  CUSTOMER_DIMENSIONS,
  CUSTOMER_LOOKUP,
  customerTypeLabel,
  regionFilter,
  steerRegionDimension
} from '../src/main/sales/region'
import { withShare } from '../src/main/sales/contribution'
import { afterClosingEvent, afterSessionDeleted, closesRun } from '../src/renderer/src/run-state'
import { RECOGNIZED_CLAUSE, RECOGNIZED_NOTE } from '../src/main/sales/recognition'
import {
  isContextOverflow,
  pangkasRiwayat,
  pesanUntukUser,
  ringkasPesanError,
  sisaGiliranUntukPercobaan
} from '../src/main/agent/context-limit'
import {
  labelPeriode,
  persenUbah,
  rupiah,
  susunLaporan,
  susunLaporanExcel,
  type DataLaporan
} from '../src/main/sales/report'
import {
  isPasienPribadi,
  pickBaru,
  pickBerhenti,
  pickMelemah,
  pilihPelanggan,
  type BarisPelanggan
} from '../src/main/sales/customers'

describe('filesystem boundary', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'aira-test-'))
  const allowed = path.join(root, 'allowed')
  const outside = path.join(root, 'outside')
  mkdirSync(path.join(allowed, 'sub'), { recursive: true })
  mkdirSync(outside, { recursive: true })
  process.on('exit', () => rmSync(root, { recursive: true, force: true }))

  test('path di dalam boundary diizinkan', () => {
    const resolved = resolveInBoundary(path.join(allowed, 'sub', 'file.txt'), [allowed])
    assert.ok(resolved.toLowerCase().startsWith(allowed.toLowerCase()))
  })

  test('path traversal ..\\ ditolak', () => {
    assert.throws(
      () => resolveInBoundary(path.join(allowed, '..', 'outside', 'x.txt'), [allowed]),
      BoundaryError
    )
  })

  test('path di luar boundary ditolak', () => {
    assert.throws(() => resolveInBoundary(path.join(outside, 'x.txt'), [allowed]), BoundaryError)
  })

  test('folder dengan nama prefix mirip ditolak (allowed2 vs allowed)', () => {
    assert.throws(() => resolveInBoundary(allowed + '2\\x.txt', [allowed]), BoundaryError)
  })

  test('daftar folder kosong ditolak', () => {
    assert.throws(() => resolveInBoundary('C:\\anything', []), BoundaryError)
  })
})

describe('log redaction', () => {
  test('API key sk- di-mask', () => {
    assert.ok(!redactText('key=sk-FGxM8pmCYX4XzgxPIeboJg').includes('sk-FGxM8pm'))
  })
  test('key ydc- di-mask', () => {
    assert.ok(!redactText('pakai ydc-sk-270b1677be727e8c-abc').includes('270b1677'))
  })
  test('Bearer token di-mask', () => {
    assert.ok(!redactText('Authorization: Bearer abc123xyz').includes('abc123xyz'))
  })
  test('teks biasa tidak berubah', () => {
    assert.equal(redactText('laporan penjualan Juli'), 'laporan penjualan Juli')
  })
})

describe('database read-only enforcement', () => {
  test('SELECT diizinkan', () => {
    assert.doesNotThrow(() => assertReadOnly('SELECT * FROM customers WHERE id = 1'))
  })
  test('WITH ... SELECT diizinkan', () => {
    assert.doesNotThrow(() => assertReadOnly('WITH t AS (SELECT 1 AS x) SELECT * FROM t'))
  })
  test('DELETE ditolak', () => {
    assert.throws(() => assertReadOnly('DELETE FROM customers'))
  })
  test('UPDATE ditolak', () => {
    assert.throws(() => assertReadOnly('UPDATE t SET a = 1'))
  })
  test('DROP ditolak', () => {
    assert.throws(() => assertReadOnly('DROP TABLE customers'))
  })
  test('CTE berisi INSERT ditolak', () => {
    assert.throws(() => assertReadOnly('WITH t AS (INSERT INTO x VALUES (1) RETURNING *) SELECT 1'))
  })
  test('SELECT INTO OUTFILE ditolak', () => {
    assert.throws(() => assertReadOnly("SELECT * FROM t INTO OUTFILE '/tmp/x'"))
  })
  test('EXEC ditolak', () => {
    assert.throws(() => assertReadOnly('EXEC xp_cmdshell whoami'))
  })
})

describe('deteksi false refusal (regresi bug web_search)', () => {
  const TOOLS = ['web_search', 'browser_open', 'read_pdf', 'db_query']

  test('penolakan asli dari model terdeteksi', () => {
    assert.ok(
      isFalseRefusal(
        'Maaf, saat ini saya tidak memiliki tool `web_search` untuk mencari berita terbaru dari internet.',
        TOOLS
      )
    )
  })
  test('bentuk TERBALIK "tool X tidak tersedia" terdeteksi', () => {
    assert.ok(
      isFalseRefusal(
        'Mohon maaf, saat ini tool browser (browser_open) tidak tersedia di sesi saya, jadi saya tidak bisa langsung membuka situs.',
        TOOLS
      )
    )
  })
  test('"belum diaktifkan" pada nama tool nyata terdeteksi', () => {
    assert.ok(isFalseRefusal('Fitur db_query belum diaktifkan untuk sesi ini.', TOOLS))
  })
  test('laporan data tidak ada TIDAK dianggap penolakan', () => {
    assert.ok(!isFalseRefusal('File laporan.xlsx tidak ada di folder tersebut.', TOOLS))
    assert.ok(!isFalseRefusal('Data pasien itu tidak tersedia di dokumen yang saya baca.', TOOLS))
  })
  test('variasi "tidak punya akses internet" terdeteksi', () => {
    assert.ok(isFalseRefusal('Saya tidak punya akses internet untuk mencari berita.'))
  })
  test('variasi bahasa Inggris terdeteksi', () => {
    assert.ok(isFalseRefusal("I don't have access to a web search tool."))
  })
  test('jawaban normal TIDAK dianggap penolakan', () => {
    assert.ok(!isFalseRefusal('Berikut 3 berita politik hari ini menurut hasil pencarian.'))
  })
  test('penolakan sah karena izin ditolak user TIDAK ikut terjaring', () => {
    assert.ok(!isFalseRefusal('Baik, operasi dibatalkan karena Anda menolak izin penghapusan file.'))
  })
})

/**
 * User yang MEMANG berizin membuka kedua menu data.
 *
 * Dipakai sebagian besar test pengelompokan tool, yang menguji "kalimat ini
 * memicu kelompok apa" — bukan "siapa boleh apa". Izinnya sendiri diuji di blok
 * "izin data ditegakkan di toolset" di bawah.
 */
const BERIZIN = ['sales', 'masterdata'] as const

describe('izin data ditegakkan di toolset, bukan hanya di menu', () => {
  // ⚠️ Regresi 20 Agu 2026, dilaporkan user. Seorang SPV TANPA akses menu
  // "Tanya Data Sales" mengetik "berapa sales kita bulan ini" di Task Baru dan
  // menerima omzet perusahaan lengkap — nett, gross, diskon, jumlah pelanggan.
  //
  // Matriks aksesnya benar; tempat penegakannya yang salah. `chatSend` menjaga
  // MODE, dan mode "general" memang selalu diizinkan untuk semua orang, jadi
  // tidak ada apa pun yang menahan tool sales ikut terkirim begitu kalimatnya
  // memuat kata "sales".
  const tanpaIzin = { usedTools: [] as string[], izinMenu: [] as const }

  test('tanpa izin: pertanyaan sales di mode umum TIDAK membawa tool sales', () => {
    const g = selectGroups({ ...tanpaIzin, text: 'berapa sales kita bulan ini' })
    assert.ok(!g.has('sales'))
    assert.ok(g.has('core'))
  })

  test('tanpa izin: pertanyaan master Master Data TIDAK membawa tool inno', () => {
    assert.ok(
      !selectGroups({ ...tanpaIzin, text: 'carikan special price RS Kariadi' }).has('inno')
    )
  })

  test('berizin: dapat toolnya di MODE SALES — dan hanya di sana', () => {
    // Sesudah ketentuan 20 Agu 2026, izin tidak lagi membuka tool sales di mode
    // umum. Yang dibuka izin adalah MENU-nya.
    assert.ok(
      selectGroups({
        ...tanpaIzin,
        izinMenu: BERIZIN,
        text: 'berapa sales kita bulan ini',
        mode: 'sales'
      }).has('sales')
    )
    assert.ok(
      !selectGroups({
        ...tanpaIzin,
        izinMenu: BERIZIN,
        text: 'berapa sales kita bulan ini'
      }).has('sales')
    )
  })

  test('izin dicabut: percakapan LAMA tidak boleh membawa balik tool sales', () => {
    // Jalur yang paling mudah terlewat: `usedTools` memasukkan kembali kelompok
    // sales dari percakapan yang dibuat saat user masih berizin. Pencabutan
    // akses harus berlaku pada percakapan yang sudah ada, bukan hanya yang baru.
    const g = selectGroups({
      ...tanpaIzin,
      text: 'lanjutkan yang tadi',
      usedTools: ['sales_summary', 'sales_breakdown']
    })
    assert.ok(!g.has('sales'))
  })

  test('mode data tanpa izin tidak membuka toolsetnya', () => {
    // `chatSend` sudah menolak lebih dulu; ini jaring kedua kalau kelak ada
    // jalur pemanggilan lain.
    assert.ok(!selectGroups({ ...tanpaIzin, text: 'apa saja', mode: 'sales' }).has('sales'))
    assert.ok(!selectGroups({ ...tanpaIzin, text: 'apa saja', mode: 'masterdata' }).has('inno'))
  })

  test('izinMenu tidak diisi = gagal TERTUTUP, bukan terbuka', () => {
    // Pemanggil baru yang lupa mengisinya harus melihat "tool sales tidak
    // muncul" (terlihat, dilaporkan) — bukan diam-diam membuka omzet.
    const g = selectGroups({ usedTools: [], text: 'berapa sales bulan ini' })
    assert.ok(!g.has('sales'))
  })

  test('izin sales tidak ikut membuka inno, dan sebaliknya', () => {
    assert.ok(
      !selectGroups({
        usedTools: [],
        izinMenu: ['sales'],
        text: 'carikan special price RS Kariadi'
      }).has('inno')
    )
    assert.ok(
      !selectGroups({
        usedTools: [],
        izinMenu: ['masterdata'],
        text: 'berapa sales bulan ini'
      }).has('sales')
    )
  })
})

describe('Task Baru tidak pernah menyentuh database (ketentuan user 20 Agu 2026)', () => {
  // "Task Baru itu untuk umum, jangan sampai nyenggol database atau menu
  // Tanya Data Sales / Ask Master Data."
  //
  // Selama tool sales bisa dipanggil dari mode umum, penguncian sumber data
  // hanya berlaku DI DALAM mode sales — sementara mode umum bisa menyentuh
  // keduanya sekaligus.
  const umum = { usedTools: [] as string[], izinMenu: BERIZIN }

  test('user BERIZIN pun tidak dapat tool sales di mode umum', () => {
    // Ini yang berubah: izin menentukan menu mana yang bisa dibuka, bukan
    // apakah angka boleh keluar lewat pintu lain.
    const g = selectGroups({ ...umum, text: 'berapa sales kita bulan ini' })
    assert.ok(!g.has('sales'))
    assert.ok(!g.has('inno'))
  })

  test('user BERIZIN pun tidak dapat tool Master Data di mode umum', () => {
    assert.ok(!selectGroups({ ...umum, text: 'carikan special price RS Kariadi' }).has('inno'))
  })

  test('percakapan lama mode sales tidak menghidupkan toolnya di mode umum', () => {
    const g = selectGroups({
      ...umum,
      text: 'lanjutkan yang tadi',
      usedTools: ['sales_summary', 'inno_item_search']
    })
    assert.ok(!g.has('sales'))
    assert.ok(!g.has('inno'))
  })

  test('mode umum tetap dapat tool non-data seperti biasa', () => {
    // Penutupan ini tidak boleh melumpuhkan Task Baru untuk pekerjaan lain.
    assert.ok(selectGroups({ ...umum, text: 'jalankan npm run build' }).has('dev'))
    assert.ok(selectGroups({ ...umum, text: 'buka orderIdlab.co.id' }).has('browser'))
    assert.ok(selectGroups({ ...umum, text: 'rapikan file di folder laporan' }).has('core'))
  })
})

describe('SQL bebas (db_query/db_execute) hanya untuk Super Admin', () => {
  // ⚠️ `db_query` menerima connection string dari ARGUMEN, jadi ia melewati
  // seluruh aturan tool sales — agregat murni, dimensi tertutup, dasar
  // pengakuan baris — dan bisa menyentuh kolom pasien langsung.
  const t = 'cek tabel di database postgres'

  test('bukan Super Admin: tidak dapat tool SQL', () => {
    const g = selectGroups({ usedTools: [], izinMenu: BERIZIN, text: t })
    assert.ok(!g.has('db'))
  })

  test('Super Admin: dapat', () => {
    assert.ok(selectGroups({ usedTools: [], izinMenu: BERIZIN, text: t, superAdmin: true }).has('db'))
  })

  test('http_request TIDAK ikut terblokir', () => {
    // Dulu db_query, db_execute, dan http_request satu kelompok, sehingga
    // menutup database ikut mematikan tes API yang tidak ada hubungannya.
    assert.equal(groupOf('http_request'), 'data')
    assert.equal(groupOf('db_query'), 'db')
    assert.ok(selectGroups({ usedTools: [], izinMenu: BERIZIN, text: t }).has('data'))
  })

  test('mode data tidak pernah membawa SQL bebas, bahkan untuk Super Admin', () => {
    // Pertanyaan data dijawab lewat tool yang SQL-nya ditulis manusia.
    const g = selectGroups({
      usedTools: [],
      izinMenu: BERIZIN,
      text: t,
      mode: 'sales',
      superAdmin: true
    })
    assert.ok(!g.has('db'))
    assert.deepEqual([...g], ['sales'])
  })

  test('percakapan lama tidak menghidupkan SQL bebas untuk non-Super Admin', () => {
    const g = selectGroups({
      usedTools: ['db_query'],
      izinMenu: BERIZIN,
      text: 'lanjutkan'
    })
    assert.ok(!g.has('db'))
  })
})

describe('lintas menu diarahkan, bukan dijawab asal', () => {
  // "Jangan ada cross menu — misalnya dia nanya harga item di Tanya Data Sales."
  //
  // ⚠️ Ketiadaan tool saja tidak cukup: model 27B yang tidak punya toolnya akan
  // menjawab dari ingatan. Jadi arahannya harus eksplisit.
  test('pertanyaan master data di mode Sales diarahkan ke Master Data', () => {
    assert.equal(saranMenu('berapa harga item JHOPA di RS Kariadi', 'sales'), 'masterdata')
    assert.equal(saranMenu('apakah RS X sudah ada PKS?', 'sales'), 'masterdata')
  })

  test('pertanyaan transaksi di mode Master Data diarahkan ke Sales', () => {
    assert.equal(saranMenu('berapa omzet bulan ini', 'masterdata'), 'sales')
    assert.equal(saranMenu('growth YTD berapa persen', 'masterdata'), 'sales')
  })

  test('pertanyaan data di Task Baru diarahkan ke menunya', () => {
    assert.equal(saranMenu('berapa sales bulan ini', 'general'), 'sales')
    assert.equal(saranMenu('carikan special price RS Kariadi', 'general'), 'masterdata')
  })

  test('pertanyaan yang MEMANG milik modenya tidak diarahkan ke mana-mana', () => {
    // Kalau ini salah, setiap pertanyaan sales yang wajar akan disuruh pindah
    // menu — fiturnya jadi tidak bisa dipakai sama sekali.
    assert.equal(saranMenu('berapa sales bulan ini', 'sales'), null)
    assert.equal(saranMenu('siapa pelanggan terbesar bulan ini', 'sales'), null)
    assert.equal(saranMenu('item apa yang trennya menurun', 'sales'), null)
    assert.equal(saranMenu('carikan special price RS Kariadi', 'masterdata'), null)
  })

  test('percakapan biasa di Task Baru tidak diarahkan ke mana-mana', () => {
    assert.equal(saranMenu('apa itu paracetamol', 'general'), null)
    assert.equal(saranMenu('rapikan file di folder laporan', 'general'), null)
  })
})

describe('pengelompokan tool', () => {
  const base = { usedTools: [] as string[], izinMenu: BERIZIN }

  test('pertanyaan biasa hanya dapat kelompok inti', () => {
    const groups = selectGroups({ ...base, text: 'apa itu paracetamol' })
    assert.ok(groups.has('core'))
    assert.ok(!groups.has('dev'))
    assert.ok(!groups.has('data'))
  })
  test('menyebut situs mengaktifkan kelompok browser', () => {
    assert.ok(selectGroups({ ...base, text: 'buka orderIdlab.co.id' }).has('browser'))
    assert.ok(selectGroups({ ...base, text: 'buka website perusahaan' }).has('browser'))
  })
  test('pertanyaan fakta TIDAK mengaktifkan browser (cukup web search)', () => {
    const groups = selectGroups({
      ...base,
      text: 'coba berapa score pertandingan antara Arsenal Vs Manchester City'
    })
    // Cukup web_search (ada di kelompok core) — browser tidak perlu dikirim.
    assert.ok(!groups.has('browser'))
    assert.ok(groups.has('core'))
  })
  test('"buka dokumen" tidak dianggap urusan browser', () => {
    assert.ok(!selectGroups({ ...base, text: 'buka dokumen laporan bulanan' }).has('browser'))
  })
  test('urusan kode mengaktifkan kelompok dev', () => {
    assert.ok(selectGroups({ ...base, text: 'jalankan npm run build' }).has('dev'))
  })
  test('urusan database mengaktifkan kelompok data', () => {
    assert.ok(selectGroups({ ...base, text: 'cek tabel di database postgres' }).has('data'))
  })
  test('kelompok yang sudah dipakai tidak hilang di tengah sesi', () => {
    const groups = selectGroups({
      ...base,
      text: 'lalu bagaimana?',
      usedTools: ['http_request']
    })
    assert.ok(groups.has('data'))
  })
  test('pemetaan nama tool ke kelompok', () => {
    assert.equal(groupOf('browser_open'), 'browser')
    assert.equal(groupOf('edit_file'), 'dev')
    // db_query & db_execute dipisah dari `data` (20 Agu 2026): yang berbahaya
    // adalah SQL bebas, bukan `http_request` yang kebetulan satu kelompok.
    assert.equal(groupOf('db_query'), 'db')
    assert.equal(groupOf('db_execute'), 'db')
    assert.equal(groupOf('http_request'), 'data')
    assert.equal(groupOf('mcp_exa_web_search_exa'), 'mcp')
    assert.equal(groupOf('read_pdf'), 'core')
  })
})

describe('format file terstruktur (regresi .docx rusak)', () => {
  test('.docx/.xlsx/.pptx ditolak oleh tool teks biasa', () => {
    assert.throws(() => assertPlainTextTarget('D:\\Doc\\Battlecard.docx'), /write_word/)
    assert.throws(() => assertPlainTextTarget('D:\\Doc\\rekap.xlsx'), /write_excel/)
    assert.throws(() => assertPlainTextTarget('D:\\Doc\\deck.pptx'), /write_ppt/)
  })
  test('dokumen kerja tidak boleh diturunkan jadi .md', () => {
    assert.throws(
      () => assertNotDocumentAsText('D:\\Doc\\Battlecard Kompetitor.md', false),
      /write_word/
    )
    assert.throws(() => assertNotDocumentAsText('D:\\Doc\\Laporan Bulanan.txt', false), /write_word/)
  })
  test('user minta markdown secara eksplisit tetap diizinkan', () => {
    assert.doesNotThrow(() => assertNotDocumentAsText('D:\\Doc\\Battlecard.md', true))
  })
  test('catatan teknis biasa tidak terjaring', () => {
    assert.doesNotThrow(() => assertNotDocumentAsText('D:\\Proj\\README.md', false))
    assert.doesNotThrow(() => assertNotDocumentAsText('D:\\Proj\\catatan.txt', false))
  })
  test('file teks biasa tetap diizinkan', () => {
    assert.doesNotThrow(() => assertPlainTextTarget('D:\\Doc\\catatan.md'))
    assert.doesNotThrow(() => assertPlainTextTarget('D:\\Doc\\data.csv'))
    assert.doesNotThrow(() => assertPlainTextTarget('D:\\Proj\\index.ts'))
  })
})

describe('blokir buka URL lewat shell', () => {
  test('PowerShell Start-Process URL diblokir', () => {
    assert.throws(() =>
      assertNotBrowserLaunch(`powershell -Command "Start-Process 'https://orderIdlab.co.id'"`)
    )
  })
  test('start http diblokir', () => {
    assert.throws(() => assertNotBrowserLaunch('start https://situs.co.id'))
  })
  test('memanggil chrome dengan URL diblokir', () => {
    assert.throws(() => assertNotBrowserLaunch('chrome.exe https://situs.co.id'))
  })
  test('perintah biasa tetap diizinkan', () => {
    assert.doesNotThrow(() => assertNotBrowserLaunch('npm run build'))
    assert.doesNotThrow(() => assertNotBrowserLaunch('git commit -m "start halaman baru"'))
    assert.doesNotThrow(() => assertNotBrowserLaunch('curl https://api.internal/health'))
  })
})

describe('kandidat URL browser', () => {
  test('domain telanjang otomatis dicoba varian www', () => {
    const list = candidateUrls('orderIdlab.co.id')
    assert.ok(list.includes('https://orderIdlab.co.id/'))
    assert.ok(list.some((u) => u.startsWith('https://www.orderIdlab.co.id')))
  })
  test('http TIDAK pernah ditambahkan sebagai fallback dari https', () => {
    assert.ok(candidateUrls('https://situs.co.id').every((u) => u.startsWith('https://')))
  })
  test('input http dicoba https lebih dulu', () => {
    assert.ok(candidateUrls('http://situs.co.id')[0].startsWith('https://'))
  })
  test('domain yang sudah www tidak diduplikasi', () => {
    assert.equal(candidateUrls('https://www.situs.co.id').length, 1)
  })
})

describe('PDF & OCR', () => {
  test('penanda halaman pdf-parse tidak dianggap lapisan teks', () => {
    // PDF hasil scan hanya berisi penanda ini -> harus memicu OCR
    assert.equal(hasTextLayer('-- 1 of 1 --'), false)
    assert.equal(hasTextLayer('   -- 1 of 3 --  -- 2 of 3 --  '), false)
  })
  test('PDF dengan teks asli terdeteksi punya lapisan teks', () => {
    assert.equal(hasTextLayer('-- 1 of 2 --\nSURAT KETERANGAN ANALISIS Nomor QA/2026'), true)
  })
  test('preamble "rencana eksekusi" dibuang dari hasil OCR', () => {
    const raw =
      'Berikut adalah rencana eksekusi untuk tugas Anda:\n\n**Rencana:**\n1.  **Langkah 1:** Ekstrak teks.\n\n***\n\nSURAT KETERANGAN ANALISIS\nNomor: QA/2026/08/1147'
    const cleaned = cleanOcrOutput(raw)
    assert.ok(cleaned.startsWith('SURAT KETERANGAN ANALISIS'))
    assert.ok(!cleaned.includes('rencana'))
  })
  test('hasil OCR bersih tidak diubah', () => {
    assert.equal(cleanOcrOutput('SURAT KETERANGAN\nNomor: 123'), 'SURAT KETERANGAN\nNomor: 123')
  })
})

describe('routing model', () => {
  const base = { hasAttachments: false, sessionUsedTools: false }

  test('pertanyaan biasa -> model cepat', () => {
    assert.equal(routeModel({ ...base, text: 'apa itu paracetamol?' }), 'chat')
    assert.equal(routeModel({ ...base, text: 'jelaskan perbedaan JKN dan BPJS' }), 'chat')
  })
  test('permintaan bertindak -> model agent', () => {
    assert.equal(routeModel({ ...base, text: 'carikan berita politik hari ini' }), 'agent')
    assert.equal(routeModel({ ...base, text: 'rapikan folder dokumen saya' }), 'agent')
  })
  test('path Windows -> model agent', () => {
    assert.equal(routeModel({ ...base, text: 'isi D:\\PEKERJAAN\\DOCUMENT apa saja' }), 'agent')
  })
  test('ada lampiran -> model agent', () => {
    assert.equal(routeModel({ ...base, text: 'ini apa ya', hasAttachments: true }), 'agent')
  })
  test('sesi sudah pernah pakai tool -> tetap agent (konsisten)', () => {
    assert.equal(routeModel({ ...base, text: 'kok bisa begitu?', sessionUsedTools: true }), 'agent')
  })
  test('urusan kode -> model coder', () => {
    assert.equal(routeModel({ ...base, text: 'perbaiki bug di script python ini' }), 'coder')
    assert.equal(routeModel({ ...base, text: 'refactor fungsi handleSubmit' }), 'coder')
  })
  test('pilihan manual mengalahkan otomatis', () => {
    assert.equal(resolveRole('chat', { ...base, text: 'rapikan folder saya' }), 'chat')
    assert.equal(resolveRole('auto', { ...base, text: 'rapikan folder saya' }), 'agent')
  })
})

describe('database engine detection & masking', () => {
  test('deteksi engine', () => {
    assert.equal(detectEngine('postgres://u:p@host/db'), 'postgres')
    assert.equal(detectEngine('mysql://u:p@host/db'), 'mysql')
    assert.equal(detectEngine('Server=host;Database=db;User Id=u;Password=p'), 'mssql')
    assert.equal(detectEngine('C:\\data\\app.db'), 'sqlite')
  })
  test('format tidak dikenal ditolak', () => {
    assert.throws(() => detectEngine('mongodb://host/db'))
  })
  test('password URL di-mask', () => {
    assert.ok(!maskConnectionString('postgres://admin:Rahasia123@host/db').includes('Rahasia123'))
  })
  test('Password= di-mask', () => {
    assert.ok(!maskConnectionString('Server=h;Password=Rahasia123;Database=d').includes('Rahasia123'))
  })
})

describe('cakupan ERP (data sales)', () => {
  test('flag mengikuti dasar pengakuan', () => {
    assert.equal(erpClause('erp', 'order'), " AND bridging_status_to = 'SUCCESS'")
    assert.equal(erpClause('erp', 'invoice'), " AND bridging_status_result = 'SUCCESS'")
  })
  test('scope all tidak menambah filter apa pun', () => {
    assert.equal(erpClause('all', 'order'), '')
    assert.equal(erpClause('all', 'invoice'), '')
  })
  test('not_erp memakai IS DISTINCT FROM (NULL ikut terhitung)', () => {
    assert.ok(erpClause('not_erp', 'order').includes("IS DISTINCT FROM 'SUCCESS'"))
  })
  test('penyebutan ERP/ERP memaksa scope erp', () => {
    assert.equal(scopeFromText('berapa sales order erp bulan ini'), 'erp')
    assert.equal(scopeFromText('Sales ERP hari ini'), 'erp')
    assert.equal(scopeFromText('data sales yang masuk ERP bulan lalu'), 'erp')
  })
  test('pertanyaan tanpa ERP tidak dipaksa', () => {
    assert.equal(scopeFromText('berapa sales bulan ini'), null)
    assert.equal(scopeFromText('10 pelanggan terbesar tahun ini'), null)
  })
  test('kata negatif membalik ke not_erp', () => {
    assert.equal(scopeFromText('order yang belum masuk erp'), 'not_erp')
    assert.equal(scopeFromText('invoice gagal bridging ke erp'), 'not_erp')
  })
  test('guard menimpa scope=all yang dipilih model', () => {
    const out = applyErpScope('sales_summary', { period: 'this_month', scope: 'all' }, 'sales erp bulan ini')
    assert.equal(out.scope, 'erp')
  })
  test('scope eksplisit non-all dari model dihormati', () => {
    const out = applyErpScope(
      'sales_summary',
      { period: 'this_month', scope: 'not_erp' },
      'sales erp bulan ini'
    )
    assert.equal(out.scope, 'not_erp')
  })
  test('tool non-sales tidak disentuh guard', () => {
    const args = { path: 'C:/laporan.xlsx' }
    assert.equal(applyErpScope('read_file', args, 'buka laporan erp'), args)
  })
  test('catatan cakupan menyebut kolom flag', () => {
    assert.ok(erpNote('erp', 'invoice').includes('bridging_status_result'))
    assert.ok(erpNote('erp', 'order').includes('bridging_status_to'))
  })
  test('peringatan mulai bridging hanya untuk periode sebelum Des 2025', () => {
    assert.ok(erpNote('erp', 'order', '2025-06-01').includes('2025-12-01'))
    assert.ok(!erpNote('erp', 'order', '2026-08-01').includes('2025-12-01'))
    assert.ok(!erpNote('erp', 'order').includes('2025-12-01'))
  })
})

describe('item naik & turun (sales_movers)', () => {
  const rows = [
    { kode: 'A', nama: 'Alfa', nett: 300, nettSebelum: 100, transaksi: 3, transaksiSebelum: 1 },
    { kode: 'B', nama: 'Beta', nett: 100, nettSebelum: 900, transaksi: 1, transaksiSebelum: 9 },
    { kode: 'C', nama: null, nett: 50, nettSebelum: 0, transaksi: 1, transaksiSebelum: 0 },
    { kode: 'D', nama: 'Delta', nett: 0, nettSebelum: 400, transaksi: 0, transaksiSebelum: 4 },
    { kode: 'E', nama: 'Eta', nett: 200, nettSebelum: 200, transaksi: 2, transaksiSebelum: 2 }
  ]
  test('diurutkan menurut selisih rupiah, bukan persentase', () => {
    const { naik, turun } = computeMovers(rows, 5)
    assert.deepEqual(naik.map((r) => r.kodeItem), ['A', 'C'])
    assert.deepEqual(turun.map((r) => r.kodeItem), ['B', 'D'])
  })
  test('item baru tidak diberi persentase karangan', () => {
    const baru = computeMovers(rows, 5).naik.find((r) => r.kodeItem === 'C')
    assert.equal(baru?.status, 'baru')
    assert.equal(baru?.persen, null)
  })
  test('item yang berhenti total ditandai', () => {
    const mati = computeMovers(rows, 5).turun.find((r) => r.kodeItem === 'D')
    assert.equal(mati?.status, 'berhenti')
    assert.equal(mati?.persen, -100)
  })
  test('item tanpa perubahan tidak masuk daftar mana pun', () => {
    const { naik, turun } = computeMovers(rows, 5)
    assert.ok(![...naik, ...turun].some((r) => r.kodeItem === 'E'))
  })
  test('nama kosong jatuh ke kode item', () => {
    assert.equal(computeMovers(rows, 5).naik.find((r) => r.kodeItem === 'C')?.item, 'C')
  })
  test('limit dibatasi 1..20', () => {
    assert.equal(computeMovers(rows, 1).naik.length, 1)
    assert.equal(computeMovers(rows, 999).naik.length, 2)
  })
  test('persentase dihitung benar', () => {
    assert.equal(computeMovers(rows, 5).naik[0].persen, 200)
  })
})

describe('nama item bentrok (dua kode, satu nama master)', () => {
  test('kode ditempelkan hanya bila namanya bentrok', () => {
    const { naik, turun } = computeMovers(
      [
        { kode: 'S1', nama: 'Onco Breast 4', nett: 300, nettSebelum: 100, transaksi: 3, transaksiSebelum: 1 },
        { kode: 'S2', nama: 'Onco Breast 4', nett: 100, nettSebelum: 500, transaksi: 1, transaksiSebelum: 5 },
        { kode: 'S3', nama: 'MammaPrint', nett: 900, nettSebelum: 0, transaksi: 9, transaksiSebelum: 0 }
      ],
      5
    )
    assert.deepEqual(naik.map((r) => r.item), ['MammaPrint', 'Onco Breast 4 [S1]'])
    assert.deepEqual(turun.map((r) => r.item), ['Onco Breast 4 [S2]'])
  })
})

describe('pertanyaan sales tanpa kata "sales" (regresi: dijawab lewat cari dokumen)', () => {
  const base = { usedTools: [] as string[], izinMenu: BERIZIN }
  const KASUS_NYATA = 'Item apa yang trennya menurun dibanding bulan lalu?'

  test('kasus yang gagal kemarin sekarang mengaktifkan kelompok sales', () => {
    assert.ok(isSalesQuestion(KASUS_NYATA))
  })
  test('variasi pertanyaan item ikut terjaring', () => {
    for (const t of [
      'pemeriksaan apa yang paling laris bulan ini',
      'item apa yang paling sepi',
      'tes apa yang penjualannya naik',
      'produk apa yang kontribusinya terbesar',
      'paket apa yang trendnya turun'
    ]) {
      assert.ok(isSalesQuestion(t), t)
    }
  })
  test('kata ERP saja sudah cukup', () => {
    assert.ok(isSalesQuestion('berapa yang masuk erp kemarin'))
  })
  test('chat umum TIDAK ikut terjaring', () => {
    for (const t of [
      'rapikan item di daftar belanja ini',
      'apa itu paracetamol',
      'tolong ringkas dokumen ini',
      'buat folder baru untuk arsip'
    ]) {
      assert.ok(!isSalesQuestion(t), t)
    }
  })

  test('cari dokumen diblokir untuk pertanyaan penjualan', () => {
    const pesan = blockDocSearchForSales('search_docs', KASUS_NYATA)
    assert.ok(pesan && pesan.includes('sales_movers'))
    assert.ok(blockDocSearchForSales('list_dir', KASUS_NYATA))
    assert.ok(blockDocSearchForSales('search_files', 'item apa yang paling laris bulan ini'))
  })
  test('user yang MEMANG minta dokumen tidak diblokir', () => {
    assert.equal(blockDocSearchForSales('search_docs', 'cari dokumen laporan penjualan Juli'), null)
    assert.equal(blockDocSearchForSales('list_dir', 'lihat folder laporan sales'), null)
    assert.equal(blockDocSearchForSales('search_docs', 'ada file excel tentang item apa saja'), null)
  })
  test('tool selain penjelajah dokumen tidak tersentuh', () => {
    assert.equal(blockDocSearchForSales('sales_movers', KASUS_NYATA), null)
    assert.equal(blockDocSearchForSales('read_excel', KASUS_NYATA), null)
  })
  test('pertanyaan non-sales tidak diblokir', () => {
    assert.equal(blockDocSearchForSales('search_docs', 'dokumen mana yang membahas SOP QA'), null)
  })
})

describe('perbandingan periode setara (regresi: 18 hari vs 31 hari)', () => {
  const today = '2026-08-18'
  const thisMonth = resolvePeriod('this_month', today)
  const lastMonth = resolvePeriod('last_month', today)

  test('bulan berjalan vs bulan lalu: pembanding dipotong ke jumlah hari yang sama', () => {
    const { range, disamakan } = alignBaseline(thisMonth, lastMonth, today)
    assert.equal(disamakan, true)
    assert.equal(range.from, '2026-07-01')
    assert.equal(range.to, '2026-07-18')
    assert.ok(range.label.includes('disamakan'))
  })
  test('periode utama yang sudah selesai tidak diutak-atik', () => {
    const twoMonthsAgo = resolvePeriod('custom', today, { from: '2026-06-01', to: '2026-06-30' })
    const { range, disamakan } = alignBaseline(lastMonth, twoMonthsAgo, today)
    assert.equal(disamakan, false)
    assert.equal(range.to, '2026-06-30')
  })
  test('pembanding yang sudah lebih pendek dibiarkan', () => {
    const pendek = resolvePeriod('custom', today, { from: '2026-07-01', to: '2026-07-05' })
    assert.equal(alignBaseline(thisMonth, pendek, today).disamakan, false)
  })
  test('pembanding sepadan bawaan tidak pernah diubah', () => {
    const sepadan = previousRange(thisMonth)
    assert.equal(alignBaseline(thisMonth, sepadan, today).disamakan, false)
  })
})

describe('dimensi wilayah & tipe pelanggan (master m_customer)', () => {
  // Master pelanggan TIDAK unik pada customer_code_lis (4.075 baris / 4.071 kode).
  // LEFT JOIN langsung ke SalesRepository terukur menggelembungkan nett Agustus 2026
  // dari Rp 4.621.948.235 ke Rp 5.180.336.535 (+12,1%). Pola LATERAL ... LIMIT 1
  // dikunci di sini supaya tidak pernah "disederhanakan" jadi join biasa.
  test('lookup master memakai LATERAL berbatas satu baris', () => {
    assert.match(CUSTOMER_LOOKUP, /LEFT JOIN LATERAL/)
    assert.match(CUSTOMER_LOOKUP, /LIMIT 1/)
    assert.match(CUSTOMER_LOOKUP, /c\.customer_code_lis = a\.kode/)
  })

  test('tiga dimensi master tersedia dan semuanya agregat', () => {
    assert.deepEqual(Object.keys(CUSTOMER_DIMENSIONS).sort(), [
      'city_customer',
      'customer_type',
      'province'
    ])
    for (const [nama, d] of Object.entries(CUSTOMER_DIMENSIONS)) {
      assert.ok(d.expr.includes('w.ketemu IS NULL'), `${nama} harus membedakan pelanggan tak ter-master`)
    }
  })

  test('kode tipe pelanggan diterjemahkan, kodenya tetap terlihat', () => {
    assert.equal(customerTypeLabel('RS'), 'Rumah Sakit (RS)')
    assert.equal(customerTypeLabel('kl'), 'Klinik (KL)')
    assert.equal(customerTypeLabel('PR'), 'Pasien Pribadi (PR)')
  })
  test('kode tak dikenal dikembalikan apa adanya, tidak ditebak', () => {
    assert.equal(customerTypeLabel('ZZ'), 'ZZ')
    assert.equal(customerTypeLabel('(tipe tidak diisi)'), '(tipe tidak diisi)')
  })

  test('filter wilayah lewat parameter, nilainya tidak pernah masuk string SQL', () => {
    const jahat = "Jawa'; DROP TABLE m_customer; --"
    const f = regionFilter({ province: jahat }, 3)
    assert.ok(f.clause.includes('$3'))
    assert.ok(!f.clause.includes('DROP'))
    assert.deepEqual(f.params, [jahat])
  })
  test('filter wilayah memakai semi-join (IN), bukan JOIN yang menggandakan baris', () => {
    const f = regionFilter({ province: 'Jawa Barat', city: 'Bekasi' }, 5)
    assert.match(f.clause, /customer_id IN \(/)
    assert.ok(f.clause.includes('$5') && f.clause.includes('$6'))
    assert.deepEqual(f.params, ['Jawa Barat', 'Bekasi'])
  })
  test('tanpa filter wilayah klausanya kosong', () => {
    assert.deepEqual(regionFilter({}, 3), {
      clause: '',
      params: [],
      province: undefined,
      city: undefined
    })
  })
})

describe('pertanyaan wilayah tidak boleh dijawab dari kolom kota teks bebas', () => {
  // SalesRepository.city memecah satu kota jadi beberapa baris — terukur:
  // "KOTA ADM. JAKARTA TIMUR" 15.667, "Kota Jakarta Timur" 8.948, "KOTA JAKARTA TIMUR" 8.061.
  // Dipakai untuk peringkat wilayah, hasilnya salah tapi terdengar meyakinkan.
  const dim = (args: Record<string, unknown>, teks: string): unknown =>
    steerRegionDimension('sales_breakdown', args, teks).dimension

  test('pertanyaan kota dialihkan ke dimensi master', () => {
    assert.equal(dim({ dimension: 'city' }, 'kota mana yang penjualannya paling besar?'), 'city_customer')
    assert.equal(dim({ dimension: 'city' }, 'sales per wilayah bulan ini'), 'city_customer')
  })
  test('pertanyaan provinsi mengalahkan pilihan kota', () => {
    assert.equal(dim({ dimension: 'city' }, 'provinsi mana yang terbesar?'), 'province')
    assert.equal(dim({ dimension: 'city_customer' }, 'breakdown per provinsi'), 'province')
  })
  test('user yang MEMANG menanyakan kota pasien tetap dapat kolom transaksi', () => {
    assert.equal(dim({ dimension: 'city' }, 'kota asal pasien terbanyak bulan ini'), 'city')
  })
  test('dimensi lain tidak diutak-atik', () => {
    assert.equal(dim({ dimension: 'item' }, 'item apa yang paling laris di kota Bekasi'), 'item')
    assert.equal(dim({ dimension: 'customer' }, 'pelanggan terbesar per wilayah'), 'customer')
  })
  test('pertanyaan tanpa konteks wilayah tidak menyentuh dimensi', () => {
    assert.equal(dim({ dimension: 'city' }, 'berapa sales bulan ini'), 'city')
  })
  test('tool selain sales_breakdown tidak tersentuh', () => {
    const args = { dimension: 'city' }
    assert.equal(steerRegionDimension('sales_summary', args, 'kota mana terbesar').dimension, 'city')
    assert.equal(steerRegionDimension('read_file', args, 'kota mana terbesar').dimension, 'city')
  })

  test('pertanyaan wilayah mengaktifkan kelompok tool sales', () => {
    const base = { usedTools: [] as string[], izinMenu: BERIZIN }
    for (const t of [
      'Kota mana yang paling besar bulan ini?',
      'Wilayah mana yang tertinggi 30 hari terakhir?',
      'provinsi apa yang kontribusinya terbesar',
      'daerah mana yang paling banyak transaksinya'
    ]) {
      assert.ok(isSalesQuestion(t), t)
    }
  })
})

describe('persen kontribusi dihitung di tool, bukan di kepala model', () => {
  // Tanpa total yang ikut dikirim, "10 pelanggan itu berapa persen dari total?"
  // hanya bisa dijawab model dengan mengarang — padahal aturan mode sales melarang
  // menghitung sendiri. Jadi totalnya dikirim sudah terhitung.
  const baris = [{ nett: 500 }, { nett: 300 }, { nett: 100 }]

  test('persen dihitung terhadap total periode, bukan total baris yang tampil', () => {
    const h = withShare(baris, 1000)
    assert.deepEqual(h.baris.map((b) => b.persen), [50, 30, 10])
    assert.equal(h.totalNett, 1000)
  })
  test('persen tercakup menunjukkan sisa yang tidak masuk daftar', () => {
    assert.equal(withShare(baris, 1000).persenTercakup, 90)
  })
  test('daftar yang memuat seluruh periode tercakup 100%', () => {
    assert.equal(withShare(baris, 900).persenTercakup, 100)
  })
  test('total nol menghasilkan null, bukan 0% yang terdengar seperti fakta', () => {
    const h = withShare(baris, 0)
    assert.deepEqual(h.baris.map((b) => b.persen), [null, null, null])
    assert.equal(h.persenTercakup, null)
  })
  test('total negatif juga tidak dipaksakan jadi persen', () => {
    assert.equal(withShare(baris, -50).baris[0].persen, null)
  })
  test('dibulatkan satu desimal', () => {
    assert.equal(withShare([{ nett: 1 }], 3).baris[0].persen, 33.3)
  })
  test('kolom asli baris tidak hilang', () => {
    const h = withShare([{ kategori: 'RS Medistra', nett: 500, jumlahOrder: 12 }], 1000)
    assert.equal(h.baris[0].kategori, 'RS Medistra')
    assert.equal(h.baris[0].jumlahOrder, 12)
    assert.equal(h.baris[0].persen, 50)
  })
})

describe('kotak chat terkunci setelah riwayat dihapus (regresi UI)', () => {
  // Bug nyata 18 Agu 2026: sesudah menghapus recent chat, kotak chat tidak bisa dipakai.
  // Penanda run tertinggal menyala sehingga composer terus menampilkan tombol Stop.
  const run = { messageId: 'msg-1', sessionId: 'sesi-A' }

  test('event penutup milik run yang sama mematikan indikator', () => {
    assert.equal(afterClosingEvent(run, 'msg-1'), null)
    assert.equal(closesRun(run, 'msg-1'), true)
  })
  test('event penutup run LAMA tidak mematikan run yang sedang jalan', () => {
    assert.deepEqual(afterClosingEvent(run, 'msg-lama'), run)
    assert.equal(closesRun(run, 'msg-lama'), false)
  })
  test('tidak ada run berjalan: event penutup aman diabaikan', () => {
    assert.equal(afterClosingEvent(null, 'msg-1'), null)
    assert.equal(closesRun(null, 'msg-1'), false)
  })

  test('menghapus sesi membersihkan run miliknya', () => {
    assert.equal(afterSessionDeleted(run, 'sesi-A'), null)
  })
  test('menghapus sesi LAIN tidak menyentuh run yang sedang jalan', () => {
    assert.deepEqual(afterSessionDeleted(run, 'sesi-B'), run)
  })
  test('berlaku sama untuk approval & kredensial yang tertunda', () => {
    const approval = { requestId: 'r1', sessionId: 'sesi-A' }
    assert.equal(afterSessionDeleted(approval, 'sesi-A'), null)
    assert.deepEqual(afterSessionDeleted(approval, 'sesi-B'), approval)
  })
  test('state kosong tetap kosong', () => {
    assert.equal(afterSessionDeleted(null, 'sesi-A'), null)
  })
})

describe('dasar pengakuan: transfer yang dibatalkan tidak dihitung', () => {
  // Aturan pemilik data 18 Agu 2026. Dikunci di sini karena varian yang salah (OR)
  // TIDAK menyaring apa pun — terukur: hasil OR identik dengan tanpa filter sama
  // sekali (Agustus 2026 Rp 4.722.780.610 pada keduanya), karena cuma 24 baris dari
  // 187.178 yang kedua penandanya terisi. Bug seperti itu diam-diam dan mahal.
  test('memakai AND, bukan OR', () => {
    assert.ok(RECOGNIZED_CLAUSE.includes(' AND '))
    assert.ok(!/\bOR\b/.test(RECOGNIZED_CLAUSE))
  })
  test('kedua kolom penanda hapus ikut diperiksa', () => {
    assert.match(RECOGNIZED_CLAUSE, /transfer_test_deleted_at IS NULL/)
    assert.match(RECOGNIZED_CLAUSE, /transaction_transfer_deleted_at IS NULL/)
  })
  test('berupa potongan yang siap ditempel ke WHERE', () => {
    assert.ok(RECOGNIZED_CLAUSE.startsWith(' AND '))
  })
  test('tidak memuat parameter — konstan, tidak bisa disetir model', () => {
    assert.ok(!RECOGNIZED_CLAUSE.includes('$'))
  })
  test('keterangannya menjelaskan kenapa total bisa lebih kecil dari query mentah', () => {
    assert.match(RECOGNIZED_NOTE, /transfer_test_deleted_at/)
    assert.match(RECOGNIZED_NOTE, /lebih kecil/)
  })
})

describe('Master Data: masa berlaku & sentinel 2222', () => {
  const today = '2026-08-18'

  test('tahun 2222 berarti tanpa batas akhir, bukan berlaku sampai 2222', () => {
    assert.equal(isOpenEnded('2222-12-30 17:00:00'), true)
    assert.equal(isOpenEnded('2222-12-31'), true)
    assert.equal(isOpenEnded(null), true)
    assert.equal(isOpenEnded('2026-12-31'), false)
  })
  test('status masa berlaku', () => {
    assert.equal(validityOf('2024-01-01', '2222-12-30', today), 'aktif')
    assert.equal(validityOf('2024-01-01', '2026-08-18', today), 'aktif')
    assert.equal(validityOf('2024-01-01', '2026-08-17', today), 'kadaluarsa')
    assert.equal(validityOf('2026-09-01', '2222-12-30', today), 'belum_mulai')
  })
  test('label tidak pernah menyebut tahun 2222', () => {
    assert.ok(!validityLabel('2024-01-01', '2222-12-30', today).includes('2222'))
    assert.ok(validityLabel('2024-01-01', '2222-12-30', today).includes('tanpa batas akhir'))
  })
})

describe('Master Data: versi special price (regresi harga ambigu)', () => {
  const today = '2026-08-18'
  // Kasus nyata: pelanggan 0112710002, item JHOPAMOLSPT002 — dua versi aktif.
  const dua = [
    { itemCode: 'JHOPAMOLSPT002', itemName: 'Panel A', specialPrice: 8075000,
      regulerPrice: 8500000, priceCategory: '1', startDate: '2023-10-10', endDate: '2222-12-30' },
    { itemCode: 'JHOPAMOLSPT002', itemName: 'Panel A', specialPrice: 7225000,
      regulerPrice: 8500000, priceCategory: '1', startDate: '2025-01-20', endDate: '2222-12-30' }
  ]

  test('yang berlaku adalah versi dengan tanggal mulai paling baru', () => {
    const hasil = resolveActivePrices(dua, today)
    assert.equal(hasil.length, 1)
    assert.equal(hasil[0].specialPrice, 7225000)
    assert.equal(hasil[0].versiLain, 1)
  })
  test('versi lama tidak disembunyikan diam-diam', () => {
    assert.ok(resolveActivePrices(dua, today)[0].versiLain > 0)
  })
  test('baris aktif mengalahkan baris kadaluarsa walau mulainya lebih lama', () => {
    const hasil = resolveActivePrices(
      [
        { itemCode: 'X', itemName: 'X', specialPrice: 100, regulerPrice: 200, priceCategory: '1',
          startDate: '2026-01-01', endDate: '2026-02-01' },
        { itemCode: 'X', itemName: 'X', specialPrice: 150, regulerPrice: 200, priceCategory: '1',
          startDate: '2025-01-01', endDate: '2222-12-30' }
      ],
      today
    )
    assert.equal(hasil[0].specialPrice, 150)
    assert.equal(hasil[0].status, 'aktif')
  })
  test('diskon dihitung dari harga reguler', () => {
    assert.equal(resolveActivePrices(dua, today)[0].diskonPersen, 15)
  })
  test('harga reguler nol tidak menghasilkan diskon karangan', () => {
    const hasil = resolveActivePrices(
      [{ itemCode: 'Z', itemName: 'Z', specialPrice: 0, regulerPrice: 0, priceCategory: '1',
         startDate: '2024-01-01', endDate: null }],
      today
    )
    assert.equal(hasil[0].diskonPersen, null)
  })
  test('kategori harga berbeda dihitung terpisah', () => {
    const hasil = resolveActivePrices(
      [
        { itemCode: 'Y', itemName: 'Y', specialPrice: 100, regulerPrice: 200, priceCategory: '1',
          startDate: '2024-01-01', endDate: null },
        { itemCode: 'Y', itemName: 'Y', specialPrice: 120, regulerPrice: 200, priceCategory: '2',
          startDate: '2024-01-01', endDate: null }
      ],
      today
    )
    assert.equal(hasil.length, 2)
  })
})

describe('mode data mengunci sumber data', () => {
  const base = { usedTools: [] as string[], izinMenu: BERIZIN, text: 'apa saja' }

  test('mode sales hanya mengirim tool sales', () => {
    const g = selectGroups({ ...base, mode: 'sales' })
    assert.deepEqual([...g], ['sales'])
  })
  test('mode masterdata hanya mengirim tool masterdata', () => {
    const g = selectGroups({ ...base, mode: 'masterdata' })
    assert.deepEqual([...g], ['inno'])
  })
  test('mode masterdata tidak membawa tool sales (dan sebaliknya)', () => {
    assert.ok(!selectGroups({ ...base, mode: 'masterdata' }).has('sales'))
    assert.ok(!selectGroups({ ...base, mode: 'sales' }).has('inno'))
  })
  test('pemetaan tool masterdata ke kelompoknya', () => {
    assert.equal(groupOf('inno_special_price'), 'inno')
    assert.equal(groupOf('inno_customer_search'), 'inno')
    assert.equal(groupOf('sales_summary'), 'sales')
  })
  test('chat umum: kata special price mengaktifkan kelompok inno', () => {
    assert.ok(isInnoQuestion('carikan special price RS Kariadi'))
    assert.ok(isInnoQuestion('apakah RS X sudah ada PKS?'))
    assert.ok(!isInnoQuestion('berapa sales bulan ini'))
  })
})

describe('Master Data: klausa baris hidup selalu ber-alias (regresi kolom ambigu)', () => {
  test('status & deleted_at keduanya diberi alias tabel', () => {
    assert.equal(alive('i'), "i.status = '5' AND i.deleted_at IS NULL")
  })
  test('tidak ada kolom telanjang yang bisa ambigu saat join', () => {
    const klausa = alive('mi')
    assert.ok(!/(^|\s)deleted_at/.test(klausa))
    assert.ok(!/(^|\s)status/.test(klausa))
  })
})

describe('Master Data: kategori harga tidak ditebak', () => {
  const master = new Map([
    ['1', { code: '1', name: 'Special Price', nonaktif: false }],
    ['2', { code: '2', name: 'BPJS/PMK3', nonaktif: false }],
    ['4', { code: '4', name: 'PMK3', nonaktif: true }]
  ])

  test('kode terdaftar memakai nama dari master', () => {
    assert.equal(categoryLabel('1', master), 'Special Price')
    assert.equal(categoryLabel('2', master), 'BPJS/PMK3')
  })
  test('kode yang tidak ada di master TIDAK dinamai (kasus nyata: kategori 5)', () => {
    const label = categoryLabel('5', master)
    assert.ok(label.includes('5'))
    assert.ok(label.includes('tidak terdaftar'))
  })
  test('kategori yang sudah dihapus di master ditandai', () => {
    assert.ok(categoryLabel('4', master).includes('sudah dihapus'))
  })
  test('kategori kosong tidak dianggap Special Price', () => {
    assert.equal(categoryLabel('', master), '(kategori tidak diisi)')
    assert.equal(categoryLabel(null, master), '(kategori tidak diisi)')
  })
  test('spasi di sekitar kode tetap dikenali', () => {
    assert.equal(categoryLabel(' 2 ', master), 'BPJS/PMK3')
  })
})

describe('Master Data: nama item bentrok & kategori luar master', () => {
  test('dua kode item bernama sama dibedakan dengan kodenya', () => {
    const hasil = disambiguateItems([
      { itemCode: 'JHOPAPATOTH173', itemName: 'ER KALDx' },
      { itemCode: 'SBOPAPGEIHD001', itemName: 'ER KALDx' },
      { itemCode: 'JHOPAPGEMMP001', itemName: 'MammaPrint' }
    ])
    assert.deepEqual(hasil.map((r) => r.itemName), [
      'ER KALDx [JHOPAPATOTH173]',
      'ER KALDx [SBOPAPGEIHD001]',
      'MammaPrint'
    ])
  })
  test('nama yang tidak bentrok tidak diberi embel-embel', () => {
    const hasil = disambiguateItems([{ itemCode: 'A1', itemName: 'Glukosa' }])
    assert.equal(hasil[0].itemName, 'Glukosa')
  })
  test('kategori 5 dikenali sebagai Voucher, dengan sumbernya ditandai', () => {
    const master = new Map([['1', { code: '1', name: 'Special Price', nonaktif: false }]])
    const label = categoryLabel('5', master)
    assert.ok(label.includes('Voucher'))
    assert.ok(label.includes('tidak terdaftar di master'))
  })
  test('kode lain yang tak dikenal tetap tidak dinamai', () => {
    const master = new Map([['1', { code: '1', name: 'Special Price', nonaktif: false }]])
    assert.ok(!categoryLabel('99', master).includes('Voucher'))
  })
})

describe('YTD & growth tahunan', () => {
  const today = '2026-08-18'

  test('YTD Juli 2026: Januari sampai akhir Juli (bulan sudah lewat)', () => {
    const r = ytdRange(2026, 7, today)
    assert.equal(r.from, '2026-01-01')
    assert.equal(r.to, '2026-07-31')
    assert.ok(r.label.includes('Juli'))
  })
  test('YTD bulan berjalan dipotong di hari ini, bukan akhir bulan', () => {
    const r = ytdRange(2026, 8, today)
    assert.equal(r.to, '2026-08-18')
  })
  test('tahun lampau memakai akhir bulan penuh', () => {
    assert.equal(ytdRange(2025, 7, today).to, '2025-07-31')
  })
  test('periode yang belum terjadi ditolak, bukan dijawab nol', () => {
    assert.throws(() => ytdRange(2027, 1, today))
  })

  test('tahun pembanding dipotong pada HARI YANG SAMA', () => {
    const kini = ytdRange(2026, 8, today)
    const dulu = ytdCompareRange(kini, 2025)
    assert.equal(dulu.from, '2025-01-01')
    assert.equal(dulu.to, '2025-08-18')
  })
  test('bulan penuh dibandingkan dengan bulan penuh', () => {
    const dulu = ytdCompareRange(ytdRange(2026, 7, today), 2025)
    assert.equal(dulu.to, '2025-07-31')
  })
  test('29 Februari tahun kabisat turun ke 28 di tahun biasa', () => {
    const kini = ytdRange(2024, 2, '2024-02-29')
    assert.equal(kini.to, '2024-02-29')
    assert.equal(ytdCompareRange(kini, 2023).to, '2023-02-28')
  })

  test('nama bulan Indonesia & Inggris dikenali', () => {
    assert.equal(parseMonth('Juli'), 7)
    assert.equal(parseMonth('juli'), 7)
    assert.equal(parseMonth('jul'), 7)
    assert.equal(parseMonth('July'), 7)
    assert.equal(parseMonth('Agustus'), 8)
    assert.equal(parseMonth('Des'), 12)
    assert.equal(parseMonth('7'), 7)
    assert.equal(parseMonth(7), 7)
  })
  test('bulan tidak dikenal ditolak, tidak ditebak', () => {
    assert.equal(parseMonth('Julai'), null)
    assert.equal(parseMonth('13'), null)
    assert.equal(parseMonth(0), null)
    assert.equal(parseMonth(''), null)
  })
  test('pertanyaan YTD mengaktifkan kelompok sales', () => {
    const base = { usedTools: [] as string[], izinMenu: BERIZIN }
    assert.ok(isSalesQuestion('hitung YTD Juli 2026 vs 2025'))
    assert.ok(isSalesQuestion('berapa growth tahun ini'))
  })
  test('sales_ytd masuk kelompok sales', () => {
    assert.equal(groupOf('sales_ytd'), 'sales')
    assert.ok(
      selectGroups({ usedTools: [], text: 'x', mode: 'sales', izinMenu: BERIZIN }).has('sales')
    )
  })
})

describe('growth YTD dengan cakupan ERP (regresi +3.512.884%)', () => {
  // Aturannya murni: cakupan bukan "all" + pembanding sebelum bridging jalan
  // => persentase tidak boleh disajikan sebagai pertumbuhan bisnis.
  const menyesatkan = (scope: string, baselineFrom: string): boolean =>
    scope !== 'all' && baselineFrom < ERP_BRIDGING_START

  test('YTD 2026 vs 2025 dengan scope erp ditandai menyesatkan', () => {
    assert.equal(menyesatkan('erp', '2025-01-01'), true)
    assert.equal(menyesatkan('not_erp', '2025-01-01'), true)
  })
  test('cakupan all tidak pernah ditandai', () => {
    assert.equal(menyesatkan('all', '2025-01-01'), false)
    assert.equal(menyesatkan('all', '2024-01-01'), false)
  })
  test('pembanding setelah bridging jalan aman', () => {
    assert.equal(menyesatkan('erp', '2026-01-01'), false)
  })
  test('tanggal mulai bridging tetap 2025-12-01', () => {
    assert.equal(ERP_BRIDGING_START, '2025-12-01')
  })
})

describe('dasar pengakuan: sales = date_result, order = date_received', () => {
  test('default adalah invoice (sales yang diakui)', () => {
    assert.equal(DEFAULT_BASIS, 'invoice')
  })
  test('pertanyaan sales/omzet/growth memakai invoice', () => {
    for (const t of [
      'berapa sales bulan ini',
      'omzet Juli 2026',
      'penjualan per cabang tahun ini',
      'growth YTD Juli 2026 vs 2025',
      'berapa revenue kita',
      'nett bulan lalu berapa'
    ]) {
      assert.equal(basisFromText(t), 'invoice', t)
    }
  })
  test('pertanyaan order yang masuk memakai order', () => {
    for (const t of [
      'berapa order yang masuk bulan ini',
      'jumlah orderan hari ini',
      'order masuk minggu ini',
      'berapa registrasi kemarin'
    ]) {
      assert.equal(basisFromText(t), 'order', t)
    }
  })
  test('"sales order ERP" tetap dibaca sebagai ORDER', () => {
    assert.equal(basisFromText('Sales order ERP bulan ini'), 'order')
  })
  test('"sales invoice ERP" dibaca sebagai INVOICE', () => {
    assert.equal(basisFromText('Sales invoice ERP bulan ini vs bulan lalu'), 'invoice')
  })
  test('kalimat tanpa petunjuk tidak dipaksa (pilihan model dihormati)', () => {
    assert.equal(basisFromText('kalau bulan lalu?'), null)
    assert.equal(basisFromText('bagaimana dengan Jawa Barat'), null)
  })

  test('guard menimpa basis yang dipilih model bila user menyebut sales', () => {
    const out = applyBasisRule('sales_ytd', { throughMonth: 'Juli', basis: 'order' }, 'hitung ytd juli 2026 vs 2025 sales kita')
    assert.equal(out.basis, 'invoice')
  })
  test('guard membalik ke order bila user menanyakan order masuk', () => {
    const out = applyBasisRule('sales_summary', { period: 'this_month', basis: 'invoice' }, 'berapa order yang masuk bulan ini')
    assert.equal(out.basis, 'order')
  })
  test('kalimat netral: argumen model dibiarkan apa adanya', () => {
    const args = { period: 'last_month', basis: 'order' }
    assert.equal(applyBasisRule('sales_summary', args, 'kalau bulan lalu?'), args)
  })
  test('tool non-sales tidak disentuh', () => {
    const args = { keyword: 'x' }
    assert.equal(applyBasisRule('inno_customer_search', args, 'berapa sales bulan ini'), args)
  })
})

describe('pelanggan berhenti / melemah / baru (sales_customers)', () => {
  // Pelanggan TIDAK bisa dinilai seperti item: iramanya sangat berbeda-beda. Terukur
  // 13 bulan terakhir: 182 pelanggan order tiap bulan, 313 pelanggan hanya 1 bulan.
  // Karena itu penilaiannya irama + diam + nilai, bukan banding dua periode.
  const buat = (o: Partial<BarisPelanggan>): BarisPelanggan => ({
    kode: 'X',
    nama: 'RS Contoh',
    tipe: 'RS',
    bulanAktif: 6,
    hariDiam: 90,
    hariSejakPertama: 300,
    nettTotal: 100_000_000,
    nettTerkini: 0,
    nettSebelum: 50_000_000,
    ...o
  })

  test('rutin lalu diam lama = berhenti', () => {
    const r = pickBerhenti([buat({ bulanAktif: 6, hariDiam: 90 })])
    assert.equal(r.length, 1)
  })
  test('pelanggan jarang order TIDAK dianggap berhenti', () => {
    // Order 2 bulan dari 12 lalu diam — itu memang iramanya, bukan alarm.
    assert.equal(pickBerhenti([buat({ bulanAktif: 2, hariDiam: 90 })]).length, 0)
  })
  test('rutin tapi baru saja order TIDAK dianggap berhenti', () => {
    assert.equal(pickBerhenti([buat({ bulanAktif: 8, hariDiam: 10 })]).length, 0)
  })
  test('diurutkan menurut rupiah, bukan lamanya diam', () => {
    const kecilTapiLamaDiam = buat({ kode: 'kecil', hariDiam: 300, nettTotal: 5_000_000 })
    const besarTapiBaruDiam = buat({ kode: 'besar', hariDiam: 70, nettTotal: 900_000_000 })
    const r = pickBerhenti([kecilTapiLamaDiam, besarTapiBaruDiam])
    assert.equal(r[0].kode, 'besar')
  })
  test('ambang bisa diatur', () => {
    const baris = [buat({ bulanAktif: 3, hariDiam: 40 })]
    assert.equal(pickBerhenti(baris).length, 0)
    assert.equal(pickBerhenti(baris, { minBulanAktif: 2, diamHari: 30 }).length, 1)
  })

  test('melemah = masih order tapi turun melewati ambang', () => {
    const r = pickMelemah([buat({ hariDiam: 10, nettSebelum: 100, nettTerkini: 50 })])
    assert.equal(r.length, 1)
    assert.equal(r[0].persenTurun, 50)
  })
  test('turun tipis tidak masuk daftar melemah', () => {
    assert.equal(pickMelemah([buat({ hariDiam: 10, nettSebelum: 100, nettTerkini: 90 })]).length, 0)
  })
  test('yang sudah berhenti TIDAK ikut di daftar melemah (tidak tumpang tindih)', () => {
    assert.equal(pickMelemah([buat({ hariDiam: 200, nettSebelum: 100, nettTerkini: 0 })]).length, 0)
  })
  test('pelanggan tanpa riwayat sebelumnya tidak dihitung melemah', () => {
    assert.equal(pickMelemah([buat({ hariDiam: 10, nettSebelum: 0, nettTerkini: 0 })]).length, 0)
  })

  test('baru = order pertamanya di dalam jendela', () => {
    assert.equal(pickBaru([buat({ hariSejakPertama: 30 })]).length, 1)
    assert.equal(pickBaru([buat({ hariSejakPertama: 300 })]).length, 0)
  })

  // Pasien Pribadi = pasien perorangan berharga khusus dari dokter RS, bukan instansi
  // yang bisa ditelepon sales. Master TIDAK lengkap: 156 pelanggan bertransaksi tanpa
  // ada di master, 145 di antaranya bernama "Pasien Pribadi".
  test('tipe PR dari master dikenali', () => {
    assert.equal(isPasienPribadi('PR', 'Apa saja'), true)
    assert.equal(isPasienPribadi('RS', 'Pasien Pribadi Menyesatkan'), false)
  })
  test('tanpa master, nama dipakai sebagai cadangan', () => {
    assert.equal(isPasienPribadi(null, 'Pasien Pribadi RSUD Dr. Soetomo'), true)
    assert.equal(isPasienPribadi(null, 'Pasien Drive Thru La Maison'), true)
    assert.equal(isPasienPribadi(null, 'RS Paru Dr. H.A. Rotinsulu'), false)
  })
  test('segmen institusi mengeluarkan pasien pribadi', () => {
    const baris = [
      buat({ kode: 'rs', tipe: 'RS' }),
      buat({ kode: 'pp', tipe: 'PR' }),
      buat({ kode: 'pp2', tipe: null, nama: 'Pasien Pribadi RS X' })
    ]
    assert.deepEqual(pilihPelanggan(baris, 'berhenti', 'institusi').map((r) => r.kode), ['rs'])
    assert.equal(pilihPelanggan(baris, 'berhenti', 'pasien_pribadi').length, 2)
    assert.equal(pilihPelanggan(baris, 'berhenti', 'semua').length, 3)
  })

  test('pertanyaan pelanggan berhenti mengaktifkan kelompok sales', () => {
    const base = { usedTools: [] as string[], izinMenu: BERIZIN }
    for (const t of [
      'Pelanggan mana yang berhenti order?',
      'siapa yang sudah lama tidak order',
      'customer mana yang hilang bulan ini',
      'pelanggan baru 90 hari terakhir siapa saja'
    ]) {
      assert.ok(isSalesQuestion(t), t)
    }
  })
  test('chat umum tidak ikut terjaring pemicu churn', () => {
    const base = { usedTools: [] as string[], izinMenu: BERIZIN }
    assert.ok(!isSalesQuestion('tolong rapikan folder arsip'))
  })
})

describe('laporan penjualan (sales_report)', () => {
  // Laporan memuat puluhan angka. Kalau model harus menyalinnya dari hasil tool ke
  // write_word, di situlah angka bisa berubah tanpa ada yang sadar. Karena itu isinya
  // disusun di kode dan filenya ditulis tool sendiri — bagian ini yang diuji.
  const dasar: DataLaporan = {
    judul: 'Laporan Penjualan — Agustus 2026',
    periodeLabel: 'Agustus 2026',
    periodeRentang: '2026-08-01 s/d 2026-08-18',
    pembandingLabel: 'Juli 2026',
    pembandingRentang: '2026-07-01 s/d 2026-07-18',
    dibuatPada: '2026-08-18',
    basisKey: 'invoice',
    catatanBasis: 'SALES YANG DIAKUI',
    catatanCakupan: 'seluruh transaksi',
    catatanPengakuan: 'transfer dibatalkan tidak dihitung',
    kini: {
      nett: 4_307_342_630, gross: 5_300_000_000, diskon: 992_657_370,
      jumlahOrder: 5312, barisItem: 6270, jumlahInvoice: 3899,
      pelanggan: 402, jenisItem: 310
    },
    lalu: { nett: 3_900_000_000, jumlahOrder: 5000, pelanggan: 380 },
    perSource: [{ kategori: 'Molekuler', nett: 1_547_370_800, persen: 35.9, jumlahOrder: 530 }],
    topItem: [{ kategori: 'NutriGEN-ME Life', nett: 487_250_000, persen: 11.3 }],
    topPelanggan: [{ kategori: 'RS Medistra', nett: 300_000_000, persen: 7 }],
    perProvinsi: [{ kategori: 'DKI JAKARTA', nett: 2_136_000_000, persen: 49.6 }],
    itemNaik: [{ nama: 'HPV DNA', selisih: 50_000_000, persen: 20 }],
    itemTurun: [{ nama: 'EGFR', selisih: -30_000_000, persen: -15 }],
    pelangganBerhenti: [
      { nama: 'RS Paru Dr. H.A. Rotinsulu', bulanAktif: 6, hariDiam: 71, nettTotal: 143_400_000 }
    ],
    jumlahPelangganBerhenti: 70,
    nilaiPelangganBerhenti: 1_580_274_860
  }

  test('rupiah diformat gaya Indonesia tanpa desimal', () => {
    assert.equal(rupiah(4_307_342_630), 'Rp 4.307.342.630')
    assert.equal(rupiah(0), 'Rp 0')
    assert.equal(rupiah(-30_000_000), '-Rp 30.000.000')
  })
  test('persen perubahan null bila pembanding nol — bukan 0% atau tak hingga', () => {
    assert.equal(persenUbah(100, 0), null)
    assert.equal(persenUbah(110, 100), 10)
    assert.equal(persenUbah(90, 100), -10)
  })

  describe('laporan versi Excel', () => {
    // ⚠️ Yang dikunci di sini BUKAN kerapian sheet (itu di excel.test.ts),
    // melainkan bahwa Excel, Word, dan PDF bersumber dari SATU perhitungan.
    // Kalau masing-masing menghitung sendiri, tiga berkas untuk periode yang
    // sama bisa berbeda isi — dan yang menemukannya adalah orang di rapat yang
    // memegang dua di antaranya.
    const sheets = susunLaporanExcel(dasar)
    const cari = (nama: string): Array<Array<string | number | null>> =>
      sheets.find((x) => x.name === nama)!.rows

    test('bagian pentingnya jadi sheet sendiri', () => {
      const nama = sheets.map((x) => x.name)
      for (const wajib of ['Ringkasan', 'Pemeriksaan Terbesar', 'Pelanggan Terbesar', 'Metodologi']) {
        assert.ok(nama.includes(wajib), `${wajib} tidak ada — ada: ${nama.join(', ')}`)
      }
    })

    test('nama sheet tidak melampaui batas Excel (31 karakter)', () => {
      for (const x of sheets) assert.ok(x.name.length <= 31, x.name)
    })

    test('angka ditulis sebagai ANGKA, bukan teks berformat rupiah', () => {
      // Angka berupa teks tidak bisa dijumlahkan penerimanya — dan itu justru
      // alasan orang minta versi Excel.
      const nett = cari('Ringkasan').find((r) => r[0] === 'Nett')!
      assert.equal(typeof nett[1], 'number')
      assert.equal(nett[1], dasar.kini.nett)
      const item = cari('Pemeriksaan Terbesar')[1]
      assert.equal(typeof item[1], 'number')
    })

    test('angkanya SAMA PERSIS dengan versi naratif', () => {
      const teks = susunLaporan(dasar).map((b) => b.text).join(' ')
      assert.match(teks, /4\.307\.342\.630/)
      const nett = cari('Ringkasan').find((r) => r[0] === 'Nett')!
      assert.equal(nett[1], 4_307_342_630)
    })

    test('tiap sheet punya baris header', () => {
      for (const x of sheets) {
        assert.ok(x.rows.length >= 1, x.name)
        assert.ok(typeof x.rows[0][0] === 'string', x.name)
      }
    })

    test('bagian kosong tidak jadi sheet hampa', () => {
      // Sheet berisi judul kolom saja terlihat seperti data yang hilang.
      const tanpa = susunLaporanExcel({ ...dasar, topItem: [], pelangganBerhenti: [] })
      const nama = tanpa.map((x) => x.name)
      assert.ok(!nama.includes('Pemeriksaan Terbesar'))
      assert.ok(!nama.includes('Pelanggan Berhenti'))
    })

    test('metodologi ikut — angka laporan sering dipertanyakan berbulan kemudian', () => {
      const isi = cari('Metodologi').flat().join(' ')
      assert.match(isi, /SALES YANG DIAKUI/)
      assert.match(isi, /transfer dibatalkan/)
    })
  })

  test('periode TANPA transaksi tidak dibingkai sebagai "turun 100%"', () => {
    // ⚠️ Terlihat pada laporan sungguhan 21 Agu 2026: laporan "hari ini" dibuat
    // pukul 00.25 saat belum ada transaksi. Angkanya benar (Rp 0) tapi
    // kalimatnya berbunyi "penjualan turun Rp 333.969.650 atau -100%" — terbaca
    // sebagai kejatuhan bisnis di ringkasan eksekutif yang dibaca direksi.
    const kosong = susunLaporan({
      ...dasar,
      kini: { ...dasar.kini, nett: 0, gross: 0, diskon: 0, jumlahOrder: 0, pelanggan: 0, barisItem: 0, jumlahInvoice: 0, jenisItem: 0 }
    })
    const teks = kosong.map((b) => b.text).join(' ')
    assert.match(teks, /Belum ada transaksi tercatat/)
    assert.doesNotMatch(teks, /-100%/)
    // Pembandingnya tetap disebut — supaya pembaca tahu ukurannya, bukan
    // sekadar diberi tahu bahwa datanya kosong.
    assert.match(teks, /Sebagai pembanding/)
  })

  test('periode BERISI tetap memakai bingkai perbandingan seperti biasa', () => {
    const teks = susunLaporan(dasar).map((b) => b.text).join(' ')
    assert.match(teks, /Dibanding Juli 2026/)
    assert.doesNotMatch(teks, /Belum ada transaksi tercatat/)
  })

  test('laporan memuat seluruh bagian standar', () => {
    const judul = susunLaporan(dasar).filter((b) => b.type === 'h2').map((b) => b.text)
    for (const wajib of [
      'Ringkasan Eksekutif',
      'Kinerja Periode',
      'Kontribusi per Kategori Layanan',
      'Pemeriksaan Terbesar',
      'Pelanggan Terbesar',
      'Sebaran Wilayah (Provinsi Pelanggan)',
      'Pemeriksaan yang Naik dan Turun',
      'Pelanggan yang Berhenti Order',
      'Catatan Metodologi'
    ]) {
      assert.ok(judul.includes(wajib), `bagian hilang: ${wajib}`)
    }
  })
  test('dimulai dengan satu judul utama', () => {
    const b = susunLaporan(dasar)
    assert.equal(b[0].type, 'h1')
    assert.equal(b.filter((x) => x.type === 'h1').length, 1)
  })
  test('angka utama muncul apa adanya, sudah terformat', () => {
    const teks = susunLaporan(dasar).map((b) => b.text).join('\n')
    assert.ok(teks.includes('Rp 4.307.342.630'))
    assert.ok(teks.includes('5.312'))   // jumlah order
    assert.ok(teks.includes('6.270'))   // baris item — dibedakan dari order
  })
  test('metodologi selalu menyebut dasar pengakuan dan transaksi dibatalkan', () => {
    const teks = susunLaporan(dasar).map((b) => b.text).join('\n')
    assert.ok(teks.includes('SALES YANG DIAKUI'))
    assert.ok(teks.includes('transfer dibatalkan tidak dihitung'))
  })
  test('periode tanpa transaksi tidak bikin laporan rusak', () => {
    const kosong: DataLaporan = {
      ...dasar,
      kini: { nett: 0, gross: 0, diskon: 0, jumlahOrder: 0, barisItem: 0, jumlahInvoice: 0, pelanggan: 0, jenisItem: 0 },
      lalu: { nett: 0, jumlahOrder: 0, pelanggan: 0 },
      perSource: [], topItem: [], topPelanggan: [], perProvinsi: [],
      itemNaik: [], itemTurun: [], pelangganBerhenti: [],
      jumlahPelangganBerhenti: 0, nilaiPelangganBerhenti: 0
    }
    const b = susunLaporan(kosong)
    const teks = b.map((x) => x.text).join('\n')
    assert.ok(b.length > 10)
    assert.ok(teks.includes('tidak terdefinisi'))     // bukan "0%" palsu
    assert.ok(!teks.includes('undefined') && !teks.includes('NaN'))
  })
  test('YTD boleh tidak ada tanpa merusak laporan', () => {
    const teks = susunLaporan({ ...dasar, ytd: undefined }).map((b) => b.text).join('\n')
    assert.ok(!teks.includes('undefined'))
  })
  test('peringatan growth YTD ikut tercetak bila ada', () => {
    const teks = susunLaporan({
      ...dasar,
      ytd: { label: 'YTD 2026', labelPembanding: 'YTD 2025', nett: 60e9, nettPembanding: 32e9, growthPersen: null, peringatan: 'efek bridging' }
    }).map((b) => b.text).join('\n')
    assert.ok(teks.includes('efek bridging'))
  })
})

describe('label periode laporan (regresi: dokumen tertulis "bulan ini")', () => {
  // Nama periode mentah tidak boleh masuk dokumen cetak — laporan yang sama dibaca
  // bulan depan dan "bulan ini" jadi menyesatkan. Terjadi nyata pada laporan pertama.
  test('sebulan penuh cukup nama bulan', () => {
    assert.equal(labelPeriode('2026-07-01', '2026-07-31'), 'Juli 2026')
    assert.equal(labelPeriode('2026-02-01', '2026-02-28'), 'Februari 2026')
  })
  test('tahun kabisat dikenali sebagai bulan penuh', () => {
    assert.equal(labelPeriode('2024-02-01', '2024-02-29'), 'Februari 2024')
  })
  test('bulan berjalan memakai rentang tanggal', () => {
    assert.equal(labelPeriode('2026-08-01', '2026-08-18'), '1–18 Agustus 2026')
  })
  test('lintas bulan ditulis lengkap', () => {
    assert.equal(labelPeriode('2026-07-20', '2026-08-18'), '20 Juli – 18 Agustus 2026')
  })
  test('lintas tahun menyebut kedua tahun', () => {
    assert.equal(labelPeriode('2025-12-20', '2026-01-05'), '20 Desember 2025 – 5 Januari 2026')
  })
  test('tidak pernah mengembalikan kata "bulan ini"', () => {
    for (const [a, b] of [['2026-08-01', '2026-08-18'], ['2026-07-01', '2026-07-31']]) {
      assert.ok(!/bulan ini|hari sebelumnya/i.test(labelPeriode(a, b)))
    }
  })
})

describe('context overflow (regresi: user cuma melihat HTTP 400 mentah)', () => {
  const vllm = JSON.stringify({
    error: {
      message:
        "This model's maximum context length is 32768 tokens. However, you requested 41200 tokens. " +
        'Please reduce the length of the messages.',
      type: 'BadRequestError',
      code: 400
    }
  })

  test('pesan overflow vLLM dikenali', () => {
    assert.equal(isContextOverflow(400, vllm), true)
  })
  test('varian teks lain ikut dikenali', () => {
    for (const t of [
      'context_length_exceeded',
      'input is too long for this model',
      'prompt is too long',
      'exceeds the model context window',
      'token limit reached'
    ]) {
      assert.equal(isContextOverflow(400, t), true, t)
    }
    assert.equal(isContextOverflow(413, 'input is too long'), true)
  })
  test('HTTP 400 karena sebab LAIN tidak dituduh overflow', () => {
    // Salah menuduh akan menyuruh user memulai chat baru padahal masalahnya bukan itu.
    assert.equal(isContextOverflow(400, JSON.stringify({ error: { message: 'unknown model AURA-x' } })), false)
    assert.equal(isContextOverflow(400, 'invalid tool call arguments'), false)
    assert.equal(isContextOverflow(500, vllm), false)
    assert.equal(isContextOverflow(400, ''), false)
  })

  // Potongan riwayat yang diawali pesan `tool` ditolak gateway dengan 400 lagi —
  // errornya berganti wujud, bukan hilang.
  const riwayat = [
    { role: 'system', content: 'aturan' },
    { role: 'user', content: 'tanya 1' },
    { role: 'assistant', content: 'jawab 1' },
    { role: 'user', content: 'tanya 2' },
    { role: 'assistant', content: '' },
    { role: 'tool', content: 'hasil tool', tool_call_id: 'a' },
    { role: 'assistant', content: 'jawab 2' },
    { role: 'user', content: 'tanya 3' }
  ]

  test('system prompt selalu dipertahankan', () => {
    assert.equal(pangkasRiwayat(riwayat, 3)[0].role, 'system')
  })
  test('potongan selalu diawali giliran user, tidak pernah tool/assistant', () => {
    for (const sisa of [1, 2, 3, 4, 5, 6]) {
      const hasil = pangkasRiwayat(riwayat, sisa)
      const setelahSystem = hasil[0].role === 'system' ? hasil[1] : hasil[0]
      assert.equal(setelahSystem?.role, 'user', `sisakan=${sisa}`)
    }
  })
  test('pertanyaan terakhir tidak pernah ikut terbuang', () => {
    const hasil = pangkasRiwayat(riwayat, 2)
    assert.equal(hasil[hasil.length - 1].content, 'tanya 3')
  })
  test('riwayat yang sudah pendek tidak diutak-atik', () => {
    assert.deepEqual(pangkasRiwayat(riwayat, 99), riwayat)
    assert.deepEqual(pangkasRiwayat([], 3), [])
  })
  test('riwayat tanpa system tetap aman', () => {
    const tanpa = riwayat.slice(1)
    const hasil = pangkasRiwayat(tanpa, 3)
    assert.equal(hasil[0].role, 'user')
  })
  test('pemangkasan makin agresif pada percobaan kedua', () => {
    assert.ok(sisaGiliranUntukPercobaan(2) < sisaGiliranUntukPercobaan(1))
  })

  test('pesan ke user bisa ditindaklanjuti, bukan kode teknis', () => {
    const p = pesanUntukUser('LLM_CONTEXT_OVERFLOW', 'HTTP 400')
    assert.ok(/terlalu panjang/i.test(p))
    assert.ok(/Task Baru/.test(p))
    assert.ok(!/HTTP|400/.test(p))
  })
  test('gagal jaringan menyebut VPN, bukan istilah teknis', () => {
    const p = pesanUntukUser('LLM_UNREACHABLE', 'ECONNREFUSED')
    assert.ok(/jaringan internal|VPN/i.test(p))
  })
  test('kode tak dikenal tetap membawa detail teknis untuk ditelusuri', () => {
    assert.ok(pesanUntukUser('INTERNAL_ERROR', 'boom').includes('boom'))
  })
})

describe('ringkasan pesan error gateway', () => {
  test('mengambil error.message dari bentuk vLLM/OpenAI', () => {
    assert.equal(
      ringkasPesanError(JSON.stringify({ error: { message: 'maximum context length is 32768' } })),
      'maximum context length is 32768'
    )
  })
  test('mendukung bentuk {message} dan {detail}', () => {
    assert.equal(ringkasPesanError(JSON.stringify({ message: 'apa saja' })), 'apa saja')
    assert.equal(ringkasPesanError(JSON.stringify({ detail: 'dari FastAPI' })), 'dari FastAPI')
  })
  test('body non-JSON dipakai apa adanya', () => {
    assert.equal(ringkasPesanError('  Bad   Request \n gateway '), 'Bad Request gateway')
  })
  test('body kosong menghasilkan string kosong, bukan "undefined"', () => {
    assert.equal(ringkasPesanError(''), '')
    assert.equal(ringkasPesanError('   '), '')
  })
  test('body raksasa dipotong supaya tidak membanjiri layar & log', () => {
    assert.ok(ringkasPesanError('x'.repeat(5000)).length <= 300)
  })
})
