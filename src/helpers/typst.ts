import {
  createTypstCompiler,
  createTypstRenderer,
  FetchPackageRegistry,
  initOptions,
  MemoryAccessModel,
  type TypstCompiler,
  type TypstRenderer
} from '@myriaddreamin/typst.ts'
import compilerWasmUrl from '@myriaddreamin/typst-ts-web-compiler/wasm?url'
import rendererWasmUrl from '@myriaddreamin/typst-ts-renderer/wasm?url'

// Typst's default text fonts, downloaded by `scripts/fetch-fonts.mjs` and emitted
// as assets of this app so nothing is fetched from a CDN at runtime.
const fontUrls = Object.values(
  import.meta.glob<string>('../assets/fonts/*.{otf,ttf}', {
    query: '?url',
    import: 'default',
    eager: true
  })
)

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

interface TypstEngine {
  compiler: TypstCompiler
  renderer: TypstRenderer
}

let enginePromise: Promise<TypstEngine> | undefined

// The compiler wasm is ~28 MB, so it is only loaded once per page session and
// shared by every editor instance.
export const loadTypstEngine = (): Promise<TypstEngine> => {
  if (!enginePromise) {
    enginePromise = (async () => {
      const accessModel = new MemoryAccessModel()
      const compiler = createTypstCompiler()
      const renderer = createTypstRenderer()
      await Promise.all([
        compiler.init({
          getModule: () => compilerWasmUrl,
          beforeBuild: [
            initOptions.loadFonts(fontUrls, { assets: false }),
            initOptions.withAccessModel(accessModel),
            // resolves `@preview/...` imports against packages.typst.org
            initOptions.withPackageRegistry(new FetchPackageRegistry(accessModel))
          ]
        }),
        renderer.init({ getModule: () => rendererWasmUrl })
      ])
      return { compiler, renderer }
    })()
    enginePromise.catch(() => {
      enginePromise = undefined
    })
  }
  return enginePromise
}

const normalizeDiagnostics = (diagnostics: unknown[] | undefined): TypstDiagnostic[] =>
  (diagnostics ?? []).map((d) => {
    const { path, range, severity, message } = d as TypstDiagnostic
    return { path, range, severity, message }
  })

export const compileTypst = async (
  mainFilePath: string,
  source: string,
  format: 'vector' | 'pdf'
): Promise<CompileResult> => {
  const { compiler } = await loadTypstEngine()
  compiler.addSource(mainFilePath, source)
  const { result, diagnostics } = await compiler.compile({
    mainFilePath,
    format: format === 'pdf' ? 1 : 0,
    diagnostics: 'full'
  })
  return { artifact: result, diagnostics: normalizeDiagnostics(diagnostics) }
}

export const renderToCanvas = async (container: HTMLElement, artifact: Uint8Array) => {
  const { renderer } = await loadTypstEngine()
  await renderer.renderToCanvas({
    container,
    artifactContent: artifact,
    format: 'vector',
    backgroundColor: '#ffffff',
    pixelPerPt: 2 * (window.devicePixelRatio || 1)
  })
}

// Makes files of the document's folder (imports, images, bibliographies, ...)
// visible to the compiler. Paths are relative to the folder, starting with `/`.
// The main file itself is skipped: its unsaved editor content is passed to
// `compileTypst` instead.
export const setProjectFiles = async (files: Map<string, Uint8Array>, mainFilePath: string) => {
  const { compiler } = await loadTypstEngine()
  compiler.resetShadow()
  for (const [path, content] of files) {
    if (path !== mainFilePath) {
      compiler.mapShadow(path, content)
    }
  }
}
