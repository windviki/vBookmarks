/**
 * Folder-picker quick-pick roster logic (velvet staging §4.1) — pure helpers
 * behind the BookmarkFolderPickDialog's chips row.
 *
 * Two LOCAL storage keys (bookmark ids are device-local — see store.js's
 * "deliberately NOT here" note):
 *   folderPickPins    — user-pinned folder ids, USER ORDER (pin operation order)
 *   folderPickRecents — LRU queue of picked targets, cap 6, newest first
 *
 * Both are lazily pruned against the live tree every time the picker opens
 * (a dead id is dropped and the pruned list written back — same hygiene
 * discipline as staging items, no listener needed).
 *
 * Pure data functions only: parse/serialize, LRU record, pin toggle and
 * pruning — the dialog owns the DOM and the store handle.
 */

export const FOLDER_PICK_RECENTS_CAP = 6;

// Tolerant parse of a persisted id list (corruption degrades to []).
export const readIdList = raw => {
    if (!raw)
        return [];
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        return [];
    }
    if (!Array.isArray(parsed))
        return [];
    const out = [];
    for (const id of parsed) {
        if (id !== null && id !== undefined && !out.includes(id))
            out.push(String(id));
    }
    return out;
};

export const writeIdList = list => JSON.stringify(list);

// LRU record: newest first, dedupe by move-to-front, capped.
export const recordRecent = (list, id, cap = FOLDER_PICK_RECENTS_CAP) => {
    if (id === null || id === undefined || id === '')
        return list.slice();
    const key = String(id);
    const next = [key];
    for (const existing of list) {
        if (String(existing) !== key)
            next.push(String(existing));
    }
    return next.slice(0, cap);
};

// Pin toggle: pin appends (user order = pin operation order); unpin filters.
export const togglePin = (list, id) => {
    const key = String(id);
    const has = list.some(x => String(x) === key);
    if (has)
        return list.filter(x => String(x) !== key);
    return list.concat([key]);
};

// Drop ids that no longer exist in the tree (validIds: Set-like). Returns
// `{ list, changed }` so the caller only writes back when something died.
export const pruneIds = (list, validIds) => {
    const has = id => validIds.has ? validIds.has(String(id)) : validIds.includes(String(id));
    const next = list.filter(has);
    return { list: next, changed: next.length !== list.length };
};

// Chips model: pins in user order first, then recents (LRU) that are not
// already pinned — the dialog renders exactly this sequence.
export const chipsModel = (pins, recents) => {
    const pinSet = new Set(pins.map(String));
    const extraRecents = recents.filter(id => !pinSet.has(String(id)));
    return { pins, recents: extraRecents };
};
