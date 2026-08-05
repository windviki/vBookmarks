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
            // v4 task-2 (§5.7): non-empty folder delete confirmation, default on
            { id: 'confirm-delete-folder', key: 'confirmDeleteFolder', defaultValue: '1', inverted: false },
            { id: 'remember-prev-state', key: 'dontRememberState', defaultValue: '', inverted: true },
            { id: 'only-show-bmbar', key: 'onlyShowBMBar', defaultValue: '', inverted: false },
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

        // v4 task-2: the "Views" group (docs/v4task-2.md §7). Tab strip,
        // list-row path labels, the recent tab and search history — all on
        // by default. (showRecentBookmarks moved here from General when the
        // in-tree recent section became a view; recentBookmarksCollapsed is
        // now a dead key — stored value kept, UI removed.)
        const viewSettings = [
            { id: 'show-view-tabs', key: 'showViewTabs', defaultValue: '1', inverted: false },
            // v4 task-3 #6: reopen on the view the popup was left on
            { id: 'remember-view', key: 'rememberView', defaultValue: '1', inverted: false },
            // v4 task-3 #18: compulsive mode — no count badges on the tabs
            { id: 'show-tab-badges', key: 'showTabBadges', defaultValue: '1', inverted: false },
            { id: 'show-item-path', key: 'showItemPath', defaultValue: '1', inverted: false },
            { id: 'show-recent-bookmarks', key: 'showRecentBookmarks', defaultValue: '1', inverted: false },
            // third-round: the other list views get the same per-view
            // visibility switch recent already had — a hidden view drops its
            // tab and every entry point (Ctrl+number, palette) until re-enabled
            { id: 'show-stats-view', key: 'showStatsView', defaultValue: '1', inverted: false },
            { id: 'show-dead-view', key: 'showDeadView', defaultValue: '1', inverted: false },
            { id: 'show-dupes-view', key: 'showDupesView', defaultValue: '1', inverted: false },
            // v4 task-3 #20: the v4 chrome is individually switchable…
            { id: 'palette-enabled', key: 'paletteEnabled', defaultValue: '1', inverted: false },
            { id: 'quick-add-enabled', key: 'quickAddEnabled', defaultValue: '1', inverted: false },
            // issue #49: the "Bookmark this page with vBookmarks" PAGE
            // context-menu entry is v4-only; its own switch (default on) lets
            // users drop it without losing the in-popup quick-add star.
            { id: 'quick-add-context-menu', key: 'quickAddContextMenu', defaultValue: '1', inverted: false },
            { id: 'show-tool-button', key: 'showToolButton', defaultValue: '1', inverted: false },
            { id: 'search-history-enabled', key: 'searchHistoryEnabled', defaultValue: '1', inverted: false },
            // v4 task-2 slice D (§5.4/§7): master switch for visit stats —
            // off means zero writes (collection stops immediately)
            { id: 'stats-enabled', key: 'statsEnabled', defaultValue: '1', inverted: false }
        ];
        for (const setting of viewSettings) {
            const element = $(setting.id);
            const value = await getSetting(setting.key, setting.defaultValue);
            element.checked = setting.inverted ? !value : !!value;
            element.addEventListener('change', async () => {
                const newValue = setting.inverted ? (element.checked ? '' : '1') : (element.checked ? '1' : '');
                await setSetting(setting.key, newValue);
            });
        }
        // Turning search history off also wipes the stored history (the hint
        // under the checkbox tells the user so).
        $('search-history-enabled').addEventListener('change', async () => {
            if (!$('search-history-enabled').checked)
                await setSetting('searchHistory', '[]');
        });
        // v4 task-3 #20: one click back to the classic v3 chrome — palette,
        // quick-add star, tool button and view tabs all off. Each switch
        // above re-enables its feature individually.
        $('classic-experience').addEventListener('click', async () => {
            // The classic v3 chrome turns off every v4-only extra: command
            // palette, quick-add star, its page right-click menu entry (issue
            // #49), the tool button and the view tabs.
            const classic = [
                ['paletteEnabled', 'palette-enabled'],
                ['quickAddEnabled', 'quick-add-enabled'],
                ['quickAddContextMenu', 'quick-add-context-menu'],
                ['showToolButton', 'show-tool-button'],
                ['showViewTabs', 'show-view-tabs']
            ];
            for (const [key, id] of classic) {
                await setSetting(key, '');
                $(id).checked = false;
            }
        });
        // Recent-view size: fixed choices keep the list useful but bounded.
        const recentCount = $('recent-count');
        recentCount.value = await getSetting('recentCount', '20');
        recentCount.addEventListener('change', () => setSetting('recentCount', recentCount.value));

        // v4 task-2 (§5.5b/§7): dead-link scan proxy template — empty means
        // direct probing only. Free-text input, stored verbatim; view-dead
        // validates the {url} placeholder when a scan starts.
        const deadProxy = $('dead-proxy-template');
        deadProxy.value = await getSetting('deadProxyTemplate', '');
        deadProxy.addEventListener('change', () => setSetting('deadProxyTemplate', deadProxy.value.trim()));

        // The user's own proxy server for the scan's second channel
        // (dead-proxy.js). Adding/testing lives in the dead-links view — it
        // needs a click gesture for the optional `proxy` permission prompt
        // and the reachability probe — so this row is display + clear,
        // keeping the saved config visible from options as well.
        const deadProxyServerValue = $('dead-proxy-server-value');
        const deadProxyServerClear = $('dead-proxy-server-clear');
        const refreshDeadProxyServer = async () => {
            const value = await getSetting('deadProxyServer', '');
            deadProxyServerValue.textContent = value || _m('deadProxyNone');
            deadProxyServerClear.disabled = !value;
        };
        refreshDeadProxyServer();
        deadProxyServerClear.addEventListener('click', async () => {
            await removeSetting('deadProxyServer');
            refreshDeadProxyServer();
        });

        // v4 task-2 slice D (§5.4): the options-page twin of the stats
        // view's clear button — local behavior data needs a one-click
        // erasure exit paired with the statsEnabled switch. The popup's
        // ConfirmDialog doesn't exist here, so a native confirm() gates.
        $('stats-clear').addEventListener('click', async () => {
            let count = 0;
            try {
                count = Object.keys(JSON.parse(await getSetting('visitStats', '{}') || '{}')).length;
            } catch (e) { /* a corrupted blob reads as empty */ }
            if (!count)
                return;
            if (confirm(_m('statsClearConfirm', `${count}`)))
                await setSetting('visitStats', '{}');
        });

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
        // Event-driven instead of a 1s poll: one initial read, then mirror
        // external writes (advanced-options reset, another options tab).
        // Skip while the input is focused so own-typing is never clobbered
        // by the echo of the user's own keystroke writes.
        zoom.value = await getSetting('zoom', 100);
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && 'zoom' in changes && document.activeElement !== zoom) {
                zoom.value = changes.zoom.newValue ?? 100;
            }
        });
        zoom.addEventListener('input', async () => {
            const val = parseInt(zoom.value);
            if (val === 100) {
                await removeSetting('zoom');
            } else {
                await setSetting('zoom', val);
            }
        });

        // Settings backup (fourth-round item 12). Export packs the full
        // chrome.storage.local area plus the sync-area preference keys
        // (store.syncKeys, defined in store.js) into one JSON file stamped
        // with app/version for import validation.
        const importFile = $('import-settings-file');
        $('export-settings').addEventListener('click', async () => {
            const [localData, syncData] = await Promise.all([
                chrome.storage.local.get(null),
                chrome.storage.sync.get(store.syncKeys)
            ]);
            const backup = {
                app: 'vBookmarks',
                version: chrome.runtime.getManifest().version,
                exportedAt: new Date().toISOString(),
                local: localData,
                sync: syncData
            };
            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `vbookmarks-settings-${backup.exportedAt.slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
        });
        // The real file picker stays hidden; the visible button forwards to it
        $('import-settings').addEventListener('click', () => importFile.click());
        importFile.addEventListener('change', async () => {
            const file = importFile.files && importFile.files[0];
            // reset so picking the same file again re-fires 'change'
            importFile.value = '';
            if (!file)
                return;
            let backup = null;
            try {
                backup = JSON.parse(await file.text());
            } catch (e) { /* falls through to the invalid-file alert */ }
            const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
            if (!isObject(backup) || backup.app !== 'vBookmarks' || !isObject(backup.local)
                || (backup.sync !== undefined && !isObject(backup.sync))) {
                alert(_m('settingsImportInvalid'));
                return;
            }
            if (!confirm(_m('settingsImportConfirm')))
                return;
            // Import semantics: merge, don't wipe — keys present in the
            // backup overwrite the current values, keys it doesn't mention
            // are left untouched, so restoring an older/partial backup never
            // silently deletes settings added since. No storage clear.
            await chrome.storage.local.set(backup.local);
            if (backup.sync)
                await chrome.storage.sync.set(backup.sync);
            alert(_m('settingsImportDone'));
            location.reload();
        });

        // --- Advanced sections, merged from advanced-options (v4 task-3 #17) --
        // These read the store mirror synchronously — wait for the hydration.
        await store.ready;

        // Custom toolbar icon: a picked image is drawn onto a 19×19 canvas
        // and stored as raw ImageData; the default button restores the asset.
        const customIconPreview = $('custom-icon-preview').firstElementChild;
        const iconCanvas = document.createElement('canvas');
        if (customIconPreview && iconCanvas.getContext) {
            iconCanvas.width = iconCanvas.height = 19;
            const ictx = iconCanvas.getContext('2d');
            let dontLoad = true;
            customIconPreview.onload = () => {
                if (dontLoad) {
                    dontLoad = false;
                    return;
                }
                ictx.clearRect(0, 0, 19, 19);
                ictx.drawImage(customIconPreview, 0, 0, 19, 19);
                const imageData = ictx.getImageData(0, 0, 19, 19);
                chrome.action.setIcon({
                    imageData: imageData
                });
                store.set('customIcon', JSON.stringify(imageData.data));
            };
            if (store.get('customIcon')) {
                const customIcon = JSON.parse(store.get('customIcon'));
                const imageData = ictx.getImageData(0, 0, 19, 19);
                for (const key in customIcon) imageData.data[key] = customIcon[key];
                ictx.putImageData(imageData, 0, 0);
                customIconPreview.src = iconCanvas.toDataURL();
            }
            $('custom-icon-file').addEventListener('change', function () {
                const files = this.files;
                if (files && files.length) {
                    const file = files[0];
                    if (/image\/[a-z]+/i.test(file.type)) {
                        const reader = new FileReader();
                        reader.onload = e => {
                            customIconPreview.src = e.target.result;
                        };
                        reader.readAsDataURL(file);
                    } else {
                        alert('Not an image. Try another one.');
                    }
                }
            });
            $('default-icon-button').addEventListener('click', () => {
                store.remove('customIcon');
                chrome.action.setIcon({
                    path: 'assets/icons/icon.png'
                });
                dontLoad = true;
                // The preview <img> can show the vector master; setIcon itself
                // still needs the PNG above (Chrome rejects SVG action icons).
                customIconPreview.src = '/assets/icons/icon.svg';
            });
        }

        // Separators & user styles. Values sit in the inputs without being
        // stored until the user actually edits them (fallbacks shown only).
        const bindText = (id, key, fallback) => {
            const input = $(id);
            input.value = store.get(key) || fallback || '';
            input.addEventListener('change', () => store.set(key, input.value));
        };
        bindText('custom-separator-color', 'separatorcolor');
        bindText('custom-separator-title', 'separatorTitle', '|');
        bindText('custom-separator-url', 'separatorURL', 'http://separatethis.com/');
        bindText('custom-separator-string', 'separatorString', 'separatethis.com;');

        const textareaUserstyle = $('userstyle');
        if (store.get('userstyle')) textareaUserstyle.value = store.get('userstyle');
        if (window.CodeMirror) {
            window.CodeMirror.fromTextArea(textareaUserstyle, {
                onChange: c => {
                    store.set('userstyle', c.getValue());
                }
            });
        }

        // Dead-link scan tuning, clamped to the ranges the scanner supports
        // (view-dead re-clamps defensively when reading them).
        const bindClampedNumber = (id, key, def, min, max) => {
            const input = $(id);
            const raw = parseInt(store.get(key, String(def)), 10);
            input.value = Math.min(max, Math.max(min, isNaN(raw) ? def : raw));
            input.addEventListener('change', () => {
                let val = parseInt(input.value, 10);
                if (isNaN(val)) val = def;
                val = Math.min(max, Math.max(min, val));
                input.value = val;
                store.set(key, String(val));
            });
        };
        bindClampedNumber('dead-scan-concurrency', 'deadScanConcurrency', 4, 1, 16);
        bindClampedNumber('dead-scan-timeout', 'deadScanTimeout', 8, 2, 30);

        $('reset-button').addEventListener('click', () => {
            store.clearAll().then(() => {
                alert('vBookmarks has been reset.');
                location.reload();
            });
        }, false);

        window.onerror = function () {
            chrome.runtime.sendMessage({
                error: [].slice.call(arguments)
            });
        };

        // Set labels
        document.getElementById('ext-name').innerText = __m('extName');
        document.getElementById('small-options').innerText = __m('options');
        document.getElementById('general').innerText = __m('general');
        document.getElementById('option-click-new-tab').innerText = __m('optionClickNewTab');
        document.getElementById('option-open-new-tab-bg').innerText = __m('optionOpenNewTab');
        document.getElementById('option-close-unused-folders').innerText = __m('optionCloseUnusedFolders');
        document.getElementById('option-popup-stay-open').innerText = __m('optionPopupStays');
        document.getElementById('option-confirm-open-folder').innerText = __m('optionConfirmOpenFolder');
        document.getElementById('option-confirm-delete-folder').innerText = __m('optionConfirmDeleteFolder');
        document.getElementById('option-remember-prev-state').innerText = __m('optionRememberPrevState');
        document.getElementById('option-only-show-bmbar').innerText = __m('optionOnlyShowBookmarkBar');
        document.getElementById('option-search-after-enter').innerText = __m('optionSearchAfterEnter');
        document.getElementById('option-auto-resize-popup').innerText = __m('optionAutoResizePopup');
        document.getElementById('option-open-in-side-panel').innerText = __m('optionOpenInSidePanel');
        // Views group (v4 task-2)
        document.getElementById('views-options').innerText = __m('optionsGroupViews');
        document.getElementById('option-show-view-tabs').innerText = __m('optionShowViewTabs');
        document.getElementById('option-remember-view').innerText = __m('optionRememberView');
        document.getElementById('option-show-tab-badges').innerText = __m('optionShowTabBadges');
        document.getElementById('option-show-item-path').innerText = __m('optionShowItemPath');
        document.getElementById('option-show-recent-bookmarks').innerText = __m('optionShowRecentBookmarks');
        document.getElementById('option-show-stats-view').innerText = __m('optionShowStatsView');
        document.getElementById('option-show-dead-view').innerText = __m('optionShowDeadView');
        document.getElementById('option-show-dupes-view').innerText = __m('optionShowDupesView');
        document.getElementById('option-palette-enabled').innerText = __m('optionPaletteEnabled');
        document.getElementById('option-quick-add-enabled').innerText = __m('optionQuickAddEnabled');
        // issue #49: the page right-click "Bookmark this page" entry toggle
        document.getElementById('option-quick-add-context-menu').innerText = __m('optionQuickAddContextMenu');
        document.getElementById('option-quick-add-context-menu-hint').innerText = __m('optionQuickAddContextMenuHint');
        document.getElementById('option-show-tool-button').innerText = __m('optionShowToolButton');
        document.getElementById('classic-experience').innerText = __m('optionClassicExperience');
        document.getElementById('classic-experience-hint').innerText = __m('optionClassicExperienceHint');
        document.getElementById('option-recent-count').innerText = __m('optionRecentCount');
        document.getElementById('option-search-history').innerText = __m('optionSearchHistory');
        document.getElementById('option-search-history-hint').innerText = __m('optionSearchHistoryHint');
        document.getElementById('option-stats-enabled').innerText = __m('optionStatsEnabled');
        document.getElementById('stats-clear').innerText = __m('statsClearData');
        document.getElementById('option-dead-proxy').innerText = __m('optionDeadProxy');
        document.getElementById('dead-proxy-hint').innerText = __m('deadProxyHint');
        document.getElementById('option-dead-proxy-server').innerText = __m('optionDeadProxyServer');
        document.getElementById('dead-proxy-server-clear').innerText = __m('deadProxyClear');
        document.getElementById('dead-proxy-server-hint').innerText = __m('deadProxyServerHint');
        document.getElementById('option-theme').innerText = __m('optionTheme');
        document.getElementById('option-theme-auto').innerText = __m('optionThemeAuto');
        document.getElementById('option-theme-light').innerText = __m('optionThemeLight');
        document.getElementById('option-theme-dark').innerText = __m('optionThemeDark');
        document.getElementById('option-theme-ink').innerText = __m('optionThemeInk');
        document.getElementById('option-theme-paper').innerText = __m('optionThemePaper');
        document.getElementById('accessibility').innerText = __m('accessibility');
        document.getElementById('option-zoom').innerText = __m('optionZoom');
        // Backup group (settings export/import)
        document.getElementById('backup-options').innerText = __m('optionsGroupBackup');
        document.getElementById('export-settings').innerText = __m('settingsExport');
        document.getElementById('import-settings').innerText = __m('settingsImport');
        document.getElementById('backup-hint').innerText = __m('settingsBackupHint');
        // Advanced sections merged from advanced-options (v4 task-3 #17)
        document.getElementById('custom-icon').innerText = __m('customIcon');
        document.getElementById('custom-icon-description').innerText = __m('customIconDescription');
        document.getElementById('default-icon-button').innerText = __m('defaultIconButton');
        document.getElementById('default-icon-button-or').innerText = __m('defaultIconButtonOr');
        document.getElementById('custom-styles').innerText = __m('customStyles');
        document.getElementById('separator-options').innerText = __m('separatorOptions');
        document.getElementById('custom-separator-color-description').innerText = __m('customSeparatorColorDescription');
        document.getElementById('custom-separator-title-description').innerText = __m('customSeparatorTitleDescription');
        document.getElementById('custom-separator-url-description').innerText = __m('customSeparatorUrlDescription');
        document.getElementById('custom-separator-string-description').innerText = __m('customSeparatorStringDescription');
        document.getElementById('custom-styles-description').innerText = __m('customStylesDescription');
        document.getElementById('dead-scan-options').innerText = __m('viewDead');
        document.getElementById('option-dead-scan-concurrency').innerText = __m('optionDeadScanConcurrency');
        document.getElementById('option-dead-scan-timeout').innerText = __m('optionDeadScanTimeout');
        document.getElementById('reset-settings-description').innerText = __m('resetSettingsDescription');
        document.getElementById('reset-button').innerText = __m('resetButton');

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