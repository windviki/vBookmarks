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

    async function initPopup() {
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