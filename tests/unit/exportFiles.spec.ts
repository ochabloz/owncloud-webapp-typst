import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { exportFileNames, splitSvgPages } from '../../src/helpers/exportFiles'

describe('exportFileNames', () => {
  it('names a PDF after the document', () => {
    expect(exportFileNames('main.typ', 'pdf', 3)).toEqual(['main.pdf'])
  })

  it('names a single page image after the document', () => {
    expect(exportFileNames('Figure.TYP', 'png')).toEqual(['Figure.png'])
  })

  it('numbers pages, padded so they sort', () => {
    expect(exportFileNames('main.typ', 'svg', 3)).toEqual([
      'main-1.svg',
      'main-2.svg',
      'main-3.svg'
    ])
    const names = exportFileNames('main.typ', 'png', 12)
    expect(names[0]).toBe('main-01.png')
    expect(names[11]).toBe('main-12.png')
  })
})

describe('splitSvgPages', () => {
  // rendered by typst.ts from two 200pt × 100pt pages
  const svg = readFileSync(join(__dirname, 'fixtures/two-pages.svg'), 'utf8')

  it('makes one standalone SVG per page', () => {
    const pages = splitSvgPages(svg).map((page) =>
      new DOMParser().parseFromString(page, 'image/svg+xml')
    )
    expect(pages).toHaveLength(2)
    for (const page of pages) {
      const root = page.documentElement
      expect(root.getAttribute('viewBox')).toBe('0 0 200 100')
      expect(root.getAttribute('width')).toBe('200')
      expect(root.getAttribute('height')).toBe('100')
      expect(root.hasAttribute('style')).toBe(false)
      const groups = root.querySelectorAll('g.typst-page')
      expect(groups).toHaveLength(1)
      expect(groups[0].getAttribute('transform')).toBe('translate(0, 0)')
      // glyph definitions are kept
      expect(root.querySelectorAll('defs.glyph path').length).toBeGreaterThan(0)
    }
  })

  it('keeps each page its own content', () => {
    // only the second page has the red (#ff4136) rectangle
    const [first, second] = splitSvgPages(svg)
    expect(first).not.toContain('#ff4136')
    expect(second).toContain('#ff4136')
  })

  it('starts with an XML declaration', () => {
    expect(splitSvgPages(svg)[0].startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg')).toBe(
      true
    )
  })
})
