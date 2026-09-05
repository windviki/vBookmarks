# Issues #65 / #66 — 记忆分层开关 · 弹窗重开滚动位置失效 · 合并档案(2026-08-30 ~ 09-02)

> **Please give us the option to disable highlighting the last picked bookmark in the tree.**
> — @Ownsin, issue #65, 2026-08-29
>
> **after disabling highlighting. It no longer remembers the position and resets to the top of the tree's bookmarks.**(关闭高亮后位置不再记忆,重置回树顶)
> — @Ownsin, issue #65 后续, 2026-08-30
>
> **v4.1.1 still often cannot remember it's last scroll position and reset the scroll position to the top. … You may regenerate the problem by changing the scroll position only and not select any particular bookmark.**
> — @leungwh, issue #66, 2026-08-30
>
> **select a bookmark to visit a URL, then scroll around on the URL page you visit. Then come back to the bookmark. You will often see the scroll position either shifted or reset to the top.**
> — @leungwh, issue #66 最新评论, 2026-09-02

## 始末 · Timeline

1. **#65 原始请求**(单独关闭高亮)——4.1.1 以「分层记忆」选项组实现:总闸「记住上次状态」+ 四子开关(高亮上次打开的书签/记住滚动位置/记住展开的文件夹/记住上次的搜索词),详见原文档与 `docs/issues/issues-62-64-2026-08-29.md` 的分层记忆设计。首轮回复已发布(2026-08-30)。
2. **#65 后续反馈 + #66**:4.1.1 上滚动位置记忆失效,重开重置回树顶或漂移;高亮开/关、有无高亮行均复现。维护者分诊为同一问题(same as #65)。
3. **根因定位 + 修复(2026-09-02,随 4.1.2 发布)**:见下。

## 根因 · Root causes(真实浏览器实证,与 #63 的关窗丢写无关——存储侧 scrollTop/focusID/focusSpot 及其 localStorage 影子全程新鲜正确)

1. **恢复赋值被未就绪布局 clamp 成 0**:`generateTree` 在 `innerHTML` 换树后同步执行 `scrollTop = saved`,但新解析大树的嵌套 `#tree ul ul {height:0}→.open>ul{height:auto}` 布局约 250ms 后才 settle(150 行树实测赋值瞬间 `scrollHeight==clientHeight==350`),赋值被静默 clamp 到 0,事后无人补写——重开即"回顶",与高亮开关无关(#65 用户关高亮后的主诉即此)。隔离复刻(同 CSS+结构的小树/内联样式)不触发,属 Chromium 布局 settling 时序,修复须对其免疫。
2. **"回到原位"的 focus() 滚动副作用**:Chromium 程序化 `focus()` 默认把焦点行滚入可视区(实证 `overflow:hidden` 挡不住,800→10;`preventScroll:true` 才免疫),tree-view focusID 恢复里 Neat 2011 年遗留的 overflow/width 杂技从未生效。三处恢复路径(focusID 恢复、view-manager `restoreFocusSpot`、list-focus `unparkRowFocus`)都会覆盖已恢复的滚动。#66 精确复现链:高亮恢复 4 秒后 focusID 迟清理("看不见高亮"),`focusSpot` 行记忆仍指旧行,重开时照样把视图拉回。
3. **"often / either shifted or reset" 的成因**:leungwh 字面流程(点击书签→浏览网页→重开)里,关闭位置==高亮行位置,clamp(回顶)与 yank(拉回行)两缺陷方向相反、恰好**竞速抵消**——focus() 轮询(100ms)与布局 settle(~250-450ms)谁赢决定结局,故"经常、要么漂移要么回顶";且 yank 触发的滚动事件会把拉坏的值**回写污染存储**(修复前实测:存 2200→重开 1360→存储被改成 1360)。

## 修复 · The fix(v4.1.2)

语义原则:**滚动位置与焦点/高亮是两条独立记忆,谁也不得覆盖谁;恢复赋值对布局时序免疫。**

| 位置 | 改动 |
| --- | --- |
| `src/tree-view.js` 滚动恢复 | clamp 补写:赋值未达 saved 且有 rAF 则每帧重试(上限 30 帧);期间 scrollTop 被移动(用户滚动、reveal 的 scrollIntoView)立即让位 |
| `src/tree-view.js` focusID 恢复 | `focus({preventScroll:true})`;删除从未生效的 overflow/width 杂技——高亮、键盘焦点落行、4s 迟清理语义不变 |
| `src/view-manager.js` `restoreFocusSpot` / `src/list-focus.js` `unparkRowFocus` | 同改 `{preventScroll:true}`(聚焦与滚动解耦,方向键行走自会滚) |

有意滚动(reveal `scrollIntoView`、键盘导航、palette `block:'nearest'`、新行落点)一律不动。

## 验证 · Verification

- 单元:+7 场景(clamp 补写落地/让位/有界放弃/无 rAF 回退+三处 preventScroll 契约);全量 90 套件/3151 用例+lint 绿。
- 真浏览器回归门 `scripts/harness/diag/diag-issue65-66-scroll.js`:A 高亮开滚深处、B 4s 清理后无可见高亮(#66)、C 高亮关(#65)、D leungwh 字面点击流程+滚离变体(#66 最新评论)——修复前三场景重开全 0、D 变体存 2200 重开 1360 且存储被污染;修复后 **7/7 PASS**(D 关闭位 1380→重开 1380,高亮+键盘焦点保留;滚离后重开 2200)。
- 分层记忆契约 `diag-memory-layers.js` 14/14、`run.sh --smoke-only` 与 `--dist` 全量 harness PASS。

## 残余轮 · Residual round(2026-09-03,#66 关闭后的新反馈)

**反馈**(leungwh,#66 关闭后):v4.1.2 在**关闭**「高亮上次打开的书签」时滚动位置已正常;**开启**时又失效。维护者亦复现("highlight 开启的时候不能保存精确的位置")。

**本地复现尝试(全部未能复现,逐一排除)**:真实 action 弹窗(`chrome.action.openPopup` + CDP,`diag-openpopup-probe4` 手法)× 树规模 150/1200/4000/5000 行 × 高亮开/关 × 多轮变位重开 × 4s 清理窗口前后 × 真实点击流程 × 折叠高亮行所在文件夹 × 4×/20× CPU 节流——全部精确恢复。tag 页环境同理。

**代码审计锁定的残余路径(防御性全封,即本轮修复)**:
1. **预算不足**:climb 补写仅 30 帧(≈500ms)。高亮 ON 时 focusID 存在使 chunk 门退让(`!hasFocusMemory`),**强制同步整树解析**;高亮 OFF + 浅滚动走分块渲染(快而准)——这正构成反馈中的开/关不对称。慢机器+大树可能超出帧预算 → 补写耗尽 → 回顶。
2. **climb 中间值污染存储**:补写爬升过程会触发 scroll 事件,滚动监听把 clamp 中间值(如 400)回写覆盖存储的精确值——用户在爬升中途关窗即触发"**不能保存精确的位置**"。
3. **`focusDefault` 裸 `row.focus()`**:restoreFocusSpot 放弃路径(2s 轮询失败,如 spot 行未渲染)与视图切换落焦,会把视口拉向被标记行——最后一个未加 preventScroll 的行落焦点。

**修复**:滚动恢复改为 **campaign**(30 rAF + 40×100ms 尾段 ≈4.5s 墙钟;`rescueApplied` 握手——滚动监听跳过 campaign 自身应用的中间值、真实滚动立即接管并正常持久化);`focusDefault` 行落焦加 `{preventScroll:true}`(键盘箭头行走仍按设计滚动)。

**验证**:tree-view rescue 测试组重写+3 新契约(中间值不落盘/接管持久化/有界放弃含尾段),全量 90 套件/3160 用例+lint 绿;diag-issue65-66-scroll 7/7、真弹窗矩阵全过、memory-layers 14/14、smoke PASS。

**根因实锤(维护者给出精确复现步骤后)**:步骤=高亮开→点开一个非空文件夹(焦点落文件夹行)→重开(文件夹高亮,正常)→滚到深处→重开→漂移。隔离探针(anchor-probe)实证 Chromium **滚动锚定(overflow-anchor)的锚点选择优先聚焦元素**:视口外的聚焦行会成为锚点,布局 settle 期间的高度增长触发锚定补偿时**把视口直接拽向焦点行**(探针:scrollTop 400→0,标记行被推离 900px)——这就是"漂移"的真身,也是 preventScroll 挡不住的原因(focus() 自身不滚了,但锚定补偿是布局变更触发的另一机制)。高亮关时无焦点行→锚点在视口内→补偿反而在**保护**视野,故无恙——开/关不对称彻底闭环。本地 harness 无法复现是因为其布局瞬间就绪、锚定无从介入。**修复**:高亮/焦点的**授予**等待树布局 settle 完成(campaign 期间 body 置 `data-vbm-tree-settling`,tree-view 的 reveal 焦点与 view-manager 的 restoreFocusSpot 均等待落地后再 focus(preventScroll);.focus 闪烁照常立即绘制);锚定本身**保留**(落地后它继续保护视野抵御迟到的内容增长)——注意 `overflow-anchor:none` 是错误方向(会连高亮关时的保护一起废掉),已论证并弃用。

**诚实记录**:本环境始终未能复现维护者所见症状;上述三路径是从代码审计推出的全部残余可能,均已封闭。若用户更新后仍复现,下一步应获取其复现条件(环境/关闭方式/症状形态/树规模/zoom),必要时出带 `__scrollTopLS` 写踪迹的诊断构建。

## #67/#68 轮(2026-09-04,v4.1.2 上架后的复验反馈)

**反馈**(leungwh,即 #66 报告者):
- **#67**:v4.1.2 高亮**关**时已能记住位置;高亮**开**时又失败——即残余轮反馈在正式版上的重现。
- **#68**:即使高亮关,只滚**半页**能记住;**滚好几页**后又全部失效——新的"深度不对称"线索。

**版本事实(首要澄清)**:v4.1.2(0beec262)只含 9c705125(clamp 补写 30 帧 + 三处 preventScroll);campaign 化(44f3a517)与焦点等 settle(1e4ef0a7)是**发布之后**的提交,用户尚未拿到。#67 与 1e4ef0a7 的锚定劫持机理(维护者 anchor-probe 已实证)逐一对应,预期已修;#68 的映射见下。

**v4.1.2 上 #68 的完整机理链**(代码+探针推演):
1. 深滚动(savedTop > viewH)使 chunk 门退让 → 同步整树解析 + 恢复赋值被 clamp;
2. v4.1.2 rescue 仅 30 帧(≈500ms@60Hz),慢机器的嵌套 `#tree ul ul` 迟布局未完成 → 预算耗尽放弃;
3. v4.1.2 滚动监听无握手,**打开瞬间的 clamp 值即被持久化**(如 2199 覆盖 2600),下次重开从污染值再来一遍、逐次劣化——"It all falls apart";
4. 浅滚动目标落在初始已布局区域 → 首次赋值即落地 → 正常——**半页成功/多页失败的不对称正来自惰性布局的前沿位置**。

**新实证:惰性布局死锁(HEAD 上仍存在)**——`scripts/harness/diag/diag-68-slow-settle-duel.js`(真实 action 弹窗 + userstyle 注入冻结样式模拟慢机器的分步迟 settle):
- **机理**:新解析的大树里,对**远离当前视口**的元素做样式变更(等价于迟布局的逆过程),Blink **不重新布局该子树**——读 scrollHeight/offsetHeight 强制布局也不覆盖远视口区(实测:解冻视口上方 F1 的 ul,computed height 已 2404px 但父 li 布局高度卡 20px、scrollHeight 卡在旧值;视口下方远处的 F3/F4 同样不布局)。
- **死锁**:savedTop 深于未布局前沿时,赋值被 clamp 在前沿 → 视口永远到不了未布局区 → 该区永不布局 → clamp 永不解除。campaign 活满 4.5s 后静默放弃,弹窗停在前沿位置(探针 PHASE A:目标 2600,终值 2199,**FAIL**);良性序(前沿先长过目标)campaign 爬升落地精确(PHASE B PASS)——探针首次在本地复现出与 #68 症状形态一致的行为。
- **推论**:44f3a517 的 4.5s 预算只解决"慢但会完成"的 settle;**前沿停摆(死锁)不受预算覆盖**。锚定补偿"决斗"在探针中未触发(增长本身被惰性布局抑制),维持为次级未证假设。
**历史复盘:为何记忆选项拆分(及更早)基本没人报过**(维护者问,"我们选择的修复真的完备吗"的起点)——两层答案,均已实证:
1. **问题类是 4.1.0 的 content-visibility 优化亲手制造的**(≤4.0.8 无 cv:换树后全树布局同步完成,一次性 `scrollTop = saved` 天然落地)。2026-08-27 性能轮给 `#tree ul li` 加了 cv:auto + contain-intrinsic-size——离屏行只剩占位高度、**视口不扫过就永不布局**;恢复深位置从此依赖"占位估算准确 + 渐进渲染追上"。#65/#66(8/30 起)恰在 4.1.0(8/28)上架后涌入。
2. **4.1.2 之前裸 focus() 一直在掩蔽**:v4.1.0 代码实证 `focusTarget.focus()` 无 preventScroll——每次重开视口被强制拽到高亮行。这个拽动同时兼任:①事实上的位置恢复(近似用户所在);②scrollIntoView 必须解析目标行→**强制目标区布局→天然破死锁**;③拽动的滚动事件回写存储→"重开回到高亮行"自洽闭环。拆分+preventScroll 正确地拔掉它之后,纯像素恢复失去了"访问目标区"这一关键性质,死锁裸露成 #67/#68。

**修复(已实施):campaign walk**——`scrollRescue` 增加停滞检测与带步进:连续 2 步 `applied` 无进展(仍被 clamp)即判定前沿停摆,从**带 0** 开始按视口步长(`clientHeight`)逐带赋值 scrollTop,**只在上带落地后才前进**(永不超前于自己正在强迫布局的前沿);某带未落地则**回卷带 0 重扫**(多趟,`walkTicks ≤ 80` 封顶,另享 30 rAF + 40×100ms 总预算)。视口扫过的区带被迫布局(cv:auto 的渲染相关性),walk 因此同时:加速慢 settle(访问即布局,快于等待)并**结构性破死锁**(增长在 clamp 上方也能被带到)。这是旧 focus-拽动"访问目标区"性质的有原则版本。握手/接管判定对 walk 步进值天然成立(均为 campaign 自身应用)。

**验证**:tree-view +3 契约(walk 破惰性前沿死锁精确落地/走步中间值不落盘/内容永不足时有界放弃于真实底部),全量 90 套件/3165 用例+lint 绿;E2E 差分实证——**diag-68 PHASE A 修复前卡 2199 FAIL → 修复后两趟 walk 精确落 2600 PASS**(时间线:趟1 350→2199 卡前沿→回卷带0→趟2 途中 F2 解冻 4953→7356→2450→2600),PHASE B/基线同 PASS;diag-issue65-66-scroll 7/7、维护者字面步骤 2600 精确、memory-layers 14/14、smoke PASS。

**对外口径**:#67 = 1e4ef0a7 修复、随下版发布;#68 = 44f3a517(预算+握手,斩断 v4.1.2 污染级联)+ 本轮 walk(封死锁),同版发布;两 issue 待发版后一并回复请用户复验。

## 4.1.3 实测残余轮(2026-09-05,维护者真机复现:"高亮开+两次弹窗之间展开很长文件夹+滚到深处→下次必漂移")

**headless 与真机的鸿沟**:此前全部探针在 headless 下首次 tick 时 scrollHeight 即为真实全量(整树在恢复赋值前已布局完),占位→真实的修正阶段在 headless 不存在——这正是六维矩阵全绿而真机必漂的原因。真机证据:维护者早前实测"换树后 ~250ms 内 scrollHeight 从 clientHeight 长到全量"。

**确定性复现**(`diag-413-highlight-drift.js`,真实 action 弹窗):种子=900 行长文件夹、每 5 行一条换行长标题(占位 1.67em ≠ 实际多行高),弹窗#1 真实点击展开(焦点=文件夹行)+分步滚轮式深滚;弹窗#2 用 userstyle 预置 `#tree ul li{height:17px!important}`(行冻结=占位几何)+Node 侧延迟释放(=修正涌现)。**修复前(88ca5bfc 的 walk v1)**:赋值被 clamp→campaign 启动→walk 每 ~100ms 一带健康推进(sh 早已全量、内容行同步)——**但共享预算(30 rAF+40×100ms)被前 1.6s 死锁期耗掉大半,第 30 带处(10500/13325)中途放弃,且放弃后迟到的 scroll 事件把镜像污染为 10500**(像素+内容+镜像三重漂移,与"一定发生"吻合:长文件夹越深越必现)。

**终局修复(三层)**:
1. **walk v4——自适应节奏+独立预算**:带落地前进 16ms 快轨,带停滞回卷时走 100ms settle 时钟(分步收敛窗口可达秒级,纯快轨会在前沿苏醒前烧尽预算——diag-68 回归实证);预算按深度缩放(⌈savedTop/视口⌉×4+150,封顶 2000);连续两趟零前沿进展且已存活 ≥3s(虚拟时钟)才"泊"在最佳可达位收尾——不足场景快速退出,分步场景活过死锁窗。
2. **campaign 作用域锚定压制**:快 walk 提前落地后,迟到的带增长触发滚动锚定补偿,把已落地视口拽走(时间线实锤:2600 落地后 2753→5157→7561 随 sh 攀升,非 campaign 赋值)——`body[data-vbm-tree-settling] #tree{overflow-anchor:none}`(neat.css;1e4ef0a7 弃用的方向错在"全局永久",作用域化只灭 campaign 期间的补偿决斗,稳态保护完好在恢复后继续)。压制期间 scrollTop 物理上只剩用户能动,接管判定从此只对真实滚动生效。
3. **稳定化门**:像素落地≠结束——campaign 以 100ms 节奏盯 scrollHeight,连续 3 次不变才算完成(期间接管判定照常);结束时几何已定型,锚定恢复时守护的就是最终视野。焦点授予(waiters)与锚定恢复都发生在稳定之后。
另:**give-up 宽限**——done() 后握手值保留 350ms,放弃自身迟到的 scroll 事件不再污染存储(修复前实测:存 13325→被改写 10500)。

**验证**:tree-view 78 用例(walk 组改写+稳定化门+宽限契约);全量 90 套件/3166+lint 绿;E2E 差分——diag-413 FREEZE(维护者复现)**修复前三重漂移→修复后 13322 像素精确+行 670 内容精确+镜像干净 PASS**;diag-68 双阶段 2600 精确 PASS;diag-issue65-66 7/7、66-drift 2/2、memory-layers 14/14、diag-413 默认模式 4/4、smoke PASS。探针旋钮(VBM_DIAG_THROTTLE/ROWS/FREEZE)入 rerun.sh 转发清单。

## 4.1.3 二次实测轮(2026-09-05晚,"第一次记住了,后面每次开位置都不一样")

**反馈**:同操作顺序,有时第一次重开确实记住且纹丝不动;之后每次继续开,落点各不相同。

**机理闭环(无需新复现即可从已证事实推出,且 LATE 探针实证了构件)**:真机的迟到修正波触发**内容稳定型锚定补偿**——视野内容不变、scrollTop 像素悄悄改变(探针 LATE:波来时行 521 纹丝不动、像素 8331→10334、sh 14127→16130,补偿全程内容稳定)——滚动监听把新像素回写;下次重开从新像素起步、遇自己的波再漂——**像素记忆跨会话随机游走**,每次落点自然不同。第一次"很好"只是那轮波恰好安静。另证:两次会话的占位镶嵌几何本就互不相同(连保存侧的滚轮跳跃都不保证每带物化,diag-413 默认模式实测两会话 sh 同为 16130 但同一行相差 2003px)——像素跨会话对比是伪命题。

**修复=行锚定记忆**:`scrollAnchor`("id@offset",视口顶缘 elementFromPoint 采样)随每次真实滚动与 scrollTop 一同持久化(generateTreeForTarget 的跳转持久化同步);campaign **有锚即武装**(像素瞬落也不信任瞬态几何);稳定化每步**复校行**(anchorAdjust:scrollTop += 当前沿顶偏移−保存偏移),行归位且几何稳定才算完成;泊定路径同样先校行。行不变式使内容稳定型补偿彻底无害(像素漂、行不漂、锚自愈)。

**验证**:+3 单元契约(真实滚动持久化锚/几何偏移下落至记忆行(+100px 差校正)/无 clamp 也武装校行),tree-view 81、全量 90 套件/3169+lint 绿(存储普查新键 scrollAnchor 入 other 段);E2E——diag-413 LATE 六断言全过:**持留带塌缩的异几何下仍落到保存行(521)**、波来行不动、锚稳定(519@-13~14)、再开同行;默认模式契约改为行基准(像素转 INFO);diag-68 3/3、65-66 7/7、drift 2/2、memory-layers 14/14。

## 对外回复(已发布,issues 已关闭)· Public replies (posted 2026-09-03, issues closed as completed)

**→ issue #65**(@Ownsin,回复其"关闭高亮后不再记住位置"反馈;[评论链接](https://github.com/windviki/vBookmarks/issues/65#issuecomment-5526103389)):

> Reproduced and fixed — thanks for the clear follow-up.
>
> The position was being saved correctly, but two bugs could throw it away when the popup reopened: the restore ran before the freshly rendered tree was ready (clamping the position back to the top), and the highlight could scroll the view back to its row — turning the highlight off changed the symptom, not the cause.
>
> Both are fixed in **v4.1.2**, now live on the Chrome Web Store: the popup reopens exactly where you left it, and the highlight stays without ever moving the position.
>
> Closing as fixed — if you still see it after updating to 4.1.2, please comment and reopen. Thanks again!

**→ issue #66**(@leungwh;[评论链接](https://github.com/windviki/vBookmarks/issues/66#issuecomment-5526104180)):

> Thanks — your steps reproduced it exactly.
>
> Two bugs fought over the saved position on reopen: a restore that ran before the freshly rendered tree finished rendering (reset to the top), and the remembered row scrolling the view back to itself (shifted). The race between them is why it "often" landed either way.
>
> Both are fixed in **v4.1.2**, now live on the Chrome Web Store, verified in a real browser with your exact steps — including the click-a-bookmark, scroll-around-the-page, come-back flow.
>
> Closing as fixed — if anything is still off after updating, please comment and reopen. Thanks for the precise report!

## 记录 · Record

- 修复提交:`9c705125`(src×3 + 测试×3 + diag + modules.md 契约同步)→ `87c7c677`(diag 增 D 场景 + 前后对照);先行 `a6a95292`(df9617af 遗留的 `vitest/valid-title` lint 门,与本 issue 无关);`5a1e6576`(文档)。v4.1.2 版本提交与 changelog 见 git发布序列。
- 本文档由 `issue-65-highlight-toggle.md`(首轮开关实现档案)+ `issue-65-66-scroll-restore.md`(回归分析档案)于 2026-09-02 合并;首轮回复命令与授权记录见 git 历史(2026-08-30)。
- issue 状态:#65/#66 已关闭(completed,2026-09-03);**残余轮跟进中**(见上节,随下一版本发布后可在 #66 追加评论请用户复验)——v4.1.2 已推送并上架,上节回复随关贴出(`gh issue comment` + `gh issue close --reason completed`,windviki 授权账户);留 reopen 通道,用户若复现异常可再开。
- 版本实情:v4.1.2 最终还并入维护者的 announce 区间修正(`10f8b03b`,过期版本新闻不再排队补放,+7 契约测试,changelog 双语已补 `a413e4ab`)——与本 issue 无关,记录于此备查。
- 关联:#63(关窗丢写→localStorage 影子,本案存储侧免疫的基础)、#58(高亮恢复原始设计)、4.1.1 分层记忆设计(`docs/issues/issues-62-64-2026-08-29.md`)。
