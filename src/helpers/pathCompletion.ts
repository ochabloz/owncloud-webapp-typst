import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete'

// Files that fit the path argument of each function; `undefined` takes any file.
const pathArguments: Record<string, RegExp | undefined> = {
  image: /\.(png|jpe?g|gif|svg|webp|pdf)$/i,
  include: /\.typ$/i,
  import: /\.typ$/i,
  bibliography: /\.(bib|ya?ml)$/i,
  json: /\.json$/i,
  yaml: /\.ya?ml$/i,
  toml: /\.toml$/i,
  csv: /\.csv$/i,
  xml: /\.xml$/i,
  read: undefined
}

// The text before the cursor ends inside the first, positional string argument
// of one of those functions, e.g. `#image("fig` or `#include "chap`. This is
// matched on the text rather than the syntax tree because the string is
// usually still unclosed while typing, which Typst parses as an error.
const pathArgument =
  /(?<![\w.-])(?:(image|bibliography|json|yaml|toml|csv|xml|read)\(\s*|(include|import)\s+)"([^"]*)$/

/**
 * Completes paths of the document's project files (relative to the document's
 * folder, starting with `/`) inside `image("…")`, `#include "…"` and the like.
 */
export const pathCompletionSource =
  (getFiles: () => readonly string[]) =>
  (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos)
    const match = pathArgument.exec(line.text.slice(0, context.pos - line.from))
    if (!match || match[3].startsWith('@')) {
      return null
    }
    const accepts = pathArguments[match[1] ?? match[2]]
    const files = getFiles().filter((file) => !accepts || accepts.test(file))
    if (!files.length) {
      return null
    }
    // replace the whole path when the cursor is in the middle of it, and close
    // the string if it isn't yet
    const after = /^[^"]*"/.exec(line.text.slice(context.pos - line.from))
    const to = after ? context.pos + after[0].length - 1 : context.pos
    return {
      from: context.pos - match[3].length,
      to,
      options: files.map((file) => {
        // the document sits at the root of its folder, so relative paths are
        // the project paths without the leading `/`
        const label = file.replace(/^\//, '')
        return { label, type: 'text', detail: 'file', apply: after ? label : `${label}"` }
      }),
      validFor: /^[^"]*$/
    }
  }
