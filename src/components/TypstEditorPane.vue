<template>
  <div ref="editorRef" class="typst-editor-pane" />
</template>

<script lang="ts" setup>
import { onBeforeUnmount, onMounted, ref, unref, watch } from 'vue'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers
} from '@codemirror/view'
import { Compartment, EditorState, Prec, StateEffect, StateField, Text } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { autocompletion } from '@codemirror/autocomplete'
import { linter, type Diagnostic } from '@codemirror/lint'
import { tags } from '@lezer/highlight'
import { typst_lezer, typstLezerDiagnostics, typstTags } from 'codemirror-lang-typst/lezer'
import { useThemeStore } from '@ownclouders/web-pkg'
import type { TypstDiagnostic } from '../helpers/typst'
import { parseRange, type TextPosition } from '../helpers/diagnostics'
import { pathCompletionSource } from '../helpers/pathCompletion'

interface Props {
  modelValue: string
  isReadOnly?: boolean
  // compiler diagnostics of this file, underlined in the text
  diagnostics?: TypstDiagnostic[]
  // files of the document's folder (e.g. `/chapters/intro.typ`), for path completion
  projectFiles?: string[]
}
interface Emits {
  (e: 'update:modelValue', value: string): void
}
const { modelValue, isReadOnly = false, diagnostics = [], projectFiles = [] } = defineProps<Props>()
const emit = defineEmits<Emits>()

const themeStore = useThemeStore()
const isDark = () => Boolean(unref(themeStore.currentTheme)?.isDark)

const editorRef = ref<HTMLElement>()
let view: EditorView | undefined

const themeCompartment = new Compartment()
const readOnlyCompartment = new Compartment()

const buildTheme = () =>
  EditorView.theme(
    {
      '&': {
        height: '100%',
        color: 'var(--oc-color-text-default)',
        backgroundColor: 'var(--oc-color-background-default)'
      },
      '.cm-scroller': {
        fontFamily: 'Consolas, "Liberation Mono", Menlo, monospace',
        lineHeight: '1.5',
        overflow: 'auto'
      },
      '.cm-gutters': {
        backgroundColor: 'var(--oc-color-background-muted)',
        color: 'var(--oc-color-text-muted)',
        border: 'none'
      },
      '.cm-content': { caretColor: 'var(--oc-color-text-default)' },
      '&.cm-focused': { outline: 'none' }
    },
    { dark: isDark() }
  )

// codemirror-lang-typst only ships typst.app's light colors; these take over
// while the editor theme is dark
const darkHighlightStyle = HighlightStyle.define(
  [
    { tag: tags.comment, color: '#8f8f99' },
    { tag: tags.monospace, color: '#a3a3ab' },
    { tag: typstTags.mathDelimiter, color: '#6fcf66' },
    { tag: typstTags.listMarker, color: '#c49bec' },
    { tag: [tags.escape, tags.labelName], color: '#5cc3cf' },
    { tag: [tags.keyword, tags.null, tags.atom, tags.bool], color: '#ff7a86' },
    { tag: tags.number, color: '#f68bb8' },
    { tag: tags.string, color: '#6fcf66' },
    { tag: tags.function(tags.variableName), color: '#8aa8ff' },
    { tag: [typstTags.interpolated, tags.propertyName], color: '#c49bec' }
  ],
  { themeType: 'dark' }
)

const toOffset = (doc: Text, { line, column }: TextPosition) => {
  const docLine = doc.line(Math.min(Math.max(line, 1), doc.lines))
  return Math.min(docLine.from + column, docLine.to)
}

const setCompilerDiagnostics = StateEffect.define<Diagnostic[]>()

// Compiler diagnostics stay attached to their text while it is edited, until
// the next compile replaces them.
const compilerDiagnostics = StateField.define<Diagnostic[]>({
  create: () => [],
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setCompilerDiagnostics)) {
        return effect.value
      }
    }
    if (!transaction.docChanged) {
      return value
    }
    return value.map((d) => ({
      ...d,
      from: transaction.changes.mapPos(d.from),
      to: transaction.changes.mapPos(d.to)
    }))
  }
})

// The compiler also reports the syntax errors that codemirror-lang-typst's own
// linter already shows while typing, so lines with those are left to it.
const compilerLinter = linter(
  ({ state }) => {
    const lines = ({ from, to }: { from: number; to: number }) => [
      state.doc.lineAt(from).number,
      state.doc.lineAt(to).number
    ]
    const syntaxErrorLines = typstLezerDiagnostics(state).map(lines)
    return state.field(compilerDiagnostics).filter((d) => {
      const [first, last] = lines(d)
      return !syntaxErrorLines.some(([from, to]) => first <= to && from <= last)
    })
  },
  {
    delay: 100,
    needsRefresh: (update) =>
      update.transactions.some((t) => t.effects.some((e) => e.is(setCompilerDiagnostics)))
  }
)

const toLintDiagnostics = (doc: Text): Diagnostic[] =>
  diagnostics.map(({ range, severity, message }) => {
    const { start, end } = parseRange(range)
    const from = toOffset(doc, start)
    return {
      from,
      to: Math.max(from, toOffset(doc, end)),
      severity: severity === 'error' || severity === 'warning' ? severity : 'info',
      message
    }
  })

const applyDiagnostics = () => {
  view?.dispatch({ effects: setCompilerDiagnostics.of(toLintDiagnostics(view.state.doc)) })
}

// created once: the autocompletion matches sources by identity, so a new
// function per lookup would discard every result
const pathCompletionData = [{ autocomplete: pathCompletionSource(() => projectFiles) }]

const buildReadOnly = () => [
  EditorState.readOnly.of(isReadOnly),
  EditorView.editable.of(!isReadOnly)
]

onMounted(() => {
  view = new EditorView({
    parent: unref(editorRef),
    state: EditorState.create({
      doc: modelValue ?? '',
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        history(),
        bracketMatching(),
        // parser, highlighting, indentation, folding and syntax linting
        typst_lezer(),
        Prec.high(syntaxHighlighting(darkHighlightStyle)),
        // built-in functions and their parameters, symbols, labels and the
        // document's own `let` bindings, plus project files in path arguments
        autocompletion(),
        EditorState.languageData.of(() => pathCompletionData),
        compilerDiagnostics,
        compilerLinter,
        EditorView.lineWrapping,
        // Ctrl+S is intentionally left unbound so it reaches the AppWrapper's save handler.
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        themeCompartment.of(buildTheme()),
        readOnlyCompartment.of(buildReadOnly()),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            emit('update:modelValue', update.state.doc.toString())
          }
        })
      ]
    })
  })
  // The AppWrapper closes the app on Escape. Only let the key through when the
  // editor didn't use it itself, e.g. to close the completion popup.
  view.dom.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && event.defaultPrevented) {
      event.stopPropagation()
    }
  })
  applyDiagnostics()
})

// External content changes (initial WebDAV load, reload after conflict) flow in
// via the prop; only dispatch when the value differs to avoid an update loop.
watch(
  () => modelValue,
  (value) => {
    if (!view) {
      return
    }
    const current = view.state.doc.toString()
    if ((value ?? '') !== current) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value ?? '' } })
    }
  }
)

watch(() => diagnostics, applyDiagnostics)

watch(
  () => isReadOnly,
  () => {
    view?.dispatch({ effects: readOnlyCompartment.reconfigure(buildReadOnly()) })
  }
)

watch(
  () => isDark(),
  () => {
    view?.dispatch({ effects: themeCompartment.reconfigure(buildTheme()) })
  }
)

const goToLine = (line: number, column = 0) => {
  if (!view) {
    return
  }
  const anchor = toOffset(view.state.doc, { line, column })
  view.dispatch({ selection: { anchor }, scrollIntoView: true })
  view.focus()
}

onBeforeUnmount(() => {
  view?.destroy()
  view = undefined
})

defineExpose({ goToLine, getView: () => view })
</script>

<style scoped>
.typst-editor-pane {
  height: 100%;
  width: 100%;
  overflow: hidden;
}
</style>
