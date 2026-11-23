# Development

```sh
npm ci
npm run check   # lint, format, Knip, types, unit tests, script tests, build, bundle check
```

Install your working copy into BB with `bb plugin install /path/to/bb-profiles`.
That is your real BB: the plugin changes the model picker for your real
projects, and its custom model commands edit your BB `config.json`. Back up your
profiles first with `bb profiles export > profiles-backup.json`.

## Dependencies

BB installs a plugin from git with `npm install --omit=dev`, then builds it.
Anything the app or server imports at runtime goes in `dependencies`, such as
`zod` and `@radix-ui/react-slot`. The exception is a package BB shims at
runtime, such as `class-variance-authority`, `clsx` and `tailwind-merge`: it
goes in `devDependencies` at the host's version, because the build never
bundles it. `npx bb plugin types --check` flags a shimmed package in
`dependencies`.

## Tests

Unit tests run in Vitest with the SDK's fake plugin host for the server, jsdom
for the settings page, composer button and app overlay, and a real TanStack
`QueryClient` for the picker filter. They do not prove compatibility with a BB
version: the picker filter reads BB's query client through React internals, and
the settings button pushes BB's settings route. Check both by hand on the BB
minor in `engines.bb` before a release.

## Isolated scratch BB

`scripts/e2e/server.mjs` starts a disposable BB from the pinned `bb-app`
devDependency, adapted from Idle Compact's launcher:

- its own data directory under the system temp directory, two free loopback
  ports, and a Git repository per demo project;
- a scratch `HOME`, `XDG_*`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR` and `TMPDIR`,
  and on macOS a throwaway keychain;
- an empty loopback marketplace, so the catalog is never fetched;
- a guard that samples the scratch process tree and fails the run if any of
  them opens a file under the real `~/.codex`, `~/.claude`, `~/.cursor`,
  `~/.config` or `~/.bb`. Evidence goes to `e2e-artifacts/isolation.jsonl`
  (gitignored).

It refuses BB's usual port 38886 and deletes all scratch data when it stops.
It handles no credentials: it never signs in to a provider. Providers whose
model lists need a sign-in show no models there.

```sh
# CLI smoke test: profiles status, export and an import round trip.
env -i PATH="$PATH" HOME="$HOME" npm run e2e:smoke
```

## README media

`npm run e2e:serve` keeps a scratch BB running (120 minutes by default, change
it with `--minutes`) with the plugin installed from your working copy and three
demo projects: "Payments service", "Mobile app" and "Docs site". It writes the
URL, CLI path and projects to `e2e-artifacts/serve.json`, and the scratch
environment to `e2e-artifacts/serve.env` (paths and ports only).

```sh
env -i PATH="$PATH" HOME="$HOME" npm run e2e:serve
```

Point the BB CLI at the scratch server with the variables in `serve.env`.
Without them it talks to your real BB. Capture with a browser against the scratch URL.

## Moving profiles between servers

```sh
bb profiles export > profiles-backup.json
bb profiles import profiles-backup.json
```
