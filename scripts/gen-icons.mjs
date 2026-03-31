/**
 * Generates all PWA icon sizes from public/icon.svg using sharp.
 * Run with: node scripts/gen-icons.mjs
 */
import sharp from 'sharp'
import { readFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir  = dirname(fileURLToPath(import.meta.url))
const root   = resolve(__dir, '..')
const svgBuf = readFileSync(resolve(root, 'public/icon.svg'))

mkdirSync(resolve(root, 'public/icons'), { recursive: true })

const BG = { r: 11, g: 18, b: 32, alpha: 1 }

// Regular icons — transparent background preserved
const sizes = [72, 96, 128, 144, 152, 180, 192, 384, 512]
for (const s of sizes) {
  const out = s === 180
    ? resolve(root, 'public/apple-touch-icon.png')
    : resolve(root, `public/icons/icon-${s}x${s}.png`)
  await sharp(svgBuf).resize(s, s).png().toFile(out)
  console.log(`✓ ${s}x${s}  →  ${out.replace(root, '.')}`)
}

// Favicon (also as PNG fallback)
await sharp(svgBuf).resize(32, 32).png().toFile(resolve(root, 'public/favicon-32.png'))
await sharp(svgBuf).resize(16, 16).png().toFile(resolve(root, 'public/favicon-16.png'))

// Maskable icons — icon centred on a solid background with 10 % safe-zone padding
async function maskable(size) {
  const inner = Math.round(size * 0.80)
  const iconBuf = await sharp(svgBuf).resize(inner, inner).png().toBuffer()
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: iconBuf, gravity: 'center' }])
    .png()
    .toFile(resolve(root, `public/icons/maskable-${size}x${size}.png`))
  console.log(`✓ maskable ${size}x${size}`)
}

await maskable(192)
await maskable(512)

// Shortcut icons — 96×96 PNG from each SVG
const shortcuts = ['search', 'hourly', 'models']
for (const name of shortcuts) {
  const src = readFileSync(resolve(root, `public/shortcut-${name}.svg`))
  await sharp(src).resize(96, 96).png().toFile(resolve(root, `public/icons/shortcut-${name}.png`))
  console.log(`✓ shortcut-${name}.png`)
}

// Favicon SVG
import { copyFileSync, writeFileSync } from 'fs'
copyFileSync(resolve(root, 'public/icon.svg'), resolve(root, 'public/favicon.svg'))
console.log('✓ favicon.svg')

// favicon.ico — multi-size ICO with PNG-compressed images (16, 32, 48 px)
// Google Search requires a non-SVG favicon; it also crawls /favicon.ico as fallback.
{
  const icoSizes = [16, 32, 48]
  const pngBuffers = await Promise.all(
    icoSizes.map(s => sharp(svgBuf).resize(s, s).png().toBuffer())
  )

  const ICONDIR_SIZE  = 6
  const DIRENTRY_SIZE = 16
  const headerSize    = ICONDIR_SIZE + DIRENTRY_SIZE * icoSizes.length

  // ICONDIR
  const iconDir = Buffer.alloc(ICONDIR_SIZE)
  iconDir.writeUInt16LE(0, 0)
  iconDir.writeUInt16LE(1, 2)
  iconDir.writeUInt16LE(icoSizes.length, 4)

  const entries = []
  let dataOffset = headerSize
  for (let i = 0; i < icoSizes.length; i++) {
    const s   = icoSizes[i]
    const buf = pngBuffers[i]
    const e   = Buffer.alloc(DIRENTRY_SIZE)
    e.writeUInt8(s, 0)               // width
    e.writeUInt8(s, 1)               // height
    e.writeUInt8(0, 2)               // color count (0 = truecolor/PNG)
    e.writeUInt8(0, 3)               // reserved
    e.writeUInt16LE(1, 4)            // color planes
    e.writeUInt16LE(32, 6)           // bits per pixel
    e.writeUInt32LE(buf.length, 8)   // byte size of image data
    e.writeUInt32LE(dataOffset, 12)  // offset of image data from start of file
    dataOffset += buf.length
    entries.push(e)
  }

  const ico = Buffer.concat([iconDir, ...entries, ...pngBuffers])
  writeFileSync(resolve(root, 'public/favicon.ico'), ico)
  console.log(`✓ favicon.ico  (${icoSizes.join(', ')}px — PNG-in-ICO)`)
}

console.log('\n🎉  All icons generated successfully.')
