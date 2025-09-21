/**
 * 书签树组件
 * 负责书签树的渲染和交互
 */
import { globalEventSystem, Events } from '../../core/event-system/event-system.js';

export class BookmarkTree {
    constructor(container, bookmarkManager) {
        this.container = container;
        this.bookmarkManager = bookmarkManager;
        this.treeElement = null;
        this.expandedNodes = new Set();
        this.selectedNode = null;

        this.init();
    }

    /**
     * 初始化书签树
     */
    init() {
        this.createTreeElement();
        this.bindEvents();
        this.loadExpandedState();
    }

    /**
     * 创建树元素
     */
    createTreeElement() {
        this.treeElement = document.createElement('div');
        this.treeElement.className = 'bookmark-tree';
        this.treeElement.setAttribute('role', 'tree');
        this.container.appendChild(this.treeElement);
    }

    /**
     * 绑定事件
     */
    bindEvents() {
        // 监听书签变化
        globalEventSystem.on(Events.TREE_REFRESHED, () => {
            this.render();
        });

        // 监听搜索结果
        globalEventSystem.on(Events.SEARCH_PERFORMED, (data) => {
            this.renderSearchResults(data.results);
        });

        globalEventSystem.on(Events.SEARCH_CLEARED, () => {
            this.render();
        });

        // 键盘导航
        this.treeElement.addEventListener('keydown', (e) => {
            this.handleKeyDown(e);
        });

        // 点击事件
        this.treeElement.addEventListener('click', (e) => {
            this.handleClick(e);
        });
    }

    /**
     * 渲染书签树
     */
    render() {
        this.treeElement.innerHTML = '';

        const rootNodes = this.getRootNodes();
        rootNodes.forEach(node => {
            const treeNode = this.createTreeNode(node);
            this.treeElement.appendChild(treeNode);
        });

        globalEventSystem.emit(Events.TREE_RENDERED);
    }

    /**
     * 获取根节点
     * @returns {Array}
     */
    getRootNodes() {
        const roots = [];
        for (const [id, bookmark] of this.bookmarkManager.bookmarks) {
            if (!bookmark.parentId) {
                roots.push(bookmark);
            }
        }
        return roots;
    }

    /**
     * 创建树节点
     * @param {Object} bookmark - 书签对象
     * @param {number} level - 嵌套层级
     * @returns {HTMLElement}
     */
    createTreeNode(bookmark, level = 0) {
        const nodeElement = document.createElement('div');
        nodeElement.className = 'tree-node';
        nodeElement.setAttribute('role', 'treeitem');
        nodeElement.setAttribute('aria-level', level);
        nodeElement.setAttribute('aria-expanded', this.isNodeExpanded(bookmark.id));
        nodeElement.dataset.nodeId = bookmark.id;

        // 创建节点内容
        const nodeContent = document.createElement('div');
        nodeContent.className = 'node-content';

        // 添加展开/折叠图标（如果是文件夹）
        if (bookmark.isFolder) {
            const expandIcon = document.createElement('span');
            expandIcon.className = 'expand-icon';
            expandIcon.textContent = this.isNodeExpanded(bookmark.id) ? '▼' : '▶';
            nodeContent.appendChild(expandIcon);
        } else {
            const spacer = document.createElement('span');
            spacer.className = 'spacer';
            nodeContent.appendChild(spacer);
        }

        // 添加图标
        const icon = document.createElement('span');
        icon.className = 'node-icon';
        if (bookmark.isSeparator) {
            icon.textContent = '─';
            icon.className += ' separator-icon';
        } else if (bookmark.isFolder) {
            icon.textContent = '📁';
            icon.className += ' folder-icon';
        } else {
            icon.textContent = '🔗';
            icon.className += ' bookmark-icon';
        }
        nodeContent.appendChild(icon);

        // 添加标题
        const title = document.createElement('span');
        title.className = 'node-title';
        title.textContent = bookmark.title || 'Untitled';
        if (bookmark.isSeparator) {
            title.className += ' separator-title';
        }
        nodeContent.appendChild(title);

        nodeElement.appendChild(nodeContent);

        // 添加子节点容器
        if (bookmark.isFolder && bookmark.children) {
            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'node-children';
            childrenContainer.setAttribute('role', 'group');

            if (this.isNodeExpanded(bookmark.id)) {
                bookmark.children.forEach(childId => {
                    const child = this.bookmarkManager.getBookmark(childId);
                    if (child) {
                        const childNode = this.createTreeNode(child, level + 1);
                        childrenContainer.appendChild(childNode);
                    }
                });
            } else {
                childrenContainer.style.display = 'none';
            }

            nodeElement.appendChild(childrenContainer);
        }

        return nodeElement;
    }

    /**
     * 渲染搜索结果
     * @param {Array} results - 搜索结果
     */
    renderSearchResults(results) {
        this.treeElement.innerHTML = '';

        if (results.length === 0) {
            const noResults = document.createElement('div');
            noResults.className = 'no-results';
            noResults.textContent = 'No bookmarks found';
            this.treeElement.appendChild(noResults);
            return;
        }

        results.forEach(bookmark => {
            const resultNode = this.createSearchResultNode(bookmark);
            this.treeElement.appendChild(resultNode);
        });
    }

    /**
     * 创建搜索结果节点
     * @param {Object} bookmark - 书签对象
     * @returns {HTMLElement}
     */
    createSearchResultNode(bookmark) {
        const nodeElement = document.createElement('div');
        nodeElement.className = 'search-result-node';
        nodeElement.dataset.nodeId = bookmark.id;

        const icon = document.createElement('span');
        icon.className = 'result-icon';
        icon.textContent = bookmark.isFolder ? '📁' : '🔗';
        nodeElement.appendChild(icon);

        const title = document.createElement('span');
        title.className = 'result-title';
        title.textContent = bookmark.title || 'Untitled';
        nodeElement.appendChild(title);

        if (bookmark.url && !bookmark.isFolder) {
            const url = document.createElement('span');
            url.className = 'result-url';
            url.textContent = bookmark.url;
            nodeElement.appendChild(url);
        }

        return nodeElement;
    }

    /**
     * 处理点击事件
     * @param {Event} e - 点击事件
     */
    handleClick(e) {
        const nodeElement = e.target.closest('.tree-node, .search-result-node');
        if (!nodeElement) return;

        const nodeId = nodeElement.dataset.nodeId;
        const bookmark = this.bookmarkManager.getBookmark(nodeId);
        if (!bookmark) return;

        // 检查是否点击了展开图标
        if (e.target.classList.contains('expand-icon') && bookmark.isFolder) {
            this.toggleNode(nodeId);
            return;
        }

        // 选择节点
        this.selectNode(nodeId);

        // 如果是书签且不是文件夹，打开链接
        if (!bookmark.isFolder && bookmark.url && !bookmark.isSeparator) {
            this.openBookmark(bookmark);
        }
    }

    /**
     * 处理键盘事件
     * @param {KeyboardEvent} e - 键盘事件
     */
    handleKeyDown(e) {
        const currentElement = document.activeElement;
        const isTreeNode = currentElement.classList.contains('tree-node') ||
                           currentElement.classList.contains('search-result-node');

        if (!isTreeNode) return;

        const nodeId = currentElement.dataset.nodeId;
        const bookmark = this.bookmarkManager.getBookmark(nodeId);
        if (!bookmark) return;

        switch (e.key) {
            case 'Enter':
            case ' ':
                e.preventDefault();
                if (bookmark.isFolder) {
                    this.toggleNode(nodeId);
                } else if (bookmark.url && !bookmark.isSeparator) {
                    this.openBookmark(bookmark);
                }
                break;

            case 'ArrowRight':
                e.preventDefault();
                if (bookmark.isFolder && !this.isNodeExpanded(nodeId)) {
                    this.expandNode(nodeId);
                }
                break;

            case 'ArrowLeft':
                e.preventDefault();
                if (bookmark.isFolder && this.isNodeExpanded(nodeId)) {
                    this.collapseNode(nodeId);
                }
                break;

            case 'ArrowUp':
                e.preventDefault();
                this.navigateUp(currentElement);
                break;

            case 'ArrowDown':
                e.preventDefault();
                this.navigateDown(currentElement);
                break;
        }
    }

    /**
     * 切换节点展开/折叠状态
     * @param {string} nodeId - 节点ID
     */
    toggleNode(nodeId) {
        if (this.isNodeExpanded(nodeId)) {
            this.collapseNode(nodeId);
        } else {
            this.expandNode(nodeId);
        }
    }

    /**
     * 展开节点
     * @param {string} nodeId - 节点ID
     */
    expandNode(nodeId) {
        this.expandedNodes.add(nodeId);
        this.saveExpandedState();
        this.render();
        globalEventSystem.emit(Events.TREE_EXPANDED, { nodeId });
    }

    /**
     * 折叠节点
     * @param {string} nodeId - 节点ID
     */
    collapseNode(nodeId) {
        this.expandedNodes.delete(nodeId);
        this.saveExpandedState();
        this.render();
        globalEventSystem.emit(Events.TREE_COLLAPSED, { nodeId });
    }

    /**
     * 检查节点是否展开
     * @param {string} nodeId - 节点ID
     * @returns {boolean}
     */
    isNodeExpanded(nodeId) {
        return this.expandedNodes.has(nodeId);
    }

    /**
     * 选择节点
     * @param {string} nodeId - 节点ID
     */
    selectNode(nodeId) {
        // 移除之前的选择
        if (this.selectedNode) {
            const prevElement = this.treeElement.querySelector(`[data-node-id="${this.selectedNode}"]`);
            if (prevElement) {
                prevElement.classList.remove('selected');
            }
        }

        // 添加新选择
        this.selectedNode = nodeId;
        const element = this.treeElement.querySelector(`[data-node-id="${nodeId}"]`);
        if (element) {
            element.classList.add('selected');
            element.focus();
        }

        globalEventSystem.emit(Events.SELECTION_CHANGED, { nodeId });
    }

    /**
     * 打开书签
     * @param {Object} bookmark - 书签对象
     */
    openBookmark(bookmark) {
        if (bookmark.url && !bookmark.isSeparator) {
            chrome.tabs.create({ url: bookmark.url });
        }
    }

    /**
     * 向上导航
     * @param {HTMLElement} currentElement - 当前元素
     */
    navigateUp(currentElement) {
        const prev = currentElement.previousElementSibling;
        if (prev) {
            prev.focus();
        }
    }

    /**
     * 向下导航
     * @param {HTMLElement} currentElement - 当前元素
     */
    navigateDown(currentElement) {
        const next = currentElement.nextElementSibling;
        if (next) {
            next.focus();
        }
    }

    /**
     * 保存展开状态到本地存储
     */
    saveExpandedState() {
        try {
            localStorage.setItem('expandedNodes', JSON.stringify([...this.expandedNodes]));
        } catch (error) {
            console.error('Failed to save expanded state:', error);
        }
    }

    /**
     * 从本地存储加载展开状态
     */
    loadExpandedState() {
        try {
            const saved = localStorage.getItem('expandedNodes');
            if (saved) {
                this.expandedNodes = new Set(JSON.parse(saved));
            }
        } catch (error) {
            console.error('Failed to load expanded state:', error);
        }
    }
}