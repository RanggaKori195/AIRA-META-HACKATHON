import type { MenuId, PanduanBagian, PanduanBlok } from '../../shared/ipc'
import { RETENSI_PROMPT_HARI } from '../monitoring/rules'
import { JAM_MULAI, JAM_SELESAI, PEMICU, kalimatAturan } from '../pemantau/rules'

// Panduan pemakaian AIRA — SATU sumber untuk layar Panduan dan untuk tool
// `cari_panduan`.
//
// ⚠️ KENAPA ISINYA DIBANGKITKAN, BUKAN DITULIS SEBAGAI PROSA (aturan 61).
//
// Daftar kemampuan yang diketik manusia akan selalu menyimpang dari kode: ia
// menyebut menu yang orang itu tidak punya, dan menjanjikan fitur yang saklarnya
// sedang mati. Kegagalan itu sudah terjadi dua kali di project ini dengan bentuk
// berbeda — daftar kode provinsi pada validator NIK (§27) dan daftar
// `toolPembaca` yang lupa `read_ppt` (§38). Keduanya terlihat rapi dan
// meyakinkan, keduanya salah.
//
// Karena itu:
//   - bagian "Menu yang kamu punya" disusun dari `izinMenu` sesi;
//   - bagian Microsoft 365 berubah isinya mengikuti `M365_LANJUTAN`;
//   - bagian dikte hanya ada bila model suaranya memang terpasang;
//   - setiap nama tool yang disebut diuji keberadaannya di registry
//     (`tests/panduan.test.ts`).
//
// ⚠️ Isinya sengaja TIDAK ditaruh di berkas markdown di `resources/`. Berkas di
// `resources` wajib didaftarkan `extraResources` dan kegagalannya SUNYI — panduan
// yang hilang hanya di aplikasi terpasang adalah pengulangan persis kegagalan
// font company serif font (§20), templat PPT (§24), dan tree-sitter (§47). Isi di dalam
// kode ikut ter-bundle, ikut ter-typecheck, dan ikut ter-test.

export interface KeadaanPanduan {
  /** Menu yang boleh dibuka user INI. Bukan daftar seluruh menu yang ada. */
  izinMenu: readonly MenuId[]
  /** `M365_LANJUTAN` — email, kalender, simpan-balik. */
  m365Lanjutan: boolean
  /** whisper-cli + modelnya ada di laptop ini. */
  suaraTersedia: boolean
}

const MENU_JUDUL: Record<MenuId, string> = {
  sales: 'Tanya Data Sales',
  masterdata: 'Ask Master Data',
  lab: 'Tanya TAT Sample',
  onedrive: 'Tanya Microsoft 365'
}

const MENU_ISI: Record<MenuId, PanduanBlok[]> = {
  sales: [
    {
      jenis: 'paragraf',
      teks:
        'Angka penjualan diambil langsung dari database transaksi, dihitung oleh query yang ' +
        'ditulis manusia — bukan disimpulkan AIRA dari ingatan. Yang diakui sebagai sales ' +
        'adalah tanggal hasil/invoice keluar; kalau kamu ingin ORDER YANG MASUK, sebutkan ' +
        'kata "order" di pertanyaanmu.'
    },
    {
      jenis: 'daftar',
      butir: [
        'Ringkasan & perbandingan periode, tren harian, YTD tahun ini vs tahun lalu',
        'Pemeriksaan terlaris & tersepi, item yang trennya naik atau turun',
        'Pelanggan terbesar, pelanggan yang berhenti order, pelanggan baru',
        'Sebaran per provinsi dan per jenis pelanggan',
        'Proyeksi tutup bulan berjalan dan ramalan beberapa bulan ke depan',
        'Best Estimate satu tahun penuh (aktual + proyeksi + ramalan, dengan rentang) — mulai bisa dihitung saat sisa tahun tinggal 3 bulan',
        'Laporan jadi (Word, PDF, atau Excel) lengkap dengan grafiknya',
        'Status satu transaksi per Order ID: sudah masuk atau belum, diakui atau dibatalkan, hasil/invoice sudah keluar, sudah masuk ERP'
      ]
    },
    {
      jenis: 'contoh',
      mode: 'sales',
      contoh: [
        'Berapa sales bulan ini dibanding bulan lalu?',
        '10 pelanggan terbesar 30 hari terakhir',
        'Pemeriksaan apa yang trennya menurun?',
        'Proyeksi tutup bulan ini berapa?',
        'Forecast BE full year tahun ini berapa?',
        'Buatkan laporan penjualan bulan ini versi Excel',
        'Order ID [tulis nomornya] sudah masuk dan sudah invoice?'
      ]
    },
    {
      jenis: 'batas',
      butir: [
        'Hanya angka AGREGAT, ditambah STATUS satu transaksi bila kamu menyebut Order ID-nya. Tidak ada satu pun jalan untuk menampilkan nama pasien, tanggal lahir, atau diagnosis — dan cek Order ID juga tidak menampilkan jenis pemeriksaan, harga, maupun pelanggan. Itu batas yang ditegakkan di kode, bukan kebijakan yang bisa diminta pengecualiannya.',
        // Nama menu lain sengaja TIDAK disebut: panduan hanya boleh menyebut menu yang user itu
        // bisa buka (aturan 61, dikunci tests/panduan.test.ts).
        'Cek Order ID menjawab status TRANSAKSINYA, bukan posisi sampel di lab.',
        'Ramalan selalu datang bersama rentang dan akurasi historisnya. Ramalan tanpa rentang adalah tebakan yang menyamar jadi angka.',
        // ⚠️ Menu tujuannya sengaja TIDAK disebut namanya di sini. Ditemukan
        // test sendiri: kalimat ini membuat "Ask Master Data" muncul di
        // panduan orang yang tidak punya menu itu — persis hal yang aturan 61
        // larang. Kalau ia memang punya, AIRA yang akan menyebutkan menunya saat
        // pertanyaannya salah pintu.
        'Harga item dan data master pelanggan tidak dijawab dari sini. Tanyakan saja seperti biasa — AIRA akan menunjukkan menu yang benar, dan bila menu itu tidak ada di sidebarmu berarti akunmu belum diberi aksesnya.'
      ]
    }
  ],
  masterdata: [
    {
      jenis: 'paragraf',
      teks:
        'Master data the lab: pelanggan, item pemeriksaan, harga, special price, PKS, dan ' +
        'dokter. Sumbernya database master, terpisah dari database transaksi — jadi menu ini ' +
        'menjawab "berapa HARGANYA", bukan "berapa TERJUALNYA".'
    },
    {
      jenis: 'daftar',
      butir: [
        'Cari pelanggan dan lihat datanya',
        'Cari item pemeriksaan beserta harganya',
        'Special price per pelanggan maupun per item',
        'PKS (perjanjian kerja sama) dan daftar dokter',
        'Isi paket pemeriksaan'
      ]
    },
    {
      jenis: 'contoh',
      mode: 'masterdata',
      contoh: [
        'Cari pelanggan dengan nama mengandung "Kariadi"',
        'Berapa harga pemeriksaan HPV DNA?',
        'Special price apa saja yang berlaku untuk pelanggan ini?',
        'Isi paket MCU standar apa saja?'
      ]
    },
    {
      jenis: 'batas',
      butir: [
        'Harga yang disajikan hanya K1 (B2B/Corporate) dan K2 (B2C) — ketentuan pemilik data. BPJS dan kelompok harga lain tidak ditampilkan.',
        'Kalau kode harga sebuah item tidak ada di ketentuan, AIRA menampilkannya apa adanya dan tidak menebak artinya.'
      ]
    }
  ],
  lab: [
    {
      jenis: 'paragraf',
      teks:
        'Perjalanan sampel laboratorium: berapa yang menumpuk, sudah sampai tahap mana, ' +
        'berapa lama prosesnya (TAT), dan sampel mana yang perlu diulang (RNS).'
    },
    {
      jenis: 'daftar',
      butir: [
        'Backlog: sampel yang belum keluar hasilnya, beserta umurnya',
        'Lacak satu sampel lewat Order ID',
        'TAT per tahap dan per jenis pemeriksaan',
        'RNS: per jumlah maupun per persentase'
      ]
    },
    {
      jenis: 'contoh',
      mode: 'lab',
      contoh: [
        'Berapa backlog sampel saat ini?',
        'Lacak Order ID ini sudah sampai mana',
        'Pemeriksaan apa yang TAT-nya paling lama bulan ini?',
        'Pemeriksaan apa yang RNS-nya paling banyak?'
      ]
    },
    {
      jenis: 'batas',
      butir: [
        'Datanya hasil ETL, BUKAN real-time. Setiap jawaban menyebutkan kapan terakhir data itu diperbarui — baca kalimat itu sebelum memakai angkanya untuk keputusan hari ini.',
        'Nama pasien tidak pernah ikut keluar, meskipun barisnya ditampilkan per sampel.',
        'Beberapa tahap tidak dilalui semua jenis pemeriksaan. Nol di sebuah tahap berarti "memang tidak lewat situ", bukan "terlambat".'
      ]
    }
  ],
  onedrive: [
    {
      jenis: 'paragraf',
      teks:
        'Mencari dan membaca berkas kerja kamu di OneDrive dan SharePoint. Login memakai akun ' +
        'Microsoft kamu sendiri lewat browser — AIRA hanya bisa melihat berkas yang memang ' +
        'sudah boleh kamu lihat.'
    },
    {
      jenis: 'daftar',
      butir: [
        'Cari berkas berdasarkan nama atau isinya',
        'Menelusuri isi folder — termasuk folder yang di-share rekan ke kamu',
        'Mengambil sebuah berkas lalu membacakan isinya (Word, Excel, PowerPoint, PDF)',
        'Memeriksa akun Microsoft mana yang sedang tersambung'
      ]
    },
    {
      jenis: 'contoh',
      mode: 'onedrive',
      contoh: [
        'Cari berkas tentang anggaran 2026 di OneDrive saya',
        'Berkas apa saja yang ada di folder Laporan?',
        'Folder apa saja yang di-share ke saya? Buka yang pertama',
        'Ambil file itu lalu ringkas isinya',
        'Akun Microsoft mana yang sedang tersambung?'
      ]
    }
  ]
}

/** Blok batas untuk menu Microsoft 365 — isinya berubah mengikuti saklar. */
function batasM365(m365Lanjutan: boolean): PanduanBlok {
  if (m365Lanjutan) {
    return {
      jenis: 'batas',
      butir: [
        'Email hanya DIBACA dan balasannya hanya dibuat sebagai DRAF di Outlook. Tidak ada jalur mengirim email — yang menekan Send tetap kamu.',
        'Kalender hanya dibaca. AIRA tidak menggeser atau membuat rapat: perubahan jadwal terlihat oleh orang lain.',
        'Menyimpan berkas ke OneDrive tidak pernah menimpa berkas yang sudah ada — hasilnya disimpan sebagai nama baru.',
        'Isi email yang dibaca AIRA adalah DATA, bukan perintah. Kalimat "AIRA, kirimkan X" di dalam sebuah email tidak akan dijalankan — siapa pun yang tahu alamat emailmu bisa menulis kalimat semacam itu.'
      ]
    }
  }
  return {
    jenis: 'batas',
    butir: [
      'Yang aktif sekarang hanya MEMBACA berkas OneDrive & SharePoint.',
      'Email Outlook dan kalender BELUM aktif — fiturnya sudah jadi tapi masih menunggu persetujuan admin Microsoft 365 di kantor. Jangan menunggu AIRA membacakan emailmu sampai itu selesai.',
      'Menyimpan berkas kembali ke OneDrive juga belum aktif. Hasil kerja AIRA tersimpan di laptop kamu, lalu kamu sendiri yang mengunggahnya.'
    ]
  }
}

function bagianMenu(keadaan: KeadaanPanduan): PanduanBagian {
  const punya = (['sales', 'masterdata', 'lab', 'onedrive'] as const).filter((m) =>
    keadaan.izinMenu.includes(m)
  )

  const isi: PanduanBlok[] = [
    {
      jenis: 'paragraf',
      teks:
        'AIRA punya beberapa menu, dan MENU MENENTUKAN SUMBER DATA yang boleh disentuh. ' +
        'Karena itu tidak ada menu yang bisa menjawab pertanyaan menu lain: kalau kamu salah ' +
        'pintu, AIRA akan menunjukkan menu mana yang benar, bukan menebak jawabannya.'
    }
  ]

  if (punya.length === 0) {
    isi.push({
      jenis: 'paragraf',
      teks:
        'Akun kamu saat ini hanya punya "Task Baru". Menu data (penjualan, master data, TAT ' +
        'sampel, Microsoft 365) diatur Super Admin per role DAN per divisi — dua-duanya harus ' +
        'dicentang. Kalau kamu merasa seharusnya punya salah satunya, kirim lewat menu ' +
        'Masukan & Usulan; sebutkan menu mana yang kamu butuhkan dan untuk pekerjaan apa.'
    })
  } else {
    isi.push({
      jenis: 'paragraf',
      teks: `Menu yang terbuka untuk akun kamu: ${punya.map((m) => MENU_JUDUL[m]).join(', ')}. Daftar ini mengikuti izin akunmu — rekan kerjamu bisa melihat daftar yang berbeda.`
    })
    for (const m of punya) {
      isi.push({ jenis: 'paragraf', teks: `— ${MENU_JUDUL[m]} —` })
      for (const blok of MENU_ISI[m]) isi.push(blok)
      if (m === 'onedrive') isi.push(batasM365(keadaan.m365Lanjutan))
    }
  }

  isi.push({
    jenis: 'paragraf',
    teks:
      '"Task Baru" adalah menu serbaguna: berkas, dokumen, riset, tulis-menulis, dan koding. ' +
      'Ia SENGAJA tidak pernah menyentuh database — pertanyaan angka penjualan yang diketik di ' +
      'sini akan diarahkan ke menunya, bukan dijawab dari ingatan.'
  })

  return {
    id: 'menu',
    judul: 'Menu yang kamu punya',
    ringkas: 'Menu apa saja yang terbuka untuk akunmu, dan masing-masing menjawab apa.',
    kunci: ['menu', 'akses', 'izin', 'sales', 'masterdata', 'tat', 'onedrive', 'microsoft'],
    isi
  }
}

function bagianDokumen(): PanduanBagian {
  return {
    id: 'dokumen',
    judul: 'Berkas & dokumen',
    ringkas: 'Melampirkan berkas, membaca Word/Excel/PDF/PowerPoint, dan mencari isi dokumen.',
    kunci: ['file', 'berkas', 'dokumen', 'word', 'excel', 'pdf', 'lampiran', 'folder', 'ocr'],
    isi: [
      {
        jenis: 'langkah',
        butir: [
          'Seret berkasnya ke kotak chat, atau klik ikon penjepit untuk memilih dari komputer.',
          'Tulis apa yang kamu mau — "ringkas ini", "ambil tabel di halaman 4", "bandingkan dengan yang bulan lalu".',
          'Untuk berkas yang tinggal di folder (bukan dilampirkan), tambahkan dulu foldernya lewat "Folder Akses" di sidebar.'
        ]
      },
      {
        jenis: 'daftar',
        butir: [
          'Word, Excel, PowerPoint, PDF, dan berkas teks biasa — dibaca isinya, bukan ditebak dari namanya',
          'Tabel di dalam PDF bisa diambil terpisah supaya angkanya rapi',
          'Dokumen panjang dibaca BERTAHAP per halaman; AIRA akan melanjutkan sendiri sampai habis',
          'Mencari dokumen berdasarkan ISINYA, bukan hanya nama berkasnya',
          'Mengubah format dokumen Office'
        ]
      },
      {
        jenis: 'paragraf',
        teks:
          'Setiap pembacaan berkas selalu menyertakan keterangan apakah isinya terbaca utuh atau ' +
          'masih ada sisa. Kalau AIRA menyebut sebuah dokumen terpotong, itu karena keterangan ' +
          'tadi memang mengatakannya — bukan karena ia menduga-duga.'
      },
      {
        jenis: 'batas',
        butir: [
          'AIRA hanya menyentuh folder yang KAMU izinkan. Melampirkan satu berkas tidak berarti membuka seluruh foldernya.',
          'Berkas yang dihapus atas permintaanmu masuk Recycle Bin, bukan hilang permanen.',
          'Kalau ada berkas yang dilewati (terlalu besar, formatnya tidak didukung), AIRA menyebutkan berkas dan alasannya. Diam bukan berarti semuanya terbaca.'
        ]
      }
    ]
  }
}

function bagianLaporan(): PanduanBagian {
  return {
    id: 'laporan',
    judul: 'Laporan, Excel & presentasi',
    ringkas: 'Membuat dokumen jadi: Word, PDF, Excel, dan PowerPoint bertema the company.',
    kunci: ['laporan', 'pustaka', 'berkas saya', 'diagram', 'flowchart', 'alur', 'sop', 'ppt', 'presentasi', 'powerpoint', 'slide', 'excel', 'pdf', 'word', 'grafik', 'template', 'rca', 'akar masalah', 'insiden', 'fishbone'],
    isi: [
      {
        jenis: 'langkah',
        butir: [
          'Sebutkan apa yang mau dibuat dan untuk siapa — "buatkan laporan penjualan bulan ini untuk manajemen", "buatkan presentasi 8 slide soal rencana Q4".',
          'Kirimkan bahannya: poin-poin, angka, atau berkas sumber yang dilampirkan.',
          'AIRA menyusun dokumennya, lalu memberi tahu letak berkasnya di komputer kamu.',
          'BUKA dan baca hasilnya sebelum dikirim ke siapa pun.'
        ]
      },
      {
        jenis: 'daftar',
        butir: [
          'Word dan PDF dengan font korporat company serif font',
          'Excel yang rapi, lengkap dengan rumus dan format angka',
          'PowerPoint memakai template korporat the company — sampul, latar isi, dan penutup aslinya',
          'Grafik ikut masuk ke dalam laporan Word, PDF, maupun Excel',
          'Diagram interaktif — alur/SOP, alur sampel, struktur tim, arsitektur sistem: berkas HTML yang bisa digeser, di-zoom, dan diklik, plus gambar PNG untuk ditempel ke PPT/Word',
          'Untuk laporan penjualan, angkanya diambil dari database, bukan diketik ulang',
          'Laporan akar masalah (RCA) sebuah kejadian — alat mati, sampel tertukar, TAT molor: kronologi, 5 Whys, Fishbone, tingkat keparahan, dan tindakan korektif ber-PIC'
        ]
      },
      {
        jenis: 'paragraf',
        teks:
          'Untuk RCA, ceritakan kejadiannya seperti biasa ("alat PCR mati 2 jam tadi pagi, tolong ' +
          'analisa penyebabnya"). Kalau keterangannya belum cukup, AIRA bertanya dulu. Yang belum ' +
          'diketahui ditulis "belum diketahui", bukan ditebak — dan laporannya mencari celah ' +
          'sistem, bukan menyalahkan orang.'
      },
      {
        jenis: 'paragraf',
        teks:
          'Tata letak slide dipilih AIRA dari sembilan susunan yang sudah disiapkan sesuai ' +
          'template the company. Kamu tidak perlu menyebut warna, ukuran huruf, atau posisi kotak — ' +
          'cukup isinya. Grafik di dalam dokumen selalu memakai angka yang sama persis dengan ' +
          'tabel di dokumen itu.'
      },
      {
        jenis: 'paragraf',
        teks:
          'Semua berkas yang pernah dibuat AIRA untukmu — laporan, Excel, presentasi, dan gambar — ' +
          'terkumpul di menu Pustaka di sidebar. Di sana bisa disaring per jenis, dicari, dibuka, ' +
          'atau dilacak ke percakapan asalnya. Berkas yang sudah kamu pindah atau hapus di luar AIRA ' +
          'tetap tercantum dengan tanda "Hilang".'
      },
      {
        jenis: 'batas',
        butir: [
          'Hanya template korporat the company yang tersedia. Belum ada cara mengunggah template PowerPoint sendiri.',
          'Font company serif font tertanam di PDF. Untuk .docx/.xlsx/.pptx font tidak ikut tertanam — di komputer yang tidak punya fontnya, hurufnya akan berganti.',
          'Kalau ada grafik yang gagal dibuat, AIRA menyebutkannya. Dokumen yang kehilangan grafik tanpa keterangan bukan perilaku yang benar — laporkan kalau kamu menemuinya.'
        ]
      }
    ]
  }
}

function bagianKerjaLain(): PanduanBagian {
  return {
    id: 'kerja-lain',
    judul: 'Riset, web, dan koding',
    ringkas: 'Mencari di internet, membuka halaman, menulis kode, dan mengujinya di ruang uji.',
    kunci: ['web', 'internet', 'browser', 'riset', 'kode', 'coding', 'script', 'program', 'sandbox', 'uji'],
    isi: [
      {
        jenis: 'daftar',
        butir: [
          'Mencari di internet dan meringkas hasilnya — sumbernya selalu disebutkan',
          'Membuka halaman web dan membacanya, termasuk mengisi form bila kamu memintanya',
          'Menulis, membaca, dan menyunting berkas kode',
          'Mencari di mana sebuah fungsi DIPAKAI, dan di mana ia DIDEFINISIKAN',
          'Menjalankan kode buatannya sendiri di ruang uji terpisah sebelum menyerahkannya'
        ]
      },
      {
        jenis: 'paragraf',
        teks:
          'Ruang uji itu folder terpisah tempat AIRA boleh menjalankan kode tanpa menyentuh ' +
          'berkasmu. Kalau AIRA mengatakan sebuah kode "sudah diuji", itu hanya muncul bila ' +
          'kodenya memang benar-benar dijalankan — kalimat klaim yang tidak ada buktinya ' +
          'dibuang otomatis dan diganti keterangan "belum dijalankan".'
      },
      {
        jenis: 'batas',
        butir: [
          '"Sudah diuji AIRA" tidak sama dengan "sudah benar". Ujinya ditulis oleh AIRA juga, jadi hijau berarti kode dan ujinya SEPAKAT — belum tentu keduanya benar. Kode untuk hal penting tetap perlu dibaca orang.',
          'Ruang uji menahan KESALAHAN, bukan niat jahat. Isolasinya isolasi folder.',
          'Perintah yang mengubah sesuatu selalu minta persetujuanmu dulu. Perintah yang cuma membaca (mis. cek versi) jalan langsung, supaya dialog persetujuan tidak jadi basa-basi yang kamu klik tanpa baca.'
        ]
      }
    ]
  }
}

function bagianIngatan(): PanduanBagian {
  return {
    id: 'ingatan',
    judul: 'Riwayat chat & ingatan AIRA',
    ringkas: 'Mencari percakapan lama, dan memberi tahu AIRA hal yang perlu diingat tentang kamu.',
    kunci: [
      'riwayat',
      'history',
      'ingat',
      'memori',
      'percakapan',
      'kemarin',
      'lupa',
      'dicatat',
      'monitoring',
      'privasi',
      'dipantau'
    ],
    isi: [
      {
        jenis: 'paragraf',
        teks:
          'Percakapan lama TIDAK otomatis ada di kepala AIRA — yang terbawa hanya beberapa pesan ' +
          'terakhir dari percakapan yang sedang dibuka. Kalau kamu menyinggung percakapan ' +
          'sebelumnya ("kemarin saya tanya apa soal Kariadi?"), AIRA akan mencarinya dulu, bukan ' +
          'mengarang dari ingatan.'
      },
      {
        jenis: 'daftar',
        butir: [
          'Riwayat percakapan tersimpan per akun — orang lain di laptop yang sama tidak melihat punyamu',
          'Bilang "ingat, saya biasanya butuh angka per divisi" dan AIRA akan mengingatnya di percakapan berikutnya',
          'Ingatan itu bisa kamu lihat dan hapus sendiri lewat Settings'
        ]
      },
      {
        jenis: 'batas',
        butir: [
          'AIRA tidak pernah menyimpan NILAI DATA sebagai ingatan — angka omzet, hasil lab, dan sejenisnya sengaja ditolak. Alasannya: angka bulan ini akan salah bulan depan, sementara ingatan ikut terbawa berbulan-bulan.',
          'Riwayat tersimpan di laptop ini. Kalau kamu memakai AIRA di komputer lain, percakapannya memang tidak ada di sini.',
          `Pemakaian AIRA DICATAT dan dapat ditinjau Super Admin: waktu, menu, pertanyaan yang kamu ketik, nama lampiran, dan alat yang dipakai AIRA. Jawaban AIRA dan isi berkas TIDAK ikut dicatat. Teks pertanyaan dihapus dari catatan itu sesudah ${RETENSI_PROMPT_HARI} hari. Karena itu jangan mengetik kata sandi di kotak chat.`
        ]
      }
    ]
  }
}

function bagianSuaraChat(keadaan: KeadaanPanduan): PanduanBagian {
  const isi: PanduanBlok[] = []
  if (keadaan.suaraTersedia) {
    isi.push({
      jenis: 'paragraf',
      teks:
        'Tombol mikrofon di kotak chat mengubah ucapanmu jadi teks. Prosesnya berjalan di ' +
        'laptop ini, suaramu tidak dikirim ke mana pun. Hasilnya DISISIPKAN ke kotak chat, ' +
        'tidak langsung dikirim — periksa dulu, karena nama seperti "ERP" atau ' +
        '"the lab" sering salah dengar, dan pertanyaan yang salah dengar menghasilkan angka ' +
        'yang salah tapi tetap terdengar meyakinkan.'
    })
  } else {
    isi.push({
      jenis: 'paragraf',
      teks:
        'Dikte suara tidak aktif di laptop ini (model suaranya tidak terpasang), jadi tombol ' +
        'mikrofon tidak ditampilkan. Sisanya tetap berjalan normal.'
    })
  }
  isi.push({
    jenis: 'paragraf',
    teks:
      'Tombol "Pesan" di pojok kanan bawah membuka chat antar rekan kerja — terpisah dari ' +
      'percakapan dengan AIRA. Tampilannya seperti WhatsApp Web: daftar percakapan di kiri, ' +
      'ruang chat di kanan.'
  })
  isi.push({
    jenis: 'daftar',
    butir: [
      'Chat pribadi dengan rekan, lengkap dengan tanda ✓ terkirim dan ✓✓ sudah dibaca',
      'Grup: buat lewat ikon orang bertanda + di atas daftar, pilih anggota, lalu beri nama',
      'Admin grup bisa menambah & mengeluarkan anggota, menjadikan admin, dan mengganti nama grup',
      'Hapus pesan sendiri: arahkan kursor ke pesanmu, klik ikon tong sampah',
      'Notifikasi Windows saat ada pesan masuk, dan angka di ikon AIRA di taskbar',
      'Matikan notifikasi per percakapan atau per grup lewat ikon lonceng',
      'Kirim gambar dan dokumen kantor sebagai lampiran'
    ]
  })
  isi.push({
    jenis: 'langkah',
    butir: [
      'Supaya pesan tetap masuk, AIRA harus menyala. Menutup jendela AIRA TIDAK mematikannya — ia pindah ke tray (dekat jam).',
      'Nyalakan "AIRA otomatis saat Windows login" di Settings → Chat rekan, supaya kamu tetap bisa dihubungi sejak laptop dinyalakan.',
      'Untuk benar-benar keluar: klik kanan ikon AIRA di tray, pilih Keluar. Selama AIRA mati, pesan untukmu tidak akan sampai.'
    ]
  })
  isi.push({
    jenis: 'batas',
    butir: [
      'Chat AIRA adalah saluran kerja internal, BUKAN saluran rahasia seperti WhatsApp. Jangan kirim kata sandi, data pribadi pasien, atau hal yang tidak boleh dibaca pihak lain.',
      'Hanya ada di laptop — tidak ada aplikasi HP. Rekan yang sedang tidak membuka laptopnya tidak akan menerima pesan sampai AIRA-nya menyala. Untuk hal mendesak, tetap telepon.',
      'Pesan yang dihapus meninggalkan keterangan "Pesan ini dihapus" untuk semua orang, dan tidak bisa dibatalkan.',
      'Anggota baru grup hanya melihat pesan sejak ia ditambahkan. Anggota yang keluar masih bisa membaca pesan lama, tapi tidak menerima pesan baru.',
      'Grup maksimal 100 anggota. Untuk pengumuman ke banyak orang, gunakan email.',
      'Berkas program (.exe, .bat, .ps1) tidak bisa dikirim, lampiran maksimal 5 MB, dan isi lampiran dibersihkan setelah 30 hari — pesannya tetap ada.'
    ]
  })
  return {
    id: 'suara-chat',
    judul: 'Chat antar rekan & dikte suara',
    ringkas: 'Chat pribadi & grup dengan rekan kerja, dan bicara alih-alih mengetik.',
    kunci: [
      'suara',
      'mikrofon',
      'dikte',
      'voice',
      'chat',
      'rekan',
      'teman',
      'kirim file',
      'grup',
      'whatsapp',
      'pesan',
      'hapus pesan',
      'notifikasi',
      'tray',
      'admin grup'
    ],
    isi
  }
}

function bagianTips(): PanduanBagian {
  return {
    id: 'tips',
    judul: 'Cara bertanya supaya jawabannya bagus',
    ringkas: 'Empat kebiasaan yang paling banyak mengubah kualitas jawaban.',
    kunci: ['tips', 'cara bertanya', 'prompt', 'jawaban jelek', 'salah jawab'],
    isi: [
      {
        jenis: 'daftar',
        butir: [
          'Sebutkan PERIODENYA. "Bulan ini", "Januari–Juli 2026", "30 hari terakhir" — tanpa itu AIRA harus menebak, dan tebakan periode mengubah seluruh angka.',
          'Sebutkan untuk SIAPA hasilnya. "Untuk rapat direksi" menghasilkan bentuk yang berbeda dari "untuk saya cek sendiri".',
          'Satu pertanyaan satu kali. Lima pertanyaan dalam satu paragraf membuat jawabannya dangkal di semuanya.',
          'Kalau jawabannya melenceng, katakan bagian mana yang salah — jangan mengulang pertanyaan yang sama persis. AIRA memperbaiki dari koreksi, bukan dari pengulangan.'
        ]
      },
      {
        jenis: 'paragraf',
        teks:
          'Kamu tidak perlu tahu nama fitur atau nama tool. Tulis saja dengan kalimat kerja ' +
          'sehari-hari — "bandingkan", "ringkas", "buatkan", "cari" — AIRA yang memilih caranya.'
      }
    ]
  }
}

function bagianBatas(keadaan: KeadaanPanduan): PanduanBagian {
  const butir = [
    'AIRA tidak membaca email kamu sendiri' +
      (keadaan.m365Lanjutan ? ', kecuali lewat menu Microsoft 365 dan hanya untuk dibaca.' : ' — fitur email masih menunggu persetujuan admin Microsoft 365.'),
    'AIRA tidak mengirim email, tidak memposting apa pun, dan tidak mengubah jadwal siapa pun.',
    'AIRA tidak bisa masuk ke sistem lain (ERP, monitoring, ticketing) kecuali kamu sendiri yang mengeluarkan datanya lalu memberikannya ke AIRA.',
    'Angka yang keluar dari menu data selalu punya sumber. Angka yang muncul TANPA menu data — mis. diketik di Task Baru — patut kamu curigai; tanyakan ulang lewat menunya.',
    'Setiap tindakan yang mengubah atau menghapus sesuatu minta persetujuanmu dulu, dan semuanya tercatat di audit log.',
    'Password tidak pernah diketik sebagai teks chat, dan login di halaman tanpa HTTPS ditolak.'
  ]
  return {
    id: 'batas',
    judul: 'Yang TIDAK bisa dilakukan AIRA',
    ringkas: 'Batas yang sengaja dipasang — baca ini sebelum menjanjikan sesuatu ke orang lain.',
    kunci: ['batas', 'tidak bisa', 'limit', 'keamanan', 'aman', 'privasi', 'email'],
    isi: [
      {
        jenis: 'paragraf',
        teks:
          'Daftar ini sengaja ada di panduan. Asisten yang terdengar bisa segalanya membuat ' +
          'orang menjanjikan hal yang tidak bisa ditepati — dan yang malu belakangan adalah ' +
          'orang yang menjanjikannya, bukan aplikasinya.'
      },
      { jenis: 'batas', butir }
    ]
  }
}

function bagianMasalah(): PanduanBagian {
  return {
    id: 'masalah',
    judul: 'Kalau ada yang salah',
    ringkas: 'Jawaban keliru, menu tidak muncul, atau AIRA berhenti di tengah jalan.',
    kunci: ['error', 'gagal', 'salah', 'lapor', 'bug', 'masukan', 'menu tidak muncul', 'coba lagi'],
    isi: [
      {
        jenis: 'langkah',
        butir: [
          'Jawaban gagal atau terputus di tengah: klik "Coba lagi" di bawah jawaban. Pertanyaannya dikirim ulang tanpa menumpuk pertanyaan kembar.',
          'Jawabannya keliru atau angkanya mencurigakan: klik "Laporkan" di jawaban itu. Pertanyaan dan jawabannya ikut terkirim, jadi kami bisa memeriksa yang persis kamu lihat.',
          'Menu yang seharusnya ada tidak muncul: kirim lewat Masukan & Usulan. Akses menu butuh role DAN divisi — sering satu sisi saja yang sudah dicentang.',
          'Usul fitur atau pertanyaan yang belum bisa dijawab AIRA: sama, lewat Masukan & Usulan.'
        ]
      },
      {
        jenis: 'paragraf',
        teks:
          'Laporan lewat tombol Laporkan jauh lebih berguna daripada cerita lisan: kami melihat ' +
          'pertanyaan aslinya, jawaban yang keluar, dan versi aplikasi yang kamu pakai.'
      }
    ]
  }
}

function bagianMulai(keadaan: KeadaanPanduan): PanduanBagian {
  const isi: PanduanBlok[] = [
    {
      jenis: 'paragraf',
      teks:
        'AIRA adalah rekan kerja yang benar-benar mengerjakan, bukan kotak tanya-jawab. Ia ' +
        'membaca berkasmu, menghitung dari database, membuat dokumen, dan menjalankan tugas ' +
        'sampai selesai — semuanya di dalam jaringan the company.'
    },
    {
      jenis: 'langkah',
      butir: [
        'Pilih menu di sebelah kiri. Menu menentukan apa yang boleh disentuh AIRA; "Task Baru" untuk pekerjaan umum.',
        'Tulis maksudmu dengan kalimat biasa. Tidak ada format khusus, tidak perlu menyebut nama fitur.',
        'Kalau ada berkas, seret ke kotak chat atau tambahkan foldernya lewat "Folder Akses".',
        'Baca jawabannya, lalu koreksi bagian yang melenceng. Percakapan tersimpan sendiri di sidebar.'
      ]
    },
    {
      jenis: 'contoh',
      mode: 'general',
      contoh: [
        'Ringkas dokumen yang saya lampirkan ini jadi 5 poin',
        'Buatkan presentasi 8 slide tentang rencana kerja Q4',
        'Cari di folder kerja saya, dokumen mana yang membahas anggaran 2026?',
        'Rapikan tabel di Excel ini lalu buatkan grafiknya'
      ]
    }
  ]
  if (keadaan.izinMenu.length > 0) {
    isi.push({
      jenis: 'paragraf',
      teks:
        'Untuk pertanyaan angka — penjualan, harga, TAT sampel — pakai menunya sendiri, jangan ' +
        'Task Baru. Di sanalah angkanya diambil dari database.'
    })
  }
  return {
    id: 'mulai',
    judul: 'Mulai dari mana',
    ringkas: 'Empat langkah pertama, untuk yang baru pertama kali membuka AIRA.',
    kunci: ['mulai', 'awal', 'baru', 'pertama', 'cara pakai', 'panduan'],
    isi
  }
}

/** Seluruh panduan untuk keadaan tertentu. Urutannya = urutan baca. */
/**
 * Menu Jadwal (29 Sep 2026). ⚠️ Batas "hanya selama AIRA menyala di laptop ini"
 * WAJIB tertulis — tugas yang tidak jalan karena laptop mati terlihat seperti
 * fitur yang rusak bila orangnya tidak pernah diberi tahu.
 */
function bagianJadwal(): PanduanBagian {
  return {
    id: 'jadwal',
    judul: 'Tugas terjadwal (menu Jadwal)',
    ringkas: 'Minta AIRA mengerjakan sesuatu sendiri pada jam tertentu — harian, mingguan, atau bulanan.',
    kunci: ['jadwal', 'terjadwal', 'otomatis', 'rutin', 'tiap', 'setiap', 'pengingat', 'laporan mingguan', 'jam'],
    isi: [
      {
        jenis: 'paragraf',
        teks:
          'Buka menu Jadwal di sidebar, tekan "Tugas baru", tulis perintahnya seperti bertanya di chat, ' +
          'pilih menunya dan kapan diulang. Pada jamnya AIRA menjalankannya sebagai percakapan baru ' +
          'berjudul "Jadwal: …", lalu memberi notifikasi. Hasilnya bisa dibuka dari menu Jadwal atau riwayat chat.'
      },
      {
        jenis: 'batas',
        butir: [
          'Tugas hanya berjalan SELAMA AIRA MENYALA di laptop ini (termasuk saat tersembunyi di tray). Kalau laptop mati, sleep, atau AIRA di-Keluar-kan, tugasnya disusulkan SEKALI begitu AIRA menyala lagi — tidak diulang sebanyak yang terlewat.',
          'Tugas hanya berjalan saat PEMILIKNYA yang login. Laptop yang dipakai bergantian tidak menjalankan tugas orang lain.',
          'Tugas terjadwal tidak pernah menghapus, memindah, menimpa berkas, atau menjalankan perintah — tidak ada orang yang bisa menyetujuinya. Langkah seperti itu dilewati dan disebut di hasilnya. Membuat laporan PDF/Word/Excel/PPT tetap bisa.',
          'Kalau akses menunya dicabut, tugas di menu itu berhenti dijalankan dan ditandai "Tidak dijalankan".'
        ]
      }
    ]
  }
}

/**
 * Pemantau proaktif (20 Okt 2026) — hanya untuk user yang punya menu Sales atau TAT,
 * dan hanya menyebut pemicu yang menunya ia punya. Kalimat aturan & jam dibangkitkan
 * dari konstanta `pemantau/rules.ts`, bukan diketik di sini.
 * ⚠️ Sengaja tanpa kata "pemakaian"/"dicatat": itu kosakata bagian monitoring
 * pemakaian (tentang ORANG), dan pertanyaan "apakah pemakaian saya dicatat" harus
 * tetap menemukan bagian itu, bukan bagian ini (tentang DATA).
 */
function bagianPemantau(keadaan: KeadaanPanduan): PanduanBagian | null {
  const pemicu = PEMICU.filter((p) => keadaan.izinMenu.includes(p.menu))
  if (pemicu.length === 0) return null
  const frasa = pemicu.map((p) => p.judul.charAt(0).toLowerCase() + p.judul.slice(1))
  const daftar = frasa.length > 1 ? `${frasa.slice(0, -1).join(', ')}, atau ${frasa[frasa.length - 1]}` : frasa[0]
  const jam = (h: number): string => `${String(h).padStart(2, '0')}.00`
  return {
    id: 'pemantau',
    judul: 'Pemberitahuan otomatis (pemantau)',
    ringkas: `AIRA memberi tahu duluan bila ${daftar}.`,
    kunci: ['pemantau', 'pemberitahuan', 'notifikasi', 'peringatan', 'alarm', 'macet', 'terlambat', 'anjlok', 'otomatis', 'diperbarui'],
    isi: [
      {
        jenis: 'paragraf',
        teks:
          'AIRA memeriksa data secara berkala dan memberi notifikasi Windows bila ada yang perlu ditindaklanjuti. ' +
          'Pemantau hanya membaca, dan angkanya dihitung kode — bukan dikarang AIRA. Notifikasi hanya berisi ' +
          'jumlah & persen; rinciannya ada di Settings → Pemantau → Riwayat peringatan.'
      },
      { jenis: 'daftar', butir: pemicu.map((p) => `${p.judul}: ${kalimatAturan(p.id)}`) },
      {
        jenis: 'paragraf',
        teks:
          'Klik notifikasinya untuk membuka menu terkait dengan pertanyaan lanjutan sudah terisi di kotak — tekan ' +
          'kirim bila ingin menggali. Tidak perlu diberi tahu? Buka Settings → Pemantau lalu hilangkan centang ' +
          '"Beri tahu saya" pada pemicu itu.'
      },
      {
        jenis: 'batas',
        butir: [
          `Pemantau hanya berjalan SELAMA AIRA MENYALA di laptop ini (termasuk saat tersembunyi di tray), ` +
            `Senin–Sabtu ${jam(JAM_MULAI)}–${jam(JAM_SELESAI)}. Laptop mati atau AIRA di-Keluar-kan = tidak ada pemeriksaan.`,
          ...(pemicu.some((p) => p.menu === 'lab')
            ? [
                'Kategori lab yang tidak mencatat jam terima lab atau belum punya cukup riwayat sampel selesai ' +
                  'tidak dipantau — daftarnya terlihat di Settings → Pemantau.'
              ]
            : []),
          'Libur panjang (mis. Lebaran) bisa memicu pemberitahuan "data belum diperbarui" — itu memang keadaan datanya.'
        ]
      }
    ]
  }
}

export function susunPanduan(keadaan: KeadaanPanduan): PanduanBagian[] {
  const pemantau = bagianPemantau(keadaan)
  return [
    bagianMulai(keadaan),
    bagianMenu(keadaan),
    bagianDokumen(),
    bagianLaporan(),
    bagianKerjaLain(),
    bagianIngatan(),
    bagianJadwal(),
    ...(pemantau ? [pemantau] : []),
    bagianSuaraChat(keadaan),
    bagianTips(),
    bagianBatas(keadaan),
    bagianMasalah()
  ]
}

// ------------------------------------------------------------------ pencarian

const KATA_UMUM = new Set([
  'yang', 'dan', 'atau', 'untuk', 'dari', 'dengan', 'bisa', 'apa', 'saja', 'itu', 'ini',
  'saya', 'kamu', 'aira', 'gimana', 'bagaimana', 'cara', 'tolong', 'aku', 'ada', 'di',
  'ke', 'pada', 'kah', 'apakah', 'nya', 'mau', 'ingin', 'the', 'how', 'what', 'can'
])

export function kataKunci(teks: string): string[] {
  return teks
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((k) => k.length >= 3 && !KATA_UMUM.has(k))
}

function teksBagian(b: PanduanBagian): string {
  const isi = b.isi
    .map((blok) => {
      if (blok.jenis === 'paragraf') return blok.teks
      if (blok.jenis === 'contoh') return blok.contoh.join(' ')
      return blok.butir.join(' ')
    })
    .join(' ')
  return `${b.judul} ${b.ringkas} ${b.kunci.join(' ')} ${isi}`.toLowerCase()
}

/**
 * Mencari bagian panduan yang paling cocok.
 *
 * Sengaja pencarian kata biasa, BUKAN embedding: isinya cuma sepuluh bagian, dan
 * embedding berarti satu panggilan HTTP ke gateway untuk pertanyaan "gimana cara
 * pakai" — pertanyaan yang justru sering muncul saat jaringan sedang bermasalah.
 * Kalau tidak ada yang cocok, kembalikan bagian pembuka: panduan yang mengembalikan
 * kosong membuat model menjawab dari ingatannya sendiri, dan itu yang mau dihindari.
 */
export function cariBagian(
  bagian: PanduanBagian[],
  query: string,
  maks = 3
): PanduanBagian[] {
  const kata = kataKunci(query)
  if (kata.length === 0) return bagian.slice(0, maks)

  const skor = bagian.map((b) => {
    const teks = teksBagian(b)
    let nilai = 0
    for (const k of kata) {
      if (b.judul.toLowerCase().includes(k)) nilai += 4
      if (b.kunci.some((x) => x.includes(k))) nilai += 3
      if (teks.includes(k)) nilai += 1
    }
    return { b, nilai }
  })

  const cocok = skor.filter((s) => s.nilai > 0).sort((a, b) => b.nilai - a.nilai)
  if (cocok.length === 0) return bagian.slice(0, maks)
  return cocok.slice(0, maks).map((s) => s.b)
}

/** Bagian panduan jadi teks datar — dipakai tool `cari_panduan`. */
export function bagianKeTeks(b: PanduanBagian): string {
  const baris: string[] = [`## ${b.judul}`, b.ringkas]
  for (const blok of b.isi) {
    if (blok.jenis === 'paragraf') baris.push(blok.teks)
    else if (blok.jenis === 'langkah') baris.push(...blok.butir.map((x, i) => `${i + 1}. ${x}`))
    else if (blok.jenis === 'daftar') baris.push(...blok.butir.map((x) => `- ${x}`))
    else if (blok.jenis === 'contoh') baris.push(...blok.contoh.map((x) => `- contoh: "${x}"`))
    else baris.push(...blok.butir.map((x) => `- BATAS: ${x}`))
  }
  return baris.join('\n')
}
