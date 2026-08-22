vBookmarks
==============

[English Readme](README.md) | [中文说明](README.zh.md)

[![Donate me](https://img.shields.io/badge/donate-me-orange.svg)](../donation/donation.md) | [![捐赠](https://img.shields.io/badge/捐赠-支持-orange.svg)](../donation/donation.zh.md)

![Image of vBookmarks](../assets/store/vbookmarks.png)

[Available on WebStore](https://chrome.google.com/webstore/detail/vbookmarks/odhjcodnoebmndcihdedenkmdmklpihb) · [HomePage](http://windviki.github.com/vBookmarks/)

**vBookmarks turns your bookmark pile into a fast, keyboard-first workspace.** One click on the toolbar icon opens a seven-view manager that lives in the popup (or Chrome's side panel — your choice): the familiar folder tree, instant fuzzy search, a tab-groups view, a Recently Added timeline, visit statistics, a dead-link scanner, and a duplicate cleaner. Everything is reachable from the keyboard, every delete is undoable, and nothing ever leaves your browser — no accounts, no telemetry, no build-step black box, just plain JavaScript you can read.

- **Seven views, one popup** — Tree / Search / Tab groups / Recent / Stats / Dead links / Duplicates, switched from an icon tab strip or with `Alt+1…7`.
- **A maintenance crew for your library** — scan for dead links with pause & resume, deduplicate with six keep-strategies and undoable batch cleaning, save a whole window of tabs as a session folder.
- **Keyboard-first for real** — every view is fully operable without a mouse: arrows, `Enter`, `F2` rename, `Delete`, view shortcuts, and a `Ctrl/Cmd+K` command palette.
- **Fast and quiet** — fzf-style fuzzy search with match highlighting (CJK-friendly), omnibox search (`*` + Space), and sync-status indicators that stay out of your way.
- **Make it yours** — five crafted themes, custom CSS, custom toolbar icon, per-view visibility toggles — or hide the tab strip entirely for the classic one-pane look.
- **Private by design** — local-only data, 43 languages, MIT licensed.
- **Chrome and Edge** — one MV3 package installs on both (`npm run package` builds `dist/` and produces the store zip; `python3 scripts/package.py --target edge` for a direct source zip; Firefox would need a build step — evaluation in [browser-compat.md](browser-compat.md)).

Licensed under the [MIT License](http://www.opensource.org/licenses/mit-license.php). Read the [FAQ](https://github.com/windviki/vBookmarks/wiki/FAQ). New in 4.0? Read the [v4 feature guide](guide-v4.md).


# Why vBookmarks

- **Modern, calm UI** — a full design-token system with five looks: follow-system, light, dark, plus two crafted "fable" themes: **Ink** (deep dark) and **Paper** (warm light).
- **Find anything instantly** — fzf-style fuzzy search with match highlighting (CJK-friendly), persistent search history, and a **command palette** (`Ctrl/Cmd+K`) unifying bookmark search, folder jumps, view jumps and power commands.
- **Power tools built in** — a dead-link scanner with dual-channel checks and pause/resume, a duplicate cleaner with six keeper strategies and undo-safe batch deletion, a session saver, and one-click undo for every delete.
- **Quick add everywhere** — star button in the popup, `Ctrl/Cmd+D`, the global `Alt+Shift+S` shortcut, or "Bookmark this page" from the page context menu.
- **Sync-aware** — on Chrome 138+ it understands Chrome's dual local/synced bookmark storage: local-only subtrees are gently dimmed, roots are labeled `(Local)` / `(Synced)`, and cross-storage drags are blocked with a polite toast instead of a hard failure.
- **43 languages**, all aligned to the English baseline and kept in sync by an LLM-assisted translation pipeline.
- **Private by design** — plain ES6+ JavaScript, no framework, no telemetry; development needs no build step (release packages are built from `dist/` via `npm run build`). Visit statistics are stored locally, can be paused with one switch and erased with one button.


# What's new in 4.0

4.0 is the largest release in the project's history. It rebuilds the popup around a **view system** — seven specialized views behind an icon tab strip — while keeping the classic tree experience one setting away.

## The view system

- **Seven views**: **Tree** (the classic), **Search**, **Tab groups**, **Recent**, **Stats**, **Dead links**, **Duplicates**. The icon tab strip shows live count badges (dead marks, dupe groups, tracked pages) and each feature view (Tab groups/Recent/Stats/Dead links/Duplicates) can be hidden — or fully disabled — per view, or the whole strip can go for the classic single-pane layout.
- **One keyboard model everywhere** — the tree's mature semantics (arrows, `Home`/`End`, `PageUp`/`PageDown`, `Enter`, `F2`, `Delete`, type-ahead) now work identically in every list view; `↑` past the first row steps up to the tab strip, then the search box; the strip itself is arrow/Home/End navigable with roving tabindex and RTL awareness; `Alt+1…7` jumps straight to a view (portable across Chrome and Edge, which reserves `Ctrl+1…8` for its own tabs).
- **Layered `Esc`** — context menu → command palette → view-level action (e.g. pausing a scan) → clear search → back to tree → close, always peeling one layer at a time.
- **Popup vs panel** — both reopen on the view you left (the popup via the default-on *remember the last view* switch — turn it off for the classic always-tree boot), and the side panel is ready to become your always-on bookmark workspace.

## Search view — dual zone

- The popup search is now a proper view: **history on top, results below**. Both stay on screen together.
- **Search history** (MRU 10) records what you actually used — pressing `Enter`, opening a result, or leaving the view — with result counts and relative timestamps. Click or press `Enter` to re-run, `Delete` or right-click to remove one or clear all. A setting turns history off (and wipes it) instantly.
- Leaving and coming back keeps everything: the box, the results, the scroll — no reflow, no re-query.

## Tab groups view

- **Your browser session, one list**: every window's tabs in real tab order — grouped tabs under their Chrome tab group (title, color, member count), ungrouped tabs as plain rows, with the current tab flagged. Collapse a group here and the browser's group collapses too (optional sync switch).
- **Full tab bookkeeping without leaving the popup**: activate, pin/unpin, sleep/wake, close, drag to reorder — per tab or per group, from the row buttons, the context menus, or the keyboard.
- **Selection mode for batch work**: group selected tabs into a new group, open them into an existing one, close or sleep them — and when a selection already belongs to a group, choose **copy** (reopen elsewhere) or **move** (leave the old group).
- **Bookmarks meet tabs**: one click files a tab into your quick-add folder; a whole group saves as a bookmark folder and remembers its color and title, so *open as tab group* later restores it looking the same.
- **Recently closed groups** live at the bottom (depth configurable 5–50): reopen the whole set, or restore/bookmark/forget individual tabs.

## Recent view

- The old in-tree "recently added" strip grew up into its own tab: your newest bookmarks grouped into **Today / This week / This month / Older**, each row with a relative-time badge and a `path · exact time` second line.
- `R` (or right-click) reveals any row in the tree; an optional one-time import from Chrome history (off by default, permission requested only if you opt in) back-fills older visits.

## Stats view — your actual usage

- **Visit statistics, 100% local**: rows you open from the popup are counted, and a background collector notices when you navigate to bookmarked URLs from anywhere else (deduplicated, so one open never counts twice).
- Sort by **count** or **recency** (persisted), clear everything with one ConfirmDialog-gated button, or flip `statsEnabled` off — recording stops completely, and the erase exit stays reachable.
- A **Recently visited** section lists what Chrome says you actually visit; bookmarked rows show a ★, everything else has a one-click ☆ to file it away.

## Dead-link view

- **Dual-channel checking**: a direct fetch first; on failure, a second channel gets the final say — so "down for everyone" and "just blocked here" read as different badges. The second channel is your **own proxy server** (http/https/socks5) added in one click from the strip above the list (reachability-tested before it is saved), or a legacy relay URL template from the options page.
- **Proxy mechanics, honestly scoped**: checks through your proxy are routed by a temporary PAC script that matches only the scanner's own marker-tagged probe URLs — every other tab's traffic stays on its normal path, and the settings are restored the moment a scan settles, cancels or the popup closes. The `proxy` permission is declared at install time (Chrome does not allow it as an optional permission); it sits **completely unused** if you never configure a proxy server or never run a scan — no proxy code path executes otherwise. **Known conflict**: a few proxy/acceleration extensions (e.g. iGuge) actively disable any enabled extension that declares the `proxy` permission and is not on their whitelist — see the [issue #53/#57 analysis](issues/issue-53-57-iguge-conflict.md) for the verified root cause and what to do if you're affected.
- **Progressive, pausable scans that outlive the popup**: the scan runs in the service worker, so closing the popup or side panel mid-scan loses nothing — reopen to a live mirror, and an interrupted run even resumes itself. Results stream in row by row; `Esc` pauses/resumes without losing progress; canceling restores the last completed snapshot. Progress ticks repaint silently, never moving your scroll position.
- **A risk banner before the first cleanup** (dead links and dedup both rewrite bookmarks in bulk) links to Chrome's own backup & restore guide; *Don't show again* snoozes it until the next major or minor version (patch updates stay silent).
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

- **Unit tests** across 79 Vitest suites, covering every module — including contract tests that pin the row-alignment geometry, the z-index layering table, per-theme badge contrast and the horizontal-scrollbar protection contract (every scrollable pane clips `overflow-x`, text slots ellipsis, fixed slots `flex: none`, zoom rules never alter geometry). The live count is `npm run test:run` output (and the CI badge).
- **Docker harness**: zero-console-error smoke, a real-browser keyboard/view verification suite (tab-strip keyboard model, focus zones, header-row arrow chain, per-view ↑↓/past-top crossings with the in-list toolbar rungs — the dead view stacks two, custom palette commands end-to-end, banner keyboard reachability, search dual-zone, per-view rendering — 153 hard assertions), a scrollbar matrix probe (screen resolution × browser zoom × in-extension zoom × popup size sweep, no horizontal scrollbar on any pane — 752 assertions), and screenshot suites across 5 themes and 8 UI languages (with an RTL mirroring check).
- Unified locale tooling (`scripts/i18n.py`): audit, missing-key reports, LLM batch translation, verify gate. Baseline grew from 75 to **345 keys** at 4.0 (**555** as of 4.1.0), all 43 locales aligned.
- **CI**: GitHub Actions runs the unit suites, the i18n gates and the release packaging on every push and PR.
- Repository organized for the v4 era: `src/`, `pages/`, `css/`, `assets/`, `scripts/`; obsolete artifacts (old `release/*.crx`, MV2 leftovers) live on in git history.


# Feature highlights

1. Seven views in one popup: tree, search, tab groups, recent, stats, dead-link scan, duplicate cleaner.
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
2. **Full keyboard support**, identical across all seven views (details in the [v4 feature guide](guide-v4.md)):
   - **↑↓** move selection; **↑** past the first row steps up to the tab strip, then the search box
   - **←→** on the tab strip switch views; **→** on a row opens its context menu, **←** closes it
   - **Enter** / **Space** to open; **Ctrl/Cmd+Enter** to open in a new tab
   - **Home** / **End**, **PageUp** / **PageDown**; **Alt+1…7** jump to a view directly (`Ctrl/Cmd+1…7` is the legacy twin where the browser allows it)
   - **Delete** to delete (undoable), **F2** to rename, **R** to reveal in tree; **K** pins a keeper in Duplicates, **M** toggles a dead mark
   - Type-ahead filtering in the tree and search views: start typing to find items by name
3. Middle-click a folder to open all its bookmarks (as a color-coded tab group).
4. `Ctrl+F` focuses the search field; `Esc` clears the search, dismisses the context menu, pauses a scan, or closes the palette — layered from inner to outer.
5. **Command palette** (`Ctrl/Cmd+K` inside the popup, `Ctrl/Cmd+Shift+K` globally):
   - Fuzzy-search bookmarks and folders, jump to a folder in the tree, or run slash-commands
   - Slash-commands: `/tabgroups` `/recent` `/stats` `/dead` `/dupes` jump to views, `/session` saves the window's tabs, `/options` opens settings, `/theme <name>` switches themes, `/tabs` toggles the strip — plus your own **custom commands** (options page → *Commands* group, or the palette's *Save as a command* row)
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

Dev needs no build step — **Load unpacked** the repo root in `chrome://extensions/` for the dev form. The release form is `dist/`: `npm run build`, then Load unpacked `dist/` (or `npm run package` for the store zip).

```bash
# Unit tests (Vitest — the live case count is `npm run test:run` output)
npm install
npm run test:run

# Headless harness (Docker)
scripts/harness/run.sh        # the verify gate: smoke + keyboard + scrollbars + menu verifies
scripts/screenshots/run.sh    # visual capture ONLY — suites into tmp/shots/
#   smoke.js               popup/panel/options raise zero console errors
#   verify-keyboard.js     tab-strip keyboard model, focus zones, view rendering
#   verify-scrollbars.js   screen×browser-zoom×in-extension-zoom sweep: no horizontal scrollbar
#   verify-menu-*.js       #48 menu overflow / collapsed flyouts / extreme zoom sweep
#   scripts/screenshots/shots.js         interaction states (light/dark)
#   scripts/screenshots/shots-matrix.js  4 themes × full surface (menus + flyouts + dialogs)
#   scripts/screenshots/shots-i18n.js    tree/tabs/menus/dialog/options × 8 UI languages
#   scripts/screenshots/shots-palette.js palette + the four feature views
#   scripts/screenshots/shots-guide.js   guide screenshots (search dual zone, options Views group)
#   scripts/screenshots/shots-tabgroups.js tab-group menus & dialogs, verified from the service worker
#   scripts/console/       browser-console probes; scripts/harness/diag/ node probes (on demand)

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

### v4.1.0

*2026-08-21*

#### New

- **Tab groups view — the seventh view** (between Search and Recent): every window's tabs in real order, grouped tabs nested under their Chrome tab group with title/color/member count, ungrouped tabs as plain rows, the current tab flagged. Group heads fold like tree folders (arrow-key model included), with an optional collapse-sync switch that mirrors the fold into the browser itself.
- **Tab and group management in place**: activate, pin/unpin, sleep/wake, close, drag-to-reorder across groups and windows; group actions cover rename, activate, close, sleep, ungroup, move to a new window, and *save as bookmark folder* (group color/title are remembered and restored by *open as tab group*). Four dedicated context menus (tab row, group head, closed group, closed tab) join the keyboard menu model.
- **Selection mode with copy/move semantics**: batch group-into-new-group, open-into-existing-group, close or sleep; selected tabs already in a group prompt a copy-or-move choice. Selected tabs can be bookmarked into a chosen folder via the new folder-picker dialog.
- **Recently closed groups**: the last N closed groups (configurable 5–50) stay listed with per-tab restore/bookmark/remove and a reopen-all, persisted like search history.
- **Options**: the tab strip gets the Tab groups show/disable controls like every feature view; the new *Tab groups* options group carries the group-color style (off / edge band / connector line) and the closed-history depth. The palette grows `/tabgroups`, and the what's-new banner mechanism re-arms once for this release.

### v4.0.8

*2026-08-21*

#### New

- **Real site icons for bookmarks Chrome hasn't cached**: this release fetches the actual site icon for bookmarks the browser has no cached image for — direct from the site first, then through a built-in third-party icon fallback list (favicon.run → icon.horse → DuckDuckGo) guarded by a per-provider circuit breaker and failover; while a dead-link proxy session is active, discovery re-runs through the proxy. The enriched cache is capped by a dynamic byte budget that halves-and-evicts under pressure. New Icons-group controls: "Fetch missing site icons" (on by default), "Third-party icon fallback" (also on by default), and a "Clear icon cache" action. Freshly fetched icons swap in with a subtle pop animation (silenced under reduced motion), and letter-avatar placeholders a fallback service returns for unknown domains are recognized by pixel fingerprint and skipped — the chain fails over instead of caching a gray letter tile for 30 days.
- **Favicon gallery**: the options page's *Clear icon cache* row gains a **View refreshed icons** link opening a display-only gallery of every site whose icon vBookmarks refetched — each card shows the icon, where it came from (direct fetch, your proxy relay, or a named fallback provider), when it was fetched and its size, plus the bookmarks on that site with their folder path, dead marks, sync state and recorded opens. A compare toggle swaps every icon back to the placeholder it replaced — the difference the service makes is one click away.
- **Hide or disable views right from the tab strip**: right-click a feature-view tab (or press `ContextMenu`/`Shift+F10` on it) — **Hide** collapses the tab away like unchecking its *Show … view* option: the `Alt+number` jump goes, the palette command stays, and entering a hidden view from the palette shows a return-path toast; **Disable** greys out the show option and removes every entry point until re-enabled (each *Show … view* row in the options *Views* group carries the same Enabled/Disabled state). Hiding the Tree or Search tab hides the whole strip, and `Alt+number` numbering compacts over the visible set.
- **Options page regrouped per view**: after General and Views, each view owns its options in tab order — Tree (bookmark-bar scope), Search (search-on-Enter), Recent (row count), Stats (visit statistics + search history) and Dead links (scan tuning + proxy) — with hidden placeholders for the upcoming tab-groups and duplicates settings (20 sections in all). Every per-view Show/Enable control stays together in the Views group.
- **Storage usage bar**: the Icons group now shows how much of the ~10 MB `chrome.storage.local` quota the icon cache, everything else, and the free space each take (with a byte-formatted legend), updating live as data changes.
- **Header GitHub / Homepage links and version number** in the top-right corner of the options page.
- **Backup includes the icon cache by default**: a new "Include icon cache in backups" option packs the enriched per-site icon cache into settings export/import (on by default, so a full-fidelity backup travels with its icons); turning it off keeps backups small, and icons are re-fetched automatically.
- **Manual UI language switch**: a language dropdown in the options page (General, under Theme) overrides the browser UI language — all 43 shipped locales with their native names, `auto` follows the browser; the palette's `/lang <code>` command does the same (`/lang auto` clears). Pages reload once to apply. (Layout direction still follows the browser UI language, so RTL locales render their strings left-to-right; manifest-level strings like the command names can't be switched.)
- **`/version` palette command**: opens a metadata dialog — extension version, the matching announcement, browser name/version, OS, channel, UI language, user agent — with a one-click button copying the full JSON for bug reports.

#### Fixed

- **Favicon cache quota race**: the byte budget is now enforced asynchronously, so a burst of concurrent fetches can no longer push the cache past the limit before the eviction runs.
- **Favicon discovery edge cases**: site icons served as `application/octet-stream` (common on plain CDNs/static hosts) are now recognized by magic-byte sniffing instead of being rejected; page-HTML reads are capped at 200 KB; a host already cached no longer gets re-fetched when a placeholder renders before the storage hydrate lands; oversized session-only icons are capped in memory; and `<link>` extraction now honors `<base href>` and skips commented-out icon declarations.
- **Disabling icon fetch no longer punishes hosts**: hosts whose fetch is aborted mid-flight by switching "Fetch missing site icons" off no longer get stamped with a 24 h failure marker — one toggle used to silence a batch of never-actually-failing hosts for a day.
- **Backup-import write safety**: a failing settings write (quota or a transient error) now alerts clearly and skips the page reload instead of surfacing half-applied settings with no feedback; imported icon-cache entries are validated one by one (must be a `data:image/` payload ≤ 96 KB), so a hand-edited backup can no longer bypass the cache budget.
- **No more zombie rows in the dead-link view**: the marks-only "past marks" view (no scan run yet) now re-joins on bookmark events too — a deleted bookmark's row disappears at once and its ⚑ can no longer re-persist the deleted id; a bookmark deleted while a scan is running no longer resurfaces as a ghost row when the run finishes.
- **Cancelling a scan is final**: a cancel landing while a cold-start resume / resume re-launch is still reading its state can no longer resurrect the cancelled run from a stale snapshot.
- **Announcement and "What's new" banners are keyboard-reachable**: both new banners joined the managed Tab ring, the announcement's dismiss button is reachable, and Esc dismisses the announcement outright (same mark-as-seen semantics as its ×) — keyboard-only users could previously never get rid of it.
- **Icon-discovery data URLs and candidate cap**: L2 tries at most the first 5 declared `<link>` candidates per page, a malformed `data:` candidate now skips just that item and the loop continues, and percent-encoded (non-base64) inline SVG data URLs decode correctly.
- **Options-page low-priority polish**: the storage bar measures with `getBytesInUse` and debounces burst writes (300 ms); clearing the icon cache now confirms first and gives feedback when empty; backup filenames say `-with-icons`/`-no-icons`; backup export/import drops the runtime `vbmDeadScan` journal; the header GitHub link goes to the project repo, changelog links point at `docs/README.md` explicitly, and the header subtitle is valid markup.
- **Dead-link view low-priority polish**: the second toolbar's "All" now reads "Any status" to disambiguate the two counters; rows without a per-row timestamp sort last under detection-time sorting; a hidden-by-filter marks-only view shows the "try another segment" hint instead of the first-scan call-to-action; the bare status pill "0" renders as "—"; and "Delete all" now covers the same visible set as "Select all" in the All view (result rows plus uncovered past marks).
- **Scan race hardening**: a stale start chain tears down only its own generation's PAC, so it can no longer strip the proxy session from a newer scan; and an import rewriting `deadMarks/deadMarkTimes` while the side panel is open is reflected in the dead-link view immediately.
- **Dead-link view icon flicker on re-entry**: re-entering an unchanged dead-link view rebuilt the whole list, blanking every favicon and replaying each swap — the view now keeps its DOM unless scans, marks or the bookmark tree changed while it was away, and enriched icons drop in instantly (the old fade-in made cached re-injections read as a vanish-and-reappear flicker).
- **IME composition Enter no longer opens the first search result**: in the top search bar, the Enter that commits a Chinese/Japanese IME candidate now stays with the IME. Previously it was treated as a normal Enter and focused/clicked the first result; if the row was re-rendered before the click, the popup itself navigated to that bookmark's URL (an internal host could surface as a `chrome-error://chromewebdata/` DNS error page).
- **Global palette wake-up no longer self-closes on cold opens**: `Ctrl/Cmd+Shift+K` from another page could open the popup with the palette instantly closing again while the window's focus was still settling — the palette now waits for the popup to report focus before opening.
- **IME composition Enter ignored in the command palette too**: the palette input gets the same composition guard as the search bar, so the Enter committing an IME candidate no longer executes the highlighted row.
- **Favicon probes can no longer raise browser auth prompts**: direct icon-discovery fetches omit credentials and bypass the cache, so a 401 `WWW-Authenticate` site no longer pops a login dialog over the popup; a capture-phase guard also makes bookmark-row clicks always go through the actions layer — the popup itself never navigates to a bookmark URL.
- **Selection-mode keyboard focus**: entering selection mode from the keyboard focuses the batch bar's first enabled control; exiting via the exit button or Esc on the toolbar returns focus to the restored Select button.
- **First-open banner clipping after a settings import**: importing a saved popup width no longer makes the donation/announce banners lay out against the wrong containing block on the first open — controls that looked missing (Don't show again, the announce ×) are back.
- **Abandoned search queries stay abandoned**: clicking the search bar's × (or deleting the query text) after switching away from the search view now actually persists the wipe — the stale query used to restore on the next popup open.
- **View-switch cleanup**: switching views dismisses the hidden-view hint toast instead of letting it linger into the new view.
- **Tighter fuzzy ranking**: fuzzy scoring gained a span penalty, so compact subsequence matches outrank scattered ones — query `123` now prefers `10.200.31.0` over `vs1-…2/version3.html`.
- **Search-history row menus anchor correctly**: right-clicking a history row's clock/meta/time children opened the folder menu instead of the history menu — the nearest anchor is now preferred during target normalization; `editBookmarkFolder` is also guarded against a failed `chrome.bookmarks.get` callback.

#### Changed

- **Donation card redesigned**: a redrawn gradient-heart illustration replaces the flat glyph, the card header is now the consolidated identity line "vBookmarks 4.0 — a complete remake with a modern design, packed with new features" linking the v4 guide (the card no longer carries per-version text), the ask is tighter, and a new **Rate it** button opens the Chrome Web Store listing — every review keeps the updates coming, and rating earns the same long quiet period as donating. The card's warm rose identity now reads clearly apart from the cool accent-bar announcement strips.
- **Settings storage audit landed**: about forty small device-independent preferences (theme, UI language, behavior toggles, view and sort/filter prefs) moved to `chrome.storage.sync` and now follow the signed-in browser; a one-time migration on upgrade treats the sync area as authoritative and clears the old local copy only after a successful write, with a local fallback on the first post-upgrade service-worker start. Bookmark-id-keyed data (quick-add target, separators, dead marks, visit stats) deliberately stays local — Chrome does not keep bookmark ids stable across devices — and the oversized custom icon stays local too (the 8 KB per-item sync limit).
- **Icon fetch retries converge**: cached icons never expire — they are served until the byte budget evicts them or you clear the cache, so no periodic mass re-fetch ever happens. A host whose icon can't be fetched is retried after 24 h, 3 days and 7 days, then given up until the cache is cleared; retries only fire when a placeholder row actually renders, never in the background. The favicon gallery's failed strip shows which state each host is in.
- **Announcement feed targeting**: messages in `docs/announce.json` can now declare their audience with a `version` condition — an exact release (`"4.0.8"`) or comparator conjunctions (`">=4.0.0 <4.1.0"`) — or carry no version field at all for a general push to every version, so the feed works as a real push channel instead of only per-release notes. Pulls stay bounded (6 h cache, etag-conditional, only on popup/panel opens, every failure silent), a malformed condition drops the message instead of widening its audience, and dismissed messages never resurface. Minor-version release notes now carry just the summary + changelog link — the v4 guide link lives on the donation card's permanent header.
- **In-product announcement banner**: the version-gate banner became a local "What's new" banner fired exactly once by the version gate on the 4.x → 4.0.8 crossing — no network, no dismiss; the remote announce feed (toggled by "Show in-product announcements") still runs as its network-dependent complement. The v4.0.8 banner announces this favicon-enhanced release and links the v4 guide and the changelog.
- **Options-page polish**: trailing hints no longer sit far below their controls; list buttons share one visual weight with the page's other buttons; the storage bar gained a used/total overview row, distinct segment colors, per-segment share legend and keyboard-reachable tooltips; destructive actions (clear cache / clear stats / import / reset) render in the warning danger style; the header wraps gracefully at narrow widths.
- **Third-party icon fallback and icon-cache backups are on by default**, so new users get working icons for sites Chrome can't reach directly and full-fidelity backups out of the box.
- **Announcement feed fallback chain**: the in-product feed fetches through direct GitHub → your configured dead-scan proxy (marker-PAC) → a speed-tested top-5 of github.akams.cn mirrors — the mirror node list is refreshed and measured only when the mirror layer is actually reached (TTL/cooldown/circuit-breaker bounded) — so release notes also reach users who can't hit GitHub directly.
- **Dead-link view toolbar rebuilt**: the idle controls are now three stacked icon rows — detection (last-scan time, rescan, clear, verdict filter), marks (mark/unmark-all, delete-all, select) and status (mark filter + sort) — every icon button titled, right edges column-aligned, and the clear-marks glyph is now a solid flag.
- **Duplicates view toolbar rebuilt**: two aligned rows (strategy/scope/scheme; summary + apply-all + select) with an icon-only select-mode entry, plus a per-member delete on member rows (revealed on hover/focus) that regroups live — deleting one copy of a 2-member group dissolves the group, and deleting the pinned keeper falls back to the strategy pick.

#### Engineering

- Favicon enrichment module: discovery chain, built-in provider list with per-provider circuit breaker + failover, cache + queue, capped HTML reads and session-only eviction.
- Store publishing supports a trusted-tester grey release (`TRUSTED_TESTERS`); `DEFAULT_PUBLISH` restores a full rollout.
- `loadDotenv` accepts inline comments (`KEY=value # note`).
- Bookmarklet behavior verified in a real-browser harness (`verify-bmlet.js`).
- Console probe added for the search-bar IME-Enter regression (`scripts/console/probe-ime-enter.js`).
- Test suite at **77 files / 2510 cases**, all green; the headless smoke gate gained a favicon-gallery section.

### v4.0.7

*2026-08-15*

#### Fixed

- **Zoomed context menus always show at full height**: the 4.0.5-era fix compressed the menu down to the space below the trigger row, so at zoom > 100 a below-midline right-click showed a shrunken menu. The menu now keeps its full height — clamped to a viewport-level scrollable box only when even the whole popup cannot fit it — and a right-click on an open menu's background re-opens it at the pointer instead of dismissing it, so consecutive right-clicks on a row always show the menu again (no more show/hide alternation).
- **Dead-marked list stays in sync with the toolbar filter**: switching the toolbar between 全部 / 受限 / 死链 (All / Blocked / Dead) filters the result rows correctly again (仅受限 / 仅死链 used to be swapped), the marked list no longer echoes rows the active filter hides, and it renders after the result rows.
- **Imported backups no longer double-count "Previously marked"**: an import restores `deadMarks` and the last-scan cache as-is and the residue count derives from the §2.4 natural-residue rule — marks the restored scan verdicts dead/blocked ride their result rows and are never counted again as marks, so the All counter no longer doubles.
- **↑/↓ keyboard navigation crosses the result list and the residue marked list**: the "已标注" heading between the two sibling lists no longer blocks arrow-key travel, and the crossing works from a result row's inline buttons too; single-list views (tree/search/recent/stats/dupes) are unaffected.
- **Selection-toolbar counts, wide-row timestamps, consistent verdict colours**: the batch-selection toolbar shows live category counts (All = dead + blocked + previously-marked), wide rows show each bookmark's detection time on the right, and dead (red) vs blocked (amber) now colour the pills, the mark buttons and the tree overlay alike.
- **Mark-status filter and status pills actually apply**: the 已标注/未标注 filter had an inert dataset key that left it filtering nothing — it now really filters the result rows and the marked list; marked flags render filled, and status pills share a uniform width aligned with the timestamps.
- **Scan cancel/restart races fixed**: cancelling or re-starting a scan while it is still in its asynchronous setup window (a cold-start resume, a second start, or a cancel landing before launch) no longer double-launches the scan, leaks the marker-PAC proxy session, or lets a cancelled run write a result cache — "cancel never happened" now holds regardless of timing.

#### Added

- **Dead-check view redesigned around a "Previously marked" category**: the toolbar filter gains a *Previously marked* segment that switches to a marks-only view; in the default *All* view the marked list is appended below the scan results (italic heading to tell it apart), and items this scan still flags as broken move out of the marked list into the results keeping their ⚑ mark. The *All* counter now sums all three categories (dead + blocked + previously marked), not just this scan's result rows. Cancelling an in-flight scan switches to the Previously-marked view and raises a session-scoped, dismissible tooltip banner — prompting you to click **Rescan** to start a new check and to handle the bookmarks in the list below; the same banner appears after a finished scan when past marks this scan no longer flags as broken (reachable again, but marked before) remain below the results. The selection toolbar now applies to the marked list too, so marks can be batch-deselected.
- **Mark-status filter on a second toolbar**: alongside the category filter, a second toolbar filters the view by mark status (已标注 / 未标注), applied to the result rows and the residue marked list together — 未标注 hides the residue list, since every residue row is marked. The batch/selection scopes (mark-all, delete-all, select-all/invert) all follow the visible set, and the two filters stay orthogonal.
- **Result sorting**: a sort dropdown (Detection time — the per-row scan timestamp, default; Folder path; Mark time — a per-mark timestamp persisted alongside the marks) reorders the result rows and the residue list together. Sorting applies once a scan has finished only — a live scan keeps progressive tree order so rows never jump mid-scan — and old backups without timestamps fall back to the stable stored key order.
- **Amber reading for marked / blocked rows** (4.1.0 task-1 A6/D1): a row's mark toggle that is already marked — or whose verdict is blocked (受限) — renders in the warning amber (same as the blocked pill) instead of the neutral accent, and the tree-view dead × overlay on marked bookmarks is amber too, so "restricted" reads apart from a dead-only row.
- **Clear scan results**: a button resets the last dead-link scan (the ⚑ marks are kept as "previously marked") and re-raises the rescan banner, so you can start over without losing your marks.

### v4.0.6

*2026-08-15*

Rollback to 4.0.4 — 4.0.5 shipped with two regressions (zoomed context menus, and the dead-marked list out of sync with the toolbar filter); its changes were recalled and reworked into 4.0.7.

### v4.0.5

*2026-08-15*

> **⚠ Recalled / deprecated** — superseded by 4.0.6 (rollback to 4.0.4); properly re-fixed in 4.0.7.

#### New

- **Low-contrast favicon inversion**: a new `faviconContrast` option (Views group, on by default) detects favicons that sink into the active theme — dark glyphs on dark surfaces, light glyphs on light ones — and flips their brightness **while preserving hue** (`invert(1) hue-rotate(180deg)`), so brand colors survive. The detector keys off extreme-tone pixel shares rather than average brightness (which misread small dark marks on transparent backgrounds, e.g. thepaper.cn and GitHub) and deliberately spares self-inverting icons like x.com's white-on-black disc. It re-judges on OS light/dark flips under the auto theme, applies live in the always-on side panel, and was tuned against a 14-real-favicon × 4-theme render matrix.
- **Dead-link view empty state gains a "start scan" pill CTA** — the first scan is one click from the empty view instead of a toolbar hunt.
- **Command palette result highlighting**: matched characters are wrapped in `<mark>` again, so a row shows why it ranked.

#### Fixed

- **Palette keyboard traps**: result rows no longer sit in the Tab order (they degraded ↑↓/Space into native scrolling and froze the highlight), and Tab now cycles a two-stop loop between the input and the Esc close button instead of escaping the palette and auto-closing it.
- **Stale `.active` marker swallowed keys**: a leftover active class on a closed menu made the palette keep treating it as open.
- **Batch deletions report the real count**: duplicate-cleaner removals that fail mid-batch are skipped and the summary toast counts only actual deletions (the dead-link side already did); applying a selection now exits selection mode.
- **Dead-link view robustness**: bookmarks created mid-session (or restored by Undo) re-join the rows; the tab badge derives from the tree-joined result rows and can no longer resurrect a stale count on popup reopen; mark-all / selection entries key off the filtered row set like delete-all does.
- **Escaping gaps closed**: an untitled bookmark's protocol-stripped URL fallback rendered unescaped (a pre-v4.0 leftover), and the shared escaper now covers `&` after a full caller audit proved no double-escaping path remains.
- **Folder menus in search results / the palette** grey out content-dependent entries (open-all, tab group, sort) for empty folders, matching the tree — and a greyed state never leaks into the next menu.
- **Visual consistency**: two-line row icons align with the tree's slot rhythm (search view included); delete affordances are uniformly red (search-history inline/menu deletes, remove-separator, the palette delete command, dupes clean) with a shared danger hover; sync dots and dead-link × badges use logical `inset-inline-end`, so RTL mirrors correctly.
- **Second-pass audit merge**: the palette's custom-command rows now escape and validate `slash`/`aliases` (closing a sync-storage injection path); tree rebuilds park/restore the focused row and the `focusID` restore is guarded, so a rebuild no longer drops keyboard focus to the page body; popup focus memory covers the search-history area; the omnibox highlighter self-escapes regex metacharacters (a query like `c++` no longer breaks highlighting) and highlights subsequence matches, so highlight and ranking agree; toolbar focus restore survives button-set changes (class+index instead of a bare position); the dead-link start row shows its focus ring only for keyboard focus (`:focus-visible`); dead-link selection rows drop the leftover ghost icon slot.
- **Colorful logos are no longer mis-inverted on light themes**: a chroma guard keeps brand-color icons (e.g. the Chrome Web Store devconsole mark) from being flipped into a black-card wreck — the tuning matrix grew to 14 real favicons × 4 themes.
- **Dead-link marks survive a cancelled scan**: with no result list on screen, marked bookmarks render as their own list (each individually unmarkable, plus a batch clear-all), and a cached result list surfaces the marks it doesn't cover — a cancelled run never strands a mark with no way to clear it.
- **Zoomed context menus never cover the right-clicked row**: above 100% zoom an over-tall menu used to flip up over the trigger row, so the next right-click hit the menu itself and dismissed it (show/hide alternation) — the menu now clamps to the space below the row, including the viewport-scrollable case.

#### Changed

- **Three shared-module consolidations**: nine verbatim `htmlspecialchars` copies → `src/escape.js`; the four list views' park/restore focus copies → `src/list-focus.js` (plus a unified row focus-target contract and the toolbar focus trio); omnibox and popup fuzzy ranking → `src/fuzzy-core.js` (one fzf-style implementation, with a fix for highlight offsets on characters like `İ` whose lowercase form changes length).
- **Focus memory obeys "Remember previous state"**: the remembered row is gated by the option and cleared at startup when off; the visible undo toast joined the Tab ring; dropdown-list rows are skipped by the row stops.
- **Batch confirmations name the stakes**: duplicate-cleanup confirms name the keeper ("Keep ‹title› and remove the other N copies?"), and every batch delete/clean confirm across the dead-link and duplicates views appends the one-step-undo note (new key `undoSingleStepNote`, translated across all 43 locales).
- Version bumped to **4.0.5** in `manifest.json` / `package.json`.

#### Engineering

- Two independent audits of the full v4.0 → 4.0.5 delta plus their merge (the second pass caught what the first missed: a favicon theme observer that never installed, the palette injection path, tree focus park/restore) — both reports, the comparison/merge plan and the fused 4.1.0 design are archived in `docs/review-4.0.5/`; documentation (AGENTS.md, keyboard-model, the v4 guide) re-synced to the implementation.
- The popup resize/zoom layer was extracted from `neat.js` into `src/resize.js` (pure decision kernels stay in `src/resize-core.js`), closing a stale drag-ceiling leak between drags.
- Test suite at **67 files / 2078 cases**, all green — new `list-focus` suite, rewritten favicon-contrast strategy tests, and new contracts for the deletion chains, menu greying, escaping and the i18n copy changes.

### v4.0.4

*2026-08-13*

#### New

- **Empty-folder menu greying**: folder context-menu items that depend on folder content (open-all, open-as-tab-group, new window / incognito, sort) grey out on empty or URL-less folders — only the add-type entries (bookmark / folder / separator inserts) stay enabled. Disabled entries are dimmed at half opacity so they read clearly as unavailable across every theme.
- **Unified focus restoration on popup reopen (focusSpot)**: the search bar, header buttons, in-view toolbar controls, view tabs and list rows restore their focus across a popup reopen through one model, gated by the "remember previous state" option.
- **Command palette returns focus on keyboard dismiss**: closing the palette with Esc / Ctrl+K / the close button returns focus to the element that opened it (the search bar / tool button).

#### Fixed

- **Batch deletions (duplicates / dead-links) refresh the tree immediately** — deleted rows no longer linger in the tree view until the popup is reopened.
- **Command-palette close focus misplacement** (folded into the New item above).

#### Changed

- **Unified "what counts as a completed search"**: a query enters the recent-search history when it is *consumed* — opening a result, pressing Enter, the two-level Esc clear, leaving the search view, closing the popup, or revealing the row in the tree (R). The × clear button is the *abandon* path: it is not recorded, and it now clears the results pane too, so an unconsumed query leaves no trace.

#### Engineering

- Test suite strengthened substantially: rewrote 11 pseudo-tests (copied-kernel / tautological / zero-assertion), filled 3 file-level coverage gaps, and extracted the resize / folder-sort / quick-add / donation / tool-button / wake-up / startup-flags / settings logic into testable modules.
- New option-switch → behavior differential contract, parameterized-copy contract (`tests/i18n-copy`) and shared test-infrastructure helpers.
- Introduced an ESLint progressive gate (error-level, in CI).
- Added a real-browser smoke gate (zero console errors) to CI and the release pre-check, so an extension that crashes on load is caught before tagging.
- Dead-code cleanup (the unused `copy-all-titles-and-urls` handler, the ineffective `hide-editables` toggle).

### v4.0.3

*2026-08-12*

#### Fixed

- **Drag-and-drop sorting misaligned in zoomed mode** ([#59](https://github.com/windviki/vBookmarks/issues/59), [#60](https://github.com/windviki/vBookmarks/issues/60)): with the popup zoomed, a dropped row landed in the wrong place — the drag overlay's coordinates and the mouse-release drop-target hit-test did not account for the zoom level. Both are zoom-corrected now, with regression tests covering overlay layout, drop-into-folder sizing and the zoom-level reset.
- **The focus-restore highlight can be turned off** ([#58](https://github.com/windviki/vBookmarks/issues/58)): reopening the popup used to refocus and flash the last-focused row on every open. The focus restore now follows the existing **"Remember previous state"** option — unchecked, the popup starts fully fresh, with no remembered highlight (and no remembered scroll or opened folders either).

#### Changed

- **"Remember previous state" now covers the last-focused row** ([#58](https://github.com/windviki/vBookmarks/issues/58)): previously it only restored scroll position and opened folders; the focus restore is folded in, so a single switch controls the whole "where I was" restore. The option's description is updated in all 42 locales.

#### Polish

- **iGuge conflict documented** ([#53](https://github.com/windviki/vBookmarks/issues/53), [#57](https://github.com/windviki/vBookmarks/issues/57)): the iGuge proxy/acceleration extension actively disables any installed extension that declares the `proxy` permission and is not on its whitelist — so vBookmarks could be disabled on every Chrome restart when both are installed. Verified against the store-shipped CRX; the Dead-link section now explains the cause and what affected users can do, and we're coordinating whitelisting with iGuge. vBookmarks keeps its `proxy` permission (it is only ever used, temporarily and marker-only, during a dead-link scan).
- Developer tooling: vitest bumped 1 → 3.2.7, clearing 6 Dependabot advisories (dev-only — no user impact); the modified-key i18n flow and the release process are documented in `AGENTS.md`.

### v4.0.2

*2026-08-11*

#### New

- **Collapsible context-menu blocks** ([#48](https://github.com/windviki/vBookmarks/issues/48) follow-up): the crowded *tab-group* block (bookmark & folder menus) and the *sort* block (folder menu) collapse into a single submenu entry with a ▸ indicator. Two new **Views** toggles control them — `collapseTabGroupMenu` (tab groups, **off** by default) and `collapseSortMenu` (sorting, **on** by default). The flyouts reuse the whole context-menu keyboard protocol: `→`/`Enter` open, `←`/`Esc` close one level at a time, `↑`/`↓` wrap inside the flyout on every platform.
- **Menus hardened at extreme zoom/DPI** ([#48](https://github.com/windviki/vBookmarks/issues/48)): a right-click menu can no longer outgrow the popup — height clamps to the space below the search bar (overflow scrolls internally), width caps to the viewport, and a flyout that does not fit on one side flips or stacks below its entry. Menus stay usable at high browser zoom, high DPI and narrow popup widths.
- **Precision-first search ranking**: results sort by match tier — exact > prefix > word-start > subsequence — with the added date demoted to a final tie-break, so an exact match can no longer be outranked by a newer, looser one. URL scoring strips the structural `https://` and `www.` prefixes first, so `https://github.com` and `https://www.github.com` rank alike.

#### Fixed

- [#48](https://github.com/windviki/vBookmarks/issues/48): a right-click menu taller than the popup closed the instant it opened — focusing it scrolled the document and tripped the scroll-close listener. Menus now clamp to the viewport and scroll internally.
- On macOS the slight finger movement of a right-click (two-finger tap / corner click) read as a scroll gesture and closed the freshly opened menu — a short window now tolerates small jitter scrolling right after open; a real scroll still closes it.
- [#56](https://github.com/windviki/vBookmarks/issues/56): the dark themes' blanket `brightness(1.5)` filter on every favicon is removed — the placeholder is already a fingerprint-replaced SVG, so the filter only overexposed real favicons.
- Custom CSS no longer fails silently: when the CodeMirror editor does not load (CSP-blocked, etc.), a native `textarea` change event persists the edit.
- Rapidly toggling the page right-click "Bookmark this page" switch no longer throws a "duplicate id" error — the remove→create cycle is serialized.
- A collapsed flyout flipped to the wrong side when the popup body was narrower than the viewport — horizontal placement now keys off `window.innerWidth`.
- The options-page tab-group collapse switch looked checked even though the feature is off by default (the stored `'0'` was read as truthy) — it now reflects the real state.

#### Polish

- The 6 new collapsed-submenu keys are translated across all 42 locales; the collapsed entries keep just the ▸ indicator.
- Developer tooling: `scripts` reorganized into harness / console / screenshots, the screenshot suite became a 4-theme matrix plus a 7-locale light i18n pass, console probes gained browser/platform identification, and the verify gate now also captures human-eye confirmation shots.

#### Changed

- Version bumped to **4.0.2** in `manifest.json` / `package.json`; the design docs move on to the 4.1.0 slate.

### v4.0.1

*2026-08-08*

#### New

- **Tab groups for folders & bookmarks**: "open all as a tab group" now creates/joins the group **in the service worker**, so closing the popup mid-flight no longer aborts it. The folder/bookmark context menus add **…and set name/color** (a new-group dialog with a title and nine Chrome-style color swatches) and **open into an existing group** (a picker of your current tab groups); old Chrome or a vanished group falls back to a plain open.
- **Dead-link batch delete**: the toolbar's red **Delete all** removes every row in the current filter (All / Dead / Blocked; the confirm shows the exact count); selection mode gains **Delete selected** — both run serially through the undo chain and end in one summary toast.
- **Folder sorting** ([#33](https://github.com/windviki/vBookmarks/issues/33)): the folder menu offers **Sort by name** / **Sort by date added** as direct commands (recursive folders append "(recursive)") beside **Sort options…**; a new options-page **Sorting** group edits the same persisted `sortOptions` (by / folders-first / recursive). Sorting physically reorders the bookmarks (survives restarts), and every sort — recursive ones included — is undoable via toast (Undo replays the pre-sort snapshot level by level).
- **Palette theme shortcuts** ([#44](https://github.com/windviki/vBookmarks/issues/44)): next to `/theme <name>`, the direct switches `/dark` `/light` `/ink` `/paper` apply a theme in one keystroke — the exact slash match now always wins the Enter row.
- **Page context-menu quick-add switch** ([#49](https://github.com/windviki/vBookmarks/issues/49)): the "Bookmark this page" entry is now an independent **Views** toggle (`quickAddContextMenu`) — off removes it from every page on the fly, and the *Restore the classic header* preset covers it too.
- **Stats view merges recent visits into one list**: bookmarked history rows merge into the main list wearing a solid ★ and their visit count in the pill; a toolbar **Show unbookmarked** checkbox (`statsShowUnbookmarked`) brings in the rest (one-click ☆ files them). The row end reads right-to-left: star → count pill → time.
- **Shared dropdown component**: the Duplicates strategy/scope selects become a custom dropdown with one keyboard protocol (`↓`/`Enter`/`Space` open, `Home`/`End` jump to the first/last option, `←`/`Esc` cancel, `Tab` applies) — the browser's native select no longer hijacks the arrows.

#### Fixed

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
- **Duplicates toolbar regression**: after opening the strategy/scope dropdown, `↓` from the button area could no longer enter the rows — a listbox option no longer steals the remembered-row `.focus` marker, and the toolbar rung's `↓` skips a marker parked inside a hidden listbox.
- **Menu actions and re-renders no longer strand keyboard focus**: every menu dispatch closes the menu and returns focus to the owning row *first*, and the dupes/stats/recent views plus the search-history area park/restore a focused row across their `innerHTML` swaps — "set as keeper", deleting a history row and similar actions leave the arrow keys live.
- The separator menu's lone "remove separator" entry used to be keyboard-unreachable by design — it is now bound to the menu walker and joins the `Tab` ring.

#### Polish

- One 16 px line-art SVG icon set: solid/hollow star (stats), flag + trash (dead marks/deletes), check (dupes apply); danger actions stay red.
- Dialogs: content width-capped and centered with a soft slide-in; the new-tab-group dialog gained breathing room and Chrome-style selected-color states.
- Dead-link toolbar reordered: scan time → filter segment **with counts** (All 2 · Dead 1 · Blocked 1) → rescan / mark-all / unmark-all / delete-all / select.
- Row metadata aligned across all list views: time column left, path column right.
- Root-folder menus disable the actions Chrome refuses (delete, rename, add before/after, separator) instead of erroring.
- **Keyboard interaction hardening** (menus, toolbar rungs, Home/End):
  - Context menus (all seven) wrap around on **every platform** — the old macOS no-wrap exception is gone — with `Home`/`End` jumping to the first/last enabled item.
  - A shared confirm/cancel protocol for menus and dropdowns: `→`/`Enter`/`Space` confirm, `←`/`Esc` cancel, mirrored under RTL; confirming on a bare menu container or a greyed item is a no-op.
  - Toolbar rungs cycle at their edges like the tab strip; the tab strip's `Home`/`End` are now **view-scoped** (the current view's first/last row — they no longer switch views), and a row-less view crosses out to its anchor instead of trapping focus.
- Dead-link proxy hint banner: the × sits top-right (aligned with the risk banner's close button) and the hint drops the "N direct failures" prefix.

#### Changed

- Version handling refactored into `src/version.js` (full `major.minor.patch` comparison, threshold "crossed into" checks); the release is **4.0.1 — a silent patch**, so existing 4.0 users don't get a "new version" card.
- Keyboard model hardening: menu walking skips disabled *and* CSS-hidden items; a new focus-regression suite gates cross-view focus hand-offs.
- **Risk-banner re-arm gate** is now major.minor-grained (it used to be major-only): a patch bump (4.0.0 → 4.0.1) stays silent, while 4.0 → 4.1 or 4 → 5 re-arms the banner once.
- **Dead-link proxy consolidation**: the legacy relay URL template (`deadProxyTemplate`) is retired — values stored by older versions are cleaned out of storage automatically on upgrade. The options page's *Dead scan* group now manages your proxy server in place (add / test / save / clear; saving runs parse → permission → control → reachability probe and rejects unreachable servers), and the view's add-a-proxy hint strip can be dismissed with × and brought back from the *Dead scan* group's checkbox (`hideDeadProxyStrip`).

### v4.0

*2026-08-02*

#### New

- **Six-view manager** — Tree / Search / Recent / Stats / Dead links / Duplicates behind an icon tab strip with live count badges, per-view visibility toggles and `Alt+1…6` jumps.
- **Search view** — dual-zone layout (history top / results below) with re-runnable search history.
- **Recent view** — coarse time groups and reveal-in-tree.
- **Local visit statistics** — background collector, recently-visited section, one-click starring.
- **Dead-link scanner** — dual-channel checks, progressive rendering, pause/resume/cancel and cross-view dead marks, running **in the service worker** so closing the popup mid-scan loses nothing. Its second channel now also supports **your own proxy server** (http/https/socks5): a one-click add button in the view's proxy strip validates the address and probes reachability (unreachable servers are rejected) before saving, change/remove live on the same strip, and the options page shows/clears the saved server. Routing uses a marker-matched temporary PAC so only the scanner's own probe URLs go through the proxy (other tabs untouched, settings restored on settle/cancel/popup close, crash residue swept by the service worker). The toolbar adds a dead·blocked summary line and a configure-a-proxy nudge when direct-failing rows have no proxy.
- **Duplicate cleaner** — URL normalization, six keeper strategies, will-delete preview, undoable batch deletion.
- **Risk banner** — both bulk tools show a one-time backup-first banner before first cleanup.
- **Command palette upgrades** — Go commands per view, `/theme <name>`, `/session`, `/options`, aliases, custom slash commands (URL/template/folder-group/view-preset, synced), search bridge row, auto-close on blur.
- **Options** — Views group, custom-commands group, settings backup/restore, responsive card layout.
- **Ink & Paper "fable" themes**; quick-add star button; sync status presentation rework (quiet dots, localized tooltips, `(Local)`/`(Synced)` root labels, blocked-drag toast, working "highlight unsynced" dimming).

#### Polish

- Selection modes in Dead links (batch mark/unmark) and Duplicates (batch group cleaning) with `Esc` to exit.
- `Tab`/`Shift+Tab` region cycling including in-list toolbars, with per-region focus memory.
- Duplicates member-row keys (`Enter` opens a copy, `←` returns to the group head) and group-head menus.
- Remember-last-view restore (default on) and count-badge, palette, quick-add and tool-button switches, plus a one-click *Restore the classic header* button.
- Options and advanced options merged into a single page (old URL redirects).
- Global quick-add shortcut (`Alt+Shift+S`).
- ARIA roles on all context menus, `aria-modal` dialogs with a focus trap.
- Lazy favicons; GitHub Actions CI.

#### Fixed

- Search field click-through and unreliable native clear button.
- Adding into collapsed folders is immediately visible.
- Copy title/URL via the async Clipboard API (`clipboardWrite` permission added).
- Non-empty folder deletion is confirm-gated again (with undo).

#### Changed

- Repository reorganized (`src/`, `pages/`, `css/`, `assets/`, `scripts/`); obsolete `release/` and MV2 leftovers removed (kept in git history).
- All icons are inline SVG now.
- Locale baseline grew to 306 keys with all 43 locales re-aligned through the `scripts/i18n.py` LLM pipeline.
- Test suite grew to 1303 cases across 40 suites; Docker harness extended with a keyboard/view verification suite and multi-theme, multi-language screenshot captures.
- The `proxy` permission is declared at install time (Chrome refuses it as an optional permission) and is exercised only while a configured proxy serves a running scan or the add-flow reachability probe — never when no proxy server is set or dead-link scanning is unused.


### v3.7

*2026-05-10*

#### New

- **New**: [#36](https://github.com/windviki/vBookmarks/issues/36): Add auto-resize popup toggle option. Enable/disable automatic popup height adjustment in General settings.
- **New**: Full 42-language support synced from cc-dev branch, all aligned with English baseline (75 keys). Languages: ar, bg, bn, cs, da, de, el, en, es, et, fa, fi, fr, he, hi, hr, hu, id, it, ja, ko, lt, lv, mk, nl, no, pl, pt, pt_BR, pt_PT, ro, ru, sk, sl, sv, th, tr, uk, vi, zh, zh_HK, zh_TW.

#### Fixed

- **Fixed**: [#42](https://github.com/windviki/vBookmarks/issues/42): Extension broken in Chrome 148 due to deprecated `<command>` HTML element. Replaced with `<div>` elements for full compatibility.

### v3.6

*2024-01-08*

#### Fixed

- **Fixed**: [#31](https://github.com/windviki/vBookmarks/issues/31): Custom icon not working.

### v3.5

*2023-09-04*

#### Fixed

- **Fixed**: [#29](https://github.com/windviki/vBookmarks/issues/29): cursor focus doesn't stay in search bar after clearing the search text.
- Fix shortcut in manifest. Now the default shortcut is Ctrl+Shift+V (Ctrl+Shift+B cannot work in new Chrome.)

### v3.4

*2023-02-14*

#### New

- **New**: Key Right to open context menu (when focus on an opened dir or a bookmark) and key Left to close it (when context menu is showing).

#### Polish

- Remove timeout of height reset. Speed up the popup.

#### Fixed

- **Fixed**: [#26](https://github.com/windviki/vBookmarks/issues/26): open directory in the background.

### v3.3

*2023-02-02*

#### New

- **New**: [#24](https://github.com/windviki/vBookmarks/issues/24): Add new option to disable incremental search (use ENTER to search).

#### Fixed

- **Fixed**: [#23](https://github.com/windviki/vBookmarks/issues/23): Incorrect link on the options page.
- **Fixed**: [#26](https://github.com/windviki/vBookmarks/issues/26): Middle/Ctrl click no longer opens bookmarks in the background in Chrome 107.
- **Fixed**: The stupid double scroll bar (finally).
- **Fixed**: Focus lost when quit from search mode.
- **Fixed**: Arrow down triggers an error in search mode.
- Fix some undefined errors.

#### Changed

- Update code to manifest V3. minimum_chrome_version = 88.

### v3.2

*2020-09-12*

#### New

- **New**: [#15](https://github.com/windviki/vBookmarks/issues/15): Search for folders in bookmark search bar.
- **New**: Resize the height of popup.
- **Added**: Italy language.
- **Added**: Russian language. Thanks for @Stanislav .

#### Fixed

- **Fixed**: [#19](https://github.com/windviki/vBookmarks/issues/19): "Add to the end of folder" feature does not work bugs.
- Fix some undefined errors.

#### Changed

- Update code to ecmascript version 6. minimum_chrome_version = 61.

### v3.1

*2020-07-03*

#### New

- **Added**: France language. Thanks for @Fab-fr.
- **Added**: Chinese Hong Kong language.

#### Fixed

- **Fixed**: [#12](https://github.com/windviki/vBookmarks/issues/12): Focus lost when clear the menu.
- **Fixed**: [#18](https://github.com/windviki/vBookmarks/issues/18): Tree does not scroll when drag to top or bottom.
- Fix an undefined error when pressing key DOWN.
- Fix the support of bookmarklet. Thanks for @ZG-nico.

### v3.0

*2019-08-22*

#### Fixed

- **Fixed**: New icons.

### v2.9

*2019-08-22*

#### Fixed

- **Fixed**: Double scrollbar since Chrome version 77+.

### v2.8

*2019-05-06*

#### New

- **Added**: Placeholder "\_\_VBM_CURRENT_TAB_URL\_\_" in bookmark URL to make some bookmarklets work (Chrome does not allow _document.location.href_ in BMlet). It will be replaced with URL of current active tab when you click BMlet from vBookmarks.

#### Polish

- **Improved**: Scrollbar CSS style.

#### Fixed

- **Fixed**: Open URL twice when clicked by middle button of mouse. https://github.com/windviki/vBookmarks/issues/9
- **Fixed**: Sometimes search will fail. https://github.com/windviki/vBookmarks/issues/7
- **Fixed**: Context menu position.

### v2.6

*2013-10-21*

#### Fixed

- **Fixed**: Remove double scroll bars.

### v2.5

*2013-08-30*

#### Fixed

- **Fixed**: Remove HTML notifications because it is not available now. https://bugs.webkit.org/show_bug.cgi?id=98388.

### v2.4

*2013-08-29*

#### Fixed

- **Fixed**: "Unexpected end of input" in js.

### v2.3

*2013-04-09*

#### Fixed

- **Fixed**: Context menu will be dismissed when scrolling up/down (broken again in previous version).
- **Fixed**: Remember position of scroll bar (broken again in previous version).

### v2.2

*2013-04-02*

#### Fixed

- **Fixed**: Scroll bar does not work above chrome 26+ (not well tested).

### v2.1

*2012-12-12*

#### New

- **Added**: Cancel button for dialogs in vbookmarks.

#### Polish

- **Improved**: Position of context menu. And context menu will be dismissed when scrolling up/down.

#### Fixed

- **Fixed**: Now it can remember and restore position of scroll bar correctly.

### v2.0

*2012-11-01*

#### New

- **Added**: Advanced options for separator.

#### Polish

- **Improved**: Synchronizable separators.

#### Fixed

- **Fixed**: Version checking in background.js.
- "The real title of bookmark which is shown as a separator": By default it is "|". That means the separators you added in vbookmarks will be shown as a normal bookmark in Chrome bookmark manager or bookmark menu, with this title value. You can modify it to "------------" so that you can split your bookmarks horizontally even if you check your bookmarks in Chrome bookmark menu.
- "The real URL of bookmark which is shown as a separator": By default it is "http://separatethis.com/". It's a "online separator". The separators you added in vbookmarks will be shown as a normal bookmark in Chrome bookmark manager or bookmark menu, with this URL value.
- "If URL of a bookmark contains this string, it will be shown as a separator": If you set this value (you can set several URLs joined by ";"), all bookmarks whose URL contains any of them will be shown as real separators in vbookmarks. e.g. if you set it to google.com, all google services in your bookmarks will be shown as separators.

### v1.9

*2012-08-19*

#### Polish

- **Updated**: Color of ICON.
- **Updated**: Style of separator.

#### Fixed

- **Fixed**: Neatbookmarks bug: Scrollbar will be reset to the top when opening and scrolling the popup down.

### v1.8

*2012-08-01*

#### New

- **Added**: Separators for bookmarks/folders. But it is a local record and cannot be synchronized between different devices. see https://github.com/windviki/vBookmarks/issues/3
- **Added**: Color of icon is changed to red.
- **Added**: Simple update checking and desktop notification.

#### Fixed

- **Fixed**: Neatbookmarks bug: Wrong position of dragged bookmark when vertical scrollbar is scrolled down (since Chrome18).

#### Changed

- **Removed**: Several languages. Only 4 locales are left: en, ja, zh, zh_TW. Cannot maintain many translations any more.

### v1.7

*2012-06-26*

#### Fixed

- **Fixed**: Double scrollbars in Chrome 19. Sorry for the previous untest release. I do not have many different Chromes in different versions :)
- **Fixed**: Width resetting occured when expanding root folder. https://github.com/windviki/vBookmarks/issues/2

### v1.6

*2012-06-24*

#### Fixed

- **Fixed**: Cannot search bookmarks in Omnibox (*+space). [Content Security Policy]
- **Fixed**: Restore width of the popup window. [Content Security Policy]
- **Fixed**: Dialogs cannot submit their forms. [Content Security Policy]

### v1.5

*2012-06-21*

#### Fixed

- **Fixed**: manifest problem in Chrome 20+.
- **Fixed**: separated script file instead of inline scripts. see Content Security Policy http://code.google.com/chrome/extensions/contentSecurityPolicy.html

### v1.4

*2012-06-20*

#### Fixed

- **Fixed**: Scrollbar problem in Chrome 18,19. https://github.com/windviki/vBookmarks/issues/2

### v1.3

*2012-05-25*

#### Fixed

- **Fixed**: Scrollbar glitch in Chrome 18,19. https://github.com/windviki/vBookmarks/issues/1

### v1.2

*2011-11-30*

#### New

- **Added**: update selected bookmark with current URL.
- **Added**: copy title and URL of selected bookmark to clipboard.

#### Fixed

- **Fixed**: after adding new bookmark or folder to a closed folder, its original children cannot be shown correctly.
- **Fixed**: make up some missing translations for cs(Czech).

### v1.1

*2011-11-16*

#### New

- **Added**: option for only displaying bookmarks in Bookmark Bar.
- **Added**: context menu for adding folder before/after bookmark/folder.

#### Fixed

- **Fixed**: some translations in multi-language support.

### v1.0

*2011-11-15*

#### New

- First version.

# Attentions

Installing from source ("Load unpacked") or the Web Store build is recommended. Legacy crx sideloading notes: above Chrome 20+, drag the crx file to `chrome://chrome/extensions/`; above Chrome 22+, add `--enable-easy-off-store-extension-install` to accept extensions from outside the Web Store (see [details](http://www.howtogeek.com/120743/how-to-install-extensions-from-outside-the-chrome-web-store/)).

Available on [WebStore](https://chrome.google.com/webstore/detail/vbookmarks/odhjcodnoebmndcihdedenkmdmklpihb) — the recommended way to use this extension.
