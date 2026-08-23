/**
 * Staging-area pure data model (docs/plan-velvet/velvet-feat-staging-glm.md §0.3–0.4).
 *
 * The staging view (the upgraded recent view) is a decision workbench: items
 * collected from every other view wait here for bulk organization. The model
 * is deliberately DUAL-STATE — an item with `id` anchored to a live tree node
 * is "bookmarked" (starred), an item with `id = null` is a plain
 * `url`+`title` snapshot (from stats history rows, or a formerly-staged
 * bookmark whose tree node was removed). There is NO local favorite flag:
 * bookmarked-ness IS the id, so the staging list can never drift from the
 * tree (§0.2/§0.3 iteration B).
 *
 * State shape (persisted as one JSON string under the `staging` local key):
 *   { v: 1,
 *     items:  [ { id, url, title, ts, group } ],   // url is the unique key
 *     groups: [ { id, name, collapsed, createdAt, sourceFolderId?, sourceTabGroup?, manual? } ],
 *     recentCollapsed: false,   // "Recently added" section fold
 *     unfavCollapsed: false,    // unbookmarked inbox bucket fold
 *     lastSeenTs: 0 }           // "new N" counter baseline
 *
 * URL uniqueness (§0.4): the list is keyed by URL — resending never creates
 * a second entry. `id` is just "where this URL currently lives in the tree";
 * when that anchor dies the item RELINKS to another same-URL node or falls
 * back to `id = null` (it never silently disappears — the only exits are the
 * explicit actions: move-home / delete / remove / clear).
 *
 * Hard cap: 500 items (constant, no option). Additions that would cross the
 * cap are rejected as a whole, never truncated.
 *
 * Everything here is pure logic — zero chrome or DOM references; the view
 * (view-recent.js) and actions layer own persistence and rendering.
 */

export const STAGING_LIMIT = 500;

let groupSeq = 0;
const newGroupId = () => {
    groupSeq = (groupSeq + 1) % 0xffffffff;
    return 'g_' + Date.now().toString(36) + '_' + groupSeq.toString(36);
};

export const createState = () => ({
    v: 1,
    items: [],
    groups: [],
    recentCollapsed: false,
    unfavCollapsed: false,
    lastSeenTs: 0
});

// Tolerant parse of the persisted JSON (storage.onChanged replays the WHOLE
// object; a corrupted shape must degrade to an empty workbench, not crash).
export const parse = raw => {
    const empty = createState();
    if (!raw)
        return empty;
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        return empty;
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items))
        return empty;
    const state = empty;
    state.lastSeenTs = typeof parsed.lastSeenTs === 'number' ? parsed.lastSeenTs : 0;
    state.recentCollapsed = !!parsed.recentCollapsed;
    state.unfavCollapsed = !!parsed.unfavCollapsed;
    const knownGroups = new Set();
    if (Array.isArray(parsed.groups)) {
        for (const g of parsed.groups) {
            if (!g || typeof g !== 'object' || !g.id)
                continue;
            knownGroups.add(g.id);
            state.groups.push({
                id: g.id,
                name: typeof g.name === 'string' ? g.name : '',
                collapsed: !!g.collapsed,
                createdAt: typeof g.createdAt === 'number' ? g.createdAt : 0,
                sourceFolderId: g.sourceFolderId || null,
                sourceTabGroup: g.sourceTabGroup || null,
                // User-created groups survive an emptied member set (they
                // exist to be filled — the workbench's organizing units).
                manual: !!g.manual
            });
        }
    }
    for (const it of parsed.items) {
        if (!it || typeof it !== 'object' || !it.url)
            continue;
        state.items.push({
            id: it.id || null,
            url: it.url,
            title: typeof it.title === 'string' ? it.title : '',
            ts: typeof it.ts === 'number' ? it.ts : 0,
            group: (it.group && knownGroups.has(it.group)) ? it.group : null
        });
    }
    return state;
};

export const serialize = state => JSON.stringify(state);

export const count = state => state.items.length;

export const getByUrl = (state, url) => {
    for (let i = 0, l = state.items.length; i < l; i++) {
        if (state.items[i].url === url)
            return state.items[i];
    }
    return null;
};

const snapshot = item => ({
    id: item.id, url: item.url, title: item.title, ts: item.ts, group: item.group
});

// Deep-copied item snapshots for undo (re-adding removed items restores the
// exact ts/group bookkeeping, not just the identity).
export const snapshotItems = (state, urls) => {
    const set = urls instanceof Set ? urls : new Set(urls);
    return state.items.filter(it => set.has(it.url)).map(snapshot);
};

/**
 * Add entries (dual-state: `{ id, url, title }`, ts defaults to now).
 * URL-deduped: an existing URL is never duplicated and its `group` is never
 * touched by a resend (§1.1 — sending must not overwrite user organization).
 * `opts.defaultGroup` pre-assigns NEW items (folder / tab-group sends).
 * Returns `{ full, added, dupes }` — `full: true` means the whole batch was
 * rejected by the 500 cap (never partially applied).
 */
export const add = (state, entries, opts = {}, now = Date.now()) => {
    const defaultGroup = opts.defaultGroup || null;
    const result = { full: false, added: [], dupes: [] };
    if (!Array.isArray(entries) || !entries.length)
        return result;
    // Pass 1 — which entries are actually new (URL uniqueness).
    const fresh = [];
    for (const e of entries) {
        if (!e || !e.url)
            continue;
        if (getByUrl(state, e.url)) {
            result.dupes.push(e.url);
            continue;
        }
        fresh.push(e);
    }
    // Cap check on the batch as a whole (§0.4: no silent truncation).
    if (state.items.length + fresh.length > STAGING_LIMIT) {
        result.full = true;
        return result;
    }
    for (const e of fresh) {
        const item = {
            id: e.id || null,
            url: e.url,
            title: typeof e.title === 'string' ? e.title : '',
            ts: typeof e.ts === 'number' ? e.ts : now,
            group: defaultGroup
        };
        state.items.push(item);
        result.added.push(item);
    }
    return result;
};

// The only exits besides move-home/delete (§3.3): explicit removal. Returns
// the removed snapshots so undo.toastAction can re-add them verbatim.
export const removeByUrls = (state, urls) => {
    const set = urls instanceof Set ? urls : new Set(urls);
    const removed = [];
    state.items = state.items.filter(it => {
        if (set.has(it.url)) {
            removed.push(snapshot(it));
            return false;
        }
        return true;
    });
    pruneEmptyGroups(state);
    return removed;
};

export const clearAll = state => {
    const removed = state.items.map(snapshot);
    state.items = [];
    state.groups = [];
    return removed;
};

/**
 * Tree-event pruning / relinking (§0.4/§0.5). `urlIndex` maps url → the
 * first tree node id carrying that url (view-recent builds it from the
 * tree snapshot / incremental searches). For every item:
 *   - id non-null and the index still maps its url to that id → healthy;
 *   - id non-null but stale → RELINK to the index id if the url survives,
 *     else fall back to id=null (item stays, becomes unbookmarked);
 *   - id null and the url just appeared in the tree → auto-promote to
 *     bookmarked (history row got bookmarked elsewhere — workbench and
 *     tree stay consistent).
 * `extraIds` (optional, Set of ids still valid in the tree) lets callers
 * pass a fresh id→valid map so a moved-but-alive anchor is not mistaken
 * for a dead one.
 * Returns `{ changed, linked, dropped }` counts for the badge/refresh path.
 */
export const relink = (state, urlIndex, extraIds = null) => {
    const res = { changed: 0, linked: 0, dropped: 0 };
    for (const it of state.items) {
        const treeId = urlIndex.get ? urlIndex.get(it.url) : urlIndex[it.url];
        if (it.id !== null && it.id !== undefined) {
            if (extraIds && extraIds.has(it.id))
                continue; // anchor alive (e.g. only moved)
            if (treeId === it.id)
                continue; // still the first same-url node — healthy
            if (treeId) {
                it.id = treeId; // another same-url node took over
                res.changed++; res.linked++;
            } else {
                it.id = null; // url gone from the tree — fall back, keep the item
                res.changed++; res.dropped++;
            }
        } else if (treeId) {
            it.id = treeId; // unbookmarked item just got bookmarked elsewhere
            res.changed++; res.linked++;
        }
    }
    return res;
};

// chrome.bookmarks.onChanged — keep the snapshot in step with the tree node
// (title/url edits). Returns true when something actually changed.
export const updateSnapshot = (state, id, changes = {}) => {
    let changed = false;
    for (const it of state.items) {
        if (it.id !== id)
            continue;
        if (changes.title !== undefined && it.title !== changes.title) {
            it.title = changes.title;
            changed = true;
        }
        if (changes.url !== undefined && it.url !== changes.url) {
            it.url = changes.url;
            changed = true;
        }
    }
    return changed;
};

// --- Favorite state transitions (real tree ops done by the actions layer;
// the model only records the outcome) -------------------------------

// Bookmark created (quickAddFolderId or a picked folder): anchor the id.
export const setFav = (state, url, id) => {
    const it = getByUrl(state, url);
    if (!it)
        return false;
    it.id = id;
    return true;
};

// Un-bookmarked: the item STAYS (falls back to the unbookmarked state —
// the workbench never loses what you were organizing; §3.4).
export const setUnfavById = (state, id) => {
    for (const it of state.items) {
        if (it.id === id) {
            it.id = null;
            return true;
        }
    }
    return false;
};

// --- Groups -----------------------------------------------------------

export const findGroup = (state, groupId) =>
    state.groups.find(g => g.id === groupId) || null;

export const findGroupBySource = (state, source) => {
    if (source.sourceFolderId !== undefined && source.sourceFolderId !== null)
        return state.groups.find(g => g.sourceFolderId === source.sourceFolderId) || null;
    if (source.sourceTabGroup !== undefined && source.sourceTabGroup !== null)
        return state.groups.find(g => g.sourceTabGroup === source.sourceTabGroup) || null;
    return null;
};

export const createGroup = (state, name, source = {}, now = Date.now()) => {
    const group = {
        id: newGroupId(),
        name: name || '',
        collapsed: false,
        createdAt: now,
        sourceFolderId: source.sourceFolderId || null,
        sourceTabGroup: source.sourceTabGroup || null,
        manual: !!source.manual
    };
    state.groups.push(group);
    // createdAt ascending render order (§3.4): freshly created groups sort
    // last among equal timestamps — stable sort keeps insertion order.
    state.groups.sort((a, b) => a.createdAt - b.createdAt);
    return group;
};

export const renameGroup = (state, groupId, name) => {
    const g = findGroup(state, groupId);
    if (!g)
        return false;
    g.name = name;
    return true;
};

// Dissolve: members drop to ungrouped (unbookmarked ones return to the
// inbox bucket, bookmarked ones to the loose rows). A dissolved
// sourceFolderId/sourceTabGroup group forgets its source — resending that
// folder/tab-group creates a fresh group next time (§3.5).
export const dissolveGroup = (state, groupId) => {
    const idx = state.groups.findIndex(g => g.id === groupId);
    if (idx < 0)
        return false;
    state.groups.splice(idx, 1);
    for (const it of state.items) {
        if (it.group === groupId)
            it.group = null;
    }
    return true;
};

// Delete (vs dissolve): the group AND its member items leave the staging
// area together — the explicit "this whole pile is done" exit. Returns the
// removal receipt (group snapshot + member snapshots) so the actions layer
// can offer undo; null when the group does not exist.
export const deleteGroup = (state, groupId) => {
    const idx = state.groups.findIndex(g => g.id === groupId);
    if (idx < 0)
        return null;
    const [group] = state.groups.splice(idx, 1);
    const removed = [];
    state.items = state.items.filter(it => {
        if (it.group === groupId) {
            removed.push(snapshot(it));
            return false;
        }
        return true;
    });
    return { group: { ...group }, removed };
};

// Undo counterpart of deleteGroup: restore the group (same id, so member
// snapshots reattach) then re-add the member items verbatim.
export const restoreGroup = (state, receipt) => {
    if (!receipt || !receipt.group || !Array.isArray(receipt.removed))
        return false;
    if (!findGroup(state, receipt.group.id))
        state.groups.push({ ...receipt.group });
    state.groups.sort((a, b) => a.createdAt - b.createdAt);
    for (const snap of receipt.removed)
        if (!getByUrl(state, snap.url))
            state.items.push({ ...snap, group: receipt.group.id });
    return true;
};

// Drag-reorder (the workbench's manual arrangement): move `draggedId` to sit
// BEFORE `targetId` in the render order. Render order is the array order
// (kept sorted by createdAt), so the move rewrites the createdAt sequence to
// stay monotonic — the invariant createGroup's sort relies on. A move onto
// its own successor is a no-op; returns true when the order changed.
export const reorderGroups = (state, draggedId, targetId) => {
    if (!draggedId || !targetId || draggedId === targetId)
        return false;
    const from = state.groups.findIndex(g => g.id === draggedId);
    const to = state.groups.findIndex(g => g.id === targetId);
    if (from < 0 || to < 0)
        return false;
    if (to === from + 1)
        return false; // already sits immediately before the target
    const [moved] = state.groups.splice(from, 1);
    const insertAt = state.groups.findIndex(g => g.id === targetId);
    if (insertAt < 0) {
        state.groups.splice(from, 0, moved); // target vanished mid-drag — abort
        return false;
    }
    state.groups.splice(insertAt, 0, moved);
    // Rebase createdAt ascending so createGroup's sort + future inserts keep
    // the same visual order (second-resolution stamps are plenty here).
    const base = Math.min(Date.now(), ...state.groups.map(g => g.createdAt || 0));
    state.groups.forEach((g, i) => { g.createdAt = base + i * 1000; });
    return true;
};

// Groups whose members are all gone dissolve automatically (§0.4) — EXCEPT
// user-created (`manual`) groups: an empty group the user built to drag
// things into is a workspace, not a leftover.
export const pruneEmptyGroups = state => {
    const populated = new Set(state.items.map(it => it.group).filter(Boolean));
    state.groups = state.groups.filter(g => populated.has(g.id) || g.manual);
};

export const assignGroup = (state, urls, groupId) => {
    const set = urls instanceof Set ? urls : new Set(urls);
    for (const it of state.items) {
        if (set.has(it.url))
            it.group = groupId;
    }
    if (!groupId)
        pruneEmptyGroups(state);
};

export const setGroupCollapsed = (state, groupId, collapsed) => {
    const g = findGroup(state, groupId);
    if (!g)
        return false;
    g.collapsed = !!collapsed;
    return true;
};

// --- Rendering-partition derivations ----------------------------------

// The unbookmarked inbox bucket (§3.4 iteration C): items with no id AND no
// group — the "not yet homed" progress bar of the workbench.
export const unfavBucketItems = state =>
    state.items.filter(it => it.id === null && it.group === null);

// "new N" — ungrouped inbox arrivals since the last visit (lastSeenTs
// updates on every view activation).
export const newCount = state =>
    state.items.filter(it => it.id === null && it.group === null && it.ts > state.lastSeenTs).length;

export const markSeen = (state, now = Date.now()) => {
    state.lastSeenTs = now;
};

export const groupItems = (state, groupId) =>
    state.items.filter(it => it.group === groupId);

// Bookmarked loose rows (render slot ③, §3.4): id set, no group.
export const looseItems = state =>
    state.items.filter(it => it.id !== null && it.group === null);

export const setRecentCollapsed = (state, collapsed) => {
    state.recentCollapsed = !!collapsed;
};

export const setUnfavCollapsed = (state, collapsed) => {
    state.unfavCollapsed = !!collapsed;
};
