# vBookmarks 优化实施 PLAN

## 概述
基于评估文档中的问题和优化建议，制定详细的实施计划。优先级：高 > 中 > 中低。

## 任务列表

### 1. 统一存储方案（高优先）
- [ ] 将 options.js 中的 localStorage 替换为 chrome.storage.local 和 chrome.storage.sync
- [ ] 封装 getSetting 和 setSetting 辅助函数
- [ ] 确保 SyncManager 和 options 同步设置一致
- [ ] 测试存储兼容性和回退机制

### 2. 现代化重构（中优先）
- [ ] background.js Omnibox 搜索改为 async/await + debounce (250ms)
- [ ] 封装搜索命中策略为可测试函数 rankBookmarks(query, results)
- [ ] options.js 改成数据驱动配置列表，抽象 createToggleOption 等函数

### 3. 扩展同步管理（中优先）
- [ ] SyncManager 改为事件触发增量刷新而非定时全量扫
- [ ] 实现 cache TTL/LRU 策略，避免内存占用
- [ ] 同步刷新间隔改为可配置（最小 20s）

### 4. 兼容与迁移成本（中低优先）
- [ ] 替换 chrome.extension.sendRequest 为 chrome.runtime.sendMessage
- [ ] 将 DOM 入口封装为 initXXX() 函数，便于后续框架迁移

### 5. 安全与可维护性（高优先）
- [ ] 修改 CSP，关闭 unsafe-inline，脚本和样式文件化
- [ ] web_accessible_resources 使用精确路径，移除 <all_urls> 和 *
- [ ] 配置域白名单而非全域

### 6. UI/UX 体验优化（中低优先）
- [ ] options.html 添加 aria 可访问标签
- [ ] popup.js popupWidth/Height 添加边界和容错处理
- [ ] 实现 undo 功能：基于 chrome.bookmarks.onRemoved 恢复删除

### 7. 单元测试与 CI 建议（高优先）
- [ ] 创建 tests/ 目录
- [ ] 使用 vitest/jest 添加单元测试
- [ ] 测试纯函数：matcher, isUrlSyncable, getSyncStatusIndicator 等
- [ ] 模拟 chrome API 测试 SyncManager

## 实施进度追踪
- 开始时间：2026-03-22
- 当前阶段：初始化 PLAN
- 完成任务：0/7

## 提交记录
- [初始提交] 创建 docs 目录并移动文档文件</content>
<parameter name="filePath">/home/coder/vBookmarks/docs/PLAN.md