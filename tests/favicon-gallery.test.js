import { describe, it, expect } from 'vitest';
import {
    buildGallery,
    filterCards,
    sourceChips,
    sourceKind,
    sourceLabel,
    hostOfUrl,
    fmtBytes,
    PROVIDER_LABELS
} from '../src/favicon-gallery.js';
import { AGG_PROVIDERS } from '../src/favicon-enrich.js';
import { makeI18n } from './helpers/i18n.js';

const _m = makeI18n();

// A bookmark tree: bar with two github bookmarks + a Dev subfolder, Other
// with one example bookmark, plus a bookmarklet (never gallery-relevant).
const TREE = [{
    id: '0', children: [
        {
            id: '1', parentId: '0', title: 'Bookmarks bar', children: [
                { id: '10', parentId: '1', title: 'GitHub', url: 'https://github.com/windviki' },
                { id: '11', parentId: '1', title: '', url: 'https://github.com/other' },
                {
                    id: '5', parentId: '1', title: 'Dev', children: [
                        { id: '12', parentId: '5', title: 'GH Docs', url: 'https://docs.github.com/x' }
                    ]
                },
                { id: '14', parentId: '1', title: 'bmlet', url: 'javascript:void(0)' }
            ]
        },
        {
            id: '2', parentId: '0', title: 'Other bookmarks', children: [
                { id: '13', parentId: '2', title: 'Example', url: 'https://example.com/' }
            ]
        }
    ]
}];

const PNG = 'data:image/png;base64,AAA';

const IDX = {
    v: 3,
    down: { 'favicon-run': 0, 'icon-horse': 0, 'duckduckgo': 0 },
    hosts: {
        'github.com': { t: 1000, s: 500, src: 'direct' },
        'docs.github.com': { t: 2000, s: 300, src: 'duckduckgo' },
        'gone.example': { t: 3000, s: 100, src: 'proxy' },
        'old.example': { t: 500, s: 50 },
        'fail.example': { f: 1, t: 4000 },
        'nodata.example': { t: 600, s: 10, src: 'direct' }
    }
};

const DATA = {
    'github.com': PNG,
    'docs.github.com': PNG,
    'gone.example': PNG,
    'old.example': PNG,
    'bad.example': 'not-an-image-url'
};

const baseArgs = (over = {}) => ({
    idxRaw: JSON.stringify(IDX),
    dataByHost: DATA,
    tree: TREE,
    deadMarks: ['10'],
    deadMarkTimes: { 10: 123456 },
    syncStatus: { 10: { indicator: 'local' }, 13: { indicator: 'synced' } },
    visitStats: { 10: { c: 5, t: 1 } },
    ...over
});

describe('sourceKind / sourceLabel', () => {
    it('classifies the recorded source values', () => {
        expect(sourceKind('direct')).toBe('direct');
        expect(sourceKind('proxy')).toBe('proxy');
        expect(sourceKind('')).toBe('legacy');
        expect(sourceKind(undefined)).toBe('legacy');
        for (const p of AGG_PROVIDERS)
            expect(sourceKind(p.id)).toBe('agg');
        // Forward-compat: an unknown future provider id still reads as agg.
        expect(sourceKind('some-new-provider')).toBe('agg');
    });

    it('labels kinds via i18n and providers by brand name', () => {
        expect(sourceLabel('direct', _m)).toBe('Direct');
        expect(sourceLabel('proxy', _m)).toBe('Proxy');
        expect(sourceLabel('', _m)).toBe('Earlier cache');
        expect(sourceLabel('favicon-run', _m)).toBe('favicon.run');
        expect(sourceLabel('icon-horse', _m)).toBe('icon.horse');
        expect(sourceLabel('duckduckgo', _m)).toBe('DuckDuckGo');
        expect(sourceLabel('some-new-provider', _m)).toBe('some-new-provider');
        // The override table covers exactly the built-in providers.
        expect(Object.keys(PROVIDER_LABELS).sort()).toEqual(AGG_PROVIDERS.map(p => p.id).sort());
    });
});

describe('hostOfUrl / fmtBytes', () => {
    it('extracts hosts and rejects junk', () => {
        expect(hostOfUrl('https://a.b/c?d')).toBe('a.b');
        expect(hostOfUrl('javascript:void(0)')).toBe(null);
        expect(hostOfUrl('not a url')).toBe(null);
    });

    it('formats bytes', () => {
        expect(fmtBytes(0)).toBe('0 B');
        expect(fmtBytes(512)).toBe('512 B');
        expect(fmtBytes(2048)).toBe('2.0 KB');
        expect(fmtBytes(3 * 1024 * 1024)).toBe('3.00 MB');
        expect(fmtBytes(-1)).toBe('0 B');
    });
});

describe('buildGallery', () => {
    it('builds cards sorted by fetch time desc, skipping dead data keys', () => {
        const { cards } = buildGallery(baseArgs());
        expect(cards.map(c => c.host)).toEqual([
            'gone.example', 'docs.github.com', 'github.com', 'old.example'
        ]);
        // nodata.example: index success but no data key → skipped.
        expect(cards.some(c => c.host === 'nodata.example')).toBe(false);
    });

    it('collects the failed markers separately, newest first', () => {
        const { failed } = buildGallery(baseArgs());
        expect(failed).toEqual([{ host: 'fail.example', ts: 4000 }]);
    });

    it('joins bookmarks by host with path, marks, sync and visits', () => {
        const { cards } = buildGallery(baseArgs());
        const gh = cards.find(c => c.host === 'github.com');
        expect(gh.kind).toBe('direct');
        expect(gh.orphan).toBe(false);
        expect(gh.bookmarks.map(b => b.id)).toEqual(['10', '11']); // path tie → title order
        const ten = gh.bookmarks[0];
        expect(ten.path).toBe('Bookmarks bar');
        expect(ten.dead).toBe(true);
        expect(ten.deadTs).toBe(123456);
        expect(ten.sync).toBe('local');
        expect(ten.visits).toBe(5);
        const eleven = gh.bookmarks[1];
        expect(eleven.dead).toBe(false);
        expect(eleven.sync).toBe('');
        expect(eleven.visits).toBe(0);
        // The docs bookmark carries its nested folder path.
        const docs = cards.find(c => c.host === 'docs.github.com');
        expect(docs.bookmarks[0].path).toBe('Bookmarks bar / Dev');
        expect(docs.kind).toBe('agg');
        expect(docs.source).toBe('duckduckgo');
        // example.com has no cached icon → no card.
        expect(cards.some(c => c.host === 'example.com')).toBe(false);
        // The bookmarklet never enters the host index.
        expect(cards.some(c => c.bookmarks.some(b => b.id === '14'))).toBe(false);
    });

    it('keeps a card whose bookmarks are all gone as an orphan', () => {
        const { cards } = buildGallery(baseArgs());
        const gone = cards.find(c => c.host === 'gone.example');
        expect(gone.orphan).toBe(true);
        expect(gone.bookmarks).toEqual([]);
        expect(gone.kind).toBe('proxy');
    });

    it('marks legacy entries (no src) as legacy kind', () => {
        const { cards } = buildGallery(baseArgs());
        const old = cards.find(c => c.host === 'old.example');
        expect(old.kind).toBe('legacy');
        expect(old.source).toBe('');
    });

    it('rejects data values that are not image data URLs', () => {
        const { cards } = buildGallery(baseArgs({
            idxRaw: JSON.stringify({
                ...IDX,
                hosts: { 'bad.example': { t: 1, s: 5, src: 'direct' } }
            }),
            dataByHost: { 'bad.example': 'not-an-image-url' }
        }));
        expect(cards).toEqual([]);
    });

    it('accepts an already-parsed index object and survives garbage', () => {
        expect(buildGallery(baseArgs({ idxRaw: IDX })).cards.length).toBe(4);
        // A corrupt/absent index self-heals from the data keys (mirroring the
        // enricher's own hydrate rebuild) — the hosts render as legacy cards.
        for (const raw of ['{broken', undefined]) {
            const healed = buildGallery(baseArgs({ idxRaw: raw })).cards;
            expect(healed.map(c => c.host).sort()).toEqual([
                'docs.github.com', 'github.com', 'gone.example', 'old.example'
            ]);
            expect(healed.every(c => c.kind === 'legacy' && c.ts === 0)).toBe(true);
        }
        expect(buildGallery().cards).toEqual([]);
    });

    it('lists a data-key-only host even when the index never saw it', () => {
        // e.g. the index was rewritten by a concurrently open page before its
        // 1s-debounced flush — the cached icon must not vanish from the gallery.
        const { cards, totals } = buildGallery(baseArgs({
            idxRaw: JSON.stringify({ ...IDX, hosts: { 'github.com': IDX.hosts['github.com'] } })
        }));
        expect(cards.map(c => c.host).sort()).toEqual([
            'docs.github.com', 'github.com', 'gone.example', 'old.example'
        ]);
        expect(cards.find(c => c.host === 'github.com').kind).toBe('direct');
        expect(cards.find(c => c.host === 'gone.example').kind).toBe('legacy');
        expect(totals.byKind).toEqual({ direct: 1, proxy: 0, agg: 0, legacy: 3 });
    });

    it('accepts deadMarks/deadMarkTimes in their stored JSON-string form', () => {
        const { cards } = buildGallery(baseArgs({
            deadMarks: '["10"]',
            deadMarkTimes: '{"10": 999}'
        }));
        const ten = cards.find(c => c.host === 'github.com').bookmarks[0];
        expect(ten.dead).toBe(true);
        expect(ten.deadTs).toBe(999);
        expect(buildGallery(baseArgs({ deadMarks: '[broken' })).cards.length).toBe(4);
    });

    it('totals: sites, bookmark rows, bytes, per-kind counts', () => {
        const { totals } = buildGallery(baseArgs());
        expect(totals.sites).toBe(4);
        expect(totals.bookmarks).toBe(3); // 2 github + 1 docs; orphan counts none
        expect(totals.bytes).toBe(500 + 300 + 100 + 50);
        expect(totals.byKind).toEqual({ direct: 1, proxy: 1, agg: 1, legacy: 1 });
    });
});

describe('filterCards', () => {
    const cards = buildGallery(baseArgs()).cards;

    it('all + empty query returns everything', () => {
        const { cards: out, bookmarks } = filterCards(cards, { query: '', source: 'all' });
        expect(out.length).toBe(4);
        expect(bookmarks).toBe(3);
    });

    it('filters by kind and by concrete provider id', () => {
        expect(filterCards(cards, { source: 'direct' }).cards.map(c => c.host)).toEqual(['github.com']);
        expect(filterCards(cards, { source: 'proxy' }).cards.map(c => c.host)).toEqual(['gone.example']);
        expect(filterCards(cards, { source: 'legacy' }).cards.map(c => c.host)).toEqual(['old.example']);
        expect(filterCards(cards, { source: 'agg' }).cards.map(c => c.host)).toEqual(['docs.github.com']);
        expect(filterCards(cards, { source: 'duckduckgo' }).cards.map(c => c.host)).toEqual(['docs.github.com']);
        expect(filterCards(cards, { source: 'icon-horse' }).cards).toEqual([]);
    });

    it('host query keeps the whole card; bookmark-only query trims the list', () => {
        const byHost = filterCards(cards, { query: 'github' });
        expect(byHost.cards.map(c => c.host)).toEqual(['docs.github.com', 'github.com']);
        expect(byHost.bookmarks).toBe(3);
        const byTitle = filterCards(cards, { query: 'windviki' });
        expect(byTitle.cards.map(c => c.host)).toEqual(['github.com']);
        expect(byTitle.cards[0].bookmarks.map(b => b.id)).toEqual(['10']);
        expect(byTitle.bookmarks).toBe(1);
        // Path query hits too.
        const byPath = filterCards(cards, { query: 'dev' });
        expect(byPath.cards.map(c => c.host)).toEqual(['docs.github.com']);
        // No match → empty.
        expect(filterCards(cards, { query: 'zzz-no-hit' }).cards).toEqual([]);
    });
});

describe('sourceChips', () => {
    it('lists all first, then present sources in chain order with counts', () => {
        const chips = sourceChips(buildGallery(baseArgs()).cards);
        expect(chips).toEqual([
            { id: 'all', count: 4 },
            { id: 'direct', count: 1 },
            { id: 'proxy', count: 1 },
            { id: 'duckduckgo', count: 1 },
            { id: 'legacy', count: 1 }
        ]);
    });

    it('omits absent sources entirely', () => {
        const chips = sourceChips(buildGallery(baseArgs({
            idxRaw: JSON.stringify({ ...IDX, hosts: { 'github.com': IDX.hosts['github.com'] } }),
            dataByHost: { 'github.com': PNG }
        })).cards);
        expect(chips).toEqual([{ id: 'all', count: 1 }, { id: 'direct', count: 1 }]);
    });
});
