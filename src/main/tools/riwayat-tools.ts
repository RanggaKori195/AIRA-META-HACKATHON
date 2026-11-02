import { ToolError, type ToolDefinition } from './types'
import { cariPesan, pesanTerbaru, type CalonRiwayat } from '../db'
import { cuplikSekitar, ekspresiFts, kataPencarian } from '../riwayat/rules'
import { sesiSekarang } from '../auth/service'
import { buildProvider } from '../llm/factory'
import { loadConfig } from '../config'
import { logger } from '../logger'

// Pencarian riwayat percakapan SENDIRI.
//
// "Minggu lalu saya nanya apa soal Kariadi?" — pertanyaan yang selama ini tidak
// bisa dijawab AIRA sama sekali, padahal jawabannya ada di laptop user.
//
// Cara kerjanya dua tahap, dan pilihan ini disengaja:
//   1. FTS5 lokal menyaring kandidat (cepat, gratis, jalan tanpa jaringan)
//   2. reranker bge (`/v1/rerank`) mengurutkannya menurut MAKNA
//
// ⚠️ Sengaja TIDAK meng-embed setiap pesan seperti RAG dokumen. Embedding per
// pesan berarti satu panggilan HTTP ke gateway pada SETIAP giliran chat —
// gateway yang sama yang sedang melayani percakapannya, dan yang tidak
// terjangkau saat user tidak ber-VPN. Biaya tetap yang dibayar seluruh pemakai
// demi fitur yang dipakai sesekali.

const KANDIDAT_FTS = 40
const KANDIDAT_CADANGAN = 60

interface Hasil {
  sessionId: string
  judul: string
  peran: string
  tanggal: string
  cuplikan: string
}

const tanggalIndo = (ms: number): string =>
  new Date(ms).toLocaleString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })

export const riwayatTools: ToolDefinition[] = [
  {
    name: 'search_history',
    label: 'Cari Riwayat Chat',
    description:
      'Mencari percakapan LAMA milik user sendiri di aplikasi ini — apa yang pernah ia tanyakan ' +
      'dan apa yang pernah AIRA jawab. Pakai tool ini setiap kali user menyinggung percakapan ' +
      'sebelumnya ("kemarin saya tanya apa soal X", "waktu itu jawabannya berapa", "lanjutkan ' +
      'yang minggu lalu"). JANGAN menjawab pertanyaan semacam itu dari ingatanmu sendiri — ' +
      'riwayat percakapan TIDAK ada di dalam contextmu, hanya tool ini yang bisa membacanya.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Kata kunci atau kalimat yang dicari. Pakai kata khas yang kemungkinan besar ' +
            'benar-benar diketik dulu (nama pelanggan, nama item, istilah), bukan kalimat tanya.'
        },
        topK: { type: 'number', description: 'Jumlah hasil (default 6, maksimum 15)' }
      },
      required: ['query']
    },
    tier: 'read',
    timeoutMs: 60_000,
    summarize: (a) => `Cari riwayat: "${a.query}"`,
    execute: async (args) => {
      const query = args.query
      if (typeof query !== 'string' || !query.trim()) {
        throw new ToolError('argumen "query" wajib berupa string')
      }
      // Pemilik diambil dari sesi main process, TIDAK dari argumen model.
      // Kalau username boleh datang dari argumen, satu halusinasi model cukup
      // untuk membaca percakapan direktur.
      const sesi = sesiSekarang()
      if (!sesi) throw new ToolError('belum login — riwayat tidak bisa dicari')

      const topK = Math.min(Math.max(Number(args.topK) || 6, 1), 15)
      const ekspresi = ekspresiFts(query)
      const kata = kataPencarian(query)

      let kandidat: CalonRiwayat[] = []
      let caraCari = 'kata kunci'
      if (ekspresi) kandidat = cariPesan(sesi.username, ekspresi, KANDIDAT_FTS)

      // Cadangan: pencarian kata tidak menemukan apa pun (query diparafrasekan,
      // atau seluruh katanya kata umum). Ambil yang terbaru, biarkan reranker
      // yang menilai maknanya.
      if (kandidat.length === 0) {
        kandidat = pesanTerbaru(sesi.username, KANDIDAT_CADANGAN)
        caraCari = 'percakapan terbaru (tidak ada kata yang cocok persis)'
      }

      if (kandidat.length === 0) {
        return JSON.stringify({
          hasil: [],
          catatanHasil:
            'Tidak ada riwayat percakapan sama sekali untuk akun ini di laptop ini. ' +
            'Riwayat chat disimpan LOKAL per laptop — kalau user pernah memakai AIRA di ' +
            'komputer lain, percakapannya memang tidak ada di sini. Katakan itu apa adanya, ' +
            'jangan menebak isi percakapan yang tidak kamu lihat.'
        })
      }

      // Rerank menurut makna. Gagal (gateway tidak terjangkau) -> tetap pakai
      // urutan bm25; hasil yang agak kurang rapi jauh lebih baik daripada tool
      // yang gagal total.
      let urut = kandidat
      let caraUrut = 'peringkat kata kunci (bm25)'
      try {
        const provider = buildProvider()
        if (provider) {
          const skor = await provider.rerank(
            query,
            kandidat.map((k) => cuplikSekitar(k.teks, kata, 900)),
            loadConfig().rerankModel
          )
          urut = kandidat
            .map((k, i) => ({ k, s: skor[i] ?? 0 }))
            .sort((a, b) => b.s - a.s)
            .map((x) => x.k)
          caraUrut = 'peringkat makna (reranker)'
        }
      } catch (err) {
        logger().warn({ err: String(err) }, 'rerank riwayat gagal — memakai urutan bm25')
      }

      const hasil: Hasil[] = urut.slice(0, topK).map((k) => ({
        sessionId: k.sessionId,
        judul: k.judul,
        peran: k.peran === 'user' ? 'pertanyaan user' : 'jawaban AIRA',
        tanggal: tanggalIndo(k.createdAt),
        cuplikan: cuplikSekitar(k.teks, kata)
      }))

      // ⚠️ `catatanHasil` TIDAK PERNAH kosong.
      //
      // Pelajaran 19 Agu 2026, dua kali pada dokumen yang sama: hasil tool yang
      // diam soal kelengkapannya membuat model MENGARANG cerita tentang apa yang
      // hilang ("~95 ribu karakter terpotong" padahal 31 ribu). Di sini bahayanya
      // sama bentuknya: cuplikan memang dipotong, dan kalau tidak dikatakan,
      // model akan menyimpulkan sendiri isi yang tidak dilihatnya.
      const catatan =
        `Ditemukan ${urut.length} kandidat, ditampilkan ${hasil.length}. ` +
        `Dicari dengan: ${caraCari}. Diurutkan dengan: ${caraUrut}. ` +
        (kata.length > 0 ? `Kata yang dipakai mencari: ${kata.join(', ')}. ` : '') +
        'Setiap "cuplikan" adalah POTONGAN di sekitar kata yang cocok, bukan pesan utuh — ' +
        'kalau user butuh isi lengkapnya, suruh ia membuka percakapan itu di sidebar. ' +
        'Pencarian ini hanya menjangkau riwayat di laptop ini dan hanya milik user ini. ' +
        'Jangan menyatakan pemotongan atau keterbatasan lain di luar yang disebutkan di sini.'

      return JSON.stringify({ hasil, catatanHasil: catatan })
    }
  }
]
