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
import { labelData, masaBerlaku } from '../sales/display-en'

type J = Record<string, any>

const angka = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null

const rp = (v: unknown): Sel => ({ nilai: angka(v), satuan: 'rp' })
const n = (v: unknown): Sel => ({ nilai: angka(v), satuan: 'angka' })
const teks = (v: unknown): string => (v == null || v === '' ? '—' : String(v))
const daftar = (v: unknown): J[] => (Array.isArray(v) ? (v as J[]) : [])

const SUMBER = 'Master Data'
const STATUS: Record<string, string> = { aktif: 'Active', kadaluarsa: 'Expired', belum_mulai: 'Not started yet' }
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
  return total !== null && total > tampil ? [`The card shows ${tampil} of ${total} ${benda}.`] : []
}

function pelanggan(j: J): KartuVisual | null {
  if (!Array.isArray(j.pelanggan)) return null
  const p = daftar(j.pelanggan)
  return {
    tool: 'inno_customer_search',
    judul: `Registered Customers — “${teks(j.pencarian)}”`,
    sub: SUMBER,
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: 'Matching customers', nilai: p.length, satuan: 'angka' },
          { label: 'Linked to ERP', nilai: p.filter((x) => x.terhubungERP).length, satuan: 'angka' }
        ]
      },
      {
        jenis: 'tabel',
        judul: 'Candidates',
        kolom: [{ label: 'Code' }, { label: 'Name' }, { label: 'Type' }, { label: 'ERP' }, { label: 'Terms (days)', kanan: true }],
        baris: p.map((x) => [teks(x.kode), teks(x.nama), labelData(x.tipe), x.terhubungERP ? 'Yes' : 'No', n(x.terminPembayaranHari)])
      }
    ],
    catatan: [
      'Only approved customers that have not been deleted.',
      ...(p.length > 1 ? ['Customer names are often similar (e.g. "RSUP X" vs "Pasien Pribadi RSUP X") — make sure you pick the right one.'] : [])
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
        .map(([k, v]) => `${k === 'kelompokHarga' ? 'price group' : k}: ${typeof v === 'string' ? labelData(v) : v}`)
    : []
  // Kolom yang isinya sama di semua baris hanya memakan lebar — disebut sekali di subjudul.
  const labSama = seragam(it, 'lab')
  const grupSama = seragam(it, 'grup')
  const kolom: Array<{ label: string; kanan?: boolean; kunci: string; sel: (x: J) => Sel }> = [
    { label: 'Code', kunci: 'kode', sel: (x) => teks(x.kode) },
    { label: 'Name', kunci: 'nama', sel: (x) => teks(x.nama) },
    { label: 'Type', kunci: 'jenis', sel: (x) => labelData(x.jenis) },
    ...(labSama ? [] : [{ label: 'Lab', kunci: 'lab', sel: (x: J) => labelData(x.lab) }]),
    ...(grupSama ? [] : [{ label: 'Group', kunci: 'grup', sel: (x: J) => teks(x.grup) }]),
    { label: 'B2B (K1)', kanan: true, kunci: 'b2b', sel: (x) => rp(x.hargaB2B) },
    { label: 'B2C (K2)', kanan: true, kunci: 'b2c', sel: (x) => rp(x.hargaB2C) },
    { label: 'TAT (hours)', kanan: true, kunci: 'tat', sel: (x) => n(x.tatRutinJam) }
  ]
  return {
    tool: 'inno_item_search',
    judul: j.pencarian && j.pencarian !== '(tanpa kata kunci)' ? `Test Items — “${j.pencarian}”` : 'Test Items',
    sub: [SUMBER, ...saringan, labSama && !saringan.some((x) => x.startsWith('lab:')) ? `all ${labelData(labSama)}` : null, grupSama ? `group ${grupSama}` : null]
      .filter(Boolean)
      .join(' · '),
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: 'Items shown', nilai: it.length, satuan: 'angka', catatan: j.adaLagi ? 'more matching items exist' : 'all matches' },
          { label: 'Have a regular price', nilai: berharga.length, satuan: 'angka' },
          { label: 'Packages', nilai: it.filter((x) => x.isiPaketBisaDilihat).length, satuan: 'angka' }
        ]
      },
      // Tabel DULU, selebar kartu: 7–8 kolom tidak muat bila disandingkan dengan grafik.
      {
        jenis: 'tabel',
        judul: 'Item list',
        kolom: kolom.map(({ label, kanan }) => (kanan ? { label, kanan } : { label })),
        baris: it.map((x) => kolom.map((k) => k.sel(x)))
      },
      // Batang harga hanya bila daftarnya pendek — 50 batang bukan grafik, itu dinding.
      ...(berharga.length >= 2 && berharga.length <= 12
        ? [
            {
              jenis: 'batang' as const,
              judul: 'B2B / Corporate price (K1)',
              satuan: 'rp' as const,
              baris: berharga.map((x) => ({ label: teks(x.nama), nilai: angka(x.hargaB2B) ?? 0 }))
            }
          ]
        : [])
    ],
    catatan: [
      'LIST (regular) prices. Specific customers may have a different special price.',
      'Only K1 (B2B/Corporate) and K2 (B2C) prices are shown.',
      ...(j.adaLagi ? ['More matching items exist but are not shown yet — narrow the search.'] : []),
      ...(it.length > berharga.length ? [`${it.length - berharga.length} ${it.length - berharga.length === 1 ? 'item has' : 'items have'} no regular price in the master data — shown as "—", not zero.`] : [])
    ]
  }
}

function specialPrice(j: J): KartuVisual | null {
  if (!Array.isArray(j.hargaKhusus)) return null
  const h = daftar(j.hargaKhusus)
  const nama = j.pelanggan?.nama ?? j.pelanggan?.kode ?? 'customer'
  return {
    tool: 'inno_special_price',
    judul: 'Special Price — ' + nama,
    sub: [SUMBER, j.tanggalAcuan ? `as of ${j.tanggalAcuan}` : null, j.pelanggan?.kode ? 'code ' + j.pelanggan.kode : null].filter(Boolean).join(' · '),
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: 'Items with a special price', nilai: angka(j.jumlahItemPunyaHargaKhusus), satuan: 'angka' },
          { label: 'Active today', nilai: angka(j.jumlahAktifHariIni), satuan: 'angka' },
          { label: 'Shown', nilai: angka(j.ditampilkan) ?? h.length, satuan: 'angka' }
        ]
      },
      {
        jenis: 'tabel',
        judul: 'Special prices',
        kolom: [
          { label: 'Item' },
          { label: 'Category' },
          { label: 'Regular', kanan: true },
          { label: 'Special', kanan: true },
          { label: 'Discount', kanan: true },
          // "Status" tidak dijadikan kolom: masaBerlaku dari tool sudah diawali statusnya ("aktif · …").
          { label: 'Validity' }
        ],
        // Diskon tanpa `arah`: ia porsi potongan, bukan perubahan — tanda "+" akan
        // terbaca sebagai kenaikan (pelajaran kartu sales 29 Sep).
        baris: h.map((x) => [
          teks(x.item),
          labelData(x.kategoriHarga),
          rp(x.hargaReguler),
          rp(x.hargaKhusus),
          { nilai: angka(x.diskonPersen), satuan: 'persen' as const },
          masaBerlaku(x.masaBerlaku)
        ])
      }
    ],
    catatan: [
      'One item can appear more than once with a different price CATEGORY — that is not a duplicate.',
      ...sisa(h.length, angka(j.jumlahAktifHariIni), 'active special prices')
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
    judul: 'Customers with a Special Price — ' + (j.item?.nama ?? j.item?.kode ?? 'item'),
    sub: [SUMBER, j.item?.kode ? `code ${j.item.kode}` : null, j.tanggalAcuan ? `as of ${j.tanggalAcuan}` : null].filter(Boolean).join(' · '),
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: 'Active customers', nilai: angka(j.jumlahPelangganAktif), satuan: 'angka' },
          { label: 'Lowest special price', nilai: harga.length ? harga[0] : null, satuan: 'rp' },
          { label: 'Highest (shown)', nilai: harga.length ? harga[harga.length - 1] : null, satuan: 'rp' }
        ]
      },
      {
        jenis: 'tabel',
        judul: 'Customer list',
        kolom: [{ label: 'Customer' }, { label: 'Type' }, { label: 'Category' }, { label: 'Regular', kanan: true }, { label: 'Special', kanan: true }, { label: 'Validity' }],
        baris: p.map((x) => [teks(x.pelanggan), labelData(x.tipe), labelData(x.kategoriHarga), rp(x.hargaReguler), rp(x.hargaKhusus), masaBerlaku(x.masaBerlaku)])
      },
      ...(p.length >= 2 && p.length <= 12
        ? [
            {
              jenis: 'batang' as const,
              judul: 'Special price (lowest on top)',
              satuan: 'rp' as const,
              baris: p.map((x) => ({ label: teks(x.pelanggan), nilai: angka(x.hargaKhusus) ?? 0, catatan: labelData(x.kategoriHarga) }))
            }
          ]
        : [])
    ],
    catatan: [
      'Only special prices that are active today, sorted from the lowest.',
      ...sisa(p.length, angka(j.jumlahPelangganAktif), 'customers'),
      ...(p.some((x) => String(x.pelanggan).startsWith('(tidak ada di master')) ? ['Some customer codes are not in the active customer master — shown as they are.'] : [])
    ]
  }
}

function pks(j: J): KartuVisual | null {
  if (!Array.isArray(j.pks)) return null
  const p = daftar(j.pks)
  const nama = j.pelanggan?.nama ?? j.pelanggan?.kode ?? 'customer'
  return {
    tool: 'inno_pks',
    judul: 'PKS — ' + nama,
    sub: [SUMBER, j.tanggalAcuan ? `as of ${j.tanggalAcuan}` : null].filter(Boolean).join(' · '),
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: 'Has a PKS', nilai: null, satuan: 'angka', catatan: j.adaPKS ? 'Yes — recorded as approved' : 'No approved PKS' },
          { label: 'PKS on record', nilai: p.length, satuan: 'angka' },
          { label: 'In force today', nilai: p.filter((x) => x.status === 'aktif').length, satuan: 'angka' }
        ]
      },
      ...(p.length
        ? [
            {
              jenis: 'tabel' as const,
              judul: 'PKS list',
              kolom: [{ label: 'Number' }, { label: 'Start' }, { label: 'End' }, { label: 'Status' }, { label: 'Terms (days)', kanan: true }, { label: 'Payment' }],
              baris: p.map((x) => [teks(x.nomor), teks(x.mulai), teks(x.berakhir), status(x.status), n(x.terminPembayaranHari), teks(x.metodePembayaran)])
            }
          ]
        : [])
    ],
    catatan: p.length
      ? ['"No end date" = automatic renewal (recorded as the year 2222 in the master data).']
      : ['No PKS with approved status — there may be none, or it may still be awaiting approval.']
  }
}

function dokter(j: J): KartuVisual | null {
  if (!Array.isArray(j.dokter)) return null
  const d = daftar(j.dokter)
  return {
    tool: 'inno_clinician_search',
    judul: `Registered Doctors — “${teks(j.pencarian)}”`,
    sub: SUMBER,
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: 'Matching doctors', nilai: d.length, satuan: 'angka' },
          { label: 'Pathologists', nilai: d.filter((x) => x.patologis).length, satuan: 'angka' }
        ]
      },
      {
        jenis: 'tabel',
        judul: 'Doctor list',
        kolom: [{ label: 'Code' }, { label: 'Name' }, { label: 'Pathologist' }, { label: 'Specialty code' }],
        baris: d.map((x) => [teks(x.kode), teks(x.nama), x.patologis ? 'Yes' : 'No', teks(x.kodeSpesialisasi)])
      }
    ],
    catatan: [
      'Doctor email and phone are not shown (personal data).',
      'Specialty codes are shown as they are — the specialty master is not filled in yet, so their meaning is not guessed.'
    ]
  }
}

function paket(j: J): KartuVisual | null {
  if (j.ditemukan === false) {
    if (!j.perluDipilih) return null
    const k = daftar(j.kandidat)
    return {
      tool: 'inno_item_package',
      judul: `Package “${teks(j.paketDicari)}” — pick one`,
      sub: SUMBER,
      panel: [
        {
          jenis: 'tabel',
          judul: 'Candidate packages',
          kolom: [{ label: 'Code' }, { label: 'Name' }, { label: 'Type' }, { label: 'Lab' }],
          baris: k.map((x) => [teks(x.kode), teks(x.nama), labelData(x.jenis), labelData(x.lab)])
        }
      ],
      catatan: ['The package name matches more than one item — give the code of the package you mean.']
    }
  }
  if (!Array.isArray(j.isi)) return null
  const isi = daftar(j.isi)
  const total = angka(j.jumlahIsi)
  return {
    tool: 'inno_item_package',
    judul: 'Package Contents — ' + (j.paket?.nama ?? j.paket?.kode ?? ''),
    sub: [SUMBER, j.paket?.kode ? `code ${j.paket.kode}` : null, j.paket?.lab && j.paket.lab !== '—' ? labelData(j.paket.lab) : null].filter(Boolean).join(' · '),
    panel: [
      {
        jenis: 'kpi',
        item: [
          { label: 'Number of contents', nilai: total, satuan: 'angka' },
          { label: 'LAB tests', nilai: angka(j.jumlahLab), satuan: 'angka' },
          { label: 'NON-LAB items', nilai: angka(j.jumlahNonLab), satuan: 'angka', catatan: 'services/support outside the lab' }
        ]
      },
      {
        jenis: 'tabel',
        judul: 'Package contents',
        kolom: [{ label: 'Code' }, { label: 'Name' }, { label: 'Category' }, { label: 'Lab' }, { label: 'Group' }],
        baris: isi.map((x) => [teks(x.kode), teks(x.nama), teks(x.kategori), labelData(x.lab), teks(x.grup)])
      }
    ],
    catatan: [
      'The applicable price is the PACKAGE price, not the sum of the prices of its contents.',
      ...sisa(isi.length, total, 'package contents')
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
