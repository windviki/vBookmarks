/**
 * HTML生成器
 * 提供现代化的HTML元素生成功能
 */

import { Logger } from '../utils/logger.js';
import { getFaviconUrl } from '../utils/bookmark-utils.js';
import { separatorManager } from '../utils/separator-manager.js';

const logger = new Logger('HtmlGenerator');

/**
 * HTML生成器类
 */
export class HtmlGenerator {
    constructor(options = {}) {
        this.options = {
            // 生成选项
            includeAttributes: true,
            includeDataAttributes: true,
            includeAriaAttributes: true,
            includeEventListeners: true,

            // 样式选项
            useModernClasses: true,
            useSemanticHTML: true,
            useAccessibility: true,

            // 性能选项
            cacheTemplates: true,
            minifyOutput: false,

            // 用户覆盖选项
            ...options
        };

        this.templates = new Map();
        this.cache = new Map();

        this.init();
    }

    /**
     * 初始化HTML生成器
     */
    init() {
        this.setupTemplates();
        this.setupUtils();
    }

    /**
     * 设置模板
     */
    setupTemplates() {
        // 书签项模板
        this.templates.set('bookmark-item', this.createBookmarkTemplate());

        // 文件夹项模板
        this.templates.set('folder-item', this.createFolderTemplate());

        // 分隔符模板
        this.templates.set('separator-item', this.createSeparatorTemplate());

        // 树形结构模板
        this.templates.set('tree-container', this.createTreeContainerTemplate());

        // 搜索结果模板
        this.templates.set('search-result', this.createSearchResultTemplate());

        // 同步指示器模板
        this.templates.set('sync-indicator', this.createSyncIndicatorTemplate());
    }

    /**
     * 创建书签项模板
     * @returns {Function} 书签项模板函数
     */
    createBookmarkTemplate() {
        return (data) => {
            const {
                id,
                title,
                url,
                level = 0,
                parentId,
                isSearchResult = false,
                customStyles = '',
                extraAttributes = {},
                syncStatus = null,
                syncTooltip = ''
            } = data;

            const padding = level * 16;
            const faviconUrl = getFaviconUrl(url);
            const displayTitle = title || (url && url.startsWith('http') ?
                url.replace(/^https?:\/\//, '').replace(/\/.*/, '') :
                '无标题');

            // 生成属性字符串
            const attributes = this.generateAttributes({
                id: `${isSearchResult ? 'results' : 'neat'}-item-${id}`,
                class: this.generateBookmarkClasses(isSearchResult),
                role: 'treeitem',
                'data-level': level,
                'data-parent-id': parentId,
                'data-bookmark-id': id,
                'data-bookmark-url': url,
                'data-bookmark-title': title,
                ...extraAttributes
            });

            // 生成图标容器
            const faviconContainer = this.generateFaviconContainer(faviconUrl, syncStatus, syncTooltip);

            // 生成文本内容
            const textContent = this.generateTextContent(displayTitle, url);

            return `
                <li ${attributes}>
                    <a href="${this.escapeHtml(url)}"
                       class="${this.generateLinkClasses()}"
                       style="${customStyles} padding-left: ${padding}px;"
                       draggable="true"
                       title="${this.escapeHtml(url)}">
                        ${faviconContainer}
                        ${textContent}
                    </a>
                </li>
            `.trim();
        };
    }

    /**
     * 创建文件夹项模板
     * @returns {Function} 文件夹项模板函数
     */
    createFolderTemplate() {
        return (data) => {
            const {
                id,
                title,
                level = 0,
                parentId,
                isExpanded = false,
                hasChildren = false,
                customStyles = '',
                extraAttributes = {},
                syncStatus = null,
                syncTooltip = ''
            } = data;

            const padding = level * 16;
            const displayTitle = title || '无标题文件夹';
            const expandedClass = isExpanded ? 'expanded' : '';
            const childrenContainer = hasChildren ? this.generateChildrenContainer(id, level + 1) : '';

            // 生成属性字符串
            const attributes = this.generateAttributes({
                id: `neat-tree-item-${id}`,
                class: this.generateFolderClasses(expandedClass),
                role: 'treeitem',
                'aria-expanded': isExpanded,
                'data-level': level,
                'data-parent-id': parentId,
                'data-folder-id': id,
                'data-folder-title': title,
                ...extraAttributes
            });

            // 生成图标
            const folderIcon = this.generateFolderIcon(isExpanded, syncStatus, syncTooltip);

            // 生成文本内容
            const textContent = this.generateTextContent(displayTitle, '');

            return `
                <li ${attributes}>
                    <span class="${this.generateFolderLinkClasses()}"
                          style="${customStyles} padding-left: ${padding}px;"
                          draggable="true"
                          title="${this.escapeHtml(title)}"
                          tabindex="-1">
                        ${folderIcon}
                        ${textContent}
                    </span>
                    ${childrenContainer}
                </li>
            `.trim();
        };
    }

    /**
     * 创建分隔符模板
     * @returns {Function} 分隔符模板函数
     */
    createSeparatorTemplate() {
        return (data) => {
            const {
                id,
                level = 0,
                parentId,
                customStyles = '',
                extraAttributes = {}
            } = data;

            const padding = level * 16;

            // 生成属性字符串
            const attributes = this.generateAttributes({
                id: `neat-tree-item-${id}`,
                class: this.generateSeparatorClasses(),
                role: 'separator',
                'data-level': level,
                'data-parent-id': parentId,
                'data-separator-id': id,
                ...extraAttributes
            });

            return `
                <li ${attributes}>
                    <a href="#"
                       class="${this.generateSeparatorLinkClasses()}"
                       style="${customStyles} padding-left: ${padding}px;"
                       draggable="true"
                       title="分隔符">
                        <hr class="separator-line">
                    </a>
                </li>
            `.trim();
        };
    }

    /**
     * 创建树形容器模板
     * @returns {Function} 树形容器模板函数
     */
    createTreeContainerTemplate() {
        return (data) => {
            const {
                id = 'tree-container',
                level = 0,
                children = [],
                attributes = {}
            } = data;

            const containerAttributes = this.generateAttributes({
                id,
                class: 'bookmark-tree',
                role: 'tree',
                'data-level': level,
                ...attributes
            });

            const childrenHTML = children.map(child => this.generateBookmarkElement(child)).join('');

            return `
                <ul ${containerAttributes}>
                    ${childrenHTML}
                </ul>
            `.trim();
        };
    }

    /**
     * 创建搜索结果模板
     * @returns {Function} 搜索结果模板函数
     */
    createSearchResultTemplate() {
        return (data) => {
            const {
                results = [],
                query = '',
                totalCount = 0
            } = data;

            const resultsHTML = results.map(result =>
                this.generateBookmarkElement({
                    ...result,
                    isSearchResult: true
                })
            ).join('');

            return `
                <div class="search-results" role="list">
                    <div class="search-results-header">
                        <span class="search-results-count">找到 ${totalCount} 个结果</span>
                        <span class="search-results-query">"${query}"</span>
                    </div>
                    <ul class="search-results-list" role="listbox">
                        ${resultsHTML}
                    </ul>
                </div>
            `.trim();
        };
    }

    /**
     * 创建同步指示器模板
     * @returns {Function} 同步指示器模板函数
     */
    createSyncIndicatorTemplate() {
        return (data) => {
            const {
                statusClass = '',
                tooltip = '',
                isVisible = true
            } = data;

            if (!isVisible) return '';

            return `
                <span class="sync-indicator ${statusClass}" title="${this.escapeHtml(tooltip)}">
                    <span class="sync-tooltip">${this.escapeHtml(tooltip)}</span>
                </span>
            `.trim();
        };
    }

    /**
     * 生成书签元素
     * @param {object} data - 书签数据
     * @returns {string} HTML字符串
     */
    generateBookmarkElement(data) {
        const cacheKey = this.generateCacheKey('bookmark', data);
        if (this.options.cacheTemplates && this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        let html = '';

        if (separatorManager.isSeparator(data.title, data.url)) {
            const template = this.templates.get('separator-item');
            html = template(data);
        } else if (data.url) {
            const template = this.templates.get('bookmark-item');
            html = template(data);
        } else {
            const template = this.templates.get('folder-item');
            html = template(data);
        }

        if (this.options.cacheTemplates) {
            this.cache.set(cacheKey, html);
        }

        return html;
    }

    /**
     * 生成书签树HTML
     * @param {Array} bookmarks - 书签数组
     * @param {object} options - 生成选项
     * @returns {string} HTML字符串
     */
    generateBookmarkTree(bookmarks, options = {}) {
        const {
            level = 0,
            parentId = '0',
            includeRoot = false,
            expandAll = false
        } = options;

        let html = '';

        if (includeRoot || level === 0) {
            html += '<ul class="bookmark-tree" role="tree">';
        }

        for (const bookmark of bookmarks) {
            const data = {
                ...bookmark,
                level,
                parentId,
                isExpanded: expandAll || bookmark.children?.length > 0
            };

            html += this.generateBookmarkElement(data);

            // 递归生成子项
            if (bookmark.children && bookmark.children.length > 0) {
                html += this.generateBookmarkTree(bookmark.children, {
                    level: level + 1,
                    parentId: bookmark.id,
                    includeRoot: false,
                    expandAll
                });
            }
        }

        if (includeRoot || level === 0) {
            html += '</ul>';
        }

        return html;
    }

    /**
     * 生成搜索结果HTML
     * @param {Array} results - 搜索结果数组
     * @param {string} query - 搜索查询
     * @returns {string} HTML字符串
     */
    generateSearchResults(results, query) {
        const template = this.templates.get('search-result');
        return template({
            results,
            query,
            totalCount: results.length
        });
    }

    /**
     * 生成图标容器
     * @param {string} faviconUrl - 图标URL
     * @param {string} syncStatus - 同步状态
     * @param {string} syncTooltip - 同步提示
     * @returns {string} HTML字符串
     */
    generateFaviconContainer(faviconUrl, syncStatus = null, syncTooltip = '') {
        const syncIndicator = this.templates.get('sync-indicator')({
            statusClass: syncStatus,
            tooltip: syncTooltip,
            isVisible: syncStatus && localStorage.showSyncStatus === 'true'
        });

        return `
            <span class="favicon-container">
                <img src="${this.escapeHtml(faviconUrl)}"
                     alt=""
                     class="favicon"
                     loading="lazy"
                     width="16"
                     height="16">
                ${syncIndicator}
            </span>
        `.trim();
    }

    /**
     * 生成文件夹图标
     * @param {boolean} isExpanded - 是否展开
     * @param {string} syncStatus - 同步状态
     * @param {string} syncTooltip - 同步提示
     * @returns {string} HTML字符串
     */
    generateFolderIcon(isExpanded, syncStatus = null, syncTooltip = '') {
        const arrowIcon = isExpanded ? '▼' : '▶';
        const folderIcon = isExpanded ? '📂' : '📁';
        const syncIndicator = this.templates.get('sync-indicator')({
            statusClass: syncStatus,
            tooltip: syncTooltip,
            isVisible: syncStatus && localStorage.showSyncStatus === 'true'
        });

        return `
            <span class="folder-arrow">${arrowIcon}</span>
            <span class="folder-icon">${folderIcon}</span>
            ${syncIndicator}
        `.trim();
    }

    /**
     * 生成文本内容
     * @param {string} title - 标题
     * @param {string} url - URL
     * @returns {string} HTML字符串
     */
    generateTextContent(title, url) {
        const escapedTitle = this.escapeHtml(title);
        const escapedUrl = this.escapeHtml(url);

        return `
            <span class="bookmark-content">
                <span class="bookmark-title">${escapedTitle}</span>
                ${url ? `<span class="bookmark-url">${escapedUrl}</span>` : ''}
            </span>
        `.trim();
    }

    /**
     * 生成子项容器
     * @param {string} parentId - 父级ID
     * @param {number} level - 层级
     * @returns {string} HTML字符串
     */
    generateChildrenContainer(parentId, level) {
        return `
            <ul class="bookmark-children"
                role="group"
                data-level="${level}"
                data-parent-id="${parentId}">
            </ul>
        `.trim();
    }

    /**
     * 生成属性字符串
     * @param {object} attributes - 属性对象
     * @returns {string} 属性字符串
     */
    generateAttributes(attributes) {
        if (!this.options.includeAttributes) return '';

        return Object.entries(attributes)
            .map(([key, value]) => {
                if (value === null || value === undefined) return '';
                return `${key}="${this.escapeHtml(value.toString())}"`;
            })
            .filter(attr => attr)
            .join(' ');
    }

    /**
     * 生成书签类名
     * @param {boolean} isSearchResult - 是否为搜索结果
     * @returns {string} 类名
     */
    generateBookmarkClasses(isSearchResult = false) {
        const classes = ['bookmark-item'];
        if (isSearchResult) classes.push('search-result-item');
        return classes.join(' ');
    }

    /**
     * 生成链接类名
     * @returns {string} 类名
     */
    generateLinkClasses() {
        const classes = ['tree-item-link', 'bookmark-link'];
        return classes.join(' ');
    }

    /**
     * 生成文件夹类名
     * @param {string} expandedClass - 展开状态类名
     * @returns {string} 类名
     */
    generateFolderClasses(expandedClass = '') {
        const classes = ['folder-item', 'tree-folder'];
        if (expandedClass) classes.push(expandedClass);
        return classes.join(' ');
    }

    /**
     * 生成文件夹链接类名
     * @returns {string} 类名
     */
    generateFolderLinkClasses() {
        const classes = ['tree-item-span', 'folder-link'];
        return classes.join(' ');
    }

    /**
     * 生成分隔符类名
     * @returns {string} 类名
     */
    generateSeparatorClasses() {
        const classes = ['separator-item'];
        return classes.join(' ');
    }

    /**
     * 生成分隔符链接类名
     * @returns {string} 类名
     */
    generateSeparatorLinkClasses() {
        const classes = ['tree-item-link', 'separator-link'];
        return classes.join(' ');
    }

    /**
     * 生成缓存键
     * @param {string} type - 类型
     * @param {object} data - 数据
     * @returns {string} 缓存键
     */
    generateCacheKey(type, data) {
        const dataStr = JSON.stringify({
            id: data.id,
            title: data.title,
            url: data.url,
            level: data.level,
            parentId: data.parentId,
            isExpanded: data.isExpanded,
            syncStatus: data.syncStatus
        });
        return `${type}:${dataStr}`;
    }

    /**
     * HTML转义
     * @param {string} text - 文本
     * @returns {string} 转义后的文本
     */
    escapeHtml(text) {
        if (!text) return '';

        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 设置工具函数
     */
    setupUtils() {
        // 批量生成器
        this.batchGenerate = (items, type = 'bookmark') => {
            return items.map(item => this.generateBookmarkElement({ ...item, type }));
        };

        // 清除缓存
        this.clearCache = () => {
            this.cache.clear();
        };

        // 获取模板
        this.getTemplate = (name) => {
            return this.templates.get(name);
        };

        // 注册模板
        this.registerTemplate = (name, template) => {
            this.templates.set(name, template);
        };
    }

    /**
     * 销毁HTML生成器
     */
    destroy() {
        this.templates.clear();
        this.cache.clear();
        logger.info('HTML generator destroyed');
    }
}

// 创建全局HTML生成器实例
let globalHtmlGenerator = null;

/**
 * 获取全局HTML生成器
 * @returns {HtmlGenerator} HTML生成器实例
 */
export function getHtmlGenerator() {
    if (!globalHtmlGenerator) {
        globalHtmlGenerator = new HtmlGenerator();
    }
    return globalHtmlGenerator;
}

// 导出工具函数
export { HtmlGenerator as default };