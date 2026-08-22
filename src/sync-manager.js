/**
 * vBookmarks Sync Manager — page-side client (P3.6)
 *
 * All status computation moved to src/sync-engine.js in the service worker.
 * This classic script only mirrors the engine's published blob
 * (chrome.storage.session key `vbmSyncStatus`: { id: { indicator, tooltip,
 * ts } }) into memory so renderers keep reading sync status synchronously
 * through window.syncManager — same surface as before:
 *   getSyncStatusIndicator(id) → 'synced' | 'local' | 'unsyncable' | ''
 *   getSyncTooltip(id)         → tooltip text or ''
 *   refreshAllSyncStatus()     → ask the SW to recompute (fire-and-forget)
 *
 * Mirror misses fire a `vbm-sync-status-request` message; the answer
 * arrives asynchronously through the storage onChanged handler below, which
 * re-dispatches the `syncStatusChanged` window event sync-ui.js listens to
 * (detail: { bookmarkId, status } — contract unchanged).
 */
(() => {
    const SESSION_KEY = 'vbmSyncStatus';

    const mirror = {};
    const sessionArea = chrome.storage.session;

    // All messages are fire-and-forget hints to the service worker; the
    // callback only swallows lastError so an asleep SW never surfaces as
    // an unchecked runtime error.
    const sendMessage = message => {
        try {
            chrome.runtime.sendMessage(message, () => {
                void chrome.runtime.lastError;
            });
        } catch (error) {
            // Ignore — messaging is best-effort.
        }
    };

    const applySessionBlob = blob => {
        for (const key of Object.keys(mirror)) {
            delete mirror[key];
        }
        Object.assign(mirror, blob || {});
    };

    const onStorageChanged = (changes, area) => {
        if (area !== 'session' || !changes[SESSION_KEY]) {
            return;
        }
        const oldMap = changes[SESSION_KEY].oldValue || {};
        const newMap = changes[SESSION_KEY].newValue || {};
        applySessionBlob(newMap);
        const ids = new Set([...Object.keys(oldMap), ...Object.keys(newMap)]);
        for (const id of ids) {
            const before = oldMap[id];
            const after = newMap[id];
            if (!before || !after ||
                before.indicator !== after.indicator || before.tooltip !== after.tooltip) {
                window.dispatchEvent(new window.CustomEvent('syncStatusChanged', {
                    detail: { bookmarkId: id, status: after ? after.indicator : '' }
                }));
            }
        }
    };

    const init = () => {
        try {
            const read = sessionArea.get(SESSION_KEY);
            if (read && typeof read.then === 'function') {
                read.then(data => {
                    const blob = data ? data[SESSION_KEY] : null;
                    applySessionBlob(blob);
                    // H4: the initial blob is applied silently by the classic
                    // loader, so rows rendered before it arrived never get
                    // badges — dispatch one event per non-empty entry so
                    // sync-ui.js re-lays them ("status arrived late").
                    for (const id of Object.keys(mirror)) {
                        const entry = mirror[id];
                        if (entry && (entry.indicator || entry.tooltip)) {
                            window.dispatchEvent(new window.CustomEvent('syncStatusChanged', {
                                detail: { bookmarkId: id, status: entry.indicator || '' }
                            }));
                        }
                    }
                }).catch(() => {});
            }
        } catch (error) {
            // Session read failed — indicators simply stay hidden.
        }
        chrome.storage.onChanged.addListener(onStorageChanged);
    };

    window.syncManager = {
        getSyncStatusIndicator(bookmarkId) {
            const entry = mirror[bookmarkId];
            if (!entry) {
                sendMessage({ type: 'vbm-sync-status-request', ids: [bookmarkId] });
                return '';
            }
            return entry.indicator || '';
        },

        getSyncTooltip(bookmarkId) {
            const entry = mirror[bookmarkId];
            if (!entry) {
                sendMessage({ type: 'vbm-sync-status-request', ids: [bookmarkId] });
                return '';
            }
            return entry.tooltip || '';
        },

        refreshAllSyncStatus() {
            sendMessage({ type: 'vbm-sync-refresh' });
            return true;
        }
    };

    init();
})();
