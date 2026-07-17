# v4 任务包 1：vBookmarks 现代化续作（接力文档）

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

已实现：存储统一 store.js（迁移/双区镜像/debounce）、design tokens + 三态暗色、side panel 可选开启（sidepanel.html）、fzf 模糊搜索、空态、最近书签分区（#34）、文件夹排序（#33）、快速收藏（#30）、omnibox 修复、59 例 vitest 真源码测试全绿、docker 冒烟四页面零错误。

**版本号仍是 3.7**，发版时再定 3.8/4.0（捐赠横幅按版本号比较，改版本有其副作用，见 neat.js donation 逻辑）。

### 验证工具（开工先跑一遍确认基线绿）

```bash
cd vBookmarks
npm run test:run                                  # 59 例应全绿
python3 scripts/package.py --output /tmp/x.zip    # 打包自检
node --check <改动的 js 文件>
# docker 冒烟（headless Chrome 加载扩展查 console 错误）：
# 配方见 AGENTS.md "Headless smoke test" 一节；脚本模板在 /tmp/vbm-smoke/smoke.js
# 注意：必须用 headless: 'new'（旧 headless 不加载扩展）；bind mount 不可用时要 COPY 进镜像
```

### 硬约定（违反会破坏现有机制）

- 存储：同步读写一律 `store.get/set`（local 区）/`store.getSyncSetting/setSyncSetting`（sync 区）；**禁止重新引入 localStorage 直访**；异步页用 `getSetting/setSetting`。
- i18n：新文案先加 `_locales/en/messages.json` + `_locales/zh_CN/messages.json`，其余语言回退 en（不生成 TODO 占位）。
- CSP：`script-src 'self'` 是硬线；`style-src` 已含 `'unsafe-inline'`（树缩进/分隔符颜色依赖内联样式属性，勿收紧）。
- 测试：classic 脚本用 `fs + new Function` 沙箱测真源码（tests/store.test.js 范式），ESM 直接 import；**禁止抄写被测实现**。
- sidepanel.html 是 popup.html 的复刻（仅多 `<body class="panel-mode">`），改 popup.html 后必须同步复刻（tests/fuzzy.test.js 有脚本一致性断言）。
- CSS：新样式追加到文件末尾带注释段标；颜色只用 `var(--vbm-*)` token；新 JS 文件要登记 scripts/package.py 的 JS_FILES。

## 4. 下一步任务（按优先级）

### P1 — neat.js 模块化拆分（下一个大版本的主体工程）

依据：总方案 §3 拆分蓝图。neat.js 现约 3500 行单 IIFE，是当前最大的维护风险。
目标模块：tree-view / search / actions / context-menu / keyboard / dnd / dialogs / separators / sync-ui。
路线已定：MV3 原生 ES modules（popup 页面 `<script type="module">` 可用），neatools.js 同步退役（替代对照表见《现状分析-弹窗UI.md》§5，注意它 monkey-patch 了 String/Array/Element 原型，全篇隐式依赖，需先全局替换为纯函数）。
验收：每模块 <400 行；纯逻辑全部可 vitest 直测；现有 59 例测试保持绿；docker 冒烟零错误。
风险：这是大手术，建议分子任务逐个模块剥离，每步可独立提交、独立冒烟。

### P2 — ⌘K 命令面板

依据：总方案 §2.1。在 P1 之后做（依赖模块化后的 actions 表）。对标 alyssaxuu/omni 的斜杠命令；复用 fuzzy.js；`chrome.commands` 唤醒（注意每个扩展最多 4 个建议快捷键）。

### P3 — Phase 3 剩余功能（按 ROI 排序）

1. **重复书签清理**：URL 归一化（去 hash/utm/尾斜杠）→ 分组展示 → 批量删除。纯逻辑易测，成本最低。
2. **会话保存**："当前窗口所有标签存为一个文件夹"（OneTab 核心场景，tabs+bookmarks API）。
3. **撤销体系升级**：undo 栈迁 `storage.session`（含子树快照，现 undo 不能恢复文件夹子树且 popup 关闭即丢）；删除后 toast 撤销条替代确认对话框。
4. **全部打开为标签组**：`chrome.tabs.group` + tabGroups 着色，文件夹名做组名。
5. **死链扫描**：offscreen 文档批量检测 + 标记/筛选；如需 `<all_urls>` 抓页面走 optional_permissions。
6. **SyncManager 归位**：状态计算迁 service worker + `chrome.alarms`（现"60 秒自动刷新"只在 popup 开着时存活）；参考 docs/bookmark-sync-changes.md。

### P4 — 遗留观察项（小而确定的修复）

- `minimum_chrome_version` 88 → 114（sidePanel/promise storage 实际基线；现靠 feature-detect 降级）。抬基线后清理降级代码。
- `separatorURL`（neat.js 读）vs `separatorUrl`（advanced-options.js 写）大小写分叉：归并为一个 key + store.js 迁移（改 KNOWN_KEYS，注意幂等）。
- `TreeText` 的 `'\t' * level` NaN bug（neat.js 约 267-293 行）："复制标题和 URL"产出残破，修复或移除该功能。
- neat.js 约 786 行 `body.style.height = store.get('popupHeight')` 赋无单位值（无效 CSS，popup.js 路径才是实际生效路径）：删除或修正。
- options.js 的 zoom 每秒 setInterval 轮询：改事件驱动。
- options 页 number input 等原生控件深色适配。
- sync-styles.css 中未上线同步 UI 的死样式段：随 P3.6 一并清理或落地。
- 位图图标 SVG 化（folder.png、document-code.png → 内联 SVG currentColor，随主题变色）。

### P5 — Phase 4 评估（不承诺排期）

AI 自动打标（优先 Chrome 内置 Prompt API，默认关闭）、封面缩略图/卡片视图（回应 issue #28 的多列全览诉求，只进 panel）、readingList 集成。评估报告写进 docs/ 再决定。

## 5. 协作方式备忘（维护者偏好）

- 每个独立改进 = 一个本地 commit；推送/发版由维护者决定。
- 分析类产出放 docs/ 下独立文档；改动了约定就同步更新 AGENTS.md。
- 大改动前先看《现代化演进总方案》对应章节，方案与现实冲突时以代码为准并回写方案。
- 对数万存量用户的影响是一等公民：默认行为不变、设置可回退、迁移幂等可重入。
