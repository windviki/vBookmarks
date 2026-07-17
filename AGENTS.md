# AGENTS.md

Guidance for AI coding agents working on this repository. Assumes no prior knowledge of the project.

## Project Overview

**vBookmarks** is a Google Chrome extension (Manifest V3) that provides an enhanced bookmark manager in a toolbar popup: hierarchical bookmark tree, in-popup and omnibox search, context menus, keyboard navigation, drag & drop, bookmark separators, and bookmark sync-status indicators. It is a fork/successor of [Neat Bookmarks](https://github.com/cheeaun/neat-bookmarks), maintained by `windviki` and distributed via the Chrome Web Store. Licensed under MIT (`license.txt`).

- Current version: **3.7** (see `manifest.json`; note `package.json` still says 3.6.0 — it is only used for dev tooling)
- Minimum Chrome version: **88** (Manifest V3)
- Tech stack: **plain ES6+ JavaScript — no framework, no bundler, no build step**. All runtime files are plain scripts sitting at the repository root.

## Repository Layout

Runtime code lives flat in the repo root (this is also the layout of the shipped extension):

| File(s) | Role |
|---|---|
| `manifest.json` | MV3 manifest: `background.js` service worker (module), `popup.html` action popup, `options.html` options page, omnibox keyword `*`, permissions `bookmarks`, `tabs`, `favicon`, `storage`, `identity`, host permissions `<all_urls>` |
| `background.js` | Service worker. Omnibox search only: debounced (250 ms) `chrome.bookmarks.search`, result ranking (`rankBookmarks`), suggestion rendering (`xmlEncode`, `matcher`), sync-status glyphs |
| `popup.html` / `popup.js` / `neat.js` | Main popup UI. `popup.js` restores popup size; `neat.js` (~3200 lines) is the application monolith: tree rendering, search, context menus, dialogs, keyboard nav, drag & drop, separators, sync indicators |
| `neatools.js` | "Neatools": tiny MooTools-inspired helper library — global `$` (= `getElementById`), `$extend`, `$each`, and `String`/`Array`/`Element` prototype extensions. Loaded first by every page |
| `options.html` / `options.js` / `options.css` | Settings page. Data-driven settings lists (`generalSettings`, `syncSettings` arrays) bound to storage |
| `advanced-options.html` / `advanced-options.js` | Advanced settings: custom toolbar icon, separator customization, custom CSS (via CodeMirror), full reset |
| `codemirror.js` / `codemirror.css` | Vendored CodeMirror editor used only by the advanced options page |
| `storage.js` | `StorageManager` class + global async `getSetting`/`setSetting` helpers over `chrome.storage.local`/`chrome.storage.sync` |
| `sync-manager.js` | `SyncManager` class: bookmark sync-status cache (5 min TTL), bookmark event listeners, undo stack for deletions (max 10), configurable auto-refresh (default 60 s, min 20 s), dual-storage (`folderType`/`syncing`) support. Loaded only by `popup.html` |
| `sync-styles.css` | Styles for sync-status indicators |
| `neat.css` | Popup styles |
| `_locales/<lang>/messages.json` | 42 locales (`en` is the baseline, 82 keys); accessed via `chrome.i18n.getMessage()` and `__MSG_*__` in the manifest |

Supporting directories:

- `scripts/` — Python 3 tooling: `package.py` (release zip), `sync_locales.py` (locale sync), `check_translations.py` (translation quality report)
- `tests/` — Vitest unit tests
- `docs/` — `README.md` (EN) / `README.zh.md` (ZH) with full feature list and changelog, `CLAUDE.md` (similar guidance for Claude Code), `PLAN.md` (completed optimization plan), `bookmark-sync-changes.md` (Chrome bookmarks sync API changes reference), `评估与优化方案.md` (Chinese code evaluation), and the 2026-07 modernization analysis set: `现状分析-弹窗UI.md`, `现状分析-架构与存储.md`, `趋势调研-MV3平台与书签品类.md`, `现代化演进总方案.md` (phased roadmap)
- `release/` — legacy `.crx` builds of old versions (historical artifacts, do not edit)
- `donation/` — donation page assets
- `background.html`, `checkupdate.json`, `neat.xar`, `icon.psd`, screenshots — legacy/source files, excluded from packaging

There is no `.gitignore`, no lint config, and no CI configuration in the repo.

## Build, Test, and Development Commands

### Load for development

No build step. In Chrome: `chrome://extensions/` → enable Developer mode → **Load unpacked** → select the repo root. Reload the extension after edits.

### Unit tests

```bash
npm install        # installs vitest + sinon (devDependencies)
npm test           # vitest in watch mode
npm run test:run   # single run
```

Currently one test file (`tests/utils.test.js`, 2 tests, passing). Note: the tests **re-implement copies** of `debounce`/`rankBookmarks` and mock the global `chrome` object — `background.js` is an IIFE, not an importable module, so its internals cannot be imported directly.

### Packaging (deployment)

```bash
python3 scripts/package.py                 # writes release/vBookmarks_<version>.zip (version from manifest.json)
python3 scripts/package.py --output x.zip
```

The zip is for Chrome Web Store submission. Known gaps in the current script (verified): it **omits `storage.js`, `sync-manager.js`, and `sync-styles.css`** (all loaded by `popup.html`), its README paths are stale (READMEs now live in `docs/`), and `node_modules/` is not excluded — run it before `npm install` or fix the include/exclude lists at the top of `scripts/package.py` when touching packaging.

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
- Options: toggles persist across popup reopen; zoom; auto-resize toggle
- Sync indicators and dual-storage behavior (see `docs/bookmark-sync-changes.md` for Chrome flags to test syncing/non-syncing subtrees)

## Code Style and Conventions

- **4-space indentation**, ES6+ in newer code (`const`/`let`, arrow functions, `async`/`await`); `neat.js`/`neatools.js` retain older prototype-based patterns — match the surrounding style of the file you edit.
- Page scripts are wrapped in an IIFE: `(window => { ... })(window)`; `background.js` uses `(() => { ... })()`.
- i18n alias at the top of each page script: `const _m = chrome.i18n.getMessage;` — use `_m('key')` for all user-visible strings; add new strings to `_locales/en/messages.json` first and run `scripts/sync_locales.py` to propagate keys.
- Use `$` (from `neatools.js`) for element lookup; UI labels are assigned in `initXxx()` functions on `DOMContentLoaded`, not in HTML.
- Sections in `neat.js` are delimited by `// Section` comments; historical author changes are wrapped in `// ++++++++ added/modified by windviki@gmail.com ++++++++` markers.
- **Settings storage is mid-migration — be deliberate:**
  - Newer code (`options.js`, `popup.js`) uses `await getSetting(key, defaultValue, useSync)` / `setSetting` from `storage.js` (local storage by default; pass `useSync=true` for sync settings).
  - Legacy code (`neat.js`, `advanced-options.js`) still reads/writes `localStorage` directly (89 references in `neat.js`). Do not mix the two for the same key; follow the existing mechanism for the key you touch.
- Commit history uses conventional-commit-style prefixes (`feat:`, `fix:`), in mixed Chinese/English.

## Security Considerations

- **Strict CSP** in `manifest.json`: `default-src 'self'; style-src 'self'; img-src 'self' data:`. No inline scripts, inline styles, or inline event handlers — all JS/CSS must live in files. This is why HTML pages load scripts via `<script src>` at the end of the body.
- Permissions are broad (`<all_urls>` host access, `bookmarks`, `tabs`, `identity`). Do not add permissions or broaden matches without clear need; changes trigger new permission warnings for all users.
- User-controlled text rendered into the omnibox must go through `xmlEncode` (`background.js`); HTML contexts use `htmlspecialchars` (`neatools.js`). Preserve these escapes when editing rendering code.
- Bookmarklet support: the placeholder `__VBM_CURRENT_TAB_URL__` in a bookmark URL is replaced with the active tab's URL at click time (`neat.js`) — do not break this substitution.
- `advanced-options.js` still uses the deprecated `chrome.extension.sendRequest` in its `window.onerror` handler (known legacy; `options.js` already uses `chrome.runtime.sendMessage`).

## Known Quirks (verified — read before refactoring)

- `storage.js` contains its entire content **duplicated** — two full copies, each with a top-level `class StorageManager` declaration (lines 6 and 94). This is a **parse-time `SyntaxError`** (`Identifier 'StorageManager' has already been declared`, verified with `node --check`), so the whole file fails to execute and `getSetting`/`setSetting` never exist — `popup.js` and `options.js` init crash as a result. Deduplicate to a single copy; this is a P0 fix tracked in `docs/现代化演进总方案.md` (Phase 0).
- `options.js` manages the `autoResizePopup` setting both in the data-driven `generalSettings` array (chrome.storage) **and** in a separate block that writes `localStorage.autoResizePopup` — an inconsistency to be aware of.
- `SyncManager.undoLastDeletion()` restores a deleted bookmark/folder but **not** a folder's children (documented limitation in code).
- `sync-manager.js` assumes a DOM (`document.addEventListener`, `window.dispatchEvent`); it is a popup-page script, not a service-worker module, despite also having a `module.exports` guard for tests.
- The packaged zip currently misses runtime files (see Packaging above) — verify zip contents if you release.
