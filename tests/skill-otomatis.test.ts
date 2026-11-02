import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { blokSkillOtomatis, skillOtomatisUntuk } from '../src/main/agent/skill-otomatis'

// Skill RCA dimuat oleh KODE, bukan menunggu model memanggil load_skill.
// Yang dikunci: kalimat RCA sungguhan memicu, dan — lebih penting — kalimat yang
// BUKAN permintaan RCA tidak ikut dibelokkan jadi formulir 5 Whys.

const RCA = 'root-cause-analysis'

describe('kalimat RCA memicu skill', () => {
  for (const k of [
    'tolong buatkan RCA untuk kejadian alat PCR mati tadi pagi',
    'alat PCR mati 2 jam, tolong analisa penyebabnya',
    'sampel tertukar di unit PK kemarin, telusuri penyebabnya',
    'cari akar masalahnya kenapa TAT molor minggu ini',
    'bikin 5 why untuk komplain RS Kariadi',
    'fishbone untuk kontaminasi di mikrobiologi',
    'Root cause analysis LIS down jam 9',
    'investigasi penyebab QC out of control hematologi',
    'analisis penyebab keterlambatan hasil — banyak sampel tertunda'
  ]) {
    test(k, () => assert.equal(skillOtomatisUntuk(k)?.nama, RCA))
  }
})

describe('kalimat lain TIDAK memicu (sisi false-positive)', () => {
  for (const k of [
    'berapa sales bulan ini',
    'sales turun bulan ini, analisa penyebabnya', // pertanyaan data, bukan insiden
    'buatkan presentasi rencana kerja Q4',
    'kenapa jawabanmu tadi beda',
    'analisa penyebab error di script python ini', // debugging kode
    'tolong perbaiki kode yang gagal compile',
    'alat PCR mati, siapa teknisi yang bisa dihubungi?', // insiden tanpa minta telusur
    'ringkas dokumen SOP ini',
    'capai target berapa bulan ini'
  ]) {
    test(k, () => assert.equal(skillOtomatisUntuk(k), null))
  }
})

describe('berkas skill RCA', () => {
  const berkas = join(__dirname, '../skills', RCA, 'SKILL.md')
  const isi = existsSync(berkas) ? readFileSync(berkas, 'utf8') : ''

  test('ada di folder skills (ikut extraResources) dan namanya cocok', () => {
    assert.ok(isi.length > 0, `tidak ada: ${berkas}`)
    assert.match(isi, new RegExp(`^---[\\s\\S]*?name:\\s*${RCA}\\s*$`, 'm'))
  })

  test('memuat aturan yang menahan laporan karangan', () => {
    assert.match(isi, /belum diketahui/)
    assert.match(isi, /blameless/i)
    assert.match(isi, /Data pasien tidak masuk laporan/)
    assert.match(isi, /Data yang masih dibutuhkan/)
  })

  test('tidak terlalu panjang untuk ditempel ke system prompt', () => {
    // Skill ikut ke context SETIAP giliran yang memicunya (batas 131k, aturan 56).
    assert.ok(isi.length < 12_000, `${isi.length} karakter`)
  })
})

test('blok prompt menyebut nama skill dan melarang load_skill ulang', () => {
  const b = blokSkillOtomatis(RCA, 'ISI')
  assert.match(b, /root-cause-analysis/)
  assert.match(b, /tidak perlu load_skill/)
  assert.ok(b.endsWith('ISI\n'))
})

test('panduan menyebut RCA hanya karena skill-nya memang ada (aturan 61)', async () => {
  const { susunPanduan } = await import('../src/main/panduan/isi')
  const teks = JSON.stringify(
    susunPanduan({ izinMenu: [], m365Lanjutan: false, suaraTersedia: false } as never)
  )
  assert.match(teks, /akar masalah \(RCA\)/)
  assert.ok(existsSync(join(__dirname, '../skills', RCA, 'SKILL.md')))
})
