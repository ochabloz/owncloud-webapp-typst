import { WebDavAccessModel, type FetchResult } from '../../src/helpers/webdavAccessModel'
import { encodePath, resolvePath } from '../../src/helpers/paths'

const bytes = (text: string) => new TextEncoder().encode(text)

const createModel = (files: Record<string, FetchResult>) => {
  const fetchFile = vi.fn((path: string) => files[path] ?? { status: 404 })
  return { model: new WebDavAccessModel(fetchFile), fetchFile }
}

describe('WebDavAccessModel', () => {
  it('fetches a file once and then serves it from memory', () => {
    const { model, fetchFile } = createModel({ '/a.png': { status: 200, data: bytes('png') } })

    expect(model.readAll('/a.png')).toEqual(bytes('png'))
    expect(model.readAll('/a.png')).toEqual(bytes('png'))
    expect(fetchFile).toHaveBeenCalledTimes(1)
  })

  it('remembers why a file could not be read', () => {
    const { model, fetchFile } = createModel({ '/secret.png': { status: 403 } })

    expect(model.readAll('/missing.png')).toBeUndefined()
    expect(model.readAll('/secret.png')).toBeUndefined()
    expect(model.readAll('/missing.png')).toBeUndefined()
    expect(model.failure('/missing.png')).toBe(404)
    expect(model.failure('/secret.png')).toBe(403)
    expect(model.failure('/never-requested.png')).toBeUndefined()
    expect(fetchFile).toHaveBeenCalledTimes(2)
  })

  it('fetches again after clear()', () => {
    const { model, fetchFile } = createModel({ '/a.typ': { status: 200, data: bytes('x') } })
    model.readAll('/a.typ')
    model.readAll('/gone.typ')

    expect(model.clear()).toEqual(['/a.typ', '/gone.typ'])
    model.readAll('/a.typ')
    expect(fetchFile).toHaveBeenCalledTimes(3)
  })

  it('keeps package files in memory without fetching them', () => {
    const { model, fetchFile } = createModel({})
    const path = '/@memory/fetch/packages/preview/cetz/0.5.3/lib.typ'
    model.insertFile(path, bytes('pkg'), new Date())

    expect(model.readAll(path)).toEqual(bytes('pkg'))
    expect(model.clear()).toEqual([])
    expect(model.readAll(path)).toEqual(bytes('pkg'))
    expect(fetchFile).not.toHaveBeenCalled()
  })
})

describe('resolvePath', () => {
  it('resolves relative to the file folder', () => {
    expect(resolvePath('/main.typ', 'img/a.png')).toBe('/img/a.png')
    expect(resolvePath('/chapters/one.typ', 'fig.png')).toBe('/chapters/fig.png')
    expect(resolvePath('/chapters/one.typ', '../refs.bib')).toBe('/refs.bib')
    expect(resolvePath('/chapters/one.typ', './x/./y.typ')).toBe('/chapters/x/y.typ')
  })

  it('resolves absolute paths against the project root', () => {
    expect(resolvePath('/chapters/one.typ', '/img/a.png')).toBe('/img/a.png')
  })
})

describe('encodePath', () => {
  it('encodes each segment but keeps the slashes', () => {
    expect(encodePath('/my images/été #1.png')).toBe('/my%20images/%C3%A9t%C3%A9%20%231.png')
  })
})
