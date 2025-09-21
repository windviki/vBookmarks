/**
 * vBookmarks 渲染引擎
 * 负责书签树和UI的高效渲染
 *
 * 这个模块替代了 neat.js 中的HTML生成相关代码
 */

import { Logger } from '../utils/logger.js';
import { globalEventSystem, Events } from '../event-system/event-system.js';
import { Performance } from '../utils/performance.js';
import { getFaviconUrl, formatDate, getCompactDate } from '../utils/bookmark-utils.js';

export class RenderEngine {
    constructor(options = {}) {
        this.logger = new Logger('RenderEngine');
        this.performance = new Performance('RenderEngine');

        // 渲染选项
        this.options = {
            enableVirtualScroll: true,
            enableCaching: true,
            batchSize: 50,
            debounceTime: 16,
            enableAnimations: true,
            ...options
        };

        // 渲染缓存
        this.cache = new Map();
        this.templateCache = new Map();

        // 虚拟滚动状态
        this.virtualScroll = {
            enabled: this.options.enableVirtualScroll,
            itemHeight: 32,
            visibleItems: 20,
            scrollTop: 0,
            totalHeight: 0
        };

        // 渲染队列
        this.renderQueue = [];
        this.isRendering = false;

        // 元数据设置
        this.metadataSettings = {
            showAddedDate: true,
            showLastAccessed: true,
            showClickCount: true,
            compactMode: false
        };

        // 主题设置
        this.theme = 'default';
    }

    /**
     * 初始化渲染引擎
     */
    async init() {
        this.performance.start('init');

        try {
            this.logger.info('Initializing render engine...');

            // 加载设置
            await this.loadSettings();

            // 初始化模板
            await this.initTemplates();

            // 设置虚拟滚动
            await this.setupVirtualScroll();

            // 设置事件监听
            await this.setupEventListeners();

            this.logger.info('Render engine initialized successfully');

        } catch (error) {
            this.logger.error('Failed to initialize render engine:', error);
            throw error;
        } finally {
            this.performance.end('init');
        }
    }

    /**
     * 渲染书签树
     */
    async renderBookmarkTree(bookmarkData, container) {
        this.performance.start('renderBookmarkTree');

        try {
            // 验证输入
            if (!bookmarkData || !Array.isArray(bookmarkData.children)) {
                throw new Error('Invalid bookmark data');
            }

            // 获取或创建容器
            const treeContainer = container || this.getTreeContainer();
            if (!treeContainer) {
                throw new Error('Tree container not found');
            }

            // 清空容器
            treeContainer.innerHTML = '';

            // 创建文档片段
            const fragment = document.createDocumentFragment();

            // 渲染书签树
            const renderedTree = await this.renderBookmarkNode(bookmarkData, 0, fragment);
            if (renderedTree) {
                fragment.appendChild(renderedTree);
            }

            // 添加到容器
            treeContainer.appendChild(fragment);

            // 设置虚拟滚动
            if (this.virtualScroll.enabled) {
                await this.updateVirtualScroll(treeContainer);
            }

            // 缓存渲染结果
            if (this.options.enableCaching) {
                this.cache.set('bookmark-tree', fragment.cloneNode(true));
            }

            this.logger.debug('Bookmark tree rendered successfully');

            // 发送渲染完成事件
            globalEventSystem.emit(Events.BOOKMARK_TREE_RENDERED, {
                container: treeContainer,
                nodeCount: this.countNodes(bookmarkData)
            });

        } catch (error) {
            this.logger.error('Failed to render bookmark tree:', error);
            throw error;
        } finally {
            this.performance.end('renderBookmarkTree');
        }
    }

    /**
     * 渲染单个书签节点
     */
    async renderBookmarkNode(node, level = 0, container) {
        const nodeType = this.getNodeType(node);

        switch (nodeType) {
            case 'folder':
                return await this.renderFolderNode(node, level, container);
            case 'bookmark':
                return await this.renderBookmarkNode(node, level, container);
            case 'separator':
                return await this.renderSeparatorNode(node, level, container);
            default:
                this.logger.warn('Unknown node type:', nodeType);
                return null;
        }
    }

    /**
     * 渲染文件夹节点
     */
    async renderFolderNode(folder, level, container) {
        const folderElement = await this.createFolderElement(folder, level);
        container.appendChild(folderElement);

        // 如果有子节点且文件夹是展开的，渲染子节点
        if (folder.children && folder.children.length > 0 && this.isFolderExpanded(folder.id)) {
            const childrenContainer = await this.createChildrenContainer(level + 1);
            folderElement.appendChild(childrenContainer);

            for (const child of folder.children) {
                await this.renderBookmarkNode(child, level + 1, childrenContainer);
            }
        }

        return folderElement;
    }

    /**
     * 渲染书签节点
     */
    async renderBookmarkNode(bookmark, level, container) {
        const bookmarkElement = await this.createBookmarkElement(bookmark, level);
        container.appendChild(bookmarkElement);

        // 添加元数据显示
        if (this.metadataSettings.showAddedDate || this.metadataSettings.showLastAccessed || this.metadataSettings.showClickCount) {
            const metadataElement = await this.createMetadataElement(bookmark);
            bookmarkElement.appendChild(metadataElement);
        }

        return bookmarkElement;
    }

    /**
     * 渲染分隔符节点
     */
    async renderSeparatorNode(separator, level, container) {
        const separatorElement = await this.createSeparatorElement(separator, level);
        container.appendChild(separatorElement);

        return separatorElement;
    }

    /**
     * 创建文件夹元素
     */
    async createFolderElement(folder, level) {
        const template = this.getTemplate('folder');
        const element = template.cloneNode(true);

        // 设置基础属性
        element.setAttribute('data-id', folder.id);
        element.setAttribute('data-type', 'folder');
        element.setAttribute('data-level', level);
        element.classList.add('tree-node', 'folder-node');

        if (this.isFolderExpanded(folder.id)) {
            element.classList.add('expanded');
        }

        // 设置展开/折叠图标
        const twisty = element.querySelector('.twisty');
        if (twisty) {
            twisty.style.transform = this.isFolderExpanded(folder.id) ? 'rotate(90deg)' : 'rotate(0deg)';
        }

        // 设置图标
        const icon = element.querySelector('.folder-icon');
        if (icon) {
            icon.textContent = '📁'; // 可以使用更优雅的图标
        }

        // 设置标题
        const title = element.querySelector('.folder-title');
        if (title) {
            title.textContent = folder.title || 'Untitled Folder';
        }

        // 设置事件监听器
        await this.attachFolderEventListeners(element, folder);

        return element;
    }

    /**
     * 创建书签元素
     */
    async createBookmarkElement(bookmark, level) {
        const template = this.getTemplate('bookmark');
        const element = template.cloneNode(true);

        // 设置基础属性
        element.setAttribute('data-id', bookmark.id);
        element.setAttribute('data-type', 'bookmark');
        element.setAttribute('data-level', level);
        element.setAttribute('href', bookmark.url);
        element.classList.add('tree-node', 'bookmark-node');

        // 设置图标
        const icon = element.querySelector('.bookmark-icon');
        if (icon) {
            const faviconUrl = getFaviconUrl(bookmark.url);
            icon.innerHTML = `<img src="${faviconUrl}" alt="" onerror="this.src='icon.png'">`;
        }

        // 设置标题
        const title = element.querySelector('.bookmark-title');
        if (title) {
            title.textContent = bookmark.title || 'Untitled';
        }

        // 设置URL（可选显示）
        const url = element.querySelector('.bookmark-url');
        if (url && bookmark.url) {
            url.textContent = bookmark.url;
            url.title = bookmark.url;
        }

        // 设置事件监听器
        await this.attachBookmarkEventListeners(element, bookmark);

        return element;
    }

    /**
     * 创建分隔符元素
     */
    async createSeparatorElement(separator, level) {
        const template = this.getTemplate('separator');
        const element = template.cloneNode(true);

        // 设置基础属性
        element.setAttribute('data-id', separator.id);
        element.setAttribute('data-type', 'separator');
        element.setAttribute('data-level', level);
        element.classList.add('tree-node', 'separator-node');

        // 设置分隔符线
        const line = element.querySelector('.separator-line');
        if (line) {
            line.style.marginLeft = `${level * 16 + 8}px`;
        }

        return element;
    }

    /**
     * 创建子节点容器
     */
    async createChildrenContainer(level) {
        const container = document.createElement('div');
        container.className = 'node-children';
        container.style.marginLeft = `${16 * level}px`;
        return container;
    }

    /**
     * 创建元数据元素
     */
    async createMetadataElement(bookmark) {
        const container = document.createElement('div');
        container.className = 'bookmark-metadata';

        // 添加日期
        if (this.metadataSettings.showAddedDate && bookmark.dateAdded) {
            const dateElement = this.createMetadataBadge(
                formatDate(bookmark.dateAdded),
                'date',
                'Added: ' + new Date(bookmark.dateAdded).toLocaleString()
            );
            container.appendChild(dateElement);
        }

        // 添加最后访问时间
        if (this.metadataSettings.showLastAccessed && bookmark.lastAccessed) {
            const accessedElement = this.createMetadataBadge(
                getCompactDate(bookmark.lastAccessed),
                'accessed',
                'Last accessed: ' + new Date(bookmark.lastAccessed).toLocaleString()
            );
            container.appendChild(accessedElement);
        }

        // 添加点击次数
        if (this.metadataSettings.showClickCount && bookmark.clickCount !== undefined) {
            const clickElement = this.createMetadataBadge(
                `${bookmark.clickCount} clicks`,
                'clicks',
                `Click count: ${bookmark.clickCount}`
            );
            container.appendChild(clickElement);
        }

        return container;
    }

    /**
     * 创建元数据徽章
     */
    createMetadataBadge(text, type, tooltip) {
        const badge = document.createElement('span');
        badge.className = `meta-badge ${type}`;
        badge.textContent = text;
        badge.title = tooltip;
        return badge;
    }

    /**
     * 初始化模板
     */
    async initTemplates() {
        // 文件夹模板
        const folderTemplate = document.createElement('div');
        folderTemplate.className = 'folder-template';
        folderTemplate.innerHTML = `
            <div class="node-content">
                <span class="twisty">▶</span>
                <span class="folder-icon">📁</span>
                <span class="folder-title"></span>
            </div>
        `;
        this.templateCache.set('folder', folderTemplate);

        // 书签模板
        const bookmarkTemplate = document.createElement('a');
        bookmarkTemplate.className = 'bookmark-template';
        bookmarkTemplate.href = '#';
        bookmarkTemplate.innerHTML = `
            <div class="node-content">
                <span class="bookmark-icon"></span>
                <span class="bookmark-title"></span>
                <span class="bookmark-url"></span>
            </div>
        `;
        this.templateCache.set('bookmark', bookmarkTemplate);

        // 分隔符模板
        const separatorTemplate = document.createElement('div');
        separatorTemplate.className = 'separator-template';
        separatorTemplate.innerHTML = `
            <div class="separator-line"></div>
        `;
        this.templateCache.set('separator', separatorTemplate);
    }

    /**
     * 获取模板
     */
    getTemplate(type) {
        const template = this.templateCache.get(type);
        if (!template) {
            throw new Error(`Template not found: ${type}`);
        }
        return template.firstElementChild.cloneNode(true);
    }

    /**
     * 设置虚拟滚动
     */
    async setupVirtualScroll() {
        if (!this.virtualScroll.enabled) {
            return;
        }

        const treeContainer = this.getTreeContainer();
        if (!treeContainer) {
            return;
        }

        // 设置滚动事件监听
        treeContainer.addEventListener('scroll', this.debounce((event) => {
            this.handleVirtualScroll(event);
        }, this.options.debounceTime));
    }

    /**
     * 处理虚拟滚动
     */
    async handleVirtualScroll(event) {
        const container = event.target;
        const scrollTop = container.scrollTop;

        // 计算可见区域
        const startIndex = Math.floor(scrollTop / this.virtualScroll.itemHeight);
        const endIndex = Math.min(
            startIndex + this.virtualScroll.visibleItems,
            this.virtualScroll.totalItems
        );

        // 如果可见区域发生变化，重新渲染
        if (startIndex !== this.virtualScroll.startIndex || endIndex !== this.virtualScroll.endIndex) {
            await this.renderVisibleItems(startIndex, endIndex);
        }

        this.virtualScroll.scrollTop = scrollTop;
    }

    /**
     * 渲染可见项目
     */
    async renderVisibleItems(startIndex, endIndex) {
        // 这里可以实现虚拟滚动逻辑
        // 由于这是一个复杂的优化功能，我们先实现基础版本
        this.logger.debug(`Rendering visible items: ${startIndex} - ${endIndex}`);
    }

    /**
     * 更新虚拟滚动
     */
    async updateVirtualScroll(container) {
        if (!this.virtualScroll.enabled) {
            return;
        }

        const items = container.querySelectorAll('.tree-node');
        this.virtualScroll.totalItems = items.length;
        this.virtualScroll.totalHeight = items.length * this.virtualScroll.itemHeight;
    }

    /**
     * 设置事件监听器
     */
    async setupEventListeners() {
        // 监听主题变化
        globalEventSystem.on(Events.THEME_CHANGED, (theme) => {
            this.theme = theme;
            this.clearCache();
        });

        // 监听元数据设置变化
        globalEventSystem.on(Events.METADATA_SETTINGS_CHANGED, (settings) => {
            this.metadataSettings = { ...this.metadataSettings, ...settings };
            this.clearCache();
        });
    }

    /**
     * 附加文件夹事件监听器
     */
    async attachFolderEventListeners(element, folder) {
        // 点击展开/折叠
        element.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.toggleFolder(folder.id);
        });

        // 双击打开文件夹
        element.addEventListener('dblclick', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.openFolder(folder);
        });

        // 右键上下文菜单
        element.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.showContextMenu(event, folder, 'folder');
        });
    }

    /**
     * 附加书签事件监听器
     */
    async attachBookmarkEventListeners(element, bookmark) {
        // 点击打开书签
        element.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.openBookmark(bookmark);
        });

        // 中键点击在新标签页打开
        element.addEventListener('mousedown', (event) => {
            if (event.button === 1) { // 中键
                event.preventDefault();
                event.stopPropagation();
                this.openBookmark(bookmark, true);
            }
        });

        // 右键上下文菜单
        element.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.showContextMenu(event, bookmark, 'bookmark');
        });
    }

    /**
     * 切换文件夹展开状态
     */
    toggleFolder(folderId) {
        const isExpanded = this.isFolderExpanded(folderId);
        if (isExpanded) {
            this.collapseFolder(folderId);
        } else {
            this.expandFolder(folderId);
        }
    }

    /**
     * 展开文件夹
     */
    expandFolder(folderId) {
        const expandedFolders = this.getExpandedFolders();
        expandedFolders.add(folderId);
        this.saveExpandedFolders(expandedFolders);

        globalEventSystem.emit(Events.FOLDER_EXPANDED, { folderId });

        // 重新渲染书签树
        this.scheduleReRender();
    }

    /**
     * 折叠文件夹
     */
    collapseFolder(folderId) {
        const expandedFolders = this.getExpandedFolders();
        expandedFolders.delete(folderId);
        this.saveExpandedFolders(expandedFolders);

        globalEventSystem.emit(Events.FOLDER_COLLAPSED, { folderId });

        // 重新渲染书签树
        this.scheduleReRender();
    }

    /**
     * 检查文件夹是否展开
     */
    isFolderExpanded(folderId) {
        const expandedFolders = this.getExpandedFolders();
        return expandedFolders.has(folderId);
    }

    /**
     * 获取展开的文件夹集合
     */
    getExpandedFolders() {
        try {
            const saved = localStorage.getItem('vbookmarks_expanded_folders');
            if (saved) {
                return new Set(JSON.parse(saved));
            }
        } catch (error) {
            this.logger.warn('Could not load expanded folders:', error);
        }
        return new Set();
    }

    /**
     * 保存展开的文件夹集合
     */
    saveExpandedFolders(expandedFolders) {
        try {
            const array = Array.from(expandedFolders);
            localStorage.setItem('vbookmarks_expanded_folders', JSON.stringify(array));
        } catch (error) {
            this.logger.warn('Could not save expanded folders:', error);
        }
    }

    /**
     * 打开书签
     */
    openBookmark(bookmark, newTab = false) {
        if (!bookmark.url) {
            this.logger.warn('Bookmark has no URL:', bookmark);
            return;
        }

        globalEventSystem.emit(Events.BOOKMARK_OPENED, { bookmark, newTab });

        if (newTab) {
            chrome.tabs.create({ url: bookmark.url });
        } else {
            chrome.tabs.update({ url: bookmark.url });
        }

        // 更新访问统计
        this.updateBookmarkStats(bookmark.id);
    }

    /**
     * 打开文件夹
     */
    openFolder(folder) {
        globalEventSystem.emit(Events.FOLDER_OPENED, { folder });

        // 可以实现打开文件夹中所有书签的逻辑
        if (folder.children && folder.children.length > 0) {
            folder.children.forEach(child => {
                if (child.url) {
                    chrome.tabs.create({ url: child.url });
                }
            });
        }
    }

    /**
     * 显示上下文菜单
     */
    showContextMenu(event, item, type) {
        globalEventSystem.emit(Events.CONTEXT_MENU_REQUESTED, {
            event,
            item,
            type
        });
    }

    /**
     * 更新书签统计
     */
    updateBookmarkStats(bookmarkId) {
        // 这里可以实现点击次数和访问时间的更新
        // 这将需要与BookmarkManager协作
        globalEventSystem.emit(Events.BOOKMARK_STATS_UPDATE, { bookmarkId });
    }

    /**
     * 计划重新渲染
     */
    scheduleReRender() {
        if (this.renderQueue.length === 0) {
            requestAnimationFrame(() => {
                this.processRenderQueue();
            });
        }
        this.renderQueue.push({ type: 're-render' });
    }

    /**
     * 处理渲染队列
     */
    async processRenderQueue() {
        if (this.isRendering || this.renderQueue.length === 0) {
            return;
        }

        this.isRendering = true;

        try {
            // 处理所有渲染任务
            while (this.renderQueue.length > 0) {
                const task = this.renderQueue.shift();
                await this.processRenderTask(task);
            }
        } finally {
            this.isRendering = false;
        }
    }

    /**
     * 处理渲染任务
     */
    async processRenderTask(task) {
        switch (task.type) {
            case 're-render':
                await this.reRenderCurrentTree();
                break;
            default:
                this.logger.warn('Unknown render task type:', task.type);
        }
    }

    /**
     * 重新渲染当前书签树
     */
    async reRenderCurrentTree() {
        globalEventSystem.emit(Events.RENDER_REQUESTED);
    }

    /**
     * 获取节点类型
     */
    getNodeType(node) {
        if (node.children) {
            return 'folder';
        }
        if (node.url === 'about:blank' || node.title === '---') {
            return 'separator';
        }
        if (node.url) {
            return 'bookmark';
        }
        return 'unknown';
    }

    /**
     * 获取书签树容器
     */
    getTreeContainer() {
        return document.getElementById('tree') || document.querySelector('.bookmark-tree');
    }

    /**
     * 计算节点数量
     */
    countNodes(node) {
        if (!node.children) {
            return 1;
        }
        return 1 + node.children.reduce((sum, child) => sum + this.countNodes(child), 0);
    }

    /**
     * 加载设置
     */
    async loadSettings() {
        try {
            // 加载元数据设置
            this.metadataSettings = {
                showAddedDate: localStorage.getItem('vbookmarks_show_added_date') !== 'false',
                showLastAccessed: localStorage.getItem('vbookmarks_show_last_accessed') !== 'false',
                showClickCount: localStorage.getItem('vbookmarks_show_click_count') !== 'false',
                compactMode: localStorage.getItem('vbookmarks_compact_mode') === 'true'
            };

            // 加载主题设置
            this.theme = localStorage.getItem('vbookmarks_theme') || 'default';

        } catch (error) {
            this.logger.warn('Could not load settings:', error);
        }
    }

    /**
     * 清除缓存
     */
    clearCache() {
        this.cache.clear();
        this.templateCache.clear();
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
     * 销毁渲染引擎
     */
    async destroy() {
        this.logger.info('Destroying render engine...');

        // 清理缓存
        this.clearCache();

        // 清理事件监听器
        globalEventSystem.removeAllListeners();

        // 清理渲染队列
        this.renderQueue = [];

        this.logger.info('Render engine destroyed');
    }
}

// 导出渲染引擎
export default RenderEngine;