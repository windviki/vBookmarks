/**
 * 工具提示管理器
 * 提供现代化的工具提示功能和自适应工具提示
 */

import { Logger } from '../utils/logger.js';

const logger = new Logger('TooltipManager');

/**
 * 工具提示管理器类
 */
export class TooltipManager {
    constructor() {
        this.tooltips = new Map();
        this.activeTooltip = null;
        this.observer = null;
        this.config = {
            delay: 300,
            duration: 4000,
            position: 'top',
            interactive: true,
            theme: 'auto',
            maxWidth: 300,
            showOnHover: true,
            showOnFocus: true,
            animation: true,
            arrow: true,
            offset: 8
        };

        this.init();
    }

    /**
     * 初始化工具提示管理器
     */
    init() {
        this.setupStyles();
        this.setupObserver();
        this.setupEventListeners();
    }

    /**
     * 设置工具提示样式
     */
    setupStyles() {
        if (document.getElementById('tooltip-manager-styles')) {
            return;
        }

        const styles = `
            /* 工具提示容器 */
            .tooltip-container {
                position: absolute;
                z-index: var(--z-tooltip, 9999);
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.2s ease;
            }

            .tooltip-container.visible {
                opacity: 1;
                pointer-events: auto;
            }

            /* 工具提示内容 */
            .tooltip {
                position: relative;
                background: var(--tooltip-bg, rgba(0, 0, 0, 0.9));
                color: var(--tooltip-text, #ffffff);
                padding: var(--spacing-sm, 8px) var(--spacing-md, 12px);
                border-radius: var(--radius-md, 6px);
                font-size: var(--font-size-sm, 12px);
                line-height: 1.4;
                max-width: ${this.config.maxWidth}px;
                word-wrap: break-word;
                box-shadow: var(--shadow-lg, 0 4px 12px rgba(0, 0, 0, 0.15));
                border: 1px solid var(--tooltip-border, rgba(255, 255, 255, 0.1));
            }

            /* 工具提示箭头 */
            .tooltip::before {
                content: '';
                position: absolute;
                width: 0;
                height: 0;
                border-style: solid;
            }

            /* 上方箭头 */
            .tooltip[data-position="top"]::before {
                bottom: -6px;
                left: 50%;
                transform: translateX(-50%);
                border-width: 6px 6px 0 6px;
                border-color: var(--tooltip-bg, rgba(0, 0, 0, 0.9)) transparent transparent transparent;
            }

            /* 下方箭头 */
            .tooltip[data-position="bottom"]::before {
                top: -6px;
                left: 50%;
                transform: translateX(-50%);
                border-width: 0 6px 6px 6px;
                border-color: transparent transparent var(--tooltip-bg, rgba(0, 0, 0, 0.9)) transparent;
            }

            /* 左侧箭头 */
            .tooltip[data-position="left"]::before {
                right: -6px;
                top: 50%;
                transform: translateY(-50%);
                border-width: 6px 0 6px 6px;
                border-color: transparent transparent transparent var(--tooltip-bg, rgba(0, 0, 0, 0.9));
            }

            /* 右侧箭头 */
            .tooltip[data-position="right"]::before {
                left: -6px;
                top: 50%;
                transform: translateY(-50%);
                border-width: 6px 6px 6px 0;
                border-color: transparent var(--tooltip-bg, rgba(0, 0, 0, 0.9)) transparent transparent;
            }

            /* 工具提示动画 */
            .tooltip.fade-in {
                animation: tooltipFadeIn 0.2s ease-out;
            }

            .tooltip.fade-out {
                animation: tooltipFadeOut 0.2s ease-out;
            }

            @keyframes tooltipFadeIn {
                from {
                    opacity: 0;
                    transform: translateY(5px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }

            @keyframes tooltipFadeOut {
                from {
                    opacity: 1;
                    transform: translateY(0);
                }
                to {
                    opacity: 0;
                    transform: translateY(5px);
                }
            }

            /* 交互式工具提示 */
            .tooltip.interactive {
                pointer-events: auto;
            }

            /* 主题适配 */
            [data-theme="light"] .tooltip {
                background: var(--tooltip-bg-light, rgba(255, 255, 255, 0.95));
                color: var(--tooltip-text-light, #333333);
                border-color: var(--tooltip-border-light, rgba(0, 0, 0, 0.1));
                box-shadow: var(--shadow-lg, 0 4px 12px rgba(0, 0, 0, 0.1));
            }

            [data-theme="light"] .tooltip[data-position="top"]::before {
                border-top-color: var(--tooltip-bg-light, rgba(255, 255, 255, 0.95));
            }

            [data-theme="light"] .tooltip[data-position="bottom"]::before {
                border-bottom-color: var(--tooltip-bg-light, rgba(255, 255, 255, 0.95));
            }

            [data-theme="light"] .tooltip[data-position="left"]::before {
                border-left-color: var(--tooltip-bg-light, rgba(255, 255, 255, 0.95));
            }

            [data-theme="light"] .tooltip[data-position="right"]::before {
                border-right-color: var(--tooltip-bg-light, rgba(255, 255, 255, 0.95));
            }

            /* 多行工具提示 */
            .tooltip.multiline {
                white-space: pre-line;
            }

            /* 工具提示链接 */
            .tooltip a {
                color: var(--tooltip-link, #4a90e2);
                text-decoration: underline;
            }

            .tooltip a:hover {
                color: var(--tooltip-link-hover, #357abd);
            }

            /* 工具提示代码 */
            .tooltip code {
                background: var(--tooltip-code-bg, rgba(255, 255, 255, 0.1));
                padding: 2px 4px;
                border-radius: 3px;
                font-family: monospace;
                font-size: 0.9em;
            }

            /* 工具提示强调 */
            .tooltip strong {
                font-weight: bold;
                color: var(--tooltip-strong, #ffffff);
            }

            [data-theme="light"] .tooltip strong {
                color: var(--tooltip-strong-light, #333333);
            }

            /* 工具提示状态类 */
            .tooltip-container.hiding {
                opacity: 0;
            }

            .tooltip-container.showing {
                opacity: 1;
            }
        `;

        const styleElement = document.createElement('style');
        styleElement.id = 'tooltip-manager-styles';
        styleElement.textContent = styles;
        document.head.appendChild(styleElement);
    }

    /**
     * 设置MutationObserver监听DOM变化
     */
    setupObserver() {
        this.observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            this.processElement(node);
                        }
                    }
                }
            }
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        // 监听鼠标移动以更新工具提示位置
        document.addEventListener('mousemove', (e) => {
            if (this.activeTooltip && this.activeTooltip.config.followMouse) {
                this.updateTooltipPosition(e.clientX, e.clientY);
            }
        });

        // 监听窗口大小变化
        window.addEventListener('resize', () => {
            if (this.activeTooltip) {
                this.repositionTooltip();
            }
        });

        // 监听滚动
        window.addEventListener('scroll', () => {
            if (this.activeTooltip) {
                this.repositionTooltip();
            }
        });
    }

    /**
     * 处理元素，查找带有data-tooltip属性的元素
     * @param {HTMLElement} element - 要处理的元素
     */
    processElement(element) {
        const elements = element.querySelectorAll('[data-tooltip]');
        elements.forEach(el => {
            this.registerTooltip(el);
        });

        // 检查元素本身
        if (element.hasAttribute && element.hasAttribute('data-tooltip')) {
            this.registerTooltip(element);
        }
    }

    /**
     * 注册工具提示
     * @param {HTMLElement} element - 目标元素
     * @param {object} options - 工具提示选项
     */
    registerTooltip(element, options = {}) {
        if (!element || this.tooltips.has(element)) {
            return;
        }

        const tooltipText = element.getAttribute('data-tooltip') || options.text;
        if (!tooltipText) {
            return;
        }

        const config = {
            ...this.config,
            ...options,
            text: tooltipText
        };

        // 解析配置属性
        if (element.hasAttribute('data-tooltip-position')) {
            config.position = element.getAttribute('data-tooltip-position');
        }
        if (element.hasAttribute('data-tooltip-delay')) {
            config.delay = parseInt(element.getAttribute('data-tooltip-delay'));
        }
        if (element.hasAttribute('data-tooltip-duration')) {
            config.duration = parseInt(element.getAttribute('data-tooltip-duration'));
        }
        if (element.hasAttribute('data-tooltip-interactive')) {
            config.interactive = element.getAttribute('data-tooltip-interactive') !== 'false';
        }
        if (element.hasAttribute('data-tooltip-multiline')) {
            config.multiline = element.getAttribute('data-tooltip-multiline') !== 'false';
        }
        if (element.hasAttribute('data-tooltip-html')) {
            config.html = element.getAttribute('data-tooltip-html') !== 'false';
        }

        this.tooltips.set(element, config);

        // 绑定事件
        this.bindTooltipEvents(element, config);
    }

    /**
     * 绑定工具提示事件
     * @param {HTMLElement} element - 目标元素
     * @param {object} config - 工具提示配置
     */
    bindTooltipEvents(element, config) {
        let timeoutId;
        let hoverTimeoutId;

        if (config.showOnHover) {
            element.addEventListener('mouseenter', (e) => {
                clearTimeout(timeoutId);
                timeoutId = setTimeout(() => {
                    this.showTooltip(element, e);
                }, config.delay);
            });

            element.addEventListener('mouseleave', () => {
                clearTimeout(timeoutId);
                clearTimeout(hoverTimeoutId);

                if (!config.interactive) {
                    this.hideTooltip(element);
                } else {
                    // 延迟隐藏，允许用户移动到工具提示上
                    hoverTimeoutId = setTimeout(() => {
                        this.hideTooltip(element);
                    }, 100);
                }
            });
        }

        if (config.showOnFocus) {
            element.addEventListener('focus', (e) => {
                clearTimeout(timeoutId);
                timeoutId = setTimeout(() => {
                    this.showTooltip(element, e);
                }, config.delay);
            });

            element.addEventListener('blur', () => {
                clearTimeout(timeoutId);
                this.hideTooltip(element);
            });
        }

        // 键盘支持
        element.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideTooltip(element);
            }
        });
    }

    /**
     * 显示工具提示
     * @param {HTMLElement} element - 目标元素
     * @param {Event} event - 触发事件
     */
    showTooltip(element, event) {
        const config = this.tooltips.get(element);
        if (!config) {
            return;
        }

        // 隐藏当前活动的工具提示
        if (this.activeTooltip && this.activeTooltip.element !== element) {
            this.hideTooltip(this.activeTooltip.element);
        }

        // 创建工具提示容器
        const container = document.createElement('div');
        container.className = 'tooltip-container';
        container.setAttribute('role', 'tooltip');
        container.setAttribute('aria-live', 'polite');

        // 创建工具提示内容
        const tooltip = document.createElement('div');
        tooltip.className = 'tooltip';

        if (config.multiline) {
            tooltip.classList.add('multiline');
        }

        if (config.interactive) {
            tooltip.classList.add('interactive');
        }

        if (config.animation) {
            tooltip.classList.add('fade-in');
        }

        // 设置位置
        tooltip.setAttribute('data-position', config.position);

        // 设置内容
        if (config.html) {
            tooltip.innerHTML = config.text;
        } else {
            tooltip.textContent = config.text;
        }

        container.appendChild(tooltip);
        document.body.appendChild(container);

        // 存储工具提示信息
        this.activeTooltip = {
            element,
            container,
            tooltip,
            config
        };

        // 定位工具提示
        this.positionTooltip(element, container, config, event);

        // 显示工具提示
        requestAnimationFrame(() => {
            container.classList.add('visible');
        });

        // 设置自动隐藏
        if (config.duration > 0) {
            setTimeout(() => {
                this.hideTooltip(element);
            }, config.duration);
        }

        logger.debug(`Showing tooltip for element:`, element);
    }

    /**
     * 隐藏工具提示
     * @param {HTMLElement} element - 目标元素
     */
    hideTooltip(element) {
        if (!this.activeTooltip || this.activeTooltip.element !== element) {
            return;
        }

        const { container, tooltip, config } = this.activeTooltip;

        if (config.animation) {
            tooltip.classList.remove('fade-in');
            tooltip.classList.add('fade-out');

            setTimeout(() => {
                this.removeTooltip();
            }, 200);
        } else {
            this.removeTooltip();
        }

        logger.debug(`Hiding tooltip for element:`, element);
    }

    /**
     * 移除工具提示
     */
    removeTooltip() {
        if (this.activeTooltip) {
            const { container } = this.activeTooltip;

            if (container && container.parentNode) {
                container.parentNode.removeChild(container);
            }

            this.activeTooltip = null;
        }
    }

    /**
     * 定位工具提示
     * @param {HTMLElement} element - 目标元素
     * @param {HTMLElement} container - 工具提示容器
     * @param {object} config - 配置对象
     * @param {Event} event - 触发事件
     */
    positionTooltip(element, container, config, event) {
        const elementRect = element.getBoundingClientRect();
        const tooltipRect = container.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const scrollTop = window.pageYOffset;
        const scrollLeft = window.pageXOffset;

        let left, top;

        // 计算位置
        switch (config.position) {
            case 'top':
                left = elementRect.left + (elementRect.width - tooltipRect.width) / 2;
                top = elementRect.top - tooltipRect.height - config.offset;
                break;
            case 'bottom':
                left = elementRect.left + (elementRect.width - tooltipRect.width) / 2;
                top = elementRect.bottom + config.offset;
                break;
            case 'left':
                left = elementRect.left - tooltipRect.width - config.offset;
                top = elementRect.top + (elementRect.height - tooltipRect.height) / 2;
                break;
            case 'right':
                left = elementRect.right + config.offset;
                top = elementRect.top + (elementRect.height - tooltipRect.height) / 2;
                break;
            case 'mouse':
                left = event.clientX + config.offset;
                top = event.clientY + config.offset;
                break;
            default:
                left = elementRect.left + (elementRect.width - tooltipRect.width) / 2;
                top = elementRect.top - tooltipRect.height - config.offset;
        }

        // 确保工具提示在视口内
        if (left + tooltipRect.width > viewportWidth) {
            left = viewportWidth - tooltipRect.width - 10;
        }
        if (left < 10) {
            left = 10;
        }
        if (top + tooltipRect.height > viewportHeight) {
            top = viewportHeight - tooltipRect.height - 10;
        }
        if (top < 10) {
            top = 10;
        }

        // 设置位置
        container.style.left = `${left + scrollLeft}px`;
        container.style.top = `${top + scrollTop}px`;
    }

    /**
     * 重新定位工具提示
     */
    repositionTooltip() {
        if (!this.activeTooltip) {
            return;
        }

        const { element, container, config } = this.activeTooltip;

        // 模拟事件来重新计算位置
        const fakeEvent = {
            clientX: element.getBoundingClientRect().left + element.offsetWidth / 2,
            clientY: element.getBoundingClientRect().top + element.offsetHeight / 2
        };

        this.positionTooltip(element, container, config, fakeEvent);
    }

    /**
     * 更新工具提示位置（跟随鼠标）
     * @param {number} x - 鼠标X坐标
     * @param {number} y - 鼠标Y坐标
     */
    updateTooltipPosition(x, y) {
        if (!this.activeTooltip) {
            return;
        }

        const { container, config } = this.activeTooltip;
        const scrollTop = window.pageYOffset;
        const scrollLeft = window.pageXOffset;

        container.style.left = `${x + config.offset + scrollLeft}px`;
        container.style.top = `${y + config.offset + scrollTop}px`;
    }

    /**
     * 自适应书签工具提示
     * 从neat.js迁移的功能
     */
    adaptBookmarkTooltips() {
        const bookmarks = document.querySelectorAll('li.child a');

        for (let i = 0, l = bookmarks.length; i < l; i++) {
            const bookmark = bookmarks[i];
            if (bookmark.querySelector('hr')) {
                bookmark.title = '';
            } else {
                if (bookmark.classList.contains('titled')) {
                    if (bookmark.scrollWidth <= bookmark.offsetWidth) {
                        bookmark.title = bookmark.href;
                        bookmark.classList.remove('titled');
                    }
                } else if (bookmark.scrollWidth > bookmark.offsetWidth) {
                    const textElement = bookmark.querySelector('i');
                    const text = textElement ? textElement.textContent : '';
                    const title = bookmark.title;
                    if (text !== title) {
                        bookmark.title = `${text}\\n${title}`;
                        bookmark.classList.add('titled');
                    }
                }
            }
        }
    }

    /**
     * 批量更新工具提示
     * @param {string} selector - 选择器
     * @param {string} text - 工具提示文本
     * @param {object} options - 选项
     */
    updateTooltips(selector, text, options = {}) {
        const elements = document.querySelectorAll(selector);
        elements.forEach(element => {
            const config = this.tooltips.get(element);
            if (config) {
                config.text = text;
                config = { ...config, ...options };
                this.tooltips.set(element, config);
            } else {
                this.registerTooltip(element, { text, ...options });
            }
        });
    }

    /**
     * 销毁工具提示管理器
     */
    destroy() {
        // 移除所有工具提示
        if (this.activeTooltip) {
            this.removeTooltip();
        }

        // 移除事件监听器
        this.tooltips.forEach((config, element) => {
            element.removeEventListener('mouseenter');
            element.removeEventListener('mouseleave');
            element.removeEventListener('focus');
            element.removeEventListener('blur');
            element.removeEventListener('keydown');
        });

        // 清理工具提示映射
        this.tooltips.clear();

        // 停止观察器
        if (this.observer) {
            this.observer.disconnect();
        }

        // 移除样式
        const styles = document.getElementById('tooltip-manager-styles');
        if (styles) {
            styles.remove();
        }

        logger.info('Tooltip manager destroyed');
    }
}

// 创建全局工具提示管理器实例
let globalTooltipManager = null;

/**
 * 获取全局工具提示管理器
 * @returns {TooltipManager} 工具提示管理器实例
 */
export function getTooltipManager() {
    if (!globalTooltipManager) {
        globalTooltipManager = new TooltipManager();
    }
    return globalTooltipManager;
}

// 导出工具函数
export { TooltipManager as default };