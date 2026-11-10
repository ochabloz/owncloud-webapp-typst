// `line` is one-based, `column` zero-based, as CodeMirror's `doc.line()` expects.
export interface TextPosition {
  line: number
  column: number
}

// Typst ranges are zero-based `line:col-line:col`.
export const parseRange = (range: string): { start: TextPosition; end: TextPosition } => {
  const [start, end = start] = (range ?? '').split('-').map((part) => {
    const [line, column] = part.split(':').map(Number)
    return { line: (line || 0) + 1, column: column || 0 }
  })
  return { start, end }
}
