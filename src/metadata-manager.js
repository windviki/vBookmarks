/**
 * vBookmarks Metadata Manager
 *
 * Manages bookmark metadata using localStorage for:
 * - Click counts
 * - Add dates
 * - Custom metadata
 */

class BookmarkMetadataManager {
    constructor() {
        this.storageKey = 'vbookmarks_metadata';
        this.metadata = this.loadMetadata();
        this.bookmarkCache = new Map(); // Cache for BookmarkTreeNode data
        this.initializeBookmarkCache();
    }

    /**
     * Load metadata from localStorage
     */
    loadMetadata() {
        try {
            const stored = localStorage.getItem(this.storageKey);
            return stored ? JSON.parse(stored) : {};
        } catch (error) {
            console.warn('Failed to load bookmark metadata:', error);
            return {};
        }
    }

    /**
     * Initialize bookmark cache with Chrome BookmarkTreeNode data
     */
    async initializeBookmarkCache() {
        try {
            const bookmarkTree = await new Promise((resolve) => {
                chrome.bookmarks.getTree(resolve);
            });

            this.populateBookmarkCache(bookmarkTree);
            console.log('✅ Bookmark cache initialized with', this.bookmarkCache.size, 'bookmarks');
        } catch (error) {
            console.warn('Failed to initialize bookmark cache:', error);
        }
    }

    /**
     * Populate bookmark cache from BookmarkTreeNode tree
     */
    populateBookmarkCache(bookmarkTree) {
        const traverse = (node) => {
            if (node.id && node.url) { // Only cache actual bookmarks (not folders)
                this.bookmarkCache.set(node.id, {
                    dateAdded: node.dateAdded,
                    dateGroupModified: node.dateGroupModified,
                    dateLastUsed: node.dateLastUsed,
                    title: node.title,
                    url: node.url
                });
            }
            if (node.children) {
                node.children.forEach(traverse);
            }
        };

        bookmarkTree.forEach(traverse);
    }

    /**
     * Get original BookmarkTreeNode data for a bookmark
     */
    getBookmarkNodeData(bookmarkId) {
        return this.bookmarkCache.get(bookmarkId);
    }

    /**
     * Get bookmark path for display
     */
    async getBookmarkPath(bookmarkId) {
        try {
            const bookmarkInfo = await new Promise((resolve) => {
                chrome.bookmarks.get(bookmarkId, resolve);
            });

            if (!bookmarkInfo || bookmarkInfo.length === 0) {
                return '';
            }

            const path = await this.buildBookmarkPath(bookmarkInfo[0]);
            return path;
        } catch (error) {
            console.warn('Failed to get bookmark path:', error);
            return '';
        }
    }

    /**
     * Build bookmark path by traversing parents
     */
    async buildBookmarkPath(bookmark, path = []) {
        if (!bookmark) {
            return path.join(' / ');
        }

        // Add current folder/title to path
        if (bookmark.title) {
            path.unshift(bookmark.title);
        }

        if (bookmark.parentId && bookmark.parentId !== '0') {
            try {
                const parentInfo = await new Promise((resolve) => {
                    chrome.bookmarks.get(bookmark.parentId, resolve);
                });

                if (parentInfo && parentInfo.length > 0) {
                    return this.buildBookmarkPath(parentInfo[0], path);
                }
            } catch (error) {
                console.warn('Failed to get parent bookmark:', error);
            }
        }

        return path.join(' / ');
    }

    /**
     * Save metadata to localStorage
     */
    saveMetadata() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.metadata));
        } catch (error) {
            console.warn('Failed to save bookmark metadata:', error);
        }
    }

    /**
     * Get metadata for a specific bookmark
     */
    getBookmarkMetadata(bookmarkId) {
        if (!this.isValidBookmarkId(bookmarkId)) {
            return this.createDefaultMetadata();
        }

        // If metadata doesn't exist, create it with original BookmarkTreeNode data
        if (!this.metadata[bookmarkId]) {
            this.metadata[bookmarkId] = this.createDefaultMetadata();
            this.syncWithOriginalData(bookmarkId);
            this.saveMetadata();
        }

        return this.metadata[bookmarkId];
    }

    /**
     * Alias for getBookmarkMetadata for compatibility
     */
    getMetadata(bookmarkId) {
        return this.getBookmarkMetadata(bookmarkId);
    }

    /**
     * Sync metadata with original BookmarkTreeNode data
     */
    syncWithOriginalData(bookmarkId) {
        const nodeData = this.getBookmarkNodeData(bookmarkId);
        if (!nodeData || !this.metadata[bookmarkId]) {
            return;
        }

        // 优先使用BookmarkTreeNode的dateAdded字段
        if (nodeData.dateAdded) {
            this.metadata[bookmarkId].addedDate = new Date(nodeData.dateAdded).toISOString();
        }

        // 如果BookmarkTreeNode有dateLastUsed，优先使用它
        if (nodeData.dateLastUsed) {
            this.metadata[bookmarkId].lastAccessed = new Date(nodeData.dateLastUsed).toISOString();
        }

        // 只有在Chrome API没有提供dateLastUsed时，才使用localStorage的lastAccessed
        if (!nodeData.dateLastUsed && !this.metadata[bookmarkId].lastAccessed) {
            // 可以设置一个默认值或者保持为null
            // this.metadata[bookmarkId].lastAccessed = new Date().toISOString();
        }

        // 设置title和URL作为参考
        this.metadata[bookmarkId].title = nodeData.title;
        this.metadata[bookmarkId].url = nodeData.url;
    }

    /**
     * Create default metadata structure
     */
    createDefaultMetadata() {
        return {
            clickCount: 0,
            addedDate: null, // Will be set from BookmarkTreeNode data
            lastAccessed: null,
            customNotes: '',
            tags: [],
            rating: 0
        };
    }

    /**
     * Update or create metadata for a bookmark
     */
    updateBookmarkMetadata(bookmarkId, updates) {
        if (!this.metadata[bookmarkId]) {
            this.metadata[bookmarkId] = this.createDefaultMetadata();
        }

        Object.assign(this.metadata[bookmarkId], updates);
        this.saveMetadata();
        return this.metadata[bookmarkId];
    }

    /**
     * Increment click count for a bookmark
     */
    incrementClickCount(bookmarkId) {
        if (!this.isValidBookmarkId(bookmarkId)) {
            console.warn('Invalid bookmark ID for click tracking:', bookmarkId);
            return 0;
        }

        const metadata = this.getBookmarkMetadata(bookmarkId);
        metadata.clickCount = (metadata.clickCount || 0) + 1;
        metadata.lastAccessed = new Date().toISOString();
        this.updateBookmarkMetadata(bookmarkId, metadata);
        return metadata.clickCount;
    }

    /**
     * Get click count for a bookmark
     */
    getClickCount(bookmarkId) {
        return this.getBookmarkMetadata(bookmarkId).clickCount || 0;
    }

    /**
     * Get added date for a bookmark
     */
    getAddedDate(bookmarkId) {
        // 优先使用BookmarkTreeNode的dateAdded字段
        const nodeData = this.getBookmarkNodeData(bookmarkId);
        if (nodeData && nodeData.dateAdded) {
            return new Date(nodeData.dateAdded);
        }

        // 回退到存储的元数据
        const metadata = this.getBookmarkMetadata(bookmarkId);
        return metadata.addedDate ? new Date(metadata.addedDate) : null;
    }

    /**
     * Get last accessed date for a bookmark
     */
    getLastAccessed(bookmarkId) {
        // 优先使用BookmarkTreeNode的dateLastUsed字段
        const nodeData = this.getBookmarkNodeData(bookmarkId);
        if (nodeData && nodeData.dateLastUsed) {
            return new Date(nodeData.dateLastUsed);
        }

        // 回退到存储的元数据
        const metadata = this.getBookmarkMetadata(bookmarkId);
        return metadata.lastAccessed ? new Date(metadata.lastAccessed) : null;
    }

    /**
     * Get all bookmarks sorted by click count (descending)
     */
    getBookmarksByClickCount() {
        return Object.entries(this.metadata)
            .filter(([id, metadata]) => this.isValidBookmarkId(id))
            .sort(([,a], [,b]) => (b.clickCount || 0) - (a.clickCount || 0))
            .map(([id, metadata]) => ({ id, ...metadata }));
    }

    /**
     * Get all bookmarks sorted by added date (newest first)
     */
    getBookmarksByAddedDate() {
        return Object.entries(this.metadata)
            .filter(([id, metadata]) => this.isValidBookmarkId(id))
            .sort(([,a], [,b]) => new Date(b.addedDate || 0) - new Date(a.addedDate || 0))
            .map(([id, metadata]) => ({ id, ...metadata }));
    }

    /**
     * Check if a bookmark ID is valid
     */
    isValidBookmarkId(id) {
        return id && typeof id === 'string' && id !== '0' && /^\d+$/.test(id);
    }

    /**
     * Get all bookmarks sorted by last accessed (most recent first)
     */
    getBookmarksByLastAccessed() {
        return Object.entries(this.metadata)
            .filter(([, metadata]) => metadata.lastAccessed)
            .sort(([,a], [,b]) => new Date(b.lastAccessed) - new Date(a.lastAccessed))
            .map(([id, metadata]) => ({ id, ...metadata }));
    }

    /**
     * Search bookmarks by metadata
     */
    searchMetadata(query) {
        const results = [];
        const lowercaseQuery = query.toLowerCase();

        for (const [bookmarkId, metadata] of Object.entries(this.metadata)) {
            if (metadata.customNotes && metadata.customNotes.toLowerCase().includes(lowercaseQuery)) {
                results.push({ id: bookmarkId, ...metadata });
            }
            if (metadata.tags && metadata.tags.some(tag => tag.toLowerCase().includes(lowercaseQuery))) {
                results.push({ id: bookmarkId, ...metadata });
            }
        }

        return results;
    }

    /**
     * Delete metadata for a bookmark
     */
    deleteBookmarkMetadata(bookmarkId) {
        if (this.metadata[bookmarkId]) {
            delete this.metadata[bookmarkId];
            this.saveMetadata();
            return true;
        }
        return false;
    }

    /**
     * Get statistics
     */
    getStatistics() {
        const totalBookmarks = Object.keys(this.metadata).length;
        const totalClicks = Object.values(this.metadata).reduce((sum, meta) => sum + (meta.clickCount || 0), 0);
        const averageClicks = totalBookmarks > 0 ? Math.round(totalClicks / totalBookmarks) : 0;

        const mostClicked = this.getBookmarksByClickCount()[0];
        const recentlyAdded = this.getBookmarksByAddedDate()[0];
        const recentlyAccessed = this.getBookmarksByLastAccessed()[0];

        return {
            totalBookmarks,
            totalClicks,
            averageClicks,
            mostClicked: mostClicked ? { id: mostClicked.id, clicks: mostClicked.clickCount } : null,
            recentlyAdded: recentlyAdded ? { id: recentlyAdded.id, date: recentlyAdded.addedDate } : null,
            recentlyAccessed: recentlyAccessed ? { id: recentlyAccessed.id, date: recentlyAccessed.lastAccessed } : null
        };
    }

    /**
     * Clean up old metadata (bookmarks that no longer exist)
     */
    async cleanupMetadata() {
        try {
            // Get all current bookmark IDs from Chrome
            const bookmarkTree = await new Promise((resolve) => {
                chrome.bookmarks.getTree(resolve);
            });

            const allBookmarkIds = this.extractBookmarkIds(bookmarkTree);
            const metadataIds = Object.keys(this.metadata);

            const orphanedIds = metadataIds.filter(id => !allBookmarkIds.includes(id));

            if (orphanedIds.length > 0) {
                console.log(`Cleaning up ${orphanedIds.length} orphaned metadata entries`);
                orphanedIds.forEach(id => {
                    delete this.metadata[id];
                });
                this.saveMetadata();
            }

            return orphanedIds.length;
        } catch (error) {
            console.warn('Failed to cleanup metadata:', error);
            return 0;
        }
    }

    /**
     * Extract all bookmark IDs from Chrome bookmark tree
     */
    extractBookmarkIds(bookmarkTree) {
        const ids = [];

        function traverse(node) {
            if (node.id) {
                ids.push(node.id);
            }
            if (node.children) {
                node.children.forEach(traverse);
            }
        }

        bookmarkTree.forEach(traverse);
        return ids;
    }

    /**
     * Export metadata as JSON
     */
    exportMetadata() {
        return JSON.stringify(this.metadata, null, 2);
    }

    /**
     * Import metadata from JSON
     */
    importMetadata(jsonData) {
        try {
            const imported = JSON.parse(jsonData);
            this.metadata = { ...this.metadata, ...imported };
            this.saveMetadata();
            return true;
        } catch (error) {
            console.error('Failed to import metadata:', error);
            return false;
        }
    }

    /**
     * Clear all metadata
     */
    clearAllMetadata() {
        this.metadata = {};
        this.saveMetadata();
    }
}

// Export for ES modules
export { BookmarkMetadataManager };

// Also attach to window for legacy compatibility
if (typeof window !== 'undefined') {
    window.BookmarkMetadataManager = BookmarkMetadataManager;
}