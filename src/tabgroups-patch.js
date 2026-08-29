/**
 * Title-churn row surgery + refresh fingerprint for the tab-groups view
 * (2026-08-29 report: sites that animate document.title — flipping a few
 * glyphs in the tab title every few hundred milliseconds — used to turn
 * every flip into a 300 ms-debounced FULL refresh: two IPC reads plus an
 * innerHTML rebuild of the whole list, which reads as the view flickering
 * at the flip rate).
 *
 * Three pure pieces consumed by src/view-tabgroups.js:
 *
 * - isTitleOnlyChange(changeInfo): can this tabs.onUpdated payload be
 *   handled by patching ONE row in place? The rows render
 *   title/url/pin/sleep/grouping/bookmark-star from the tab; only `title`
 *   (plus favIconUrl/status, which the rows never render — favicons key on
 *   the URL through /_favicon/) can change without touching anything else
 *   on any row, group head or window head.
 *
 * - renderInputsFingerprint(snapshot): a collision-safe JSON digest of
 *   everything render() reads. refresh() compares it against the digest
 *   stored at the last render() entry and skips the whole-list rebuild
 *   when nothing rendered changed — spurious churn (onUpdated storms for
 *   fields the rows never show, service-worker ops echoing back) must not
 *   repaint. Non-rendered tab fields (favIconUrl, status, …) are
 *   deliberately excluded, so a favicon-only storm digests identical and
 *   paints nothing.
 *
 * - replaceTabRowNode(oldRow, html, env): the DOM half of the row patch —
 *   build the regenerated <li> from a <template>, carry the runtime-added
 *   row classes and DOM focus across the swap, replaceWith. Works on
 *   detached nodes too: a fold stash holds the ORIGINAL row nodes and
 *   reinserts them on unfold, so a stashed row must not go stale. Returns
 *   the fresh node, or null when the environment can't build nodes
 *   (minimal test doubles — the caller then falls back to the full render
 *   on its next refresh; the memory half of the patch still landed).
 */

// tabs.onUpdated changeInfo fields the tab-groups rows never render — a
// payload whose keys are ALL in this set can patch a single row in place.
// Anything else (url, pinned, discarded, audible, groupId, …) feeds the
// row's classes/icons/structure and keeps the debounced full refresh.
const PATCH_SAFE_KEYS = ['title', 'favIconUrl', 'status'];

export const isTitleOnlyChange = changeInfo => {
    const info = changeInfo || {};
    const keys = Object.keys(info);
    for (let i = 0; i < keys.length; i++) {
        if (PATCH_SAFE_KEYS.indexOf(keys[i]) === -1)
            return false;
    }
    return true; // includes the empty payload — nothing changed, nothing to do
};

// The snapshot fields mirror render()'s reads one-to-one (view-tabgroups
// builds it next to render()); `staged(url)` probes the staging relay so
// the row's stage glyph is covered without hashing the whole staging set.
export const renderInputsFingerprint = snap => {
    const s = snap || {};
    const staged = typeof s.staged === 'function' ? s.staged : () => false;
    const wins = (s.windows || []).map(w => [
        w.id,
        w.focused ? 1 : 0,
        (w.tabs || []).map(t => [
            t.id, t.index, t.title, t.url,
            t.pinned ? 1 : 0, t.discarded ? 1 : 0, t.active ? 1 : 0,
            t.groupId, staged(t.url) ? 1 : 0
        ])
    ]);
    const groups = (s.groups || []).map(g => [g.id, g.title, g.color, g.collapsed ? 1 : 0]);
    return JSON.stringify([
        wins,
        groups,
        [...(s.collapsed || [])].sort(),
        [...(s.collapsedWindows || [])].sort(),
        [s.selecting ? 1 : 0, [...(s.selected || [])].sort()],
        s.filterText || '',
        s.bookmarksRev || 0,
        (s.closedRecords || []).map(r => [r.id, r.savedAt || 0, (r.tabs || []).length]),
        [s.colorStyle || '', s.virtual ? 1 : 0, s.relay ? 1 : 0]
    ]);
};

// Row classes a regenerated <li> must inherit from the node it replaces:
// the drag session's runtime marks (re-applied per chunk elsewhere — a swap
// between chunks must not drop one) plus `tg-last`, the group-connector
// elbow class tabRowHtml only derives from member POSITION — the title
// patch never reorders members (order changes take the full-refresh path),
// so the old row's positional class is exact for the fresh one.
const ROW_RUNTIME_CLASSES = ['dragging', 'drag-over', 'tg-last'];

export const replaceTabRowNode = (oldRow, html, env = {}) => {
    const doc = env.document;
    if (!doc || typeof doc.createElement !== 'function'
        || !oldRow || typeof oldRow.replaceWith !== 'function')
        return null;
    const tpl = doc.createElement('template');
    if (!tpl || !tpl.content)
        return null;
    tpl.innerHTML = html;
    const fresh = tpl.content.firstElementChild;
    if (!fresh)
        return null;
    if (oldRow.classList && fresh.classList) {
        for (let i = 0; i < ROW_RUNTIME_CLASSES.length; i++) {
            if (oldRow.classList.contains(ROW_RUNTIME_CLASSES[i]))
                fresh.classList.add(ROW_RUNTIME_CLASSES[i]);
        }
    }
    // DOM focus must survive the swap: the keyboard model holds focus on
    // the row's link (or a row button mid-interaction). Match the old
    // focused element by its first class, then fall back to the row link.
    const active = env.activeElement;
    if (active && typeof oldRow.contains === 'function' && oldRow.contains(active)) {
        const first = active.classList && active.classList.length
            ? String(active.classList[0]) : '';
        const esc = typeof env.cssEscape === 'function' ? env.cssEscape : (x => x);
        let again = first && typeof fresh.querySelector === 'function'
            ? fresh.querySelector('.' + esc(first)) : null;
        if (!again && typeof fresh.querySelector === 'function') {
            again = fresh.querySelector('a.tree-item-link')
                || fresh.querySelector('a, span[tabindex]')
                || fresh.querySelector('a, span');
        }
        if (again && typeof again.focus === 'function')
            again.focus();
    }
    oldRow.replaceWith(fresh);
    return fresh;
};
