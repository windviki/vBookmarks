# CDP `Input.dispatchKeyEvent` 无法触发 document capture 监听器的技术说明

> 来源：view-system 分支的实测分析（2026-07，已按其结论调整了本仓库的测试分层——
> 本文是"为什么 Docker 套件里没有 Esc 键测试"的答案，避免后人误加后困惑）。

## 问题

Puppeteer 的 `page.keyboard.press('Escape')` 无法触发 `src/keyboard.js` 中注册的
`document.addEventListener('keydown', handler, true)` capture 阶段监听器。

## 根因

Chrome DevTools Protocol 的 `Input.dispatchKeyEvent` 方法**不会完整复制浏览器
原生事件的三阶段模型**（capture → target → bubble）。它会短路事件分发管道，
导致 capture 阶段的 document-level 监听器被跳过。

这是 [lightpanda-io/browser#2080](https://github.com/lightpanda-io/browser/issues/2080)
和 [puppeteer/puppeteer#13445](https://github.com/puppeteer/puppeteer/issues/13445)
中跟踪的已知、未修复的 bug。

## 验证

- `page.keyboard.press('ArrowRight')` 在 `#view-tabs` 上的**冒泡阶段**监听器 → ✅ 正常
- `page.keyboard.press('Home')` 在 `#view-tabs` 上的冒泡监听器 → ✅ 正常
- `page.keyboard.press('Escape')` 在 `document` 上的 **capture 阶段**监听器 → ❌ 不触发
- `document.dispatchEvent(new KeyboardEvent(...))` → ❌ `isTrusted: false` 被 Chrome 静默拒绝

## 已验证无效的绕过方案

| 方案 | 结果 |
|------|------|
| `page.evaluate(() => document.dispatchEvent(new KeyboardEvent(...)))` | `isTrusted: false`，被忽略 |
| CDP `Input.dispatchKeyEvent` raw（Puppeteer 底层已用） | 短路 capture 阶段 |
| `--disable-features` 等 Chrome flags | 无相关 flag |
| `page.keyboard.press('Escape')` | 同上 |

## 本仓库的测试分层（按此结论划分）

1. **生产代码**保持 capture 监听器（拦截 Chrome 原生的 popup-close 行为必须用 capture）。

2. **Esc 分层链归 vitest**：`tests/keyboard.test.js` 用真实的 `initKeyboard` +
   DOM 双胞逐层剥离七层（dialogs → 右键菜单 → palette → 视图 onEscape →
   search 两级 → 回 tree → window.close），断言每层的消费顺序、
   `defaultPrevented`、`stopImmediatePropagation` 与 keyup 安全网——测的是真
   handler，不是决策树副本。

3. **Docker 只测 bubble 可达键**：`scripts/screenshots/verify-keyboard.js`
   硬断言 tab 条方向键/Home/End/↑/↓（监听器挂在 `#view-tabs` 元素上，bubble
   阶段，CDP 能驱动）、焦点区域拓扑、搜索双区与各视图渲染，作为 run.sh 的
   阻塞步骤。**不要**在 Docker 侧给 Esc 加测试——它会永远红，且原因是平台
   bug 而非产品 bug。

## 还可以做什么（目前均未采用）

- 将 bubble 阶段的监听器也注册一份用于测试（生产环境 capture+bubble 会重复执行）
- 通过 `chrome.debugger` API 在测试环境注入事件（需要额外权限，且仅限非扩展页面）
