# v4 任务包 2 附属设计：视图列表项呈现与键盘交互规范（List UX Spec）

> **状态：设计待评审 v1**（2026-07-21）。本文是 `docs/plan-4.0.0/v4task-2.md`（以下简称"主文档"）的附属规格，单独成文因为它横向约束全部六个视图的行呈现与键盘行为；主文档引用本文，实施时两份一起读。
> 基准事实：tree 视图的呈现与操作已是良好状态，本文以它为**继承基准**——新视图默认继承 tree 的行观感与键盘语义，只定义差异。
> 现状证据：行样式 `css/neat.css:417-440`（`#tree ul li`，line-height 1.67em，padding 0 4px）、选中态 `:578-579`（`.focus`）、token 表 `:17-35`；键盘 `src/keyboard.js`（treeKeyDown:51-328，→ 展开/开右键菜单，F2:271，Delete:279，type-ahead 281-326，菜单导航 contextKeyDown:358-443）。

## 0. 设计原则

1. **继承优先**：tree 的间距、对齐、overlay、hover/focus 样式是基准；新视图不发明第二种行语言，只在统一行解剖学上做"槽位填充"。
2. **全键盘可达**：六个视图 + tab 条 + palette 的所有操作都可纯键盘完成；鼠标能做的（hover 行按钮、右键菜单），键盘都有等价键位。
3. **信息不重复**：每行的每个像素只表达一件事（如 dupes 组内不重复 URL）；视图特有信息用右区 meta 槽位承载，不侵入标题列。
4. **token 唯一**：所有颜色/间距走 `var(--vbm-*)`，五主题零特判；新增间距 token 而非硬编码像素。
5. **安静感**：行内操作按钮默认隐匿（hover/focus 显现），状态徽标小而准，动效 150ms 单节奏。

## 1. 行解剖学（通用规范 `.vbm-row`）

### 1.1 结构

```text
┌──────────────────────────────────────────────────────────┐
│ [indent] [chevron?] [icon 16px] [title …flex…] [meta 右区] │
│                    ↑ overlay 锚点（sync 右下 / dead × 右上）  │
└──────────────────────────────────────────────────────────┘
窄态（popup 默认）meta 右区 = [badge?] [path 标签] [行按钮 ≤2]
宽态/panel（≥480px 容器查询）= 第一行 [badge?] [行按钮]，第二行整行 [path / 时间等 muted 行]
```

- **indent**：tree 按层级 12px/level（现状 14px 归入 token 时视觉微调需截图对照）；dupes 成员行固定 1 级缩进；其余视图 0。
- **chevron**：仅 tree 文件夹与 dupes 组头有；占 icon 左侧 16px 列，无 chevron 的行保留同宽空白——**图标列全视图严格左对齐**（秩序感的核心：所有行的 favicon 在同一垂直线上）。
- **icon**：16×16 favicon（`/_favicon/`）或 `src/icons.js` 内联 SVG；overlay 以 icon 为锚点绝对定位。
- **title**：flex-1，ellipsis；搜索命中 `<mark>` 高亮（现状 token 化规则沿用）。
- **meta 右区**：`flex-shrink: 0`，与标题列间距 8px；内部元素间距 6px；极窄时自身也 ellipsis（标题列永远优先收缩）。

### 1.2 尺寸与间距 token（新增到 `css/neat.css` :root）

| token | 值 | 用途 |
|---|---|---|
| `--vbm-row-h` | 28px | 列表行高（tree 现状 1.67em 视觉归入此变量，截图对照确认无回归） |
| `--vbm-row-pad-x` | 4px | 行左右内边距（沿用现状） |
| `--vbm-icon-col` | 20px | 图标列宽（16px icon + 4px 间距） |
| `--vbm-indent` | 12px | tree 层级缩进（总方案 §2.3 由 14px 收敛） |
| `--vbm-meta-gap` | 8px | 标题列与右区间距 |
| 字体 | 系统栈 13px / 行高 1.45 | 标题；muted 文本（路径/时间/第二行）12px |

### 1.3 状态样式（全列表视图统一）

| 状态 | 规则 | token |
|---|---|---|
| 默认 | 透明底 | — |
| hover（鼠标） | 背景 `--vbm-bg-hover`；行按钮显现 | 现状规则 `:438-440` 推广 |
| 键盘焦点（`.focus`） | 背景 `--vbm-bg-selected` + 前景 `--vbm-fg-selected`（沿用 tree 现状选中态，`:578-579`）；**不额外画 outline**——选中背景即焦点指示，与 tree 现状一致 | 现状 token |
| focus-visible（行按钮/tab 等控件） | 可见 ring | `--vbm-focus-ring` |
| hover 与键盘焦点同现 | 键盘焦点优先（selected 覆盖 hover） | — |
| 按下/打开中 | 无独立态（点击即打开，popup 即关；panel 中复用 `--vbm-flash` 一闪） | `--vbm-flash` |
| 将删预览（dupes/dead） | danger 色 + strikethrough（标题与 URL），不降低透明度（保持可读） | `--vbm-danger` |
| keeper 选中（dupes） | 行左 radio 位 ✓，accent 色；行背景不变 | `--vbm-accent` |
| 禁用/置灰（如 keep-most-visited 无数据） | muted + `pointer-events:none` + tooltip 说明原因 | `--vbm-muted` |

键盘焦点 vs 鼠标 hover 的区分原则：**键盘驱动选中背景，鼠标只给 hover 底色**——这是 tree 现状的成熟语义（`.focus` class 由 keyboard.js 管理），全视图继承；鼠标点击行 = 先把 `.focus` 移过去再执行（现状行为）。

### 1.4 overlay 规则（图标徽标叠加）

| overlay | 位置 | 尺寸 | 颜色 | 数据源 |
|---|---|---|---|---|
| sync 状态点 | icon 右下 | 6px 圆 | sync token 体系（现状 `css/sync-styles.css`） | syncManager |
| dead 死链 × | icon 右上 | 8px，1.5px 描边 | `--vbm-danger` | `deadMarks` |

- 两个 overlay 可同时存在，位置错开不重叠；overlay 不遮挡 icon 主体超过 1/4。
- 渲染处：`tree-render.js` 行模板统一输出 overlay 容器，tree/search/recent/stats/dead/dupes **所有列表行共享**——在 dead 视图标记一条，回到 tree 立即可见。
- `deadMarks` 查找用 Set；大树渲染开销与 sync indicator 同级。

### 1.5 行内操作按钮（icon button，≤2 个/行）

- 显现规则：默认 `visibility:hidden`；行 hover、行 `.focus`（键盘焦点）、或按钮自身 focus-visible 时显现——**鼠标与键盘路径完全对等**。
- 尺寸 20×20 可点区，16px 图标，muted 色，hover 时 fg 色；不使用 title 以外的提示（键盘用户用 aria-label）。
- **键盘不以 Tab 进入行按钮**（列表内 Tab 会打断 ↑↓ 导航流）；每个行按钮必须有等价键位（§2.3）。Tab 键在 popup 内的职责是区域间移动（§2.1），不在行内停留。
- 每行最多 2 个行按钮；超出进右键菜单（如 dupes 成员行：删除 × 一个按钮 + Space/K 设保留，"在树中定位"进右键菜单）。

### 1.6 文本溢出与 tooltip

- 标题列永远优先 ellipsis；右区 path 标签 max-width 45% 次要 ellipsis（主文档 §3.6）。
- tooltip 统一 `标题 + URL + 路径`（吸收现有 `adaptBookmarkTooltips` 行为）；宽态第二行已显示全路径时 tooltip 省略路径。

## 2. 键盘交互总规范

### 2.1 焦点区域模型与焦点环

popup/panel 内划分四个焦点区域（DOM 顺序即 Tab 顺序）：

```text
┌─ Header：search-input → quick-add-btn → tool-btn ─┐
│  Tab ↓                         ↑ Shift+Tab        │
├─ TabStrip：view-tabs（roving tabindex，整组一个 Tab 位）┤
│  Tab ↓                         ↑ Shift+Tab        │
├─ List：当前视图的列表容器（.focus 行模型，非 DOM focus）───┤
│  （对话框/右键菜单/palette 打开时捕获焦点，Esc 逐层退回）  │
└───────────────────────────────────────────────────┘
```

- **Tab / Shift+Tab**：在 Header → TabStrip → List 三区域间循环；List 区域用 `.focus` 行模型（tree 现状机制：容器 `tabindex="-1"`，焦点行用 class 表达），Tab 进入 List 时落到当前 `.focus` 行。
- **方向键的区域跨越**：List 中 `↑` 到首行再按 `↑` → 焦点上移到 TabStrip（当前 tab）；TabStrip 上 `↑` → Header 搜索框；搜索框 `↓` → List（现状 Ctrl/Cmd+F 之外的第二条通路）。`↓` 同理反向。这让四个区域**纯方向键可达**，Tab 只是冗余捷径。
- **区域焦点记忆**：切换视图时，旧视图 deactivate 保存 `.focus` 行 id（`viewState`），切回时恢复；popup 重开时 tree 恢复 `focusID`（现状机制不变）。

### 2.2 TabStrip 键盘行为（WAI-ARIA tablist 变体）

- **roving tabindex**：整组只有一个 tab 在 Tab 序中（当前 tab `tabindex=0`，其余 `-1`）。
- `←`/`→`：在 tab 间移动（循环；RTL 自动反向——`dir` 感知，ar 截图验证）。
- **激活方式：自动激活（focus 即切换）**。理由：视图渲染成本极低（本地数据、无网络），即时切换符合速度感与浏览器 tab 心智；面板内容重的视图（dead 未扫描）也只是显示缓存/引导行，无异步抖动。
- `Home`/`End`：跳首/末 tab（tree/dupes）。
- `Ctrl/Cmd+1…6`：全局直达（主文档 §3.4），输入框聚焦时不拦截。
- Esc 在 TabStrip 上：无消费，走全局链（→ 非 tree 视图回 tree）。

### 2.3 列表导航与操作键位总表

**通用键（六个视图全部生效，行为与 tree 现状逐键一致）**：

| 键 | 行为 |
|---|---|
| `↑`/`↓` | 移动 `.focus` 行（首行再上 → TabStrip，§2.1） |
| `Home`/`End`/`PgUp`/`PgDn` | 首/末/翻页（现状语义） |
| `Enter` | 打开书签（遵循 click 修饰键设置项）；组头/文件夹 = 展开收起 |
| `Ctrl/Cmd+Enter`、中键 | 新标签/后台打开（现状 click 修饰语义全继承） |
| `→` | 焦点行展开（文件夹/组）或**打开右键菜单**（v3.4 现状语义推广到全部列表行） |
| `←` | 收起；或关闭右键菜单；dupes 成员行 = 跳回所属组头 |
| `F2`（非 Mac） | 重命名/编辑（作用于真实书签，所有列表视图生效） |
| `Delete` | 删除（非空文件夹走主文档 §5.7 确认；dupes/dead 行 = 视图内删除，undo 链路） |
| type-ahead | 仅 tree/search（主文档已定边界） |
| `Esc` | 全局分层链（主文档 §3.4）。**搜索视图两级 Esc**：首次 Esc 清空搜索栏 + 将当前查询记入历史 + 下区保留搜索结果 + 留在搜索视图等待新搜索；再次 Esc 退回到树视图 |

**视图特有键**：

| 键 | 视图 | 行为 |
|---|---|---|
| `M` | dead | 标记/取消标记当前行（= 行内标记按钮的键盘等价） |
| `R` | recent / search / dead / dupes | 在树中定位当前书签（跳 tree 视图 + revealFolder + focus；search 的文件夹行现状跳转统一为此键） |
| `K` | dupes | 把当前成员行设为 keeper（radio 等价） |
| `Space` | dupes 组头 | 展开/收起该组（组内行 Space = 打开，与通用 Enter 一致，不重新定义） |

键位冲突审查：`M`/`R`/`K` 仅在对应视图的消费层注册（view-manager 的 `onKey` 钩子，先于 type-ahead 判定；type-ahead 只在 tree/search 启用，故死链/去重视图输入字母不会触发定位缓冲——这是 type-ahead 边界设计的配套收益）。

### 2.4 右键菜单键盘（现状继承 + 视图动态项）

- `→` 开菜单、`↑`/`↓` 导航、`Enter` 执行、`←`/`Esc` 关闭（`contextKeyDown` 现状，`:358-443` 不变）。
- 菜单内容按视图动态拼装（在 bookmark 菜单基础上注入视图区段，用分隔线区隔）：

| 视图 | 注入项（置于菜单顶部） |
|---|---|
| recent | 在树中定位（`R`） |
| search | 在树中定位（`R`） |
| dead | 标记/取消标记（`M`）、在树中定位 |
| dupes | 设此项为保留（`K`）、在树中定位 |
| stats | 在树中定位 |

- 菜单打开时当前 `.focus` 行即目标行（现状 `currentContext` 机制，context-menu.js）。

## 3. 各视图行规格

### 3.1 tree（基准，不改动）

- 现状即规范：chevron + icon + title；文件夹无 favicon（FOLDER_ICON）；分隔符独立行；sync 右下点；**新增** dead × 右上 overlay。
- 行高归入 `--vbm-row-h` 时截图对照（`shots.js`），视觉零回归为验收线。

### 3.2 search

**上下双区布局**（始终同时可见，互不隐藏）：
- **上区**：`#search-history-area` —— 搜索历史记录（关键字 + 时间 + 结果数目），点击回填并搜索；无历史时显示 `searchViewHint` 引导行
- **下区**：`#search-results-area` —— 最近一次搜索结果的书签列表，保留到下次搜索覆盖

**搜索视图状态流转**：
1. 任意视图输入搜索 → 激活搜索视图，搜索栏维持关键词，上区维持历史记录，下区展示本次搜索结果
2. 首次 Esc → 清空搜索栏，上区追加本次查询记录，下区保留搜索结果，停留在搜索视图
3. 再次 Esc → 退回树视图
4. 重新进入搜索视图 → 搜索栏为空，上区展示历史记录，下区展示最近搜索结果

```text
上区: [clock-icon][查询词A] [3 results] [2h前] [×]
      [clock-icon][查询词B] [12 results] [昨天] [×]
      [清空全部]（右对齐，非焦点控件）
───────────────────────────────────────────
下区: [icon][ti<mark>tl</mark>e ……] [path]
      [folder-icon][文件夹名 ……]   [↩ 跳转到文件夹]
```

- 书签行：标准行 + `<mark>` 高亮；文件夹行：FOLDER_ICON + 右区跳转箭头（accent 色），Enter/`R` 都跳树定位（现状 `a.link-folder` 行为，`search.js:184-191`）。
- 空查询态（历史区块，见下）与无结果空态（`searchNoResults` 现状）之外**新增** `searchViewHint` 引导行（仅无历史时显示）。
- 历史区块行：`[clock-icon][查询词 ……] [× 移除]`；× 是该区块唯一的行按钮（键盘等价：行上 `Delete`）；点击/`Enter` 行 = 回填并搜索。

### 3.3 recent

```text
窄态：[icon][title ……]        [2h前]
宽态：[icon][title ……]        [行按钮]
      └ 12px muted：路径 · 2026-07-21 14:32
```

- **视图特有 meta：相对时间**（`刚刚 / N分钟前 / N小时前 / 昨天 / N天前`，>7 天显示日期）。窄态右区显示相对时间而非 path——recent 的核心问题是"什么时候存的"，路径让位（tooltip 仍含路径）；宽态第二行 `路径 · 绝对时间`。
- 相对时间纯函数（输入 ts 输出档位字符串，vitest 直测；i18n key 带 `$n$` placeholder）。
- 行按钮：**不放**——recent 行保持最干净，定位走 `R`/右键菜单。

### 3.4 stats

```text
[icon][title ……]  [×42 pill] [3d前]
```

- 右区 = 次数 pill（`--vbm-bg-selected` 底 + `--vbm-fg-selected` 字，圆角 `--vbm-radius`，等宽数字 `tabular-nums`）+ 相对时间；按最近排序时两者位置互换（主排序信息永远贴标题列）。
- 顶部工具行：排序 segmented（`按次数 | 按最近`）+ 右侧"清空统计"文字按钮（danger 色，ConfirmDialog 门控）。工具行作为 List 的"第 0 行"纳入 `.focus` 模型；segmented 键盘：`←`/`→` 移动 + `Enter` 选定，roving tabindex。
- 空态：`statsEmpty`（"统计会随着你的使用积累"）+ 若 `statsEnabled` 关闭则显示开关引导文案。

### 3.5 dead

```text
顶部操作行（第 0 行）：[开始扫描] [进度 128/1024 ▓▓▓░░ 12%] [取消]
结果行：[icon][title ……] [×dead | ⇄直连×] [path]
行按钮：[⚑ 标记/取消][× 删除]
```

- **状态徽标**是视图特有 meta：`dead` = 红 ×（`--vbm-danger`）；`blocked` = 琥珀"直连×"（**新增 token `--vbm-warning`**，五主题各配一色）；`skipped` 灰。徽标为文字+符号小 pill，不用仅颜色区分（a11y：形状/文字双重编码）。
- 筛选切换（全部/仅 dead/仅 blocked）做成顶部操作行的三段文字按钮，与排序 segmented 同款组件。
- 进度呈现：操作行内嵌 determinate 进度条（`<progress>` 样式化，token 色），克制的 2px 高；扫描中"开始"变"取消"。
- `M` 标记当前行；被标记行不再加冗余符号——标记的表达全部走 icon 右上 × overlay（§1.4），跨视图一致。
- 空态：`deadStartHint`（"开始扫描 N 个书签"，Enter 直接启动——空态本身是可执行行）；有缓存时第 0 行是"上次扫描 … · 重新扫描"信息行。

### 3.6 dupes（差异最大的视图，重点规格）

```text
▼ [link-icon][归一化 URL（muted, 等宽截断）]  [3] [清除其余]      ← 组头（第 0 级）
  (✓)[icon][标题A ……]            [书签栏/工作] [2024-03-11]       ← keeper 成员行（缩进 1 级）
  ( )[icon][标题B（strike）……]   [书签栏]     [2023-11-02]       ← 将删成员行
  ( )[icon][标题C ……]            [其他书签/资料/前端] [2025-01-20]
▶ [link-icon][collapsed-group …] [5] [清除其余]
```

- **信息不重复原则（维护者点名）**：组头展示一次归一化 URL（muted + 等宽字体 + 中部截断 `example.com/very/lo…/page`），**成员行一律不再显示 URL**；成员行只承载区分度信息：**标题、父路径、添加时间**（重复项之间的唯一差异就是"在哪、何时、叫什么"）。原始 URL 差异（utm/hash/尾斜杠被归一化掉的）进 tooltip。
- **组头**：chevron（Space/Enter/`→` 展开，`←` 收起）+ 归一化 URL + 计数 pill（`[3]`，同 stats pill 样式）+ "清除其余"按钮（行按钮，按当前 keeper 预览删除其余）；组头也是 `.focus` 模型中的行（↑↓ 会停在组头）。
- **成员行**：最左 16px **keeper 位**（圆形 radio 样式：空心圆 `( )` / 实心 ✓ `(✓)`，accent 色）——占 chevron 列的位置，保证图标列仍全视图对齐；`K` 或点击设为 keeper，每组恰好一个，改动即时重算其余行的将删预览（strikethrough + danger，§1.3）。
- **成员行右区 = 父路径 + dateAdded**（路径标签在此视图价值最大：同 URL 不同位置，路径是决策依据）。
- **顶部工具行（第 0 行）**：策略选择器（六策略在 320px 放不下 segmented，取样式化 `<select>`——原生键盘行为免费获得，深色已适配）+ 汇总文案 + "全部应用"主按钮（accent）。
- 键盘：`↑↓` 跨组移动（组头与成员统一序列）；`←` 成员→组头、组头→收起；`→` 组头展开或开右键菜单（成员行）；`K` 设 keeper；`Delete` 删当前成员；`Enter` 打开预览该书签；`R` 树中定位。
- 空态：`dupesNone`（现状文案沿用）。

### 3.7 各视图右区 meta 槽位速查

| 视图 | 窄态右区 | 宽态第二行 | 视图特有徽标 |
|---|---|---|---|
| tree | —（层级表达一切） | — | sync 点 / dead × |
| search | path | path | — |
| recent | 相对时间 | 路径 · 绝对时间 | — |
| stats | 次数 pill + 相对时间 | 路径 | — |
| dead | 状态徽标 + path | 路径 | dead/blocked pill |
| dupes 组头 | 计数 pill + 清除其余 | — | — |
| dupes 成员 | path + dateAdded | 路径 · 完整时间 | keeper ✓ / 将删 strike |

## 4. 状态页规范（空态/加载/进度，全视图统一句式）

- 统一句式 = **一句人话 + 一个引导动作**（总方案 §2.3）；可执行空态行进入 `.focus` 模型（Enter 触发引导动作），不做不可达的纯装饰文案。

| 视图 | 空态 | 引导动作 |
|---|---|---|
| search | `searchViewHint` / `searchNoResults` | —（输入即行动） |
| recent | 无最近书签 | "按 Ctrl+D 收藏当前页"（文案，不可执行） |
| stats | 暂无统计 / 统计已关闭 | — / 引导开启设置 |
| dead | `deadStartHint`（未扫描）/ 全部健康 | 开始扫描（可执行）/ 重新扫描 |
| dupes | `dupesNone` | — |

- 加载态：视图首次渲染骨架行 3 条（muted 色块，150ms 淡入，无 spinner——安静感）；仅 dead 扫描有真进度（determinate bar）。

## 5. 主题、token 与 RTL

- 新增 token 仅三个：`--vbm-row-h`/`--vbm-indent`（尺寸）与 `--vbm-warning`（琥珀，五主题各配：light `#f9ab00`、dark `#fdd663`、ink/paper 取纸感暖黄——实施时与 tokens 段同位定义）。其余全部复用 §1.3 表现有 token。
- 五主题验收截图：每个视图至少一行含全部徽标/overlay/将删态的"全状态行"，入 `shots-themes.js`。
- RTL：chevron/路径分隔符/右区全部 `dir="auto"` + logical properties（`padding-inline-start` 现状已有先例 `neat.css:229`）；`←`/`→` 键语义随 `rtl` 翻转（keyboard.js 现状已有 RTL 分支，推广到组头/TabStrip）。

## 6. 测试与验收要点

1. **行模板契约测试**：`tree-render.js` 行模板输出包含 overlay 容器与 `data-node-id`；每视图一套断言（DOM stub，不抄实现）。
2. **键盘矩阵测试**：keyboard.js suite 补"视图 × 键位"矩阵——通用键在每视图的行为 + `M`/`R`/`K` 仅在注册视图生效 + TabStrip roving tabindex + 区域跨越（首行 `↑` → TabStrip）。
3. **焦点恢复**：切换视图往返后 `.focus` 行还原（viewState）；popup 重开 tree `focusID` 现状回归不破。
4. **dupes 不重复 URL**：组内成员行 DOM 断言无 URL 元素；URL 仅组头一次。
5. **overlay 双标共存**：sync 点 + dead × 同行渲染位置断言。
6. 手动 checklist 增补：纯键盘走通"打开 popup → Ctrl+3 进 recent → ↓ 选行 → R 定位回 tree → → 开菜单 → Esc → Ctrl+5 进 dead → M 标记 → Esc 回 tree 见 × overlay"全链路。

## 7. i18n 补充 key（并入主文档 §8 流程）

`rowActionReveal`/`rowActionMark`/`rowActionUnmark`/`rowActionDelete`（aria-label 用）、`dupesKeeperSet`/`dupesGroupCount`(`$count$`)/`dupesClearRest`、`statsClearConfirm`(`$count$`)、`timeJustNow`/`timeMinutesAgo`(`$n$`)/`timeHoursAgo`/`timeYesterday`/`timeDaysAgo`(`$n$`)、`viewSwitchAnnounce`(`$name$`，aria-live 通报)。
