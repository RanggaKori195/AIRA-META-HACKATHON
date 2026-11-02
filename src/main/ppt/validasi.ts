import { ToolError } from '../tools/types'
import { IKON, ikonMirip } from './ikon'
import { MAKS_JUDUL } from './tema'
import { MAKS_GAMBAR_PPT } from '../gambar/rules'

// Aturan penolakan isi slide.
//
// Dipisah dari `render.ts` bukan demi kerapian, melainkan supaya BISA DIUJI:
// `render.ts` menyentuh Electron (memuat gambar template), jadi ia tidak bisa
// diimpor unit test. Aturan yang tidak teruji adalah aturan yang diam-diam
// berubah.
//
// Semua pesan errornya ditulis untuk DIBACA MODEL: sebutkan apa yang salah,
// angkanya, dan apa yang harus dilakukan — model 27B terbukti tidak
// menyimpulkan langkah berikutnya sendiri (pelajaran `read_pdf`, HANDOFF §5).

/**
 * Membaca argumen `slides` yang bisa datang sebagai array ATAU sebagai teks
 * JSON.
 *
 * ⚠️ Bukan kelonggaran demi kerapian — ini kegagalan yang sudah terjadi.
 * 21 Agu 2026, deck sungguhan pertama: model mengirim `slides` sebagai STRING
 * berisi JSON, tool menolaknya (`argumen "slides" wajib berupa array`), dan
 * satu giliran penuh terbuang (12 detik) sebelum ia mencoba lagi dengan bentuk
 * yang benar. Deck-nya jadi, tapi biayanya dibayar user dalam bentuk waktu
 * tunggu — dan pada percakapan lain kegagalan seperti ini berakhir sebagai
 * model yang menyerah.
 *
 * Menerima bentuk yang jelas maksudnya lebih murah daripada memaksa model
 * menebak ulang. Yang TIDAK dilonggarkan: isinya tetap divalidasi penuh.
 */
export function bacaSlides(nilai: unknown): unknown[] {
  let daftar = nilai
  if (typeof daftar === 'string') {
    try {
      daftar = JSON.parse(daftar)
    } catch {
      throw new ToolError(
        'argumen "slides" berupa teks yang bukan JSON yang sah. Kirim sebagai array objek, ' +
          'mis. [{"layout":"sampul","judul":"..."}].'
      )
    }
  }
  if (!Array.isArray(daftar) || daftar.length === 0) {
    throw new ToolError('argumen "slides" wajib berupa array berisi minimal satu slide')
  }
  return daftar
}

/**
 * Field bersarang (`poin`, `kartu`, `seri`, `kiri`, `kanan`, …) yang ikut
 * dikirim sebagai teks JSON — alasan yang sama dengan `bacaSlides`.
 */
const FIELD_BERSARANG = ['poin', 'item', 'kartu', 'kolom', 'baris', 'label', 'seri', 'kiri', 'kanan']

export function normalkanSlide(slide: unknown): unknown {
  if (!slide || typeof slide !== 'object') return slide
  const objek = { ...(slide as Record<string, unknown>) }
  for (const field of FIELD_BERSARANG) {
    const nilai = objek[field]
    if (typeof nilai !== 'string') continue
    const dipangkas = nilai.trim()
    if (!dipangkas.startsWith('[') && !dipangkas.startsWith('{')) continue
    try {
      objek[field] = JSON.parse(dipangkas)
    } catch {
      // Biarkan apa adanya; validasi per-layout yang akan menolaknya dengan
      // pesan yang lebih spesifik daripada "JSON tidak sah".
    }
  }
  return objek
}

/**
 * Batas ilustrasi AI dalam SATU presentasi.
 *
 * Bukan batas estetika: tiap gambar ±8 detik dan beberapa MB. Deck 20 slide
 * berilustrasi semua = menit-menit menunggu dan berkas yang tidak bisa dikirim
 * lewat email.
 */
export function pastikanJumlahGambar(jumlah: number): void {
  if (jumlah > MAKS_GAMBAR_PPT) {
    throw new ToolError(
      `presentasi ini meminta ${jumlah} ilustrasi AI, batasnya ${MAKS_GAMBAR_PPT} per presentasi ` +
        '(tiap gambar ±8 detik dan beberapa MB). Pilih slide yang paling perlu ilustrasi saja.'
    )
  }
}

/** Batas jumlah item agenda dalam satu slide. */
export const MAKS_AGENDA = 12
/** Batas jumlah kartu angka dalam satu slide. */
export const MAKS_KARTU = 4

export function pastikanJudul(judul: unknown, layout: string): string {
  const t = String(judul ?? '').trim()
  if (!t) throw new ToolError(`slide "${layout}" wajib punya judul`)
  if (t.length > MAKS_JUDUL) {
    throw new ToolError(
      `judul slide "${layout}" terlalu panjang (${t.length} karakter, batas ${MAKS_JUDUL}). ` +
        'Pindahkan keterangannya ke poin isi.'
    )
  }
  return t
}

/** Ikon yang tidak ada di daftar ditolak — bukan dibiarkan jadi kotak kosong. */
export function pastikanIkon(nama: string | undefined): string | undefined {
  if (!nama) return undefined
  if (IKON[nama]) return nama
  const saran = ikonMirip(nama)
  throw new ToolError(
    `ikon "${nama}" tidak dikenal` +
      (saran.length ? `. Yang mirip: ${saran.join(', ')}` : '') +
      '. Lihat daftar lengkap di deskripsi tool.'
  )
}

export function pastikanAgenda(item: string[], judul: string): void {
  if (item.length === 0) throw new ToolError(`slide "${judul}" tidak punya item`)
  if (item.length > MAKS_AGENDA) {
    throw new ToolError(
      `agenda ${item.length} item terlalu banyak untuk satu slide (maksimal ${MAKS_AGENDA}). ` +
        'Kelompokkan dulu, atau pakai layout "poin".'
    )
  }
}

export function pastikanKartu(jumlah: number, judul: string): void {
  if (jumlah === 0) throw new ToolError(`slide "${judul}" tidak punya kartu angka`)
  if (jumlah > MAKS_KARTU) {
    throw new ToolError(
      `slide angka maksimal ${MAKS_KARTU} kartu (diberi ${jumlah}); lebih dari itu angkanya ` +
        'jadi terlalu kecil untuk dibaca dari belakang ruangan.'
    )
  }
}

/**
 * Tabel: jumlah sel tiap baris HARUS sama dengan jumlah kolom.
 *
 * Baris timpang tidak menghasilkan error di PowerPoint — ia hanya menggeser
 * angka ke kolom yang salah. Untuk deck berisi angka penjualan, itu bukan
 * masalah tampilan melainkan angka yang salah.
 */
export function pastikanTabel(kolom: string[], baris: string[][], judul: string): void {
  if (kolom.length === 0) throw new ToolError(`tabel "${judul}" tidak punya kolom`)
  if (baris.length === 0) throw new ToolError(`tabel "${judul}" tidak punya baris`)
  const salah = baris.findIndex((r) => r.length !== kolom.length)
  if (salah >= 0) {
    throw new ToolError(
      `baris ke-${salah + 1} tabel "${judul}" berisi ${baris[salah].length} sel, ` +
        `sedangkan kolomnya ${kolom.length}. Jumlah sel tiap baris harus sama dengan jumlah kolom.`
    )
  }
}

export function pastikanGrafik(
  label: string[],
  seri: Array<{ nama: string; nilai: number[] }>,
  judul: string
): void {
  if (label.length === 0) throw new ToolError(`grafik "${judul}" tidak punya label sumbu`)
  if (seri.length === 0) throw new ToolError(`grafik "${judul}" tidak punya seri data`)
  const timpang = seri.find((d) => d.nilai.length !== label.length)
  if (timpang) {
    throw new ToolError(
      `seri "${timpang.nama}" berisi ${timpang.nilai.length} angka, sedangkan labelnya ` +
        `${label.length}. Jumlah angka tiap seri harus sama dengan jumlah label.`
    )
  }
  // Model kerap mengirim "Rp 4,11 M" sebagai nilai grafik. Kalau dibiarkan,
  // pptxgenjs menulisnya sebagai 0 dan grafiknya rata tanah TANPA error —
  // kegagalan yang terlihat seperti data yang memang nol.
  const bukanAngka = seri.some((d) => d.nilai.some((n) => typeof n !== 'number' || !isFinite(n)))
  if (bukanAngka) {
    throw new ToolError(
      `grafik "${judul}" memuat nilai yang bukan angka. Kirim angka murni (mis. 4.11), ` +
        'bukan teks berformat seperti "Rp 4,11 M".'
    )
  }
}
