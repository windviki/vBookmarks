// 初始化sync manager（如果还没有初始化）
if (typeof SyncManager !== 'undefined' && !window.syncManager) {
    window.syncManager = new SyncManager();
}

// 等待所有依赖初始化完成
function waitForDependencies() {
    const hasMetadata = window.BookmarkMetadataManager && window.metadataManager;
    const hasSync = window.syncManager;

    if (hasMetadata && hasSync) {
        const script = document.createElement('script');
        script.src = 'neat.js';
        document.head.appendChild(script);
        console.log('✅ All dependencies initialized, loading neat.js');
    } else {
        console.log('⏳ Waiting for dependencies... Metadata:', hasMetadata, 'Sync:', hasSync);
        setTimeout(waitForDependencies, 50);
    }
}

// 开始等待依赖初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForDependencies);
} else {
    waitForDependencies();
}