// Generates the neutral presentation backgrounds (cover, content, closing) with Muse Image and crops them
// to 16:9 — replaces the company template images. One-off asset script; results are committed under
// resources/ppt-theme/. Run: npm run ppt:theme (needs AIRA_API_KEY in .env), then look at each PNG.
import { app, nativeImage } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { buatGambar, pakaiKunciUji } from '../src/main/gambar/omni'

const OUT = join(process.cwd(), 'resources', 'ppt-theme')

const PROMPTS: Record<'cover' | 'content' | 'closing', string> = {
  cover:
    'Clean modern presentation cover slide background, soft white to light sky-blue gradient, subtle abstract ' +
    'molecule network and thin hexagon line art on the right third, large empty calm space on the left for a ' +
    'title, minimal, professional, high resolution, no text, no letters, no logos',
  content:
    'Very subtle presentation content slide background, almost pure white, a thin light-blue gradient band ' +
    'along the top edge, faint light-blue abstract lab network line art in the bottom right corner only, ' +
    'everything else empty white, minimal, no text, no letters, no logos',
  closing:
    'Presentation closing slide background, deep navy to bright blue gradient, softly glowing abstract molecule ' +
    'network and light particles, calm empty center for a thank-you message, no text, no letters, no logos'
}

function env(name: string): string {
  const line = readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`))
  return line ? line.slice(name.length + 1).trim() : ''
}

/** Center-crops to 16:9 and scales to 1920×1080. */
function to169(png: Buffer): Buffer {
  const img = nativeImage.createFromBuffer(png)
  const { width, height } = img.getSize()
  const h = Math.min(height, Math.round((width * 9) / 16))
  const w = Math.round((h * 16) / 9)
  const cropped = img.crop({ x: Math.round((width - w) / 2), y: Math.round((height - h) / 2), width: w, height: h })
  return cropped.resize({ width: 1920, height: 1080, quality: 'best' }).toPNG()
}

app.whenReady().then(async () => {
  pakaiKunciUji(env('AIRA_API_KEY'), env('AIRA_ENDPOINT') || 'https://api.meta.ai')
  mkdirSync(OUT, { recursive: true })
  for (const [name, prompt] of Object.entries(PROMPTS)) {
    const [png] = await buatGambar({ prompt, ukuran: '1536x1024' })
    const file = join(OUT, `${name}.png`)
    writeFileSync(file, to169(png))
    console.log('wrote', file)
  }
  app.exit(0)
})
