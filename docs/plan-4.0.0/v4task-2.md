# v4 任务包 2：视图化（Tabs/Views）重构设计方案

> **状态：已完成——切片 A/A2/B/C/D/E 全部落地，七轮修订收官**（初验 2026-07-25：i18n verify 0 错误、892 单测全绿、docker 冒烟+截图套件全通过、打包 95 文件 v4.0；v2：tab 视觉规范、搜索历史、死链缓存/代理/标记、去重策略、路径标签；v3：删除非空文件夹确认回归、选项开关与自定义入口全集、options"视图"分组、明确不纳入清单。附录 B–E = 第二~五轮；附录 F = 第六轮 6 项；附录 G = 第七轮 view-system 分支合并评估，2026-07-29：1103 单测全绿（37 文件）、258 键 × 43 locale verify 0 错误、docker 冒烟+键盘验证 32 断言+五截图套件全过、打包 96 文件）。
> 本文只做设计，不含实施；实施时按 §9 分切片执行。
> 前置阅读：`AGENTS.md`、`docs/plan-4.0.0/v4task-1.md`（协作约定与硬约定）、《现代化演进总方案.md》§7.1（侧栏策略）、§2（品味三原则）。
> 需求来源：维护者提出的"最近添加"功能重构——引入 tab/视图概念，为未来逐步向 side panel 迁移做准备。

## 1. 背景与需求

维护者需求（要点）：

1. 在 popup 与 side panel 中，把"最近添加"区域所在的容器重构为**类似浏览器 tab 的视图容器**，容纳多个视图。
2. 视图清单（6 个）：**tree（默认）、search（搜索）、recent（最近添加）、stats（访问统计）、dead（死链）、dupes（重复管理）**。
3. 命令面板（palette）可在**任意视图**呼出，输入命令跳转视图；面板中**所有可点击指令都要提供 `/` slash command** 键盘快速操作。
4. 重点协调问题：默认视图已有搜索框、palette 也有输入框，再引入 search 视图后，三者关系如何组织——搜索入口、输入框与搜索结果的呈现位置。
5. v2 增补：tab 视觉与各主题呈现；搜索历史与上次结果恢复；死链缓存/代理双通道/标记 overlay；去重分组与快捷策略；列表行父路径标签（可关）。
6. v3 增补：**删除非空文件夹时弹 ConfirmDialog 确认**（涉及多个书签，误删成本高）；以及随新功能一次性配套的选项开关与自定义入口全集（§5.7、§7）。

本文的目标是把这套需求细化为可直接实施的设计：视图抽象、tab UI、状态持久化、键盘/Esc 收纳、palette 命令统一、搜索体系协调、六个视图的逐一设计、横切行为变更、设置项迁移、分阶段路线。

## 2. 现状依据（为什么现在适合做视图化）

### 2.1 代码库已存在三个"准视图"，但机制各自为政

| 准视图 | 现状机制 | 证据 |
|---|---|---|
| 树 / 搜索结果 | `#tree` 与 `#results` 双容器，搜索模式 = `#tree` display:none 替换 | `pages/popup.html:25-26`；`src/search.js:195-197` |
| 命令面板 | `#command-palette` overlay + `hidden` 切换；内部再有 `mode: normal/dupes/dead` 字符串状态机 | `pages/popup.html:80`；`src/palette.js:103,562` |
| 最近添加 | 寄生在树顶部的虚拟区 `#recent-section`，前置拼接到树 HTML | `src/tree-view.js:125-134, 218` |

dupes/dead 两个功能**唯一入口是 palette 的 `/dupes`、`/dead` 命令**，以面板内 mode 的形式存在（`src/palette.js:361-362`，import 无其他消费者）。它们是"临时模式"而非正式视图——是视图化最自然的迁移对象。

### 2.2 可复用的资产

- **单 DOM 双页面已验证**：sidepanel.html 与 popup.html 仅差 `<body class="panel-mode">` 一行，全部模块共享；`src/popup.js:20-24` 与 `src/neat.js:19-20` 用同一判定跳过 popup 专属逻辑。视图层只需在共享 DOM 上加一层，popup/panel 天然一致。
- **虚拟区先例**：recent 区的 DOM id 命名空间（`neat-recent-item-`）、`data-virtual="1"` 防拖拽（`src/tree-view.js:113-119`）、折叠状态单 key 持久化、onCreated/onRemoved + 300ms 防抖刷新（`src/tree-view.js:156-164`）——可直接抽离为独立视图。
- **纯逻辑模块已就位**：`src/dupes.js`、`src/dead-links.js`、`src/fuzzy.js` 全部零 chrome/DOM 依赖，vitest 直测。
- **sync indicator 的 overlay 模式**：favicon 右下角圆点 + CSS token 着色（`css/sync-styles.css`）——死链标记 overlay 直接复刻此模式。
- **路径数据已有纯函数**：`src/tree-render.js` 的 `generateNodeTrees`/`getParentPath` 可构建 id→父路径映射；搜索结果现状已有异步补父文件夹 tooltip 的先例。
- **删除确认的复活资产**：P3.3 用 undo toast 取代 ConfirmDialog 后，`confirmDeleteFolder*` i18n key 成为死文案但**保留在 43 个 locale 中未删**（v4task-1 §3 偏差清单）；且 `keyboard.js`/`context-menu.js **至今仍统计子节点数**（计数已无消费者，AGENTS.md Known Quirks）。恢复"非空文件夹确认"= 复活死 key + 接上现成计数，几乎零成本（§5.7）。
- **palette 命令表结构**：`{ name, fn, slash?, keepOpen? }`（`src/palette.js:356-364`），slash 前缀匹配已实现（`:446-459`）——视图注册表以此为蓝本。
- **统一存储**：`src/store.js` 内存镜像 + KNOWN_KEYS 白名单（`:43-55`）。

### 2.3 不可翻案的既定决策（约束）

- popup 永远是默认呈现，功能完整不裁剪；side panel 是可选增强（总方案 §7.1）。
- 不引入框架/打包器；ES module `initX(ctx)` 工厂 + neat.js 编排。
- 本地优先：chrome.bookmarks 直读；**不新增权限**（AGENTS.md:128）。
- 每模块 <400 行（超出需有意豁免）；每个新模块配一个 vitest suite；popup.html 改动必须同步 sidepanel.html（parity 断言）。
- 品味三原则：速度感、秩序感、安静感；五主题 auto/light/dark/ink/paper 全部 token 驱动。
- **范围纪律**（总方案 §5）：本任务包只收与视图化直接相关的增强；§11 列出明确不纳入的项。

## 3. 总体设计：视图架构

### 3.1 视图注册表与生命周期

新增 `src/view-manager.js`（ESM，`initViewManager(ctx)`），是视图层的唯一入口：

```text
ViewDef = {
  id:          'tree' | 'search' | 'recent' | 'stats' | 'dead' | 'dupes',
  titleKey:    i18n key（tab 文案/aria-label）,
  icon:        内联 SVG（src/icons.js 新增常量，16px 网格 1.5px 描边 currentColor）,
  slash:       'tree' | 'search' | 'recent' | 'stats' | 'dead' | 'dupes',
  container:   视图根元素（#view-<id>）,
  badge():     可选，返回 tab 角标计数（dead=已标记死链数，dupes=重复组数；0/undefined 不显示）,
  activate(ctx),    // 切入：渲染/刷新数据、恢复滚动与焦点、resetHeight
  deactivate(ctx),  // 切出：保存滚动与焦点
  onEscape(): bool, // 视图内 Esc 自定义处理（true = 已消费）
}
```

- 注册表是数组（顺序即 tab 顺序），tree 恒为 index 0 且不可隐藏。
- 切换 = 单例状态机：任一时刻只有一个 active view；`views.activate(id)` 负责 deactivate 旧视图 → display 切换 → activate 新视图 → 写 `activeView`。
- DOM：在 `#container` 内、tab 条之下新增 `#views`，内含每视图一个 `<section id="view-<id>">`；现有 `#tree` 与 `#results` 分别成为 `view-tree` / `view-search` 的内容根，**元素 id 不动**，只做包裹。
- 三个准视图的收纳：search.js 的 display 替换逻辑退役（§4）；`#recent-section` 抽为 `src/view-recent.js`（§5.3）；palette 的 dupes/dead mode 迁为 `src/view-dead.js`/`src/view-dupes.js`（§5.5/5.6）。

### 3.2 tab 条视觉规范（v2 细化 + v3 开关）

**结构**：`#view-tabs`（`role="tablist"`）位于 `#search` 条之下、`#views` 之上；每个 tab 为 `<button role="tab" aria-selected>`，内部三段：SVG 图标 + `<span class="tab-label">` + 可选 `<span class="tab-badge">`。

**图标与文本规则**：

- 图标：每视图一枚 16px 内联 SVG（`src/icons.js` 新增 `VIEW_ICONS`），线性 1.5px 描边 `currentColor`。图标语义：tree=树/列表、search=放大镜（与 header 搜索框图标一致，强化"同一搜索"心智）、recent=时钟、stats=柱状图、dead=断链、dupes=叠层双页。
- **popup 窄态（默认 320px）**：图标 tab——label 视觉隐藏（保留 `aria-label` 与 `title` tooltip）；6 tab 等宽分布，无溢出。
- **popup 宽态 / panel-mode**：显示"图标 + 文字"。CSS 容器查询（`#container` 上 container-type，断点 480px，Chrome 114+ 原生支持）+ `body.panel-mode` 兜底始终显示文字。label 溢出时等宽压缩 + ellipsis，**不出现横向滚动条**。
- 高度 32px；对标浏览器标签条但克制（无圆角卡片、无关闭按钮）。

**状态与主题呈现**：

| 状态 | 呈现 |
|---|---|
| 当前 tab | 底部 2px 指示条 `var(--vbm-accent)` + 图标/文字 accent 色；指示条 `transform` 位移（150ms ease-out） |
| 非当前 | 图标/文字 `var(--vbm-muted)` |
| hover | 背景微变色（低 alpha token） |
| focus-visible | 可见 focus ring |
| badge 角标 | 右上角 9px 圆点计数，`var(--vbm-danger)` 底白字；仅 dead/dupes 有值时显示 |

- **五主题零特判**：全部走 `var(--vbm-*)` token；ink/paper 下指示条/角标自动随 accent/danger 变色；暗色不做反色处理。
- `prefers-reduced-motion` 下关闭指示条滑动与淡入。
- 验收：`shots-themes.js` 补 tab 条五主题状态图；`shots-i18n.js` 的 ar（RTL）检查 tab 顺序镜像。

**v3 新增开关 `showViewTabs`（默认 on）**：关闭后隐藏整条 tab 条，回到"纯 tree + 搜索"的极简界面——视图仍可通过 palette `/` 命令与 Ctrl/Cmd+数字键切换（自定义入口不因隐藏而失效）。这是安静感原则给极简用户的出口。

**视图内容切换**：150ms opacity 单属性淡入；视图切换时对屏幕阅读器用 `aria-live="polite"` 通报视图名（a11y 小项）。

### 3.3 视图状态持久化

- 新增 key（全部登记 KNOWN_KEYS）：`activeView`（popup 恒回 tree；panel-mode 持久恢复）、`viewState`（单 key JSON，各视图 scrollTop）；功能 key 见 §7 汇总表。
- 迁移（幂等可重入）：`showRecentBookmarks` 语义改为"显示 recent 页签"，默认值不变；`recentBookmarksCollapsed` 成死 key，保留不删。

### 3.4 键盘与 Esc 分层收纳

四个现状挂接点收进视图抽象：listener 挂载元素（`src/keyboard.js:329-330`）、li id 前缀正则（`:275,340`）、Esc 分层链（`:453-484`）、type-ahead 可见项扫描（`:291`）。

- **挂载点抽象**：列表型视图在 ViewDef 声明 `listContainer`，keyboard.js 向 view-manager 遍历注册。tree/search 行为逐键保持现状。
- **行 id 方案**：泛化为 `data-node-id` + 统一行 class `.vbm-row`；`neat-recent-item-` 前缀随 recent 视图化清理。
- **type-ahead 边界**：仅 tree/search 启用。
- **Esc 分层链**：`dialogs → context menu → palette → 视图 onEscape（如 dead 中止扫描）→ search 非空查询则清空 → 非 tree 视图回 tree → window.close`。"Esc 回 tree"是新增行为（浏览器式返回），tree/search 路径与今天逐键一致。
- Ctrl/Cmd+F 聚焦 header 框（不变）；Ctrl/Cmd+K 呼出 palette 已在 document 捕获阶段、视图无关（保持并测试固化）；Ctrl/Cmd+1…6 直达视图（捕获阶段，输入框聚焦时不拦截）。

### 3.5 命令面板升级：视图即命令

- **每个视图 = 一个 palette 命令**（Go to Tree/Search/Recent/Stats/Dead/Dupes），slash 别名即视图 id；执行 = 关 palette + `views.activate(id)`。
- **全部可点击指令补齐 slash 别名**：

  | 命令 | 现状 | slash |
  |---|---|---|
  | Bookmark current tab | 无 | `/add` |
  | New bookmark… | 无 | `/new` |
  | New folder… | 无 | `/folder` |
  | New separator | 无 | `/sep` |
  | Save window tabs as folder | `/session` | 保持 |
  | Clean duplicate bookmarks | `/dupes` | 语义改为**跳转 dupes 视图** |
  | Find dead links | `/dead` | 语义改为**跳转 dead 视图** |
  | **Open settings**（v3 新增） | — | `/options`（`chrome.runtime.openOptionsPage`，面板内所有视图之外的唯一出口命令） |

- palette 的 `mode: dupes|dead` 状态机退役，回归单一 normal 模式，消除"Esc 无嵌套返回"（`src/palette.js:562` 注释的尴尬）。
- 结果合成规则不变；全局唤醒链路（`open-command-palette` command）与视图无关，不动。

### 3.6 通用列表行规范：父路径标签（v2 新增）

search / recent / stats / dead / dupes 五个列表型视图的结果行，统一支持**父文件夹路径标签**：

- **数据**：树重建时用 `tree-render.js` 纯函数构建 `id → 父路径` 映射，挂 view-manager ctx 共享；与现有 tooltip 补路径逻辑合并，避免重复遍历。
- **呈现（两种形态，共用 480px 容器查询断点）**：窄态 = 单行右对齐 `<span class="row-path">`（muted、ellipsis、max-width 45%；标题列优先省略）；宽态/panel = 双行（第二行整行 muted 路径 `folder1 / folder2 / …`）。
- **tooltip 统一**：`标题 + URL + 路径`（吸收现有 search 结果的父文件夹 tooltip 行为）。
- **设置项 `showItemPath`（默认 on）**：关闭时所有列表行回到单行紧凑样式；tree 视图有层级缩进表达路径，不适用。
- RTL：路径 `dir="auto"`，ar 截图验证。

## 4. 搜索体系的组织协调（重点设计）

### 4.1 设计原则：一个搜索引擎，三种入口，各司其职

| 输入框 | 定位 | 职责 |
|---|---|---|
| **header 常驻搜索框**（`#search-input`） | 浏览型搜索 | 输入即激活 search 视图，结果在视图容器中呈现 |
| **palette 输入框**（overlay 瞬时存在） | 动作型搜索 | 命令 + 快速打开：选中即执行/打开即关闭 |
| **search 视图** | 搜索结果的**呈现地**，不含独立输入框 | 结果列表、文件夹定位、搜索历史、空态 |

核心取舍：**输入框唯一化**——search 视图复用 header 框作输入端（切到 search tab 即自动 focus）。popup 内任何时刻最多一个常驻输入框（header）+ palette 瞬时框；一个"浏览型"，一个"动作型"，职责互不重叠。

> 已否决：search 视图内置第二输入框（焦点打架、状态同步复杂、违反安静感）。

### 4.2 header 搜索框与 search 视图的联动

- **输入即切视图**：header 框从空变为非空 → `views.activate('search')`（记录来源视图）；清空/Esc 且查询为空 → 返回来源视图。结果渲染进 search 视图容器（原 `#results`，id 不变）。
- 用户感知与今天**完全一致**（"输入出结果，清空回树"），内部从 display 替换变为视图切换。
- 点击 search tab / `/search` / Ctrl/Cmd+F 进入 search 视图，header 框自动 focus，内容按 §4.3 规则呈现。
- `searchAfterEnter` 配置行为不变。

### 4.3 搜索历史与上次结果恢复（v2 新增 + v3 开关）

- **上次结果恢复**：~~独立 key `searchLastQuery`~~ **已退役（2026-07-25 新规范）**：重进 search 视图不再回填搜索框——框维持现状（显式清空后为空）、上区渲染历史、下区结果列表原样留存（会话内 DOM 保持，重算只发生在用户输入时）。跨会话恢复仍由 `searchQuery` + `dontRememberState` 的既有启动恢复覆盖。
- **搜索历史**：key `searchHistory`，MRU 数组上限 10，trim 去重，空串不入。
  - **记录时机**（避免增量前缀 spam）：① `searchAfterEnter` 模式按 Enter；② 打开/点击任意结果；③ 离开 search 视图或页面关闭时记入当前非空查询。
  - **呈现**：search 视图空查询态 = "最近搜索"区块（时钟图标 + 查询词 + 单条 × 移除 + 清空全部）；点击 = 回填并搜索。无历史时只显示空态文案。
- **v3 新增开关 `searchHistoryEnabled`（默认 on）**：关闭后不记录新历史、不显示历史区块；options 提供"同时清空已有历史"的说明文案。隐私敏感的本地数据都应可关——与 `statsEnabled` 同一原则。
- MRU 纯逻辑抽为 `src/search.js` 命名导出，vitest 直测。

### 4.4 palette 与 search 视图的分工与跳转

- palette 普通查询保持现状（命令优先 + 模糊书签 50 条），使命是"快速打开"。
- 桥接：普通查询非空时末行追加"在搜索视图中搜索 '{query}'"（`paletteCmdSearchInView`），slash 形式 `/search foo` 带词跳转。
- omnibox（`*` + Space）是浏览器级入口，不进视图体系，不动。

### 4.5 搜索入口全景（汇总表）

| 入口 | 位置 | 行为 | 结果呈现 |
|---|---|---|---|
| 直接输入 | header 搜索框（Ctrl/Cmd+F 聚焦或点击） | 增量模糊搜索 | search 视图 |
| search tab | tab 条 | 进入并 focus；首次进入恢复上次结果 | search 视图 |
| 搜索历史行 | search 视图空查询态 | 回填并搜索 | search 视图 |
| `/search [query]` | palette | 跳转（可带词） | search 视图 |
| palette 普通查询 | palette overlay | 快速打开 | palette 自身（瞬时） |
| palette "在搜索视图中搜索" | palette 结果末行 | 带词跳转 | search 视图 |
| type-ahead | tree/search 列表聚焦时打字 | 列表内定位（非搜索） | 当前列表高亮 |
| omnibox `*` | 浏览器地址栏 | 浏览器级搜索 | omnibox 下拉 |

呈现规则：**输入框只在两处出现**（header 常驻 + palette 瞬时）；**结果只在两处呈现**（search 视图驻留 + palette 选中即消失）；视图容器内永远不放搜索输入框。

## 5. 六个视图逐一设计

### 5.1 tree（默认视图）

- 内容：现有 `#tree`（separators、sync indicators、懒加载、DnD、右键菜单）。
- 变化：`#recent-section` 不再前置拼接；行构建叠加死链标记 overlay（§5.5c）；删除非空文件夹接入确认（§5.7）。
- 状态：opens/scrollTop/focusID 现有机制原样保留。

### 5.2 search（搜索视图）

- 内容：原 `#results` 容器（id 不变）+ 空态/历史区块（§4.3）。
- 输入端 = header 搜索框；结果渲染、`<mark>` 高亮、`revealFolder` 跳转、100 条截断、无结果空态沿用现状。
- 行呈现按 §3.6 显示父路径标签。
- `searchMode` 标志语义与"search 视图激活"对齐。

### 5.3 recent（最近添加视图）

- 数据源：`chrome.bookmarks.getRecent(N)`；**N 设置化** `recentCount`（默认 20，options 10/20/50/100）。过滤分隔符。
- 渲染：复用 `treeRender.generateBookmarkHTML`；`data-virtual="1"` 防拖拽；扁平 `<ul>`；行按 §3.6 显示父路径标签（"它存在哪个文件夹"正是高频诉求）。
- 实时性：onCreated/onRemoved + 300ms 防抖刷新；非激活时跳过 fetch（沿用现状优化语义）。
- 交互：打开/右键菜单/键盘与 tree 书签行一致。
- **v3 新增行操作："在树中定位"**（右键菜单项 + 键盘 `R`）——recent 的场景是"刚存完想找它在哪/挪位置"，复用现有 `revealFolder`/focusID 机制跳到 tree 视图并定位该节点；与 search 结果文件夹行的跳转同一链路。
- 空态：引导文案（如"按 Ctrl+D 收藏当前页"）。
- 设置迁移：`showRecentBookmarks` 控制 recent 页签显隐。

### 5.4 stats（访问统计视图）

- **权限决策：不引入 `history` 权限**（安装警告是信任灾难）。
- 数据方案：**扩展自建轻量统计**：
  - `src/visit-stats.js`（纯逻辑可测）：`{ [bookmarkId]: { c, t } }`，单 key `visitStats`，防抖落盘。
  - 采集点一（页面侧）：actions 打开路径与 bookmarkHandler 点击埋点。
  - 采集点二（切片 E，service worker 侧）：`chrome.tabs.onUpdated` 匹配书签 URL 集合，覆盖"地址栏/其他入口打开"。**实施补充（切片 E 回写）**：精确匹配（不归一化）；仅 `changeInfo.url` 事件计数（reload 不算打开）；与采集点一的去重——popup 打开前写 `chrome.storage.session` 的 `vbmPopupOpens` 标记（url→ts，10s 窗口），SW 命中新鲜标记则跳过，避免一次打开计两次；防抖读-改-写合入同一 `visitStats` key。
  - 隐私与体积：`statsEnabled`（默认 on，关闭即停采）；只记书签树内 id，重建树时 prune。
- 展示：默认按次数降序（标题 + URL + 次数徽标 + 最近访问相对时间）；**排序切换（按次数/按最近）的选择持久化 `statsSort`（v3 新增，默认 count）**；行按 §3.6 显示父路径标签；点击正常打开并自增。
- **v3 新增数据管理入口**：stats 视图底部（或空态区）"清空统计数据"按钮（ConfirmDialog 门控）+ options 页同功能按钮——本地行为数据必须给用户一键清除的出口，与 `statsEnabled` 开关配套。
- 跨视图联动：`visitStats` 是 dupes `keep-most-visited` 策略的数据源。
- 开放问题：optional_permissions 导入 chrome.history（§10）。

### 5.5 dead（死链视图，v2 细化 + v3 批量与调参）

迁移自 palette mode='dead'，扫描引擎 `src/dead-links.js` 扩展复用。

**a) 上次扫描结果缓存**：key `deadLastScan` = `{ ts, scannedCount, results: { [id]: { status, code } } }`，完成即落盘。视图打开：有缓存 → 直接渲染 + 顶部"上次扫描 YYYY-MM-DD HH:mm · N 个书签 · 重新扫描"；无缓存 → 引导行，不自动扫描。

**b) 用户指定代理 + 双通道判定**：

- 设置项 `deadProxyTemplate`（options，默认空 = 仅直连）：探测中转 URL 模板，含 `{url}` 占位。
- 技术边界：fetch 无法走 CONNECT 隧道（https 目标经传统 HTTP 代理不可行）；`chrome.proxy` API 改全局代理 + 新权限——**已否决**。代理通道 = "中转服务回源探测"语义；options 文案明示**书签 URL 会发送给该第三方服务**。
- 判定矩阵（`checkUrl` 双通道化，纯逻辑可测）：

  | 直连 | 代理 | 最终状态 | 徽标 |
  |---|---|---|---|
  | ok | — | `ok` | 无 |
  | fail | 未配置 | `dead` | × |
  | fail | ok | `blocked`（直连不可达，代理可达——被墙/区域限制，非死链） | "直连×" |
  | fail | fail | `dead`（双通道确认） | × |
  | 非 http(s) | — | `skipped` | — |

- **v3 新增调参项（advanced options）**：`deadScanConcurrency`（并发，默认 4，区间 1–16）、`deadScanTimeout`（单请求超时秒，默认 8，区间 2–30）——代理中转通常更慢，大书签库用户需要调；放 advanced 页避免 general 页膨胀。

**c) 死链标记与 tree 视图 overlay**：

- key `deadMarks`（id 数组）：dead 视图行内"标记/取消标记"（按钮 + 键盘 `M`）→ 所有列表（tree/search/recent）favicon **右上角**叠加醒目红 ×（`var(--vbm-danger)`；sync 圆点在右下角，不重叠），CSS 复刻 sync indicator overlay 模式（`css/sync-styles.css` 追加段）。
- 取消：toggle；重扫后 `ok` 的 id 自动移出；书签删除时 prune。
- **v3 新增批量操作**：视图顶部"全部标记"（把当前结果集中的 dead/blocked 行一次标记）与"清除所有标记"按钮（均 ConfirmDialog 门控）；**状态筛选**（全部 / 仅 dead / 仅 blocked 三态切换，视图内控件不持久化）。
- tab 角标：`badge()` = `deadMarks.length`。

**d) 生命周期**：扫描中切出不中止（闭包持有，切回续见进度）；Esc 中止；删除走 undo 链路；批量删除 ConfirmDialog 门控。popup 关闭中止进行中扫描，但 `deadLastScan` 已落盘不丢（从"前功尽弃"变"断点可见"）；panel 是长扫描的归宿。

### 5.6 dupes（重复管理视图，v2 细化 + v3 范围与归一化选项）

迁移自 palette mode='dupes'，`src/dupes.js` 扩展。

**a) 按组展示 + 组内逐条操作**：

- 组头：归一化 URL + 组内计数 + "清除其余"；组内逐行（标题 + §3.6 路径标签 + dateAdded + 访问次数若可用）。
- 每行：**保留**（radio 语义，每组恰好一个 keeper，点击覆盖策略）、**删除此条**（按钮/Delete 键，undo 链路）。
- 将删行预览态：danger 色 + strikethrough；保留行 ✓——先预览后执行，批量动作 ConfirmDialog 门控。

**b) 顶部快捷策略工具条**（按人工整理习惯规划 keeper 规则，segmented control）：

| 策略 | keeper 规则 | 典型人工习惯 |
|---|---|---|
| `keep-oldest`（默认） | dateAdded 最早 | "最早收藏的是原始位置" |
| `keep-newest` | dateAdded 最新 | "最新存的是刚整理过的" |
| `keep-bookmark-bar` | 优先书签栏根 `'1'` 子树内（多条取最旧，都不在回落最旧） | "书签栏是门面，副本别动它" |
| `keep-shortest-title` | 标题最短（并列取最旧） | "短标题是手动改过的干净命名" |
| `keep-shallowest` | 父路径层级最浅（并列取最旧） | "浅层好找，深层是随手丢的" |
| `keep-most-visited` | `visitStats` 计数最高（无数据回落最旧；stats 关闭时置灰） | "常用的那个才是正主" |

- 纯函数 `pickKeeper(group, strategy, ctx)` 入 `src/dupes.js`，vitest 直测；选择持久化 `dupesStrategy`。
- 顶部：策略 segmented + 汇总（"N 组 · 将释放 M 条"）+ **全部应用**（ConfirmDialog → 串行 remove → undo toast → onChanged）。

**c) v3 新增范围与归一化选项**：

- **扫描范围 `dupesScope`**（视图内选择器，持久化，默认 `all`）：`all` 全书签树 / `bar` 仅书签栏子树——"只清理门面"是高频诉求；深folder 限定留待后续（需文件夹选择器，成本不匹配）。
- **归一化开关 `dupesIgnoreScheme`**（视图内 checkbox，持久化，默认 off）：忽略 http/https 差异视为同一 URL——协议升级是真实重复来源；开启即时重算分组。默认关是因为少数站点双协议内容不同，误并风险由用户显式承担。
- tab 角标：`badge()` = 重复组数。

### 5.7 横切行为变更：删除非空文件夹需确认（v3 新增，维护者点名）

- **现状**：P3.3 起删除一律"直接删 + toast 撤销条"，`confirmDeleteFolder*` 两个 i18n key 死文案保留在 43 locale；`keyboard.js`/`context-menu.js 仍统计子节点数但无消费者`（AGENTS.md Known Quirks）。
- **新行为**：删除**非空文件夹**（子孙节点数 > 0）→ 先弹 ConfirmDialog："该文件夹包含 N 个项目，删除后可撤销。"（复活 `confirmDeleteFolder*` 死 key，文案含 `$count$`）确认后才执行删除 + undo capture + toast。**空文件夹与单个书签保持现状**（直接删 + toast，安静感不受损）。
- **触发点全覆盖**：文件夹右键菜单 Delete、键盘 Delete 键（`treeKeyUp`）、`actions.deleteBookmarks` 批量路径含非空文件夹时——三处统一走 actions 层的同一确认守卫（计数逻辑本来就在，把消费者接回）。
- **开关 `confirmDeleteFolder`（默认 on）**：关闭后回到纯 toast 流——尊重 P3.3 的安静流偏好者；这是对 P3.3 决策的**有限回摆**，需在 release note 说明理由（非空文件夹误删成本高，toast 8s 窗口可能错过；undo 仍是最后兜底）。
- 测试：确认/取消/开关关闭三路径 + 空文件夹不弹 + 批量混合选择只弹一次。

## 6. popup 与 side panel 的关系

- 同一套 DOM/模块；popup.html 的 DOM 变更**必须逐行同步 sidepanel.html**（parity 断言拦截）。
- 形态差异仅由 `body.panel-mode` 与容器查询表达：tab 文字（§3.2）、列表行单行/双行（§3.6）、`activeView` 恢复（§3.3）、dead 扫描生命周期（§5.5d）。
- 本任务不做 panel 双栏；视图层落地后双栏变为纯 CSS/布局议题——这是"为 panel 迁移做准备"的准确落点。

## 7. 存储与设置项变更汇总（v3 全集）

| Key | 类型 | 说明 | 设置入口 |
|---|---|---|---|
| `activeView` | 新增 | 当前视图；仅 panel-mode 持久恢复 | —（行为性） |
| `viewState` | 新增 | JSON，各视图 scrollTop | — |
| `showViewTabs` | 新增 | tab 条显隐，默认 on（§3.2） | options·视图组 |
| `showItemPath` | 新增 | 列表行路径标签，默认 on（§3.6） | options·视图组 |
| ~~`searchLastQuery`~~ | 已退役（2026-07-25 新规范，§4.3） | 存量值残留无害 | — |
| `searchHistory` | 新增 | MRU 上限 10（§4.3） | — |
| `searchHistoryEnabled` | 新增 | 历史开关，默认 on（§4.3） | options·视图组 |
| `recentCount` | 新增 | recent 条数，默认 20 | options·视图组 |
| `visitStats` | 新增 | JSON 统计数据 | —（清空按钮） |
| `statsEnabled` | 新增 | 统计开关，默认 on | options·视图组 |
| `statsSort` | 新增 | 排序记忆，默认 count（§5.4） | 视图内控件 |
| `deadLastScan` | 新增 | JSON 扫描缓存 | — |
| `deadProxyTemplate` | 新增 | 中转 URL 模板，默认空（§5.5b） | options·视图组（附隐私文案） |
| `deadMarks` | 新增 | id 数组 | — |
| `deadScanConcurrency` | 新增 | 并发，默认 4（§5.5b） | advanced options |
| `deadScanTimeout` | 新增 | 超时秒，默认 8（§5.5b） | advanced options |
| `dupesStrategy` | 新增 | 默认 `keep-oldest` | 视图内控件 |
| `dupesScope` | 新增 | `all`/`bar`，默认 all（§5.6c） | 视图内控件 |
| `dupesIgnoreScheme` | 新增 | 忽略协议差异，默认 off（§5.6c） | 视图内控件 |
| `confirmDeleteFolder` | 新增 | 非空文件夹删除确认，默认 on（§5.7） | options·General |
| `showRecentBookmarks` | 语义迁移 | → recent 页签显隐，默认不变 | options·视图组 |
| `recentBookmarksCollapsed` | 废弃 | 保留不删 | 从 options UI 移除 |

**options 页新增"视图"（Views）分组**（v3）：把 `showViewTabs`/`showItemPath`/`showRecentBookmarks`/`recentCount`/`searchHistoryEnabled`/`statsEnabled`/`deadProxyTemplate` 集中为一个 section，避免散落 General 组造成设置页膨胀；分组标题走 i18n `optionsGroupViews`。`confirmDeleteFolder` 属删除行为，留在 General 组。

## 8. i18n key 规划（v3 全集）

en + zh_CN 实译，其余 41 locale 原位插 `[TODO:key]`，`python3 scripts/i18n.py missing` 验证：

- tab/视图：`viewTree`/`viewSearch`/`viewRecent`/`viewStats`/`viewDead`/`viewDupes`；分组 `optionsGroupViews`
- palette：六个跳转命令——**实施已定（切片 C 回写）：采用 `paletteCmdGoTree`/`paletteCmdGoSearch`/`paletteCmdGoRecent`/`paletteCmdGoDead`/`paletteCmdGoDupes`（stats 待切片 D 补 `paletteCmdGoStats`）**、`paletteCmdSearchInView`(`$query$`)、`paletteCmdOptions`
- 搜索历史：`searchHistoryTitle`/`searchHistoryClear`/`searchHistoryRemove`/`optionSearchHistory`；实施补充（切片 B 回写）：`searchHistoryResultCount`(`$n$`)/`optionSearchHistoryHint`
- recent：`recentRevealInTree`；实施补充（切片 B 回写）：`recentEmpty`/`optionRecentCount` + 相对时间桶 `timeJustNow`/`timeMinutesAgo`(`$n$`)/`timeHoursAgo`(`$n$`)/`timeYesterday`/`timeDaysAgo`(`$n$`)（搜索历史时间戳共用）
- dead：`deadLastScanAt`(`$time$`)/`deadRescan`/`deadStartHint`——**实施补充（切片 C 回写）：`deadStartHint` 带 `$n$` 参数（书签总数）**/`deadMark`/`deadUnmark`/`deadMarked`/`deadMarkAll`/`deadUnmarkAll`（三者均无参数）/`deadFilterAll`/`deadFilterDead`/`deadFilterBlocked`/`deadStatusBlocked`/`optionDeadProxy`/`deadProxyHint`/`optionDeadScanConcurrency`/`optionDeadScanTimeout`
- dupes：`dupesStrategyOldest`/`Newest`/`BookmarkBar`/`ShortestTitle`/`Shallowest`/`MostVisited`/`dupesApplyAll`(`$count$`)/`dupesKeepThis`/`dupesRemoveRow`/`dupesGroupCleanRest`——**实施补充（切片 C 回写）：命名为 `dupesGroupCleanRest`，不用草案名 `dupesClearRest`**/`dupesPreviewSummary`(`$groups$`,`$count$`)/`dupesScopeAll`/`dupesScopeBar`/`dupesIgnoreScheme`；行内按钮 `rowActionReveal`/`rowActionMark`/`rowActionUnmark`/`rowActionDelete` + `dupesKeeperSet` toast
- stats：`optionStatsEnabled`/`statsSortByCount`/`statsSortByRecent`/`statsEmpty`/`statsVisitCount`(`$count$`)/`statsClearData`；实施补充（切片 D 回写）：`paletteCmdGoStats`（§4.4 slash 全集）、`statsDisabledHint`（§3.4 关闭态引导文案）、`statsClearConfirm`(`$count$`)（清空 ConfirmDialog 文案）
- 路径标签：`optionShowItemPath`；tab 开关 `optionShowViewTabs`
- 删除确认：**复活 `confirmDeleteFolder`/`confirmDeleteFolderButton` 死 key**（文案按"删除后可撤销"微调 + `$count$`）+ `optionConfirmDeleteFolder`
- 搜索空态：`searchViewHint`

## 9. 分阶段实施路线（v3）

每切片独立可提交、独立冒烟。

| 切片 | 内容 | 验收 |
|---|---|---|
| **A. 视图基础设施** | `src/view-manager.js` + tab 条全视觉规范（§3.2 含 `showViewTabs`）+ tree/search 收纳 + Esc 分层 + keyboard 挂载抽象 + 通用行规范（§3.6 + `showItemPath`）+ `activeView`/`viewState` + options"视图"分组骨架 | 行为零变化：653 例保持全绿；view-manager suite；parity；冒烟零错误；shots-themes 补 tab |
| **A2. 删除确认回归**（微切片，§5.7） | actions 层确认守卫 + 复活 `confirmDeleteFolder*` + `confirmDeleteFolder` 开关 | 确认/取消/关闭三路径测试；空文件夹不弹；批量混合只弹一次 |
| **B. recent 视图化 + 搜索增强** | `src/view-recent.js`（含"在树中定位"）+ `recentCount` + `showRecentBookmarks` 迁移 + 前缀清理；`searchHistory`/`searchLastQuery`/`searchHistoryEnabled` 与历史区块 | recent tab 等价现状 + 路径标签 + 定位；迁移幂等测试；MRU 纯逻辑测试 |
| **C. dupes/dead 视图化 + palette 统一** | `src/view-dupes.js`（分组 + 策略 + 范围 + 协议开关）/`src/view-dead.js`（缓存 + 代理双通道 + 标记 overlay + 批量标记 + 筛选 + 调参）；`dupes.js`/`dead-links.js` 扩展；palette mode 退役；slash 全集（含 `/options`）；搜索桥接行 | palette suite 适配；`pickKeeper` 六策略测试；双通道矩阵测试；overlay 渲染测试；`/d` 前缀仍命中 |
| **D. stats 视图** | `src/visit-stats.js` + `src/view-stats.js` + `statsEnabled`/`statsSort`/清空入口 + dupes `keep-most-visited` 联动 | 采集/排序/prune/清空测试；开关关闭零写入 |
| **E.（可选）SW 侧匹配采集** | `chrome.tabs.onUpdated` 书签 URL 匹配计数 | background suite doubles 覆盖 |

公共验收：`npm run test:run` 全绿；`package.py` 无 strays；`node --check`；docker 冒烟；`i18n.py missing` 键集一致。

## 10. 风险与开放问题

1. **存量感知**：树顶 recent 区移除是唯一可见收缩；recent tab 默认可见紧随 tree；`showRecentBookmarks` 语义自动映射。
2. **Esc 回 tree 的新行为**：release note 明示；负面反馈则加回退开关。
3. **`activeView` 双形态语义**：popup 恒 tree / panel 恢复上次；备选设置项"记住上次视图"视反馈再加。
4. **代理探测的边界与隐私**：https 目标必须走中转服务语义（用户自备，门槛高，预期进阶用户）；**URL 外发第三方**必须文案明示；默认空 = 行为同现状。`chrome.proxy` 已否决。
5. **P3.3 决策的有限回摆**（§5.7）：删除确认回归与"toast 替代确认减少打断"的原决策存在张力——以"仅非空文件夹 + 可关"限定影响面；若维护者更倾向彻底安静流，可降为默认 off 的选项（本文按维护者点名要求默认 on）。
6. **overlay 渲染开销**：与 sync indicator 同模式，Set 查找，风险低；`deadMarks` 一致性（ok 自动清除）需测试。
7. **stats 无法回溯历史**：optional_permissions 导入 history 单列任务再议。
8. **`dupesIgnoreScheme` 误并风险**：少数站点双协议内容不同——默认 off + 即时重算可预览，风险由用户显式承担。
9. **选项膨胀**：本任务包新增 12 个设置 key——用"视图分组 + 视图内控件 + advanced 页"三级安置（§7）控制 general 页膨胀；每个开关都与具体功能捆绑，不设"为开关而开关"的项。
10. **行数纪律**：palette.js 迁出 mode 后回落 <400 行，可摘掉 v4task-1 豁免说明；dupes.js/dead-links.js 扩展后守 <400 行，超出按纯逻辑再拆。

## 11. 明确不纳入本任务包的项（范围纪律）

| 项 | 理由 | 去向 |
|---|---|---|
| tab 顺序自定义/拖拽排序 | 六视图固定顺序足够，拖拽是过度工程 | 有真实诉求再议 |
| recent 按日期分组（今天/昨天/本周） | 渲染与键盘导航复杂度不成比例；`recentCount` 调大已覆盖大部分诉求 | 视图化落地后评估 |
| panel 双栏（左树右列表） | 本任务只铺视图层；双栏是 panel 迁移的主体工程 | 后续任务包 |
| 卡片网格/封面缩略图视图 | 总方案已定 Phase 4，且只进 panel | Phase 4 评估 |
| stats 数据导出 | YAGNI；本地 JSON 用户可自行读取 | 有诉求再议 |
| dupes 按任意子文件夹限定范围 | 需文件夹选择器 UI，成本不匹配；`dupesScope=bar` 覆盖高频场景 | 有诉求再议 |
| history 权限导入历史访问频次 | 权限评估独立进行 | optional_permissions 专题 |
| AI 打标/readingList 集成 | v4task-1 P5 已定不承诺排期 | 不变 |

## 附录 A：新增/变更文件清单（预估）

| 文件 | 变更 |
|---|---|
| `src/view-manager.js` | 新增（注册表 + tab 条 + 切换状态机 + 路径映射） |
| `src/view-recent.js` / `src/view-stats.js` / `src/view-dead.js` / `src/view-dupes.js` | 新增 |
| `src/visit-stats.js` | 新增（切片 D） |
| `src/search.js` | display 替换退役，接入视图激活；搜索历史 MRU 纯函数 |
| `src/tree-view.js` | recent 段迁出；dead 标记 overlay 渲染 |
| `src/tree-render.js` | 行模板支持 overlay 徽标与路径标签 |
| `src/actions.js` | 删除确认守卫（§5.7）；打开路径埋点（切片 D） |
| `src/palette.js` | mode 状态机退役；命令表统一；slash 全集（含 `/options`）；搜索桥接行 |
| `src/keyboard.js` | 挂载点抽象；Esc 分层；data-node-id 化；数字键直达；M/R 行操作 |
| `src/dupes.js` | `pickKeeper` 策略、scope/协议归一化参数 |
| `src/dead-links.js` | 双通道 `checkUrl`、并发/超时可配 |
| `src/icons.js` | 6 个 tab 图标 + 策略/标记小图标 |
| `src/store.js` | KNOWN_KEYS 登记 + 迁移 |
| `src/neat.js` | initViewManager 编排接入 |
| `pages/popup.html` / `pages/sidepanel.html` | `#view-tabs` + `#views` 结构（双页同步） |
| `css/neat.css` | tab/视图容器/路径标签（末尾追加，token 化，容器查询） |
| `css/sync-styles.css` | dead 标记 overlay 样式段 |
| `src/options.js` / `pages/options.html` | "视图"分组 + `confirmDeleteFolder`；各新设置项 |
| `src/advanced-options.js` / `pages/advanced-options.html` | deadScanConcurrency/deadScanTimeout |
| `_locales/*/messages.json` | §8 key 清单（复活 2 个死 key） |
| `scripts/package.py` | JS_FILES 登记 |
| `scripts/screenshots/` | shots-themes 补 tab；shots-palette 改视图截图 |
| `tests/` | view-manager/view-recent/view-stats/visit-stats 新 suite；actions 删除确认用例；dupes/dead-links 扩展用例；palette/keyboard/search/tree-view suite 适配 |

## 附录 B：第二轮修订（2026-07-25 新规范，9 项）

第一轮验收后用户提出 9 项改进，全部落地。行为变更如下（测试/截图类改动不重复正文，仅列与本文档设计细节的对齐点）：

| 项 | 变更 | 落点 |
|---|---|---|
| 1 | i18n 截图扩展为 8 语言 × 11 面：seed 补重复书签对 + `visitStats`/`searchHistory`/`deadLastScan` 三份数据，每语言新增 search/recent/dupes/dead/stats 五张视图截图 | `scripts/screenshots/shots-i18n.js` |
| 2 | Esc 分层链测试补齐：document 级菜单层、palette 层、七层全副武装逐层剥离（dialog→menu→palette→view→search→tree→close）、keyup 安全网 | `tests/keyboard.test.js` |
| 3 | 修复死链/去重角标有时不显示：根因是 `updateBadges()` 仅在 renderTabs 时调用——view 激活末尾补调；dupes/stats 的 refresh 改为"总是重算 + updateBadges，仅活跃时 render"；dead persistMarks 挂钩 | `src/view-manager.js`、`src/view-dupes.js`、`src/view-stats.js`、`src/view-dead.js` |
| 4 | 去重组 URL 组头一次（§3.6 本已如此）+ 组头 × 按钮提示动态化：`dupesCleanRestHint($title$,$count$)`（"保留 X，删其余 N"）替换死键 `dupesGroupCleanRest` | `src/view-dupes.js`、`_locales/*` |
| 5 | 搜索/树切换新规范（已回写 §4.3/§8）：重进搜索视图不回填——框空、上区历史、下区结果留存；`searchLastQuery` 退役 | `src/search.js`、`src/store.js` |
| 6 | 树行三轴对齐契约：twisty 槽 16px 箭头居中、图标槽 20px 图标居中（`justify-content: center`）、文本轴 = 16px×层级 + 36px；sync/dead overlay 一律 `position:absolute` 不进 flex 流（neat.css 侧再钉防线）；empty-folder 行补齐 36px 槽宽 | `css/neat.css`、`src/tree-render.js`、`tests/tree-alignment.test.js` |
| 7a | `history` 改为 optional_permissions；recent 视图顶部条幅引导开启（`statsEnabled` 开 + 未授权 + 未 dismiss 时显示），同意即一次性导入 `chrome.history` 全量（URL→各副本同记），写 `statsHistoryImportedAt`；activate 时"已授权未导入"自愈补导入 | `manifest.json`、`src/view-recent.js`、`src/visit-stats.js`（`merge`） |
| 7b | `#stats-list` 并入列表视图行契约（此前整套行样式缺失）；修复列表内工具栏控件键盘隐患——焦点在按钮/下拉时 Enter 曾向隐藏树行派发合成点击、Delete 曾误删树书签；现动作键留在控件本身，导航键只走本列表（ArrowDown/Up 跳入首/尾行）；工具栏控件统一 `focus-visible` 聚焦环 | `css/neat.css`、`src/keyboard.js`、`tests/list-view-parity.test.js` |
| 8 | 命令面板全命令别名：命令表增 `aliases` 字段（`/dupes` 应答 `/dups` `/dedup` `/clear` 等），全部前缀匹配，命令行渲染 muted 后缀列出所有斜杠形式 | `src/palette.js`、`css/neat.css` |

第二轮验收：i18n verify 0 错误、单测全绿、docker 冒烟 + 截图套件通过（i18n 截图 8×11）、打包 v4.0。

## 附录 C：第三轮修订（2026-07-28 新规范，5 项）

第二轮验收后用户提出 5 项改进，全部落地。对齐点如下：

| 项 | 变更 | 落点 |
|---|---|---|
| 1 | 命令面板失焦自动关闭：`focusout` 时若落点不在面板内、且无对话框/菜单打开（`.active` 守卫），即关闭面板；mousedown 守卫管指针、focusout 管键盘，职责不重叠 | `src/palette.js`、`tests/palette.test.js` |
| 2 | 老用户/自定义选项补全：统计/死链/重复三视图获得与 recent 相同的独立显隐开关 `showStatsView`/`showDeadView`/`showDupesView`（默认开）；隐藏即该视图完全不可达（无 tab/无数字键/无面板入口），配合既有 `showViewTabs` 关 = 纯树视图+搜索的老用户体验 | `src/options.js`、`pages/options.html`、三个视图模块的 `hidden` 注册、`_locales/*`（3 新键） |
| 3 | 右键菜单一致性：五个视图列表（recent/stats/dead/dupes/搜索历史上区）补 `scroll`/`focus(capture)` 消除——此前仅树/结果/面板结果有；`view-manager.activate()` 开头必清菜单（Ctrl+数字/任意切换不留悬挂）；`palette.open()` 开头清菜单（菜单 z300 > 面板 z100，必须消除否则浮于面板） | `src/context-menu.js`、`src/view-manager.js`、`src/palette.js` |
| 4 | 层级唯一标准落地：neat.css 头部层级表（L0 基础 → L6 toast z400）为唯一权威；审计发现 `sync-styles.css .sync-tooltip` 的 `z-index: 1000` 数值越表——实际受父 `.sync-indicator`（z10 stacking context）约束无行为问题，但数值误导，改为 z1 并在表中补 Layer 2b 条目；层级值与表的一致性纳入契约测试 | `css/sync-styles.css`、`css/neat.css`、`tests/layering.test.js` |
| 5 | 四主题细节补全：审计确认 root/dark/auto/ink/paper 五块颜色 token 全集一致（结构 token radius/row-h/indent 仅 :root 属设计）；发现 dark/ink 主题 danger 浅底色上白字徽标对比度仅 2.4/2.0:1（不达 AA）——新增 `--vbm-danger-fg`/`--vbm-warning-fg` on-color token（dark/ink 深栗色 7.1–8.4:1，paper 暖白 6.2:1），tab-badge/row-badge/dead-indicator/dupes-apply-all 四处硬编码 `#fff`/`#000` 全部 token 化；token 全集一致性 + 5 主题 × 3 组徽标对比度 ≥4.5:1 纳入契约测试 | `css/neat.css`、`tests/theme.test.js` |

第三轮验收：i18n verify 0 错误（3 新键 41 locale 全量翻译）、单测全绿（970）、docker 截图套件通过、打包完成。

## 附录 D：第四轮修订（2026-07-28 新规范，12 项）

第三轮验收后用户提出 12 项改进，全部落地。对齐点如下：

| 项 | 变更 | 落点 |
|---|---|---|
| 1 | tab 条响应式重做：每个 tab 是独立 inline-size 容器，仅当**该 tab 自身 ≥112px** 才显示文本（icon+label），否则退回纯图标——逐 tab 精准判定，不再出现双行 wrap 或文本截断；`body.panel-mode` 无条件显示规则与全局 480px 查询退役 | `css/neat.css`、`tests/popup-layout.test.js` |
| 2 | 命令面板新增 7 个直接命令：主题五连 `/themeauto|light|dark|ink|paper`（裸名 `/dark` 等为别名，store+localStorage+body[data-theme] 三同步）、`/tabs`（视图标签显隐）、`/path`（路径标签显隐）；`/sep` 添加分隔线命令退役（强位置相关不直观），树内右键分隔线功能不受影响；`paletteCmdNewSeparator` 键已从 43 locale 清理 | `src/palette.js`、`tests/palette.test.js`、`_locales/*` |
| 3 | 清除按钮并入搜索框内部（新增 `#search-field` 包裹 magnifier+input+clear，按钮绝对定位于框内尾端，input 补 26px 尾 padding）——搜索框与星标按钮之间不再留 28px 空白槽；popup/sidepanel 双页同步 | `pages/popup.html`、`pages/sidepanel.html`、`css/neat.css` |
| 4 | "在树中定位"根因修复：`nodeTrees` 只收录文件夹 id，书签目标的 `getParentPath` 拿不到祖先链 → 树全折叠渲染、目标行从未进 DOM，高亮/滚动全部空转。修法：generateTree 时把书签 `id→parentId` 补入 nodeTrees，revealFolder 对书签目标从 opens 切掉自身（opens 只许文件夹） | `src/tree-view.js`、`tests/tree-view.test.js` |
| 5 | 历史导入统计链路 4 个真实 bug 修复：①门控比数据活得久（merge 防抖 500ms vs 门控 200ms，窗口内关 popup 则数据丢门控存→永远跳过）——merge 非空即同步 flush；②`maxResults:2000` 截断 → `HISTORY_IMPORT_MAX=100000`；③startup/activate 双 probe 重入重复导入 → 在飞守卫；④URL 尾斜杠不匹配静默丢弃 → 双侧 matchUrl 折叠。另：`visitStats.revision()` 单调计数，stats 视图 activate 时对账防陈旧（跨视图导入无 dirty 通道） | `src/visit-stats.js`、`src/view-recent.js`、`src/view-stats.js` |
| 6 | 去重组 URL 组头 `font-family: monospace` 移除，继承 UI 字体 | `css/neat.css` |
| 7 | 搜索历史上区右键不再弹书签全量菜单（对空 id 执行编辑/删除是危险误操作）：新增专用精简菜单（重新搜索/删除此条/清空全部），contextmenu 按行类型分发；菜单纳入同一 clearMenu 消除路径，并补全 ↑↓/Enter/Esc 键盘导航与 hover/out 焦点绑定（neat.js/keyboard.js 与另三个菜单同等待遇） | `src/context-menu.js`、`pages/popup.html`、`pages/sidepanel.html`、`src/neat.js`、`src/keyboard.js` |
| 8 | 最近视图时间粗分组：今天（本地自然日）/本周（滚动 7×24h）/本月（滚动 30×24h）/更早——滚动窗口保证组头单调；组头为非交互 div，作为组首行**行尾 DOM 子元素**渲染 + CSS `order:-1` 视觉提前，保住 li.firstElementChild=锚点的 Enter 契约（head-first 模式会让 Enter 落空） | `src/view-recent.js`、`css/neat.css`、`tests/view-recent.test.js` |
| 9 | 统计视图升级为"历史+统计"综合视图：新增最近访问分区（history.search 200 条、URL 去重、协议过滤），未收藏行 hover 显现 ☆ 一键加收藏（落位 quickAddFolderId 默认书签栏，成功后状态翻转+树失效+toast），已收藏行带 ★ 徽标+真实 data-node-id（右键/定位全适用）；无权限时分区折叠为单行引导（一句话+开启链接，授权即加载）；分区小节头同项8 的行尾 DOM+order 模式；badge 语义不变 | `src/view-stats.js`、`src/neat.js`、`css/neat.css`、`tests/view-stats.test.js` |
| 10 | 死链扫描体验：渐进呈现（每个 check 落定即入列，按树序插入不跳动）；状态机 idle/scanning/paused/cancelling——暂停不 abort 在飞（恢复零重探）、取消丢弃本次回退缓存（`scan!==session` 守卫）；Esc=暂停⇄恢复切换（可逆优先，keyboard.js 零改动）；切走回来按模块级会话状态重现；顺手修复 `.row-btn` 换行 bug（li 补 display:flex，dupes-member 配方） | `src/view-dead.js`、`src/dead-links.js`、`css/neat.css` |
| 11 | 图标槽后新增 4px `margin-inline-end`：文本轴 36px→40px（16 twisty+20 icon+4 gap），scoped+unscoped+palette 全部行契约同步；"(Empty)" 行 SLOT_WIDTH 同步 40px；对齐契约测试更新 | `css/neat.css`、`src/tree-render.js`、`tests/tree-alignment.test.js` |
| 12 | 设置导入/导出：options 页新增"备份"分组——导出 chrome.storage.local 全量+sync 区 4 键为打戳 JSON（app/version/exportedAt 校验标识，文件名带日期）；导入校验结构+确认门控后**合并写入**（备份内键覆盖、未涉及键保留）并 reload；`store.syncKeys` 只读暴露避免清单漂移 | `src/options.js`、`pages/options.html`、`src/store.js`、`tests/options.test.js` |

缝合修复（项间交互）：最近视图组头行 Enter 失效（项8 head-first 模式）改为项9 同款行尾 DOM+order 模式；搜索历史菜单补键盘绑定（项7 遗留）；`paletteCmdNewSeparator` 死键清理（项2 遗留）。

第四轮验收：i18n verify 0 错误（28 新键 41 locale 全量翻译 + 1 死键清理）、单测全绿（1060+）、docker 截图套件通过（options 补备份组、recent seed 补时间跨度）、打包完成。

## 附录 E：第五轮修订（2026-07-28 新规范，4 项）

第四轮验收后用户提出 4 项死链相关改进，全部落地。对齐点如下：

| 项 | 变更 | 落点 |
|---|---|---|
| 1 | 死链行按钮/徽章双行布局对齐：宽布局/panel 下锚点两行高（标题 + `.row-sub` 路径），`align-items:center` 把 ⚑/× 按钮与错误码徽章停在两行接缝上——视觉即"书签下面新一行"。li 与锚点改 `flex-start`，按钮/徽章/图标钉在标题行（前 20px = 窄布局单行）；favicon-container 补 `min-height:1.67em` 跟踪标题行高，图标中心对齐标题行；docker 窄/宽双布局探针实证（按钮 top 10.03→0） | `css/neat.css`、`tests/view-dead.test.js`、`diag-dead.js（2026-08 目录重组时删除）` |
| 2 | 死链 × 椭圆根因修复 + dead/sync 标记统一重设计：`#tree ul li span` 通用行规则（display:flex + 1.67em 行高 + padding-inline-end:4px，特异性 1,0,3）渗漏进 overlay span，10px 圆被撑成 14×10 椭圆、× 被行高甩出中心（仅树视图命中，与用户报告一致）。双选择器 `#tree ul li span.dead-indicator`（1,1,3）压过通用规则，全部盒属性钉死（inline-flex 居中/padding:0/line-height:1/min-width）；统一光环语言：dead × 与 sync 点同戴 1.5px `var(--vbm-bg)` 光环（sync local 的 accent 发光退役，unsyncable 同步加环）——位置（右上/右下）+ 形状（徽章/圆点）+ 颜色三重区分，四主题 docker 3x 截图逐一人工复核 | `css/neat.css`、`css/sync-styles.css`、`tests/tree-alignment.test.js` |
| 3 | 死链标记跨视图同步（首帧 + 全部列表）：根因链——① tree-view generateTree 在 innerHTML 替换【前】触发 onTreeGenerated，overlay 画在旧 DOM 上即被清空（预置标记首帧从不显示）；② 文件夹懒展开（getChildren+appendChild）完全绕过 onTreeGenerated；③ 搜索及各列表视图渲染无刷新钩子。修法：onTreeGenerated 移到 innerHTML 之后；新增统一 `onRowsRendered` ctx 钩子，tree-view 懒展开 / search renderResults / recent / dupes / stats 五个渲染出口全部调用，neat.js 统一接线到 deadOverlayRefresh（声明上移至 initSearch 前避 TDZ）；view-dead LISTS 扩展 dupes-list/stats-list | `src/tree-view.js`、`src/search.js`、`src/view-recent.js`、`src/view-dupes.js`、`src/view-stats.js`、`src/view-dead.js`、`src/neat.js`、六个测试文件 |
| 4 | 死链"仅受限"过滤卡死修复：renderToolbar 以**过滤后**行数决定是否渲染过滤段——filter=blocked 且无 blocked 结果时过滤段消失，用户无法切回（除非重开 popup）。拆出 `allResultRows()` 未过滤集合供工具栏判定；过滤条件下无结果时空态文案区分 `deadNoneFiltered`（指引切回其他分段）与原 `deadNone` | `src/view-dead.js`、`tests/view-dead.test.js`、`_locales/*`（1 新键） |

第五轮验收：i18n verify 0 错误（1 新键 41 locale 全量翻译）、单测全绿（1070+）、docker 截图套件通过（diag-dead.js 诊断脚本纳入套件：hover 态/宽窄布局探针/四主题指示器 zoom）、打包完成。

## 附录 F：第六轮修订（2026-07-28 新规范，6 项）

第五轮验收后用户提出 6 项改进，全部落地。对齐点如下：

| 项 | 变更 | 落点 |
|---|---|---|
| 1 | 命令面板鼠标点击失效修复：第三轮项1 的 focusout 失焦关闭与行点击竞争——mousedown 未拦时 blur 先关面板、click 落空。行 mousedown `preventDefault()` 阻止 blur（不拦 click 本身），指针路径与键盘路径行为一致 | `src/palette.js`、`tests/palette.test.js` |
| 2 | tab 条右键误弹书签菜单修复：右键 walk-up 在 tab 条空白处命中 span（图标/标签）时按"书签行"弹了菜单——命中 span 时要求存在 `li` 祖先才继续行菜单判定 | `src/context-menu.js`、`tests/context-menu.test.js` |
| 3 | i18n 实译审查修正：en 的 "nope" 系否定回答改 "Cancel" 并与 zh_CN 对齐，修复拼写与引号/括号风格；37 个 locale 全量重翻受影响键 | `_locales/*` |
| 4 | 侧栏行为抽取 `src/panel-behavior.js`：SW 冷启动时合并 openInSidePanel 选项与面板存活状态再 `setPanelBehavior`，修复"选项偶发失效"（冷启动竞态：存储镜像未就绪即应用）；纯逻辑可测 | `src/background.js`、`src/panel-behavior.js`、`tests/panel-behavior.test.js` |
| 5 | 选项/高级选项响应式多列卡片布局：分组卡片经 CSS multicol 按可用宽度填充列数、页面限宽居中——窄窗单列、宽屏多列，长列表不再单侧拉满 | `css/options.css`、`pages/options.html`、`pages/advanced-options.html`、`tests/options-layout.test.js` |
| 6 | 重复组结果快照持久化 `dupesLastResult`：每次重算落盘（同 deadLastScan 配方）；重开弹窗即时绘制上次结果，activate 后台对活树重算校验漂移；scope/ignoreScheme 不匹配即作废快照 | `src/view-dupes.js`、`tests/view-dupes.test.js` |

第六轮验收：i18n verify 0 错误、单测全绿（1103，37 文件）、docker 截图套件通过、打包完成（95 文件——项4 新模块的清单缺口在第七轮评估中方被发现并修复，见附录 G 项9）。

## 附录 G：第七轮——view-system 分支合并评估（2026-07-29，9 项吸收 + 2 项自查修复）

view-system 分支（他人实现，与 master 同源 `5edc546`，28 提交）与 master（57 提交）各自独立实现了本文与 v4task-2-list。本轮按"对方独有判有用性、双方共有择优、master 独有保持"的原则完成全面对比，结论：**master 全部面对比领先，无架构级吸收项**；对方的 10 个实锤 bug（list-keyboard 三视图导航空转、← 误发合成 Esc、Esc 链序与自家 §3.4 相反、搜索历史四处缺陷、dead blocked 语义反、dupes 批量删无 undo、三视图右键菜单空 id 等）存档为不吸收证据。完整证据链与逐项裁定见 `docs/review-4.0.0/view-system-合并评估报告.md`。吸收与修复对齐点：

| 项 | 变更 | 落点 |
|---|---|---|
| 1 | CDP Esc 限制分析文档吸收：CDP `Input.dispatchKeyEvent` 不达 document capture 阶段（上游未修 bug）——"为什么 Docker 层没有 Esc 测试"的定论；测试分层：Esc 归 vitest 真 handler，Docker 只测 bubble 可达键 | `docs/cdp-escape-limitation.md` |
| 2 | Docker 键盘/视图硬断言验证移植（对方 verify-keyboard.js 适配 master DOM：hidden 属性语义、`#results` 直挂、class 选择器；新增 ↓ 入列表、历史落账、dupes 完整渲染断言）：tab 条 bubble 键盘流/roving tabindex、焦点区域拓扑、搜索双区重进留存、逐视图渲染共 32 断言；接入 run.sh 阻塞步骤 + Dockerfile | `scripts/harness/verify-keyboard.js`、`run.sh`、`Dockerfile` |
| 3 | 搜索历史上区高度上限：`max-height:40% + overflow-y:auto`——10 条历史在矮 popup 不再挤压结果区 | `css/neat.css` |
| 4 | 行级整行 hover 底色 `.vbm-row:hover`：行尾路径/按钮区此前无 hover 反馈；锚点选中态仍优先（对方 bb7b62e 项3） | `css/neat.css` |
| 5 | dupes 组头 URL 中段省略 `midTruncate`：组 key 区分度常在尾部路径，CSS 尾截恰好截掉它——去 scheme + head 55% + … + tail，完整 key 留 tooltip（对方唯一呈现亮点） | `src/view-dupes.js`、`tests/view-dupes.test.js`（2 新例） |
| 6 | sync 圆点 6px 契约 + 负向守卫：sync-styles 钉 6px/50%，neat.css 守卫规则禁尺寸/圆角（对方 sync-indicator.test.js 核心断言，并入既有对齐契约而非另起文件） | `tests/tree-alignment.test.js` |
| 7 | 相对时间 label 去重（吸收对方 format-utils 证明的重复问题，不收模块本体——master 的 relativeTimeBucket 等价且测试更强）：新增导出 `relTimeLabel(ts,_m)`，顺手吸收 falsy-ts→'' 语义修掉 1970 边界；search/view-recent/view-stats 三处 4 行复制品消除 | `src/tree-render.js`、`src/search.js`、`src/view-recent.js`、`src/view-stats.js`、`tests/tree-render.test.js`（3 新例） |
| 8 | **自查修复（高优先级）**：`scripts/package.py` JS_FILES 漏登记 `src/panel-behavior.js`（第六轮项4 新模块，SW 顶层 import）——打包后 SW 起不来；补登记后 96 文件 | `scripts/package.py` |
| 9 | **自查修正**：`optionShowRecentBookmarks` 文案陈旧（"at the top of the popup" 为树内分区时代残留，实际语义早已是最近视图标签显隐）——en/zh_CN 实译改为与其余三视图开关同句式；其余 41 locale 待下一次 `i18n.py translate` 跟进 | `_locales/en/messages.json`、`_locales/zh_CN/messages.json` |
| 10 | 文档矩阵落地：双语 README 按 4.0 全景重写（开篇可直接用于 webstore 介绍页）；新增双语 v4 功能指南（视图总览/全键盘手册/逐视图用法/经典外观配方/设置备份/隐私 + 8 张 docker 实拍截图）；新增 `shots-guide.js` 截图套件（搜索双区重进态、选项页视图分组卡片）纳入 run.sh | `docs/README.md`、`docs/README.zh.md`、`docs/guide-v4.md`、`docs/guide-v4.zh.md`、`docs/images/guide/`、`scripts/screenshots/shots-guide.js` |

第七轮验收：i18n verify 0 错误（258 键 × 43 locale）、单测全绿（1103，37 文件）、docker 全量 harness 通过（smoke 零控制台错误 + verify-keyboard 32/32 + shots/shots-themes/shots-i18n/shots-palette/shots-guide 五套件无错误）、打包 96 文件校验通过。

## 附录 H：第八轮——v4task-3 问题清单（2026-07-31，20 项中 19 项实施，项13 已提前解决）

`docs/plan-4.0.0/v4task-3.md` 的 20 项问题全部落地（项13 截图此前已重拍，标注忽略）。逐项对齐：

| 项 | 变更 | 落点 |
|---|---|---|
| 1 | 最近添加/统计视图横向滚动条常驻：行模板三处 flex basis 由固定值改 auto，内容不再撑溢出 | `css/neat.css`、`diag-v4t3.js（2026-08 目录重组时删除）`（真实浏览器探针） |
| 2 | 统计视图排序段"看似无效"：根因是受控的书签统计区排在历史区之后，count 并列时切换无视觉变化——书签统计区提前到排序段正下方（受控列表紧贴控件），`.active` 高亮与 `statsSort` 持久化经探针实测 | `src/view-stats.js`、`tests/view-stats.test.js` |
| 3 | 死链视图宽版双行时右侧标记/删除按钮垂直居中（原顶部对齐） | `css/neat.css` |
| 4 | 死链视图选择模式：工具栏"选择"按钮进入/退出，全选/反选/取消全部，标记所选/取消标记所选；选中计数条幅 | `src/view-dead.js`、`tests/view-dead.test.js` |
| 5 | 去重视图同款选择模式 + 每个重复组标题栏右上的单组"应用去重"快捷钮（直接按当前 keeper 应用并同步刷新上方统计条幅） | `src/view-dupes.js`、`tests/view-dupes.test.js` |
| 6 | 记忆视图：`rememberView` 选项（默认开）——popup 重开恢复上次视图，关闭则回树视图；面板模式恒记忆。存储的视图 id 尚未注册时挂入 `pendingRestore`，待其模块注册即恢复（此前面板也只能恢复 tree/search，feature 视图注册晚于 startup） | `src/view-manager.js`、`src/options.js`、`tests/view-manager.test.js` |
| 7 | §2.1 遗留项实施：全部行模板 `tabindex="0"` 改 `-1`（roving 列表模型，每视图列表只占一个 Tab 位）；`keyboard.js` 新增 document 级 Tab/Shift+Tab 三区域循环器（搜索框 → 可见头部按钮 → 活动 tab → 列表 `.focus`/首行，对话框/面板/菜单打开时放行；显隐判定含 `getClientRects`，覆盖 `body.no-view-tabs` 的 CSS 隐条）；区域焦点记忆——`viewState` 由纯 scrollTop 数字迁移为 `{ scroll, focus }`（旧值兼容），离开时记 `.focus` 行 id、`focusin` 实时标记鼠标点选行、进入时 100ms×20 看守循环重标（扛住视图 activate 钩子的异步重渲染）；旧 search.js 的 Tab→focusID 跳转分支删除（Tab 不再被 preventDefault） | `src/keyboard.js`、`src/view-manager.js`、`src/tree-render.js`、`src/search.js`、`src/view-recent.js`、`src/view-stats.js`、`src/view-dead.js`、`src/view-dupes.js` + 各测试；`verify-keyboard.js` 新增 §2.1 循环 8 断言 + 焦点记忆段（共 43 断言） |
| 8 | 搜索框清空按钮不可见：`updateClearBtn` 改为给 `#search` 挂/摘 `has-query` 类，CSS 据此显隐（原直接操作按钮样式被层叠覆盖） | `src/search.js`、`css/neat.css`、`tests/search.test.js` |
| 9 | 3.x→4.x 升级时捐赠卡醒目提示：新增 `#v4-notice`（accent 边框卡片，`donationV4Notice` 文案 + `donationV4GuideLink` 链接），链接按 `chrome.i18n.getUILanguage()` 选 `guide-v4[.zh].md`；仅 `recordVer.major<4 && currentVer.major>=4` 的升级路径显示，新装不见 | `src/neat.js`、`pages/popup.html`、`pages/sidepanel.html`、`css/neat.css`、`_locales/*` |
| 10 | 统计视图最近访问区菜单分化：未收藏的历史行（无 bookmark id）给精简菜单——三种打开方式（经行 href）+ "收藏"（复用行内 ☆ 按钮路径）；已收藏行保持完整书签菜单 | `src/context-menu.js`（hist-row 菜单）、`pages/popup.html`、`pages/sidepanel.html`、`tests/context-menu.test.js` |
| 11 | 非树视图书签菜单去方位项：`POSITIONAL_IDS`（此前/此后添加书签/文件夹等）在不可见树结构的视图一律隐藏，只留直观项 | `src/context-menu.js`（`setPositionalItems`）、`tests/context-menu.test.js` |
| 12 | 方向键跨视图焦点修复：↓ 从搜索框进活动视图列表、搜索视图历史区→结果区连续转移、recent/stats/dead/dupes 视图 ↓ 不再无反应；`view-manager.focusActive()` 统一"聚焦活动列表"入口 | `src/keyboard.js`、`src/view-manager.js`、`tests/keyboard.test.js`；Docker verify-keyboard 实测 |
| 14 | 树中定位 vs 只显示书签栏：见下方方案选型 | `src/tree-view.js`、`src/undo.js`、`src/neat.js`、`_locales/*`、`tests/tree-view.test.js`、`tests/undo.test.js` |
| 15 | 搜索最近搜索区按 → 弹出该行的右键菜单（与鼠标右键同菜单，键盘快捷操作设计对齐）；历史区 ↑↓/Home/End 行导航 | `src/search.js`、`tests/search.test.js` |
| 16 | 重复组头与重复项菜单分化：组头专属菜单——"应用去重"（文案实时含 keeper 标题与将删数量）+ 展开/收起（跟随当前态） | `src/context-menu.js`（dupes-group 菜单）、`pages/popup.html`、`pages/sidepanel.html`、`tests/context-menu.test.js` |
| 17 | 选项/高级选项合并为单页八组（General/Views/Sync/Accessibility/Custom icon/Custom styles/Dead scan/Backup+reset）；`advanced-options.html` 变重定向桩（CSP 禁内联脚本，跳转逻辑在 `src/advanced-options.js`）；布局改 CSS multicol 卡片 `columns:340px` + 1760px 限宽——4K 下自动填更多列，消除左下空白；`deadProxyTemplate` 归入 Dead scan 组 | `pages/options.html`、`src/options.js`、`src/advanced-options.js`、`css/options.css`、`tests/options.test.js`、`tests/options-layout.test.js` |
| 18 | 强迫症选项 `showTabBadges`（默认开）：关闭即隐藏全部 tab 数量角标 | `src/view-manager.js`、`src/options.js` |
| 19 | 侧栏残留修复：见下方根因分析 | `src/panel-behavior.js`、`src/popup.js`、`src/background.js`、`tests/panel-behavior.test.js` |
| 20 | 一键复原旧体验：Views 组新增"经典体验"按钮，一键关闭 `paletteEnabled`/`quickAddEnabled`/`showToolButton`/`showViewTabs` 并同步取消勾选；四项均可独立开关（前三者为本轮新增独立选项）；`palette.js open()` 守卫覆盖 Ctrl+K/工具按钮/全局命令全部唤醒路径 | `src/options.js`、`src/palette.js`、`src/neat.js`、`css/neat.css`、`tests/options.test.js`、`tests/palette.test.js` |

**项14 方案选型（任务要求二选一）**：备选 (a) 定位失败时 toast 提示；(b) 开了"只显示书签栏"就把所有视图限定在栏内。选定 **(a) toast 提示 + "显示全部并定位"一次性动作**，理由：① 最近添加/统计/搜索等列表视图本质是全局工作区——新书签恰恰常落在栏外文件夹，全局限定会让这些视图缺数据，违背直觉；`onlyShowBMBar` 的既有语义是"树视图的显示过滤器"，悄悄扩大作用域破坏心智模型。② 静默失败是最差体验；toast 解释原因并给出一次性出口，定位任务总能完成。③ 覆盖仅会话内生效（`showAllOverride` 模块级标志），绝不回写设置——用户的过滤偏好不被一次定位动作悄悄改掉。实现：undo 条通用化为 `toastAction(message, label, onAction)`（一次性动作，showToast/自动隐藏即失效）；`revealInTree` 以 `nodeTrees` 无条目判定目标在栏外；动作先生成全树（祖先链方可解析）再走原 reveal 链。

**项19 根因**：用户猜测的"历史数据残留"基本属实——`sidePanelIsOpen` 裸标记无法证明面板存活：浏览器崩溃/会话恢复/面板渲染进程被杀时 `pagehide` 不触发，`storage.session` 里残留的 `true` 会被每次 SW 启动反复推导成 toggle 模式，图标点击便持续开关侧栏。修复：面板页每 20s 心跳 `sidePanelHeartbeat`（`PANEL_HEARTBEAT_MS`），SW 启动与选项关闭时以"标记 + 90s 内心跳"（`PANEL_STALE_MS`）判定存活，残留标记读取即清除；命令开栏路径同步写心跳。活面板在 SW 重启后仍保持 toggle（第六轮语义不变）。

**行为变更（升级须知）**：`rememberView`/`showTabBadges`/`paletteEnabled`/`quickAddEnabled` 默认开；选项页合并（advanced-options.html 仅重定向）；列表行 roving `tabindex="-1"` + Tab 三区域循环；`viewState` 持久化结构迁移为 `{ scroll, focus }`（读取兼容旧数字）；`storage.session` 新增 `sidePanelHeartbeat` 键。

**新增 i18n 键（22）**：选择模式共用 `selectAll`/`selectClear`/`selectCount`/`selectInvert`/`selectModeEnter`/`selectModeExit`；死链 `deadMarkSelected`/`deadUnmarkSelected`；去重 `dupesApplySelected`/`dupesConfirmSelected`/`dupesGroupExpand`/`dupesGroupCollapse`；选项 `optionRememberView`/`optionShowTabBadges`/`optionPaletteEnabled`/`optionQuickAddEnabled`/`optionShowToolButton`/`optionClassicExperience`/`optionClassicExperienceHint`；升级提示 `donationV4Notice`/`donationV4GuideLink`；定位提示 `revealOutsideBarHint`/`revealOutsideBarAction`。en/zh_CN 实译，其余 41 locale `[TODO:key]` 占位待 `i18n.py translate` 跟进。

第八轮验收：单测全绿（1184，37 文件）、i18n missing=0 且 audit 通过、打包 96 文件校验通过、docker 全量 harness 通过（smoke 零控制台错误——含 rememberView/经典开关/升级提示/栏外定位 toast/面板心跳/合并选项页/重定向七组行为断言，verify-keyboard 43/43，shots/shots-themes/shots-i18n/shots-palette/shots-guide 五套件无错误）。

## 附录 I：第九轮——v4.0 抛光收尾（2026-08-01，冲突修复 + UX/无障碍 + 测试/基建 + 文档/截图/图标）

v4task-3 落地后的整体抛光：通读 docs 下全部现代化计划对齐思路、查漏补缺，分五批实施。

**批次 1 冲突修复（键盘/菜单/焦点）**

| 变更 | 落点 |
|---|---|
| 去重组成员行键位补齐：Enter/Space 合成 click 打开该副本、← 回组头（RTL 镜像） | `src/view-dupes.js`、`tests/view-dupes.test.js` |
| 新菜单（hist-row / dupes-group）接入键盘导航与鼠标轨迹高亮（contextKeyDown/contextMouseMove 绑定） | `src/keyboard.js` |
| 工具行控件纳入 §2.1 Tab 循环：tabCycle 增加 `.vbm-toolbar` 停靠点，五视图工具行补类名 | `src/keyboard.js`、`src/view-stats.js`、`src/view-dead.js`、`src/view-dupes.js` |
| 对话框打开时 Tab 圈禁在框内（以 `dialogs.activeEl()` 判定活动对话框） | `src/dialogs.js`、`src/keyboard.js` |
| 搜索结果区补 auxclick（中键打开，与树一致） | `src/tree-view.js` |
| 统计/死链视图排序段 ←/→ roving 迁移 | `src/view-stats.js`、`src/view-dead.js` |

**批次 2 UX / 无障碍**

| 变更 | 落点 |
|---|---|
| 右键菜单 ARIA 化：`role="menu"` / `role="menuitem"`（popup 6 + sidepanel 40 处；CSS 依赖 `menu[type=context]` 选择器故保留 `menu` 标签） | `pages/popup.html`、`pages/sidepanel.html` |
| 5 个对话框容器补 `aria-modal="true"` | `pages/popup.html`、`pages/sidepanel.html` |
| favicon 补 `loading="lazy"`（树行与面板行） | `src/tree-render.js`、`src/palette.js` |
| 全局快速收藏键 Alt+Shift+S（mac Cmd+Shift+S）占用 manifest 第 4 命令槽 `quick-add-bookmark`，静默保存不弹窗 | `manifest.json`、`src/background.js`、`_locales/*` |

**批次 3 测试补足**

- 新增 `tests/background.test.js`（13 例：SW 导入双模式 chrome stub，命令分发/心跳/面板开关）；`tests/popup.test.js`（9 例：`new Function` 沙箱求值，双模式 storage stub）。
- `tests/options.test.js` +4（死链并发/超时钳制与 reset 回默认）；`tests/keyboard.test.js` setup 支持 `dialogActiveEl` 惰性注入；`tests/dialogs.test.js` 容器 id 补 5 对话框。
- `smoke.js` 2f 段：面板唤醒双路径断言（`?palette=1` 直开聚焦；`pendingPaletteOpen` 会话标记开一次即消费）。

**批次 4 基建（CI / i18n / 目录重组）**

- `.github/workflows/ci.yml`：单测 + `i18n.py missing` + `i18n.py verify` + `package.py` 打包校验（verify 无 `--strict` 时警告不阻塞）。
- i18n 全量跑批：`quickAddBookmarkCommand` 等 24 键 × 41 locale 经 `i18n.py translate --apply` 补译，43 locale × 282 键 todo=0。
- `scripts/screenshots/` 目录重组：5 截图套件入 `suites/`、3 诊断探针入 `diag/`（run.sh 不跑 diag），新增 README 说明布局与用法；run.sh / Dockerfile / 双语 README / AGENTS.md 引用同步。

**批次 5 文档 / 截图 / 图标**

- `docs/guide-v4.md` / `guide-v4.zh.md` 全量回填：rememberView 默认开与角标开关、§2.1 Tab 循环 + 焦点记忆、§2.3 Alt+Shift+S、§2.4 Esc 分层补选择模式层、§3.1 历史区 → 菜单、§3.2 栏外定位 toast、§3.4/§3.5 选择模式段、§5 经典体验配方 + 5 个新开关。
- README 双语：启动语义、设置段重写、组名对齐、数字更新（1229 例 / 39 套件 / 282 键 / 43 locale）、changelog 补抛光段。
- `docs/现代化演进总方案.md` 追加"§9 v4.0 定稿回写"，记录四项有意未做（保存流升级放弃、骨架屏/首次引导、ResizeObserver、搜索防抖）及理由。
- 图标 SVG 化：`assets/icons/icon.svg`（透明圆角红方块 + 白色 chevron，按 128px PNG 实测几何重绘）；options 页两处 `<img>` 与预览改用 SVG；**manifest 与 `setIcon` 保留 PNG**——Chrome 拒绝 SVG 作 action 图标；`scripts/package.py` 清单同步。
- 截图：五个套件全部补 donation 静默 seed（`donationFactor:1, donationKey:30`，shots.js 的 12 号捐赠镜头保留）；shots-guide.js 新增死链/去重选择模式两张（dead-select/dupes-select）并配入 guide §3.4/§3.5；全量重拍更新 `docs/images/guide/`。

第九轮验收：单测 1229 例 / 39 文件全绿；i18n missing todo=0、verify 通过、audit 通过；打包 97 文件（+icon.svg）校验通过；docker 全量 harness 通过（smoke 零控制台错误、verify-keyboard 43/43、五套件无错误）；guide 配图抽查无 donation 横幅、选择模式批量条可见。

## 附录 J：第十轮——v4 最终抛光追加轮（2026-08-01，键盘模型定稿 + 方向键层级链 + 选项分组 + CSS 打磨）

**1. scripts 整理**：根目录遗留的 `diagnose_alignment.js` / `diagnose_colors.js` 现归入 `scripts/console/`（`probe-alignment.js` / `probe-colors.js`，devtools console 手贴片段，与 Docker 探针分居）。

**2. 全键盘模型定稿（`docs/keyboard-model.md`）**：通读 keyboard/view-manager/search/各 view/菜单/对话框全部键盘路径后，把方向键、Esc、Tab 语义成文为"规则 + 理由 + 代码落点 + 测试锚点"的设计文档——区域视觉栈（头部行/横幅/tab 条/视图内容/覆盖层）、↑↓ 垂直链与 ←→ 行内语义、搜索双区例外、Esc 分层蛋糕、Tab 区域环、**选项组合适配矩阵**（showViewTabs/单视图禁用/quickAddEnabled/showToolButton/经典体验/rememberView/面板/RTL/横幅：每条规则在任意组合下重排不失效）、不变量（按键永不聚焦隐藏元素、可见控件必可 Tab 到达）。guide-v4 双语 §2 随之重写为用户手册并互链。

**3. 方向键朴素层级链落地与对齐**（核心诉求：方向键走位与视觉布局一一对应、可来回切换）

| 变更 | 落点 |
|---|---|
| `views.focusDown()`：头部 ↓ 的分层目标（strip 可见→活动 tab，隐藏→直进列表） | `src/view-manager.js` |
| 搜索框 ↓（浏览态）落到 tab 条（取代 v4task-3 #12 的直达列表跳层）；→（光标在文本末尾且无选区）出框到快速加星→工具按钮，隐藏按钮跳过 | `src/search.js` |
| 头部行 ←/→ 链：quick-add ⇄ tool、← 回框时光标置末；按钮上 ↓ 同 focusDown | `src/keyboard.js` |
| 搜索历史区 ↑ 越顶改走通用跨区 focusTop（strip→box），不再直达 box 跳层——双区例外仅保留"框 ↓ 直进本视图内容" | `src/search.js` |
| 去重组头 ←/→/Enter/Space 折叠/展开后焦点重泊新组头（innerHTML 置换吞焦点，`pendingHeadFocus` 修复） | `src/view-dupes.js` |
| 横幅键盘可达：Tab 环在其视觉位置（头部⇄tab 条间）加入可见横幅控件停靠；Esc 分层第 3 层消除横幅（派发到其自有"稍后"按钮，snooze 语义留在 neat.js）；横幅**不做**方向键停靠站（链稳定性） | `src/keyboard.js` |

**4. 分割线设置独立成组**：选项页 8→9 组——Separators 组收编 4 个分割线设置项（移出 Custom styles，后者只剩 userstyle）；新 i18n 键 `separatorOptions`（en/zh_CN 实译，41 locale 经 `i18n.py translate --apply` 补译，missing=0、verify 通过）；`tests/options-layout.test.js` 组数/归属断言、AGENTS.md、README 双语同步。

**5. CSS / UX 打磨（截图诊断驱动）**

| 变更 | 落点 |
|---|---|
| 选项页 checkbox 标签悬挂缩进：`label:has(> input[type=checkbox]:first-child)` 加 bidi padding + 负 text-indent，绕排文本与标签文本首对齐（不再缩进于 checkbox 之下） | `css/options.css` |
| 按钮 margin-left:1em 改 bidi 安全 margin-inline-start，且行首按钮（classic-experience/export/Use default）贴左边；checkbox 5px 间距 bidi 化 | `css/options.css` |
| 分割线组 4 输入框 + 死链代理模板输入框改块级全宽（标签在上），input 包裹 label + 补 aria-labelledby | `pages/options.html`、`css/options.css` |
| 对话框动作按钮间补 .5em 间距（此前仅靠空白文本节点约 4px） | `css/neat.css` |
| shots.js 预存缺陷：06 号编辑对话框镜头此前在隐藏树视图上按 F2（焦点不可达，对话框从未打开，`edit dialog open: false` 被静默吞掉）——改为先切回树视图聚焦目标行再按 F2，现已出图 | `scripts/screenshots/scripts/screenshots/shots.js` |

**6. 测试补足**：vitest 1229→1246（+17：header-row arrows 6、focusDown 2、box → 出框 4 情形、search-box ↓ focusDown 3、dupes 组头焦点重泊 2、横幅 Tab 环 2、横幅 Esc 层 2、历史区 ↑ focusTop 1、options 分割组归属 1 等）；verify-keyboard 43→89 断言全绿（§2.2c 各视图行导航/越顶 22、§2.1d 头部行方向链 7、§4.3b 双区焦点转移含历史区两段越顶 8、§7 横幅键盘可达 8；recent 段处理焦点记忆态——strip ↓ 恢复记忆行为设计行为，断言改 Home 归位后走查）。

第十轮验收：单测 1246 例 / 39 文件全绿；i18n missing=0、verify 通过（4 个菜单超长警告为历史遗留）；docker 全量 harness 通过（smoke 零控制台错误含选项页 9 组、verify-keyboard 89/89、五截图套件无错误）；打包 97 文件校验通过。

## 附录 K：第十一轮——v4 抛光追加轮二（2026-08-01，九项问题修复 + 工具行方向键层级 + 命令面板收尾）

**1. side panel 选项关闭后 action 不回 popup 修复**（问题 2）：根因——面板关闭时 pagehide 不保证触发，`sidePanelIsOpen:true` + 新鲜心跳在 90s 窗口内让 `readPanelLive` 误判"存活"，关选项后仍推导 toggle 模式。修复：`src/panel-behavior.js` 的 `readPanelLive` 优先用 `chrome.runtime.getContexts({contextTypes:['SIDE_PANEL']})`（Chrome 116+ 权威存活探针），无此 API 时回退原心跳路径（manifest 最低 114）。tests/panel-behavior.test.js +4 例（19/19）。

**2. 去重视图视觉统一**（问题 3/4）：`.dupes-toolbar` 原生灰按钮改 accent 扁平文本按钮（镜像 `.dead-toolbar`，两个实心 accent 胶囊保持主按钮样式）；组头快速"应用"按钮（cleanGroup ×，带完整本地化 tooltip）由 hover/focus-within 才显改为**常显**——统计同步是构造保证：× → ConfirmDialog → removeSequentially → onRemoved → scheduleRefresh → regroup → renderToolbar 重算 dupesPreviewSummary/Apply-all 计数 + updateBadges。落点 `css/neat.css`。

**3. 工具行成为方向链真实层级**（问题 5，keyboard-model §2.5）：

| 变更 | 落点 |
|---|---|
| 新 API `focusToolbar()`（聚焦首个可用可见控件）/`focusListExit()`（toolbar 优先否则 focusTop）；strip keydown ArrowDown 与 `focusDown()` 先走工具行 | `src/view-manager.js` |
| 非行分支重写：工具行内 ↓ 进记忆/首行、↑ 走 focusTop、←/→ 按阅读序走控件（RTL 镜像、边界死端、跳过 disabled）；**SELECT 的 ↑/↓ 不劫持**（原生改选项）；Home/End/Page* 落回列表自身分支；行内控件（keeper-radio、row-btn）↑/↓ 相对所在行行走，越顶走 focusListExit | `src/keyboard.js` |
| 三视图删除各自 seg 局部 ←/→ walker（会被通用 walker 双击）；新增 `toolbarFocusIndex()/restoreToolbarFocus()`——工具行随列表重绘（排序切换、扫描进度、重新分组）时焦点原位恢复 | `src/view-stats.js`、`src/view-dead.js`、`src/view-dupes.js` |
| 历史区 ↑ 越顶同走 focusListExit 显式分支（`(a||b)()` 会丢 this 绑定） | `src/search.js` |
| 文档同步：keyboard-model §1/§2.1/§2.5/§7/§8 表，guide-v4 双语 §2.1 层级图与四条工具行要点、§2.2/§2.3 表格行 | `docs/` |

**4. 命令面板收尾**（问题 6/7）：`updateSelection` 加 `scrollIntoView({block:'nearest'})`——↑↓ 移动焦点时可视范围跟随滚动；底部正中可见关闭按钮（含 `.palette-close-label` 与 `<kbd>Esc</kbd>`）+ 输入框右侧可点击清空 ×（search-clear 同款圆形按钮，`has-query` 门控，mousedown preventDefault 保焦点）；两按钮 `tabindex="-1"`。新 i18n 键 `paletteClose`（284 键，41 locale 经 translate --apply 补译）。落点 `src/palette.js`、`pages/popup.html`、`pages/sidepanel.html`、`css/neat.css`；palette.test.js +5 例（88/88）。

**5. 统计视图最近访问条目补时间**（问题 8）：根因——宽屏(≥480px)/panel 模式 `.row-path` 被 CSS 隐藏只显 `.row-sub`，旧码没给 subText 导致时间完全消失；现每行 subText：已收藏行 `(showPath&&path) ? path·absTime : absTime`，未收藏行 `absTime`（`new Date(r.t||0).toLocaleString()`），rightText 保持 relTimeLabel。落点 `src/view-stats.js` renderHistorySection；view-stats.test.js +1 例（37/37）。

**6. 搜索视图 ↑↓ 不对称确认**（问题 1）：**文档化设计行为，非 bug**——keyboard-model §3 双区例外：搜索框是搜索视图自身主控件，↓ 直进本视图内容（v3 肌肉记忆）；两区越顶 ↑ 仍走通用跨区（tab 条→搜索框）。

**7. 命令面板自定义指令设计文档**（问题 9）：`docs/palette-commands-design.md`——数据模型 `paletteCustomCommands`（id/name/slash/aliases/action/useCount）；action 三层白名单（Tier 0：open-url / open-url-group（书签文件夹即 URL 组，会话快照天然可恢复）/ view-preset；Tier 1：url-template 参数化（`%s` 占位，slashRest 通道现成）/ bookmark-batch / tab-batch；Tier 2：macro + 导入导出）；内置命令保留字冲突裁决；选项页第 10 组管理 UI + 面板内"存为指令"闭环；sync 配额（100 条上限）与安全红线（仅 `https?://`，无任意脚本）；三阶段路线图。**只设计不实现**。

**8. 测试补足**：vitest 1246→1262（+16：panel-behavior getContexts 4、palette 滚动跟随/关闭/清空 5、view-manager 工具行 rung 6、view-stats subText 1）；verify-keyboard 89→100 断言全绿（§2.2c stats/dead/dupes 工具行走位新断言 11 条——strip ↓→工具行首控件、→/← 走控件、工具行 ↓→首行、首行 ↑→工具行、工具行 ↑→tab、dupes select 原生 ↑/↓ 不劫持）。

第十一轮验收：单测 1262 例 / 39 文件全绿；i18n 284 键 missing=0、verify 通过（4 个菜单超长警告为历史遗留）；docker harness 通过（smoke 零控制台错误、verify-keyboard 100/100、五截图套件重拍复核去重视图视觉）；打包 97 文件校验通过。
