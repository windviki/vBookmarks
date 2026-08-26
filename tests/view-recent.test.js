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
let initVisitStats;
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
    // the real store module backs the import-persistence tests (项5) — the
    // recording double can't prove the dataset lands before the gate
    ({ initVisitStats } = await import('../src/visit-stats.js'));
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
    const $list = makeEl('staging-list');
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
            onRemoved: { addListener(fn) { this.fn = fn; } },
            onChanged: { addListener(fn) { this.fn = fn; } },
            getSubTreeCalls: [],
            getSubTree(id, cb) {
                this.getSubTreeCalls.push(id);
                cb(opts.subTree || []);
            },
            getCalls: [],
            get(id, cb) {
                this.getCalls.push(id);
                cb((opts.nodes || {})[id] || []);
            },
            searchCalls: [],
            search(q, cb) {
                this.searchCalls.push(q);
                cb((opts.searchResults || {})[q.url] || []);
            }
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
            pending: [], // deferred callbacks (opts.deferHistory)
            search(q, cb) {
                this.searchCalls.push(q);
                if (opts.deferHistory)
                    this.pending.push(cb);
                else
                    cb(opts.historyItems || []);
            }
        }
    };
    chromeStub.runtime = { lastError: undefined };
    chromeStub.storage = {
        listeners: [],
        onChanged: { addListener(fn) { chromeStub.storage.listeners.push(fn); } }
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
    // opts.realVisitStats swaps the recording double for the real module so
    // the import tests can assert the actual persisted dataset (项5)
    const visitStats = opts.realVisitStats
        ? initVisitStats({ store, debounceMs: 0 })
        : (opts.visitStats || null);
    const undo = opts.undo || null;

    const viewRecent = initViewRecent({
        store, views, treeRender, separatorManager, treeView,
        ...(visitStats ? { visitStats } : {}),
        ...(undo ? { undo } : {}),
        ...(opts.dialogs ? { dialogs: opts.dialogs } : {}),
        ...(opts.actions ? { actions: opts.actions } : {}),
        ...(opts.onRowsRendered ? { onRowsRendered: opts.onRowsRendered } : {})
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

describe('render hooks (fifth round, item: dead-mark overlays)', () => {
    it('calls onRowsRendered after every render with the rows in the DOM', () => {
        const seen = [];
        const { def, $list } = setup({
            recentItems: ITEMS,
            onRowsRendered: () => seen.push($list.innerHTML)
        });
        def().activate();
        expect(seen).toHaveLength(1);
        expect(seen[0]).toContain('recent-item-101');
    });
});

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
    });

    it('showRecentBookmarks migrates to the tab hidden flag', () => {
        const { def } = setup({ storeData: { showRecentBookmarks: '' } });
        expect(def().hidden).toBe(true);
    });

    it('exposes refresh + the staging api + onTreeSnapshot', () => {
        const { viewRecent } = setup({});
        expect(Object.keys(viewRecent)).toEqual(['refresh', 'api', 'onTreeSnapshot']);
        expect(typeof viewRecent.api.addItems).toBe('function');
        expect(typeof viewRecent.api.sendFolder).toBe('function');
        expect(typeof viewRecent.onTreeSnapshot).toBe('function');
    });
});

describe('render (docs/plan-4.0.0/v4task-2-list.md §3.3)', () => {
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

    it('fills the meta slots: relative time as the left time column, path right-aligned, `path · absolute time` second line', () => {
        const { treeRender, def } = setup({
            recentItems: ITEMS,
            separatorUrls: ['http://sep/'],
            pathOf: id => `path-of-${id}`
        });
        def().activate();
        const first = treeRender.calls[0].meta;
        expect(first.path).toBe('path-of-101');
        expect(first.badge).toEqual({ text: 'timeJustNow', cls: 'time' });
        expect(first.rightText).toBe('path-of-101');
        const abs = new Date(ITEMS[0].dateAdded).toLocaleString();
        expect(first.subText).toBe(`path-of-101 · ${abs}`);
        // 3 days old → the days bucket with n
        const older = treeRender.calls[1].meta;
        expect(older.badge).toEqual({ text: 'timeDaysAgo[3]', cls: 'time' });
        expect(older.rightText).toBe('path-of-104');
    });

    it('drops the path half of the second line when showItemPath is off', () => {
        const { treeRender, def } = setup({
            recentItems: [ITEMS[0]],
            pathOf: () => 'some-path',
            showItemPath: () => false
        });
        def().activate();
        expect(treeRender.calls[0].meta.subText).toBe(new Date(ITEMS[0].dateAdded).toLocaleString());
        // no path column either — the right slot is empty, the time stays
        expect(treeRender.calls[0].meta.rightText).toBe('');
        expect(treeRender.calls[0].meta.badge).toEqual({ text: 'timeJustNow', cls: 'time' });
    });

    it('shows the absolute date for entries older than 7 days in the time column', () => {
        const old = { id: '9', parentId: '1', title: 'Old', url: 'http://o/', dateAdded: NOW - 30 * 86400000 };
        const { treeRender, def } = setup({ recentItems: [old] });
        def().activate();
        expect(treeRender.calls[0].meta.badge).toEqual(
            { text: new Date(old.dateAdded).toLocaleDateString(), cls: 'time' });
        expect(treeRender.calls[0].meta.rightText).toBe(''); // no path
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
        toastCalls: [], actionCalls: [],
        showToast(msg) { this.toastCalls.push(msg); },
        toastAction(msg, label, fn) { this.actionCalls.push([msg, label, fn]); }
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

describe('history import chain (第四轮项5)', () => {
    const statsOn = () => ({
        enabled: () => true,
        mergeCalls: [],
        merge(entries) { this.mergeCalls.push(entries); return entries.length; }
    });
    const undoOn = () => ({
        toastCalls: [], actionCalls: [],
        showToast(msg) { this.toastCalls.push(msg); },
        toastAction(msg, label, fn) { this.actionCalls.push([msg, label, fn]); }
    });
    const enableClick = {
        preventDefault() {},
        target: { closest: sel => (sel === '.stats-history-enable' ? {} : null) }
    };
    const TREE = [{
        id: '0', title: '', children: [
            {
                id: '1', parentId: '0', title: 'bar', children: [
                    { id: '11', parentId: '1', title: 'A', url: 'http://a/' },
                    { id: '12', parentId: '1', title: 'A bare host', url: 'http://bare' }, // no trailing slash
                    { id: '13', parentId: '1', title: 'B', url: 'http://b/' }
                ]
            }
        ]
    }];
    const HISTORY = [
        { url: 'http://a/', visitCount: 5, lastVisitTime: 1000 },
        { url: 'http://bare/', visitCount: 3, lastVisitTime: 900 }, // history normalizes the bare host
        { url: 'http://elsewhere/', visitCount: 9, lastVisitTime: 9 } // no bookmark
    ];

    it('searches the full history range, not just the 2000 most recent URLs', () => {
        const { chrome, def } = setup({
            visitStats: statsOn(),
            hasHistoryPermission: true,
            tree: TREE,
            historyItems: HISTORY
        });
        def().activate();
        expect(chrome.history.searchCalls).toEqual([{ text: '', startTime: 0, maxResults: 100000 }]);
    });

    it('pairs history URLs with bookmarks across the trailing-slash fold; non-bookmarks stay dropped', () => {
        const visitStats = statsOn();
        const { def } = setup({
            visitStats,
            hasHistoryPermission: true,
            tree: TREE,
            historyItems: HISTORY
        });
        def().activate();
        // the bookmark saved without a slash still matches history's folded URL
        expect(visitStats.mergeCalls).toEqual([[
            { id: '11', c: 5, t: 1000 },
            { id: '12', c: 3, t: 900 }
        ]]);
    });

    it('grant → import lands the dataset synchronously, gate stamped after it (real visit-stats)', () => {
        const undo = undoOn();
        const { store, visitStats, def, click } = setup({
            realVisitStats: true,
            undo,
            hasHistoryPermission: false,
            requestGranted: true,
            tree: TREE,
            historyItems: HISTORY
        });
        const sets = [];
        const origSet = store.set.bind(store);
        store.set = (k, v) => { sets.push(k); origSet(k, v); };
        def().activate();
        click(enableClick);
        // acceptance: every bookmarked URL present in history now has a count
        // in the very dataset the stats view renders (visitStats.all)
        expect(visitStats.all()).toEqual({
            '11': { c: 5, t: 1000 },
            '12': { c: 3, t: 900 }
        });
        // …and it is already in the store mirror — no debounced write can
        // die with the popup leaving the stamped gate behind
        expect(JSON.parse(store.get('visitStats'))).toEqual(visitStats.all());
        expect(store.get('statsHistoryImportedAt')).toBeTruthy();
        expect(sets.indexOf('visitStats')).toBeGreaterThanOrEqual(0);
        expect(sets.indexOf('visitStats')).toBeLessThan(sets.indexOf('statsHistoryImportedAt'));
        expect(undo.toastCalls).toEqual(['statsHistoryImported[2]']);
    });

    it('a second probe while the search is in flight does not double-import', () => {
        const visitStats = statsOn();
        const { chrome, store, def } = setup({
            visitStats,
            undo: undoOn(),
            hasHistoryPermission: true,
            deferHistory: true,
            tree: TREE,
            historyItems: HISTORY
        });
        // the startup probe already kicked an import off (search pending)
        expect(chrome.history.searchCalls).toHaveLength(1);
        def().activate(); // probe: granted + gate unstamped, but import in flight
        expect(chrome.history.searchCalls).toHaveLength(1); // no second search
        chrome.history.pending[0](HISTORY); // the async callback lands
        expect(visitStats.mergeCalls).toHaveLength(1); // additive merge ran once
        expect(store.get('statsHistoryImportedAt')).toBeTruthy();
        def().activate(); // gate now stamped — still no re-import
        expect(chrome.history.searchCalls).toHaveLength(1);
        expect(visitStats.mergeCalls).toHaveLength(1);
    });
});

describe('coarse time sections (第四轮项8)', () => {
    const DAY = 86400000;
    const HOUR = 3600000;
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const SOD = midnight.getTime(); // start of the local calendar day
    const mk = (id, ts) => ({
        id: `${id}`, parentId: '1', title: `t${id}`, url: `http://h${id}/`, dateAdded: ts
    });
    const heads = html =>
        [...html.matchAll(/<li class="recent-group-li[^"]*" data-recent-group="(\d)"/g)]
            .map(m => m[1]);

    it('segments the desc list into 今天/本周/本月/更早, one header per group', () => {
        const { $list, def } = setup({
            recentItems: [
                mk(1, NOW),            // today
                mk(2, SOD),            // today (exactly local midnight)
                mk(3, SOD - 1),        // 1ms before midnight → this week
                mk(4, NOW - 6 * DAY),  // this week
                mk(5, NOW - 8 * DAY),  // this month
                mk(6, NOW - 29 * DAY), // this month
                mk(7, NOW - 31 * DAY)  // older
            ]
        });
        def().activate();
        const html = $list.innerHTML;
        expect(heads(html)).toEqual(['0', '1', '2', '3']);
        // a REAL head li leads its own contiguous member rows (折叠记忆轮):
        // the head precedes the first member, member rows carry
        // data-recent-group so the surgical fold can move exactly that block.
        const at = s => html.indexOf(s);
        expect(at('class="recent-group-li')).toBeLessThan(at('id="recent-item-1"'));
        // the SECOND head li follows item-2's rows and leads item-3's
        expect(at('id="recent-item-3"')).toBeGreaterThan(at('class="recent-group-li', at('id="recent-item-1"') + 1));
        expect(html).toContain('data-recent-group="0"');
        expect(html).toContain('data-recent-group="3"');
        expect(html).not.toContain('has-head');
    });

    it('pins 今天 to the local calendar day: midnight is today, 1ms before is 本周', () => {
        const { $list, def } = setup({ recentItems: [mk(1, SOD), mk(2, SOD - 1)] });
        def().activate();
        expect(heads($list.innerHTML)).toEqual(['0', '1']);
    });

    it('pins 本周 to a rolling 7×24h (not the calendar week)', () => {
        const { $list, def } = setup({
            recentItems: [mk(1, NOW - 7 * DAY + HOUR), mk(2, NOW - 7 * DAY - HOUR)]
        });
        def().activate();
        expect(heads($list.innerHTML)).toEqual(['1', '2']);
    });

    it('pins 本月 to a rolling 30×24h (not the calendar month)', () => {
        const { $list, def } = setup({
            recentItems: [mk(1, NOW - 30 * DAY + HOUR), mk(2, NOW - 30 * DAY - HOUR)]
        });
        def().activate();
        expect(heads($list.innerHTML)).toEqual(['2', '3']);
    });

    it('repeats no header within a group and hides empty groups', () => {
        const { $list, def } = setup({
            recentItems: [mk(1, NOW), mk(2, SOD), mk(3, NOW - 40 * DAY)]
        });
        def().activate();
        expect(heads($list.innerHTML)).toEqual(['0', '3']);
    });

    it('renders no headers in the empty state', () => {
        const { $list, def } = setup({ recentItems: [] });
        def().activate();
        expect($list.innerHTML).not.toContain('recent-group-head');
    });

    it('a time-bucket head folds its own rows (surgical) and persists recentGroupCollapsed', () => {
        const { store, $list, def, click } = setup({ recentItems: [mk(1, NOW), mk(2, NOW - 40 * DAY)] });
        def().activate();
        expect($list.innerHTML).toContain('id="recent-item-1"');
        click({
            preventDefault() {}, stopPropagation() {},
            target: {
                closest: sel => (sel === '.recent-group-head' ? {}
                    : (sel === '.recent-group-li' ? { dataset: { recentGroup: '0' } } : null))
            }
        });
        const saved = JSON.parse(store.get('staging'));
        expect(saved.recentGroupCollapsed.recentGroupToday).toBe(true);
        expect($list.innerHTML).not.toContain('id="recent-item-1"'); // the bucket's rows fold
        expect($list.innerHTML).toContain('id="recent-item-2"');    // other bucket stays
        expect($list.innerHTML).toContain('class="recent-group-li'); // head stays
        // unfold: the bucket's rows come back and the state persists false
        click({
            preventDefault() {}, stopPropagation() {},
            target: {
                closest: sel => (sel === '.recent-group-head' ? {}
                    : (sel === '.recent-group-li' ? { dataset: { recentGroup: '0' } } : null))
            }
        });
        expect(JSON.parse(store.get('staging')).recentGroupCollapsed.recentGroupToday).toBe(false);
        expect($list.innerHTML).toContain('id="recent-item-1"');
    });

    it('time-bucket heads are REAL foldable group heads (折叠记忆轮)', () => {
        const { $list, def } = setup({ recentItems: [mk(1, NOW)] });
        def().activate();
        const m = $list.innerHTML.match(/<li class="recent-group-li" data-recent-group="0"[^>]*>[\s\S]*?<\/li>/);
        expect(m).not.toBe(null);
        expect(m[0]).toContain('role="presentation"'); // the li stays presentational
        expect(m[0]).toContain('aria-expanded="true"');
        // the fold control is a span head (role=button, in the walk via
        // tabindex -1) with a chevron, a title and a count pill
        expect(m[0]).toMatch(/<span class="group-head recent-group-head" role="button" tabindex="-1"/);
        expect(m[0]).toContain('chevron');
        expect(m[0]).toContain('count-pill');
        // velvet staging: the per-bucket send button is mouse-only by design
        // (tabindex -1)
        const btn = $list.innerHTML.match(/<button[^>]*class="row-btn recent-group-stage"[^>]*>/);
        expect(btn).not.toBe(null);
        expect(btn[0]).toContain('tabindex="-1"');
    });

    it('time-bucket heads lead with the clock glyph, single-line (2026-08 icon round)', () => {
        // The 2026-08-25 icon round replaced the meta sub line with a leading
        // CLOCK glyph on the bucket-star slot — glyph-then-title like the
        // staging heads (folder / hollow star), no second line.
        const { $list, def } = setup({ recentItems: [mk(1, NOW), mk(2, NOW - 8 * DAY), mk(3, NOW - 40 * DAY)] });
        def().activate();
        const html = $list.innerHTML;
        expect(html).toMatch(/<i class="recent-group-clock"[^>]*><svg class="vbm-icon vbm-icon-clock"/);
        expect(html).not.toContain('head-sub');
        expect(html).not.toContain('recentGroupSince');
        expect(html).not.toContain('recentGroupBefore');
    });
});

describe('row focus park/restore (4.0.1 focus law)', () => {
    // The recent view has no toolbar pair, so this is the list's only
    // park/restore: every refresh's innerHTML swap replaces the focused row
    // (each onCreated/onRemoved repaint) and the ↓ walk used to die on
    // <body>. The doubles model the swap the way the real DOM behaves:
    // assigning innerHTML replaces the li set querySelectorAll('li') hands
    // out, and the hand-written focus() lands on doc.activeElement.
    const wireSwap = ($list, doc) => {
        const swap = { current: [], next: null };
        let html = $list.innerHTML;
        Object.defineProperty($list, 'innerHTML', {
            get() { return html; },
            set(v) {
                html = v;
                if (swap.next) {
                    swap.current = swap.next;
                    swap.next = null;
                }
            }
        });
        $list.querySelectorAll = sel => (sel === 'li' ? swap.current : []);
        $list.focus = function () { doc.activeElement = this; };
        return swap;
    };
    const ulOf = $list => ({ tagName: 'UL', parentNode: $list });
    // a row double: li + anchor, parented up to the list (a → li → ul → $list)
    const row = (doc, ul, id) => {
        const a = {
            tagName: 'A',
            focus() { doc.activeElement = this; }
        };
        const li = {
            tagName: 'LI', id: id || '',
            parentNode: ul,
            getAttribute: () => null,
            querySelector: sel => (sel === 'a, span' ? a : null)
        };
        a.parentNode = li;
        return { li, a };
    };
    const recentSetup = () => {
        const ctx = setup({ recentItems: ITEMS });
        ctx.def().activate();
        return ctx;
    };

    it('a focused recent row regains focus on its same-id replacement after a re-render', () => {
        const { $list, doc, viewRecent } = recentSetup();
        const swap = wireSwap($list, doc);
        const ul = ulOf($list);
        const oldRow = row(doc, ul, 'recent-item-101');
        swap.current = [oldRow.li];
        doc.activeElement = oldRow.a;
        // the post-swap replacement row: same id, new element
        const newRow = row(doc, ul, 'recent-item-101');
        swap.next = [newRow.li];
        const origGet = doc.getElementById;
        doc.getElementById = id => (id === 'recent-item-101' ? newRow.li : origGet(id));
        viewRecent.refresh(); // the onCreated/onRemoved debounce's repaint
        expect(doc.activeElement).toBe(newRow.a);
    });

    it('a vanished row id falls back to the index-clamped row', () => {
        const { $list, doc, viewRecent } = recentSetup();
        const swap = wireSwap($list, doc);
        const ul = ulOf($list);
        const r1 = row(doc, ul, 'recent-item-101');
        const r2 = row(doc, ul, 'recent-item-104');
        const r3 = row(doc, ul, 'recent-item-105');
        swap.current = [r1.li, r2.li, r3.li]; // focus sits on the third row
        doc.activeElement = r3.a;
        // row 105 is gone after the repaint — no getElementById hit — and
        // the list shrank to two rows
        const n1 = row(doc, ul, 'recent-item-101');
        const n2 = row(doc, ul, 'recent-item-104');
        swap.next = [n1.li, n2.li];
        viewRecent.refresh();
        expect(doc.activeElement).toBe(n2.a); // min(2, 1) → the second row
    });

    it('with no rows at all after the swap, focus parks on the list container', () => {
        const { $list, doc, viewRecent } = recentSetup();
        const swap = wireSwap($list, doc);
        const ul = ulOf($list);
        const oldRow = row(doc, ul, 'recent-item-101');
        swap.current = [oldRow.li];
        doc.activeElement = oldRow.a;
        swap.next = []; // nothing left to focus
        viewRecent.refresh();
        expect(doc.activeElement).toBe($list);
    });

    it('focus outside the list is left untouched by the render', () => {
        const { doc, viewRecent } = recentSetup();
        const outside = { tagName: 'BUTTON' }; // no LI anywhere up the chain
        doc.activeElement = outside;
        viewRecent.refresh();
        expect(doc.activeElement).toBe(outside);
    });
});

describe('staging view (velvet staging ST3)', () => {
    const undoOn = () => ({
        toastCalls: [], actionCalls: [],
        showToast(msg) { this.toastCalls.push(msg); },
        toastAction(msg, label, fn) { this.actionCalls.push([msg, label, fn]); }
    });
    const mkItem = (id, url, title) => ({ id, url, title });

    it('renders both regions: staging rows + foldable recent head + recent rows', () => {
        const { viewRecent, $list, def } = setup({ recentItems: [ITEMS[0]] });
        viewRecent.api.addItems([mkItem('101', 'http://a/', 'A'), mkItem(null, 'http://h/', 'H')]);
        def().activate();
        const html = $list.innerHTML;
        expect(html).toContain('<ul role="list" id="staging-items"');
        expect(html).toContain('id="staging-item-0"');
        expect(html).toContain('id="recent-head"');
        expect(html).toContain('id="recent-list"');
        expect(html).toContain('id="recent-item-101"');
        // dual-state rows: bookmarked rows anchor data-node-id, unfav don't;
        // idle rows are HTML5 drag sources (the group-to-group DnD)
        expect(html).toMatch(/id="staging-item-\d+" role="listitem" data-url="http:\/\/a\/" draggable="true" data-node-id="101"/);
        expect(html).toMatch(/id="staging-item-\d+" role="listitem" data-url="http:\/\/h\/" draggable="true">/);
        // the idle toolbar: summary left, new-group + select-mode right
        expect(html).toContain('staging-new-group');
        expect(html).toContain('staging-select-mode');
    });

    it('the staging master switch collapses the view to the bare recently-added list', () => {
        // stagingEnabled '0' (options 暂存和最近添加): no workbench chrome,
        // no staging <ul>, no scissors — just the recent head + rows
        const { viewRecent, $list, def } = setup({
            storeData: { stagingEnabled: '0' },
            recentItems: [ITEMS[0]]
        });
        viewRecent.api.addItems([mkItem('101', 'http://a/', 'A')]);
        def().activate();
        const html = $list.innerHTML;
        expect(html).not.toContain('id="staging-items"');
        expect(html).not.toContain('staging-cut');
        expect(html).not.toContain('staging-new-group');
        expect(html).not.toContain('staging-select-mode');
        expect(html).toContain('id="recent-head"');
        expect(html).toContain('id="recent-item-101"');
        // the api reports the stand-down (context-menu/tree tails gate on it)
        expect(viewRecent.api.isEnabled()).toBe(false);
    });

    // 2026-08-26 report round: DISABLING THE VIEW (showRecentBookmarks off)
    // is the same contract as the master switch — every cross-view staging
    // entry reads api.isEnabled and must stand down with the hidden view.
    it('a disabled view (showRecentBookmarks off) stands down isEnabled like the master switch', () => {
        const { viewRecent, def } = setup({
            storeData: { showRecentBookmarks: '', stagingEnabled: '1' }
        });
        const tab = def();
        expect(tab.hidden).toBe(true);
        expect(viewRecent.api.isEnabled()).toBe(false);
        // re-enabling the view restores the staging contract
        const { viewRecent: vr2 } = setup({ storeData: { showRecentBookmarks: '1' } });
        expect(vr2.api.isEnabled()).toBe(true);
    });

    it('the staging head folds the whole staging area and persists headCollapsed', () => {
        const { viewRecent, store, $list, def, click } = setup({});
        viewRecent.api.addItems([mkItem('1', 'http://a/', 'A')]);
        def().activate();
        expect($list.innerHTML).toContain('id="staging-head"');
        expect($list.innerHTML).toContain('id="staging-item-0"');
        click({
            preventDefault() {},
            target: { closest: sel => (sel === '#staging-head' ? {} : null) }
        });
        expect(JSON.parse(store.get('staging')).headCollapsed).toBe(true);
        expect($list.innerHTML).not.toContain('id="staging-item-0"'); // whole area folds
        expect($list.innerHTML).toContain('id="staging-head"');       // the head stays
        click({
            preventDefault() {},
            target: { closest: sel => (sel === '#staging-head' ? {} : null) }
        });
        expect(JSON.parse(store.get('staging')).headCollapsed).toBe(false);
        expect($list.innerHTML).toContain('id="staging-item-0"');
    });

    it('the guide × session-dismisses the hint; 不再提醒 stays permanent', () => {
        const { store, $list, def, click } = setup({});
        def().activate();
        expect($list.innerHTML).toContain('staging-guide-banner');
        click({
            preventDefault() {}, stopPropagation() {},
            target: { closest: sel => (sel === '.staging-guide-close' ? {} : null) }
        });
        expect($list.innerHTML).not.toContain('staging-guide-banner');
        expect(store.get('stagingGuideDismissed')).toBeUndefined(); // permanent flag untouched
    });

    it('registers badge (staging count) and persistScroll', () => {
        const { def, viewRecent } = setup({});
        expect(def().badge()).toBe(0);
        expect(def().persistScroll).toBe(true);
        viewRecent.api.addItems([mkItem(null, 'http://x/', 'X')]);
        expect(def().badge()).toBe(1);
    });

    it('addItems persists under the staging key and updates badges', () => {
        const { viewRecent, store, views } = setup({});
        views.active = true;
        viewRecent.api.addItems([mkItem('1', 'http://a/', 'A')]);
        expect(JSON.parse(store.get('staging')).items).toHaveLength(1);
        expect(views.badgeCalls).toBeGreaterThan(0);
    });

    it('toast semantics: single add, summary with dupes, cap rejection', () => {
        const undo = undoOn();
        const { viewRecent } = setup({ undo });
        viewRecent.api.addItems([mkItem('1', 'http://a/', 'A')]);
        expect(undo.toastCalls).toEqual(['stagingAdded']);
        viewRecent.api.addItems([mkItem('2', 'http://b/', 'B'), mkItem('1', 'http://a/', 'A dup')]);
        expect(undo.toastCalls[1]).toBe('stagingAddedSummary[1|1]');
        viewRecent.api.addItems([mkItem('1', 'http://a/', 'again')]);
        expect(undo.toastCalls[2]).toBe('stagingAlready');
        // 500 cap: batch rejected whole
        const many = [];
        for (let i = 0; i < 501; i++)
            many.push(mkItem(null, `http://c${i}/`, 'c'));
        viewRecent.api.addItems(many);
        expect(undo.toastCalls[3]).toBe('stagingFull');
        expect(viewRecent.api.state().items).toHaveLength(2); // unchanged
    });

    it('the recent hover arrow toggles by URL', () => {
        const undo = undoOn();
        const { viewRecent, store, def, click } = setup({ undo, recentItems: [ITEMS[0]] });
        def().activate();
        const li = { dataset: { nodeId: '101', url: 'http://a/' }, id: 'recent-item-101' };
        click({
            preventDefault() {}, stopPropagation() {},
            target: { closest: sel => (sel === '.staging-add-btn' ? {} : (sel === 'li' ? li : null)) }
        });
        expect(viewRecent.api.state().items).toHaveLength(1);
        expect(undo.toastCalls).toEqual(['stagingAdded']);
        // click again → removed
        click({
            preventDefault() {}, stopPropagation() {},
            target: { closest: sel => (sel === '.staging-add-btn' ? {} : (sel === 'li' ? li : null)) }
        });
        expect(viewRecent.api.state().items).toHaveLength(0);
        expect(undo.toastCalls[1]).toBe('stagingRemoved');
        void store;
    });

    it('stage-all button sends the whole recent region (deduped summary)', () => {
        const undo = undoOn();
        const { viewRecent, chrome, def, click } = setup({ undo, recentItems: ITEMS });
        def().activate();
        click({
            preventDefault() {}, stopPropagation() {},
            target: { closest: sel => (sel === '.recent-stage-all' ? {} : null) }
        });
        expect(chrome.bookmarks.getRecentCalls.length).toBeGreaterThanOrEqual(2); // initial + stage-all (+ repaint)
        expect(viewRecent.api.state().items).toHaveLength(3); // separators/url-less skipped
        expect(undo.toastCalls[undo.toastCalls.length - 1]).toBe('stagingAddedSummary[3|0]');
    });

    it('the section head folds the recent region (class-hide) and persists recentCollapsed', () => {
        const { viewRecent, store, $list, def, click, chrome } = setup({ recentItems: [ITEMS[0]] });
        def().activate();
        expect($list.innerHTML).toContain('id="recent-item-101"');
        click({
            preventDefault() {}, stopPropagation() {},
            target: { closest: sel => (sel === '#recent-head' ? {} : null) }
        });
        expect(JSON.parse(store.get('staging')).recentCollapsed).toBe(true);
        // instant-fold law: the rows stay painted (hidden by a root class in
        // the real DOM); the head flips its aria-expanded
        expect($list.innerHTML).toContain('id="recent-item-101"');
        expect($list.innerHTML).toMatch(/id="recent-head"[^>]*aria-expanded="false"/);
        expect($list.innerHTML).toContain('id="recent-head"'); // the head stays
        // freshness law: the fetch is never skipped (rows stay up to date
        // even while the region is folded away)
        const before = chrome.bookmarks.getRecentCalls.length;
        viewRecent.refresh();
        expect(chrome.bookmarks.getRecentCalls.length).toBe(before + 1);
    });

    it('activate advances lastSeenTs (the bucket "new N" baseline)', () => {
        const { viewRecent, def } = setup({});
        const before = viewRecent.api.state().lastSeenTs;
        def().activate();
        expect(viewRecent.api.state().lastSeenTs).toBeGreaterThanOrEqual(before);
    });

    it('storage.onChanged replays the whole staging object', () => {
        const { viewRecent, chrome, $list, def } = setup({});
        def().activate();
        const external = JSON.stringify({
            v: 1, items: [{ id: null, url: 'http://ext/', title: 'E', ts: 5, group: null }],
            groups: [], recentCollapsed: false, unfavCollapsed: false, lastSeenTs: 0
        });
        chrome.storage.listeners[0]({ staging: { newValue: external } }, 'local');
        expect(viewRecent.api.state().items[0].url).toBe('http://ext/');
        expect($list.innerHTML).toContain('http://ext/');
    });

    it('bookmarks.onChanged keeps snapshots in step', () => {
        const { viewRecent, chrome } = setup({});
        viewRecent.api.addItems([mkItem('7', 'http://old/', 'Old')]);
        chrome.bookmarks.onChanged.fn('7', { title: 'New', url: 'http://new/' });
        const it = viewRecent.api.state().items[0];
        expect(it.title).toBe('New');
        expect(it.url).toBe('http://new/');
    });

    it('onCreated promotes a matching id-less row; onRemoved verifies by url search', () => {
        const { viewRecent, chrome } = setup({
            searchResults: { 'http://h/': [{ id: '88', url: 'http://h/' }] }
        });
        viewRecent.api.addItems([mkItem(null, 'http://h/', 'H')]);
        chrome.bookmarks.onCreated.fn('88', { id: '88', url: 'http://h/', title: 'H' });
        expect(viewRecent.api.state().items[0].id).toBe('88');
        // removed anchor with a surviving same-url node → relinked
        chrome.bookmarks.onRemoved.fn('88');
        expect(viewRecent.api.state().items[0].id).toBe('88');
        // …and with NO survivor → falls back to id=null, item stays
        const ctx2 = setup({ searchResults: {} });
        ctx2.viewRecent.api.addItems([mkItem('9', 'http://gone/', 'G')]);
        ctx2.chrome.bookmarks.onRemoved.fn('9');
        expect(ctx2.viewRecent.api.state().items[0].id).toBeNull();
        expect(ctx2.viewRecent.api.state().items).toHaveLength(1);
    });

    it('onTreeSnapshot relinks through the full url index', () => {
        const { viewRecent } = setup({});
        viewRecent.api.addItems([mkItem('1', 'http://x/', 'X')]);
        const snapshot = { urlIndex: new Map([['http://x/', '2']]) };
        viewRecent.onTreeSnapshot([{ id: '0', children: [] }], snapshot);
        expect(viewRecent.api.state().items[0].id).toBe('2');
    });

    it('sendFolder: flattens descendants, merges the sourceFolderId group, guards the cap', () => {
        const undo = undoOn();
        const folderNode = {
            id: '7', title: 'Docs', children: [
                { id: '71', url: 'http://d1/', title: 'D1' },
                { id: '72', children: [{ id: '721', url: 'http://d2/', title: 'D2' }] },
                { id: '73', url: 'http://sep/', title: '—' } // separator filtered below via double
            ]
        };
        const { viewRecent, chrome } = setup({ undo, separatorUrls: ['http://sep/'], subTree: [folderNode] });
        viewRecent.api.sendFolder('7');
        expect(chrome.bookmarks.getSubTreeCalls).toEqual(['7']);
        const state = viewRecent.api.state();
        expect(state.items.map(i => i.url).sort()).toEqual(['http://d1/', 'http://d2/']);
        expect(state.groups).toHaveLength(1);
        expect(state.groups[0].sourceFolderId).toBe('7');
        expect(state.items.every(i => i.group === state.groups[0].id)).toBe(true);
        // empty folder → toast
        const empty = setup({ undo, subTree: [{ id: '8', title: 'E', children: [] }] });
        empty.viewRecent.api.sendFolder('8');
        expect(undo.toastCalls).toContain('stagingFolderEmpty');
    });

    it('sendFolder over 100 bookmarks asks for confirmation, then stages', () => {
        const confirmCalls = [];
        const dialogs = {
            ConfirmDialog: { open: opts => { confirmCalls.push(opts.dialog); opts.fn1(); } }
        };
        const big = { id: '9', title: 'Big', children: [] };
        for (let i = 0; i < 101; i++)
            big.children.push({ id: `b${i}`, url: `http://b${i}/`, title: 'B' });
        const { viewRecent } = setup({ subTree: [big], dialogs });
        viewRecent.api.sendFolder('9');
        expect(confirmCalls).toHaveLength(1);
        expect(confirmCalls[0]).toContain('101');
        expect(viewRecent.api.state().items).toHaveLength(101);
    });
});

describe('staging groups + bucket + inline actions (velvet staging ST4)', () => {
    const undoOn = () => ({ toastCalls: [], actionCalls: [], showToast(msg) { this.toastCalls.push(msg); }, toastAction(msg, label, fn) { this.actionCalls.push([msg, label, fn]); } });

    it('renders the bucket head with new-N, groups with heads, loose rows last', () => {
        const { viewRecent, $list, def } = setup({});
        // two history rows (bucket) + one bookmarked loose + one grouped member
        viewRecent.api.addItems([
            { id: null, url: 'http://h1/', title: 'H1', ts: 10 },
            { id: null, url: 'http://h2/', title: 'H2', ts: 20 },
            { id: '5', url: 'http://k/', title: 'K', ts: 30 }
        ]);
        // simulate a previous visit between the two bucket arrivals, then
        // repaint (activate would stamp a fresh lastSeenTs)
        viewRecent.api.state().lastSeenTs = 15;
        viewRecent.refresh();
        let html = $list.innerHTML;
        expect(html).toContain('staging-bucket-head');
        expect(html).toContain('stagingNew[1]'); // only h2 (ts 20 > 15)
        // loose bookmarked row renders after the bucket (order in html)
        expect(html.indexOf('http://h1/')).toBeLessThan(html.indexOf('http://k/'));
        // assign the two bucket rows into a new group via the model
        const group = viewRecent.api.state().groups.length
            ? null : { id: 'g_test', name: 'Tools', collapsed: false, createdAt: 1, sourceFolderId: null, sourceTabGroup: null };
        if (group)
            viewRecent.api.state().groups.push(group);
        viewRecent.api.state().items.forEach(it => {
            if (it.url === 'http://h1/' || it.url === 'http://h2/')
                it.group = 'g_test';
        });
        def().activate();
        html = $list.innerHTML;
        expect(html).toContain('staging-group-head');
        expect(html).toContain('Tools');
        expect(html).toContain('staging-member'); // member rows indented
        // bucket is now EMPTY (both rows grouped) → no bucket head
        expect(html).not.toContain('staging-bucket-head');
    });

    it('folding the bucket and a group hides their rows and persists', () => {
        const { viewRecent, store, $list, def } = setup({});
        viewRecent.api.addItems([
            { id: null, url: 'http://h1/', title: 'H1', ts: 10 },
            { id: '5', url: 'http://k/', title: 'K', ts: 30 }
        ]);
        def().activate();
        viewRecent.api.toggleBucketFold();
        const saved = JSON.parse(store.get('staging'));
        expect(saved.unfavCollapsed).toBe(true);
        expect($list.innerHTML).not.toContain('http://h1/'); // member gone
        expect($list.innerHTML).toContain('staging-bucket-head'); // head stays
        viewRecent.api.toggleBucketFold();
        expect(JSON.parse(store.get('staging')).unfavCollapsed).toBe(false);
        expect($list.innerHTML).toContain('http://h1/');
    });

    // §perf (fold surgery, node stash): the surgical fold must detach the
    // member ROW NODES into a fragment and reinsert the ORIGINAL nodes on
    // expand — no HTML rebuild (no favicon load storm), no dead-overlay
    // rescan (the reinserted nodes keep their overlays). Driven through a
    // minimal DOM double: the double's head li exposes just enough surface
    // (querySelector/nextElementSibling/after) for the surgical path.
    it('fold surgery reinserts the ORIGINAL member nodes without rebuilding HTML', () => {
        const rowsRendered = [];
        const { viewRecent, $list, doc, treeRender } = setup({
            onRowsRendered: () => rowsRendered.push(1)
        });
        viewRecent.api.addItems([{ id: null, url: 'http://h1/', title: 'H1', ts: 10 }]);

        const member2 = {
            classList: { contains: c => c === 'staging-member' },
            nextElementSibling: null
        };
        const member1 = {
            classList: { contains: c => c === 'staging-member' },
            nextElementSibling: member2
        };
        const afterCalls = [];
        const headLi = {
            querySelector: () => null,
            nextElementSibling: member1,
            after(...args) { afterCalls.push(...args); }
        };
        const fragments = [];
        doc.createDocumentFragment = () => {
            const frag = {
                _kids: [],
                appendChild(n) { this._kids.push(n); },
                get childNodes() { return this._kids; }
            };
            fragments.push(frag);
            return frag;
        };
        $list.querySelector = sel => (sel === 'li.staging-bucket' ? headLi : null);

        const renderedBefore = treeRender.calls.length;
        const base = rowsRendered.length; // addItems already rendered once
        viewRecent.api.toggleBucketFold(); // collapse
        expect(afterCalls).toHaveLength(0);       // nothing reinserted
        expect(rowsRendered).toHaveLength(base);  // no overlay rescan on collapse
        expect(fragments).toHaveLength(1);
        expect(fragments[0].childNodes).toEqual([member1, member2]); // detached, in order

        viewRecent.api.toggleBucketFold(); // expand
        expect(afterCalls).toEqual([fragments[0]]); // the SAME fragment/nodes back
        expect(rowsRendered).toHaveLength(base);    // reinserted nodes keep overlays
        expect(treeRender.calls.length).toBe(renderedBefore); // no HTML rebuild
    });

    it('the inline star performs a REAL favorite: dedupe-anchor or create', () => {
        const { viewRecent, chrome } = setup({
            searchResults: { 'http://h/': [{ id: '77', url: 'http://h/' }] }
        });
        viewRecent.api.addItems([{ id: null, url: 'http://h/', title: 'H' }]);
        viewRecent.api.favToggle('http://h/');
        // tree already has the URL → anchored, no create
        expect(viewRecent.api.state().items[0].id).toBe('77');
        expect(chrome.bookmarks.createCalls || []).toEqual([]);
        // and the bookmarked star un-favorites via a REAL remove, item stays
        chrome.bookmarks.removeCalls = [];
        chrome.bookmarks.remove = (id, cb) => { chrome.bookmarks.removeCalls.push(id); cb(); };
        viewRecent.api.favToggle('http://h/');
        expect(chrome.bookmarks.removeCalls).toEqual(['77']);
        expect(viewRecent.api.state().items[0].id).toBeNull();
        expect(viewRecent.api.state().items).toHaveLength(1);
    });

    it('favToggle on an unanchored URL creates into the quick-add folder', () => {
        const createCalls = [];
        const { viewRecent, chrome } = setup({ searchResults: {} });
        chrome.bookmarks.create = (opts, cb) => {
            createCalls.push(opts);
            cb({ id: 'new1', url: opts.url, title: opts.title });
        };
        chrome.bookmarks.getTree = cb => cb([]);
        viewRecent.api.addItems([{ id: null, url: 'http://fresh/', title: 'F' }]);
        viewRecent.api.favToggle('http://fresh/');
        expect(createCalls).toEqual([{ parentId: '1', url: 'http://fresh/', title: 'F' }]);
        expect(viewRecent.api.state().items[0].id).toBe('new1');
    });

    it('bucket favorite-all favorites every bucket item sequentially', () => {
        const createCalls = [];
        const { viewRecent, chrome, undo } = setup({
            undo: undoOn(), searchResults: {}
        });
        chrome.bookmarks.create = (opts, cb) => {
            createCalls.push(opts.url);
            cb({ id: 'c' + createCalls.length, url: opts.url, title: 'x' });
        };
        chrome.bookmarks.getTree = cb => cb([]);
        viewRecent.api.addItems([
            { id: null, url: 'http://a/', title: 'A' },
            { id: null, url: 'http://b/', title: 'B' }
        ]);
        viewRecent.api.favAllBucket();
        expect(createCalls.sort()).toEqual(['http://a/', 'http://b/']);
        expect(viewRecent.api.state().items.every(i => i.id)).toBe(true);
        expect(undo.actionCalls.map(c => c[0])).toContain('stagingFavDone[2]');
    });

    it('dissolveGroup frees members and forgets the source', () => {
        const { viewRecent } = setup({ undo: undoOn() });
        viewRecent.api.addItems([{ id: '5', url: 'http://k/', title: 'K' }]);
        const state = viewRecent.api.state();
        state.groups.push({ id: 'g1', name: 'G', collapsed: false, createdAt: 1, sourceFolderId: 'f7', sourceTabGroup: null });
        state.items[0].group = 'g1';
        viewRecent.api.dissolveGroup('g1');
        expect(viewRecent.api.state().groups).toHaveLength(0);
        expect(viewRecent.api.state().items[0].group).toBeNull();
    });

    it('isGroupCollapsed reports the fold state for the menu label', () => {
        const { viewRecent } = setup({});
        viewRecent.api.addItems([{ id: '5', url: 'http://k/', title: 'K' }]);
        const state = viewRecent.api.state();
        state.groups.push({ id: 'g1', name: 'G', collapsed: true, createdAt: 1, sourceFolderId: null, sourceTabGroup: null });
        state.items[0].group = 'g1';
        expect(viewRecent.api.isGroupCollapsed('g1')).toBe(true);
        viewRecent.api.toggleGroupFold('g1');
        expect(viewRecent.api.isGroupCollapsed('g1')).toBe(false);
    });
});

describe('staging selection mode + group homing (velvet staging ST5)', () => {
    const undoOn = () => ({
        toastCalls: [], actionCalls: [],
        showToast(msg) { this.toastCalls.push(msg); },
        toastAction(msg, label, fn) { this.actionCalls.push([msg, label, fn]); }
    });

    it('idle toolbar offers the select-mode entry; entering swaps to the two rungs', () => {
        const { viewRecent, $list } = setup({});
        viewRecent.api.addItems([{ id: null, url: 'http://h/', title: 'H' }]);
        expect($list.innerHTML).toContain('staging-select-mode');
        expect($list.innerHTML).toContain('stagingCount[1]');
        viewRecent.api.setSelecting(true);
        const html = $list.innerHTML;
        expect(html).toContain('staging-select-toolbar');
        expect(html).toContain('staging-actions-toolbar');
        expect(html).toContain('class="selecting"');
        expect(html).toContain('li class="vbm-row staging-row');
        expect(html).not.toContain('staging-star'); // row buttons leave the DOM
        // exit restores the idle bar and clears the set
        viewRecent.api.setSelecting(false);
        expect($list.innerHTML).toContain('staging-select-mode');
        expect(viewRecent.api.selectedUrls()).toEqual([]);
    });

    it('row click and Space toggle membership; group/bucket heads select all', () => {
        const { viewRecent, $list, click, def } = setup({});
        def().activate();
        viewRecent.api.addItems([
            { id: null, url: 'http://h1/', title: 'H1' },
            { id: null, url: 'http://h2/', title: 'H2' },
            { id: '5', url: 'http://k/', title: 'K' }
        ]);
        viewRecent.api.setSelecting(true);
        const liAt = url => ({ dataset: { url } });
        click({ preventDefault() {}, stopPropagation() {}, target: { closest: sel => (sel === 'li' ? liAt('http://h1/') : null) } });
        expect(viewRecent.api.selectedUrls()).toEqual(['http://h1/']);
        click({ preventDefault() {}, stopPropagation() {}, target: { closest: sel => (sel === 'li' ? liAt('http://h1/') : null) } });
        expect(viewRecent.api.selectedUrls()).toEqual([]);
        // bucket head selects all bucket members (h1+h2, not the loose k)
        click({
            preventDefault() {}, stopPropagation() {},
            target: {
                closest: sel => (sel === '.staging-bucket' ? { dataset: {} }
                    : (sel === '.staging-group' ? null
                        : (sel === 'li' ? null : null)))
            }
        });
        expect(viewRecent.api.selectedUrls().sort()).toEqual(['http://h1/', 'http://h2/']);
        // Space on a row toggles it
        const keydown = $list._listeners.keydown[$list._listeners.keydown.length - 1];
        keydown({
            key: ' ', preventDefault() {}, stopPropagation() {},
            target: { closest: sel => (sel === 'li.vbm-row' ? { dataset: { url: 'http://k/' } } : null) }
        });
        expect(viewRecent.api.selectedUrls().sort()).toEqual(['http://h1/', 'http://h2/', 'http://k/']);
    });

    it('select-all / invert / clear operate on the whole item set', () => {
        const { viewRecent, click } = setup({});
        viewRecent.api.addItems([
            { id: null, url: 'http://h1/', title: 'H1' },
            { id: '5', url: 'http://k/', title: 'K' }
        ]);
        viewRecent.api.setSelecting(true);
        const press = cls => click({
            preventDefault() {}, stopPropagation() {},
            target: { closest: sel => (sel === cls ? { x: 1 } : (sel === '.vbm-toolbar' ? { t: 1 } : null)) }
        });
        press('.staging-select-all');
        expect(viewRecent.api.selectedUrls().length).toBe(2);
        press('.staging-select-invert');
        expect(viewRecent.api.selectedUrls().length).toBe(0);
        press('.staging-select-all');
        press('.staging-select-clear');
        expect(viewRecent.api.selectedUrls().length).toBe(0);
    });

    it('unfavSelected: real removes, items fall back to unfav and stay; undo restores', () => {
        const undo = undoOn();
        const ctx = setup({ undo });
        const { viewRecent, chrome } = ctx;
        const removes = [];
        chrome.bookmarks.remove = (id, cb) => { removes.push(id); cb(); };
        chrome.bookmarks.create = (opts, cb) => cb({ id: 'r1', url: opts.url, title: opts.title });
        chrome.bookmarks.getTree = cb => cb([]);
        viewRecent.api.addItems([{ id: '7', url: 'http://a/', title: 'A', parentId: '2' }]);
        viewRecent.api.setSelecting(true);
        ctx.click({
            preventDefault() {}, stopPropagation() {},
            target: { closest: sel => (sel === 'li' ? { dataset: { url: 'http://a/' } } : null) }
        });
        ctx.click({
            preventDefault() {}, stopPropagation() {},
            target: { closest: sel => (sel === '.staging-unfav' ? {} : (sel === '.vbm-toolbar' ? {} : null)) }
        });
        expect(removes).toEqual(['7']);
        expect(viewRecent.api.state().items[0].id).toBeNull();
        expect(viewRecent.api.state().items).toHaveLength(1);
        expect(undo.actionCalls.length).toBe(1);
        // undo re-creates and re-anchors
        undo.actionCalls[0][2]();
        expect(viewRecent.api.state().items[0].id).toBe('r1');
    });

    it('removeSelected leaves the tree alone and undo re-adds snapshots', () => {
        const undo = undoOn();
        const ctx = setup({ undo });
        const { viewRecent, chrome } = ctx;
        const removes = [];
        chrome.bookmarks.remove = (id, cb) => { removes.push(id); cb(); };
        viewRecent.api.addItems([{ id: null, url: 'http://x/', title: 'X', ts: 42, group: null }]);
        viewRecent.api.setSelecting(true);
        ctx.click({
            preventDefault() {}, stopPropagation() {},
            target: { closest: sel => (sel === 'li' ? { dataset: { url: 'http://x/' } } : null) }
        });
        ctx.click({
            preventDefault() {}, stopPropagation() {},
            target: { closest: sel => (sel === '.staging-remove' ? {} : (sel === '.vbm-toolbar' ? {} : null)) }
        });
        expect(removes).toEqual([]); // tree untouched
        expect(viewRecent.api.state().items).toHaveLength(0);
        expect(undo.actionCalls.length).toBe(1);
        undo.actionCalls[0][2]();
        expect(viewRecent.api.state().items).toEqual([
            { id: null, url: 'http://x/', title: 'X', ts: 42, group: null }
        ]);
    });

    it('assignSelected moves the selection into a (new) group via the dialog', () => {
        const assignCalls = [];
        const dialogs = {
            StagingGroupAssignDialog: {
                open(opts) {
                    assignCalls.push(opts.groups);
                    // simulate picking "new group Tools"
                    opts.onAssign(null, 'Tools');
                }
            }
        };
        const ctx = setup({ dialogs });
        const { viewRecent } = ctx;
        viewRecent.api.addItems([
            { id: null, url: 'http://h1/', title: 'H1' },
            { id: '5', url: 'http://k/', title: 'K' }
        ]);
        viewRecent.api.setSelecting(true);
        ctx.click({
            preventDefault() {}, stopPropagation() {},
            target: { closest: sel => (sel === 'li' ? { dataset: { url: 'http://h1/' } } : null) }
        });
        ctx.click({
            preventDefault() {}, stopPropagation() {},
            target: { closest: sel => (sel === '.staging-assign' ? {} : (sel === '.vbm-toolbar' ? {} : null)) }
        });
        const state = viewRecent.api.state();
        expect(state.groups.map(g => g.name)).toEqual(['Tools']);
        expect(state.items.find(i => i.url === 'http://h1/').group).toBe(state.groups[0].id);
        expect(state.items.find(i => i.url === 'http://k/').group).toBeNull();
    });

    it('moveCopySelected opens the picker with dual-state note; move homes items', () => {
        const picks = [];
        const dialogs = {
            BookmarkFolderPickDialog: {
                open(opts) {
                    picks.push({ mode: opts.mode, hasUnfav: opts.hasUnfav });
                    opts.onPick('33', 'move');
                }
            },
            ConfirmDialog: { open: opts => opts.fn1() }
        };
        const ctx = setup({ dialogs, nodes: { 7: [{ id: '7', parentId: '1' }] } });
        const { viewRecent, chrome } = ctx;
        const moves = [];
        chrome.bookmarks.move = (id, dest, cb) => { moves.push([id, dest]); cb(); };
        chrome.bookmarks.create = (opts, cb) => cb({ id: 'c1', url: opts.url });
        chrome.bookmarks.getTree = cb => cb([]);
        viewRecent.api.addItems([
            { id: '7', url: 'http://a/', title: 'A' },
            { id: null, url: 'http://h/', title: 'H' }
        ]);
        viewRecent.api.setSelecting(true);
        ctx.click({
            preventDefault() {}, stopPropagation() {},
            target: { closest: sel => (sel === 'li' ? { dataset: { url: 'http://a/' } } : null) }
        });
        ctx.click({
            preventDefault() {}, stopPropagation() {},
            target: { closest: sel => (sel === 'li' ? { dataset: { url: 'http://h/' } } : null) }
        });
        ctx.click({
            preventDefault() {}, stopPropagation() {},
            target: { closest: sel => (sel === '.staging-movecopy' ? {} : (sel === '.vbm-toolbar' ? {} : null)) }
        });
        expect(picks).toEqual([{ mode: null, hasUnfav: true }]);
        // bookmarked moved (id 7), unbookmarked created into the target —
        // both LEFT the staging area (homing completes the mission)
        expect(moves).toEqual([['7', { parentId: '33' }]]);
        expect(viewRecent.api.state().items).toHaveLength(0);
    });

    it('saveGroupToFolder homes a whole group through the picker', () => {
        const picks = [];
        const dialogs = {
            BookmarkFolderPickDialog: { open(opts) { picks.push(opts); opts.onPick('9', 'move'); } },
            ConfirmDialog: { open: opts => opts.fn1() }
        };
        const ctx = setup({ dialogs });
        const { viewRecent, chrome } = ctx;
        chrome.bookmarks.move = (id, dest, cb) => cb();
        chrome.bookmarks.create = (opts, cb) => cb({ id: 'c2', url: opts.url });
        chrome.bookmarks.getTree = cb => cb([]);
        viewRecent.api.addItems([
            { id: '7', url: 'http://a/', title: 'A' },
            { id: null, url: 'http://h/', title: 'H' }
        ]);
        const state = viewRecent.api.state();
        state.groups.push({ id: 'g1', name: 'Tools', collapsed: false, createdAt: 1, sourceFolderId: null, sourceTabGroup: null });
        state.items.forEach(it => { it.group = 'g1'; });
        viewRecent.api.saveGroupToFolder('g1');
        expect(picks).toHaveLength(1);
        expect(viewRecent.api.state().items).toHaveLength(0); // all homed
        expect(viewRecent.api.state().groups).toHaveLength(0); // empty group dissolved
    });

    it('clearStaging asks for confirmation and empties everything', () => {
        const undo = undoOn();
        const confirms = [];
        const dialogs = {
            ConfirmDialog: { open: opts => { confirms.push(opts.dialog); opts.fn1(); } }
        };
        const ctx = setup({ undo, dialogs });
        const { viewRecent, store } = ctx;
        viewRecent.api.addItems([{ id: null, url: 'http://x/', title: 'X' }]);
        viewRecent.api.setSelecting(true);
        ctx.click({
            preventDefault() {}, stopPropagation() {},
            target: { closest: sel => (sel === '.staging-clear-all' ? {} : (sel === '.vbm-toolbar' ? {} : null)) }
        });
        expect(confirms).toEqual(['stagingClearConfirm']);
        expect(viewRecent.api.state().items).toHaveLength(0);
        expect(JSON.parse(store.get('staging')).items).toHaveLength(0);
        expect(undo.actionCalls.map(c => c[0])).toContain('stagingCleared');
    });

    it('Esc exits selection mode through the view onEscape', () => {
        const ctx = setup({});
        const { viewRecent, def } = ctx;
        viewRecent.api.addItems([{ id: null, url: 'http://x/', title: 'X' }]);
        viewRecent.api.setSelecting(true);
        expect(viewRecent.api.isSelecting()).toBe(true);
        expect(def().onEscape()).toBe(true);
        expect(viewRecent.api.isSelecting()).toBe(false);
        // with nothing transient left, Esc falls through
        expect(def().onEscape()).toBe(false);
    });
});
describe('per-bucket stage buttons (velvet staging UX round)', () => {
    const DAY = 86400000;
    const NOW2 = Date.now();
    const bucketClick = (ctx, g) => ctx.click({
        preventDefault() {}, stopPropagation() {},
        target: { closest: sel => (sel === '.recent-group-stage'
            ? { dataset: { recentGroup: String(g) } }
            : null) }
    });

    it('renders a hover stage button per non-empty bucket head and sends that bucket only', () => {
        const ctx = setup({
            recentItems: [
                { id: '1', parentId: '1', title: 'today', url: 'http://today/', dateAdded: NOW2 },
                { id: '2', parentId: '1', title: 'week', url: 'http://week/', dateAdded: NOW2 - 3 * DAY }
            ]
        });
        ctx.def().activate();
        const html = ctx.$list.innerHTML;
        expect((html.match(/recent-group-stage/g) || []).length).toBe(2); // today + week buckets
        // click the "week" bucket → only its item stages
        bucketClick(ctx, 1);
        expect(ctx.viewRecent.api.state().items.map(i => i.url)).toEqual(['http://week/']);
        // the "today" bucket stages its own
        bucketClick(ctx, 0);
        expect(ctx.viewRecent.api.state().items.map(i => i.url).sort()).toEqual(['http://today/', 'http://week/']);
    });
});

describe('staging group management + DnD + render coalescing (workbench round)', () => {
    const undoOn = () => ({
        toastCalls: [], actionCalls: [],
        showToast(msg) { this.toastCalls.push(msg); },
        toastAction(msg, label, fn) { this.actionCalls.push([msg, label, fn]); }
    });

    // minimal fake nodes for the delegated DnD handlers: `closest` answers
    // for one selector, classList records, dataset carries the identity.
    const mkNode = (sel, props = {}) => {
        const node = { ...props };
        const set = new Set(props.classes || []);
        node.classList = {
            add: c => set.add(c),
            remove: c => set.delete(c),
            contains: c => set.has(c)
        };
        node.closest = s => (s === sel ? node : null);
        return node;
    };
    const dndEvent = target => ({
        target,
        preventDefault() {},
        stopPropagation() {},
        dataTransfer: { setData() {}, effectAllowed: null, dropEffect: null }
    });

    const fire = ($list, type, ev) => $list._listeners[type][0](ev);

    it('createGroup builds a manual group that renders its head even while empty', () => {
        const ctx = setup({ undo: undoOn() });
        const gid = ctx.viewRecent.api.createGroup('Reading list');
        const state = ctx.viewRecent.api.state();
        expect(state.groups[0].name).toBe('Reading list');
        expect(state.groups[0].manual).toBe(true);
        ctx.def().activate();
        const html = ctx.$list.innerHTML;
        expect(html).toContain('data-group-id="' + gid + '"');
        expect(html).toContain('Reading list');
        // the empty manual head carries the fold + count-pill + quick tail
        expect(html).toMatch(new RegExp('staging-group-head[^>]*draggable="true"'));
        expect(html).toContain('staging-group-rename');
        expect(html).toContain('staging-group-place');
        // removeByUrls keeps it (manual survives the prune)
        ctx.viewRecent.api.addItems([{ id: null, url: 'http://x/', title: 'X' }]);
        ctx.viewRecent.api.removeByUrl('http://x/');
        expect(ctx.viewRecent.api.state().groups).toHaveLength(1);
    });

    it('the group head leads with the tree folder glyph, single-line (2026-08 icon round)', () => {
        // The icon round replaced the creation-time meta sub line with the
        // tree's FOLDER glyph on the bucket-star slot — glyph-then-title,
        // vertically centered in the (taller) head row, no second line.
        const ctx = setup({ undo: undoOn() });
        const gid = ctx.viewRecent.api.createGroup('Reading list');
        ctx.def().activate();
        const html = ctx.$list.innerHTML;
        expect(html).toMatch(new RegExp(
            'data-group-id="' + gid + '"[\\s\\S]*?<i class="staging-group-folder" aria-hidden="true">' +
            '<svg class="vbm-icon vbm-icon-folder"'));
        expect(html).not.toContain('head-sub');
        expect(html).not.toContain('stagingGroupCreated');
    });

    it('the toolbar keeps the new-group entry on an EMPTY workbench (select hidden)', () => {
        const ctx = setup({});
        ctx.def().activate();
        const html = ctx.$list.innerHTML;
        expect(html).toContain('staging-new-group');
        expect(html).not.toContain('staging-select-mode');
    });

    it('the new-group button opens the dialog and lands a manual group', () => {
        const opened = [];
        const dialogs = {
            NewFolderDialog: { open(name, cb) { opened.push(name); cb('Tools'); } }
        };
        const ctx = setup({ dialogs });
        ctx.def().activate();
        ctx.click({
            preventDefault() {}, stopPropagation() {},
            target: { closest: sel => (sel === '.staging-new-group' ? {} : null) }
        });
        expect(opened).toEqual(['']);
        const state = ctx.viewRecent.api.state();
        expect(state.groups.map(g => g.name)).toEqual(['Tools']);
        expect(state.groups[0].manual).toBe(true);
    });

    it('the group-head rename quick button and F2 both route to the rename dialog', () => {
        const opened = [];
        const dialogs = {
            NewFolderDialog: { open(name, cb) { opened.push(name); cb('Renamed'); } }
        };
        const ctx = setup({ dialogs });
        const gid = ctx.viewRecent.api.createGroup('Old');
        ctx.def().activate();
        ctx.click({
            preventDefault() {}, stopPropagation() {},
            target: {
                closest: sel => (sel === '.staging-group-rename' ? {}
                    : (sel === '.staging-group' ? { dataset: { groupId: gid } } : null))
            }
        });
        expect(opened).toEqual(['Old']);
        expect(ctx.viewRecent.api.state().groups[0].name).toBe('Renamed');
        // F2 on the focused head
        opened.length = 0;
        ctx.viewRecent.api.renameGroup(gid); // no-op guard path stays intact
        fire(ctx.$list, 'keydown', {
            key: 'F2',
            target: mkNode('.staging-group-head', { parentNode: { dataset: { groupId: gid } } }),
            preventDefault() {}, stopPropagation() {}
        });
        expect(opened).toEqual(['Renamed']);
    });

    it('deleteGroup removes the group AND its items; the toast undo restores both', () => {
        const confirmOpens = [];
        const undo = undoOn();
        const dialogs = {
            ConfirmDialog: { open(opts) { confirmOpens.push(opts.dialog); opts.fn1(); } }
        };
        const ctx = setup({ dialogs, undo });
        ctx.viewRecent.api.addItems([
            { id: '5', url: 'http://in/', title: 'In' },
            { id: '6', url: 'http://out/', title: 'Out' }
        ]);
        const gid = ctx.viewRecent.api.createGroup('Doomed');
        ctx.viewRecent.api.state().items.find(i => i.url === 'http://in/').group = gid;
        ctx.viewRecent.api.deleteGroup(gid);
        const state = ctx.viewRecent.api.state();
        expect(confirmOpens).toHaveLength(1);
        expect(state.groups).toHaveLength(0);
        expect(state.items.map(i => i.url)).toEqual(['http://out/']);
        expect(undo.actionCalls).toHaveLength(1);
        undo.actionCalls[0][2](); // the undo callback
        const after = ctx.viewRecent.api.state();
        expect(after.groups.map(g => g.name)).toEqual(['Doomed']);
        expect(after.items.find(i => i.url === 'http://in/').group).toBe(after.groups[0].id);
        expect(after.items.map(i => i.url).sort()).toEqual(['http://in/', 'http://out/']);
    });

    it('DnD: dragging a row onto a group head assigns it (staging only, tree untouched)', () => {
        const moves = [];
        const ctx = setup({});
        ctx.chrome.bookmarks.move = (id, dest, cb) => { moves.push([id, dest]); cb(); };
        ctx.viewRecent.api.addItems([{ id: null, url: 'http://r/', title: 'R' }]);
        const gid = ctx.viewRecent.api.createGroup('Target');
        // collapsed target: the drop must reveal it
        ctx.viewRecent.api.toggleGroupFold(gid);
        const rowLi = mkNode('li.staging-row', { dataset: { url: 'http://r/' } });
        const head = mkNode('.staging-group-head', {
            classes: ['staging-group-head'],
            parentNode: { dataset: { groupId: gid } }
        });
        fire(ctx.$list, 'dragstart', dndEvent(rowLi));
        fire(ctx.$list, 'dragover', dndEvent(head));
        fire(ctx.$list, 'drop', dndEvent(head));
        const state = ctx.viewRecent.api.state();
        expect(state.items[0].group).toBe(gid);
        expect(state.groups[0].collapsed).toBe(false); // revealed by the drop
        expect(moves).toEqual([]); // the tree was never touched
        expect(store_get_staging_group(ctx)).toBe(gid); // persisted bookkeeping
    });

    it('DnD: dropping onto the bucket head ungroups; onto a row adopts its group', () => {
        const ctx = setup({});
        ctx.viewRecent.api.addItems([
            { id: '5', url: 'http://a/', title: 'A' },
            { id: '6', url: 'http://b/', title: 'B' },
            { id: null, url: 'http://c/', title: 'C' }
        ]);
        const state0 = ctx.viewRecent.api.state();
        const gid = ctx.viewRecent.api.createGroup('G');
        state0.items.find(i => i.url === 'http://b/').group = gid;
        // drag C onto B (a member) → C joins G
        fire(ctx.$list, 'dragstart', dndEvent(mkNode('li.staging-row', { dataset: { url: 'http://c/' } })));
        fire(ctx.$list, 'drop', dndEvent(mkNode('li.staging-row', { dataset: { url: 'http://b/' } })));
        expect(ctx.viewRecent.api.state().items.find(i => i.url === 'http://c/').group).toBe(gid);
        // drag C onto the bucket head → ungrouped
        fire(ctx.$list, 'dragstart', dndEvent(mkNode('li.staging-row', { dataset: { url: 'http://c/' } })));
        fire(ctx.$list, 'drop', dndEvent(mkNode('.staging-bucket-head', {
            classes: ['staging-bucket-head']
        })));
        expect(ctx.viewRecent.api.state().items.find(i => i.url === 'http://c/').group).toBeNull();
        // drag A (bookmarked, loose) onto the bucket head → stays loose, no error
        fire(ctx.$list, 'dragstart', dndEvent(mkNode('li.staging-row', { dataset: { url: 'http://a/' } })));
        fire(ctx.$list, 'drop', dndEvent(mkNode('.staging-bucket-head', {
            classes: ['staging-bucket-head']
        })));
        expect(ctx.viewRecent.api.state().items.find(i => i.url === 'http://a/').group).toBeNull();
    });

    it('DnD: dragging a group head onto another group head reorders', () => {
        const ctx = setup({});
        const g1 = ctx.viewRecent.api.createGroup('One');
        const g2 = ctx.viewRecent.api.createGroup('Two');
        const g3 = ctx.viewRecent.api.createGroup('Three');
        ctx.viewRecent.api.addItems([{ id: null, url: 'http://x/', title: 'X' }]);
        const head3 = mkNode('.staging-group-head', {
            classes: ['staging-group-head'],
            parentNode: { dataset: { groupId: g3 } }
        });
        const head1 = mkNode('.staging-group-head', {
            classes: ['staging-group-head'],
            parentNode: { dataset: { groupId: g1 } }
        });
        fire(ctx.$list, 'dragstart', dndEvent(head3));
        fire(ctx.$list, 'dragover', dndEvent(head1));
        fire(ctx.$list, 'drop', dndEvent(head1));
        expect(ctx.viewRecent.api.state().groups.map(g => g.name)).toEqual(['Three', 'One', 'Two']);
        expect(g3).toBeTruthy();
        expect(g2).toBeTruthy();
    });

    it('the storage.onChanged echo guard: our own write does not replay, a foreign one does', () => {
        const ctx = setup({});
        ctx.viewRecent.api.addItems([{ id: null, url: 'http://a/', title: 'A' }]);
        const before = ctx.viewRecent.api.state();
        const written = ctx.store._data.staging;
        // our own echo (byte-identical to what we flushed)
        ctx.chrome.storage.listeners[0]({ staging: { newValue: written } }, 'local');
        expect(ctx.viewRecent.api.state()).toBe(before); // no object swap, no re-render
        // a foreign document's write replays as a whole-object re-parse
        const foreign = JSON.stringify({
            v: 1, items: [{ id: null, url: 'http://ext2/', title: 'E2', ts: 1, group: null }],
            groups: [], recentCollapsed: false, unfavCollapsed: false, lastSeenTs: 0
        });
        ctx.chrome.storage.listeners[0]({ staging: { newValue: foreign } }, 'local');
        const after = ctx.viewRecent.api.state();
        expect(after).not.toBe(before);
        expect(after.items[0].url).toBe('http://ext2/');
    });

    it('tree-event promotions mutate state synchronously and coalesce the repaint', () => {
        const ctx = setup({ searchResults: { 'http://h/': [{ id: '88', url: 'http://h/' }] } });
        ctx.viewRecent.api.addItems([{ id: null, url: 'http://h/', title: 'H' }]);
        const before = ctx.store._data.staging;
        ctx.chrome.bookmarks.onCreated.fn('88', { id: '88', url: 'http://h/', title: 'H' });
        // state landed immediately…
        expect(ctx.viewRecent.api.state().items[0].id).toBe('88');
        // …but the persist+render pass waits for the coalescing tick
        expect(ctx.store._data.staging).toBe(before);
        tick(120);
        expect(ctx.store._data.staging).not.toBe(before);
        expect(ctx.store._data.staging).toContain('"id":"88"');
    });
});

// helper used by the DnD persistence assertion (kept outside the describe
// so the whole file shares one declaration point)
function store_get_staging_group(ctx) {
    const raw = JSON.parse(ctx.store._data.staging);
    const it = raw.items.find(i => i.url === 'http://r/');
    return it ? it.group : null;
}

describe('open×4 quick tail + named-group landings (2026-08-26 round)', () => {
    const undoOn = () => ({
        toastCalls: [], actionCalls: [],
        showToast(msg) { this.toastCalls.push(msg); },
        toastAction(msg, label, fn) { this.actionCalls.push([msg, label, fn]); }
    });

    const mkActions = () => ({
        openCalls: [], groupOpenCalls: [], windowCalls: [],
        openBookmarks(urls) { this.openCalls.push(urls); },
        openBookmarksInGroup(urls, title) { this.groupOpenCalls.push([urls, title]); },
        openBookmarksNewWindow(urls, incognito) { this.windowCalls.push([urls, !!incognito]); }
    });

    const seededGroup = (ctx, name, urls) => {
        const gid = ctx.viewRecent.api.createGroup(name);
        ctx.viewRecent.api.addItems(urls.map((u, i) => ({ id: null, url: u, title: `t${i}` })));
        for (const it of ctx.viewRecent.api.state().items)
            if (urls.includes(it.url))
                it.group = gid;
        return gid;
    };

    it('the head quick tail reads 全部打开→标签组→编辑→解散→保存文件夹→移出暂存 (in order)', () => {
        const ctx = setup({ undo: undoOn() });
        seededGroup(ctx, 'Work', ['http://a/', 'http://b/']);
        ctx.def().activate();
        const html = ctx.$list.innerHTML;
        const order = ['staging-group-open-all', 'staging-group-open-group',
            'staging-group-rename', 'staging-group-dissolve',
            'staging-group-place', 'staging-group-remove'];
        let at = -1;
        for (const cls of order) {
            const idx = html.indexOf(cls);
            expect(idx, cls).toBeGreaterThan(at);
            at = idx;
        }
    });

    it('an EMPTY manual group head keeps the tail but drops the open pair', () => {
        const ctx = setup({ undo: undoOn() });
        ctx.viewRecent.api.createGroup('Landing');
        ctx.def().activate();
        const html = ctx.$list.innerHTML;
        expect(html).not.toContain('staging-group-open-all');
        expect(html).not.toContain('staging-group-open-group');
        expect(html).toContain('staging-group-rename');
        expect(html).toContain('staging-group-remove');
    });

    it('open-all and open-as-tab-group dispatch the member urls through ctx.actions', () => {
        const actions = mkActions();
        const ctx = setup({ actions, undo: undoOn() });
        const gid = seededGroup(ctx, 'Work', ['http://a/', 'http://b/']);
        ctx.def().activate();
        const clickCls = cls => ctx.click({
            preventDefault() {}, stopPropagation() {},
            target: {
                closest: sel => (sel === cls ? {}
                    : (sel === '.staging-group' ? { dataset: { groupId: gid } } : null))
            }
        });
        clickCls('.staging-group-open-all');
        expect(actions.openCalls).toEqual([['http://a/', 'http://b/']]);
        clickCls('.staging-group-open-group');
        expect(actions.groupOpenCalls).toEqual([[['http://a/', 'http://b/'], 'Work']]);
        // an empty group dispatches nothing
        const empty = ctx.viewRecent.api.createGroup('Empty');
        ctx.click({
            preventDefault() {}, stopPropagation() {},
            target: {
                closest: sel => (sel === '.staging-group-open-all' ? {}
                    : (sel === '.staging-group' ? { dataset: { groupId: empty } } : null))
            }
        });
        expect(actions.openCalls).toHaveLength(1);
    });

    it('addItemsToNamedGroup creates the named group and a same-name send APPENDS into it', () => {
        const ctx = setup({ undo: undoOn() });
        ctx.viewRecent.api.addItemsToNamedGroup('本周', [
            { id: '1', url: 'http://a/', title: 'A' },
            { id: '2', url: 'http://b/', title: 'B' }
        ]);
        let state = ctx.viewRecent.api.state();
        expect(state.groups.map(g => g.name)).toEqual(['本周']);
        const gid = state.groups[0].id;
        expect(state.items.every(i => i.group === gid)).toBe(true);
        expect(state.groups[0].manual).toBe(false); // auto — prunes when empty
        // resend with one new url: NO sibling group, the new item joins
        ctx.viewRecent.api.addItemsToNamedGroup('本周', [
            { id: '2', url: 'http://b/', title: 'B' },
            { id: '3', url: 'http://c/', title: 'C' }
        ]);
        state = ctx.viewRecent.api.state();
        expect(state.groups).toHaveLength(1);
        expect(state.items.map(i => i.url)).toEqual(['http://a/', 'http://b/', 'http://c/']);
        expect(state.items.find(i => i.url === 'http://c/').group).toBe(gid);
    });

    it('the recent time-bucket stage button lands the bucket in a group NAMED after the bucket', () => {
        const ctx = setup({ undo: undoOn(), recentItems: [
            { id: '101', parentId: '1', title: 'A', url: 'http://a/', dateAdded: Date.now() }
        ] });
        ctx.def().activate();
        ctx.click({
            preventDefault() {}, stopPropagation() {},
            target: {
                closest: sel => (sel === '.recent-group-stage'
                    ? { dataset: { recentGroup: '0' } } : null)
            }
        });
        const state = ctx.viewRecent.api.state();
        // the stub i18n returns the message KEY, so 今天 renders as its key
        expect(state.groups.map(g => g.name)).toEqual(['recentGroupToday']);
        expect(state.items.map(i => i.url)).toEqual(['http://a/']);
        expect(state.items[0].group).toBe(state.groups[0].id);
    });

    it('api.groupUrls / groupName expose the group membership the context menu reads', () => {
        const ctx = setup({ undo: undoOn() });
        const gid = seededGroup(ctx, 'Work', ['http://a/']);
        expect(ctx.viewRecent.api.groupUrls(gid)).toEqual(['http://a/']);
        expect(ctx.viewRecent.api.groupName(gid)).toBe('Work');
        expect(ctx.viewRecent.api.groupUrls('missing')).toEqual([]);
    });
});