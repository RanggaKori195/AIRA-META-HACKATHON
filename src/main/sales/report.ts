// Penyusun laporan penjualan bulanan (struktur standar korporat).
//
// KENAPA DISUSUN DI KODE, BUKAN OLEH MODEL. Sebuah laporan memuat puluhan angka. Kalau
// model harus menyalinnya dari hasil tool ke write_word, di situlah angka bisa berubah
// tanpa ada yang sadar — persis risiko yang paling dijaga di project ini. Jadi tool
// mengambil angkanya, menyusun seluruh isi dokumen di sini, lalu menulis filenya sendiri.
// Model hanya memilih periode dan lokasi file.
//
// Modul murni (tanpa I/O, tanpa docx) supaya ter-cover unit test.

export interface BlokDokumen {
  type: 'h1' | 'h2' | 'h3' | 'p' | 'bullet'
  text: string
}

export interface BarisRingkas {
  kategori: string
  nett: number
  persen?: number | null
  jumlahOrder?: number
}

export interface BarisMover {
  nama: string
  selisih: number
  persen?: number | null
  status?: string
}

/**
 * Satu baris hasil `sales_movers` -> baris laporan.
 * ⚠️ Nama item ada di kolom `item` (MoverRow), BUKAN `nama`. Versi lama membaca
 * `nama ?? kode` — keduanya tidak ada, sehingga SELURUH bagian "Naik dan Turun" di
 * laporan tercetak "-: +Rp …" tanpa nama (tertangkap saat membaca PDF uji 30 Sep).
 */
export function moverDariHasil(r: Record<string, unknown>): BarisMover {
  const nama = [r.item, r.nama, r.kodeItem, r.kode].find((v) => typeof v === 'string' && v.trim())
  return {
    nama: typeof nama === 'string' ? nama.trim() : '(tanpa nama)',
    selisih: Number(r.selisih ?? 0),
    persen: r.persen === null || r.persen === undefined ? null : Number(r.persen),
    status: typeof r.status === 'string' ? r.status : undefined
  }
}

export interface BarisPelangganBerhenti {
  nama: string
  bulanAktif: number
  hariDiam: number
  nettTotal: number
}

export interface DataLaporan {
  judul: string
  periodeLabel: string
  periodeRentang: string
  pembandingLabel: string
  pembandingRentang: string
  dibuatPada: string
  basisKey: string
  catatanBasis: string
  catatanCakupan: string
  catatanPengakuan: string
  catatanPerbandingan?: string
  kini: {
    nett: number
    gross: number
    diskon: number
    jumlahOrder: number
    barisItem: number
    jumlahInvoice: number
    pelanggan: number
    jenisItem: number
  }
  lalu: { nett: number; jumlahOrder: number; pelanggan: number }
  ytd?: {
    label: string
    nett: number
    nettPembanding: number
    labelPembanding: string
    growthPersen: number | null
    peringatan?: string
  }
  perSource: BarisRingkas[]
  topItem: BarisRingkas[]
  topPelanggan: BarisRingkas[]
  perProvinsi: BarisRingkas[]
  itemNaik: BarisMover[]
  itemTurun: BarisMover[]
  pelangganBerhenti: BarisPelangganBerhenti[]
  jumlahPelangganBerhenti: number
  nilaiPelangganBerhenti: number
}

const BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
]

function akhirBulan(tahun: number, bulan: number): number {
  return new Date(Date.UTC(tahun, bulan, 0)).getUTCDate()
}

/**
 * Label periode yang bermakna di dokumen cetak.
 *
 * Nama periode mentah ("bulan ini", "18 hari sebelumnya") tidak boleh masuk laporan:
 * dokumen yang sama dibaca bulan depan dan jadi menyesatkan. Selalu pakai tanggal.
 */
export function labelPeriode(from: string, to: string): string {
  const [ty, tm, td] = from.split('-').map(Number)
  const [uy, um, ud] = to.split('-').map(Number)
  if (!ty || !uy) return `${from} s/d ${to}`
  if (ty === uy && tm === um) {
    const sebulanPenuh = td === 1 && ud === akhirBulan(ty, tm)
    return sebulanPenuh
      ? `${BULAN[tm - 1]} ${ty}`
      : `${td}–${ud} ${BULAN[tm - 1]} ${ty}`
  }
  const kiri = ty === uy ? `${td} ${BULAN[tm - 1]}` : `${td} ${BULAN[tm - 1]} ${ty}`
  return `${kiri} – ${ud} ${BULAN[um - 1]} ${uy}`
}

/** Rp dengan pemisah ribuan gaya Indonesia. Tidak ada desimal — ini laporan, bukan nota. */
export function rupiah(n: number): string {
  const bulat = Math.round(Number(n) || 0)
  const tanda = bulat < 0 ? '-' : ''
  return `${tanda}Rp ${Math.abs(bulat).toLocaleString('id-ID')}`
}

export function angka(n: number): string {
  return Math.round(Number(n) || 0).toLocaleString('id-ID')
}

/**
 * Persentase perubahan. `null` bila pembandingnya nol — jangan pernah menulis "0%"
 * atau "naik tak hingga" untuk sesuatu yang tidak terdefinisi.
 */
export function persenUbah(kini: number, lalu: number): number | null {
  if (!Number.isFinite(lalu) || lalu === 0) return null
  return Math.round(((kini - lalu) / lalu) * 1000) / 10
}

function arah(selisih: number): string {
  return selisih > 0 ? 'naik' : selisih < 0 ? 'turun' : 'sama'
}

/**
 * Persentase gaya Indonesia: koma sebagai pemisah desimal. Dokumen ini memakai titik
 * sebagai pemisah ribuan pada rupiah, jadi desimal bertitik akan terbaca rancu.
 */
export function persenTeks(p: number | null | undefined, pakaiTanda = false): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return 'tidak terdefinisi'
  const tanda = pakaiTanda && p > 0 ? '+' : ''
  return `${tanda}${p.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`
}

function barisPersen(p: number | null): string {
  return p === null ? 'tidak terdefinisi (pembanding nol)' : persenTeks(p, true)
}

function daftar(
  blocks: BlokDokumen[],
  judul: string,
  baris: BarisRingkas[],
  kosong: string
): void {
  blocks.push({ type: 'h2', text: judul })
  if (baris.length === 0) {
    blocks.push({ type: 'p', text: kosong })
    return
  }
  baris.forEach((b, i) => {
    const bagian = b.persen === null || b.persen === undefined ? '' : ` — ${persenTeks(b.persen)} dari total`
    const order = b.jumlahOrder === undefined ? '' : ` · ${angka(b.jumlahOrder)} order`
    blocks.push({ type: 'bullet', text: `${i + 1}. ${b.kategori}: ${rupiah(b.nett)}${bagian}${order}` })
  })
}

/**
 * Menyusun seluruh isi dokumen. Urutannya mengikuti laporan manajemen pada umumnya:
 * ringkasan dulu (yang dibaca direktur), rincian menyusul (yang dibaca manager),
 * metodologi paling belakang (yang dibaca saat angkanya dipertanyakan).
 */
export function susunLaporan(d: DataLaporan): BlokDokumen[] {
  const b: BlokDokumen[] = []
  const selisihNett = d.kini.nett - d.lalu.nett
  const pNett = persenUbah(d.kini.nett, d.lalu.nett)
  const pOrder = persenUbah(d.kini.jumlahOrder, d.lalu.jumlahOrder)
  const rateDiskon = d.kini.gross > 0 ? Math.round((d.kini.diskon / d.kini.gross) * 1000) / 10 : null

  b.push({ type: 'h1', text: d.judul })
  b.push({ type: 'p', text: `Periode: ${d.periodeLabel} (${d.periodeRentang})` })
  b.push({ type: 'p', text: `Dibuat: ${d.dibuatPada} · Sumber: database penjualan the lab` })

  // 1. Ringkasan eksekutif
  b.push({ type: 'h2', text: 'Ringkasan Eksekutif' })

  // ⚠️ Periode TANPA transaksi tidak boleh disajikan sebagai "turun 100%".
  //
  // Terlihat pada laporan sungguhan 21 Agu 2026: laporan "hari ini" dibuat pukul
  // 00.25, saat belum ada satu pun transaksi tercatat. Angkanya benar (Rp 0),
  // tapi kalimatnya berbunyi "penjualan turun Rp 333.969.650 atau -100%" —
  // terbaca sebagai kejatuhan bisnis, padahal artinya harinya memang baru mulai.
  // Yang salah bukan angkanya melainkan bingkainya, dan bingkai yang salah di
  // ringkasan eksekutif adalah persis jenis kesalahan yang sampai ke direksi.
  if (d.kini.nett === 0 && d.kini.jumlahOrder === 0) {
    b.push({
      type: 'p',
      text:
        `Belum ada transaksi tercatat pada ${d.periodeLabel}. Ini bukan penurunan penjualan: ` +
        'periodenya memang belum terisi — bisa karena harinya baru berjalan, hasil pemeriksaan ' +
        'belum keluar, atau invoice belum diterbitkan. Angka pembanding tetap ditampilkan di ' +
        'bawah sebagai rujukan.'
    })
    b.push({
      type: 'p',
      text: `Sebagai pembanding, ${d.pembandingLabel} tercatat ${rupiah(d.lalu.nett)} dari ${angka(d.lalu.jumlahOrder)} order.`
    })
  } else {
    b.push({
      type: 'p',
      text:
        `Penjualan nett ${d.periodeLabel} tercatat ${rupiah(d.kini.nett)} dari ` +
        `${angka(d.kini.jumlahOrder)} order dan ${angka(d.kini.pelanggan)} pelanggan aktif. ` +
        `Dibanding ${d.pembandingLabel} (${rupiah(d.lalu.nett)}), penjualan ${arah(selisihNett)} ` +
        `${rupiah(Math.abs(selisihNett))} atau ${barisPersen(pNett)}.`
    })
  }
  if (d.ytd) {
    b.push({
      type: 'p',
      text:
        `Secara year-to-date, ${d.ytd.label} mencatat ${rupiah(d.ytd.nett)} dibanding ` +
        `${d.ytd.labelPembanding} sebesar ${rupiah(d.ytd.nettPembanding)} — ` +
        `pertumbuhan ${barisPersen(d.ytd.growthPersen)}.`
    })
    if (d.ytd.peringatan) b.push({ type: 'p', text: `Catatan: ${d.ytd.peringatan}` })
  }
  if (d.jumlahPelangganBerhenti > 0) {
    b.push({
      type: 'p',
      text:
        `Perlu perhatian: ${angka(d.jumlahPelangganBerhenti)} pelanggan institusi yang sebelumnya ` +
        `rutin kini berhenti order, dengan nilai ${rupiah(d.nilaiPelangganBerhenti)} dalam 12 bulan terakhir.`
    })
  }

  // 2. Kinerja periode
  b.push({ type: 'h2', text: 'Kinerja Periode' })
  b.push({ type: 'bullet', text: `Penjualan nett: ${rupiah(d.kini.nett)}` })
  b.push({ type: 'bullet', text: `Penjualan gross: ${rupiah(d.kini.gross)}` })
  b.push({
    type: 'bullet',
    text: `Diskon: ${rupiah(d.kini.diskon)}${rateDiskon === null ? '' : ` (${persenTeks(rateDiskon)} dari gross)`}`
  })
  b.push({ type: 'bullet', text: `Jumlah order: ${angka(d.kini.jumlahOrder)}` })
  b.push({ type: 'bullet', text: `Baris pemeriksaan: ${angka(d.kini.barisItem)}` })
  b.push({ type: 'bullet', text: `Jumlah invoice: ${angka(d.kini.jumlahInvoice)}` })
  b.push({ type: 'bullet', text: `Pelanggan aktif: ${angka(d.kini.pelanggan)}` })
  b.push({ type: 'bullet', text: `Jenis pemeriksaan terjual: ${angka(d.kini.jenisItem)}` })

  // 3. Perbandingan
  b.push({ type: 'h2', text: `Perbandingan dengan ${d.pembandingLabel}` })
  // Pada periode yang belum terisi, persentase penurunan SELALU -100% dan tidak
  // memberi tahu apa pun — ia hanya terbaca sebagai kejatuhan. Nilai mentahnya
  // tetap ditampilkan; yang diganti hanya bingkainya.
  // ⚠️ Hanya berlaku bila pembandingnya PUNYA isi. Kalau dua-duanya nol,
  // persentasenya memang tidak terdefinisi dan itulah yang harus dikatakan —
  // "periode belum terisi" akan menyembunyikan fakta bahwa pembandingnya pun
  // kosong. Tertangkap test lama yang menjaga agar pembanding nol tidak pernah
  // disajikan sebagai "0%".
  const kosong = d.kini.nett === 0 && d.kini.jumlahOrder === 0 && d.lalu.nett > 0
  const KETERANGAN_KOSONG = 'periode belum terisi'
  b.push({
    type: 'bullet',
    text: `Nett: ${rupiah(d.lalu.nett)} → ${rupiah(d.kini.nett)} (${kosong ? KETERANGAN_KOSONG : barisPersen(pNett)})`
  })
  b.push({
    type: 'bullet',
    text: `Order: ${angka(d.lalu.jumlahOrder)} → ${angka(d.kini.jumlahOrder)} (${kosong ? KETERANGAN_KOSONG : barisPersen(pOrder)})`
  })
  b.push({
    type: 'bullet',
    text: `Pelanggan aktif: ${angka(d.lalu.pelanggan)} → ${angka(d.kini.pelanggan)}`
  })
  b.push({ type: 'p', text: `Rentang pembanding: ${d.pembandingRentang}` })
  if (d.catatanPerbandingan) b.push({ type: 'p', text: d.catatanPerbandingan })

  // 4-7. Rincian
  daftar(b, 'Kontribusi per Kategori Layanan', d.perSource, 'Tidak ada transaksi pada periode ini.')
  daftar(b, 'Pemeriksaan Terbesar', d.topItem, 'Tidak ada transaksi pada periode ini.')
  daftar(b, 'Pelanggan Terbesar', d.topPelanggan, 'Tidak ada transaksi pada periode ini.')
  daftar(b, 'Sebaran Wilayah (Provinsi Pelanggan)', d.perProvinsi, 'Tidak ada transaksi pada periode ini.')

  // 8. Movers
  b.push({ type: 'h2', text: 'Pemeriksaan yang Naik dan Turun' })
  if (d.itemNaik.length === 0 && d.itemTurun.length === 0) {
    b.push({ type: 'p', text: 'Tidak ada perubahan yang menonjol dibanding periode pembanding.' })
  } else {
    b.push({ type: 'h3', text: 'Naik' })
    if (d.itemNaik.length === 0) b.push({ type: 'p', text: 'Tidak ada.' })
    for (const m of d.itemNaik) {
      b.push({
        type: 'bullet',
        text: `${m.nama}: +${rupiah(m.selisih)}${m.persen === null || m.persen === undefined ? ` (${m.status ?? 'baru'})` : ` (${persenTeks(m.persen, true)})`}`
      })
    }
    b.push({ type: 'h3', text: 'Turun' })
    if (d.itemTurun.length === 0) b.push({ type: 'p', text: 'Tidak ada.' })
    for (const m of d.itemTurun) {
      b.push({
        type: 'bullet',
        text: `${m.nama}: ${rupiah(m.selisih)}${m.persen === null || m.persen === undefined ? ` (${m.status ?? 'berhenti'})` : ` (${persenTeks(m.persen)})`}`
      })
    }
  }

  // 9. Pelanggan berhenti
  b.push({ type: 'h2', text: 'Pelanggan yang Berhenti Order' })
  if (d.pelangganBerhenti.length === 0) {
    b.push({ type: 'p', text: 'Tidak ada pelanggan institusi rutin yang berhenti order.' })
  } else {
    b.push({
      type: 'p',
      text:
        `${angka(d.jumlahPelangganBerhenti)} pelanggan institusi yang sebelumnya rutin kini tidak lagi ` +
        `order, dengan nilai ${rupiah(d.nilaiPelangganBerhenti)} dalam 12 bulan terakhir. ` +
        'Akun pasien pribadi tidak termasuk karena bukan instansi yang dapat ditindaklanjuti tim sales.'
    })
    for (const p of d.pelangganBerhenti) {
      b.push({
        type: 'bullet',
        text:
          `${p.nama} — aktif ${angka(p.bulanAktif)} bulan, terakhir order ${angka(p.hariDiam)} hari lalu, ` +
          `nilai 12 bulan ${rupiah(p.nettTotal)}`
      })
    }
  }

  // 10. Metodologi — paling belakang, dibaca saat angkanya dipertanyakan
  b.push({ type: 'h2', text: 'Catatan Metodologi' })
  b.push({ type: 'bullet', text: `Dasar pengakuan: ${d.catatanBasis}` })
  b.push({ type: 'bullet', text: `Cakupan data: ${d.catatanCakupan}` })
  b.push({ type: 'bullet', text: d.catatanPengakuan })
  b.push({
    type: 'bullet',
    text:
      'Jumlah order dihitung dari nomor order unik, berbeda dari jumlah baris pemeriksaan ' +
      '(satu order dapat memuat beberapa pemeriksaan).'
  })
  b.push({
    type: 'bullet',
    text: 'Wilayah mengacu pada lokasi instansi pelanggan menurut master pelanggan, bukan domisili pasien.'
  })
  b.push({
    type: 'bullet',
    text:
      'Peringkat pelanggan memakai nama sebagaimana tertulis pada transaksi. Penulisan nama di ' +
      'sumber data belum seragam, sehingga satu pelanggan dapat muncul dalam lebih dari satu ejaan ' +
      'dan peringkatnya menjadi lebih rendah dari semestinya.'
  })
  b.push({ type: 'p', text: `Laporan ini dihasilkan otomatis oleh AIRA pada ${d.dibuatPada}.` })

  return b
}

/**
 * Blok laporan -> Markdown, untuk keluaran PDF.
 *
 * ⚠️ Sengaja memakai SUSUNAN BLOK YANG SAMA dengan versi Word, bukan menyusun
 * ulang isinya untuk PDF. Kalau keduanya disusun terpisah, laporan Word dan PDF
 * untuk periode yang sama bisa berbeda isi — dan yang menemukan pertama kali
 * adalah orang di rapat yang memegang dua salinan berbeda. Tiga cacat isi
 * laporan 18 Agu 2026 baru ketahuan dengan MEMBUKA dokumennya; menggandakan
 * jalur penyusunan berarti menggandakan tempat cacat seperti itu bisa muncul.
 */
export function blokKeMarkdown(blocks: readonly BlokDokumen[]): string {
  const baris: string[] = []
  for (const b of blocks) {
    if (b.type === 'h1') baris.push('', `# ${b.text}`, '')
    else if (b.type === 'h2') baris.push('', `## ${b.text}`, '')
    else if (b.type === 'h3') baris.push('', `### ${b.text}`, '')
    else if (b.type === 'bullet') baris.push(`- ${b.text}`)
    else baris.push('', b.text)
  }
  return baris.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

// --------------------------------------------------------------- versi Excel

export interface SheetLaporan {
  name: string
  rows: Array<Array<string | number | null>>
}

/**
 * Laporan penjualan sebagai lembar kerja, bukan prosa.
 *
 * ⚠️ Sumber angkanya `DataLaporan` yang SAMA dengan versi Word dan PDF. Tiga
 * keluaran, satu perhitungan — kalau masing-masing menghitung sendiri, tiga
 * berkas untuk periode yang sama bisa berbeda isi dan yang menemukannya adalah
 * orang di rapat yang memegang dua di antaranya.
 *
 * Bentuknya sengaja BERBEDA dari Word/PDF: Excel dipakai untuk dihitung ulang
 * dan disaring, bukan dibaca sebagai narasi. Jadi tiap bagian jadi satu sheet
 * bertabel, angkanya ditulis sebagai ANGKA (bukan "Rp 1.234.567" berupa teks)
 * supaya penerimanya bisa langsung menjumlahkan — dan pemformatan rupiah
 * diserahkan ke Excel lewat format sel.
 */
export function susunLaporanExcel(d: DataLaporan): SheetLaporan[] {
  const sheets: SheetLaporan[] = []
  const pUbah = (kini: number, lalu: number): number | null =>
    lalu > 0 ? Math.round(((kini - lalu) / lalu) * 1000) / 10 : null

  // 1. Ringkasan — bentuk "label | nilai" supaya terbaca tanpa perlu digeser.
  const ringkas: Array<Array<string | number | null>> = [
    ['Keterangan', 'Nilai'],
    ['Judul', d.judul],
    ['Periode', d.periodeLabel],
    ['Rentang', d.periodeRentang],
    ['Pembanding', `${d.pembandingLabel} (${d.pembandingRentang})`],
    ['Basis', d.basisKey],
    ['Dibuat', d.dibuatPada],
    ['Nett', d.kini.nett],
    ['Gross', d.kini.gross],
    ['Diskon', d.kini.diskon],
    ['Diskon (%)', d.kini.gross > 0 ? Math.round((d.kini.diskon / d.kini.gross) * 1000) / 10 : null],
    ['Jumlah order', d.kini.jumlahOrder],
    ['Baris pemeriksaan', d.kini.barisItem],
    ['Jumlah invoice', d.kini.jumlahInvoice],
    ['Pelanggan', d.kini.pelanggan],
    ['Jenis item', d.kini.jenisItem],
    ['Nett periode pembanding', d.lalu.nett],
    ['Perubahan nett (%)', pUbah(d.kini.nett, d.lalu.nett)],
    ['Order periode pembanding', d.lalu.jumlahOrder],
    ['Perubahan order (%)', pUbah(d.kini.jumlahOrder, d.lalu.jumlahOrder)]
  ]
  if (d.ytd) {
    ringkas.push(
      [`YTD ${d.ytd.label}`, d.ytd.nett],
      [`YTD ${d.ytd.labelPembanding}`, d.ytd.nettPembanding],
      ['Pertumbuhan YTD (%)', d.ytd.growthPersen]
    )
  }
  sheets.push({ name: 'Ringkasan', rows: ringkas })

  const dariRingkas = (
    nama: string,
    baris: BarisRingkas[],
    labelKategori: string
  ): void => {
    if (baris.length === 0) return
    sheets.push({
      name: nama,
      rows: [
        [labelKategori, 'Nett', 'Kontribusi (%)', 'Jumlah order'],
        ...baris.map((b) => [b.kategori, b.nett, b.persen ?? null, b.jumlahOrder ?? null])
      ]
    })
  }

  dariRingkas('Kategori Layanan', d.perSource, 'Kategori')
  dariRingkas('Pemeriksaan Terbesar', d.topItem, 'Pemeriksaan')
  dariRingkas('Pelanggan Terbesar', d.topPelanggan, 'Pelanggan')
  dariRingkas('Sebaran Wilayah', d.perProvinsi, 'Provinsi')

  const gerak = [...d.itemNaik, ...d.itemTurun]
  if (gerak.length > 0) {
    sheets.push({
      name: 'Naik-Turun',
      rows: [
        ['Pemeriksaan', 'Selisih nett', 'Perubahan (%)', 'Status'],
        ...gerak.map((m) => [m.nama, m.selisih, m.persen ?? null, m.status ?? ''])
      ]
    })
  }

  if (d.pelangganBerhenti.length > 0) {
    sheets.push({
      name: 'Pelanggan Berhenti',
      rows: [
        ['Pelanggan', 'Bulan aktif', 'Hari diam', 'Nett selama diamati'],
        ...d.pelangganBerhenti.map((p) => [p.nama, p.bulanAktif, p.hariDiam, p.nettTotal])
      ]
    })
  }

  // Metodologi ikut sebagai sheet tersendiri — bukan pelengkap. Angka laporan
  // sering dipertanyakan berbulan-bulan kemudian, dan berkas Excel biasanya
  // beredar terlepas dari dokumen naratifnya.
  sheets.push({
    name: 'Metodologi',
    rows: [
      ['Catatan'],
      [d.catatanBasis],
      [d.catatanPengakuan],
      [d.catatanCakupan],
      ...(d.catatanPerbandingan ? [[d.catatanPerbandingan]] : []),
      [
        'Peringkat pelanggan memakai nama sebagaimana tertulis pada transaksi. Penulisan nama di ' +
          'sumber data belum seragam, sehingga satu pelanggan dapat muncul dalam lebih dari satu ejaan.'
      ],
      [`Laporan ini dihasilkan otomatis oleh AIRA pada ${d.dibuatPada}.`]
    ]
  })

  return sheets
}
