# view-system 分支合并评估报告

> 日期：2026-07-29。评估人：master 侧维护实现。
> 结论先行：**master 在全部对比面上保持领先，无架构级吸收项**；从 view-system
> 吸收了 1 份文档、1 个 Docker 验证脚本（适配移植）、2 条 CSS、1 个纯函数、
> 1 组契约断言、1 个"去重"思路（落地为共享 helper），并顺手修复了评估中发现的
> **master 自身打包缺口**（`src/panel-behavior.js` 未登记，打包即坏 SW——最高
> 优先级）。全部改动已通过 1103 单测（37 文件）、i18n verify（0 错误）、打包
> 校验与 Docker 冒烟+键盘验证。

## 1. 背景与方法

两分支同源 `5edc546`，各自独立实现了 `docs/plan-4.0.0/v4task-2.md`（视图化 Tabs/Views
重构）与 `docs/plan-4.0.0/v4task-2-list.md`（行呈现与键盘交互规范——两分支逐字一致）：

- **master**（我方）：57 提交，切片 A/A2/B/C/D/E + 六轮迭代修订，设计文档已
  回写至"已完成"状态（附录 B–E 记录全部设计偏离与修订）。
- **view-system**（对方）：28 提交，实现至其自身第四轮修复，设计文档停留在
  "待评审 v3"。

评估方法：按面拆解（键盘/焦点模型、Esc 分层、搜索视图与历史、四个功能视图、
右键菜单、sync 指示器、options、palette、i18n、打包清单、测试设施），逐面对
读两边实现并核对每个提交的实质内容。判据：行为正确性 > 规范符合度（以 master
回写后的设计文档为权威）> 测试覆盖 > 代码经济性。

## 2. 总体结论

master 六轮迭代已经把 view-system 修复过的问题全部修掉，且修得更彻底；
view-system 侧存在若干 master 已规避的**实锤功能 bug**（见 §5.2），这些构成
"不吸收其对应实现"的直接证据。view-system 的真正增量是一批小而实的抛光项与
两份测试设施资产，已全部吸收（§4）。

master 独有且继续保持的能力（view-system 没有或显著更弱）：SW 侧访问采集
（visit-stats-sw）、stats 最近访问分区+未收藏一键加星、一次性历史导入（单次
history.search vs 对方逐 URL getVisits）、dead 渐进呈现+暂停/恢复/取消、dupes
快照持久化+批量删除 undo 链、recent 时间粗分组、搜索历史右键菜单与键盘可达、
跨视图死链 × overlay、设置导入导出、options 多列卡片布局、panel-behavior 冷启
动合并、palette 主题命令/别名/失焦关闭、四主题徽标对比度契约、sync 光环标记
语言。

## 3. 分面对比

### 3.1 键盘模型

| | master | view-system |
|---|---|---|
| 架构 | **一个 handler 绑全部六个列表**（tree 与五列表共享 treeKeyDown/treeKeyUp，经 view-manager `lists()` 注册表）；视图差异走 ViewDef 钩子 | tree 走旧 handler + 五列表走新模块 `list-keyboard.js`，两套并行 |
| 正确性 | 全视图键位一致生效 | `getFocusables` 选择器只认 `a/span[tabindex]/[role=button]`，与 stats/dead/dupes 的裸 span 行不匹配 → **三个视图 ↑↓/Home/End/PgUp/PgDn 空转**；← 无条件派发合成 Escape（在搜索视图=误清查询，在其他列表=误回 tree）；Enter 丢 ctrl/shift/meta；dupes 成员行不可聚焦（K 键死路径）；搜索结果丢失 type-ahead |
| 测试 | keyboard.test.js 1517 行真 handler 直测 + 各视图套件 | **list-keyboard 零测试**（原 keyboard 用例被 it.skip 未补） |

**裁定：不吸收 list-keyboard.js。** master 已是更彻底的"统一键盘模块"，对方
反而是分裂的两套，且带正确性缺陷。

### 3.2 焦点区域模型（§2.1）与 Esc 分层（§3.4）

- TabStrip roving tabindex：master 在 `activate()` 内原生维护；view-system 靠
  **monkey-patch 包裹 activate**。
- ↑ 跨区：master 全部列表（含 tree）统一 `focusTop()`（→tab，再 ↑→搜索框）；
  view-system 的 tree 直达搜索框、跳过 tab 条，行为分裂。
- Esc 链序：master 与 §3.4 逐字一致（dialogs→菜单→palette→**视图 onEscape**
  →search 两级→回 tree→close）；view-system **顺序与自家规范相反**（search
  先于视图钩子——dead 扫描中按 Esc 会先清搜索词而非中止扫描）。master 的测试
  驱动真 handler；对方的 search-esc.test.js 是测试内重写决策树副本，会漂移。
- **两分支共同缺口**：§2.1 的 Tab/Shift+Tab 三区域循环（Header→TabStrip→List
  单 Tab 位）两边都未实现——规范遗留工作，见 §6。

### 3.3 搜索视图与搜索历史

master 全面领先，view-system 侧有四个实锤 bug：

1. **Esc 记录顺序 bug**：document capture 先清框再 `recordSearchHistory()` →
   历史永远记不上；input 级正确的处理器被 stopImmediatePropagation 屏蔽成死代码。
2. **打开结果不记录**：`onResultOpen` 定义并导出但全库无调用者 → 鼠标点结果
   永不入史；离开视图/关页面也不记录（时机③缺失）。
3. **`searchHistoryEnabled` 开关失效**：判定 `=== 'false'` 与 options 实际存
   `''` 不匹配。
4. 历史行 Enter 无处理器（键盘不可激活）、空查询 ↓ 落进隐藏的 tree、查询词
   **未转义直插 HTML**（XSS 卫生）、结果路径逐行异步 `bookmarks.get`（N 次调用）。

另：view-system 末梢已把 `searchLastQuery` 回填改成 no-op（与 master 附录 B
项 5 的退役决定殊途同归），但保留死写。master 结构合规（§5.2 `#results` 原
容器）、MRU 纯函数导出直测、相对时间桶 i18n。

### 3.4 四个功能视图（recent/stats/dead/dupes）

master 功能集是 view-system 的严格超集（见 §2 清单），且对方有三处真 bug：

- **dead：blocked 语义 bug** —— `checkUrl` 返回 `{status:'blocked', ok:true}`，
  `collectDead` 只收 `!ok` → blocked 行永不显示，"blocked"过滤段是死代码。
- **dupes：批量删除不可撤销** —— raw `bookmarks.remove` 链，无 undo.capture。
- **dupes/dead/stats 右键菜单空 id** —— 行无锚点无 `li.id`，walk-up 命中 SPAN
  → 弹文件夹菜单且 id 为空 → 菜单动作全部落空。

对方 bb7b62e 的六个修复，五个 master 已有等价物（且更优）。

### 3.5 sync 指示器 / options / palette / i18n / 打包

- sync CSS：view-system 停在 merge-base 未动；master 有光环统一语言与层级表。
  对方的 6px 尺寸钉死+负向守卫**测试思路**已吸收进 tree-alignment.test.js。
- options：master 超集（视图显隐开关×3、清空统计、备份组、多列卡片布局）。
  对方独有 10 个 i18n key 全是 master 已有功能的别名（如 `statsDisabled` ↔
  `statsDisabledHint`），无功能缺口。
- palette：master 超集（主题命令、别名、桥接行、失焦关闭、/sep 退役）。对方
  保留 `/sep` 是回退不是增量。
- 打包：**发现 master 缺口**——`src/panel-behavior.js`（4f86e64 抽取，SW 顶层
  import）未登记进 `scripts/package.py` JS_FILES，打包后 SW 起不来。已修复
  （96 文件，zip 校验通过）。

## 4. 吸收清单与实施回执

| # | 项 | 来源 | 落点 | 状态 |
|---|---|---|---|---|
| 1 | CDP Esc 限制分析文档 | `docs/cdp-escape-limitation.md` | 同名文档（测试分层一节改写为 master 现状：Esc 归 keyboard.test.js 真 handler，Docker 只测 bubble 键） | ✅ 已落地 |
| 2 | Docker 键盘/视图硬断言验证 | `scripts/harness/verify-keyboard.js` | 适配移植（hidden 属性语义、`#results` 直挂、class 选择器、无 data-view-id；新增 ↓ 入列表、历史落账、dupes 完整渲染断言）；接入 run.sh 阻塞步骤 + Dockerfile COPY | ✅ 已落地 |
| 3 | 搜索历史上区高度上限 | view-system neat.css | `#search-history-area` 加 `max-height:40%; overflow-y:auto`（10 条历史不再挤压结果区） | ✅ 已落地 |
| 4 | 行级整行 hover 底色 | view-system bb7b62e 项3 | `.vbm-row:hover` 一条规则（行尾按钮区不再无反馈；锚点选中态仍然优先） | ✅ 已落地 |
| 5 | dupes 组头 URL 中段省略 | view-system `midTruncate` | `src/view-dupes.js` 导出纯函数 + 组头渲染接入 + 2 个单测（去 scheme、head 55%+…+tail） | ✅ 已落地 |
| 6 | sync 圆点 6px 契约+负向守卫 | view-system sync-indicator.test.js 核心断言 | 并入 `tests/tree-alignment.test.js`（sync-styles 钉 6px/50%；neat.css 守卫规则禁尺寸/圆角） | ✅ 已落地 |
| 7 | 相对时间 label 去重（思路） | format-utils.js 证明的价值 | `src/tree-render.js` 新增导出 `relTimeLabel(ts,_m)`（吸收 falsy-ts→'' 语义，修 1970 边界），search/view-recent/view-stats 三处复制品各删 4 行 + 3 个新单测（含 _m 替换参数透传） | ✅ 已落地 |
| 8 | **master 打包缺口修复** | 评估中自查发现 | `scripts/package.py` JS_FILES 补 `src/panel-behavior.js` | ✅ 已落地 |
| 9 | 陈旧选项文案修正 | 评估中自查发现 | `optionShowRecentBookmarks` 仍写"at the top of the popup"（树内时代残留），实际语义早已是"最近视图标签显隐"——en/zh_CN 实译已改与其余三个视图开关对齐；**其余 41 locale 待下一次 `i18n.py translate` 运行跟进**（需 LLM 端点配置） | ✅ en/zh_CN 已落地 |

明确**不吸收**：`list-keyboard.js`（§3.1）、`format-utils.js` 模块本体（master
已有等价物 relativeTimeBucket，且测试更强）、搜索/历史全部 JS（§3.3 四 bug）、
`#search-results-area` 包裹层（违 §5.2）、searchLastQuery 死写、inspect.js（对方
自己的孤儿文件，精华已并入其 smoke.js）、dead-links-proxy.test.js（其断言锁定
的 blocked→ok:true 正是对方 bug 语义；master dead-links.test.js 覆盖更全）、
dupes-pick-keeper.test.js（9/10 用例与 master 重复，唯一新增是平凡路径）、
dead 行删除 ConfirmDialog（与 undo 链重复防护）、代理超时 ×1.5 魔数（无测试佐
证，deadScanTimeout 可调已覆盖）、doomed 行 ✕ 按钮（已有 Delete 键+右键菜单）、
options 输入防抖（change 已够用）、设计 token 进一步符号化（风格差异非增量）、
页面级 480px tab 标签容器查询（master 逐 tab 112px 粒度更细）。

## 5. 附：view-system 实锤 bug 清单（不吸收的证据链）

1. list-keyboard 选择器与三视图 DOM 不匹配 → 键盘导航空转（§3.1）
2. list-keyboard ← 派发合成 Escape → 误清查询/误回 tree（§3.1）
3. Esc 链序与自家 §3.4 相反（§3.2）
4. 搜索历史 Esc 顺序 bug → 永远记不上（§3.3）
5. onResultOpen 死导出 → 打开结果不入史（§3.3）
6. searchHistoryEnabled 判定 bug → 开关失效（§3.3）
7. 历史查询词未转义（XSS 卫生）（§3.3）
8. dead blocked 语义 bug → blocked 行隐形（§3.4）
9. dupes 批量删无 undo（§3.4）
10. 三视图右键菜单空 id → 菜单动作落空（§3.4）

（以上 master 均无对应问题；列举目的是留存"为什么不逐项吸收"的依据。）

## 6. 后续建议（超出本次合并范围）

- **§2.1 Tab/Shift+Tab 三区域循环**（Header→TabStrip→List，List 单 Tab 位 +
  roving tabindex 行模型）：两分支共同缺口，规范已定但实现量大（document 级
  Tab 拦截 + 行 tabindex 改 roving），建议单独立项并在真实 popup 里做焦点
  可用性验证。
- 区域焦点记忆（切视图恢复上次 `.focus` 行）：两边都只持久化了 scrollTop，
  可随 Tab 循环一起做。
