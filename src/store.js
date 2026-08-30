/**
 * vBookmarks Store
 * Unified storage entry point for the extension pages (popup / options / advanced options).
 *
 * Design (three parts):
 *
 * 1. Mirror — `store` keeps an in-memory mirror of chrome.storage.local so that
 *    legacy synchronous call sites can read/write settings synchronously.
 *    At script evaluation time the mirror is synchronously pre-filled with the
 *    extension's known keys from localStorage (zero regression for old users),
 *    then asynchronously overlaid with an ENUMERATED key set (KNOWN_KEYS +
 *    SYNC_KEYS + DATA_KEYS + the migration/cleanup keys — see LOCAL_BOOT_KEYS)
 *    from chrome.storage.local, which is the source of truth; the MB-scale
 *    favicon cache and the dead-scan blobs are deliberately not mirrored.
 *    `store.ready` resolves once the overlay and the migration below have
 *    finished; pages must gate their init on it.
 *    A second mirror covers the chrome.storage.sync area (SYNC_KEYS). Access
 *    is AREA-TRANSPARENT since the 2026-08 storage audit: store.get/set/
 *    remove/adopt (and the getSetting/setSetting/removeSetting helpers)
 *    route SYNC_KEYS members to the sync mirror/area automatically, so call
 *    sites never name an area. localStorage doubles as the synchronous boot
 *    cache for sync-routed keys (pre-paint theme, synchronous i18n patch) —
 *    store.set/remove keep those copies fresh; feature code never writes
 *    localStorage directly. getSyncSetting/setSyncSetting remain as explicit
 *    sync-mirror accessors.
 *
 * 2. Migration (idempotent) — gated by the `__migrated_v1` flag in
 *    chrome.storage.local. On first run, every known extension key present in
 *    localStorage but missing from chrome.storage.local is copied over
 *    (chrome.storage values always win). localStorage originals are kept
 *    untouched for at least one major version as a rollback path.
 *
 * 3. Debounced persistence — `store.set()` writes the mirror synchronously and
 *    persists to chrome.storage.local with a per-key 200ms trailing debounce,
 *    so high-frequency writes (scroll position, popup resize) don't hammer the
 *    storage API. All pending writes are flushed on `pagehide`.
 *
 * Values are kept as-is (strings like '1'/''/'true'/'false' per the existing
 * value model); no type conversion happens here.
 *
 * Back-compat async helpers (`getSetting`/`setSetting`/`removeSetting`, used by
 * options.js and popup.js) talk to chrome.storage directly; the area is chosen
 * by SYNC_KEYS membership (the useSync flag still forces sync for back-compat),
 * and writes to sync-routed keys also refresh the sync mirror + boot copy.
 */
(() => {
    const MIGRATION_FLAG = '__migrated_v1';

    // Known extension keys formerly kept in localStorage (enumerated from
    // neat.js and advanced-options.js). Used for the mirror pre-fill and the
    // v1 migration. Note: 'separatorUrl' was the legacy advanced-options
    // spelling; the v2 merge below renames it to the canonical 'separatorURL'
    // (read by separators.js), so both spellings stay listed here.
    const KNOWN_KEYS = [
        // popup state
        'opens', 'popupHeight', 'popupWidth', 'zoom', 'searchQuery', 'scrollTop', 'focusID',
        // unified "where I was" focus spot (view-manager, popup reopen restore)
        'focusSpot',
        // general options
        'leftClickNewTab', 'middleClickBgTab', 'closeUnusedFolders', 'bookmarkClickStayOpen',
        'dontConfirmOpenFolder', 'dontRememberState', 'onlyShowBMBar', 'searchAfterEnter',
        // 4.1.1 分层记忆: the master flag's four sub-layers (master off wins all)
        'rememberScroll', 'rememberOpens', 'rememberHighlight', 'rememberSearchQuery',
        'autoResizePopup',
        // v4 task-2: view layer (slice A)
        'activeView', 'viewState', 'showViewTabs', 'showItemPath', 'reverseItemPath',
        // issue #64: hand the popup's startup focus to the search input
        'focusSearchOnOpen',
        // issue #64: folder rows in search results (reveal-in-tree click)
        'searchShowFolders',
        // per-view tab visibility (feature views + the structural tree/search tabs)
        'showRecentBookmarks', 'showStatsView', 'showDeadView', 'showDupesView', 'showTabGroupsView',
        // 4.0.8: per-view disable switches (feature views only)
        'disableRecentView', 'disableStatsView', 'disableDeadView', 'disableDupesView',
        'disableTabGroupsView',
        // v4 task-3: remember-last-view / tab badges / classic-experience
        // feature switches (items 6, 18, 20)
        'rememberView', 'showTabBadges', 'paletteEnabled', 'quickAddEnabled', 'showToolButton',
        // issue #49: "Bookmark this page with vBookmarks" page right-click
        // menu entry switch (v4-only, covered by the classic-experience preset)
        'quickAddContextMenu',
        // v4 task-2: non-empty folder delete confirmation (slice A2, §5.7)
        'confirmDeleteFolder',
        // v4 task-2: recent view + search history (slice B, §4.3/§5.3)
        'recentCount', 'searchHistory', 'searchHistoryEnabled', 'searchHistoryCount',
        // separators & appearance
        'separators', 'separatorTitle', 'separatorURL', 'separatorUrl', 'separatorString',
        'separatorcolor', 'userstyle', 'userstyles', 'customIcon', 'theme', 'uiLanguage',
        // 4.0.5 favicon 反色服务（默认开启）
        'faviconContrast',
        // 4.0.8 favicon 补全——为 Chrome 未缓存图标的收藏站点拉取真实图标
        'faviconEnrich', 'faviconEnrichAgg',
        // options Icons 组备份开关：导出时是否随包携带 favicon 缓存键
        'faviconBackupInclude',
        // issue #33: folder-sort options JSON {by, foldersFirst, recursive}
        // (shared by the sort dialog and the options page Sorting group)
        'sortOptions',
        // version & donation
        'currentVersion', 'openCount', 'donationKey', 'donationCountDown', 'donationFactor',
        // 2026-08 storage-audit census completion (report task P0-1): the
        // remaining real settings keys that never lived in KNOWN_KEYS. The
        // pre-fill/migration loops below are null-safe for keys localStorage
        // never held, so listing them costs nothing and the census
        // (tests/storage-usage.test.js) now covers every settings key.
        'statsEnabled', 'openInSidePanel', 'quickAddFolderId', 'announceEnabled',
        'collapseTabGroupMenu', 'collapseSortMenu',
        'deadScanConcurrency', 'deadScanTimeout', 'hideDeadProxyStrip', 'deadProxyServer',
        'donationDisabled', 'vbmBtnAlt',
        'statsShowUnbookmarked', 'statsSort', 'statsHistoryBannerDismissed', 'statsHistoryImportedAt',
        'dupesStrategy', 'dupesScope', 'dupesIgnoreScheme',
        'deadSort', 'deadFilter', 'deadMarkFilter',
        // 4.1.0 tab-groups view: display/behavior/count prefs (sync-routed
        // below); tabGroupsColorBorder is the retired boolean kept in step
        // with tabGroupsColorStyle for downgrades.
        'tabGroupsSyncCollapse', 'tabGroupsColorStyle', 'tabGroupsColorBorder', 'tabGroupsClosedLimit',
        // tabGroupsClosed (closed-group records) and tabGroupsViewState (per-
        // device UI collapse state) stay LOCAL like searchHistory/viewState —
        // they describe this device's tabs, not a cross-device preference.
        // tabGroupFolderMeta (tab-group → bookmark-folder title/color meta,
        // written via TAB_GROUP_FOLDER_META_KEY so the census's literal scan
        // can't see it) is likewise local: it is keyed by bookmark folder id.
        'tabGroupsClosed', 'tabGroupsViewState', 'tabGroupFolderMeta',
        // velvet staging feature: the staging workbench dataset (device-local
        // by design — bookmark ids and bulk snapshots) and the folder-picker
        // quick-pick rosters (pin list + LRU recents, both bookmark-id keyed).
        'staging', 'folderPickPins', 'folderPickRecents',
        // move-to-folder shortcut chips (selection bar quick row): bookmark-id
        // keyed like the picker rosters, device-local.
        'stagingShortcuts',
        // staging guide strip's "don't show again" stamp (device-local UI state)
        'stagingGuideDismissed',
        // 'showSyncStatus' historically lived in localStorage (the other sync
        // keys were born in the sync area) — listing it lets the v1 migration
        // hand it to chrome.storage.local, from where the local→sync
        // migration below moves it to its final home.
        'showSyncStatus',
        // 4.1.0 实验室: virtual scrolling for the tab-groups/dupes views
        // (options Labs group; local — a per-device experiment, default off)
        'virtualScrollLab'
    ];

    // Data keys the mirror must serve at boot beyond KNOWN_KEYS (2026-08 perf
    // audit): read synchronously via store.get by feature modules, but they
    // are chrome.storage-native datasets, not settings — they never lived in
    // localStorage, so they stay out of KNOWN_KEYS (which doubles as the
    // localStorage pre-fill/migration list). Enumerated so init() can fetch
    // exactly these; every store.get call site resolves to a static key, so
    // no dynamic family is missed.
    const DATA_KEYS = [
        // dead view: per-bookmark mark sets (JSON, bookmark-id keyed, local)
        'deadMarks', 'deadMarkTimes',
        // visit-stats counters (JSON, bookmark-id keyed, local)
        'visitStats',
        // announcement cache + seen list (remote cache / local bookkeeping)
        'vbmAnnounce', 'vbmAnnounceSeen',
        // dupes view snapshot cache (JSON — the deadLastScan recipe, but the
        // dupes view hydrates synchronously from the mirror at init)
        'dupesLastResult',
        // risk-banner version acks (view-dead / view-dupes)
        'deadRiskAck', 'dupesRiskAck'
    ];

    // Keys that live in chrome.storage.sync (user preferences synced across
    // devices). Value model: toggles as '1'/'' or 'true'/'false' strings per
    // the existing call sites, syncRefreshInterval as a number of seconds.
    // v4 task-4 #6: paletteCustomCommands (JSON array string, ≤100 entries).
    //
    // 2026-08 storage audit (docs/review-4.0.8/storage-usage-report.md §15): every small,
    // device-INDEPENDENT preference moved to the sync area. store.get/set/
    // remove/adopt and the getSetting/setSetting/removeSetting helpers route
    // these keys transparently, so call sites keep their existing API. A
    // one-time local→sync migration runs in init() below.
    //
    // Deliberately NOT here (stay local):
    // - bookmark-id-keyed data (bookmark ids are device-local and unstable
    //   across Chrome sync): quickAddFolderId, separators*, deadMarks*,
    //   visitStats, focusID, staging (bulk url/title snapshots may exceed
    //   the sync size limits anyway), folderPickPins/folderPickRecents;
    // - oversized values: customIcon (~10-14KB serialized > 8KB/item sync
    //   limit), userstyle (unbounded CSS);
    // - device/screen/network state: openInSidePanel, autoResizePopup, zoom,
    //   popup size/scroll/focus/view state, deadProxyServer, deadScan*;
    // - privacy/local data: searchHistory — the recorded queries stay on the
    //   device; their DISPLAY count (searchHistoryCount) is a plain
    //   preference and IS synced below;
    // - remote caches: vbmAnnounce*, vbmGithubMirrors; local bookkeeping:
    //   version/donation counters.
    const SYNC_KEYS = [
        // sync-status preferences (the original four)
        'showSyncStatus', 'highlightUnsynced', 'autoRefreshSync', 'syncRefreshInterval',
        'paletteCustomCommands',
        // appearance
        'theme', 'uiLanguage',
        // general behavior
        'leftClickNewTab', 'middleClickBgTab', 'closeUnusedFolders', 'bookmarkClickStayOpen',
        'dontConfirmOpenFolder', 'confirmDeleteFolder', 'dontRememberState',
        'rememberScroll', 'rememberOpens', 'rememberHighlight', 'rememberSearchQuery',
        'onlyShowBMBar', 'searchAfterEnter', 'announceEnabled',
        // views: tab strip, per-view visibility/disable, badges, path labels
        'showViewTabs', 'rememberView', 'showTabBadges', 'showItemPath',
        'showRecentBookmarks', 'showStatsView', 'showDeadView', 'showDupesView', 'showTabGroupsView',
        'disableRecentView', 'disableStatsView', 'disableDeadView', 'disableDupesView',
        'disableTabGroupsView',
        // feature switches
        // feature switches
        'paletteEnabled', 'quickAddEnabled', 'showToolButton', 'quickAddContextMenu',
        'collapseTabGroupMenu', 'collapseSortMenu', 'collapseAddFolderMenu', 'statsEnabled', 'searchHistoryEnabled',
        // icon handling
        'faviconContrast', 'faviconEnrich', 'faviconEnrichAgg', 'faviconBackupInclude',
        // sort/filter/count preferences
        'recentCount', 'sortOptions', 'searchHistoryCount',
        'dupesStrategy', 'dupesScope', 'dupesIgnoreScheme',
        'deadSort', 'deadFilter', 'deadMarkFilter',
        'statsSort', 'statsShowUnbookmarked',
        // 4.1.0 tab-groups view prefs (device-independent)
        'tabGroupsSyncCollapse', 'tabGroupsColorStyle', 'tabGroupsColorBorder', 'tabGroupsClosedLimit',
        // staging master switch + tree-row hover actions (options
        // 暂存和最近添加 / 书签树 — device-independent preferences)
        'stagingEnabled', 'treeRowActions',
        // issue #64: popup startup focus preference (device-independent)
        'focusSearchOnOpen',
        // issue #64: folder rows in search results (device-independent)
        'searchShowFolders',
        // issue #64: nearest-first row path labels (device-independent)
        'reverseItemPath'
    ];
    const SYNC_KEY_SET = new Set(SYNC_KEYS);
    const isSyncKey = key => SYNC_KEY_SET.has(key);

    const mirror = {};
    const syncMirror = {};

    // 1a. Synchronous pre-fill from localStorage — sync-routed keys pre-fill
    // the SYNC mirror: localStorage doubles as the synchronous boot cache for
    // them (popup.js applies the theme before first paint, i18n-live patches
    // the language synchronously), so their copies are kept fresh by
    // store.set/remove (audit revision 3 — feature code never writes
    // localStorage directly; store.js maintains the copies centrally).
    for (const key of KNOWN_KEYS) {
        const value = localStorage.getItem(key);
        if (value !== null && value !== undefined) {
            (isSyncKey(key) ? syncMirror : mirror)[key] = value;
        }
    }

    // 3. Debounced persistence
    const pendingWrites = {};
    const timers = {};

    const flush = () => {
        const batch = {};
        let hasBatch = false;
        for (const key in pendingWrites) {
            clearTimeout(timers[key]);
            delete timers[key];
            batch[key] = pendingWrites[key];
            delete pendingWrites[key];
            hasBatch = true;
        }
        if (hasBatch) {
            chrome.storage.local.set(batch).catch(() => {});
        }
    };

    const schedulePersist = (key, value) => {
        pendingWrites[key] = value;
        clearTimeout(timers[key]);
        timers[key] = setTimeout(() => {
            const v = pendingWrites[key];
            delete pendingWrites[key];
            delete timers[key];
            chrome.storage.local.set({ [key]: v }).catch(() => {});
        }, 200);
    };

    // Issue #63: scrollTop is the one high-churn "where I was" key whose LAST
    // write must survive a popup close. The scroll listener fires on every
    // scroll event, the 200ms trailing debounce coalesces them, and a popup
    // that closes before the timer fires (pagehide is not guaranteed on every
    // close path — see the flush() note below) loses the final position, so
    // the popup "often" reopens at the top. localStorage is the only
    // synchronous store available, so scrollTop additionally shadows there
    // under a dedicated key no older build ever wrote — the legacy plain
    // `scrollTop` localStorage copy frozen at the v4 migration must never
    // win. init() lets the shadow override the chrome.storage value whenever
    // present: by construction it is at least as fresh on this device.
    const SCROLL_TOP_SHADOW = '__scrollTopLS';
    // 4.1.1: the highlight layer's two carriers get the same treatment. The
    // focusID/focusSpot writes ride the very focusin that precedes a popup
    // close (open a bookmark → window.close ~200ms later) — inside the
    // debounce window, on a close path where pagehide is not guaranteed —
    // so the last "where I was" write could die with the page and the next
    // open showed no highlight (the intermittent "高亮上次的书签不生效").
    // Dedicated shadow keys (no older build ever wrote them); init() lets a
    // present shadow override the chrome.storage copy — at least as fresh by
    // construction, exactly like scrollTop.
    const SHADOWED_WHERE_WAS = { focusID: '__focusIDLS', focusSpot: '__focusSpotLS' };
    const shadowScrollTop = value => {
        try {
            if (value === null || value === undefined)
                localStorage.removeItem(SCROLL_TOP_SHADOW);
            else
                localStorage.setItem(SCROLL_TOP_SHADOW, String(value));
        } catch (e) { /* quota/unavailable — the debounced write still runs */ }
    };
    const shadowWhereWas = (key, value) => {
        try {
            if (value === null || value === undefined)
                localStorage.removeItem(SHADOWED_WHERE_WAS[key]);
            else
                localStorage.setItem(SHADOWED_WHERE_WAS[key], String(value));
        } catch (e) { /* quota/unavailable — the debounced write still runs */ }
    };

    // Sync-area persistence uses a longer debounce: chrome.storage.sync is
    // rate-limited (~120 writes/min, 1800/hour).
    const syncPendingWrites = {};
    const syncTimers = {};

    const flushSync = () => {
        const batch = {};
        let hasBatch = false;
        for (const key in syncPendingWrites) {
            clearTimeout(syncTimers[key]);
            delete syncTimers[key];
            batch[key] = syncPendingWrites[key];
            delete syncPendingWrites[key];
            hasBatch = true;
        }
        if (hasBatch) {
            chrome.storage.sync.set(batch).catch(() => {});
        }
    };

    const scheduleSyncPersist = (key, value) => {
        syncPendingWrites[key] = value;
        clearTimeout(syncTimers[key]);
        syncTimers[key] = setTimeout(() => {
            const v = syncPendingWrites[key];
            delete syncPendingWrites[key];
            delete syncTimers[key];
            chrome.storage.sync.set({ [key]: v }).catch(() => {});
        }, 500);
    };

    const store = {
        // Synchronous read from the mirror (sync-routed keys read the
        // chrome.storage.sync mirror — transparent to call sites)
        get(key, defaultValue) {
            const m = isSyncKey(key) ? syncMirror : mirror;
            return (key in m) ? m[key] : defaultValue;
        },
        // Synchronous mirror write + debounced persistence. Sync-routed keys
        // persist to chrome.storage.sync and refresh the localStorage boot
        // copy (kept for the pre-fill above).
        set(key, value) {
            if (isSyncKey(key)) {
                syncMirror[key] = value;
                try { localStorage.setItem(key, String(value)); } catch (e) { /* quota/full — boot copy is best-effort */ }
                scheduleSyncPersist(key, value);
                return;
            }
            mirror[key] = value;
            if (key === 'scrollTop')
                shadowScrollTop(value);
            else if (key in SHADOWED_WHERE_WAS)
                shadowWhereWas(key, value);
            schedulePersist(key, value);
        },
        // Update the mirror WITHOUT persisting. chrome.storage.onChanged
        // listeners (view-manager, …) use this to keep the in-memory mirror
        // fresh when another page (options) wrote storage — no write-back,
        // no event loop. Sync-routed keys adopt into the sync mirror and
        // refresh the boot copy.
        adopt(key, value) {
            if (isSyncKey(key)) {
                // undefined = the key was removed (onChanged newValue) —
                // delete so store.get falls back to its default again.
                if (value === undefined || value === null) {
                    delete syncMirror[key];
                    localStorage.removeItem(key);
                } else {
                    syncMirror[key] = value;
                    try { localStorage.setItem(key, String(value)); } catch (e) { /* best-effort */ }
                }
                return;
            }
            mirror[key] = value;
            if (key === 'scrollTop')
                shadowScrollTop(value);
            else if (key in SHADOWED_WHERE_WAS)
                shadowWhereWas(key, value);
        },
        // Mirror + persistent removal
        remove(key) {
            if (isSyncKey(key)) {
                delete syncMirror[key];
                if (key in syncPendingWrites) {
                    clearTimeout(syncTimers[key]);
                    delete syncTimers[key];
                    delete syncPendingWrites[key];
                }
                localStorage.removeItem(key);
                chrome.storage.sync.remove(key);
                return;
            }
            delete mirror[key];
            if (key === 'scrollTop')
                shadowScrollTop(null);
            else if (key in SHADOWED_WHERE_WAS)
                shadowWhereWas(key, null);
            if (key in pendingWrites) {
                clearTimeout(timers[key]);
                delete timers[key];
                delete pendingWrites[key];
            }
            chrome.storage.local.remove(key);
        },
        // Synchronous read from the chrome.storage.sync mirror
        getSyncSetting(key, defaultValue) {
            return (key in syncMirror) ? syncMirror[key] : defaultValue;
        },
        // Sync mirror write + debounced persistence to chrome.storage.sync.
        // Also refreshes the localStorage boot copy, same convention as
        // store.set on a sync-routed key.
        setSyncSetting(key, value) {
            syncMirror[key] = value;
            try { localStorage.setItem(key, String(value)); } catch (e) { /* best-effort */ }
            scheduleSyncPersist(key, value);
        },
        // The sync-area key list, exposed so the options page's settings
        // backup exports exactly these keys from chrome.storage.sync
        syncKeys: SYNC_KEYS,
        // The local-area settings key list, exposed read-only for the
        // storage-usage census (tests/storage-usage.test.js): a new
        // KNOWN_KEYS member without a segment decision fails that suite.
        knownKeys: Object.freeze(KNOWN_KEYS.slice()),
        // Force-flush the debounced pending writes NOW (drag-end persistence:
        // popup pagehide is not guaranteed on close, so a width/height drag
        // ending must not rely on it to reach storage).
        flush() {
            flush();
            flushSync();
        },
        // Wipe everything (mirror, chrome.storage.local/sync, localStorage);
        // used by the "reset" button on the advanced options page
        clearAll() {
            for (const key in mirror) {
                delete mirror[key];
            }
            for (const key in syncMirror) {
                delete syncMirror[key];
            }
            for (const key in pendingWrites) {
                clearTimeout(timers[key]);
                delete timers[key];
                delete pendingWrites[key];
            }
            for (const key in syncPendingWrites) {
                clearTimeout(syncTimers[key]);
                delete syncTimers[key];
                delete syncPendingWrites[key];
            }
            localStorage.clear();
            return Promise.all([
                chrome.storage.local.clear(),
                chrome.storage.sync.clear()
            ]);
        }
    };

    let resolveReady;
    store.ready = new Promise(resolve => {
        resolveReady = resolve;
    });

    // The exact local-area keys init() fetches: the mirror catalogs plus the
    // sync catalog (local residue feeds the local→sync migration below) plus
    // the migration flag and the retired deadProxyTemplate key (its cleanup
    // below reads the mirror). Deliberately NEVER null — a full-area get
    // pulls the MB-scale favicon cache (vbmFavicon:<host> data URLs) and the
    // dead-scan blobs (vbmDeadScan/deadLastScan) into memory before first
    // paint; favicon-enrich.js hydrates its own index and view-dead.js reads
    // those blobs directly, so neither needs the mirror.
    const LOCAL_BOOT_KEYS = [...new Set([
        ...KNOWN_KEYS, ...SYNC_KEYS, ...DATA_KEYS, MIGRATION_FLAG, 'deadProxyTemplate'
    ])];

    const init = async () => {
        try {
            const data = await chrome.storage.local.get(LOCAL_BOOT_KEYS);
            // 1b. chrome.storage is the source of truth: overlay onto the mirror
            for (const key in data) {
                mirror[key] = data[key];
            }
            // 2. One-time, idempotent migration of legacy localStorage keys
            if (!data[MIGRATION_FLAG]) {
                const toMigrate = {};
                for (const key of KNOWN_KEYS) {
                    if (!(key in data)) {
                        const value = localStorage.getItem(key);
                        if (value !== null && value !== undefined) {
                            toMigrate[key] = value;
                        }
                    }
                }
                toMigrate[MIGRATION_FLAG] = '1';
                await chrome.storage.local.set(toMigrate);
                for (const key in toMigrate) {
                    mirror[key] = toMigrate[key];
                    // Keep the snapshot current too: the local→sync migration
                    // below reads `data`, so a sync-bound legacy key must be
                    // visible there in THIS load, not only from the next one.
                    data[key] = toMigrate[key];
                }
            }
            // 3. v2 key merge (idempotent, runs on every load): the legacy
            // 'separatorUrl' spelling (advanced-options) is renamed to the
            // canonical 'separatorURL' (read by separators.js). The canonical
            // key always wins; the stale key is removed from every store.
            if (mirror.separatorUrl !== undefined && mirror.separatorUrl !== null) {
                if (mirror.separatorURL === undefined || mirror.separatorURL === null) {
                    mirror.separatorURL = mirror.separatorUrl;
                    await chrome.storage.local.set({ separatorURL: mirror.separatorUrl });
                }
                delete mirror.separatorUrl;
                await chrome.storage.local.remove('separatorUrl');
                localStorage.removeItem('separatorUrl');
            }
            // 4. Retired-key cleanup (idempotent, runs on every load): the v3
            // dead-link relay template setting was replaced by the user's own
            // proxy server (deadProxyServer) in v4 — drop the stale key so it
            // stops riding the options-page settings backup.
            if (mirror.deadProxyTemplate !== undefined && mirror.deadProxyTemplate !== null) {
                delete mirror.deadProxyTemplate;
                await chrome.storage.local.remove('deadProxyTemplate');
                localStorage.removeItem('deadProxyTemplate');
            }
            // 1c. Load the sync area into its own mirror (overlay: the sync
            // area is the source of truth over the localStorage pre-fill)
            try {
                const syncData = await chrome.storage.sync.get(null);
                for (const key in syncData) {
                    syncMirror[key] = syncData[key];
                }
                // 5. local→sync migration for the keys that moved to the sync
                // area (idempotent, runs on every load; supersedes the old
                // showSyncStatus-only migration). The sync area wins when it
                // already holds a value; otherwise the chrome.storage.local
                // value is copied up. Local residue is removed only after a
                // successful sync write — a failed write keeps the local copy
                // so the next load retries. The localStorage boot copy is
                // refreshed to the winning value either way (audit revision 3).
                //
                // NOTE: localStorage is deliberately NOT a migration source.
                // Legacy localStorage-only values already reached
                // chrome.storage.local via the v1 migration above, so a
                // localStorage fallback would only ever resurrect STALE boot
                // copies: a key removed from the sync area (another device,
                // or a page bypassing the store helpers) must stay removed.
                const toSync = {};
                const localRemovals = [];   // safe to drop ONLY after a successful sync write
                const staleRemovals = [];   // sync area already owns the value — always safe
                for (const key of SYNC_KEYS) {
                    if (Object.prototype.hasOwnProperty.call(syncData, key)) {
                        // sync wins; any local residue is stale (it would
                        // otherwise ride backup exports as a dead key).
                        if (Object.prototype.hasOwnProperty.call(data, key))
                            staleRemovals.push(key);
                        continue;
                    }
                    if (Object.prototype.hasOwnProperty.call(data, key)) {
                        toSync[key] = data[key];
                        localRemovals.push(key);
                    }
                }
                for (const key in toSync) {
                    syncMirror[key] = toSync[key];
                }
                if (Object.keys(toSync).length) {
                    try {
                        await chrome.storage.sync.set(toSync);
                        staleRemovals.push(...localRemovals);
                    } catch (error) {
                        console.warn('store: local→sync migration write failed (will retry next load):', error);
                    }
                }
                if (staleRemovals.length) {
                    for (const key of staleRemovals) {
                        delete mirror[key];
                    }
                    await chrome.storage.local.remove(staleRemovals);
                }
                // Boot-copy hygiene FIRST: a sync key that is in NEITHER the
                // sync area NOR the just-migrated set, but sits in the
                // pre-filled syncMirror (i.e. came from the localStorage boot
                // cache), is a STALE copy — the value was removed after the
                // copy was written (another device, or an external removal).
                // Drop it from the mirror and the cache, or the removal would
                // be silently undone on every load.
                for (const key of SYNC_KEYS) {
                    if (Object.prototype.hasOwnProperty.call(syncData, key)
                        || Object.prototype.hasOwnProperty.call(toSync, key))
                        continue;
                    if (Object.prototype.hasOwnProperty.call(syncMirror, key)) {
                        delete syncMirror[key];
                        localStorage.removeItem(key);
                    }
                }
                // Then refresh the boot copies to the winning values.
                for (const key of SYNC_KEYS) {
                    if (Object.prototype.hasOwnProperty.call(syncMirror, key)) {
                        try { localStorage.setItem(key, String(syncMirror[key])); } catch (e) { /* best-effort */ }
                    }
                }
            } catch (error) {
                console.warn('store: failed to load chrome.storage.sync:', error);
            }
        } catch (error) {
            console.warn('store: failed to load chrome.storage.local:', error);
        }
        // Issue #63 shadow adoption (runs after the local load filled the
        // mirror): a scrollTop shadow written by a previous session's scroll
        // listener is fresher than whatever the debounced persistence managed
        // to flush before the popup died — let it win, and reconcile the
        // chrome.storage copy so the drift doesn't outlive one debounce.
        // Absent shadow (first run after the update) leaves the loaded value
        // untouched.
        try {
            const shadow = localStorage.getItem(SCROLL_TOP_SHADOW);
            if (shadow !== null) {
                const parsed = Number(shadow);
                if (!Number.isNaN(parsed)) {
                    const loaded = mirror.scrollTop;
                    mirror.scrollTop = parsed;
                    if (String(loaded) !== shadow)
                        schedulePersist('scrollTop', parsed);
                }
            }
        } catch (e) { /* localStorage unavailable — chrome.storage stands */ }
        // the "where I was" shadows: same override semantics (a present
        // shadow is at least as fresh as the loaded copy). Values are raw
        // strings (focusID bookmark id / focusSpot JSON) — no parsing.
        for (const key in SHADOWED_WHERE_WAS) {
            try {
                const shadow = localStorage.getItem(SHADOWED_WHERE_WAS[key]);
                if (shadow === null)
                    continue;
                const loaded = mirror[key];
                mirror[key] = shadow;
                if (String(loaded) !== shadow)
                    schedulePersist(key, shadow);
            } catch (e) { /* localStorage unavailable — chrome.storage stands */ }
        }
        resolveReady();
    };

    window.addEventListener('pagehide', () => {
        flush();
        flushSync();
    });

    window.store = store;

    // Back-compat async helpers (same signatures as the old storage.js).
    // Keys in SYNC_KEYS route to chrome.storage.sync automatically (the
    // useSync flag is kept for back-compat and still forces the sync area);
    // everything else goes to chrome.storage.local. setSetting/removeSetting
    // on a sync-routed key also refresh the sync mirror and the localStorage
    // boot copy so pages that read synchronously (store.get pre-paint, the
    // pre-fill on the next open) never see a stale value.
    const areaFor = (key, useSync) =>
        (useSync || isSyncKey(key)) ? chrome.storage.sync : chrome.storage.local;
    window.getSetting = async (key, defaultValue, useSync = false) => {
        try {
            const result = await areaFor(key, useSync).get({ [key]: defaultValue });
            return result[key];
        } catch (error) {
            console.warn(`Failed to get setting ${key}:`, error);
            return defaultValue;
        }
    };

    window.setSetting = async (key, value, useSync = false) => {
        try {
            await areaFor(key, useSync).set({ [key]: value });
            if (isSyncKey(key)) {
                syncMirror[key] = value;
                try { localStorage.setItem(key, String(value)); } catch (e) { /* best-effort */ }
            }
        } catch (error) {
            console.warn(`Failed to set setting ${key}:`, error);
        }
    };

    window.removeSetting = async (key, useSync = false) => {
        try {
            await areaFor(key, useSync).remove(key);
            if (isSyncKey(key)) {
                delete syncMirror[key];
                localStorage.removeItem(key);
            }
        } catch (error) {
            console.warn(`Failed to remove setting ${key}:`, error);
        }
    };

    init();
})();
