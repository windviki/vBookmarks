# Issues #65 / #66 — 弹窗重开滚动位置失效("重置回树顶")· 根因与修复(2026-09-01)

> **after disabling highlighting. It no longer remembers the position and resets to the top of the tree's bookmarks.**
> — @Ownsin, issue #65 后续反馈, 2026-08-30
>
> **You may regenerate the problem by changing the scroll position only and not select any particular bookmark. Scroll position is not remembered without any bookmark being highlighted. Even with a bookmark being highlighted. The scroll position still often shifted…**
> — @leungwh, issue #66, 2026-08-30
>
> 维护者分诊(2026-09-01):滚动位置其实记住了,但第一屏(可视区内)的书签会被重置回树顶;#66 标记 same as #65。

## 结论 · TL;DR

两个**相互独立**的缺陷叠加,都会把重开的弹窗拽回树顶,且与 #63(关窗丢写,已修)无关——存储侧 `scrollTop`/shadow 一直是新鲜正确的(探针实测重开时 mirror=2200 而 DOM=0)。修复 = ①恢复赋值的 clamp 补写(布局就绪后重试)②三处"回到原位"的 `focus()` 全部改 `{ preventScroll: true }`。本地已修,待随版本发布、用户确认后再关 issue。

## 根因 · Root causes(全部真浏览器实证)

### 缺陷一:恢复赋值被未就绪的布局 clamp 成 0(#65 主诉的机制)

`src/tree-view.js` `generateTree` 在 `innerHTML` 换树后**同步**执行 `$tree.scrollTop = saved`。但新解析的大树上,嵌套 `#tree ul ul { height: 0 }` → `.open>ul { height: auto }` 的布局在赋值时刻尚未完成(150 行树实测:赋值时 `scrollHeight == clientHeight == 350`,约 250ms 后才变成 3090,期间无任何相关 DOM 变更)——**赋值被静默 clamp 到 0**,事后无人补写。弹窗于是"记得 2200、显示却在顶"。

- 隔离复刻(同样 CSS+结构)不触发:小 HTML、内联 `<style>` 均正常;仅真实弹窗(207KB 树 + `<link>` 样式 + 扩展环境)触发,属 Chromium 布局settling时序,与代码逻辑无关,所以修复必须对内部时序**免疫**。
- 该缺陷与高亮开关**无关**——高亮关(#65 用户配置)后同样踩中,这正是"关掉高亮后反而不记位置"的直接原因(此前高亮开时,focus() 恰好把视图拉回焦点行,掩盖/叠加了同一症状)。

### 缺陷二:"回到原位"的 focus() 滚动副作用(#66 主诉的机制)

Chromium 的程序化 `focus()` 默认会把焦点元素滚动进可视区(实证探针:`overflow:auto` 容器 scrollTop 800→10;**`overflow:hidden` 根本挡不住**,800→10 照旧;`preventScroll:true` 才能保持 800)。三个恢复路径都在弹窗重开/重渲染时覆盖了已恢复的滚动:

1. `src/tree-view.js` focusID 恢复分支——Neat 时代遗留的 `overflow:hidden + width:100%` 技巧(2011 年移植)**从未生效过**,高亮行的 focus() 每次都把视图拉回焦点行;
2. `src/view-manager.js` `restoreFocusSpot`——popup 重开的"上次在哪"焦点恢复,每 100ms 轮询到行渲染后 `target.focus()`;
3. `src/list-focus.js` `unparkRowFocus`——重渲染后恢复焦点行,行不在视口内时同样拉滚动(书签事件触发的 mid-session 重渲染,"经常漂移"的来源)。

**#66 的精确复现链**:高亮恢复后 4 秒,focusID 被迟清理(此时已"看不见高亮"),但 `focusSpot`(行焦点记忆)仍指向旧行且滚动不会更新它——重开时无任何可见高亮,焦点恢复却照样把视图拉回旧行。"只滚动、不点任何书签,位置不被记住"与该现象完全互印。

## 修复 · The fix

语义原则:**滚动位置与焦点/高亮是两条独立记忆,谁也不得覆盖谁**;恢复赋值必须对布局时序免疫。

| 位置 | 改动 |
| --- | --- |
| `src/tree-view.js` 滚动恢复 | clamp 补写(rescue):赋值后若未达到 saved 且环境有 rAF,则每帧重试(上限 30 帧);期间 scrollTop 若被别人(用户滚动、reveal 的 scrollIntoView)移动,立即放弃,绝不抢方向盘 |
| `src/tree-view.js` focusID 恢复 | `focus({ preventScroll: true })`;删除从未生效的 `overflow:hidden`/`width:100%`/1ms 还原杂技(高亮、键盘焦点落行、4s 迟清理全部保留) |
| `src/view-manager.js` restoreFocusSpot | `focus({ preventScroll: true })` |
| `src/list-focus.js` unparkRowFocus | `focus({ preventScroll: true })`(聚焦与滚动解耦:方向键行走自会滚) |

显式 reveal(`revealFolder`→`scrollIntoView`)、键盘导航、palette `block:'nearest'`、新行落点滚动等**有意滚动**一律不动。

## 验证 · Verification

- **单元**:三个套件更新+新增 7 个断言场景(clamp 补写的落地/让位/有界放弃/无 rAF 回退,三处 preventScroll 契约);全量 `npm run test:run` **90 套件 / 3151 用例全绿**,`npm run lint` 通过。
- **真浏览器 E2E**(`scripts/harness/diag/diag-issue65-66-scroll.js`,本轮新增,可作回归门):A 高亮开+点击顶部行后滚深处、B 4s 清理后无可见高亮(#66 精确)、C 高亮关(#65 精确)——修复前三场景重开全部 scrollTop=0,修复后**全部 2200**,且 A 场景高亮+键盘焦点照常落在目标行、C 场景无任何行高亮(层关语义不变)。5/5 PASS。
- **#66 最新评论的精确复现验证(2026-09-02,leungwh:"点击书签访问 URL → 在网页上滚动 → 回到弹窗,位置经常漂移或回顶,高亮开着也一样")**:diag 增设 D 场景(真实点击中段行 → 弹窗关闭 → 模拟浏览网页 → 重开;随后"滚离高亮行再重开"变体),修复版 7/7 PASS。**修复前(df9617af)对照**:字面点击流程"碰巧"通过——关闭位置==高亮行位置时,clamp(回顶)与 yank(拉回行)两缺陷恰好互相抵消,但结果取决于 focus() 轮询(100ms)与布局 settle(~250-450ms)的**竞速**,跑输即回顶——这正是他 "**often** ... **either** shifted **or** reset to the top" 的成因;而"滚离后重开"变体确定性失败:存 2200 → 重开 1360(被高亮行拉回),且滚动监听把拉坏的 1360 **回写覆盖了存储的 2200**(记忆本身被污染)。修复后两条流程确定性通过、存储不再被污染。
- **分层记忆契约回归**(`diag-memory-layers.js`):14/14 PASS——preventScroll 未伤 P1(重开行重亮+焦点接管)/P4(反复重开仍高亮)/P10(列表行记忆)。
- **smoke 门**:`scripts/harness/run.sh --smoke-only` PASS,NO PAGE ERRORS。

## 对外回复(草稿,待随版本发布)· Public replies (drafted, post with the release)

两份均为英文(报告人均英文用户),语气与此前 #65 首轮回复一致;发布前若版本号确定,把 "the next release" 替换为具体版本。

**→ issue #65**(@Ownsin,回复其 2026-08-30 的"关闭高亮后不再记住位置"反馈):

> Thanks for the follow-up — I could reproduce exactly what you described, and you were right that something was broken.
>
> The scroll position was in fact being saved correctly, but two separate things could throw it away on reopen. First, the restore ran before the freshly rendered tree had finished laying out, so the stored position got silently clamped back to the top. Second, the "last opened bookmark" highlight could scroll the view back to the highlighted row and override your scroll position — which is why turning the highlight off changed the symptom rather than fixing it.
>
> Both are fixed now: the scroll restore retries until the tree is actually ready, and the highlight/focus restore no longer moves the scroll position at all — it only marks the row and keeps the keyboard working from it. Your exact case (scroll somewhere, select nothing, with the highlight off) now reopens exactly where you left it, verified in a real browser.
>
> This will ship in the next release — keeping the issue open until then. Thanks for the clear report!

**→ issue #66**(@leungwh,含 2026-09-02 最新评论的精确复现步骤):

> Thanks — your reproduction steps were exactly right, and they led straight to the cause.
>
> The position was being saved correctly all along, but two things could throw it away when the popup reopened. The restore ran before the freshly rendered tree had finished laying out, so the stored position could get silently clamped back to the top; and the remembered focus row — which outlives the visible highlight — could also scroll the view back to the row it remembered, overwriting your position (and even the saved one) with the row's position.
>
> That also explains the "often / either shifted or reset" behavior you saw: which of the two won was a timing race on every reopen. Both are fixed now — the restore retries until the tree can actually hold the position, and the highlight/focus restore no longer moves the scroll at all (it only marks the row; arrow keys still work from it). I re-verified in a real browser with your exact steps — click a bookmark, scroll around the page, come back — including the case with "Highlight the last opened bookmark" enabled: the popup now reopens exactly where you left it, every time.
>
> This will ship in the next release — keeping the issue open until then. Thanks for the clear report!

## 记录 · Record

- 修复提交:`fix(memory): issues #65/#66 …`(src/tree-view.js + src/view-manager.js + src/list-focus.js + 三测试套件 + diag 探针 + modules.md 契约同步 + 本文档);另有一枚先行小提交修复 df9617af 遗留的 `vitest/valid-title` lint 门(组合矩阵参数化标题改为模板字面量,与本 issue 无关)。
- issue 状态:**保持 OPEN**——等随版本发布、用户复验后再关闭(维护者指示);上节回复草稿随发布一并贴出。
- 回复命令(发布日执行,windviki 授权账户):`gh issue comment 65 --repo windviki/vBookmarks --body-file <file>` 与 `gh issue comment 66 --repo windviki/vBookmarks --body-file <file>`(正文取上节对应段落)。
- 关联:#63(关窗丢写,scrollTop localStorage 影子,已修,本案存储侧由此免疫)、#58(高亮恢复的原始设计)、4.1.1 分层记忆(`docs/issues/issue-65-highlight-toggle.md`)。
