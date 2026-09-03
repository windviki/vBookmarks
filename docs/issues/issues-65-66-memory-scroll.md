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
- issue 状态:**已关闭(completed,2026-09-03)**——v4.1.2 已推送并上架,上节回复随关贴出(`gh issue comment` + `gh issue close --reason completed`,windviki 授权账户);留 reopen 通道,用户若复现异常可再开。
- 版本实情:v4.1.2 最终还并入维护者的 announce 区间修正(`10f8b03b`,过期版本新闻不再排队补放,+7 契约测试,changelog 双语已补 `a413e4ab`)——与本 issue 无关,记录于此备查。
- 关联:#63(关窗丢写→localStorage 影子,本案存储侧免疫的基础)、#58(高亮恢复原始设计)、4.1.1 分层记忆设计(`docs/issues/issues-62-64-2026-08-29.md`)。
