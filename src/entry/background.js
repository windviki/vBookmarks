/**
 * vBookmarks 后台服务脚本
 * 现代化的模块化后台服务
 */
import { globalEventSystem, Events } from '../core/event-system/event-system.js';

class VBookmarksBackground {
    constructor() {
        this.initialized = false;
        this.contextMenuId = null;
        this.omniboxSuggestions = [];
    }

    /**
     * 初始化后台服务
     */
    async init() {
        if (this.initialized) {
            console.warn('Background service already initialized');
            return;
        }

        try {
            console.log('Initializing vBookmarks background service...');

            // 设置右键菜单
            await this.setupContextMenu();

            // 设置Omnibox搜索
            await this.setupOmnibox();

            // 设置消息监听
            await this.setupMessageListeners();

            // 设置书签监听
            await this.setupBookmarkListeners();

            // 设置扩展生命周期监听
            await this.setupLifecycleListeners();

            this.initialized = true;
            console.log('vBookmarks background service initialized successfully');
        } catch (error) {
            console.error('Failed to initialize background service:', error);
            throw error;
        }
    }

    /**
     * 设置右键菜单
     */
    async setupContextMenu() {
        try {
            // 创建主菜单
            this.contextMenuId = await chrome.contextMenus.create({
                id: 'vbookmarks-main',
                title: 'vBookmarks',
                contexts: ['all']
            });

            // 添加子菜单项
            await chrome.contextMenus.create({
                parentId: this.contextMenuId,
                id: 'vbookmarks-add-current',
                title: '添加当前页面到书签',
                contexts: ['page', 'link']
            });

            await chrome.contextMenus.create({
                parentId: this.contextMenuId,
                id: 'vbookmarks-search',
                title: '搜索书签',
                contexts: ['all']
            });

            await chrome.contextMenus.create({
                parentId: this.contextMenuId,
                id: 'vbookmarks-open-popup',
                title: '打开vBookmarks',
                contexts: ['all']
            });

            // 监听菜单点击
            chrome.contextMenus.onClicked.addListener((info, tab) => {
                this.handleContextMenuClick(info, tab);
            });

            console.log('Context menu setup completed');
        } catch (error) {
            console.error('Failed to setup context menu:', error);
        }
    }

    /**
     * 设置Omnibox搜索
     */
    async setupOmnibox() {
        try {
            chrome.omnibox.onInputChanged.addListener((text, suggest) => {
                this.handleOmniboxInput(text, suggest);
            });

            chrome.omnibox.onInputEntered.addListener((text, disposition) => {
                this.handleOmniboxEnter(text, disposition);
            });

            console.log('Omnibox setup completed');
        } catch (error) {
            console.error('Failed to setup omnibox:', error);
        }
    }

    /**
     * 设置消息监听
     */
    async setupMessageListeners() {
        try {
            chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
                this.handleMessage(request, sender, sendResponse);
                return true; // 保持消息通道开放
            });

            chrome.runtime.onConnect.addListener((port) => {
                this.handleConnection(port);
            });

            console.log('Message listeners setup completed');
        } catch (error) {
            console.error('Failed to setup message listeners:', error);
        }
    }

    /**
     * 设置书签监听
     */
    async setupBookmarkListeners() {
        try {
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
                this.handleBookmarkReordered(id, reorderInfo);
            });

            console.log('Bookmark listeners setup completed');
        } catch (error) {
            console.error('Failed to setup bookmark listeners:', error);
        }
    }

    /**
     * 设置扩展生命周期监听
     */
    async setupLifecycleListeners() {
        try {
            chrome.runtime.onInstalled.addListener((details) => {
                this.handleInstalled(details);
            });

            chrome.runtime.onStartup.addListener(() => {
                this.handleStartup();
            });

            chrome.action.onClicked.addListener((tab) => {
                this.handleActionClicked(tab);
            });

            chrome.commands.onCommand.addListener((command) => {
                this.handleCommand(command);
            });

            console.log('Lifecycle listeners setup completed');
        } catch (error) {
            console.error('Failed to setup lifecycle listeners:', error);
        }
    }

    /**
     * 处理右键菜单点击
     */
    async handleContextMenuClick(info, tab) {
        try {
            switch (info.menuItemId) {
                case 'vbookmarks-add-current':
                    await this.addCurrentPageToBookmarks(tab);
                    break;
                case 'vbookmarks-search':
                    await this.openPopupWithSearch();
                    break;
                case 'vbookmarks-open-popup':
                    await this.openPopup();
                    break;
            }
        } catch (error) {
            console.error('Context menu action failed:', error);
        }
    }

    /**
     * 处理Omnibox输入
     */
    async handleOmniboxInput(text, suggest) {
        try {
            if (text.length < 2) {
                suggest([]);
                return;
            }

            // 搜索书签建议
            const suggestions = await this.searchBookmarksForOmnibox(text);
            suggest(suggestions);
        } catch (error) {
            console.error('Omnibox search failed:', error);
            suggest([]);
        }
    }

    /**
     * 处理Omnibox确认
     */
    async handleOmniboxEnter(text, disposition) {
        try {
            const bookmarks = await this.searchBookmarks(text);
            if (bookmarks.length > 0) {
                const bookmark = bookmarks[0];
                await this.openBookmark(bookmark, disposition);
            }
        } catch (error) {
            console.error('Omnibox enter failed:', error);
        }
    }

    /**
     * 处理消息
     */
    async handleMessage(request, sender, sendResponse) {
        try {
            switch (request.action) {
                case 'searchBookmarks':
                    const results = await this.searchBookmarks(request.query);
                    sendResponse({ success: true, results });
                    break;
                case 'getBookmarkTree':
                    const tree = await this.getBookmarkTree();
                    sendResponse({ success: true, tree });
                    break;
                case 'createBookmark':
                    const bookmark = await this.createBookmark(request.data);
                    sendResponse({ success: true, bookmark });
                    break;
                case 'updateBookmark':
                    const updated = await this.updateBookmark(request.id, request.changes);
                    sendResponse({ success: true, bookmark: updated });
                    break;
                case 'deleteBookmark':
                    await this.deleteBookmark(request.id);
                    sendResponse({ success: true });
                    break;
                default:
                    sendResponse({ success: false, error: 'Unknown action' });
            }
        } catch (error) {
            console.error('Message handling failed:', error);
            sendResponse({ success: false, error: error.message });
        }
    }

    /**
     * 处理连接
     */
    handleConnection(port) {
        console.log('New connection:', port.name);

        port.onMessage.addListener((msg) => {
            console.log('Port message:', msg);
        });

        port.onDisconnect.addListener(() => {
            console.log('Port disconnected:', port.name);
        });
    }

    /**
     * 处理书签创建
     */
    handleBookmarkCreated(id, bookmark) {
        console.log('Bookmark created:', id, bookmark);
        globalEventSystem.emit(Events.BOOKMARK_CREATED, { id, bookmark });
    }

    /**
     * 处理书签删除
     */
    handleBookmarkRemoved(id, removeInfo) {
        console.log('Bookmark removed:', id, removeInfo);
        globalEventSystem.emit(Events.BOOKMARK_DELETED, { id, removeInfo });
    }

    /**
     * 处理书签变更
     */
    handleBookmarkChanged(id, changeInfo) {
        console.log('Bookmark changed:', id, changeInfo);
        globalEventSystem.emit(Events.BOOKMARK_UPDATED, { id, changeInfo });
    }

    /**
     * 处理书签移动
     */
    handleBookmarkMoved(id, moveInfo) {
        console.log('Bookmark moved:', id, moveInfo);
        globalEventSystem.emit(Events.BOOKMARK_MOVED, { id, moveInfo });
    }

    /**
     * 处理书签重排序
     */
    handleBookmarkReordered(id, reorderInfo) {
        console.log('Bookmark reordered:', id, reorderInfo);
    }

    /**
     * 处理扩展安装
     */
    handleInstalled(details) {
        console.log('Extension installed:', details);

        if (details.reason === 'install') {
            // 首次安装
            this.handleFirstInstall();
        } else if (details.reason === 'update') {
            // 版本更新
            this.handleUpdate(details.previousVersion);
        }
    }

    /**
     * 处理启动
     */
    handleStartup() {
        console.log('Extension started');
    }

    /**
     * 处理图标点击
     */
    handleActionClicked(tab) {
        console.log('Action clicked:', tab);
        // 默认行为是打开弹出窗口
    }

    /**
     * 处理命令
     */
    handleCommand(command) {
        console.log('Command executed:', command);

        if (command === '_execute_action') {
            this.openPopup();
        }
    }

    /**
     * 搜索书签工具方法
     */
    async searchBookmarks(query) {
        return new Promise((resolve, reject) => {
            chrome.bookmarks.search(query, (results) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(results);
                }
            });
        });
    }

    /**
     * 获取书签树
     */
    async getBookmarkTree() {
        return new Promise((resolve, reject) => {
            chrome.bookmarks.getTree((tree) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(tree);
                }
            });
        });
    }

    /**
     * 创建书签
     */
    async createBookmark(data) {
        return new Promise((resolve, reject) => {
            chrome.bookmarks.create(data, (bookmark) => {
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
     * 删除书签
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
     * 添加当前页面到书签
     */
    async addCurrentPageToBookmarks(tab) {
        try {
            await this.createBookmark({
                title: tab.title,
                url: tab.url
            });

            // 显示通知
            if (chrome.notifications) {
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icon128.png',
                    title: 'vBookmarks',
                    message: '书签已添加'
                });
            }
        } catch (error) {
            console.error('Failed to add current page to bookmarks:', error);
        }
    }

    /**
     * 打开弹出窗口
     */
    async openPopup() {
        try {
            await chrome.action.openPopup();
        } catch (error) {
            console.error('Failed to open popup:', error);
        }
    }

    /**
     * 打开弹出窗口并激活搜索
     */
    async openPopupWithSearch() {
        try {
            await chrome.action.openPopup();
            // 弹出窗口打开后会自动聚焦搜索框
        } catch (error) {
            console.error('Failed to open popup with search:', error);
        }
    }

    /**
     * 为Omnibox搜索书签
     */
    async searchBookmarksForOmnibox(text) {
        try {
            const bookmarks = await this.searchBookmarks(text);
            return bookmarks.slice(0, 5).map(bookmark => ({
                content: bookmark.url,
                description: `${bookmark.title} - ${bookmark.url}`
            }));
        } catch (error) {
            console.error('Omnibox search failed:', error);
            return [];
        }
    }

    /**
     * 打开书签
     */
    async openBookmark(bookmark, disposition) {
        try {
            let url = bookmark.url;

            // 处理特殊URL
            if (url.startsWith('javascript:')) {
                // JavaScript书签需要在当前页面执行
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0]) {
                        chrome.tabs.executeScript(tabs[0].id, {
                            code: bookmark.url.substring(11)
                        });
                    }
                });
                return;
            }

            // 根据disposition决定如何打开
            switch (disposition) {
                case 'currentTab':
                    await chrome.tabs.update({ url });
                    break;
                case 'newForegroundTab':
                    await chrome.tabs.create({ url });
                    break;
                case 'newBackgroundTab':
                    await chrome.tabs.create({ url, active: false });
                    break;
                default:
                    await chrome.tabs.create({ url });
            }
        } catch (error) {
            console.error('Failed to open bookmark:', error);
        }
    }

    /**
     * 处理首次安装
     */
    handleFirstInstall() {
        console.log('First install - showing welcome page');
        // 可以打开欢迎页面或设置页面
    }

    /**
     * 处理更新
     */
    handleUpdate(previousVersion) {
        console.log(`Updated from ${previousVersion}`);
        // 可以显示更新日志
    }
}

// 创建并初始化后台服务
const backgroundService = new VBookmarksBackground();

// 立即初始化
backgroundService.init().catch(error => {
    console.error('Failed to initialize background service:', error);
});

// 导出服务实例（用于测试）
export default backgroundService;