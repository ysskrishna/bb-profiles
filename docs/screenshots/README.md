# Screenshot and recording provenance

These assets are browser captures of Profiles running inside a real, disposable
BB 0.50.1 instance on macOS (the isolated scratch server in
[docs/development.md](../development.md)). The plugin is pre-release code with
manifest version `0.1.0`. The data is three empty demo projects (Payments
service, Mobile app, Docs site) and three demo profiles loaded with
`bb profiles import`. No real projects, conversations or accounts are shown.

The scratch BB is not signed in to any provider. Codex and Claude Code list their
models without sign-in; Cursor lists none there, so Cursor is switched off in
every demo profile. No thread was started and no message was sent.

- `profiles-demo.gif`: one continuous recording in the dark theme, taken as
  timed page screenshots and resampled to ten frames per second, scaled to
  900 px wide. A new thread in Payments service starts on Opus 5.5 High with
  only Claude Code in the picker; switching the project to Mobile app selects
  the Mobile profile's Codex default and the picker offers only Codex; the
  composer's Profiles settings button then opens the settings page. The mouse
  cursor is not shown. It is not an AI-generated animation or a reconstructed
  interface.
- `settings-light.png`, `settings-dark.png`: the full settings page at 2x with
  the Payments profile selected, taller than the other captures so the whole
  page fits.
- `picker-payments-dark.png`, `picker-more-models-dark.png`,
  `picker-mobile-light.png`: screenshots at 2x cropped to the new-thread
  composer with BB's model picker open. The More models submenu also lists
  Claude Code's own alias models (`opus`, `sonnet` and others).
- `custom-models-light.png`: the Providers card on the Codex tab at 2x, with an
  example model ID typed into the Custom models row but not added.
- `composer-button-dark.png`: the composer at 2x with the Profiles settings
  button next to the microphone.
- `marketplace-overview.png`: a clearly separate composite: the plugin's panel
  cropped from `settings-dark.png` beside `picker-payments-dark.png` scaled to
  90%, without stretching. It does not depict one application window.

The live desktop can look different because of its width, theme, providers,
sign-ins and saved profiles. Regenerate with `npm run e2e:serve` and a browser
against the scratch URL; see [README media](../development.md#readme-media).
