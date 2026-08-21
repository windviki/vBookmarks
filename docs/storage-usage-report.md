# vBookmarks 选项页“存储空间统计”分析报告

> 分析范围：只读代码分析，未做任何代码修改。
> 日期：2026-08-21
> 对象：`pages/options.html` 的存储占用横条、`src/storage-usage.js`、`src/options.js` 的 `refreshStorageUsage`、`src/favicon-enrich.js` 的字节预算，以及 `src/store.js` 的存储分区。
> 文档包含三部分。**第一、二部分是历史审计初稿（当时的现状盘点与初步建议）；第三部分（§14 起）是复核修订与最终落地结论——凡第一、二部分与第三部分冲突之处（统计条分段、customIcon/separators/quickAddFolderId 同步建议、任务 8/15/16 等），一律以第三部分为准。** §16 记录了第二轮复核发现的升级兼容性问题及其修复。

---

## 1. 结论摘要

> **【历史审计初稿】** 本部分（§1–§8）是整改前的现状分析；其中统计条四段结构、§7 建议等已被第三部分的复核修订与落地取代，冲突处以第三部分为准。

1. **当前统计条统计的是 `chrome.storage.local`，也就是“本地扩展存储”**，不是书签本体、不是 `chrome.storage.sync`、不是 `chrome.storage.session`、也不是 `localStorage`。
2. 统计条本身是**展示/审计工具**，不是动态控制器。真正做“不让缓存占满配额”的只有 `favicon-enrich.js` 里的 `refreshBudget()`；两者当前没有互相调用，属于两套独立逻辑。
3. **图标缓存（enriched favicon 缓存）目前不是云端同步的**。它写在 `chrome.storage.local` 的 `vbmFavicon:*` 与 `vbmFaviconIdx`，只能通过设置备份导出/导入手工搬到另一台设备；没有自动同步到 Chrome 账号。
4. 主要 gap 集中在：统计口径只覆盖 local、新缓存缺少统一的配额守卫、统计条与 favicon 预算数值源不一致、以及“新 cache 落进 other 段”的防漏机制不完整。

---

## 2. 当前统计条到底在统计什么

### 2.1 代码路径

- `pages/options.html` 在 Icons 组加载 `src/storage-usage.js`，再由 `src/options.js` 渲染横条。
- `src/storage-usage.js` 定义了分类：
  - `isIconKey`：`vbmFaviconIdx` + `vbmFavicon:*` → **图标缓存**
  - `isBookmarkDataKey`：`deadLastScan`、`vbmDeadScan`、`deadMarks`、`deadMarkTimes`、`visitStats` → **扫描/标注数据**
  - 其余所有 key → **other**
- `src/options.js` 的 `refreshStorageUsage()`：
  - `chrome.storage.local.get(null)` 读出全部 local 数据；
  - 按上述三类 key 分组，优先用 `chrome.storage.local.getBytesInUse(keys)` 统计真实计费字节；
  - 配额取 `chrome.storage.local.QUOTA_BYTES || 10MB`；
  - 渲染“图标 / 扫描标注 / 其他 / 剩余”四段。

### 2.2 因此可以确认

- 它统计的是 **`chrome.storage.local` 这一个区域**。
- “书签”段不是书签树本体，而是**书签衍生数据**（死链扫描结果、标记、访问统计）。书签树本体由 Chrome 书签库管理，不占用扩展的 `storage.local`。
- `chrome.storage.sync`（约 100KB）、`chrome.storage.session`（临时内存）、`localStorage`（扩展 origin 的 Web Storage）都不在横条内。

---

## 3. Chrome 几类存储的区别与限制

### 3.1 可同步云端书签的存储：`chrome.bookmarks`

| 项目 | 说明 |
|---|---|
| 归属 | Chrome 浏览器书签库，不是扩展存储 |
| API | `chrome.bookmarks.*` |
| 是否占扩展 quota | 不占 |
| 同步 | 由 Chrome 账号的书签同步管理；Chrome 138+ 可用 `node.syncing` 区分“已同步”和“仅本地” |
| 限制 | 扩展不直接感知其配额；浏览器/账号负责同步容量、冲突、存储上限 |
| 当前用法 | 扩展读取/增删改书签树，不把书签内容复制进 `storage.local` |

### 3.2 本地扩展存储：`chrome.storage.local`

| 项目 | 说明 |
|---|---|
| 归属 | 当前浏览器当前扩展 profile |
| 同步 | **不同步** |
| 默认配额 | 约 **10MB**（`QUOTA_BYTES`；未申请 `unlimitedStorage`） |
| 特点 | 持久、所有扩展上下文共享（popup/options/background），适合中等/大数据、缓存 |
| 限制 | 总量 10MB；大缓存必须自己做预算和淘汰 |
| 当前用法 | 设置键、死链扫描/标注、访问统计、favicon 缓存、公告缓存、镜像缓存等 |

### 3.3 云端同步扩展存储：`chrome.storage.sync`

| 项目 | 说明 |
|---|---|
| 归属 | 跟随 Chrome 账号跨设备同步 |
| 同步 | 开启 Chrome 同步后自动同步 |
| 主要限制 | 总量约 **100KB**；单条约 **8KB**；条目数约 **512**；写入有频率限制（约 120 次/分钟、1800 次/小时） |
| 适合 | 小体积用户偏好、自定义命令等 |
| 不适合 | MB 级 favicon 缓存、书签快照、大 JSON |
| 当前用法 | 只有 5 个 key：`showSyncStatus`、`highlightUnsynced`、`autoRefreshSync`、`syncRefreshInterval`、`paletteCustomCommands` |

### 3.4 本地 origin 存储：`localStorage`

| 项目 | 说明 |
|---|---|
| 归属 | 扩展页面所在 origin 的 Web Storage，独立于 `chrome.storage.local` |
| 同步 | **不同步** |
| 限制 | 通常约 5MB（浏览器实现相关），同步 API，service worker 中不可用 |
| 当前用法 | 历史遗留 key 的镜像/迁移来源；`i18n-live.js` 的 `vbmI18nDict`/`vbmI18nLang` 语言字典缓存 |
| 注意 | 不占用 `chrome.storage.local` 的 10MB 配额，但也是用户本地存储的一部分；当前统计条未包含 |

### 3.5 临时会话存储：`chrome.storage.session`

| 项目 | 说明 |
|---|---|
| 归属 | 内存级、扩展会话期间 |
| 同步 | **不同步** |
| 限制 | 约 10MB（实现相关），浏览器重启后清空 |
| 当前用法 | `vbmSyncStatus`、`vbmProxySession`、`sidePanelIsOpen`、`sidePanelHeartbeat`、`pendingPaletteOpen`、`vbmPopupOpens` |
| 注意 | 不持久、不占 `storage.local` 配额，因此统计条也不应计入 |

---

## 4. 当前扩展对这几类存储的使用

| 存储 | 使用方 / 数据 |
|---|---|
| `chrome.bookmarks` | 书签树本体、文件夹、URL、同步状态 |
| `chrome.storage.local` | 所有设置（`KNOWN_KEYS`）、死链 `deadLastScan`/`vbmDeadScan`/`deadMarks`/`deadMarkTimes`、访问统计 `visitStats`、favicon 缓存 `vbmFavicon:*` + `vbmFaviconIdx`、公告/镜像等小缓存 |
| `chrome.storage.sync` | `showSyncStatus`、`highlightUnsynced`、`autoRefreshSync`、`syncRefreshInterval`、`paletteCustomCommands` |
| `chrome.storage.session` | 同步状态发布、代理会话标记、侧栏心跳、唤醒标记、弹窗打开去重 |
| `localStorage` | 旧版镜像（迁移后仍保留）、`vbmI18nDict`/`vbmI18nLang` 语言缓存、`theme` 等少量同步镜像 |

---

## 5. 针对“动态控制新增 cache 不要占满用户存储额度”的 Gap 分析

### 5.1 Gap 1：统计条是“仪表盘”，不是“控制器”

- `refreshStorageUsage()` 只负责读取并展示；没有任何代码把横条的 `free` 或 `other` 数值回传给缓存模块。
- 真正控制 favicon 缓存的是 `src/favicon-enrich.js` 的 `refreshBudget()`：
  - 用 `chrome.storage.local.getBytesInUse(null)` 得到 total；
  - 减掉 favicon 缓存自己的 `persistedBytes()`，得到“其他功能占用”；
  - 预算 = `min(剩余空间, max(512KB, 剩余空间 × 0.8))`。
- 这意味着：
  - 统计条和缓存预算是**两套实现**；
  - 将来新增的 cache 如果只看到统计条，不会自动获得配额保护；
  - 当前只有 favicon 缓存有动态预算；死链扫描等数据虽然可能很大，但没有类似的预算控制器。

### 5.2 Gap 2：统计范围只有 `storage.local`，容易造成“全部存储”错觉

- 横条下方的 hint 写的是“书签扫描/标注数据、图标缓存与设置所占用的存储空间”，没有明确写“仅 chrome.storage.local”。
- 用户可能会以为“剩余”就是整个扩展的存储余量，但实际 `storage.sync`、`localStorage`、`storage.session` 都未计入。
- 如果目标是防止 local 10MB 被打满，这是正确的关注点；但建议 UI/文档明确范围，否则容易误导。
- 尤其 `paletteCustomCommands` 在 sync 区有 100KB 总配额风险，选项页另有命令条数统计但没有字节横条；这不影响 local 配额，但属于“存储健康”的另一块盲区。

### 5.3 Gap 3：统计条与 favicon 预算的数值口径不一致

- 统计条按分类对 `getBytesInUse(keys)` 求和；favicon 预算用 `getBytesInUse(null) - persistedBytes()`。
- `persistedBytes()` 只统计内存中已持久化 data URL 的字符串长度，**不包含**：
  - 索引键 `vbmFaviconIdx` 的字节；
  - 每个 `vbmFavicon:<host>` 键名的字节；
  - Chrome 内部计费可能包含的额外开销。
- 结果是 favicon 预算中的“其他功能占用”会比真实值略高，方向偏保守（不会超用），但与统计条上的“图标”数字不完全一致。
- 当前可接受，但若想做成统一动态控制，应该抽出同一个“按 key 分类计算占用”的服务，让统计条和预算控制器共用。

### 5.4 Gap 4：新 cache 可能静默落入 “other” 段

- `storage-usage.js` 的注释和 `tests/storage-usage.test.js` 建立了一个“census 测试”：新 key 必须决定归 icon/bookmarks/other。
- 但测试的实际扫描范围有限：
  - 只覆盖 `store.knownKeys`；
  - 只扫描 `setSetting('...')` 和 `store.set('...')` 的字符串字面量；
  - 不覆盖 `chrome.storage.local.set({ [someDynamicKey]: value })` 这类动态 key。
- favicon 缓存和死链扫描正是动态 key 写入，目前在测试里是靠“代表性实例”手工钉住的。
- 因此，未来如果新增一个直接写 `chrome.storage.local` 的动态大缓存，**census 测试不一定能拦住它落到 other 段**，也就不会强制给它设计配额/淘汰。

### 5.5 Gap 5：全量读取带来的性能风险

- `refreshStorageUsage()` 每次刷新都先 `chrome.storage.local.get(null)` 把整个 local 区读进内存，再按分类调用 `getBytesInUse`。
- 虽然已有 300ms 防抖，且只对 icon/bookmarks 相关 key 触发，但当 local 区已有数 MB 时，选项页打开期间发生缓存写入风暴仍会有一次较大的全量读。
- favicon 的 `hydrate()` 也会在每次打开时全量读 local。这是既有已知取舍，但若未来 local 数据继续增大，统计条的全量读会成为可感知开销。

### 5.6 Gap 6：没有统一的新缓存配额接口

- favicon 缓存自己实现了“动态字节预算 + 淘汰 + 配额错误紧急淘汰”，但没有暴露成通用模块。
- 死链扫描缓存（`deadLastScan`/`vbmDeadScan`）和访问统计（`visitStats`）没有预算控制；它们可能随书签数量增长，但目前没有类似 favicon 的“减半淘汰”。
- 如果产品目标是“新增的 cache 都不要占满用户存储额度”，需要一个通用 quota-guard / budget service，而不是每个缓存各自实现。

---

## 6. “icon 这部分缓存是否云端同步”的现状

### 6.1 结论：目前**不是**云端同步

- **favicon 补全缓存**：
  - 存储在 `chrome.storage.local`：
    - `vbmFavicon:<host>` = data URL；
    - `vbmFaviconIdx` = 索引 JSON。
  - `src/store.js` 的 `SYNC_KEYS` 不包含这些键。
  - `docs/favicon-补全设计.md` 明确写了：favicon 开关“**不进 SYNC_KEYS**”，缓存动态键“**不入 KNOWN_KEYS**”。
  - 因此它不会自动跟随 Chrome 账号同步。
- **自定义工具栏图标（customIcon）**：
  - 同样写在 `chrome.storage.local` 的 `customIcon` key；
  - `SYNC_KEYS` 不包含它；
  - 也不是云端同步。

### 6.2 现状能做到的“跨设备”

- 设置备份导出/导入：
  - 选项页“导出设置”默认会带上 favicon 缓存（`faviconBackupInclude` 默认开）；
  - 导入时可以把缓存合并回另一台设备；
  - 这是**手动备份/恢复**，不是自动云同步。
- 书签本体通过 Chrome 账号书签同步自动跨设备；部分选项（sync 区 5 个 key）通过 `chrome.storage.sync` 自动跨设备。
- **favicon 缓存和 customIcon 都没有走这条自动同步链路。**

### 6.3 如果要“云端同步”会面临的现实限制

- `chrome.storage.sync` 总量约 100KB、单条约 8KB，**装不下 MB 级 favicon 缓存**。
- 如果产品意图确实是“favicon 缓存也像书签一样自动云同步”，需要换机制：
  - 例如只同步索引/失败标记（很小），实际图标每台设备自行抓取；
  - 或自建后端/借助其他云存储；
  - 或继续用“手动备份导入”作为跨设备方案。
- 当前代码的设计是“设备本地缓存 + 可手动备份迁移”，所以如果团队以为它已经在云同步，这是一个需要澄清的产品/实现 gap。

---

## 7. 建议（仅记录，不实施）

1. **明确统计条范围**：UI 或文档写明“仅 chrome.storage.local / 本地扩展存储 10MB”。
2. **把统计条升级为可复用的占用计算服务**：让 favicon 预算、未来新缓存预算、选项页横条共用同一套“按 key 分类、真实 getBytesInUse、剩余空间”逻辑。
3. **给新缓存建立通用 quota guard**：至少要求新 cache 必须注册分类、预算上限和淘汰策略；census 测试补上对动态 `chrome.storage.local.set` 的扫描。
4. **评估 sync/localStorage/session 是否也要进“存储健康”视图**：至少可以在说明/高级信息中展示 sync 区用量和 localStorage 语言缓存大小。
5. **favicon 云同步目标需要产品决策**：如果确定要云同步，应单独设计小体积同步方案；如果只接受手动备份，应把“本地缓存、不自动云同步”写入用户文档，避免预期错位。
6. **性能**：若 local 数据继续增长，统计条可改为“先读 key 列表/索引，再按需 getBytesInUse”，避免每次全量 `get(null)` 拉取全部 value。

---

## 8. 关键证据索引

- 统计条范围：`src/storage-usage.js:20-22`
- 统计条实现：`src/options.js:343-417`
- 配额：`src/options.js:379`
- 全量读取：`src/options.js:376`
- sync 区 key：`src/store.js:90-91`
- favicon 缓存本地写入：`src/favicon-enrich.js:411,432,502`
- favicon 动态预算：`src/favicon-enrich.js:455-490`
- 设计文档明确不云同步：`docs/favicon-补全设计.md:388`
- 备份可携带 favicon：`docs/favicon-补全设计.md:373`
- customIcon 本地存储：`src/options.js:682`、`src/background.js:64`

---

# 第二部分：全量存储数据分布、云同步差距与改造清单

> **【历史审计初稿】** 本部分的同步建议与任务清单以第三部分 §14–§16 的复核修订为准：§10.1 的 customIcon/separators/quickAddFolderId 同步建议已被推翻，§12 的任务 8/15/16 已取消，§9 的“归属段”已被统计条三段化取代。
> 本部分在第一部分基础上扩展：逐个盘点当前代码里实际出现的存储 key，从用户体验判断“该不该云同步”，并给出统一迁移与改造任务清单。

---

## 9. 当前所有存储数据分布

### 9.1 `chrome.storage.local`（本地扩展存储，默认约 10MB）

| 分组 | Key | 用途 | 量级风险 | 当前归属段 |
|---|---|---|---|---|
| 通用偏好 | `leftClickNewTab`、`middleClickBgTab`、`closeUnusedFolders`、`bookmarkClickStayOpen`、`dontConfirmOpenFolder`、`confirmDeleteFolder`、`dontRememberState`、`autoResizePopup`、`openInSidePanel`、`announceEnabled` | 点击/打开/记忆/侧栏/公告行为 | 小 | other |
| 搜索/树偏好 | `onlyShowBMBar`、`searchAfterEnter`、`searchHistoryEnabled` | 搜索与树行为 | 小 | other |
| 视图偏好 | `showViewTabs`、`rememberView`、`showTabBadges`、`showItemPath`、`showRecentBookmarks`、`showStatsView`、`showDeadView`、`showDupesView`、`disableRecentView`、`disableStatsView`、`disableDeadView`、`disableDupesView` | 视图显隐/禁用/标签 | 小 | other |
| 功能开关 | `paletteEnabled`、`quickAddEnabled`、`showToolButton`、`quickAddContextMenu`、`collapseTabGroupMenu`、`collapseSortMenu`、`statsEnabled`、`faviconContrast`、`faviconEnrich`、`faviconEnrichAgg`、`faviconBackupInclude` | 功能总开关/子开关 | 小 | other |
| 外观 | `theme`、`uiLanguage`、`userstyle`、`customIcon`、`separators`、`separatorTitle`、`separatorURL`、`separatorString`、`separatorcolor` | 主题/语言/自定义样式/工具栏图标/分隔符 | 小到中；`userstyle` 可能较大 | other |
| 目标/排序 | `quickAddFolderId`、`sortOptions`、`dupesStrategy`、`dupesScope`、`dupesIgnoreScheme`、`deadSort`、`deadFilter`、`deadMarkFilter`、`statsSort`、`statsShowUnbookmarked` | 快速收藏目标、排序/筛选偏好 | 小 | other |
| 扫描/标注数据 | `visitStats`、`deadLastScan`、`vbmDeadScan`、`deadMarks`、`deadMarkTimes` | 访问统计、死链扫描、死链标注 | **中到大**，随书签数增长 | bookmarks |
| 重复视图快照 | `dupesLastResult` | 重复组结果快照 | **中到大**，随重复组增长 | **目前 other（应归 bookmarks）** |
| 图标缓存 | `vbmFaviconIdx`、`vbmFavicon:*` | favicon 补全缓存 | **大**，MB 级，已有预算控制 | icon |
| 远程小缓存 | `vbmAnnounce`、`vbmAnnounceSeen`、`vbmGithubMirrors` | 公告/镜像节点缓存 | 小，有 TTL/上限 | other |
| UI 瞬态 | `popupHeight`、`popupWidth`、`zoom`、`searchQuery`、`scrollTop`、`focusID`、`focusSpot`、`viewState`、`activeView`、`vbmBtnAlt` | 弹窗尺寸、缩放、滚动、焦点、当前视图 | 小 | other |
| 版本/捐赠/计数 | `currentVersion`、`openCount`、`donationKey`、`donationCountDown`、`donationFactor`、`donationDisabled` | 版本与捐赠状态 | 小 | other |
| 迁移标记 | `__migrated_v1` | 一次性迁移标记 | 小 | other |
| 历史/搜索记录 | `searchHistory` | 最近搜索 MRU | 小（上限 10） | other |
| 其他 | `deadProxyServer`、`hideDeadProxyStrip`、`deadScanConcurrency`、`deadScanTimeout`、`statsHistoryBannerDismissed`、`statsHistoryImportedAt` | 代理/扫描/历史导入 UI 状态 | 小 | other |

> 注意：上表“当前归属段”指 `src/storage-usage.js` 实际分类；很多 key 并没有显式出现在 census 表里，而是靠 `other` catch-all。

### 9.2 `chrome.storage.sync`（云端同步扩展存储，总量约 100KB）

| Key | 用途 | 量级风险 |
|---|---|---|
| `showSyncStatus` | 是否显示书签同步状态 | 极小 |
| `highlightUnsynced` | 是否高亮未同步书签 | 极小 |
| `autoRefreshSync` | 是否自动刷新同步状态 | 极小 |
| `syncRefreshInterval` | 自动刷新间隔 | 极小 |
| `paletteCustomCommands` | 自定义斜杠命令（≤100 条） | 小，最多约 30KB，接近总配额需关注 |

### 9.3 `chrome.storage.session`（临时会话存储）

| Key | 用途 | 说明 |
|---|---|---|
| `vbmSyncStatus` | 同步状态地图 | 随书签数增大，但临时 |
| `vbmProxySession` | 代理会话标记 | 临时 |
| `sidePanelIsOpen` / `sidePanelHeartbeat` | 侧栏状态/心跳 | 临时 |
| `pendingPaletteOpen` | 命令面板唤醒标记 | 临时 |
| `vbmPopupOpens` | 弹窗打开去重 | 临时 |
| `vbmUndoStack` | 删除撤销栈（≤10） | 临时，浏览器会话内 |

### 9.4 `localStorage`（扩展 origin Web Storage）

| Key | 用途 | 说明 |
|---|---|---|
| 迁移前旧 key 镜像 | 老版本设置 | 迁移后保留作回滚；目前除 `separatorUrl`/`deadProxyTemplate` 外未清理 |
| `theme` | palette 命令切主题时直接写 | **冗余双写**，与 `store.set('theme')` 并存 |
| `vbmI18nDict` / `vbmI18nLang` | 语言字典同步缓存 | 有意的同步引导缓存，约几十 KB |

---

## 10. 从用户体验看：应该云同步而目前没同步的

### 10.1 高优先级：小体积、跨设备体验应一致

| Key/组 | 为什么应该同步 | 限制/注意 |
|---|---|---|
| `theme`、`uiLanguage` | 用户在外观/语言上的选择应跟随账号 | 极小，无限制 |
| `customIcon` | 自定义工具栏图标属于个人品牌/偏好，应跨设备一致 | 约 1.4KB，可放 sync |
| `leftClickNewTab`、`middleClickBgTab`、`closeUnusedFolders`、`bookmarkClickStayOpen`、`dontConfirmOpenFolder`、`confirmDeleteFolder`、`dontRememberState`、`onlyShowBMBar`、`searchAfterEnter`、`openInSidePanel`、`announceEnabled` | 操作行为偏好，换设备后不应重置 | 极小 |
| 视图/功能开关：`showViewTabs`、`rememberView`、`showTabBadges`、`showItemPath`、四个 `show*View`、四个 `disable*View`、`paletteEnabled`、`quickAddEnabled`、`showToolButton`、`quickAddContextMenu`、`collapseTabGroupMenu`、`collapseSortMenu`、`statsEnabled`、`searchHistoryEnabled` | 功能布局和启用状态是用户配置 | 极小 |
| `quickAddFolderId`、`sortOptions`、`dupesStrategy`、`dupesScope`、`dupesIgnoreScheme`、`deadSort`、`deadFilter`、`deadMarkFilter`、`statsSort`、`statsShowUnbookmarked` | 收藏目标、排序/筛选偏好应跨设备 | 极小 |
| `separators`、`separatorTitle`、`separatorURL`、`separatorString`、`separatorcolor` | 分隔符是用户定义的书签库结构补充，应该跨设备 | 小，可 sync |
| `userstyle` | 自定义 CSS 是用户个性化 | **有限制**：可能超过 sync 单条 8KB，需要分块/压缩或限制大小；否则保持 local |
| `faviconContrast`、`faviconEnrich`、`faviconEnrichAgg` | 图标处理偏好 | 设计文档明确“设备级网络偏好”，但作为用户设置也可同步；需产品决策 |
| `deadScanConcurrency`、`deadScanTimeout` | 扫描参数 | 小；是否同步取决于是否希望每台设备性能一致 |

### 10.2 中优先级：可同步，但要考虑体积/冲突/隐私

| Key/组 | 为什么可以考虑 | 限制/注意 |
|---|---|---|
| `deadMarks` / `deadMarkTimes` | 死链“已标注/已处理”是书签维护状态，用户可能希望多端一致 | 可能随书签数量增长；若走 `chrome.storage.sync` 需压缩/裁剪；否则需自建同步 |
| `visitStats` | 访问统计是个人行为数据，跨设备汇总有价值 | 同样可能增长；且属于隐私数据，需用户知情 |
| `searchHistory` | 最近搜索跨设备可用 | 隐私/本地习惯，建议默认不 sync |
| `vbmAnnounceSeen` | “已读公告”跨设备可避免重复展示 | 小，但非关键 |

### 10.3 不建议/不需要云同步

| Key/组 | 原因 |
|---|---|
| `popupHeight`、`popupWidth`、`zoom`、`scrollTop`、`focusID`、`focusSpot`、`viewState` | 设备/屏幕相关 UI 状态 |
| `activeView` | 可同步但优先级低；更多是“上次在哪”的本地状态 |
| `opens`、`openCount`、`donationKey`、`donationCountDown`、`donationFactor`、`donationDisabled`、`currentVersion` | 设备本地计数/捐赠状态 |
| `searchHistory` | 隐私/本地 |
| `visitStats`、`deadLastScan`、`vbmDeadScan`、`dupesLastResult` | 数据量可能大，且多为派生缓存/本地分析；如需跨设备应单独设计 |
| `vbmAnnounce`、`vbmGithubMirrors` | 远程拉取的缓存，不需要同步 |
| `vbmFaviconIdx`、`vbmFavicon:*` | **图标缓存：MB 级，无法用 `chrome.storage.sync`（100KB/8KB 单条），只能手动备份/重新抓取** |
| `vbmI18nDict` / `vbmI18nLang` | 本地同步引导缓存，不需要云同步 |

---

## 11. 存储“用错地方 / 需要统一迁移”的问题

### 11.1 明确问题清单

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| 1 | **设置仍然双写 localStorage** | `src/palette.js:276` | `/theme` 命令执行 `store.set('theme', name)` 后又 `localStorage.setItem('theme', name)`；而 `src/options.js:49-51` 已注释 localStorage 副本冗余。应统一由 store.js 管理镜像，特征代码不直写 localStorage |
| 2 | **迁移后的 localStorage 旧 key 未清理** | `src/store.js:96-99,253-291` | 老 key 迁移后仍保留在 localStorage，只清理了 `separatorUrl`、`deadProxyTemplate`；容易造成“改 local 但 localStorage 旧值仍在”的误导 |
| 3 | **大量新设置没进 `KNOWN_KEYS`/storage census** | `src/store.js:43-81`、`src/options.js` 各 settings 数组 | `statsEnabled`、`deadScanConcurrency`、`deadScanTimeout`、`openInSidePanel`、`quickAddFolderId`、`announceEnabled`、`collapseTabGroupMenu`、`collapseSortMenu`、`dupesLastResult` 等没有出现在 `KNOWN_KEYS` 或 `tests/storage-usage.test.js` 的 `EXPECTED` 中，census 覆盖不完整 |
| 4 | **`dupesLastResult` 是书签派生数据但落在 “other”** | `src/view-dupes.js:168`、`src/storage-usage.js` | 它与 `deadLastScan` 同属“书签派生结果快照”，量级可能不小，应归入 bookmarks 段或单独段 |
| 5 | **应同步的小偏好大量留在 `storage.local`** | `src/store.js:90-91` | `SYNC_KEYS` 只有 5 个 key；用户换设备后主题、视图、功能开关等会重置，体验不一致 |
| 6 | **`userstyle` 若进 sync 有单条 8KB 限制** | `src/options.js` userstyle 编辑器 | 需要先做体积策略（限制/分块/压缩）再决定是否 sync |
| 7 | **图标缓存不可能直接 sync** | `src/favicon-enrich.js` | MB 级 data URL；只能手动备份导入或重新抓取，不能简单加入 `SYNC_KEYS` |
| 8 | **统计条与缓存预算未统一** | `src/options.js`、`src/favicon-enrich.js` | 两套字节计算逻辑；未来新缓存缺少统一入口 |

### 11.2 目标存储模型建议

| 数据类型 | 应放位置 | 原因 |
|---|---|---|
| 用户偏好/设置（小） | `chrome.storage.sync` | 跨设备同步，配额够用 |
| 设备本地 UI 状态 | `chrome.storage.local` | 屏幕/使用习惯相关，不需要同步 |
| 书签派生数据/大缓存 | `chrome.storage.local` | 数据量大，不适合 sync；需要预算/淘汰 |
| 运行时状态/撤销栈 | `chrome.storage.session` | 临时、跨页面/跨 SW，但不需要持久 |
| 语言同步引导缓存 | `localStorage`（或专门 cache） | 需要在页面脚本执行前同步读取；目前是合理用途，但应独立管理 |
| 书签树本体 | `chrome.bookmarks` | 不应复制到扩展存储 |

---

## 12. 改造任务与方案清单

### 12.1 P0：先把现状做对（审计/归类/避免误导）

| # | 任务 | 方案 | 验收 |
|---|---|---|---|
| 1 | 补齐 storage census | 把 `statsEnabled`、`deadScanConcurrency`、`deadScanTimeout`、`openInSidePanel`、`quickAddFolderId`、`announceEnabled`、`collapseTabGroupMenu`、`collapseSortMenu`、`dupesLastResult` 等实际 key 加入 `KNOWN_KEYS` 或 `EXPECTED`；同时增强测试扫描动态 `store.set(CACHE_KEY, ...)` 与 settings 数组 key | `tests/storage-usage.test.js` 能发现新增/漏登记 key |
| 2 | 修正 `dupesLastResult` 分类 | 在 `src/storage-usage.js` 的 `isBookmarkDataKey` 中加入 `dupesLastResult`，或新增独立段 | 统计条中重复结果快照不再算 “other” |
| 3 | 明确统计条范围 | 选项页 hint/文档写明“仅 `chrome.storage.local` 10MB”；同步区、session、localStorage 单独说明 | 用户不会误以为“剩余”是全部存储 |

### 12.2 P1：统一设置存储与同步策略

| # | 任务 | 方案 | 验收 |
|---|---|---|---|
| 4 | 扩展 `SYNC_KEYS` | 将第 10.1 节高优先级小偏好迁入 `chrome.storage.sync`（theme、uiLanguage、customIcon、通用行为、视图/功能开关、排序/筛选、separators 等） | 新设备安装/登录后这些设置自动同步 |
| 5 | 迁移脚本 | 在 `store.js` 初始化中做一次性 local→sync 迁移：sync 有值则 sync 优先，无值则写 sync；迁移后 local 值可保留兜底或删除 | 老用户升级不丢设置，无重复写 |
| 6 | 统一 settings 定义 | 把 options 页的 general/view/icons/tools/stats 等数组改为同一份“key + area + 是否同步 + 迁移策略”的配置 | 不再散落多个数组，避免漏迁 |
| 7 | `userstyle` 同步策略 | 先限制最大 CSS 长度或分块；若 >8KB 则保持 local 并在 UI 标注“仅本机”，或使用压缩/分片同步 | 明确用户样式跨设备行为 |
| 8 | `customIcon` 同步 | 加入 `SYNC_KEYS`，后台/选项页从 sync 读取并恢复 action icon | 自定义图标跨设备一致 |

### 12.3 P1：清理 localStorage 双写与旧数据

| # | 任务 | 方案 | 验收 |
|---|---|---|---|
| 9 | 移除特征代码直写 localStorage | `src/palette.js` 不再 `localStorage.setItem('theme')`；若需要同步预填，由 store.js 统一维护 | `grep localStorage src/palette.js` 无业务写入 |
| 10 | 清理迁移后的旧 localStorage key | 在确认 `__migrated_v1` 且稳定运行 N 个版本后，删除 KNOWN_KEYS 在 localStorage 中的残留（保留 `vbmI18nDict`/`vbmI18nLang`） | localStorage 只剩语言缓存/受控镜像 |
| 11 | 语言缓存独立管理 | 将 `vbmI18nDict`/`vbmI18nLang` 从通用 localStorage 清理范围排除，并在存储文档中标注 | 语言切换不受清理影响 |

### 12.4 P1：统一存储统计与预算控制

| # | 任务 | 方案 | 验收 |
|---|---|---|---|
| 12 | 抽取 storage-budget 服务 | 新建 `src/storage-budget.js`：统一 `getBytesInUse`、分类、剩余空间、动态预算、淘汰策略接口 | 选项页统计条和 favicon-enrich 都调用同一服务 |
| 13 | 新缓存必须接入 budget | 新增 cache 时要求注册 key 前缀、分类、预算上限、淘汰回调；census 测试强制检查 | 没有预算的新 cache 无法通过测试 |
| 14 | 统计条性能优化 | 改为“读 key 列表 + 按分类 getBytesInUse”，避免每次全量 `get(null)` 拉 value | 选项页打开时不再全量读取 MB 级数据 |

### 12.5 P2：跨设备数据增强（需产品决策）

| # | 任务 | 方案 | 验收 |
|---|---|---|---|
| 15 | `deadMarks`/`deadMarkTimes` 同步 | 评估体积；如果可压缩到 sync 配额内则加入，否则设计自建同步/仅导出导入 | 多端标注一致或明确不支持 |
| 16 | `visitStats` 同步 | 需隐私确认；可提供“同步统计”开关，使用压缩 JSON 或自建后端 | 用户可选跨设备汇总 |
| 17 | `vbmAnnounceSeen` 同步 | 可加入 sync，避免每台设备重复展示公告 | 公告已读状态跨设备一致 |
| 18 | 图标缓存跨设备策略 | 维持 local + 手动备份导入；产品若要求自动同步，需单独设计“只同步索引/失败标记 + 各端自行抓图”的小体积方案 | 不因同步导致 `chrome.storage.sync` 爆配额 |

---

## 13. 补充证据索引

- 当前 `SYNC_KEYS` 只有 5 个：`src/store.js:90-91`
- 大量设置仍走 local：`src/options.js` 中 general/view/icons/tools/stats 等 settings 数组
- `palette.js` 直写 localStorage：`src/palette.js:276`
- `dupesLastResult` 快照：`src/view-dupes.js:168`
- storage census 扫描范围：`tests/storage-usage.test.js:11-14,111-125`
- favicon 缓存本地写入：`src/favicon-enrich.js:411,432,502`
- 语言缓存 localStorage：`src/i18n-live.js:18-20,165-167`

---

# 第三部分：复核修订与本次落地（2026-08-21 整改轮）

> 本部分是对第一、二部分审计结论的复核：纠正其中不准确的判断，并记录本轮按整改计划实际落地的改动。

## 14. 复核修订（推翻/修正前文的结论）

### 修订 1：`customIcon` 不能放入 `chrome.storage.sync`（推翻 §10.1 与任务 8）

- §10.1 估算 customIcon "约 1.4KB，可放 sync" 是按 19×19×4 原始字节算的；实际存储形态是 `JSON.stringify(imageData.data)`（`src/options.js:682`）——1444 个分量的对象字面量 JSON，序列化后约 **10–14KB**，超过 `chrome.storage.sync` 的**单条 8KB**（`QUOTA_BYTES_PER_ITEM`）硬上限。
- 结论：customIcon 保持 `storage.local`，任务 8 取消。跨设备诉求由设置备份导出/导入覆盖。

### 修订 2：以书签 ID 为键/值的数据不应云同步（推翻 §10.1 相应行）

- 书签 ID 是**设备本地分配**的，Chrome 书签同步不保证跨设备 ID 稳定。因此以下数据同步到另一台设备后指向的是错误节点或成为垃圾数据：
  - `quickAddFolderId`（值是文件夹 ID）——§10.1 列为高优先级是错误的，保持 local；
  - `separators`/`separatorTitle`/`separatorURL`/`separatorString`/`separatorcolor`（分隔符按书签 ID 挂载）——§10.1 列为高优先级是错误的，保持 local；
  - `deadMarks`/`deadMarkTimes`/`visitStats`（键是书签 ID）——印证 §10.2/§10.3 的"不同步"结论，但理由应改为"ID 设备相关 + 体积"，任务 15/16 相应降级为不实施；
  - `focusID` 同理（本来就在 §10.3）。
- 推论：任务 15/16 不做；若未来要多端一致，只能以 URL 为键重新设计数据集。

### 修订 3：localStorage 保留为"同步启动镜像"，清理口径调整（修正任务 9/10）

- `popup.js` 在 `store.ready` 之前就用 `store.get('theme')` 做首帧主题（防闪烁），`i18n-live.js` 同样同步读 localStorage 的语言缓存。store.js 的同步预填正是从 localStorage 读取的。
- 因此任务 10"清空迁移后的 localStorage 旧 key"不可全做：**sync 路由键的 localStorage 副本是首帧启动缓存**，必须保留并保持新鲜；但维护职责收归 store.js（`store.set/remove` 对 sync 键同步刷新 localStorage 副本），特征代码不再直写——任务 9 按此口径落地（移除 `src/palette.js:276` 的直写；`src/options.js` 的 theme 写入改由 setSetting 路由统一刷新启动副本）。

### 修订 4：设备/网络相关设置保持 local（补充 §10.1 边界）

- `openInSidePanel`、`autoResizePopup`（设备形态/屏幕相关）、`deadProxyServer`、`deadScanConcurrency`、`deadScanTimeout`、`hideDeadProxyStrip`（设备网络环境相关）保持 local。
- `userstyle` 保持 local（自定义 CSS 可能超 sync 单条 8KB，任务 7 的体积策略未做前不同步）。
- `searchHistory` 保持 local（隐私）；`vbmAnnounceSeen` 不同步（任务 17 价值低，不做）。

## 15. 本轮落地清单（对应 §12 任务编号）

| 任务 | 状态 | 说明 |
|---|---|---|
| P0-1 补齐 census | ✅ 部分 | `KNOWN_KEYS` 补齐真实设置键（statsEnabled、deadScan*、openInSidePanel、quickAddFolderId、announceEnabled、collapse*、dupes*/dead*/stats 排序筛选、hideDeadProxyStrip、deadProxyServer、donationDisabled、vbmBtnAlt、statsHistory* 等）；census 测试同步更新 |
| P0-2 dupesLastResult 分类 | ✅ 消解 | 统计图不再分类（见下），`dupesLastResult` 与其余数据同归"其他"；census tripwire 保留 |
| P0-3 统计条范围文案 | ✅ | hint 明确"仅 chrome.storage.local 本地扩展存储（约 10MB 配额），不含同步存储/会话存储/书签库本体" |
| 统计图简化（本轮新增） | ✅ | 横条改为 icon 缓存 / 其他 / 剩余 三段——用户决策：只针对 icon 缓存做可视化管理，不再按类分列 |
| P1-4 扩展 SYNC_KEYS | ✅ | 约 40 个小偏好键迁入 sync（外观 theme/uiLanguage、通用行为开关、视图显隐/禁用、功能开关、排序/筛选偏好、recentCount、favicon 开关等）；store.get/set/remove/adopt 与 getSetting/setSetting/removeSetting 按键名透明路由，调用点零改动 |
| P1-5 迁移 | ✅ | store.js init 做一次性 local→sync 迁移：sync 已有值优先；local 值写入 sync 成功后删除 local 残留（sync 已有值时的陈旧 local 残留也一并清理）；localStorage 启动副本按修订 3 保留并刷新；失败时保留 local 兜底下次重试。**实现教训（冒烟门禁抓到）**：迁移不得以 localStorage 为源——v1 迁移已覆盖真正的 legacy 值，localStorage 兜底只会复活陈旧启动副本（某键从 sync 删除后，下次加载又被副本迁回 sync，rememberView 永远保持关闭）；因此 init 增加启动副本卫生清理：sync 区和本次迁移集都没有、仅存在于启动副本的键视为陈旧，从镜像和 localStorage 一并丢弃，删除才能粘住 |
| P1-6 统一 settings 定义 | ⏸ 不做 | options 各 settings 数组经路由后无需改动；合并为单一配置表收益低于风险 |
| P1-7 userstyle 同步 | ⏸ 不做 | 修订 4 |
| P1-8 customIcon 同步 | ❌ 取消 | 修订 1 |
| P1-9 palette 直写 localStorage | ✅ | 移除，由 store.js 统一维护启动副本 |
| P1-10 清理 localStorage | ⏸ 收窄 | 按修订 3：sync 键副本保留；旧 key 残留维持现有"至少保留一个主版本作回滚"策略 |
| P1-11 语言缓存独立管理 | ✅ 已属现状 | `vbmI18nDict`/`vbmI18nLang` 本就不在清理范围，文档已标注 |
| P1-12/13/14 budget 服务/统一预算/统计性能 | ⏸ 不做 | 超出本版本范围；favicon 预算是目前唯一大缓存控制器，方向偏保守（§5.3），可接受 |
| P2-15/16/17/18 | ❌ 不做 | 修订 2（ID 设备相关）与修订 4（隐私/价值） |

### 随之调整的调用点

- `src/background.js`：`quickAddContextMenu` 改从 `chrome.storage.sync` 读取，onChanged 监听区域同步调整（`quickAddFolderId` 保持 local）。
- `src/visit-stats-sw.js`：`statsEnabled` 改从 `chrome.storage.sync` 读取，onChanged 区域调整。
- `src/view-manager.js`：视图显隐/禁用键的 onChanged 监听同时接受 local/sync 区域。
- `src/neat.js`：favicon 三个开关的 onChanged 监听同时接受 local/sync 区域。
- `src/options.js`：设置备份导入按路由拆分 local/sync 写入（旧备份里已迁移键落在 local 段也能正确回到 sync）；统计条三段化。

---

## 16. 第二轮复核：升级兼容性问题与修复（2026-08-21 整改轮·复审）

> 复审在 §15 落地后发现四个升级兼容性问题和一组文档不一致，均已修复（测试同步更新）。

### 16.1 SW 启动早于页面迁移，读到空 sync 区（已修）

- **问题**：local→sync 迁移在 `src/store.js` init（页面脚本）中执行，而 `src/background.js`（`quickAddContextMenu`）与 `src/visit-stats-sw.js`（`statsEnabled`）已改读 `chrome.storage.sync`。老用户升级后若尚未打开任何扩展页面，SW 先启动时 sync 区没有值，两个开关都会按默认值（开）运行，直到第一次页面打开完成迁移——升级后的第一个浏览器会话行为错误。
- **修复**：两个 SW 调用点改为"先读 sync，键不存在再兜底读 local（迁移前旧值）"。onChanged 监听本就已接受双区域，迁移完成后 sync 写入会实时纠正。

### 16.2 选项页首开可能显示默认设置（已修）

- **问题**：`src/options.js` 的 `initOptions()` 在第 43 行就 `getSetting('theme')` 并随后大量 `bindSettingsList`，而 `await store.ready` 直到约 670 行才出现。`getSetting` 对 sync 路由键直读 sync 区，升级后首次打开选项页时迁移尚未完成，会读到空 sync 区并显示默认值（如 theme 显示 auto 而非用户旧的 dark）。
- **修复**：首帧主题仍从同步预填读取（防闪烁），随后立即 `await store.ready`，再执行所有 `getSetting`/`bindSettingsList`。

### 16.3 旧备份同键冲突：local 段覆盖 sync 段（已修）

- **问题**：备份导入按 syncKeys 拆分写入时，`backup.local` 里的 sync 键会覆盖 `backup.sync` 段的同键值；旧备份中 local 往往是更旧的残留。
- **修复**：同键冲突时 sync 段优先（`backup.local` 的 sync 键仅在该键不在 `backup.sync` 时才采用）。

### 16.4 `setSyncSetting()` 未维护启动副本（已修）

- **问题**：`store.set`/`setSetting`/`store.adopt` 对 sync 键都会刷新 localStorage 启动副本，`setSyncSetting()` 没有，与"sync 键统一维护启动副本"的约定不一致（当前唯一调用方 paletteCustomCommands 不需要首帧副本，故无实际影响）。
- **修复**：`setSyncSetting()` 同步刷新启动副本，行为与其余写入路径一致。

### 16.5 混合版本冲突语义（已知取舍，文档明示）

- 场景：设备 A 已升级（值已迁 sync、local 残留已清），设备 B 仍是旧版本（写入 local）。B 的新改动要等 B 也升级并完成迁移才进 sync；期间 A 端以 sync 旧值为准，B 的改动看起来"被回退"。
- 结论：sync 优先 + 本地兜底是刻意取舍（否则无法清理 local 残留）。**升级后建议尽快在各设备打开一次扩展页面（popup/options）完成迁移**；不引入时间戳/版本冲突合并（复杂度远超收益，且 chrome.storage.sync 本身也是 last-write-wins）。

### 16.6 文档不一致（已修）

- 第一、二部分已标注"历史审计初稿"并指向第三部分；文档头部说明同步更新。
