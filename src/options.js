const $ = id => document.getElementById(id);

(window => {
    const document = window.document;
    const chrome = window.chrome;
    const _m = chrome.i18n.getMessage;
    const __m = _m;

    async function initOptions() {
        document.title = `${_m('extName')} ${_m('options')}`;

        // Toggle → boolean. Storage uses '1'/'true'/'' (and '0' as a fresh
        // default fallback for collapseTabGroupMenu), so a bare !!value would
        // read the string '0' as truthy and mis-tick the checkbox.
        const toBool = value => value === true || value === '1' || value === 'true';

        // Bind a data-driven settings list to its checkboxes. Local toggles
        // persist '1'/'' (or ''/'1' when inverted); sync toggles persist
        // 'true'/'false'. Both read back through getSetting/setSetting.
        const bindSettingsList = async (list, useSync = false) => {
            for (const setting of list) {
                const element = $(setting.id);
                if (!element)
                    continue;
                const value = await getSetting(setting.key, setting.defaultValue, useSync);
                element.checked = useSync
                    ? (value !== 'false' && value !== false)
                    : (setting.inverted ? !toBool(value) : toBool(value));
                element.addEventListener('change', async () => {
                    const newValue = useSync
                        ? (element.checked ? 'true' : 'false')
                        : (setting.inverted ? (element.checked ? '' : '1') : (element.checked ? '1' : ''));
                    await setSetting(setting.key, newValue, useSync);
                });
            }
        };

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
            // chrome.storage.local is the single source of truth — store.js
            // overlays its mirror with it, so a localStorage copy is redundant.
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
            { id: 'open-in-side-panel', key: 'openInSidePanel', defaultValue: '', inverted: false },
            // 4.0.8: remote announcements (docs/announce.json) — on by default;
            // off disables the banner AND its network fetch (privacy switch)
            { id: 'announce-enabled', key: 'announceEnabled', defaultValue: '1', inverted: false }
        ];

        // Initialize general settings
        await bindSettingsList(generalSettings);

        // Configuration for sync settings
        const syncSettings = [
            { id: 'show-sync-status', key: 'showSyncStatus', defaultValue: 'true', inverted: false },
            { id: 'highlight-unsynced', key: 'highlightUnsynced', defaultValue: 'true', inverted: false },
            { id: 'auto-refresh-sync', key: 'autoRefreshSync', defaultValue: 'true', inverted: false }
        ];

        // v4 task-2: the "Views" group (docs/plan-4.0.0/v4task-2.md §7). Tab
        // strip, list-row path labels, the recent tab — all on by default.
        // 4.0.8 split the one overstuffed group into five (views / icons /
        // context menu / tools / stats), mirroring how the dead-link feature
        // keeps behavior (dead scan) separate from display (show-dead-view).
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
            { id: 'show-tab-groups-view', key: 'showTabGroupsView', defaultValue: '1', inverted: false },
            { id: 'show-stats-view', key: 'showStatsView', defaultValue: '1', inverted: false },
            { id: 'show-dead-view', key: 'showDeadView', defaultValue: '1', inverted: false },
            { id: 'show-dupes-view', key: 'showDupesView', defaultValue: '1', inverted: false }
        ];
        // Icons: favicon contrast service + favicon enrichment (4.0.8, docs/
        // favicon-补全设计.md) — the per-site icon pipeline, one group.
        const iconsSettings = [
            // favicon 反色服务（4.0.5 起）：亮/暗主题下偏白/偏黑的单色 icon
            // 反色，默认开启。每个 icon 只在加载时采样一次，零滚动开销。
            { id: 'favicon-contrast', key: 'faviconContrast', defaultValue: '1', inverted: false },
            // favicon 补全（4.0.8）：为 Chrome 未缓存图标的收藏站点拉取真实
            // 图标，默认开启；聚合兜底同样默认开（第三方服务，为直连抓不到的
            // 站点兜底）。
            { id: 'favicon-enrich', key: 'faviconEnrich', defaultValue: '1', inverted: false },
            { id: 'favicon-enrich-ddg', key: 'faviconEnrichAgg', defaultValue: '1', inverted: false },
            // 备份包含补全的图标缓存（vbmFavicon:* + 索引）：默认开，导出/导入
            // 携带这份 per-site 数据；关闭可保持备份精简、图标自动重新抓取。
            { id: 'favicon-backup', key: 'faviconBackupInclude', defaultValue: '1', inverted: false }
        ];
        // Context menus: the page right-click entry + the collapsed submenu
        // switches (issue #48 follow-up).
        const contextMenuSettings = [
            // issue #49: the "Bookmark this page with vBookmarks" PAGE
            // context-menu entry is v4-only; its own switch (default on) lets
            // users drop it without losing the in-popup quick-add star.
            { id: 'quick-add-context-menu', key: 'quickAddContextMenu', defaultValue: '1', inverted: false },
            // issue #48 follow-up: collapse the tab-group / sort blocks into
            // single submenu entries (tab-group default off, sort default on).
            { id: 'collapse-tab-group-menu', key: 'collapseTabGroupMenu', defaultValue: '0', inverted: false },
            { id: 'collapse-sort-menu', key: 'collapseSortMenu', defaultValue: '1', inverted: false }
        ];
        // Tools: the v4 chrome — palette, quick-add star, tool button and the
        // one-click classic-experience preset (v4 task-3 #20).
        const toolsSettings = [
            { id: 'palette-enabled', key: 'paletteEnabled', defaultValue: '1', inverted: false },
            { id: 'quick-add-enabled', key: 'quickAddEnabled', defaultValue: '1', inverted: false },
            { id: 'show-tool-button', key: 'showToolButton', defaultValue: '1', inverted: false }
        ];
        // Statistics: the visit-stats master switch + search history (the two
        // data-collection surfaces stay side by side, like dead scan).
        const statsSettings = [
            // v4 task-2 slice D (§5.4/§7): master switch for visit stats —
            // off means zero writes (collection stops immediately)
            { id: 'stats-enabled', key: 'statsEnabled', defaultValue: '1', inverted: false },
            { id: 'search-history-enabled', key: 'searchHistoryEnabled', defaultValue: '1', inverted: false }
        ];
        await bindSettingsList(viewSettings);
        await bindSettingsList(iconsSettings);
        await bindSettingsList(contextMenuSettings);
        await bindSettingsList(toolsSettings);
        await bindSettingsList(statsSettings);
        // 4.0.8: the enable/disable control for the four feature views.
        // Disabled = the view's show option is greyed out and the view is
        // treated as hidden by the popup (no tab, no shortcut, no palette
        // entry). Tree and Search are always preserved, so no min-tab guard
        // is needed here.
        const FEATURE_VIEW_OPTIONS = [
            { showId: 'show-recent-bookmarks', disableKey: 'disableRecentView', stateId: 'recent-view-state', toggleId: 'recent-view-toggle' },
            { showId: 'show-tab-groups-view', disableKey: 'disableTabGroupsView', stateId: 'tabgroups-view-state', toggleId: 'tabgroups-view-toggle' },
            { showId: 'show-stats-view', disableKey: 'disableStatsView', stateId: 'stats-view-state', toggleId: 'stats-view-toggle' },
            { showId: 'show-dead-view', disableKey: 'disableDeadView', stateId: 'dead-view-state', toggleId: 'dead-view-toggle' },
            { showId: 'show-dupes-view', disableKey: 'disableDupesView', stateId: 'dupes-view-state', toggleId: 'dupes-view-toggle' }
        ];
        const disabledFlags = {};
        const isViewDisabled = async disableKey => {
            if (!(disableKey in disabledFlags))
                disabledFlags[disableKey] = toBool(await getSetting(disableKey, ''));
            return disabledFlags[disableKey];
        };
        const refreshViewOptionStates = async () => {
            for (const key of Object.keys(disabledFlags))
                delete disabledFlags[key];
            for (const opt of FEATURE_VIEW_OPTIONS) {
                const disabled = await isViewDisabled(opt.disableKey);
                const box = $(opt.showId);
                const state = $(opt.stateId);
                const toggle = $(opt.toggleId);
                if (box)
                    box.disabled = disabled; // the show option follows the enable/disable state
                if (state)
                    state.textContent = __m(disabled ? 'viewStateDisabled' : 'viewStateEnabled');
                if (toggle)
                    toggle.textContent = __m(disabled ? 'viewEnable' : 'viewDisable');
            }
        };
        for (const opt of FEATURE_VIEW_OPTIONS) {
            $(opt.toggleId).addEventListener('click', async () => {
                const disabled = await isViewDisabled(opt.disableKey);
                await setSetting(opt.disableKey, disabled ? '' : '1');
                delete disabledFlags[opt.disableKey];
                await refreshViewOptionStates();
            });
        }
        await refreshViewOptionStates();
        // favicon enrich (4.0.8): the aggregate-fallback sub-switch only makes
        // sense while the master is on — grey it out when the master is off
        // (visual demotion, no ambiguous "child on, parent off" state).
        // Applied on change and once at init.
        const syncDdgDisabled = () => {
            $('favicon-enrich-ddg').disabled = !$('favicon-enrich').checked;
        };
        $('favicon-enrich').addEventListener('change', syncDdgDisabled);
        syncDdgDisabled();
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
        // Tab-groups view: closed tab/group history depth.
        const tabGroupsClosedLimit = $('tabgroups-closed-limit');
        tabGroupsClosedLimit.value = await getSetting('tabGroupsClosedLimit', '10');
        tabGroupsClosedLimit.addEventListener('change', () => setSetting('tabGroupsClosedLimit', tabGroupsClosedLimit.value));

        // Tab-groups view: how a group's color is drawn — off (color dot
        // only), edge band, or connector line. The legacy boolean
        // tabGroupsColorBorder is read once as 'edge' so an existing profile
        // opens the options page on the style it is actually using.
        const tabGroupsColorStyle = $('tabgroups-color-style');
        const storedColorStyle = await getSetting('tabGroupsColorStyle', '');
        const legacyColorBorder = await getSetting('tabGroupsColorBorder', '');
        tabGroupsColorStyle.value = ['off', 'edge', 'line'].indexOf(storedColorStyle) !== -1
            ? storedColorStyle
            : (legacyColorBorder ? 'edge' : 'off');
        tabGroupsColorStyle.addEventListener('change', () => {
            setSetting('tabGroupsColorStyle', tabGroupsColorStyle.value);
            // Keep the retired boolean in step so a downgrade (or any reader
            // that still checks it) sees the same on/off intent.
            setSetting('tabGroupsColorBorder', tabGroupsColorStyle.value === 'edge' ? '1' : '');
        });

        // Issue #33: folder-sort options — the same sortOptions key the popup
        // sort dialog reads/writes, so the options page is a persistent editor
        // for "default/last-used sort prefs" with a single source of truth.
        // Parsing is shared via sort-utils.js (loaded by options.html) —
        // corrupted JSON falls back to the defaults there.
        const readSort = async () =>
            window.VBMSort.parseSortOptions(await getSetting('sortOptions', ''));
        const saveSort = async () => {
            await setSetting('sortOptions', JSON.stringify({
                by: $('sort-options-date').checked ? 'dateAdded' : 'title',
                foldersFirst: $('sort-options-folders-first').checked,
                recursive: $('sort-options-recursive').checked
            }));
        };
        const sortState = await readSort();
        $('sort-options-title').checked = sortState.by !== 'dateAdded';
        $('sort-options-date').checked = sortState.by === 'dateAdded';
        $('sort-options-folders-first').checked = sortState.foldersFirst !== false;
        $('sort-options-recursive').checked = sortState.recursive === true;
        for (const id of ['sort-options-title', 'sort-options-date',
            'sort-options-folders-first', 'sort-options-recursive'])
            $(id).addEventListener('change', saveSort);

        // The dead-link proxy server row (add/test/save + display + clear)
        // is owned by src/options-proxy.js — a module importing dead-proxy.js.

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

        // Clear the favicon cache (per-host data keys + the index). The open
        // popup/panel hears the index removal via storage.onChanged and drops
        // its in-memory map; next render re-fetches (docs/favicon-补全设计.md
        // §5.4).
        // The storage-usage bar (below the button) refreshes after a clear so
        // the freed space is immediately visible, and tracks icon fetches
        // live while the page is open (chrome.storage.onChanged below).
        const isFavKey = k => k === 'vbmFaviconIdx' || k.startsWith('vbmFavicon:');
        // Bookmark-derived local data: scan cache / live journal / dead marks
        // and their timestamps / visit stats. The bookmark tree itself lives
        // in Chrome's bookmarks store, not in storage.local — the bar label
        // says "scan/mark data" to match (audit O4).
        const isBookmarkDataKey = k => k === 'deadLastScan' || k === 'vbmDeadScan'
            || k === 'deadMarks' || k === 'deadMarkTimes' || k === 'visitStats';
        const storageUsageCats = [
            { id: 'icon', label: () => __m('storageUsageIcon') },
            { id: 'bookmarks', label: () => __m('storageUsageBookmarks') },
            { id: 'other', label: () => __m('storageUsageOther') },
            { id: 'free', label: () => __m('storageUsageFree') }
        ];
        const fmtBytes = n => {
            if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
            if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
            return n + ' B';
        };
        // Real byte accounting: chrome.storage.local.getBytesInUse reports the
        // serialized footprint Chrome actually bills (data keys included), not
        // JSON.stringify(value).length. Fall back to the old approximation for
        // test doubles / unusual builds without the API (audit O9).
        const approxBytes = (keys, all) => {
            let n = 0;
            for (const k of keys)
                n += JSON.stringify(all[k]).length;
            return n;
        };
        const measureUsage = async all => {
            const favKeys = Object.keys(all).filter(isFavKey);
            const bookmarkKeys = Object.keys(all).filter(isBookmarkDataKey);
            const otherKeys = Object.keys(all).filter(k => !isFavKey(k) && !isBookmarkDataKey(k));
            const rawGbiu = chrome.storage.local.getBytesInUse;
            if (typeof rawGbiu === 'function') {
                const gbiu = rawGbiu.bind(chrome.storage.local);
                try {
                    const [icon, bookmarks, other] = await Promise.all([
                        favKeys.length ? gbiu(favKeys) : Promise.resolve(0),
                        bookmarkKeys.length ? gbiu(bookmarkKeys) : Promise.resolve(0),
                        otherKeys.length ? gbiu(otherKeys) : Promise.resolve(0)
                    ]);
                    return { icon: icon || 0, bookmarks: bookmarks || 0, other: other || 0 };
                } catch (_) { /* fall through to the approximation */ }
            }
            return {
                icon: approxBytes(favKeys, all),
                bookmarks: approxBytes(bookmarkKeys, all),
                other: approxBytes(otherKeys, all)
            };
        };
        const refreshStorageUsage = async () => {
            const all = await chrome.storage.local.get(null);
            const { icon, bookmarks, other } = await measureUsage(all);
            const used = icon + bookmarks + other;
            const quota = chrome.storage.local.QUOTA_BYTES || 10 * 1024 * 1024;
            const free = Math.max(0, quota - used);
            const pct = n => (quota ? Math.round((n / quota) * 1000) / 10 : 0);
            const sizes = { icon, bookmarks, other, free };
            // Segments: width + per-segment accessible label + tooltip data.
            // The tooltip reads _usageText/_usagePct off the segment, so the
            // handlers (wired once below) always show the current figures.
            for (const c of storageUsageCats) {
                const el = document.getElementById('usage-' + c.id);
                if (!el) continue;
                const text = `${c.label()} ${fmtBytes(sizes[c.id])}`;
                el.style.width = pct(sizes[c.id]) + '%';
                el.setAttribute('aria-label', text);
                el.setAttribute('title', text);
                el._usageText = text;
                el._usagePct = pct(sizes[c.id]);
            }
            // Legend: one item per category with a color swatch matching the
            // segment (the label is i18n text, escaped for the innerHTML).
            // Each item also carries its share so the bar never needs to be
            // hovered to read a size (chart guidance: don't encode data by
            // color alone).
            const summaryEl = document.getElementById('storage-usage-summary');
            if (summaryEl)
                summaryEl.textContent = __m('storageUsageSummary', [fmtBytes(used), fmtBytes(quota)]);
            const legendEl = document.getElementById('storage-usage-legend');
            if (legendEl) {
                const esc = s => String(s).replace(/[&<>"']/g,
                    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
                legendEl.innerHTML = storageUsageCats.map(c =>
                    `<span class="legend-item" role="listitem">` +
                    `<span class="legend-swatch usage-${c.id}"></span>` +
                    `<span class="legend-label">${esc(c.label())} ${esc(fmtBytes(sizes[c.id]))} (${esc(pct(sizes[c.id]) + '%')})</span>` +
                    `</span>`
                ).join('');
            }
            const bar = document.getElementById('storage-usage-bar');
            if (bar) bar.setAttribute('aria-label',
                storageUsageCats.map(c => `${c.label()} ${fmtBytes(sizes[c.id])}`).join(', '));
        };

        // Segment tooltip: hovering or focusing a segment shows its category,
        // size and share in a small tag floating above the bar. Wired once —
        // the refresh above keeps the figures on the segment current.
        const usageTooltip = () => {
            const li = $('storage-usage');
            const tooltip = $('usage-tooltip');
            if (!li || !tooltip) return;
            const show = seg => {
                if (!seg._usageText) return;
                tooltip.innerText = `${seg._usageText} (${seg._usagePct}%)`;
                tooltip.hidden = false;
                if (typeof seg.getBoundingClientRect !== 'function') return;
                const liRect = li.getBoundingClientRect();
                const segRect = seg.getBoundingClientRect();
                tooltip.style.left = (segRect.left - liRect.left + segRect.width / 2) + 'px';
                tooltip.style.top = (segRect.top - liRect.top - 6) + 'px';
            };
            const hide = () => { tooltip.hidden = true; };
            for (const c of storageUsageCats) {
                const seg = document.getElementById('usage-' + c.id);
                if (!seg) continue;
                seg.addEventListener('mouseenter', () => show(seg));
                seg.addEventListener('mouseleave', hide);
                seg.addEventListener('focus', () => show(seg));
                seg.addEventListener('blur', hide);
            }
        };
        usageTooltip();

        // Live updates: the background keeps fetching icons (vbmFavicon:*
        // writes into storage.local) while the page is open, so re-measure the
        // bar whenever a key that feeds it changes. Debounce the full-area
        // read + stringification — an icon-completion storm while the options
        // page is open could otherwise rescan MB-scale storage on every key
        // (audit O3). The clear-cache handler below bypasses the debounce so
        // freed space shows immediately.
        let usageRefreshTimer = null;
        const scheduleUsageRefresh = () => {
            clearTimeout(usageRefreshTimer);
            usageRefreshTimer = setTimeout(() => {
                usageRefreshTimer = null;
                refreshStorageUsage();
            }, 300);
        };
        const flushUsageRefresh = () => {
            clearTimeout(usageRefreshTimer);
            usageRefreshTimer = null;
            refreshStorageUsage();
        };
        if (chrome.storage.onChanged && chrome.storage.onChanged.addListener) {
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area !== 'local') return;
                const touched = Object.keys(changes || {});
                if (touched.some(k => isFavKey(k) || isBookmarkDataKey(k)))
                    scheduleUsageRefresh();
            });
        }
        $('favicon-cache-clear').addEventListener('click', async () => {
            let all = {};
            try { all = await chrome.storage.local.get(null); } catch (_) { /* noop */ }
            const keys = Object.keys(all).filter(isFavKey);
            if (!keys.length) {
                // Match the clear-stats interaction: always give feedback,
                // including the empty-cache case (audit O5).
                alert(_m('optionFaviconCacheEmpty'));
                return;
            }
            // Destructive actions on this page share one interaction contract:
            // confirm first (the cache re-fetches automatically, so this is
            // lower-stakes than clearing stats, but consistent).
            if (!confirm(_m('optionFaviconCacheClearConfirm')))
                return;
            await chrome.storage.local.remove(keys);
            alert(_m('optionFaviconCacheCleared'));
            flushUsageRefresh();
        });

        // Initialize sync settings. One write per change is enough: the
        // service worker (src/sync-engine.js) observes chrome.storage.sync
        // and reschedules its refresh alarm itself, and the popup mirrors
        // status via storage.session — no page-side direct calls needed.
        await bindSettingsList(syncSettings, true);

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
            // The favicon cache (per-host data keys + the index) is local,
            // MB-scale base64. The Icons group's "include icon cache" switch
            // (default ON) controls whether it ships in a settings backup
            // (docs/favicon-补全设计.md §5.4); turning it off strips the keys
            // to keep the backup small.
            if (!$('favicon-backup').checked) {
                for (const k of Object.keys(localData)) {
                    if (k === 'vbmFaviconIdx' || k.startsWith('vbmFavicon:'))
                        delete localData[k];
                }
            }
            // vbmDeadScan is a live SW journal, not user data: a backup taken
            // mid-scan must not carry it to another machine where
            // resumeIfNeeded would mistake it for a local run (audit D7).
            delete localData.vbmDeadScan;
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
            // Filename advertises the cache decision (audit O7): an
            // icons-included backup can be several MB, and the suffix makes
            // that visible before anyone opens or shares the file.
            const iconSuffix = $('favicon-backup').checked ? '-with-icons' : '-no-icons';
            a.download = `vbookmarks-settings-${backup.exportedAt.slice(0, 10)}${iconSuffix}.json`;
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
            // Favicon cache keys only land when the "include icon cache" switch
            // is on — and even then in a SEPARATE best-effort write, so a quota
            // overflow on MB-scale cache data never fails the settings import
            // (the cache re-fetches on next render, worst case).
            const favKeys = Object.keys(backup.local).filter(k =>
                k === 'vbmFaviconIdx' || k.startsWith('vbmFavicon:'));
            const favObj = {};
            for (const k of favKeys) favObj[k] = backup.local[k];
            for (const k of favKeys) delete backup.local[k];
            // Same live-journal exclusion on the way in, for hand-edited or
            // legacy backups that still contain it (audit D7).
            delete backup.local.vbmDeadScan;
            try {
                await chrome.storage.local.set(backup.local);
                if (backup.sync)
                    await chrome.storage.sync.set(backup.sync);
            } catch (e) {
                // Quota exceeded or a transient storage failure — without this
                // catch the await above would reject, the user would get no
                // feedback, and a later reload would surface half-applied
                // settings with no explanation. Keep the page as-is so the
                // user can retry the import.
                alert(_m('settingsImportError'));
                return;
            }
            if ($('favicon-backup').checked && favKeys.length) {
                // Sanitize before writing: a hand-edited backup could carry
                // non-image payloads or MB-scale blobs under icon keys, which
                // would bypass the enricher's 96KB/budget guards forever.
                // Invalid entries are dropped silently — the cache simply
                // re-fetches those icons on next render. (Limit mirrors
                // MAX_ICON_BYTES in favicon-enrich.js; options.js is a classic
                // script and cannot import the constant.)
                const MAX_IMPORT_ICON_BYTES = 96 * 1024;
                const cleanObj = {};
                for (const k of Object.keys(favObj)) {
                    const v = favObj[k];
                    if (k === 'vbmFaviconIdx') {
                        cleanObj[k] = v; // index self-heals on hydrate
                        continue;
                    }
                    if (typeof v === 'string' && v.length <= MAX_IMPORT_ICON_BYTES
                        && v.slice(0, 11).toLowerCase() === 'data:image/')
                        cleanObj[k] = v;
                }
                try {
                    await chrome.storage.local.set(cleanObj);
                } catch (_) { /* best effort — cache is re-fetchable */ }
            }
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
            // The pick button is the styled stand-in for the (hidden) file
            // input — the engine won't style ::file-selector-button, so the
            // native input can't be made to match the adjacent button.
            $('custom-icon-pick').addEventListener('click', () => {
                $('custom-icon-file').click();
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

        // Custom styles: saved on every edit. CodeMirror (vendored) is the
        // primary input; if it fails to load, fall back to the native
        // textarea's change event so the feature never silently stops
        // persisting (the popup/panel apply side lives in src/userstyle.js).
        const textareaUserstyle = $('userstyle');
        if (store.get('userstyle')) textareaUserstyle.value = store.get('userstyle');
        if (window.CodeMirror) {
            window.CodeMirror.fromTextArea(textareaUserstyle, {
                onChange: c => store.set('userstyle', c.getValue())
            });
        } else {
            textareaUserstyle.addEventListener('change', () => {
                store.set('userstyle', textareaUserstyle.value);
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
        // 4.0.8: remote announcements (docs/announce.json) privacy switch
        document.getElementById('option-announce-enabled').innerText = __m('optionAnnounceEnabled');
        document.getElementById('option-announce-enabled-hint').innerText = __m('optionAnnounceEnabledHint');
        // View groups (4.0.8: the one Views group split into five)
        document.getElementById('views-options').innerText = __m('optionsGroupViews');
        document.getElementById('icons-options').innerText = __m('optionsGroupIcons');
        document.getElementById('context-menu-options').innerText = __m('optionsGroupContextMenu');
        document.getElementById('tools-options').innerText = __m('optionsGroupTools');
        document.getElementById('stats-options').innerText = __m('optionsGroupStats');
        document.getElementById('option-show-view-tabs').innerText = __m('optionShowViewTabs');
        document.getElementById('option-remember-view').innerText = __m('optionRememberView');
        document.getElementById('option-show-tab-badges').innerText = __m('optionShowTabBadges');
        document.getElementById('option-show-item-path').innerText = __m('optionShowItemPath');
        document.getElementById('option-show-recent-bookmarks').innerText = __m('optionShowRecentBookmarks');
        document.getElementById('option-show-tab-groups-view').innerText = __m('optionShowTabGroupsView');
        document.getElementById('option-tabgroups-color-style').innerText = __m('tabGroupsColorStyle');
        document.getElementById('option-tabgroups-color-style-hint').innerText = __m('tabGroupsColorStyleHint');
        document.getElementById('tabgroups-color-style-off').innerText = __m('tabGroupsColorStyleOff');
        document.getElementById('tabgroups-color-style-edge').innerText = __m('tabGroupsColorStyleEdge');
        document.getElementById('tabgroups-color-style-line').innerText = __m('tabGroupsColorStyleLine');
        document.getElementById('option-show-stats-view').innerText = __m('optionShowStatsView');
        document.getElementById('option-show-dead-view').innerText = __m('optionShowDeadView');
        document.getElementById('option-show-dupes-view').innerText = __m('optionShowDupesView');
        document.getElementById('option-palette-enabled').innerText = __m('optionPaletteEnabled');
        document.getElementById('option-quick-add-enabled').innerText = __m('optionQuickAddEnabled');
        // issue #49: the page right-click "Bookmark this page" entry toggle
        document.getElementById('option-quick-add-context-menu').innerText = __m('optionQuickAddContextMenu');
        document.getElementById('option-quick-add-context-menu-hint').innerText = __m('optionQuickAddContextMenuHint');
        // issue #48 follow-up: the collapsed tab-group / sort menu switches
        document.getElementById('option-collapse-tab-group-menu').innerText = __m('optionCollapseTabGroupMenu');
        document.getElementById('option-collapse-tab-group-menu-hint').innerText = __m('optionCollapseTabGroupMenuHint');
        document.getElementById('option-collapse-sort-menu').innerText = __m('optionCollapseSortMenu');
        document.getElementById('option-collapse-sort-menu-hint').innerText = __m('optionCollapseSortMenuHint');
        document.getElementById('option-show-tool-button').innerText = __m('optionShowToolButton');
        document.getElementById('classic-experience').innerText = __m('optionClassicExperience');
        document.getElementById('classic-experience-hint').innerText = __m('optionClassicExperienceHint');
        document.getElementById('option-recent-count').innerText = __m('optionRecentCount');
        document.getElementById('option-tabgroups-closed-limit').innerText = __m('optionTabGroupsClosedLimit');
        document.getElementById('option-search-history').innerText = __m('optionSearchHistory');
        document.getElementById('option-search-history-hint').innerText = __m('optionSearchHistoryHint');
        document.getElementById('option-stats-enabled').innerText = __m('optionStatsEnabled');
        document.getElementById('stats-clear').innerText = __m('statsClearData');
        document.getElementById('option-favicon-contrast').innerText = __m('optionFaviconContrast');
        document.getElementById('option-favicon-contrast-hint').innerText = __m('optionFaviconContrastHint');
        document.getElementById('option-favicon-enrich').innerText = __m('optionFaviconEnrich');
        document.getElementById('option-favicon-enrich-hint').innerText = __m('optionFaviconEnrichHint');
        document.getElementById('option-favicon-enrich-ddg').innerText = __m('optionFaviconEnrichAgg');
        // The provider list is passed as a substitution — changing the list
        // (src/favicon-enrich.js AGG_PROVIDERS) only needs this one line, not
        // a retranslation of every locale string.
        const aggProviderHint = ['favicon.run', 'icon.horse', 'DuckDuckGo'].join(' → ');
        document.getElementById('option-favicon-enrich-ddg-hint').innerText =
            __m('optionFaviconEnrichAggHint', aggProviderHint);
        document.getElementById('option-favicon-backup').innerText = __m('optionFaviconBackup');
        document.getElementById('option-favicon-backup-hint').innerText = __m('optionFaviconBackupHint');
        document.getElementById('favicon-cache-clear').innerText = __m('optionFaviconCacheClear');
        // The dead-link proxy server row (label/buttons/hint/error) is bound
        // by src/options-proxy.js — a module, so it can import dead-proxy.js.
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
        document.getElementById('custom-icon-pick').innerText = __m('customIconPick');
        document.getElementById('custom-styles').innerText = __m('customStyles');
        document.getElementById('separator-options').innerText = __m('separatorOptions');
        document.getElementById('custom-separator-color-description').innerText = __m('customSeparatorColorDescription');
        document.getElementById('custom-separator-title-description').innerText = __m('customSeparatorTitleDescription');
        document.getElementById('custom-separator-url-description').innerText = __m('customSeparatorUrlDescription');
        document.getElementById('custom-separator-string-description').innerText = __m('customSeparatorStringDescription');
        document.getElementById('custom-styles-description').innerText = __m('customStylesDescription');
        // issue #33: the Sorting group reuses the popup sort-dialog labels
        document.getElementById('sort-options').innerText = __m('optionsGroupSort');
        document.getElementById('option-sort-by-title').innerText = __m('sortByTitle');
        document.getElementById('option-sort-by-date').innerText = __m('sortByDateAdded');
        document.getElementById('option-sort-folders-first').innerText = __m('sortFoldersFirst');
        document.getElementById('option-sort-recursive').innerText = __m('sortRecursive');
        document.getElementById('option-sort-recursive-hint').innerText = __m('sortRecursiveWarning');
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
        document.getElementById('storage-usage-hint').innerText = __m('storageUsageHint');
        // Header meta (top-right): donate / GitHub / homepage buttons + the
        // full version, which links to the changelog. Text lives in label spans
        // so the inline SVG icons stay as the leading glyph.
        document.getElementById('header-donate-label').innerText = __m('optionsDonate');
        document.getElementById('header-github-label').innerText = __m('optionsGithubLink');
        document.getElementById('header-homepage-label').innerText = __m('optionsHomepageLink');
        const versionEl = document.getElementById('options-version');
        // Point at docs/README.md explicitly: the repo-root anchor would break
        // the day a top-level README appears (audit O13).
        versionEl.href = 'https://github.com/windviki/vBookmarks/blob/master/docs/README.md#v'
            + chrome.runtime.getManifest().version.replace(/\./g, '');
        versionEl.title = __m('optionsVersion');
        document.getElementById('options-version-text').innerText = 'v' + chrome.runtime.getManifest().version;
        // Subtitle under the title row: since the 1.0 fork from Neat
        // Bookmarks (2011-11-15) the extension has been maintained.
        const sinceEl = document.getElementById('header-since');
        const days = Math.floor((Date.now() - Date.UTC(2011, 10, 15)) / 86400000);
        sinceEl.innerText = __m('optionsSince', [String(days)]);
        // Seed the storage-usage bar once the page is up.
        refreshStorageUsage();
    }

    document.addEventListener('DOMContentLoaded', () => {
        initOptions();
    });
})(window);