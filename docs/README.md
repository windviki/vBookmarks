vBookmarks
==============

[English Readme](README.md) | [中文说明](README.zh.md)

[![Donate me](https://img.shields.io/badge/donate-me-orange.svg)](../donation/donation.md) | [![捐赠](https://img.shields.io/badge/捐赠-支持-orange.svg)](../donation/donation.zh.md)

![Image of vBookmarks](../assets/store/vbookmarks.png)

[Available on WebStore](https://chrome.google.com/webstore/detail/vbookmarks/odhjcodnoebmndcihdedenkmdmklpihb) · [HomePage](http://windviki.github.com/vBookmarks/)

**vBookmarks turns your bookmark pile into a fast, keyboard-first workspace.** One click on the toolbar icon opens a six-view manager that lives in the popup (or Chrome's side panel — your choice): the familiar folder tree, instant fuzzy search, a Recently Added timeline, visit statistics, a dead-link scanner, and a duplicate cleaner. Everything is reachable from the keyboard, every delete is undoable, and nothing ever leaves your browser — no accounts, no telemetry, no build-step black box, just plain JavaScript you can read.

- **Six views, one popup** — Tree / Search / Recent / Stats / Dead links / Duplicates, switched from an icon tab strip or with `Alt+1…6`.
- **A maintenance crew for your library** — scan for dead links with pause & resume, deduplicate with six keep-strategies and undoable batch cleaning, save a whole window of tabs as a session folder.
- **Keyboard-first for real** — every view is fully operable without a mouse: arrows, `Enter`, `F2` rename, `Delete`, view shortcuts, and a `Ctrl/Cmd+K` command palette.
- **Fast and quiet** — fzf-style fuzzy search with match highlighting (CJK-friendly), omnibox search (`*` + Space), and sync-status indicators that stay out of your way.
- **Make it yours** — five crafted themes, custom CSS, custom toolbar icon, per-view visibility toggles — or hide the tab strip entirely for the classic one-pane look.
- **Private by design** — local-only data, 43 languages, MIT licensed.
- **Chrome and Edge** — one MV3 package installs on both (`scripts/package.py --target chrome|edge`; Firefox would need a build step — evaluation in [browser-compat.md](browser-compat.md)).

Licensed under the [MIT License](http://www.opensource.org/licenses/mit-license.php). Read the [FAQ](https://github.com/windviki/vBookmarks/wiki/FAQ). New in 4.0? Read the [v4 feature guide](guide-v4.md).


# Why vBookmarks

- **Modern, calm UI** — a full design-token system with five looks: follow-system, light, dark, plus two crafted "fable" themes: **Ink** (deep dark) and **Paper** (warm light).
- **Find anything instantly** — fzf-style fuzzy search with match highlighting (CJK-friendly), persistent search history, and a **command palette** (`Ctrl/Cmd+K`) unifying bookmark search, folder jumps, view jumps and power commands.
- **Power tools built in** — a dead-link scanner with dual-channel checks and pause/resume, a duplicate cleaner with six keeper strategies and undo-safe batch deletion, a session saver, and one-click undo for every delete.
- **Quick add everywhere** — star button in the popup, `Ctrl/Cmd+D`, the global `Alt+Shift+S` shortcut, or "Bookmark this page" from the page context menu.
- **Sync-aware** — on Chrome 138+ it understands Chrome's dual local/synced bookmark storage: local-only subtrees are gently dimmed, roots are labeled `(Local)` / `(Synced)`, and cross-storage drags are blocked with a polite toast instead of a hard failure.
- **43 languages**, all aligned to the English baseline and kept in sync by an LLM-assisted translation pipeline.
- **Private by design** — plain ES6+ JavaScript, no framework, no build step, no telemetry; the source you inspect is the code you run. Visit statistics are stored locally, can be paused with one switch and erased with one button.


# What's new in 4.0

4.0 is the largest release in the project's history. It rebuilds the popup around a **view system** — six specialized views behind an icon tab strip — while keeping the classic tree experience one setting away.

## The view system

- **Six views**: **Tree** (the classic), **Search**, **Recent**, **Stats**, **Dead links**, **Duplicates**. The icon tab strip shows live count badges (dead marks, dupe groups, tracked pages) and can be hidden per view (Stats/Dead/Duplicates) or entirely for the classic single-pane layout.
- **One keyboard model everywhere** — the tree's mature semantics (arrows, `Home`/`End`, `PageUp`/`PageDown`, `Enter`, `F2`, `Delete`, type-ahead) now work identically in every list view; `↑` past the first row steps up to the tab strip, then the search box; the strip itself is arrow/Home/End navigable with roving tabindex and RTL awareness; `Alt+1…6` jumps straight to a view (portable across Chrome and Edge, which reserves `Ctrl+1…8` for its own tabs).
- **Layered `Esc`** — context menu → command palette → view-level action (e.g. pausing a scan) → clear search → back to tree → close, always peeling one layer at a time.
- **Popup vs panel** — both reopen on the view you left (the popup via the default-on *remember the last view* switch — turn it off for the classic always-tree boot), and the side panel is ready to become your always-on bookmark workspace.

## Search view — dual zone

- The popup search is now a proper view: **history on top, results below**. Both stay on screen together.
- **Search history** (MRU 10) records what you actually used — pressing `Enter`, opening a result, or leaving the view — with result counts and relative timestamps. Click or press `Enter` to re-run, `Delete` or right-click to remove one or clear all. A setting turns history off (and wipes it) instantly.
- Leaving and coming back keeps everything: the box, the results, the scroll — no reflow, no re-query.

## Recent view

- The old in-tree "recently added" strip grew up into its own tab: your newest bookmarks grouped into **Today / This week / This month / Older**, each row with a relative-time badge and a `path · exact time` second line.
- `R` (or right-click) reveals any row in the tree; an optional one-time import from Chrome history (off by default, permission requested only if you opt in) back-fills older visits.

## Stats view — your actual usage

- **Visit statistics, 100% local**: rows you open from the popup are counted, and a background collector notices when you navigate to bookmarked URLs from anywhere else (deduplicated, so one open never counts twice).
- Sort by **count** or **recency** (persisted), clear everything with one ConfirmDialog-gated button, or flip `statsEnabled` off — recording stops completely, and the erase exit stays reachable.
- A **Recently visited** section lists what Chrome says you actually visit; bookmarked rows show a ★, everything else has a one-click ☆ to file it away.

## Dead-link view

- **Dual-channel checking**: a direct fetch first; on failure, a second channel gets the final say — so "down for everyone" and "just blocked here" read as different badges. The second channel is your **own proxy server** (http/https/socks5) added in one click from the strip above the list (reachability-tested before it is saved), or a legacy relay URL template from the options page.
- **Proxy mechanics, honestly scoped**: checks through your proxy are routed by a temporary PAC script that matches only the scanner's own marker-tagged probe URLs — every other tab's traffic stays on its normal path, and the settings are restored the moment a scan settles, cancels or the popup closes. The `proxy` permission is declared at install time (Chrome does not allow it as an optional permission); it sits **completely unused** if you never configure a proxy server or never run a scan — no proxy code path executes otherwise.
- **Progressive, pausable scans that outlive the popup**: the scan runs in the service worker, so closing the popup or side panel mid-scan loses nothing — reopen to a live mirror, and an interrupted run even resumes itself. Results stream in row by row; `Esc` pauses/resumes without losing progress; canceling restores the last completed snapshot. Progress ticks repaint silently, never moving your scroll position.
- **A risk banner before the first cleanup** (dead links and dedup both rewrite bookmarks in bulk) links to Chrome's own backup & restore guide; *Don't show again* snoozes it until the next major version.
- Tunable concurrency (1–16) and timeout (2–30 s), a dead/blocked/all filter with a dead·blocked summary line, and **dead marks** — flag a link once and the red ✕ follows it across the tree, search, recent and stats views.

## Duplicates view

- Finds real duplicates, not just string matches: URLs are normalized (tracking parameters like `utm_*`/`fbclid`/`gclid` stripped, hash dropped, optional http/https folding) before grouping.
- **Six keeper strategies** — oldest, newest, bookmark-bar, shortest title, shallowest, most-visited (live data from the Stats view) — plus per-group manual pinning with `K` or the radio button.
- **Preview first, execute after**: doomed rows render struck-through until you commit; batch cleaning runs through the undo chain with a single summary toast, and the last result set is snapshotted so reopening the popup paints instantly while it re-validates in the background.

## Command palette, upgraded

- `Ctrl/Cmd+K` in the popup, `Ctrl/Cmd+Shift+K` anywhere: fuzzy bookmark search, folder jumps, and a curated slash-command table — one **Go** command per view, `/add` `/new` `/folder`, `/session`, `/theme <name>` (or the direct switches `/dark` `/light` `/ink` `/paper`), `/tabs` and `/options`, each with a short alias or two.
- **Custom slash commands**: open a URL, fill a URL template from the rest words (`/g kimi code`), open a bookmark folder as a tab group, or jump to a view with a preset — managed in the options page's *Commands* group, saved straight from the palette's *Save as a command* row, synced across devices, and editable/deletable from the row's `→` menu.
- A plain query that isn't a command offers a bridge row to run it in the full search view; the palette closes itself when it loses focus.

## Settings, backup & the classic look

- The options page grew a **Views** group — tab-strip and per-view visibility, count badges, the remember-last-view switch, the palette/quick-add/tool-button chrome toggles, and a one-click *Restore the classic header* button — plus a **Dead scan** group (proxy template, concurrency, timeout).
- **Backup & restore**: export every setting to a stamped JSON file, import it back with merge semantics — moving machines no longer means re-clicking forty toggles.
- Options and advanced options are now **one merged page** with a responsive multi-column card layout that stays readable from 320 px to 4K (the old advanced-options URL redirects).
- **Classic-mode friendly**: one click on *Restore the classic header* — or a hand-picked set of toggles — and 4.0 behaves like the vBookmarks you know; every new surface is opt-out.

## The v4 foundation

- Search field fixed and modernized: click-through dead zone removed, a proper clear button that always appears when text is present.
- Adding a bookmark/folder/separator into a collapsed folder now works visibly: the folder expands and shows the new node immediately.
- "Copy title and URL" moved to the async Clipboard API (`clipboardWrite` permission) — it works again.
- Sync presentation reworked: synced rows stay quiet (no green-dot noise), tooltips localized, dual-storage roots labeled `(Local)`/`(Synced)`, blocked drags show a toast, and "highlight unsynced" finally dims local-only subtrees.
- Inline SVG icons throughout (folders, bookmarklets, twisties, view tabs); bitmap icons retired.

## Engineering

- **1629 unit tests** across 50 Vitest suites, covering every module — including contract tests that pin the row-alignment geometry, the z-index layering table, per-theme badge contrast and the horizontal-scrollbar protection contract (every scrollable pane clips `overflow-x`, text slots ellipsis, fixed slots `flex: none`, zoom rules never alter geometry).
- **Docker harness**: zero-console-error smoke, a real-browser keyboard/view verification suite (tab-strip keyboard model, focus zones, header-row arrow chain, per-view ↑↓/past-top crossings with the in-list toolbar rungs — the dead view stacks two, custom palette commands end-to-end, banner keyboard reachability, search dual-zone, per-view rendering — 115 hard assertions), a scrollbar matrix probe (screen resolution × browser zoom × in-extension zoom × popup size sweep, no horizontal scrollbar on any pane — 695 assertions), and screenshot suites across 5 themes and 8 UI languages (with an RTL mirroring check).
- Unified locale tooling (`scripts/i18n.py`): audit, missing-key reports, LLM batch translation, verify gate. Baseline grew from 75 to **345 keys** at 4.0 (**379** as of 4.0.1), all 43 locales aligned.
- **CI**: GitHub Actions runs the unit suites, the i18n gates and the release packaging on every push and PR.
- Repository organized for the v4 era: `src/`, `pages/`, `css/`, `assets/`, `scripts/`; obsolete artifacts (old `release/*.crx`, MV2 leftovers) live on in git history.


# Feature highlights

1. Six views in one popup: tree, search, recent, stats, dead-link scan, duplicate cleaner.
2. Bookmark current tab before/after a selected bookmark or folder, or to the top/bottom of a folder.
3. Add sub-folders, update a bookmark's URL with the current tab, copy title + URL to the clipboard.
4. Search history with re-run, per-item remove and clear-all — can be disabled (and wiped) in settings.
5. Visit statistics with a pause switch, one-click erase, and a recently-visited section powered by optional Chrome-history access.
6. Folder content sorting: by title or date, folders-first option, optional recursion.
7. Synchronizable bookmark separators with customizable style.
8. Dark theme done right: light / dark / follow-system / ink / paper on shared design tokens.
9. Optional side-panel mode (opt-in setting; popup stays the default), with an `Alt+Shift+B` shortcut.
10. Command palette (`Ctrl/Cmd+K`, or `Ctrl/Cmd+Shift+K` globally) and omnibox search: type `*` + Space in the address bar.
11. Full keyboard support in every view, and drag & drop rearranging in the tree.
12. Sync-status awareness with quiet visuals: only local-only and unsyncable rows are marked.


![Image of vBookmarks features](../assets/store/vbookmarks-menu.png)


# Notes for advanced features

1. **Omnibox search** — type `*` in the address bar, press Space, then enter your keywords.
2. **Full keyboard support**, identical across all six views (details in the [v4 feature guide](guide-v4.md)):
   - **↑↓** move selection; **↑** past the first row steps up to the tab strip, then the search box
   - **←→** on the tab strip switch views; **→** on a row opens its context menu, **←** closes it
   - **Enter** / **Space** to open; **Ctrl/Cmd+Enter** to open in a new tab
   - **Home** / **End**, **PageUp** / **PageDown**; **Alt+1…6** jump to a view directly (`Ctrl/Cmd+1…6` is the legacy twin where the browser allows it)
   - **Delete** to delete (undoable), **F2** to rename, **R** to reveal in tree; **K** pins a keeper in Duplicates, **M** toggles a dead mark
   - Type-ahead filtering in the tree and search views: start typing to find items by name
3. Middle-click a folder to open all its bookmarks (as a color-coded tab group).
4. `Ctrl+F` focuses the search field; `Esc` clears the search, dismisses the context menu, pauses a scan, or closes the palette — layered from inner to outer.
5. **Command palette** (`Ctrl/Cmd+K` inside the popup, `Ctrl/Cmd+Shift+K` globally):
   - Fuzzy-search bookmarks and folders, jump to a folder in the tree, or run slash-commands
   - Slash-commands: `/recent` `/stats` `/dead` `/dupes` jump to views, `/session` saves the window's tabs, `/options` opens settings, `/theme <name>` switches themes, `/tabs` toggles the strip — plus your own **custom commands** (options page → *Commands* group, or the palette's *Save as a command* row)
6. Drag & drop to rearrange; dragging across synced/local storage is safely blocked with an explanation.
7. Decide whether the popup closes after opening a bookmark (option in settings).
8. Show only the Bookmark Bar (option in settings).
9. Open bookmarks in background tabs (option in settings).
10. Control the popup zoom level in settings.
11. **Options page**: the *Separators* group customizes separator title/URL/style; the *Dead scan* group tunes scan concurrency/timeout.
12. **Options page**: custom CSS for the whole popup (CodeMirror editor, *Custom Styles* group), e.g. `* { font-family: Consolas; }`.
13. **Options page**: replace the toolbar icon with your own (*Custom Icon* group).
14. Disable popup auto-resize to keep a fixed height.
15. Export/import all settings as JSON from the Backup group at the bottom of the options page.


# For developers

No build step — **Load unpacked** the repo root in `chrome://extensions/`.

```bash
# Unit tests (Vitest, 1629 cases across 50 suites)
npm install
npm run test:run

# Headless harness (Docker; shots land in tmp/shots/)
scripts/screenshots/run.sh                # smoke + keyboard + scrollbar checks + all suites
scripts/screenshots/run.sh --smoke-only   # zero-console-error + keyboard + scrollbar checks
#   smoke.js               popup/panel/options raise zero console errors
#   verify-keyboard.js     tab-strip keyboard model, focus zones, view rendering
#   verify-scrollbars.js   screen×browser-zoom×in-extension-zoom sweep: no horizontal scrollbar
#   suites/shots.js         interaction states (light/dark)
#   suites/shots-themes.js  view rows on all 5 themes
#   suites/shots-i18n.js    tree/tabs/menus/dialog/options × 8 UI languages
#   suites/shots-palette.js palette + the four feature views
#   suites/shots-guide.js   guide screenshots (search dual zone, options Views group)
#   suites/shots-tabgroups.js tab-group menus & dialogs, verified from the service worker
#   diag/                manual probes, run on demand inside the image

# Locale pipeline (scripts/i18n.py, stdlib only)
python3 scripts/i18n.py audit      # keys used in code vs en baseline
python3 scripts/i18n.py missing    # per-locale missing / [TODO] report
python3 scripts/i18n.py translate --apply   # LLM batch translation
python3 scripts/i18n.py verify     # gate: alignment, TODOs, menu lengths
# translate reads the LLM endpoint from a git-ignored repo-root .env:
#   VBM_LLM_API_KEY=...  VBM_LLM_BASE_URL=...  VBM_LLM_MODEL=...
#   VBM_LLM_API_TYPE=openai|anthropic_messages

# Release zip (version read from manifest.json)
python3 scripts/package.py         # → tmp/vBookmarks_<version>.zip
```

`tmp/` and `.env` are git-ignored. When adding runtime files, keep the include list in `scripts/package.py` in sync; see `AGENTS.md` for the full contributor guide.


# Technical details

- Powered by plain ES6+ JavaScript (no framework, no bundler); [CodeMirror](http://codemirror.net/) backs the Custom CSS editor.
- Successor of [Neat Bookmarks](https://github.com/cheeaun/neat-bookmarks) — thanks to [cheeaun](https://github.com/cheeaun) for the original work.
- Old pre-4.0 releases (`release/*.crx`) were removed from the working tree and remain available in git history.


# Changelogs

**ver4.0.1 2026/08**

**New**

- **Tab groups for folders & bookmarks**: "open all as a tab group" now creates/joins the group **in the service worker**, so closing the popup mid-flight no longer aborts it. The folder/bookmark context menus add **…and set name/color** (a new-group dialog with a title and nine Chrome-style color swatches) and **open into an existing group** (a picker of your current tab groups); old Chrome or a vanished group falls back to a plain open.
- **Dead-link batch delete**: the toolbar's red **Delete all** removes every row in the current filter (All / Dead / Blocked; the confirm shows the exact count); selection mode gains **Delete selected** — both run serially through the undo chain and end in one summary toast.
- **Folder sorting** ([#33](https://github.com/windviki/vBookmarks/issues/33)): the folder menu offers **Sort by name** / **Sort by date added** as direct commands (recursive folders append "(recursive)") beside **Sort options…**; a new options-page **Sorting** group edits the same persisted `sortOptions` (by / folders-first / recursive). Sorting physically reorders the bookmarks (survives restarts), and every sort — recursive ones included — is undoable via toast (Undo replays the pre-sort snapshot level by level).
- **Palette theme shortcuts** ([#44](https://github.com/windviki/vBookmarks/issues/44)): next to `/theme <name>`, the direct switches `/dark` `/light` `/ink` `/paper` apply a theme in one keystroke — the exact slash match now always wins the Enter row.
- **Page context-menu quick-add switch** ([#49](https://github.com/windviki/vBookmarks/issues/49)): the "Bookmark this page" entry is now an independent **Views** toggle (`quickAddContextMenu`) — off removes it from every page on the fly, and the *Restore the classic header* preset covers it too.
- **Stats view merges recent visits into one list**: bookmarked history rows merge into the main list wearing a solid ★ and their visit count in the pill; a toolbar **Show unbookmarked** checkbox (`statsShowUnbookmarked`) brings in the rest (one-click ☆ files them). The row end reads right-to-left: star → count pill → time.
- **Shared dropdown component**: the Duplicates strategy/scope selects become a custom dropdown with one keyboard protocol (`↓`/`Enter`/`Space` open, `Home`/`End` jump to the first/last option, `←`/`Esc` cancel, `Tab` applies) — the browser's native select no longer hijacks the arrows.

**Fixed**

- [#46](https://github.com/windviki/vBookmarks/issues/46): clicking a folder in search results opened the popup's own URL in a new tab — folder rows now jump in place (multi-class matching).
- [#47](https://github.com/windviki/vBookmarks/issues/47): the Stats "recent" time badge was crushed into a tiny pill — now plain muted text aligned with the path column.
- "Open all as a tab group" could silently do nothing when the popup closed mid-creation (its tab callbacks were dropped).
- Dead-link tab badge missing on cold start, and intermittently when opening the popup straight into the dead view — now pre-loaded and refreshed after the async read.
- Clicking a ghosted/stale row (a folder deleted or synced away mid-redraw) no longer crashes.
- A context-menu click on a re-rendered row (search-history remove / stats star) no longer throws.
- Popup height could lock to 300 px while the tree was hidden — invisible trees are no longer measured.
- Closing the side panel via the toolbar toggle could leave the popup unreachable — restored instantly (Chrome 142+) or via an alarm probe (114–141).
- `Ctrl/Alt+1-9` stopped working after `Ctrl+2` parked focus in the search box — ordinary inputs no longer swallow view switches (only modal dialogs and the open palette do).
- `Ctrl+digit` view switches could strand focus in the old view — focus now lands on the new view and the arrows work immediately.
- In the palette, closing a context menu with `←`/`Esc` stranded focus on a result row — it returns to the input.
- "Reveal in tree" (`R`) left no keyboard focus — the revealed row now receives it.
- New-tab-group dialog input misaligned with the color row — now the same width.
- The packaged zip could silently miss new modules — the packaging script now resolves imports recursively.
- Stats view overflowed horizontally at narrow widths — the path column now wraps instead of stretching.
- A clean dead-link scan (zero dead rows) left no way to scan again from the view — the **Rescan** button now stays on the toolbar.
- [#50](https://github.com/windviki/vBookmarks/issues/50): middle-clicking a bookmark closed the popup even with "stay open" off — background opens no longer force-close the popup (only foreground opens honor the setting), matching the folder open-all behavior.
- [#51](https://github.com/windviki/vBookmarks/issues/51): a manually shrunken popup height kept "resetting" (auto-height re-grew it on the next tree click, so the popup could only ever grow) — once you drag the popup edge, auto-height steps back for the rest of the session.
- [#52](https://github.com/windviki/vBookmarks/issues/52): the custom toolbar icon did not survive a browser restart (`chrome.action.setIcon` is session-scoped) — the service worker now restores it on every cold start.

**Polish**

- One 16 px line-art SVG icon set: solid/hollow star (stats), flag + trash (dead marks/deletes), check (dupes apply); danger actions stay red.
- Dialogs: content width-capped and centered with a soft slide-in; the new-tab-group dialog gained breathing room and Chrome-style selected-color states.
- Dead-link toolbar reordered: scan time → filter segment **with counts** (All 2 · Dead 1 · Blocked 1) → rescan / mark-all / unmark-all / delete-all / select.
- Row metadata aligned across all list views: time column left, path column right.
- Root-folder menus disable the actions Chrome refuses (delete, rename, add before/after, separator) instead of erroring.

**Changed**

- Version handling refactored into `src/version.js` (full `major.minor.patch` comparison, threshold "crossed into" checks); the release is **4.0.1 — a silent patch**, so existing 4.0 users don't get a "new version" card.
- Keyboard model hardening: menu walking skips disabled *and* CSS-hidden items; a new focus-regression suite gates cross-view focus hand-offs.
- **Dead-link proxy consolidation**: the legacy relay URL template (`deadProxyTemplate`) is retired — values stored by older versions are cleaned out of storage automatically on upgrade. The options page's *Dead scan* group now manages your proxy server in place (add / test / save / clear; saving runs parse → permission → control → reachability probe and rejects unreachable servers), and the view's add-a-proxy hint strip can be dismissed with × and brought back from the *Dead scan* group's checkbox (`hideDeadProxyStrip`).

**ver4.0 2026/07**

New: six-view manager (Tree / Search / Recent / Stats / Dead links / Duplicates) with an icon tab strip, live count badges, per-view visibility toggles and `Alt+1…6` jumps. Search view with dual-zone layout and re-runnable search history. Recent view with coarse time groups and reveal-in-tree. Local visit statistics with a background collector, recently-visited section and one-click starring. Dead-link scanner with dual-channel checks, progressive rendering, pause/resume/cancel and cross-view dead marks — running **in the service worker**, so closing the popup mid-scan loses nothing — and its second channel now also supports **your own proxy server** (http/https/socks5): a one-click add button in the view's proxy strip validates the address and probes reachability (unreachable servers are rejected) before saving, change/remove live on the same strip and the options page shows/clears the saved server; routing uses a marker-matched temporary PAC, so only the scanner's own probe URLs go through the proxy (other tabs untouched, settings restored on settle/cancel/popup close, crash residue swept by the service worker); the toolbar adds a dead·blocked summary line and a configure-a-proxy nudge when direct-failing rows have no proxy. Duplicate cleaner with URL normalization, six keeper strategies, will-delete preview and undoable batch deletion. Both bulk tools show a one-time backup-first risk banner. Command palette upgrades: Go commands per view, `/theme <name>`, `/session`, `/options`, aliases, custom slash commands (URL/template/folder-group/view-preset, synced), search bridge row, auto-close on blur. Options: Views group, custom-commands group, settings backup/restore, responsive card layout. Ink & Paper "fable" themes; quick-add star button; sync status presentation rework (quiet dots, localized tooltips, `(Local)`/`(Synced)` root labels, blocked-drag toast, working "highlight unsynced" dimming).

Polish: selection modes in Dead links (batch mark/unmark) and Duplicates (batch group cleaning) with `Esc` to exit; `Tab`/`Shift+Tab` region cycling including in-list toolbars, with per-region focus memory; duplicates member-row keys (`Enter` opens a copy, `←` returns to the group head) and group-head menus; remember-last-view restore (default on) and count-badge, palette, quick-add and tool-button switches, plus a one-click *Restore the classic header* button; options and advanced options merged into a single page (old URL redirects); global quick-add shortcut (`Alt+Shift+S`); ARIA roles on all context menus, `aria-modal` dialogs with a focus trap; lazy favicons; GitHub Actions CI.

Fixed: search field click-through and unreliable native clear button; adding into collapsed folders is immediately visible; copy title/URL via the async Clipboard API (`clipboardWrite` permission added); non-empty folder deletion is confirm-gated again (with undo).

Changed: repository reorganized (`src/`, `pages/`, `css/`, `assets/`, `scripts/`); obsolete `release/` and MV2 leftovers removed (kept in git history); all icons are inline SVG now; locale baseline grew to 306 keys with all 43 locales re-aligned through the `scripts/i18n.py` LLM pipeline; test suite grew to 1303 cases across 40 suites; Docker harness extended with a keyboard/view verification suite and multi-theme, multi-language screenshot captures; the `proxy` permission is declared at install time (Chrome refuses it as an optional permission) and is exercised only while a configured proxy serves a running scan or the add-flow reachability probe — never when no proxy server is set or dead-link scanning is unused.


**ver3.7 2026/05/10**

New: [#36](https://github.com/windviki/vBookmarks/issues/36): Add auto-resize popup toggle option. Enable/disable automatic popup height adjustment in General settings.

Fixed: [#42](https://github.com/windviki/vBookmarks/issues/42): Extension broken in Chrome 148 due to deprecated `<command>` HTML element. Replaced with `<div>` elements for full compatibility.

New: Full 42-language support synced from cc-dev branch, all aligned with English baseline (75 keys). Languages: ar, bg, bn, cs, da, de, el, en, es, et, fa, fi, fr, he, hi, hr, hu, id, it, ja, ko, lt, lv, mk, nl, no, pl, pt, pt_BR, pt_PT, ro, ru, sk, sl, sv, th, tr, uk, vi, zh, zh_HK, zh_TW.


**ver3.6 2024/01/08**

Fixed: [#31](https://github.com/windviki/vBookmarks/issues/31): Custom icon not working.


**ver3.5 2023/09/04**

Fixed: [#29](https://github.com/windviki/vBookmarks/issues/29): cursor focus doesn't stay in search bar after clearing the search text.

Fix shortcut in manifest. Now the default shortcut is Ctrl+Shift+V (Ctrl+Shift+B cannot work in new Chrome.)


**ver3.4 2023/02/14**

Fixed: [#26](https://github.com/windviki/vBookmarks/issues/26): open directory in the background.

New: Key Right to open context menu (when focus on an opened dir or a bookmark) and key Left to close it (when context menu is showing).

Remove timeout of height reset. Speed up the popup.


**ver3.3 2023/02/02**

Fixed: [#23](https://github.com/windviki/vBookmarks/issues/23): Incorrect link on the options page.

Fixed: [#26](https://github.com/windviki/vBookmarks/issues/26): Middle/Ctrl click no longer opens bookmarks in the background in Chrome 107.

New: [#24](https://github.com/windviki/vBookmarks/issues/24): Add new option to disable incremental search (use ENTER to search).

Fixed: The stupid double scroll bar (finally).

Fixed: Focus lost when quit from search mode.

Fixed: Arrow down triggers an error in search mode.

Fix some undefined errors.

Update code to manifest V3. minimum_chrome_version = 88.


**ver3.2 2020/09/12**

Fixed: [#19](https://github.com/windviki/vBookmarks/issues/19): "Add to the end of folder" feature does not work bugs.

New: [#15](https://github.com/windviki/vBookmarks/issues/15): Search for folders in bookmark search bar.

New: Resize the height of popup.

Added: Italy language.

Added: Russian language. Thanks for @Stanislav .

Fix some undefined errors.

Update code to ecmascript version 6. minimum_chrome_version = 61.



**ver3.1 2020/07/03**

Fixed: [#12](https://github.com/windviki/vBookmarks/issues/12): Focus lost when clear the menu.

Fixed: [#18](https://github.com/windviki/vBookmarks/issues/18): Tree does not scroll when drag to top or bottom.

Fix an undefined error when pressing key DOWN.

Fix the support of bookmarklet. Thanks for @ZG-nico.

Added: France language. Thanks for @Fab-fr.

Added: Chinese Hong Kong language.


**ver3.0 2019/08/22**

Fixed: New icons.


**ver2.9 2019/08/22**

Fixed: Double scrollbar since Chrome version 77+.


**ver2.8 2019/05/06**

Fixed: Open URL twice when clicked by middle button of mouse. https://github.com/windviki/vBookmarks/issues/9

Fixed: Sometimes search will fail. https://github.com/windviki/vBookmarks/issues/7

Fixed: Context menu position.

Improved: Scrollbar CSS style.

Added: Placeholder "\_\_VBM_CURRENT_TAB_URL\_\_" in bookmark URL to make some bookmarklets work (Chrome does not allow _document.location.href_ in BMlet). It will be replaced with URL of current active tab when you click BMlet from vBookmarks.


**ver2.6 2013/10/21**

Fixed: Remove double scroll bars.


**ver2.5 2013/08/30**

Fixed: Remove HTML notifications because it is not available now. https://bugs.webkit.org/show_bug.cgi?id=98388.


**ver2.4 2013/08/29**

Fixed: "Unexpected end of input" in js.


**ver2.3 2013/04/09**

Fixed: Context menu will be dismissed when scrolling up/down (broken again in previous version).

Fixed: Remember position of scroll bar (broken again in previous version).


**ver2.2 2013/04/02**

Fixed: Scroll bar does not work above chrome 26+ (not well tested).


**ver2.1 2012/12/12**

Fixed: Now it can remember and restore position of scroll bar correctly.

Improved: Position of context menu. And context menu will be dismissed when scrolling up/down.

Added: Cancel button for dialogs in vbookmarks.


**ver2.0 2012/11/01**

Fixed: Version checking in background.js.

Improved: Synchronizable separators.

Added: Advanced options for separator.


- "The real title of bookmark which is shown as a separator": By default it is "|". That means the separators you added in vbookmarks will be shown as a normal bookmark in Chrome bookmark manager or bookmark menu, with this title value. You can modify it to "------------" so that you can split your bookmarks horizontally even if you check your bookmarks in Chrome bookmark menu.


- "The real URL of bookmark which is shown as a separator": By default it is "http://separatethis.com/". It's a "online separator". The separators you added in vbookmarks will be shown as a normal bookmark in Chrome bookmark manager or bookmark menu, with this URL value.


- "If URL of a bookmark contains this string, it will be shown as a separator": If you set this value (you can set several URLs joined by ";"), all bookmarks whose URL contains any of them will be shown as real separators in vbookmarks. e.g. if you set it to google.com, all google services in your bookmarks will be shown as separators.


**ver1.9 2012/08/19**

Fixed: Neatbookmarks bug: Scrollbar will be reset to the top when opening and scrolling the popup down.

Updated: Color of ICON.

Updated: Style of separator.


**ver1.8 2012/08/01**

Added: Separators for bookmarks/folders. But it is a local record and cannot be synchronized between different devices. see https://github.com/windviki/vBookmarks/issues/3

Fixed: Neatbookmarks bug: Wrong position of dragged bookmark when vertical scrollbar is scrolled down (since Chrome18).

Added: Color of icon is changed to red.

Added: Simple update checking and desktop notification.

Removed: Several languages. Only 4 locales are left: en, ja, zh, zh_TW. Cannot maintain many translations any more.


**ver1.7 2012/06/26**

Fixed: Double scrollbars in Chrome 19. Sorry for the previous untest release. I do not have many different Chromes in different versions :)

Fixed: Width resetting occured when expanding root folder. https://github.com/windviki/vBookmarks/issues/2


**ver1.6 2012/06/24**

Fixed: Cannot search bookmarks in Omnibox (*+space). [Content Security Policy]

Fixed: Restore width of the popup window. [Content Security Policy]

Fixed: Dialogs cannot submit their forms. [Content Security Policy]


**ver1.5 2012/06/21**

Fixed: manifest problem in Chrome 20+.

Fixed: separated script file instead of inline scripts. see Content Security Policy http://code.google.com/chrome/extensions/contentSecurityPolicy.html


**ver1.4 2012/06/20**

Fixed: Scrollbar problem in Chrome 18,19. https://github.com/windviki/vBookmarks/issues/2


**ver1.3 2012/05/25**

Fixed: Scrollbar glitch in Chrome 18,19. https://github.com/windviki/vBookmarks/issues/1


**ver1.2 2011/11/30**

Added: update selected bookmark with current URL.

Added: copy title and URL of selected bookmark to clipboard.

Fixed: after adding new bookmark or folder to a closed folder, its original children cannot be shown correctly.

Fixed: make up some missing translations for cs(Czech).


**ver1.1 2011/11/16**

Added: option for only displaying bookmarks in Bookmark Bar.

Added: context menu for adding folder before/after bookmark/folder.

Fixed: some translations in multi-language support.


**ver1.0 2011/11/15**

First version.


# Attentions

Installing from source ("Load unpacked") or the Web Store build is recommended. Legacy crx sideloading notes: above Chrome 20+, drag the crx file to `chrome://chrome/extensions/`; above Chrome 22+, add `--enable-easy-off-store-extension-install` to accept extensions from outside the Web Store (see [details](http://www.howtogeek.com/120743/how-to-install-extensions-from-outside-the-chrome-web-store/)).

Available on [WebStore](https://chrome.google.com/webstore/detail/vbookmarks/odhjcodnoebmndcihdedenkmdmklpihb) — the recommended way to use this extension.
