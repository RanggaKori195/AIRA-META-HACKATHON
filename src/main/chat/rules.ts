// Aturan murni chat antar pengguna AIRA. Tidak menyentuh database maupun Electron,
// jadi seluruhnya bisa diuji tanpa jaringan.
//
// Latar: permintaan user 8 Sep 2026 — daftar siapa yang sedang online di pojok
// kanan bawah, klik salah satu, muncul ruang chat.

/**
 * Seberapa sering laptop menyetorkan tanda "saya masih di sini".
 *
 * ⚠️ Ini beban TETAP ke database produksi: tiap AIRA yang terbuka menulis satu
 * baris tiap selang ini, selamanya, dan server itu dipakai bersama aplikasi lain
 * dengan `max_connections` hanya 100. 20 detik × 30 laptop = 1,5 tulis/detik —
 * kecil, tapi jangan diperkecil lagi tanpa alasan. "Online" yang meleset 20 detik
 * tidak merugikan siapa pun.
 */
export const DETAK_MS = 20_000

/**
 * Batas dianggap masih online. Sengaja LEBIH LONGGAR dari `DETAK_MS` (3×).
 *
 * Kalau ambangnya sama dengan detaknya, satu detak yang telat sedikit — karena
 * jaringan tersendat atau query antre — membuat orang berkedip hilang lalu muncul
 * lagi di daftar. Daftar yang berkedip terlihat rusak, dan orang berhenti
 * mempercayainya.
 */
export const AMBANG_ONLINE_MS = 60_000

/** Selang memuat pesan baru SAAT ruang chat terbuka. */
export const POLL_PESAN_MS = 4_000

/**
 * Selang MAIN PROCESS memeriksa pesan masuk untuk notifikasi.
 *
 * ⚠️ Pemeriksaan ini WAJIB di main, bukan di renderer. Renderer bisa
 * tersembunyi, diminimalkan, atau dimuat ulang — dan notifikasi yang hanya hidup
 * saat jendelanya terbuka adalah notifikasi yang gagal tepat pada saat ia
 * dibutuhkan. Alasan yang sama membuat detak kehadiran dipindah ke main.
 *
 * 10 detik, bukan 4: ini berjalan SELAMANYA di setiap laptop yang menyalakan
 * AIRA, sementara polling 4 detik hanya hidup saat ruang chat dibuka. Satu query
 * gabungan tiap 10 detik × 40 laptop = 4 query/detik tetap ke database produksi
 * yang dipakai bersama aplikasi lain. Jangan diperkecil tanpa mengukur dulu.
 */
export const POLL_NOTIF_MS = 10_000

/** Batas panjang cuplikan isi pesan di dalam notifikasi Windows. */
export const MAKS_PRATINJAU = 120

export interface PesanMasuk {
  pengirim: string
  isi: string
  adaLampiran: boolean
  /** Terisi = pesan grup. */
  grup?: { id: string; nama: string }
  /**
   * Teks pengganti untuk pesan sistem yang memang layak dibunyikan (saat ini
   * hanya "X menambahkan kamu"). Kosong = pesan biasa.
   */
  sistem?: string
}

export interface RingkasNotifikasi {
  judul: string
  isi: string
  /** Nama pengirim terakhir. */
  pengirim: string
  /** Terisi bila notifikasi ini milik sebuah grup. */
  grupId?: string
}

/**
 * Menyusun SATU notifikasi dari beberapa pesan yang datang bersamaan.
 *
 * ⚠️ Dikelompokkan per PENGIRIM, bukan per pesan. Lima pesan beruntun dari orang
 * yang sama harus jadi satu toast, bukan lima — notifikasi yang bertubi-tubi
 * membuat orang mematikan notifikasi AIRA di setelan Windows, dan sesudah itu
 * pesan yang benar-benar penting ikut tidak terlihat. Pola yang sama dengan
 * dialog persetujuan yang muncul terlalu sering lalu diklik tanpa dibaca.
 *
 * @param pratinjau false = isi pesan TIDAK ditampilkan. Laptop sering di-share
 *   screen atau dicolok proyektor saat rapat, dan toast berisi potongan chat
 *   muncul di layar besar tanpa bisa ditarik kembali.
 */
export function ringkasNotifikasi(
  masuk: readonly PesanMasuk[],
  pratinjau: boolean
): RingkasNotifikasi[] {
  // ⚠️ Pesan grup dikelompokkan per GRUP, bukan per pengirim. Satu grup ramai
  // yang diisi lima orang harus jadi satu toast, bukan lima — dan pesan pribadi
  // dari Budi tidak boleh digabung dengan pesan Budi di grup (dua tempat yang
  // berbeda untuk dibuka).
  const perKelompok = new Map<string, PesanMasuk[]>()
  for (const p of masuk) {
    const kunci = p.grup ? `grup:${p.grup.id}` : `orang:${p.pengirim.toLowerCase()}`
    const daftar = perKelompok.get(kunci)
    if (daftar) daftar.push(p)
    else perKelompok.set(kunci, [p])
  }

  const potong = (t: string): string =>
    t.length > MAKS_PRATINJAU ? `${t.slice(0, MAKS_PRATINJAU - 1).trimEnd()}…` : t

  const hasil: RingkasNotifikasi[] = []
  for (const daftar of perKelompok.values()) {
    const terakhir = daftar[daftar.length - 1]
    const pengirim = terakhir.pengirim
    const nama = terakhir.grup ? terakhir.grup.nama : pengirim
    const judul = daftar.length > 1 ? `${nama} (${daftar.length} pesan)` : nama

    let isi: string
    if (terakhir.sistem) {
      // Pesan sistem tidak berisi apa pun yang rahasia ("Andi menambahkan kamu"),
      // jadi tetap dibunyikan walau pratinjau dimatikan — tanpa itu orang tidak
      // pernah tahu ia baru dimasukkan ke sebuah grup.
      isi = terakhir.sistem
    } else if (!pratinjau) {
      isi = daftar.length > 1 ? `${daftar.length} pesan baru` : 'Pesan baru'
    } else {
      const teks = terakhir.isi.trim()
      // Lampiran tanpa teks tetap harus berbunyi sesuatu — notifikasi kosong
      // terlihat seperti aplikasi rusak.
      const dasar = teks || (terakhir.adaLampiran ? '📎 mengirim lampiran' : 'Pesan baru')
      // Di grup, nama pengirim wajib ikut — "oke setuju" tanpa nama tidak
      // memberi tahu SIAPA yang setuju.
      isi = potong(terakhir.grup ? `${pengirim}: ${dasar}` : dasar)
    }
    hasil.push(terakhir.grup ? { judul, isi, pengirim, grupId: terakhir.grup.id } : { judul, isi, pengirim })
  }
  return hasil
}

/**
 * Teks lencana di ikon taskbar.
 *
 * Di atas 9 tidak ditulis angkanya — "12" tidak terbaca di kotak 16 piksel, dan
 * yang perlu diketahui orang pada titik itu cuma "banyak".
 */
export function labelLencana(jumlah: number): string | null {
  if (jumlah <= 0) return null
  return jumlah > 9 ? '9+' : String(jumlah)
}

/** Kunci penyimpanan daftar senyap — satu daftar per user, per laptop. */
export function kunciSenyap(username: string): string {
  return username.toLowerCase()
}

/** Apakah percakapan dengan `lawan` sedang disenyapkan. */
export function sedangSenyap(daftar: readonly string[] | undefined, lawan: string): boolean {
  if (!daftar || daftar.length === 0) return false
  const l = lawan.toLowerCase()
  return daftar.some((x) => x.toLowerCase() === l)
}

/**
 * Batas panjang satu pesan.
 *
 * Bukan soal ruang penyimpanan: pesan sepanjang esai di jendela kecil pojok layar
 * tidak terbaca, dan orang akan mengirimnya sebagai berkas.
 */
export const MAKS_ISI = 4_000

/**
 * Batas ukuran lampiran.
 *
 * ⚠️ Lampiran disimpan sebagai `bytea` di database produksi yang dipakai bersama
 * aplikasi lain. Tanpa batas keras, tabel ini tumbuh jadi puluhan giga dan tidak
 * akan ada yang berani menghapusnya. 5 MB cukup untuk tangkapan layar dan dokumen
 * biasa — yang lebih besar dari itu tempatnya OneDrive, dan AIRA sudah bisa ke sana.
 */
export const MAKS_LAMPIRAN = 5 * 1024 * 1024

/** Berapa lama lampiran disimpan sebelum dibuang. Teksnya TETAP tinggal. */
export const LAMPIRAN_UMUR_HARI = 30

/**
 * Jenis berkas yang boleh dikirim — daftar IZIN, bukan daftar larangan.
 *
 * ⚠️ Sengaja daftar-izin, pola yang sama dengan `KOLOM_AMAN` (§35): jenis berkas
 * baru yang belum terpikirkan otomatis DITOLAK, bukan otomatis lolos. Yang paling
 * penting tidak ada di sini: `.exe`, `.bat`, `.ps1`, `.lnk`, `.js`. Chat internal
 * adalah jalur yang sempurna untuk menyebarkan berkas yang bisa dijalankan, dan
 * penerimanya percaya karena datang dari rekan yang ia kenal.
 */
export const MIME_DIIZINKAN = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
] as const

export type PeriksaLampiran = { ok: true } | { ok: false; alasan: string }

export function periksaLampiran(nama: string, mime: string, ukuran: number): PeriksaLampiran {
  if (!nama.trim()) return { ok: false, alasan: 'nama berkas kosong' }
  if (ukuran <= 0) return { ok: false, alasan: 'berkas kosong' }
  if (ukuran > MAKS_LAMPIRAN) {
    return {
      ok: false,
      alasan:
        `berkas ${(ukuran / 1048576).toFixed(1)} MB melebihi batas ` +
        `${MAKS_LAMPIRAN / 1048576} MB. Untuk berkas besar, taruh di OneDrive lalu kirim tautannya.`
    }
  }
  if (!(MIME_DIIZINKAN as readonly string[]).includes(mime)) {
    return {
      ok: false,
      alasan: `jenis berkas "${mime}" tidak boleh dikirim lewat chat (hanya gambar, PDF, teks, dan dokumen Office)`
    }
  }
  return { ok: true }
}

/** Apakah pesan ini sah untuk dikirim. */
export function periksaPesan(isi: string, adaLampiran: boolean): PeriksaLampiran {
  const bersih = isi.trim()
  if (!bersih && !adaLampiran) return { ok: false, alasan: 'pesan kosong' }
  if (bersih.length > MAKS_ISI) {
    return { ok: false, alasan: `pesan melebihi ${MAKS_ISI} karakter` }
  }
  return { ok: true }
}

/**
 * Kunci ruang chat antara dua orang — SELALU urut abjad.
 *
 * ⚠️ Harus tidak bergantung siapa yang bertanya. Kalau "andi->budi" dan
 * "budi->andi" jadi dua kunci berbeda, satu percakapan terbelah jadi dua ruang
 * dan tiap orang cuma melihat setengahnya — tanpa error, tanpa tanda apa pun.
 */
export function kunciRuang(a: string, b: string): string {
  return [a.toLowerCase(), b.toLowerCase()].sort().join('|')
}

/**
 * Apakah `username` boleh membaca pesan ini.
 *
 * ⚠️ Dipakai di MAIN process dengan username dari SESI, bukan dari renderer.
 * Menyaring daftar di layar tidak cukup — pola yang sama dengan `sessionMilik`
 * (§16): handler menerima id apa pun yang dikirim renderer, jadi kepemilikan
 * harus diperiksa ulang di titik pengambilan datanya.
 */
export function bolehBaca(username: string, pengirim: string, penerima: string): boolean {
  const u = username.toLowerCase()
  return u === pengirim.toLowerCase() || u === penerima.toLowerCase()
}

/** Apakah seseorang dianggap online berdasarkan detak terakhirnya. */
export function masihOnline(lastSeen: Date, sekarang: Date = new Date()): boolean {
  return sekarang.getTime() - lastSeen.getTime() <= AMBANG_ONLINE_MS
}
