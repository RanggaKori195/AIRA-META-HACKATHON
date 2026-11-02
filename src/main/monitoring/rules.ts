import type { ChatMode, ToolActivity } from '../../shared/ipc'

// Aturan monitoring pemakaian — modul MURNI (tanpa database, tanpa Electron),
// pola yang sama dengan `feedback/rules.ts`: keputusan "apa yang boleh ikut
// terkirim ke server" hanya ada di satu tempat dan bisa diuji tanpa jaringan.
//
// ⚠️ KEPUTUSAN USER 16 Sep 2026: yang dicatat LEVEL 1 + 2 saja —
//   1. metadata (siapa, kapan, menu, model, tool, durasi, berhasil/gagal, token)
//   2. teks pertanyaan yang DIKETIK user
// JAWABAN AIRA TIDAK PERNAH ikut. Di jawaban itulah nilai data berada (omzet,
// isi dokumen, hasil lab) — alasan yang sama dengan aturan 15. Dan tabel pusat
// ini bisa dibaca siapa pun yang berhasil menarik connection string dari `.exe`
// (aturan 13), jadi yang tidak dikirim adalah satu-satunya yang benar-benar aman.
// Isi berkas lampiran juga tidak ikut — hanya NAMANYA.

/** Batas panjang pertanyaan yang dikirim. Cukup untuk tahu "dia minta apa". */
export const MAKS_PROMPT = 2_000

/** Berapa lampiran yang namanya ikut dicatat per pertanyaan. */
export const MAKS_LAMPIRAN = 20

/** Berapa jenis tool yang dicatat per pertanyaan. */
export const MAKS_TOOL = 50

/**
 * Teks pertanyaan dikosongkan sesudah sekian hari; metadatanya tetap.
 *
 * Dipilih supaya "minggu lalu dia ngapain" dan evaluasi per kuartal tetap bisa
 * dijawab, sementara teks yang ditulis orang tidak menumpuk selamanya di server
 * yang connection string-nya bisa ditarik dari installer. Ubah di sini saja —
 * pembersihannya membaca konstanta ini.
 */
export const RETENSI_PROMPT_HARI = 90

/**
 * Batas antrean lokal saat laptop lama tidak terhubung ke database.
 *
 * Tanpa batas, laptop yang berbulan-bulan di luar jaringan menumpuk antrean tak
 * terbatas lalu mengirimnya sekaligus. Yang terbuang dicatat di log + audit
 * (bukan dibuang diam-diam) — pelajaran PDF 22,8 MB, 19 Agu 2026.
 */
export const MAKS_ANTREAN = 5_000

/** Periode yang bisa dipilih di layar monitoring. */
export const PERIODE_HARI = [1, 7, 30, 90] as const

export type StatusRun = 'selesai' | 'gagal' | 'dibatalkan'

export interface ToolTercatat {
  nama: string
  /** Berapa kali tool ini dipanggil pada satu pertanyaan. */
  kali: number
  /** Berapa kali di antaranya gagal / ditolak. */
  gagal: number
}

/**
 * Menyamarkan hal yang TERLIHAT seperti rahasia sebelum pertanyaan dikirim.
 *
 * Orang memang kadang menempelkan connection string atau token ke kotak chat
 * ("kenapa postgresql://budi:rahasia@… ini gagal?"). Di laptopnya sendiri itu
 * sudah terjadi; yang dicegah di sini adalah salinannya berpindah ke tabel pusat
 * yang dibaca orang lain.
 *
 * ⚠️ Ini penyaring kesalahan, BUKAN jaminan. Kata sandi yang diketik polos tanpa
 * penanda ("sandinya the company2026") tidak bisa dikenali secara deterministik, dan
 * itu sebabnya Panduan meminta orang tidak mengetik kata sandi di chat.
 */
export function samarkanRahasia(teks: string): string {
  return (
    teks
      // skema://user:password@host -> password disamarkan
      .replace(/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):[^\s@/]+@/gi, '$1:•••@')
      // password=..., pwd: ..., token=..., api_key=..., secret=...
      .replace(
        /\b(pass(?:word|wd)?|pwd|kata ?sandi|sandi|token|api[_-]?key|secret|client[_-]?secret)(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi,
        '$1$2•••'
      )
      // Bearer <token>
      .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, '$1•••')
      // Kunci berbentuk sk-xxxx / ghp_xxxx yang panjang
      .replace(/\b(sk|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{16,}\b/g, '•••')
  )
}

/**
 * Pertanyaan yang siap dikirim: disamarkan, lalu dipotong — dan MENGAKU dipotong.
 *
 * Penanda potongan wajib ikut (pelajaran 19 Agu 2026): Super Admin yang membaca
 * kalimat terputus tanpa keterangan akan mengira user-nya yang menulis begitu.
 */
export function siapkanPrompt(teks: string): { prompt: string | null; dipotong: boolean } {
  const bersih = samarkanRahasia(teks.trim())
  if (bersih.length === 0) return { prompt: null, dipotong: false }
  if (bersih.length <= MAKS_PROMPT) return { prompt: bersih, dipotong: false }
  const sisa = bersih.length - MAKS_PROMPT
  return {
    prompt: `${bersih.slice(0, MAKS_PROMPT)} […dipotong ${sisa.toLocaleString('id-ID')} karakter]`,
    dipotong: true
  }
}

/**
 * Ringkasan tool per pertanyaan: nama + berapa kali + berapa gagal.
 *
 * ⚠️ ARGUMEN tool TIDAK ikut. `argsSummary` memuat path berkas, isi query, dan
 * teks yang ditulis ke dokumen — itu bukan "apa yang dilakukan" melainkan data
 * pekerjaannya. Nama tool sudah menjawab "AIRA membuat PPT / membaca PDF / query
 * sales".
 */
export function ringkasTool(activities: readonly ToolActivity[]): ToolTercatat[] {
  const peta = new Map<string, ToolTercatat>()
  for (const a of activities) {
    const nama = a.name.slice(0, 80)
    const t = peta.get(nama) ?? { nama, kali: 0, gagal: 0 }
    t.kali++
    if (a.status === 'error' || a.status === 'denied') t.gagal++
    peta.set(nama, t)
  }
  return [...peta.values()].slice(0, MAKS_TOOL)
}

/** Nama lampiran saja — path lengkap tidak ikut (nama folder pun bisa bercerita). */
export function namaLampiran(nama: readonly string[]): string[] {
  return nama
    .map((n) => n.split(/[\\/]/).pop()?.trim().slice(0, 200) ?? '')
    .filter((n) => n.length > 0)
    .slice(0, MAKS_LAMPIRAN)
}

/** Kode galat LLM -> status yang ditampilkan. */
export function statusDariKode(kode: string | null): StatusRun {
  if (kode === null) return 'selesai'
  if (kode === 'LLM_CANCELLED') return 'dibatalkan'
  return 'gagal'
}

export interface AktivitasBaru {
  eventId: string
  username: string
  role: string
  divisi: string | null
  hostname: string
  osUser: string
  appVersion: string
  /** Waktu pertanyaan dikirim, ISO. Jam LAPTOP — lihat catatan di skema. */
  waktu: string
  mode: ChatMode
  model: string
  sesiId: string
  prompt: string | null
  promptDipotong: boolean
  lampiran: string[]
  tools: ToolTercatat[]
  jumlahTool: number
  status: StatusRun
  kodeGalat: string | null
  durasiMs: number
  promptTokens: number | null
  completionTokens: number | null
}

/** Satu-satunya jalan membentuk baris aktivitas. */
export function bentukAktivitas(input: {
  eventId: string
  sesi: { username: string; role: string; divisi: readonly string[] }
  mesin: { hostname: string; osUser: string }
  appVersion: string
  mulai: number
  selesai: number
  mode: ChatMode
  model: string
  sesiId: string
  teks: string
  lampiran: readonly string[]
  activities: readonly ToolActivity[]
  kodeGalat: string | null
  usage?: { promptTokens: number; completionTokens: number }
}): AktivitasBaru {
  const { prompt, dipotong } = siapkanPrompt(input.teks)
  return {
    eventId: input.eventId,
    username: input.sesi.username.toLowerCase(),
    role: input.sesi.role,
    divisi: input.sesi.divisi.length > 0 ? input.sesi.divisi.join(', ') : null,
    hostname: input.mesin.hostname.slice(0, 200),
    osUser: input.mesin.osUser.slice(0, 200),
    appVersion: input.appVersion.slice(0, 50),
    waktu: new Date(input.mulai).toISOString(),
    mode: input.mode,
    model: input.model.slice(0, 200),
    sesiId: input.sesiId,
    prompt,
    promptDipotong: dipotong,
    lampiran: namaLampiran(input.lampiran),
    tools: ringkasTool(input.activities),
    jumlahTool: input.activities.length,
    status: statusDariKode(input.kodeGalat),
    kodeGalat: input.kodeGalat?.slice(0, 80) ?? null,
    durasiMs: Math.max(0, Math.round(input.selesai - input.mulai)),
    promptTokens: input.usage?.promptTokens ?? null,
    completionTokens: input.usage?.completionTokens ?? null
  }
}

/**
 * Pola ILIKE dari kata yang diketik Super Admin.
 *
 * `%` dan `_` di-escape: tanpa itu, mencari "100%" atau "nama_file" diam-diam
 * mencocokkan hal lain, dan daftar yang salah terlihat seperti hasil yang benar.
 */
export function polaCari(kata: string | null | undefined): string | null {
  const bersih = (kata ?? '').trim().slice(0, 100)
  if (bersih.length === 0) return null
  return `%${bersih.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}
