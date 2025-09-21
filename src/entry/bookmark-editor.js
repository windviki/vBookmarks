/**
 * vBookmarks 书签编辑器入口
 * 现代化的模块化书签编辑器
 */
import { VBookmarksApp } from '../app/VBookmarksApp.js';
import { AppInitializer } from '../core/app-initializer.js';
import { DialogSystem } from '../components/ui/dialog-system.js';
import { getTooltipManager } from '../components/ui/tooltip-manager.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('BookmarkEditor');

class VBookmarksEditor {
    constructor() {
        this.initialized = false;
        this.app = null;
        this.initializer = null;
        this.dialogSystem = null;
        this.tooltipManager = null;
        this.currentView = 'all';
        this.bookmarks = [];
        this.selectedBookmarks = new Set();
    }

    /**
     * 初始化书签编辑器
     */
    async init() {
        if (this.initialized) {
            logger.warn('Bookmark editor already initialized');
            return;
        }

        try {
            logger.info('Initializing vBookmarks editor...');

            // 创建应用初始化器
            this.initializer = new AppInitializer();

            // 检测环境
            await this.initializer.detectEnvironment();

            // 验证Chrome API
            await this.initializer.validateChromeAPIs();

            // 创建主应用实例
            this.app = new VBookmarksApp();

            // 初始化应用
            await this.app.init();

            // 创建对话框系统
            this.dialogSystem = new DialogSystem();

            // 获取工具提示管理器
            this.tooltipManager = getTooltipManager();

            // 等待DOM就绪
            await this.waitForDOMReady();

            // 加载书签
            await this.loadBookmarks();

            // 设置UI事件
            await this.setupUIEvents();

            // 设置搜索功能
            await this.setupSearch();

            // 设置视图切换
            await this.setupViewToggle();

            // 设置书签操作
            await this.setupBookmarkOperations();

            // 设置统计信息
            await this.setupStatistics();

            // 设置模态框
            await this.setupModals();

            this.initialized = true;
            logger.info('vBookmarks editor initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize bookmark editor:', error);
            this.showError(error);
        }
    }

    /**
     * 等待DOM就绪
     */
    async waitForDOMReady() {
        if (document.readyState === 'loading') {
            await new Promise(resolve => {
                document.addEventListener('DOMContentLoaded', resolve);
            });
        }
    }

    /**
     * 加载书签
     */
    async loadBookmarks() {
        try {
            if (this.app.modules.bookmarkManager) {
                const tree = await this.app.modules.bookmarkManager.getBookmarkTree();
                this.bookmarks = this.flattenBookmarks(tree);
                this.updateBookmarkDisplay();
                this.updateStatistics();
            } else {
                throw new Error('Bookmark manager not available');
            }
        } catch (error) {
            logger.error('Failed to load bookmarks:', error);
            throw error;
        }
    }

    /**
     * 扁平化书签树
     */
    flattenBookmarks(tree, result = [], path = '') {
        if (!tree || !tree.children) return result;

        tree.children.forEach(node => {
            if (node.url) {
                // 书签
                result.push({
                    ...node,
                    path: path
                });
            } else if (node.children) {
                // 文件夹
                const folderPath = path ? `${path}/${node.title}` : node.title;
                this.flattenBookmarks(node, result, folderPath);
            }
        });

        return result;
    }

    /**
     * 更新书签显示
     */
    updateBookmarkDisplay() {
        const container = document.getElementById('bookmarkGrid');
        if (!container) return;

        // 根据当前视图过滤书签
        let filteredBookmarks = this.bookmarks;

        if (this.currentView === 'recent') {
            filteredBookmarks = this.bookmarks
                .sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0))
                .slice(0, 50);
        } else if (this.currentView === 'favorites') {
            filteredBookmarks = this.bookmarks.filter(b => b.isFavorite);
        }

        // 渲染书签
        container.innerHTML = '';
        filteredBookmarks.forEach(bookmark => {
            const card = this.createBookmarkCard(bookmark);
            container.appendChild(card);
        });

        // 显示或隐藏空状态
        const emptyState = document.getElementById('emptyState');
        if (emptyState) {
            emptyState.style.display = filteredBookmarks.length === 0 ? 'block' : 'none';
        }
    }

    /**
     * 创建书签卡片
     */
    createBookmarkCard(bookmark) {
        const card = document.createElement('div');
        card.className = 'bookmark-card';
        card.dataset.bookmarkId = bookmark.id;

        const favicon = bookmark.favicon || `chrome://favicon/${bookmark.url}`;
        const title = bookmark.title || '无标题';
        const url = bookmark.url || '';
        const domain = url ? new URL(url).hostname : '';
        const dateAdded = bookmark.dateAdded ? new Date(bookmark.dateAdded).toLocaleDateString() : '';

        card.innerHTML = `
            <div class="bookmark-card-header">
                <img class="bookmark-favicon" src="${favicon}" alt="" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHZpZXdCb3g9IjAgMCAyMCAyMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTUgNUgxNVYxNUg1VjVaIiBzdHJva2U9IiM5NEEzQjgiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+Cjwvc3ZnPgo='">
                <div class="bookmark-info">
                    <div class="bookmark-title">${this.escapeHtml(title)}</div>
                    <div class="bookmark-url">${this.escapeHtml(url)}</div>
                </div>
            </div>
            <div class="bookmark-meta">
                <span class="meta-tag path">${this.escapeHtml(bookmark.path || '')}</span>
                ${dateAdded ? `<span class="meta-tag date">${dateAdded}</span>` : ''}
            </div>
            <div class="bookmark-actions">
                <button class="action-btn" onclick="editor.editBookmark('${bookmark.id}')" title="编辑">
                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>
                <button class="action-btn" onclick="editor.deleteBookmark('${bookmark.id}')" title="删除">
                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>
            </div>
        `;

        return card;
    }

    /**
     * 设置UI事件
     */
    async setupUIEvents() {
        // 导航事件
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                this.handleNavigation(e.target.closest('.nav-item'));
            });
        });

        // 刷新按钮
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.refreshBookmarks();
            });
        }

        // 添加书签按钮
        const addBookmarkBtn = document.getElementById('addBookmarkBtn');
        const fabAdd = document.getElementById('fabAdd');
        [addBookmarkBtn, fabAdd].forEach(btn => {
            if (btn) {
                btn.addEventListener('click', () => {
                    this.showAddBookmarkModal();
                });
            }
        });
    }

    /**
     * 处理导航
     */
    handleNavigation(navItem) {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });
        navItem.classList.add('active');

        const view = navItem.dataset.view;
        this.currentView = view;

        if (view === 'find-duplicates') {
            this.findDuplicates();
        } else if (view === 'check-links') {
            this.checkLinks();
        } else if (view === 'cleanup-tool') {
            this.showCleanupTool();
        } else if (view === 'import-export') {
            this.showImportExport();
        } else {
            this.updateBookmarkDisplay();
        }
    }

    /**
     * 设置搜索功能
     */
    async setupSearch() {
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            let searchTimeout;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(searchTimeout);
                const query = e.target.value.trim();

                searchTimeout = setTimeout(async () => {
                    if (query === '') {
                        this.updateBookmarkDisplay();
                    } else {
                        await this.searchBookmarks(query);
                    }
                }, 300);
            });
        }
    }

    /**
     * 搜索书签
     */
    async searchBookmarks(query) {
        try {
            if (this.app.modules.searchManager) {
                const results = await this.app.modules.searchManager.searchBookmarks(query);
                this.displaySearchResults(results);
            } else {
                logger.warn('Search manager not available, using fallback search');
                // 降级到本地搜索
                const results = this.bookmarks.filter(bookmark =>
                    bookmark.title.toLowerCase().includes(query.toLowerCase()) ||
                    bookmark.url.toLowerCase().includes(query.toLowerCase())
                );
                this.displaySearchResults(results);
            }
        } catch (error) {
            logger.error('Search failed:', error);
        }
    }

    /**
     * 显示搜索结果
     */
    displaySearchResults(results) {
        const container = document.getElementById('bookmarkGrid');
        if (!container) return;

        container.innerHTML = '';
        results.forEach(bookmark => {
            const card = this.createBookmarkCard(bookmark);
            container.appendChild(card);
        });

        // 显示或隐藏空状态
        const emptyState = document.getElementById('emptyState');
        if (emptyState) {
            emptyState.style.display = results.length === 0 ? 'block' : 'none';
            if (results.length === 0) {
                emptyState.querySelector('.empty-title').textContent = '没有找到匹配的书签';
                emptyState.querySelector('.empty-description').textContent = '尝试使用不同的关键词搜索';
            }
        }
    }

    /**
     * 设置视图切换
     */
    async setupViewToggle() {
        const viewBtns = document.querySelectorAll('.view-btn');
        viewBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                viewBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const view = btn.dataset.view;
                this.toggleBookmarkView(view);
            });
        });
    }

    /**
     * 切换书签视图
     */
    toggleBookmarkView(view) {
        const container = document.getElementById('bookmarkGrid');
        if (!container) return;

        if (view === 'table') {
            container.className = 'bookmark-table';
            this.displayTableView();
        } else {
            container.className = 'bookmark-grid';
            this.updateBookmarkDisplay();
        }
    }

    /**
     * 显示表格视图
     */
    displayTableView() {
        const container = document.getElementById('bookmarkGrid');
        if (!container) return;

        const table = document.createElement('div');
        table.className = 'bookmark-table';

        // 表头
        const header = document.createElement('div');
        header.className = 'table-header';
        header.innerHTML = `
            <div><input type="checkbox" class="checkbox" onchange="editor.toggleSelectAll(this.checked)"></div>
            <div>标题</div>
            <div>URL</div>
            <div>添加日期</div>
            <div>操作</div>
        `;
        table.appendChild(header);

        // 表格行
        this.bookmarks.forEach(bookmark => {
            const row = document.createElement('div');
            row.className = 'table-row';
            row.dataset.bookmarkId = bookmark.id;

            const dateAdded = bookmark.dateAdded ? new Date(bookmark.dateAdded).toLocaleDateString() : '';

            row.innerHTML = `
                <div><input type="checkbox" class="checkbox" onchange="editor.toggleBookmarkSelection('${bookmark.id}', this.checked)"></div>
                <div>${this.escapeHtml(bookmark.title || '')}</div>
                <div>${this.escapeHtml(bookmark.url || '')}</div>
                <div>${dateAdded}</div>
                <div>
                    <button class="action-btn" onclick="editor.editBookmark('${bookmark.id}')" title="编辑">
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                    <button class="action-btn" onclick="editor.deleteBookmark('${bookmark.id}')" title="删除">
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                </div>
            `;
            table.appendChild(row);
        });

        container.innerHTML = '';
        container.appendChild(table);
    }

    /**
     * 设置书签操作
     */
    async setupBookmarkOperations() {
        // 书签选择
        this.selectedBookmarks = new Set();
    }

    /**
     * 设置统计信息
     */
    async setupStatistics() {
        this.updateStatistics();
    }

    /**
     * 更新统计信息
     */
    updateStatistics() {
        const totalBookmarks = this.bookmarks.length;
        const totalClicks = this.bookmarks.reduce((sum, b) => sum + (b.clickCount || 0), 0);

        document.getElementById('totalBookmarks').textContent = totalBookmarks.toLocaleString();
        document.getElementById('totalClicks').textContent = totalClicks.toLocaleString();

        // 计算重复书签
        const duplicates = this.findDuplicateBookmarks();
        document.getElementById('duplicateCount').textContent = duplicates.length;

        // 模拟失效链接（实际实现需要链接检查）
        document.getElementById('brokenLinks').textContent = '-';
    }

    /**
     * 查找重复书签
     */
    findDuplicateBookmarks() {
        const urlMap = new Map();
        const duplicates = [];

        this.bookmarks.forEach(bookmark => {
            if (bookmark.url) {
                const normalizedUrl = this.normalizeUrl(bookmark.url);
                if (urlMap.has(normalizedUrl)) {
                    urlMap.get(normalizedUrl).push(bookmark);
                } else {
                    urlMap.set(normalizedUrl, [bookmark]);
                }
            }
        });

        urlMap.forEach((group, url) => {
            if (group.length > 1) {
                duplicates.push(...group.slice(1));
            }
        });

        return duplicates;
    }

    /**
     * 标准化URL
     */
    normalizeUrl(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.origin + urlObj.pathname;
        } catch {
            return url;
        }
    }

    /**
     * 设置模态框
     */
    async setupModals() {
        const modal = document.getElementById('bookmarkModal');
        const form = document.getElementById('bookmarkForm');
        const cancelBtn = document.getElementById('cancelBtn');

        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.saveBookmark();
            });
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                this.hideBookmarkModal();
            });
        }

        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.hideBookmarkModal();
                }
            });
        }
    }

    /**
     * 显示添加书签模态框
     */
    showAddBookmarkModal() {
        const modal = document.getElementById('bookmarkModal');
        const title = document.getElementById('modalTitle');

        if (title) {
            title.textContent = '添加书签';
        }

        // 清空表单
        document.getElementById('bookmarkForm').reset();

        // 加载文件夹列表
        this.loadFolderOptions();

        if (modal) {
            modal.style.display = 'flex';
        }
    }

    /**
     * 编辑书签
     */
    async editBookmark(bookmarkId) {
        try {
            if (this.app.modules.bookmarkManager) {
                const bookmark = await this.app.modules.bookmarkManager.getBookmark(bookmarkId);
                if (!bookmark) return;

                // 使用现代对话框系统显示编辑对话框
                const result = await this.dialogSystem.openDialog({
                    type: 'prompt',
                    title: '编辑书签',
                    message: '编辑书签信息',
                    defaultValue: bookmark.title,
                    fields: [
                        { name: 'title', label: '标题', value: bookmark.title || '', required: true },
                        { name: 'url', label: 'URL', value: bookmark.url || '', required: true }
                    ]
                });

                if (result && result.title && result.url) {
                    await this.app.modules.bookmarkManager.updateBookmark(bookmarkId, {
                        title: result.title,
                        url: result.url
                    });
                    this.showStatus('书签已更新');
                    await this.loadBookmarks();
                }
            } else {
                logger.error('Bookmark manager not available');
                this.showError('编辑书签功能不可用');
            }
        } catch (error) {
            logger.error('Failed to edit bookmark:', error);
            this.showError('编辑书签失败');
        }
    }

    /**
     * 删除书签
     */
    async deleteBookmark(bookmarkId) {
        try {
            // 使用现代对话框系统确认删除
            const confirmed = await this.dialogSystem.confirm(
                '确定要删除这个书签吗？此操作不可撤销。',
                '删除书签'
            );

            if (confirmed) {
                if (this.app.modules.bookmarkManager) {
                    await this.app.modules.bookmarkManager.deleteBookmark(bookmarkId);
                    this.showStatus('书签已删除');
                    await this.loadBookmarks();
                } else {
                    logger.error('Bookmark manager not available');
                    this.showError('删除书签功能不可用');
                }
            }
        } catch (error) {
            logger.error('Failed to delete bookmark:', error);
            this.showError('删除书签失败');
        }
    }

    /**
     * 保存书签
     */
    async saveBookmark() {
        try {
            // 使用现代对话框系统显示添加书签对话框
            const result = await this.dialogSystem.openDialog({
                type: 'prompt',
                title: '添加书签',
                message: '输入书签信息',
                fields: [
                    { name: 'title', label: '标题', required: true },
                    { name: 'url', label: 'URL', required: true }
                ]
            });

            if (result && result.title && result.url) {
                if (this.app.modules.bookmarkManager) {
                    await this.app.modules.bookmarkManager.createBookmark({
                        title: result.title,
                        url: result.url,
                        parentId: result.folderId || undefined
                    });

                    this.showStatus('书签已保存');
                    await this.loadBookmarks();
                } else {
                    logger.error('Bookmark manager not available');
                    this.showError('添加书签功能不可用');
                }
            }
        } catch (error) {
            logger.error('Failed to save bookmark:', error);
            this.showError('保存书签失败');
        }
    }

    /**
     * 隐藏书签模态框
     */
    hideBookmarkModal() {
        const modal = document.getElementById('bookmarkModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    /**
     * 加载文件夹选项
     */
    async loadFolderOptions(selectedFolderId = null) {
        const select = document.getElementById('bookmarkFolder');
        if (!select) return;

        try {
            const tree = await this.bookmarkManager.getBookmarkTree();
            select.innerHTML = '<option value="">选择文件夹</option>';

            this.addFolderOptions(tree.children, select, selectedFolderId);
        } catch (error) {
            console.error('Failed to load folders:', error);
        }
    }

    /**
     * 添加文件夹选项
     */
    addFolderOptions(folders, select, selectedFolderId, level = 0) {
        folders.forEach(folder => {
            if (!folder.url && folder.children) {
                const option = document.createElement('option');
                option.value = folder.id;
                option.textContent = '  '.repeat(level) + (folder.title || '无标题');
                if (folder.id === selectedFolderId) {
                    option.selected = true;
                }
                select.appendChild(option);

                this.addFolderOptions(folder.children, select, selectedFolderId, level + 1);
            }
        });
    }

    /**
     * 切换全选
     */
    toggleSelectAll(checked) {
        const checkboxes = document.querySelectorAll('.table-row .checkbox');
        checkboxes.forEach(cb => {
            cb.checked = checked;
        });

        this.selectedBookmarks.clear();
        if (checked) {
            this.bookmarks.forEach(bookmark => {
                this.selectedBookmarks.add(bookmark.id);
            });
        }
    }

    /**
     * 切换书签选择
     */
    toggleBookmarkSelection(bookmarkId, checked) {
        if (checked) {
            this.selectedBookmarks.add(bookmarkId);
        } else {
            this.selectedBookmarks.delete(bookmarkId);
        }
    }

    /**
     * 刷新书签
     */
    async refreshBookmarks() {
        try {
            await this.loadBookmarks();
            this.showStatus('书签已刷新');
        } catch (error) {
            console.error('Failed to refresh bookmarks:', error);
            this.showError('刷新书签失败');
        }
    }

    /**
     * 查找重复书签
     */
    findDuplicates() {
        const duplicates = this.findDuplicateBookmarks();
        this.displayDuplicates(duplicates);
    }

    /**
     * 显示重复书签
     */
    displayDuplicates(duplicates) {
        const container = document.getElementById('bookmarkGrid');
        if (!container) return;

        container.innerHTML = `
            <div class="duplicates-container">
                <div class="duplicates-header">
                    <h3 class="duplicates-title">重复书签</h3>
                    <div class="duplicates-tabs">
                        <button class="duplicate-tab active">按URL</button>
                        <button class="duplicate-tab">按标题</button>
                    </div>
                </div>
                <div class="duplicates-content">
                    <p>找到 ${duplicates.length} 个重复书签</p>
                </div>
            </div>
        `;
    }

    /**
     * 检查链接
     */
    checkLinks() {
        alert('链接检查功能正在开发中...');
    }

    /**
     * 显示清理工具
     */
    showCleanupTool() {
        alert('清理工具正在开发中...');
    }

    /**
     * 显示导入导出
     */
    showImportExport() {
        alert('导入导出功能正在开发中...');
    }

    /**
     * 显示状态消息
     */
    showStatus(message) {
        logger.info('Status:', message);
        // 可以在这里添加状态栏更新或Toast通知
    }

    /**
     * 显示错误消息
     */
    showError(message) {
        logger.error('Error:', message);
        // 使用现代对话框系统显示错误
        if (this.dialogSystem) {
            this.dialogSystem.alert(
                typeof message === 'string' ? message : message.message || '未知错误',
                '错误'
            );
        }
    }

    /**
     * HTML转义
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// 初始化书签编辑器
const editor = new VBookmarksEditor();

// 启动应用
editor.init().catch(error => {
    console.error('Failed to initialize bookmark editor:', error);
});

// 导出到全局作用域（用于HTML事件处理）
window.editor = editor;

export default editor;