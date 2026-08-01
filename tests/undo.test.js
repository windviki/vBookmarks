import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';

// undo.js touches page globals (document/chrome) only inside initUndo, so the
// real module imports cleanly in node once the globals are stubbed.
// chrome.bookmarks.getSubTree/create and chrome.storage.session are test
// doubles that record their calls; the toast DOM elements are plain objects —
// no implementation copied from neat.js.

let initUndo;
let timeouts;
let cleared;
let nextTimerId;
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

beforeAll(async () => {
    globalThis.setTimeout = (fn, ms) => {
        timeouts.push([fn, ms]);
        return nextTimerId++;
    };
    globalThis.clearTimeout = id => {
        cleared.push(id);
    };
    ({ initUndo } = await import('../src/undo.js'));
});

beforeEach(() => {
    timeouts = [];
    cleared = [];
    nextTimerId = 1;
});

afterEach(() => {
    vi.restoreAllMocks();
});

afterAll(() => {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
});

const makeEl = () => ({
    hidden: true,
    textContent: '',
    listeners: {},
    addEventListener(type, fn) {
        this.listeners[type] = fn;
    }
});

const FOLDER_TREE = {
    id: '9', parentId: '1', index: 3, title: 'Docs',
    children: [
        { id: '10', parentId: '9', index: 0, title: 'A', url: 'https://a/' },
        {
            id: '11', parentId: '9', index: 1, title: 'Sub',
            children: [{ id: '12', parentId: '11', index: 0, title: 'B', url: 'https://b/' }]
        }
    ]
};
const BOOKMARK_NODE = { id: '5', parentId: '1', index: 2, title: 'GH', url: 'https://gh/' };

const makeChrome = (opts = {}) => {
    const chrome = {
        i18n: { getMessage: (key, subs) => subs ? `${key}[${[].concat(subs).join('|')}]` : key },
        runtime: { lastError: null }
    };
    chrome.bookmarks = {
        subTrees: opts.subTrees || {},
        getSubTreeCalls: [],
        createCalls: [],
        nextId: 100,
        failOn: new Set(opts.failOn || []), // 1-based create-call numbers that fail
        getSubTree(id, cb) {
            this.getSubTreeCalls.push(id);
            cb(id in this.subTrees ? [this.subTrees[id]] : []);
        },
        create(props, cb) {
            this.createCalls.push(props);
            if (this.failOn.has(this.createCalls.length)) {
                chrome.runtime.lastError = { message: 'create failed' };
                cb(undefined);
                chrome.runtime.lastError = null;
                return;
            }
            cb({ id: `${this.nextId++}`, ...props });
        }
    };
    chrome.storage = {
        session: {
            data: { ...(opts.sessionData || {}) },
            getCalls: [],
            setCalls: [],
            get(key, cb) {
                this.getCalls.push(key);
                cb({ [key]: this.data[key] });
            },
            set(obj) {
                this.setCalls.push(JSON.parse(JSON.stringify(obj)));
                Object.assign(this.data, obj);
            }
        }
    };
    return chrome;
};

const setup = (opts = {}) => {
    const els = {
        'undo-toast': makeEl(),
        'undo-toast-text': makeEl(),
        'undo-toast-button': makeEl()
    };
    globalThis.document = {
        getElementById: id => (opts.noToastDom ? null : els[id] || null)
    };
    globalThis.chrome = makeChrome(opts);
    const changed = [];
    const undo = initUndo({ onChanged: () => changed.push(1) });
    return { undo, els, chrome: globalThis.chrome, changed };
};

describe('module API', () => {
    it('returns the undo API', () => {
        const { undo } = setup({});
        for (const name of ['capture', 'undo', 'canUndo', 'peek', 'showToast', 'toastAction'])
            expect(typeof undo[name], name).toBe('function');
    });
});

describe('capture', () => {
    it('snapshots the subtree root: peek reflects title and folder-ness', () => {
        const { undo } = setup({ subTrees: { '9': FOLDER_TREE } });
        undo.capture('9');
        expect(undo.canUndo()).toBe(true);
        expect(undo.peek()).toEqual({ title: 'Docs', isFolder: true });
    });

    it('persists { parentId, index, node } with the recursive node to storage.session', () => {
        const { undo, chrome } = setup({ subTrees: { '9': FOLDER_TREE } });
        undo.capture('9');
        expect(chrome.storage.session.setCalls).toHaveLength(1);
        const saved = chrome.storage.session.setCalls[0].vbmUndoStack;
        expect(saved).toHaveLength(1);
        expect(saved[0].parentId).toBe('1');
        expect(saved[0].index).toBe(3);
        expect(saved[0].node).toEqual(FOLDER_TREE);
    });

    it('asks storage.session for the saved stack at init', () => {
        const { chrome } = setup({});
        expect(chrome.storage.session.getCalls).toEqual(['vbmUndoStack']);
    });

    it('restores a saved stack at init: canUndo/peek reflect the newest entry', () => {
        const { undo } = setup({
            sessionData: {
                vbmUndoStack: [{ parentId: '1', index: 0, node: { id: '9', title: 'Saved', url: 'https://a/' } }]
            }
        });
        expect(undo.canUndo()).toBe(true);
        expect(undo.peek()).toEqual({ title: 'Saved', isFolder: false });
    });

    it('silently skips a node that no longer exists', () => {
        const { undo, chrome } = setup({});
        undo.capture('404');
        expect(chrome.bookmarks.getSubTreeCalls).toEqual(['404']);
        expect(undo.canUndo()).toBe(false);
        expect(chrome.storage.session.setCalls).toEqual([]);
    });

    it('silently skips a getSubTree that reports an error', () => {
        const { undo, chrome } = setup({ subTrees: { '9': FOLDER_TREE } });
        chrome.runtime.lastError = { message: 'not found' };
        undo.capture('9');
        chrome.runtime.lastError = null;
        expect(undo.canUndo()).toBe(false);
        expect(chrome.storage.session.setCalls).toEqual([]);
    });

    it('caps the stack at 10 entries, shifting the oldest out', () => {
        const subTrees = {};
        for (let i = 1; i <= 11; i++)
            subTrees[`${i}`] = { id: `${i}`, parentId: '0', index: i, title: `t${i}`, url: `https://x/${i}` };
        const { undo, chrome } = setup({ subTrees });
        for (let i = 1; i <= 11; i++)
            undo.capture(`${i}`);
        const saved = chrome.storage.session.data.vbmUndoStack;
        expect(saved).toHaveLength(10);
        expect(saved[0].node.id).toBe('2'); // t1 was shifted out
        expect(undo.peek()).toEqual({ title: 't11', isFolder: false });
    });
});

describe('undo', () => {
    it('resolves false on an empty stack without touching the backend', async () => {
        const { undo, chrome, changed } = setup({});
        await expect(undo.undo()).resolves.toBe(false);
        expect(chrome.bookmarks.createCalls).toEqual([]);
        expect(changed).toEqual([]);
    });

    it('recreates a bookmark at its original parentId and index, then repaints', async () => {
        const { undo, chrome, changed } = setup({ subTrees: { '5': BOOKMARK_NODE } });
        undo.capture('5');
        await expect(undo.undo()).resolves.toBe(true);
        expect(chrome.bookmarks.createCalls).toEqual([
            { parentId: '1', index: 2, title: 'GH', url: 'https://gh/' }
        ]);
        expect(changed).toEqual([1]);
    });

    it('recreates a folder without a url key', async () => {
        const { undo, chrome } = setup({
            subTrees: { '9': { id: '9', parentId: '1', index: 4, title: 'Empty', children: [] } }
        });
        undo.capture('9');
        await undo.undo();
        expect(chrome.bookmarks.createCalls).toEqual([{ parentId: '1', index: 4, title: 'Empty' }]);
    });

    it('rebuilds a nested subtree depth-first under the new ids, children in original order', async () => {
        const { undo, chrome } = setup({ subTrees: { '9': FOLDER_TREE } });
        undo.capture('9');
        await expect(undo.undo()).resolves.toBe(true);
        // root keeps its snapshot index; children append in creation order
        // (no index key). New ids: Docs=100, A=101, Sub=102, B=103.
        expect(chrome.bookmarks.createCalls).toEqual([
            { parentId: '1', index: 3, title: 'Docs' },
            { parentId: '100', title: 'A', url: 'https://a/' },
            { parentId: '100', title: 'Sub' },
            { parentId: '102', title: 'B', url: 'https://b/' }
        ]);
    });

    it('creates strictly serially: no node starts before its parent resolved', async () => {
        const { undo, chrome } = setup({ subTrees: { '9': FOLDER_TREE } });
        const pending = [];
        chrome.bookmarks.create = (props, cb) => {
            chrome.bookmarks.createCalls.push(props);
            pending.push(cb); // resolve by hand below
        };
        undo.capture('9');
        const done = undo.undo();
        const tick = () => new Promise(resolve => realSetTimeout(resolve, 0));
        await tick();
        expect(chrome.bookmarks.createCalls).toHaveLength(1); // root only
        pending.shift()({ id: 'r1' });
        await tick();
        expect(chrome.bookmarks.createCalls).toHaveLength(2); // first child
        pending.shift()({ id: 'r2' });
        await tick();
        expect(chrome.bookmarks.createCalls).toHaveLength(3); // second child
        pending.shift()({ id: 'r3' });
        await tick();
        expect(chrome.bookmarks.createCalls).toHaveLength(4); // grandchild
        pending.shift()({ id: 'r4' });
        await expect(done).resolves.toBe(true);
    });

    it('pops the entry and persists the emptied stack', async () => {
        const { undo, chrome } = setup({ subTrees: { '5': BOOKMARK_NODE } });
        undo.capture('5');
        await undo.undo();
        expect(undo.canUndo()).toBe(false);
        expect(undo.peek()).toBeNull();
        const sets = chrome.storage.session.setCalls;
        expect(sets[sets.length - 1].vbmUndoStack).toEqual([]);
    });

    it('reports failure and keeps the partial rebuild when a create fails', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { undo, chrome, changed } = setup({ subTrees: { '9': FOLDER_TREE }, failOn: [3] });
        undo.capture('9');
        await expect(undo.undo()).resolves.toBe(false);
        // root + first child created, second child failed, grandchild never attempted
        expect(chrome.bookmarks.createCalls).toHaveLength(3);
        expect(changed).toEqual([]); // no repaint on failure
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('consumes the entry even when the root create fails', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { undo, chrome } = setup({ subTrees: { '5': BOOKMARK_NODE }, failOn: [1] });
        undo.capture('5');
        await expect(undo.undo()).resolves.toBe(false);
        expect(undo.canUndo()).toBe(false);
        const sets = chrome.storage.session.setCalls;
        expect(sets[sets.length - 1].vbmUndoStack).toEqual([]);
    });
});

describe('peek', () => {
    it('returns { title, isFolder } of the newest entry, null when empty', () => {
        const { undo } = setup({ subTrees: { '5': BOOKMARK_NODE, '9': FOLDER_TREE } });
        expect(undo.peek()).toBeNull();
        undo.capture('5');
        expect(undo.peek()).toEqual({ title: 'GH', isFolder: false });
        undo.capture('9');
        expect(undo.peek()).toEqual({ title: 'Docs', isFolder: true });
    });
});

describe('toast', () => {
    it('sets the button label from i18n at init', () => {
        const { els } = setup({});
        expect(els['undo-toast-button'].textContent).toBe('undoAction');
    });

    it('showToast fills the text, unhides the bar and schedules the 8s auto-hide', () => {
        const { undo, els } = setup({});
        undo.showToast('Deleted X');
        expect(els['undo-toast-text'].textContent).toBe('Deleted X');
        expect(els['undo-toast'].hidden).toBe(false);
        expect(timeouts).toHaveLength(1);
        expect(timeouts[0][1]).toBe(8000);
    });

    it('firing the timer hides the bar', () => {
        const { undo, els } = setup({});
        undo.showToast('Deleted X');
        timeouts[0][0]();
        expect(els['undo-toast'].hidden).toBe(true);
    });

    it('a repeated showToast resets the auto-hide timer', () => {
        const { undo, els } = setup({});
        undo.showToast('one');
        undo.showToast('two');
        expect(els['undo-toast-text'].textContent).toBe('two');
        expect(cleared).toContain(1); // the first timer was cleared
        expect(timeouts).toHaveLength(2);
        expect(timeouts[1][1]).toBe(8000);
    });

    it('the undo button runs undo and hides the bar afterwards', async () => {
        const { undo, els, chrome } = setup({ subTrees: { '5': BOOKMARK_NODE } });
        undo.capture('5');
        undo.showToast('Deleted GH');
        await els['undo-toast-button'].listeners.click();
        expect(chrome.bookmarks.createCalls).toHaveLength(1); // bookmark restored
        expect(els['undo-toast'].hidden).toBe(true);
    });

    it('showToast is a no-op when the toast DOM is missing', () => {
        const { undo } = setup({ noToastDom: true });
        expect(() => undo.showToast('x')).not.toThrow();
        expect(timeouts).toEqual([]);
    });
});

describe('toastAction (v4 task-3 #14)', () => {
    it('fills the text, sets a custom button label and schedules the auto-hide', () => {
        const { undo, els } = setup({});
        undo.toastAction('Target outside the bar', 'Show all', () => {});
        expect(els['undo-toast-text'].textContent).toBe('Target outside the bar');
        expect(els['undo-toast-button'].textContent).toBe('Show all');
        expect(els['undo-toast'].hidden).toBe(false);
        expect(timeouts).toHaveLength(1);
        expect(timeouts[0][1]).toBe(8000);
    });

    it('the button runs the action instead of undo, exactly once, then hides', async () => {
        const { undo, els, chrome } = setup({ subTrees: { '5': BOOKMARK_NODE } });
        undo.capture('5'); // something undoable — must NOT be consumed
        let ran = 0;
        undo.toastAction('hint', 'act', () => { ran++; });
        await els['undo-toast-button'].listeners.click();
        expect(ran).toBe(1);
        expect(els['undo-toast'].hidden).toBe(true);
        expect(chrome.bookmarks.createCalls).toEqual([]); // undo not touched
        expect(undo.canUndo()).toBe(true); // stack still holds the entry
        // a second click (toast re-shown via showToast) falls back to undo
        undo.showToast('Deleted GH');
        expect(els['undo-toast-button'].textContent).toBe('undoAction');
        await els['undo-toast-button'].listeners.click();
        expect(ran).toBe(1);
        expect(chrome.bookmarks.createCalls).toHaveLength(1);
    });

    it('the auto-hide clears a pending action: a later plain toast button click undoes', async () => {
        const { undo, els, chrome } = setup({ subTrees: { '5': BOOKMARK_NODE } });
        undo.capture('5');
        let ran = 0;
        undo.toastAction('hint', 'act', () => { ran++; });
        timeouts[0][0](); // auto-hide fires
        undo.showToast('Deleted GH');
        await els['undo-toast-button'].listeners.click();
        expect(ran).toBe(0);
        expect(chrome.bookmarks.createCalls).toHaveLength(1); // real undo ran
    });

    it('is a no-op when the toast DOM is missing', () => {
        const { undo } = setup({ noToastDom: true });
        expect(() => undo.toastAction('x', 'y', () => {})).not.toThrow();
        expect(timeouts).toEqual([]);
    });
});
