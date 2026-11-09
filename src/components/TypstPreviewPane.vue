<template>
  <div class="typst-preview-pane">
    <div v-if="status === 'loading'" class="typst-preview-status">
      <oc-spinner :aria-label="$gettext('Loading Typst compiler')" />
      <p>{{ $gettext('Loading Typst compiler…') }}</p>
    </div>
    <div v-else-if="status === 'error'" class="typst-preview-status">
      <p>{{ $gettext('The Typst compiler could not be loaded.') }}</p>
      <p class="typst-preview-error">{{ errorMessage }}</p>
    </div>
    <!-- Rendering to canvas (not inline SVG) means links or markup in a shared
         document can never run anything in the oCIS origin. -->
    <div v-show="status === 'ready'" ref="pagesContainer" class="typst-preview-pages">
      <div ref="canvasContainer" class="typst-preview-canvas" :style="{ zoom }" />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { onBeforeUnmount, onMounted, ref, unref, watch } from 'vue'
import { renderToCanvas } from '../helpers/typst'

interface Props {
  artifact?: Uint8Array
  status: 'loading' | 'ready' | 'error'
  errorMessage?: string
}
const { artifact = undefined, status, errorMessage = '' } = defineProps<Props>()

const pagesContainer = ref<HTMLElement>()
const canvasContainer = ref<HTMLElement>()

// The renderer gives pages a fixed pixel width; shrink them to fit the pane.
const zoom = ref(1)
const fitToWidth = () => {
  const page = unref(canvasContainer)?.querySelector<HTMLElement>('.typst-page')
  const pages = unref(pagesContainer)
  if (!page || !pages) {
    return
  }
  const { paddingLeft, paddingRight } = getComputedStyle(pages)
  const available = pages.clientWidth - parseFloat(paddingLeft) - parseFloat(paddingRight)
  zoom.value = Math.min(1, available / page.offsetWidth)
}

let resizeObserver: ResizeObserver | undefined
onMounted(() => {
  resizeObserver = new ResizeObserver(fitToWidth)
  resizeObserver.observe(unref(pagesContainer))
})
onBeforeUnmount(() => resizeObserver?.disconnect())

// Renders are serialized so a slow render can't overwrite a newer one.
let rendering: Promise<void> = Promise.resolve()
watch(
  () => artifact,
  (value) => {
    if (!value || !canvasContainer.value) {
      return
    }
    const container = canvasContainer.value
    rendering = rendering
      .then(() => renderToCanvas(container, value))
      .then(fitToWidth)
      .catch(console.error)
  },
  { flush: 'post' }
)
</script>

<style scoped>
.typst-preview-pane {
  height: 100%;
  overflow: auto;
  background-color: var(--oc-color-background-muted);
}

.typst-preview-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--oc-space-medium);
  height: 100%;
  padding: var(--oc-space-large);
  text-align: center;
  color: var(--oc-color-text-muted);
}

.typst-preview-error {
  font-family: monospace;
  word-break: break-word;
}

.typst-preview-pages {
  padding: var(--oc-space-medium);
}

.typst-preview-canvas :deep(.typst-page) {
  margin: 0 auto var(--oc-space-medium);
  background-color: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}
</style>
