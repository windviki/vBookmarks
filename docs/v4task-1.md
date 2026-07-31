# v4 任务包 1：vBookmarks 现代化续作（接力文档）

> **状态：P1–P4 全部完成**（2026-07-18，见 §3 完成状态与偏差清单；剩余仅 P5 评估项，不承诺排期）。**v4.0 已收官**（2026-07-29，见 §6 收官回写）。

> 用途：新 session 的工作入口。读完本文件 + 方案总文档即可开工，无需重新调研。
> 维护者：windviki。协作约定：每个独立改进完成后本地 git 提交（conventional commits，中英文混用）；不要动本仓库以外的文件；docker 可用但不得影响已有镜像/容器。

## 1. 背景速览

vBookmarks 是 Chrome MV3 书签管理扩展（Neat Bookmarks 的 fork），数万存量用户，42 语言，零依赖无构建步骤。2026-07 完成了一轮"现代化演进"：先形成分析文档集，再按 Phase 0→3 实施。本任务包是**该轮未实施部分 + 遗留观察项**的续作。

核心设计决策（已定，不要翻案）：

- **popup 永远是默认呈现**，功能完整不裁剪；side panel 是设置项开启的可选增强（默认关闭）。
- **不引入框架/打包器**。MV3 CSP 禁 `unsafe-eval`，Alpine/petite-vue 出局；纯函数模块 + 直接 DOM 是既定路线。
- **本地优先**：chrome.bookmarks 直读，不引入云端账号体系。
- 品味三原则：速度感（time-to-first-result）、秩序感（侧栏/保存即整理）、安静感（tokens/暗色/克制动效）。

## 2. 必读文档（按顺序）

| 文档 | 内容 |
|---|---|
| `AGENTS.md` | 仓库结构、命令、代码约定、CSP/安全约定、已知怪癖（最新状态） |
| `docs/现代化演进总方案.md` | 总方案：§3 模块拆分蓝图、§4 路线图、§7 三项增补决策、**§8 实施进度与有意未做清单**（本任务包的依据） |
| `docs/现状分析-弹窗UI.md` | neat.js 逐段解剖（行号地图）、neatools 替代对照表 |
| `docs/现状分析-架构与存储.md` | manifest/background/sync-manager/测试的债点清单 |
| `docs/趋势调研-MV3平台与书签品类.md` | 平台能力与品类参照（做决定时查） |
| `docs/bookmark-sync-changes.md` | Chrome 书签 sync API 变更参考（SyncManager 归位时用） |

## 3. 当前状态（commit 基线）

最新 8 个 commit（全在本地 master，未推送）：`fcbcc39`(docs) → `7fdd128`(Phase 0) → `e5099dc`(存储统一) → `1789dd2`(暗色主题) → `da20641`(侧栏+模糊搜索+空态) → `4ea30d2`(三条 issue 功能) → `478e492`(sidepanel+CSP) → `aaa4892`(docs)。

2026-07-17/18 续作完成状态：**P1–P4 全部落地**。目录重组 `dbc52b7` 后：P1 十个切片把 neat.js（约 3500 行单 IIFE）拆成 10 个 ESM 模块 + 约 720 行 app-shell（separators→dialogs→search→actions→context-menu→keyboard→dnd→tree-render→tree-view→sync-ui），neatools.js 退役；P2 命令面板（popup 内 Ctrl/Cmd+K + `chrome.commands` 全局唤醒）；P3 六项（/dupes 重复书签清理、/session 会话保存、undo 子树快照 + toast 撤销条、文件夹全部打开为标签组、/dead 死链扫描、SyncManager 归位 service worker + chrome.alarms）；P4 八项（separator key 大小写归并、TreeText NaN、popupHeight 无单位赋值、min-chrome 114 + 降级代码清理、zoom 轮询改事件驱动、options 原生控件深色、sync-styles 死段清理、位图图标 SVG 化）。终态：653 例 vitest 全绿、package.py 无 strays、docker 冒烟四页面零 console 错误。

**既定偏差（有意为之，验收时对照）**：

- `src/actions.js`（546 行）与 `src/palette.js`（576 行）超过 P1 的 <400 行目标：二者是单一内聚的动作表/面板模式表，再拆只增加跳转成本，不再细分。
- P3.5 死链扫描在 popup 页内执行（交互式任务，进度与取消需可见），未走 offscreen 文档；`<all_urls>` 本是固有 host 权限，未引入 optional_permissions。
- `confirmDeleteFolder*` i18n 键自 P3.3（toast 撤销替代确认框）起为死文案，保留在 locales 中避免 42 个语言文件无意义翻动。
- 旧 `scripts/sync_locales.py` 全量重写会产生键序随机的大噪音 diff；新键采用在 41 个 locale 中原位插入 `[TODO:key]` 占位。该脚本与 `check_translations.py` 已退役，统一由 `scripts/i18n.py`（audit/missing/translate/verify）接替，键集一致性以 `python3 scripts/i18n.py missing` / `verify` 验证。

已实现：存储统一 src/store.js（迁移/双区镜像/debounce）、design tokens + 三态暗色、side panel 可选开启（pages/sidepanel.html）、fzf 模糊搜索、空态、最近书签分区（#34）、文件夹排序（#33）、快速收藏（#30）、omnibox 修复、70 例 vitest 真源码测试全绿、docker 冒烟四页面零错误。

**版本号仍是 3.7**，发版时再定 3.8/4.0（捐赠横幅按版本号比较，改版本有其副作用，见 src/neat.js donation 逻辑）。

**2026-07-17 仓库目录重组**：运行时 JS 在 `src/`、页面在 `pages/`、样式在 `css/`、vendored 第三方在 `vendor/`、图像素材在 `assets/`（`icons/` 代码引用并随包发布、`store/` 仅商店页/README 截图、`design/` 设计源与废弃备选）、MV2 遗物在 `legacy/`；`manifest.json`、`_locales/` 须在扩展根未动。历史分析文档（现状分析×2、总方案等）中的文件路径仍为重组前写法，以 `AGENTS.md` 为准。

### 验证工具（开工先跑一遍确认基线绿）

```bash
cd vBookmarks
npm run test:run                                  # 653 例应全绿
python3 scripts/package.py --output /tmp/x.zip    # 打包自检
node --check <改动的 js 文件>
# docker 冒烟（headless Chrome 加载扩展查 console 错误）：
# 配方见 AGENTS.md "Headless smoke test" 一节；脚本模板在 /tmp/vbm-smoke/smoke.js
# 注意：必须用 headless: 'new'（旧 headless 不加载扩展）；bind mount 不可用时要 COPY 进镜像
```

### 硬约定（违反会破坏现有机制）

- 存储：同步读写一律 `store.get/set`（local 区）/`store.getSyncSetting/setSyncSetting`（sync 区）；**禁止重新引入 localStorage 直访**；异步页用 `getSetting/setSetting`。
- i18n：新文案先加 `_locales/en/messages.json` + `_locales/zh_CN/messages.json` 实译，其余 41 locale 原位插入 `[TODO:key]` 占位（保持各文件既有键序），跑 `python3 scripts/i18n.py missing` 验证键集一致；旧 sync_locales.py / check_translations.py 已退役。
- CSP：`script-src 'self'` 是硬线；`style-src` 已含 `'unsafe-inline'`（树缩进/分隔符颜色依赖内联样式属性，勿收紧）。
- 测试：classic 脚本用 `fs + new Function` 沙箱测真源码（tests/store.test.js 范式），ESM 直接 import；**禁止抄写被测实现**。
- pages/sidepanel.html 是 pages/popup.html 的复刻（仅多 `<body class="panel-mode">`），改 pages/popup.html 后必须同步复刻（tests/fuzzy.test.js 有脚本一致性断言）。
- CSS：新样式追加到文件末尾带注释段标；颜色只用 `var(--vbm-*)` token；新 JS 文件要登记 scripts/package.py 的 JS_FILES。

## 4. 下一步任务（按优先级）

### P1 — neat.js 模块化拆分（下一个大版本的主体工程）

> ✅ **已完成**（10 个切片 + neatools 退役，commit `63965f7`…`69218c6`）。neat.js 约 3500 → 约 720 行 app-shell + 10 个 ESM 模块；两模块超 <400 行目标（actions/palette），属有意豁免，见 §3 偏差清单。

依据：总方案 §3 拆分蓝图。src/neat.js 现约 3500 行单 IIFE，是当前最大的维护风险。
目标模块：tree-view / search / actions / context-menu / keyboard / dnd / dialogs / separators / sync-ui。
路线已定：MV3 原生 ES modules（popup 页面 `<script type="module">` 可用），src/neatools.js 同步退役（替代对照表见《现状分析-弹窗UI.md》§5，注意它 monkey-patch 了 String/Array/Element 原型，全篇隐式依赖，需先全局替换为纯函数）。
验收：每模块 <400 行；纯逻辑全部可 vitest 直测；现有 70 例测试保持绿；docker 冒烟零错误。
风险：这是大手术，建议分子任务逐个模块剥离，每步可独立提交、独立冒烟。

### P2 — ⌘K 命令面板

> ✅ **已完成**（`805e250`，src/palette.js）。popup 内 Ctrl/Cmd+K 直接开；`chrome.commands` 的 `open-command-palette`（Ctrl/Cmd+Shift+K）全局唤醒：storage.session 置旗 + `chrome.action.openPopup`（Chrome 127+），低版本回退 `?palette=1` 弹窗。

依据：总方案 §2.1。在 P1 之后做（依赖模块化后的 actions 表）。对标 alyssaxuu/omni 的斜杠命令；复用 src/fuzzy.js；`chrome.commands` 唤醒（注意每个扩展最多 4 个建议快捷键）。

### P3 — Phase 3 剩余功能（按 ROI 排序）

> ✅ **已完成**（六项全部落地，`2648785`…`253f451`）。第 5 项实现位置与原文不同（popup 页内扫描，非 offscreen），见 §3 偏差清单。

1. **重复书签清理**：URL 归一化（去 hash/utm/尾斜杠）→ 分组展示 → 批量删除。纯逻辑易测，成本最低。
2. **会话保存**："当前窗口所有标签存为一个文件夹"（OneTab 核心场景，tabs+bookmarks API）。
3. **撤销体系升级**：undo 栈迁 `storage.session`（含子树快照，现 undo 不能恢复文件夹子树且 popup 关闭即丢）；删除后 toast 撤销条替代确认对话框。
4. **全部打开为标签组**：`chrome.tabs.group` + tabGroups 着色，文件夹名做组名。
5. **死链扫描**：offscreen 文档批量检测 + 标记/筛选；如需 `<all_urls>` 抓页面走 optional_permissions。
6. **SyncManager 归位**：状态计算迁 service worker + `chrome.alarms`（现"60 秒自动刷新"只在 popup 开着时存活）；参考 docs/bookmark-sync-changes.md。

### P4 — 遗留观察项（小而确定的修复）

> ✅ **已完成**（八项全部落地）。separator key 归并 / TreeText NaN / popupHeight 三项在 P4 预热中随 neat.js 切片修掉；sync-styles 死段随 P3.6 清理（598→305 行）；其余四项为独立 commit：min-chrome 114 `a078ab7`、zoom 事件驱动 `d76d688`、原生控件深色 `2ca9c14`、图标 SVG 化 `4dfcc40`。注意：`chrome.action.openPopup`（Chrome 127+）的 `?palette=1` 回退**保留**——基线 114 仍低于 127。

- `minimum_chrome_version` 88 → 114（sidePanel/promise storage 实际基线；现靠 feature-detect 降级）。抬基线后清理降级代码。
- `separatorURL`（src/neat.js 读）vs `separatorUrl`（src/advanced-options.js 写）大小写分叉：归并为一个 key + src/store.js 迁移（改 KNOWN_KEYS，注意幂等）。
- `TreeText` 的 `'\t' * level` NaN bug（src/neat.js 约 267-293 行）："复制标题和 URL"产出残破，修复或移除该功能。
- src/neat.js 约 786 行 `body.style.height = store.get('popupHeight')` 赋无单位值（无效 CSS，src/popup.js 路径才是实际生效路径）：删除或修正。
- src/options.js 的 zoom 每秒 setInterval 轮询：改事件驱动。
- options 页 number input 等原生控件深色适配。
- css/sync-styles.css 中未上线同步 UI 的死样式段：随 P3.6 一并清理或落地。
- 位图图标 SVG 化（assets/icons/folder.png、assets/icons/document-code.png → 内联 SVG currentColor，随主题变色）。

### P5 — Phase 4 评估（不承诺排期）

AI 自动打标（优先 Chrome 内置 Prompt API，默认关闭）、封面缩略图/卡片视图（回应 issue #28 的多列全览诉求，只进 panel）、readingList 集成。评估报告写进 docs/ 再决定。

## 5. 协作方式备忘（维护者偏好）

- 每个独立改进 = 一个本地 commit；推送/发版由维护者决定。
- 分析类产出放 docs/ 下独立文档；改动了约定就同步更新 AGENTS.md。
- 大改动前先看《现代化演进总方案》对应章节，方案与现实冲突时以代码为准并回写方案。
- 对数万存量用户的影响是一等公民：默认行为不变、设置可回退、迁移幂等可重入。

## 6. 收官回写（2026-07-29）

v4.0 全部落成，本任务包与任务包 2 合并收尾：

- **任务包 1（P1–P4 地基）**：状态见 §3，收官前无新增变更。
- **任务包 2（视图系统）**：切片 A–E + 七轮修订全部完成，逐轮细节在 `docs/v4task-2.md`（附录 B–G）；附录 G 即 view-system 分支合并评估的吸收记录。
- **view-system 分支合并评估**（2026-07-28/29）：对他人实现的同名分支（与 master 同源 `5edc546`）逐项对比——master 全面领先，吸收 8 小项 + 2 项自查修复（共享 relTimeLabel、dupes 中段截断、搜索历史区限高、行 hover 底色、package.py 漏登记 panel-behavior.js 等），对方 10 个实锤 bug 存档不吸收。完整回执表见 `docs/view-system-合并评估报告.md`。

**最终验收状态**：

- `npm run test:run`：1103 例全绿（37 个测试文件）。
- `python3 scripts/i18n.py verify`：258 键 × 43 locale，0 错误（4 个既有警告）。
- `python3 scripts/package.py`：96 文件，无 strays。
- Docker harness 全绿（`scripts/screenshots/run.sh` 一把梭）：smoke 零 console 错误 → `verify-keyboard.js` 32 断言（焦点区域 / TabStrip 键盘 / 搜索双区重进 / 视图渲染）→ 五套截图（shots / shots-themes / shots-i18n / shots-palette / shots-guide）全部 NO ERRORS。

**配套文档**：`docs/README.md` / `docs/README.zh.md` 已按 4.0 重写，开篇说明可直接用于商店介绍页；新特性上手指南 `docs/guide-v4.md` / `docs/guide-v4.zh.md`（全键盘操作、逐视图说明、命令面板、经典外观配方、备份与隐私），配 `docs/images/guide/` 下 8 张实拍截图。
