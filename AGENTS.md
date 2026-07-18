# AGENTS.md

Guidance for AI coding agents working on this repository. Assumes no prior knowledge of the project.

## Project Overview

**vBookmarks** is a Google Chrome extension (Manifest V3) that provides an enhanced bookmark manager in a toolbar popup: hierarchical bookmark tree, in-popup and omnibox search, context menus, keyboard navigation, drag & drop, bookmark separators, and bookmark sync-status indicators. It is a fork/successor of [Neat Bookmarks](https://github.com/cheeaun/neat-bookmarks), maintained by `windviki` and distributed via the Chrome Web Store. Licensed under MIT (`license.txt`).

- Current version: **3.7** (see `manifest.json`; `package.json` tracks the same version for dev tooling)
- Minimum Chrome version: **88** (Manifest V3)
- Tech stack: **plain ES6+ JavaScript — no framework, no bundler, no build step**. The repository root is the extension root (what "Load unpacked" points at).

## Repository Layout

Runtime code is grouped by kind: first-party JS in `src/`, extension pages in `pages/`, styles in `css/`, vendored third-party code in `vendor/`, images in `assets/` (this is also the layout of the shipped extension — page references use root-absolute paths like `/src/neat.js`). `manifest.json` and `_locales/` must stay at the extension root (Chrome requirement).

| File(s) | Role |
|---|---|
| `manifest.json` | MV3 manifest: `src/background.js` service worker (module), `pages/popup.html` action popup, `pages/sidepanel.html` side panel page (opt-in via the `openInSidePanel` setting; `side_panel.default_path` must not contain a query string — Chrome rejects it at install), `pages/options.html` options page, omnibox keyword `*`, permissions `bookmarks`, `tabs`, `favicon`, `storage`, `scripting`, `sidePanel`, `contextMenus`, host permissions `<all_urls>` |
| `src/background.js` | Service worker (ES module). Omnibox search (debounced 250 ms `chrome.bookmarks.search`, suggestion rendering, sync-status glyphs; ranking/highlight helpers imported from `./search-core.js`) plus side panel management: applies the `openInSidePanel` setting via `chrome.sidePanel.setPanelBehavior` at startup and on storage change (feature-detected, Chrome 114+), and the `open-side-panel` command (Alt+Shift+B) opens the panel. Also owns the `vbm-quick-add` page context menu (Phase 3, issue #30): created on install and at every SW startup (remove-then-create for idempotence), click saves the page into `quickAddFolderId` (default `'1'`) |
| `src/search-core.js` | Pure search helpers shared by `src/background.js` and the vitest suites: `rankBookmarks`, `xmlEncode`, `matcher` (no chrome.* references) |
| `src/separators.js` | Separator logic (P1 first module extracted from `src/neat.js`), pure ESM with zero chrome.*/DOM references: `StringList`, `isBlank`, `SeparatorManager` (storage mirror injected via constructor — directly unit-tested by `tests/separators.test.js`) |
| `src/dialogs.js` | Popup dialogs (P1 module): alert/confirm/edit/new-folder/sort dialogs + `#cover`/Escape close handling + global error alert. `initDialogs(ctx)` wires DOM after parse (`ctx.onSort` = folder reindex); pure `widont` exported. Unit-tested by `tests/dialogs.test.js` (DOM stub + real-module import) |
| `src/actions.js` | Popup action table (P1 module): all 13 bookmark/folder actions (open in tab/window/incognito, bulk-open with 10-item confirm threshold, edit via `dialogs`, delete with focus handoff, add-bookmark/folder/separator mutations, copy title+URL, replace-URL, bookmarklet `__VBM_CURRENT_TAB_URL__` substitution). `initActions(ctx)` receives `store`/`dialogs`/`search`/`separatorManager`/HTML builders; tested by `tests/actions.test.js` (DOM stub + chrome API doubles) |
| `src/context-menu.js` | Popup context menus (P1 module): bookmark/folder/separator right-click menus, item wiring to `actions`/`dialogs`, `switchBookmarkMenu` visibility rules, private `currentContext`. `initContextMenu(ctx)` returns `{ clearMenu(e?), switchBookmarkMenu(disable), bookmarkMenu, folderMenu, separatorMenu }`; initialized first in `src/neat.js` because `search` needs `switchBookmarkMenu` at init. Unit-tested by `tests/context-menu.test.js` |
| `src/keyboard.js` | Popup keyboard layer (P1 module): tree type-ahead buffer, `treeKeyDown`/`treeKeyUp` (arrow/Home/End/PageUp/PageDown/F2/Delete nav on `$tree` + search results), menu `contextKeyDown`, and the document-level Escape (close dialogs / quit search) + Ctrl/Cmd+F handlers. `initKeyboard(ctx)` receives `tree`/`search`/`actions`/`menus`/`dialogs`/`body`/`os`/`rtl` (all already initialized at its call site) and returns the three handlers for tests. No neatools inside. Unit-tested by `tests/keyboard.test.js` |
| `src/dnd.js` | Popup drag & drop (P1 module): tree mousedown drag start (rejects root folders / `data-virtual` recent entries), document mousemove drop-target tracking with `#bookmark-clone` ghost + `#drop-overlay` insertion line, edge auto-scroll, mouseup drop → `chrome.bookmarks.move` with cross-storage guard (`canMoveBetweenStorage` blocks synced↔local moves). `initDnd(ctx)` receives `tree`/`store`/`rtl`/`resetSeparator`; returns `{ isDragging(), consumeNoOpen() }` — the click handler and zoom read drag state through these. No neatools inside. Unit-tested by `tests/dnd.test.js` |
| `src/tree-render.js` | Tree HTML + data helpers (P1 module): `getFaviconUrl`, `highlightTitlePositions` (`<mark>` wrapping), row builders `generateBookmarkHTML`/`generateFolderHTML`/`generateSeparatorHTML` (sync indicators, `(Local)` suffix, separator color via pure `colorHex`), recursive `generateHTML` (open-state from ctx getters, lazy `getChildren` expand, `(Empty)` rows), and pure tree helpers `generateNodeTrees`/`getParentPath`/`findFolderByType`/`getEffectiveSubTree`/`isRootFolder` (dual-storage aware). `initTreeRender(ctx)` receives `store`/`separatorManager`/`getOpens`/`getRememberState` (getters, read at call time); neat.js feeds the builders into the search/actions ctx. No neatools inside. Unit-tested by `tests/tree-render.test.js` |
| `src/tree-view.js` | Tree view layer (P1 module): owns the tree DOM — `generateTree` (+ startup `getTree` bootstrap, focusID/scrollTop restore, legacy local-separator migration), tree events (scroll persist, focus tracking, click expand/collapse with lazy children + `closeUnusedFolders`, middle-click focus), the virtual "recently added" section (debounced refresh on create/remove), and `bookmarkHandler` (click/auxclick open semantics on tree + search results). `initTreeView(ctx)` receives `store`/`tree`/`separatorManager`/`SeparatorManager`/`treeRender`/`search`/`actions`/`dnd`/`refreshSyncIndicators`/open-state getters+setters/click-mode flags; returns `{ generateTree, adaptBookmarkTooltips }` (resizer + `sortFolderContents` call through it). `opens`/`rememberState` stay in neat.js, shared via ctx. No neatools inside. Unit-tested by `tests/tree-view.test.js` |
| `src/sync-ui.js` | Sync indicator wiring (P1 module): subscribes to SyncManager's `syncStatusChanged` window event and rebuilds the `.sync-indicator` badges on tree/search-result rows (`updateBookmarkSyncStatus`, `refreshSyncIndicators`). `initSyncUi({ store })` runs the wiring on init (DOMContentLoaded-aware) and keeps the legacy `window.neat.refreshSyncIndicators` surface. No neatools inside. Unit-tested by `tests/sync-ui.test.js` |
| `src/search.js` | Popup search (P1 module): owns `searchMode`, the lazily rebuilt flat fuzzy index (`window.VBMFuzzy.rank`), `<mark>` result rendering, saved-query restore, and all `#search-input` listeners. `initSearch(ctx)` returns `{ input, results, isActive(), quit(ignoreFocus), reset(), updateIndex(tree) }`; ctx injects `store`, `separatorManager`, `switchBookmarkMenu`, `generateBookmarkHTML`, `highlightTitlePositions`, `rememberState`. No neatools inside. Unit-tested by `tests/search.test.js` (DOM stub + real-module import) |
| `src/fuzzy.js` | Popup fuzzy search (Phase 2b), classic script exposing `window.VBMFuzzy`: fzf-style subsequence `score(query, text)` (consecutive/word-boundary/camelCase bonuses, case-insensitive incl. CJK) and `rank(query, items)` (title hits ×2, url hits ×1; score desc then dateAdded desc). Loaded by `pages/popup.html` before `src/neat.js` |
| `src/sort-utils.js` | Folder sorting (Phase 3, issue #33), classic script exposing `window.VBMSort`: pure `sortNodes(nodes, {by, foldersFirst, recursive})` — title order via `Intl.Collator(numeric, base)` or `dateAdded` desc, optional folders-first grouping, recursive returns a deep-copied ordered tree; never mutates the input. Loaded by `pages/popup.html` before `src/neat.js` |
| `pages/popup.html` / `src/popup.js` / `src/neat.js` | Main popup UI; `pages/sidepanel.html` is a copy of `pages/popup.html` whose `<body>` carries `panel-mode` (keep their script lists in sync — `tests/fuzzy.test.js` asserts parity). Panel mode: full height, no size restore/auto-resize, resizers hidden. `src/popup.js` restores popup size; `src/neat.js` (~700 lines) is the app-shell orchestrator, loaded as an ES module (`<script type="module">`; P1 split complete — separators/dialogs/popup-search/actions/context-menu/keyboard/dnd/tree-render/tree-view/sync-ui extracted to `src/separators.js` / `src/dialogs.js` / `src/search.js` / `src/actions.js` / `src/context-menu.js` / `src/keyboard.js` / `src/dnd.js` / `src/tree-render.js` / `src/tree-view.js` / `src/sync-ui.js`, and `src/neatools.js` is retired). What remains in neat.js: storage-ready bootstrap, i18n labels, RTL/OS/Chrome-version detection, donation, quick-add star (issue #30, `#quick-add-btn` + Ctrl/Cmd+D capture, solid star = already bookmarked → edit dialog), folder-content sorting (`sortFolderContents`, issue #33), resizers, auto-height (`resetHeight`), zoom, Mac/Chrome-536 workarounds, and the module wiring. Popup features living in the modules: fuzzy search over a lazily rebuilt flat index (`VBMFuzzy.rank`, `<mark>` highlight, no-results `.empty-state` row), `(Empty)` rows for childless folders (`.empty-folder`), context menus, dialogs, keyboard nav, drag & drop, separators, sync indicators, and the virtual "recently added" section (issue #34, `chrome.bookmarks.getRecent(20)`, `data-virtual` anchors excluded from drag sources/drop targets, `neat-recent-item-` li id prefix, toggle `showRecentBookmarks` default on, debounced refresh on create/remove) |
| `pages/options.html` / `src/options.js` / `css/options.css` | Settings page. Data-driven settings lists (`generalSettings`, `syncSettings` arrays) bound to storage |
| `pages/advanced-options.html` / `src/advanced-options.js` | Advanced settings: custom toolbar icon, separator customization, custom CSS (via CodeMirror), full reset |
| `vendor/codemirror.js` / `vendor/codemirror.css` | Vendored CodeMirror editor used only by the advanced options page |
| `src/store.js` | Unified storage entry point (`window.store`): in-memory mirror of `chrome.storage.local` with synchronous `get`/`set`/`remove`, one-time idempotent localStorage→chrome.storage migration (`__migrated_v1`), per-key 200 ms debounced persistence (flushed on `pagehide`), `clearAll()` for reset. A second mirror covers the sync area: `getSyncSetting`/`setSyncSetting` (500 ms debounce) for cross-device preferences (`SYNC_KEYS`). Also exposes async back-compat helpers `getSetting`/`setSetting`/`removeSetting` that talk to chrome.storage directly (pass `useSync=true` for the sync area). Replaces the old `storage.js` |
| `src/sync-manager.js` | `SyncManager` class: bookmark sync-status cache (5 min TTL), bookmark event listeners, undo stack for deletions (max 10), configurable auto-refresh (default 60 s, min 20 s), dual-storage (`folderType`/`syncing`) support. Loaded by `pages/popup.html` and `pages/sidepanel.html` |
| `css/sync-styles.css` | Styles for sync-status indicators |
| `css/neat.css` | Popup styles |
| `assets/icons/` | Images referenced by code/manifest (shipped): `icon.png`, `icon16.png`, `icon32.png`, `icon48.png`, `icon128.png`, `folder.png` (tree folders), `document-code.png` (`javascript:` bookmarklets) |
| `_locales/<lang>/messages.json` | 42 locales (`en` is the baseline, 101 keys); accessed via `chrome.i18n.getMessage()` and `__MSG_*__` in the manifest |

Supporting directories:

- `scripts/` — Python 3 tooling: `package.py` (release zip), `sync_locales.py` (locale sync), `check_translations.py` (translation quality report)
- `tests/` — Vitest unit tests
- `docs/` — `README.md` (EN) / `README.zh.md` (ZH) with full feature list and changelog, `CLAUDE.md` (similar guidance for Claude Code), `PLAN.md` (completed optimization plan), `bookmark-sync-changes.md` (Chrome bookmarks sync API changes reference), `评估与优化方案.md` (Chinese code evaluation), and the 2026-07 modernization analysis set: `现状分析-弹窗UI.md`, `现状分析-架构与存储.md`, `趋势调研-MV3平台与书签品类.md`, `现代化演进总方案.md` (phased roadmap). **Note:** the 2026-07-17 directory reorganization postdates the analysis docs — file paths in them refer to the old flat layout; this file is the current reference.
- `release/` — legacy `.crx` builds of old versions (historical artifacts, do not edit)
- `donation/` — donation page assets
- `assets/store/` — screenshots used only by the store listing / READMEs; `assets/design/` — design sources (`icon.psd`, `neat.xar`) and unused alternative icons; `legacy/` — dead MV2 artifacts (`background.html`, `checkupdate.json`). All three are excluded from packaging.

There is a `.gitignore` (ignores `node_modules/`), no lint config, and no CI configuration in the repo.

## Build, Test, and Development Commands

### Load for development

No build step. In Chrome: `chrome://extensions/` → enable Developer mode → **Load unpacked** → select the repo root. Reload the extension after edits.

### Unit tests

```bash
npm install        # installs vitest + sinon (devDependencies)
npm test           # vitest in watch mode
npm run test:run   # single run
```

Test files: `tests/store.test.js` (evaluates the real `src/store.js` in a sandbox with mocked chrome/localStorage — covers migration, mirror precedence, debounce, `clearAll`), `tests/search-core.test.js` (imports the real `src/search-core.js` — ranking, `xmlEncode`, `matcher`), `tests/fuzzy.test.js` (sandbox-evaluates the real `src/fuzzy.js` — subsequence matching, scoring bonuses, CJK, rank ordering/positions, 10k-item perf budget; plus Phase 2b CSS/wiring assertions), `tests/sort-utils.test.js` (sandbox-evaluates the real `src/sort-utils.js` — title/dateAdded ordering, numeric and case-insensitive collation, foldersFirst, recursive deep copy, input immutability; plus the `pages/popup.html` load-order assertion) and `tests/theme.test.js` (design-token and theme-locale contract).

### Packaging (deployment)

```bash
python3 scripts/package.py                 # writes release/vBookmarks_<version>.zip (version from manifest.json)
python3 scripts/package.py --output x.zip
```

The zip is for Chrome Web Store submission. The include/exclude lists at the top of `scripts/package.py` enumerate every runtime file (including `src/store.js`, `src/sync-manager.js`, `css/sync-styles.css`, `src/search-core.js`) — keep them in sync when adding or removing runtime files.

### Locale management

```bash
python3 scripts/sync_locales.py --check-only      # diff all locales against the en baseline (no changes)
python3 scripts/sync_locales.py --locale fr       # rewrite one locale to match en keys (missing keys become [TODO:key])
python3 scripts/sync_locales.py --branch cc-dev   # import translations from another git branch first
python3 scripts/check_translations.py             # report: over-long UI strings, wrong-script/empty values, missing placeholders
```

`check_translations.py` is report-only (it currently reports issues; it is not a gate). `mk`, `pt_BR`, and `pt_PT` currently lack 7 keys vs the `en` baseline (sync-options keys and `crossStorageMoveWarning`).

### Manual testing checklist (no automated E2E exists)

- Popup: open/expand/collapse folders, add/edit/delete/move bookmarks via context menus, drag & drop, separators
- Keyboard: arrows, Enter/Space, F2 rename, Ctrl+F search, Delete, Home/End, PageUp/Down
- Omnibox: type `*` + Space, search, Enter opens top result
- Options: toggles persist across popup reopen; zoom; auto-resize toggle; theme select (auto/light/dark); side panel opt-in
- Sync indicators and dual-storage behavior (see `docs/bookmark-sync-changes.md` for Chrome flags to test syncing/non-syncing subtrees)

### Headless smoke test (Docker)

A verified recipe lives outside the repo (`/tmp/vbm-smoke/smoke.js` pattern): image `zenika/alpine-chrome:with-puppeteer`, bake the extension in with a Dockerfile `COPY` (bind mounts do not work in some DinD setups), launch Chromium with `--load-extension=/ext` and `headless: 'new'` (old headless does not load extensions), then assert the service worker registers and popup/panel/options pages raise zero console errors. This caught two ship-blockers: `side_panel.default_path` rejects query strings, and `style-src 'self'` blocked all inline style attributes.

## Code Style and Conventions

- **4-space indentation**, ES6+ in newer code (`const`/`let`, arrow functions, `async`/`await`) — match the surrounding style of the file you edit.
- Page scripts are wrapped in an IIFE: `(window => { ... })(window)`; `src/background.js` uses `(() => { ... })()`. The extracted `src/*.js` P1 modules are plain ES modules exporting `initX(ctx)`.
- i18n alias at the top of each page script: `const _m = chrome.i18n.getMessage;` — use `_m('key')` for all user-visible strings; add new strings to `_locales/en/messages.json` first and run `scripts/sync_locales.py` to propagate keys.
- `src/neatools.js` is retired (P1): no prototype extensions, no global helpers anywhere. Element lookup uses `document.getElementById` — files that need it repeatedly declare a local `const $ = id => document.getElementById(id);` (see `src/neat.js`, `src/keyboard.js`, `src/options.js`); `htmlspecialchars`/`escapeRegExp`/`colorHex`/`uuidFast` live as module-private pure functions or named exports (`uuidFast` is exported from `src/separators.js`). UI labels are assigned in `initXxx()` functions on `DOMContentLoaded`, not in HTML.
- Sections in `src/neat.js` are delimited by `// Section` comments; historical author changes are wrapped in `// ++++++++ added/modified by windviki@gmail.com ++++++++` markers.
- **Settings storage is unified in `src/store.js` — be deliberate:**
  - Synchronous call sites (`src/neat.js`, `src/advanced-options.js`) use `store.get`/`store.set`/`store.remove` over the in-memory mirror, gated on `store.ready`.
  - Async code (`src/options.js`, `src/popup.js`) uses `await getSetting(key, defaultValue, useSync)` / `setSetting` / `removeSetting` (chrome.storage.local by default; pass `useSync=true` for sync settings).
  - Legacy `localStorage` values are migrated once into chrome.storage.local (`__migrated_v1` flag); localStorage originals are kept for now — do not reintroduce direct `localStorage` access.
- Commit history uses conventional-commit-style prefixes (`feat:`, `fix:`), in mixed Chinese/English.

## Security Considerations

- **CSP** in `manifest.json`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`. Scripts must live in files (no inline scripts/handlers). `style-src` intentionally allows `'unsafe-inline'`: the codebase uses inline style attributes for dynamic values (per-level tree indentation, separator color/width, user custom CSS injection) that cannot be expressed statically — keep `script-src 'self'` as the hard line.
- Permissions are broad (`<all_urls>` host access, `bookmarks`, `tabs`, `scripting`). Do not add permissions or broaden matches without clear need; changes trigger new permission warnings for all users.
- User-controlled text rendered into the omnibox must go through `xmlEncode` (`src/background.js`); HTML contexts use module-private `htmlspecialchars` helpers (e.g. `src/tree-render.js`, `src/search.js`). Preserve these escapes when editing rendering code.
- Bookmarklet support: `javascript:` bookmark URLs are executed in the active tab via `chrome.scripting.executeScript` with an injected `func` + `args` (`src/neat.js`, requires the `scripting` permission); the placeholder `__VBM_CURRENT_TAB_URL__` in a bookmark URL is replaced with the active tab's URL at click time — do not break this substitution.

## Known Quirks (verified — read before refactoring)

- `SyncManager.undoLastDeletion()` restores a deleted bookmark/folder but **not** a folder's children (documented limitation in code).
- `src/sync-manager.js` assumes a DOM (`document.addEventListener`, `window.dispatchEvent`); it is a popup-page script, not a service-worker module, despite also having a `module.exports` guard for tests.
- Sync-preference keys (`showSyncStatus`, `highlightUnsynced`, `autoRefreshSync`, `syncRefreshInterval`) live in chrome.storage.**sync** (toggles as `'true'/'false'` strings, interval as number). Pages read them via `store.getSyncSetting`; `src/sync-manager.js` normalizes both string and boolean forms on load.
