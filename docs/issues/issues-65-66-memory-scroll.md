# Issues #65 / #66 — 记忆分层开关 · 弹窗重开滚动位置失效 · 合并档案(2026-08-30 ~ 09-02)

> **Please give us the option to disable highlighting the last picked bookmark in the tree.**
> — @Ownsin, issue #65, 2026-08-29
>
> **after disabling highlighting. It no longer remembers the position and resets to the top of the tree's bookmarks.**(关闭高亮后位置不再记忆,重置回树顶)
> — @Ownsin, issue #65 后续, 2026-08-30
>
> **v4.1.1 still often cannot remember it's last scroll position and reset the scroll position to the top. … You may regenerate the problem by changing the scroll position only and not select any particular bookmark.**
> — @leungwh, issue #66, 2026-08-30
>
> **select a bookmark to visit a URL, then scroll around on the URL page you visit. Then come back to the bookmark. You will often see the scroll position either shifted or reset to the top.**
> — @leungwh, issue #66 最新评论, 2026-09-02

## 始末 · Timeline

1. **#65 原始请求**(单独关闭高亮)——4.1.1 以「分层记忆」选项组实现:总闸「记住上次状态」+ 四子开关(高亮上次打开的书签/记住滚动位置/记住展开的文件夹/记住上次的搜索词),详见原文档与 `docs/issues/issues-62-64-2026-08-29.md` 的分层记忆设计。首轮回复已发布(2026-08-30)。
2. **#65 后续反馈 + #66**:4.1.1 上滚动位置记忆失效,重开重置回树顶或漂移;高亮开/关、有无高亮行均复现。维护者分诊为同一问题(same as #65)。
3. **根因定位 + 修复(2026-09-02,随 4.1.2 发布)**:见下。

## 根因 · Root causes(真实浏览器实证,与 #63 的关窗丢写无关——存储侧 scrollTop/focusID/focusSpot 及其 localStorage 影子全程新鲜正确)

1. **恢复赋值被未就绪布局 clamp 成 0**:`generateTree` 在 `innerHTML` 换树后同步执行 `scrollTop = saved`,但新解析大树的嵌套 `#tree ul ul {height:0}→.open>ul{height:auto}` 布局约 250ms 后才 settle(150 行树实测赋值瞬间 `scrollHeight==clientHeight==350`),赋值被静默 clamp 到 0,事后无人补写——重开即"回顶",与高亮开关无关(#65 用户关高亮后的主诉即此)。隔离复刻(同 CSS+结构的小树/内联样式)不触发,属 Chromium 布局 settling 时序,修复须对其免疫。
2. **"回到原位"的 focus() 滚动副作用**:Chromium 程序化 `focus()` 默认把焦点行滚入可视区(实证 `overflow:hidden` 挡不住,800→10;`preventScroll:true` 才免疫),tree-view focusID 恢复里 Neat 2011 年遗留的 overflow/width 杂技从未生效。三处恢复路径(focusID 恢复、view-manager `restoreFocusSpot`、list-focus `unparkRowFocus`)都会覆盖已恢复的滚动。#66 精确复现链:高亮恢复 4 秒后 focusID 迟清理("看不见高亮"),`focusSpot` 行记忆仍指旧行,重开时照样把视图拉回。
3. **"often / either shifted or reset" 的成因**:leungwh 字面流程(点击书签→浏览网页→重开)里,关闭位置==高亮行位置,clamp(回顶)与 yank(拉回行)两缺陷方向相反、恰好**竞速抵消**——focus() 轮询(100ms)与布局 settle(~250-450ms)谁赢决定结局,故"经常、要么漂移要么回顶";且 yank 触发的滚动事件会把拉坏的值**回写污染存储**(修复前实测:存 2200→重开 1360→存储被改成 1360)。

## 修复 · The fix(v4.1.2)

语义原则:**滚动位置与焦点/高亮是两条独立记忆,谁也不得覆盖谁;恢复赋值对布局时序免疫。**

| 位置 | 改动 |
| --- | --- |
| `src/tree-view.js` 滚动恢复 | clamp 补写:赋值未达 saved 且有 rAF 则每帧重试(上限 30 帧);期间 scrollTop 被移动(用户滚动、reveal 的 scrollIntoView)立即让位 |
| `src/tree-view.js` focusID 恢复 | `focus({preventScroll:true})`;删除从未生效的 overflow/width 杂技——高亮、键盘焦点落行、4s 迟清理语义不变 |
| `src/view-manager.js` `restoreFocusSpot` / `src/list-focus.js` `unparkRowFocus` | 同改 `{preventScroll:true}`(聚焦与滚动解耦,方向键行走自会滚) |

有意滚动(reveal `scrollIntoView`、键盘导航、palette `block:'nearest'`、新行落点)一律不动。

## 验证 · Verification

- 单元:+7 场景(clamp 补写落地/让位/有界放弃/无 rAF 回退+三处 preventScroll 契约);全量 90 套件/3151 用例+lint 绿。
- 真浏览器回归门 `scripts/harness/diag/diag-issue65-66-scroll.js`:A 高亮开滚深处、B 4s 清理后无可见高亮(#66)、C 高亮关(#65)、D leungwh 字面点击流程+滚离变体(#66 最新评论)——修复前三场景重开全 0、D 变体存 2200 重开 1360 且存储被污染;修复后 **7/7 PASS**(D 关闭位 1380→重开 1380,高亮+键盘焦点保留;滚离后重开 2200)。
- 分层记忆契约 `diag-memory-layers.js` 14/14、`run.sh --smoke-only` 与 `--dist` 全量 harness PASS。

## 残余轮 · Residual round(2026-09-03,#66 关闭后的新反馈)

**反馈**(leungwh,#66 关闭后):v4.1.2 在**关闭**「高亮上次打开的书签」时滚动位置已正常;**开启**时又失效。维护者亦复现("highlight 开启的时候不能保存精确的位置")。

**本地复现尝试(全部未能复现,逐一排除)**:真实 action 弹窗(`chrome.action.openPopup` + CDP,`diag-openpopup-probe4` 手法)× 树规模 150/1200/4000/5000 行 × 高亮开/关 × 多轮变位重开 × 4s 清理窗口前后 × 真实点击流程 × 折叠高亮行所在文件夹 × 4×/20× CPU 节流——全部精确恢复。tag 页环境同理。

**代码审计锁定的残余路径(防御性全封,即本轮修复)**:
1. **预算不足**:climb 补写仅 30 帧(≈500ms)。高亮 ON 时 focusID 存在使 chunk 门退让(`!hasFocusMemory`),**强制同步整树解析**;高亮 OFF + 浅滚动走分块渲染(快而准)——这正构成反馈中的开/关不对称。慢机器+大树可能超出帧预算 → 补写耗尽 → 回顶。
2. **climb 中间值污染存储**:补写爬升过程会触发 scroll 事件,滚动监听把 clamp 中间值(如 400)回写覆盖存储的精确值——用户在爬升中途关窗即触发"**不能保存精确的位置**"。
3. **`focusDefault` 裸 `row.focus()`**:restoreFocusSpot 放弃路径(2s 轮询失败,如 spot 行未渲染)与视图切换落焦,会把视口拉向被标记行——最后一个未加 preventScroll 的行落焦点。

**修复**:滚动恢复改为 **campaign**(30 rAF + 40×100ms 尾段 ≈4.5s 墙钟;`rescueApplied` 握手——滚动监听跳过 campaign 自身应用的中间值、真实滚动立即接管并正常持久化);`focusDefault` 行落焦加 `{preventScroll:true}`(键盘箭头行走仍按设计滚动)。

**验证**:tree-view rescue 测试组重写+3 新契约(中间值不落盘/接管持久化/有界放弃含尾段),全量 90 套件/3160 用例+lint 绿;diag-issue65-66-scroll 7/7、真弹窗矩阵全过、memory-layers 14/14、smoke PASS。

**根因实锤(维护者给出精确复现步骤后)**:步骤=高亮开→点开一个非空文件夹(焦点落文件夹行)→重开(文件夹高亮,正常)→滚到深处→重开→漂移。隔离探针(anchor-probe)实证 Chromium **滚动锚定(overflow-anchor)的锚点选择优先聚焦元素**:视口外的聚焦行会成为锚点,布局 settle 期间的高度增长触发锚定补偿时**把视口直接拽向焦点行**(探针:scrollTop 400→0,标记行被推离 900px)——这就是"漂移"的真身,也是 preventScroll 挡不住的原因(focus() 自身不滚了,但锚定补偿是布局变更触发的另一机制)。高亮关时无焦点行→锚点在视口内→补偿反而在**保护**视野,故无恙——开/关不对称彻底闭环。本地 harness 无法复现是因为其布局瞬间就绪、锚定无从介入。**修复**:高亮/焦点的**授予**等待树布局 settle 完成(campaign 期间 body 置 `data-vbm-tree-settling`,tree-view 的 reveal 焦点与 view-manager 的 restoreFocusSpot 均等待落地后再 focus(preventScroll);.focus 闪烁照常立即绘制);锚定本身**保留**(落地后它继续保护视野抵御迟到的内容增长)——注意 `overflow-anchor:none` 是错误方向(会连高亮关时的保护一起废掉),已论证并弃用。

**诚实记录**:本环境始终未能复现维护者所见症状;上述三路径是从代码审计推出的全部残余可能,均已封闭。若用户更新后仍复现,下一步应获取其复现条件(环境/关闭方式/症状形态/树规模/zoom),必要时出带 `__scrollTopLS` 写踪迹的诊断构建。

## 对外回复(已发布,issues 已关闭)· Public replies (posted 2026-09-03, issues closed as completed)

**→ issue #65**(@Ownsin,回复其"关闭高亮后不再记住位置"反馈;[评论链接](https://github.com/windviki/vBookmarks/issues/65#issuecomment-5526103389)):

> Reproduced and fixed — thanks for the clear follow-up.
>
> The position was being saved correctly, but two bugs could throw it away when the popup reopened: the restore ran before the freshly rendered tree was ready (clamping the position back to the top), and the highlight could scroll the view back to its row — turning the highlight off changed the symptom, not the cause.
>
> Both are fixed in **v4.1.2**, now live on the Chrome Web Store: the popup reopens exactly where you left it, and the highlight stays without ever moving the position.
>
> Closing as fixed — if you still see it after updating to 4.1.2, please comment and reopen. Thanks again!

**→ issue #66**(@leungwh;[评论链接](https://github.com/windviki/vBookmarks/issues/66#issuecomment-5526104180)):

> Thanks — your steps reproduced it exactly.
>
> Two bugs fought over the saved position on reopen: a restore that ran before the freshly rendered tree finished rendering (reset to the top), and the remembered row scrolling the view back to itself (shifted). The race between them is why it "often" landed either way.
>
> Both are fixed in **v4.1.2**, now live on the Chrome Web Store, verified in a real browser with your exact steps — including the click-a-bookmark, scroll-around-the-page, come-back flow.
>
> Closing as fixed — if anything is still off after updating, please comment and reopen. Thanks for the precise report!

## 记录 · Record

- 修复提交:`9c705125`(src×3 + 测试×3 + diag + modules.md 契约同步)→ `87c7c677`(diag 增 D 场景 + 前后对照);先行 `a6a95292`(df9617af 遗留的 `vitest/valid-title` lint 门,与本 issue 无关);`5a1e6576`(文档)。v4.1.2 版本提交与 changelog 见 git发布序列。
- 本文档由 `issue-65-highlight-toggle.md`(首轮开关实现档案)+ `issue-65-66-scroll-restore.md`(回归分析档案)于 2026-09-02 合并;首轮回复命令与授权记录见 git 历史(2026-08-30)。
- issue 状态:#65/#66 已关闭(completed,2026-09-03);**残余轮跟进中**(见上节,随下一版本发布后可在 #66 追加评论请用户复验)——v4.1.2 已推送并上架,上节回复随关贴出(`gh issue comment` + `gh issue close --reason completed`,windviki 授权账户);留 reopen 通道,用户若复现异常可再开。
- 版本实情:v4.1.2 最终还并入维护者的 announce 区间修正(`10f8b03b`,过期版本新闻不再排队补放,+7 契约测试,changelog 双语已补 `a413e4ab`)——与本 issue 无关,记录于此备查。
- 关联:#63(关窗丢写→localStorage 影子,本案存储侧免疫的基础)、#58(高亮恢复原始设计)、4.1.1 分层记忆设计(`docs/issues/issues-62-64-2026-08-29.md`)。
