# Web App Typst

Typst editor for ownCloud Infinite Scale.
Live preview. Autocomplete. PDF, PNG and SVG export. Runs in the browser. No server needed.

## Install from release

Grab `typst-x.y.z.zip` from Releases.
Unzip it in your oCIS apps folder.
That's whatever `WEB_ASSET_APPS_PATH` points to.

```bash
unzip typst-x.y.z.zip -d /var/lib/ocis/apps/
```

You get `apps/typst/`. 
Now do the CSP thing below.

## Build from source

Need Node 24 and pnpm. Corepack picks the right pnpm.
Need internet. Fonts get downloaded during build.

```bash
git clone <this repo>
cd web-app-typst
corepack enable
pnpm install
pnpm build
```

Output is `dist/`.
Copy it to your oCIS apps folder as `typst`.

```bash
cp -r dist /var/lib/ocis/apps/typst
```

Now do the CSP thing below.

## CSP thing

Edit your CSP file (`PROXY_CSP_CONFIG_FILE_LOCATION`).
No CSP file yet? Copy `dev/docker/ocis/csp.yaml`.
Add these two lines:

```yaml
  connect-src:
    - 'https://packages.typst.org/'
  script-src:
    - '''wasm-unsafe-eval'''
```

Restart oCIS.

Open a `.typ` file.

## Dev

Add to `/etc/hosts`:

```
127.0.0.1 host.docker.internal
```

Then:

```bash
pnpm install
pnpm build:w
docker compose up
```

Go to https://host.docker.internal:9200. Login admin/admin.

## Notes

First load is big. About 11 MB compiler, 8 MB fonts. Cached after.
Imports from the same folder work. Subfolders too, 3 levels.
`@preview` packages work.
`../` imports don't.
Custom fonts don't.

## Tests

```bash
pnpm test:unit
```

## License

Apache-2.0. Started from [owncloud/web-app-skeleton](https://github.com/owncloud/web-app-skeleton).

Bundled stuff has its own licenses. See `THIRD-PARTY-NOTICES.txt` in the build.
License texts live in `licenses/`.
