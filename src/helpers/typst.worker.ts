// Runs the Typst compiler off the main thread. Compiling is synchronous inside
// wasm, and the files it reads, `@preview/...` packages as well as the
// document's own folder, are downloaded with synchronous XMLHttpRequests,
// which would freeze the whole OpenCloud page.
import {
  createTypstCompiler,
  createTypstFontBuilder,
  type TypstCompiler,
  type TypstFontBuilder
} from '@myriaddreamin/typst.ts/compiler'
import { FetchPackageRegistry } from '@myriaddreamin/typst.ts/fs/package'
import {
  loadFonts,
  withAccessModel,
  withPackageRegistry
} from '@myriaddreamin/typst.ts/options.init'
import compilerWasmUrl from '@myriaddreamin/typst-ts-web-compiler/wasm?url'
import type { TypstDiagnostic } from './typst'
import { parseRange } from './diagnostics'
import { encodePath, resolvePath } from './paths'
import { WebDavAccessModel, type FetchResult } from './webdavAccessModel'

// Typst's default text fonts, downloaded by `scripts/fetch-fonts.mjs` and emitted
// as assets of this app so nothing is fetched from a CDN at runtime.
const fontUrls = Object.values(
  import.meta.glob<string>('../assets/fonts/*.{otf,ttf}', {
    query: '?url',
    import: 'default',
    eager: true
  })
)

// Where and how the document's folder is fetched: its WebDAV URL, the headers
// that authenticate the request (they change when tokens are renewed), and the
// font files in it, which are loaded up front since Typst looks fonts up by
// family name, not by path.
export interface ProjectAccess {
  baseUrl: string
  headers: Record<string, string>
  fontPaths: string[]
}

export type TypstWorkerRequest =
  | { type: 'init' }
  | {
      type: 'compile'
      mainFilePath: string
      source: string
      format: 'vector' | 'pdf'
      headers: Record<string, string>
    }
  | { type: 'setProject'; access: ProjectAccess }

// What `setProject` reports back: the family names of every loaded font, for
// completion in `font:` arguments.
export interface ProjectInfo {
  fontFamilies: string[]
}

export type TypstWorkerResponse =
  | {
      id: number
      result?: { artifact?: Uint8Array; diagnostics: TypstDiagnostic[] } | ProjectInfo
    }
  | { id: number; error: string }

// Typst sources by path, to look up the text a diagnostic points at
const sources = new Map<string, string>()

let project: ProjectAccess | undefined

const fetchProjectFile = (path: string): FetchResult => {
  if (!project) {
    return { status: 0 }
  }
  const request = new XMLHttpRequest()
  request.open('GET', project.baseUrl + encodePath(path), false)
  request.responseType = 'arraybuffer'
  request.timeout = 30_000
  for (const [name, value] of Object.entries(project.headers)) {
    request.setRequestHeader(name, value)
  }
  // a replaced image must show up after "Reload files"
  request.setRequestHeader('Cache-Control', 'no-cache')
  try {
    request.send()
  } catch {
    return { status: 0 }
  }
  if (request.status !== 200) {
    return { status: request.status }
  }
  const data = new Uint8Array(request.response as ArrayBuffer)
  if (path.endsWith('.typ')) {
    sources.set(path, new TextDecoder().decode(data))
  }
  return { status: 200, data }
}

const accessModel = new WebDavAccessModel(fetchProjectFile)

let compilerPromise: Promise<TypstCompiler> | undefined

const loadCompiler = () => {
  if (!compilerPromise) {
    compilerPromise = (async () => {
      const compiler = createTypstCompiler()
      await compiler.init({
        getModule: () => compilerWasmUrl,
        beforeBuild: [
          loadFonts(fontUrls, { assets: false }),
          withAccessModel(accessModel),
          // resolves `@preview/...` imports against packages.typst.org
          withPackageRegistry(new FetchPackageRegistry(accessModel))
        ]
      })
      return compiler
    })()
    compilerPromise.catch(() => {
      compilerPromise = undefined
    })
  }
  return compilerPromise
}

const fetchFont = async (url: string, headers: Record<string, string> = {}) => {
  const response = await fetch(url, { headers, cache: 'no-cache' })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

const createFontBuilder = async () => {
  const builder = createTypstFontBuilder()
  await builder.init({ getModule: () => compilerWasmUrl })
  return builder
}

// `getFontInfo` is typed as an empty object; at runtime it lists each face of
// the file (a collection has several).
interface FontFileInfo {
  info: { family: string }[]
}

const familiesOf = async (builder: TypstFontBuilder, data: Uint8Array) =>
  ((await builder.getFontInfo(data)) as FontFileInfo).info.map(({ family }) => family)

let bundledFamilies: Promise<string[]> | undefined

// The bundled fonts never change, so their families are read once per worker.
const loadBundledFamilies = () => {
  if (!bundledFamilies) {
    bundledFamilies = (async () => {
      const builder = await createFontBuilder()
      const families: string[] = []
      for (const url of fontUrls) {
        families.push(...(await familiesOf(builder, await fetchFont(url))))
      }
      return families
    })()
    bundledFamilies.catch(() => {
      bundledFamilies = undefined
    })
  }
  return bundledFamilies
}

let hasProjectFonts = false

// The compiler only takes a whole new set of fonts, so the bundled ones are
// added again (from the browser cache) next to the folder's. A font that can't
// be loaded is skipped: the document then reports its family as unknown.
// Returns the families of the folder's fonts.
const loadProjectFonts = async (compiler: TypstCompiler, access: ProjectAccess) => {
  if (!access.fontPaths.length && !hasProjectFonts) {
    return []
  }
  const builder = await createFontBuilder()
  for (const url of fontUrls) {
    await builder.addFontData(await fetchFont(url))
  }
  const families: string[] = []
  for (const path of access.fontPaths) {
    try {
      const data = await fetchFont(access.baseUrl + encodePath(path), access.headers)
      families.push(...(await familiesOf(builder, data)))
      await builder.addFontData(data)
    } catch (e) {
      console.warn(`Failed to load font ${path}:`, e)
    }
  }
  await builder.build((fonts) => Promise.resolve(compiler.setFonts(fonts)))
  hasProjectFonts = access.fontPaths.length > 0
  return families
}

// Font completion is a nicety: without the bundled families, it still offers
// the folder's.
const listFontFamilies = async (projectFamilies: string[]) => {
  let bundled: string[] = []
  try {
    bundled = await loadBundledFamilies()
  } catch (e) {
    console.warn('Failed to read the bundled font families:', e)
  }
  return [...new Set([...bundled, ...projectFamilies])].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  )
}

const textAt = (path: string, range: string) => {
  const { start, end } = parseRange(range)
  const line = sources.get(path)?.split('\n')[start.line - 1]
  return start.line === end.line ? line?.slice(start.column, end.column) : undefined
}

// The browser file access of typst.ts (tinymist-vfs) reports every file it
// can't get as "access denied". The access model knows why it failed.
const describeUnreadableFile = ({ path, range }: TypstDiagnostic) => {
  const literal = textAt(path, range)?.match(/^"([^"]*)"$/)?.[1]
  if (!literal) {
    return 'file not found'
  }
  const file = resolvePath(path, literal)
  const status = accessModel.failure(file)
  if (status === 401 || status === 403) {
    return `access denied (${file})`
  }
  if (status === 0) {
    return `could not load ${file} (network error)`
  }
  if (status !== undefined && status !== 404) {
    return `could not load ${file} (HTTP ${status})`
  }
  return `file not found (searched at ${file})`
}

const normalizeDiagnostics = (diagnostics: unknown[] | undefined): TypstDiagnostic[] =>
  (diagnostics ?? []).map((d) => {
    const { path, range, severity, message } = d as TypstDiagnostic
    const diagnostic = { path, range, severity, message }
    if (message === 'failed to load file (access denied)') {
      diagnostic.message = describeUnreadableFile(diagnostic)
    }
    return diagnostic
  })

const handle = async (request: TypstWorkerRequest) => {
  const compiler = await loadCompiler()
  switch (request.type) {
    case 'init':
      return
    case 'compile': {
      if (project) {
        project.headers = request.headers
      }
      compiler.addSource(request.mainFilePath, request.source)
      sources.set(request.mainFilePath, request.source)
      // `compiler.compile()` only reports diagnostics when compiling fails, so
      // warnings would be lost. A world's `compile()` returns all of them, and
      // exporting from the same world reuses that compiled document.
      const { result, diagnostics } = await compiler.runWithWorld(
        { mainFilePath: request.mainFilePath },
        async (world) => {
          const { hasError, diagnostics } = await world.compile({ diagnostics: 'full' })
          if (hasError) {
            return { result: undefined, diagnostics }
          }
          const opts = { diagnostics: 'full' } as const
          const { result } = await (request.format === 'pdf' ? world.pdf(opts) : world.vector(opts))
          return { result, diagnostics }
        }
      )
      // like `typst watch`: drop cached results not used by the last 10 compiles
      // so a long editing session doesn't keep growing memory
      await compiler.evictCache(10)
      return { artifact: result, diagnostics: normalizeDiagnostics(diagnostics) }
    }
    case 'setProject':
      // (re)opening a folder: forget everything read so far, including the
      // compiler's own cache of those files, so the next compile fetches them
      // again. Unmapping a path is what invalidates that cache.
      project = request.access
      compiler.resetShadow()
      for (const path of accessModel.clear()) {
        compiler.unmapShadow(path)
      }
      sources.clear()
      return {
        fontFamilies: await listFontFamilies(await loadProjectFonts(compiler, request.access))
      }
  }
}

// The artifact's buffer is handed over instead of copied, unless the array is
// only a view into a larger buffer (e.g. wasm memory), which must stay here.
const transferables = (response: TypstWorkerResponse): Transferable[] => {
  const result = 'result' in response ? response.result : undefined
  const artifact = result && 'artifact' in result ? result.artifact : undefined
  if (artifact && artifact.byteOffset === 0 && artifact.byteLength === artifact.buffer.byteLength) {
    return [artifact.buffer as ArrayBuffer]
  }
  return []
}

// Requests run one after the other, so e.g. new project files can't be mapped
// in the middle of a compile.
let queue: Promise<void> = Promise.resolve()
self.onmessage = ({ data }: MessageEvent<{ id: number } & TypstWorkerRequest>) => {
  queue = queue.then(async () => {
    let response: TypstWorkerResponse
    try {
      response = { id: data.id, result: await handle(data) }
    } catch (e) {
      console.error(e)
      response = { id: data.id, error: (e as Error)?.message ?? String(e) }
    }
    self.postMessage(response, { transfer: transferables(response) })
  })
}
