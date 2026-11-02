import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  KOLOM_AMAN,
  KOLOM_TERLARANG,
  MIN_VOLUME_PERSEN,
  TAHAPAN,
  catatanDaftar,
  catatanKesegaran,
  catatanOrderVsBaris,
  catatanTahap,
  ekspresiLama,
  kolomBoleh,
  pastikanKolomAman,
  tahapDari,
  JANGKAR_UMUR,
  BACKLOG_CLAUSE,
  DIAKUI_CLAUSE
} from '../src/main/lab/rules'
import { selectGroups, groupOf, saranMenu, isLabQuestion } from '../src/main/agent/tool-groups'

// Menu "Tanya TAT Sample" — data perjalanan sampel (`v_sample_tracker`).

describe('identitas pasien tidak pernah keluar', () => {
  // Penyimpangan sadar dari aturan 3: tool lab BOLEH mengembalikan baris per
  // sampel, karena view ini tidak punya dob/diagnosis/hasil seperti
  // SalesRepository. Syaratnya satu, dan inilah yang menahannya.
  test('patient tidak ada di daftar kolom aman', () => {
    assert.equal(kolomBoleh('patient'), false)
    assert.ok(!(KOLOM_AMAN as readonly string[]).includes('patient'))
    assert.ok(KOLOM_TERLARANG.includes('patient'))
  })

  test('kolom terlarang membuat pastikanKolomAman MELEMPAR, bukan diam-diam membuang', () => {
    // Membuang diam-diam menyembunyikan pemanggil yang keliru; melempar
    // memaksanya terlihat saat dikembangkan.
    assert.throws(() => pastikanKolomAman(['order_id', 'patient']), /patient/)
  })

  test('kolom operasional tetap boleh', () => {
    for (const k of ['order_id', 'test', 'category', 'sample_status', 'is_rns', 'date_result']) {
      assert.equal(kolomBoleh(k), true, `seharusnya boleh: ${k}`)
    }
  })

  // ⚠️ Daftar-IZIN, bukan daftar-larangan. Kolom baru yang muncul di view karena
  // ETL berubah otomatis TIDAK ikut keluar, alih-alih otomatis bocor.
  test('kolom yang belum dikenal ditolak, bukan diloloskan', () => {
    assert.equal(kolomBoleh('nama_pasien'), false)
    assert.equal(kolomBoleh('nik'), false)
    assert.equal(kolomBoleh('kolom_baru_dari_etl'), false)
  })
})

describe('order_validated_at tidak pernah dihitung dalam jam', () => {
  // ⚠️ Terukur 27 Agu 2026: 29.050 dari 29.050 baris berjam 00:00:00. Menghitung
  // tahap ini dalam jam membuat 19.441 baris (67%) NEGATIF, terparah −18,5 jam.
  const kenaValidasi = TAHAPAN.filter(
    (t) => t.dari === 'order_validated_at' || t.ke === 'order_validated_at'
  )

  test('ada tahap yang menyentuh order_validated_at (kalau tidak, test ini sia-sia)', () => {
    assert.ok(kenaValidasi.length >= 2)
  })

  test('semuanya berketelitian hari, bukan jam', () => {
    for (const t of kenaValidasi) {
      assert.equal(t.ketelitian, 'hari', `tahap ${t.kode} harus dihitung dalam hari`)
    }
  })

  test('ekspresinya memotong ke tanggal, bukan mengurangi timestamp', () => {
    for (const t of kenaValidasi) {
      const e = ekspresiLama(t)
      assert.match(e, /::date/)
      assert.doesNotMatch(e, /EXTRACT\(EPOCH/)
    }
  })

  test('tahap ber-jam tetap memakai selisih waktu penuh', () => {
    const total = tahapDari('total')
    assert.ok(total)
    assert.equal(total!.ketelitian, 'jam')
    assert.match(ekspresiLama(total!), /EXTRACT\(EPOCH/)
  })
})

describe('umur backlog memakai jangkar berjenjang', () => {
  // ⚠️ Status "Order Validated by IP" (58 baris) belum punya
  // lab_sample_received_at. Mengukur umur dari kolom itu saja membuat mereka
  // bernilai NULL dan HILANG DIAM-DIAM dari laporan — padahal justru merekalah
  // yang perlu dilihat: order sudah divalidasi tapi sampelnya tidak datang.
  test('COALESCE turun ke order_validated_at lalu order_created_at', () => {
    assert.match(JANGKAR_UMUR, /^COALESCE\(/)
    assert.match(JANGKAR_UMUR, /lab_sample_received_at/)
    assert.match(JANGKAR_UMUR, /order_validated_at/)
    assert.match(JANGKAR_UMUR, /order_created_at/)
  })

  test('urutannya benar: yang paling tepat lebih dulu', () => {
    const i = (k: string): number => JANGKAR_UMUR.indexOf(k)
    assert.ok(i('lab_sample_received_at') < i('order_validated_at'))
    assert.ok(i('order_validated_at') < i('order_created_at'))
  })
})

describe('sampel batal tidak pernah dihitung', () => {
  test('dasar pengakuan menutup canceled_at', () => {
    assert.match(DIAKUI_CLAUSE, /canceled_at IS NULL/)
  })

  test('backlog = diakui DAN hasilnya belum keluar', () => {
    assert.match(BACKLOG_CLAUSE, /canceled_at IS NULL/)
    assert.match(BACKLOG_CLAUSE, /date_result IS NULL/)
    // AND, bukan OR — pelajaran RECOGNIZED_CLAUSE di sales: varian OR tidak
    // menyaring apa pun dan hasilnya identik dengan tanpa filter.
    assert.match(BACKLOG_CLAUSE, /\bAND\b/)
    assert.doesNotMatch(BACKLOG_CLAUSE, /\bOR\b/)
  })
})

describe('catatan hasil TIDAK PERNAH kosong', () => {
  // Pelajaran yang sudah dibayar berkali-kali (HANDOFF §7): bendera boolean
  // tidak menahan apa pun; yang menahan adalah KALIMAT.
  test('nol dibedakan dari terpotong', () => {
    const nol = catatanDaftar(0, 0, 'backlog')
    assert.match(nol, /hasil nyata/i)
    assert.match(nol, /jangan menyebut data terpotong/i)
  })

  test('lengkap dinyatakan lengkap secara harfiah', () => {
    const penuh = catatanDaftar(12, 12, 'backlog')
    assert.match(penuh, /Seluruh 12/)
    assert.match(penuh, /tidak ada yang dipotong/i)
  })

  test('terpotong menyebut ANGKA sisanya, bukan sekadar "ada lagi"', () => {
    const potong = catatanDaftar(30, 1028, 'backlog')
    assert.match(potong, /30/)
    assert.match(potong, /1028/)
    assert.match(potong, /998/)
  })

  test('tidak ada bentuk catatan yang kosong', () => {
    for (const c of [catatanDaftar(0, 0, 'x'), catatanDaftar(5, 5, 'x'), catatanDaftar(5, 9, 'x')]) {
      assert.ok(c.trim().length > 30)
    }
  })

  test('kesegaran data tidak pernah mengaku real-time', () => {
    assert.match(catatanKesegaran('2026-08-27 13:31'), /2026-08-27 13:31/)
    assert.match(catatanKesegaran('2026-08-27 13:31'), /jangan menyebutnya real-time/i)
    // Bahkan saat waktunya tidak terbaca, larangannya tetap ada.
    assert.match(catatanKesegaran(null), /jangan mengaku data ini real-time/i)
  })
})

describe('tahap yang tidak universal wajib dinyatakan', () => {
  // ⚠️ HPV DNA & LBC: 0 dari 8.999 punya pathology_completed_at. Kalau tool diam,
  // model melaporkan nol sebagai temuan. Ini kegagalan yang sama dengan
  // "nol bukan berarti bersih" (aturan 33).
  test('tahap patologi ditandai tidak universal', () => {
    const p = tahapDari('patologi')
    assert.ok(p)
    assert.equal(p!.universal, false)
  })

  test('catatannya melarang melaporkannya sebagai temuan', () => {
    const c = catatanTahap(tahapDari('patologi')!)
    assert.match(c, /TIDAK berlaku untuk semua kategori/i)
    assert.match(c, /jangan melaporkannya sebagai temuan/i)
  })

  test('tahap berketelitian hari melarang penyajian dalam jam', () => {
    const c = catatanTahap(tahapDari('order_ke_validasi')!)
    assert.match(c, /HARI KALENDER/)
    assert.match(c, /Jangan menyajikannya dalam jam/i)
  })
})

describe('order dibedakan dari baris pemeriksaan', () => {
  // ⚠️ 25.716 order untuk 29.050 baris. Di sales dua angka seperti ini pernah
  // dikirim sebagai satu angka bernama "transaksi" dan selisihnya 22%.
  test('saat berbeda, keduanya disebut terpisah dan dilarang disamakan', () => {
    const c = catatanOrderVsBaris(25716, 29050)
    assert.match(c, /25716/)
    assert.match(c, /29050/)
    assert.match(c, /jangan menyebut keduanya dengan istilah yang sama/i)
  })

  test('saat sama, tetap dijelaskan kenapa sama', () => {
    assert.match(catatanOrderVsBaris(10, 10), /satu order satu pemeriksaan/i)
  })
})

describe('ambang volume untuk peringkat persen', () => {
  // Tanpa ambang, pemeriksaan bervolume 2 yang sekali RNS tampil sebagai "50%"
  // dan mengubur EGFR (75 kali) maupun MammaPrint (17,50% dari 40).
  test('ambangnya ada dan masuk akal', () => {
    assert.ok(MIN_VOLUME_PERSEN >= 10)
  })
})

describe('kelompok tool lab terpisah dari sales', () => {
  // ⚠️ Inti alasan menu ini berdiri sendiri: staf lab perlu TAT tapi belum tentu
  // boleh melihat omzet. Izin ditegakkan per KELOMPOK tool, jadi menumpangkan
  // tool lab ke kelompok sales berarti memberi omzet bersama TAT.
  const LAB = ['lab_backlog', 'lab_lacak', 'lab_rns', 'lab_tat']

  test('semua tool lab masuk kelompok lab', () => {
    for (const t of LAB) assert.equal(groupOf(t), 'lab')
  })

  test('izin lab TIDAK membawa tool sales', () => {
    const g = selectGroups({ text: 'berapa backlog', usedTools: [], mode: 'lab', izinMenu: ['lab'] })
    assert.ok(g.has('lab'))
    assert.ok(!g.has('sales'))
    assert.ok(!g.has('inno'))
  })

  test('izin sales TIDAK membawa tool lab', () => {
    const g = selectGroups({
      text: 'berapa omzet',
      usedTools: [],
      mode: 'sales',
      izinMenu: ['sales']
    })
    assert.ok(g.has('sales'))
    assert.ok(!g.has('lab'))
  })

  test('mode lab tanpa izin lab tidak dapat tool apa pun selain core', () => {
    const g = selectGroups({
      text: 'berapa backlog',
      usedTools: [],
      mode: 'lab',
      izinMenu: ['sales']
    })
    assert.deepEqual([...g], ['core'])
  })

  // ⚠️ Jalur kebocoran yang paling mudah terlewat: percakapan lama meninggalkan
  // jejak `usedTools`, dan tanpa penyaringan ia menghidupkan kembali toolnya di
  // mode umum — sesudah aksesnya dicabut.
  test('tool lab tidak bisa masuk lewat usedTools di Task Baru', () => {
    const g = selectGroups({
      text: 'berapa backlog sampel',
      usedTools: ['lab_backlog'],
      mode: 'general',
      izinMenu: ['lab']
    })
    assert.ok(!g.has('lab'))
  })

  test('Task Baru tidak pernah membawa tool lab walau user berizin', () => {
    const g = selectGroups({
      text: 'sample apa saja yang belum keluar',
      usedTools: [],
      mode: 'general',
      izinMenu: ['sales', 'masterdata', 'lab']
    })
    assert.ok(!g.has('lab'))
  })
})

describe('pertanyaan salah pintu diarahkan ke menu yang benar', () => {
  // Tool yang hilang WAJIB disertai arahan eksplisit: model 27B yang tidak punya
  // toolnya TIDAK diam, ia menjawab dari ingatan (aturan 17).
  test('pertanyaan TAT di Task Baru diarahkan ke menu lab', () => {
    assert.equal(saranMenu('sample apa saja yang belum keluar hasilnya', 'general'), 'lab')
    assert.equal(saranMenu('berapa backlog sampel bulan ini', 'general'), 'lab')
    assert.equal(saranMenu('sample apa yang RNS terbanyak', 'general'), 'lab')
  })

  test('pertanyaan omzet di mode lab diarahkan ke menu sales', () => {
    assert.equal(saranMenu('berapa omzet bulan ini', 'lab'), 'sales')
  })

  test('pertanyaan TAT di mode sales diarahkan ke menu lab', () => {
    assert.equal(saranMenu('berapa backlog sampel di lab', 'sales'), 'lab')
  })

  test('pertanyaan yang memang milik menunya TIDAK diarahkan ke mana-mana', () => {
    assert.equal(saranMenu('berapa TAT molekuler bulan ini', 'lab'), null)
    assert.equal(saranMenu('sample apa yang RNS terbanyak', 'lab'), null)
  })

  // ⚠️ Akhiran bahasa Indonesia mematikan `\b` di ujung kata, dan justru bentuk
  // itulah yang dipakai orang. Sudah dua kali jadi guard yang tidak pernah
  // menyala di project ini (verify-guard dan DEV_HINT).
  test('bentuk berimbuhan tetap terdeteksi', () => {
    assert.equal(isLabQuestion('sampelnya sudah sampai mana'), true)
    assert.equal(isLabQuestion('tahapannya di mana sekarang'), true)
    assert.equal(isLabQuestion('backlognya berapa'), true)
  })

  test('kata sehari-hari tidak salah tertangkap sebagai pertanyaan lab', () => {
    assert.equal(isLabQuestion('tolong rapikan tata letak dokumen ini'), false)
    assert.equal(isLabQuestion('siapa kamu'), false)
  })
})
