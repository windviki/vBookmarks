# 审阅报告 09:键盘与焦点——agent-01 补充调研差分(相对报告 01)

> 来源:`tmp/agent-01-thinking.txt`(1001 行推理草稿,**未完成**)。审阅基准同报告 01:`7fea4d1..HEAD`。
> 定位:报告 01 的**增量**。本文档只记录报告 01 未收录的问题;其中凡已被报告 02/04/08 收录的仅做索引不重复,真正新增的问题给出完整证据与修法建议。
> 审阅日期:2026-08-07。注意:部分结论基于代码推理,未做浏览器验证(见文末"证据时效")。

## 一、已被其他报告收录(仅索引,避免重复)

| thinking 披露 | 已收录位置 | 说明 |
|---|---|---|
| dupes 工具行/下拉上按 Home → 未捕获 TypeError(选择器命中 listbox 首个纯文本 option) | 报告 02 #1 | 40e240a 引入;`keyboard.js:383` Home 分支 `ul>li:first-child` 现指向下拉 listbox |
| palette.js:124 `DIALOG_CLASSES` 漏 `needTabGroup/needGroupPick` → Ctrl+K 压模态 | 报告 04 #3 | 5df7631 新增对话框,守卫清单未跟随 |
| neat.js Ctrl+D 守卫漏同两项 → 模态背后静默收藏/删除书签 | 报告 04 #2 | 同上 |
| 视图切换/重渲染后 openDd 悬挂 → 吞一次 Esc + 焦点丢 body | 报告 02 #4/#5 | 含 `!openDd.isConnected` 一行防御修法 |
| keyboard-model §8 测试列缺 `tests/focus-regression.test.js` 挂载 | 报告 08 §4 微 | — |

> 上述均已在对应报告中有完整证据,本文不重复。

## 二、新增问题清单(报告 01 未收录,亦未被 02–08 收录)

> 编号建议沿用 master-plan 的 K 系列续编(K13 起),供后续纳入主清单。

### K13【中】palette close() 的焦点归还无视当前视图——聚焦隐藏的 tree 行
- **位置**:`src/palette.js` close()(`document.querySelector('#tree .focus') || document.querySelector('#tree a, #tree span')`)。
- **证据**:palette 打开不切换视图。从非 tree 视图(如 dead 视图)打开 palette 再 Esc 关闭时,`#tree` 所在 section 是 `hidden` → 对 display:none 子树内元素 `focus()` 是 no-op → 焦点留在已隐藏的 palette input 上。后续按键仍派发到该隐藏 input:↑↓ 移动隐藏列表的选择、**Enter 可能 `execute(selected)` 打开当前标签页**——破坏性意外。
- **存量**:7fea4d1 时同样代码,非本区间回归;报告 01 未收录。
- **修法建议**:close() 把焦点归还"palette 打开前的活跃视图/元素"(open 时记录 return target),或至少在聚焦前检查目标可见性(`offsetParent !== null`),隐藏则跳过。
- **置信度**:"聚焦隐藏 tree 行"是确定代码行为;"(最坏)Enter 打开书签"依赖 Chrome 对"祖先 hidden 后 activeElement 是否保持"的行为,已标注。

### K14【中-高】dead 代理 URL 文本框的 ←/→/Home/End 被工具行行走劫持,光标无法移动
- **位置**:`src/keyboard.js:154-175` 工具行 rung 行走 + `src/view-dead.js:301-304`(`dead-proxy-input`,type=text,位于 `.dead-proxy-strip.vbm-toolbar` 内)。
- **证据**:焦点在该文本框时,`treeKeyDown` 非 a/span 分支把 ←/→ 当工具行行走(焦点跳到前后按钮),Home/End 落入"第一/最后一行"分支——**文本光标根本移不动**。同一问题也作用于 `dead-proxy-testurl`(view-dead.js:1154)。字母键因导航正则早退(`keyboard.js:92-93`)不受影响。
- **存量**:工具行 ←/→ 行走与代理面板均早于 7fea4d1;报告 03 只评了代理功能本身,未涉及此键盘交互。
- **修法建议**:与现有 `SELECT` 放行(`keyboard.js:104`)同模式——`input[type=text]` 的 ←/→/Home/End 归文本域所有,行走跳过;或行走前 `item.tagName === 'INPUT'` 时返回。
- **置信度**:高(纯代码行为)。

### K15【低-中】对话框关闭后焦点不归还调用者——Esc/OK 后方向键全死
- **位置**:`src/dialogs.js` 各 close 路径。
- **证据**:关闭对话框只移除 body class,无 focus restore。Esc 关对话框时 activeElement 是对话框内控件,随模态隐藏落到 body → `treeKeyDown` 绑定在列表容器上,body 按键不触发 → 方向键死,直到点击/Tab。Tab 则从 body 起环跳到搜索框。
- **存量**:7fea4d1 同样行为,非本区间回归;报告 04 只核对了 aria-modal/Esc/焦点陷阱(trap 正确),未覆盖"关闭后归还"。
- **修法建议**:对话框 open 时记录 invoker,close 后归还焦点(与 context-menu `clearMenu` 归还"owning row"同语言)。
- **置信度**:中("浏览器把隐藏元素的焦点重置到 body"依赖 Chrome 行为)。

### K16【中】搜索框带查询时切视图,searchMode 卡死——违反模型 §3 不变式
- **位置**:`src/view-manager.js` activate() + `src/search.js` deactivate 钩子(仅 `recordHistory`,不退 searchMode)。
- **证据**:9888f8a 放开"搜索框持焦时 Ctrl+数字切视图"。带查询时 Ctrl+1 切到 tree 视图,query 与 searchMode 原样保留(activate 不退模式、清空查询)→ tree 里 End/Home 走 search 选择器(`this.querySelector('li:last-child a')`,落到深层/任意节点)、叶子节点 ↓ 不爬树。mouse 点 tab 同状态,但 9888f8a 把键盘路径也放开了。`docs/keyboard-model.md:194` 的"query in the box ⇒ search view active"不变式被打破。
- **区间属性**:搜索模式卡死是存量路径(鼠标可达),9888f8a 扩大了键盘暴露面。
- **修法建议**:search.js deactivate 钩子退出 searchMode(并清空查询),注意 `quitSearchMode` 内部会 `views.activate` 需防递归——直接在 deactivate 里置 searchMode=false 即可。
- **置信度**:高。

### K17【低-中】f5903c8 容器聚焦后、行渲染前 ↑/↓/Home/End 全部早退——修复声称半真
- **位置**:`src/keyboard.js` treeKeyDown 的 `else` 分支(`item = this.querySelector('.focus') || this.querySelector('li a, li span'); if (!item) return;`)。
- **证据**:容器持焦且异步视图行未渲染时(行尚不存在),↑ 也无法如 f5903c8 提交声称的"跨回工具行/搜索框"——提前 return,四键全死,直到行渲染出来。`tests/focus-regression.test.js` 只断言"焦点落在容器",不测容器持焦时的 ↑↓ 行为。
- **修法建议**:容器持焦且无行时,↑ 应走 `focusListExit`(跨到工具行/搜索框),而非早退。
- **置信度**:高。

### K18【提示】dupes 组头 ←/→ 折叠不做 RTL 镜像——与 §7 "every horizontal law mirrors" 相悖
- **位置**:`src/view-dupes.js:765-766`(组头 `const expand = (k === ' ' || k === 'Enter' || k === 'ArrowRight') && isCollapsed`)。
- **证据**:成员行回退箭头是 RTL 感知的(view-dupes.js:824),组头折叠键却用原始 ←/→——RTL 语言(ar/he/fa)下行为与文档相反,且与同视图自己成员行不一致。报告 05 B2 只核对了行布局 RTL 正确,未覆盖组头键盘键。
- **修法建议**:组头折叠键按 RTL 镜像(`ArrowRight`/`ArrowLeft` 对调)。
- **置信度**:高。

### K19【提示】Alt+数字键盘 1 在搜索框内会切视图——input 守卫移除的行为变化
- **位置**:`src/view-manager.js:599-617` Ctrl/Alt+digit 处理器。
- **证据**:Windows 下 Alt+数字键盘(Alt-code 输入字符)的 keydown 是 `e.key === '1'` 且 `altKey` → 匹配 `/^[1-9]$/` → 搜索框持焦时也切视图 + preventDefault(字符打不出来)。旧守卫(input 内不触发)覆盖此场景,9888f8a 移除后暴露。AltGr(ctrl+alt)与 macOS Option+digit(组合出符号字符)已被排除,不受影响。
- **修法建议**(可选):守卫加 `e.code.startsWith('Numpad')` 排除,或文档声明为已知取舍。
- **置信度**:高(但触发场景极边缘)。

### K20【提示】guide-v4 "Alt+1…6 | Anywhere" 表述夸大
- **位置**:`docs/guide-v4.md:90`(zh 对应行)。
- **证据**:9888f8a 后 Alt/Ctrl+数字在对话框、命令面板打开时仍被拦截(view-manager.js 守卫),"Anywhere/任意处"过度声明。报告 08 §2 未提此项(08 只评了代理模板、下拉协议、Esc 链等)。
- **修法建议**:改为"可在各视图生效;对话框/命令面板打开时除外"。
- **置信度**:高。

## 三、thinking 相对报告 01 的其他增量信息(非新问题)

- **1f84154 Esc 遮蔽的对称确认**:thinking 额外确认 palette 输入框自身的 Escape 处理器(palette.js:654)与 search 输入框的 Escape 处理器同样被 keyboard.js 的 document-capture 链遮蔽——与报告 01 问题 2 同根,行为无害(键盘链已代为处理),仅多余死代码。
- **对话框 Tab 陷阱的 alert 空态**:`tabCycle` 在 `e.preventDefault()` 之后才检查 `focusables.length`(keyboard.js:844)——alert 对话框无控件时 Tab 被 preventDefault 且原地不动,与"stay put"注释一致,无问题。
- **下拉 open 时 Esc 层的实际顺序**:window-capture(71331d0)优先级高于文档 §4 的全部 8 层(含第 1 层 dialogs)——报告 01 (b)3 / 报告 08 §4 已收录,此处确认其"可能盖过 dialog"的场景在现实中基本不可达(对话框不会在键盘焦点于下拉内时打开)。
- **AltGr 排除、macOS Option+digit 组合字符、Linux Alt+digit 出字符**——均验证不会误切视图(组合字符 e.key 不匹配 `/^[1-9]$/`),与报告 01"修复核实"段结论一致。

## 四、新增测试缺口(相对报告 01 (a))

1. **K13**:palette 从非 tree 视图打开再 Esc 关闭的焦点落点(可进 focus-regression)。
2. **K14**:工具行含 text input 时 ←/→/Home/End 不劫持(可进 keyboard.test.js;浏览器层 verify-keyboard 可覆盖 dead 视图代理输入框)。
3. **K16**:带查询 Ctrl+1 切视图后 tree 的 End/Home/↓-climb 行为(可进 focus-regression)。
4. **K17**:容器持焦且无行时 ↑ 跨回工具行(补 focus-regression 现有 f5903c8 用例的断言面)。
5. **K18**:dupes 组头 RTL 镜像(可进 keyboard.test.js)。

## 证据时效与置信度说明

- `tmp/agent-01-thinking.txt` 是**未完成草稿**:部分结论是思考中途的自我修正(如"dead start 行 Home 崩溃"被作者自行撤回为不可达,本文未收录);K13/K15 的破坏程度依赖具体浏览器对隐藏元素焦点的行为,文中已逐条标注。
- K14/K16/K17/K18/K19/K20 为纯代码级推理,链条完整、无浏览器验证缺口,可信度高;建议在修复批次中落地单测时一并验证。
- 全部新问题中 **K13/K14/K15/K17 为存量问题**,K16/K19 由 9888f8a 放大暴露;无本区间新增的键盘功能回归(本区间新增回归已由报告 02(下拉 Home 崩溃)与报告 04(守卫遗漏)收录)。
