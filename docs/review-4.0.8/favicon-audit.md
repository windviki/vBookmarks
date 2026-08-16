# favicon 补全机制 · 4.0.8 master 全量审计报告

> 审计日期：2026-08-16 · 对象：master 4.0.8 favicon 补全链路（`favicon-enrich.js` / `favicon-fallback.js` / `neat.js` 接线 / `options.js` / `store.js` / CSS / 测试）
> 依据：`docs/favicon-补全设计.md`（实施定稿）逐条核对契约。
> 范围说明：死链视图（4.0.7 独立分支）不在本次审计范围。

---

## 0. 结论摘要

功能整体完备、设计与实现高度对齐。本次审计发现 **4 处确定缺陷并已修复**，另有 **8 处评估后保留现状**（多为设计既定行为或低影响边界，逐一记录理由）。全部改动通过 2257 例单测、ESLint 与 i18n verify 门禁。

**本次修复（4 项）**：

| # | 缺陷 | 性质 | 修复 |
|---|---|---|---|
| 1 | `persistIdxNow` 重建索引时把会话级图标（`persist:false`，>96KB 或配额降级）写成 success 行，但无对应数据键 | 索引↔数据键漂移（自愈但错误） | 索引重建跳过 `persist === false` 条目 |
| 2 | `extractLinkIcons` 打分 `type=svg` 分支无条件 `score=2`，覆盖 `sizes=16x16/32x32` 已给的 `score=3` | 违背"取最高分" | `Math.max(score, 2)` |
| 3 | `writeEntry` 每次成功在同一个 `set` 里写数据键+索引，末尾又 `persistIdxDebounced()`——索引被写 N 次+1 次，抵消分键布局的写放大规避 | 写放大 | 只立即写数据键，索引完全走 1s debounce |
| 4 | 设计 §5.1 "pagehide 前 flush" 未接线，`flushIndex` 暴露后从未调用 | failed 标记跨会话丢失 | `neat.js` 加 `pagehide → flushIndex` |

---

## 1. 功能完备性核对（设计契约 vs 实现）

| 设计项 | 实现 | 结论 |
|---|---|---|
| 发现链 L1→L2→L3→L4 逐层短路 | `discover()` 顺序调用，任一层通过校验即返回 | ✅ |
| 校验四段（`res.ok` + ≤200KB + 魔数/类型 + Image 解码） | `validateAndEncode` 完整实现，含 octet-stream 走魔数、非图片 header 权威拒绝 | ✅ |
| L2 `<link>` 正则提取（无 DOMParser） | `extractLinkIcons`：剥注释、`<base href>`、data: 直用、相对路径、打分排序 | ✅（打分见修复 #2） |
| L3 代理接力（session 标记 + `deadProxyServer` 双门槛，`addProxyMarker` 重试 L1/L2 + 熔断服务商） | `proxyRelayAvailable` 直读 session/local，`tryL3` 完整 | ✅ |
| L4 第三方聚合（内置列表 + 按服务商独立熔断 + 故障转移） | `AGG_PROVIDERS`（favicon-run→duckduckgo）+ `interpret` 一致接口 + `down[]` 持久化 | ✅ |
| 缓存按 host 分键 + 索引（v3 形状含 `down` 表） | `vbmFavicon:<host>` + `vbmFaviconIdx` | ✅ |
| hydrate 竞态（链启动前重读 Map） | `runItem` `await hydrateDone` 后重查 `cache` | ✅ |
| 动态字节预算 + 砍半淘汰 + 超大图标会话级 + 配额紧急淘汰 | 全部落地 | ✅（索引重建有泄漏，见修复 #1） |
| 备份排除 / 手动清除 | options 导出前缀剔除 + 清除按钮 + `onChanged` 清 Map | ✅ |
| 开关（主/聚合兜底，默认开）+ 联动降级 | `faviconEnrich`/`faviconEnrichAgg` 默认 '1'，主关→子 disabled | ✅ |
| 热替换 + 反色登记（按 dataUrl 缓存采样） | `hotSwap`/`injectImg` + `registerEnriched` | ✅ |
| `reapplyContrast` 选择器扩展 `img.favicon-enriched` | favicon-fallback 已加 | ✅ |

**结论**：设计 §15 决策表所列项目全部实现，无缺失。仅存的偏差集中在写路径细节（已修复）与若干既定边界（见 §3）。

---

## 2. 本次修复明细

### 2.1 `persistIdxNow` 会话级条目泄漏进索引（缺陷）

**现象**：`persistIdxNow` 从内存 `cache` 全量重建 `idxData.hosts` 时，未过滤 `persist === false` 的会话级条目。超大图标（>96KB）或配额降级图标本应"只进会话 Map、不落盘、不入索引"，却会被写入索引为一个 success 行——但它的 `vbmFavicon:<host>` 数据键从未写过。

**影响**：索引短暂地指向一个不存在的数据键，直到下次 hydrate 对账（"索引有而数据键无 → 删"）才自愈。不会丢数据，但产生瞬时漂移，且 `s` 字节数被错误计入索引。

**修复**：索引重建循环跳过 `!e.f && e.persist === false`。

```js
if (!e.f && e.persist === false)
    continue;   // session-only (oversized / quota-degraded): no data key to index
```

**测试**：新增「persisting the index skips session-only entries」——超大图标落会话 Map 后 `flushIndex()`，断言索引不含该 host。

### 2.2 `extractLinkIcons` 打分覆盖（缺陷）

**现象**：`type="image/svg+xml"` 分支用 `score = 2` 无条件覆盖，导致同时声明 `sizes="16x16"` 和 `type=svg` 的链接最终得 2 而非 3，违背设计 §3.2 "取最高分"。

**修复**：`score = Math.max(score, 2)`。

**测试**：新增「an SVG with 16x16/32x32 sizes keeps the top score」。

### 2.3 索引写放大（性能/设计对齐）

**现象**：`writeEntry` 在同一个 `set` 里写数据键 + 完整索引（30–50KB），末尾又 `persistIdxDebounced()`。一场 800 host 首屏风暴 = 800 次索引写 + 1 次 debounce，恰是分键布局要规避的写放大。

**修复**：立即写只含数据键；索引完全交给 1s debounce 合并。hydrate 对账（"数据键有而索引无 → 补录"）已覆盖中间的短暂不一致窗口。`emergencyEvict` 重试同步改为只重试数据键（索引仍由 `evictToHalve` 的 debounce 落盘）。

**测试**：改写「writes the data key immediately and the index via the debounce」，断言数据键立即落盘、索引在 `flushIndex()` 前不存在、flush 后存在。

### 2.4 pagehide 未 flush（设计缺口）

**现象**：设计 §5.1 明确"pagehide 前 flush"，但 `flushIndex` 暴露后从未接线。failed 标记只走 debounce 写索引，popup 快速关闭（<1s）时丢失，导致"24h 免重试"在跨会话退化（下次打开对该 host 多发一次请求）。

**修复**：`neat.js` 在 enricher 实例化后加：

```js
window.addEventListener('pagehide', () => {
    if (enricher)
        enricher.flushIndex();
});
```

注：`pagehide` 在部分关闭路径不保证触发（与 `store.js`、`popup.js` 同模型），属 best-effort；丢失的 failed 标记只多花一次重试，可接受。`neat.js` 不进 vitest，由 harness smoke 兜底（设计 §1 既定）。

---

## 3. 边缘 case 与设计合理性（保留现状，记录理由）

| # | 观察 | 评估 | 处置 |
|---|---|---|---|
| 1 | L1 硬编码 `https://${host}/favicon.ico`，HTTP-only 站点丢失 `.ico` 捷径 | 设计 §3.1 明确写 `https://`；L2 用原始 `pageUrl`（含 scheme）覆盖 | 保留（as-designed） |
| 2 | `data:` href 仅支持 base64，百分号编码 SVG（`data:image/svg+xml,%3Csvg…`）被 `bad data url` 丢弃 | 罕见；SVG-in-data 多走 base64；丢弃后落下一 `<link>` | 保留（边界） |
| 3 | `mask-icon` 被采集（设计 §3.2 列出） | Safari 钉住标签的单色遮罩，作为 score 1/2 兜底，通常排在有尺寸 icon 之后 | 保留（as-designed，低分兜底） |
| 4 | `persistedBytes()` 未计入索引键 + 每个 `vbmFavicon:<host>` 键名开销 | 预算的"其他占用"被轻微高估，方向偏保守（绝不超真实剩余空间），误差 ~几十 KB | 保留（保守无害） |
| 5 | 合并锚点不分尺寸：同 host 多书签 L2 用第一个书签的 pageUrl | 若首 URL 是 404、另一 URL 才是含 `<link>` 的真实页，L2 可能错过；`/favicon.ico` 与 L4 兜底 | 保留（边界） |
| 6 | 合并锚点不加 `.favicon-enriching`：同 host 第二个渲染行的默认 SVG 不显示"补全中"变淡 | 纯视觉微差，完成时仍被正确热替换 | 保留（可后续打磨） |
| 7 | SVG 无固有宽高时 `naturalWidth > 0` 可能拒绝 | 浏览器对无尺寸 SVG 的 naturalWidth 行为不一；多数 SVG favicon 带 width/height | 保留（边缘） |
| 8 | `emergencyEvict` 的 `else { cache.set(…persist) }` 分支在 MV3 下不可达（`set` 恒返回 Promise） | 无害死代码；本次已顺带移除 `writeEntry` 里的对应死分支 | 保留（emergencyEvict 处无害） |

---

## 4. 测试覆盖度评估

**体量**：`favicon-enrich.test.js` 70 例 + `favicon-fallback.test.js` 42 例，全绿。

**已覆盖**：

- 发现链：L1 短路（L2/L4 不发）、L1 404→L2 `<link>`、L1/L2 败→L4、`fallbackEnabled=false` 跳过 L4、favicon-run 干净 500 故障转移、favicon-run 网络错跳闸+转移、favicon-run 200+HTML 校验拒绝后转移、L3 代理接力（session 标记双门槛）、代理不在线跳过 L3。
- 校验：非 2xx / >200KB / 非图片魔数 / octet-stream 魔数嗅探 / 显式非图片 header 拒绝 / Image 解码失败 / content-type 参数剥离。
- L2 截断：body stream 与 text fallback 两条路径都测（200KB 截断）。
- 熔断：跳闸后跳过、6h 自愈探测、各家独立、跨会话重 hydrate 仍生效、跳闸服务商经代理补试、无代理直接切下一家。
- 缓存：分键写读、failed 标记（24h 内抑制）、成功缓存热替换不发请求、hydrate 竞态、v1→v3 迁移、损坏重建、漂移对账、配额拒绝紧急淘汰。
- 队列/淘汰：host 去重、并发 ≤6、`setEnabled(false)` 清队+abort、动态预算、砍半、>96KB 会话级、配额满封顶。
- 热替换：DOM 内替换、脱离锚点跳过、dataUrl 采样缓存（二次注入不重采样）。

**桩真实性**：`makeStorageArea.getBytesInUse` 用 JSON 串长近似真实字节；`set/remove` 记录调用供断言；`makeFakeImage` 默认解码成功、解码失败用自定义 `deadImage`；`streamResponse` 走真实 `body.getReader` 分支。无"复制实现进测试"（AGENTS.md 红线）。

**已知缺口**：`neat.js` 接线（pagehide flush、`storage.onChanged` 开关）不进 vitest，由 harness smoke 门禁兜底——设计 §1 既定，非本次新引入。

---

## 5. 性能与视觉

**性能（已落地 + 本次加固）**：

- 渲染零阻塞：`onPlaceholder` 同步只读内存 Map；网络全在队列异步。
- 并发 ≤6 + host 去重 + `<img loading="lazy">` 视口优先。
- `TextDecoder` 模块级单例复用（不再每 host 每次 L2 各建一个）。
- `registerEnriched` 按 dataUrl 缓存采样结果，重渲染/主题切换/缓存注入命中缓存不重解码。
- 本次 #2.3：索引写解耦，消除首屏风暴的 N 次 ~30–50KB 索引写。

**视觉（1ba9a52 已落地）**：

- `.favicon-container img { object-fit: contain }`——非方形 ICO/apple-touch 不再被 16px 盒压扁。
- `.favicon-enriched` 180ms 淡入——默认 SVG → 真实图标替换不再是生硬闪变。
- `.favicon-enriching` 变淡——补全中微视觉（`opacity:.45` + 过渡）。

---

## 6. 门禁结果

| 门禁 | 结果 |
|---|---|
| `npm run test:run` | 2257 passed（69 files） |
| `npm run lint` | 0 error |
| `python3 scripts/i18n.py verify` | 0 error（27 条菜单项长度警告，与 favicon 无关，既有） |
