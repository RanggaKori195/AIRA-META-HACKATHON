// Membuang klaim PEMOTONGAN yang tidak pernah terjadi. Modul MURNI, ter-test.
//
// ⚠️ Ini lapis KETIGA untuk satu masalah yang sama, dan dua lapis sebelumnya
// terbukti tidak cukup:
//
//   19 Agu 2026 — `read_pdf` DIAM soal kelengkapan → model mengarang
//                 "~95 ribu karakter terpotong" (benarnya 31 ribu).
//                 Perbaikan: hasil tool selalu menyatakan kelengkapannya.
//   21 Agu 2026 — `read_file` menyatakannya sebagai BOOLEAN (`truncated:false`)
//                 → model tetap mengarang "Bagian 4-8 terpotong saat dibaca".
//                 Perbaikan: kalimat harfiah + larangan di catatan tool.
//   21 Agu 2026 — SESUDAH kalimat + larangan itu terpasang, model MASIH menulis
//                 "bagian tengah dokumen terpotong otomatis oleh sistem untuk
//                 menghemat context". Terverifikasi dari log: promptTokens 6.874,
//                 seluruh 248 baris file ikut terkirim, tidak ada pemangkasan
//                 riwayat sama sekali.
//
// Pelajarannya persis prinsip project ini: **perbaiki di kode, bukan di prompt.**
// Imbauan — sekeras apa pun kalimatnya — hanya menurunkan peluang; yang menutup
// adalah guard deterministik. Karena kita TAHU secara pasti apakah ada yang
// terpotong (dari hasil tool), kalimat yang mengklaim sebaliknya bisa dibuang
// tanpa menebak.
//
// Kenapa dibuang, bukan diulang seperti false-refusal: yang salah di sini bukan
// keseluruhan jawaban — ringkasannya benar dan berguna. Mengulang run berarti
// membayar satu giliran penuh untuk memperbaiki satu kalimat, dan model yang
// sama bisa menulisnya lagi.

/** Kata yang menandakan klaim "ada yang tidak terbaca". */
const KATA_POTONG =
  /\b(terpotong|dipotong|memotong|terpangkas|dipangkas|terpangkas|truncated|tidak terbaca|belum terbaca|tidak lengkap|sebagian hilang|dilewati)\b/i

/**
 * Penanda bahwa kalimat itu bicara tentang PROSES MEMBACA, bukan tentang isi
 * dokumen.
 *
 * Pembeda ini yang menjaga guard tidak kebablasan: dokumen sungguhan bisa saja
 * MEMBAHAS pemotongan ("anggaran dipotong 20%"), dan kalimat seperti itu tidak
 * boleh ikut hilang dari ringkasan.
 */
const KONTEKS_BACA =
  /\b(dokumen|file|berkas|isi|teks|bagian|halaman|context|konteks|sistem|dibaca|pembacaan|karakter|baris)\b/i

/** Kalimat/baris yang mengaku ada bagian dokumen yang tidak terbaca. */
export function adalahKlaimPemotongan(kalimat: string): boolean {
  return KATA_POTONG.test(kalimat) && KONTEKS_BACA.test(kalimat)
}

/** Apakah jawaban memuat klaim seperti itu di mana pun. */
export function adaKlaimPemotongan(teks: string): boolean {
  return pecahKalimat(teks).some(adalahKlaimPemotongan)
}

/**
 * Memecah teks jadi satuan yang aman dibuang: per baris dulu (supaya butir
 * daftar dan baris "⚠️ Catatan:" tidak menyeret paragraf lain), lalu per kalimat
 * di dalam baris.
 */
function pecahKalimat(teks: string): string[] {
  const hasil: string[] = []
  for (const baris of teks.split('\n')) {
    if (baris.trim().length === 0) continue
    for (const k of baris.split(/(?<=[.!?])\s+/)) {
      if (k.trim().length > 0) hasil.push(k)
    }
  }
  return hasil
}

/**
 * Membuang klaim pemotongan dari jawaban, dan merapikan sisanya.
 *
 * Dipakai HANYA bila hasil tool memang menyatakan tidak ada yang terpotong —
 * pemanggil yang memastikan itu. Kalau dokumennya memang terpotong sebagian,
 * kalimat model tentang itu BENAR dan harus dibiarkan.
 */
export function buangKlaimPemotongan(teks: string): { hasil: string; dibuang: string[] } {
  return buangKalimatYang(teks, adalahKlaimPemotongan)
}

/**
 * Mesin pembuangan kalimat — dipakai bersama oleh guard pemotongan dan guard
 * klaim-sudah-diuji (`verify-guard.ts`).
 *
 * ⚠️ Sengaja SATU definisi untuk dua guard. Aturan project yang sama sudah
 * dipakai untuk `memuatNilaiData` (CLAUDE.md 15): salinan kedua akan menyimpang
 * diam-diam, dan yang lebih longgar menang tanpa ada yang menyadarinya. Yang
 * berbeda antara kedua guard cuma predikatnya; perlakuan terhadap butir daftar,
 * baris yang habis dibuang, dan baris kosong bertumpuk harus identik.
 */
export function buangKalimatYang(
  teks: string,
  predikat: (kalimat: string) => boolean
): { hasil: string; dibuang: string[] } {
  const dibuang: string[] = []
  const barisBaru: string[] = []

  for (const baris of teks.split('\n')) {
    if (baris.trim().length === 0) {
      barisBaru.push(baris)
      continue
    }

    // Baris yang SELURUHNYA klaim (butir daftar, baris catatan) dibuang utuh.
    const kalimat = baris.split(/(?<=[.!?])\s+/).filter((k) => k.trim().length > 0)
    const sisa = kalimat.filter((k) => {
      if (predikat(k)) {
        dibuang.push(k.trim())
        return false
      }
      return true
    })

    // ⚠️ BARIS YANG TIDAK TERSENTUH DIKEMBALIKAN APA ADANYA — jangan disusun
    // ulang, jangan dinilai isinya.
    //
    // Dilaporkan user 21 Agu 2026: sebuah jawaban mode Master Data kehilangan
    // TABELNYA. Bukan tabelnya yang dibuang, melainkan baris PEMISAH markdown
    // (`|---|---|`) — ia tidak memuat satu pun huruf/angka, sehingga jatuh ke
    // pemeriksaan "tinggal tanda baca" di bawah. Tanpa baris pemisah, markdown
    // berhenti mengenalinya sebagai tabel dan 25 baris data menyatu jadi satu
    // paragraf panjang di layar.
    //
    // Pelajarannya: guard yang MEMBUANG kalimat tidak boleh menyentuh baris yang
    // tidak ada urusannya dengan kalimat itu. Pemeriksaan di bawah hanya masuk
    // akal untuk baris yang MEMANG kehilangan sesuatu — di situlah "⚠️ yatim"
    // bisa muncul. Baris utuh tidak pernah punya masalah itu.
    if (sisa.length === kalimat.length) {
      barisBaru.push(baris)
      continue
    }

    if (sisa.length === 0) continue

    // Kalau seluruh kalimat bermakna hilang dan yang tersisa cuma penanda daftar
    // atau tanda baca, buang barisnya sekalian — jangan tinggalkan "⚠️" sendirian.
    const gabung = sisa.join(' ')
    if (!/[a-zA-Z0-9]/.test(gabung)) continue
    barisBaru.push(gabung)
  }

  // Rapikan baris kosong bertumpuk yang muncul akibat pembuangan.
  const hasil = barisBaru.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return { hasil, dibuang }
}

/**
 * Apakah hasil-hasil tool pada giliran ini MEMANG menyatakan ada yang belum
 * terbaca.
 *
 * Dibaca dari keluaran tool apa adanya, bukan dari ingatan model: `lanjutkanDari`
 * yang tidak null, atau `truncated: true`. Selama tidak ada satu pun tanda itu,
 * klaim pemotongan apa pun dari model adalah karangan.
 */
export function toolMelaporkanPemotongan(hasilTool: readonly string[]): boolean {
  for (const h of hasilTool) {
    if (/"truncated"\s*:\s*true/.test(h)) return true
    if (/"lanjutkanDari"\s*:\s*(?!null)\d/.test(h)) return true
    if (/"halamanBelumTerbaca"\s*:\s*(?!null)\d/.test(h)) return true
  }
  return false
}
