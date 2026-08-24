# 4.1.0 发布前综合审计（2026-08-24）

> 范围：v4.0.8..HEAD（feature/recent-staging-view，76+ 提交）——暂存区工作台、标签组视图打磨、4.1.0 性能第二轮、折叠手术化。
> 方法：三门禁全量复跑（vitest 2875 / eslint / build self-check / i18n verify·audit·missing 全绿）+ 三路并行代码审计（暂存 UX / 性能方案 / 发布就绪）。
> 结论：**无发布阻断级代码缺陷**；主要欠账在 ①暂存区破坏性操作的撤销/确认语义缺口，②文档与 changelog 未跟上功能，③性能手段的三处覆盖缺口。以下按批次列出处置决定。

## A. 暂存区用户层缺陷（批次 A 修复）

| # | 级别 | 缺陷 | 位置 | 处置 |
|---|------|------|------|------|
| H1 | 高 | 「移出/删除」撤销丢失组归属——`staging.add` 只回填默认组，快照的 `group` 字段被丢弃，撤销后整理好的条目散回收件桶 | view-recent.js `removeSelected`/`deleteSelected`；staging.js `add` | 新增 `staging.restoreItems`，按快照重建 manual 组并回填组归属 |
| H2 | 高 | 「清空暂存区」完全没有撤销——`clearAll` 本就返回 items+groups 快照却被丢弃；这是视图内最 destructive 的动作 | view-recent.js `clearStaging` | 接 `restoreItems` 提供 toastAction 撤销 |
| H3 | 高 | 三处确认对话框肯定按钮误用 `_m('open')`（「打开」）——清空/移动/收录文件夹的确认键都写着"打开" | view-recent.js :1338/:1222/:1766 | 新键 `stagingClearConfirmOk`/`stagingMoveConfirmOk`/`stagingConfirmFolderOk`（43 locale 实译） |
| H4 | 高 | 快捷栏 del 按钮常驻 DOM 仅 CSS 隐藏，←/→ rung 走到 `display:none` 按钮时 focus 落空、行走"死掉" | view-recent.js :682；keyboard.js `firstEnabled` | 非编辑态不渲染 del 按钮（对齐"离开 DOM 而非 CSS 隐藏"的行按钮法则） |
| M1 | 中 | 「取消收藏」撤销把书签恢复进 quick-add 文件夹而非原父目录（快照缺 `parentId`） | view-recent.js `unfavSelected` | 删除前预取 `parentId`（对齐 deleteSelected 的 restorePlans 配方） |
| M2 | 中 | `favSelected` 撤销回调先改状态后查 `lastError`，失败时状态与树漂移 | view-recent.js :1086-1091 | 两行交换 |
| M3 | 中 | 键盘 `Delete` 在暂存行走 `actions.deleteBookmark`：已收藏行删真实书签、未收藏行静默 no-op——均与行内 × 按钮（移出暂存）语义不符 | keyboard.js :701-750 | `#staging-list` Delete 改走移出暂存+撤销 |
| M4 | 中 | >10 项移动确认复用 `dontConfirmOpenFolder`（打开标签页的豁免旗标），豁免打开确认的用户连带失去批量移动保护 | view-recent.js `applyMoveOrCopy` | 暂存专属豁免键 `stagingNoMoveConfirm`（默认仍确认） |
| M5 | 中 | 暂存引导条/历史记录 banner 按钮不可达：不在 Tab 环、不在 Esc 链 | view-recent.js :135-157；keyboard.js | 引导条加入 Esc 关闭层 + Tab 环（共享 risk-banner 待遇） |
| M6 | 中 | 「解散分组」无确认无撤销（比它轻的「删除分组」两者都有）；桶头「收藏全部」无撤销（对等的 `favSelected` 有） | view-recent.js `dissolveGroup`/`favAllBucket` | 均接 `restoreItems`/toastAction 撤销 |
| L1 | 低 | 撤销重加被 500 上限静默拒绝时 toast 仍报成功 | view-recent.js 撤销回调 | 检查 `full` 结果，失败 toast `stagingFull` |
| L3 | 低 | `applyMoveOrCopy` 双 persist+render 闪烁 | view-recent.js :1168-1177 | `removeByUrls` 前移合并 |
| L2/L4/L5 | 低 | 空源组残留/无键盘重排组/palette 无暂存管理命令 | — | 本轮不做，登记为后续打磨项 |

## B. 性能方案覆盖缺口（批次 B 修复）

| # | 级别 | 问题 | 处置 |
|---|------|------|------|
| P1a | 高 | `verify-scrollbars` 门禁未探测两个新增 content-visibility 视图（`#tabgroups-list`、`#staging-items`）——29b5306 那类 cv 污染 computed overflow 的回归在这两视图不会被拦 | VIEWS 表补两 panes |
| P1b | 高 | view-dead 给 pipes 模式传 `adaptive` 等选项但 pipes 泵从不调用 `adapt()`（自适应仅在单列表模式实现），配置是死的且与 view-recent 注释的"dead-view law"矛盾 | 删除 view-dead 的死配置项，pipes 语义以代码为准 |
| P2a | 中 | fold 与分片流竞态（f9d9e1b 修的那类）无单测钉住 | 新增 rAF double + 流中 fold 的回归测试 |
| P3 | 中 | view-stats 整表 innerHTML 单任务（6000 书签档位） | 接 `paintListChunked` |
| P4 | 低 | virtual fold() 对未访问 piece 用 28px 估值补偿，宽/panel 双行行下滚动条轻微漂移（实验室旗标默认关） | 保持现状，virtual-list.js 补注释说明 |
| P5 | 低 | perf-round2-audit §5.1/§5.4 "待复测数据"标记未回填；staging 性能证据只在 plan-velvet 迭代记录里，4.1.0 计划附录无指针 | 文档补指针；dead 视图空闲态补一次 diag 复测记录为"以 §4b 汇总表为准" |

**明确不做**（已审计确认合理）：树视图整表渲染（plan §4.5 裁决）、搜索结果（100 上限）、recent 行（recentCount 约束）、favicons 画廊分片（非弹窗路径、刻意打开的低频页面）。

## C. 发布文档缺口（批次 C 修复）

| # | 问题 | 处置 |
|---|------|------|
| C1 | `docs/README(.zh).md` v4.1.0 changelog 只有标签组视图 5 条，整个暂存区功能（30+ 提交）、性能轮、Fixed/Changed 段全部缺失 | 双语补齐（gap-fill） |
| C2 | `docs/guide-v4(.zh).md` §3.3 仍描述纯时间桶"最近视图"，暂存工作台零覆盖 | 双语重写 §3.3 |
| C3 | `announceV410Text`/what's-new 只提标签组 | 双语补暂存区一句 |
| C4 | README 特性行第七个 tab 仍叫 "Recent" | 双语更新 |

**已验证无需动作**：modules.md 与 src 同步；options 页对新设置全覆盖；popup/sidepanel 脚本奇偶性；manifest 权限/版本；runtime-files.json 与 esbuild 残留检查；新代码零 TODO/console 残留；virtualScrollLab 默认关且翻旗重渲染链完整。

## 验收门禁

每批次完成后：`npm run test:run` + `npm run lint` + `npm run build` + `python3 scripts/i18n.py verify/missing/audit`；A/B 批次各带新增单测。

## 验收记录（2026-08-24 收口）

- 批次提交：9db0bc1（审计落盘）→ 293b3f9（批次A/C）→ afd6333（批次B）→ aedcf0e（whats-new 文案补正）
- 单测 2881/2881（新增 restoreItems 5 例 + pipes 自适应/fold 流竞态 2 例）；eslint、build self-check、i18n verify/missing/audit 全绿
- 真机门禁：`run.sh --smoke-only`（源码根）与 `run.sh --dist --smoke-only` PASS（NO PAGE ERRORS）；`run.sh --dist` 全量 ALL PASS（smoke/keyboard/scrollbar/folder-menu 4 套，scrollbar 门禁已含新增 #staging-list 与 #tabgroups-list panes）
- whats-new 横幅实际文案源是 `whatsNewTabGroups` 而非 `announceV410Text`——真机 smoke 暴露后已同步补暂存区文案（两键 43 locale 均实译）
- 登记不做：L2 空源组残留（无害）、L4 组键盘重排、L5 palette 暂存管理命令、virtualScrollLab 默认翻转（保持浸泡）、死链空闲态 diag 单独复测（以 §4b 汇总口径为准）
