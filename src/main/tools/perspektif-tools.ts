import { ToolError, type ToolDefinition } from './types'
import { buildProvider } from '../llm/factory'
import { loadConfig } from '../config'
import { jakartaToday, resolvePeriod, PERIOD_NAMES, type PeriodName } from '../sales/periods'
import { cariItem } from '../sales/tat'
import { kumpulkanFakta } from '../perspektif/fakta'
import {
  PERSPEKTIF,
  PERSPEKTIF_BELUM_ADA,
  promptPerspektif,
  susunLaporan
} from '../perspektif/laporan'
import {
  angkaTakDidukung,
  deteksiKonflikAngka,
  klaimRagu,
  kumpulkanNilai,
  parseKlaim,
  type KlaimPerspektif
} from '../perspektif/rules'
import { logger } from '../logger'

// `analisa_lintas_perspektif` — satu item pemeriksaan dibaca dari beberapa
// sudut pandang sekaligus (permintaan the gateway admin, 25 Agu 2026: "analisa produk
// pemeriksaan bisa lintas perspektif — marketing, lab, QA").
//
// Idenya dari `mcp-strategy`, TAPI bentuknya sengaja jauh lebih kecil:
// satu giliran chat, bukan job background berjam-jam. AIRA aplikasi laptop —
// job panjang mati begitu lid ditutup, dan itu alasan yang sama yang dulu
// menggugurkan fitur briefing terjadwal (HANDOFF §11).
//
// Yang membuat ini berbeda dari "minta model menganalisa": fakta dikumpulkan
// LEBIH DULU secara deterministik lewat SQL yang sudah terverifikasi, lalu
// SET FAKTA YANG SAMA dikirim ke tiap perspektif. Karena itu dua pemeriksaan
// programatik jadi mungkin — angka yang berbeda antar perspektif, dan angka
// yang tidak ada di fakta sama sekali. Keduanya dilaporkan di bagian PALING
// ATAS laporan.

/** Dua panggilan LLM berurutan + query; jauh di atas 30 detik bawaan. */
const TIMEOUT_MS = 180_000
// ⚠️ old-think-model model REASONING: untaian penalarannya IKUT memakan jatah ini.
// Terukur 25 Agu 2026: penalaran 3.558 karakter = 1.335 dari 1.400 token, dan pada
// item berdata kaya jatahnya habis sebelum JSON ditutup -> KEDUA perspektif gagal
// total. Jangan menurunkannya lagi tanpa mengukur ulang `completion_tokens`.
const MAX_TOKENS = 4000

export const perspektifTools: ToolDefinition[] = [
  {
    name: 'analisa_lintas_perspektif',
    label: 'Cross-Perspective Analysis',
    description:
      'Menganalisa SATU item pemeriksaan dari beberapa sudut pandang sekaligus (Komersial dan ' +
      'Operasional Lab), lalu menandai konflik angka dan klaim berkeyakinan rendah secara otomatis. ' +
      'Pakai untuk pertanyaan seperti "analisa item X dari berbagai sisi", "bagaimana kondisi ' +
      'pemeriksaan Y menyeluruh", "tinjau produk Z lintas perspektif". ' +
      'Fakta diambil lebih dulu dari database (nett, order, pertumbuhan, pelanggan terbesar, TAT, ' +
      'backlog), lalu dibaca dari tiap sudut pandang. Butuh 1-2 menit. ' +
      'Untuk pertanyaan angka biasa yang cuma butuh satu jawaban, JANGAN pakai tool ini — ' +
      'pakai sales_summary/sales_breakdown yang jauh lebih cepat. ' +
      'JANGAN pakai tool ini kalau user TIDAK menyebut item tertentu (mis. sapaan, pertanyaan ' +
      'umum, atau pertanyaan tentang keseluruhan penjualan) — tool ini butuh satu item spesifik.',
    parameters: {
      type: 'object',
      properties: {
        item: {
          type: 'string',
          // ⚠️ JANGAN memberi contoh nama item NYATA di sini. Versi pertama
          // menulis mis. "EKG", dan 25 Agu 2026 model memakainya sebagai nilai
          // bawaan saat dipaksa memanggil tool untuk sebuah SAPAAN — lengkap
          // dengan 7 query database. Contoh yang terlihat konkret akan dipakai
          // model ketika ia tidak punya ide lain.
          description:
            'Nama atau kode item pemeriksaan yang DISEBUT USER. Wajib berasal dari kalimat user — ' +
            'jangan diisi tebakan atau contoh.'
        },
        period: { type: 'string', enum: [...PERIOD_NAMES], description: 'Default: this_month' },
        from: { type: 'string', description: 'YYYY-MM-DD, wajib bila period=custom' },
        to: { type: 'string', description: 'YYYY-MM-DD, wajib bila period=custom' }
      },
      required: ['item']
    },
    tier: 'read',
    timeoutMs: TIMEOUT_MS,
    summarize: (a) => `Cross-perspective analysis: ${a.item} (${a.period ?? 'this_month'})`,
    execute: async (args) => {
      const keyword = typeof args.item === 'string' ? args.item.trim() : ''
      if (!keyword) throw new ToolError('argumen "item" wajib diisi (nama atau kode pemeriksaan)')

      const provider = buildProvider()
      if (!provider) throw new ToolError('LLM belum dikonfigurasi')

      // ── 1. Tentukan itemnya. TIDAK PERNAH menebak bila ambigu ──
      const kandidat = await cariItem(keyword)
      if (kandidat.length === 0) {
        throw new ToolError(
          `Tidak ada item pemeriksaan yang cocok dengan "${keyword}" di master. ` +
            'Coba kata kunci lain, atau sebutkan kodenya langsung.'
        )
      }
      const cocokPersis = kandidat.filter(
        (k) => k.nama.toLowerCase() === keyword.toLowerCase() || k.kode === keyword
      )
      if (cocokPersis.length === 0 && kandidat.length > 1) {
        // Memilih sendiri berarti menganalisa item yang salah tanpa ada yang
        // tahu — dan seluruh laporannya akan terlihat sah.
        return JSON.stringify({
          perluDipilih: true,
          kandidat,
          catatanHasil:
            `Ada ${kandidat.length} item yang cocok dengan "${keyword}". Tanyakan ke user mana ` +
            'yang dimaksud, lalu panggil ulang tool ini dengan KODE itemnya. Jangan memilih sendiri.'
        })
      }
      const item = cocokPersis[0] ?? kandidat[0]
      // ⚠️ Kandidat lain WAJIB ikut dikirim, bukan dibuang diam-diam.
      //
      // Terjadi pada percobaan pertama 25 Agu 2026: user meminta "EKG", ada
      // kode bernama persis "EKG" (status aktif, tapi cuma 9 baris seumur
      // hidup dan NOL bulan ini), jadi cocok-persis menang dan 11 kode EKG
      // lain dibuang — padahal `MCU (STD+EKG)` punya 34 baris senilai Rp 6,49
      // juta di bulan yang sama. Laporannya jujur ("nol apa adanya") tapi
      // tidak berguna, dan model sampai menebak sendiri di penutup: "apakah
      // item ini sudah diganti kode/nama lain?" — jawabannya ada, cuma tidak
      // pernah sampai ke dia.
      //
      // Ini persis aturan project: hasil tool tidak boleh diam soal apa yang
      // dilewatkan. Batas yang membisu lebih berbahaya daripada batas ketat.
      const kandidatLain = kandidat.filter((k) => k.kode !== item.kode).slice(0, 9)

      // ── 2. Kumpulkan fakta — deterministik, sebelum model dilibatkan ──
      const period = (typeof args.period === 'string' ? args.period : 'this_month') as PeriodName
      if (!PERIOD_NAMES.includes(period)) throw new ToolError(`period "${period}" tidak dikenal`)
      const range = resolvePeriod(period, jakartaToday(), {
        from: typeof args.from === 'string' ? args.from : undefined,
        to: typeof args.to === 'string' ? args.to : undefined
      })
      const bahan = await kumpulkanFakta(item, range)
      const faktaJson = JSON.stringify(bahan, null, 1)

      // ── 3. Baca dari tiap sudut pandang ──
      //
      // BERURUTAN, bukan paralel: gateway ini melayani percakapan user lain
      // pada saat yang sama, dan dua permintaan serentak dari satu tool hanya
      // memperbesar antrean tanpa mempercepat apa pun yang user lihat.
      const model = loadConfig().chatModelId
      const hasil: KlaimPerspektif[] = []
      for (const p of PERSPEKTIF) {
        let mentah = ''
        try {
          mentah = await provider.complete(
            [
              { role: 'system', content: promptPerspektif(p) },
              {
                role: 'user',
                content:
                  `Data pemeriksaan "${item.nama}" (${item.kode}) periode ${range.label}:\n\n` +
                  faktaJson
              }
            ],
            model,
            MAX_TOKENS
          )
        } catch (err) {
          // Satu perspektif gagal tidak boleh menjatuhkan seluruh analisa —
          // kegagalannya DISEBUTKAN, bukan didiamkan.
          logger().warn({ perspektif: p.kode, err: String(err) }, 'perspektif gagal dipanggil')
          hasil.push({
            perspektif: p.kode,
            label: p.label,
            klaim: [],
            gagalParse: `panggilan model gagal: ${String(err)}`
          })
          continue
        }
        const { klaim, gagal } = parseKlaim(mentah)
        hasil.push({ perspektif: p.kode, label: p.label, klaim, gagalParse: gagal })
      }

      // ── 4. Pemeriksaan programatik — TIDAK diserahkan ke model ──
      const nilaiFakta = kumpulkanNilai(bahan)
      const konflik = deteksiKonflikAngka(hasil)
      const takDidukung = angkaTakDidukung(hasil, nilaiFakta)
      const ragu = klaimRagu(hasil)

      const laporan = susunLaporan({
        judul: `Analisa Lintas Perspektif — ${item.nama}`,
        periode: `${range.label} (${range.from} s/d ${range.to})`,
        perspektif: hasil,
        konflik,
        takDidukung,
        ragu,
        belumAda: PERSPEKTIF_BELUM_ADA
      })

      const gagal = hasil.filter((h) => h.gagalParse)
      logger().info(
        {
          item: item.kode,
          periode: range.label,
          konflik: konflik.length,
          takDidukung: takDidukung.length,
          ragu: ragu.length,
          gagal: gagal.length
        },
        'analisa lintas perspektif selesai'
      )

      // Item yang dianalisa ternyata mati, sementara ada kandidat lain dengan
      // nama serupa. Ini bukan error — tapi user hampir pasti memaksudkan
      // salah satu yang lain, dan model harus DIBERITAHU supaya bisa menawarkan.
      const kosong =
        bahan.komersial.nett === 0 &&
        bahan.komersial.jumlahOrder === 0 &&
        bahan.operasional.barisSelesai === 0

      return JSON.stringify({
        item,
        kandidatLain,
        periode: range.label,
        laporan,
        jumlahKonflik: konflik.length,
        jumlahAngkaTakDidukung: takDidukung.length,
        jumlahKlaimRagu: ragu.length,
        perspektifGagal: gagal.map((g) => g.label),
        fakta: bahan,
        // Hasil tool tidak boleh diam soal kelengkapannya — kalimat, bukan
        // bendera (aturan project; bendera boolean sudah terbukti tidak cukup
        // menahan karangan).
        catatanHasil:
          `Laporan sudah lengkap dan siap disampaikan APA ADANYA ke user — jangan diringkas ulang ` +
          `dan jangan menambah angka baru. Bagian "Titik Konflik & Keyakinan Rendah" di paling atas ` +
          `dihitung otomatis dari klaim yang dihasilkan, bukan dari kesimpulan model, jadi jangan ` +
          `diubah isinya. ` +
          (gagal.length > 0
            ? `${gagal.length} dari ${PERSPEKTIF.length} perspektif GAGAL dibaca (${gagal
                .map((g) => g.label)
                .join(', ')}) — sebutkan itu ke user. `
            : `Seluruh ${PERSPEKTIF.length} perspektif berhasil dibaca. `) +
          (kosong && kandidatLain.length > 0
            ? `⚠️ Item "${item.nama}" (${item.kode}) TIDAK punya aktivitas sama sekali di periode ini, ` +
              `padahal ada ${kandidatLain.length} item lain bernama mirip: ` +
              kandidatLain.map((k) => `${k.nama} [${k.kode}]`).join(', ') +
              `. Sebutkan itu ke user dan TAWARKAN menganalisa salah satunya — kemungkinan besar ` +
              `itu yang dimaksud. JANGAN menebak sendiri item mana. `
            : kandidatLain.length > 0
              ? `Ada ${kandidatLain.length} item lain bernama mirip yang TIDAK dianalisa: ` +
                kandidatLain.map((k) => `${k.nama} [${k.kode}]`).join(', ') +
                `. Sebutkan sekilas bahwa yang dianalisa hanya "${item.nama}". `
              : '') +
          `Perspektif QA/Mutu memang belum tersedia karena sumber datanya tidak ada; itu sudah ` +
          `tertulis di laporan. Jangan menyebut ada bagian analisa yang terpotong.`
      })
    }
  }
]
