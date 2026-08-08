# v4.0.1 整体抛光 — 总问题清单与修复计划

> 来源:8 份区域审阅报告(本目录 01–08,审阅基准 `7fea4d1..HEAD` = 云端 4.0 → 本地 4.0.1,40 提交)。
> 本文档是最终对齐用的主清单:每个问题给出 严重度 / 处置(修/文案/记录/不动) / 修复批次 / 状态。
> 审阅日期:2026-08-07。约束:**不回退任何已有功能**;改动最小化;遵守 AGENTS.md 约定(4 空格、_m() i18n、store.js 存储)。

## 严重度图例

- **P0** 用户可感知的功能性 bug(崩溃/死锁/数据不符),发布前必修
- **P1** 明确缺陷或一致性问题,本版修
- **P2** 打磨/健壮性/文档,本版尽量修
- **P3** 记录 backlog,本版不动

## 一、键盘与焦点(报告 01)

| # | 问题 | 严重度 | 处置 | 批次 |
|---|---|---|---|---|
| K1 | 菜单打开后首次 ↓ 死锁(入口未走 menuWalkable) | **P0** | keyboard.js 两个 else 分支改 nextMenuTarget;verify-keyboard 补浏览器级断言 | W1-B1 |
| K2 | palette 菜单 Esc 半边无效(capture 注册顺序) | **P0** | keyboard Esc 链 .active 分支委托 palette.refocus() | W1-B1 |
| K3 | F2 对根文件夹无守卫 → TypeError | **P0** | 与 Delete 同源守卫 + 单测 | W1-B1 |
| K4 | 容器持焦 Delete 删除不可见首行 | **P0** | 无 .focus 标记时 Delete 不动作 + 单测 | W1-B1 |
| K5 | Ctrl+F 无对话框守卫 | P1 | 加 anyOpen() 守卫 | W1-B1 |
| K6 | stale .active 致 Esc 层穿透 | P1 | Esc 菜单判定加"实际可见"条件 | W1-B1 |
| K7 | palette-cmd/separator 菜单无键盘绑定 | P1 | palette-cmd 补绑 + 入 menuContainers;separator 文档声明例外 | W1-B1 |
| K8 | 下拉打开时 Ctrl+数字切视图悬空 | P1 | 并入 D4 统一 closeOpen 机制 | W1-B1 |
| K9 | 根文件夹菜单 ↑ 落禁用项 | P2 | 随 K1 一并修 | W1-B1 |
| K10 | dropdown Tab 命中 greyed 不关列表 | P2 | Tab 分支 greyed 时关闭(不 pick) | W1-B1 |
| K11 | dead 扫描中静默重绘丢行焦点(存量) | P3 | 记录 backlog(机制改动大,本版不动) | — |
| K12 | tree-view reveal focusTarget 无 null 守卫 | P2 | 一行守卫 | W1-B1 |

### K13-K20(报告 09 补充,agent-01 未完成草稿的增量,B6 批次修复)

| # | 问题 | 严重度 | 处置 | 批次 |
|---|---|---|---|---|
| K13 | palette close() 焦点归还未见当前视图——从非 tree 视图关闭后聚焦隐藏 tree 行 | P1(存量) | close() 检查目标可见性(offsetParent),隐藏则归还到当前活跃视图 | W1.5-B6 |
| K14 | dead 代理 URL 文本框 ←/→/Home/End 被工具行行走劫持,光标无法移动 | **P0**(存量,文本输入基本功能) | keyboard 工具行行走对 input[type=text] 放行(同 SELECT 模式) | W1.5-B6 |
| K15 | 对话框关闭后焦点不归还调用者——Esc/OK 后方向键全死 | P1(存量) | open 记录 invoker,close 归还(与 clearMenu 同语言) | W1.5-B6 |
| K16 | 搜索框带查询 Ctrl+数字切视图 searchMode 卡死(9888f8a 放大) | P1 | search deactivate 钩子退 searchMode(防递归) | W1.5-B6 |
| K17 | 容器持焦且行未渲染时 ↑↓/Home/End 全早退(f5903c8 半真) | P2 | 容器持焦无行时 ↑ 走 focusListExit | W1.5-B6 |
| K18 | dupes 组头 ←/→ 折叠不做 RTL 镜像 | P2 | 按 RTL 镜像,与成员行一致 | W1.5-B6 |
| K19 | Alt+数字键盘 1 在搜索框内切视图(Alt-code 输入被打断) | P3 | e.code Numpad 排除(一行守卫) | W1.5-B6 |
| K20 | guide-v4 "Alt+1…6 Anywhere" 表述夸大 | P3 | 文档措辞修订(随 W3 收尾) | 主代理顺手 |

## 二、下拉组件(报告 02)

| # | 问题 | 严重度 | 处置 | 批次 |
|---|---|---|---|---|
| D1 | dupes 工具行 Home → TypeError(选择器命中 listbox) | **P0** | keyboard Home/End 选择器限定 `ul[role="list"]`;dropdown 打开态自处理 Home/End | W1-B1 |
| D2 | 打开态不拦截 Home/End/Page* | P1 | dropdown 打开态实现 Home/End;Page* preventDefault | W1-B1 |
| D3 | listbox z-index 300 压 palette/dialog 且活得更久 | P1 | 统一 closeOpen:dialog/palette 打开、视图切换、mousedown/focusout 外部 | W1-B1 |
| D4 | 视图切换/重渲染不关闭下拉(openDd 悬挂吞 Esc) | **P0**(半) | window Esc 加 `!openDd.isConnected`;dropdown 返回 {closeOpen};视图 deactivate 调用 | W1-B1 |
| D5 | ARIA 缺口(aria-disabled/aria-controls/aria-selected) | P2 | 补三个属性 | W1-B1 |
| D6 | forced-colors 焦点不可见 | P2 | CSS 补 outline(随 CSS 批) | W1-B4 |
| D7 | 无 destroy API | P3 | 记录(当前单页生命周期安全) | — |

## 三、死链(报告 03)

| # | 问题 | 严重度 | 处置 | 批次 |
|---|---|---|---|---|
| X1 | 干净扫描后无重扫入口(f5bc7cb 回归) | **P0** | .dead-rescan 移回 if(lastScan) 层 + 单测 | W1-B2 |
| X2 | 删除后 deadLastScan 徽标不同步(虚高/复活) | P1 | onRemoved 同步 prune lastScan.results + badge 测试 | W1-B2 |
| X3 | delete-all 文案误标(All 含 blocked;丢"无法一步撤销") | P1 | 文案改"当前筛选的 N 条";确认框注明 blocked 含义与撤销粒度(en+zh 实译) | W1-B2 |
| X4 | removeSequentially 不读 lastError | P1 | 读 lastError,toast 用实际删除数 + 单测 | W1-B2 |
| X5 | deadProxyTemplate 残留(存储/43 locale 死键 optionDeadProxy、deadSummary) | P1 | store.js 加一次性迁移 remove;locale 死键全清(i18n verify 过) | W1-B2 |
| X6 | 徽标双读竞态(窄窗口) | P3 | 记录(毫秒级,下次存储事件自愈) | — |
| X7 | persistMarks 注释过期;dead-links.js:104 注释"template" | P2 | 注释订正 | W1-B2 |

## 四、标签组(报告 04)

| # | 问题 | 严重度 | 处置 | 批次 |
|---|---|---|---|---|
| T1 | 已有组选择器色点透明(tg-color-* 类不存在) | **P0** | dialogs.js 改发 tg-${color};shots-tabgroups 补 computed-style 断言 | W1-B3 |
| T2 | Ctrl+D 守卫漏 needTabGroup/needGroupPick | P1 | neat.js 守卫补齐 | W1-B3 |
| T3 | palette DIALOG_CLASSES 漏同两项 | P1 | palette.js 清单补齐 | W1-B1(palette.js 归 B1) |
| T4 | tab-groups-sw:tabs.group 回调不读 lastError | P2 | 读 lastError | W1-B3 |
| T5 | onCreated 无 tab 守卫(失败炸链/挂死) | P1 | lastError/tab 判空 + 空 tabIds 跳过 group + 单测 | W1-B3 |
| T6 | open-into 窗口间隙关闭静默全丢 | P2 | create 失败回退 plainOpen | W1-B3 |
| T7 | GroupDialog onConfirm/onPick 粘性残留 | P2 | open 时先重置 noop | W1-B3 |
| T8 | 色点 radio 无可访问名 | P2 | aria-label(查现有色名键;无则 en+zh 新键,其余 locale 待 translate 管道) | W1-B3 |
| T9 | GroupDialog 输入框 Enter 不保存 | P2 | 补 Enter=保存(与 edit 对话框行为对齐后可选项——做) | W1-B3 |

## 五、排序与统计(报告 05)

| # | 问题 | 严重度 | 处置 | 批次 |
|---|---|---|---|---|
| S1 | 递归排序撤销不完整(只还原顶层,与 sortRecursiveWarning 文案矛盾) | **P0** | 改实现:快照全层级 {parentId→ids},撤销逐层回放;toast 保持 | W2-B5 |
| S2 | 排序无并发锁 | P1 | 排序进行中置锁 | W2-B5 |
| S3 | move 回调不读 lastError | P2 | 读 lastError | W2-B5 |
| S4 | options.js readSort 与 parseSortOptions 双实现 | P2 | options.html 引入 sort-utils.js,删双实现 | W2-B5 |
| S5 | visit-stats-sw onMoved 无防抖 rebuildIndex(递归排序放大) | P1 | 加 300ms 防抖 | W2-B5 |
| S6 | stats ☆ 一键收藏可创建重复书签(会话内 onCreated 盲区) | P1 | create 前按 URL 查重 | W2-B5 |
| S7 | view-stats 头注释债(3 处) | P2 | 注释订正 | W2-B5 |
| S8 | 宽屏副行模板不统一(stats 时间·路径 vs recent/dupes 路径·时间);dupes 路径不受 showItemPath 门控 | P2 | 统一为 路径 · 时间;dupes 补门控 | W2-B5(dupes 门控 2 行,随 B5 做,B1 不动 view-dupes) |
| S9 | sortFolderContents 零单测 | P1 | 新增单测(升序算法/快照/撤销回放/递归/失败路径) | W2-B5 |

## 六、版本与打包(报告 06)

| # | 问题 | 严重度 | 处置 | 批次 |
|---|---|---|---|---|
| V1 | risk-banner 4.1 不重弹 | P3 | **不动**——MAJOR-only 是文档化设计(changelog/测试/反馈文档三处一致) | — |
| V2 | #49 onChanged 二次异步 get 竞态 | P2 | 改读 changes.newValue | W1-B2(background.js 归 B2) |
| V3 | parseVersion 注释与实现不符(第 4 段) | P3 | 注释订正(一行) | W3-docs 顺手 |
| V4 | package.py IMPORT_RE 漏动态 import() | P2 | 正则加 import( 分支 | W1-B2 |
| V5 | 打包入口种子手工维护(strays 仅警告) | P3 | 记录 backlog | — |

## 七、视觉样式(报告 07)

| # | 问题 | 严重度 | 处置 | 批次 |
|---|---|---|---|---|
| C1 | 下拉键盘焦点几乎不可见 | **P0**(键盘用户) | li:focus 用 bg-selected/fg-selected(与菜单同语言) | W1-B4 |
| C2 | neat.css 缺 color-scheme(dark/ink 原生控件白块) | P1 | 镜像 options.css 的 color-scheme 写法 | W1-B4 |
| C3 | tab-group 色点行 320px/zoom 下折行 | P1 | 22→20px、padding 3→2、gap 10→6、去 space-between | W1-B4 |
| C4 | dead-proxy-strip 按钮无 token 焦点环 | P1 | 补进 :focus-visible 清单 | W1-B4 |
| C5 | RTL 物理属性(本版 2 处新增 + 存量 5 处) | P1 | 改 logical properties | W1-B4 |
| C6 | 对话框按钮无 token 焦点环(+donation 三钮) | P1 | 补 :focus-visible 规则 | W1-B4 |
| C7 | paper 主题代理测试成功/失败两红色难区分 | P1 | 引入 --vbm-success 四主题 token | W1-B4 |
| C8 | tab-group 色点 halo/内点表面色错(--vbm-bg→bg-elev) | P2 | 三处替换 | W1-B4 |
| C9 | .dialog transition 死规则(双系统) | P2 | 删 950 死规则,保留 .transitional 体系 | W1-B4 |
| C10 | dupes 工具行控件高度三档 | P2 | trigger 2px 8px、扁平 2px 6px 对齐 pill 19px | W1-B4 |
| C11 | 死规则/死 token/注释腐化(select:focus-visible、--vbm-indent、z-index 旧注释) | P2 | 清理 | W1-B4 |
| C12 | options.css dead-proxy input 冗余声明 | P2 | 瘦身为 3 条 | W1-B4 |
| C13 | #quick-add-toast .3s 离群 → .18s | P2 | 统一 | W1-B4 |
| C14 | 未提交 #search margin 改动 | P1 | **保留并微调为 `margin: 2px 2px 4px`**(焦点环不被裁) | W1-B4 |
| C15 | paper muted 对比度 3.9:1 | P3 | 可选:#82796a→#756c5d(做,一行) | W1-B4 |
| C16 | palette 输入环 box-shadow vs 全局 outline | P3 | 可选统一 outline(做,低风险) | W1-B4 |
| C17 | 对话框落点两档(40px vs 0) | P3 | 不动行为,补注释说明分层 | W1-B4 |
| C18 | 工具行骨架三份复制(.vbm-toolbar 零 CSS) | P3 | **不动**(零视觉变化的重构,留给独立 PR 保持本 diff 可审) | — |
| C19 | palette 列表 `max-height:320px` 定值:17 命令后末行被切 + 矮窗口页脚被裁 | P1 | 改 `min(430px, calc(85vh - 90px))`——上界按构造 ≤100vh,任意 zoom/字号不裁页脚,430px 默认字号下全量可见 | 截图复核批 |
| C20 | stats 权限引导行 `order/flex` 写在非 flex 容器上成死规则,Enable 链接与句子粘连 | P1 | `li.stats-history-guide` 补 `display:flex; align-items:center; gap:8px`(对齐 banner 模式),order 规则随之生效 | 截图复核批 |

## 八、文档(报告 08)— 全部 W3 批次

- README.md/zh:4.0.1 changelog 补 a38f916(代理整合)条目;zh:80 补 /dark 直达对等;数字 1563/49/371;dev 套件清单补 shots-tabgroups.js
- guide-v4.md/zh:§3.4 代理模板→代理服务器改写(含 options 入口、× 关闭/恢复);§7 隐私段同改;§2.1 下拉协议补全(Enter/Space 开、Tab 应用);§2.4 Esc 链加下拉层;§5 经典预设补页面右键项;§3.1 ×→垃圾桶图标;§3.4 过滤带计数;头部 "Applies to 4.0"→4.0.x
- AGENTS.md:版本 4.0.1;布局表补 dropdown/options-proxy/tab-groups-sw/tab-group-utils/version.js 五行 + focus-regression 测试;options 11 组(排序组、死链组代理现状、Views 组 quickAddContextMenu、经典预设 4+1);view-dead/dead-links/actions 行订正;数字 371/49/1563;harness 段 11 组+shots-tabgroups+dropdown;background 行 proxy 表述;CI 存在;打包递归解析
- keyboard-model.md:§4 Esc 蛋糕加下拉层;§6 Alt+1…9 表述更新(9888f8a);§2.6 菜单绑定现状;§8 测试文件引用订正 + focus-regression 挂载
- issues-46-48-feedback.md:标题含 #49
- docs/review-4.0.1/:补 README 索引(本目录说明)
- 代码注释漂移:dead-links.js:104、verify-keyboard.js:242(随 W1 各批顺手)

## 九、截图重拍(W4,代码定稿后)

- 高:view-dead.png、view-stats.png
- 中:options-views.png、palette.png、dead-select.png
- 低-中:view-dupes.png;低:view-recent.png、search-dualzone.png
- 路径:scripts/screenshots/run.sh(shots-guide.js / shots.js / shots-palette.js)

## 十、测试补强(随各修复批次)

- K1/K3/K4/K5 单测 + verify-keyboard 菜单行走浏览器断言
- D1/D4/D10 单测
- X1/X2/X4 单测
- T1(computed-style)/T5/T7 单测
- S1/S9 排序单测(新)
- focus-regression 注释超卖订正(补用例或改注释)

## 决策记录(站在用户角度)

1. **S1 递归撤销:改实现不改文案**——"可撤销"是排序功能的用户安全感来源;快照全层级成本极低(内存中 id 序列),撤销逐层回放复用现有 moveToIndex。
2. **V1 risk-banner:不动**——MAJOR-only 三处文档一致,是设计而非缺陷。
   - **订正(2026-08-08)**:已被所有者推翻——自 4.0.1 起 ack 门改为 major.minor(patch 静默,major/minor 晋升重弹),已在 `src/risk-banner.js` 经 `sameOrNewerMinor` 实现,`majorOf` 已从 `src/version.js` 移除。
3. **X3 文案:不恢复旧键,改写 deadDeleteAll**——确认框说明"当前筛选 All 含 blocked(被墙≠失效)"+ 撤销粒度提示;en/zh 实译,其余 locale 走既有 translate 管道。
4. **C14 未提交 margin:保留微调**——`2px 2px 4px`,理由见报告 07。
5. **C18/K11/D7/V5:记录不动**——零收益风险比,保持本 diff 可审。
6. **批次文件归属**:B1=keyboard/context-menu/palette/view-manager/dropdown/view-dupes/tree-view+其测试+verify-keyboard;B2=view-dead/dead-links/store/background/package.py+其测试;B3=tab-groups-sw/dialogs/popup.html/sidepanel.html/neat.js(Ctrl+D 守卫一行)+其测试;B4=css/neat.css+options.css;B5=neat.js(sortFolderContents)/sort-utils/options.html/options.js/view-stats/visit-stats-sw+其测试。**B5 在 B3 之后(共用 neat.js),B4 独立**。

## 十一、完成状态(2026-08-08 收尾记录)

- **Wave 1(4 批并行,全绿)**:B1 键盘/下拉(K1-K12、D1-D7、T3)、B2 死链/后台/打包(X1-X7、V2、V4)、B3 标签组(T1-T10)、B4 CSS(C1-C17、D6)。
- **Wave 2**:B5 排序/统计(S1-S9;S1 改实现:递归排序全层级可撤销,snapshotOrder/planSortMoves/planUndoMoves/createSortLock 入 VBMSort)。
- **Wave 1.5**:B6 补 09 报告新增问题 K13-K19(K14 P0:工具行文本框光标放行;K13/K15 焦点归还;K16 searchMode 卡死;K17 容器持焦 ↑;K18 dupes 组头 RTL;K19 Numpad 守卫)。K20(guide 措辞)已随文档批修订。
- **worktree 吸收**:分支 `worktree-fix-issues-50-52`(f6d2db2,基于 a38f916)的 issue **#50/#51/#52** 修复已用 `git apply` 全量吸收进主工作区(6 文件,0 冲突);changelog 双语与 AGENTS.md 已同步补记。
- **i18n**:43 locale × 379 键,`i18n.py verify` 0 error(deadDeleteAll/sortRecursiveWarning 陈旧译文全部重译;9 个 tabGroupColor* 新键与 deadDeleteAllNote 全量翻译)。
- **文档**:README 双语 changelog(a38f916 代理整合、#50-52)、guide-v4 双语(代理服务器改写/下拉协议/Esc 下拉层/经典预设 5 项)、AGENTS.md(4.0.1/新模块/11 组/379 键/50 套件)、keyboard-model.md(Esc 蛋糕/Alt+数字/菜单清单)、issues 反馈文档标题、本目录 README 索引。
- **测试**:vitest 根 tests/ **50 套件 1659 例**(1629 + B6 21 + worktree 8 + K16 重进恢复 1)全绿;Docker harness `verify-keyboard.js` **130 pass / 0 fail**(含 §4.3b 搜索双区 4 断言,初次跑 126/4 暴露 K16 未处理"重进恢复"——框内查询按 2026-07-25 合约保留、结果 DOM 存活但 searchMode 已清;修复:search.js `views.attach('search')` activate 钩子在 renderHistoryArea 后检测 `searchInput.value.trim()` 非空则恢复 searchMode + switchBookmarkMenu(true),tests/search.test.js 补 K16 follow-up 用例)。
- **截图复核批(C19/C20)**:重拍比对时新发现两处本版引入的视觉回归并修复——palette 列表 320px 定值 cap(17 命令后 /options 被切、矮窗口页脚被裁,改 `min(430px, calc(85vh - 90px))`)、stats 权限引导行死 `order` 规则(Enable 与句子粘连,补 `display:flex`)。
- **终验(2026-08-08)**:Docker 全量 harness exit=0——smoke 无页面错误、verify-keyboard **130/0**、verify-scrollbars **752 断言 ALL PASS**、六个截图套件全 OK;`package.py` 107 文件零 WARNING;`i18n.py verify` 0 error(27 条小语种菜单超长提示为既有良性)。guide 图 9 张已用新 UI 重拍回填(view-dead/view-stats/view-dupes/view-recent/palette/options-views/dead-select/dupes-select/search-dualzone),三张关键图人工复核通过。
- **遗留(有意不动,见 §决策记录)**:V1(risk-banner MAJOR 门——已于 2026-08-08 被所有者推翻,见 §决策记录第 2 条订正)、C18(工具行骨架收敛)、K11(dead 扫描中行焦点,存量)、D7(dropdown destroy API)、V5(打包种子自动收集)、X6(徽标双读窄竞态)。
