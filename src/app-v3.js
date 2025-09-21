/**
 * vBookmarks 主应用 - 重构版本
 * 使用模块化架构重构的neat.js功能
 */
import { BookmarkManager } from './core/bookmark-manager/bookmark-manager.js';
import { BookmarkTree } from './components/bookmark-tree/bookmark-tree.js';
import { SeparatorManager } from './core/storage-manager/separator-manager.js';
import { globalEventSystem, Events } from './core/event-system/event-system.js';

class VBookmarksApp {
    constructor() {
        this.isInitialized = false;
        this.bookmarkManager = null;
        this.bookmarkTree = null;
        this.separatorManager = null;
        this.searchManager = null;
    }

    /**
     * 初始化应用
     */
    async init() {
        if (this.isInitialized) {
            console.warn('App is already initialized');
            return;
        }

        try {
            console.log('Initializing vBookmarks...');

            // 初始化核心管理器
            this.initCoreManagers();

            // 初始化UI组件
            this.initUIComponents();

            // 绑定全局事件
            this.bindGlobalEvents();

            // 加载初始数据
            await this.loadInitialData();

            this.isInitialized = true;
            globalEventSystem.emit(Events.APP_INITIALIZED);

            console.log('vBookmarks initialized successfully');
        } catch (error) {
            console.error('Failed to initialize vBookmarks:', error);
            throw error;
        }
    }

    /**
     * 初始化核心管理器
     */
    initCoreManagers() {
        // 初始化分隔符管理器
        this.separatorManager = new SeparatorManager();

        // 初始化书签管理器
        this.bookmarkManager = new BookmarkManager();

        console.log('Core managers initialized');
    }

    /**
     * 初始化UI组件
     */
    initUIComponents() {
        // 查找书签树容器
        const treeContainer = document.getElementById('tree-container');
        if (!treeContainer) {
            throw new Error('Tree container not found');
        }

        // 初始化书签树组件
        this.bookmarkTree = new BookmarkTree(treeContainer, this.bookmarkManager);

        console.log('UI components initialized');
    }

    /**
     * 绑定全局事件
     */
    bindGlobalEvents() {
        // 监听应用就绪事件
        globalEventSystem.on(Events.APP_INITIALIZED, () => {
            this.onAppInitialized();
        });

        // 监听书签选择事件
        globalEventSystem.on(Events.SELECTION_CHANGED, (data) => {
            this.onSelectionChanged(data);
        });

        // 监听搜索事件
        globalEventSystem.on(Events.SEARCH_PERFORMED, (data) => {
            this.onSearchPerformed(data);
        });

        // 监听键盘事件
        document.addEventListener('keydown', (e) => {
            this.handleGlobalKeydown(e);
        });

        // 监听窗口大小变化
        window.addEventListener('resize', () => {
            this.handleResize();
        });
    }

    /**
     * 加载初始数据
     */
    async loadInitialData() {
        try {
            // 加载书签
            await this.bookmarkManager.loadBookmarks();

            // 加载分隔符配置
            this.separatorManager.load();

            console.log('Initial data loaded');
        } catch (error) {
            console.error('Failed to load initial data:', error);
            throw error;
        }
    }

    /**
     * 应用初始化完成处理
     */
    onAppInitialized() {
        // 添加就绪类到body
        document.body.classList.add('app-ready');

        // 设置初始焦点
        this.setInitialFocus();

        // 显示就绪状态
        this.showReadyStatus();
    }

    /**
     * 处理选择变化
     * @param {Object} data - 事件数据
     */
    onSelectionChanged(data) {
        const { nodeId } = data;
        const bookmark = this.bookmarkManager.getBookmark(nodeId);

        if (bookmark) {
            // 更新上下文信息
            this.updateContextInfo(bookmark);

            // 更新UI状态
            this.updateUIState(bookmark);
        }
    }

    /**
     * 处理搜索事件
     * @param {Object} data - 搜索数据
     */
    onSearchPerformed(data) {
        const { query, results, count } = data;

        // 更新搜索状态UI
        this.updateSearchState(query, results, count);

        // 切换到搜索模式
        this.bookmarkManager.isSearchMode = true;
    }

    /**
     * 处理全局键盘事件
     * @param {KeyboardEvent} e - 键盘事件
     */
    handleGlobalKeydown(e) {
        // 防止在输入框中触发全局快捷键
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            return;
        }

        switch (e.key) {
            case '/':
                // 聚焦搜索框
                e.preventDefault();
                this.focusSearch();
                break;

            case 'Escape':
                // 清除搜索/关闭对话框
                e.preventDefault();
                this.handleEscape();
                break;

            case 'F2':
                // 编辑选中的书签
                e.preventDefault();
                this.editSelectedBookmark();
                break;

            case 'Delete':
                // 删除选中的书签
                e.preventDefault();
                this.deleteSelectedBookmark();
                break;
        }
    }

    /**
     * 处理窗口大小变化
     */
    handleResize() {
        // 更新布局
        this.updateLayout();
    }

    /**
     * 设置初始焦点
     */
    setInitialFocus() {
        // 优先聚焦搜索框
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.focus();
            return;
        }

        // 否则聚焦书签树
        if (this.bookmarkTree && this.bookmarkTree.treeElement) {
            const firstNode = this.bookmarkTree.treeElement.querySelector('.tree-node');
            if (firstNode) {
                firstNode.focus();
            }
        }
    }

    /**
     * 聚焦搜索框
     */
    focusSearch() {
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.focus();
            searchInput.select();
        }
    }

    /**
     * 处理Escape键
     */
    handleEscape() {
        // 如果在搜索模式，清除搜索
        if (this.bookmarkManager.isSearchMode) {
            this.clearSearch();
            return;
        }

        // 关闭所有打开的对话框
        this.closeDialogs();
    }

    /**
     * 清除搜索
     */
    clearSearch() {
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.value = '';
        }

        this.bookmarkManager.searchResults = [];
        this.bookmarkManager.isSearchMode = false;
        globalEventSystem.emit(Events.SEARCH_CLEARED);
    }

    /**
     * 关闭所有对话框
     */
    closeDialogs() {
        // 关闭右键菜单
        const contextMenu = document.querySelector('.context-menu');
        if (contextMenu) {
            contextMenu.style.display = 'none';
        }

        // 关闭其他对话框...
    }

    /**
     * 编辑选中的书签
     */
    editSelectedBookmark() {
        if (!this.bookmarkTree.selectedNode) {
            return;
        }

        const bookmark = this.bookmarkManager.getBookmark(this.bookmarkTree.selectedNode);
        if (bookmark) {
            this.openBookmarkEditor(bookmark);
        }
    }

    /**
     * 删除选中的书签
     */
    deleteSelectedBookmark() {
        if (!this.bookmarkTree.selectedNode) {
            return;
        }

        if (confirm('Are you sure you want to delete this bookmark?')) {
            this.bookmarkManager.deleteBookmark(this.bookmarkTree.selectedNode);
        }
    }

    /**
     * 打开书签编辑器
     * @param {Object} bookmark - 书签对象
     */
    openBookmarkEditor(bookmark) {
        // 实现书签编辑器逻辑
        console.log('Opening bookmark editor for:', bookmark);
    }

    /**
     * 更新上下文信息
     * @param {Object} bookmark - 书签对象
     */
    updateContextInfo(bookmark) {
        // 更新状态栏等信息
        const statusBar = document.getElementById('status-bar');
        if (statusBar) {
            statusBar.textContent = `Selected: ${bookmark.title}`;
        }
    }

    /**
     * 更新UI状态
     * @param {Object} bookmark - 书签对象
     */
    updateUIState(bookmark) {
        // 更新按钮状态等
        this.updateButtonStates(bookmark);
    }

    /**
     * 更新按钮状态
     * @param {Object} bookmark - 书签对象
     */
    updateButtonStates(bookmark) {
        // 根据书签类型更新按钮可用状态
        const editButton = document.getElementById('edit-button');
        const deleteButton = document.getElementById('delete-button');

        if (editButton) {
            editButton.disabled = bookmark.isSeparator;
        }

        if (deleteButton) {
            deleteButton.disabled = false;
        }
    }

    /**
     * 更新搜索状态
     * @param {string} query - 搜索查询
     * @param {Array} results - 搜索结果
     * @param {number} count - 结果数量
     */
    updateSearchState(query, results, count) {
        const searchStatus = document.getElementById('search-status');
        if (searchStatus) {
            searchStatus.textContent = `Found ${count} bookmarks for "${query}"`;
        }
    }

    /**
     * 更新布局
     */
    updateLayout() {
        // 响应式布局调整
        if (this.bookmarkTree) {
            this.bookmarkTree.render();
        }
    }

    /**
     * 显示就绪状态
     */
    showReadyStatus() {
        const loadingIndicator = document.getElementById('loading-indicator');
        if (loadingIndicator) {
            loadingIndicator.style.display = 'none';
        }

        const appContent = document.getElementById('app-content');
        if (appContent) {
            appContent.style.display = 'block';
        }
    }

    /**
     * 搜索书签
     * @param {string} query - 搜索查询
     * @param {Object} options - 搜索选项
     */
    async search(query, options = {}) {
        return await this.bookmarkManager.searchBookmarks(query, options);
    }

    /**
     * 获取应用状态
     * @returns {Object}
     */
    getAppState() {
        return {
            isInitialized: this.isInitialized,
            selectedNode: this.bookmarkTree ? this.bookmarkTree.selectedNode : null,
            isSearchMode: this.bookmarkManager ? this.bookmarkManager.isSearchMode : false,
            searchResults: this.bookmarkManager ? this.bookmarkManager.searchResults : []
        };
    }

    /**
     * 销毁应用
     */
    destroy() {
        // 清理事件监听器
        globalEventSystem.removeAllListeners();

        // 清理DOM
        if (this.bookmarkTree && this.bookmarkTree.treeElement) {
            this.bookmarkTree.treeElement.innerHTML = '';
        }

        // 重置状态
        this.isInitialized = false;
        this.bookmarkManager = null;
        this.bookmarkTree = null;
        this.separatorManager = null;

        globalEventSystem.emit(Events.APP_DESTROY);
    }
}

// 创建全局应用实例
let appInstance = null;

/**
 * 获取应用实例
 * @returns {VBookmarksApp}
 */
export function getApp() {
    if (!appInstance) {
        appInstance = new VBookmarksApp();
    }
    return appInstance;
}

/**
 * 初始化应用
 * @returns {Promise<VBookmarksApp>}
 */
export async function initApp() {
    const app = getApp();
    await app.init();
    return app;
}

// 如果在浏览器环境中，自动初始化
if (typeof window !== 'undefined') {
    window.VBookmarks = {
        getApp,
        initApp
    };

    // 当DOM准备就绪时自动初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initApp().catch(console.error);
        });
    } else {
        initApp().catch(console.error);
    }
}