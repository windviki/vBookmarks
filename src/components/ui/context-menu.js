/**
 * 上下文菜单管理器
 * 提供现代化的右键菜单功能
 */

import { Logger } from '../utils/logger.js';

const logger = new Logger('ContextMenu');

/**
 * 上下文菜单管理器类
 */
export class ContextMenuManager {
    constructor(options = {}) {
        this.options = {
            // 菜单选项
            enableAnimations: true,
            enableKeyboardNavigation: true,
            enableMouseTracking: true,
            enableSubmenus: true,
            closeOnOutsideClick: true,
            closeOnEscape: true,
            closeOnItemSelect: true,

            // 位置选项
            autoPosition: true,
            position: 'bottom-right', // 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'auto'
            margin: 4,
            viewportPadding: 8,

            // 样式选项
            theme: 'auto',
            minWidth: 180,
            maxWidth: 300,
            maxHeight: 400,

            // 事件选项
            preventDefaultOnContextMenu: true,
            bubbleEvents: false,

            // 可访问性选项
            enableAriaLabels: true,
            enableScreenReader: true,

            // 用户覆盖选项
            ...options
        };

        this.state = {
            isOpen: false,
            currentMenu: null,
            currentTarget: null,
            activeItem: null,
            submenus: new Map(),
            keyboardMode: false
        };

        this.menus = new Map();
        this.handlers = new Map();
        this.shortcuts = new Map();

        this.init();
    }

    /**
     * 初始化上下文菜单管理器
     */
    init() {
        this.setupStyles();
        this.setupEventListeners();
        this.setupDefaultMenus();
        this.setupKeyboardShortcuts();
        this.detectEnvironment();
    }

    /**
     * 设置上下文菜单样式
     */
    setupStyles() {
        if (document.getElementById('context-menu-styles')) {
            return;
        }

        const styles = `
            /* 上下文菜单容器 */
            .context-menu {
                position: fixed;
                z-index: 10001;
                background: var(--bg-primary);
                border: 1px solid var(--border-primary);
                border-radius: var(--radius-md);
                box-shadow: var(--shadow-xl);
                min-width: ${this.options.minWidth}px;
                max-width: ${this.options.maxWidth}px;
                max-height: ${this.options.maxHeight}px;
                overflow-y: auto;
                opacity: 0;
                transform: scale(0.95) translateY(-10px);
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                pointer-events: none;
                outline: none;
            }

            .context-menu.show {
                opacity: 1;
                transform: scale(1) translateY(0);
                pointer-events: auto;
            }

            /* 上下文菜单项 */
            .context-menu-item {
                position: relative;
                display: flex;
                align-items: center;
                padding: var(--spacing-sm) var(--spacing-md);
                margin: 1px;
                border-radius: var(--radius-sm);
                color: var(--text-primary);
                text-decoration: none;
                cursor: pointer;
                transition: all 0.15s ease;
                user-select: none;
                -webkit-user-select: none;
                -moz-user-select: none;
                -ms-user-select: none;
                outline: none;
            }

            .context-menu-item:hover {
                background: var(--bg-tertiary);
                color: var(--text-primary);
            }

            .context-menu-item:focus {
                background: var(--color-primary);
                color: var(--text-inverse);
                outline: none;
            }

            .context-menu-item.disabled {
                opacity: 0.5;
                cursor: not-allowed;
                color: var(--text-disabled);
            }

            .context-menu-item.disabled:hover {
                background: transparent;
            }

            .context-menu-item.disabled:focus {
                background: var(--bg-tertiary);
                color: var(--text-disabled);
            }

            /* 菜单项图标 */
            .context-menu-item-icon {
                width: 16px;
                height: 16px;
                margin-right: var(--spacing-sm);
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
            }

            .context-menu-item-icon svg {
                width: 100%;
                height: 100%;
                fill: currentColor;
            }

            /* 菜单项文本 */
            .context-menu-item-text {
                flex: 1;
                font-size: var(--font-size-sm);
                line-height: var(--line-height-normal);
            }

            /* 菜单项快捷键 */
            .context-menu-item-shortcut {
                margin-left: var(--spacing-md);
                font-size: var(--font-size-xs);
                color: var(--text-secondary);
                font-family: monospace;
                opacity: 0.7;
            }

            /* 子菜单箭头 */
            .context-menu-item-arrow {
                margin-left: var(--spacing-sm);
                width: 12px;
                height: 12px;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0.6;
            }

            .context-menu-item-arrow::before {
                content: '▶';
                font-size: 8px;
                color: currentColor;
            }

            /* 菜单分隔符 */
            .context-menu-separator {
                height: 1px;
                background: var(--border-secondary);
                margin: var(--spacing-xs) var(--spacing-md);
                opacity: 0.6;
            }

            /* 子菜单 */
            .context-menu-submenu {
                position: absolute;
                top: 0;
                left: 100%;
                margin-left: var(--spacing-xs);
                opacity: 0;
                transform: scale(0.95) translateY(-10px);
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                pointer-events: none;
            }

            .context-menu-submenu.show {
                opacity: 1;
                transform: scale(1) translateY(0);
                pointer-events: auto;
            }

            /* 子菜单箭头 RTL */
            [dir="rtl"] .context-menu-item-arrow::before {
                content: '◀';
            }

            [dir="rtl"] .context-menu-submenu {
                left: auto;
                right: 100%;
                margin-left: 0;
                margin-right: var(--spacing-xs);
            }

            /* 菜单组标题 */
            .context-menu-group-title {
                padding: var(--spacing-xs) var(--spacing-md);
                margin: var(--spacing-xs) var(--spacing-md) 0;
                font-size: var(--font-size-xs);
                font-weight: var(--font-weight-bold);
                color: var(--text-secondary);
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            /* 菜单动画 */
            @keyframes contextMenuSlideIn {
                from {
                    opacity: 0;
                    transform: scale(0.95) translateY(-10px);
                }
                to {
                    opacity: 1;
                    transform: scale(1) translateY(0);
                }
            }

            .context-menu.animate-show {
                animation: contextMenuSlideIn 0.2s cubic-bezier(0.4, 0, 0.2, 1) forwards;
            }

            /* 菜单状态指示器 */
            .context-menu-item.checked .context-menu-item-icon::before {
                content: '✓';
                font-weight: bold;
                color: var(--color-primary);
            }

            .context-menu-item.danger {
                color: var(--color-error);
            }

            .context-menu-item.danger:focus {
                background: var(--color-error);
                color: var(--text-inverse);
            }

            /* 响应式设计 */
            @media (max-width: 768px) {
                .context-menu {
                    min-width: 160px;
                    max-width: 250px;
                    font-size: var(--font-size-xs);
                }

                .context-menu-item-shortcut {
                    display: none;
                }
            }

            @media (max-width: 480px) {
                .context-menu {
                    min-width: 140px;
                    max-width: 200px;
                }
            }

            /* 高对比度模式 */
            @media (prefers-contrast: high) {
                .context-menu {
                    border-width: 2px;
                }

                .context-menu-item:focus {
                    outline: 2px solid var(--color-primary);
                    outline-offset: -2px;
                }
            }

            /* 减少动画偏好 */
            @media (prefers-reduced-motion: reduce) {
                .context-menu,
                .context-menu-submenu,
                .context-menu-item {
                    transition: none;
                }

                .context-menu.animate-show {
                    animation: none;
                }
            }

            /* 深色主题适配 */
            [data-theme="dark"] .context-menu {
                background: var(--bg-primary);
                border-color: var(--border-primary);
            }

            [data-theme="dark"] .context-menu-item {
                color: var(--text-primary);
            }

            [data-theme="dark"] .context-menu-item:hover {
                background: var(--bg-tertiary);
            }

            [data-theme="dark"] .context-menu-item-shortcut {
                color: var(--text-secondary);
            }

            /* 可访问性增强 */
            .context-menu-item:focus-visible {
                outline: 2px solid var(--color-primary);
                outline-offset: -2px;
            }

            .context-menu[role="menu"] {
                outline: none;
            }

            /* 滚动条样式 */
            .context-menu::-webkit-scrollbar {
                width: 6px;
            }

            .context-menu::-webkit-scrollbar-track {
                background: var(--bg-secondary);
            }

            .context-menu::-webkit-scrollbar-thumb {
                background: var(--border-primary);
                border-radius: 3px;
            }

            .context-menu::-webkit-scrollbar-thumb:hover {
                background: var(--text-secondary);
            }
        `;

        const styleElement = document.createElement('style');
        styleElement.id = 'context-menu-styles';
        styleElement.textContent = styles;
        document.head.appendChild(styleElement);
    }

    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        // 全局点击事件
        document.addEventListener('click', this.handleGlobalClick.bind(this));
        document.addEventListener('contextmenu', this.handleGlobalContextMenu.bind(this));
        document.addEventListener('keydown', this.handleGlobalKeyDown.bind(this));
        document.addEventListener('resize', this.handleResize.bind(this));
        document.addEventListener('scroll', this.handleScroll.bind(this));
    }

    /**
     * 设置默认菜单
     */
    setupDefaultMenus() {
        // 书签菜单
        this.registerMenu('bookmark', [
            {
                id: 'open',
                text: '打开',
                icon: '📎',
                shortcut: 'Enter',
                action: 'open-bookmark'
            },
            {
                id: 'open-new-tab',
                text: '在新标签页中打开',
                icon: '📄',
                shortcut: 'Ctrl+Enter',
                action: 'open-bookmark-new-tab'
            },
            {
                id: 'open-new-window',
                text: '在新窗口中打开',
                icon: '🪟',
                shortcut: 'Shift+Enter',
                action: 'open-bookmark-new-window'
            },
            { type: 'separator' },
            {
                id: 'edit',
                text: '编辑',
                icon: '✏️',
                shortcut: 'F2',
                action: 'edit-bookmark'
            },
            {
                id: 'delete',
                text: '删除',
                icon: '🗑️',
                shortcut: 'Delete',
                action: 'delete-bookmark',
                danger: true
            },
            { type: 'separator' },
            {
                id: 'copy',
                text: '复制URL',
                icon: '📋',
                shortcut: 'Ctrl+C',
                action: 'copy-bookmark-url'
            },
            {
                id: 'copy-title-url',
                text: '复制标题和URL',
                icon: '📋',
                action: 'copy-bookmark-title-url'
            }
        ]);

        // 文件夹菜单
        this.registerMenu('folder', [
            {
                id: 'expand',
                text: '展开',
                icon: '📂',
                action: 'expand-folder'
            },
            {
                id: 'collapse',
                text: '折叠',
                icon: '📁',
                action: 'collapse-folder'
            },
            { type: 'separator' },
            {
                id: 'open-all',
                text: '打开所有书签',
                icon: '🔗',
                action: 'open-all-bookmarks'
            },
            {
                id: 'open-all-new-tabs',
                text: '在新标签页中打开所有',
                icon: '📄',
                shortcut: 'Ctrl+Shift+O',
                action: 'open-all-bookmarks-new-tabs'
            },
            { type: 'separator' },
            {
                id: 'add-bookmark',
                text: '添加书签',
                icon: '📎',
                action: 'add-bookmark-to-folder'
            },
            {
                id: 'add-folder',
                text: '添加子文件夹',
                icon: '📁',
                action: 'add-subfolder'
            },
            { type: 'separator' },
            {
                id: 'rename',
                text: '重命名',
                icon: '✏️',
                shortcut: 'F2',
                action: 'rename-folder'
            },
            {
                id: 'delete',
                text: '删除',
                icon: '🗑️',
                shortcut: 'Delete',
                action: 'delete-folder',
                danger: true
            }
        ]);

        // 分隔符菜单
        this.registerMenu('separator', [
            {
                id: 'delete',
                text: '删除分隔符',
                icon: '🗑️',
                action: 'delete-separator',
                danger: true
            }
        ]);

        // 树形菜单
        this.registerMenu('tree', [
            {
                id: 'add-bookmark',
                text: '添加书签',
                icon: '📎',
                shortcut: 'Ctrl+N',
                action: 'add-bookmark'
            },
            {
                id: 'add-folder',
                text: '添加文件夹',
                icon: '📁',
                shortcut: 'Ctrl+Shift+N',
                action: 'add-folder'
            },
            { type: 'separator' },
            {
                id: 'paste',
                text: '粘贴',
                icon: '📋',
                shortcut: 'Ctrl+V',
                action: 'paste-bookmark'
            },
            { type: 'separator' },
            {
                id: 'sort-by-name',
                text: '按名称排序',
                icon: '🔤',
                action: 'sort-by-name'
            },
            {
                id: 'sort-by-date',
                text: '按日期排序',
                icon: '📅',
                action: 'sort-by-date'
            }
        ]);
    }

    /**
     * 设置键盘快捷键
     */
    setupKeyboardShortcuts() {
        // 菜单导航快捷键
        this.shortcuts.set('ArrowDown', 'navigate-next');
        this.shortcuts.set('ArrowUp', 'navigate-previous');
        this.shortcuts.set('ArrowRight', 'open-submenu');
        this.shortcuts.set('ArrowLeft', 'close-submenu');
        this.shortcuts.set('Home', 'navigate-first');
        this.shortcuts.set('End', 'navigate-last');
        this.shortcuts.set('Enter', 'activate-item');
        this.shortcuts.set(' ', 'activate-item');
        this.shortcuts.set('Escape', 'close-menu');

        // 设置默认处理器
        this.handlers.set('navigate-next', this.navigateNext.bind(this));
        this.handlers.set('navigate-previous', this.navigatePrevious.bind(this));
        this.handlers.set('open-submenu', this.openSubmenu.bind(this));
        this.handlers.set('close-submenu', this.closeSubmenu.bind(this));
        this.handlers.set('navigate-first', this.navigateFirst.bind(this));
        this.handlers.set('navigate-last', this.navigateLast.bind(this));
        this.handlers.set('activate-item', this.activateItem.bind(this));
        this.handlers.set('close-menu', this.closeMenu.bind(this));
    }

    /**
     * 检测环境
     */
    detectEnvironment() {
        this.platform = this.detectPlatform();
        this.isRTL = this.checkRTL();
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
     * 注册菜单
     * @param {string} menuId - 菜单ID
     * @param {Array} items - 菜单项数组
     */
    registerMenu(menuId, items) {
        this.menus.set(menuId, items);
    }

    /**
     * 注册菜单项处理器
     * @param {string} action - 动作
     * @param {Function} handler - 处理器函数
     */
    registerHandler(action, handler) {
        this.handlers.set(action, handler);
    }

    /**
     * 显示上下文菜单
     * @param {string} menuId - 菜单ID
     * @param {MouseEvent} event - 鼠标事件
     * @param {object} context - 上下文信息
     */
    showMenu(menuId, event, context = {}) {
        if (!this.menus.has(menuId)) {
            logger.warn(`Menu not found: ${menuId}`);
            return;
        }

        // 阻止默认上下文菜单
        if (this.options.preventDefaultOnContextMenu) {
            event.preventDefault();
            event.stopPropagation();
        }

        // 关闭已打开的菜单
        this.closeMenu();

        // 创建菜单元素
        const menu = this.createMenuElement(menuId, context);
        document.body.appendChild(menu);

        // 设置菜单状态
        this.state.isOpen = true;
        this.state.currentMenu = menu;
        this.state.currentTarget = event.target;
        this.state.keyboardMode = false;

        // 定位菜单
        this.positionMenu(menu, event);

        // 显示菜单
        requestAnimationFrame(() => {
            menu.classList.add('show');
            menu.focus();
        });

        // 设置事件监听器
        this.setupMenuEventListeners(menu);

        // 触发显示事件
        this.emitEvent('menu-show', { menuId, menu, context });

        logger.debug(`Context menu shown: ${menuId}`);
    }

    /**
     * 创建菜单元素
     * @param {string} menuId - 菜单ID
     * @param {object} context - 上下文信息
     * @returns {HTMLElement} 菜单元素
     */
    createMenuElement(menuId, context) {
        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('tabindex', '-1');
        menu.dataset.menuId = menuId;

        const items = this.menus.get(menuId);
        if (!items) return menu;

        items.forEach(item => {
            if (item.type === 'separator') {
                menu.appendChild(this.createSeparatorElement());
            } else if (item.type === 'group') {
                menu.appendChild(this.createGroupElement(item));
            } else {
                menu.appendChild(this.createMenuItemElement(item, context));
            }
        });

        return menu;
    }

    /**
     * 创建菜单项元素
     * @param {object} item - 菜单项配置
     * @param {object} context - 上下文信息
     * @returns {HTMLElement} 菜单项元素
     */
    createMenuItemElement(item, context) {
        const menuItem = document.createElement('div');
        menuItem.className = 'context-menu-item';
        menuItem.setAttribute('role', 'menuitem');
        menuItem.setAttribute('tabindex', '-1');
        menuItem.dataset.action = item.action;
        menuItem.dataset.id = item.id;

        if (item.disabled) {
            menuItem.classList.add('disabled');
        }

        if (item.danger) {
            menuItem.classList.add('danger');
        }

        if (item.checked) {
            menuItem.classList.add('checked');
        }

        // 图标
        if (item.icon) {
            const icon = document.createElement('span');
            icon.className = 'context-menu-item-icon';
            icon.textContent = item.icon;
            menuItem.appendChild(icon);
        }

        // 文本
        const text = document.createElement('span');
        text.className = 'context-menu-item-text';
        text.textContent = item.text;
        menuItem.appendChild(text);

        // 快捷键
        if (item.shortcut) {
            const shortcut = document.createElement('span');
            shortcut.className = 'context-menu-item-shortcut';
            shortcut.textContent = item.shortcut;
            menuItem.appendChild(shortcut);
        }

        // 子菜单箭头
        if (item.submenu) {
            const arrow = document.createElement('span');
            arrow.className = 'context-menu-item-arrow';
            menuItem.appendChild(arrow);
        }

        // 事件监听器
        menuItem.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.handleMenuItemClick(item, context, e);
        });

        menuItem.addEventListener('mouseenter', (e) => {
            this.handleMenuItemHover(item, menuItem, context, e);
        });

        return menuItem;
    }

    /**
     * 创建分隔符元素
     * @returns {HTMLElement} 分隔符元素
     */
    createSeparatorElement() {
        const separator = document.createElement('div');
        separator.className = 'context-menu-separator';
        separator.setAttribute('role', 'separator');
        return separator;
    }

    /**
     * 创建菜单组元素
     * @param {object} group - 菜单组配置
     * @returns {HTMLElement} 菜单组元素
     */
    createGroupElement(group) {
        const groupElement = document.createElement('div');
        groupElement.className = 'context-menu-group';

        // 组标题
        if (group.title) {
            const title = document.createElement('div');
            title.className = 'context-menu-group-title';
            title.textContent = group.title;
            groupElement.appendChild(title);
        }

        // 组项
        if (group.items) {
            group.items.forEach(item => {
                if (item.type === 'separator') {
                    groupElement.appendChild(this.createSeparatorElement());
                } else {
                    groupElement.appendChild(this.createMenuItemElement(item, {}));
                }
            });
        }

        return groupElement;
    }

    /**
     * 定位菜单
     * @param {HTMLElement} menu - 菜单元素
     * @param {MouseEvent} event - 鼠标事件
     */
    positionMenu(menu, event) {
        const rect = menu.getBoundingClientRect();
        const x = event.clientX;
        const y = event.clientY;

        let left = x;
        let top = y;

        // 根据位置选项调整
        if (this.options.position === 'top-right') {
            left = x - rect.width;
            top = y - rect.height;
        } else if (this.options.position === 'top-left') {
            top = y - rect.height;
        } else if (this.options.position === 'bottom-left') {
            left = x - rect.width;
        }

        // 确保菜单在视口内
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const padding = this.options.viewportPadding;

        if (left + rect.width > viewportWidth - padding) {
            left = viewportWidth - rect.width - padding;
        }
        if (left < padding) {
            left = padding;
        }
        if (top + rect.height > viewportHeight - padding) {
            top = viewportHeight - rect.height - padding;
        }
        if (top < padding) {
            top = padding;
        }

        // 应用位置
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
    }

    /**
     * 设置菜单事件监听器
     * @param {HTMLElement} menu - 菜单元素
     */
    setupMenuEventListeners(menu) {
        // 键盘导航
        menu.addEventListener('keydown', this.handleMenuKeyDown.bind(this));

        // 鼠标跟踪
        if (this.options.enableMouseTracking) {
            menu.addEventListener('mousemove', this.handleMenuMouseMove.bind(this));
            menu.addEventListener('mouseleave', this.handleMenuMouseLeave.bind(this));
        }
    }

    /**
     * 处理菜单项点击
     * @param {object} item - 菜单项配置
     * @param {object} context - 上下文信息
     * @param {MouseEvent} event - 鼠标事件
     */
    handleMenuItemClick(item, context, event) {
        if (item.disabled) return;

        if (item.action) {
            const handler = this.handlers.get(item.action);
            if (handler) {
                handler(item, context, event);
            } else {
                this.emitEvent('menu-action', { action: item.action, item, context });
            }
        }

        if (this.options.closeOnItemSelect) {
            this.closeMenu();
        }
    }

    /**
     * 处理菜单项悬停
     * @param {object} item - 菜单项配置
     * @param {HTMLElement} menuItem - 菜单项元素
     * @param {object} context - 上下文信息
     * @param {MouseEvent} event - 鼠标事件
     */
    handleMenuItemHover(item, menuItem, context, event) {
        if (item.disabled) return;

        // 关闭其他子菜单
        this.closeSubmenus();

        // 打开子菜单
        if (item.submenu && this.options.enableSubmenus) {
            this.openSubmenuForItem(item, menuItem, context);
        }

        // 聚焦到当前项
        menuItem.focus();
    }

    /**
     * 处理全局点击事件
     * @param {MouseEvent} event - 鼠标事件
     */
    handleGlobalClick(event) {
        if (this.options.closeOnOutsideClick && this.state.isOpen) {
            const menu = this.state.currentMenu;
            if (menu && !menu.contains(event.target)) {
                this.closeMenu();
            }
        }
    }

    /**
     * 处理全局上下文菜单事件
     * @param {MouseEvent} event - 鼠标事件
     */
    handleGlobalContextMenu(event) {
        // 可以在这里处理特殊的上下文菜单逻辑
    }

    /**
     * 处理全局键盘事件
     * @param {KeyboardEvent} event - 键盘事件
     */
    handleGlobalKeyDown(event) {
        if (this.options.closeOnEscape && event.key === 'Escape' && this.state.isOpen) {
            this.closeMenu();
        }
    }

    /**
     * 处理菜单键盘事件
     * @param {KeyboardEvent} event - 键盘事件
     */
    handleMenuKeyDown(event) {
        if (!this.options.enableKeyboardNavigation) return;

        const key = event.key;
        const action = this.shortcuts.get(key);

        if (action) {
            event.preventDefault();
            const handler = this.handlers.get(action);
            if (handler) {
                handler(event);
            }
        }
    }

    /**
     * 处理菜单鼠标移动事件
     * @param {MouseEvent} event - 鼠标事件
     */
    handleMenuMouseMove(event) {
        this.state.keyboardMode = false;
    }

    /**
     * 处理菜单鼠标离开事件
     * @param {MouseEvent} event - 鼠标事件
     */
    handleMenuMouseLeave(event) {
        // 可以在这里处理鼠标离开逻辑
    }

    /**
     * 处理窗口大小变化
     * @param {Event} event - 事件
     */
    handleResize(event) {
        if (this.state.isOpen && this.state.currentMenu) {
            // 重新定位菜单或关闭菜单
            this.closeMenu();
        }
    }

    /**
     * 处理滚动事件
     * @param {Event} event - 事件
     */
    handleScroll(event) {
        if (this.state.isOpen && this.options.closeOnOutsideClick) {
            this.closeMenu();
        }
    }

    /**
     * 键盘导航方法
     */
    navigateNext(event) {
        const items = this.getNavigableItems();
        const currentIndex = items.indexOf(document.activeElement);
        const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
        items[nextIndex].focus();
    }

    navigatePrevious(event) {
        const items = this.getNavigableItems();
        const currentIndex = items.indexOf(document.activeElement);
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
        items[prevIndex].focus();
    }

    navigateFirst(event) {
        const items = this.getNavigableItems();
        if (items.length > 0) {
            items[0].focus();
        }
    }

    navigateLast(event) {
        const items = this.getNavigableItems();
        if (items.length > 0) {
            items[items.length - 1].focus();
        }
    }

    activateItem(event) {
        const activeItem = document.activeElement;
        if (activeItem && activeItem.classList.contains('context-menu-item')) {
            activeItem.click();
        }
    }

    openSubmenu(event) {
        const activeItem = document.activeElement;
        if (activeItem && activeItem.classList.contains('context-menu-item')) {
            const item = this.getMenuItemFromElement(activeItem);
            if (item && item.submenu) {
                this.openSubmenuForItem(item, activeItem, {});
            }
        }
    }

    closeSubmenu(event) {
        this.closeSubmenus();
    }

    /**
     * 获取可导航项目
     * @returns {Array} 可导航项目数组
     */
    getNavigableItems() {
        const menu = this.state.currentMenu;
        if (!menu) return [];

        return Array.from(menu.querySelectorAll('.context-menu-item:not(.disabled)'));
    }

    /**
     * 从元素获取菜单项配置
     * @param {HTMLElement} element - 元素
     * @returns {object} 菜单项配置
     */
    getMenuItemFromElement(element) {
        const action = element.dataset.action;
        if (!action) return null;

        // 这里可以根据action查找对应的菜单项配置
        // 暂时返回null
        return null;
    }

    /**
     * 打开子菜单
     * @param {object} item - 菜单项配置
     * @param {HTMLElement} menuItem - 菜单项元素
     * @param {object} context - 上下文信息
     */
    openSubmenuForItem(item, menuItem, context) {
        // 实现子菜单打开逻辑
        // 这需要创建子菜单元素并定位
    }

    /**
     * 关闭子菜单
     */
    closeSubmenus() {
        // 实现子菜单关闭逻辑
    }

    /**
     * 关闭菜单
     */
    closeMenu() {
        if (!this.state.isOpen) return;

        const menu = this.state.currentMenu;
        if (menu) {
            menu.classList.remove('show');
            setTimeout(() => {
                if (menu.parentNode) {
                    menu.parentNode.removeChild(menu);
                }
            }, 200);
        }

        // 重置状态
        this.state.isOpen = false;
        this.state.currentMenu = null;
        this.state.currentTarget = null;
        this.state.activeItem = null;

        // 关闭子菜单
        this.closeSubmenus();

        // 触发关闭事件
        this.emitEvent('menu-close');

        logger.debug('Context menu closed');
    }

    /**
     * 发射事件
     * @param {string} eventName - 事件名称
     * @param {object} data - 事件数据
     */
    emitEvent(eventName, data = {}) {
        const event = new CustomEvent(`contextmenu-${eventName}`, {
            detail: data,
            bubbles: true,
            cancelable: true
        });
        document.dispatchEvent(event);
    }

    /**
     * 检查菜单是否打开
     * @returns {boolean} 菜单是否打开
     */
    isOpen() {
        return this.state.isOpen;
    }

    /**
     * 获取当前菜单
     * @returns {HTMLElement} 当前菜单元素
     */
    getCurrentMenu() {
        return this.state.currentMenu;
    }

    /**
     * 销毁上下文菜单管理器
     */
    destroy() {
        this.closeMenu();
        this.menus.clear();
        this.handlers.clear();
        this.shortcuts.clear();

        // 移除事件监听器
        document.removeEventListener('click', this.handleGlobalClick);
        document.removeEventListener('contextmenu', this.handleGlobalContextMenu);
        document.removeEventListener('keydown', this.handleGlobalKeyDown);
        document.removeEventListener('resize', this.handleResize);
        document.removeEventListener('scroll', this.handleScroll);

        // 移除样式
        const styles = document.getElementById('context-menu-styles');
        if (styles) {
            styles.remove();
        }

        logger.info('Context menu manager destroyed');
    }
}

// 创建全局上下文菜单管理器实例
let globalContextMenuManager = null;

/**
 * 获取全局上下文菜单管理器
 * @returns {ContextMenuManager} 上下文菜单管理器实例
 */
export function getContextMenuManager() {
    if (!globalContextMenuManager) {
        globalContextMenuManager = new ContextMenuManager();
    }
    return globalContextMenuManager;
}

// 导出工具函数
export { ContextMenuManager as default };