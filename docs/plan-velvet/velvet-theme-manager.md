# 主题管理器与用户主题体系（velvet-theme-manager）

> **触发**：2026-08-30 用户 Andrew（Neonlinx）邮件投稿 Dracula 主题
> （1653 行自定义 CSS，`Dracula_vBookmarks_Theme_v4.1.3_Refined.css`，紧贴 4.1.x 迭代）。
> 维护者已回复承诺集成，并告知：集成后随版本演变、4.2.0（velvet）是视觉重构版、
> 暂不做用户投票主题服务、仅保证该主题永不付费。
> **性质**：纯分析 + 方案，不含代码。**关系**：本文是 velvet-task-2-k3 的姊妹篇——
> 任务书管「内置视觉怎么变」，本文管「主题作为一件事怎么被集成、被用户创建、被跨版本维持」。
> 依赖关系：正式整合与主题管理器都以 k3 的 **S1（token 铺底）与 S8（css/themes/ 解耦）** 为前置。

---

## 0. 结论速览

| 问题 | 结论 |
|---|---|
| 整合 Dracula 为独立内置主题，对扩展有破坏性改动吗？ | **用户可见层面：无**（opt-in 新主题，不动任何默认视觉）。工程层面有 7 个硬触点（§3.1），其中最重的是三份 token 副本同步与 43 locale 文案。 |
| 对主题本身（作者期望）有破坏性吗？ | **有，且不可避免**：原文件是「!important 覆盖战争」形态，进内置必须重写为 token 表达；几何/霓虹装饰/字体三块无法原样保留（§3.3 忠实度翻译表）。这正是邮件里预告的「随版本更新进行更改、可能不能满足您的期望」。 |
| 一个反直觉事实 | 主题的 Exo 2 字体 `@import` **从未在扩展里生效过**——CSP `style-src 'self'` 拦截远程样式表（`src/userstyle.js:14-21` 专门检测并警告这个模式）。作者和用户一直看到的是 Segoe UI 回退。因此内置版去掉 `@import` 是**零视觉回归**（§1.3）。 |
| 现在就能做的集成 | 路径 A：把 Dracula 作为 custom-css 工作台的**内置预设**分发（4.1.x 可落地，零主题体系改动，§2）。 |
| 正式整合的时机 | 路径 B：velvet **S8（themes/ 解耦）之后**作为第 7 个内置主题落地。之前落 B 会立即被 velvet 视觉重构重写一遍，双倍迁移成本（§3.5）。 |
| 未来用户主题体系 | **两层契约**：token 层（结构化、可校验、跨版本可降级 = 稳定 API）+ advanced CSS 层（自由覆盖、明示尽力而为）。**文件导入/导出是唯一的分发机制**（不做服务、不做远程拉取为默认）——存储走 local（sync 单项 8KB 配额装不下 30KB CSS），可移植性天然依赖导入导出（§4）。 |
| 组件/布局标准化怎么支持用户主题 | 把「主题可依赖的选择器清单 + token 词表」升格为**有契约测试看守的公共 API**（§4.7），几何与皮肤分离（§4.8）。Dracula 文件本身就是最好的缺口清单——他被迫 `!important` 的每一处，都是 token 词表欠的债（附录 B）。 |

---

## 1. 样本解剖：一份真实用户主题教会我们什么

分析对象：`https://github.com/Neonlinx/Stylesheets/blob/master/Apps/NeaterBookmarks/Dracula_vBookmarks_Theme_v4.1.3_Refined.css`（1653 行，**407 处 `!important`**，平均每 4 行一处）。这是目前唯一一份持续跟进 v4/v4.1 全部 UI 增量的第三方主题，作为「用户主题要活下来需要什么」的实证样本，价值高于任何臆测。

### 1.1 地层结构（一份文件的考古学）

文件不是设计出来的，是**逐版本打补丁堆出来的**，六个地层清晰可辨：

| 地层 | 行区间 | 内容 | 对应时代 |
|---|---|---|---|
| ① Neat 老选择器层 | L1-341 | 自有变量（`--bg-main`/`--text-folder`/`--tree-indent` 等 24 个）+ `#tree ul li a`、`menu[type=context]`、滚动条伪元素 | Neat Bookmarks 遗产 |
| ② v4 token 初拥 | L343-373 | 第一个 `--vbm-*` 块（12+ token） | v4.0 token 体系上线 |
| ③ v4 面铺开 | L375-1158 | `.vbm-row`/`.view-tab`/palette/dialog/toast + 五列表视图（recent/stats/dead/dupes）行全套；霓虹 hover/选中态、呼吸动画、reduced-motion | v4.0-4.1 视图系统 |
| ④ **"4.1.x compatibility layer"** | L1159-1200 | `:root, body[data-theme]` 强推 `--vbm-*`——作者自己在注释里写明策略：「与原生主题选择器特异性相等、靠后加载取胜」 | 4.1 主题属性化 |
| ⑤ 4.1 面补齐 | L1202-1543 | `#staging-list`/`#tabgroups-list`/六个工具栏/`.vbm-dropdown-list`/子菜单/选择器对话框/公告横幅/`count-pill`/语义徽章 | 4.1.x 功能视图 |
| ⑥ 版本补丁地层 | L1544-1653 | 明确标注 v4.1.1/v4.1.2/v4.1.3 的三段增量（staging 下划线避让动作列、current 徽章降饱和、行几何统一、去链接下划线） | 逐版本追更 |

**两个直接推论**：

1. **作者的行为模式就是「跟随版本打补丁」**——地层⑥证明只要版本说明里写清「主题受影响变更」，第三方作者是愿意并且能够追更的。这直接支撑 §4.7 的 changelog 纪律设计。
2. **地层④是整份文件的生存策略核心**：不跟 `body[data-theme="dark"]` 五个值逐一对抗，而是用 `:root, body[data-theme]` 一次性把 token 钉死。这等于第三方自己发明了「主题 = token 覆盖」的雏形——我们要做的主题管理器，本质是把这个民间机制收编为正式 API。

### 1.2 级联策略：为什么需要 407 个 `!important`

userstyle 的注入位是 `<body>` 末尾的 `<style>`（`src/userstyle.js:23-37`，`src/neat.js:1087` 调用），文档顺序在 `<head>` 样式表之后——**同特异性下靠源顺序取胜**。`!important` 是为对付更高特异性的内置规则（如 `body[data-theme="dark"].highlight-unsynced #tree li.unsynced-subtree > a` 这类 (0,3,1) 复合链）。这场军备竞赛的根因：**内置主题的 token 词表太薄，表达不了他想改的东西**，只能退回选择器级覆盖。词表缺口清单见附录 B——那是这份文件给我们的最贵重的馈赠。

### 1.3 字体事实：Exo 2 从未生效

L20 `@import url('https://fonts.googleapis.com/css2?family=Exo+2...')`。扩展 CSP（`manifest.json:95`）为 `style-src 'self' 'unsafe-inline'`——注入的内联 `<style>` 本体合法，但其内部 `@import` 的远程样式表子资源被 `style-src` 拦截。`src/userstyle.js:14-21` 专门写了这个检测并在控制台警告（注释原文举例就是「a Google Fonts URL from a shared theme」）。同理 `font-src` 回落到 `default-src 'self'`，`data:` 字体也被拦——**扩展内可用的字体只有随包本地文件**。

结论：主题的「Exo 2 排印」实际从未呈现，用户看到的一直是回退栈 `"Segoe UI", sans-serif`。任何整合方案去掉 `@import` 都不构成视觉回归；若真要字体，只有随包捆绑 woff2 一条路（§3.4 成本核算：不建议）。

### 1.4 选择器存活审计（对照 4.1.1 HEAD）

主题引用的选择器/变量在当前 `css/neat.css` 的存活情况（完整表见附录 A）：

- **全部存活**：`.twisty`(25 处)、`#staging-list`(77)、`#tabgroups-list`(140)、六工具栏(39)、`.vbm-dropdown-list`(15)、`.count-pill`(17)、`.row-badge`(18)、`#whats-new`/`.announce-banner`(各 10)、`.risk-banner`(14)、`#bookmark-clone`(7)/`#drop-overlay`(5)、`b.tabgroups-window-current`/`li.tabgroups-current`、`--staging-line`(4)、picker 对话框四件套、palette 全家、`mark` 高亮……**零死引用**。这份审计同时反证：v4 以来的类名纪律（`vbm-*` 前缀、视图容器 id 稳定）已经事实上具备「公共 API」的成色。
- **已发生漂移的裂缝（作者还没追上）**：2026-08-27 重画的层级连接线体系（`--stg-trunk-x`/`--stg-tick-w`/`--tg-line-x`，design-laws §7）主题并不认识——Dracula 下树/暂存/标签组的连接线仍走内置颜色。这是「选择性 API 漂移」的活例：**没有契约清单，作者只能靠肉眼发现漂移**。
- **velvet 已预告的死区**：k3 S3 将删除 `.tab-indicator`（k3 附录 B：`neat.css:2317-2325`）——主题 L535-542 对它的霓虹渐变改造届时整段失效。S5 的 classic、S1 的卡片化/状态语言同理都会制造一批。**先落 B 再落 velvet = 立即重写一遍**，这是 §3.5 时序建议的依据。

### 1.5 与几何体系的冲突点（忠实度损失的重灾区）

v4.1 的行几何不是自由参数，是**校准过的槽位网格**（design-laws §1 右缘 8px 轴、§2 20px 盒/24px 步距、§7 三层槽位 `[chevron 16][图标井 20/22][标题轴 48/50]`）：

- 树缩进 = 行内 `-webkit-padding-start = TREE_INDENT(24) × level`（`src/tree-render.js:59-66`，generateHTML/actions/dnd 三处共享），树是嵌套 `ul[data-level]`（`tree-render.js:810/528`）但 **CSS 侧没有任何 `#tree ul ul` 缩进规则**。主题的 `#tree ul ul { margin/padding-left: 11px !important }` 因此是**叠加量**：每级在 24px 行内缩进之外再加约 22px 容器缩进 + 每级一条 border-left 导轨。视觉上成立（用户说效果不错），但它把「子行图标左缘 == 父标题左缘」的槽位法则、`--stg-trunk-x` 连接线锚点、右缘动作槽全部推歪——**这正是 token 层翻译不回去的部分**（§3.3）。
- 主题自有几何变量（`--item-padding-y/x`、`--item-margin-*`、`--ui-font-size`、`--tree-indent*`）本质是 **density 旋钮**——它们不属于「皮肤」，属于本方案里应该独立成正交设置的密度层（§4.8）。

---

## 2. 路径 A（现在就能落）：userstyles 预设

4.1.1 的自定义样式工作台（`pages/custom-css.html` + `src/custom-css.js`）已经是「多样式 + 级联即冲突解决」的模型：`userstyles`（local，JSON 数组 `{id,name,desc,css,enabled}`）为唯一事实源，启用项按列表顺序拼接物化进旧 `userstyle` 键（`custom-css.js:23-68`）。把 Dracula 作为**内置预设**分发：

- 形态：custom-css 页加「示例样式 / 预设」入口（或一个「导入 Dracula」按钮），把随包的一份精简版 CSS 灌成一个新 tab（`newStyleId()` + `parseStyles` 现成）。i18n 约 3-4 键。
- **能得到的**：零主题体系改动；级联可叠加（用户可再叠自己的微调 patch——工作台的设计初衷）；每设备独立启停；随 4.1.x 立即兑现邮件里「集成进 vbm」的承诺。
- **得不到的（要向作者/用户说清的边界）**：不进 `/theme` 列表与选项页主题下拉（不是「主题」，是「样式」）；favicon 反色照常生效（`themeIsDark` 解析 `--vbm-bg` 亮度，`src/neat.js:94-103`，Dracula 的 compat 层设了 `--vbm-bg: #282A36`，白拿）但 `color-scheme` 等表单控件基色不受 `data-theme` 管；velvet 落地后预设里的选择器规则同样会烂（advanced 层的天性）。
- 体积：预设 CSS 随包 ≈42KB 源码 / dist 压缩后约 7-9KB，`runtime-files.json` +1 文件（预算 81→82，`scripts/build.mjs:133`）。可先只收录地层④⑤⑥（token + 4.1 面），Neat 老地层①②③对当前 UI 大半冗余。

**定位**：过渡通道 + 主题管理器 advanced 层的先行试炼。作者原文件继续在他仓库里以 userstyle 形态生存，两不相扰。

---

## 3. 路径 B（正式整合）：第 7 个内置主题 `data-theme="dracula"`

### 3.1 触点清单（工程成本的全部）

| # | 触点 | 内容 |
|---|---|---|
| 1 | 主题文件 | `css/themes/dracula.css`（依赖 S8 的 themes/ 目录与加载序：neat.css → light/dark/auto → ink/paper/classic → dracula）。形态 = token 块 + 材质层，样板即 k3 §1.5.3 classic（token 为主 + 三条组件级覆盖）。**407 个 `!important` 全部消失**——`body[data-theme="dracula"]` 属性作用域 + link 顺序天然取胜，这是 B 相对 userstyle 形态的干净红利 |
| 2 | token 副本 ×3 | `options.css:1` 与 `favicons.css:1` 的「keep in sync」副本块需同步（S8 单源化后此触点消失——又一个「等 S8」的理由） |
| 3 | 主题注册 | `palette.js:287` THEMES 数组 + 直选命令；`pages/options.html:50` 下拉加项；`popup.js:10` 无白名单无需改（k3 附录 B 已确认）；auto 映射排除（同 ink/paper/classic 裁决） |
| 4 | i18n | `themeDracula` 等 1-2 键 × 43 locale，走 `scripts/i18n.py` 全流程（audit/missing/verify 三门禁） |
| 5 | 测试契约 | `tests/theme.test.js`：12 核心 token 完备性 `it.each` 扩项、主题标签 en/zh_CN 契约、favicon 亮度规则矩阵加 dracula 态；k3 §7.2 的 `design-system`/`scrollbar-contract` 相应扩 |
| 6 | 构建与预算 | `scripts/runtime-files.json` +1 CSS；build 自检；三段冒烟；`assets/store/` 商店条带 `STRIP_THEMES` +1（k3 §6.3 已预留「classic 落地后加一项即可」的同款操作） |
| 7 | favicon 反色 | **零改动**——`themeIsDark()` 按 `--vbm-bg` 亮度判定（`neat.js:94-103`），token 正确即自动生效。注意实现只认 `#rrggbb` 十六进制：dracula.css 的 token 必须用 hex 写 `--vbm-bg`，不能写 rgba |

### 3.2 破坏性改动清单（分三个层面回答）

**① 对存量用户/扩展行为：无破坏性。** 新主题纯 opt-in；默认视觉、五主题行为、userstyle 级联（自定义 CSS 仍排最后）全部不变。唯一的波及是测试/构建/文案的维护面（上表）。

**② 对主题作者（Andrew）的期望：有破坏性，需再次明示。** 他的文件进内置不是「收录」而是「重写」：

- 原 1653 行覆盖式 CSS → 约 100-200 行 token 块 + 材质层。他仓库里的原文件仍是「全量重皮版」，与内置版**从此分叉**——内置版由我们随版本维护，他的版本继续他自己的追更节奏。
- 忠实度三块损失（下节详表）：几何（叠加缩进/导轨线/行距微调）、霓虹装饰（辉光/呼吸/下划线光条，除非 velvet 材质 token 接得住）、字体（`@import` 必须去掉——好在从未生效）。
- **这条早已写进给他的回信**（「会随版本更新演变、可能仍需你自己叠 CSS 微调」），与本节互为印证：路径 A 保留他的原文件形态，恰是给他的「不满内置版时自己上」的出口。

**③ 对开发者流程：增量维护成本，非破坏。** 上表 7 项；其中 2/6 两项在 S8 落地后自然消解。

### 3.3 忠实度翻译表（逐特性裁决）

主题的视觉主张 → 在「现有 token / velvet S1 token / 需新增机制 / 建议放弃」四档里的归宿：

| Dracula 特性 | 归宿 | 说明 |
|---|---|---|
| Dracula 配色全套（bg/panel/text/folder/accent 三色） | **现有 token 直接表达** | `--vbm-bg`/`--vbm-bg-elev`/`--vbm-fg`/`--vbm-muted`/`--vbm-accent`…12 核心 token 全覆盖；folder 紫粉文字可走材质层一条组件规则 |
| `color-scheme: dark` + 暗 `--vbm-scrollbar` | **现有 token** | 主题块内两行 |
| danger `#FF5555` / warning `#F1FA8C` / success `#50FA7B` | **现有 token** | 语义色纪律不破（k3 §1.7：语义色只做语义——Dracula 恰好也是这么用的） |
| 搜索框/工具钮/菜单/palette/dialog/toast 的底色描边 | **现有 + velvet token** | `--vbm-canvas`(k3 §1.1)/`--vbm-bg-elev`/`--vbm-border`/`--vbm-radius` 阶梯 |
| 行 hover 底色/accent 边 | **velvet §1.7 状态语言** | hover 材质进 `css/themes/dracula.css` 状态表 |
| 选中态**渐变**背景 | **需约定 token 值类型** | `var(--vbm-bg-selected)` 现有 17 处走 `background:`、10 处走 `background-color:`（后者装不下渐变值，会整条弃用）——velvet S1 应统一改为 `background:`，token 值类型即升格为「任意 background 值」。**这是 velvet 侧一行级改动就能解锁的能力** |
| 霓虹辉光（hover/选中/focus 多层 box-shadow + text-shadow） | **velvet §1.6.2 机制的同族** | ink 的磷光晕已开了「主题专属 glow」先例；建议 S1 增 `--vbm-glow-hover`/`--vbm-glow-focus`（值 = shadow 列表或 `none`，默认 none），Dracula 与 ink 共用机制、强度各异 |
| 选中行呼吸动画 | **需新 token** | `--vbm-row-focus-animation`（默认 none）；**强制要求**主题遵守 prefers-reduced-motion（Dracula 原文两处 reduced-motion 块证明作者有这个意识，值得写进作者指南） |
| hover 青色下划线光条（::after 装饰线） | **需新 token** | `--vbm-row-hover-rule: none\|<color>`；它同时是 paper「朱砂左竖条」的同族槽位——k3 §1.7 状态表可一并收编 |
| 滚动条渐变 thumb | **半表达** | `--vbm-scrollbar` 是颜色；允许完整 background 值即表达。注意 scrollbar 门禁（`verify-scrollbars.js`）矩阵要加 dracula 态 |
| Exo 2 字体 | **放弃 @import（零回归，§1.3）**；捆绑 woff2 见 §3.4 | 排印 token（`--vbm-font-ui`）建议仅在主题管理器阶段引入（§4.7），内置 dracula 首版沿用 `font: menu` |
| 行几何（padding 4/9、margin 2/4、letter-spacing、行高 1.35） | **放弃/移交 density 层** | 槽位网格与右缘轴是校准几何（design-laws §1/§2/§7），内置主题不破格；密度诉求进 §4.8 的正交设置 |
| 树导轨线（ul ul border-left + ::before tick） | **放弃** | 与 2026-08-27 连接线体系（trunk/tick）冲突；连接线颜色改由材质层给 `--stg-*`/`--staging-line`/`--tg-line-x` 相关 token 上色，形状不 owned by 主题 |
| 深浅双梯度面板底（`linear-gradient(180deg, panel-top, panel-bottom)`） | **velvet 后视情况** | k3 §1.1 三平面是平面色世界观（paper 渐变被否决过）；若 `--vbm-canvas` 值类型放开为任意 background 则可表达——**建议 velvet 维持平面裁决，Dracula 内置版接受纯色 canvas**，梯度面板留给他的 userstyle 原版 |

**AA 初核**：选中态 `#F8F8F2` 文字对渐变底（rgba(139,233,253,.34) 叠 `#282A36` ≈ `#4A6A85`）对比约 4.9:1，压线过 AA，且原设计自带 text-shadow 辉光增益；`theme.test.js` 若引入对比断言（k3 §1.7 已有此意）以实测为准，不行则微调选中底浓度。

### 3.4 字体与体积决策

- **不随包捆绑 Exo 2**：拉丁子集 woff2 单字重约 15-20KB，主题用到 400/500/600 三档 ≈ 50KB+，且 zip 预算按文件数管控（现 81，`build.mjs:133`），为一个从未生效过的字体付出这个体积不值。`font-family` 回退栈里的 "Exo 2" 可以保留在材质层——**用户本机装了 Dracula 字体就自动点亮**，没装维持 Segoe UI，与现状完全一致。
- 若未来主题管理器阶段确有字体需求（§4.6），规则定为：仅 `assets/fonts/` 随包本地文件 + `@font-face`，作者指南写明 CSP 约束。

### 3.5 时序建议

1. **现在（4.1.x）**：路径 A 预设落地——兑现邮件承诺的最小可行集成。
2. **velvet S1-S8 期间**：把 §3.3 里「需新 token」的四项（glow/rule/animation/selected 值类型）按 k3 的切片流程带进 S1/S6 设计（它们同时服务 ink/paper 材质，不是 Dracula 专属）。
3. **S8 之后**：dracula.css 作为第 7 主题落地（k3 的 S5 classic 先行验证同一条流水线）；商店条带补拍。
4. 作者原文件 = 永久的高级形态，双方链接互认（README/作者指南提及）。

---

## 4. 未来：用户主题体系（theme manager）

目标一句话：**让「Dracula 式追更」从英雄行为变成普通用户可完成的操作**——导入一份主题文件，选上，升级扩展后 token 层自动跟随、烂掉的只有明示风险的装饰层。

### 4.1 设计目标与明确不做的事

做：本地导入/导出、结构化 token 层 + 自由 CSS 层、导入校验、版本兼容提示、/theme 与选项页一等公民呈现。
不做（与邮件决策对齐，写进方案防翻案）：

- **不做用户投票/中心化主题服务**——免费项目无运营预算，且商店审核面不扩。
- **不做远程主题自动拉取/自动更新**——announce 的 raw.githubusercontent + 镜像机制（`src/github-source.js`/`github-mirrors.js`，CSP `connect-src *` 已允许）技术上可行，作为 phase-3 可选项默认关闭；CSS 的 `url()` 信标面已被 CSP（img-src/style-src 'self'）基本封死，但「扩展定期联网拉样式」的隐私预期成本大于收益。
- **不做主题签名/商店化**——用户主题是本地用户内容，与今日 userstyle 同一法律与审核地位。

### 4.2 主题模型：manifest + 两层契约

一个主题 = 单文件 JSON（`.vbmtheme.json`，建议 256KB 上限）：

```
{
  "format": 1,                 // 包格式版本（我们侧的解析契约）
  "apiVersion": "4.2",         // 目标 token 词表版本（兼容警告用）
  "id": "dracula-neonlinx",    // [a-z0-9-]，选择器引用前缀
  "name": "Dracula", "author": "Neonlinx", "version": "1.0.0",
  "colorScheme": "dark",       // dark|light —— 驱动 color-scheme 与文档说明
  "tokens": { "--vbm-bg": "#282A36", "--vbm-accent": "#8BE9FD", ... },
  "advancedCss": "/* 可选：装饰/组件级覆盖，明示尽力而为 */"
}
```

**两层契约是整个体系的承重墙**：

| 层 | 内容 | 稳定性承诺 | 升级行为 |
|---|---|---|---|
| token 层 | 结构化 `--vbm-*` 覆盖（白名单内才生效） | **稳定 API**：语义不变，minor 版本只增不改；破坏性变更仅 major，且旧 token 保留一版弃用期 | 新版本新增 token → 用户主题没给 → **自动落到内置默认值**（优雅降级，天然免疫 velvet 式视觉重构的重写成本——这是结构化层相对裸 CSS 的决定性优势） |
| advanced 层 | 自由 CSS | **尽力而为**：无承诺，选择器漂移自担 | 导入时与设置页常驻提示；`targetVersion` < 当前主版本时横幅提醒「可能过时」 |

Dracula 的地层④（token 强推）与地层③⑤⑥（选择器覆盖）恰好就是这两层的民间原型——设计只是把作者的直觉制度化。

### 4.3 导入 / 导出

- **导出**：选项页主题管理区 → 导出按钮 → Blob `<a download>` 生成 `.vbmtheme.json`（纯前端，无新权限）。
- **导入**：文件选择 + 拖放；另设「从 CSS 导入」通道——检测到裸 CSS（GitHub 上分享的 Dracula 原文件这类）时，向导询问 colorScheme，生成 `advancedCss` 主题 + 按 colorScheme 预填最小 token 集（dark 的 `--vbm-bg/-fg/-canvas` 等），**不做任何自动魔法解析**（把 1653 行 CSS 猜成 token 的幻觉工程不做）。
- **分发 = 文件本身**：用户之间传文件、挂 GitHub、论坛贴链接，都行。作者指南给出从 userstyle 升格为 token 主题的路径（附录 B 的缺口表就是教材）。

### 4.4 存储与同步

- 主题内容存 `themes`（local，JSON 数组，模型对齐 `userstyles` 的 `{id,name,…}` + parse/normalize 纯函数——`custom-css.js` 的四件套模式直接复用）。
- **为什么不走 sync**：chrome.storage.sync 单项 8KB 配额，30KB+ 的 CSS 必然爆；与 `customIcon`/`userstyles` 留 local 的既有裁决一致（AGENTS.md 存储分段）。
- 选中态沿用现有 `theme` 键（sync，`store.js:193`），值扩展为 `custom:<id>`。**跨设备失配**：设备 B 无该主题内容 → 解析失败回退 light + 一次性 toast 指引（「此主题未在本机导入」）。可移植性由导出/导入承担——这就是导入导出不是锦上添花而是硬需求的原因。
- 级联位置（加载序）：`neat.css` → `themes/*.css`（内置）→ **自定义主题 token `<style>`** → **自定义主题 advanced `<style>`** → **userstyle `<style>`**（现状最后位不变）。自定义主题排在 userstyle 之前，保证「用户自己的 CSS 永远能再盖主题一层」——对「更好地 CSS 覆盖」诉求的直接回答。

### 4.5 呈现与切换

- `/theme` 列表模式（k3 §1.12）尾部加自定义段（行尾「自定义」小徽）；`/theme <名>` 前缀直选对 custom 同样生效。
- 选项页主题下拉加「管理主题…」跳管理区（主题卡片：启停/导出/删除/查看详情）。
- custom 主题永不参与 auto 映射（沿用 ink/paper/classic 裁决）。

### 4.6 导入校验（`src/theme-pkg.js`，操作即模块，纯函数可测）

| 校验 | 规则 | 定级 |
|---|---|---|
| 格式 | format 字段、id 字符集、尺寸上限 256KB、JSON 可解析 | 阻断 |
| token 白名单 | 只认已知 `--vbm-*` 词表；未知键忽略 | 警告 |
| colorScheme | 枚举 dark/light；缺失阻断（favicon 反色与控件基色依赖它） | 阻断 |
| `--vbm-bg` 值形 | 建议十六进制（`themeIsDark` 只认 hex，`neat.js:98`） | 警告 |
| 远程引用 | `@import`/`url(https?:` 检测 → CSP 教育（复用 `userstyle.js:21` 的正则思路） | 警告 |
| 对比度预检 | 核心前景/背景对 AA 数学校验（`needsContrast` 同源的纯数学） | 非阻断报告 |
| 版本 | `apiVersion`/`targetVersion` 落后当前主版本 → 详情页横幅 | 提示 |

### 4.7 组件与布局标准化：把「事实稳定」升格为「契约稳定」

§1.4 的存活审计证明类名事实上已稳定；主题体系要求把它变成**有测试看守的承诺**：

1. **稳定选择器清单**（theme-compat 清单）：主题可依赖的结构词汇表——`vbm-row`/`view-tab`/`menu-item`/`palette-row`/`dialog`/`row-btn`/`count-pill`/各视图容器 id/头簇类…。新增 `tests/theme-compat.test.js` 断言清单内每个选择器在 neat.css 存在：**重构想改名，先过这道测试，等于逼着改动走「新增别名 + 弃用期」流程**。
2. **token 词表分档**（写进作者指南 docs/theme-guide.md，phase 2 交付物）：
   - Tier 1 颜色/材质 token：语义契约，minor 只增不改；
   - Tier 2 几何 token（radius/space/slot/density）：仅 major 可动；
   - advanced CSS：无承诺。
3. **changelog 纪律**：发布说明固定一节「主题受影响变更」（token 增删、清单选择器变更、状态语言改动）。地层⑥证明作者会来读。
4. **作者指南**内容清单：token 表（含值类型约定，如 `--vbm-bg-selected` 为任意 background 值）、稳定选择器清单、几何不侵犯区（右缘 8px 轴/三层槽位/动作槽——引用 design-laws 的对外版）、CSP 字体规则、reduced-motion 强制、AA 目标、density 不可用说明（引导到正交设置）。

### 4.8 几何与皮肤分离：density 作为正交维度

Dracula 的 `--item-padding-*`/`--ui-font-size` 变量揭示的普遍诉求：**用户想调密度，不该被迫改主题**。主题管理器阶段把 density（紧凑/默认/舒张，作用于 `--vbm-row-h`/行 padding 档位）做成独立设置：

- 主题 = 颜色/材质/装饰；密度 = 全局几何档位（仍守槽位网格，只动行高与字距档）。
- 这同时是「组件布局更标准化」的推力：几何参数全部收进档位 token 后，主题作者根本没有破坏几何的入口——**不可破坏比承诺不破坏可靠**。

### 4.9 与 velvet 切片的排期关系

| 阶段 | 内容 | 依赖 |
|---|---|---|
| P0（4.1.x） | §2 路径 A 预设 | 无 |
| P1（velvet 内） | §3.3 四个新 token（glow/rule/animation/selected 值类型）随 S1/S6 设计带入；S8 themes/ 落地 | k3 S1-S8 |
| P2（velvet 后功能版本） | dracula.css 第 7 内置主题（§3 全案） | S5（classic 验证流水线）+ S8 |
| P3（P2 之后） | theme manager：theme-pkg.js + 导入导出 UI + themes 存储 + 校验 + theme-compat 契约测试 + 作者指南 + density 正交设置 | P2（token 词表终态） |
| P4（需求门控） | URL 导入（announce 镜像机制复用，默认关）、精选投稿转内置（维护者手工 token 化——即 Dracula 模式复用） | 社区需求 |

---

## 5. 风险与回退

| 风险 | 缓解 |
|---|---|
| velvet 视觉重构击穿存量 userstyle（Dracula 原文件在内），用户归罪扩展 | 发布说明「主题受影响变更」节 + custom-css 页内置「4.2 适配提示」横幅；advanced 层本质如此，文档明示 |
| 自定义主题 token 缺失导致半残视觉 | 词表白名单 + 未给 token 落内置默认（§4.2 降级语义）；导入校验报告缺哪些核心 token |
| sync 选中 `custom:<id>` 在无内容设备回退 light 造成困惑 | 回退 toast + 指引导入；文档写明主题内容不跨设备 |
| AA 违规主题伤害可读性 | 导入对比度预检报告（不阻断）+ 语义色纪律文档；极端情况用户可用 userstyle 再盖 |
| 几何破坏型主题（树导轨线类）与连接线/槽位系统打架 | 作者指南「几何不侵犯区」+ density 正交设置给出口；内置主题一律不破格 |
| 动画/glow 主题的性能与眩晕 | reduced-motion 强制要求；perf-popup 探针对内置主题例行复测（k3 §6.2 纪律） |
| 主题文件夹带恶意内容 | CSP 已封 `@import`/远程 `url()`；校验阻断远程引用警告；内容纯 CSS 无脚本面（与 userstyle 同地位） |

---

## 附录 A · Dracula 引用选择器审计（对照 css/neat.css @4.1.1）

| 引用 | 内置命中 | 状态 |
|---|---|---|
| `#tree ul li a` / `> span` / `.twisty` | 547/555/563；twisty ×25 | 存活 |
| `#tree ul ul`（缩进/导轨/tick） | **0**（内置无嵌套缩进规则） | 叠加性冲突（§1.5） |
| `--staging-line` | ×4 | 存活 |
| `--stg-trunk-x`/`--stg-tick-w`/`--tg-line-x` | 主题未引用 | **漂移裂缝**（2026-08-27 连接线体系） |
| `#results` / `mark` | 存活 | 存活 |
| `#recent-list`/`#stats-list`/`#dead-list`/`#dupes-list` | 五列表视图体系 | 存活 |
| `#staging-list` | ×77 | 存活 |
| `#tabgroups-list` + `tabgroups-*` 头/行/徽章 | ×140；window-current ×1、current ×2 | 存活 |
| `.staging-toolbar` 等六工具栏 | ×39 | 存活 |
| `.vbm-dropdown-list` | ×15 | 存活 |
| `.vbm-row`/.`row-sub`/.`row-path`/.`row-badge`(×18)/.`row-btn` | v4 行解剖 | 存活 |
| `#view-tabs`/.`view-tab`/.`tab-indicator`(×2) | 存活；indicator 被 k3 S3 预告删除 | **预告死区** |
| `menu[type=context]`/.`menu-item`/.`submenu` | context-menu 体系 | 存活 |
| `#command-palette`/.`palette-row`/.`palette-url`/.`palette-slash`/.`palette-badge` | palette 体系 | 存活 |
| `.dialog` + 四 picker 对话框 id | dialogs/folder-pick | 存活 |
| `#undo-toast`/`#notice-toast`/.`risk-banner`(×14)/.`stats-history-banner` | toast/横幅体系 | 存活 |
| `#whats-new`(×10)/.`announce-banner`(×10)/`#announce` | announce 体系 | 存活 |
| `.count-pill`(×17) | 存活 | 存活 |
| `#bookmark-clone`(×7)/`#drop-overlay`(×5) | dnd 体系（z-index 50，neat.css 头注释 Layer 2c） | 存活 |
| `#quick-add-btn`/`#tool-btn` | 工具钮 | 存活 |
| 滚动条伪元素 | scrollbar 门禁在 harness | 存活 |
| `#search`/`#search input`/`#search-clear`/`.vbm-icon-search` | 搜索栏 | 存活 |

## 附录 B · token 缺口清单（从 407 个 `!important` 里挖出来的债）

| 主题被迫选择器覆盖的东西 | 现状 | velvet 归宿（k3） | 本文建议 |
|---|---|---|---|
| 选中/hover 背景渐变 | `--vbm-bg-selected` 17 处 `background:` + **10 处 `background-color:`**（渐变值会被后者丢弃） | 未涉及 | S1 统一改 `background:`，token 值类型定为「任意 background 值」 |
| 辉光（hover/selected/focus 的多层 shadow + text-shadow） | 无 token | §1.6.2 ink 磷光晕（主题专属材质） | `--vbm-glow-hover`/`--vbm-glow-focus`（shadow 列表或 none，默认 none） |
| hover 装饰线（::after 光条） | 无 token | §1.7 paper 朱砂竖条（主题专属） | `--vbm-row-hover-rule: none\|<color>` |
| 选中行呼吸动画 | 无 token | §1.0 动效 token（--vbm-dur-*） | `--vbm-row-focus-animation`（默认 none，强制 reduced-motion 尊重） |
| 字体族/字号/字重 | `font: menu` ×7，无 token | §1.4 仅字号两档 | `--vbm-font-ui` 延至 P3（作者指南先给 CSP 规则） |
| 行密度（padding/margin/行高） | 仅 `--vbm-row-h: 28px` | §1.2 间距 token | **不进主题**——density 正交设置（§4.8） |
| 滚动条 thumb 渐变 | `--vbm-scrollbar` 单色 | 未涉及 | 值类型放开为任意 background（scrollbar 门禁加矩阵） |
| 面板梯度 canvas | `--vbm-canvas`（velvet 新增，平面色） | §1.1 | 内置维持平面裁决；P3 起对用户主题放开值类型 |
| `color-scheme` | 主题块内声明 | 已如此 | 无债 |

---

*本文为分析定稿（2026-08-30）。实施动作从 P0（路径 A 预设）起逐项立卡；P1 的四个 token 建议并入 velvet-task-2-k3 的 S1/S6 设计评审，其余以本文件为唯一事实源。样本 CSS 存档于分析过程，未入库。*
