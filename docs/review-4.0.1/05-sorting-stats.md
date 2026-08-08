# 审阅报告 05:文件夹排序(#33 两轮)+ 统计视图合并优化

> 基于 HEAD=a38f916;相关 5 个测试套件 212 例实测全绿。审阅日期:2026-08-07。

## 区域 A:文件夹排序 issue #33 两轮

### A1. 持久化语义确认

- **确认是物理重排**:`sortFolderContents` 经 `chrome.bookmarks.getSubTree` 取子树,`VBMSort.sortNodes` 排序后用**串行** `chrome.bookmarks.move(id, {index: i})` 写入 Chrome 书签库(src/neat.js:433-452)。升序移动算法正确(位置 0..i-1 已终态,前移不变式成立)。持久化无额外代码,重开保持——属实。
- **sync 冲突**:每次 move 产生一条 sync 变更;另一端同时排序时两边 move 流交错,结果为逐节点 last-writer-wins 的混合序。这是 Chrome 书签 sync 的固有限制,扩展层无解,属信息性备注。
- **大树性能**:递归排序 = O(节点数) 次串行 move。真正的放大器在监听侧:**visit-stats-sw.js:169-172 把 `onMoved` 直挂无防抖的 `rebuildIndex`(每次 move 一次全量 `getTree`+遍历)**——1000 节点递归排序 = SW 内 1000 次全树重建,O(moves × treeSize)。view-dupes/view-dead/search 的 onMoved 都有 300ms 防抖(无害);sync-engine.js:216 每 move 一次 `getNode`(其 flush 有 500ms 防抖,中等)。**这是既有缺陷被排序功能放大**。

### A2. toast 撤销——发现本轮最重问题

实现路径:排序前 `beforeIds` 快照顶层子节点 id 序列(neat.js:437),排序完成后 `undo.toastAction` 挂一次性动作,Undo 用同一 `moveToIndex(beforeIds)` 按原 index 移回(neat.js:459-462)。**对单层排序,撤销是真的能还原**(按位置恢复,不走删除撤销的按 id 重建——注释解释正确)。

- **【高】递归排序的撤销不完整**:neat.js:437 只快照 `nodes[0].children`(第一层),neat.js:460 撤销也只移回第一层;而 neat.js:445-452 `applyLevel` 递归改写了所有深层顺序。**recursive 排序后点 Undo,子文件夹保持已排序状态**,但 toast 文案是 "Folder sorted · Undo",隐含全量还原。同时 `_locales/en/messages.json:892` `sortRecursiveWarning` = "This reorders bookmarks in every subfolder and **cannot be undone**"——对话框/选项页提示"不可撤销"与随后的 Undo toast 直接互相矛盾。修法:快照改为全层级 `{parentId → 有序 id 序列}`,撤销逐层回放;或递归排序时不弹 Undo 并保留警示文案。二选一,必须一致。
- **【中】无并发防护**:toast 在 `applyLevel` 全部完成后才出现(neat.js:453),大树排序的数秒内用户可再次触发另一条排序指令;两条串行 move 链在 API 层交错,最终顺序既非 A 也非 B,且第二次的 `beforeIds` 快照到的是中间态。修法:排序进行中置锁(或临时禁用三个排序菜单项)。
- **【低】move 回调不读 `chrome.runtime.lastError`**(neat.js:443、461):排序/撤销期间目标节点被删会产生 Unchecked runtime.lastError 警告——与 793e336 的统一治理相悖。修法:回调内读一下 lastError。

### A3. 三方一致性

- 单一持久键 `sortOptions` 成立:右键直接指令(context-menu.js:662-670 点击时经 lazy getter 现读)、SortDialog 预填/写回(dialogs.js:150-196)、选项页排序组(options.js:137-160)三方默认值一致(title/foldersFirst=true/recursive=false),parseSortOptions 对损坏 JSON 回退正确且测试钉死(sort-utils.test.js 新增 4 例)。
- **【低】解析逻辑仍是两份**:options.js:137-157 自带 `SORT_DEFAULT`+`readSort`,未复用 `VBMSort.parseSortOptions`(sort-utils.js 未加载进 options.html)。3c5b52b 提交信息宣称"解析收敛到一处",实际只覆盖了 dialogs/neat。默认值将来改一处漏一处即静默分叉。修法:options.html 引入 sort-utils.js。
- **即时生效**:popup 每次打开重建 mirror,选项页改动下次开 popup 即生效;但 **store.js 的 mirror 无 `chrome.storage.onChanged` 回写**,side panel 长开时选项页改动不会反映到面板的右键标签后缀/对话框预填,需重载面板。【低】
- 右键标签递归后缀、根文件夹隐藏三项(neat.css:1386-1389)、`.disabled` 项键盘跳过(keyboard.js:560-567)与鼠标拒发(context-menu.js:531-534)、键盘合成 contextmenu 事件同路径刷新标签(keyboard.js:301/337)——均验证无误。

## 区域 B:统计视图合并优化

### B1. 合并逻辑——核心逻辑正确,两处次要缺陷

- 匹配合并:URL 折叠单尾斜杠后精确匹配(view-stats.js:130-131);书签化历史行按 bookmarkId 并入 stats 行(时间取较新者,计数以 stats 为准,view-stats.js:283-287);无 stats 条目的已访问书签作为 `c=history.visitCount` 的新行并入(:294-300),标题/parent 取自当次 getTree 的活树——重命名书签不显示历史快照,正确。
- ★/☆ 与计数 pill:★ 为行尾 `.stats-star` 内联 SVG(STAR_ICON_FILLED,aria-hidden,行 span 带 aria-label),☆ 为同槽位空心 SVG 按钮;pill 数据 = stats.c 或 history.visitCount。
- `statsShowUnbookmarked` 过滤在 buildDisplayRows:302,持久化(默认开)、change 事件即时重绘、checkbox 点击早退避免被 bookmarkHandler 的 preventDefault 吃掉(:571-578)——这个坑处理得对,且有测试。
- ☆ 一键收藏后迁移即时一致(:514-533:bookmarkId 原地翻牌→render,★ 出现、☆ 消失、计数不变、右键菜单从 slim 切全量)。
- **【低】会话内 onCreated 盲区**:view-stats 只监听 onRemoved(:554)。popup/panel 会话期间经 quick-add 星标或树内新建的书签,其历史行不会翻成已收藏态;此时点该行 ☆,`addToBookmarks` 只查 `row.bookmarkId`(基于旧树),会 `chrome.bookmarks.create` 出**重复书签**。修法:create 前按 URL 查重,或补 onCreated 防抖刷新。
- **【低/语义】计数 pill 混合度量**:stats 行 = 扩展计数,历史来源行 = history visitCount,同列 ×N 在 count 排序下直接互比(:299 vs :308)。属设计取舍(注释已自认),但头注释 :25 仍写 "count-0 rows"(实为 visitCount)——见 B4 注释债。

### B2. RTL 与 meta 布局

- RTL 实现**正确**:行尾顺序靠 flex `order` 重排(neat.css:3280-3282),锚点是全局 `display:flex`(:640),flex 方向随 `dir=rtl` 自动镜像;间距全部逻辑属性(`margin-inline-end/start`,:3247、3313、3654)。
- 6657a65 覆盖确认:recent/dupes 改(时间→badge.time 槽、路径→row-path 槽),stats/dead/search 本就符合。
- **【低】"统一"未覆盖宽屏副行**:stats 副行是 `时间 · 路径`(view-stats.js:358),recent/dupes 是 `路径 · 时间`(view-recent.js:225、view-dupes.js:362)——同屏两种顺序。另 view-dupes.js:361-362 的路径展示**不受 showItemPath 门控**(recent/stats 都门控),系既有行为但被"统一"叙事覆盖。修法:统一副行模板;dupes 补门控或注释明示豁免。

### B3. 高度 300 锁死修复——正确

- 根因判断准确:树隐藏时 `scrollHeight=0` → 误 shrink 到 minH=300 并持久化,`innerHeight` 锚点把 300 钉成上限。修复两手都对:`$tree.offsetParent === null` 跳过测量(neat.js:371,前提成立——view-manager 用 `hidden` 属性,neat.css:169-171 `[hidden]{display:none!important}` 保证 display:none),`maxH` 用常量 600 替代 innerHeight(:391,同时保住 zoom<1 双滚动条防护),拖拽上限同步换锚(:959)。
- 其他测量陷阱排查:三个调用点(:416 初始化、:419-420 树交互、:1006 zoom)均被守卫覆盖。唯一残留:**非树视图下 Ctrl+滚轮 zoom 时 resetHeight 被跳过,popup 高度不随 zoom 重拟合**(内容内滚,可接受的取舍)【信息】。

### B4. 注释债(低)

view-stats.js 头注释三处过时::17-20 仍描述旧设计("★ badge row-badge.starred"、"badge 槽渲染 active sort key"、"right slot 为 secondary key"——实际 ★ 已移出行尾 .stats-star,badge 恒为 [time, count],rightText 是路径);:25 "count-0 rows" 与实际 `c=h.visitCount` 矛盾;:12 引用中文标签"显示未收藏书签"。

### B5. 性能

- 行渲染无虚拟化:总行数 = 有统计的书签数(prune 以树大小为上界,visit-stats.js:142-156)+ ≤200 历史行,全量 innerHTML;千级书签用户每次渲染数千行(favicon lazy 缓解)。当前可接受,规模化需分页/虚拟列表【低】。
- 排序切换与未收藏开关都走 `refresh()` 全量 getTree(:566、:585),而 buildDisplayRows 内部已按 sort() 重排——collectRows 的排序对显示是冗余的,toggle 本可只 render()【低】。

## 测试缺口清单

1. **`sortFolderContents` 零单测**(本轮最大缺口):moveToIndex 升序算法、beforeIds 快照、toastAction 撤销回放、递归排序撤销只还原顶层的行为,vitest 均无覆盖——只有提交信息声称的 Docker 闭环。tests 里 grep 不到任何 `bookmarks.move` 用例。至少应补:单层撤销还原、递归撤销的顶层/深层行为钉死(无论最终选哪种修法)、move 失败路径。
2. 无并发排序(排序中再触发)测试。
3. view-stats 覆盖较好(合并/计数来源/toggle 持久化/guide 行/星标翻牌/复选框不穿透),缺:quick-add 后 ☆ 重复创建路径、星标翻牌后 `data-parentid` 为空的 staleness、混合度量排序的 pin 测试。
4. options.js 的 `readSort` 与 `parseSortOptions` 双实现无等价性测试(若接受双实现,至少 pin 两者对同一组输入等价)。
5. 未验真机项:RTL 实机渲染、Chrome sync 双端排序交错、千节点递归排序的 SW 重建耗时均未实测。

**优先级建议**:A2 的递归撤销不完整(#高)发布前必须定夺(改实现或改文案);visit-stats-sw rebuildIndex 防抖(#中)建议同版带上;其余低危项可进 backlog。
