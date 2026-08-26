# 4.1.0 验收覆盖审计（2026-08-26）

审计对象：`feature/recent-staging-view` 分支（4.1.0 全部新功能入口 × 测试覆盖）。
方法：逐模块对照 `docs/agents/modules.md` 声明的行为契约与 `tests/` 套件、
`scripts/harness/` 真机门禁（smoke/keyboard/scrollbar/menu）+ `diag/` 探针。

## 结论

核心覆盖充足：view-recent（含暂存 DnD、折叠手术、选择模式）、staging.js、
staging-relay.js、list-chunks.js、virtual-list.js 内核、search（历史行点击
rerun + search-stage-all 已测）、tab-groups-sw、visit-stats-sw、dead-scan-sw、
view-manager、context-menu（4.1.0 四个 tab 菜单）、palette/palette-commands、
quick-add/tool-button 模块层、tree-render。未发现新增错误路径。

## 已闭合的风险点

| 风险点 | 状态 |
|---|---|
| 搜索历史行点击 rerun（4.0.8 遗留「最近搜索列表无法点击」） | ✅ 代码正常；`diag/diag-search-history-click.js` 回归探针 PASS |
| 标签组整组发送（stageTabGroup） | ✅ 修复 numeric-vs-string groupId + 命名分组落地；单测 + `diag/diag-tg-group-stage.js` |
| 窗口头拖曳合并 | ✅ SW 单测 + `diag/diag-tg-window-merge.js` 全链路 |
| 标签拖到窗口组头 | ✅ 单测 + `diag/diag-tg-tab-to-head.js` |
| 暂存区对齐（正常/选择 × 窄/宽） | ✅ `diag/diag-staging-geometry.js` 四形态三律全等 |
| 最近区组头发送实心图标 | ✅ `diag/diag-recent-stage-flip.js` |
| 禁用暂存视图 = 关闭暂存功能 | ✅ 单测 + `diag/diag-staging-disabled-view.js` |
| 经典模式恢复 | ✅ 单测（含 treeRowActions） |
| SW 书签事件 → rebuildIndex 崩溃 | ✅ 单测 + 修复（f44cc89） |

## 覆盖缺口（按严重度，供后续批次补测）

1. ~~宿主视图行内「发送到暂存」hover 按钮的点击接线~~ — ✅ 已补：search 行
   按钮 toggle（add → remove）单测（tests/search.test.js）；view-dead /
   view-stats 行按钮仍缺，随下次批次。
2. ~~view-dupes 整组暂存 stageGroupByKey~~ — ✅ 已补：整组 add 快照 + 全暂存
   反转为 remove 的单测（tests/view-dupes.test.js）。
3. **view-dead 的 dead-stage-all / dead-stage-selected** 零测试（待补）。
4. ~~view-tabgroups foldGroupSurgically（组折叠）~~ — ✅ 已补真机探针
   `diag/diag-tg-group-fold.js`（折叠摘除成员 + aria-expanded + 展开还原）；
   单测仍走 render() 回退（DOM 双元能力限制），可接受。
5. **view-tabgroups 窗口头拖拽手势**视图层无测试（SW mergeTabsAsGroup 已测）——
   `diag/diag-tg-window-merge.js` 已真机覆盖，单测缺口可接受。
6. **view-tabgroups `stageClosedGroup` / `stageClosedTab`** 视图函数与
   closed-group stage-all 菜单派发未测（待补）。
7. **virtualScrollLab 视图采纳**（view-tabgroups/view-dupes 的 virtualLab=true
   分支 + storage.onChanged live switch）无单测（virtual-list 内核已测）。
8. **tree-render `buildTreeSnapshot.urlIndex`** 构建无直接断言（消费端人工
   Map 已测）。
9. **quick-add 星标按钮点击接线**（neat.js）未单测（模块函数与 Ctrl+D 已测；
   tool-button 点击已测；真机只测可见性/Tab 焦点）。
10. **context-menu `folder-new-incognito-window` 派发**无单测（action 与
    staging-group-new-incognito 派发已测）。

## 验收建议

- 缺口 3（view-dead 暂存入口）、6（closed-group 暂存）随下次改动批次补；
- 缺口 7–10 风险低（内核/模块层已测），记录为已知覆盖边界；
- 真机门禁（smoke/keyboard/scrollbar/menu + 本表已闭合的 diag）为发版前置；
- 发版前重跑全量 vitest + 全部 diag 清单（见「已闭合的风险点」表）。
