# vBookmarks 开发指南

本文档为开发者提供详细的技术文档和开发指南。

## 🏗️ 架构概览

vBookmarks 采用现代化的模块化架构，基于 ES6+ 标准和最佳实践。

### 核心设计原则

1. **模块化** - 功能按职责分离到独立模块
2. **事件驱动** - 模块间通过事件系统通信
3. **可测试性** - 每个模块都可独立测试
4. **性能优化** - 内置性能监控和优化
5. **安全性** - 全面的输入验证和 XSS 防护

### 架构层次

```
┌─────────────────────────────────────────┐
│             Application Layer           │
│  ┌─────────────┐  ┌─────────────────┐  │
│  │   App V2    │  │ Module Loader   │  │
│  └─────────────┘  └─────────────────┘  │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│             Core Services               │
│  ┌─────────────┐  ┌─────────────────┐  │
│  │Event System │  │ Config Manager  │  │
│  │Error Handler│  │Performance Mon.│  │
│  └─────────────┘  └─────────────────┘  │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│             Feature Modules              │
│  ┌─────────────┐  ┌─────────────────┐  │
│  │Bookmark Mgr │  │     UI Manager   │  │
│  │Search Mgr   │  │   Security Mgr   │  │
│  └─────────────┘  └─────────────────┘  │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│             Utility Layer                │
│  ┌─────────────┐  ┌─────────────────┐  │
│  │   DOM Utils │  │    Storage       │  │
│  │   Logger    │  │    Security      │  │
│  └─────────────┘  └─────────────────┘  │
└─────────────────────────────────────────┘
```

## 📁 代码结构详解

### `src/constants/` - 常量定义

集中管理所有常量，避免魔法数字和字符串。

```javascript
// 示例：事件常量
export const EVENTS = {
  APP_READY: 'app:ready',
  BOOKMARKS_LOADED: 'bookmarks:loaded',
  // ...
};
```

### `src/core/` - 核心模块

#### EventSystem
中央事件系统，支持模块间解耦通信。

```javascript
import { eventSystem } from '@/core/event-system.js';

// 监听事件
eventSystem.on('bookmarks:loaded', (bookmarks) => {
  console.log('Bookmarks loaded:', bookmarks);
});

// 发送事件
await eventSystem.emit('bookmarks:loaded', bookmarks);
```

#### ConfigManager
配置管理器，支持动态配置和观察者模式。

```javascript
import { configManager } from '@/core/config-manager.js';

// 获取配置
const theme = configManager.get('theme');

// 设置配置
await configManager.set('theme', 'dark');

// 监听配置变化
configManager.observe('theme', (newValue, oldValue) => {
  console.log('Theme changed:', oldValue, '->', newValue);
});
```

### `src/utils/` - 工具模块

#### Performance Utils
性能优化工具集。

```javascript
import {
  performanceMonitor,
  debounce,
  throttle,
  memoize
} from '@/utils/performance.js';

// 性能监控
const result = await performanceMonitor.measure('render', () => {
  return renderComponent();
});

// 防抖函数
const debouncedSearch = debounce((query) => {
  performSearch(query);
}, 300);

// 记忆化
const expensiveOperation = memoize((input) => {
  return computeExpensiveResult(input);
});
```

#### Security Utils
安全工具集，防止 XSS 和其他安全威胁。

```javascript
import { security } from '@/utils/security.js';

// 输入验证
const validation = security.validate(userInput, 'url');
if (validation.valid) {
  const safeUrl = validation.sanitized;
}

// HTML 转义
const safeHTML = security.sanitize(userContent, 'html');
```

## 🚀 开发工作流

### 1. 环境设置

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

### 2. 编码规范

#### 命名约定

- **文件名**: kebab-case (例: `bookmark-manager.js`)
- **类名**: PascalCase (例: `BookmarkManager`)
- **变量**: camelCase (例: `bookmarkList`)
- **常量**: SCREAMING_SNAKE_CASE (例: `MAX_RESULTS`)
- **私有方法**: 下划线前缀 (例: `_privateMethod`)

#### 代码风格

使用 ESLint 和 Prettier 自动格式化：

```bash
npm run lint:fix  # 修复 linting 问题
npm run format    # 格式化代码
```

### 3. 测试驱动开发

#### 单元测试

```javascript
import { describe, test, expect } from 'vitest';
import { BookmarkManager } from '@/core/bookmark-manager.js';

describe('BookmarkManager', () => {
  test('should create bookmark', async () => {
    const manager = new BookmarkManager();
    const bookmark = await manager.createBookmark('1', 'Test', 'https://test.com');

    expect(bookmark).toBeDefined();
    expect(bookmark.title).toBe('Test');
  });
});
```

#### 集成测试

```javascript
import { describe, test, expect } from 'vitest';
import { VBookmarksApp } from '@/app-v2.js';

describe('VBookmarksApp Integration', () => {
  test('should initialize successfully', async () => {
    const app = new VBookmarksApp();
    await app.init();

    expect(app.initialized).toBe(true);
    expect(app.managers.has('bookmarkManager')).toBe(true);
  });
});
```

### 4. 性能优化

#### 使用性能监控

```javascript
import { performanceMonitor } from '@/utils/performance.js';

// 监控关键操作
const result = await performanceMonitor.measure('databaseQuery', async () => {
  return await database.query('SELECT * FROM bookmarks');
});

// 获取性能统计
const stats = performanceMonitor.getStats('databaseQuery');
console.log('Average query time:', stats.average);
```

#### 优化渲染性能

```javascript
import { rafThrottle, batch } from '@/utils/performance.js';

// 使用 requestAnimationFrame 节流
const handleScroll = rafThrottle((event) => {
  updateUI();
});

// 批量处理大量数据
const bookmarks = await batch(allBookmarks, 50, async (batch) => {
  return await processBookmarks(batch);
});
```

## 🔧 配置系统

### 配置结构

```javascript
// 所有可用配置
const config = {
  // 外观
  theme: 'auto',              // 'light' | 'dark' | 'auto'
  popupWidth: 400,           // 200-800px
  popupHeight: 600,          // 300-1000px

  // 功能
  autoResize: true,           // 自动调整大小
  showSyncStatus: true,      // 显示同步状态
  enableAnimations: true,    // 启用动画

  // 性能
  searchDebounceDelay: 300,  // 搜索防抖延迟
  maxSearchResults: 50,      // 最大搜索结果数

  // 调试
  debugMode: false,          // 调试模式
  enableKeyboardShortcuts: true // 键盘快捷键
};
```

### 自定义配置

```javascript
// 添加新的配置项
configManager.schema.set('customSetting', {
  type: 'string',
  default: 'default_value',
  validator: (value) => typeof value === 'string' && value.length > 0
});

// 使用配置
const customValue = configManager.get('customSetting');
```

## 🛡️ 安全最佳实践

### 输入验证

```javascript
import { security } from '@/utils/security.js';

// 验证用户输入
function handleUserInput(input) {
  const validation = security.validate(input, 'title');

  if (!validation.valid) {
    showError(validation.error);
    return;
  }

  const safeTitle = validation.sanitized;
  saveBookmark(safeTitle);
}
```

### XSS 防护

```javascript
// 转义 HTML 内容
function renderBookmarkTitle(title) {
  const safeTitle = security.sanitize(title, 'text');
  element.textContent = safeTitle;
}

// 安全的 URL 处理
function handleBookmarkUrl(url) {
  const validation = security.validate(url, 'url');
  if (validation.valid) {
    return validation.sanitized;
  }
  return '#'; // 安全的默认值
}
```

### 权限管理

```javascript
import { security } from '@/utils/security.js';

// 检查权限
async function checkPermissions() {
  const { hasAllPermissions, missing } = await security.checkPermissions();

  if (!hasAllPermissions) {
    console.warn('Missing permissions:', missing);
    // 请求缺失权限
    const granted = await security.permissionChecker.requestPermissions(missing);
    return granted;
  }

  return true;
}
```

## 🧪 测试策略

### 测试类型

1. **单元测试** - 测试单个函数/方法
2. **集成测试** - 测试模块间交互
3. **端到端测试** - 测试完整用户流程
4. **性能测试** - 测试性能指标
5. **安全测试** - 测试安全性

### 测试覆盖率

```bash
# 生成覆盖率报告
npm test -- --coverage

# 查看详细覆盖率
open coverage/index.html
```

### Mock Chrome API

```javascript
// 在测试中模拟 Chrome API
import { vi } from 'vitest';

// 设置 Chrome API mock
global.chrome = {
  bookmarks: {
    getTree: vi.fn(),
    create: vi.fn(),
    // ...
  }
};

// 在测试中使用
test('should load bookmarks', async () => {
  chrome.bookmarks.getTree.mockResolvedValue(mockBookmarks);

  const bookmarks = await bookmarkManager.loadBookmarks();
  expect(bookmarks).toEqual(mockBookmarks);
});
```

## 📊 性能监控

### 性能指标

- **渲染时间** - UI 渲染耗时
- **搜索时间** - 搜索响应时间
- **内存使用** - 内存占用情况
- **启动时间** - 应用启动耗时

### 性能优化建议

1. **虚拟滚动** - 处理大量书签列表
2. **延迟加载** - 按需加载模块
3. **缓存策略** - 缓存常用数据
4. **批量操作** - 批量处理请求

## 🚀 部署指南

### 构建流程

```bash
# 开发构建
npm run build:dev

# 生产构建
npm run build:prod

# 打包扩展
npm run package
```

### 版本管理

使用语义化版本控制：

- **主版本号** - 不兼容的 API 更改
- **次版本号** - 向下兼容的功能性新增
- **修订号** - 向下兼容的问题修正

### 发布流程

1. 更新版本号
2. 运行完整测试套件
3. 构建生产版本
4. 打包扩展文件
5. 更新变更日志
6. 发布到 Chrome Web Store

## 🤝 贡献指南

### Pull Request 流程

1. Fork 项目
2. 创建功能分支
3. 编写代码和测试
4. 运行代码检查
5. 提交 Pull Request

### 代码审查清单

- [ ] 代码符合项目规范
- [ ] 包含必要的测试
- [ ] 更新了相关文档
- [ ] 性能影响已评估
- [ ] 安全性已考虑

## 🔍 调试技巧

### 开发者工具

1. **Chrome DevTools** - 调试扩展
2. **Console Logging** - 使用 logger 模块
3. **Performance Tab** - 性能分析
4. **Network Tab** - 网络请求监控

### 常见问题

1. **扩展加载失败** - 检查 manifest.json
2. **权限错误** - 检查权限声明
3. **内存泄漏** - 使用 Chrome 内存分析工具
4. **性能问题** - 使用性能监控工具

## 📚 相关资源

- [Chrome Extensions Documentation](https://developer.chrome.com/docs/extensions/)
- [Vitest Documentation](https://vitest.dev/)
- [ESLint Documentation](https://eslint.org/)
- [Prettier Documentation](https://prettier.io/)

---

这份开发指南提供了 vBookmarks 项目的技术细节和最佳实践。如有问题，请参考相关文档或联系开发团队。