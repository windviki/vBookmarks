# 审阅报告 03:死链批量删除 + 代理整合 + 徽标修复

> 审阅范围:src/view-dead.js、src/dead-links.js、src/dead-proxy.js、src/dead-scan-sw.js、src/options-proxy.js、options 页死链组。
> 相关测试 125 例、全量 1563 例均绿。审阅日期:2026-08-07。

## 问题清单

**1. [中-高] 干净扫描(0 死链)后视图内再无重扫入口——f5bc7cb 重排引入的回归**
- 位置:`src/view-dead.js:394`(`renderToolbar`)
- 证据:v4.0(`git show 7fea4d1:src/view-dead.js` L356-359)`.dead-rescan` 在 `if (lastScan)` 层,有无结果都渲染;HEAD 把它挪进了 `if (lastScan && rows.length)`(view-dead.js:376)分支。扫描结果全健康时,列表走 `deadNone` 空态(view-dead.js:499,非可执行的 `dead-start`),工具栏只剩时间戳——用户在视图内**没有任何重扫途径**(除非用 palette 自定义命令)。
- 修法:把 `.dead-rescan` 移回 `if (lastScan)` 层(与时间戳并列),补一条"clean scan → rescan 可见"测试。

**2. [中] 删除后 `deadLastScan` 缓存不同步清理——徽标虚高并在冷启动"复活"**
- 位置:`src/view-dead.js:1196-1207`(badge)、`898-903`(onRemoved)、`1277-1287`(冷启动 preload)
- 证据:`badge()` 直接数 `lastScan.results` 里 dead/blocked 的条目,**不做 treeItems join**;`onRemoved` 只 prune `deadMarks`,从不 prune `lastScan.results`;持久化的 `deadLastScan` 也只有 SW 在下次扫描完成时重写。批量删除(或单条删除)后:当前会话徽标仍含已删 id(视图行因 join 保护会消失,徽标与行数不一致);下次开 popup 冷启动 preload 又把这个虚高计数点亮。2b5c99f 把徽标语义从 marks 数改为扫描数时引入了该不一致,88dcd2b 的批量删除把它放大。
- 修法:`onRemoved` 里同步 `delete lastScan.results[id]`(可选择写回 `deadLastScan` 存储),或 `badge()` 改用 join 后的计数。

**3. [中] "删除全部(当前筛选)"语义:filter=All 连 blocked 一起删,但文案称其为"失效书签",且丢失"无法一步撤销"警告**
- 位置:`src/view-dead.js:654-655` + `_locales/en/messages.json` `deadDeleteAll`("Delete all $count$ dead bookmarks")
- 事实核对:skipped **不会**进删除集合(`allResultRows` 只收 `ok:false`,view-dead.js:247-251),这点没问题;确认框计数与实际删除集合是同一个 `resultRows()` 快照,一致,这点也没问题。问题在于:blocked 行(代理复查**可达**、大概率没死的书签)在 All 段下会被删除,而对话框文案统称 "dead bookmarks/失效书签",范围误标。另外 v3 遗留键 `deadConfirmAll` 本带"此操作无法一步撤销"——undo 一次 capture 一个条目(undo.js:103-113),toast 的撤销钮一次只能恢复 1 条——新文案把这个警告丢了(dupes 同款问题,但死链这是从有警告退到无警告)。
- 修法:All 段下文案区分(如"N 条结果,含 M 条受限"),或恢复"无法一步撤销"提示;或 All 段 delete-all 只删 dead。

**4. [低-中] 批量删除链不读 `lastError`——793e336 的漏网之鱼**
- 位置:`src/view-dead.js:619-623`(`removeSequentially`)
- 证据:793e336 统一修了 8 处 chrome.bookmarks 回调的 `lastError`(actions/keyboard/tree-render/tree-view/palette/neat),但 88dcd2b 新增的 `chrome.bookmarks.remove(id, resolve)` 未被覆盖。doomed id 在确认对话框打开期间被同步删除/另一页面删除时,控制台会打 "Unchecked runtime.lastError: Bookmark id is invalid",且 toast 仍报 `doomed.length` 全数(虚报)。
- 修法:回调内 `void chrome.runtime.lastError`(或读到则跳过计数),toast 用实际删除数。

**5. [低] 代理整合(a38f916)残留**
- a) **存储无迁移**:老用户 `chrome.storage.local` 里的 `deadProxyTemplate` 永久残留(backup 导出也会携带)。store.js 有 separatorUrl 迁移先例(store.js:241-253),可照做一行 `remove`。
- b) **_locales 清理不彻底**:`deadProxyHint`/`deadProxyTemplateChip` 已删,但 `optionDeadProxy`("死链探测中转模板")仍留在全部 43 个 locale;`deadSummary` 同批变成死键(f5bc7cb 合并统计后无引用)。另 `deadConfirmAll`/`deadConfirmDelete` 在 7fea4d1 时就已是死键(既有问题,非本区间)。
- c) **AGENTS.md 未更新**(本区间仅改 1 行):L36/L48/L54 仍把 `deadProxyTemplate` 描述为活设置、`checkUrlDual` 签名仍含 `proxyTemplate`、options 页仍写"display + clear only"——与 a38f916 后的现实(options 可 add/test/save,clear 契约一致)不符。
- d) **两处 UI 契约小差异**:options(`src/options-proxy.js:108`)写死默认测试 URL,视图面板可自定义 `proxyTestUrl`(view-dead.js:764)——只对特定 URL 可达的代理在 options 里无法保存。"验证可达才保存"的核心契约两边一致(都走 parse→permission→controllable→reachable,options-proxy.js:84-113),options 保存不可达地址会被拒绝并报 `deadProxyUnreachable`,无旁路。
- e) **无双向实时同步**:视图读 init 时 store 镜像,options 读一次性 `getSetting`;任一边改动,另一边(若同时打开)要重开才一致。`hideDeadProxyStrip` 存键默认未设=显示,options checkbox `checked !== '1'`(options-proxy.js:52),取消勾选写 '1'、勾选 `removeSetting`——默认与恢复语义两边一致,无问题。

**6. [低] 徽标修复(2deb3a1/f5ecc9c)的双读竞态(窄窗口)**
- 位置:`src/view-dead.js:1277-1287`(冷启动读)与 `1235-1245`(activate 读)
- 两处都会写 `lastScan`,无代次守卫。`storage.get` 在 t0 发出、其回调晚于一次扫描完成的 `onCacheWritten` 时,会用旧快照覆盖新 `lastScan`(窗口毫秒级,下次存储事件自愈)。2deb3a1 的"读后补 updateBadges"逻辑本身正确(激活时的 updateBadges 跑在异步读之前);双读非破坏性,但值得一个 generation 标记或统一入口。

**7. [低] 注释/健壮性杂项**
- `src/view-dead.js:193-194` `persistMarks` 注释仍写 "The tab badge is the marks count"——徽标语义已改,注释过期。
- `src/options-proxy.js:27-40` 只守卫 `input/saveBtn`,`label/valueEl/clearBtn/hintEl/errorEl` 无 null 检查(当前 options.html 齐全,仅备注)。
- 根文件夹判定(审阅点 2)结论:**正确**。右键菜单 `context-menu.js:343`(`parentid==='0'`)+ `ROOT_DISABLED_IDS`(96-101)+ 分发拦截 + clearMenu 复位;键盘 Delete `keyboard.js:527-529` 同守卫。双存储 Chrome 下特殊文件夹(带 `folderType`)根本不渲染成行(`getEffectiveSubTree` 拍平其 children,tree-render.js:419-442),顶层行 parentid 是特殊文件夹 id 而非 '0',判定无需触发;旧单根 Chrome 下 bar/other/mobile 的 parentId='0',判定生效。`isRootFolder`(tree-render.js:445-455)双认 parentId 0/'0' 与 folderType,无误。

## 测试缺口清单

- **无"干净扫描后 rescan 可达"测试**——问题 1 的回归没被任何测试拦住(现有测试只断言无行时无 delete-all)。
- **无"删除后徽标计数"测试**——批量删除测试(view-dead.test.js 新增 8 例)只验证行消失、marks prune、串行顺序、单次 toast;无人断言 `badge()` 在删除后的值,问题 2 因此漏网。
- **无 filter=All 时 delete-all 语义测试**——现有用例只覆盖 filter=dead 只删 dead 行;All 段含 blocked 的集合与文案无断言(问题 3)。
- **无 remove 中途失败(lastError)链路测试**——书签 stub 的 `remove` 永远成功(问题 4)。
- **无 `deadProxyTemplate` 迁移测试**——因为迁移本身没做(问题 5a)。
- 冷启动 preload 与 activate 双读的竞态无测试(问题 6,低优先)。
- options-proxy 测试覆盖良好(8 例:显示/clear/非法/可达保存/不可达拒存/权限拒绝/他扩展控制/strip checkbox 双向);缺 `busy` 重入锁测试。

## 已核对无问题项

- 串行删除 capture→remove 顺序与单条删除链路一致(dupes 同款配方,chrome 按发起序应用);capture 对不存在节点 no-op,不污染 undo 栈。
- 删除中重绘:onRemoved→scheduleRender 300ms 重 join + confirmDeletion 后预先 prune treeItems,无 stale 行可二次点击;扫描进行中删除按钮整体不渲染(live 分支),UI 层面无扫描中删除入口。
- 新 i18n 键(delete 系列 + proxy strip 系列)在全部 43 个 locale 齐全,无缺失。
- 全量 vitest 1563 例绿。
