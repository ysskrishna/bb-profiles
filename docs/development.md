# Development

```sh
npm ci
npm run check   # lint, format, Knip, types, unit tests, script tests, build, bundle check
```

Install your working copy into BB with `bb plugin install /path/to/bb-profiles`.
That is your real BB: the plugin changes the model picker for your real
projects, and its custom model commands edit your BB `config.json`. Back up your
profiles first with `bb profiles export > profiles-backup.json`.

## Tests

Unit tests run in Vitest with the SDK's fake plugin host for the server, jsdom
for the settings page, composer button and app overlay, and a real TanStack
`QueryClient` for the picker filter. They do not prove compatibility with a BB
version: the picker filter reads BB's query client through React internals, and
the settings button pushes BB's settings route. Check both by hand on the BB
minor in `engines.bb` before a release.

## Moving profiles between servers

```sh
bb profiles export > profiles-backup.json
bb profiles import profiles-backup.json
```
