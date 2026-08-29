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
└── shots-store.js      # WebStore assets: 5× 1280×800 screenshots + themes spare
                        # + brand marquee (1400×560) + small tile (440×280)
```

## Usage

```bash
scripts/screenshots/run.sh            # all suites
scripts/harness/rerun.sh shots.js     # a single suite ad-hoc
scripts/screenshots/update-store-assets.sh   # re-shoot shots-store + sync assets/store (release Step 1)
```

## Store assets (shots-store)

The store shows at most FIVE screenshots (global spec: 1280×800 or 640×400,
JPEG or 24-bit PNG without alpha — we standardize on 1280×800 RGB).
`shots-store.js` emits the five-keeper set plus one spare candidate and the
two promo tiles, all from live states instead of hand assembly (velvet §6.3 F):

- `store/promo.png` — 1280×800, sheet 1 (entry points): left the main popup
  with the context menu and its collapsible entry expanded in place; right
  two columns of stacked pairs — search (normal over selection, the
  selection tiles cropped below the view-tab strip) and tab-groups;
- `store/promo2.png` — 1280×800, sheet 2 (the staging workbench): left the
  command palette long shot; right columns — staging upper region (groups) +
  staging selection, staging recent region + stats;
- `store/promo3.png` — 1280×800, sheet 3 (cleanup): dead-links and
  duplicates, each normal over selection;
- `store/strip.png` — 1280×800, the four explicit themes (light/dark/ink/
  paper) as full tiles in a captioned band (was a 1400×560 band until the
  1280×800-only screenshot discipline);
- `store/options.png` — 1280×800, the whole options page in one frame: a
  wide-viewport capture with the multicol grid forced to six columns
  (`.options-page{max-width:none}` + `column-count:6`), scaled into the
  frame — a true panorama, unlike the hand-made options shot that shows only
  half the groups;
- `store/themes.png` — 1280×800 spare candidate: the two crafted themes
  split full-bleed (ink | paper);
- `store/marquee.png` — 1400×560 顶部宣传图块: brand-red gradient, icon chip
  + wordmark + tagline + feature chips, and the live tree tile as the product
  card (a deliberate top-anchored design crop, not a spec screenshot);
- `store/tile-small.png` — 440×280 小型宣传图块: same brand system, icon
  chip + wordmark + tagline centered.

Every popup tile is clipped to the live `#container` box (overlays may extend
it downward), so no tile carries the viewport's dead right margin. Plain tiles
trim trailing dead space to the measured content bottom; selection tiles start
below the view-tab strip. Popup width is pinned to 400px via the `popupWidth`
setting so overlays (palette) compose inside the frame. Composite geometry is
pre-calculated from each tile's measured PNG aspect — tiles are never
cover-cropped (the marquee product card is the single deliberate exception:
a top-anchored crop showing the popup's first screen).

Every capture is seeded and hermetic (non-extension requests are aborted), so
re-runs are deterministic. Typography: Inter + Noto Sans SC (思源黑体) are
installed by the Dockerfile from `scripts/screenshots/fonts/` (git-ignored;
run `fonts/fetch.sh` once through the proxy) and forced via an injected
stylesheet — without them the captures fall back to the base image's
bitmap-ish CJK font. The composites are synced to
`assets/store/vBookmarks-{promo,promo2,promo3,strip,options,marquee,tile-small,themes}.png`
by `update-store-assets.sh`, which then runs `normalize-store-assets.py`
(Pillow on the host) — the spec gate that flattens alpha to RGB and hard-fails
on any size mismatch (CWS requires exact sizes, 24-bit PNG without alpha or
JPEG). Store assets are excluded from the package zip (`package.py`
EXCLUDE_FILES); re-run the suite after visual changes and re-copy the keepers.
Upload happens via the Developer Dashboard (the store listing itself is not
API-managed; see `scripts/webstore/README.md` for what the `listing` commands
can and cannot do). Raw tiles are kept under `store/tiles/` for manual
re-mixing. `classic` joins the strip theme list when the velvet classic theme
lands.

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
├── store/strip.png                      # shots-store — 1280×800, 4 theme tiles + captions
├── store/promo.png                      # shots-store — 1280×800 collage
├── store/themes.png                     # shots-store — 1280×800 ink|paper split
├── store/options.png                    # shots-store — 1280×800 options panorama
├── store/marquee.png                    # shots-store — 1400×560 顶部宣传图块(品牌)
├── store/tile-small.png                 # shots-store — 440×280 小型宣传图块(品牌)
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
