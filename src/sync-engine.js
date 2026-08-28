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
 * Refresh triggers: the seven chrome.bookmarks event classes (the four
 * id-bearing ones batched into one debounced pass, and all four disabled
 * on Chrome <138 — node.syncing is undefined there, so recomputes can only
 * re-derive "unknown"), the `vbm-sync-refresh` chrome.alarms periodical
 * (driven by the autoRefreshSync / syncRefreshInterval settings in
 * chrome.storage.sync, and gated on showSyncStatus + Chrome ≥138 as well)
 * and two fire-and-forget runtime messages from pages:
 *   { type: 'vbm-sync-refresh' }                    → recompute the whole tree
 *   { type: 'vbm-sync-status-request', ids: [...] } → recompute these ids
 *
 * The message handlers stay live on old Chrome: they are what paints the
 * 'unsyncable' markers (blacklisted URL schemes) when a page asks.
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

// Chrome 138+ exposes node.syncing; below it the tree walk can only stamp
// every node "unknown", so the periodic alarm and the event-driven
// recomputes are pure IPC waste and stay off (page-driven status requests
// still run — they paint the 'unsyncable' markers on old Chrome). No
// SW-side version probe existed when this gate was added
// (src/version-info.js's parseBrowser is page-side display logic that
// prefers the Edg/OPR distributor tokens over the engine version), so this
// is the minimal parse: every Chromium UA carries the engine version in
// its Chrome/ token. Fail-open — an unparsable UA keeps the engine fully
// active (worst case = the old behavior).
const SYNCING_SINCE_CHROME = 138;
const syncingSupported = () => {
    try {
        const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
        const m = /Chrome\/(\d+)/.exec(ua);
        return !m || +m[1] >= SYNCING_SINCE_CHROME;
    } catch (error) {
        return true;
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
    let lastFingerprint = null;
    const flush = () => {
        clearTimeout(flushTimer);
        flushTimer = setTimeout(() => {
            flushTimer = null;
            try {
                // Skip the rewrite when the published map is unchanged — the
                // page side diffs before dispatching, but the SW wake +
                // serialize + session write + onChanged fan-out still cost.
                // The fingerprint ignores `ts` (recomputeAll re-stamps it on
                // every run) and walks sorted ids, so a delete+re-set can't
                // reorder an unchanged map into a different string.
                const fingerprint = JSON.stringify([...statusMap.keys()].sort()
                    .map(id => {
                        const entry = statusMap.get(id);
                        return [id, entry.indicator, entry.tooltip];
                    }));
                if (fingerprint === lastFingerprint) {
                    return;
                }
                const write = chrome.storage.session.set({
                    [SYNC_STORAGE_KEY]: Object.fromEntries(statusMap)
                });
                if (write && typeof write.then === 'function') {
                    // Mark published only once the write lands: a rejected
                    // write keeps the old fingerprint, so the next trigger
                    // still republishes (the pre-diff retry semantics).
                    write.then(() => { lastFingerprint = fingerprint; }, () => {});
                } else {
                    lastFingerprint = fingerprint;
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

    // Burst collector for the four id-bearing bookmark events: a recursive
    // folder sort fires one onMoved per moved node, and wiring each event
    // straight to recomputeIds would serialize N chrome.bookmarks.get IPCs
    // (the visit-stats onMoved debounce, src/visit-stats-sw.js, exists for
    // the same reason). Ids gather in a Set; 300ms after the last event a
    // single recomputeIds pass walks them (one flush at its end).
    let pendingIds = new Set();
    let idsTimer = null;
    const scheduleRecompute = id => {
        pendingIds.add(id);
        clearTimeout(idsTimer);
        idsTimer = setTimeout(() => {
            idsTimer = null;
            const ids = [...pendingIds];
            pendingIds = new Set();
            recomputeIds(ids);
        }, 300);
    };

    // autoRefreshSync may be stored as 'true'/'false' strings (options.js)
    // or booleans (older versions) — treat both false spellings as off.
    // chrome.alarms hard-rejects periods below 0.5 minutes, so legacy 20-29s
    // settings land on 30 seconds; the Math.max makes the clamp explicit.
    const scheduleAlarm = () => {
        if (!chrome.alarms) {
            return;
        }
        // Gated on showSyncStatus too (same off-spellings): with the
        // indicators hidden the periodic republish serves nobody. And on
        // Chrome <138 (see syncingSupported) node.syncing is undefined, so a
        // timed recompute can only re-derive the same all-unknown map.
        const enabled = settings.autoRefreshSync !== 'false' && settings.autoRefreshSync !== false
            && settings.showSyncStatus !== 'false' && settings.showSyncStatus !== false
            && syncingSupported();
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
                if (key === 'autoRefreshSync' || key === 'syncRefreshInterval' || key === 'showSyncStatus') {
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
        // The four id-bearing recompute triggers go through the debounced
        // collector and stay off entirely on Chrome <138 (see
        // syncingSupported); onRemoved/onImport* are immediate as before —
        // they keep the published map honest, not recompute it.
        if (syncingSupported()) {
            chrome.bookmarks.onCreated.addListener(id => scheduleRecompute(id));
            chrome.bookmarks.onChanged.addListener(id => scheduleRecompute(id));
            chrome.bookmarks.onMoved.addListener(id => scheduleRecompute(id));
            chrome.bookmarks.onChildrenReordered.addListener(id => scheduleRecompute(id));
        }
        chrome.bookmarks.onRemoved.addListener(id => {
            statusMap.delete(id);
            flush();
        });
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
