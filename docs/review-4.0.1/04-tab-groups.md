# 审阅报告 04:标签组打开修复与增强(5df7631 → HEAD)

> 整体设计是对的:打开/入组管线移入 SW 根治了 popup 关闭丢回调的问题;bef2d35 修的"分组标题异步时序"(folderContextHandler 中 `clearMenu()` 同步置空 `currentContext`,`getChildren` 异步回调里 `rowGroupTitle()` 读到 null 得空串)通过在调度前捕获 `groupTitle`(src/context-menu.js:537)根治,且有 tests/context-menu.test.js:987 的异步时序单测锁死。但发现 2 个中等等级的真实 bug 和若干小问题。审阅日期:2026-08-07。

## 问题清单

**1.【中】已有组选择器色点全部透明不可见 — `tg-color-*` 类不存在**
- src/dialogs.js:272 生成 `<span class="tab-group-dot tg-color-${color}">`;css/neat.css:1233 `.tab-group-dot` 用 `background: var(--tg-color)`,但 `--tg-color` 只在 `.tg-grey`…`.tg-orange`(neat.css:1191-1199)上定义。全库 grep 确认没有任何 `.tg-color-*` 规则 → `var(--tg-color)` 未定义,background 回退 transparent,9 色点全部隐形。浏览器套件 shots-tabgroups.js:172-176 只断言了文本不含 computed style,所以漏网。
- 修法:dialogs.js 改发 `tg-${g.color}`(与对话框色点同一套类),或在 CSS 补 `.tg-color-*` 映射;并在 32 号截图断言 `getComputedStyle(dot).backgroundColor`。

**2.【中】Ctrl/Cmd+D 守卫列表漏新对话框 — 模态打开时仍可收藏当前页**
- src/neat.js:774-776 的 quick-add 守卫只查 `needConfirm/needEdit/needAlert/needInputName/needSort`,缺 `needTabGroup/needGroupPick`。新组对话框输入标题时按 Ctrl+D 会在模态后面触发 `quickAddCurrentTab`。对照 src/view-manager.js:612-615 的同类守卫已补上两个新 class——同一轮改动漏了这一处。
- 修法:守卫列表补 `needTabGroup || needGroupPick`,或直接用 `dialogs.anyOpen()`。

**3.【中】palette.js 对话框清单漏新 class — 命令面板可压在模态上抢焦点**
- src/palette.js:124 `DIALOG_CLASSES` 同样缺 `needTabGroup/needGroupPick`,`anyDialogOpen()` 用于 717/765/777/788 四处拦截;新对话框打开时 Ctrl+K 仍能唤起面板。
- 修法:同 #2,两处清单建议收敛为复用 `dialogs.anyOpen()`,杜绝第三次漏改。

**4.【低】openIntoGroup 的 tabs.group 回调不读 lastError → Unchecked runtime.lastError 警告**
- src/tab-groups-sw.js:98-101 回调只有注释没有 `chrome.runtime.lastError` 读取;组在 get 与 group 间隙消失时产生控制台警告。与同文件 line 61(openNewGroup 读了)及 793e336"统一读取 lastError"的仓库约定相悖。
- 修法:回调内加 `void chrome.runtime.lastError;`。

**5.【低】onCreated 无 tab 守卫 — 单个 tabs.create 失败会炸或挂死整条链**
- src/tab-groups-sw.js:56-58、94-97:若某 URL 创建失败(如书签夹里的 `javascript:` bookmarklet,或 open-into 时目标窗口已关),回调要么拿到 `tab === undefined` → `tab.id` 抛 TypeError(SW 控制台未捕获异常),要么回调不触发 → `pending` 永不归零,已打开的 tab 静默不成组、无任何回执。
- 修法:`onCreated` 开头判空(`if (chrome.runtime.lastError || !tab) { if (--pending<=0 && tabIds.length) group…; return; }`),`tabIds` 为空时跳过 group。

**6.【低】open-into 的"窗口在间隙关闭"场景静默全丢,与模块注释承诺不符**
- src/tab-groups-sw.js:103-105:`tabGroups.get` 成功后窗口被关,所有 `tabs.create({windowId})` 失败 → 用户一个 tab 都得不到;文件头注释(line 19-21)宣称该场景 "degrades to plain open",实际只覆盖了 group 消失、没覆盖 window 消失。
- 修法:create 回调检测 lastError 后去掉 windowId 回退 `plainOpen`。

**7.【低】GroupDialog/GroupPickDialog 的 onConfirm/onPick 粘性残留**
- src/dialogs.js:206-207、248-249:`if (opts.onConfirm) GroupDialog.onConfirm = opts.onConfirm` — 不传回调的 open 会沿用上一次处理器。当前 3 个调用点都传了(context-menu.js:416/420、430、635/640),无现实触发,属潜在 API 隐患(与 ConfirmDialog fn1 同模式,但新代码不该复制)。
- 修法:open 时先重置为 noop 再覆盖。

**8.【低/a11y】九宫格色点 radio 无可访问名**
- pages/popup.html:173-181:9 个 visually-hidden radio 无 `aria-label`/`title`,包裹 label 内的 span 为空;`#tab-group-colors` role=radiogroup 也无 `aria-labelledby` 指向 `#tab-group-color-label`。屏幕阅读器只报 "radio button 1/9"。颜色是纯视觉信息,此缺口比现有对话框缺 aria-labelledby(confirm-dialog 同样没有,属既有风格)更实质。另注意这 9 个 radio 都在 Tab 环里(keyboard.js:845 收 `button, input`),从标题输入框到保存键要 Tab 11 次——有 focus-visible 样式可用但繁琐。
- 修法:每个 input 加 i18n 色名 aria-label;radiogroup 加 `aria-labelledby="tab-group-color-label"`。

**9.【提示】GroupDialog 输入框内 Enter 不触发保存** — 无 keydown 绑定;与现有 edit/sort 对话框一致(同样没有),不算回归,但新对话框主交互就是文本输入,Enter=保存是用户预期。可选增强。

**10.【提示】已有组选择器列所有窗口的组且不可区分** — `chrome.tabGroups.query({})`(context-menu.js:428、638)不过滤 windowId,行只显示色点+标题,多窗口同名组无法分辨;无组时菜单项仍可点、弹"无已有组"空态。SW 侧 get() lastError 降级 plainOpen 已覆盖组消失。可接受,禁用菜单项或加窗口序号更优。

## 确认无问题的审查点

- **SW 消息通道**:sendMessage fire-and-forget、onMessage 不 return true 是正确模式;tabs.create→group→tabGroups.update 每跳都是扩展 API 调用/事件,逐跳重置 SW 空闲计时器,popup 关闭不影响完成。消息无错误回执属设计取舍(SW 同扩展内必达)。
- **颜色集合**:tab-group-utils.js:13 与 chrome.tabGroups.Color 九色枚举完全一致;空标题回退 `title || ''` / `color || 'grey'`(tab-groups-sw.js:63-66)合法。
- **菜单键盘行走**:keyboard.js:560-568 `menuWalkable` 跳过 .disabled/hr/display:none/无 rects,新项是普通 menu-item 自动覆盖;folder 处理器有 disabled 守卫(context-menu.js:532);bookmark 处理器没有但 bookmark 菜单目前没有任何项会被 disable,无现实问题。
- **根文件夹交互**:ROOT_DISABLED_IDS(context-menu.js:93-99)不含三个新组项,根目录保持可打开为组——与旧 open-bookmarks-in-group 行为一致,合理。
- **i18n**:en/zh_CN/zh/de 等 locale 新键齐全;neat.js:85-87/110-111/134-138 id→msg 映射完整;popup.html 与 sidepanel.html 菜单/对话框同步(各 9 处)。
- **aria-modal/Esc/焦点陷阱**:anyOpen/activeEl/closeDialogs 已正确扩展(dialogs.js:325-327、340-343、360-363);Esc 层级(keyboard.js:716-718)覆盖。
- **minimum_chrome_version 114**(manifest.json:91)→ popup 侧直接用 `chrome.tabGroups.query` 不需要特性检测,SW 侧 canGroup() 是纯防御。

## 打包脚本(bef2d35)评估

IMPORT_RE(`(?:from|import)\s+['"]`)确实漏两类:**动态 `import()`**(括号不是引号,静默漏、无告警)和 **HTML 经典 script 标签**(不在 JS_FILES 种子就扫不到)。模拟运行 resolver 核对现状:**45 个 src/*.js 全部进包,4 个 HTML 的 15 个 script 标签 + background SW 全部覆盖,无 MISSING TARGET**(dropdown.js 靠 view-dupes.js 的 import 带入)。残余风险:未来引入动态 import 会静默漏打(resolver 只对它能找到的目标告警);HTML 新增 script 若文件未被任何模块 import,仅靠 verify_no_strays 的**警告**(不 fail)兜底。建议:resolver 增加 `import\(['"]...` 形态,或把 HTML script src 也并入种子。

## 测试覆盖缺口

1. **bug #1 的直接证据缺口**:shots-tabgroups.js 32 号截图不断言色点 computed style,只查文本。
2. **bug #2/#3 无回归测试**:focus-regression.test.js:119-125 只把新对话框放进了 fixture 清单,grep 确认没有对 `needTabGroup/needGroupPick` 场景的 Ctrl+D/Ctrl+K 屏蔽断言;palette.test.js 也未覆盖 DIALOG_CLASSES 新成员。
3. **SW 失败路径无单测**:tab-groups-sw.test.js 的 chrome double 永远成功创建 tab,未覆盖 #5(create 失败 tab=undefined/回调缺失)与 #6(windowId 失效)分支。
4. **空标题路径**:GroupDialog 传空串 → SW `title || ''` 无测试锁定;`pickGroupColor('')` 虽在 utils 测试里,但对话框→SW 的空标题端到端未测。
5. **bookmark 菜单 disabled 守卫缺失**无测试(当前无 disabled 书签项,属预防性缺口)。
