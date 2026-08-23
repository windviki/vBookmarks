# vBookmarks 4.1.0 构建与性能改造落地方案

> 状态：评审通过（2026-08-22）→ M1–M4 已全部实施并验收通过（构建管线 / 门禁平移 / 性能 P0 / 实测决策）；P1 三项（单趟快照 / idle 队列 / SW 精益化）与 H9 后续（徽章降频）已随 4.1.0 收尾实施。最终实施状态见附录 C（C.7），性能数据见附录 A。
> 适用版本：**4.1.0**（master 开发中版本，含 tab-groups 视图）。本文档取代 `docs/build-bundle-terser-plan.md`（4.0.8 版），沿用其已验证的架构结论，更新全部实测数据，并补齐 CI/发布门禁与性能改造的实施细节。
> 目标：随 4.1.0 一起发布。两件事 ——
> **方案 A（构建）**：在源码开发体验不变（仓库根目录仍可 Load unpacked）的前提下新增 `dist/` 构建产物：ESM 模块图 esbuild 打包 + 全部 JS 经 Terser 压缩，发布态从 `dist/` 出包。
> **方案 B（性能）**：在构建落地后按「先测量、后优化、逐层验收」的纪律做运行时性能改造，把 popup 打开、树重建、视图切换的耗时压到实测可感的程度。

---

## 0. 结论摘要

1. **收益来源要分三层看：bundle（文件数与依赖图）> minify（体积）> 经典脚本拼接（仅文件数，一期不做）。** 4.1.0 实测 popup 每次打开加载 **59 个 JS 文件 / 1134.6 KiB 源码**，改造后 **7 个文件 / 286.6 KiB（-74.7%）**；service worker 从 11 文件 / 119.0 KiB 降到 **1 文件 / 26.6 KiB（-77.6%）**。商店 zip 从 1130.3 KB 降到 850.2 KB（-24.8%），zip 内 JS 字节 -69.6%（zip 绝对值随非 JS 内容快照浮动约 ±1%，以附录 A 最新复测为准）。
2. **架构沿用「同路径入口打包」**：6 个 ESM 入口在 `dist/` 中产出同名同路径的单文件 bundle，HTML / manifest / 源码一行不改，开发态与发布态并存。这是回归面最小的方案。
3. **压缩器维持 Terser，但认清它的真实贡献**：在 esbuild bundle 产物上，Terser 仅比 esbuild 自带 minify 再省约 0.8%（neat 入口 271.3 vs 273.5 KiB，实测）。保留 Terser 是因为已验证、体积最优、需求既定；若未来要简化工具链，esbuild 单工具方案是已量化代价的退路（§2.3）。
4. **经典脚本拼接（Phase 1B）4.1.0 复测结论不变：拼接与分开压缩字节数完全相同**（popup 集合 13.3 = 13.3 KiB），收益只有每页少 1–4 个本地文件请求。默认不启用，启动判据见 §2.8。
5. **构建只解决加载/解析，不解决渲染慢。** 方案 B 给出 9 个已在 4.1.0 代码中逐条核实的热点（§4.2，含 4.1.0 新增的 tab-groups 视图事件风暴 H9），按 P0 快赢 → P1 结构重构 → P2 渲染层分层推进，每一层都有明确的启动判据与验收方法，不做没有基线数据的优化。
6. **dist 成为唯一发布产物**，因此门禁链必须整体平移：Docker 真机冒烟增加 `--dist` 模式，CI 增加 dist 构建与校验，发布流程 Step 0/1 改为对 dist 出包（§3）。单元测试永远跑在源码上，不迁移。

---

## 1. 现状盘点（4.1.0 实测）

### 1.1 加载模型

仓库无构建步骤，扩展根目录就是仓库根目录。页面通过根绝对路径 `/src/*.js` 加载脚本：

- **经典脚本**（无 `type="module"`）：HTML 解析时同步执行，按标签顺序保证先后依赖。
- **ES 模块**（`type="module"`）：浏览器 defer，按模块图异步求值；多入口的相对顺序由 HTML 标签顺序决定（`fuzzy.js` 在 `neat.js` 之前设置 `window.VBMFuzzy`）。
- **没有任何动态 `import()`**（已全仓搜索确认，仅注释中出现该字样），esbuild 静态 bundle 因此完备。
- CSP `script-src 'self'`，产物仍是扩展自托管文件，不受影响。

### 1.2 页面脚本清单（4.1.0 核对）

| 页面 | 经典脚本（同步，按序） | 模块脚本（defer，按序） |
|---|---|---|
| popup.html | store.js → i18n-live.js → popup.js → sync-manager.js → sort-utils.js | fuzzy.js → neat.js |
| sidepanel.html | 同上 | 同上 |
| options.html | codemirror.js → store.js → i18n-live.js → sort-utils.js → storage-usage.js → options.js | options-palette-commands.js → options-proxy.js |
| advanced-options.html | advanced-options.js | — |
| favicons.html | store.js → i18n-live.js | favicons.js |
| manifest.json（SW） | — | background.js（`"type": "module"`） |

注意 popup.html 的标签顺序里 `fuzzy.js`（module）夹在 `sync-manager.js` 与 `sort-utils.js` 之间：经典脚本先按序全部执行完，模块再按序求值，所以实际顺序是 store → i18n-live → popup → sync-manager → sort-utils → fuzzy → neat。本方案不改 HTML，该顺序天然保持。

### 1.3 ESM 模块图（4.1.0 实测，esbuild metafile 口径）

| 入口 | 输入文件数 | 源码体积 | bundle 后 | 再 Terser |
|---|---|---|---|---|
| `src/neat.js`（popup/sidepanel 主图） | 52 | 1074.7 KiB | 532.2 KiB | **271.3 KiB** |
| `src/background.js`（SW） | 11 | 119.0 KiB | 56.2 KiB | **26.6 KiB** |
| `src/fuzzy.js` | 2 | 9.4 KiB | 4.4 KiB | **2.0 KiB** |
| `src/options-palette-commands.js` | 3 | 26.5 KiB | 14.1 KiB | **8.9 KiB** |
| `src/options-proxy.js` | 2 | 14.5 KiB | 6.8 KiB | **4.0 KiB** |
| `src/favicons.js` | 7 | 121.5 KiB | 19.8 KiB | **11.4 KiB** |

4.1.0 相对 4.0.8 的增量主要来自 tab-groups 视图（`view-tabgroups.js` 图 8 文件 / 167.5 KiB 源码，含 4 个新右键菜单与 2 个新对话框）与远程公告链（announce + github-source + github-mirrors）。6 个 bundle 产物均无 `import`/`export` 残留（实测逐文件扫描为 0）。

按页面合计（ESM 图与经典集合去重后）：

| 页面 | 文件数 | 源码体积 | 改造后文件数 | 改造后体积 | 降幅 |
|---|---|---|---|---|---|
| popup / sidepanel | 59 | 1134.6 KiB | 7（5 经典 + 2 bundle） | 286.6 KiB | **-74.7%** |
| service worker | 11 | 119.0 KiB | 1 | 26.6 KiB | **-77.6%** |
| options | 11 | 179.5 KiB | 8（6 经典 + 2 bundle） | 84.3 KiB | **-53.0%** |
| favicons | 9 | 156.3 KiB | 3（2 经典 + 1 bundle） | 20.7 KiB | **-86.8%** |

### 1.4 经典脚本契约（逐文件核实，4.1.0 无变化）

| 文件 | 形态 | 暴露契约 | 依赖的前置全局 | 原始体积 |
|---|---|---|---|---|
| `src/store.js` | 顶层 IIFE | `window.store`、`window.getSetting/setSetting/removeSetting` | 仅 `chrome.*` | 26.8 KiB |
| `src/i18n-live.js` | 顶层 IIFE | `window.VBMI18N` | `window.store`（可空）、`chrome.i18n` | 8.0 KiB |
| `src/popup.js` | `(window => {...})(window)` | 无对外 API；主题预涂、panel 心跳/端口、popup 尺寸 | `store`、`getSetting/setSetting` | 5.1 KiB |
| `src/sync-manager.js` | 顶层 IIFE | `window.syncManager` | `chrome.storage.session`、`chrome.runtime` | 3.7 KiB |
| `src/sort-utils.js` | `(window => {...})(window)` | `window.VBMSort` | `Intl` | 6.9 KiB |
| `src/storage-usage.js` | 顶层 IIFE | `window.VBMUsage` | 无 | 1.9 KiB |
| `src/options.js` | 顶层 `const $` + IIFE | 无对外 API | `store`、`getSetting/setSetting`、`VBMI18N`、`VBMSort`、`VBMUsage`、`CodeMirror` | 58.2 KiB |
| `src/advanced-options.js` | 单条 `location.replace` | 无 | `window.location` | 0.2 KiB |
| `vendor/codemirror.js` | 顶层 `var CodeMirror` | `window.CodeMirror` | `window` | 36.7 KiB |

要点：经典脚本之间零 ESM import，全靠 `window.*` 与加载顺序通信；顶层声明除 `options.js` 的 `const $` 与 codemirror 的 `var CodeMirror` 外全部关在 IIFE 里，无命名冲突。ESM 模块对经典层的引用（`window.store` 等自由变量）经 esbuild 打包后原样保留（dry-run 已验证）。

### 1.5 全局契约清单（打包/压缩必须保留）

| 全局名 | 生产者 | 主要消费者 |
|---|---|---|
| `store` | store.js | neat.js 及各 ESM 模块（对话框/树渲染/搜索/动作/同步 UI/排序执行器/快捷加星等） |
| `getSetting/setSetting/removeSetting` | store.js | popup.js、options.js |
| `VBMI18N` | i18n-live.js | palette.js（`/lang`）、options.js |
| `VBMSort` | sort-utils.js | dialogs.js、folder-sort.js、neat.js、options.js |
| `syncManager` | sync-manager.js | tree-render.js、search.js、sync-ui.js、actions.js |
| `VBMUsage` | storage-usage.js | options.js |
| `VBMFuzzy` | fuzzy.js（ESM 入口，故意保留全局形态） | palette.js、search.js |
| `CodeMirror` | vendor/codemirror.js | options.js |

压缩配置的硬约束由此而来：**Terser 一律 `toplevel: false`**，否则顶层全局被改/删，页面直接白屏（§6 风险表）。

---

## 2. 方案 A：dist 构建管线

### 2.1 架构：同路径入口打包（same-path entry bundling）

构建产物 `dist/` 的目录结构**镜像源码**，所有引用路径不变：

- `dist/manifest.json` 仍指向 `src/background.js`；
- `dist/pages/*.html` 仍引用 `/src/fuzzy.js`、`/src/neat.js` 等原路径；
- 区别只是 `dist/src/neat.js` 的内容从 52 文件模块图变成了单文件 bundle，经典脚本变成压缩版。

由此**源码、HTML、manifest 全部零改动**，回归面最小（`tests/` 中读 `pages/*.html` 的契约测试不受影响），开发态（根目录 Load unpacked）与发布态（`dist/`）并存。

### 2.2 文件流向

```text
源码（仓库根，开发用）                   dist/（发布用）
─────────────────────────              ─────────────────────────
manifest.json / pages / css / assets/icons / _locales /
license.txt / docs/README*.md / vendor/codemirror.css
                     ──原样复制──────▶ 同名同路径

6 个 ESM 入口（background/fuzzy/neat/options-palette-commands/
  options-proxy/favicons）
  ──esbuild bundle──▶ 单文件 ──Terser(module:true)──▶ dist 同名

9 个经典脚本（vendor/codemirror.js + src/{store,i18n-live,popup,
  sync-manager,sort-utils,storage-usage,options,advanced-options}.js）
  ──Terser(module:false, 不 bundle)──▶ dist 同名
```

### 2.3 工具选型与压缩器对比（含实测裁决）

| 工具 | 职责 | 选择理由 |
|---|---|---|
| esbuild 0.28.x | 只做 bundle（`minify:false`） | 已在依赖树中（vitest→vite），API 稳定，对本项目 ESM 图 bundle 全部成功；不引入 webpack/rollup/rspack 等重型管线 |
| Terser 5.50.x | 唯一压缩器 | 压缩率仍是实用工具中最好的一档（[minification-benchmarks](https://github.com/privatenumber/minification-benchmarks) 长期跟踪）；对本仓库两类输入（bundle 后 ESM、经典 IIFE）都有明确安全配置 |
| scripts/package.py | 从 dist 出 zip | 保留现有 missing-import / stray-file 校验与 `--target edge` |

**压缩器实测对比（4.1.0，neat 入口 bundle 后）**：Terser 271.3 KiB vs esbuild minify 273.5 KiB —— 差距 0.8%。结论：保留 Terser（体积最优且已验证），但把「esbuild 单工具」记录为代价已量化的退路；oxc-minify / swc 等 Rust 压缩器与管线接口兼容，未来如需可平滑替换，当前不引入（多一个依赖、收益以个位数 KiB 计，不值得）。

esbuild 只 bundle 不 minify 是刻意的职责分离：bundle 语义（模块求值顺序、副作用保留）由 esbuild 保证，压缩语义（`toplevel:false` 等契约保护）集中在 Terser 一处配置，出问题时二分定位简单（先关 compress，再关 mangle）。

### 2.4 `scripts/runtime-files.json`（新增，单一事实源）

把 `package.py` 顶部的清单抽出，build 与 package 共用，杜绝两份清单漂移：

```json
{
  "html": ["pages/popup.html","pages/sidepanel.html","pages/options.html","pages/advanced-options.html","pages/favicons.html"],
  "css": ["css/neat.css","css/options.css","css/sync-styles.css","css/favicons.css","vendor/codemirror.css"],
  "images": ["assets/icons/icon.png","assets/icons/icon16.png","assets/icons/icon32.png","assets/icons/icon48.png","assets/icons/icon128.png","assets/icons/icon.svg"],
  "meta": ["license.txt","docs/README.md","docs/README.zh.md"],
  "classicJs": ["vendor/codemirror.js","src/store.js","src/i18n-live.js","src/popup.js","src/sync-manager.js","src/sort-utils.js","src/storage-usage.js","src/options.js","src/advanced-options.js"],
  "esmEntries": ["src/background.js","src/fuzzy.js","src/neat.js","src/options-palette-commands.js","src/options-proxy.js","src/favicons.js"]
}
```

交叉校验规则（写进 build.mjs）：`manifest.json` 的 `background.service_worker` 必须出现在 `esmEntries` 中；`classicJs`/`esmEntries` 不得有交集；两个集合的并集在 dist 打包时即 zip 的全部 JS。

### 2.5 `scripts/build.mjs` 规格

伪代码（关键骨架，与 dry-run 实跑脚本一致）：

```js
import { build } from 'esbuild';
import { minify } from 'terser';

const files = JSON.parse(readFileSync('scripts/runtime-files.json', 'utf8'));
rmSync('dist', { recursive: true, force: true });

// 1) 复制静态文件（html/css/images/meta/manifest.json + _locales/ 整目录）
// 2) ESM 入口：esbuild bundle 到内存 → Terser → 写 dist 同名
for (const entry of files.esmEntries) {
    const bundled = await esbuild.build({
        entryPoints: [entry], bundle: true, format: 'esm',
        platform: 'browser', write: false, minify: false, logLevel: 'silent',
    });
    const { code } = await minify(bundled.outputFiles[0].text, {
        module: true, toplevel: false, compress: true, mangle: true,
        format: { comments: false },
    });
    write(`dist/${entry}`, code);
}
// 3) 经典脚本：不 bundle，直接 Terser
for (const file of files.classicJs) {
    const { code } = await minify(readFileSync(file, 'utf8'), {
        module: false, toplevel: false, compress: true, mangle: true,
        format: { comments: false },
    });
    write(`dist/${file}`, code);
}
// 4) 构建即自检（§3.1），任一检查失败即非零退出
```

关键配置：

| 配置 | 值 | 原因 |
|---|---|---|
| esbuild `format` | `'esm'` | 入口与 SW 均为 ESM |
| esbuild `minify` | `false` | 压缩职责全在 Terser |
| esbuild `platform` | `'browser'` | 保留 `chrome.*`/`window.*`，不做 node polyfill |
| Terser `module` | ESM `true` / 经典 `false` | 匹配各自语法形态 |
| Terser `toplevel` | **一律 `false`** | 保护 §1.5 全部顶层全局契约（硬约束） |
| Terser `mangle` | `true`，不配 `properties` | 只改局部变量名，DOM/API/属性安全 |

**构建即自检**（不做成可选步骤，任一失败即 build 失败）：

1. `dist/manifest.json` 的 `background.service_worker` 指向的文件存在。
2. 6 个 bundle 无 `import ... from` / `export ... from` / `import(` 残留（自包含）。
3. 全局契约属性名逐一出现：`store`/`getSetting`/`setSetting`/`removeSetting`/`VBMI18N`/`VBMSort`/`syncManager`/`VBMUsage`/`CodeMirror`/`VBMFuzzy`。注意 **Terser 会把 `(window => {...})(window)` 的形参 mangle 成短名**（产物里是 `e.VBMSort=...`），所以检查的是**属性名字符串**是否出现，而非字面 `window.X=`。（字符串检查是近似手段——产物里的字符串字面量理论上可造成误报/漏报——它只是第一道静态防线，最终裁决以 §3.3 的 dist 真机冒烟为准。）
4. 被 bundle 吞掉的内部模块不得存在于 dist（`dist/src/actions.js`、`dist/src/palette.js` 等 56 个文件不应存在——dist 的 `src/` 下恰好只有 14 个 JS：8 经典 + 6 入口，加 `vendor/codemirror.js` 共 15）。
5. `_locales/` 全目录、`assets/icons/*`、`pages/*.html`、`css/*` 完整。
6. dist 总文件数与 zip 预算（78 文件 ±0）打印出来供肉眼核对。

### 2.6 `scripts/package.py` 改造（含 dry-run 发现的必修陷阱）

1. 新增 `--root` 参数（默认仓库根）：输入根与输出目录分离，zip 始终写仓库 `tmp/`（不写进 dist）。
2. 硬编码清单（`HTML_PAGES`/`JS_FILES`/`CSS_FILES`/`IMAGES`/`META_FILES`）全部改为读 `runtime-files.json`。
3. **必修陷阱（4.1.0 dry-run 实测暴露）**：`JS_FILES` 的种子集合必须改成 `classicJs + esmEntries` 这 15 个文件。现在的 `JS_FILES` 含有 38 个内部模块（actions/palette/tree-render/…），从 dist 打包时这些文件已被 bundle 吞掉、不存在于 dist，`collect_files` 会报 38 个 missing 并触发拒绝出包。改成 15 文件种子后两种模式都自洽：
   - 源码根打包：入口仍带 import，`resolve_js_imports()` 自动补全整张图，产物与现状一致（134 文件）；
   - dist 打包：入口无 import，resolver 不补充任何文件，zip 恰为 78 文件 / 15 JS（dry-run 实测）。
   - 附带好处：种子清单从 40+ 项缩到 15 项，新增内部模块再也无需登记。
4. `verify_no_strays` 与 missing 门禁逻辑保持不变，两种根目录下都生效。另注意 `IMPORT_RE` 会扫描 bundle 文本：minify 后不存在静态/动态 import 语法，dry-run 实测 0 残留；§3.1 自检第 2 条把这一点变成硬检查，防止未来某天代码里出现字符串形态的 `import('./x.js')` 被误补全。

### 2.7 `package.json` / `.gitignore` / Node 版本

```jsonc
{
  "scripts": {
    "build": "node scripts/build.mjs",
    "package": "npm run build && python3 scripts/package.py --root dist",
    "package:src": "python3 scripts/package.py",                  // 旧行为保留，供对照
    "package:edge": "npm run build && python3 scripts/package.py --root dist --target edge"
  },
  "devDependencies": { "esbuild": "0.28.2", "terser": "5.50.0" }
}
```

- **依赖现状修正（评审复测发现）**：esbuild 是传递依赖（vitest→vite，已在锁文件），但 **terser 5.50.0 是 dry-run 期间临时安装、未进 package-lock**（extraneous），`npm ci` 会直接丢包——升格为显式 devDependency 是实施第一步而非防患措施。实施采用精确锁定 `esbuild@0.28.2` / `terser@5.50.0`（`--save-exact`），避免构建产物随小版本漂移。
- Node 版本：CI 已固定 node 20（`.github/workflows/ci.yml`），esbuild 0.28 要求 Node ≥ 18，无需变更加注 `engines`。
- `.gitignore` 增加 `dist/`；本地 dry-run 目录继续走 `tmp/`（已忽略）。

### 2.8 Phase 1B（经典脚本拼接）与明确不做的事

**Phase 1B（默认不启用）**：把每页的经典脚本按 HTML 顺序拼成单文件再压缩。4.1.0 复测：拼接与分开压缩**字节数完全相同**（popup 集合 13.3 = 13.3 KiB，options 71.4 = 71.4，favicons 9.3 = 9.3），收益只有每页少 1–4 个本地文件请求，代价是 build.mjs 要重写 dist HTML 的 script 标签。启动判据：§3.7 实测若证明 popup 打开中 script 请求/解析占比明显（>5%），再启用；届时作为独立 PR，附带 dist HTML 重写与契约自检的扩展。

**明确不做**：

1. 不做 CSS/HTML minify（体积不是瓶颈，回归面不合算；将来要做用 esbuild/clean-css 单独立项）。
2. 不做激进 tree-shaking 专项（neat 图几乎每个模块都在初始化路径上；esbuild bundle 已自然去掉未引用导出）。
3. 不把经典脚本转 ESM 再并入 bundle（要改约 9 个 `window.*` 消费者，收益仅限文件数，独立重构不捆绑）。
4. 不产出 sourcemap 进 zip（包体与审核考虑）；如排查 dist 疑难，临时给 build.mjs 加 `--maps` 本地生成即可，不进 CI/发布链。
5. 不做控制流混淆等压缩花活（商店审核可读性 + 调试成本）。
6. 单元测试不迁移到 dist 上跑——vitest 永远跑源码，dist 的正确性由「同源构建 + 静态自检 + 真机冒烟」三层保证（§3）。
7. 不保留代码内 license 注释（Terser `format.comments:false`）：商店包内含 `license.txt`，公开源码仓库保留完整注释可作参照；如未来审核政策要求，再改为 `comments:/^!/` 保留 `/*!` 头注释。

---

## 3. 验证、门禁与发布集成

dist 是 4.1.0 起唯一的发布产物，门禁链整体平移，逐层如下。

### 3.1 第一层：构建即自检

§2.5 第 4 步的 6 项检查嵌在 build.mjs 尾部，失败即非零退出。CI 与本地共用同一入口，不存在「本地忘了跑校验」。

### 3.2 第二层：单元测试与 lint（不变）

```bash
npm run test:run   # vitest 全量跑源码，应全绿
npm run lint       # eslint src tests
```

### 3.3 第三层：Docker 真机门禁增加 dist 模式

`scripts/harness/run.sh` 增加 `--dist` 模式：

- 用法：`scripts/harness/run.sh --dist [--smoke-only]`；前置条件是 `dist/` 已构建（没有则报错退出，提示先 `npm run build`）。
- 实现：打包上下文时把 `dist/` 的内容（而不是仓库根）tar 进镜像的扩展目录，其余层（smoke/keyboard/scrollbar/menu 各 verify 脚本）原样复用——它们驱动的是扩展页面行为，与被加载的代码形态无关。
- 价值：这是唯一能抓住「bundle 后初始化顺序/全局契约被破坏」的自动化关卡（单元测试不覆盖 app shell 的加载期崩溃，AGENTS.md 已记录该教训）。全量 harness 在 dist 上跑一遍，等于把 153 项键盘断言 + 752 项滚动条断言 + 菜单矩阵同时变成 dist 的回归网。（实施时顺带把 `scripts/harness/run.sh:11` 头部注释里过时的键盘断言数 132 修正为 153，与 AGENTS.md 口径一致。）

### 3.4 CI 集成（`.github/workflows/ci.yml`）

- `test` job 追加三步：`npm run build`（含自检）→ `python3 scripts/package.py --root dist` → 现有 `npm run test:webstore` 改为校验 dist zip（它读 `tmp/vBookmarks_<ver>.zip`，`npm run package` 产出同名文件，契约天然衔接）。源码直出打包保留 `package:src` 脚本但退出 CI 默认路径。
- `smoke` job 改为跑两次：源码根冒烟（守开发态）+ `--dist --smoke-only`（守发布态）。dist 模式需要 Node 构建，smoke job 需补 `setup-node` + `npm ci` + `npm run build` 三个步骤。
- `harness-full`（手动触发）增加 `--dist` 全量档，发版前必跑。

### 3.5 发布流程修订（AGENTS.md「Release process」相应更新）

- **Step 0（发版前置冒烟）**：由一次 `run.sh --smoke-only` 变为「源码冒烟 + dist 冒烟（--smoke-only）+ dist 全量 harness」三段；dist 全量是 4.1.0 的强制新门禁。
- **Step 1（git发布）**：第 7 步打包由 `python3 scripts/package.py` 改为 `npm run package`（dist 出包）。版本号仍读 `dist/manifest.json`（与源码一致，复制而来）。
- **Step 2（商店发布）**：`scripts/webstore/publish.js` **无需改动**——其前置校验读 zip 内嵌 manifest 版本与 git tag 比对，dist zip 的 manifest 是原样复制的，校验链天然成立。dry-run 已验证 dist zip 结构（78 文件、15 JS、manifest 版本一致）。
- 更新点清单：AGENTS.md 的「无构建步骤」表述、Build/Test 命令节、Release process 三节；`docs/README*.md` 的开发说明。这些是任务收尾的一部分，不是可选项。

### 3.6 手动冒烟矩阵（4.1.0 版，Load unpacked → `dist/`）

| 场景 | 检查点 |
|---|---|
| popup | 树渲染、主题、favicon（含补全与对比度反转）、搜索、右键菜单（含折叠子菜单） |
| side panel | 面板模式、心跳/端口断连后图标恢复 popup 行为 |
| tab-groups 视图（4.1.0 新增） | 窗口/分组/标签三档行、过滤、选择模式、已关闭分组恢复、四个专用右键菜单 |
| options | 设置读写、备份导入导出、CodeMirror、语言切换、存储用量条、favicon 画廊链接 |
| advanced-options | 重定向 options.html |
| favicon 画廊 | 卡片/来源徽章/过滤/compare |
| omnibox `*` | SW 注册、建议、sync 徽标 |
| 命令面板 | Ctrl/Cmd+K、`/version`、`/lang`、自定义命令（含 view-preset） |
| 快捷键 | open-side-panel / quick-add / open-command-palette |
| 死链扫描 | 开始/暂停/取消、进度 blob、代理条、SW 续跑 |
| 重复书签 | 策略/scope、确认删除、undo |
| 拖拽/排序 | 树拖拽、文件夹排序、undo |
| 同步状态 | 徽标、同步引擎消息 |
| 更新模拟 | 旧版存储 → 新版迁移不报错 |

### 3.7 性能实测方法（基线优先，先建表再优化）

体积数据不等于速度数据。所有性能结论以此节的实测为准：

1. **基准 profile**：种子 3000+ 书签（含深层嵌套文件夹）、50+ 打开标签（含若干标签组）的测试 profile；种子脚本随 perf 探针一起放 `scripts/harness/`。
2. **探针脚本 `scripts/harness/perf-popup.js`（新增）**：在 Docker 真机里用 CDP 的 Performance 域采集——分别加载源码根与 dist，各录 10 次 popup 冷打开与树重建，输出 `Scripting / Rendering / Painting` 三段耗时表。复用 harness 既有约定（`window.close` stub、种子 URL 用 `127.0.0.1:9` 快失败地址、导航用 `waitUntil:'load'`）。
3. **SW 冷启动**：`chrome://serviceworker-internals` 或 CDP 录制 SW 启动耗时，源码 vs dist 各 10 次。
4. **结果回填**：所有数据贴回本文档附录 A，作为方案 B 各 tier 的验收基线。
5. **口径说明**：headless 环境的绝对数值只作参考，本方案所有对比均取「源码 vs dist」「优化前后」的相对差值；不预设数字，无显著变化即回滚或降级（§4.6）。

---

## 4. 方案 B：运行时性能优化

### 4.1 原则

- **先测量后优化**：每项优化落地前在基准 profile 上录基线，落地后同一方法复测，无显著变化就回滚或降级优先级。杜绝「凭感觉优化」。
- **与构建改造正交但有序**：先合并方案 A（ diff 面集中在构建脚本），再逐项上 P0，每项独立 commit，跑 `npm test` + 冒烟。
- **守住交互契约**：键盘模型（`docs/keyboard-model.md`）、焦点法则（4.0.1 的 park/restore）、菜单层级这些硬契约优先于任何性能数字；优化不得以回归它们为代价。

### 4.2 热点清单（4.1.0 逐条核实，含行号）

| # | 热点 | 位置（4.1.0 行号已核实） | 代价 | 状态 |
|---|---|---|---|---|
| H1 | 每次 `generateTree` 无条件重建搜索索引 | `src/tree-view.js:168` 调 `search.updateIndex(tree)`；而 `src/search.js:162` 的 `buildSearchIndex` 已有 dirty 标记（`:193-196` 监听 onCreated/onRemoved/onChanged/onMoved）+ 首次搜索懒构建（`:561`） | 每次树重建白付一次 O(n) 全树遍历 + 每节点建对象 | 确认冗余，可删 |
| H2 | 每次树渲染/展开后全量 tooltip 溢出检测 | `src/tree-view.js:249` 与 `:319` 两处 `setTimeout(adaptBookmarkTooltips, 100)` | 对所有行读 `scrollWidth/offsetWidth`，整树强制布局 | 确认存在（两处调用点） |
| H3 | 每行 favicon URL 都 `new URL` + `searchParams` | `src/tree-render.js:144` `getFaviconUrl` | 大列表生成 HTML 时每行一次 URL 对象分配 | 确认存在 |
| H4 | 每次树渲染后全量刷新同步徽标 | `src/tree-view.js:186-190` → `src/sync-ui.js` `refreshSyncIndicators` | O(行数) DOM 查询删除重建，与行内已生成的徽标重复 | 确认存在 |
| H5 | `onTreeGenerated` 再做一次全树遍历收集有效 id | `src/neat.js:655-666`（`views.buildPathMap(t)` 之后又 `collect(t)` 喂 `visitStats.prune`） | 与 buildPathMap 的全树遍历重复 | 确认存在 |
| H6 | dead overlay 无差别扫 5 个列表的全部行 | `src/view-dead.js:963-995` `refreshOverlays`：即使 `deadMarks` 为空也逐 `li` querySelector | 每次树/列表渲染多一轮全量 DOM 查询 | 确认存在，无快速返回 |
| H7 | dupes 渲染重复计算 keeper/删除计划 | `src/view-dupes.js:261,265,276,347,552,563,594,629` 多处 `pickKeeper`/`planDeletion` | 大重复组集成倍计算 | 确认存在 |
| H8 | 大列表整块 `innerHTML` 替换 | `tree-render.generateHTML` 与各视图 `$list.innerHTML = html` | 数千行时单超长任务 | 确认存在（P2 处理） |
| H9 | **（4.1.0 新增）tab-groups 视图事件风暴**：任意 tabs/tabGroups/bookmarks 事件经 300 ms 防抖触发 `refresh()`，视图未激活时仍执行 `readWindows` + `queryAllGroups` + `readClosedGroups` + `updateBadges`（`src/view-tabgroups.js:249-340`，`:328` 的 `isActive` 守卫只省掉 `getTree`+render）；激活时每次事件都是全量查询 + 全量 innerHTML 重建 | 页面加载期 `tabs.onUpdated` 连发，未激活也每 300 ms 白跑两轮查询 | 确认存在 |

### 4.3 P0 快赢（随 4.1.0 落地；改动小、风险低、每项独立 commit）

| 项 | 改动 | 预期收益 | 风险与测试 |
|---|---|---|---|
| H1 | 删 `tree-view.js:168` 的 `search.updateIndex(tree)`，依赖 search.js 已有的 dirty + 懒构建 | 每次树重建省一遍全树 walk | 低。验证「首次搜索」「书签变更后立即搜索」两路径；跑 `tests/search.test.js`、`tests/tree-view.test.js` |
| H2 | 删两处全量 `adaptBookmarkTooltips` pass，改为 `$tree` 上 `mouseover`/`focusin` 事件委托，只对事件目标行做溢出检测并写 `title` | 消除每次渲染的 O(n) 强制布局，大树最明显 | 中。回归键盘焦点、触控、RTL；跑 tree-view 套件 + 冒烟 |
| H3 | `getFaviconUrl` 改为预算 base + 字符串拼接（`base + encodeURIComponent(url) + '&size=32'`） | 每行省一次 URL 构造 | 低。**注意编码对齐**：`URL.searchParams` 序列化与 `encodeURIComponent` 对空格（`+` vs `%20`）等边角字符行为不同——在 `tests/tree-render.test.js` 用真实书签 URL 语料断言新旧输出逐字节一致后再合并 |
| H4 | 树渲染后不再全量 `refreshSyncIndicators()`；行内徽标由 row builder 生成，增量更新走既有 `syncStatusChanged` 事件；`sync-manager` 首次 apply blob 后按 id 派发事件补齐「状态后到」场景 | 树渲染后少一次整树 DOM 突变 | 中。验证四场景：首次打开、同步状态后到、sync 开关切换、options 改动；跑 sync-ui / tree-view / sync-manager-client 套件 |
| H5 | `buildPathMap` 一次遍历同时产出 path 与有效 id 集合（返回值扩展为 `{ paths, ids }`），`neat.js` 的 collect walk 删除 | 每次树重建省一遍全树遍历 | 低。同步改 `visitStats.prune` 调用方与 view-manager 套件 |
| H6 | `refreshOverlays` 快速返回：`deadMarks.size === 0` 且页面无 `.dead-indicator` 时直接 return；有标记时按 id 定点 `getElementById` 更新，不遍历全列表 | 无标记时零开销；有标记时 O(marks) | 低。回归五个列表（tree/results/recent/dead/dupes）的 × 叠加；跑 view-dead 套件 |
| H7 | `view-dupes.render()` 先算 `keeperByGroup = new Map(...)`，renderToolbar/renderGroup/删除确认全部读它 | 大重复组集不再成倍重复策略计算 | 低。回归选择模式、手动 pin keeper、策略切换；跑 view-dupes 套件 |
| H9 | `refresh()` 未激活路径改为 count-only：只 `chrome.tabs.query({})` 取数更新徽章，跳过 `queryAllGroups`/`readClosedGroups`/折叠态对账（这些本来就是 render 输入，未激活不需要） | 视图未激活时事件风暴的常数项砍掉大半；后台标签页狂刷标题时不再每 300 ms 白跑 | 低。徽章计数契约不变；跑 view-tabgroups 套件，真机冒烟观察切视图后首渲染仍正确。**后续已实施（C.7）**：未激活时仅 `onCreated`/`onRemoved` 触发徽章刷新，且防抖降到 1s；其余事件只服务激活视图的 300ms 重渲染 |

### 4.4 P1 结构性优化（4.1.0 收尾已全部实施，见 C.7）

1. **单次树遍历快照** ✅：当前一轮 `generateTree` 至少 5 遍树/行遍历（generateHTML、generateNodeTrees、addBookmarkParents、search.updateIndex〔H1 删除后〕、onTreeGenerated 的 buildPathMap+collect），DOM 侧另有 tooltip/徽标/overlay 三趟（H2/H4/H6 收敛后仍在）。在 `tree-render.js` 增加 `buildTreeSnapshot(tree, subTree) → { html, nodeTrees, bookmarkIds, paths, ids }`，一次快照遍历产出全部派生数据（paths/ids 覆盖全树，nodeTrees/bookmarkIds/html 以 tree-view 选定的显示子树为准），`tree-view.generateTree` 与 `neat.js onTreeGenerated`（经 `views.setPathMap`）改消费同一快照。有 `tests/tree-render.test.js` / `tests/tree-view.test.js` / `tests/view-manager.test.js` 覆盖兜底。
2. **首屏后的延迟队列** ✅：popup 打开的关键路径是 主题预涂（同步）→ store.ready → i18n → getTree → generateTree 首渲染。新增 `src/idle.js`（`deferIdle` + `?perf=1` 启用的 `performance.mark` 打点），把非关键初始化（远程公告 fetch、favicon 补全 storage hydrate、启动期三个视图的徽章预载）统一挂到 idle 队列（`requestIdleCallback` + timeout，或 `setTimeout 0`）；github mirror 刷新链本就只在公告 fetch 失败时按冷却触发，随公告一并延后。公告/补全的失败语义不变（全部静默）。
3. **SW 精益化核查** ✅：bundle 后 SW 为 26.6 KiB 单文件，冷启动收益已是四项中最大。核查结论：sync engine / tab-group opener / panel behavior 均为「挂监听 + 轻量读」；**visit-stats 的整树索引从冷启动 eager 读取改为首次 URL 导航时懒构建**（`indexReady` 门控，首个命中事件触发一次 `bookmarks.getTree`），dead-scan resume 因必须续跑 live scan 而保留其存储读，icon restore / quick-add 菜单两个小读维持现状（每次冷启动各一次轻量 storage 读，量级远小于整树）。用 §3.7 的 SW 冷启动数据验收。

### 4.5 P2 渲染层（最后手段，明确启动判据）

P0+P1 完成后在基准 profile 复测，若「数千行的树/死链/重复列表」仍达不到目标（长任务 >100 ms 或滚动掉帧明显），才启动本层，且按成本从低到高：

1. **CSS 先行**：`.vbm-row` 级 `content-visibility: auto; contain-intrinsic-size: auto 28px`（Chrome 114+ 满足最低版本要求），屏外行跳过 layout。必须回归：焦点恢复、`scrollIntoView`、滚动锚定、键盘 walk、拖拽插入线定位。
2. **分片渲染**：`innerHTML` 一次性替换改为 `DocumentFragment` 分批 append，把单超长任务切成多个可让出的任务。
3. **虚拟滚动**：只渲染可视窗口 ± 缓冲区。需要同时维护 roving tabindex、↑↓/Home/End 行走、focus park/restore、DnD、各视图 toolbar 契约，工作量大，单独立项，不与本方案捆绑。

### 4.6 验收

- 每个 tier 完成后：基准 profile 上按 §3.7 各录 10 次对比 `Scripting/Rendering/Painting`；`npm test` + lint 全绿；`run.sh --dist` 全量 harness 无回归；结果数据回填附录 A。
- 诚实预期：P0 的 H2/H4/H6 砍的是「DOM 强制布局/整树突变」，H1/H5 砍「重复全树遍历」，H9 砍后台空转——大树 profile 上树重建与视图切换应有可见改善，但具体倍数以实测为准，本文档不预设数字。

---

## 5. 里程碑与 4.1.0 发布对齐

| 里程碑 | 内容 | 进入 4.1.0？ |
|---|---|---|
| M1 构建管线 | runtime-files.json、build.mjs（含自检）、package.py `--root`、package.json/.gitignore、devDeps 升格 | **必须** |
| M2 门禁平移 | run.sh `--dist`、CI 三处更新、发布流程文档更新、dist 手动冒烟矩阵过一遍 | **必须** |
| M3 性能 P0 | H1–H7 + H9，逐项独立 commit + 单测 + 冒烟 | **必须**（若 4.1.0 时间紧：H1/H3/H5/H6/H7/H9 低风险必做，H2/H4 属中风险交互改动可顺延 4.1.x） |
| M4 实测与决策 | perf-popup.js 探针、基线/对比数据回填；据此决定 P1 各项、P2、Phase 1B 的去留 | 尽力（数据必须有；P1 顺延则进 4.1.x） |

落地 Checklist（执行时按序勾）：

1. `npm i -D esbuild@^0.28.2 terser@^5.50.0`。
2. 新建 `scripts/runtime-files.json`（§2.4）。
3. 新建 `scripts/build.mjs`（§2.5，含构建即自检）。
4. 改 `scripts/package.py`（§2.6：`--root`、清单来自 JSON、种子集合 = 15 文件、输出仍写仓库 `tmp/`）。
5. 改 `package.json` scripts、`.gitignore` 加 `dist/`。
6. `npm run test:run && npm run lint` 全绿。
7. `npm run build`（自检通过），`python3 scripts/package.py`（源码直出仍 134 文件）与 `npm run package`（dist 出包 78 文件 / 约 850 KB）双向核对。
8. `scripts/harness/run.sh --dist --smoke-only` 过；发版前 `run.sh --dist` 全量过。
9. dist Load unpacked 过 §3.6 手动冒烟矩阵。
10. 按 §4.3 逐项落 P0（每项：commit → `npm test` → 冒烟 → 下一项）。
11. perf 探针建基线 → 回填数据 → 决定 P1/P2/Phase 1B。
12. 更新 AGENTS.md（无构建步骤表述、Build/Test 命令、Release process、仓库布局中 dist 说明）与 `docs/README*.md` 开发说明。

---

## 6. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| Terser 误改顶层全局（`toplevel` 配错） | 页面白屏/功能全失效 | 配置硬编码 `toplevel:false`；§2.5 构建即自检第 3 条；CI dist 构建门禁 |
| esbuild bundle 改变模块求值顺序/丢副作用 | 某视图初始化失败 | 仅 6 入口、依赖图清晰且无动态 import；`--dist` 真机 harness 全量覆盖；必要时 sideEffects 标注排查 |
| 经典脚本顺序被破坏 | 全局契约未就绪即被消费 | 不改 HTML，顺序天然保持；冒烟矩阵覆盖 |
| package.py 清单漂移 / dist 缺文件 | 出包残缺 | runtime-files.json 单一事实源；§2.6 的种子集合改造消除 38 项 missing 隐患；`verify_no_strays` + missing 门禁保留 |
| 开发态与发布态行为不一致 | 本地好、发布坏 | 发布流程强制 dist 冒烟 + dist 全量 harness；CI 双形态冒烟 |
| 商店审核对压缩代码可读性的疑虑 | 审核延迟 | 只做常规 bundle+minify，不做混淆；源码仓库公开可作参照 |
| dist 被误提交 | 仓库膨胀 | `.gitignore`；CI 检查 |
| 性能优化回归交互契约 | 键盘/焦点/菜单退化 | §4.1 原则：契约优先；每项 P0 绑定对应单测套件；dist 全量 harness 发版前必跑 |
| 性能优化无实测依据空转 | 白做或负优化 | §3.7 基线优先；无显著变化即回滚或降级 |

---

## 附录 A：4.1.0 工作区 dry-run 实测数据

构建实测（esbuild 0.28.2 + Terser 5.50.0，`toplevel:false`）：

```text
ESM 入口 bundle → Terser：
  background               56.2 KiB -> 26.6 KiB   （11 输入 / 119.0 KiB 源码）
  fuzzy                     4.4 KiB ->  2.0 KiB   （ 2 输入 /   9.4 KiB）
  neat                    532.2 KiB -> 271.3 KiB   （52 输入 / 1074.7 KiB）
  options-palette-commands 14.1 KiB ->  8.9 KiB   （ 3 输入 /  26.5 KiB）
  options-proxy             6.8 KiB ->  4.0 KiB   （ 2 输入 /  14.5 KiB）
  favicons                 19.8 KiB -> 11.4 KiB   （ 7 输入 / 121.5 KiB）
  bundle 产物 import/export 残留：0（逐文件扫描）

经典脚本 Terser（分开压缩）：
  popup 5 件   50.5 KiB -> 13.3 KiB
  options 6 件 138.5 KiB -> 71.4 KiB
  favicons 2 件 34.8 KiB ->  9.3 KiB
  advanced-options 0.2 KiB -> ~0

Phase 1B 复测（拼接后再压，与分开压完全相同）：
  popup 13.3 = 13.3 KiB；options 71.4 = 71.4 KiB；favicons 9.3 = 9.3 KiB
  全局契约属性名全部保留；IIFE 形参被 mangle（})(e) 形态），校验须查属性名

压缩器对比（neat bundle）：Terser 271.3 KiB vs esbuild minify 273.5 KiB（+0.8%）

zip 实测（package.py 同口径 collect + deflate 默认级别；实测 level 6 与 level 9 结果相同）：
  源码直出：134 文件 / 71 JS / JS 1309.7 KiB / zip 1130.3 KB
  dist 出包： 78 文件 / 15 JS / JS  398.1 KiB / zip  850.2 KB
  变化：JS 字节 -69.6%，zip -24.8%
  （dist 出包要求 §2.6 的种子集合改造先行，否则 38 个内部模块报 missing）
  （复测时点：2026-08-22 HEAD 64c5e0b；较初稿的 1120.5/842.1 差异来自非 JS 内容快照，JS 字节与文件数口径完全一致）
```

性能实测（M4，scripts/harness/perf-popup.js，Docker headless，10 次中位数；种子 = 3000 书签含 100 深层子文件夹 + 50 个标签页）：

| 口径 | 源码 | dist | 变化 |
|---|---|---|---|
| popup 冷开 wall（ms） | 1024.0 | 980.0 | -4.3% |
| popup 冷开 scripting（ms） | 154.4 | 125.8 | **-18.5%** |
| popup 冷开布局数 | 16 | 16 | 0 |
| SW 冷启动 | 未录取 | — | 本版 Chromium 无 ServiceWorker CDP 域，列为已知限制 |

**P1 收尾后复测（2026-08-22，同一 Docker 环境连续两次，C.7 批次后）**：

| 口径 | 源码 | dist | 变化 |
|---|---|---|---|
| popup 冷开 wall（ms） | 982.0 | 910.0 | **-7.3%** |
| popup 冷开 scripting（ms） | 169.7 | 164.3 | **-3.2%** |
| popup 冷开布局数 | 16 | 17 | +1 |

注：① 树重建无独立触发（bookmark 事件不重建树；generateTree 是冷开主成本），口径并入冷开；② Rendering/Painting 时长本版 Chromium 恒为 0；③ tabGroups 分组在 headless 不可用（不影响徽章种子）；④ 基线为 M3 落地后的 4.1.0 形态（P0 与构建同批实施，P0 前后对比未单独录取——P1 若开展以本表为基准）。探针可复跑：bash scripts/harness/run.sh --perf 与 --dist --perf；量级化复测（任意 ext-root / 自定义种子）：scripts/harness/perf-run.sh <ext-root> --out <dir>，见下方「用户量级复测」。⑤ P1 复测的绝对数值整体高于 M4 档（机器负载/镜像状态差异），但源码 vs dist 的相对优势保持（wall -7.3%、scripting -3.2%），未出现 P1 引入的 dist 回归。


### 用户量级复测（6000+ 书签 / 深层嵌套 / 跨层级重复，2026-08-22，附录 A 补充）

**Profile（按维护者真实量级构造）**：`VBM_PERF_BOOKMARKS=6000`（4500 唯一叶子 + 500 组 × 3 份跨层级副本 = 6000），L1 20 × L2 5 × L3 3 = 420 个嵌套文件夹全部展开（树行 ≈ 6420），50 个后台标签页；重复副本落在 **L3 / L2 / L1 / dups-root 四个不同深度**（非同一层级的重复）。4.0.8 用 git worktree（tag v4.0.8），与 master 跑**同一份探针**：`scripts/harness/perf-run.sh <ext-root> --out <dir>`（env：`VBM_PERF_BOOKMARKS` / `VBM_PERF_DUP_RATIO` / `VBM_PERF_RUNS` / `VBM_PERF_DUPES_RUNS` / `VBM_PERF_SETTLE_MS`）。

**口径修正（对比 4.0.8 必需）**：dupes 视图在两个版本都会在启动时 hydrate `dupesLastResult` 快照，直接量“点开 dupes 标签”只能量到从快照 paint（4.0.8 甚至接近 0ms）。因此 dupes 口径改为：视图激活后触发 `bookmarks.onCreated`（新增一个唯一书签），等 `dupesLastResult.ts` 变化 + 400ms 渲染落地，量**整次 regroup（全树 flatten + findDupes + keeper 策略 + 2508 行 innerHTML）**。两次探针间机器负载有漂移（同一批连续跑的绝对数值整体上浮），故同时给 pooled 中位数与稳定区间。

**结果（pooled：4.0.8 13 次冷开 / 15 次 dupes；master 源码同；master dist 5+5 次单独窗口）**：

| 口径 | v4.0.8 | master 源码 | master dist | master 源码 vs 4.0.8 |
|---|---|---|---|---|
| popup 冷开 wall−settle（ms） | 261.0 | 219.0 | 140.0 | **-16.1%** |
| popup 冷开 scripting（ms） | 99.4 | 79.8 | 92.7 | **-19.7%** |
| popup 冷开布局数 | 15–16 | 18–19 | 17–18 | +3（4.1.0 新增 tab-groups 标签/徽章等 UI 层） |
| dupes regroup wall（ms） | 2660 | 3077 | 2448 | +15.7%（噪声范围） |
| dupes regroup scripting（ms） | 732.8 | 788.7 | 549.7 | +7.6%（噪声范围） |
| dupes 行数 | 2508 | 2508 | 2508 | 0 |

**解读**：
- 树/首屏路径是本次优化的主战场：6000+ 全展开量级下 cold scripting **-19.7%**、wall（扣除固定 settle）**-16.1%**——H1–H7/H9 + P1 快照/懒加载的收益在这个量级可复现。
- dupes regroup 两个版本稳定区间重叠（4.0.8 608–927ms，master 556–974ms），+7.6% 属噪声与 4.1.0 视图基础设施（tab-groups 注册、7 视图 updateBadges、菜单/焦点层）的开销，不是 P0/P1 的回归；dist 单独窗口还测到 549.7ms（最快）。要在 6000+ 重复量级再降，需 dupes 专项（findDupes 单趟分组 / 分片渲染，即 P2 判据内的工作）。
- 探针与对比脚本已入库：`scripts/harness/perf-run.sh`（任意 ext-root 专用 perf 容器）、`scripts/harness/perf-popup.js`（参数化种子 + settle 口径 + dupes regroup 相位）、`scripts/harness/perf-compare.js`（多份 perf.json 汇总）。

### 4.1.1 标签组视图与去重视图专项（2026-08-23，diag-41x-perf.js 函数级探针）

用户报告「点开标签组视图要等好几秒」+ 6000 书签量级去重视图卡顿。新增 `scripts/harness/diag/diag-41x-perf.js`（CDP Profiler 域，函数级 self-time；真实 windows/tabs/tab-groups 工作负载：4 窗 × (40 组 × 6 + 60 散) = 1200 标签 / 160 组 / 1371 行；dupes 沿用 6000/25% 种子 = 2508 行），同一探针跑优化前后。

**基线热点（优化前）**：标签组激活 wall≈1414ms、首内容 1064ms——`scrollIntoView`(599ms 强制全量布局) + render(175ms) + favicon 占位链路(~130ms) + 三跳串行 IPC(~100ms)；重渲染 wall≈1625-1965ms、`(program)`（innerHTML 解析+样式+布局）**1668ms** + `bookmarks.getTree` 每刷 53-106ms + 每行 7+ 次 `_m()`(getUILanguage 37ms)。dupes regroup wall≈2648ms、render 自身 469ms（同步解析）+ `(program)` 1576ms + normalizeUrl/URL ~70ms。

**落地项**（四个 commit：8b01d0f / 1555d9d / a1f06da / 9b6d918）：
1. `refresh()` 三路 IPC 并行 + 书签树脏标记（tab 事件风暴不再重走 getTree）
2. 组/标签查找 Map 化 + 组员单趟分桶（原 O(tabs×groups)）+ 每渲染 i18n 标签提升
3. favicon 占位 SVG 模板一次解析按需 clone；dupes `findDupes` 按原始 URL 串 memo normalizeUrl
4. `src/list-chunks.js` 分片渲染（head 同步 + rAF 批次追加；无 rAF/小列表退化单次 innerHTML）接入两视图
5. `neat.css` 重列表行 `content-visibility:auto`（屏外行跳过布局/绘制）

| 口径 | 优化前 | 优化后（终测，含 ul 注入修复） | 变化 |
|---|---|---|---|
| 标签组激活·首内容（firstDOM） | 1064 ms | 239 ms | **-78%** |
| 标签组激活·wall（至稳定） | 1414 ms | 680 ms | **-52%** |
| 标签组重渲染·wall | 1611-1965 ms | 976-1038 ms | **-40%（中位）** |
| 标签组重渲染·(program) | 1668 ms | ~541 ms | **-68%** |
| 标签组重渲染·getTree | 每刷 53-106 ms | 0（脏标记命中） | 消除 |
| dupes regroup·wall | 2372-2738 ms | 1071-1136 ms | **-57%（中位）** |
| dupes regroup·render 同步解析 | 469 ms（一整块） | ~2 ms（解析分散为分帧 insertAdjacentHTML ~360 ms） | 主线程不再长冻 |

**修复过程中的两处门禁拦截（真机门禁的价值记录）**：①list-chunks 首版把行片段拼在已闭合 `</ul>` 之后——真实解析器下 `<li>` 沦为 ul 兄弟节点，keyboard.js 的 `ul>li` 行选择器与全部 `#x-list ul li` CSS 规则落空（D1 键盘用例回归；字符串 double 单测全绿察觉不了，Docker 真机门禁捕获，diag-d1-repro.js 复现）；②content-visibility 选择器最初含 `#recent-list`——verify-scrollbars 31 例 computed overflow-x 读到 visible（机理未明的 Chromium 行为；recent 行数受 recentCount 上限约束本无屏外收益，已排除并复跑 ALL PASS 748）。

注：①分片渲染不减少总解析量，但把一整块 ~470ms 冻结摊成逐帧批次，首内容提前、UI 全程可交互；②`(program)`（样式/布局/绘制）的下降主要来自 content-visibility；③`scrollIntoView` 599→161ms（首开定位当前标签行）；④工作负载与种子前后完全一致，同一 Docker 环境连续跑；⑤验收：vitest 2696/2696 + lint 0 错、源码全量 harness ALL PASS（smoke + 键盘 156/0 + 滚动条 748）、dist 构建自检 + dist 全量 harness ALL PASS。复跑：`scripts/harness/rerun.sh diag/diag-41x-perf.js`（env：VBM_TG_WINDOWS/VBM_TG_GROUPS_PER_WIN/VBM_TG_TABS_PER_GROUP/VBM_TG_LOOSE）。

## 附录 B：本阶段明确不做的事

汇总 §2.8 与 §4.5：经典脚本拼接（Phase 1B，判据驱动）、CSS/HTML minify、激进 tree-shaking、经典脚本转 ESM、zip 内 sourcemap、代码混淆、把单元测试迁到 dist 上跑、虚拟滚动（P2 单独立项判据见 §4.5）。
---

## 附录 C：4.1.0 实施状态（2026-08-22 验收记录）

### C.1 交付总览

M1–M4 全部落地并通过验收；P1 三项与 H9 后续已随 4.1.0 收尾实施（C.7），P2 / Phase 1B 未达启动判据不启用。git 基线：`7334227`（计划文档）→ `ef04237`（收尾文档，M1–M4 批次共 14 个实施 commit），P1 收尾见 C.7。

| 里程碑 | 状态 | 关键证据 |
|---|---|---|
| M1 构建管线 | ✅ | `npm run build` 自检 PASS（78 文件 / 15 JS）；源码 zip 134 文件 / 1130.3 KB，dist zip 78 文件 / 850.2 KB（附录 A）；webstore 契约 29/29 |
| M2 门禁平移 | ✅ | `run.sh --dist --smoke-only` PASS；dist 全量 harness PASS 4/FAIL 0（M3 前后各一次）；源码全量 harness PASS 4/FAIL 0；CI 三处更新；AGENTS.md + docs/README*.md（中英）更新 |
| M3 性能 P0 | ✅ | H1–H7+H9 逐项独立 commit；全量 2648 用例 + lint 全绿；dist 全量 harness 额外抓到 H5 漏改点（favicon-gallery）并修复（b838eec） |
| M4 实测与决策 | ✅ | perf-popup.js 探针落地并出数（附录 A）；决策：P1 于 4.1.0 收尾实施（C.7）、P2/Phase 1B 不启动 |

### C.2 M1 交付物

- `scripts/runtime-files.json`（单一事实源，build/package 共用）
- `scripts/build.mjs`（构建即自检 6 项，任一失败非零退出）
- `scripts/package.py` 新增 `--root`（清单改读 JSON；JS 种子 = 15 文件；zip 恒写仓库 `tmp/`；EXCLUDE_DIRS 加 `dist`）
- `package.json`：esbuild@0.28.2 / terser@5.50.0 精确锁定（`--save-exact`）+ `build`/`package`/`package:src`/`package:edge`
- `.gitignore` 加 `dist/`

### C.3 M2 交付物

- `scripts/harness/run.sh` `--dist`（dist 树进镜像，未构建则报错）+ `--perf`（跑探针）；`Dockerfile` 收录 perf-popup.js；头部键盘断言注释 132→153
- CI（`.github/workflows/ci.yml`）：`test` job 改 dist 构建+出包；`smoke` job 源码+dist 双冒烟；`harness-full` 双全量（dist 为 4.1.0 强制门禁）
- AGENTS.md：tech stack / Build / Packaging / Release Step 0（三段冒烟）/ Step 1（npm run package）/ harness 描述；docs/README.md + README.zh.md 开发与打包说明

### C.4 M3 逐项记录

| 项 | commit | 行为变更 | 绑定套件 |
|---|---|---|---|
| H1 | `3ee0bf3` | 删 tree-view 的 `search.updateIndex`（search.js 已有 dirty + 首搜懒构建） | tree-view / search |
| H2 | `47a2461` | tooltip 全量 pass → `$tree` mouseover/focusin 事件委托，单行惰性检测 | tree-view |
| H3 | `cb63c31` | `getFaviconUrl` 手动序列化（14 条真实语料逐字节对齐 URLSearchParams，含 `!'()~` 与空格编码差异） | tree-render |
| H4 | `91a63f3` | 删渲染后全量同步徽标刷新；sync-manager 初始 blob 按 id 派发 syncStatusChanged | tree-view / sync-manager-client / sync-ui |
| H5 | `95fb154` + `b838eec` | buildPathMap 单趟产出 `{ paths, ids }`（favicon-gallery 直接调用点修复，dist harness 抓到） | tree-render / view-manager / visit-stats / favicon-gallery |
| H6 | `0fe2aa7` | dead overlay 按 id 定点更新 + 无标记快速返回（零 DOM 查询） | view-dead |
| H7 | `a7a3f88` | dupes keeper 每 render 只算一遍（memo 随 groups 引用失效） | view-dupes |
| H9 | `faf65d2` + C.7 | tab-groups 未激活 refresh 改 count-only（跳过 queryAllGroups/readClosedGroups/折叠对账）；后续：未激活仅 onCreated/onRemoved 触发 + 1s 防抖 | view-tabgroups |

### C.5 M4 实测与决策

- 探针：`scripts/harness/perf-popup.js`（3000 书签 / 100 深层子文件夹 / 50 标签页种子；CDP Performance 域；`--perf` / `--dist --perf` 可复跑），数据见附录 A。
- 决策：
  - **P1 于 4.1.0 收尾实施**：冷开 scripting 中位 126–154 ms 且 dist 已 -18.5%，P0 收益达成；P1 三项（单趟快照 / idle 队列 / SW 精益化）在 4.1.0 末期以低风险独立 commit 落地（C.7），不再顺延。
  - **P2 不启动**：无 >100 ms 长任务证据，未达 §4.5 判据。
  - **Phase 1B 不启用**：未达 §2.8 判据（script 请求/解析占比 >5% 无证据）。
- 已知限制与后续（不阻塞发布）：SW 冷启动口径待换用支持 ServiceWorker CDP 域的 Chromium/puppeteer 补录；Rendering/Painting 指标本版 Chromium 不提供；H9 后续已实施（C.7），不再留档。

### C.6 验收证据汇总

- `npm run build`（自检 PASS）多次；`npm run test:run` **2648/2648**；`npm run lint` **0 错**；`npm run test:webstore` **29/29**
- `scripts/harness/run.sh --dist --smoke-only`：**PASS**
- `scripts/harness/run.sh --dist`（全量）：**PASS 4 / FAIL 0**（M3 前、M3 后各一次）
- `scripts/harness/run.sh`（源码全量）：**PASS 4 / FAIL 0**
- §3.6 手动冒烟矩阵：自动化层全部覆盖并通过（smoke 覆盖 popup/panel/options/favicon 画廊/公告/命令面板/重定向；keyboard/scrollbar/menu 层覆盖键盘、滚动条、菜单矩阵）；视觉截图类检查点属发布 SOP（scripts/screenshots/run.sh），本批次未单列执行。


### C.7 P1 收尾实施记录（4.1.0 末期）

| 项 | commit | 行为变更 | 绑定套件 |
|---|---|---|---|
| P1-1 单趟快照 | `dba358e` | `buildTreeSnapshot(tree, subTree)` 单次快照遍历产出 `{ html, nodeTrees, bookmarkIds, paths, ids }`（paths/ids 覆盖全树，行级数据以 tree-view 选定子树为准）；tree-view 与 neat.js onTreeGenerated（经 `views.setPathMap`）消费同一快照，删掉 generateNodeTrees/addBookmarkParents/buildPathMap 三趟重复遍历 | tree-render / tree-view / view-manager |
| P1-2 idle 队列 | `87c6d6c` | 新增 `src/idle.js`（`deferIdle` + `?perf=1` 启用的 `performance.mark`）；远程公告 fetch、favicon 补全 hydrate（`deferHydrate`，`ensureHydrate()` 防 null-await 竞态：渲染期先入队的行会立即启动 hydrate 而不是绕过等待）、启动期三个视图的徽章预载全部延后到首渲染后的 idle 队列（requestIdleCallback + timeout，退化 setTimeout 0）；github mirror 刷新链随公告一并延后，失败语义不变 | idle / favicon-enrich / neat-boot / smoke |
| P1-3 SW 精益化 | `516aab0` | visit-stats 的整树 URL 索引不再于 SW 冷启动 eager 读取（`bookmarks.getTree` 移出 start()），首次 URL 导航或首个 bookmark 事件时经 `indexReady` 门控懒构建；首个命中事件在构建完成后继续匹配（`ensureIndex` 把构建期间的导航风暴合并成一次 `getTree`） | visit-stats-sw / background |
| H9 后续 | `d7ff224` | tab-groups 未激活时仅 `tabs.onCreated`/`onRemoved` 触发徽章刷新，防抖降到 1s（`INACTIVE_REFRESH_MS`）；onMoved/onUpdated/onActivated/onAttached/onDetached/tabGroups/bookmarks 事件只服务激活视图的 300ms 重渲染 | view-tabgroups |

验收（本批次）：全量 `npm run test:run` **2665/2665** + lint **0 错**；`npm run build` 自检 PASS（78 文件 / 15 JS）；`npm run package` + `test:webstore` 29/29；源码与 dist 冒烟均 PASS；dist 全量 harness **PASS 4 / FAIL 0**；perf 探针源码+dist 复测见附录 A（P1 后）。
