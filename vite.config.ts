import { defineConfig } from '@ownclouders/extension-sdk'
import type { Plugin } from 'vite'
import { thirdPartyNotices } from './scripts/thirdPartyNotices'

// typst.ts evaluates strings as code in a few places, which would force admins
// to allow 'unsafe-eval' in the oCIS CSP (on top of 'wasm-unsafe-eval'):
// - the compiler's wasm-bindgen glue builds trivial functions from fixed
//   strings in the wasm (`new Function("return 0")`, placeholder access model
//   callbacks, ...)
// - Node.js-only code paths use `new Function('m', 'return import(m)')`, and
//   the loader shim takes that path because the oCIS runtime defines `process`
// Every replacement must match, so a typst.ts upgrade that changes the code
// fails the build instead of silently breaking the app under the CSP.
const typstFunctionTable = `const __typstFunctions = {
  '': function () {},
  'return 0': function () { return 0 },
  'return true': function () { return true },
  'return this': function () { return globalThis },
  "throw new Error('Dummy AccessModel, please initialize compiler with withAccessModel()')": function () {
    throw new Error('Dummy AccessModel, please initialize compiler with withAccessModel()')
  },
  "throw new Error('Dummy Registry, please initialize compiler with withPackageRegistry()')": function () {
    throw new Error('Dummy Registry, please initialize compiler with withPackageRegistry()')
  },
  'path\\nreturn path': function (path) { return path }
};
// anything not in the table still goes through Function (and fails loudly under the CSP)
const __typstFunction = (...parts) => {
  const key = parts.join('\\n');
  return Object.hasOwn(__typstFunctions, key) ? __typstFunctions[key] : new Function(...parts);
};
`
const nodeOnly = "() => { throw new Error('Node.js only code path') }"

const typstCspPatches: {
  file: RegExp
  prepend?: string
  replacements: [search: string, replace: string][]
}[] = [
  {
    file: /typst-ts-web-compiler\/pkg\/typst_ts_web_compiler\.mjs$/,
    prepend: typstFunctionTable,
    replacements: [
      [
        'new Function(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3))',
        '__typstFunction(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3))'
      ],
      [
        'new Function(getStringFromWasm0(arg0, arg1))',
        '__typstFunction(getStringFromWasm0(arg0, arg1))'
      ]
    ]
  },
  {
    file: /typst-ts-(web-compiler|renderer)\/pkg\/wasm-pack-shim\.mjs$/,
    replacements: [
      ["new Function('m', 'return import(m)')", nodeOnly],
      ['if (isNode) {', 'if (false) {']
    ]
  },
  {
    file: /typst\.ts\/dist\/esm\/(init|contrib\/snippet)\.mjs$/,
    replacements: [["new Function('m', 'return import(m)')", nodeOnly]]
  }
]

const typstCspSafe = (): Plugin => ({
  name: 'typst-csp-safe',
  enforce: 'pre',
  transform(code, id) {
    const patch = typstCspPatches.find(({ file }) => file.test(id))
    if (!patch) {
      return
    }
    let patched = code
    for (const [search, replace] of patch.replacements) {
      if (!patched.includes(search)) {
        this.error(`typst-csp-safe: expected \`${search}\` in ${id}`)
      }
      patched = patched.replaceAll(search, replace)
    }
    return { code: (patch.prepend ?? '') + patched, map: null }
  }
})

const notices = thirdPartyNotices()

export default defineConfig({
  name: 'web-app-typst',
  // relative asset URLs: the wasm modules and fonts are resolved against the
  // app's own location (/assets/apps/typst/ in oCIS) instead of the host root
  base: './',
  plugins: [typstCspSafe(), notices.main()],
  // the compiler worker (src/helpers/typst.worker.ts) is bundled separately:
  // as an ES module because typst.ts loads its wasm glue with dynamic imports,
  // and with its own copy of the CSP patches and notices collection
  worker: {
    format: 'es',
    plugins: () => [typstCspSafe(), notices.worker()]
  },
  server: {
    port: 9224
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'index.js'
      }
    }
  }
})
