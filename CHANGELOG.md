# Changelog

## [Unreleased]

### Added

- A GitHub Actions workflow, run manually or on pull requests that touch the e2e files, that runs the scratch BB e2e smoke test.
- A weekly "BB compat" workflow that runs the type check and scratch smoke test against any newer BB outside `engines.bb` and reports in a `bb-compat` issue.

### Changed

- Moved the GitHub release install into a collapsed "Install a specific release from GitHub" section in the README.
- Added the live BB Marketplace badge and installation command, and updated the listing documentation.

### Fixed

- `class-variance-authority` is a development dependency again, as BB's SDK check requires. BB provides it at runtime, so git installs still build and the built plugin is unchanged.

## [0.1.1]

### Fixed

- Installing from a release tag failed because the settings page's button libraries were only development dependencies. They now ship with the plugin.

## [0.1.0]

### Added

- Per-project profiles that choose which providers and models appear in BB's model picker, with a Default profile for every project without one.
- A default provider, model and reasoning level per profile, selected in new-thread composers until you pick another.
- Provider switches and model limits per profile, with unselected models under More models or removed from the picker.
- Custom model IDs for providers BB does not list, written to BB's config and reloaded.
- A settings page and a composer button that opens it.
- `bb profiles` with `status`, `reset`, `export`, `import` and `models list|add|remove`.
