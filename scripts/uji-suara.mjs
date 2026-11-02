// Mengukur seberapa sering transkripsi suara SALAH pada istilah OrderId.
//
// Kenapa ini ada: voice input hanya layak dibangun kalau "ERP", "the lab",
// dan nama pelanggan benar-benar tertranskrip. Pertanyaan yang salah dengar
// menghasilkan angka salah yang TETAP TERDENGAR MEYAKINKAN — kegagalan yang
// seluruh arsitektur AIRA dibangun untuk mencegahnya (HANDOFF §10 no. 8).
//
// Dua langkah:
//   node scripts/uji-suara.mjs lembar   -> tests/uji-suara-bacaan.txt (dibaca keras)
//   node scripts/uji-suara.mjs nilai    -> membandingkan dengan tests/uji-suara-hasil.txt
//
// Di antara keduanya: buka Notepad, dikte tiap baris memakai aplikasi suara,
// simpan sebagai tests/uji-suara-hasil.txt — satu baris per kalimat, urut.
//
// ⚠️ Kalimat sengaja UTUH, bukan kata lepas. Whisper memakai konteks; menguji
// "ERP" sendirian mengukur hal yang berbeda dari yang dipakai user.
import { readFileSync, writeFileSync, existsSync } from 'fs'

const BACAAN = 'tests/uji-suara-bacaan.txt'
const HASIL = 'tests/uji-suara-hasil.txt'
const ISTILAH = 'tests/istilah-uji-suara.json'

/* ------------------------------------------------------------------ lembar */

// Cetakan kalimat yang benar-benar ditanyakan orang ke AIRA. `{x}` diisi istilah.
const CETAKAN = {
  sistem: [
    'Berapa {x} bulan ini dibanding bulan lalu',
    'Tolong jelaskan {x} untuk periode berjalan',
    'Apakah data {x} sudah masuk semuanya'
  ],
  item: [
    'Berapa penjualan {x} bulan ini',
    'Tampilkan tren {x} enam bulan terakhir',
    'Pemeriksaan {x} naik atau turun dibanding tahun lalu'
  ],
  pelanggan: [
    'Berapa order dari {x} bulan ini',
    'Apakah {x} masih aktif order',
    'Tampilkan rincian pemeriksaan untuk {x}'
  ],
  wilayah: ['Berapa sales di {x} bulan ini', 'Pelanggan terbesar di {x} siapa saja']
}

/**
 * Mengubah nama master jadi bentuk yang BENAR-BENAR DIUCAPKAN orang.
 *
 * ⚠️ Ini bukan kosmetik. Master memuat nama seperti
 * "KAL-Onco Breast 4 (ER, PR, HER2, Ki67)" dan
 * "KALCT - Jaringan Small  without Histopot with PA Review" — tidak ada yang
 * membacanya verbatim. Mengujinya apa adanya menghasilkan skor rendah yang
 * mengukur hal yang tidak pernah dilakukan user, lalu menjatuhkan keputusan
 * fitur berdasarkan angka yang salah arti. Pelajaran yang sama dengan
 * pemeriksaan `coba:ppt` versi pertama: alat ukur yang memeriksa hal keliru
 * lebih berbahaya daripada tidak ada alat ukur.
 *
 * Yang dibuang: isi tanda kurung (daftar kode penanda), spasi ganda, dan ekor
 * kualifikasi teknis sesudah " - ". Yang disisakan: inti nama yang diucapkan.
 */
function untukDiucapkan(nama) {
  return nama
    .replace(/\([^)]*\)/g, ' ') // buang "(ER, PR, HER2, Ki67)"
    .replace(/\s+-\s+.*$/, '') // buang ekor sesudah " - "
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}]+$/u, '') // buang ekor tanda baca: "Cytology *" -> "Cytology"
    .trim()
}

function buatLembar() {
  if (!existsSync(ISTILAH)) {
    console.error(`${ISTILAH} belum ada — jalankan dulu: node scripts/ambil-istilah-uji.mjs`)
    process.exit(1)
  }
  const { kelompok } = JSON.parse(readFileSync(ISTILAH, 'utf8'))
  const baris = []
  const dirapikan = []
  const dilewati = []
  for (const [nama, daftar] of Object.entries(kelompok)) {
    const cetakan = CETAKAN[nama] ?? ['{x}']
    daftar.forEach((asli, i) => {
      const istilah = untukDiucapkan(asli)
      // Sisa yang masih terlalu panjang untuk diucapkan wajar dilewati — dan
      // DISEBUT, bukan didiamkan (aturan: jangan diam soal apa yang dilewatkan).
      if (istilah.length > 45 || istilah.length < 2) {
        dilewati.push(`${nama}: ${asli}`)
        return
      }
      // Merapikan bisa membuat beberapa nama runtuh jadi satu ("KALCT - Jaringan
      // Small/Medium/Large" semuanya jadi "KALCT"). Menguji istilah yang sama
      // tiga kali tidak menambah apa pun selain memboroskan napas pembaca.
      if (baris.some((b) => b.istilah.toLowerCase() === istilah.toLowerCase())) {
        dilewati.push(`${nama}: ${asli} (duplikat "${istilah}")`)
        return
      }
      if (istilah !== asli) dirapikan.push(`${asli}  ->  ${istilah}`)
      baris.push({
        kelompok: nama,
        istilah,
        istilahAsli: asli,
        kalimat: cetakan[i % cetakan.length].replace('{x}', istilah)
      })
    })
  }

  const teks = [
    '# LEMBAR UJI TRANSKRIPSI SUARA — AIRA',
    '#',
    '# Cara pakai:',
    '#   1. Buka Notepad (atau editor apa pun), simpan kosong sebagai:',
    `#      ${HASIL}`,
    '#   2. Baca TIAP baris bernomor di bawah dengan suara wajar, satu per satu,',
    '#      lalu dikte ke Notepad memakai aplikasi suara. SATU BARIS PER KALIMAT,',
    '#      urut, tanpa nomor.',
    '#   3. Jangan dikoreksi manual — yang diukur justru kesalahannya.',
    '#   4. Jalankan: node scripts/uji-suara.mjs nilai',
    '#',
    `# Total ${baris.length} kalimat. Baris diawali "#" tidak ikut dinilai.`,
    ''
  ]
  baris.forEach((b, i) => teks.push(`${String(i + 1).padStart(3, '0')}. ${b.kalimat}`))

  writeFileSync(BACAAN, teks.join('\n') + '\n', 'utf8')
  writeFileSync(BACAAN.replace('.txt', '.json'), JSON.stringify(baris, null, 2), 'utf8')
  console.log(`tersimpan: ${BACAAN} (${baris.length} kalimat)`)
  console.log(`kunci jawaban: ${BACAAN.replace('.txt', '.json')}`)

  if (dirapikan.length) {
    console.log(`\n${dirapikan.length} nama dirapikan agar bisa diucapkan:`)
    for (const d of dirapikan.slice(0, 8)) console.log(`  ${d}`)
    if (dirapikan.length > 8) console.log(`  … dan ${dirapikan.length - 8} lagi`)
  }
  if (dilewati.length) {
    console.log(`\n${dilewati.length} istilah DILEWATI (masih terlalu panjang untuk diucapkan wajar):`)
    for (const d of dilewati) console.log(`  ${d}`)
  }
  console.log(`\nLangkah berikutnya: baca & dikte ke ${HASIL}, lalu "node scripts/uji-suara.mjs nilai"`)
}

/* ------------------------------------------------------------------- nilai */

// Normalisasi seadanya: yang dinilai adalah KATA-nya, bukan tanda baca atau
// besar-kecil huruf. Aplikasi dikte kerap menambah titik/koma sendiri, dan itu
// bukan kesalahan yang merusak pertanyaan.
function normal(s) {
  return s
    .toLowerCase()
    .replace(/[.,!?;:()"'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Jarak Levenshtein — ditulis sendiri, tanpa dependensi baru (§2/§5b).
function jarak(a, b) {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  const cur = new Array(n + 1)
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
    prev = cur.slice()
  }
  return prev[n]
}

const mirip = (a, b) => {
  const p = Math.max(a.length, b.length)
  return p === 0 ? 1 : 1 - jarak(a, b) / p
}

function nilai() {
  const kunciPath = BACAAN.replace('.txt', '.json')
  if (!existsSync(kunciPath)) {
    console.error(`${kunciPath} belum ada — jalankan dulu: node scripts/uji-suara.mjs lembar`)
    process.exit(1)
  }
  if (!existsSync(HASIL)) {
    console.error(`${HASIL} belum ada.\nDikte dulu lembar bacaannya ke berkas itu (lihat ${BACAAN}).`)
    process.exit(1)
  }
  const kunci = JSON.parse(readFileSync(kunciPath, 'utf8'))
  const hasil = readFileSync(HASIL, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))

  // ⚠️ Jumlah baris tidak cocok = penilaian bergeser dan SELURUH angkanya salah,
  // tanpa terlihat salah. Lebih baik berhenti daripada melaporkan angka palsu.
  if (hasil.length !== kunci.length) {
    console.error(
      `BERHENTI: ${HASIL} berisi ${hasil.length} baris, seharusnya ${kunci.length}.\n` +
        'Setiap kalimat wajib satu baris, urut, tanpa nomor. Kalau baris bergeser,\n' +
        'setiap perbandingan sesudahnya ikut salah dan hasilnya tidak berarti apa-apa.'
    )
    process.exit(1)
  }

  const perKelompok = {}
  const gagal = []
  kunci.forEach((k, i) => {
    const diharap = normal(k.kalimat)
    const didengar = normal(hasil[i])
    const istilah = normal(k.istilah)
    // Yang menentukan: apakah ISTILAHNYA utuh di hasil. Sisa kalimat boleh meleset.
    const istilahBenar = didengar.includes(istilah)
    const skorKalimat = mirip(diharap, didengar)

    const g = (perKelompok[k.kelompok] ??= { n: 0, benar: 0, skor: 0 })
    g.n++
    g.skor += skorKalimat
    if (istilahBenar) g.benar++
    else gagal.push({ ...k, didengar: hasil[i], skorKalimat })
  })

  console.log('\n=== HASIL UJI TRANSKRIPSI SUARA ===\n')
  console.log('Kelompok     Istilah benar        Kemiripan kalimat')
  let totalN = 0
  let totalBenar = 0
  for (const [nama, g] of Object.entries(perKelompok)) {
    totalN += g.n
    totalBenar += g.benar
    const pct = ((g.benar / g.n) * 100).toFixed(1)
    console.log(
      `${nama.padEnd(12)} ${String(g.benar).padStart(3)}/${String(g.n).padEnd(3)} (${pct.padStart(5)}%)     ` +
        `${((g.skor / g.n) * 100).toFixed(1)}%`
    )
  }
  console.log(
    `\nTOTAL istilah benar: ${totalBenar}/${totalN} (${((totalBenar / totalN) * 100).toFixed(1)}%)`
  )

  if (gagal.length) {
    console.log(`\n--- ${gagal.length} istilah SALAH DENGAR ---`)
    for (const g of gagal) {
      console.log(`  [${g.kelompok}] "${g.istilah}"`)
      console.log(`      diucapkan : ${g.kalimat}`)
      console.log(`      terdengar : ${g.didengar}`)
    }
  } else {
    console.log('\nTidak ada istilah yang salah dengar.')
  }

  // Aturan §33: nol wajib dibedakan antara "bersih" dan "tidak diperiksa".
  console.log(
    `\n(${totalN} kalimat diperiksa. Angka di atas berarti sesuatu HANYA bila lembar\n` +
      ' bacaan benar-benar dibaca keras dan didikte, bukan disalin-tempel.)'
  )
}

/* -------------------------------------------------------------------- main */

const perintah = process.argv[2]
if (perintah === 'lembar') buatLembar()
else if (perintah === 'nilai') nilai()
else {
  console.log('Pemakaian:')
  console.log('  node scripts/uji-suara.mjs lembar   # buat lembar bacaan')
  console.log('  node scripts/uji-suara.mjs nilai    # nilai hasil dikte')
  process.exit(1)
}
