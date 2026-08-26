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

## 覆盖缺口（全部已闭合，2026-08-26 第二轮补齐）

1. ✅ 宿主视图行内「发送到暂存」hover 按钮的点击接线 — search 行按钮
   toggle（add → remove）单测（tests/search.test.js）；view-dead 三入口
   （dead-stage-all / dead-stage-selected / 行按钮）单测（tests/view-dead.test.js）。
2. ✅ view-dupes 整组暂存 stageGroupByKey — 整组 add 快照 + 全暂存反转为
   remove 的单测（tests/view-dupes.test.js）。
3. ✅ view-dead 暂存入口 — 同上（G1/G3 一起闭合）。
4. ✅ view-tabgroups foldGroupSurgically（组折叠）— 真机探针
   `diag/diag-tg-group-fold.js`（折叠摘除成员 + aria-expanded + 展开还原）。
5. ✅ view-tabgroups 窗口头拖拽手势 — `diag/diag-tg-window-merge.js` 真机全链路
   （视图层单测缺口由真机覆盖，接受）。
6. ✅ view-tabgroups `stageClosedGroup` / `stageClosedTab` — 单测（纯快照、
   0 bookmarkable → toast；stageClosedTab 补暴露进模块 API）。
7. ✅ virtualScrollLab 视图采纳 — 单测（storage listener adopt + re-render 接线，
   tests/view-tabgroups.test.js）+ `diag/diag-virtual-lab.js` 真机（开/关/live
   switch/滚动重窗）。
8. ✅ tree-render `buildTreeSnapshot.urlIndex` — 直接断言（全树映射 + 重复
   URL 取首个 id，tests/tree-render.test.js）。
9. ✅ quick-add 星标按钮点击接线 — 绑定下沉进 src/quick-add.js（模块可测），
   单测「点击星标 → 创建书签」（tests/quick-add.test.js）。
10. ✅ context-menu `folder-new-incognito-window` 派发 — 单测（urls + incognito
    =true，tests/context-menu.test.js）。

## 验收建议

- 全部门禁：vitest 全量 + lint + 真机 smoke/keyboard/scrollbar/menu + 本表
  已闭合的全部 diag（发版前置）；
- 新增 diag 均随代码提交（diag-search-history-click / diag-tg-group-stage /
  diag-staging-disabled-view / diag-tg-group-fold 等）。
