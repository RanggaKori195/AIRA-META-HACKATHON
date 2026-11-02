import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { ToolError, type ToolDefinition } from './types'
import {
  berkasDariId,
  berkasDariJalur,
  cariBerkas,
  cariSemuaTempat,
  daftarFolder,
  daftarIsiFolder,
  daftarShare,
  simpanKeDrive,
  unduh,
  type Berkas
} from '../m365/drive'
import {
  penandaAktif,
  pesanNamaKembar,
  pesanPenandaTakDikenal,
  ringkasUntukModel
} from '../m365/berkas'
import { m365Akun, m365Identitas, m365SudahLogin } from '../m365/auth'
import { lupakanPenanda, salinFolder } from '../m365/index-drive'
import { loadConfig, saveConfig } from '../config'
import { indexAllAllowed } from '../rag/auto'
import {
  CATATAN_CAKUPAN,
  catatanDaftar,
  catatanJenis,
  catatanSumber,
  toolPembaca,
  ukuranManusiawi
} from '../m365/rules'

// Tool OneDrive — menu "Tanya Dokumen OneDrive".
//
// ⚠️ Delegated permission: AIRA hanya melihat apa yang orang yang sedang login
// sudah boleh lihat. Tidak ada jalur di sini yang menjangkau OneDrive karyawan
// lain.
//
// Pembacaan isi berkas SENGAJA diserahkan ke tool dokumen yang sudah ada
// (`read_word`, `read_excel`, `read_pdf`, `read_file`). `onedrive_ambil` hanya
// mengunduh lalu menyerahkan jalurnya. Alasannya bukan kemalasan: jalur
// pembacaan yang sudah ada membawa pembacaan bertahap per halaman dan kalimat
// anti-karangan yang dibayar mahal 19–21 Agu 2026. Membuat jalur kedua berarti
// mengulang seluruh pelajaran itu dari nol, dan yang baru pasti lebih longgar.

function teks(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function angka(args: Record<string, unknown>, key: string, bawaan: number, maks: number): number {
  const v = args[key]
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : bawaan
  return Math.max(1, Math.min(n, maks))
}

/**
 * Bentuk ringkas untuk dikirim ke model, sekaligus mencatat penandanya.
 * Setiap item yang dilihat model PUNYA penanda — tanpa itu berkas share
 * tidak bisa dibuka sama sekali (lihat `m365/berkas.ts`).
 */
function ringkas(b: Berkas): Record<string, unknown> {
  return ringkasUntukModel(b, penandaAktif.catat(b))
}

/** Berkas dari penanda yang pernah ditampilkan. Tidak pernah jatuh ke jalur. */
function dariPenanda(p: string): Berkas {
  const b = penandaAktif.cari(p)
  if (!b) throw new ToolError(pesanPenandaTakDikenal(p))
  return b
}

/** Nama untuk ringkasan langkah di layar — tanpa "undefined" (pola aturan 87). */
function namaPenanda(p: unknown): string {
  return penandaAktif.cari(String(p))?.nama ?? 'pilihan dari hasil sebelumnya'
}

const CATATAN_PENANDA =
  'Setiap item punya penanda. Untuk membuka FOLDER: onedrive_daftar dengan penanda-nya. Untuk ' +
  'membaca BERKAS: onedrive_ambil dengan penanda-nya. Item ber-dariShare: true tidak punya jalur ' +
  'dan HANYA bisa dibuka lewat penanda — jangan memakai nama atau lokasinya sebagai jalur.'

export const onedriveTools: ToolDefinition[] = [
  {
    name: 'onedrive_cari',
    label: 'Search OneDrive',
    description:
      'Mencari berkas di OneDrive user berdasarkan kata di nama berkas atau isinya. ' +
      'Pakai untuk "cari file tentang X di OneDrive", "ada dokumen apa soal Y". ' +
      'Mengembalikan daftar berkas — untuk membaca isinya, lanjutkan dengan onedrive_ambil.',
    parameters: {
      type: 'object',
      properties: {
        kata: {
          type: 'string',
          description: 'Kata yang dicari. WAJIB berasal dari kalimat user, jangan diisi sendiri.'
        },
        batas: { type: 'number', description: 'Jumlah hasil (bawaan 20, maksimum 50).' }
      },
      required: ['kata']
    },
    tier: 'read',
    timeoutMs: 60_000,
    summarize: (a) => `Search OneDrive: ${a.kata}`,
    execute: async (args) => {
      const kata = teks(args, 'kata')
      if (!kata) throw new ToolError('kata pencarian wajib diisi dan harus berasal dari kalimat user')
      const batas = angka(args, 'batas', 20, 50)
      // Dua sumber, digabung: OneDrive pribadi punya pencocokan nama yang lebih
      // baik, sedangkan Search API-lah satu-satunya yang menjangkau SharePoint
      // & Teams. Memakai salah satunya saja membuat sebagian berkas user
      // "tidak ada" tanpa sebab yang terlihat.
      const [pribadi, semua] = await Promise.all([
        cariBerkas(kata, batas).catch(() => ({ berkas: [], adaLagi: false })),
        cariSemuaTempat(kata, batas).catch(() => ({ berkas: [], adaLagi: false }))
      ])
      const terlihat = new Set<string>()
      const gabung = [...pribadi.berkas, ...semua.berkas].filter((b) => {
        const kunci = `${b.driveId}:${b.id}`
        if (terlihat.has(kunci)) return false
        terlihat.add(kunci)
        return true
      })
      const hasil = {
        berkas: gabung.slice(0, batas),
        adaLagi: pribadi.adaLagi || semua.adaLagi || gabung.length > batas
      }
      return JSON.stringify({
        akun: m365Akun(),
        hasil: hasil.berkas.map(ringkas),
        catatan: catatanDaftar(hasil.berkas.length, hasil.adaLagi, `pencarian "${kata}"`),
        catatanSumber:
          'Pencarian ini mencakup OneDrive pribadi DAN berkas SharePoint/Teams yang boleh dibuka user.',
        catatanBaca:
          'Kolom bisaDibacaAira menandai berkas yang isinya sanggup dibaca. Untuk yang bernilai ' +
          'false, hanya namanya yang diketahui — jangan menyimpulkan isinya dari nama berkas.',
        catatanPenanda: CATATAN_PENANDA,
        cakupan: CATATAN_CAKUPAN
      })
    }
  },

  {
    name: 'onedrive_daftar',
    label: 'List OneDrive Contents',
    description:
      'Menampilkan isi sebuah folder di OneDrive, daftar berkas yang DI-SHARE orang lain, atau ' +
      'isi sebuah folder lewat PENANDA-nya — termasuk folder yang di-share orang lain, yang HANYA ' +
      'bisa dibuka lewat penanda. Pakai untuk "ada file apa saja di folder X", "apa yang di-share ' +
      'ke saya", "isi folder yang di-share rekan".',
    parameters: {
      type: 'object',
      properties: {
        penanda: {
          type: 'string',
          description:
            'Penanda FOLDER (diawali "od-") dari hasil onedrive_daftar atau onedrive_cari ' +
            'sebelumnya, disalin persis — jangan dikarang. Dipakai untuk membuka folder yang ' +
            'di-share orang lain, atau folder mana pun yang muncul di hasil sebelumnya.'
        },
        folder: {
          type: 'string',
          description:
            'Jalur folder di OneDrive MILIK USER SENDIRI. Kosongkan untuk folder utama. ' +
            'Wajib berasal dari kalimat user atau dari hasil pencarian sebelumnya.'
        },
        share: {
          type: 'boolean',
          description:
            'true = tampilkan yang DI-SHARE orang lain, bukan isi folder milik user sendiri.'
        },
        batas: { type: 'number', description: 'Jumlah item (bawaan 30, maksimum 100).' }
      }
    },
    tier: 'read',
    timeoutMs: 60_000,
    summarize: (a) =>
      a.penanda
        ? `Folder contents: ${namaPenanda(a.penanda)}`
        : a.share === true
          ? 'List of shared files'
          : `OneDrive folder contents: ${a.folder ?? '(root)'}`,
    execute: async (args) => {
      const batas = angka(args, 'batas', 30, 100)
      const penanda = teks(args, 'penanda')
      const share = args.share === true
      const folder = teks(args, 'folder') ?? ''
      // ⚠️ Metadata SEGAR, bukan label dari daftar sebelumnya: Search API melabeli
      // folder sebagai berkas berukuran 0 (terukur 13 Okt 2026), jadi label lama bisa
      // salah ke dua arah. Sekaligus memastikan aksesnya masih ada.
      const induk = penanda ? await berkasDariId(dariPenanda(penanda)) : null
      if (induk) penandaAktif.catat(induk)
      if (induk && !induk.folder) {
        throw new ToolError(
          `"${induk.nama}" adalah berkas, bukan folder. Pakai onedrive_ambil dengan penanda yang ` +
            'sama untuk membaca isinya.'
        )
      }
      const hasil = induk
        ? await daftarIsiFolder(induk, batas)
        : share
          ? await daftarShare(batas)
          : await daftarFolder(folder, batas)
      const konteks = induk
        ? `folder "${induk.nama}"${induk.dariShare ? ` (di-share oleh ${induk.pemilik ?? 'orang lain'})` : ''}`
        : share
          ? 'berkas yang di-share ke user'
          : `folder "${folder || 'utama'}"`
      return JSON.stringify({
        akun: m365Akun(),
        sumber: induk?.dariShare ? 'folder-share' : share ? 'shared-with-me' : 'onedrive-pribadi',
        ...(induk ? { folder: induk.dariShare ? induk.lokasi : induk.jalur } : {}),
        isi: hasil.berkas.map(ringkas),
        catatan: catatanDaftar(hasil.berkas.length, hasil.adaLagi, konteks),
        catatanPenanda: CATATAN_PENANDA,
        ...(induk?.dariShare
          ? {
              catatanShare:
                'Folder ini milik orang lain dan aksesnya bisa dicabut sewaktu-waktu. Isinya ' +
                'tidak punya jalur di OneDrive user — buka subfolder dan berkasnya lewat penanda.'
            }
          : {}),
        ...(share && !induk
          ? {
              catatanShare:
                'Berkas di sini milik orang lain dan aksesnya bisa dicabut sewaktu-waktu. Daftar ini ' +
                'disusun dari riwayat berbagi Microsoft 365; berkas yang dikirim sebagai LAMPIRAN EMAIL ' +
                'tidak termasuk (email belum tersambung). Kalau yang dicari user tidak ada, coba ' +
                'onedrive_cari dengan namanya — jangan menebak nama berkas yang tidak muncul.' +
                (hasil.catatan ? ` ${hasil.catatan}` : '')
            }
          : {}),
        cakupan: CATATAN_CAKUPAN
      })
    }
  },

  {
    name: 'onedrive_ambil',
    label: 'Fetch OneDrive File',
    description:
      'Mengunduh satu berkas dari OneDrive ke komputer supaya isinya bisa dibaca. Pakai PENANDA ' +
      'berkas dari hasil onedrive_cari atau onedrive_daftar — itu satu-satunya cara untuk berkas ' +
      'yang di-share orang lain (berkas share tidak punya jalur). jalur hanya untuk berkas di ' +
      'OneDrive milik user sendiri. Hasilnya menyebutkan tool pembaca yang tepat beserta jalur lokalnya.',
    parameters: {
      type: 'object',
      properties: {
        penanda: {
          type: 'string',
          description:
            'Penanda berkas (diawali "od-") dari hasil onedrive_cari atau onedrive_daftar, ' +
            'disalin persis — jangan pernah dikarang. Cara utama, dan WAJIB untuk berkas share.'
        },
        jalur: {
          type: 'string',
          description:
            'Hanya untuk berkas di OneDrive MILIK USER SENDIRI, bila tidak ada penanda. ' +
            'WAJIB disalin dari hasil tool atau kalimat user — jangan pernah dikarang.'
        }
      }
    },
    tier: 'read',
    timeoutMs: 180_000,
    summarize: (a) =>
      `Fetch OneDrive file: ${a.penanda ? namaPenanda(a.penanda) : (a.jalur ?? '(not specified)')}`,
    execute: async (args) => {
      const penanda = teks(args, 'penanda')
      const jalur = teks(args, 'jalur')
      if (!penanda && !jalur) {
        throw new ToolError(
          'isi penanda berkas dari hasil onedrive_cari/onedrive_daftar (atau jalur, khusus berkas ' +
            'di OneDrive milik user sendiri). Belum ada keduanya — cari berkasnya dulu.'
        )
      }
      let berkas: Berkas
      if (penanda) {
        // ⚠️ Penanda yang tidak dikenal DITOLAK, tidak jatuh ke jalur: jalur
        // dicari di OneDrive user sendiri dan bisa menemukan berkas lain yang
        // kebetulan bernama sama dengan berkas share yang dimaksud.
        berkas = await berkasDariId(dariPenanda(penanda))
        penandaAktif.catat(berkas)
      } else {
        berkas = await berkasDariJalur(jalur!)
        const kembar = penandaAktif.kembaranAsing(berkas)
        if (kembar.length > 0) {
          throw new ToolError(pesanNamaKembar(berkas, penandaAktif.catat(berkas), kembar))
        }
      }
      if (berkas.folder) {
        throw new ToolError(
          `"${berkas.nama}" adalah folder, bukan berkas. Pakai onedrive_daftar dengan penanda ` +
            `"${penandaAktif.catat(berkas)}" untuk melihat isinya.`
        )
      }
      const lokal = await unduh(berkas)
      const pembaca = toolPembaca(berkas.nama)
      return JSON.stringify({
        nama: berkas.nama,
        // Disebut ke user saat mengutip isinya (aturan 8 ONEDRIVE_PROMPT).
        letak: berkas.dariShare ? berkas.lokasi : berkas.jalur,
        jalurLokal: lokal,
        ukuran: ukuranManusiawi(berkas.ukuran),
        diubah: berkas.diubah,
        sumber: catatanSumber(berkas.dariShare === true, berkas.pemilik),
        // SATU nama tool, bukan daftar. Daftar yang bolong pernah membuat
        // berkas .pptx diarahkan ke read_file dan ditolak sebagai berkas biner.
        langkahBerikutnya: pembaca
          ? `Berkas sudah diunduh. Sekarang panggil ${pembaca} dengan path = jalurLokal di atas untuk membaca isinya. Jangan menjawab isi berkas ini sebelum benar-benar membacanya.`
          : `Berkas sudah diunduh, TAPI jenisnya tidak bisa dibaca AIRA${catatanJenis(berkas.nama)}. Katakan apa adanya ke user; jangan menyimpulkan isinya dari nama berkas.`,
        toolPembaca: pembaca,
        cakupan: CATATAN_CAKUPAN
      })
    }
  },

  {
    name: 'onedrive_simpan',
    label: 'Save to OneDrive',
    description:
      'Menyimpan berkas yang ada di komputer ke OneDrive user — misalnya laporan, Excel, atau ' +
      'presentasi yang baru saja dibuat AIRA. Pakai setelah berkasnya jadi, bila user memintanya ' +
      'disimpan ke OneDrive.',
    parameters: {
      type: 'object',
      properties: {
        jalurLokal: {
          type: 'string',
          description: 'Jalur berkas di komputer yang mau disimpan. Harus berkas yang benar-benar ada.'
        },
        folder: {
          type: 'string',
          description:
            'Folder tujuan di OneDrive. Kosongkan untuk folder utama. ' +
            'Wajib berasal dari kalimat user, jangan diisi sendiri.'
        },
        nama: {
          type: 'string',
          description: 'Nama berkas di OneDrive. Kosongkan untuk memakai nama aslinya.'
        }
      },
      required: ['jalurLokal']
    },
    // ⚠️ `write`: ini menaruh berkas di ruang kerja orang, terlihat oleh siapa
    // pun yang punya akses ke foldernya. Persetujuan sekali klik jauh lebih
    // murah daripada berkas yang muncul entah dari mana di folder tim.
    tier: 'write',
    timeoutMs: 180_000,
    summarize: (a) => 'Save to OneDrive: ' + String(a.nama ?? a.jalurLokal),
    execute: async (args) => {
      const lokal = teks(args, 'jalurLokal')
      if (!lokal) throw new ToolError('jalurLokal wajib diisi')
      if (!existsSync(lokal)) {
        throw new ToolError(
          `berkas "${lokal}" tidak ada di komputer. Pastikan berkasnya sudah benar-benar dibuat ` +
            'sebelum menyimpannya — jangan menebak jalurnya.'
        )
      }
      const nama = teks(args, 'nama') ?? basename(lokal)
      const folder = teks(args, 'folder') ?? ''
      const hasil = await simpanKeDrive(lokal, folder, nama)
      return JSON.stringify({
        tersimpan: true,
        namaDiOneDrive: hasil.nama,
        folder: folder || '(folder utama)',
        webUrl: hasil.webUrl,
        catatanNama:
          hasil.nama === nama
            ? 'Nama berkas sesuai yang diminta.'
            : `⚠️ Sudah ada berkas bernama "${nama}" di sana, jadi yang baru disimpan sebagai ` +
              `"${hasil.nama}". Berkas lama TIDAK ditimpa. Sebutkan nama barunya ke user.`,
        cakupan: CATATAN_CAKUPAN
      })
    }
  },

  {
    name: 'onedrive_index',
    label: 'Remembered OneDrive Folders',
    description:
      'Mengatur folder OneDrive mana yang isinya ikut DIINGAT AIRA supaya bisa dicari lewat ' +
      'pencarian semantik (rag_search) tanpa dibuka satu-satu. ' +
      'aksi "lihat" menampilkan daftarnya, "tambah" menambah folder, "hapus" mengeluarkannya, ' +
      '"segarkan" menyalin ulang perubahan terbaru sekarang juga.',
    parameters: {
      type: 'object',
      properties: {
        aksi: {
          type: 'string',
          enum: ['lihat', 'tambah', 'hapus', 'segarkan'],
          description: 'Bawaan "lihat".'
        },
        folder: {
          type: 'string',
          description:
            'Jalur folder OneDrive. Wajib untuk tambah/hapus, dan WAJIB berasal dari kalimat ' +
            'user — jangan pernah memilih folder sendiri. Kosongkan (string kosong) berarti ' +
            'SELURUH OneDrive, dan itu hanya boleh bila user memang memintanya.'
        }
      }
    },
    // ⚠️ `write`: menambah folder berarti seluruh isinya akan diunduh dan
    // dikirim ke endpoint embedding gateway the company. Itu keputusan yang harus
    // disadari user, bukan efek samping dari sebuah kalimat.
    tier: 'write',
    timeoutMs: 600_000,
    summarize: (a) => {
      const aksi = String(a.aksi ?? 'lihat')
      if (aksi === 'lihat') return 'View the OneDrive folders AIRA remembers'
      if (aksi === 'segarkan') return 'Refresh remembered OneDrive folders'
      return `${aksi === 'tambah' ? 'Add' : 'Remove'} remembered folder: ${a.folder ?? '(entire OneDrive)'}`
    },
    execute: async (args) => {
      const aksi = teks(args, 'aksi') ?? 'lihat'
      const cfg = loadConfig()
      const daftar = cfg.onedriveFolders ?? []
      const catatanBiaya =
        'Setiap berkas yang diingat dikirim ke layanan embedding di gateway AI yang dipakai ' +
        'bersama aplikasi lain. Karena itu penyalinan dibatasi per sekali jalan dan sisanya ' +
        'menyusul otomatis — bukan kegagalan.'

      if (aksi === 'lihat') {
        return JSON.stringify({
          folderDiingat: daftar,
          catatan:
            daftar.length === 0
              ? 'Belum ada folder OneDrive yang diingat. Isi OneDrive tetap bisa dicari lewat ' +
                'onedrive_cari, hanya belum masuk pencarian semantik. Tawarkan menambahkan folder ' +
                'bila user memang menginginkannya — jangan menambahkannya sendiri.'
              : `Ada ${daftar.length} folder yang diingat. Isinya ikut tercari lewat rag_search.`,
          catatanBiaya,
          cakupan: CATATAN_CAKUPAN
        })
      }

      if (aksi === 'segarkan') {
        if (daftar.length === 0) throw new ToolError('belum ada folder OneDrive yang diingat')
        const hasil = []
        for (const f of daftar) hasil.push(await salinFolder(f))
        const laporan = await indexAllAllowed()
        return JSON.stringify({
          disegarkan: daftar,
          diunduh: hasil.reduce((n, h) => n + h.diunduh, 0),
          dihapusKarenaHilang: hasil.reduce((n, h) => n + h.dihapus, 0),
          masihAdaSisa: hasil.some((h) => h.masihAdaSisa),
          dilewati: hasil.flatMap((h) => h.dilewati),
          diindeks: laporan.indexed,
          catatan:
            'Berkas yang HILANG dari OneDrive — termasuk yang share-nya dicabut — ikut dihapus ' +
            'dari ingatan AIRA. Berkas yang dilewati tercantum lengkap beserta alasannya; ' +
            'sebutkan ke user bila ada, jangan didiamkan.',
          catatanBiaya,
          cakupan: CATATAN_CAKUPAN
        })
      }

      const folder = args.folder === '' ? '' : teks(args, 'folder')
      if (folder === undefined) {
        throw new ToolError('folder wajib diisi untuk tambah/hapus, dan harus berasal dari kalimat user')
      }

      if (aksi === 'tambah') {
        if (daftar.includes(folder)) {
          return JSON.stringify({
            sudahAda: true,
            folderDiingat: daftar,
            catatan: `Folder "${folder || '(seluruh OneDrive)'}" memang sudah diingat sebelumnya.`,
            cakupan: CATATAN_CAKUPAN
          })
        }
        saveConfig({ ...cfg, onedriveFolders: [...daftar, folder] })
        const salin = await salinFolder(folder)
        const laporan = await indexAllAllowed()
        return JSON.stringify({
          ditambahkan: folder || '(seluruh OneDrive)',
          diunduh: salin.diunduh,
          dilewati: salin.dilewati,
          masihAdaSisa: salin.masihAdaSisa,
          diindeks: laporan.indexed,
          catatan: salin.masihAdaSisa
            ? 'Sebagian berkas belum tersalin pada jalan pertama dan akan menyusul otomatis. ' +
              'Katakan itu ke user supaya ia tidak mengira sudah lengkap.'
            : 'Seluruh berkas yang layak sudah tersalin dan masuk ingatan AIRA.',
          catatanBiaya,
          cakupan: CATATAN_CAKUPAN
        })
      }

      // hapus
      if (!daftar.includes(folder)) {
        throw new ToolError(`folder "${folder || '(seluruh OneDrive)'}" memang tidak ada di daftar`)
      }
      saveConfig({ ...cfg, onedriveFolders: daftar.filter((f) => f !== folder) })
      lupakanPenanda(folder)
      return JSON.stringify({
        dihapusDariDaftar: folder || '(seluruh OneDrive)',
        folderDiingat: daftar.filter((f) => f !== folder),
        catatan:
          'Folder tidak lagi disalin. Salinan yang sudah terlanjur ada akan dibersihkan pada ' +
          'penyegaran berikutnya. Berkasnya di OneDrive TIDAK disentuh sama sekali.',
        cakupan: CATATAN_CAKUPAN
      })
    }
  },

  {
    name: 'onedrive_akun',
    label: 'Akun Microsoft 365',
    description:
      'Menampilkan akun Microsoft 365 yang sedang tersambung di AIRA. ' +
      'Pakai bila user bertanya "saya login sebagai siapa" atau "OneDrive siapa yang dibaca".',
    parameters: { type: 'object', properties: {} },
    tier: 'read',
    timeoutMs: 60_000,
    summarize: () => 'Check Microsoft 365 account',
    execute: async () => {
      const pernah = m365SudahLogin()
      const id = await m365Identitas()
      return JSON.stringify({
        nama: id.nama,
        email: id.email,
        sesiTersimpanSebelumnya: pernah,
        catatan:
          'AIRA membaca OneDrive SEBAGAI akun ini, jadi yang terlihat persis sama dengan yang ' +
          'bisa dibuka orang ini sendiri di OneDrive — tidak lebih.',
        cakupan: CATATAN_CAKUPAN
      })
    }
  }
]

export const ONEDRIVE_TOOL_NAMES = onedriveTools.map((t) => t.name)
