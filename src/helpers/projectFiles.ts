import { Resource, SpaceResource } from '@ownclouders/web-client'
import { WebDAV } from '@ownclouders/web-client/webdav'

// Only names are listed (the compiler fetches file contents itself, see
// typst.worker.ts), so this is just bounded to keep a document in a huge
// folder tree from listing it all.
const MAX_DEPTH = 5
const MAX_FOLDERS = 100

export const parentPath = (path: string) => path.substring(0, path.lastIndexOf('/')) || '/'

/**
 * Lists the files next to (and below) the main document, as paths relative to
 * the document's folder (e.g. `/chapters/intro.typ`), which is how Typst
 * resolves `#import`, `#include` and `image()` paths. Used for path completion.
 */
export const listProjectFiles = async (
  webdav: WebDAV,
  space: SpaceResource,
  mainResource: Resource
): Promise<string[]> => {
  const rootPath = parentPath(mainResource.path)
  const files: string[] = []
  const folders: { path: string; depth: number }[] = [{ path: rootPath, depth: 1 }]

  // breadth first, so the folders closest to the document are listed first
  for (let i = 0; i < folders.length && i < MAX_FOLDERS; i++) {
    const { path, depth } = folders[i]
    const { children } = await webdav.listFiles(space, { path })
    for (const child of children) {
      if (child.isFolder) {
        if (depth < MAX_DEPTH) {
          folders.push({ path: child.path, depth: depth + 1 })
        }
      } else if (child.path !== mainResource.path) {
        files.push(child.path.substring(rootPath === '/' ? 0 : rootPath.length))
      }
    }
  }
  return files.sort()
}
