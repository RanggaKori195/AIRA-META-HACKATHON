// Tata letak diagram — MURNI, tanpa dependensi (30 Sep 2026).
//
// Algoritma berlapis gaya Sugiyama, versi ringkas:
//   1. Siklus diputus (tepi balik dibalik SEMENTARA, panahnya tetap ke tujuan asli).
//   2. Lapis = jalur terpanjang dari sumber.
//   3. Tepi yang melompati lapis diberi simpul bayangan, supaya garisnya berbelok
//      di celah antar-simpul, bukan menembus kotak.
//   4. Urutan dalam lapis: barycenter bolak-balik; anggota kelompok dirapatkan.
//   5. Koordinat: rata-rata dua pengepakan (kiri & kanan) terhadap posisi ideal —
//      jarak minimum antar-kotak dijamin, dan hasilnya tidak miring ke satu sisi.
//
// ⚠️ `@dagrejs/dagre` sempat dipertimbangkan (18 Sep) dan sengaja TIDAK dipakai:
// grafik & PPT project ini juga tanpa dependensi baru, dan diagram the lab
// (SOP, alur sampel, struktur tim) jarang lewat 50 simpul. Kalau kelak tidak
// cukup, gantinya cukup di berkas ini — keluarannya bentuk data biasa.

import type { Arah, Bentuk, SpekDiagram } from './rules'

export interface Titik {
  x: number
  y: number
}

export interface Kotak {
  id: string
  /** Pusat kotak. */
  x: number
  y: number
  w: number
  h: number
  baris: string[]
  bentuk: Bentuk
  kelompok: string | null
}

export interface Garis {
  dari: string
  ke: string
  titik: Titik[]
  label: string | null
  putus: boolean
}

export interface KotakKelompok {
  id: string
  label: string
  x: number
  y: number
  w: number
  h: number
}

export interface HasilTata {
  kotak: Kotak[]
  garis: Garis[]
  kelompok: KotakKelompok[]
  lebar: number
  tinggi: number
}

const MAKS_KARAKTER_BARIS = 20
const JARAK_ANTAR = 36
const JARAK_BAYANGAN = 14
const JARAK_LAPIS = 64
const TEPI = 28

/** Membungkus label per kata jadi baris ≤ 20 karakter (kata yang lebih panjang dipotong keras). */
export function bungkus(label: string): string[] {
  const baris: string[] = []
  let kini = ''
  for (const kata of label.split(' ')) {
    let k = kata
    while (k.length > MAKS_KARAKTER_BARIS) {
      if (kini) {
        baris.push(kini)
        kini = ''
      }
      baris.push(k.slice(0, MAKS_KARAKTER_BARIS))
      k = k.slice(MAKS_KARAKTER_BARIS)
    }
    if (!kini) kini = k
    else if (kini.length + 1 + k.length <= MAKS_KARAKTER_BARIS) kini += ` ${k}`
    else {
      baris.push(kini)
      kini = k
    }
  }
  if (kini) baris.push(kini)
  return baris.length ? baris : ['']
}

function ukuran(baris: string[], bentuk: Bentuk): { w: number; h: number } {
  const terpanjang = Math.max(...baris.map((b) => b.length))
  let w = Math.min(240, Math.max(110, terpanjang * 7.4 + 34))
  let h = 24 + baris.length * 17
  if (bentuk === 'keputusan') {
    w = w * 1.3 + 10
    h = h + 26
  } else if (bentuk === 'database') h += 14
  else if (bentuk === 'orang') w += 22
  else if (bentuk === 'data') w += 20
  return { w, h }
}

interface Node {
  id: string
  bayangan: boolean
  lapis: number
  urut: number
  /** Ukuran sepanjang sumbu URUT (dalam lapis) dan sumbu LAPIS. */
  panjangUrut: number
  panjangLapis: number
  kelompok: number
  indeks: number
  pos: number
}

export function tataLetak(spek: SpekDiagram): HasilTata {
  const kiriKanan = spek.arah === 'kiri-kanan'
  const indeksKelompok = new Map(spek.kelompok.map((k, i) => [k.id, i]))
  const info = new Map(
    spek.simpul.map((s) => {
      const baris = bungkus(s.label)
      return [s.id, { baris, ...ukuran(baris, s.bentuk), s }]
    })
  )

  // 1. Putus siklus: DFS menurut urutan masukan; tepi ke simpul yang masih di tumpukan dibalik.
  const keluar = new Map<string, number[]>()
  spek.hubungan.forEach((h, i) => keluar.set(h.dari, [...(keluar.get(h.dari) ?? []), i]))
  const dibalik = new Set<number>()
  const status = new Map<string, 1 | 2>()
  const kunjungi = (v: string): void => {
    status.set(v, 1)
    for (const i of keluar.get(v) ?? []) {
      const w = spek.hubungan[i].ke
      const st = status.get(w)
      if (st === 1) dibalik.add(i)
      else if (!st) kunjungi(w)
    }
    status.set(v, 2)
  }
  for (const s of spek.simpul) if (!status.get(s.id)) kunjungi(s.id)
  const tepi = spek.hubungan.map((h, i) => (dibalik.has(i) ? { u: h.ke, v: h.dari } : { u: h.dari, v: h.ke }))

  // 2. Lapis = jalur terpanjang (Kahn).
  const masuk = new Map(spek.simpul.map((s) => [s.id, 0]))
  for (const e of tepi) masuk.set(e.v, (masuk.get(e.v) ?? 0) + 1)
  const lapis = new Map(spek.simpul.map((s) => [s.id, 0]))
  const antre = spek.simpul.filter((s) => masuk.get(s.id) === 0).map((s) => s.id)
  while (antre.length) {
    const u = antre.shift()!
    for (const e of tepi) {
      if (e.u !== u) continue
      lapis.set(e.v, Math.max(lapis.get(e.v)!, lapis.get(u)! + 1))
      masuk.set(e.v, masuk.get(e.v)! - 1)
      if (masuk.get(e.v) === 0) antre.push(e.v)
    }
  }

  // 3. Simpul & rantai bayangan.
  const node = new Map<string, Node>()
  spek.simpul.forEach((s, i) => {
    const d = info.get(s.id)!
    node.set(s.id, {
      id: s.id,
      bayangan: false,
      lapis: lapis.get(s.id)!,
      urut: 0,
      panjangUrut: kiriKanan ? d.h : d.w,
      panjangLapis: kiriKanan ? d.w : d.h,
      kelompok: s.kelompok ? indeksKelompok.get(s.kelompok)! : -1,
      indeks: i,
      pos: 0
    })
  })
  const rantai: string[][] = []
  const pasangan: Array<[string, string]> = []
  let nomor = 0
  tepi.forEach((e) => {
    const la = lapis.get(e.u)!
    const lb = lapis.get(e.v)!
    const jalur = [e.u]
    for (let l = la + 1; l < lb; l++) {
      const id = `~${nomor++}`
      // Simpul bayangan ikut lajur simpul ASALNYA — kalau tidak, garis di dalam satu
      // kelompok dibelokkan keluar ke lajur simpul tanpa kelompok.
      node.set(id, { id, bayangan: true, lapis: l, urut: 0, panjangUrut: 8, panjangLapis: 8, kelompok: node.get(e.u)!.kelompok, indeks: 1e6 + nomor, pos: 0 })
      jalur.push(id)
    }
    jalur.push(e.v)
    rantai.push(jalur)
    for (let k = 0; k + 1 < jalur.length; k++) pasangan.push([jalur[k], jalur[k + 1]])
  })

  const jumlahLapis = Math.max(0, ...[...node.values()].map((n) => n.lapis)) + 1
  const lapisan: Node[][] = Array.from({ length: jumlahLapis }, () => [])
  for (const n of node.values()) lapisan[n.lapis].push(n)
  for (const L of lapisan) {
    L.sort((a, b) => a.kelompok - b.kelompok || a.indeks - b.indeks)
    L.forEach((n, i) => (n.urut = i))
  }
  const pred = new Map<string, string[]>()
  const succ = new Map<string, string[]>()
  for (const [a, b] of pasangan) {
    succ.set(a, [...(succ.get(a) ?? []), b])
    pred.set(b, [...(pred.get(b) ?? []), a])
  }

  // 4. Urutan: barycenter bolak-balik, anggota kelompok dirapatkan.
  const urutkan = (L: Node[], tetangga: Map<string, string[]>): void => {
    const kunci = new Map<string, number>()
    for (const n of L) {
      const t = (tetangga.get(n.id) ?? []).map((id) => node.get(id)!.urut)
      kunci.set(n.id, t.length ? t.reduce((a, b) => a + b, 0) / t.length : n.urut)
    }
    const rataKel = new Map<number, number>()
    for (const k of new Set(L.map((n) => n.kelompok))) {
      if (k < 0) continue
      const a = L.filter((n) => n.kelompok === k)
      rataKel.set(k, a.reduce((s, n) => s + kunci.get(n.id)!, 0) / a.length)
    }
    const utama = (n: Node): number => (n.kelompok >= 0 ? rataKel.get(n.kelompok)! : kunci.get(n.id)!)
    L.sort((a, b) => utama(a) - utama(b) || a.kelompok - b.kelompok || kunci.get(a.id)! - kunci.get(b.id)! || a.indeks - b.indeks)
    L.forEach((n, i) => (n.urut = i))
  }
  for (let iter = 0; iter < 6; iter++) {
    for (let i = 1; i < jumlahLapis; i++) urutkan(lapisan[i], pred)
    for (let i = jumlahLapis - 2; i >= 0; i--) urutkan(lapisan[i], succ)
  }

  // 5. Koordinat sepanjang sumbu urut — per LAJUR.
  //
  // ⚠️ Bila ada kelompok, tiap kelompok mendapat LAJUR (swimlane) dengan pita
  // koordinat sendiri; simpul tanpa kelompok di lajur paling awal. Tanpa lajur,
  // persegi pembungkus kelompok saling menimpa: simpul lebar di satu lapis
  // (belah ketupat keputusan) melebarkan kotak kelompoknya ke wilayah kelompok
  // lain di lapis berikutnya — tertangkap dari PNG uji dari aplikasi 30 Sep.
  // Menambah jarak antar-tetangga TIDAK cukup (sudah dicoba), karena yang
  // bertabrakan persegi pembungkusnya, bukan simpulnya.
  const jarak = (a: Node, b: Node): number =>
    (a.panjangUrut + b.panjangUrut) / 2 + (a.bayangan || b.bayangan ? JARAK_BAYANGAN : JARAK_ANTAR)
  const tempatkan = (L: Node[], ideal: number[]): void => {
    const kiri: number[] = []
    L.forEach((n, i) => (kiri[i] = i === 0 ? ideal[i] : Math.max(ideal[i], kiri[i - 1] + jarak(L[i - 1], n))))
    const kanan: number[] = []
    for (let i = L.length - 1; i >= 0; i--) {
      kanan[i] = i === L.length - 1 ? ideal[i] : Math.min(ideal[i], kanan[i + 1] - jarak(L[i], L[i + 1]))
    }
    L.forEach((n, i) => (n.pos = (kiri[i] + kanan[i]) / 2))
  }
  const daftarLajur = [...new Set([...node.values()].map((n) => n.kelompok))].sort((a, b) => a - b)
  const JARAK_LAJUR = JARAK_ANTAR + 40
  let awalLajur = 0
  for (const lajur of daftarLajur) {
    const sub = lapisan.map((L) => L.filter((n) => n.kelompok === lajur))
    for (const L of sub) {
      let p = 0
      L.forEach((n, i) => {
        if (i > 0) p += jarak(L[i - 1], n)
        n.pos = p
      })
    }
    // Posisi ideal hanya dari tetangga di lajur yang SAMA — koordinat lajur lain belum final.
    const ideal = (n: Node, t: Map<string, string[]>): number => {
      const a = (t.get(n.id) ?? []).map((id) => node.get(id)!).filter((x) => x.kelompok === lajur)
      return a.length ? a.reduce((s, x) => s + x.pos, 0) / a.length : n.pos
    }
    for (let iter = 0; iter < 4; iter++) {
      for (let i = 1; i < jumlahLapis; i++) if (sub[i].length) tempatkan(sub[i], sub[i].map((n) => ideal(n, pred)))
      for (let i = jumlahLapis - 2; i >= 0; i--) if (sub[i].length) tempatkan(sub[i], sub[i].map((n) => ideal(n, succ)))
    }
    const anggota = sub.flat()
    if (!anggota.length) continue
    const min = Math.min(...anggota.map((n) => n.pos - n.panjangUrut / 2))
    const max = Math.max(...anggota.map((n) => n.pos + n.panjangUrut / 2))
    for (const n of anggota) n.pos += awalLajur - min
    awalLajur += max - min + JARAK_LAJUR
  }

  // Sumbu lapis: kumulatif, celah lebih lebar bila ada label garis.
  const adaLabel = spek.hubungan.some((h) => h.label)
  const celah = JARAK_LAPIS + (adaLabel ? 22 : 0)
  const tebal = lapisan.map((L) => Math.max(8, ...L.map((n) => n.panjangLapis)))
  // Lapis tempat sebuah kelompok MULAI butuh ruang untuk judul kelompoknya (30 px di atas
  // kotak) — kalau tidak, label panah yang masuk ke lapis itu jatuh di atas judul kelompok.
  const mulaiKelompok = new Set<number>()
  for (const k of new Set([...node.values()].filter((x) => x.kelompok >= 0).map((x) => x.kelompok))) {
    mulaiKelompok.add(Math.min(...[...node.values()].filter((x) => x.kelompok === k).map((x) => x.lapis)))
  }
  const posLapis: number[] = []
  tebal.forEach(
    (t, i) =>
      (posLapis[i] = i === 0 ? t / 2 : posLapis[i - 1] + tebal[i - 1] / 2 + celah + (mulaiKelompok.has(i) ? 26 : 0) + t / 2)
  )

  const minUrut = Math.min(...[...node.values()].map((n) => n.pos - n.panjangUrut / 2))
  const ke = (n: Node): Titik => {
    const u = n.pos - minUrut + TEPI
    const l = posLapis[n.lapis] + TEPI
    return kiriKanan ? { x: l, y: u } : { x: u, y: l }
  }

  const kotak: Kotak[] = spek.simpul.map((s) => {
    const n = node.get(s.id)!
    const d = info.get(s.id)!
    return { id: s.id, ...ke(n), w: d.w, h: d.h, baris: d.baris, bentuk: s.bentuk, kelompok: s.kelompok }
  })
  const kotakDari = new Map(kotak.map((k) => [k.id, k]))

  // Titik ujung di sisi kotak yang menghadap lapis berikutnya.
  const ujung = (id: string, keluarDari: boolean): Titik => {
    const k = kotakDari.get(id)!
    if (kiriKanan) return { x: k.x + (keluarDari ? k.w / 2 : -k.w / 2), y: k.y }
    return { x: k.x, y: k.y + (keluarDari ? k.h / 2 : -k.h / 2) }
  }
  const garis: Garis[] = spek.hubungan.map((h, i) => {
    const jalur = rantai[i]
    const titik = [ujung(jalur[0], true), ...jalur.slice(1, -1).map((id) => ke(node.get(id)!)), ujung(jalur[jalur.length - 1], false)]
    return { dari: h.dari, ke: h.ke, titik: dibalik.has(i) ? titik.reverse() : titik, label: h.label, putus: h.putus }
  })

  const kelompok: KotakKelompok[] = []
  for (const k of spek.kelompok) {
    const anggota = kotak.filter((x) => x.kelompok === k.id)
    if (!anggota.length) continue
    const x0 = Math.min(...anggota.map((a) => a.x - a.w / 2)) - 16
    const x1 = Math.max(...anggota.map((a) => a.x + a.w / 2)) + 16
    const y0 = Math.min(...anggota.map((a) => a.y - a.h / 2)) - 30
    const y1 = Math.max(...anggota.map((a) => a.y + a.h / 2)) + 14
    kelompok.push({ id: k.id, label: k.label, x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
  }

  // Geser supaya tidak ada yang keluar kanvas (kotak kelompok bisa melewati tepi).
  const semuaX = [...kotak.map((k) => k.x - k.w / 2), ...kelompok.map((k) => k.x)]
  const semuaY = [...kotak.map((k) => k.y - k.h / 2), ...kelompok.map((k) => k.y)]
  const dx = TEPI - Math.min(...semuaX)
  const dy = TEPI - Math.min(...semuaY)
  for (const k of kotak) {
    k.x += dx
    k.y += dy
  }
  for (const k of kelompok) {
    k.x += dx
    k.y += dy
  }
  for (const g of garis) for (const t of g.titik) {
    t.x += dx
    t.y += dy
  }
  const lebar = Math.max(...kotak.map((k) => k.x + k.w / 2), ...kelompok.map((k) => k.x + k.w)) + TEPI
  const tinggi = Math.max(...kotak.map((k) => k.y + k.h / 2), ...kelompok.map((k) => k.y + k.h)) + TEPI
  return { kotak, garis, kelompok, lebar: Math.ceil(lebar), tinggi: Math.ceil(tinggi) }
}

export type { Arah }
