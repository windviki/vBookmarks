/**
 * Visit-stats service-worker collector (v4 task-2, slice E — docs/v4task-2.md
 * §5.4 采集点二).
 *
 * The page-side hook (tree-view's onOpenBookmark → visit-stats.js) only sees
 * opens initiated from the popup/panel. This collector closes the gap:
 * chrome.tabs.onUpdated URL navigations (address bar, omnibox, links from
 * other apps, the page context menu's quick-add flow) are matched against a
 * bookmark-URL index, and hits bump the same `visitStats` dataset.
 *
 * Protocol decisions (implementation supplements to §5.4):
 * - Matching is EXACT (tab URL === bookmark URL). No normalization: the
 *   dataset ranks concrete bookmarks, and fuzzy matching would inflate
 *   counts for dupes-cleaning candidates the user kept apart on purpose.
 * - Only changeInfo.url events count — status-only events (reloads,
 *   favicon/title flips) are not opens.
 * - Dedupe vs the page-side collector: a popup open navigates a tab too,
 *   which would double-count. Page side drops a short-lived marker into
 *   chrome.storage.session (`vbmPopupOpens`, url → timestamp) before the
 *   navigation; the collector skips URLs with a marker younger than
 *   DEDUPE_MS. markPopupOpen() below is the page-side half of the protocol.
 * - Read-modify-write flush (debounced): the popup's visit-stats.js writes
 *   the same key, so the merge reads the freshest blob before writing —
 *   last-writer-wins still applies across the two writers, but the debounce
 *   windows make collisions rare and counts are a ranking signal, not a
 *   ledger.
 * - `statsEnabled` off = zero writes AND pending increments are dropped
 *   (same contract as the page side, slice D acceptance).
 *
 * The module only touches the chrome global inside functions, so tests
 * inject a double on globalThis before calling createVisitStatsCollector()
 * (same recipe as src/sync-engine.js).
 */

export const POPUP_OPENS_KEY = 'vbmPopupOpens';
const FLUSH_DEBOUNCE_MS = 2000;
const DEDUPE_MS = 10000;

// Page-side half of the dedupe protocol: call right before a popup-initiated
// open navigates a tab. Fire-and-forget; the map self-prunes.
export const markPopupOpen = url => {
    if (!url || !chrome.storage || !chrome.storage.session)
        return;
    chrome.storage.session.get({ [POPUP_OPENS_KEY]: {} }, data => {
        const marks = data[POPUP_OPENS_KEY] || {};
        const now = Date.now();
        const cutoff = now - DEDUPE_MS;
        for (const u of Object.keys(marks)) {
            if (marks[u] < cutoff)
                delete marks[u];
        }
        marks[url] = now;
        chrome.storage.session.set({ [POPUP_OPENS_KEY]: marks });
    });
};

export function createVisitStatsCollector() {
    let urlIndex = new Map();   // exact url → [bookmarkId, ...]
    let pending = new Map();    // bookmarkId → { n, t } since the last flush
    let flushTimer = null;
    let enabled = true;         // statsEnabled mirror (default on)
    let started = false;

    // --- Bookmark URL index -------------------------------------------------
    const rebuildIndex = () => {
        chrome.bookmarks.getTree(tree => {
            const idx = new Map();
            const walk = nodes => {
                for (let i = 0, l = (nodes || []).length; i < l; i++) {
                    const node = nodes[i];
                    if (node.children) {
                        walk(node.children);
                    } else if (node.url) {
                        const ids = idx.get(node.url) || [];
                        ids.push(node.id);
                        idx.set(node.url, ids);
                    }
                }
            };
            walk(tree);
            urlIndex = idx;
        });
    };

    // --- Persist ------------------------------------------------------------
    const flush = () => {
        flushTimer = null;
        const batch = pending;
        pending = new Map();
        if (!batch.size || !enabled)
            return;
        chrome.storage.local.get({ visitStats: '{}' }, data => {
            let stats;
            try {
                stats = JSON.parse(data.visitStats || '{}');
            } catch (e) {
                stats = {};
            }
            for (const [id, rec] of batch) {
                const entry = stats[id] || { c: 0, t: 0 };
                entry.c += rec.n;
                entry.t = rec.t;
                stats[id] = entry;
            }
            chrome.storage.local.set({ visitStats: JSON.stringify(stats) });
        });
    };

    const scheduleFlush = () => {
        if (!flushTimer)
            flushTimer = setTimeout(flush, FLUSH_DEBOUNCE_MS);
    };

    // --- Navigation matching --------------------------------------------------
    const countVisit = url => {
        if (!enabled)
            return;
        const ids = urlIndex.get(url);
        if (!ids)
            return;
        chrome.storage.session.get({ [POPUP_OPENS_KEY]: {} }, data => {
            const marks = data[POPUP_OPENS_KEY] || {};
            const ts = marks[url];
            if (ts && Date.now() - ts < DEDUPE_MS)
                return; // the page-side collector already counted this open
            const now = Date.now();
            for (let i = 0, l = ids.length; i < l; i++) {
                const cur = pending.get(ids[i]) || { n: 0, t: 0 };
                cur.n += 1;
                cur.t = now;
                pending.set(ids[i], cur);
            }
            scheduleFlush();
        });
    };

    const onUpdated = (tabId, changeInfo, tab) => {
        // URL-change events only; status/favicon/title flips are not opens.
        const url = changeInfo && changeInfo.url;
        if (url)
            countVisit(url);
    };

    const onStorageChanged = (changes, area) => {
        if (area === 'local' && 'statsEnabled' in changes) {
            const v = changes.statsEnabled.newValue;
            enabled = !!v && v !== 'false';
            if (!enabled) {
                // zero-write contract: drop what hasn't been flushed yet
                pending.clear();
                if (flushTimer) {
                    clearTimeout(flushTimer);
                    flushTimer = null;
                }
            }
        }
    };

    const start = () => {
        if (started)
            return;
        started = true;
        chrome.storage.local.get({ statsEnabled: '1' }, data => {
            const v = data.statsEnabled;
            enabled = !!v && v !== 'false';
        });
        rebuildIndex();
        // The index follows every tree mutation; import-end covers bulk adds.
        const rebuildEvents = ['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onImportEnded'];
        for (const name of rebuildEvents) {
            if (chrome.bookmarks[name])
                chrome.bookmarks[name].addListener(rebuildIndex);
        }
        chrome.tabs.onUpdated.addListener(onUpdated);
        chrome.storage.onChanged.addListener(onStorageChanged);
    };

    // start() is what background.js calls; the rest is test surface.
    return { start, rebuildIndex, flush, countVisit, onUpdated };
}
