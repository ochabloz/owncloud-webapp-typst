// Downloads Typst's default text fonts into src/assets/fonts so the app serves them
// itself instead of pulling them from a CDN at runtime (keeps the oCIS CSP
// connect-src strict and works offline). Files are OFL / Bitstream Vera licensed.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const baseUrl = 'https://cdn.jsdelivr.net/gh/typst/typst-assets@v0.13.1/files/fonts/'
const fonts = [
  'DejaVuSansMono-Bold.ttf',
  'DejaVuSansMono-BoldOblique.ttf',
  'DejaVuSansMono-Oblique.ttf',
  'DejaVuSansMono.ttf',
  'LibertinusSerif-Bold.otf',
  'LibertinusSerif-BoldItalic.otf',
  'LibertinusSerif-Italic.otf',
  'LibertinusSerif-Regular.otf',
  'LibertinusSerif-Semibold.otf',
  'LibertinusSerif-SemiboldItalic.otf',
  'NewCM10-Bold.otf',
  'NewCM10-BoldItalic.otf',
  'NewCM10-Italic.otf',
  'NewCM10-Regular.otf',
  'NewCMMath-Bold.otf',
  'NewCMMath-Book.otf',
  'NewCMMath-Regular.otf'
]

const outDir = join(import.meta.dirname, '..', 'src', 'assets', 'fonts')
mkdirSync(outDir, { recursive: true })

for (const font of fonts) {
  const target = join(outDir, font)
  if (existsSync(target)) {
    continue
  }
  const response = await fetch(baseUrl + font)
  if (!response.ok) {
    throw new Error(`Failed to download ${font}: ${response.status}`)
  }
  writeFileSync(target, Buffer.from(await response.arrayBuffer()))
  console.log(`downloaded ${font}`)
}
