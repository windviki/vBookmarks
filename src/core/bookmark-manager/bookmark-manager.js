/**
 * 书签管理器
 * 管理书签的核心功能：CRUD操作、树形结构、搜索等
 */
import { globalEventSystem, Events } from '../event-system/event-system.js';
import { isBlank } from '../../utils/string/string-utils.js';

export class BookmarkManager {
    constructor() {
        this.bookmarks = new Map();
        this.treeNodes = new Map();
        this.selectedNode = null;
        this.searchResults = [];
        this.isSearchMode = false;

        // 初始化事件监听
        this.initEventListeners();
    }

    /**
     * 初始化事件监听器
     */
    initEventListeners() {
        // 监听Chrome书签变化
        if (chrome.bookmarks) {
            chrome.bookmarks.onCreated.addListener((id, bookmark) => {
                this.handleBookmarkCreated(id, bookmark);
            });

            chrome.bookmarks.onRemoved.addListener((id, removeInfo) => {
                this.handleBookmarkRemoved(id, removeInfo);
            });

            chrome.bookmarks.onChanged.addListener((id, changeInfo) => {
                this.handleBookmarkChanged(id, changeInfo);
            });

            chrome.bookmarks.onMoved.addListener((id, moveInfo) => {
                this.handleBookmarkMoved(id, moveInfo);
            });

            chrome.bookmarks.onChildrenReordered.addListener((id, reorderInfo) => {
                this.handleChildrenReordered(id, reorderInfo);
            });
        }
    }

    /**
     * 加载书签树
     * @returns {Promise<void>}
     */
    async loadBookmarks() {
        try {
            const bookmarkTree = await this.getBookmarkTree();
            this.processBookmarkTree(bookmarkTree);
            globalEventSystem.emit(Events.TREE_REFRESHED, { bookmarks: this.bookmarks });
        } catch (error) {
            console.error('Failed to load bookmarks:', error);
            throw error;
        }
    }

    /**
     * 获取书签树
     * @returns {Promise<Array>}
     */
    getBookmarkTree() {
        return new Promise((resolve, reject) => {
            chrome.bookmarks.getTree((bookmarkTreeNodes) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(bookmarkTreeNodes);
                }
            });
        });
    }

    /**
     * 处理书签树
     * @param {Array} treeNodes - 书签树节点数组
     */
    processBookmarkTree(treeNodes) {
        this.bookmarks.clear();
        this.treeNodes.clear();

        const processNode = (node, parentId = null) => {
            const nodeInfo = {
                id: node.id,
                parentId: parentId,
                title: node.title || '',
                url: node.url || '',
                dateAdded: node.dateAdded || 0,
                dateGroupModified: node.dateGroupModified || 0,
                children: node.children ? [] : null,
                isFolder: !node.url,
                isSeparator: this.isSeparator(node.title, node.url)
            };

            this.bookmarks.set(node.id, nodeInfo);
            this.treeNodes.set(node.id, node);

            if (node.children) {
                node.children.forEach(child => {
                    processNode(child, node.id);
                    nodeInfo.children.push(child.id);
                });
            }
        };

        treeNodes.forEach(processNode);
    }

    /**
     * 检查是否为分隔符
     * @param {string} title - 书签标题
     * @param {string} url - 书签URL
     * @returns {boolean}
     */
    isSeparator(title, url) {
        // 简化版分隔符检查，后续可以集成SeparatorManager
        return title === '|' || (url && url.includes('separatethis.com'));
    }

    /**
     * 搜索书签
     * @param {string} query - 搜索查询
     * @param {Object} options - 搜索选项
     * @returns {Promise<Array>}
     */
    async searchBookmarks(query, options = {}) {
        const {
            searchInTitles = true,
            searchInUrls = true,
            caseSensitive = false,
            exactMatch = false
        } = options;

        if (isBlank(query)) {
            this.searchResults = [];
            this.isSearchMode = false;
            globalEventSystem.emit(Events.SEARCH_CLEARED);
            return [];
        }

        const searchQuery = caseSensitive ? query : query.toLowerCase();
        const results = [];

        for (const [id, bookmark] of this.bookmarks) {
            let match = false;

            if (searchInTitles && bookmark.title) {
                const title = caseSensitive ? bookmark.title : bookmark.title.toLowerCase();
                if (exactMatch) {
                    match = title === searchQuery;
                } else {
                    match = title.includes(searchQuery);
                }
            }

            if (!match && searchInUrls && bookmark.url) {
                const url = caseSensitive ? bookmark.url : bookmark.url.toLowerCase();
                if (exactMatch) {
                    match = url === searchQuery;
                } else {
                    match = url.includes(searchQuery);
                }
            }

            if (match) {
                results.push({
                    ...bookmark,
                    score: this.calculateSearchScore(bookmark, searchQuery)
                });
            }
        }

        // 按相关性排序
        results.sort((a, b) => b.score - a.score);

        this.searchResults = results;
        this.isSearchMode = true;

        globalEventSystem.emit(Events.SEARCH_PERFORMED, {
            query,
            results,
            count: results.length
        });

        return results;
    }

    /**
     * 计算搜索结果相关性得分
     * @param {Object} bookmark - 书签对象
     * @param {string} query - 搜索查询
     * @returns {number} 相关性得分
     */
    calculateSearchScore(bookmark, query) {
        let score = 0;

        // 标题匹配权重更高
        if (bookmark.title && bookmark.title.toLowerCase().includes(query.toLowerCase())) {
            score += 10;
            if (bookmark.title.toLowerCase().startsWith(query.toLowerCase())) {
                score += 5;
            }
        }

        // URL匹配
        if (bookmark.url && bookmark.url.toLowerCase().includes(query.toLowerCase())) {
            score += 3;
        }

        return score;
    }

    /**
     * 获取书签信息
     * @param {string} id - 书签ID
     * @returns {Object|null}
     */
    getBookmark(id) {
        return this.bookmarks.get(id) || null;
    }

    /**
     * 获取子书签
     * @param {string} parentId - 父书签ID
     * @returns {Array}
     */
    getChildren(parentId) {
        const parent = this.bookmarks.get(parentId);
        if (!parent || !parent.children) {
            return [];
        }

        return parent.children.map(childId => this.bookmarks.get(childId)).filter(Boolean);
    }

    /**
     * 创建书签
     * @param {Object} bookmarkData - 书签数据
     * @returns {Promise<string>}
     */
    async createBookmark(bookmarkData) {
        return new Promise((resolve, reject) => {
            chrome.bookmarks.create(bookmarkData, (result) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(result.id);
                }
            });
        });
    }

    /**
     * 更新书签
     * @param {string} id - 书签ID
     * @param {Object} changes - 更改内容
     * @returns {Promise<void>}
     */
    async updateBookmark(id, changes) {
        return new Promise((resolve, reject) => {
            chrome.bookmarks.update(id, changes, (result) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(result);
                }
            });
        });
    }

    /**
     * 删除书签
     * @param {string} id - 书签ID
     * @returns {Promise<void>}
     */
    async deleteBookmark(id) {
        return new Promise((resolve, reject) => {
            chrome.bookmarks.remove(id, () => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * 移动书签
     * @param {string} id - 书签ID
     * @param {Object} destination - 目标位置
     * @returns {Promise<void>}
     */
    async moveBookmark(id, destination) {
        return new Promise((resolve, reject) => {
            chrome.bookmarks.move(id, destination, (result) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(result);
                }
            });
        });
    }

    // 事件处理方法
    handleBookmarkCreated(id, bookmark) {
        // 重新加载书签树以保持同步
        this.loadBookmarks();
        globalEventSystem.emit(Events.BOOKMARK_CREATED, { id, bookmark });
    }

    handleBookmarkRemoved(id, removeInfo) {
        this.bookmarks.delete(id);
        this.treeNodes.delete(id);
        globalEventSystem.emit(Events.BOOKMARK_DELETED, { id, removeInfo });
    }

    handleBookmarkChanged(id, changeInfo) {
        const bookmark = this.bookmarks.get(id);
        if (bookmark) {
            Object.assign(bookmark, changeInfo);
            globalEventSystem.emit(Events.BOOKMARK_UPDATED, { id, changeInfo });
        }
    }

    handleBookmarkMoved(id, moveInfo) {
        // 重新加载书签树以处理复杂的父子关系变化
        this.loadBookmarks();
        globalEventSystem.emit(Events.BOOKMARK_MOVED, { id, moveInfo });
    }

    handleChildrenReordered(id, reorderInfo) {
        // 重新加载书签树以处理子节点顺序变化
        this.loadBookmarks();
    }
}