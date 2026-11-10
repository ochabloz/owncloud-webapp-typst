import { createTypstRenderer, type TypstRenderer } from '@myriaddreamin/typst.ts/renderer'
import rendererWasmUrl from '@myriaddreamin/typst-ts-renderer/wasm?url'
import type { ProjectAccess, TypstWorkerRequest, TypstWorkerResponse } from './typst.worker'

export type { ProjectAccess }

export interface TypstDiagnostic {
  path: string
  range: string
  severity: string
  message: string
}

export interface CompileResult {
  artifact?: Uint8Array
  diagnostics: TypstDiagnostic[]
}

// The compiler runs in a worker (see typst.worker.ts); the renderer stays here
// because it draws into the page's canvas elements.
let worker: Worker | undefined
let nextRequestId = 0
const pendingRequests = new Map<
  number,
  { resolve: (result: unknown) => void; reject: (error: Error) => void }
>()

const getWorker = () => {
  if (!worker) {
    worker = new Worker(new URL('./typst.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }: MessageEvent<TypstWorkerResponse>) => {
      const request = pendingRequests.get(data.id)
      pendingRequests.delete(data.id)
      if ('error' in data) {
        request?.reject(new Error(data.error))
      } else {
        request?.resolve(data.result)
      }
    }
    // e.g. the worker script failed to load: fail everything that is waiting
    // and start a fresh worker on the next request
    worker.onerror = (event) => {
      event.preventDefault()
      const error = new Error(event.message || 'The Typst compiler worker failed to start')
      pendingRequests.forEach(({ reject }) => reject(error))
      pendingRequests.clear()
      worker?.terminate()
      worker = undefined
    }
  }
  return worker
}

const request = <T>(message: TypstWorkerRequest): Promise<T> => {
  const id = nextRequestId++
  return new Promise<T>((resolve, reject) => {
    pendingRequests.set(id, { resolve: resolve as (result: unknown) => void, reject })
    getWorker().postMessage({ id, ...message })
  })
}

let rendererPromise: Promise<TypstRenderer> | undefined

const loadRenderer = () => {
  if (!rendererPromise) {
    rendererPromise = (async () => {
      const renderer = createTypstRenderer()
      await renderer.init({ getModule: () => rendererWasmUrl })
      return renderer
    })()
    rendererPromise.catch(() => {
      rendererPromise = undefined
    })
  }
  return rendererPromise
}

// The compiler wasm is ~30 MB, so it is only loaded once per page session and
// shared by every editor instance.
export const loadTypstEngine = async () => {
  await Promise.all([request<void>({ type: 'init' }), loadRenderer()])
}

// `headers` authenticate fetching the project's files; they are passed with
// every compile because access tokens are renewed while the editor is open.
export const compileTypst = (
  mainFilePath: string,
  source: string,
  format: 'vector' | 'pdf',
  headers: Record<string, string>
): Promise<CompileResult> => request({ type: 'compile', mainFilePath, source, format, headers })

export const renderToCanvas = async (container: HTMLElement, artifact: Uint8Array) => {
  const renderer = await loadRenderer()
  await renderer.renderToCanvas({
    container,
    artifactContent: artifact,
    format: 'vector',
    backgroundColor: '#ffffff',
    pixelPerPt: 2 * (window.devicePixelRatio || 1)
  })
}

// Points the compiler at the document's folder in WebDAV. Files (imports,
// images, bibliographies, ...) are fetched when the compiler first reads them;
// calling this again forgets them, so changed files are fetched anew.
export const setProject = (access: ProjectAccess) => request<void>({ type: 'setProject', access })
