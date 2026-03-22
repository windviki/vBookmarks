(window => {
    const document = window.document;
    const chrome = window.chrome;
    const _m = chrome.i18n.getMessage;
    const __m = _m;

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