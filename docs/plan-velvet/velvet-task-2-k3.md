# velvet-task-2 定稿（k3）—— 4.1.0 基线上的视觉与细节跃升

> **基准**：[`velvet-task-1-final.md`](velvet-task-1-final.md)（唯一设计基准；其引用的 `velvet-task-1.md` / `-ds` / `-k3` / `-glm53` 多份源头不再回看，避免噪音）。
> **代码基线**：**4.1.0 HEAD**（七视图 tree/search/tabgroups/recent/stats/dead/dupes；80 测试套件；en 560 i18n 键；dist 构建管线与 P1/H1–H9 性能改造已落地）。task-1-final 写于 4.0.5 合流状态，本文全部「现状」按 4.1.0 逐条核实刷新（核实日期 2026-08-22）。
> **关联文档**：[`velvet-feat-staging.md`](velvet-feat-staging.md)（暂存区功能版本，**先行独立落地**；本文 §1.14 为其预留视觉契约）。
> **目标体验**：丝滑流畅（动效守时）、迅捷如飞（性能预算）、视觉温润柔和如同丝缎（材质与秩序）。
> **版本号**：velvet 目标版本待定（task-1-final 原定的 4.1.0 已被 tab-groups 版本占用；暂存区功能版暂定 4.2.0、velvet 暂定 4.3.0，以发布时为准）。
>
> **状态标注约定**（全文统一）：
> - ✅ **已落地**（4.0.5→4.1.0 期间完成，本文仅记录现状与残留打磨，不重复排期）
> - 🟡 **有功能、待打磨**（机制已在，细节未到 velvet 标准；本文给出细节方案）
> - ⬜ **未实施**（velvet 排期项）
>
> 本文只做设计，不实施。实施切片与回归门禁见 §7。

---

## 0. 现状盘点（4.0.5 → 4.1.0 审计）

### 0.1 task-1-final 条目落地对照表

| task-1-final 条目 | 状态 | 4.1.0 现状证据 | 剩余工作 |
|---|---|---|---|
| §1.1 三平面 `--vbm-canvas` | ⬜ | body 仍 `background-color: var(--vbm-bg)`（neat.css:164），无 canvas token | 全量实施（§1.1） |
| §1.2 4px 网格 + `design-system.test.js` | ⬜ | 唯一行度量 token 是 `--vbm-row-h: 28px`（neat.css:43）；无契约测试 | 全量实施（§1.2） |
| §1.3 半径阶梯 | ⬜ | 仅 `--vbm-radius: 8px` 一档（neat.css:41） | 全量实施（§1.3） |
| §1.4 排印 token + 全数字 `tabular-nums` | 🟡 | tabular-nums 已覆盖 4 处（neat.css:3531 计数 pill/徽章、:4326 dead 进度、options.css:214/715）；无字号 token | 扩到全数字列 + 建 text token（§1.4） |
| §1.5.1 视图卡片化 | ⬜ | `#view-tabs`/`#views` 无卡片结构（neat.css:2236/:2327） | 全量实施（§1.5.1，含 4.1.0 边界） |
| §1.5.2 tab 分段重绘（移除底条） | ⬜ | `.tab-indicator` 存在且在滑动（neat.css:2317-2325、view-manager.js:321） | 全量实施（§1.5.2） |
| §1.5.3 classic 主题 | ⬜ | 运行时无 classic；主题下拉 5 项（options.html:52） | 全量实施（§1.5.3） |
| §1.6 ink/paper 材质签名 | 🟡 | 两主题已是纯 token 换色块（neat.css:107/:135），无网格/磷光/纸纹/朱砂竖条 | 增量叠加材质层（§1.6） |
| §1.7 状态语言 token 表 | ⬜ | 行态为直角平铺（neat.css:546/:763/:2598） | 全量实施（§1.7，行型清单已扩） |
| §1.8 图标系统（CLOSE/EMPTY/OPEN_EXTERNAL、折角） | 🟡 | icons.js 已有 21 个常量；三个新图标缺；`#search-clear` 为 HTML 内联 SVG（popup.html:9）未归一；dead × 为文字字形（view-dead.js:984） | 增量实施（§1.8） |
| §1.9 左右缘槽位契约 | 🟡 | 右缘对齐已多轮打磨（dead 8px 右缘列 neat.css:4700 等）但全是字面量、无 slot token | token 化 + 契约断言（§1.9） |
| §1.9 × 场景着色（blocked 琥珀） | ✅ | `.dead-indicator.blocked` 已落地（view-dead.js:984、neat.css:4753-4757） | 无（并入契约断言即可） |
| §1.9 标记同现（dead × + sync 点 ≤1px） | ⬜ | 两者各自存在，同现态无断言 | harness 截图回归（§1.9） |
| §1.10 A7 选项页精细化 | 🟡 | 4.0.8 已完成 20 组重组、`.danger` 危险操作统一、头部链接/版本号、存储用量条 | 组卡片化 + 按钮三态 + token 单源化（§1.10） |
| §1.10 A8 最近搜索呼吸空间 | ⬜ | 未动 | 原案数值实施（§1.10） |
| §1.11 CSS 解耦 `css/themes/` | ⬜ | 无 themes/ 目录；**token 副本有两处**：options.css:1 与 favicons.css:1（均带「keep in sync」注释） | 全量实施，范围扩到三份副本（§1.11） |
| §1.12 `/theme` 列表模式 | 🟡 | `/theme` 已是参数化命令：唯一前缀直选 + 用法 Alert（palette.js:284-299），`THEMES` 5 项（:283） | 无参列表模式（§1.12） |
| §2.1 B1 `paletteCustomsTop` | ⬜ | 键不存在 | 实施（§2.2） |
| §2.2 B2 `paletteHideBuiltin`/`paletteBuiltinOrder` | ⬜ | 键不存在 | 实施（§2.3） |
| §2.4 B4 `/panel`·`/popup` | ⬜ | 无此命令 | 实施（§2.4） |
| §2.5 B5 `/onlybar`·`/all` | ⬜ | 无此命令（`onlyShowBMBar` 仍是启动常量 + 4.1.0 已有会话级 `showAllOverride` 先例） | 实施（§2.5） |
| §2.6 `/copy`·`/open-all`·`/sort`·URL 直开 | ⬜ | 均无；omnibox 侧仅 `^https?://` Enter 兜底（background.js:205） | 实施（§2.6） |
| §3.1 C1 搜索 token | ⬜ | 无 `search-tokens.js`，无解析 | 实施（§3.1） |
| §3.2 C2 多词 AND | ⬜ | `rank()` 整串单子序列（fuzzy-core.js:158）；**4.0.8 已加 span penalty**（排名收紧 ✅，属 C 系列质量项） | 实施，回归锁死单词路径（§3.2） |
| §3.3 C3 URL 直开（popup/palette 侧）+ `/copy` | ⬜ | 无 | 实施（§3.3） |
| §4 通知系统 | ✅ | announce.js（raw.githubusercontent 静态 JSON、TTL 6h、ETag、Seen LRU 100、`announceEnabled`、display 三枚举、500 字/10 条上限、转义）+ github-source.js + github-mirrors.js + docs/announce.json + `tests/announce.test.js` schema 校验，全部落地 | 剩两项打磨（§4.2） |
| §5.1 E1 独立大屏页 | ⬜ | 无 standalone.html | 实施（§5.1） |
| §6 F 商店素材自动化 | 🟡 | `shots-store.js` 已提前落地（2026-08-26，feature/webstore-store-assets：1400×560 四主题 strip + 1280×800 promo 拼图，Docker 全绿）；listing 元信息「取回/草稿」随批落地（publish.js `listing`/`listing-draft`——官方 V2 REST 无 listing 端点，快照+草稿形态） | 剩视觉定稿后重拍（§6.3） |

### 0.2 4.0.8/4.1.0 超出 task-1-final 的增量（须纳入 velvet 视觉覆盖）

1. **第七视图 tabgroups**（4.1.0）：窗口 section 行、组头（折叠/色边/计数 pill）、tab 行（pin/sleep/状态徽章）、closed 区、四个专用菜单、选择模式双 rung 工具条、组色风格 `tabGroupsColorStyle`（off/edge/line）——task-1-final 时代不存在的最大行型增量，velvet 状态语言/槽位契约必须覆盖（§1.13）。
2. **favicon 补全 + 反色 + 画廊页**（4.0.8/4.0.6）：行内 favicon 热替换、`.favicon-pop` 动画、`pages/favicons.html` 独立页（自己的 token 副本）。
3. **视图 Hide/Disable**（4.0.8）：`show*View`/`disable*View` 键、view-tab 右键菜单、`Alt+1…9` 紧凑重编号——velvet 卡片化后 tab 条的显隐态（含 `no-view-tabs` 收起）要有完整契约。
4. **`/lang` + i18n-live**（4.0.8）、**`/version` + VersionDialog**（4.0.8）、**存储用量条 + 选项页 20 组重组**（4.0.8）。
5. **dist 构建管线**（4.1.0）：`scripts/runtime-files.json` 单一事实源 + build.mjs 六项自检 + 三段冒烟门禁——velvet 的 CSS 拆分（§1.11）与 standalone 页（§5.1）都必须进这套硬触点，task-1-final 时代无此约束。
6. **性能 P1/H1–H9**（4.1.0）：见 §6.1，velvet 的性能纪律在其上延续。
7. **备份携带图标缓存**（4.0.8）、**SECRET_ACTIONS** 内部调试通道（非用户面，不纳入 velvet 范围）。

### 0.3 随 4.1.0 现状修订的原定稿细节

| 原定稿表述 | 4.1.0 现实 | 修订 |
|---|---|---|
| 6 个视图 tab（67px/个） | **7 个 tab**（+tabgroups），隐藏/禁用后数量可变 | 分段填充的几何与容器查询标签显隐机制照旧；S3 门禁矩阵按七 tab 与紧凑态断言 |
| 卡片化未提 tab 条收起态 | `showViewTabs` 关或只剩 tree/search 可见时整条 tab 条收起（`body.no-view-tabs`） | 新增契约：`no-view-tabs` 下卡片头消失，`#views` 直接承担顶圆角 + 顶边框（§1.5.1） |
| `#views` 六 section | 七 section（4.1.0），staging 落地后 `recent` 内部改双区域 | 结构不变；staging 行型进状态语言清单（§1.14） |
| `/theme` 列表 6 行（含 classic） | THEMES 现 5 项 | classic 落地后数组 +1，列表 6 行（§1.12） |
| E1 `?view=` 域 6 视图 | 七视图；staging 落地后 `recent` = 暂存区 | 域扩到七视图；入口按钮仍只放 dead/dupes/stats（+staging 落地后加暂存区）；tabgroups 不加入口按钮（实时窗口管理，大屏价值低）（§5.1） |
| en 基线 388 键 | **560 键** | §7.3 只列 velvet 净增 |
| 测试基线 66 套件/2047 用例 | **80 套件**（用例数以实施时 `npm run test:run` 输出为准） | §7.2 |
| CSS 拆分只改三页 link | dist 管线存在 | §1.11 触点加 `runtime-files.json` + build 自检 + 三段冒烟 |
| S12 公告层全量实施 | 已落地 | S12 缩为打磨片（tip 频率纪律 + 发布流程一行） |
| C2「单词路径逐字节回归锁死」 | 4.0.8 已加 span penalty | 锁死基线 = 含 span penalty 的现行排序 |
| B5「`onlyShowBMBar` 启动常量改运行时读取」 | 4.1.0 已有会话级 `showAllOverride`（revealInTree 的 show-all 提示在用） | 命令复用同一 override 通道，不再新造（§2.5） |

### 0.4 范围红黑榜（velvet-task-2 版）

**进 velvet**：task-1-final 全部 ⬜/🟡 条目（§0.1 表中「剩余工作」列非空的行）+ §1.13 tabgroups 视觉收敛 + §1.14 staging 视觉契约 + §6.2 性能纪律。
**不进 velvet（维持原裁决）**：B3 macro/引用、C4 中成本、E2 双栏、`chrome.theme` 跟随、计算器、`/toggle`、`visited:N`、`#标签`、`/next-theme`、顶部第三按钮、auto→ink 映射、vim 化、弧形 tab、`/export`、`/pin-tab`、`/duplicate`、`/sync-refresh`。**新增维持不进**：P2 渲染层（content-visibility/分片渲染/虚拟滚动——4.1.0 明确「未达启动判据」，velvet 不借机启动，§6.2）、staging 的功能实现（属功能版本，velvet 只管其视觉契约）。

---

## 1. 视觉体系（V 系列，修订定稿）

### 1.0 语言总纲：Calm Instrument + 丝缎体验三支柱

task-1-final 的「克制的仪器感」三条原则（一个几何 themed 材质 / 层级靠表面不靠阴影 / 动效守时）**全文沿用**。velvet-task-2 把体验目标显式落成三根支柱，每片实施按此自检：

1. **温润柔和如同丝缎 = 材质**。三平面色阶、发丝边框、主题签名材质（§1.6）、语义色纪律（danger/warning/success 只做语义）。温润来自「表面有呼吸、边界不刺眼」，不是加装饰。
2. **丝滑流畅 = 动效守时**。两档时长 `--vbm-dur-1: 120ms`（hover/按下/状态切换）、`--vbm-dur-2: 180ms`（浮层进出、视图切换），统一缓动 `--vbm-ease: cubic-bezier(0.2, 0, 0, 1)`；只动 `opacity`/`transform`/背景色；`prefers-reduced-motion` 一条全局通招收口（现有散点规则合并）。动效只做状态引导，不做位移编排。
3. **迅捷如飞 = 性能预算**。4.1.0 的工程成果（§6.1）是基线；velvet 每片实施后 perf 探针中位数回退 >5% 即整片回退（§6.2）。视觉改版全部是 token/背景/边框层工作，零几何回流是硬约束。

### 1.1 三平面深度模型（canvas / surface / overlay）⬜

**定稿沿用** task-1-final（canvas `--vbm-canvas` 窗体 / surface `--vbm-bg` 行面 + `--vbm-bg-elev` 浮层 / overlay 两档投影 `--vbm-elev-1/2`），五主题色值表不变。4.1.0 迁移要点刷新：

- 现状：`body { background-color: var(--vbm-bg) }`（neat.css:164），无 canvas 分层；`--vbm-bg` 一身兼「页面底色 + 行面」两职。
- 迁移：body 与大面积留白改 `--vbm-canvas`；逐个审计把 `--vbm-bg` 当页面底色用的规则改指 canvas；`--vbm-bg` 语义收成「行所在表面」（标记晕环已引用它，卡片化后自动正确）。
- dark 卡片面调亮半档（`--vbm-bg: #222428`，elev 保持 `#26282c`）时，连带核对 dark 下引用 `--vbm-bg` 的非列表组件（横幅、risk-banner、whats-new/announce/donation 三条横幅、undo toast）变色是否符合预期。
- 投影只留真浮层（菜单/对话框/palette/toast/dropdown listbox）；列表内部零阴影。散写 `box-shadow` 收敛进 `--vbm-elev-1`（`0 2px 8px`）/`--vbm-elev-2`（`0 8px 24px`）两档，晕环与纯装饰类不动。
- classic canvas = surface = `#ffffff`（平面坍缩为一张纸，即 v3 视觉）。
- 滚动条 thumb 不变。

### 1.2 4px 基准网格 + 间距 token ⬜

- 一切间距、槽位、行高、内边距取 `4px × n`。
- **例外登记制**（明文豁免清单，随清理减表）：1px 边线/分隔线；2px 指示条/焦点环/环偏移/行内缩等光学微调；1.5px 图标描边；dnd 插入线 3px；双行行图标 18px/槽 22px（槽 = 图标 + 4px）；sync 点 6px / dead × 10px；`--vbm-shell: 6px`（弹窗外缘留白实测甜点）。
- 间距 token：`--vbm-space-1: 4px`、`--vbm-space-2: 8px`、`--vbm-space-3: 12px`、`--vbm-shell: 6px`（standalone 局部覆写 12px，§5.1）。
- **契约测试**：新建 `tests/design-system.test.js` 扫 neat.css 的 `padding/margin/gap/height/width` 声明值，白名单与例外之外非 4 倍数即失败；存量违例先登记豁免表，随清理减表（豁免表本身进测试文件，只许减不许增——增需 PR 明说理由）。

### 1.3 半径阶梯 + 同心圆角律 ⬜

```css
--vbm-radius-xs: 2px;     /* 状态指示条、dnd 线、徽标内衬 */
--vbm-radius-sm: 4px;     /* 行内控件：row-btn、seg、chip、行 hover/selected 背板 */
--vbm-radius: 8px;        /* 标准控件：输入框、按钮、菜单、对话框、下拉 */
--vbm-radius-lg: 12px;    /* 容器卡片：视图卡 */
--vbm-radius-pill: 999px; /* 计数药丸、圆钮 */
```

- **同心律**：嵌套圆角满足 `内半径 = 外半径 − 内边距`（视图卡 lg 12 − 卡内 4px = 控件 8 ✓）。写进契约，新增嵌套结构时校验。
- **主题整体覆写**：light/dark 用默认；ink 覆写 `--vbm-radius-lg: 8px`；paper 覆写 `--vbm-radius-lg: 4px; --vbm-radius: 4px`；classic 除 pill 外归零（pill 是圆形徽标，不属圆角语言）。主题文件只改 5 个变量，零逐元素覆盖。
- 收敛映射（现存硬编码 → token）：`6px`（横幅/小面板）→ 按角色 `--vbm-radius`/`--vbm-radius-sm`；`3px` → `--vbm-radius-sm`；`4px`（row-btn/chips）→ `--vbm-radius-sm`；`7px`（tab-badge）→ `--vbm-radius-pill`；`2px`（dnd）→ `--vbm-radius-xs`；`50%` 圆形保留。收敛后契约断言无裸 `border-radius: 2/3/6/7px`。

### 1.4 排印与数字 🟡

- 字号两档 token：`--vbm-text-sm: 11px`（meta/徽标）、`--vbm-text-md: 12px`（历史头/工具栏/次级）；正文沿用 `font: menu`（~13px）。不引入更多档位。
- **一切数字 `font-variant-numeric: tabular-nums`**：现状已覆盖 4 处（计数 pill/徽章、dead 进度、options 两处），velvet 扩到 `.tab-badge`/`.row-badge`/`.history-meta`/`.history-time`/相对时间/扫描计数等全部数字列；ink 的「等宽数字」签名由此升格为全局纪律（ink 主题块内的既有声明在扩展后去重）。
- 标题省略号维持 `text-overflow: ellipsis`（滚动条契约一部分，不可动）。

### 1.5 表面卡片化 + tab 重绘 ⬜

#### 1.5.1 视图卡片化（4.1.0 适配版）

结构（CSS-only，无 DOM 改动）：

```css
#view-tabs, #views { background: var(--vbm-bg); }
#view-tabs {
    margin: 0 var(--vbm-shell);
    border: 1px solid var(--vbm-border);
    border-bottom: 0;
    border-radius: var(--vbm-radius-lg) var(--vbm-radius-lg) 0 0;
}
#views {
    margin: 0 var(--vbm-shell) var(--vbm-shell);
    border: 1px solid var(--vbm-border);
    border-radius: 0 0 var(--vbm-radius-lg) var(--vbm-radius-lg);
    overflow: hidden;
    flex: 1; min-height: 0;
}
/* 4.1.0 新增边界：tab 条收起时 #views 独立成卡 */
body.no-view-tabs #views {
    border-radius: var(--vbm-radius-lg);
    margin-top: 0; /* 卡片头缺席时顶边距由 #search 底距节奏承担 */
}
```

- 两个元素**焊成一张卡**：tab 条是卡片头，视图区是卡片身；头/身分隔由 `#views` 自身顶边框承担。
- **`no-view-tabs` 边界（4.1.0 新增契约）**：tab 条隐藏（`showViewTabs` 关，或只剩 tree/search 可见时整条收起）时卡片头缺席，`#views` 直接承担完整圆角与四边边框——一条规则覆盖，smoke 加对应截图断言。
- `#tree`/`#results`/各列表容器背景改 `transparent`（行面由卡片提供），移除 inset shadow。
- **dark 卡片面**：`--vbm-bg` 调至 `#222428`；elev 保持 `#26282c`（浮层比卡片亮半档）。ink/paper 现值分离度已足。
- **滚动条**：卡片 `overflow:hidden` + 列表自身 `overflow-y:auto` 维持滚动条契约；`verify-scrollbars.js` 全矩阵重跑为硬门。
- 卡片内行的呼吸：列表容器上下 `var(--vbm-space-1)` + 左右各 2px 内缩（光学呼吸，§1.2 登记例外）——行不贴卡片边缘，「卡片感」成立的关键细节。
- 行 hover/selected **圆角背板**（`--vbm-radius-sm`、行盒全宽、零回流）：圆角只画在背板背景上，行几何不动；背板随行内缩。首末行贴卡角由卡片 `overflow:hidden` 光学衔接（同心律豁免）。
- panel-mode 与 standalone 同构（panel 无外缘 shell 差异、standalone shell 12px 覆写）。

#### 1.5.2 tab 条重绘（焊接卡头 + 分段式软填充，移除滑动底条）⬜

- `.view-tab`：几何不变（`flex:1`、容器查询标签显隐照旧——**七 tab 下该机制已是主力**，velvet 不动它），高度维持 32px；填充上下各内缩 3px（`border-radius: var(--vbm-radius)`），`transition: background-color var(--vbm-dur-1) var(--vbm-ease), color …`。
- hover：`background: var(--vbm-bg-hover)`。
- active（`aria-selected="true"`）：`background: color-mix(in srgb, var(--vbm-accent) 12%, transparent); color: var(--vbm-accent);`，**字重不加粗**（避免宽度抖动导致七个 tab 互相推移）。
- **移除 `.tab-indicator`**：① 物理冲突——焊接卡后底条 `bottom:-1px` 压在卡片上边框；② 信号冗余；③ 窄 tab 上 2px 滑动几乎不可感知。`view-manager.js` 的 indicator 创建/定位/滑动逻辑（:248/:321）同步删除，`aria-selected` 语义不变。
- badge 药丸在 active 填充上保持 `--vbm-danger` 不变（12% accent 底上对比充足，theme.test.js 的 AA 对比断言覆盖）。

#### 1.5.3 classic 主题（token 级覆盖）⬜

classic 是 v3.x 方形时代的致敬，只做浅色。

```css
body[data-theme="classic"] {
    /* 几何归零：v3 是方形世界（pill 保留默认 999px——圆形徽标不属圆角语言） */
    --vbm-radius-xs: 0; --vbm-radius-sm: 2px; --vbm-radius: 2px;
    --vbm-radius-lg: 0;
    /* 材质：v3 的强灰边、白底、无色阶 */
    --vbm-canvas: #ffffff;
    --vbm-bg-hover: #e8f0fe;        /* v3 记忆色 */
}
/* 贯穿式搜索栏：通栏、贴窗口左右缘 */
body[data-theme="classic"] #search { margin: 0; }
/* 卡片拍平：去外框，只留头/身一条分隔线 */
body[data-theme="classic"] #view-tabs { margin: 0; border-radius: 0; border-color: transparent; }
body[data-theme="classic"] #views { margin: 0; border-radius: 0; border-color: transparent; border-top-color: var(--vbm-border); }
```

- 因 §1.3 分层 token 先行落地，「方形化」在 token 层一处生效、全组件跟随。
- tab 沿用全局分段语言，随半径归零呈方形填充（v3 式下划线指示条不复活）。
- 浮动两按钮（`#quick-add-btn`/`#tool-btn`）：方形 + 透明底 + hover `--vbm-bg-hover`，与搜索框同高贴合成组。
- classic 不参与 auto 映射（auto 的承诺 = 可预测的跟随系统）；在 `/theme` 列表中正常列出、可 `/theme classic` 直选。
- 落地触点：options 主题下拉加项（i18n `themeClassic`）；`theme.test.js` 的主题 i18n 契约扩到 6 主题；popup.js 的 `dataset.theme` 直写无白名单，无需改。
- 与「一键恢复经典界面」开关**正交**：一个管几何/材质，一个管功能集；两开 = 完整 v3 体验。

### 1.6 主题材质（每主题独立性格）🟡

4.1.0 现状：ink/paper 已是独立 token 换色块，但无材质签名。velvet 在其上叠加材质层（纯增量，不换色值）：

#### 1.6.1 light / dark ——「Modern」

全量采用新几何。light 保持干净表面；dark 卡片/字段边框用 `rgba(255,255,255,.10)` 发丝线，**禁用投影**——暗主题深度来自色阶（dark 块内 `--vbm-elev-*` 覆写为 `none`）。

#### 1.6.2 ink ——「仪器 / Instrument」

两个签名细节：
1. **磷光晕**：焦点环/active tab/选中行带极轻外发光——`box-shadow: 0 0 0 1px color-mix(in srgb, var(--vbm-accent) 35%, transparent), 0 0 8px color-mix(in srgb, var(--vbm-accent) 22%, transparent)`。面积克制，像示波器辉光而非霓虹。
2. **仪器网格底纹**：body 背景叠 CSS 生成 1px 网格（双向 `repeating-linear-gradient`，24px 间距，accent 4%）。纯 CSS 零位图，只限 canvas 平面（不进卡片与字段内部）。

几何上 ink 卡片半径降一档（`--vbm-radius-lg` → 8px）。

#### 1.6.3 paper ——「纸器 / Stationery」

三个签名细节：
1. **纸纹**：body 叠 CSS 生成极轻颗粒（两层 `repeating-conic-gradient`，2–3% alpha 暖灰），只限 canvas 平面。
2. **纸张卡片**：`#views` = `--vbm-bg-elev #fffdf7` + 顶部受光 + 暖色发丝边框；半径随阶梯覆写收 4px。
3. **朱砂竖条选中**：选中行 = 左缘 2px 朱砂竖条 + 极浅暖色 wash（`color-mix(in srgb, var(--vbm-accent) 7%, transparent)`）。**否决 paper 渐变**（印刷油墨的平面性）。

#### 1.6.4 auto

映射逻辑不变（亮→`:root`、暗→dark）。否决「auto 深色映射 ink」。

### 1.7 状态语言（hover / selected / focus / flash / dnd）⬜

**几何全主题统一**：卡片内行状态 = 行盒全宽圆角背板（`--vbm-radius-sm`；列表容器整体内缩 2px，背板不贴卡片边）；非卡片场景（菜单项、palette 行、dropdown 选项）直角平铺。焦点环 `2px solid var(--vbm-focus-ring)`、`outline-offset: -2px`，环随控件半径。

**材质按主题**（token 表，可断言）：

| 状态 | light / dark | ink | paper |
|---|---|---|---|
| hover | `--vbm-bg-hover` | 同左 + 0.5 档磷光叠底 | 暖灰 `--vbm-bg-hover` |
| selected | `--vbm-bg-selected` + `--vbm-fg-selected` | 深蓝底 + 磷光细边 | 朱砂左竖条 2px + 7% 暖 wash |
| focus-visible | focus-ring 2px | focus-ring + 磷光晕 | focus-ring（暖） |
| flash | `--vbm-flash` | 同左 | 同左 |
| dnd 插入线 | `--vbm-fg` 3px | accent 3px + 磷光晕 | `--vbm-fg` 3px 墨线 |
| dnd 文件夹高亮 | `--vbm-flash` 底 + accent 边，`--vbm-radius-xs` | 同左 + 磷光 | 暖 flash 底 + 朱砂边 |

classic 状态色取 v3 记忆值（hover `#e8f0fe`、selected `#d3e3fd`），几何随半径阶梯归零呈直角背板。

**4.1.0 行型全覆盖清单**（状态语言的施加面，task-1-final 时代只有六视图行型）：树行 / 搜索结果行 / link-folder 行 / 搜索历史行 / recent 行 / stats 行（含 hist 行）/ dead 行（含已标注残留区）/ dupes 组头 + 成员行 / **tabgroups 窗口 section 行 + 组头 + tab 行 + closed 行（4.1.0 新增，§1.13）** / **staging 组头 + 成员行 + 散行（staging 版本落地后，§1.14）** / folder picker 行 / 菜单项 / palette 行 / dropdown 选项。`.sel` 选择态（复选框 `::before` + 底）同为状态语言成员，随表定材质。

死链「开始扫描」药丸 hover 从 `brightness(1.08)` 改 `--vbm-accent-hover` token 驱动。

**语义色纪律**：`--vbm-danger`/`--vbm-warning`/`--vbm-success` 只用于语义，永远不做装饰色（契约测试维持）。

**实施约束**：状态规则几何部分留 neat.css（共享），材质部分随 §1.11 解耦进 `css/themes/<theme>.css`。

### 1.8 图标系统 🟡

线稿语言纪律（写入契约）：16px 网格、1.5px stroke、`stroke="currentColor"`、圆角 linecap/linejoin。

4.1.0 现状：icons.js 21 个常量（含七视图 `VIEW_ICONS`、tab-groups 的 PIN/SLEEP/ACTIVATE 等）。velvet 增量：

1. **A3 默认书签图标折角**：右上折角改**圆弧过渡**（`A` 弧替代直角折线，与 radius-sm 同源），保持 16px 网格 / 1.5px 描边。落地时与现版并排截图（diag-favicon）二选一，以「1.5px 网格上无半像素糊」为准绳。
2. **A4 克制清单**：
   - 新增 `CLOSE_ICON`（统一 `#search-clear` 的内联 ×（popup.html:9 / sidepanel.html:10 收进 icons.js 注入）与 dead × 字形——**dead × 从文字字形改 SVG**：10px 圆章内嵌 16px viewBox 缩放，并排截图验证描边不发糊；`.dead-indicator` 圆章几何不变）；
   - 新增 `EMPTY_ICON`（空态行首 16px muted）：空文件夹/无结果/未扫描/无重复四类空态统一为「16px muted 图标 + 一行 muted 文案」模板，staging 空态（落地后）直接套用；
   - 新增 `OPEN_EXTERNAL_ICON`（E1 独立页入口按钮，§5.1）；
   - 横幅关闭 × 统一 `CLOSE_ICON`（donation/whats-new/announce/risk-banner 的 × 现状各自内联，一并归一）；
   - 菜单项图标维持克制（只给 `open-in-new-group`/`save-session` 配 icon 的原案**降级为不做**——4.1.0 菜单已全部稳定为文字项，加图标是净增视觉噪音，与本节「克制」自相矛盾；此调整为 task-2 裁决）。
3. 图标描边/网格一致性进 `tests/theme.test.js`（扫描 icons.js 常量：16 viewBox、1.5 stroke、currentColor）。

### 1.9 对齐系统与标记系统 🟡

**左缘槽位契约（token 化）**：`--vbm-slot-guide: 16px`、`--vbm-slot-icon: 20px`（双行 22px）、`--vbm-gap-icon: 4px`（双行 8px）、控制件 gutter `--vbm-gutter: 8px`。现状：六处行模板各自写字面量（值已对），velvet 收进 token 并让 **tabgroups 行型**（窗口行/组头/tab 行）与未来的 **staging 行型**（组头/成员/散行）一并引用。

**右缘动作槽（语义化 + 精确值）**：`--vbm-slot-action: 24px`（20px 按钮 + 4px 距）；视图内不变量「所有行右缘预留同一倍数的槽」：现状审计——`#dead-list` 2×（48px，neat.css:4700 的 8px 右缘列规则已是事实槽）、`#dupes-list` 1×、`#stats-list` 1×、`.search-history-row` 1×、**tabgroups 行 1×（`.row-btn.always-on` 恒显按钮同槽，4.1.0 新增纳入）**、**staging 行 1×（上箭头/fav 星标同槽，§1.14）**、`#tree`/`#results` 0。hover 揭示沿用 `visibility`，槽恒占零回流。**否决「hover 动态左移常显按钮」**（维持原裁决：槽恒占是根治）。诊断口径：harness 对每视图取「有/无动作行」断言内容右缘差 ≤1px、hover 前后 rect 不变。

**标记同现（A5）**：dead ×（10px 圆，`top:-4px`，`inset-inline-end`）与 sync 点（6px，右下）重叠区 ≤1px。同现态截图回归进 harness（4.1.0 两者各自存在，同现契约未断言——本项为契约补全）。

**× 场景着色（D1）**：✅ **已落地**（`deadLastScan.results[id]?.status === 'blocked'` → `.dead-indicator.blocked` 琥珀 `--vbm-warning`，view-dead.js:984 + neat.css:4753）。velvet 仅把该行为写进契约测试防回退。

### 1.10 选项页与最近搜索 🟡

**A7 选项页（4.0.8 已重组后的 velvet 增量）**：4.0.8 已完成 20 组重组、`.danger` 危险操作统一、头部链接 + 版本号、存储用量条。velvet 增量只剩三件：① **组卡片化**——组卡 `--vbm-bg` 底（options 页背景随 §1.1 改 canvas 后组卡自然浮起）+ `--vbm-radius` 圆角 + 组标题字重提升；② **按钮三态**（hover/focus-visible/active 统一规则，现状逐按钮散写）；③ 主题下拉加 classic（§1.5.3）+ options.css token 块随 §1.11 单源化（删除「keep in sync」副本）。

**A8 最近搜索呼吸空间**（纯 CSS，数值全部入网 §1.2）：`#search` 底距 → `--vbm-space-2`（8px），水平 margin 收敛 `--vbm-shell`；历史区顶 padding 3px → 4px；头行 `2px 8px` → `4px 8px`；查询词与结果数 gap `--vbm-space-1`；行内 meta/time 间距维持 8px（10px 破网）。

### 1.11 CSS 架构解耦 ⬜

```
css/
  neat.css            # 通用结构 + 几何（布局、行契约、状态形状、动画）
  options.css         # 结构（token 副本块删除，引共享 token 源）
  favicons.css        # 结构（同上——4.1.0 审计发现它也是 token 副本携带者）
  sync-styles.css     # 不变
  themes/
    light.css         # :root token（light 即默认）+ auto 亮映射
    dark.css          # dark token + auto 暗映射（@media 块随迁）
    auto.css          # @media (prefers-color-scheme: dark) 下 auto→dark 映射
    ink.css           # ink token + 磷光/网格/仪器材质
    paper.css         # paper token + 纸纹/纸卡/朱砂材质
    classic.css       # classic token 覆盖 + 通栏结构
```

- 加载顺序：neat.css → light/dark/auto → ink/paper/classic（后加载者只含 token 与材质，特异性平级靠顺序取胜）；popup.html/sidepanel.html/options.html/favicons.html 四页同步改 link 列表。**删除全部「keep in sync」注释**——注释本身就是债的自白。
- **4.1.0 新增硬触点**：六个主题文件进 `scripts/runtime-files.json` 的 CSS 清单（dist 构建单一事实源）；build.mjs 的构建自检覆盖 link 存在性；发版前三段冒烟（source/dist/dist full）自动验证 dist 树内主题加载零 404。
- 契约测试：`theme.test.js` 断言①半径/spacing 无硬编码残留；②token 完备性——light/dark/ink/paper/classic 五份材质文件定义同一 token 清单（auto.css 只做映射）；③classic 覆盖存在。`scrollbar-contract.test.js` 更新卡片裁切断言。
- **搬移纪律**：先加文件与 link、再逐块搬移、每步全量 vitest + smoke；搬移期不改任何视觉值（纯位移 diff 可审）。**解耦放视觉定稿后一次性做**（边改边搬是双倍维护）。

### 1.12 主题切换：`/theme` 列表模式 🟡

4.1.0 现状：`/theme` = 唯一前缀直选（`themeFromRest`，palette.js:284-293），空参/歧义/未知 → 用法 AlertDialog。velvet 定稿：

- `/theme` **无参 = 主题列表模式**：结果区渲染 6 行主题（auto/light/dark/ink/paper/**classic**——classic 落地后 THEMES 数组 5→6），当前主题行带 ✓ 与 accent，Enter 应用并 keepOpen（应用即改 `body[data-theme]`，面板未关，视觉即时反馈即预览）；`/theme <名>` 前缀直选照旧（keepOpen=false 维持）。
- 裸 `/theme` 的旧行为（用法 Alert）由列表模式取代。i18n `paletteThemeCurrent`（「当前」）。
- `/next-theme` 不实现（维持原裁决）。

### 1.13 第七视图（tabgroups）视觉收敛（velvet-task-2 新增节）

tabgroups（4.1.0）是 task-1-final 时代不存在的最大行型增量，velvet 必须把它收进同一套语言而不是让它自成一派：

- **行型进状态语言**：窗口 section 行、组头、tab 行、closed 行全部按 §1.7 的卡片内圆角背板 + 主题材质表执行；`.sel` 选择态复选框语言沿用。
- **组色表达收敛**：`tabGroupsColorStyle` 的 edge/line 两种风格在卡片化后与新几何对齐（edge = 组头左缘 2px 色条 → 随半径阶梯收 `--vbm-radius-xs`；line = 组头下连接线）；Chrome 九色 palette 不变（那是浏览器的颜色语言），我们的承载几何统一。
- **计数 pill / 状态徽章**：`count-pill` 已在 tabular-nums 覆盖内（neat.css:3531）；pin/discarded/sleep 徽章按 `--vbm-text-sm` 与 muted 纪律。
- **右缘槽**：tab 行/组头的 `.row-btn`（含 `.always-on` 恒显）纳入 §1.9 的 1× 槽位不变量。
- **折叠箭头**：组头折叠与树文件夹同一箭头模型（CHEVRON_ICON 旋转），几何一致。
- 本视图无独立「velvet 改造片」，随 S3/S4/S6 切片一并收敛并截图断言（shots-themes 补 tabgroups 全状态行）。

### 1.14 暂存区视觉契约（velvet-task-2 新增节，衔接 velvet-feat-staging.md）

staging 功能版本**先行落地**（视觉沿用 4.1.0 现行语言，不等待 velvet）；velvet 落地时其新元素按本契约收敛，DOM/类名结构不变（视觉改版是 CSS/token 层工作）：

- **双区域**：`#staging-list` 单滚动容器在卡片内；`#recent-head` 区域头按「历史区头行」同款（`--vbm-text-md` + muted + 4px 网格），折叠箭头 = CHEVRON_ICON 旋转模型。
- **组头**（未收藏桶/用户组/文件夹组/tab 组）：与 dupes 组头、tabgroups 组头**同一语言**——行高、折叠箭头、计数 pill、`.sel` 三态、hover 背板全部复用；半选态（indeterminate）复选框沿用既有绘制。
- **星标行**：`fav` 实心星（STAR_ICON_FILLED 已有）`.row-btn` 恒显，与 dead ⚑ `.marked` 的常驻可见先例一致；星标色 = `--vbm-accent`（不做黄色特例——语义色纪律外，accent 即「本工具内的强调」）。
- **选择工具条**：双 rung 图标 `.vbm-toolbar`（tabgroups 选择条先例），图标按钮 title/aria 齐全，rung 进 Tab 环与箭头链（4.0.8 既有机制）。
- **文件夹选择器**：`BookmarkFolderPickDialog` 是 body-class 对话框，按 §1.1 的 overlay 平面（`--vbm-bg-elev` + `--vbm-elev-2`）与 §1.3 半径（`--vbm-radius`）执行；其扁平缩进列表行按「非卡片场景直角平铺」的菜单项状态语言。
- **空态**：staging 空态直接套用 §1.8 的 EMPTY_ICON 统一模板。
- 契约落点：shots-themes 补 staging 全状态行（组头折叠/星标/选择态/双区域）；`verify-keyboard.js` 补双区域行步行与选择模式断言（staging 版本落地时先进功能门禁，velvet 时补视觉断言）。

---

## 2. 命令面板（B 系列重审）

### 2.1 已落地盘点（✅，不重复排期）

4.1.0 内置命令表 20 条（palette.js:369-399）：`/add` `/new` `/folder` `/session` `/tree` `/search` `/tabgroups` `/recent` `/stats` `/dead` `/dupes` `/theme` `/dark` `/light` `/ink` `/paper` `/tabs` `/version` `/lang` `/options`。其中 `/version`（元数据卡 + JSON 复制）、`/lang`（i18n-live）、`/tabgroups` 是 4.0.8/4.1.0 超出 task-1-final 的增量。行为一致性（Tab 两停圈禁、`<mark>` 高亮、aliases 校验、stale `.active` 守卫、隐藏/禁用视图的命令可用性）全部已在。velvet 新增命令必须走 `palette-commands.js` 既有注册路径（命令表 + i18n + 测试三件套），不得旁路。

### 2.2 B1 自定义命令置顶 ⬜

`paletteCustomsTop`（默认关）。开：自定义区插到内置区之前；slash unique-prefix 优先级不变（`/ink` 仍命中内置）。

### 2.3 B2 隐藏内置 + 使用排序 ⬜

- `paletteHideBuiltin`（默认关）：开则 `render()` 过滤内置命令区——只显示自定义命令 + 书签结果 + 桥接行。**精确语义**：隐藏的是内置命令，书签命中不是命令，始终保留。
- `paletteBuiltinOrder: 'table' | 'usage'`（默认 table）：usage 时内置区按 `paletteBuiltinUses`（storage.local，`{cmd: count}`，fn 执行时 +1，200ms 节流写盘）降序。
- **不搞 Top3 开关**（与 usage 排序语义重叠）。

### 2.4 B4 `/panel` · `/popup` ⬜

- `background.js` 新增 `chrome.runtime.onMessage`：`{type:'vbm-open-sidepanel'}` / `{type:'vbm-open-popup'}`，复用现有 open 路径。
- `/panel` 语义 = **toggle**（对齐快捷键）；`/popup` = 收侧栏回弹窗；**弹窗内执行 `/popup` 为 no-op + toast「已在弹窗中」**（i18n `paletteAlreadyPopup`——显式 no-op 优于静默失败）；standalone 页里执行 `/popup` = 直接 `openPopup`（无面板可收）。
- `chrome.action.openPopup` 需 Chrome 127+，低版本回退 `?popup=1` 窗口。keepOpen 均 false。

### 2.5 B5 `/onlybar` · `/all` ⬜

- 4.1.0 修订：`tree-view.js` 已有会话级 `showAllOverride`（revealInTree 的「show all and reveal」提示在用）——**命令直接复用该 override 通道**，把 override 的读路径从「仅 revealInTree」放宽为「树过滤判定时读取」；`onlyShowBMBar` 设置本体不被命令改写（命令描述文案注明「会话级，不改设置」）。
- 执行后 `undo.toastAction` 轻反馈当前模式。

### 2.6 `/copy` · `/open-all` · `/sort` · URL 直开 ⬜

| 项 | 定案细节 |
|---|---|
| `/copy title\|url\|path\|markdown` | 作用于当前聚焦行（树/结果/列表行统一经 `rowFocusTarget` 契约取行）；无聚焦行时 disabled 态说明；`markdown` 产出 `[title](url)`；`clipboardWrite` 权限已有 |
| `/open-all` | 复用 `actions.openBookmarks`（含 10 项确认阈值） |
| `/sort` | 打开当前聚焦文件夹的排序对话框，入口已有 |
| URL 直开 | 平铺查询命中 `^https?://\S+$` 或裸域名形态（含 `.` 且无空格）→ 首位「打开 URL」行（earth 图标），Enter 直开；URL 行置顶、书签命中照常列出；`javascript:`/`data:` 形态不触发。注意 omnibox 侧已有 `^https?://` Enter 兜底（background.js:205，4.1.0 #11），本项补的是 popup/palette 侧，两侧行为各自独立不冲突 |

### 2.7 维持不进

B3 macro/引用、C4 中成本（结果批量操作/作用域搜索/参数化 `/add`）、命令历史 MRU/命令收藏夹——4.2.0+ 合并评估，维持原裁决。

---

## 3. 输入栏扩展（C 系列重审）

### 3.1 C1 搜索字段过滤 token ⬜

**语法**（大小写不敏感，多 token 之间 AND，token 之后剩余文本照常 fuzzy）：

| token | 语义 | 数据源（4.1.0 刷新） |
|---|---|---|
| `site:github.com` | URL 主机包含（子域自动命中，主机 endsWith 边界匹配） | 索引 url |
| `folder:工作` | 祖先文件夹标题包含 | `buildPathMap`——**4.1.0 H5 已单趟化产出 paths+ids**，token 过滤零额外树遍历 |
| `title:词` / `url:词` | 限定匹配通道 | 索引字段 |
| `dead:` / `blocked:` | 死链/阻断（基于 `deadLastScan` 缓存；从未扫描 → 提示行「先运行一次死链扫描」） | 扫描缓存 |

- **删除 `#标签` 与 `visited:N`**（维持原裁决：标签体系不存在；visitStats 语义撑不起过滤词）。
- token 形态 `prefix:value`，`prefix` 表固定枚举；无法识别的 `xxx:yyy` **不当 token**（整串照常 fuzzy）。
- 解析层是纯函数 `parseSearchTokens(query)`（新 `src/search-tokens.js`，fuzzy-core 保持纯净）；`<mark>` 高亮只作用于 fuzzy 剩余词命中。
- **omnibox 不启用 token**（omnibox 行为不变，parity 契约不破）；搜索历史存原始串。
- 空 fuzzy 查询 + 有 token = 纯过滤模式，结果按 `dateAdded` 降序。
- C2 先落地，C1 剩余词复用其分词结果。

### 3.2 C2 多词 AND 分段匹配 ⬜

- `rank()` 对空格分词：各词独立子序列评分，全部命中才返回；总分 = 各词分相加 + 连击加成；顺序不敏感。
- `<mark>` positions 跨词合并（并集排序）。
- omnibox 侧经 search-core 共享 fuzzy-core，行为自动一致（4.0.5 统一红利）。
- 边界（4.1.0 刷新）：**单词查询路径与含 4.0.8 span penalty 的现行排序逐字节一致**（回归测试锁死现行快照，避免排序漂移惊扰存量用户）。

### 3.3 C3 URL 直开 + `/copy` ⬜

见 §2.6 表（两项同在 C3/§2.6 交叉引用，实施同属 S9/S10 边界，按命令注册路径走 S9）。

### 3.4 C4 中成本

不进 velvet，维持原裁决。

---

## 4. 通知系统（✅ 主体已落地）

### 4.1 落地确认清单（4.0.8，逐项核实）

- 端点：`docs/announce.json` 经 raw.githubusercontent.com 拉取（零密钥零新依赖）；`If-None-Match` + 4s 超时；TTL 6h；一切失败静默。
- 数据模型：`version` 单调递增 + messages（id/version 条件 DSL `">=4.0.0 <4.1.0"` 或 minVersion/maxVersion 或裸消息/channel/once/display/kind/titleKey/textKey + en fallback/link 单对象或数组）；现状 3 条消息（v407/v408/v410）。
- 过滤 ∩ 调度：版本 ∩ channel ∩ once+未 dismiss ∩ 数组序优先；捐赠卡同帧优先，公告顺延。
- dismiss：`vbmAnnounceSeen` cap 100 LRU；banner × 进 Tab 环与 Esc banner rung。
- 隐私开关 `announceEnabled`（默认开，关 = 零网络）；安全（转义/枚举/500 字/10 条上限）。
- 共享 GitHub 链三层（直连 → 用户代理 → akams 镜像 top-5 自发现测速）。
- schema 校验在 `tests/announce.test.js`。

### 4.2 剩余打磨（🟡/⬜，velvet 内收口）

1. **`kind:"tip"` 频率纪律**（🟡）：现状 `kind` 仅作字符串透传，无专属纪律。落地为纯规则：每个 major.minor 至多展示 1 条 tip；同一用户同时存活 tip 至多 1 条；全部 once + dismiss 持久化。写进 announce.js（纯函数）+ 测试；违反纪律的 announce.json 过不了 schema 测试。
2. **发布流程一步**（⬜）：`AGENTS.md` Release process 增补「发版 PR 更新 `docs/announce.json`（version 自增 + 新 message）；临时通知 = 单独只改 announce.json 的 PR」。
3. velvet 首发内容：velvet 版本的 what's-new（新视觉 + `/theme` 列表 + classic）随发布写入 announce.json（沿用既有机制，非新工作项）。

---

## 5. 侧边栏进化

### 5.1 E1 独立页（完整壳）⬜

`pages/standalone.html?view=<id>` = **完整应用壳**——保留搜索栏、视图标签条与工具钮（palette 可用），**隐藏捐赠卡 + 快加星**（standalone 是标签页，「收藏当前页」的当前页是它自己，语义错误）。`body class="standalone-mode"`。

- **独立价值定位**：「清理工作台」——死链/去重/统计三个重数据视图的大屏形态：① 双行行在全宽下常开；② 批量操作不再挤压 400px；③ URL 参数态可分享/可收藏（`?view=dead&filter=blocked`，filter 参数映射 `deadFilter`）。
- **4.1.0 适配**：`?view=` 值域 = 七视图（tree/search/tabgroups/recent/stats/dead/dupes），非法值落 tree；**staging 落地后** `recent` 即暂存区（中转台的大屏形态顺理成章）。工具行右端的 `OPEN_EXTERNAL_ICON` 入口按钮只放 dead/dupes/stats 三个重数据视图（+staging 落地后加暂存区）；tabgroups 不加（实时窗口管理，侧栏已足够）。
- **布局**：`#container { max-width: 1200px; margin: 0 auto; height: 100vh }`；`--vbm-shell` 局部覆写 12px；无 popup 尺寸约束；卡片化（§1.5.1）在 standalone 同样成立。
- **激活**：`?view=` 启动后 `views.activate(view)`。
- **入口**：palette `/open [view]`——无参 = 当前视图大屏，视图名复用 tab 既有 i18n；点击 = `chrome.tabs.create`（页面上下文直接调，无需 SW 消息）。
- **守卫**：popup.js 在 `standalone-mode` 下跳过尺寸恢复/sidePanel heartbeat/`vbm-panel` port；**4.1.0 新增触点**：`scripts/runtime-files.json` HTML 白名单 + build 自检 + dist 冒烟；`tests/fuzzy.test.js` 脚本清单 parity 断言扩展。

### 5.2 E2 双栏

不进 velvet，维持原触发条件（≥3 条同屏反馈，或侧栏宽度中位数 ≥480px 成常态）。

---

## 6. 性能与工程（「迅捷如飞」）

### 6.1 已落地基线（4.1.0，✅ 不在 velvet 排期）

- **构建**：dist 管线（esbuild bundle + Terser）——popup JS 1134.6→286.6 KiB（-74.7%），zip 1130.3→850.2 KB；构建即自检六项；CI 双形态冒烟。
- **P1**：`buildTreeSnapshot` 单趟树快照；`idle.js` idle 队列（公告 fetch/favicon hydrate/徽章预载延后到首渲染后）；SW visit-stats URL 索引懒构建（无冷启动 `getTree`）。
- **H1–H9**：搜索索引懒重建、tooltip 事件委托、`getFaviconUrl` 手工序列化、sync 徽章事件增量、pathMap 单趟、dead overlay 定点、dupes keeper memo、tabgroups 未激活 count-only（+ 1s 降频）。
- **实测**：perf-popup 探针（3000 书签/50 标签种子、CDP Performance、10 次中位数）常驻 harness；P1 复测 wall -7.3% / scripting -3.2%。

### 6.2 velvet 性能纪律（新增约束，随每片执行）

1. **零几何回流**：velvet 全部视觉改动限定在 token/背景/边框/背板层；任何改行高/槽位/宽度的值必须先在 §1.2 网格登记。
2. **动效预算**：只动 `opacity`/`transform`/背景色（§1.0）；新增动画一律进 `--vbm-dur-*` 两档；`prefers-reduced-motion` 全局通收。
3. **回退线**：每片实施后跑 perf-popup 探针，popup 冷打开 / 树重建 / SW 冷启动三项中位数任一回退 >5% → 整片回退，不带病前进。
4. **P2 维持不启动**：`content-visibility`/分片渲染/虚拟滚动的启动判据（>100ms 长任务或明显滚动掉帧）在 velvet 不重新评估——velvet 的改动不在渲染热路径上。
5. **staging 预算**：暂存视图 ≤500 行 + 组头的整块 innerHTML 替换在死链视图同量级已验证；修剪 = 一次 Set 查找。

### 6.3 F 商店素材自动化 🟡（拼图与 listing 取回/草稿已提前落地，剩视觉定稿后重拍）

维持 task-1-final 原案：`scripts/screenshots/shots-store.js` 高 DPR 截取关键态 → 合成页拼图（临时 HTML grid + 整页截图，零 canvas）→ `assets/store/`。

> **提前落地记录（2026-08-26，feature/webstore-store-assets）**：`shots-store.js` 已按本节规格实施并通过 Docker 实跑（四主题瓦片 + 带右键菜单主卡 + search/recent/stats/dead/palette 共 10 瓦片 → `strip.png` 1400×560 与 `promo.png` 1280×800，对齐手工 `vBookmarks-v4.png` 版式；非扩展请求全 abort 保离线确定性；classic 主题落地后往 `STRIP_THEMES` 加一项即可）。listing 元信息同步升级：官方 V2 REST 无 listing 端点，故以 `publish.js listing`（公开页快照 + extName/extDesc 比对）与 `listing-draft`（规范源双语草稿 + 截图册规格核对）落地「取回/更新准备」，上传纪律不变。
- 规格：**1400×560**（strip：tree-light / tree-dark / ink / paper / classic / palette 横向拼）与 **1280×800**（promo：主 popup + 2–4 视图小图 + 菜单，对齐 `vBookmarks-v4.png` 版式）。
- 视觉素材在 §1.6/§1.7 定稿后拍摄（切片依赖排后）；ink/paper/classic 三版必须出现。
- 产出随仓库提交，人工挑选、手动上传，不接 WebStore API。

---

## 7. 实施切片与回归门禁

### 7.1 切片顺序（每片独立提交 + 全绿；staging 功能版本独立排期、先行落地）

| Slice | 内容 | 依赖 | 状态源 |
|---|---|---|---|
| **S1** | §1.0/1.1/1.2/1.3/1.4 token 铺底（动效/投影/间距/半径/排印/槽位）+ `design-system.test.js`（存量违例登记豁免表） | 无 | ⬜ |
| **S2** | §1.1 三平面（`--vbm-canvas` + body 迁移 + dark 卡面色微调 + 横幅组件连带核对） | S1 | ⬜ |
| **S3** | §1.5.1/1.5.2 卡片化 + tab 分段重绘（含 `no-view-tabs` 边界、七 tab 矩阵、删 `.tab-indicator` 及 view-manager 逻辑） | S1/S2 | ⬜ |
| **S4** | §1.9 左右缘系统（slot token + 各视图槽位收敛 + tabgroups 纳入 + staging 预留 + 标记同现契约） | S3 | 🟡 |
| **S5** | §1.5.3 classic 主题 + §1.12 `/theme` 列表模式（THEMES 5→6） | S3 | ⬜/🟡 |
| **S6** | §1.7 状态语言按主题（行型全覆盖清单，含 tabgroups §1.13）+ dnd/药丸收敛 | S3 | ⬜ |
| **S7** | §1.8 图标（CLOSE/EMPTY/OPEN_EXTERNAL/折角/dead × SVG 化）+ §1.10 A7 选项页增量 + A8 历史区呼吸 | S3 | 🟡 |
| **S8** | §1.11 CSS 解耦（themes/ 六文件 + options/favicons 单源化 + 四页 link + `runtime-files.json`/build 自检触点） | S5/S6/S7 定稿后 | ⬜ |
| **S9** | §2.2–2.6（B1/B2/B4/B5 + `/copy`·`/open-all`·`/sort`·URL 直开） | 无（可并行） | ⬜ |
| **S10** | §3.1/3.2/3.3（search-tokens / fuzzy 多词 / popup 侧 URL 直开） | 无（可并行） | ⬜ |
| **S11** | §5.1 E1 standalone 页（含 `/open` 命令与入口按钮） | S8（共享主题文件；若先行需自带 link 列表，推荐排后） | ⬜ |
| **S12** | §4.2 通知打磨（tip 频率纪律 + AGENTS.md 发布步骤 + velvet 首发 announce.json） | 无（可并行） | 🟡 |
| **S13** | §6.3 F shots-store.js（✅ 已提前落地）+ 全量截图重拍（待视觉定稿） | S8（视觉终态） | 🟡 |

### 7.2 回归门禁（4.1.0 基线刷新）

- **vitest 全量**（4.1.0 基线 80 套件）+ 新增：`design-system` / `search-tokens`；扩展 `theme`（完备性/classic/图标纪律）、`palette`（`/theme` 列表/B 系列命令）、`fuzzy`（多词 AND + 单词路径回归快照）、`search-core`（omnibox parity）、`view-manager`（indicator 删除/tab 几何）、`scrollbar-contract`（卡片裁切）、`announce`（tip 纪律）。
- **Docker**：smoke 三段（source / dist / dist full）零 console 错误；`verify-keyboard.js` 全矩阵（七 tab 几何变化 + tabgroups/staging 行型不影响键盘模型）；**`verify-scrollbars.js` 全矩阵（卡片化后最关键的门）**；视觉矩阵截图补 classic 态。
- **截图**：shots-themes 补 classic + 卡片对照 + 状态三态 + tabgroups/staging 行型；shots-store 首产；diag-favicon/diag-marker 重拍（A3 折角与 dead × SVG 化的并排裁决）。
- **性能**：每片 perf-popup 探针复测，>5% 回退线（§6.2.3）。
- **i18n**：新增 key 走 `i18n.py` 全流程（改既有 key 先 `[TODO:]` 再 translate --apply），audit/missing/verify 三门禁零残留。

### 7.3 新增 i18n key（en 基线 560 键之上的 velvet 净增）

`themeClassic`、`paletteThemeCurrent`、`paletteAlreadyPopup`、`paletteOpenUrl`、`paletteCopy`/`paletteCopyDone`/`paletteCopyNoTarget`、`paletteOpenAll`、`paletteSort`、`paletteOpen`、`palettePanel`/`palettePopup`/`paletteOnlyBar`/`paletteAll`（含 toast 文案）、`paletteCustomsTop`、`paletteHideBuiltin`、`paletteBuiltinOrder`、`openInNewTabTooltip`、`searchTokenDeadHint`。约 **20 key** × 43 locale（`/open` 视图名复用 tab 既有 key；announce 系键 4.0.8 已落地不计；staging 键在 staging 版本落地，见 velvet-feat-staging.md §10）。

### 7.4 风险与回退

| 风险 | 缓解 |
|---|---|
| light canvas 灰底让老用户觉得「背景变灰」 | 色值取最浅可辨（#f6f7f9）；classic 主题与 `/theme` 列表提供回纯白平面的出口 |
| 卡片化挤占 400px 宽（两侧 6px+2px 边）；**七 tab 更挤** | 右缘槽系统同步收敛；容器查询标签显隐已是主力；实测文字列净损 ≤16px；弹窗可拖宽 |
| verify-scrollbars 矩阵因卡片裁切翻红 | S3 单独提交，翻红即回退该 slice 不带病前进 |
| 主题文件拆分的加载序错误（token 未定义闪白）/ **dist 产物 404** | 主题 link 置于结构样式之后；`runtime-files.json` + build 自检 + 三段冒烟断言零 FOUC/404 |
| `/theme` 列表与 `/theme <名>` 分支复杂化 palette | 列表渲染复用既有行模板；无参分支单测钉死 |
| dead × 从文字改 SVG 在 10px 圆章内发糊 | 并排截图裁决（diag-marker）；不过关则保留文字字形、CLOSE_ICON 只统一 search-clear 与横幅 |
| staging 双区域在卡片内的视觉割裂 | §1.14 契约先行（组头同语言、区头同历史头）；shots-themes staging 行型断言 |
| classic 与「一键恢复经典界面」开关叠加的未测组合 | 两开关正交写进 classic 片测试矩阵（classic × 经典功能集 2×2 截图） |

---

## 8. 附录

### 附录 A · token 总表（4.1.0 现状 → velvet 目标）

| token | 4.1.0 现状 | velvet 目标 | 用途 |
|---|---|---|---|
| `--vbm-canvas` | 不存在 | 主题各异（§1.1：light #f6f7f9 / dark #141518 / ink #0a0d13 / paper #efe9dc / classic #ffffff） | 窗口底/留白面 |
| `--vbm-bg` | 「页面底色 + 行面」兼职 | 语义收成「行所在表面」 | 卡片行面/叠色/晕环引用 |
| `--vbm-bg-elev` | 存在 | 浮起表面（菜单/对话框/下拉） | 浮层 |
| `--vbm-radius-xs/sm/-/lg/pill` | 仅 `--vbm-radius: 8px` 一档 | 2/4/8/12/999px（主题可覆写） | 半径阶梯 |
| `--vbm-space-1/2/3`、`--vbm-shell` | 不存在 | 4/8/12px、6px（standalone 12px） | 间距 |
| `--vbm-slot-guide/icon`、`--vbm-gap-icon`、`--vbm-gutter`、`--vbm-slot-action` | 字面量事实对齐 | 16/20、4、8、24px token 化 | 槽位契约 |
| `--vbm-text-sm/md` | 不存在 | 11/12px | 排印两档 |
| `--vbm-dur-1/2`、`--vbm-ease` | 散落字面量（`.15s ease-out` 等） | 120/180ms、cubic-bezier(.2,0,0,1) | 动效 |
| `--vbm-elev-1/2` | 单档 `--vbm-shadow` | 两档投影（dark 覆写 none） | 浮层投影 |
| `--vbm-accent-hover` | 不存在（`brightness(1.08)` 滤镜代替） | 各主题 token | accent 填充物 hover |
| `--vbm-row-h` | 28px 已有 | 保留 | 行高 |

### 附录 B · 关键代码定位（4.1.0 行号级）

| 关注点 | 定位 |
|---|---|
| 主题应用/token 块 | `popup.js:10`（dataset.theme 直写，无白名单）；token 块 `neat.css:21-49`（:root）+ :51/:76/:107/:135（dark/auto/ink/paper）；副本 `options.css:1` + `favicons.css:1` |
| body 底色 | `neat.css:164`（→ `--vbm-canvas`） |
| view-tabs / tab | `neat.css:2236-2242`（#view-tabs）/ :2271-2273（active 文字）/ :2317-2325（`.tab-indicator`，S3 删）；`view-manager.js:248/:321`（indicator 逻辑，S3 删）；容器查询宿主 `#container` neat.css:2232 |
| 卡片化目标 | `#views` neat.css:2327-2333 + `#view-tabs` 焊接 |
| 行态（hover/selected/focus） | `neat.css:546-550` / :763-784 / :2573-2625（五列表视图）/ tabgroups :3810-4242 区间 |
| 半径/间距硬编码收敛 | 全 neat.css 扫（S1 豁免表登记） |
| 右缘槽现状 | dead `neat.css:4700-4703`；dupes :3603-3608；stats :4947-4959；`.row-btn` 基类 :3079-3105 |
| dead × / blocked | `view-dead.js:984`；`neat.css:4726-4757` |
| search-clear × | `pages/popup.html:9` / `pages/sidepanel.html:10`（内联 SVG → CLOSE_ICON） |
| 图标 | `src/icons.js`（21 常量） |
| palette 命令表/THEMES | `palette.js:369-399` / :283-299（themeFromRest） |
| fuzzy/搜索 | `fuzzy-core.js:158`（rank）；`search.js:557-563`（rank 调用 + slice 100）；`search-core.js:18-32`（omnibox rankBookmarks）；`background.js:174-214`（onInputEntered URL 兜底） |
| 公告层 | `announce.js:48`（ANNOUNCE_URL）+ `github-source.js`/`github-mirrors.js` + `docs/announce.json` |
| E1 落点 | `pages/standalone.html`（新）；`popup.js` standalone 守卫；`scripts/runtime-files.json` |
| 构建触点 | `scripts/runtime-files.json`（CSS/HTML 清单）+ `scripts/build.mjs`（自检）+ `scripts/package.py --root dist` |
| staging 契约衔接 | `docs/plan-velvet/velvet-feat-staging.md`（§2.1 DOM 结构、§3 选择模式、§4 文件夹选择器） |

### 附录 C · velvet 待办条目 → 切片映射（速查）

| 待办 | 切片 | 状态 |
|---|---|---|
| 三平面/网格/半径/排印/动效/槽位 token + design-system 测试 | S1/S2 | ⬜ |
| 卡片化 + tab 分段重绘（删 indicator） | S3 | ⬜ |
| 右缘槽 token 化 + 标记同现契约 | S4 | 🟡 |
| classic 主题 + `/theme` 列表 | S5 | ⬜/🟡 |
| 状态语言按主题（含 tabgroups 收敛） | S6 | ⬜ |
| 图标三新增 + 折角 + dead × SVG + 选项页增量 + A8 | S7 | 🟡 |
| CSS 解耦 themes/ + options/favicons 单源化 | S8 | ⬜ |
| B1/B2/B4/B5 + `/copy`/`/open-all`/`/sort`/URL 直开 | S9 | ⬜ |
| C1 token / C2 多词 / C3 | S10 | ⬜ |
| E1 standalone + `/open` | S11 | ⬜ |
| announce tip 纪律 + 发布流程步骤 | S12 | 🟡 |
| shots-store 商店图 | S13 | 🟡 首产已出（tmp/shots/store/），定稿后重拍 |
| 通知系统主体 / 20 命令 / hide·disable / favicon 补全·画廊 / storage-usage / i18n-live·/lang / /version / dist 管线 / P1·H1-9 / tabgroups 视图 / ×场景着色 / span penalty | — | ✅ 已落地 |

---

*本文为 velvet-task-1-final 在 4.1.0 HEAD 上的复审重订（k3）：已落地条目如实标 ✅ 退出排期，部分落地条目给打磨方案（🟡），未实施条目按 4.1.0 现状刷新细节（⬜）；新增 §1.13（tabgroups 视觉收敛）与 §1.14（staging 视觉契约）两节衔接 4.1.0 与暂存区版本。*
