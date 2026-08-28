/**
 * Popup quick-add star (issue #30 + Ctrl/Cmd+D): bookmarks the current tab
 * into quickAddFolderId, or un-bookmarks it when already saved (mirroring
 * Chrome's native star — solid star = already bookmarked, click removes it).
 * Extracted from neat.js so the flow is directly unit-testable; neat.js keeps
 * the `quickAddEnabled` visibility toggle and the button click wiring.
 *
 * deps: store (quickAddFolderId), chrome (tabs.query / bookmarks.search,
 * create, remove, get; runtime.lastError), document + body (the Ctrl/Cmd+D
 * capture listener with its dialog-open guard), the two DOM elements, _m.
 */
export const createQuickAdd = ({ store, document, body, chrome, quickAddBtn, quickAddToast, _m }) => {
    const TOAST_MS = 1800;
    let quickAddToastTimer = null;

    // v4 task-3 #20: quickAddEnabled (default on) hides the star outright.
    if (!store.get('quickAddEnabled', '1'))
        quickAddBtn.classList.add('hidden');

    const showQuickAddToast = (msgKey, sub) => {
        quickAddToast.textContent = _m(msgKey, sub ? [sub] : undefined);
        quickAddToast.classList.add('show');
        clearTimeout(quickAddToastTimer);
        quickAddToastTimer = setTimeout(() => {
            quickAddToast.classList.remove('show');
        }, TOAST_MS);
    };

    const withCurrentTabBookmark = callback => {
        chrome.tabs.query({
            'active': true,
            'windowId': chrome.windows.WINDOW_ID_CURRENT
        }, tabs => {
            const tab = tabs[0];
            if (!tab || !tab.url) {
                callback(null, null);
                return;
            }
            chrome.bookmarks.search({ url: tab.url }, results => {
                callback(tab, (results && results.length) ? results[0] : null);
            });
        });
    };

    const refreshQuickAddState = () => {
        withCurrentTabBookmark((tab, bookmark) => {
            if (bookmark) {
                quickAddBtn.classList.add('starred');
                quickAddBtn.title = _m('quickRemoveBookmark');
            } else {
                quickAddBtn.classList.remove('starred');
                quickAddBtn.title = _m('quickAddBookmark');
            }
        });
    };

    const quickAddCurrentTab = () => {
        withCurrentTabBookmark((tab, bookmark) => {
            if (!tab)
                return;
            if (bookmark) {
                // Already bookmarked: remove it (mirrors Chrome's native star).
                // Track the id we're removing so the star refresh won't re-add it.
                const rmId = bookmark.id;
                chrome.bookmarks.remove(rmId, () => {
                    // The bookmark vanished between the search and this
                    // remove (synced away) — suppress the warning and skip.
                    if (chrome.runtime.lastError)
                        return;
                    quickAddBtn.classList.remove('starred');
                    quickAddBtn.title = _m('quickAddBookmark');
                    showQuickAddToast('quickRemoved');
                });
            } else {
                const parentId = store.get('quickAddFolderId', '1');
                chrome.bookmarks.create({
                    title: tab.title || tab.url,
                    url: tab.url,
                    parentId
                }, () => {
                    // The create failed (e.g. the configured quickAddFolderId
                    // was deleted) — suppress the warning and skip the star
                    // flip + toast: showing "added" feedback for a failed
                    // create would be a false success.
                    if (chrome.runtime.lastError)
                        return;
                    quickAddBtn.classList.add('starred');
                    quickAddBtn.title = _m('quickRemoveBookmark');
                    // Show target folder name for discoverability
                    chrome.bookmarks.get(parentId, nodes => {
                        const folderName = (nodes && nodes.length) ? (nodes[0].title || '') : '';
                        showQuickAddToast('quickAddedTo', folderName);
                    });
                });
            }
        });
    };

    // Ctrl/Cmd+D inside the popup does the same. Capture phase + stopPropagation
    // so the tree's type-ahead never sees the 'd'; skip while a dialog is open.
    const bindQuickAddKey = () => {
        document.addEventListener('keydown', e => {
            if (!(e.metaKey || e.ctrlKey) || (e.key !== 'd' && e.key !== 'D'))
                return;
            if (body.classList.contains('needConfirm') || body.classList.contains('needEdit') ||
                body.classList.contains('needAlert') || body.classList.contains('needInputName') ||
                body.classList.contains('needSort') || body.classList.contains('needTabGroup') ||
                body.classList.contains('needGroupPick') || body.classList.contains('needCopyMove') ||
                body.classList.contains('needFolderPick'))
                return;
            e.preventDefault();
            e.stopPropagation();
            quickAddCurrentTab();
        }, true);
    };

    // G9 (2026-08-26 acceptance audit): the star BUTTON click binding lives
    // here (not in neat.js) so the wiring is module-testable — one click =
    // quickAddCurrentTab, exactly like Ctrl/Cmd+D.
    if (quickAddBtn && typeof quickAddBtn.addEventListener === 'function')
        quickAddBtn.addEventListener('click', quickAddCurrentTab);

    return { showQuickAddToast, withCurrentTabBookmark, refreshQuickAddState, quickAddCurrentTab, bindQuickAddKey };
};
