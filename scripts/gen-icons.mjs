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
import { copyFileSync } from 'fs'
copyFileSync(resolve(root, 'public/icon.svg'), resolve(root, 'public/favicon.svg'))
console.log('✓ favicon.svg')

console.log('\n🎉  All icons generated successfully.')
