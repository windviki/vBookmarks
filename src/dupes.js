/**
 * Duplicate-bookmark detection (P3.1) — pure logic, no chrome / DOM access,
 * so vitest exercises it directly in node.
 *
 * normalizeUrl canonicalizes a bookmark URL for grouping: http(s) URLs get
 * scheme+host lowercased, the hash dropped, tracking parameters (utm_*,
 * fbclid, gclid) removed (every other parameter kept, in original order),
 * the default port dropped, and the root path's trailing slash removed
 * ('https://a.com/' ≡ 'https://a.com'; '/a/' is kept — over-merging real
 * paths is worse than missing a dupe). Anything else (javascript:, chrome:,
 * data:, about:, unparseable garbage) is returned verbatim, which degrades
 * grouping to exact-match on the raw string.
 *
 * findDupes groups a flat bookmark list by normalized URL and returns only
 * the colliding groups, oldest-first inside (the keep candidate) and
 * largest-first outside. planDeletion(group) is the keep-oldest policy:
 * everything but the first item.
 */

const TRACKING_PARAM = /^(utm_.*|fbclid|gclid)$/i;

export const normalizeUrl = url => {
    let u;
    try {
        u = new URL(url);
    } catch (e) {
        return url;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:')
        return url;
    u.hash = '';
    // URLSearchParams keeps insertion order across delete(): rebuild the
    // query without the tracking params, leaving the rest untouched.
    const kept = [];
    for (const pair of u.searchParams) {
        if (!TRACKING_PARAM.test(pair[0]))
            kept.push(pair);
    }
    u.search = kept.length ? `?${new URLSearchParams(kept)}` : '';
    // Scheme/host lowercase + default-port drop come free from the URL
    // parser; strip the root path's lone slash on top of that.
    return u.href.replace(/^([a-z]+:\/\/[^/?#]+)\/(?=\?|$)/, '$1');
};

export const findDupes = bookmarks => {
    const byKey = new Map();
    for (const b of bookmarks) {
        if (!b || !b.url)
            continue;
        const key = normalizeUrl(b.url);
        if (!byKey.has(key))
            byKey.set(key, []);
        byKey.get(key).push(b);
    }
    const groups = [];
    for (const [key, items] of byKey) {
        if (items.length < 2)
            continue;
        items.sort((a, b) => (a.dateAdded || 0) - (b.dateAdded || 0));
        groups.push({ key, title: items[0].title || '', items });
    }
    groups.sort((a, b) =>
        b.items.length - a.items.length || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return groups;
};

export const planDeletion = group => group.items.slice(1);

/**
 * pickKeeper — select which bookmark to keep from a duplicate group.
 *
 * @param {Array} group - group.items array (sorted oldest-first by dateAdded)
 * @param {string} strategy - one of: keep-oldest, keep-newest, keep-bookmark-bar,
 *        keep-shortest-title, keep-shallowest, keep-most-visited
 * @param {object} ctx - { parentPathMap, visitStats, bookmarkBarIds }
 * @returns {object} the keeper item
 */
export const pickKeeper = (group, strategy, ctx = {}) => {
    if (!group || !group.length) return null;
    if (group.length === 1) return group[0];

    const items = [...group]; // don't mutate input

    switch (strategy) {
        case 'keep-newest':
            items.sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
            return items[0];

        case 'keep-bookmark-bar': {
            // Prefer items whose parent is in the bookmark bar subtree
            const barIds = ctx.bookmarkBarIds || new Set();
            const inBar = items.filter(b => barIds.has(b.parentId));
            if (inBar.length) {
                inBar.sort((a, b) => (a.dateAdded || 0) - (b.dateAdded || 0));
                return inBar[0];
            }
            // Fallback: oldest
            items.sort((a, b) => (a.dateAdded || 0) - (b.dateAdded || 0));
            return items[0];
        }

        case 'keep-shortest-title':
            items.sort((a, b) => {
                const la = (a.title || '').length;
                const lb = (b.title || '').length;
                if (la !== lb) return la - lb;
                return (a.dateAdded || 0) - (b.dateAdded || 0);
            });
            return items[0];

        case 'keep-shallowest': {
            // Shallowest parent path depth
            const pathMap = ctx.parentPathMap || {};
            const depth = (b) => {
                // Count parents by walking up parentPathMap
                let d = 0;
                let pid = b.parentId;
                while (pid && pathMap[pid]) {
                    d++;
                    pid = pathMap[pid];
                }
                return d;
            };
            items.sort((a, b) => {
                const da = depth(a);
                const db = depth(b);
                if (da !== db) return da - db;
                return (a.dateAdded || 0) - (b.dateAdded || 0);
            });
            return items[0];
        }

        case 'keep-most-visited': {
            const stats = ctx.visitStats || {};
            items.sort((a, b) => {
                const ca = (stats[a.id] && stats[a.id].c) || 0;
                const cb = (stats[b.id] && stats[b.id].c) || 0;
                if (ca !== cb) return cb - ca; // highest count first
                return (a.dateAdded || 0) - (b.dateAdded || 0);
            });
            return items[0];
        }

        case 'keep-oldest':
        default:
            items.sort((a, b) => (a.dateAdded || 0) - (b.dateAdded || 0));
            return items[0];
    }
};
