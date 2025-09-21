/**
 * vBookmarks 选项页面入口
 * 现代化的模块化选项页面
 */
import { SeparatorManager } from '../core/storage-manager/separator-manager.js';
import { globalEventSystem, Events } from '../core/event-system/event-system.js';

class VBookmarksOptions {
    constructor() {
        this.initialized = false;
        this.separatorManager = null;
        this.currentTheme = 'light';
    }

    /**
     * 初始化选项页面
     */
    async init() {
        if (this.initialized) {
            console.warn('Options page already initialized');
            return;
        }

        try {
            console.log('Initializing vBookmarks options...');

            // 初始化核心管理器
            this.separatorManager = new SeparatorManager();

            // 等待DOM就绪
            await this.waitForDOMReady();

            // 加载设置
            await this.loadSettings();

            // 设置UI事件
            await this.setupUIEvents();

            // 设置主题切换
            await this.setupThemeToggle();

            // 设置实时预览
            await this.setupLivePreview();

            this.initialized = true;
            console.log('vBookmarks options initialized successfully');
        } catch (error) {
            console.error('Failed to initialize options:', error);
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
            // 加载基本设置
            this.loadBasicSettings();

            // 加载分隔符设置
            this.loadSeparatorSettings();

            // 加载高级设置
            this.loadAdvancedSettings();

            console.log('Settings loaded successfully');
        } catch (error) {
            console.error('Failed to load settings:', error);
            throw error;
        }
    }

    /**
     * 加载基本设置
     */
    loadBasicSettings() {
        // 主题设置
        const theme = localStorage.getItem('theme') || 'light';
        this.setTheme(theme);

        // 缩放设置
        const zoom = localStorage.getItem('zoom') || '100';
        this.setZoom(zoom);

        // 其他基本设置
        this.loadCheckboxSetting('autoResize', true);
        this.loadCheckboxSetting('closeOnOpen', false);
        this.loadCheckboxSetting('openInBackground', false);
        this.loadCheckboxSetting('showStatusBar', true);
    }

    /**
     * 加载复选框设置
     */
    loadCheckboxSetting(settingId, defaultValue) {
        const checkbox = document.getElementById(settingId);
        if (checkbox) {
            const savedValue = localStorage.getItem(settingId);
            checkbox.checked = savedValue !== null ? savedValue === 'true' : defaultValue;
        }
    }

    /**
     * 加载分隔符设置
     */
    loadSeparatorSettings() {
        // 分隔符标题
        const separatorTitle = document.getElementById('separator-title');
        if (separatorTitle) {
            separatorTitle.value = this.separatorManager.separatorTitle;
        }

        // 分隔符URL
        const separatorURL = document.getElementById('separator-url');
        if (separatorURL) {
            separatorURL.value = this.separatorManager.separatorURL;
        }

        // 分隔符字符串
        const separatorString = document.getElementById('separator-string');
        if (separatorString) {
            separatorString.value = this.separatorManager.separatorString.join(';');
        }

        // 分隔符列表
        this.loadSeparatorList();
    }

    /**
     * 加载分隔符列表
     */
    loadSeparatorList() {
        const container = document.getElementById('separator-list');
        if (!container) return;

        container.innerHTML = '';

        const separators = this.separatorManager.getAll();
        if (separators.length === 0) {
            container.innerHTML = '<p class="no-separators">没有分隔符</p>';
            return;
        }

        separators.forEach(separator => {
            const item = document.createElement('div');
            item.className = 'separator-item';
            item.innerHTML = `
                <span class="separator-text">${this.escapeHtml(separator)}</span>
                <button class="remove-separator" data-separator="${this.escapeHtml(separator)}">删除</button>
            `;
            container.appendChild(item);
        });
    }

    /**
     * 加载高级设置
     */
    loadAdvancedSettings() {
        // 自定义CSS
        const customCSS = document.getElementById('custom-css');
        if (customCSS) {
            customCSS.value = localStorage.getItem('customCSS') || '';
        }

        // 导入/导出设置
        this.setupImportExport();
    }

    /**
     * 设置UI事件
     */
    async setupUIEvents() {
        // 基本设置事件
        this.setupBasicSettingsEvents();

        // 分隔符设置事件
        this.setupSeparatorSettingsEvents();

        // 高级设置事件
        this.setupAdvancedSettingsEvents();

        // 保存按钮事件
        this.setupSaveEvents();
    }

    /**
     * 设置基本设置事件
     */
    setupBasicSettingsEvents() {
        // 复选框设置
        const checkboxes = ['autoResize', 'closeOnOpen', 'openInBackground', 'showStatusBar'];
        checkboxes.forEach(settingId => {
            const checkbox = document.getElementById(settingId);
            if (checkbox) {
                checkbox.addEventListener('change', (e) => {
                    localStorage.setItem(settingId, e.target.checked);
                    this.showStatus(`${settingId} 设置已保存`);
                });
            }
        });
    }

    /**
     * 设置分隔符设置事件
     */
    setupSeparatorSettingsEvents() {
        // 分隔符标题
        const separatorTitle = document.getElementById('separator-title');
        if (separatorTitle) {
            separatorTitle.addEventListener('input', debounce((e) => {
                this.separatorManager.updateConfig({ title: e.target.value });
                this.showStatus('分隔符标题已更新');
            }, 500));
        }

        // 分隔符URL
        const separatorURL = document.getElementById('separator-url');
        if (separatorURL) {
            separatorURL.addEventListener('input', debounce((e) => {
                this.separatorManager.updateConfig({ url: e.target.value });
                this.showStatus('分隔符URL已更新');
            }, 500));
        }

        // 分隔符字符串
        const separatorString = document.getElementById('separator-string');
        if (separatorString) {
            separatorString.addEventListener('input', debounce((e) => {
                this.separatorManager.updateConfig({ strings: e.target.value });
                this.showStatus('分隔符字符串已更新');
            }, 500));
        }

        // 添加分隔符
        const addSeparator = document.getElementById('add-separator');
        if (addSeparator) {
            addSeparator.addEventListener('click', () => {
                this.addSeparator();
            });
        }

        // 删除分隔符事件委托
        const container = document.getElementById('separator-list');
        if (container) {
            container.addEventListener('click', (e) => {
                if (e.target.classList.contains('remove-separator')) {
                    const separator = e.target.dataset.separator;
                    this.removeSeparator(separator);
                }
            });
        }
    }

    /**
     * 设置高级设置事件
     */
    setupAdvancedSettingsEvents() {
        // 自定义CSS
        const customCSS = document.getElementById('custom-css');
        if (customCSS) {
            customCSS.addEventListener('input', debounce((e) => {
                localStorage.setItem('customCSS', e.target.value);
                this.applyCustomCSS(e.target.value);
                this.showStatus('自定义CSS已应用');
            }, 1000));
        }

        // 重置设置
        const resetSettings = document.getElementById('reset-settings');
        if (resetSettings) {
            resetSettings.addEventListener('click', () => {
                this.resetSettings();
            });
        }
    }

    /**
     * 设置保存事件
     */
    setupSaveEvents() {
        const saveButton = document.getElementById('save-settings');
        if (saveButton) {
            saveButton.addEventListener('click', () => {
                this.saveAllSettings();
            });
        }

        // 自动保存
        const autoSave = document.getElementById('auto-save');
        if (autoSave) {
            autoSave.addEventListener('change', (e) => {
                localStorage.setItem('autoSave', e.target.checked);
            });
        }
    }

    /**
     * 设置主题切换
     */
    async setupThemeToggle() {
        const themeSelect = document.getElementById('theme-select');
        if (themeSelect) {
            themeSelect.addEventListener('change', (e) => {
                this.setTheme(e.target.value);
            });
        }
    }

    /**
     * 设置实时预览
     */
    async setupLivePreview() {
        // 实时预览自定义CSS
        const customCSS = document.getElementById('custom-css');
        if (customCSS) {
            customCSS.addEventListener('input', debounce((e) => {
                this.applyCustomCSS(e.target.value);
            }, 500));
        }
    }

    /**
     * 设置主题
     */
    setTheme(theme) {
        this.currentTheme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);

        const themeSelect = document.getElementById('theme-select');
        if (themeSelect) {
            themeSelect.value = theme;
        }

        this.showStatus(`主题已切换为 ${theme === 'dark' ? '深色' : '浅色'}`);
    }

    /**
     * 设置缩放
     */
    setZoom(zoom) {
        document.body.setAttribute('data-zoom', zoom);
        localStorage.setItem('zoom', zoom);

        const zoomSelect = document.getElementById('zoom-select');
        if (zoomSelect) {
            zoomSelect.value = zoom;
        }
    }

    /**
     * 添加分隔符
     */
    addSeparator() {
        const input = document.getElementById('new-separator');
        if (!input) return;

        const separator = input.value.trim();
        if (!separator) {
            this.showError('请输入分隔符内容');
            return;
        }

        this.separatorManager.add(separator);
        this.loadSeparatorList();
        input.value = '';
        this.showStatus('分隔符已添加');
    }

    /**
     * 删除分隔符
     */
    removeSeparator(separator) {
        this.separatorManager.remove(separator);
        this.loadSeparatorList();
        this.showStatus('分隔符已删除');
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
     * 保存所有设置
     */
    async saveAllSettings() {
        try {
            // 保存基本设置
            this.saveBasicSettings();

            // 保存分隔符设置
            this.separatorManager.save();

            // 保存高级设置
            this.saveAdvancedSettings();

            this.showStatus('所有设置已保存');
            globalEventSystem.emit(Events.SETTINGS_SAVED);
        } catch (error) {
            console.error('Failed to save settings:', error);
            this.showError('保存设置失败');
        }
    }

    /**
     * 保存基本设置
     */
    saveBasicSettings() {
        // 基本设置已在change事件中自动保存
        console.log('Basic settings saved');
    }

    /**
     * 保存高级设置
     */
    saveAdvancedSettings() {
        const customCSS = document.getElementById('custom-css');
        if (customCSS) {
            localStorage.setItem('customCSS', customCSS.value);
        }
    }

    /**
     * 重置设置
     */
    async resetSettings() {
        if (!confirm('确定要重置所有设置吗？此操作不可撤销。')) {
            return;
        }

        try {
            // 重置基本设置
            localStorage.removeItem('theme');
            localStorage.removeItem('zoom');
            localStorage.removeItem('customCSS');

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
     * 设置导入/导出
     */
    setupImportExport() {
        // 导出设置
        const exportSettings = document.getElementById('export-settings');
        if (exportSettings) {
            exportSettings.addEventListener('click', () => {
                this.exportSettings();
            });
        }

        // 导入设置
        const importSettings = document.getElementById('import-settings');
        if (importSettings) {
            importSettings.addEventListener('click', () => {
                this.importSettings();
            });
        }
    }

    /**
     * 导出设置
     */
    exportSettings() {
        try {
            const settings = {
                theme: localStorage.getItem('theme'),
                zoom: localStorage.getItem('zoom'),
                customCSS: localStorage.getItem('customCSS'),
                separatorConfig: this.separatorManager.getConfig(),
                timestamp: new Date().toISOString()
            };

            const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `vbookmarks-settings-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);

            this.showStatus('设置已导出');
        } catch (error) {
            console.error('Failed to export settings:', error);
            this.showError('导出设置失败');
        }
    }

    /**
     * 导入设置
     */
    importSettings() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';

        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const settings = JSON.parse(e.target.result);

                    // 应用设置
                    if (settings.theme) {
                        this.setTheme(settings.theme);
                    }
                    if (settings.zoom) {
                        this.setZoom(settings.zoom);
                    }
                    if (settings.customCSS) {
                        localStorage.setItem('customCSS', settings.customCSS);
                        this.applyCustomCSS(settings.customCSS);
                    }
                    if (settings.separatorConfig) {
                        this.separatorManager.updateConfig(settings.separatorConfig);
                    }

                    this.showStatus('设置已导入');
                } catch (error) {
                    console.error('Failed to import settings:', error);
                    this.showError('导入设置失败：文件格式错误');
                }
            };

            reader.readAsText(file);
        };

        input.click();
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
        const container = document.getElementById('options-container');
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

    /**
     * HTML转义
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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

// 初始化选项页面
const options = new VBookmarksOptions();

// 启动应用
options.init().catch(error => {
    console.error('Failed to initialize options:', error);
});

// 导出选项实例（用于测试）
export default options;