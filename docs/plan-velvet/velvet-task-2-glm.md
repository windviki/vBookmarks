# velvet-task-2 · GLM 重审定稿（4.1.0 head 基线 · 融合暂存区版本）

> 基准：[`velvet-task-1-final.md`](velvet-task-1-final.md)（ds 基底 + k3/glm53 融合定稿，基于 4.0.5 前后状态）。**其引用的 velvet-task-1-ds/-k3/-glm53 设计源头不再翻阅**；task-2-k3 亦不引入。本文 = task-1-final 在 **4.1.0 HEAD**（实测：80 测试套件 / ~2664 用例；en 560 i18n 键；`manifest.json` 4.1.0；release 走 dist/ esbuild+terser 构建；七视图含 4.1.0 新增的 tab-groups）上的逐项重审 + 暂存区版本（[`velvet-feat-staging-glm.md`](velvet-feat-staging-glm.md)，下称「staging 文档」）的合流。
>
> **本文只做设计，不实施。** task-1-final 的设计体系（三平面、4px 网格、半径阶梯、Calm Instrument 语言、裁决表 F1–F14）经 4.1.0 复核**全部仍然成立**——4.1.0 的变更（tab-groups 视图、dist 构建、性能改造、favicon 画廊）没有推翻任何一条，反而补强了部分先例。本文的工作是：①逐项标注落地状态（§0.3）；②按 4.1.0 现状刷新全部触点与门禁；③把 staging 版本的新 UI 元素纳入视觉契约（§5）；④补一轮「丝滑温润」向的细节打磨清单（§6）。
>
> velvet 版本主题不变：**视觉成熟 + 细节跃升**——丝滑流畅、迅捷如飞、视觉温润柔和如同丝缎。staging 功能版先行落地（视觉沿用现行语言），velvet 随后以 CSS/token 层收敛全局面貌，DOM/类名不改。

## 0. 现状审计与决策框架

### 0.1 版本主题（承 task-1-final §0.1）

velvet = 「视觉成熟」版本。功能面收窄为：内置命令补全、输入栏实用扩展、独立大屏页（未落地部分）、暂存区视觉收敛（staging 已定义功能）。主力工程量投向视觉系统的体系化落地——task-1-final 的整套设计 token 在 4.1.0 head **一个都还没进**（`--vbm-canvas`/`--vbm-radius-*` 档位/`--vbm-space-*`/`--vbm-dur-*`/`--vbm-ease`/`--vbm-elev-*`/`--vbm-text-*`/`--vbm-slot-*` 全部零命中，`css/themes/` 目录不存在），因此 task-1-final §1 的视觉体系**原样有效**，本文只做基线刷新，不重开设计。

### 0.2 4.0.5 → 4.1.0 的基线变化（影响 velvet 的部分）

| 变化 | 对 velvet 的影响 |
|---|---|
| **tab-groups 第七视图**（view-tabgroups.js 2269 行 + tab-groups-sw.js + tab-group-utils.js） | tab 条从 6 tab 变 **7 tab**：分段软填充的宽度预算更紧（§1.5.2 复核）；选择模式先例从 2 套变 3 套（+staging 将是第 4 套）；`LIST_SEL`/`menuContainers` 等清单已扩容，行号全面漂移——task-1-final 附录 B 的行号作废，以本文附录为准 |
| **dist 构建**（esbuild+terser；`scripts/runtime-files.json` 为单一事实源；package.py 读 HTML_PAGES/CSS_FILES） | `css/themes/*.css` 六个新文件**必须登记 runtime-files.json 的 CSS 清单**才能进包——task-1-final 只说「package.py 改清单」，现机制是 runtime-files.json，触点更新 |
| **性能改造系列**（buildTreeSnapshot 单遍快照、lazy 索引、badge 同步去全量刷新、tooltip 惰性、dupes memo、dead overlay 定点更新） | velvet 的「迅捷如飞」有一半已被 4.1.0 兑现；velvet 视觉层不得引入回归（卡片化重绘路径要过 perf 既有断言） |
| **favicon 栈**（fallback/enrich/画廊页 pages/favicons.html） | velvet 图标系统（§1.8）与 favicon 栈解耦，零交集 |
| **AGENTS.md 分层**（19KB 主文档 + docs/agents/{modules,testing,release,i18n,quirks}.md） | velvet 落地时的文档同步落点改为 docs/agents/modules.md |
| **announce 层已上线**（src/announce.js + docs/announce.json + announceEnabled，store.js:96/:151） | task-1-final §4 整章**已实现**——velvet 只剩首发 tip 内容（§4） |
| **tab indicator clamp 修复**（4.0.8，3088de1） | 修的是「滑动底条圆角溢出 1px」——进一步佐证 F2 移除 `.tab-indicator` 的决策（修了还是会对不齐，删了才干净） |
| **dead blocked 琥珀标已实现**（view-dead.js:652/:726 + `.dead-indicator.blocked`，neat.css:4752） | task-1-final §1.9 的「× 场景着色 D1」**已实现**，从待办划除 |
| **tabular-nums 部分在用**（options.css:214/:715、neat.css:3543/:4331，共 4 处） | task-1-final §1.4 的全局纪律**部分实现**：剩 `.tab-badge`/`.row-badge`/`.history-meta`/`.history-time`/各计数扩展 |
| **store.js:67 已有 classic-experience 预设**（「一键恢复经典界面」功能集开关） | 与 classic 主题的正交关系（task-1-final §1.5.3）在代码里已有另一半——两开 = 完整 v3 体验的设计成立 |

### 0.3 task-1-final 逐项落地状态（4.1.0 HEAD 实测）

**✅ 已实现（从 velvet 待办划除，只余打磨）**
- D 公告层：`src/announce.js`、`docs/announce.json`、`announceEnabled` 设置、ETag/TTL/静态 JSON 决策（F4）全部上线。velvet 仅追加首发 tip 消息（§4）。
- D1 dead × 场景着色（blocked 琥珀标）：已实现，全链路（行 badge、li 橙旗、`.dead-indicator.blocked`）。
- `tabular-nums`：4 处在用，待按 §1.4 扩全。
- favicon 反色/补全/画廊（task-1-final 前置项 ①）：4.0.8 已全落地。
- palette 自定义命令框架、Tab 两停圈禁、`<mark>` 高亮等 4.0.5 回填项：均已在。

**🔶 部分实现（velvet 补完）**
- **`/theme`**：命令存在（palette.js:370-398 内建 17 条之一）但是**参数化前缀匹配**（`themeFromRest`，palette.js:35-38），非 F3 的列表模式——velvet 补 `/theme` 无参列表模式 + `themeClassic` + `/theme classic` 直选（§3.2）。
- **多词搜索**：仅 omnibox 高亮的 matcher 按词拆（search-core.js:70-75）；`fuzzy-core.js rank()`（:158-170）仍是整串打分——C2 多词 AND 分词**未做**；`src/search-tokens.js` 不存在，C1 **未做**。
- **图标系统**：icons.js 常量库成熟（FOLDER/DOCUMENT_CODE/DEFAULT_BOOKMARK/CHECK/STAR/FLAG/TRASH/PIN/EDIT/SLEEP/COLLAPSE/EXPAND/REDO/LIST_X/FLAG_X/SELECT/CHEVRON/VIEW_ICONS），但 A4 清单的 `CLOSE_ICON`/`EMPTY_ICON`/`OPEN_EXTERNAL_ICON` 缺；A3 折角现为直角 polyline（icons.js:39 `9.33,1.33→13.33,5.33`），圆弧化未做。
- **右缘动作槽**：`.row-btn` hover/focus 揭示体系已在（neat.css:3097-3102），但 V6 的 `--vbm-slot-action` 槽位契约与「视图内不变量」断言未做。

**❌ 未实现（velvet 主力）**
- 全部设计 token（§1.1–1.4）与 `css/themes/` 解耦（§1.11）；options.css 仍有 193 处 token 副本（含独立 `:root`/dark/auto/ink 四套）。
- 三平面 canvas（body 仍 `var(--vbm-bg)`，neat.css:164/:490/:2008/:2526 四处）。
- 卡片化（#view-tabs 仍裸 flex + border-bottom，neat.css:2236-2242）；`.tab-indicator` 仍在（CSS :2317 + view-manager.js:248/:334）。
- classic 主题（theme 合法值仅 auto/light/dark/ink/paper，options.html:52）。
- C1/C2/C3 全部（search-tokens、多词 rank、URL 直开、`/copy`）。
- B 系列新命令：`/open` `/open-all` `/sort` `/panel` `/popup` `/onlybar` `/all` 零命中；`paletteCustomsTop`/`paletteHideBuiltin`/`paletteBuiltinOrder` 设置键零命中。
- `pages/standalone.html` 不存在（E1）。
- 商店素材自动化（F）。

### 0.4 范围红黑榜（承 task-1-final §0.3，按 0.3 状态刷新）

**进 velvet**：视觉 V 全系（token/三平面/卡片化/tab 重绘/classic/主题材质/状态语言/图标/对齐/选项页/CSS 解耦）、staging 视觉收敛（§5）、B1/B2/B4/B5 + `/open-all`·`/sort`、C1/C2/C3、`/theme` 列表模式补完、E1 standalone、D 剩余（首发 tip + 发布流程增补）、F 商店素材、细节打磨清单（§6）。

**不进 velvet**：与 task-1-final §0.3 红榜完全一致（B3 macro、C4 中成本、E2 双栏、计算器、`/toggle`、`visited:N`、`#标签`、`/next-theme`、`chrome.theme` 跟随、弧形 tab 等），不再复述。

---

## 1. 视觉体系（V 系列 · task-1-final §1 全量有效，以下为 4.1.0 刷新点）

> task-1-final §1.0–§1.12 的设计（Calm Instrument 三原则、三平面、4px 网格与豁免清单、半径阶梯与同心律、排印两档、卡片化与焊接卡、tab 分段软填充、classic token 覆盖、五主题材质、状态语言表、图标纪律、左右缘槽位、`/theme` 列表、CSS 解耦目录结构）**逐条保留，本文不重述**。只列基线刷新与新增裁决：

### 1.1 七 tab 的分段软填充复核（F2 在 4.1.0 的重验）

- 4.1.0 的 tab 条已从 6 tab 变 7 tab（+tabgroups）。400px 弹窗下每 tab ≈55px（原 67px），2px 底条滑动的可感知性进一步下降——**移除 `.tab-indicator` 的论证更强了**。4.0.8 的 clamp 修复（3088de1）证明底条在圆角边界上持续产生对齐问题；删除后 view-manager.js 的 indicator 定位/滑动逻辑（:248/:334 一带）同步删除，`aria-selected` 语义不变。
- 分段软填充在 55px 宽度下仍然成立：12% accent 底 + accent 文字的对比不依赖宽度；badge 药丸（tab-groups/dead 等视图徽标）与填充并存时保持 `--vbm-danger` 现值（task-1-final §1.5.2 已论证对比充足）。
- **容器查询标签显隐机制照旧**（窄宽度下 tab 标签退化图标态）；7 tab 下的显隐断点随实施实测微调，不破契约。
- **staging 合流**：staging 落地后 `recent` tab 标题变「暂存区」且带 `badge()`（暂存条数）——badge 药丸 + active 填充的同现样式进 velvet 截图回归（§7.2）。

### 1.2 CSS 解耦与 dist 构建的合流（task-1-final §1.11 刷新）

- 目录结构与加载顺序不变（`css/themes/{light,dark,auto,ink,paper,classic}.css`）；**新增触点**：六个文件全部登记 `scripts/runtime-files.json` 的 CSS 清单（4.1.0 起 package.py:37-46 从该文件读 CSS_FILES，漏登记 = dist 包缺主题 = 线上白坏）；CI dist harness 的产物校验补「六主题文件在包内」断言。
- 搬移纪律不变：先加文件与 link、逐块搬移、每步全量 vitest + smoke、搬移期不改视觉值；解耦放视觉定稿后一次性做（S8）。
- options.css 的 193 处 token 副本与四套主题块随解耦一并收敛为引共享 token 源。

### 1.3 状态语言与 staging 新状态的合流

task-1-final §1.7 的状态 token 表扩展以下 staging 新状态（几何全主题统一、材质按主题）：

| 状态 | 载体 | light/dark | ink | paper |
|---|---|---|---|---|
| `.cut` 剪切淡化 | 树行 | `opacity` 减半 + 保留行内容 | 同左 | 同左 |
| `.staged` 已暂存 | recent 区上箭头按钮 | 实心/打勾态，只动 `opacity`/fill | 同左 | 同左 |
| 组头 hover/折叠 | staging 组头 | `--vbm-bg-hover` + `aria-expanded` 箭头旋转（transform，dur-1） | 同左 + 磷光叠底 | 暖灰 |
| 选择条双 rung | staging/搜索选择工具条 | 与 tabgroups 既有双 rung 同款卡片化（surface 底 + `--vbm-radius`） | 同左 | 同左 |

`.cut` 淡化在 velvet 落地时收口为 token（`--vbm-cut-dim` 或复用现有 muted 通道，实施时定），staging 文档 §5.2 的临时 opacity 写法随之替换。

### 1.4 排印纪律扩展（部分实现的收口）

`tabular-nums` 从现有 4 处扩至 task-1-final §1.4 全清单：`.tab-badge`（7 tab 徽标，数字抖动直接影响 tab 宽稳定）、`.row-badge`、`.history-meta`/`.history-time`、staging 组头条数 pill、`.select-count`、stats/dead/dupes 计数、扫描进度。一处全局规则（`body { font-variant-numeric: tabular-nums }` 不可取——正文非数字文本无益且字体回退风险；按选择器清单收口）+ `design-system.test.js` 断言清单完备。

---

## 2. 命令面板（B 系列 · 承 task-1-final §2，状态刷新）

全部条目设计不变（B1 `paletteCustomsTop`、B2 一开一序、B4 `/panel`·`/popup` toggle 语义 + `paletteAlreadyPopup`、B5 `/onlybar`·`/all` 会话级不改设置、`/open-all`·`/sort` 先行版、`/copy` 含 markdown、F5/F6/F7/F14 否决维持）。刷新点：

- 现有内建 17 条命令（palette.js:370-398）+ `/recent` 的 `staging` alias（staging 文档 §0.1）——velvet 的命令表增量在 17 条基础上排（`/open` `/open-all` `/sort` `/panel` `/popup` `/onlybar` `/all` `/copy`），全部走 palette-commands.js 注册三件套（命令表 + i18n + 测试）。
- `/open` 视图名清单按七视图（tree/search/tabgroups/recent(staging)/stats/dead/dupes）；staging 大屏是 E1 的主场景之一（§4）。
- B2 `paletteBuiltinUses` 计数挂 `fn` 执行路径——注意 `/recent` alias 命中也要计入同一命令的使用数。

## 3. 输入栏扩展（C 系列 · 承 task-1-final §3，未实现确认）

C1 六 token（site/folder/title/url/dead/blocked）、C2 多词 AND、C3 URL 直开 + `/copy`，设计不变。刷新点：

- C2 落点精确化：`fuzzy-core.js rank()`（:158-170）现整串 `scoreLower`——分词改造在该函数内做，**单词查询路径逐字节一致**的回归锁死（task-1-final §3.2）在 4.1.0 的 2664 用例基线上补 fuzzy-core/search/omnibox parity 三处。
- C1 的 `dead:`/`blocked:` 数据源 `deadLastScan` 在 4.1.0 已含 blocked 语义（D1 已实现），token 落地无额外数据工作。
- staging 合流：搜索视图选择模式（staging 文档 §3.6）是**功能版先行**的 C4 近亲（结果批量操作的最小集）；C4 其余（作用域搜索、参数化 `/add`）仍留 4.2。

## 4. 通知与独立页（D/E · 状态刷新）

- **D**：整章已实现。velvet 剩余：①首发 tip 消息（`kind:"tip"`，内容 = `/theme` 列表 + 新视觉引导，与 whats-new 合并一条，频率纪律照 task-1-final §4.4 写死）；②发布流程增补「更新 announce.json」进 docs/agents/release.md；③若 velvet 分多个 minor 发版，`minVersion`/`maxVersion` 区间相应分段。
- **E1 standalone**：未实现，设计不变（完整壳、隐捐赠卡+快加星、`?view=` 参数、1200px 居中、`--vbm-shell` 12px、palette `/open` 入口、三重数据视图工具行 `OPEN_EXTERNAL_ICON`、package.py HTML_PAGES 白名单）。刷新：①视图清单含 staging（`?view=recent` 即暂存区大屏——批量整理 500 条的上限场景，是 standalone 的高价值形态，`/open` 无参 = 当前视图大屏对 staging 同样可用）；②`scripts/runtime-files.json` 的 HTML_PAGES（非旧 package.py 硬编码）登记；③velvet 卡片化后的 standalone 布局 = 卡片在 1200px 画布上仍居中限宽（`max-width` 收敛卡片自身，不拉伸全宽——丝缎感来自约束而非铺满）。

## 5. 暂存区视觉契约（staging 合流 · 新增）

staging 功能版以 4.1.0 现行语言先行；velvet 落地时其新元素随全局 token 收敛，**DOM/类名不变**，契约如下（承接 task-1-final §1 体系）：

| 元素 | velvet 契约 |
|---|---|
| 双区域（`#staging-items` / `#recent-head` / `#recent-list`） | 同居一张视图卡（surface）；区域头 `#recent-head` = 卡内分区条：muted 标题 + 条数 pill + 动作钮，高度入 4px 网（28px），折叠箭头 transform 旋转 dur-1 |
| 组头（真实组） | 与 dupes/tabgroups 组头同款模板收敛为**唯一组头样式**（现状三视图组头已有细微分叉，velvet 一并统一）：折叠箭头 + 名称 + 条数 pill（tabular-nums）、hover 走 `--vbm-bg-hover`、选中三态（选择模式）走状态表 |
| 星标行（真实双态） | `.row-btn` 槽位恒可见星标，`aria-pressed` 随真实收藏态切换：已收藏 = 实心（quick-add `starred` 同源）/ 未收藏 = 空心 muted；星标色 = `--vbm-accent`（非语义色——收藏是主动作不是警示），切换只动 opacity/fill |
| 上箭头 `.staging-add-btn` / `.staged` | `.row-btn` 体系；`.staged` 实心态 fill 过渡 dur-1；无位移 |
| 选择工具条（staging 双 rung / 搜索单 rung） | 与 tabgroups 选择条同款卡片化工具条（surface + `--vbm-radius` + elev-1 若浮层化；嵌卡内则无阴影——层级靠表面）；图标全部 16px/1.5px 描边纪律 |
| `BookmarkFolderPickDialog` 三按钮形态 | 卡片化对话框（surface + `--vbm-radius` + elev-2）；文件夹缩进列表行高入网；[移动到此处]/[复制到此处] 主按钮 = accent 填充，取消 = ghost；顶部过滤输入（打磨项）与搜索框同款 |
| `.cut` 剪切态 | token 收口（§1.3），prefers-reduced-motion 下无闪烁 |
| 暂存空态 | 「16px muted 图标 + 一行 muted 文案」空态模板（A4）首个新应用 |
| badge 药丸 + active tab 填充同现 | 截图回归项（§1.1） |

## 6. 细节打磨清单（velvet「丝滑温润」跃升 · 新增）

在体系化之外，对**既有功能**的一轮精修（每条小、合起来是手感差）：

1. **对话框开合动效**：dialogs（含 folder-pick/new-folder/confirm）进出统一 dur-2 + `--vbm-ease` 的 opacity/scale(0.98→1) 组合（只 transform/opacity）；现状多为瞬切。`prefers-reduced-motion` 收口。
2. **右键菜单开合**：菜单 `positionMenu` 后淡入 dur-1； submenu flyout 滑出 4px + 淡入。不加位移编排到主菜单（工具不做秀）。
3. **toast 进出**：`undo` toast 当前直进直出——底部滑入 4px + 淡入 dur-2，栈叠时位移过渡。
4. **视图切换**：视图区内容切换 dur-1 淡入（不位移、不 crossfade 双帧——400px 弹窗里 crossfade 会闪）；`views.activate` 路径加一次性 class 后自动移除。
5. **行 hover 揭示的统一节奏**：`.row-btn` 的 hover/focus-within 揭示时长统一 dur-1（现状各处 0.1s/0.15s 混写）；焦点环随控件半径（`--vbm-radius-sm`）。
6. **滚动条材质**：thumb 色 token 化（`--vbm-scrollbar`，按主题），hover 态加深一档；卡片 `overflow:hidden` 裁切后 thumb 内缩关系过 verify-scrollbars 全矩阵。
7. **focus-visible 全覆盖复查**：4.1.0 新增元素（tab-groups 行、staging 元素、新命令的 palette 行）逐个过一遍键盘焦点环；`design-system.test.js` 加「交互元素必有 focus-visible 规则」的静态断言（按选择器清单）。
8. **数字抖动**：§1.4 tabular-nums 收口（badge/计数/相对时间）。
9. **空态统一**：A4 的「图标 + 一行 muted 文案」模板铺到全部空态（无结果/未扫描/无重复/空文件夹/暂存空/搜索历史空），一处 CSS 类（`.empty-hint`）收敛，文案 i18n 复用。
10. **quick-add 星与捐赠卡**：quick-add 星的按下反馈（scale 0.92 + dur-1）对齐 tab 分段填充的按压语言；捐赠卡卡面随三平面迁移（canvas 底 + surface 卡），不动内容。
11. **性能不回退门**：以上全部动效只 opacity/transform；`perf` 既有断言（badge 去全量刷新、lazy 索引、tooltip 惰性）在 velvet 分支全程跑绿；卡片化后首帧渲染路径加一次 harness 计时对照（预算：激活视图渲染耗时相对 4.1.0 基线劣化 ≤10%）。

## 7. 实施切片与回归门禁

### 7.1 切片顺序（在 task-1-final §7.1 基础上刷新；每片独立提交 + 全绿）

| Slice | 内容 | 依赖 | 状态标注 |
|---|---|---|---|
| S1 | token 铺底（§1.2–1.4 网格/半径/排印/动效/投影）+ `design-system.test.js` + tabular-nums 收口（§1.4） | 无 | 未实施 |
| S2 | 三平面 `--vbm-canvas` + body 迁移（neat.css 四处）+ dark 卡面色 | S1 | 未实施 |
| S3 | 卡片化 + tab 分段重绘 + **删除 `.tab-indicator`**（CSS + view-manager 逻辑）+ 七 tab 断点实测 | S1/S2 | 未实施 |
| S4 | 左右缘槽位系统（`--vbm-slot-*` + 右缘不变量断言） | S3 | 未实施 |
| S5 | classic 主题 + `/theme` 列表模式（补完 F3） | S3 | `/theme` 命令已在，列表模式未实施 |
| S6 | 状态语言按主题 token 表 + staging 新状态（§1.3） | S3（staging 功能版落地后含其状态） | 未实施 |
| S7 | 图标 A3 圆弧折角 + A4 清单（CLOSE/EMPTY/OPEN_EXTERNAL）+ 标记同现 + 空态统一（§6.9） | S3 | 未实施 |
| S8 | CSS 解耦 `css/themes/` + **runtime-files.json CSS 清单登记 + dist 产物断言** + options 单源化 | S5/S6/S7 定稿后 | 未实施 |
| S9 | B1/B2 + B4/B5 + `/open-all`·`/sort` + `/recent` alias | 无（可并行） | 未实施 |
| S10 | C1 search-tokens / C2 多词 rank / C3 URL 直开 + `/copy` | 无（可并行） | C2 仅 omnibox 高亮分词，其余未实施 |
| S11 | E1 standalone（含 `/open`、`?view=` 七视图、runtime-files HTML_PAGES） | 无（可并行） | 未实施 |
| S12 | D 剩余：velvet 首发 tip + release.md 流程增补 | 无 | announce 主体已上线 |
| S13 | §6 细节打磨清单 1–10 + perf 对照门（§6.11） | S3 起分批 | 未实施 |
| S14 | F shots-store.js 商店素材重拍 | S8（视觉终态） | 未实施 |
| S15 | staging 视觉收敛（§5 契约，若 staging 功能版先发则随 velvet 一片落地；若同期开发则并入 S3–S8 各片） | staging 功能版 | 视 staging 进度 |

### 7.2 回归门禁

- vitest 全量（基线 80 套件 / ~2664 例）+ 新增 `design-system`（token/网格/半径/tabular-nums/focus-visible 清单）、`search-tokens`、`row-alignment`；扩展 `theme`（六主题 token 完备性 + classic 覆盖 + 无裸半径残留）、`palette`（新命令 + `/theme` 列表 + alias）、`fuzzy`/`search-core`（多词 parity + 单词逐字节回归）、`popup`/`panel-behavior`。
- Docker：smoke 零 console 错误；verify-keyboard 全矩阵（tab 重绘不影响键盘模型；staging 双区域步行）；**verify-scrollbars 全矩阵（卡片化最关键的门）**；diag 视觉矩阵 + classic 态 + **staging 视图态**（badge+active 同现、组头折叠、选择双 rung）。
- dist：CI harness 断言六主题 CSS 与 standalone.html 在包内（S8/S11）。
- 截图：shots-themes 补 classic + 卡片对照 + 状态三态 + staging；shots-store 首产（1400×560 strip + 1280×800 promo，ink/paper 必现）。
- i18n：新增 key 走 `i18n.py` 全流程（基线 en 560 键）；`/open` 视图名复用 tab 键；净增约 24 key（task-1-final §7.3 清单有效，另加 staging alias 若需可复用零新键）。

### 7.3 风险与回退（承 task-1-final §7.4，刷新）

| 风险 | 缓解 |
|---|---|
| light canvas 灰底观感变化 | `#f6f7f9` 最浅可辨；classic + `/theme` 列表提供纯白出口 |
| 七 tab + 分段填充在 400px 拥挤 | S3 单独提交实测断点；必要时窄宽下填充内缩 2px（登记豁免） |
| 卡片化翻红 verify-scrollbars | S3 独立提交，翻红即回退该 slice |
| dist 漏登记主题文件（线上白坏） | runtime-files.json 登记 + CI 产物断言双保险 |
| 删 `.tab-indicator` 动摇 4.0.8 修复 | 该修复随删除一并消解（clamp 的对象不复存在）；verify-keyboard 证明键盘导航无感 |
| staging 与 velvet 并行的样式冲突 | staging 用现行类名，velvet 只动 token/CSS 层；S15 单独切片合并其契约 |

## 8. 附录 · 关键代码定位（4.1.0 HEAD 刷新 task-1-final 附录 B）

| 关注点 | 定位 |
|---|---|
| 主题应用 | popup.js（dataset.theme）；token 块 neat.css 头部（S8 迁 `css/themes/`）；store.js theme 合法值 + options.html:52 下拉加 classic |
| tab 条 / indicator | neat.css:2236-2242（裸条）、:2317（indicator）；view-manager.js:248/:334（indicator 逻辑，S3 删） |
| 三平面迁移点 | neat.css:164/:490/:2008/:2526（body 底色四处） |
| options token 副本 | css/options.css（193 处 `--vbm-*`、四套主题块）——S8 收敛 |
| 右缘揭示体系 | neat.css:3097-3102（`.row-btn` hover/focus）——S4 槽位化 |
| 选择模式先例 | view-dead / view-dupes / view-tabgroups:1205-1227（+staging 第 4 套） |
| 命令面板 | palette.js:370-398（17 内建）、:35-38（`/theme` 前缀式，S5 改列表）；palette-commands.js（注册三件套） |
| fuzzy 多词落点 | fuzzy-core.js:158-170（rank 分词）；omnibox parity search-core.js:70-75 |
| 构建清单 | scripts/runtime-files.json（CSS/HTML/入口，S8/S11 登记）；package.py:37-46 消费 |
| announce（已上线） | src/announce.js、docs/announce.json、store.js:96/:151 |
| staging（功能版） | 见 velvet-feat-staging-glm.md §8 触点清单 |
| 文档同步落点 | AGENTS.md + docs/agents/{modules,testing,release}.md |
| 测试基线 | 80 套件 / ~2664 例；harness：verify-keyboard / verify-scrollbars / diag 系列（run.sh Docker 门禁） |

---

*本文为 [`velvet-task-1-final.md`](velvet-task-1-final.md) 在 4.1.0 HEAD 的重审定稿：§0.3 逐项标注已实现/部分/未实现，§1–§4 刷新触点与基线，§5 合入暂存区视觉契约（[`velvet-feat-staging-glm.md`](velvet-feat-staging-glm.md)），§6 新增细节打磨清单，§7 切片与门禁按 dist 构建与七视图现状更新。task-1-final 的设计体系与 F1–F14 裁决全部维持。*
