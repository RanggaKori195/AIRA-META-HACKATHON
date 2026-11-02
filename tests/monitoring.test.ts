import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  MAKS_PROMPT,
  MAKS_TOOL,
  RETENSI_PROMPT_HARI,
  bentukAktivitas,
  namaLampiran,
  polaCari,
  ringkasTool,
  samarkanRahasia,
  siapkanPrompt,
  statusDariKode
} from '../src/main/monitoring/rules'
import { assertBukanTabelAuth } from '../src/main/tools/db-safety'
import type { ToolActivity } from '../src/shared/ipc'

// Monitoring pemakaian (16 Sep 2026). Yang dikunci di sini adalah perilaku yang
// kalau rusak GAGALNYA DIAM: jawaban/argumen tool yang ikut terkirim ke tabel
// pusat, rahasia yang tidak tersamarkan, potongan yang tidak mengaku dipotong,
// dan tabel monitoring yang ternyata bisa dibaca lewat tool database.

const aktivitas = (
  name: string,
  status: ToolActivity['status'] = 'ok',
  argsSummary = 'path=C:\\Rahasia\\gaji.xlsx'
): ToolActivity => ({
  callId: Math.random().toString(36),
  name,
  argsSummary,
  tier: 'read',
  status,
  resultSummary: 'nett Rp 4,11 M'
})

const dasar = {
  eventId: '00000000-0000-4000-8000-000000000001',
  sesi: { username: 'Budi', role: 'manager', divisi: ['IT', 'Sales'] },
  mesin: { hostname: 'LAPTOP-01', osUser: 'budi' },
  appVersion: '0.2.0',
  mulai: Date.UTC(2026, 8, 16, 3, 0, 0),
  selesai: Date.UTC(2026, 8, 16, 3, 0, 4),
  mode: 'sales' as const,
  model: 'old-think-model',
  sesiId: 'sesi-1',
  teks: 'berapa sales Kariadi bulan ini?',
  lampiran: [] as string[],
  activities: [] as ToolActivity[],
  kodeGalat: null
}

describe('baris aktivitas hanya membawa level 1 + 2', () => {
  test('jawaban, argumen, dan hasil tool TIDAK ikut', () => {
    const b = bentukAktivitas({
      ...dasar,
      activities: [aktivitas('sales_report'), aktivitas('read_excel')]
    })
    const json = JSON.stringify(b)
    assert.ok(!json.includes('gaji.xlsx'), 'argumen tool bocor')
    assert.ok(!json.includes('4,11'), 'hasil tool bocor')
    assert.ok(!('jawaban' in b), 'kolom jawaban tidak boleh ada')
    assert.deepEqual(
      b.tools.map((t) => t.nama),
      ['sales_report', 'read_excel']
    )
  })

  test('identitas & metadata terisi', () => {
    const b = bentukAktivitas({ ...dasar, usage: { promptTokens: 11_300, completionTokens: 420 } })
    assert.equal(b.username, 'budi')
    assert.equal(b.divisi, 'IT, Sales')
    assert.equal(b.durasiMs, 4000)
    assert.equal(b.waktu, '2026-09-16T03:00:00.000Z')
    assert.equal(b.status, 'selesai')
    assert.equal(b.promptTokens, 11_300)
    assert.equal(b.prompt, dasar.teks)
  })

  test('divisi kosong -> null (Direktur/Super Admin)', () => {
    assert.equal(bentukAktivitas({ ...dasar, sesi: { ...dasar.sesi, divisi: [] } }).divisi, null)
  })

  test('lampiran hanya NAMA, path folder dibuang', () => {
    assert.deepEqual(namaLampiran(['C:\\Users\\budi\\Rahasia\\laporan.pdf', '/tmp/a/b.docx', '  ']), [
      'laporan.pdf',
      'b.docx'
    ])
  })
})

describe('status run', () => {
  test('null = selesai, batal = dibatalkan, lain = gagal', () => {
    assert.equal(statusDariKode(null), 'selesai')
    assert.equal(statusDariKode('LLM_CANCELLED'), 'dibatalkan')
    assert.equal(statusDariKode('TIDAK_SELESAI'), 'gagal')
    assert.equal(statusDariKode('LLM_HTTP_ERROR'), 'gagal')
  })
})

describe('ringkasan tool', () => {
  test('dihitung per nama, kegagalan dan penolakan ikut dihitung', () => {
    const r = ringkasTool([
      aktivitas('read_pdf'),
      aktivitas('read_pdf', 'error'),
      aktivitas('run_command', 'denied'),
      aktivitas('read_pdf')
    ])
    assert.deepEqual(r, [
      { nama: 'read_pdf', kali: 3, gagal: 1 },
      { nama: 'run_command', kali: 1, gagal: 1 }
    ])
  })

  test('dibatasi MAKS_TOOL jenis', () => {
    const banyak = Array.from({ length: MAKS_TOOL + 10 }, (_, i) => aktivitas(`t${i}`))
    assert.equal(ringkasTool(banyak).length, MAKS_TOOL)
  })
})

describe('rahasia disamarkan sebelum dikirim', () => {
  const kasus: Array<[string, string]> = [
    ['kenapa postgresql://budi:Rahasia123@10.1.1.1:5432/db gagal', 'Rahasia123'],
    ['password=the company2026! tolong cek', 'the company2026!'],
    ['pwd: "spasi di dalam"', 'spasi di dalam'],
    ['kata sandi: abcdef', 'abcdef'],
    ['token=eyJhbGciOiJIUzI1NiJ9.abc', 'eyJhbGciOiJIUzI1NiJ9'],
    ['Authorization: Bearer abcdefghijklmnop1234', 'abcdefghijklmnop1234'],
    ['api_key = sk-proj-ABCDEFGHIJKLMNOPQRSTU', 'ABCDEFGHIJKLMNOPQRSTU'],
    ['kunci saya sk-ABCDEFGHIJKLMNOPQRSTUVWX', 'ABCDEFGHIJKLMNOPQRSTUVWX']
  ]
  for (const [masuk, rahasia] of kasus) {
    test(`"${masuk.slice(0, 30)}…"`, () => {
      const keluar = samarkanRahasia(masuk)
      assert.ok(!keluar.includes(rahasia), `masih bocor: ${keluar}`)
      assert.ok(keluar.includes('•••'))
    })
  }

  test('kalimat biasa tidak diubah (sisi false-positive)', () => {
    for (const biasa of [
      'berapa sales Kariadi bulan ini?',
      'buatkan presentasi tentang password policy perusahaan',
      'lupa password, bagaimana cara reset?',
      'buka https://www.orderIdlab.co.id/tentang',
      'token ring itu apa'
    ]) {
      assert.equal(samarkanRahasia(biasa), biasa)
    }
  })

  test('username di connection string tetap terbaca (yang disamarkan hanya sandinya)', () => {
    assert.equal(
      samarkanRahasia('postgresql://budi:x@host/db'),
      'postgresql://budi:•••@host/db'
    )
  })
})

describe('pertanyaan panjang dipotong dan MENGAKU dipotong', () => {
  test('pendek -> utuh', () => {
    assert.deepEqual(siapkanPrompt('  halo  '), { prompt: 'halo', dipotong: false })
  })

  test('kosong -> null', () => {
    assert.deepEqual(siapkanPrompt('   '), { prompt: null, dipotong: false })
  })

  test('panjang -> dipotong + penanda jumlah', () => {
    const { prompt, dipotong } = siapkanPrompt('a'.repeat(MAKS_PROMPT + 1234))
    assert.equal(dipotong, true)
    assert.ok(prompt!.startsWith('a'.repeat(MAKS_PROMPT)))
    assert.match(prompt!, /dipotong 1\.234 karakter/)
  })
})

describe('pola pencarian', () => {
  test('wildcard SQL di-escape', () => {
    assert.equal(polaCari('100%'), '%100\\%%')
    assert.equal(polaCari('nama_file'), '%nama\\_file%')
    assert.equal(polaCari('a\\b'), '%a\\\\b%')
  })

  test('kosong -> null (tanpa saringan)', () => {
    assert.equal(polaCari('  '), null)
    assert.equal(polaCari(null), null)
  })
})

describe('tabel monitoring tertutup untuk tool database', () => {
  for (const q of [
    'SELECT prompt FROM tb_aktivitas_aira',
    'select * from public.tb_aktivitas_akses_aira',
    'WITH x AS (SELECT username FROM TB_AKTIVITAS_AIRA) SELECT * FROM x'
  ]) {
    test(q, () => {
      assert.throws(() => assertBukanTabelAuth(q), /tidak bisa diakses lewat tool database/)
    })
  }
})

describe('satu angka retensi untuk layar dan kode', () => {
  test('MonitoringAdmin.tsx memakai angka yang sama dengan RETENSI_PROMPT_HARI', () => {
    const src = readFileSync(
      join(__dirname, '../src/renderer/src/components/MonitoringAdmin.tsx'),
      'utf8'
    )
    const m = src.match(/const RETENSI_HARI = (\d+)/)
    assert.ok(m, 'konstanta RETENSI_HARI tidak ditemukan di layar')
    assert.equal(Number(m![1]), RETENSI_PROMPT_HARI)
  })
})
