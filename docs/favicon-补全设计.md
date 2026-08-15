# favicon 补全 · 细致架构设计

> 2026-08-15 · 回答实施前的 8 个关键设计问题
> 前置：[`docs/favicon-补全方案.md`](favicon-补全方案.md)（根因 + 发现链 + 来源调研）
> 本文聚焦「怎么落地」——开关、时机、启停、持久化、效率、视图刷新、与死链扫描结合、结果呈现。

---

## 0. 设计目标与原则

- **不阻塞渲染**：树/列表渲染绝不能等 favicon 补全的网络请求。
- **不重复请求**：同一 host 只补全一次，成功/失败都记住。
- **可关停**：选项开关即时生效，关闭即停（不排队、不请求、清掉在途的）。
- **不扩散权限/CSP**：沿用 `connect-src *` + `host_permissions <all_urls>`，`fetch → blob URL`，不改 manifest。
- **与死链扫描正交**：死链是「一次全量会话」，favicon 是「按需惰性补全」——不耦合，但可共用同一套 storage 通信/限流基建。

---

## 1. 开关（回答「是单独开关吗」）

**是。** 新增独立开关 `faviconEnrich`（默认**开**？见 §8 决策），与现有 `faviconContrast` 并列，放在选项页同组：

```
Views 组:
  ☑ favicon 反色（faviconContrast，现有）
  ☑ 补全缺失 favicon（faviconEnrich，新增）  ← hint: 对 Chrome 未缓存的站点
      自动从站点拉取真实图标（直连 /favicon.ico → 页面 <link> 解析 → DDG 兜底）
```

- 开关**独立**：与 `faviconContrast`（反色）无关，关闭反色不影响补全，反之亦然。
- 开关**即时生效**（见 §3）：关 = 清队列、取消在途 fetch、保留已缓存；开 = 下次渲染时对新占位图触发。
- 不拆分「直连 / 页面解析 / DDG」子开关——层级固定，用户只需一个总开关（DDG 属第三级兜底，选项文案说明）。

---

## 2. 执行时机（回答「树解析渲染时就进行？」）

**不是同步做，是异步按需 + 惰性触发。** 分两个时点：

### 2.1 渲染时：只「登记」，不「请求」
- 树/列表渲染（`tree-render.generateBookmarkHTML`）生成 `<img src="_favicon/...">`——现状不变。
- `favicon-fallback` 的 capture-phase `load` 捕获每个 favicon `<img>`，识别出**占位图**后：
  - **现状**：直接 `swapForDefaultIcon`（换默认 SVG）。
  - **补全后**：先查缓存（见 §4）——命中 → 注入缓存图标；未命中 → **登记到补全队列**（§2.2）→ 先 `swapForDefaultIcon` 占位（视图立刻可读，不白屏），补全成功后热替换。
- **关键**：渲染路径零网络请求、零等待。补全是渲染之后的事。

### 2.2 补全执行：前端队列 + 限流（不在 SW）
```
favicon-fallback 识别占位图 + 未缓存
  → 入队 { host, url, img 引用 }
  → 限流器（并发 ≤ 6）逐项处理:
      L1 fetch https://host/favicon.ico (3s) → ok? 缓存 + 热更新 img
      L2 fetch 页面 HTML (5s) → 解析 <link rel=icon> → fetch 图标 → 缓存 + 热更新
      L3 fetch DDG (3s) → ok? 缓存 + 热更新
      → 全失败: 若死链扫描会话在 + 配了代理 → addProxyMarker(url) 走代理重试 (L1/L2)
      → 仍失败: 缓存 {host, failed: true, ts} (24h 免重试)
```
- **代理通道**（§7）：直连 L1/L2/L3 失败后，若死链扫描的 PAC 会话在（`dead-scan-sw` 已 `startProxySession`）、且用户配了代理，给 URL 加 `addProxyMarker`（`__vbm_px=1`）重试——覆盖「直连不可达但代理可达」的站点（用户洞察）。
- **为什么前端而非 SW**：favicon 补全需要**就地更新已渲染的 `<img>`**（视图热更新），前端有直接的 DOM 引用；SW 拿不到。死链扫描是「结果集中展示」才适合 SW。favicon 的「结果」是散落在各行的图标，前端做更自然。
- 队列生命周期：popup 打开期间。popup 关闭队列自然丢弃（缓存已持久化，下次打开不再触发）。

---

## 3. 启停控制（回答「如何控制任务启停」）

### 开关关闭
```
options 翻转 faviconEnrich off
  → chrome.storage.onChanged → neat.js 监听（同 faviconContrast 模式）
  → faviconService.setEnrichEnabled(false)
  → 清空队列、AbortController 取消在途 fetch
  → 保留已缓存图标（不撤），但停止新补全
```

### 开关打开
```
faviconService.setEnrichEnabled(true) → 下次渲染占位图时正常触发
```

### 运行中
- **单实例**：队列 + 限流器只在一个 popup 会话内；重复打开 popup 不重复（缓存命中）。
- **不常驻**：无 background 定时任务（除非 §7 的「顺带」模式）。popup 生命周期即补全生命周期。

---

## 4. icon 持久化（回答「得到的 icon 如何持久化」）

### 存储：`chrome.storage.local`，按 host 缓存，base64 data URL
```js
// key: `vbmFaviconCache` — 一个 JSON 对象 { [host]: { icon: "data:image/x-icon;base64,...", ts } }
// 或按 host 分 key: `vbmFavicon:github.com` = data URL
```

- **为什么 data URL 而非 blob**：blob URL 是会话级（页面关闭即失效）；data URL 可持久化、跨渲染注入（`<img src=dataURL>` 稳定）。32px 图标 base64 约 1-4KB。
- **为什么 storage.local 而非 sync**：sync 每项 100KB 上限 + 同步延迟，不适合图标二进制。local 5MB 默认配额——按 2000 host × 3KB ≈ 6MB **可能超配**。对策：
  - **LRU 上限**：只缓存最近使用/成功的 N 个（如 500），超出淘汰最旧。
  - **只存成功**：失败只存 `{failed:true, ts}` 标记（极小）。
  - **可选：关到 storage.session**（popup 短期用，会话级）——但用户希望「打开就快」，跨会话缓存更有价值，故 local + LRU。

### 读取路径
```
渲染占位图 → getCached(host) 同步读镜像（store 的 storage.local 镜像）→ 命中直接注入
```
- 利用现有 `store.js` 的 storage.local **镜像**（`store.get` 同步读），避免每次渲染异步读 storage。
- 缓存写入走 `store.set`（200ms debounce 持久化），与现有键一致。

### 失效策略
- `failed` 标记 24h 后清（允许重试——站点可能后来加了 favicon）。
- 成功图标长期保留，直到 LRU 淘汰。
- 书签删除不影响（按 host 缓存，多个书签共享）。

---

## 5. 效率 / 卡顿（回答「会不会慢导致卡顿」）

### 不卡顿的四个保证
1. **渲染零阻塞**：渲染只同步读缓存镜像（内存），网络请求全在队列异步做（§2）。
2. **并发限流**：`≤ 6` 并发 + 队列，避免打爆站点/被限流（实测 s2 有 rate limit）。
3. **按 host 去重**：同一 host 的多书签共享一次补全（队列按 host 合并）。
4. **失败免重试**：`failed` 24h 标记，避免每次打开都重试一堆 403/无 favicon 站点。

### 首屏体验
- 大书签库首次打开：几百个占位图入队，限流 6 并发，每个 ~3-5s → 分批完成。
- 视图**不卡**（异步），图标**陆续**从默认变真实（热更新）。
- 可加「补全中」视觉（§8）：`<img>` 上加个轻微 loading 态（CSS opacity 过渡），完成即清晰。

---

## 6. 视图刷新（回答「一边获取一边保证视图刷新」）

### 热更新机制：复用 favicon-fallback 的 img 引用
`favicon-fallback` 的 `handle(img)` 已持有每个占位图 `<img>` 的引用。补全成功后：
```js
// 补全成功 → 热更新该 img
img.src = cachedIconDataUrl;   // 直接换 src
img.classList.remove('favicon-contrast-invert');  // 新图标重新判定反色
applyContrast(img);            // 复用现有反色服务
```

- **为什么可行**：`handle` 已在 capture-phase load 捕获所有 favicon `<img>`，补全只需**保存这些引用**到队列，完成后 `img.src` 替换。
- **行重渲染**：若补全完成时行已重渲染（原 img 脱离 DOM），`img.parentNode` 为空 → 跳过热更新，但**缓存已写**，下次渲染命中缓存直接显示。
- **视图未打开**（如补全在 popup 外触发，见 §7）：无 DOM 引用，只写缓存，下次打开渲染即命中。

### 补全与反色的顺序
1. 占位图识别 → 入队 → `swapForDefaultIcon`（默认 SVG）
2. 补全成功 → `img.src = dataURL` → 移除反色类 → `applyContrast` 对新图标判定反色
3. 补全失败 → 保持默认 SVG（现状）

---

## 7. 与死链扫描结合（回答「可以在死链扫描时顺便补全吗」）

### 核心洞察（用户补充）：死链扫描的**代理通道**是 favicon 补全直连通道不具备的

- favicon 补全的 L1/L2/L3 是**直接 fetch**（`fetch(host/favicon.ico)`）——**对「直连不可达」的站点（被墙/区域限制/ISP 阻断）无效**。
- 死链扫描的双通道 `checkUrlDual` 在直连失败后，**走用户配置的代理**（marker-PAC：`addProxyMarker(url)` 加 `__vbm_px=1` 参数 → PAC 路由到代理，`dead-proxy.js`）——**直连取不到的 icon，代理通道能取到并补齐**。
- 这就是用户的洞察：**「即使不是一个过程，开关开启时，死链扫描可以做更多额外工作」**。

### 机制确认

```
死链扫描会话（dead-scan-sw.js）:
  startProxySession(server)  ← 扫描开始时安装 PAC, 带 marker 的 URL 走代理
    → checkUrlDual: 直连失败 → addProxyMarker(url) 走代理 → blocked(可达)/dead(双失败)
  endProxySession()  ← 扫描结束/取消/页面关闭时拆除
```

**代理会话生命周期 = 死链扫描会话**。所以 favicon 补全要利用代理，**必须与死链扫描的会话窗口对齐**。

### 双通道 favicon 补全（新设计）

favicon 补全本身就有两条腿，与死链扫描是「共享代理通道」而非「顺带」：

```
favicon 补全独立跑（popup 生命周期）:
  L1/L2/L3 直接 fetch (覆盖: Chrome 未缓存 + 直连可达站点)

死链扫描会话期间（开关 faviconEnrich 开启 + 有代理）:
  favicon 补全的请求加 addProxyMarker(url) 走代理
    (覆盖: 直连不可达但代理可达的站点——L1/L2 直连失败的二次机会)
  → 扫描到 blocked(代理可达) 的站点, favicon 顺带取到
```

### 死链扫描响应阶段的「顺带」（补充，非依赖）

死链扫描**已 fetch** 书签 URL。在**响应阶段顺手解析 `<link rel=icon>/manifest`**（复用响应，零额外请求）：
```
死链扫描 fetch 书签 URL（检查死链）
  → 响应 200 → 顺手解析 <link rel=icon>/manifest → 发现图标 URL
  → 写入 favicon 缓存（存 URL, 不立即 fetch 图标）
  → 下次 favicon 渲染占位图 → 缓存命中 URL → fetch 图标 → 注入
```
**代价**：死链扫描现在是 HEAD 请求（HEAD 拒绝才 GET），不读 body。要解析 `<link>` 需改为 GET + 读 body——增加带宽。所以顺带解析是**可选项**，权衡：只对 `blocked`（代理可达）站点做 GET+解析（这些正是直连补全不到的），直连 ok 的站点靠 L1/L2 即可。

### 分层结论

| 通道 | 覆盖 | 触发 |
|---|---|---|
| favicon 补全 L1/L2/L3 直连 | Chrome 未缓存 + 直连可达 | 渲染占位图时（popup 生命周期） |
| favicon 补全走代理（会话内） | 直连不可达 + 代理可达 | 死链扫描会话期间 |
| 死链扫描顺带解析 `<link>` | 同上 + 零额外请求 | 死链扫描响应阶段（可选） |

**实施顺序**：先独立补全（直连 L1/L2/L3）→ 再加「死链会话内走代理」→ 最后加「死链顺带解析」。三者正交，逐步叠加。

---

## 8. 结果呈现（回答「补全的结果列表如何呈现」）

### 核心：favicon 补全的「结果」不是列表，是每行的图标就地更新
这是与死链扫描最大的不同——死链有「发现 N 个死链」的汇总，favicon 补全的成果**散落在每个书签行**，用户看到的就是「图标从默认变真实」。

### 可选的三个呈现层次
1. **就地更新（默认，零 UI）**：图标陆续从默认 SVG 变真实。这是最自然的呈现，无需额外 UI。
2. **「补全中」视觉**：占位图 `<img>` 在补全进行时加个轻量 loading（CSS opacity 0.6 + 过渡），完成恢复——用户感知「正在补全」，不觉得是卡顿。
3. **选项页统计（可选增强）**：在选项页 favicon 组显示「已补全 X 个 / 缓存 Y 个 / 失败 Z 个」，配合一个「立即补全未缓存项」按钮（手动触发批量补全，见 §7 顺带）。

### 不建议做「结果列表」
- favicon 补全是**后台静默增强**，不是用户主动发起的扫描——做列表会变成「又一个扫描视图」，违背「补全缺失图标」的轻量定位。
- 用户感知价值 = 「打开书签库，图标比之前全了」，而非「看补全报告」。

---

## 9. 新增/修改文件

| 文件 | 改动 |
|---|---|
| `src/favicon-enrich.js`（新） | 纯逻辑：发现链（L1/L2/L3）、队列、限流器、缓存读写、AbortController 取消——可单测 |
| `src/favicon-fallback.js` | 占位图识别后：查缓存注入 / 登记队列（不直接换默认）；暴露 `enrich` 钩子；补全成功热更新 |
| `src/neat.js` | 初始化 favicon-enrich + storage.onChanged 监听开关 |
| `src/options.js` + `pages/options.html` | `faviconEnrich` 开关 |
| `src/store.js` | 注册 `faviconEnrich` 键（sync 区）+ `vbmFaviconCache` 键（local 区） |
| `src/favicon-enrich.js` | 导入 `addProxyMarker`（dead-proxy.js）走代理通道 |
| `src/dead-scan-sw.js`（代理会话共享） | 会话窗口通知 favicon-enrich「代理可用」；可选：响应阶段解析 `<link rel=icon>` → 写 favicon URL 缓存 |
| `_locales/*` | `optionFaviconEnrich` / `optionFaviconEnrichHint` 等新 key |
| `tests/favicon-enrich.test.js`（新） | 发现链/缓存/限流/取消/降级 |
| `tests/favicon-fallback.test.js` | 占位图→补全触发路径 + 热更新 |
| `tests/neat.test.js` | 开关 onChanged 接线 |

---

## 10. 风险与决策清单

| 决策 | 选项 | 建议 |
|---|---|---|
| `faviconEnrich` 默认 | 开 / 关 | **默认开**——用户已报告「很多默认图标」，开箱即受益；关闭途径在选项。DDG L3 是唯一第三方请求，可在文案注明（或默认关 L3） |
| 缓存配额 | 全量 / LRU 500 | **LRU 500 + 只存成功**，防超 5MB |
| 并发 | 4 / 6 / 8 | **6**，平衡速度与站点压力 |
| 失败免重试 | 24h / 7d | **24h**，允许站点后来加 favicon |
| 补全执行位置 | 前端 / SW | **前端**（就地热更新需要 DOM 引用） |
| 死链会话内走代理 | 做 / 不做 | **做**（用户洞察: 直连取不到的 icon, 代理通道能补齐）——独立补全的 L1/L2 直连失败后, 若死链会话在且配了代理, 加 `addProxyMarker` 重试 |
| 死链顺带解析 `<link>` | 做 / 不做 | **后做**（需改 HEAD→GET+读 body, 增加带宽; 独立补全 + 代理通道先落地） |
| 补全中视觉 | 有 / 无 | **有**（轻量 CSS loading），提升感知 |

---

## 11. 实施顺序（每步独立提交 + 全绿）

1. **S1**：`favicon-enrich.js` 纯逻辑（发现链 L1/L2/L3 + 缓存读写 + LRU + 限流器）+ 单测
2. **S2**：`favicon-fallback` 接入——占位图登记队列、补全成功热更新 + 单测
3. **S3**：`neat.js` 接线 + 开关（options/store/i18n）
4. **S4**：**代理通道**——`favicon-enrich` 导入 `addProxyMarker`，直连失败 + 死链会话在 + 有代理 → 走代理重试（用户洞察：直连取不到的 icon 代理能补齐）
5. **S5**：死链扫描顺带解析 `<link>`（增强，需 HEAD→GET+读 body 权衡）
6. **S6**：harness 验证（真实 Chromium 补全 → 图标变真实）+ 文档同步

---

*设计定稿，实施前需确认 §10 决策清单（尤其 `faviconEnrich` 默认开/关、LRU 上限、并发数）。*
