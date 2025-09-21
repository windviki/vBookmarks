# vBookmarks 测试用例

本目录包含用于调试和验证vBookmarks扩展问题的测试用例。

## 测试文件说明

### 1. indicator-badge-debug.html
**用途**：调试书签树和搜索结果页面的indicator显示和badge对齐问题

**问题描述**：
- 书签树页面的sync indicator太靠下，看不见
- 搜索结果页面的badge没有与li右侧对齐
- 书签树页面的badge显示完美与li右侧对齐
- 搜索结果页面的indicator显示完美

**测试内容**：
- 模拟书签树和搜索结果的HTML结构
- 高亮显示favicon-container、sync-indicator、bookmark-metadata等关键元素
- 实时分析CSS样式的应用情况
- 验证修复效果

### 2. metadata-debug.html
**用途**：调试元数据显示问题

**问题描述**：
- 元信息只有添加日期badge显示
- 选项里的访问日期和点击次数都显示不了

**测试内容**：
- 模拟BookmarkMetadataManager的功能
- 可配置的元数据显示设置（添加日期、访问日期、点击次数）
- 模拟不同类型的书签数据
- 实时测试元数据的生成和显示

### 3. sorting-debug.html
**用途**：调试排序功能问题

**问题描述**：
- 按访问日期排序的页面里，为何只有几条记录？
- BookmarkTreeNode的dateLastUsed字段为何不使用？
- 按创建日期排序的页面，BookmarkTreeNode的dateGroupModified用上了吗？

**测试内容**：
- 模拟BookmarkTreeNode的完整数据结构
- 测试不同排序方式（点击次数、添加日期、访问日期、修改日期）
- 分析dateLastUsed、dateGroupModified等字段的使用情况
- 验证排序算法的正确性

## 使用方法

1. 在Chrome中加载vBookmarks扩展
2. 在浏览器中打开对应的测试HTML文件
3. 根据页面提示进行测试和调试
4. 查看控制台输出和页面显示的分析结果

## 问题修复记录

### 已知问题

1. **CSS优先级冲突**：neat.css中的样式定义与sync-styles.css中的修复存在冲突
2. **重复样式定义**：sync-styles.css中存在重复的favicon-container样式定义
3. **字段使用率低**：Chrome API中dateLastUsed字段的使用率较低，影响排序结果

### 修复方案

1. **提高CSS优先级**：使用更具体的选择器和!important标记
2. **清理重复定义**：删除重复的样式定义，保持CSS的整洁性
3. **完善回退机制**：当Chrome API字段为空时，回退到使用扩展管理的元数据

## 贡献

如果发现新的问题或修复方案，请在此目录中添加相应的测试用例。