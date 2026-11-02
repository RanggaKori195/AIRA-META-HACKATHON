// Diagram interaktif (30 Sep 2026) — aturan MURNI: bentuk spesifikasi yang boleh
// dikirim model, dan penolakannya.
//
// ⚠️ Pola aturan 24 (presentasi): model HANYA mengisi isi — simpul, hubungan,
// kelompok. Tata letak, koordinat, warna, ukuran huruf milik KODE. Model tidak
// pernah menyebut posisi; spesifikasi yang memuatnya pun tidak punya tempat.
// ⚠️ Pesan galat wajib menyebut CARA memperbaikinya (aturan 55) — model yang
// hanya diberi "tidak valid" akan menebak, gagal lagi, lalu menyerah.

export class DiagramError extends Error {}

export const BENTUK = ['proses', 'keputusan', 'terminal', 'data', 'database', 'orang'] as const
export type Bentuk = (typeof BENTUK)[number]

export const ARAH = ['atas-bawah', 'kiri-kanan'] as const
export type Arah = (typeof ARAH)[number]

export const MAKS_SIMPUL = 80
export const MAKS_HUBUNGAN = 160
export const MAKS_KELOMPOK = 12
export const MAKS_LABEL = 80
export const MAKS_KETERANGAN = 500

export interface Simpul {
  id: string
  label: string
  bentuk: Bentuk
  kelompok: string | null
  keterangan: string | null
}

export interface Hubungan {
  dari: string
  ke: string
  label: string | null
  putus: boolean
}

export interface Kelompok {
  id: string
  label: string
}

export interface SpekDiagram {
  judul: string
  arah: Arah
  simpul: Simpul[]
  hubungan: Hubungan[]
  kelompok: Kelompok[]
}

const teks = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

function potong(v: string, maks: number, apa: string): string {
  if (v.length > maks) throw new DiagramError(`${apa} terlalu panjang (${v.length} karakter, maks ${maks}) — ringkas jadi frasa pendek, detailnya taruh di "keterangan".`)
  return v
}

/**
 * Memeriksa & merapikan spesifikasi dari model. Melempar DiagramError dengan
 * kalimat yang menyebut perbaikannya.
 */
export function periksaSpek(raw: Record<string, unknown>): SpekDiagram {
  const judul = potong(teks(raw.judul), 120, 'judul')
  if (!judul) throw new DiagramError('judul wajib diisi — satu frasa yang menjelaskan diagram ini.')

  const arahMentah = teks(raw.arah) || 'atas-bawah'
  if (!(ARAH as readonly string[]).includes(arahMentah)) {
    throw new DiagramError(`arah "${arahMentah}" tidak dikenal — pakai "atas-bawah" (alur/hierarki) atau "kiri-kanan" (proses panjang, timeline).`)
  }

  const kelompokMentah = Array.isArray(raw.kelompok) ? raw.kelompok : []
  if (kelompokMentah.length > MAKS_KELOMPOK) throw new DiagramError(`kelompok maksimal ${MAKS_KELOMPOK}.`)
  const kelompok: Kelompok[] = []
  for (const k of kelompokMentah as Array<Record<string, unknown>>) {
    const id = teks(k?.id)
    const label = potong(teks(k?.label) || id, MAKS_LABEL, `label kelompok "${id}"`)
    if (!id) throw new DiagramError('setiap kelompok wajib punya id.')
    if (kelompok.some((x) => x.id === id)) throw new DiagramError(`id kelompok "${id}" dipakai dua kali — setiap id harus unik.`)
    kelompok.push({ id, label })
  }

  const simpulMentah = Array.isArray(raw.simpul) ? raw.simpul : []
  if (simpulMentah.length === 0) throw new DiagramError('simpul kosong — isi minimal satu simpul {id, label}.')
  if (simpulMentah.length > MAKS_SIMPUL) {
    throw new DiagramError(`simpul ${simpulMentah.length}, maksimal ${MAKS_SIMPUL} — pecah jadi beberapa diagram (mis. per tahap), atau gabungkan langkah kecil.`)
  }
  const simpul: Simpul[] = []
  for (const s of simpulMentah as Array<Record<string, unknown>>) {
    const id = teks(s?.id)
    if (!id) throw new DiagramError('setiap simpul wajib punya id (mis. "s1").')
    if (simpul.some((x) => x.id === id)) throw new DiagramError(`id simpul "${id}" dipakai dua kali — setiap id harus unik.`)
    const label = potong(teks(s?.label), MAKS_LABEL, `label simpul "${id}"`)
    if (!label) throw new DiagramError(`simpul "${id}" belum punya label.`)
    const bentukMentah = teks(s?.bentuk) || 'proses'
    if (!(BENTUK as readonly string[]).includes(bentukMentah)) {
      throw new DiagramError(`bentuk "${bentukMentah}" pada simpul "${id}" tidak dikenal — pilih salah satu: ${BENTUK.join(', ')}.`)
    }
    const kel = teks(s?.kelompok) || null
    if (kel && !kelompok.some((k) => k.id === kel)) {
      throw new DiagramError(`simpul "${id}" menyebut kelompok "${kel}" yang tidak ada di daftar kelompok — tambahkan {id: "${kel}", label: …} ke "kelompok", atau kosongkan.`)
    }
    const ket = teks(s?.keterangan)
    simpul.push({
      id,
      label,
      bentuk: bentukMentah as Bentuk,
      kelompok: kel,
      keterangan: ket ? potong(ket, MAKS_KETERANGAN, `keterangan simpul "${id}"`) : null
    })
  }

  const hubMentah = Array.isArray(raw.hubungan) ? raw.hubungan : []
  if (hubMentah.length > MAKS_HUBUNGAN) throw new DiagramError(`hubungan maksimal ${MAKS_HUBUNGAN} — pecah diagramnya.`)
  const ids = new Set(simpul.map((s) => s.id))
  const hubungan: Hubungan[] = []
  const tidakAda = new Set<string>()
  for (const h of hubMentah as Array<Record<string, unknown>>) {
    const dari = teks(h?.dari)
    const ke = teks(h?.ke)
    if (!ids.has(dari)) tidakAda.add(dari || '(kosong)')
    if (!ids.has(ke)) tidakAda.add(ke || '(kosong)')
    if (dari && dari === ke) throw new DiagramError(`hubungan "${dari}" → "${ke}" menunjuk dirinya sendiri — tidak didukung; tulis sebagai keterangan simpul.`)
    const label = teks(h?.label)
    hubungan.push({ dari, ke, label: label ? potong(label, 40, 'label hubungan') : null, putus: h?.putus === true })
  }
  if (tidakAda.size > 0) {
    throw new DiagramError(
      `hubungan menyebut id simpul yang tidak ada: ${[...tidakAda].slice(0, 8).join(', ')}. ` +
        `Id yang tersedia: ${[...ids].slice(0, 20).join(', ')}${ids.size > 20 ? ', …' : ''}. Pakai id, bukan label.`
    )
  }
  return { judul, arah: arahMentah as Arah, simpul, hubungan, kelompok }
}

/**
 * Nama berkas: wajib .html (diagram interaktif). PNG pratinjau ditulis di
 * sebelahnya dengan nama yang sama.
 */
export function pastikanBerkasHtml(file: string): void {
  if (!/\.html?$/i.test(file)) {
    throw new DiagramError('path diagram wajib berakhiran .html — versi .png dibuat otomatis di sebelahnya.')
  }
}
