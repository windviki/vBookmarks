# AGENTS.md

Guidance for AI coding agents working on this repository. Assumes no prior knowledge of the project.

> **Progressive disclosure**: this file is the always-loaded orientation layer. Detailed references live in `docs/agents/` — follow the link when a task touches that area. When a behavior contract changes, update the detail file (it is the canonical layer); touch this file only when the grouping or a summary changes.
> - `docs/agents/modules.md` — per-module reference (the full Repository Layout table: every `src/` module, page and css file — role, behavior contracts, ctx wiring, quirks, and its test suite)
> - `docs/agents/testing.md` — unit-test conventions and `tests/helpers/` contracts, the Docker real-browser harness (smoke/keyboard/scrollbar gates + gotchas), manual testing checklist
> - `docs/agents/release.md` — release build/packaging detail, the two-step release process (git发布 + 商店发布 via the CWS API)
> - `docs/agents/i18n.md` — locale management flow (`scripts/i18n.py`, translate/verify gates)
> - `docs/agents/quirks.md` — verified known quirks, full text

## Project Overview

**vBookmarks** is a Google Chrome extension (Manifest V3) that provides an enhanced bookmark manager in a toolbar popup: hierarchical bookmark tree, in-popup and omnibox search, context menus, keyboard navigation, drag & drop, bookmark separators, and bookmark sync-status indicators. It is a fork/successor of [Neat Bookmarks](https://github.com/cheeaun/neat-bookmarks), maintained by `windviki` and distributed via the Chrome Web Store. Licensed under MIT (`license.txt`).

- Current version: **4.1.0** (see `manifest.json`; `package.json` tracks the same version for dev tooling)
- Minimum Chrome version: **114** (Manifest V3)
- Tech stack: **plain ES6+ JavaScript — no framework, no bundler, no dev build step**. The repository root is the extension root (what "Load unpacked" points at). Since 4.1.0 the **release** is built and packaged from `dist/` (`npm run build` → `npm run package`; see `docs/plan-4.1.0/build-and-performance-plan.md`) — dev stays build-free.

## Repository Layout

Runtime code is grouped by kind: first-party JS in `src/`, extension pages in `pages/`, styles in `css/`, vendored third-party code in `vendor/`, images in `assets/` (this is also the layout of the shipped extension — page references use root-absolute paths like `/src/neat.js`). `manifest.json` and `_locales/` must stay at the extension root (Chrome requirement).

Orientation map — the per-module detail table (behavior contracts, ctx wiring, quirks, the test suite for every module) lives in **`docs/agents/modules.md`**; read the row of any module before editing it:

- App shell: `src/neat.js` (~1000-line orchestrator) + `src/popup.js` (size/panel liveness); pages `pages/popup.html` / `pages/sidepanel.html` (script lists kept in sync — a test asserts parity) / `pages/options.html` (`src/options.js`, 20 sections) / `pages/favicons.html` (favicon gallery) / `pages/advanced-options.html` (redirect stub).
- Service worker: `src/background.js` (omnibox, side-panel behavior, commands, quick-add context menu, sync engine, visit-stats collector, dead-scan runner, proxy sweep, custom-icon restore) + `src/panel-behavior.js` / `src/sync-engine.js` / `src/visit-stats-sw.js` / `src/dead-scan-sw.js` / `src/tab-groups-sw.js`.
- Popup feature modules (P1 extraction, `initX(ctx)` ES modules): `separators` / `dialogs` / `search` / `actions` / `context-menu` / `keyboard` / `dnd` / `tree-render` / `tree-view` / `sync-ui`, plus `list-focus.js` (shared focus park/restore), `list-chunks.js` (chunked row streaming), `virtual-list.js` (4.1.1 实验室 virtualized painter) and `dropdown.js` (shared custom dropdown).
- View system: `view-manager.js` + the seven views (tree/search structural + `view-tabgroups` / `view-recent` / `view-stats` / `view-dead` / `view-dupes`), `palette.js` + `palette-commands.js` (⌘K palette + custom commands), `risk-banner.js`.
- Favicon stack: `icons.js` (inline SVG) / `favicon-fallback.js` (placeholder + contrast flip) / `favicon-enrich.js` (L1–L4 discovery + cache) / `favicon-gallery.js`.
- Feature logic (pure/pure-ish): `dupes.js`, `dead-links.js` + `dead-proxy.js`, `sort-utils.js` + `folder-sort.js`, `session.js`, `undo.js`, `visit-stats.js`.
- Infra: `store.js` (unified storage, area-transparent sync routing), `settings.js`, `escape.js` (single `htmlspecialchars` source), `search-core.js` + `fuzzy-core.js` + `fuzzy.js` (one shared fuzzy ranker for omnibox/popup/palette), `version.js` / `version-info.js`, `i18n-live.js`, `userstyle.js`, `idle.js`, `resize-core.js` / `resize.js`, `startup-flags.js`, `quick-add.js` / `tool-button.js` / `wake-up.js`, `announce.js` / `github-source.js` / `github-mirrors.js`, `storage-usage.js`, `options-palette-commands.js` / `options-proxy.js`, `sync-manager.js` (page-side sync client).
- `css/` — `neat.css` (popup), `sync-styles.css` (sync indicators), `options.css`, `favicons.css`; `vendor/` — CodeMirror for the retired advanced page; `_locales/<lang>/messages.json` — 43 locales (`en` baseline), `chrome.i18n.getMessage()` + `__MSG_*__`.

Supporting directories:

- `scripts/` — Python 3 tooling: `package.py` (release zip; `--target chrome|edge|firefox` — edge repackages the same content under a distinct name, firefox prints the docs/browser-compat.md evaluation and exits 1), `i18n.py` (unified locale tooling: audit/missing/translate/verify)
- `tests/` — Vitest unit tests
- `docs/` — `README.md` (EN) / `README.zh.md` (ZH) with full feature list and changelog, `guide-v4.md` / `guide-v4.zh.md` (the v4 feature guide: keyboard model, per-view walkthrough, classic-look recipe — screenshots in `docs/images/guide/`), `keyboard-model.md` (the authoritative v4 keyboard design: zone stack, arrow-key laws, the Esc layer cake, the Tab ring and the option-combination adaptation matrix — guide-v4 §2 is its user summary), `palette-commands-design.md` (user-defined palette commands — implemented in v4 task-4 #6 apart from the roadmap items its §9 marks deferred), `plan-4.1.0/tab-groups-view-design.md` (the 4.1.0 tab-groups view design), `plan-4.1.0/build-and-performance-plan.md` (4.1.0 dist 构建与性能改造方案， M1–M4 + P1 已全部实施， 验收记录见其附录 C), `browser-compat.md` (v4 task-4 #12: Edge runs the same MV3 package as-is, Firefox needs a bundling + feature-degrade pass — the blockers and the future path), `cdp-escape-limitation.md` (why no Esc tests exist in the Docker tier), `review-4.0.1/` (the 4.0.1 overall-polish review archive: master plan with the decision record + eight area reports, the reference for what the 4.0.1 fix batches changed and why), `CLAUDE.md` (pointer here for Claude Code), `bookmark-sync-changes.md` (Chrome bookmarks sync API changes reference), and the 2026-07 modernization analysis set: `现状分析-弹窗UI.md`, `现状分析-架构与存储.md`, `趋势调研-MV3平台与书签品类.md`, `现代化演进总方案.md` (phased roadmap), plus the archived task/plan sets: `plan-4.0.0/` (`v4task-1.md` executed v4 plan; `v4task-2.md` + `v4task-2-list.md` view-system design and its list-row specs — implemented in slices A–E; `v4task-3.md`; `v4task-4.md`), `plan-velvet/` (`velvet-task-1.md` + its `-ds/-k3/-glm53/-final` design set + `velvet-task-2-k3.md` (the velvet visual-leap plan re-baselined to 4.1.0 HEAD — ✅/🟡/⬜ status audit) + `velvet-feat-staging.md` (the staging-area feature version upgrading the recent view, lands independently before velvet); codename velvet, target release version originally 4.1.0 and currently TBD), `review-4.0.0/` (`view-system-合并评估报告.md` — the 2026-07-29 master-vs-view-system branch comparison and absorption record), `issues/` (`issue-53-57-iguge-conflict.md`, `issues-46-48-feedback.md`). **Note:** the 2026-07-17 directory reorganization postdates the analysis docs — file paths in them refer to the old flat layout; this file is the current reference. Obsolete artifacts (old `release/*.crx`, `legacy/` MV2 files, `PLAN.md`, `评估与优化方案.md`) were dropped at v4.0 and live in git history.
- `docs/agents/` — the progressive-disclosure reference layer of this file: `modules.md` (per-module detail table), `testing.md` (unit tests + Docker harness), `release.md` (build/package/publish), `i18n.md` (locale flow), `quirks.md` (known quirks). Update these when the corresponding behavior changes.
- `donation/` — donation page assets
- `assets/store/` — screenshots used only by the store listing / READMEs; `assets/design/` — design sources (`icon.psd`, `neat.xar`) and unused alternative icons. Both excluded from packaging.

There is a `.gitignore` (ignores `node_modules/`), and an ESLint flat config (`eslint.config.js`, v8 via `ESLINT_USE_FLAT_CONFIG=true`, error-level gate: `no-undef` + `no-extra-boolean-cast` on `src/`, plus the vitest recommended rules on `tests/` — `vitest/valid-expect` is configured with `maxArgs: 2` because vitest's `expect(actual, message)` is valid, and `vitest/expect-expect` names the assertion helpers `assertProps`/`ruleBody`/`zIndexOf`/`extractBlock` that assert internally in the CSS contract suites). `npm run lint` runs it; a GitHub Actions CI at `.github/workflows/ci.yml` (since 4.0 — on push/PR it runs the vitest suites, the eslint lint gate, `i18n.py missing`/`verify`, the dist build (`npm run build`) and dist packaging (`package.py --root dist`), and two real-browser smoke jobs — `scripts/harness/run.sh --smoke-only` (source root) and `scripts/harness/run.sh --dist --smoke-only` (dist release tree) that catches load-time crashes the unit suites cannot — see the Release process Step 0).

## Build, Test, and Development Commands

### Load for development

Dev needs no build step. In Chrome: `chrome://extensions/` → enable Developer mode → **Load unpacked** → select the repo root (the dev form). Reload the extension after edits. The release form is `dist/` — `npm run build`, then Load unpacked `dist/` (or `npm run package` for the store zip); see `docs/plan-4.1.0/build-and-performance-plan.md`.

### Unit tests

```bash
npm install        # installs vitest + sinon (devDependencies)
npm test           # vitest in watch mode
npm run test:run   # single run
```

One suite per module/feature (~79); each module's row in `docs/agents/modules.md` names its own suite. Harness patterns: sandbox-eval for classic scripts, direct ESM import with chrome.*/DOM doubles on `globalThis` for the rest; shared stubs live in `tests/helpers/` (`dom`/`i18n`/`chrome`/`boot`/`classic` — use them in NEW tests). **Never copy the implementation under test into a test** — drive the real module; extract pure logic into a real module when it can't be imported (see "操作即模块" in Code Style). Full suite inventory, helper contracts and pitfalls: `docs/agents/testing.md`. `npm run lint` (ESLint flat config) is the lint gate.

### Build & packaging (release)

Since 4.1.0 the release form is `dist/` (esbuild bundle + Terser minify; the dev flow stays build-free):

```bash
npm run build            # dist/ + build-time self-checks
npm run package          # build + zip from dist/ → tmp/vBookmarks_<version>.zip
python3 scripts/package.py --root dist    # zip from an existing dist/ (no rebuild)
```

Runtime file lists live in `scripts/runtime-files.json` — the single source of truth shared by `build.mjs` and `package.py` (keep it in sync when adding or removing runtime files). Detail (import-graph resolution, `--target` flags, dev-form zip): `docs/agents/release.md`.

### Locale management

`scripts/i18n.py` (stdlib only) is the single entry point: `audit` (code refs vs en keys), `missing` (per-locale report), `translate --locale fr --apply` (LLM-fills pending keys), `verify` (release gate — must be 0 errors). When adding **or modifying** a key: real translation in `en` + `zh_CN`, `[TODO:key]` placeholders **in place** (never reorder keys) in the other locales, then `translate --apply` + `verify` before every commit/packaging — TODO placeholders are an intermediate state, never a deliverable one. LLM endpoint config (`VBM_LLM_*` env / git-ignored `.env`), placeholder-integrity rules and menu-length warnings: `docs/agents/i18n.md`.

### Release process (发布流程 = git发布 + 商店发布)

One process, two sequential steps — full detail in `docs/agents/release.md`:

- **Step 0 — smoke gate (发版前置必跑)**: `scripts/harness/run.sh --smoke-only` (source root), `--dist --smoke-only` (dist tree), `--dist` (full harness — 强制门禁). The vitest suites never import `src/neat.js`, so only the real-browser gate catches init-time crashes; the same smokes run in CI on every push/PR. Harness internals + gotchas: `docs/agents/testing.md`.
- **Step 1 — git发布**: current version (`manifest.json`) must exceed the highest `v*` tag → bilingual changelog in `docs/README.md` + `docs/README.zh.md` (gap-fill, don't rewrite; basis = commits since the previous tag) → commit → `git tag v<version>` → `npm run package` → push commits + tag.
- **Step 2 — 商店发布**: `node scripts/webstore/publish.js check` first (offline-verifies Step 1), then `upload --yes` / `publish --yes` (dry-run by default; credentials only in the git-ignored `.env`; `npm run test:webstore` is the offline contract test).

### Manual checklist & real-browser harness

No full E2E — the Docker harness covers the automated smoke/keyboard/scrollbar gates. The manual popup/keyboard/omnibox/options checklist, the harness layer inventory (`smoke.js` / `verify-keyboard.js` / `verify-scrollbars.js` / screenshot suites) and the hard-won DinD/CDP gotchas all live in `docs/agents/testing.md`.

## Code Style and Conventions

- **4-space indentation**, ES6+ in newer code (`const`/`let`, arrow functions, `async`/`await`) — match the surrounding style of the file you edit.
- Page scripts are wrapped in an IIFE: `(window => { ... })(window)`; `src/background.js` uses `(() => { ... })()`. The extracted `src/*.js` P1 modules are plain ES modules exporting `initX(ctx)`.
- **操作即模块(2026-08 测试审计确立的规范)**:任何新的弹窗用户操作,第一步把**纯逻辑**提到 `src/` 下可导入的 ES 模块(参照 P1 模式),neat.js 只做薄接线——依赖在 neat.js 下方声明的值用 lazy getter(`get undo() { return undo; }`)解决 TDZ。每提取一个模块必须带测试;禁止在 neat.js 里堆内联闭包(那会让操作重新变成"复制内核"伪测试)。现有提取示例:`resize-core`(尺寸/缩放内核)、`folder-sort`(排序执行器)、`quick-add`(星标+Ctrl+D)、`donation`(捐赠卡)、`tool-button`、`wake-up`(面板全局唤醒)。
- i18n alias at the top of each page script: `const _m = chrome.i18n.getMessage;` — use `_m('key')` for all user-visible strings; add new strings to `_locales/en/messages.json` first and follow the Locale management flow (`scripts/i18n.py`).
- `src/neatools.js` is retired (P1): no prototype extensions, no global helpers anywhere. Element lookup uses `document.getElementById` — files that need it repeatedly declare a local `const $ = id => document.getElementById(id);` (see `src/neat.js`, `src/keyboard.js`, `src/options.js`); `escapeRegExp`/`colorHex` live as module-private pure functions, while `htmlspecialchars`/`uuidFast` are named exports of shared modules (`src/escape.js` — the single escaping source of truth since 4.0.5 — and `src/separators.js`). UI labels are assigned in `initXxx()` functions on `DOMContentLoaded`, not in HTML.
- Sections in `src/neat.js` are delimited by `// Section` comments; historical author changes are wrapped in `// ++++++++ added/modified by windviki@gmail.com ++++++++` markers.
- **Settings storage is unified in `src/store.js` — be deliberate:**
  - Synchronous call sites (`src/neat.js`; the merged advanced-settings half of `src/options.js` — custom icon/separator/custom CSS/dead-scan tuning) use `store.get`/`store.set`/`store.remove` over the in-memory mirror, gated on `store.ready`.
  - Async code (the data-driven settings lists in `src/options.js`, `src/popup.js`) uses `await getSetting(key, defaultValue, useSync)` / `setSetting` / `removeSetting` (chrome.storage.local by default; pass `useSync=true` for sync settings).
  - Legacy `localStorage` values are migrated once into chrome.storage.local (`__migrated_v1` flag); localStorage originals are kept for now — do not reintroduce direct `localStorage` access.
- Commit history uses conventional-commit-style prefixes (`feat:`, `fix:`), in mixed Chinese/English.
- **按任务粒度就地提交**(用户明确要求):一个任务/修复批次完成并通过验证后立即本地 commit,绝不攒到一大批文件互相干扰后最后才提交;批次边界跟随功能区域,提交信息写清条目编号(如 K1、C19、#50)。

## Security Considerations

- **CSP** in `manifest.json`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`. Scripts must live in files (no inline scripts/handlers). `style-src` intentionally allows `'unsafe-inline'`: the codebase uses inline style attributes for dynamic values (per-level tree indentation, separator color/width, user custom CSS injection) that cannot be expressed statically — keep `script-src 'self'` as the hard line.
- Permissions are broad (`<all_urls>` host access, `bookmarks`, `tabs`, `scripting`). Do not add permissions or broaden matches without clear need; changes trigger new permission warnings for all users.
- User-controlled text rendered into the omnibox must go through `xmlEncode` (`src/background.js`); HTML contexts use the single shared `htmlspecialchars` from `src/escape.js` (4.0.5 — previously nine verbatim module-private copies across the rendering modules). Preserve these escapes when editing rendering code.
- Bookmarklet support: `javascript:` bookmark URLs are executed in the active tab via `chrome.scripting.executeScript` with an injected `func` + `args` (`src/neat.js`, requires the `scripting` permission); the placeholder `__VBM_CURRENT_TAB_URL__` in a bookmark URL is replaced with the active tab's URL at click time — do not break this substitution.

## Known Quirks (verified — read before refactoring)

Full text: `docs/agents/quirks.md`. The four that most often bite:

- Deletion undo (`src/undo.js`): session-storage subtree snapshots restored depth-first; a failed restore consumes the stack entry without rollback (by design). Non-empty folder deletes are ConfirmDialog-gated again (`confirmDeleteFolder`, default on; empty folders and bookmark rows go straight to the toast).
- Sync status is computed ONLY in the service worker (`src/sync-engine.js`); pages mirror the published blob. `node.syncing` needs Chrome 138+ — below it the engine reports `''` (genuinely unknown) and never fabricates `synced`. `chrome.alarms` rejects periods < 0.5 min, so the `syncRefreshInterval` option floor is 30 s.
- Sync-preference keys live in chrome.storage.sync (store.js `SYNC_KEYS`, ~44 device-independent preferences); access is area-transparent — call sites never name an area. Bookmark-id-keyed data (`quickAddFolderId`, `separators*`, `deadMarks*`, `visitStats`) and oversized values (`customIcon`) deliberately stay local.
- **iGuge conflict (issues #53/#57)**: the iGuge extension actively disables any extension declaring the `proxy` permission that is not on its whitelist — so with both installed, vBookmarks is re-disabled on every Chrome restart. Decision (2026-08): **keep the feature and coordinate whitelisting — do NOT remove the `proxy` permission**. Full analysis: `docs/issues/issue-53-57-iguge-conflict.md`.
