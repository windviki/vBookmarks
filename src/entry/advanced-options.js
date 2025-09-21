/**
 * vBookmarks 高级选项页面入口
 * 现代化的模块化高级选项页面
 */
import { SeparatorManager } from '../core/storage-manager/separator-manager.js';
import { globalEventSystem, Events } from '../core/event-system/event-system.js';

class VBookmarksAdvancedOptions {
    constructor() {
        this.initialized = false;
        this.separatorManager = null;
        this.codeEditor = null;
    }

    /**
     * 初始化高级选项页面
     */
    async init() {
        if (this.initialized) {
            console.warn('Advanced options page already initialized');
            return;
        }

        try {
            console.log('Initializing vBookmarks advanced options...');

            // 初始化核心管理器
            this.separatorManager = new SeparatorManager();

            // 等待DOM就绪
            await this.waitForDOMReady();

            // 加载设置
            await this.loadSettings();

            // 设置UI事件
            await this.setupUIEvents();

            // 设置代码编辑器
            await this.setupCodeEditor();

            // 设置自定义图标功能
            await this.setupCustomIcon();

            // 设置重置功能
            await this.setupResetFunction();

            this.initialized = true;
            console.log('vBookmarks advanced options initialized successfully');
        } catch (error) {
            console.error('Failed to initialize advanced options:', error);
            this.showError(error);
        }
    }

    /**
     * 等待DOM就绪
     */
    async waitForDOMReady() {
        if (document.readyState === 'loading') {
            await new Promise(resolve => {
                document.addEventListener('DOMContentLoaded', resolve);
            });
        }
    }

    /**
     * 加载设置
     */
    async loadSettings() {
        try {
            // 加载分隔符设置
            this.loadSeparatorSettings();

            // 加载自定义CSS
            this.loadCustomCSS();

            // 加载自定义图标
            this.loadCustomIcon();

            console.log('Advanced settings loaded successfully');
        } catch (error) {
            console.error('Failed to load advanced settings:', error);
            throw error;
        }
    }

    /**
     * 加载分隔符设置
     */
    loadSeparatorSettings() {
        // 分隔符颜色
        const separatorColor = document.getElementById('custom-separator-color');
        if (separatorColor) {
            separatorColor.value = this.separatorManager.separatorColor || '#cccccc';
        }

        // 分隔符标题
        const separatorTitle = document.getElementById('custom-separator-title');
        if (separatorTitle) {
            separatorTitle.value = this.separatorManager.separatorTitle || 'vBookmarks Separator';
        }

        // 分隔符URL
        const separatorURL = document.getElementById('custom-separator-url');
        if (separatorURL) {
            separatorURL.value = this.separatorManager.separatorURL || 'about:blank';
        }

        // 分隔符字符串
        const separatorString = document.getElementById('custom-separator-string');
        if (separatorString) {
            separatorString.value = this.separatorManager.separatorString.join(';');
        }
    }

    /**
     * 加载自定义CSS
     */
    loadCustomCSS() {
        const userstyle = document.getElementById('userstyle');
        if (userstyle) {
            userstyle.value = localStorage.getItem('customCSS') || '';
        }
    }

    /**
     * 加载自定义图标
     */
    loadCustomIcon() {
        const customIcon = localStorage.getItem('customIcon');
        if (customIcon) {
            const preview = document.getElementById('custom-icon-preview');
            if (preview) {
                const img = preview.querySelector('img');
                if (img) {
                    img.src = customIcon;
                }
            }
        }
    }

    /**
     * 设置UI事件
     */
    async setupUIEvents() {
        // 分隔符设置事件
        this.setupSeparatorEvents();

        // 自定义CSS事件
        this.setupCustomCSSEvents();

        // 自定义图标事件
        this.setupCustomIconEvents();
    }

    /**
     * 设置分隔符事件
     */
    setupSeparatorEvents() {
        // 分隔符颜色
        const separatorColor = document.getElementById('custom-separator-color');
        if (separatorColor) {
            separatorColor.addEventListener('input', debounce((e) => {
                this.separatorManager.updateConfig({ color: e.target.value });
                this.showStatus('分隔符颜色已更新');
            }, 500));
        }

        // 分隔符标题
        const separatorTitle = document.getElementById('custom-separator-title');
        if (separatorTitle) {
            separatorTitle.addEventListener('input', debounce((e) => {
                this.separatorManager.updateConfig({ title: e.target.value });
                this.showStatus('分隔符标题已更新');
            }, 500));
        }

        // 分隔符URL
        const separatorURL = document.getElementById('custom-separator-url');
        if (separatorURL) {
            separatorURL.addEventListener('input', debounce((e) => {
                this.separatorManager.updateConfig({ url: e.target.value });
                this.showStatus('分隔符URL已更新');
            }, 500));
        }

        // 分隔符字符串
        const separatorString = document.getElementById('custom-separator-string');
        if (separatorString) {
            separatorString.addEventListener('input', debounce((e) => {
                this.separatorManager.updateConfig({ strings: e.target.value });
                this.showStatus('分隔符字符串已更新');
            }, 500));
        }
    }

    /**
     * 设置自定义CSS事件
     */
    setupCustomCSSEvents() {
        const userstyle = document.getElementById('userstyle');
        if (userstyle) {
            userstyle.addEventListener('input', debounce((e) => {
                localStorage.setItem('customCSS', e.target.value);
                this.applyCustomCSS(e.target.value);
                this.showStatus('自定义CSS已应用');
            }, 1000));
        }
    }

    /**
     * 设置自定义图标事件
     */
    setupCustomIconEvents() {
        const defaultIconBtn = document.getElementById('default-icon-button');
        const customIconFile = document.getElementById('custom-icon-file');

        if (defaultIconBtn) {
            defaultIconBtn.addEventListener('click', () => {
                this.resetCustomIcon();
            });
        }

        if (customIconFile) {
            customIconFile.addEventListener('change', (e) => {
                this.handleCustomIconUpload(e);
            });
        }
    }

    /**
     * 设置代码编辑器
     */
    async setupCodeEditor() {
        const userstyle = document.getElementById('userstyle');
        if (userstyle && typeof CodeMirror !== 'undefined') {
            this.codeEditor = CodeMirror.fromTextArea(userstyle, {
                mode: 'css',
                theme: 'default',
                lineNumbers: true,
                lineWrapping: true,
                indentUnit: 4,
                tabSize: 4,
                indentWithTabs: false,
                extraKeys: {
                    'Ctrl-Space': 'autocomplete',
                    'Ctrl-S': () => {
                        this.saveCustomCSS();
                    }
                }
            });

            // 保存更改事件
            this.codeEditor.on('change', debounce(() => {
                const css = this.codeEditor.getValue();
                localStorage.setItem('customCSS', css);
                this.applyCustomCSS(css);
                this.showStatus('自定义CSS已自动保存');
            }, 2000));
        }
    }

    /**
     * 设置自定义图标功能
     */
    async setupCustomIcon() {
        // 功能已在 loadCustomIcon 和 setupCustomIconEvents 中处理
    }

    /**
     * 设置重置功能
     */
    async setupResetFunction() {
        const resetBtn = document.getElementById('reset-button');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.resetAllSettings();
            });
        }
    }

    /**
     * 应用自定义CSS
     */
    applyCustomCSS(css) {
        // 移除旧的CSS
        const oldStyle = document.getElementById('custom-css-style');
        if (oldStyle) {
            oldStyle.remove();
        }

        // 添加新的CSS
        if (css.trim()) {
            const style = document.createElement('style');
            style.id = 'custom-css-style';
            style.textContent = css;
            document.head.appendChild(style);
        }
    }

    /**
     * 保存自定义CSS
     */
    saveCustomCSS() {
        if (this.codeEditor) {
            const css = this.codeEditor.getValue();
            localStorage.setItem('customCSS', css);
            this.applyCustomCSS(css);
            this.showStatus('自定义CSS已保存');
        }
    }

    /**
     * 处理自定义图标上传
     */
    handleCustomIconUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            this.showError('请选择图片文件');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const iconData = e.target.result;
            localStorage.setItem('customIcon', iconData);

            // 更新预览
            const preview = document.getElementById('custom-icon-preview');
            if (preview) {
                const img = preview.querySelector('img');
                if (img) {
                    img.src = iconData;
                }
            }

            this.showStatus('自定义图标已更新');
        };
        reader.readAsDataURL(file);
    }

    /**
     * 重置自定义图标
     */
    resetCustomIcon() {
        localStorage.removeItem('customIcon');

        // 恢复默认图标
        const preview = document.getElementById('custom-icon-preview');
        if (preview) {
            const img = preview.querySelector('img');
            if (img) {
                img.src = 'icon.png';
            }
        }

        this.showStatus('自定义图标已重置');
    }

    /**
     * 重置所有设置
     */
    resetAllSettings() {
        if (!confirm('确定要重置所有高级设置吗？此操作不可撤销。')) {
            return;
        }

        try {
            // 重置自定义CSS
            localStorage.removeItem('customCSS');
            if (this.codeEditor) {
                this.codeEditor.setValue('');
            }
            this.applyCustomCSS('');

            // 重置自定义图标
            this.resetCustomIcon();

            // 重置分隔符设置
            this.separatorManager.reset();

            // 重新加载页面
            location.reload();
        } catch (error) {
            console.error('Failed to reset settings:', error);
            this.showError('重置设置失败');
        }
    }

    /**
     * 显示状态消息
     */
    showStatus(message) {
        const status = document.getElementById('status-message');
        if (status) {
            status.textContent = message;
            status.className = 'status-message success';
            status.style.display = 'block';

            setTimeout(() => {
                status.style.display = 'none';
            }, 3000);
        }
    }

    /**
     * 显示错误消息
     */
    showError(message) {
        const status = document.getElementById('status-message');
        if (status) {
            status.textContent = message;
            status.className = 'status-message error';
            status.style.display = 'block';

            setTimeout(() => {
                status.style.display = 'none';
            }, 5000);
        }
    }

    /**
     * 显示错误
     */
    showError(error) {
        const container = document.querySelector('fieldset');
        if (container) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'error-message';
            errorDiv.innerHTML = `
                <strong>错误:</strong> ${error.message}
                <button onclick="this.parentElement.remove()">关闭</button>
            `;
            container.appendChild(errorDiv);
        }
    }
}

// 防抖函数
function debounce(func, wait) {
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

// 初始化高级选项页面
const advancedOptions = new VBookmarksAdvancedOptions();

// 启动应用
advancedOptions.init().catch(error => {
    console.error('Failed to initialize advanced options:', error);
});

// 导出选项实例（用于测试）
export default advancedOptions;