/**
 * Visit statistics collector (v4 task 2, slice D).
 *
 * Lightweight, self-contained visit counter — no chrome.history permission required.
 * Records { [bookmarkId]: { c: count, t: timestamp } } in a single storage key
 * `visitStats`. Writes are debounced (500ms). The statsEnabled setting gates
 * all collection.
 *
 * initVisitStats(ctx)
 * ctx.store — settings mirror
 */

export function initVisitStats(ctx = {}) {
    const store = ctx.store;

    let stats = {};
    let dirty = false;
    let flushTimer = null;

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

    // Get all stats
    const getStats = () => stats;

    // Clear all stats
    const clearStats = () => {
        stats = {};
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
    };

    // Load on init
    load();

    // Flush on pagehide
    if (typeof window !== 'undefined') {
        window.addEventListener('pagehide', flush);
    }

    return { recordVisit, getStats, clearStats, prune, flush };
}
