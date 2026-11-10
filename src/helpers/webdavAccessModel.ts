import { MemoryAccessModel } from '@myriaddreamin/typst.ts/fs/memory'

export interface FetchResult {
  // HTTP status, 0 when the request failed without a response
  status: number
  data?: Uint8Array
}

// `@preview/...` packages are downloaded by FetchPackageRegistry into memory
const isPackagePath = (path: string) => path.startsWith('/@memory/')

/**
 * Gives the Typst compiler the files of the document's folder, fetching each one
 * the first time the compiler reads it, and remembering it (or its failure)
 * until `clear()`. Paths are relative to the folder, starting with `/`.
 */
export class WebDavAccessModel {
  private packages = new MemoryAccessModel()
  private files = new Map<string, FetchResult>()

  constructor(private fetchFile: (path: string) => FetchResult) {}

  insertFile(path: string, data: Uint8Array, mtime: Date) {
    this.packages.insertFile(path, data, mtime)
  }

  removeFile(path: string) {
    this.packages.removeFile(path)
  }

  getMTime(path: string) {
    return isPackagePath(path) ? this.packages.getMTime(path) : undefined
  }

  isFile() {
    return true
  }

  getRealPath(path: string) {
    return path
  }

  readAll(path: string) {
    if (isPackagePath(path)) {
      return this.packages.readAll(path)
    }
    let file = this.files.get(path)
    if (!file) {
      file = this.fetchFile(path)
      this.files.set(path, file)
    }
    return file.data
  }

  /** The HTTP status of a file that was requested but couldn't be read. */
  failure(path: string) {
    const file = this.files.get(path)
    return file && !file.data ? file.status : undefined
  }

  /** Forgets all fetched files and returns the paths that had been requested. */
  clear() {
    const paths = [...this.files.keys()]
    this.files.clear()
    return paths
  }
}
