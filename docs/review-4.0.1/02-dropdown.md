# 审阅报告 02:统一自定义下拉组件(src/dropdown.js)

> 审阅范围:`7fea4d1..HEAD` 的 dropdown.js(186 行全文)、view-dupes.js 调用点、neat.css 相关段落、keyboard.js/palette.js 交互、tests/。
> 现状:`tests/dropdown.test.js`(16 例)+ `tests/view-dupes.test.js`(62 例)实测全绿。
> 审阅日期:2026-08-07,审阅方式:explore 子代理只读审阅。

## 问题清单

**1.【高】dupes 工具行上按 Home → 未捕获 TypeError(下拉标记引入的回归)**
`src/keyboard.js:383`:`case 'Home'` 走 `this.querySelector('ul>li:first-child').querySelector('span, a').focus()`。`this` 是 `#dupes-list`;`render()` 的文档序是 risk banner → 工具行 → 分组 `<ul role="list">`(view-dupes.js:403-410),risk-banner.js 不含 `ul`,所以**第一个 `ul>li:first-child` 现在是 strategy listbox 的首个 `<li role="option">`**——它只有纯文本,没有 `span/a` → `null.focus()` 抛 TypeError。复现:dupes 视图,焦点在关闭的 strategy trigger(或任一工具行控件、或打开的选项)上按 Home。40e240a 之前第一个 ul 是分组列表(li 含 `.group-head` span),不炸。tests 抓不到:keyboard.test.js:1941 的 "Home on toolbar button" 用预置 `_qs['ul>li:first-child']` stub,dropdown.test.js 的 querySelector 也是 stub,都不反映真实 DOM 选择器顺序。
修法:keyboard.js 的 Home/End 选择器限定行列表,如 `ul[role="list"]>li:first-child`(一行);dropdown.js 在打开态自行处理 Home/End(见 #2)。

**2.【中】打开的下拉不拦截 Home/End/PageUp/PageDown → 焦点跳出、菜单悬空**
dropdown.js:152-166 的 switch 无这些 case,也不 stopPropagation;keyboard.js 工具行分支对 Home/End/Page\* 有意 fall through(keyboard.js:97-99 注释写明)。后果:End 把焦点送到最后一行(keyboard.js:364-375,打开的 listbox 因 `offsetHeight>0` 通过 visible 过滤,但文档序靠后,所以落在分组行),Page\* 同理——**listbox 保持打开,焦点却在背后的行上**。APG listbox 也要求 Home/End 在选项间移动。
修法:打开态在 dropdown.js 里实现 Home(End 跳首/末可选项(跳过 greyed),或至少 preventDefault+stopPropagation 让它们不外泄。

**3.【中】listbox z-index:300 超过 palette(100)与 dialog/cover(200),且下拉能比它们活得久**
neat.css:2580(注释只考虑 "above the rows");z-index 层级表在 neat.css:5-20。路径:下拉打开 → Ctrl+K(palette.js:786 的 document-capture,不检查下拉状态;dropdown 容器 capture 对 `k` 无 case 放行)→ palette 打开而下拉不关 → **listbox 浮在 palette 之上**;再经 palette 命令触发 ConfirmDialog(dialog 200)也同样被压在下面。此时 Esc 又被下拉的 window-capture 抢先(先关下拉,再关 dialog/palette)——每层一键虽自洽,但视觉层级颠倒且文档未定义。
修法:palette 打开 / dialog 打开 / 视图切换时统一关掉已开下拉(给 initDropdowns 加 `closeOpen()` 导出,或 document focusout/mousedown 关闭);z-index 降到 dialog 之下只是遮羞,关闭才是正解。

**4.【中】视图切换不关闭下拉,切回后悬空**
view-manager.js:468 切走只 `container.hidden = true`;view-dupes.js:893 的 activate 钩子仅在 `dirty || !groups.length` 时 refresh——无书签事件时不重渲染 → 切回 dupes 后 listbox 仍是打开态,而焦点已被 focusDefault 移走(f5903c8)。修法:activate 钩子里关一下,或 view-manager 切换时通用关闭。

**5.【中】重渲染后 openDd 悬挂:吞掉一次 Esc + 焦点丢到 body**
下拉打开期间 `scheduleRefresh`(书签 onCreated/onRemoved/…,300ms 防抖,同步引擎写入时很常见)→ `render()` 整体换 innerHTML → 旧下拉脱离文档,`openDd` 仍指向它。此时:(a) dropdown.js:178-185 的 window Esc 处理器只查 `!openDd`,对脱离节点照样 `stopImmediatePropagation` + `close(openDd, true)`(聚焦脱离节点无效)——**用户的第一次 Esc 被白白吃掉**,dialog/palette/关 popup 层都轮不到;(b) 焦点原本在选项 li 上,随节点销毁落到 body,`TOOLBAR_SEL` 不含 li(view-dupes.js:376),恢复不了。注释(dropdown.js:48-51)说悬挂 "harmless",对 click 路径成立,对 Esc 路径不成立。
修法:window 处理器加 `!openDd.isConnected` 判断(一行);更彻底是 render 时通知组件清空 openDd。

**6.【低】ARIA 缺口**
- greyed 选项只有视觉 class,缺 `aria-disabled="true"`(view-dupes.js:292-295)——屏幕阅读器不播报"禁用"。
- trigger 缺 `aria-controls` 指向 listbox(view-dupes.js:297);APG 可折叠 listbox 要求。
- 未选中项不写 `aria-selected="false"`(单选 listbox 建议显式给出)。
- 焦点模型是 roving `li tabindex="-1"` + 真实焦点,而 `aria-selected` 只标记**已提交**值;导航中的当前项对 SR 没有程序化暴露(APG 做法是 listbox 持焦 + `aria-activedescendant`)。实际浏览模式尚可读,但偏离 APG。

**7.【低】强制色彩(高对比度)模式下焦点不可见**
neat.css:2602-2606:`li:focus` 仅背景变化且 `outline: 0`;forced-colors 下背景被系统接管后没有任何焦点指示。原生 select 由 OS 绘制无此问题。修法:`@media (forced-colors: active)` 补 outline,或改用非零 outline。

**8.【低】点击容器外不关闭**
click 监听挂在 `$list`(#dupes-list,view-dupes.js:126/583),点 header、tab strip、搜索框都不关;panel 模式没有 popup-blur 兜底(popup 模式靠 Chrome 自动关)。之后任何视图切换路径都会带着一个悬空下拉(并入 #4 的修法:document 级 mousedown/focusout 关闭可一并解决 #3/#4/#8)。

**9.【低】API 无 destroy,window 级 listener 不可移除**
initDropdowns 注册 3 个 listener(container click、container keydown capture、window keydown capture),无返回句柄。当前安全:neat.js:636 每次会话只调一次,popup 每次打开整页重载。但头注释承诺 "any future select reuses it verbatim"——一旦有动态 init/destroy 的视图就会累积。修法:返回 `{ destroy(), closeOpen() }`,顺手解决 #3/#4/#5。

**10.【低】文档缺口:Esc layer cake 未列入下拉层**
docs/keyboard-model.md §4(197-217 行)列了 8 层,无 dropdown;实际实现是 window-capture + stopImmediatePropagation(dropdown.js:177-185),优先级高于**所有**文档层——包括第 1 层 dialogs(#3 的场景可同时成立)。§2.5(146-157 行)有协议描述但与 §4 没对齐。

## 对三个修复提交的核验

- **bc80718([hidden])**:修法是 neat.css:169-171 全局 `[hidden]{display:none!important}`,并删掉三条冗余规则——正确且根治。残留核查:`#dupes-list ul` 重置(neat.css:2104-2114)仍含 `display: block`,但被 !important 压制;`.vbm-dropdown-list` 的 !important 只碰 margin/padding 不碰 display;未发现其他会覆盖 [hidden] 的 display 规则。
- **b2e54be(特异性)**:根因属实,现改为 `.dupes-toolbar button:not(...):not(.vbm-dropdown-trigger)`(0,4,1)反向排除(neat.css:2657)。治标但够用;隐患是**每新增一条工具行通用 button 规则都得记得排除 trigger**——更稳的做法是给扁平按钮正名一个 class(如 `.vbm-btn-flat`)。主题完整性:trigger/list 用到的全部变量(--vbm-bg/fg/border/accent/bg-hover/bg-elev/shadow/muted;radius 仅 :root 定义全局继承)在 light/dark/auto-dark/ink/paper 五块中均有定义(neat.css:18-141),逐块核对无缺。
- **71331d0(对齐 + Esc 层级)**:li `padding: 0 8px !important` 对齐 trigger 的 1px border + 8px padding(neat.css:2594),注释与实现一致;Esc 用 window capture 抢在 keyboard.js 的 document-capture + stopImmediatePropagation(keyboard.js:710-714)之前,分层推理正确,测试覆盖(dropdown.test.js:307-334)。

## 缺口清单

- Home/End 打开态未实现,且 #1 表明**既有 fall-through 契约与新标记不兼容**——最需要补的是一个真实 DOM(jsdom/浏览器)下的集成测试,覆盖"工具行含 listbox ul 时 Home/End/Page\*";现有 stub 测试结构性抓不住这类回归。
- `nav()` 不做 `scrollIntoView`(当前 3 选项不溢出;组件自称通用,max-height:240px 已留口)。
- 选项 `white-space:nowrap` + `min-width:100%`,长 i18n 文案可超出 320px popup 被 `body overflow:hidden` 裁掉。
- `openDd.isConnected` 防御、destroy/closeOpen API、aria-controls/aria-disabled(见上)。

## 自绘 vs 原生 select 的评估

理由成立:原生 select 打开后键盘归浏览器,无法实现 rung 契约(↑ 离开、↓ 开、→ 选、← 取消),也无法程序化进入打开态;`size` 属性是常驻列表,不适合工具行;键盘转发改变不了打开态语义。移动端无妨成立(扩展无移动)。代价已具体化为 #1-#8:自管焦点、滚动、z-index、Esc 层级、SR/HC 退化——本组件的复杂度没有白花,但边界(与全局层级的交互)还没收完。

## 更简洁的实现路径

组件本身(186 行、一对委托监听 + 一个 window Esc)已相当克制,不建议重写。两处可简化/加固:

1. **改用 aria-activedescendant 模式**:listbox `ul` 持焦(tabindex=-1),`aria-activedescendant` 指向当前 li,高亮用 class 而非 `:focus`。省掉 li 的 tabindex 与真实焦点移动,SR 语义更正,且与 view-dupes 的 index 式焦点恢复天然兼容(焦点始终在可枚举的 ul 上)。代码量基本持平。
2. **用"失焦即关"替代多点防御**:document 级 `focusout`/`mousedown` 关闭 + z-index 降到 dialog 之下,一个机制同时消掉 #3/#4/#5/#8 四个边界问题,比逐个视图钩子打补丁简洁。加 `openDd.isConnected` 一行防御仍然值得保留。

最优先修:#1(功能回归,一行选择器可修)、#5(一行 isConnected)、#6 的两个 aria 属性。
