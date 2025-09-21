/**
 * 拖拽管理器
 * 提供现代化的书签拖拽功能
 */

import { Logger } from '../utils/logger.js';

const logger = new Logger('DragDropManager');

/**
 * 拖拽管理器类
 */
export class DragDropManager {
    constructor() {
        this.draggedElement = null;
        this.draggedBookmark = null;
        this.dropTarget = null;
        this.dragClone = null;
        this.dropOverlay = null;
        this.canDrop = false;
        this.zoomLevel = 1;
        this.isRTL = false;
        this.treeContainer = null;
        this.scrollInterval = null;
        this.dragState = {
            isDragging: false,
            startX: 0,
            startY: 0,
            offsetX: 0,
            offsetY: 0
        };

        this.init();
    }

    /**
     * 初始化拖拽管理器
     */
    init() {
        this.setupStyles();
        this.setupEventListeners();
        this.detectRTL();
        this.loadZoomLevel();
    }

    /**
     * 设置拖拽样式
     */
    setupStyles() {
        if (document.getElementById('drag-drop-styles')) {
            return;
        }

        const styles = `
            /* 拖拽克隆元素 */
            .drag-clone {
                position: fixed;
                pointer-events: none;
                z-index: 10000;
                opacity: 0.8;
                border: 2px solid var(--color-primary);
                border-radius: var(--radius-md);
                background: var(--bg-primary);
                box-shadow: var(--shadow-lg);
                transition: transform 0.1s ease;
                transform-origin: center;
            }

            /* 放置目标覆盖层 */
            .drop-overlay {
                position: absolute;
                pointer-events: none;
                z-index: 9999;
                background: var(--color-primary);
                opacity: 0.3;
                border-radius: var(--radius-sm);
                transition: all 0.2s ease;
            }

            .drop-overlay.bookmark {
                height: 2px;
                border-radius: 1px;
            }

            .drop-overlay.folder {
                border: 2px dashed var(--color-primary);
                background: transparent;
                opacity: 0.6;
            }

            /* 拖拽中的元素 */
            .dragging {
                opacity: 0.5;
                cursor: grabbing !important;
            }

            /* 可放置目标 */
            .drop-target {
                background: var(--bg-tertiary);
                border-color: var(--color-primary);
            }

            /* 拖拽占位符 */
            .drag-placeholder {
                height: 2px;
                background: var(--color-primary);
                margin: 4px 0;
                border-radius: 1px;
                opacity: 0.6;
            }

            /* 拖拽禁止状态 */
            .drag-not-allowed {
                cursor: not-allowed !important;
            }

            /* 拖拽手柄 */
            .drag-handle {
                cursor: grab;
                opacity: 0.6;
                transition: opacity 0.2s ease;
            }

            .drag-handle:hover {
                opacity: 1;
            }

            .drag-handle:active {
                cursor: grabbing;
            }

            /* 拖拽动画 */
            @keyframes dragPulse {
                0% {
                    transform: scale(1);
                }
                50% {
                    transform: scale(1.05);
                }
                100% {
                    transform: scale(1);
                }
            }

            .drag-clone.dragging {
                animation: dragPulse 0.3s ease-in-out;
            }

            /* 从RTL语言适配 */
            [dir="rtl"] .drag-clone {
                transform-origin: right center;
            }

            /* 高对比度模式 */
            @media (prefers-contrast: high) {
                .drag-clone {
                    border-width: 3px;
                }

                .drop-overlay {
                    opacity: 0.8;
                    border-width: 3px;
                }
            }

            /* 减少动画偏好 */
            @media (prefers-reduced-motion: reduce) {
                .drag-clone,
                .drop-overlay {
                    transition: none;
                }

                .drag-clone.dragging {
                    animation: none;
                }
            }
        `;

        const styleElement = document.createElement('style');
        styleElement.id = 'drag-drop-styles';
        styleElement.textContent = styles;
        document.head.appendChild(styleElement);
    }

    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        document.addEventListener('dragstart', this.handleDragStart.bind(this));
        document.addEventListener('dragover', this.handleDragOver.bind(this));
        document.addEventListener('drop', this.handleDrop.bind(this));
        document.addEventListener('dragend', this.handleDragEnd.bind(this));
        document.addEventListener('dragenter', this.handleDragEnter.bind(this));
        document.addEventListener('dragleave', this.handleDragLeave.bind(this));

        // 鼠标事件作为备用
        document.addEventListener('mousedown', this.handleMouseDown.bind(this));
        document.addEventListener('mousemove', this.handleMouseMove.bind(this));
        document.addEventListener('mouseup', this.handleMouseUp.bind(this));

        // 键盘事件
        document.addEventListener('keydown', this.handleKeyDown.bind(this));

        // 防止默认拖拽行为
        document.addEventListener('dragover', (e) => {
            if (this.isBookmarkElement(e.target)) {
                e.preventDefault();
            }
        });
    }

    /**
     * 检测RTL语言
     */
    detectRTL() {
        this.isRTL = document.documentElement.getAttribute('dir') === 'rtl' ||
                     window.getComputedStyle(document.documentElement).direction === 'rtl';
    }

    /**
     * 加载缩放级别
     */
    loadZoomLevel() {
        const savedZoom = localStorage.getItem('vbookmarks_zoom');
        if (savedZoom) {
            this.zoomLevel = parseInt(savedZoom) / 100;
        }
    }

    /**
     * 检查是否为书签元素
     * @param {HTMLElement} element - 要检查的元素
     * @returns {boolean} 是否为书签元素
     */
    isBookmarkElement(element) {
        return element.closest && (
            element.closest('[draggable="true"]') ||
            element.closest('.tree-item-link') ||
            element.closest('.tree-item-span') ||
            element.closest('.bookmark-item') ||
            element.closest('.folder-item')
        );
    }

    /**
     * 处理鼠标按下事件
     * @param {MouseEvent} e - 鼠标事件
     */
    handleMouseDown(e) {
        if (e.button !== 0) return; // 只处理左键

        const dragHandle = e.target.closest('.drag-handle');
        const bookmarkElement = this.isBookmarkElement(e.target);

        // 只有在有拖拽手柄或直接点击书签元素时才开始拖拽
        if (!dragHandle && !bookmarkElement) return;

        const draggableElement = dragHandle ? dragHandle.closest('[draggable="true"]') : bookmarkElement;
        if (!draggableElement) return;

        e.preventDefault();

        this.dragState.isDragging = true;
        this.dragState.startX = e.clientX;
        this.dragState.startY = e.clientY;
        this.dragState.offsetX = e.offsetX;
        this.dragState.offsetY = e.offsetY;

        this.draggedElement = draggableElement;
        this.draggedBookmark = this.extractBookmarkInfo(draggableElement);

        // 创建拖拽克隆
        this.createDragClone(e);

        // 添加拖拽样式
        this.draggedElement.classList.add('dragging');

        logger.debug('Drag started:', this.draggedBookmark);
    }

    /**
     * 处理鼠标移动事件
     * @param {MouseEvent} e - 鼠标事件
     */
    handleMouseMove(e) {
        if (!this.dragState.isDragging) return;

        e.preventDefault();

        // 更新拖拽克隆位置
        this.updateDragClonePosition(e);

        // 查找放置目标
        this.findDropTarget(e);

        // 处理自动滚动
        this.handleAutoScroll(e);

        // 更新放置覆盖层
        this.updateDropOverlay(e);
    }

    /**
     * 处理鼠标释放事件
     * @param {MouseEvent} e - 鼠标事件
     */
    handleMouseUp(e) {
        if (!this.dragState.isDragging) return;

        e.preventDefault();

        this.dragState.isDragging = false;

        // 执行放置
        if (this.canDrop && this.dropTarget) {
            this.executeDrop(e);
        }

        // 清理拖拽状态
        this.cleanup();
    }

    /**
     * 处理拖拽开始事件
     * @param {DragEvent} e - 拖拽事件
     */
    handleDragStart(e) {
        const element = e.target;
        if (!this.isBookmarkElement(element)) return;

        e.preventDefault();
        this.handleMouseDown(e);
    }

    /**
     * 处理拖拽悬停事件
     * @param {DragEvent} e - 拖拽事件
     */
    handleDragOver(e) {
        if (!this.dragState.isDragging) return;

        e.preventDefault();
        e.dataTransfer.dropEffect = this.canDrop ? 'move' : 'none';

        this.handleMouseMove(e);
    }

    /**
     * 处理拖拽进入事件
     * @param {DragEvent} e - 拖拽事件
     */
    handleDragEnter(e) {
        if (!this.dragState.isDragging) return;

        const element = e.target;
        if (this.isBookmarkElement(element)) {
            this.dropTarget = element;
            this.canDrop = this.canDropAt(element);

            if (this.canDrop) {
                element.classList.add('drop-target');
            }
        }
    }

    /**
     * 处理拖拽离开事件
     * @param {DragEvent} e - 拖拽事件
     */
    handleDragLeave(e) {
        if (!this.dragState.isDragging) return;

        const element = e.target;
        if (element.classList.contains('drop-target')) {
            element.classList.remove('drop-target');
        }

        this.dropTarget = null;
        this.canDrop = false;
    }

    /**
     * 处理拖拽放置事件
     * @param {DragEvent} e - 拖拽事件
     */
    handleDrop(e) {
        if (!this.dragState.isDragging) return;

        e.preventDefault();
        this.handleMouseUp(e);
    }

    /**
     * 处理拖拽结束事件
     * @param {DragEvent} e - 拖拽事件
     */
    handleDragEnd(e) {
        this.cleanup();
    }

    /**
     * 处理键盘事件
     * @param {KeyboardEvent} e - 键盘事件
     */
    handleKeyDown(e) {
        if (!this.dragState.isDragging) return;

        // ESC 键取消拖拽
        if (e.key === 'Escape') {
            this.dragState.isDragging = false;
            this.cleanup();
            e.preventDefault();
        }
    }

    /**
     * 创建拖拽克隆
     * @param {MouseEvent} e - 鼠标事件
     */
    createDragClone(e) {
        this.dragClone = document.createElement('div');
        this.dragClone.className = 'drag-clone';
        this.dragClone.innerHTML = this.draggedElement.innerHTML;

        // 复制样式
        const computedStyle = window.getComputedStyle(this.draggedElement);
        this.dragClone.style.width = computedStyle.width;
        this.dragClone.style.height = computedStyle.height;

        document.body.appendChild(this.dragClone);

        this.updateDragClonePosition(e);
    }

    /**
     * 更新拖拽克隆位置
     * @param {MouseEvent} e - 鼠标事件
     */
    updateDragClonePosition(e) {
        if (!this.dragClone) return;

        const x = e.clientX - this.dragState.offsetX;
        const y = e.clientY - this.dragState.offsetY;

        this.dragClone.style.left = `${x}px`;
        this.dragClone.style.top = `${y}px`;

        // 应用缩放
        this.dragClone.style.transform = `scale(${this.zoomLevel})`;
    }

    /**
     * 查找放置目标
     * @param {MouseEvent} e - 鼠标事件
     */
    findDropTarget(e) {
        const element = document.elementFromPoint(e.clientX, e.clientY);
        if (!element) {
            this.dropTarget = null;
            this.canDrop = false;
            return;
        }

        const bookmarkElement = this.isBookmarkElement(element);
        if (bookmarkElement) {
            this.dropTarget = bookmarkElement;
            this.canDrop = this.canDropAt(bookmarkElement);
        } else {
            this.dropTarget = null;
            this.canDrop = false;
        }
    }

    /**
     * 检查是否可以在指定位置放置
     * @param {HTMLElement} target - 目标元素
     * @returns {boolean} 是否可以放置
     */
    canDropAt(target) {
        if (!this.draggedBookmark || !target) return false;

        // 不能拖拽到自身
        if (target === this.draggedElement) return false;

        // 不能拖拽到自身的子元素
        if (target.closest(`[data-bookmark-id="${this.draggedBookmark.id}"]`)) return false;

        // 检查目标是否为有效的书签或文件夹
        const targetType = this.getElementType(target);
        return targetType === 'bookmark' || targetType === 'folder';
    }

    /**
     * 获取元素类型
     * @param {HTMLElement} element - 元素
     * @returns {string} 元素类型
     */
    getElementType(element) {
        if (element.classList.contains('folder-item') || element.closest('.folder-item')) {
            return 'folder';
        }
        if (element.classList.contains('bookmark-item') || element.closest('.bookmark-item')) {
            return 'bookmark';
        }
        return 'unknown';
    }

    /**
     * 更新放置覆盖层
     * @param {MouseEvent} e - 鼠标事件
     */
    updateDropOverlay(e) {
        if (!this.dropTarget || !this.canDrop) {
            this.hideDropOverlay();
            return;
        }

        const targetType = this.getElementType(this.dropTarget);
        const rect = this.dropTarget.getBoundingClientRect();

        if (!this.dropOverlay) {
            this.dropOverlay = document.createElement('div');
            this.dropOverlay.className = 'drop-overlay';
            document.body.appendChild(this.dropOverlay);
        }

        if (targetType === 'folder') {
            // 文件夹放置覆盖层
            this.dropOverlay.className = 'drop-overlay folder';
            this.dropOverlay.style.left = `${rect.left}px`;
            this.dropOverlay.style.top = `${rect.top}px`;
            this.dropOverlay.style.width = `${rect.width}px`;
            this.dropOverlay.style.height = `${rect.height}px`;
        } else {
            // 书签放置覆盖层（线条）
            this.dropOverlay.className = 'drop-overlay bookmark';

            const y = e.clientY >= rect.top + rect.height / 2 ? rect.bottom : rect.top;
            this.dropOverlay.style.left = `${rect.left}px`;
            this.dropOverlay.style.top = `${y}px`;
            this.dropOverlay.style.width = `${rect.width}px`;
            this.dropOverlay.style.height = '2px';
        }
    }

    /**
     * 隐藏放置覆盖层
     */
    hideDropOverlay() {
        if (this.dropOverlay) {
            this.dropOverlay.style.left = '-9999px';
            this.dropOverlay.style.top = '-9999px';
        }
    }

    /**
     * 处理自动滚动
     * @param {MouseEvent} e - 鼠标事件
     */
    handleAutoScroll(e) {
        if (!this.treeContainer) {
            this.treeContainer = document.querySelector('.tree-container');
            if (!this.treeContainer) return;
        }

        const treeRect = this.treeContainer.getBoundingClientRect();
        const scrollThreshold = 20;
        const scrollSpeed = 5;

        // 清除之前的滚动
        if (this.scrollInterval) {
            clearInterval(this.scrollInterval);
            this.scrollInterval = null;
        }

        // 检查是否需要滚动
        if (e.clientY < treeRect.top + scrollThreshold) {
            // 向上滚动
            this.scrollInterval = setInterval(() => {
                this.treeContainer.scrollBy(0, -scrollSpeed);
            }, 16);
        } else if (e.clientY > treeRect.bottom - scrollThreshold) {
            // 向下滚动
            this.scrollInterval = setInterval(() => {
                this.treeContainer.scrollBy(0, scrollSpeed);
            }, 16);
        }
    }

    /**
     * 执行放置操作
     * @param {MouseEvent} e - 鼠标事件
     */
    async executeDrop(e) {
        if (!this.draggedBookmark || !this.dropTarget) return;

        const targetType = this.getElementType(this.dropTarget);
        const targetBookmark = this.extractBookmarkInfo(this.dropTarget);

        try {
            // 计算放置位置
            const dropPosition = this.calculateDropPosition(e, targetType);

            // 触发拖拽事件
            this.emitDragEvent('drop', {
                draggedBookmark: this.draggedBookmark,
                targetBookmark: targetBookmark,
                dropPosition,
                targetType
            });

            logger.info('Bookmark dropped:', {
                dragged: this.draggedBookmark,
                target: targetBookmark,
                position: dropPosition
            });
        } catch (error) {
            logger.error('Failed to execute drop:', error);
            this.emitDragEvent('drop-error', { error });
        }
    }

    /**
     * 计算放置位置
     * @param {MouseEvent} e - 鼠标事件
     * @param {string} targetType - 目标类型
     * @returns {object} 放置位置信息
     */
    calculateDropPosition(e, targetType) {
        const rect = this.dropTarget.getBoundingClientRect();

        if (targetType === 'folder') {
            const relativeY = e.clientY - rect.top;
            const relativeHeight = rect.height;

            if (relativeY < relativeHeight * 0.3) {
                return { type: 'before', target: this.dropTarget };
            } else if (relativeY > relativeHeight * 0.7) {
                return { type: 'after', target: this.dropTarget };
            } else {
                return { type: 'into', target: this.dropTarget };
            }
        } else {
            const relativeY = e.clientY - rect.top;
            const relativeHeight = rect.height;

            return {
                type: relativeY >= relativeHeight / 2 ? 'after' : 'before',
                target: this.dropTarget
            };
        }
    }

    /**
     * 提取书签信息
     * @param {HTMLElement} element - 书签元素
     * @returns {object} 书签信息
     */
    extractBookmarkInfo(element) {
        const bookmarkElement = element.closest('[data-bookmark-id]');
        if (!bookmarkElement) return null;

        return {
            id: bookmarkElement.getAttribute('data-bookmark-id'),
            title: bookmarkElement.getAttribute('data-bookmark-title') || '',
            url: bookmarkElement.getAttribute('data-bookmark-url') || '',
            type: bookmarkElement.classList.contains('folder-item') ? 'folder' : 'bookmark',
            parentId: bookmarkElement.getAttribute('data-parent-id'),
            index: parseInt(bookmarkElement.getAttribute('data-index') || '0')
        };
    }

    /**
     * 触发拖拽事件
     * @param {string} eventType - 事件类型
     * @param {object} data - 事件数据
     */
    emitDragEvent(eventType, data) {
        const event = new CustomEvent(`bookmark-drag-${eventType}`, {
            detail: data,
            bubbles: true,
            cancelable: true
        });
        document.dispatchEvent(event);
    }

    /**
     * 停止滚动
     */
    stopScrolling() {
        if (this.scrollInterval) {
            clearInterval(this.scrollInterval);
            this.scrollInterval = null;
        }
    }

    /**
     * 清理拖拽状态
     */
    cleanup() {
        // 移除拖拽样式
        if (this.draggedElement) {
            this.draggedElement.classList.remove('dragging');
        }

        // 移除放置目标样式
        document.querySelectorAll('.drop-target').forEach(element => {
            element.classList.remove('drop-target');
        });

        // 移除拖拽克隆
        if (this.dragClone && this.dragClone.parentNode) {
            this.dragClone.parentNode.removeChild(this.dragClone);
        }

        // 移除放置覆盖层
        if (this.dropOverlay && this.dropOverlay.parentNode) {
            this.dropOverlay.parentNode.removeChild(this.dropOverlay);
        }

        // 停止滚动
        this.stopScrolling();

        // 重置状态
        this.draggedElement = null;
        this.draggedBookmark = null;
        this.dropTarget = null;
        this.dragClone = null;
        this.dropOverlay = null;
        this.canDrop = false;
        this.dragState.isDragging = false;

        logger.debug('Drag cleanup completed');
    }

    /**
     * 销毁拖拽管理器
     */
    destroy() {
        this.cleanup();

        // 移除事件监听器
        document.removeEventListener('dragstart', this.handleDragStart);
        document.removeEventListener('dragover', this.handleDragOver);
        document.removeEventListener('drop', this.handleDrop);
        document.removeEventListener('dragend', this.handleDragEnd);
        document.removeEventListener('dragenter', this.handleDragEnter);
        document.removeEventListener('dragleave', this.handleDragLeave);
        document.removeEventListener('mousedown', this.handleMouseDown);
        document.removeEventListener('mousemove', this.handleMouseMove);
        document.removeEventListener('mouseup', this.handleMouseUp);
        document.removeEventListener('keydown', this.handleKeyDown);

        // 移除样式
        const styles = document.getElementById('drag-drop-styles');
        if (styles) {
            styles.remove();
        }

        logger.info('Drag drop manager destroyed');
    }
}

// 创建全局拖拽管理器实例
let globalDragDropManager = null;

/**
 * 获取全局拖拽管理器
 * @returns {DragDropManager} 拖拽管理器实例
 */
export function getDragDropManager() {
    if (!globalDragDropManager) {
        globalDragDropManager = new DragDropManager();
    }
    return globalDragDropManager;
}

// 导出工具函数
export { DragDropManager as default };