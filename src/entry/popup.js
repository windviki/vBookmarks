/**
 * vBookmarks 弹出窗口入口
 * 临时简化版本 - 确保基本功能
 */

// 简单的错误处理
function showError(message) {
    const container = document.getElementById('tree-container');
    if (container) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: #d32f2f;">
                <div style="font-size: 48px; margin-bottom: 16px;">❌</div>
                <div style="font-size: 16px; font-weight: bold; margin-bottom: 8px;">
                    加载失败
                </div>
                <div style="font-size: 14px; color: #666;">
                    ${message}
                </div>
            </div>
        `;
    }
}

// 简化的初始化函数
async function initializePopup() {
    try {
        console.log('vBookmarks popup initializing...');

        // 基本DOM检查
        if (!document.getElementById('tree-container')) {
            throw new Error('Required DOM elements not found');
        }

        // 显示加载状态
        const container = document.getElementById('tree-container');
        container.innerHTML = '<div style="text-align: center; padding: 40px;">加载中...</div>';

        // 这里将来会加载VBookmarksApp，但现在先显示基本信息
        setTimeout(() => {
            container.innerHTML = `
                <div style="text-align: center; padding: 40px 20px;">
                    <div style="font-size: 32px; margin-bottom: 16px;">📚</div>
                    <div style="font-size: 16px; font-weight: bold; margin-bottom: 8px;">
                        vBookmarks
                    </div>
                    <div style="font-size: 14px; color: #666;">
                        模块化重构版本<br>
                        正在完善功能中...
                    </div>
                </div>
            `;
        }, 1000);

        console.log('vBookmarks popup initialized successfully');
    } catch (error) {
        console.error('Failed to initialize vBookmarks popup:', error);
        showError(error.message);
    }
}


// 设置弹出窗口特定功能
function setupPopupFeatures(app) {
    // 恢复保存的窗口大小
    restorePopupSize();

    // 设置捐赠相关功能
    setupDonationFeature();

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
            if (app.modules.bookmarkManager) {
                app.modules.bookmarkManager.createNewBookmark();
            }
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
                if (app.modules.searchManager) {
                    app.modules.searchManager.clearSearch();
                }
            } else {
                searchTimeout = setTimeout(async () => {
                    try {
                        if (app.modules.searchManager) {
                            await app.modules.searchManager.search(query);
                        }
                    } catch (error) {
                        logger.error('Search failed:', error);
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
                    ${error.message || '未知错误'}
                </div>
            </div>
        `;
    }
}

// 恢复保存的窗口大小
function restorePopupSize() {
    if (localStorage.popupHeight) {
        if (localStorage.popupHeight > 600) {
            localStorage.popupHeight = 600;
        }
        document.body.style.height = `${localStorage.popupHeight}px`;
    }

    if (localStorage.popupWidth) {
        document.body.style.width = `${localStorage.popupWidth}px`;
    }
}

// 设置捐赠相关功能
function setupDonationFeature() {
    // 设置捐赠关闭按钮
    const donationClose = document.getElementById('donation-close');
    const donationDiv = document.getElementById('donation');
    if (donationClose && donationDiv) {
        donationClose.addEventListener('click', () => {
            donationDiv.style.display = 'none';
            // 保存偏好到 localStorage
            localStorage.donationDismissed = 'true';
        });
    }

    // 检查捐赠是否之前被关闭
    if (localStorage.donationDismissed === 'true') {
        const donationDiv = document.getElementById('donation');
        if (donationDiv) {
            donationDiv.style.display = 'none';
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

// 启动应用
initializePopup();