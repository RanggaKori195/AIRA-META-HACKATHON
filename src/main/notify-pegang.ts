// Pegangan notifikasi Windows yang punya aksi klik (20 Okt 2026).
//
// ⚠️ Electron menyampaikan event `click` lewat OBJEK Notification-nya. Objek yang tidak
// dipegang siapa pun bisa dibuang garbage collector, dan klik dari Action Center —
// sering berjam-jam sesudah toast muncul — tidak pernah sampai: "klik untuk menggali"
// mati tanpa pesan. Karena itu notifikasi berklik DIPEGANG sampai diklik.
// ⚠️ Pegangan dilepas saat KLIK, bukan saat `close`: `close` juga terjadi ketika toast
// pindah ke Action Center sesudah batas waktunya — justru saat ia masih bisa diklik.
// ⚠️ Berbatas: yang paling lama dilepas (TIDAK ditutup — entrinya di Action Center tetap
// ada, hanya kliknya yang mungkin tidak lagi sampai).
// Modul murni (tanpa Electron) supaya aturannya diuji langsung.

export interface BisaDitutup {
  close(): void
}

export interface Pegangan<T extends BisaDitutup> {
  pegang(n: T, grup: string | null, pemilik: string | null): void
  lepas(n: T): void
  /**
   * Menutup (menghapus dari Action Center) toast `grup` milik siapa pun SELAIN `pemilik`;
   * `pemilik` null = semua toast grup itu. Dipakai saat user berganti / logout: toast
   * berisi keadaan data milik orang sebelumnya tidak boleh tertinggal untuk orang berikutnya.
   */
  tutupMilikSelain(grup: string, pemilik: string | null): number
  jumlah(): number
}

export const MAKS_DIPEGANG = 30

export function buatPegangan<T extends BisaDitutup>(maks = MAKS_DIPEGANG): Pegangan<T> {
  let daftar: Array<{ n: T; grup: string | null; pemilik: string | null }> = []
  return {
    pegang(n, grup, pemilik) {
      daftar.push({ n, grup, pemilik })
      if (daftar.length > maks) daftar = daftar.slice(daftar.length - maks)
    },
    lepas(n) {
      daftar = daftar.filter((x) => x.n !== n)
    },
    tutupMilikSelain(grup, pemilik) {
      const ditutup = daftar.filter((x) => x.grup === grup && x.pemilik !== pemilik)
      for (const x of ditutup) {
        try {
          x.n.close()
        } catch {
          // Toast yang sudah hilang dari sistem tidak perlu ditutup lagi.
        }
      }
      daftar = daftar.filter((x) => !ditutup.includes(x))
      return ditutup.length
    },
    jumlah() {
      return daftar.length
    }
  }
}
