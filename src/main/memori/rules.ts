// Aturan memori AIRA — modul MURNI (tanpa database, tanpa Electron).
//
// Yang diingat AIRA adalah hal TENTANG ORANGNYA, bukan isi jawaban.
//
// ⚠️ Batas ini yang paling penting di seluruh fitur: memori TIDAK BOLEH memuat
// nilai data. Begitu "nett Agustus Rp 4,11 M" masuk ke memori, angka itu ikut
// disuntikkan ke setiap percakapan berikutnya dan akan disebut ulang
// berbulan-bulan kemudian sebagai fakta yang masih berlaku — padahal tabel
// sumbernya hidup dan berubah tiap jam. Angka yang salah tapi terdengar
// meyakinkan adalah kegagalan terburuk aplikasi ini.

/**
 * Batas jumlah memori per user.
 *
 * ⚠️ Bukan angka hiasan. `--enable-prefix-caching` BELUM aktif di gateway the company,
 * jadi system prompt dikirim dan diproses ulang pada SETIAP request — memori
 * bukan biaya sekali, melainkan biaya per giliran, untuk seluruh percakapan.
 * Ditambah lagi context overflow sudah pernah jadi masalah tersendiri sampai
 * butuh `agent/context-limit.ts` untuk memulihkannya. 20 × 200 karakter ≈ 1.000
 * token: cukup untuk mengenali orangnya, tidak cukup untuk menggeser jawaban
 * keluar dari context window.
 */
export const MAKS_MEMORI = 20
export const MAKS_PANJANG = 200

/**
 * Kalimat yang berarti "ingat ini".
 *
 * ⚠️ Deteksi ada di KODE, bukan diserahkan ke model lewat tool `simpan_memori`.
 * Model 27B di sini sudah terbukti tidak andal memilih tool — lima wujud
 * kegagalan tercatat, termasuk mengaku tool "tidak tersedia" padahal ada. Untuk
 * memori, kegagalannya bukan sekadar tool tidak terpanggil: yang lahir adalah
 * memori yang SALAH ISINYA lalu ikut ke semua percakapan berikutnya. Pola yang
 * sama dengan `applyBasisRule` dan `applyErpScope` — kalimat user yang dibaca
 * kode, bukan kebiasaan model.
 *
 * Sengaja hanya menangkap perintah yang JELAS. Kalau ragu, tidak diingat: user
 * yang merasa sudah menyuruh lalu tidak diingat akan mengulanginya, sementara
 * memori yang lahir dari kalimat biasa tidak akan pernah disadari siapa pun.
 */
const POLA: RegExp[] = [
  /^(?:tolong\s+)?ingat(?:\s+ya)?(?:\s+bahwa)?[,:]?\s+(.+)$/i,
  /^(?:tolong\s+)?catat(?:\s+ya)?(?:\s+bahwa)?[,:]?\s+(.+)$/i,
  /^(?:tolong\s+)?simpan\s+(?:di\s+)?(?:memori|ingatan)(?:mu)?[,:]?\s+(.+)$/i,
  /^mulai\s+sekarang[,:]?\s+(.+)$/i
  // ⚠️ Pola /^kalau (aku|saya) tanya …, (.+)$/ sempat ada di sini lalu DIBUANG.
  // Maksudnya menangkap "kalau saya tanya sales, selalu pakai tabel", tapi ia
  // juga cocok dengan pertanyaan biasa: "kalau saya tanya bulan lalu, hasilnya
  // beda?" akan tersimpan sebagai memori berbunyi "hasilnya beda?" — memori
  // sampah yang ikut ke setiap percakapan berikutnya dan tidak akan pernah
  // disadari siapa pun. Kalau ragu, JANGAN diingat: user yang merasa sudah
  // menyuruh akan mengulanginya, sementara memori yang lahir diam-diam tidak.
]

/**
 * Kata yang menandakan kalimatnya membawa NILAI DATA, bukan fakta tentang orang.
 *
 * "ingat nett Agustus 4,11 M" adalah perintah ingat yang sah bentuknya tapi isi
 * yang salah untuk diingat. Ditolak di sini, bukan diserahkan ke penilaian
 * model.
 */
const PENANDA_DATA =
  /\b(rp|nett|omzet|revenue|penjualan\s+bulan|total\s+sales|invoice\s+no|pasien|nik|diagnosa|diagnosis)\b|\d[\d.,]{5,}/i

/**
 * Satu-satunya definisi "kalimat ini memuat nilai data".
 *
 * Dipakai DUA jalur: perintah "ingat …" dari user (`deteksiPermintaanIngat`) dan
 * penyaringan usulan hasil ekstraksi otomatis (`ekstrak.ts`). Sengaja
 * diekspor, bukan disalin — kalau dua jalur memori punya definisi sendiri-sendiri,
 * yang longgar akan menang tanpa ada yang tahu, dan jalur otomatis justru yang
 * paling tidak diawasi manusia.
 */
export function memuatNilaiData(teks: string): boolean {
  return PENANDA_DATA.test(teks)
}

export interface HasilDeteksi {
  /** Isi yang layak diingat. */
  isi: string
}

export interface HasilTolak {
  alasan: 'data' | 'kosong' | 'panjang'
  pesan: string
}

/**
 * Membaca kalimat user. `null` = bukan perintah mengingat (kasus terbanyak).
 *
 * Mengembalikan penolakan yang BERALASAN, bukan diam: kalau user menyuruh
 * mengingat sesuatu dan tidak terjadi apa-apa tanpa keterangan, ia akan
 * menganggap fiturnya rusak — atau lebih buruk, mengira AIRA sudah mengingat.
 */
export function deteksiPermintaanIngat(teks: string): HasilDeteksi | HasilTolak | null {
  const baris = teks.trim()
  let isi: string | null = null
  for (const pola of POLA) {
    const cocok = pola.exec(baris)
    if (cocok?.[1]) {
      isi = cocok[1].trim()
      break
    }
  }
  if (isi === null) return null

  // Tanda baca penutup dibuang supaya "ingat saya di divisi FA." tidak tersimpan
  // dengan titik yang menempel dan tampak berbeda dari entri sejenis.
  isi = isi.replace(/[.!]+$/, '').trim()

  if (isi.length === 0) return { alasan: 'kosong', pesan: 'Belum jelas apa yang harus diingat.' }
  if (isi.length > MAKS_PANJANG) {
    return {
      alasan: 'panjang',
      pesan: `Terlalu panjang untuk diingat (maksimal ${MAKS_PANJANG} karakter). Ringkas jadi satu kalimat.`
    }
  }
  if (PENANDA_DATA.test(isi)) {
    return {
      alasan: 'data',
      pesan:
        'AIRA sengaja tidak mengingat ANGKA atau data pasien — angka di database berubah terus, ' +
        'dan angka lama yang diingat akan terdengar seperti fakta yang masih berlaku. ' +
        'Yang bisa diingat: peranmu, tanggung jawabmu, atau cara kamu ingin dijawab.'
    }
  }
  return { isi }
}

export function adalahTolakan(h: HasilDeteksi | HasilTolak): h is HasilTolak {
  return 'alasan' in h
}

/**
 * Blok memori untuk system prompt. String kosong bila tidak ada — pemanggil
 * tidak boleh menempelkan judul kosong yang justru memberi tahu model bahwa ada
 * bagian "memori" yang kebetulan tidak terisi.
 */
export function blokMemori(daftar: readonly string[]): string {
  if (daftar.length === 0) return ''
  return (
    '\n\nYang kamu ingat tentang user ini (disimpan atas permintaannya sendiri):\n' +
    daftar.map((m) => `- ${m}`).join('\n') +
    '\nPakai ini untuk menyesuaikan jawaban. JANGAN menyebutkannya kalau tidak relevan, ' +
    'dan jangan pernah menganggapnya angka atau data yang masih berlaku.\n'
  )
}

/**
 * Blok identitas — siapa yang sedang diajak bicara.
 *
 * Ini "Lapis 1": tanpa satu baris memori pun, inilah yang paling dirasakan orang
 * sebagai "AIRA mengenali saya". Datanya sudah ada di database login, tinggal
 * disebutkan. Divisi ikut karena ia menentukan konteks pertanyaan — SPV divisi
 * Sales dan SPV divisi Mikrobiologi menanyakan hal yang sangat berbeda.
 */
export function blokIdentitas(u: {
  username: string
  role: string
  divisi: readonly string[]
}): string {
  const peran: Record<string, string> = {
    super_admin: 'Super Admin',
    direktur: 'Direktur',
    manager: 'Manager',
    spv: 'SPV',
    staff: 'Staff'
  }
  const divisi = u.divisi.length > 0 ? ` dari divisi ${u.divisi.join(', ')}` : ''
  return (
    `\nKamu sedang berbicara dengan "${u.username}" — ${peran[u.role] ?? u.role}${divisi}. ` +
    'Sapa secukupnya dan sesuaikan kedalaman jawaban dengan perannya; jangan mengulang-ulang ' +
    'menyebut jabatannya di setiap jawaban.\n'
  )
}
