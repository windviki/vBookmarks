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
 *    then asynchronously overlaid with chrome.storage.local, which is the
 *    source of truth. `store.ready` resolves once the overlay and the
 *    migration below have finished; pages must gate their init on it.
 *    A second mirror (`getSyncSetting`/`setSyncSetting`) covers the
 *    chrome.storage.sync area for cross-device preferences (SYNC_KEYS).
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
 * options.js and popup.js) bypass the mirror and talk to chrome.storage
 * directly; pass useSync=true to use the sync area.
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
        // general options
        'leftClickNewTab', 'middleClickBgTab', 'closeUnusedFolders', 'bookmarkClickStayOpen',
        'dontConfirmOpenFolder', 'dontRememberState', 'onlyShowBMBar', 'searchAfterEnter',
        'autoResizePopup',
        // v4 task-2: view layer (slice A)
        'activeView', 'viewState', 'showViewTabs', 'showItemPath',
        // v4 task-2: non-empty folder delete confirmation (slice A2, §5.7)
        'confirmDeleteFolder',
        // v4 task-2: recent view + search history (slice B, §4.3/§5.3)
        'recentCount', 'searchHistory', 'searchLastQuery', 'searchHistoryEnabled',
        // separators & appearance
        'separators', 'separatorTitle', 'separatorURL', 'separatorUrl', 'separatorString',
        'separatorcolor', 'userstyle', 'customIcon', 'theme',
        // version & donation
        'currentVersion', 'openCount', 'donationKey', 'donationCountDown', 'donationFactor'
    ];

    // Keys that live in chrome.storage.sync (user preferences synced across devices).
    // Value model: toggles as 'true'/'false' strings (written by options.js),
    // syncRefreshInterval as a number of seconds. 'showSyncStatus' historically
    // lived in localStorage and is migrated into the sync area.
    const SYNC_KEYS = ['showSyncStatus', 'highlightUnsynced', 'autoRefreshSync', 'syncRefreshInterval'];

    const mirror = {};
    const syncMirror = {};

    // 1a. Synchronous pre-fill from localStorage
    for (const key of KNOWN_KEYS) {
        const value = localStorage.getItem(key);
        if (value !== null && value !== undefined) {
            mirror[key] = value;
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
            chrome.storage.local.set(batch);
        }
    };

    const schedulePersist = (key, value) => {
        pendingWrites[key] = value;
        clearTimeout(timers[key]);
        timers[key] = setTimeout(() => {
            const v = pendingWrites[key];
            delete pendingWrites[key];
            delete timers[key];
            chrome.storage.local.set({ [key]: v });
        }, 200);
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
            chrome.storage.sync.set(batch);
        }
    };

    const scheduleSyncPersist = (key, value) => {
        syncPendingWrites[key] = value;
        clearTimeout(syncTimers[key]);
        syncTimers[key] = setTimeout(() => {
            const v = syncPendingWrites[key];
            delete syncPendingWrites[key];
            delete syncTimers[key];
            chrome.storage.sync.set({ [key]: v });
        }, 500);
    };

    const store = {
        // Synchronous read from the mirror
        get(key, defaultValue) {
            return (key in mirror) ? mirror[key] : defaultValue;
        },
        // Synchronous mirror write + debounced persistence
        set(key, value) {
            mirror[key] = value;
            schedulePersist(key, value);
        },
        // Mirror + persistent removal
        remove(key) {
            delete mirror[key];
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
        // Sync mirror write + debounced persistence to chrome.storage.sync
        setSyncSetting(key, value) {
            syncMirror[key] = value;
            scheduleSyncPersist(key, value);
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

    const init = async () => {
        try {
            const data = await chrome.storage.local.get(null);
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
            // 1c. Load the sync area into its own mirror
            try {
                const syncData = await chrome.storage.sync.get(null);
                for (const key in syncData) {
                    syncMirror[key] = syncData[key];
                }
                // 'showSyncStatus' historically lived in localStorage; migrate it
                // into the sync area once (sync area wins if already set).
                if (!data[MIGRATION_FLAG] && !('showSyncStatus' in syncData)) {
                    const legacy = localStorage.getItem('showSyncStatus');
                    if (legacy !== null && legacy !== undefined) {
                        syncMirror.showSyncStatus = legacy;
                        await chrome.storage.sync.set({ showSyncStatus: legacy });
                    }
                }
            } catch (error) {
                console.warn('store: failed to load chrome.storage.sync:', error);
            }
        } catch (error) {
            console.warn('store: failed to load chrome.storage.local:', error);
        }
        resolveReady();
    };

    window.addEventListener('pagehide', () => {
        flush();
        flushSync();
    });

    window.store = store;

    // Back-compat async helpers (same signatures as the old storage.js).
    // These bypass the mirror and talk to chrome.storage directly.
    window.getSetting = async (key, defaultValue, useSync = false) => {
        try {
            const storage = useSync ? chrome.storage.sync : chrome.storage.local;
            const result = await storage.get({ [key]: defaultValue });
            return result[key];
        } catch (error) {
            console.warn(`Failed to get setting ${key}:`, error);
            return defaultValue;
        }
    };

    window.setSetting = async (key, value, useSync = false) => {
        try {
            const storage = useSync ? chrome.storage.sync : chrome.storage.local;
            await storage.set({ [key]: value });
        } catch (error) {
            console.warn(`Failed to set setting ${key}:`, error);
        }
    };

    window.removeSetting = async (key, useSync = false) => {
        try {
            const storage = useSync ? chrome.storage.sync : chrome.storage.local;
            await storage.remove(key);
        } catch (error) {
            console.warn(`Failed to remove setting ${key}:`, error);
        }
    };

    init();
})();
