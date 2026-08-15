# v4 发布后反馈 issue 处理情况（#46–#52、#33/#30/#41）· Post-v4 issue feedback

针对 v4 发布后提交的 issue 逐一说明处理结论。除 #48 外全部已解决，修复均在 **v4.0.1**——该版本**已提交 Chrome 商店审核，预计 1–2 天内发布**（以静默补丁形式，4.0→4.0.1 不弹"新版本"卡）。

Status of the issues filed after the v4 release. All but #48 are resolved, and every fix ships in **v4.0.1 — already submitted to the Chrome Web Store for review, expected within 1–2 days** (a silent patch: 4.0 → 4.0.1 shows no "new version" card).

---

## 已解决 · Resolved

## #46 — Folder search access seems broken ✅ 已解决 / Resolved

**问题**：搜索结果/命令面板里点击文件夹行不会在 popup 内展开，反而像是打开了一个带同样搜索结果的页面。

**修复**（v4.0.1）：文件夹行判定从整串 class 精确匹配（`el.className === "link-folder"`）改为成员测试（`classList.contains`，与右键菜单一致）。点击文件夹搜索结果现在正确执行 `revealInTree`，留在 popup 内。

**Problem**: clicking a folder row in the search results did not reveal it inside the popup — it opened a page with the same search results instead.

**Fixed in 4.0.1**: folder-row detection now uses a `classList.contains` membership test (matching the context menu) instead of an exact whole-string class match, so a folder result runs `revealInTree` in place.

---

## #47 — Count badge styles in stats tab look broken for "by recent" ✅ 已解决 / Resolved

**问题**：stats 视图按 "by recent" 排序时，徽章槽里放的是相对时间，被共享的 `.row-badge` 药丸几何压成无底色、居中的小号文本，看起来像坏了（计数数值本身没错）。

**修复**（v4.0.1）：`.row-badge.time` 重置药丸几何为普通弱化文本——`height:auto`、无圆角、12px、左对齐、muted 色，与右侧路径列排版一致。

**Problem**: in the Stats view's "by recent" sort, the badge slot holds the relative time, and the shared `.row-badge` pill geometry squeezed it into a tiny transparent centered pill (the count values themselves were always correct).

**Fixed in 4.0.1**: `.row-badge.time` now resets the pill geometry to plain muted text — auto height, no radius, 12px, left-aligned — matching the path column.

---

## #49 — Right-click menu (remove the "Bookmark this page" entry) ✅ 已解决 / Resolved

**问题**：v4 在页面右键菜单新增了"用 vBookmarks 收藏此页"条目且无法移除。

**修复**（4.0.1）：选项页 **Views 组新增独立开关**「在页面右键菜单添加'用 vBookmarks 收藏此页'条目」（默认开）。关闭立即移除该条目（service worker 监听 `chrome.storage.onChanged` 实时生效），并纳入"一键恢复经典界面"预设。

**Problem**: v4 added a "Bookmark this page with vBookmarks" entry to the page right-click menu with no way to remove it.

**Fixed in 4.0.1**: a dedicated **Views-group toggle** (`quickAddContextMenu`, on by default). Turning it off removes the entry live via a storage listener, and the "Restore the classic header" preset covers it too.

---

## #50 — Middle-click won't keep the popup open ✅ 已解决 / Resolved（已由维护者关闭 / closed by maintainer）

**问题**：中键/后台打开书签也会关闭 popup（即使"保持打开"关闭）。

**修复**（v4.0.1）：后台打开不再强制关闭 popup，只有**前台**打开遵循"保持打开"设置——与文件夹"全部打开"行为一致。

**Problem**: middle-clicking a bookmark closed the popup even with the "keep open" setting off.

**Fixed in 4.0.1**: background opens no longer force-close the popup — only foreground opens honor the "stay open" setting, matching the folder open-all behavior.

---

## #51 — Resizing issue ✅ 已解决 / Resolved

**问题**：popup 尺寸拖动后无法恢复——手动调小后高度被 auto-height 重新拉回（只能越来越大）；拉宽后宽度又缩不回去、且柄很难再抓到（只能一直变小）。

**修复**（v4.0.1）：手动拖过 popup 边缘后 auto-height 整个会话让位，不再被树点击拉回；并根治宽度拖动三处真实根因——拖动改 **pointer 事件驱动 + `setPointerCapture`**（指针离开窗口不断流、不卡死）、拖完 **同步 `flush()` 持久化**（关/重开宽度正确恢复）、屏内留**可抓余量 + 同步设根元素宽度**（双向跟手、永不贴边）。真实 popup 实测双向拖动跟手、关/重开恢复正确。

**Problem**: after resizing the popup by hand the size was hard or impossible to restore — a manually shrunken height kept being re-grown by auto-height, and a widened width could not be dragged back down (the handle became unreachable).

**Fixed in 4.0.1**: manual edge-drags now disable auto-height for the session; the width-drag root causes are fixed — pointer events with `setPointerCapture` (no dropped mouseup / stuck state), synchronous `flush()` persistence on release (correct width on reopen), and an on-screen grab margin plus syncing the root element width (dragging follows both ways, never pinned to the edge).

---

## #52 — Custom icon fails to persist on browser restart ✅ 已解决 / Resolved

**问题**：自定义工具图标在浏览器重启后丢失，需手动重新选择。

**修复**（v4.0.1）：`chrome.action.setIcon` 是**会话级**设置，重启即失效——service worker 现在每次冷启动（含 `onStartup`/`onInstalled`）从存储读取图标数据重建，浏览器重启不再回退到默认图标。

**Problem**: the custom toolbar icon was lost after a browser restart, requiring a manual re-selection.

**Fixed in 4.0.1**: `chrome.action.setIcon` is session-scoped, so the service worker now rebuilds the icon from storage on every cold start (`onStartup`/`onInstalled`), no longer falling back to the manifest icon.

---

## #33 — Add ability to SORT folder contents ✅ 已实现 / Implemented（4.0.1）

**问题**：希望支持对文件夹内容排序。

**修复**（v4.0.1）：文件夹右键菜单新增**按名称排序 / 按添加日期排序**直接命令（递归时标注 "(recursive)"），另有 **Sort options…**；选项页新增 **Sorting** 组编辑同一持久化配置（by / folders-first / recursive）。排序**物理重排**书签（重启后保留），且任何排序——含递归——都可通过 toast **撤销**（逐层回放排序前快照）。

**Problem**: request for the ability to sort folder contents.

**Implemented in 4.0.1**: the folder menu now offers **Sort by name / Sort by date added** (recursive sorts marked "(recursive)") plus **Sort options…**; a new options-page **Sorting** group edits the same persisted `sortOptions`. Sorting physically reorders the bookmarks (survives restarts) and every sort — recursive ones included — is undoable via the toast.

---

## #30 — provide way to quickly add bookmark ✅ 已实现 / Implemented（v4.0）

**问题**：希望提供快速收藏当前页面的方式。

**修复**（v4.0，已随 4.0 发布）：搜索框旁的**快速收藏星标按钮**（已收藏则转编辑对话框）、**Ctrl/Cmd+D** 捕获、全局快捷键 **Alt+Shift+S**；三个入口都可在选项页关闭。

**Problem**: request for a quick way to bookmark the current page.

**Implemented in v4.0** (already shipped): a **quick-add star button** beside the search box (bookmarks the active tab; if already bookmarked it opens the edit dialog), a captured **Ctrl/Cmd+D**, and the global **Alt+Shift+S** shortcut — all toggleable in the options page.

---

## #41 — Keep tab open when middle-clicking search results ✅ 已解决 / Resolved（4.0.1）

**问题**：中键点击**搜索结果**会关闭 popup（树视图里中键能保持打开）。

**修复**（v4.0.1）：搜索结果面板补上了 `auxclick` 绑定（与树视图同一套打开语义）；叠加 #50 的修复——**后台打开不再强制关闭 popup**——中键点击搜索结果现在始终后台开新标签页并保持 popup 打开。

**Problem**: middle-clicking a **search result** closed the popup, while middle-clicking in the tree kept it open.

**Fixed in 4.0.1**: the search-results pane now binds `auxclick` (same open semantics as the tree), and together with the #50 fix — background opens no longer force-close the popup — middle-clicking a search result now opens a background tab and keeps the popup open.

---

## 已解决（后续定位）· Resolved（later diagnosis）—— 原为"需更多信息"

## #48 — Right-clicking a folder no longer brings up options ✅ 已解决 / Resolved（后续版本，非 4.0.1）

**最初无法复现**，靠诊断探针（`scripts/console/probe-folder-menu.js`）收集报告者环境后定位。eamondaly 反馈"页面缩放高于 90% 就坏（实测 100% 必坏）"，brunoosti 反馈"降到 100% 以下右键书签能弹、文件夹不行"。eamondaly 的 probe 日志给出铁证：每次右键 `CTXMENU` verdict=FOLDER、处理器执行到 `menu.focus()`，**但紧随一条 `SCROLL` 事件，随后菜单 `shown:false` / `active:null`**——菜单被打开后**立即被滚动事件关闭**。

**根因**：context 菜单按内容渲染，在 Windows 150% 显示缩放 / 页面缩放 ≥ ~90% 下，19 项文件夹菜单高达 ~762px，**超过 popup 视口（~599px）**。菜单定位后 `menu.focus()` 触发浏览器"滚动到可见"，把文档滚出 ~16px——而 scroll 正是 `clearMenu` 的关闭触发点，于是菜单"闪开即关"，表现为"右键没反应"。低缩放时书签菜单（较短）恰好能放下所以正常，文件夹菜单（最长）始终溢出——与 brunoosti 的观察完全吻合。

**修复**（后续版本）：打开菜单时先把高度 clamp 到搜索栏下方的可用空间（`max-height` + `overflow-y:auto` 内部滚动，并扣除菜单自身 padding/border 的 chrome），菜单永远装得下 → `menu.focus()` 不再滚动文档 → 不再被 scroll 关闭。真实浏览器复现/校验由 `scripts/harness/verify-menu-overflow.js` 覆盖（修复前 `docScrollY:16` 菜单被关、修复后 `docScrollY:0` 菜单保持），vitest 新增 2 例回归。

**Problem**: right-clicking a folder (and at higher zoom, any row) appeared to "do nothing".

**Root cause** (via the diagnostic probe's logs): the context menu is sized to its content — at Windows 150% display scaling / page zoom ≥ ~90% the 19-item folder menu reaches ~762px, taller than the ~599px popup viewport. After positioning, `menu.focus()` scrolls the document to reveal the overflow; that scroll is one of the menu's dismiss triggers, so the menu closed the instant it opened. Short menus (bookmark) fit and worked; the tall folder menu always overflowed — matching both reporters' zoom observations.

**Fixed in a later build**: the menu is now clamped to the space below the search bar (`max-height` + internal `overflow-y: auto`, minus the menu's own padding/border chrome) so it always fits and `focus()` never scrolls the page. Reproduced and verified in the real-browser harness (`scripts/harness/verify-menu-overflow.js`: before the fix `docScrollY:16` and the menu closed; after, `docScrollY:0` and it stays open), plus two vitest regression cases.

**后续优化（同一批）**：为低分辨率/高缩放用户新增两个选项——「折叠标签组菜单」（默认关，文件夹+书签菜单的标签组 3 项收进 "Tab groups ▸" 子菜单）与「折叠排序菜单」（默认开，文件夹菜单的排序 3 项收进 "Sort ▸" 子菜单），进一步缩短主菜单。子菜单为原生飞入（入口右侧/RTL 左侧、溢出翻转、复用 #48 clamp），悬停/点击/键盘 `→` 展开、`←`/Esc 两级关闭；`scripts/harness/verify-menu-collapse.js` 真实浏览器校验。

---

## 附：自动依赖 PR · Automated dependency PRs

#43、#45、#55 是 Dependabot 自动提交的依赖升级 PR（esbuild / vite / postcss 等开发依赖），非功能问题，无需人工处理。

#43 / #45 / #55 are automated Dependabot dependency-bump PRs (dev dependencies: esbuild / vite / postcss), not functional issues — no manual action needed.
