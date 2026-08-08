# 审阅报告 01:键盘导航与焦点管理 + harness 测试(7fea4d1..HEAD)

> 审阅日期:2026-08-07。用户重点关注区域。

## 编号问题清单

**1. [major] 菜单打开后首次 ↓ 死锁——入口分支未走 menuWalkable**
- 证据:`src/context-menu.js:384` 菜单打开时 `menu.focus()`(焦点在容器上,不在任何 menu-item);`src/keyboard.js:590` ArrowDown 的 else 分支直接 `item.firstElementChild.focus()`、`:603` ArrowUp 直接 `item.lastElementChild.focus()`,**都没用** `nextMenuTarget`。而 `pages/popup.html:40-43` 书签菜单前 4 个子节点(`reveal-in-tree`、分隔 hr、`dead-mark-toggle`、`dupes-set-keeper`)在树内行打开时全部 `display:none`(`src/context-menu.js:310/323/332`)。`display:none` 元素不可聚焦,focus() 是 no-op → 焦点永远停在容器 → **↓ 完全卡死**(按多少次都没反应;↑ 因最后一项 `bookmark-delete` 可见而能恢复)。dupes 组菜单同样中招:`dupes-group-clean` 无 hint 时 `display:none`(`src/context-menu.js:259`)且它是首子节点。sidepanel.html:41 结构相同。
- 6d27424/d0d83cf 修了"项间行走",却漏了"容器→首项"这个每个键盘用户打开菜单后的第一步。这正是这两次提交声称根治的同一类 bug。单测 `keyboard.test.js:1452` 测了该分支,但 double 的 `focus()` 永远成功,结构性掩盖;verify-keyboard.js 对上下文菜单键盘行走**零断言**。
- 修法:两个 else 分支改为 `nextMenuTarget(menu.firstElementChild, 1)?.focus()` / `nextMenuTarget(menu.lastElementChild, -1)?.focus()`;verify-keyboard.js 增加"→ 开菜单 → ↓ 落在第一个可见启用项"的浏览器级断言。

**2. [major] 1f84154 的 Esc 半边在生产环境无效——capture 监听注册顺序**
- 证据:palette 的 `onDocKey` 在 `open()` 时才 `document.addEventListener('keydown', onDocKey, true)`(`src/palette.js:730`);keyboard.js 的 Esc capture 链在 `initKeyboard` 时注册(`src/keyboard.js:710`),而 neat.js 同步执行顺序是 `initPalette`(neat.js:789)→ `initKeyboard`(neat.js:851),onDocKey 实际注册时刻**晚于** keyboard 的 Esc 链。keyboard 的 Esc 链对 Escape 无条件 `e.stopImmediatePropagation()`(keyboard.js:713-714)→ onDocKey 永远收不到 Escape。随后链条命中 `.active` 分支(keyboard.js:721-725):`active.focus()` 把焦点落到 palette 结果行、clearMenu 关菜单——**焦点滞留结果行、↑↓ 全死,正是 1f84154 声称修复的原 bug,Esc 路径原样保留**。(← 路径有效,因为 keyboard 的链对非 Escape 直接 return;提交里"浏览器复现验证"只验了 ←。)
- palette.test.js:1739 的 "Escape 关菜单保面板" 用例没加载 keyboard.js,测不出;focus-regression 的 `key()` 循环不检查 `propagationStopped`,也无法建模该顺序。
- 修法:keyboard.js 的 `.active` 分支在 `palette.isOpen()` 时委托 palette(新增 `palette.refocus()`:清 .active + 聚焦输入框);Esc 蛋糕归 keyboard 一家拥有,符合"一个 Esc 链"设计。或把 onDocKey 改为 init 时注册一次(加 `openState` 守卫),initPalette 先于 initKeyboard,自然排在 Esc 链之前。

**3. [major] F2 对根文件夹无守卫——对话框确认后抛异常**
- 证据:Delete 键已加根文件夹守卫(`src/keyboard.js:527-529`,注释明言与右键菜单 disabled delete 同源),但 F2 分支(keyboard.js:425-434)直接 `actions.editBookmarkFolder(id)`。`actions.js:547-553` 对根 id 调 `chrome.bookmarks.update` 必然失败,回调里 `n.title` 对 undefined 抛 TypeError。右键菜单的 `folder-edit` 在根上是禁用的(context-menu.js:82-93),键盘 F2 却绕过——同一次提交(6d27424 系列)引入的根目录保护在 keyboard.js 内部自相矛盾。
- 修法:F2 分支加与 Delete 相同的 `parent` + `parentid === '0'` 跳过;补一条 keyboard.test.js 用例。

**4. [major] f5903c8 的容器聚焦放大 treeKeyUp 的隐藏删除路径**
- 证据:f5903c8 让 `focusDefault` 在无行时 `def.listEl.focus()`(`src/view-manager.js:252-253`)。容器持焦时 `treeKeyUp` 的 Delete 会落到 `e.currentTarget.querySelector('.focus') || 第一行`(keyboard.js:508-512)。场景:Ctrl+4/5/6 切到异步渲染视图 → 容器持焦 → 行渲染出来 → 界面上**没有任何可见焦点指示**,按 Delete 删除第一行对应书签。删除虽可撤销(`actions.js:608` undo.capture + toast),但目标不可见、动作出人意料。该 keyup 回退是旧代码,但此前容器几乎不会被程序化聚焦——f5903c8 使其成为常态路径。
- 修法:容器持焦且列表无 `.focus` 标记时 Delete 不动作(去掉 `|| li a, li span` 回退,或仅当 `.focus` 存在时才删);同时补一条"容器持焦 Delete 不删行"用例。

**5. [minor] Ctrl/Cmd+F 无对话框守卫**
- 证据:`src/keyboard.js:792-800` 的 Ctrl+F 处理器不查 `dialogs.anyOpen()`。对话框打开时按 Ctrl+F 会把视图切到 search 并 `search.input.focus()`,焦点被拽出模态对话框(9888f8a 已给 Ctrl+数字补了同类守卫,Ctrl+F 漏了)。
- 修法:加 `if (dialogs.anyOpen()) return;`。

**6. [minor] stale `.active` 标记导致 Esc 层穿透/焦点被偷**
- 证据:`clearMenu()` 无参调用时**保留** `.active` 类、只重聚焦行(`src/context-menu.js:135-138`);view 切换时 `activate()` 正是无参调用(view-manager.js:455);palette `open()` 也无参(palette.js:728)。而 keyboard.js 的 Esc 链把"存在 `.active`"当作"菜单开着"(keyboard.js:721)。序列:树行开菜单 → Ctrl+K 开 palette(clearMenu 保留 .active)→ Esc → 命中 `.active` 分支 → 焦点从 palette 输入框被偷到树行,↑↓ 死。与问题 2 同根:`active` 标记与"菜单可见"两个状态被混为一谈。
- 修法:Esc 链的菜单判定改为"`.active` 且菜单元素实际可见(style.opacity === '1' 或 left !== '-999px')";或 view 切换/palette open 路径改用带事件的 clearMenu 语义(连类一起清)。

**7. [minor] palette-cmd 菜单与 separator 菜单无键盘绑定**
- 证据:contextKeyDown 绑了 bookmark/folder/searchHistory/histRow/dupesGroup 五个菜单(keyboard.js:649-660),separatorMenu 绑定被注释(:651);v4.0 新增的 `palette-cmd-context-menu`(pages/popup.html:116-118)不在其中。两者打开后 ↑↓/Enter 无处理器,违反 keyboard-model.md 目标 3"Everything reachable";且 tabCycle 的 menuContainers 列表(keyboard.js:810-813)也不含 palette-cmd 菜单 → 其内按 Tab 会被 Tab 环劫持。
- 修法:palette-cmd 菜单补绑 contextKeyDown 并加入 menuContainers;separator 菜单要么绑定要么在文档中声明为例外。

**8. [minor] 下拉打开时 Ctrl/Alt+数字切视图,listbox 悬空**
- 证据:view-manager.js:599-617 的守卫只挡对话框/palette;dupes 下拉打开(焦点在 option li)时 Ctrl+2 直接切视图,dropdown 的 `openDd` 与 `hidden=false` 状态悬空;回来时若视图不重渲染(view-dupes.js:896 `$list.innerHTML` 非空分支),打开的下拉原样亮着但焦点已丢。Esc 的 window-capture 只对 Esc 生效,管不到数字键。
- 修法:view 切换时顺带关掉打开的下拉(dropdown 暴露 closeOpen() 挂到 view deactivate),或在数字键守卫里把"打开的下拉"列为拥有者。

**9. [nit] 根文件夹菜单 ↑ 入口落禁用项**
- 证据:keyboard.js:603 `item.lastElementChild.focus()` = `folder-delete`,根文件夹下它是 disabled(pages/popup.html:91)。可见所以 focus 成功,但违反 6d27424 自己立下的"禁用项永不接收焦点"。随问题 1 一并修即可。

**10. [nit] dropdown Tab 命中 greyed 当前项:listbox 不关、焦点被 Tab 环带走**
- 证据:`src/dropdown.js:86-87` pick 对 greyed 直接 return(注释"keep the list open"),但 `:164` 的 Tab 分支不 stopPropagation、不 preventDefault,keyboard.js 的 tabCycle 随后把焦点移到下一 stop——下拉保持打开、焦点已离开,键盘路径无人能关它(点击其他工具行控件才关,dropdown.js:116)。
- 修法:Tab 分支在 greyed 时也关闭(不 pick),Esc-cancel 语义。

**11. [nit] dead 视图扫描中静默重绘丢行焦点(存量问题)**
- 证据:`src/view-dead.js:502-510` 每次 progress tick 只按索引恢复**工具栏**焦点(TOOLBAR_SEL 不含行锚);行内锚点持焦时 innerHTML swap 把焦点打回 body,↑↓ 死。view-dead.js 不在本 delta 内,但正是审阅点 5 问的缝隙,建议记录。修法:render 前快照 `document.activeElement` 所在行的 `data-node-id`,swap 后按 id 找回锚点聚焦。

**12. [nit] tree-view reveal 的 focusTarget 无 null 守卫**
- 证据:`src/tree-view.js:195-207` `focusEl.firstElementChild` 为 null 时 `classList.add` 抛错(旧代码同构,本次只是沿用)。补 `if (!focusTarget)` 提前返回。

## 修复核实(无问题项)

9888f8a 的普通 input 保护——popup 内除搜索框外仅有隐藏 `#copier-input` textarea(pages/popup.html:7),对话框输入由 7 个 need* body class 兜底且与 `dialogs.anyOpen()`(含新增 needTabGroup/needGroupPick,dialogs.js:326-328)一致;AltGr 排除(`altKey && (ctrlKey||metaKey)`)+ `^[1-9]$` 双重过滤正确;RTL 镜像在 contextKeyDown ←/→、headerArrow、dropdown confirm/cancel、palette closeKey 四处一致;菜单行走在项间对 disabled/hr/inline-none/CSS-none(getClientRects)判定完备;71331d0 的 window-capture Esc 优先关下拉实现正确(window 确在 document 之前);dropdown 的 Tab 实际是"pick→trigger 复焦→tabCycle 从 trigger 步进",与 Tab 环衔接自洽。

## (a) 测试覆盖缺口(按用户价值排序)

1. **浏览器级上下文菜单键盘行走**(打开 → 首个 ↓ → Enter → ←/Esc 焦点回行)——能抓到问题 1;verify-keyboard.js 目前对五个菜单零键盘断言,且 d0d83cf 的 getClientRects 分支在 double 里结构性不可测(double 无布局,CSS 隐藏只能用 inline style 镜像)。
2. **"菜单开在 palette 上 + Esc"的集成用例**(focus-regression 可表达:真实 keyboard.js + 真实 palette,按注册序触发)——能抓到问题 2;当前 palette.test.js 未加载 keyboard.js。
3. **F2 根文件夹**(keyboard.test.js)与**容器持焦 Delete**(f5903c8 副作用)——问题 3、4,均带数据后果。
4. **对话框打开时的全部视图快捷键**:Ctrl+数字已有(focus-regression B),Ctrl+F、Ctrl+K(对话框打开时 palette.open 有守卫,Ctrl+K toggle 本身)缺;且 focus-regression 头部注释声称覆盖"Tab ring does not cycle while a dialog is open"、"Tab does not cycle while palette is open",describe B/C 里**并无对应用例**——注释超卖。
5. **71331d0 的浏览器级断言**:dropdown Esc 关列表(单测已覆盖 window-capture,verify-keyboard.js:418-430 的 dropdown 段只测 ↓ 开、→ 选,无 Esc)。
6. **reveal-in-tree 端到端焦点**(含 viewState 记忆行与 reveal 行竞争)——现仅 double 级断言 `span.focused`。
7. **selection mode 的 Esc 集成层**(view-dupes.test.js:1085-1088 只测 onEscape 返回值,未测 keyboard.js 链 → onEscapeActive 的接线;dead 视图选择模式同)。
8. **stale .active + Esc**(问题 6 序列)与 **dropdown 打开 + Ctrl 数字**(问题 8)。

## (b) 与 docs/keyboard-model.md 的实现漂移

1. **§6 "Alt+1…9(never fires inside inputs)"** —— 9888f8a 后,搜索框持焦时 Ctrl/Alt+数字**会**切视图(只有对话框/palette 拦截)。行为是有意改的,文档未跟进(view-manager.js:606-617)。
2. **§2.6 "The same handler serves all five menus"** —— 现有 7 个菜单元素;separator 绑定被注释(keyboard.js:651),palette-cmd 菜单未绑定,§2.6 对二者不成立。
3. **§4 Esc 蛋糕缺"打开的下拉"层** —— dropdown.js:177-185 在 window capture 于文档链之前关下拉(在 view-local/selection 之上),§4 的 8 层清单未列(仅 §2.5 提及 Esc cancel);"exactly one layer per press"的枚举不完整。
4. **§2.4 Delete 行未记根文件夹守卫** —— keyboard.js:527-529 新增 parentid==='0' 跳过;且 F2 无同源守卫(问题 3),文档表格给不出区分依据。
5. **§2.5 dropdown "Tab picks + closes and lets the browser move focus on"** —— 实际是 trigger 复焦后由 keyboard.js tabCycle 步进(dropdown.js:164 不拦截)。"browser" 措辞不准;结果等价但机制描述漂移。
6. **§2.6 "close the menu and return focus to the owning row"** —— 对 palette 结果行不成立(问题 2/6):"owning row" 不是 palette 的键盘焦点锚点(锚点是输入框),文档未为 palette 菜单定义例外。
