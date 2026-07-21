# v4 任务包 2：Tab/View 视图系统重构设计

> 状态：**方案设计阶段**（待评审确认后实施）
> 依赖：v4task-1（P1–P4 全部完成）
> 目标：引入 tab 视图架构，统一 popup 与 side panel 的导航体验，为 side panel 全功能迁移铺路

---

## 1. 动机与目标

### 1.1 现状问题

当前 popup/sidepanel 的"内容区域"是一个扁平结构：

```
#container
├── #search (工具栏：搜索框 + 星标 + 工具按钮)
├── #tree  (主内容区)
│   ├── #recent-section (最近添加，虚拟置顶区)
│   └── 主树 (书签文件夹层级)
└── #results (搜索结果显示区)
```

存在以下结构性问题：

1. **"最近添加"是一个廉价的附加功能**——它被硬编码在树视图顶部 (`tree-view.js:120-196`)，无法独立导航，折叠后完全不可见，没有自己的"主页"身份
2. **功能发现性差**——死链扫描、重复管理、会话保存等功能全部藏在 `Ctrl+K` 命令面板的斜杠命令后面，新用户几乎无法发现
3. **缺乏视图切换机制**——用户只能在"树视图 + 搜索过滤"之间二选一，没有能力在不同功能视图间独立切换
4. **为 side panel 铺路**——side panel 有更大的纵向空间（`100vh`），popup 只有 600px 高，二者需要统一的视图导航模型
5. **搜索输入框定位模糊**——工具栏搜索框和命令面板各有一个输入框，都做搜索，用户容易混淆

### 1.2 设计目标

1. **引入 Tab 视图系统**——在工具栏下方增加一个水平 tab 栏，容纳 6 个独立视图
2. **最近添加升级为独立视图**——从树顶的虚拟区域变成一个完整的 tab 页
3. **命令面板可在任意视图呼出**——`Ctrl+K` 全局可用，不因切换视图而失效
4. **所有 palette 命令提供 `/` slash command**——命令面板中所有可点击指令，都有对应的 `/` 前缀快捷输入
5. **理清搜索三件套的关系**——工具栏搜索框、命令面板输入、搜索视图三者各司其职

---

## 2. 整体架构设计

### 2.1 Tab 视图系统

```
┌──────────────────────────────────────────────┐
│  #search (工具栏：搜索框 + 星标 + 工具 ⋮)      │
├──────────────────────────────────────────────┤
│  #tab-bar (Tab 栏)                            │
│  [🌳 Tree] [🔍 Search] [🕐 Recent]            │
│  [📊 Stats] [💀 Dead] [📋 Dupes]              │
├──────────────────────────────────────────────┤
│  #view-container (视图容器，flex:1 占满剩余空间) │
│                                              │
│  当前活跃视图的内容渲染在这里                    │
│  (替代原来的 #tree / #results 二选一)          │
│                                              │
├──────────────────────────────────────────────┤
│  #undo-toast (底部浮层，固定定位)              │
└──────────────────────────────────────────────┘
```

#### Tab 定义

| Tab ID | 标签名(i18n key) | 图标 | 默认可见 | 说明 |
|--------|------------------|------|---------|------|
| `tree` | `tabTree` | 🌳 文件夹 | ✅ 是 | 默认视图，文件夹树 + 展开/收起 |
| `search` | `tabSearch` | 🔍 放大镜 | ✅ 是 | 全功能搜索视图 |
| `recent` | `tabRecent` | 🕐 时钟 | ✅ 是 | 最近添加的书签（原 #recent-section 升级） |
| `stats` | `tabStats` | 📊 柱状图 | ✅ 是 | 访问统计视图（站内点击/访问频率） |
| `dead` | `tabDead` | 💀  skull | ✅ 是 | 死链扫描与管理 |
| `dupes` | `tabDupes` | 📋 复制品 | ✅ 是 | 重复书签检测与清理 |

**Tab 可见性设置**：用户在 options 页可配置哪些 tab 显示/隐藏（默认全部显示）。与现有 `showRecentBookmarks` 设置的关系见 §5 迁移方案。

#### Tab 栏 UI 规格

- 水平排列，位于搜索工具栏下方、视图容器上方
- 活跃 tab 高亮（`--vbm-accent` 底部边框 + 加粗文字）
- 支持键盘导航：`Ctrl+1~6` 快速切换（或在 tab 栏聚焦时 `← →` 切换、`Enter` 激活）
- tab 栏支持横向溢出滚动（popup 宽度仅 320px，6 个 tab 可能超出；side panel 空间更充裕）
- 每个 tab 显示图标 + 短文字（图标优先，文字在空间充裕时显示）

#### Tab 切换行为

- 点击 tab：切换到对应视图
- 键盘快捷键：
  - `Ctrl+1`–`Ctrl+6`：直接跳转到对应 tab
  - `Ctrl+Shift+]` / `Ctrl+Shift+[`：切换到下一个/上一个 tab
- 切换视图时保留各视图的独立状态（滚动位置、搜索词、展开状态）
- 默认激活 `tree` view（保持现有用户体验不变）

### 2.2 DOM 结构变更

```html
<!-- popup.html / sidepanel.html 变更概要 -->
<div id="container">
    <!-- 搜索工具栏保持不变 -->
    <div id="search" role="search">
        <!-- search input + clear + star + tool buttons -->
    </div>

    <!-- 新增：Tab 栏 -->
    <nav id="tab-bar" role="tablist" aria-label="Views">
        <!-- JS 动态生成 tab 按钮 -->
    </nav>

    <!-- 替代原来的 #tree + #results 二选一结构 -->
    <div id="view-container">
        <!-- 每个视图的内容面板，仅活跃视图可见 -->
        <div id="view-tree" role="tabpanel" class="view-panel">...</div>
        <div id="view-search" role="tabpanel" class="view-panel" hidden>...</div>
        <div id="view-recent" role="tabpanel" class="view-panel" hidden>...</div>
        <div id="view-stats" role="tabpanel" class="view-panel" hidden>...</div>
        <div id="view-dead" role="tabpanel" class="view-panel" hidden>...</div>
        <div id="view-dupes" role="tabpanel" class="view-panel" hidden>...</div>
    </div>
</div>

<!-- 其余保持：drop-overlay, bookmark-clone, context menus, resizers, cover,
     command-palette, dialogs, undo-toast -->
```

**关键变更**：
- `#tree` 和 `#results` 不再是顶层容器，改为在对应 view panel 内部
- `#view-container` 替代 `#tree`/`#results` 成为主内容区
- `#command-palette` 保持在 `#view-container` 外部（overlay 层），z-index 100

### 2.3 CSS 布局变更

```css
/* #container 保持 flex column */

#tab-bar {
    flex: none;
    display: flex;
    gap: 0;
    overflow-x: auto;
    border-bottom: 1px solid var(--vbm-border);
    padding: 0 4px;
    /* 窄滚动条 */
    scrollbar-width: thin;
}

.tab-btn {
    flex: none;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 10px;
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--vbm-muted);
    font: menu;
    font-size: 90%;
    cursor: pointer;
    white-space: nowrap;
    transition: background-color .12s ease-out, color .12s ease-out,
                border-color .12s ease-out;
}

.tab-btn:hover {
    background: var(--vbm-bg-hover);
    color: var(--vbm-fg);
}

.tab-btn.active {
    color: var(--vbm-accent);
    border-bottom-color: var(--vbm-accent);
    font-weight: 600;
}

.tab-btn .tab-icon {
    width: 14px;
    height: 14px;
    flex: none;
}

/* Side panel: 更大空间时显示文字 */
body.panel-mode .tab-btn .tab-label {
    display: inline;
}
/* Popup: 窄空间时文字可选隐藏，仅图标 */
@media (max-width: 360px) {
    .tab-btn .tab-label {
        display: none;
    }
}

#view-container {
    flex: 1;
    overflow: hidden;  /* 各 view panel 内部自行处理溢出 */
    position: relative;
}

.view-panel {
    position: absolute;
    inset: 0;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
}

.view-panel[hidden] {
    display: none;
}
```

---

## 3. 六个视图详细设计

### 3.1 Tree View（树视图）— 默认

**职责**：当前主树视图的精确复刻，文件夹层级浏览。

**内容**：
- 原 `#tree` 的内容（包含 bookmark 树 + 原 `#recent-section` 移除后的纯树）
- "最近添加"区域**不再**出现在此视图中（移到独立的 Recent View）

**工具栏搜索框行为**：
- 行为和现在完全一致：输入 → 模糊搜索 → 结果显示在 `#results` 面板
- `#results` 面板在 Tree View 内部渲染（覆盖或切换树内容）
- 快捷键：`Ctrl+F` 聚焦搜索框（不变）

**键盘快捷键**：
- 所有现有树导航快捷键不变（`↑↓←→`、`Enter`、`Delete`、`F2`、type-ahead）
- `Ctrl+1`：切换到 Tree View（无论当前在哪个 view）

**迁移要点**：
- 将原 `#tree` 元素移入 `#view-tree` panel 内部
- 移除 `tree-view.js` 中的 `#recent-section` 相关代码（移到 Recent View）
- 搜索过滤逻辑保持 `search.js` 不变

---

### 3.2 Search View（搜索视图）— **核心设计决策**

**这是本次设计中最关键的视图**，需要明确它与工具栏搜索框和命令面板的关系。

#### 设计原则：三件套分工明确

```
┌─────────────────────────────────────────────────────────┐
│  输入方式          │  触发          │  做什么            │
├─────────────────────────────────────────────────────────┤
│  工具栏搜索框       │  始终可见       │  快速过滤当前视图   │
│  (#search-input)   │  Ctrl+F 聚焦   │  内容（实时）       │
├─────────────────────────────────────────────────────────┤
│  搜索视图搜索框     │  切换到 Search  │  全功能书签搜索     │
│  (view-search 内)  │  View tab 可见  │  (范围/排序/更多)   │
├─────────────────────────────────────────────────────────┤
│  命令面板          │  Ctrl+K 呼出    │  命令执行 + 快速    │
│  (#palette-input)  │  全局 overlay  │  跳转书签/文件夹    │
└─────────────────────────────────────────────────────────┘
```

**关键决策：搜索视图拥有自己独立的搜索输入框，不和工具栏搜索框合并。**

理由：
1. **角色不同**：工具栏搜索是"快速过滤"（always-on, lightweight），搜索视图是"深度搜索"（dedicated, full-featured）
2. **范围不同**：工具栏搜索过滤当前视图的可见内容；搜索视图搜索全部书签
3. **结果呈现不同**：工具栏搜索结果在紧凑的 `#results` 面板中；搜索视图有完整的内容区域，可以展示更多信息（路径、标签、缩略图）
4. **借鉴最佳实践**：VS Code 的 Search 面板和 Quick Open 是两个独立功能；Figma 的搜索和命令面板各司其职

#### 搜索视图内容设计

```
┌──────────────────────────────────────────────┐
│  #view-search                                │
│  ┌──────────────────────────────────────────┐│
│  │ 🔍 [搜索全部书签...              ] [⏻]  ││ ← 独立搜索输入框
│  ├──────────────────────────────────────────┤│
│  │ 范围: [全部 ▼]  排序: [相关度 ▼]  [⚙]  ││ ← 搜索选项栏
│  ├──────────────────────────────────────────┤│
│  │                                          ││
│  │ 搜索结果列表 (虚拟滚动或上限 200 条)       ││
│  │ ┌──────────────────────────────────────┐ ││
│  │ │ 🔗 书签标题            /路径/文件夹   │ ││
│  │ │    url.com · 5天前添加              │ ││
│  │ ├──────────────────────────────────────┤ ││
│  │ │ 📁 文件夹名称          包含 N 项      │ ││
│  │ │    /父文件夹路径                     │ ││
│  │ ├──────────────────────────────────────┤ ││
│  │ │ ...                                  │ ││
│  │ └──────────────────────────────────────┘ ││
│  │                                          ││
│  └──────────────────────────────────────────┘│
└──────────────────────────────────────────────┘
```

**搜索输入框**（在 Search View 内容区）：
- 占位符：`"搜索全部书签..."`
- 输入即搜（实时模糊匹配，debounce 150ms）
- 支持搜索选项：
  - 范围：全部书签 / 当前文件夹 / 书签栏
  - 排序：相关度（默认）/ 按日期 / 按标题
  - （未来可扩展：按域名筛选、按标签筛选）
- 清除按钮（×）
- 结果数量指示器

**搜索结果列表**：
- 每条结果显示：
  - favicon + 标题（高亮匹配字符）
  - URL（截断）
  - 父文件夹路径（面包屑）
  - 添加日期（相对时间："3天前"）
- 点击行为（与现有搜索结果一致）：
  - 左键：打开书签 / 跳转到文件夹
  - Ctrl/Cmd+点击：新标签页打开
  - 右键：完整上下文菜单
  - Delete：删除
- 无结果时显示空态："未找到匹配的书签"
- 结果数量截断：200 条（vs 当前 100 条，search view 有更多空间）

**与工具栏搜索框的交互**：
- 用户在 Tree View 时 → 工具栏搜索框做快速过滤（现有行为）
- 用户切换到 Search View → 输入焦点自动移到搜索视图的搜索输入框
- 工具栏搜索框在 Search View 中**仍然可见但行为改变**：
  - 如果用户在工具栏搜索框输入，它会触发搜索视图的搜索（相当于代理）
  - **或者更简单**：在 Search View 中，工具栏搜索框输入自动同步到搜索视图的输入框
  - **最终方案**：在 Search View 中，工具栏搜索框的 `placeholder` 变为 `"在搜索视图中搜索..."`，输入事件直接委托给搜索视图的搜索输入框（两个输入框值双向同步，用户体验上是同一个搜索）

**搜索视图的工具栏搜索框方案（最终决策）**：

采用"**委派同步**"模式：在 Search View 激活时，工具栏搜索框的输入事件委派给搜索视图的主搜索框，两个输入框的值保持双向同步。

- 用户在工具栏搜索框输入 → 值同步写入搜索视图搜索框 → 触发搜索
- 用户在搜索视图搜索框输入 → 值同步写入工具栏搜索框
- 好处：用户无论从哪个输入框开始搜索，体验一致；不需要记住"在哪个 view 用哪个框"
- 实现：Search View 激活时，`search.js` 的 input listener 检查当前 view，若为 `search` 则转发

```
用户在 Search View 中:
  工具栏搜索框 ←→ 搜索视图搜索框 (双向同步)
                     ↓
                  执行搜索
                     ↓
              渲染结果到搜索视图
```

---

### 3.3 Recent View（最近添加视图）

**职责**：原 `#recent-section` 的独立升级版，展示最近添加的书签。

**变更**：
- 从 `tree-view.js` 中提取 `#recent-section` 相关代码
- 迁移到独立的 `src/recent-view.js` 模块
- 不再折叠在树视图顶部，而是拥有完整的内容区域

**内容**：
```
┌──────────────────────────────────────────────┐
│  #view-recent                                │
│  ┌──────────────────────────────────────────┐│
│  │ 最近添加 (20)          [按日期 ▼] [展开]  ││ ← 标题栏
│  ├──────────────────────────────────────────┤│
│  │ 🔗 书签标题 1           5分钟前          ││
│  │    url.com · /父文件夹                   ││
│  │ 🔗 书签标题 2           1小时前          ││
│  │    ...                                   ││
│  │ 🔗 书签标题 20          3天前            ││
│  └──────────────────────────────────────────┘│
└──────────────────────────────────────────────┘
```

**功能增强**：
- 展示数量可配置（默认 20，options 中可改为 30/50/100）
- 支持排序：按添加时间倒序（默认）/ 正序 / 按标题
- 支持按文件夹分组："在 '工作' 中添加了 3 项" / "在 '阅读' 中添加了 5 项"
- 滚动加载更多（"显示更多" 按钮，每次 +20）
- 每条支持右键菜单和 Delete 删除
- 支持"清空最近记录"（仅从视图中移除，不删除书签 — — 通过设置时间窗口实现）

**工具栏搜索框行为**：
- 在 Recent View 中，工具栏搜索框过滤最近添加的条目
- Placeholder 变为 `"过滤最近添加..."`

**迁移路径**：
- 移除 `tree-view.js:120-196` 的 `#recent-section` 代码
- 移除 `neat.css:1034-1082` 的 `#recent-section` 样式
- `showRecentBookmarks` 设置改为控制 Recent Tab 的可见性
- `recentBookmarksCollapsed` 设置退役（不再需要折叠，因为有了独立 tab）
- `chrome.bookmarks.onCreated/onRemoved` 监听器从 `tree-view.js` 移到新的 `recent-view.js`

---

### 3.4 Stats View（访问统计视图）

**职责**：展示书签的使用统计，帮助用户了解哪些书签最常用/最不常用。

**注意**：Chrome 书签 API **不提供**访问频率数据。vBookmarks 需要通过 `chrome.tabs.onUpdated` / `chrome.tabs.onCreated` 监听来自己收集统计。这是一个需要后台 service worker 持续运行的功能。

**内容**：
```
┌──────────────────────────────────────────────┐
│  #view-stats                                 │
│  ┌──────────────────────────────────────────┐│
│  │ 📊 访问统计                              ││
│  ├──────────────────────────────────────────┤│
│  │ [最常访问] [最少访问] [从未访问] [最近]   ││ ← 子过滤
│  ├──────────────────────────────────────────┤│
│  │ #  书签                      访问次数     ││
│  │ 1  🔗 GitHub              1,245 次       ││
│  │ 2  🔗 Gmail                 892 次       ││
│  │ 3  🔗 ...                               ││
│  └──────────────────────────────────────────┘│
└──────────────────────────────────────────────┘
```

**数据收集方案**：
- Service worker 中监听标签页导航事件
- 当 URL 匹配某个书签时，累加计数
- 数据存储在 `chrome.storage.local`（`visitStats` key）
- 数据结构：`{ [bookmarkId]: { count: N, lastVisit: timestamp } }`

**功能**：
- 二级过滤：最常访问 / 最少访问 / 从未访问 / 最近访问
- 点击打开书签（和正常行为一致）
- 右键菜单完整支持
- "从未访问"列表帮助用户清理无用书签（可一键选择全部从未访问的书签）
- "重置统计"按钮

**工具栏搜索框行为**：
- 在 Stats View 中，工具栏搜索框过滤统计列表中的书签标题

**实施优先级**：
- 此功能依赖后台数据收集，且需要一段时间的用户数据积累才有意义
- 建议作为本任务包的最后一步实施
- 初始可展示占位状态："统计数据收集中，请稍后再来"

---

### 3.5 Dead Links View（死链视图）

**职责**：原 palette `/dead` 命令的独立升级版，死链扫描与管理。

**变更**：
- 从 `palette.js` 中提取 `/dead` 模式的全部代码
- 迁移到独立的 `src/dead-view.js` 模块
- 不再限于命令面板的小弹窗，拥有完整内容区域

**内容**：
```
┌──────────────────────────────────────────────┐
│  #view-dead                                  │
│  ┌──────────────────────────────────────────┐│
│  │ 💀 死链扫描                              ││
│  │ [🔍 开始扫描] [全部删除(N)] [⏹ 停止]    ││ ← 操作栏
│  ├──────────────────────────────────────────┤│
│  │ 状态: 正在扫描... 45/230 (19%)           ││ ← 进度条
│  ├──────────────────────────────────────────┤│
│  │ 💀 书签标题 1                404         ││
│  │    url.com/dead-page                     ││
│  │ 💀 书签标题 2                timeout     ││
│  │    url.com/another-dead                  ││
│  │ ...                                      ││
│  │                                          ││
│  │ ✅ 扫描完成。发现 12 个死链，230 个正常。 ││ ← 完成态
│  └──────────────────────────────────────────┘│
└──────────────────────────────────────────────┘
```

**功能增强**（相对 palette `/dead`）：
- 更宽敞的结果展示（不再受 palette 小窗限制）
- 带进度条的扫描过程可视化
- 扫描结果支持排序（按 HTTP 状态码 / 按标题 / 按响应时间）
- 单个重试（只重新检查某一项）
- 导出死链列表（复制到剪贴板）
- 扫描完成后"一键删除全部死链"
- 保留上次扫描结果（不清除），直到下次扫描覆盖

**工具栏搜索框行为**：
- 在 Dead Links View 中，工具栏搜索框过滤死链列表中的标题/URL

**迁移路径**：
- palette `/dead` 命令保留，但行为改为"切换到 Dead Links View tab"
- 或者：palette `/dead` 命令**消除**，用户直接通过 tab 栏进入 Dead Links View
- **推荐**：保留 `/dead` 作为快捷方式 → 切换到 Dead Links View 并自动开始扫描

---

### 3.6 Dupes View（重复管理视图）

**职责**：原 palette `/dupes` 命令的独立升级版，重复书签检测与清理。

**变更**：
- 从 `palette.js` 中提取 `/dupes` 模式的全部代码
- 迁移到独立的 `src/dupes-view.js` 模块

**内容**：
```
┌──────────────────────────────────────────────┐
│  #view-dupes                                 │
│  ┌──────────────────────────────────────────┐│
│  │ 📋 重复书签              发现 3 组重复    ││
│  │ [🔍 重新扫描] [清理全部(N)]              ││ ← 操作栏
│  ├──────────────────────────────────────────┤│
│  │ ┌─ 重复组 1 ─────────────────────────┐  ││
│  │ │ github.com                          │  ││
│  │ │ 🔗 GitHub (保留)   /书签栏          │  ││
│  │ │ 🔗 GitHub · 较早    /书签栏/工作    │  ││
│  │ │ 🔗 GitHub · 更早    /其他书签       │  ││
│  │ │ [清理此组 (2)]                      │  ││
│  │ └─────────────────────────────────────┘  ││
│  │ ┌─ 重复组 2 ─────────────────────────┐  ││
│  │ │ ...                                 │  ││
│  │ └─────────────────────────────────────┘  ││
│  │                                          ││
│  │ ✅ 没有发现重复书签                       ││ ← 空态
│  └──────────────────────────────────────────┘│
└──────────────────────────────────────────────┘
```

**功能增强**（相对 palette `/dupes`）：
- 分组展示更清晰（每组一个卡片）
- 每个组内展示每个书签的完整路径（父文件夹链）
- "保留"标签标记将被保留的书签（最早添加的那个）
- 支持手动选择保留哪一个（不强制保留最早）
- 逐个清理 + 全部清理
- 保留扫描结果，直到手动刷新

**工具栏搜索框行为**：
- 在 Dupes View 中，工具栏搜索框过滤重复组中的 URL/标题

**迁移路径**：
- palette `/dupes` 命令保留，行为改为"切换到 Dupes View tab"
- 或 `/dupes` 消除，通过 tab 进入
- **推荐**：保留 `/dupes` 快捷方式 → 切换到 Dupes View

---

## 4. 搜索三件套协调方案

**这是本次设计中最需要回答的问题**。下面给出完整协调方案：

### 4.1 三个输入框的定位

```
                   工具栏搜索框              命令面板              搜索视图搜索框
                   (#search-input)        (#palette-input)      (view-search 内)
                   ──────────────         ───────────────       ────────────────
触发方式            始终可见               Ctrl+K 呼出           切换到 Search View
                   Ctrl+F 聚焦            (全局 overlay)         (tab 内可见)

主要用途            快速过滤当前视图        命令 + 快速跳转         全功能书签搜索

搜索范围            当前视图的可见数据       所有书签 + 命令         所有书签
                   (视图感知)

结果呈现            紧凑列表               下拉列表               全区域列表
                   (#results 面板)        (palette-results)      (主内容区)

输入行为            实时过滤                实时匹配               实时搜索
                   (即时)                 (即时)                 (debounce 150ms)

支持的功能          模糊匹配                模糊匹配 + 命令        模糊匹配 +
                   键盘导航                斜杠命令                过滤选项 +
                   Enter 打开              Enter 执行            面包屑路径 +
                                                           更多元数据
```

### 4.2 跨视图的搜索框行为矩阵

| 活跃 View | 工具栏搜索框 placeholder | 工具栏搜索行为 | 搜索视图搜索框 |
|-----------|------------------------|---------------|---------------|
| Tree | `"搜索书签..."` | 模糊搜索全部书签 → `#results` | 不可见 |
| **Search** | `"搜索书签..."` **（同步到搜索视图）** | 输入同步到搜索视图搜索框 | 可见、活跃、双向同步工具栏 |
| Recent | `"过滤最近添加..."` | 过滤 `#recent-list` 条目 | 不可见 |
| Stats | `"过滤统计..."` | 过滤统计列表条目 | 不可见 |
| Dead | `"过滤死链..."` | 过滤死链列表条目 | 不可见 |
| Dupes | `"过滤重复项..."` | 过滤重复组条目 | 不可见 |

### 4.3 Search View 激活时的同步协议

```
用户在工具栏搜索框输入:
  search-input.addEventListener('input', ...)
    → if (当前 view === 'search')
        → 同步写入 view-search-input.value
        → 触发搜索视图的搜索逻辑

用户在搜索视图搜索框输入:
  view-search-input.addEventListener('input', ...)
    → 执行全功能搜索
    → 同步写入 search-input.value
    → 搜索结果渲染到 #view-search

切换离开 Search View:
  → 搜索视图状态保留（搜索词、结果列表）
  → 工具栏搜索框恢复独立行为
```

### 4.4 入口与快捷键一览

| 操作 | 快捷键 | 说明 |
|------|--------|------|
| 聚焦工具栏搜索框 | `Ctrl+F` / `Cmd+F` | 现有行为不变 |
| 打开命令面板 | `Ctrl+K` / `Cmd+K` | popup 内；全局 `Ctrl+Shift+K` |
| 切换到搜索视图 | `Ctrl+2` | 自动聚焦搜索视图的搜索框 |
| 切换到树视图 | `Ctrl+1` | 聚焦回树 |
| 退出搜索/过滤 | `Esc` | 现有行为不变 |
| 切换 tab | `Ctrl+1~6` | 直接跳转到对应 tab |
| 上一个/下一个 tab | `Ctrl+Shift+[` / `Ctrl+Shift+]` | 循环切换 |

---

## 5. 设置迁移方案

### 5.1 现有设置变更

| 现有 key | 当前用途 | v4task-2 行为 |
|----------|---------|--------------|
| `showRecentBookmarks` | 控制树顶部 #recent-section 可见 | **迁移**：控制 Recent Tab 是否在 tab 栏显示 |
| `recentBookmarksCollapsed` | #recent-section 折叠状态 | **退役**：独立 Recent View 不再有折叠 |
| `searchAfterEnter` | 回车才触发搜索 | **保留**：适用于 Search View 和工具栏搜索 |
| `closeUnusedFolders` | 手风琴模式 | **保留**：Tree View 专属 |

### 5.2 新增设置

| 新 key | 默认值 | 用途 |
|--------|--------|------|
| `visibleTabs` | `["tree","search","recent","stats","dead","dupes"]` | 控制哪些 tab 显示 |
| `defaultTab` | `"tree"` | 启动时的默认 tab |
| `visitStats` | `{}` | 访问统计数据（service worker 写入） |
| `statsEnabled` | `"true"` | 是否启用访问统计收集 |
| `recentCount` | `"20"` | Recent View 展示数量 |

### 5.3 store.js 迁移逻辑

```javascript
// store.js KNOWN_KEYS 新增
'recentCount', 'visibleTabs', 'defaultTab',
'visitStats', 'statsEnabled'

// 迁移：showRecentBookmarks → visibleTabs 推导
if (store.get('showRecentBookmarks') === '') {  // '' = false
    // 用户之前关闭了最近添加，在 visibleTabs 中移除 'recent'
    const tabs = store.get('visibleTabs', [...]);
    // 需要从默认列表中移除 'recent'
}

// 退役 recentBookmarksCollapsed — 不再读取
```

---

## 6. 模块架构变更

### 6.1 新模块

| 新文件 | 职责 | 来源 |
|--------|------|------|
| `src/tab-bar.js` | Tab 栏渲染、切换、键盘导航 | 全新 |
| `src/search-view.js` | 搜索视图（全功能搜索输入 + 结果列表 + 过滤选项） | 全新（与 `search.js` 协作） |
| `src/recent-view.js` | 最近添加视图 | 从 `tree-view.js` 提取 `#recent-section` 代码 |
| `src/stats-view.js` | 访问统计视图 | 全新 |
| `src/dead-view.js` | 死链视图 | 从 `palette.js` 提取 `/dead` 模式代码 |
| `src/dupes-view.js` | 重复管理视图 | 从 `palette.js` 提取 `/dupes` 模式代码 |

### 6.2 现有模块变更

| 文件 | 变更 |
|------|------|
| `src/neat.js` | 引入 tab-bar，注入 view 模块，调整初始化顺序 |
| `src/search.js` | 增加"视图感知"行为：在不同 view 中搜索行为不同。导出视图同步接口 |
| `src/tree-view.js` | 移除 `#recent-section` 代码（~80 行）。tree 改为在 `#view-tree` 内渲染 |
| `src/tree-render.js` | 基本不变（纯 HTML 生成） |
| `src/palette.js` | `/dead` 和 `/dupes` 命令改为"切换到对应 tab"而非内联渲染。命令集注册 api 供 tab-bar 消费 |
| `src/keyboard.js` | 新增 `Ctrl+1~6` tab 切换、`Ctrl+Shift+[`/`]` 上一个/下一个 tab |
| `src/background.js` | 新增访问统计的标签页导航监听 |
| `pages/popup.html` | 新增 `#tab-bar` + `#view-container` + 6 个 view panel |
| `pages/sidepanel.html` | 同步 popup.html 的 DOM 变更 |
| `css/neat.css` | 新增 tab-bar、view-container、各 view panel 样式。移除 #recent-section 样式 |

### 6.3 初始化流程

```
store.ready
  ├── separatorManager
  ├── treeRender = initTreeRender(...)
  ├── menus = initContextMenu(...)
  ├── search = initSearch(...)            ← search.js 需要知道"当前 view"
  ├── syncUi = initSyncUi(...)
  ├── dialogs = initDialogs(...)
  ├── undo = initUndo(...)
  ├── actions = initActions(...)
  ├── dnd = initDnd(...)
  │
  ├── [NEW] tabBar = initTabBar(...)      ← 创建 tab 栏 + 视图容器
  │   ├── 注册 6 个视图模块
  │   ├── 设定默认活跃 tab = 'tree'
  │   └── 暴露 switchTab(id) API
  │
  ├── treeView = initTreeView(...)        ← 在 #view-tree 内渲染
  ├── searchView = initSearchView(...)    ← 新模块
  ├── recentView = initRecentView(...)    ← 新模块（从 tree-view 提取）
  ├── statsView = initStatsView(...)      ← 新模块
  ├── deadView = initDeadView(...)        ← 从 palette 提取
  ├── dupesView = initDupesView(...)      ← 从 palette 提取
  │
  ├── palette = initPalette({
  │       ...
  │       switchTab: tabBar.switchTab,    ← palette 命令可以切换 tab
  │       ...
  │   })
  │
  └── initKeyboard({ tabBar, ... })       ← 新增 tab 快捷键
```

---

## 7. 命令面板（Palette）与 Slash Command 增强

### 7.1 要求

> 命令面板里面出现的所有可点击指令，也都需要提供 `/` slash command 支持键盘快速操作

### 7.2 当前命令集

```javascript
// palette.js 当前注册的命令 (commands 数组)
{ slash: 'dupes',    name: '查找重复书签',   fn: enterDupesMode }
{ slash: 'dead',     name: '扫描死链',       fn: enterDeadMode }
{ slash: 'session',  name: '保存当前会话',    fn: saveWindowSession }
// 无 slash 的常规命令
{ name: '快速添加当前页',  fn: quickAdd }
{ name: '新建书签',       fn: newBookmarkFromTab }
{ name: '新建文件夹',      fn: addNewFolder }
{ name: '新建分隔符',      fn: addSeparator }
```

### 7.3 增强后的命令集

所有命令都应有 `/` 前缀别名：

| Slash 命令 | 名称 | 行为 | Tab 关联 |
|-----------|------|------|---------|
| `/tree` | 切换到树视图 | 切换到 Tree View tab | Tree |
| `/search` | 打开搜索视图 | 切换到 Search View tab 并聚焦搜索框 | Search |
| `/recent` | 打开最近添加 | 切换到 Recent View tab | Recent |
| `/stats` | 打开访问统计 | 切换到 Stats View tab | Stats |
| `/dead` | 扫描死链 | 切换到 Dead Links View tab 并开始扫描 | Dead |
| `/dupes` | 查找重复书签 | 切换到 Dupes View tab 并开始扫描 | Dupes |
| `/add` | 快速添加当前页 | 书签当前标签页 | — |
| `/newbookmark` | 新建书签 | 从当前标签页新建 | — |
| `/newfolder` | 新建文件夹 | 在当前根文件夹下新建 | — |
| `/newsep` | 新建分隔符 | 在当前根文件夹下新建分隔符 | — |
| `/session` | 保存会话 | 保存当前窗口所有标签 | — |
| `/sort` | 排序文件夹 | 打开排序对话框 | — |
| `/settings` | 打开设置 | 打开 options 页 | — |
| `/help` | 显示帮助 | 列出所有可用命令 | — |

### 7.4 Palette 命令注册 API

为了保持扩展性，将命令注册改为显式 API：

```javascript
// palette.js 导出
export function initPalette(ctx) {
    const registry = [];

    return {
        // 注册命令
        registerCommand({ slash, name, fn, keepOpen, description }) {
            registry.push({ slash, name, fn, keepOpen, description });
        },
        // 打开/关闭
        open() { ... },
        close() { ... },
        isOpen() { ... },
    };
}
```

各视图模块调用 `palette.registerCommand()` 注册自己的命令。palette 的 render 函数不再硬编码命令列表。

---

## 8. 键盘快捷键完整方案

### 8.1 新增快捷键

| 快捷键 | 作用域 | 行为 |
|--------|--------|------|
| `Ctrl+1` ~ `Ctrl+6` | 全局 (popup/sidepanel) | 切换到对应 tab |
| `Ctrl+Shift+]` | 全局 | 下一个 tab |
| `Ctrl+Shift+[` | 全局 | 上一个 tab |
| `Ctrl+K` | 全局 | 打开命令面板（不变） |
| `Ctrl+F` | 全局 | 聚焦工具栏搜索框（不变） |
| `Ctrl+D` | 全局 | 快速添加当前页（不变） |

### 8.2 Esc 层级（不变）

```
Escape 键捕获顺序 (keyboard.js:455-486):
  1. 对话框打开 → 关闭对话框
  2. 右键菜单打开 → 关闭菜单
  3. 命令面板打开 → 关闭面板
  4. 搜索激活中 → 退出搜索模式
  5. 以上均无 → 关闭弹窗/侧栏
```

### 8.3 keyboard.js 改造点

```javascript
// 新增 handler
document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey) {
        // Ctrl+1~6: 切换 tab
        const num = parseInt(e.key);
        if (num >= 1 && num <= 6) {
            e.preventDefault();
            tabBar.switchTabByIndex(num - 1);
            return;
        }
        // Ctrl+Shift+]: 下一个 tab
        if (e.shiftKey && e.key === ']') {
            e.preventDefault();
            tabBar.nextTab();
            return;
        }
        // Ctrl+Shift+[: 上一个 tab
        if (e.shiftKey && e.key === '[') {
            e.preventDefault();
            tabBar.prevTab();
            return;
        }
    }
});
```

---

## 9. CSS 设计（设计 token 延续）

### 9.1 Tab 栏颜色

全部使用现有设计 token，不引入新硬编码颜色：

```css
.tab-btn {
    color: var(--vbm-muted);           /* 非活跃 tab 文字 */
    border-bottom-color: transparent;  /* 非活跃 tab 指示器 */
}
.tab-btn:hover {
    background: var(--vbm-bg-hover);   /* hover */
    color: var(--vbm-fg);
}
.tab-btn.active {
    color: var(--vbm-accent);          /* 活跃 tab 文字 */
    border-bottom-color: var(--vbm-accent); /* 活跃 tab 指示器 */
}
```

### 9.2 视图面板

```css
.view-panel {
    background-color: var(--vbm-bg);   /* 继承主题背景 */
    color: var(--vbm-fg);             /* 继承主题文字 */
}
```

### 9.3 移除的样式

- `#recent-section` 全部样式（`neat.css:1034-1082`）
- `#tree .open>ul` 的 `height: auto` 保持不变（Tree View 仍需要）

---

## 10. 实施阶段

### 阶段 1：基础设施（Tab 栏 + 视图容器）

1. 创建 `src/tab-bar.js`：tab 栏渲染、切换、键盘导航
2. 修改 `pages/popup.html` 和 `pages/sidepanel.html`：新增 `#tab-bar` + `#view-container`
3. 修改 `css/neat.css`：tab 栏和视图容器样式
4. 修改 `src/neat.js`：集成 tab-bar 初始化
5. 修改 `src/keyboard.js`：新增 tab 切换快捷键
6. **测试**：tab 栏渲染、切换、快捷键正确

### 阶段 2：Tree View + Search View 迁移

1. 将现有 `#tree` 融入 `#view-tree`
2. 移除 `tree-view.js` 中 `#recent-section` 代码
3. 创建 `src/search-view.js`：全功能搜索视图
4. 修改 `src/search.js`：视图感知 + 搜索视图同步协议
5. **测试**：Tree View 功能无损；Search View 搜索正确；同步协议工作

### 阶段 3：Recent View 迁移

1. 创建 `src/recent-view.js`：从 `tree-view.js` 提取
2. 处理 `showRecentBookmarks` / `recentBookmarksCollapsed` 设置迁移
3. **测试**：Recent View 展示正确、排序/过滤功能正常

### 阶段 4：Dead + Dupes View 迁移

1. 创建 `src/dead-view.js`：从 `palette.js` 提取
2. 创建 `src/dupes-view.js`：从 `palette.js` 提取
3. 修改 `src/palette.js`：`/dead` `/dupes` 改为切换到对应 tab
4. 增强 palette 命令注册 API
5. **测试**：死链扫描、重复检测功能不变；tab 切换正确

### 阶段 5：Stats View + 收尾

1. 创建 `src/stats-view.js`：访问统计视图
2. 修改 `src/background.js`：添加访问统计监听
3. 补齐所有 slash commands
4. 完整 i18n（en + zh_CN 实译，其余 41 locale 占位）
5. 更新 `scripts/package.py` 新增的 JS_FILES
6. **测试**：完整回归，653 例现有测试保持绿 + 新测试

---

## 11. 风险与注意事项

### 11.1 代码量风险

- `palette.js` (705 行) 会减少（提取 dead/dupes 代码），但 `dead-view.js` 和 `dupes-view.js` 是净增加
- `tree-view.js` (430 行) 减少 ~80 行
- 新增 6 个 view 模块 + 1 个 tab-bar 模块，总代码量预计增加 ~800-1200 行
- 需严格控制每个模块的职责边界，避免模块间循环依赖

### 11.2 popup.html 与 sidepanel.html 同步

- 遵循现有约定：改 `pages/popup.html` 后必须同步复刻到 `pages/sidepanel.html`
- sidepanel.html 的差异仅为 `<body class="panel-mode">`

### 11.3 性能

- 6 个 view panel 的 DOM 全部存在于文档中（但仅活跃视图可见）
- 非活跃视图应延迟加载/初始化（懒初始化模式）
- 搜索视图的 debounce 150ms 避免频繁渲染

### 11.4 向后兼容

- Tree View 是默认 tab，行为与现有体验一致
- 现有设置被迁移而非删除
- 用户升级后首次打开看到的是 Tree View（默认 tab），与升级前一致

---

## 12. 待定决策（需评审确认）

- [ ] **Tab 栏位置**：在搜索工具栏下方（推荐）还是搜索工具栏上方？
- [ ] **Tab 栏在 Popup 的窄空间表现**：320px 宽时是否只显示图标（隐藏文字）？
- [ ] **Search View 中双搜索框同步方案**：确认"委派同步"方案还是其他方案？
- [ ] **Stats View 的范围**：是否需要 service worker 后台统计，还是仅做占位 UI？
- [ ] **`/dead` `/dupes` 命令行为**：保留为切换到 tab 的快捷方式（推荐），还是完全消除？
- [ ] **`recentBookmarksCollapsed` 退役后的替代**：是否需要为 Recent View 提供任何"收起"机制？

---

## 13. 参考资料

- [VS Code Search UX](https://code.visualstudio.com/docs/editor/codebasics#_search-across-files) — 搜索面板与命令面板各司其职的设计范式
- [Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel) — side panel 持久化特性
- [Chrome Tab Groups API](https://developer.chrome.com/docs/extensions/reference/api/tabGroups) — 已有的全部打开为标签组功能
- 项目内文档：
  - `docs/v4task-1.md` — 已完成任务与约定
  - `docs/现代化演进总方案.md` — 总方案 §4 路线图
  - `docs/现状分析-弹窗UI.md` — 现有 UI 架构分析
