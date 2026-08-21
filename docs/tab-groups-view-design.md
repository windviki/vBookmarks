# 标签组视图（Tab Groups View）设计文档

> 分支：`feature/tab-groups-view`（worktree）
> 目标版本：4.1.0
> 基线：`1274acf`（master, 4.0.8）；合并后版本号定为 4.1.0

## 1. 目标

在弹窗视图体系（`src/view-manager.js`）中，于搜索视图之后新增一个 **标签组视图（tabgroups）**，
作为浏览器标签页与书签结合的管理界面：

1. 展示当前浏览器窗口的所有标签页；已加入 Chrome 标签组的按组展示（组标题、颜色），
   未成组标签按浏览器标签页顺序忠实呈现。
2. 提供类似去重视图的选择模式，可对组内/组外标签进行批量操作：组成新标签组、打开到已有标签组、
   关闭、睡眠。其中“组成新标签组 / 打开到已有标签组”提供对话框选项：对已属于某标签组的选中标签，
   选择“复制”（在新位置重新打开）或“移动”（从原标签组移出）。
3. 与书签结合：
   - 选中一个或多个标签，可快速添加到指定书签文件夹（新增文件夹选择对话框）。
   - 每行悬浮按钮可一键把该标签加入书签（复用统计视图 `quickAddFolderId` 落点与 toast）。
   - 标签组可一键保存为书签文件夹（复用 `session.js` 的串行保存流程），并额外保存组元信息
     （颜色、标题、保存时间等）；之后通过文件夹右键菜单“打开到新标签组”时自动恢复。
4. 附加浏览器 tab 管理能力：拖拽排序（`chrome.tabs.move`）、按状态刷新、当前标签标记等。
5. 遵守既有机制：视图隐藏/禁用（选项页 + tab 右键菜单 + storage 实时生效）、键盘快捷键、
   Esc 层级、SVG 图标、对齐与列表焦点契约。

## 2. 视图注册与位置

- 新视图 id：`tabgroups`。
- 注册顺序：`tree` → `search` → **`tabgroups`** → `recent` → `stats` → `dead` → `dupes`。
  通过 `src/neat.js` 中在 `initViewRecent` 之前调用 `initViewTabGroups` 实现（`treeView` 等依赖已就绪）。
- `src/view-manager.js`：
  - `VIEW_SHOW_KEYS` 增加 `tabgroups: 'showTabGroupsView'`。
  - `VIEW_DISABLE_KEYS` 增加 `tabgroups: 'disableTabGroupsView'`。
  - `WATCHED_VIEW_KEYS` 自动纳入。
- 视图定义：
  - `titleKey: 'viewTabGroups'`
  - `icon: VIEW_ICONS.tabgroups`（新增 SVG）
  - `container: $('view-tabgroups')`
  - `listEl: $('tabgroups-list')`
  - `showKey: 'showTabGroupsView'`，`disableKey: 'disableTabGroupsView'`
  - `typeAhead: false`（与 stats/dead/dupes 一致）
  - `badge: () => 标签页总数`（含已分组与未分组）
  - `activate`：拉取标签页/标签组数据并渲染
  - `onEscape`：选择模式时退出选择模式

## 3. 数据来源与刷新

- `chrome.tabs.query({ currentWindow: true })` 获取当前窗口全部标签页（按 index 升序）。
- `chrome.tabGroups.query({ windowId: currentWindow })` 获取当前窗口全部标签组。
- 刷新时机：
  - 视图激活时；
  - 激活状态下，`chrome.tabs` 的 `onCreated / onRemoved / onMoved / onUpdated / onActivated`
    以及 `chrome.tabGroups` 的 `onCreated / onRemoved / onUpdated / onMoved` 事件触发
    300ms 防抖刷新（与 recent/dupes 一致）。
- 列表顺序 = `tabs` 数组顺序。遍历时遇到某组第一个 tab 时先渲染组头，再渲染该组全部 tab
  （Chrome 保证同组 tab 连续）；未分组 tab 按顺序渲染为普通行。

## 4. 渲染结构

列表容器：`<div id="tabgroups-list" tabindex="-1">`（HTML 中加入）。

```
<div class="tabgroups-toolbar tabgroups-controls-toolbar vbm-toolbar">
  [刷新] [全部折叠/展开] … [选择模式]
</div>
<ul role="list">
  <li class="tabgroups-group" data-group-id="...">
    <span class="tabgroups-group-head" role="button" tabindex="-1" aria-expanded="true">
      <span class="chevron"></span>
      <span class="tab-group-dot tg-blue"></span>
      <span class="tabgroups-group-title">组标题</span>
      <span class="count-pill">N</span>
      <button class="row-btn tabgroups-group-save" title="保存为书签文件夹">FOLDER</button>
    </span>
  </li>
  <li class="vbm-row tabgroups-row" data-tab-id="123" data-group-id="...">
    <a class="tree-item-link" href="...">…标题/URL…</a>
    <span class="tabgroups-current" hidden>当前标签</span>
    <button class="row-btn tabgroups-add-bookmark">STAR</button>
  </li>
  …
</ul>
```

- 组头：颜色圆点（`.tab-group-dot.tg-{color}`）、标题（无标题回退 `tabGroupUntitled`）、
  数量 pill，以及 5 个常显操作按钮：
  激活组（聚焦第一个标签页）、重命名组（复用 `GroupDialog` 改标题/颜色）、
  保存为书签文件夹、睡眠整组、关闭整组。
- 折叠/展开同步到浏览器：本地 `collapsed` 集在每次刷新时由 `chrome.tabGroups.TabGroup.collapsed`
  重建；用户折叠/展开/全部折叠/全部展开时同时调用 `chrome.tabGroups.update`。
- 普通行复用 `treeRender.generateBookmarkHTML` 生成书签风格行（favicon/标题/URL 提示），
  但不带 `data-node-id`；锚点带 `data-tab-id` 与 `data-url`。
- 行尾悬浮按钮：`tabgroups-add-bookmark`（STAR_ICON），点击把该 tab 一键加入
  `quickAddFolderId` 对应书签文件夹。

## 5. 选择模式（参照 view-dupes）

- 工具栏“选择”按钮（SELECT_ICON）进入选择模式；Esc 退出。
- 选择模式下：
  - 工具栏替换为：已选计数 + 全选 / 反选 / 清空 / 新标签组 / 打开到标签组 / 关闭 / 睡眠 / 退出。
  - 行点击切换选中；组头点击切换整个组内 tab 的选中状态。
  - 组头/成员行复选框样式与 dupes 保持一致。
- 动作：
  - **组成新标签组**：弹出 `GroupDialog`（复用现有“新建标签组”对话框）设置标题与颜色。
    若选中项含已分组标签，`GroupDialog` 之前先弹一个选择对话框（`ConfirmDialog` 两键或
    新的三态对话框）：按钮1 = 移动，按钮2 = 复制。选择后执行：
    - 移动：直接 `chrome.tabs.group({ tabIds })` 到新组，更新标题/颜色。
    - 复制：对“已分组”的选中标签先 `chrome.tabs.create({ url, active:false })` 生成副本，
      再将“未分组选中标签 + 副本”分到新组；原标签留在原组。
  - **打开到已有标签组**：`GroupPickDialog` 选择目标组；同样先询问已分组标签的复制/移动。
    - 移动：`chrome.tabs.group({ tabIds, groupId })`。
    - 复制：为已分组标签创建副本后 `chrome.tabs.group({ tabIds: 未分组 + 副本, groupId })`。
  - **关闭**：`chrome.tabs.remove(tabIds)`；选择模式退出。
  - **睡眠**：`chrome.tabs.discard(tabIds)`；选择模式退出。
- 执行全部通过 `tab-groups-sw.js` 扩展的消息发送到 service worker，避免 popup 关闭中断回调：
  - `vbm-tabs-new-group` `{ moveIds, copyTabs, title, color }`
  - `vbm-tabs-open-into` `{ moveIds, copyTabs, groupId }`
  - `vbm-tabs-close` `{ tabIds }`
  - `vbm-tabs-discard` `{ tabIds }`

## 6. 书签结合

### 6.1 单行快速加书签

- 复用 `view-stats.js` 的 `addToBookmarks` 配方：先 `chrome.bookmarks.search({ url })` 查重，
  已存在则不重复创建；否则 `chrome.bookmarks.create({ parentId: quickAddFolderId, title, url })`，
  用 `undo.showToast(_m('quickAddedTo', folderName))` 提示。

### 6.2 选中标签添加到指定书签文件夹

- 新增对话框 `BookmarkFolderPickDialog`（`src/dialogs.js`）：
  - body class：`needFolderPick`；`activeEl`/`anyOpen`/`closeDialogs` 纳入。
  - 内容：`<div id="bookmark-folder-pick-text">` + `<ul id="bookmark-folder-pick-list">`。
  - 数据：`chrome.bookmarks.getTree` 扁平化所有文件夹，按“书签栏 / 其他书签 / 移动设备”
    根顺序 + 标题排序；每行一个按钮，缩进表示层级（`--folder-indent` 复用树缩进）。
  - 点击后回调 `onPick(folderId)`。
- 添加到文件夹：对选中标签串行 `chrome.bookmarks.create`，跳过已存在 URL，最后
  `undo.showToast(_m('tabGroupsBookmarksAdded', [count, folderName]))`。

### 6.3 标签组保存为书签文件夹

- 组头悬浮按钮 `tabgroups-group-save`：把该组所有 tab 保存为新书签文件夹：
  - `folderName = group.title || _m('tabGroupUntitled')`；
  - 复用 `session.saveSession({ rootFolderId: quickAddFolderId, folderName, tabs })`；
  - 保存成功后写元数据：`saveTabGroupFolderMeta(store, folderId, { title, color, savedAt, sourceGroupId })`。
  - 处理重复：同一组重复保存会新建文件夹，不覆盖旧文件夹。
- 选择模式下提供“保存为书签文件夹”按钮，对选中标签建文件夹（名称默认
  `sessionFolderName(new Date(), _m('sessionFolderName'))`），并提示。

### 6.4 打开书签文件夹为标签组时恢复元信息

- `src/tab-group-utils.js` 新增：
  - `TAB_GROUP_FOLDER_META_KEY = 'tabGroupFolderMeta'`
  - `readTabGroupFolderMeta(store, folderId)`
  - `saveTabGroupFolderMeta(store, folderId, meta)`
  - `forgetTabGroupFolderMeta(store, folderId)`（文件夹删除时清理）
- `src/actions.js` `openBookmarksInGroup(urls, groupTitle, groupColor, folderId)`：
  当传入 `folderId` 且存在 meta 时，用 meta.title/meta.color 覆盖默认值。
- `src/context-menu.js` 文件夹菜单：
  - `open-bookmarks-in-group` 传入 `folderId`；
  - `open-bookmarks-in-group-setup` 的 GroupDialog 预填 meta 的 title/color。
- 元数据为本地增强：删除/损坏时行为退化为现有默认（按文件夹名 + 确定性颜色）。

## 7. 附加管理能力

- **拖拽排序**：普通行和组头可拖拽；dragover 计算目标 tab 的 `index`，
  drop 时 `chrome.tabs.move(tabId, { windowId, index })`。组内拖拽按 tab index 排序，
  组头拖拽移动该组第一个 tab 到目标位置（同组 tab 跟随移动）。
- **刷新按钮**：工具栏提供“刷新”按钮，手动重拉数据。
- **全部折叠/展开**：组头可折叠；工具栏提供全部折叠/展开按钮。
- **当前标签**：当前激活 tab 行显示 `tabgroups-current` 标记，并在列表中优先可见
  （渲染后滚动到当前标签）。

## 8. 键盘与焦点

- 列表键盘导航由 `view-manager` 统一绑定；`typeAhead:false`。
- 组头键盘：←/→/Space/Enter 折叠展开（RTL 镜像，同 dupes 组头）。
- 选择模式下 Space 切换选中（行/组头），Enter 仍可折叠/打开。
- 工具栏 `.vbm-toolbar` 参与 rung；`parkToolbarFocus/parkRowFocus` 保证刷新/切换不丢焦点。
- `onEscape`：选择模式返回 true；否则 false（继续走全局 Esc 链）。
- 行内锚点 `data-tab-id`：Enter 打开该 tab（激活标签页，不关闭 popup？跟随
  `bookmarkClickStayOpen` 语义，当前实现激活 tab 后关闭 popup，因为弹出窗属于当前标签）。
  首版：单击/Enter 激活对应标签页，与 Chrome 标签页管理语义一致。

## 9. 设置与选项页

- `pages/options.html` Views 组新增一行：`show-tab-groups-view` / `tabgroups-view-state` /
  `tabgroups-view-toggle`。
- `src/options.js`：
  - `viewSettings` 增加 `{ id:'show-tab-groups-view', key:'showTabGroupsView', defaultValue:'1', inverted:false }`。
  - `FEATURE_VIEW_OPTIONS` 增加 `{ showId:'show-tab-groups-view', disableKey:'disableTabGroupsView',
    stateId:'tabgroups-view-state', toggleId:'tabgroups-view-toggle' }`。
  - i18n 文案绑定。
- 隐藏/禁用行为由 `view-manager` 既有逻辑自动获得：tab 右键菜单 Hide/Disable、storage 实时生效、
  palette 可跳转（未禁用但隐藏时）、禁用则彻底不可达。

## 10. CSS

- 在 `css/neat.css` 增加：
  - `#tabgroups-list ul/li` 加入列表 reset 选择器组。
  - `.tabgroups-toolbar` 复用 `.dupes-toolbar` 的工具栏语言（两行 `.vbm-toolbar`）。
  - `.tabgroups-group .tabgroups-group-head` 复用 dupes 组头结构。
  - `.tab-group-dot` 9 色圆点（与 `dialogs.js` 的颜色 swatch 同语义）。
  - `.tabgroups-row` / `.tabgroups-current` / 选择模式复选框。
  - 组头/行 hover/focus/selected 与 dupes 对齐。
- 对齐：行内锚点沿用 `.tree-item-link` 三槽契约；行按钮恒占 20px+4px 槽；工具栏 padding 4px 8px。

## 11. i18n

新增键（en + zh_CN 真译，其余 locale 先插 `[TODO:key]`，随后用 `scripts/i18n.py translate --apply`
补齐；提交前 `python3 scripts/i18n.py verify` 必须 0 错误）：

- `viewTabGroups` — 视图名。
- `optionShowTabGroupsView` — 选项页显示开关。
- `tabGroupsViewEmpty`、`tabGroupsViewNoTabs`、`tabGroupsViewLoading`。
- `tabGroupsGroupCreatedAt`、`tabGroupsGroupSavedToFolder`、`tabGroupsSaveFolder`、
  `tabGroupsAddBookmark`、`tabGroupsAddBookmarkDone`、`tabGroupsBookmarksAdded`。
- `tabGroupsSelectNewGroup`、`tabGroupsSelectOpenInto`、`tabGroupsSelectClose`、
  `tabGroupsSelectSleep`、`tabGroupsSelectSaveFolder`。
- `tabGroupsCopyMoveDialog`、`tabGroupsCopyMoveCopy`、`tabGroupsCopyMoveMove`。
- `tabGroupsConfirmClose`、`tabGroupsConfirmSleep`、`tabGroupsConfirmBookmarks`。
- `bookmarkFolderPickDialogTitle`、`bookmarkFolderNoFolders`。

## 12. 测试

新增 `tests/view-tabgroups.test.js`（直接 ESM import + chrome/DOM 假件，沿用 view-dupes 模式）：

- 注册元数据：id/titleKey/icon/showKey/disableKey/typeAhead/badge。
- 渲染：组头（标题、颜色、数量）、未分组行按 tab 顺序；当前标签标记；悬浮加书签按钮。
- 选择模式：进入/退出；行点击、组头点击；计数；全选/反选/清空。
- 动作：
  - 新标签组/打开到标签组：已分组标签触发复制/移动确认，消息体正确（moveIds/copyTabs）。
  - 关闭/睡眠：确认对话框 + 消息发送正确。
- 书签：单行加书签查重/创建；选中添加到指定文件夹（文件夹选择对话框回调）；组保存为文件夹
  + 元数据写入。
- 拖拽排序：dragover/drop 生成 `chrome.tabs.move` 正确参数。
- `onEscape`：选择模式消费 Esc，否则不消费。
- 更新 `tests/view-manager.test.js`：tabgroups 的 show/disable 键注册与顺序。
- 更新 `tests/i18n-copy.test.js` / 运行 `python3 scripts/i18n.py audit`。
- 更新 `tests/popup-layout.test.js`、`tests/fuzzy.test.js` 中 HTML 结构断言（新增 section/列表）。

## 13. 提交批次

1. `docs(tab-groups): add tab groups view design` — 本文档。
2. `feat(tab-groups): register view shell, icon, view-manager keys, html/css skeleton`。
3. `feat(tab-groups): render tabs + groups, selection mode, tab group actions via SW`。
4. `feat(tab-groups): bookmark integration (row add, folder picker, save group folder meta)`。
5. `feat(tab-groups): drag sorting, refresh, collapse, options page + i18n`。
6. `test(tab-groups): add view-tabgroups suite and update affected suites`。

## 14. 验收清单

- [ ] 视图出现在搜索之后；隐藏/禁用/选项页实时生效；tab 右键菜单可 Hide/Disable。
- [ ] 组头显示标题/颜色；未分组按 tab 顺序展示。
- [ ] 选择模式可批量：新组、打开到组（复制/移动确认）、关闭、睡眠。
- [ ] 选中标签可添加到指定书签文件夹；行悬浮加书签可用。
- [ ] 组保存为书签文件夹后，文件夹右键“打开到新标签组”恢复颜色/标题。
- [ ] Esc 层级：对话框 → 选择模式 → 搜索清空 → 回树 → 关闭。
- [ ] 键盘：视图切换、工具栏 rung、行导航、组头折叠、选择模式 Space。
- [ ] `npm run test:run` 全绿；`python3 scripts/i18n.py audit`/`verify` 通过；`npm run lint` 通过。

## 15. 第二轮细化（4.1.0 打磨轮）

本轮针对使用反馈做的行为/样式收敛，全部有单测 + 真浏览器断言（`scripts/screenshots/shots-tabgroups-view.js`，34–44 号图）覆盖。

### 15.1 窗口分区头：整行即折叠控件

- 结构由「chevron 按钮 + em 文案」改为一个可聚焦整行
  `<span class="tabgroups-window-head-row" role="button" tabindex="-1" aria-expanded>`，
  内含 chevron（与组头/已关闭组头同一个文字 chevron）+ 窗口名 + 「当前窗口」标记 + 数量 pill。
- 鼠标：整行任意位置点击折叠/展开；选择模式下整行点击 = 切换该窗口全部标签的选中。
- 键盘（与组头同协议，只是高一层）：`Space`/`Enter` 折叠展开（选择模式下切换选中）、
  折叠态 `→` 展开、展开态 `←` 折叠，其余方向键被吞掉——窗口头没有右键菜单也没有上级，
  否则通用行规则会在它上面开出**文件夹菜单**。`F2` 同样吞掉（它不是书签）。
- `src/context-menu.js` 显式对 `.tabgroups-window-head` 不开任何菜单。
- 折叠记忆语义修正：只记录**用户显式操作**（`windowChoices: {id: bool}`），默认值仍是
  「当前窗口展开、其他窗口折叠」。旧的扁平 `collapsedWindows` 数组会被读成显式折叠（升级兼容）。
  关闭「记住上次状态」时，本会话的内存选择在 300ms 防抖刷新后依然保留。

### 15.2 键盘右键菜单焦点 bug

`src/keyboard.js` 之前没有把标签组视图的菜单绑到 `contextKeyDown`：键盘（`→` / ContextMenu /
Shift+F10）能把菜单打开、菜单也拿到了焦点，但**不响应任何键**（↑↓ 进不去条目、Enter 无动作、
Esc 落到文档层）。本轮把四个菜单（标签行 / 组头 / 已关闭记录 / 已关闭记录内标签）全部绑定，
并纳入 `menuContainers`（Tab 陷在菜单内）与 `allMenus`（文档 Esc 分层）。`viewTabMenu` 一并补进
`menuContainers`（4.0.8 文档声称已在，实际漏了）。

### 15.3 行图标四列固定槽

每行行尾恒为四列（20px + 4px）：**固定 / 睡眠 / 收藏 / 关闭**，无状态的列渲染成空占位
`.tabgroups-slot`，因此：

- 未收藏的行预留收藏位，行与行之间同类图标严格同列；
- 选择模式渲染同样的四列，但换成惰性状态标记（固定 / 已睡眠 / 已收藏）+ 空占位，
  几何与非选择模式完全一致（进入选择模式不再让图标错位）。

状态图标本身即动作：已固定的图钉点击 = 取消固定；实心月牙 = 已睡眠，点击 = 唤醒
（`vbm-tabs-wake` → `chrome.tabs.reload`，原地唤醒不切换当前标签，无需确认）；
实心 ★ = 已收藏，点击 = 取消收藏（先 `undo.capture` 再 `bookmarks.remove`，toast 带撤销）。
组头睡眠按钮同理：成员全部睡眠 → 实心 + 「唤醒标签组」。

右键菜单标签跟随状态：固定/取消固定、睡眠/唤醒、收藏/取消收藏，并派发对应动作。

### 15.4 竖直对齐与右缘节奏

行尾最后一个控件统一 `margin-inline-end: 4px` + 行自身 `padding-inline-end: 4px` = **距容器 8px**，
与组头（组头 4px padding + 按钮 4px margin）、已关闭组头、工具栏最后一个 icon 落在同一列。
之前行控件多了 4px，导致组头按钮列与行图标列整体错开 4px（“竖直方向未对称”）。
真浏览器断言：组头最后控件与行最后控件右缘差 ≤1px，且每个行图标垂直居中偏差 ≤1px。

### 15.5 标签组颜色样式：二选一 + 关闭

`tabGroupsColorBorder`（布尔）退役为 `tabGroupsColorStyle`（`off` / `edge` / `line`），
选项页由复选框改为下拉；旧布尔值仍被读成 `edge`（老配置观感不变），写入时同步维护旧键。

- `edge`（原样式）：组头与成员行左缘 3px 颜色条带（inset box-shadow）。
- `line`（新增）：成员行绝对定位的 `.tg-connector` 画**颜色连接线**——组头颜色圆点中心正下方
  的竖干（3px，比条带更宽）+ 每行一条横向 tick（类制表符），最后一个成员 `.tg-last` 收成拐角，
  组头 `::after` 补出圆点到第一行的那半段，折叠组不留悬空竖线。竖干落在成员行 16px twisty
  占位列（24–40px）内，不与行图标相撞；选择模式整体右移一个复选框槽（+20px）。
  真浏览器断言：竖干中心与组头圆点中心偏差 ≤1.5px、线宽 ≥3px。

### 15.6 选择模式默认展开

进入选择模式会打开全部折叠（标签组 + 窗口分区）——批量条看不到候选行就是陷阱；退出时恢复
进入前的折叠快照。选择期间 `persistUIState` 停写（避免把临时全展开状态覆盖掉用户的真实选择），
选择期间的刷新也不会重新折叠。

### 15.7 「最近关闭」区

- 分区文案 `tabGroupsClosedGroups` 改为「最近关闭 / Recently closed」。
- 关闭时间：记录是我们自己写的（`savedAt` 必有），所以一定显示——组头沿用相对时间 +
  绝对时间 tooltip；独立关闭标签行走死链视图的 `rightText`/`subRight` 契约：窄弹窗行内相对时间，
  宽/侧边栏第二行右侧绝对时间。组内成员行继承组头时间，保持单行。
- 右键菜单按状态给项，不再复用书签菜单（原来会出现「在树中定位」「编辑」等无意义项）：
  - `#tabgroups-closed-context-menu`（已关闭组头）：重新打开 / 展开·折叠（空记录置灰，标签跟随状态）/ 删除记录；
  - `#tabgroups-closed-tab-context-menu`（记录内标签）：在新标签打开 / 收藏 / 从记录移除。
  两个菜单都在 popup 与 sidepanel 两个页面注册，并纳入键盘协议。

### 15.8 睡眠图标

`SLEEP_ICON` 重画为**单一平滑月牙**（外弧 r6 + 近半圆内弧 r4.67，弧线中段无凸起/凹陷），
并新增实心版 `SLEEP_ICON_FILLED`；旧图形内嵌的 “Z” 字形与浅内弧已删除。空心 = 醒着（点击睡眠），
实心 = 已睡眠（点击唤醒），与 `STAR_ICON` / `STAR_ICON_FILLED` 同一套双态语言。

### 15.9 宽窄一致性

视图沿用死链/去重的语言：两行 `.vbm-toolbar` 工具栏（`flex-wrap`，窄弹窗换行不溢出）、
`.vbm-row` 行契约、`row-path`/`row-sub` 容器查询（<480px 行内标签，≥480px 第二行）。
真浏览器断言：320px 与 640px 两种宽度下列表 `overflow-x: hidden`、无横向溢出，
且关闭时间在窄宽两态各自只出现在对应槽位。
