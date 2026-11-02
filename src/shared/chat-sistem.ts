// Teks pesan sistem grup chat — SATU definisi untuk layar (renderer) dan
// notifikasi (main process). Pola yang sama dengan `shared/wav.ts`: begitu ada
// dua salinan, keduanya menyimpang diam-diam.

/**
 * Teks pesan sistem di layar.
 *
 * Disusun dari (jenis, pelaku, target) saat DITAMPILKAN, bukan disimpan sebagai
 * teks jadi. Dengan begitu "kamu" selalu benar untuk yang membacanya — pesan yang
 * sama berbunyi "Kamu menambahkan Budi" bagi Andi dan "Andi menambahkan kamu"
 * bagi Budi.
 *
 * ⚠️ Jenis yang tidak dikenal (mis. dari versi AIRA yang lebih baru di laptop
 * lain) tetap menghasilkan teks, bukan string kosong. Baris kosong di tengah
 * percakapan terlihat seperti pesan yang rusak.
 */
export function teksSistem(
  jenis: string,
  pelaku: string,
  target: string | null,
  saya: string
): string {
  const aku = saya.toLowerCase()
  const siapa = (x: string | null, awal: boolean): string => {
    if (!x) return awal ? 'Seseorang' : 'seseorang'
    if (x.toLowerCase() === aku) return awal ? 'Kamu' : 'kamu'
    return x
  }
  const P = siapa(pelaku, true)
  const T = siapa(target, false)
  const TAwal = siapa(target, true)

  switch (jenis) {
    case 'buat':
      return `${P} membuat grup ini`
    case 'tambah':
      return `${P} menambahkan ${T}`
    case 'keluar':
      return `${P} keluar dari grup`
    case 'keluarkan':
      return `${P} mengeluarkan ${T}`
    case 'jadi_admin':
      return `${P} menjadikan ${T} admin`
    case 'lepas_admin':
      return `${P} mencabut status admin ${T}`
    case 'admin_otomatis':
      // Terjadi saat admin terakhir keluar. Tidak ada "pelaku" yang benar untuk
      // dituliskan — menyebut orang yang keluar sebagai pelaku menyesatkan.
      return `${TAwal} sekarang admin grup`
    case 'ganti_nama':
      // Untuk jenis ini `target` berisi NAMA BARU grup, bukan username.
      return `${P} mengganti nama grup menjadi “${target ?? ''}”`
    default:
      return 'Ada perubahan pada grup'
  }
}

