import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { pathCompletionSource } from '../../src/helpers/pathCompletion'

const files = ['/image.png', '/figures/plot.svg', '/chapters/one.typ', '/refs.bib', '/data.json']
const source = pathCompletionSource(() => files)

// `|` marks the cursor
const complete = (text: string) => {
  const pos = text.indexOf('|')
  const state = EditorState.create({ doc: text.replace('|', '') })
  return source(new CompletionContext(state, pos, false)) as CompletionResult | null
}
const labels = (result: CompletionResult | null) => result?.options.map((o) => o.label)

describe('pathCompletionSource', () => {
  it('offers images inside image()', () => {
    const result = complete('#image("|')
    expect(labels(result)).toEqual(['image.png', 'figures/plot.svg'])
    expect(result.from).toBe(8)
  })

  it('offers .typ files after include and import', () => {
    expect(labels(complete('#include "ch|'))).toEqual(['chapters/one.typ'])
    expect(labels(complete('#import "|'))).toEqual(['chapters/one.typ'])
  })

  it('works inside nested calls and code', () => {
    expect(labels(complete('#figure(image("fi|'))).toEqual(['image.png', 'figures/plot.svg'])
    expect(labels(complete('#let d = json(|'))).toBeUndefined()
    expect(labels(complete('#let d = json("|'))).toEqual(['data.json'])
    expect(labels(complete('#bibliography("|'))).toEqual(['refs.bib'])
  })

  it('offers any file to read()', () => {
    expect(labels(complete('#read("|'))).toEqual(files.map((f) => f.slice(1)))
  })

  it('closes an unclosed string', () => {
    expect(complete('#image("im|').options[0].apply).toBe('image.png"')
  })

  it('replaces the whole path inside a closed string', () => {
    const result = complete('#image("im|age.jpg", width: 50%)')
    expect(result.from).toBe(8)
    expect(result.to).toBe(17)
    expect(result.options[0].apply).toBe('image.png')
  })

  it('stays out of other strings and package imports', () => {
    expect(complete('#text("|')).toBeNull()
    expect(complete('#my-image("|')).toBeNull()
    expect(complete('#import "@preview/|')).toBeNull()
    expect(complete('#image("a.png", alt: "|')).toBeNull()
  })
})
