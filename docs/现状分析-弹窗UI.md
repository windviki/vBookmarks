# 现状分析：弹窗主界面（popup / neat.js）

> 调研日期：2026-07-17。只读分析，所有结论附 `文件:行号` 证据。
> 本文是 vBookmarks 现代化演进分析的分维度文档之一，姊妹篇：
> 《现状分析-架构与存储.md》《趋势调研-MV3平台与书签品类.md》《现代化演进总方案.md》。

## 1. neat.js 整体结构

整个文件是一个巨大的 IIFE（`neat.js:1-3229`），无模块划分，全部状态靠闭包变量和 `localStorage` 共享。按行号可划分为：

| Section | 行号 | 职责 |
|---|---|---|
| 工具/数据类 | 10-293 | `StringList`(10)、`SeparatorManager`(68)、`colorHex/colorRgb`(145,178)、`Math.uuid/uuidFast`(202,234)、`copyToClipboard`(255)、`TreeText`(267，死代码) |
| 对话框与错误 | 297-311 | `AlertDialog` + `window.onerror` 全局兜底(309) |
| 环境探测 | 313-328 | `navigator.platform` 检测 OS(314)、UA 正则解析 Chrome 版本(321) |
| i18n 初始化 | 330-371 | 手动逐个 `$(id).textContent = _m(msg)` 填充菜单/对话框文案 |
| HTML 生成器 | 384-559 | `adaptBookmarkTooltips`(385)、`getFaviconUrl`(409)、`generateBookmarkHTML/Folder/Separator/HTML`(418-559) |
| 树构建/双存储适配 | 561-780 | `nodeTrees`/`getParentPath`(582,597)、`findFolderByType`/`getEffectiveSubTree`/`isRootFolder`/`canMoveBetweenStorage`(617-714)、`generateTree`(716) |
| 初始化入口 | 782-787 | 恢复高度(783)、`chrome.bookmarks.getTree(generateTree)`(787) —— 真正的启动点 |
| 树事件 | 789-855 | scroll/focus/click（文件夹展开收起）/mouseup |
| 捐赠横幅 | 879-952 | 版本比较 + 倒计时按钮 |
| 搜索 | 954-1164 | `search()`(987)、`quitSearchMode()`(961)、输入事件(1091-1164) |
| 自动高度 | 1166-1204 | `resetHeight()` |
| 三个对话框 | 1206-1326 | `ConfirmDialog`(1207)、`EditDialog`(1232)、`NewFolderDialog`(1280)，全靠 `body` 上 `needConfirm/needEdit/needInputName` class 切换显隐 |
| 节点增删 | 1328-1450 | `addNodeTo/addFolderTo/addNewNode` |
| actions 动作表 | 1454-1757 | `openBookmark`、`openBookmarkNewTab/NewWindow`、`openBookmarks`（批量）、`editBookmarkFolder`(1625)、`deleteBookmark/deleteBookmarks`(1699,1718)、`replaceUrl`(1561)、`copyAllTitlesAndUrls`(1554) |
| 点击路由 | 1776-1842 | `bookmarkHandler` 统一处理 tree/results 的 click/auxclick，区分 ctrl/meta/shift/中键 |
| 右键菜单 | 1866-2182 | 三套菜单的显示定位(1905)、handler(1967,2056,2162)、Mac 长按关闭 hack(1959) |
| 键盘导航 | 2184-2571 | 树导航 `treeKeyDown`(2187)、Delete 键 `treeKeyUp`(2450)、菜单导航 `contextKeyDown`(2474) |
| 拖拽 | 2573-2867 | 纯 mouse 事件实现（非 HTML5 DnD） |
| 尺寸拖拽 | 2869-2967 | x/y resizer + `resetSeparator` |
| 全局快捷键 | 2969-3059 | Esc 关对话框(2981)、Ctrl/Cmd+F(2998)、缩放(3015-3059) |
| 兼容性补丁 | 3061-3111 | Chrome 536 bug(3062)、Mac 滚动修正(3066)、`userstyle` 注入(3074)、自定义图标(3102) |
| 同步状态 | 3113-3229 | `initializeSyncControls`、`updateBookmarkSyncStatus`(3128)、`refreshSyncIndicators`(3170)、`window.neat` 暴露(3214) |

**初始化流程**：popup.html 顺序加载 neatools.js → storage.js → popup.js → sync-manager.js → neat.js（`popup.html:104-108`）。neat.js 在脚本执行时同步完成：i18n 填充 → localStorage 读配置 → `chrome.bookmarks.getTree(generateTree)` 异步回调里构建整棵树 HTML 并 `$tree.innerHTML = html`(734) → 恢复 scrollTop(744)/focusID(747) → `resetHeight()` 自动调高。popup.js 独立地通过 `chrome.storage.local` 恢复宽高（`popup.js:9-22`）。

**渲染方式**：纯字符串拼 HTML。`generateHTML`(506-559) 递归把书签树拼成一个巨大字符串，一次性 `innerHTML` 注入；文件夹子树在未展开时不渲染（懒加载，530-545 只对"记忆为打开"的文件夹递归，否则点击时 `chrome.bookmarks.getChildren` 再拼一段 `div.innerHTML` 注入，823-831）。**无模板引擎、无虚拟滚动、无 DocumentFragment**。事件绑定采用**事件委托**为主：`$tree.addEventListener('click', bookmarkHandler)`(1839)、keydown(2447) 等挂在容器上，靠 `e.target.tagName` 判断；对话框按钮、菜单项则是逐个直接绑定。

## 2. 用户可见功能清单

- **树操作**
  - 点击 SPAN 展开/收起文件夹（806-845)，含懒加载子树（821-831)
  - "手风琴"模式 `closeUnusedFolders`：展开时自动收起同级（833-841)
  - 状态记忆：打开的文件夹列表存 `localStorage.opens`(379,844)、scrollTop(790-792)、focusID(793-804)、搜索词(1159-1164)
  - 只显示书签栏模式 `onlyShowBMBar`(382,718-726)
  - 自适应 tooltip：标题溢出时 title 变为"标题+URL"(385-407)
- **搜索**(987-1089)
  - `chrome.bookmarks.search` 原生匹配（子串，非模糊）+ 自写排序：标题命中位置优先 → 自造正则 `^关键词.*`（空格转 `.*`，1004）优先 → dateAdded 排序（1005-1031)
  - 结果截断 100 条（1032)；排除分隔符（1039)；文件夹结果可点击跳回树中定位（1789-1803，整棵树重建）
  - 选项 `searchAfterEnter`（回车才搜，955,994)；输入即搜（1091)；Esc 清空不关闭弹窗（1142-1148)；回车聚焦首条结果并模拟点击（1110-1126)；搜索框聚焦时首条结果高亮（CSS `.searchFocus`, `neat.css:294`)
  - 为每条结果异步补"父文件夹"tooltip(1071-1083)
- **右键菜单**（自绘 `<menu type="context">`，非原生）
  - 书签菜单（`popup.html:24-43`, handler 1967-2044)：在书签前/后添加当前页、在书签前/后新建文件夹、添加分隔符、替换 URL 为当前页、新标签/新窗口/隐身窗口打开、编辑、删除、复制标题和 URL
  - 文件夹菜单（`popup.html:44-66`, handler 2056-2150)：顶部/底部添加书签、新建文件夹、前/后添加书签、前/后添加文件夹、添加分隔符、全部打开（标签页/新窗口/隐身）、编辑、删除；根目录文件夹隐藏编辑项（`hide-editables`, 1922-1926)
  - 分隔符菜单（`popup.html:67-69`)：仅"移除分隔符"
  - 菜单自身支持键盘导航（2474-2553)、鼠标划过聚焦（2558-2563)、Mac 长按右键关闭 hack(1959-1965)
- **对话框**：Alert（全局错误，298)、Confirm（批量打开>10 个确认 1591/1611、删除文件夹确认 1731)、Edit（编辑书签/文件夹，1232,1640)、NewFolder(1280)。统一用 `#cover` 遮罩 + body class 显隐，Esc/点遮罩关闭（2970-3004)
- **键盘导航**(2184-2471)：上下左右（左右=展开收起/回父级/RTL 反转）、Home/End、PageUp/PageDown、Space/Enter 打开、**F2 编辑**(2389)、**Delete 删除**(2450-2471)、**打字搜索定位**(type-ahead,500ms 缓冲，2399-2444)、Ctrl/Cmd+F 聚焦搜索框(2998)、Cmd+↑/↓=Home/End(Mac,2195-2198)
- **拖拽排序**(2573-2867)：左键按住拖出克隆影像（`#bookmark-clone`)、落点指示线/文件夹高亮框（`#drop-overlay`)、上下边缘 10px 自动滚动（2640-2662)、文件夹 30%/70% 热区决定"插入前/后"还是"放入其中"(2701-2707)、禁止拖根文件夹（2590, `isDOMElementRootFolder`)、跨存储空间（同步/本地）移动检查并 `alert()` 拦截（2784,2821,2838)、zoom 级别补偿坐标（2669)
- **分隔符**：以 `http://separatethis.com/#uuid` 伪书签实现（561-565)；识别靠 URL 前缀+关键字列表 `separatorString`(125-138)；自定义标题/颜色（`localStorage.separatorTitle/separatorcolor`,70-85,491)；`<hr>` 宽度按窗口宽度动态算（495-496)、resize/拖拽后 `resetSeparator` 重算（2880-2897)；旧版本分隔符列表迁移逻辑（766-777)
- **同步状态指示**：favicon 右下角 6px 圆点（synced 绿/unsynced 橙/syncing 蓝脉冲/sync-error 红/local 灰/unsyncable 浅灰，`sync-styles.css:29-59`）+ 悬浮 tooltip；开关 `localStorage.showSyncStatus`(436,3219)；监听 `syncStatusChanged` 自定义事件局部更新（3117-3123)；非同步文件夹标题加 `" (Local)"` 后缀（461-465)
- **其他**：弹窗边缘拖拽改宽（320-640px）高（240-600px)(2900-2967)、Ctrl+滚轮/+-/0 缩放 90%-150%(3015-3059)、`__VBM_CURRENT_TAB_URL__` 占位符（1452)、bookmarklet 执行（1477-1484)、捐赠横幅+倒计时按钮（917-952)、自定义 CSS 注入（3074-3078)、自定义工具栏图标 canvas 写入（3102-3111)

## 3. UI/UX 关键细节

- **图标体系**：纯位图。favicon 走 Chrome `_favicon` 私有 API：`chrome.runtime.getURL("/_favicon/") + ?pageUrl=&size=32`(409-416，需 manifest `favicon` 权限+`web_accessible_resources`, `manifest.json:42,46-49`)；文件夹固定 `folder.png`(482)；`javascript:` bookmarklet 用 `document-code.png`(429)；同步状态是 CSS 圆点非图标。`<img>` 全部硬编码 `width="16" height="16"`(448,483)，无 2x 高分屏适配（请求 size=32 但显示 16，算半个 retina 方案）
- **字体/配色/尺寸硬编码**：`font: menu` 系统字体（`neat.css:3`），但 Linux 强制 12px(16-18)；配色全部硬编码——背景 `#f8f9fa`(173)、选中态蓝渐变 `#6fa6de→#1e6cbb`(287)、twisty 三角 `#84919f`(221)、焦点 `#4687cb`(286)；行高 `1.67em`(199)、缩进 `14px/level`(509 及 1349)、body 默认 320×600(12-13)
- **深色模式**：neat.css 全文**无任何** `prefers-color-scheme`，纯白底写死；仅 `sync-styles.css:566-604` 有暗色媒体查询，但作用对象 `#sync-controls/.sync-btn/.sync-filter-btn/.sync-stat-item` 这些元素**在 popup.html 中根本不存在**，等于没有暗色支持
- **动效**：twisty 旋转 `.15s`(`neat.css:224`)；定位到书签的 `blueFade` 3s 蓝闪（313-343)；对话框/遮罩 opacity+top `.3s`(479-514)；菜单 opacity `.3s`(398)；body 高度过渡（上快下慢，`.3s`/`.1s`, 1193)；同步点 `pulse` 1.5s 脉冲（`sync-styles.css:61`)。`body.transitional` class 延迟 10ms 加载避免初始跳动（3007-3009)
- **弹窗尺寸恢复**：双轨且互相冲突——popup.js 用 `chrome.storage.local` 读 `popupHeight/popupWidth` 且高度 clamp 600(`popup.js:9-22`)；neat.js:783 又同步直读 `localStorage.popupHeight` 覆盖一次。`resetHeight()`(1167-1198) 按内容高度自适应，受 `autoResizePopup` 开关、zoom、屏幕剩余空间（`screen.height - screenY - 50`）约束，300-600 区间
- **滚动处理**：`#tree` 溢出滚动，scroll 事件里**每次同步写 localStorage.scrollTop**(790-792)；拖拽时 setInterval 自动滚动（2648-2659)；自绘 webkit 滚动条 8px(`neat.css:607-628`)；禁用中键自动滚动（1861-1864)
- **空状态/加载态**：**均无**。搜索无结果时只渲染空 `<ul>`，无任何"无结果"提示（1034-1069)；树加载期间白屏，无 loading/骨架屏；空文件夹打开行为无反馈（ctrl+点击文件夹无 URL 时直接 return,1829)

## 4. 技术债与体验短板（含证据）

- **localStorage 直读直写泛滥**：neat.js 中 89 处 `localStorage`。配置读取（379-382,436,805,955,1455-1460)、高频写入——每次滚动（791)、每次文件夹开合（844)、resize 每帧 mousemove 写（2937,2950,2957)。且与 popup.js/storage.js 的 `chrome.storage.local` 形成**双存储体系**，popupHeight 两处读写口径不一（`popup.js:9` vs `neat.js:783,1195`）。storage.js 本身 `StorageManager` class **重复定义了两遍**（6-75 与 94-164），直接导致解析失败（见架构篇）
- **innerHTML 注入面**：整树 `$tree.innerHTML = html`(734)、搜索结果（1068)、编辑后节点替换（1657,1690)。标题/URL 用自写 `htmlspecialchars()` 转义（`neatools.js:38`)，但 **syncTooltip 未转义直接拼进 title 属性和 innerHTML**(440-442,3146,3191)；对话框文本走 innerHTML(302,1211,1236)——依赖 i18n 文案可信；`generateSeparatorHTML` 存在**真实 bug**：`hrStyle` 里 `width=${hrWidth}px` 用了 `=` 而非 `:`(496)，且模板多出 stray 引号 `${hrStyle}">`(502)；搜索结果 `role="listitem""` 双引号笔误（1056)
- **同步渲染/布局抖动**：搜索文件夹跳转时 `chrome.bookmarks.getTree` **整树重建**(1803)；`adaptBookmarkTooltips` 遍历所有可见节点逐个读 `scrollWidth/offsetWidth` 强制同步布局（385-407)，且每次展开后 setTimeout 再跑一遍（830)；无 `requestAnimationFrame`、无防抖（搜索 input 事件无 debounce,1091)
- **无虚拟滚动**：打开的文件夹全部真实 DOM；搜索结果上限 100 条只是硬截断（1032)
- **可访问性缺失**：选中态去除 `outline`(`neat.css:203`）搜索框 `outline-width: 0`(100-102)；右键菜单用已被废弃/从未实现的 `<menu type="context">`，菜单项是 `<div>` 无 `role="menu/menuitem"`(`popup.html:24-69`)；树有 `role=tree/treeitem/aria-expanded`(511,526-527）但无 `aria-label`/`aria-level`/`aria-posinset`，层级靠非标准 `level` 属性（527)；对话框仅 `role="dialog"` 无 `aria-modal`、无焦点圈禁；跨存储拦截用原生 `alert()`(2788,2825,2842)
- **废弃/非标准 API**：`-webkit-padding-start`(509,2763)、CSS `zoom` 属性做缩放（`neat.css:25-58`)、2009 版 flexbox `display:-webkit-box`/`box-flex`(70-79,179)、`document.execCommand("Copy")`(262)、`navigator.platform`/UA sniffing(314,321)、`-webkit-gradient`(287)、`::-webkit-scrollbar`(607)
- **脆弱代码**：`version.build >= 536`(3062)——UA 不匹配时 `version` 为 null 直接抛 TypeError（靠 309 的全局 error 弹窗兜底）；`TreeText.get` 里 `'\t' * level` 在 JS 中是 NaN(285,287)，"复制标题和 URL"功能实际产出残破；`popup.html:11` 把 `<li>` 直接放进 `<div>`；`$each` 遍历对象时给 button 填文本但 donation 按钮用 innerHTML 填秒数（935)
- **全局原型污染**：`String.prototype.colorHex/colorRgb`(145,178)、`Math.uuid`(202)，加上 neatools.js 对 String/Array/Element 原型的大面积扩展，现代化时全是隐性依赖

## 5. neatools.js "伪框架"能力与现代替代

明确定位："a nano JavaScript framework made just for vBookmarks… Heavily inspired by MooTools. Works for Chrome 8 and above"（`neatools.js:1-5`）。

| neatools 提供 | 位置 | 现代替代 |
|---|---|---|
| `$(id)` | 7-9 | `document.getElementById`（原生同名行为），或直接保留 |
| `$extend(obj, ext)` 混入 | 11-15 | `Object.assign` |
| `$each(obj, fn, bind)` | 17-22 | `Object.entries` + `for…of` / `forEach` |
| `String.prototype.widont()`（末词防孤行） | 27-29 | 无直接原生替代，可保留为纯函数；或 CSS `text-wrap: pretty` |
| `String.prototype.toInt()` | 30-32 | `parseInt` / `Number` |
| `String.prototype.hyphenate()` | 33-37 | 一行 replace，纯函数即可 |
| `String.prototype.htmlspecialchars()` | 38-40 | **避免 innerHTML 就不用它**；`textContent` 赋值 / `<template>`；必须拼 HTML 时用 DOMPurify |
| `String.prototype.escapeRegExp()` | 41-43 | `RegExp.escape()`（ES2025 已标准化，Chrome 136+） |
| `Array.prototype.contains/clean/getLast` | 46-58 | `includes` / `filter(Boolean)` / `at(-1)` |
| `Array.map/filter/forEach` 泛型静态化 | 61-67 | 原生实例方法，neat.js 中 `Array.map(fn, list)` 写法（843,1827,2065）全部要改 |
| `Element.prototype.getComputedStyle(prop)` | 70-72 | `getComputedStyle(el).getPropertyValue()` |
| `destroy()` | 73-75 | `el.remove()` |
| `hasClass/addClass/removeClass/toggleClass` | 76-90 | `classList.contains/add/remove/toggle`（原生已全支持，且原生 toggleClass 不支持链式 `.removeClass().setAttribute()` 这种用法 neat.js:838,2667 需改写） |
| `getAllNext/getAllPrevious/getSiblings` | 91-109 | 简单 while 循环或 CSS 兄弟选择器 |
| `inject(el, where)` 四向插入 | 112-138 | `el.before/after/append/prepend` 或 `insertAdjacentElement` |
| `getPageZoom()` SVG `currentScale` hack | 140-156 | 已失效且**在 neat.js 中无调用**（死代码，可直接删） |

**改造要点**：这套框架最大的迁移成本不在 API 本身（全部有一一对应的原生替代），而在于它**扩展了内置原型**——neat.js 全篇隐式依赖这些 monkey-patch（如 `.colorHex()`、`.escapeRegExp()`、`.toInt()`、`.inject()`、链式 class 操作），现代化时需先全局搜索替换为纯函数/原生调用，再删除 neatools.js。

**补充歧义点**：搜索的实现是"Chrome 原生子串匹配 + 自写排序权重"，严格意义上不是模糊匹配；`copy-title-and-url` 菜单项调用的 `TreeText` 类（neat.js:267-293）含 NaN bug，功能半残；文件夹右键菜单中 `copy-all-titles-and-urls` 项在 HTML 中被注释掉（popup.html:64-65）但 handler 仍存在于 neat.js:2122。
