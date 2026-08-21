/**
 * Favicon gallery data assembly (pages/favicons.html).
 *
 * The gallery is the display-only window onto the favicon-enrichment cache
 * (src/favicon-enrich.js): which hosts got their real icon back, where each
 * icon came from (direct fetch / the user's proxy relay / a third-party
 * provider — recorded as `src` on the index entry since 4.0.8), and which
 * bookmarks live on each host (path, dead mark, sync status, visit count).
 *
 * Pure ESM with zero chrome/DOM references — vitest drives it directly.
 * Rendering stays in src/favicons.js; this module owns the data shape.
 */

import { parseIdx, AGG_PROVIDERS } from './favicon-enrich.js';
import { buildPathMap } from './tree-render.js';

// Provider display names are brand names — no i18n. Keyed by provider id so a
// renamed built-in list stays honest here.
export const PROVIDER_LABELS = Object.fromEntries(AGG_PROVIDERS.map(p => [
    p.id,
    p.id === 'favicon-run' ? 'favicon.run' : p.id === 'icon-horse' ? 'icon.horse' : 'DuckDuckGo'
]));

export const hostOfUrl = url => {
    try {
        return new URL(url).host || null;
    } catch (_) {
        return null;
    }
};

/**
 * Classify a recorded source into a badge kind: 'direct' (L1/L2 fetch from
 * the site itself), 'proxy' (L3 marker-PAC relay), 'agg' (an L4 provider id —
 * known ones plus forward-compat unknown ids), or 'legacy' (cached before the
 * source field existed).
 */
export const sourceKind = src => {
    if (src === 'direct')
        return 'direct';
    if (src === 'proxy')
        return 'proxy';
    if (!src)
        return 'legacy';
    return 'agg';
};

// Chip/badge text for a source value. `_m` injected so the module stays pure.
export const sourceLabel = (src, _m) => {
    const kind = sourceKind(src);
    if (kind === 'direct')
        return _m('favSrcDirect');
    if (kind === 'proxy')
        return _m('favSrcProxy');
    if (kind === 'legacy')
        return _m('favSrcLegacy');
    return PROVIDER_LABELS[src] || src;
};

export const fmtBytes = n => {
    if (!Number.isFinite(n) || n < 0)
        return '0 B';
    if (n < 1024)
        return `${n} B`;
    if (n < 1024 * 1024)
        return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

const safeParse = (raw, fallback) => {
    try {
        const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return v ?? fallback;
    } catch (_) {
        return fallback;
    }
};

const byPathThenTitle = (a, b) => {
    const p = a.path.localeCompare(b.path);
    if (p)
        return p;
    return (a.title || a.url).localeCompare(b.title || b.url);
};

/**
 * Build the gallery model.
 *   idxRaw        — the vbmFaviconIdx value (JSON string or parsed object)
 *   dataByHost    — { host: dataUrl } from the vbmFavicon:<host> keys
 *   tree          — chrome.bookmarks.getTree() result
 *   deadMarks     — id array (or its JSON string)
 *   deadMarkTimes — { id: ms } (or its JSON string)
 *   syncStatus    — the vbmSyncStatus session blob { id: { indicator } }
 *   visitStats    — { id: { c, t } }
 * Returns {
 *   cards:  [{ host, dataUrl, ts, bytes, source, kind, bookmarks: [...] }]
 *          (ts desc; a card with no surviving bookmark still renders, marked
 *          `orphan`, so the cache stays explainable after deletions),
 *   failed: [{ host, ts }] (24h failed markers, ts desc),
 *   totals: { sites, bookmarks, bytes, byKind: { direct, proxy, agg, legacy } }
 * }
 */
export const buildGallery = ({ idxRaw, dataByHost = {}, tree = [],
    deadMarks = [], deadMarkTimes = {}, syncStatus = {}, visitStats = {} } = {}) => {
    const idx = typeof idxRaw === 'string' ? parseIdx(idxRaw) : idxRaw;
    const hosts = (idx && idx.hosts) || {};
    const pathMap = buildPathMap(tree);
    const markSet = new Set(safeParse(deadMarks, []));
    const markTimes = safeParse(deadMarkTimes, {});

    // host → bookmarks living on it (walk the tree once).
    const byHost = new Map();
    const walk = nodes => {
        if (!nodes)
            return;
        for (const node of nodes) {
            if (node.url) {
                const host = hostOfUrl(node.url);
                if (host) {
                    const sync = syncStatus[node.id];
                    const visit = visitStats[node.id];
                    const bm = {
                        id: node.id,
                        title: node.title || '',
                        url: node.url,
                        path: pathMap[node.id] || '',
                        dead: markSet.has(node.id),
                        deadTs: markTimes[node.id] || 0,
                        sync: sync && sync.indicator ? sync.indicator : '',
                        visits: visit && Number.isFinite(visit.c) ? visit.c : 0
                    };
                    if (!byHost.has(host))
                        byHost.set(host, []);
                    byHost.get(host).push(bm);
                }
            }
            if (node.children)
                walk(node.children);
        }
    };
    walk(tree);

    const cards = [];
    const failed = [];
    for (const [host, meta] of Object.entries(hosts)) {
        if (!meta || typeof meta !== 'object')
            continue;
        if (meta.f) {
            failed.push({ host, ts: meta.t || 0 });
            continue;
        }
        const dataUrl = dataByHost[host];
        // Index says success but the data key is gone — hydrate's own
        // reconcile drops these; never render a broken <img>.
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/'))
            continue;
        const bookmarks = (byHost.get(host) || []).slice().sort(byPathThenTitle);
        cards.push({
            host,
            dataUrl,
            ts: meta.t || 0,
            bytes: meta.s || dataUrl.length,
            source: meta.src || '',
            kind: sourceKind(meta.src || ''),
            orphan: bookmarks.length === 0,
            bookmarks
        });
    }
    // Data keys the index does not (yet) list: the enricher's hydrate re-adds
    // them to the index on its next run, so the gallery mirrors that self-heal
    // instead of hiding a cached icon — they render as legacy cards with no
    // fetch time (an index rewritten by a concurrently open popup's enricher
    // can otherwise make freshly seeded/cached hosts vanish here).
    for (const [host, dataUrl] of Object.entries(dataByHost)) {
        if (hosts[host] || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/'))
            continue;
        const bookmarks = (byHost.get(host) || []).slice().sort(byPathThenTitle);
        cards.push({
            host,
            dataUrl,
            ts: 0,
            bytes: dataUrl.length,
            source: '',
            kind: 'legacy',
            orphan: bookmarks.length === 0,
            bookmarks
        });
    }
    cards.sort((a, b) => b.ts - a.ts);
    failed.sort((a, b) => b.ts - a.ts);

    const byKind = { direct: 0, proxy: 0, agg: 0, legacy: 0 };
    let bytes = 0;
    let bookmarks = 0;
    for (const card of cards) {
        byKind[card.kind]++;
        bytes += card.bytes;
        bookmarks += card.bookmarks.length;
    }
    return { cards, failed, totals: { sites: cards.length, bookmarks, bytes, byKind } };
};

/**
 * Filter cards by a source chip ('all', a kind, or a concrete provider id)
 * and a free-text query matched against host, bookmark titles, urls and
 * paths. Returns { cards, bookmarks } — the visible cards plus how many
 * bookmark rows survived the query (a card whose own host matched keeps all
 * its bookmarks; a bookmark-only match trims the list to the matches).
 */
export const filterCards = (cards, { query = '', source = 'all' } = {}) => {
    const q = String(query || '').trim().toLowerCase();
    const bySource = card => {
        if (source === 'all')
            return true;
        if (source === 'direct' || source === 'proxy' || source === 'agg' || source === 'legacy')
            return card.kind === source;
        return card.source === source; // a concrete provider id
    };
    const out = [];
    let bookmarkCount = 0;
    for (const card of cards) {
        if (!bySource(card))
            continue;
        if (!q) {
            out.push(card);
            bookmarkCount += card.bookmarks.length;
            continue;
        }
        const hostHit = card.host.toLowerCase().includes(q);
        const bms = hostHit
            ? card.bookmarks
            : card.bookmarks.filter(b =>
                b.title.toLowerCase().includes(q)
                || b.url.toLowerCase().includes(q)
                || b.path.toLowerCase().includes(q));
        if (hostHit || bms.length) {
            out.push(bms === card.bookmarks ? card : { ...card, bookmarks: bms });
            bookmarkCount += bms.length;
        }
    }
    return { cards: out, bookmarks: bookmarkCount };
};

/**
 * Source chips to offer, derived from what the cache actually holds:
 * 'all' first, then direct/proxy/agg kinds in chain order, then any concrete
 * provider ids (so "which provider" is literally clickable), legacy last.
 * Each chip: { id, count }.
 */
export const sourceChips = cards => {
    const counts = new Map();
    for (const card of cards) {
        const key = card.kind === 'agg' ? card.source : card.kind;
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    const order = ['direct', 'proxy', ...AGG_PROVIDERS.map(p => p.id), 'legacy'];
    const chips = [{ id: 'all', count: cards.length }];
    for (const id of order)
        if (counts.has(id))
            chips.push({ id, count: counts.get(id) });
    return chips;
};
