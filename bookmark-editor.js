/**
 * vBookmarks Professional Bookmark Editor
 */

class BookmarkEditor {
    constructor() {
        this.bookmarks = [];
        this.metadata = {};
        this.currentSort = { field: 'title', direction: 'asc' };
        this.searchQuery = '';
        this.editingBookmarkId = null;
        this.currentView = 'list'; // 默认改为列表视图
        this.selectedBookmarks = new Set();
        this.loading = false;

        // 分页设置
        this.currentPage = 1;
        this.itemsPerPage = 50; // 每页显示50个书签
        this.totalPages = 1;

        // 工具状态
        this.duplicates = [];
        this.brokenLinks = [];
        this.scanProgress = { total: 0, completed: 0, status: 'idle' };

        this.init();
    }

    async init() {
        await this.loadData();
        this.setupEventListeners();
        this.updateStats();
        this.renderBookmarks();
        this.loadLocalizedStrings();
    }

    /**
     * 加载本地化字符串
     */
    loadLocalizedStrings() {
        try {
            const elements = {
                'totalBookmarksLabel': 'statTitle',
                'totalClicksLabel': 'statTitle',
                'duplicateCountLabel': 'statTitle',
                'brokenLinksLabel': 'statTitle',
                'searchPlaceholder': 'searchInput',
                'addBookmarkBtn': 'addBookmarkBtn'
            };

            Object.keys(elements).forEach(id => {
                const element = document.getElementById(id);
                if (element) {
                    const key = elements[id];
                    const localized = chrome.i18n.getMessage(key);
                    if (localized) {
                        if (element.tagName === 'INPUT') {
                            element.placeholder = localized;
                        } else {
                            element.textContent = localized;
                        }
                    }
                }
            });
        } catch (error) {
            console.warn('Failed to load localized strings:', error);
        }
    }

    async loadData() {
        try {
            this.showLoading(true);

            // 显示加载进度
            this.showLoadingProgress('正在加载书签...');

            // Load bookmarks from Chrome API with performance optimization
            this.bookmarks = await this.getAllBookmarksOptimized();

            // Load metadata from localStorage
            const metadataStr = localStorage.getItem('vbookmarks_metadata');
            this.metadata = metadataStr ? JSON.parse(metadataStr) : {};

            console.log(`Loaded ${this.bookmarks.length} bookmarks with metadata for ${Object.keys(this.metadata).length} items`);

            // 隐藏加载进度
            this.hideLoadingProgress();
        } catch (error) {
            console.error('Failed to load data:', error);
            this.showError('加载数据失败');
            this.hideLoadingProgress();
        } finally {
            this.showLoading(false);
        }
    }

    async getAllBookmarks() {
        return new Promise((resolve, reject) => {
            chrome.bookmarks.getTree((bookmarkTree) => {
                try {
                    const bookmarks = this.extractBookmarks(bookmarkTree);
                    resolve(bookmarks);
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    /**
     * 优化的书签加载方法
     */
    async getAllBookmarksOptimized() {
        return new Promise((resolve, reject) => {
            chrome.bookmarks.getTree((bookmarkTree) => {
                try {
                    const startTime = performance.now();
                    const bookmarks = this.extractBookmarksOptimized(bookmarkTree);
                    const endTime = performance.now();
                    console.log(`Bookmarks extracted in ${endTime - startTime}ms`);
                    resolve(bookmarks);
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    /**
     * 优化的书签提取方法
     */
    extractBookmarksOptimized(bookmarkTree) {
        const bookmarks = [];

        function traverse(node, path = []) {
            if (!node) return;

            const currentPath = Array.isArray(path) ? path : [];

            if (node.url) {
                // 优化：提取所有必要字段，包括BookmarkTreeNode的所有日期字段
                bookmarks.push({
                    id: node.id,
                    title: (node.title || '无标题').trim(),
                    url: node.url.trim(),
                    path: currentPath.filter(p => p && p.trim()).join(' / '),
                    parentId: node.parentId,
                    dateAdded: node.dateAdded || Date.now(),
                    dateGroupModified: node.dateGroupModified || null,
                    dateLastUsed: node.dateLastUsed || null,
                    index: node.index || 0
                });
            } else if (node.children && Array.isArray(node.children)) {
                const folderTitle = (node.title || '无标题文件夹').trim();
                node.children.forEach((child, index) => {
                    traverse(child, [...currentPath, folderTitle]);
                });
            }
        }

        const treeArray = Array.isArray(bookmarkTree) ? bookmarkTree : [bookmarkTree];
        treeArray.forEach(traverse);
        return bookmarks;
    }

    extractBookmarks(bookmarkTree) {
        const bookmarks = [];

        function traverse(node, path = []) {
            if (!node) return;

            // 确保path是数组
            const currentPath = Array.isArray(path) ? path : [];

            if (node.url) {
                // 这是一个书签
                bookmarks.push({
                    id: node.id,
                    title: node.title || '无标题',
                    url: node.url,
                    path: currentPath.filter(p => p && p.trim()).join(' / '),
                    parentId: node.parentId,
                    dateAdded: node.dateAdded || Date.now(),
                    dateGroupModified: node.dateGroupModified || null,
                    dateLastUsed: node.dateLastUsed || null,
                    index: node.index || 0
                });
            } else if (node.children && Array.isArray(node.children)) {
                // 这是一个文件夹
                const folderTitle = node.title || '无标题文件夹';
                node.children.forEach((child, index) => {
                    traverse(child, [...currentPath, folderTitle]);
                });
            }
        }

        // 确保bookmarkTree是数组
        const treeArray = Array.isArray(bookmarkTree) ? bookmarkTree : [bookmarkTree];
        treeArray.forEach(traverse);
        return bookmarks;
    }

    setupEventListeners() {
        // 搜索功能
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', this.debounce((e) => {
                this.searchQuery = e.target.value.toLowerCase();
                this.currentPage = 1; // 搜索时重置到第一页
                this.renderBookmarks();
            }, 300));
        }

        // 视图切换
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.currentView = e.target.dataset.view;
                this.renderBookmarks();
            });
        });

        // 刷新按钮
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.refreshData());
        }

        // 添加书签按钮
        const addBookmarkBtn = document.getElementById('addBookmarkBtn');
        const fabAdd = document.getElementById('fabAdd');
        [addBookmarkBtn, fabAdd].forEach(btn => {
            if (btn) {
                btn.addEventListener('click', () => this.showBookmarkModal());
            }
        });

        // 模态框事件
        const modal = document.getElementById('bookmarkModal');
        const cancelBtn = document.getElementById('cancelBtn');
        const form = document.getElementById('bookmarkForm');

        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.hideBookmarkModal());
        }

        if (form) {
            form.addEventListener('submit', (e) => this.handleBookmarkSubmit(e));
        }

        // 点击模态框外部关闭
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.hideBookmarkModal();
                }
            });
        }

        // 侧边栏导航
        document.querySelectorAll('.nav-item[data-view]').forEach(item => {
            item.addEventListener('click', (e) => {
                document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
                e.target.classList.add('active');
                this.filterView(e.target.dataset.view);
            });
        });

        // 工具按钮
        const findDuplicatesBtn = document.getElementById('find-duplicates');
        if (findDuplicatesBtn) {
            findDuplicatesBtn.addEventListener('click', () => this.findDuplicates());
        }

        const checkLinksBtn = document.getElementById('check-links');
        if (checkLinksBtn) {
            checkLinksBtn.addEventListener('click', () => this.checkLinks());
        }

        const cleanupBtn = document.getElementById('cleanup-tool');
        if (cleanupBtn) {
            cleanupBtn.addEventListener('click', () => this.showCleanupTool());
        }

        const importExportBtn = document.getElementById('import-export');
        if (importExportBtn) {
            importExportBtn.addEventListener('click', () => this.showImportExport());
        }

        // 表格排序
        document.querySelectorAll('.table-header.sortable').forEach(header => {
            header.addEventListener('click', () => this.sortTable(header.dataset.field));
        });
    }

    /**
     * 查找重复书签
     */
    async findDuplicates() {
        try {
            this.showLoading(true);
            const duplicates = {
                url: {},
                title: {},
                combination: {}
            };

            // 按URL分组
            const urlGroups = {};
            this.bookmarks.forEach(bookmark => {
                const normalizedUrl = this.normalizeUrl(bookmark.url);
                if (!urlGroups[normalizedUrl]) {
                    urlGroups[normalizedUrl] = [];
                }
                urlGroups[normalizedUrl].push(bookmark);
            });

            // 按标题分组
            const titleGroups = {};
            this.bookmarks.forEach(bookmark => {
                const normalizedTitle = this.normalizeTitle(bookmark.title);
                if (!titleGroups[normalizedTitle]) {
                    titleGroups[normalizedTitle] = [];
                }
                titleGroups[normalizedTitle].push(bookmark);
            });

            // 找出重复的URL
            Object.keys(urlGroups).forEach(url => {
                if (urlGroups[url].length > 1) {
                    duplicates.url[url] = {
                        type: 'url',
                        value: url,
                        bookmarks: urlGroups[url],
                        count: urlGroups[url].length,
                        severity: this.calculateDuplicateSeverity(urlGroups[url])
                    };
                }
            });

            // 找出重复的标题
            Object.keys(titleGroups).forEach(title => {
                if (titleGroups[title].length > 1) {
                    // 排除已经按URL分组的
                    const uniqueBookmarks = titleGroups[title].filter(bookmark => {
                        const normalizedUrl = this.normalizeUrl(bookmark.url);
                        return urlGroups[normalizedUrl].length === 1;
                    });

                    if (uniqueBookmarks.length > 1) {
                        duplicates.title[title] = {
                            type: 'title',
                            value: title,
                            bookmarks: uniqueBookmarks,
                            count: uniqueBookmarks.length,
                            severity: this.calculateDuplicateSeverity(uniqueBookmarks)
                        };
                    }
                }
            });

            // 找出完全相同的书签（URL+标题都相同）
            const combinationGroups = {};
            this.bookmarks.forEach(bookmark => {
                const normalizedUrl = this.normalizeUrl(bookmark.url);
                const normalizedTitle = this.normalizeTitle(bookmark.title);
                const key = `${normalizedUrl}|${normalizedTitle}`;

                if (!combinationGroups[key]) {
                    combinationGroups[key] = [];
                }
                combinationGroups[key].push(bookmark);
            });

            Object.keys(combinationGroups).forEach(key => {
                if (combinationGroups[key].length > 1) {
                    const [url, title] = key.split('|');
                    duplicates.combination[key] = {
                        type: 'combination',
                        value: { url, title },
                        bookmarks: combinationGroups[key],
                        count: combinationGroups[key].length,
                        severity: 'high' // 完全相同是最严重的重复
                    };
                }
            });

            // 统计总数
            const totalGroups = Object.keys(duplicates.url).length +
                              Object.keys(duplicates.title).length +
                              Object.keys(duplicates.combination).length;
            const totalDuplicates = Object.values(duplicates).reduce((sum, group) => {
                return sum + Object.values(group).reduce((groupSum, item) => groupSum + item.count, 0);
            }, 0);

            this.duplicates = duplicates;
            this.showDuplicatesResults(duplicates, totalGroups, totalDuplicates);
            this.updateStats();
        } catch (error) {
            console.error('Failed to find duplicates:', error);
            this.showError('查找重复书签失败');
        } finally {
            this.showLoading(false);
        }
    }

    /**
     * 显示重复书签结果
     */
    showDuplicatesResults(duplicates, totalGroups, totalDuplicates) {
        if (totalGroups === 0) {
            this.showSuccess('没有发现重复书签');
            return;
        }

        let html = `
            <div class="duplicates-results">
                <div class="results-header">
                    <h3>发现 ${totalGroups} 组重复书签，共 ${totalDuplicates} 个</h3>
                    <div class="results-actions">
                        <button class="btn btn-primary" onclick="bookmarkEditor.selectAllDuplicates()">全选</button>
                        <button class="btn btn-secondary" onclick="bookmarkEditor.deselectAllDuplicates()">取消全选</button>
                        <button class="btn btn-danger" onclick="bookmarkEditor.deleteSelectedDuplicates()">删除选中</button>
                    </div>
                </div>
                <div class="duplicates-tabs">
                    <button class="tab-btn active" data-tab="url">URL重复 (${Object.keys(duplicates.url).length})</button>
                    <button class="tab-btn" data-tab="title">标题重复 (${Object.keys(duplicates.title).length})</button>
                    <button class="tab-btn" data-tab="combination">完全相同 (${Object.keys(duplicates.combination).length})</button>
                </div>
                <div class="duplicates-content">
        `;

        // URL重复
        if (Object.keys(duplicates.url).length > 0) {
            html += `<div class="tab-panel active" data-panel="url">`;
            Object.values(duplicates.url).forEach((group, index) => {
                html += this.createDuplicateGroupHTML(group, 'url', index);
            });
            html += `</div>`;
        }

        // 标题重复
        if (Object.keys(duplicates.title).length > 0) {
            html += `<div class="tab-panel" data-panel="title">`;
            Object.values(duplicates.title).forEach((group, index) => {
                html += this.createDuplicateGroupHTML(group, 'title', index);
            });
            html += `</div>`;
        }

        // 完全相同
        if (Object.keys(duplicates.combination).length > 0) {
            html += `<div class="tab-panel" data-panel="combination">`;
            Object.values(duplicates.combination).forEach((group, index) => {
                html += this.createDuplicateGroupHTML(group, 'combination', index);
            });
            html += `</div>`;
        }

        html += `
                </div>
            </div>
        `;

        const container = document.getElementById('bookmarkGrid');
        if (container) {
            container.innerHTML = html;
            this.attachDuplicateEventListeners();
        }
    }

    /**
     * 创建重复组HTML
     */
    createDuplicateGroupHTML(group, type, index) {
        const typeLabels = {
            url: 'URL重复',
            title: '标题重复',
            combination: '完全相同'
        };

        const severityColors = {
            low: '#10b981',
            medium: '#f59e0b',
            high: '#ef4444'
        };

        const severityLabels = {
            low: '低',
            medium: '中',
            high: '高'
        };

        let value = '';
        if (type === 'url') {
            value = group.value;
        } else if (type === 'title') {
            value = group.value;
        } else if (type === 'combination') {
            value = `${group.value.title} - ${group.value.url}`;
        }

        let html = `
            <div class="duplicate-group" data-severity="${group.severity}">
                <div class="group-header">
                    <div class="group-info">
                        <strong>${typeLabels[type]}:</strong>
                        <span class="group-value" title="${value}">${this.truncateText(value, 80)}</span>
                        <span class="count">(${group.count} 个)</span>
                        <span class="severity" style="color: ${severityColors[group.severity]}">
                            严重程度: ${severityLabels[group.severity]}
                        </span>
                    </div>
                    <div class="group-actions">
                        <button class="btn btn-sm btn-danger" onclick="bookmarkEditor.deleteDuplicateGroup('${type}', ${index})">
                            删除重复项
                        </button>
                        <button class="btn btn-sm" onclick="bookmarkEditor.toggleDuplicateGroup(${index})">
                            展开/收起
                        </button>
                    </div>
                </div>
                <div class="group-bookmarks" id="duplicate-group-${index}">
        `;

        group.bookmarks.forEach((bookmark, bookmarkIndex) => {
            const isOldest = bookmarkIndex === 0; // 假设第一个是最旧的
            const recommendedAction = isOldest ? '保留' : '建议删除';

            html += `
                <div class="duplicate-item ${isOldest ? 'keep' : 'remove'}" data-id="${bookmark.id}">
                    <div class="item-controls">
                        <input type="checkbox" class="bookmark-checkbox" data-id="${bookmark.id}" ${!isOldest ? 'checked' : ''}>
                        <span class="action-recommendation">${recommendedAction}</span>
                    </div>
                    <div class="bookmark-info">
                        <div class="bookmark-title">${bookmark.title}</div>
                            <div class="bookmark-url">${bookmark.url}</div>
                            <div class="bookmark-path">${bookmark.path}</div>
                        </div>
                        <div class="bookmark-actions">
                            <button class="action-btn delete-duplicate" data-id="${bookmark.id}" title="删除">
                                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                `;
            });

            html += `
                    </div>
                    <div class="group-actions">
                        <button class="btn btn-primary" onclick="bookmarkEditor.deleteAllDuplicates(${index})">删除重复项（保留第一个）</button>
                    </div>
                </div>
            `;
        });

        html += `
                </div>
            </div>
        `;

        // 在内容区域显示结果
        const contentArea = document.querySelector('.content-area');
        const resultsDiv = document.createElement('div');
        resultsDiv.className = 'results-container';
        resultsDiv.innerHTML = html;
        contentArea.innerHTML = '';
        contentArea.appendChild(resultsDiv);

        // 添加事件监听器
        resultsDiv.querySelectorAll('.delete-duplicate').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const bookmarkId = e.target.closest('.delete-duplicate').dataset.id;
                this.deleteBookmark(bookmarkId);
            });
        });
    }

    /**
     * 删除所有重复项（保留每个组的第一个）
     */
    async deleteAllDuplicates(groupIndex) {
        if (!this.duplicates[groupIndex]) return;

        const group = this.duplicates[groupIndex];
        const bookmarksToDelete = group.bookmarks.slice(1); // 保留第一个

        if (bookmarksToDelete.length === 0) return;

        if (!confirm(`确定要删除 ${bookmarksToDelete.length} 个重复书签吗？`)) {
            return;
        }

        try {
            this.showLoading(true);

            for (const bookmark of bookmarksToDelete) {
                await this.deleteBookmarkById(bookmark.id);
            }

            this.showSuccess(`成功删除 ${bookmarksToDelete.length} 个重复书签`);
            await this.refreshData();
            this.findDuplicates(); // 重新查找
        } catch (error) {
            console.error('Failed to delete duplicates:', error);
            this.showError('删除重复书签失败');
        } finally {
            this.showLoading(false);
        }
    }

    /**
     * 检查链接可用性
     */
    async checkLinks() {
        try {
            this.showLoading(true);
            this.brokenLinks = [];

            const bookmarksToCheck = [...this.bookmarks];
            this.scanProgress = {
                total: bookmarksToCheck.length,
                completed: 0,
                status: 'scanning'
            };

            // 显示进度
            this.showScanProgress();

            // 分批检查链接，避免同时发送太多请求
            const batchSize = 5;
            for (let i = 0; i < bookmarksToCheck.length; i += batchSize) {
                const batch = bookmarksToCheck.slice(i, i + batchSize);
                await Promise.all(batch.map(bookmark => this.checkLinkStatus(bookmark)));

                this.scanProgress.completed = Math.min(i + batchSize, bookmarksToCheck.length);
                this.updateScanProgress();

                // 添加延迟避免过于频繁的请求
                if (i + batchSize < bookmarksToCheck.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            this.scanProgress.status = 'completed';
            this.updateScanProgress();
            this.showBrokenLinksResults();
            this.updateStats();
        } catch (error) {
            console.error('Failed to check links:', error);
            this.showError('检查链接失败');
        } finally {
            this.showLoading(false);
        }
    }

    /**
     * 检查单个链接状态
     */
    async checkLinkStatus(bookmark) {
        try {
            // 使用 fetch API 检查链接
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

            const response = await fetch(bookmark.url, {
                method: 'HEAD',
                signal: controller.signal,
                mode: 'no-cors'
            });

            clearTimeout(timeoutId);

            // 如果状态码不是2xx，认为是失效链接
            if (!response.ok || response.status >= 400) {
                this.brokenLinks.push({
                    ...bookmark,
                    status: response.status,
                    statusText: response.statusText || 'Unknown Error'
                });
            }
        } catch (error) {
            // 任何错误都认为是失效链接
            this.brokenLinks.push({
                ...bookmark,
                error: error.message,
                status: 0
            });
        }
    }

    /**
     * 显示扫描进度
     */
    showScanProgress() {
        const contentArea = document.querySelector('.content-area');
        const progressHtml = `
            <div class="scan-progress">
                <h3>正在检查链接...</h3>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: 0%"></div>
                </div>
                <div class="progress-text">
                    <span class="progress-completed">0</span> / <span class="progress-total">${this.scanProgress.total}</span>
                </div>
            </div>
        `;

        contentArea.innerHTML = progressHtml;
    }

    /**
     * 更新扫描进度
     */
    updateScanProgress() {
        const progressFill = document.querySelector('.progress-fill');
        const progressCompleted = document.querySelector('.progress-completed');

        if (progressFill) {
            const percentage = (this.scanProgress.completed / this.scanProgress.total) * 100;
            progressFill.style.width = `${percentage}%`;
        }

        if (progressCompleted) {
            progressCompleted.textContent = this.scanProgress.completed;
        }

        if (this.scanProgress.status === 'completed') {
            setTimeout(() => this.showBrokenLinksResults(), 1000);
        }
    }

    /**
     * 显示失效链接结果
     */
    showBrokenLinksResults() {
        if (this.brokenLinks.length === 0) {
            this.showSuccess('所有链接都正常');
            this.renderBookmarks();
            return;
        }

        let html = `
            <div class="broken-links-results">
                <h3>发现 ${this.brokenLinks.length} 个失效链接</h3>
                <div class="broken-links-list">
        `;

        this.brokenLinks.forEach(link => {
            html += `
                <div class="broken-link-item">
                    <div class="link-info">
                        <div class="link-title">${link.title}</div>
                        <div class="link-url">${link.url}</div>
                        <div class="link-status">
                            状态: ${link.status || 'Error'} ${link.statusText || link.error || ''}
                        </div>
                        <div class="link-path">${link.path}</div>
                    </div>
                    <div class="link-actions">
                        <button class="action-btn edit-link" data-id="${link.id}" title="编辑">
                            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                        <button class="action-btn delete-link" data-id="${link.id}" title="删除">
                            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                    </div>
                </div>
            `;
        });

        html += `
                </div>
                <div class="results-actions">
                    <button class="btn btn-primary" onclick="bookmarkEditor.deleteAllBrokenLinks()">删除所有失效链接</button>
                    <button class="btn" onclick="bookmarkEditor.renderBookmarks()">返回书签列表</button>
                </div>
            </div>
        `;

        const contentArea = document.querySelector('.content-area');
        contentArea.innerHTML = html;

        // 添加事件监听器
        contentArea.querySelectorAll('.edit-link').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const bookmarkId = e.target.closest('.edit-link').dataset.id;
                this.editBookmark(bookmarkId);
            });
        });

        contentArea.querySelectorAll('.delete-link').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const bookmarkId = e.target.closest('.delete-link').dataset.id;
                this.deleteBookmark(bookmarkId);
            });
        });
    }

    /**
     * 删除所有失效链接
     */
    async deleteAllBrokenLinks() {
        if (this.brokenLinks.length === 0) return;

        if (!confirm(`确定要删除所有 ${this.brokenLinks.length} 个失效链接吗？`)) {
            return;
        }

        try {
            this.showLoading(true);

            for (const link of this.brokenLinks) {
                await this.deleteBookmarkById(link.id);
            }

            this.showSuccess(`成功删除 ${this.brokenLinks.length} 个失效链接`);
            this.brokenLinks = [];
            await this.refreshData();
        } catch (error) {
            console.error('Failed to delete broken links:', error);
            this.showError('删除失效链接失败');
        } finally {
            this.showLoading(false);
        }
    }

    /**
     * 显示清理工具
     */
    showCleanupTool() {
        const contentArea = document.querySelector('.content-area');
        const html = `
            <div class="cleanup-tool">
                <h3>清理工具</h3>
                <div class="cleanup-options">
                    <div class="cleanup-section">
                        <h4>清理选项</h4>
                        <div class="cleanup-item">
                            <label>
                                <input type="checkbox" id="cleanupEmptyTitles" checked>
                                清理空标题书签
                            </label>
                            <span class="cleanup-count">(${this.bookmarks.filter(b => !b.title || b.title.trim() === '').length} 个)</span>
                        </div>
                        <div class="cleanup-item">
                            <label>
                                <input type="checkbox" id="cleanupInvalidUrls" checked>
                                清理无效URL书签
                            </label>
                            <span class="cleanup-count">(${this.bookmarks.filter(b => !this.isValidUrl(b.url)).length} 个)</span>
                        </div>
                        <div class="cleanup-item">
                            <label>
                                <input type="checkbox" id="cleanupNoClicks">
                                清理从未点击的书签
                            </label>
                            <span class="cleanup-count">(${this.bookmarks.filter(b => !this.metadata[b.id] || this.metadata[b.id].clickCount === 0).length} 个)</span>
                        </div>
                    </div>
                </div>
                <div class="cleanup-actions">
                    <button class="btn btn-primary" onclick="bookmarkEditor.executeCleanup()">执行清理</button>
                    <button class="btn" onclick="bookmarkEditor.renderBookmarks()">取消</button>
                </div>
            </div>
        `;

        contentArea.innerHTML = html;
    }

    /**
     * 执行清理
     */
    async executeCleanup() {
        const cleanEmptyTitles = document.getElementById('cleanupEmptyTitles')?.checked || false;
        const cleanInvalidUrls = document.getElementById('cleanupInvalidUrls')?.checked || false;
        const cleanNoClicks = document.getElementById('cleanupNoClicks')?.checked || false;

        const toDelete = [];

        this.bookmarks.forEach(bookmark => {
            if (cleanEmptyTitles && (!bookmark.title || bookmark.title.trim() === '')) {
                toDelete.push(bookmark);
            }
            if (cleanInvalidUrls && !this.isValidUrl(bookmark.url)) {
                toDelete.push(bookmark);
            }
            if (cleanNoClicks && (!this.metadata[bookmark.id] || this.metadata[bookmark.id].clickCount === 0)) {
                toDelete.push(bookmark);
            }
        });

        if (toDelete.length === 0) {
            this.showInfo('没有需要清理的书签');
            return;
        }

        if (!confirm(`确定要清理 ${toDelete.length} 个书签吗？`)) {
            return;
        }

        try {
            this.showLoading(true);

            for (const bookmark of toDelete) {
                await this.deleteBookmarkById(bookmark.id);
            }

            this.showSuccess(`成功清理 ${toDelete.length} 个书签`);
            await this.refreshData();
        } catch (error) {
            console.error('Failed to cleanup:', error);
            this.showError('清理失败');
        } finally {
            this.showLoading(false);
        }
    }

    /**
     * 显示导入/导出工具
     */
    showImportExport() {
        const contentArea = document.querySelector('.content-area');
        const html = `
            <div class="import-export-tool">
                <h3>导入/导出</h3>
                <div class="import-export-sections">
                    <div class="export-section">
                        <h4>导出书签</h4>
                        <p>导出所有书签为 JSON 格式</p>
                        <button class="btn btn-primary" onclick="bookmarkEditor.exportBookmarks()">导出书签</button>
                    </div>
                    <div class="import-section">
                        <h4>导入书签</h4>
                        <p>从 JSON 文件导入书签</p>
                        <input type="file" id="importFile" accept=".json" style="display: none;">
                        <button class="btn" onclick="document.getElementById('importFile').click()">选择文件</button>
                    </div>
                    <div class="metadata-section">
                        <h4>元数据</h4>
                        <p>导出/导入点击统计等元数据</p>
                        <button class="btn" onclick="bookmarkEditor.exportMetadata()">导出元数据</button>
                        <button class="btn" onclick="bookmarkEditor.showImportMetadata()">导入元数据</button>
                    </div>
                </div>
            </div>
        `;

        contentArea.innerHTML = html;

        // 设置文件导入监听器
        const importFile = document.getElementById('importFile');
        if (importFile) {
            importFile.addEventListener('change', (e) => this.handleImportFile(e));
        }
    }

    /**
     * 导出书签
     */
    exportBookmarks() {
        const exportData = {
            bookmarks: this.bookmarks,
            metadata: this.metadata,
            exportDate: new Date().toISOString(),
            version: '1.0'
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `vbookmarks-export-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);

        this.showSuccess('书签已导出');
    }

    /**
     * 导出元数据
     */
    exportMetadata() {
        const blob = new Blob([JSON.stringify(this.metadata, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `vbookmarks-metadata-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);

        this.showSuccess('元数据已导出');
    }

    /**
     * 处理导入文件
     */
    async handleImportFile(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const data = JSON.parse(text);

            if (data.bookmarks && Array.isArray(data.bookmarks)) {
                if (!confirm(`确定要导入 ${data.bookmarks.length} 个书签吗？`)) {
                    return;
                }

                this.showLoading(true);

                // 这里可以实现导入逻辑
                // 由于Chrome API的限制，需要逐个创建书签
                this.showInfo('导入功能正在开发中');
            } else {
                this.showError('无效的导入文件格式');
            }
        } catch (error) {
            console.error('Failed to import:', error);
            this.showError('导入失败');
        } finally {
            this.showLoading(false);
            event.target.value = '';
        }
    }

    /**
     * 验证URL格式
     */
    isValidUrl(url) {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 刷新数据
     */
    async refreshData() {
        await this.loadData();
        this.updateStats();
        this.renderBookmarks();
    }

    /**
     * 更新统计信息
     */
    updateStats() {
        const totalBookmarks = this.bookmarks.length;
        const totalClicks = Object.values(this.metadata).reduce((sum, meta) => sum + (meta.clickCount || 0), 0);
        const duplicateCount = this.duplicates.length > 0 ?
            this.duplicates.reduce((sum, group) => sum + group.count - 1, 0) : 0;
        const brokenLinksCount = this.brokenLinks.length;

        this.updateStatValue('totalBookmarks', totalBookmarks);
        this.updateStatValue('totalClicks', totalClicks);
        this.updateStatValue('duplicateCount', duplicateCount || '-');
        this.updateStatValue('brokenLinks', brokenLinksCount || '-');
    }

    /**
     * 更新统计数值
     */
    updateStatValue(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = typeof value === 'number' ? value.toLocaleString() : value;
        }
    }

    /**
     * 渲染书签列表
     */
    renderBookmarks() {
        const container = document.getElementById('bookmarkGrid');
        const emptyState = document.getElementById('emptyState');

        if (!container) return;

        // 根据当前视图类型渲染
        if (this.currentView === 'folders') {
            this.renderFolders();
            return;
        }

        // 更新分页信息
        this.updatePagination();

        let currentPageBookmarks = this.getCurrentPageBookmarks();

        if (currentPageBookmarks.length === 0) {
            container.style.display = 'none';
            if (emptyState) emptyState.style.display = 'block';
            return;
        }

        container.style.display = 'block';
        if (emptyState) emptyState.style.display = 'none';

        // 根据视图类型渲染
        if (this.currentView === 'grid') {
            container.className = 'bookmark-list compact';
            container.innerHTML = currentPageBookmarks.map(bookmark => this.createBookmarkListItem(bookmark)).join('');
        } else {
            container.className = 'bookmark-table';
            container.innerHTML = this.createBookmarkTable(currentPageBookmarks);
        }

        // 渲染分页控件
        this.renderPagination();

        // 添加事件监听器
        this.attachBookmarkEventListeners();
    }

    /**
     * 渲染文件夹视图
     */
    renderFolders() {
        const container = document.getElementById('bookmarkGrid');
        const emptyState = document.getElementById('emptyState');

        if (!container) return;

        // 获取文件夹列表
        const folders = this.extractFolders(this.bookmarkTree);

        if (folders.length === 0) {
            container.style.display = 'none';
            if (emptyState) emptyState.style.display = 'block';
            return;
        }

        container.style.display = 'block';
        if (emptyState) emptyState.style.display = 'none';

        // 使用文件夹视图样式
        container.className = 'folder-view';
        container.innerHTML = this.createFolderList(folders);

        // 添加文件夹事件监听器
        this.attachFolderEventListeners();
    }

    /**
     * 创建文件夹列表
     */
    createFolderList(folders) {
        let html = `
            <div class="folder-list-header">
                <div class="folder-count">共 ${folders.length} 个文件夹</div>
                <div class="folder-actions">
                    <button class="btn btn-sm" onclick="bookmarkEditor.expandAllFolders()">展开全部</button>
                    <button class="btn btn-sm" onclick="bookmarkEditor.collapseAllFolders()">收起全部</button>
                </div>
            </div>
            <div class="folder-list">
        `;

        folders.forEach(folder => {
            const bookmarkCount = folder.children ? folder.children.filter(child => child.url).length : 0;
            const subfolderCount = folder.children ? folder.children.filter(child => !child.url).length : 0;

            html += `
                <div class="folder-item" data-id="${folder.id}" data-path="${folder.path}">
                    <div class="folder-header">
                        <div class="folder-toggle">
                            <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path d="M9 5l7 7-7 7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </div>
                        <div class="folder-icon">
                            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </div>
                        <div class="folder-info">
                            <div class="folder-title">${folder.title}</div>
                            <div class="folder-path">${folder.path}</div>
                        </div>
                        <div class="folder-stats">
                            ${bookmarkCount > 0 ? `<span class="stat-item bookmarks">${bookmarkCount} 书签</span>` : ''}
                            ${subfolderCount > 0 ? `<span class="stat-item subfolders">${subfolderCount} 子文件夹</span>` : ''}
                        </div>
                        <div class="folder-actions">
                            <button class="action-btn" onclick="bookmarkEditor.openFolder('${folder.id}')" title="打开文件夹">
                                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </button>
                            <button class="action-btn" onclick="bookmarkEditor.editFolder('${folder.id}')" title="编辑">
                                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                    <div class="folder-content" style="display: none;">
                        <!-- 文件夹内容将在展开时动态加载 -->
                    </div>
                </div>
            `;
        });

        html += `
            </div>
        `;

        return html;
    }

    /**
     * 添加文件夹事件监听器
     */
    attachFolderEventListeners() {
        document.querySelectorAll('.folder-header').forEach(header => {
            header.addEventListener('click', (e) => {
                // 如果点击的是按钮，不触发折叠/展开
                if (e.target.closest('.folder-actions')) return;

                const folderItem = header.closest('.folder-item');
                const content = folderItem.querySelector('.folder-content');
                const toggle = header.querySelector('.folder-toggle svg');

                if (content.style.display === 'none') {
                    content.style.display = 'block';
                    toggle.style.transform = 'rotate(90deg)';
                    this.loadFolderContent(folderItem.dataset.id, content);
                } else {
                    content.style.display = 'none';
                    toggle.style.transform = 'rotate(0deg)';
                }
            });
        });
    }

    /**
     * 加载文件夹内容
     */
    loadFolderContent(folderId, container) {
        chrome.bookmarks.getChildren(folderId, (children) => {
            const bookmarks = children.filter(child => child.url);
            const subfolders = children.filter(child => !child.url);

            let html = '';

            if (subfolders.length > 0) {
                html += '<div class="subfolder-section">';
                html += '<div class="section-title">子文件夹</div>';
                subfolders.forEach(folder => {
                    html += `
                        <div class="subfolder-item">
                            <div class="subfolder-icon">
                                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </div>
                            <div class="subfolder-info">
                                <div class="subfolder-title">${folder.title}</div>
                            </div>
                        </div>
                    `;
                });
                html += '</div>';
            }

            if (bookmarks.length > 0) {
                html += '<div class="bookmark-section">';
                html += '<div class="section-title">书签</div>';
                bookmarks.slice(0, 10).forEach(bookmark => {
                    const metadata = this.metadata[bookmark.id] || {};
                    const clickCount = metadata.clickCount || 0;

                    html += `
                        <div class="folder-bookmark-item">
                            <img class="bookmark-favicon" src="${this.getFaviconUrl(bookmark.url)}" alt="" loading="lazy">
                            <div class="bookmark-info">
                                <div class="bookmark-title">${bookmark.title}</div>
                                <div class="bookmark-url">${this.truncateUrl(bookmark.url, 40)}</div>
                            </div>
                            ${clickCount > 0 ? `<span class="meta-tag clicks">${clickCount}</span>` : ''}
                        </div>
                    `;
                });

                if (bookmarks.length > 10) {
                    html += `<div class="more-bookmarks">还有 ${bookmarks.length - 10} 个书签...</div>`;
                }
                html += '</div>';
            }

            container.innerHTML = html;
        });
    }

    /**
     * 打开文件夹
     */
    openFolder(folderId) {
        chrome.bookmarks.getChildren(folderId, (children) => {
            const bookmarks = children.filter(child => child.url);
            if (bookmarks.length > 0) {
                // 在新标签页中打开文件夹中的所有书签
                bookmarks.forEach(bookmark => {
                    chrome.tabs.create({ url: bookmark.url });
                });
            }
        });
    }

    /**
     * 编辑文件夹
     */
    editFolder(folderId) {
        chrome.bookmarks.get(folderId, (folder) => {
            if (folder && folder.length > 0) {
                const newTitle = prompt('编辑文件夹名称:', folder[0].title);
                if (newTitle && newTitle !== folder[0].title) {
                    chrome.bookmarks.update(folderId, { title: newTitle }, () => {
                        this.refreshData();
                    });
                }
            }
        });
    }

    /**
     * 展开所有文件夹
     */
    expandAllFolders() {
        document.querySelectorAll('.folder-content').forEach(content => {
            content.style.display = 'block';
        });
        document.querySelectorAll('.folder-toggle svg').forEach(toggle => {
            toggle.style.transform = 'rotate(90deg)';
        });
    }

    /**
     * 收起所有文件夹
     */
    collapseAllFolders() {
        document.querySelectorAll('.folder-content').forEach(content => {
            content.style.display = 'none';
        });
        document.querySelectorAll('.folder-toggle svg').forEach(toggle => {
            toggle.style.transform = 'rotate(0deg)';
        });
    }

    /**
     * 过滤书签
     */
    filterBookmarks() {
        let filtered = [...this.bookmarks];

        // 搜索过滤
        if (this.searchQuery) {
            filtered = filtered.filter(bookmark =>
                bookmark.title.toLowerCase().includes(this.searchQuery) ||
                bookmark.url.toLowerCase().includes(this.searchQuery) ||
                bookmark.path.toLowerCase().includes(this.searchQuery)
            );
        }

        return filtered;
    }

    /**
     * 排序书签
     */
    sortBookmarks(bookmarks) {
        return bookmarks.sort((a, b) => {
            let aValue = a[this.currentSort.field];
            let bValue = b[this.currentSort.field];

            // 处理元数据字段和BookmarkTreeNode日期字段
            if (this.currentSort.field === 'clicks') {
                aValue = this.metadata[a.id]?.clickCount || 0;
                bValue = this.metadata[b.id]?.clickCount || 0;
            } else if (this.currentSort.field === 'dateAdded') {
                // 使用BookmarkTreeNode的dateAdded字段
                aValue = a.dateAdded || Date.now();
                bValue = b.dateAdded || Date.now();
            } else if (this.currentSort.field === 'lastAccessed') {
                // 优先使用BookmarkTreeNode的dateLastUsed，其次使用元数据
                aValue = a.dateLastUsed || this.metadata[a.id]?.lastAccessed || 0;
                bValue = b.dateLastUsed || this.metadata[b.id]?.lastAccessed || 0;
            } else if (this.currentSort.field === 'dateGroupModified') {
                // 使用BookmarkTreeNode的dateGroupModified字段
                aValue = a.dateGroupModified || 0;
                bValue = b.dateGroupModified || 0;
            }

            // 处理null/undefined值
            if (aValue == null) aValue = this.currentSort.direction === 'asc' ? Infinity : -Infinity;
            if (bValue == null) bValue = this.currentSort.direction === 'asc' ? Infinity : -Infinity;

            // 字符串比较
            if (typeof aValue === 'string' && typeof bValue === 'string') {
                aValue = aValue.toLowerCase();
                bValue = bValue.toLowerCase();
            }

            // 数字比较
            if (typeof aValue === 'number' && typeof bValue === 'number') {
                if (aValue < bValue) return this.currentSort.direction === 'asc' ? -1 : 1;
                if (aValue > bValue) return this.currentSort.direction === 'asc' ? 1 : -1;
                return 0;
            }

            // 默认比较
            if (aValue < bValue) return this.currentSort.direction === 'asc' ? -1 : 1;
            if (aValue > bValue) return this.currentSort.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }

    /**
     * 创建紧凑列表项
     */
    createBookmarkListItem(bookmark) {
        const metadata = this.metadata[bookmark.id] || {};
        const clickCount = metadata.clickCount || 0;
        const addedDate = bookmark.dateAdded ? new Date(bookmark.dateAdded) : null;
        const lastAccessed = bookmark.dateLastUsed ? new Date(bookmark.dateLastUsed) : (metadata.lastAccessed ? new Date(metadata.lastAccessed) : null);
        const groupModified = bookmark.dateGroupModified ? new Date(bookmark.dateGroupModified) : null;

        // 根据排序字段显示不同的元信息
        let metadataHTML = '';

        if (this.currentSort.field === 'clicks') {
            // 按点击次数排序：显示点击次数、路径
            metadataHTML = `
                ${clickCount > 0 ? `<span class="meta-tag clicks" title="点击次数: ${clickCount}">${clickCount}</span>` : '<span class="meta-tag clicks">0</span>'}
                ${bookmark.path ? `<span class="meta-tag path" title="路径: ${bookmark.path}">${this.truncatePath(bookmark.path, 30)}</span>` : ''}
            `;
        } else if (this.currentSort.field === 'dateAdded') {
            // 按添加日期排序：显示添加日期、路径
            metadataHTML = `
                ${addedDate ? `<span class="meta-tag date" title="添加日期: ${this.formatDate(addedDate)}">${this.getCompactDate(addedDate)}</span>` : '<span class="meta-tag date">未知</span>'}
                ${bookmark.path ? `<span class="meta-tag path" title="路径: ${bookmark.path}">${this.truncatePath(bookmark.path, 30)}</span>` : ''}
            `;
        } else if (this.currentSort.field === 'lastAccessed') {
            // 按最近访问排序：显示最近访问日期、路径
            metadataHTML = `
                ${lastAccessed ? `<span class="meta-tag accessed" title="访问日期: ${this.formatDate(lastAccessed)}">${this.getCompactDate(lastAccessed)}</span>` : '<span class="meta-tag accessed">从未</span>'}
                ${bookmark.path ? `<span class="meta-tag path" title="路径: ${bookmark.path}">${this.truncatePath(bookmark.path, 30)}</span>` : ''}
            `;
        } else if (this.currentSort.field === 'dateGroupModified') {
            // 按组修改日期排序：显示组修改日期、路径
            metadataHTML = `
                ${groupModified ? `<span class="meta-tag modified" title="修改日期: ${this.formatDate(groupModified)}">${this.getCompactDate(groupModified)}</span>` : '<span class="meta-tag modified">未知</span>'}
                ${bookmark.path ? `<span class="meta-tag path" title="路径: ${bookmark.path}">${this.truncatePath(bookmark.path, 30)}</span>` : ''}
            `;
        } else {
            // 其他排序：显示基本元信息
            metadataHTML = `
                ${clickCount > 0 ? `<span class="meta-tag clicks" title="点击次数: ${clickCount}">${clickCount}</span>` : ''}
                ${addedDate ? `<span class="meta-tag date" title="添加日期: ${this.formatDate(addedDate)}">${this.getCompactDate(addedDate)}</span>` : ''}
            `;
        }

        return `
            <div class="bookmark-list-item" data-id="${bookmark.id}">
                <div class="bookmark-list-content">
                    <img class="bookmark-favicon" src="${this.getFaviconUrl(bookmark.url)}" alt="" loading="lazy">
                    <div class="bookmark-info">
                        <div class="bookmark-title" title="${bookmark.title}">${bookmark.title}</div>
                        <div class="bookmark-url" title="${bookmark.url}">${this.truncateUrl(bookmark.url, 60)}</div>
                        ${bookmark.path && !this.currentSort.field.match(/(clicks|dateAdded|lastAccessed|dateGroupModified)/) ? `<div class="bookmark-path" title="${bookmark.path}">${bookmark.path}</div>` : ''}
                    </div>
                    <div class="bookmark-meta">
                        ${metadataHTML}
                    </div>
                </div>
                <div class="bookmark-actions">
                    <button class="action-btn" onclick="bookmarkEditor.openBookmark('${bookmark.url}')" title="打开">
                        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                    <button class="action-btn" onclick="bookmarkEditor.editBookmark('${bookmark.id}')" title="编辑">
                        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                    <button class="action-btn" onclick="bookmarkEditor.deleteBookmark('${bookmark.id}')" title="删除">
                        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * 创建书签卡片（保留用于向后兼容）
     */
    createBookmarkCard(bookmark) {
        return this.createBookmarkListItem(bookmark);
    }

    /**
     * 创建书签表格
     */
    createBookmarkTable(bookmarks) {
        let html = `
            <div class="table-header">
                <div class="checkbox"></div>
                <div class="sortable" data-field="title">标题</div>
                <div class="sortable" data-field="url">URL</div>
                <div class="sortable hidden-mobile" data-field="clicks">点击次数</div>
                <div class="sortable hidden-mobile" data-field="dateAdded">添加日期</div>
                <div class="sortable hidden-mobile" data-field="lastAccessed">最后访问</div>
                <div>操作</div>
            </div>
        `;

        bookmarks.forEach(bookmark => {
            const metadata = this.metadata[bookmark.id] || {};
            html += this.createTableRow(bookmark, metadata);
        });

        return html;
    }

    /**
     * 创建表格行
     */
    createTableRow(bookmark, metadata) {
        const clickCount = metadata.clickCount || 0;
        const addedDate = bookmark.dateAdded ? new Date(bookmark.dateAdded) : null;
        const lastAccessed = bookmark.dateLastUsed ? new Date(bookmark.dateLastUsed) : (metadata.lastAccessed ? new Date(metadata.lastAccessed) : null);

        return `
            <div class="table-row" data-id="${bookmark.id}">
                <div class="checkbox" onclick="bookmarkEditor.toggleBookmarkSelection('${bookmark.id}')"></div>
                <div>
                    <img class="bookmark-favicon" src="${this.getFaviconUrl(bookmark.url)}" alt="" style="width: 16px; height: 16px; margin-right: 8px;">
                    <span title="${bookmark.title}">${bookmark.title}</span>
                </div>
                <div class="hidden-mobile" title="${bookmark.url}">${this.truncateUrl(bookmark.url)}</div>
                <div class="hidden-mobile">
                    <span class="meta-tag clicks" title="点击次数: ${clickCount}">${clickCount}</span>
                </div>
                <div class="hidden-mobile" title="${addedDate ? this.formatDateFull(addedDate) : '未知'}">${addedDate ? this.formatDate(addedDate) : '-'}</div>
                <div class="hidden-mobile" title="${lastAccessed ? this.formatDateFull(lastAccessed) : '从未访问'}">${lastAccessed ? this.formatDate(lastAccessed) : '-'}</div>
                <div>
                    <button class="action-btn" onclick="bookmarkEditor.editBookmark('${bookmark.id}')" title="编辑">
                        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                    <button class="action-btn" onclick="bookmarkEditor.deleteBookmark('${bookmark.id}')" title="删除">
                        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * 添加书签事件监听器
     */
    attachBookmarkEventListeners() {
        document.querySelectorAll('.bookmark-card').forEach(card => {
            card.addEventListener('click', (e) => {
                // 如果点击的是按钮，不触发卡片点击事件
                if (e.target.closest('.bookmark-actions')) return;

                const bookmarkId = card.dataset.id;
                this.openBookmark(this.bookmarks.find(b => b.id === bookmarkId)?.url);
            });
        });
    }

    /**
     * 打开书签
     */
    openBookmark(url) {
        if (!url) return;

        // 记录点击
        this.recordClick(url);

        chrome.tabs.create({ url });
    }

    /**
     * 记录点击
     */
    recordClick(url) {
        const bookmark = this.bookmarks.find(b => b.url === url);
        if (!bookmark) return;

        if (!this.metadata[bookmark.id]) {
            this.metadata[bookmark.id] = {};
        }

        this.metadata[bookmark.id].clickCount = (this.metadata[bookmark.id].clickCount || 0) + 1;
        this.metadata[bookmark.id].lastAccessed = new Date().toISOString();

        localStorage.setItem('vbookmarks_metadata', JSON.stringify(this.metadata));
    }

    /**
     * 显示书签模态框
     */
    showBookmarkModal(bookmark = null) {
        const modal = document.getElementById('bookmarkModal');
        const modalTitle = document.getElementById('modalTitle');
        const form = document.getElementById('bookmarkForm');

        if (!modal || !form) return;

        this.editingBookmarkId = bookmark ? bookmark.id : null;
        modalTitle.textContent = bookmark ? '编辑书签' : '添加书签';

        if (bookmark) {
            document.getElementById('bookmarkTitle').value = bookmark.title || '';
            document.getElementById('bookmarkUrl').value = bookmark.url || '';
            // 设置文件夹选择器
            this.populateFolderSelector(bookmark.parentId);
        } else {
            form.reset();
            // 设置当前标签页URL
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0] && tabs[0].url) {
                    document.getElementById('bookmarkUrl').value = tabs[0].url;
                    document.getElementById('bookmarkTitle').value = tabs[0].title || '';
                }
            });
            this.populateFolderSelector();
        }

        // 确保模态框能正确显示
        modal.style.display = 'flex';
        modal.classList.add('active');
    }

    /**
     * 隐藏书签模态框
     */
    hideBookmarkModal() {
        const modal = document.getElementById('bookmarkModal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('active');
        }
        this.editingBookmarkId = null;
    }

    /**
     * 填充文件夹选择器
     */
    async populateFolderSelector(selectedId = null) {
        const selector = document.getElementById('bookmarkFolder');
        if (!selector) return;

        try {
            const tree = await new Promise(resolve => chrome.bookmarks.getTree(resolve));
            const folders = this.extractFolders(tree);

            selector.innerHTML = '<option value="">选择文件夹</option>';
            folders.forEach(folder => {
                const option = document.createElement('option');
                option.value = folder.id;
                option.textContent = folder.path;
                option.selected = folder.id === selectedId;
                selector.appendChild(option);
            });
        } catch (error) {
            console.error('Failed to populate folders:', error);
        }
    }

    /**
     * 提取文件夹
     */
    extractFolders(bookmarkTree, path = []) {
        const folders = [];

        function traverse(node) {
            if (!node.url && node.id !== '0') {
                // 这是一个文件夹
                const folderPath = [...path, node.title].filter(Boolean).join(' / ');
                folders.push({
                    id: node.id,
                    title: node.title,
                    path: folderPath || '书签栏'
                });
            }

            if (node.children) {
                node.children.forEach(child => {
                    traverse(child, [...path, node.title]);
                });
            }
        }

        bookmarkTree.forEach(traverse);
        return folders;
    }

    /**
     * 处理书签表单提交
     */
    async handleBookmarkSubmit(event) {
        event.preventDefault();

        const title = document.getElementById('bookmarkTitle').value.trim();
        const url = document.getElementById('bookmarkUrl').value.trim();
        const parentId = document.getElementById('bookmarkFolder').value;

        if (!title || !url) {
            this.showError('请填写标题和URL');
            return;
        }

        try {
            this.showLoading(true);

            if (this.editingBookmarkId) {
                // 编辑现有书签
                await this.updateBookmark(this.editingBookmarkId, { title, url });
                this.showSuccess('书签已更新');
            } else {
                // 创建新书签
                await this.createBookmark({ title, url, parentId });
                this.showSuccess('书签已添加');
            }

            this.hideBookmarkModal();
            await this.refreshData();
        } catch (error) {
            console.error('Failed to save bookmark:', error);
            this.showError('保存书签失败');
        } finally {
            this.showLoading(false);
        }
    }

    /**
     * 创建书签
     */
    async createBookmark(bookmarkData) {
        return new Promise((resolve, reject) => {
            chrome.bookmarks.create(bookmarkData, (bookmark) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(bookmark);
                }
            });
        });
    }

    /**
     * 更新书签
     */
    async updateBookmark(id, changes) {
        return new Promise((resolve, reject) => {
            chrome.bookmarks.update(id, changes, (bookmark) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(bookmark);
                }
            });
        });
    }

    /**
     * 编辑书签
     */
    editBookmark(id) {
        const bookmark = this.bookmarks.find(b => b.id === id);
        if (bookmark) {
            this.showBookmarkModal(bookmark);
        }
    }

    /**
     * 删除书签
     */
    async deleteBookmark(id) {
        if (!confirm('确定要删除这个书签吗？')) {
            return;
        }

        try {
            await this.deleteBookmarkById(id);
            this.showSuccess('书签已删除');
            await this.refreshData();
        } catch (error) {
            console.error('Failed to delete bookmark:', error);
            this.showError('删除书签失败');
        }
    }

    /**
     * 通过ID删除书签
     */
    async deleteBookmarkById(id) {
        return new Promise((resolve, reject) => {
            chrome.bookmarks.remove(id, () => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    // 清理元数据
                    if (this.metadata[id]) {
                        delete this.metadata[id];
                        localStorage.setItem('vbookmarks_metadata', JSON.stringify(this.metadata));
                    }
                    resolve();
                }
            });
        });
    }

    /**
     * 获取favicon URL
     */
    getFaviconUrl(url) {
        try {
            const domain = new URL(url).hostname;
            // 使用 Chrome 内置 favicon 服务，符合 CSP 策略
            return `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=16`;
        } catch {
            return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiByeD0iMiIgZmlsbD0iI0Y0RjRGNCIvPgo8cGF0aCBkPSJNOCAxMkM5LjEwNDU3IDEyIDEwIDExLjEwNDU3IDEwIDEwQzEwIDguODk1NDMgOS4xMDQ1NyA4IDggOEM2Ljg5NTQzIDggNiA4Ljg5NTQzIDYgMTBDNiAxMS4xMDQ1NyA2Ljg5NTQzIDEyIDggMTJaIiBmaWxsPSIjOTk5Ii8+Cjwvc3ZnPgo=';
        }
    }

    /**
     * 预加载favicon以避免控制台错误
     */
    preloadFavicon(url) {
        const img = new Image();
        img.onload = () => {
            // 成功加载，不做任何操作
        };
        img.onerror = () => {
            // 加载失败时静默处理，不在控制台显示错误
            console.debug('Favicon failed to load:', url);
        };
        img.src = url;
    }

    /**
     * 格式化日期（相对时间）
     */
    formatDate(date) {
        const now = new Date();
        const diff = now - date;
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (days === 0) return '今天';
        if (days === 1) return '昨天';
        if (days < 7) return `${days}天前`;
        if (days < 30) return `${Math.floor(days / 7)}周前`;
        if (days < 365) return `${Math.floor(days / 30)}个月前`;
        return `${Math.floor(days / 365)}年前`;
    }

    /**
     * 格式化日期（完整格式）
     */
    formatDateFull(date) {
        return date.toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    /**
     * 获取紧凑日期格式
     */
    getCompactDate(date) {
        const now = new Date();
        const diff = now - date;
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (days === 0) return '今天';
        if (days === 1) return '昨天';
        if (days < 7) return `${days}天前`;
        if (days < 30) return `${Math.floor(days / 7)}周前`;
        if (days < 365) return `${Math.floor(days / 30)}个月前`;
        return `${Math.floor(days / 365)}年前`;
    }

    /**
     * 截断URL
     */
    truncateUrl(url, maxLength = 40) {
        if (url.length <= maxLength) return url;
        return url.substring(0, maxLength) + '...';
    }

    /**
     * 截断路径
     */
    truncatePath(path, maxLength = 30) {
        if (path.length <= maxLength) return path;
        return path.substring(0, maxLength) + '...';
    }

    /**
     * 标准化URL用于比较
     */
    normalizeUrl(url) {
        return url.trim()
            .replace(/^https?:\/\//, '')
            .replace(/^www\./, '')
            .replace(/\/$/, '')
            .toLowerCase();
    }

    /**
     * 标准化标题用于比较
     */
    normalizeTitle(title) {
        return title.trim()
            .replace(/\s+/g, ' ')
            .toLowerCase();
    }

    /**
     * 计算重复严重程度
     */
    calculateDuplicateSeverity(bookmarks) {
        if (bookmarks.length >= 5) return 'high';
        if (bookmarks.length >= 3) return 'medium';
        return 'low';
    }

    /**
     * 截断文本
     */
    truncateText(text, maxLength = 40) {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    }

    /**
     * 附加重复书签事件监听器
     */
    attachDuplicateEventListeners() {
        // 标签页切换
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
                e.target.classList.add('active');
                const panel = document.querySelector(`[data-panel="${e.target.dataset.tab}"]`);
                if (panel) panel.classList.add('active');
            });
        });
    }

    /**
     * 全选重复书签
     */
    selectAllDuplicates() {
        document.querySelectorAll('.duplicate-item.remove input[type="checkbox"]').forEach(cb => {
            cb.checked = true;
        });
    }

    /**
     * 取消全选重复书签
     */
    deselectAllDuplicates() {
        document.querySelectorAll('.duplicate-item.remove input[type="checkbox"]').forEach(cb => {
            cb.checked = false;
        });
    }

    /**
     * 删除选中的重复书签
     */
    deleteSelectedDuplicates() {
        const selectedIds = Array.from(document.querySelectorAll('.duplicate-item.remove input[type="checkbox"]:checked'))
            .map(cb => cb.dataset.id);

        if (selectedIds.length === 0) {
            this.showWarning('请先选择要删除的书签');
            return;
        }

        if (confirm(`确定要删除选中的 ${selectedIds.length} 个重复书签吗？`)) {
            this.deleteBookmarks(selectedIds);
        }
    }

    /**
     * 删除重复组
     */
    deleteDuplicateGroup(type, index) {
        let group;
        if (type === 'url') {
            group = Object.values(this.duplicates.url)[index];
        } else if (type === 'title') {
            group = Object.values(this.duplicates.title)[index];
        } else if (type === 'combination') {
            group = Object.values(this.duplicates.combination)[index];
        }

        if (group && group.bookmarks.length > 1) {
            // 保留第一个，删除其他的
            const idsToDelete = group.bookmarks.slice(1).map(b => b.id);
            if (confirm(`确定要删除这 ${idsToDelete.length} 个重复书签吗？（保留最旧的一个）`)) {
                this.deleteBookmarks(idsToDelete);
            }
        }
    }

    /**
     * 切换重复组展开/收起
     */
    toggleDuplicateGroup(index) {
        const panel = document.getElementById(`duplicate-group-${index}`);
        if (panel) {
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        }
    }

    /**
     * 显示加载状态
     */
    showLoading(show) {
        this.loading = show;
        // 可以在这里添加全局加载指示器
    }

    /**
     * 显示成功消息
     */
    showSuccess(message) {
        // 实现成功消息显示
        console.log('Success:', message);
    }

    /**
     * 显示错误消息
     */
    showError(message) {
        // 实现错误消息显示
        console.error('Error:', message);
    }

    /**
     * 显示信息消息
     */
    showInfo(message) {
        // 实现信息消息显示
        console.log('Info:', message);
    }

    /**
     * 显示加载进度
     */
    showLoadingProgress(message) {
        const contentArea = document.querySelector('.content-area');
        if (!contentArea) return;

        const progressHtml = `
            <div class="loading-progress" id="loadingProgress">
                <div class="loading-spinner">
                    <div class="spinner"></div>
                </div>
                <div class="loading-text">${message}</div>
            </div>
        `;

        // 移除现有进度
        const existingProgress = document.getElementById('loadingProgress');
        if (existingProgress) {
            existingProgress.remove();
        }

        contentArea.insertAdjacentHTML('afterbegin', progressHtml);
    }

    /**
     * 隐藏加载进度
     */
    hideLoadingProgress() {
        const progress = document.getElementById('loadingProgress');
        if (progress) {
            progress.remove();
        }
    }

    /**
     * 防抖函数
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * 过滤视图
     */
    filterView(view) {
        // 实现不同的视图过滤逻辑
        switch (view) {
            case 'recent':
                // 显示最近访问的书签
                break;
            case 'favorites':
                // 显示收藏的书签
                break;
            case 'folders':
                // 显示文件夹视图
                this.renderFolders();
                break;
            default:
                // 显示所有书签
                this.renderBookmarks();
        }
    }

    /**
     * 表格排序
     */
    sortTable(field) {
        if (this.currentSort.field === field) {
            this.currentSort.direction = this.currentSort.direction === 'asc' ? 'desc' : 'asc';
        } else {
            this.currentSort.field = field;
            this.currentSort.direction = 'asc';
        }
        this.renderBookmarks();
    }

    /**
     * 切换书签选择
     */
    toggleBookmarkSelection(id) {
        if (this.selectedBookmarks.has(id)) {
            this.selectedBookmarks.delete(id);
        } else {
            this.selectedBookmarks.add(id);
        }
        this.updateSelectionUI();
    }

    /**
     * 更新选择UI
     */
    updateSelectionUI() {
        document.querySelectorAll('.table-row .checkbox').forEach(checkbox => {
            const row = checkbox.closest('.table-row');
            const id = row.dataset.id;
            if (this.selectedBookmarks.has(id)) {
                checkbox.classList.add('checked');
            } else {
                checkbox.classList.remove('checked');
            }
        });
    }

    /**
     * 计算分页信息
     */
    updatePagination() {
        const filteredBookmarks = this.filterBookmarks();
        this.totalPages = Math.ceil(filteredBookmarks.length / this.itemsPerPage);

        // 确保当前页在有效范围内
        if (this.currentPage > this.totalPages) {
            this.currentPage = this.totalPages;
        }
        if (this.currentPage < 1) {
            this.currentPage = 1;
        }
    }

    /**
     * 获取当前页的书签
     */
    getCurrentPageBookmarks() {
        const filteredBookmarks = this.filterBookmarks();
        const startIndex = (this.currentPage - 1) * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        return filteredBookmarks.slice(startIndex, endIndex);
    }

    /**
     * 渲染分页控件
     */
    renderPagination() {
        const container = document.getElementById('bookmarkGrid');
        if (!container) return;

        // 如果只有一页，不显示分页
        if (this.totalPages <= 1) {
            const existingPagination = container.querySelector('.pagination-container');
            if (existingPagination) {
                existingPagination.remove();
            }
            return;
        }

        let paginationHtml = `
            <div class="pagination-container">
                <div class="pagination-info">
                    显示 ${(this.currentPage - 1) * this.itemsPerPage + 1} -
                    ${Math.min(this.currentPage * this.itemsPerPage, this.filterBookmarks().length)}
                    共 ${this.filterBookmarks().length} 个书签
                </div>
                <div class="pagination-controls">
                    <button class="pagination-btn" onclick="bookmarkEditor.goToPage(${this.currentPage - 1})"
                            ${this.currentPage === 1 ? 'disabled' : ''}>
                        上一页
                    </button>
                    <div class="pagination-pages">
        `;

        // 显示页码（最多显示5个页码）
        const startPage = Math.max(1, this.currentPage - 2);
        const endPage = Math.min(this.totalPages, startPage + 4);

        for (let i = startPage; i <= endPage; i++) {
            paginationHtml += `
                <button class="page-number ${i === this.currentPage ? 'active' : ''}"
                        onclick="bookmarkEditor.goToPage(${i})">
                    ${i}
                </button>
            `;
        }

        paginationHtml += `
                    </div>
                    <button class="pagination-btn" onclick="bookmarkEditor.goToPage(${this.currentPage + 1})"
                            ${this.currentPage === this.totalPages ? 'disabled' : ''}>
                        下一页
                    </button>
                </div>
            </div>
        `;

        // 移除现有分页
        const existingPagination = container.querySelector('.pagination-container');
        if (existingPagination) {
            existingPagination.remove();
        }

        // 添加新分页
        container.insertAdjacentHTML('beforeend', paginationHtml);
    }

    /**
     * 跳转到指定页面
     */
    goToPage(page) {
        if (page < 1 || page > this.totalPages) return;

        this.currentPage = page;
        this.renderBookmarks();

        // 滚动到顶部
        const contentArea = document.querySelector('.content-area');
        if (contentArea) {
            contentArea.scrollTop = 0;
        }
    }
}

// 全局实例
let bookmarkEditor;

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    // 确保模态框在页面加载时是隐藏的
    const modal = document.getElementById('bookmarkModal');
    if (modal) {
        modal.classList.remove('active');
        console.log('🔒 Modal hidden on page load');
    }

    bookmarkEditor = new BookmarkEditor();
});

// 导出给全局使用
window.bookmarkEditor = bookmarkEditor;