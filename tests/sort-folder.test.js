import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// Folder-sort executor planning (review 05-S1/S2/S9): the pure half of
// neat.js's sortFolderContents lives on window.VBMSort — full-hierarchy
// snapshot, per-level move plans and the re-entrancy lock. Loaded like the
// other classic-script suites: evaluate the real source onto a bare window.
const sortSource = fs.readFileSync(new URL('../src/sort-utils.js', import.meta.url), 'utf8');
const window = {};
new Function('window', sortSource)(window);
const VBMSort = window.VBMSort;

const bm = (id, title, dateAdded) => ({ id, title, url: `https://example.com/${id}`, dateAdded });
const folder = (id, title, dateAdded, children = []) => ({ id, title, dateAdded, children });

// A recursive demo tree under folder '10':
//   10: [bm 3 'z', folder 1 'b' [bm 5 'y', bm 4 'x'], bm 2 'a']
const demoChildren = () => [
    bm('3', 'z', 3),
    folder('1', 'b', 1, [bm('5', 'y', 5), bm('4', 'x', 4)]),
    bm('2', 'a', 2)
];

// In-memory stand-in for chrome.bookmarks: levels are id arrays keyed by
// parentId; move(id, {index}) re-seats the id inside its parent's array —
// the same semantics the real serial moveToIndex chain relies on.
const makeLevelStore = levels => {
    const state = new Map(Object.entries(levels).map(([k, v]) => [k, v.slice()]));
    return {
        state,
        move(id, index) {
            for (const arr of state.values()) {
                const at = arr.indexOf(id);
                if (at === -1)
                    continue;
                arr.splice(at, 1);
                arr.splice(index, 0, id);
                return;
            }
        },
        // the executor's ascending-index replay, exactly as neat.js drives it
        run(plan) {
            for (const ids of plan)
                ids.forEach((id, i) => this.move(id, i));
        }
    };
};

describe('snapshotOrder — full-hierarchy pre-sort snapshot', () => {
    it('maps every level with children, root first, in current order', () => {
        const snapshot = VBMSort.snapshotOrder('10', demoChildren());
        expect(snapshot).toEqual(new Map([
            ['10', ['3', '1', '2']],
            ['1', ['5', '4']]
        ]));
        // numeric-string ids must keep insertion order (root level first) —
        // a plain object would iterate them numerically
        expect([...snapshot.keys()]).toEqual(['10', '1']);
    });

    it('skips empty levels and tolerates corrupted input', () => {
        expect(VBMSort.snapshotOrder('10', [folder('1', 'f', 1)])).toEqual(new Map([['10', ['1']]]));
        expect(VBMSort.snapshotOrder('10', [])).toEqual(new Map());
        expect(VBMSort.snapshotOrder('10', null)).toEqual(new Map());
        expect(VBMSort.snapshotOrder('10', undefined)).toEqual(new Map());
    });
});

describe('planSortMoves — per-level sort move plan', () => {
    it('non-recursive: only the top level', () => {
        const sorted = VBMSort.sortNodes(demoChildren(), { by: 'title', foldersFirst: false });
        expect(VBMSort.planSortMoves(sorted, false)).toEqual([['2', '1', '3']]);
    });

    it('recursive: top level plus every descendant level, parents first', () => {
        const sorted = VBMSort.sortNodes(demoChildren(), { by: 'title', foldersFirst: false, recursive: true });
        expect(VBMSort.planSortMoves(sorted, true)).toEqual([
            ['2', '1', '3'],
            ['4', '5']
        ]);
    });

    it('returns no plan for corrupted input', () => {
        expect(VBMSort.planSortMoves(null, true)).toEqual([]);
        expect(VBMSort.planSortMoves(undefined, false)).toEqual([]);
    });
});

describe('planUndoMoves — undo replay semantics', () => {
    const snapshot = () => new Map([['10', ['3', '1', '2']], ['1', ['5', '4']]]);

    it('non-recursive sort: only the top level replays (deeper levels untouched)', () => {
        expect(VBMSort.planUndoMoves(snapshot(), false)).toEqual([['3', '1', '2']]);
    });

    it('recursive sort: every snapshot level replays', () => {
        expect(VBMSort.planUndoMoves(snapshot(), true)).toEqual([
            ['3', '1', '2'],
            ['5', '4']
        ]);
    });

    it('tolerates a missing/empty snapshot', () => {
        expect(VBMSort.planUndoMoves(null, true)).toEqual([]);
        expect(VBMSort.planUndoMoves(new Map(), true)).toEqual([]);
        expect(VBMSort.planUndoMoves(undefined, false)).toEqual([]);
    });
});

describe('sort + undo round trip through the move plans', () => {
    it('a recursive sort fully reverts at EVERY level (S1)', () => {
        const store = makeLevelStore({ '10': ['3', '1', '2'], '1': ['5', '4'] });
        const snapshot = VBMSort.snapshotOrder('10', demoChildren());
        const sorted = VBMSort.sortNodes(demoChildren(), { by: 'title', foldersFirst: false, recursive: true });
        store.run(VBMSort.planSortMoves(sorted, true));
        expect(store.state.get('10')).toEqual(['2', '1', '3']); // sorted
        expect(store.state.get('1')).toEqual(['4', '5']);        // sorted
        store.run(VBMSort.planUndoMoves(snapshot, true));
        expect(store.state.get('10')).toEqual(['3', '1', '2']); // restored
        expect(store.state.get('1')).toEqual(['5', '4']);       // restored
    });

    it('a single-level sort reverts only the top level', () => {
        const store = makeLevelStore({ '10': ['3', '1', '2'], '1': ['5', '4'] });
        const snapshot = VBMSort.snapshotOrder('10', demoChildren());
        const sorted = VBMSort.sortNodes(demoChildren(), { by: 'title', foldersFirst: false });
        store.run(VBMSort.planSortMoves(sorted, false));
        expect(store.state.get('10')).toEqual(['2', '1', '3']);
        expect(store.state.get('1')).toEqual(['5', '4']); // never touched
        store.run(VBMSort.planUndoMoves(snapshot, false));
        expect(store.state.get('10')).toEqual(['3', '1', '2']);
        expect(store.state.get('1')).toEqual(['5', '4']);
    });
});

describe('createSortLock — re-entrancy guard (S2)', () => {
    it('refuses a second acquire while held, allows again after release', () => {
        const lock = VBMSort.createSortLock();
        expect(lock.isHeld()).toBe(false);
        expect(lock.acquire()).toBe(true);
        expect(lock.isHeld()).toBe(true);
        expect(lock.acquire()).toBe(false); // the mid-sort re-trigger is rejected
        lock.release();
        expect(lock.isHeld()).toBe(false);
        expect(lock.acquire()).toBe(true);
    });
});
