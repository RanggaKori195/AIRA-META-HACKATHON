// Penerjemah hasil tool MASTERDATA (master data) -> kartu visual (30 Sep 2026).
//
// ⚠️ MURNI, sama seperti `visual/sales.ts` & `visual/lab.ts`: hanya membaca JSON
// hasil tool yang SAMA dengan yang dibaca model. Tidak ada query tambahan, dan
// tidak ada angka baru yang dihitung — diskon, status berlaku, dan urutan harga
// dipakai apa adanya dari tool. Satu-satunya hitungan: MENCACAH baris yang tampil.
// ⚠️ Harga yang disajikan hanya K1 (B2B/Corporate) & K2 (B2C) — aturan 23. Kartu
// tidak menambah kolom harga lain.
// ⚠️ Email/telepon dokter tidak pernah keluar dari tool (data pribadi), jadi kartu
// pun tidak mungkin menampilkannya.

import type { KartuVisual, Sel } from '../../shared/visual'

type J = Record<string, any>

const angka = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null

const rp = (v: unknown): Sel => ({ nilai: angka(v), satuan: 'rp' })
const n = (v: unknown): Sel => ({ nilai: angka(v), satuan: 'angka' })
const teks = (v: unknown): string => (v == null || v === '' ? '—' : String(v))
const daftar = (v: unknown): J[] => (Array.isArray(v) ? (v as J[]) : [])

const SUMBER = 'Master data Master Data'
const STATUS: Record<string, string> = { aktif: 'Aktif', kadaluarsa: 'Kadaluarsa', belum_mulai: 'Belum mulai' }
const status = (v: unknown): string => STATUS[String(v)] ?? teks(v)

/** Nilai kolom yang SAMA di semua baris (mis. semua "Patologi Anatomi") — dipindah ke subjudul. */
function seragam(baris: J[], kunci: string): string | null {
  if (baris.length < 2) return null
  const v = baris[0][kunci]
  if (v == null || v === '') return null
  return baris.every((x) => x[kunci] === v) ? String(v) : null
}

/** "Ditampilkan 10 dari 37" — hanya bila memang ada sisa. */
function sisa(tampil: number, total: number | null, benda: string): string[] {
  return total !== null && total > tampil ? [`Kartu menampilkan ${tampil} dari ${total} ${benda}.`] : []
}

function pelanggan(j: J): KartuVisual | null {
  if (!Array.isArray(j.pelanggan)) return null
  const p = daftar(j.pelanggan)
  return {
    tool: 'inno_customer_search',
    judul: `Pelanggan Terdaftar — “${teks(j.pencarian)}”`,
    sub: SUMBER,
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: 'Pelanggan cocok', nilai: p.length, satuan: 'angka' },
          { label: 'Terhubung ERP', nilai: p.filter((x) => x.terhubungERP).length, satuan: 'angka' }
        ]
      },
      {
        jenis: 'tabel',
        judul: 'Kandidat',
        kolom: [{ label: 'Kode' }, { label: 'Nama' }, { label: 'Tipe' }, { label: 'ERP' }, { label: 'Termin (hari)', kanan: true }],
        baris: p.map((x) => [teks(x.kode), teks(x.nama), teks(x.tipe), x.terhubungERP ? 'Ya' : 'Tidak', n(x.terminPembayaranHari)])
      }
    ],
    catatan: [
      'Hanya pelanggan berstatus disetujui dan belum dihapus.',
      ...(p.length > 1 ? ['Nama pelanggan sering mirip (mis. "RSUP X" vs "Pasien Pribadi RSUP X") — pastikan yang dimaksud.'] : [])
    ]
  }
}

function item(j: J): KartuVisual | null {
  if (!Array.isArray(j.item)) return null
  const it = daftar(j.item)
  const berharga = it.filter((x) => angka(x.hargaB2B) !== null)
  const saringan = j.saringan
    ? Object.entries(j.saringan as J)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k === 'kelompokHarga' ? 'kelompok harga' : k}: ${v}`)
    : []
  // Kolom yang isinya sama di semua baris hanya memakan lebar — disebut sekali di subjudul.
  const labSama = seragam(it, 'lab')
  const grupSama = seragam(it, 'grup')
  const kolom: Array<{ label: string; kanan?: boolean; kunci: string; sel: (x: J) => Sel }> = [
    { label: 'Kode', kunci: 'kode', sel: (x) => teks(x.kode) },
    { label: 'Nama', kunci: 'nama', sel: (x) => teks(x.nama) },
    { label: 'Jenis', kunci: 'jenis', sel: (x) => teks(x.jenis) },
    ...(labSama ? [] : [{ label: 'Lab', kunci: 'lab', sel: (x: J) => teks(x.lab) }]),
    ...(grupSama ? [] : [{ label: 'Grup', kunci: 'grup', sel: (x: J) => teks(x.grup) }]),
    { label: 'B2B (K1)', kanan: true, kunci: 'b2b', sel: (x) => rp(x.hargaB2B) },
    { label: 'B2C (K2)', kanan: true, kunci: 'b2c', sel: (x) => rp(x.hargaB2C) },
    { label: 'TAT (jam)', kanan: true, kunci: 'tat', sel: (x) => n(x.tatRutinJam) }
  ]
  return {
    tool: 'inno_item_search',
    judul: j.pencarian && j.pencarian !== '(tanpa kata kunci)' ? `Item Pemeriksaan — “${j.pencarian}”` : 'Item Pemeriksaan',
    sub: [SUMBER, ...saringan, labSama && !saringan.some((x) => x.startsWith('lab:')) ? `semua ${labSama}` : null, grupSama ? `grup ${grupSama}` : null]
      .filter(Boolean)
      .join(' · '),
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: 'Item ditampilkan', nilai: it.length, satuan: 'angka', catatan: j.adaLagi ? 'masih ada item lain yang cocok' : 'seluruh yang cocok' },
          { label: 'Punya harga reguler', nilai: berharga.length, satuan: 'angka' },
          { label: 'Paket', nilai: it.filter((x) => x.isiPaketBisaDilihat).length, satuan: 'angka' }
        ]
      },
      // Tabel DULU, selebar kartu: 7–8 kolom tidak muat bila disandingkan dengan grafik.
      {
        jenis: 'tabel',
        judul: 'Daftar item',
        kolom: kolom.map(({ label, kanan }) => (kanan ? { label, kanan } : { label })),
        baris: it.map((x) => kolom.map((k) => k.sel(x)))
      },
      // Batang harga hanya bila daftarnya pendek — 50 batang bukan grafik, itu dinding.
      ...(berharga.length >= 2 && berharga.length <= 12
        ? [
            {
              jenis: 'batang' as const,
              judul: 'Harga B2B / Corporate (K1)',
              satuan: 'rp' as const,
              baris: berharga.map((x) => ({ label: teks(x.nama), nilai: angka(x.hargaB2B) ?? 0 }))
            }
          ]
        : [])
    ],
    catatan: [
      'Harga DAFTAR (reguler). Pelanggan tertentu bisa punya special price yang berbeda.',
      'Hanya harga K1 (B2B/Corporate) dan K2 (B2C) yang disajikan.',
      ...(j.adaLagi ? ['Masih ada item lain yang cocok tapi belum ditampilkan — persempit pencariannya.'] : []),
      ...(it.length > berharga.length ? [`${it.length - berharga.length} item belum punya harga reguler di master — ditampilkan "—", bukan nol.`] : [])
    ]
  }
}

function specialPrice(j: J): KartuVisual | null {
  if (!Array.isArray(j.hargaKhusus)) return null
  const h = daftar(j.hargaKhusus)
  const nama = j.pelanggan?.nama ?? j.pelanggan?.kode ?? 'pelanggan'
  return {
    tool: 'inno_special_price',
    judul: `Special Price — ${nama}`,
    sub: [SUMBER, j.tanggalAcuan ? `acuan ${j.tanggalAcuan}` : null, j.pelanggan?.kode ? `kode ${j.pelanggan.kode}` : null].filter(Boolean).join(' · '),
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: 'Item berharga khusus', nilai: angka(j.jumlahItemPunyaHargaKhusus), satuan: 'angka' },
          { label: 'Aktif hari ini', nilai: angka(j.jumlahAktifHariIni), satuan: 'angka' },
          { label: 'Ditampilkan', nilai: angka(j.ditampilkan) ?? h.length, satuan: 'angka' }
        ]
      },
      {
        jenis: 'tabel',
        judul: 'Harga khusus',
        kolom: [
          { label: 'Item' },
          { label: 'Kategori' },
          { label: 'Reguler', kanan: true },
          { label: 'Khusus', kanan: true },
          { label: 'Diskon', kanan: true },
          // "Status" tidak dijadikan kolom: masaBerlaku dari tool sudah diawali statusnya ("aktif · …").
          { label: 'Masa berlaku' }
        ],
        // Diskon tanpa `arah`: ia porsi potongan, bukan perubahan — tanda "+" akan
        // terbaca sebagai kenaikan (pelajaran kartu sales 29 Sep).
        baris: h.map((x) => [
          teks(x.item),
          teks(x.kategoriHarga),
          rp(x.hargaReguler),
          rp(x.hargaKhusus),
          { nilai: angka(x.diskonPersen), satuan: 'persen' as const },
          teks(x.masaBerlaku)
        ])
      }
    ],
    catatan: [
      'Satu item bisa muncul lebih dari sekali dengan KATEGORI harga berbeda — itu bukan duplikat.',
      ...sisa(h.length, angka(j.jumlahAktifHariIni), 'harga khusus yang aktif')
    ]
  }
}

function itemSpecialPrice(j: J): KartuVisual | null {
  if (!Array.isArray(j.pelanggan)) return null
  const p = daftar(j.pelanggan)
  const harga = p.map((x) => angka(x.hargaKhusus)).filter((v): v is number => v !== null)
  // Tool sudah mengurutkan dari harga terendah — ujung-ujung daftar dipakai apa adanya.
  return {
    tool: 'inno_item_special_price',
    judul: `Pelanggan dengan Harga Khusus — ${j.item?.nama ?? j.item?.kode ?? 'item'}`,
    sub: [SUMBER, j.item?.kode ? `kode ${j.item.kode}` : null, j.tanggalAcuan ? `acuan ${j.tanggalAcuan}` : null].filter(Boolean).join(' · '),
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: 'Pelanggan aktif', nilai: angka(j.jumlahPelangganAktif), satuan: 'angka' },
          { label: 'Harga khusus terendah', nilai: harga.length ? harga[0] : null, satuan: 'rp' },
          { label: 'Tertinggi (yang tampil)', nilai: harga.length ? harga[harga.length - 1] : null, satuan: 'rp' }
        ]
      },
      {
        jenis: 'tabel',
        judul: 'Daftar pelanggan',
        kolom: [{ label: 'Pelanggan' }, { label: 'Tipe' }, { label: 'Kategori' }, { label: 'Reguler', kanan: true }, { label: 'Khusus', kanan: true }, { label: 'Masa berlaku' }],
        baris: p.map((x) => [teks(x.pelanggan), teks(x.tipe), teks(x.kategoriHarga), rp(x.hargaReguler), rp(x.hargaKhusus), teks(x.masaBerlaku)])
      },
      ...(p.length >= 2 && p.length <= 12
        ? [
            {
              jenis: 'batang' as const,
              judul: 'Harga khusus (terendah di atas)',
              satuan: 'rp' as const,
              baris: p.map((x) => ({ label: teks(x.pelanggan), nilai: angka(x.hargaKhusus) ?? 0, catatan: teks(x.kategoriHarga) }))
            }
          ]
        : [])
    ],
    catatan: [
      'Hanya harga khusus yang aktif hari ini, diurutkan dari yang terendah.',
      ...sisa(p.length, angka(j.jumlahPelangganAktif), 'pelanggan'),
      ...(p.some((x) => String(x.pelanggan).startsWith('(tidak ada di master')) ? ['Sebagian kode pelanggan tidak ada di master pelanggan aktif — ditampilkan apa adanya.'] : [])
    ]
  }
}

function pks(j: J): KartuVisual | null {
  if (!Array.isArray(j.pks)) return null
  const p = daftar(j.pks)
  const nama = j.pelanggan?.nama ?? j.pelanggan?.kode ?? 'pelanggan'
  return {
    tool: 'inno_pks',
    judul: `PKS — ${nama}`,
    sub: [SUMBER, j.tanggalAcuan ? `acuan ${j.tanggalAcuan}` : null].filter(Boolean).join(' · '),
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: 'Punya PKS', nilai: null, satuan: 'angka', catatan: j.adaPKS ? 'Ya — tercatat disetujui' : 'Tidak ada PKS yang disetujui' },
          { label: 'PKS tercatat', nilai: p.length, satuan: 'angka' },
          { label: 'Berlaku hari ini', nilai: p.filter((x) => x.status === 'aktif').length, satuan: 'angka' }
        ]
      },
      ...(p.length
        ? [
            {
              jenis: 'tabel' as const,
              judul: 'Daftar PKS',
              kolom: [{ label: 'Nomor' }, { label: 'Mulai' }, { label: 'Berakhir' }, { label: 'Status' }, { label: 'Termin (hari)', kanan: true }, { label: 'Pembayaran' }],
              baris: p.map((x) => [teks(x.nomor), teks(x.mulai), teks(x.berakhir), status(x.status), n(x.terminPembayaranHari), teks(x.metodePembayaran)])
            }
          ]
        : [])
    ],
    catatan: p.length
      ? ['"Tanpa batas akhir" = perpanjangan otomatis (di master tercatat tahun 2222).']
      : ['Tidak ada PKS berstatus disetujui — bisa memang belum ada, atau masih dalam proses persetujuan.']
  }
}

function dokter(j: J): KartuVisual | null {
  if (!Array.isArray(j.dokter)) return null
  const d = daftar(j.dokter)
  return {
    tool: 'inno_clinician_search',
    judul: `Dokter Terdaftar — “${teks(j.pencarian)}”`,
    sub: SUMBER,
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: 'Dokter cocok', nilai: d.length, satuan: 'angka' },
          { label: 'Patologis', nilai: d.filter((x) => x.patologis).length, satuan: 'angka' }
        ]
      },
      {
        jenis: 'tabel',
        judul: 'Daftar dokter',
        kolom: [{ label: 'Kode' }, { label: 'Nama' }, { label: 'Patologis' }, { label: 'Kode spesialisasi' }],
        baris: d.map((x) => [teks(x.kode), teks(x.nama), x.patologis ? 'Ya' : 'Tidak', teks(x.kodeSpesialisasi)])
      }
    ],
    catatan: [
      'Email dan telepon dokter tidak ditampilkan (data pribadi).',
      'Kode spesialisasi ditampilkan apa adanya — master spesialisasi belum terisi, jadi artinya tidak ditebak.'
    ]
  }
}

function paket(j: J): KartuVisual | null {
  if (j.ditemukan === false) {
    if (!j.perluDipilih) return null
    const k = daftar(j.kandidat)
    return {
      tool: 'inno_item_package',
      judul: `Paket “${teks(j.paketDicari)}” — pilih salah satu`,
      sub: SUMBER,
      panel: [
        {
          jenis: 'tabel',
          judul: 'Kandidat paket',
          kolom: [{ label: 'Kode' }, { label: 'Nama' }, { label: 'Jenis' }, { label: 'Lab' }],
          baris: k.map((x) => [teks(x.kode), teks(x.nama), teks(x.jenis), teks(x.lab)])
        }
      ],
      catatan: ['Nama paket cocok ke lebih dari satu item — sebutkan kode paket yang dimaksud.']
    }
  }
  if (!Array.isArray(j.isi)) return null
  const isi = daftar(j.isi)
  const total = angka(j.jumlahIsi)
  return {
    tool: 'inno_item_package',
    judul: `Isi Paket — ${j.paket?.nama ?? j.paket?.kode ?? ''}`,
    sub: [SUMBER, j.paket?.kode ? `kode ${j.paket.kode}` : null, j.paket?.lab && j.paket.lab !== '—' ? j.paket.lab : null].filter(Boolean).join(' · '),
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: 'Jumlah isi', nilai: total, satuan: 'angka' },
          { label: 'Pemeriksaan LAB', nilai: angka(j.jumlahLab), satuan: 'angka' },
          { label: 'Item NON LAB', nilai: angka(j.jumlahNonLab), satuan: 'angka', catatan: 'jasa/penunjang di luar lab' }
        ]
      },
      {
        jenis: 'tabel',
        judul: 'Isi paket',
        kolom: [{ label: 'Kode' }, { label: 'Nama' }, { label: 'Kategori' }, { label: 'Lab' }, { label: 'Grup' }],
        baris: isi.map((x) => [teks(x.kode), teks(x.nama), teks(x.kategori), teks(x.lab), teks(x.grup)])
      }
    ],
    catatan: [
      'Harga yang berlaku adalah harga PAKETNYA, bukan penjumlahan harga isinya.',
      ...sisa(isi.length, total, 'isi paket')
    ]
  }
}

export const PENERJEMAH_INNO: Record<string, (j: J) => KartuVisual | null> = {
  inno_customer_search: pelanggan,
  inno_item_search: item,
  inno_special_price: specialPrice,
  inno_item_special_price: itemSpecialPrice,
  inno_pks: pks,
  inno_clinician_search: dokter,
  inno_item_package: paket
}
