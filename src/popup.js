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
        chrome.storage.session.set({ sidePanelIsOpen: true });
        window.addEventListener('pagehide', () => {
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
                chrome.storage.session.set({ sidePanelIsOpen: true });
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