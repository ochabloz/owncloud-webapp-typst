import { Resource, SpaceResource } from '@ownclouders/web-client'
import { WebDAV } from '@ownclouders/web-client/webdav'

// Only files the Typst compiler can actually read are loaded, and the walk is
// bounded so opening a .typ file in a large folder stays cheap.
const PROJECT_FILE_EXTENSIONS = [
  'typ',
  'bib',
  'yml',
  'yaml',
  'json',
  'toml',
  'csv',
  'xml',
  'txt',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp'
]
const MAX_DEPTH = 3
const MAX_FILES = 100
const MAX_FILE_SIZE = 5_000_000

export const parentPath = (path: string) => path.substring(0, path.lastIndexOf('/')) || '/'

const isProjectFile = (resource: Resource) =>
  !resource.isFolder &&
  PROJECT_FILE_EXTENSIONS.includes(resource.extension?.toLowerCase()) &&
  Number(resource.size) <= MAX_FILE_SIZE

/**
 * Loads the files next to (and below) the main document, keyed by their path
 * relative to the document's folder (e.g. `/chapters/intro.typ`), which is
 * how Typst resolves `#import`, `#include` and `image()` paths.
 */
export const loadProjectFiles = async (
  webdav: WebDAV,
  space: SpaceResource,
  mainResource: Resource
): Promise<Map<string, Uint8Array>> => {
  const rootPath = parentPath(mainResource.path)
  const resources: Resource[] = []

  const walk = async (path: string, depth: number) => {
    const { children } = await webdav.listFiles(space, { path })
    for (const child of children) {
      if (resources.length >= MAX_FILES) {
        return
      }
      if (child.isFolder) {
        if (depth < MAX_DEPTH) {
          await walk(child.path, depth + 1)
        }
      } else if (isProjectFile(child) && child.path !== mainResource.path) {
        resources.push(child)
      }
    }
  }
  await walk(rootPath, 1)

  const files = new Map<string, Uint8Array>()
  await Promise.all(
    resources.map(async (resource) => {
      const { body } = await webdav.getFileContents(
        space,
        { path: resource.path },
        { responseType: 'arraybuffer' }
      )
      const relativePath = resource.path.substring(rootPath === '/' ? 0 : rootPath.length)
      files.set(relativePath, new Uint8Array(body))
    })
  )
  return files
}
