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
