/**
 * Visit statistics store (v4 task-2, slice D — docs/v4task-2.md §5.4).
 *
 * The extension's own lightweight visit counter — chrome.history stays an
 * OPTIONAL permission (the install warning is a trust disaster, §5.4);
 * users who grant it from the recent-view banner get their past visits
 * seeded in one merge() pass. Shape: `{ [bookmarkId]: { c, t } }` with
 * c = open count and t = last-open timestamp, persisted under the single
 * `visitStats` storage key with debounced writes (a popup session can open
 * dozens of bookmarks; one write per open would hammer chrome.storage).
 *
 * Privacy contract (§5.4/§7):
 * - `statsEnabled` (default on) is the master switch — record() is a no-op
 *   while it is off, and prune() skips its write too, so "off" means zero
 *   writes, not just zero new entries (slice D acceptance: 开关关闭零写入).
 * - clear() always works, even while disabled: turning the feature off must
 *   never lock the user out of erasing already-collected data.
 * - prune(validIds) drops entries whose bookmark no longer exists; it runs
 *   on every tree rebuild so the dataset can never outgrow the tree.
 *
 * Pure logic, no DOM: chrome.i18n/document never touched here. `store` is
 * the settings mirror; setTimeout/clearTimeout and Date.now remain page
 * globals (record accepts an explicit `now` for tests). flush() forces the
 * pending debounced write — tests and the view's clear path use it.
 *
 * initVisitStats(ctx) is called once by neat.js before initTreeView (the
 * tree-generated prune hook and the bookmarkHandler open hook both need it).
 * ctx.store       — settings mirror (visitStats/statsEnabled)
 * ctx.debounceMs  — persist debounce (default 500; tests pass 0 + flush)
 */
export function initVisitStats(ctx = {}) {
    const store = ctx.store;
    const debounceMs = ctx.debounceMs === undefined ? 500 : ctx.debounceMs;

    let data = null; // lazy-parsed mirror of the visitStats key
    let dirty = false;
    let timer = null;

    const enabled = () => !!store.get('statsEnabled', '1');

    const load = () => {
        if (data === null) {
            try {
                const parsed = JSON.parse(store.get('visitStats', '{}') || '{}');
                data = (parsed && typeof parsed === 'object') ? parsed : {};
            } catch (e) {
                data = {};
            }
        }
        return data;
    };

    const flush = () => {
        clearTimeout(timer);
        timer = null;
        if (!dirty)
            return;
        dirty = false;
        store.set('visitStats', JSON.stringify(load()));
    };

    const schedule = () => {
        dirty = true;
        clearTimeout(timer);
        timer = setTimeout(flush, debounceMs);
    };

    // One bookmark open. No-op while the master switch is off (zero-write
    // contract) and on malformed ids.
    const record = (id, now) => {
        if (!enabled())
            return;
        if (id === undefined || id === null || id === '')
            return;
        const d = load();
        const key = `${id}`;
        const entry = d[key] || { c: 0, t: 0 };
        entry.c += 1;
        entry.t = now === undefined ? Date.now() : now;
        d[key] = entry;
        schedule();
    };

    const get = id => load()[`${id}`] || null;

    // Bulk additive merge — the chrome.history import (optional permission,
    // recent-view banner) seeds past visits as {id, c, t} entries: c adds to
    // the counter, t max-merges. Same zero-write contract as record() (no-op
    // while the switch is off). Returns the number of ids touched.
    const merge = entries => {
        if (!enabled() || !Array.isArray(entries))
            return 0;
        const d = load();
        let touched = 0;
        for (let i = 0, l = entries.length; i < l; i++) {
            const e = entries[i];
            if (!e || e.id === undefined || e.id === null || e.id === '')
                continue;
            const key = `${e.id}`;
            const cur = d[key] || { c: 0, t: 0 };
            cur.c += e.c | 0;
            cur.t = Math.max(cur.t, e.t || 0);
            d[key] = cur;
            touched++;
        }
        if (touched)
            schedule();
        return touched;
    };

    const countOf = id => {
        const entry = load()[`${id}`];
        return entry ? (entry.c || 0) : 0;
    };

    // Snapshot for the stats view's render pass (shallow copy per entry so
    // callers can't mutate the pending-write mirror).
    const all = () => {
        const d = load();
        const out = {};
        for (const id of Object.keys(d))
            out[id] = { c: d[id].c || 0, t: d[id].t || 0 };
        return out;
    };

    // Drop entries for bookmarks that no longer exist. Runs on every tree
    // rebuild; writes only when something actually changed. Skipped while
    // the switch is off (zero-write contract).
    const prune = validIds => {
        if (!enabled())
            return false;
        const d = load();
        let changed = false;
        for (const id of Object.keys(d)) {
            if (!validIds.has(id)) {
                delete d[id];
                changed = true;
            }
        }
        if (changed)
            schedule();
        return changed;
    };

    // User-triggered erasure — allowed in any switch state, synchronous
    // (a pending debounced write must not resurrect the wiped data).
    const clear = () => {
        clearTimeout(timer);
        timer = null;
        data = {};
        dirty = false;
        store.set('visitStats', '{}');
    };

    return { record, get, countOf, all, merge, prune, clear, flush, enabled };
}
