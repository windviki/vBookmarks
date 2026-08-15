# v4.0.5 独立审计与抛光报告

2026-08-14 对 vBookmarks 自 v4.0 以来至 4.0.5（工作区 HEAD）的全部改动做的一轮独立审计：`v4.0..HEAD` 共 **139 个提交**（其中 v4.0.4..HEAD 17 个），`src/` + `css/` 合计 50 文件、+6027/−1327 行。审计目标是站在全局角度回答三个问题：这些改动各自的**目的**是否达成、同类问题是否被**举一反三**地照顾到、修复方式是否**足够优雅**；随后把发现的问题修掉、把视觉细节抛光、把没同步的文档补齐。

> 本报告独立成文，不引用也不依赖任何其他工具产出的审计材料。

## 一、审计范围与方法

- **范围**：v4.0 → 4.0.5 全部变更，覆盖六大区域——①键盘/焦点模型，②命令面板与模糊排序，③四个 list view（死链/去重/历史/统计）与 view-manager，④favicon 反色与主题，⑤CSS 视觉细节（含 RTL/暗色/主题一致性），⑥i18n 与文档同步。
- **方法**：六个区域并行调研出报告 → 汇总为统一问题清单（约 32 项代码问题 + 9 项文档问题）→ 按文件归属切分为批次 A/B/C/D 四个修复批次 + E1 文档同步批次 → 每批次跑全量测试与 lint 门禁。
- **基线**：1973 例 / 65 文件全绿，lint 干净，i18n audit 387 键 × 43 locale 零漂移。

## 二、v4.0 → 4.0.5 变更目的速览

这 139 个提交的主线（v4.0.1 抛光档案见 `docs/review-4.0.1/`，此处不重复）：

- **v4.0.1**：整体抛光——键盘/焦点、自绘下拉、死链批量删除、标签组、排序/统计、版本机制、视觉 CSS、文档回填（详见归档报告）。
- **v4.0.2 / v4.0.3**：商店发布健壮性、CI 门禁加固（upload-test 产物校验、harness 分层触发）、密钥泄漏阻断。
- **v4.0.4 → 4.0.5**（17 提交）：三收敛重构（9 份 `htmlspecialchars` 副本 → 共享 `escape.js`；4 份 `parkRowFocus/unparkRowFocus` 副本 → 共享 `list-focus.js`；omnibox 与 popup 模糊排序 → 共享 `fuzzy-core.js`）；命令面板三连修（结果行 Tab 聚焦退化、Tab 两停圈禁、搜索结果 `<mark>` 高亮）；favicon 反色服务 + 死链开始扫描药丸 CTA + 双行行图标适配；死链/去重视觉一致（左缘留白、删除类操作红色语义）；tab-group-utils 专属测试；版本升至 4.0.5。

**审计结论（目的达成度）**：上述每条改动的意图都已落地且方向正确，但存在若干「修了正面、漏了侧面」的同类缺口与不够优雅的实现残留，构成下文问题清单。

## 三、发现清单与处置（按批次归并）

### 批次 A：命令面板与模糊核心（已完成）

1. **palette stale `.active` 吞键**——菜单关闭后残留的 `.active` 类让 `menuOpen()` 误判，吞掉后续按键。修复：`menuOpen()` 改查 `menu[type=context]` 的内联 `opacity === '1'`（真实可见性信号），不引入跨模块依赖。
2. **fuzzy-core 位置索引错位**——`İ` 等 lowercasing 后变长的字符使匹配 positions 与原始字符串索引脱节，`<mark>` 高亮错位。修复：positions 做原始索引重映射。
3. **palette 文件夹行无标题时无回退**——补 `noTitle` 回退，与树视图一致。
4. **`DIALOG_CLASSES` 副本**——删除，改走 `ctx.dialogs.anyOpen()` 单一事实源。
5. **flattenTree 未排除分隔符**——模块内以 `new SeparatorManager(store)` 判定排除。
6. 三处陈旧注释修正 + `WORD_SEPARATORS` 重复 `';'` 去重。

### 批次 B：焦点模型统一（已完成）

1. **四个 list view 行焦点解析契约不统一**——view-manager 两处各自解析行焦点，去重视图成员行因 `keeper-radio` 在 DOM 序前于 `li` 导致 `li.focus()` no-op。修复：契约统一进 `list-focus.js` 的 `rowFocusTarget`，view-manager 两处调用同一入口。
2. **viewState 行记忆绕过 remember() 门控**——`remember: off` 时启动仍可能读到残留行记忆键。修复：行记忆纳入 remember() 门控，off 时启动清键。
3. **undo toast 不在 Tab 环**——可见的撤销 toast 无法 Tab 到达。修复：以 `#undo-toast` 的 `hidden` 属性为可见性信号，挂入 Tab 环尾部。
4. **tabCycle 把下拉列表内行当作行停靠点**——`rowStop`/`focusDefault` 排除 `.vbm-dropdown-list` 内的 `.focus`。
5. **search.js 的 47 行 park/unpark 副本**——收编到 `list-focus.js`（`unparkRowFocus` 加 `emptyFocus` 参数），删副本；顺手修正 fuzzy.js classic script 过时注释。
6. 新增 `tests/list-focus.test.js` 11 例。

### 批次 C：CSS 视觉抛光 + favicon 反色机制（已完成）

1. **搜索视图双行图标选择器提权**——`#results` 作用域让双行行图标样式漏判。
2. **删除语义红色未铺全**——搜索历史行内删除按钮、`#remove-separator`、搜索历史菜单项、`#dupes-group-clean`、`#palette-cmd-delete` 等删除类操作未统一红色；`.dead-delete-*`/`.stats-clear` 的 danger 淡色 hover 不统一。全部铺齐。
3. **RTL 角标定位**——改 `inset-inline-end`（sync-styles.css 同步）。
4. **auto 主题下 OS 深浅切换不重判 favicon 反色**——`favicon-fallback.js` 补 `matchMedia('(prefers-color-scheme: dark)')` change 监听。
5. **常驻侧栏开关反色滞留**——neat.js 加 `chrome.storage.onChanged` 直推 `faviconContrastLive` + `reapplyContrast`。
6. 三处陈旧注释修正；`stats-add-btn`（红色 ☆）与 `dupes-clean-rest`（accent ✓）补「有意为例外」注释。

### favicon 反色策略重写（真实案例实验定案）

用户指出旧机制「没有很好地 work」，提供四个真实案例：澎湃（thepaper.cn，黑标）、Yanu（ccav1.com，实为青蓝 WordPress logo）、雅书（yabook.blog，白标）、GitHub（黑标）。在 `tmp/favicon-lab/`（gitignored 实验脚手架，Python venv + PIL）搭建分析/渲染管线，对 **13 个真实 favicon × 4 主题背景**（ink/paper/light/dark）生成对比矩阵并目视验证，结论：

- **旧策略（均值亮度 + 饱和度阈值）失效的根因**：大面积透明/白底上的深色小标（澎湃、GitHub）均值被底色拉高，达不到暗阈值；反之亦然。均值对「主体色占比」不敏感。
- **新策略（极端色占比）**：按像素亮度分三桶（`lum<0.30` 记 dark、`>0.70` 记 light，即 0-255 标度的 <77/>179），`contrastStats` 返回 `{dark, light, cover}`；暗底上 `dark>0.55 && light<0.05` 翻转、亮底上 `light>0.60 && dark<0.15` 翻转。
- **滤镜从 `invert(1)` 改为 `invert(1) hue-rotate(180deg)` 保色相**——纯反色会把 Netflix 红 N 变青（毁品牌色），保色相后变浅红；黑白标视觉不变。
- **守卫案例验证**：x.com 图标是「黑盘白字」的自反色设计，`light≈0.10 ≥ 0.05` 守卫命中、不翻转（翻了反而错）；澎湃/GitHub 暗标透明底正常翻转；ccav1 青蓝标不触发（彩色主体不该翻）。
- 落地：`favicon-fallback.js`（contrastStats/needsContrast/statsBySrc 默认值）、`neat.css` `.favicon-contrast-invert` 滤镜；`tests/favicon-fallback.test.js` 两个 describe 重写 + REAL_BYTES 改 docker 蓝 (29,99,237) 样本；`tests/list-view-parity.test.js:215` 断言同步。

### 批次 D：死链/去重/菜单/转义（已完成）

1. **`tree-render.js` 空标题书签 URL 回退未转义**（v4.0 之前就存在的历史缺口）——显示名回退改走 `htmlspecialchars(url.replace(httpsPattern,''))`，与同函数 tooltip 对齐；新增含 `< > " &` 的 URL 回归测试。
2. **escape.js 补 `&` 转义（决策：补）**——全量核实 9 个调用方与 `highlightTitlePositions` 全部上游后确认：所有输入均为原始数据（书签标题/URL、用户输入、`_m()` 消息、设置值），旧注释所述双重喂入路径已被 43442a6 的转义下沉消除；`highlightTitlePositions` 逐字符转义原始字符，亦非双喂。故 `&` → `&amp;` 置于替换链首位，函数从「幂等」转为「完备」，头注释如实重写；`dialogs.js` 的 `widont` 在转义后插 `&nbsp;`，不受影响。新增两条 `&` 断言。
3. **context-menu link-folder 分支内容禁用态**——搜索结果/命令面板文件夹行右键分支补 `applyContentDisabled`（异步 getChildren，与树内分支一致）；`hideAllMenus` 增加内容禁用态重置（OPEN/SORT 内容 ids + 折叠子菜单项），每次开菜单经 clearMenu 清干净，跨菜单/跨分支不泄漏；`applyContentDisabled` 的 getChildren 回调首行读 `lastError`。新增 4 条测试。
4. **view-dupes 批量删除链**——每个 remove 回调读 `chrome.runtime.lastError`，toast 报**实际**删除数（与死链侧 X4 场景对齐）；`applySelected` 完成后退出选择模式（对齐 view-dead）；确认文案点名 keeper：`dupesConfirmGroup` 改「Keep "$title$" and remove the other $count$ copies?」（placeholders 双参数），`dupesConfirmAll` 改策略中立表述。各新增测试。
5. **view-dead 事件与徽标**——补 `bookmarks.onCreated` 监听（undo 恢复/中途新增后 300ms 重 join 重绘，与 dupes 侧四事件对齐）；页签徽标改为树 join 行集派生（`allResultRows().length`），并**删除冷启动 preload 块**——树 join 徽标下它只能算 0，且正是「重开 popup 复活旧计数」的通路；代价是徽标在视图首次激活前保持隐藏，这是「徽标=列表行数」一致性的本意，测试按新契约重写。mark-all/选择入口与 delete-all 同按过滤后行数判定（筛选段按钮仍按未过滤计数渲染，回路不断）。
6. **i18n**——新增 `undoSingleStepNote`（en 388 键）；`deadDeleteAllNote` 拆出 undo 句只留 All 筛选警告；3 个改动 key 在 41 个其它 locale 覆盖 `[TODO:key]` 强制重译 + 新增键走管线补齐，`translate --apply` 全部写回。5 个批量确认框（死链删除全部/所选 + 去重组清理/应用全部/应用所选）统一附撤销单步提示。`tests/i18n-copy.test.js` 新增 3 条契约。门禁：audit 通过；missing 42 locale 四项全 0；verify 0 错误（27 条菜单长度警告为 sl/th/uk 等 `openBookmarks*` 存量，与本批次无关）；无 `[TODO:]` 残留；fr/de/ja/zh_TW 抽查通过。
7. 两处注释修正：view-dead 路径不受 `showItemPath` 门控补「有意例外」注；tree-render 头注释改准确。

### 批次 E1：文档同步（已完成）

- **AGENTS.md**：版本头 4.0.1→4.0.5；新增 `escape.js`/`fuzzy-core.js`/`list-focus.js`/`startup-flags.js` 四模块登记（格式对齐现有行）；重写 `fuzzy.js` 行（12 行 ESM shim 现状）并配套修正 sandbox-eval/loadClassicScript 两处列表；search-core/view-manager/keyboard/palette/favicon-fallback/四个 list view/neat.css 各行补 4.0.5 段落；locale 键数两处刷新。
- **keyboard-model.md**（+38 行）：Tab 环图加 undo-toast 末停；palette 局部 Tab 两停循环与 undo toast 环尾停两条 bullet；focusSpot bullet（4.0.4）；§7 矩阵新增 rememberState off 行；§2.5 防御句扩展；§8 表新增 focusSpot 行。
- **guide-v4 双语**（各 4 处镜像）：focusSpot 恢复、palette Tab 两停、关闭栏键盘可达（不再是「纯鼠标件」）、新增 faviconContrast 选项行。
- **v4.1.0task-1.md / -ds.md**：14 处「4.0.4」版本误标逐一改 4.0.5（基线行 + favicon 反色/左缘留白/双行图标/药丸 CTA 四个特性标注）；task-1.md 的用户未提交改动（:158 tooltip 设计行）逐 hunk 核对未触碰。
- **E1 与指令的两处偏差**（均正确，已采纳）：① context-menu 空文件夹置灰按证据写为 4.0.4（`applyContentDisabled` 两提交均 ≤ v4.0.4），link-folder 分支当时未落地未写——批次 D 落地后已由主会话补记；② 两份 task 文档基线行一并改 4.0.5。
- **批次 D 后由主会话回填**：escape.js 行改述 `&` 转义新结论（E1 按当时源码写的「不转义」已被 D 推翻）、键数 387→388、context-menu/view-dead/view-dupes/tree-render 四行补 D 的修复。

## 四、有意不改项（决策记录）

以下各项在审计中被提出过，经评估**维持现状**，避免后续重复开单：

1. **`stats-add-btn` 红色**——星标收藏是通行惯例（浏览器书签星、GitHub star），红色在此读作「收藏」而非「危险」；已补注释。
2. **`dupes-clean-rest` 用 accent 色 ✓**——读作 apply/保留而非 delete（v4 task-4 #9 的既定决策）；已补注释。
3. **死链视图路径恒显、不受 `showItemPath` 门控**——死链排查场景路径是核心信息（v4task-2-list.md:214 设计）。
4. **ROW_SEL `li[tabindex]` 理论边界**——list-focus 契约统一后仅剩理论可达路径，无实际触发面，不值得加防御代码。
5. **fuzzy-core omnibox 候选集差异**——omnibox 与 popup 候选集本就不同（浏览器 omnibox 只给 6 条建议），排序统一即可，候选集差异是平台约束。
6. ~~escape.js `&` 转义~~——**已改**：批次 D 核实无双重喂入路径后补上了 `&` 转义（见批次 D 第 2 条），此项从「不改」转为「已修」，留档备查。

## 五、验证结果

- vitest 全量：基线 1973 例/65 文件 → 终态 **2028 例/66 文件全绿**（+55 例；含 list-focus 新套件 11 例、favicon 两个 describe 重写、批次 D 各套件新增契约）。
- `npm run lint` 零输出零错误；`python3 scripts/i18n.py audit` 通过、`missing` 四项全 0、`verify` 0 错误。
- favicon 相关 89 例 + CSS 相关 190 例随批次 C 验证全绿。
- 工程附带：新建 `vitest.config.js`（排除 `.qoder/**`，此前 vitest 会收集该 worktree 的 tests 副本）；`.gitignore` 加 `.qoder/`。

## 六、附带产物

- `docs/plan-4.1.0/v4.1.0task-1-k3.md`——基于 v4.1.0task-1.md 基准的 v4.1.0 独立设计方案（K1–K10 全部决策定案，「Calm Instrument」视觉体系，切片 S1–S16）。
- README 双语 v4.0.5 changelog（含修正 4.0.2/4.0.3 顺序颠倒）——已同步。
- `tmp/favicon-lab/`——favicon 实验脚手架（gitignored，可随时删）。
