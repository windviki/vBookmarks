/**
 * vBookmarks Sync Manager
 * Manages bookmark sync status and provides sync-related functionality
 */

class SyncManager {
    constructor() {
        this.syncCache = new Map();
        this.syncSettings = {
            showSyncStatus: true,
            highlightUnsynced: true,
            autoRefreshSync: true,
            syncRefreshInterval: 30000 // 30 seconds
        };
        this.refreshInterval = null;
        this.init();
    }

    async init() {
        await this.loadSettings();
        this.setupEventListeners();
        if (this.syncSettings.autoRefreshSync) {
            this.startAutoRefresh();
        }
    }

    async loadSettings() {
        const result = await chrome.storage.sync.get({
            syncSettings: this.syncSettings
        });
        this.syncSettings = result.syncSettings;
    }

    async saveSettings() {
        await chrome.storage.sync.set({
            syncSettings: this.syncSettings
        });
    }

    setupEventListeners() {
        chrome.bookmarks.onCreated.addListener(this.handleBookmarkChange.bind(this));
        chrome.bookmarks.onRemoved.addListener(this.handleBookmarkChange.bind(this));
        chrome.bookmarks.onChanged.addListener(this.handleBookmarkChange.bind(this));
        chrome.bookmarks.onMoved.addListener(this.handleBookmarkChange.bind(this));
        chrome.bookmarks.onChildrenReordered.addListener(this.handleBookmarkChange.bind(this));
        chrome.bookmarks.onImportBegan.addListener(this.handleImportBegan.bind(this));
        chrome.bookmarks.onImportEnded.addListener(this.handleImportEnded.bind(this));
    }

    handleBookmarkChange(id, changeInfo) {
        this.invalidateCache(id);
        this.updateSyncStatus(id);
    }

    handleImportBegan() {
        this.clearCache();
        this.notifySyncStatusChanged('import-start');
    }

    handleImportEnded() {
        this.notifySyncStatusChanged('import-end');
    }

    invalidateCache(bookmarkId) {
        this.syncCache.delete(bookmarkId);
        // Also invalidate parent and children
        this.invalidateRelatedBookmarks(bookmarkId);
    }

    invalidateRelatedBookmarks(bookmarkId) {
        // Invalidate parent folder
        chrome.bookmarks.get(bookmarkId, (node) => {
            if (node[0] && node[0].parentId) {
                this.syncCache.delete(node[0].parentId);
            }
        });

        // Invalidate children if it's a folder
        chrome.bookmarks.getChildren(bookmarkId, (children) => {
            children.forEach(child => {
                this.syncCache.delete(child.id);
            });
        });
    }

    clearCache() {
        this.syncCache.clear();
    }

    startAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        this.refreshInterval = setInterval(() => {
            this.refreshAllSyncStatus();
        }, this.syncSettings.syncRefreshInterval);
    }

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    async refreshAllSyncStatus() {
        try {
            const tree = await this.getBookmarkTree();
            await this.updateTreeSyncStatus(tree);
            this.notifySyncStatusChanged('refresh-complete');
        } catch (error) {
            console.error('Error refreshing sync status:', error);
        }
    }

    getBookmarkTree() {
        return new Promise((resolve, reject) => {
            chrome.bookmarks.getTree(tree => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    // Handle dual storage tree structure
                    if (tree && tree.length > 0) {
                        // Process the tree to handle new folderType and syncing properties
                        this.processBookmarkTree(tree);
                    }
                    resolve(tree);
                }
            });
        });
    }

    processBookmarkTree(nodes) {
        if (!nodes || !Array.isArray(nodes)) return;

        nodes.forEach(node => {
            // Process new folderType and syncing properties
            if (node.folderType || node.syncing !== undefined) {
                // Update cache for this node
                this.updateSyncStatus(node.id);
            }

            // Recursively process children
            if (node.children) {
                this.processBookmarkTree(node.children);
            }
        });
    }

    async updateTreeSyncStatus(tree) {
        for (const node of tree) {
            await this.updateNodeSyncStatus(node);
        }
    }

    async updateNodeSyncStatus(node) {
        const syncStatus = await this.getSyncStatus(node);
        this.syncCache.set(node.id, syncStatus);

        if (node.children) {
            for (const child of node.children) {
                await this.updateNodeSyncStatus(child);
            }
        }
    }

    async getSyncStatus(bookmarkNode) {
        // Check cache first
        if (this.syncCache.has(bookmarkNode.id)) {
            return this.syncCache.get(bookmarkNode.id);
        }

        // Determine sync status based on Chrome's new syncing property
        const status = {
            isSynced: false,
            syncError: null,
            lastSynced: bookmarkNode.dateAdded,
            isSyncing: false,
            canSync: true,
            syncUrl: bookmarkNode.url,
            parentId: bookmarkNode.parentId,
            folderType: bookmarkNode.folderType,
            syncing: bookmarkNode.syncing
        };

        // Use Chrome's new syncing property if available
        if (bookmarkNode.syncing !== undefined) {
            status.isSynced = bookmarkNode.syncing;
        } else {
            // Fallback for older Chrome versions
            status.isSynced = this.isBookmarkSynced(bookmarkNode);
        }

        // Check if bookmark can be synced
        if (bookmarkNode.url && this.isUrlSyncable(bookmarkNode.url)) {
            status.canSync = true;
        } else if (bookmarkNode.children) {
            // Folders can always be synced
            status.canSync = true;
        } else {
            status.canSync = false;
        }

        this.syncCache.set(bookmarkNode.id, status);
        return status;
    }

    isBookmarkSynced(bookmarkNode) {
        // Logic to determine if bookmark is synced
        // This is a simplified version - in practice, you'd need to check
        // against Chrome's sync status APIs
        return bookmarkNode.url && !bookmarkNode.url.startsWith('chrome://');
    }

    isUrlSyncable(url) {
        // Check if URL can be synced
        const unsyncablePatterns = [
            'chrome://',
            'chrome-extension://',
            'moz-extension://',
            'edge://',
            'about:',
            'data:',
            'file:',
            'javascript:'
        ];

        return !unsyncablePatterns.some(pattern => url.startsWith(pattern));
    }

    async updateSyncStatus(bookmarkId) {
        try {
            const bookmark = await this.getBookmark(bookmarkId);
            if (bookmark) {
                const syncStatus = await this.getSyncStatus(bookmark);
                this.syncCache.set(bookmarkId, syncStatus);
                this.notifySyncStatusChanged('updated', bookmarkId, syncStatus);
            }
        } catch (error) {
            console.error('Error updating sync status:', error);
        }
    }

    getBookmark(bookmarkId) {
        return new Promise((resolve, reject) => {
            chrome.bookmarks.get(bookmarkId, (node) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(node[0]);
                }
            });
        });
    }

    notifySyncStatusChanged(event, bookmarkId, status) {
        // Dispatch custom event for UI updates
        const eventDetail = {
            event,
            bookmarkId,
            status,
            timestamp: Date.now()
        };

        window.dispatchEvent(new CustomEvent('syncStatusChanged', {
            detail: eventDetail
        }));
    }

    async getSyncStats() {
        const tree = await this.getBookmarkTree();
        const stats = {
            total: 0,
            synced: 0,
            unsynced: 0,
            folders: 0,
            syncable: 0,
            errors: 0
        };

        this.calculateStats(tree, stats);
        return stats;
    }

    calculateStats(nodes, stats) {
        nodes.forEach(node => {
            stats.total++;

            if (node.children) {
                stats.folders++;
                this.calculateStats(node.children, stats);
            } else {
                const syncStatus = this.syncCache.get(node.id) || {};
                if (syncStatus.isSynced) {
                    stats.synced++;
                } else {
                    stats.unsynced++;
                }
                if (syncStatus.canSync) {
                    stats.syncable++;
                }
                if (syncStatus.syncError) {
                    stats.errors++;
                }
            }
        });
    }

    async exportSyncReport() {
        const stats = await this.getSyncStats();
        const tree = await this.getBookmarkTree();
        const report = {
            timestamp: new Date().toISOString(),
            stats,
            details: this.generateDetailedReport(tree)
        };

        return report;
    }

    generateDetailedReport(nodes) {
        const details = [];

        nodes.forEach(node => {
            const syncStatus = this.syncCache.get(node.id) || {};
            const nodeInfo = {
                id: node.id,
                title: node.title,
                url: node.url,
                type: node.children ? 'folder' : 'bookmark',
                syncStatus: syncStatus.isSynced ? 'synced' : 'unsynced',
                canSync: syncStatus.canSync,
                error: syncStatus.syncError
            };

            details.push(nodeInfo);

            if (node.children) {
                nodeInfo.children = this.generateDetailedReport(node.children);
            }
        });

        return details;
    }

    // Public methods for UI integration
    getSyncStatusIndicator(bookmarkId) {
        const status = this.syncCache.get(bookmarkId);
        if (!status) return '';

        if (status.syncError) {
            return 'sync-error';
        }
        if (status.isSyncing) {
            return 'syncing';
        }
        if (status.syncing !== undefined) {
            // Use Chrome's native syncing property
            return status.syncing ? 'synced' : 'local';
        }
        if (status.isSynced) {
            return 'synced';
        }
        if (!status.canSync) {
            return 'unsyncable';
        }
        return 'unsynced';
    }

    getSyncTooltip(bookmarkId) {
        const status = this.syncCache.get(bookmarkId);
        if (!status) return '';

        if (status.syncError) {
            return `Sync error: ${status.syncError}`;
        }
        if (status.isSyncing) {
            return 'Syncing...';
        }
        if (status.syncing !== undefined) {
            // Use Chrome's native syncing property
            if (status.folderType) {
                return status.syncing ?
                    `${status.folderType} (Synced)` :
                    `${status.folderType} (Local only)`;
            }
            return status.syncing ? 'Synced to cloud' : 'Local only';
        }
        if (status.isSynced) {
            return 'Synced to cloud';
        }
        if (!status.canSync) {
            return 'Cannot be synced';
        }
        return 'Not synced';
    }

    async forceSync(bookmarkId) {
        try {
            const bookmark = await this.getBookmark(bookmarkId);
            if (bookmark && bookmark.url) {
                // Implement force sync logic
                // This would typically involve Chrome's sync APIs
                this.notifySyncStatusChanged('force-sync', bookmarkId);
                return true;
            }
        } catch (error) {
            console.error('Error forcing sync:', error);
            return false;
        }
    }

    // Cleanup
    destroy() {
        this.stopAutoRefresh();
        this.clearCache();
        this.syncCache = null;
    }
}

// Initialize sync manager immediately if not already initialized
if (typeof window !== 'undefined' && !window.syncManager) {
    window.syncManager = new SyncManager();
}

// Fallback initialization on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    if (!window.syncManager) {
        window.syncManager = new SyncManager();
    }
});

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SyncManager;
}