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

    window.VBMSort = { sortNodes: sortNodes };
})(window);
