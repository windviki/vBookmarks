# 标签组视图（4.1.0）审计报告

> 审计日期：2026-08-22 · 对象：`v4.0.8..HEAD`（合入的 4.1.0 功能，即标签组视图 `src/view-tabgroups.js` 及其全部支撑改动）
> 依据：`docs/plan-4.1.0/tab-groups-view-design.md`（含 §15 打磨轮）逐条核对契约；对照 2025–2026 顶级标签管理工具（Chrome 原生标签组/Tab Search、Tab Manager Plus、Workona、Session Buddy、Toby、OneTab、Sidebery）的功能与设计。
> 审计方式：核心模块 `src/view-tabgroups.js`（2107 行）逐行人工审计 + 支撑改动（SW/菜单/对话框/键盘/CSS/两页 HTML）专项审计 + 竞品功能对标。审计时全量 2608 例单测、`i18n.py verify`、ESLint 均绿。

---

## 0. 结论摘要

功能整体成熟：设计文档契约基本实现，四个新右键菜单的 focus 法则 / Esc 分层 / Tab 陷阱 / #48 钳制全部合规，popup/sidepanel 两页逐字节一致，键盘模型（窗口头→组头→行三级协议、选择模式、K14 文本框规则）贯彻到位，CSS 全令牌化无跨主题硬编码。

本次审计发现 **1 项高严重度缺陷、7 项中、10 项低**，外加 **3 项与顶级工具对标的体验缺口**。无数据丢失路径；所有失败均静默收敛。

最突出的问题：

1. **跨窗口激活不聚焦目标窗口**（高）——视图的头号卖点是"展示所有窗口的标签"，但点击非当前窗口的标签只调 `tabs.update(active)`，不调 `windows.update(focused)`，目标窗口不置前，用户看来"点了没反应"。
2. 设计承诺的"渲染后滚动到当前标签"（§7）未实现——代码中没有 `scrollIntoView`。
3. 一组一致性缺口：`tabGroupFolderMeta` 零清理且绕过 storage 普查护栏、SW 两条消息无 lastError 容错、组头菜单睡眠项标签不随状态刷新、两个 closed 菜单漏绑 hover 聚焦、"清空已关闭记录"按钮键盘完全不可达且无确认、行内 ☆ 加书签按钮误用 danger 红（违反 4.0.5 确立的红=删除语言）。

---

## 1. 4.0.8 → 4.1.0 变更范围

44 个提交，+18771/−338 行（含 43 locale 各 +275 行）。核心增量：

- **第七个视图 `tabgroups`**（`src/view-tabgroups.js`，2107 行）：所有正常窗口的标签按标签条顺序呈现（当前窗口优先，窗口分区头可折叠且整行即折叠控件）；已分组标签嵌在 Chrome 标签组头下（标题/色点/数量/五个常显操作）；未分组为普通行；行尾四列固定图标槽（固定/睡眠/收藏/关闭），状态图标即动作；dupes 式选择模式（批量新组/打开到组[复制或移动]/加书签/存文件夹/睡眠/关闭）；「最近关闭」区（自记录的已关闭组与单标签，深度 5–50 可调）。
- **SW 批量管线**（`src/tab-groups-sw.js` 扩展）：`tabsNewGroup`/`tabsOpenInto`/`tabsClose`/`tabsDiscard`/`tabsWake`/`tabsMoveNewWindow` 六个消息，popup 中途关闭不掉回调。
- **新对话框**：CopyMoveDialog（已分组标签复制/移动三态）、BookmarkFolderPickDialog（文件夹选择器）。
- **四个新右键菜单**：tab 行 / 组头 / 已关闭组 / 已关闭标签，全部状态化标签。
- **组元信息**（`tab-group-utils.js` 的 `tabGroupFolderMeta`）：组存为书签文件夹时记住标题/颜色，文件夹右键"打开到新标签组"时恢复。
- 组颜色样式三态（off/edge/line，line 为连接线）、浏览器折叠同步开关、拖拽排序、键盘层三级协议与菜单绑定、视图隐藏/禁用全链路。

## 2. 设计契约核对（docs/plan-4.1.0/tab-groups-view-design.md）

| 设计项 | 实现 | 结论 |
|---|---|---|
| §2 视图注册在 search 之后、show/disable 键 | `views.register` 位置与键正确 | ✅ |
| §3 数据源 + 300ms 防抖事件刷新 | `readWindows` 全窗口 + 11 个事件挂 `scheduleRefresh` | ✅ |
| §4 渲染结构（组头五操作/行四列图标槽/窗口头整行折叠） | 与 §15.1/§15.3 修订一致 | ✅ |
| §5 选择模式 + 复制/移动对话框 + SW 消息 | 完整；CopyMoveDialog Esc 中立 | ✅ |
| §6.1 行内快速加书签（查重 + toast） | 有；已存在路径 toast 语义不当（低 #L9） | ⚠️ |
| §6.2 选中加到指定文件夹（BookmarkFolderPickDialog） | 有；列表无 ↑↓ 导航（低 #L3） | ⚠️ |
| §6.3 组存为书签文件夹 + meta 写入 | 有；meta 零清理（中 #M1） | ⚠️ |
| §6.4 打开文件夹恢复 meta | 有（双重读取冗余，低 #L8） | ✅ |
| §7 拖拽排序 | 行级拖拽有；**组头拖拽未实现**（设计声称"组头可拖拽移动整组"）；无插入位置线 | ⚠️ 留待 |
| §7 刷新按钮 / 全部折叠展开 | 有 | ✅ |
| §7 **渲染后滚动到当前标签** | **未实现**（无 scrollIntoView） | ❌ 高 #H2 |
| §8 键盘（组头协议/选择模式/Esc） | 完整；窗口头 Delete 穿透（低 #M7） | ⚠️ |
| §9 选项页开关 + 实时生效 | 有 | ✅ |
| §10 CSS（两行工具栏/对齐契约） | 有；三处视觉缺陷（#M6/#L6/#L7） | ⚠️ |
| §11 i18n | 43 locale 齐、verify 0 错误 | ✅ |
| §12 测试 | 1507 行视图套件 + 支撑套件更新 | ✅ |

## 3. 顶级工具对标（2025–2026）

来源：Chrome 官方文档（标签组/Tab Search）、Tab Manager Plus（gHacks 详评）、Workona/Session Buddy/Toby/OneTab 官方文档与评测、Sidebery（AMO）。详见调研要点（附录 A）。

| 能力 | 顶级工具现状 | 本视图 | 判定 |
|---|---|---|---|
| 跨窗口总览 + 点击聚焦 | TMP 窗格间点击/拖拽直达；Workona 切 space | 展示了全部窗口，但**点击不聚焦目标窗口** | ❌ 高 #H1 |
| 视图内即时过滤/搜索 | TMP 即时高亮过滤、Chrome Tab Search（Ctrl+Shift+A）、Session Buddy 搜打开中标签 | **无**（搜索框搜的是书签） | ❌ 抛光 #P1 |
| 标签状态展示 | pinned/discarded + **播放中/静音/加载中** | pinned/discarded/当前/已收藏 | ⚠️ 留待（音频状态） |
| 重复标签检测 | Workona/Sidebery/TMP 均有 | 无 | ⚠️ 留待 |
| 批量操作 | Workona Shift 多选 + 单键；Chrome Ctrl 点选（成组/pin/静音/关闭） | 选择模式六项批量，无 Shift 范围选、无批量 pin | ⚠️ 基本达标 |
| 最近关闭 | Chrome ~25 条（不可配置）；Session Buddy 崩溃恢复 | 自记录、深度 5–50 可配、组级恢复 + 颜色/标题还原 | ✅ 超出 |
| 组 ↔ 书签互通 | Chrome 保存组跨设备同步 | 组存为书签文件夹 + meta 还原颜色标题 | ✅ 差异化优势 |
| 密度/布局多档 | TMP 四种密度 | 单一密度 | ⚠️ 可接受（popup 形态） |
| 窗口一等公民 | Chrome Name window、TMP 自动命名 | "窗口 N" + 当前窗口标记 | ⚠️ 可接受 |

结论：本视图的差异化优势在「组 ↔ 书签互通」与「可配置的最近关闭」，符合扩展定位；最大短板是**视图内过滤**（顶级工具无一例外都有）与**跨窗口聚焦缺陷**（本已展示多窗口，点击却不跳转）。

## 4. 缺陷清单

### 高

- **H1 · 跨窗口激活不聚焦窗口** — `src/view-tabgroups.js:1739`（行点击）、`:1761`（中键）、`:2052`（activateTab）、`:887`（activateGroup）只调 `chrome.tabs.update(id, {active:true})`。Chrome 语义：active 只在其所属窗口内生效，**不聚焦窗口**——点击其他窗口的标签看似无反应。需补 `chrome.windows.update(windowId, {focused:true})`。

### 中

- **M1 · `tabGroupFolderMeta` 零清理 + 绕过普查护栏** — `src/tab-group-utils.js:66` 的 `forgetTabGroupFolderMeta` 无任何调用方，每次"组存为文件夹"+1 条永久累积；且 `store.set(TAB_GROUP_FOLDER_META_KEY, …)` 常量间接写法绕过 `tests/storage-usage.test.js` 的字面量扫描，未进 `KNOWN_KEYS`/census 决策表。
- **M2 · SW `closeTabs`/`discardTabs` 无 lastError 容错** — `src/tab-groups-sw.js:279-291`：`chrome.tabs.remove(ids)`/`discard(id)` 无回调，陈旧 id（300ms 防抖窗口）产生 unhandled rejection 且静默无效；同文件 `wakeTabs:296` 却正确吞错——容错不一致。
- **M3 · 组头菜单"睡眠"标签不随状态刷新** — `src/context-menu.js:878-888` open 分支只刷新 `tabgroup-collapse`；全组已睡眠时菜单写"休眠"却执行唤醒（dispatch 是 isGroupAsleep 切换，`ctx.tabGroupsMenu.isGroupAsleep` 已注入未用）。
- **M4 · 两个 closed 菜单漏绑 hover 聚焦** — `src/neat.js:876-918`：`contextMouseMove`/`contextMouseOut` 只绑了 `tabRowMenu`/`tabGroupMenu`，`tabClosedMenu`/`tabClosedTabMenu` 悬停不移焦点，与其余十个菜单不一致。
- **M5 · "清空已关闭记录"键盘不可达且无确认** — `src/view-tabgroups.js:613`：按钮渲染在 `li.tabgroups-section-head` 内（无 a/span），Tab 环与箭头链都到不了，纯鼠标可达，违反 tabCycle"全键盘可达"原则；且一键清空整个历史无 ConfirmDialog（死链视图批量删除均有确认）。
- **M6 · ☆ 加书签按钮误用 danger 红** — `css/neat.css:3829-3837`：`.tabgroups-add-btn` 着 `var(--vbm-danger)`，违反 4.0.5 "红=删除"视觉语言（stats 视图 ☆ 为默认/accent 色，全仓无第二个红色 add 按钮）。
- **M7 · 结构行 Delete 穿透** — `src/view-tabgroups.js:1937-1956` 的 keyup 守卫只认 `li.tabgroups-row`；焦点在组头时 Delete 落到 `keyboard.js:697` 的通用路径，`li.id`=`tabgroups-group-N` 不匹配剥离正则 → `actions.deleteBookmark('tabgroups-group-N')`（经核实实际无害：getSubTree 失败静默 + remove lastError 早退，但属意外穿透；选择模式下组头 Delete 也因此静默无效）。

### 低

- **L1 · SW 降级哲学不一致** — `groupExistingIntoExisting`（:247-251）组已消失时 `copyTabs` 静默丢弃（旧 `openIntoGroup` 同场景降级 plainOpen 保底）；窗口中途关闭时 `createCopies` 全 resolve(null) 复制丢失（:212-237）；`moveTabsToNewWindow`（:307-340）批量 move 单点失效 → 空窗闪现。
- **L2 · tab-row 菜单分支不归一化 el** — `src/context-menu.js:889-905`：右键点在行内按钮上时 `.active` 标记落按钮而非行 anchor（closed-tab 分支 :923 有 `el = anchor || el` 可对照）。
- **L3 · BookmarkFolderPickDialog 无 ↑↓ 行导航** — `src/dialogs.js:386-431`：只能 Tab 逐个走完全部文件夹按钮；`close(wasOpen)` 形参语义与其它对话框不一致（:448-455，无行为影响）。
- **L4 · 注释与行为不符** — `src/keyboard.js:106-113` 称"窗口头只渲染 em/b 所以行游走不会落上去"，实际窗口头有可聚焦 span 且游走应当落上（设计如此）。
- **L5 · i18n 初始标签表缺两项** — `src/neat.js:277-297`：缺 `tab-row-pin`/`tabgroup-collapse` 初始标签（仅 open 时设置，无实际影响）。
- **L6 · edge 色条 RTL 不镜像** — `css/neat.css:3723`：`box-shadow: inset 3px 0 0` 物理左侧；connector 风格用逻辑属性会镜像，两种颜色风格 RTL 行为不一致。
- **L7 · 选择模式 connector tick 过冲 16px** — `css/neat.css:3738-3740` + `:4196`：选择模式移除 16px `::before` 占位后槽位移到 52px，但 tick 47.5+20.5=68px 越过 favicon 槽左缘，从图标底下穿过。
- **L8 · meta 双重读取冗余** — `src/actions.js:463-470`：context-menu 读出后以 title/color/folderId 传入，actions 再读覆盖（不可达兜底，无害）。
- **L9 · 加书签已存在路径 toast 语义不当** — `src/view-tabgroups.js:640-646`：URL 已收藏时 toast `quickAdded`（"已添加"）误导；stats 视图同场景静默翻转状态。正常路径下该行渲染实心 ★ 不会暴露此分支，属近不可达。
- **L10 · 拖拽体验弱于设计** — 设计 §7 声称"组头可拖拽移动整组"未实现（dragstart 只认 `li.tabgroups-row`）；drop 只接受行目标（不能投到组头/窗口头/空白区）；无树视图那样的插入位置线（现有 drag-over 顶部 2px accent 已接近）。

## 5. 体验与视觉抛光项（对标缺口）

- **P1 · 视图内标签过滤**（最大缺口）：工具栏加即时过滤输入框（标题/URL 子串匹配），组头/窗口头随匹配成员存亡。键盘模型 K14 规则（`keyboard.js:152`）已原生支持 `.vbm-toolbar` 内文本框（←/→/Home/End 走光标，↑/↓ 离框走 rung），`TOOLBAR_CONTROLS_SEL` 含 input 自动入 Tab 环——死链视图代理输入框是既有先例。零键盘模型改动风险。
- **P2 · 首次进入定位当前标签**：session 内首次激活渲染后 `scrollIntoView({block:'nearest'})`（设计 §7 承诺；`block:'nearest'` 保证已可见时不打扰）。
- **P3 · 留待后续**：音频/静音状态徽标、重复标签提示、Shift 范围选、批量 pin、组头拖拽整组、窗口自动命名——均记录在案，本轮不做（避免范围蔓延，见 §6）。

## 6. 修复决定

| 项 | 决定 | 说明 |
|---|---|---|
| H1 跨窗口聚焦 | **本轮修** | 新增统一 activate helper：tabs.update(active) + 非当前窗口时 windows.update(focused) |
| H2/P2 滚动定位当前标签 | **本轮修** | session 首次激活渲染后 nearest 滚动 |
| M1 meta 清理 | **本轮修** | 进 KNOWN_KEYS + census 表；refresh 时对存活文件夹 prune（getTree 顺路收集 folder id），覆盖一切删除路径 |
| M2+L1 SW 容错/降级 | **本轮修** | close/discard 逐调用吞 lastError；open-into 组消失 → copyTabs 降级 plainOpen；move-new-window 失败关空窗 |
| M3 组头菜单 sleep 标签 | **本轮修** | open 分支随 isGroupAsleep 刷新 |
| M4 closed 菜单 hover | **本轮修** | 补绑 mousemove/mouseout |
| M5 clear 按钮 | **本轮修** | 移入工具栏第二行（有记录才显示），ConfirmDialog 确认——键盘可达 + 与死链视图同契约 |
| M6 ☆ 红色 | **本轮修** | 改默认色（hover 走通用背景） |
| M7 Delete 穿透 | **本轮修** | view keyup 吞掉本视图一切结构行/非行目标的 Delete |
| L2/L3/L4/L5/L6/L7/L9 | **本轮修** | 低成本一致性收尾 |
| L8 meta 双重读取 | 不修 | 无害冗余，改了反而增加回归面 |
| L10 组头拖拽/投放目标 | **留待** | 行为变更面大，需真实浏览器拖拽验证，单独任务 |
| P1 视图内过滤 | **本轮修** | 对标最大缺口；键盘模型零改动；i18n 走完整流程（en+zh_CN 实译 + translate --apply） |
| P3 音频徽标/重复检测/Shift 范围选/批量 pin | **留待** | 记录在案，下一轮功能迭代评估 |

## 7. 验证

- 每批次：`tests/view-tabgroups.test.js` + 受影响套件（context-menu/keyboard/storage-usage/dialogs/tab-groups-sw）+ `npm run lint` + `python3 scripts/i18n.py verify`。
- 全部完成后：`npm run test:run` 全绿 + `scripts/harness/run.sh --smoke-only` 真浏览器冒烟。
- H1/H2/P1 的真机行为（窗口聚焦、滚动定位、过滤手感）以真浏览器截屏套件 `shots-tabgroups-view.js` 复核。

---

## 附录 A · 竞品调研要点（来源）

- Chrome 标签组/保存组/Tab Search：support.google.com/chrome/answer/2391819；Tab Search 仅子串匹配、约 25 条最近关闭、当前窗口范围。
- Tab Manager Plus（ghacks.net/2020/03/30/…tab-manager-plus…）：跨窗口 favicon 网格、窗格间拖拽移动、即时高亮过滤、重复标签高亮、discard、四种密度。
- Workona（workona.com/help/tab-manager/）：space 切换即隐藏/恢复整套标签、Shift 进入多选 + 单键操作、按域名/字母排序、关闭重复标签、一键 Suspend all、每小时快照。
- Session Buddy（sessionbuddy.com）：会话保存/崩溃恢复、搜索打开中+已保存标签、多格式导出、明暗双主题。
- Toby：看板式 collection/space，重颜值轻密度，免费 60 标签上限。
- OneTab：一键收纳纯文本列表，刻意单点。
- Sidebery（Firefox AMO）：垂直标签树、自动快照、Close duplicate tabs、全键盘流。

---

## 附录 B · 修复记录（2026-08-22，全部落地）

按批次就地提交（每批含测试）：

| 批次 | commit | 内容 |
|---|---|---|
| 1 | `b2a8d37` | H1 跨窗口激活聚焦（统一 `focusTab` helper：tabs.update(active) + 非当前窗口时 windows.update(focused)，覆盖行点击/中键/activateTab/activateGroup）；H2 首次激活滚动到当前标签（`block:'nearest'`，session 一次）；M7 结构行 Delete 守卫（INPUT/TEXTAREA/SELECT 豁免）；L9 已收藏静默翻转 |
| 2 | `07c6cfc` | M2 closeTabs/discardTabs lastError 吞错；L1 open-into 组消失 → copyTabs 降级 plainOpen、createCopy 窗口消失重试当前窗口、moveTabsToNewWindow 批量失败逐个重试 + 全失败关空窗；测试 double 修正为忠实的逐调用 lastError 语义 |
| 3 | `6b0f53d` | M3 组头菜单 sleep 标签随 isGroupAsleep 刷新（补上了该分支从零开始的测试覆盖）；M4 两个 closed 菜单 + viewTabMenu 补绑 hover 聚焦；L2 tab-row 分支 el 归一化到行锚点；L5 i18n 初始标签补 tab-row-pin/tabgroup-collapse |
| 4 | `601f3a2` | M1 新增 `pruneTabGroupFolderMeta`，视图 refresh 的书签树遍历顺路收集存活文件夹 id 并 prune（覆盖一切删除路径）；键入 `KNOWN_KEYS` + census 决策表，注释说明常量间接写法绕过字面量扫描的教训 |
| 5 | `40effe8` | M6 ☆ 按钮删除 danger 红（继承 .row-btn 语言，与 stats 视图一致）；L7 选择模式 connector tick 20.5px→4.5px（过冲 16px 穿过 favicon 的几何修正）；L6 edge 色条 RTL 镜像；L3 BookmarkFolderPickDialog ↑/↓/Home/End 行导航；L4 keyboard.js 注释修正 |
| 6 | `22e3e27` + `00b2f94` | M5 清空按钮移入工具栏第二行（有记录才渲染、ConfirmDialog 确认，键盘可达）；P1 工具栏即时过滤器（标题/URL 子串、窗口 pill 计可见数、过滤期间折叠置惰且折叠按钮置灰、进入选择模式清过滤、无匹配空态）。修正：Esc 清过滤不能挂在 $list capture（keyboard.js 的文档级 Esc capture 总是先吃掉该键）——落在视图 `onEscape` 最内层；i18n 三新键全 locale 落地（verify 0 错误） |

## 附录 C · 门禁追加发现：menu-extreme 既有失败（与标签组无关，已修）

全量门禁在 `verify-menu-extreme.js`（极限缩放×分辨率菜单扫描）挂 7 例：高缩放组合下文件夹菜单 `rect.l=-2`（左缘越出视口 2px）。**基线 `ecfd3e0` 同现同参**（逐字节一致的 rect），证实为既有缺陷，非本轮改动引入。

根因（Docker 内逐组合探针定位）：

1. 极限页面缩放下 popup body（min-width 320px）宽于窗口（200 CSS px），文档可横向滚动；
2. 页面加载时搜索框启动聚焦在分数几何下把文档预滚 `scrollX=2`（探针证实：菜单打开前 `preOpen.x=2`，activeElement=search-input）；
3. `positionMenu`（`src/context-menu.js`）的位置钳制基于 `[0, innerWidth]` 视口坐标，未计入 `scrollX/scrollY` —— 菜单 style.left=0 正确，但可见区在文档坐标是 [2, 202]，菜单左缘 2px 被裁。

修复（`src/context-menu.js`）：钳制全部改为滚动感知的文档坐标（`[scrollX, scrollX+winW]`，Y 同理 `[menuMinY, scrollY+viewportH]`，flyout 的 fitsRight/fitsLeft 同改）；同时菜单聚焦改 `focus({ preventScroll: true })`——已被钳制在视口内的菜单不需要 focus 滚动，杜绝该类副作用。`preventScroll` 本身不能修本例（滚动发生在菜单打开之前），它防的是同类复发。

验证：`verify-menu-extreme` 全量重跑结果记录在提交信息。

顺带发现的环境问题（已处理/已记录）：

- smoke.js 的 favicon 画廊段在本机有外网的沙箱里被真实 enrichment 抢跑（expected 1 card, got 3）——已在 smoke 起始处关闭 `faviconEnrich`/`faviconEnrichAgg` 使门禁确定（`cdb7d7d`）。
- 截图套件仍用 `networkidle0`（与 smoke 的教训相反，见 AGENTS 门禁注意事项③），在有外网但不畅的主机上 30s 导航超时——本次只修了 `shots-tabgroups-view.js`（本特性覆盖套件）；其余 shots-*.js 同待改（记录，未动）。
- 同套件的宽窄一致性探针只能验窄态：popup body 默认固定 320px（css/neat.css），不调 `popupWidth` 存储时 640px 视口下容器仍是 320，`@container (min-width:480px)` 永不触发——宽态断言在基线上同样失败（既有）。已修：探针先写 `popupWidth` 再 reload，宽窄两态都是真布局。

验证：`npm run test:run` 2638 例全绿；`npm run lint` 干净；`i18n.py verify` 0 错误；Docker 全量门禁终验（2026-08-22，HEAD=013629a 前的全部代码）**ALL PASS**：smoke（NO PAGE ERRORS，favicons 段 1 card 稳定）、verify-keyboard、verify-scrollbars（752 断言）、verify-menu-overflow/collapse/extreme/overlong/rightclick-repeat（menu-extreme 81 断言全过——含此前挂掉的 7 例）。`shots-tabgroups-view` 套件 34–44 号图全过（含修复后的真宽窄两态断言）。

设计文档侧的行为变化已在 `docs/plan-4.1.0/tab-groups-view-design.md` §16 登记。
