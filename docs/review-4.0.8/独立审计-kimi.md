# 4.0.8 独立审计报告（Kimi，第三轮）

- 审计对象：master(c4511eb)相对 v4.0.4 以来的全部改动；重点 = 4.0.8 相对 4.0.7 的新增（`git diff v4.0.7..master`，102 文件 +10946/-584)，次要 = 4.0.7 自身修改（`git diff v4.0.5..v4.0.7`,80 文件 +7366/-347)。
- 独立性声明：本报告在**未读** `docs/review-4.0.8/`、`docs/review-4.0.7/` 既有审计内容的前提下完成；对比与合流见文末附录（落盘后补）。
- 版本拓扑事实：4.0.7 在 fix-as-4.0.7 分支开发（基于 v4.0.5)，合并进 master 后分支继续打磨再 cherry-pick 回 master;master 自身承载 favicon 补全（原标 4.0.6)、announce、选项页重构等 4.0.8 内容。商店时间线：4.0.5 召回 → 4.0.6 = 4.0.4 内容回滚 → 4.0.7 死链视图 → 4.0.8 = favicon 增强首次面向用户。

---

## 一、favicon 增强（4.0.8 重点 · 自审）

范围：`src/favicon-enrich.js`（新，1019 行）、`src/favicon-fallback.js`(+19)、`src/neat.js` 接线、`src/popup.js`、`src/store.js`、`css/neat.css`。设计文档 `docs/favicon-补全设计.md` 已对照。

### 1.1 针对审计点名的四个问题的结论

**重复处理——基本干净。**
- 同 host 多书签：`onPlaceholder` 按 URL 触发、`enqueue` 按 host 去重（Map 合并 anchors)，一次链路服务全部行（favicon-enrich.js:941-959)。
- hydrate 竞态：`runItem` 先 `await hydrateDone` 再复查缓存，首开不再重复抓取（:798-812)。
- 采样去重：对比度统计按 src 缓存（`statsBySrc`),`registerEnriched` 只对未见 src 采样（:850-859);fallback 侧 `verdicts`/`statsBySrc` 双 Map 同为按 src 去重。
- fallback 的 load 委托只认 `/_favicon/` 标记（favicon-fallback.js:206),enriched data-URL img 不会被二次指纹采样。
- **例外见 F1(disable abort 误写失败标记）。**

**无限试错——三道闸齐全，无失控路径。**
- 站点级 failed 标记 24h（持久化，跨会话生效）；成功 30d TTL；服务商熔断 6h 按家独立。任何层面都不存在每渲染重试。
- 并发上限 6 + 每层 3-5s 超时；pending 队列无界但随 popup 生命周期消亡，侧栏场景由 host 去重与 failed 标记兜底。
- 视口优先：`<img loading="lazy">`(tree-render.js:161）保证只补全可见行，几千书签的首会话工作量被摊薄到实际浏览范围——防卡顿设计成立。

**卡顿——渲染路径零阻塞，但有两处可议。**
- `onPlaceholder` 同步只读内存 Map；网络全在队列异步；热替换就地换节点。成立。
- **F6（低）**:`hydrate()` 每次 popup 打开都 `storage.local.get(null)` 全量读（favicon-enrich.js:494)——图标缓存累积到 MB 级后，每次开弹窗反序列化整个 local 区（含死链扫描 blob 等）。不在首屏路径上，但是持续的内存/CPU 搅动；更省的做法是只读索引 + 命中时再取数据键（代价是热交换变异步）。当前取舍可接受，记录备查。
- **F7（低）**:L2 的 `<link>` 候选无数量上限（extractLinkIcons 全量返回，tryL2 逐个 3s 抓取直到一个通过）。一个声明几十条 icon link 的怪页面可独占一个 worker 数分钟。建议截断前 N 个候选（如 5 个）。

**服务商其他可能性——见 F5。**

### 1.2 发现的问题

- **F1（低-中）disable 时 abort 的 host 被误写 24h 失败标记。** `setEnabled(false)` abort 在途 fetch(favicon-enrich.js:975-985);AbortError 被各层 try/catch 吞成 null,`discover` 返回 null,`runItem` 落入 `writeFailed`(:813-824)——从未真正探测的 host 被标记"失败",24h 内不再补全，即使用户 10 分钟后重新打开开关。侧栏常驻 + 选项页拨开关的场景真实可触发。修法：`runItem` 在写失败标记前检查 `item.ctrl.signal.aborted`（或 `item.aborted`)，是 abort 就直接跳过（该 host 下次渲染自然重入队）。
- **F2（低）L2 非 base64 的 data: href 会中断整个候选循环。** 内联 SVG 图标常以 `data:image/svg+xml,<svg…>`(URL 编码、非 base64）出现；tryL2 构造的 candidate 在 `arrayBuffer()` 时才抛错（favicon-enrich.js:625-635)，异常穿透 for 循环被外层 catch 吞掉 → **后续候选全部不再尝试**（L2 直接判 null 落 L3/L4)。对照 tryL2Proxy(:715-717）是前置检查 + `continue`，两处行为不对称。修法：tryL2 同样前置校验、失败 `continue`；或顺带支持非 base64 的 data: 解码。
- **F3（低-中，设计层残留风险）L2 会匿名 GET 书签的完整 URL。** 渲染一行书签即触发对 `pageUrl` 的抓取（5s 超时）。对"动作型"书签（退订/登出/一键操作链接，token 在 query 里）这是用户未授权的副作用请求——Chrome 自家 `_favicon` 只取 favicon 等价物，不碰页面本体。选项页文案 "Requests only go to sites you bookmarked" 属实但掩盖了"会请求页面 URL 本身"。建议：L2 改抓 origin 根（`<link rel=icon>` 绝大多数全站统一），或对带 query 的 URL 跳过 L2 直连改抓根。本期不动也可接受，但应在设计文档里把该权衡写明白。
- **F4（低）DDG 占位图被当成功缓存 30 天。** `interpretDuckDuckGo` 对任意 2xx 判 'icon'(favicon-enrich.js:74-82),DDG 对未知域名返回 200+自家占位图（设计文档 §3.4 如实承认"不可判定")。后果：无图标站点被缓存一张第三方灰色占位图 30 天，且挤掉本扩展随主题自适应的默认 SVG;30d 内站点补了 favicon 也不会重抓。**仓库里已有现成技术**——favicon-fallback 对 Chrome 占位图做 FNV-1a 像素指纹——对 DDG/favicon.run 的占位图做一次指纹比对即可把"假成功"降级为 no-icon（写 24h failed 而非 30d success)。设计是有意权衡（"列表最后一层兜底")，但用已有机制可消除其代价，建议纳入 4.0.8 收尾或记为后续项。
- **F5（信息）服务商清单的备选评估。** 当前 favicon.run（首选，500 干净失败）→ DuckDuckGo（兜底，占位不可判定）。可议候选：① Google `s2/favicons?domain=` —— 覆盖率全网最高（Google 抓取缓存），但把用户书签域名送给 Google，与本扩展的隐私叙事张力最大；② icon.horse —— 隐私取向、无占位语义清晰；③ besticon —— 可自托管。favicon.run 是 2026-06 上线的独立服务，连续性风险由熔断+故障转移对冲（设计已述）。若要提命中率，icon.horse 作为中间家是低冲突选择；维持现状也站得住。**不建议在 4.0.8 加 Google S2。**
- **F8（低）开关重新打开后无补扫。** 注释自述 "No re-render sweep on enable — the user reopens or scrolls to refresh"(neat.js 接线处）；但 `loading=lazy` 的 img 一旦加载过，滚动并不会重燃 load 事件——已渲染行在当次会话内不会补全，要等重渲染（展开/折叠/切视图）或重开弹窗。注释的"scrolls to refresh"只对未加载行成立。可接受，文案/注释可更准。
- **F9（信息）正侧面。** octet-stream 魔数嗅探、HTML 200KB 流式截断、`<base href>` 与注释剥离、索引 v1→v3 迁移与自愈、配额异步预算+减半淘汰+quota 错误紧急淘汰+会话级 24 枚上限、pagehide flushIndex、provider 表 normalize——审计点名的"octet-stream 误拒/L2 无上限/hydrate 竞态/会话级无淘汰/<base>/注释残留"六项历史问题在当前代码中均已闭环。

### 1.3 隐私姿态

- L1/L2 直连站点：fetch 默认 `credentials:'same-origin'`，跨域不带 cookie——匿名抓取，成立。
- L4 把书签 host 发给 favicon.run/DDG——默认开（"开箱受益最大化")，有选项可关（faviconEnrichAgg)，选项页文案点名两家服务商与 6h 熔断，披露充分。默认外发域名是产品决策，本审计记录事实，不置可否。

---

## 二、选项页 4.0.8 改动（子代理 A 深查 + 本人复核）

范围：`pages/options.html`(+104)、`src/options.js`(+264)、`css/options.css`(+321)、i18n、截图与 diag 脚本。逐项核对过原 Views 组 18 个控件，15 新分区**无孤儿选项**;store.js 设置键全部有对应控件。

### 2.1 新引入的问题与 bug

- **O1（中）导入主存储写无错误兜底。** `await chrome.storage.local.set(backup.local)` / `chrome.storage.sync.set(backup.sync)` 未 try/catch(src/options.js:462-464)。配额或 sync 单条 8KB 溢出时 promise reject 穿透 handler：无成功/失败提示、不 reload、留下"local 已写、sync 失败、图标键未恢复"的部分导入。本人已对照代码复核确认。
- **O2（中）导入的图标键零校验、绕过字节预算。** 导入路径对 `vbmFavicon:*` 值直接 set(options.js:457-469);hydrate 读回同样不验 data URL 形态/大小（favicon-enrich.js:525-540 对照 writeEntry 的 96KB 上限 :357 与预算淘汰 :364-365——hydrate 末尾只 refreshBudget 不淘汰 :545)。伪造备份可塞入任意大字符串架空预算。渲染侧是 `<img src>` 上下文，XSS 风险低，但机制被架空是实的。修法：导入时按 writeEntry 同规则过滤（非 data:image/* 拒收、>96KB 降级或不收），或 hydrate 加形态校验。
- **O3（中低）存储横条 onChanged 无防抖。** options.js:332-339 对 favicon/书签数据键的每次写都触发全量 `get(null)` + 逐值 `JSON.stringify`——图标补全风暴期间若选项页开着，MB 级反复扫描。加 300-500ms 防抖即可。
- **O4（低）"书签数据"段漏归 `deadMarks`**(options.js:237 只认 deadLastScan|vbmDeadScan|visitStats)，用户标注数据落进"其他"。且横条所谓"书签"段实际是书签衍生数据（书签本体在 Chrome 书签库，不占 storage.local),hint 文案 "Storage space used by bookmarks…" 有误导——建议图例改 "Scan/marks data" 或 hint 说清。
- **O5（低）清图标缓存无确认、空缓存静默。** 同页清统计有 confirm(options.js:225)，清缓存没有（:340-349)；缓存为空时点击静默 return(:345-346)。两处破坏性操作交互不一致；缓存可重抓所以危害小，但一致性应补齐（或统一都不 confirm + 即时反馈）。
- **O6（低）开关联动缺口。** faviconEnrich 关时只禁用聚合子开关（:153-157);"备份含图标"开关与清缓存按钮无联动（缓存可能仍存在，不算错，但开关全关时备份开关的意义会令用户困惑）。
- **O7（低）导入即 reload 无摘要；导出文件名不含图标标记**(:425 只带日期)，含图标备份可能数 MB，导出前无体积提示。
- **O8（低）备份版本字段只写不校验**(:414-420 vs :442-446 只验 app/结构）。merge 语义缓解后果，记录备查。
- **O9（低）横条字节数是 `JSON.stringify(v).length` 近似**(:250-257)，同仓库 favicon-enrich 已有 `getBytesInUse` 先例（favicon-enrich.js:401-405)——两处口径不一致，横条读数与真实占用有系统性偏差（不含键名与内部计量）。
- **O10（低）onChanged 清缓存只在索引键被删时清内存 Map**(favicon-enrich.js:992)；索引恰好不在（debounce 窗口）时内存残留至下次 hydrate。低，自愈。
- **O11（低）`<p id="header-since">` 嵌在 `<h1>` 内**(pages/options.html:11-34),HTML 非法（浏览器容错，功能无碍）。
- **O12（低）头部 "GitHub" 按钮指向作者主页** `github.com/windviki` 而非项目仓库；项目入口藏在版本号按钮（#v408 锚点）里，与按钮文案预期不符。
- **O13（低）anchor 依赖 GitHub 渲染 docs/README.md**：仓库一旦新增根 README,`#v408` 锚点即断。低概率，记录在案。

### 2.2 布局与视觉（含实拍截图核对）

- 15 分区 + `columns:340px` multicol 宽屏不留白；窄宽换行 h1/#header-links 双 flex-wrap;danger 四处统一（清缓存/清统计/导入/重置）;hint 悬挂缩进对齐；行高 28px 落在总方案密度区间；全部走 `--vbm-*` tokens。**符合 docs/现代化演进总方案.md 的"安静感"路线。**
- 实拍 4K 全页截图核对：Icons 组四控件 + 清缓存 danger 按钮 + 存储横条（已用/总量总览行、四段图例含占比、键盘可达 tooltip）渲染正常；页头 since 副标题 + Donate/GitHub/Homepage/v4.0.8 齐整。
- 小缺口：`dead-proxy-server-clear`（清代理配置）未统一 danger 样式——4.0.7 存量，但 4.0.8 这轮"破坏性操作统一 danger"本应顺手收编。
- 7a0fa03("（4.0.9）"标注）定性：**提交消息版本标注失误，非未来版本内容混入**——dd8f115 已把版本号回固 4.0.8，功能全部收录进 4.0.8 changelog；残留仅 diag-usage-bar.js 头注释仍写 4.0.9。

### 2.3 i18n

- **I1（低，用户可见错误）zh_CN `optionFaviconBackupHint` 仍写"默认关闭以保持备份精简"**——5be1881 把默认翻为开之后只把 en 改成默认值中性表述，zh_CN 没跟上（其余抽查语种 zh_TW/ja/fr/de/ru/ar/ko 均为中性表述，仅 zh_CN 残留）。正是 AGENTS.md 警告的"旧译文静默滞留"场景。
- 新键齐备：announceV408*/whatsNew*/storageUsage*/optionFavicon* 在 en/zh_CN 均有真实译文；`whatsNewFavicon` 的 `$1$` placeholders 已补（84b6bf9 修复过缺 placeholders 的硬拒载）。

---

## 三、公告/whats-new/捐赠/调试指令（自审）

范围：`src/announce.js`、`src/donation.js`、`src/startup-flags.js`、`src/palette.js`(/secret)、`src/md5.js`、`docs/announce.json`、`pages/popup.html`。

- **版本门矩阵核对无误**:4.0.7→4.0.8 属 patch 级（sameOrNewerMinor)→ 捐赠卡静默；crossedInto(·,·,4.0.8) → whats-new 精确触发一次（recorded currentVersion 先行更新，不重燃）;3.x→4.0.8 走 upgradedToV4 排除 whats-new(v4 notice 接管叙事）；全新安装两者皆不触发。`upgradedToAnnounced` 在 `recordVer>currentVer` 降级场景不误燃。逻辑闭环。
- **远程 announce 让位链完整**：捐赠卡在 → 远程延后（不记 seen);localBannerShowing(whatsNewShown)→ 远程延后（neat.js:309-312)。donation.shouldShow 是布尔不是函数（donation.js:117)，无"恒真屏蔽"坑。sanitize 白名单（≤10 条、≤500 字符、display 枚举、链接逐条校验、文本转义）扎实；6h TTL + ETag + 4s 超时 + 全程静默失败；`announceEnabled='0'` 时零网络。
- **B1（中，键盘可达性缺口）`#whats-new` 与 `#announce` 不在受管 Tab 环里。** tabCycle 对所有 Tab preventDefault 手动循环（keyboard.js:1249-1251)，横幅区只收 `#donation`(:1168-1176)——注释写"donation / what's-new"，代码只实现了一半。后果：键盘用户永远到不了 whats-new 的两个链接；更实际的是 **announce 横幅的 × 关闭钮键盘不可达，而 once 公告未关闭前每次开弹窗都出现**——键盘用户无法摆脱它。现有测试与 harness 只构造 #donation(tests/keyboard.test.js:611,3042;verify-keyboard.js:902)，同模式缺口。修法一行：横幅查询改 `#donation, #whats-new, #announce`；测试同构补两个 case。
- **B2（低）捐赠卡 + whats-new 可同帧叠两条横幅**（实拍 popup-whats-new.png 证实）：捐赠卡只让远程 announce 延后，本地 whats-new 不设让位。whats-new 一生只火一次，让位即永不显示，故同帧是可接受的取舍；记录为观感事实。
- **B3（低）CHANGELOG_URL 硬编码 `#v408`**(donation.js:27)——每个版本都要记得手抬，维护隐患；与 O13 同源。
- **B4（低）`/secret` 调试指令随正式版发布**:md5 校验两个口令切 `vbm-btn-alt`（按钮层级实验样式，css/neat.css:3891+)。仅 cosmetic、无数据面；`PALETTE_RESERVED` 已加 'secret' 防自定义撞名（palette-commands.js:40)；错误口令会静默吞掉 Enter 并关闭面板（palette.js:386-392——`close(); return true` 不看 act 是否存在）。商店审核视角属未声明的隐藏功能，虽无害，建议发布 Notes 或代码注释里写明用途与口令管理方式；口令本身只用 md5 遮挡，可爆破，不适合承载任何未来真实能力。
- **B5（信息）md5.js 75 行自实现**：仅服务 /secret;Web Crypto 无 MD5，理由成立；tests/md5.test.js 有契约测试。

---

## 四、4.0.7 死链视图（次要 · 子代理 B 深查 + 本人实拍核对）

**前置事实**:`git diff v4.0.7..master` 对 `src/view-dead.js / dead-scan-sw.js / context-menu.js / keyboard.js / tree-render.js / announce.js` 全部为空——master 与 v4.0.7 tag 在这些文件上逐字节一致，本节发现全部直接适用于 master 现状。相关单测 589 例在 master 全绿。

### 4.1 验证为健全的主体

- "过去标注"生命周期与 docs/dead-过去标注语义.md §2 完全对齐（扫描中实时流入、导入自然残留、全覆盖扫描残留为 0)；双过滤器（分类 × 标注状态）正交，所有批量入口作用域均过可见集；排序三键共用比较器、live 期冻结、老备份回退稳定键序；SW 竞态主干（gen 代际守卫、取消后写缓存拦截、PAC 兜底拆除）成立；"全部 = 死链+受限+过去标注"与 tab badge（不含标注）语义各自自洽；琥珀色三处（pill/⚑/树 ×）共用 `--vbm-warning`;右键菜单 zoom 全高 + 视口钳制 + 背景右键重开比旧方案更稳。

### 4.2 发现的问题（master 现状仍存在）

- **D1（中）无缓存的"过去标注"视图对书签事件失明。** `scheduleRender` 闸门 = `views.isActive('dead') && lastScan && !live`(view-dead.js:1422),`onRemoved` 不 render(:1397-1417)。后果链：取消首扫（或"清除扫描结果"）进入无缓存标注视图 → 从树视图/他窗删掉一个已标注书签 → 标注被 prune 但行、分段计数、工具栏计数全部留旧到视图重新激活；更糟的是点该行 ⚑ 会把已删除 id **重新加进 deadMarks 并持久化**(toggleMark :984-998)——成为永不显示也永不清除的僵尸标注。单行删除按钮走 actions.deleteBookmark 只摘树/搜索 DOM，同样留尸行。修法：放开闸门或 onRemoved 时也 render。
- **D2（中）扫描中途删除书签，完成后仍是僵尸行。** 同一闸门的 `!live` 分支吞掉删除事件的 re-join;`onCacheWritten` 用旧 treeItems join 新缓存，被删书签照样渲染并计入 badge。修法同源：finish 时 re-join。
- **D3（中）`resumeIfNeeded` 不参与 gen 代际**(dead-scan-sw.js:354-371):SW 冷启动的 storageGet 在途时用户点取消，resume 回调无 gen 检查直接 start（内部重新 ++gen 使取消失效）,blob 已被 drop → prior 为空 → **被取消的扫描以全量新扫描复活**。窗口窄但直接违背"取消=从未发生"。`resume()` 消息路径（:300-311）同样不过 gen。修法：resume 路径携带/校验代际。
- **D4（中）= B1**:announce/whats-new 键盘不可达（独立复现，见三节 B1)；子代理另指出 Esc 链（keyboard.js:1009-1043）同样没有 announce 层。
- **D5（低）"全部"视图下"删除全部"与"全选"作用域分裂**:`selectableRows()` 含残留标注行，"删除全部"只删 resultRows()——同屏两个"全部"语义不同；确认对话框数量是诚实的，属刻意 mirror markAll，但用户预期会歪。想删残留只能切"过去标注"分段或选择模式。
- **D6（低）两条 start 链竞态可误拆新扫描的 PAC**:`begin()` 兜底的 `stopProxy()` 操作全局 `proxyOn`,旧链 gen 失配触发时可能拆掉新链刚装的 PAC → 该轮扫描代理静默退化直连，受限被误判死链落盘。修法：stopProxy 只清本代会话。
- **D7（低）导入备份原样带入 `vbmDeadScan` 活动 blob**:24h 内导入他机 → resumeIfNeeded 把外来 blob 当本地续扫（进度可倒挂 "5000/200");且选项页导入只 live 同步 deadLastScan,**deadMarks 不监听**——导入时开着的侧栏标注集合留旧到重开。
- **D8（低）SW 侧 storage 写失败全静默**(dead-scan-sw.js:75 不读 lastError)：配额挤满时整轮扫描结果无声丢失；blob 每 700ms 全量重写在大结果集下本身是写放大。
- **D9（低）background.js 冷启动代理清扫与续扫 PAC 安装竞态**（概率很低，后果同 D6)。
- **D10（低）注释漂移**:neat.js:299 称 announce 为 4.0.8 机制（实 4.0.7 已发布）;view-dead.js:1312 "only the SW writes it" 已被 clearScanResults 与导入路径推翻。另 store.js/options.js 里 "v4.1" 标注的 favicon 注释实为 4.0.8 落地（本人补）。

### 4.3 操作便利性与布局（含本人实拍核对）

- **D11（低-中）双工具条各有一个"全部"且计数语义不同**:`deadFilterAll` = 三类之和 vs `deadMarkStatusAll` = 当前分类内已/未标注——filter=仅死链 时同屏两个"全部"数字不同，文案无区分。实拍证实两条工具条上下紧邻，重复感强。
- **D12（低）"检测时间"排序下无 ts 行一律 ts=0 排最前**，与 marked 排序"未标注排最后"的处理不对称，新旧数据交界突兀。
- **D13（低）无缓存 + markFilter=未标注 + 有标注** → 残留整片隐藏后落 `!lastScan` 分支，显示"开始扫描"首次 CTA——对已标注用户文不对题（应走 deadNoneFiltered 式提示）。
- **D14（低）控制区层叠过厚**:risk banner + 标注横幅 + 代理条 + 双工具条同现时首行之前最多叠 5 层，600px popup 列表只剩一半（本人实拍 view-dead.png 计入"上次扫描"行达 6 行控制 chrome)。建议后续版本考虑把第二工具条与主工具条并拢或代理条收进芯片常态。
- **D15（低）状态 pill 裸 "0"**（无 HTTP 状态）对普通用户语义不明（本人实拍）；建议 "—" 或 title 说明。
- **D16（低）live 期每 700ms 全量 innerHTML 重建 + 每 tick 全量序列化 blob；`markedRows()` 未缓存，单次 render 调用 5-6 次且带 sort**——几千死链行时可感知。F3 空闲缓存未覆盖。后续优化项。
- 做得好的：Esc 分层完整；取消后焦点兜底 dead tab；取消自动切"过去标注"仅内存切换不落盘；fill 按钮焦点发光补齐。
- 4.0.7 已修且截图证实：代理条提示文字琥珀低对比已由 7788c82 撤掉 warning 色（d14c3c3 的截图早于该修复）。

---

## 五、测试覆盖（子代理 C 深查 · 全量实跑）

**门禁状态:`npm run test:run` 70 套件 / 2284 用例全绿(9.2s);`npm run lint` 零告警。** 注意:4.0.8 changelog 自述"69 个文件 / 2254 个用例"已漂移(7788c82 的 md5.test.js 与后续用例在其后落地)——发布前应刷新该数字。

### 5.1 覆盖良好的部分(抽查均驱动真模块,无复制实现/恒真断言)

- favicon-enrich.test.js(1578 行)对三个点名风险的钉住度:**无限试错 ✅**(24h 失败期内 0-fetch 断言、逐服务商熔断、6h 半开、熔断跨会话存活)、**重复处理 ✅**(同 host 并发只 1 次 fetch、hydrate 前入队 0-fetch、缓存命中零网络、采样一次)、**卡顿 ✅**(并发上限 6 实测、会话级淘汰、HTML 200KB 截断、预算减半、quota 故障注入)。
- 4.0.7 死链视图核心语义全部有真实断言:过去标注三类计数、双过滤器 12 组合矩阵、排序三键+老备份回退+live 冻结、清除结果、取消切标注+横幅、跨区键盘 6 用例、SW 竞态(cancel 落 setup 窗口 0-fetch、二次 start 无重复)、导入不重复计数。
- 备份含图标:导出开/关、导入开/关/quota 隔离三路径均为逐 key 真实断言;announce 版本区间/channel/once/dismiss/隐私开关/双让位/降级均有用例;whats-new 版本门 5 用例。

### 5.2 覆盖缺口(按严重度)

- **T1(中-高)announce ETag/304 条件请求全缺**:If-None-Match 头、304 只刷 ts、200 更新 etag(announce.js:194-229)零用例——这半边错了没有任何测试会变红。
- **T2(中)favicon 30d 成功 TTL 全缺**;24h 失败标记只测了"期内抑制",">24h 恢复重试"一侧未钉(若方向写反,表现为"永不再试"而非无限试错,测试同样不会发现)。
- **T3(中)setEnabled(false) 在途 abort 无用例**(favicon-enrich.test.js:1367 只钉停新入队)——与本报告 F1(abort 误写 24h 失败标记)互为因果:补上该用例,F1 即显形。
- **T4(低-中)pagehide→flushIndex 接线(neat.js)未测**;模块 API 已测。
- **T5(低-中)三个 favicon 新开关的默认值/持久化未直接钉**;`favicon-backup` 复选框在 options.html 的存在性无契约断言(options.test.js 的 DOM stub 自动衍生元素,删 HTML 不会红)。
- **T6(低)/secret 正向路径(正确口令→vbmBtnAlt 置位/清除)与 popup.js 启动恢复 class 无用例**,现有仅负向(错误口令静默关闭、裸 /secret 不被吞)。
- **T7(低)行级 dead-mark-btn 的 aria-pressed 未钉**(573f0bd 修复的一半只有 aria-label 断言)。
- **T8(低)#whats-new/#announce 元素存在性无单测 HTML 契约**(Docker smoke 层有端到端);KNOWN_KEYS 新增 3 键无迁移断言;CHANGELOG_URL 锚点字面量在 donation 侧自引用。
- **T9(低,与 B1 互证)tabCycle 横幅用例只构造 #donation**——#whats-new/#announce 的 Tab 环成员资格无任何层级断言。

---

## 六、总结与处置建议

**总体结论:4.0.8 的机制底盘是健壮的。** favicon 增强的防重复/防无限试错/防卡顿三闸设计与实现对齐且测试钉住;公告层与版本门矩阵逻辑闭环;选项页 15 分区无孤儿选项;4.0.7 死链视图主体语义与设计文档一致。测试 70 套件/2284 例全绿、lint 零告警。未发现高危(数据丢失/安全)级问题。

**建议在 4.0.8 收尾内修(全部是已落地功能的正确性补完,不涉 4.1.0 范围):**

| 优先级 | 项 | 一句话 |
|---|---|---|
| 高 | B1/D4 | `#whats-new`/`#announce` 进 Tab 环(+Esc 层)——announce × 键盘用户关不掉、每次开弹窗都出现 |
| 高 | O1 | 导入两个 storage.set 补 try/catch + 失败提示，杜绝静默部分导入 |
| 中 | F1+T3 | favicon abort 不写 24h 失败标记(runItem 查 signal.aborted)，并补该用例 |
| 中 | O2 | 导入图标键按 writeEntry 同规则校验(形态/96KB)，或 hydrate 加校验 |
| 中 | D1/D2 | 死链视图放开 scheduleRender 闸门/finish 时 re-join，消除僵尸行与僵尸标注 |
| 中 | D3 | resumeIfNeeded/resume 消息纳入 gen 代际，取消不再复活扫描 |
| 中 | T1/T2 | 补 announce ETag/304 与 favicon 30d TTL/24h 恢复两侧用例 |
| 低 | O3/O4/I1/D11/F2 | 横条防抖、deadMarks 归段、zh_CN 备份提示改中性、双"全部"消歧、L2 data: 前置 continue |
| 低 | O5/O6/D13/D15 | 清缓存交互一致化、开关联动、空态 CTA 纠偏、status pill "0" 改 "—" |

**留待 4.1.0 或记录备查(不在 4.0.8 动):** F3(L2 抓页面本体改抓 origin 根——行为语义变更)、F4(DDG 占位指纹降级——需先实测占位图稳定性)、F5(服务商增补评估)、D14(控制区层叠重构)、D16(live 渲染性能量级优化)、B4(/secret 去留决策)、F6(hydrate 全量读优化)。

---

## 附录 A：与既有审计的对照(独立报告落盘后撰写)

**既有审计**:① `docs/review-4.0.8/favicon-audit.md`(favicon 二轮，4 修复已落地为 0a5ec64);② `docs/review-4.0.7/00-死链视图-审计报告.md`(4 修复);③ `…/01-性能与视觉打磨.md`(去冗余徽标刷新+残留分隔线);④ `…/02-SW扫描器并发审计.md`(gen 代际修复 + aria-pressed)。

**收敛互证**(独立得出同一结论，增强置信):favicon 发现链/缓存/熔断主体健全;pagehide flush、索引写放大等 4 修复确已闭环(本报告 F9);死链视图过去标注生命周期、双过滤正交、排序、SW gen 主干、右键菜单重做均成立;测试无复制实现/恒真断言。

**本审计的新增发现**(既有审计未覆盖):F1(abort 误写失败标记)、F3(L2 页面本体抓取的副作用)、F4(DDG 占位 30d)、F6/F7/F8;选项页全部 O1-O13(该区域此前无专项审计);B1-B5、I1;D1-D3、D5-D16;测试缺口 T1-T9。

**与既有结论的三处张力(本报告持不同判断):**

1. **favicon-audit §3 保留项 #2 的评估偏轻。** 其称非 base64 data: href "丢弃后落下一 `<link>`"——实际 tryL2 中 `arrayBuffer()` 的抛错穿透 per-link 循环被外层 catch 吞掉，**后续候选全部不再尝试**(favicon-enrich.js:625-644);仅 tryL2Proxy 是前置 `continue`(:715-717)。行为比其评估更差(整个 L2 直连被判 null 落 L3/L4)，但仍属低危，修法一行(对齐 tryL2Proxy 的前置守卫)。
2. **02 报告 §5 "resumeIfNeeded 无新增并发风险" 与 D3 冲突。** D3 指出 resumeIfNeeded 的首个 storageGet 在途时 cancel 落窗，回调无 gen 检查直接 start(重新 ++gen)→ 被取消扫描以全量新扫描复活(dead-scan-sw.js:354-371)。窗口窄(storage 读 vs 消息派发竞态)，但语义上违背其自身修复的"取消=从未发生"。建议补 gen 校验。
3. **01 报告 "markedRows 不 memoize" 的决定与 D16 的量级担忧。** 不 memoize 是有依据的取舍(失效时机风险);D16 指的是 live 期 700ms 全量重渲染叠加单次 render 内 5-6 次带 sort 调用，几千行时可感知。两者不矛盾——维持现状，待真实量级反馈再议，记为 4.1.0 候选。

**数字漂移记录**:changelog 自述 "69 文件/2254 例",favicon-audit 门禁记录 2257 例，当前实际 70/2284——发布前刷新 changelog。另其 §6 记录 i18n verify 27 条菜单长度警告为"既有",发布门禁前需确认该数字未涨。

---

## 附录 B：修复落地记录(4.0.8 收尾,2026-08-17)

§六"4.0.8 收尾内修"清单的**高 + 中**两档已全部落地，每档均带回归测试。低档位与"留待 4.1.0"各项**在本附录落盘时原样未动**；其后的低优先级收尾见同目录《低优先级收尾-修复记录.md》。

| 项 | 修法 | 落点 | 新增测试 |
|---|---|---|---|
| 高 B1/D4 | tabCycle 横幅区由单个 `#donation` 改为 `#donation`/`#whats-new`/`#announce` 逐个可见性检查后收 `button, a[href]` 进环(DOM 序，即视觉序);Esc 链在捐赠卡之后新增 announce 层——派发到它自己的 ×,mark-seen 语义留在 announce.js。whats-new 不加 Esc 层：版本门一生只火一次、设计即无需关闭 | `src/keyboard.js`(tabCycle + Esc 链) | tests/keyboard.test.js +5(三横幅进环 ×3、announce Esc 可见/隐藏 ×2) |
| 高 O1 | 导入的两个 `storage.set`(local/sync)包进同一 try/catch：失败 alert 新键 `settingsImportError`(en+zh_CN 真实翻译，其余 41 语种 LLM 翻译,verify 0 错误)并 return——不再无提示重载进半应用状态；图标恢复写入保持原 best-effort 分支不动 | `src/options.js` 导入 handler + `_locales/*/messages.json` | tests/options.test.js +2(local.set 拒绝、sync.set 拒绝各一) |
| 中 F1+T3 | runItem 在 `discover` 返回后与 catch 分支各查一次 `item.aborted \|\| signal.aborted`:中止的运行不再落 `writeFailed`(此前 setEnabled(false) 把 abort 吞成的 null 误读为"无图标",给从未真正失败的主机盖 24h 失败章);finally 的 queue.delete 照跑 | `src/favicon-enrich.js` runItem | tests/favicon-enrich.test.js +1(在途 abort 不落失败标记、重新 enable 后可立即重试) |
| 中 O2 | 图标恢复写入前逐键校验：值必须是 string、`data:image/` 前缀(忽略大小写)、≤96KB(与 favicon-enrich.js MAX_ICON_BYTES 同值，options.js 为 classic script 无法 import,就地常量 + 注释互指);`vbmFaviconIdx` 索引键原样放行(hydrate 自愈),被剔键静默(缓存可重抓) | `src/options.js` 导入 handler | tests/options.test.js +1(合法/大写前缀保留，URL 引用/超大/非字符串剔除，索引保留) |
| 中 D1/D2 | ① scheduleRender 闸门去掉 `lastScan` 条件：无扫描缓存的"上次标注"视图也随书签事件 re-join + 重渲染，被删行即时消失，⚑ 不再可能把已删 id 写回 deadMarks(僵尸标注从源头消除,toggleMark 不加 id 存在性守卫——树侧标注入口依赖空 treeItems 时可用);② onCacheWritten 先用最新 getTree 重建 treeItems 再 refreshOverlays/updateBadges/render——扫描进行中删除的书签不再以幽灵行重现，徽标计数同源修正 | `src/view-dead.js`(scheduleRender、onCacheWritten) | tests/view-dead.test.js +2(无缓存标注视图删行即消;扫描中删除 → 完成后无幽灵行、badge=0) |
| 中 D3 | resumeIfNeeded 与 resume 消息路径在 storageGet 进入时捕获 `myGen`,回调先查 `gen !== myGen` 再动——取消(或新 start)在读取在途时落窗不再被过期快照复活扫描 | `src/dead-scan-sw.js` | tests/dead-scan-sw.test.js +2(冷启动读窗取消、resume 读窗取消;makeChrome 新增 asyncStorageGet 选项——快照在 get 时捕获、回调延迟，贴合真实 Chrome 语义) |
| 中 T1/T2 | 纯测试补完：announce 陈旧缓存带 If-None-Match 发请求、304 只刷 ts 不换 data/etag、无 etag 发无条件 GET 且 200 更新 payload+etag;favicon 成功条目超 30d TTL 重抓并替换陈旧图标、失败标记超 24h 允许重试(对照既有期内抑制用例) | — | tests/announce.test.js +2、tests/favicon-enrich.test.js +2 |

**验证**:全量 `npm run test:run` 70 套件 / 2301 例全绿(2284 → 2301，净增 17);`npm run lint` 零告警;`scripts/i18n.py verify` 0 错误(27 条菜单长度警告为既有，未涨——回应对照 §3 的门禁提示)。双语 README 的 v4.0.8 changelog 修复节已补六条并把用例数刷为 70/2301;AGENTS.md(keyboard/favicon-enrich/view-dead/dead-scan-sw/options 五行)与 docs/keyboard-model.md(§4 层 3、§7 矩阵横幅行)同步。

**未做**:本附录落盘时 Docker harness 尚未跑；后续已在同目录《低优先级收尾-修复记录.md》中补完整 `scripts/harness/run.sh` 并全绿。

**后续低优先级收尾**：本附录之后，低档项按《低优先级收尾-修复记录.md》完成 F2/F7/F8、O3-O7/O9-O13、I1、D5-D7/D9-D13/D15、B4（注释）、T4-T8 的落地与测试；维持原处置的仅剩 O8、D8、B2/B5 与 4.1.0 候选（F3/F4/F5/F6/D14/D16、B4 去留）。
