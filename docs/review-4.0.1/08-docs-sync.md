# 审阅报告 08:文档同步差距审计(7fea4d1..HEAD,40 提交)

> 所有证据均经代码/提交实测核对:49 套件 1563 例全绿、en/zh_CN 各 371 键、options 11 组、manifest=4.0.1。审阅日期:2026-08-07。

## 基线事实(用于下文对照)

- `git log 7fea4d1..HEAD` 共 40 提交;其中纯 docs 提交 4 个(b550eaa、86757ae、d8aa04b、c78f60e)。
- 实测现状:`npm run test:run` = **49 套件 / 1563 例**;`_locales/en|zh_CN/messages.json` 各 **371 键**;options 页 **11 组**(pages/options.html:17-145,Separators 与 Custom styles 之间新增 `sort-options`);`manifest.json:3` = **4.0.1**。
- 关键代码事实:`deadProxyTemplate`/`proxyTemplate` 已在 src/pages/tests/scripts 中**全局绝迹**(a38f916);`checkUrlDual` 现签名 `(url, { proxyServer = false, timeoutMs = 8000, signal })`(src/dead-links.js:85);经典预设现在关 5 项(src/options.js:113-121,含 `quickAddContextMenu`);下拉协议见 src/dropdown.js:11-20 头注释;`src/dropdown.js:169-183` 明确"Esc 须先关开着的下拉再跑 popup 层级链"(71331d0)。

## 1. docs/README.md / docs/README.zh.md(4.0.1 changelog)

**双语对等性**:4.0.1 段两版完全对等——新增 7 / 修复 15 / 抛光 5 / 变更 2,逐条内容互译一致(逐条比对,含 `(recursive)` 后缀、dropdown 协议、"star → count pill → time" 等细节)。**多记:无**(每条都能落到具体提交)。**漏记如下**:

- **漏记 a38f916(死链代理整合)——高**。这是 40 个提交里唯一无 changelog 的用户可见行为变更:删除了 `deadProxyTemplate` 设置(已配置中转模板的用户升级后设置消失)、options 死链组新增代理服务器输入+测试保存(src/options-proxy.js)、视图代理提示可 × 关闭并经 `optionDeadProxyStrip` 恢复。建议在"变更/Changed"段补一条,双语同补。现"Changed"段(README.md:241-242 / zh:241-242)只有 version.js 与键盘加固两条。
- **4.0 段 EN/zh 不对等——中**。7adac11 只改了英文版(`git show 7adac11 --stat` 证实仅 AGENTS.md + README.md):README.md:80 现状为 "`/theme <name>` (or the direct switches `/dark` `/light` `/ink `/paper`)",而 README.zh.md:80 仍是 "`/session`、`/theme <主题名>`、`/tabs`、`/options`,各带一两个短别名。"——无直达切换。zh 应补"(或直接切换 `/dark` `/light` `/ink` `/paper`)"。
- **测试/键数数字漂移——中**。
  - README.md:101 / zh:101(4.0 Engineering 段):"**1416 unit tests** across **44** Vitest suites" / "1416 个单元测试,44 个" → 现 1563/49。
  - README.md:159 / zh:159(For developers 代码注释):"1262 cases across 39 suites" / "39 个测试文件共 1262 例" → 1563/49。同一文件两个旧数字互相也不一致。
  - README.md:103 / zh:103:"Baseline grew from 75 to **345 keys**" → 现 371。属 4.0 历史语境,建议至少改成 "345(4.0.1 起 371)" 或淡化具体数。
- **dev 套件清单缺项——低**。README.md:169-174 / zh:169-174 列了 5 个 suite,缺 `scripts/screenshots/shots-tabgroups.js`(bef2d35 新增)。
- **4.0 What's-new 段残留模板表述——低**。README.md:66 "or a legacy relay URL template from the options page" 与 :86 "a **Dead scan** group (proxy template, concurrency, timeout)"(zh:66/:86 同)。属 4.0 版本史记,靠补 4.0.1 changelog 条目即可闭环,不必改历史段。
- **开头特性列表——低(可选)**。README.md:12-20 与 Feature highlights(:110-121)无硬漂移(排序在 highlights #6,标签组在 Notes #3);4.0.1 的标签组对话框/死链批删未进卖点列表属编辑取舍。若要补,最小改动是 highlights 加一条死链批量删除、Notes #3 提一句新组对话框。
- 微:83b08a2(搜索历史 ×→垃圾桶 SVG)、71331d0(Esc 优先关下拉)可分别并入"抛光"图标条与"新增"dropdown 条,不必须单列。

## 2. docs/guide-v4.md / docs/guide-v4.zh.md

**回填确认**:b550eaa 的覆盖属实——§3.0(排序右键+选项页排序组、标签组菜单/新组对话框/已有组选择器、根文件夹禁用)、§3.3(合并列表+Show unbookmarked)、§3.4(批量删除)、§4(/dark 等)、§5(quickAddContextMenu 行)、§1(侧栏关闭恢复)、§2.3(输入框不吞视图切换)、§2.5(palette 菜单焦点回输入框)均已写入;双语结构对称(缺口也对称)。

- **§3.4 双通道条目讲的是已删除的代理模板——高**。guide-v4.md:166:"on failure your own **proxy template** (options page → *Dead scan* group; empty = direct only) gets the final say";zh:165 同("由你配置的**代理模板**…留空=仅直连")。模板已删;且整节从未介绍 4.0 就有的"自有代理服务器"机制(视图代理条:添加/替换/清除管理条、nudge、可达性探测)与 a38f916 的新增(options 死链组可设代理、提示区 × 可关、`optionDeadProxyStrip` 恢复)。建议改写为:第二通道=你自己的代理服务器(http/https/socks5),视图内代理条**或**选项页"死链扫描"分组均可添加(保存前解析→权限→可控性→可达性探测,不可达拒收);无代理时的提示条可用 × 关闭、在选项页复选框恢复。双语同改。
- **§7 隐私段同一漂移——高**。guide-v4.md:240:"your own proxy template, if configured";zh:239 同。改为"代理服务器"。
- **§2.1 下拉协议不完整——中**。guide-v4.md:60 / zh:60 只写 "`↓` opens the list…`→` (`Enter` or `Space`) applies…`←` (or `Esc`) closes",缺两点:关闭态 trigger 上 `Enter`/`Space` 同样展开(dropdown.js:140),列表内 `Tab` = 应用并关闭(dropdown.js:164-165)。keyboard-model §2.5 与 README changelog 都写全了,guide 与权威模型不一致。
- **§2.4 Esc 分层链缺下拉层——中**。guide-v4.md:105-110 / zh:105-109 的链无"开着的下拉"。71331d0 后 Esc 优先关下拉。建议链首加"open dropdown → close it, focus back to the trigger"。
- **§5 经典预设描述少一项——低**。guide-v4.md:205 / zh:204:"turns off the command palette, the quick-add star, the tool button and the view-tab strip"——缺"its page right-click entry";产品自身文案 `_locales/en optionClassicExperienceHint` 已含该句,代码关 5 项。
- **§3.1 历史行删除按钮仍是 `×`——低**。guide-v4.md:135 / zh:134:"the row's `×`"——83b08a2 已改为复用死链垃圾桶的 SVG(TRASH_ICON)。改"行尾删除按钮(垃圾桶图标,hover/焦点显现)"。
- **§3.4 过滤条可补计数——低**。guide-v4.md:167 / zh:166 "All / Dead only / Blocked only"——f5bc7cb 后各段带计数(All 2 · Dead 1 · Blocked 1)。
- 微:guide-v4.md:3 / zh:3 "Applies to 4.0" 可考虑 "4.0.x"(4.0.1 机制已大量回填)。

## 3. AGENTS.md

4.0.1 区间只更新过 palette 行(`git diff` 证实仅行 41 一处),其余全是漂移:

- **行 9 版本号——高**。"Current version: **4.0**" → **4.0.1**(manifest.json:3)。
- **布局表缺 4.0.1 全部新模块——高**。行 17-63 无 `src/dropdown.js`、`src/options-proxy.js`、`src/tab-groups-sw.js`、`src/tab-group-utils.js`、`src/version.js` 任何一行(grep 零命中);`tests/focus-regression.test.js`(241c860 的焦点 gate)亦无着落。
- **行 54 options 行多处过时——高**。①"one page, **ten** groups: General / Views / Commands / Sync / Accessibility / Custom icon / Separators / Custom styles / Dead scan / Backup+reset" → 现 **11 组**,Separators 后多了 **Sorting**(options.html:117-124)。②"the Dead-scan group holds … `deadProxyTemplate` and the `deadProxyServer` row (display + clear only — adding/testing lives in the dead-links view…)" → 模板已删;死链组现为代理输入+测试保存+当前值+清除(options.html:136-144)+ `dead-proxy-strip-visible` 复选框。③Views 组枚举缺 `quickAddContextMenu`;"optionClassicExperience unchecks **those three** plus showViewTabs" → 现为**四个** + showViewTabs(options.js:113-121)。
- **行 36 view-dead 行——中**。"(`deadProxyServer`/`deadProxyTemplate`/… settings)"、"failures degrade to direct+**template**"、代理条"chip + change/remove"旧状态机——均被 a38f916 改写(管理条常显 / 无代理=添加+nudge+× / `hideDeadProxyStrip` 只管提示区)。
- **行 48 dead-links 行——中**。"`checkUrlDual(url, { proxyServer, proxyTemplate, timeoutMs })` … or a legacy relay template with a `{url}` placeholder" → 现签名无 proxyServer 之外通道(dead-links.js:85-91)。
- **行 25 actions 行——中**。"open-all as a color-coded tab group via `chrome.tabs.group`+`tabGroups` (P3.4…)" → 5df7631 已把建组/入组移入 SW(tab-groups-sw.js),并新增"…并设置"对话框与"打开到已有标签组"(tab-group-utils.js)。
- **数字三处——中**。行 63 "345 keys" → 371;行 89 "Test files (**44** —" → 49;行 111 "the same 345 keys" → 371。
- **行 123 harness 段——中**。"the merged options page's **10** groups" → 11;套件枚举缺 `scripts/screenshots/shots-tabgroups.js`;"a `<select>` keeps native ↑/↓" → 去重 strategy/scope 已是自绘下拉(verify-keyboard.js:366-376 现测 `.vbm-dropdown`)。
- **行 20 background 行——低**。"`chrome.proxy` only exists once the **optional** `proxy` permission was granted" —— proxy 自 4.0 起是安装时权限(行 19 自己就写着 install-time),"optional" 为矛盾残留;同行 `vbm-quick-add` 菜单描述未提 dcc1f9e 的开关与 storage.onChanged 实时增删。
- **行 ~73 "no CI configuration in the repo"——低**。`.github/workflows/ci.yml` 存在(4.0 起)。行 ~98 打包段未提 bef2d35 的递归 import 解析(package.py:202-206,`src/dropdown.js` 即靠它入包——显式清单里确实没有它)。
- 微:行 113 "(no automated E2E exists)" 与下一节 Docker harness 并存,措辞可酌。

## 4. docs/keyboard-model.md

- **§2.5 下拉协议已写入且准确——无需改**(行 146-157,与 dropdown.js:11-20 一致,含 Enter/Space 开、Tab 应用、↑ 不拦截;§8 行 288 也正确挂了 dropdown.js 与 tests/dropdown.test.js)。
- **§4 Esc 蛋糕缺下拉层——中**。行 197-216 的 8 层无"open dropdown"。代码侧 src/dropdown.js:169-183 明确注释"Esc 必须先关下拉,否则开着的 listbox 上按 Esc 会退回树/关弹窗"。建议在 1-4 层(dialogs/menu/banner/palette)附近加一层:"An open dropdown → close it, focus returns to its trigger"。
- **§8 引用了不存在的测试文件——低**。行 287 "`tests/search-history.test.js`" —— tests/ 下无此文件(搜索历史用例在 tests/search.test.js)。
- 微:§8 可为 `tests/focus-regression.test.js`(241c860,跨视图焦点移交必过 gate)补一行挂载点(§2.1/§5 焦点记忆相关行)。

## 5. docs/issues/issues-46-48-feedback.md

- **修复状态全部一致**:#46 ✅(94604e2)、#47 ✅(94604e2)、#48 ⚠️ 待报告者补充(其后无任何修复提交,仍为开放态)、#49 ✅(dcc1f9e,含选项页开关+经典预设+2 个 i18n 键)。无需改状态。
- 微:行 1 标题"# Issues #46 / #47 / #48 反馈"与行 3"三个 issue"未跟随 86757ae 补入的 #49 章节与版本决定——内容对、名不副实。
- 微:行 17/27"44 套件/1419 例"、行 126/137"45 套件/1439 例"是当时验证快照(现 49/1563)——历史陈述非漂移,如需严谨可加"(修复时点)"。

## 6. README 特性/截图(docs/images/guide/)

特性列表见 §1 最后两条(低/可选)。**截图全部停留在 14cf6e4(4.0 时代),4.0.1 未重拍**;逐张核对结果:

| 图 | 漂移 | 证据 | 严重度 |
|---|---|---|---|
| `view-dead.png` | 无红色"删除全部"按钮、filter 段无计数、工具行旧序(f5bc7cb/88dcd2b);nudge 无 ×(a38f916);行尾按钮非 SVG 线稿(25ad2e3) | 图中工具行为 "Last scan…Rescan Dead:2·Blocked:1" + "All/Dead only/Blocked only" + "Mark all/Clear all marks/Select" | **高** |
| `view-stats.png` | 仍是"Bookmark statistics + Recent visits 授权分区"旧两区;无合并列表/实心 ★/工具行 Show unbookmarked(5448e43) | 图中独立 "Recent visits / Grant history access…Enable" 区 | **高** |
| `options-views.png` | Views 组缺"页面右键收藏此页"复选框(dcc1f9e);预设提示文案也已更新 | 图中 11 个复选框无 `optionQuickAddContextMenu` 项 | 中 |
| `palette.png` | 命令表 13 条,缺 /dark /light /ink /paper(7adac11;现 17 条) | 图中列表止于 `/options` | 中 |
| `dead-select.png` | 批量条缺 "Delete selected"(88dcd2b);nudge 无 × | 图中条为 "All/Invert/Clear/Mark selected/Unmark selected" | 中 |
| `view-dupes.png` | strategy/scope 仍是原生 select 外观(40e240a 起自绘下拉,b2e54be/71331d0 重做样式);组头 ✓ 已 SVG 化(f7cb4f8) | 图中两个 select 样式控件 | 低-中 |
| `view-recent.png` | 默认 `showItemPath=1`(options.js:74)下应有 `路径 · 时间`,图中只有时间 | 图右侧仅 "just now/5 days ago/…" | 低 |
| `search-dualzone.png` | 删除按钮 hover 才显现,静态图影响不大;清除按钮样式微调(f5bc7cb) | — | 低(基本可用) |
| `tabs-themes.png`、`dupes-select.png` | 未见明显漂移 | dupes-select 的批量条(Dedup selected)4.0.1 未变 | 无 |

重拍路径现成:`scripts/harness/run.sh`(shots-guide.js 覆盖 search-dualzone/dupes-select/dead-select/options-views 四张;shots.js、shots-palette.js 覆盖 view-dead/view-stats/view-dupes/view-recent/palette)。

## 7. manifest description / appDesc

- manifest.json:4 `description = __MSG_extDesc__`;en `extDesc` = "A popup bookmark manager. Enhanced Neat Bookmarks. Neater than Neater Bookmarks."(无 `appDesc` 键,就叫 `extDesc`)。版本无关文案,**4.0.1 无需调整,无漂移**。

## 附带(代码注释级,超出文档区但顺手记录)

- src/dead-links.js:104 注释 "…injects checkUrlDual with the configured proxy **template**" —— 模板已删,注释漂移。
- scripts/harness/verify-keyboard.js:242 注释 "(a `<select>` keeps native ↑/↓)" —— 同上,机制已换自绘下拉。

**优先级建议**:先补 README 双语 changelog 的 a38f916 条目 + zh:80 的 /dark 对等(发行门面);再改 guide §3.4/§7 的模板漂移与 AGENTS.md 的版本号/模块表/组数/键数/测试数(新协作者入口);Esc 下拉层进 keyboard-model §4;截图重拍可作为 4.0.1 发布前最后一道。
