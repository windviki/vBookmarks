# vBookmarks 优化实施 PLAN

## 概述
基于评估文档中的问题和优化建议，制定详细的实施计划。优先级：高 > 中 > 中低。

## 任务列表

### 1. 统一存储方案（高优先） ✅
- [x] 将 options.js 中的 localStorage 替换为 chrome.storage.local 和 chrome.storage.sync
- [x] 封装 getSetting 和 setSetting 辅助函数
- [x] 确保 SyncManager 和 options 同步设置一致
- [x] 测试存储兼容性和回退机制

### 2. 现代化重构（中优先） ✅
- [x] background.js Omnibox 搜索改为 async/await + debounce (250ms)
- [x] 封装搜索命中策略为可测试函数 rankBookmarks(query, results)
- [x] options.js 改成数据驱动配置列表，抽象 createToggleOption 等函数

### 3. 扩展同步管理（中优先） ✅
- [x] SyncManager 改为事件触发增量刷新而非定时全量扫
- [x] 实现 cache TTL/LRU 策略，避免内存占用
- [x] 同步刷新间隔改为可配置（最小 20s）

### 4. 兼容与迁移成本（中低优先） ✅
- [x] 替换 chrome.extension.sendRequest 为 chrome.runtime.sendMessage
- [x] 将 DOM 入口封装为 initXXX() 函数，便于后续框架迁移

### 5. 安全与可维护性（高优先） ✅
- [x] 修改 CSP，关闭 unsafe-inline，脚本和样式文件化
- [x] web_accessible_resources 使用精确路径，移除 <all_urls> 和 *
- [x] 配置域白名单而非全域

### 6. UI/UX 体验优化（中低优先） ✅
- [x] options.html 添加 aria 可访问标签
- [x] popup.js popupWidth/Height 添加边界和容错处理
- [x] 实现 undo 功能：基于 chrome.bookmarks.onRemoved 恢复删除

### 7. 单元测试与 CI 建议（高优先） ✅
- [x] 创建 tests/ 目录
- [x] 使用 vitest/jest 添加单元测试
- [x] 测试纯函数：matcher, isUrlSyncable, getSyncStatusIndicator 等
- [x] 模拟 chrome API 测试 SyncManager

## 实施进度追踪
- 开始时间：2026-03-22
- 当前阶段：所有优化项已完全实施完成
- 完成任务：7/7

## 提交记录
- [初始提交] 创建 docs 目录并移动文档文件
- [feat: 统一存储方案] 替换 localStorage 为 chrome.storage，修复兼容性问题
- [feat: 现代化重构与安全优化] background.js 添加 debounce 和 rankBookmarks，manifest.json 移除 unsafe-inline
- [feat: 扩展同步管理优化] SyncManager 添加 cache TTL 和 LRU，刷新间隔优化
- [feat: 兼容与迁移成本优化] popup.js 封装 initPopup，统一存储
- [feat: 单元测试与 CI 建议实施] 创建 tests/ 和 package.json，添加基础测试
- [feat: 完成剩余优化项] options.js 数据驱动，aria标签，undo功能</content>
<parameter name="filePath">/home/coder/vBookmarks/docs/PLAN.md