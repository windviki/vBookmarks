# 暂存区视图（原最近添加视图/recent view）

## 准备实现的功能

> 原始需求清单（冻结，逐字保留；下方「问题和方案」为其落地设计，迭代不改动本节）。

- 原本的最近添加视图有点太轻，一个视图承载的功能和便捷性太弱。准备升级其为暂存区视图。用户可以在任意视图把待后续操作的书签存到暂存区，不改动任何书签树或者行为，只是出现在暂存列表里。
- 暂存区视图分为上下两个区域。上面是暂存列表，下面是之前的最近添加。最近添加区域的菜单也可以发送指定书签到暂存区。最近添加区域的时间表头、以及每一行加悬浮按钮，向上的箭头，一键发送到暂存区。最近添加区域可整体折叠收起。
- 暂存列表提供选择模式用于批量整理。和死链和去重视图类似。选择后的工具栏支持清空，删除，收藏，取消收藏，移动或者复制到指定文件夹（提供文件夹选择器对话框）。设计理念和视觉参照之前的选择模式。
- 树视图除了菜单增加添加到暂存区之外，还应该支持：复制/移动到...、复制、剪切、粘贴配对操作，可以快速对单条书签进行复制或者移动操作。复制/移动到...对话框可选复制或者移动操作，然后复用上面提到的文件夹选择器。
- 树视图提供文件夹上的复制标题和地址的菜单（之前有，已经删除），提供二级菜单可选json，markdown或者文本清单
- 树视图的在此前/后添加文件夹、添加子文件夹，默认右键菜单折叠（提供选项页选项）。折叠为菜单项：添加文件夹，提供二级菜单：此前，此后，子文件夹
- 搜索视图增加选择模式，可以批量选择打开，或者打开为标签组，删除，取消收藏，发送到暂存区等
- 暂存区成为一个中转整理台之后，加强各视图的功能和信息互通，让整个插件的多个视图成为一个整体

## 问题和方案

> 基线：4.1.0 HEAD（七视图；80 测试套件；en 560 i18n 键；`manifest.json` 4.1.0）。本节只补细节与决策，不改动上方需求条目。文中「暂存区」均指升级后的最近添加视图（view id 仍为 `recent`，见 0.1）。
>
> **迭代记录（4.1.0 复审，相对首版方案的修订）**：
> ① 基线 4.0.8 → 4.1.0，全部触点按现状刷新（§8）。
> ② **文件夹选择器方案改写**：4.1.0 已有 `BookmarkFolderPickDialog` / `CopyMoveDialog`（tab-groups 视图的文件夹挑选与复制/移动问询），首版「新建 FolderPickerDialog + CopyMoveDialog」与之撞名且重复造轮——改为**扩展复用** `BookmarkFolderPickDialog`（§4）。
> ③ **双区域键盘方案改写**：放弃「view-manager 增加 `extraLists` 字段」，改用死链视图已在用的「单滚动容器 + 兄弟 `<ul>` + `crossRowUl`」先例，view-manager 零机制改动（§2.1）。
> ④ 落实需求第 8 条的视图互通：新增 tab-groups 视图「收藏并暂存」入口（§2.5）；补全需求第 6 条搜索视图选择模式的完整细则（§3.6）。
> ⑤ `collapseAddFolderMenu` 明确随两个既有折叠键进 `SYNC_KEYS`（§7.2）；选项落点从已不存在的「外观/菜单」组修正为「Context menus」组。
> ⑥ 数据模型加 schema 版本字段 `v`（§0.3）；补 i18n 键清单（§10）、空态/可达性/动效/性能预算（§11）、与 velvet 视觉版本的先后关系（§12）。

### 0. 总体定位

**0.1 视图升级策略**：保留现有 view id `recent`、`#view-recent` 容器、`showRecentBookmarks`/`disableRecentView` 两个设置键不变，仅把视图标题改为「暂存区」（i18n 键名 `viewRecent` 保留、文案改写，走改文案的 `[TODO:]` 重翻译流程，43 locale 同步），内部拆成「暂存列表（上）+ 最近添加（下）」两个区域。理由：view-manager 的注册、隐藏/禁用、palette Go 命令、`Alt+N`、viewState 记忆全部继续工作，零迁移；下方最近添加的功能仍是原视图的一个子集。palette 的 `/recent` 命令保留并增加 alias `staging`（命令 slash 名 = view id 不变，alias 零机制改动）。

**0.2 暂存区的性质**：暂存区是**书签 id 的本地集合**，只记录「哪些书签待处理」，不复制书签数据、不改变书签树、不影响同步。所有暂存区内部操作（移出、清空、分组、收藏）都只改这个集合；只有「删除」「移动/复制到文件夹」这两个显式动作才触碰书签树。

**0.3 数据与持久化**：新增一个 `chrome.storage.local` 键 `staging`（`store.js` 的 `KNOWN_KEYS` 注册，**不进 `SYNC_KEYS`**——书签 id 设备本地，与 `deadMarks*`/`visitStats` 同一决策），值为一个 JSON 对象：

```json
{
  "v": 1,
  "items": [ { "id": "书签id", "ts": 1234567890123, "group": "groupId或null", "fav": false } ],
  "groups": [ { "id": "g_xxx", "name": "A", "collapsed": false, "createdAt": 1234567890123, "sourceFolderId": "可选", "sourceTabGroup": "可选" } ],
  "recentCollapsed": false,
  "unfavCollapsed": false
}
```

- `v` 为 schema 版本（favicon-enrich 索引的 `v` 字段先例），未来字段演进按 `v` 迁移。
- `items` 是暂存列表的唯一数据源；`ts` 为加入时间；`group = null` 表示未分组；`fav` 是**暂存区内的收藏标记**（布尔，默认 false），与分组正交。
- `groups` 只保存用户手动组、文件夹发送自动组与 tab 组整组暂存自动组。`sourceFolderId` 记文件夹来源；`sourceTabGroup` 记 tab 组标题来源（§2.5）。内置「未收藏」**不是 groups 数组里的真实组**，而是一个渲染桶（见 3.4）：`fav === false && group === null` 的条目自动落入该桶，`unfavCollapsed` 保存它的折叠状态。
- 暂存数据存 local 不存 sync（体量可能大、且是设备本地工作台语义）。
- 读写沿用 store 的 200ms 防抖持久化；写入后 `views.updateBadges()` 更新 tab 徽标（`badge()` 返回暂存条数，0 隐藏，遵循 `showTabBadges` 门控）。
- **census 登记**：`tests/storage-usage.test.js` 的 `EXPECTED` 决策表加 `staging: 'other'`——有界小数据（上限 500 条 × ~40B ≈ 20KB），无独立字节预算，归 catch-all，存储条三段不变。不加表项 census 必挂（该套件扫描真实 `store.knownKeys` 与 `src/` 全部写字面量）。
- **跨文档一致性**：popup 与 sidepanel 可同时打开、各持 store 镜像。暂存视图参照 4.0.8 `deadMarks` 先例挂 `chrome.storage.onChanged` 监听 `staging` 键，外部写入（另一文档、选项页导入）时重渲染，避免双端互相覆盖旧快照。
- **备份**：`staging` 在 local 区，自动随选项页备份导出；跨设备导入后书签 id 失配由 0.4 的修剪自愈，无需特殊处理。

**0.4 容量与去重**：
- 同一书签 id 只允许出现一次。重复发送不产生第二条，toast「已在暂存区」；若重复发送的是文件夹，只补入其中尚未在暂存区的书签，并报告「新增 N 条，M 条已在暂存区」。
- 暂存区硬上限 **500 条**（常量，不做选项）。超过上限时新发送整体拒绝并提示「暂存区已满，请先清理」，不静默截断。
- 每次树重建（`onTreeGenerated`）或 `chrome.bookmarks.onRemoved` 后修剪：id 已不存在的 item 移除；用户组/文件夹组因此变空则自动删除该组（内置「未收藏」桶不是真实组，无需清理）。书签被移动不影响暂存（id 仍有效，路径标签跟随 pathMap 更新）。

**0.5 与书签树事件的同步规则**：除修剪外——`onChanged`（标题/URL 修改）→ 若被改书签在暂存区，随行重渲染新标题/新 favicon；`onMoved` → 不动（id 稳定，路径标签下次渲染自取）；`onCreated` 不影响暂存（但刷新最近添加区，沿用现有防抖）。统一走 300ms 防抖的 `scheduleRefresh()`（view-recent 现有机制），非激活时只置 `dirty` 标志、activate 时重放。

### 1. 文件夹相关（允许发送吗 / 发送过来允许展开吗 / 超大文件夹）

**1.1 文件夹允许发送，但按「扁平化收集」处理**：
- 发送文件夹 = 递归收集该文件夹下全部**书签**（跳过分隔符与子文件夹节点本身），每个书签作为一条独立 item 进入暂存列表。
- 同时自动创建一个**虚拟分组**，组名取文件夹标题，`sourceFolderId` 记该文件夹 id；若已存在同 `sourceFolderId` 的分组，则合并进该组，不重复建组。新加入的条目默认 `group = 该组`、`fav = false`；**已存在的条目不改动其 `group`/`fav`**（避免发送动作覆盖用户已有整理），只补缺。用户手动创建的分组不受影响。
- 空文件夹（没有任何书签，只有子文件夹或为空）不产生任何 item，toast「该文件夹没有可暂存的书签」。
- 这样「发送过来的文件夹是否需要展开」问题自然消解：暂存列表**没有文件夹层级**，收到的是一组带组头的扁平书签；组头可折叠/展开，折叠后就是一条「文件夹名 + N 条」的摘要行。

**1.2 暂存区不保存书签树层级**：暂存区只做「书签的临时工作台」。真正的层级只有书签树一份；需要把暂存内容归位时用「移动/复制到文件夹」的文件夹选择器。这样避免在弹窗里维护第二套可编辑树、避免跨根（本地/同步）移动的复杂校验，也避免「暂存区里再嵌套文件夹」的递归语义爆炸。

**1.3 超大文件夹防护**：
- 发送前先用 `chrome.bookmarks.getSubTree`（或 `getTree` 后定位）计数书签后代数：
  - 书签数 > **100**：弹确认框「将暂存 N 条书签」，确认后执行；
  - `当前暂存条数 + N > 500`：直接拒绝并 toast，提示先移出/清空或改为发送子文件夹；不部分截断。
- 理由：静默截断会让用户误以为整个文件夹已暂存；部分暂存在后续「移动到…」时会造成树被半搬家的危险。

### 2. 视图布局与两区域交互

**2.1 上下区域（4.1.0 复审改写：单滚动容器 + crossRowUl 先例）**：

首版方案设想「两个区域各自独立滚动 + view-manager 增加 `extraLists` 字段」。4.1.0 的现状审计给出更优解：死链视图已在**同一个滚动容器**内放两个 `<ul>`（结果列表 + 已标注残留列表），`keyboard.js` 的 `crossRowUl`（keyboard.js:87-104）负责跨兄弟 `<ul>` 步行，`parkRowFocus`/`unparkRowFocus`/`viewState`/`focusSpot` 全部天然覆盖；搜索视图的双区域自力绑定（自绑 keydown + 手工跨界 + focusSpot 特判）恰恰是这套机制缺失时的昂贵替代品。**故定案：单滚动容器**。

- DOM：`#view-recent` 内改为一个滚动容器 `#staging-list`（`div[tabindex]`，注册为 view def 的 `listEl`），内部三段：
  1. `#staging-items`：暂存条目区——组头 + 成员 `<ul>`（仿 dupes 视图的组结构）+ 无组散行 `<ul>`；空态时渲染引导空态行（§11）。
  2. `#recent-head`：最近添加**区域头**（折叠箭头 + 「最近添加」标题 + 条数 + 「全部暂存」图标按钮，§2.2）；非行元素，不参与行步行。
  3. `#recent-list`：最近添加区——**保留现有 id 与渲染路径**，但从独立滚动容器降为 `#staging-list` 内的普通块级子元素（滚动父是 `#staging-list`）。
- 键盘零新机制：`listEl` = `#staging-list`，`views.lists()` 照旧单条注册；↑/↓ 在暂存区末行继续下行经 `crossRowUl` 进入最近添加区首行，反向同理；行 id 前缀 `staging-item-<id>` / `recent-item-<id>` 天然不撞（同一书签可同时出现在两区），`viewState.focus` 与 `focusSpot` 按行 id 记忆无需特判。
- view def 增量字段：`badge: () => items.length`（暂存条数）、`persistScroll: true`（双区域合一后滚动记忆更有价值）、`typeAhead: false`（维持）。
- 上下文菜单体系：`context-menu.js` 的 `LIST_SEL`（context-menu.js:110-111）把 `#recent-list` 替换为 `#staging-list`（ownerInfo 捕获/滚动 dismiss 覆盖整个双区域）；行特征路由按 `staging-item-` 前缀与组头类名分发（§2.4/§3.5）。
- 最近添加区域头整区可折叠；折叠状态存 `staging.recentCollapsed`（跨会话保留）。折叠时只保留区域头，`getRecent` 刷新跳过（复用现有 inactive skip 思路）。现有时间分组表头（今天/本周/本月/更早）逻辑保持不变。
- 废弃说明：不再给 view-manager 加 `extraLists`；若未来某视图需要**各自独立滚动**的双区（本设计明确不要），再评估该字段。

**2.2 最近添加区域的上箭头与区头动作**：
- 每行加 hover 显示按钮 `.staging-add-btn`（向上箭头 SVG，16px 网格 1.5px 描边，入 `src/icons.js` 常量），点击即把该书签加入暂存列表。
- 已加入时按钮变为实心/打勾态（`.staged`，`aria-pressed="true"`），再次点击 = 移出暂存（与快速收藏星标的 toggle 心智一致）；变化后有 toast 与 tab 徽标刷新。
- 该按钮用 `.row-btn` 体系（与死链 ⚑/🗑 同款槽位，neat.css:3079-3105 的 hover/focus-within 揭示规则），保证右缘对齐；非 hover 不显示但槽位恒占。
- 区域头右侧加「全部暂存」图标按钮：把当前最近添加区全部条目（≤ `recentCount` 条）批量入暂存，去重汇总 toast（「新增 N 条，M 条已在暂存区」）；条目已在暂存区的自动跳过。量级 ≤ recentCount（默认 20），不设确认框。

**2.3 菜单入口（树/列表视图）**：
- 「添加到暂存区」进入**书签行右键菜单**（`bookmark-context-menu`），树、搜索结果、暂存区以外的各列表视图（最近添加区、统计已收藏行、死链、去重成员行）都可见；无书签 id 的行（搜索历史、统计未收藏历史、去重组头）不显示该项。实现上参照 `dead-mark-toggle`/`dupes-set-keeper` 的视图专属项先例：菜单项常态 `display:none`，按行上下文显隐。
- 文件夹行（树内与搜索结果 link-folder）的**文件夹菜单**也加「添加到暂存区」，走 1.1 的扁平化收集。
- 书签行菜单项在打开时查询暂存状态：已在暂存区时标签显示「已在暂存区」并置灰；未加入时显示「添加到暂存区」。文件夹行菜单项不做逐条比对（文件夹按扁平集合处理），保持可点击，重复发送只补缺并 toast 汇总。
- 暂存区自身的行右键菜单见 2.4；搜索视图选择模式的「发送到暂存区」见 3.6；tab-groups 视图入口见 2.5。

**2.4 暂存行渲染**：
- 复用 `treeRender.generateBookmarkHTML`，`data-virtual="1"`（拒绝拖拽），行 id `staging-item-<id>`，`data-node-id` 供 context-menu 统一取 id。
- 双行布局参照 recent 区现状（宽/panel 第二行 `subText` = `路径 · 相对加入时间`，窄视口右槽 `rightText` = 路径，沿用 `views.pathOf`，可被 `showItemPath` 关闭）。分组内成员行左缘按组缩进一档（视觉上挂在组头下，与 dupes 成员行一致）。
- `fav === true` 的行显示实心收藏星标（`.row-btn` 槽位，恒可见，参照 `.dead-mark-btn.marked` 的常驻可见先例），星标仅表达暂存区内的收藏标记，不改变书签树。
- 死标 ⚑ overlay 与 sync 点：暂存行与 recent 区行一起进 `onRowsRendered` 重铺流程（view-recent 现有回调），死标/阻断琥珀标、本地/不可同步点自动覆盖——暂存区与全插件信息密度一致，不为暂存行单独造覆盖物。
- 行右键：复用 `bookmark-context-menu`，暂存行上下文下追加视图专属项「移出暂存」「收藏/取消收藏」（显示/隐藏规则同 `dead-mark-toggle` 先例）；「移动到/复制到…」复用树菜单同名项（§5.1，非位置语义，树外可用）；「删除书签」「在树中定位」沿用既有项。
- 行打开走 `treeView.bookmarkHandler`（click/auxclick），自动经 `ctx.onOpenBookmark` 钩子计 visitStats——暂存行的打开行为与全部列表视图一致。

**2.5 tab-groups 视图互通（4.1.0 复审新增，落实需求第 8 条）**：

tab 不是书签，暂存区只收书签 id——互通动作定义为「**收藏并暂存**」：

- tab 行右键菜单（`#tab-row-context-menu`）与最近关闭 tab 行菜单（`#tabgroups-closed-tab-context-menu`）各加「收藏并暂存」：先按 `addTabToBookmarks` 的既有语义处理书签侧——`chrome.bookmarks.search({url})` 去重，未收藏则 create 进 `quickAddFolderId`，已收藏则直接用既有书签 id——然后把该书签 id 送入暂存区（未分组，落入「未收藏」桶）。toast 汇总说明（「已收藏并暂存 / 已在暂存区」）。
- 组头菜单（`#tabgroup-context-menu`）加「整组收藏并暂存」：组内 tabs 按 index 排序、`tabsToBookmarks` 协议白名单过滤、逐个收藏进 `quickAddFolderId`（同 URL 去重），全部结果 id 作为一个暂存组进入，组名取标签组标题、`groups[].sourceTabGroup` 记该标题（同标题再发送时合并，与 `sourceFolderId` 合并规则同构）。
- 防护：组内可收藏 tab 数 > **10** 时 ConfirmDialog 报数确认（与 open-all 阈值心智一致）；超暂存上限按 0.4 整体拒绝。0 个可收藏 tab（全部 chrome:// 类协议）toast 说明。
- 反向闭环：暂存条目整理后用「移动/复制到…」归位到树文件夹；tab 组「save-as-bookmark-folder」的既有路径不变。暂存区由此成为 tab 组 → 书签树之间的中转台。

### 3. 暂存列表选择模式（功能定义）

**3.1 模式骨架**：完全复用选择模式既有机制——`selecting` 标志 + `selected` 集合 + 工具条整体切换 + 行点击切换成员 + capture 相 Space 切换聚焦行 + Esc 退出（视图 `onEscape` 消费）+ `parkRowFocus`/`parkToolbarFocus` 焦点保持 + `<ul class="selecting">` / 行 `.sel` 视觉。4.1.0 已有三套同构先例（死链/去重/tabgroups），本视图参照 tabgroups 的完整度：进入选择模式时**展开全部组折叠并快照、退出时恢复**（view-tabgroups.js:1206-1227 先例），保证「全选/反选作用于折叠组」语义可见。`typeAhead: false`。

**3.2 选择单元与作用域**：
- 选择单元是**暂存条目（书签）**；`selected` 存书签 id。
- 组头在非选择模式下点击 = 折叠/展开；在**选择模式下点击组头 = 全选/取消全选该组全部成员**（与去重「组头选择」一致，组头显示全选/半选/未选三态）。折叠的组同样可被组头整体选中。内置「未收藏」桶的组头（`__unfav__`）遵循同一规则。
- 「全选」作用于**全部暂存条目**（含折叠组内成员），不是仅可见行；「反选」同样以全部条目为全集；「清除选择」只清选择集，不动暂存数据。

**3.3 选择工具条按钮语义**（这是本需求最容易歧义的地方，逐一定义）：

工具条为两条图标 `.vbm-toolbar` rung（tabgroups 选择条的双 rung 先例）：第一 rung = 计数 + 选择集操作，第二 rung = 动作。每个图标按钮带 title/aria。

| 按钮 | rung | 作用对象 | 语义 |
|---|---|---|---|
| 计数（`.select-count`） | 1 | — | `selectCount` 带数量参数，复用既有键 |
| 全选 / 反选 / 清除选择 | 1 | 选择集 | 只改选择集 |
| 退出 | 1 | — | 退出选择模式 |
| 打开 | 2 | 已选条目 | 批量打开（`actions.openBookmarks`，10 项确认阈值沿用） |
| 打开为标签组 | 2 | 已选条目 | `actions.openBookmarksInGroup`（SW 管线，popup 关闭不掉单） |
| 移出暂存 | 2 | 已选条目 | 仅从暂存列表移除，书签树不动，toast 可撤销（撤销 = 重新加入，见下注） |
| 收藏 | 2 | 已选条目 | 置 `fav=true`（见 3.4）：无分组条目离开内置「未收藏」桶、成为已收藏未分组行；在文件夹/手动组内的条目留在原组并显示星标。书签树不动 |
| 取消收藏 | 2 | 已选条目 | 置 `fav=false`：无分组条目回到内置「未收藏」桶；在文件夹/手动组内的条目留在原组。书签树不动 |
| 新建分组… | 2 | 已选条目 | 弹出命名对话框（NewFolderDialog 模式复用），把已选条目从原组/未分组移入新虚拟组 |
| 移动/复制到… | 2 | 已选条目 | 打开文件夹选择器（第 4 节）；移动成功后从暂存移除，复制成功后保留 |
| 删除所选 | 2 | 已选条目 | **删除真实书签**（`chrome.bookmarks.remove` 串行、读 lastError、ConfirmDialog 报实际数量、`undo.capture` 每条 + 单步撤销提示），成功后从暂存移除 |
| 清空暂存 | 2 | 全部条目 | 仅清空暂存列表（含分组），书签树不动，ConfirmDialog 确认 |

注：「打开 / 打开为标签组」是对首版按钮清单的扩充，依据是需求第 6 条（搜索视图选择模式含同类动作）与第 8 条（视图互通）——暂存区作为中转台，批量打开是归位之外的另一主出口。「移出暂存」的撤销经 `undo.toastAction` 一次性动作实现（重新写入被移条目及其 `group`/`fav`/`ts` 快照），不走书签 undo 栈（书签树未动）。

**3.4 「收藏」与内置「未收藏」桶的定位**：vBookmarks 当前没有书签「收藏」属性，暂存区又不该改书签树，因此把「收藏」定义为暂存条目上的**布尔标记 `fav`**，与分组正交；不做「收藏组」，改为内置**「未收藏」桶**：

- 渲染规则：`fav === false && group === null` 的条目自动归入内置「未收藏」桶（合成组头 id `__unfav__`，不出现在 `groups` 数组里）。它始终排在最上方、支持折叠、不可重命名/不可删除；**其他视图单条发送来的未收藏书签（没有文件夹归属）默认落在这里**。
- 文件夹发送来的条目默认 `group = 文件夹组`，即使 `fav === false` 也**不进入未收藏桶**，而是待在文件夹组里——这就消解了「收藏组」和文件夹虚拟组的重叠问题（收藏不再是组，条目永远只有一个 `group`）。
- 已收藏（`fav === true`）的条目：若 `group === null`，作为**无组头的散行**渲染在全部组之后（行上显示实心星标）；若 `group` 是文件夹组或手动组，则**留在原组内**并显示星标。
- 「收藏」= 置 `fav=true`（不改 `group`）；「取消收藏」= 置 `fav=false`（不改 `group`）。渲染桶随 `fav`/`group` 自动重算。
- 这样：收藏是属性、分组是归属，二者永不冲突；内置桶只承接「未收藏且未分组」的默认态。

**3.5 虚拟分组细则**：
- 分组是纯本地组织方式：每个条目最多属于一个真实组（`group` 一个 id 或 `null`）；移动到新组即离开旧组（不复制）。`fav` 不是组，不占归属名额。
- 组头显示：折叠箭头 + 组名 + 条数 pill（`aria-expanded` 随折叠态）；右键菜单（**新增第 16 个菜单 `#staging-group-context-menu`**）：展开/折叠、重命名、解散（成员 `group = null`：`fav=false` 落入未收藏桶、`fav=true` 落入已收藏散行；组删除）、全选本组（选择模式外也可用）。键盘绑定照 12 主菜单先例纳入 `keyboard.js` 的绑定清单与 Tab-trap `menuContainers`。
- 渲染顺序固定为：① 内置「未收藏」桶 → ② 用户组/文件夹组/tab 组按 `createdAt` 升序 → ③ 已收藏未分组散行（无组头，行带星标）。
- 折叠状态：真实组存组对象 `collapsed`；内置「未收藏」桶存 `staging.unfavCollapsed`。
- 文件夹发送自动生成的组，若用户手动解散，`sourceFolderId` 随之清除；以后再次发送该文件夹会重新建组。`sourceTabGroup` 组同理。
- 暂存条目在列表内**不支持拖拽重排**（`data-virtual` 拒绝，`items` 数组序即插入序）；手动排序作为未来候选，本期不做（避免引入第二套 dnd 语义）。

**3.6 搜索视图选择模式（落实需求第 6 条，4.1.0 复审补全细则）**：

- **入口与形态**：搜索结果区顶部新增一条细长工具条（`.vbm-toolbar`，仅 searchMode 且有结果时渲染）：左 = 结果计数文本，右 = 选择模式图标按钮（`SELECT_ICON` 已有常量）。工具条随结果区一起 render，焦点保持走 `parkToolbarFocus`。
- **选择单元**：结果列表中**带书签 id 的行**（`#results` 的书签行）；link-folder 行与历史区行**不可选**（文件夹的批量语义见树视图；历史行无书签 id）。选择集合存书签 id。
- **选择动作条**（选择模式时工具条整体切换，单 rung）：计数 + 全选/反选/清 + 打开 / 打开为标签组 / 发送到暂存区 / 删除所选 / 退出。语义与 3.3 同名按钮完全一致（发送到暂存 = 逐条入暂存落入未收藏桶；删除 = 真实删除走 confirm+undo 链）。
- **键盘**：capture 相 Space 切换聚焦行选择；Esc 层级 = 退出选择模式 → 退出搜索模式（view-manager 的 Esc 链：search 的 `onEscape` 先消费选择态）；Delete 在选择模式作用于所选（吞键先例：tabgroups 的 capture 相 keyup）。
- **与搜索输入的共存**：搜索框持有键盘输入焦点是搜索视图的主状态；选择模式的行点击/Space 走列表侧，输入框 `typeAhead` 语义不变（搜索视图 `typeAhead` 保持 true，字母键照旧定位输入框——选择切换只认 Space 与点击，与死链/去重一致）。

### 4. 文件夹选择器（4.1.0 复审改写：扩展复用 BookmarkFolderPickDialog）

**4.1 形态**：4.1.0 已有两个相邻组件——`CopyMoveDialog`（`#copy-move-dialog`，tab-groups 的「复制 vs 移动」两按钮问询，dialogs.js:342-390）与 `BookmarkFolderPickDialog`（`#bookmark-folder-pick-dialog`，仅文件夹的扁平缩进列表 + 自带 ↑/↓/Home/End 行导航，dialogs.js:395-490）。**本功能不再新建任何对话框、也不再引入第二个名为 CopyMoveDialog 的组件**；定案为扩展 `BookmarkFolderPickDialog`：

- 签名扩展为 `BookmarkFolderPickDialog.open({ dialog, mode = null, onPick(folderId, action) })`：
  - `mode = null`（本功能的默认）：底部按钮区为 **[移动到此处] [复制到此处] [取消]** 三按钮，选中文件夹后点动作按钮即 `onPick(folderId, 'move'|'copy')`——**一次对话完成选位置 + 选动作**，比首版「mode 单选 + 树」的两段式少一跳。
  - `mode = 'move'|'copy'`：锁定动作，按钮区只显示对应动作 + 取消（保留给未来独立快捷入口）。
  - **旧调用兼容**：tab-groups 现有两处调用（`onPick(folderId)` 单参、纯选择语义）不受影响——`action` 缺省为 `'pick'`，按钮区维持单「选择」形态（现状）。
- 数据源维持现状：open 时 `chrome.bookmarks.getTree` 全量 walk 收文件夹、扁平缩进按钮列表（4.1.0 已在真实树验证，文件夹量级无需懒加载树）。**打磨项**（随实施评估，不阻塞）：顶部过滤输入（文件夹多时即时过滤）、会话内记忆上次目标文件夹。
- 已知怪癖随扩展一并正规化：现 `close(wasOpen)` 参数语义反置（`close(false)` 才 restoreFocus，dialogs.js:448-454）——扩展时改为显式 `{ restoreFocus = true }` 选项，两处旧调用点同步更新，`tests/dialogs.test.js` 锁死新语义。
- 目标为书签当前父文件夹时：move = no-op + toast；copy = 在同一文件夹产生副本（允许）。
- 完成后 `chrome.bookmarks.getTree(treeView.generateTree)` 刷新树与 pathMap；tab 徽标与暂存列表即时更新。
- 对话框已登记进 `anyOpen()`/`activeEl()`/`closeDialogs()` 三处清单与 `#cover` 点击关闭（4.1.0 已做），modal Tab trap 与 Esc 关闭零新增机制。

**4.2 复用范围**：暂存区「移动/复制到…」、树菜单「复制/移动到…」共用同一个扩展后的 `BookmarkFolderPickDialog`；将来 quick-add 目标文件夹选择、`/add` 参数化创建也可复用。tab-groups 的既有用法不动。

### 5. 树视图：复制/移动、复制、剪切、粘贴

**5.1 「复制/移动到…」**：树内书签行右键菜单加一项「复制/移动到…」，打开扩展后的 `BookmarkFolderPickDialog`（`mode=null`，三按钮形态），对单条书签执行与 4.1 相同的 move/copy。这是**直接完成**的快捷操作，不走内部剪贴板。该菜单项无位置语义，树外列表（含暂存行，见 2.4）同样可用。

**5.2 内部剪贴板（复制/剪切/粘贴配对）**：
- 新增会话级内部剪贴板（模块内状态即可，不进书签树、不进 storage；popup 关闭即清空）：`{ mode: 'copy'|'cut', id, title }`。**作用域注明**：popup 与 sidepanel 是两个文档，剪贴板各自独立、互不可见——可接受（工作台语义本就按窗口），不引入 storage 同步。
- 书签行右键菜单：
  - 「复制」：记录 `{mode:'copy', id}`，toast「已复制：标题」；不改变书签。
  - 「剪切」：记录 `{mode:'cut', id}`，toast「已剪切，去目标文件夹粘贴（Esc 取消）」；树中该行加 `.cut` 淡化态（`opacity` 减半，velvet 状态语言落地时统一收口为 token），直到粘贴/取消/剪贴板被覆盖。
- 文件夹行右键菜单（树内）动态显示「粘贴到此处」：
  - 剪贴板为空：不显示。
  - mode=copy：在目标文件夹末尾 `chrome.bookmarks.create` 复制一份；剪贴板保留（可连续粘贴到多处）。
  - mode=cut：`chrome.bookmarks.move(id, {parentId})` 到目标文件夹末尾，成功后清空剪贴板；目标为原父文件夹时 no-op 并清空剪贴板。
- 粘贴后走 `getTree(generateTree)` 刷新；若剪贴板书签已被删除，toast「书签已不存在」并清空剪贴板。
- 剪贴板仅接受**单条书签**（需求原文就是「单条书签」）；文件夹不提供复制/剪切（文件夹的复制/移动用现有排序/拖拽或「复制/移动到…」的文件夹形态，暂不做文件夹级剪贴板，避免循环移动校验）。
- Esc 的取消语义：文档 Esc 层在剪贴板为 cut 且无更高层（palette/菜单/对话框）打开时，优先清空剪贴板并移除 `.cut` 标记，再走既有 Esc 链。

**5.3 菜单可用性**：复制/剪切/粘贴均只在**树视图内**的 bookmark/folder 菜单出现（并入 `POSITIONAL_IDS` 的树内规则）；「复制/移动到…」例外（无位置语义，树外可用，见 5.1）；树外列表（recent/stats/dead/dupes/search results）只加「添加到暂存区」与「在树中定位」等无位置语义项。

### 6. 文件夹菜单：复制标题和地址（json / markdown / 文本清单）

**6.1 入口与结构**：文件夹右键菜单加一个 `has-submenu` 折叠项「复制标题和地址 ▸」（子菜单 id 形如 `folder-copy-submenu`，条目 `sub-folder-copy-text|markdown|json`），三个子项：
- `文本清单`：每个书签两行——第一行标题、第二行 URL，条目间空一行。
- `Markdown`：每个书签一行 `- [标题](URL)`；标题中的 `[` `]` 转义为 `\[` `\]`，标题内换行折叠为空格。
- `JSON`：扁平数组 `[ { "title": "...", "url": "..." }, ... ]`，2 空格缩进（便于直接贴入 issue/笔记）。

**6.2 范围与顺序**：递归收集该文件夹下全部书签（不含分隔符、不含子文件夹节点），深度优先、树序（与 `chrome.bookmarks.getSubTree` 返回顺序一致）。理由：用户复制一个文件夹的标题地址清单，通常就是要「这个文件夹里所有链接」；直接子级场景反而更少。若未来需要「仅直接子级」，可再加一个子项，本期不做。不去重（去重是去重视图的职责，清单忠实于树）。

**6.3 大文件夹防护**：复制前计数；书签数 > **200** 时弹确认框「将复制 N 条书签的清单」，确认后执行。剪贴板写入复用 `actions.js` 的 clipboard 模式（`navigator.clipboard.writeText` + `#copier-input` 隐藏 textarea 回退）——现该函数是模块私有，随本功能提取为 `src/clipboard.js` 纯模块（writeText + 回退 + 单测），actions.js 与本功能共用，符合「操作即模块」规范。

**6.4 空文件夹**：与现有 open/sort 的 content-disabled 逻辑一致，无书签时该折叠项置灰（`applyContentDisabled` 的 `OPEN_CONTENT_IDS` 思路扩展到 `folder-copy-collapse` 及其 `sub-` 子项，`hideAllMenus` 清态同步覆盖）。

**6.5 与旧实现的差异**：当前 `actions.copyAllTitlesAndUrls`（`TreeText`）只处理单个书签，不是本需求要的文件夹递归清单；新增 `actions.copyFolderTitlesAndUrls(folderId, format)` 独立实现（纯格式化函数提进 `src/clipboard.js` 或 `src/folder-copy.js`，三格式各有单测），不动现有单条书签「复制标题和地址」菜单。

**6.6 子菜单机制触点（4.1.0 精确清单）**：① `pages/popup.html` + `pages/sidepanel.html` 双页加 entry（`class="menu-item has-submenu" data-submenu="folder-copy-submenu"`）与 `<menu class="submenu" id="folder-copy-submenu">`；② neat.js 标签表加 `sub-` 前缀条目；③ context-menu.js：顶部取元素、`hideAllMenus` 三段、`bindSubmenu`/`bindSubmenuHover`、dispatch 的 `sub-` 归一化（context-menu.js:1107/1252 先例）；④ keyboard.js 三处清单——`contextKeyDown` 绑定清单（keyboard.js:917-961）、Tab-trap `menuContainers`（:1174-1185）、文档级两级 Esc（:1063-1066）自动覆盖。

### 7. 文件夹菜单：添加文件夹折叠（默认折叠）

**7.1 结构**：文件夹右键菜单把三个「添加文件夹」动作合并为一个 `has-submenu` 折叠项「添加文件夹 ▸」，二级菜单：
- `此前`（对应现有 `add-folder-before-folder`）
- `此后`（对应现有 `add-folder-after-folder`）
- `子文件夹`（对应现有 `add-new-folder`）

折叠关闭时恢复为现有三个平铺条目（与 `collapseSortMenu`/`collapseTabGroupMenu` 同机制：`applyCollapseState` 切 class、CSS 藏原条目显折叠项）。

**7.2 选项**：新增设置键 `collapseAddFolderMenu`（默认开），**入 `SYNC_KEYS`**——菜单折叠是设备独立偏好，两个既有折叠键已在 sync 路由（store.js:159），本键跟随；选项页 **「Context menus」组**（`optionsGroupContextMenu`，4.0.8 重组后的落点，首版写的「外观/菜单」组已不存在）加复选框，与既有两项并列。

**7.3 置灰继承**：根文件夹下「此前/此后」仍沿用 `ROOT_DISABLED_IDS` 置灰；「子文件夹」保持可用。折叠项本身在全部子项都置灰时才置灰（根文件夹时仍可展开看到「子文件夹」可用，因此折叠项不置灰，只置灰子项）。

**7.4 键盘/二级菜单**：复用现有 `openSubmenuFor/closeSubmenu/toggleSubmenuFor` + `has-submenu`/`data-submenu` 机制；触点清单同 6.6（keyboard.js 三处 + context-menu.js 五处 + 双页 HTML）。

### 8. 落地触点清单（4.1.0 现状精确版）

- `pages/popup.html` / `pages/sidepanel.html`（**双页同步**，`tests/fuzzy.test.js` 脚本清单 parity 断言覆盖）：`#view-recent` 内改单滚动容器 `#staging-list` + `#staging-items` + `#recent-head` 标记；bookmark/folder 菜单新项；`#staging-group-context-menu`（第 16 个菜单）；`folder-copy-submenu` 与 `folder-add-submenu` 两个 `<menu class="submenu">`；tab-groups 两个菜单的新项。
- `src/staging.js`（**新建纯模块**，「操作即模块」规范）：数据模型全部纯逻辑——add/remove/dedupe/500 上限/修剪/分组增删改/收藏标记/未收藏桶推导/渲染桶重算/快照撤销（移出暂存的逆操作数据）。零 chrome.*/DOM 引用，单测直驱。
- `src/view-recent.js`：升级为暂存视图（保留文件名与 `recent` view id）；两区域渲染、组结构、选择模式、区头折叠与「全部暂存」、上箭头按钮、`badge`/`persistScroll` 注册字段、`chrome.storage.onChanged` 监听 `staging` 键。
- `src/actions.js`：新增 `copyFolderTitlesAndUrls`、内部剪贴板操作、move/copy 批量执行（串行 + lastError + 实际数量 toast）；暂存增删经 `src/staging.js`。
- `src/clipboard.js` 或 `src/folder-copy.js`（新建纯模块）：clipboard 写入 + 三格式格式化（§6.3/§6.5）。
- `src/context-menu.js`：`LIST_SEL` 换 `#staging-list`；bookmark/folder/tabgroups 菜单新项与两个新 submenu；暂存行/组头的行特征路由；`applyContentDisabled` 覆盖复制清单项；`applyCollapseState` 覆盖 `collapseAddFolderMenu`；`POSITIONAL_IDS` 并入复制/剪切/粘贴。
- `src/dialogs.js`：`BookmarkFolderPickDialog` 扩展（§4.1）+ `close` 语义正规化（两处旧调用点同步）。
- `src/view-tabgroups.js`：tab 行/closed tab 行「收藏并暂存」、组头「整组收藏并暂存」（§2.5）。
- `src/search.js`：搜索视图选择模式（§3.6）。
- `src/view-manager.js`：**零机制改动**（badge/persistScroll 走既有注册字段）。
- `src/keyboard.js`：第 16 菜单 + 两个新 submenu 的绑定清单（三处）；搜索视图选择态的 Esc/Space/Delete 层。
- `src/store.js`：`KNOWN_KEYS` 加 `staging`、`SYNC_KEYS` 加 `collapseAddFolderMenu`（`recentCount`/`showRecentBookmarks` 沿用）。
- `tests/storage-usage.test.js`：census 决策表加 `staging: 'other'`。
- `_locales/*`：新增 i18n 键（§10 清单），走 `i18n.py` 全流程。
- `AGENTS.md`：view-recent.js 行升级描述、context-menu/dialogs/store 行同步（实施时）。
- `scripts/runtime-files.json`：`src/staging.js`、`src/clipboard.js`（或 `folder-copy.js`）入 JS 清单（dist 构建的单一事实源；import 图可达性会自动收，但清单保持声明式同步）。
- 测试：`tests/` 新增 `staging.test.js`（纯模型全逻辑）、`folder-copy.test.js`（三格式）、`clipboard.test.js`；扩展 `view-recent.test.js`（双区域/选择模式/组头）、`dialogs.test.js`（picker 扩展 + close 正规化）、`context-menu.test.js`（新项/新 submenu/置灰/折叠）、`keyboard.test.js`（新绑定）、`view-tabgroups.test.js`（收藏并暂存）、`search.test.js`（选择模式）；harness `verify-keyboard.js` 补暂存视图行步行与选择模式断言（Docker 门禁）。

### 9. 决策速览表

| 问题 | 决策 |
|---|---|
| 视图升级方式 | 保留 `recent` view id 与设置键，标题改为「暂存区」（`viewRecent` 键名保留、文案改写）；palette `/recent` 加 alias `staging` |
| 暂存区存什么 | 只存书签 id 的本地集合（`staging` JSON，`v:1`），上限 500，去重，失效修剪；local 区不进 sync；census 归 `'other'` |
| 文件夹允许发送吗 | 允许，扁平化为书签集合，自动生成同名虚拟分组（`sourceFolderId` 合并） |
| 发送过来允许展开吗 | 无文件夹层级；分组头可折叠，折叠后显示「组名 + N 条」摘要 |
| 超大文件夹 | 先计数：>100 确认；超 500 上限整体拒绝，不静默截断 |
| 暂存区支持文件夹层级吗 | 不支持；层级只存在于书签树，归位靠文件夹选择器 |
| 虚拟分组 | 支持；内置「未收藏」桶 + 用户组/文件夹组/tab 组 + 已收藏未分组散行；组头可折叠、可作选择单元 |
| 收藏/取消收藏 | 暂存条目 `fav` 布尔标记，与分组正交（收藏不是组）；未收藏且未分组自动入内置「未收藏」桶，不改书签树 |
| 选择模式「删除」 | 删除真实书签（confirm + undo 单步）；「清空」只清暂存本地（ConfirmDialog）；「移出」toastAction 可撤销 |
| 双区域键盘模型 | **单滚动容器 + 兄弟 `<ul>` + `crossRowUl`**（死链视图先例），view-manager 零机制改动；废弃 `extraLists` 设想 |
| 文件夹选择器 | **扩展复用 4.1.0 `BookmarkFolderPickDialog`**（底部 [移动][复制][取消] 一次完成选位置+选动作）；不新建对话框、不用 CopyMoveDialog 名 |
| 移动/复制到文件夹 | 移动成功移出暂存，复制保留；同父 move no-op |
| 树内复制/剪切/粘贴 | 会话级单条书签剪贴板（popup/sidepanel 各自独立）；copy 可多次粘贴，cut 粘贴后清空；Esc 优先取消 cut |
| tab-groups 互通 | tab/closed tab 行「收藏并暂存」（复用 quick-add 落夹语义 + URL 去重）；组头「整组收藏并暂存」（>10 确认，自动建 `sourceTabGroup` 组） |
| 搜索视图选择模式 | 结果区新增细工具条入口；仅书签行可选；动作 = 打开/打开为标签组/发送到暂存区/删除 |
| 文件夹复制清单 | 递归收集，文本/Markdown/JSON 三格式；>200 确认；clipboard 模式提为纯模块 |
| 添加文件夹折叠 | 默认折叠为「添加文件夹 ▸（此前/此后/子文件夹）」，选项 `collapseAddFolderMenu` 默认开、入 `SYNC_KEYS`、落选项页 Context menus 组 |

### 10. 新增 i18n 键清单（en 基线；实施时以 `i18n.py` 流程为准）

- 视图/区域：`viewRecent`（**改文案**「Staging/暂存区」，43 locale 重翻译）、`recentSectionTitle`（「最近添加」区头）、`stagingEmpty`（空态引导）。
- 发送/状态：`stagingAdd`（添加到暂存区）、`stagingAdded`、`stagingAlready`（已在暂存区，菜单置灰标签 + toast 复用）、`stagingAddedSummary`（新增 $n$ 条，$m$ 条已在暂存区）、`stagingFull`、`stagingFolderEmpty`、`stagingConfirmFolder`（将暂存 $n$ 条书签）、`recentStageAll`（全部暂存 + toast 复用 `stagingAddedSummary`）。
- 暂存动作：`stagingRemove`（移出暂存）、`stagingRemoved`（toast）、`stagingFav`、`stagingUnfav`、`stagingClear`（清空暂存）、`stagingClearConfirm`、`stagingDeleteConfirm`（删除所选确认，含 undo 单步提示——参照 `undoSingleStepNote` 既有键复用）。
- 分组：`stagingGroupUnfav`（未收藏桶名）、`stagingGroupNew`（新建分组…）、`stagingGroupRename`、`stagingGroupDissolve`、`stagingGroupSelectAll`、`stagingGroupNamePrompt`。
- 文件夹选择器：`folderPickMoveHere`（移动到此处）、`folderPickCopyHere`（复制到此处）、`folderPickFilter`（过滤占位符，打磨项预留）、`stagingMoveDone`/`stagingCopyDone`（含数量参数）。
- 树剪贴板：`copyBookmark`（复制）、`cutBookmark`（剪切）、`pasteHere`（粘贴到此处）、`copiedToast`/`cutToast`/`pasteDone`/`pasteGone`（书签已不存在）。
- 文件夹复制清单：`folderCopyList`（复制标题和地址 ▸）、`folderCopyText`/`folderCopyMarkdown`/`folderCopyJson`、`folderCopyConfirm`（将复制 $n$ 条）、`folderCopyDone`。
- 添加文件夹折叠：`addFolderMenu`（添加文件夹 ▸）；三个子项标签复用既有 `add-folder-before-folder`/`add-folder-after-folder`/`add-new-folder` 的键。
- tab-groups 互通：`tabRowStage`（收藏并暂存）、`tabgroupStageAll`（整组收藏并暂存）、`tabgroupStageConfirm`（含数量）、`stagedToast`（已收藏并暂存）。
- 搜索选择模式：`searchSelectMode`（选择模式 tooltip）+ 复用既有 `selectCount`/`selectAll` 等选择条键；「发送到暂存区」复用 `stagingAdd`。
- 选项页：`optionCollapseAddFolderMenu`。

净增约 **40 键**（改文案 1 键另走重翻译）；en + zh 系实译，其余 locale `[TODO:key]` 占位后 `translate --apply`，`verify` 零残留。

### 11. 空态、可达性、动效与性能预算（4.1.0 复审补全）

- **空态**：暂存列表空时渲染引导行（图标 + 一行 muted 文案，指向右键菜单与最近区上箭头两个入口）；最近添加区空态沿用 `recentEmpty`；未收藏桶空时不渲染组头。
- **可达性**：组头 `aria-expanded`；上箭头按钮 `aria-pressed`；选择计数沿用 `.select-count` 文本（aria-live 由视图切换 announce 既有机制覆盖）；全部新按钮 title + aria-label；新菜单 `role="menu"`/`menuitem` 照旧。
- **RTL**：行按钮/星标/组头缩进全部走 `inset-inline-*` 逻辑属性（4.0.5 起既有纪律）；子菜单 flyout 的侧开翻转沿用 `positionMenu` 既有 RTL 处理。
- **动效**：上箭头/staged 态切换只动 `opacity`（dur-1 档）；无新增位移动效；`prefers-reduced-motion` 全局收口自动覆盖。
- **性能预算**：暂存区单次渲染 ≤500 行 + 组头，innerHTML 整块替换在死链视图同量级已验证；修剪 = 一次 Set 查找；`badge()` O(1)。最近区折叠时 `getRecent` 跳过。不引入任何后台轮询。
- **favicon**：暂存行 favicon 走既有 `_favicon` + 补全链 + 反色服务，零新增。

### 12. 与 velvet 视觉版本的关系

本功能以**功能版本**单独先行落地（视觉沿用 4.1.0 现行语言：`.row-btn` 体系、dupes/tabgroups 组头样式、双 rung 图标工具条、body-class 对话框），不等待 velvet 视觉改版。velvet（`velvet-task-2-k3.md`）已为暂存区的新元素预留视觉契约（§1.14：双区域区头、组头、未收藏桶、星标行、选择工具条、文件夹选择器卡片化）——velvet 落地时暂存视图随全局面貌一并收敛，无二次设计。若两版本并行，velvet 的视觉契约以任务 2 文档为准、本功能的 DOM/类名结构不变（视觉改版应是 CSS/token 层工作）。

### 13. 暂存中继规范（reusable relay spec，2026-08 收口）

暂存区是全弹窗的**组织中继**：任何视图里的条目都可以一步送进工作台，稍后集中整理。
为避免各视图各自发明样式，中继入口统一遵守以下规范（全部已落地，新视图照抄）：

**行级悬浮按钮（单一规范，源自 stats 视图 §2.3）**

- 类名 `row-btn staging-add-btn`，已暂存追加 `staged`；图标 `STAGE_ICON`（空心飞机）/ `STAGE_ICON_DONE`（实心飞机）。
- 点击是**切换**语义：未暂存 → `addItems([{id, url, title}])`；已暂存 → `removeByUrl(url)`（送错就点同一枚收回）。
- 视觉：悬浮浮现（`.row-btn` 基类 visibility 规律）；`.staged` = accent 色 + 常显（全局规则 `.staging-add-btn.staged`，任何视图免 CSS）。
- 标签：`stagingAdd` / `stagingRemove`（aria-label + title 同文，随 staged 态翻转）。
- 位置律：**紧邻破坏性尾部左侧**（删除/关闭/应用按钮的左边）——收藏(★)/暂存(✈)/删除(🗑) 三段序，右端永远是破坏性动作。
- 选择模式：不渲染（行级让位给批量条）；需要几何对齐时以同列惰性标记替代（tabgroups 的做法）。

**组头/记录头按钮**

- 同一样式；语义升级为**整组成员**：点击 = 全组成员入册，全员已暂存时点击 = 全员移出（去重视图 `stageGroupByKey`、标签组 `stageTabGroup`、已关闭记录 `stageClosedGroup`）。
- staged 判定 = 全部可入册成员都已暂存（部分暂存显示空心，点击补齐）。

**工具栏批量入口**

- 22px 方形图标钮（与各视图 select-mode 入口同语言），位于该工具栏**主破坏性动作左边**（死链：删除全部左；去重：全部应用左）。
- 点击 = 当前**过滤后列表**的全部行入册（死链 `selectableRows()`、去重全组成员）；`addItems` 自带去重/上限/toast，无需各视图重复造。

**右键菜单**

- 通用行菜单键：`stagingAdd`（书签行，已暂存时置灰 + 标签翻 `stagingAlready`）——树/搜索/统计/死链/去重行已挂。
- 整组入口键：`tabgroupStageAll`（「整组发送到暂存」，与标签组共用一个键一个文案）。
- 暂存区自身行菜单：`staging-remove-item`（移出暂存）+ `staging-fav-toggle` + `staging-group-assign`（§2.4）。
- 文案语义纪律：暂存动作**不承诺收藏**——「发送到暂存」是纯快照/纯引用入册，真正的建书签由工作台内的星标动作完成（`tabRowStage`/`tabgroupStageAll`/`tabgroupStageConfirm` 已按此正名）。

**选择模式批量条**

- 各视图选择条保留 `stagingAdd` 文本按钮（搜索/统计既有）；暂存区自身的九宫格动作条见 §3.3。

**接入清单（2026-08 全量盘点）**

| 视图 | 行悬浮 | 组头/头 | 工具栏 | 右键菜单 |
| --- | --- | --- | --- | --- |
| 树 | —（菜单为主） | — | — | ✅ 行 `stagingAdd`、文件夹整夹发送 `add-folder-to-staging` |
| 搜索 | ✅（+行删除） | — | 选择条 ✅ | ✅ |
| 暂存区（自身） | ✅ 星标/移出 | ✅ 快捷尾 | ✅ 折叠对+新建 | ✅ 行三件套 + 组菜单 |
| 统计 | ✅（历史行） | — | 选择条 ✅ | ✅（历史行 slim 菜单） |
| 死链 | ✅ | — | ✅（删除全部左） | ✅ |
| 去重 | ✅ | ✅（应用左） | ✅（全部应用左） | ✅ + 组菜单整组发送 |
| 标签组 | ✅ | ✅（收藏与关闭之间） | —（选择条整组入册） | ✅ 行/组/已关闭三菜单 |

唯一有意不接的入口：omnibox（后台无 UI 宿主）与分隔符行（无 URL 可暂存）。
