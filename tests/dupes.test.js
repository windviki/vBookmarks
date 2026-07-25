import { describe, it, expect } from 'vitest';
import { normalizeUrl, findDupes, pickKeeper, planDeletion } from '../src/dupes.js';

// dupes.js is pure logic (no chrome.*/DOM), so these run straight in node.

describe('normalizeUrl', () => {
    it('drops the hash fragment', () => {
        expect(normalizeUrl('https://a.com/page#section'))
            .toBe('https://a.com/page');
    });

    it('drops utm_* parameters but keeps the rest', () => {
        expect(normalizeUrl('https://a.com/p?utm_source=tw&id=42&utm_medium=x'))
            .toBe('https://a.com/p?id=42');
    });

    it('drops fbclid and gclid', () => {
        expect(normalizeUrl('https://a.com/p?fbclid=abc')).toBe('https://a.com/p');
        expect(normalizeUrl('https://a.com/p?gclid=xyz&id=1')).toBe('https://a.com/p?id=1');
    });

    it('matches tracking parameter names case-insensitively', () => {
        expect(normalizeUrl('https://a.com/p?UTM_SOURCE=tw&FBCLID=z')).toBe('https://a.com/p');
    });

    it('keeps a parameter whose value (not name) mentions utm', () => {
        expect(normalizeUrl('https://a.com/p?q=utm_source')).toBe('https://a.com/p?q=utm_source');
    });

    it('preserves the original order of the surviving parameters', () => {
        expect(normalizeUrl('https://a.com/p?b=2&utm_k=x&a=1&c=3'))
            .toBe('https://a.com/p?b=2&a=1&c=3');
    });

    it('drops the whole query when only tracking params remain', () => {
        expect(normalizeUrl('https://a.com/p?utm_a=1&gclid=2')).toBe('https://a.com/p');
    });

    it('lowercases scheme and host', () => {
        expect(normalizeUrl('HTTP://Example.COM/Path'))
            .toBe('http://example.com/Path');
    });

    it('drops the default ports', () => {
        expect(normalizeUrl('http://a.com:80/x')).toBe('http://a.com/x');
        expect(normalizeUrl('https://a.com:443/x')).toBe('https://a.com/x');
    });

    it('keeps non-default ports', () => {
        expect(normalizeUrl('http://a.com:8080/x')).toBe('http://a.com:8080/x');
    });

    it('strips the trailing slash of the bare root path', () => {
        expect(normalizeUrl('https://a.com/')).toBe('https://a.com');
        expect(normalizeUrl('https://a.com')).toBe('https://a.com');
    });

    it('strips the root slash even when a query follows', () => {
        expect(normalizeUrl('https://a.com/?x=1')).toBe('https://a.com?x=1');
    });

    it('keeps the trailing slash of a real path (no over-merging)', () => {
        expect(normalizeUrl('https://a.com/a/')).toBe('https://a.com/a/');
        expect(normalizeUrl('https://a.com/a/')).not.toBe(normalizeUrl('https://a.com/a'));
    });

    it('makes the classic tracking-url variants collapse into one key', () => {
        const a = normalizeUrl('HTTP://Example.COM/?utm_source=tw#frag');
        const b = normalizeUrl('http://example.com');
        expect(a).toBe(b);
    });

    it('returns non-http(s) URLs verbatim (exact-match grouping)', () => {
        expect(normalizeUrl('javascript:alert(1)#x')).toBe('javascript:alert(1)#x');
        expect(normalizeUrl('chrome://extensions/?id=1')).toBe('chrome://extensions/?id=1');
        expect(normalizeUrl('data:text/html,<b>hi</b>')).toBe('data:text/html,<b>hi</b>');
        expect(normalizeUrl('about:blank')).toBe('about:blank');
    });

    it('returns unparseable input verbatim', () => {
        expect(normalizeUrl('not a url')).toBe('not a url');
        expect(normalizeUrl('')).toBe('');
        expect(normalizeUrl('http://')).toBe('http://');
    });
});

describe('findDupes', () => {
    const bm = (id, url, dateAdded, title = '') =>
        ({ id, url, dateAdded, title, parentId: '1' });

    it('groups bookmarks whose URLs normalize to the same key', () => {
        const groups = findDupes([
            bm('1', 'https://a.com/page#x', 100, 'first'),
            bm('2', 'https://a.com/page?utm_source=t', 200, 'second'),
            bm('3', 'https://b.com/other', 300)
        ]);
        expect(groups).toHaveLength(1);
        expect(groups[0].key).toBe('https://a.com/page');
        expect(groups[0].items.map(i => i.id)).toEqual(['1', '2']);
    });

    it('skips entries without a url (folders, separators)', () => {
        const groups = findDupes([
            { id: '1', title: 'folder', dateAdded: 1 },
            { id: '2', url: '', title: 'sep', dateAdded: 2 },
            bm('3', 'https://a.com/', 3),
            bm('4', 'https://a.com', 4)
        ]);
        expect(groups).toHaveLength(1);
        expect(groups[0].items.map(i => i.id)).toEqual(['3', '4']);
    });

    it('returns nothing when every bookmark is unique', () => {
        expect(findDupes([bm('1', 'https://a.com/', 1), bm('2', 'https://b.com/', 2)]))
            .toEqual([]);
        expect(findDupes([])).toEqual([]);
    });

    it('sorts items inside a group by dateAdded ascending (oldest = keep)', () => {
        const groups = findDupes([
            bm('1', 'https://a.com/', 300),
            bm('2', 'https://a.com/', 100),
            bm('3', 'https://a.com/', 200)
        ]);
        expect(groups[0].items.map(i => i.id)).toEqual(['2', '3', '1']);
    });

    it('treats a missing dateAdded as 0', () => {
        const groups = findDupes([
            { id: '1', url: 'https://a.com/' },
            bm('2', 'https://a.com/', 100)
        ]);
        expect(groups[0].items.map(i => i.id)).toEqual(['1', '2']);
    });

    it('sorts groups by size descending, then by key alphabetically', () => {
        const groups = findDupes([
            bm('1', 'https://b.com/', 1), bm('2', 'https://b.com/', 2),
            bm('3', 'https://a.com/', 1), bm('4', 'https://a.com/', 2),
            bm('5', 'https://c.com/', 1), bm('6', 'https://c.com/', 2), bm('7', 'https://c.com/', 3)
        ]);
        expect(groups.map(g => g.key)).toEqual([
            'https://c.com', // size 3 first
            'https://a.com', // ties broken by key
            'https://b.com'
        ]);
    });

    it('takes the group title from the oldest item', () => {
        const groups = findDupes([
            bm('1', 'https://a.com/', 200, 'newer title'),
            bm('2', 'https://a.com/', 100, 'oldest title')
        ]);
        expect(groups[0].title).toBe('oldest title');
    });

    it('falls back to an empty title when the oldest item has none', () => {
        const groups = findDupes([
            { id: '1', url: 'https://a.com/', dateAdded: 1 },
            bm('2', 'https://a.com/', 2, 'titled')
        ]);
        expect(groups[0].title).toBe('');
    });

    it('groups non-http URLs by exact match only', () => {
        const groups = findDupes([
            bm('1', 'javascript:alert(1)#a', 1),
            bm('2', 'javascript:alert(1)#b', 2), // hash NOT stripped for non-http
            bm('3', 'javascript:alert(1)#a', 3)
        ]);
        expect(groups).toHaveLength(1);
        expect(groups[0].items.map(i => i.id)).toEqual(['1', '3']);
    });

    it('does not merge a real path with and without trailing slash', () => {
        const groups = findDupes([
            bm('1', 'https://a.com/a/', 1),
            bm('2', 'https://a.com/a', 2)
        ]);
        expect(groups).toEqual([]);
    });
});

// v4 task-2 §5.6c: dupesIgnoreScheme folds http/https variants into one
// group (off by default).
describe('findDupes ignoreScheme (v4 task-2 §5.6c)', () => {
    const bm = (id, url, dateAdded) => ({ id, url, dateAdded, title: '', parentId: '1' });

    it('merges http and https variants of the same address', () => {
        const groups = findDupes([
            bm('1', 'http://a.com/page', 1),
            bm('2', 'https://a.com/page', 2),
            bm('3', 'https://b.com/', 3)
        ], { ignoreScheme: true });
        expect(groups).toHaveLength(1);
        expect(groups[0].key).toBe('//a.com/page');
        expect(groups[0].items.map(i => i.id)).toEqual(['1', '2']);
    });

    it('keeps the schemes apart by default', () => {
        const groups = findDupes([
            bm('1', 'http://a.com/page', 1),
            bm('2', 'https://a.com/page', 2)
        ]);
        expect(groups).toEqual([]);
    });

    it('still applies the normal normalization before folding the scheme', () => {
        const groups = findDupes([
            bm('1', 'HTTP://A.com/page?utm_source=t#x', 1),
            bm('2', 'https://a.com/page', 2)
        ], { ignoreScheme: true });
        expect(groups).toHaveLength(1);
    });

    it('leaves non-http URLs untouched (exact-match grouping)', () => {
        const groups = findDupes([
            bm('1', 'javascript:alert(1)', 1),
            bm('2', 'javascript:alert(1)', 2)
        ], { ignoreScheme: true });
        expect(groups).toHaveLength(1);
        expect(groups[0].key).toBe('javascript:alert(1)');
    });
});

// v4 task-2 §5.6b: the six keeper strategies. group.items arrive
// oldest-first, so "oldest" fallbacks resolve to items[0].
describe('pickKeeper (v4 task-2 §5.6b)', () => {
    const item = (id, extra = {}) => ({ id, title: '', dateAdded: 1, ...extra });
    const groupOf = (...items) => ({ key: 'k', items });

    it('returns null for an empty group', () => {
        expect(pickKeeper({ items: [] }, 'keep-oldest')).toBeNull();
        expect(pickKeeper(null, 'keep-newest')).toBeNull();
    });

    it('keep-oldest (and an unknown strategy) keeps the first item', () => {
        const group = groupOf(item('1'), item('2'), item('3'));
        expect(pickKeeper(group, 'keep-oldest').id).toBe('1');
        expect(pickKeeper(group, 'bogus').id).toBe('1');
        expect(pickKeeper(group).id).toBe('1'); // strategy omitted
    });

    it('keep-newest keeps the last item', () => {
        const group = groupOf(item('1'), item('2'), item('3'));
        expect(pickKeeper(group, 'keep-newest').id).toBe('3');
    });

    it('keep-bookmark-bar keeps the first in-bar item', () => {
        const group = groupOf(item('1'), item('2'), item('3'));
        const inBar = id => id !== '1';
        expect(pickKeeper(group, 'keep-bookmark-bar', { inBar }).id).toBe('2');
    });

    it('keep-bookmark-bar falls back to oldest when no item sits in the bar', () => {
        const group = groupOf(item('1'), item('2'));
        expect(pickKeeper(group, 'keep-bookmark-bar', { inBar: () => false }).id).toBe('1');
        expect(pickKeeper(group, 'keep-bookmark-bar').id).toBe('1'); // no ctx
    });

    it('keep-shortest-title keeps the shortest title, ties resolved oldest-first', () => {
        const group = groupOf(
            item('1', { title: 'bbbb' }),
            item('2', { title: 'aa' }),
            item('3', { title: 'cc' }),
            item('4') // empty title wins
        );
        expect(pickKeeper(group, 'keep-shortest-title').id).toBe('4');
        const tied = groupOf(item('1', { title: 'aa' }), item('2', { title: 'bb' }));
        expect(pickKeeper(tied, 'keep-shortest-title').id).toBe('1');
    });

    it('keep-shallowest keeps the smallest ctx.depthOf, ties resolved oldest-first', () => {
        const group = groupOf(item('1'), item('2'), item('3'));
        const depthOf = id => ({ 1: 5, 2: 2, 3: 3 })[id];
        expect(pickKeeper(group, 'keep-shallowest', { depthOf }).id).toBe('2');
        // missing ctx: every depth reads 0 → the oldest item stands
        expect(pickKeeper(group, 'keep-shallowest').id).toBe('1');
    });

    it('keep-most-visited keeps the highest ctx.visitCountOf', () => {
        const group = groupOf(item('1'), item('2'), item('3'));
        const visitCountOf = id => ({ 1: 3, 2: 9, 3: 4 })[id];
        expect(pickKeeper(group, 'keep-most-visited', { visitCountOf }).id).toBe('2');
    });

    it('keep-most-visited falls back to oldest on ties and on missing data', () => {
        const group = groupOf(item('1'), item('2'));
        const tied = () => 5;
        expect(pickKeeper(group, 'keep-most-visited', { visitCountOf: tied }).id).toBe('1');
        expect(pickKeeper(group, 'keep-most-visited').id).toBe('1'); // no ctx
        const zeros = () => 0;
        expect(pickKeeper(group, 'keep-most-visited', { visitCountOf: zeros }).id).toBe('1');
    });
});

describe('planDeletion with an explicit keeper (v4 task-2 §5.6b)', () => {
    it('dooms everything but the keeper, preserving group order', () => {
        const items = [{ id: '1' }, { id: '2' }, { id: '3' }];
        expect(planDeletion({ items }, items[1]).map(i => i.id)).toEqual(['1', '3']);
    });

    it('dooms nothing when the group is just the keeper', () => {
        const items = [{ id: '1' }];
        expect(planDeletion({ items }, items[0])).toEqual([]);
    });

    it('returns a copy, not a view into the group', () => {
        const group = { items: [{ id: '1' }, { id: '2' }] };
        const doomed = planDeletion(group, group.items[0]);
        doomed.push({ id: 'x' });
        expect(group.items).toHaveLength(2);
    });
});

describe('planDeletion', () => {
    it('keeps the first (oldest) item and dooms the rest', () => {
        const items = [{ id: '1' }, { id: '2' }, { id: '3' }];
        expect(planDeletion({ items }).map(i => i.id)).toEqual(['2', '3']);
    });

    it('returns a copy, not a view into the group', () => {
        const group = { items: [{ id: '1' }, { id: '2' }] };
        const doomed = planDeletion(group);
        doomed.push({ id: 'x' });
        expect(group.items).toHaveLength(2);
    });

    it('dooms exactly one copy in a pair', () => {
        const groups = findDupes([
            { id: '1', url: 'https://a.com/', dateAdded: 5 },
            { id: '2', url: 'https://a.com/#x', dateAdded: 9 }
        ]);
        expect(planDeletion(groups[0]).map(i => i.id)).toEqual(['2']);
    });
});
