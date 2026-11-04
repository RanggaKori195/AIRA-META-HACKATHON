import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { halamanHtml } from '../src/main/pdf/style'
import { keSvg } from '../src/main/grafik/svg'
import { GAYA, uraiPrompt } from '../src/renderer/src/views/gambar-gaya'

// The app theme moved from green to blue (54f68a5). Documents and the image style presets must follow it —
// a green PDF or a green Muse illustration next to a blue app looks like two different products.

const HIJAU = /#2f6f3e|\bgreen\b|\bhijau\b/i
const BIRU = '#1f5bb8'

describe('PDF accent follows the blue theme', () => {
  test('headings and rules use the app blue, never the old green', () => {
    const html = halamanHtml('<h1>x</h1>', { judul: 'x' })
    assert.ok(html.includes(BIRU), 'PDF style has no app blue')
    assert.doesNotMatch(html, /#2f6f3e/i)
  })
})

describe('chart text and grid colours', () => {
  test('charts carry no green-tinted text or gridlines', () => {
    const svg = keSvg({ jenis: 'batang', judul: 'Uji', label: ['Jan', 'Feb'], seri: [{ nama: 'Nett', nilai: [10, 20] }] })
    assert.doesNotMatch(svg, /#1d3b24|#6b7a70|#dfe6e0/i)
  })
})

describe('image style presets', () => {
  test('no preset asks Muse Image for green', () => {
    for (const g of GAYA) assert.doesNotMatch(g.akhiran, HIJAU, `${g.id}: ${g.akhiran}`)
  })

  test('the brand presets name the app blue explicitly', () => {
    for (const id of ['slide', 'ikon']) {
      const g = GAYA.find((x) => x.id === id)!
      assert.ok(g.akhiran.includes(BIRU), `${id}: ${g.akhiran}`)
    }
  })

  test('a prompt saved with the new suffix still gets its style label', () => {
    const g = GAYA.find((x) => x.id === 'slide')!
    const u = uraiPrompt(`lab bench. ${g.akhiran}`)
    assert.equal(u.gaya?.id, 'slide')
    assert.equal(u.inti, 'lab bench')
  })

  test('prompts saved with the old green English suffix keep their label', () => {
    const lama = 'modern flat illustration style, clean, dark green #2f6f3e and teal with white accents, plain background, no text'
    const u = uraiPrompt(`lab bench. ${lama}`)
    assert.equal(u.gaya?.id, 'slide')
    assert.equal(u.inti, 'lab bench')
    assert.equal(uraiPrompt('flask. simple single-object icon, bold line style, green #2f6f3e, plain white background, no text').gaya?.id, 'ikon')
  })

  test('prompts saved with the old Indonesian suffix keep their label', () => {
    const u = uraiPrompt('meja lab. ikon sederhana satu objek, gaya garis tebal, warna hijau #2f6f3e, latar putih polos, tanpa tulisan')
    assert.equal(u.gaya?.id, 'ikon')
    assert.equal(u.inti, 'meja lab')
  })

  test('a prompt with no known suffix has no style label', () => {
    assert.equal(uraiPrompt('just a cat').gaya, null)
  })
})
