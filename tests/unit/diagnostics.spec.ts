import { parseRange } from '../../src/helpers/diagnostics'

describe('parseRange', () => {
  it('converts zero-based Typst lines to one-based lines', () => {
    expect(parseRange('19:16-19:17')).toEqual({
      start: { line: 20, column: 16 },
      end: { line: 20, column: 17 }
    })
  })

  it('handles ranges spanning several lines', () => {
    expect(parseRange('0:4-2:0')).toEqual({
      start: { line: 1, column: 4 },
      end: { line: 3, column: 0 }
    })
  })

  it('uses the start as end when there is no end', () => {
    expect(parseRange('3:2')).toEqual({
      start: { line: 4, column: 2 },
      end: { line: 4, column: 2 }
    })
  })

  it('falls back to the document start for missing ranges', () => {
    const start = { line: 1, column: 0 }
    expect(parseRange('')).toEqual({ start, end: start })
    expect(parseRange(undefined as unknown as string)).toEqual({ start, end: start })
  })
})
