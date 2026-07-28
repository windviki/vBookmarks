# v4 任务包 2：视图化（Tabs/Views）重构设计方案

> **状态：已完成——切片 A/A2/B/C/D/E 全部落地，最终验收通过**（2026-07-25：i18n verify 0 错误（223 键 × 43 locale 对齐，78 个新键全量翻译）、892 单测全绿（30 文件）、docker 冒烟+截图套件全通过（smoke 零控制台错误、视图/主题/i18n 截图含 ar RTL 镜像断言）、打包 95 文件 v4.0；v2：tab 视觉规范、搜索历史、死链缓存/代理/标记、去重策略、路径标签；v3：删除非空文件夹确认回归、选项开关与自定义入口全集、options"视图"分组、明确不纳入清单）。
> 本文只做设计，不含实施；实施时按 §9 分切片执行。
> 前置阅读：`AGENTS.md`、`docs/v4task-1.md`（协作约定与硬约定）、《现代化演进总方案.md》§7.1（侧栏策略）、§2（品味三原则）。
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
