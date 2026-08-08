# 审阅报告 07:视觉样式整体审计

> 材料:7fea4d1..HEAD 两个 CSS 文件全量 diff、neat.css 3396 行全文、options.css、icons.js、popup.html、dropdown.js 与三个视图的工具行 markup、6 张实拍截图含局部放大验证。审阅日期:2026-08-07。
> 总体判断:这一轮 CSS 质量很高——新规则全部走 `--vbm-*` token(ink/paper 无漏定义)、`!important` 仅 5 处且都有注释辩护、b2e54be 的特异性战争修复正确。

## 改进清单(按影响力排序)

### 高影响

**1. 自绘下拉的键盘焦点几乎不可见**
- 位置:`css/neat.css:2602-2606`(`.dupes-toolbar .vbm-dropdown-list li:hover, li:focus`)
- 现状:打开 listbox 后用 ↑↓ 导航,焦点项只得到 `background: var(--vbm-bg-hover)`(light 5% 黑 / dark 7% 白),且 `outline: 0` 被显式抹掉。对照右键菜单 `.menu-item:focus`(neat.css:687-699)是 `bg-selected + fg-selected + 2px 环`——同样是键盘驱动的列表,下拉的可辨度差一个量级,dark/ink 下几乎看不出焦点在哪。
- 建议:
  ```css
  .dupes-toolbar .vbm-dropdown-list li:hover { background: var(--vbm-bg-hover); }
  .dupes-toolbar .vbm-dropdown-list li:focus {
      background: var(--vbm-bg-selected);
      color: var(--vbm-fg-selected);
      outline: 0;
  }
  ```
  与 `[aria-selected="true"]`(accent+600)不冲突:选中态无背景,焦点态有背景,两态叠加可读。
- 影响面:四主题 / dupes 视图 / 纯键盘路径。

**2. neat.css 缺 `color-scheme`,原生控件在 dark/ink 下渲染为浅色 UA 外观**
- 位置:`css/neat.css:20-148` 四个 token 块均无 `color-scheme`;`css/options.css:3,25,47,70,91` 有(P4 引入),popup 侧漏了。
- 现状:sort 对话框的 2 个 radio + 2 个 checkbox、`.dupes-scheme` 的"Ignore http/https differences"、`.stats-unbookmarked-input` 都是原生 `<input>`。截图实证:`docs/images/guide/view-dupes.png` 深色主题下该复选框是一个**白色方块**,杵在深色工具行上。UA 焦点环颜色同样不受控。
- 建议:镜像 options.css 的写法——`:root { color-scheme: light }`、`body[data-theme="dark"], body[data-theme="ink"] { color-scheme: dark }`、`@media (prefers-color-scheme: dark) { body[data-theme="auto"] { color-scheme: dark } }`、`paper { color-scheme: light }`。
- 影响面:dark/ink/auto-dark;弹窗内全部原生表单控件。

**3. tab-group 色点行在默认 320px 弹窗(及任何 zoom≥110)下折行**
- 位置:`css/neat.css:1137-1162`(`#tab-group-colors` + `.tab-group-color`)
- 现状(算术):label 宽 = span 22px + padding 3px×2 = 28px,9 个点 = 252px;`gap: 10px` × 8 = 80px → 至少 332px。对话框内容宽 = `--dialog-content-width` = min(340px, 320 − 2×1em ≈ 294px)。332 > 294 → 第 9 个点掉到第二行,`justify-content: space-between` 让第一行 8 个点摊开、第二行孤点,破坏了注释里"spaced across the row"的 Chrome 式单行设计。zoom 后可用宽更小(150% 时 ≈196px),必然折行。
- 建议:span 22→20px、label padding 3→2px、gap 10→6px 并去掉 space-between:
  ```css
  #tab-group-colors { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .tab-group-color { padding: 2px; }
  .tab-group-color span { width: 20px; height: 20px; }
  ```
  合计 264px:320px 弹窗(294px)与 zoom 150%(≈187px 可用,264/1.5=176px)都放得下。
- 影响面:tab-group 对话框 / 全主题 / 全 zoom 档。

### 中影响

**4. `.dead-proxy-strip` 的按钮不在 Item 7b 焦点环契约里**
- 位置:`css/neat.css:2488-2496` 的 `:focus-visible` 清单漏了 proxy strip;strip 按钮规则在 3028-3047、hide× 在 3053-3073。
- 现状:proxy strip 是键盘模型的正式 rung(verify-keyboard 115 断言覆盖它),但其 add/manage/hide 按钮聚焦时只有 UA 默认 1px 环,与同视图 dead-toolbar 按钮的 2px token 环不一致。
- 建议:把 `.dead-proxy-strip button:focus-visible` 追加进 2488 那组选择器。
- 影响面:dead 视图 / 键盘用户。

**5. RTL:本版本新增两处物理属性 + 若干存量**
- 新增(应改):
  - `css/neat.css:3106` `#dead-list ul li.vbm-row > a { margin-right: 4px }`(f5bc7cb)→ `margin-inline-end: 4px`。2051-2053 的注释专门拿它当"右缘呼吸"基准,自己却用了物理写法——RTL 下这 4px 跑到外缘,锚点与行尾按钮之间反而没缝。
  - `css/neat.css:1222` `.tab-group-pick-row { text-align: left }`(1b60c32)→ `text-align: start`。
- 存量(可一并清理,均非本 diff):`#quick-add-btn`/`#tool-btn` 的 `margin-left: 4px`(1416/1506,RTL 下搜索框与星标按钮之间 0 间距、星标与 ⋮ 之间 8px);选择框 `margin-right: 6px`(2682);`.palette-slash` 的 `margin-left: auto`(1796,RTL 下 slash 串停在内联起点侧,对照 2630/3212 已正确用 `margin-inline-start: auto`);`#quick-add-toast { right: 0 }`(1447,RTL 下 toast 锚错边)。
- 影响面:RTL 语言(ar/he/fa)。

**6. 对话框按钮没有 token 焦点环**
- 位置:`css/neat.css:1000-1024` 只有 `:hover`,全文件无 `.dialog .buttons button:focus-visible`。
- 现状:对话框是模态(`aria-modal`),键盘用户 Tab 进去后只有 UA 1px auto 环,ink/paper 下色相与主题违和。
- 建议:
  ```css
  .dialog .buttons button:focus-visible {
      outline: 2px solid var(--vbm-focus-ring);
      outline-offset: 1px;
  }
  ```
- 影响面:全部 7 个对话框。同组可顺带补 `#donation-go/-later/-never`(同样只有 UA 环)。

**7. paper 主题下代理测试成功/失败颜色几乎无法区分**
- 位置:`css/options.css:246-254` + `src/options-proxy.js:76-78`(`.ok` 切换)
- 现状:失败 = `--vbm-danger`,成功 = `--vbm-accent`。light/dark/ink 下 accent 与 danger 色相距离远,没问题;paper 的 accent 是朱红 `#c2402a`、danger 是深红 `#b3261e`——两个红,成功反馈会被误读为失败。
- 建议:引入 `--vbm-success` token(light `#188038` / dark `#81c995` / ink `#7ee0a3` / paper `#1e7a34`),`.ok` 改用它;正好补齐四主题定义。
- 影响面:paper / options 页 Dead-scan 组。

**8. tab-group 色点的 halo 与内点用错了表面色**
- 位置:`css/neat.css:1170,1176,1188`(`0 0 0 2px var(--vbm-bg)` 与 `::after` 的 `background: var(--vbm-bg)`)
- 现状:色点在对话框上,对话框表面是 `--vbm-bg-elev`。dark(#1b1c1f vs #26282c)、ink、paper(#f6f2e9 vs #fffdf7)三个主题里,选中点的"镂空缝"和内点比周围表面暗一档,能看出一圈色差;仅 light 两 token 同色无感。
- 建议:这三处 `--vbm-bg` → `--vbm-bg-elev`。
- 影响面:dark/ink/paper 的 tab-group 对话框。

### 低影响(打磨/代码健康)

**9. `.dialog` 的 transition 是事实死规则(双系统并存)**
- `css/neat.css:950` 新增 `transition: opacity .15s ease, top .18s ease`,但 neat.js:983 总在加载 10ms 后给 body 加 `.transitional`,而 `.transitional .dialog`(963-970)特异性更高且靠后,把 duration/timing 改回 `.2s ease-out`。真实滑入仍是 .2s/.2s,新写的 .15/.18 只在头 10ms 存在。建议二选一:删 950 的 transition(维持现状行为),或把 `.transitional .dialog` 收敛掉、统一为 .15/.18。

**10. dupes 工具行内控件高度三档**
- trigger(neat.css:2536,`3px 8px`+1px border ≈23px)、扁平按钮(2663,`1px 6px` ≈17px)、apply pill(2640,`2px 8px` ≈19px)同排混用,截图可见 trigger 明显高于邻居。建议:trigger `padding: 2px 8px`(→21px,含 border),扁平按钮 `padding: 2px 6px`(→19px),与 pill 齐平。stats/dead 工具行内部是自洽的,不用动。

**11. 工具行骨架三份复制,`.vbm-toolbar` 类零 CSS**
- neat.css:2502-2512(dupes+dead)、2978-2987(proxy strip)、3170-3180(stats)是同一份 flex 配方的三份拷贝;而四个工具行 DOM 都带 `.vbm-toolbar`(JS 键盘钩子,keyboard.js/view-manager.js 在用)却没有任何 CSS 挂它。扁平 accent 按钮配方也有四份(2263/2657/2923/3028)。建议把公共骨架收敛为 `.vbm-toolbar { display:flex; align-items:center; gap:6px; padding:4px 8px; border-bottom:1px solid var(--vbm-border); font-size:11px; color:var(--vbm-muted); flex-wrap:wrap; }`,各视图只留差异;顺带可把 dropdown 的 `.dupes-toolbar` 作用域放宽到 `.vbm-toolbar`——dropdown.js 头注释明说组件要给"dead proxy, stats …"复用,但 CSS 目前绑死在 dupes,正是 b2e54be 那类战争的温床。零视觉变化。

**12. 死规则/死 token/注释腐化**
- `.dupes-toolbar select:focus-visible`(neat.css:2490):select 已全部换成 dropdown,死选择器,删(view-dupes.js:376 的 TOOLBAR_SEL 保留 select 是前瞻,无妨)。
- `--vbm-indent: 12px`(neat.css:41):全库零引用(树缩进是 tree-render.js 内联的 24px 步进),删。
- z-index 旧编号注释:undo-toast 的"Sits above the command palette (11)"(1535)、palette 的"above the cover (9) … menus (10)"(1642-1643),与文件头 Layer 表(100/200/300/400)矛盾,改注释即可。dropdown list 的 z-index 300 也可补进 Layer 5 的注释。

**13. options.css `#dead-proxy-server-input` 冗余声明**
- options.css:234-244 的 background/color/border/border-radius/padding/font 与通用 `input[type=text]` 规则(486-495)逐值重复,只有 margin/width 有效。瘦身为 `margin: 0; margin-__MSG_@@bidi_start_edge__: 1em; width: 12em;` 三条。

**14. 动效时长离群**:`#quick-add-toast` 的 opacity `.3s`(1461)是全库最慢;同类反馈 notice-toast `.18s`(1601)、hover `.12s`、菜单 `.15s`。统一为 `.18s`。

**15. 对话框落点两档**:alert/confirm/edit/new-folder 落 `top: 40px`(1256,注释"clear of the search row"),sort/tab-group/pick 落 `top: 0`(1364/1087)。同一滑入动画两种终点,窄弹窗里 sort 对话框会盖住搜索行。若属有意(高对话框要全高)建议在 `.dialog` 块注释写明分层,否则统一 40px。

**16.(可选)paper 的 muted 对比度 3.9:1**(`#82796a` on `#f6f2e9`,neat.css:134),11px 工具行文字低于 AA 4.5;其余三主题 ≥5.5:1。压到 `#756c5d` 约 4.6:1。审美主题的取舍,列为可选。

**17.(可选)ring 配方不统一**:`#palette-input:focus` 用 box-shadow 环(1672-1675),搜索框用 outline 2px/-1(290-294)。视觉近同,统一为 outline 更一致。

**18.(低概率)dropdown list 右缘溢出**:`min-width:100%` + `white-space:nowrap`,长本地化文案(如德语策略名)在 trigger 靠右缘时会被 `#dupes-list` 的 `overflow-x: hidden`(3387-3396 契约)裁掉。目前 trigger 都在行首,触发不了,备注即可。

## 未提交的 `#search` margin 改动:结论

**保留,建议微调为 `margin: 2px 2px 4px`;不接受回退。**

- `0 0 4px` 是从 7fea4d1 一路继承的旧值(本轮 32 个提交没碰过它)。在 margin 0 下:搜索框焦点环是 `outline: 2px; offset: -1px`(290-294),外凸 1px——左/上两边被视口裁掉一半;`#quick-add-btn:focus-visible`(1432)与 `#tool-btn`(1520)是 2px 无 offset 环——右/上两边整段被裁。主交互行三个控件的焦点可见性都打了折,2px 边距恰好容纳两个环,这是真实修复不是审美偏好。
- 顶部 0→2px 同时解决了输入框 1px 边框贴死窗口上缘的局促感(tabs-themes.png 里可见)。
- 底部 4→2px 是这次改动里唯一值得斟酌的:搜索行与 32px tabs 条之间偏紧。底部回到 4px 可维持旧节奏,且不影响环裁剪(环只需 1-2px)。若作者就是想要四周对称窄距,`2px` 也可接受——但 `0 0 4px` 不该回。
- 侧边 2px 与 `#donation` 的 4px(348)有 2px 参差,donation 默认隐藏,可忽略;搜索行与 tabs/树的"齐边"关系变化在 2px 量级,截图对照无感。
- 该改动无 RTL/zoom 风险(对称 margin,zoom 等比缩放)。

## "不要动"清单

- **`[hidden] { display: none !important }` 单点收编**(169-171):替换了三个分散的重复规则,注释说清了动机,是 !important 的正确用法。
- **dropdown list 的 margin/padding `!important`**(2581-2594):对抗 `#dupes-list ul` ID 级 reset 的组件契约,注释完整;b2e54be/bc80718 两连修的最终形态,别再"优化"掉。
- **`:not(.vbm-dropdown-trigger)` 排除式选择器**(2657-2670):特异性账已在注释里算清,简化它会重开战争。
- **三槽行对齐契约**(16px twisty/::before + 20px 图标槽 + 4px 缝,523-560)与 24px 缩进步进:tree/results/recent/dead/dupes/stats/palette 七处共享,截图逐视图验证对齐成立。
- **`.row-badge` pill 几何**(14px/7px radius/9px tabular-nums)+ `.time` 的几何还原(3231-3253,issue #47 注释在案)。
- **`.dead-indicator` 的 doubled-selector 防线**(3140-3164):每个盒属性钉死,注释记录了 1,0,3 泄漏史。
- **view tabs 的 per-tab container query**(1949-1953,112px 阈值 icon-only 回退):400px 截图验证无换行无截断,badge pill(14px)与 row pill 同几何。
- **选择模式 ::before 复选框**(2676-2699):accent 填充 + ✓ + bg-selected 行染色,dead/dupes 两张实拍都清晰。
- **highlight-unsynced 的双路径**(1616-1637:light/paper 走 muted 色、dark/ink/auto-dark 走 opacity .55)与 dead 工具行的 disabled 双保险(`:disabled` 去色 + `:disabled:hover` 去 hover,2968-2974)。
- **滚动条 token 化配方**(8px 轨、2px transparent border + padding-box,1279-1294)。
- **token 化程度**:本轮新增的 dropdown/对话框/工具行/徽标规则零硬编码颜色(仅 tab-group 的 `--tg-color` 九色是有意对齐 Chrome 调色板),四主题无需补丁——这是这套体系最该守住的资产。

## 附注(证据时效)

`docs/images/guide/` 的截图停在 v4.0(e59ad0b):其中 `view-stats.png` 的行右缘顺序是 count→time,与当前 CSS 的 path→time→count(neat.css:3280-3282)不符;`search-dualzone.png` 的 "Clear all" 仍是旧的 muted 文本样式(新样式是 accent 扁平按钮,2263-2276)。CSS 侧无问题,但 4.0.1 发布前这两张图值得重拍,以免 guide 与实物不符。
