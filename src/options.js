const $ = id => document.getElementById(id);

(window => {
    const document = window.document;
    const chrome = window.chrome;
    const _m = chrome.i18n.getMessage;
    const __m = _m;

    async function initOptions() {
        document.title = `${_m('extName')} ${_m('options')}`;

        // Theme: apply the pre-filled mirror value immediately, then refine
        // from chrome.storage.local (the source of truth)
        document.body.dataset.theme = store.get('theme', 'auto');

        const themeSelect = $('theme-select');
        const theme = await getSetting('theme', 'auto');
        themeSelect.value = theme;
        document.body.dataset.theme = theme;
        themeSelect.addEventListener('change', async () => {
            const newTheme = themeSelect.value;
            document.body.dataset.theme = newTheme;
            // chrome.storage.local is the source of truth; the localStorage
            // copy lets store.js synchronously pre-fill it in the popup
            localStorage.setItem('theme', newTheme);
            await setSetting('theme', newTheme);
        });

        // Configuration for general settings
        const generalSettings = [
            { id: 'click-new-tab', key: 'leftClickNewTab', defaultValue: '', inverted: false },
            { id: 'open-new-tab-bg', key: 'middleClickBgTab', defaultValue: '', inverted: false },
            { id: 'close-unused-folders', key: 'closeUnusedFolders', defaultValue: '', inverted: false },
            { id: 'popup-stay-open', key: 'bookmarkClickStayOpen', defaultValue: '', inverted: false },
            { id: 'confirm-open-folder', key: 'dontConfirmOpenFolder', defaultValue: '', inverted: true },
            { id: 'remember-prev-state', key: 'dontRememberState', defaultValue: '', inverted: true },
            { id: 'only-show-bmbar', key: 'onlyShowBMBar', defaultValue: '', inverted: false },
            { id: 'show-recent-bookmarks', key: 'showRecentBookmarks', defaultValue: '1', inverted: false },
            { id: 'search-after-enter', key: 'searchAfterEnter', defaultValue: '', inverted: false },
            { id: 'auto-resize-popup', key: 'autoResizePopup', defaultValue: 'true', inverted: false },
            { id: 'open-in-side-panel', key: 'openInSidePanel', defaultValue: '', inverted: false }
        ];

        // Initialize general settings
        for (const setting of generalSettings) {
            const element = $(setting.id);
            const value = await getSetting(setting.key, setting.defaultValue);
            element.checked = setting.inverted ? !value : !!value;
            element.addEventListener('change', async () => {
                const newValue = setting.inverted ? (element.checked ? '' : '1') : (element.checked ? '1' : '');
                await setSetting(setting.key, newValue);
            });
        }

        // Configuration for sync settings
        const syncSettings = [
            { id: 'show-sync-status', key: 'showSyncStatus', defaultValue: 'true', inverted: false },
            { id: 'highlight-unsynced', key: 'highlightUnsynced', defaultValue: 'true', inverted: false },
            { id: 'auto-refresh-sync', key: 'autoRefreshSync', defaultValue: 'true', inverted: false }
        ];

        // Initialize sync settings. One write per change is enough: the
        // service worker (src/sync-engine.js) observes chrome.storage.sync
        // and reschedules its refresh alarm itself, and the popup mirrors
        // status via storage.session — no page-side direct calls needed.
        for (const setting of syncSettings) {
            const element = $(setting.id);
            const value = await getSetting(setting.key, setting.defaultValue, true);
            // Toggles may be stored as 'true'/'false' strings or booleans
            element.checked = value !== 'false' && value !== false;
            element.addEventListener('change', async () => {
                const newValue = element.checked ? 'true' : 'false';
                await setSetting(setting.key, newValue, true);
            });
        }

        const syncRefreshInterval = $('sync-refresh-interval');
        syncRefreshInterval.value = await getSetting('syncRefreshInterval', 60, true);
        // Debounced: 'input' fires per keystroke and chrome.storage.sync is
        // rate-limited (~120 writes/min).
        let syncRefreshIntervalTimer = null;
        syncRefreshInterval.addEventListener('input', () => {
            const val = parseInt(syncRefreshInterval.value);
            if (val >= 20 && val <= 300) {
                clearTimeout(syncRefreshIntervalTimer);
                syncRefreshIntervalTimer = setTimeout(() => {
                    setSetting('syncRefreshInterval', val, true);
                }, 500);
            }
        });

        const zoom = $('zoom-input');
        setInterval(async () => {
            zoom.value = await getSetting('zoom', 100);
        }, 1000);
        zoom.addEventListener('input', async () => {
            const val = parseInt(zoom.value);
            if (val === 100) {
                await removeSetting('zoom');
            } else {
                await setSetting('zoom', val);
            }
        });

        window.onerror = function () {
            chrome.runtime.sendMessage({
                error: [].slice.call(arguments)
            });
        };

        // Set labels
        document.getElementById('advanced-options').innerText = __m('advancedOptions');
        document.getElementById('ext-name').innerText = __m('extName');
        document.getElementById('small-options').innerText = __m('options');
        document.getElementById('general').innerText = __m('general');
        document.getElementById('option-click-new-tab').innerText = __m('optionClickNewTab');
        document.getElementById('option-open-new-tab-bg').innerText = __m('optionOpenNewTab');
        document.getElementById('option-close-unused-folders').innerText = __m('optionCloseUnusedFolders');
        document.getElementById('option-popup-stay-open').innerText = __m('optionPopupStays');
        document.getElementById('option-confirm-open-folder').innerText = __m('optionConfirmOpenFolder');
        document.getElementById('option-remember-prev-state').innerText = __m('optionRememberPrevState');
        document.getElementById('option-only-show-bmbar').innerText = __m('optionOnlyShowBookmarkBar');
        document.getElementById('option-show-recent-bookmarks').innerText = __m('optionShowRecentBookmarks');
        document.getElementById('option-search-after-enter').innerText = __m('optionSearchAfterEnter');
        document.getElementById('option-auto-resize-popup').innerText = __m('optionAutoResizePopup');
        document.getElementById('option-open-in-side-panel').innerText = __m('optionOpenInSidePanel');
        document.getElementById('option-theme').innerText = __m('optionTheme');
        document.getElementById('option-theme-auto').innerText = __m('optionThemeAuto');
        document.getElementById('option-theme-light').innerText = __m('optionThemeLight');
        document.getElementById('option-theme-dark').innerText = __m('optionThemeDark');
        document.getElementById('accessibility').innerText = __m('accessibility');
        document.getElementById('option-zoom').innerText = __m('optionZoom');

        // Sync settings labels
        document.getElementById('sync-options').innerText = __m('syncOptions');
        document.getElementById('option-show-sync-status').innerText = __m('optionShowSyncStatus');
        document.getElementById('option-highlight-unsynced').innerText = __m('optionHighlightUnsynced');
        document.getElementById('option-auto-refresh-sync').innerText = __m('optionAutoRefreshSync');
        document.getElementById('option-sync-refresh-interval').innerText = __m('optionSyncRefreshInterval');
        document.getElementById('option-sync-refresh-interval-seconds').innerText = __m('optionSyncRefreshIntervalSeconds');
        document.getElementById('options-footer-1').innerHTML = '<p>Thanks: Lim Chee Aun</p>';
        document.getElementById('options-footer-3').innerHTML =
            '<a href="https://github.com/windviki">Follow me @windviki on Github</a>';
        document.getElementById('options-footer-4').innerHTML =
            '<a href="https://windviki.github.io/vBookmarks/">vBookmarks Mainpage (docs and source code)</a>';
    }

    document.addEventListener('DOMContentLoaded', () => {
        initOptions();
    });
})(window);