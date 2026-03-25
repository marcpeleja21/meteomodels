/**
 * Generates placeholder PWA screenshots until real ones are captured.
 * Run with: node scripts/gen-screenshots.mjs
 *
 * Replace the generated files under public/screenshots/ with real
 * app screenshots when you have them (e.g. from a browser DevTools
 * device-mode screenshot at 1280×800 and 390×844).
 */
import sharp from 'sharp'
import { readFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir  = dirname(fileURLToPath(import.meta.url))
const root   = resolve(__dir, '..')
const svgBuf = readFileSync(resolve(root, 'public/icon.svg'))

mkdirSync(resolve(root, 'public/screenshots'), { recursive: true })

const BG = { r: 11, g: 18, b: 32, alpha: 1 }

async function screenshot(width, height, outFile) {
  // Centre the app icon on the app background colour
  const iconSize = Math.round(Math.min(width, height) * 0.35)
  const iconBuf  = await sharp(svgBuf).resize(iconSize, iconSize).png().toBuffer()
  await sharp({ create: { width, height, channels: 4, background: BG } })
    .composite([{ input: iconBuf, gravity: 'center' }])
    .png()
    .toFile(resolve(root, `public/screenshots/${outFile}`))
  console.log(`✓ ${outFile} (${width}×${height})`)
}

await screenshot(1280, 800, 'desktop.png')
await screenshot(390,  844, 'mobile.png')

console.log('\n✅ Placeholder screenshots ready.')
console.log('   Replace with real screenshots before publishing to stores.')
