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
