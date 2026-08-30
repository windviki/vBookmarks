# Issue #65 — 树视图"上次打开的书签"高亮开关 · Analysis & reply（2026-08-30）

> **Please give us the option to disable highlighting the last picked bookmark in the tree.**
> — @Ownsin, 2026-08, https://github.com/windviki/vBookmarks/issues/65

## 分析 · Analysis

**请求合理,且与既有方向吻合**。"重开弹窗时高亮上一次打开/聚焦的书签行"是 issue #58 时代引入的恢复行为(focusID 行重亮 + `.focus` 闪烁),此前只有一个总开关「记住之前的状态」(`dontRememberState`)——用户想要的是**只关掉高亮、保留其余记忆**的细粒度控制。2026-08-29 的 #64 分诊已经把"用户请求可禁用上次书签高亮"列为分层记忆的需求来源之一,本 issue 是该需求的独立原始报告。

**实现(4.1.1,选项页对应完毕)**:选项页新增独立「记忆」组(第 21 组)——总闸「记住上次状态」+ 四个剔除子项:**高亮上次打开的书签**(即本 issue 所求,默认开)、记住滚动位置、记住展开的文件夹、记住上次的搜索词;「记住上次的视图」随组迁入但语义独立、不随总闸灰显。默认全开 = 现状零变化。门控拆层:

- **树视图**:`focusID` 行重亮/焦点接管/4 秒迟清理,仅高亮层开时执行;层关时 stale `focusID` 立即清除;
- **列表视图(搜索/最近/统计等)**:`focusSpot` 捕获与恢复、每视图记住行标记(`viewState.focus` 字段)同受高亮层门控——开关对全部视图生效,不只是树;
- 总闸关 = 四个子层全部不恢复(子项灰显提示从属关系)。

**可靠性加固**(4.1.1 复验轮):popup 关闭路径上 `pagehide` 不保证触发,最后一条 `focusID`/`focusSpot` 写入(恰在点书签→关窗的防抖窗口内)可能随页面死亡丢失,表现为"开关开着但高亮时有时无"——已按 issue #63 的 scrollTop 先例补同步 localStorage 影子键(`__focusIDLS`/`__focusSpotLS`),关窗再急也不丢。另有组合矩阵测试(总闸×四子层×视图开关)与真浏览器 E2E 探针双向直证。

**结论**:已在 4.1.1 选项页实现对应开关,随版本发布。

## 对外回复(已发布到 GitHub)· Public reply (posted)

> Good news — this ships in **v4.1.1**. The options page now has a dedicated **Memory** group: a master "Remember previous state" switch plus four independent sub-toggles — **Highlight the last opened bookmark** (exactly what you asked for, on by default), Remember the scroll position, Remember opened folders, and Remember the last search. Turning off just the highlight keeps every other memory working, and it applies to all views (the tree as well as the list views). v4.1.1 is being prepared for release right now.
>
> Thanks for the suggestion!

## 记录 · Record

- 回复命令:`gh issue comment 65 --repo windviki/vBookmarks --body-file docs/issues/issue-65-reply.md`(2026-08-30,windviki 授权)
- 实现提交:`d73364a5`(分层记忆组)+ `f1f78b35`(选项页接线测试与 i18n 基准修复)+ `3d10aa53`(关闭路径丢写加固)+ `a9d03a2e`(组合矩阵测试)
