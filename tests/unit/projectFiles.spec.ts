import { Resource, SpaceResource } from '@ownclouders/web-client'
import { WebDAV } from '@ownclouders/web-client/webdav'
import { listProjectFiles, parentPath } from '../../src/helpers/projectFiles'

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

describe('parentPath', () => {
  it('returns the folder of a file', () => {
    expect(parentPath('/Documents/thesis/main.typ')).toBe('/Documents/thesis')
  })
  it('returns the root for files at the top level', () => {
    expect(parentPath('/main.typ')).toBe('/')
  })
})

describe('listProjectFiles', () => {
  it('lists files relative to the document folder, including subfolders', async () => {
    const main = file('/Docs/thesis/main.typ')
    const { webdav, getFileContents } = createWebdav({
      '/Docs/thesis': [main, file('/Docs/thesis/refs.bib'), folder('/Docs/thesis/img')],
      '/Docs/thesis/img': [file('/Docs/thesis/img/logo.png'), file('/Docs/thesis/img/scan.pdf')]
    })

    const files = await listProjectFiles(webdav, space, main)

    expect(files).toEqual(['/img/logo.png', '/img/scan.pdf', '/refs.bib'])
    expect(getFileContents).not.toHaveBeenCalled()
  })

  it('keeps absolute paths when the document is at the space root', async () => {
    const main = file('/main.typ')
    const { webdav } = createWebdav({ '/': [main, file('/chapter.typ')] })

    expect(await listProjectFiles(webdav, space, main)).toEqual(['/chapter.typ'])
  })

  it('does not descend deeper than five folder levels', async () => {
    const main = file('/p/main.typ')
    const { webdav, listFiles } = createWebdav({
      '/p': [main, folder('/p/a')],
      '/p/a': [folder('/p/a/b')],
      '/p/a/b': [folder('/p/a/b/c')],
      '/p/a/b/c': [folder('/p/a/b/c/d')],
      '/p/a/b/c/d': [folder('/p/a/b/c/d/e'), file('/p/a/b/c/d/deep.typ')],
      '/p/a/b/c/d/e': [file('/p/a/b/c/d/e/too-deep.typ')]
    })

    expect(await listProjectFiles(webdav, space, main)).toEqual(['/a/b/c/d/deep.typ'])
    expect(listFiles).not.toHaveBeenCalledWith(space, { path: '/p/a/b/c/d/e' })
  })

  it('lists at most 100 folders, nearest first', async () => {
    const main = file('/p/main.typ')
    const tree: Record<string, Resource[]> = {
      '/p': [main, ...Array.from({ length: 150 }, (_, i) => folder(`/p/f${i}`))]
    }
    const { webdav, listFiles } = createWebdav(tree)

    await listProjectFiles(webdav, space, main)

    expect(listFiles).toHaveBeenCalledTimes(100)
    expect(listFiles).toHaveBeenCalledWith(space, { path: '/p' })
  })
})
