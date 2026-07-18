/**
 * vBookmarks Sync Engine (P3.6 — service-worker side)
 *
 * Owns sync-status computation for the whole bookmark tree. The page-side
 * client (src/sync-manager.js) computes nothing: this engine walks the
 * tree, derives a per-node { indicator, tooltip } pair and publishes the
 * whole map to chrome.storage.session under the key `vbmSyncStatus`.
 * Pages mirror that blob synchronously and re-render from storage events.
 *
 * Status semantics follow docs/bookmark-sync-changes.md: Chrome 138+
 * exposes node.syncing (true = synced to the account, false = local-only
 * storage). On older Chrome the property is undefined and the status is
 * genuinely unknown — the engine reports '' instead of guessing "synced"
 * (the old page-side manager treated "URL is not chrome://" as synced,
 * which fabricated green dots, and its cache-write shapes never matched
 * its cache reads anyway).
 *
 * Refresh triggers: the seven chrome.bookmarks event classes, the
 * `vbm-sync-refresh` chrome.alarms periodical (driven by the
 * autoRefreshSync / syncRefreshInterval settings in chrome.storage.sync)
 * and two fire-and-forget runtime messages from pages:
 *   { type: 'vbm-sync-refresh' }                    → recompute the whole tree
 *   { type: 'vbm-sync-status-request', ids: [...] } → recompute these ids
 *
 * The module only touches the chrome global inside functions, so tests can
 * inject a double on globalThis before calling createSyncEngine().
 */

export const SYNC_STORAGE_KEY = 'vbmSyncStatus';
export const REFRESH_ALARM = 'vbm-sync-refresh';

// URLs Chrome sync will never upload (the old SyncManager's blacklist).
const UNSYNCABLE_URL_PATTERNS = [
    'chrome://',
    'chrome-extension://',
    'moz-extension://',
    'edge://',
    'about:',
    'data:',
    'file:',
    'javascript:'
];

export const isUrlSyncable = url =>
    !UNSYNCABLE_URL_PATTERNS.some(pattern => url.startsWith(pattern));

// Localized tooltip with an English fallback: chrome.i18n is available in
// the service worker, but unit tests inject a chrome double without it.
const _m = (key, fallback) => {
    try {
        return chrome.i18n.getMessage(key) || fallback;
    } catch (error) {
        return fallback;
    }
};

// Pure node → status mapping. Tooltips are localized via chrome.i18n (keys
// registered in _locales; English inline as the last-resort fallback). The
// old "folderType (Synced)" concatenation leaked raw enum values and was
// never localizable — special roots now get their suffix from tree-render
// (syncSuffixLocal/syncSuffixSynced) on the label itself. Unknown means
// empty strings — never a fabricated 'synced'.
export const computeStatus = node => {
    if (!node) {
        return { indicator: '', tooltip: '' };
    }
    if (node.syncing === true) {
        return {
            indicator: 'synced',
            tooltip: _m('syncStatusSynced', 'Synced to your Google account')
        };
    }
    if (node.syncing === false) {
        return {
            indicator: 'local',
            tooltip: _m('syncStatusLocal', 'Local only — not uploaded')
        };
    }
    // node.syncing === undefined (Chrome <138): status unknown. The only
    // thing still decidable is "can never sync" for blacklisted URL schemes.
    if (node.url && !isUrlSyncable(node.url)) {
        return {
            indicator: 'unsyncable',
            tooltip: _m('syncStatusUnsyncable', 'Cannot be synced')
        };
    }
    return { indicator: '', tooltip: '' };
};

export const createSyncEngine = () => {
    // id → { indicator, tooltip, ts }
    const statusMap = new Map();
    const settings = {
        showSyncStatus: 'true',
        highlightUnsynced: 'true',
        autoRefreshSync: 'true',
        syncRefreshInterval: 60
    };
    let flushTimer = null;

    const getTree = () => new Promise(resolve => {
        chrome.bookmarks.getTree(tree => resolve(tree || []));
    });

    const getNode = id => new Promise(resolve => {
        chrome.bookmarks.get(id, nodes => {
            // A missing id rejects via lastError and yields no nodes — the
            // entry is then dropped from the map (deleted bookmark).
            void chrome.runtime.lastError;
            resolve(nodes && nodes[0] ? nodes[0] : null);
        });
    });

    // Debounced publish: bursts of bookmark events (imports, bulk moves)
    // collapse into one session write. Losing a write to a SW shutdown is
    // fine — the next event or alarm rebuilds the map from scratch.
    const flush = () => {
        clearTimeout(flushTimer);
        flushTimer = setTimeout(() => {
            flushTimer = null;
            try {
                const write = chrome.storage.session.set({
                    [SYNC_STORAGE_KEY]: Object.fromEntries(statusMap)
                });
                if (write && typeof write.catch === 'function') {
                    write.catch(() => {});
                }
            } catch (error) {
                // Session area rejected the write — the next trigger republishes.
            }
        }, 500);
    };

    const walk = (nodes, ts) => {
        for (const node of nodes) {
            const { indicator, tooltip } = computeStatus(node);
            statusMap.set(node.id, { indicator, tooltip, ts });
            if (node.children) {
                walk(node.children, ts);
            }
        }
    };

    const recomputeAll = async () => {
        const tree = await getTree();
        statusMap.clear();
        walk(tree, Date.now());
        flush();
    };

    const recomputeIds = async ids => {
        if (!Array.isArray(ids)) {
            return;
        }
        const ts = Date.now();
        for (const id of ids) {
            const node = await getNode(id);
            if (node) {
                const { indicator, tooltip } = computeStatus(node);
                statusMap.set(id, { indicator, tooltip, ts });
            } else {
                statusMap.delete(id);
            }
        }
        flush();
    };

    // autoRefreshSync may be stored as 'true'/'false' strings (options.js)
    // or booleans (older versions) — treat both false spellings as off.
    // chrome.alarms hard-rejects periods below 0.5 minutes, so legacy 20-29s
    // settings land on 30 seconds; the Math.max makes the clamp explicit.
    const scheduleAlarm = () => {
        if (!chrome.alarms) {
            return;
        }
        const enabled = settings.autoRefreshSync !== 'false' && settings.autoRefreshSync !== false;
        if (!enabled) {
            const cleared = chrome.alarms.clear(REFRESH_ALARM);
            if (cleared && typeof cleared.catch === 'function') {
                cleared.catch(() => {});
            }
            return;
        }
        const seconds = parseInt(settings.syncRefreshInterval, 10) || 60;
        chrome.alarms.create(REFRESH_ALARM, {
            periodInMinutes: Math.max(seconds / 60, 0.5)
        });
    };

    const onStorageChanged = (changes, area) => {
        if (area !== 'sync') {
            return;
        }
        let alarmTouched = false;
        for (const key of Object.keys(settings)) {
            if (key in changes) {
                settings[key] = changes[key].newValue;
                if (key === 'autoRefreshSync' || key === 'syncRefreshInterval') {
                    alarmTouched = true;
                }
            }
        }
        if (alarmTouched) {
            scheduleAlarm();
        }
    };

    const start = () => {
        // The seven bookmark event classes the old page-side manager watched.
        chrome.bookmarks.onCreated.addListener(id => recomputeIds([id]));
        chrome.bookmarks.onChanged.addListener(id => recomputeIds([id]));
        chrome.bookmarks.onRemoved.addListener(id => {
            statusMap.delete(id);
            flush();
        });
        chrome.bookmarks.onMoved.addListener(id => recomputeIds([id]));
        chrome.bookmarks.onChildrenReordered.addListener(id => recomputeIds([id]));
        chrome.bookmarks.onImportBegan.addListener(() => {
            statusMap.clear();
            flush();
        });
        chrome.bookmarks.onImportEnded.addListener(() => recomputeAll());

        if (chrome.alarms) {
            chrome.alarms.onAlarm.addListener(alarm => {
                if (alarm && alarm.name === REFRESH_ALARM) {
                    recomputeAll();
                }
            });
        }

        chrome.storage.onChanged.addListener(onStorageChanged);

        // Pages nudge the engine through fire-and-forget messages; no
        // sendResponse — answers travel back via the storage.session blob.
        chrome.runtime.onMessage.addListener(message => {
            if (!message || typeof message !== 'object') {
                return;
            }
            if (message.type === 'vbm-sync-refresh') {
                recomputeAll();
            } else if (message.type === 'vbm-sync-status-request') {
                recomputeIds(message.ids);
            }
        });

        chrome.storage.sync.get({ ...settings }, data => {
            Object.assign(settings, data);
            scheduleAlarm();
        });
    };

    return { start, recomputeAll, recomputeIds, computeStatus };
};
