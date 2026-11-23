# BB Community listing

The public registry is [get-bb/marketplace](https://github.com/get-bb/marketplace#submit-a-plugin).
A reviewed pull request adds the plugin to BB Community. The
[community submission](https://github.com/get-bb/marketplace/pull/1040) was merged
on 2026-11-23. Profiles is live on
[BB Marketplace](https://getbb.app/marketplace/bb-profiles).

Install from the listing with `bb plugin install bb-profiles`.

## Updating the listing

1. Merge and verify the plugin PR.
2. Publish a stable version using [tag-based releases](../AGENTS.md#tag-based-releases).
3. Verify a fresh install from that exact public tag on a compatible BB version.
   Recheck current marketplace requirements and SDK/host dependency placement.
4. Update `entries/bb-profiles.json` in a fork of `get-bb/marketplace` when
   the source, name, or branding changes. The current entry is shown below.
5. Copy `PLUGIN_OVERVIEW.md` to `overview/bb-profiles.md`. It must be plain
   supported Markdown, under 4,000 characters, with absolute HTTPS links.
6. Copy `docs/screenshots/marketplace-overview.png` to
   `screenshots/bb-profiles/overview.png`. Current community rules require
   PNG/JPEG/WebP images at least 1,200 px wide and no larger than 2 MiB; up to six.
7. In the registry checkout run `npm ci`, `npm run build`, `npm test`,
   `npm run gate:v1`, and `npm run check`. The last check validates the remote source.
8. Open a registry PR for the changes and address maintainer review. Verify
   updates on the live listing after the PR is merged.

A `range` source discovers stable version tags, so later compatible releases do
not require editing the registry entry. Source, name, and branding changes do.
The range starts at `^0.1.1` because v0.1.0 does not build from a git install.

## Registry entry

The package, runtime, and marketplace share the `bb-profiles` identity.

```json
{
  "id": "bb-profiles",
  "displayName": "Profiles",
  "description": "Choose which providers and models appear in the model picker for each project, and the default model new threads start on.",
  "icon": "SlidersHorizontal",
  "tags": ["profiles", "models", "model-picker", "providers", "default-model", "custom-models"],
  "author": {
    "name": "Y. Siva Sai Krishna",
    "github": "ysskrishna",
    "url": "https://ysskrishna.space"
  },
  "category": "agents-and-providers",
  "overview": "./overview/bb-profiles.md",
  "screenshots": ["./screenshots/bb-profiles/overview.png"],
  "source": {
    "git": {
      "url": "https://github.com/ysskrishna/bb-profiles.git",
      "range": "^0.1.1"
    }
  }
}
```

`agents-and-providers` is where the registry lists other model-picker plugins
(Hide Models, Model Presets). Recheck `marketplace.base.json` before changing the entry.
