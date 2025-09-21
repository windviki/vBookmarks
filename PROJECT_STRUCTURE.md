# vBookmarks 项目结构说明

## 目录结构

```
vBookmarks/
├── src/                          # 源代码目录
│   ├── components/               # UI组件
│   │   ├── bookmark-tree/        # 书签树组件
│   │   ├── search/              # 搜索组件
│   │   ├── context-menu/        # 右键菜单
│   │   └── floating-toolbar/    # 浮动工具栏
│   ├── core/                    # 核心功能模块
│   │   ├── bookmark-manager/    # 书签管理器
│   │   ├── search-engine/       # 搜索引擎
│   │   ├── event-system/        # 事件系统
│   │   ├── storage-manager/     # 存储管理器
│   │   └── drag-drop/           # 拖拽管理器
│   ├── utils/                   # 工具函数
│   │   ├── dom/                 # DOM操作工具
│   │   ├── string/              # 字符串处理工具
│   │   ├── performance/         # 性能优化工具
│   │   └── keyboard/            # 键盘导航工具
│   ├── styles/                  # 样式文件
│   │   ├── components/          # 组件样式
│   │   ├── themes/              # 主题样式
│   │   └── base/                # 基础样式
│   ├── pages/                   # 页面组件
│   │   ├── popup/               # 弹出页面
│   │   ├── options/             # 选项页面
│   │   └── advanced-options/    # 高级选项页面
│   ├── background/              # 后台脚本
│   ├── constants/               # 常量定义
│   └── existing/                # 现有模块（待重构）
├── assets/                      # 静态资源
│   ├── icons/                   # 图标文件
│   ├── images/                  # 图片资源
│   └── locales/                 # 国际化文件
├── scripts/                     # 脚本工具
│   ├── build/                   # 构建脚本
│   ├── tools/                   # 开发工具
│   │   ├── translation-tools/   # 翻译相关工具
│   │   ├── package-tools/       # 打包工具
│   │   └── analysis-tools/      # 分析工具
│   └── translation/             # 翻译脚本
├── tests/                       # 测试文件
│   ├── unit/                    # 单元测试
│   ├── integration/             # 集成测试
│   ├── e2e/                     # 端到端测试
│   └── existing/                # 现有测试
├── docs/                        # 文档
│   ├── REFACTORING_PLAN_V2.md   # 重构计划
│   ├── DEVELOPMENT.md           # 开发指南
│   └── 其他文档文件
├── config/                      # 配置文件
├── dist/                        # 构建输出（待创建）
└── 根目录文件                   # 核心入口文件
```

## 核心文件说明

### 根目录文件（扩展入口）
- `manifest.json` - Chrome扩展配置文件
- `popup.html/js` - 弹出窗口主页面
- `options.html/js` - 选项页面
- `advanced-options.html/js` - 高级选项页面
- `background.html/js` - 后台脚本
- `bookmark-editor.html/js` - 书签编辑器
- `neat.js` - 核心书签管理逻辑（待重构）
- `neat.css` - 主要样式文件（待重构）
- `neatools.js` - 工具函数库
- `codemirror.js/css` - 代码编辑器

### 重构进度

#### 已完成
- ✅ 创建新的目录结构
- ✅ 整理和分类无关文件
- ✅ 制定重构计划文档

#### 进行中
- 🔄 重构neat.js核心逻辑

#### 待完成
- ⏳ 优化和重构CSS代码
- ⏳ 测试重构后的功能完整性

## 重构策略

### 阶段1: 基础架构（已完成）
- 创建模块化目录结构
- 整理现有文件分类
- 建立重构计划

### 阶段2: 核心逻辑重构（进行中）
- 拆分neat.js为专门模块
- 建立清晰的依赖关系
- 保持功能兼容性

### 阶段3: 样式系统优化（待完成）
- 重构CSS为模块化结构
- 支持主题定制
- 优化样式性能

### 阶段4: 测试和优化（待完成）
- 完善测试覆盖
- 性能优化
- 文档完善

## 开发指南

### 新功能开发
1. 在对应的`src/components/`或`src/core/`目录下创建模块
2. 遵循现有的命名规范
3. 确保适当的测试覆盖
4. 更新相关文档

### 调试现有功能
1. 查看相关模块的源代码
2. 检查测试文件了解预期行为
3. 使用浏览器开发者工具调试
4. 参考重构计划了解架构设计

### 构建和测试
```bash
# 开发模式
npm run dev

# 构建生产版本
npm run build

# 运行测试
npm test

# 代码检查
npm run lint
```

## 注意事项

- 重构过程中保持向后兼容性
- 所有现有功能必须正常工作
- 用户设置和数据不能丢失
- 遵循Chrome扩展开发最佳实践