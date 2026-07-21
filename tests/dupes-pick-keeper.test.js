/**
 * dupes-pick-keeper.test.js — tests for pickKeeper strategies (v4 task 2)
 */
import { describe, it, expect } from 'vitest';
import { pickKeeper } from '../src/dupes.js';

const makeGroup = (items) => {
    // items: [{ id, title, url, dateAdded, parentId? }]
    return items.map((item, i) => ({
        id: item.id || String(i + 1),
        title: item.title || `Bookmark ${i + 1}`,
        url: item.url || `https://example.com/page${i + 1}`,
        dateAdded: item.dateAdded || (1000 * (i + 1)),
        parentId: item.parentId || '10'
    }));
};

describe('pickKeeper', () => {
    it('returns null for empty group', () => {
        expect(pickKeeper([], 'keep-oldest')).toBeNull();
    });

    it('returns the only item for single-item group', () => {
        const g = makeGroup([{ id: 'a' }]);
        expect(pickKeeper(g, 'keep-oldest').id).toBe('a');
    });

    it('keep-oldest: returns the item with smallest dateAdded', () => {
        const g = makeGroup([
            { id: 'new', dateAdded: 3000 },
            { id: 'old', dateAdded: 1000 },
            { id: 'mid', dateAdded: 2000 }
        ]);
        expect(pickKeeper(g, 'keep-oldest').id).toBe('old');
    });

    it('keep-newest: returns the item with largest dateAdded', () => {
        const g = makeGroup([
            { id: 'new', dateAdded: 3000 },
            { id: 'old', dateAdded: 1000 },
            { id: 'mid', dateAdded: 2000 }
        ]);
        expect(pickKeeper(g, 'keep-newest').id).toBe('new');
    });

    it('keep-bookmark-bar: prefers items in the bookmark bar, falls back to oldest', () => {
        const g = makeGroup([
            { id: 'a', dateAdded: 3000, parentId: '5' },
            { id: 'b', dateAdded: 1000, parentId: '99' }, // in bar, oldest
            { id: 'c', dateAdded: 2000, parentId: '99' }  // in bar, newer
        ]);
        const barIds = new Set(['99']);
        // Both b and c are in the bar, b is oldest (1000 < 2000)
        const keeper = pickKeeper(g, 'keep-bookmark-bar', { bookmarkBarIds: barIds });
        expect(keeper.id).toBe('b');
    });

    it('keep-bookmark-bar: falls back to oldest when none in bar', () => {
        const g = makeGroup([
            { id: 'a', dateAdded: 3000 },
            { id: 'b', dateAdded: 1000 }
        ]);
        const keeper = pickKeeper(g, 'keep-bookmark-bar', { bookmarkBarIds: new Set() });
        expect(keeper.id).toBe('b');
    });

    it('keep-shortest-title: picks the shortest title, tie-breaks by oldest', () => {
        const g = makeGroup([
            { id: 'long', title: 'A Very Long Bookmark Title Here', dateAdded: 3000 },
            { id: 'short', title: 'Hi', dateAdded: 2000 },
            { id: 'also-short', title: 'Hi', dateAdded: 1000 }
        ]);
        const keeper = pickKeeper(g, 'keep-shortest-title');
        expect(keeper.id).toBe('also-short'); // both 'Hi', oldest wins
    });

    it('keep-shallowest: picks item with shortest parent path depth', () => {
        const g = makeGroup([
            { id: 'deep', dateAdded: 3000, parentId: '5' },
            { id: 'shallow', dateAdded: 2000, parentId: '0' }, // root level
            { id: 'mid', dateAdded: 1000, parentId: '3' }
        ]);
        const pathMap = { '5': '3', '3': '0' };
        const keeper = pickKeeper(g, 'keep-shallowest', { parentPathMap: pathMap });
        expect(keeper.id).toBe('shallow');
    });

    it('keep-most-visited: prefers highest count, falls back to oldest', () => {
        const g = makeGroup([
            { id: 'low', dateAdded: 3000 },
            { id: 'high', dateAdded: 2000 },
            { id: 'mid', dateAdded: 1000 }
        ]);
        const stats = { low: { c: 1 }, high: { c: 10 }, mid: { c: 5 } };
        const keeper = pickKeeper(g, 'keep-most-visited', { visitStats: stats });
        expect(keeper.id).toBe('high');
    });

    it('keep-most-visited: falls back to oldest when no visit data', () => {
        const g = makeGroup([
            { id: 'a', dateAdded: 3000 },
            { id: 'b', dateAdded: 1000 }
        ]);
        const keeper = pickKeeper(g, 'keep-most-visited', { visitStats: {} });
        expect(keeper.id).toBe('b');
    });

    it('defaults to keep-oldest for unknown strategy', () => {
        const g = makeGroup([
            { id: 'new', dateAdded: 3000 },
            { id: 'old', dateAdded: 1000 }
        ]);
        expect(pickKeeper(g, 'bogus-strategy').id).toBe('old');
    });
});
