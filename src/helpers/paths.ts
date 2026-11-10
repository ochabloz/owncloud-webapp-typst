// Encodes each segment of a `/`-separated path for use in a URL.
export const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')

// Resolves a path written in a Typst file like Typst does: relative to that
// file's folder, or to the project root when it starts with `/`.
export const resolvePath = (fromFile: string, path: string) => {
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
