import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// Load the real sort-utils.js source and evaluate it in a sandbox with a
// bare window global — the same way a classic script runs inside popup.html.
const sortSource = fs.readFileSync(new URL('../src/sort-utils.js', import.meta.url), 'utf8');
const window = {};
new Function('window', sortSource)(window);
const VBMSort = window.VBMSort;

const bm = (id, title, dateAdded) => ({ id, title, url: `https://example.com/${id}`, dateAdded });
const folder = (id, title, dateAdded, children = []) => ({ id, title, dateAdded, children });

describe('sort-utils.js sortNodes() by title', () => {
    it('sorts titles case-insensitively', () => {
        const nodes = [bm('1', 'banana', 1), bm('2', 'Apple', 2), bm('3', 'cherry', 3)];
        const sorted = VBMSort.sortNodes(nodes, { by: 'title', foldersFirst: false });
        expect(sorted.map(n => n.title)).toEqual(['Apple', 'banana', 'cherry']);
    });

    it('compares numbers naturally (numeric collation)', () => {
        const nodes = [bm('1', 'item 10', 1), bm('2', 'item 2', 2), bm('3', 'item 1', 3)];
        const sorted = VBMSort.sortNodes(nodes, { by: 'title', foldersFirst: false });
        expect(sorted.map(n => n.title)).toEqual(['item 1', 'item 2', 'item 10']);
    });

    it('treats missing titles as empty strings', () => {
        const nodes = [bm('1', 'b', 1), bm('2', '', 2), bm('3', 'a', 3)];
        const sorted = VBMSort.sortNodes(nodes, { by: 'title', foldersFirst: false });
        expect(sorted.map(n => n.id)).toEqual(['2', '3', '1']);
    });
});

describe('sort-utils.js sortNodes() by dateAdded', () => {
    it('sorts newest first', () => {
        const nodes = [bm('1', 'a', 100), bm('2', 'b', 300), bm('3', 'c', 200)];
        const sorted = VBMSort.sortNodes(nodes, { by: 'dateAdded', foldersFirst: false });
        expect(sorted.map(n => n.id)).toEqual(['2', '3', '1']);
    });
});

describe('sort-utils.js sortNodes() foldersFirst', () => {
    const nodes = [
        bm('b1', 'alpha', 1),
        folder('f1', 'zeta', 2),
        bm('b2', 'beta', 3),
        folder('f2', 'aardvark', 4)
    ];

    it('true: folders first, each group sorted on its own', () => {
        const sorted = VBMSort.sortNodes(nodes, { by: 'title', foldersFirst: true });
        expect(sorted.map(n => n.id)).toEqual(['f2', 'f1', 'b1', 'b2']);
    });

    it('false: folders and bookmarks interleaved in one sorted list', () => {
        const sorted = VBMSort.sortNodes(nodes, { by: 'title', foldersFirst: false });
        expect(sorted.map(n => n.id)).toEqual(['f2', 'b1', 'b2', 'f1']);
    });
});

describe('sort-utils.js sortNodes() recursive', () => {
    it('sorts descendants and returns a deep-copied ordered tree', () => {
        const child = folder('f2', 'sub', 1, [bm('c1', 'z', 1), bm('c2', 'a', 2)]);
        const nodes = [bm('b1', 'top', 1), child];
        const sorted = VBMSort.sortNodes(nodes, { by: 'title', foldersFirst: false, recursive: true });
        expect(sorted[0].children.map(n => n.title)).toEqual(['a', 'z']);
        // deep copy: the returned folder is not the input object
        expect(sorted[0]).not.toBe(child);
        expect(sorted[0].children).not.toBe(child.children);
    });

    it('does not recurse when recursive is false', () => {
        const child = folder('f1', 'sub', 1, [bm('c1', 'z', 1), bm('c2', 'a', 2)]);
        const sorted = VBMSort.sortNodes([child], { by: 'title', recursive: false });
        expect(sorted[0].children.map(n => n.title)).toEqual(['z', 'a']);
    });
});

describe('sort-utils.js sortNodes() purity', () => {
    it('does not mutate the input array or reorder its elements', () => {
        const nodes = [bm('1', 'b', 1), bm('2', 'a', 2), bm('3', 'c', 3)];
        const snapshot = nodes.slice();
        const sorted = VBMSort.sortNodes(nodes, { by: 'title', foldersFirst: false });
        expect(nodes).toEqual(snapshot);
        expect(sorted).not.toBe(nodes);
    });

    it('returns an empty array for non-array input', () => {
        expect(VBMSort.sortNodes(null, {})).toEqual([]);
        expect(VBMSort.sortNodes(undefined, {})).toEqual([]);
    });
});

// Phase 3 wiring contract: popup.html loads sort-utils.js before neat.js.
describe('phase 3 wiring', () => {
    const popupHtml = fs.readFileSync(new URL('../pages/popup.html', import.meta.url), 'utf8');

    it('popup.html loads sort-utils.js before neat.js', () => {
        const sortAt = popupHtml.indexOf('<script src="/src/sort-utils.js"></script>');
        const neatAt = popupHtml.indexOf('<script type="module" src="/src/neat.js"></script>');
        expect(sortAt).toBeGreaterThan(-1);
        expect(neatAt).toBeGreaterThan(-1);
        expect(sortAt).toBeLessThan(neatAt);
    });
});

describe('sort-utils.js parseSortOptions()', () => {
    it('parses a full persisted sortOptions JSON', () => {
        expect(VBMSort.parseSortOptions('{"by":"dateAdded","foldersFirst":false,"recursive":true}'))
            .toEqual({ by: 'dateAdded', foldersFirst: false, recursive: true });
    });

    it('returns the defaults for a missing/empty raw value', () => {
        expect(VBMSort.parseSortOptions('')).toEqual({ by: 'title', foldersFirst: true, recursive: false });
        expect(VBMSort.parseSortOptions(null)).toEqual({ by: 'title', foldersFirst: true, recursive: false });
        expect(VBMSort.parseSortOptions(undefined)).toEqual({ by: 'title', foldersFirst: true, recursive: false });
    });

    it('falls back to defaults on corrupted JSON', () => {
        expect(VBMSort.parseSortOptions('not-json{['))
            .toEqual({ by: 'title', foldersFirst: true, recursive: false });
    });

    it('normalizes unknown by/fields to the defaults', () => {
        expect(VBMSort.parseSortOptions('{"by":"weird","foldersFirst":"yes","recursive":1}'))
            .toEqual({ by: 'title', foldersFirst: true, recursive: false });
    });
});
