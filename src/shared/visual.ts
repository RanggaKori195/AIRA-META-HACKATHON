// Kartu VISUAL otomatis untuk setiap jawaban data (29 Sep 2026, permintaan
// manager: "tampilan seperti dashboard itu untuk semua pertanyaan data").
//
// ⚠️ Disusun KODE di main process dari HASIL TOOL yang benar-benar dipanggil
// AIRA di giliran itu (`main/visual/*`) — tidak ada query tambahan, dan tidak ada
// satu pun angka yang ditulis model. Renderer hanya menggambar bentuk umum di
// bawah ini, jadi satu komponen melayani semua tool.

export type Satuan = 'rp' | 'angka' | 'persen' | 'hari'

export interface ItemKpi {
  label: string
  nilai: number | null
  satuan: Satuan
  /** Keterangan kecil di bawah angka. */
  catatan?: string
  /** Warna panah: naik = hijau, turun = merah. */
  arah?: 'naik' | 'turun'
}

/** Isi sel tabel. `arah` memberi panah & warna (untuk kolom % perubahan). */
export type Sel = string | number | null | { nilai: number | null; satuan: Satuan; arah?: 'naik' | 'turun' }

export type Panel =
  | { jenis: 'kpi'; item: ItemKpi[] }
  /** Batang horizontal — peringkat (item/pelanggan/wilayah terbesar). */
  | { jenis: 'batang'; judul?: string; satuan: Satuan; baris: Array<{ label: string; nilai: number; catatan?: string }> }
  /** Deret waktu: batang/garis + opsional rentang (ramalan) & seri pembanding. */
  | {
      jenis: 'deret'
      judul?: string
      satuan: Satuan
      titik: Array<{ label: string; nilai: number; bawah?: number | null; atas?: number | null; perkiraan?: boolean }>
      pembanding?: { nama: string; nilai: Array<number | null> }
      namaSeri?: string
    }
  | {
      jenis: 'tabel'
      judul?: string
      kolom: Array<{ label: string; kanan?: boolean }>
      baris: Sel[][]
    }

export interface KartuVisual {
  /** Nama tool sumbernya (untuk jejak & uji). */
  tool: string
  judul: string
  /** Periode, basis, filter — kalimat pendek. */
  sub: string | null
  panel: Panel[]
  /** Catatan kejujuran data yang WAJIB terlihat (mis. "bukan nol", "perkiraan"). */
  catatan: string[]
}
