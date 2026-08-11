# Real-browser verify harness

Headless Docker verification for vBookmarks. `run.sh` tars the repo into a
build context (bind mounts do not work in some DinD setups), builds
`zenika/alpine-chrome:with-puppeteer` with the extension baked in at `/ext`,
and runs the blocking hard-assertion gate. Visual capture lives separately in
`scripts/screenshots/` (same image, runs only the screenshot suites).

## The gate (scripts/harness/run.sh)

1. `smoke.js` (image CMD) — service worker registers; popup / side panel /
   options raise zero console errors; v4 behavioral assertions (rememberView
   boot, classic-experience chrome hiding, donation `#v4-notice`, palette
   wake-up paths, options groups, …).
2. `verify-keyboard.js` (blocking) — 132 hard assertions on the tab strip's
   bubble-phase keyboard model, focus zones, the header-row arrow chain,
   per-view ↑↓/past-top crossings (stats/dead/dupes stop at their in-list
   toolbar rung first), the banner's Tab-ring reachability, the collapsed
   submenu arrow/wrap/`←`-peel behavior and per-view rendering. Esc chains
   stay in vitest; see `docs/cdp-escape-limitation.md`.
3. `verify-scrollbars.js` (blocking) — the horizontal-scrollbar matrix probe:
   sweeps screen resolution × browser zoom (stubbed `chrome.tabs.getZoom`) ×
   in-extension zoom (`body[data-zoom]`) × popup size, and asserts every
   scrollable pane computes `overflow-x: hidden` (no horizontal scrollbar),
   the injected `.sync-indicator.synced` tooltips stay `display: none`
   (commit 98e29b3 root-cause guard) and the non-tree panes keep
   `scrollWidth <= clientWidth`. Vertical scrolling is expected and allowed.
4. `verify-menu-overflow.js` (blocking) — issue #48: a context menu taller
   than the popup must be clamped (internal scroll) and stay open — never
   dismissed by the `menu.focus()`-induced document scroll.
5. `verify-menu-collapse.js` (blocking) — the collapsed tab-group/sort
   flyouts: sort collapse shortens the folder menu, the flyout opens inside
   the viewport, dispatch works, and the tab-group collapse applies to both
   menus.
6. `verify-menu-extreme.js` (blocking) — DPR × page-zoom × popup-size sweep:
   menus and flyouts must open, stay open, never clip (viewport-capped width)
   and never cover their collapse entry when a side placement is possible.

## Layout

```
scripts/
├── console/            # browser-DevTools-console probe snippets — paste the
│   │                   # whole file into the popup's Inspect console to
│   │                   # collect [VBM] diagnostics on the user's machine.
│   ├── probe-resize.js      # popup width-drag probe
│   ├── probe-folder-menu.js # #48 folder right-click menu probe
│   ├── probe-alignment.js   # row twisty/icon/text alignment geometry
│   └── probe-colors.js      # recent-vs-tree computed text colors
├── harness/             # THIS directory — Docker real-browser verify gate
│   ├── run.sh              # build + smoke + all verify-* (blocking)
│   ├── rerun.sh            # fast rebuild + run one diag/shot script
│   ├── Dockerfile          # the shared image (verify + shots + diag)
│   ├── smoke.js            # layer 1 (image CMD)
│   ├── verify-keyboard.js / verify-scrollbars.js / verify-menu-overflow.js
│   │   / verify-menu-collapse.js / verify-menu-extreme.js
│   └── diag/               # manual diagnostic probes, NOT run by run.sh
│       ├── diag-environment.js  # generic page-state dump (targets, version)
│       ├── diag-402-header.js   # 4.0.2 header + search-history compact probe
│       ├── diag-402-userstyle.js# userstyle (custom CSS) cascade probe
│       ├── diag-402-visual.js   # 4.0.2 visual facts dump (design doc input)
│       ├── diag-favicon-dark.js # no-favicon icon visibility on dark/ink
│       └── diag-favicon-e2e.js  # no-favicon row must render the SVG globe
└── screenshots/         # PURE visual capture — see scripts/screenshots/README.md
    └── shots-*.js
```

## Usage

```bash
scripts/harness/run.sh               # the verify gate (blocking, ~5-6 min)
scripts/harness/rerun.sh diag/diag-environment.js
scripts/harness/rerun.sh shots-matrix.js     # run a screenshot suite ad-hoc
```

## Output

Diagnostic screenshots a diag/shot probe writes land under `tmp/shots/`
(git-ignored); the screenshot suites' output layout is documented in
`scripts/screenshots/README.md`.
