import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createFolderSorter } from '../src/folder-sort.js';
import { loadClassicFromFile } from './helpers/classic.js';

// The folder-sort executor (issue #33): all planning lives in the pure
// window.VBMSort helpers (tested separately in tests/sort-folder.test.js);
// this suite drives the REAL executor — the serial chrome.bookmarks.move
// chain, the re-entrancy lock and the toast Undo replay — with a
// chrome.bookmarks double. sort-utils.js is a classic script evaluated onto
// a window stub via the shared classic-script helper (tests/helpers/classic.js).
const flush = async (rounds = 12) => {
    for (let i = 0; i < rounds; i++)
        await Promise.resolve();
    await new Promise(r => setTimeout(r, 0)); // macrotask: drain every microtask hop
    for (let i = 0; i < rounds; i++)
        await Promise.resolve();
};

// folder '5' with children [b, a, c]; title order → [a, b, c]
const FOLDER = [{
    id: '5', title: 'Folder', children: [
        { id: 'b', title: 'Bravo' },
        { id: 'a', title: 'Alpha' },
        { id: 'c', title: 'Charlie' }
    ]
}];

// folder '5' with two subfolders, one of them holding unsorted grandchildren
// (title order → top [a, b], and b's children → [b1, b2])
const FOLDER_RECURSIVE = [{
    id: '5', title: 'Folder', children: [
        { id: 'b', title: 'Bravo', children: [
            { id: 'b2', title: 'Zulu' },
            { id: 'b1', title: 'A sub' }
        ] },
        { id: 'a', title: 'Alpha', children: [] }
    ]
}];

let moves, getTreeCalls, toastCalls, getSubTreeImpl, treeView, _m, sortFolderContents;

const makeSorter = (undo) => createFolderSorter({ undo, treeView, _m });

beforeEach(() => {
    globalThis.window = {};
    loadClassicFromFile('src/sort-utils.js', { window: globalThis.window });

    moves = [];
    getTreeCalls = 0;
    toastCalls = [];
    getSubTreeImpl = (id, cb) => cb(null);
    globalThis.chrome = {
        bookmarks: {
            getSubTree: (id, cb) => getSubTreeImpl(id, cb),
            move: (id, props, cb) => { moves.push([id, props]); if (cb) cb(); },
            getTree: cb => { getTreeCalls++; cb(); }
        },
        runtime: { lastError: undefined }
    };
    treeView = { generateTree: () => {} };
    _m = key => key;
    sortFolderContents = makeSorter({ toastAction: (msg, label, fn) => toastCalls.push({ msg, label, fn }) });
});

afterEach(() => {
    delete globalThis.chrome;
    delete globalThis.window;
});

describe('createFolderSorter — lazy undo/treeView access (TDZ gate)', () => {
    // neat.js passes undo/treeView as GETTERS over consts declared further down;
    // the sorter must not read them at construction (the getter would run in
    // the temporal dead zone). This is the regression gate for the reported
    // "Cannot access 'undo' before initialization" startup crash.
    it('does not read undo/treeView at construction, only on the sort execution', async () => {
        let undoReads = 0;
        let treeViewReads = 0;
        const sorter = createFolderSorter({
            _m: key => key,
            get undo() { undoReads++; return { toastAction: () => {} }; },
            get treeView() { treeViewReads++; return { generateTree: () => {} }; }
        });
        // construction must not touch the getters
        expect(undoReads).toBe(0);
        expect(treeViewReads).toBe(0);

        getSubTreeImpl = (id, cb) => cb(FOLDER);
        sorter('5', { by: 'title', foldersFirst: true, recursive: false });
        await flush();
        expect(treeViewReads).toBeGreaterThan(0); // generateTree read on rebuild
        expect(undoReads).toBeGreaterThan(0);      // toast wiring read after the chain
    });
});

describe('createFolderSorter — the serial move chain', () => {
    it('sorts a folder’s children by title via one serial move per target index', async () => {
        getSubTreeImpl = (id, cb) => cb(FOLDER);
        sortFolderContents('5', { by: 'title', foldersFirst: true, recursive: false });
        await flush();
        expect(moves).toEqual([
            ['a', { index: 0 }],
            ['b', { index: 1 }],
            ['c', { index: 2 }]
        ]);
        // the tree is rebuilt after the sort settles
        expect(getTreeCalls).toBe(1);
    });

    it('a non-recursive sort touches only the top level', async () => {
        getSubTreeImpl = (id, cb) => cb(FOLDER_RECURSIVE);
        sortFolderContents('5', { by: 'title', foldersFirst: true, recursive: false });
        await flush();
        expect(moves).toEqual([
            ['a', { index: 0 }],
            ['b', { index: 1 }]
        ]);
    });

    it('a recursive sort replays every level, parents first', async () => {
        getSubTreeImpl = (id, cb) => cb(FOLDER_RECURSIVE);
        sortFolderContents('5', { by: 'title', foldersFirst: true, recursive: true });
        await flush();
        expect(moves).toEqual([
            ['a', { index: 0 }],
            ['b', { index: 1 }],
            ['b1', { index: 0 }],
            ['b2', { index: 1 }]
        ]);
    });

    it('a missing or empty subtree releases the lock and never moves anything', async () => {
        getSubTreeImpl = (id, cb) => cb(null); // subtree vanished
        sortFolderContents('5', { by: 'title', foldersFirst: true, recursive: false });
        await flush();
        expect(moves).toEqual([]);
        expect(getTreeCalls).toBe(0);
        // the lock was released — a real sort still works afterwards
        getSubTreeImpl = (id, cb) => cb(FOLDER);
        sortFolderContents('5', { by: 'title', foldersFirst: true, recursive: false });
        await flush();
        expect(moves).toHaveLength(3);
    });
});

describe('createFolderSorter — the re-entrancy lock', () => {
    it('refuses a second trigger while the first chain is still in flight', async () => {
        getSubTreeImpl = (id, cb) => cb(FOLDER);
        sortFolderContents('5', { by: 'title', foldersFirst: true, recursive: false });
        // the move chain has NOT resolved yet (release runs in its .then) —
        // a second sort must be a no-op, not an interleaved second move stream
        sortFolderContents('5', { by: 'title', foldersFirst: true, recursive: false });
        await flush();
        expect(moves).toEqual([
            ['a', { index: 0 }],
            ['b', { index: 1 }],
            ['c', { index: 2 }]
        ]); // exactly one chain ran
        expect(getTreeCalls).toBe(1);
    });
});

describe('createFolderSorter — the toast Undo replay', () => {
    it('registers the toast action after the sort and replays the snapshot order', async () => {
        getSubTreeImpl = (id, cb) => cb(FOLDER);
        sortFolderContents('5', { by: 'title', foldersFirst: true, recursive: false });
        await flush();
        expect(toastCalls).toHaveLength(1);
        expect(toastCalls[0].msg).toBe('sortDone');
        expect(toastCalls[0].label).toBe('undoAction');
        // run the undo replay → every id moves back to its pre-sort index
        const before = moves.length;
        toastCalls[0].fn();
        await flush();
        expect(moves.slice(before)).toEqual([
            ['b', { index: 0 }],
            ['a', { index: 1 }],
            ['c', { index: 2 }]
        ]);
        // the tree is rebuilt once more after the replay
        expect(getTreeCalls).toBe(2);
    });

    it('a recursive undo replays every snapshot level', async () => {
        getSubTreeImpl = (id, cb) => cb(FOLDER_RECURSIVE);
        sortFolderContents('5', { by: 'title', foldersFirst: true, recursive: true });
        await flush();
        const before = moves.length;
        toastCalls[0].fn();
        await flush();
        // snapshot: { 5: [b, a], b: [b2, b1] } → b→0, a→1, then b2→0, b1→1
        expect(moves.slice(before)).toEqual([
            ['b', { index: 0 }],
            ['a', { index: 1 }],
            ['b2', { index: 0 }],
            ['b1', { index: 1 }]
        ]);
    });

    it('skips the toast wiring when no undo layer is present', async () => {
        sortFolderContents = makeSorter(undefined);
        getSubTreeImpl = (id, cb) => cb(FOLDER);
        sortFolderContents('5', { by: 'title', foldersFirst: true, recursive: false });
        await flush();
        expect(toastCalls).toHaveLength(0);
        expect(moves).toHaveLength(3);
        expect(getTreeCalls).toBe(1);
    });
});
