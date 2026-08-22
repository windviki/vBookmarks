# favicon 默认图标补全方案

> 2026-08-15 · 真实 Chromium 实测 + 三个同类扩展解包调研 + 业界方案调研
> 状态：分析定稿 → **已实施（4.0.8）**；2026-08 v3/v4 起第三方聚合兜底改为**内置服务商列表**（favicon.run 首选 → icon.horse 居中 → DuckDuckGo 兜底，按服务商独立熔断 + 故障转移，实施定稿见 [`docs/favicon-补全设计.md`](favicon-补全设计.md) §3.4）
> 背景：用户反馈「很多网站没被墙、非 404 却显示默认 favicon」，询问是否有优化空间，提及 get-favicon 类扩展。

---

## 0. 结论速览

1. **根因**：Chrome `_favicon` API 依赖 Chrome 自己的 favicon 缓存，**不是实时抓取**。对 Chrome 未访问过（缓存未建立）的站点一律返回占位图 → `favicon-fallback` 识别占位图 → 换默认图标。**不是站点问题**。
2. **可补全**：技术路径已验证——`fetch` 外部 favicon → **blob URL** 注入 `<img>` 成功（无需改 CSP，`connect-src *` + `host_permissions <all_urls>` 已覆盖）。
3. **补全来源分层**：① 直连 `https://host/favicon.ico`（主，实测可行）→ ② 页面 HTML 解析 `<link rel=icon>`（覆盖非标准路径）→ ③ 内置第三方服务商列表聚合兜底（favicon.run → icon.horse → DuckDuckGo 按序尝试，按服务商独立熔断 + 自动故障转移；兜底 403/反爬；2026-08 实测 favicon.run 未知/无图标域名返回 HTTP 500 干净失败）。**无需第三方隐私依赖即可覆盖多数场景**。
4. **值得做**：显著减少「可访问但 Chrome 未缓存」站点的默认图标，选项开关 + 缓存 + 限流控制成本。

---

## 一、根因（真实 Chromium 实测）

用真实 harness 对 8 个知名站点（github/stackoverflow/youtube/MDN/wikipedia/cloudflare/google）探测 `_favicon`：

| 站点 | `_favicon` 返回 | 指纹 |
|---|---|---|
| 全部 8 个 | **同一占位图**（32×32, opaque=449, meanLum=99） | **791712946** |
| `.invalid`（校准用, 确定无 favicon） | 同一占位图 | **791712946** |

**结论**：Chrome 未访问过/缓存未建立的站点，`_favicon` 一律返回占位图。用户书签大量来自导入/历史，Chrome 从未为它们建立 favicon 缓存 → 全部显示默认图标。

**深层原因**（调研确认）：**Chrome 不向扩展暴露书签 favicon 缓存**，`_favicon` API 和 `chrome.tabs.favIconUrl` 都只能读 Chrome 已抓取的内容。这正是同类扩展（Bookmark Iconizer）需要靠「导出/导入书签备份 hack」写 favicon 的原因。

### 现状链路

```
bookmark URL → tree-render.getFaviconUrl → chrome-extension://ID/_favicon/?pageUrl=...&size=32
  → Chrome 缓存命中? 真实图标 : 占位图
  → favicon-fallback 像素指纹识别占位图 → 替换 DEFAULT_BOOKMARK_ICON(SVG)
```

### 技术约束（manifest.json CSP）

- `img-src 'self' data:` —— `<img src="https://外部">` 被 CSP 拦截
- `connect-src *` —— **fetch 外部 URL 允许**
- `host_permissions <all_urls>` + `favicon` 权限 —— 已具备

**实测确认**：`fetch` → `URL.createObjectURL(blob)` → `<img.src=blobUrl>` **加载成功**（32×32 真实图标），无需改 CSP。

---

## 二、同类扩展解包调研（吸收优势）

### 2.1 get-favicon（用户提及的扩展）

解包分析（`gpipahagclehninhhjkhbkliinfofnhe` v2.0）：
- **它不是补全工具**——只是展示当前标签页 favicon 的 URL + 尺寸
- 机制：`chrome.tabs.query().favIconUrl`（`activeTab` 权限）
- 印证：**Chrome favicon 体系（favIconUrl + _favicon）都依赖 Chrome 自己的抓取缓存**

### 2.2 FaviGrab（扫描策略最佳参考）

解包分析（`cnpgabmfnfehdamobkafalnpdoigdlil` v2.0.0）——内容脚本扫描页面图标：
```js
// 核心逻辑 (extractFavicons.js):
// 1. <link rel="icon"> / <link rel="shortcut icon">
//    读 href + sizes + type (svg/png/ico 格式识别)
// 2. <link rel="apple-touch-icon"> / -precomposed (默认 180px)
// 3. <link rel="manifest"> → fetch manifest.json → icons[] 数组 (size/type)
// 选图: 按 size 排序, 取最合适
```
**优势**：不猜路径，直接读页面声明的 favicon；覆盖 SVG/PNG/ICO/WebP 多格式；manifest icons 兜底。**这正是「非标准路径」的解法**。

### 2.3 Bookmark Iconizer（写回策略参考 + 又一个 favicon 服务）

解包分析（`hbnmehpggmbpiackncinpnlgkgbgmpjk` v1.7.6）：
- favicon 来源：`https://plus.google.com/_/favicon?domain=X`（又一个聚合服务，实测当前返回 HTML 不可用）
- 写回：生成 HTML 书签备份（`<DT><A HREF=... ICON="data:...">`）→ 用户手动导入
- **印证**：Chrome 无原生 favicon 写 API，只能靠导入 hack

### 2.4 Favicon Changer（全量更新参考）
支持全量更新书签 favicon、整站规则，但**依赖 Chrome 已抓取的 favicon**——不解决「缓存未建立」问题。

---

## 三、favicon 非标准路径调研

一个站点的 favicon 可能位于多个位置，完整发现链：

| 来源 | 路径/方式 | 说明 |
|---|---|---|
| `/favicon.ico` | 站点根 | 经典/legacy，多数工具直接抓 |
| `<link rel="icon">` | HTML head | 现代主流，指向任意路径/格式 |
| `<link rel="apple-touch-icon">` | HTML head | iOS，通常 180×180 PNG |
| `manifest.json` icons | `<link rel=manifest>` | PWA，可含 192/512 PNG |
| `<link rel="mask-icon">` | HTML head | Safari 固定标签 |
| OG image | `<meta property="og:image">` | 最后兜底 |

**关键**：仅猜 `/favicon.ico` 不够——现代站点常把 favicon 放在 `/icon.svg`、`/favicon-32x32.png`、CDN 等非标准路径。**必须 fetch 页面 HTML 解析 `<link>` 标签**。

### 已知边界/反爬
- 部分站点 `/favicon.ico` 返回 403（实测 stackoverflow）
- 部分站点返回 HTML 而非图标（CORS/反爬）
- ICO 多尺寸需选帧（`<img>` 加载时 Chrome 自动选）
- SVG favicon 在 `/favicon.ico` 下 404（需走 `<link>` 路径）

---

## 四、favicon 服务来源可用性（实测）

| 来源 | 实测结果 | 评价 |
|---|---|---|
| 直连 `https://host/favicon.ico` | github/MDN/cloudflare 200+真实 ICO；example.com 404（正确）；stackoverflow 403 | **主来源**，同源隐私好 |
| favicon.run `/favicon?domain=X&sz=32` | 2026-08 实测：github/stackoverflow/wikipedia/iana.org 200+真实 PNG（`sz` 精确控尺寸）；**未知或无图标域名（example.com 等）→ HTTP 500 干净失败**；CORS 开放 + Cloudflare CDN 缓存 + 30 并发无限流 | **聚合兜底首选**（内置服务商列表第一位，见设计文档 §3.4） |
| icon.horse `icon.horse/icon/X` | 隐私取向、按域名返回真实图标；**2026-08 实测推翻此前的 404 假设：未知/无图标域名返回 200 + 字母占位图（256×256 字母砖，按域名首字母确定性生成）**——经参考探针（`<L>-vbmref.invalid`）+ 像素指纹识别占位后降级 no-icon 继续故障转移（审计 F5 的低冲突中间家） | 聚合兜底第二位 |
| DDG `icons.duckduckgo.com/ip3/X.ico` | 可用，返回真实 ICO（与 github 一致） | 聚合兜底第三位（前两家不可用/无图标时切换；未知域名返回 200+自家占位，不可判定） |
| Google s2 `s2/favicons?domain=X` | 返回小 PNG（~519B） | 备选 |
| plus.google.com/_/favicon | 返回 HTML（不可用） | 弃用 |

---

## 五、推荐方案：三层发现 + 兜底

```
_favicon 返回占位图 (识别出真实 favicon 缺失)
  → 提取 host
  → [L1] fetch https://host/favicon.ico (timeout 3s)
      → 200 且是图片? blob URL 注入 ✓ (github/MDN/cloudflare 已验证)
      → 失败/404/403/非图片?
  → [L2] fetch 页面 HTML → 解析 <link rel=icon>/apple-touch-icon/manifest (timeout 5s)
      → 命中? fetch 该图标 URL → blob URL 注入 ✓ (覆盖非标准路径)
      → 全失败?
  → [L3] 第三方服务商列表逐一尝试 (内置列表: favicon-run → duckduckgo; 可选, 需选项开关) (timeout 3s) — 覆盖 403/反爬; 检测到某服务商不可达 → 熔断该家 + 切换下一候选
      → 成功? 注入 ✓
  → 都失败? 换 DEFAULT_BOOKMARK_ICON (现状兜底)
```

### 关键实现点

1. **blob URL 注入**（实测可行，无需改 CSP）：`fetch → blob → URL.createObjectURL`，图标加载后 revoke。
2. **按 host 缓存**：成功/失败都缓存（`storage.local`），失败短期（如 24h）免重试，避免每次渲染重复 fetch。
3. **并发限流**：大书签库首次渲染会并发，需限流（如 6-8 并发 + 队列），避免打爆站点。
4. **选项开关**：`faviconEnrich`（默认开？或默认关，需评估隐私观感）——书签管理器对已知站点 fetch favicon.ico 属合理行为，第三方服务商列表（favicon.run → icon.horse → DuckDuckGo）作为 L3 需在选项说明。
5. **只对占位图触发**：Chrome 缓存命中的真实 favicon 不触碰（现状路径不变）。
6. **图标校验**：fetch 后校验 Content-Type 是图片 + blob 大小合理（如 <200KB），避免 HTML 页面误注入。
7. **ICO 多尺寸**：`<img>` 加载 ICO 时 Chrome 自动选帧，直接注入即可。

### 新增/修改文件预估

- `src/favicon-fallback.js`：占位图识别处接入补全链（fetch + 缓存 + 限流）
- `src/favicon-enrich.js`（新）：纯逻辑模块（发现链 + 选图 + 缓存），可单测
- `src/options.js` + `pages/options.html`：`faviconEnrich` 开关
- `_locales/*`：新 key（选项文案）
- `tests/favicon-enrich.test.js`（新）：mock fetch 测发现链/缓存/降级
- `tests/favicon-fallback.test.js`：占位图→补全触发路径

### 风险与边界

| 风险 | 缓解 |
|---|---|
| 大书签库首次并发 | 限流 + 队列 + 缓存 |
| 站点 403/反爬 | L2 页面解析 + L3 服务商列表兜底（favicon.run → icon.horse → DuckDuckGo 故障转移） |
| SVG favicon / 非标准路径 | L2 解析 `<link>` |
| 隐私（外部请求） | 直连同源为主；L3 服务商列表加选项说明 |
| CSP | 已验证 blob URL 可行，无需改 |
| 误注入 HTML | 校验 Content-Type + 大小 |

---

## 六、与现状的对比

| 维度 | 现状 | 补全后 |
|---|---|---|
| 默认图标来源 | 仅 Chrome `_favicon` 缓存 | + 直连 / 页面解析 / 聚合服务 |
| 未访问站点 | 全部默认图标 | 多数补全真实图标 |
| 非标准路径 favicon | 无法覆盖 | L2 页面解析覆盖 |
| 第三方依赖 | 无 | 直连为主（无第三方）；服务商列表可选（favicon.run → icon.horse → DuckDuckGo） |
| 性能 | 无额外请求 | 缓存 + 限流控制 |

---

## 七、后续建议

1. **先实施 L1（直连 favicon.ico）+ 缓存 + 限流**——覆盖最大多数、零第三方依赖、改动可控。
2. **再加 L2（页面 `<link>` 解析）**——覆盖非标准路径，FaviGrab 策略可参考。
3. **L3（内置服务商列表）作为可选增强**——favicon.run → icon.horse → DuckDuckGo 按序尝试 + 按服务商独立熔断 + 自动故障转移；需选项开关 + 隐私说明，评估后决定是否默认（设计文档已定为默认关）。
4. **harness 验证**：参考 `tmp/favicon-补全分析.md` 的实测方法，加一个真实 Chromium 补全验证脚本。

---

*附：分析中间产物 `tmp/favicon-补全分析.md`；扩展解包源码在 `tmp/extension-analysis/`（get-favicon / FaviGrab / Bookmark Iconizer）。*
