/**
 * vBookmarks Floating Toolbar
 *
 * Provides quick access to bookmark management features
 */

class FloatingToolbar {
    constructor() {
        this.toolbar = document.getElementById('floating-toolbar');
        this.isVisible = true;
        this.currentSortMode = null;
        this.metadataManager = null;
        this.bookmarkManager = null;
        this.uiManager = null;

        this.loadSettings();
        this.init();
    }

    /**
     * Initialize the toolbar
     */
    init() {
        this.setupEventListeners();
        this.waitForDependencies();
        this.loadLocalizedStrings();
        this.updateToolbarVisibility();
    }

    /**
     * Load toolbar settings
     */
    loadSettings() {
        try {
            const showToolbar = localStorage.getItem('vbookmarks_show_floating_toolbar');
            if (showToolbar !== null) {
                this.isVisible = showToolbar === 'true';
            } else {
                // 默认开启
                this.isVisible = true;
                localStorage.setItem('vbookmarks_show_floating_toolbar', 'true');
            }
        } catch (error) {
            console.warn('Failed to load toolbar settings:', error);
            this.isVisible = true;
        }
    }

    /**
     * Update toolbar visibility based on settings
     */
    updateToolbarVisibility() {
        if (this.toolbar) {
            this.toolbar.style.display = this.isVisible ? 'flex' : 'none';
        }
    }

    /**
     * Wait for required dependencies to be available
     */
    waitForDependencies() {
        const checkDependencies = () => {
            if (window.BookmarkMetadataManager && window.vBookmarks) {
                this.metadataManager = new BookmarkMetadataManager();
                this.bookmarkManager = window.vBookmarks.bookmarkManager;
                this.uiManager = window.vBookmarks.uiManager;
                console.log('✅ Floating toolbar dependencies loaded');
            } else {
                setTimeout(checkDependencies, 100);
            }
        };
        checkDependencies();
    }

    /**
     * Setup event listeners for toolbar buttons
     */
    setupEventListeners() {
        // Edit button
        const editBtn = document.getElementById('toolbar-edit');
        if (editBtn) {
            editBtn.addEventListener('click', () => this.openBookmarkEditor());
        }

        // Sort by clicks button
        const sortClicksBtn = document.getElementById('toolbar-sort-clicks');
        if (sortClicksBtn) {
            sortClicksBtn.addEventListener('click', () => this.sortByClicks());
        }

        // Sort by date button
        const sortDateBtn = document.getElementById('toolbar-sort-date');
        if (sortDateBtn) {
            sortDateBtn.addEventListener('click', () => this.sortByDate());
        }

        // Sort by accessed button
        const sortAccessedBtn = document.getElementById('toolbar-sort-accessed');
        if (sortAccessedBtn) {
            sortAccessedBtn.addEventListener('click', () => this.sortByAccessed());
        }

        // Settings button
        const settingsBtn = document.getElementById('toolbar-settings');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => this.openSettings());
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                switch (e.key) {
                    case 'e':
                        e.preventDefault();
                        this.openBookmarkEditor();
                        break;
                    case '1':
                        e.preventDefault();
                        this.sortByClicks();
                        break;
                    case '2':
                        e.preventDefault();
                        this.sortByDate();
                        break;
                    case '3':
                        e.preventDefault();
                        this.sortByAccessed();
                        break;
                }
            }
        });
    }

    /**
     * Open bookmark editor page
     */
    openBookmarkEditor() {
        const editorUrl = chrome.runtime.getURL('bookmark-editor.html');
        chrome.tabs.create({ url: editorUrl });
    }

    /**
     * Sort bookmarks by click count
     */
    async sortByClicks() {
        if (!this.metadataManager) {
            console.warn('Metadata manager not available');
            return;
        }

        this.setSortMode('clicks');

        try {
            // Get all bookmarks with their metadata
            const sortedBookmarks = this.metadataManager.getBookmarksByClickCount();

            // Show loading state
            this.showSearchResults();
            this.displaySortedBookmarks(sortedBookmarks, 'clicks');

        } catch (error) {
            console.error('Failed to sort by clicks:', error);
            this.showError('排序失败，请重试');
        }
    }

    /**
     * Sort bookmarks by added date
     */
    async sortByDate() {
        if (!this.metadataManager) {
            console.warn('Metadata manager not available');
            return;
        }

        this.setSortMode('date');

        try {
            // Get all bookmarks with their metadata
            const sortedBookmarks = this.metadataManager.getBookmarksByAddedDate();

            // Show loading state
            this.showSearchResults();
            this.displaySortedBookmarks(sortedBookmarks, 'date');

        } catch (error) {
            console.error('Failed to sort by date:', error);
            this.showError('排序失败，请重试');
        }
    }

    /**
     * Sort bookmarks by last accessed date
     */
    async sortByAccessed() {
        if (!this.metadataManager) {
            console.warn('Metadata manager not available');
            return;
        }

        this.setSortMode('accessed');

        try {
            // Get all bookmarks with their metadata
            const sortedBookmarks = this.metadataManager.getBookmarksByLastAccessed();

            // Show loading state
            this.showSearchResults();
            this.displaySortedBookmarks(sortedBookmarks, 'accessed');

        } catch (error) {
            console.error('Failed to sort by accessed:', error);
            this.showError('排序失败，请重试');
        }
    }

    /**
     * Set current sort mode and update button states
     */
    setSortMode(mode) {
        this.currentSortMode = mode;

        // Update button active states
        document.querySelectorAll('.toolbar-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        if (mode === 'clicks') {
            document.getElementById('toolbar-sort-clicks')?.classList.add('active');
        } else if (mode === 'date') {
            document.getElementById('toolbar-sort-date')?.classList.add('active');
        } else if (mode === 'accessed') {
            document.getElementById('toolbar-sort-accessed')?.classList.add('active');
        }
    }

    /**
     * Show search results container
     */
    showSearchResults() {
        const tree = document.getElementById('tree');
        const results = document.getElementById('results');

        if (tree && results) {
            tree.style.display = 'none';
            results.style.display = 'block';
            results.innerHTML = '<div class="loading-sort">正在加载排序结果...</div>';
        }
    }

    /**
     * Display sorted bookmarks in results container with pagination
     */
    async displaySortedBookmarks(sortedBookmarks, sortBy, page = 1, append = false) {
        const results = document.getElementById('results');
        if (!results) return;

        try {
            // Filter out bookmarks with invalid IDs first
            const validBookmarks = sortedBookmarks.filter(item =>
                item && item.id && typeof item.id === 'string' && item.id !== '0'
            );

            if (validBookmarks.length === 0) {
                results.innerHTML = '<div class="no-results">暂无有效的书签数据</div>';
                return;
            }

            const itemsPerPage = 100;
            const startIndex = (page - 1) * itemsPerPage;
            const endIndex = Math.min(startIndex + itemsPerPage, validBookmarks.length);
            const pageBookmarks = validBookmarks.slice(startIndex, endIndex);

            // Get full bookmark data for each item
            const bookmarksData = await this.getBookmarksData(pageBookmarks.map(item => item.id));

            let html = '';

            // If not appending, add header and back button
            if (!append) {
                // Store current sort data for pagination
                this.currentSortData = {
                    bookmarks: sortedBookmarks,
                    sortBy: sortBy,
                    currentPage: page
                };

                // Add back button
            html += `
                <div class="sort-header">
                    <button class="back-button" id="sort-back-button">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M19 12H5M12 19l-7-7 7-7"/>
                        </svg>
                        返回书签列表
                    </button>
            `;

            if (sortBy === 'clicks') {
                html += '<div class="sort-title">按点击次数排序</div>';
            } else if (sortBy === 'date') {
                html += '<div class="sort-title">按添加日期排序</div>';
            } else if (sortBy === 'accessed') {
                html += '<div class="sort-title">按访问日期排序</div>';
            }

            }

            html += '</div>';

            for (const bookmark of bookmarksData) {
                const metadata = pageBookmarks.find(item => item.id === bookmark.id);
                if (metadata) {
                    html += await this.createBookmarkListItem(bookmark, metadata, sortBy);
                }
            }

            // Add load more button if there are more items
            if (endIndex < validBookmarks.length) {
                html += `
                    <div class="load-more-container">
                        <button class="load-more-btn" id="load-more-btn">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 5v14m-7-7h14"/>
                            </svg>
                            加载更多 (显示 ${Math.min(itemsPerPage, validBookmarks.length - endIndex)}/${validBookmarks.length - endIndex} 项)
                        </button>
                    </div>
                `;
            }

            if (append) {
                // Append to existing content
                const existingContent = results.innerHTML;
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = html;

                // Remove existing load more button if any
                const existingLoadMore = results.querySelector('.load-more-container');
                if (existingLoadMore) {
                    existingLoadMore.remove();
                }

                // Append new items
                results.innerHTML = existingContent + html;
            } else {
                results.innerHTML = html;
            }

            // Add click handlers
            this.addBookmarkClickHandlers(bookmarksData);

            // Add back button handler
            const backButton = results.querySelector('#sort-back-button');
            if (backButton) {
                backButton.addEventListener('click', () => this.clearSort());
            }

            // Add load more button handler
            const loadMoreBtn = results.querySelector('#load-more-btn');
            if (loadMoreBtn) {
                loadMoreBtn.addEventListener('click', () => {
                    this.loadMoreSortedItems();
                });
            }

        } catch (error) {
            console.error('Failed to display sorted bookmarks:', error);
            results.innerHTML = '<div class="error">加载书签失败</div>';
        }
    }

    /**
     * Get full bookmark data for given IDs
     */
    async getBookmarksData(bookmarkIds) {
        try {
            // Filter out invalid bookmark IDs first
            const validIds = bookmarkIds.filter(id => id && typeof id === 'string' && id !== '0');

            if (validIds.length === 0) {
                return [];
            }

            return new Promise((resolve) => {
                chrome.bookmarks.get(validIds, (bookmarks) => {
                    // Filter out folders and only return actual bookmarks
                    const urlBookmarks = bookmarks.filter(bookmark => bookmark && bookmark.url);
                    resolve(urlBookmarks);
                });
            });
        } catch (error) {
            console.warn('Failed to get bookmarks data:', error);
            return [];
        }
    }

    /**
     * Create HTML for a bookmark list item with enhanced metadata
     */
    async createBookmarkListItem(bookmark, metadata, sortBy) {
        const clickCount = metadata.clickCount || 0;
        const addedDate = new Date(metadata.addedDate || Date.now());
        const lastAccessed = metadata.lastAccessed ? new Date(metadata.lastAccessed) : null;
        const bookmarkPath = await this.getBookmarkPath(bookmark.id);

        // Get metadata display settings
        const settings = this.getMetadataSettings();

        // Build compact metadata HTML based on settings
        let metadataHtml = '<div class="bookmark-metadata compact">';

        // Primary sort field (compact display)
        if (sortBy === 'clicks') {
            metadataHtml += `<span class="meta-badge clicks">${clickCount}</span>`;
        } else if (sortBy === 'date') {
            metadataHtml += `<span class="meta-badge date" title="${this.formatDate(addedDate)}">${this.getCompactDate(addedDate)}</span>`;
        } else if (sortBy === 'accessed') {
            const accessedDate = lastAccessed || addedDate;
            metadataHtml += `<span class="meta-badge accessed" title="${this.formatDate(accessedDate)}">${this.getCompactDate(accessedDate)}</span>`;
        }

        // Add compact path indicator
        if (bookmarkPath) {
            const shortPath = bookmarkPath.split(' / ').slice(-2).join(' / ');
            metadataHtml += `<span class="meta-badge path" title="${bookmarkPath}">${shortPath}</span>`;
        }

        metadataHtml += '</div>';

        return `
            <div class="sorted-bookmark-item enhanced" data-bookmark-id="${bookmark.id}">
                <div class="bookmark-main">
                    <div class="favicon-container">
                        <img src="${this.getFaviconUrl(bookmark.url)}"
                             alt=""
                             class="bookmark-favicon"
                             onerror="this.src='${this.getDefaultFavicon()}'">
                    </div>
                    <div class="bookmark-content">
                        <a href="${bookmark.url}" class="bookmark-link" target="_blank" rel="noopener noreferrer">
                            ${bookmark.title}
                        </a>
                    </div>
                </div>
                ${metadataHtml}
            </div>
        `;
    }

    /**
     * Get metadata display settings (same as in neat.js)
     */
    getMetadataSettings() {
        return {
            showAddedDate: localStorage.getItem('vbookmarks_show_added_date') !== 'false',
            showLastAccessed: localStorage.getItem('vbookmarks_show_last_accessed') !== 'false',
            showClickCount: localStorage.getItem('vbookmarks_show_click_count') !== 'false'
        };
    }

    /**
     * Get bookmark path (parent folder names)
     */
    async getBookmarkPath(bookmarkId) {
        try {
            const path = [];
            let currentId = bookmarkId;

            const getPathSegment = (id) => {
                return new Promise((resolve) => {
                    chrome.bookmarks.get(id, (bookmark) => {
                        if (bookmark && bookmark[0]) {
                            resolve(bookmark[0]);
                        } else {
                            resolve(null);
                        }
                    });
                });
            };

            while (currentId !== '0') {
                const bookmark = await getPathSegment(currentId);

                if (!bookmark) break;

                if (bookmark.parentId !== '0') {
                    const parent = await getPathSegment(bookmark.parentId);
                    if (parent) {
                        path.unshift(parent.title);
                        currentId = bookmark.parentId;
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }

            return path.join(' / ');
        } catch (error) {
            console.warn('Failed to get bookmark path:', error);
            return '';
        }
    }

    /**
     * Get compact date representation
     */
    getCompactDate(date) {
        const now = new Date();
        const diff = now - date;
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (days === 0) return '今';
        if (days === 1) return '昨';
        if (days < 7) return `${days}天`;
        if (days < 30) return `${Math.floor(days / 7)}周`;
        if (days < 365) return `${Math.floor(days / 30)}月`;
        return `${Math.floor(days / 365)}年`;
    }

    /**
     * Format date for display
     */
    formatDate(date) {
        const now = new Date();
        const diff = now - date;
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (days === 0) {
            return '今天';
        } else if (days === 1) {
            return '昨天';
        } else if (days < 7) {
            return `${days}天前`;
        } else if (days < 30) {
            return `${Math.floor(days / 7)}周前`;
        } else if (days < 365) {
            return `${Math.floor(days / 30)}个月前`;
        } else {
            return `${Math.floor(days / 365)}年前`;
        }
    }

    /**
     * Load more sorted items
     */
    async loadMoreSortedItems() {
        if (!this.currentSortData) {
            console.warn('No sort data available for loading more items');
            return;
        }

        const { bookmarks, sortBy, currentPage } = this.currentSortData;
        const nextPage = currentPage + 1;

        // Show loading state on the button
        const loadMoreBtn = document.querySelector('#load-more-btn');
        if (loadMoreBtn) {
            loadMoreBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/>
                </svg>
                加载中...
            `;
            loadMoreBtn.disabled = true;
        }

        try {
            await this.displaySortedBookmarks(bookmarks, sortBy, nextPage, true);
        } catch (error) {
            console.error('Failed to load more sorted items:', error);

            // Restore button state on error
            if (loadMoreBtn) {
                loadMoreBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 5v14m-7-7h14"/>
                    </svg>
                    加载失败，重试
                `;
                loadMoreBtn.disabled = false;
            }
        }
    }

    /**
     * Get favicon URL for a bookmark with better error handling
     */
    getFaviconUrl(url) {
        if (!url || typeof url !== 'string') {
            return this.getDefaultFavicon();
        }

        try {
            // Clean the URL
            let cleanUrl = url.trim();
            if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
                cleanUrl = 'https://' + cleanUrl;
            }

            const domain = new URL(cleanUrl).hostname;
            if (!domain || domain === 'localhost' || domain.startsWith('192.168.') || domain.startsWith('127.0.0.1')) {
                return this.getDefaultFavicon();
            }

            // Use Google Favicon service with error handling
            return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
        } catch (error) {
            return this.getDefaultFavicon();
        }
    }

    /**
     * Get default favicon SVG
     */
    getDefaultFavicon() {
        return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiByeD0iMiIgZmlsbD0iI0Y0RjRGNCIvPgo8cGF0aCBkPSJNOCAxMkM5LjEwNDU3IDEyIDEwIDExLjEwNDU3IDEwIDEwQzEwIDguODk1NDMgOS4xMDQ1NyA4IDggOEM2Ljg5NTQzIDggNiA4Ljg5NTQzIDYgMTBDNiAxMS4xMDQ1NyA2Ljg5NTQzIDEyIDggMTJaIiBmaWxsPSIjOTk5Ii8+Cjwvc3ZnPg==';
    }

    /**
     * Add click handlers to bookmark links for click tracking
     */
    addBookmarkClickHandlers(bookmarks) {
        bookmarks.forEach(bookmark => {
            const link = document.querySelector(`[data-bookmark-id="${bookmark.id}"] .bookmark-link`);
            if (link) {
                link.addEventListener('click', (e) => {
                    if (this.metadataManager) {
                        this.metadataManager.incrementClickCount(bookmark.id);
                    }
                });
            }
        });
    }

    /**
     * Open extension settings
     */
    openSettings() {
        if (chrome.runtime.openOptionsPage) {
            chrome.runtime.openOptionsPage();
        } else {
            // Fallback for older Chrome versions
            chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
        }
    }

    /**
     * Show error message
     */
    showError(message) {
        const results = document.getElementById('results');
        if (results) {
            results.innerHTML = `<div class="error-message">${message}</div>`;
        }
    }

    /**
     * Show/hide toolbar
     */
    toggleVisibility() {
        this.isVisible = !this.isVisible;
        if (this.toolbar) {
            this.toolbar.style.display = this.isVisible ? 'flex' : 'none';
        }
    }

    /**
     * Clear current sort
     */
    clearSort() {
        this.currentSortMode = null;
        document.querySelectorAll('.toolbar-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        const tree = document.getElementById('tree');
        const results = document.getElementById('results');

        if (tree && results) {
            tree.style.display = 'block';
            results.style.display = 'none';
        }
    }

    /**
     * Load localized strings for toolbar buttons
     */
    loadLocalizedStrings() {
        try {
            // Update button titles with localized strings
            const buttons = [
                { id: 'toolbar-edit', key: 'toolbarEdit' },
                { id: 'toolbar-sort-clicks', key: 'toolbarSortClicks' },
                { id: 'toolbar-sort-date', key: 'toolbarSortDate' },
                { id: 'toolbar-sort-accessed', key: 'toolbarSortAccessed' },
                { id: 'toolbar-settings', key: 'toolbarSettings' }
            ];

            buttons.forEach(({ id, key }) => {
                const button = document.getElementById(id);
                if (button) {
                    const localizedText = chrome.i18n.getMessage(key);
                    if (localizedText) {
                        button.setAttribute('title', localizedText);
                        button.setAttribute('data-i18n-title', key);
                    }
                }
            });
        } catch (error) {
            console.warn('Failed to load localized strings:', error);
        }
    }
}

// Export for ES modules
export { FloatingToolbar };

// Also attach to window for legacy compatibility
if (typeof window !== 'undefined') {
    window.FloatingToolbar = FloatingToolbar;
}