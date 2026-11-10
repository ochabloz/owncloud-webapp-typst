// Runs the Typst compiler off the main thread. Compiling is synchronous inside
// wasm, and `FetchPackageRegistry` downloads `@preview/...` packages with a
// synchronous XMLHttpRequest, which would freeze the whole oCIS page.
import { createTypstCompiler, type TypstCompiler } from '@myriaddreamin/typst.ts/compiler'
import { MemoryAccessModel } from '@myriaddreamin/typst.ts/fs/memory'
import { FetchPackageRegistry } from '@myriaddreamin/typst.ts/fs/package'
import {
  loadFonts,
  withAccessModel,
  withPackageRegistry
} from '@myriaddreamin/typst.ts/options.init'
import compilerWasmUrl from '@myriaddreamin/typst-ts-web-compiler/wasm?url'
import type { TypstDiagnostic } from './typst'
import { parseRange } from './diagnostics'

// Typst's default text fonts, downloaded by `scripts/fetch-fonts.mjs` and emitted
// as assets of this app so nothing is fetched from a CDN at runtime.
const fontUrls = Object.values(
  import.meta.glob<string>('../assets/fonts/*.{otf,ttf}', {
    query: '?url',
    import: 'default',
    eager: true
  })
)

export type TypstWorkerRequest =
  | { type: 'init' }
  | { type: 'compile'; mainFilePath: string; source: string; format: 'vector' | 'pdf' }
  | { type: 'setProjectFiles'; files: Map<string, Uint8Array>; mainFilePath: string }

export type TypstWorkerResponse =
  | { id: number; result?: { artifact?: Uint8Array; diagnostics: TypstDiagnostic[] } }
  | { id: number; error: string }

let compilerPromise: Promise<TypstCompiler> | undefined

const loadCompiler = () => {
  if (!compilerPromise) {
    compilerPromise = (async () => {
      const accessModel = new MemoryAccessModel()
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

// Typst sources by path, to look up the text a diagnostic points at
const sources = new Map<string, string>()

const textAt = (path: string, range: string) => {
  const { start, end } = parseRange(range)
  const line = sources.get(path)?.split('\n')[start.line - 1]
  return start.line === end.line ? line?.slice(start.column, end.column) : undefined
}

const resolvePath = (fromFile: string, path: string) => {
  const parts = path.startsWith('/') ? [] : fromFile.split('/').slice(1, -1)
  for (const part of path.split('/')) {
    if (part === '..') {
      parts.pop()
    } else if (part && part !== '.') {
      parts.push(part)
    }
  }
  return `/${parts.join('/')}`
}

// The browser file access of typst.ts (tinymist-vfs) reports every file it
// can't provide as "access denied". All project and package files are handed
// to the compiler up front, so here it always means the file doesn't exist.
const describeMissingFile = ({ path, range }: TypstDiagnostic) => {
  const literal = textAt(path, range)?.match(/^"([^"]*)"$/)?.[1]
  return literal ? `file not found (searched at ${resolvePath(path, literal)})` : 'file not found'
}

const normalizeDiagnostics = (diagnostics: unknown[] | undefined): TypstDiagnostic[] =>
  (diagnostics ?? []).map((d) => {
    const { path, range, severity, message } = d as TypstDiagnostic
    const diagnostic = { path, range, severity, message }
    if (message === 'failed to load file (access denied)') {
      diagnostic.message = describeMissingFile(diagnostic)
    }
    return diagnostic
  })

const handle = async (request: TypstWorkerRequest) => {
  const compiler = await loadCompiler()
  switch (request.type) {
    case 'init':
      return
    case 'compile': {
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
    case 'setProjectFiles':
      // the main file is skipped: its unsaved editor content comes with `compile`
      compiler.resetShadow()
      sources.clear()
      for (const [path, content] of request.files) {
        if (path !== request.mainFilePath) {
          compiler.mapShadow(path, content)
          if (path.endsWith('.typ')) {
            sources.set(path, new TextDecoder().decode(content))
          }
        }
      }
      return
  }
}

// The artifact's buffer is handed over instead of copied, unless the array is
// only a view into a larger buffer (e.g. wasm memory), which must stay here.
const transferables = (response: TypstWorkerResponse): Transferable[] => {
  const artifact = 'result' in response ? response.result?.artifact : undefined
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
