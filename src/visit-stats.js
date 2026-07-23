/**
 * Visit statistics collector (v4 task 2, slice D).
 *
 * Two data sources:
 *   1. Extension-tracked clicks (recordVisit): stored in `visitStats`.
 *   2. Chrome history (optional): when `history` permission is granted,
 *      importHistory() fetches chrome.history data for known bookmark URLs
 *      and merges visit counts into the stats.
 *
 * initVisitStats(ctx)
 * ctx.store — settings mirror
 */

export function initVisitStats(ctx = {}) {
    const store = ctx.store;

    let stats = {};
    let dirty = false;
    let flushTimer = null;
    let historyData = null;   // merged history counts: { bookmarkId: count }
    let historyLoaded = false;

    // Load from storage
    const load = () => {
        try {
            const raw = store.get('visitStats');
            if (raw) {
                stats = typeof raw === 'string' ? JSON.parse(raw) : raw;
            }
        } catch (e) { stats = {}; }
    };

    // Persist with debounce
    const scheduleFlush = () => {
        dirty = true;
        clearTimeout(flushTimer);
        flushTimer = setTimeout(() => {
            if (dirty) {
                store.set('visitStats', JSON.stringify(stats));
                dirty = false;
            }
        }, 500);
    };

    const flush = () => {
        clearTimeout(flushTimer);
        if (dirty) {
            store.set('visitStats', JSON.stringify(stats));
            dirty = false;
        }
    };

    // Record a visit for a bookmark id
    const recordVisit = (bookmarkId) => {
        if (!bookmarkId) return;
        if (store.get('statsEnabled', '1') === 'false') return;

        if (!stats[bookmarkId]) {
            stats[bookmarkId] = { c: 0, t: 0 };
        }
        stats[bookmarkId].c = (stats[bookmarkId].c || 0) + 1;
        stats[bookmarkId].t = Date.now();
        scheduleFlush();
    };

    // Get all stats (merged with history data if available)
    const getStats = () => {
        if (!historyLoaded || !historyData) return stats;

        // Merge: history count + tracked count
        const merged = {};
        const allIds = new Set([...Object.keys(stats), ...Object.keys(historyData)]);
        for (const id of allIds) {
            const s = stats[id] || { c: 0, t: 0 };
            const h = historyData[id] || 0;
            merged[id] = {
                c: s.c + h,
                t: Math.max(s.t || 0, 0)  // history data has no per-bookmark timestamp
            };
        }
        return merged;
    };

    // Import history data from chrome.history (requires 'history' optional permission)
    // Merges visit counts for known bookmark URLs into historyData.
    const importHistory = () => {
        if (!chrome.permissions) {
            historyLoaded = true;
            return Promise.resolve(0);
        }
        return new Promise((resolve) => {
            chrome.permissions.contains({ permissions: ['history'] }, (hasPermission) => {
                if (!hasPermission) {
                    historyLoaded = true;
                    resolve(0);
                    return;
                }
                // Collect all bookmark URLs → id mapping
                chrome.bookmarks.getTree(tree => {
                    const urlToIds = {};  // url → [id, ...]
                    const walk = (nodes) => {
                        for (const node of nodes) {
                            if (node.url && node.id) {
                                if (!urlToIds[node.url]) urlToIds[node.url] = [];
                                urlToIds[node.url].push(node.id);
                            }
                            if (node.children) walk(node.children);
                        }
                    };
                    walk(tree || []);

                    const urls = Object.keys(urlToIds);
                    if (!urls.length) { historyLoaded = true; resolve(0); return; }

                    // Query history for each URL (batched, max 100 per query)
                    const results = {};
                    let pending = urls.length;
                    const chunkSize = 50;

                    const processChunk = (startIdx) => {
                        const chunk = urls.slice(startIdx, startIdx + chunkSize);
                        if (!chunk.length) {
                            // All done
                            historyData = {};
                            for (const [url, ids] of Object.entries(results)) {
                                for (const id of ids) {
                                    historyData[id] = (historyData[id] || 0) + results[url];
                                }
                            }
                            historyLoaded = true;
                            resolve(Object.keys(historyData).length);
                            return;
                        }

                        // Process each URL in the chunk
                        let chunkPending = chunk.length;
                        for (const url of chunk) {
                            chrome.history.getVisits({ url }, (visits) => {
                                if (visits && visits.length > 0) {
                                    results[url] = visits.length;
                                }
                                chunkPending--;
                                if (chunkPending === 0) {
                                    processChunk(startIdx + chunkSize);
                                }
                            });
                        }
                    };

                    processChunk(0);
                });
            });
        });
    };

    // Check if history permission is available
    const hasHistoryPermission = () => {
        return new Promise((resolve) => {
            if (!chrome.permissions) { resolve(false); return; }
            chrome.permissions.contains({ permissions: ['history'] }, resolve);
        });
    };

    // Request history permission (call from UI)
    const requestHistoryPermission = () => {
        return new Promise((resolve) => {
            if (!chrome.permissions) { resolve(false); return; }
            chrome.permissions.request({ permissions: ['history'] }, (granted) => {
                if (granted) {
                    importHistory().then(() => resolve(true));
                } else {
                    resolve(false);
                }
            });
        });
    };

    // Clear all stats (both tracked and history)
    const clearStats = () => {
        stats = {};
        historyData = null;
        historyLoaded = false;
        store.set('visitStats', '{}');
        dirty = false;
        clearTimeout(flushTimer);
    };

    // Prune: remove stats for ids not in the given set
    const prune = (validIds) => {
        let changed = false;
        for (const id of Object.keys(stats)) {
            if (!validIds.has(id)) {
                delete stats[id];
                changed = true;
            }
        }
        if (changed) scheduleFlush();
        // Also prune historyData
        if (historyData) {
            for (const id of Object.keys(historyData)) {
                if (!validIds.has(id)) delete historyData[id];
            }
        }
    };

    // Load on init
    load();

    // Flush on pagehide
    if (typeof window !== 'undefined') {
        window.addEventListener('pagehide', flush);
    }

    return {
        recordVisit,
        getStats,
        clearStats,
        prune,
        flush,
        importHistory,
        hasHistoryPermission,
        requestHistoryPermission
    };
}
