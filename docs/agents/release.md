# Release: Build, Package & Publish (detail)

> Extracted verbatim from `AGENTS.md` — the detailed halves of "Build (release)", "Packaging (deployment)" and "Release process". `AGENTS.md` keeps the command summary and the step outline.

## Build & Packaging

Since 4.1.0 the release form is `dist/` (esbuild bundle + Terser minify, same-path structure — the dev flow stays build-free):

```bash
npm run build            # dist/ + build-time self-checks (fails on contract breaks; see docs/plan-4.1.0/build-and-performance-plan.md §3.1)
npm run package          # build + zip from dist/ → tmp/vBookmarks_<version>.zip
python3 scripts/package.py --root dist    # zip from an existing dist/ (no rebuild)
python3 scripts/package.py --output x.zip # custom output path
```

### Packaging (deployment)

```bash
npm run package                            # 4.1.0+ default: build dist/ then zip it → tmp/vBookmarks_<version>.zip
python3 scripts/package.py --root dist     # zip from an existing dist/ (no rebuild)
python3 scripts/package.py                 # source-root zip (dev form, 134 files — legacy/对照)
```

The zip is for Chrome Web Store submission. Runtime file lists live in `scripts/runtime-files.json` — the single source of truth shared by `build.mjs` and `package.py` (keep it in sync when adding or removing runtime files). The JS seed is `classicJs + esmEntries` (15 files); `resolve_js_imports` walks the import graph recursively (`IMPORT_RE` matches static `from`/`import '…'` and dynamic `import('…')` alike), so a module reachable only through imports — e.g. `src/dropdown.js`, pulled in by `src/view-dupes.js` — ships without being listed in source-root mode; dist bundles contain no imports, so nothing is added there (78 files). An unresolvable target prints a WARNING.

## Release process (发布流程 = git发布 + 商店发布)

The release is **one process with two sequential steps**. **git发布** prepares version / changelog / tag / package and pushes; **商店发布** uploads the packaged zip to the Chrome Web Store via the CWS API **V2** and submits it for review. Store publishing requires git发布 to have been executed for the same version — enforced automatically by the pre-check in `scripts/webstore/publish.js` (见 Step 2)。

**Step 0 — 加载冒烟门禁 (release smoke, 发版前置必跑)**: the vitest suites never import `src/neat.js` (the app shell), so an init-time crash (e.g. a TDZ/ReferenceError) passes `npm run test:run` green and only surfaces when the extension actually loads. **Before tagging**, run the real-browser smoke — this is the gate for "the popup loads with zero console errors". Since 4.1.0 the release is the dist tree, so the gate is three stages:

```bash
scripts/harness/run.sh --smoke-only          # source root (dev form)
scripts/harness/run.sh --dist --smoke-only   # dist release tree (4.1.0+)
scripts/harness/run.sh --dist                # full dist harness — 4.1.0 发版强制门禁
```

(Full harness `scripts/harness/run.sh` adds the keyboard/scrollbar/menu verify layers. The same smokes run in CI on every push/PR.)

**Step 1 — git发布**(repo-side: version bump → changelog → commit → tag → package → push):

- **商店图重拍(视觉有改动时必跑)**: `scripts/screenshots/update-store-assets.sh` — Docker 重跑 `shots-store.js`,同步八张产物进 `assets/store/`(五张 1280×800 截图固定清单 promo / promo2 / promo3 / strip / options + 候选 themes + 品牌宣传图块 marquee 1400×560 与 tile-small 440×280),随后 `normalize-store-assets.py` 做规格门禁(尺寸精确 + RGB 无 alpha,Pillow;不合格即 fail)。随本次发版一起提交。字体前提:`scripts/screenshots/fonts/fetch.sh` 一次性拉取(本地,git-ignored)。

1. **Version check**: `git tag --sort=-v:refname | head -1` gives the highest tag (format `v<version>`, e.g. `v4.0.3`). The current version — authoritative source is `manifest.json`, mirrored in `package.json` — must be **greater** than the highest tag; if development did not bump it, bump it first.
2. **Changelog basis**: every commit between the current version and the previous version tag.
3. **Bilingual changelog**: update `docs/README.md` (English) + `docs/README.zh.md` (Chinese) — the repo convention is symmetric bilingual entries. Since 2026-08-30 the READMEs keep full text for **4.0-and-later** entries only; every pre-4.0 release note lives in its own file under `docs/changelog/` (`vX.Y.md` EN / `vX.Y.zh.md` ZH, README carries the version/date/link table). When an entry eventually migrates out of the README too, update every live link pointing at its old anchor — the known consumers are `docs/announce.json` (per-message `link[].url`) and `src/donation.js` `CHANGELOG_URL`.
4. **Gap-fill, don't rewrite**: if the working version already has changelog entries accumulated during development, reconcile them against the commit list rather than rewriting from scratch.
5. **Commit** the documentation work (only the files involved).
6. **Tag**: `git tag v<version>` (e.g. `v4.0.3`).
7. **Package**: `npm run package` (builds dist, then `python3 scripts/package.py --root dist`; version read from `manifest.json`; produces `tmp/vBookmarks_<version>.zip`).
8. **Push** commits + tag.

**Step 2 — 商店发布**(store publish via `scripts/webstore/publish.js`): uploads `tmp/vBookmarks_<version>.zip` and submits for review.

- **前置校验(默认强制)**: `check` 子命令离线验证 git发布 已完成 — git 最大 tag 必须为 `v<version>` 且 zip 内嵌版本与仓库一致;校验失败即中止(`--skip-check` 仅用于显式上传草稿)。发布前先 `node scripts/webstore/publish.js check`。
- **凭据**: 只存于 git-ignored 的仓库根 `.env`(`CWS_PUBLISHER_ID` / `CWS_CLIENT_ID` / `CWS_CLIENT_SECRET` / `CWS_REFRESH_TOKEN`;`extensionId` 自动从 manifest 推导),真实环境变量优先;获取步骤见 `scripts/webstore/README.md`。仓库内文件不得出现真实凭据。
- **测试用户灰度**: `publish --type TRUSTED_TESTERS --yes` 只发布给指定测试者,`publish --type DEFAULT_PUBLISH --yes` 恢复全量;测试用户列表取 `CWS_TRUSTED_TESTERS`(逗号分隔,留空默认 `windviki@gmail.com`),发布时脚本打印列表供核对 — CWS API 无法代管测试者邮箱,列表须在 Dashboard → Users and permissions → Testers 手动维护。
- **流程**: `upload --yes` → `publish --yes`(或 `all --yes` 一次完成);`--file` 指定 zip,`--type STAGED_PUBLISH`/`TRUSTED_TESTERS` 走分阶段/预发布,`--deploy N` 灰度。全部 dry-run 默认,`--yes` 才联网执行。
- **listing 元信息(商店文案/截图)**: 官方 CWS API V2 **没有** listing 的读写 REST 端点(2025-10-15 版 reference 核实),自动化边界是「全量快照 + 草稿」—— `listing --yes` 抓公开详情页并解析内嵌 ds:0 数据块(名称/简介/说明全文/类别/截图/小型宣传图块/版本/评分/语言,无需凭据;唯一缺口是公开页不展示的 marquee),与仓库文案和版本比对;`listing-draft` 离线从规范源(`_locales` extName/extDesc、`assets/store/description.{en,zh-CN}.txt` 说明全文纯文本 —— CWS 不渲染 markdown、docs README changelog)生成可粘贴双语草稿,并逐张核对上传图片清单(五张 1280×800 截图 + 两张宣传图块,尺寸/alpha 门禁)(命令与边界详情:`scripts/webstore/README.md`「listing 元信息」节)。商店图片素材由 `scripts/screenshots/shots-store.js` 自动拼图产出(见 testing.md 截图套件清单)。
- **测试**: `npm run test:webstore`(全离线,验证 V2 请求契约 + 打包产物 CWS 结构合规 + listing 纯函数)。
