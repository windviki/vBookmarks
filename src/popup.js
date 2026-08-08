(window => {
    const document = window.document;
    const chrome = window.chrome;
    const _m = chrome.i18n.getMessage;
    const __m = _m;

    // Apply the theme before first paint (store.js loads first and its mirror
    // is synchronously pre-filled), then refine it once chrome.storage.local,
    // the source of truth, has been overlaid onto the mirror.
    document.body.dataset.theme = store.get('theme', 'auto');
    store.ready.then(() => {
        document.body.dataset.theme = store.get('theme', 'auto');
    });

    // Phase 2b: the popup page doubles as the side panel page. The panel loads
    // sidepanel.html (a copy of popup.html whose <body> carries panel-mode);
    // the ?panel=1 query form is kept for backwards compatibility.
    // The panel has no fixed popup size: tag the body for CSS and skip the
    // popup width/height restore below.
    const IS_PANEL = window.location.search.includes('panel=1')
        || document.body.classList.contains('panel-mode');
    if (IS_PANEL) {
        document.body.classList.add('panel-mode');
        // 追踪侧边栏打开状态，使得 openInSidePanel 关闭时：
        // - 面板加载 → 切换到 toggle 模式，下次点击关闭面板
        // - 面板关闭 → 直接重置为 popup 模式（在 pagehide 中同步调用，
        //   避免 storage.onChanged 异步链路导致的竞态条件）
        // v4 task-3 #19：裸标记无法证明面板存活（浏览器崩溃/渲染进程被杀
        // 时 pagehide 不触发，storage.session 里的 true 会残留并被 SW 启动
        // 反复推导成 toggle 模式）。面板页按 PANEL_HEARTBEAT_MS 间隔心跳
        // sidePanelHeartbeat（与 src/panel-behavior.js 的常量保持一致——
        // 本文件是传统脚本无法 import，改动时需同步两边）。
        const beat = () => chrome.storage.session.set({ sidePanelHeartbeat: Date.now() });
        chrome.storage.session.set({ sidePanelIsOpen: true, sidePanelHeartbeat: Date.now() });
        const heartbeatTimer = setInterval(beat, 20000); // PANEL_HEARTBEAT_MS
        // 4.0.2 (option-off one-time toggle): hold a runtime port open for the
        // panel's lifetime. When Chrome destroys the panel page (an action-toggle
        // close — pagehide is not guaranteed, and the page's async reset can be
        // dropped mid-teardown), the port disconnects and the service worker
        // (panel-behavior.js) immediately restores popup mode so the next icon
        // click opens the popup again.
        if (chrome.runtime && chrome.runtime.connect) {
            const panelPort = chrome.runtime.connect({ name: 'vbm-panel' });
            window.addEventListener('pagehide', () => {
                try { panelPort.disconnect(); } catch (_) {}
            }, { once: true });
        }
        window.addEventListener('pagehide', () => {
            clearInterval(heartbeatTimer);
            chrome.storage.session.set({ sidePanelIsOpen: false });
            // 直接重置 panel behavior，不等 background 的 onChanged 回调。
            // pagehide 中 JS 仍可执行，同步发起调用确保在用户下次点击前生效。
            chrome.storage.local.get('openInSidePanel', data => {
                if (!data.openInSidePanel) {
                    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false })
                        .catch(() => {});
                }
            });
        });
        // bfcache 恢复时重新标记面板为打开状态
        window.addEventListener('pageshow', e => {
            if (e.persisted) {
                chrome.storage.session.set({ sidePanelIsOpen: true, sidePanelHeartbeat: Date.now() });
            }
        });
    }

    async function initPopup() {
        if (IS_PANEL) {
            return;
        }
        // Restore size
        const popupHeight = await getSetting('popupHeight', '');
        if (popupHeight) {
            let height = parseInt(popupHeight);
            if (height > 600) {
                height = 600;
                await setSetting('popupHeight', height);
            }
            document.body.style.height = `${height}px`;
        }

        const popupWidth = await getSetting('popupWidth', '');
        if (popupWidth) {
            document.body.style.width = `${parseInt(popupWidth)}px`;
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        initPopup();
    });
})(window);