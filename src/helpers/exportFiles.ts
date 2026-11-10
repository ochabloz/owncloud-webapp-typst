export type ExportFormat = 'pdf' | 'png' | 'svg'

/**
 * Names of the exported files, like Typst's CLI: one file for a PDF or a
 * single page, otherwise one per page, numbered with enough leading zeros to
 * keep them sorted (`main-01.png` … `main-12.png`).
 */
export const exportFileNames = (documentName: string, format: ExportFormat, pageCount = 1) => {
  const base = documentName.replace(/\.typ$/i, '')
  if (format === 'pdf' || pageCount === 1) {
    return [`${base}.${format}`]
  }
  const digits = String(pageCount).length
  return Array.from(
    { length: pageCount },
    (_, i) => `${base}-${String(i + 1).padStart(digits, '0')}.${format}`
  )
}

/**
 * typst.ts renders a document as one SVG with all pages stacked vertically,
 * each in a `g.typst-page`. This makes one standalone SVG per page out of it.
 */
export const splitSvgPages = (svg: string): string[] => {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const pageCount = doc.querySelectorAll('g.typst-page').length
  return Array.from({ length: pageCount }, (_, index) => {
    const root = doc.documentElement.cloneNode(true) as Element
    const pages = [...root.querySelectorAll('g.typst-page')]
    pages.forEach((page, i) => i !== index && page.remove())
    const page = pages[index]
    page.setAttribute('transform', 'translate(0, 0)')
    const width = page.getAttribute('data-page-width')
    const height = page.getAttribute('data-page-height')
    root.setAttribute('width', width)
    root.setAttribute('height', height)
    root.setAttribute('viewBox', `0 0 ${width} ${height}`)
    // the renderer's in-page layout hints, meaningless in a standalone file
    for (const attribute of ['style', 'data-width', 'data-height']) {
      root.removeAttribute(attribute)
    }
    return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(root)}`
  })
}
