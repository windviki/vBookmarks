vBookmarks
==============

[English Readme](README.md) | [中文说明](README.zh.md)

[![Donate me](https://img.shields.io/badge/donate-me-orange.svg)](../donation/donation.md) | [![捐赠](https://img.shields.io/badge/捐赠-支持-orange.svg)](../donation/donation.zh.md)

![Image of vBookmarks](../assets/store/vbookmarks.png)

[Chrome 应用商店安装](https://chrome.google.com/webstore/detail/vbookmarks/odhjcodnoebmndcihdedenkmdmklpihb) · [主页](http://windviki.github.com/vBookmarks/)

**vBookmarks 把你的书签堆变成一个快速、键盘优先的工作台。** 点击工具栏图标，弹窗里是一个六视图管理器（也可以搬进 Chrome 侧边栏，随你选）：熟悉的文件夹树、即时模糊搜索、最近添加时间线、访问统计、死链扫描器、重复清理器。一切皆可键盘完成，每次删除都能撤销，数据不出浏览器——没有账号、没有遥测、没有构建黑盒，只有你读得懂的纯 JavaScript。

- **六个视图，一个弹窗** —— 树 / 搜索 / 最近 / 统计 / 死链 / 重复，图标 tab 条切换，或 `Alt+1…6` 直达。
- **书签库的保养队** —— 死链扫描可暂停续扫；重复清理六种保留策略、批量删除可撤销；整个窗口的标签页一键存为会话文件夹。
- **真·键盘优先** —— 每个视图都能脱离鼠标完整操作：方向键、`Enter`、`F2` 重命名、`Delete`、视图快捷键，外加 `Ctrl/Cmd+K` 命令面板。
- **快而安静** —— fzf 风格模糊搜索、命中高亮（对中日韩友好）；地址栏 `*` + 空格搜书签；同步状态指示克制不吵。
- **随你打扮** —— 五套精制主题、自定义 CSS、自定义工具栏图标、单视图显隐开关——也可以整条隐藏 tab 条，回到经典单栏模样。
- **隐私为先** —— 数据全本地，43 种语言，MIT 开源。
- **Chrome 与 Edge 通吃** —— 同一个 MV3 包两款浏览器都能装（`scripts/package.py --target chrome|edge`；Firefox 需要构建步骤，评估见 [browser-compat.md](browser-compat.md)）。

基于 [MIT 协议](http://www.opensource.org/licenses/mit-license.php)开源。常见问题见 [FAQ](https://github.com/windviki/vBookmarks/wiki/FAQ)。4.0 新特性上手请读 [v4 功能指南](guide-v4.zh.md)。


# 为什么选择 vBookmarks

- **现代而克制的界面** —— 完整的设计令牌体系，五种外观：跟随系统、亮色、暗色，外加两个精心调制的 fable 主题：**Ink（墨色）** 与 **Paper（纸感）**。
- **随手即达** —— fzf 风格模糊搜索，命中字符高亮（对中日韩友好）；可重跑的搜索历史；**命令面板**（`Ctrl/Cmd+K`）统一了书签搜索、文件夹跳转、视图跳转与高级命令。
- **内置效率工具** —— 双通道死链扫描（可暂停/恢复）、六种保留策略的重复清理（批量删除走撤销链）、会话保存，每次删除都有一键撤销。
- **快速收藏无处不在** —— 弹窗星标按钮、`Ctrl/Cmd+D`、全局快捷键 `Alt+Shift+S`、页面右键菜单"收藏此页"。
- **同步状态感知** —— Chrome 138+ 的双存储（本地/已同步）下，仅本地子树柔和淡显，根文件夹标注`（仅本地）`/`（已同步）`；跨存储拖拽用温和的 toast 提示代替生硬的失败。
- **43 种语言**，全部与英文基准对齐，由 LLM 辅助的翻译流水线持续同步。
- **隐私无忧** —— 纯 ES6+ JavaScript，无框架、无构建、无遥测；你看到的源码就是你运行的代码。访问统计只存在本地，一个开关停采、一个按钮清空。


# 4.0 新变化

4.0 是项目史上最大的一次发布。弹窗被重构为**视图系统**——图标 tab 条后的六个专业视图——而经典的书签树体验只需一个设置就能回来。

## 视图系统

- **六个视图**：**树**（经典）、**搜索**、**最近**、**统计**、**死链**、**重复**。图标 tab 条带实时计数角标（死链标记数、重复组数、已统计页面数）；统计/死链/重复可单独隐藏，整条 tab 条也可隐藏，回到经典单栏布局。
- **全视图同一套键盘模型** —— 树视图成熟的方向键语义（↑↓、`Home`/`End`、`PageUp`/`PageDown`、`Enter`、`F2`、`Delete`、键入过滤）在每个列表视图完全一致；首行再按 `↑` 逐级上到 tab 条、再到搜索框；tab 条本身支持 ←/→/Home/End 漫游焦点与 RTL 感知；`Alt+1…6` 直达视图（Chrome 与 Edge 通用的写法——Edge 把 `Ctrl+1…8` 保留给了自己的标签页切换）。
- **分层 `Esc`** —— 右键菜单 → 命令面板 → 视图级动作（如暂停扫描）→ 清空搜索 → 回到树 → 关闭弹窗，一次只剥一层。
- **弹窗与侧栏分工** —— 两者默认都在你上次离开的视图重新打开（弹窗靠的是默认开启的"记住上次所在的视图"开关，关掉则总是从树启动）；侧边栏随时可以变成常驻的书签工作台。

## 搜索视图——双区结构

- 弹窗搜索长大成独立视图：**上区历史、下区结果**，两区同屏共存。
- **搜索历史**（MRU 10 条）只记录真正用过的查询——按 `Enter`、打开结果、或离开视图时——带结果数与相对时间。点击或按 `Enter` 重跑，`Delete` 或右键菜单单条移除/清空；设置里关掉历史会立即停记并清空存量。
- 离开再回来，搜索框、结果列表、滚动位置全部原样留存——不重排、不重查。

## 最近视图

- 旧的树内"最近添加"区独立成 tab：最新书签按**今天 / 本周 / 本月 / 更早**粗分组，每行右侧相对时间徽章，第二行 `路径 · 精确时间`。
- 按 `R`（或右键）在树中定位；可选地从 Chrome 历史一次性回填更早的访问（默认关闭，仅在你主动开启时请求权限）。

## 统计视图——你的真实使用

- **访问统计，100% 本地**：从弹窗打开的书签会被计数；后台采集器还会捕捉你从地址栏等其它入口打开书签 URL 的导航（去重协议保证一次打开不计两次）。
- 按**次数**或**最近**排序（选择持久化）；一个 ConfirmDialog 确认的按钮清空全部；关掉 `statsEnabled` 即彻底停采，清除出口始终可达。
- **最近访问**分区列出 Chrome 记录的真实访问：已收藏的带 ★ 徽章，未收藏的一键 ☆ 收入书签。

## 死链视图

- **双通道检测**：直连优先；失败时由第二通道终判——"对全世界都挂了"和"只是这里被墙"是不同的徽章。第二通道可以在列表上方的代理条里**一键添加你自己的代理服务器**（http/https/socks5，保存前先做可达性探测，不可达不保存），也可以沿用选项页的中继 URL 模板。
- **代理机制，边界透明**：走代理的探测由一段临时 PAC 脚本路由，它只匹配扫描器自己带标记的探测 URL——其他标签页的流量保持原路径，扫描结束、取消或弹窗关闭时设置即刻还原。`proxy` 权限在安装时声明（Chrome 不允许把它列为可选权限）；**只要你没有配置代理服务器、或从不使用死链扫描，该权限完全不会被使用**——不会执行任何代理相关代码路径。
- **渐进呈现、可暂停、且比弹窗长寿的扫描**：扫描跑在 service worker 里——中途关掉弹窗或侧边栏进度不丢，重开即见实时镜像，被打断的扫描还会自行续跑。结果逐行流入；`Esc` 暂停/续扫不丢进度；取消会回退到上次完成的快照。进度刷新是静默的，绝不动你的滚动位置。
- **首次清理前的风险横幅**（死链与去重都会批量改写书签）附 Chrome 官方备份与恢复说明的链接；"不再提示"后到下一个大版本前都不再出现。
- 并发（1–16）与超时（2–30 秒）可调；死链/受阻/全部三态过滤附死链·受限计数；**死链标记**——标一次，红色 ✕ 会跟着这条书签出现在树、搜索、最近、统计所有视图里。

## 重复视图

- 找的是真重复，不是字符串相等：归一化先于分组（剥掉 `utm_*`/`fbclid`/`gclid` 等跟踪参数、去掉 hash、可选 http/https 合并）。
- **六种保留策略**——最旧、最新、书签栏优先、最短标题、最浅层级、最常访问（读统计视图的真实数据）——组内还可以用 `K` 或单选钮手动指定保留项。
- **先预览，后执行**：待删行划线预览，确认后才动手；批量清理走撤销链、只弹一条汇总 toast；上次结果有快照，重开弹窗即时绘制、后台再校验漂移。

## 命令面板再升级

- 弹窗内 `Ctrl/Cmd+K`，全局 `Ctrl/Cmd+Shift+K`：模糊搜书签、跳文件夹，以及一张收敛过的斜杠命令表——每个视图一条 **Go** 命令、`/add` `/new` `/folder`、`/session`、`/theme <主题名>`、`/tabs`、`/options`，各带一两个短别名。
- **自定义斜杠指令**：打开 URL、用剩余词填充 URL 模板（`/g kimi code`）、把书签文件夹开成标签页组、带预设跳视图——在选项页"命令"分组管理，也可以从面板的"存为指令"行直接创建；随同步区跨设备同步，行上按 `→` 可编辑/删除。
- 普通查询词给出桥接行，一键送进完整搜索视图；失焦自动关闭，不留残留状态。

## 设置、备份与经典外观

- 选项页新增**视图**分组——tab 条与单视图显隐、计数角标、"记住上次视图"开关、命令面板/快速收藏星标/工具按钮的界面开关，以及一枚**"一键恢复经典界面"**按钮——另有**"死链扫描"**分组（代理模板、并发、超时）。
- **备份与恢复**：全部设置导出为带时间戳的 JSON，再导入时按合并语义覆盖——换电脑不再需要重点四十个开关。
- 选项页与高级选项页**合并为单页**，响应式多列卡片布局，从 320px 到 4K 都可读（旧高级选项地址自动跳转）。
- **善待经典用户**：点一次"一键恢复经典界面"——或按自己的口味逐项关闭——4.0 就是你熟悉的那只 vBookmarks；每个新界面都可以关掉。

## v4 地基

- 搜索框修复并现代化：消除点击穿透死区；自定义清除按钮，有内容时稳定出现。
- 向折叠文件夹添加书签/文件夹/分隔线立即可见：文件夹自动展开并展示新节点。
- "复制标题和 URL"迁移到异步 Clipboard API（新增 `clipboardWrite` 权限），恢复可用。
- 同步呈现重做：已同步行保持安静、tooltip 本地化、双存储根标注`（仅本地）`/`（已同步）`、拖拽拦截改 toast、"高亮未同步"真正淡显仅本地子树。
- 全量内联 SVG 图标（文件夹、bookmarklet、展开箭头、视图 tab），位图图标退役。

## 工程

- **1386 个单元测试**，43 个 Vitest 套件覆盖全部模块——含钉住行对齐几何、z-index 层级表、各主题徽标对比度的契约测试。
- **Docker harness**：零控制台错误冒烟、真实浏览器键盘/视图验证套件（tab 条键盘模型、焦点区域、头部行方向链、各视图 ↑↓ 越顶含死链视图双工具行层级、横幅键盘可达、搜索双区、逐视图渲染、面板自定义指令——115 条硬断言），以及 5 主题 × 8 界面语言的截图套件（含 RTL 镜像断言）。
- 统一语言工具（`scripts/i18n.py`）：审计、缺失报告、LLM 批量翻译、verify 门禁。基准键从 75 增至 **345**，43 个语种全部对齐。
- **CI**：GitHub Actions 在每次 push 与 PR 上跑单测、i18n 门禁与发布打包。
- 目录结构 v4 重组：`src/`、`pages/`、`css/`、`assets/`、`scripts/`；过时产物（旧 `release/*.crx`、MV2 遗留）留存于 git 历史。


# 功能亮点

1. 一个弹窗六个视图：树、搜索、最近、统计、死链扫描、重复清理。
2. 把当前页收藏到选中书签/文件夹的前后，或文件夹的顶部/底部。
3. 添加子文件夹；用当前页 URL 更新书签；一键复制标题 + URL。
4. 搜索历史：重跑、单条移除、清空全部——可在设置中关闭（并清空存量）。
5. 访问统计：暂停开关、一键清空、最近访问分区（可选使用 Chrome 历史）。
6. 文件夹内容排序：按标题或日期，可选文件夹优先、可选递归。
7. 可同步的书签分隔线，样式可自定义。
8. 真正的主题系统：亮 / 暗 / 跟随系统 / Ink / Paper，共享设计令牌。
9. 可选侧边栏模式（选项开启，弹窗仍是默认），快捷键 `Alt+Shift+B`。
10. 命令面板（`Ctrl/Cmd+K`，全局 `Ctrl/Cmd+Shift+K`）与地址栏搜索：输入 `*` 加空格。
11. 每个视图都有完整键盘支持，树内拖拽排序。
12. 克制的同步状态呈现：只有"仅本地"与"无法同步"才有标记。


![vBookmarks 功能图](../assets/store/vbookmarks-menu.png)


# 高级功能说明

1. **地址栏搜索** —— 输入 `*` 加空格，即可搜索书签。
2. **完整键盘支持**，六个视图语义一致（详见 [v4 功能指南](guide-v4.zh.md)）：
   - **↑↓** 移动选中行；首行再按 **↑** 逐级上到 tab 条、再到搜索框
   - tab 条上 **←→** 切换视图；行上 **→** 打开右键菜单，**←** 关闭
   - **Enter** / **Space** 打开；**Ctrl/Cmd+Enter** 在新标签页打开
   - **Home** / **End**、**PageUp** / **PageDown**；**Alt+1…6** 直达视图（`Ctrl/Cmd+1…6` 是旧孪生键，浏览器放行时仍可用）
   - **Delete** 删除（可撤销）；**F2** 重命名；**R** 在树中定位；重复视图 **K** 设保留项；死链视图 **M** 打/消标记
   - 树与搜索视图支持键入过滤：直接输入关键字实时筛选
3. 中键点击文件夹，在新标签组中打开其全部书签（自动配色）。
4. `Ctrl+F` 聚焦搜索框；`Esc` 分层退出（由内向外）：关菜单 → 关命令面板 → 视图级动作（暂停扫描/退出选择模式） → 清搜索 → 回树 → 关弹窗。
5. **命令面板**（弹窗内 `Ctrl/Cmd+K`，全局 `Ctrl/Cmd+Shift+K`）：
   - 模糊搜索书签和文件夹、跳转到树中的文件夹、或执行斜杠命令
   - 斜杠命令：`/recent` `/stats` `/dead` `/dupes` 跳转视图，`/session` 保存当前窗口标签页，`/options` 打开设置，`/theme <主题名>` 切换主题，`/tabs` 切换 tab 条——另有**自定义指令**（选项页"命令"分组管理，或从面板"存为指令"行直接创建）
6. 拖拽排序；跨同步/本地存储的拖拽会被安全拦截并给出提示。
7. 可设置点击书签后是否关闭弹窗。
8. 可只显示书签栏内容（选项中开启）。
9. 可设置后台标签页打开书签。
10. 选项中可调节弹窗缩放级别。
11. **选项页**："分割线"分组自定义分隔线标题/URL/样式；"死链扫描"分组调节扫描并发与超时。
12. **选项页**："自定义样式"分组可自定义整个弹窗的 CSS（CodeMirror 编辑器），例如 `* { font-family: Consolas; }`。
13. **选项页**："自定义图标"分组可替换扩展工具栏图标。
14. 可关闭弹窗高度自动调整，保持固定高度。
15. 选项页底部的备份组可导出/导入全部设置（JSON）。


# 开发指南

无构建步骤 —— 在 `chrome://extensions/` 中**加载已解压的扩展程序**，选择仓库根目录即可。

```bash
# 单元测试（Vitest，39 个测试文件共 1262 例）
npm install
npm run test:run

# 无头 harness（Docker；截图输出到 tmp/shots/）
scripts/screenshots/run.sh                # 冒烟 + 键盘验证 + 全部截图套件
scripts/screenshots/run.sh --smoke-only   # 仅零控制台错误 + 键盘/视图检查
#   smoke.js             弹窗/侧栏/选项页零控制台错误
#   verify-keyboard.js   tab 条键盘模型、焦点区域、逐视图渲染
#   suites/shots.js         交互状态（亮/暗主题）
#   suites/shots-themes.js  五主题视图行
#   suites/shots-i18n.js    树/tab 条/菜单/对话框/选项页 × 8 种界面语言
#   suites/shots-palette.js 命令面板 + 四个功能视图
#   suites/shots-guide.js   指南配图（搜索双区、选项页视图分组）
#   diag/                手动诊断探针，按需进入镜像运行

# 语言流水线（scripts/i18n.py，仅标准库）
python3 scripts/i18n.py audit      # 代码中使用的键 vs 英文基准
python3 scripts/i18n.py missing    # 各语种缺失 / [TODO] 报告
python3 scripts/i18n.py translate --apply   # LLM 批量翻译
python3 scripts/i18n.py verify     # 门禁：键对齐、TODO、菜单长度
# translate 从 git 忽略的仓库根 .env 读取 LLM 端点配置：
#   VBM_LLM_API_KEY=...  VBM_LLM_BASE_URL=...  VBM_LLM_MODEL=...
#   VBM_LLM_API_TYPE=openai|anthropic_messages

# 发布打包（版本号读自 manifest.json）
python3 scripts/package.py         # → tmp/vBookmarks_<版本>.zip
```

`tmp/` 与 `.env` 已被 git 忽略。新增运行时文件时请同步 `scripts/package.py` 的文件清单；完整的协作者指南见 `AGENTS.md`。


# 技术细节

- 纯 ES6+ JavaScript（无框架、无打包器）；[CodeMirror](http://codemirror.net/) 支撑自定义 CSS 编辑器。
- [Neat Bookmarks](https://github.com/cheeaun/neat-bookmarks) 的继任者 —— 感谢 [cheeaun](https://github.com/cheeaun) 的开创性工作。
- 4.0 之前的旧发布物（`release/*.crx`）已从工作区移除，仍可在 git 历史中获取。


# 更新日志

**ver4.0 2026/07**

新增：六视图管理器（树 / 搜索 / 最近 / 统计 / 死链 / 重复），图标 tab 条、实时计数角标、单视图显隐开关、`Alt+1…6` 直达。搜索视图双区布局与可重跑的搜索历史。最近视图粗时间分组与树中定位。本地访问统计：后台采集器、最近访问分区、一键加星。死链扫描：双通道检测、渐进呈现、暂停/恢复/取消、跨视图死链标记——**扫描跑在 service worker 里**，中途关掉弹窗进度不丢——第二通道新增支持**你自己的代理服务器**（http/https/socks5）：视图代理条一键添加，校验地址并探测可达性（不可达拒收）后才保存，更换/移除同处可及，选项页同步展示与清除；路由采用标记匹配的临时 PAC，仅扫描器自己的探测 URL 走代理（其他标签页不受影响，扫描结束/取消/弹窗关闭即还原，崩溃残留由 Service Worker 清扫）；工具栏新增死链·受限计数与"配置代理区分真死链与区域受限"引导。重复清理：URL 归一化、六种保留策略、待删预览、可撤销的批量删除。两个批量工具首次使用前都会显示"先备份"风险横幅。命令面板升级：逐视图 Go 命令、`/theme <主题名>`、`/session`、`/options`、别名、自定义斜杠指令（URL/模板/文件夹成组/视图预设，随同步区同步）、搜索桥接行、失焦自动关闭。选项页：视图分组、命令分组、设置备份/恢复、响应式卡片布局。Ink 与 Paper 双 fable 主题；快速收藏星标按钮；同步状态呈现重做（安静圆点、本地化 tooltip、`（仅本地）`/`（已同步）`根标注、拖拽拦截 toast、"高亮未同步"淡显生效）。

修复：搜索框点击穿透与原生清除按钮不可靠（新增自定义清除按钮）；向折叠文件夹添加内容立即可见；复制标题/URL 改用异步 Clipboard API（新增 `clipboardWrite` 权限）；非空文件夹删除恢复确认门控（删除仍可撤销）。

抛光：死链与重复视图新增选择模式（批量标记/批量清组，`Esc` 退出）；`Tab`/`Shift+Tab` 区域循环覆盖列表内工具行，各区域带焦点记忆；重复视图成员行键位（`Enter` 打开副本、`←` 回到组头）与组头菜单；"记住上次视图"（默认开）与角标、命令面板、星标、工具按钮开关，外加"一键恢复经典界面"按钮；选项页与高级选项页合并为单页（旧地址自动跳转）；全局快速收藏快捷键（`Alt+Shift+S`）；全部右键菜单补齐 ARIA 角色，对话框加 `aria-modal` 与焦点圈禁；favicon 懒加载；接入 GitHub Actions CI。

变更：仓库目录重组（`src/`、`pages/`、`css/`、`assets/`、`scripts/`）；删除过时 `release/` 与 MV2 遗留（留存 git 历史）；图标全量内联 SVG；语言基准增至 306 键，43 个语种经 `scripts/i18n.py` LLM 流水线重新对齐；测试增至 40 个文件 1303 例；Docker harness 扩展键盘/视图验证套件与多主题、多语言截图；`proxy` 权限为安装时声明（Chrome 不允许列为可选权限），仅在配置了代理且扫描运行中（或添加流程的可达性探测时）使用——不设置代理服务器或不使用死链功能时完全不触发。


**ver3.7 2026/05/10**

新增：[#36](https://github.com/windviki/vBookmarks/issues/36)：弹窗高度自动调整开关（常规设置）。

修复：[#42](https://github.com/windviki/vBookmarks/issues/42)：Chrome 148 弃用 `<command>` 元素导致扩展失效，改用 `<div>` 完全兼容。

新增：自 cc-dev 分支同步的 42 语言支持，全部对齐英文基准（75 键）：ar, bg, bn, cs, da, de, el, en, es, et, fa, fi, fr, he, hi, hr, hu, id, it, ja, ko, lt, lv, mk, nl, no, pl, pt, pt_BR, pt_PT, ro, ru, sk, sl, sv, th, tr, uk, vi, zh, zh_HK, zh_TW。


**ver3.6 2024/01/08**

修复：[#31](https://github.com/windviki/vBookmarks/issues/31)：自定义图标失效。


**ver3.5 2023/09/04**

修复：[#29](https://github.com/windviki/vBookmarks/issues/29)：清除搜索文本后光标焦点不保留在搜索框。

修复 manifest 快捷键。默认快捷键现为 Ctrl+Shift+V（Ctrl+Shift+B 在新版 Chrome 不可用）。


**ver3.4 2023/02/14**

修复：[#26](https://github.com/windviki/vBookmarks/issues/26)：后台打开文件夹。

新增：方向键右键打开上下文菜单（焦点在已打开文件夹或书签上时），左键关闭菜单。

移除高度重置延时，加快弹窗速度。


**ver3.3 2023/02/02**

修复：[#23](https://github.com/windviki/vBookmarks/issues/23)：选项页链接错误。

修复：[#26](https://github.com/windviki/vBookmarks/issues/26)：Chrome 107 中中键/Ctrl 点击不再后台打开书签。

新增：[#24](https://github.com/windviki/vBookmarks/issues/24)：新增关闭即时搜索的选项（按 ENTER 搜索）。

修复：愚蠢的双滚动条（终于）。

修复：退出搜索模式时焦点丢失。

修复：搜索模式下方向键下报错。

修复若干 undefined 错误。

升级至 Manifest V3，minimum_chrome_version = 88。


**ver3.2 2020/09/12**

修复：[#19](https://github.com/windviki/vBookmarks/issues/19)：「添加到文件夹末尾」功能失效。

新增：[#15](https://github.com/windviki/vBookmarks/issues/15)：搜索栏支持搜索文件夹。

新增：弹窗高度调整。

新增：意大利语。

新增：俄语，感谢 @Stanislav。

修复若干 undefined 错误。

升级至 ECMAScript 6，minimum_chrome_version = 61。



**ver3.1 2020/07/03**

修复：[#12](https://github.com/windviki/vBookmarks/issues/12)：清除菜单时焦点丢失。

修复：[#18](https://github.com/windviki/vBookmarks/issues/18)：拖拽到顶部/底部时树不滚动。

修复按下方向键时的 undefined 错误。

修复 bookmarklet 支持，感谢 @ZG-nico。

新增：法语，感谢 @Fab-fr。

新增：中文（香港）。


**ver3.0 2019/08/22**

修复：新图标。


**ver2.9 2019/08/22**

修复：Chrome 77+ 双滚动条。


**ver2.8 2019/05/06**

修复：中键点击重复打开 URL。https://github.com/windviki/vBookmarks/issues/9

修复：搜索偶发失败。https://github.com/windviki/vBookmarks/issues/7

修复：右键菜单位置。

改进：滚动条 CSS。

新增：书签 URL 占位符 "\_\_VBM_CURRENT_TAB_URL\_\_"，让部分 bookmarklet 可用（Chrome 不允许 bookmarklet 中的 _document.location.href_）。从 vBookmarks 点击时会替换为当前活动标签页 URL。


**ver2.6 2013/10/21**

修复：移除双滚动条。


**ver2.5 2013/08/30**

修复：移除 HTML 通知（已不可用）。https://bugs.webkit.org/show_bug.cgi?id=98388


**ver2.4 2013/08/29**

修复：js 中 "Unexpected end of input"。


**ver2.3 2013/04/09**

修复：上下滚动时右键菜单未关闭（上一版回归）。

修复：滚动条位置记忆（上一版回归）。


**ver2.2 2013/04/02**

修复：Chrome 26+ 滚动条失效（测试不足）。


**ver2.1 2012/12/12**

修复：正确记忆并恢复滚动条位置。

改进：右键菜单位置；上下滚动时菜单会关闭。

新增：对话框取消按钮。


**ver2.0 2012/11/01**

修复：background.js 版本检查。

改进：可同步的分隔线。

新增：分隔线高级选项。


- 「作为分隔线显示的书签的真实标题」：默认为 "|"。即你在 vBookmarks 中添加的分隔线，在 Chrome 书签管理器或书签菜单中会以该标题显示为普通书签。可改为 "------------"，这样在 Chrome 书签菜单中也能起到分隔作用。


- 「作为分隔线显示的书签的真实 URL」：默认为 "http://separatethis.com/"。即"在线分隔线"。


- 「URL 包含此字符串的书签将显示为分隔线」：可设置多个 URL 以 ";" 连接，所有 URL 包含其中任一字符串的书签都会在 vBookmarks 中显示为分隔线。例如设为 google.com，所有 Google 服务都会显示为分隔线。


**ver1.9 2012/08/19**

修复：Neat Bookmarks 缺陷：打开弹窗并向下滚动后滚动条会回到顶部。

更新：图标颜色。

更新：分隔线样式。


**ver1.8 2012/08/01**

新增：书签/文件夹分隔线。本地记录，暂不支持多设备同步，见 https://github.com/windviki/vBookmarks/issues/3

修复：Neat Bookmarks 缺陷：滚动条向下滚动后拖拽书签位置错误（Chrome18 起）。

新增：图标颜色改为红色。

新增：简单的更新检查与桌面通知。

移除：部分语言，仅保留 4 个 locale：en, ja, zh, zh_TW。无力维护更多翻译。


**ver1.7 2012/06/26**

修复：Chrome 19 双滚动条。为之前未经测试的发布抱歉，我没有多个版本的 Chrome :)

修复：展开根文件夹时宽度重置。https://github.com/windviki/vBookmarks/issues/2


**ver1.6 2012/06/24**

修复：地址栏无法搜索书签（*+空格）。[内容安全策略]

修复：恢复弹窗宽度。[内容安全策略]

修复：对话框无法提交表单。[内容安全策略]


**ver1.5 2012/06/21**

修复：Chrome 20+ manifest 问题。

修复：独立脚本文件替代内联脚本，见内容安全策略 http://code.google.com/chrome/extensions/contentSecurityPolicy.html


**ver1.4 2012/06/20**

修复：Chrome 18、19 滚动条问题。https://github.com/windviki/vBookmarks/issues/2


**ver1.3 2012/05/25**

修复：滚动条故障。https://github.com/windviki/vBookmarks/issues/1


**ver1.2 2011/11/30**

新增：用当前 URL 更新选中书签。

新增：复制选中书签的标题和 URL 到剪贴板。

修复：向关闭的文件夹添加新书签或文件夹后，原有子项无法正确显示。

修复：补齐 cs（捷克语）缺失的翻译。


**ver1.1 2011/11/16**

新增：只显示书签栏书签的选项。

新增：在书签/文件夹前后添加文件夹的右键菜单。

修复：多语言支持中的部分翻译。


**ver1.0 2011/11/15**

首个版本。


# 注意事项

推荐从源码（"加载已解压的扩展程序"）或应用商店安装。旧版 crx 侧载说明：Chrome 20+ 请将 crx 拖入 `chrome://chrome/extensions/`；Chrome 22+ 需添加启动参数 `--enable-easy-off-store-extension-install` 以安装商店外扩展（见[说明](http://www.howtogeek.com/120743/how-to-install-extensions-from-outside-the-chrome-web-store/)）。

[Chrome 应用商店](https://chrome.google.com/webstore/detail/vbookmarks/odhjcodnoebmndcihdedenkmdmklpihb)是推荐的使用方式。
