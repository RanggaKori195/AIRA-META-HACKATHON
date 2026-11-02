import { ToolError, type ToolDefinition } from './types'
import { bagianKeTeks, cariBagian } from '../panduan/isi'
import { panduanSekarang } from '../panduan/keadaan'

// `cari_panduan` — AIRA menjawab pertanyaan TENTANG DIRINYA SENDIRI dari sumber
// yang bisa diperiksa, bukan dari ingatan model.
//
// ⚠️ Kenapa ini perlu ada sebagai TOOL, bukan sebagai paragraf di system prompt:
// pertanyaan "kamu bisa apa saja" dan "gimana caranya bikin PPT" adalah
// pertanyaan yang JAWABANNYA BERUBAH mengikuti izin user dan saklar fitur. Model
// yang menjawabnya dari ingatan akan menyebut menu yang tidak dipunyai orang itu
// dan fitur yang sedang dimatikan — dan karena kalimatnya terdengar rapi, tidak
// ada yang curiga. Itu kegagalan yang sama dengan daftar kode provinsi pada
// validator NIK (§27).
//
// ⚠️ Kelompoknya `core` (lihat `groupOf` — nama ini sengaja tidak masuk set mana
// pun), jadi ia ikut di SEMUA mode. Pertanyaan "gimana caranya" tidak muncul di
// layar panduan; ia muncul saat orang sedang di tengah pekerjaan di menu lain.

export const panduanTools: ToolDefinition[] = [
  {
    name: 'cari_panduan',
    label: 'AIRA Guide',
    description:
      'Panduan resmi pemakaian AIRA — apa yang BISA dan TIDAK BISA dilakukan AIRA, menu apa ' +
      'yang dipunyai user ini, dan langkah memakai tiap fitur. WAJIB dipakai setiap kali user ' +
      'bertanya tentang AIRA sendiri: "kamu bisa apa saja", "apakah kamu bisa membuat PPT", ' +
      '"gimana cara pakai menu ini", "fitur apa saja yang ada", "kenapa menu saya tidak ' +
      'muncul". JANGAN menjawab pertanyaan semacam itu dari ingatanmu: daftar kemampuan dan ' +
      'menu BERBEDA untuk tiap user dan berubah mengikuti saklar fitur, jadi jawaban dari ' +
      'ingatan akan menjanjikan hal yang tidak ada.',
    parameters: {
      type: 'object',
      properties: {
        topik: {
          type: 'string',
          description:
            'Yang ingin diketahui user, dengan kata-katanya sendiri. Boleh kalimat utuh. ' +
            'Kosongkan bila ia bertanya umum ("kamu bisa apa saja").'
        }
      },
      required: []
    },
    tier: 'read',
    timeoutMs: 10_000,
    summarize: (a) => (a.topik ? `Guide: ${String(a.topik)}` : 'AIRA Guide'),
    execute: async (args) => {
      const topik = typeof args.topik === 'string' ? args.topik : ''
      const semua = panduanSekarang()
      if (semua.length === 0) throw new ToolError('panduan tidak tersedia')

      const cocok = cariBagian(semua, topik, 3)

      // ⚠️ `catatanHasil` TIDAK PERNAH kosong, dan di sini ia memikul beban yang
      // lebih berat daripada di tool lain: yang dijaga bukan cuma "jangan
      // mengarang soal pemotongan", tapi "jangan menambah kemampuan yang tidak
      // ada di daftar ini". Daftar SELURUH judul bagian ikut dikirim supaya
      // model tahu apa saja yang ADA tanpa harus memanggil tool berkali-kali.
      const catatan =
        `Ditampilkan ${cocok.length} dari ${semua.length} bagian panduan. ` +
        `Seluruh bagian yang tersedia: ${semua.map((b) => b.judul).join('; ')}. ` +
        'Panduan ini SUDAH disesuaikan dengan izin menu user yang sedang login dan dengan ' +
        'fitur yang benar-benar aktif hari ini. Jawab HANYA dari isi di atas. ' +
        'DILARANG menyebut fitur, menu, template, atau integrasi yang tidak tertulis di sini — ' +
        'termasuk menjanjikan bahwa AIRA bisa membaca email, mengirim pesan, atau menyambung ke ' +
        'sistem lain, kecuali panduan ini menyatakannya. Bagian bertanda "BATAS" WAJIB ikut ' +
        'disampaikan bila relevan dengan yang ditanyakan: user yang salah mengira sebuah fitur ' +
        'ada akan menjanjikannya ke orang lain. Kalau yang ditanyakan tidak ada di panduan, ' +
        'katakan apa adanya bahwa itu belum ada, lalu sarankan menu Masukan & Usulan.'

      return JSON.stringify({
        bagian: cocok.map((b) => ({ judul: b.judul, isi: bagianKeTeks(b) })),
        catatanHasil: catatan
      })
    }
  }
]
