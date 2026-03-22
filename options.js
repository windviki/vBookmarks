(window => {
    const document = window.document;
    const chrome = window.chrome;
    const _m = chrome.i18n.getMessage;
    const __m = _m;

    async function initOptions() {
        document.title = `${_m('extName')} ${_m('options')}`;

        // General settings (local storage)
        const clickNewTab = $('click-new-tab');
        clickNewTab.checked = !!(await getSetting('leftClickNewTab', ''));
        clickNewTab.addEventListener('change', async () => {
            await setSetting('leftClickNewTab', clickNewTab.checked ? '1' : '');
        });

        const openNewTabBg = $('open-new-tab-bg');
        openNewTabBg.checked = !!(await getSetting('middleClickBgTab', ''));
        openNewTabBg.addEventListener('change', async () => {
            await setSetting('middleClickBgTab', openNewTabBg.checked ? '1' : '');
        });

        const closeUnusedFolders = $('close-unused-folders');
        closeUnusedFolders.checked = !!(await getSetting('closeUnusedFolders', ''));
        closeUnusedFolders.addEventListener('change', async () => {
            await setSetting('closeUnusedFolders', closeUnusedFolders.checked ? '1' : '');
        });

        const popupStayOpen = $('popup-stay-open');
        popupStayOpen.checked = !!(await getSetting('bookmarkClickStayOpen', ''));
        popupStayOpen.addEventListener('change', async () => {
            await setSetting('bookmarkClickStayOpen', popupStayOpen.checked ? '1' : '');
        });

        const confirmOpenFolder = $('confirm-open-folder');
        confirmOpenFolder.checked = !(await getSetting('dontConfirmOpenFolder', ''));
        confirmOpenFolder.addEventListener('change', async () => {
            await setSetting('dontConfirmOpenFolder', confirmOpenFolder.checked ? '' : '1');
        });

        const rememberPrevState = $('remember-prev-state');
        rememberPrevState.checked = !(await getSetting('dontRememberState', ''));
        rememberPrevState.addEventListener('change', async () => {
            await setSetting('dontRememberState', rememberPrevState.checked ? '' : '1');
        });

        const onlyShowBMBar = $('only-show-bmbar');
        onlyShowBMBar.checked = !!(await getSetting('onlyShowBMBar', ''));
        onlyShowBMBar.addEventListener('change', async () => {
            await setSetting('onlyShowBMBar', onlyShowBMBar.checked ? '1' : '');
        });

        const searchAfterEnter = $('search-after-enter');
        searchAfterEnter.checked = !!(await getSetting('searchAfterEnter', ''));
        searchAfterEnter.addEventListener('change', async () => {
            await setSetting('searchAfterEnter', searchAfterEnter.checked ? '1' : '');
        });

        const autoResizePopup = $('auto-resize-popup');
        autoResizePopup.checked = (await getSetting('autoResizePopup', 'true')) !== 'false';
        autoResizePopup.addEventListener('change', async () => {
            await setSetting('autoResizePopup', autoResizePopup.checked ? 'true' : 'false');
        });

        // Sync settings (sync storage)
        const showSyncStatus = $('show-sync-status');
        showSyncStatus.checked = (await getSetting('showSyncStatus', 'true', true)) !== 'false';
        showSyncStatus.addEventListener('change', async () => {
            await setSetting('showSyncStatus', showSyncStatus.checked ? 'true' : 'false', true);
            // Update sync manager settings
            if (window.syncManager) {
                window.syncManager.syncSettings.showSyncStatus = showSyncStatus.checked;
                await window.syncManager.saveSettings();
            }
            // Refresh the UI to show/hide sync indicators immediately
            if (window.opener && window.opener.neat) {
                window.opener.neat.refreshSyncIndicators();
            }
        });

        const highlightUnsynced = $('highlight-unsynced');
        highlightUnsynced.checked = (await getSetting('highlightUnsynced', 'true', true)) !== 'false';
        highlightUnsynced.addEventListener('change', async () => {
            await setSetting('highlightUnsynced', highlightUnsynced.checked ? 'true' : 'false', true);
            // Update sync manager settings
            if (window.syncManager) {
                window.syncManager.syncSettings.highlightUnsynced = highlightUnsynced.checked;
                await window.syncManager.saveSettings();
            }
        });

        const autoRefreshSync = $('auto-refresh-sync');
        autoRefreshSync.checked = (await getSetting('autoRefreshSync', 'true', true)) !== 'false';
        autoRefreshSync.addEventListener('change', async () => {
            await setSetting('autoRefreshSync', autoRefreshSync.checked ? 'true' : 'false', true);
            // Update sync manager settings
            if (window.syncManager) {
                window.syncManager.syncSettings.autoRefreshSync = autoRefreshSync.checked;
                if (autoRefreshSync.checked) {
                    window.syncManager.startAutoRefresh();
                } else {
                    window.syncManager.stopAutoRefresh();
                }
                await window.syncManager.saveSettings();
            }
        });

        const syncRefreshInterval = $('sync-refresh-interval');
        syncRefreshInterval.value = await getSetting('syncRefreshInterval', 60, true);
        syncRefreshInterval.addEventListener('input', async () => {
            const val = parseInt(syncRefreshInterval.value);
            if (val >= 20 && val <= 300) {
                await setSetting('syncRefreshInterval', val, true);
                // Update sync manager settings
                if (window.syncManager) {
                    window.syncManager.syncSettings.syncRefreshInterval = val * 1000;
                    await window.syncManager.saveSettings();
                    // Restart auto-refresh if enabled
                    if (window.syncManager.syncSettings.autoRefreshSync) {
                        window.syncManager.stopAutoRefresh();
                        window.syncManager.startAutoRefresh();
                    }
                }
            }
        });

        const zoom = $('zoom-input');
        setInterval(async () => {
            zoom.value = await getSetting('zoom', 100);
        }, 1000);
        zoom.addEventListener('input', async () => {
            const val = parseInt(zoom.value);
            if (val === 100) {
                await storageManager.removeSetting('zoom');
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
        document.getElementById('option-search-after-enter').innerText = __m('optionSearchAfterEnter');
        document.getElementById('option-auto-resize-popup').innerText = __m('optionAutoResizePopup');
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