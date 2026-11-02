// Cuts the AIRA mascot sheet (resources/mascot/sheet.webp, 1536×1024) into one PNG per pose.
// One-off asset script: Chromium (already in Electron) decodes the WebP and draws each crop box to a
// canvas — no image dependency.
// Run: npm run mascot:cut, then look at every PNG (whole pose, no caption, no neighbouring pose).
import { app, BrowserWindow, nativeImage } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()
const SHEET = join(ROOT, 'resources', 'mascot', 'sheet.webp')
const OUT = join(ROOT, 'src', 'renderer', 'src', 'assets', 'mascot')

/**
 * [x0, y0, x1, y1] in sheet pixels. The four small poses are square crops taken straight from the sheet
 * (padding showed as flat bands against the sheet's gradient). `hello` keeps its tall aspect ratio.
 */
const BOXES: Record<string, [number, number, number, number]> = {
  hello: [20, 120, 660, 1000],
  idle: [725, 180, 1075, 530],
  listening: [1130, 180, 1480, 530],
  thinking: [718, 580, 1068, 930],
  speaking: [1120, 575, 1470, 925]
}

/** Title letters ("AI L…") that fall inside the hello crop, painted with the background just below them. */
const COVER: Array<[number, number, number, number]> = [[560, 118, 665, 168]]

/** Longest side of every output PNG. */
const SIZE = 512

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html,<canvas></canvas>')
  const sheet = 'data:image/webp;base64,' + readFileSync(SHEET).toString('base64')
  const script = `(async () => {
    const img = new Image()
    img.src = ${JSON.stringify(sheet)}
    await img.decode()
    const sheet = document.createElement('canvas')
    sheet.width = img.naturalWidth; sheet.height = img.naturalHeight
    const sc = sheet.getContext('2d'); sc.drawImage(img, 0, 0)
    for (const [x0, y0, x1, y1] of ${JSON.stringify(COVER)}) {
      const [r, g, b] = sc.getImageData(x0 + 10, y1 + 6, 1, 1).data
      sc.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')'
      sc.fillRect(x0, y0, x1 - x0, y1 - y0)
    }
    const res = { size: [img.naturalWidth, img.naturalHeight] }
    for (const [name, [x0, y0, x1, y1]] of Object.entries(${JSON.stringify(BOXES)})) {
      const w = x1 - x0, h = y1 - y0, k = ${SIZE} / Math.max(w, h)
      const c = document.createElement('canvas')
      c.width = Math.round(w * k); c.height = Math.round(h * k)
      c.getContext('2d').drawImage(sheet, x0, y0, w, h, 0, 0, c.width, c.height)
      res[name] = c.toDataURL('image/png')
    }
    return res
  })()`
  const out = (await win.webContents.executeJavaScript(script)) as Record<string, string> & { size: [number, number] }
  console.log('sheet', out.size.join('x'))
  mkdirSync(OUT, { recursive: true })
  for (const name of Object.keys(BOXES)) {
    const file = join(OUT, `${name}.png`)
    writeFileSync(file, Buffer.from(out[name].split(',')[1], 'base64'))
    console.log('wrote', file)
  }

  // App icon (window, tray, splash, installer) from the idle pose. ICO entries are PNG-compressed
  // (supported since Windows Vista) — no image library needed.
  const idle = nativeImage.createFromBuffer(Buffer.from(out.idle.split(',')[1], 'base64'))
  writeFileSync(join(ROOT, 'resources', 'icon.png'), idle.resize({ width: 512, height: 512, quality: 'best' }).toPNG())
  const sizes = [256, 64, 48, 32, 16]
  const pngs = sizes.map((s) => idle.resize({ width: s, height: s, quality: 'best' }).toPNG())
  const header = Buffer.alloc(6 + 16 * sizes.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i
    header.writeUInt8(s === 256 ? 0 : s, e)
    header.writeUInt8(s === 256 ? 0 : s, e + 1)
    header.writeUInt16LE(1, e + 4)
    header.writeUInt16LE(32, e + 6)
    header.writeUInt32LE(pngs[i].length, e + 8)
    header.writeUInt32LE(offset, e + 12)
    offset += pngs[i].length
  })
  writeFileSync(join(ROOT, 'resources', 'icon.ico'), Buffer.concat([header, ...pngs]))
  console.log('wrote resources/icon.png, resources/icon.ico')
  app.exit(0)
})
