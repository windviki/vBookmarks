/**
 * vBookmarks 对话框系统
 * 现代化的对话框管理器
 *
 * 这个模块替代了 neat.js 中的对话框相关代码
 */

import { Logger } from '../../utils/logger.js';
import { globalEventSystem, Events } from '../../core/event-system/event-system.js';

export class DialogSystem {
    constructor(options = {}) {
        this.logger = new Logger('DialogSystem');
        this.options = {
            animationDuration: 300,
            enableBackdrop: true,
            enableKeyboard: true,
            enableAccessibility: true,
            ...options
        };

        // 对话框状态
        this.dialogs = new Map();
        this.activeDialogs = new Set();
        this.dialogStack = [];

        // 默认配置
        this.defaultConfig = {
            modal: true,
            closable: true,
            resizable: false,
            draggable: false,
            focusTrap: true,
            autoClose: false,
            autoCloseDelay: 5000
        };

        // 模板缓存
        this.templates = new Map();

        // 初始化
        this.init();
    }

    /**
     * 初始化对话框系统
     */
    init() {
        this.logger.info('Initializing dialog system...');

        // 创建默认对话框容器
        this.createDialogContainer();

        // 设置事件监听
        this.setupEventListeners();

        // 初始化模板
        this.initTemplates();

        this.logger.info('Dialog system initialized');
    }

    /**
     * 创建对话框容器
     */
    createDialogContainer() {
        let container = document.getElementById('dialog-container');

        if (!container) {
            container = document.createElement('div');
            container.id = 'dialog-container';
            container.className = 'dialog-container';
            container.setAttribute('role', 'dialog');
            container.setAttribute('aria-label', 'Dialog container');
            document.body.appendChild(container);
        }

        this.container = container;
    }

    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        // ESC键关闭对话框
        if (this.options.enableKeyboard) {
            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape' && this.activeDialogs.size > 0) {
                    const topDialog = this.getTopDialog();
                    if (topDialog && topDialog.closable) {
                        this.closeDialog(topDialog.id);
                    }
                }
            });
        }

        // 点击背景关闭
        if (this.options.enableBackdrop) {
            this.container.addEventListener('click', (event) => {
                if (event.target === this.container) {
                    const topDialog = this.getTopDialog();
                    if (topDialog && topDialog.closable) {
                        this.closeDialog(topDialog.id);
                    }
                }
            });
        }

        // 全局对话框事件
        globalEventSystem.on(Events.DIALOG_OPEN, (config) => {
            this.openDialog(config);
        });

        globalEventSystem.on(Events.DIALOG_CLOSE, (dialogId) => {
            this.closeDialog(dialogId);
        });
    }

    /**
     * 初始化模板
     */
    initTemplates() {
        // 警告对话框模板
        this.templates.set('alert', this.createAlertTemplate());

        // 确认对话框模板
        this.templates.set('confirm', this.createConfirmTemplate());

        // 输入对话框模板
        this.templates.set('prompt', this.createPromptTemplate());

        // 书签编辑对话框模板
        this.templates.set('bookmark-edit', this.createBookmarkEditTemplate());

        // 文件夹创建对话框模板
        this.templates.set('folder-create', this.createFolderCreateTemplate());
    }

    /**
     * 创建警告对话框模板
     */
    createAlertTemplate() {
        const template = document.createElement('div');
        template.className = 'dialog dialog-alert';
        template.innerHTML = `
            <div class="dialog-content">
                <div class="dialog-header">
                    <h3 class="dialog-title">Alert</h3>
                    ${this.options.enableBackdrop ? '<button class="dialog-close" aria-label="Close">&times;</button>' : ''}
                </div>
                <div class="dialog-body">
                    <p class="dialog-message"></p>
                </div>
                <div class="dialog-footer">
                    <button class="dialog-button dialog-button-primary" data-action="ok">OK</button>
                </div>
            </div>
        `;
        return template;
    }

    /**
     * 创建确认对话框模板
     */
    createConfirmTemplate() {
        const template = document.createElement('div');
        template.className = 'dialog dialog-confirm';
        template.innerHTML = `
            <div class="dialog-content">
                <div class="dialog-header">
                    <h3 class="dialog-title">Confirm</h3>
                    ${this.options.enableBackdrop ? '<button class="dialog-close" aria-label="Close">&times;</button>' : ''}
                </div>
                <div class="dialog-body">
                    <p class="dialog-message"></p>
                </div>
                <div class="dialog-footer">
                    <button class="dialog-button dialog-button-secondary" data-action="cancel">Cancel</button>
                    <button class="dialog-button dialog-button-primary" data-action="ok">OK</button>
                </div>
            </div>
        `;
        return template;
    }

    /**
     * 创建输入对话框模板
     */
    createPromptTemplate() {
        const template = document.createElement('div');
        template.className = 'dialog dialog-prompt';
        template.innerHTML = `
            <div class="dialog-content">
                <div class="dialog-header">
                    <h3 class="dialog-title">Input</h3>
                    ${this.options.enableBackdrop ? '<button class="dialog-close" aria-label="Close">&times;</button>' : ''}
                </div>
                <div class="dialog-body">
                    <p class="dialog-message"></p>
                    <input type="text" class="dialog-input" placeholder="Enter value...">
                </div>
                <div class="dialog-footer">
                    <button class="dialog-button dialog-button-secondary" data-action="cancel">Cancel</button>
                    <button class="dialog-button dialog-button-primary" data-action="ok">OK</button>
                </div>
            </div>
        `;
        return template;
    }

    /**
     * 创建书签编辑对话框模板
     */
    createBookmarkEditTemplate() {
        const template = document.createElement('div');
        template.className = 'dialog dialog-bookmark-edit';
        template.innerHTML = `
            <div class="dialog-content">
                <div class="dialog-header">
                    <h3 class="dialog-title">Edit Bookmark</h3>
                    ${this.options.enableBackdrop ? '<button class="dialog-close" aria-label="Close">&times;</button>' : ''}
                </div>
                <div class="dialog-body">
                    <div class="form-group">
                        <label for="edit-dialog-name" class="form-label">Name</label>
                        <input type="text" id="edit-dialog-name" class="dialog-input" placeholder="Enter bookmark name..." required>
                    </div>
                    <div class="form-group">
                        <label for="edit-dialog-url" class="form-label">URL</label>
                        <input type="url" id="edit-dialog-url" class="dialog-input" placeholder="Enter bookmark URL..." required>
                    </div>
                </div>
                <div class="dialog-footer">
                    <button class="dialog-button dialog-button-secondary" data-action="cancel">Cancel</button>
                    <button class="dialog-button dialog-button-primary" data-action="save">Save</button>
                </div>
            </div>
        `;
        return template;
    }

    /**
     * 创建文件夹创建对话框模板
     */
    createFolderCreateTemplate() {
        const template = document.createElement('div');
        template.className = 'dialog dialog-folder-create';
        template.innerHTML = `
            <div class="dialog-content">
                <div class="dialog-header">
                    <h3 class="dialog-title">New Folder</h3>
                    ${this.options.enableBackdrop ? '<button class="dialog-close" aria-label="Close">&times;</button>' : ''}
                </div>
                <div class="dialog-body">
                    <div class="form-group">
                        <label for="new-folder-dialog-name" class="form-label">Folder Name</label>
                        <input type="text" id="new-folder-dialog-name" class="dialog-input" placeholder="Enter folder name..." required>
                    </div>
                </div>
                <div class="dialog-footer">
                    <button class="dialog-button dialog-button-secondary" data-action="cancel">Cancel</button>
                    <button class="dialog-button dialog-button-primary" data-action="create">Create</button>
                </div>
            </div>
        `;
        return template;
    }

    /**
     * 打开对话框
     */
    async openDialog(config) {
        const dialogId = config.id || this.generateDialogId();
        const type = config.type || 'alert';

        // 合并配置
        const finalConfig = {
            ...this.defaultConfig,
            ...config,
            id: dialogId,
            type: type
        };

        // 创建对话框元素
        const dialogElement = await this.createDialog(finalConfig);

        // 添加到容器
        this.container.appendChild(dialogElement);

        // 存储对话框信息
        this.dialogs.set(dialogId, {
            element: dialogElement,
            config: finalConfig,
            resolve: null,
            reject: null
        });

        // 添加到活动对话框集合
        this.activeDialogs.add(dialogId);
        this.dialogStack.push(dialogId);

        // 设置动画
        if (this.options.animationDuration > 0) {
            await this.animateDialogOpen(dialogElement);
        }

        // 设置焦点
        this.setFocus(dialogElement);

        // 自动关闭
        if (finalConfig.autoClose) {
            setTimeout(() => {
                this.closeDialog(dialogId);
            }, finalConfig.autoCloseDelay);
        }

        this.logger.info(`Dialog opened: ${dialogId}`);

        // 发送事件
        globalEventSystem.emit(Events.DIALOG_OPENED, {
            dialogId,
            config: finalConfig
        });

        return new Promise((resolve, reject) => {
            this.dialogs.get(dialogId).resolve = resolve;
            this.dialogs.get(dialogId).reject = reject;
        });
    }

    /**
     * 关闭对话框
     */
    async closeDialog(dialogId, result = null) {
        const dialogInfo = this.dialogs.get(dialogId);
        if (!dialogInfo) {
            this.logger.warn(`Dialog not found: ${dialogId}`);
            return;
        }

        const { element, config, resolve } = dialogInfo;

        // 移除动画
        if (this.options.animationDuration > 0) {
            await this.animateDialogClose(element);
        }

        // 从DOM移除
        element.remove();

        // 清理数据
        this.dialogs.delete(dialogId);
        this.activeDialogs.delete(dialogId);
        this.dialogStack = this.dialogStack.filter(id => id !== dialogId);

        this.logger.info(`Dialog closed: ${dialogId}`);

        // 发送事件
        globalEventSystem.emit(Events.DIALOG_CLOSED, {
            dialogId,
            result
        });

        // 解析Promise
        if (resolve) {
            resolve(result);
        }
    }

    /**
     * 创建对话框元素
     */
    async createDialog(config) {
        const template = this.templates.get(config.type);
        if (!template) {
            throw new Error(`Unknown dialog type: ${config.type}`);
        }

        const element = template.cloneNode(true);
        element.id = config.id;
        element.setAttribute('role', 'dialog');
        element.setAttribute('aria-modal', config.modal ? 'true' : 'false');
        element.setAttribute('aria-labelledby', `${config.id}-title`);

        // 设置内容
        this.setDialogContent(element, config);

        // 设置事件监听器
        this.setupDialogEventListeners(element, config);

        return element;
    }

    /**
     * 设置对话框内容
     */
    setDialogContent(element, config) {
        // 设置标题
        const titleElement = element.querySelector('.dialog-title');
        if (titleElement && config.title) {
            titleElement.textContent = config.title;
            titleElement.id = `${config.id}-title`;
        }

        // 设置消息
        const messageElement = element.querySelector('.dialog-message');
        if (messageElement && config.message) {
            messageElement.innerHTML = config.message;
        }

        // 设置输入值
        const inputElement = element.querySelector('.dialog-input');
        if (inputElement && config.defaultValue) {
            inputElement.value = config.defaultValue;
        }

        // 设置按钮文本
        if (config.buttons) {
            Object.entries(config.buttons).forEach(([action, text]) => {
                const button = element.querySelector(`[data-action="${action}"]`);
                if (button) {
                    button.textContent = text;
                }
            });
        }
    }

    /**
     * 设置对话框事件监听器
     */
    setupDialogEventListeners(element, config) {
        // 关闭按钮
        const closeButtons = element.querySelectorAll('.dialog-close, [data-action="cancel"]');
        closeButtons.forEach(button => {
            button.addEventListener('click', () => {
                this.closeDialog(config.id, null);
            });
        });

        // 动作按钮
        const actionButtons = element.querySelectorAll('[data-action]');
        actionButtons.forEach(button => {
            const action = button.getAttribute('data-action');
            if (action !== 'cancel') {
                button.addEventListener('click', () => {
                    this.handleDialogAction(config.id, action);
                });
            }
        });

        // 表单提交
        const form = element.querySelector('form');
        if (form) {
            form.addEventListener('submit', (event) => {
                event.preventDefault();
                this.handleDialogAction(config.id, 'submit');
            });
        }

        // 键盘事件
        if (this.options.enableKeyboard && config.focusTrap) {
            this.setupFocusTrap(element, config);
        }
    }

    /**
     * 处理对话框动作
     */
    async handleDialogAction(dialogId, action) {
        const dialogInfo = this.dialogs.get(dialogId);
        if (!dialogInfo) return;

        const { element, config } = dialogInfo;
        let result = null;

        switch (action) {
            case 'ok':
            case 'save':
            case 'create':
            case 'submit':
                result = this.getDialogResult(element, config);
                break;
            case 'cancel':
                result = null;
                break;
            default:
                result = { action };
        }

        await this.closeDialog(dialogId, result);
    }

    /**
     * 获取对话框结果
     */
    getDialogResult(element, config) {
        switch (config.type) {
            case 'prompt':
                const input = element.querySelector('.dialog-input');
                return input ? input.value : null;
            case 'bookmark-edit':
                const nameInput = element.querySelector('#edit-dialog-name');
                const urlInput = element.querySelector('#edit-dialog-url');
                return {
                    name: nameInput ? nameInput.value : '',
                    url: urlInput ? urlInput.value : ''
                };
            case 'folder-create':
                const folderNameInput = element.querySelector('#new-folder-dialog-name');
                return folderNameInput ? folderNameInput.value : '';
            default:
                return true;
        }
    }

    /**
     * 设置焦点
     */
    setFocus(element) {
        // 聚焦第一个可聚焦元素
        const focusableElement = element.querySelector(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );

        if (focusableElement) {
            focusableElement.focus();
        }
    }

    /**
     * 设置焦点陷阱
     */
    setupFocusTrap(element, config) {
        const focusableElements = element.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );

        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        const handleKeyDown = (event) => {
            if (event.key !== 'Tab') return;

            if (event.shiftKey) {
                if (document.activeElement === firstElement) {
                    event.preventDefault();
                    lastElement.focus();
                }
            } else {
                if (document.activeElement === lastElement) {
                    event.preventDefault();
                    firstElement.focus();
                }
            }
        };

        element.addEventListener('keydown', handleKeyDown);

        // 清理函数
        element._focusTrapCleanup = () => {
            element.removeEventListener('keydown', handleKeyDown);
        };
    }

    /**
     * 动画打开对话框
     */
    async animateDialogOpen(element) {
        return new Promise((resolve) => {
            element.style.opacity = '0';
            element.style.transform = 'scale(0.9)';

            requestAnimationFrame(() => {
                element.style.transition = `all ${this.options.animationDuration}ms ease-out`;
                element.style.opacity = '1';
                element.style.transform = 'scale(1)';

                setTimeout(resolve, this.options.animationDuration);
            });
        });
    }

    /**
     * 动画关闭对话框
     */
    async animateDialogClose(element) {
        return new Promise((resolve) => {
            element.style.transition = `all ${this.options.animationDuration}ms ease-in`;
            element.style.opacity = '0';
            element.style.transform = 'scale(0.9)';

            setTimeout(resolve, this.options.animationDuration);
        });
    }

    /**
     * 获取顶部对话框
     */
    getTopDialog() {
        if (this.dialogStack.length === 0) return null;
        const dialogId = this.dialogStack[this.dialogStack.length - 1];
        return this.dialogs.get(dialogId);
    }

    /**
     * 生成对话框ID
     */
    generateDialogId() {
        return `dialog-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 显示警告对话框
     */
    async alert(message, title = 'Alert') {
        return this.openDialog({
            type: 'alert',
            title,
            message,
            buttons: {
                ok: 'OK'
            }
        });
    }

    /**
     * 显示确认对话框
     */
    async confirm(message, title = 'Confirm') {
        return this.openDialog({
            type: 'confirm',
            title,
            message,
            buttons: {
                cancel: 'Cancel',
                ok: 'OK'
            }
        });
    }

    /**
     * 显示输入对话框
     */
    async prompt(message, defaultValue = '', title = 'Input') {
        return this.openDialog({
            type: 'prompt',
            title,
            message,
            defaultValue,
            buttons: {
                cancel: 'Cancel',
                ok: 'OK'
            }
        });
    }

    /**
     * 显示书签编辑对话框
     */
    async editBookmark(bookmark = { title: '', url: '' }) {
        return this.openDialog({
            type: 'bookmark-edit',
            title: 'Edit Bookmark',
            defaultValue: bookmark,
            buttons: {
                cancel: 'Cancel',
                save: 'Save'
            }
        });
    }

    /**
     * 显示文件夹创建对话框
     */
    async createFolder(defaultName = 'New Folder') {
        return this.openDialog({
            type: 'folder-create',
            title: 'New Folder',
            defaultValue: defaultName,
            buttons: {
                cancel: 'Cancel',
                create: 'Create'
            }
        });
    }

    /**
     * 关闭所有对话框
     */
    async closeAllDialogs() {
        const dialogIds = Array.from(this.activeDialogs);
        for (const dialogId of dialogIds) {
            await this.closeDialog(dialogId);
        }
    }

    /**
     * 销毁对话框系统
     */
    async destroy() {
        this.logger.info('Destroying dialog system...');

        // 关闭所有对话框
        await this.closeAllDialogs();

        // 清理模板
        this.templates.clear();

        // 移除容器
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }

        this.logger.info('Dialog system destroyed');
    }
}

// 创建全局实例
const dialogSystem = new DialogSystem();

// 导出类和实例
export { DialogSystem };
export default dialogSystem;