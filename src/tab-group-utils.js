/**
 * Tab-group shared helpers (P3.4 extracted to a shared module).
 *
 * chrome.tabGroups accepts exactly these nine group colors, and the popup
 * action layer, the new-group dialog and the background tab-group opener all
 * need the same palette + the same deterministic picker. Group titles built
 * from tree-row text also pass through cleanGroupTitle, which drops the
 * localized sync-suffix (e.g. " (Local)" / " （仅本地）") that tree-render.js
 * appends to folder display titles — a group named after a folder must not
 * carry that annotation.
 */

export const TAB_GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

// Deterministic group color for a title: a plain charCode-sum hash modulo
// the palette, so the same folder name always lands on the same color.
export const pickGroupColor = title => {
    let hash = 0;
    for (let i = 0; i < title.length; i++)
        hash += title.charCodeAt(i);
    return TAB_GROUP_COLORS[hash % TAB_GROUP_COLORS.length];
};

// Strips a trailing localized sync suffix (e.g. " (Local)" / " （已同步）")
// off a folder display title, so a tab-group title keeps just the folder
// name. `suffixes` are the chrome.i18n messages the caller resolved
// (syncSuffixLocal / syncSuffixSynced); each is tried once, in order.
export const cleanGroupTitle = (text, suffixes = []) => {
    let t = `${text}`.trim();
    for (const s of suffixes) {
        if (s && t.endsWith(` ${s}`))
            t = t.slice(0, -s.length - 1).trim();
    }
    return t;
};


// --- Tab-group → bookmark-folder metadata (tab-groups view) ---------------
// Chrome does not expose a tab group's creation time or an extension-owned
// metadata slot, so the tab-groups view persists a small JSON map in
// storage.local: folderId → { title, color, savedAt, sourceGroupId }. When
// the user later opens that bookmark folder as a tab group, the folder
// context menu reads the meta back and restores the title/color instead of
// re-deriving them from the folder title.
export const TAB_GROUP_FOLDER_META_KEY = 'tabGroupFolderMeta';

export const readTabGroupFolderMetaMap = store => {
    try {
        return JSON.parse(store.get(TAB_GROUP_FOLDER_META_KEY, '') || '{}');
    } catch (e) {
        return {};
    }
};

export const readTabGroupFolderMeta = (store, folderId) =>
    (readTabGroupFolderMetaMap(store) || {})[`${folderId}`] || null;

export const saveTabGroupFolderMeta = (store, folderId, meta) => {
    const map = readTabGroupFolderMetaMap(store);
    map[`${folderId}`] = { ...(map[`${folderId}`] || {}), ...meta };
    try {
        store.set(TAB_GROUP_FOLDER_META_KEY, JSON.stringify(map));
    } catch (e) { /* best-effort metadata — a storage hiccup must not fail the save */ }
};

export const forgetTabGroupFolderMeta = (store, folderId) => {
    const map = readTabGroupFolderMetaMap(store);
    delete map[`${folderId}`];
    try {
        store.set(TAB_GROUP_FOLDER_META_KEY, JSON.stringify(map));
    } catch (e) { /* best-effort */ }
};

// Drop meta entries whose bookmark folder no longer exists. The tab-groups
// view calls this with the live folder-id set on every tree refresh, so a
// folder deleted anywhere (popup, Chrome's bookmark manager, sync) has its
// meta pruned instead of accumulating forever (the 4.1.0 audit found the
// single-folder forget above had no caller — prune is the catch-all).
export const pruneTabGroupFolderMeta = (store, aliveFolderIds) => {
    const map = readTabGroupFolderMetaMap(store);
    const keep = {};
    let dropped = false;
    for (const id of Object.keys(map)) {
        if (aliveFolderIds && aliveFolderIds.has(id))
            keep[id] = map[id];
        else
            dropped = true;
    }
    if (!dropped)
        return;
    try {
        store.set(TAB_GROUP_FOLDER_META_KEY, JSON.stringify(keep));
    } catch (e) { /* best-effort metadata */ }
};
