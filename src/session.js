/**
 * Session save (P3.2) — "save every tab of the current window into one new
 * bookmark folder", the OneTab core flow. The pure helpers (folder-name
 * composition, tab→bookmark conversion) run straight in node under vitest;
 * only saveSession touches chrome.bookmarks, which tests stub.
 *
 * sessionFolderName(date, template) formats `date` as 'YYYY-MM-DD HH:mm'
 * (local time) and substitutes the i18n template's $date$ placeholder with
 * it. The template comes from chrome.i18n.getMessage('sessionFolderName')
 * fetched WITHOUT substitutions, so the raw $date$ arrives intact; should a
 * template ever lose the placeholder (locale slip or a getMessage build that
 * pre-expands named placeholders), the stamp is appended rather than dropped.
 *
 * tabsToBookmarks(tabs) maps chrome.tabs.Tab objects to {title, url} pairs:
 * only bookmarkable schemes survive — a case-insensitive ^(https?|ftp|file):
 * whitelist (sync-manager.js's prefix blacklist was not reused: it guards
 * syncability, not bookmarkability, and drops file: tabs that bookmark just
 * fine; the whitelist also covers view-source:/chrome-search:/data: and any
 * future scheme in one shot). An empty title falls back to the URL, and
 * duplicate URLs inside the same window are deduplicated keeping the first
 * occurrence (OneTab behavior).
 *
 * saveSession({ rootFolderId, folderName, tabs }) creates the folder under
 * rootFolderId, then creates one bookmark per entry STRICTLY SEQUENTIALLY —
 * a promise chain over callback-style chrome.bookmarks.create, the same
 * idiom palette.js's removeSequentially uses — so the backend applies them
 * in tab order. Resolves { folderId, count } with count = entries actually
 * created; an empty list resolves { folderId: null, count: 0 } without
 * creating a folder (the caller owns the empty-state messaging).
 */

const BOOKMARKABLE_URL = /^(https?|ftp|file):/i;

const pad2 = n => String(n).padStart(2, '0');

export const sessionFolderName = (date, template) => {
    const stamp = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    return template.includes('$date$')
        ? template.replace('$date$', stamp)
        : `${template} ${stamp}`;
};

export const tabsToBookmarks = tabs => {
    const seen = new Set();
    const bookmarks = [];
    for (const tab of tabs || []) {
        const url = tab && tab.url ? tab.url : '';
        if (!BOOKMARKABLE_URL.test(url) || seen.has(url))
            continue;
        seen.add(url);
        bookmarks.push({ title: tab.title || url, url });
    }
    return bookmarks;
};

const createNode = props =>
    new Promise(resolve => chrome.bookmarks.create(props, resolve));

export const saveSession = ({ rootFolderId, folderName, tabs }) => {
    if (!tabs || !tabs.length)
        return Promise.resolve({ folderId: null, count: 0 });
    return createNode({ parentId: rootFolderId, title: folderName })
        .then(folder => {
            const folderId = folder.id;
            return tabs
                .reduce((chain, tab) => chain.then(() =>
                    createNode({ parentId: folderId, title: tab.title, url: tab.url })),
                    Promise.resolve())
                .then(() => ({ folderId, count: tabs.length }));
        });
};
