# vBookmarks 主题作者指南（theme-manager P3）

> 面向对象：想给 vBookmarks 做主题的用户与作者。底层机制见
> `docs/plan-velvet/velvet-theme-manager.md`（设计定稿）；本文件是作者视角的
> 操作手册与承诺清单。

## 1. 两条路线

| 路线 | 形态 | 适合 | 稳定性 |
|---|---|---|---|
| **主题包**（推荐） | 单文件 `.vbmtheme.json`：结构化 token + 可选 advancedCss | 绝大多数主题 | token 层 = 稳定 API，扩展升级自动跟随 |
| **自定义 CSS**（高级） | 选项页 → 自定义样式工作台：自由 CSS，级联叠加 | 装饰性微调、实验 | 尽力而为：选择器漂移自担 |

主题包在选项页「主题管理」组导入（文件选择或拖拽 `.vbmtheme.json` 到组卡
上）；选中后 `/theme` 列表与主题下拉同样呈现。**主题内容存本地**（sync 单项
8KB 装不下样式表），换设备请导出文件再导入。

## 2. 主题包格式

```json
{
  "format": 1,
  "id": "dracula-neonlinx",
  "name": "Dracula",
  "author": "Neonlinx",
  "version": "1.0.0",
  "colorScheme": "dark",
  "tokens": {
    "--vbm-bg": "#282a36",
    "--vbm-bg-elev": "#343746",
    "--vbm-canvas": "#21222c",
    "--vbm-fg": "#f8f8f2",
    "--vbm-muted": "#8b95c4",
    "--vbm-accent": "#bd93f9",
    "--vbm-bg-selected": "#44475a",
    "--vbm-bg-hover": "color-mix(in srgb, #8be9fd 9%, #282a36)"
  },
  "advancedCss": "/* 可选：装饰/组件级覆盖，明示尽力而为 */"
}
```

- `format` 必须为 `1`；`id` 限 `[a-z0-9-]`；`colorScheme` 必填
  `dark|light`（驱动控件基色与 favicon 反色基准）；文件 ≤256KB（按字节
  计）。主题库整体另有总量护栏：≤20 个 / ≤2MB（R15-C8）。
- **两层契约**：`tokens` 里只认词表内的键（未知键忽略并警告）；没给的
  token 自动落内置默认——升级后新 token 天然兼容，这就是 token 层相对裸
  CSS 的决定性优势。
- `--vbm-bg` 请写 `#rrggbb` 字面量（favicon 暗色检测只认 hex）。
- `advancedCss` 里 `@import` 与远程 `url(https…)` 会被扩展 CSP 拦截
  （导入时有警告）——token 值里的远程 `url()` 同理（R15-C9③）；字体
  只能用用户本机已装的字体名，图片请内嵌 `data:` URL。
- **`advancedCss` 的去向**（theme-freedom §1）：应用主题时它以一条
  「主题样式：<主题名>」的托管条目自动出现在自定义 CSS 工作台并启用；
  切换到别的主题时自动禁用（条目保留，可手动删除）；删除主题时随之移除。
  条目钉在列表前部——主题 CSS 永远垫在用户自己的样式之下；手动禁用会被
  尊重（再次「应用」该主题除外——那是显式重新激活）。内容随主题包刷新，
  对条目的手改在重新导入后会被覆盖。

## 3. token 词表（分档承诺）

**Tier 1 · 颜色/材质（稳定 API：minor 版本只增不改）**

| 组 | token |
|---|---|
| 平面 | `--vbm-canvas`（窗体）`--vbm-bg`（行面/卡面）`--vbm-bg-elev`(浮层) |
| 台面图像 | `--vbm-canvas-image`（多图层;R6-2 起支持 `url(data:…;base64,…)` 真图像——CSP `img-src data:` 通道,base64 的 `;` 已由校验器放行;`<>` 仍禁）`--vbm-canvas-image-size`（逐层 size）`--vbm-canvas-image-opacity`（整层透明度 0–1,主题级调光） |
| 交互 | `--vbm-bg-hover` `--vbm-bg-selected` `--vbm-flash` |
| 文字 | `--vbm-fg` `--vbm-fg-selected` `--vbm-muted` `--vbm-fg-folder` `--vbm-icon-folder`（文件夹图标色,个性化主题对齐 fg-folder） |
| 边/影 | `--vbm-border` `--vbm-shadow` `--vbm-scrim` `--vbm-scrollbar` `--vbm-scrollbar-hover`（滚动条对可携带渐变等任意 background 值——theme-freedom §2.1） |
| 强调 | `--vbm-accent` `--vbm-accent-fg` `--vbm-accent-hover` `--vbm-accent-subtle` `--vbm-focus-ring` `--vbm-temper` |
| 语义 | `--vbm-danger` `--vbm-danger-fg` `--vbm-warning` `--vbm-warning-fg` `--vbm-pill-warning-bg` `--vbm-pill-warning-fg` `--vbm-success` · 文字级(R15-D4) `--vbm-warning-text` `--vbm-success-text` `--vbm-danger-text`——语义色直接作文字/小图标画在行面时用它(填充色在若干主题上不过 4.5:1;文字级 token 全主题 ≥4.5:1 于 `--vbm-bg`,theme.test 执法) |
| 浮层 | `--vbm-elev-1` `--vbm-elev-2`（shadow 列表；暗色 = 亮度发丝 + 从 `--vbm-shadow` 派生的克制投影，theme-polish-912 起内置 dark 即此形态） |
| 微动画 | `--vbm-pop-hover` `--vbm-pop-press`（行 hover/按压的 transform，如 `scale(1.012)`）· `--vbm-row-hover-rule`（hover 底部光条颜色）· `--vbm-row-focus-animation`（行聚焦动画 shorthand，如 `vbm-breathe 2.6s ease-in-out infinite`）· `--vbm-glow-hover` `--vbm-glow-focus`（磷光 shadow 列表） |
| 当前行 | `--vbm-row-active-bg` `--vbm-row-active-fg` `--vbm-row-active-shadow`——当前行（`:active/.active/:focus` + 菜单项 focus）的底/字/字影，默认回落 `--vbm-bg-selected`/`--vbm-fg-selected`/`none`；bg 可携带渐变等任意 background 值（classic 借此恢复 v3 蓝渐变白字，见 plan-velvet/classic-v3-fidelity.md）。**深色自定义主题请显式声明 bg/fg 两键**——`:root` 默认里的 `var()` 在声明处冻结为浅色对，不声明时暗色面（树当前行/菜单 hover-focus）会以浅色蓝绘制（2026-09-05 实测菜单焦点字 1.96:1；内置主题已全部块内重声明，theme.test 锁防回归） |
| 链接语言 | `--vbm-row-hover-underline`（`none`\|`underline`）——书签标题 hover 下划线，v3 时代的 hover 语言，classic 双主题 opt-in |
| 狂热通道（craft-420 r2） | `--vbm-canvas-image` `--vbm-canvas-image-size`（桌面 background 层与档位：网格/纸纹/噪点/极光）· `--vbm-overlay-blur`（浮层 backdrop-filter——玻璃拟态杠杆）· `--vbm-overlay-image`（浮层 image 层：顶光/镀膜；浮层 = 右键菜单/对话框/palette/下拉/双 toast 七处）· `--vbm-glow-selected`（当前行 + 菜单焦点项的常驻磷光）· `--vbm-accent-glow`（对话框主钮 hover/focus 辉光）· `--vbm-tree-line`（暂存连接线色；默认从 muted 派生——`:root` 冻结律，深色主题块须重声明，theme.test 执法；ink 靛染/remake 紫染即样例） |
| 强度参数与卡片材质（theme-polish-912） | `--vbm-rim-strength`（控件边一族的 fg 混色百分比，默认 `26%`：搜索框/头部钮/对话框输入框同一配方；paper 22% 是柔边样例）· `--vbm-tab-strength`（视图 tab 滑动填充的 accent 浓度，默认 `12%`）· `--vbm-card-image` `--vbm-card-image-size`（视图卡片 #views 的材质层，canvas-image 的卡片孪生；ink 扫描线/paper 纤维即样例）。百分比参数写裸百分比（`22%`），与 `--vbm-tag-ink` 同款——它们不受 `:root` 冻结律管辖 |

**素雅 ↔ 狂热光谱（craft-420 r2）**：通道默认全关——只填 12 核心色就是一支
素雅主题（Solarized Light 是活样本：零弹跳、零玻璃、零磷光，安静是它的性格）；
把狂热通道叠满则是另一极，内置主题就是展品——dracula 的浮层玻璃（半透明
elev + backdrop blur）与常驻选中磷光、ink 的台面网格（canvas-image）与靛染
导轨、paper 的纸纹、remake 的浮层紫顶光。几何（槽位/右缘 8px 轴/行高）永远
不属于主题——那由 density 档管；定制 keyframes 与选择器级装饰的归宿是
advancedCss——那正是两层契约的分界线。

微动画须知：keyframes `vbm-breathe`（brightness 脉冲）由内置样式全局提供，
可直接引用；也可以在 advancedCss 里自定义 keyframes 按名引用。**一切动画
都被 `prefers-reduced-motion` 全局钳制兜底**——请勿做出依赖动画传递信息
的设计。默认值全部为 `none`：安静的代价为零。

**Tier 2 · 几何（仅 major 版本可动）**

半径阶梯 `--vbm-radius-xs/sm/-/lg/pill`；行高 `--vbm-row-h`（见 §4 密度）；
间距 `--vbm-space-1/2/3`、`--vbm-shell`、`--vbm-head-room`（搜索栏顶距，
默认随 shell，classic 归零贴窗缘）、`--vbm-leg-room`（搜索栏底距，与
head-room 成对，R15-C11 起对称导出）；槽位 `--vbm-slot-guide/icon`、
`--vbm-gap-icon`、`--vbm-gutter`、`--vbm-slot-action`；排印/动效
`--vbm-text-sm/md/base`、`--vbm-font-ui`（UI 字体族，默认 `menu` 平台菜单
字；CSP 下只能用本机字体名）、`--vbm-row-active-weight`（当前行标题字重，
默认 500，写 400 即关闭强调）、`--vbm-dur-1/2`、`--vbm-ease`。

`--vbm-text-base`（13px）是 body 的基准字号：行标题、组头、菜单项都从它
继承（同侪律——头与行永远同号），`sm/md` 是钉死的 chrome/辅助字号。调整
base 即整体缩放正文层，sm/md 保持不动；结构几何（行高、槽位）不随字号
自动变化，调大 base 时请自行确认 28px 行高仍然装得下。

## 4. 密度是正交设置，不是主题属性

行密度（紧凑 24 / 默认 28 / 舒张 32 / 宽敞 36 / 疏朗 40）是选项页里的独立
设置（body[data-density]），主题不该也不需要管行高——几何参数全部收在档位
token 后，主题作者没有破坏几何的入口。

**档位准则（打磨 2026-09）**：一档 = 行高 × 字号 × 呼吸三联动。行高
`--vbm-row-h` 与字号 `--vbm-text-base`（行标题、组头、菜单的 body 基准）
成对放大——舒张只加呼吸（字号不动），宽敞/疏朗则连文字一起放大（原始
Dracula userstyle 的疏朗感）；呼吸=行高与字号的差值，不设第三个 token。
树/搜索行与全部列表视图的行板都消费 `--vbm-row-h`（树行 2026-09 加入——
此前密度在默认树上不可见），双行形态走 min-height 自然生长。

## 5. 几何不侵犯区（内置与自定义主题通律）

右缘 8px 动作轴、20px 图标盒/24px 步距、三层槽位（twisty 16 / 图标井
20/22 / 标题轴 48/50）、行内缩进（24px×level）——这些是校准过的网格，
**不是皮肤参数**。叠加缩进/导轨线/行距改写请放 advancedCss 自担风险，
内置主题一律不碰。

## 6. 稳定选择器清单

advancedCss 可依赖的结构词汇（`tests/theme-compat.test.js` 契约看守——
改名走「新增别名 + 弃用期」，绝不静默）：行解剖 `.tree-item-link`
`.tree-item-span` `.twisty` `.favicon-container` `.row-main` `.row-sub`
`.row-path` `.row-badge` `.row-btn` `.count-pill` `.sync-indicator`；视图
`#view-tabs` `.view-tab` `#views` `#tree` `#results`；列表容器
`#recent-list` `#staging-list` `#stats-list` `#dead-list` `#dupes-list`
`#tabgroups-list`；组头 `.group-head` `.staging-group-head`
`.recent-group-head`；菜单/面板 `menu[type=context]` `.menu-item`
`.submenu` `#command-palette` `.vbm-dropdown-list` `.dialog` `#search`
`.vbm-toolbar` `.empty-state`；覆盖层 `#undo-toast` `#notice-toast`
`.risk-banner` `#whats-new` `.announce-banner` `#drop-overlay`
`#bookmark-clone`；标签面（4.2.0 tags 合并入契约）`.row-tag-chips`
`.row-tag-chip` `.row-tag-dot` `.row-sub-tags` `.tag-more`
`.row-tags-expanded` `.search-tagrail` `.search-tagbar` `.tag-chip-active`
`.tag-co-strip` `.tag-chip-co` `.tag-chip-excl` `.tag-suggest`
`.tag-add-btn`。

自定义主题的级联位：内置主题表之后、用户自定义 CSS 之前——**用户 CSS
永远能再盖主题一层**。

## 7. 质量门槛

- AA：正文前景 ≥7:1、次级 ≥4.5:1、徽章 on-color ≥4.5:1（导入时自动
  预检并报告，不达标会警告——Dracula (@Andrew) 内置版就为此把评论色提亮了两档）。
- 语义色（danger/warning/success）只做语义，永远不做装饰色。
- 减少动态（prefers-reduced-motion）是强制要求，全局钳制自动生效。
- 内置主题的染量守「灰度测试」：去饱和后层级不塌（diag-grayscale 探针）。

## 8. 内容色（tag 九色）——主题作者须知（4.2.0）

- 标签九色（grey/blue/red/yellow/green/pink/purple/cyan/orange，`.tg-*`
  → `--tg-color`）是 **Chrome 平台资产、跨主题恒定**：不做逐主题变体、
  不进任何主题词表、不受灰度门管辖（它不是中性层染色，是用户内容色）。
  唯一定义在 `css/themes/light.css`（theme 栈全页共享——popup/options/
  tags 三页都载全量主题表）。
- 主题作者对标签可读性的**唯一义务**是 `--vbm-tag-ink`（chip 色墨里
  `--vbm-fg` 的占比，默认 50%）：暖色浅底主题（paper/solarized-light）
  覆写为 58% 以保浅 hue 的 AA。chip 文字对比度由
  `tests/theme.test.js` 的九色 × 十一主题 × 两形态断言逐主题看守——
  自定义主题若改 `--vbm-fg`/`--vbm-bg` 大幅偏离内置值，导入预检的
  AA 报告会同时覆盖该路径。
- tag 色不进 glow/rule/pop/breathe 任何性格通道（内容元素无性格，
  velvet-feat-tags §2.5）。

## 9. 官方样本主题包:能力边界的完整展示

[`docs/samples/aurora-bench.vbmtheme.json`](samples/aurora-bench.vbmtheme.json)(极光台面)是官方炫技样本:令牌层吃满全部「狂热通道」(磷光 hover/focus/选中辉光、按压回弹、hover 光条、渐变当前行、极光台面 canvas-image 三层、玻璃浮层 blur+顶光、对话框辉光、导轨染色、聚焦呼吸、圆角族),advancedCss 十节演示自定义 keyframes、极光台面真图像背景(url(data:) SVG)、发光光标、hover 行流光环(@property 角度动画,R8 迁自当前行)、hover 材质贴图(feTurbulence 噪点)+当前行常驻贴图的呼吸材质、Chrome 异形弧线 tab(13px 深弧)、全九枚视图图标换装(data-URL 描边)、四角对称异形框+斜切缝线与玻璃列表卡(极光透入,R8)、浮层玻璃化、标签霓虹描边与滚动条染色、暂存连接线流光——全部只依赖 §6 的稳定选择器词汇表。下载后在 选项 → 主题管理 → 导入主题包 即可体验;导入报告零错误零警告(tests/theme-sample.test.js 长期看守)。

> 2026-09-26 起,选项页主题组挂着**「官方示例主题下载」**直达链接(指向本目录的 GitHub 页面),不必手动翻仓库;指南链接(本文)就在它上一行。
