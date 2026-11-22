# Working in Profiles

## Scope

Profiles decides which providers and models show in BB's model picker for each
project, which model a new thread starts on, and which custom model IDs BB
knows. BB owns models, providers, the picker, and `customModels`. Reuse its
lists and RPC; do not add fallback routing, model access enforcement, per-thread
overrides, or per-profile custom models.

## Architecture

- Browser entry: `app.tsx` (overlay that installs the picker filter, composer
  button, settings page). Server entry: `src/server.ts`. Browser-only state and
  data hooks are in `lib/`. Pure shared modules: `src/profiles.ts`,
  `src/picker-projection.ts`, `src/picker-filter.ts`, `src/composer-default.ts`,
  `src/channels.ts`, `src/contract.ts`. Server-only modules are named
  `src/server-*.ts`. `biome.json` enforces the boundaries.
- `src/profiles.ts` holds the data model, validation and pure profile
  operations; `src/picker-projection.ts` reduces a model list to what a profile
  shows; `src/composer-default.ts` decides when a draft gets its default model.
  Decisions are pure functions with unit tests; the server only stores and
  publishes.
- `src/contract.ts` holds the RPC schemas. The app imports its types only, so
  zod stays out of the browser bundle (`scripts/check-app-bundle.mjs`). Realtime
  channel names live in `src/channels.ts` for the same reason.
- The snapshot lives in one plugin storage row (`bb.storage.kv`, key
  `profiles`, `{version, snapshot}`), validated on read. KV rows hold 256 KB, so
  the snapshot limit is 255 KB. Mutations run one at a time in-process and bump
  a revision; clients ignore older revisions. Changing the stored shape needs
  a parse that accepts the old one. `bb profiles export` and `import` move the
  whole snapshot.
- Picker filtering (`src/picker-filter.ts`) finds BB's TanStack query client
  through a React fiber above a hidden anchor, wraps `defaultQueryOptions`, and
  adds a `select` to `systemExecutionOptions` queries so the cached response is
  untouched. A picker's project comes from the query key's environment id
  (mapped through `sdk.environments.list`), else the mounted new-thread
  composer's project, else Default. Remove mode returns a More models list whose
  `filter` and `find` are own members, because TanStack's structural sharing
  would otherwise rebuild it as a plain array.
- Custom models (`src/server-custom-models.ts`) read and rewrite only the
  top-level `customModels` key of `<dataDir>/config.json` with an atomic write,
  refuse a file they cannot parse, and call `reloadConfig` afterwards.
- Every UI surface and hook used is `experimental_`, and the picker filter and
  the settings button depend on BB internals. Keep `engines.bb` pinned to the
  tested BB minor and the SDK pinned exactly.
- The display name is Profiles. The package, runtime, and marketplace ID are
  `bb-profiles`. BB stores plugin data by ID; an identity change needs an
  explicit data transfer (`bb profiles export` then `import`).

## Checks and changes

- Keep changes focused. Commit verified slices on a task branch. Follow the PR
  template; do not merge without the user's request. No AI authors or
  attribution trailers.
- Run `npm ci` in a fresh checkout to install the hooks. Run `npm run check`
  before and after source changes: lint, formatting, Knip, types, unit tests,
  script tests, build, and the bundle check.
- Remove unused imports and exports; do not add Knip exceptions for dead code.
  Production files and scripts stay within 500 lines, tests within 1,000.
- Prove a regression test fails before its fix.
- Installing a build into BB acts on the real host; read [docs/development.md](docs/development.md)
  first and export your profiles before trying one.
- Keep machine configuration, credentials, private notes, and live
  conversation screenshots out of this public repository.

## Tag-based releases

- A package version is manifest metadata, not proof of publication. Keep
  unreleased work on the planned stable X.Y.Z version and tie the README
  release badge to GitHub Releases. Only stable vX.Y.Z tags are supported.
- Prepare a release on a branch: `npm version X.Y.Z --no-git-tag-version`, put
  the shipped notes under a nonempty `## [X.Y.Z]` section in `CHANGELOG.md`,
  and review through a PR. Verify both lockfile version fields match.
- Only after the release preparation is merged and publication is authorized,
  tag that commit with `git tag -a vX.Y.Z -m 'Release vX.Y.Z'` and push the tag.
- `.github/workflows/release.yml` accepts stable `vX.Y.Z` tags included in
  `main`, checks the manifest versions and the plugin, then uses the pinned
  `ysskrishna/changelog-release-action` to publish the matching changelog
  notes. No tag is created by CI and no release by a normal push or PR.
- Release automation does not submit marketplace entries. Follow
  `docs/marketplace.md`. Never retag an existing release to repair it.
