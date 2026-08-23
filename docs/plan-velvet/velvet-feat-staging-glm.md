# 暂存区视图（原最近添加视图）· GLM 精审定稿

> 基线：4.1.0 HEAD（七视图；80 测试套件 / ~2664 用例；en 560 i18n 键；`manifest.json` 4.1.0；release 走 dist 构建）。
> 上游：[`velvet-feat-staging.md`](velvet-feat-staging.md)（含 4.1.0 复审迭代记录）。**本文是其精修落地版**：需求清单冻结不动，方案节在上游基础上做了行号级复核后的修正与补全，可独立作为实施依据。
>
> **迭代记录 A（首轮精修，相对上游）**：三处机制表述修正（搜索 Esc 走 keyboard.js `search.escape()` 分支而非 view `onEscape`；`POSITIONAL_IDS` 只作用 bookmark 菜单，文件夹粘贴走 handler 动态显隐；`TreeText` 对文件夹本就递归，立项理由改为「格式不同」）；两处触点补漏（view-recent 无 `bookmarks.onChanged` 监听；`addTabToBookmarks` 已收藏时不返回书签 id）；实情说明（`persistScroll` 全库首例需测试；runtime-files.json esmEntries 只列入口；双页 `<menu>` 实测 15 个；打开确认受 `dontConfirmOpenFolder` 旁路；storage.onChanged 整对象重解析）。
>
> **迭代记录 B（本轮重审：「收藏」改为真实书签树操作 + 生效模型裁决）**——用户澄清：**「发送到暂存区不改书签树」只约束「发送」这个动作，不是全过程不改树**。暂存区是中间状态的工作台，用于批量组织已收藏与未收藏书签，最终仍要对接全插件各视图的具体动作；因此**暂存区里的「收藏/取消收藏」是真的对收藏夹（书签树）进行操作**，不是本地标记。据此本轮做了四处结构级修订：
> ① **数据模型重定义（§0.3）**：条目改为**双态**——`id` 非空 = 已收藏（指向真实书签节点），`id = null` = 未收藏（仅 `url`+`title` 快照，来源：stats 视图未收藏历史行、或取消收藏的落档）。首版的本地 `fav` 布尔标记**删除**；「已收藏/未收藏」从此是**真实状态**，与全 app 词汇对齐（快加星 = URL 是否已成书签，quick-add.js 按 URL search 切换 create/remove；stats 视图「已收藏统计行 / 未收藏历史行」正是这套词汇，view-stats.js:15-26）。
> ② **收藏/取消收藏落为真实动作（§3.4）**：收藏 = `chrome.bookmarks.create` 进 `quickAddFolderId`（与快加星、stats 历史行星标完全同语义）；取消收藏 = `chrome.bookmarks.remove`（条目留在暂存区落档为未收藏态，可再收藏）。内置「未收藏桶」合成组随之**删除**——未收藏不再是需要一个桶来安置的本地标记，而是每行的真实星标态；分组与收藏态正交且互不干涉。
> ③ **生效模型裁决（§3.0，新增）**：对比 Gmail/Photos/Material 3 的「选择→工具条→立即生效→toast 撤销」与购物车式「统一应用」，结合书签树实时同步的特性，**定案立即生效**；destructive 罕见动作（删除真实书签、清空暂存）保留 ConfirmDialog，其余全部走撤销。附同类产品调研（§14）。
> ④ **操作便捷性增补**：行内星标一键切换（快加星同款 hover 按钮）、混合选择的「作用于适用项 + 计数汇报」、归位即离场的「排水式」工作台节奏；stats 视图未收藏历史行成为暂存区的新入口（§2.3），补齐「批量收藏历史好内容」的最高频整理流。
>
> **迭代记录 C（真实路径走查：多批次多来源 + 分组归位 + 选择器快选）**——用户给出典型路径：去 stats 历史统计挑几条高频访问的 → 发送暂存；再从搜索挑几条 → 发送暂存；回到暂存区分成两组；每组直接保存到某个文件夹（相当于批量收藏）；文件夹选择器要留最近/高频/pin 的快选路径。据此五处增补：
> ① **「未收藏」桶恢复（§3.4，身份重定义）**：迭代 B 删掉的合成桶**恢复**，但不再是本地标记的安置处，而是**真实态推导的收件箱分区**——`id = null && group = null` 的条目渲染在置顶「未收藏」桶（多批次进来的历史内容在这里聚合等处理）；进入分组后离开桶（组内星标显示真实态）。桶头带「收藏全部」快捷与「新 N」计数（`lastSeenTs` 字段）。桶回答的问题是「还有哪些没安家的」——多来源累积路径下这正是工作台的进度条。
> ② **组级归位（§3.5 新增）**：组头右键「保存到文件夹…」（未收藏成员 create / 已收藏成员 move，完成即整组离场、空组自动解散）与「复制到文件夹…」；组头 hover「归位」按钮直达——「每一组直接保存到某个文件夹」一步完成，不必先全选再走工具条。
> ③ **文件夹选择器快选区（§4.1 新增）**：picker 顶部 chips 行 = pin（行内 PIN_ICON 切换、用户序）+ 最近使用（LRU ≤6，全部 picker 用途自动记录）；过滤输入从打磨项转正。两个 local 键（书签 id 设备本地），打开时按当前树修剪失效 id。
> ④ **stats 视图选择模式（§3.7 新增）**：路径第一步「去历史统计里挑几条」需要批量手势——stats 已收藏统计行与未收藏历史行均可选，动作按适用项降级（发送到暂存区/打开/打开为标签组/删除）。
> ⑤ **典型路径走查（§0.6 新增）**：把上述用户路径逐机制映射，作为实施的验收叙事。

> **迭代记录 D（工作台轮：用户自建组 + 组间拖拽 + 视觉轴对齐 + 性能收口，实施后回写）**——落地后按真实浏览器验证把原稿的三处「不做/不适用」修正为已实现，并把暂存视图的视觉协议钉死为既有多视图法则：
> ① **用户自建组转正（§3.5/§0.3）**：`groups[].manual` 字段——工具栏「新建分组」常驻（空工作台也可建组）、空组照常渲染组头（它是要往里拖的落点）、`pruneEmptyGroups` 不回收 manual 组；组菜单从「解散」扩展为**解散/删除**双语义（解散 = 成员脱组留场；删除 = 组连同成员离场，确认 + toast 撤销 `restoreGroup`），重命名走组头快捷按钮/F2/组菜单三入口。
> ② **组间拖拽转正（§3.5）**：行可拖入组头（入组并自动展开）/桶头（脱组）/他行（采纳该行分组）；**组头可拖到组头重排**（`reorderGroups` 把 dragged 挪到 target 前并重排 `createdAt` 保持升序不变量）——归属只写暂存模型，零书签树操作。
> ③ **视觉轴对齐法则（§3.1/§3.5/§11）**：组头/桶头/区头统一 tabgroups·dupes 组头配方（8px 左槽 + 4px 右槽、标题 flex:1 截断、快捷尾常驻）；行尾按钮与组头尾按钮、工具条最右图标共享同一右轴（右缘 8px）；时间分块表头升为 `--vbm-row-h` 同高，三种「发送」按钮竖直同轴；选择模式下**所有复选框共享 8px 轴**（成员行只缩进内容、不挪复选框）；成员行缩进 16px（选择态经锚点 margin 保持阶梯）。
> ④ **性能收口（§11）**：`chrome.storage.onChanged` 同文档回声防护（自身写入字节级跳过，消除 200ms 后的幽灵重渲染）；树事件提升/快照/重链 120ms 合并提交（文件夹级批量此前每个 onCreated 全量重绘一次）；`probePermission` 仅在结论变化时重绘；neat.css 删除第二份旧 staging 样式副本（~480 行级联覆盖，折叠态 ▸ 与 border 箭头重叠的根因）。真浏览器探针：进入视图 DOM 变更 642+5s 滴流 → 30 次级。**再收口**：折叠/拖拽/选择等 staging 专属动作改为**局部重绘**（只重建 banner+工具条+`#staging-items`，最近添加区 DOM 原样保留——不再每下点击都重挂 favicon）；已渲染状态下重复进入视图只原地更新桶头「新 N」计数（`lastRenderedRaw` 比对），真浏览器探针 entry churn 归 0。

> **迭代记录 E（层次与工具栏轮：层级范式 / 剪刀分割线 / 组头四键 / 选择条图标化，实施后回写）**——暂存是高频组间转移+折叠的工作台，dupes 式扁平组头不再够用，本轮把层级、按钮与选择工具条按既有视图范式重排：
> ① **层级范式转 tabgroups（§3.5/§3.1）**：组头/桶头/区头 gap 4px + 各 glyph 自带 4px margin = 统一的 8px 引导/步长节奏；**成员行（含「未收藏」桶成员）缩进 16px，favicon 列（32px）与组头标题/桶头星标同轴**——一眼看出谁在组内、谁散落在外；散行保持 16px 基线。窄行 `min-height: var(--vbm-row-h)`，与组头同高（此前 20px 行 vs 28px 头）；宽/panel 双行行自然增高（全库既有行为）。选择模式复选框仍在 8px 轴，成员内容经锚点 margin 28px 让 favicon 落在 56px（= 选择态组头标题/桶头星标列）。
> ② **剪刀分割线（§2.1）**：`#staging-list` 在 `#recent-head` 前插入 `.staging-cut`（虚线左右贯穿 + 剪刀 icon），最近添加区不再读成「又一个组」；局部重绘的锚点随之改到 `.staging-cut`。时间分块表头（今天/本周…）升为与上半区协调的 11px muted + 8px 左槽 + `--vbm-row-h` 同高，不再自成一套。
> ③ **组头四键（§3.5）**：右键菜单的解散/删除上浮为组头快捷尾——序 = 组特有对 [重命名][解散] 在左、与行尾同列的共享尾 [归档][删除] 在右（tabgroups「组特有靠左、共享尾与成员行列对齐」法则）；**删除恒为最右、danger 红**（死链/去重删除语义）。≤400px 容器只留 [归档][删除]（与成员行星标/移出两列严格对齐），重命名/解散退回 F2/组菜单。按钮自身的 Space/Enter 归按钮（不再冒泡触发组头折叠）。
> ④ **选择工具条图标化（§3.3）**：动作 rung 九键全部改 22px 图标按钮（打开/打开为标签组/收藏/取消收藏/分组/移动复制到/移出/删除所选/清空暂存——新增 OPEN/TABS/GROUP/STAR_X 图标，死链视图的 icon 思路），label 入 title/aria，整行不换行；删除/清空 danger 红。两 rung 封顶。修 bug：`openBookmarksInGroup(urls)` 无标题调用曾 `pickGroupColor(undefined)` 崩溃（staging/search/stats 三处入口同源受益，actions.test 补无标题用例）。

> **迭代记录 F（快捷归位轮：可自定义「移动到目录」快捷栏 + picker 过滤栏样式收口，实施后回写）**——选择工具条压到三 rung 上限后，第三 rung 让给最常用的「整批归位」：
> ① **移动快捷栏（§3.3）**：选择模式下动作 rung 下方新增 `.staging-shortcuts-toolbar`——用户自定义的**仅移动**快捷 chips（点击 = 所选条目按 §3.3 move 语义直接放入目标文件夹：已收藏 move 离场、未收藏 create 离场；复制仍走图标 rung/右键菜单）。每个 chip = tabgroups 颜色指示点 + 别名（缺省回退文件夹路径，`title` 挂完整路径），hover 揭示 ✎/×；尾部「＋」随时添加。数据 = local 键 `stagingShortcuts`（`{id, folderId, alias, color}` 数组，书签 id 设备本地，进 `KNOWN_KEYS` + census `'other'`；纯模型 `parseShortcuts/upsertShortcut/removeShortcut` 在 staging.js）。
> ② **编辑对话框（§3.3/§4.1）**：`#staging-shortcut-dialog` body-class 对话框（Esc/#cover/Tab-trap 全登记）——目标文件夹经**复用** `BookmarkFolderPickDialog`（legacy 单选）直选、别名输入、9 色 tabgroups 色板（`.tab-group-color` 原样复用）；保存即 upsert 回写。
> ③ **picker 过滤栏样式收口（§4.1）**：`#bookmark-folder-pick-filter` 的 ID 级 `width:100%` 曾压过 `.dialog > *` 的封顶列宽（宽面板里整条拉满、与其余对话框控件不对齐）——改为 `width: var(--dialog-content-width)` 并并入 `#edit/#new-folder` 输入配方（4px/6px padding、accent 焦点边）。
> ④ **入口补全**：chips 的加/改/删全部在 rung3 自身（＋/✎/×），无需右键菜单；跨文档经 `chrome.storage.onChanged` 对 `stagingShortcuts` 同款回声防护同步；删除 chip 即时 toast。

> **迭代记录 G（细调轮：40px 层级轴 / 快捷栏编辑态与宽度感知 / 工具栏渐进文本，实施后回写）**：
> ① **层级轴再收紧（§3.1/§3.5）**：成员行缩进升到 24px——**成员 icon 左缘（40px）= 散行标题左缘 = 组头标题/桶头星标左缘**（此前 32px 对 32px，缩进感不足）；组头 chevron→内容槽改为 16px（margin 12 + gap 4）对应调整；选择态锚点 margin 36px（复选框 8px 轴不变，icon 落到 64px = 选择态组头标题/桶头星标列）。成员行左缘加 2px 淡 accent 连接线（tabgroups color-line 语言的 token 化淡色版，不抢眼）。
> ② **快捷栏重设计（§3.3）**：普通态 chip 零附属按钮（点击 = move），管理动作收进**右缘双图标簇**——[＋] 添加（FOLDER_PLUS，tooltip 语义）、[pencil] 编辑模式开关（`aria-pressed`）；编辑态 chip 改**虚线 accent 边框**（点击 = 编辑的视觉信号），删除 = **悬浮在色点上的红 ×**（14px 圆），退出选择模式自动复位编辑态。左端「收藏到：」短标签仅 ≥520px 容器显示。
> ③ **动作 rung 宽度感知（§3.3）**：九个图标按钮内置 `.staging-btn-label`，容器 ≥520px **先给 danger 对（删除/清空）显示 icon+文本**，≥680px 再给收藏/取消收藏/分组/移动复制到，≥820px 全显——渐进补文本，不等全行放得下才一起出现。
> ④ **快捷栏与对话框细调（迭代 G 续）**：编辑态删除 × 精确覆盖色点中心（left 14px = 1px 边框 + 8px padding + 10px 色点半宽）；新增快捷后**键盘焦点自动落到新 chip**（←/→ 立即可走，不再只认旧按钮）；`#staging-shortcut-alias` 改 `--dialog-content-width` 封顶列宽；picker 打开时 `z-index: 210` 盖过编辑器（完整文件树可见，legacy 单选同样渲染 pin/最近 chips）。
> ⑤ **组头尾与引导条（迭代 G 续）**：组头快捷尾改 [重命名][归档][解散][移出暂存]——danger「删除分组」撤出组头（仅右键菜单/选择模式），最右槽 = 移出暂存（组+成员离场、树不动、确认+撤销）；剪刀分割线上下空隙加大；工具栏上方新增 staging guide 引导条（「在此整理书签，选择模式解锁批量操作」+ **不再提醒**，`stagingGuideDismissed` local 键入 KNOWN_KEYS/census）。

> **迭代记录 H（性能同源化，master 4.1.0 性能提交合入后回写）**：暂存视图按 master 的同一套手段收口——① **分片绘制**：全量重绘走 `paintListChunked`（pipes 模式——banner/工具条/空 `<ul>`/剪刀/区头随 head 同步落地，`#staging-items` 行按 60 首批 + 120 行/帧流入，recent 行受 `recentCount` 约束随 head 落地；新的渲染先 cancel 上一笔 paintHandle，局部重绘 `renderStagingNow` 同样先取消在途分片）；测试 double 无 rAF 时自动退化为单次 innerHTML（原行为不变）。② **content-visibility**：`#staging-items` 行加入 `content-visibility:auto` 花名册（500 行上限下屏外行跳过布局/绘制；`#recent-list` 维持 master 的排除决定）。③ **行级 i18n 提升**：行循环里 `stagingFromHistory/stagingRowFav/Unfav/stagingRemove` 与 recent 时间桶标签改为每次渲染解析一次（4.1.0 view-tabgroups 同法）。④ favicon 模板克隆/对比度彩度防护等 master 侧优化随合并自动生效。

> **迭代记录 I（展开折叠「手术式」DOM 更新——用户反馈全视图折叠变慢后回写）**：A/B 真浏览器探针（diag-fold-ab.js，3400 书签 / 240 标签 / 800 暂存条目同种子，对比合入 master 前的构建）定位到折叠慢的根因不在分片绘制本身，而在**折叠动作的整表重走**：dupes 组折叠曾走 refresh()（getTree→flatten→regroup→缓存回写→全量重绘，实测首帧 533ms 才见变化）；staging 组/桶折叠走 renderStagingNow()（800 行同步重建 + favicon 重挂，实测 129/217ms 冻结）；tabgroups 组折叠走全量 render()（58/60ms + 流式尾 250ms）。树视图折叠本就是 class 切换（同规模 75ms 首展开、折叠零重绘），无需改动。修复 = **折叠只动该组自己的行**（head li 原节点保留——焦点/拖拽/快捷按钮监听全部存活）：
> ① **dupes**（view-dupes.js）：renderGroup 拆 groupHeadHtml + groupMembersHtml；点击/键盘折叠改 foldGroupSurgically——head 原位更新 aria-expanded/chevron，成员行按 .dupes-member 连续块 remove / insertAdjacentHTML('afterend') 重插（keeper/日期/路径全走原生成器，零行为漂移）。实测折叠 533→2.6ms、展开 539→4.8ms（首帧）。虚拟滚动实验室（行不全会合）与测试 double 保持整表 refresh()/render() 原路径。
> ② **staging**（view-recent.js）：toggleGroupFold/toggleBucketFold 改手术式——head li 原位同步 chevron/aria-expanded，成员 .staging-member 连续块按折叠态移除/经 stagingRowHtml 重插（i18n 标签缓存提为 stagingLabels() 复用）；lastRenderedRaw 同步推进避免下次进入视图的补重绘。实测折叠 129→12ms、展开 217→55ms（首帧）。桶成员与组成员同配方。
> ③ **tabgroups**（view-tabgroups.js）：setGroupCollapsed 在非虚拟实验室下改 foldGroupSurgically——成员连续块以 li.vbm-row[data-group-id=gid] 界定 remove / 按 tabRowHtml（含 lastMember 连线收口）重插，窗口区/关闭组区 DOM 不触碰；浏览器侧 chrome.tabGroups.update 写透与 persistUIState 原样保留。实测折叠 58→3.2ms、展开 60→11.8ms（首帧）。
> ④ **i18n 缓存同源化**：三个视图的行标签缓存（dupesLabels/stagingLabels/tabgroupsLabels）从 render 内联提为函数，整表渲染与手术式折叠共用同一份解析。门禁：2861 vitest 全绿 / eslint 0 / build 自检 PASS / diag-staging-verify ALL PASS / verify-keyboard 164 pass / verify-scrollbars 748 断言 ALL PASS。

> **迭代记录 J（虚拟滚动修复 + 折叠记忆轮 + 六点反馈收口，实施后回写）**：
> ① **虚拟滚动实验室与 content-visibility 互斥修复**：虚拟画笔每次 re-window 用 innerHTML 重建窗口行，而 cv:auto 让这些新行跳过渲染与命中测试——6000 书签实测滚动后视口整段空白、直到下一次滚动才恢复（diag-vl-6000.js 复现：行已就位、elementFromPoint 打不中）。修复 = 虚拟模式下两个视图给列表挂 .virtual-paint 类（dupes/tabgroups render 处按标志切换），CSS 追加 #dupes-list.virtual-paint 等的 content-visibility:visible 覆盖（窗口本就约 40 行，cv 无收益且有害）。修复后探针 0 空白、re-window 35-56ms、树视图在去重滚动后依旧健康。
> ② **折叠记忆轮（六点反馈之 3）**：a) 暂存区上方新增真正的**暂存区组头** #staging-head——原 idle 工具条重构为可点击折叠的组头行（chevron + 加粗标题「暂存区」+ 计数 pill 右移、与 [新建分组][选择模式] 工具按钮同排右置，headCollapsed 随模型持久化）；b) 最近添加区的**今天/本周/本月/更早分块升级为真正的可折叠组头**（li.recent-group-li：chevron + 标题 + 计数 pill + 整组发送按钮，成员行挂 data-recent-group，recentGroupCollapsed 按桶持久化，折叠为手术式只动本桶连续行）；c) 两个大组头（暂存区/最近添加）行高 32px、标题 14px/600 加粗加大；d) 选择模式快照/恢复覆盖新增的 headCollapsed 与 recentGroupCollapsed（选择中强制展开）；e) 计数一致性裁决 = **统一 pills**：暂存区 pill 计数、aria 为「已暂存 N 条」，最近添加 pill aria 为「最近添加 · N」，均与工具按钮同排靠右。模型新增 headCollapsed/recentGroupCollapsed（staging.js，容忍解析，测试回填）。
> ③ **「分组…」按钮无响应修复**：needStagingGroupAssign 只写了 body class、neat.css 从未登记该对话框的显隐/遮罩规则——补 .needStagingGroupAssign #staging-group-assign-dialog（top 40px/opacity 1/pointer-events auto）与 #cover 规则（选择工具条图标 rung 的「分组」从此弹出分组对话框，真浏览器探针断言可见）。
> ④ **移出暂存文本层级**：.staging-remove 的 .staging-btn-label 从 820px 档提前到 680px 档（与收藏/取消收藏/分组/移动复制到同档，宽度合适即显示）。
> ⑤ **图标重画（六点反馈之 6）**：STAR_X_ICON = 全尺寸空心星 + 右下角 ×；STAGE_REMOVE_ICON = 全尺寸空心纸飞机 + 右下角 ×——主体不再缩放腾位（删掉旧的 scale(0.8) 平移方案），语义与旧图标一致。
> ⑥ **引导条通用关闭按钮（六点反馈之 2）**：staging-guide-banner 补会话级 ×（risk-banner/dead marked-banner 法则——本次弹窗内关闭、下次弹窗重现），「不再提醒」保留为永久关闭。
> 门禁：2864 vitest 全绿 / eslint 0 / build 自检 PASS / diag-staging-verify ALL PASS / verify-keyboard 164 pass / verify-scrollbars 748 断言 ALL PASS / diag-vl-6000 无空白 / diag-fold-memory 19 项 ALL PASS。

> **迭代记录 K（轴对齐收尾：暂存树连线 + 去重轴对齐，实施后回写）**：
> ① **暂存区树结构连线**：成员行左缘的扁平 2px accent 内嵌线换成真正的**树状连线**（tabgroups color-line 同机制、工作台化配色）——组头/桶头的 chevron/星标中心（16px）垂下 1px 细线，每位成员行在行高正中画一条到 icon 槽（40px）的横 tick，组内最后一名成员以肘形收口（staging-last），组头经 has-members 类只画有成员的前半段、折叠态不悬线、选择模式（复选框扁平工作态）整体隐去。**淡色虚线** = 3px 实/3px 空的 repeating-linear-gradient、muted 42% 混色 token（--staging-line），不抢内容。DOM 层成员行注入 .staging-connector（pointer-events:none，绝对定位不影响布局），手术式折叠重建同源带 lastMember。
> ② **去重视图反向轴对齐**：组头不动，成员行按暂存区工作台轴线重排——keeper-radio **中心落到暂存区散行 icon 中心（26px**，li 留白 8→18px）**，成员 icon 中心落到暂存区组内成员 icon 中心（50px**，a::before 0→6px 补位、icon 槽 40px 起）**。真浏览器探针 diag-axis-align.js 实测两轴逐像素吻合（26/50/15.5/24.5 全中）。
> 门禁：2864 vitest 全绿 / eslint 0 / build 自检 PASS / diag-staging-verify ALL PASS / verify-keyboard 164 pass / verify-scrollbars 748 断言 ALL PASS / diag-fold-memory 19 项 / diag-axis-align 7 项 ALL PASS。

> **迭代记录 L（组头标题修复 + 大组头折叠瞬时化 + 全视图折叠审计 + 4.0.8 对比，实施后回写）**：
> ① **标题修复**：`viewRecent` 文案此前只有 en 改写为 Staging——zh_CN 仍是「最近添加」、其余 41 个 locale 全是「Recent/最近」，暂存区组头与视图标签因此显示错误。全部非 en locale 标记 [TODO:] 并经 i18n.py LLM 重译（zh/zh_CN = 暂存区、ja = ステージング 等），verify/missing 双门禁通过。
> ② **两个大组头折叠瞬时化（用户反馈展开特别缓慢）**：根因 = 展开走整表重绘（暂存区组头展开 → renderStagingNow 全量重建 ~150-250ms；最近区组头折叠 → refresh() 全视图重绘+分片流）。修复 = **class 显隐法**——折叠/展开只是根类切换（display 零成本）：最近区**恒绘制**（行数受 recentCount 约束，折叠态藏而不删，数据事件照常刷新、不再跳 fetch）；暂存区折叠态不落 DOM，但**每次渲染都预建行串缓存**，展开时单次 innerHTML 投放缓存——实测展开 sync 3.2ms / settled 19ms（此前 150-250ms）。
> ③ **全视图折叠审计收口**：树 = class 切换（本就瞬时）；dupes/tabgroups 组折叠 = 手术式（前轮）；staging 组/桶 = 手术式（前轮）；最近时间桶 = 手术式（前轮）；**本轮补 tabgroups 窗口折叠手术式**——折叠时按「绘制态」捕获整块 DOM（组内折叠态以 DOM 为准）再移除，展开原样插回（虚拟实验室仍走整表）。至此全部视图的折叠均不触发整表重绘。
> ④ **4.0.8 对比审计（diag-cmp-408.js，6000 书签同种子）**：共享操作面实测——弹窗打开 226 vs 395ms、BIG 文件夹（1000 子项）展开 229 vs 281ms、折叠 ~9 vs ~8ms、树滚动 ~100-140ms 两者持平——**当前构建在共享面等于或快于 4.0.8**；4.1 多出的暂存/去重/标签组/死链视图及其机制是新成本来源（本分支已逐轮收口：折叠全手术、cv 与虚拟滚动互斥已修、favicon 重挂已局部化）。此前「比 4.0.8 慢」的体感主要来自两个大组头展开的整表重绘（本轮归零）与未命中缓存的 favicon 补全队列（4.0.6 起与 4.0.8 同源，非新引入）。
> 门禁：2864 vitest 全绿 / eslint 0 / build 自检 PASS / i18n verify+missing 通过 / diag-staging-verify ALL PASS / verify-keyboard 164 pass / verify-scrollbars 748 断言 ALL PASS / diag-fold-memory 20 项 / diag-axis-align 7 项 ALL PASS。

## 准备实现的功能

> 原始需求清单（冻结，逐字保留；下方「问题和方案」为其落地设计，迭代不改动本节）。

- 原本的最近添加视图有点太轻，一个视图承载的功能和便捷性太弱。准备升级其为暂存区视图。用户可以在任意视图把待后续操作的书签存到暂存区，不改动任何书签树或者行为，只是出现在暂存列表里。
- 暂存区视图分为上下两个区域。上面是暂存列表，下面是之前的最近添加。最近添加区域的菜单也可以发送指定书签到暂存区。最近添加区域的时间表头、以及每一行加悬浮按钮，向上的箭头，一键发送到暂存区。最近添加区域可整体折叠收起。
- 暂存列表提供选择模式用于批量整理。和死链和去重视图类似。选择后的工具栏支持清空，删除，收藏，取消收藏，移动或者复制到指定文件夹（提供文件夹选择器对话框）。设计理念和视觉参照之前的选择模式。
- 树视图除了菜单增加添加到暂存区之外，还应该支持：复制/移动到...、复制、剪切、粘贴配对操作，可以快速对单条书签进行复制或者移动操作。复制/移动到...对话框可选复制或者移动操作，然后复用上面提到的文件夹选择器。
- 树视图提供文件夹上的复制标题和地址的菜单（之前有，已经删除），提供二级菜单可选json，markdown或者文本清单
- 树视图的在此前/后添加文件夹、添加子文件夹，默认右键菜单折叠（提供选项页选项）。折叠为菜单项：添加文件夹，提供二级菜单：此前，此后，子文件夹
- 搜索视图增加选择模式，可以批量选择打开，或者打开为标签组，删除，取消收藏，发送到暂存区等
- 暂存区成为一个中转整理台之后，加强各视图的功能和信息互通，让整个插件的多个视图成为一个整体

## 问题和方案

### 0. 总体定位

**0.1 视图升级策略**：保留现有 view id `recent`、`#view-recent` 容器、`showRecentBookmarks`/`disableRecentView` 两个设置键不变，仅把视图标题改为「暂存区」（i18n 键名 `viewRecent` 保留、文案改写，走改文案的 `[TODO:]` 重翻译流程，43 locale 同步），内部拆成「暂存列表（上）+ 最近添加（下）」两个区域。理由：view-manager 的注册、隐藏/禁用、palette Go 命令、`Alt+N`、viewState 记忆全部继续工作，零迁移；下方最近添加的功能仍是原视图的一个子集。palette 的 `/recent` 命令保留并增加 alias `staging`（命令 slash 名 = view id 不变，alias 零机制改动）。

**0.2 暂存区的性质（迭代 B 修订）**：暂存区是**整理工作台（decision workbench）**，不是只读暂存池。「发送到暂存区」这个动作**不改书签树**（需求原文约束的仅是这一点）；但暂存区内部对条目执行的**整理动作是真实生效的**——收藏/取消收藏真的建/删书签，移动/复制真的改树，删除真的删书签。暂存区承载的是「批量决策」：把散落各视图的待处理项收集到一张工作台上，成批施加本就存在于各视图的动作（stats 历史行的收藏星、树菜单的移动/复制、删除、批量打开），而不是发明一套只在暂存区内部可见的影子状态。工作台的条目有**真实双态**：

- **已收藏条目**：`id` 指向树内书签节点，行上星标为实心（与快加星 `starred` 态同源）。
- **未收藏条目**：无书签节点，只有 `url`+`title`（+来源时间）快照；行上星标为空心。来源有二：stats 视图「未收藏历史行」直接发送；已收藏条目在暂存区里被取消收藏后**落档**（条目不离开暂存区，退为未收藏态，随时可再收藏）。

**0.3 数据与持久化（迭代 B 重定义）**：新增一个 `chrome.storage.local` 键 `staging`（`store.js` 的 `KNOWN_KEYS` 注册，**不进 `SYNC_KEYS`**——书签数据设备本地，与 `deadMarks*`/`visitStats` 同一决策，store.js:133-135 的「deliberately NOT here」注释区追加），值为一个 JSON 对象（schema 版本 `v:1` 即本文形态，未发版直接定形）：

```json
{
  "v": 1,
  "items": [
    { "id": "书签id或null", "url": "https://…", "title": "标题快照", "ts": 1234567890123, "group": "groupId或null" }
  ],
  "groups": [ { "id": "g_xxx", "name": "A", "collapsed": false, "createdAt": 1234567890123, "sourceFolderId": "可选", "sourceTabGroup": "可选", "manual": "可选" } ],
  "recentCollapsed": false,
  "unfavCollapsed": false,
  "lastSeenTs": 0
}
```

- `items` 是暂存列表的唯一数据源；`ts` 为加入时间；`group = null` 表示未分组。
- **双态由 `id` 表达**：`id` 非空 = 已收藏；`id = null` = 未收藏。`url`/`title` 是**恒在快照**——已收藏条目也保留（取消收藏落档、树事件同步、渲染兜底三处用到），`onChanged` 时随树更新（§0.5）。
- **收藏态没有独立字段**：真实状态由 `id` 派生，杜绝「本地标记与树漂移」的整类问题。首版方案的 `fav` 布尔删除。
- `unfavCollapsed` 是「未收藏」桶（§3.4，真实态推导的渲染分区，非 groups 成员）的折叠态；`lastSeenTs` 在暂存视图 activate 时更新，桶头「新 N」= 未分组且 `ts > lastSeenTs` 的条目数——多批次多来源累积时，回来一眼看到「新进多少、还剩多少没安家」。
- `groups` 只保存用户手动组、文件夹发送自动组与 tab 组整组暂存自动组（`sourceFolderId`/`sourceTabGroup` 记来源，重复发送合并，见 §1.1/§2.5）。分组与收藏态**正交**：未收藏条目可以待在任何组里（星标空心而已），收藏态切换不改 `group`。
- **迭代 D（工作台轮）**：`groups[].manual` 标记用户自建组——工具栏「新建分组」常驻、空组照常渲染组头、`pruneEmptyGroups` 不回收 manual 组（它是待填充的整理单元，不是残留）。渲染序按 `createdAt` 升序；`reorderGroups`（组头拖到组头重排）以「挪到 target 前 + 重排 createdAt 保持升序不变量」落地，用户组序因此可跨会话持久。
- 暂存数据存 local 不存 sync（体量可能大、且是设备本地工作台语义）。
- 读写沿用 store 的 200ms 防抖持久化（store.js:216）；写入后**显式调** `views.updateBadges()`（store.set 不自动触发，view-manager.js:1000-1003 仅在视图切换时重算）更新 tab 徽标（`badge()` 返回暂存条数，0 隐藏，遵循 `showTabBadges` 门控 :278-287）。
- **census 登记**：`tests/storage-usage.test.js` 的 `EXPECTED` 决策表（:57 起，测试 :111 扫真实 `store.knownKeys`）加 `staging: 'other'`、`folderPickPins/folderPickRecents: 'other'`、**迭代 F 加 `stagingShortcuts: 'other'`**——有界小数据（上限 500 条 × ~60B ≈ 30KB，双态快照略大于首版估算；快捷栏 ≤ 几十条），无独立字节预算，归 catch-all。不加表项 census 必挂。
- **跨文档一致性**：popup 与 sidepanel 可同时打开、各持 store 镜像。暂存视图参照 4.0.8 `deadMarks` 先例（view-dead.js:1410-1415）挂 `chrome.storage.onChanged` 监听 `staging` 键，**从 change 对象完整重解析整个 JSON 并替换本地态**（不信任 store 镜像、不做增量合并），外部写入时重渲染。
- **备份**：`staging` 在 local 区，自动随选项页备份导出；跨设备导入后由 0.4/0.5 的修剪/重链自愈，无需特殊处理。

**0.4 容量与去重（迭代 B 修订：按 URL 去重）**：
- 暂存列表以 **URL 为唯一性键**（Chrome 书签本就以 URL 为「页面」的身份；去重视图的存在说明树内同 URL 多份是要治理的病，暂存区不复制这个病）。同一 URL 只允许出现一条：重复发送（书签或历史行）不产生第二条，toast「已在暂存区」；重复发送文件夹只补入新 URL，并报告「新增 N 条，M 条已在暂存区」。
- 条目的 `id` 只是「该 URL 当前在树内的锚点」：树内同 URL 多个节点时锚定第一个命中（`buildTreeSnapshot` 的 url 索引，见 0.5）；锚点被删而树内仍有同 URL 节点时**重链**，不降级。
- 暂存区硬上限 **500 条**（常量，不做选项）。超过上限时新发送整体拒绝并提示「暂存区已满，请先清理」，不静默截断。
- 修剪：每次树重建（`onTreeGenerated`）后，对 `id` 非空的条目校验——id 失效则在 url 索引中重链；重链不到 = 树内该 URL 已不存在 → **不删除条目**，置 `id = null` 落档为未收藏态（用户显式整理过的工作集，树侧变化不悄悄偷走条目；真正离开暂存区只有 §3.3 的显式出口）。`chrome.bookmarks.onRemoved` 后走同一修剪路径。用户组/文件夹组因此变空则自动删组。

**0.5 与书签树事件的同步规则（迭代 B 扩展）**：现 view-recent.js 只监听 `onCreated`/`onRemoved`（:284-285）——本功能**新增 `onChanged` 监听**（`onMoved` 仍不需要：id 稳定，路径标签下次渲染经 `views.pathOf` 自取）：

| 树事件 | 暂存区反应 |
|---|---|
| `onCreated`（新书签，可能来自本插件收藏、也可能来自同步/他处） | url 索引命中某 `id=null` 条目 → **自动重链**（历史行暂存后他处收藏了同 URL，条目升为已收藏态——工作台与树永远一致） |
| `onChanged`（标题/URL 修改） | 命中条目更新 `title`/`url` 快照并重渲染（favicon 随新 url） |
| `onRemoved` | 修剪：重链 or 落档（0.4） |
| `onMoved` | 不动（id 稳定） |

url 索引直接复用 4.1.0 性能改造的 `buildTreeSnapshot` 单遍快照（树重建时已建，零额外遍历）；事件间隙的小批量校验走增量 `chrome.bookmarks.search({url})`（暂存条目级、非全树）。统一走 300ms 防抖的 `scheduleRefresh()`（view-recent 现有机制，:278-283），非激活时只置 `dirty` 标志、activate 时重放（:267-272；重放同时更新 `lastSeenTs`）。

### 0.6 典型路径走查（迭代 C 新增，验收叙事）

用户真实路径（多批次多来源 → 分组 → 组级归位）逐机制映射，实施后按此走一遍作为验收：

1. **「去 stats 历史统计里选几条高频访问的，发送暂存」**：stats 视图进入选择模式（§3.7，工具行选择按钮）→ 勾选若干行（已收藏统计行与未收藏历史行可混选）→「发送到暂存区」→ 已收藏行带 id、历史行带 url/title 快照进入暂存列表（URL 去重），toast 计数；tab 徽标 +1/N。
2. **「再从搜索里挑几条，发送暂存」**：搜索视图选择模式（§3.6）→ 勾选 →「发送到暂存区」→ 这些条目（全部已收藏）以散行落在分组区之下（§3.4 渲染序③）。
3. **「回到暂存区」**：激活时 `lastSeenTs` 更新；「未收藏」桶头显示「N · 新 M」（第 1 步进来的未分组历史条目全在桶里，M 条是本次新进）；已收藏散行在下方带着实心星标。
4. **「把他们分为两组」**：桶内与散行条目经行右键「分组…」或选择模式勾选 + 工具条「分组…」打开指派对话框——第一次输入新组名「工具」，第二次再建「阅读」（也可点既有组移入）；条目一旦有组即离开桶（§3.4）。分组本身零树操作。
5. **「每一组直接保存到某个文件夹」**：组头 hover「归位」按钮（或组头右键「保存到文件夹…」§3.5）→ 扩展后的 BookmarkFolderPickDialog，**顶部快选 chips**（pin 的常用文件夹一眼可选，§4.1）→ 选中目标 → 未收藏成员 create、已收藏成员 move，>10 条确认，完成即整组离场、空组自动解散；目标文件夹记入「最近」快选。另一组同理，第二次直接点 chips 里的最近项，两跳完成。
6. **收尾**：桶空、组空、列表只剩零星待删项 → 选择模式「删除所选」（ConfirmDialog + undo）或逐条移出；暂存区清空，tab 徽标归零。

路径全程书签树只在第 5 步（显式归位）被写——「发送不改树、整理动作真实生效」的边界与 §0.2 一致。

### 1. 文件夹相关（允许发送吗 / 发送过来允许展开吗 / 超大文件夹）

**1.1 文件夹允许发送，但按「扁平化收集」处理**：
- 发送文件夹 = 递归收集该文件夹下全部**书签**（跳过分隔符与子文件夹节点本身），每个书签作为一条独立 item（`id` 锚定、url/title 快照）进入暂存列表。
- 同时自动创建一个**虚拟分组**，组名取文件夹标题，`sourceFolderId` 记该文件夹 id；若已存在同 `sourceFolderId` 的分组，则合并进该组，不重复建组。新加入的条目默认 `group = 该组`；**已存在的条目不改动其 `group`**（避免发送动作覆盖用户已有整理），只补缺。用户手动创建的分组不受影响。
- 空文件夹（没有任何书签，只有子文件夹或为空）不产生任何 item，toast「该文件夹没有可暂存的书签」。
- 这样「发送过来的文件夹是否需要展开」问题自然消解：暂存列表**没有文件夹层级**，收到的是一组带组头的扁平书签；组头可折叠/展开，折叠后就是一条「文件夹名 + N 条」的摘要行。

**1.2 暂存区不保存书签树层级**：暂存区只做「书签的临时工作台」。真正的层级只有书签树一份；需要把暂存内容归位时用「移动/复制到文件夹」的文件夹选择器。这样避免在弹窗里维护第二套可编辑树、避免跨根（本地/同步）移动的复杂校验，也避免「暂存区里再嵌套文件夹」的递归语义爆炸。

**1.3 超大文件夹防护**：
- 发送前先用 `chrome.bookmarks.getSubTree`（或 `getTree` 后定位）计数书签后代数：
  - 书签数 > **100**：弹确认框「将暂存 N 条书签」，确认后执行；
  - `当前暂存条数 + N > 500`：直接拒绝并 toast，提示先移出/清空或改为发送子文件夹；不部分截断。
- 理由：静默截断会让用户误以为整个文件夹已暂存；部分暂存在后续「移动到…」时会造成树被半搬家的危险。

### 2. 视图布局、两区域交互与各视图入口

**2.1 上下区域（单滚动容器 + crossRowUl 先例）**：

- DOM：`#view-recent` 内改为一个滚动容器 `#staging-list`（`div[tabindex]`，注册为 view def 的 `listEl`），内部三段：
  1. `#staging-items`：暂存条目区——组头 + 成员 `<ul>`（仿 dupes 视图的组结构）+ 无组散行 `<ul>`；空态时渲染引导空态行（§11）。
  2. `#recent-head`：最近添加**区域头**（折叠箭头 + 「最近添加」标题 + 条数 + 「全部暂存」图标按钮，§2.2）；非行元素，不参与行步行（`crossRowUl` 的非 UL 分隔 div 跳过逻辑天然覆盖，keyboard.js:87-104）。**迭代 E**：区域头前加 `.staging-cut` 剪刀分割线（虚线左右贯穿 + scissors icon）——最近添加区是独立下半区，视觉上永不读成「又一个暂存组」；`.staging-cut` 同时是局部重绘（迭代 D）的锚点。
  3. `#recent-list`：最近添加区——**保留现有 id 与渲染路径**（时间分组表头 `recent-group-head` 为行内尾子元素的现状结构不变，view-recent.js:231-249），但从独立滚动容器降为 `#staging-list` 内的普通块级子元素（滚动父是 `#staging-list`）。
- 键盘零新机制：`listEl` = `#staging-list`，`views.lists()` 照旧单条注册；↑/↓ 在暂存区末行继续下行经 `crossRowUl` 进入最近添加区首行，反向同理；行 id 前缀 `staging-item-<idx>` / `recent-item-<id>`（暂存条目改用**列表序号**为行 id 键——URL 是唯一性键但不是合法 id 字符，同一 URL 也只有一条，序号在渲染期分配、`viewState.focus` 按 `data-node-id`（书签 id）或序号记忆，与既有 focusSpot 机制兼容），`viewState` 记忆无需特判。
- view def 增量字段：`badge: () => items.length`（暂存条数；stats 视图 `badge` 先例 view-stats.js:643）、`persistScroll: true`（双区域合一后滚动记忆更有价值；**注意：全库首个使用者**，view-manager.js:944/962 的消费端从未被真实视图行使，实施时补单测）、`typeAhead: false`（维持）。
- 上下文菜单体系：`context-menu.js` 的 `LIST_SEL`（:110-111，现值含 `#recent-list`）把 `#recent-list` 替换为 `#staging-list`（ownerInfo 捕获/滚动 dismiss 覆盖整个双区域）；行特征路由按 `staging-item-` 前缀与组头类名分发（§2.4/§3.5）。
- 最近添加区域头整区可折叠；折叠状态存 `staging.recentCollapsed`（跨会话保留）。折叠时只保留区域头，`getRecent` 刷新跳过（复用现有 inactive skip 思路）。现有时间分组表头（今天/本周/本月/更早）逻辑保持不变。
- 废弃说明：不给 view-manager 加 `extraLists`；若未来某视图需要**各自独立滚动**的双区（本设计明确不要），再评估该字段。

**2.2 最近添加区域的上箭头与区头动作**：
- 每行加 hover 显示按钮 `.staging-add-btn`（向上箭头 SVG，16px 网格 1.5px 描边，入 `src/icons.js` 常量），点击即把该书签（id + url/title 快照）加入暂存列表。
- 已加入（按 URL 命中）时按钮变为实心/打勾态（`.staged`，`aria-pressed="true"`），再次点击 = 移出暂存（与快速收藏星标的 toggle 心智一致）；变化后有 toast 与 tab 徽标刷新。
- 该按钮用 `.row-btn` 体系（与死链 ⚑/🗑 同款槽位，neat.css hover/focus-within 揭示规则 :3097-3102），保证右缘对齐；非 hover 不显示但槽位恒占。
- 区域头右侧加「全部暂存」图标按钮：把当前最近添加区全部条目（≤ `recentCount` 条）批量入暂存，去重汇总 toast（「新增 N 条，M 条已在暂存区」）。量级 ≤ recentCount（默认 20），不设确认框。

**2.3 菜单入口（各视图，迭代 B 扩展 stats 历史行）**：
- 「添加到暂存区」进入**书签行右键菜单**（`bookmark-context-menu`），树、搜索结果、暂存区以外的各列表视图（最近添加区、统计已收藏行、死链、去重成员行）都可见；无书签 id 的行不显示该项。实现上参照 `dead-mark-toggle`/`dupes-set-keeper` 的视图专属项先例：菜单项常态 `display:none`，按行上下文显隐。
- **stats 视图「未收藏历史行」（迭代 B 新增，双态条目的主入口）**：历史行没有书签 id，但携带 url/title——同样提供「添加到暂存区」（右键菜单项 + 行内 `.staging-add-btn` hover 按钮与既有即时收藏星并排同款槽位），发送后暂存为 `id = null` 的未收藏条目。这是「批量收藏历史好内容」高频流的入口：勾一批历史行 → 发到暂存区 → 在工作台上统一收藏/归位。即时收藏星保留不动（单条快路径与批量路径并存，同 recent 区上箭头与右键菜单的关系）。**stats 视图另配选择模式（§3.7，迭代 C）**——「去历史统计里挑几条」是典型路径，逐行 hover 点按撑不起批量收集；已收藏统计行与未收藏历史行都可批量发送。
- 文件夹行（树内与搜索结果 link-folder）的**文件夹菜单**也加「添加到暂存区」，走 1.1 的扁平化收集。
- 书签行菜单项在打开时按 URL 查询暂存状态：已在暂存区时标签显示「已在暂存区」并置灰；未加入时显示「添加到暂存区」。文件夹行菜单项不做逐条比对，保持可点击，重复发送只补缺并 toast 汇总。
- 暂存区自身的行右键菜单见 2.4；搜索视图选择模式的「发送到暂存区」见 3.6；tab-groups 视图入口见 2.5。

**2.4 暂存行渲染（迭代 B 修订：星标 = 真实态）**：
- 行内容用 `treeRender.generateBookmarkHTML`（tree-render.js:165；recent 区已在用 meta {path, badge, rightText, subText}）渲染标题/url；已收藏条目行 id 锚 `data-node-id`，未收藏条目 `data-node-id` 省略（context-menu 路由此差异分流）。
- 双行布局参照 recent 区现状（宽/panel 第二行 `subText` = `路径 · 相对加入时间`——未收藏条目无路径，`subText` = `来自历史 · 相对时间`；窄视口右槽 `rightText` 同理）。分组内成员行左缘按组缩进一档（与 dupes 成员行一致）。
- **星标槽**：每行右缘 `.row-btn` 槽位一枚星标按钮，恒可见——已收藏 = 实心（快加星 `starred` 视觉同源），未收藏 = 空心 muted；点击 = **真实切换**（收藏走 §3.4 create / 取消收藏走 remove），单条路径与批量工具条完全同语义（快加星的行内版）。`aria-pressed` 随态。
- 死标 ⚑ overlay 与 sync 点：**仅已收藏条目**进 `onRowsRendered` 重铺流程（view-recent 现有回调，:69/:259），死标/阻断琥珀标、本地/不可同步点自动覆盖——未收藏条目不在树内，无死活可言。
- 行右键：复用 `bookmark-context-menu`，暂存行上下文下追加视图专属项「移出暂存」「收藏/取消收藏」（随条目态切换标签）「分组…」（§3.3 指派对话框；显示/隐藏规则同 `dead-mark-toggle` 先例）；「移动到/复制到…」复用树菜单同名项（§5.1，未收藏条目上等价于「收藏到指定文件夹」，见 §3.3 注）；「删除书签」仅已收藏条目显示（未收藏条目无树可删，「移出暂存」即其删除）。
- 行打开走 `treeView.bookmarkHandler` 的同款管线（click/auxclick → `chrome.tabs.create`）；已收藏条目经 `ctx.onOpenBookmark` 钩子计 visitStats，未收藏条目打开不计书签访问统计（无书签 id 可计）。

**2.5 tab-groups 视图互通（落实需求第 8 条）**：

tab 不是书签，暂存区收条目（url/title）天然兼容——互通动作定义为「**收藏并暂存**」：

- tab 行右键菜单（`#tab-row-context-menu`）与最近关闭 tab 行菜单（`#tabgroups-closed-tab-context-menu`）各加「收藏并暂存」：书签侧按 `addTabToBookmarks` 的既有语义处理——`chrome.bookmarks.search({url})` 去重，未收藏则 create 进 `quickAddFolderId`（view-tabgroups.js:703-733、rootFolderId :59），已收藏则直接用既有书签 id。**API 改动**：现 `addTabToBookmarks` 在已收藏时只翻星标、不返回书签 id（:708-715）——扩展其返回已解析的书签 id（或新增 `resolveTabBookmark(tab)` 薄封装；现调用点不受影响），然后把条目（id + url/title）送入暂存区（未分组）。toast 汇总说明（「已收藏并暂存 / 已在暂存区」）。
- 组头菜单（`#tabgroup-context-menu`）加「整组收藏并暂存」：组内 tabs 按 index 排序、`tabsToBookmarks` 协议白名单过滤（bookmarkableUrl https?/ftp/file，:702）、逐个收藏进 `quickAddFolderId`（同 URL 去重），全部结果作为一个暂存组进入，组名取标签组标题、`groups[].sourceTabGroup` 记该标题（同标题再发送时合并，与 `sourceFolderId` 合并规则同构）。
- 防护：组内可收藏 tab 数 > **10** 时 ConfirmDialog 报数确认（open-all 阈值心智一致，含 `dontConfirmOpenFolder` 旁路同沿）；超暂存上限按 0.4 整体拒绝。0 个可收藏 tab（全部 chrome:// 类协议）toast 说明。
- 反向闭环：暂存条目整理后用「移动/复制到…」归位到树文件夹；tab 组「save-as-bookmark-folder」的既有路径不变。暂存区由此成为 tab 组 → 书签树之间的中转台。

### 3. 暂存列表：生效模型与选择模式

**3.0 生效模型裁决：立即生效，不做「统一应用」（迭代 B 新增）**

用户悬而未决的问题：动作是「点击即生效」还是「连目标与效果一起暂存、最后统一应用」。**定案：立即生效**。依据：

1. **同类产品的主流裁决一致**（§14 调研）：Gmail / Google Photos / Material 3 的选择模式全部是「选择 → 上下文工具条 → 点动作**立即生效** → toast 撤销」；「先攒后统一应用」只出现在购物车、照片导入器这类**需要提交前审阅汇总**的场景。暂存区已经提供了「攒」的那一半（收集待办项），如果动作效果也要攒，就是在工作台上再叠一层「预览态」——每行要显示「将删除/将移动到 X」的 pending 徽标，视觉噪音和状态机复杂度双倍，而收益（提交前反悔）已被「立即生效 + 撤销」覆盖。
2. **书签树是实时同步的活物**：统一应用意味着一个可能横跨数分钟的「待应用事务」，期间其他设备的同步写入、用户的树内手动操作都会使 pending 操作失效，apply 时需要整套再校验（目标文件夹还在吗、书签还在吗、URL 变了吗）——这是一套为零收益支付的复杂度。立即生效则每步都作用在真实当前树上，失败即时可见。
3. **全插件的动作原语全是立即式**：`actions.openBookmarks`、move/copy、`chrome.bookmarks.remove`、`undo.capture`/`undo.toastAction`、ConfirmDialog——立即生效 = 全部复用；统一应用 = 新造一台「计划操作引擎」。
4. **危险度分层用现成机制**（Confirm vs Undo 裁决启发式：高频低危 → 撤销；罕见高危 → 确认）：删除真实书签（罕见高危）= ConfirmDialog + undo 单步；清空暂存（大动作）= ConfirmDialog；收藏/取消收藏/移出/复制（高频低危）= 直接执行 + toast（取消收藏附撤销）。**唯一例外**：批量「移动到文件夹」对已选已收藏条目是真实搬树，量级可能大——沿用 `openBookmarks` 的 10 项确认阈值心智（>10 条时 ConfirmDialog 报数确认，受 `dontConfirmOpenFolder` 同款旁路），单步 undo 照挂。

**3.1 模式骨架**：完全复用选择模式既有机制——`selecting` 标志 + `selected` 集合 + 工具条整体切换 + 行点击切换成员 + capture 相 Space 切换聚焦行 + Esc 退出 + `parkRowFocus`/`parkToolbarFocus` 焦点保持 + `<ul class="selecting">` / 行 `.sel` 视觉。4.1.0 已有三套同构先例（死链/去重/tabgroups），本视图参照 tabgroups 的完整度：进入选择模式时**展开全部组折叠并快照、退出时恢复**（view-tabgroups.js:1205-1227 先例，含 selecting 期间停止 persistUIState）。`typeAhead: false`。
- **复选框轴与层级（迭代 D→G）**：行/组头/桶头全部走 8px 左槽——成员行与散行复选框同列；成员行（含桶成员）内容经锚点 margin **36px** 让 favicon 落在 64px = 选择态组头标题/桶头星标列（层级与复选框轴互不干扰，tabgroups grouped 行同法）；散行 favicon 28px 基线；组头三态沿用去重组头配方。普通态（迭代 G）：成员行缩进 24px，**成员 favicon 40px = 散行标题 = 组头标题/桶头星标**（淡 accent 连接线标记成员行），散行 16px icon/40px 标题基线；窄行 `min-height: var(--vbm-row-h)` 与组头同高。

**3.2 选择单元与作用域**：
- 选择单元是**暂存条目（URL）**；`selected` 存条目标识（列表序号或 URL，实现取其一，测试锁死）。
- 组头在非选择模式下点击 = 折叠/展开；在**选择模式下点击组头 = 全选/取消全选该组全部成员**（组头显示全选/半选/未选三态）。折叠的组同样可被组头整体选中。
- 「全选」作用于**全部暂存条目**（含折叠组内成员）；「反选」同样以全部条目为全集；「清除选择」只清选择集，不动暂存数据。
- **混合选择**（已收藏 + 未收藏混选）是常态而非边界：各动作「作用于适用项」，不适用的跳过，toast 按动作汇报（「已收藏 N 条」「其中 M 条已是书签，跳过」）。工具条按钮不因混合选择禁用——禁用会逼用户先做一遍视图内分类，恰是工作台要替用户省掉的功。

**3.3 选择工具条按钮语义（迭代 B 全表重写）**：

工具条为三条 `.vbm-toolbar` rung（tabgroups 选择条先例 + 快捷归位行，封顶三行）：第一 rung = 计数 + 选择集操作（文本按钮）；**第二 rung = 动作，迭代 E 起图标化**——九枚 22px 图标按钮（打开 OPEN / 打开为标签组 TABS / 收藏 STAR / 取消收藏 STAR_X / 分组 GROUP / 移动复制到 folder-star / 移出 plane-x / 删除所选 TRASH / 清空暂存 LIST_X），label 入 title/aria（死链视图的 icon 思路：语义无歧义者图标化），整行不换行；删除/清空 danger 红。`openBookmarksInGroup(urls)` 无标题调用已修（`pickGroupColor(undefined)` 崩溃，staging/search/stats 三入口同源受益）。**第三 rung = 移动快捷栏（迭代 F→G）**：`.staging-shortcuts-toolbar`——用户自定义「移动到目录」chips（仅 move 语义）；普通态 chip = 色点+别名（点击即 move、零附属按钮），管理经**右缘 [＋]/[pencil] 双图标簇**进入编辑态（虚线边框 = 点击编辑、色点上悬浮红 × = 删除），左端「收藏到：」标签 ≥520px 才显示；**动作 rung 宽度感知（迭代 G）**：`.staging-btn-label` 随容器变宽渐进显示——≥520px danger 对（删除/清空）先 icon+文本，≥680px 收藏/取消收藏/分组/移动复制到，≥820px 全显。详见迭代记录 F/G 与 §9 决策表。**全部动作立即生效**（§3.0）。

| 按钮 | rung | 作用对象 | 语义 |
|---|---|---|---|
| 计数（`.select-count`） | 1 | — | `selectCount` 带数量参数，复用既有键 |
| 全选 / 反选 / 清除选择 | 1 | 选择集 | 只改选择集 |
| 退出 | 1 | — | 退出选择模式 |
| 打开 | 2 | 已选条目 | 批量打开（按 url，`actions.openBookmarks`，10 项确认阈值沿用含旁路）——双态条目都有 url，全适用 |
| 打开为标签组 | 2 | 已选条目 | `actions.openBookmarksInGroup`（SW 管线，popup 关闭不掉单） |
| 收藏 | 2 | 适用项：未收藏条目 | **真实建书签**：逐条 `chrome.bookmarks.create` 进 `quickAddFolderId`（快加星/stats 历史行星同语义；建前查 url 索引，树内已存在同 URL 则直接锚定不重复建——与快加星去重一致）。条目升为已收藏态、**留在暂存区**（待继续归位组织）。toast「已收藏 N 条」+ undo 单步（逐条 capture，撤销 = 全部移除新建书签） |
| 取消收藏 | 2 | 适用项：已收藏条目 | **真实删书签**：逐条 `chrome.bookmarks.remove`（读 lastError）。条目**留在暂存区**、落档为未收藏态（id=null，快照仍在）——工作台不弄丢你正在整理的东西，后悔可再收藏或最终移出。toast「已取消收藏 N 条」+ undo 单步（capture 恢复书签并重链） |
| 分组… | 2 | 已选条目 | 弹出**分组指派对话框** `#staging-group-assign-dialog`（迭代 C：正文 = 既有分组按钮列表（组名 + 条数，点击即选）+ 分隔线 + 新分组名输入 + 确定/取消；body-class 对话框照登 `anyOpen`/`closeDialogs`/`#cover` 三件套），把已选条目从原组/未分组/「未收藏」桶移入目标组（新组随建；纯本地，不动树） |
| 移动/复制到… | 2 | 已选条目 | 打开文件夹选择器（第 4 节）。**已收藏条目**：move = 真实 `chrome.bookmarks.move`（>10 条确认，见 §3.0 注 4），成功后条目**离开暂存区**（归位即完成使命）；copy = 真实 `create` 副本到目标（原书签原位不动，条目留在暂存区）。**未收藏条目**：move/copy 均等价于「**收藏到指定文件夹**」（create 到目标；move 后条目离开、copy 后留下——与已收藏条目同律），这正是收藏默认夹之外的精确落点通道 |
| 删除所选 | 2 | 适用项：已收藏条目 | **删除真实书签 + 条目离场**（`chrome.bookmarks.remove` 串行、读 lastError、ConfirmDialog 报实际数量、`undo.capture` 每条 + 单步撤销，撤销同时恢复书签与暂存条目）。选中集中的未收藏条目：无树可删，等价「移出暂存」（toast 分别计数） |
| 移出暂存 | 2 | 已选条目 | 仅从暂存列表移除，树不动，toast 可撤销（撤销 = 按 url/title/group/ts 快照重新加入） |
| 清空暂存 | 2 | 全部条目 | 仅清空暂存列表（含分组），树不动，ConfirmDialog 确认 |

条目离开暂存区的出口只有三个：移动归位、删除、移出/清空（显式动作）——收藏态翻转和复制永远保留条目（工作台语义：它们是「整理中的中间态」，不是「待清理的缓存」）。「移出暂存」的撤销经 `undo.toastAction`（一次性动作，undo.js:173）实现，不走书签 undo 栈（书签树未动）。

**组粒度捷径**：以上是「先选择、后动作」的条目粒度；「整组直接归位」的组粒度动作在组头（§3.5，迭代 C）——组头 hover「归位」/组头右键「保存到文件夹…」，不必先全选该组。

**3.4 「收藏」的真实语义（迭代 B 重写，取代首版本地标记方案）**：

- **为什么删掉本地 `fav` 标记**：vBookmarks 的「收藏」词汇在全 app 有确切含义——快加星（`quickAddFolderId` 为目标、URL search 判态、create/remove 切换）、stats 视图「已收藏统计行 / 未收藏历史行」（view-stats.js:15-26，历史行星标 = create 进 quickAddFolderId，:497-526）。若暂存区再造一个「只在暂存区可见的收藏标记」，同一个词在弹窗里出现两种含义，且用户「在暂存区收藏了、树里却没有」的预期落空。**收藏必须是真的**。
- **收藏 = `chrome.bookmarks.create({parentId: quickAddFolderId, url, title})`**，先查 url 索引去重（树内已有同 URL → 只锚定 id，不建第二条——快加星同款防重复）。默认夹 = `quickAddFolderId`（默认书签栏）；要收进其他文件夹用「移动/复制到…」的未收藏分支（收藏到指定文件夹）。
- **取消收藏 = `chrome.bookmarks.remove(id)`**，与快加星的取消完全同义。条目落档为未收藏态留在暂存区——这是「批量退藏」与「删除」的本质区别：退藏留档（历史里还在、暂存区里还在，后悔有路），删除离场（书签与条目俱毁，只剩 undo 窗口）。
- **「未收藏」桶——迭代 C 恢复，身份重定义**：迭代 B 曾删除合成桶（理由：本地标记不该有家）。真实路径走查（§0.6）证明桶有真实价值，但价值不在「安置标记」，而在**收件箱语义**：多批次、多来源进来的条目需要一个默认聚合区，让「还有哪些没安家」一眼可见——这是工作台的进度条。恢复后的桶是**纯渲染分区（真实态推导，零数据字段）**：`id = null && group = null` 的条目渲染在置顶「未收藏」桶（空心星图标 + 条数 + 「新 N」计数，`unfavCollapsed` 存折叠态）；条目一旦进组即离开桶（组内星标照实显示，未收藏成员照样可以待在组里等组级归位——§3.5）。取消收藏落档的未分组条目也回到桶里（语义自洽：退藏 = 回到待安家状态）。桶头两个快捷：**「收藏全部」**（桶内全部条目一键 create 进 `quickAddFolderId`，带 undo——「先都收了再说」的一击）与折叠。渲染序定为：① 「未收藏」桶 → ② 各组（用户组/文件夹组/tab 组按 `createdAt` 升序）→ ③ 已收藏未分组散行（插入序、实心星标）——从搜索/树进来的已收藏条目落散行，从历史进来的落桶，来源与去向在布局上自然分区。桶头在选择模式下同组头规则（点击 = 全选/取消全选桶内条目）。
- **为什么「收藏后条目留在暂存区」而不是完成离场**：收藏（默认夹）通常不是整理的终点，而是「先保住、再归位」的中间步——收藏后接着「移动到…」精确归位才是完整流。真正表示「处理完毕」的出口是移动归位/删除/移出，工作台以「排水」节奏收敛（列表长度即进度），不靠收藏态偷偷帮忙清理。

**3.5 虚拟分组细则（迭代 B 去 fav 化）**：
- 分组是纯本地组织方式：每个条目最多属于一个真实组（`group` 一个 id 或 `null`）；移动到新组即离开旧组（不复制）。收藏态不是组、不占归属名额，组内成员的星标态可任意混合。
- 组头显示：折叠箭头 + 组名 + 条数 pill（`aria-expanded` 随折叠态）；**快捷尾四键常驻**（迭代 E→G）：序 = [重命名 EDIT][归档 folder-star][解散 UNGROUP][移出暂存 plane-x]——**迭代 G 把 danger「删除分组」撤出组头**（仅右键菜单/选择模式保留），最右槽改为**移出暂存**（组连同成员条目离场、树不动、确认 + toast 撤销，语义同删除分组但不再是树危险动作）；≤400px 容器只留 [归档][移出]（重命名/解散退 F2/组菜单），四键与成员行 [星标][移出] 同 28px 步长严格对列。右键菜单（**新增第 16 个菜单 `#staging-group-context-menu`**，双页现状各 15 个 `<menu>` 实测）：展开/折叠、重命名、**解散**（成员 `group = null`：未收藏回「未收藏」桶、已收藏落散行）、**删除分组**（迭代 D：组连同成员离场，确认 + toast 撤销 `restoreGroup`）、全选本组（选择模式外也可用）、分隔线、**保存到文件夹…**、**复制到文件夹…**（迭代 C，见下）。键盘绑定照 12 主菜单先例纳入 `keyboard.js` 的绑定清单（:917-961）与 Tab-trap `menuContainers`（:1174-1185）。
- **组级归位（迭代 C 新增，「每一组直接保存到某个文件夹」的直通动作）**：组是路径中最有意义的操作单元——用户按去向分组，然后整组一次落位。
  - 「**保存到文件夹…**」：打开扩展后的 `BookmarkFolderPickDialog`（§4.1），对组内全部成员施加 move 语义——**未收藏成员 create 到目标、已收藏成员 move 到目标**（混合组一次处理），>10 条 ConfirmDialog 报数确认（阈值心智同 §3.0 注 4），逐条 `undo.capture` + 单步撤销（撤销恢复书签原位并让条目回组）。全部成功后条目离场、**空组自动解散**（0.4 既有规则）——组随归位消失，列表以「组为单位排水」。目标文件夹记入 picker「最近」快选（§4.1）。
  - 「**复制到文件夹…**」：copy 语义——已收藏成员在目标建副本（原位不动）、未收藏成员 create 后**留场**（copy 不离场，§3.3 同律）；组保留。
  - 与条目粒度的关系：组级动作 = 「隐式全选 + 工具条同名动作」的快捷方式，语义与 §3.3 表格严格一致（只是作用域预置为全组成员），不引入第三套动作定义。
  - 文件夹发送自动组（`sourceFolderId`）的组级「保存到文件夹…」天然支持**换位**（从文件夹 A 整批发到暂存、整理后整组保存到文件夹 B）——这也是「移动/复制到…」的批量文件夹级形态。
- 文件夹发送自动生成的组，若用户手动解散，`sourceFolderId` 随之清除；以后再次发送该文件夹会重新建组。`sourceTabGroup` 组同理。
- **组间拖拽（迭代 D，转正）**：行（`li.staging-row`，锚点 `draggable=false` 让 li 成为拖拽源）可拖到**组头**（入该组并自动展开折叠组）、**桶头**（脱组归零）或**他行**（采纳该行分组）；**组头可拖到组头重排**（`reorderGroups`：dragged 挪到 target 前，重排 `createdAt` 保持升序不变量，自身/未知目标/紧邻后继 no-op）。全部拖拽只写暂存模型（`group`/`createdAt`），**零书签树操作**——分组是临时的虚拟分组，之后整组保存/转移才动树。**暂存条目在组内仍不支持拖拽重排**（`items` 数组序即插入序），组内排序作为未来候选，本期不做。

**3.6 搜索视图选择模式（落实需求第 6 条）**：

- **入口与形态**：搜索结果区顶部新增一条细长工具条（`.vbm-toolbar`，仅 searchMode 且有结果时渲染）：左 = 结果计数文本，右 = 选择模式图标按钮（`SELECT_ICON` 已有常量）。工具条随结果区一起 render，焦点保持走 `parkToolbarFocus`。
- **选择单元**：结果列表中**带书签 id 的行**（`#results` 的书签行）；link-folder 行与历史区行不可选。选择集合存书签 id。
- **选择动作条**（选择模式时工具条整体切换，单 rung）：计数 + 全选/反选/清 + 打开 / 打开为标签组 / 发送到暂存区 / 删除所选 / 退出。语义与 3.3 同名按钮完全一致（发送到暂存 = 逐条入暂存；删除 = 真实删除走 confirm+undo 链）。需求原文列有「取消收藏」，但搜索结果行全是书签，「取消收藏」与「删除」的树效果完全相同（都是 remove）——**取舍**：不设两个同效按钮，退藏留档的完整语义（取消收藏但保留条目）只在暂存区提供；想批量退藏先发暂存区再取消收藏，两步且每步可撤销。
- **键盘**：capture 相 Space 切换聚焦行选择；Esc 层级 = 退出选择模式 → 退出搜索模式。**机制精确化**：search 视图的 Esc 现走 keyboard.js 文档层 `search.escape()` 专属分支（keyboard.js:1119-1135，两级 quitSearchMode），**不存在 view def `onEscape`**。实现：在 `views.attach('search', {...})` 挂 `onEscape`——它在 `views.onEscapeActive()`（keyboard.js:1119）分支被调用，**先于** `search.escape()`，正好实现「先退选择模式、再退搜索模式」；单测钉死该顺序。Delete 在选择模式作用于所选（吞键先例：tabgroups 的 capture 相 keyup）。
- **与搜索输入的共存**：搜索框持有键盘输入焦点是搜索视图的主状态；选择模式的行点击/Space 走列表侧，输入框 `typeAhead` 语义不变（选择切换只认 Space 与点击，与死链/去重一致）。

**3.7 stats 视图选择模式（迭代 C 新增，批量收集的另一半入口）**：

- **动机**：典型路径第一步是「去 stats 挑几条高频访问的」（§0.6）——搜索视图有选择模式、stats 没有，恰是「批量收集」最常用的来源视图缺批量手势。
- **入口与形态**：与搜索视图同款（§3.6）——stats 列表区顶部细工具条（`.vbm-toolbar`）：左 = 计数，右 = 选择模式按钮；选择模式下工具条整体切换，单 rung。
- **选择单元**：**已收藏统计行与未收藏历史行都可选**（这正是「已收藏和未收藏书签的组织」的源头发动机）；选择集合存 url（两类行的统一键）。混选是常态。
- **选择动作条**：计数 + 全选/反选/清 + **发送到暂存区** / 打开 / 打开为标签组 / 删除所选（仅适用已收藏行，真实删除走 confirm+undo） / 退出。语义与 §3.3 同名按钮完全一致，混合选择按适用项降级（§3.2）。
- **键盘与 Esc**：capture 相 Space 切换、Esc 退出选择模式——stats 无二级 Esc（不像搜索要退搜索态），走视图 `onEscape` 既有机制即可；Delete 在选择模式作用于所选（适用项）。
- stats 视图本身无搜索输入框（`typeAhead` 现状 false），与选择模式的输入焦点无冲突。

**3.8 单条与批量的双轨（迭代 B 新增，操作便捷性）**：

- **行内星标**（§2.4）是单条快路径：hover 一键真实切换收藏态，无需进选择模式——对应 Gmail 里「单封邮件直接归档」与「多选进工具条」的双轨。
- **行内「移出」**：星标旁同款 `.row-btn` 槽位一枚移出按钮（×，hover 揭示），单条移出可撤销——不强迫批量心智。
- **右键菜单**为中路径：单条的全部动作（收藏/取消收藏/移动到…/复制到…/删除/移出）都在行右键菜单可达（§2.4）。
- 四条路径（行内按钮 / 右键 / 组头 / 选择工具条）语义严格同一套（§3.3/§3.4/§3.5），只是聚合度不同——同一心智、四种粒度（迭代 C 补组头一档）。

### 4. 文件夹选择器（扩展复用 BookmarkFolderPickDialog）

**4.1 形态**：4.1.0 已有两个相邻组件——`CopyMoveDialog`（`#copy-move-dialog`，tab-groups 的「复制 vs 移动」两按钮问询，dialogs.js:341-389）与 `BookmarkFolderPickDialog`（`#bookmark-folder-pick-dialog`，仅文件夹的扁平缩进列表 + 自带 ↑/↓/Home/End 行导航，dialogs.js:394-512）。**不新建任何对话框、不引入第二个名为 CopyMoveDialog 的组件**；定案为扩展 `BookmarkFolderPickDialog`：

- 签名扩展为 `BookmarkFolderPickDialog.open({ dialog, mode = null, onPick(folderId, action) })`：
  - `mode = null`（本功能的默认）：底部按钮区为 **[移动到此处] [复制到此处] [取消]** 三按钮，选中文件夹后点动作按钮即 `onPick(folderId, 'move'|'copy')`——**一次对话完成选位置 + 选动作**。
  - `mode = 'move'|'copy'`：锁定动作，按钮区只显示对应动作 + 取消（保留给未来独立快捷入口）。
  - **旧调用兼容**：tab-groups 现有调用（`onPick(folderId)` 单参、纯选择语义）不受影响——`action` 缺省为 `'pick'`，按钮区维持单「选择」形态（现状）。
  - **双态条目的按钮文案**：选择集含未收藏条目时，按钮副文案注明「未收藏条目将收藏到此处」（i18n `folderPickFavNote`）——移动/复制对未收藏条目的等价语义（§3.3）在对话里说清楚，不藏在文档里。
- **快选区（迭代 C 新增，从打磨项转正为标配）**：picker 结构自上而下 = ① **快选 chips 行**：pin 的文件夹在前（用户序 = pin 操作序）+ 最近使用在后（LRU ≤6，已 pin 的不重复出现）；chip = folder-plus/时钟图标 + 文件夹名（`title` 属性挂完整路径 hover 提示），点击即选中目标并保持动作按钮态（再点 [移动/复制] 完成，或 chip 即选即确认——实现取「chip 选中 = 选中目标」与列表行同语义）。② **过滤输入**（原打磨项转正：文件夹多时即时过滤缩进列表，`folderPickFilter` 键已预留；**迭代 F 样式收口**：ID 级 `width:100%` 曾压过 `.dialog > *` 的封顶列宽，在宽面板里整条拉满——改为 `width: var(--dialog-content-width)` 并并入 `#edit/#new-folder` 输入配方）。③ 全量文件夹扁平缩进列表（现状）。
- **pin 与最近的数据**：两个新 local 键 `folderPickPins`（用户手动 pin 的文件夹 id 数组）与 `folderPickRecents`（最近目标文件夹 id 的 LRU 队列）——**必须 local**：书签 id 是设备本地标识，跨设备 pin 名录无意义。pin 交互 = 每个文件夹行尾 PIN_ICON 图标按钮（`PIN_ICON` 已有常量）切换 pin/unpin；recents 在**每一次成功的目标选择**后自动记录（含 tab-groups 既有用法、组级归位、移动/复制/收藏到文件夹——全部 picker 用途同源受益），去重前移、超 6 截尾。**失效自愈**：两键在 picker 打开时按当前树过滤（id 不存在的直接剔除写回）——与 staging 条目同款修剪纪律，但无需监听器（惰性修剪够了）。
- 数据源维持现状：open 时 `chrome.bookmarks.getTree` 全量 walk 收文件夹、扁平缩进按钮列表；快选 chips 的存在感来自「两次归位之间通常目标高度重复」的真实路径（§0.6 第 5 步，第二组直接点最近 chip 两跳完成）。
- 已知怪癖随扩展一并正规化：现 `close(wasOpen)` 参数语义反置（`close(false)` 才 restoreFocus，dialogs.js:449-454）——扩展时改为显式 `{ restoreFocus = true }` 选项，两处旧调用点同步更新，`tests/dialogs.test.js` 锁死新语义。
- 目标为书签当前父文件夹时：move = no-op + toast；copy = 在同一文件夹产生副本（允许）。
- 完成后 `chrome.bookmarks.getTree(treeView.generateTree)` 刷新树与 pathMap；tab 徽标与暂存列表即时更新。
- 对话框已登记进 `anyOpen()`/`activeEl()`/`closeDialogs()` 三处清单（:600/:608/:682）与 `#cover` 点击关闭，modal Tab trap 与 Esc 关闭零新增机制。

**4.2 复用范围**：暂存区「移动/复制到…」、树菜单「复制/移动到…」共用同一个扩展后的 `BookmarkFolderPickDialog`；将来 quick-add 目标文件夹选择、`/add` 参数化创建也可复用。tab-groups 的既有用法不动。

### 5. 树视图：复制/移动、复制、剪切、粘贴

**5.1 「复制/移动到…」**：树内书签行右键菜单加一项「复制/移动到…」，打开扩展后的 `BookmarkFolderPickDialog`（`mode=null`，三按钮形态），对单条书签执行与 4.1 相同的 move/copy。这是**直接完成**的快捷操作，不走内部剪贴板。该菜单项无位置语义，树外列表（含暂存行，见 2.4）同样可用。

**5.2 内部剪贴板（复制/剪切/粘贴配对）**：
- 新增会话级内部剪贴板（模块内状态即可，不进书签树、不进 storage；popup 关闭即清空）：`{ mode: 'copy'|'cut', id, title }`。**作用域注明**：popup 与 sidepanel 是两个文档，剪贴板各自独立、互不可见——可接受（工作台语义本就按窗口），不引入 storage 同步。
- 书签行右键菜单：
  - 「复制」：记录 `{mode:'copy', id}`，toast「已复制：标题」；不改变书签。
  - 「剪切」：记录 `{mode:'cut', id}`，toast「已剪切，去目标文件夹粘贴（Esc 取消）」；树中该行加 `.cut` 淡化态（velvet 状态语言落地时统一收口为 token），直到粘贴/取消/剪贴板被覆盖。
- 文件夹行右键菜单（树内）动态显示「粘贴到此处」：
  - 剪贴板为空：不显示。
  - mode=copy：在目标文件夹末尾 `chrome.bookmarks.create` 复制一份；剪贴板保留（可连续粘贴到多处）。
  - mode=cut：`chrome.bookmarks.move(id, {parentId})` 到目标文件夹末尾，成功后清空剪贴板；目标为原父文件夹时 no-op 并清空剪贴板。
- 粘贴后走 `getTree(generateTree)` 刷新；若剪贴板书签已被删除，toast「书签已不存在」并清空剪贴板。
- 剪贴板仅接受**单条书签**（需求原文就是「单条书签」）；文件夹不提供复制/剪切（文件夹的复制/移动用现有排序/拖拽或「复制/移动到…」的文件夹形态，暂不做文件夹级剪贴板，避免循环移动校验）。
- Esc 的取消语义：文档 Esc 层在剪贴板为 cut 且无更高层（palette/菜单/对话框）打开时，优先清空剪贴板并移除 `.cut` 标记，再走既有 Esc 链。
- **树外可粘贴吗**：不可——「粘贴到此处」需要目标文件夹语义，只在树内 folder 菜单出现；树外整理走暂存区。
- **与暂存区剪贴板的关系**：互不相干——树内剪贴板是「位置对位置」的单条快搬；暂存区是「多来源聚合」的批量工作台。批量需求一律走暂存区，不把剪贴板扩展成多选（那是在造第二套选择模式）。

**5.3 菜单可用性**：**bookmark 菜单的「复制」「剪切」是树内专属项**，并入 `POSITIONAL_IDS`（context-menu.js:1890-1896，该清单现只含 bookmark 菜单的 8 个位置项，加入即得树内显隐规则）；**folder 菜单的「粘贴到此处」不归 POSITIONAL_IDS**——folder 菜单项的显隐在 folder handler 内动态判断（剪贴板非空才显示，参照 tabgroups 视图专属项的动态显隐先例），树外文件夹行（搜索结果 link-folder）不显示。「复制/移动到…」无位置语义，树外可用（5.1）；树外列表（recent/stats/dead/dupes/search results）只加「添加到暂存区」与「在树中定位」等无位置语义项。

### 6. 文件夹菜单：复制标题和地址（json / markdown / 文本清单）

**6.1 入口与结构**：文件夹右键菜单加一个 `has-submenu` 折叠项「复制标题和地址 ▸」（子菜单 id 形如 `folder-copy-submenu`，条目 `sub-folder-copy-text|markdown|json`），三个子项：
- `文本清单`：每个书签两行——第一行标题、第二行 URL，条目间空一行。
- `Markdown`：每个书签一行 `- [标题](URL)`；标题中的 `[` `]` 转义为 `\[` `\]`，标题内换行折叠为空格。
- `JSON`：扁平数组 `[ { "title": "...", "url": "..." }, ... ]`，2 空格缩进（便于直接贴入 issue/笔记）。

**6.2 范围与顺序**：递归收集该文件夹下全部书签（不含分隔符、不含子文件夹节点），深度优先、树序（与 `chrome.bookmarks.getSubTree` 返回顺序一致）。理由：用户复制一个文件夹的标题地址清单，通常就是要「这个文件夹里所有链接」。若未来需要「仅直接子级」，可再加一个子项，本期不做。不去重（去重是去重视图的职责，清单忠实于树）。

**6.3 大文件夹防护**：复制前计数；书签数 > **200** 时弹确认框「将复制 N 条书签的清单」，确认后执行。剪贴板写入复用 `actions.js` 的 clipboard 模式（`copyToClipboard`，actions.js:60-72，`navigator.clipboard.writeText` + `#copier-input` 隐藏 textarea 回退）——现该函数是模块私有，随本功能提取为 `src/clipboard.js` 纯模块（writeText + 回退 + 单测），actions.js 与本功能共用，符合「操作即模块」规范。

**6.4 空文件夹**：与现有 open/sort 的 content-disabled 逻辑一致，无书签时该折叠项置灰（`OPEN_CONTENT_IDS`（:154-191，`sub-` 前缀条目已在清单）的思路扩展到 `folder-copy-collapse` 及其 `sub-` 子项，`hideAllMenus` 清态同步覆盖）。

**6.5 与旧实现的差异**：现有 `actions.copyAllTitlesAndUrls` → `new TreeText(nodeId)` 对文件夹同样递归，但输出是**缩进树样式文本**（层级缩进），且只此一种格式——本需求要的是三格式**扁平清单**。定案：新增 `actions.copyFolderTitlesAndUrls(folderId, format)` 独立实现（纯格式化函数提进 `src/clipboard.js` 或 `src/folder-copy.js`，三格式各有单测），不动现有单条书签「复制标题和地址」菜单与 TreeText；TreeText 树样式作为未来第四格式候选登记（`sub-folder-copy-tree`，本期不做）。

**6.6 子菜单机制触点（精确清单）**：① `pages/popup.html` + `pages/sidepanel.html` 双页加 entry（`class="menu-item has-submenu" data-submenu="folder-copy-submenu"`）与 `<menu class="submenu" id="folder-copy-submenu">`；② neat.js 标签表加 `sub-` 前缀条目；③ context-menu.js：顶部取元素、`hideAllMenus` 三段（:227/:291 及 submenu 段）、`bindSubmenu`（:1436-1449）/`bindSubmenuHover`（:1450-1462）绑到 folder handler、dispatch 的 `sub-` 归一化（:1107 与 :1252 两处）；④ keyboard.js 三处——`contextKeyDown` 绑定清单（:917-961）、Tab-trap `menuContainers`（:1174-1185）、文档级两级 Esc（:1060-1066）自动覆盖。

### 7. 文件夹菜单：添加文件夹折叠（默认折叠）

**7.1 结构**：文件夹右键菜单把三个「添加文件夹」动作合并为一个 `has-submenu` 折叠项「添加文件夹 ▸」，二级菜单：
- `此前`（对应现有 `add-folder-before-folder`）
- `此后`（对应现有 `add-folder-after-folder`）
- `子文件夹`（对应现有 `add-new-folder`）

折叠关闭时恢复为现有三个平铺条目（与 `collapseSortMenu`/`collapseTabGroupMenu` 同机制：`applyCollapseState` 切 class :526-535、CSS 藏原条目显折叠项）。

**7.2 选项**：新增设置键 `collapseAddFolderMenu`（默认开），**入 `SYNC_KEYS`**（store.js:142-168，collapseTabGroupMenu/collapseSortMenu 同列）——菜单折叠是设备独立偏好。选项页 **「Context menus」组**（`optionsGroupContextMenu`）加复选框，与既有两项并列。

**7.3 置灰继承**：根文件夹下「此前/此后」仍沿用 `ROOT_DISABLED_IDS`（:135）置灰；「子文件夹」保持可用。折叠项本身在全部子项都置灰时才置灰（根文件夹时仍可展开看到「子文件夹」可用，因此折叠项不置灰，只置灰子项）。

**7.4 键盘/二级菜单**：复用现有 `openSubmenuFor/closeSubmenu/toggleSubmenuFor` + `has-submenu`/`data-submenu` 机制；触点清单同 6.6（keyboard.js 三处 + context-menu.js 五处 + 双页 HTML）。

### 8. 落地触点清单（4.1.0 HEAD 精确版）

- `pages/popup.html` / `pages/sidepanel.html`（**双页同步**，`tests/fuzzy.test.js` :267-281 的 script 清单 parity 断言只比 script 列表，菜单结构另有 popup-layout.test.js 等覆盖）：`#view-recent` 内改单滚动容器 `#staging-list` + `#staging-items` + `#recent-head` 标记；bookmark/folder 菜单新项；`#staging-group-context-menu`（第 16 个菜单）；`folder-copy-submenu` 与 `folder-add-submenu` 两个 `<menu class="submenu">`；tab-groups 两个菜单的新项。
- `src/staging.js`（**新建纯模块**，「操作即模块」规范）：数据模型全部纯逻辑——add（双态条目/URL 去重）/remove/500 上限/修剪与**重链**（id 失效 → url 锚点再链或落档）/分组增删改/**收藏态推导（id 即态）**/快照撤销数据；**迭代 D 增补**：`createGroup({manual})`（用户自建组空组常驻）、`deleteGroup`（组+成员离场回执）/`restoreGroup`（撤销恢复）、`reorderGroups`（拖拽重排：落到目标前，重排 createdAt 保持升序不变量）、`pruneEmptyGroups` 不回收 manual 组。零 chrome.*/DOM 引用，单测直驱。**构建**：经 neat.js import 可达即自动进 dist esm 包，无需登记 `scripts/runtime-files.json`（esmEntries 只列入口）。
- `src/view-recent.js`：升级为暂存视图（保留文件名与 `recent` view id）；两区域渲染、组结构、选择模式、区头折叠与「全部暂存」、上箭头按钮、行内星标/移出按钮、`badge`/`persistScroll` 注册字段、`chrome.storage.onChanged` 监听 `staging` 键（整对象重解析）；**新增 `chrome.bookmarks.onChanged` 监听**（现只有 onCreated/onRemoved，:284-285）；onCreated/onRemoved 挂接重链/落档修剪（§0.5）。
- `src/actions.js`：新增 `copyFolderTitlesAndUrls`、内部剪贴板操作、move/copy 批量执行（串行 + lastError + 实际数量 toast）、`stageFavItems`/`stageUnfavItems`（收藏/取消收藏的批量真实执行 + undo capture 组装）；暂存增删经 `src/staging.js`。**迭代 E**：`openBookmarksInGroup` 修 `pickGroupColor(undefined)` 崩溃（staging/search/stats 的 urls-only 调用路径）。
- `src/icons.js`（**迭代 E**）：新增 SCISSORS（剪刀分割线）/ OPEN（打开）/ TABS（打开为标签组）/ GROUP（分组，layers）/ STAR_X（取消收藏）/ UNGROUP（解散，门+出箭头）六枚 16px 线框 icon，供 `.staging-cut` 与选择条图标 rung 使用。
- `src/clipboard.js` 或 `src/folder-copy.js`（新建纯模块）：clipboard 写入（自 actions.js:60-72 提取）+ 三格式格式化（§6.3/§6.5）。
- `src/context-menu.js`：`LIST_SEL` 换 `#staging-list`；bookmark/folder/tabgroups 菜单新项与两个新 submenu；暂存行（双态分流）/组头/历史行的行特征路由；`applyContentDisabled` 覆盖复制清单项；`applyCollapseState` 覆盖 `collapseAddFolderMenu`；bookmark 菜单的复制/剪切并入 `POSITIONAL_IDS`（folder 粘贴走 handler 动态显隐，见 §5.3）。
- `src/dialogs.js`：`BookmarkFolderPickDialog` 扩展（§4.1，含双态按钮副文案 + **快选 chips 行与过滤输入**）+ **分组指派对话框**（§3.3，新 body-class 对话框）+ `close` 语义正规化（两处旧调用点同步）。**迭代 F**：新增 `StagingShortcutDialog`（目标文件夹经 picker legacy 单选、别名输入、tabgroups 九色色板，`needStagingShortcut` 进 anyOpen/activeEl/closeDialogs/#cover）。
- `src/view-tabgroups.js`：tab 行/closed tab 行「收藏并暂存」（**`addTabToBookmarks` 扩展返回书签 id** 或新增 `resolveTabBookmark` 薄封装，§2.5）、组头「整组收藏并暂存」。
- `src/view-stats.js`：未收藏历史行的「添加到暂存区」入口（右键项 + hover 按钮，与即时收藏星并排，§2.3）+ **stats 选择模式**（§3.7：工具条入口、两类行可选、动作条、Esc）。
- `src/search.js` + `views.attach('search')`：搜索视图选择模式（§3.6，`onEscape` 挂 attach 层、先于 keyboard.js 的 `search.escape()` 分支消费）。
- `src/view-manager.js`：**零机制改动**（badge/persistScroll 走既有注册字段；persistScroll 首例见测试注）。
- `src/keyboard.js`：第 16 菜单 + 两个新 submenu 的绑定清单（三处，:917-961/:1174-1185/:1060-1066）；搜索视图选择态的 Esc/Space/Delete 层。
- `src/store.js`：`KNOWN_KEYS` 加 `staging`、`folderPickPins`、`folderPickRecents`（三者均 local——暂存数据与书签 id 快选名录都是设备本地，:133-135 注释区追加）、`SYNC_KEYS` 加 `collapseAddFolderMenu`。
- `tests/storage-usage.test.js`：census 决策表加 `staging: 'other'`、`folderPickPins: 'other'`、`folderPickRecents: 'other'`。
- `_locales/*`：新增 i18n 键（§10 清单），走 `i18n.py` 全流程（audit/missing/verify 三门禁）。
- `AGENTS.md` + `docs/agents/modules.md`：view-recent.js 行升级描述、context-menu/dialogs/store/actions 行同步（实施时）。
- 测试：`tests/` 新增 `staging.test.js`（纯模型全逻辑：双态/URL 去重/重链落档/分组/未收藏桶推导/lastSeenTs）、`folder-copy.test.js`（三格式）、`clipboard.test.js`；扩展 `view-recent.test.js`（双区域/选择模式/组头/混合选择/**persistScroll 首例断言**/onChanged/onCreated 重链）、`dialogs.test.js`（picker 扩展 + close 正规化 + 双态副文案 + 快选 chips/pin/recents 与惰性修剪 + 分组指派对话框）、`context-menu.test.js`（新项/新 submenu/置灰/折叠/文件夹粘贴显隐/历史行入口）、`keyboard.test.js`（新绑定）、`view-tabgroups.test.js`（收藏并暂存 + id 返回兼容）、`view-stats.test.js`（历史行暂存入口 + 选择模式）、`search.test.js`（选择模式 + Esc 层级顺序）、`actions.test.js`（收藏/取消收藏批量执行 + undo 组装）；harness `verify-keyboard.js` 补暂存视图行步行与选择模式断言（Docker 门禁）。

### 9. 决策速览表（迭代 B/C 更新）

| 问题 | 决策 |
|---|---|
| 视图升级方式 | 保留 `recent` view id 与设置键，标题改为「暂存区」；palette `/recent` 加 alias `staging` |
| 暂存区存什么 | 双态条目（`id` 非空=已收藏 / `null`=未收藏，恒带 url/title 快照）；上限 500；**URL 为唯一性键**；local 区不进 sync；census 归 `'other'` |
| 「不改书签树」的边界 | **只约束发送动作**；暂存区内的整理动作（收藏/取消收藏/移动/复制/删除）全部真实生效 |
| 收藏/取消收藏 | **真实树操作**：收藏 = create 进 `quickAddFolderId`（url 去重锚定，与快加星/stats 历史行星同语义）；取消收藏 = remove，条目**落档留场**（未收藏态，可再收藏）；本地 `fav` 标记删除；「未收藏」合成桶经迭代 C 以真实态收件箱身份恢复（见下） |
| 生效模型 | **立即生效 + 分层防护**（高频低危 = toast/撤销；删除与清空 = ConfirmDialog；批量移动 >10 = 确认）；「统一应用」否决（§3.0 四条依据） |
| 条目离场出口 | 仅三个显式动作：移动归位 / 删除 / 移出·清空；收藏态翻转与复制永远留场 |
| 树事件同步 | onCreated 重链（url 命中则升已收藏）；onChanged 更新快照；onRemoved 修剪（重链或落档，**不删条目**）；onMoved 不动；url 索引复用 `buildTreeSnapshot` |
| 文件夹允许发送吗 | 允许，扁平化为书签集合（id+快照），自动生成同名虚拟分组（`sourceFolderId` 合并） |
| 超大文件夹 | 先计数：>100 确认；超 500 上限整体拒绝，不静默截断 |
| 虚拟分组 | 用户组（`manual` 标记，空组常驻、可删除可撤销）/文件夹组/tab 组（`createdAt` 序，组头拖拽重排）+ 未分组散行；分组与收藏态正交；组头可折叠、可作选择单元；移入/新建统一走分组指派对话框（工具条与行右键同源）；行↔组头/桶头/他行拖拽、组头↔组头重排只写暂存模型 |
| 「未收藏」桶 | **恢复（迭代 C）**：`id=null && group=null` 的真实态收件箱分区（置顶、可折叠、空心星图标）；桶头「收藏全部」快捷 + 「新 N」计数（`lastSeenTs`）；进组离桶、退藏落档回桶 |
| 组级归位 | 组头「保存到文件夹…」（未收藏 create / 已收藏 move，>10 确认，完成整组离场、空组自动解散）与「复制到文件夹…」；hover「归位」直达；语义 = §3.3 同名动作的全组预置，非第三套动作 |
| 移动快捷栏（迭代 F→G） | 选择工具条第三 rung = 用户自定义「移动到目录」chips（**仅 move**，点击即整批归位离场；复制走图标 rung/右键菜单）；普通态 chip = 色点+别名零附属按钮，管理 = 右缘 [＋]/[pencil] 双图标簇，编辑态虚线边框 + 色点悬浮红 × 删除；`stagingShortcuts` local 键 + census `'other'`；编辑对话框复用 picker + 九色色板；跨文档 storage.onChanged 回声防护同步；左端「收藏到：」标签 ≥520px 显示 |
| 文件夹选择器快选 | 顶部 chips：pin（行内 PIN_ICON 切换、用户序）+ 最近（LRU ≤6、全部 picker 用途自动记录）；过滤输入转正；`folderPickPins`/`folderPickRecents` 两键 local + census 'other'；打开时按树惰性修剪失效 id |
| stats 选择模式 | 已收藏统计行 + 未收藏历史行均可选（统一键 = url，混选常态）；动作 = 发送到暂存区/打开/打开为标签组/删除（适用项降级）；入口同搜索（§3.7） |
| 混合选择 | 各动作「作用于适用项 + 计数汇报」，按钮不因混选禁用 |
| 单条路径 | 行内星标（真实切换）+ 行内移出 + 右键菜单，与批量工具条同一套语义三种粒度（§3.7） |
| 选择模式「删除」 | 删除真实书签 + 条目离场（confirm + undo 单步，撤销同时恢复书签与条目）；「清空」只清暂存本地；「移出」toastAction 可撤销 |
| 双区域键盘模型 | 单滚动容器 + 兄弟 `<ul>` + `crossRowUl`（死链视图先例），view-manager 零机制改动 |
| 文件夹选择器 | 扩展复用 `BookmarkFolderPickDialog`（[移动][复制][取消] 一次完成；双态选择集时按钮副文案注明未收藏条目将收藏到此处） |
| 移动/复制到文件夹 | 已收藏：move 真实搬树（>10 确认）成功离场 / copy 副本留场；未收藏：等价「收藏到指定文件夹」，move 离场 / copy 留场；同父 move no-op |
| 树内复制/剪切/粘贴 | 会话级单条书签剪贴板（popup/sidepanel 各自独立）；copy 可多次粘贴，cut 粘贴后清空；Esc 优先取消 cut；bookmark 菜单项进 POSITIONAL_IDS、folder 粘贴走 handler 动态显隐；与暂存区互不相干（§5.2） |
| tab-groups 互通 | tab/closed tab 行「收藏并暂存」（`resolveTabBookmark` 取/建书签 id + URL 去重）；组头「整组收藏并暂存」（>10 确认，自动建 `sourceTabGroup` 组） |
| stats 历史行互通 | 未收藏历史行「添加到暂存区」（右键 + hover 按钮，与即时收藏星并存）——批量收藏历史内容的入口 |
| 搜索视图选择模式 | 结果区细工具条；仅书签行可选；动作 = 打开/打开为标签组/发送到暂存区/删除（无「取消收藏」——与删除同效，退藏留档只在暂存区）；Esc 经 attach 层 `onEscape` 先于 `search.escape()` |
| 文件夹复制清单 | 递归收集，文本/Markdown/JSON 三格式；>200 确认；clipboard 模式提为纯模块；TreeText 树样式留作第四格式候选 |
| 添加文件夹折叠 | 默认折叠为「添加文件夹 ▸（此前/此后/子文件夹）」，选项 `collapseAddFolderMenu` 默认开、入 `SYNC_KEYS`、落选项页 Context menus 组 |

### 10. 新增 i18n 键清单（en 基线；实施时以 `i18n.py` 流程为准）

- 视图/区域：`viewRecent`（**改文案**「Staging/暂存区」，43 locale 重翻译）、`recentSectionTitle`、`stagingEmpty`（空态引导）。
- 发送/状态：`stagingAdd`、`stagingAdded`、`stagingAlready`、`stagingAddedSummary`（新增 $n$ 条，$m$ 条已在暂存区）、`stagingFull`、`stagingFolderEmpty`、`stagingConfirmFolder`、`recentStageAll`。
- 暂存动作：`stagingRemove`、`stagingRemoved`、`stagingFav`（收藏）、`stagingFavDone`（已收藏 $n$ 条，含跳过数）、`stagingUnfav`（取消收藏）、`stagingUnfavDone`（已取消收藏 $n$ 条）、`stagingClear`、`stagingClearConfirm`、`stagingDeleteConfirm`（含 undo 单步提示，参照 `undoSingleStepNote` 复用）、`stagingMoveDone`/`stagingCopyDone`（含数量参数）、`stagingMoveConfirm`（>10 条确认）。
- 条目态：`stagingFromHistory`（未收藏条目 subText「来自历史」）、`stagingRowFav`/`stagingRowUnfav`（行内星标 title，随态切换）。
- 分组：`stagingGroupNew`、`stagingGroupRename`、`stagingGroupDissolve`、`stagingGroupSelectAll`、`stagingGroupNamePrompt`、`stagingGroupAssign`（分组…：工具条/行右键入口 + 指派对话框标题与按钮）、`groupSaveToFolder`（保存到文件夹…）、`groupCopyToFolder`（复制到文件夹…）、`groupPlaceTooltip`（归位）。
- 移动快捷栏（迭代 F→G）：`stagingShortcutAdd`、`stagingShortcutTitle`、`stagingShortcutEdit`、`stagingShortcutAlias`、`stagingShortcutPickFolder`、`stagingShortcutSave`、`stagingShortcutRemove`、`stagingShortcutRemoved`、`stagingShortcutMove`（$1$ = 别名/路径）、`stagingShortcutBarLabel`（收藏到：）；颜色标签复用 `tabGroupColorLabel` 系。
- 未收藏桶：`stagingBucketFavAll`（收藏全部）、`stagingNew`（新 $n$）。
- 文件夹选择器：`folderPickMoveHere`、`folderPickCopyHere`、`folderPickFilter`、`folderPickFavNote`（未收藏条目将收藏到此处）、`folderPickPinned`（已 pin 区标）、`folderPickRecent`（最近区标）、`pinFolder`/`unpinFolder`（行内 pin 按钮 title）。
- 树剪贴板：`copyBookmark`、`cutBookmark`、`pasteHere`、`copiedToast`/`cutToast`/`pasteDone`/`pasteGone`。
- 文件夹复制清单：`folderCopyList`、`folderCopyText`/`folderCopyMarkdown`/`folderCopyJson`、`folderCopyConfirm`、`folderCopyDone`。
- 添加文件夹折叠：`addFolderMenu`；三个子项标签复用既有键。
- tab-groups 互通：`tabRowStage`、`tabgroupStageAll`、`tabgroupStageConfirm`、`stagedToast`。
- stats 历史行：复用 `stagingAdd`/`stagingAdded`（零新键，仅入口）。
- 搜索/stats 选择模式：`searchSelectMode`、`statsSelectMode` + 复用既有选择条键；「发送到暂存区」复用 `stagingAdd`。
- 选项页：`optionCollapseAddFolderMenu`。

净增约 **55 键**（改文案 1 键另走重翻译）；en + zh 系实译，其余 locale `[TODO:key]` 占位后 `translate --apply`，`verify` 零残留。

### 11. 空态、可达性、动效与性能预算

- **空态**：暂存列表空时渲染引导行（图标 + 一行 muted 文案，指向右键菜单、最近区上箭头与 stats 历史行三个入口）；最近添加区空态沿用 `recentEmpty`。
- **可达性**：组头 `aria-expanded`；上箭头按钮 `aria-pressed`；**行内星标 `aria-pressed` 随真实收藏态**（screen reader 读「已收藏/未收藏」）；选择计数沿用 `.select-count` 文本；全部新按钮（含图标化动作 rung 与组头四键）title + aria-label；**组头快捷尾按钮自己消费 Space/Enter**（点击后焦点停在按钮上，再按 Space/Enter 重触发按钮而非折叠组头）；组头折叠键盘协议（Space/Enter/←/→ RTL 感知）与 F2 重命名照旧；新菜单 `role="menu"`/`menuitem` 照旧。
- **RTL**：行按钮/星标/组头缩进全部走 `inset-inline-*` 逻辑属性；子菜单 flyout 的侧开翻转沿用 `positionMenu` 既有 RTL 处理。
- **动效**：上箭头/staged 态、星标实空心切换只动 `opacity`/fill（dur-1 档）；无新增位移动效；`prefers-reduced-motion` 全局收口自动覆盖。
- **性能预算**：暂存区单次渲染 ≤500 行 + 组头，innerHTML 整块替换在死链视图同量级已验证（且 4.1.0 已完成 badge 同步去全量刷新等 perf 系列）；修剪/重链 = url 索引一次查表（复用 `buildTreeSnapshot`）；`badge()` O(1)。最近区折叠时 `getRecent` 跳过。不引入任何后台轮询。
- **迭代 D 收口**：树事件（onCreated 提升/onChanged 快照/onRemoved 重链）落地 120ms 合并提交——文件夹级批量发送每 create 一个事件，全量 innerHTML 重绘 per-event 曾冻住 popup；`chrome.storage.onChanged` 的同文档回声按「自身写入字节级比对」跳过（~200ms 后的幽灵重渲染 + stagingState 对象置换，会搁浅在途批量闭包）；`probePermission` 仅在权限结论变化时重绘（进入视图连刷两次的根因）。真浏览器探针 `scripts/harness/diag/diag-staging-perf.js`：进入视图 DOM 变更 642+5s 滴流 → 30 次级。**再收口（局部重绘 + 重复进入跳过）**：staging 专属动作只重建 banner+工具条+`#staging-items`（`renderStagingNow`），最近添加区节点原样保留，最近行发送按钮态由 `syncRecentStageButtons` 原地同步；`activate` 用 `painted` + `lastRenderedRaw` 判断——已渲染且状态未变时仅原地更新桶头「新 N」，不再整块重渲染（真浏览器探针 `diag-staging-verify.js` entry churn 归 0）。
- **favicon**：已收藏与未收藏条目的 favicon 走同一条既有 `_favicon`（按 url）+ 补全链 + 反色服务，零新增。迭代 D 实测进入视图的「favicon 刷新过程」来自每次 innerHTML 整体替换后既有服务的 img 重挂——重挂本身已被回声防护/合并提交压到每轮一次（见上条），网络侧补全链保持既有行为不变。

### 12. 与 velvet 视觉版本的关系

本功能以**功能版本**单独先行落地（视觉沿用 4.1.0 现行语言：`.row-btn` 体系、dupes/tabgroups 组头样式、双 rung 图标工具条、body-class 对话框），不等待 velvet 视觉改版。velvet（`docs/plan-velvet/velvet-task-2-glm.md`）已为暂存区的新元素预留视觉契约（双区域区头、组头、星标行、选择工具条、文件夹选择器卡片化、`.cut` 剪切态）——velvet 落地时暂存视图随全局面貌一并收敛，无二次设计。若两版本并行，velvet 的视觉契约以任务 2 文档为准、本功能的 DOM/类名结构不变（视觉改版应是 CSS/token 层工作）。

### 13. 实施切片建议

每片独立提交 + 全绿（vitest 全量 + Docker smoke/verify-keyboard 门禁）：

| Slice | 内容 | 依赖 |
|---|---|---|
| ST1 | `src/staging.js` 纯模型（双态/URL 去重/重链落档/分组）+ `staging.test.js` + store 键 + census 登记 | 无 |
| ST2 | `BookmarkFolderPickDialog` 扩展 + `close` 正规化 + 双态副文案 + 快选 chips/pin/recents 与过滤输入（dialogs.test.js） | 无 |
| ST3 | 暂存视图双区域骨架（DOM 改造 + 单滚动容器 + crossRowUl 步行 + badge/persistScroll + onChanged/onCreated 重链监听 + storage.onChanged）+ 发送入口（书签菜单 + 上箭头 + 全部暂存 + **stats 历史行入口**） | ST1 |
| ST4 | 分组（组头渲染/折叠/组菜单 + **指派对话框**）+ 未收藏桶（收藏全部/新 N 计数）+ 行内星标/移出按钮（真实切换） | ST3 |
| ST5 | 暂存选择模式（双 rung 工具条全动作：收藏/取消收藏/移动复制/删除/清空/移出，混合选择语义）+ 组级归位（组头 hover/菜单保存与复制到文件夹、空组解散） | ST2/ST4 |
| ST6 | 树视图：复制/剪切/粘贴 + 「复制/移动到…」+ Esc 取消链 | ST2 |
| ST7 | 文件夹复制清单（clipboard.js 提取 + 三格式）+ 添加文件夹折叠 + 选项 | 无（可并行） |
| ST8 | tab-groups 互通（resolveTabBookmark + 两个菜单入口 + 整组） | ST1 |
| ST9 | 搜索 + stats 视图选择模式（工具条 + 动作 + Esc/适用项降级） | ST1 |
| ST10 | i18n 55 键全流程 + AGENTS.md/docs 同步 + harness 断言收尾 | 全部 |

### 14. 同类产品调研备忘（迭代 B，支撑 §3.0/§3.8 裁决）

- **Raindrop.io**：Unsorted 内建收件箱（保存不选集合 → 落 Unsorted，事后整理）；多选工具条批量 move/tag/delete；删除进 Trash 集合可恢复。「先收集后整理」证实暂存区的产品价值；其批量动作全部立即生效 + Trash 兜底，无「统一应用」层。
- **Gmail / Google Photos / Material 3 selection**：长按/勾选进入选择模式 → 上下文工具条（transform 而非弹层，保持空间稳定）→ 点动作**立即生效** → 底部 toast + Undo。M3 规范明文：contextual action bar 持续存在直到动作发生——与我们的双 rung 工具条同构。
- **Confirm vs Undo 裁决启发式**（Vitaly Friedman 等）：高频低危动作用 undo（不打断）；罕见高危动作用 confirm（用户会无脑点穿高频 confirm，confirm 泛化等于没有）。本方案「收藏/取消收藏/移出 = undo；删除/清空/大批量移动 = confirm」直接套用。
- **Bulk action 指引**（Eleken 等）：提供全选、上下文工具条、清晰反馈与撤销——对应本方案第一 rung 的全选/反选/清除与各动作计数 toast。
- **购物车/照片导入器（反例参照）**：deferred apply 只在「提交前必须审阅汇总」的场景成立（下单金额、导入去重选项）；书签整理的每步都可独立撤销且树实时同步，审阅层是纯开销。

**对 vBookmarks 的净启示**：暂存区 = Raindrop 的 Unsorted 心智（收集inbox）+ Gmail 的选择工具条（批量立即生效 + 撤销）+ vBookmarks 自己的真实收藏语义（快加星/stats 词汇复用），三者拼起来正好是「批量决策工作台」，且每块都有本仓既有先例可抄——零新交互范式的发明。

---

*本文为 [`velvet-feat-staging.md`](velvet-feat-staging.md) 的 GLM 精审定稿：迭代 A 做行号级触点复核（三处修正、两处补漏）；迭代 B 按用户澄清把「收藏/取消收藏」落为真实书签树操作（双态条目模型、URL 唯一键、重链自愈、删除本地 fav 标记与未收藏合成桶），裁决生效模型为「立即生效 + 分层防护」（§3.0，含同类产品调研 §14），并补单条/右键/批量多粒度同语义的操作便捷性设计（§3.8）。迭代 C 按真实用户路径（多批次多来源收集 → 分组 → 组级归位 → 选择器快选）恢复「未收藏」桶为真实态收件箱分区、新增组级归位与 picker 快选区（pin + 最近 + 过滤）、补 stats 视图选择模式，并落 §0.6 典型路径走查作为验收叙事。需求清单冻结不动。*