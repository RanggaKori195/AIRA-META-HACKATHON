// Definisi perspektif + penyusunan laporan. MURNI, ter-test.

import {
  AMBANG_RAGU,
  type AngkaTakDidukung,
  type KlaimPerspektif,
  type KlaimRagu,
  type KonflikAngka
} from './rules'

export interface Perspektif {
  kode: string
  label: string
  /** Sudut pandang yang dipakai model saat membaca fakta yang sama. */
  sudut: string
}

/**
 * Perspektif yang PUNYA DATA.
 *
 * ⚠️ QA/Mutu sengaja TIDAK ada di sini, dan itu keputusan penting.
 *
 * Permintaan aslinya (the gateway admin, 25 Agu 2026) menyebut tiga sudut pandang:
 * marketing, lab, dan QA. Dua yang pertama punya sumber data nyata di
 * `SalesRepository`. Untuk QA — sampel ditolak, tes diulang, kegagalan QC —
 * tidak ada tabelnya di database yang tersambung ke AIRA.
 *
 * Menambahkan "QA analyst" tanpa data TIDAK akan menghasilkan error; ia akan
 * menghasilkan paragraf yang meyakinkan dan seluruhnya karangan. Dan tiga
 * perspektif yang kompak mengarang jauh lebih berbahaya daripada satu jawaban
 * biasa, karena bentuknya terlihat seperti hasil pemeriksaan berlapis.
 *
 * Ini kegagalan yang persis sama bentuknya dengan validator NIK 21 Agu 2026:
 * rapi, lolos semua pemeriksaan, dan salah. Jadi perspektif baru hanya boleh
 * ditambahkan setelah sumber datanya jelas — bukan sebaliknya.
 */
export const PERSPEKTIF: Perspektif[] = [
  {
    kode: 'komersial',
    label: 'Komersial / Marketing',
    sudut:
      'Kamu membaca angka ini sebagai orang KOMERSIAL. Yang kamu cari: apakah item ini tumbuh ' +
      'atau menyusut, siapa pelanggan yang menopangnya, seberapa terkonsentrasi risikonya pada ' +
      'sedikit pelanggan, dan apakah kontribusinya terhadap total sepadan dengan perhatian yang ' +
      'diberikan. Kamu TIDAK membahas mutu laboratorium atau proses internal.'
  },
  {
    kode: 'operasional',
    label: 'Operasional Lab',
    sudut:
      'Kamu membaca angka ini sebagai orang OPERASIONAL LABORATORIUM. Yang kamu cari: berapa lama ' +
      'pemeriksaan ini selesai (TAT), apakah ada penumpukan order yang belum keluar hasilnya, ' +
      'seberapa besar nilai yang tertahan di penumpukan itu, dan apakah beban pemeriksaan ini ' +
      'sebanding dengan hasilnya. Kamu TIDAK membahas strategi penjualan atau harga.'
  }
]

/** Perspektif yang diminta tapi belum punya sumber data — disebutkan apa adanya. */
export const PERSPEKTIF_BELUM_ADA = [
  {
    label: 'QA / Mutu',
    alasan:
      'belum ada sumber datanya di database yang tersambung (sampel ditolak, tes diulang, ' +
      'kegagalan QC tidak ada di SalesRepository maupun master Master Data)'
  }
]

/** Skema JSON yang WAJIB dipatuhi model — sama untuk semua perspektif. */
export const SKEMA_KLAIM =
  '{"klaim":[{"pernyataan":"kalimat temuan, satu gagasan","angka":[{"nama":"nama_metrik",' +
  '"nilai":<angka mentah tanpa pemisah ribuan>}],"keyakinan":<0..1>}]}'

export function promptPerspektif(p: Perspektif): string {
  return (
    `${p.sudut}\n\n` +
    'ATURAN YANG TIDAK BOLEH DILANGGAR:\n' +
    '1. SELURUH angka yang kamu sebut WAJIB berasal dari data yang diberikan. Jangan menghitung ' +
    'angka baru di kepala, jangan membulatkan, jangan mengambil dari ingatanmu. Angka yang tidak ' +
    'ada di data akan ditandai sistem sebagai tidak didukung.\n' +
    '2. Salin angkanya APA ADANYA ke dalam field "nilai" — mentah, tanpa titik pemisah ribuan, ' +
    'tanpa "Rp", tanpa "M" atau "juta".\n' +
    '3. Isi "keyakinan" dengan jujur. Kalau datanya tipis atau kamu menduga-duga, beri nilai di ' +
    `bawah ${AMBANG_RAGU} — klaim seperti itu akan dikumpulkan terpisah untuk diperiksa manusia, ` +
    'BUKAN dibuang. Memberi keyakinan tinggi pada dugaan jauh lebih merugikan daripada mengaku ragu.\n' +
    '4. Kalau data untuk sudut pandangmu memang tidak cukup, katakan itu sebagai klaim ' +
    'berkeyakinan rendah. Jangan mengisi kekosongan dengan pengetahuan umum.\n' +
    '5. Maksimal 6 klaim. Pilih yang paling berarti, bukan yang paling banyak.\n\n' +
    'Jawab HANYA dengan JSON berbentuk persis seperti ini, tanpa kalimat pembuka apa pun:\n' +
    SKEMA_KLAIM
  )
}

// ── Penyusunan laporan ────────────────────────────────────────────────────

function rupiah(n: number): string {
  return n.toLocaleString('id-ID', { maximumFractionDigits: 0 })
}

export interface BahanLaporan {
  judul: string
  periode: string
  perspektif: KlaimPerspektif[]
  konflik: KonflikAngka[]
  takDidukung: AngkaTakDidukung[]
  ragu: KlaimRagu[]
  belumAda: typeof PERSPEKTIF_BELUM_ADA
}

/**
 * Menyusun laporan markdown.
 *
 * ⚠️ Bagian "Titik Konflik & Keyakinan Rendah" WAJIB berada PALING ATAS,
 * sebelum temuan per perspektif. Pola ini diambil dari mcp-strategy, dan
 * alasannya kuat: kalau ditaruh di lampiran, bagian itu tidak pernah dibaca —
 * padahal justru di situlah letak hal yang perlu diperiksa manusia.
 *
 * Isinya dihitung dari klaim yang benar-benar dihasilkan, bukan diminta ke
 * model untuk "diingat sendiri".
 */
export function susunLaporan(b: BahanLaporan): string {
  const bagian: string[] = []
  bagian.push(`# ${b.judul}`)
  bagian.push(`Periode: ${b.periode}`)

  // ── Yang perlu diperiksa manusia — DULUAN ──
  const adaMasalah = b.konflik.length > 0 || b.takDidukung.length > 0 || b.ragu.length > 0
  bagian.push('## ⚠️ Titik Konflik & Keyakinan Rendah')
  if (!adaMasalah) {
    bagian.push(
      'Tidak ada konflik angka antar perspektif, tidak ada angka di luar data, dan tidak ada ' +
        `klaim berkeyakinan di bawah ${AMBANG_RAGU}. Bagian ini dihitung otomatis dari klaim ` +
        'yang dihasilkan, bukan dari kesimpulan model.'
    )
  }

  if (b.konflik.length > 0) {
    bagian.push(
      '**Angka berbeda untuk hal yang sama.** Semua perspektif membaca data yang identik, jadi ' +
        'selisih di sini berarti salah satu salah membaca — bukan beda pendapat.'
    )
    for (const k of b.konflik) {
      const isi = k.nilai.map((v) => `${v.perspektif} = ${rupiah(v.nilai)}`).join(' · ')
      bagian.push(`- \`${k.nama}\` → ${isi}`)
    }
  }

  if (b.takDidukung.length > 0) {
    bagian.push(
      '**Angka yang tidak ditemukan di data.** Bisa jadi hasil turunan yang wajar (persentase, ' +
        'selisih), bisa juga karangan. Perlu dicek sebelum dipakai.'
    )
    for (const a of b.takDidukung) {
      bagian.push(`- ${a.perspektif}: \`${a.nama}\` = ${rupiah(a.nilai)}`)
    }
  }

  if (b.ragu.length > 0) {
    bagian.push(`**Klaim berkeyakinan di bawah ${AMBANG_RAGU}.**`)
    for (const r of b.ragu) {
      bagian.push(`- ${r.perspektif} (${r.keyakinan.toFixed(2)}): ${r.pernyataan}`)
    }
  }

  // ── Temuan per perspektif ──
  for (const p of b.perspektif) {
    bagian.push(`## ${p.label}`)
    // ⚠️ `gagalParse` TIDAK otomatis berarti kosong. Keluaran model yang
    // terpotong di tengah tetap menyisakan klaim-klaim awal yang utuh
    // (`pungutKlaimUtuh`), dan membuangnya cuma karena kurung penutup tidak
    // sempat ditulis adalah kerugian yang tidak perlu. Yang menentukan
    // ditampilkan atau tidak adalah ADA TIDAKNYA klaim, bukan ada tidaknya
    // catatan kegagalan.
    if (p.klaim.length === 0) {
      bagian.push(
        `Tidak ada temuan yang bisa dibaca dari perspektif ini (${p.gagalParse ?? 'tidak ada klaim'}).`
      )
      continue
    }
    if (p.gagalParse) {
      bagian.push(`_Catatan: ${p.gagalParse} — temuan di bawah ini yang berhasil dibaca._`)
    }
    for (const k of p.klaim) {
      const angka = k.angka.length
        ? ` _(${k.angka.map((a) => `${a.nama}: ${rupiah(a.nilai)}`).join(', ')})_`
        : ''
      bagian.push(`- ${k.pernyataan}${angka} — keyakinan ${k.keyakinan.toFixed(2)}`)
    }
  }

  if (b.belumAda.length > 0) {
    bagian.push('## Perspektif yang belum bisa disajikan')
    for (const p of b.belumAda) {
      bagian.push(`- **${p.label}** — ${p.alasan}.`)
    }
  }

  return bagian.join('\n\n')
}
