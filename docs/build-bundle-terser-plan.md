# vBookmarks 构建改造落地方案：ESM Bundle + Terser

> 状态：调研完成，dry-run 已验证，等待评审后实施。
> 适用版本：4.0.8（工作区含 favicon 画廊等 4.0.9 未提交代码）。
> 目标：在不改变源码开发体验（仓库根目录仍可直接 Load unpacked）的前提下，新增 `dist/` 构建产物，把 ESM 模块图打包成单文件、经典脚本做 Terser 压缩，最后从 `dist/` 出包。

---

## 0. 结论摘要

1. **值得做，但要分清楚收益来源。** 当前 popup/sidepanel 实际加载 **57 个 JS 文件 / 974.2 KiB 源码**，其中绝大多数是 `neat.js` 的 ESM 依赖图。真正的大头是「ESM bundle」，Terser 是最后一道压缩。
2. **经典模块的拼接 bundle 已验证可行，但一期不启用。** 调研与 dry-run 显示：经典脚本可安全拼接 + Terser（全局契约保留），但收益只有「每页少 1~4 个 script 文件」，体积几乎不变，本地扩展文件请求的开销又很小；因此一期保留为独立文件、只做 Terser，HTML 零改动。经典拼接作为可选的 Phase 1B，详见 §2.2。
3. **采用「同路径入口打包」：不改任何 HTML/manifest 引用路径。** 对每个 ESM 入口（`background.js` / `fuzzy.js` / `neat.js` / `options-palette-commands.js` / `options-proxy.js` / `favicons.js`）用 esbuild 打成同名的单文件 bundle，再用 Terser 压缩。源码根目录继续可 Load unpacked，`dist/` 才是发布目录。
4. **本方案已在当前工作区做过 dry-run**（esbuild bundle + terser + 按运行时文件集重新打包），全部入口可打包，产物无 `import`/`export` 残留，关键 `window.*` 全局契约保留。实测数据见 §5。

---

## 1. 现状调研

### 1.1 加载模型

仓库无构建步骤，扩展根目录就是仓库根目录。页面通过根绝对路径 `/src/*.js` 加载脚本：

- **经典脚本**（无 `type="module"`）：HTML 解析时同步执行，按标签顺序保证先后依赖。
- **ES 模块**（`type="module"`）：浏览器 defer，按模块图异步求值；HTML 中的相对顺序仍决定多个入口模块的执行先后（`fuzzy.js` 在 `neat.js` 之前）。
- 没有任何动态 `import()`（已全仓搜索确认）。
- CSP 为 `script-src 'self'`，打包产物仍是扩展自托管文件，不受影响。

### 1.2 页面脚本清单

| 页面 | 经典脚本（同步） | 模块脚本 |
|---|---|---|
| popup.html | `/src/store.js`, `/src/i18n-live.js`, `/src/popup.js`, `/src/sync-manager.js`, `/src/sort-utils.js` | `/src/fuzzy.js`, `/src/neat.js` |
| sidepanel.html | 同上 | 同上 |
| options.html | `/vendor/codemirror.js`, `/src/store.js`, `/src/i18n-live.js`, `/src/sort-utils.js`, `/src/storage-usage.js`, `/src/options.js` | `/src/options-palette-commands.js`, `/src/options-proxy.js` |
| advanced-options.html | `/src/advanced-options.js` | — |
| favicons.html | `/src/store.js`, `/src/i18n-live.js` | `/src/favicons.js` |
| manifest.json（SW） | — | `src/background.js`（`"type": "module"`） |

### 1.3 ESM 模块图（打包的主要对象）

用与 `scripts/package.py` 相同的 import 解析逻辑实测：

| 入口 | 当前文件数 | 当前源码体积 |
|---|---|---|
| popup/sidepanel（`fuzzy.js` + `neat.js` + 5 个经典脚本） | 57 | 974.2 KiB |
| service worker（`background.js`） | 11 | 107.4 KiB |
| options（6 经典 + 2 模块） | 11 | 175.7 KiB |
| favicons（2 经典 + `favicons.js`） | 9 | 149.2 KiB |

`neat.js` 直接 import 30 个模块（separators、dialogs、search、actions、context-menu、keyboard、dnd、tree-render、tree-view、sync-ui、palette、undo、view-manager、view-recent、view-dupes、view-dead、visit-stats、view-stats、visit-stats-sw、favicon-fallback、favicon-enrich、userstyle、resize、folder-sort、quick-add、donation、announce、tool-button、wake-up、settings），这些模块又各自下钻，最终形成 50+ 文件的图。

### 1.4 经典模块逐一调研

| 文件 | 形态 | 暴露契约 | 依赖的前置全局 |
|---|---|---|---|
| `src/store.js` | 顶层 `(() => {...})()` | `window.store`（含 `store.ready`、`store.get/set/remove/adopt`、`store.syncKeys`、`getSyncSetting/setSyncSetting`）、`window.getSetting/setSetting/removeSetting` | 仅 `chrome.*` / `window` |
| `src/i18n-live.js` | 顶层 IIFE | `window.VBMI18N`（`currentLang/selectedLang/supportedLangs/setLang`） | `window.store`（可空判断）、`chrome.i18n` |
| `src/popup.js` | `(window => {...})(window)` | 无对外 API；负责主题预涂、panel 心跳、popup 尺寸 | `store`、`getSetting/setSetting`（store.js） |
| `src/sync-manager.js` | 顶层 IIFE | `window.syncManager` | `chrome.storage.session`、`chrome.runtime` |
| `src/sort-utils.js` | `(window => {...})(window)` | `window.VBMSort` | `Intl` |
| `src/storage-usage.js` | 顶层 IIFE | `window.VBMUsage` | 无 |
| `src/options.js` | 顶层 `const $ = ...` + IIFE | 无对外 API；经典脚本，无法 import | `store`、`getSetting/setSetting`、`window.VBMI18N`、`window.VBMSort`、`window.VBMUsage`、`window.CodeMirror` |
| `src/advanced-options.js` | 单条 `window.location.replace(...)` | 无 | `window.location` |
| `vendor/codemirror.js` | `var CodeMirror = function(){...}()` | `window.CodeMirror`（经典脚本顶层 `var` 自然成为全局） | `window` |

关键结论：

- 经典脚本之间**没有 ESM import**，全部通过 `window.*` 和加载顺序通信。
- 除 `options.js` 有一个顶层 `const $`、`codemirror.js` 有一个顶层 `var CodeMirror` 外，其余经典脚本都把顶层声明关在 IIFE 里，**互不污染、没有命名冲突**。
- 所有 ESM 模块对经典层的依赖都是 `window.store` / `window.VBMSort` / `window.VBMFuzzy` / `window.syncManager` / `window.VBMI18N` 这种显式全局引用，esbuild 打包后这些自由变量会原样保留（已 dry-run 验证）。

### 1.5 全局契约清单（打包必须保留）

| 全局名 | 生产者 | 消费者（ESM 内） |
|---|---|---|
| `store` | `store.js` | `neat.js`（IIFE 开头 `const store = window.store`）、`dialogs.js`、`tree-render.js`、`search.js`、`actions.js`、`sync-ui.js`、`folder-sort.js`、`quick-add.js`、`tool-button.js`、`startup-flags.js` 等 |
| `getSetting/setSetting/removeSetting` | `store.js` | `popup.js`、`options.js` |
| `VBMI18N` | `i18n-live.js` | `palette.js`（`/lang`）、`options.js`（语言下拉） |
| `VBMSort` | `sort-utils.js` | `dialogs.js`、`folder-sort.js`、`neat.js`、`options.js` |
| `syncManager` | `sync-manager.js` | `tree-render.js`、`search.js`、`sync-ui.js`、`actions.js` |
| `VBMUsage` | `storage-usage.js` | `options.js` |
| `VBMFuzzy` | `fuzzy.js`（ESM） | `palette.js`、`search.js` |
| `CodeMirror` | `vendor/codemirror.js` | `options.js` |

Terser 对经典脚本必须使用 `toplevel: false`，否则会破坏上述顶层全局。

---

## 2. 改造空间评估

### 2.1 ESM 图：空间大，做 bundle

- `neat.js` 图 50+ 文件、974 KiB，是 popup 每次打开都要 full-parse 的主要体积。
- esbuild 对 6 个 ESM 入口全部 bundle 成功（dry-run），产物是纯 ESM 单文件，无 `import` 残留。
- 打包后 popup 只剩 2 个模块文件，文件数从 57 降到 7（含 5 个经典脚本）。

### 2.2 经典模块：拼接 bundle 可行，但收益只有文件数

逐文件拼接 + Terser 的 dry-run 已验证可行。四个页面的经典集合按 HTML 原有顺序拼接后，用 Terser 5.50.0（`module:false, toplevel:false, compress:true, mangle:true`）压缩：

| 集合 | 拼接前 | 拼接后体积 | 文件数变化 |
|---|---|---|---|
| popup/sidepanel（store + i18n-live + popup + sync-manager + sort-utils） | 49.4 KiB | 12.9 KiB | 5 → 1 |
| options（codemirror + store + i18n-live + sort-utils + storage-usage + options） | 134.8 KiB | 69.8 KiB | 6 → 1 |
| favicons（store + i18n-live） | 33.7 KiB | 9.0 KiB | 2 → 1 |
| advanced-options | 0.2 KiB | ~0 KiB | 1 → 1 |

**为什么可行**：

- 每个经典脚本都把顶层声明关在 IIFE 里，只有 `options.js` 的顶层 `const $` 和 `codemirror.js` 的顶层 `var CodeMirror` 例外；两者无命名冲突，按原 HTML 顺序直接拼接即可。
- 脚本间依赖完全靠 `window.*` 全局，拼接后仍按顺序执行，契约不变。
- Terser `toplevel:false` 会保留顶层全局。dry-run 检查确认 `window.store`、`getSetting/setSetting/removeSetting`、`VBMI18N`、`syncManager`、`VBMSort`、`VBMUsage` 均保留。
  - 注意：Terser 会把 `(window => {...})(window)` 的形参 mangle 成短名（如 `e.VBMSort = ...`），所以产物静态校验必须查 `})(window)` 调用和全局名，而不是只查字面 `window.VBMSort=`。

**代价与收益**：

- 需要 build.mjs 在生成 dist HTML 时把多个经典 `<script src>` 替换成一个 `<script src="/src/popup-classic.js">`（源码 HTML 不动）。
- 体积几乎不变（拼接与分开 minify 字节数相同），只减少每页 1~4 个 script 请求；扩展脚本是本地文件，文件请求开销很小。
- 结论：**可行但收益低，一期不启用**；一期仍按 §3 做「经典脚本单独 minify、HTML 零改动」。把「经典脚本拼接 bundle」列为 **Phase 1B 可选**：如果 §6.3 实测发现 popup 打开的 script 解析/请求开销明显，再启用。
- 更激进的「经典脚本转 ESM 再并入 neat bundle」路线收益同样有限，且需要重构所有 `window.*` 消费者（约 9 个模块），本方案不采纳。

---

## 3. 目标方案：同路径入口打包（same-path entry bundling）

### 3.1 核心思路

构建时生成 `dist/`，**目录结构镜像源码**：

- `dist/manifest.json` 仍指向 `src/background.js`。
- `dist/pages/*.html` 仍引用 `/src/fuzzy.js`、`/src/neat.js` 等原有路径。
- 区别是 `dist/src/neat.js` 不再是 42 KiB 的入口源码，而是「整张 neat 模块图 + Terser」后的单文件 bundle。

这样**源码和 HTML 完全不动**，开发态（根目录 Load unpacked）和发布态（`dist/` Load unpacked / 打包）并存。

### 3.2 文件流向

```text
源码（仓库根，开发用）                  dist/（发布用）
─────────────────────────              ─────────────────────────
manifest.json        ──复制──────────▶  manifest.json
pages/*.html         ──复制──────────▶  pages/*.html
css/*.css            ──复制──────────▶  css/*.css
vendor/codemirror.css──复制──────────▶  vendor/codemirror.css
vendor/codemirror.js ──Terser────────▶  vendor/codemirror.js
assets/icons/*       ──复制──────────▶  assets/icons/*
_locales/*           ──复制──────────▶  _locales/*
docs/README*.md, license.txt ──复制──▶  同名

src/background.js ──esbuild bundle──▶ src/background.js ──Terser──▶ src/background.js
src/fuzzy.js      ──esbuild bundle──▶ src/fuzzy.js      ──Terser──▶ src/fuzzy.js
src/neat.js       ──esbuild bundle──▶ src/neat.js       ──Terser──▶ src/neat.js
src/options-palette-commands.js ──bundle──▶ ... ──Terser──▶ 同名
src/options-proxy.js            ──bundle──▶ ... ──Terser──▶ 同名
src/favicons.js                 ──bundle──▶ ... ──Terser──▶ 同名
src/store.js, i18n-live.js, popup.js, sync-manager.js,
  sort-utils.js, storage-usage.js, options.js,
  advanced-options.js          ──Terser（不 bundle）──▶ 同名
```

### 3.3 工具选型

| 工具 | 用途 | 理由 |
|---|---|---|
| esbuild | 只做 bundle（`minify: false`） | 仓库已有（vitest 依赖树内），API 简单，对 ESM 图处理可靠；不替代 Terser |
| Terser | 最终压缩（`compress + mangle`） | 需求指定；对 bundle 后的 ESM 和经典脚本都能安全压缩 |
| `scripts/package.py` | 从 `dist/` 出 zip | 保留现有校验（missing import / stray files）与 Edge 目标支持 |

> 注：esbuild 自身的 minify 也可用，但按需求统一用 Terser 作为最终压缩器，esbuild 只负责模块解析与拼接。

### 3.4 为什么 HTML 一行都不用改

HTML 里所有模块脚本路径（`/src/neat.js` 等）在 dist 中仍然存在，只是文件内容变成 bundle。经典脚本路径也不变。因此：

- 源码 HTML 与 dist HTML 完全一致（构建脚本直接复制，不重写）。
- 回归面最小：`tests/` 里读 `pages/*.html` 的测试不会受任何影响。

> Phase 1B（经典脚本拼接）是唯一会重写 dist HTML 的可选项；一期默认不启用。

---

## 4. 详细落地设计

### 4.1 新增/修改文件清单

| 操作 | 文件 | 说明 |
|---|---|---|
| 新增 | `scripts/build.mjs` | 构建脚本：清理 dist → 复制静态文件 → bundle ESM 入口 → Terser 全部 JS |
| 新增 | `scripts/runtime-files.json` | 运行时文件清单（单一事实源，供 build.mjs 与 package.py 共用） |
| 修改 | `package.json` | 增加 `build` / `package` 脚本，`devDependencies` 增加 `esbuild`、`terser` |
| 修改 | `scripts/package.py` | 增加 `--root` 入参；`JS_FILES` 从 runtime-files.json 读取种子 |
| 修改 | `.gitignore` | 增加 `dist/` |

### 4.2 `scripts/runtime-files.json`

把现在散落在 `package.py` 顶部的清单抽出来，build 和 package 共用，避免两份清单漂移：

```json
{
  "html": [
    "pages/popup.html",
    "pages/sidepanel.html",
    "pages/options.html",
    "pages/advanced-options.html",
    "pages/favicons.html"
  ],
  "css": [
    "css/neat.css",
    "css/options.css",
    "css/sync-styles.css",
    "css/favicons.css",
    "vendor/codemirror.css"
  ],
  "images": [
    "assets/icons/icon.png",
    "assets/icons/icon16.png",
    "assets/icons/icon32.png",
    "assets/icons/icon48.png",
    "assets/icons/icon128.png",
    "assets/icons/icon.svg"
  ],
  "meta": [
    "license.txt",
    "docs/README.md",
    "docs/README.zh.md"
  ],
  "classicJs": [
    "vendor/codemirror.js",
    "src/store.js",
    "src/i18n-live.js",
    "src/popup.js",
    "src/sync-manager.js",
    "src/sort-utils.js",
    "src/storage-usage.js",
    "src/options.js",
    "src/advanced-options.js"
  ],
  "esmEntries": [
    "src/background.js",
    "src/fuzzy.js",
    "src/neat.js",
    "src/options-palette-commands.js",
    "src/options-proxy.js",
    "src/favicons.js"
  ]
}
```

> `src/background.js` 由 `manifest.json` 的 `background.service_worker` 决定，构建脚本可交叉校验 manifest 中的值必须在 `esmEntries` 内，防止清单漂移。

### 4.3 `scripts/build.mjs` 伪代码

```js
import { build } from 'esbuild';
import { minify } from 'terser';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = process.cwd();           // 仓库根
const dist = join(root, 'dist');
const manifest = JSON.parse(readFileSync(join(root, 'scripts/runtime-files.json'), 'utf8'));

rmSync(dist, { recursive: true, force: true });

// 1. 复制静态文件（html/css/images/meta/_locales/manifest.json）
for (const f of [...manifest.html, ...manifest.css, ...manifest.images, ...manifest.meta, 'manifest.json']) {
    copy(f, join(dist, f));
}
copyDir('_locales', join(dist, '_locales'));

// 2. ESM 入口：esbuild bundle（不 minify）到内存，再 Terser，写到 dist 同名路径
for (const entry of manifest.esmEntries) {
    const bundled = await build({
        entryPoints: [entry],
        bundle: true,
        format: 'esm',
        platform: 'browser',
        write: false,
        minify: false,
        logLevel: 'silent',
    });
    const code = bundled.outputFiles[0].text;
    const result = await minify(code, {
        module: true,
        toplevel: false,
        compress: true,
        mangle: true,
        format: { comments: false },
    });
    write(join(dist, entry), result.code);
}

// 3. 经典脚本：原样 Terser（不 bundle），写到 dist 同名路径
for (const file of manifest.classicJs) {
    const code = readFileSync(file, 'utf8');
    const result = await minify(code, {
        module: false,
        toplevel: false,          // 关键：保护 window.store / VBMSort / CodeMirror 等
        compress: true,
        mangle: true,
        format: { comments: false },
    });
    write(join(dist, file), result.code);
}
```

关键配置说明：

| 配置 | 值 | 原因 |
|---|---|---|
| esbuild `format` | `'esm'` | 入口是 ESM，SW 也是 `"type": "module"` |
| esbuild `minify` | `false` | minify 交给 Terser，保持职责单一 |
| esbuild `platform` | `'browser'` | 保留 `chrome.*`、`window.*` 等浏览器全局，不做 node polyfill |
| Terser `module` | ESM 入口 `true`，经典脚本 `false` | 让 Terser 正确处理模块语法 |
| Terser `toplevel` | 一律 `false` | 保护所有顶层全局契约 |
| Terser `mangle` | `true`，不配 `properties` | 默认只改局部变量名，不动属性名，DOM/API 安全 |

### 4.4 `scripts/package.py` 修改点

1. **新增 `--root` 参数**（默认仍为仓库根目录）：

```python
parser.add_argument(
    '--root',
    help='Package from this directory (default: repository root). '
         'Use dist/ after running npm run build.'
)
```

2. **输入根目录与输出目录分离**：

```python
repo_root = get_repo_root()
input_root = os.path.abspath(args.root) if args.root else repo_root
manifest = load_manifest(input_root)
...
included = collect_files(input_root, manifest)
# 输出 zip 始终放仓库 tmp/，避免写进 dist/
out_dir = os.path.join(repo_root, 'tmp')
```

3. **`JS_FILES` 改为从 `scripts/runtime-files.json` 读取**：

```python
with open(os.path.join(repo_root, 'scripts', 'runtime-files.json'), encoding='utf-8') as f:
    RUNTIME_FILES = json.load(f)
JS_FILES = RUNTIME_FILES['classicJs'] + RUNTIME_FILES['esmEntries']
```

这样：
- **源码根打包（`python3 scripts/package.py`）**：入口仍是带 import 的源码，`resolve_js_imports()` 会自动把整张 ESM 图补进 zip，行为与现在完全一致（133 文件）。
- **dist 打包（`python3 scripts/package.py --root dist`）**：入口已是无 import 的 bundle，resolver 不会补充任何文件，zip 只含 15 个 JS 文件（78 文件）。

4. `HTML_PAGES` / `CSS_FILES` / `IMAGES` / `META_FILES` 同样从 `runtime-files.json` 对应字段读取（去掉 package.py 里的硬编码副本）。

### 4.5 `package.json` 与 `.gitignore`

```jsonc
{
  "scripts": {
    "build": "node scripts/build.mjs",
    "package": "npm run build && python3 scripts/package.py --root dist",
    "package:edge": "npm run build && python3 scripts/package.py --root dist --target edge"
  },
  "devDependencies": {
    "esbuild": "^0.28.0",
    "terser": "^5.50.0"
  }
}
```

`.gitignore` 增加：

```gitignore
dist/
```

---

## 5. 预期结果（当前工作区 dry-run 实测）

### 5.1 每页加载的 JS 体积与文件数

| 页面 | 当前文件数 | 当前体积 | 改造后文件数 | 改造后体积 | 体积降幅 |
|---|---|---|---|---|---|
| popup / sidepanel | 57 | 974.2 KiB | 7（5 经典 + 2 bundle） | 236.1 KiB | **-75.8%** |
| service worker | 11 | 107.4 KiB | 1 | 23.7 KiB | **-77.9%** |
| options | 11 | 175.7 KiB | 8（6 经典 + 2 bundle） | 82.7 KiB | **-52.9%** |
| favicons | 9 | 149.2 KiB | 3（2 经典 + 1 bundle） | 19.9 KiB | **-86.7%** |

（体积均为 Terser 5.50.0 实测输出；经典脚本使用 `toplevel: false`，ESM 入口为 esbuild bundle 后再 Terser。）

### 5.2 打包产物

| 指标 | 当前（源码直出） | 改造后（dist 出包） | 变化 |
|---|---|---|---|
| zip 内文件数 | 133 | 78 | **-55** |
| zip 内 JS 文件数 | 70 | 15 | **-55** |
| zip 内 JS 字节数 | 1152.3 KiB | 342.9 KiB | **-70.2%** |
| zip 大小 | 1027.4 KB | 769.9 KB | **-25.1%** |

（基线为当前 `scripts/package.py` 实测；改造后为按 §4 方案 dry-run 生成的同口径 zip。）

### 5.3 性能预期

- **popup/sidepanel 打开**：JS 解析输入从 974 KiB 降到 236 KiB，且模块文件从 57 个降到 7 个。冷启动（无 V8 code cache 或缓存失效时）预计可观察到**个位数到低两位数毫秒**的改进；热启动（code cache 命中）改进更小。当前 popup 的主要耗时仍是 `chrome.bookmarks` 树读取与 DOM 渲染，所以这不是「翻倍变快」。
- **MV3 service worker 冷启动**：从 11 文件 / 107 KiB 降到 1 文件 / 24 KiB。SW 冷启动对体积敏感，这里收益相对最实在。
- **运行时执行速度**：基本不变（Terser 的 `compress` 有少量常量折叠/死代码消除，但函数与调用路径不变）。
- **商店包与磁盘占用**：包体 -25%，安装后 JS 磁盘占用 -70%。
- 上述为推断，**落地后必须用 §6.3 的真实浏览器性能测试实测确认**，而不是把体积数据当成速度数据。

### 5.4 运行时性能压榨专项（配合 bundle 后落地）

> 用户反馈「个别视图已经有点慢」。构建改造只解决加载/解析，不解决渲染慢；本节给出一套按风险分层的运行时优化计划。除 P2 外，其余改动与 bundle 改造正交，可在同一发布周期落地。

#### 5.4.1 已定位的热点

| # | 热点 | 位置 | 代价 | 表现 |
|---|---|---|---|---|
| H1 | 每次 `generateTree` 都无条件重建搜索索引 | `src/tree-view.js:168`（`search.updateIndex(tree)`） | O(n) 全树遍历 + 每节点建对象 | 每次树重建白付一次全树 walk；搜索本应懒建索引 |
| H2 | 每次树渲染后全量 tooltip 布局检测 | `src/tree-view.js:249`（`setTimeout(adaptBookmarkTooltips,100)`） | 对所有 `li.child a` 做 `scrollWidth/offsetWidth`，强制布局 | 大树渲染后整树 reflow，最明显的单点 |
| H3 | 每行 favicon URL 构造 | `src/tree-render.js:144-149`（`getFaviconUrl`） | 每行 `new URL(...)` + `searchParams` | 大列表生成 HTML 时大量 URL 对象分配 |
| H4 | 每次树渲染后全量刷新同步徽标 | `src/tree-view.js:186-190` + `src/sync-ui.js:54-94` | O(行数) DOM 查询、删除、重建徽标 | 树渲染后整树 DOM 突变；与行内已生成的徽标重复 |
| H5 | `onTreeGenerated` 又做一次全树遍历 | `src/neat.js:593-607` | O(n) 遍历收集有效 id | 与 `buildPathMap` 的遍历重复 |
| H6 | dead overlay 无差别扫所有列表行 | `src/view-dead.js:963-995`（`refreshOverlays`） | 即使没有标记也逐 `li` querySelector | 每次树渲染多一轮 DOM 查询 |
| H7 | dupes 渲染重复计算 keeper/删除计划 | `src/view-dupes.js:264-265, 288, 347` | 每组多次 `pickKeeper`/`planDeletion` | 大重复组集时成倍计算 |
| H8 | 大列表整块 `innerHTML` 替换 | `tree-render.generateHTML` / 各视图 `$list.innerHTML = html` | 一次性 parse + layout 全部行 | 数千行时渲染长任务（P2 处理） |

#### 5.4.2 P0 快赢（建议与一期同时做，改动小、风险低）

| 项 | 改动 | 预期收益 | 风险 |
|---|---|---|---|
| H1 | 删除 `tree-view.js` 中的 `search.updateIndex(tree)`；`search.js` 已有 `onCreated/onRemoved/onChanged/onMoved` 的 dirty 监听和首次搜索时的懒构建路径（`search.js:557-563`） | 每次树重建少一次全树 walk + 建对象 | 低；需验证「首次搜索」「书签变更后立即搜索」两个路径仍能重建索引 |
| H2 | 删除 `setTimeout(adaptBookmarkTooltips,100)` 全量 pass；改为对 `$tree` 的 `mouseenter`/`focusin` 委托，仅对事件目标行做 overflow 检测并写 `title` | 消除每帧/每次渲染的 O(n) 强制布局 | 中；需回归键盘焦点、触控、RTL |
| H3 | `getFaviconUrl` 改为预计算 base + 字符串拼接：`const base = chrome.runtime.getURL('/_favicon/') + '?pageUrl='; ... base + encodeURIComponent(url) + '&size=32'` | 每行省一次 `URL` 构造和 searchParams 编码 | 低；注意 `encodeURIComponent` 与现有 `URL.searchParams` 编码行为对齐（`&`、`#`、`%` 等） |
| H4 | `sync-manager.js` 的 `init()` 在首次 `applySessionBlob` 后，为 blob 中每个 id 派发 `syncStatusChanged` 事件；`tree-view.generateTree` 删除全量 `refreshSyncIndicators()`。行内徽标由 `tree-render.generateBookmarkHTML/generateFolderHTML` 已生成，事件驱动负责增量更新 | 树渲染后少一次整树 DOM 突变 pass | 中；需验证首次打开、同步状态后到、sync 开关切换、options 改动四个场景 |
| H6 | `refreshOverlays()` 增加快速返回：`deadMarks.size === 0` 且页面无 `.dead-indicator` 时直接 return；有标记时只按 `deadMarks` 的 id 集合，用 `getElementById('neat-tree-item-'+id)` 等定点更新，不遍历全部 `li` | 无死链标记时树渲染几乎零开销；有标记时 O(marks) | 低；需回归死链标记在 tree/recent/results/dead/dupes 五个列表的叠加 |
| H7 | `view-dupes.js` 的 `render()` 先算一次 `keeperByGroup = new Map(groups.map(g => [g.key, keeperOf(g)]))`，`renderToolbar`/`renderGroup` 都读它 | 大重复组集避免重复策略计算 | 低；需回归选择模式、keeper 手动 pin、策略切换 |
| H5 | 把 `neat.js` 的 `onTreeGenerated` 中收集有效书签 id 的遍历合并进 `buildPathMap`（或让 `buildPathMap` 返回 `{ paths, ids }`），删掉第二遍 walk | 每次树重建少一次全树遍历 | 低；需同步更新 `visitStats.prune` 与相关单测 |

#### 5.4.3 P1 单次树遍历快照（中等重构）

当前 `generateTree` 一次至少做 5 遍树/行遍历：`generateHTML`、`generateNodeTrees`、`addBookmarkParents`、`search.updateIndex`、`onTreeGenerated`（buildPathMap + collect ids），再加 DOM 侧的 `adaptBookmarkTooltips`、`refreshSyncIndicators`、`refreshOverlays`。

建议在 `tree-render.js` 增加一个 **单遍历快照函数**：

```js
// 一次遍历产出全部派生数据
buildTreeSnapshot(tree) => {
  html,            // 树 HTML 字符串
  nodeTrees,       // id -> parentId
  bookmarkIds,     // 有效书签 id 集合（visitStats.prune 用）
  pathMap          // id -> '父 / 路径'
}
```

`tree-view.generateTree` 和 `neat.js` 的 `onTreeGenerated` 改为消费这一个快照。目标是把每轮树重建的 JS CPU 再砍掉一截，尤其对 3000+ 书签的大树。该重构有单测覆盖（`tests/tree-render.test.js`、`tests/tree-view.test.js`），建议作为独立的 P1 任务评审。

#### 5.4.4 P2 长列表渲染（最后手段）

如果 P0+P1 后「数千行树/死链/重复列表」仍然慢，再上渲染层改造：

1. **CSS 先行（成本最低）**：给 `.vbm-row` 加 `content-visibility: auto; contain-intrinsic-size: auto 28px;`（Chrome 114+ 支持），让屏外行跳过 layout。需要回归焦点、滚动锚定、`scrollIntoView`。
2. **分片渲染**：把 `innerHTML` 一次性替换改为 `DocumentFragment` 分批 append，避免单个超长任务。
3. **虚拟滚动**：只渲染可视窗口 ± 缓冲区的行；需要同时维护键盘 roving tabindex、↑↓ 行走、Home/End、focus 恢复、拖拽等契约，工作量大，作为独立项目单独立项。

#### 5.4.5 预期与验证

- P0 六项里 H2/H4/H6 是「DOM 强制布局/整树突变」大头，H1/H5 是「重复全树遍历」大头。在 3000+ 书签的 profile 上，预期能把树重建与视图切换的 rendering/scripting 时间显著压低（具体倍数以 DevTools Performance 实测为准，不预设数字）。
- 每完成一个 tier，用 §6.3 的方法在大 profile 上各录 10 次，对比 `Scripting`、`Rendering`、`Painting` 三段；同时用 §6.2 冒烟矩阵确认交互契约无回归。
- 这些优化与 bundle 构建正交，但建议**先合并 bundle 改造，再逐项上运行时优化**，避免一次改动面过大。

---

## 6. 验证测试方案

### 6.1 实施完成后立即执行的自动化检查

```bash
npm test              # vitest 全量，仍跑在源码上，应全绿
npm run lint          # eslint src tests，应全绿
npm run build         # 生成 dist/
```

构建产物静态校验（可写成 `scripts/harness/verify-dist.js`，建议）：

1. `dist/manifest.json` 的 `background.service_worker` 指向 `src/background.js` 且该文件存在。
2. 所有 `dist/src/*.js`、`dist/vendor/codemirror.js` 中不存在 `import(` 动态导入。
3. ESM bundle 内不得残留 `import ... from` / `export ... from`（应为自包含）。
4. 每个 bundle 文件顶部/内容中必须保留 `window.VBMFuzzy`、`window.syncManager`、`window.VBMI18N`、`window.store` 等引用的出现（防 Terser 误删全局契约）。
5. 经典脚本不得因 Terser 丢失全局赋值；**注意 Terser 会把 `(window => {...})(window)` 的形参 mangle 成短名**（产物里是 `e.VBMSort = ...`），所以校验规则是：`window.store`/`window.getSetting`/`window.setSetting`/`window.removeSetting`/`window.VBMI18N`/`window.syncManager`/`window.VBMSort`/`window.VBMUsage` 这些**属性名**必须在产物中出现，且每个 IIFE 以 `})(window)` 调用。
6. `dist/` 中不应出现被 bundle 吞掉的内部模块（`dist/src/actions.js`、`dist/src/palette.js` 等 55 个内部模块不应存在）。
7. `dist/` 中应包含 `_locales/` 全部目录、`assets/icons/*`、`pages/*.html`。

### 6.2 Chrome 手动冒烟矩阵（Load unpacked → `dist/`）

| 场景 | 检查点 |
|---|---|
| 打开 popup | 树正常渲染、主题正确、favicon 正常、搜索可用、右键菜单出现 |
| 打开 side panel | 面板模式、心跳/端口关闭逻辑（点图标能再关掉） |
| 打开 options | 设置读写、备份导入导出、CodeMirror（自定义样式编辑）、语言切换、存储用量条 |
| advanced-options | 重定向到 options.html |
| favicon 画廊页 | 从 options 链接进入，卡片/过滤/compare 正常 |
| omnibox `*` 搜索 | SW 正常注册、建议出现、sync 徽标正常 |
| 命令面板 | Ctrl/Cmd+K、`/version`、`/lang`、自定义命令 |
| 快捷键 | open-side-panel / quick-add / open-command-palette |
| 死链扫描 | 开始/暂停/取消、进度 blob、结果缓存、代理配置条 |
| 重复书签清理 | 策略/scope 控件、确认删除、undo |
| 拖拽/排序 | 树拖拽、文件夹排序、undo |
| 同步状态 | sync 徽标、同步引擎消息 |
| 扩展更新模拟 | 旧版本 → 新版本，存储迁移不报错 |

### 6.3 真实浏览器性能对比（可选但推荐）

1. 用 `chrome://extensions` 分别加载「源码根目录」和 `dist/` 两个副本（同一 profile，或新建两个干净 profile）。
2. 对 popup：DevTools Performance 录制 10 次冷打开（每次关闭后清空 code cache 或使用新 popup 实例），对比 `Scripting / Evaluate Script` 段。
3. 对 SW：`chrome://serviceworker-internals` 或 Performance 录制 SW 冷启动，对比启动耗时。
4. 记录体积/文件数/耗时三列，结果贴回本文档作为验收数据。

### 6.4 回归风险点（测试重点）

- 全局符号顺序：`store.js → i18n-live.js → popup.js → sync-manager.js → sort-utils.js → fuzzy.js → neat.js` 在 popup/sidepanel 的顺序不能被破坏（本方案不改 HTML，因此天然保持）。
- ESM 模块求值顺序：bundle 内部由 esbuild 保证按依赖图后序求值；重点验证 `fuzzy.js` 在 `neat.js` 前设置 `window.VBMFuzzy`（两个入口仍是两个 `<script type="module">`，顺序由 HTML 保证）。
- Terser `compress` 语义：如有任何页面出现未定义函数/静默失败，先用 `--no-compress` 或 `compress: false` 二分定位；`mangle` 只影响局部名，风险低。

---

## 7. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| Terser 误改经典脚本全局（`toplevel: true` 等错误配置） | 整个页面白屏/功能失效 | 构建脚本硬编码 `toplevel: false`；静态校验 §6.1(4)(5)；CI 加 dist 校验 |
| esbuild bundle 改变模块求值顺序或丢副作用 | 某视图初始化失败 | 仅 6 个入口、依赖图清晰；全量手动冒烟矩阵覆盖；必要时对怀疑模块用 `/* @__PURE__ */` 之外的 sideEffects 标注排查 |
| `package.py` 清单与 `runtime-files.json` 漂移 | 打包缺文件/多文件 | 清单单一化，`package.py` 仍保留 `resolve_js_imports` 兜底与 stray 告警 |
| 商店审核对 bundle 后代码的可读性担忧 | 审核延迟 | 只做常规 minify + bundle，不做控制流混淆；保留源码仓库作为审核参照 |
| dist 被误提交 | 仓库膨胀 | `.gitignore` 加 `dist/`；CI 检查 git status |
| 开发态与发布态不一致 | 本地好的，发布坏 | 发布前必须 `npm run package` + `dist/` Load unpacked 冒烟；文档固定该流程 |

---

## 8. 落地步骤（Checklist）

1. `npm i -D esbuild@^0.28 terser@^5.50`。
2. 新建 `scripts/runtime-files.json`（按 §4.2）。
3. 新建 `scripts/build.mjs`（按 §4.3）。
4. 修改 `scripts/package.py`（按 §4.4：`--root`、清单来自 JSON、输出目录仍为仓库 `tmp/`）。
5. 修改 `package.json` scripts，`.gitignore` 加 `dist/`。
6. `npm test && npm run lint`。
7. `npm run build`，跑 §6.1 的 dist 静态校验。
8. `python3 scripts/package.py`（确认源码直出仍与现状一致）与 `npm run package`（确认 dist 出包为 78 文件 / 约 770 KB）。
9. `dist/` Load unpacked，过 §6.2 手动冒烟矩阵。
10. 按 §5.4.2 逐项落地 P0 运行时优化（每项单独 commit，跑 `npm test` + 冒烟）。
11. 大 profile（3000+ 书签）上执行 §6.3 性能对比，把数据补进本文档；视结果决定是否启动 §5.4.3 P1 与 §5.4.4 P2。
12. 视 §6.3 数据决定是否启用 Phase 1B（经典脚本拼接，§2.2）；默认不启用。
13. 更新 README/AGENTS 中「无构建步骤」的表述与发布流程说明。

---

## 附录 A：本方案 dry-run 已执行的验证

当前工作区已实际执行以下验证（临时产物在 `tmp/`，未改动源码）：

```text
esbuild bundle 成功入口：
  src/background.js                  OK
  src/fuzzy.js                       OK
  src/neat.js                        OK
  src/options-palette-commands.js    OK
  src/options-proxy.js               OK
  src/favicons.js                    OK

bundle 后再 Terser（Terser 5.50.0）：
  background               48.9 KiB -> 23.7 KiB
  fuzzy                     4.4 KiB ->  2.0 KiB
  neat                    440.0 KiB -> 221.2 KiB
  options-palette-commands 14.1 KiB ->  8.9 KiB
  options-proxy             6.8 KiB ->  4.0 KiB
  favicons                 18.5 KiB -> 10.9 KiB

经典脚本 Terser：
  popup 经典 5 件   49.3 KiB -> 12.9 KiB
  options 经典 6 件 134.8 KiB -> 69.8 KiB
  favicons 经典 2 件 33.7 KiB ->  9.0 KiB

经典脚本拼接 + Terser（Phase 1B 可行性）：
  popup 5 件拼接    49.4 KiB -> 12.9 KiB（全局契约保留，IIFE 以 })(window) 调用）
  options 6 件拼接 134.8 KiB -> 69.8 KiB（CodeMirror 顶层 var 保留）
  favicons 2 件拼接 33.7 KiB ->  9.0 KiB

bundle 产物自包含检查：
  import/export 残留：0
  window.VBMFuzzy / VBMSort / syncManager / VBMI18N 引用：保留

按运行时文件集（78 文件）重新打包：
  zip 769.9 KB（当前源码直出 1027.4 KB）
```

## 附录 B：本阶段明确不做的事

1. **一期不把经典脚本合并成单文件**：可行性已 dry-run 验证（§2.2），但收益只有文件数、需改 dist HTML；列为 Phase 1B 可选。
2. **不做 CSS/HTML minify**：当前 CSS/HTML 体积不是瓶颈，且会扩大回归面；如需可后续用 esbuild/CleanCSS 单独做。
3. **不做 tree-shaking 专项**：esbuild bundle 已能去掉未使用的导出路径，但本方案不追求 aggressive tree-shaking；`neat.js` 图几乎每个模块都在初始化路径上。
4. **不转 ESM 经典脚本**：`store.js`/`options.js` 的全局契约与加载顺序在经典脚本形态下最稳定；转 ESM 是独立重构，不与本构建改造捆绑。
