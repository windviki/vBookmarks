# Visual capture (screenshots)

Pure screenshot capture for vBookmarks. `run.sh` builds the shared harness
image (`scripts/harness/Dockerfile`) and runs ONLY the visual suites into
`tmp/shots/` (git-ignored). The real-browser verify gate is separate —
`scripts/harness/run.sh`.

## Suites

```
scripts/screenshots/
├── run.sh              # build + run all suites into tmp/shots/
├── shots.js            # 11 interaction states (light + dark)
├── shots-matrix.js     # 4 themes × the full surface (21 shots/theme)
├── shots-i18n.js       # 7 UI languages × 15 surfaces, light theme
├── shots-palette.js    # palette + recent/stats/dupes/dead views
├── shots-guide.js      # guide-only states for docs/guide-v4*.md
├── shots-tabgroups.js       # tab-group menus & dialogs, SW-side verified
├── shots-tabgroups-view.js   # tab-groups view: tabs/groups, selection, group menu
└── shots-store.js      # WebStore specs: 1400×560 theme strip + 1280×800 promo
```

## Usage

```bash
scripts/screenshots/run.sh            # all suites
scripts/harness/rerun.sh shots.js     # a single suite ad-hoc
```

## Store assets (shots-store)

The store shows at most FIVE screenshots; `shots-store.js` emits a candidate
set of four (the fifth slot stays free for the existing brand marquee or a
hand-picked extra), all from live states instead of hand assembly
(velvet §6.3 F):

- `store/strip.png` — 1400×560, the four explicit themes side by side;
- `store/promo.png` — 1280×800, main popup with the bookmark context menu
  plus search/recent/stats/dead minis, aligned with the hand-made
  `assets/store/vBookmarks-v4.png` layout;
- `store/themes.png` — 1280×800, the two crafted themes split full-bleed
  (ink | paper);
- `store/options.png` — 1280×800, the whole options page in one frame: a
  wide-viewport capture with the multicol grid forced to six columns
  (`.options-page{max-width:none}` + `column-count:6`), scaled into the
  frame — a true panorama, unlike the hand-made options shot that shows only
  half the groups.

Every capture is seeded and hermetic (non-extension requests are aborted), so
re-runs are deterministic. The four composites are synced to
`assets/store/vBookmarks-{strip,promo,themes,options}.png` (excluded from the
package zip like every store asset — `package.py` EXCLUDE_FILES); re-run the
suite after visual changes and re-copy the keepers. Upload happens via the
Developer Dashboard (the store listing itself is not API-managed; see
`scripts/webstore/README.md` for what the `listing` commands can and cannot
do). Raw tiles are kept under `store/tiles/` for manual re-mixing. `classic`
joins the strip theme list when the velvet classic theme lands.

## Output layout

Shots are grouped by dimension into subdirectories under `tmp/shots/`
(git-ignored). Each suite writes only into its own directory:

```
tmp/shots/
├── themes/theme-<theme>-<surface>.png   # shots-matrix — 4 themes × 21 surfaces
├── i18n/<lang>-<surface>.png            # shots-i18n — 7 languages × 15 surfaces
├── states/NN-<name>.png                 # shots.js (01-13) + shots-palette (14-22)
├── tabgroups/NN-<name>.png              # shots-tabgroups (30-33)
├── tabgroups-view/NN-<name>.png          # shots-tabgroups-view (34-36)
├── guide/<name>.png                     # shots-guide
├── store/strip.png                      # shots-store — 1400×560, 4 theme tiles
├── store/promo.png                      # shots-store — 1280×800 collage
├── store/themes.png                     # shots-store — 1280×800 ink|paper split
├── store/options.png                    # shots-store — 1280×800 options panorama
├── store/tiles/<name>.png               # shots-store — raw capture tiles
├── smoke/                               # harness smoke.js diagnostic shots
├── verify-menu/                         # verify-menu-overflow/collapse captures
├── verify-menu-extreme/<combo>.png      # verify-menu-extreme: 1 shot per DPR×zoom×size combo
├── verify-scrollbars/<tag>-<view>.png   # verify-scrollbars: tree/dead/dupes per Phase-C combo
└── diag/                                # harness diag probes (e.g. favicon-*)
```

The `smoke/`, `verify-*/` and `diag/` subtrees are written by `scripts/harness/`
(the verify gate + on-demand diag probes) — `scripts/harness/run.sh` and
`scripts/harness/rerun.sh` copy them into `tmp/shots/` the same way
`scripts/screenshots/run.sh` does for the suites, so every capture the harness
makes is reviewable in one place.

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
  the verify gate (blocking, not screenshots) — `scripts/harness/run.sh`.
