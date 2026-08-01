# Screenshot & diagnostics harness

Headless Docker harness for vBookmarks. `run.sh` tars the repo into a build
context (bind mounts do not work in some DinD setups), builds
`zenika/alpine-chrome:with-puppeteer` with the extension baked in at `/ext`,
and runs three layers:

1. `smoke.js` (image CMD) — service worker registers; popup / side panel /
   options raise zero console errors; v4 behavioral assertions (rememberView
   boot, classic-experience chrome hiding, donation `#v4-notice`, palette
   wake-up paths, options groups, …).
2. `verify-keyboard.js` (blocking) — 43 hard assertions on the tab strip's
   bubble-phase keyboard model, focus zones and per-view rendering. Esc
   chains stay in vitest; see `docs/cdp-escape-limitation.md`.
3. Screenshot suites into `tmp/shots/` (git-ignored).

## Layout

```
scripts/screenshots/
├── run.sh              # entry point: build + smoke + keyboard + all suites
├── Dockerfile          # copies smoke/verify into /work, suites+diag into subdirs
├── smoke.js            # layer 1 (image CMD)
├── verify-keyboard.js  # layer 2 (blocking)
├── suites/             # layer 3 — screenshot suites, run in order by run.sh
│   ├── shots.js          # interaction states, light + dark
│   ├── shots-themes.js   # view tab strip + full-state rows on all 5 themes
│   ├── shots-i18n.js     # tree/tabs/menus/dialog/options × 8 UI languages
│   ├── shots-palette.js  # palette + recent/stats/dupes/dead views
│   └── shots-guide.js    # guide-only states for docs/guide-v4*.md
└── diag/               # manual probes, NOT run by run.sh
    ├── diag.js           # generic page-state dump
    ├── diag-dead.js      # dead-view row layout probes (hover, narrow/wide)
    └── diag-v4t3.js      # v4 task-3 layout probes
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

Guide screenshots are copied from `tmp/shots/` into `docs/images/guide/`
after review (see `docs/README.md` for the harness overview).
