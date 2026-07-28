import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// view-recent.js touches page globals (document/chrome/setTimeout) only
// inside initViewRecent and its handlers, so the real module imports cleanly
// in node once the globals are stubbed. store/views/treeRender/
// separatorManager/treeView are injected recording doubles; the registered
// ViewDef is captured and driven by hand (activate/onKey). setTimeout is a
// record-only stub advanced by hand (tick) for the 300ms debounce. All
// assertions go through the doubles' records and the list's innerHTML —
// nothing is copied from the module body.

let initViewRecent;
let timeouts;        // [[fn, ms, id], ...] in scheduling order
let clearedTimeouts; // ids passed to clearTimeout
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
    ({ initViewRecent } = await import('../src/view-recent.js'));
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
    const $list = makeEl('recent-list');
    const $container = makeEl('view-recent');
    const doc = { getElementById: id => byId[id] || null, activeElement: null };
    globalThis.document = doc;

    const recentItems = opts.recentItems || [];
    const chromeStub = {
        i18n: {
            getMessage: (key, subs) =>
                subs ? `${key}[${[].concat(subs).join('|')}]` : key
        },
        bookmarks: {
            getRecentCalls: [],
            getRecent(n, cb) {
                this.getRecentCalls.push(n);
                cb(recentItems);
            },
            getTreeCalls: 0,
            getTree(cb) {
                this.getTreeCalls++;
                cb(opts.tree || []);
            },
            onCreated: { addListener(fn) { this.fn = fn; } },
            onRemoved: { addListener(fn) { this.fn = fn; } }
        },
        permissions: {
            containsCalls: [],
            contains(p, cb) {
                this.containsCalls.push(p);
                cb(!!opts.hasHistoryPermission);
            },
            requestCalls: [],
            request(p, cb) {
                this.requestCalls.push(p);
                cb('requestGranted' in opts ? opts.requestGranted : true);
            }
        },
        history: {
            searchCalls: [],
            search(q, cb) {
                this.searchCalls.push(q);
                cb(opts.historyItems || []);
            }
        }
    };
    globalThis.chrome = chromeStub;

    const store = {
        _data: { showRecentBookmarks: '1', ...(opts.storeData || {}) },
        get(key, dflt) {
            return key in this._data ? this._data[key] : dflt;
        },
        set(key, v) {
            this._data[key] = v;
        }
    };

    const views = {
        def: null,
        active: 'active' in opts ? opts.active : true,
        register(def) { this.def = def; },
        isActive(id) { return id === 'recent' && this.active; },
        pathOf: opts.pathOf || (() => ''),
        showItemPath: opts.showItemPath || (() => true),
        activateCalls: [],
        activate(...args) { this.activateCalls.push(args); },
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
        checks: [],
        isSeparator(title, url) {
            this.checks.push([title, url]);
            return !!(opts.separatorUrls && opts.separatorUrls.includes(url));
        }
    };
    const treeView = {
        revealCalls: [],
        revealInTree(id) { this.revealCalls.push(id); },
        handlerCalls: 0,
        bookmarkHandler: () => { treeView.handlerCalls++; }
    };
    const visitStats = opts.visitStats || null;
    const undo = opts.undo || null;

    const viewRecent = initViewRecent({
        store, views, treeRender, separatorManager, treeView,
        ...(visitStats ? { visitStats } : {}),
        ...(undo ? { undo } : {})
    });
    return {
        viewRecent, $list, $container, doc, chrome: chromeStub, store, views,
        treeRender, separatorManager, treeView, visitStats, undo,
        def: () => views.def,
        click: ev => $list._listeners.click[0](ev)
    };
};

const NOW = Date.now();
const ITEMS = [
    { id: '101', parentId: '1', title: 'A', url: 'http://a/', dateAdded: NOW },
    { id: '102', parentId: '1', title: 'sep', url: 'http://sep/', dateAdded: NOW },
    { id: '103', parentId: '1', title: 'no url yet', dateAdded: NOW },
    { id: '104', parentId: '2', title: 'B', url: 'http://b/', dateAdded: NOW - 3 * 86400000 }
];

describe('view registration (§5.3)', () => {
    it('registers the recent view with tab metadata and type-ahead off', () => {
        const { def, $list, $container } = setup({});
        expect(def().id).toBe('recent');
        expect(def().titleKey).toBe('viewRecent');
        expect(def().icon).toContain('<svg');
        expect(def().container).toBe($container);
        expect(def().listEl).toBe($list);
        expect(def().typeAhead).toBe(false);
        expect(def().hidden).toBe(false); // showRecentBookmarks default on
        expect(typeof def().activate).toBe('function');
        expect(typeof def().onKey).toBe('function');
    });

    it('showRecentBookmarks migrates to the tab hidden flag', () => {
        const { def } = setup({ storeData: { showRecentBookmarks: '' } });
        expect(def().hidden).toBe(true);
    });

    it('exposes only refresh() on the module API', () => {
        const { viewRecent } = setup({});
        expect(Object.keys(viewRecent)).toEqual(['refresh']);
    });
});

describe('render (docs/v4task-2-list.md §3.3)', () => {
    it('renders getRecent rows with the unified row ids, skipping separators and url-less items', () => {
        const { $list, treeRender, separatorManager, chrome, def } = setup({
            recentItems: ITEMS,
            separatorUrls: ['http://sep/'],
            pathOf: id => `path-of-${id}`
        });
        def().activate(); // first view entry fetches (empty list)
        expect(chrome.bookmarks.getRecentCalls).toEqual([20]);
        const html = $list.innerHTML;
        expect(html).toContain('id="recent-item-101"');
        expect(html).toContain('data-node-id="101"');
        expect(html).toContain('data-parentid="1"');
        expect(html).toContain('<a href="http://a/">A</a>');
        expect(html).not.toContain('102'); // separator filtered out
        expect(html).not.toContain('103'); // no url
        expect(separatorManager.checks).toContainEqual(['sep', 'http://sep/']);
        // rows are virtual (dnd rejects them) and carry the recent meta slots
        expect(treeRender.calls[0].extras).toBe('data-virtual="1"');
        expect(treeRender.calls[0].id).toBe('101');
    });

    it('fills the meta slots: relative time on the right, `path · absolute time` as the second line', () => {
        const { treeRender, def } = setup({
            recentItems: ITEMS,
            separatorUrls: ['http://sep/'],
            pathOf: id => `path-of-${id}`
        });
        def().activate();
        const first = treeRender.calls[0].meta;
        expect(first.path).toBe('path-of-101');
        expect(first.rightText).toBe('timeJustNow');
        const abs = new Date(ITEMS[0].dateAdded).toLocaleString();
        expect(first.subText).toBe(`path-of-101 · ${abs}`);
        // 3 days old → the days bucket with n
        const older = treeRender.calls[1].meta;
        expect(older.rightText).toBe('timeDaysAgo[3]');
    });

    it('drops the path half of the second line when showItemPath is off', () => {
        const { treeRender, def } = setup({
            recentItems: [ITEMS[0]],
            pathOf: () => 'some-path',
            showItemPath: () => false
        });
        def().activate();
        expect(treeRender.calls[0].meta.subText).toBe(new Date(ITEMS[0].dateAdded).toLocaleString());
    });

    it('shows the absolute date for entries older than 7 days', () => {
        const old = { id: '9', parentId: '1', title: 'Old', url: 'http://o/', dateAdded: NOW - 30 * 86400000 };
        const { treeRender, def } = setup({ recentItems: [old] });
        def().activate();
        expect(treeRender.calls[0].meta.rightText).toBe(new Date(old.dateAdded).toLocaleDateString());
    });

    it('renders the empty state when nothing comes back', () => {
        const { $list, def } = setup({ recentItems: [] });
        def().activate();
        expect($list.innerHTML).toContain('<li class="empty-state" role="listitem"><i>recentEmpty</i></li>');
    });
});

describe('refresh lifecycle', () => {
    it('recentCount comes from the setting (default 20, invalid falls back)', () => {
        const { chrome, def } = setup({ storeData: { recentCount: '50' } });
        def().activate();
        expect(chrome.bookmarks.getRecentCalls).toEqual([50]);
        const ctx2 = setup({ storeData: { recentCount: 'junk' } });
        ctx2.def().activate();
        expect(ctx2.chrome.bookmarks.getRecentCalls).toEqual([20]);
    });

    it('skips the fetch while inactive, flagging dirty; activate replays it', () => {
        const { views, chrome, def } = setup({ active: false });
        expect(chrome.bookmarks.getRecentCalls).toEqual([]); // initial refresh gated
        views.active = true;
        def().activate();
        expect(chrome.bookmarks.getRecentCalls).toEqual([20]); // dirty replay
    });

    it('activate on a fresh list fetches even without the dirty flag', () => {
        const { views, chrome, def } = setup({ active: false });
        // simulate a replay that already consumed the dirty flag without HTML
        views.active = true;
        def().activate();
        expect(chrome.bookmarks.getRecentCalls).toEqual([20]);
        // second activate with a filled list does not refetch
        def().activate();
        expect(chrome.bookmarks.getRecentCalls).toEqual([20]);
    });

    it('debounces a burst of onCreated/onRemoved events into one 300ms refresh', () => {
        const { chrome, def } = setup({});
        def().activate();
        expect(chrome.bookmarks.getRecentCalls).toEqual([20]); // initial
        chrome.bookmarks.onCreated.fn();
        chrome.bookmarks.onRemoved.fn();
        expect(clearedTimeouts.length).toBeGreaterThan(0); // the first timer died
        expect(timeouts.filter(t => t[1] === 300)).toHaveLength(1);
        tick(300);
        expect(chrome.bookmarks.getRecentCalls).toEqual([20, 20]); // exactly one refresh
    });

    it('does nothing at all when the view is disabled', () => {
        const { chrome } = setup({ storeData: { showRecentBookmarks: '' } });
        expect(chrome.bookmarks.getRecentCalls).toEqual([]);
        chrome.bookmarks.onCreated.fn();
        chrome.bookmarks.onRemoved.fn();
        expect(timeouts.filter(t => t[1] === 300)).toEqual([]);
    });
});

describe('open + reveal interactions (§2.3)', () => {
    it('plain row clicks pass through to treeView.bookmarkHandler; auxclick binds directly', () => {
        const { $list, treeView, click } = setup({});
        expect($list._listeners.auxclick).toEqual([treeView.bookmarkHandler]);
        const ev = { preventDefault() {}, target: { closest: () => null } };
        click(ev);
        expect(treeView.handlerCalls).toBe(1);
    });

    it('R on a focused row reveals it in the tree and consumes the key', () => {
        const { def, doc, treeView } = setup({});
        const li = { id: 'recent-item-5', dataset: { nodeId: '42' } };
        doc.activeElement = { parentNode: li };
        let prevented = 0;
        const consumed = def().onKey({ key: 'r', preventDefault: () => prevented++ });
        expect(consumed).toBe(true);
        expect(prevented).toBe(1);
        expect(treeView.revealCalls).toEqual(['42']);
        // capital R works too
        def().onKey({ key: 'R', preventDefault: () => {} });
        expect(treeView.revealCalls).toEqual(['42', '42']);
    });

    it('R falls back to the recent-item- id prefix when data-node-id is absent', () => {
        const { def, doc, treeView } = setup({});
        doc.activeElement = { parentNode: { id: 'recent-item-9', dataset: {} } };
        expect(def().onKey({ key: 'r', preventDefault: () => {} })).toBe(true);
        expect(treeView.revealCalls).toEqual(['9']);
    });

    it('declines other keys and rows without an id', () => {
        const { def, doc, treeView } = setup({});
        doc.activeElement = { parentNode: { id: 'recent-item-5', dataset: {} } };
        expect(def().onKey({ key: 'x', preventDefault: () => {} })).toBe(false);
        doc.activeElement = { parentNode: { id: 'recent-item-', dataset: {} } };
        expect(def().onKey({ key: 'r', preventDefault: () => {} })).toBe(false);
        doc.activeElement = null;
        expect(def().onKey({ key: 'r', preventDefault: () => {} })).toBe(false);
        expect(treeView.revealCalls).toEqual([]);
    });
});


describe('history-permission banner (item 7a)', () => {
    const statsOn = () => ({
        enabled: () => true,
        mergeCalls: [],
        merge(entries) { this.mergeCalls.push(entries); return entries.length; }
    });
    const undoOn = () => ({
        toastCalls: [],
        showToast(msg) { this.toastCalls.push(msg); }
    });
    const IMPORT_TREE = [{
        id: '0', title: '', children: [
            {
                id: '1', parentId: '0', title: 'bar', children: [
                    { id: '11', parentId: '1', title: 'A', url: 'http://a/' },
                    { id: '12', parentId: '1', title: 'A dup', url: 'http://a/' },
                    { id: '13', parentId: '1', title: 'B', url: 'http://b/' }
                ]
            }
        ]
    }];
    const HISTORY = [
        { url: 'http://a/', visitCount: 5, lastVisitTime: 1000 },
        { url: 'http://elsewhere/', visitCount: 9, lastVisitTime: 9 } // no bookmark
    ];

    it('shows the banner while stats is on, the permission is missing and not dismissed', () => {
        const { $list, def } = setup({ visitStats: statsOn() });
        def().activate();
        const html = $list.innerHTML;
        expect(html).toContain('class="stats-history-banner"');
        expect(html).toContain('statsHistoryBanner');
        expect(html).toContain('class="stats-history-enable"');
        expect(html).toContain('stats-history-dismiss');
    });

    it('stays hidden when the permission is granted, the banner is dismissed, or stats is off', () => {
        const granted = setup({
            visitStats: statsOn(),
            hasHistoryPermission: true,
            storeData: { statsHistoryImportedAt: '1' }
        });
        granted.def().activate();
        expect(granted.$list.innerHTML).not.toContain('stats-history-banner');
        expect(granted.chrome.history.searchCalls).toEqual([]); // already imported

        const dismissed = setup({
            visitStats: statsOn(),
            storeData: { statsHistoryBannerDismissed: '1' }
        });
        dismissed.def().activate();
        expect(dismissed.$list.innerHTML).not.toContain('stats-history-banner');

        const off = setup({ visitStats: { enabled: () => false, merge: () => 0 } });
        off.def().activate();
        expect(off.$list.innerHTML).not.toContain('stats-history-banner');
    });

    it('auto-imports when the grant landed while the popup was closed (one-shot via statsHistoryImportedAt)', () => {
        const visitStats = statsOn();
        const undo = undoOn();
        const { chrome, store, views, def } = setup({
            visitStats, undo,
            hasHistoryPermission: true,
            tree: IMPORT_TREE,
            historyItems: HISTORY
        });
        def().activate();
        // both copies of the duplicated URL earn the baseline; non-bookmarks skip
        expect(visitStats.mergeCalls).toEqual([[
            { id: '11', c: 5, t: 1000 },
            { id: '12', c: 5, t: 1000 }
        ]]);
        expect(undo.toastCalls).toEqual(['statsHistoryImported[2]']);
        expect(store.get('statsHistoryImportedAt')).toBeTruthy();
        expect(views.badgeCalls).toBeGreaterThan(0);
    });

    it('the enable link requests the permission and imports on grant; denial keeps the banner', () => {
        const visitStats = statsOn();
        const undo = undoOn();
        const granted = setup({
            visitStats, undo,
            hasHistoryPermission: false,
            requestGranted: true,
            tree: IMPORT_TREE,
            historyItems: HISTORY
        });
        granted.def().activate();
        expect(granted.$list.innerHTML).toContain('stats-history-banner');
        granted.click({
            preventDefault() {},
            target: { closest: sel => (sel === '.stats-history-enable' ? {} : null) }
        });
        expect(granted.chrome.permissions.requestCalls).toEqual([{ permissions: ['history'] }]);
        expect(visitStats.mergeCalls).toHaveLength(1);
        expect(granted.$list.innerHTML).not.toContain('stats-history-banner');

        const denied = setup({ visitStats: statsOn(), requestGranted: false });
        denied.def().activate();
        denied.click({
            preventDefault() {},
            target: { closest: sel => (sel === '.stats-history-enable' ? {} : null) }
        });
        expect(denied.$list.innerHTML).toContain('stats-history-banner'); // stays
    });

    it('the dismiss × persists and hides the banner', () => {
        const { $list, store, def, click } = setup({ visitStats: statsOn() });
        def().activate();
        expect($list.innerHTML).toContain('stats-history-banner');
        click({
            preventDefault() {},
            target: { closest: sel => (sel === '.stats-history-dismiss' ? {} : null) }
        });
        expect(store.get('statsHistoryBannerDismissed')).toBe('1');
        expect($list.innerHTML).not.toContain('stats-history-banner');
    });
});
