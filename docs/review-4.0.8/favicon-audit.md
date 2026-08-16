# 4.0.8 favicon 机制审计报告

> 审计范围：favicon 补全（enrichment）+ 反色（contrast）+ 占位回退（fallback）全链路，对照设计契约 `docs/favicon-补全设计.md`，核查「设计文档 ↔ 实现 ↔ 测试覆盖」三方一致性。
> 方法：逐节比对设计文档（§3 发现链 / §4 渲染钩子 / §5 缓存与淘汰 / §6 开关）与 `src/favicon-enrich.js`、`src/favicon-fallback.js`、`src/store.js` 实现，并核对 `tests/favicon-enrich.test.js` / `tests/favicon-fallback.test.js` 是否覆盖每一条设计断言。
> 基线：`npm run test:run` 69 套件 / 2254 例全绿；`npm run lint` 干净；`bash scripts/harness/run.sh --smoke-only` EXIT=0。

---

## 一、总体评价

favicon 补全机制（4.0.6 落地）整体质量高：发现链四级递进（L1 favicon.ico → L2 页面 `<link>` → L3 代理接力 → L4 第三方聚合）、统一四步校验、per-host 缓存 + 索引自愈、配额淘汰与熔断服务商故障转移，设计与实现的契合度在多数环节达到「文档写什么、代码做什么、测试验什么」三线一致。

但「设计文档已声明、实现未落实」的缺口存在，且集中在**读取路径的健壮性**与**会话级资源的上限治理**上——这些恰好是长驻侧面板 / 大书签库场景最容易踩的边缘 case。本轮审计共确认 6 处确定缺口并全部修复，另评估 4 处边界场景后决定保持现状（记录决策）。

## 二、确定缺陷（已修）

| # | 域 | 发现 | 位置 |
|---|---|---|---|
| A1 | 校验 | **`application/octet-stream` 图标被误拒**：许多 CDN / 静态站把 `/favicon.ico` 以 `application/octet-stream` 提供（MIME 即「我不知道是什么字节」），旧实现把它当「显式非图片类型」直接拒绝——魔数嗅探只留给缺失 Content-Type 的情况。设计 §3.1 的意图是「显式非图片才拒、未知则嗅探」，octet-stream 正属于「未知」，应落入魔数嗅探而非拒绝 | `validateAndEncode`（favicon-enrich.js:141） |
| A2 | 读取 | **L2 页面 HTML 无大小上限**：`res.text()` 一次读整页。favicon `<link>` 全在 `<head>`，正文（巨型 / 恶意 body）只会拖慢解析、放大内存。设计 §3.1 给图标字节设了 200KB 上限，HTML 读取却没有同等的顶 | `tryL2` / `tryL2Proxy`（原 `res.text()`，无上限） |
| A3 | 竞态 | **hydrate-race 缓解未实现**：设计 §5.1 明确「首批占位图可能在 hydrate 完成前到达钩子——发现链启动前会重读 Map，命中则直接热替换、不发请求」。实际 `runItem` 入队后立即发请求，不等待 hydrate；首开 popup 时已缓存的 host 可能被重复 fetch（部分场景触发失败标记污染 / 冗余请求） | `runItem`（未等 `hydrateDone`） |
| A4 | 会话治理 | **会话级图标永不淘汰**：设计 §5.3 边缘 1 把 >96KB 图标定为「只进会话 Map 不落盘」，但内存里的会话级条目没有数量上限。长驻侧面板长期运行下，超大图标（每张 ≤200KB）可无界累积（设计原文：「>64KB 的 favicon 通常是误配的大 PNG，不值得为它花配额」——同样不值得无限占内存） | `writeEntry` oversized 分支 / `emergencyEvict` 降级分支 |
| A5 | 提取 | **`<base href>` 与注释残留未处理**：L2 `<link>` 提取 1) 会匹配到被 HTML 注释掉的历史图标声明（fetch 死链）；2) 相对 `href` 一律以 pageUrl 为基准解析，遇到 `<head>` 顶部声明 `<base href>`（罕见但真实，如资源 CDN）时解析错基 | `extractLinkIcons` |
| A6 | 存储 | **`faviconBackupInclude` 缺失于 KNOWN_KEYS**：options Icons 组「备份开关」（导出是否随包携带 favicon 缓存键）已接线，但未列入 `store.js` KNOWN_KEYS——镜像不预填、迁移不携带，旧用户升级后该开关的 localStorage 历史值丢失 | `src/store.js` KNOWN_KEYS |

## 三、核实后接受（记录决策，不改）

| # | 项 | 理由 |
|---|---|---|
| B1 | 缓存读命中不刷新 `t`（LRU 失效） | 设计刻意用「写入时 t」而非「读时 t」：读命中重写存储会造成每次渲染的写放大（storage.local.set 有配额与延迟成本）。失效粒度是 30d 成功 TTL，读不刷新只是让「长期每天打开 popup 的老站点」到点重取一次，成本可接受 |
| B2 | `emergencyEvict` 对一切写错误砍半 | 设计 §5.3 边缘 2 就是「配额写拒绝 → 砍最旧一半 → 重试 → 再失败降级会话级」。对非配额错误也走同一路径是安全优先（不区分错误类型，避免误放行坏数据），且降级到会话级兜底保证「本次会话仍可显示」，代价是命中率下降，无数据风险 |
| B3 | `mask-icon` 候选不采集 | 设计 §3.2 的 `<link>` 白名单收 `icon` / `apple-touch-icon` / `shortcut icon`，`mask-icon` 是 SVG 单色模板（通常需要主题着色），语义上与「真实彩色图标」不符。边界收益低，维持现状 |
| B4 | 合并锚点热替换不按尺寸分类 | 同一 host 多个书签合并渲染时只展示一个图标，属外观层细节；逐行按 `size` 分尺寸替换引入复杂度，收益仅为少数多尺寸场景的清晰度，本轮不动 |

## 四、修复明细

### A1 `validateAndEncode`：octet-stream → 魔数嗅探

Content-Type 分三桶处理（此前只有两桶）：

```
image/*                   → 直接采信（设计 §3.1「直接采信」）
缺省 / octet-stream       → 显式「我不知道」→ 魔数嗅探（mimeFromMagic）
其它非图片类型            → 权威拒绝（text/html 即使字节以 '<' 开头也不放行）
```

`; charset=` 等参数剥离后再判定。修复后 octet-stream 的 PNG / ICO 经魔数识别入缓存，text/html 依旧拒绝。

### A2 L2 读取上限：`readHtmlCapped`（MAX_HTML_BYTES = 200KB）

- 有 body 流（真实 fetch）→ `getReader()` 逐块读，读满 200KB 即 `cancel()` 截断
- 无流（测试 double）→ `text()` 后 `.slice(0, maxBytes)` 截断
- `tryL2` / `tryL2Proxy` 均改用 `readHtmlCapped`。favicon `<link>` 全在 `<head>`，200KB 足够；正文再多也不进解析

### A3 hydrate-race 缓解：`runItem` 重读 Map

`runItem` 首行 `await hydrateDone`（并行与渲染的 hydrate 汇合），随后重读 `cache.get(host)`：

- 命中且未过 30d TTL → 直接 `hotSwap` + `clearEnriching` + 出队，**不发请求**
- 未命中 → 照常走发现链

与设计 §5.1 逐字对齐（「发现链启动前会重读 Map」）。注意顺序：`hotSwap` 经 `queue.get(host)` 取锚点集合，必须**先 hotSwap 后 queue.delete**（首版实现顺序颠倒导致热替换静默失效，测试当场捕获）。

### A4 会话级上限：`evictSessionOverCap`（SESSION_ONLY_CAP = 24）

- `writeEntry` oversized 分支（>96KB → 会话级）与 `emergencyEvict` 降级分支（配额再失败）均调用
- 按 `t` 升序取全部会话级条目，超出 24 个淘汰最旧
- 会话级条目本就 `persist: false` 不占存储预算，此上限只约束内存占用（长驻侧面板的关键治理）

### A5 `extractLinkIcons`：注释剥离 + `<base href>` 解析

- 先 `replace(/<!--[\s\S]*?-->/g, '')` 剥注释，注释掉的图标声明不再误匹配
- 提取首个 `<base href>`，`new URL(href, baseUrl)` 以其为基准解析相对链接（`<base>` 缺失时回退 pageUrl）

### A6 `store.js`：KNOWN_KEYS 补 `faviconBackupInclude`

与 `faviconEnrich` / `faviconEnrichAgg` 并列加入 KNOWN_KEYS，镜像预填 + v1 迁移一并覆盖。

## 五、测试增量（`tests/favicon-enrich.test.js`）

| 用例 | 覆盖 |
|---|---|
| validateAndEncode — octet-stream PNG / ICO 经魔数接受 | A1 |
| validateAndEncode — text/html 仍拒绝（参数剥离后判定） | A1 回归 |
| extractLinkIcons — `<base href>` 相对链接解析到 base | A5 |
| extractLinkIcons — 注释内 `<link>` 忽略 | A5 |
| initFaviconEnrich — L2 HTML 流读取 200KB 截断（链接被推到 cap 之后 → 不 fetch） | A2 |
| initFaviconEnrich — L2 无流 fallback 同样截断 | A2 |
| initFaviconEnrich — hydrate 前占位 → 队列汇合后命中缓存热替换、0 fetch | A3 |
| initFaviconEnrich — 会话级图标超 SESSION_ONLY_CAP → 最旧被淘汰、不落盘 | A4 |

## 六、验证

- `npm run test:run`：69 套件 / 2254 例全绿（favicon-enrich 67 例、favicon-fallback 42 例含新增）
- `npm run lint`：干净
- `bash scripts/harness/run.sh --smoke-only`：EXIT=0，无页面错误，whats-new 横幅正常

## 七、范围与提交

本轮只提交审计直接涉及的文件：`src/favicon-enrich.js`、`src/store.js`、`tests/favicon-enrich.test.js`、本报告。
