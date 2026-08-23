# vBookmarks 4.1.0 性能批次审计报告（去重 / 标签组 / 全视图性能复核）

> 状态：调研 + 优化实施 + 复测全部完成（2026-08-23）。优化共 5 个功能提交（`aae2dfe`..`794f0f2`），复测数据见 §4b/§7，门禁与打包见 §8。
> 范围：master @ `0b7bd54`（暂存视图分支合并之后的主线），重点审计去重与标签组视图的优化批次，并整体探测其余视图（死链/扫描渲染/冷开/统计/最近）的剩余优化空间。
> 探针：`scripts/harness/diag/diag-41x-perf.js`（CDP Profiler 函数级热点）+ `scripts/harness/perf-popup.js` + `tmp/micro-bench.mjs`（真实模块微基准）。真实规模：6000 书签树、2500+ 重复组、1200+ 标签页、160 标签组。

---

## 1. 审计范围与提交清单

暂存视图（feature/recent-staging-view）批次落主线之后，性能相关提交（`git log` 倒序）：

| commit | 主题 | 类别 |
|---|---|---|
| `0b7bd54` | 虚拟滚动实验室开关（virtualScrollLab，默认关） | P2 预置 |
| `aa6defa` | 4.1.0 终测数据回填（文档） | docs |
| `0029202` | list-chunks 行片段必须注入 `<ul>` 内部（D1 回归修复） | fix |
| `29b5306` | content-visibility 选择器排除 `#recent-list`（scrollbars 门禁回归） | fix |
| `9b6d918` | findDupes 按原始 URL 串 memo normalizeUrl | perf |
| `a1f06da` | 分片渲染 + content-visibility（list-chunks.js；标签组/去重接入） | perf |
| `1555d9d` | 标签组数据路径四项优化（并行 IPC/书签脏标记/Map 化分桶/i18n 提升）+ favicon 模板 clone | perf |
| `0fb891d` | diag-41x-perf CDP Profiler 函数级热点探针 | 工具 |
| `8b01d0f` | favicon dark 分支彩度防护（质量，非性能） | fix |
| `a882801`/`de73083`/`e8e3ebe`/`781b24a`/`dbca45b` 等 | 标签组视图打磨批次 A/B/C/D/E + 已关闭区 | feat |

工作树干净（`git status` clean），master 领先 origin/master 117 提交。

---

## 2. 总体结论

- **方向正确、工程质量高**：每一个性能改动都带着真实探针数据（diag-41x-perf）、门禁回归记录（D1 `ul` 注入、recent cv 排除）与单测；list-chunks 的退化路径（无 rAF/测试 double/小列表）设计完整。
- **数据路径优化到位**：标签组激活首内容 1064→239ms（-78%），总 wall 1414→680ms（-52%）；去重 regroup 2372-2738→1071-1136ms（-57%）。IPC 并行、书签脏标记、Map 化分桶、normalizeUrl memo 都是正确的杠杆，且没有牺牲正确性。
- **尚有可压榨空间**（本文 §5/§6 逐一实施）：死链视图扫描中的全量重渲染、list-chunks 固定分片不自适应、去重视图未做 i18n 提升、标签组组头 i18n 仍有 ~900 次/渲染、虚拟滚动行高估算等。

---

## 3. 逐提交审查

### 3.1 `1555d9d` 标签组数据路径四项优化 — 合理 ✅

1. **三路 IPC 并行**：windows.getAll / tabGroups.query / bookmarks.getTree 同时发射，`need = 2 + treeWanted` 计数落地，token 防陈旧回调覆盖。正确。
2. **书签树脏标记**：`bookmarksDirty` 只在书签事件翻转；标签事件风暴不再重走 getTree（实测 53-106ms/次）。正确且语义完整（onChanged/onCreated/onRemoved 三类都翻转）。
3. **Map 化 + 单趟分桶**：`tabMap`/`groupMap` 随数组赋值重建；`membersByGid` 一趟分桶替代 O(tabs×groups)。正确；`needle` 分支保留 per-group filter 是刻意的（组名命中显示整组）。
4. **每渲染 i18n 提升**：`L` 字典解析一次下发。方向正确，但**提升不彻底**——组头 `groupHeadHtml` 仍然每渲染 ~5×组数 次 `_m()`（160 组 ≈ 800 次调用，实测 getUILanguage 自耗时 16.9ms/重渲染与此相关）。见 §5.3。
5. **favicon 占位 SVG 模板 clone**：一次解析按需 clone，1371 行仍 20-30ms cloneNode（已足够）。

### 3.2 `a1f06da` 分片渲染 + content-visibility — 合理 ✅，三处可改进

- list-chunks.js 的合同设计（head 同步 paint、rAF 批次、cancel 防竞态、退化路径）完整；`0029202` 修复的 `ul` 注入问题是真实解析器语义问题，修得对。
- **`first`/`chunk` 固定死**（去重 30/60、标签组 80/160）：2508 行去重需要 42 个 rAF 批 ≈ 672ms 的纯调度下界；真实用户 2500+ 重复组（~7500 行）要 126 批 ≈ 2s。分片大小应与机器/行重自适应（见 §5.1）。
- **onChunk 回调在每批做全表查询重试**：去重视图的 `tryHeadFocus` 每批 `querySelectorAll('li.dupes-group')` 全表扫描 42 次，`tryMemberFocus` 每批 `getElementById`——O(批次×行数)。应把目标行定位到 piece 索引、只在目标已落入的批次重试（见 §5.2）。
- content-visibility 选择器覆盖面正确（标签组/去重/死链/统计的 `li` 行），`#recent-list` 排除有理有据（recentCount 上限 + scrollbars 门禁实测）。**注意**：`#dead-list` 虽已纳入 cv，但死链视图渲染路径本身没有接入 list-chunks——空闲态上千行结果集仍是一次性 innerHTML（见 §5.4）。

### 3.3 `9b6d918` findDupes memo — 合理 ✅

按原始 URL 串 memo 的理由成立（重复副本天然同串），实测 findDupes 自耗时仅 4.9-5.4ms（6000 书签）。`ignoreScheme` 分支在 memo 之后做 replace 是正确的（不污染缓存）。

### 3.4 `0b7bd54` 虚拟滚动实验室 — 预置合理 ✅，转正需两项补齐

- 已知局限（行高估算→滚动条漂移、End/Home 落在已渲染行、clamped-index 恢复近似）记录诚实。
- **标签组视图存在行级 DnD**（dragstart/drop 移动标签页），虚拟化默认开启会破坏拖放目标（目标行可能不在 DOM）；去重视图无 DnD。
- 转正前置条件见 §5.5：行高实测化（渲染过的窗口用真实行高更新前缀和）是消除滚动条漂移的关键，实现后仍建议保持去重/标签组「去重先转、标签组留 chunked 或保持实验开关」的分级策略。

### 3.5 修复批次 `0029202` / `29b5306` — 门禁捕获真实，修复正确 ✅

两个回归都是字符串级 double/单测看不见、真实解析器/门禁才能抓到的（`</ul>` 之后追加 `<li>` 沦为兄弟节点；cv 干扰 computed overflow-x）。修复方式正确且附了复现脚本。

---

## 4. 实测基线（master @ `0b7bd54`，diag-41x-perf 重跑）

种子：6000 书签 / 25% 重复率（500 组 × 4 行 = 2508 行）；标签工作负载：4 窗口 × (40 组 × 6 标签 + 60 散标签) = 1371 行。

| 相位 | wall | scripting | 布局数 | 首 DOM | 末 DOM |
|---|---|---|---|---|---|
| 标签组激活（首跑） | 1021ms | 382.6ms | 12 | 241.8ms | 733.3ms |
| 标签组重渲染（刷新点击） | 943-1096ms | 454-630ms | 7 | — | — |
| 去重 regroup（onCreated 触发） | 1033-1085ms | 528-588ms | 16 | — | — |

函数级热点（run 1）：

- **标签组重渲染**：insertAdjacentHTML 254.9ms(11.5%) / **GC 225.5ms(10.2%)** / (program) 217.6ms / cloneNode 30.2ms / **getUILanguage 16.9ms** / replaceChild 15.3ms。IPC：windows.getAll 41-45ms + tabGroups.query 43-46ms。
- **去重 regroup**：(program) 331ms(20.4%) / insertAdjacentHTML 322.1ms(19.8%) / GC 49.3ms / renderGroup 32.6ms / normalizeUrl 21.2ms / URL 9.4ms / generateBookmarkHTML 9.4ms。
- 激活相位 IPC：windows.getAll 44.5ms + tabGroups.query 46.8ms + getTree 80.5ms（三路已并行，总成本 ≈ max(三路) + join）。

微基准（node，真实模块，6000 书签/2500 组）：findDupes 32.3ms/次；generateBookmarkHTML 当前配方 94.6ms/5000 行；`toLocaleDateString` 与 Intl.DateTimeFormat 差异仅 ~7-12%（现代 V8 已缓存 ICU，**不做** Intl 替换——收益不达判据）；getFaviconUrl 3.2ms/6000（**不做** memo——收益 <10%）。

## 4b. 优化后复测（同探针、同负载）

| 相位 | 优化前 | 优化后 | Δ |
|---|---|---|---|
| 标签组重渲染 wall（中位） | ~1015ms | ~909ms | **-10%** |
| 标签组重渲染 scripting（中位） | ~501ms | ~408ms | **-19%** |
| 标签组重渲染 GC 自耗时 | 225.5ms | 53ms | **-76%** |
| 标签组重渲染 getUILanguage 自耗时 | 16.9ms | 退出热点榜 | — |
| 去重 regroup wall（500 组，中位） | ~1065ms | ~958ms | **-10%** |
| 去重 regroup scripting（中位） | ~584ms | ~556ms | -5%（parse 主导，随行数不随调用数） |
| 去重 regroup GC 自耗时 | 49.3ms | 30-45ms | 下降 |

**真实量级（2520 重复组 / 7568 行——VBM_DUP_COPIES=1 VBM_PERF_DUP_RATIO=0.42，本次新增探针旋钮）**：

| 绘制路径 | wall（中位） | scripting（中位） | DOM 行数 |
|---|---|---|---|
| 分片流式（当前默认） | ~1370ms | ~968ms | 7568（全量） |
| 虚拟滚动（实验室开关） | ~900ms | ~352ms | ~29（视口窗） |

**死链扫描 tick 探针**（diag-dead-ticks.js，混合负载：瞬时拒绝 + 挂起 URL，2000 书签）：117 次 blob 发布、333 次连续采样中结果 `<ul>` 节点身份始终不变（唯一变化发生在扫描结束的缓存落地渲染，且该渲染以 60+100×N 分片流入），单次发布新增节点 ≈121 行（纯增量）——旧实现每 tick 重建全表并重取全部 favicon。增量渲染真机验证通过。

---

## 5. 查漏补缺清单（按优先级，实施后回填状态）

### 5.1 [P1] list-chunks 自适应分片 — ✅ 已实施（待复测数据）
固定 30/60（去重）与 80/160（标签组）不随设备与行重伸缩；真实 2500+ 组（~7500 行）需 ~126 帧纯调度。已改为**按实测插入成本自适应**：首片画完测一次 parse 成本，后续每片按预算（budgetMs 16ms，[min,max] 夹取：去重 24-240、标签组 48-320、死链 40-300）伸缩；`onChunk(list, from, end)` 携带切片边界；新增 `pipes` 多 `<ul>` 流式模式（死链结果列表 + 标注残留列表同一次 head 绘制）。单列表模式行为不变，8 例单测。

### 5.2 [P1] 去重/标签组 onChunk 全表重试 — ✅ 已实施（待复测数据）
render() 构建 piece 索引（`groupPieceIdx`/`memberPieceIdx`/`currentPieceIdx`），`tryHeadFocus`/`tryMemberFocus`/`tryScrollToCurrent` 只在目标 piece 已落地的批次重试，其余批次零 DOM 查询；settle 时仍兜底全量重试（虚拟滚动路径沿用按批重试）。

### 5.3 [P1] 去重/标签组/死链 i18n 提升 — ✅ 已实施（待复测数据）
- 去重 `renderGroup`：成员行 4 次/行的 `_m()` 提升为渲染级 `L` 字典（keepThis/rowDelete/noTitle + 组级 groupCount/cleanRestHint）——2500 组 × 2 成员 = 20000 次 getMessage 降至 ~5000+8。
- 标签组 `groupHeadHtml`：activate/rename/save/sleep/wake/close/untitled 提升为渲染级 `G` 字典（~800 次/渲染 → 常数次）。
- 死链 `rowLiHtml`/`markedLiHtml`：mark/unmark/delete/时间标签等 6-10 次/行提升为渲染级 `L` 字典。

### 5.4 [P0] 死链视图渲染性能 — ✅ 已实施（待复测数据）
1. **扫描中增量渲染**：blob 每 700ms 发布只做——工具栏原地 `outerHTML` 补丁（焦点 park/restore）+ 按树序把**新增**问题行插到正确位置（`liveDom.rendered`/`markedIds` 记账；行从未重绘、favicon 不再闪烁）。标注残留集合变化（标记移动/新标记/run 更换/选择模式/测试 double）时自动回退整表重绘。含 1 例专项单测（树序插入 + ul 身份稳定）。
2. **空闲态分片渲染**：结果/残留列表走 list-chunks pipes（head 一次绘制，两 ul 并行流式；60 首片 / 100 每批）；扫描完成、筛选/排序切换、标记批量操作的上千行结果不再一次性解析。测试 double（无 query/insert 原语）保持旧整串渲染路径（D1 教训：字符串模型不能证明 ul 契约）。
3. **SW 侧**（P2，暂不做）：blob 每 tick 全量 JSON（6000 行 ≈ 600KB/tick）在页面侧不再全量重绘后影响有限，记录为后续增量 journal 选项。

### 5.5 [P2] 虚拟滚动转正前置 — ✅ 已实施 + 决策数据见 §7.1
`virtual-list.js` 行高**渲染后实测**：每个窗口落地后按 piece 实测 li `offsetHeight`，前缀和重建，paddings 用新几何——宽/panel 双行行不再漂移滚动条；不可测环境（测试 double / 未布局的 cv 行）保留估算。真实量级复测：虚拟 wall -34% / scripting -64%（§4b）。含 1 例测量单测。

### 5.6 [P3] 已评估不做（微基准不达判据）
- `toLocaleDateString/toLocaleString` → Intl 缓存：node/V8 实测收益 7-12%，不做。
- getFaviconUrl memo：树/列表 URL 复用率低（树每行唯一；去重成员同组才复用），实测 <10%，不做。
- parkRowFocus 的 querySelectorAll('li') 索引扫描：实测 0.05ms/5000 行，不做。
- 行级 markup 瘦身（去 title 属性等）：行为/tooltip 契约与测试锁定，收益与风险不成比例，不做。

---

## 6. 其余视图探测结论

| 视图 | 结论 |
|---|---|
| 树（冷开） | P1 单趟快照后 scripting 中位 ~126-154ms（4.1.0 附录 A），6000 行一次 innerHTML 是唯一长任务；树不接分片/cv（几何与 DnD 敏感，计划 §4.5 已裁定），维持现状 ✅ |
| 最近 | recentCount 上限约束（默认 20 行），无优化空间 ✅ |
| 统计 | 行数受访问历史约束，cv 已覆盖；`toLocaleString` 微成本（同 §5.6 不做）✅ |
| 搜索 | 首搜懒构建索引 + dirty 标记已落地，未发现新热点 ✅ |
| 死链 | 见 §5.4，是剩余最大单项 ⬜ |

---

## 7. 实施记录（已全部落地并验证）

| 项 | 提交 | 内容与实测 |
|---|---|---|
| 5.1 自适应分片 + pipes | `aae2dfe` | list-chunks 实测成本自适应（预算 16ms）+ onChunk 区间 + pipes 多 ul；+6 单测 |
| 5.2/5.3 去重/标签组 | `502a1d2` | 去重成员行 i18n 提升（-15000 次 getMessage@2500 组）+ 焦点重试定点 + 组头 i18n（getUILanguage 16.9ms 从热点消失）+ adaptive 接入 |
| 5.4 死链增量渲染 | `945b5df` | 扫描中增量渲染 + 空闲态 pipes 分片 + 行级 i18n；真机 tick 探针：333 次采样 ul 身份不变、每 tick 仅新增行；+1 专项单测 |
| 5.5 虚拟行高实测 | `494ffb6` | 渲染后实测行高重建前缀和；2500 组复测：虚拟 wall -34% / scripting -64% vs 分片；+1 单测 |
| 探针增强 | `794f0f2` | VBM_DUP_COPIES（1=双条目组，还原维护者 2500+ 组真实形状）、VBM_DIAG_VIRTUAL、diag-dead-ticks.js、rerun.sh 环境透传、protocolTimeout 修复 |

### 7.1 虚拟滚动转正决策（数据 + 建议，未默认开启）

真实量级下虚拟相对分片：wall 900 vs 1370ms（-34%）、scripting 352 vs 968ms（-64%）、DOM 29 vs 7568 行——且每次 regroup 的 O(视口) 渲染账单让「书签事件风暴下的重渲染」从秒级降为亚秒级。行高实测化后滚动条已收敛。**仍不默认开启的两条理由**：① 去重视图的 End/Home 在虚拟下落在「已渲染行」而非真实首/末行（键盘语义变化，需 keyboard.js 与虚拟 painter 增加 jump-to-edge 契约后才能无损转正）；② 标签组视图存在行级拖拽，目标行可能不在 DOM（保持分片）。转正路径已收敛为两步：a) `view-dupes.js` 的 `virtualScrollLab` 读取默认值 ''→'1' + 选项页文案更新（一行 + 两处文案）；b) 补 jump-to-edge 契约后标签组再评估。建议维护者在真实设备 soak 一周后执行 a。

---

## 8. 验收口径与实测结果

- 功能门禁：`npm run test:run` **2711/2711**（82 套，+14 新例）；`npm run lint` **0 错**；`npm run build` 自检 **PASS**（78 文件 / 15 JS）；`npm run test:webstore` **29/29**。
- 真机门禁：源码 `--smoke-only` **PASS**、dist `--smoke-only` **PASS**（本批改动后）；源码全量 harness **PASS 4 / FAIL 0**（smoke + 键盘 156/0 + 滚动条 748）。
- 性能复测：diag-41x-perf 500 组 + 2520 组双负载对比 §4/§4b；数据已回填本文档，`docs/plan-4.1.0/build-and-performance-plan.md` 附录 A 同步补充。
- 打包：`npm run package` 产出 `tmp/vBookmarks_4.1.0.zip`（872.6 KB，78 文件）。
