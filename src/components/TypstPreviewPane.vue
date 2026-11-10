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
      <!-- The renderer empties its container and draws one page per frame, so
           it draws here, out of sight, and the pages shown above are only
           replaced once the new ones are complete. -->
      <div ref="stagingContainer" class="typst-preview-staging" aria-hidden="true" />
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
const stagingContainer = ref<HTMLElement>()

// The renderer lays pages out at the pane's width at render time (in their
// inline style); zoom them to fit when the pane is resized. The canvases are
// drawn at 2 pixels per point, so they stay sharp when zoomed in.
const zoom = ref(1)
const fitToWidth = () => {
  const page = unref(canvasContainer)?.querySelector<HTMLElement>('.typst-page')
  const pages = unref(pagesContainer)
  const pageWidth = parseFloat(page?.style.width ?? '')
  if (!pages || !pageWidth) {
    return
  }
  const { paddingLeft, paddingRight } = getComputedStyle(pages)
  const available = pages.clientWidth - parseFloat(paddingLeft) - parseFloat(paddingRight)
  zoom.value = available / pageWidth
}

let resizeObserver: ResizeObserver | undefined
onMounted(() => {
  resizeObserver = new ResizeObserver(fitToWidth)
  resizeObserver.observe(unref(pagesContainer))
})
onBeforeUnmount(() => resizeObserver?.disconnect())

// Renders are serialized so a slow render can't overwrite a newer one, and
// a render that is still waiting is skipped once a newer artifact arrives.
let rendering: Promise<void> = Promise.resolve()
let latestArtifact: Uint8Array | undefined
watch(
  () => artifact,
  (value) => {
    const shown = unref(canvasContainer)
    const staging = unref(stagingContainer)
    if (!value || !shown || !staging) {
      return
    }
    latestArtifact = value
    rendering = rendering
      .then(async () => {
        if (value !== latestArtifact) {
          return
        }
        await renderToCanvas(staging, value)
        shown.replaceChildren(...staging.childNodes)
        fitToWidth()
      })
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
  position: relative;
  padding: var(--oc-space-medium);
}

/* as wide as the pages above, but takes no space and shows nothing (the
   renderer sets its own container's visibility, so that can't hide it) */
.typst-preview-staging {
  position: absolute;
  top: 0;
  right: var(--oc-space-medium);
  left: var(--oc-space-medium);
  height: 0;
  overflow: hidden;
  pointer-events: none;
}

.typst-preview-canvas :deep(.typst-page) {
  margin: 0 auto var(--oc-space-medium);
  background-color: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}
</style>
