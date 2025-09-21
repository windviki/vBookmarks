/**
 * vBookmarks 书签编辑器入口
 * 现代化的模块化书签编辑器
 */
import { BookmarkManager } from '../core/bookmark-manager/bookmark-manager.js';
import { globalEventSystem, Events } from '../core/event-system/event-system.js';

class VBookmarksEditor {
    constructor() {
        this.initialized = false;
        this.bookmarkManager = null;
        this.currentView = 'all';
        this.bookmarks = [];
        this.selectedBookmarks = new Set();
    }

    /**
     * 初始化书签编辑器
     */
    async init() {
        if (this.initialized) {
            console.warn('Bookmark editor already initialized');
            return;
        }

        try {
            console.log('Initializing vBookmarks editor...');

            // 初始化核心管理器
            this.bookmarkManager = new BookmarkManager();

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
            console.log('vBookmarks editor initialized successfully');
        } catch (error) {
            console.error('Failed to initialize bookmark editor:', error);
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
            const tree = await this.bookmarkManager.getBookmarkTree();
            this.bookmarks = this.flattenBookmarks(tree);
            this.updateBookmarkDisplay();
            this.updateStatistics();
        } catch (error) {
            console.error('Failed to load bookmarks:', error);
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
            const results = await this.bookmarkManager.searchBookmarks(query);
            this.displaySearchResults(results);
        } catch (error) {
            console.error('Search failed:', error);
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
            const bookmark = await this.bookmarkManager.getBookmark(bookmarkId);
            if (!bookmark) return;

            const modal = document.getElementById('bookmarkModal');
            const title = document.getElementById('modalTitle');

            if (title) {
                title.textContent = '编辑书签';
            }

            // 填充表单
            document.getElementById('bookmarkTitle').value = bookmark.title || '';
            document.getElementById('bookmarkUrl').value = bookmark.url || '';

            // 加载文件夹列表
            this.loadFolderOptions(bookmark.parentId);

            if (modal) {
                modal.style.display = 'flex';
            }
        } catch (error) {
            console.error('Failed to edit bookmark:', error);
        }
    }

    /**
     * 删除书签
     */
    async deleteBookmark(bookmarkId) {
        if (!confirm('确定要删除这个书签吗？')) {
            return;
        }

        try {
            await this.bookmarkManager.deleteBookmark(bookmarkId);
            this.showStatus('书签已删除');
            await this.loadBookmarks();
        } catch (error) {
            console.error('Failed to delete bookmark:', error);
            this.showError('删除书签失败');
        }
    }

    /**
     * 保存书签
     */
    async saveBookmark() {
        const title = document.getElementById('bookmarkTitle').value.trim();
        const url = document.getElementById('bookmarkUrl').value.trim();
        const folderId = document.getElementById('bookmarkFolder').value;

        if (!title || !url) {
            this.showError('请填写书签标题和URL');
            return;
        }

        try {
            await this.bookmarkManager.createBookmark({
                title,
                url,
                parentId: folderId || undefined
            });

            this.showStatus('书签已保存');
            this.hideBookmarkModal();
            await this.loadBookmarks();
        } catch (error) {
            console.error('Failed to save bookmark:', error);
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
        // 实现状态显示
        console.log('Status:', message);
    }

    /**
     * 显示错误消息
     */
    showError(message) {
        // 实现错误显示
        console.error('Error:', message);
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