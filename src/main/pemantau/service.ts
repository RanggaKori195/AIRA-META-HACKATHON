// Orkestrasi PEMANTAU PROAKTIF (20 Okt 2026): izin → saklar → jatuh tempo → query
// berurutan → keputusan → penanda → riwayat → notifikasi. Rancangan: RANCANGAN-PEMANTAU.md.
//
// ⚠️ Semua dependensi DISUNTIK (`Dependensi`) — modul ini tidak mengimpor Electron,
// database, maupun sesi. Sambungan nyatanya di `nyata.ts`. Dengan begitu aturan yang
// paling mahal bila salah (urutan penanda → toast, hasil dibuang saat sesi berganti,
// dua pemeriksaan berbarengan) diuji langsung, bukan dipercaya.
// ⚠️ HANYA MEMBACA. Query dijalankan BERURUTAN lewat `deps.query` (= `salesQuery`,
// pool `max: 1`) — tidak pernah serentak (the project notes, koneksi database).

import type { AksiPemantau, KeadaanPemantau, PemicuId } from '../../shared/ipc'
import {
  AMBANG_DATA_SALES_JAM,
  AMBANG_DATA_TAT_JAM,
  JEDA_PERIKSA_MANUAL_MS,
  MAKS_RIWAYAT,
  PEMICU,
  RINGKAS_GAGAL,
  RINGKAS_SAMPEL_KOSONG,
  RIWAYAT_TAMPIL,
  bolehDiperiksaManual,
  bolehLagi,
  definisi,
  hariBelumDinilai,
  hariDinilai,
  jatuhTempo,
  kabarDataMacet,
  kabarSales,
  kabarSampel,
  kalimatAturan,
  kalimatBatasManual,
  nilaiSalesAnjlok,
  putuskanDataMacet,
  putuskanSampel,
  ringkasDataMacet,
  ringkasSales,
  ringkasSampel,
  tambahHari,
  tanggalPembanding,
  tidakDipantau,
  umurTanpaMinggu,
  waktuMasaDepan,
  type BarisSampel,
  type Kabar,
  type KategoriBacklog,
  type KesegaranData,
  type Penanda
} from './rules'
import {
  SQL_KATEGORI_BACKLOG,
  SQL_KESEGARAN_SALES,
  SQL_KESEGARAN_TAT,
  SQL_NETT_HARIAN,
  SQL_ORDER_HARIAN,
  SQL_SAMPEL_LEWAT_BATAS
} from './sql'
import type { Penyimpanan, StatusTersimpan } from './simpan'

/** Yang dibutuhkan pemantau dari sesi: siapa, dan menu apa yang SAAT INI diizinkan. */
export interface SesiPemantau {
  username: string
  menu: readonly string[]
}

export interface Dependensi {
  query<T>(sql: string, params: unknown[]): Promise<T[]>
  simpan: Penyimpanan
  sesi(): SesiPemantau | null
  notify(o: { title: string; body: string; force: true; onClick: () => void; grup: string; pemilik: string }): boolean
  /** Tutup toast pemantau milik user SELAIN ini (ganti orang di laptop yang sama). */
  tutupNotifikasiLain(user: string | null): void
  /** Kirim `pemantau:buka` ke renderer (toast diklik). */
  buka(aksi: AksiPemantau): void
  /** Kirim `pemantau:berubah` ke renderer. */
  berubah(): void
  log(pesan: string, data: Record<string, unknown>): void
  audit(aksi: string, detail: string): void
  sekarang(): Date
  hariIniJakarta(): string
  jedaMs: number
  /** Mode uji dev (`AIRA_PEMANTAU_UJI`) — selalu mati di aplikasi terpasang. */
  uji: { sales: boolean; lab: boolean }
}

/** Kelompok toast pemantau di `notify.ts` (ditutup saat user berganti/logout). */
export const GRUP_NOTIFIKASI = 'pemantau'

interface Proses {
  berjalan: Promise<void> | null
  /** Waktu "Periksa sekarang" terakhir per user. */
  manual: Map<string, number>
  /**
   * Percobaan terakhir per `user|pemicu` di proses ini — dicatat SEBELUM penanda disimpan.
   * Kalau SQLite lokal terkunci/penuh, `diperiksa` tidak pernah tersimpan dan pemicu
   * jatuh tempo lagi di detak berikutnya: database produksi di-query tiap 30 detik
   * (temuan review akhir 20 Okt 2026). Ingatan ini yang tetap menahan jaraknya.
   */
  percobaan: Map<string, number>
}

// Per objek dependensi: aplikasi punya satu (nyata.ts); tiap test punya sendiri.
const prosesPer = new WeakMap<Dependensi, Proses>()

function proses(deps: Dependensi): Proses {
  let p = prosesPer.get(deps)
  if (!p) {
    p = { berjalan: null, manual: new Map(), percobaan: new Map() }
    prosesPer.set(deps, p)
  }
  return p
}

const kunciPercobaan = (user: string, id: PemicuId): string => `${user}|${id}`

/**
 * Penanda untuk menilai jatuh tempo: percobaan di proses ini (bila ada) lebih baru atau
 * sama dengan yang tersimpan — penanda tersimpan hanya menutupi percobaan dari jalannya
 * aplikasi sebelumnya.
 */
function penandaJatuhTempo(deps: Dependensi, user: string, id: PemicuId): Penanda {
  const tersimpan = deps.simpan.baca(user, id)
  return { nilai: tersimpan.nilai, diperiksa: proses(deps).percobaan.get(kunciPercobaan(user, id)) ?? tersimpan.diperiksa }
}

interface KesegaranTat extends KesegaranData {
  waktuDb: Date | null
}

interface Hasil {
  status: StatusTersimpan
  nilai: string | null
  kabar?: Kabar
  data: Record<string, unknown>
}

/**
 * Satu putaran pemeriksaan untuk user yang sedang login. Tidak pernah melempar.
 *
 * ⚠️ Pemeriksaan yang sedang berjalan TIDAK digandakan: detak Jadwal dan tombol
 * "Periksa sekarang" bisa jatuh bersamaan, dan dua putaran serentak bisa sama-sama
 * membaca penanda lama lalu sama-sama membunyikan toast. Panggilan kedua menunggu
 * yang pertama; bila ia `paksa`, ia jalan SESUDAHNYA dengan penanda yang sudah maju.
 */
export async function periksaPemantau(deps: Dependensi, opsi: { paksa?: boolean } = {}): Promise<void> {
  const p = proses(deps)
  if (p.berjalan) {
    await p.berjalan
    if (!opsi.paksa) return
  }
  while (p.berjalan) await p.berjalan
  const jalan = putaran(deps, opsi.paksa === true).catch((err) => {
    deps.log('pemantau: putaran gagal', { err: String(err).slice(0, 200) })
  })
  p.berjalan = jalan
  try {
    await jalan
  } finally {
    if (p.berjalan === jalan) p.berjalan = null
  }
}

async function putaran(deps: Dependensi, paksa: boolean): Promise<void> {
  const sesi = deps.sesi()
  if (!sesi) return
  const user = sesi.username.toLowerCase()
  // Toast (dan entri Action Center) berisi keadaan data milik orang sebelumnya tidak
  // boleh tertinggal untuk orang yang login sesudahnya. Murah: hanya daftar di memori.
  deps.tutupNotifikasiLain(user)
  const sekarang = deps.sekarang()
  const hariIni = deps.hariIniJakarta()
  const mati = deps.simpan.mati(user)
  const daftar = PEMICU.filter(
    (p) =>
      sesi.menu.includes(p.menu) &&
      !mati.includes(p.id) &&
      (paksa
        ? bolehDiperiksaManual(p.id, sekarang)
        : jatuhTempo(p.id, sekarang, deps.jedaMs, penandaJatuhTempo(deps, user, p.id), hariIni))
  )
  if (daftar.length === 0) return

  // Kesegaran dibaca paling banyak SEKALI per putaran — janjinya dipakai ulang. TAT
  // tetap dibaca untuk pemicu sampel walau pemicu data TAT dimatikan user.
  let tat: Promise<KesegaranTat> | null = null
  let sales: Promise<KesegaranData> | null = null
  const bacaTat = (): Promise<KesegaranTat> =>
    (tat ??= deps
      .query<{ terakhir: string | null; umur_jam: number | null; waktu_db: Date | null }>(SQL_KESEGARAN_TAT, [])
      .then(([r]) => ({ terakhir: r?.terakhir ?? null, umurJam: r?.umur_jam ?? null, waktuDb: r?.waktu_db ?? null })))
  const bacaSales = (): Promise<KesegaranData> =>
    (sales ??= deps
      .query<{ terakhir: string | null; umur_jam: number | null }>(SQL_KESEGARAN_SALES, [])
      .then(([r]) => ({ terakhir: r?.terakhir ?? null, umurJam: r?.umur_jam ?? null })))

  const uji = deps.uji.sales || deps.uji.lab
  let diperiksa = 0
  for (const def of daftar) {
    const lama = deps.simpan.baca(user, def.id)
    let hasil: Hasil
    try {
      hasil = await evaluasi(def.id, lama, deps, hariIni, bacaTat, bacaSales)
    } catch (err) {
      // "Tidak bisa memeriksa" ≠ "data macet" (aturan 33): status saja, tanpa toast.
      hasil = { status: { hasil: 'gagal', ringkas: RINGKAS_GAGAL }, nilai: lama.nilai, data: { err: String(err).slice(0, 160) } }
    }

    // Sesi dibaca ULANG sesudah query (aturan 18): logout, ganti orang, atau menu
    // dicabut selama query berjalan = hasilnya bukan untuk siapa pun yang login sekarang.
    const kini = deps.sesi()
    if (!kini || kini.username.toLowerCase() !== user || !kini.menu.includes(def.menu)) {
      deps.log('pemantau: hasil dibuang, sesi berubah', { pemicu: def.id, user })
      continue
    }
    // Saklar & penanda juga dibaca ULANG (temuan review akhir 20 Okt 2026): dimatikan
    // selama query berjalan = hasilnya dibuang; dinyalakan ulang (penanda dikosongkan) =
    // hasil yang dihitung dari penanda LAMA tidak boleh menimpa pengosongan itu — detak
    // berikutnya menilai ulang dari keadaan kosong, seperti yang dijanjikan saklarnya.
    if (deps.simpan.mati(user).includes(def.id)) {
      deps.log('pemantau: hasil dibuang, saklar dimatikan', { pemicu: def.id, user })
      continue
    }
    const sesudah = deps.simpan.baca(user, def.id)
    if (sesudah.nilai !== lama.nilai || sesudah.diperiksa !== lama.diperiksa) {
      deps.log('pemantau: hasil dibuang, penanda berubah', { pemicu: def.id, user })
      continue
    }

    // ⚠️ Penanda maju LEBIH DULU, baru riwayat, baru toast (pola aturan 62). Kalau
    // toast gagal, yang hilang satu bunyi — kejadiannya tetap di riwayat. Kalau
    // penanda tidak maju, toast yang sama berulang tiap jam. Percobaan dicatat di
    // memori lebih dulu lagi: penyimpanan yang gagal (melempar) tetap menahan jaraknya.
    proses(deps).percobaan.set(kunciPercobaan(user, def.id), sekarang.getTime())
    deps.simpan.simpan(user, def.id, { nilai: hasil.nilai, diperiksa: sekarang.getTime(), status: hasil.status })
    if (hasil.kabar) {
      const k = hasil.kabar
      const judul = (uji ? '[UJI] ' : '') + k.judul
      deps.simpan.catatRiwayat(user, { pemicu: def.id, judul, isi: k.rincian, aksi: k.aksi, dibuat: sekarang.getTime() })
      deps.notify({
        title: judul,
        body: k.isi,
        force: true,
        onClick: () => deps.buka(k.aksi),
        grup: GRUP_NOTIFIKASI,
        pemilik: user
      })
      deps.audit('berbunyi', `pemicu=${def.id} user=${user}`)
    }
    // `diberitahukan` membedakan "toast dikirim" dari "keadaan yang sama masih berlaku".
    deps.log(`pemantau: ${def.id} ${hasil.status.hasil}`, { user, paksa, diberitahukan: Boolean(hasil.kabar), ...hasil.data })
    diperiksa++
  }
  if (diperiksa > 0) deps.berubah()
}

async function evaluasi(
  id: PemicuId,
  lama: Penanda,
  deps: Dependensi,
  hariIni: string,
  bacaTat: () => Promise<KesegaranTat>,
  bacaSales: () => Promise<KesegaranData>
): Promise<Hasil> {
  switch (id) {
    case 'data_sales':
    case 'data_tat': {
      const jenis = id === 'data_tat' ? 'tat' : 'sales'
      const k = jenis === 'tat' ? await bacaTat() : await bacaSales()
      // Data Sales: jam hari Minggu tidak dihitung (lab tutup) — ambangnya menilai umur itu,
      // teksnya tetap menyebut umur SEBENARNYA.
      const umurDinilai = jenis === 'tat' ? k.umurJam : umurTanpaMinggu(k)
      const d = putuskanDataMacet(
        { terakhir: k.terakhir, umurJam: umurDinilai },
        jenis === 'tat' ? AMBANG_DATA_TAT_JAM : AMBANG_DATA_SALES_JAM,
        lama.nilai
      )
      const kabar =
        d.berbunyi && k.terakhir !== null && k.umurJam !== null
          ? kabarDataMacet(jenis, { terakhir: k.terakhir, umurJam: k.umurJam })
          : undefined
      // Umur tak terbaca ATAU di masa depan: tidak bisa dinilai — bukan "normal" (aturan 33).
      const takTernilai = k.umurJam === null || waktuMasaDepan(k)
      return {
        status: { hasil: takTernilai ? 'gagal' : d.macet ? 'berbunyi' : 'normal', ringkas: ringkasDataMacet(jenis, k, d.macet) },
        nilai: d.berbunyi ? k.terakhir : lama.nilai,
        kabar,
        data: { terakhir: k.terakhir, umurJam: k.umurJam, ...(jenis === 'sales' ? { umurDinilai } : {}) }
      }
    }

    case 'sampel_terlambat': {
      const k = await bacaTat()
      const basi = k.umurJam === null || k.umurJam > AMBANG_DATA_TAT_JAM
      // Data basi = backlog dihitung terhadap jam sekarang padahal statusnya berhenti
      // diperbarui — semua sampel tampak terlambat. Ditahan, penanda TIDAK maju. Waktu
      // data di masa depan = kesegarannya tidak bisa dipastikan: ditahan juga.
      const masaDepan = waktuMasaDepan(k) ? k.terakhir : null
      if (((basi || masaDepan !== null) && !deps.uji.lab) || !k.waktuDb) {
        return {
          status: {
            hasil: 'ditahan',
            ringkas: masaDepan !== null ? ringkasSampel({ masaDepan }) : ringkasSampel({ ditahanSejak: k.terakhir })
          },
          nilai: lama.nilai,
          data: { terakhir: k.terakhir, umurJam: k.umurJam }
        }
      }
      const akhir = k.waktuDb.toISOString()
      const pertama = lama.nilai === null
      const baris = (await deps.query<BarisSampel>(SQL_SAMPEL_LEWAT_BATAS, [lama.nilai ?? akhir, akhir])).map((b) => ({
        category: String(b.category),
        batas_hari: Number(b.batas_hari),
        terlambat: Number(b.terlambat),
        baru: Number(b.baru)
      }))
      const backlog = await deps.query<KategoriBacklog>(SQL_KATEGORI_BACKLOG, [akhir])
      const tidak = tidakDipantau(backlog, baris.map((b) => b.category))
      if (baris.length === 0) {
        // Nol kategori terpantau ≠ nol sampel terlambat (aturan 33).
        return {
          status: { hasil: 'kurang_data', ringkas: RINGKAS_SAMPEL_KOSONG, tidakDipantau: tidak },
          nilai: akhir,
          data: { pertama, kategori: 0 }
        }
      }
      const d = putuskanSampel(baris, pertama)
      return {
        status: { hasil: d.terlambat > 0 ? 'berbunyi' : 'normal', ringkas: ringkasSampel(d), tidakDipantau: tidak },
        nilai: akhir,
        kabar: d.berbunyi ? kabarSampel(baris, pertama, tidak) : undefined,
        data: { pertama, kategori: baris.length, baru: d.baru, terlambat: d.terlambat }
      }
    }

    case 'sales_anjlok': {
      // Hari TERTUA yang belum dinilai, bukan selalu hari kerja terakhir: hari yang belum sinkron
      // pada hari pemeriksaannya (terutama Jumat) dinilai menyusul, satu hari per pemeriksaan
      // (22 Okt 2026). Antrean kosong = "Periksa sekarang" menilai ulang hari kerja terakhir.
      const antre = hariBelumDinilai(hariIni, lama.nilai)
      const terbaru = hariDinilai(hariIni)
      const D = antre[0] ?? terbaru
      // Di log: `susulan` = D lebih tua dari hari kerja terakhir; `antre` = seluruh antrean saat itu.
      const jejak = { D, antre, susulan: D < terbaru }
      const k = await bacaSales()
      // Waktu data di masa depan: syarat "sinkronisasi sudah berjalan" di bawah lolos
      // begitu saja walau data D belum tentu lengkap — tidak dinilai, dicoba lagi tiap jam.
      if (waktuMasaDepan(k) && k.terakhir !== null) {
        return {
          status: { hasil: 'gagal', ringkas: ringkasSales({ hasil: 'masa_depan', tanggal: D, terakhir: k.terakhir }) },
          nilai: lama.nilai,
          data: { ...jejak, terakhir: k.terakhir, umurJam: k.umurJam }
        }
      }
      // Hari D baru boleh dinilai sesudah sinkronisasi SESUDAH hari itu berakhir —
      // kalau belum, nett D masih sebagian dan pasti tampak "anjlok". Buktinya baris BARU
      // (`SQL_KESEGARAN_SALES` = created_at): retry bridging ERP juga menulis
      // updated_at (ukur 20 Okt 2026) dan akan meloloskan syarat ini walau ETL berhenti —
      // hari D lalu terbaca "libur" karena order-nya ikut belum masuk.
      if (k.terakhir === null || k.terakhir < `${tambahHari(D, 1)} 00:00`) {
        return {
          status: { hasil: 'menunggu', ringkas: ringkasSales({ hasil: 'menunggu', tanggal: D }) },
          nilai: lama.nilai,
          data: { ...jejak, terakhir: k.terakhir }
        }
      }
      const tanggal = [D, ...tanggalPembanding(D)]
      const nett = await deps.query<{ tgl: string; nett: number }>(SQL_NETT_HARIAN, [tanggal])
      const order = await deps.query<{ tgl: string; order: number }>(SQL_ORDER_HARIAN, [tanggal])
      const p = nilaiSalesAnjlok(
        D,
        Object.fromEntries(nett.map((r) => [r.tgl, Number(r.nett)])),
        Object.fromEntries(order.map((r) => [r.tgl, Number(r.order)])),
        deps.uji.sales ? 10 : undefined
      )
      // "Periksa sekarang" boleh menilai ulang hari yang sama, tapi tidak membunyikannya lagi.
      const sudahDinilai = lama.nilai !== null && lama.nilai >= D
      return {
        status: { hasil: p.hasil, ringkas: ringkasSales(p) },
        // Penanda hanya MAJU. Menilai ulang hari yang lebih tua (jam laptop mundur) tidak boleh
        // memundurkannya: hari-hari di jendela susulan akan dinilai — dan dibunyikan — lagi.
        nilai: sudahDinilai ? lama.nilai : D,
        kabar: p.hasil === 'berbunyi' && !sudahDinilai ? kabarSales(p) : undefined,
        data: { ...jejak, hasil: p.hasil, rasioNett: p.rasioNett, rasioOrder: p.rasioOrder }
      }
    }
  }
}

/** Status & riwayat untuk layar — HANYA pemicu yang menunya diizinkan sesi saat ini. */
export function keadaanPemantau(deps: Dependensi): KeadaanPemantau {
  const sesi = deps.sesi()
  if (!sesi) return { pemicu: [], riwayat: [] }
  const user = sesi.username.toLowerCase()
  const mati = deps.simpan.mati(user)
  const boleh = PEMICU.filter((p) => sesi.menu.includes(p.menu))
  const ids = new Set<PemicuId>(boleh.map((p) => p.id))
  return {
    pemicu: boleh.map((p) => {
      const t = deps.simpan.baca(user, p.id)
      return {
        id: p.id,
        menu: p.menu,
        judul: p.judul,
        aturan: kalimatAturan(p.id),
        aktif: !mati.includes(p.id),
        diperiksa: t.diperiksa,
        hasil: t.status?.hasil ?? 'belum',
        ringkas: t.status?.ringkas ?? 'Belum diperiksa.',
        tidakDipantau: t.status?.tidakDipantau ?? []
      }
    }),
    // Riwayat pemicu yang menunya sudah dicabut tidak ikut (isinya angka menu itu).
    riwayat: deps.simpan.riwayat(user, MAKS_RIWAYAT).filter((r) => ids.has(r.pemicu)).slice(0, RIWAYAT_TAMPIL)
  }
}

/**
 * Saklar "Beri tahu saya". Menyalakan ULANG (dari mati) mengosongkan penanda —
 * pemeriksaan berikutnya memberi tahu keadaan saat itu sekali (pola Jadwal:
 * dinyalakan lagi = dihitung dari sekarang).
 */
export function setelPemicu(deps: Dependensi, id: PemicuId, aktif: boolean): KeadaanPemantau {
  const sesi = deps.sesi()
  if (!sesi || !sesi.menu.includes(definisi(id).menu)) return keadaanPemantau(deps)
  const user = sesi.username.toLowerCase()
  const tadinyaMati = deps.simpan.mati(user).includes(id)
  deps.simpan.setelMati(user, id, !aktif)
  if (aktif && tadinyaMati) {
    deps.simpan.kosongkan(user, id)
    // Ingatan percobaan ikut dibuang — kalau tidak, ia menahan pemeriksaan "dari sekarang" sampai sejam.
    proses(deps).percobaan.delete(kunciPercobaan(user, id))
  }
  deps.audit('saklar', `pemicu=${id} aktif=${aktif} user=${user}`)
  return keadaanPemantau(deps)
}

/**
 * Tombol "Periksa sekarang" — paling sering sekali per JEDA_PERIKSA_MANUAL_MS per user.
 * Yang kena batas tetap mendapat status, ditambah kalimat yang menyebut kapan bisa lagi.
 */
export async function periksaSekarang(deps: Dependensi): Promise<KeadaanPemantau> {
  const sesi = deps.sesi()
  if (!sesi) return keadaanPemantau(deps)
  const user = sesi.username.toLowerCase()
  const p = proses(deps)
  const kini = deps.sekarang().getTime()
  const terakhir = p.manual.get(user) ?? null
  if (bolehLagi(terakhir, kini, JEDA_PERIKSA_MANUAL_MS)) {
    p.manual.set(user, kini)
    await periksaPemantau(deps, { paksa: true })
    return keadaanPemantau(deps)
  }
  const sisa = JEDA_PERIKSA_MANUAL_MS - (kini - (terakhir ?? kini))
  return { ...keadaanPemantau(deps), catatanPeriksa: kalimatBatasManual(sisa) }
}
