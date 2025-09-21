/**
 * 键盘导航管理器
 * 提供现代化的书签键盘导航功能
 */

import { Logger } from '../utils/logger.js';

const logger = new Logger('KeyboardNavigation');

/**
 * 键盘导航管理器类
 */
export class KeyboardNavigation {
    constructor(options = {}) {
        this.options = {
            // 导航选项
            wrapNavigation: true,
            searchOnType: true,
            focusFirstItem: true,
            useArrowKeys: true,
            useTabKey: true,
            useHomeEnd: true,
            usePageUpDown: true,

            // 快捷键选项
            enableShortcuts: true,
            enableModifications: true,
            enableQuickSearch: true,

            // 行为选项
            autoExpandFolders: true,
            autoFocusSearch: true,
            rememberFocus: true,

            // 事件选项
            preventDefaultOnHandled: true,
            bubbleUnhandledEvents: false,

            // 可访问性选项
            enableAriaLabels: true,
            enableScreenReader: true,

            // 用户覆盖选项
            ...options
        };

        this.state = {
            focusedElement: null,
            lastFocusedElement: null,
            searchMode: false,
            navigationMode: 'tree', // 'tree', 'search', 'menu'
            keyBuffer: '',
            keyBufferTimer: null,
            navigationStack: [],
            contextMenuOpen: false
        };

        this.shortcuts = new Map();
        this.handlers = new Map();
        this.treeContainer = null;
        this.searchInput = null;
        this.resultsContainer = null;

        this.init();
    }

    /**
     * 初始化键盘导航管理器
     */
    init() {
        this.setupEventListeners();
        this.setupDefaultShortcuts();
        this.setupDefaultHandlers();
        this.detectEnvironment();
    }

    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        document.addEventListener('keydown', this.handleKeyDown.bind(this));
        document.addEventListener('keyup', this.handleKeyUp.bind(this));
        document.addEventListener('focusin', this.handleFocusIn.bind(this));
        document.addEventListener('focusout', this.handleFocusOut.bind(this));

        // 阻止某些默认行为
        document.addEventListener('keydown', (e) => {
            if (this.shouldPreventDefault(e)) {
                e.preventDefault();
            }
        });
    }

    /**
     * 设置默认快捷键
     */
    setupDefaultShortcuts() {
        // 基础导航快捷键
        this.registerShortcut('ArrowDown', 'navigate-next');
        this.registerShortcut('ArrowUp', 'navigate-previous');
        this.registerShortcut('ArrowRight', 'expand-folder');
        this.registerShortcut('ArrowLeft', 'collapse-folder');
        this.registerShortcut('Home', 'navigate-first');
        this.registerShortcut('End', 'navigate-last');
        this.registerShortcut('PageUp', 'navigate-page-up');
        this.registerShortcut('PageDown', 'navigate-page-down');

        // 选择和操作快捷键
        this.registerShortcut('Enter', 'activate-item');
        this.registerShortcut(' ', 'activate-item');
        this.registerShortcut('F2', 'rename-item');
        this.registerShortcut('Delete', 'delete-item');

        // 搜索快捷键
        this.registerShortcut('/', 'focus-search');
        this.registerShortcut('Ctrl+F', 'focus-search');
        this.registerShortcut('Ctrl+K', 'focus-search');
        this.registerShortcut('Escape', 'escape');

        // 创建和编辑快捷键
        this.registerShortcut('Ctrl+N', 'create-bookmark');
        this.registerShortcut('Ctrl+Shift+N', 'create-folder');
        this.registerShortcut('Ctrl+E', 'edit-item');
        this.registerShortcut('F3', 'edit-item');

        // 视图切换快捷键
        this.registerShortcut('Ctrl+1', 'view-tree');
        this.registerShortcut('Ctrl+2', 'view-search');
        this.registerShortcut('Ctrl+3', 'view-editor');

        // 实用工具快捷键
        this.registerShortcut('Ctrl+R', 'refresh');
        this.registerShortcut('F5', 'refresh');
        this.registerShortcut('Ctrl+S', 'save');
        this.registerShortcut('Ctrl+O', 'open');

        // 辅助功能快捷键
        this.registerShortcut('Tab', 'next-focus');
        this.registerShortcut('Shift+Tab', 'previous-focus');
        this.registerShortcut('F6', 'cycle-focus');
    }

    /**
     * 设置默认处理器
     */
    setupDefaultHandlers() {
        // 导航处理器
        this.registerHandler('navigate-next', this.navigateNext.bind(this));
        this.registerHandler('navigate-previous', this.navigatePrevious.bind(this));
        this.registerHandler('expand-folder', this.expandFolder.bind(this));
        this.registerHandler('collapse-folder', this.collapseFolder.bind(this));
        this.registerHandler('navigate-first', this.navigateFirst.bind(this));
        this.registerHandler('navigate-last', this.navigateLast.bind(this));
        this.registerHandler('navigate-page-up', this.navigatePageUp.bind(this));
        this.registerHandler('navigate-page-down', this.navigatePageDown.bind(this));

        // 操作处理器
        this.registerHandler('activate-item', this.activateItem.bind(this));
        this.registerHandler('rename-item', this.renameItem.bind(this));
        this.registerHandler('delete-item', this.deleteItem.bind(this));

        // 搜索处理器
        this.registerHandler('focus-search', this.focusSearch.bind(this));
        this.registerHandler('escape', this.escape.bind(this));

        // 创建和编辑处理器
        this.registerHandler('create-bookmark', this.createBookmark.bind(this));
        this.registerHandler('create-folder', this.createFolder.bind(this));
        this.registerHandler('edit-item', this.editItem.bind(this));

        // 视图处理器
        this.registerHandler('view-tree', this.viewTree.bind(this));
        this.registerHandler('view-search', this.viewSearch.bind(this));
        this.registerHandler('view-editor', this.viewEditor.bind(this));

        // 实用工具处理器
        this.registerHandler('refresh', this.refresh.bind(this));
        this.registerHandler('save', this.save.bind(this));
        this.registerHandler('open', this.open.bind(this));

        // 辅助功能处理器
        this.registerHandler('next-focus', this.nextFocus.bind(this));
        this.registerHandler('previous-focus', this.previousFocus.bind(this));
        this.registerHandler('cycle-focus', this.cycleFocus.bind(this));
    }

    /**
     * 检测环境
     */
    detectEnvironment() {
        this.platform = this.detectPlatform();
        this.isRTL = this.checkRTL();
        this.isMac = /mac/i.test(navigator.platform);
        this.isMobile = /mobile|android|ios/i.test(navigator.userAgent);
    }

    /**
     * 检测平台
     * @returns {string} 平台名称
     */
    detectPlatform() {
        const platform = navigator.platform.toLowerCase();
        if (platform.includes('mac')) return 'mac';
        if (platform.includes('win')) return 'windows';
        if (platform.includes('linux')) return 'linux';
        return 'other';
    }

    /**
     * 检查RTL语言
     * @returns {boolean} 是否为RTL语言
     */
    checkRTL() {
        return document.documentElement.getAttribute('dir') === 'rtl' ||
               window.getComputedStyle(document.documentElement).direction === 'rtl';
    }

    /**
     * 注册快捷键
     * @param {string} key - 快捷键
     * @param {string} action - 动作
     */
    registerShortcut(key, action) {
        this.shortcuts.set(key.toLowerCase(), action);
    }

    /**
     * 注册处理器
     * @param {string} action - 动作
     * @param {Function} handler - 处理器函数
     */
    registerHandler(action, handler) {
        this.handlers.set(action, handler);
    }

    /**
     * 处理键盘按下事件
     * @param {KeyboardEvent} e - 键盘事件
     */
    handleKeyDown(e) {
        if (!this.shouldHandleKeyEvent(e)) {
            return;
        }

        const keyInfo = this.parseKeyEvent(e);
        const action = this.shortcuts.get(keyInfo.combo);

        if (action) {
            const handler = this.handlers.get(action);
            if (handler) {
                if (this.options.preventDefaultOnHandled) {
                    e.preventDefault();
                }

                try {
                    handler(e, keyInfo);
                    logger.debug(`Keyboard action executed: ${action}`);
                } catch (error) {
                    logger.error(`Failed to execute keyboard action ${action}:`, error);
                }
            }
        } else if (this.options.searchOnType && this.isTypableCharacter(e.key)) {
            this.handleTyping(e);
        }
    }

    /**
     * 处理键盘释放事件
     * @param {KeyboardEvent} e - 键盘事件
     */
    handleKeyUp(e) {
        // 处理键盘释放事件
        if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Meta' || e.key === 'Alt') {
            this.updateModifierState();
        }
    }

    /**
     * 处理焦点进入事件
     * @param {FocusEvent} e - 焦点事件
     */
    handleFocusIn(e) {
        this.state.focusedElement = e.target;

        if (this.options.rememberFocus) {
            this.state.lastFocusedElement = e.target;
        }

        // 更新导航栈
        this.updateNavigationStack(e.target);
    }

    /**
     * 处理焦点离开事件
     * @param {FocusEvent} e - 焦点事件
     */
    handleFocusOut(e) {
        // 清理状态
        if (this.state.focusedElement === e.target) {
            this.state.focusedElement = null;
        }
    }

    /**
     * 是否应该处理键盘事件
     * @param {KeyboardEvent} e - 键盘事件
     * @returns {boolean} 是否应该处理
     */
    shouldHandleKeyEvent(e) {
        // 忽略在输入框中的事件
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
            // 搜索框特殊处理
            if (e.target.id !== 'search-input' && e.target.id !== 'searchInput') {
                return false;
            }
        }

        // 忽略修饰键单独按下
        if (['Shift', 'Control', 'Meta', 'Alt'].includes(e.key)) {
            return false;
        }

        return true;
    }

    /**
     * 是否应该阻止默认行为
     * @param {KeyboardEvent} e - 键盘事件
     * @returns {boolean} 是否应该阻止
     */
    shouldPreventDefault(e) {
        const keyInfo = this.parseKeyEvent(e);
        return this.shortcuts.has(keyInfo.combo);
    }

    /**
     * 解析键盘事件
     * @param {KeyboardEvent} e - 键盘事件
     * @returns {object} 键盘信息
     */
    parseKeyEvent(e) {
        const parts = [];

        if (e.ctrlKey) parts.push('Ctrl');
        if (e.metaKey) parts.push('Meta');
        if (e.altKey) parts.push('Alt');
        if (e.shiftKey) parts.push('Shift');

        parts.push(e.key);

        return {
            key: e.key,
            ctrlKey: e.ctrlKey,
            metaKey: e.metaKey,
            altKey: e.altKey,
            shiftKey: e.shiftKey,
            combo: parts.join('+').toLowerCase()
        };
    }

    /**
     * 是否为可输入字符
     * @param {string} key - 键盘按键
     * @returns {boolean} 是否为可输入字符
     */
    isTypableCharacter(key) {
        return key.length === 1 && /[a-zA-Z0-9\u4e00-\u9fa5]/.test(key);
    }

    /**
     * 处理输入字符
     * @param {KeyboardEvent} e - 键盘事件
     */
    handleTyping(e) {
        if (!this.options.searchOnType) return;

        // 添加到键缓冲区
        this.state.keyBuffer += e.key;

        // 清除之前的定时器
        if (this.state.keyBufferTimer) {
            clearTimeout(this.state.keyBufferTimer);
        }

        // 设置新的定时器
        this.state.keyBufferTimer = setTimeout(() => {
            this.searchByText(this.state.keyBuffer);
            this.state.keyBuffer = '';
        }, 300);

        // 立即搜索
        this.searchByText(this.state.keyBuffer);
    }

    /**
     * 根据文本搜索
     * @param {string} text - 搜索文本
     */
    searchByText(text) {
        if (!text.trim()) return;

        // 触发搜索事件
        this.emitEvent('search', { text, source: 'keyboard' });
        logger.debug(`Keyboard search initiated: ${text}`);
    }

    /**
     * 导航处理器实现
     */
    navigateNext(e) {
        const current = this.getCurrentNavigableElement();
        if (!current) return;

        const next = this.getNextNavigableElement(current);
        if (next) {
            this.focusElement(next);
        }
    }

    navigatePrevious(e) {
        const current = this.getCurrentNavigableElement();
        if (!current) return;

        const previous = this.getPreviousNavigableElement(current);
        if (previous) {
            this.focusElement(previous);
        }
    }

    expandFolder(e) {
        const current = this.getCurrentNavigableElement();
        if (!current) return;

        const folder = this.getFolderElement(current);
        if (folder && !this.isFolderExpanded(folder)) {
            this.toggleFolder(folder, true);
        }
    }

    collapseFolder(e) {
        const current = this.getCurrentNavigableElement();
        if (!current) return;

        const folder = this.getFolderElement(current);
        if (folder && this.isFolderExpanded(folder)) {
            this.toggleFolder(folder, false);
        }
    }

    navigateFirst(e) {
        const first = this.getFirstNavigableElement();
        if (first) {
            this.focusElement(first);
        }
    }

    navigateLast(e) {
        const last = this.getLastNavigableElement();
        if (last) {
            this.focusElement(last);
        }
    }

    navigatePageUp(e) {
        const current = this.getCurrentNavigableElement();
        if (!current) return;

        const pageUp = this.getPageUpElement(current);
        if (pageUp) {
            this.focusElement(pageUp);
        }
    }

    navigatePageDown(e) {
        const current = this.getCurrentNavigableElement();
        if (!current) return;

        const pageDown = this.getPageDownElement(current);
        if (pageDown) {
            this.focusElement(pageDown);
        }
    }

    /**
     * 操作处理器实现
     */
    activateItem(e) {
        const current = this.getCurrentNavigableElement();
        if (!current) return;

        // 模拟点击
        const event = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window
        });
        current.dispatchEvent(event);
    }

    renameItem(e) {
        const current = this.getCurrentNavigableElement();
        if (!current) return;

        this.emitEvent('rename', { element: current });
    }

    deleteItem(e) {
        const current = this.getCurrentNavigableElement();
        if (!current) return;

        this.emitEvent('delete', { element: current });
    }

    /**
     * 搜索处理器实现
     */
    focusSearch(e) {
        const searchInput = document.getElementById('search-input') ||
                           document.getElementById('searchInput');
        if (searchInput) {
            searchInput.focus();
            searchInput.select();
        }
    }

    escape(e) {
        if (this.state.searchMode) {
            this.quitSearchMode();
        } else if (this.state.contextMenuOpen) {
            this.closeContextMenu();
        } else {
            // 关闭弹出窗口
            if (window.close) {
                window.close();
            }
        }
    }

    /**
     * 创建和编辑处理器实现
     */
    createBookmark(e) {
        this.emitEvent('create-bookmark');
    }

    createFolder(e) {
        this.emitEvent('create-folder');
    }

    editItem(e) {
        const current = this.getCurrentNavigableElement();
        if (!current) return;

        this.emitEvent('edit', { element: current });
    }

    /**
     * 视图处理器实现
     */
    viewTree(e) {
        this.switchView('tree');
    }

    viewSearch(e) {
        this.switchView('search');
    }

    viewEditor(e) {
        this.switchView('editor');
    }

    /**
     * 实用工具处理器实现
     */
    refresh(e) {
        this.emitEvent('refresh');
    }

    save(e) {
        this.emitEvent('save');
    }

    open(e) {
        const current = this.getCurrentNavigableElement();
        if (!current) return;

        this.emitEvent('open', { element: current });
    }

    /**
     * 辅助功能处理器实现
     */
    nextFocus(e) {
        this.moveFocus(1);
    }

    previousFocus(e) {
        this.moveFocus(-1);
    }

    cycleFocus(e) {
        this.cycleThroughFocusAreas();
    }

    /**
     * 导航辅助方法
     */
    getCurrentNavigableElement() {
        if (this.state.focusedElement) {
            return this.state.focusedElement;
        }
        return document.activeElement;
    }

    getNextNavigableElement(current) {
        const allElements = this.getNavigableElements();
        const index = allElements.indexOf(current);
        if (index === -1) return null;

        if (index < allElements.length - 1) {
            return allElements[index + 1];
        } else if (this.options.wrapNavigation) {
            return allElements[0];
        }
        return null;
    }

    getPreviousNavigableElement(current) {
        const allElements = this.getNavigableElements();
        const index = allElements.indexOf(current);
        if (index === -1) return null;

        if (index > 0) {
            return allElements[index - 1];
        } else if (this.options.wrapNavigation) {
            return allElements[allElements.length - 1];
        }
        return null;
    }

    getFirstNavigableElement() {
        const allElements = this.getNavigableElements();
        return allElements.length > 0 ? allElements[0] : null;
    }

    getLastNavigableElement() {
        const allElements = this.getNavigableElements();
        return allElements.length > 0 ? allElements[allElements.length - 1] : null;
    }

    getPageUpElement(current) {
        // 实现PageUp逻辑
        return this.getPreviousNavigableElement(current);
    }

    getPageDownElement(current) {
        // 实现PageDown逻辑
        return this.getNextNavigableElement(current);
    }

    getNavigableElements() {
        const selector = [
            'a[href]',
            'button',
            '[tabindex]:not([tabindex="-1"])',
            '[role="button"]',
            '[role="link"]',
            '.tree-item-link',
            '.tree-item-span',
            '.bookmark-item',
            '.folder-item'
        ].join(', ');

        return Array.from(document.querySelectorAll(selector));
    }

    /**
     * 文件夹操作方法
     */
    getFolderElement(element) {
        return element.closest('.folder-item, [data-type="folder"]');
    }

    isFolderExpanded(folder) {
        return folder.classList.contains('open') ||
               folder.getAttribute('aria-expanded') === 'true';
    }

    toggleFolder(folder, expand) {
        const event = new CustomEvent('folder-toggle', {
            detail: { folder, expand },
            bubbles: true,
            cancelable: true
        });
        folder.dispatchEvent(event);
    }

    /**
     * 焦点操作方法
     */
    focusElement(element) {
        if (element) {
            element.focus();
            this.state.focusedElement = element;
        }
    }

    moveFocus(direction) {
        const focusableElements = this.getNavigableElements();
        const currentIndex = focusableElements.indexOf(document.activeElement);

        if (currentIndex === -1) {
            this.focusElement(focusableElements[0]);
            return;
        }

        let newIndex = currentIndex + direction;
        if (newIndex < 0) {
            newIndex = this.options.wrapNavigation ? focusableElements.length - 1 : 0;
        } else if (newIndex >= focusableElements.length) {
            newIndex = this.options.wrapNavigation ? 0 : focusableElements.length - 1;
        }

        this.focusElement(focusableElements[newIndex]);
    }

    cycleThroughFocusAreas() {
        // 实现焦点区域循环
        const areas = ['.tree-container', '.search-container', '.status-bar'];
        const currentArea = document.activeElement ?
            document.activeElement.closest(areas.join(',')) : null;

        const currentIndex = currentArea ? areas.indexOf(currentArea.className) : -1;
        const nextIndex = (currentIndex + 1) % areas.length;

        const nextArea = document.querySelector(areas[nextIndex]);
        if (nextArea) {
            const firstFocusable = nextArea.querySelector(this.getNavigableElements().join(','));
            if (firstFocusable) {
                this.focusElement(firstFocusable);
            }
        }
    }

    /**
     * 搜索相关方法
     */
    quitSearchMode() {
        this.state.searchMode = false;
        const searchInput = document.getElementById('search-input') ||
                           document.getElementById('searchInput');
        if (searchInput) {
            searchInput.value = '';
            searchInput.blur();
        }
        this.emitEvent('search-exit');
    }

    closeContextMenu() {
        this.state.contextMenuOpen = false;
        this.emitEvent('contextmenu-close');
    }

    /**
     * 视图切换方法
     */
    switchView(view) {
        this.state.navigationMode = view;
        this.emitEvent('view-change', { view });
    }

    /**
     * 导航栈管理
     */
    updateNavigationStack(element) {
        // 实现导航栈管理
        this.state.navigationStack.push(element);
        if (this.state.navigationStack.length > 50) {
            this.state.navigationStack.shift();
        }
    }

    /**
     * 事件发射方法
     */
    emitEvent(eventName, data = {}) {
        const event = new CustomEvent(`keyboard-${eventName}`, {
            detail: data,
            bubbles: true,
            cancelable: true
        });
        document.dispatchEvent(event);
    }

    /**
     * 修改键状态更新
     */
    updateModifierState() {
        // 更新修改键状态
    }

    /**
     * 设置容器引用
     */
    setContainers(treeContainer, searchInput, resultsContainer) {
        this.treeContainer = treeContainer;
        this.searchInput = searchInput;
        this.resultsContainer = resultsContainer;
    }

    /**
     * 销毁键盘导航管理器
     */
    destroy() {
        document.removeEventListener('keydown', this.handleKeyDown);
        document.removeEventListener('keyup', this.handleKeyUp);
        document.removeEventListener('focusin', this.handleFocusIn);
        document.removeEventListener('focusout', this.handleFocusOut);

        this.shortcuts.clear();
        this.handlers.clear();

        if (this.state.keyBufferTimer) {
            clearTimeout(this.state.keyBufferTimer);
        }

        logger.info('Keyboard navigation manager destroyed');
    }
}

// 创建全局键盘导航管理器实例
let globalKeyboardNavigation = null;

/**
 * 获取全局键盘导航管理器
 * @returns {KeyboardNavigation} 键盘导航管理器实例
 */
export function getKeyboardNavigation() {
    if (!globalKeyboardNavigation) {
        globalKeyboardNavigation = new KeyboardNavigation();
    }
    return globalKeyboardNavigation;
}

// 导出工具函数
export { KeyboardNavigation as default };