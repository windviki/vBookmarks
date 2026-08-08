# v4.0.1 整体抛光审阅档案

2026-08-07 对 `7fea4d1..HEAD`(云端 4.0 → 本地 4.0.1,40 个提交)做的一轮整体抛光审阅:先按区域出 8 份审阅报告,再由总计划汇总成统一的问题清单、处置决定与修复批次(W1-B1…B5、W4 截图重拍、W3 文档回填)。

**用途**:4.0.1 抛光审阅的存档,供后续版本对齐查阅——改动某个区域前先看对应报告,可以少踩一遍已经趟过的坑;总计划的决策记录解释了每个"修/文案/记录/不动"取舍的理由。

## 索引

- **00-master-plan.md** — 总问题清单与修复计划:每个问题的严重度(P0–P3)/处置/批次,外加 6 条站在用户角度的决策记录与批次文件归属。
- **01-keyboard-focus.md** — 键盘导航与焦点管理:菜单打开首 ↓ 死锁、palette Esc 穿透、F2/Delete 根文件夹守卫等(K1–K12),附测试覆盖缺口。
- **02-dropdown.md** — 统一自绘下拉组件(src/dropdown.js):dupes 工具行 Home 崩溃、Esc 层级、listbox 悬空等(D1–D10),含"自绘 vs 原生 select"评估。
- **03-dead-links.md** — 死链:批量删除、代理整合(`deadProxyTemplate` 退役)、徽标计数同步(X1–X7)。
- **04-tab-groups.md** — 标签组打开/入组 SW 管线:已有组选择器色点透明、对话框守卫缺口、SW 失败路径(T1–T10),附打包脚本评估。
- **05-sorting-stats.md** — 文件夹排序(#33 两轮)与统计视图合并:递归排序全层级可撤销、并发锁、`onMoved` 防抖、☆ 查重(S1–S9)。
- **06-version-packaging.md** — 版本机制重构(`src/version.js`)与 4.0.1 静默补丁定性、#49 `onChanged` 竞态、package.py 递归 import 解析(V1–V5)。
- **07-visual-css.md** — 视觉样式整体审计:下拉键盘焦点可见性、`color-scheme`、RTL 逻辑属性、token 焦点环等(C1–C18)。
- **08-docs-sync.md** — 文档同步差距审计:README/guide/AGENTS/keyboard-model 的精确漂移清单(W3 文档回填批次的依据)。
- **09-keyboard-agent01-extra.md** — 报告 01 的补充调研差分:只收录 01 未覆盖的新增问题,已收录者仅做索引。

## 结果摘要

- **P0 全部修复**:K1–K4(键盘/焦点)、D1/D4(下拉)、X1(死链重扫入口)、S1(递归排序撤销)、T1(标签组色点);P1/P2 随各修复批次落地,P3 项记录 backlog 不动。
- **测试**:vitest **50 套件 / 1629 例**全绿(含新增的 dropdown/version/tab-groups-sw/options-proxy/sort-folder/focus-regression 套件)。
- **文档**:各开发/用户文档按 08 号报告的差距清单回填(W3 批次),与最终实现对齐。
