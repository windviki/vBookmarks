# 4.0.5 全局审计报告与修正方案

> 审计范围:v4.0(tag)..f0a975b 共 139 提交(4.0.1/4.0.2/4.0.3/4.0.4 已发布,43442a6..f0a975b 共 17 提交为未发布的 4.0.5 内容)。
> 方法:六域并行审计(转义/焦点律/模糊排序/favicon 反色/文档同步/视觉一致性)+ 逐条人工复核关键疑点的源码。基线:`npm run test:run` 65 套件 / 1973 例全绿。
> 本文档是 4.0.5 打磨批次的工作清单与决策记录;完成后各项在文末勾销。

---

## 一、总体评价

4.0.5 未发布的 17 个提交质量整体很高,三条主线方向正确:

1. **收敛三连**——`escape.js`(9 份转义副本)、`list-focus.js`(4 份 park/unpark 副本)、`fuzzy-core.js`(omnibox 与 popup 两套评分)都是「同一逻辑只留一份」的正确收敛,且都带了迁移测试。
2. **favicon 反色服务**——与占位图替换共用一次 `getImageData`,静态覆盖面(七类行容器 × 两页 × 五主题)经核实完备,死链 × 覆盖层层级正常。
3. **命令面板键盘修复**——`<mark>` 高亮、行 `tabindex="-1"`、Tab 两停循环三连修,机制自洽。

但「举一反三」核查发现:**同类问题没有全部被照顾到**。三个确定缺口(注入残留、观察器永不安装、树视图焦点律不一致)和一批视觉/文档不同步,正是本批次要修的。

## 二、发现清单(分级)

### A. 确定缺陷(必修)

| # | 域 | 发现 | 位置 |
|---|---|---|---|
| A1 | 转义 | palette 自定义命令行 `row.slash` 未转义直插 innerHTML;`loadCustomCommands` 只校验 `slash` 不校验 `aliases`——同步存储 blob 可携恶意 alias 注入(与 43442a6 为 cmd.name 堵的同一注入面) | `src/palette.js:361`、`src/palette-commands.js:165` |
| A2 | favicon | 主题观察器**永不安装**:`typeof doc.body.observe === 'function'` 在真实 DOM 恒 false(body 无 observe 方法,观察器实例才有)。palette `/theme` 切主题后已渲染图标反色类滞留;`reapplyContrast` 无任何调用方;观察器分支测试零覆盖(假绿) | `src/favicon-fallback.js:209` |
| A3 | favicon | auto 主题双重盲区:`body[data-theme]` 恒为 "auto",OS 明暗切换只经 CSS 媒体查询解析,body 属性不变——即使修好 A2 也听不到事件,需 `matchMedia` 监听。长驻侧面板受影响最大 | `src/favicon-fallback.js`、`src/popup.js:10` |
| A4 | 焦点律 | 树视图 `generateTree` 的 innerHTML 交换无 park/unpark;focusID 恢复被 `rememberState` 门控——选项关闭时 undo/排序/onChanged 重渲染焦点落 `<body>`,与四个 list view 的无条件恢复不一致(4.0.1 焦点律的字面违反) | `src/tree-view.js:168` |
| A5 | 视觉 | `.search-history-remove`(TRASH)无 danger 规则,落入 `.row-btn` 默认 muted——与 `icons.js:76`「trash 一律 danger」自述相悖,与死链行 × 删除按钮不同色 | `css/neat.css`(缺规则)、`src/search.js:307` |
| A6 | 视觉 | 删除类菜单项红色语义未贯彻:`#search-history-menu-remove`、`#search-history-menu-clear`、`#dupes-group-clean`、`#palette-cmd-delete`、`#remove-separator` 均无 danger 色(只有 bookmark/folder-delete 有,neat.css:871) | `css/neat.css:871` 一带 |

### B. 抛光项(应修)

| # | 域 | 发现 | 位置 |
|---|---|---|---|
| B1 | 焦点律 | focusSpot 分类器不认识搜索历史区:历史行与 `#search-history-clear` 不在任何 zone——重开 popup 不恢复该位置 | `src/view-manager.js:495-541` |
| B2 | 焦点律 | dead/dupes 工具栏重渲染恢复用裸位置索引,按钮增删时索引漂移;focusSpot 已有更稳的 bar+cls+idx 键(仅重开时用) | `src/view-dead.js:455-481`、`src/view-dupes.js:378-390` |
| B3 | 搜索 | omnibox `<match>` 高亮与排序语义分叉:排序是 fzf 子序列,高亮是逐词正则子串——"gub" 能把 "GitHub" 排第一却零高亮 | `src/search-core.js:38-49` |
| B4 | 搜索 | matcher 自身不做正义转义,转义留在调用方 background.js:134——第二个消费者会 SyntaxError | `src/search-core.js` |
| B5 | 搜索 | 无「omnibox 与 popup 同一查询同一排序」契约测试,fuzzy-core 统一是隐式成立的 | `tests/search-core.test.js` / `tests/fuzzy.test.js` |
| B6 | 视觉 | `#dead-list ul li.dead-start` 用 `:focus` 而非控件层约定的 `:focus-visible`——鼠标点击也显环 | `css/neat.css:3329` |
| B7 | 视觉 | 死链选择模式行叠 8px+复选框 14px 而锚点 ::before 16px 原槽未隐藏——进选择模式文本右移 ~28px、favicon 落 ~44px,与 dupes 选择态(~24px)不齐 | `css/neat.css:2864` 一带(实施时核实) |
| B8 | 死代码 | `.dead-proxy-strip .dead-proxy-chip.template`(template 类已在 view-dead.js 绝迹)、`.stats-add-btn:hover` 重复 color 声明、`#dead-list .row-btn.dead-mark-btn` 空规则体 | `css/neat.css:3214/3579/3360` |
| B9 | 注释 | `src/search.js:49` 仍称 fuzzy.js 为 "classic script"(现为 ES-module shim) | `src/search.js` |

### C. 文档同步(全量修)

| # | 文档 | 过期点 |
|---|---|---|
| C1 | `AGENTS.md` | 版本 4.0.1→4.0.5;布局表缺 `escape.js`/`list-focus.js`/`fuzzy-core.js`(及 resize-core 等既有缺口);favicon-fallback 行未提反色服务;palette 行未提 mark 高亮/Tab 两停;fuzzy.js/search-core 行未提统一;keys 379→387;测试清单缺 neat-boot/list-view-parity/tab-group-utils;harness 五层 |
| C2 | `docs/README.md` + `.zh.md` | 缺 4.0.5 changelog;"379 as of 4.0.1"→387;"50+ suites"→65;palette 失焦自动关闭措辞(现为 Tab 两停,仅点击外部关闭) |
| C3 | `docs/guide-v4.md` + `.zh.md` | palette 章节补 mark 高亮 + Tab 两停;搜索章节补高亮;失焦关闭措辞同 C2 |
| C4 | `docs/keyboard-model.md` | §5 Tab 环补 palette 两停循环;实现映射表补 palette.js 行 |
| C5 | `docs/plan-4.1.0/v4.1.0task-1.md` + `-ds.md` | 基线 commit 标注过期;§一.3/§一.4/§一.11 与 ds A3/A13 的「已落地」版本号 4.0.4→4.0.5(9866ab9/1b01345/1f06606 均在未发布区间);§一.6 现状结论仍成立仅行号漂移 |
| C6 | `scripts/package.py` | JS 种子清单缺 escape/list-focus/fuzzy-core(import 图可达,无打包风险,但违背 "keep in sync" 指引) |

### D. 核实后接受(记录决策,不改)

| # | 项 | 理由 |
|---|---|---|
| D1 | `escape.js` 不转义 `&`(为幂等保留)与 `'`(全库无单引号属性插值) | 已文档化的刻意策略;改需全量回归,收益为零 |
| D2 | syncStatus/syncTooltip 未转义直插 | 值来自 sync-engine 内部枚举 + 纯 i18n 常量,信任边界内 |
| D3 | dupes 组头/radio 24px 图标轴与其它视图 16px 不同轴 | 组头是结构不同的聚合行,组内自洽 |
| D4 | `:has(.row-sub)` 下单双行混排(根级书签无路径时单行) | 1f06606 注释明示「单行行保持 16/20/4px 与树一致」的刻意节奏;混排符合自然内容差异 |
| D5 | `.stats-add-btn` 空心 ☆ 用 danger | 5fb8c07 文档化的刻意设计(空心红=未收藏对应实心 accent);仅清掉 hover 重复声明 |
| D6 | dead delete-all 红字 vs dupes apply-all 红填充的层级差 | 提交信息自述有意(主次层级);跨视图语义同为 danger |
| D7 | `needsContrast` sat<0.25 放过暗底深蓝 logo | v4.1.0task-1-ds §A13 已自记为后续可调阈值 |
| D8 | fuzzy.js 保留为 window shim 而非退役 | search/palette 测试以 window.VBMFuzzy 为注入缝;shim 13 行零运行时成本;退役收益不抵测试基建churn |
| D9 | 其它视图空态无 CTA(仅死链有药丸) | dupes/stats/recent 空态是事实陈述;statsDisabledHint 的「去选项页」属 v4.1.0 §二.7 盘点范围 |
| D10 | blocked/dead × 覆盖层按场景着色 | v4.1.0 §一.6 待决策项,不在 4.0.5 顺手改 |

## 三、修正方案

### P1 安全/正确性(A1–A4)

1. **A1 双层修复**:palette.js:361 对 `row.slash` 套 `htmlspecialchars`;`loadCustomCommands` 对每条命令的 `aliases` 逐项过 `SLASH_RE`,非法项剔除(命令本身保留)。测试:palette.test.js 注入带 `<img onerror>` alias 的 blob,断言渲染后的行 HTML 无裸标签;palette-commands.test.js 断言非法 alias 被滤。
2. **A2+A3 反色动态链**:观察器守卫改为 `typeof MutationObserver === 'function' && doc.body`;新增 `matchMedia('(prefers-color-scheme: dark)')` 变更监听(OS 切换 → `reapplyContrast()`,显式主题下重判为幂等 no-op,故无条件挂)。返回句柄补 `themeMedia` 供测试。测试:MutationObserver/matchMedia 双注入断言回调触发 `reapplyContrast`(以 statsBySrc 对应 img 的 class 变化观察)。
3. **A4 树视图焦点律**:`generateTree` 在 innerHTML 交换前后调用 `parkRowFocus($tree)`/`unparkRowFocus($tree)`(list-focus.js 直接复用,树行锚点即 `a[tabindex=-1]`,unpark 的 `querySelector('a, span')` 命中)。无条件执行——「会话内连续性」与「跨会话恢复」分离,后者仍由 rememberState 门控(focusID/blueFade 块原样保留,时序在 unpark 之后自然覆盖为同行)。测试:tree-view.test.js 增加 rememberState off 时聚焦行在重渲染后存活。

### P2 焦点律补全(B1–B2)

4. **B1**:view-manager `classifyFocus` 增加搜索历史区 zone:`.search-history-row a`(key=data-q,恢复时遍历行按属性匹配,避免选择器注入)+ `#search-history-clear`(并入 toolbar 语义:`{zone:'toolbar', view:'search', bar:'search-history-head', cls, idx}`,focusSpotTarget 的 `.search-history-head` bar 在 view 容器外,恢复路径需直接 `getElementById`——实现时以最小分支处理)。测试:view-manager.test.js 断言历史行/清除按钮的分类与恢复。
5. **B2**:把 view-dead/view-dupes 各自的 `toolbarFocusIndex/restoreToolbarFocus` 收敛进 `list-focus.js`(`parkToolbarFocus(scope)`/`restoreToolbarFocus(scope, parked)`,cls+idx 键,同 focusSpot 算法),两个视图换用。测试:list 相关套件断言按钮增删后恢复到同类控件。

### P3 搜索一致性(B3–B5、B9)

6. **B3+B4**:`matcher` 逐词:先 `escapeRegExp`,子串命中→子串位置(现行为);否则贪心子序列扫描→逐字符 `<match>`(与排序语义对齐,子序列命中不再零高亮)。测试:search-core.test.js 增 "gub"→GitHub 高亮 g/u/b 三处、正则元字符词、无命中零高亮。
7. **B5**:新增契约测试——同一语料 + 多组查询,`rankBookmarks`(omnibox 路径)前 6 与 `VBMFuzzy.rank`/`fuzzy-core.rank`(popup 路径)前 6 的 id 序列一致。
8. **B9**:修正 search.js 头注释对 fuzzy.js 的描述。

### P4 视觉抛光(A5–A6、B6–B8)

9. **A5**:`.search-history-remove` 补 danger 色(对齐死链行删除按钮)。
10. **A6**:为 `#search-history-menu-remove`、`#search-history-menu-clear`、`#dupes-group-clean`、`#palette-cmd-delete`、`#remove-separator` 补 danger 菜单项规则(与 871 行 bookmark/folder-delete 同配方)。list-view-parity.test.js 的 danger 契约如适用则扩一行。
11. **B6**:dead-start `:focus` → `:focus-visible`。
12. **B7**:核实死链 selecting 行的双槽叠算后,在选择模式下抑制锚点 ::before 幽灵槽,使 favicon/文本与 dupes 选择态同轴。
13. **B8**:删除三条死规则/冗余声明。

### P5 文档同步(C1–C6)

14. AGENTS.md:版本、三新模块行 + 既有缺失模块行(以 `ls src/*.js` 全量对齐)、favicon/palette/fuzzy/search-core/tab-group-utils 行刷新、387 keys、新测试套件、harness 五层。
15. README 双语:4.0.5 changelog(New:favicon 反色服务、死链药丸 CTA、palette 高亮;Fixed:palette Tab 两类退化、转义缺口、树重渲染焦点丢失、omnibox 高亮对齐;Changed:删除操作红色语义贯彻、视觉一致性;Engineering:三次收敛、门禁与发布健壮化)+ 387/65/措辞。
16. guide-v4 双语:palette 高亮 + Tab 两停 + 失焦措辞;搜索高亮。
17. keyboard-model.md:Tab 环 palette 两停 + 实现映射行。
18. v4.1.0task-1/-ds:基线与「已落地版本号」刷新。
19. package.py:种子清单补三新模块。

## 四、验证计划

- `npm run test:run` 全绿(含新增用例);
- `npm run lint` 0 error;`python3 scripts/i18n.py audit`/`verify` 0 error(本批次无新 key);
- `python3 scripts/package.py` 打包 0 WARNING(清单同步生效);
- Docker 冒烟 `scripts/harness/run.sh --smoke-only` + verify-keyboard(如环境可用);
- 逐项勾销下表。

## 五、完成勾销

- [x] P1-1 A1 palette alias 转义/校验
- [x] P1-2 A2+A3 favicon 主题链
- [x] P1-3 A4 树焦点律
- [x] P2-4 B1 历史区 focusSpot
- [x] P2-5 B2 工具栏恢复收敛
- [x] P3-6 B3+B4 matcher
- [x] P3-7 B5 parity 契约
- [x] P3-8 B9 注释
- [x] P4-9 A5 历史 TRASH danger
- [x] P4-10 A6 删除类菜单项红
- [x] P4-11 B6 focus-visible
- [x] P4-12 B7 选择模式对齐
- [x] P4-13 B8 死规则
- [x] P5-14..19 文档同步(README 双语 changelog、AGENTS、guide-v4 双语、keyboard-model、v4.1.0 task/ds 基线、package.py 种子清单)
- [x] 验证全绿(test:run 66 套件/2003 用例全过;lint 0 error;i18n audit/verify 通过,0 新 key;Docker 冒烟因环境不可用未跑,CI push 门禁含同一冒烟)
  - 注：本报告为 glm53 独立审计视角。合流 master（k3）后终态为 66 套件 / 2047 用例 / 388 i18n 键全绿，lint 0 error；本报告的 P1–P4 修复与 k3 的批次 A–D 互补合流，见 `docs/plan-4.1.0/v4.1.0task-1-final.md` 与 `tmp/4.0.5-两分支审计对比与合并方案.md`。
