# velvet 任务清单 · K3 定稿方案

> 版本基线：**4.0.5**（`manifest.json`/`package.json`，含 4.0.5 打磨审计的全部修正）。
> 目标发布版本：原定 4.1.0，目前待定。
> 本文以 [`velvet-task-1.md`](velvet-task-1.md) 为基准、以 [`velvet-task-1-ds.md`](velvet-task-1-ds.md) 为参考稿，独立重审了全部条目：刷新过时「现状」、复核每一处「方向」、对所有未定项作出最终决策。**k3 与 ds 冲突之处以 k3 为准**（差异集中见 §8 对照表）。
>
> 本文只做设计，不实施。实施切片、回归门禁见 §7。
>
> 4.0.5 已落地、与本文相关的修正（不再列入 velvet 待办，但各条「现状」已按此刷新）：
> ① favicon 反色服务**重写**——判定从「均值亮度+饱和度」改为**极端色占比**（暗底 `dark>0.55 且 light<0.05` 翻转、亮底 `light>0.60 且 dark<0.15`），滤镜从 `invert(1)` 改为 **`invert(1) hue-rotate(180deg)` 保色相明度翻转**；依据 13 个真实 favicon（澎湃/GitHub/x.com/Netflix/YouTube/雅书/WordPress 等）× 4 主题背景的渲染矩阵定参。auto 主题 OS 级切换经 `matchMedia` 重判、options 开关经 `chrome.storage.onChanged` 直推常驻侧栏。
> ② 共享模块收敛：`escape.js`（9 份 htmlspecialchars 副本归一）、`fuzzy-core.js`（omnibox 与 popup 统一排序）、`list-focus.js`（4 个 list view 的 park/unpark + 工具栏焦点三件套 + `rowFocusTarget` 行焦点契约）。
> ③ focusSpot 重开焦点统一恢复 + viewState 行记忆纳入 rememberState 门控；undo toast 进 Tab 环。
> ④ palette：Tab 两停圈禁、结果行移出 Tab 序、`<mark>` 高亮、stale `.active` 吞键修复、分隔符不进索引、文件夹 noTitle 回退。
> ⑤ 删除红色语义铺全（搜索历史行内删除、全部菜单删除项、danger 淡色 hover 统一）；搜索视图双行图标规格补齐 `#results` 作用域；sync 圆点/死链 × 角标改 `inset-inline-end`（RTL 镜像）。
> ⑥ 死链/去重加固：删除链读 `lastError` 报实际数、applySelected 退出选择模式、确认框点名 keeper 并统一附 `undoSingleStepNote`（en 388 键）；死链 `onCreated` 重 join、页签徽标树 join 派生（删冷启动 preload，旧计数不再复活）；空标题书签 URL 回退转义补齐、`escape.js` 补 `&`（全量调用方审计证实无双喂）；搜索/面板文件夹菜单空夹置灰与树内一致。

---

## 0. 决策总览

### 0.1 维持 ds 定案的项（论据仍然成立，k3 只做细化）

| # | 项 | 定案 |
|---|---|---|
| D1 | §一.6 死链 × 覆盖层按 blocked/dead 场景着色 | ✅ 做（红/琥珀，与 `.row-badge` 同语义） |
| D2 | §一.2 modern 主视图列表区圆角卡片 | ✅ 做（几何见 §1.3） |
| D3 | §一.9 hover 按钮右缘对齐 | ✅ 统一右缘动作槽、槽恒占零回流 |
| D4 | §二.3/4 macro/引用命令 | ❌ 不进 velvet，仅立数据模型（ds B3 模型保留） |
| D5 | §五.2 侧边栏双栏 | ❌ 不进 velvet（触发条件见 §5.2） |
| D6 | §一.10 跟随浏览器 `chrome.theme` | ❌ 不做（任意用户主题无法映射语义 token） |

### 0.2 k3 修改 / 推翻 ds 的项（逐项理由见对应章节）

| # | 项 | ds 原案 | **k3 定案** | 一句话理由 |
|---|---|---|---|---|
| K1 | tab 质感（N2） | 扁平圆角 tab + **保留滑动指示条** | **分段式软填充、移除底条** | 卡片化后底条 `bottom:-1px` 与卡片上边框相撞；填充+底条双信号在 32px 高度上是噪音 |
| K2 | classic 实现（N1） | 元素级 `border-radius:0` 覆盖表 | **token 级覆盖**（classic.css 只重定义半径/边框 token + 搜索通栏） | A2 分层 token 落地后，元素级覆盖是双倍维护；token 覆盖一处生效、全主题契约测试可断言 |
| K3 | A3 默认图标折角 | 方案 A/B 落地时再选 | **选定 B：圆弧角文档** | 与 radius-sm 几何语言同源；不必留两版悬浮 |
| K4 | A10 auto 深色映射 ink（可选增强） | 低优先级可选 | **否决** | auto 的价值是可预测（跟随 OS 明/暗）；多一个映射分支 = 主题矩阵 ×2 的测试与心智成本，收益是个别口味 |
| K5 | C3 计算器/单位换算 | 低成本进 velvet | **否决** | palette 是书签命令面板不是启动器；零用户请求，维护与文案成本纯增 |
| K6 | C1 `#标签` 预留语法 | 预留 | **删除** | 标签体系不存在，预留语法只会写进文档误导用户；YAGNI |
| K7 | B2 内置命令记忆 | 计数 + 排序 + Top3 三个开关 | **一开一序**：`paletteHideBuiltin` + `paletteBuiltinOrder: table\|usage` | Top3 与 usage 排序语义重叠，三开关互相组合出未测路径 |
| K8 | §四 横幅远程层 | Upstash REST + 内置只读 token | **静态 JSON**（仓库 `docs/announce.json`，经 `raw.githubusercontent.com` 拉取） | 零密钥、零新依赖、公告进 git 历史即发布流程；书签扩展外呼第三方端点的隐私观感与商店审核风险同步消除 |
| K9 | E1 独立页形态 | 隐藏搜索/标签条/捐赠的裁剪壳 | **完整应用壳**（只隐捐赠卡；保留搜索与标签条） | 独立页的价值是「清理工作台」，搜索与视图切换正是工作台的高频操作；裁剪壳反而要做更多守卫 |
| K10 | §二.7 功能盘点 | 待盘点 | 已盘点定案（§2.6）：收 `/copy …\|markdown`、`/open-all`、`/sort` 等，否 `/pin`、`/export`、计算器等 | 见逐条理由 |

### 0.3 velvet 范围红黑榜（k3 最终版）

**进 velvet**：
- 视觉：V1 几何/间距 token 分层、V2 表面卡片化 + tab 分段重绘、V3 四主题材质（modern/ink/paper 个性 + classic token 覆盖）、V4 状态语言按主题、V5 图标系统补齐（CLOSE/EMPTY/折角圆弧化）、V6 左右缘对齐系统、V7 标记同现 + 场景着色、V8 选项页精细化、V9 最近搜索呼吸空间、V10 CSS 主题解耦、`/next-theme`。
- 面板：B1 自定义置顶、B2 一开一序、B4 `/panel`·`/popup`、B5 `/onlybar`·`/all`。
- 输入栏：C1 字段过滤 token（修编版）、C2 多词 AND、C3 URL 直开 + `/toggle` + `/copy`。
- 通知：D 静态 JSON 公告层 + 功能引导 tooltip 纪律。
- 侧边栏：E1 独立页（完整壳）。
- 工程：F 商店首图自动化。

**不进 velvet（另立排期）**：B3 macro/引用、C4 中成本（结果批量操作/作用域搜索/参数化创建）、E2 双栏、`chrome.theme` 跟随、计算器、`autoDarkIsInk`。

---

## 1. 视觉设计体系（V 系列）

> velvet 的视觉目标不是「再抛一层光」，而是建立一套**有名字、有原则、可断言**的视觉语言。本节是全文核心。

### 1.0 语言总纲：Calm Instrument（克制的仪器感）

vBookmarks 是「打开即搜索」的高密度工具：400px 弹窗里最多同时存在搜索栏、6 个视图标签、28px 行高的长列表、双层标记。它的美感应来自**秩序**而非装饰。三条原则：

1. **一个几何， themed 材质（One geometry, themed materials）**。全部主题共享同一套几何——圆角尺度、槽位、留白节奏、状态形状完全一致；主题之间只换材质（色板、纹理、光泽）。这是工程纪律也是设计纪律：几何统一保证五个主题永远对齐同一套契约测试；材质差异让每个主题有自己的性格，且新增主题只写一份材质表。
2. **层级靠表面，不靠阴影**。小面积高密度界面的层级用**表面色阶**（`bg` 窗体 → `bg-elev` 字段/卡片 → `selected` 选中）加**发丝边框**（1px、`color-mix(fg 10–26%)`）表达；投影只留给真正的浮层（右键菜单、对话框、命令面板、toast）。列表内部零阴影，是 calm 感的来源。
3. **动效守时**。单一节奏 120–150ms `ease-out`，只动 `opacity`/`transform`/背景色；`prefers-reduced-motion` 全停（现有契约，写入主题文件头注释）。

### 1.1 几何系统（token 分层）

**半径尺度**（`:root` 定义，全主题共享；classic 在 token 层整体改写，见 §1.4.4）：

```css
--vbm-radius-xs: 2px;    /* 徽标、小角标、状态细条 */
--vbm-radius-sm: 4px;    /* 行内按钮、分段开关、chips、选中行 */
--vbm-radius:    8px;    /* 控制件：输入框、按钮、菜单、对话框、tab */
--vbm-radius-lg: 12px;   /* 主容器卡片（#views） */
--vbm-radius-pill: 999px;/* 药丸：计数徽标、CTA */
```

**间距尺度**：`--vbm-gutter: 8px` 为基础槽，派生 `--vbm-gutter-sm: 4px`、`--vbm-gutter-lg: 12px`。页面四缘、卡片外距、工具栏内距、历史头行内距全部引用这三档，零散 `2px/3px/5px/6px` 一律收敛（映射表现存 ds 附录 A，k3 沿用并补：所有 spacing 硬编码同步收敛）。

**表面层级**（elevation model）：

| 层 | token | 用途 |
|---|---|---|
| L0 | `--vbm-bg` | 窗体底 |
| L1 | `--vbm-bg-elev` | 搜索字段、#views 卡片、菜单/对话框底 |
| L2 | `--vbm-bg-hover` / `--vbm-bg-selected` | 行状态 |
| L3 | `--vbm-shadow` | 仅浮层投影 |

**新增 token**：`--vbm-accent-hover`（accent 填充物的 hover 态，替代死链药丸的 `brightness(1.08)` 硬编码——各主题自定义：light 加深 8%、dark/ink 提亮 8%、paper 暖化加深）。

### 1.2 表面卡片化（D2 落地）

- `#views` 升级为卡片：`margin: 0 var(--vbm-gutter-sm) var(--vbm-gutter-sm); border: 1px solid var(--vbm-border); border-radius: var(--vbm-radius-lg); background: var(--vbm-bg-elev); overflow: hidden;`（`overflow:hidden` 裁切内部滚动条圆角）。dark/ink 下卡片**不加投影**（原则 2）；light/paper 下仅 1px 边框，同样无投影。
- `#view-tabs` 与卡片同宽（`margin: 0 var(--vbm-gutter-sm)`），是卡片上方的透明轨道——搜索字段（L1 浮于 L0）→ tab 轨道（L0 透明）→ 卡片（L1），三层节奏与顶部圆角控件形成现代分割。
- `#tree`/`#results`/各列表容器背景改透明（卡片底色由 `#views` 提供），删除列表顶部的 inset shadow（卡片边框取代其分隔职能）。
- 卡片内行的左右呼吸：列表容器 `padding: 3px 0` 改为 `padding: var(--vbm-gutter-sm)` 的上下留白 + 行几何内缩 2px（见 §1.5 状态形状），行不再贴卡片边缘——这是「卡片感」成立的关键细节。
- ink/paper/classic 的卡片材质差异见 §1.4。

### 1.3 tab 条重绘（K1：分段式软填充，推翻滑动底条）

**定案**：active tab = **圆角软填充**（segmented），移除 `.tab-indicator` 底条。

- `.view-tab`：`border-radius: var(--vbm-radius)`（轨道内上下各留 3px，填充不贴轨道边缘）；`transition: background-color .12s ease-out, color .12s ease-out`（接入既有单一节奏）。
- hover：`background: var(--vbm-bg-hover)`。
- active（`aria-selected="true"`）：`background: color-mix(in srgb, var(--vbm-accent) 12%, transparent); color: var(--vbm-accent);`，字重不加粗（避免宽度抖动导致 6 个 tab 互相推移——`flex:1 1 0` 下宽度恒定，此处只是纪律说明）。
- **移除 `.tab-indicator`**：① 物理冲突——卡片化后底条 `bottom:-1px` 正好压在 `#views` 卡片的上边框上；② 信号冗余——软填充 + accent 文字已是完整的 active 表达，再加底条是双重强调；③ 67px 宽的 tab 上 2px 底条的滑动动画几乎不可感知。view-manager 里 indicator 的定位/滑动逻辑同步删除，`aria-selected` 语义不变。
- 分段式的容器协调：`#view-tabs` 保留下边框 `1px var(--vbm-border)` 作为轨道与卡片的分隔，active 填充与卡片顶缘之间留 3px 间隙，视觉上「tab 浮在轨道上、卡片在轨道下方」——层次分明但不粘连。
- badge（dead/dupes 计数药丸）在 active 填充上保持 `--vbm-danger` 不变（danger 在 12% accent 底上对比充足，四主题验算过）。

### 1.4 主题材质（每主题独立的性格设计）

#### 1.4.1 light / dark ——「Modern」

全量采用 §1.1–1.3 新几何。light 保持 Material 系干净表面；dark 的卡片/字段边框用 `rgba(255,255,255,.10)` 发丝线，**禁用投影**——暗主题的深度来自色阶而非阴影。两主题无纹理、无渐变，性格的重心让给 ink/paper/classic。

#### 1.4.2 ink ——「仪器 / Instrument」

主旨（现有定义保留并强化）：深蓝黑工作台面 + 电感 indigo accent + 磷光。velvet 赋予它三个可识别的签名细节：

1. **磷光晕（phosphor halo）**：焦点环与 active 状态在 ink 下带极轻的外发光——`box-shadow: 0 0 0 1px color-mix(in srgb, var(--vbm-accent) 35%, transparent), 0 0 8px color-mix(in srgb, var(--vbm-accent) 22%, transparent)`。只作用于 focus-visible、active tab、选中行三处，面积克制，像示波器辉光而非霓虹。
2. **仪器网格底纹**：`body` 背景叠一层 CSS 生成的 1px 网格（双向 `repeating-linear-gradient`，24px 间距，`color-mix(in srgb, var(--vbm-accent) 4%, transparent)`）——纯 CSS、零位图、零请求，`background-attachment: local` 随窗体静止。**面积纪律**：只在 L0 窗体层，不进入卡片与字段内部。
3. **等宽数字**：计数徽标、dead/dupes 统计、扫描进度数字用 `font-variant-numeric: tabular-nums`——仪器读数不跳动。

几何上 ink 的卡片半径降一档（`--vbm-radius-lg` 在 ink 材质里映射 8px）——仪器的边角更利落。

#### 1.4.3 paper ——「纸器 / Stationery」

主旨：宣纸底、墨色字、朱砂印。velvet 的三个签名细节：

1. **纸纹**：CSS 生成的极轻颗粒——两层 `repeating-conic-gradient` 微斑点（2–3% alpha 暖灰），叠加在 `body` 背景；纯 CSS 零位图。同样只限于 L0 层。
2. **纸张卡片**：`#views` 卡片在 paper 下是「一页纸」——`bg-elev #fffdf7` + 顶部受光（`linear-gradient(180deg, rgba(255,255,255,.5), transparent 48px)`）+ 暖色发丝边框；半径收为 6px（纸张不追求大圆角）。
3. **朱砂竖条选中**：选中行的材质不是整行填色，而是**左缘 2px 朱砂竖条 + 极浅暖色 wash**（`color-mix(in srgb, var(--vbm-accent) 7%, transparent)`）——印章/书签红绳的意象，paper 主题独有的识别点。hover 保持暖灰 `--vbm-bg-hover`。

#### 1.4.4 classic ——「经典 heritage」（K2：token 级覆盖，推翻 ds 的元素级覆盖表）

classic 是 v3.x 方形时代的致敬，**只做浅色**。

**实现定案**：`css/themes/classic.css` 只重定义 token + 两条结构规则，不写元素级覆盖表：

```css
body[data-theme="classic"] {
    /* 几何归零：v3 是方形世界 */
    --vbm-radius-xs: 0; --vbm-radius-sm: 2px; --vbm-radius: 2px;
    --vbm-radius-lg: 0;  --vbm-radius-pill: 999px; /* 计数药丸保留 */
    /* 材质：v3 的强灰边、白底、无色阶 */
    --vbm-bg-elev: #ffffff;
}
/* 贯穿式搜索栏：通栏、贴窗口左右缘 */
body[data-theme="classic"] #search { margin: 0; }
body[data-theme="classic"] #view-tabs { margin: 0; border-radius: 0; }
body[data-theme="classic"] #views { margin: 0; border-radius: 0; border-inline: 0; }
```

- 因为 §1.1 的分层 token 先行落地，classic 的「方形化」在 token 层一处生效，全组件跟随——这就是 K2 否决 ds 元素级覆盖表的理由：ds 的表需要对每个元素列一条 `border-radius:0`，新增组件时必然漏网；token 覆盖不可能漏。
- 浮动两按钮（`#quick-add-btn`/`#tool-btn`）：方形 + 透明底 + hover `--vbm-bg-hover`，与搜索框同高贴合成组——「浮动」指它们不入搜索框通栏、浮在右侧；清空按钮沿用字段内浮层不变。
- classic 不跟随 `prefers-color-scheme`（用户选 classic 就是要浅色方形）；不进 `/next-theme` 循环（一次性口味选择，`/theme classic` 直达）。
- 与「一键恢复经典界面」开关**正交**：一个管几何/材质，一个管功能集；两开 = 完整 v3 体验。

#### 1.4.5 auto

映射逻辑不变（亮→:root、暗→dark）。K4 否决「auto 深色映射 ink」开关：auto 的承诺是「可预测的跟随系统」，映射到个性主题破坏这个承诺；ink/paper 是显式选择。

### 1.5 状态语言（V4：hover / selected / focus / flash / dnd）

**几何全主题统一**（一个几何原则）：卡片内的行状态用**内缩圆角矩形**——行左右各内缩 2px、`border-radius: var(--vbm-radius-sm)`；非卡片场景（菜单项、palette 行）维持直角平铺。焦点环保留 `2px solid var(--vbm-focus-ring)`、`outline-offset: -2px`，随形状贴边。

**材质按主题**：

| 状态 | light / dark | ink | paper |
|---|---|---|---|
| hover | `--vbm-bg-hover` | 同左 + 0.5 档磷光（`color-mix(accent 6%)` 叠底） | 暖灰 `--vbm-bg-hover` |
| selected | `--vbm-bg-selected` + `--vbm-fg-selected` | 深蓝底 + 磷光细边（§1.4.2.1 的单层 1px 版） | 朱砂左竖条 2px + 7% 暖 wash |
| focus-visible | focus-ring 2px | focus-ring + 磷光晕 | focus-ring（暖） |
| flash（reveal 渐隐） | `--vbm-flash` | 同左 | 同左（已有暖调） |
| dnd 插入线 | `--vbm-fg` 3px | accent 3px + 磷光晕 | `--vbm-fg` 3px 墨线 |
| dnd 文件夹高亮 | `--vbm-flash` 底 + accent 边，半径收敛 `--vbm-radius-xs`（消灭硬编码 2px） | 同左 + 磷光 | 暖 flash 底 + 朱砂边 |
| 拖拽幽灵 | mask 淡出（现状保留） | 同左 | 同左 |

死链「开始扫描」药丸 hover 从 `brightness(1.08)` 改 `--vbm-accent-hover` token 驱动（§1.1）。

**实施约束**：状态规则的**几何部分**留在 neat.css（共享），**材质部分**随 §1.9 解耦进 `css/themes/<theme>.css`——几何契约一份断言、材质差异各表其面。

### 1.6 图标系统（V5）

线稿语言纪律（既有，写入契约）：16px 网格、1.5px stroke、`stroke="currentColor"`、圆角 linecap/linejoin。

1. **A3 默认文档图标折角（K3：选定方案 B）**：`DEFAULT_BOOKMARK_ICON` 右上折角改**圆弧过渡**——用 `A` 弧替代直角折线，与 radius-sm 的圆角节奏同源；保持 16px 网格 / 1.5px 描边。ds 的「落地时再对比 A/B」在此定稿，不留双版本悬浮。
2. **A4 克制清单**（维持 ds，微调）：新增 `CLOSE_ICON`（统一 `#search-clear` 内联 × 与 dead-indicator 的文本 ×——dead × 用 SVG 后在 10px 圆内比 8px 文本字形更居中、笔画可控）、`EMPTY_ICON`（empty-state 行首 16px muted）、`OPEN_EXTERNAL_ICON`（E1 独立页入口按钮用，见 §5.1）；菜单项仍只给 `open-in-new-group`/`save-session` 两项配 icon；横幅关闭 × 统一 `CLOSE_ICON`。
3. dead × SVG 化后与 sync 圆点的尺寸差问题自然消解（§1.7）。

### 1.7 对齐系统与标记系统（V6/V7：A9 + A11 + A5 + A6）

**左缘槽位契约（token 化）**：
`--vbm-slot-guide: 16px`（树引导槽）、`--vbm-icon-slot: 20px`（双行 22px）、`--vbm-gap-icon: 4px`（双行 8px）、控制件 gutter `--vbm-gutter: 8px`。树/搜索/recent/stats/dead/dupes 六处行模板引用同一组 token，不再散写数值。

**右缘动作槽（D3 落地，精确值）**：
`.vbm-row { padding-inline-end: var(--row-action-gutter, 0); }`，各视图容器设值——`#dupes-list: 24px`（成员行尾补等宽槽，与组头 ✓ 的 24px 基线对齐——这是用户观察到「不对齐」的主场景）、`#dead-list: 48px`（flag+trash）、`#stats-list` 与 `.search-history-row: 24px`（现状显式化）、`#tree`/`#results: 0`（无行内按钮，保持 0）。hover 揭示沿用 `visibility`，槽恒占零回流。诊断口径：harness 对每视图取「有/无动作行」断言内容右缘差 ≤1px、hover 前后 rect 不变。

**相邻区域**：搜索栏/工具栏/历史头/列表容器的水平留白统一引用 gutter token（收敛 `4px 8px`、`2px 8px`、`3px 0`）。

**标记同现（A5）**：dead ×（10px 圆，钉右上）`top:-3px → -4px`，与 sync 点（6px，右下）的重叠区收缩到 ≤1px；两者 4.0.5 已改 `inset-inline-end`（RTL 镜像已成立）。同现态截图回归进 harness `diag-402`。

**× 场景着色（D1）**：dead-mark 覆盖层渲染时读 `deadLastScan.results[id]?.status`，`blocked` 加 `.dead-indicator.blocked`（琥珀 `--vbm-warning`），未扫描/ dead 保持 `--vbm-danger`。注意 4.0.5 后渲染点是 tree-view 的 onTreeGenerated 重铺 + view-dead 的 mark/unmark 两处，都要带场景。

### 1.8 选项页与最近搜索（A7 + A8）

**A7 选项页**：① 组卡片化——每组 `--vbm-bg-elev` 底 + `--vbm-radius` 圆角 + 组标题字重提升（与 popup 卡片语言呼应）；② 按钮三态：hover `--vbm-bg-hover` + border accent、`focus-visible` 全量补 focus-ring、active 微降亮度；③ 危险操作（清空统计/重置/导入覆盖）统一 danger + 图标（§1.6）；④ 主题下拉加 classic（i18n `themeClassic`）；⑤ options.css 的 token 块随 §1.9 解耦改为引用共享 token 文件（现状是两个文件手工同步的注释约定，解耦后从机制上消灭漂移）。

**A8 最近搜索呼吸空间**（纯 CSS，维持 ds 数值）：`#search` 底距 4→6px、历史头行 padding `2px 8px → 5px 8px`、行内 meta/time 间距 8→10px；查询词与结果数之间加 2px。目标：头行到首行的垂直节奏与卡片区（§1.2 的 4px 内缩）同呼吸。

### 1.9 CSS 架构解耦（V10）

```
css/
  neat.css            # 通用结构 + 几何（布局、行契约、状态形状、动画）
  themes/
    base.css          # :root token（light 即默认）+ auto 亮映射
    dark.css          # dark token + auto 暗映射（@media 块随迁）
    ink.css           # ink token + 磷光/网格/仪器材质
    paper.css         # paper token + 纸纹/纸卡/朱砂材质
    classic.css       # classic token 覆盖 + 通栏结构（K2）
```

- 加载顺序：neat.css → base/dark → ink/paper/classic（后加载者只含 token 与材质，特异性平级靠顺序取胜）；`popup.html`/`sidepanel.html`/`options.html` 同步改 link 列表（options.css 的 token 块删除，改引 themes——消灭两文件手工同步注释）。
- `sync-styles.css` 保持独立（职责单一）。
- **契约测试**：`theme.test.js` 断言①半径/spacing 无硬编码残留（正则扫 neat.css 禁止 `border-radius: [0-9]` 直值出现在几何规则外）；②五主题 token 完备性（每主题文件必须定义同一 token 清单）；③classic 的 token 覆盖存在。`scrollbar-contract.test.js` 更新卡片裁切断言。
- **搬移纪律**：先加文件与 link、再逐块搬移、每步全量 vitest + harness smoke；搬移期不改任何视觉值（纯位移 diff 可审）。

### 1.10 主题快速切换（A10）

- palette 新增 `/next-theme`（keepOpen）：循环 `auto → light → dark → ink → paper`，classic 不进循环（§1.4.4）；复用现有 `/theme <name>` unique-prefix 机制。
- 顶部**不加**第三个按钮（顶部已拥挤，且主题切换是低频操作）——维持 ds N4。
- `chrome.theme` 浏览器主题跟随：**否决**（D6）——用户浏览器主题色彩任意，无法映射到语义 token；这不是保守，是这个映射在数学上不成立。

---

## 2. 命令面板（B 系列）

### 2.1 B1 自定义命令置顶

新增 `paletteCustomsTop`（默认关，保肌肉记忆顺序）。开：自定义区插到内置区之前；slash unique-prefix 优先级不变（`/ink` 仍命中内置）。选项页 Commands 组加开关。

### 2.2 B2 隐藏内置 + 使用排序（K7：一开一序）

- `paletteHideBuiltin`（默认关）：开则 `render()` 过滤内置命令区——只显示自定义命令 + 书签结果 + 桥接行。**精确语义**：隐藏的是内置命令，书签命中不是命令，始终保留。
- `paletteBuiltinOrder: 'table' | 'usage'`（默认 table）：usage 时内置区按 `paletteBuiltinUses`（storage.local，`{cmd: count}`，fn 执行时 +1，200ms 节流写盘）降序。
- **否决 ds 的 Top3 开关**：与 usage 排序语义重叠，三个开关的组合路径（hide × sort × top3）产生未测行为；要「最常用在前」就是 usage 序本身。

### 2.3 B3 macro / 引用命令（不进 velvet，模型保留）

维持 ds D4 与数据模型（`{ type:'macro', steps:[{ref, args}] }`、循环检测、8 步上限）。4.2.0 与「自定义命令 v2」合并评估。

### 2.4 B4 `/panel` · `/popup`

- `background.js` 新增 `chrome.runtime.onMessage`：`{type:'vbm-open-sidepanel'}` / `{type:'vbm-open-popup'}`，复用现有 open 路径（`background.js:214-258`）。
- `/panel` 语义 = **toggle**（对齐快捷键；面板已开时关闭）；`/popup` = 收侧栏回弹窗（`panel-behavior.js` toggle 语义）。
- 边界：popup 内执行 `/popup` 为 no-op（已在弹窗）；`chrome.action.openPopup` 需 Chrome 127+，低版本回退 `?popup=1` 窗口（复用 palette 兜底窗口模式）。

### 2.5 B5 `/onlybar` · `/all`

- `tree-view.js:98` 的 `onlyShowBMBar` 启动常量改**运行时读取**；命令只动会话级 `showAllOverride`，**不重写用户设置**（对齐现有语义）。
- 执行后 `undo.toastAction` 轻反馈当前模式。

### 2.6 功能扩展盘点（K10 定案）

| 候选 | 决策 | 理由 / 形态 |
|---|---|---|
| `/copy title\|url\|path` | ✅ velvet | `clipboardWrite` 权限已有；聚焦行取值，含 search 结果行 |
| `/copy markdown` | ✅ velvet | `[title](url)` 是记笔记/写文档的高频形态，与 `/copy` 同通道零额外机制 |
| `/open-all` | ✅ velvet（先行版） | 复用 `actions.openBookmarks`（含 10 项确认阈值），是「结果批量操作」的零成本先行形态 |
| `/sort` | ✅ velvet | 打开当前聚焦文件夹的排序对话框，入口已有 |
| `/toggle <view>` | ✅ velvet | dead/dupes/stats/recent 的 show* 开关翻转（C3） |
| `/next-theme` | ✅ velvet | §1.10 |
| 计算器/单位换算 | ❌ 否决（K5） | palette 不是启动器；零请求，纯增维护 |
| `/export` 导出书签 | ❌ 否决 | 选项页备份/导出已覆盖；面板里再做一份是双通道 |
| `/pin-tab` 固定标签页 | ❌ 否决 | 进入标签页管理领域，定位越界 |
| `/duplicate` 复制书签 | ❌ 否决 | 与去重功能理念相悖，无请求 |
| `/sync-refresh` 手动刷同步标记 | ❌ 否决 | sync-engine 已有事件+定时刷新，手动入口是安慰剂 |
| 命令历史 MRU | ⏸ 4.2.0 | 复用 searchHistory 结构，与 B2 usage 序合并设计 |
| 命令收藏夹 | ⏸ 4.2.0 | 依赖 macro/自定义 v2 一并评估 |
| 参数化 `/add <标题> <url>` | ⏸ 4.2.0 | 与 macro 的 `{{rest}}` 语义合并（C4） |

### 2.7 内置命令面板行为一致性（4.0.5 回填提醒）

4.0.5 已修：结果行 tabindex=-1、Tab 两停圈禁、`<mark>` 高亮、stale `.active` 守卫。velvet 新增命令时**必须**走 `palette-commands.js` 的既有注册路径（命令表 + i18n + 测试三件套），不得旁路——写进实施纪律。

---

## 3. 输入栏扩展（C 系列，修编版）

### 3.1 C1 搜索字段过滤 token（进 velvet，K6 删 #tag）

**语法**（大小写不敏感，多个 token 之间 AND，token 之后的剩余文本照常 fuzzy）：

| token | 语义 | 数据源 |
|---|---|---|
| `site:github.com` | URL 主机包含（子域自动命中：`site:github.com` 含 `gist.github.com`——用主机 endsWith 边界匹配） | 索引 url |
| `folder:工作` | 祖先文件夹标题包含（复用 view-manager 的 `buildPathMap`/pathOf） | 路径映射 |
| `title:词` / `url:词` | 限定匹配通道 | 索引字段 |
| `dead:` / `blocked:` | 死链/阻断（**基于最近一次扫描缓存** `deadLastScan`；从未扫描 → 命中为零，结果区顶部给一行 muted 提示「先运行一次死链扫描」） | 扫描缓存 |
| `visited:>N` | 访问次数 ≥ N（`visitStats`；stats 关闭时同样给提示行） | visit-stats |

**定案细节**：
- **删除 `#标签` 预留语法**（K6）：标签体系不存在，预留 = 文档负债。
- token 形态 `prefix:value`，`prefix` 表固定枚举；无法识别的 `xxx:yyy` **不当 token**（整串照常 fuzzy）——避免误吞合法查询（如搜 `http:` 开头的书签标题）。
- 解析层是纯函数 `parseQueryTokens(query)`（search.js 上层，fuzzy-core 保持纯净）；`<mark>` 高亮只作用于 fuzzy 剩余词的命中（token 部分不高亮，它是过滤条件不是匹配内容）。
- C2 多词 AND 先落地，C1 的剩余词复用其分词结果（实施顺序 S14 内先 C2 后 C1）。

### 3.2 C2 多词 AND 分段匹配（进 velvet）

- `rank()` 对空格分词：各词独立子序列评分，**全部命中**才返回；总分 = 各词分相加 + 连击加成；顺序不敏感。
- `<mark>` positions 跨词合并（并集排序）。
- omnibox 侧经 search-core 共享 fuzzy-core，行为自动一致（4.0.5 的统一红利）。
- 边界：单词查询路径与现状逐字节一致（回归测试锁死，避免排序漂移惊扰存量用户）。

### 3.3 C3 命令面板低成本扩展（K5 删计算器）

| 项 | 定案细节 |
|---|---|
| **URL 直开** | 平铺查询命中 `^https?://\S+$` 或裸域名 `^[\w-]+(\.[\w-]+)+(:\d+)?(/\S*)?$` → 首位出「打开 URL」行（earth 图标），Enter 直开；与 slash 分支天然不冲突（slash 已先行分流）；与书签搜索并存（URL 行置顶，书签命中照常列出） |
| **`/toggle <view>`** | 翻转 `showDeadView`/`showDupesView`/`showStatsView`/`showRecentBookmarks`；unique-prefix 匹配视图名；执行后 toast 反馈新状态；view-manager 监听既有 onChanged 路径热生效 |
| **`/copy title\|url\|path\|markdown`** | 作用于当前聚焦行（树/结果/列表行统一经 `rowFocusTarget` 契约取行）；无聚焦行时命令行显示 disabled 态说明；`markdown` 产出 `[title](url)` |

### 3.4 C4 中成本（不进 velvet）

维持 ds：结果批量操作（选择模式复用 dead/dupes 机制）、作用域搜索（聚焦文件夹限定子树）、参数化 `/add`。4.2.0 与 macro 合并评估。

---

## 4. 通知系统重构（K8：静态 JSON 公告层，推翻 Upstash）

### 4.1 端点决策

**定案**：公告数据放仓库 `docs/announce.json`，客户端经 `raw.githubusercontent.com/windviki/vBookmarks/master/docs/announce.json` 拉取。

- **vs Upstash**：① 零密钥——ds 方案需内置只读 token，虽然数据无敏感，但密钥入仓即负债；② 零新服务依赖与账号；③ 公告内容走 git PR 评审，与发版流程天然一体（发布 checklist 加一步「更新 announce.json」）；④ 消除隐私观感与商店审核风险——书签管理器外呼第三方 metrics 式端点是最差观感，拉取自己开源仓库的静态文件则完全透明。raw 域名的 ~5min CDN 缓存对公告场景无影响。
- **CSP/权限**：`connect-src *`（manifest.json:89）+ `<all_urls>` 已覆盖，零 manifest 变更。

### 4.2 数据模型（`docs/announce.json`）

```json
{
  "version": 7,
  "messages": [{
    "id": "v410-whats-new",
    "minVersion": "velvet", "maxVersion": "",
    "channel": "all",
    "once": true,
    "display": "banner",
    "titleKey": "announceV410Title", "textKey": "announceV410Text",
    "textFallback": { "en": "…" },
    "link": { "labelKey": "donationV4GuideLink", "url": "https://github.com/windviki/vBookmarks/blob/master/docs/guide-v4.md" }
  }]
}
```

- 顶层 `version` 单调递增——客户端先 HEAD/条件请求比对版本，未变则不解析正文（实际实现：直接 GET，`If-None-Match` 由 raw CDN 的 ETag 免费支持；本地存 `etag`）。
- 多语言：**i18n key 优先**（随版本打进 `_locales`），`textFallback` 仅 en 兜底——远程文件不承载 43 语种。
- `display`：`banner`（risk-banner 式行内横幅，进 Tab 环）/ `dialog`（复用 AlertDialog）/ `toast`（复用 toastAction）。**默认 banner**；dialog 仅用于重大版本，toast 仅用于轻提示。

### 4.3 客户端（`src/announce.js`，纯逻辑可测）

- 触发：popup/sidepanel 打开时（页面生命周期短，打开即检查）；先读 `storage.local` 缓存 `vbmAnnounce = { ts, etag, data }`，**TTL 6h** 内不联网。
- 拉取：`fetch(url, { headers: { 'If-None-Match': etag }, signal: AbortSignal.timeout(4000) })`；304 → 只刷新 ts；**一切失败静默**（catch 全吞，横幅永不出错）。
- 过滤：`compareVersions` 版本区间 ∩ channel ∩ once+dismissKey 未记录；多条时按数组序取第一条。
- 关闭：写入 dismissKey（once 语义），banner 的 × 进既有 banner 键盘模型（keyboard.js 已有 banner 环位）。
- **隐私开关**：选项页 General 组加 `announceEnabled`（默认开）——「检查更新公告」类开关是此类功能的信任底线；关闭则零联网。
- velvet 之前的三条既有横幅（捐赠卡/风险横幅/history 权限）**不动**，公告层是纯增量。

### 4.4 功能引导 tooltip（原文档「固定设计好的 tooltip」定案）

- 形态：复用 banner 通道的 `display: "tip"`——单行横幅：图标 + 一句文案 + 「试试」动作链接 + ×。
- **频率纪律**（写死进 announce.js）：每个版本号（major.minor）至多展示 1 条 tip；同一用户同时存活的 tip 至多 1 条；全部 once + dismiss 持久化。**违反纪律的 tip 不得合入**——工具型扩展的引导以「不打扰」为第一原则。
- velvet 首发内容：`/next-theme` 与新视觉（与 v410-whats-new 合并为同一条，不叠加）。

### 4.5 发布流程

`AGENTS.md` Release process 增补一步：发版 PR 更新 `docs/announce.json`（version 自增 + 新 message）→ CI 加 schema 校验（`tests/announce.test.js` 里放一份样例数据的断言 + `scripts/i18n.py` 门禁覆盖新 key）。临时通知 = 单独提一个只改 announce.json 的 PR。

---

## 5. 侧边栏进化

### 5.1 E1 独立页（K9：完整应用壳，推翻 ds 的裁剪壳）

**定案**：`pages/standalone.html?view=<dead|dupes|stats>` = **完整应用壳**——保留搜索栏与视图标签条（工作台需要搜索与切换），只隐藏捐赠卡；`body class="standalone-mode"`。

- **独立价值定位**：「清理工作台」——死链/去重/统计三个重数据视图的大屏形态：① 双行行（图标 18/槽 22/间隙 8）在全宽下常开；② 批量操作（选择模式、进度条）不再挤压 400px；③ URL 参数态可分享/可收藏（`?view=dead&filter=blocked`——filter 参数映射 `deadFilter`），从 palette `/open dead` 直达也从书签栏直达。
- **入口**：palette `/open dead|dupes|stats` 命令 + 三个视图工具行右端各加一颗 `OPEN_EXTERNAL_ICON` 小按钮（16px 线稿，tooltip 本地化）。点击 = `chrome.tabs.create({ url: chrome.runtime.getURL('pages/standalone.html?view=…') })`（页面上下文直接调，无需 SW 消息）。
- **守卫**：`popup.js` 在 `standalone-mode` 下跳过尺寸恢复/sidePanel heartbeat/`vbm-panel` port；`package.py` HTML_PAGES 白名单加 `pages/standalone.html`；`tests/fuzzy.test.js` 的 popup/sidepanel 脚本列表 parity 断言扩展到 standalone。
- ds 的「隐藏搜索/标签条」被推翻的理由：隐藏意味着要给每个视图模块加「搜索不存在」的守卫分支（search.js 是全局初始化），完整壳反而零守卫；且工作台没有搜索是自断一臂。

### 5.2 E2 双栏（不进 velvet，明确触发条件）

维持 ds D5。**重启触发条件**（满足其一再排期）：① 独立页上线后收到 ≥3 条「希望树与列表同屏」的用户反馈；② 侧栏宽度中位数数据（可通过 announce 调研或截图分析）显示 ≥480px 成为常态。届时按 `docs/plan-4.0.0/v4task-2.md:313,393` 的 panel 迁移主线实施，不在 velvet 嫁接半成品。

---

## 6. 商店素材自动化（F）

维持 ds N7，细化两点：

- `scripts/screenshots/shots-store.js`：高 DPR（`deviceScaleFactor: 2`）截取关键态 → **合成页拼图**（一个临时 HTML 把多张 `<img>` 按 grid 排版后整页截图，零 canvas 依赖）→ 输出 `assets/store/`。
- 规格：**1400×560**（strip：tree-light / tree-dark / ink / paper / palette / 右键菜单 横向拼）与 **1280×800**（promo：主 popup + 2–4 视图小图 + 菜单，对齐现有 `vBookmarks-v4.png` 版式）。
- 视觉素材必须在 **S3/S4 视觉定稿后**拍摄（切片依赖 S12 排在 S3/S4 后）；ink/paper 两版必须出现——它们是 velvet 的性格展示。
- 产出人工挑选、手动上传商店，不接 WebStore API（现状纪律保留）。

---

## 7. 实施切片与回归门禁

### 7.1 切片顺序（每片独立提交 + 全绿）

| Slice | 内容 | 依赖 |
|---|---|---|
| **S1** | V5 图标：DEFAULT_BOOKMARK_ICON 圆弧折角（K3）+ CLOSE/EMPTY/OPEN_EXTERNAL 常量 + 渲染点替换 | 无 |
| **S2** | V1 几何 token：半径五档 + 间距三档落地，neat.css 机械收敛，契约测试先行 | 无 |
| **S3** | V2 卡片化 + V3 tab 分段重绘（移除 .tab-indicator，view-manager 同步删逻辑） | S2 |
| **S4** | classic 主题（token 覆盖，K2）+ `/next-theme` | S2/S3 |
| **S5** | V7 标记：× 场景着色 + 同现间距微调 + dead × SVG 化 | S1 |
| **S6** | V8 选项页精细化 + V9 最近搜索呼吸空间 | S2 |
| **S7** | V6 左右缘对齐系统（右缘动作槽 + 左缘槽位 token） | S3 |
| **S8** | B1 自定义置顶 + B2 一开一序 | 无 |
| **S9** | B4 `/panel`·`/popup`（SW onMessage）+ B5 `/onlybar`·`/all`（tree-view 热读） | 无 |
| **S10** | E1 独立页（完整壳 + 入口命令/按钮 + package.py） | S9 |
| **S11** | D 公告层（announce.js + docs/announce.json + 选项开关 + 发布流程文档） | 无 |
| **S12** | V3 ink/paper 材质 + V4 状态语言材质层 | S3 |
| **S13** | V10 CSS 解耦（themes/ 搬移 + options.css 引共享 token） | S4/S7/S12 |
| **S14** | C2 多词 AND → C1 字段过滤 token | 无 |
| **S15** | C3 URL 直开 + `/toggle` + `/copy`（含 markdown） | 无 |
| **S16** | F shots-store.js（新视觉定稿后拍摄） | S3/S4/S12 |

> 与 ds 切片表的差异：S4 classic 改为纯 token 依赖；S12 拆出 ink/paper 材质与状态语言（ds 并入 A12 随 S13，k3 认为材质应先于搬移定稿——搬移的是定稿内容，不是半成品）；S16 新增独立片。

### 7.2 回归门禁

- **vitest 全量**（4.0.5 基线 66 文件/2028 例）+ 新增：`row-alignment.test.js`（或并入 list-view-parity）、`announce.test.js`、`theme.test.js` 的五主题 token 完备性/classic 覆盖/无硬编码半径断言、`palette.test.js`（B/C 系列命令）、`background.test.js`（onMessage）、`search.test.js`（token 解析/多词 AND）、`favicon-fallback.test.js`（现状已锁 4.0.5 新策略，不回归）。
- **harness（Docker）**：smoke 零 console 错误、verify-keyboard 全矩阵、verify-scrollbars（卡片裁切后）、`diag-402` 视觉矩阵（radius/对齐/标记同现）+ 新增 classic 态。
- **截图**：shots-themes 补 classic + 卡片对照；shots-store 首产；diag-favicon 重拍（4.0.5 新策略已在 tmp/favicon-lab 验证过 13 图标矩阵，harness 侧补位图留档）。
- **i18n**：新增 key 走 `i18n.py` 全流程（改既有 key 先 [TODO:] 标记再 translate --apply），audit/missing/verify 三门禁零残留。

### 7.3 新增 i18n key（en 基线）

| key | 用途 |
|---|---|
| `themeClassic` | 主题下拉 classic 项 |
| `paletteNextTheme` / `palettePanel` / `palettePopup` / `paletteOnlyBar` / `paletteAll` | 命令名 |
| `paletteCustomsTop` / `paletteHideBuiltin` / `paletteBuiltinOrder` | B1/B2 选项 |
| `paletteOpenDead` / `paletteOpenDupes` / `paletteOpenStats` | E1 命令名 |
| `paletteOpenUrl` / `paletteToggle` / `paletteCopy` | C3 命令名 |
| `searchTokenDeadHint` / `searchTokenStatsHint` | C1 无扫描/无统计数据时的提示行 |
| `announceEnabled` + `announceEnabledHint` | §4.3 隐私开关 |
| `announceV410Title` / `announceV410Text` | velvet 发布公告（发版前打进） |
| `openInNewTabTooltip` | E1 工具行按钮 tooltip |

---

## 8. k3 与 ds 差异对照表（速查）

| 位置 | ds | k3 | 章节 |
|---|---|---|---|
| tab 指示条 | 保留滑动底条 | 移除，分段软填充 | §1.3（K1） |
| classic 实现 | 元素级覆盖表 | token 级覆盖 | §1.4.4（K2） |
| 默认图标折角 | A/B 待选 | 选定圆弧 | §1.6（K3） |
| auto→ink 映射 | 可选增强 | 否决 | §1.4.5（K4） |
| 计算器 | 进 velvet | 否决 | §3.3（K5） |
| `#标签` 语法 | 预留 | 删除 | §3.1（K6） |
| B2 开关数 | 3 个 | 2 个（一开一序） | §2.2（K7） |
| 公告端点 | Upstash + token | 静态 JSON（raw.githubusercontent） | §4.1（K8） |
| 独立页形态 | 裁剪壳 | 完整应用壳 | §5.1（K9） |
| favicon 反色描述 | 均值亮度+饱和度、纯 invert | 极端色占比 + 保色相翻转（4.0.5 已落地） | 文头已落地清单 |
| 实施切片 | S1–S15 | S1–S16（S12 材质独立成slice、F 改 S16） | §7.1 |

---

## 附录：关键代码定位（k3 刷新版）

| 关注点 | 定位 |
|---|---|
| 主题应用 | `popup.js:10`（dataset.theme）；token 块 `neat.css:21-158`（S13 后迁至 `css/themes/`） |
| view-tabs / tab 重绘 | `pages/popup.html:26`、`.tab-indicator` 逻辑在 `view-manager.js`（S3 删除） |
| 卡片化目标 | `#views`（`popup.html:27`）、`neat.css:2131-2137` |
| 状态几何/材质 | hover/selected 规则散布 neat.css 行规则（S12 材质层收口 themes/） |
| 左缘三槽契约 | `neat.css:536-553`；双行槽 `@container(min-width:480px)` 与 `body.panel-mode` 两套（含 4.0.5 的 `#results` 作用域补权） |
| 右缘动作槽 | `.row-btn`（`neat.css` 行尾区）、`.stats-star`、`.keeper-radio` |
| dead/sync 标记 | `neat.css` `.dead-indicator`（已 `inset-inline-end`）、`sync-styles.css`（同左） |
| favicon 反色（4.0.5 定案） | `favicon-fallback.js`（contrastStats 极端色占比 / needsContrast / matchMedia + storage.onChanged 双通道重判）、`neat.css` `.favicon-contrast-invert`（`invert(1) hue-rotate(180deg)`） |
| 命令面板 | `palette.js`（命令表/render/Tab 圈禁）、`palette-commands.js`（ACTION_TYPES/executeCustom） |
| SW open 路径 | `background.js:214-258`（S9 加 onMessage） |
| onlyShowBMBar 热读 | `tree-view.js:98-102`、`neat.js:821` |
| 公告层落点 | `neat.js`（打开时触发 announce.js）、`risk-banner.js`（banner 复用）、`undo.js`（toast 复用） |
| 独立页 | `pages/standalone.html`（新）、`package.py:31-36` 白名单 |
| 搜索 token / 多词 | `search.js`（parseQueryTokens 新层）、`fuzzy-core.js`（rank 分词） |
