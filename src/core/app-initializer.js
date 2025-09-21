/**
 * vBookmarks 应用初始化器
 * 负责平台检测、环境设置和模块初始化
 *
 * 这个模块替代了 neat.js 中的初始化代码
 */

import { Logger } from '../utils/logger.js';
import { globalEventSystem, Events } from '../event-system/event-system.js';

export class AppInitializer {
    constructor() {
        this.logger = new Logger('AppInitializer');
        this.initialized = false;

        // 平台和环境信息
        this.platform = null;
        this.chromeVersion = null;
        this.isRTL = false;
        this.isDevelopment = false;

        // 初始化选项
        this.options = {
            debug: false,
            enablePerformance: true,
            enableErrorTracking: true
        };
    }

    /**
     * 初始化应用环境
     */
    async init(options = {}) {
        if (this.initialized) {
            this.logger.warn('AppInitializer already initialized');
            return this;
        }

        this.options = { ...this.options, ...options };

        try {
            this.logger.info('Starting application initialization...');

            // 阶段1: 环境检测
            await this.detectEnvironment();

            // 阶段2: 平台设置
            await this.setupPlatform();

            // 阶段3: Chrome扩展API验证
            await this.validateChromeAPIs();

            // 阶段4: 全局配置
            await this.setupGlobalConfig();

            // 阶段5: 错误处理
            await this.setupErrorHandling();

            // 阶段6: 性能监控
            await this.setupPerformanceMonitoring();

            // 阶段7: 国际化设置
            await this.setupInternationalization();

            // 阶段8: DOM准备
            await this.waitForDOMReady();

            this.initialized = true;
            this.logger.info('Application initialization completed successfully');

            // 发送初始化完成事件
            globalEventSystem.emit(Events.APP_INITIALIZED, {
                platform: this.platform,
                chromeVersion: this.chromeVersion,
                isRTL: this.isRTL
            });

        } catch (error) {
            this.logger.error('Application initialization failed:', error);
            throw error;
        }

        return this;
    }

    /**
     * 检测运行环境
     */
    async detectEnvironment() {
        this.logger.debug('Detecting runtime environment...');

        // 检测平台
        this.platform = this.detectPlatform();

        // 检测Chrome版本
        this.chromeVersion = this.detectChromeVersion();

        // 检测RTL
        this.isRTL = this.checkRTL();

        // 检测开发环境
        this.isDevelopment = this.checkDevelopmentMode();

        // 检测浏览器兼容性
        this.checkBrowserCompatibility();

        this.logger.info('Environment detected:', {
            platform: this.platform,
            chromeVersion: this.chromeVersion,
            isRTL: this.isRTL,
            isDevelopment: this.isDevelopment
        });
    }

    /**
     * 设置平台特定配置
     */
    async setupPlatform() {
        this.logger.debug('Setting up platform-specific configuration...');

        // 添加平台类到body
        document.body.classList.add(this.platform.toLowerCase());

        // 添加Chrome版本类
        if (this.chromeVersion) {
            document.body.classList.add(`chrome-${this.chromeVersion.major}`);
        }

        // 添加RTL类
        if (this.isRTL) {
            document.body.classList.add('rtl');
            document.documentElement.setAttribute('dir', 'rtl');
        }

        // 平台特定设置
        this.applyPlatformSpecificSettings();

        // 设置CSS变量
        this.setupCSSVariables();
    }

    /**
     * 验证Chrome扩展API
     */
    async validateChromeAPIs() {
        this.logger.debug('Validating Chrome extension APIs...');

        const requiredAPIs = [
            'chrome.bookmarks',
            'chrome.tabs',
            'chrome.storage',
            'chrome.i18n',
            'chrome.runtime'
        ];

        const missingAPIs = [];

        for (const api of requiredAPIs) {
            if (!this.getNestedProperty(window, api)) {
                missingAPIs.push(api);
            }
        }

        if (missingAPIs.length > 0) {
            throw new Error(`Missing required Chrome APIs: ${missingAPIs.join(', ')}`);
        }

        // 验证权限
        await this.validatePermissions();

        this.logger.debug('All Chrome APIs validated successfully');
    }

    /**
     * 设置全局配置
     */
    async setupGlobalConfig() {
        this.logger.debug('Setting up global configuration...');

        // 从localStorage加载配置
        const savedConfig = this.loadSavedConfig();

        // 合并默认配置
        const defaultConfig = {
            theme: 'default',
            language: chrome.i18n.getUILanguage(),
            rememberState: true,
            showMetadata: true,
            enableAnimations: true,
            enableKeyboardShortcuts: true,
            enableContextMenu: true,
            enableDragDrop: true,
            fontSize: 'medium',
            windowWidth: 320,
            windowHeight: 600
        };

        window.vBookmarksConfig = { ...defaultConfig, ...savedConfig };

        // 应用配置
        this.applyGlobalConfig();
    }

    /**
     * 设置错误处理
     */
    async setupErrorHandling() {
        this.logger.debug('Setting up error handling...');

        if (!this.options.enableErrorTracking) {
            return;
        }

        // 全局错误处理
        window.addEventListener('error', (event) => {
            this.handleGlobalError(event);
        });

        // 未处理的Promise拒绝
        window.addEventListener('unhandledrejection', (event) => {
            this.handleUnhandledRejection(event);
        });

        // Chrome扩展错误
        chrome.runtime.onLastError.addListener((error) => {
            this.handleChromeError(error);
        });
    }

    /**
     * 设置性能监控
     */
    async setupPerformanceMonitoring() {
        if (!this.options.enablePerformance) {
            return;
        }

        this.logger.debug('Setting up performance monitoring...');

        // 性能标记
        if (window.performance && window.performance.mark) {
            window.performance.mark('vbookmarks_init_start');
        }

        // 内存监控（如果可用）
        if (window.performance && window.performance.memory) {
            this.setupMemoryMonitoring();
        }
    }

    /**
     * 设置国际化
     */
    async setupInternationalization() {
        this.logger.debug('Setting up internationalization...');

        // 验证i18n
        if (!chrome.i18n) {
            this.logger.warn('Chrome i18n API not available');
            return;
        }

        // 设置语言
        const language = chrome.i18n.getUILanguage();
        document.documentElement.lang = language;

        // 设置消息回调
        this.setupI18nCallbacks();

        // 预加载常用消息
        this.preloadCommonMessages();
    }

    /**
     * 等待DOM准备就绪
     */
    async waitForDOMReady() {
        this.logger.debug('Waiting for DOM to be ready...');

        return new Promise((resolve) => {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => resolve());
            } else {
                resolve();
            }
        });
    }

    /**
     * 检测平台
     */
    detectPlatform() {
        const platform = navigator.platform.toLowerCase();

        if (platform.includes('mac')) return 'Mac';
        if (platform.includes('win')) return 'Windows';
        if (platform.includes('linux')) return 'Linux';
        if (platform.includes('iphone') || platform.includes('ipad')) return 'iOS';
        if (platform.includes('android')) return 'Android';

        return 'Other';
    }

    /**
     * 检测Chrome版本
     */
    detectChromeVersion() {
        const userAgent = navigator.userAgent;
        const match = userAgent.match(/chrome\/([\d]+)\.([\d]+)\.([\d]+)\.([\d]+)/i);

        if (!match) {
            // 尝试匹配 Chromium
            const chromiumMatch = userAgent.match(/chromium\/([\d]+)\.([\d]+)\.([\d]+)\.([\d]+)/i);
            if (chromiumMatch) {
                return {
                    major: parseInt(chromiumMatch[1]),
                    minor: parseInt(chromiumMatch[2]),
                    build: parseInt(chromiumMatch[3]),
                    patch: parseInt(chromiumMatch[4]),
                    isChromium: true
                };
            }
            return null;
        }

        return {
            major: parseInt(match[1]),
            minor: parseInt(match[2]),
            build: parseInt(match[3]),
            patch: parseInt(match[4]),
            isChromium: false
        };
    }

    /**
     * 检查RTL
     */
    checkRTL() {
        // 检查Chrome i18n
        if (chrome.i18n) {
            const rtlLanguages = ['ar', 'he', 'fa', 'ur', 'yi'];
            const language = chrome.i18n.getUILanguage();
            if (rtlLanguages.some(rtlLang => language.startsWith(rtlLang))) {
                return true;
            }
        }

        // 检查CSS direction
        const direction = window.getComputedStyle(document.body).direction;
        return direction === 'rtl';
    }

    /**
     * 检查开发模式
     */
    checkDevelopmentMode() {
        // 检查URL参数
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('debug') || urlParams.has('dev')) {
            return true;
        }

        // 检查扩展ID
        if (chrome.runtime.id) {
            // 开发版扩展通常有特定的ID模式
            const devPatterns = [
                /^[a-z]{32}$/, // 32位小写字母
                /localhost/,  // 包含localhost
                /development/ // 包含development
            ];
            return devPatterns.some(pattern => pattern.test(chrome.runtime.id));
        }

        return false;
    }

    /**
     * 检查浏览器兼容性
     */
    checkBrowserCompatibility() {
        const requiredFeatures = [
            'Promise',
            'fetch',
            'Map',
            'Set',
            'Array.from',
            'Object.assign',
            'requestAnimationFrame'
        ];

        const missingFeatures = requiredFeatures.filter(feature => !(feature in window));

        if (missingFeatures.length > 0) {
            this.logger.warn('Missing browser features:', missingFeatures);
        }

        // 检查Chrome版本要求
        if (this.chromeVersion && this.chromeVersion.major < 88) {
            this.logger.warn(`Chrome version ${this.chromeVersion.major} is below minimum requirement (88)`);
        }
    }

    /**
     * 应用平台特定设置
     */
    applyPlatformSpecificSettings() {
        switch (this.platform) {
            case 'Mac':
                this.applyMacSettings();
                break;
            case 'Windows':
                this.applyWindowsSettings();
                break;
            case 'Linux':
                this.applyLinuxSettings();
                break;
        }
    }

    /**
     * 应用Mac特定设置
     */
    applyMacSettings() {
        // Mac特定的滚动条样式
        document.body.classList.add('mac-scrollbar');

        // Mac特定的字体渲染
        document.body.classList.add('mac-font-rendering');
    }

    /**
     * 应用Windows特定设置
     */
    applyWindowsSettings() {
        // Windows特定的滚动条样式
        document.body.classList.add('windows-scrollbar');

        // Windows特定的字体渲染
        document.body.classList.add('windows-font-rendering');
    }

    /**
     * 应用Linux特定设置
     */
    applyLinuxSettings() {
        // Linux特定的滚动条样式
        document.body.classList.add('linux-scrollbar');

        // Linux特定的字体渲染
        document.body.classList.add('linux-font-rendering');
    }

    /**
     * 设置CSS变量
     */
    setupCSSVariables() {
        const root = document.documentElement;

        // 设置平台特定的CSS变量
        root.style.setProperty('--platform', this.platform.toLowerCase());

        // 设置Chrome版本变量
        if (this.chromeVersion) {
            root.style.setProperty('--chrome-major', this.chromeVersion.major);
            root.style.setProperty('--chrome-minor', this.chromeVersion.minor);
        }

        // 设置设备像素比
        if (window.devicePixelRatio) {
            root.style.setProperty('--device-pixel-ratio', window.devicePixelRatio);
        }
    }

    /**
     * 验证权限
     */
    async validatePermissions() {
        const requiredPermissions = [
            'bookmarks',
            'tabs',
            'storage'
        ];

        // 检查权限
        try {
            const permissions = await new Promise((resolve) => {
                chrome.permissions.getAll(resolve);
            });

            const missingPermissions = requiredPermissions.filter(perm =>
                !permissions.permissions.includes(perm)
            );

            if (missingPermissions.length > 0) {
                this.logger.warn('Missing permissions:', missingPermissions);
            }
        } catch (error) {
            this.logger.warn('Could not validate permissions:', error);
        }
    }

    /**
     * 加载保存的配置
     */
    loadSavedConfig() {
        try {
            const saved = localStorage.getItem('vbookmarks_config');
            if (saved) {
                return JSON.parse(saved);
            }
        } catch (error) {
            this.logger.warn('Could not load saved config:', error);
        }
        return {};
    }

    /**
     * 应用全局配置
     */
    applyGlobalConfig() {
        const config = window.vBookmarksConfig;

        // 应用主题
        if (config.theme) {
            document.documentElement.setAttribute('data-theme', config.theme);
        }

        // 应用语言
        if (config.language) {
            document.documentElement.lang = config.language;
        }

        // 应用字体大小
        if (config.fontSize) {
            document.body.classList.add(`font-size-${config.fontSize}`);
        }

        // 设置窗口大小（在popup中）
        if (window.chrome && window.chrome.windows && config.windowWidth && config.windowHeight) {
            // 这将在popup环境中使用
        }
    }

    /**
     * 处理全局错误
     */
    handleGlobalError(event) {
        this.logger.error('Global error:', {
            message: event.message,
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
            error: event.error
        });

        globalEventSystem.emit(Events.GLOBAL_ERROR, {
            type: 'global_error',
            message: event.message,
            error: event.error
        });
    }

    /**
     * 处理未处理的Promise拒绝
     */
    handleUnhandledRejection(event) {
        this.logger.error('Unhandled promise rejection:', {
            reason: event.reason,
            promise: event.promise
        });

        globalEventSystem.emit(Events.GLOBAL_ERROR, {
            type: 'unhandled_rejection',
            reason: event.reason,
            promise: event.promise
        });
    }

    /**
     * 处理Chrome错误
     */
    handleChromeError(error) {
        this.logger.error('Chrome API error:', error);

        globalEventSystem.emit(Events.CHROME_API_ERROR, {
            type: 'chrome_error',
            error: error
        });
    }

    /**
     * 设置内存监控
     */
    setupMemoryMonitoring() {
        const memory = window.performance.memory;

        // 定期检查内存使用
        setInterval(() => {
            const used = memory.usedJSHeapSize;
            const total = memory.totalJSHeapSize;
            const limit = memory.jsHeapSizeLimit;

            if (used / limit > 0.9) {
                this.logger.warn('High memory usage detected:', {
                    used: used / 1024 / 1024 + 'MB',
                    total: total / 1024 / 1024 + 'MB',
                    limit: limit / 1024 / 1024 + 'MB'
                });
            }
        }, 30000); // 每30秒检查一次
    }

    /**
     * 设置i18n回调
     */
    setupI18nCallbacks() {
        // 监听语言变化
        chrome.i18n.onLanguageChanged?.addListener(() => {
            this.logger.info('Language changed, reloading...');
            window.location.reload();
        });
    }

    /**
     * 预加载常用消息
     */
    preloadCommonMessages() {
        const commonMessages = [
            'extName',
            'extDesc',
            'searchBookmarks',
            'name',
            'url',
            'save',
            'cancel',
            'delete',
            'edit',
            'addBookmark',
            'addFolder'
        ];

        // 预加载消息到内存
        window.vBookmarksMessages = {};
        commonMessages.forEach(key => {
            try {
                window.vBookmarksMessages[key] = chrome.i18n.getMessage(key);
            } catch (error) {
                this.logger.warn(`Could not load message '${key}':`, error);
            }
        });
    }

    /**
     * 获取嵌套对象属性
     */
    getNestedProperty(obj, path) {
        return path.split('.').reduce((current, key) => current && current[key], obj);
    }

    /**
     * 获取初始化状态
     */
    getInitializationStatus() {
        return {
            initialized: this.initialized,
            platform: this.platform,
            chromeVersion: this.chromeVersion,
            isRTL: this.isRTL,
            isDevelopment: this.isDevelopment
        };
    }

    /**
     * 销毁初始化器
     */
    async destroy() {
        this.logger.info('Destroying AppInitializer...');

        // 清理事件监听器
        window.removeEventListener('error', this.handleGlobalError);
        window.removeEventListener('unhandledrejection', this.handleUnhandledRejection);

        if (chrome.runtime.onLastError) {
            chrome.runtime.onLastError.removeListener(this.handleChromeError);
        }

        this.initialized = false;
        this.logger.info('AppInitializer destroyed');
    }
}

// 导出初始化器
export default AppInitializer;