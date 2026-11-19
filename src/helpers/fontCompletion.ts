import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete'

// A font entry already in a list: a family name, or a dictionary like
// `(name: "…", covers: regex("…"))`.
const listEntry = String.raw`(?:"[^"]*"|\((?:[^()]|\([^()]*\))*\))\s*,\s*`

// The text before the cursor ends inside a family name given to `font:`, alone
// (`font: "Lib`), in a list (`font: ("Inter", "Lib`) or as the name of a list
// entry (`font: ((name: "Lib`). As for paths, this is matched on the text
// rather than the syntax tree because the string is usually still unclosed.
const fontArgument = new RegExp(
  String.raw`(?<![\w-])font\s*:\s*(?:\(\s*(?:${listEntry})*(?:\(\s*name\s*:\s*)?)?"([^"]*)$`
)

// lists usually span lines, so the match looks this far back
const LOOKBEHIND = 500

/**
 * Completes the family names of the loaded fonts (bundled and from the
 * document's folder) in `font: "…"` arguments, e.g. of `text()`.
 */
export const fontCompletionSource =
  (getFamilies: () => readonly string[]) =>
  (context: CompletionContext): CompletionResult | null => {
    const families = getFamilies()
    if (!families.length) {
      return null
    }
    const before = context.state.sliceDoc(Math.max(0, context.pos - LOOKBEHIND), context.pos)
    const match = fontArgument.exec(before)
    if (!match) {
      return null
    }
    // replace the whole name when the cursor is in the middle of it, and close
    // the string if it isn't yet
    const line = context.state.doc.lineAt(context.pos)
    const after = /^[^"]*"/.exec(line.text.slice(context.pos - line.from))
    const to = after ? context.pos + after[0].length - 1 : context.pos
    return {
      from: context.pos - match[1].length,
      to,
      options: families.map((family) => ({
        label: family,
        type: 'text',
        detail: 'font',
        apply: after ? family : `${family}"`
      })),
      validFor: /^[^"]*$/
    }
  }
