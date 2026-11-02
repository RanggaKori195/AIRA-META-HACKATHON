import { MAKS_PANJANG } from './rules'

// Lapis 4: memori yang DISIMPULKAN AIRA dari percakapan, bukan diminta user.
//
// ⚠️ Ini satu-satunya bagian memori yang ISINYA diputuskan model. Semua lapis
// sebelumnya dipicu kalimat user yang dibaca kode. Karena itu seluruh modul ini
// dibangun dengan asumsi bahwa modelnya AKAN salah: keluarannya diperlakukan
// sebagai usulan mentah yang harus lolos saringan di sini, bukan sebagai fakta.
//
// Modul MURNI — prompt, penguraian, dan penyaringan bisa diuji tanpa jaringan.

/** Berapa memori otomatis yang boleh hidup bersamaan. */
export const MAKS_OTOMATIS = 8

/** Maksimal usulan yang diminta dari model dalam satu kali ekstraksi. */
export const MAKS_USULAN = 3

/**
 * Berapa pesan user baru yang harus terkumpul sebelum ekstraksi dijalankan lagi.
 *
 * ⚠️ Bukan tiap giliran. `--enable-prefix-caching` belum aktif di gateway, dan
 * ekstraksi adalah panggilan LLM TAMBAHAN di luar percakapan — menjalankannya
 * tiap pesan berarti melipatgandakan beban gateway yang sama yang sedang
 * melayani seluruh pemakai AIRA, demi fakta tentang orang yang berubah beberapa
 * kali setahun.
 */
export const JEDA_PESAN = 6

/** Paling banyak sekian pesan user terakhir yang dibaca sekali ekstraksi. */
export const MAKS_PESAN_DIBACA = 20

/**
 * Kalimat yang menggambarkan PERCAKAPAN, bukan ORANGNYA.
 *
 * Ini kesalahan yang paling sering dibuat model saat diminta meringkas: alih-alih
 * "bertanggung jawab atas produk Genomics", ia menulis "user menanyakan data
 * penjualan bulan ini". Kalimat seperti itu benar sebagai ringkasan tapi tidak
 * ada gunanya sebagai memori — ia akan disuntikkan ke setiap percakapan
 * berikutnya sebagai kebenaran tentang orangnya, padahal itu cuma satu
 * pertanyaan yang kebetulan pernah diajukan.
 */
const TENTANG_PERCAKAPAN =
  /\b(bertanya|menanyakan|nanya|minta|meminta|memerintahkan|menyuruh|ingin tahu|penasaran|membuka|mengetik|mengirim|melampirkan|meminta bantuan)\b/i

/**
 * Kata yang menandakan fakta ini akan BASI.
 *
 * Memori tidak punya tanggal kedaluwarsa dan ikut ke system prompt
 * berbulan-bulan kemudian. "Sedang mengerjakan laporan Agustus" akan tetap
 * disebut AIRA di bulan Desember sebagai keadaan yang masih berlaku.
 */
const SEMENTARA =
  /\b(hari ini|kemarin|besok|tadi|sekarang sedang|minggu ini|bulan ini|sedang mengerjakan|lagi bikin|baru saja)\b/i

/** Kalimat kosong yang tidak menerangkan apa pun. */
const HAMPA =
  /^(user|pengguna)?\s*(adalah\s+)?(user|pengguna|orang|karyawan|staf|pegawai)\b.{0,20}$/i

export interface HasilSaring {
  diterima: string[]
  /** Usulan yang dibuang beserta alasannya — untuk log, supaya bisa ditelusuri. */
  ditolak: Array<{ isi: string; alasan: string }>
}

/**
 * Pesan-pesan yang dibaca saat ekstraksi.
 *
 * ⚠️ HANYA pesan USER, tidak pernah jawaban AIRA maupun hasil tool. Di jawaban
 * AIRA-lah nilai data berada — nett, nama pelanggan, isi dokumen, hasil
 * pemeriksaan pasien. Membacanya berarti mengundang persis hal yang dilarang
 * masuk memori, dan mengandalkan saringan kata untuk menahannya. Membatasi
 * sumbernya jauh lebih kuat daripada menyaring akibatnya.
 */
export function pesanUntukEkstraksi(
  pesan: ReadonlyArray<{ role: string; content: string }>
): string[] {
  return pesan
    .filter((p) => p.role === 'user' && p.content.trim().length > 0)
    .map((p) => p.content.trim().slice(0, 600))
    .slice(-MAKS_PESAN_DIBACA)
}

export function promptEkstraksi(pesanUser: readonly string[], sudahAda: readonly string[]): string {
  const daftar = pesanUser.map((p, i) => `${i + 1}. ${p}`).join('\n')
  const diingat =
    sudahAda.length > 0
      ? `\nYang SUDAH diingat (jangan diulang, jangan ditulis ulang dengan kata lain):\n${sudahAda
          .map((m) => `- ${m}`)
          .join('\n')}\n`
      : ''
  return (
    'Kamu membaca pesan-pesan seseorang di aplikasi kerja, dan tugasmu HANYA satu: menemukan ' +
    'fakta yang TETAP tentang ORANG itu — yang masih benar berbulan-bulan lagi.\n\n' +
    'Contoh yang BOLEH: peran atau tanggung jawabnya, produk/wilayah/divisi yang ia pegang, ' +
    'cara ia ingin dijawab (mis. selalu pakai tabel), istilah yang ia pakai.\n' +
    'Contoh yang DILARANG:\n' +
    '- apa pun yang ia TANYAKAN ("user menanyakan penjualan") — itu percakapan, bukan orangnya\n' +
    '- angka, nominal, nama pasien, hasil pemeriksaan, isi dokumen\n' +
    '- hal sementara ("sedang mengerjakan laporan Agustus")\n' +
    '- tebakan. Kalau tidak dinyatakan sendiri oleh orangnya, JANGAN ditulis.\n' +
    diingat +
    `\nPesan-pesannya:\n${daftar}\n\n` +
    `Jawab HANYA dengan array JSON berisi maksimal ${MAKS_USULAN} kalimat pendek ` +
    `(masing-masing di bawah ${MAKS_PANJANG} karakter), tanpa penjelasan apa pun. ` +
    'Kalau tidak ada yang layak diingat — dan itu WAJAR serta sering terjadi — jawab: []'
  )
}

/**
 * Menguraikan jawaban model.
 *
 * Sengaja pemaaf: model 27B kerap membungkus JSON dengan ```json, menambah
 * kalimat pengantar, atau menjawab dengan daftar bertanda hubung. Menolak
 * semuanya berarti fitur ini mati diam-diam di lapangan sementara di meja kita
 * tampak bekerja. Yang TIDAK dipaafkan adalah isinya — itu urusan `saringUsulan`.
 */
export function parseUsulan(raw: string): string[] {
  const teks = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()

  const mulai = teks.indexOf('[')
  const akhir = teks.lastIndexOf(']')
  if (mulai >= 0 && akhir > mulai) {
    try {
      const nilai = JSON.parse(teks.slice(mulai, akhir + 1))
      if (Array.isArray(nilai)) {
        return nilai.filter((v): v is string => typeof v === 'string').map((v) => v.trim())
      }
    } catch {
      /* jatuh ke penguraian baris di bawah */
    }
  }

  return teks
    .split(/\r?\n/)
    .map((b) => b.replace(/^\s*[-*•]\s*/, '').replace(/^\s*\d+[.)]\s*/, '').trim())
    .map((b) => b.replace(/^["']|["'],?$/g, '').trim())
    .filter((b) => b.length > 0 && !/^(json|berikut|hasil|catatan)\b/i.test(b))
}

/**
 * Saringan terakhir sebelum usulan model boleh jadi memori.
 *
 * `tolakNilaiData` disuntikkan dari luar (`deteksiPermintaanIngat` di
 * `rules.ts` memakai aturan yang sama) supaya larangan menyimpan angka hanya
 * punya SATU definisi. Kalau disalin ke sini, dua jalur memori bisa berbeda
 * diam-diam — dan yang longgar akan menang tanpa ada yang tahu.
 */
export function saringUsulan(
  usulan: readonly string[],
  sudahAda: readonly string[],
  tolakNilaiData: (teks: string) => boolean
): HasilSaring {
  const diterima: string[] = []
  const ditolak: Array<{ isi: string; alasan: string }> = []
  const adaRendah = sudahAda.map((m) => m.toLowerCase())

  for (const mentah of usulan) {
    const isi = mentah.replace(/\s+/g, ' ').replace(/[.!]+$/, '').trim()

    if (isi.length < 8) {
      ditolak.push({ isi, alasan: 'terlalu pendek' })
      continue
    }
    if (isi.length > MAKS_PANJANG) {
      ditolak.push({ isi, alasan: 'terlalu panjang' })
      continue
    }
    if (tolakNilaiData(isi)) {
      ditolak.push({ isi, alasan: 'memuat nilai data' })
      continue
    }
    if (TENTANG_PERCAKAPAN.test(isi)) {
      ditolak.push({ isi, alasan: 'menggambarkan percakapan, bukan orangnya' })
      continue
    }
    if (SEMENTARA.test(isi)) {
      ditolak.push({ isi, alasan: 'fakta sementara, akan basi' })
      continue
    }
    if (HAMPA.test(isi)) {
      ditolak.push({ isi, alasan: 'tidak menerangkan apa pun' })
      continue
    }

    const rendah = isi.toLowerCase()
    // Duplikat termasuk yang saling memuat: "pegang produk Genomics" vs
    // "user pegang produk Genomics" adalah hal yang sama, dan menyimpan
    // keduanya berarti mengirim kalimat kembar ke model tiap giliran.
    const kembar =
      adaRendah.some((m) => m === rendah || m.includes(rendah) || rendah.includes(m)) ||
      diterima.some((d) => d.toLowerCase() === rendah)
    if (kembar) {
      ditolak.push({ isi, alasan: 'sudah diingat' })
      continue
    }

    diterima.push(isi)
    if (diterima.length >= MAKS_USULAN) break
  }

  return { diterima, ditolak }
}
