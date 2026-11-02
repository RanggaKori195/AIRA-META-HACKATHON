// Aturan waktu menu "Jadwal" yang dipakai BERSAMA main process (penjadwal) dan
// renderer (kalender, agenda, "Tugas Mendatang"). SATU definisi: kalender yang
// menghitung tanggal dengan rumus berbeda dari penjadwal akan menampilkan tugas
// di hari yang salah — dan layar itulah yang dipercaya orang.
//
// Murni: tidak menyentuh Electron, SQLite, maupun DOM. Semua jam = waktu LOKAL
// laptop, karena "jam 08.00" yang diketik user berarti jam dinding di mejanya.

import type { ChatMode, PolaJadwal } from './ipc'

export const NAMA_HARI = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const JAM = /^([01]\d|2[0-3]):([0-5]\d)$/
const TANGGAL = /^(\d{4})-(\d{2})-(\d{2})$/

/** `[jam, menit]` atau null bila bentuknya tidak sah. */
export function bacaJam(jam: string): [number, number] | null {
  const m = JAM.exec(jam)
  return m ? [Number(m[1]), Number(m[2])] : null
}

/** Tanggal `YYYY-MM-DD` yang benar-benar ada di kalender, atau null. */
export function bacaTanggal(tanggal: string): Date | null {
  const m = TANGGAL.exec(tanggal)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.getMonth() === Number(m[2]) - 1 ? d : null
}

function padaJam(hari: Date, jam: string): Date {
  const [h, m] = bacaJam(jam) ?? [0, 0]
  return new Date(hari.getFullYear(), hari.getMonth(), hari.getDate(), h, m, 0, 0)
}

function hariTerakhirBulan(tahun: number, bulan: number): number {
  return new Date(tahun, bulan + 1, 0).getDate()
}

/**
 * Waktu jalan BERIKUTNYA yang lebih BESAR dari `setelah` (bukan sama dengan —
 * kalau tidak, tugas yang barusan jalan pada menit itu dijadwalkan ke menit yang
 * sama lagi dan berputar). `null` = tidak ada lagi.
 *
 * Bulanan tanggal 29–31 di bulan yang lebih pendek jatuh ke HARI TERAKHIR bulan
 * itu — "tiap tanggal 31" yang diam-diam melompati Februari terlihat seperti
 * tugas yang mati.
 */
export function berikutnya(pola: PolaJadwal, setelah: Date): Date | null {
  if (pola.jenis === 'sekali') {
    const d = bacaTanggal(pola.tanggal)
    if (!d) return null
    const t = padaJam(d, pola.jam)
    return t.getTime() > setelah.getTime() ? t : null
  }

  if (pola.jenis === 'bulanan') {
    for (let i = 0; i < 3; i++) {
      const tahun = setelah.getFullYear()
      const bulan = setelah.getMonth() + i
      const tgl = Math.min(pola.tanggal, hariTerakhirBulan(tahun, bulan))
      const t = padaJam(new Date(tahun, bulan, tgl), pola.jam)
      if (t.getTime() > setelah.getTime()) return t
    }
    return null
  }

  // Harian / hari kerja / mingguan: 8 hari ke depan cukup untuk pola mingguan mana pun.
  for (let i = 0; i < 8; i++) {
    const hari = new Date(setelah.getFullYear(), setelah.getMonth(), setelah.getDate() + i)
    const t = padaJam(hari, pola.jam)
    if (t.getTime() <= setelah.getTime()) continue
    const dow = t.getDay()
    if (pola.jenis === 'harian') return t
    if (pola.jenis === 'hari_kerja' && dow >= 1 && dow <= 5) return t
    if (pola.jenis === 'mingguan' && pola.hari.includes(dow)) return t
  }
  return null
}

/**
 * Semua waktu jalan dalam rentang `[dari, sampai)`, paling banyak `maks`.
 * Dipakai kalender & daftar mendatang; berbasis `berikutnya` supaya aturannya
 * tidak pernah menyimpang dari penjadwal.
 */
export function kejadianDalam(pola: PolaJadwal, dari: Date, sampai: Date, maks = 200): Date[] {
  const hasil: Date[] = []
  let t = berikutnya(pola, new Date(dari.getTime() - 1))
  while (t && t.getTime() < sampai.getTime() && hasil.length < maks) {
    hasil.push(t)
    t = berikutnya(pola, t)
  }
  return hasil
}

/** Kalimat pola untuk layar, mis. "Every Monday & Thursday, 08:00". */
export function uraianPola(pola: PolaJadwal): string {
  switch (pola.jenis) {
    case 'sekali':
      return 'Once, ' + pola.tanggal.split('-').reverse().join('/') + ' ' + pola.jam
    case 'harian':
      return 'Every day, ' + pola.jam
    case 'hari_kerja':
      return 'Every weekday (Mon–Fri), ' + pola.jam
    case 'mingguan':
      return 'Every ' + pola.hari.map((h) => NAMA_HARI[h]).join(' & ') + ', ' + pola.jam
    case 'bulanan':
      return 'Every month on day ' + pola.tanggal + (pola.tanggal > 28 ? ' (or the last day of the month)' : '') + ', ' + pola.jam
  }
}

// ------------------------------------------------------------------ "Minta AIRA menjadwalkan"

export interface TafsiranJadwal {
  nama: string
  prompt: string
  jenis: 'aira' | 'pengingat'
  mode: ChatMode
  /** null = kalimatnya tidak menyebut kapan; user memilih sendiri di form. */
  pola: PolaJadwal | null
}

const HARI_KATA: Record<string, number> = {
  minggu: 0,
  ahad: 0,
  senin: 1,
  selasa: 2,
  rabu: 3,
  kamis: 4,
  jumat: 5,
  "jum'at": 5,
  sabtu: 6
}

const dua = (n: number): string => String(n).padStart(2, '0')
const isoTanggal = (d: Date): string => `${d.getFullYear()}-${dua(d.getMonth() + 1)}-${dua(d.getDate())}`

/**
 * Membaca kalimat bebas ("ingatkan saya setiap Senin jam 8 untuk cek data sales")
 * menjadi isian form jadwal.
 *
 * ⚠️ Dibaca oleh KODE, bukan model (pola aturan "perbaiki di kode"): model 27B
 * yang salah menangkap "tanggal 1" sebagai "hari Senin" menghasilkan tugas yang
 * jalan di hari yang salah TANPA ada yang sadar. Hasilnya HANYA MENGISI form —
 * user melihat dan menekan Simpan sendiri. Yang tidak dikenali dibiarkan kosong
 * (`pola: null`), tidak ditebak.
 */
export function tafsirkanKalimat(teks: string, sekarang: Date): TafsiranJadwal {
  const asli = teks.trim().replace(/\s+/g, ' ')
  const k = asli.toLowerCase()
  let sisa = asli

  const buang = (re: RegExp): void => {
    sisa = sisa.replace(re, ' ')
  }

  // --- jam
  let jam = '08:00'
  let adaJam = false
  const mJam = /\b(?:jam|pukul)\s*(\d{1,2})(?:[.:](\d{2}))?\s*(pagi|siang|sore|malam)?/i.exec(asli)
  if (mJam) {
    let h = Number(mJam[1])
    const mnt = Number(mJam[2] ?? 0)
    const bag = mJam[3]?.toLowerCase()
    if ((bag === 'sore' || bag === 'malam') && h < 12) h += 12
    if (bag === 'siang' && h < 11) h += 12
    if (h <= 23 && mnt <= 59) {
      jam = `${dua(h)}:${dua(mnt)}`
      adaJam = true
    }
    buang(mJam[0] ? new RegExp(mJam[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : /$^/)
  }
  // English: "at 8", "at 7:30", "at 4 pm", "9am".
  const mJamEn = adaJam
    ? null
    : /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b|\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(asli)
  if (mJamEn) {
    let h = Number(mJamEn[1] ?? mJamEn[4])
    const mnt = Number(mJamEn[2] ?? mJamEn[5] ?? 0)
    const ap = (mJamEn[3] ?? mJamEn[6])?.toLowerCase()
    if (ap === 'pm' && h < 12) h += 12
    if (ap === 'am' && h === 12) h = 0
    if (h <= 23 && mnt <= 59) {
      jam = `${dua(h)}:${dua(mnt)}`
      adaJam = true
    }
    buang(new RegExp(mJamEn[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
  }
  if (!adaJam) {
    const bagian: Array<[RegExp, string]> = [
      [/\bmorning\b/i, '08:00'],
      [/\b(noon|midday)\b/i, '12:00'],
      [/\bafternoon\b/i, '16:00'],
      [/\b(evening|night)\b/i, '19:00'],
      [/\bpagi\b/i, '08:00'],
      [/\bsiang\b/i, '12:00'],
      [/\bsore\b/i, '16:00'],
      [/\bmalam\b/i, '19:00']
    ]
    for (const [re, j] of bagian) {
      if (re.test(asli)) {
        jam = j
        // Kata waktu itu sudah dipakai sebagai JAM — jangan ikut ke isi tugas.
        buang(re)
        break
      }
    }
  }

  // --- pola
  let pola: PolaJadwal | null = null
  const mTgl = /\b(?:setiap|tiap)\s+tanggal\s+(\d{1,2})\b/i.exec(asli)
  // Hari HANYA diambil dari frasa "setiap/tiap <hari>[, dan <hari>]" itu sendiri —
  // "ringkasan minggu lalu" bukan hari Minggu.
  const reDaftarHari =
    /\b(?:setiap|tiap)\s+(?:hari\s+)?((?:minggu|ahad|senin|selasa|rabu|kamis|jumat|jum'at|sabtu)(?:\s*(?:,|dan|&)\s*(?:minggu|ahad|senin|selasa|rabu|kamis|jumat|jum'at|sabtu))*)\b/i
  const mDaftar = reDaftarHari.exec(asli)
  // English: "every Monday", "every Monday and Thursday", "on the 1st of every month". "last week" is not a day.
  const HARI_EN = 'sunday|monday|tuesday|wednesday|thursday|friday|saturday'
  const reDaftarHariEn = new RegExp(`\\bevery\\s+((?:${HARI_EN})(?:\\s*(?:,|and|&)\\s*(?:${HARI_EN}))*)\\b`, 'i')
  const mDaftarEn = reDaftarHariEn.exec(asli)
  const mTglEn =
    /\b(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\s+of\s+(?:every|each)\s+month\b|\bevery\s+month\s+on\s+the\s+(\d{1,2})(?:st|nd|rd|th)?\b/i.exec(
      asli
    )
  const tglEn = mTglEn ? Number(mTglEn[1] ?? mTglEn[2]) : 0
  const hariDisebut = mDaftar
    ? [...mDaftar[1].toLowerCase().matchAll(/minggu|ahad|senin|selasa|rabu|kamis|jumat|jum'at|sabtu/g)].map(
        (m) => HARI_KATA[m[0]]
      )
    : []
  if (mTglEn && tglEn >= 1 && tglEn <= 31) {
    pola = { jenis: 'bulanan', tanggal: tglEn, jam }
    buang(new RegExp(mTglEn[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
  } else if (/\bend\s+of\s+(?:the\s+|every\s+|each\s+)?month\b/i.test(asli)) {
    pola = { jenis: 'bulanan', tanggal: 31, jam }
    buang(/\b(?:at\s+the\s+|on\s+the\s+)?end\s+of\s+(?:the\s+|every\s+|each\s+)?month\b/i)
  } else if (/\b(?:start|beginning)\s+of\s+(?:the\s+|every\s+|each\s+)?month\b|\b(?:every|each)\s+month\b|\bmonthly\b/i.test(asli)) {
    pola = { jenis: 'bulanan', tanggal: 1, jam }
    buang(/\b(?:at\s+the\s+)?(?:(?:start|beginning)\s+of\s+(?:the\s+|every\s+|each\s+)?month|(?:every|each)\s+month|monthly)\b/i)
  } else if (/\b(?:every\s+)?weekdays?\b|\bmonday\s+(?:to|through|-)\s+friday\b/i.test(asli)) {
    pola = { jenis: 'hari_kerja', jam }
    buang(/\b(?:every\s+)?(?:weekdays?|monday\s+(?:to|through|-)\s+friday)\b/i)
  } else if (mDaftarEn) {
    const nama = HARI_EN.split('|')
    const hari = [...new Set([...mDaftarEn[1].toLowerCase().matchAll(new RegExp(HARI_EN, 'g'))].map((m) => nama.indexOf(m[0])))]
    pola = { jenis: 'mingguan', hari: hari.sort((a, b) => a - b), jam }
    buang(reDaftarHariEn)
  } else if (/\b(?:every|each)\s+week\b|\bweekly\b/i.test(asli)) {
    pola = { jenis: 'mingguan', hari: [1], jam }
    buang(/\b(?:every|each)\s+week\b|\bweekly\b/i)
  } else if (/\b(?:every|each)\s+(?:day|morning|afternoon|evening|night)\b|\bdaily\b/i.test(asli)) {
    pola = { jenis: 'harian', jam }
    buang(/\b(?:every|each)\s+day\b|\bdaily\b/i)
  } else if (/\btomorrow\b|\btoday\b/i.test(asli)) {
    const tambah = /\bday\s+after\s+tomorrow\b/i.test(asli) ? 2 : /\btomorrow\b/i.test(asli) ? 1 : 0
    const d = new Date(sekarang.getFullYear(), sekarang.getMonth(), sekarang.getDate() + tambah)
    pola = { jenis: 'sekali', tanggal: isoTanggal(d), jam }
    buang(/\b(?:the\s+day\s+after\s+tomorrow|tomorrow|today)\b/i)
  } else if (mTgl && Number(mTgl[1]) >= 1 && Number(mTgl[1]) <= 31) {
    pola = { jenis: 'bulanan', tanggal: Number(mTgl[1]), jam }
    buang(/\b(?:setiap|tiap)\s+tanggal\s+\d{1,2}(?:\s+(?:setiap|tiap)\s+bulan)?\b/i)
  } else if (/\bakhir\s+bulan\b/i.test(asli)) {
    pola = { jenis: 'bulanan', tanggal: 31, jam }
    buang(/\b(?:setiap|tiap)?\s*akhir\s+bulan\b/i)
  } else if (/\bawal\s+bulan\b/i.test(asli) || /\b(?:setiap|tiap)\s+bulan\b/i.test(asli)) {
    pola = { jenis: 'bulanan', tanggal: 1, jam }
    buang(/\b(?:setiap|tiap)?\s*(?:awal\s+)?bulan\b/i)
  } else if (/\bhari\s+kerja\b|\bsenin\s*(?:sampai|s\.?d\.?|-|hingga)\s*jum'?at\b/i.test(asli)) {
    pola = { jenis: 'hari_kerja', jam }
    buang(/\b(?:setiap|tiap)?\s*(?:hari\s+kerja|senin\s*(?:sampai|s\.?d\.?|-|hingga)\s*jum'?at)\b/i)
  } else if (mDaftar) {
    // "setiap minggu" tanpa nama hari lain = MINGGUAN (bukan hari Minggu) — itu
    // makna yang dipakai orang; jatuhnya Senin, dan terlihat di form.
    const hanyaMinggu = mDaftar[1].trim().toLowerCase() === 'minggu' && !/\bhari\s+minggu\b/i.test(mDaftar[0])
    const hari = hanyaMinggu ? [1] : [...new Set(hariDisebut)].sort((a, b) => a - b)
    pola = { jenis: 'mingguan', hari, jam }
    buang(reDaftarHari)
  } else if (/\b(?:setiap|tiap)\s+(?:hari|pagi|siang|sore|malam)\b|\bharian\b/i.test(asli)) {
    pola = { jenis: 'harian', jam }
    buang(/\b(?:setiap|tiap)\s+hari\b|\bharian\b/i)
  } else if (/\bbesok\b|\blusa\b|\bhari\s+ini\b|\bnanti\b/i.test(asli)) {
    const tambah = /\blusa\b/i.test(asli) ? 2 : /\bbesok\b/i.test(asli) ? 1 : 0
    const d = new Date(sekarang.getFullYear(), sekarang.getMonth(), sekarang.getDate() + tambah)
    pola = { jenis: 'sekali', tanggal: isoTanggal(d), jam }
    buang(/\b(?:besok|lusa|hari\s+ini|nanti)\b/i)
  }
  buang(/\b(?:setiap|tiap)\s+(?:pagi|siang|sore|malam)\b/gi)
  buang(/\b(?:pagi|siang|sore|malam)\s+hari\b/gi)

  // --- jenis & isi
  const pengingat = /\b(ingatkan|pengingat|reminder|remind)\b/i.test(asli)
  buang(/\b(?:tolong\s+)?(?:buat(?:kan)?\s+)?(?:pengingat|reminder)\b/i)
  buang(/\b(?:tolong\s+)?ingatkan\s+(?:saya|aku|kami)?\s*(?:untuk|agar|supaya)?\b/i)
  buang(/\b(?:tolong\s+)?(?:jadwalkan|jadwal)\b/i)
  buang(/\b(?:please\s+)?(?:set\s+(?:up\s+)?a\s+)?reminder\b/i)
  buang(/\b(?:please\s+)?remind\s+(?:me|us)?\s*(?:to|about)?\b/i)
  buang(/\b(?:please\s+)?schedule\b/i)
  buang(/\b(?:every|each)\s+(?:morning|afternoon|evening|night)\b/gi)
  const prompt = sisa
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '')
    .replace(/^(?:untuk|agar|supaya|dan)\s+/i, '')
    .replace(/\s+(?:untuk|dan)$/i, '')
    .trim()

  let mode: ChatMode = 'general'
  if (/\b(backlog|sampel|samples?|tat|rns|orderId\s*id|order\s*id)\b/i.test(k)) mode = 'lab'
  else if (/\b(masterdata|master\s+data|special\s+price|pks|harga\s+item|list\s+price)\b/i.test(k)) mode = 'masterdata'
  else if (/\b(sales|penjualan|omzet|invoice|order|orders|revenue|customers?)\b/i.test(k)) mode = 'sales'
  else if (/\b(onedrive|sharepoint)\b/i.test(k)) mode = 'onedrive'

  const isi = prompt || asli
  const kata = isi.split(' ').slice(0, 6).join(' ')
  const nama = (kata.charAt(0).toUpperCase() + kata.slice(1)).slice(0, 80)

  return { nama, prompt: isi, jenis: pengingat ? 'pengingat' : 'aira', mode: pengingat ? 'general' : mode, pola }
}
