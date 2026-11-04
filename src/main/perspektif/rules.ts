// Analisa lintas perspektif — aturan MURNI, ter-test.
//
// Idenya diambil dari `mcp-strategy` (the gateway admin, AURA stack): beberapa
// "analyst" membaca fakta yang sama dari sudut pandang berbeda, hasilnya
// berupa KLAIM TERSTRUKTUR, lalu konflik antar-klaim dicari secara
// PROGRAMATIK — bukan diserahkan ke LLM untuk "ingat sendiri".
//
// Yang TIDAK diambil, dan itu sengaja:
//   - job background berjam-jam (AIRA aplikasi laptop; job mati saat lid ditutup)
//   - Postgres/Redis/Docker (menabrak §2: satu runtime, tanpa sidecar)
//   - persona auto-learning lintas user (menabrak aturan 15 & 16 soal memori)
//
// Perbedaan penting dari mcp-strategy, dan ini yang membuat deteksinya jauh
// lebih tajam di sini: SEMUA perspektif menerima SATU SET FAKTA YANG SAMA,
// diambil lewat tool sales yang SQL-nya sudah terverifikasi. Karena itu:
//
//   - dua perspektif menyebut angka berbeda untuk hal yang sama  -> salah satu SALAH
//   - sebuah perspektif menyebut angka yang tidak ada di fakta   -> KARANGAN
//
// Keduanya bisa dipastikan tanpa menebak, dan itulah yang dilaporkan duluan.

/** Satu angka yang dikutip sebuah perspektif, beserta namanya. */
export interface AngkaKlaim {
  nama: string
  nilai: number
}

export interface Klaim {
  pernyataan: string
  angka: AngkaKlaim[]
  keyakinan: number
}

export interface KlaimPerspektif {
  perspektif: string
  label: string
  klaim: Klaim[]
  /** Diisi bila keluaran model tidak bisa diparse sama sekali. */
  gagalParse?: string
}

export const AMBANG_RAGU = 0.5

/**
 * Toleransi selisih angka sebelum dianggap konflik.
 *
 * Bukan nol: model sering menulis "Rp 4,11 M" untuk 4.112.345.678, dan itu
 * pembulatan yang wajar, bukan konflik. 1% cukup longgar untuk pembulatan
 * penyajian, cukup ketat untuk menangkap angka yang benar-benar beda.
 */
export const TOLERANSI_RELATIF = 0.01

/** Nama metrik dinormalkan supaya "Nett Sales" dan "nett_sales" dianggap sama. */
export function normalkanNama(nama: string): string {
  return nama
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function samaAngka(a: number, b: number): boolean {
  if (a === b) return true
  const besar = Math.max(Math.abs(a), Math.abs(b))
  if (besar === 0) return Math.abs(a - b) < 1e-9
  return Math.abs(a - b) / besar <= TOLERANSI_RELATIF
}

// ── Parsing keluaran model ────────────────────────────────────────────────

/**
 * Mengambil blok JSON dari keluaran model.
 *
 * Model 27B sering membungkus JSON dengan ```json ... ``` atau menambah
 * kalimat pengantar. Menolak keluaran seperti itu berarti membuang jawaban
 * yang isinya sebenarnya benar, jadi pembungkusnya dikupas dulu.
 */
export function ambilJson(teks: string): string | null {
  const pagar = /```(?:json)?\s*([\s\S]*?)```/i.exec(teks)
  const isi = pagar ? pagar[1] : teks
  const mulai = isi.indexOf('{')
  const akhir = isi.lastIndexOf('}')
  if (mulai < 0 || akhir <= mulai) return null
  return isi.slice(mulai, akhir + 1)
}

function angkaDari(nilai: unknown): number | null {
  if (typeof nilai === 'number' && Number.isFinite(nilai)) return nilai
  if (typeof nilai === 'string') {
    const bersih = nilai.replace(/[^\d.,-]/g, '')
    if (!bersih) return null

    // ⚠️ Titik itu ambigu: pemisah ribuan gaya Indonesia ("4.112.345.678")
    // ATAU koma desimal gaya Inggris ("0.85" untuk keyakinan). Membedakannya
    // dari BENTUKNYA, bukan menebak dari konteks: pemisah ribuan selalu
    // mengelompokkan tepat 3 digit.
    //
    // Versi pertama fungsi ini menganggap "tidak ada koma = titik itu
    // desimal", dan akibatnya `Number("4.112.345.678")` = NaN sehingga angka
    // terbesar di seluruh laporan DIBUANG diam-diam — klaimnya tetap tampil,
    // hanya angkanya hilang dari pemeriksaan konflik. Tertangkap unit test.
    const RIBUAN = /^-?\d{1,3}(\.\d{3})+$/
    let normal: string
    const komaTerakhir = bersih.lastIndexOf(',')
    const titikTerakhir = bersih.lastIndexOf('.')
    if (komaTerakhir >= 0 && titikTerakhir >= 0) {
      // Keduanya ada: yang TERAKHIR adalah pemisah desimal.
      normal =
        komaTerakhir > titikTerakhir
          ? bersih.replace(/\./g, '').replace(',', '.')
          : bersih.replace(/,/g, '')
    } else if (komaTerakhir >= 0) {
      normal = bersih.replace(',', '.')
    } else if (RIBUAN.test(bersih)) {
      normal = bersih.replace(/\./g, '')
    } else {
      normal = bersih
    }
    const n = Number(normal)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * Memungut objek klaim yang UTUH dari JSON yang terpotong di tengah.
 *
 * ⚠️ Ini bukan kemewahan. `old-think-model` model REASONING: untaian penalarannya
 * ikut memakan jatah `max_tokens`, jadi keluarannya bisa berhenti di tengah
 * array — terukur 25 Agu 2026, penalaran 3.558 karakter memakan 1.335 dari
 * 1.400 token, dan pada item yang datanya lebih kaya jatahnya habis sebelum
 * JSON ditutup. Akibatnya KEDUA perspektif gagal total dan laporannya kosong,
 * padahal 3-4 klaim pertamanya sudah utuh dan benar.
 *
 * Membuang semuanya karena kurung terakhir tidak sempat ditulis adalah
 * kerugian yang tidak perlu.
 */
function pungutKlaimUtuh(json: string): unknown[] {
  const mulaiArray = json.indexOf('[', json.indexOf('"klaim"'))
  if (mulaiArray < 0) return []
  const hasil: unknown[] = []
  let dalam = 0
  let awal = -1
  let dalamString = false
  let escape = false
  for (let i = mulaiArray; i < json.length; i++) {
    const ch = json[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\') {
      escape = true
      continue
    }
    if (ch === '"') dalamString = !dalamString
    if (dalamString) continue
    if (ch === '{') {
      if (dalam === 0) awal = i
      dalam++
    } else if (ch === '}') {
      dalam--
      if (dalam === 0 && awal >= 0) {
        try {
          hasil.push(JSON.parse(json.slice(awal, i + 1)))
        } catch {
          /* objek ini rusak — lewati, jangan menjatuhkan yang lain */
        }
        awal = -1
      }
    }
  }
  return hasil
}

/** Membaca klaim dari keluaran model. Baris yang bentuknya salah DILEWATI, bukan menggagalkan semuanya. */
export function parseKlaim(teks: string): { klaim: Klaim[]; gagal?: string } {
  const json = ambilJson(teks)
  if (!json) {
    // Ada `{` tapi tidak ada penutupnya sama sekali = terpotong sangat awal.
    // Dibedakan dari "model menjawab prosa" karena penanganannya beda: yang
    // pertama minta jatah token lebih besar, yang kedua minta prompt lebih tegas.
    return {
      klaim: [],
      gagal: teks.includes('{')
        ? 'keluaran model terpotong sebelum JSON sempat ditutup'
        : 'keluaran model tidak memuat JSON sama sekali'
    }
  }
  let daftar: unknown
  let terpotong = false
  try {
    daftar = (JSON.parse(json) as { klaim?: unknown })?.klaim
  } catch {
    // JSON tidak utuh — selamatkan klaim yang sudah lengkap sebelum terpotong.
    daftar = pungutKlaimUtuh(json)
    terpotong = true
    if (!Array.isArray(daftar) || daftar.length === 0) {
      return { klaim: [], gagal: 'JSON tidak valid dan tidak ada klaim utuh yang bisa diselamatkan' }
    }
  }
  if (!Array.isArray(daftar)) return { klaim: [], gagal: 'tidak ada array "klaim"' }
  if (terpotong) {
    const dipungut = parseDaftar(daftar)
    return dipungut.length > 0
      ? {
          klaim: dipungut,
          gagal: `keluaran model terpotong; ${dipungut.length} klaim pertama diselamatkan`
        }
      : { klaim: [], gagal: 'keluaran model terpotong dan tidak ada klaim yang utuh' }
  }

  const hasil = parseDaftar(daftar)
  if (hasil.length === 0) return { klaim: [], gagal: 'array "klaim" kosong atau bentuknya salah' }
  return { klaim: hasil }
}

/** Mengubah daftar mentah jadi Klaim[]. Baris yang bentuknya salah DILEWATI. */
function parseDaftar(daftar: unknown[]): Klaim[] {
  const hasil: Klaim[] = []
  for (const baris of daftar) {
    const b = baris as Record<string, unknown>
    const pernyataan = typeof b.pernyataan === 'string' ? b.pernyataan.trim() : ''
    if (!pernyataan) continue
    const keyakinanMentah = angkaDari(b.keyakinan)
    const keyakinan =
      keyakinanMentah === null ? 0.5 : Math.min(Math.max(keyakinanMentah, 0), 1)
    const angka: AngkaKlaim[] = []
    if (Array.isArray(b.angka)) {
      for (const a of b.angka) {
        const item = a as Record<string, unknown>
        const nama = typeof item?.nama === 'string' ? item.nama.trim() : ''
        const nilai = angkaDari(item?.nilai)
        if (nama && nilai !== null) angka.push({ nama, nilai })
      }
    }
    hasil.push({ pernyataan, angka, keyakinan })
  }
  return hasil
}

// ── Pemeriksaan programatik ───────────────────────────────────────────────

export interface KonflikAngka {
  nama: string
  nilai: Array<{ perspektif: string; nilai: number }>
}

/**
 * Dua perspektif menyebut angka BERBEDA untuk metrik yang SAMA.
 *
 * Karena semua perspektif membaca fakta yang identik, ini berarti salah satu
 * salah membaca — bukan perbedaan pendapat yang sah.
 */
export function deteksiKonflikAngka(semua: KlaimPerspektif[]): KonflikAngka[] {
  // ⚠️ Dikelompokkan per KODE perspektif, bukan per label. Versi pertama
  // memeriksa duplikat dengan membandingkan kode terhadap label yang sudah
  // tersimpan — dua nilai yang berbeda, jadi pemeriksaannya tidak pernah
  // cocok. Akibatnya SATU perspektif yang menyebut metrik sama dua kali
  // dilaporkan sebagai "konflik antar perspektif", padahal tidak ada
  // perspektif kedua. Tertangkap unit test.
  const perNama = new Map<string, Map<string, { perspektif: string; nilai: number }>>()
  for (const p of semua) {
    for (const k of p.klaim) {
      for (const a of k.angka) {
        const kunci = normalkanNama(a.nama)
        if (!kunci) continue
        const perKode = perNama.get(kunci) ?? new Map()
        // Satu perspektif menyebut metrik yang sama dua kali bukan konflik
        // antar-perspektif; ambil sebutan pertamanya saja.
        if (!perKode.has(p.perspektif)) {
          perKode.set(p.perspektif, { perspektif: p.label, nilai: a.nilai })
        }
        perNama.set(kunci, perKode)
      }
    }
  }

  const konflik: KonflikAngka[] = []
  for (const [nama, perKode] of perNama) {
    const daftar = [...perKode.values()]
    if (daftar.length < 2) continue
    const beda = daftar.some((d) => !samaAngka(d.nilai, daftar[0].nilai))
    if (beda) konflik.push({ nama, nilai: daftar })
  }
  return konflik
}

export interface AngkaTakDidukung {
  perspektif: string
  nama: string
  nilai: number
}

/**
 * Angka yang dikutip model tapi TIDAK ADA di fakta yang diberikan.
 *
 * Ini pendeteksi karangan yang paling langsung yang bisa kita punya: fakta
 * dikumpulkan lebih dulu secara deterministik, jadi setiap angka di jawaban
 * seharusnya berasal dari sana. Yang tidak cocok berarti model mengarangnya
 * atau menghitung sendiri di kepala — dua-duanya dilarang untuk angka
 * manajemen (lihat the project notes: "angka yang salah lebih berbahaya daripada
 * fitur yang belum ada").
 *
 * ⚠️ Angka hasil turunan yang WAJAR (persentase, selisih) memang tidak ada di
 * daftar fakta. Karena itu hasilnya disebut "perlu dicek", bukan "salah" —
 * dan disajikan sebagai daftar untuk dibaca manusia, bukan dibuang otomatis.
 */
export function angkaTakDidukung(
  semua: KlaimPerspektif[],
  nilaiFakta: readonly number[]
): AngkaTakDidukung[] {
  const hasil: AngkaTakDidukung[] = []
  for (const p of semua) {
    for (const k of p.klaim) {
      for (const a of k.angka) {
        if (nilaiFakta.some((f) => samaAngka(f, a.nilai))) continue
        hasil.push({ perspektif: p.label, nama: a.nama, nilai: a.nilai })
      }
    }
  }
  return hasil
}

export interface KlaimRagu {
  perspektif: string
  pernyataan: string
  keyakinan: number
}

/** Klaim dengan keyakinan di bawah ambang — dikumpulkan, bukan disembunyikan. */
export function klaimRagu(semua: KlaimPerspektif[], ambang = AMBANG_RAGU): KlaimRagu[] {
  const hasil: KlaimRagu[] = []
  for (const p of semua) {
    for (const k of p.klaim) {
      if (k.keyakinan < ambang) {
        hasil.push({ perspektif: p.label, pernyataan: k.pernyataan, keyakinan: k.keyakinan })
      }
    }
  }
  return hasil
}

/**
 * Semua nilai angka yang ada di dalam sebuah objek fakta, apa pun kedalamannya.
 * Dipakai `angkaTakDidukung` sebagai pembanding.
 */
export function kumpulkanNilai(fakta: unknown, keluar: number[] = []): number[] {
  if (typeof fakta === 'number' && Number.isFinite(fakta)) {
    keluar.push(fakta)
  } else if (Array.isArray(fakta)) {
    for (const f of fakta) kumpulkanNilai(f, keluar)
  } else if (fakta && typeof fakta === 'object') {
    for (const v of Object.values(fakta)) kumpulkanNilai(v, keluar)
  }
  return keluar
}
