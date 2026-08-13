/**
 * Folder-content sort executor (issue #33): the thin chrome.bookmarks wrapper
 * that physically reorders a folder's children. All planning lives in
 * sort-utils.js (window.VBMSort, pure — loaded by popup.html before neat.js);
 * this module runs the serial chrome.bookmarks.move chain, holds the
 * re-entrancy lock so a second trigger can't interleave its moves, and wires
 * the toast Undo replay (which replays every level a recursive sort touched).
 * Tests drive the real executor with chrome.bookmarks / undo / treeView
 * doubles — see tests/folder-sort.test.js.
 *
 * deps: undo (or undefined — the toast branch is skipped then), treeView
 * (generateTree to rebuild after a sort / an undo replay), _m (i18n).
 */
export const createFolderSorter = ({ undo, treeView, _m }) => {
    const sortLock = window.VBMSort.createSortLock();

    // Move the ids of one level to their target index in ascending order —
    // positions before i are already final, so the parent ends up sorted.
    const moveToIndex = ids => ids.reduce((chain, id, i) =>
        chain.then(() => new Promise(resolve => {
            chrome.bookmarks.move(id, { index: i }, () => {
                void chrome.runtime.lastError; // read per 793e336
                resolve();
            });
        })), Promise.resolve());

    const runLevels = levels => levels.reduce((chain, ids) =>
        chain.then(() => moveToIndex(ids)), Promise.resolve());

    const sortFolderContents = (folderId, opts) => {
        if (!sortLock.acquire())
            return;
        chrome.bookmarks.getSubTree(folderId, nodes => {
            if (!nodes || !nodes.length) {
                sortLock.release();
                return;
            }
            const children = nodes[0].children || [];
            const snapshot = window.VBMSort.snapshotOrder(folderId, children);
            const sorted = window.VBMSort.sortNodes(children, opts);
            runLevels(window.VBMSort.planSortMoves(sorted, !!opts.recursive)).then(() => {
                chrome.bookmarks.getTree(treeView.generateTree);
                // issue #33: toast undo — Undo replays every level the sort
                // touched back to its snapshot order, recursive sorts included.
                // The lock is re-held for the replay so a new sort can't
                // interleave (best-effort acquire: a chain already in flight
                // holds it).
                if (undo && undo.toastAction) {
                    undo.toastAction(_m('sortDone'), _m('undoAction'), () => {
                        sortLock.acquire();
                        runLevels(window.VBMSort.planUndoMoves(snapshot, !!opts.recursive))
                            .then(() => chrome.bookmarks.getTree(treeView.generateTree))
                            .then(() => sortLock.release());
                    });
                }
                sortLock.release();
            });
        });
    };

    return sortFolderContents;
};
