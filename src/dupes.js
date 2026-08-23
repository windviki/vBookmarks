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
 * largest-first outside. opts.ignoreScheme (v4 task-2 §5.6c) folds http/
 * https variants into one group. pickKeeper(group, strategy, ctx) applies
 * the six keeper strategies of §5.6b; planDeletion(group, keeper) is the
 * deletion candidate set — everything but the keeper (no keeper = the
 * legacy keep-oldest slice).
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

export const findDupes = (bookmarks, opts = {}) => {
    const byKey = new Map();
    // normalizeUrl memo over the raw string: duplicate copies share the
    // exact same URL text (the dedup workload is duplicates by definition),
    // and URL parsing is findDupes's dominant cost (measured ~70 ms of a
    // 6000-bookmark regroup). First occurrence parses, the rest hit the map.
    const normCache = new Map();
    for (const b of bookmarks) {
        if (!b || !b.url)
            continue;
        let key = normCache.get(b.url);
        if (key === undefined) {
            key = normalizeUrl(b.url);
            normCache.set(b.url, key);
        }
        // v4 task-2 §5.6c: dupesIgnoreScheme treats http/https variants of
        // the same address as one group (scheme upgrades are a real dupe
        // source; off by default — a few sites serve different content per
        // scheme, so merging is the user's explicit choice).
        if (opts.ignoreScheme)
            key = key.replace(/^https?:\/\//i, '//');
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

// v4 task-2 §5.6b: the keeper strategies. group.items arrive oldest-first
// (findDupes sorts them), so "oldest" fallbacks are simply the first item.
// pickKeeper returns the one item to KEEP; everything else is the deletion
// candidate set. ctx supplies the view-side data the strategies need:
//   ctx.inBar(id)        — the bookmark sits in the bookmarks-bar subtree
//   ctx.depthOf(id)      — parent-folder depth (shallowest strategy)
//   ctx.visitCountOf(id) — recorded visit count (most-visited; absent data
//                          reads as 0, which falls back to oldest)
export const pickKeeper = (group, strategy, ctx = {}) => {
    const items = (group && group.items) || [];
    if (!items.length)
        return null;
    const oldest = items[0];
    switch (strategy) {
        case 'keep-newest':
            return items[items.length - 1];
        case 'keep-bookmark-bar': {
            const inBar = ctx.inBar || (() => false);
            return items.find(item => inBar(item.id)) || oldest; // first = oldest
        }
        case 'keep-shortest-title':
            return items.reduce((best, item) =>
                (item.title || '').length < (best.title || '').length ? item : best, oldest);
        case 'keep-shallowest': {
            const depthOf = ctx.depthOf || (() => 0);
            return items.reduce((best, item) =>
                depthOf(item.id) < depthOf(best.id) ? item : best, oldest);
        }
        case 'keep-most-visited': {
            const visitCountOf = ctx.visitCountOf || (() => 0);
            return items.reduce((best, item) =>
                (visitCountOf(item.id) | 0) > (visitCountOf(best.id) | 0) ? item : best, oldest);
        }
        case 'keep-oldest':
        default:
            return oldest;
    }
};

// The deletion plan for one group: everything but the keeper. Called
// without a keeper it keeps the historical keep-oldest behavior (the first
// item), which is what the pre-view palette cleanup did.
export const planDeletion = (group, keeper) => {
    if (!keeper)
        return group.items.slice(1);
    return group.items.filter(item => item !== keeper);
};
