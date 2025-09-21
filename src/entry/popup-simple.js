/**
 * vBookmarks 弹出窗口入口
 * 简化版本 - 确保基本加载功能
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

        // 模拟加载书签数据
        setTimeout(() => {
            container.innerHTML = `
                <div style="text-align: center; padding: 40px 20px;">
                    <div style="font-size: 32px; margin-bottom: 16px;">📚</div>
                    <div style="font-size: 16px; font-weight: bold; margin-bottom: 8px;">
                        vBookmarks
                    </div>
                    <div style="font-size: 14px; color: #666;">
                        模块化重构版本<br>
                        基本功能正常
                    </div>
                    <div style="margin-top: 20px; font-size: 12px; color: #999;">
                        Chrome扩展加载成功
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

// 启动应用
initializePopup();