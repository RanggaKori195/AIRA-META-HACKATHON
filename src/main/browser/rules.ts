import { ToolError } from '../tools/types'

/**
 * Pesan galat untuk keadaan browser. Dipisahkan dari `session.ts` karena
 * `session.ts` mengimpor `electron` dan tidak bisa disentuh unit test.
 *
 * ⚠️ SEMUANYA WAJIB `ToolError`, bukan `Error` biasa.
 *
 * `executeToolCall` (orchestrator) hanya meneruskan pesan dari `ToolError` dan
 * `BoundaryError`; galat jenis lain diganti jadi `"tool gagal dijalankan"` dan
 * dicatat sebagai `tool crashed`. Akibatnya nyata dan sudah terjadi: saat user
 * menutup jendela browser, `browser_read`/`browser_click` melempar `Error`
 * biasa, model hanya diberi tahu "gagal" tanpa sebab maupun jalan keluar, lalu
 * mencoba lagi sampai batas 5 panggilan per tool dan 24 iterasi — satu sampai
 * tiga menit tanpa apa pun di layar, tak bisa dibedakan dari menggantung.
 * Terekam di `aira.log` 16 Agu 2026 (dua kali), terlihat lagi saat demo 26 Agu.
 *
 * ⚠️ Pesannya WAJIB menyebut TIGA hal secara harfiah: apa yang terjadi, apa
 * akibatnya pada isi halaman, dan langkah berikutnya beserta NAMA TOOL-nya.
 * Ini pelajaran yang sama dengan `catatanHasil` di `pdf-paging.ts`: model 27B
 * terbukti tidak menyimpulkan langkah pemulihan sendiri, dan kekosongan
 * informasi diisinya dengan karangan.
 */

/**
 * Penolakan yang DISENGAJA, bukan kegagalan teknis.
 *
 * ⚠️ Dibedakan supaya `browser_open` tidak menelannya. Tool itu mencoba
 * beberapa varian URL dan mengumpulkan kegagalan tiap varian jadi satu pesan
 * ringkas ("tidak ada URL yang berhasil dibuka. Percobaan: …"). Kalau
 * penolakan ini ikut masuk ke sana, alasan sebenarnya — user menutup
 * jendelanya — hilang di balik daftar percobaan, dan model kembali menyimpulkan
 * gangguan jaringan. Persis kekeliruan yang sudah terjadi 26 Agu 2026.
 */
export class BrowserRefusal extends ToolError {}

/**
 * Kunci pembanding "ini situs yang sama". Hanya hostname, tanpa `www.`.
 *
 * Model mencoba varian yang berbeda-beda untuk situs yang sama —
 * `www.detik.com` lalu `detik.com` — dan `candidateUrls` sendiri sengaja
 * membuat varian itu. Membandingkan URL utuh berarti penolakannya bisa
 * dilangkahi hanya dengan membuang "www", persis yang dilakukan model di
 * lapangan 27 Agu 2026.
 */
export function kunciSitus(url: string): string {
  try {
    const host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase()
    return host.startsWith('www.') ? host.slice(4) : host
  } catch {
    return url.trim().toLowerCase()
  }
}

/** Belum pernah ada jendela browser sepanjang sesi ini. */
export function galatBelumDibuka(): ToolError {
  return new ToolError(
    'jendela browser AIRA belum pernah dibuka di percakapan ini, jadi tidak ada halaman ' +
      'yang bisa dibaca, diklik, atau diisi. Panggil browser_open dengan URL yang dituju lebih dulu.'
  )
}

/**
 * Jendela sempat terbuka lalu hilang — hampir selalu karena USER menutupnya.
 * Dibedakan dari "belum pernah dibuka" dengan sengaja: dua keadaan itu menuntut
 * langkah berbeda, dan menyamakannya membuat model menebak.
 */
export function galatDitutup(urlTerakhir = ''): ToolError {
  const halaman = urlTerakhir ? ` Halaman terakhir yang terbuka: ${urlTerakhir}.` : ''
  return new ToolError(
    'jendela browser AIRA DITUTUP OLEH USER, jadi tidak ada halaman yang bisa dibaca, ' +
      'diklik, atau diisi.' +
      halaman +
      ' Isi halaman itu TIDAK tersimpan dan tidak bisa diambil lagi.' +
      ' Menutup jendela adalah tindakan SENGAJA — artinya user sudah selesai dengan halaman itu. ' +
      'JANGAN membukanya ulang dan JANGAN memanggil tool browser lain di jawaban ini. ' +
      'Katakan apa adanya bahwa halamannya sudah dibuka lalu ditutup, dan tawarkan membuka lagi ' +
      'HANYA sebagai pertanyaan. Jangan menjawab seolah halamannya masih terbaca, dan jangan ' +
      'menyalahkan jaringan atau menuduh user menolak izin.'
  )
}

/**
 * User menutup jendela untuk alamat ini pada giliran yang SAMA, lalu model
 * mencoba membukanya lagi.
 *
 * ⚠️ Ini bukan kehati-hatian berlebihan — terjadi 27 Agu 2026 dan terekam di
 * log: user menutup jendela detik.com, model membukanya lagi, user menutup
 * lagi, model minta izin membuka untuk KETIGA kalinya. Tiga popup izin untuk
 * satu kalimat "buka detik.com", dan jendela yang terus muncul kembali sesudah
 * ditutup. Dari sisi user itu aplikasi yang melawan.
 *
 * Penyebabnya pesan galat versi pertama yang berbunyi "panggil browser_open
 * dengan URL-nya lagi" — imbauan sopan yang justru menyuruh model mengulang.
 * Pelajaran project: yang menahan bukan kalimat di prompt, melainkan penolakan
 * di level tool.
 */
export function galatJanganBukaUlang(url: string): BrowserRefusal {
  return new BrowserRefusal(
    `user sudah MENUTUP jendela browser untuk ${url} pada giliran ini, jadi membukanya lagi ` +
      'sekarang akan memunculkan jendela yang baru saja ia tutup. Permintaan ini DITOLAK dengan ' +
      'sengaja. Hentikan pemakaian tool browser, sampaikan bahwa halaman sudah sempat dibuka ' +
      'lalu ditutup user, dan tanyakan lebih dulu bila ia memang ingin dibuka lagi.'
  )
}

/** Jendela ditutup saat halaman masih dimuat. */
export function galatDitutupSaatMemuat(url: string): ToolError {
  return new ToolError(
    `jendela browser ditutup sebelum ${url} selesai dimuat, jadi halamannya tidak pernah terbaca. ` +
      'Panggil browser_open lagi bila halaman itu masih dibutuhkan; kalau tidak, sampaikan ke user ' +
      'bahwa pembukaan halaman dibatalkan.'
  )
}

export function galatNavigasiTimeout(url: string, detik: number): ToolError {
  return new ToolError(
    `${url} tidak selesai dimuat dalam ${detik} detik. Halaman mungkin berat atau tidak terjangkau ` +
      'dari jaringan ini. Jangan mengarang isinya — laporkan ke user bahwa halamannya tidak terbuka.'
  )
}

/**
 * Navigasi benar-benar gagal — halamannya TIDAK pernah ter-commit.
 *
 * ⚠️ Hanya dipakai sesudah dipastikan tidak ada navigasi yang berhasil. Lihat
 * catatan panjang di `navigate()`: `loadURL()` juga menolak untuk halaman yang
 * sebenarnya terbuka dengan baik.
 */
export function galatNavigasiGagal(url: string, sebab: string): ToolError {
  return new ToolError(
    `${url} tidak bisa dibuka: ${sebab}. Halaman tidak pernah termuat, jadi tidak ada isi ` +
      'yang bisa dibaca. Jangan mengarang isinya — laporkan apa adanya ke user.'
  )
}

export function galatUrlTidakSah(url: string): ToolError {
  return new ToolError(
    `URL "${url}" tidak sah — harus diawali http:// atau https://.`
  )
}
