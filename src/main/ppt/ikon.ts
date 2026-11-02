// Daftar ikon yang boleh dipakai di slide — DAFTAR TERTUTUP.
//
// Alasannya sama dengan alasan tool sales tidak menerima dimensi bebas: kalau
// model boleh menyebut nama ikon apa saja, nama yang tidak ada akan berakhir
// sebagai kotak kosong di slide — kegagalan yang tidak berbunyi dan baru
// ketahuan di ruang rapat. Dengan daftar tertutup, nama yang salah ditolak
// sebagai error yang bisa dibaca model, dan ia bisa memilih ulang.
//
// Namanya sengaja bahasa Indonesia: model diminta memilih dari kosakata yang
// sama dengan kosakata pertanyaan user.
//
// Sumber gambar: Lucide (lisensi ISC, boleh dipakai komersial). Berkas SVG-nya
// hanya dipakai SAAT BUILD oleh `scripts/buat-ikon.cjs`, yang mengubahnya jadi
// PNG di `resources/ikon`. Modul ini murni — tidak menyentuh berkas apa pun —
// supaya bisa diuji tanpa Electron.
//
// ⚠️ Ikon dikirim ke PowerPoint sebagai PNG, BUKAN SVG. Terukur 21 Agu 2026:
// pptxgenjs menerima SVG lalu menuliskan "fallback" PNG yang isinya justru byte
// SVG mentah. PowerPoint 365 selamat karena membaca `svgBlip`, tapi PowerPoint
// lama, LibreOffice, dan pratinjau Windows jatuh ke berkas PNG palsu itu dan
// menampilkan gambar rusak — tanpa pesan apa pun.

/** nama yang dipakai model -> nama berkas Lucide */
export const IKON: Record<string, string> = {
  // tren & angka
  'tren-naik': 'trending-up',
  'tren-turun': 'trending-down',
  'panah-naik': 'arrow-up-right',
  'panah-turun': 'arrow-down-right',
  'panah-kanan': 'arrow-right',
  persen: 'percent',
  target: 'target',
  'grafik-batang': 'chart-column',
  'grafik-garis': 'chart-line',
  'grafik-pai': 'chart-pie',
  ukuran: 'gauge',
  lapisan: 'layers',
  cabang: 'split',
  // uang
  uang: 'banknote',
  dompet: 'wallet',
  koin: 'coins',
  timbangan: 'scale',
  // orang & organisasi
  pelanggan: 'users',
  orang: 'user',
  tim: 'users-round',
  jabat_tangan: 'handshake',
  gedung: 'building-2',
  pabrik: 'factory',
  jaringan: 'network',
  // laboratorium & kesehatan
  laboratorium: 'flask-conical',
  mikroskop: 'microscope',
  'tabung-uji': 'test-tube',
  dna: 'dna',
  obat: 'pill',
  suntik: 'syringe',
  stetoskop: 'stethoscope',
  'rumah-sakit': 'hospital',
  denyut: 'heart-pulse',
  // waktu
  kalender: 'calendar',
  jam: 'clock',
  'jam-pasir': 'hourglass',
  pengatur_waktu: 'timer',
  // status
  peringatan: 'triangle-alert',
  info: 'info',
  centang: 'circle-check',
  silang: 'circle-x',
  bintang: 'star',
  piala: 'trophy',
  penghargaan: 'award',
  jempol: 'thumbs-up',
  // gagasan & proses
  ide: 'lightbulb',
  roket: 'rocket',
  petir: 'zap',
  proses: 'refresh-cw',
  aktivitas: 'activity',
  setelan: 'settings',
  kunci_pas: 'wrench',
  daftar: 'list-checks',
  kilau: 'sparkles',
  // dokumen & data
  dokumen: 'file-text',
  folder: 'folder',
  buku: 'book-open',
  papan: 'clipboard-list',
  pencarian: 'search',
  database: 'database',
  server: 'server',
  tautan: 'link',
  // komunikasi & tempat
  surat: 'mail',
  telepon: 'phone',
  pesan: 'message-square-text',
  lokasi: 'map-pin',
  global: 'globe',
  // keamanan & logistik
  gembok: 'lock',
  perisai: 'shield-check',
  truk: 'truck',
  kotak: 'package'
}

export type WarnaIkon = 'hijau' | 'putih'

export const NAMA_IKON = Object.keys(IKON).sort()

/**
 * Contoh yang ikut di deskripsi tool.
 *
 * Deskripsi tool dikirim ulang ke model SETIAP giliran dan gateway belum
 * mengaktifkan `--enable-prefix-caching`, jadi seluruh daftar 71 nama (646
 * karakter) akan jadi biaya berulang. Yang dikirim cukup contoh yang mewakili
 * tiap kelompok; nama yang meleset ditolak `pastikanIkon` sambil menyarankan
 * yang mirip, jadi harganya satu kali percobaan — bukan slide yang salah.
 */
export const IKON_CONTOH = [
  'tren-naik',
  'tren-turun',
  'target',
  'uang',
  'pelanggan',
  'gedung',
  'laboratorium',
  'kalender',
  'peringatan',
  'centang',
  'ide',
  'dokumen',
  'grafik-batang',
  'piala'
]

/** Nama berkas PNG hasil `scripts/buat-ikon.cjs`. */
export function berkasIkon(nama: string, warna: WarnaIkon): string {
  return `${IKON[nama] ?? nama}-${warna}.png`
}

/** Nama ikon yang mirip — supaya pesan error menuntun, bukan sekadar menolak. */
export function ikonMirip(nama: string, maks = 6): string[] {
  const q = nama.toLowerCase().replace(/[_\s]/g, '-')
  const cocok = NAMA_IKON.filter((n) => n.includes(q) || q.includes(n))
  if (cocok.length) return cocok.slice(0, maks)
  const awal = q.slice(0, 3)
  return NAMA_IKON.filter((n) => n.startsWith(awal)).slice(0, maks)
}
