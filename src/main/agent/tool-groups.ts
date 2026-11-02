// Pengelompokan tool. Mengirim 45+ tool sekaligus menurunkan akurasi pemilihan tool
// pada model lokal (terbukti: model "lupa" web_search, salah pakai Start-Process,
// menyangkal browser_open). Solusinya: kirim kelompok inti + kelompok yang relevan saja.
// Modul murni supaya ter-cover unit test.

export type ToolGroup =
  | 'core'
  | 'browser'
  | 'dev'
  | 'data'
  | 'db'
  | 'mcp'
  | 'sales'
  | 'inno'
  | 'lab'
  | 'onedrive'

/**
 * TAT sampel (menu "Tanya TAT Sample"). Sumbernya `v_sample_tracker` di
 * DB-REPOSITORY — database yang SAMA dengan tool sales, tabel yang berbeda.
 *
 * ⚠️ Dipisahkan dari kelompok `sales` karena IZINNYA beda orang: staf lab perlu
 * melihat backlog dan TAT, belum tentu boleh melihat omzet. Izin ditegakkan per
 * KELOMPOK tool, jadi menumpangkan tool lab ke kelompok sales berarti memberi
 * omzet kepada siapa pun yang boleh melihat TAT.
 */
const LAB_TOOLS = new Set(['lab_backlog', 'lab_lacak', 'lab_rns', 'lab_tat'])

/**
 * Berkas OneDrive (menu "Tanya Dokumen OneDrive").
 *
 * ⚠️ Kelompok sendiri, bukan menumpang `core`, karena izinnya perlu diatur:
 * yang dibaca AIRA adalah berkas kantor milik orang itu — termasuk yang di-share
 * kepadanya oleh divisi lain. Delegated permission sudah membatasi jangkauannya
 * ke apa yang orang itu sendiri boleh lihat, tapi SIAPA yang boleh memakai jalur
 * ini tetap keputusan Super Admin.
 */
const ONEDRIVE_TOOLS = new Set([
  'onedrive_cari',
  'onedrive_daftar',
  'onedrive_ambil',
  'onedrive_simpan',
  'onedrive_index',
  'onedrive_akun',
  'email_daftar',
  'email_baca',
  'email_draf_balasan',
  'kalender_lihat'
])

/** Master data the lab (mode "Ask Master Data"). */
const INNO_TOOLS = new Set([
  'inno_customer_search',
  'inno_customer_count',
  'inno_item_search',
  'inno_item_count',
  'inno_special_price',
  'inno_item_special_price',
  'inno_pks',
  'inno_clinician_search',
  'inno_item_package'
])

const SALES_TOOLS = new Set([
  'sales_summary',
  'sales_compare',
  'sales_breakdown',
  'sales_trend',
  'sales_movers',
  'sales_ytd',
  'sales_customers',
  'sales_report',
  'sales_projection',
  'sales_forecast',
  // Best Estimate setahun (30 Sep 2026) — WAJIB di sini: tanpa ini ia jatuh ke 'core' dan ikut
  // terkirim di Task Baru, yang TIDAK PERNAH boleh menyentuh database (aturan 17).
  'sales_full_year',
  // Status satu transaksi per Order ID (2 Okt 2026) — sama: WAJIB di grup sales, bukan core.
  'sales_order_status',
  // Membaca SalesRepository dari beberapa sudut pandang sekaligus. Sengaja
  // TIDAK menyentuh inno_collection: aturan 10 melarang satu tool menyeberang
  // dua database, dan ternyata tidak perlu — kedua perspektif yang punya data
  // (komersial & operasional) sumbernya tabel yang sama.
  'analisa_lintas_perspektif'
])

const BROWSER_TOOLS = new Set([
  'browser_open',
  'browser_read',
  'browser_click',
  'browser_type',
  'browser_login',
  'browser_screenshot',
  'browser_close'
])

const DEV_TOOLS = new Set([
  'cari_simbol',
  'edit_file',
  'search_code',
  'run_command',
  'run_background',
  'check_process',
  'stop_process',
  // Ruang uji: satu kelompok dengan tool coding lain, karena ia hanya berguna
  // bersama edit_file/write_file — dan kalimat pemicunya sama persis.
  'uji_jalankan'
])

/**
 * Tool SQL bebas — kelompok tersendiri, DIPISAH dari `http_request`.
 *
 * ⚠️ Dulu ketiganya satu kelompok `data`, sehingga menutup akses database berarti
 * ikut mematikan `http_request` (tes API ala Postman) yang tidak ada
 * hubungannya. Yang berbahaya bukan "kelompok data", melainkan SQL bebas ke
 * server produksi: `db_query` menerima connection string dari argumen, jadi user
 * yang tahu kredensialnya bisa menembak `SalesRepository` langsung — termasuk
 * kolom `patient_name`, `dob`, `clin_diagnosis` — melewati SELURUH lapisan izin
 * di atasnya, karena tool sales yang agregat murni tidak dilewati sama sekali.
 */
const DB_TOOLS = new Set(['db_query', 'db_execute'])

const DATA_TOOLS = new Set(['http_request'])

export function groupOf(toolName: string): ToolGroup {
  if (toolName.startsWith('mcp_')) return 'mcp'
  if (SALES_TOOLS.has(toolName)) return 'sales'
  if (INNO_TOOLS.has(toolName)) return 'inno'
  if (LAB_TOOLS.has(toolName)) return 'lab'
  if (ONEDRIVE_TOOLS.has(toolName)) return 'onedrive'
  if (BROWSER_TOOLS.has(toolName)) return 'browser'
  if (DEV_TOOLS.has(toolName)) return 'dev'
  if (DB_TOOLS.has(toolName)) return 'db'
  if (DATA_TOOLS.has(toolName)) return 'data'
  return 'core'
}

// "buka" saja terlalu longgar (mis. "buka dokumen"), jadi harus disertai konteks web.
const BROWSER_HINT =
  /\b(browser|situs|website|web ?site|url|login|log in|masuk ke akun)\b|https?:\/\/|\b[a-z0-9-]+\.(co\.id|com|id|net|org|io)\b|\bbuka\s+(situs|website|web|halaman|browser)\b/i

// ⚠️ Akhiran bahasa Indonesia (-nya, -ku, -an) mematikan `\b` di ujung kata.
// Terukur pada kalimat asli yang dipakai manajemen saat meminta fitur ruang uji
// (21 Agu 2026): "ada yang salah di kodinganku" dan "tolong perbaiki scriptnya"
// TIDAK memicu satu pun kata di daftar lama — `\bkoding\b` gagal pada
// "kodingan", `\bscript\b` gagal pada "scriptnya". Akibatnya persis regresi item
// 18 Agu 2026: tool coding tidak pernah terkirim, dan model menjawab dari
// ingatan alih-alih memakai ruang uji.
//
// Kata yang berbahaya kalau dilonggarkan tetap memakai `\b`: "run" akan
// menjaring "runtuh", "bug" menjaring "bugar", "test" menjaring "testimoni".
const DEV_HINT =
  /\b(kode|koding|coding|script|skrip|program|fungsi|function|refactor|debug|compile|kompilasi|typescript|javascript|python|terminal|deploy|syntax|sintaks|error|exception)\w*|\b(bug|build|jalankan|run|npm|yarn|pip|node|git|commit|perintah|command|server|test)\b|\.(ts|tsx|js|jsx|py|java|go|rb|php|sh|bat|ps1)\b/i

const DATA_HINT =
  /\b(database|db|sql|query|postgres|mysql|mariadb|sqlserver|sqlite|tabel|table|schema|api|endpoint|rest|curl|request|postman|http)\b/i

const SEARCH_HINT =
  /\b(cari|carikan|search|berita|news|terbaru|terkini|informasi|riset|research|internet|google|web)\b/i

// Kata yang sendirian sudah cukup menandakan urusan data penjualan.
const SALES_HINT =
  /\b(sales|penjualan|omzet|omset|revenue|pendapatan|transaksi|invoice|customer|pelanggan|item terlaris|cabang|penjamin|target|erp|nett|gross|ytd|year.?to.?date|growth)\b/i

// Kosakata bisnis lab yang BARU berarti penjualan bila digabung dengan kata performa.
// Regresi nyata: "Item apa yang trennya menurun dibanding bulan lalu?" tidak memuat
// satu pun kata di SALES_HINT, sehingga tool sales tidak ikut terkirim dan model
// malah mengaduk-aduk folder dokumen. Satu kata "item" saja sengaja tidak dipakai
// sebagai pemicu — terlalu longgar untuk chat umum.
//
// Kosakata wilayah ikut di sini karena alasan yang sama: "Kota mana yang paling besar
// bulan ini?" tidak memuat satu pun kata SALES_HINT, jadi tanpa ini tool sales tidak
// pernah terkirim — persis regresi item di atas.
const SALES_SUBJECT =
  /\b(item|items|produk|pemeriksaan|tes|test|layanan|sku|paket|wilayah|daerah|provinsi|propinsi|kota|kabupaten|region|area)\b/i
const SALES_METRIC =
  /\b(laris|laku|terjual|sepi|terlaris|naik|turun|menurun|meningkat|tren|trend|pertumbuhan|growth|terbesar|terkecil|tertinggi|terendah|paling banyak|paling sedikit|paling besar|paling tinggi|paling rendah|penyumbang|dominan|top|peringkat|ranking|kontribusi)\b/i

// Kosakata "pelanggan berhenti". Kalimat seperti "siapa yang sudah lama tidak order?"
// atau "customer mana yang hilang?" tidak selalu memuat kata di SALES_HINT — dan itu
// persis pola regresi 18 Agu 2026 (tool sales tidak pernah terkirim, model mengaduk
// folder dokumen). Frasanya sengaja spesifik supaya tidak menjaring chat umum.
const CHURN_HINT =
  /\b(churn|berhenti\s+(order|pesan|langganan)|tidak\s+(lagi\s+)?(order|pesan)|lama\s+tidak\s+(order|pesan|transaksi)|sudah\s+lama\s+tidak|tidak\s+aktif\s+lagi|pelanggan\s+(baru|hilang|kabur)|customer\s+(baru|hilang))\b/i

// Kosakata ramalan. Pertanyaan seperti "kira-kira bulan depan berapa" atau
// "proyeksi tutup bulan" bisa sama sekali tidak memuat kata di SALES_HINT — dan
// itu persis pola regresi 18 Agu 2026 (tool sales tidak pernah terkirim, model
// mengaduk folder dokumen). Kata "prediksi/forecast" sendirian sudah cukup khas.
const FORECAST_HINT =
  /\b(ramal|ramalan|meramal|prediksi|prediksikan|memprediksi|forecast|forecasting|proyeksi|proyeksikan|perkiraan|memperkirakan|estimasi|outlook|tutup bulan|akhir bulan|bulan depan|kuartal depan|ke depan)\b/i

// Rentang waktu yang khas urusan bisnis.
//
// ⚠️ Dibutuhkan karena kalimat ramalan yang paling wajar sering TIDAK memuat
// subjek maupun metrik: "proyeksi tutup bulan ini" tidak menyebut penjualan,
// item, maupun kata performa apa pun. Tanpa ini tool ramalan tidak pernah
// terkirim — wujud baru dari regresi 18 Agu 2026, dan tertangkap unit test.
//
// "besok"/"jam" sengaja TIDAK di sini, supaya "perkiraan cuaca besok" dan
// "kira-kira jam berapa rapatnya" tidak ikut terjaring.
const PERIODE_BISNIS =
  /\b(tutup bulan|akhir bulan|bulan depan|bulan ini|bulan lalu|kuartal|triwulan|semester|tahun ini|tahun depan|ytd)\b/i

/** Pemicu kelompok sales: kata kuat, atau pasangan subjek + metrik performa. */
export function isSalesQuestion(text: string): boolean {
  if (SALES_HINT.test(text) || CHURN_HINT.test(text)) return true
  if (
    FORECAST_HINT.test(text) &&
    (SALES_SUBJECT.test(text) || SALES_METRIC.test(text) || PERIODE_BISNIS.test(text))
  ) {
    return true
  }
  return SALES_SUBJECT.test(text) && SALES_METRIC.test(text)
}

// Master data the lab: pertanyaan "apa yang TERDAFTAR / berapa HARGA DAFTAR", bukan
// pertanyaan transaksi. Kata harga & special price sengaja kuat karena itu pertanyaan
// yang paling sering datang ("carikan special price RS X").
// Ditambah 21 Agu 2026: kosakata master item yang baru dikenali — jenis item,
// laboratorium, kelompok harga marketing, dan isi paket. Tanpa ini, pertanyaan
// sewajarnya seperti "keluarkan item C Coret" atau "paket MCU isinya apa saja"
// tidak memuat satu pun kata pemicu, dan toolnya tidak pernah terkirim — pola
// regresi yang sudah tiga kali terjadi di project ini.
//
// "paket" sendirian sengaja TIDAK dipakai: ia juga kata pemicu sales
// ("paket apa yang paling laris"). Yang dipakai frasa yang khas master:
// "isi paket", "paket pemeriksaan".
const INNO_HINT =
  /\b(masterdata|inno master|special price|harga khusus|harga item|harga pemeriksaan|price list|pks|perjanjian kerja ?sama|terdaftar|master data|master pelanggan|master item|dokter terdaftar|klinisi|top days|termin|isi paket|isinya apa|paket pemeriksaan|c ?coret|segitiga bertanda|reguler price|single test|patologi klinik|patologi anatomi|mikrobiologi|grup pemeriksaan|kelompok harga)\b/i

/** Pemicu kelompok Master Data. */
export function isInnoQuestion(text: string): boolean {
  return INNO_HINT.test(text)
}

export interface GroupSelection {
  text: string
  /** Nama tool yang sudah pernah dipakai di sesi ini — kelompoknya tetap disertakan. */
  usedTools: string[]
  /** Mode khusus mengunci toolset ke kelompok itu saja. */
  mode?: 'general' | 'sales' | 'masterdata' | 'lab' | 'onedrive'
  /**
   * Menu yang boleh dibuka user ini (hasil aturan role × divisi).
   *
   * ⚠️ WAJIB diisi dari sesi main process. Tanpa ini, izin menu hanya menjaga
   * TOMBOLNYA: seorang SPV tanpa akses "Tanya Data Sales" cukup mengetik "berapa
   * sales bulan ini" di Task Baru untuk mendapat omzet perusahaan lengkap —
   * terjadi nyata dan dilaporkan 20 Agu 2026. Mode umum tidak pernah ditolak
   * (`bolehModeSekarang('general')` selalu true), jadi satu-satunya yang bisa
   * menahan adalah TOOL-nya tidak ikut terkirim.
   *
   * `undefined` diperlakukan sebagai TIDAK PUNYA AKSES apa pun — gagal tertutup,
   * bukan terbuka: pemanggil baru yang lupa mengisinya akan melihat "tool sales
   * tidak muncul" (terlihat, dilaporkan), bukan diam-diam membuka omzet.
   */
  izinMenu?: readonly ('sales' | 'masterdata' | 'lab' | 'onedrive')[]
  /**
   * Apakah user ini Super Admin — satu-satunya yang boleh memakai SQL bebas
   * (`db_query`/`db_execute`). Lihat alasannya di bawah.
   */
  superAdmin?: boolean
}

export function selectGroups(input: GroupSelection): Set<ToolGroup> {
  const bolehSales = input.izinMenu?.includes('sales') === true
  const bolehInno = input.izinMenu?.includes('masterdata') === true
  const bolehLab = input.izinMenu?.includes('lab') === true
  const bolehDrive = input.izinMenu?.includes('onedrive') === true

  // Mode khusus: hanya tool yang relevan yang dikirim. Toolset kecil = pemilihan
  // tool jauh lebih akurat, penting untuk audiens yang menuntut keandalan angka.
  //
  // Kedua mode ini juga MENGUNCI SUMBER DATA: mode sales hanya boleh menyentuh
  // DB-REPOSITORY (transaksi), mode masterdata hanya inno_collection (master).
  // Tidak ada `db` di sini — pertanyaan data dijawab lewat tool yang SQL-nya
  // ditulis manusia, bukan lewat SQL yang disusun model.
  //
  // `chatSend` sudah menolak mode yang tidak diizinkan sebelum sampai ke sini;
  // pemeriksaan ulang ini menjaga kalau kelak ada jalur pemanggilan lain.
  if (input.mode === 'sales') return new Set<ToolGroup>(bolehSales ? ['sales'] : ['core'])
  if (input.mode === 'masterdata') return new Set<ToolGroup>(bolehInno ? ['inno'] : ['core'])
  if (input.mode === 'lab') return new Set<ToolGroup>(bolehLab ? ['lab'] : ['core'])
  // ⚠️ Mode OneDrive membawa `core` JUGA, tidak seperti mode data lainnya.
  // Alasannya: tool OneDrive hanya MENGUNDUH berkas; yang membaca isinya adalah
  // read_word/read_excel/read_pdf di kelompok core. Menguncinya ke satu kelompok
  // berarti AIRA bisa mengambil berkas lalu tidak bisa membukanya.
  if (input.mode === 'onedrive') {
    return new Set<ToolGroup>(bolehDrive ? ['core', 'onedrive'] : ['core'])
  }

  const groups = new Set<ToolGroup>(['core'])
  const text = input.text

  // ⚠️ MODE UMUM (Task Baru) TIDAK PERNAH MENYENTUH DATABASE.
  //
  // Ketentuan user 20 Agu 2026, sesudah kebocoran hari itu: pertanyaan data
  // HARUS lewat menunya sendiri. Tool sales & inno karena itu tidak lagi
  // ditambahkan di sini sama sekali — bahkan untuk user yang BERIZIN membuka
  // kedua menu. Izin menentukan menu mana yang bisa dibuka, bukan apakah angka
  // boleh keluar lewat pintu lain.
  //
  // Ini juga membuat penguncian sumber data benar-benar berarti: selama tool
  // sales bisa dipanggil dari mode umum, "mode sales hanya menyentuh
  // DB-REPOSITORY" hanya berlaku di dalam mode sales, sementara mode umum bisa
  // menyentuh keduanya sekaligus. Pertanyaan data yang datang ke Task Baru
  // dijawab dengan mengarahkan user ke menunya (lihat `saranMenu`).

  // Jendela browser yang kebetulan masih terbuka SENGAJA tidak dijadikan pemicu:
  // jendela sisa dari sesi sebelumnya membuat tool browser ikut terkirim terus,
  // dan model jadi memakainya untuk pertanyaan yang cukup dijawab web_search.
  if (BROWSER_HINT.test(text)) groups.add('browser')
  if (DEV_HINT.test(text)) groups.add('dev')
  if (DATA_HINT.test(text)) groups.add('data')

  // SQL bebas: HANYA Super Admin.
  //
  // ⚠️ `db_query` menerima connection string dari argumen, jadi siapa pun yang
  // tahu kredensialnya bisa menembak `SalesRepository` langsung — termasuk
  // `patient_name`, `dob`, `clin_diagnosis` — dan seluruh aturan tool sales
  // (agregat murni, daftar dimensi tertutup, dasar pengakuan baris) dilewati
  // begitu saja. Membatasinya ke Super Admin tidak MENUTUP lubang itu (yang
  // menutup adalah user Postgres berhak minimal, §10 butir 3b), tapi ia
  // mempersempitnya dari "semua orang yang memegang aplikasi" menjadi satu akun
  // yang memang mengelola sistem.
  if (input.superAdmin === true && DATA_HINT.test(text)) groups.add('db')
  if (SEARCH_HINT.test(text) || BROWSER_HINT.test(text)) groups.add('mcp')

  // Kelompok yang sudah dipakai di sesi ini tidak boleh hilang di tengah percakapan.
  //
  // ⚠️ KECUALI sales/inno bila izinnya tidak ada. Ini jalur kebocoran yang paling
  // mudah terlewat: percakapan LAMA yang dibuat saat user masih punya akses akan
  // memasukkan kembali kelompok sales lewat `usedTools` — sesudah aksesnya
  // dicabut Super Admin. Pencabutan akses harus berlaku pada percakapan yang
  // sudah ada, bukan hanya pada yang baru.
  for (const name of input.usedTools) {
    const g = groupOf(name)
    // Kelompok data TIDAK PERNAH masuk lewat pintu belakang ini. Percakapan lama
    // di mode sales/masterdata meninggalkan jejak `usedTools` berisi tool sales;
    // tanpa penyaringan ini, membuka lagi percakapan itu dari Task Baru akan
    // menghidupkan kembali tool datanya di mode umum.
    if (g === 'sales' || g === 'inno' || g === 'lab' || g === 'onedrive') continue
    if (g === 'db' && input.superAdmin !== true) continue
    groups.add(g)
  }

  return groups
}

/**
 * Menu yang seharusnya dipakai untuk pertanyaan ini, bila ia salah pintu.
 *
 * Dipakai `orchestrator.ts` untuk menyisipkan arahan ke system prompt. Tanpa ini
 * gejalanya buruk dengan cara yang halus: user bertanya soal penjualan di Task
 * Baru, toolnya memang tidak ada, dan model 27B akan **menjawab dari
 * ingatannya** — angka karangan yang terdengar meyakinkan, persis yang paling
 * berbahaya bagi audiens manajemen. Jadi ketiadaan tool harus disertai perintah
 * eksplisit tentang apa yang harus dikatakan.
 *
 * Menangani DUA arah salah pintu:
 *   1. pertanyaan data di mode umum
 *   2. lintas menu — pertanyaan master (harga item, PKS) di dalam mode sales,
 *      atau pertanyaan transaksi (omzet, growth) di dalam mode Master Data
 */
/**
 * Pertanyaan tentang perjalanan sampel di lab: TAT, backlog, RNS, tahap.
 *
 * ⚠️ Akhiran bahasa Indonesia mematikan `\b` di ujung kata — "sampelnya",
 * "tahapannya", "hasilnya" adalah bentuk yang justru paling sering dipakai
 * orang. Pelajaran yang sudah dibayar dua kali di project ini (guard verifikasi
 * dan `DEV_HINT`), jadi kata panjang memakai `\w*`. Kata pendek yang berbahaya
 * bila dilonggarkan tetap `\b`: "tat" akan menjaring "tata", "rns" aman.
 */
const LAB_HINT =
  /\b(tat|rns)\b|\bturn ?around\b|\bretake\b|\bsampel\w*|\bsample\w*|\bbacklog\w*|\borderId ?id\b|\bpreparasi\w*|\bpatologi\w*|\bhistologi\w*|\bsitologi\w*|\bmolekuler\w*|\bbelum keluar\b|\bbelum ada hasil\w*|\bnyangkut\w*|\bmengendap\w*|\btahap\w*/i

export function isLabQuestion(text: string): boolean {
  return LAB_HINT.test(text)
}

export function saranMenu(
  text: string,
  mode: 'general' | 'sales' | 'masterdata' | 'lab' | 'onedrive' | undefined
): 'sales' | 'masterdata' | 'lab' | null {
  // Mode OneDrive TIDAK ikut diarahkan ke mana-mana.
  //
  // ⚠️ Sengaja: menu ini membaca DOKUMEN, dan dokumen bisa berisi apa saja —
  // laporan penjualan, daftar item, hasil lab. Pertanyaan "ringkas laporan sales
  // di file ini" memuat kata pemicu sales, padahal jawabannya justru ada di
  // berkas yang sedang dibuka. Mengarahkannya ke menu Sales berarti menolak
  // menjawab pertanyaan yang sebenarnya bisa dijawab.
  if (mode === 'onedrive') return null
  const sales = isSalesQuestion(text)
  const inno = isInnoQuestion(text)
  const lab = isLabQuestion(text)

  if (mode === 'sales') {
    // Kata master menang atas kata penjualan di sini: "harga item" memuat kata
    // "item" (pemicu sales) DAN "harga item" (pemicu inno), dan yang benar-benar
    // ditanyakan adalah harga daftar — yang tidak ada di SalesRepository.
    if (inno) return 'masterdata'
    // Lab hanya diarahkan bila kata labnya JELAS dan kata penjualannya tidak —
    // "sales per kategori" tidak boleh terlempar ke menu TAT.
    return lab && !sales ? 'lab' : null
  }
  if (mode === 'masterdata') {
    if (lab && !inno) return 'lab'
    return sales && !inno ? 'sales' : null
  }
  if (mode === 'lab') {
    if (inno) return 'masterdata'
    return sales && !lab ? 'sales' : null
  }
  // Mode umum: arahkan ke menu yang sesuai. Lab diperiksa lebih dulu karena
  // pertanyaan TAT kerap memuat kata yang juga memicu sales ("item", "pelanggan"),
  // sementara kata seperti "backlog sampel" tidak pernah berarti penjualan.
  if (lab) return 'lab'
  if (inno) return 'masterdata'
  if (sales) return 'sales'
  return null
}
