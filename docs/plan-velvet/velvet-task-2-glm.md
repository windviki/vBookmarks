# velvet-task-2 · GLM 融合定稿（4.1.1 基线 · 色温体系合流）

> **血缘**：[`velvet-task-1-final.md`](velvet-task-1-final.md)（设计源头）→ [`velvet-task-2-k3.md`](velvet-task-2-k3.md)（4.1.0 重订的任务书，**本文的结构底座**）→ 本文。
> **理念源**：《你的UI廉价，错在颜色》（mp.weixin.qq.com/s/ACpAuaNIxIJH0kXYe1MrQQ，2026-08 读入）——高级感不来自 accent，来自**中性色层的品牌色温**；外加 [`velvet-theme-manager.md`](velvet-theme-manager.md)（Dracula 样本解剖 + 镜鉴九条 + 附录 B token 缺口）。
> **本文 = k3 任务书 ⊕ 色温体系 ⊕ 4.1.1 基线刷新**。k3 的全部裁决、切片与门禁**维持有效**，除非本文显式修订（修订集中在 §1 色温章与 §2 修订表，冲突处以本文为准）。旧版 glm 文稿（2026-08-22）的「task-2-k3 亦不引入」声明作废——本文直接建在 k3 之上。
> **代码基线**：**4.1.1 HEAD**（2026-08-30 实测：90 测试套件 / 3147 用例；en 717 i18n 键；neat.css 7325 行；暂存区功能版**已落地**；velvet token 仍零落地——`--vbm-canvas`/`--vbm-radius-*` 档位/`--vbm-space-*`/`--vbm-dur-*`/`--vbm-elev-*`/`--vbm-temper` 全部 0 命中，S1 起步面干净）。
> **本文只做设计，不实施。** 版本主题不变：丝滑流畅、迅捷如飞、视觉温润柔和如同丝缎。

---

## 0. 融合总纲

### 0.1 为什么是色温：给「丝缎」补上操作性定义

velvet 的三支柱（材质/动效/性能）里，「温润柔和如同丝缎」一直是最含糊的一条——k3 §1.0 把它解释为「表面有呼吸、边界不刺眼」，仍是描述而非**操作**。文章补上了这块缺口：

> 真正拉开质感差距的不是最亮眼的主色，而是藏在背景、边框、弱化文字、阴影里的色温。打开任何一个看起来「很贵」的产品（Linear、Stripe、Vercel、Raycast），每一个中性色都带一点品牌色的色相偏移——品牌色不是「盖在」界面上，是「流进」界面里。

velvet 的操作性定义由此成立：**丝缎的温润来自纤维染色，不是表面印花**。accent 孤立地站在纯灰世界上 = 印花；每一层中性色（底、边、影、弱文、滚动条）都浸着同一瓶染料 = 染色。velvet 要的是染。

**现状测温（4.1.1 HEAD，neat.css:29-175 逐值核过）**：

| 主题 | 现状 | 判定 |
|---|---|---|
| light | bg `#ffffff`、border `rgba(0,0,0,.10)`、hover `rgba(0,0,0,.05)`、shadow `rgba(0,0,0,.2)`、muted `#5f6368`——**全部纯灰零色相** | **白坯布，待染** |
| dark | bg `#1b1c1f`（色相仅 ±1°）、border 白 alpha、shadow 纯黑 | **白坯布（黑版），待染** |
| ink | bg `#0e1118` 蓝黑、border `rgba(148,163,205,.16)` 蓝白、muted `#8b93a9` 蓝灰 | **满分染色样本——参照系** |
| paper | bg `#f6f2e9` 暖、border `rgba(74,63,48,.16)` 暖、muted `#756c5d` 暖 | **满分染色样本——参照系** |
| classic（k3 S5 未落） | v3 记忆 = 灰白世界 | **豁免**（见 §1.1） |

一个佐证色温体系「本来就是我们的语言」的事实：light 的选中色 `#d3e3fd`、flash `rgba(43,93,205,.2)`、focus-ring 全是 accent 蓝染过的——Google 的现值里已经有人在做色温实践，只是没人把它**体系化**。体系化正是 velvet 的事。

### 0.2 色温三律（文章十律的 velvet 工程化）

文章约十条实操律，收拢为三条工程律写进 velvet（其余各律已散落 k3 既有裁决：图标=currentColor 文字层级即 k3 §1.8 纪律；语义色纪律即 k3 §1.7；深色反向即逐主题独立 token 的现行模式）：

1. **灰阶先于色相**。亮度阶梯是结构（三平面、文字层级），色温是氛围。每个 token 先定明度、再染——染料永远不许改动亮度次序。这是「色温建立在稳固灰阶之上，不是替代品」的 velvet 版。
2. **色温不承担结构**（灰度测试门）。任何新增颜色先问：去饱和后还剩什么？层级若靠色相才能读出 = 色相越权 = 违律。落成可执行门禁（§1.7）。此律同时是吸收 Dracula 镜鉴多通道反馈的**总量控制阀**——通道可以加（光条/辉光/呼吸），但每个通道都必须灰度可弃、reduced-motion 可弃。
3. **一源派生**。每主题一个色温母色 `--vbm-temper`，全部中性层由它经 `color-mix` 派生；**禁止平行手写中性色**（平行手写 = 漂移的起点，light 现值的五个纯灰就是各自为政的证据）。`color-mix()` Chrome 111+ 支持、我们底线 114，且 neat.css 已有 25 处在用——机制原生，零新增成本。

**工程约束（三条，随律走）**：
- **hex 锚点契约**：`--vbm-bg` 与 `--vbm-canvas` 保持**字面 `#rrggbb`**（`themeIsDark()` 只认 hex，neat.js:94-103；theme-manager §3.1-7 同款警告）；`color-mix` 只用于派生层。
- **AA 预算**：染后 fg ≥7:1、muted ≥4.5:1（paper muted 曾因 3.9:1 被修到 4.6:1，先例在此）；染量纪律见 §1.3。
- **性能零增量**：色温全部是 token/color-mix 层工作，零几何回流（k3 §6.2 硬约束不破）。

### 0.3 基线刷新 4.1.0 → 4.1.1（k3 §0 的增量修正）

k3 的 §0 盘点表按 4.1.0 核实，本文只记增量：

| 变化 | 对 velvet 的影响 |
|---|---|
| **暂存区功能版已落地**（staging.js/staging-relay.js + view-recent 工作台 + 分层记忆组 + 宽栅格连接线体系） | k3 §1.14 的措辞「staging 落地后」全部变为「已落地」；契约对象是**真实 DOM**（`#staging-list`/`#recent-head`/`#recent-list`/`.staging-section-head`/`.staging-group-head`，neat.css:1775-2089 已核）；2026-08-27 连接线体系（`--stg-trunk-x`/`--stg-tick-w`）成为 §1.6 连接线活性的施加面 |
| **自定义 CSS 工作台落地**（pages/custom-css.html + userstyles 多样式模型） | theme-manager 路径 A（Dracula 预设）的前置已就绪；velvet 色温 token 发布时，「主题受影响变更」节照 theme-manager §4.7-3 纪律写 |
| **`--vbm-pill-warning-fg` token 先例**（on-color 双编码纪律，浅色 pill 白字） | 语义色 on-color 家族已是事实词表——§1.4 语义色轻推必须连带核对 on-color 对（AA 预算的一部分） |
| **测试/i18n 基线**：80→**90 套件**（3147 用例）；en 560→**717 键** | k3 §7.2/§7.3 的基线引用按此刷新；velvet 净增 key 数不变（约 20） |
| **行号漂移**：neat.css 4.1.0 → 7325 行（`.tab-indicator` 2317→**3814**；reduced-motion **3849**；行静态 554-577；scrollbar **2998**） | k3 附录 B 行号以本文 §5.B 与 theme-manager 附录 A（4.1.1 实核）为准 |
| **两份新设计输入**：theme-manager（附录 B 四 token + 镜鉴九条） | §1.6/§2 正式收编——本文是它们的 velvet 侧归宿 |

---

## 1. 色温体系（新增章，S1 的地基）

### 1.1 五主题的温度方向（§1.6 材质的重排）

每主题一个性格不变（k3 §1.6 的 Modern/仪器/纸器分野维持），温度是性格的**底色层**：

- **light/dark「Modern」**——冷蓝染。temper = accent（light `#0b57d0` / dark `#a8c7fa`），全部中性从纯灰换成本色染。这是 velvet 对 light/dark 最大的一笔视觉投资：从「Google 缺省」到「被蓝浸过的白/黑」，Linear 式的安静贵气。染量克制在「说不出来哪里不同，但更贵」的档位（§1.3 染量表）。
- **ink「仪器」**——已是满分样本，**零改动**。velvet 把 ink 现值追认为色温体系的第一个落地实现（磷光晕在 §1.5 统一进 glow token 家族）。
- **paper「纸器」**——暖染维持，但 **temper 与 accent 解耦**：paper 中性是黄暖（bg `#f6f2e9` hue≈39°、muted hue≈40°），朱砂 accent 是红（hue≈9°）——若用 accent 直染，纸面会偏粉。故 paper 的 temper = 墨暖赭（草稿 `#6b5b45`，hue≈38°，与现中性同向）。paper 现值基本已达，落 §1.3 表时微调即可；canvas（k3 定的 `#efe9dc`）同温落位。
- **classic**——**温度豁免**。classic 的角色是 v3 记忆，v3 就是灰白世界；temper = none、全部中性纯灰，是 classic 的性格而不是欠账。豁免写进 theme.test.js 契约（classic 块断言中性零色相），防止后人「顺手补染」。
- **auto**——映射 light/dark，无独立温度。

### 1.2 token 层：`--vbm-temper` 与派生链

```
--vbm-temper（每主题唯一染料源）
    light #0b57d0 · dark #a8c7fa · ink #8b9cff · paper #6b5b45（草稿） · classic 无
        │  color-mix 各浓度派生（in srgb；语义色用 in oklab）
        ├─ 平面：canvas 2-3% / surface 1% / elev 顶光档（§1.3 光方向律）
        ├─ 边界：hairline 4-6%（border / 分隔线 / 滚动条轨道）
        ├─ 交互：hover 3-4% / selected 10-15% / accent-subtle 8%（统一淡底档）
        ├─ 文字：fg 3-5%（向 temper 微偏的近黑/近白）/ muted 6-8%（带温灰）
        ├─ 投影：温影 = color-mix(temper 10-15%, #0d1220)——蓝黑，非纯黑
        └─ 滚动条 thumb：muted 同源
```

- **fallback 链**：所有派生式写 `var(--vbm-temper, var(--vbm-accent))`——用户主题只给 accent 也自动获得整条色温（theme-manager token 层「新 token 自动落默认」降级语义的天然兼容，§5.C 接口）。
- **派生 vs 字面**：平面两锚点（bg/canvas）字面 hex（§0.2 hex 契约）；交互态、边、影、淡底、文字**一律派生式**，主题文件里不再出现手写中性灰。
- **词表登记**：`--vbm-temper` 进 theme-manager §4.7-2 的 Tier 1 词表（颜色/材质 token，minor 只增不改）。

### 1.3 逐层染色表（草稿值；实施时四主题并排截图 + AA 复测定稿）

**染量纪律**（先于数值的规则）：中性平面 1-4%、hairline 4-6%、hover 3-4%、selected 10-15%、muted 6-8%——总量以「灰度测试下与纯灰版不可分先后、肉眼并排可感『更贵』」为准；超过即越权。

| token | light 现值 → 染后（草稿） | dark 现值 → 染后（草稿） | 备注 |
|---|---|---|---|
| canvas | （新增）`#f6f8fb` | （新增）`#12141b` | k3 值 `#f6f7f9`/`#141518` 的同亮度蓝染版；比 k3 蓝三倍但仍是「隐形」级 |
| bg（卡片面） | `#ffffff` → `#fdfeff` | `#1b1c1f` → `#22252d`（含 k3 调亮半档） | 1% 染 |
| bg-elev | `#ffffff`（顶光，不染） | `#26282c` → `#262a34` | **光方向律**：冷品牌光源在上——light 平面越高越冷越白（elev 纯白 = 最接近光源）；warm 品牌（paper）反之，越低越暖越深 |
| border/hairline | `rgba(0,0,0,.10)` → `#e3e7ee` | `rgba(255,255,255,.10)` → `rgba(168,199,250,.13)` | dark 发丝 = 亮度边框 + accent 微温（文章「dark 下 0 0 0 1px 从深度边框变亮度边框」律） |
| bg-hover | `rgba(0,0,0,.05)` → `#eef2f8` | `rgba(255,255,255,.07)` → `rgba(168,199,250,.08)` | **交互态禁平灰 overlay**——hover 即染（文章交互染色律） |
| bg-selected | `#d3e3fd` **维持** | `#2c3f5e` **维持** | 已是 12-15% temper wash，追认进体系；值类型放开的修平见 §1.6 |
| fg | `#202124` → `#1e232b` | `#e3e5e8` → `#e5e8f0` | 3-5% 偏温；AA 富余量大 |
| muted | `#5f6368` → `#5b6472` | `#9aa0a6` → `#99a1b0` | 6-8% 带温灰；AA ≥4.5:1 复测（paper 先例） |
| 温影 | `rgba(0,0,0,.2)` → `rgba(16,27,48,.20)` | 投影禁用维持（§1.5） | 温影 = 蓝黑；**阴影不许纯黑**（文章带温度的阴影律） |
| scrollbar | `rgba(95,99,104,.5)` → `rgba(91,100,118,.5)` | `rgba(154,160,166,.5)` → `rgba(150,158,178,.5)` | 与 muted 同源 |

ink/paper 两列**不进此表**（零改动/微调，参照系地位）；classic 全表纯灰豁免。

### 1.4 语义色：同象限轻推 + 小面积强度管理

- **轻推规则**：danger/warning/success 的 hue 只在**与品牌同温的象限内**轻推 ≤5°（冷品牌：红向品红、绿向青、琥珀偏冷各半档），推后必须过「语义猜色」测试（并排三色，语义仍然秒读）；**不达标即保留现值**——语义清晰 > 色温统一，这是对文章语义染色律的 velvet 式收紧（文章案例是暖品牌；冷品牌语义色轻推空间天然更小，强推会伤红绿可辨性）。light 现值 `#d93025`/`#188038`/`#f9ab00` 的候选微调在 S1 实施时并排定稿，预期改动量 ≤ 一档色相。
- **subtle 底同温**：语义淡底（blocked 琥珀叠标、dead pill 底等）落在染过的表面上自然同温——这正是「色温流进每一层」的红利：底面染了，语义淡底不再需要各自的粉/黄/绿纯中性版本。
- **小面积满填纪律**（镜鉴⑨吸收为规则）：accent/语义色**满填**只保留给主动作按钮与语义 pill；徽章类（`.row-badge.current`、tabgroups current 徽章）从满填降为 **`--vbm-accent-subtle` 底 + accent 文字**——「局部强度管理」，让满填重新变稀有、变响亮。S6 状态表复核时按此规则过一遍全部小 pill。
- **on-color 家族**（`--vbm-danger-fg`/`--vbm-warning-fg`/`--vbm-pill-warning-fg`）：轻推后连带复测 on-color 对的 AA（`--vbm-pill-warning-fg` 的双编码实践维持）。

### 1.5 投影与发丝：`--vbm-elev-*` 的温影形态（k3 §1.1 修订）

k3 的两档投影维持，**值形态升级为「温影 + 发丝合一」**（文章 `0 0 0 1px` 律）：

```css
/* light（示例值，S1 定稿） */
--vbm-elev-1: 0 0 0 1px var(--vbm-border), 0 2px 8px var(--vbm-shadow);
--vbm-elev-2: 0 0 0 1px var(--vbm-border), 0 8px 24px var(--vbm-shadow);
/* dark：投影禁用维持，elev = 亮度发丝（带 accent 微温） */
--vbm-elev-1: 0 0 0 1px var(--vbm-border);
```

- **归属分工**：浮层（菜单/对话框/palette/toast/dropdown）用 elev 档——发丝与温影同一声明、布局零参与、hover 可加深不发 layout；**卡片（静态几何）仍用 `border`** 参与盒模型（k3 §1.5.1 卡片 border 结构不变，只是 border 的色值来自 §1.3 染色）。
- **温影色禁纯黑**：`--vbm-shadow` 语义改为温影色（light `rgba(16,27,48,.20)` 之类）——「阴影带色温」是文章全部十律里性价比最高的一条，一行 token 全局生效。
- **ink 磷光 = 温影的发光态**：`--vbm-glow-hover`/`--vbm-glow-focus`（shadow 列表或 none，默认 none）收编 theme-manager 附录 B 立项——ink 的磷光晕从 §1.6.2 的专属写法升格为通用 token，dark 的「shadow→glow」反转律与 ink 共用此槽位。

### 1.6 交互状态染色（k3 §1.7 材质列升级 + 镜鉴收编）

k3 §1.7 状态语言表的几何列全部维持；**材质列按温度重写**，并收编 theme-manager 附录 B 四 token 与镜鉴相关条目：

| 状态 | light/dark（染后） | ink | paper | 新通道 token（默认 none） |
|---|---|---|---|---|
| hover | temper wash（`#eef2f8` / `rgba(168,199,250,.08)`） | 同左 + 0.5 档磷光 | 暖灰 wash | `--vbm-row-hover-rule`（::after 光条；paper 朱砂选中条同族槽位） |
| selected | temper 10-15% wash（现值追认） | 深蓝 + 磷光细边 | 朱砂竖条 + 暖 wash | `--vbm-bg-selected` 值类型放开为任意 background（**17 处 `background:` / 10 处 `background-color:` 分裂在 S1 修平**，k3 未涉及、theme-manager 附录 B 首案） |
| focus-visible | accent ring（维持） | ring + 磷光晕 | ring（暖） | `--vbm-glow-focus` |
| 行呼吸 | 无 | 无 | 无 | `--vbm-row-focus-animation`（`filter: brightness` 呼吸——恰是 k3 §6.2 合法属性；默认 none；**强制 reduced-motion 尊重**） |

- **收编裁决——多通道的总量控制**：光条/辉光/呼吸/连接线活性（镜鉴③④⑤）四条全部进 token 词表但**默认 none/whisper**，内置主题只由 ink（磷光）、paper（朱砂条）按性格启用。理由回到色温第二律：**通道可以更丰富，不许更吵**——每个通道都必须灰度可弃（结构不依赖它）、reduced-motion 可弃（前庭安全）。Dracula 的五通道并发证明了上限在哪，velvet 取其纪律不取其音量。
- **连接线活性**（镜鉴⑤，S6 候选·建议采纳）：folder/staging 组头 hover 时其后代 trunk/tick 连接段增强（2026-08-27 连接线体系的颜色通道，`--staging-line` 家族提浓度）——纯色相通道、几何零动、灰度下退化为现状。这是「悬停点亮我所在子树」的范围感知，深树里的高价值反馈。
- **reduced-motion 默认拒绝**（镜鉴⑥，采纳为契约）：k3 §1.0 的「全局通收」落为机制——`@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; } }` 全局钳制（.01ms 保 transitionend 仍触发），替代 neat.css:3849 的枚举登记制；需要例外的动画走白名单豁免并写明理由。新增动画天然被兜住——默认拒绝比登记制健壮。
- **`--vbm-fg-folder`**（镜鉴②，S1 词表评审）：默认 = `--vbm-fg` 零变化；ink/paper 可按性格启用（色相快于图标的一级扫描线索）。classic 不启用。

### 1.7 灰度测试门（色温第二律的可执行化）

- **harness**：新增 `diag-grayscale` 探针——注入 `filter: grayscale(1)` 后四主题全视图截图 + 像素采样（diag-411 的 PNG 逐像素扫描先例直接复用），断言：文字三级（fg/muted/accent-subtle 上的文字）灰度下仍可辨、平面三级（canvas/bg/elev）亮度差仍单调、hover/selected 与静态行灰度下仍可分。**任何一个层级灰度下塌掉 = 该 token 的染量越权 = 整片回退。**
- **theme.test.js 纯数学断言**：每主题①平面亮度阶梯单调（light 升序 / dark 降序）；②fg ≥7:1、muted ≥4.5:1；③classic 中性零色相（豁免契约）。染色值进 token 的同时进测试——「先定灰阶再染色」由 CI 执行，不靠自觉。
- **设计时规约**：评审任何新颜色，第一问「去饱和后还剩什么」；答不出结构职责的颜色不许进词表。

### 1.8 排印：文字染色与状态字重

- 文字染色（§1.3 fg/muted 行）+ 既有纪律维持（`font: menu` 正文、两档字号、tabular-nums 全数字收口照 k3 §1.4）。
- **状态字重 500 档**（镜鉴⑦，审慎采纳）：字重是灰度可存活的通道（去饱和后状态仍可读）——这正是它过色温第二律的原因。采纳范围窄化：mark（600 维持）、主按钮（600 维持）之外，**仅** selected 行标题可升 500（S7 排印评审实测宽度后定稿）；**tab 明确不加**（k3 §1.5.2 宽度抖动裁决维持——400→500 同样改字宽）。
- 排印微调包（letter-spacing 0.1px / line-height 1.35 / antialiased）不采纳：零问题报告、macOS-only 一条记档备忘。

---

## 2. 对 k3 各节的修订清单（🎯 汇总）

| k3 节 | 动作 | 修订内容 |
|---|---|---|
| §1.0 总纲 | 补强 | 材质支柱获得操作定义（染不是印，§0.1）；三律入纲（§0.2）；reduced-motion 通收落为默认拒绝机制（§1.6） |
| §1.1 三平面 | 修订 | 五主题色值表按 §1.3 染色表重定；elev 值形态升级温影+发丝（§1.5）；dark 禁投影维持 |
| §1.2/1.3 网格半径 | 不变 | 色温零几何参与 |
| §1.4 排印 | 扩展 | 文字染色 + 字重 500 窄采纳（§1.8） |
| §1.5 卡片化/tab | 微调 | 卡片 border 结构不变、色值改染；浮层投影改 elev 温影发丝；其余照 k3 |
| §1.6 主题材质 | 重排 | light/dark 首要材质工作 = 补染（§1.1）；ink 零改动升参照系；paper temper 解耦朱砂；classic 温度豁免入契约 |
| §1.7 状态语言 | 修订 | 材质列按 §1.6 重写；四 token 收编；连接线活性、fg-folder 入评审 |
| §1.8 图标 | 确认 | currentColor = 图标色即文字 token（文章图标律我们已达标）；空态图标板用 accent-subtle |
| §1.9 槽位 | 不变 | 镜鉴①行物件感、⑧滚动条 13px **不进 velvet 裁决**——移交 density 正交设置评审（theme-manager §4.8），与 k3 范围一致 |
| §1.10–1.12 | 不变 | 选项页/历史区/`/theme` 照 k3（options.css token 副本随 S8 单源化时同染） |
| §1.13/1.14 | 刷新 | staging 已落地：契约对象 = 真实 DOM（`#staging-list` 等，§0.3）；组头/星标/双区域契约照 k3 §1.14 执行，材质列随 §1.6 |
| §2–§5（B/C/D/E） | 不变 | 全部裁决维持；基线引用刷新（90 套件/717 键） |
| §6.2 性能 | 确认 | 色温零几何回流；color-mix 样式解析成本可忽略（25 处在用先例）；perf 门照跑 |
| §6.3/§7 | 修订 | S1 扩色温链（§3）；门禁增 diag-grayscale + theme 亮度单调断言 |

---

## 3. 切片与门禁修订（k3 §7 的增量）

| Slice | 相对 k3 的变化 |
|---|---|
| **S1** | 扩入色温链全量：`--vbm-temper` + 派生式改写五主题中性层 + 温影发丝 elev + `--vbm-accent-subtle` + selected 值类型修平（17/10 分裂）+ glow/rule/animation 三 token 入词表（默认 none）+ theme.test 亮度单调/AA/classic 豁免断言。S1 变重了，理由：色温是其后一切材质的地基，拆开做 = 平行手写中性色的窗口期 |
| S2 | 三平面迁移与染色同片（k3 原案 + §1.3 染色表） |
| S3–S7 | 照 k3；材质列一律按 §1.6 染色版执行；S6 增连接线活性候选与 current 徽章降档复核；S7 增字重 500 实测 |
| S8 | 照 k3（themes/ 六文件；token 块迁移时派生式随之单源化） |
| S9–S13 | 照 k3 |

**门禁增量**：①`diag-grayscale`（harness，§1.7）；②theme.test 三断言（亮度单调/AA/classic 零色相）；③四主题并排染色对照截图进 shots-themes（染前/染后/灰度三联，裁决染量的依据留档）；④reduced-motion 全局钳制后 `verify-keyboard` 复跑（transitionend 时序敏感性核查）。

**风险表增列**：

| 风险 | 缓解 |
|---|---|
| 老用户感知「白变灰蓝」 | 染量 1-4% 隐形级 + 灰度门双保险；比 k3 已评估的 canvas 灰底风险更弱；classic = 零温出口 |
| 语义色轻推伤红绿可辨 | 同象限 ≤5° + 语义猜色测试；不达标保留现值（§1.4） |
| 染量漂移（后人手改单 token 出温） | 一源派生 + 词表纪律：中性层禁止手写 hex（契约测试扫主题文件里的裸中性色） |
| color-mix 与用户主题旧 token 的相容 | fallback 链 `var(--vbm-temper, var(--vbm-accent))`；theme-manager 导入校验同步加 temper 白名单 |

---

## 4. 维持声明（k3 未修订部分）

k3 §2（B 系列命令）、§3（C 系列输入栏）、§4（通知）、§5（E1 standalone）、§6.3（F 商店素材）的**全部设计、裁决与触点维持原文有效**，仅基线数字引用按 §0.3 刷新。velvet 目标版本维持待定（staging 已占 4.1.1，velvet 以发布时为准）。

---

## 5. 附录

### A. 色温 token 总表（k3 附录 A 的增量行）

| token | 值 | 说明 |
|---|---|---|
| `--vbm-temper` | 每主题一个颜色（classic 缺省） | 色温母色；fallback = accent；Tier 1 词表 |
| `--vbm-accent-subtle` | `color-mix(in srgb, var(--vbm-accent) 8%, var(--vbm-bg))` | 统一淡底档：「新 N」pill/mark 底/空态图标板/徽章降档（§1.4）；现有 25 处 color-mix 中的 accent 淡底模式收敛于此 |
| `--vbm-shadow`（语义升级） | 温影色（禁纯黑） | elev 档的影色源 |
| `--vbm-elev-1/2` | 温影 + `0 0 0 1px` 发丝合一 | 浮层专属；dark = 仅亮度发丝 |
| `--vbm-glow-hover` / `--vbm-glow-focus` | shadow 列表或 none | ink 磷光升格；theme-manager 附录 B 首案 |
| `--vbm-row-hover-rule` | none 或颜色 | hover 光条；paper 朱砂条同族 |
| `--vbm-row-focus-animation` | none 或动画 | filter:brightness 呼吸；强制 reduced-motion |
| `--vbm-fg-folder` | 默认 = `--vbm-fg` | 零变化默认；主题性格 opt-in |

### B. 4.1.1 行号锚（替换 k3 附录 B 的漂移行号）

token 块 neat.css:29-63（:root）/ :65-89（dark）/ :91-117（auto）/ :123-147（ink）/ :152+（paper）；`.tab-indicator` **3814**（S3 删）；reduced-motion **3849**（S1 改全局钳制）；行静态透明平面 **554-577**（镜鉴①证据）；scrollbar **2998**；staging 连接线/组头 **1775-2089**；options/favicons token 副本 options.css:1 / favicons.css:1（S8 消）。其余见 theme-manager 附录 A（4.1.1 逐条实核）。

### C. 与 theme-manager 的接口

①P1 四 token（glow×2/rule/animation + selected 值类型）由本文 §1.5/§1.6 **正式收编**——theme-manager §4.9 的 P1 行就此闭环；②`--vbm-temper` 进 Tier 1 词表 + theme-pkg.js 白名单；③作者指南（theme-manager §4.7）增「色温」一节：temper 用法、派生式范例、「灰阶先于色相」义务、语义色不侵蚀条款；④镜鉴①⑧（行物件感/滚动条）的 density 评审结论若采纳「材质档」，回来修订本文 §1.6 而非绕开。

---

*本文（2026-08-30）= velvet-task-2-k3 的色温融合层：k3 管几何与秩序，本文管温度与染料；丝是染成的，不是印花的。实施从 S1 起（色温链与 token 铺底同片），灰度测试门与并排三联截图是染量的唯一裁决机制。*
