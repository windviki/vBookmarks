/**
 * vBookmarks Bookmark Manager
 *
 * Handles all bookmark-related operations including CRUD,
 * tree navigation, and bookmark management.
 */

class BookmarkManager {
    constructor() {
        this.bookmarks = [];
        this.currentFolder = null;
        this.selectedBookmark = null;
        this.listeners = new Map();
    }

    /**
     * Initialize the bookmark manager
     */
    async init() {
        await this.loadBookmarks();
        this.setupEventListeners();
    }

    /**
     * Load all bookmarks from Chrome API
     */
    async loadBookmarks() {
        return new Promise((resolve, reject) => {
            chrome.bookmarks.getTree((bookmarkTreeNodes) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }
                this.bookmarks = bookmarkTreeNodes;
                this.notifyListeners('bookmarksLoaded', bookmarkTreeNodes);
                resolve(bookmarkTreeNodes);
            });
        });
    }

    /**
     * Get bookmarks in a specific folder
     */
    async getFolderChildren(folderId) {
        return new Promise((resolve, reject) => {
            chrome.bookmarks.getChildren(folderId, (children) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }
                resolve(children);
            });
        });
    }

    /**
     * Create a new bookmark
     */
    async createBookmark(parentId, title, url) {
        return new Promise((resolve, reject) => {
            chrome.bookmarks.create({
                parentId: parentId,
                title: title,
                url: url
            }, (bookmark) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }
                this.notifyListeners('bookmarkCreated', bookmark);
                resolve(bookmark);
            });
        });
    }

    /**
     * Create a new folder
     */
    async createFolder(parentId, title) {
        return new Promise((resolve, reject) => {
            chrome.bookmarks.create({
                parentId: parentId,
                title: title
            }, (folder) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }
                this.notifyListeners('folderCreated', folder);
                resolve(folder);
            });
        });
    }

    /**
     * Update bookmark/folder
     */
    async updateBookmark(id, changes) {
        return new Promise((resolve, reject) => {
            chrome.bookmarks.update(id, changes, (bookmark) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }
                this.notifyListeners('bookmarkUpdated', bookmark);
                resolve(bookmark);
            });
        });
    }

    /**
     * Move bookmark/folder
     */
    async moveBookmark(id, newParentId, index = -1) {
        return new Promise((resolve, reject) => {
            const destination = { parentId: newParentId };
            if (index >= 0) {
                destination.index = index;
            }

            chrome.bookmarks.move(id, destination, (bookmark) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }
                this.notifyListeners('bookmarkMoved', bookmark);
                resolve(bookmark);
            });
        });
    }

    /**
     * Delete bookmark/folder
     */
    async deleteBookmark(id) {
        return new Promise((resolve, reject) => {
            chrome.bookmarks.remove(id, (bookmark) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }
                this.notifyListeners('bookmarkDeleted', bookmark);
                resolve(bookmark);
            });
        });
    }

    /**
     * Delete entire folder tree
     */
    async deleteFolder(id) {
        return new Promise((resolve, reject) => {
            chrome.bookmarks.removeTree(id, (folder) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }
                this.notifyListeners('folderDeleted', folder);
                resolve(folder);
            });
        });
    }

    /**
     * Search bookmarks
     */
    async searchBookmarks(query) {
        return new Promise((resolve, reject) => {
            chrome.bookmarks.search(query, (results) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }
                resolve(results);
            });
        });
    }

    /**
     * Get bookmark by ID
     */
    getBookmarkById(id) {
        const findBookmark = (nodes) => {
            for (const node of nodes) {
                if (node.id === id) {
                    return node;
                }
                if (node.children) {
                    const found = findBookmark(node.children);
                    if (found) return found;
                }
            }
            return null;
        };
        return findBookmark(this.bookmarks);
    }

    /**
     * Get bookmark tree path
     */
    getBookmarkPath(bookmarkId) {
        const path = [];
        const findPath = (nodes, targetId, currentPath = []) => {
            for (const node of nodes) {
                const newPath = [...currentPath, node];
                if (node.id === targetId) {
                    return newPath;
                }
                if (node.children) {
                    const found = findPath(node.children, targetId, newPath);
                    if (found) return found;
                }
            }
            return null;
        };
        return findPath(this.bookmarks, bookmarkId);
    }

    /**
     * Event listener management
     */
    addEventListener(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(callback);
    }

    removeEventListener(event, callback) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).delete(callback);
        }
    }

    notifyListeners(event, data) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in bookmark manager event listener:`, error);
                }
            });
        }
    }

    /**
     * Setup Chrome event listeners
     */
    setupEventListeners() {
        chrome.bookmarks.onCreated.addListener((id, bookmark) => {
            this.loadBookmarks().catch(console.error);
        });

        chrome.bookmarks.onRemoved.addListener((id, removeInfo) => {
            this.loadBookmarks().catch(console.error);
        });

        chrome.bookmarks.onChanged.addListener((id, changeInfo) => {
            this.loadBookmarks().catch(console.error);
        });

        chrome.bookmarks.onMoved.addListener((id, moveInfo) => {
            this.loadBookmarks().catch(console.error);
        });

        chrome.bookmarks.onChildrenReordered.addListener((id, reorderInfo) => {
            this.loadBookmarks().catch(console.error);
        });
    }
}

// Export for use in other modules
export { BookmarkManager };

// Also attach to window for legacy compatibility
if (typeof window !== 'undefined') {
    window.BookmarkManager = BookmarkManager;
}