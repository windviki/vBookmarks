# vBookmarks Theme Authoring Guide (EN, condensed)

> The canonical, deepest guide is the Chinese original: [theme-guide.md](theme-guide.md)
> (tiered token promises, the stable-selector contract, the tag-ink law, density
> tiers). This English condensation covers everything you need to ship a first
> theme; read the original before publishing anything ambitious.

## Two routes

| Route | Form | For | Stability |
|---|---|---|---|
| **Theme package** (recommended) | one `.vbmtheme.json`: structured tokens + optional `advancedCss` | almost every theme | tokens = a stable API that follows extension upgrades |
| **Custom CSS** (advanced) | Options → Custom CSS workbench: free CSS, cascaded on top | decorative tweaks, experiments | best-effort: selector drift is on you |

Packages import in Options → Theme management (file picker, or drop the file on the group card). Theme content is stored locally (a synced style sheet would not fit) — export/import the file to move devices.

## Package format

```json
{
  "format": 1,
  "id": "dracula-neonlinx",
  "name": "Dracula",
  "author": "Neonlinx",
  "version": "1.0.0",
  "colorScheme": "dark",
  "tokens": {
    "--vbm-bg": "#282a36",
    "--vbm-bg-elev": "#343746",
    "--vbm-canvas": "#21222c",
    "--vbm-fg": "#f8f8f2",
    "--vbm-muted": "#8b95c4",
    "--vbm-accent": "#bd93f9",
    "--vbm-bg-selected": "#44475a",
    "--vbm-bg-hover": "color-mix(in srgb, #8be9fd 9%, #282a36)"
  },
  "advancedCss": "/* optional: component-level overrides, best-effort */"
}
```

- `format` must be `1`; `id` is `[a-z0-9-]`; `colorScheme` is required `dark|light`
  (drives control bases and the favicon flip baseline); files cap at 256 KB
  (counted in bytes). The theme library itself is budgeted too: at most 20
  themes / 2 MB total (R15-C8).
- **Two-layer contract**: only in-vocabulary token keys are honored (unknown keys
  warn); unset tokens fall back to the built-in defaults — new tokens in future
  versions stay compatible, the decisive advantage over raw CSS.
- Write `--vbm-bg` as a literal `#rrggbb` (favicon dark detection reads hex only).
- `@import` and remote `url(https…)` are blocked by the extension CSP — in
  `advancedCss` and in token values alike (R15-C9③; both warned at import).
  Fonts must be locally installed family names; embed images as `data:` URLs.
- `advancedCss` lands in the Custom CSS workbench as a managed "Theme styles:
  <name>" entry (enabled on apply, disabled when you switch away, removed with
  the theme); it always sits under your own custom CSS.

## Vocabulary, condensed

- **Tier 1 — colors & materials (stable)**: planes (`--vbm-canvas/bg/bg-elev`),
  interaction (`--vbm-bg-hover/bg-selected/flash`), text (`--vbm-fg`,
  `--vbm-fg-selected`, `--vbm-muted`, `--vbm-fg-folder`, `--vbm-icon-folder`),
  chrome (`--vbm-border/shadow/scrim/scrollbar(-hover)`), accent family
  (`--vbm-accent(-fg/-hover/-subtle)`, `--vbm-focus-ring`, `--vbm-temper`),
  semantic (`--vbm-danger(-fg)`, `--vbm-warning(-fg)`, `--vbm-pill-warning-*`,
  `--vbm-success`), elevation (`--vbm-elev-1/2`), micro-motion channels
  (`--vbm-pop-hover/press`, `--vbm-glow-hover/focus/selected`,
  `--vbm-row-hover-rule`, `--vbm-row-focus-animation`, current-row trio,
  `--vbm-row-hover-underline`) and the "enthusiast" channels (`--vbm-canvas-image(-size)`,
  `--vbm-overlay-blur/image`, `--vbm-accent-glow`, `--vbm-tree-line`) — all
  default-off; a quiet theme just fills the core colors.
  **Dark themes must explicitly declare `--vbm-row-active-bg/fg`** — the
  `:root` defaults freeze light-mode values otherwise.
- **Tier 2 — geometry (major-version only)**: radii, `--vbm-row-h`, spacing
  (`--vbm-space-1/2/3`, `--vbm-shell`, the search-inset pair
  `--vbm-head-room`/`--vbm-leg-room` — symmetric since R15-C11),
  slots, type scale (`--vbm-text-sm/md/base`, `--vbm-font-ui`),
  `--vbm-row-active-weight`, `--vbm-dur-1/2`, `--vbm-ease`.
- Density is an orthogonal setting — themes never set row height.
- The tag nine-color set is a Chrome-platform asset, constant across themes;
  your only lever is `--vbm-tag-ink` (default 50%; warm light themes raise it
  to ~58% for pale-hue AA).

## The official showcase package

[`docs/samples/aurora-bench.vbmtheme.json`](samples/aurora-bench.vbmtheme.json) (Aurora Bench) is the official show-off sample: its token layer rides EVERY enthusiast channel (phosphor hover/focus/selected glows, press bounce, the hover light bar, a gradient current-row, the three-layer aurora canvas image, glass floats with blur + top light, dialog glow, dyed connector rails, the focus breathing, the radius family), and its advancedCss demonstrates custom keyframes, a REAL aurora-sky image on the desk (url(data:) SVG), a glowing orb cursor, a spinning conic aureole on hovered rows (@property; moved off the current row in R8), speckle-textured hovers plus an always-on speckle under the current row's breathe, deep Chrome-curve tabs (13px), a full nine-glyph tab-icon re-skin, the point-symmetric console frame with accent seams and a glassified list card the sky shines through (R8), glassified floats, a neon rim on tag chips, glowing empty states, dyed scrollbars and a travelling aurora current on the staging connectors — all on the stable-selector vocabulary only. Download and import it under Options → Theme management; the import report is zero-errors/zero-warnings (guarded by tests/theme-sample.test.js).

> Since 2026-09-26 the options page's theme group carries an **official sample themes** link (this directory's GitHub page), so there is no need to dig through the repository by hand; the guide link (this document) sits on the row right above it.

## Quality bar

AA contrast is pre-checked at import (body ≥7:1, secondary ≥4.5:1, badge
on-colors ≥4.5:1, tag chips replayed per your ink mix); semantic colors never
double as decoration; `prefers-reduced-motion` is clamped globally. Stable
selector vocabulary for `advancedCss` is contracted in `tests/theme-compat.test.js`
— see the Chinese original for the full list.
