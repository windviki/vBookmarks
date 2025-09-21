/**
 * vBookmarks 弹出窗口入口
 * 现代化的模块化入口点
 */
import { initApp } from '../app-v3.js';

// 初始化应用
async function initializePopup() {
    try {
        console.log('Initializing vBookmarks popup...');

        // 等待DOM就绪
        if (document.readyState === 'loading') {
            await new Promise(resolve => {
                document.addEventListener('DOMContentLoaded', resolve);
            });
        }

        // 初始化应用
        const app = await initApp();

        // 设置弹出窗口特定功能
        setupPopupFeatures(app);

        console.log('vBookmarks popup initialized successfully');
    } catch (error) {
        console.error('Failed to initialize vBookmarks popup:', error);
        showError(error);
    }
}

// 设置弹出窗口特定功能
function setupPopupFeatures(app) {
    // 自动调整弹出窗口大小
    autoResizePopup();

    // 设置键盘快捷键
    setupKeyboardShortcuts(app);

    // 设置搜索功能
    setupSearch(app);

    // 监听窗口大小变化
    window.addEventListener('resize', debounce(autoResizePopup, 300));
}

// 自动调整弹出窗口大小
function autoResizePopup() {
    const body = document.body;
    const html = document.documentElement;

    // 获取内容高度
    const contentHeight = Math.max(
        body.scrollHeight,
        body.offsetHeight,
        html.clientHeight,
        html.scrollHeight,
        html.offsetHeight
    );

    // 获取内容宽度
    const contentWidth = Math.max(
        body.scrollWidth,
        body.offsetWidth,
        html.clientWidth,
        html.scrollWidth,
        html.offsetWidth
    );

    // 限制最大尺寸
    const maxHeight = Math.min(contentHeight, 600);
    const maxWidth = Math.min(contentWidth, 400);

    // 调整窗口大小
    if (chrome.windows) {
        chrome.windows.getCurrent((window) => {
            if (window) {
                chrome.windows.update(window.id, {
                    width: maxWidth,
                    height: maxHeight
                });
            }
        });
    }
}

// 设置键盘快捷键
function setupKeyboardShortcuts(app) {
    document.addEventListener('keydown', (e) => {
        // Ctrl+F 或 / 聚焦搜索
        if ((e.ctrlKey && e.key === 'f') || e.key === '/') {
            e.preventDefault();
            focusSearch();
        }

        // Escape 关闭弹出窗口
        if (e.key === 'Escape') {
            window.close();
        }

        // Ctrl+N 新建书签
        if (e.ctrlKey && e.key === 'n') {
            e.preventDefault();
            // 实现新建书签功能
        }
    });
}

// 设置搜索功能
function setupSearch(app) {
    const searchInput = document.getElementById('search-input');

    if (searchInput) {
        let searchTimeout;

        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            const query = e.target.value.trim();

            if (query === '') {
                app.clearSearch();
            } else {
                searchTimeout = setTimeout(async () => {
                    try {
                        await app.search(query);
                    } catch (error) {
                        console.error('Search failed:', error);
                    }
                }, 300);
            }
        });
    }
}

// 聚焦搜索框
function focusSearch() {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.focus();
        searchInput.select();
    }
}

// 显示错误信息
function showError(error) {
    const container = document.getElementById('tree-container');
    if (container) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: #d32f2f;">
                <div style="font-size: 48px; margin-bottom: 16px;">❌</div>
                <div style="font-size: 16px; font-weight: bold; margin-bottom: 8px;">
                    加载失败
                </div>
                <div style="font-size: 14px; color: #666;">
                    ${error.message}
                </div>
            </div>
        `;
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

// 启动应用
initializePopup();