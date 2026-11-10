import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { Plugin } from 'vite'

// Emits dist/THIRD-PARTY-NOTICES.txt with the license of everything that ends
// up in the bundle: npm packages (taken from the modules rollup actually
// rendered), the Typst compiler inside the wasm, and the bundled fonts.
// The build fails if something is bundled without a license text, so new
// dependencies can't slip into a release unattributed.

const rootDir = join(import.meta.dirname, '..')
const licensesDir = join(rootDir, 'licenses')
const readLicense = (file: string) => readFileSync(join(licensesDir, file), 'utf8').trim()

// packages whose npm tarball ships no license file, mapped to a package from
// the same repository that does
const licenseFallbacks: Record<string, string> = {
  '@myriaddreamin/typst-ts-web-compiler': '@myriaddreamin/typst.ts',
  '@myriaddreamin/typst-ts-renderer': '@myriaddreamin/typst.ts'
}

const fontFamilies: { prefix: string; notice: () => string }[] = [
  {
    prefix: 'DejaVuSansMono',
    notice: () => `DejaVu Sans Mono 2.37 (Bitstream Vera License, DejaVu changes public domain)
https://dejavu-fonts.github.io

${readLicense('DejaVu-LICENSE.txt')}`
  },
  {
    prefix: 'LibertinusSerif',
    notice: () => `Libertinus Serif 7.051 (SIL Open Font License 1.1)
https://github.com/alerque/libertinus

${readLicense('Libertinus-OFL.txt')}`
  },
  {
    prefix: 'NewCM',
    notice: () => `New Computer Modern 7.0.1, New Computer Modern Math 4.0
(C) 2019-2024 Antonis Tsolomitis (GUST Font License, i.e. LPPL 1.3c)

These font files are unmodified copies of files from the New Computer Modern
distribution, as packaged in https://github.com/typst/typst-assets. Only the
files listed above are included. The complete, original work is available at
https://ctan.org/pkg/newcomputermodern

${readLicense('NewComputerModern-GUST-FONT-LICENSE.txt')}

${readLicense('LPPL-1.3c.txt')}`
  }
]

interface PackageInfo {
  name: string
  version: string
  license: string
  dir: string
}

const findPackage = (moduleId: string): PackageInfo | undefined => {
  let dir = dirname(moduleId.replace(/^\0/, '').split('?')[0])
  while (dir.includes('node_modules') && dir !== dirname(dir)) {
    const manifest = join(dir, 'package.json')
    if (existsSync(manifest)) {
      const { name, version, license } = JSON.parse(readFileSync(manifest, 'utf8'))
      if (name && version) {
        return { name, version, license: license ?? 'UNKNOWN', dir }
      }
    }
    dir = dirname(dir)
  }
}

const findLicenseText = (dir: string) => {
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f))
  return file && readFileSync(join(dir, file), 'utf8').trim()
}

const section = (title: string, body: string) =>
  `${'='.repeat(80)}\n${title}\n${'='.repeat(80)}\n\n${body}\n`

export const thirdPartyNotices = (): Plugin => ({
  name: 'third-party-notices',
  apply: 'build',
  generateBundle(_options, bundle) {
    const packages = new Map<string, PackageInfo>()
    const fonts = new Set<string>()
    for (const output of Object.values(bundle)) {
      if (output.type !== 'chunk') {
        continue
      }
      for (const [id, { renderedLength }] of Object.entries(output.modules)) {
        if (!renderedLength) {
          continue
        }
        const pkg = findPackage(id)
        if (pkg) {
          packages.set(`${pkg.name}@${pkg.version}`, pkg)
        } else if (/\.(otf|ttf)(\?|$)/.test(id)) {
          fonts.add(basename(id.split('?')[0]))
        }
      }
    }

    const packageNotices = [...packages.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((pkg) => {
        const fallback = licenseFallbacks[pkg.name]
        const text = findLicenseText(fallback ? join(rootDir, 'node_modules', fallback) : pkg.dir)
        if (!text) {
          this.error(`no license text found for bundled package ${pkg.name}`)
        }
        return section(`${pkg.name} ${pkg.version} (${pkg.license})`, text)
      })

    const fontNotices = fontFamilies
      .map(({ prefix, notice }) => {
        const files = [...fonts].filter((f) => f.startsWith(prefix)).sort()
        files.forEach((f) => fonts.delete(f))
        return files.length && section(`Fonts: ${files.join(', ')}`, notice())
      })
      .filter(Boolean)
    if (fonts.size) {
      this.error(`no license known for bundled fonts: ${[...fonts].join(', ')}`)
    }

    const typstNotice = section(
      'Typst 0.15.1 (Apache-2.0), compiled into typst_ts_web_compiler_bg.wasm',
      `https://github.com/typst/typst\n\n${readLicense('Typst-LICENSE.txt')}\n\nNOTICE:\n\n${readLicense('Typst-NOTICE.txt')}`
    )

    this.emitFile({
      type: 'asset',
      fileName: 'THIRD-PARTY-NOTICES.txt',
      source: [
        'This app bundles the following third-party software and fonts.\n',
        ...packageNotices,
        typstNotice,
        ...fontNotices
      ].join('\n')
    })
  }
})
