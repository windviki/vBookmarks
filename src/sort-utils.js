/**
 * vBookmarks folder sorting (Phase 3, issue #33) — pure helpers to order the
 * children of a bookmark folder.
 *
 * Classic script loaded by popup.html before neat.js; exposes window.VBMSort.
 *
 * sortNodes(nodes, { by, foldersFirst, recursive }):
 *   - nodes: BookmarkTreeNode array (folders have no `url`).
 *   - by: 'title' (locale-aware, numeric, case-insensitive) or 'dateAdded'
 *     (newest first).
 *   - foldersFirst: true keeps folders ahead of bookmarks, each group sorted
 *     on its own; false interleaves everything in one sorted list.
 *   - recursive: true also sorts every descendant level and returns a deep
 *     copy of the ordered tree; false returns a new flat array sharing the
 *     original node objects.
 *   The input array is never mutated.
 *
 * snapshotOrder / planSortMoves / planUndoMoves / createSortLock are the
 * pure planning half of the sort executor (full-hierarchy pre-sort snapshot,
 * per-level move plans, re-entrancy lock) — see the section at the bottom.
 */
(window => {
    // undefined locale = user's browser locale; numeric so "item 2" < "item 10";
    // base sensitivity so case and accents don't affect ordering.
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

    const isFolder = node => typeof node.url === 'undefined';

    const compareBy = by => {
        if (by === 'dateAdded') {
            return (a, b) => (b.dateAdded || 0) - (a.dateAdded || 0);
        }
        return (a, b) => collator.compare(a.title || '', b.title || '');
    };

    const sortLevel = (nodes, opts) => {
        const cmp = compareBy(opts.by);
        const copy = nodes.slice();
        let sorted;
        if (opts.foldersFirst) {
            const folders = copy.filter(isFolder).sort(cmp);
            const bookmarks = copy.filter(node => !isFolder(node)).sort(cmp);
            sorted = folders.concat(bookmarks);
        } else {
            sorted = copy.sort(cmp);
        }
        if (opts.recursive) {
            sorted = sorted.map(node => {
                if (isFolder(node) && node.children && node.children.length) {
                    const nodeCopy = Object.assign({}, node);
                    nodeCopy.children = sortLevel(node.children, opts);
                    return nodeCopy;
                }
                return node;
            });
        }
        return sorted;
    };

    const sortNodes = (nodes, options) => {
        if (!Array.isArray(nodes))
            return [];
        const opts = Object.assign({
            by: 'title',
            foldersFirst: true,
            recursive: false
        }, options);
        return sortLevel(nodes, opts);
    };

    // Parse the persisted sortOptions JSON ({by, foldersFirst, recursive});
    // missing segments fall back to the defaults, corrupted JSON too. Shared
    // by the popup sort dialog (src/dialogs.js), the direct sort menu items
    // and the options page Sorting group — one source of truth.
    const parseSortOptions = raw => {
        const defaults = { by: 'title', foldersFirst: true, recursive: false };
        if (!raw)
            return { ...defaults };
        try {
            const parsed = JSON.parse(raw);
            return {
                by: parsed.by === 'dateAdded' ? 'dateAdded' : 'title',
                foldersFirst: parsed.foldersFirst !== false,
                recursive: parsed.recursive === true
            };
        } catch (e) {
            return { ...defaults };
        }
    };

    // --- Sort execution planning (review 05-S1/S2) --------------------------
    // All pure — neat.js keeps only the serial chrome.bookmarks.move chain.

    // Full-hierarchy snapshot of a folder subtree's child order: a Map of
    // parentId → [childIds in current order], one entry per level that has
    // children, the root level first. Captured BEFORE the sort so Undo can
    // replay every level the sort rewrote — the old top-level-only snapshot
    // left recursive sorts half-undone (subfolders stayed sorted). A Map,
    // not a plain object: bookmark ids are numeric strings, and integer-like
    // object keys iterate in numeric order rather than insertion order, which
    // would put a subfolder ahead of the root level.
    const snapshotOrder = (rootId, children) => {
        const map = new Map();
        if (Array.isArray(children) && children.length)
            map.set(rootId, children.map(n => n.id));
        const walk = list => {
            for (const node of list || []) {
                if (node && node.children && node.children.length) {
                    map.set(node.id, node.children.map(c => c.id));
                    walk(node.children);
                }
            }
        };
        walk(children);
        return map;
    };

    // Move plan for a sort: the ordered tree from sortNodes() flattened to
    // one id sequence per level, top first. A non-recursive sort touches
    // only the top level — deeper levels are already in their final order.
    const planSortMoves = (sortedNodes, recursive) => {
        if (!Array.isArray(sortedNodes))
            return [];
        const levels = [sortedNodes.map(n => n.id)];
        if (recursive) {
            const walk = list => {
                for (const node of list) {
                    if (node && node.children && node.children.length) {
                        levels.push(node.children.map(c => c.id));
                        walk(node.children);
                    }
                }
            };
            walk(sortedNodes);
        }
        return levels;
    };

    // Move plan for Undo: replay the snapshot levels — every level for a
    // recursive sort, only the top one otherwise (the sort never touched
    // the rest, so replaying them would be pure move/sync noise).
    const planUndoMoves = (snapshot, recursive) => {
        if (!snapshot || typeof snapshot.values !== 'function')
            return [];
        const levels = [...snapshot.values()];
        return recursive ? levels : levels.slice(0, 1);
    };

    // Re-entrancy lock (review 05-S2): a sort is a serial move chain that
    // takes seconds on a big tree; a second trigger mid-chain interleaves
    // both move streams into neither order. neat.js wraps its executor with
    // acquire/release and refuses while held — the menu items and the sort
    // dialog share that one executor, so one lock covers both entries.
    const createSortLock = () => {
        let held = false;
        return {
            acquire: () => {
                if (held)
                    return false;
                held = true;
                return true;
            },
            release: () => { held = false; },
            isHeld: () => held
        };
    };

    window.VBMSort = {
        sortNodes: sortNodes,
        parseSortOptions: parseSortOptions,
        snapshotOrder: snapshotOrder,
        planSortMoves: planSortMoves,
        planUndoMoves: planUndoMoves,
        createSortLock: createSortLock
    };
})(window);
