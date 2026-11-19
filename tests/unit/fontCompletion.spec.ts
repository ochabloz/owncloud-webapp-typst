import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { fontCompletionSource } from '../../src/helpers/fontCompletion'

const families = ['DejaVu Sans Mono', 'Libertinus Serif', 'Inter']
const source = fontCompletionSource(() => families)

// `|` marks the cursor
const complete = (text: string) => {
  const pos = text.indexOf('|')
  const state = EditorState.create({ doc: text.replace('|', '') })
  return source(new CompletionContext(state, pos, false)) as CompletionResult | null
}
const labels = (result: CompletionResult | null) => result?.options.map((o) => o.label)

describe('fontCompletionSource', () => {
  it('offers the families in a font argument', () => {
    const result = complete('#set text(font: "Lib|')
    expect(labels(result)).toEqual(families)
    expect(result.from).toBe(17)
    expect(complete('#text(size: 10pt, font:"|')).not.toBeNull()
    expect(complete('#show raw: set text(font: "|')).not.toBeNull()
  })

  it('offers them in a list of fonts, also across lines', () => {
    expect(complete('#set text(font: ("Inter", "|')).not.toBeNull()
    expect(complete('#set text(font: (\n  "Inter",\n  "|')).not.toBeNull()
  })

  it('offers them as the name of a font entry', () => {
    expect(complete('#set text(font: ((name: "|')).not.toBeNull()
    expect(complete('#set text(font: ((name: "Inter", covers: regex("[a-z]")), "|')).not.toBeNull()
  })

  it('closes an unclosed string', () => {
    expect(complete('#set text(font: "Lib|').options[1].apply).toBe('Libertinus Serif"')
  })

  it('replaces the whole name inside a closed string', () => {
    const result = complete('#set text(font: "Lib|ertine", size: 11pt)')
    expect(result.from).toBe(17)
    expect(result.to).toBe(26)
    expect(result.options[1].apply).toBe('Libertinus Serif')
  })

  it('stays out of other strings', () => {
    expect(complete('#text("|')).toBeNull()
    expect(complete('#set text(lang: "|')).toBeNull()
    expect(complete('#set text(font: "Inter", lang: "|')).toBeNull()
    expect(complete('#set text(font: ((name: "Inter", covers: "|')).toBeNull()
    expect(complete('#let myfont: "|')).toBeNull()
  })

  it('offers nothing before the fonts are known', () => {
    expect(
      fontCompletionSource(() => [])(
        new CompletionContext(EditorState.create({ doc: 'font: "' }), 7, false)
      )
    ).toBeNull()
  })
})
