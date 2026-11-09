import { Resource, SpaceResource } from '@ownclouders/web-client'
import { WebDAV } from '@ownclouders/web-client/webdav'
import { loadProjectFiles, parentPath } from '../../src/helpers/projectFiles'

const file = (path: string, size = 10) =>
  ({
    path,
    name: path.split('/').pop(),
    extension: path.split('.').pop(),
    isFolder: false,
    size
  }) as unknown as Resource

const folder = (path: string) => ({ path, isFolder: true }) as unknown as Resource

const createWebdav = (tree: Record<string, Resource[]>) => {
  const listFiles = vi.fn(async (_space: SpaceResource, { path }: { path: string }) => ({
    resource: folder(path),
    children: tree[path] ?? []
  }))
  const getFileContents = vi.fn(async (_space: SpaceResource, { path }: { path: string }) => ({
    body: new TextEncoder().encode(`content of ${path}`).buffer
  }))
  return { webdav: { listFiles, getFileContents } as unknown as WebDAV, listFiles, getFileContents }
}

const space = {} as SpaceResource
const decode = (data: Uint8Array) => new TextDecoder().decode(data)

describe('parentPath', () => {
  it('returns the folder of a file', () => {
    expect(parentPath('/Documents/thesis/main.typ')).toBe('/Documents/thesis')
  })
  it('returns the root for files at the top level', () => {
    expect(parentPath('/main.typ')).toBe('/')
  })
})

describe('loadProjectFiles', () => {
  it('maps files relative to the document folder, including subfolders', async () => {
    const main = file('/Docs/thesis/main.typ')
    const { webdav } = createWebdav({
      '/Docs/thesis': [main, file('/Docs/thesis/refs.bib'), folder('/Docs/thesis/img')],
      '/Docs/thesis/img': [file('/Docs/thesis/img/logo.png')]
    })

    const files = await loadProjectFiles(webdav, space, main)

    expect([...files.keys()].sort()).toEqual(['/img/logo.png', '/refs.bib'])
    expect(decode(files.get('/refs.bib'))).toBe('content of /Docs/thesis/refs.bib')
  })

  it('keeps absolute paths when the document is at the space root', async () => {
    const main = file('/main.typ')
    const { webdav } = createWebdav({ '/': [main, file('/chapter.typ')] })

    const files = await loadProjectFiles(webdav, space, main)

    expect([...files.keys()]).toEqual(['/chapter.typ'])
  })

  it('skips the main file, unsupported types and oversized files', async () => {
    const main = file('/p/main.typ')
    const { webdav, getFileContents } = createWebdav({
      '/p': [main, file('/p/movie.mp4'), file('/p/main.pdf'), file('/p/huge.png', 50_000_000)]
    })

    const files = await loadProjectFiles(webdav, space, main)

    expect(files.size).toBe(0)
    expect(getFileContents).not.toHaveBeenCalled()
  })

  it('does not descend deeper than three folder levels', async () => {
    const main = file('/p/main.typ')
    const { webdav, listFiles } = createWebdav({
      '/p': [main, folder('/p/a')],
      '/p/a': [folder('/p/a/b')],
      '/p/a/b': [folder('/p/a/b/c'), file('/p/a/b/deep.typ')],
      '/p/a/b/c': [file('/p/a/b/c/too-deep.typ')]
    })

    const files = await loadProjectFiles(webdav, space, main)

    expect([...files.keys()]).toEqual(['/a/b/deep.typ'])
    expect(listFiles).not.toHaveBeenCalledWith(space, { path: '/p/a/b/c' })
  })
})
