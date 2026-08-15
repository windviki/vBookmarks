# favicon 补全 · 原生功能设计（实施定稿）

> 2026-08-15 · 实施版，所有决策已定稿（§15），无开放项。
> 前置：[`docs/favicon-补全方案.md`](favicon-补全方案.md)（根因 + 真实 Chromium 实测 + 同类扩展调研）。
> 本文是「补全缺失的网站图标」作为 vBookmarks **原生功能**的唯一实施依据：模块边界、代码契约、存储形状、选项 UI、测试与提交步骤均精确到文件与函数。

---

## 0. 用户需求与功能定位

**用户问题**：书签库里大量网站显示默认图标。实测已证实根因——Chrome `_favicon` API 只读 Chrome 自己的 favicon 缓存，对缓存未建立的站点一律返回占位图；用户书签多来自导入/历史，Chrome 从未为它们抓过图标。**不是站点问题，不是被墙，不是 404。**

**功能定义**：渲染时识别出占位图 → 异步向**用户自己收藏的网站**拉取真实 favicon → 就地替换行内图标 → 按 host 持久缓存。用户感知 = 「打开书签库，图标比之前全了」。

**原生性约束**（与 vBookmarks 现有架构对齐，不引入异质模式）：

- **零新权限、零 manifest 改动**：`connect-src *` + `host_permissions <all_urls>` 已覆盖 fetch；`img-src 'self' data:` 已覆盖 data URL 注入。
- **零默认第三方依赖**：主链路只向用户已收藏的站点发请求（等同于访问该站）；DuckDuckGo 兜底做成独立子开关、默认关（§6）。
- **复用现有基建**：`favicon-fallback` 的占位图识别与反色采样、`store.js` 的镜像与 debounce 持久化、`dead-proxy.js` 的 marker-PAC 代理通道、options 页 Views 组的开关模式、`tests/helpers/` 测试桩。
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

- `store.js` 镜像在 `store.ready` 时 **全量 overlay `chrome.storage.local`**（store.js:230-234），任意 local 键都能 `store.get` 同步读；`store.set` 200ms 尾沿 debounce 持久化，`pagehide` 强制 flush。缓存读写零新增基建。
- 设置备份导出**整个 local 区**（options.js:239 `chrome.storage.local.get(null)`），无排除名单——图标缓存（MB 级 base64）必须显式排除（§5.3）。
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
      L3  fetch https://icons.duckduckgo.com/ip3/<host>.ico  (3s，faviconEnrichDdg 子开关)
      L4  代理接力：死链扫描代理会话在线 → addProxyMarker 重试 L1/L2  (3s/5s)
  → 成功：校验 → 解码验证 → data URL 写缓存 → 热替换 anchors 内的默认 SVG → 采样反色
  → 全失败：写 failed 标记（24h 免重试）
```

**模块边界**：

| 模块 | 职责 |
|---|---|
| `src/favicon-enrich.js`（新，ES 模块） | 发现链 L1-L4、图标校验与解码、data URL 编码、缓存读写（LRU/TTL/failed 标记）、队列与限流、AbortController 取消、热替换与反色登记。页面依赖（`fetch`/`Image`/`chrome.storage`）全部可注入，node 下可单测 |
| `src/favicon-fallback.js`（改，3 处小改） | 新增 `ctx.onPlaceholder` 钩子；返回 API 增加 `sampleIcon`；`reapplyContrast` 选择器扩展（§4.1） |
| `src/neat.js`（薄接线） | 实例化 enricher，接进 faviconService；扩展现有 `storage.onChanged` 监听（faviconEnrich / faviconEnrichDdg 两键） |
| `src/options.js` + `pages/options.html`（改） | Views 组加两个开关 + 一个清除缓存按钮；备份导出排除缓存键 |
| `src/store.js`（改 1 行） | `KNOWN_KEYS` 注册 `faviconEnrich`、`faviconEnrichDdg` |

钩子挂在 `favicon-fallback` 的 capture-phase 委托上，意味着**树、搜索结果、palette 行、recent 视图——所有走 `_favicon` 的 `<img>` 自动获得补全**，无需逐视图接入。

---

## 3. 发现链详表

| 层 | 请求 | 超时 | 覆盖场景 | 开关 |
|---|---|---|---|---|
| L1 | `GET https://<host>/favicon.ico` | 3s | 经典路径，实测 github/MDN/cloudflare 可用 | faviconEnrich |
| L2 | `GET <pageUrl>`（书签本身的 URL）→ 提取 `<link>` → `GET <iconUrl>` | 5s + 3s | 非标准路径（`/icon.svg`、CDN、apple-touch-icon） | faviconEnrich |
| L3 | `GET https://icons.duckduckgo.com/ip3/<host>.ico` | 3s | 站点 403/反爬（实测 stackoverflow `/favicon.ico` 403） | faviconEnrich + faviconEnrichDdg |
| L4 | `addProxyMarker` 重试 L1、L2 | 3s + 5s | 直连不可达但用户代理可达（区域/ISP 限制） | faviconEnrich + 死链代理会话在线 |

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

### 3.3 L3 的已知瑕疵（如实记录）

DuckDuckGo 对未知域名返回它自己的默认图标（HTTP 200），无法可靠区分「真图标」与「DDG 占位」。接受策略：按成功缓存（30d TTL）。代价是「DDG 也查不到的站点会缓存一个 DDG 占位图」——观感不劣于默认 SVG，且该层默认关闭，可接受。

### 3.4 L4 代理接力的门槛判定

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
- 只对 L1/L2 重试（L3 的 DDG 是公网服务，直连必然可达，走代理无意义）。
- PAC 窗口竞态（重试在途时扫描结束拆 PAC）→ fetch 失败 → 落入 failed 标记。因为直连 L1/L2 已经失败过，这个 failed 不冤，24h 后正常重试，无需特殊处理。
- 代理流量与扫描共享 PAC 但互不协调：补全自己的 6 并发限流天然封顶，不会给扫描施压。

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

## 5. 缓存与持久化

### 5.1 形状

```js
// chrome.storage.local 键 vbmFaviconCache，JSON 字符串（同 deadLastScan 先例）
{
  "github.com":      { "d": "data:image/png;base64,…", "ts": 1755200000000 },
  "noicon.example":  { "f": 1, "ts": 1755200000000 }   // failed 标记，极小
}
```

- **data URL 而非 blob URL**：blob 会话级（页面关闭即失效）且 `img-src 'self' data:` 不含 blob scheme；data URL 可持久化、跨渲染注入稳定，CSP 原生覆盖。32px 图标约 1-4KB，base64 后 1.4-5.6KB。
- 读写走 store 镜像：`store.get('vbmFaviconCache', '{}')` 同步读、`store.set` 200ms debounce 写、`pagehide` 强制 flush——高频逐 host 完成不 hammer storage。
- enricher 内部持一份会话级 `Map`（hydrate 自 store.ready 后的镜像），渲染路径只读 Map；写缓存 = 改 Map + `store.set(key, JSON.stringify(map对象))`。
- 监听 `chrome.storage.onChanged` 的 `vbmFaviconCache`：选项页清缓存或另一页面写入时重新 hydrate——常驻 side panel 也能即刻感知。

### 5.2 生命周期

| 项 | 策略 |
|---|---|
| 成功图标 | **TTL 30 天**（站点会换图标），到期按未命中重新补全 |
| failed 标记 | **24h 免重试**，到期允许重试（站点可能后来加了 favicon） |
| 容量 | **LRU 500 个成功项**（failed 不占额度），超出淘汰最久未命中者 |
| 书签删除 | 不影响（按 host 缓存，多书签共享） |

配额估算：500 × 平均 ~3KB ≈ 1.5-2.8MB，低于 `chrome.storage.local` 5MB 默认配额。`store.set` 持久化失败的兜底：catch 到配额错误时立即把 LRU 额度砍半重写一次；再失败则放弃本次写入（内存 Map 仍在，本会话不失效）。

### 5.3 设置备份排除

选项页导出打包**整个 local 区**（options.js:237-256）。在导出装配处加一行 `delete localData.vbmFaviconCache`——缓存不进备份文件（否则每个设置备份膨胀数 MB）。导入是 merge 语义（backup 里没有的键不动），自然无兼容问题。

---

## 6. 开关与选项页

### 6.1 两个键（local 区，'1'/'' 模型，与 faviconContrast 完全一致）

| 键 | 默认 | 含义 |
|---|---|---|
| `faviconEnrich` | **开** | 主开关：占位图触发 L1/L2（+L4 代理接力）补全 |
| `faviconEnrichDdg` | **关** | 子开关：追加 L3 DuckDuckGo 兜底 |

- 入 `store.js` 的 `KNOWN_KEYS`（**不进 SYNC_KEYS**——与 faviconContrast 同区同模型；是否联网取图标是设备级网络偏好，不跨设备同步）。
- **主开关默认开的理由**：请求只发往用户自己收藏的网站（等同于访问），无第三方，用户已明确反馈「很多默认图标」——开箱即受益。
- **DDG 默认关的理由**：与项目退役第三方 relay 模板、改用用户自有代理的隐私姿态一致（dead-proxy.js 头注释）；DDG 会按域名向第三方发请求，必须显式 opt-in。

### 6.2 选项页 UI（Views 组，`favicon-contrast` 行之后）

```html
<li><label><input type="checkbox" id="favicon-enrich" aria-labelledby="option-favicon-enrich"><span id="option-favicon-enrich"></span></label><br><small id="option-favicon-enrich-hint"></small></li>
<li><label><input type="checkbox" id="favicon-enrich-ddg" aria-labelledby="option-favicon-enrich-ddg"><span id="option-favicon-enrich-ddg"></span></label><br><small id="option-favicon-enrich-ddg-hint"></small></li>
<li><button id="favicon-cache-clear" type="button"></button></li>
```

- `options.js`：`viewSettings` 数组加两项（`{ id: 'favicon-enrich', key: 'faviconEnrich', defaultValue: '1' }` / `{ id: 'favicon-enrich-ddg', key: 'faviconEnrichDdg', defaultValue: '' }`），`bindSettingsList` 自动完成绑定；初始化区补 5 个 label/hint/button 的 `_m()` 赋值（`optionFaviconCacheCleared` 在清除按钮 handler 内引用，不做初始化赋值）。
- 联动：主开关关 → DDG 子复选框 `disabled`（视觉降级，防「子开母关」的歧义态）。
- 清除按钮 handler：`chrome.storage.local.remove('vbmFaviconCache')` 后 `alert(_m('optionFaviconCacheCleared'))`（沿用导入完成同款 alert 惯例）。选项页没有 enricher 实例，无需其他动作；popup/panel 靠 onChanged 重新 hydrate。

### 6.3 i18n（6 个新 key，走 `scripts/i18n.py` 流程）

| key | en | zh_CN |
|---|---|---|
| `optionFaviconEnrich` | Fetch missing site icons | 补全缺失的网站图标 |
| `optionFaviconEnrichHint` | For bookmarked sites Chrome has no cached icon for, fetch the real icon directly from the site (/favicon.ico, then the page's declared icons). Requests only go to sites you bookmarked. | 对 Chrome 尚未缓存图标的收藏网站，直接从站点获取真实图标（/favicon.ico → 页面图标声明）。请求只发往你已收藏的网站。 |
| `optionFaviconEnrichDdg` | DuckDuckGo icon fallback | 用 DuckDuckGo 图标服务兜底 |
| `optionFaviconEnrichDdgHint` | When direct fetching fails, look the icon up by domain from DuckDuckGo's icon service (discloses the domain to a third party). | 直连获取失败时，改为从 DuckDuckGo 图标服务按域名取图（会向第三方透露网站域名）。 |
| `optionFaviconCacheClear` | Clear icon cache | 清除图标缓存 |
| `optionFaviconCacheCleared` | Icon cache cleared. Icons will be re-fetched on next open. | 图标缓存已清除，将在下次打开时重新补全。 |

流程：en + zh_CN 写实译 → 其余 41 个 locale 原位插 `[TODO:key]`（不打乱键序）→ `python3 scripts/i18n.py translate --apply` → `python3 scripts/i18n.py verify` 0 错误才可提交。

---

## 7. 启停与生命周期

- **即时生效**（复用 neat.js 现有 onChanged 模式，同一 listener 加两键分支）：
  - 关：`enricher.setEnabled(false)` → 清空队列、AbortController 取消全部在途 fetch、移除残余 `.favicon-enriching` 类。**已注入的真实图标不撤，已写缓存不清**——只是停止新的补全。
  - 开：`setEnabled(true)`；下次渲染到占位图即正常触发（已在屏的默认 SVG 不追补，等自然重渲染/下次打开——避免主动全树扫描）。
- **生命周期 = 页面会话**：popup 关闭队列随页面销毁；缓存已持久化，下次打开命中即不重试。无 background 常驻任务。
- **优雅降级**：`chrome.storage.session` 不可用、`fetch` 失败、canvas 不可用等任何环节缺失，enricher 静默落回「换默认 SVG」的现状——**永远不劣于现状**（与 favicon-fallback 的 inert 哲学一致）。失败路径一律不写 `console.error`，保证 harness smoke 的「零 console 错误」门禁不破。

---

## 8. 性能与防卡顿

1. **渲染零阻塞**：钩子是同步函数，只读内存 Map；全部网络在队列里异步进行。
2. **并发限流 6**：防打爆站点/触发对端 rate limit；按 **host 去重**，同 host 多书签共享一次链路。
3. **视口优先**：`<img loading="lazy">`（tree-render.js:161）决定屏外图标的 load 事件不触发——首屏只补全可见区域，滚动到哪补到哪。
4. **failed 24h 免重试**：对无 favicon/403 站点不反复请求。
5. **首屏风暴预算**：N 个可见占位图 → 入队去重 → 6 并发 × 每层 3-5s 超时 → 分批完成；视图全程不卡，图标陆续从默认变真实。

---

## 9. 失效与手动刷新

| 层 | 机制 |
|---|---|
| Chrome `_favicon` | 每次渲染重跑 calibrate+判定；Chrome 缓存建立后自动走真实图标（§4.4） |
| 补全缓存 | 30d TTL 到期重新补全 + LRU 淘汰 |
| failed 标记 | 24h 后允许重试 |
| 手动 | 选项页「清除图标缓存」按钮（§6.2） |

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
| `src/favicon-enrich.js`（新，~300 行） | 导出 `initFaviconEnrich(ctx)` → `{ onPlaceholder, setEnabled, clearCache }`。ctx：`{ doc, store, faviconService, isEnabled(), ddgEnabled() }`（getter 决策时读取，同 faviconContrast 模式）。内含：发现链 L1-L4、`fetchWithTimeout`（自控 AbortController + 外链 signal，仿 dead-links.js:49-70）、图标校验+base64 编码（§3.1）、`<link>` 正则提取（§3.2）、缓存 Map/LRU/TTL/failed（§5）、队列+6 并发限流、热替换（§4.3）、onChanged 缓存重 hydrate |
| `src/favicon-fallback.js` | §4.1 三处：`ctx.onPlaceholder` 两个分支调用；返回 API 加 `sampleIcon: fingerprint`；`reapplyContrast` 选择器加 `, img.favicon-enriched` |
| `src/neat.js` | `import { initFaviconEnrich } from './favicon-enrich.js'`；在 faviconService 创建后立即实例化 enricher。实例化顺序有环：fallback 必须先于行渲染安装并拿到钩子，enricher 又依赖 faviconService 的 sampleIcon/statsBySrc——解法是 `ctx.onPlaceholder` 传惰性包装 `img => enricher && enricher.onPlaceholder(img)`（`let enricher = null`，建完赋值；钩子的首次调用发生在行渲染时，必然已就绪），同 neat.js 的 lazy getter 惯例；现有 storage.onChanged listener 加 `faviconEnrich`/`faviconEnrichDdg` 分支 → `enricher.setEnabled(...)` |
| `src/options.js` | viewSettings +2 项；5 个 label 赋值；DDG 复选框 disabled 联动；`favicon-cache-clear` handler；备份导出 `delete localData.vbmFaviconCache` |
| `pages/options.html` | Views 组 favicon-contrast 行后 +3 个 `<li>`（§6.2） |
| `src/store.js` | `KNOWN_KEYS` + `'faviconEnrich'`、`'faviconEnrichDdg'`（紧跟 `'faviconContrast'` 注释行） |
| `css/neat.css` | `.favicon-enriching` 规则（2 行） |
| `_locales/{en,zh_CN,…}/messages.json` | 6 个新 key（§6.3 流程） |
| `tests/favicon-enrich.test.js`（新） | §12 |
| `tests/favicon-fallback.test.js` | 扩：钩子契约 + sampleIcon + enriched 选择器 |
| `AGENTS.md` | `src/favicon-enrich.js` 新行；`src/favicon-fallback.js` 行补 onPlaceholder/sampleIcon；store.js 行补两键；options 行补 Views 组新开关与备份排除；测试段落补新套件 |

---

## 12. 测试计划

### `tests/favicon-enrich.test.js`（新，ESM 直导 + globalThis 注入，仿 favicon-fallback.test.js）

- **发现链**：L1 命中短路（L2 不发请求）；L1 404 → L2 解析 `<link>` 命中；L2 无声明 → L3（ddgEnabled=true 才发）；全失败 → failed 标记；L4 仅在 session 标记 + deadProxyServer 双条件满足时带 `__vbm_px=1` 重试。
- **校验**：200+`text/html` 拒绝；>200KB 拒绝；魔数不符拒绝；Image 解码 `naturalWidth=0` 拒绝；`data:` href 的 `<link>` 直接采用。
- **缓存**：写读往返；成功 30d TTL 到期重补；failed 24h 内不重复请求、到期重试；LRU 500 淘汰最旧。
- **队列**：同 host 并发渲染只入队一次（anchors 合并）；并发在途 ≤ 6；`setEnabled(false)` 清空队列 + abort 在途。
- **热替换**：anchor 在 DOM → svg 换 img；anchor 脱离 → 跳过不抛。
- 测试桩：`fetch` 脚本化响应、`Image` 伪类（仿 favicon-fallback.test.js:33-47）、`chrome.storage.session/local` 用 `tests/helpers/chrome.js` 的 `makeStorageArea`、`store` 用 `tests/helpers/dom.js` 的 `makeStoreDouble`。**禁止复制实现进测试**（AGENTS.md 红线）。

### `tests/favicon-fallback.test.js`（扩）

- `onPlaceholder` 返回 true → 不换默认 SVG；返回 false/未提供 → 现状换 SVG（两条占位分支各覆盖一次）。
- 返回 API 含 `sampleIcon`，对伪 img 返回指纹对象。
- `reapplyContrast` 覆盖 `img.favicon-enriched`。

### 门禁

- `npm run test:run` 全绿。
- `scripts/harness/run.sh --smoke-only`：popup/panel/options 加载零 console 错误（DinD 无外网，补全 fetch 全部快速失败——正是「静默降级不刷屏」的现成验证场）。
- `python3 scripts/i18n.py verify` 0 错误。
- 手动：真实 Chromium 加载，种子书签混含知名站 + 冷门站，观察图标陆续补全；选项页开关即时生效、清除缓存后下次打开重补。

---

## 13. 落地步骤（每步独立提交，遵循「按任务粒度就地提交」）

1. **S1** `src/favicon-enrich.js` + `tests/favicon-enrich.test.js` 全绿 → commit（`feat: favicon enrich module — discovery chain L1-L3, cache, queue`）。
2. **S2** `favicon-fallback.js` 钩子 + `sampleIcon` + 选择器扩展 + 测试扩展 → commit。
3. **S3** neat.js 接线 + options（UI/联动/清除按钮/备份排除）+ store KNOWN_KEYS + neat.css + i18n（translate+verify 过闸）→ commit。
4. **S4** L4 代理接力 + 对应测试 → commit。
5. **S5** harness smoke + AGENTS.md 同步 + 手动验证 → commit。

---

## 14. 风险与边界

| 风险 | 缓解 |
|---|---|
| 大书签库首屏并发 | 6 限流 + host 去重 + lazy 视口优先 + failed 24h |
| 站点 403/反爬 | L2 页面解析 + L3（opt-in）+ L4 代理 |
| DDG 对未知域名返回自家占位 | 如实接受（§3.3），该层默认关 |
| 服务器返回 200+非图片 | 三段校验 + Image 解码终验（§3.1），坏数据不进缓存 |
| PAC 窗口竞态 | 重试失败落 failed，24h 后自愈（§3.4） |
| 存储配额 | LRU 500 + 只存成功图标 + 配额错误砍半重试（§5.2） |
| 设置备份膨胀 | 导出显式排除缓存键（§5.3） |
| ICO 多尺寸 | `<img>` 加载 ICO 时 Chrome 自动选帧，无需处理 |
| 隐私观感 | 主链路仅发往用户已收藏站点；第三方兜底独立子开关默认关 + hint 明说 |

---

## 15. 决策定稿

| 决策 | 定稿 |
|---|---|
| 主开关 `faviconEnrich` | **默认开**，local 区 '1'/'' 模型，入 KNOWN_KEYS |
| DDG 兜底 | **独立子开关 `faviconEnrichDdg`，默认关**（隐私姿态与项目一致；推翻旧稿「单开关含 DDG」） |
| 执行位置 | **前端**（popup/panel 页面）——热替换需要行内 DOM 锚点，SW 拿不到 |
| 注入格式 | **data URL**（可持久化；CSP `img-src data:` 原生覆盖；不经 blob URL） |
| 缓存 | `vbmFaviconCache` 单键 JSON 字符串，LRU 500 成功项，成功 30d TTL，failed 24h |
| 并发 | **6**，按 host 去重 |
| 刷新入口 | 选项页清除按钮；**不做 palette 命令**（curated 表 + 保留词测试钉死） |
| 代理接力 | **做**（L4）：门槛 = `storage.session.vbmProxySession` + `deadProxyServer`，复用 marker-PAC 零新消息 |
| 死链扫描顺带解析 `<link>` | **本期不做**：checkUrl 是 HEAD 优先不读 body，改 GET+读 body 增加扫描带宽与复杂度，且 L2 已覆盖同一目标（非标准路径发现）。若未来要做（复用 blocked 站点的扫描响应），另行独立设计 |
| 结果呈现 | 就地更新 + `.favicon-enriching` 微视觉；不做结果列表 |
| 补全中视觉 | 做（2 行 CSS + 类翻转） |

---

*定稿。实施从 §13-S1 开始；任何偏离本设计的实现取舍需先回本节改决策表。*
