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
import { Compartment, EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { useThemeStore } from '@ownclouders/web-pkg'
import { typstLanguage } from '../helpers/typstLanguage'

interface Props {
  modelValue: string
  isReadOnly?: boolean
}
interface Emits {
  (e: 'update:modelValue', value: string): void
}
const { modelValue, isReadOnly = false } = defineProps<Props>()
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
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        typstLanguage,
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
  const { doc } = view.state
  const docLine = doc.line(Math.min(Math.max(line, 1), doc.lines))
  const pos = Math.min(docLine.from + column, docLine.to)
  view.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
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
