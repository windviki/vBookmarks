# favicon 补全 · 原生功能设计（实施定稿）

> 2026-08-15 · 实施版，所有决策已定稿（§15），无开放项。
> v2 打磨：DDG 服务级熔断与代理兜底（§3.3/§3.4）；存储改为按 host 分键 + 索引，写开放大、爆炸边缘 case、淘汰管理全部明确（§5）。
> v3/v4 更新（4.0.8，替代早期已实现的单一家 DDG 聚合层）：第三方聚合兜底改为**内置服务商列表 + 按服务商独立熔断 + 自动故障转移**（§3.4）——`favicon-run` 首选、`duckduckgo` 兜底；检测到某服务商不可达即跳闸并切换下一候选，**不重复尝试**。2026-08 实测 favicon.run：已知站点 200+真实 PNG；**未知/无图标域名 HTTP 500 干净失败**（DDG 对未知域名返回 200+自家占位，不可判定）。各家判定差异封装为**一致行为接口**（`url` + `interpret`）。其余链路（L1/L2/L3）与缓存/预算机制不变。
> 前置：[`docs/favicon-补全方案.md`](favicon-补全方案.md)（根因 + 真实 Chromium 实测 + 同类扩展调研）。
> 本文是「补全缺失的网站图标」作为 vBookmarks **原生功能**的唯一实施依据：模块边界、代码契约、存储形状、选项 UI、测试与提交步骤均精确到文件与函数。

---

## 0. 用户需求与功能定位

**用户问题**：书签库里大量网站显示默认图标。实测已证实根因——Chrome `_favicon` API 只读 Chrome 自己的 favicon 缓存，对缓存未建立的站点一律返回占位图；用户书签多来自导入/历史，Chrome 从未为它们抓过图标。**不是站点问题，不是被墙，不是 404。**

**功能定义**：渲染时识别出占位图 → 异步向**用户自己收藏的网站**拉取真实 favicon → 就地替换行内图标 → 按 host 持久缓存。用户感知 = 「打开书签库，图标比之前全了」。

**原生性约束**（与 vBookmarks 现有架构对齐，不引入异质模式）：

- **零新权限、零 manifest 改动**：`connect-src *` + `host_permissions <all_urls>` 已覆盖 fetch；`img-src 'self' data:` 已覆盖 data URL 注入。
- **零默认第三方依赖**：主链路只向用户已收藏的站点发请求（等同于访问该站）；第三方聚合兜底（内置服务商列表，§3.4）做成独立子开关、默认关（§6），且带按服务商熔断 + 故障转移。
- **复用现有基建**：`favicon-fallback` 的占位图识别与反色采样、`dead-proxy.js` 的 marker-PAC 代理通道、options 页 Icons 组的开关模式、`tests/helpers/` 测试桩。
- **遵循「操作即模块」**：纯逻辑全部进 `src/favicon-enrich.js`（ES 模块、可单测），`neat.js` 只做薄接线。

---

## 1. 现状链路（代码事实，设计的地基）

```
tree-render.js:144 getFaviconUrl(url)
  → chrome-extension://ID/_favicon/?pageUrl=<url>&size=32
  → <img width=16 height=16 loading="lazy">          (tree-render.js:161)
  → favicon-fallback.js 的 capture-phase load 委托捕获每个 img
  → handle(img)：calibrate 校准占位图指纹 → verdicts: src → true(占位)/false(真实)
      true  → swapForDefaultIcon(img)  ★ 注意：是 replaceChild(svg, img)，img 被移出 DOM
      false → statsBySrc.set(src, 像素统计) → applyContrast(img)（反色服务）
```

设计必须兼容的三个既有事实：

1. **`swapForDefaultIcon` 会销毁 `<img>`**（favicon-fallback.js:158-164，`img.parentNode.replaceChild(svg, img)`）。旧稿假设「持有 img 引用、补全成功后改 `img.src`」**不成立**——那时 img 已不在 DOM 里。热替换必须换成「记住锚点 `<a>`，完成后把里面的默认 SVG 换回 `<img>`」（§4）。
2. **反色依赖 `statsBySrc`（按 src 存像素统计）+ `applyContrast`**。注入的 data URL 图标不在 `_favicon` 链路里，`handle()` 对不含 `/_favicon/` 的 src 直接返回（favicon-fallback.js:200）——反色统计要由补全模块自己采样写入（§4.3）。
3. **`reapplyContrast` 的选择器是 `img[src*="/_favicon/"]`**（favicon-fallback.js:244）。注入的 data URL 图标不匹配，主题切换时会漏掉反色重判——选择器需要扩展（§4.1 第 3 项）。

其他已核实的基建事实：

- `store.js` 镜像面向**设置键**（KNOWN_KEYS 静态枚举）；图标缓存是动态 host 键的数据，不走 store——先例是 `deadLastScan`/`vbmDeadScan`，同样由持有方直接读写 `chrome.storage.local`（§5.1）。
- 设置备份导出**整个 local 区**（options.js:239 `chrome.storage.local.get(null)`），无排除名单——图标缓存（MB 级 base64）必须按前缀显式排除（§5.4）。
- `chrome.storage.local` 默认总配额 **10MB**，与死链缓存、访问统计等所有 local 键共享——图标缓存必须自带动态字节预算（§5.3）。
- 死链扫描的代理会话对页面可见：`dead-scan-sw.js` 在 PAC 安装成功时写 `chrome.storage.session` 的 `vbmProxySession` 标记（dead-scan-sw.js:138），拆除时移除（:113）；`background.js:39-43` 冷启动按它清扫残留。页面侧 `chrome.storage.session.get('vbmProxySession')` 即为「PAC 此刻在线」的权威信号——**无需新增任何 SW 消息**。
- PAC 一旦安装即浏览器级生效（scope regular），popup/panel 页面里的 fetch 同样被路由；`addProxyMarker(url)` 加 `__vbm_px=1` 参数即走代理（dead-proxy.js:109-114）。
- 死链扫描的 `checkUrl` 是 HEAD 优先、405/501/403 才 GET，**从不读 body**（dead-links.js:49-70）——「扫描顺带解析 `<link>`」需要改 GET+读 body，明确不做进本期（§15）。
- `neat.js` 不进 vitest（AGENTS.md：应用壳由 harness smoke 门禁），所以开关接线不写单测，由 `scripts/harness/run.sh --smoke-only` 兜底。
- `pages/popup.html` 与 `pages/sidepanel.html` 脚本列表保持同步（`tests/fuzzy.test.js` 钉 parity）；补全模块只被 `neat.js` 静态 import，两个页面自然都有。popup 与 side panel 实践中互斥（`openInSidePanel` 二选一），不存在双页面重复请求的现实场景。
- `package.py` 的 `resolve_js_imports` 沿 import 图递归收文件——`neat.js` 静态 import 新模块即自动进包，无需改打包清单。

---

## 2. 总体架构

```
[渲染路径 —— 同步、零网络]
tree-render / search / palette / recent 渲染 <img _favicon>
  → fallback.handle(img)，verdicts 判定为占位图
  → ctx.onPlaceholder(img)（favicon-enrich 注入的钩子，同步返回 boolean）
      缓存命中成功 → 钩子就地替换为 enriched <img>，return true（fallback 不再换默认）
      缓存未命中   → 登记补全队列，return false → fallback 换默认 SVG（视图立即可读）
      缓存命中失败标记(24h 内) → return false → 换默认 SVG，不发任何请求

[补全路径 —— 异步、限流、按 host 去重]
队列项 { host, pageUrl, anchors:Set<HTMLElement> }
  → 限流器（并发 ≤ 6）逐 host 走发现链：
      L1  fetch https://<host>/favicon.ico            (3s)
      L2  fetch 书签页 HTML (5s) → 提取 <link> 图标声明 → fetch 图标 (3s)
      L3  代理接力（死链扫描代理会话在线时）：addProxyMarker 重试 L1/L2，
          熔断中的服务商也经代理补试一次  (3s/5s/3s)          （§3.3）
      L4  第三方聚合兜底——内置服务商列表逐家尝试（favicon-run → duckduckgo），
          按服务商独立熔断 + 自动故障转移  (各家 3s)          （§3.4）
          ★ 仅 faviconEnrichAgg 开——**最终手段**，直连+代理都失败才兜底
  → 成功：校验 → 解码验证 → 按 host 写缓存 → 热替换 anchors 内的默认 SVG → 采样反色
  → 全失败：写 failed 标记（24h 免重试）
```

**模块边界**：

| 模块 | 职责 |
|---|---|
| `src/favicon-enrich.js`（新，ES 模块） | 发现链 L1-L4、服务商列表与按服务商熔断、图标校验与解码、data URL 编码、缓存层（按 host 分键 + 索引 + LRU/字节预算/自愈）、队列与限流、AbortController 取消、热替换与反色登记。页面依赖（`fetch`/`Image`/`chrome.storage`）全部可注入，node 下可单测 |
| `src/favicon-fallback.js`（改，3 处小改） | 新增 `ctx.onPlaceholder` 钩子；返回 API 增加 `sampleIcon`；`reapplyContrast` 选择器扩展（§4.1） |
| `src/neat.js`（薄接线） | 实例化 enricher，接进 faviconService；扩展现有 `storage.onChanged` 监听（faviconEnrich / faviconEnrichAgg 两键） |
| `src/options.js` + `pages/options.html`（改） | Icons 组加两个开关 + 一个清除缓存按钮；备份导出按前缀排除缓存键 |
| `src/store.js`（改 1 行） | `KNOWN_KEYS` 注册 `faviconEnrich`、`faviconEnrichAgg`（仅两个开关键；缓存的动态 host 键不入 KNOWN_KEYS） |

钩子挂在 `favicon-fallback` 的 capture-phase 委托上，意味着**树、搜索结果、palette 行、recent 视图——所有走 `_favicon` 的 `<img>` 自动获得补全**，无需逐视图接入。

---

## 3. 发现链详表

| 层 | 请求 | 超时 | 覆盖场景 | 前提 |
|---|---|---|---|---|
| L1 | `GET https://<host>/favicon.ico` | 3s | 经典路径，实测 github/MDN/cloudflare 可用 | faviconEnrich |
| L2 | `GET <pageUrl>`（书签本身的 URL）→ 提取 `<link>` → `GET <iconUrl>` | 5s + 3s | 非标准路径（`/icon.svg`、CDN、apple-touch-icon） | faviconEnrich |
| L3 | `addProxyMarker` 重试 L1、L2；熔断中的服务商也经代理补试一次 | 3s + 5s + 3s | 直连不可达但用户代理可达（区域/ISP 限制，**含服务商本身被区域的场景**） | faviconEnrich + 死链代理会话在线 |
| L4 | 内置服务商列表逐家尝试：`favicon-run`（`GET https://favicon.run/favicon?domain=<host>&sz=32`）→ `duckduckgo`（`GET https://icons.duckduckgo.com/ip3/<host>.ico`） | 各家 3s | **最终手段**——直连+代理都失败才兜底（站点 403/反爬）；按服务商独立熔断 + 故障转移（§3.4） | faviconEnrich + faviconEnrichAgg |

**链规则**：逐层串行，任一层产出**通过校验**的图标即短路返回；任一层抛错/超时/校验失败即落到下一层；全部落空写 failed 标记。

### 3.1 图标校验（每一层产出统一过这道门）

1. HTTP `res.ok`（2xx）；非 2xx 视为失败。
2. 读 `res.arrayBuffer()`，`byteLength ≤ 200KB`（防把整页 HTML 当图标）。
3. 类型判定：`Content-Type: image/*` 直接采信；否则 sniff 魔数——ICO `00 00 01 00`、PNG `89 50 4E 47`、GIF `47 49 46 38`、JPEG `FF D8`、SVG 文本以 `<` 起。都不匹配 → 失败。
4. **解码验证**：base64 编成 data URL（MIME 取 Content-Type 或按魔数推断）后 `new Image()` 加载，`naturalWidth > 0` 才缓存。这是最终防线——服务器返回「200 + 错误内容」时不会把坏数据写进缓存。

base64 编码用分块 `String.fromCharCode` + `btoa`（纯 JS，无 DOM 依赖，node 可测）。

### 3.2 L2 的 `<link>` 提取（不用 DOMParser）

node 无 DOMParser，为保证模块可单测，用**容错的属性级正则**扫原始 HTML：

- `<link\b[^>]*>` 逐个取标签，再按 `(rel|href|sizes|type)\s*=\s*("…"|'…'|裸值)` 提属性（属性顺序无关）。
- `rel` 按空白拆 token，命中 `icon` / `shortcut icon` / `apple-touch-icon` / `apple-touch-icon-precomposed` / `mask-icon`。
- **`href="data:…"` 直接用**：本身就是图标数据，省一次 fetch，直接进校验第 4 步。
- 相对路径用 `new URL(href, pageUrl)` 解析。
- 选图打分：`sizes` 含 `16x16`/`32x32` → 3；`type="image/svg+xml"` → 2；其余 → 1；取最高分，同分取先出现者。SVG 没有固定尺寸但缩放无损，优先级高于未知位图。
- `<link rel="manifest">` 本期不追（多一次 JSON fetch，收益边际），代码里留注释说明。

### 3.3 L3 代理接力（在第三方聚合之前——站点自身图标优先）

**为什么 L3 在 L4（第三方聚合）之前**：代理接力重试的是 **L1/L2（站点自身的 favicon.ico / 页面 `<link>`）**——这些是「该站点真实意图」的图标，比第三方聚合更可靠。直连失败的区域/ISP 限制站点，代理可能拿到真实图标；聚合服务商对查不到的域名各有判定（favicon.run 500 可判定、DDG 200+占位不可判定），但聚合层本质仍是「该站有没有」的二手信息，**站点自身图标（含代理通道） > 第三方聚合**，故代理接力在第三方聚合之前。

```js
const proxyRelayAvailable = async () => {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.session)
        return false;
    const ses = await chrome.storage.session.get('vbmProxySession');
    if (!ses || !ses.vbmProxySession)
        return false;                       // PAC 不在线
    const loc = await chrome.storage.local.get('deadProxyServer');
    return !!(loc && loc.deadProxyServer);  // 用户确实配过代理
};
```

- 读 `chrome.storage.session` / `chrome.storage.local` **直读，不走 store 镜像**——镜像只反映页面加载时刻，扫描会话的 PAC 状态是运行期变化的。
- **重试范围 = L1、L2，以及「直连熔断中的服务商」**：L1/L2 无条件重试（直连失败的站点代理可能可达）；对每个**直连跳闸（不可达）**的服务商，在 `faviconEnrichAgg` 开时经代理补试一次——覆盖「服务商直连不可达但代理可达」的场景。服务商直连正常时不走代理（无意义的双倍请求）。
- L3 经代理的成功与直连成功同等对待：过同一道校验（§3.1）、写同样的缓存。代理取到的图标**不会**解除对应服务商的直连熔断（熔断描述的是直连可达性），`down[<id>]` 照旧到期自愈。
- PAC 窗口竞态（重试在途时扫描结束拆 PAC）→ fetch 失败 → 落入 failed 标记。因为直连已经失败过，这个 failed 不冤，24h 后正常重试，无需特殊处理。
- 代理流量与扫描共享 PAC 但互不协调：补全自己的 6 并发限流天然封顶，不会给扫描施压。

### 3.4 L4 第三方聚合兜底（内置服务商列表 + 故障转移）

**结构**：聚合层不绑定单一服务商，而是**内置一个有序服务商列表**，逐家尝试、**按服务商独立熔断**、**自动故障转移**——检测到某家不可达即跳闸并切下一候选，不做无谓重复。每家服务商实现**一致行为接口**，各自差异全部封装在接口内：

```js
// 一致行为接口：上层链只认 url(host) + interpret(outcome)，不感知各家差异。
const AGG_PROVIDERS = [
    { id: 'favicon-run', url: h => `https://favicon.run/favicon?domain=${h}&sz=32` },
    { id: 'duckduckgo',  url: h => `https://icons.duckduckgo.com/ip3/${h}.ico` },
];
```

**2026-08-15 实测**（真实 curl）：

| 服务商 | 已知站点 | 未知/无图标域名 | 其他 |
|---|---|---|---|
| favicon-run | 200+真实 PNG（github/stackoverflow/wikipedia/iana.org；`sz` 精确控尺寸） | **HTTP 500 干净失败**（example.com 等） | CORS 开放 + Cloudflare CDN 缓存 + 30 并发无限流 |
| duckduckgo | 200+真实 ICO（github） | **200+自家占位图**（不可判定） | 老牌、较稳定 |

**为什么服务商列表 + 故障转移**：单一服务商可能整体不可达（区域/ISP 限制），也可能未来被限流/下线。列表让「favicon-run 首选（干净失败语义）」与「duckduckgo 兜底（老牌稳定）」互补：favicon-run 查不到（500）→ 故障转移到 duckduckgo 再试；favicon-run 整体不可达 → 跳过它直接走 duckduckgo。这正是「从一开始就考虑服务商未来不可用」的应对——单家失效只是跳到列表内下一家，全列表失效才落默认 SVG。

**服务商接口（一致行为）**：`interpret(outcome)` 把各家不同语义归一为三种结果，上层链只根据这三种结果行动：

| 返回 | 含义 | 上层动作 |
|---|---|---|
| `'icon'` | 该服务商认为此 host 有图标（2xx 且可解析图片） | 过共享校验（§3.1）→ 成功则**短路**返回；校验失败当 `'no-icon'` 继续 |
| `'no-icon'` | 服务**可达**，但此 host 查不到/无图标 | **故障转移到下一家服务商**（或全落空写 failed） |
| `'unreachable'` | 请求根本没到达服务（网络错误/超时） | **跳闸该服务商**（`down[<id>] = now + 6h`），**故障转移到下一家** |

各家 `interpret` 的实现差异（差异在接口内，上层无感知）：

- **favicon-run**：`!networkOk → 'unreachable'`；`2xx && image/* → 'icon'`；**非 2xx（500/404）→ 'no-icon'**（干净失败、可判定，不会假成功）。
- **duckduckgo**：`!networkOk → 'unreachable'`；`2xx → 'icon'`（**接受未知域名 200+自家占位**的不可判定，作为列表最后一层兜底）；非 2xx → `'no-icon'`。

**按服务商熔断（不重复尝试不可达服务）**：

- 每个服务商独立 `down[<id>]` 截止 ts，持久化在索引（§5.1），跨 popup 会话生效。
- 跳闸是**即时**的：一次网络级失败即可判定（服务要么可达要么被区域，一次超时足以说明；误判代价仅是冷却期内跳过该家，列表内还有下一家）。
- 冷却期内：遍历列表时**跳过**该服务商，一个请求都不发——这就是「不重复尝试」。
- **冷却期 6h 统一**（可调）；到期自动愈合，下一次补全放行一次直连探测，仍不可达则重新跳闸——周期性单发探测，不是每 host 重试。
- 熔断只针对服务商直连；L1/L2 的目标是每个书签自己的站点，可达性因站而异，天然按 host 的 failed 标记管理，不需要服务级熔断。

**遍历顺序与短路**：

```
[L4] for provider of AGG_PROVIDERS:
      if 直连 && now < down[provider.id] → continue               // 熔断中跳过
      outcome = provider.interpret(fetch(provider.url(host)))
      'icon'       → validateAndEncode → 成功? return : 当 no-icon 继续
      'no-icon'    → continue                                      // 故障转移
      'unreachable'→ down[provider.id] = now + COOLDOWN; continue  // 跳闸 + 故障转移
    → 全落空 → writeFailed(host)
```

**已知边界（如实记录）**：

- `sz` 取 **32**（对应树渲染 `_favicon` 的 32px 请求；16px 显示由浏览器下采样，HiDPI 清晰）。favicon-run 的 `sz` 非法/缺省回落默认尺寸（实测 `sz=999` → 等价 sz=16），不影响校验。
- 带端口或奇异主机名的 host（如 `example.com:8080`）按原样传参可能各家都查不到——落到 failed 24h 即可，无需特殊处理。
- DDG 占位污染（200+自家占位）仍在，但被限制在「favicon-run 也查不到（500）或整体不可达」的 host 上——严格优于早期实现中的「DDG 唯一聚合」；且该层默认关。
- favicon-run 是较新（2026-06 上线月更）的独立开发者服务，可靠性不如 DDG——正因如此才需要「列表 + 独立熔断 + 故障转移」；它失效即回退 duckduckgo 或默认 SVG，无损。

---

## 4. 渲染集成：`onPlaceholder` 钩子契约

### 4.1 `favicon-fallback.js` 的三处改动

```js
export function initFaviconFallback(doc = document, ctx = {}) {
    // … 现有不变 …
    const onPlaceholder = typeof ctx.onPlaceholder === 'function' ? ctx.onPlaceholder : null;
    // …
    const handle = img => {
        // …
        if (cached === true) {
            if (!onPlaceholder || !onPlaceholder(img))
                swapForDefaultIcon(img);
            return;
        }
        calibrate.then(() => {
            // …
            if (isPlaceholder) {
                if (!onPlaceholder || !onPlaceholder(img))
                    swapForDefaultIcon(img);
            } else { /* 现状不变 */ }
        });
    };
    // 返回 API 增加 sampleIcon（把闭包内的 fingerprint 暴露出去）：
    return { verdicts, handle, statsBySrc, applyContrast, reapplyContrast,
        sampleIcon: fingerprint,   // img → {w,h,hash,dark,light,colored,cover} | null
        themeObserver, schemeMedia, themeMedia };
};
```

1. 新增 `ctx.onPlaceholder(img) → boolean`：返回真 = 「占位图我处理了」，fallback 跳过默认 swap；返回假/无钩子 = 现状不变（换默认 SVG）。**两个占位分支都要调**（首次判定与 `cached === true` 重渲染路径）。
2. `sampleIcon` 暴露内部 `fingerprint`：一次 canvas 采样同时产出占位指纹与反色统计，补全模块拿它给注入图标做反色登记。
3. `reapplyContrast` 选择器从 `img[src*="/_favicon/"]` 扩为 `img[src*="/_favicon/"], img.favicon-enriched`——主题切换时注入图标同样重判反色。

### 4.2 钩子的三分支语义（favicon-enrich 实现）

从 `img.src` 还原书签 URL：`new URL(img.src).searchParams.get('pageUrl')`；非 http(s)（bookmarklet 等）直接返回 false。

- **缓存命中成功**：就地构建 `<img class="favicon-enriched" src=<dataURL> width=16 height=16 alt="">`，`img.parentNode.replaceChild(新img, img)`，登记 `load` 一次性监听做反色采样（§4.3），**return true**。新 img 的 load 事件再进 `handle()` 时 src 是 `data:`、不含 `/_favicon/`，被原样忽略——**无递归**。
- **缓存未命中**：`enqueue(host, pageUrl)`，把 `img.parentNode`（行内 `<a>` 锚点）记入该 host 队列项的 `anchors` 集合，**return false**（fallback 随即换默认 SVG，视图立即可读）。随后 `queueMicrotask` 里 `anchor.querySelector('svg.vbm-icon-doc')?.classList.add('favicon-enriching')`——补全中微视觉（§10）。
- **缓存命中 failed（24h 内）**：**return false**，不入队、不请求。

### 4.3 热替换与反色登记（补全完成时）

```js
// 校验+解码通过，dataUrl 已写缓存：
for (const anchor of item.anchors) {
    if (!anchor.isConnected)
        continue;                          // 行已重渲染——缓存已写，下次渲染命中
    const svg = anchor.querySelector('svg.vbm-icon-doc');
    if (!svg)
        continue;
    const el = doc.createElement('img');
    el.src = dataUrl; el.width = 16; el.height = 16; el.alt = '';
    el.className = 'favicon-enriched';
    el.addEventListener('load', () => {
        const fp = faviconService.sampleIcon(el);   // 一次 canvas 采样
        if (fp)
            faviconService.statsBySrc.set(dataUrl, fp);
        faviconService.applyContrast(el);            // 反色重判
    }, { once: true });
    anchor.replaceChild(el, svg);
}
```

- 同一 host 多个书签行共享一次补全，`anchors` 逐行替换。
- 失败路径：移除各 anchor 内 svg 的 `favicon-enriching` 类，保留默认 SVG（现状观感）。
- `sampleIcon` 对 data URL 图标采样不会污染 canvas——data: 永远不 taint；图标字节是我们自己 fetch 来的，无跨域问题。

### 4.4 与 `_favicon` 缓存的共生

某个 host 日后被 Chrome 自己缓存（用户访问过该站）→ `verdicts` 判 false → 走原生真实图标路径，补全缓存自然旁路。两套缓存不冲突：Chrome 的管「访问过」，补全的管「没访问过」。

---

## 5. 缓存与持久化（含爆炸边缘 case 与淘汰管理）

### 5.1 键布局：按 host 分键 + 一个索引（不用单键大 JSON）

```
chrome.storage.local:
  vbmFavicon:github.com   = "data:image/png;base64,…"   // 每个成功 host 一个键，值即 data URL 字符串
  vbmFavicon:example.org  = "data:image/x-icon;base64,…"
  vbmFaviconIdx           = JSON 字符串（唯一的结构键）:
{
  "v": 3,                          // 形状版本：v3 起按服务商独立熔断（down 表）（旧 v1 索引 hydrate 时重建，仅丢熔断窗口，图标数据键不丢）
  "down": {                        // 各第三方服务商直连熔断截止 ts（§3.4）：跳闸的服务商在冷却期内被跳过并切下一家
    "favicon-run": 0,
    "duckduckgo": 0
  },
  "hosts": {
    "github.com":   { "t": 1755200000000, "s": 2140 },   // 成功：t=最后命中 ts, s=data URL 长度
    "noicon.example": { "f": 1, "t": 1755200000000 }     // 失败标记：只进索引，无数据键
  }
}
```

**为什么不走 store 镜像、为什么不用单键大 JSON**：

- store 镜像面向 KNOWN_KEYS 静态枚举的**设置**；缓存是动态 host 键的**数据**——先例 `deadLastScan`（死链结果）同样由持有方直读直写 `chrome.storage.local`。
- 单键大 JSON 有**写放大**：500 个图标 ≈ 2MB 的 blob，每补全成功一个就整体重写一次；首屏风暴几百次完成 = 几百次 MB 级写。按 host 分键后，每次完成只写 ~3KB 的数据键 + ~20-40KB 的索引键，差两个数量级。
- 分键让淘汰能精确删除（`chrome.storage.local.remove('vbmFavicon:' + host)`），不用重写整个缓存。

**读写路径**：

- enricher 持一份**会话级内存 Map**（host → `{ d: dataUrl } | { f: ts }`），渲染钩子只同步读 Map。
- **hydrate**：enricher 初始化时（与 `store.ready` 并行，不等它）`chrome.storage.local.get(null)` 一次，按前缀过滤出数据键 + 解析索引，构建 Map，并做自愈对账（§5.3）。popup 打开时一次性读几 MB 是异步的、不在渲染关键路径上（calibrate 校准本身也要等一次 `_favicon` 往返）。
- **hydrate 竞态**：首批占位图可能在 hydrate 完成前到达钩子——按未命中入队即可；**发现链启动前会重读 Map**，此时 hydrate 已就绪，命中则直接热替换、不发请求。竞态的代价最多是「队列里多待一会」，绝不重复 fetch。
- **写**：每次完成 = `chrome.storage.local.set({ ['vbmFavicon:' + host]: dataUrl, vbmFaviconIdx: 新索引JSON })`（失败标记只动索引）。索引写走 1s 尾沿 debounce 合并突发（一场风暴几十次完成只落几次索引写），`pagehide` 前 flush。
- **跨页面一致性**：enricher 监听 `chrome.storage.onChanged`，`vbmFaviconIdx` 被**移除**（选项页清缓存，§5.4）→ 清空内存 Map + 重置熔断器。popup/panel 互斥，不考虑第二个 enricher 并发写的合并。

### 5.2 生命周期与刷新

| 项 | 策略 |
|---|---|
| 成功图标 | **TTL 30 天**（站点会换图标），到期按未命中重新补全 |
| failed 标记 | **24h 免重试**，到期允许重试（站点可能后来加了 favicon） |
| 服务商熔断（各家独立） | **6h** 自愈探测；冷却期内跳过并切下一家（§3.4） |
| 书签删除 | 不影响（按 host 缓存，多书签共享） |
| 手动刷新 | 选项页「清除图标缓存」按钮（§6.2） |

### 5.3 上限与淘汰管理（存储爆炸的边缘 case）

`chrome.storage.local` 总配额 10MB 与扩展其他数据共享，图标缓存给自己划**动态字节预算**：

```
预算上限 = min(剩余空间, max(512KB, 剩余空间 × 0.8))
剩余空间 = 总配额 −（getBytesInUse(null) − 本缓存已持久化字节）
```

- **剩余空间** = 剔除本缓存自身后其他功能实际占用的字节，因此上限随扩展整体的存储占用**自适应**：配额空闲时图标缓存可吃到 ~80% 的空间（不再被固定 2MB 卡死，充分利用未用配额），存储紧张时上限自动收紧到真实可用空间（绝不超出物理剩余）。
- 预算计算需要一次异步 `getBytesInUse` 往返，**60s 刷新节奏**；两次刷新之间用缓存值做同步淘汰判定，刷新后的补查兜住「新上限已低于当前缓存」的情况。
- 预算下限 512KB：正常配额下缓存至少保留一个可用的最小体积，避免「一个图标都放不下」的抖动。

**淘汰策略 = 超过上限 → 砍掉最旧一半（按 `t` 升序）**：

- 读命中即更新该 host 的 `t`（内存即时 + 索引 debounce 持久化，不为读放大额外写盘）。
- 淘汰只动成功条目，按 `t` 升序删最旧的一半数据键 + 索引条目——一刀减半，比逐条 LRU 省写、收敛更快；大图标多时自然先把旧的大的清掉。
- failed 标记不占额度：写索引时顺手**清除已过 24h 的 failed 条目**（它们反正已到期），索引体积自然收敛——几千书签的用户即便躺着几百个失败 host，索引也就几十 KB。

**边缘 case 逐条明确**：

1. **超大图标准入**：data URL 长度 > **96KB**（≈ 64KB 原始字节，覆盖一切正常 favicon；200KB 的 fetch 上限是「可展示」上限，不是「可入库」上限）→ **只进会话 Map 标 `persist: false`，不落盘**。本次会话照常热替换显示，下次会话重新补全。>64KB 的「favicon」通常是误配的大 PNG，不值得为它花配额。
2. **配额写拒绝**（其他数据挤占 10MB）：`storage.local.set` catch 到配额错误 → **紧急淘汰**：复用同一套「砍掉最旧一半」，重试一次写入；再失败 → 该条目降级为会话级（`persist: false`），静默不报错。
3. **索引损坏**（JSON 解析失败/形状不符，含手贱改 storage、`v` 版本不识别）：hydrate 时丢弃索引，**扫描现存 `vbmFavicon:` 前缀数据键重建索引**（`s` 取实际长度，`t` 取当前 ts）——数据键还在就不丢图标，只丢命中序。
4. **索引与数据键漂移**（外部删了数据键、索引还在；或反过来）：hydrate 对账——索引有而数据键无 → 删索引条目；数据键有而索引无 → 补录条目。读到已漂移条目同理即读即修。
5. **成千上万书签的首个会话**：假设 3000 书签 ≈ 800 个不同 host 占位图。工作量按视口惰性触发（§8）；每个 host 的成败都会沉淀，**后续每次打开 popup 的新增工作量单调递减**（成功进缓存、失败有 24h 标记）。队列对象轻量（host 字符串 + 引用集合），几千项也只是几百 KB 内存，页面关闭即释放。
6. **索引键本身**：500 成功 + 数百 failed ≈ 30-50KB，远小于任何数据键，不是瓶颈；`v` 字段保证未来形状变更可识别迁移。

### 5.4 设置备份排除与手动清除

- **备份排除**：选项页导出打包整个 local 区（options.js:237-256），在导出装配处按前缀剔除：`Object.keys(localData).forEach(k => { if (k === 'vbmFaviconIdx' || k.startsWith('vbmFavicon:')) delete localData[k]; })`——否则每个设置备份膨胀数 MB。导入是 merge 语义，旧备份里没有这些键，自然无兼容问题。
- **手动清除**（选项页按钮）：`chrome.storage.local.get(null)` → 收集 `vbmFaviconIdx` + 全部 `vbmFavicon:` 前缀键 → `chrome.storage.local.remove(键列表)` → `alert(_m('optionFaviconCacheCleared'))`。打开中的 popup/panel 靠 §5.1 的 onChanged（索引被移除）即刻清空内存 Map，下次渲染重新补全。

---

## 6. 开关与选项页

### 6.1 两个键（local 区，'1'/'' 模型，与 faviconContrast 完全一致）

| 键 | 默认 | 含义 |
|---|---|---|
| `faviconEnrich` | **开** | 主开关：占位图触发 L1/L2（+L3 代理接力 + L4 第三方聚合兜底）补全 |
| `faviconEnrichAgg` | **关** | 子开关：追加 L4 第三方聚合兜底——内置服务商列表（favicon-run → duckduckgo）逐家尝试 + 按服务商熔断 + 故障转移（§3.4）。键名直取「聚合兜底」语义（favicon 补全随 4.0.8 首发，无历史包袱） |

- 入 `store.js` 的 `KNOWN_KEYS`（**不进 SYNC_KEYS**——与 faviconContrast 同区同模型；是否联网取图标是设备级网络偏好，不跨设备同步）。缓存的动态 host 键与索引键**不入** KNOWN_KEYS（它们不是设置，且由 enricher 自管）。
- **主开关默认开的理由**：请求只发往用户自己收藏的网站（等同于访问），无第三方，用户已明确反馈「很多默认图标」——开箱即受益。
- **聚合兜底默认关的理由**：与项目退役第三方 relay 模板、改用用户自有代理的隐私姿态一致（dead-proxy.js 头注释）；服务商列表会把域名发给 favicon.run / DuckDuckGo 等第三方，必须显式 opt-in。

### 6.2 选项页 UI（Icons 组，`favicon-contrast` 行之后）

```html
<li><label><input type="checkbox" id="favicon-enrich" aria-labelledby="option-favicon-enrich"><span id="option-favicon-enrich"></span></label><br><small id="option-favicon-enrich-hint"></small></li>
<li><label><input type="checkbox" id="favicon-enrich-ddg" aria-labelledby="option-favicon-enrich-ddg"><span id="option-favicon-enrich-ddg"></span></label><br><small id="option-favicon-enrich-ddg-hint"></small></li>
<li><button id="favicon-cache-clear" type="button"></button></li>
```

- `options.js`：`viewSettings` 数组加两项（`{ id: 'favicon-enrich', key: 'faviconEnrich', defaultValue: '1' }` / `{ id: 'favicon-enrich-ddg', key: 'faviconEnrichAgg', defaultValue: '' }`），`bindSettingsList` 自动完成绑定；初始化区补 5 个 label/hint/button 的 `_m()` 赋值（`optionFaviconCacheCleared` 在清除按钮 handler 内引用，不做初始化赋值）。
- 联动：主开关关 → 聚合兜底子复选框 `disabled`（视觉降级，防「子开母关」的歧义态）。
- 清除按钮 handler：按 §5.4 的前缀收集 + remove 实现，完成后 alert 提示。选项页没有 enricher 实例，无需其他动作。

### 6.3 i18n（6 个新 key，走 `scripts/i18n.py` 流程）

| key | en | zh_CN |
|---|---|---|
| `optionFaviconEnrich` | Fetch missing site icons | 补全缺失的网站图标 |
| `optionFaviconEnrichHint` | For bookmarked sites Chrome has no cached icon for, fetch the real icon directly from the site (/favicon.ico, then the page's declared icons). Requests only go to sites you bookmarked. | 对 Chrome 尚未缓存图标的收藏网站，直接从站点获取真实图标（/favicon.ico → 页面图标声明）。请求只发往你已收藏的网站。 |
| `optionFaviconEnrichAgg` | Third-party icon fallback | 用第三方图标服务兜底 |
| `optionFaviconEnrichAggHint` | When direct fetching fails, look the icon up by domain from a built-in list of third-party icon services (favicon.run, then DuckDuckGo). A service found unreachable is skipped and the next one is tried — it is not retried for 6 hours. | 直连获取失败时，从内置第三方图标服务按域名取图（favicon.run → DuckDuckGo 自动切换）。检测到某服务不可达时切换下一家，6 小时内不再重复尝试该服务。 |
| `optionFaviconCacheClear` | Clear icon cache | 清除图标缓存 |
| `optionFaviconCacheCleared` | Icon cache cleared. Icons will be re-fetched on next open. | 图标缓存已清除，将在下次打开时重新补全。 |

流程：en + zh_CN 写实译 → 其余 41 个 locale 原位插 `[TODO:key]`（不打乱键序）→ `python3 scripts/i18n.py translate --apply` → `python3 scripts/i18n.py verify` 0 错误才可提交。

---

## 7. 启停与生命周期

- **即时生效**（复用 neat.js 现有 onChanged 模式，同一 listener 加两键分支）：
  - 关：`enricher.setEnabled(false)` → 清空队列、AbortController 取消全部在途 fetch、移除残余 `.favicon-enriching` 类。**已注入的真实图标不撤，已写缓存不清，服务商熔断状态保留**——只是停止新的补全。
  - 开：`setEnabled(true)`；下次渲染到占位图即正常触发（已在屏的默认 SVG 不追补，等自然重渲染/下次打开——避免主动全树扫描）。
  - 聚合兜底子开关翻转只改变发现链的 L4 服务商列表分支（及其经 L3 代理的补试）是否启用，不动主链路。
- **生命周期 = 页面会话**：popup 关闭队列随页面销毁；缓存与熔断已持久化，下次打开命中即不重试。无 background 常驻任务。
- **优雅降级**：`chrome.storage.session` 不可用、`fetch` 失败、canvas 不可用等任何环节缺失，enricher 静默落回「换默认 SVG」的现状——**永远不劣于现状**（与 favicon-fallback 的 inert 哲学一致）。失败路径一律不写 `console.error`，保证 harness smoke 的「零 console 错误」门禁不破。

---

## 8. 性能与防卡顿

1. **渲染零阻塞**：钩子是同步函数，只读内存 Map；全部网络在队列里异步进行。
2. **并发限流 6**：防打爆站点/触发对端 rate limit；按 **host 去重**，同 host 多书签共享一次链路。
3. **视口优先**：`<img loading="lazy">`（tree-render.js:161）决定屏外图标的 load 事件不触发——首屏只补全可见区域，滚动到哪补到哪。这同时把「几千书签首个会话」的总工作量摊薄到用户实际浏览的范围内（§5.3 第 5 条）。
4. **免重试三道闸**：failed 标记 24h（站点级）、成功 30d TTL（新鲜度）、服务商熔断 6h（服务级，各家独立，跳闸即切下一家）——任何层面都不做无谓的重复请求。
5. **写盘预算**：每次完成 ~3KB 数据键 + debounce 合并的索引写；不存在单键大 JSON 的 MB 级写放大（§5.1）。
6. **首屏观感**：N 个可见占位图 → 入队去重 → 6 并发 × 每层 3-5s 超时 → 分批完成；视图全程不卡，图标陆续从默认变真实。

---

## 9. 失效与手动刷新

| 层 | 机制 |
|---|---|
| Chrome `_favicon` | 每次渲染重跑 calibrate+判定；Chrome 缓存建立后自动走真实图标（§4.4） |
| 补全缓存 | 30d TTL 到期重新补全 + LRU/字节预算淘汰（§5.3） |
| failed 标记 | 24h 后允许重试；写索引时顺手清过期条目 |
| 服务商熔断 | 6h 后放行一次直连探测；冷却期内跳过并切换下一家（§3.4） |
| 手动 | 选项页「清除图标缓存」按钮（§5.4/§6.2） |

**不做 palette 命令**：palette 命令表是刻意收敛的 curated 集合，且 `PALETTE_RESERVED` 被 `palette.test.js` 钉死同步；为低频的缓存清理增加保留词不划算，选项页按钮已覆盖需求。

---

## 10. 结果呈现

- **就地更新（主体）**：图标陆续从默认 SVG 变真实，零额外 UI——这就是功能本体。
- **补全中微视觉**：队列在途时默认 SVG 带 `.favicon-enriching`（`opacity: .45; transition: opacity .3s`，加进 `css/neat.css`，与 `.favicon-contrast-invert` 同文件），完成即被替换、失败即移除。用户感知「正在补全」而非「卡顿」。
- **不做结果列表**：补全是后台静默增强，不是用户发起的扫描；其价值在「图标变全了」本身，做成报告视图违背轻量定位。

---

## 11. 文件改动清单

| 文件 | 改动 |
|---|---|
| `src/favicon-enrich.js`（新，~400 行） | 导出 `initFaviconEnrich(ctx)` → `{ onPlaceholder, setEnabled }`。ctx：`{ doc, faviconService, isEnabled(), fallbackEnabled() }`（getter 决策时读取，同 faviconContrast 模式；`fallbackEnabled` 读聚合兜底开关，storage 键 `faviconEnrichAgg`）。内含：发现链 L1-L4、服务商列表与按服务商熔断（§3.4）、`fetchWithTimeout`（自控 AbortController + 外链 signal，仿 dead-links.js:49-70）、图标校验+base64 编码（§3.1）、`<link>` 正则提取（§3.2）、缓存层（§5：按 host 分键 + `vbmFaviconIdx` 索引 + LRU/字节预算 + 自愈对账 + onChanged 监听）、队列+6 并发限流、热替换（§4.3） |
| `src/favicon-fallback.js` | §4.1 三处：`ctx.onPlaceholder` 两个分支调用；返回 API 加 `sampleIcon: fingerprint`；`reapplyContrast` 选择器加 `, img.favicon-enriched` |
| `src/neat.js` | `import { initFaviconEnrich } from './favicon-enrich.js'`；在 faviconService 创建后立即实例化 enricher。实例化顺序有环：fallback 必须先于行渲染安装并拿到钩子，enricher 又依赖 faviconService 的 sampleIcon/statsBySrc——解法是 `ctx.onPlaceholder` 传惰性包装 `img => enricher && enricher.onPlaceholder(img)`（`let enricher = null`，建完赋值；钩子的首次调用发生在行渲染时，必然已就绪），同 neat.js 的 lazy getter 惯例；现有 storage.onChanged listener 加 `faviconEnrich`/`faviconEnrichAgg` 分支 → `enricher.setEnabled(...)` |
| `src/options.js` | viewSettings +2 项；5 个 label 赋值；聚合兜底复选框 disabled 联动；`favicon-cache-clear` handler（前缀收集 + remove）；备份导出按前缀剔除 `vbmFaviconIdx`/`vbmFavicon:*` |
| `pages/options.html` | Icons 组 favicon-contrast 行后 +3 个 `<li>`（§6.2） |
| `src/store.js` | `KNOWN_KEYS` + `'faviconEnrich'`、`'faviconEnrichAgg'`（紧跟 `'faviconContrast'` 注释行；缓存键不入列） |
| `css/neat.css` | `.favicon-enriching` 规则（2 行） |
| `_locales/{en,zh_CN,…}/messages.json` | 6 个新 key（§6.3 流程） |
| `tests/favicon-enrich.test.js`（新） | §12 |
| `tests/favicon-fallback.test.js` | 扩：钩子契约 + sampleIcon + enriched 选择器 |
| `AGENTS.md` | `src/favicon-enrich.js` 新行；`src/favicon-fallback.js` 行补 onPlaceholder/sampleIcon；store.js 行补两键；options 行补 Icons 组新开关与备份排除；测试段落补新套件 |

---

## 12. 测试计划

### `tests/favicon-enrich.test.js`（新，ESM 直导 + globalThis 注入，仿 favicon-fallback.test.js）

- **发现链**：L1 命中短路（L2 不发请求）；L1 404 → L2 解析 `<link>` 命中；L2 无声明 → L3 代理接力（session 标记 + deadProxyServer 双条件满足时带 `__vbm_px=1` 重试 L1/L2）；L3 失败/代理不在线 → L4（fallbackEnabled=true 才发，服务商列表）；全失败 → failed 标记。
- **服务商故障转移（核心）**：favicon-run 网络错误/超时 → **跳闸 favicon-run** → **自动切 duckduckgo** 再试，成功则用它；favicon-run 返回 500（可达但 host 无图标）→ **不熔断**，**故障转移**到 duckduckgo；duckduckgo 200 → 接受为图标（占位不可判定，最后一层兜底）；favicon-run 200+PNG → 短路，duckduckgo 不发请求。
- **按服务商熔断（不重复尝试）**：某服务商跳闸后，后续 host 的遍历**跳过**它（断言 fetch 不再发往该服务商）；`down[<id>]` 持久化到索引、重 hydrate 后仍生效；到期后放行一次探测、仍失败则重新跳闸；**跳闸 + 代理在线 → 该服务商经 L3 的 `addProxyMarker` 补试一次**；跳闸 + 无代理 → 直接切下一家/落 failed。各家熔断互相独立（favicon-run 跳闸不影响 duckduckgo）。
- **favicon-run 语义**：返回 200+`image/png`（`sz=32`）→ 校验通过按成功缓存；返回 500/404 → 不落熔断、故障转移（干净失败，不产生假成功缓存）；返回非图片（异常 200+HTML）→ 校验拒绝。
- **校验**：200+`text/html` 拒绝；>200KB 拒绝；魔数不符拒绝；Image 解码 `naturalWidth=0` 拒绝；`data:` href 的 `<link>` 直接采用。
- **缓存**：按 host 分键写读往返；成功 30d TTL 到期重补；failed 24h 内不重复请求、到期重试；hydrate 竞态（未 hydrate 完入队 → 链启动重读命中 → 不发 fetch）。
- **淘汰管理**：动态字节预算（配额 − 其他功能占用）×0.8、下限 512KB、60s 刷新，超限按 `t` 升序砍掉最旧一半（数据键同步删除）；>96KB 图标只进会话 Map 不落盘；配额写拒绝 → 紧急淘汰（复用砍半）→ 重试 → 再败降级会话级；索引损坏 → 扫描数据键重建；索引/数据键漂移对账；写索引时清除过期 failed 条目。
- **队列**：同 host 并发渲染只入队一次（anchors 合并）；并发在途 ≤ 6；`setEnabled(false)` 清空队列 + abort 在途。
- **热替换**：anchor 在 DOM → svg 换 img；anchor 脱离 → 跳过不抛。
- 测试桩：`fetch` 脚本化响应、`Image` 伪类（仿 favicon-fallback.test.js:33-47）、`chrome.storage.session/local` 用 `tests/helpers/chrome.js` 的 `makeStorageArea`。**禁止复制实现进测试**（AGENTS.md 红线）。

### `tests/favicon-fallback.test.js`（扩）

- `onPlaceholder` 返回 true → 不换默认 SVG；返回 false/未提供 → 现状换 SVG（两条占位分支各覆盖一次）。
- 返回 API 含 `sampleIcon`，对伪 img 返回指纹对象。
- `reapplyContrast` 覆盖 `img.favicon-enriched`。

### 门禁

- `npm run test:run` 全绿。
- `scripts/harness/run.sh --smoke-only`：popup/panel/options 加载零 console 错误（DinD 无外网，补全 fetch 全部快速失败——正是「静默降级不刷屏」与「聚合兜底即时跳闸」的现成验证场）。
- `python3 scripts/i18n.py verify` 0 错误。
- 手动：真实 Chromium 加载，种子书签混含知名站 + 冷门站，观察图标陆续补全；选项页开关即时生效、清除缓存后下次打开重补；配代理 + 死链扫描会话期间验证 L3 代理接力（直连失败的站点图标经代理补齐）。

---

## 13. 落地步骤（每步独立提交，遵循「按任务粒度就地提交」）

1. **S1** `src/favicon-enrich.js`（发现链 L1-L4 + 熔断 + 缓存层 + 队列限流）+ `tests/favicon-enrich.test.js` 全绿 → commit（`feat: favicon enrich module — discovery chain, breaker, cache, queue`）。
2. **S2** `favicon-fallback.js` 钩子 + `sampleIcon` + 选择器扩展 + 测试扩展 → commit。
3. **S3** neat.js 接线 + options（UI/联动/清除按钮/备份排除）+ store KNOWN_KEYS + neat.css + i18n（translate+verify 过闸）→ commit。
4. **S4** L3 代理接力（含熔断服务商的代理补试）+ 对应测试 → commit。
5. **S5** harness smoke + AGENTS.md 同步 + 手动验证 → commit。

---

## 14. 风险与边界

| 风险 | 缓解 |
|---|---|
| 大书签库首屏并发 | 6 限流 + host 去重 + lazy 视口优先 + failed 24h |
| 某服务商整体直连不可达（区域/ISP 限制） | 按服务商熔断：一次网络失败跳闸该家 6h，期间跳过它并**自动故障转移下一家**；代理在线则经 L3 代理补试（§3.4/§3.3） |
| 某服务商未来被限流/下线/不可用 | 内置列表 + 独立熔断 = 单家失效不阻塞整体；duckduckgo 兜底仍在；全列表失效回退默认 SVG（§3.4） |
| 站点 403/反爬 | L2 页面解析 + L3 代理接力 + L4（opt-in，服务商列表聚合兜底） |
| 聚合兜底假成功 | favicon-run 对未知/无图标域名返回 HTTP 500 干净拒绝；DDG 200+自家占位作为最后一层兜底接受（§3.4）；四段校验 + Image 解码终验兜底（§3.1） |
| 熔断误判（偶发网络抖动） | 代价仅是 6h 内跳过可选兜底；到期自动探测愈合 |
| 存储爆炸（成千上万书签） | 动态字节预算（配额−其他占用）×0.8、60s 刷新 + 超限砍最旧一半 + 超大图标会话级 + 配额错误紧急淘汰 + 失败标记自动清（§5.3） |
| 缓存写放大 | 按 host 分键，每次完成 ~3KB 写；索引 debounce 合并（§5.1） |
| 索引损坏/漂移 | hydrate 对账重建，数据键优先，不丢图标（§5.3 第 3/4 条） |
| 设置备份膨胀 | 导出按前缀显式排除缓存键（§5.4） |
| 服务器返回 200+非图片 | 四段校验 + Image 解码终验（§3.1），坏数据不进缓存 |
| PAC 窗口竞态 | 重试失败落 failed，24h 后自愈（§3.4） |
| ICO 多尺寸 | `<img>` 加载 ICO 时 Chrome 自动选帧，无需处理 |
| 隐私观感 | 主链路仅发往用户已收藏站点；第三方兜底独立子开关默认关 + hint 明说熔断行为 |

---

## 15. 决策定稿

| 决策 | 定稿 |
|---|---|
| 主开关 `faviconEnrich` | **默认开**，local 区 '1'/'' 模型，入 KNOWN_KEYS |
| 聚合兜底源 | **内置服务商列表**：`favicon-run`（`GET /favicon?domain=<host>&sz=32`）首选 → `duckduckgo`（`GET icons.duckduckgo.com/ip3/<host>.ico`）兜底（v4，§3.4）；各家判定差异封装为**一致接口** `url(host)` + `interpret(outcome)` |
| 服务商失败语义 | favicon-run：非 2xx → 干净 `'no-icon'`（消灭假成功）；DDG：2xx 一律 `'icon'`（接受未知域名 200+自家占位，作为最后一层） |
| 聚合兜底开关 | **独立子开关 `faviconEnrichAgg`，默认关**（键名直取「聚合兜底」语义；隐私姿态与项目一致） |
| 服务商不可达 | **按服务商独立熔断**：网络级失败即时跳闸该家 6h（持久化于索引 `down[<id>]`），冷却期内遍历时**跳过它并自动故障转移下一家**，跨会话生效，到期单发探测自愈；**不按 host 重复尝试** |
| 服务商代理兜底 | **做**：某家直连熔断中（含本次直连刚失败）且死链代理会话在线 → 该家经 L3 的 `addProxyMarker` 补试一次 |
| 执行位置 | **前端**（popup/panel 页面）——热替换需要行内 DOM 锚点，SW 拿不到 |
| 注入格式 | **data URL**（可持久化；CSP `img-src data:` 原生覆盖；不经 blob URL） |
| 缓存键布局 | **按 host 分键 `vbmFavicon:<host>` + 索引键 `vbmFaviconIdx`**（含 `v`/`down`/`hosts`；索引 v 升 3，旧 v1 重建仅丢熔断窗口）；不走 store 镜像、不用单键大 JSON（写放大 + 动态键） |
| 缓存上限与淘汰 | 成功条目**动态字节预算**（配额−其他占用）×0.8、下限 512KB、上限=真实剩余空间、60s 刷新，超限按 `t`（最后命中）升序**砍掉最旧一半**；failed 仅索引、24h 过期即清；>96KB 图标会话级不落盘；配额拒绝 → 复用砍半重试 → 降级会话级 |
| 缓存 TTL | 成功 30d；failed 24h；服务商熔断 6h（各家独立） |
| 并发 | **6**，按 host 去重 |
| 刷新入口 | 选项页清除按钮（前缀 remove）；**不做 palette 命令**（curated 表 + 保留词测试钉死） |
| 代理接力 | **做**（L3，在第三方聚合之前）：门槛 = `storage.session.vbmProxySession` + `deadProxyServer`，复用 marker-PAC 零新消息 |
| 死链扫描顺带解析 `<link>` | **本期不做**：checkUrl 是 HEAD 优先不读 body，改 GET+读 body 增加扫描带宽与复杂度，且 L2 已覆盖同一目标（非标准路径发现）。若未来要做（复用 blocked 站点的扫描响应），另行独立设计 |
| 结果呈现 | 就地更新 + `.favicon-enriching` 微视觉；不做结果列表 |
| 补全中视觉 | 做（2 行 CSS + 类翻转） |

---

*定稿。实施从 §13-S1 开始；任何偏离本设计的实现取舍需先回本节改决策表。*
