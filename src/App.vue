<template>
  <div class="typst-editor oc-width-1-1 oc-height-1-1">
    <div class="typst-editor-toolbar oc-flex oc-flex-middle oc-flex-between oc-px-s oc-py-xs">
      <div class="oc-button-group" role="group" :aria-label="$gettext('View mode')">
        <oc-button
          v-for="mode in viewModes"
          :key="mode.name"
          v-oc-tooltip="mode.label"
          :class="`typst-editor-viewmode-${mode.name}`"
          :appearance="viewMode === mode.name ? 'filled' : 'outline'"
          :aria-label="mode.label"
          :aria-pressed="viewMode === mode.name"
          variation="primary"
          size="small"
          @click="viewMode = mode.name"
        >
          <oc-icon :name="mode.icon" fill-type="line" size="small" variation="inherit" />
        </oc-button>
      </div>
      <div class="oc-flex oc-flex-middle typst-editor-toolbar-actions">
        <span class="typst-editor-status oc-text-muted oc-text-small">{{ statusText }}</span>
        <oc-button
          v-oc-tooltip="$gettext('Reload images and included files from this folder')"
          class="typst-editor-reload"
          appearance="outline"
          size="small"
          :disabled="engineStatus !== 'ready' || isLoadingProjectFiles"
          @click="reloadProjectFiles"
        >
          <oc-icon name="refresh" fill-type="line" size="small" variation="inherit" />
          <span v-text="$gettext('Reload files')" />
        </oc-button>
        <oc-button
          class="typst-editor-export-pdf"
          appearance="filled"
          variation="primary"
          size="small"
          :disabled="engineStatus !== 'ready' || isExporting"
          @click="exportPdf"
        >
          <oc-icon name="file-pdf" fill-type="line" size="small" variation="inherit" />
          <span v-text="$gettext('Export PDF')" />
        </oc-button>
      </div>
    </div>
    <div class="typst-editor-body" :class="`typst-editor-mode-${viewMode}`">
      <div class="typst-editor-body-source">
        <typst-editor-pane
          ref="editorPane"
          :model-value="currentContent"
          :is-read-only="isReadOnly"
          :diagnostics="mainFileDiagnostics"
          :project-files="projectFiles"
          @update:model-value="onInput"
        />
      </div>
      <div class="typst-editor-body-preview">
        <typst-preview-pane
          :artifact="artifact"
          :status="engineStatus"
          :error-message="engineError"
        />
      </div>
    </div>
    <ul v-if="diagnostics.length" class="typst-editor-diagnostics oc-m-rm oc-p-s">
      <li v-for="(diagnostic, index) in diagnostics" :key="index">
        <oc-button
          appearance="raw"
          class="typst-editor-diagnostic"
          :class="`typst-editor-diagnostic-${diagnostic.severity}`"
          @click="jumpTo(diagnostic)"
        >
          <span class="typst-editor-diagnostic-location">
            {{ diagnosticLocation(diagnostic) }}
          </span>
          {{ diagnostic.message }}
        </oc-button>
      </li>
    </ul>
  </div>
</template>

<script lang="ts" setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, unref, watch } from 'vue'
import { useGettext } from 'vue3-gettext'
import { Resource, SpaceResource, urlJoin } from '@ownclouders/web-client'
import {
  AppConfigObject,
  useAuthStore,
  useClientService,
  useConfigStore,
  useMessages
} from '@ownclouders/web-pkg'
import type { TypstDiagnostic } from './helpers/typst'
import { listProjectFiles, parentPath } from './helpers/projectFiles'
import { encodePath } from './helpers/paths'
import { parseRange } from './helpers/diagnostics'

// This component must stay in the entry chunk (the AppWrapper inspects its props
// and emits), but CodeMirror and typst.ts are only loaded once a file is opened,
// so they don't weigh on every oCIS page load.
const TypstEditorPane = defineAsyncComponent(() => import('./components/TypstEditorPane.vue'))
const TypstPreviewPane = defineAsyncComponent(() => import('./components/TypstPreviewPane.vue'))
const typst = () => import('./helpers/typst')

interface Props {
  applicationConfig: AppConfigObject
  currentContent: string
  isReadOnly?: boolean
  resource: Resource
  space: SpaceResource
}
interface Emits {
  (e: 'update:currentContent', value: string): void
}
// `currentContent` + `update:currentContent` hand loading, saving (Ctrl+S),
// dirty tracking and the unsaved-changes guard to the AppWrapper.
const { currentContent, isReadOnly = false, resource, space } = defineProps<Props>()
const emit = defineEmits<Emits>()

const { $gettext } = useGettext()
const clientService = useClientService()
const authStore = useAuthStore()
const configStore = useConfigStore()
const { showMessage, showErrorMessage } = useMessages()

type ViewMode = 'source' | 'split' | 'preview'
const viewMode = ref<ViewMode>('split')
const viewModes = computed<{ name: ViewMode; label: string; icon: string }[]>(() => [
  { name: 'source', label: $gettext('Editor'), icon: 'code-s-slash' },
  { name: 'split', label: $gettext('Split'), icon: 'layout-column' },
  { name: 'preview', label: $gettext('Preview'), icon: 'eye' }
])

const editorPane = ref<{ goToLine: (line: number, column?: number) => void }>()
const engineStatus = ref<'loading' | 'ready' | 'error'>('loading')
const engineError = ref('')
const artifact = ref<Uint8Array>()
const diagnostics = ref<TypstDiagnostic[]>([])
const isCompiling = ref(false)
const isExporting = ref(false)
const isLoadingProjectFiles = ref(false)
const projectFiles = ref<string[]>([])

const mainFilePath = computed(() => `/${resource.name}`)

// The compiler worker fetches the files of the document's folder itself, with
// the same URL and credentials as the web client's own WebDAV requests. No
// trailing slash: the worker appends paths starting with `/`.
const projectBaseUrl = computed(() =>
  urlJoin(
    configStore.serverUrl,
    'dav',
    encodePath(urlJoin(space.webDavPath, parentPath(resource.path)))
  ).replace(/\/+$/, '')
)
const base64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)))
const projectHeaders = () => {
  const headers: Record<string, string> = { 'X-Requested-With': 'XMLHttpRequest' }
  if (authStore.accessToken) {
    headers.Authorization = `Bearer ${authStore.accessToken}`
  }
  if (authStore.publicLinkToken) {
    headers['public-token'] = authStore.publicLinkToken
  }
  if (authStore.publicLinkPassword) {
    headers.Authorization = `Basic ${base64(`public:${authStore.publicLinkPassword}`)}`
  }
  return headers
}

const statusText = computed(() => {
  if (unref(engineStatus) === 'loading') {
    return $gettext('Loading compiler…')
  }
  if (unref(isCompiling)) {
    return $gettext('Compiling…')
  }
  const errors = unref(diagnostics).filter((d) => d.severity === 'error').length
  if (errors) {
    return $gettext('%{count} error(s)', { count: errors.toString() })
  }
  const warnings = unref(diagnostics).filter((d) => d.severity === 'warning').length
  if (warnings) {
    return $gettext('%{count} warning(s)', { count: warnings.toString() })
  }
  return ''
})

// The compiler is synchronous inside wasm, so compiles are chained: a new
// request waits for the running one and only the latest content is compiled.
let compileQueue: Promise<void> = Promise.resolve()
let pendingSource: string | undefined
const compile = (source: string) => {
  pendingSource = source
  compileQueue = compileQueue.then(async () => {
    if (pendingSource === undefined) {
      return
    }
    const next = pendingSource
    pendingSource = undefined
    isCompiling.value = true
    try {
      const { compileTypst } = await typst()
      const result = await compileTypst(unref(mainFilePath), next, 'vector', projectHeaders())
      diagnostics.value = result.diagnostics
      // keep showing the last good preview while the document has errors
      if (result.artifact) {
        artifact.value = result.artifact
      }
    } catch (e) {
      console.error(e)
    } finally {
      isCompiling.value = false
    }
  })
  return compileQueue
}

let compileTimer: ReturnType<typeof setTimeout> | undefined
const scheduleCompile = (source: string) => {
  if (compileTimer) {
    clearTimeout(compileTimer)
  }
  compileTimer = setTimeout(() => compile(source), 300)
}

const onInput = (value: string) => {
  emit('update:currentContent', value)
}

watch(
  () => currentContent,
  (value) => {
    if (unref(engineStatus) === 'ready') {
      scheduleCompile(value ?? '')
    }
  }
)

const reloadProjectFiles = async () => {
  isLoadingProjectFiles.value = true
  // the file list only feeds path completion, so the preview doesn't wait for it
  listProjectFiles(clientService.webdav, space, resource)
    .then((files) => {
      projectFiles.value = files
    })
    .catch(console.error)
    .finally(() => {
      isLoadingProjectFiles.value = false
    })
  try {
    const { setProject } = await typst()
    await setProject({ baseUrl: unref(projectBaseUrl), headers: projectHeaders() })
  } catch (e) {
    console.error(e)
    showErrorMessage({
      title: $gettext('Failed to load files from this folder'),
      errors: [e as Error]
    })
  }
  await compile(currentContent ?? '')
}

const exportPdf = async () => {
  isExporting.value = true
  try {
    const { compileTypst } = await typst()
    const { artifact: pdf, diagnostics: pdfDiagnostics } = await compileTypst(
      unref(mainFilePath),
      currentContent ?? '',
      'pdf',
      projectHeaders()
    )
    if (!pdf) {
      diagnostics.value = pdfDiagnostics
      showErrorMessage({ title: $gettext('Fix the errors in the document to export a PDF') })
      return
    }
    const pdfName = resource.name.replace(/\.typ$/i, '') + '.pdf'
    const folder = parentPath(resource.path)
    await clientService.webdav.putFileContents(space, {
      path: `${folder === '/' ? '' : folder}/${pdfName}`,
      content: pdf.slice().buffer,
      overwrite: true
    })
    showMessage({ title: $gettext('Saved "%{name}"', { name: pdfName }) })
  } catch (e) {
    console.error(e)
    showErrorMessage({ title: $gettext('Failed to export PDF'), errors: [e as Error] })
  } finally {
    isExporting.value = false
  }
}

const isMainFile = (diagnostic: TypstDiagnostic) => diagnostic.path === unref(mainFilePath)
// underlined in the editor; the list below it also shows other files' diagnostics
const mainFileDiagnostics = computed(() => unref(diagnostics).filter(isMainFile))

const diagnosticLocation = (diagnostic: TypstDiagnostic) => {
  const { line, column } = parseRange(diagnostic.range).start
  const file = isMainFile(diagnostic) ? '' : `${diagnostic.path.replace(/^\//, '')} `
  return `${file}${line}:${column + 1}`
}

const jumpTo = (diagnostic: TypstDiagnostic) => {
  if (!isMainFile(diagnostic)) {
    return
  }
  const { line, column } = parseRange(diagnostic.range).start
  unref(editorPane)?.goToLine(line, column)
}

onMounted(async () => {
  try {
    const { loadTypstEngine } = await typst()
    await loadTypstEngine()
    engineStatus.value = 'ready'
  } catch (e) {
    console.error(e)
    engineError.value = (e as Error)?.message ?? String(e)
    engineStatus.value = 'error'
    return
  }
  await reloadProjectFiles()
})

onBeforeUnmount(() => {
  if (compileTimer) {
    clearTimeout(compileTimer)
  }
})
</script>

<style scoped>
.typst-editor {
  display: flex;
  flex-direction: column;
}

.typst-editor-toolbar {
  flex: 0 0 auto;
  border-bottom: 1px solid var(--oc-color-border);
  background-color: var(--oc-color-background-default);
}

.typst-editor-toolbar-actions {
  gap: var(--oc-space-small);
}

.typst-editor-body {
  display: grid;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.typst-editor-body-source,
.typst-editor-body-preview {
  min-width: 0;
  height: 100%;
  overflow: hidden;
}

.typst-editor-mode-split {
  grid-template-columns: 1fr 1fr;
}

.typst-editor-mode-split .typst-editor-body-preview {
  border-left: 1px solid var(--oc-color-border);
}

.typst-editor-mode-source {
  grid-template-columns: 1fr 0;
}

.typst-editor-mode-preview {
  grid-template-columns: 0 1fr;
}

.typst-editor-diagnostics {
  flex: 0 0 auto;
  max-height: 25%;
  overflow: auto;
  list-style: none;
  border-top: 1px solid var(--oc-color-border);
  font-family: Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: var(--oc-font-size-small);
}

.typst-editor-diagnostic {
  text-align: left;
}

.typst-editor-diagnostic-error .typst-editor-diagnostic-location {
  color: var(--oc-color-swatch-danger-default);
}

.typst-editor-diagnostic-warning .typst-editor-diagnostic-location {
  color: var(--oc-color-swatch-warning-default);
}
</style>
