import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { imageRequestBody } from '../src/main/gambar/omni'

const src = (p: string): string => readFileSync(p, 'utf8')

describe('Muse Image request', () => {
  test('asks muse-image-1.0 for a real PNG', () => {
    assert.deepEqual(imageRequestBody({ prompt: 'x', ukuran: '1024x1024' }), {
      model: 'muse-image-1.0',
      prompt: 'x',
      n: 1,
      size: '1024x1024',
      output_format: 'png'
    })
  })

  test('n follows the requested count', () => {
    assert.equal(imageRequestBody({ prompt: 'x', ukuran: '1024x1024', jumlah: 3 }).n, 3)
  })

  test('never sends response_format (url output is not offered)', () => {
    assert.ok(!('response_format' in imageRequestBody({ prompt: 'x', ukuran: '1024x1024' })))
  })

  test('the image model is no longer the company gateway model', () => {
    assert.doesNotMatch(src('src/main/gambar/omni.ts'), /MODEL_GAMBAR = 'old-image-model'/)
    assert.doesNotMatch(src('src/main/gambar/galeri.ts'), /model: 'old-image-model'/)
  })

  test('config default endpoint is the Meta Model API', () => {
    assert.doesNotMatch(src('src/main/config.ts'), /gateway/)
  })
})

describe('Muse Image edit', () => {
  test('edits endpoint exists (probed 200) and also asks for PNG — its default is WebP', async () => {
    const { IMAGE_EDIT_SUPPORTED } = await import('../src/main/hackathon/flags')
    assert.equal(IMAGE_EDIT_SUPPORTED, true)
    const s = src('src/main/gambar/omni.ts')
    const edit = s.slice(s.indexOf('export async function ubahGambar'))
    assert.match(edit, /fd\.append\('output_format', 'png'\)/)
  })
})
