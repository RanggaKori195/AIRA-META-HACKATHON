import { ToolError, type ToolDefinition } from './types'
import { jejakTakTersedia, kolomView,
  TAHAPAN,
  backlog,
  lacak,
  peringkatRns,
  ringkasanRns,
  tahapTakTerpakai,
  tat,
  terakhirDiperbarui,
  type Saringan
} from '../lab/tracker'
import {
  MIN_VOLUME_PERSEN,
  catatanDaftar,
  catatanKesegaran,
  catatanOrderVsBaris,
  catatanTahap,
  tahapDari,
  type UrutRns
} from '../lab/rules'

// Tool TAT sampel — menu "Tanya TAT Sample".
//
// Sumbernya `public.v_sample_tracker` di DB-REPOSITORY, database yang SAMA
// dengan tool sales tapi tabel yang berbeda. Dipisahkan jadi kelompok tool
// sendiri karena IZINNYA beda orang: staf lab perlu melihat backlog dan TAT,
// belum tentu boleh melihat omzet. Kalau tool ini menumpang kelompok `sales`,
// memberi akses TAT berarti sekaligus memberi akses omzet — tidak ada cara
// memisahkannya, karena izin ditegakkan per KELOMPOK tool.
//
// ⚠️ Tool di sini mengembalikan BARIS PER SAMPEL, bukan agregat murni. Itu
// penyimpangan sadar dari aturan 3, yang lahir karena `SalesRepository` memuat
// `dob`, `clin_diagnosis`, `pa_diagnosis`, `result`. `v_sample_tracker` tidak
// punya satu pun kolom itu — satu-satunya kolom sensitifnya `patient`, dan
// `patient` tidak pernah ikut di tool mana pun (daftar-izin `KOLOM_AMAN` di
// `lab/rules.ts`). `lab_lacak` juga wajib diberi order_id eksplisit, jadi tidak
// ada cara menyapu daftar pasien.

function teks(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function angka(args: Record<string, unknown>, key: string, bawaan: number): number {
  const v = args[key]
  return typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : bawaan
}

function saringan(args: Record<string, unknown>): Saringan {
  return {
    dari: teks(args, 'dari'),
    sampai: teks(args, 'sampai'),
    category: teks(args, 'category'),
    test: teks(args, 'test'),
    account: teks(args, 'account')
  }
}

/**
 * ⚠️ JANGAN menaruh contoh nilai NYATA di deskripsi parameter.
 *
 * Deskripsi `item` di tool sales dulu menulis contoh konkret, dan begitu model
 * dipaksa memanggil tool tanpa tahu harus mengisi apa, ia memakai contoh itu
 * sebagai nilai bawaan — lengkap dengan query database untuk sebuah sapaan.
 */
const SARING_DESC = {
  dari: { type: 'string', description: 'Tanggal awal order (YYYY-MM-DD). Kosongkan bila user tidak menyebut periode.' },
  sampai: { type: 'string', description: 'Tanggal akhir order (YYYY-MM-DD). Kosongkan bila user tidak menyebut periode.' },
  category: { type: 'string', description: 'Kategori pemeriksaan. Wajib berasal dari kalimat user, jangan diisi sendiri.' },
  test: { type: 'string', description: 'Nama pemeriksaan. Wajib berasal dari kalimat user, jangan diisi sendiri.' },
  account: { type: 'string', description: 'Nama pelanggan/akun pengirim. Wajib berasal dari kalimat user, jangan diisi sendiri.' }
} as const

export const labTools: ToolDefinition[] = [
  {
    name: 'lab_backlog',
    label: 'Pending Samples',
    description:
      'Daftar sampel yang HASILNYA BELUM KELUAR, beserta status tahap dan berapa lama sudah menggantung. ' +
      'Pakai untuk pertanyaan seperti "sampel apa saja yang belum keluar", "apa yang masih nyangkut di lab", ' +
      '"berapa backlog bulan ini". Sampel yang dibatalkan tidak ikut.',
    parameters: {
      type: 'object',
      properties: {
        ...SARING_DESC,
        batas: { type: 'number', description: 'Berapa baris ditampilkan (bawaan 30, maksimum 200).' }
      }
    },
    tier: 'read',
    timeoutMs: 120_000,
    summarize: (a) =>
      `Pending samples${a.category ? ` — ${a.category}` : ''}${a.account ? ` — ${a.account}` : ''}`,
    execute: async (args) => {
      const batas = angka(args, 'batas', 30)
      const hasil = await backlog(saringan(args), batas)
      const segar = await terakhirDiperbarui()
      return JSON.stringify({
        ringkasan: catatanOrderVsBaris(hasil.totalOrder, hasil.totalBaris),
        totalBaris: hasil.totalBaris,
        totalOrder: hasil.totalOrder,
        perStatus: hasil.perStatus,
        perKategori: hasil.perKategori,
        daftarTerlama: hasil.daftar,
        catatanUmur:
          'Kolom umur_hari dan umur_median dalam HARI. ' +
          'Cara mengukurnya: umur dihitung sejak sampel diterima lab; bila sampelnya belum diterima, ' +
          'sejak order divalidasi; bila itu pun kosong, sejak order dibuat. ' +
          'Berjenjang seperti ini supaya sampel yang BELUM sampai lab tetap terhitung, bukan hilang dari daftar.',
        catatanDaftar: catatanDaftar(hasil.daftar.length, hasil.totalBaris, 'backlog sampel'),
        catatanKesegaran: catatanKesegaran(segar),
        catatanPasien:
          'Nama pasien sengaja tidak disertakan. Bila user memintanya, jelaskan bahwa AIRA tidak menyajikan ' +
          'identitas pasien dan arahkan memakai order_id.'
      })
    }
  },

  {
    name: 'lab_lacak',
    label: 'Track Sample',
    description:
      'Track ONE order by Order ID: which stage it is at now, and when each stage happened. ' +
      'Use for questions such as "which stage is this Order ID at", "how far along is this sample". ' +
      'One Order ID can contain several tests; all of them are returned.',
    parameters: {
      type: 'object',
      properties: {
        order_id: {
          type: 'string',
          description:
            "Order ID asked about by the user. MUST be copied exactly from the user's sentence — never invent or guess it."
        }
      },
      required: ['order_id']
    },
    tier: 'read',
    timeoutMs: 60_000,
    summarize: (a) => `Track sample ${a.order_id}`,
    execute: async (args) => {
      const id = teks(args, 'order_id')
      if (!id) throw new ToolError('order_id wajib diisi dan harus berasal dari kalimat user')
      const rows = await lacak(id)
      const hilang = await jejakTakTersedia()
      const segar = await terakhirDiperbarui()
      if (rows.length === 0) {
        return JSON.stringify({
          ditemukan: false,
          order_id: id,
          catatan:
            `Order ID "${id}" TIDAK ADA di data pelacakan sampel. Data ini hanya memuat Patologi Anatomi ` +
            'dan hanya mulai Januari 2026, jadi order di luar itu memang tidak akan ketemu. ' +
            'Sampaikan apa adanya — jangan menebak tahapnya dan jangan mengarang riwayatnya.',
          catatanKesegaran: catatanKesegaran(segar)
        })
      }
      return JSON.stringify({
        ditemukan: true,
        order_id: id,
        jumlahPemeriksaan: rows.length,
        pemeriksaan: rows,
        catatanJejak:
          'Isi "jejak" HANYA memuat tahap yang benar-benar terjadi. Tahap yang tidak muncul berarti belum ' +
          'terjadi ATAU memang tidak berlaku untuk pemeriksaan itu — jangan melaporkannya sebagai ' +
          'keterlambatan tanpa dasar lain.',
        ...(hilang.length
          ? {
              tahapTidakTersedia: hilang,
              catatanTahapHilang:
                `Tahap ${hilang.map((h) => `"${h}"`).join(', ')} TIDAK TERSEDIA di sumber data saat ini ` +
                '(kolomnya tidak ada di view pelacakan). Sebutkan hal ini ke user, dan JANGAN ' +
                'menyimpulkan tahap itu belum terjadi.'
            }
          : {}),
        catatanKesegaran: catatanKesegaran(segar),
        catatanPasien: 'Nama pasien sengaja tidak disertakan.'
      })
    }
  },

  {
    name: 'lab_rns',
    label: 'RNS (Re-collected Samples)',
    description:
      'RNS = Retake New Sample, yaitu sampel yang harus diambil ulang. Mengembalikan jumlah RNS, berapa yang ' +
      'sampel penggantinya sudah datang, berapa yang masih menunggu, dan peringkat pemeriksaan dengan RNS ' +
      'terbanyak. Pakai untuk pertanyaan seperti "sampel apa yang RNS terbanyak", "berapa yang harus diambil ulang".',
    parameters: {
      type: 'object',
      properties: {
        ...SARING_DESC,
        urut: {
          type: 'string',
          enum: ['jumlah', 'persen'],
          description:
            'Urutan peringkat: "jumlah" = paling sering RNS; "persen" = paling tinggi rasionya. ' +
            'Bawaan "jumlah". Hasil kedua-duanya selalu dikembalikan.'
        },
        batas: { type: 'number', description: 'Berapa pemeriksaan diperingkat (bawaan 10, maksimum 50).' }
      }
    },
    tier: 'read',
    timeoutMs: 120_000,
    summarize: (a) => `RNS samples${a.category ? ` — ${a.category}` : ''}`,
    execute: async (args) => {
      const f = saringan(args)
      const batas = angka(args, 'batas', 10)
      const urut = (teks(args, 'urut') as UrutRns) ?? 'jumlah'
      const [ringkas, perJumlah, perPersen, segar] = [
        await ringkasanRns(f),
        await peringkatRns(f, 'jumlah', batas),
        await peringkatRns(f, 'persen', batas),
        await terakhirDiperbarui()
      ]
      return JSON.stringify({
        arti: 'RNS = Retake New Sample: sampel harus diambil ulang. rns_at = kapan diputuskan RNS. new_sample_received_date = kapan sampel penggantinya diterima.',
        ringkasan: ringkas,
        catatanRingkasan:
          `Dari ${ringkas.total} RNS: ${ringkas.penggantiDatang} sampel penggantinya sudah datang, ` +
          `${ringkas.masihMenunggu} MASIH MENUNGGU pengganti, ${ringkas.hasilKeluarTanpaPengganti} hasilnya ` +
          `keluar tanpa catatan sampel pengganti, ${ringkas.batal} dibatalkan. ` +
          'Angka "masih menunggu" adalah yang paling perlu ditindaklanjuti — jangan melaporkan total RNS saja.',
        diurutkanUtama: urut,
        peringkatPerJumlah: perJumlah,
        peringkatPerPersen: perPersen,
        catatanPeringkat:
          '"Terbanyak" punya DUA arti dan keduanya disediakan di sini. peringkatPerJumlah = paling sering ' +
          'kena RNS. peringkatPerPersen = paling tinggi rasionya terhadap volumenya sendiri, dan hanya ' +
          `memuat pemeriksaan dengan minimal ${MIN_VOLUME_PERSEN} baris supaya volume kecil tidak tampil ` +
          'sebagai rasio ekstrem. Sebutkan yang mana yang sedang dipakai; jangan mencampur keduanya dalam satu daftar.',
        catatanKesegaran: catatanKesegaran(segar)
      })
    }
  },

  {
    name: 'lab_tat',
    label: 'Sample TAT',
    description:
      'Turn Around Time sampel: berapa lama tiap tahap, per kategori atau per pemeriksaan, dengan median, ' +
      'p90, dan terlama. Pakai untuk pertanyaan seperti "berapa TAT bulan ini", "pemeriksaan mana yang paling lama".',
    parameters: {
      type: 'object',
      properties: {
        ...SARING_DESC,
        tahap: {
          type: 'string',
          enum: TAHAPAN.map((t) => t.kode),
          description:
            'Tahap yang diukur. Bawaan "total" (sampel diterima lab sampai hasil keluar). ' +
            'Pilih tahap lain hanya bila user memang menanyakan tahap tertentu.'
        },
        per: {
          type: 'string',
          enum: ['category', 'test'],
          description: 'Dikelompokkan per kategori atau per pemeriksaan. Bawaan "category".'
        },
        batas: { type: 'number', description: 'Berapa kelompok ditampilkan (bawaan 15, maksimum 50).' }
      }
    },
    tier: 'read',
    timeoutMs: 120_000,
    summarize: (a) => 'Sample TAT — stage ' + String(a.tahap ?? 'total'),
    execute: async (args) => {
      const kode = teks(args, 'tahap') ?? 'total'
      const tahap = tahapDari(kode)
      if (!tahap) {
        throw new ToolError(
          `tahap "${kode}" tidak dikenal. Pilihannya: ${TAHAPAN.map((t) => t.kode).join(', ')}.`
        )
      }
      // Tahap yang kolomnya dikeluarkan dari view ditolak DENGAN sebab — bukan
      // dibiarkan jatuh jadi galat SQL yang dibaca model sebagai "kendala teknis".
      const ada = await kolomView()
      const kosong = [tahap.dari, tahap.ke].filter((k) => !ada.has(k))
      if (kosong.length) {
        throw new ToolError(
          `tahap "${tahap.kode}" tidak bisa dihitung: kolom ${kosong.join(', ')} tidak tersedia di sumber ` +
            'data pelacakan saat ini (dikeluarkan dari view oleh pengelola ETL). Sampaikan itu apa adanya ' +
            `ke user; tahap lain tetap bisa dihitung: ${TAHAPAN.filter((t) => ada.has(t.dari) && ada.has(t.ke)).map((t) => t.kode).join(', ')}.`
        )
      }
      const f = saringan(args)
      const per = (teks(args, 'per') as 'category' | 'test') ?? 'category'
      const batas = angka(args, 'batas', 15)
      const baris = await tat(f, tahap, per, batas)
      const takTerpakai = await tahapTakTerpakai(f, tahap)
      const segar = await terakhirDiperbarui()
      const ikut = baris.reduce((s, b) => s + b.n, 0)
      return JSON.stringify({
        tahap: tahap.kode,
        tahapLabel: tahap.label,
        satuan: 'hari',
        dikelompokkanPer: per,
        baris,
        catatanTahap: catatanTahap(tahap),
        catatanCakupan:
          `${ikut} baris ikut dihitung untuk tahap ini; ${takTerpakai} baris TIDAK bisa dihitung karena ` +
          'salah satu ujung tahapnya belum/tidak pernah terisi. Angka yang tidak bisa dihitung BUKAN nol ' +
          'dan bukan keterlambatan — jangan memasukkannya ke rata-rata dan jangan melaporkannya sebagai temuan.',
        catatanBeda:
          'TAT berbeda jauh antar kategori. Jangan menyebut satu angka TAT untuk seluruh lab tanpa ' +
          'menyebutkan kategorinya.',
        catatanKesegaran: catatanKesegaran(segar)
      })
    }
  }
]

export const LAB_TOOL_NAMES = labTools.map((t) => t.name)
