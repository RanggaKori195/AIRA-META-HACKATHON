import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { DiagramError, MAKS_SIMPUL, pastikanBerkasHtml, periksaSpek, type SpekDiagram } from '../src/main/diagram/rules'
import { bungkus, tataLetak, type Kotak } from '../src/main/diagram/tata-letak'
import { esc, keSvg } from '../src/main/diagram/svg'
import { keHtml } from '../src/main/diagram/html'

// Diagram interaktif (30 Sep 2026). Model mengisi isi; tata letak milik kode.
// Yang dikunci: penolakan yang menyebut perbaikannya, kotak yang TIDAK saling
// menimpa, siklus tidak membuat macet, dan teks model tidak bisa jadi kode.

const alur = (ubah: Record<string, unknown> = {}): Record<string, unknown> => ({
  judul: 'Alur penerimaan sampel',
  simpul: [
    { id: 'a', label: 'Sampel datang', bentuk: 'terminal' },
    { id: 'b', label: 'Cek kelengkapan formulir' },
    { id: 'c', label: 'Lengkap?', bentuk: 'keputusan' },
    { id: 'd', label: 'Registrasi di LIS', bentuk: 'database', kelompok: 'lab' },
    { id: 'e', label: 'Hubungi pengirim', bentuk: 'orang', kelompok: 'cs' },
    { id: 'f', label: 'Selesai', bentuk: 'terminal' }
  ],
  hubungan: [
    { dari: 'a', ke: 'b' },
    { dari: 'b', ke: 'c' },
    { dari: 'c', ke: 'd', label: 'ya' },
    { dari: 'c', ke: 'e', label: 'tidak' },
    { dari: 'e', ke: 'b', putus: true },
    { dari: 'd', ke: 'f' }
  ],
  kelompok: [
    { id: 'lab', label: 'Laboratorium' },
    { id: 'cs', label: 'Customer Service' }
  ],
  ...ubah
})

const bertumpuk = (a: Kotak, b: Kotak): boolean =>
  Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2

describe('diagram: validasi spesifikasi', () => {
  test('spesifikasi sah dirapikan, bentuk & arah bawaan terisi', () => {
    const s = periksaSpek(alur())
    assert.equal(s.arah, 'atas-bawah')
    assert.equal(s.simpul[1].bentuk, 'proses')
    assert.equal(s.hubungan[4].putus, true)
  })

  test('hubungan ke id yang tidak ada: DITOLAK dan menyebut id yang tersedia (aturan 55)', () => {
    assert.throws(
      () => periksaSpek(alur({ hubungan: [{ dari: 'a', ke: 'Registrasi di LIS' }] })),
      (e: unknown) => e instanceof DiagramError && /Registrasi di LIS/.test(e.message) && /Id yang tersedia: a, b/.test(e.message) && /Pakai id, bukan label/.test(e.message)
    )
  })

  test('bentuk asing, kelompok tak terdaftar, id ganda, label kepanjangan — semuanya menyebut jalan keluar', () => {
    assert.throws(() => periksaSpek(alur({ simpul: [{ id: 'a', label: 'x', bentuk: 'bintang' }], hubungan: [] })), /pilih salah satu: proses/)
    assert.throws(() => periksaSpek(alur({ simpul: [{ id: 'a', label: 'x', kelompok: 'zz' }], hubungan: [], kelompok: [] })), /tambahkan \{id: "zz"/)
    assert.throws(() => periksaSpek(alur({ simpul: [{ id: 'a', label: 'x' }, { id: 'a', label: 'y' }], hubungan: [] })), /dipakai dua kali/)
    assert.throws(() => periksaSpek(alur({ simpul: [{ id: 'a', label: 'x'.repeat(81) }], hubungan: [] })), /taruh di "keterangan"/)
  })

  test('terlalu banyak simpul: disuruh memecah per tahap', () => {
    const simpul = Array.from({ length: MAKS_SIMPUL + 1 }, (_, i) => ({ id: `s${i}`, label: `L${i}` }))
    assert.throws(() => periksaSpek(alur({ simpul, hubungan: [] })), /pecah jadi beberapa diagram/)
  })

  test('berkas wajib .html', () => {
    assert.throws(() => pastikanBerkasHtml('C:/x/diagram.png'), /wajib berakhiran \.html/)
    pastikanBerkasHtml('C:/x/diagram.html')
  })
})

describe('diagram: tata letak', () => {
  test('tidak ada dua kotak yang saling menimpa, semuanya di dalam kanvas', () => {
    const t = tataLetak(periksaSpek(alur()))
    for (let i = 0; i < t.kotak.length; i++) {
      const k = t.kotak[i]
      assert.ok(k.x - k.w / 2 >= 0 && k.y - k.h / 2 >= 0 && k.x + k.w / 2 <= t.lebar && k.y + k.h / 2 <= t.tinggi, k.id)
      for (let j = i + 1; j < t.kotak.length; j++) assert.ok(!bertumpuk(k, t.kotak[j]), `${k.id} menimpa ${t.kotak[j].id}`)
    }
  })

  test('atas-bawah: tiap panah maju ke bawah KECUALI tepi balik; tepi balik tetap berujung di tujuan aslinya', () => {
    const s = periksaSpek(alur())
    const t = tataLetak(s)
    const y = new Map(t.kotak.map((k) => [k.id, k.y]))
    assert.ok(y.get('b')! > y.get('a')! && y.get('c')! > y.get('b')! && y.get('f')! > y.get('d')!)
    const balik = t.garis[4] // e -> b (siklus)
    const kb = t.kotak.find((k) => k.id === 'b')!
    const akhir = balik.titik[balik.titik.length - 1]
    assert.ok(Math.abs(akhir.x - kb.x) < 1 && Math.abs(akhir.y - (kb.y + kb.h / 2)) < 1, 'panah balik berakhir di sisi kotak b')
  })

  test('kiri-kanan: alur maju ke KANAN', () => {
    const t = tataLetak(periksaSpek(alur({ arah: 'kiri-kanan' })))
    const x = new Map(t.kotak.map((k) => [k.id, k.x]))
    assert.ok(x.get('b')! > x.get('a')! && x.get('c')! > x.get('b')!)
  })

  test('siklus murni (a->b->c->a) selesai tanpa macet, semua simpul dapat tempat', () => {
    const t = tataLetak(periksaSpek({ judul: 'Siklus', simpul: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], hubungan: [{ dari: 'a', ke: 'b' }, { dari: 'b', ke: 'c' }, { dari: 'c', ke: 'a' }] }))
    assert.equal(t.kotak.length, 3)
    assert.ok(t.kotak.every((k) => Number.isFinite(k.x) && Number.isFinite(k.y)))
  })

  test('kotak kelompok yang berbeda TIDAK saling menimpa (cacat PNG uji 30 Sep)', () => {
    // Susunan persis diagram uji dari aplikasi: CS -> keputusan -> (tidak: CS) / (ya: Lab ...).
    const t = tataLetak(
      periksaSpek({
        judul: 'Alur',
        kelompok: [{ id: 'cs', label: 'Customer Service' }, { id: 'lab', label: 'Laboratorium' }],
        simpul: [
          { id: 's1', label: 'Sampel datang di Customer Service', bentuk: 'terminal', kelompok: 'cs' },
          { id: 's2', label: 'CS cek kelengkapan formulir', kelompok: 'cs' },
          { id: 's3', label: 'Formulir lengkap?', bentuk: 'keputusan', kelompok: 'cs' },
          { id: 's4', label: 'CS hubungi pengirim', kelompok: 'cs' },
          { id: 's5', label: 'Sampel diserahkan ke Laboratorium', kelompok: 'lab' },
          { id: 's6', label: 'Petugas lab registrasi di LIS', kelompok: 'lab' }
        ],
        hubungan: [
          { dari: 's1', ke: 's2' }, { dari: 's2', ke: 's3' },
          { dari: 's3', ke: 's4', label: 'tidak lengkap' }, { dari: 's4', ke: 's2', label: 'cek ulang' },
          { dari: 's3', ke: 's5', label: 'lengkap' }, { dari: 's5', ke: 's6' }
        ]
      })
    )
    const [a, b] = t.kelompok
    const timpa = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
    assert.ok(!timpa, `kelompok ${a.id} menimpa ${b.id}`)
  })

  test('kotak kelompok melingkupi semua anggotanya', () => {
    const t = tataLetak(periksaSpek(alur()))
    const lab = t.kelompok.find((k) => k.id === 'lab')!
    const d = t.kotak.find((k) => k.id === 'd')!
    assert.ok(d.x - d.w / 2 >= lab.x && d.x + d.w / 2 <= lab.x + lab.w && d.y - d.h / 2 >= lab.y && d.y + d.h / 2 <= lab.y + lab.h)
  })

  test('bungkus: baris ≤ 20 karakter, kata panjang dipotong keras', () => {
    assert.deepEqual(bungkus('Cek kelengkapan formulir permintaan'), ['Cek kelengkapan', 'formulir permintaan'])
    assert.ok(bungkus('x'.repeat(45)).every((b) => b.length <= 20))
  })
})

describe('diagram: teks model tidak pernah jadi kode', () => {
  const jahat = (): SpekDiagram =>
    periksaSpek({
      judul: 'Uji <b>tebal</b>',
      simpul: [
        { id: 'a', label: '<script>alert(1)</script>', keterangan: '</script><script>alert(2)</script>' },
        { id: 'b', label: 'B & "C"' }
      ],
      hubungan: [{ dari: 'a', ke: 'b', label: '<img src=x>' }]
    })

  test('SVG: label di-escape', () => {
    const s = jahat()
    const svg = keSvg(s, tataLetak(s))
    assert.ok(!svg.includes('<script>'))
    assert.ok(!svg.includes('<img'))
    assert.ok(svg.includes('&lt;script&gt;'))
    assert.ok(svg.includes('B &amp; &quot;C&quot;'))
  })

  test('HTML: JSON data tidak bisa memutus tag <script> (</script> di keterangan)', () => {
    const s = jahat()
    const html = keHtml(s, keSvg(s, tataLetak(s)), new Date(2026, 8, 30))
    // Satu-satunya "</script>" yang ada adalah penutup dua tag skrip milik kita sendiri.
    assert.equal(html.match(/<\/script>/gi)?.length, 2)
    assert.ok(html.includes('\\u003c/script>'))
    assert.match(html, /<title>Uji &lt;b&gt;tebal&lt;\/b&gt; — Diagram AIRA<\/title>/)
  })

  test('HTML mandiri: tanpa skrip/stylesheet dari luar', () => {
    const s = periksaSpek(alur())
    const html = keHtml(s, keSvg(s, tataLetak(s)), new Date())
    assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=|https?:\/\/(?!www\.w3\.org)/i)
    assert.match(html, /Dibuat oleh AIRA/)
    assert.equal(esc(`a'b`), 'a&#39;b')
  })
})

describe('diagram: graf padat acak (tanpa tumpang tindih)', () => {
  test('40 simpul, 70 tepi, kelompok & siklus — 5 seed, kedua arah', () => {
    for (let seed = 1; seed <= 5; seed++) {
      let r = seed * 9301
      const acak = (n: number): number => {
        r = (r * 9301 + 49297) % 233280
        return Math.floor((r / 233280) * n)
      }
      const simpul = Array.from({ length: 40 }, (_, i) => ({
        id: `n${i}`,
        label: `Langkah nomor ${i} ${'panjang '.repeat(acak(4))}`.trim(),
        kelompok: acak(3) === 0 ? `k${acak(3)}` : undefined,
        bentuk: ['proses', 'keputusan', 'data', 'database', 'orang', 'terminal'][acak(6)]
      }))
      const hubungan = Array.from({ length: 70 }, () => {
        const a = acak(40)
        let b = acak(40)
        if (b === a) b = (a + 1) % 40
        return { dari: `n${a}`, ke: `n${b}` }
      })
      for (const arah of ['atas-bawah', 'kiri-kanan']) {
        const t = tataLetak(periksaSpek({ judul: 'Acak', arah, simpul, hubungan, kelompok: [0, 1, 2].map((i) => ({ id: `k${i}`, label: `K${i}` })) }))
        for (let i = 0; i < t.kotak.length; i++) {
          for (let j = i + 1; j < t.kotak.length; j++) {
            assert.ok(!bertumpuk(t.kotak[i], t.kotak[j]), `seed ${seed} ${arah}: ${t.kotak[i].id} menimpa ${t.kotak[j].id}`)
          }
        }
        assert.ok(t.garis.every((g) => g.titik.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))))
      }
    }
  })
})
