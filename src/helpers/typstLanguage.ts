import { StreamLanguage, StringStream } from '@codemirror/language'

// A deliberately small Typst highlighter: enough to make markup, code and math
// distinguishable. It is not a parser — precise highlighting would come from the
// compiler's semantic tokens (`compiler.getSemanticTokens`) later on.
interface TypstState {
  inBlockComment: boolean
  inMath: boolean
  inRaw: boolean
}

const tokenizeMath = (stream: StringStream, state: TypstState) => {
  if (stream.eat('$')) {
    state.inMath = false
    return 'keyword'
  }
  if (stream.match(/^"(?:[^"\\]|\\.)*"/)) {
    return 'string'
  }
  if (stream.match(/^[a-zA-Z][a-zA-Z0-9.]*/)) {
    return 'variableName'
  }
  if (stream.match(/^\d+(?:\.\d+)?/)) {
    return 'number'
  }
  stream.next()
  return 'operator'
}

export const typstLanguage = StreamLanguage.define<TypstState>({
  name: 'typst',
  startState: () => ({ inBlockComment: false, inMath: false, inRaw: false }),
  token(stream, state) {
    if (state.inBlockComment) {
      if (stream.skipTo('*/')) {
        stream.match('*/')
        state.inBlockComment = false
      } else {
        stream.skipToEnd()
      }
      return 'comment'
    }
    if (state.inRaw) {
      if (stream.skipTo('```')) {
        stream.match('```')
        state.inRaw = false
      } else {
        stream.skipToEnd()
      }
      return 'monospace'
    }
    if (stream.match('//')) {
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.match('/*')) {
      state.inBlockComment = true
      return 'comment'
    }
    if (state.inMath) {
      return tokenizeMath(stream, state)
    }
    if (stream.match('```')) {
      state.inRaw = true
      return 'monospace'
    }
    if (stream.match(/^`[^`]*`/)) {
      return 'monospace'
    }
    if (stream.sol() && stream.match(/^\s*=+\s.*/)) {
      return 'heading'
    }
    if (stream.sol() && stream.match(/^\s*([-+]|\d+\.|\/)\s/)) {
      return 'list'
    }
    if (stream.eat('$')) {
      state.inMath = true
      return 'keyword'
    }
    if (stream.match(/^#(let|set|show|import|include|if|else|for|while|return|context)\b/)) {
      return 'keyword'
    }
    if (stream.match(/^#[a-zA-Z_][\w-]*(\.[a-zA-Z_][\w-]*)*/)) {
      return 'variableName.function'
    }
    if (stream.match(/^"(?:[^"\\]|\\.)*"/)) {
      return 'string'
    }
    if (stream.match(/^<[\w:.-]+>/) || stream.match(/^@[\w:.-]+/)) {
      return 'labelName'
    }
    if (stream.match(/^\*[^*\n]+\*/)) {
      return 'strong'
    }
    if (stream.match(/^_[^_\n]+_/)) {
      return 'emphasis'
    }
    if (stream.match(/^\\./)) {
      return 'escape'
    }
    stream.next()
    return null
  },
  languageData: {
    commentTokens: { line: '//', block: { open: '/*', close: '*/' } }
  }
})
