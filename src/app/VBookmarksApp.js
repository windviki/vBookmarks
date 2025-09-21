/**
 * vBookmarks 主应用类
 * 现代化的书签管理应用核心
 *
 * 这个类整合了所有功能模块，提供统一的应用接口
 * 替代原有的 neat.js 中的全局功能
 */

import { BookmarkManager } from '../core/bookmark-manager/bookmark-manager.js';
import { SearchManager } from '../core/search-manager.js';
import { UIManager } from '../core/ui-manager.js';
import { ConfigManager } from '../core/config-manager.js';
import { ErrorHandler } from '../core/error-handler.js';
import { globalEventSystem, Events } from '../core/event-system/event-system.js';
import { SeparatorManager } from '../core/storage-manager/separator-manager.js';
import { MetadataManager } from '../metadata-manager.js';
import { Performance } from '../utils/performance.js';
import { Logger } from '../utils/logger.js';

export class VBookmarksApp {
    constructor() {
        this.initialized = false;
        this.modules = {};
        this.config = {};
        this.eventSystem = globalEventSystem;

        // 应用状态
        this.state = {
            isReady: false,
            isLoading: false,
            currentView: 'tree',
            selectedItem: null,
            searchQuery: '',
            expandedFolders: new Set()
        };

        // 平台信息
        this.platform = this.detectPlatform();
        this.chromeVersion = this.detectChromeVersion();
        this.isRTL = this.checkRTL();

        // 性能监控
        this.performance = new Performance('VBookmarksApp');

        // 日志系统
        this.logger = new Logger('VBookmarksApp');
    }

    /**
     * 初始化应用
     */
    async init() {
        if (this.initialized) {
            this.logger.warn('Application already initialized');
            return this;
        }

        this.performance.start('init');
        this.state.isLoading = true;

        try {
            this.logger.info('Initializing vBookmarks application...');

            // 初始化核心模块
            await this.initCoreModules();

            // 初始化UI组件
            await this.initUIComponents();

            // 初始化事件系统
            await this.initEventSystem();

            // 初始化书签数据
            await this.initBookmarkData();

            // 设置国际化
            await this.setupI18n();

            // 应用主题和样式
            await this.applyTheme();

            this.state.isReady = true;
            this.initialized = true;

            this.logger.info('vBookmarks application initialized successfully');
            this.eventSystem.emit(Events.APP_READY, this);

        } catch (error) {
            this.logger.error('Failed to initialize application:', error);
            this.eventSystem.emit(Events.APP_ERROR, error);
            throw error;
        } finally {
            this.state.isLoading = false;
            this.performance.end('init');
        }

        return this;
    }

    /**
     * 初始化核心模块
     */
    async initCoreModules() {
        this.performance.start('initCoreModules');

        try {
            // 配置管理器
            this.modules.config = new ConfigManager();
            await this.modules.config.init();
            this.config = this.modules.config.getConfig();

            // 错误处理器
            this.modules.errorHandler = new ErrorHandler();

            // 书签管理器
            this.modules.bookmarkManager = new BookmarkManager();
            await this.modules.bookmarkManager.init();

            // 搜索管理器
            this.modules.searchManager = new SearchManager(this.modules.bookmarkManager);
            await this.modules.searchManager.init();

            // UI管理器
            this.modules.uiManager = new UIManager();
            await this.modules.uiManager.init();

            // 分隔符管理器
            this.modules.separatorManager = new SeparatorManager();
            await this.modules.separatorManager.init();

            // 元数据管理器
            this.modules.metadataManager = new MetadataManager();
            await this.modules.metadataManager.init();

            this.logger.info('Core modules initialized');

        } catch (error) {
            this.logger.error('Failed to initialize core modules:', error);
            throw error;
        } finally {
            this.performance.end('initCoreModules');
        }
    }

    /**
     * 初始化UI组件
     */
    async initUIComponents() {
        this.performance.start('initUIComponents');

        try {
            // 初始化主界面
            await this.modules.uiManager.renderMainInterface();

            // 初始化搜索界面
            await this.modules.uiManager.renderSearchInterface();

            // 初始化书签树
            await this.modules.uiManager.renderBookmarkTree();

            this.logger.info('UI components initialized');

        } catch (error) {
            this.logger.error('Failed to initialize UI components:', error);
            throw error;
        } finally {
            this.performance.end('initUIComponents');
        }
    }

    /**
     * 初始化事件系统
     */
    async initEventSystem() {
        this.performance.start('initEventSystem');

        try {
            // 应用级事件监听
            this.setupAppEventListeners();

            // 键盘事件
            this.setupKeyboardEvents();

            // 窗口事件
            this.setupWindowEvents();

            this.logger.info('Event system initialized');

        } catch (error) {
            this.logger.error('Failed to initialize event system:', error);
            throw error;
        } finally {
            this.performance.end('initEventSystem');
        }
    }

    /**
     * 初始化书签数据
     */
    async initBookmarkData() {
        this.performance.start('initBookmarkData');

        try {
            // 加载书签树
            const bookmarkTree = await this.modules.bookmarkManager.getBookmarkTree();

            // 渲染书签树
            await this.modules.uiManager.renderBookmarkTree(bookmarkTree);

            // 恢复展开状态
            await this.restoreExpandedState();

            this.logger.info('Bookmark data initialized');

        } catch (error) {
            this.logger.error('Failed to initialize bookmark data:', error);
            throw error;
        } finally {
            this.performance.end('initBookmarkData');
        }
    }

    /**
     * 设置国际化
     */
    async setupI18n() {
        this.performance.start('setupI18n');

        try {
            // 设置i18n占位符
            this.setupI18nPlaceholders();

            // 设置RTL布局
            if (this.isRTL) {
                document.body.classList.add('rtl');
            }

            // 设置平台特定类
            document.body.classList.add(this.platform.toLowerCase());

            this.logger.info('Internationalization setup completed');

        } catch (error) {
            this.logger.error('Failed to setup internationalization:', error);
            throw error;
        } finally {
            this.performance.end('setupI18n');
        }
    }

    /**
     * 应用主题
     */
    async applyTheme() {
        this.performance.start('applyTheme');

        try {
            const theme = this.config.theme || 'default';

            // 应用主题类
            document.documentElement.setAttribute('data-theme', theme);

            // 应用用户自定义CSS
            if (this.config.customCSS) {
                this.applyCustomCSS(this.config.customCSS);
            }

            this.logger.info(`Theme '${theme}' applied`);

        } catch (error) {
            this.logger.error('Failed to apply theme:', error);
            throw error;
        } finally {
            this.performance.end('applyTheme');
        }
    }

    /**
     * 检测平台
     */
    detectPlatform() {
        const platform = navigator.platform.toLowerCase();
        if (platform.includes('mac')) return 'Mac';
        if (platform.includes('win')) return 'Windows';
        if (platform.includes('linux')) return 'Linux';
        return 'Other';
    }

    /**
     * 检测Chrome版本
     */
    detectChromeVersion() {
        const match = navigator.userAgent.match(/chrome\/([\d]+)\.([\d]+)\.([\d]+)\.([\d]+)/i);
        if (!match) return null;

        return {
            major: parseInt(match[1]),
            minor: parseInt(match[2]),
            build: parseInt(match[3]),
            patch: parseInt(match[4])
        };
    }

    /**
     * 检查RTL布局
     */
    checkRTL() {
        const direction = window.getComputedStyle(document.body).direction;
        return direction === 'rtl';
    }

    /**
     * 设置i18n占位符
     */
    setupI18nPlaceholders() {
        const placeholders = {
            'search-input': 'searchBookmarks',
            'edit-dialog-name': 'name',
            'edit-dialog-url': 'url',
            'new-folder-dialog-name': 'name'
        };

        Object.entries(placeholders).forEach(([elementId, messageKey]) => {
            const element = document.getElementById(elementId);
            if (element) {
                element.placeholder = chrome.i18n.getMessage(messageKey);
            }
        });
    }

    /**
     * 设置应用级事件监听器
     */
    setupAppEventListeners() {
        // 书签选择事件
        this.eventSystem.on(Events.BOOKMARK_SELECTED, (bookmark) => {
            this.state.selectedItem = bookmark;
        });

        // 搜索事件
        this.eventSystem.on(Events.SEARCH_PERFORMED, (query) => {
            this.state.searchQuery = query;
            this.state.currentView = 'search';
        });

        // 配置更改事件
        this.eventSystem.on(Events.CONFIG_CHANGED, (newConfig) => {
            this.config = { ...this.config, ...newConfig };
        });

        // 错误事件
        this.eventSystem.on(Events.ERROR_OCCURRED, (error) => {
            this.modules.errorHandler.handleError(error);
        });
    }

    /**
     * 设置键盘事件
     */
    setupKeyboardEvents() {
        document.addEventListener('keydown', (event) => {
            // 全局键盘快捷键
            if (event.ctrlKey || event.metaKey) {
                switch (event.key) {
                    case 'f':
                        event.preventDefault();
                        this.focusSearch();
                        break;
                    case 'n':
                        event.preventDefault();
                        this.createNewBookmark();
                        break;
                    case 'd':
                        event.preventDefault();
                        this.createNewFolder();
                        break;
                }
            }
        });
    }

    /**
     * 设置窗口事件
     */
    setupWindowEvents() {
        // 窗口大小变化
        window.addEventListener('resize', this.debounce(() => {
            this.eventSystem.emit(Events.WINDOW_RESIZED, {
                width: window.innerWidth,
                height: window.innerHeight
            });
        }, 250));

        // 窗口失去焦点
        window.addEventListener('blur', () => {
            this.eventSystem.emit(Events.WINDOW_BLURRED);
        });

        // 窗口获得焦点
        window.addEventListener('focus', () => {
            this.eventSystem.emit(Events.WINDOW_FOCUSED);
        });
    }

    /**
     * 恢复展开状态
     */
    async restoreExpandedState() {
        try {
            const savedState = localStorage.getItem('vbookmarks_expanded_folders');
            if (savedState) {
                this.state.expandedFolders = new Set(JSON.parse(savedState));
            }
        } catch (error) {
            this.logger.warn('Failed to restore expanded state:', error);
        }
    }

    /**
     * 保存展开状态
     */
    async saveExpandedState() {
        try {
            const state = Array.from(this.state.expandedFolders);
            localStorage.setItem('vbookmarks_expanded_folders', JSON.stringify(state));
        } catch (error) {
            this.logger.warn('Failed to save expanded state:', error);
        }
    }

    /**
     * 应用自定义CSS
     */
    applyCustomCSS(css) {
        let styleElement = document.getElementById('custom-css-style');

        if (!styleElement) {
            styleElement = document.createElement('style');
            styleElement.id = 'custom-css-style';
            document.head.appendChild(styleElement);
        }

        styleElement.textContent = css;
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
     * 创建新书签
     */
    createNewBookmark() {
        this.eventSystem.emit(Events.BOOKMARK_CREATE_REQUESTED, {
            type: 'bookmark',
            parentId: this.state.selectedItem?.id || '1'
        });
    }

    /**
     * 创建新文件夹
     */
    createNewFolder() {
        this.eventSystem.emit(Events.BOOKMARK_CREATE_REQUESTED, {
            type: 'folder',
            parentId: this.state.selectedItem?.id || '1'
        });
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
     * 获取应用状态
     */
    getAppState() {
        return { ...this.state };
    }

    /**
     * 获取应用配置
     */
    getAppConfig() {
        return { ...this.config };
    }

    /**
     * 获取模块实例
     */
    getModule(name) {
        return this.modules[name];
    }

    /**
     * 销毁应用
     */
    async destroy() {
        this.logger.info('Destroying vBookmarks application...');

        // 清理事件监听器
        this.eventSystem.removeAllListeners();

        // 销毁所有模块
        for (const [name, module] of Object.entries(this.modules)) {
            if (typeof module.destroy === 'function') {
                await module.destroy();
            }
        }

        // 重置状态
        this.state = {
            isReady: false,
            isLoading: false,
            currentView: 'tree',
            selectedItem: null,
            searchQuery: '',
            expandedFolders: new Set()
        };

        this.initialized = false;
        this.logger.info('vBookmarks application destroyed');
    }
}

// 导出应用类
export default VBookmarksApp;