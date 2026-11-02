import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { TOOL_BERVISUAL, labelDeret, visualDariHasil } from '../src/main/visual/sales'

const J = (o: unknown): string => JSON.stringify(o)

describe('kartu visual: aman terhadap hasil apa pun', () => {
  test('hasil galat, JSON rusak, tool tanpa kartu -> null (tidak melempar)', () => {
    assert.equal(visualDariHasil('sales_summary', J({ error: 'db mati' })), null)
    assert.equal(visualDariHasil('sales_summary', '{rusak'), null)
    assert.equal(visualDariHasil('sales_report', J({ laporanDibuat: 'x.pdf' })), null)
    assert.equal(visualDariHasil('read_file', J({ isi: 'x' })), null)
  })

  test('semua tool sales data (kecuali laporan berkas) punya kartu', () => {
    for (const t of ['sales_summary', 'sales_compare', 'sales_breakdown', 'sales_trend', 'sales_movers', 'sales_ytd', 'sales_customers', 'sales_projection', 'sales_forecast']) {
      assert.ok(TOOL_BERVISUAL.includes(t), t)
    }
    assert.ok(!TOOL_BERVISUAL.includes('sales_report'))
  })
})

describe('kartu visual: angka SAMA dengan hasil tool', () => {
  test('summary -> KPI nett/order/pelanggan persis dari hasil', () => {
    const k = visualDariHasil('sales_summary', J({ periode: 'hari ini', rentang: '2026-09-29 s/d 2026-09-29', basis: 'invoice', nett: 123456789, gross: 150000000, diskon: 26543211, jumlahOrder: 88, barisItem: 120, jumlahInvoice: 80, pelanggan: 40, jenis_item: 55 }))!
    assert.equal(k.judul, 'Sales Summary')
    const kpi = k.panel[0]
    assert.ok(kpi.jenis === 'kpi')
    assert.deepEqual(kpi.item.map((i) => i.nilai), [123456789, 88, 40, 55])
    assert.match(k.sub!, /Today \(2026-09-29 to 2026-09-29\) · basis: invoice/)
  })

  test('breakdown -> batang & tabel memakai persen kontribusi dari tool (tidak dihitung ulang)', () => {
    const k = visualDariHasil('sales_breakdown', J({ periode: 'bulan ini', dimensi: 'provinsi pelanggan', urutan: 'terbesar ke bawah', totalNettPeriode: 1000, persenTercakupDaftarIni: 90.5, baris: [{ kategori: 'DKI JAKARTA', jumlahOrder: 5, nett: 600, persen: 60 }, { kategori: '(pelanggan tidak ada di master)', jumlahOrder: 2, nett: 305, persen: 30.5 }] }))!
    const batang = k.panel[0]
    assert.ok(batang.jenis === 'batang')
    assert.deepEqual(batang.baris.map((b) => [b.label, b.nilai, b.catatan]), [['DKI JAKARTA', 600, '60%'], ['(pelanggan tidak ada di master)', 305, '30.5%']])
    assert.ok(k.catatan.some((c) => /90\.5% of the period's total nett/.test(c)))
    assert.ok(k.catatan.some((c) => /not registered in the master data/.test(c)))
  })

  test('compare -> pertumbuhan dari persenPerubahan tool; pembanding dipotong disebut', () => {
    const k = visualDariHasil('sales_compare', J({ basis: 'invoice', periodeUtama: { label: 'bulan ini', rentang: 'a', nett: 110, gross: 120, diskon: 10, jumlahOrder: 11, pelanggan: 5, jenis_item: 3 }, periodePembanding: { label: 'bulan lalu (29 hari pertama, disamakan)', rentang: 'b', nett: 100, gross: 110, diskon: 10, jumlahOrder: 10, pelanggan: 5, jenis_item: 3 }, selisihNett: 10, persenPerubahan: 10, catatanPerbandingan: 'x' }))!
    const kpi = k.panel[0]
    assert.ok(kpi.jenis === 'kpi')
    assert.equal(kpi.item[3].nilai, 10)
    assert.equal(kpi.item[1].label, 'Last month')
    assert.ok(k.catatan[0].includes('trimmed'))
  })

  test('forecast -> deret bertanda perkiraan dengan rentang bawah/atas', () => {
    const k = visualDariHasil('sales_forecast', J({ basis: 'invoice', riwayatBulan: 24, bulanTerakhirLengkap: '2026-08', nettBulanTerakhir: 9e9, akurasiHistorisPersen: 6.9, ramalan: [{ bulan: '2026-10', nett: 9.5e9, rentangBawah: 8.8e9, rentangAtas: 10.2e9 }] }))!
    const d = k.panel[1]
    assert.ok(d.jenis === 'deret')
    assert.deepEqual(d.titik[0], { label: 'Oct 2026', nilai: 9.5e9, bawah: 8.8e9, atas: 10.2e9, perkiraan: true })
    assert.ok(k.catatan.some((c) => /estimate/.test(c)))
  })

  test('projection selalu diberi label PERKIRAAN', () => {
    const k = visualDariHasil('sales_projection', J({ bulanBerjalan: '2026-09', sampaiTanggal: '2026-09-29', hariKe: 29, hariDalamBulan: 30, basis: 'invoice', nettSejauhIni: 7e9, jumlahOrderSejauhIni: 6000, proyeksiNettTutupBulan: 7.6e9, dasarProyeksi: 'kurva historis', harapanMenurutTren: 9e9, selisihTerhadapTrenPersen: -15.5 }))!
    const kpi = k.panel[0]
    assert.ok(kpi.jenis === 'kpi')
    assert.equal(kpi.item[1].catatan, 'ESTIMATE')
    assert.equal(kpi.item[3].arah, 'turun')
  })

  test('customers melemah: persen turun ditampilkan negatif berpanah turun', () => {
    const k = visualDariHasil('sales_customers', J({ status: 'melemah', segmen: 'institusi', kriteria: 'masih order', jumlahPelanggan: 3, totalNettPengamatan: 500, baris: [{ nama: 'RS A', nettTerkini: 50, nettSebelum: 100, persenTurun: 50 }] }))!
    const tabel = k.panel[1]
    assert.ok(tabel.jenis === 'tabel')
    assert.deepEqual(tabel.baris[0][3], { nilai: -50, satuan: 'persen', arah: 'turun' })
    assert.ok(k.catatan.some((c) => /Pasien Pribadi/.test(c)))
  })

  test('label deret per granularitas', () => {
    assert.equal(labelDeret('2026-09-17', 'day'), '17 Sep')
    assert.equal(labelDeret('2026-09-01', 'month'), 'Sep 2026')
    assert.equal(labelDeret('2026-09-14', 'week'), 'wk 14 Sep')
  })
})

describe('kartu visual: pengaman struktural', () => {
  test('penerjemah MURNI — tidak mengimpor database / tool', () => {
    const src = readFileSync('src/main/visual/sales.ts', 'utf8')
    assert.ok(!/salesQuery|getTool|from '\.\.\/db'|registry/.test(src))
  })
  test('kartu dikumpulkan dari hasil tool yang SUKSES di finish(), dibatasi per jawaban', () => {
    const src = readFileSync('src/main/agent/orchestrator.ts', 'utf8')
    assert.match(src, /if \(status === 'ok'\) \{\s*\/\/ Kartu visual/)
    assert.match(src, /\.slice\(0, MAKS_KARTU\)/)
  })
})

// ------------------------------------------------------------ TAT Sample
describe('kartu visual: TAT Sample (lab)', () => {
  const segar = 'Data berasal dari tabel hasil ETL, terakhir diperbarui 2026-09-29 06:00. Sebutkan waktu itu bila user menanyakan kesegaran data; jangan menyebutnya real-time.'

  test('semua tool lab punya kartu', () => {
    for (const t of ['lab_backlog', 'lab_lacak', 'lab_rns', 'lab_tat']) assert.ok(TOOL_BERVISUAL.includes(t), t)
  })

  test('backlog: KPI order/baris, per status, kesegaran ETL disebut; tidak ada kolom pasien', () => {
    const k = visualDariHasil('lab_backlog', J({ totalBaris: 12, totalOrder: 10, perStatus: [{ sample_status: 'Lab Received', baris: 8, order: 7, umur_median: 2.5, umur_tertua: 9 }], daftarTerlama: [{ order_id: 'K1', test: 'HPV', category: 'MB', account: 'RS A', sample_status: 'Lab Received', is_rns: true, umur_hari: 9 }], catatanKesegaran: segar }))!
    assert.match(k.sub!, /updated 2026-09-29 06:00/)
    const kpi = k.panel[0]
    assert.ok(kpi.jenis === 'kpi')
    assert.deepEqual(kpi.item.map((i) => i.nilai), [10, 12, 1, 9])
    assert.ok(!JSON.stringify(k).toLowerCase().includes('patient'))
  })

  test('tat: median pecahan TIDAK dibulatkan; baris yang tak terhitung disebut bukan nol', () => {
    const k = visualDariHasil('lab_tat', J({ tahap: 'total', tahapLabel: 'Total', dikelompokkanPer: 'category', baris: [{ kelompok: 'Histologi', n: 50, median: 2.5, p90: 6, terlama: 14 }], catatanCakupan: '50 baris ikut dihitung untuk tahap ini; 7 baris TIDAK bisa dihitung karena …', catatanTahap: 'Tahap "Total" hanya dihitung dalam HARI KALENDER karena …', catatanKesegaran: segar }))!
    const b = k.panel[0]
    assert.ok(b.jenis === 'batang')
    assert.equal(b.baris[0].nilai, 2.5)
    assert.ok(k.catatan.some((c) => /7 lines could not be calculated.*NOT zero/.test(c)))
    assert.ok(!k.catatan.some((c) => /Jangan menyajikannya/.test(c)), 'instruksi untuk model tidak boleh tampil ke user')
  })

  test('rns: "masih menunggu" ditonjolkan; dua peringkat terpisah', () => {
    const k = visualDariHasil('lab_rns', J({ ringkasan: { total: 75, penggantiDatang: 40, masihMenunggu: 11, hasilKeluarTanpaPengganti: 24, batal: 0, tungguMedianHari: 3, tungguP90Hari: 8 }, peringkatPerJumlah: [{ test: 'EGFR', rns: 75, total: 400, persen: 18.8 }], peringkatPerPersen: [{ test: 'MammaPrint', rns: 7, total: 40, persen: 17.5 }], catatanKesegaran: segar }))!
    const kpi = k.panel[0]
    assert.ok(kpi.jenis === 'kpi')
    assert.equal(kpi.item[2].nilai, 11)
    assert.equal(k.panel[1].jenis, 'batang')
    assert.equal(k.panel[2].jenis, 'tabel')
  })

  test('lacak: tidak ditemukan -> kartu jujur, bukan kosong', () => {
    const k = visualDariHasil('lab_lacak', J({ ditemukan: false, order_id: 'X9', catatanKesegaran: segar }))!
    assert.ok(k.catatan.some((c) => /Anatomical Pathology from January 2026/.test(c)))
  })
})

describe('kartu visual: Master Data (30 Sep 2026)', () => {
  const kolom = (k: ReturnType<typeof visualDariHasil>, i: number): string[] => {
    const p = k!.panel[i]
    assert.ok(p.jenis === 'tabel')
    return p.kolom.map((c) => c.label)
  }

  test('ketujuh tool Master Data punya kartu', () => {
    for (const t of ['inno_customer_search', 'inno_item_search', 'inno_special_price', 'inno_item_special_price', 'inno_pks', 'inno_clinician_search', 'inno_item_package']) {
      assert.ok(TOOL_BERVISUAL.includes(t), t)
    }
  })

  test('item: harga HANYA K1/K2, angka persis dari tool, harga kosong bukan nol', () => {
    const k = visualDariHasil('inno_item_search', J({
      pencarian: 'hpv',
      saringan: { jenis: null, lab: 'Patologi Anatomi', kelompokHarga: null, grup: null },
      item: [
        { kode: 'A1', nama: 'HPV DNA', jenis: 'Single', lab: 'Patologi Anatomi', grup: null, hargaB2B: 850000, hargaB2C: 1000000, tatRutinJam: '72', isiPaketBisaDilihat: false },
        { kode: 'A2', nama: 'HPV Genotyping', jenis: 'Single', lab: 'Patologi Anatomi', grup: null, hargaB2B: 1200000, hargaB2C: null, tatRutinJam: null, isiPaketBisaDilihat: false },
        { kode: 'A3', nama: 'HPV Baru', jenis: 'Single', lab: 'Patologi Anatomi', grup: null, hargaB2B: null, hargaB2C: null, tatRutinJam: null, isiPaketBisaDilihat: false }
      ],
      adaLagi: false
    }))!
    assert.match(k.sub!, /lab: Anatomical Pathology/)
    const batang = k.panel[2]
    assert.ok(batang.jenis === 'batang')
    assert.deepEqual(batang.baris.map((b) => b.nilai), [850000, 1200000])
    const tabel = kolom(k, 1).join('|')
    // Lab sama di semua baris -> kolomnya dibuang, disebut sekali di subjudul (tabel muat lebar).
    assert.doesNotMatch(tabel, /\|Lab\|/)
    assert.match(tabel, /B2B \(K1\)\|B2C \(K2\)/)
    assert.doesNotMatch(tabel, /BPJS|K3/)
    assert.ok(k.catatan.some((c) => /1 item has no regular price.*not zero/.test(c)))
  })

  test('special price: diskon dari tool TANPA arah (bukan kenaikan), masa berlaku apa adanya', () => {
    const k = visualDariHasil('inno_special_price', J({
      pelanggan: { kode: 'C1', nama: 'RSUP Dr. Kariadi' },
      tanggalAcuan: '2026-09-30',
      jumlahItemPunyaHargaKhusus: 40,
      jumlahAktifHariIni: 30,
      ditampilkan: 25,
      hargaKhusus: [{ item: 'HbA1c', kategoriHarga: 'Special Price', hargaReguler: 200000, hargaKhusus: 150000, diskonPersen: 25, status: 'aktif', masaBerlaku: 'no end date' }]
    }))!
    assert.equal(k.judul, 'Special Price — RSUP Dr. Kariadi')
    const kpi = k.panel[0]
    assert.ok(kpi.jenis === 'kpi')
    assert.deepEqual(kpi.item.map((i) => i.nilai), [40, 30, 25])
    const t = k.panel[1]
    assert.ok(t.jenis === 'tabel')
    assert.deepEqual(t.baris[0][4], { nilai: 25, satuan: 'persen' })
    assert.equal(t.baris[0][5], 'no end date')
    assert.ok(k.catatan.some((c) => /1 of 30/.test(c)))
  })

  test('item special price: terendah = baris pertama dari tool (tidak diurutkan ulang)', () => {
    const k = visualDariHasil('inno_item_special_price', J({
      item: { kode: 'X', nama: 'MammaPrint' },
      jumlahPelangganAktif: 2,
      pelanggan: [
        { pelanggan: 'RS A', tipe: 'RS', kategoriHarga: 'Special Price', hargaReguler: 30000000, hargaKhusus: 25000000, masaBerlaku: '-' },
        { pelanggan: '(tidak ada di master pelanggan aktif)', tipe: null, kategoriHarga: 'Special Price', hargaReguler: 30000000, hargaKhusus: 27000000, masaBerlaku: '-' }
      ]
    }))!
    const kpi = k.panel[0]
    assert.ok(kpi.jenis === 'kpi')
    assert.deepEqual(kpi.item.map((i) => i.nilai), [2, 25000000, 27000000])
    assert.ok(k.catatan.some((c) => /not in the active customer master/.test(c)))
  })

  test('PKS kosong: dikatakan, tanpa tabel kosong', () => {
    const k = visualDariHasil('inno_pks', J({ pelanggan: { kode: 'C9', nama: 'RSUD X' }, adaPKS: false, jumlah: 0, pks: [] }))!
    assert.equal(k.panel.length, 1)
    assert.ok(k.catatan.some((c) => /No PKS with approved status/.test(c)))
  })

  test('dokter: tidak ada kolom email/telepon', () => {
    const k = visualDariHasil('inno_clinician_search', J({ pencarian: 'citra', dokter: [{ kode: 'D1', nama: 'dr. Citra', patologis: true, kodeSpesialisasi: 'SpPA' }] }))!
    assert.doesNotMatch(kolom(k, 1).join('|'), /email|telepon|phone/i)
  })

  test('isi paket: jumlah dari tool, sebagian tampil disebut, kandidat ganda jadi tabel pilihan', () => {
    const k = visualDariHasil('inno_item_package', J({ ditemukan: true, paket: { kode: 'P1', nama: 'MCU A', lab: null }, jumlahIsi: 60, jumlahLab: 55, jumlahNonLab: 5, isi: [{ kode: 'c', nama: 'Hb', kategori: 'LAB', lab: 'Patologi Klinik', grup: null }] }))!
    const kpi = k.panel[0]
    assert.ok(kpi.jenis === 'kpi')
    assert.deepEqual(kpi.item.map((i) => i.nilai), [60, 55, 5])
    assert.ok(k.catatan.some((c) => /1 of 60 package contents/.test(c)))
    const pilih = visualDariHasil('inno_item_package', J({ paketDicari: 'mcu', ditemukan: false, perluDipilih: true, kandidat: [{ kode: 'P1', nama: 'MCU A' }, { kode: 'P2', nama: 'MCU B' }] }))!
    assert.match(pilih.judul, /pick one/)
    assert.equal(visualDariHasil('inno_item_package', J({ paketDicari: 'zzz', ditemukan: false })), null)
  })
})
