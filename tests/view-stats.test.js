import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// view-stats.js touches page globals (document/chrome/setTimeout) only
// inside initViewStats and its handlers, so the real module imports cleanly
// in node once the globals are stubbed. store/views/treeRender/
// separatorManager/treeView/dialogs/visitStats are injected recording
// doubles; the registered ViewDef is captured and driven by hand.
// Assertions go through the doubles' records and the list's innerHTML —
// nothing is copied from the module body.

let initViewStats;
let timeouts;
let clearedTimeouts;
let timerSeq = 1;
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

beforeAll(async () => {
    globalThis.setTimeout = (fn, ms) => {
        const id = timerSeq++;
        timeouts.push([fn, ms, id]);
        return id;
    };
    globalThis.clearTimeout = id => {
        clearedTimeouts.push(id);
        timeouts = timeouts.filter(t => t[2] !== id);
    };
    ({ initViewStats } = await import('../src/view-stats.js'));
});

beforeEach(() => {
    timeouts = [];
    clearedTimeouts = [];
    timerSeq = 1;
});

afterAll(() => {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
    delete globalThis.chrome;
    delete globalThis.document;
});

const tick = ms => {
    const due = timeouts.filter(t => t[1] === ms);
    timeouts = timeouts.filter(t => t[1] !== ms);
    due.forEach(t => t[0]());
};

const TREE = [
    {
        id: '0', children: [
            {
                id: '1', title: 'bar', children: [
                    { id: '7', title: 'Alpha', url: 'http://a/', parentId: '1', dateAdded: 1 }
                ]
            },
            { id: '8', title: 'Beta', url: 'http://b/', parentId: '0', dateAdded: 2 },
            { id: '9', title: 'Sep', url: 'http://sep/', parentId: '0', dateAdded: 3 }
        ]
    }
];

const setup = (opts = {}) => {
    const byId = {};
    const makeEl = id => {
        const el = {
            id,
            innerHTML: '',
            _listeners: {},
            addEventListener(type, fn) {
                (this._listeners[type] = this._listeners[type] || []).push(fn);
            }
        };
        byId[id] = el;
        return el;
    };
    const $list = makeEl('stats-list');
    const $container = makeEl('view-stats');
    globalThis.document = { getElementById: id => byId[id] || null, activeElement: null };

    const chromeStub = {
        i18n: {
            getMessage: (key, subs) =>
                subs ? `${key}[${[].concat(subs).join('|')}]` : key
        },
        bookmarks: {
            getTreeCalls: 0,
            getTree(cb) { this.getTreeCalls++; cb(opts.tree || TREE); },
            onRemoved: { addListener(fn) { this.fn = fn; } }
        }
    };
    globalThis.chrome = chromeStub;

    const store = {
        _data: { ...(opts.storeData || {}) },
        sets: [],
        get(key, dflt) { return key in this._data ? this._data[key] : dflt; },
        set(key, v) { this.sets.push([key, v]); this._data[key] = v; }
    };

    const views = {
        def: null,
        active: 'active' in opts ? opts.active : true,
        register(def) { this.def = def; },
        isActive(id) { return id === 'stats' && this.active; },
        pathOf: opts.pathOf || (id => (id === '7' ? 'bar' : '')),
        showItemPath: () => true,
        badgeCalls: 0,
        updateBadges() { this.badgeCalls++; }
    };

    const treeRender = {
        calls: [],
        generateBookmarkHTML(title, url, extras, id, positions, meta) {
            this.calls.push({ title, url, extras, id, positions, meta });
            return `<a href="${url}">${title}</a>`;
        }
    };
    const separatorManager = {
        isSeparator: (title, url) => url === 'http://sep/'
    };
    const treeView = {
        handlerCalls: [],
        bookmarkHandler(e) { this.handlerCalls.push(e); }
    };
    const dialogs = {
        confirmCalls: [],
        ConfirmDialog: {
            open(opts2) { dialogs.confirmCalls.push(opts2); }
        }
    };
    const visitStats = {
        data: opts.statsData || {},
        cleared: 0,
        enabledValue: 'enabled' in opts ? opts.enabled : true,
        all() { return this.data; },
        clear() { this.cleared++; this.data = {}; },
        enabled() { return this.enabledValue; }
    };

    const viewStats = initViewStats({
        store, views, treeRender, separatorManager, treeView, dialogs, visitStats
    });
    return {
        viewStats, $list, $container, chrome: chromeStub, store, views,
        treeRender, treeView, dialogs, visitStats,
        def: () => views.def,
        click: ev => $list._listeners.click[0](ev)
    };
};

const NOW = Date.now();

describe('registration', () => {
    it('registers the stats ViewDef with the tab metadata', () => {
        const { def, $list, $container } = setup({});
        expect(def().id).toBe('stats');
        expect(def().titleKey).toBe('viewStats');
        expect(def().typeAhead).toBe(false);
        expect(def().container).toBe($container);
        expect(def().listEl).toBe($list);
        expect(typeof def().icon).toBe('string');
    });
});

describe('rendering (sort by count, the default)', () => {
    it('renders one row per bookmark with recorded visits, count desc', () => {
        const s = setup({
            statsData: {
                '7': { c: 2, t: NOW - 1000 },
                '8': { c: 5, t: NOW - 2000 }
            }
        });
        s.def().activate();
        expect(s.chrome.bookmarks.getTreeCalls).toBe(1);
        // 8 (5 opens) before 7 (2 opens)
        expect(s.treeRender.calls.map(c => c.id)).toEqual(['8', '7']);
        const first = s.treeRender.calls[0].meta;
        expect(first.badge).toEqual({ text: '×5', cls: 'count', aria: 'statsVisitCount[5]' });
        expect(first.rightText).toBe('timeJustNow');
        expect(first.subText).toBe(''); // 8 lives at root — pathOf gives ''
        const second = s.treeRender.calls[1].meta;
        expect(second.subText).toBe('bar'); // 7's parent path
        expect(s.$list.innerHTML).toContain('id="stats-item-8"');
        expect(s.$list.innerHTML).toContain('data-node-id="7"');
    });

    it('skips bookmarks without stats and separators with stats', () => {
        const s = setup({
            statsData: {
                '8': { c: 1, t: NOW },
                '9': { c: 9, t: NOW }, // separator — filtered by flattenTree
                '42': { c: 3, t: NOW }  // no longer in the tree
            }
        });
        s.def().activate();
        expect(s.treeRender.calls.map(c => c.id)).toEqual(['8']);
    });

    it('ties on count break by recency', () => {
        const s = setup({
            statsData: {
                '7': { c: 2, t: NOW - 5000 },
                '8': { c: 2, t: NOW - 1000 }
            }
        });
        s.def().activate();
        expect(s.treeRender.calls.map(c => c.id)).toEqual(['8', '7']);
    });
});

describe('sort switching', () => {
    it('recent sort orders by t desc and swaps the meta slots', () => {
        const s = setup({
            storeData: { statsSort: 'recent' },
            statsData: {
                '7': { c: 2, t: NOW - 1000 },
                '8': { c: 5, t: NOW - 90000 }
            }
        });
        s.def().activate();
        expect(s.treeRender.calls.map(c => c.id)).toEqual(['7', '8']);
        const first = s.treeRender.calls[0].meta;
        expect(first.badge).toEqual({ text: 'timeJustNow', cls: 'time' });
        expect(first.rightText).toBe('×2');
    });

    it('clicking the recent segment persists statsSort and re-renders', () => {
        const s = setup({
            statsData: { '7': { c: 2, t: NOW - 1000 }, '8': { c: 5, t: NOW - 90000 } }
        });
        s.def().activate();
        s.click({
            preventDefault() {},
            target: { closest: sel => sel === '.seg-btn' ? { dataset: { sort: 'recent' } } : null }
        });
        expect(s.store.sets).toEqual([['statsSort', 'recent']]);
        expect(s.treeRender.calls.map(c => c.id)).toEqual(['8', '7', '7', '8']);
    });

    it('clicking the already-active segment writes nothing', () => {
        const s = setup({ statsData: { '7': { c: 1, t: NOW } } });
        s.def().activate();
        s.click({
            preventDefault() {},
            target: { closest: sel => sel === '.seg-btn' ? { dataset: { sort: 'count' } } : null }
        });
        expect(s.store.sets).toEqual([]);
        expect(s.chrome.bookmarks.getTreeCalls).toBe(1);
    });
});

describe('toolbar', () => {
    it('marks the active segment with aria-pressed and offers the clear button', () => {
        const s = setup({ statsData: { '7': { c: 1, t: NOW } } });
        s.def().activate();
        expect(s.$list.innerHTML).toContain('data-sort="count" aria-pressed="true"');
        expect(s.$list.innerHTML).toContain('data-sort="recent" aria-pressed="false"');
        expect(s.$list.innerHTML).toContain('<button class="stats-clear">statsClearData</button>');
    });

    it('disables the clear button when there is nothing to clear', () => {
        const s = setup({});
        s.def().activate();
        expect(s.$list.innerHTML).toContain('<button class="stats-clear" disabled>');
    });
});

describe('empty and disabled states', () => {
    it('shows statsEmpty when nothing has been recorded', () => {
        const s = setup({});
        s.def().activate();
        expect(s.$list.innerHTML).toContain('<i>statsEmpty</i>');
    });

    it('shows the disabled hint instead of data while statsEnabled is off', () => {
        const s = setup({ enabled: false, statsData: { '7': { c: 3, t: NOW } } });
        s.def().activate();
        expect(s.$list.innerHTML).toContain('<i>statsDisabledHint</i>');
        expect(s.treeRender.calls).toEqual([]);
    });
});

describe('clear statistics', () => {
    it('gates on ConfirmDialog and fn1 wipes + re-renders', () => {
        const s = setup({
            statsData: { '7': { c: 1, t: NOW }, '8': { c: 2, t: NOW } }
        });
        s.def().activate();
        s.click({
            preventDefault() {},
            target: { closest: sel => sel === '.stats-clear' ? {} : null }
        });
        expect(s.dialogs.confirmCalls).toHaveLength(1);
        const opts = s.dialogs.confirmCalls[0];
        expect(opts.dialog).toBe('statsClearConfirm[2]');
        expect(opts.button1).toBe('<strong>statsClearData</strong>');
        expect(opts.button2).toBe('nope');
        opts.fn1();
        expect(s.visitStats.cleared).toBe(1);
        expect(s.$list.innerHTML).toContain('<i>statsEmpty</i>');
    });

    it('does nothing when the dataset is empty', () => {
        const s = setup({});
        s.def().activate();
        s.click({
            preventDefault() {},
            target: { closest: sel => sel === '.stats-clear' ? {} : null }
        });
        expect(s.dialogs.confirmCalls).toEqual([]);
    });
});

describe('refresh lifecycle', () => {
    it('recomputes in the background while inactive (tab badge stays fresh) and repaints on activation', () => {
        const s = setup({ active: false, statsData: { '7': { c: 1, t: NOW } } });
        s.viewStats.refresh();
        // the dataset is recomputed (badge bump) but nothing is painted
        expect(s.chrome.bookmarks.getTreeCalls).toBe(1);
        expect(s.views.badgeCalls).toBe(1);
        expect(s.$list.innerHTML).toBe('');
        s.views.active = true;
        s.def().activate(); // dirty → replay + repaint
        expect(s.chrome.bookmarks.getTreeCalls).toBe(2);
        expect(s.$list.innerHTML).toContain('stats-item-7');
    });

    it('re-renders (debounced) when a bookmark is removed', () => {
        const s = setup({ statsData: { '7': { c: 1, t: NOW } } });
        s.def().activate();
        expect(s.chrome.bookmarks.getTreeCalls).toBe(1);
        s.chrome.bookmarks.onRemoved.fn();
        tick(300);
        expect(s.chrome.bookmarks.getTreeCalls).toBe(2);
    });
});

describe('row clicks', () => {
    it('passes plain row clicks to the shared bookmarkHandler', () => {
        const s = setup({ statsData: { '7': { c: 1, t: NOW } } });
        s.def().activate();
        const ev = { preventDefault() {}, target: { closest: () => null } };
        s.click(ev);
        expect(s.treeView.handlerCalls).toEqual([ev]);
    });
});
