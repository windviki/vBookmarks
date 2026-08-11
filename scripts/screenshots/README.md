# Screenshot & diagnostics harness

Headless Docker harness for vBookmarks. `run.sh` tars the repo into a build
context (bind mounts do not work in some DinD setups), builds
`zenika/alpine-chrome:with-puppeteer` with the extension baked in at `/ext`,
and runs three layers:

1. `smoke.js` (image CMD) — service worker registers; popup / side panel /
   options raise zero console errors; v4 behavioral assertions (rememberView
   boot, classic-experience chrome hiding, donation `#v4-notice`, palette
   wake-up paths, options groups, …).
2. `verify-keyboard.js` (blocking) — 100 hard assertions on the tab strip's
   bubble-phase keyboard model, focus zones, the header-row arrow chain,
   per-view ↑↓/past-top crossings (stats/dead/dupes stop at their in-list
   toolbar rung first), the banner's Tab-ring reachability and
   per-view rendering. Esc chains stay in vitest; see
   `docs/cdp-escape-limitation.md`.
3. `verify-scrollbars.js` (blocking) — the horizontal-scrollbar matrix probe:
   sweeps screen resolution × browser zoom (stubbed `chrome.tabs.getZoom`) ×
   in-extension zoom (`body[data-zoom]`) × popup size, and asserts every
   scrollable pane computes `overflow-x: hidden` (no horizontal scrollbar),
   the injected `.sync-indicator.synced` tooltips stay `display: none`
   (commit 98e29b3 root-cause guard) and the non-tree panes keep
   `scrollWidth <= clientWidth`. Vertical scrolling is expected and allowed.
4. Screenshot suites into `tmp/shots/` (git-ignored).

## Layout

```
scripts/screenshots/
├── run.sh              # entry point: build + smoke + keyboard + scrollbars + suites
├── Dockerfile          # copies smoke/verify into /work, suites+diag into subdirs
├── smoke.js            # layer 1 (image CMD)
├── verify-keyboard.js  # layer 2 (blocking)
├── verify-scrollbars.js# layer 3 (blocking) — scrollbar matrix probe
├── suites/             # layer 4 — screenshot suites, run in order by run.sh
│   ├── shots.js          # interaction states (palette/undo toast/donation/…)
│   ├── shots-matrix.js   # 4 themes × full surface matrix (21 shots/theme)
│   ├── shots-i18n.js     # 7 UI languages × 15 surfaces, light theme
│   ├── shots-palette.js  # palette + recent/stats/dupes/dead views
│   ├── shots-guide.js    # guide-only states for docs/guide-v4*.md
│   └── shots-tabgroups.js# tab-group surface (menus, dialogs, SW verify)
└── diag/               # manual probes, NOT run by run.sh
    ├── diag.js           # generic page-state dump
    ├── diag-dead.js      # dead-view row layout probes (hover, narrow/wide)
    ├── diag-v4t3.js      # v4 task-3 layout probes
    └── console/          # devtools-console snippets (paste into the popup's
        ├── diagnose_alignment.js  # row twisty/icon/text alignment geometry
        └── diagnose_colors.js     # recent-vs-tree computed text colors
```

## Usage

```bash
scripts/screenshots/run.sh                # full run
scripts/screenshots/run.sh --smoke-only   # layers 1+2 only

# Run a single suite or a diag probe manually:
docker build -t vbm-smoke:local -f scripts/screenshots/Dockerfile <ctx>
docker run --rm vbm-smoke:local node /work/suites/shots.js
docker run --rm vbm-smoke:local node /work/diag/diag.js
```

## Output layout

Shots are grouped by dimension into subdirectories under `tmp/shots/`
(git-ignored). Each suite writes only into its own directory:

```
tmp/shots/
├── themes/theme-<theme>-<surface>.png   # shots-matrix — 4 themes × 21 surfaces
├── i18n/<lang>-<surface>.png            # shots-i18n — 7 languages × 15 surfaces
├── states/NN-<name>.png                 # shots.js (01-13) + shots-palette (14-22)
├── tabgroups/NN-<name>.png              # shots-tabgroups (30-33)
├── guide/<name>.png                     # shots-guide
├── smoke/                               # smoke.js diagnostic shots
└── diag/                                # manual diag probes
```

Naming conventions are uniform per dimension:

- **Matrix**: `theme-<theme>-<surface>.png` — `<surface>` ∈ tree/search/
  recent/stats/dupes/dead, menu-bookmark/menu-folder/submenu-sort/
  submenu-tabgroup/submenu-bookmark-tabgroup, dialog-edit/dialog-new-folder/
  dialog-sort/dialog-confirm, wide/narrow, options/options-backup/
  options-styles, panel.
- **i18n**: `<lang>-<surface>.png`, `<lang>` ∈ en/ja/ko/ar/fr/de/ru.
- **States / tabgroups**: `NN-<name>.png` — the `NN-` series is stable
  across suites (01-11 interactions, 12-19 view-system, 30-33 tab-groups).
  Non-theme dimensions are uniformly light; the theme axis lives in themes/.

Guide screenshots are copied from `tmp/shots/guide/` into
`docs/images/guide/` after review (see `docs/README.md` for the harness
overview).

## Coverage matrix

Surfaces × suites. `shots-matrix` is the theme axis (× light/dark/ink/paper),
`shots-i18n` the language axis (× en/ja/ko/ar/fr/de/ru, light theme). Numbers
refer to the fixed shot prefix of the suite that owns them.

| Surface | shots.js (states) | shots-palette.js (states) | shots-matrix (×4 themes) | shots-i18n (×7 langs) |
|---|---|---|---|---|
| **Views** — tree | ✓ 01 | — | ✓ | ✓ |
| search | ✓ 02 (query+mark) | — | ✓ (query+mark) | ✓ (empty+history) |
| recent | ✓ 08 | — | ✓ | ✓ |
| stats | — | ✓ 13 | ✓ | ✓ |
| dupes | — | ✓ 14 | ✓ | ✓ |
| dead (+rescan) | — | ✓ 15-17 | ✓ (cached) | ✓ (cached) |
| **Pages** — options | ✓ 09 (top) | — | ✓ options/backup/styles | ✓ |
| options styles (CodeMirror) | ✓ 10 | — | ✓ options-styles | — |
| side panel | ✓ 11 | — | ✓ | — |
| **Dialogs** — command palette | ✓ 03 | ✓ 12/18/19 | — | — |
| edit | ✓ 05 | — | ✓ dialog-edit | ✓ |
| new-folder | — | — | ✓ dialog-new-folder | — |
| sort | — | — | ✓ dialog-sort | — |
| confirm | — | — | ✓ dialog-confirm | — |
| tab-group / pick | — | — | — | — (tabgroups 31/32) |
| **Menus** — bookmark | ✓ 04 | — | ✓ menu-bookmark | ✓ |
| folder | — | — | ✓ menu-folder | ✓ |
| sort flyout | — | — | ✓ submenu-sort | ✓ |
| tab-group flyout (folder) | — | — | ✓ submenu-tabgroup | ✓ |
| tab-group flyout (bookmark) | — | — | ✓ submenu-bookmark-tabgroup | ✓ |
| search-history | — | — | — | ✓ |
| **States** — undo toast | ✓ 06 | — | — | — |
| donation card | ✓ 07 (**the only shot**) | — | silenced | silenced |
| **Width variants** | — | — | wide 640 / narrow 280 | — |

Rules:

- **Donation**: silenced everywhere (`donationFactor=1, donationKey=30,
  currentVersion=<manifest>`) except `shots.js` shot 07 — the single donation
  capture, per the product requirement.
- **Naming**: matrix → `tmp/shots/theme-<theme>-<surface>.png`; i18n →
  `tmp/shots/i18n/<lang>-<surface>.png`.
- Menu geometry across DPR/zoom/viewport extremes is covered functionally by
  `verify-menu-overflow.js` / `verify-menu-collapse.js` / `verify-menu-extreme.js`
  (blocking, not screenshots).
