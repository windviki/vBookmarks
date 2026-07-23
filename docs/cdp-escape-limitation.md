# CDP `Input.dispatchKeyEvent` 无法触发 document capture 监听器的技术说明

## 问题

Puppeteer 的 `page.keyboard.press('Escape')` 无法触发 `keyboard.js` 中注册的
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

## 正确方案

1. **生产代码**保持 capture 监听器（拦截 Chrome 原生的 popup-close 行为必须用 capture）

2. **Docker 测试**中 ESC 逻辑通过以下方式覆盖：
   - `page.evaluate` 直接模拟处理器效果（检查 DOM 状态变化）
   - **vitest 单元测试**覆盖 ESC 决策树全部 11 种状态组合（`tests/search-esc.test.js`）

## 还可以做什么

- 将 bubble 阶段的监听器也注册一份用于测试（但生产环境中 capture+bubble 会导致重复执行）
- 通过 `chrome.debugger` API 在测试环境中注入事件（需要额外权限，且仅限非扩展页面）
