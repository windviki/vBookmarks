import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// view-stats.js touches page globals (document/chrome/setTimeout) only
// inside initViewStats and its handlers, so the real module imports cleanly
// in node once the globals are stubbed. store/views/treeRender/
// separatorManager/treeView/dialogs/visitStats/undo/onChanged are injected
// recording doubles; the registered ViewDef is captured and driven by hand.
// Assertions go through the doubles' records and the list's innerHTML —
// nothing is copied from the module body.
// 第四轮项9: the chrome stub grows permissions/history and
// bookmarks.create/get for the recent-history section; permission defaults
// to MISSING so the pre-existing suites see the guide row (which none of
// their toContain/calls assertions notice).

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
            createCalls: [],
            create(bm, cb) {
                this.createCalls.push(bm);
                cb('createResult' in opts ? opts.createResult : { id: '99', title: bm.title, url: bm.url });
            },
            getCalls: [],
            get(id, cb) {
                this.getCalls.push(id);
                cb(opts.folderNodes || [{ title: 'Bookmarks bar' }]);
            },
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
        rev: opts.revision || 0,
        all() { return this.data; },
        clear() { this.cleared++; this.data = {}; this.rev++; },
        enabled() { return this.enabledValue; },
        revision() { return this.rev; }
    };
    const undo = {
        toasts: [],
        showToast(msg) { this.toasts.push(msg); }
    };
    const onChanged = {
        calls: 0,
        fn() { onChanged.calls++; }
    };

    const viewStats = initViewStats({
        store, views, treeRender, separatorManager, treeView, dialogs, visitStats,
        undo, onChanged: onChanged.fn
    });
    return {
        viewStats, $list, $container, chrome: chromeStub, store, views,
        treeRender, treeView, dialogs, visitStats, undo, onChanged,
        def: () => views.def,
        click: ev => $list._listeners.click[0](ev),
        contextmenu: ev => $list._listeners.contextmenu[0](ev)
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

    it('maps the showStatsView setting onto tab visibility', () => {
        expect(setup({}).def().hidden).toBe(false); // default: visible
        expect(setup({ storeData: { showStatsView: '' } }).def().hidden).toBe(true);
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


// === 第四轮项9: recent-history section, one-click star, permission guide ===

const HISTORY = [
    { url: 'http://a/', title: 'Alpha visited', visitCount: 3, lastVisitTime: NOW - 1000 }, // bookmarked (id 7)
    { url: 'http://elsewhere/', title: 'Elsewhere', visitCount: 1, lastVisitTime: NOW - 2000 } // not in the tree
];

describe('recent-history section (第四轮项9)', () => {
    it('renders bookmarked and unbookmarked history rows above the stats section', () => {
        const s = setup({ hasHistoryPermission: true, historyItems: HISTORY });
        s.def().activate();
        expect(s.chrome.history.searchCalls).toEqual([{ text: '', startTime: 0, maxResults: 200 }]);
        // both section heads, recent first
        const html = s.$list.innerHTML;
        const recentAt = html.indexOf('statsSectionRecent');
        const statsAt = html.indexOf('statsSectionBookmarks');
        expect(recentAt).toBeGreaterThan(-1);
        expect(statsAt).toBeGreaterThan(recentAt);
        // bookmarked row: real row id + ★ badge meta, no ☆ button on it
        expect(html).toContain('id="stats-hist-7"');
        expect(html).toContain('data-node-id="7"');
        const bookmarkedCall = s.treeRender.calls.find(c => c.url === 'http://a/');
        expect(bookmarkedCall.id).toBe('7');
        expect(bookmarkedCall.meta.rightText).toBe('timeJustNow');
        expect(bookmarkedCall.meta.badge)
            .toEqual({ text: '★', cls: 'starred', aria: 'statsHistoryBookmarked' });
        // unbookmarked row: ☆ row button, no bookmark id
        const unbookmarkedCall = s.treeRender.calls.find(c => c.url === 'http://elsewhere/');
        expect(unbookmarkedCall.id).toBe(null);
        expect(html).toContain('class="row-btn stats-add-btn" data-hist-idx="1"');
        expect(html).toContain('statsHistoryAdd');
    });

    it('renders newest first, dedupes slash-folded URLs and skips unbookmarkable schemes', () => {
        const s = setup({
            hasHistoryPermission: true,
            historyItems: [
                { url: 'http://new/', title: 'n', lastVisitTime: NOW - 100 },
                { url: 'http://old/', title: 'o', lastVisitTime: NOW - 200 },
                { url: 'http://new', title: 'n2', lastVisitTime: NOW - 300 }, // slash-fold dup
                { url: 'chrome://extensions/', title: 'c', lastVisitTime: NOW - 400 },
                { url: 'javascript:alert(1)', title: 'j', lastVisitTime: NOW - 500 }
            ]
        });
        s.def().activate();
        expect(s.treeRender.calls.map(c => c.url)).toEqual(['http://new/', 'http://old/']);
    });

    it('omits the section entirely when granted but history is empty', () => {
        const s = setup({ hasHistoryPermission: true, historyItems: [] });
        s.def().activate();
        expect(s.$list.innerHTML).not.toContain('statsSectionRecent');
        expect(s.$list.innerHTML).not.toContain('stats-history-guide');
        expect(s.$list.innerHTML).toContain('statsSectionBookmarks'); // stats section intact
        expect(s.$list.innerHTML).toContain('<i>statsEmpty</i>');
    });

    it('keeps the head as the carrier row LAST child (anchor stays firstElementChild for Enter)', () => {
        const s = setup({ hasHistoryPermission: true, historyItems: HISTORY });
        s.def().activate();
        const m = s.$list.innerHTML.match(/<li class="vbm-row stats-hist-row has-head"[^>]*>([\s\S]*?)<\/li>/);
        expect(m).not.toBe(null);
        expect(m[1].indexOf('<a ')).toBe(0); // anchor first (keyboard.js Enter contract)
        expect(m[1]).toContain('stats-section-head" role="presentation">statsSectionRecent</div>');
        expect(m[1].indexOf('stats-section-head')).toBeGreaterThan(m[1].indexOf('</a>'));
    });

    it('refetches history on every activation (data is only pulled on activate)', () => {
        const s = setup({ hasHistoryPermission: true, historyItems: HISTORY });
        s.def().activate();
        s.def().activate();
        expect(s.chrome.history.searchCalls).toHaveLength(2);
        expect(s.chrome.bookmarks.getTreeCalls).toBe(1); // stats rows stay cached
    });
});

describe('history-permission guide row', () => {
    it('shows the compact guide (sentence + Enable) instead of the section while permission is missing', () => {
        const s = setup({}); // hasHistoryPermission defaults to false
        s.def().activate();
        expect(s.chrome.permissions.containsCalls).toEqual([{ permissions: ['history'] }]);
        expect(s.chrome.history.searchCalls).toEqual([]); // no fetch without a grant
        const html = s.$list.innerHTML;
        expect(html).toContain('stats-history-guide');
        expect(html).toContain('statsHistoryGuide');
        expect(html).toContain('statsSectionRecent'); // the guide carries the section head
        // the enable link is the row's firstElementChild (keyboard Enter contract)
        expect(html).toContain(
            '<li class="stats-history-guide has-head" role="listitem"><a href="" class="stats-history-enable"');
    });

    it('granting from the guide row fetches history immediately and swaps in the rows', () => {
        const s = setup({ hasHistoryPermission: false, requestGranted: true, historyItems: HISTORY });
        s.def().activate();
        expect(s.$list.innerHTML).toContain('stats-history-guide');
        s.click({
            preventDefault() {},
            target: { closest: sel => (sel === '.stats-history-enable' ? {} : null) }
        });
        expect(s.chrome.permissions.requestCalls).toEqual([{ permissions: ['history'] }]);
        expect(s.chrome.history.searchCalls).toHaveLength(1);
        expect(s.$list.innerHTML).not.toContain('stats-history-guide');
        expect(s.$list.innerHTML).toContain('stats-add-btn');
    });

    it('a denied request keeps the guide row and fetches nothing', () => {
        const s = setup({ hasHistoryPermission: false, requestGranted: false });
        s.def().activate();
        s.click({
            preventDefault() {},
            target: { closest: sel => (sel === '.stats-history-enable' ? {} : null) }
        });
        expect(s.chrome.permissions.requestCalls).toEqual([{ permissions: ['history'] }]);
        expect(s.chrome.history.searchCalls).toEqual([]);
        expect(s.$list.innerHTML).toContain('stats-history-guide');
    });
});

describe('one-click bookmark from a history row (☆)', () => {
    const starClick = (s, idx) => s.click({
        preventDefault() {},
        target: {
            closest: sel => (sel === '.stats-add-btn' ? { dataset: { histIdx: `${idx}` } } : null)
        }
    });

    it('creates under quickAddFolderId, flips the row, invalidates the tree and toasts', () => {
        const s = setup({
            hasHistoryPermission: true,
            historyItems: HISTORY,
            storeData: { quickAddFolderId: '5' },
            folderNodes: [{ title: 'Work' }]
        });
        s.def().activate();
        starClick(s, 1); // the unbookmarked row
        expect(s.chrome.bookmarks.createCalls).toEqual([
            { title: 'Elsewhere', url: 'http://elsewhere/', parentId: '5' }
        ]);
        expect(s.chrome.bookmarks.getCalls).toEqual(['5']);
        expect(s.undo.toasts).toEqual(['quickAddedTo[Work]']); // quick-add wording, reused
        expect(s.onChanged.calls).toBe(1);
        // flipped: ★ badge + real id, the ☆ button is gone
        expect(s.$list.innerHTML).not.toContain('stats-add-btn');
        expect(s.$list.innerHTML).toContain('id="stats-hist-99"');
        expect(s.$list.innerHTML).toContain('data-node-id="99"');
        const flipped = s.treeRender.calls[s.treeRender.calls.length - 1];
        expect(flipped.id).toBe('99');
        expect(flipped.meta.badge)
            .toEqual({ text: '★', cls: 'starred', aria: 'statsHistoryBookmarked' });
    });

    it('lands in the bookmarks bar (id 1) when quickAddFolderId is unset', () => {
        const s = setup({ hasHistoryPermission: true, historyItems: HISTORY });
        s.def().activate();
        starClick(s, 1);
        expect(s.chrome.bookmarks.createCalls[0].parentId).toBe('1');
    });

    it('falls back to the URL as title and ignores repeat adds on a flipped row', () => {
        const s = setup({
            hasHistoryPermission: true,
            historyItems: [{ url: 'http://untitled/', title: '', lastVisitTime: NOW - 100 }]
        });
        s.def().activate();
        starClick(s, 0);
        expect(s.chrome.bookmarks.createCalls[0].title).toBe('http://untitled/');
        starClick(s, 0); // already bookmarked — the guard makes it a no-op
        expect(s.chrome.bookmarks.createCalls).toHaveLength(1);
    });

    it('a failed create leaves the row unbookmarked (no flip, no toast, no invalidation)', () => {
        const s = setup({ hasHistoryPermission: true, historyItems: HISTORY, createResult: undefined });
        s.def().activate();
        starClick(s, 1);
        expect(s.chrome.bookmarks.createCalls).toHaveLength(1);
        expect(s.undo.toasts).toEqual([]);
        expect(s.onChanged.calls).toBe(0);
        expect(s.$list.innerHTML).toContain('stats-add-btn'); // still unbookmarked
    });
});

describe('contextmenu on rows without a bookmark id', () => {
    it('is swallowed on unbookmarked rows but bubbles through on bookmarked ones', () => {
        const s = setup({ hasHistoryPermission: true, historyItems: HISTORY });
        s.def().activate();
        const calls = { prevent: 0, stop: 0 };
        const ev = li => ({
            target: { closest: sel => (sel === 'li' ? li : null) },
            preventDefault() { calls.prevent++; },
            stopPropagation() { calls.stop++; }
        });
        s.contextmenu(ev({ dataset: {} })); // unbookmarked history row / guide row
        expect(calls).toEqual({ prevent: 1, stop: 1 });
        s.contextmenu(ev({ dataset: { nodeId: '7' } })); // bookmarked row → menu chain intact
        expect(calls).toEqual({ prevent: 1, stop: 1 });
    });
});

describe('statsEnabled off (第四轮项9 regression)', () => {
    it('probes nothing and fetches nothing while the master switch is off', () => {
        const s = setup({ enabled: false, hasHistoryPermission: true, historyItems: HISTORY });
        s.def().activate();
        expect(s.chrome.permissions.containsCalls).toEqual([]);
        expect(s.chrome.history.searchCalls).toEqual([]);
        expect(s.$list.innerHTML).toContain('<i>statsDisabledHint</i>');
        expect(s.$list.innerHTML).not.toContain('statsSectionRecent');
    });
});

describe('dataset revision dirty-check (第四轮缝合)', () => {
    it('refreshes on activate when visitStats.revision moved (external import)', () => {
        const s = setup({
            statsData: { '7': { c: 2, t: 1 } },
            revision: 1,
            hasHistoryPermission: false
        });
        s.def().activate(); // first render records revision 1
        expect(s.chrome.bookmarks.getTreeCalls).toBe(1);
        s.def().activate(); // same revision + rendered list → no refresh
        expect(s.chrome.bookmarks.getTreeCalls).toBe(1);
        s.visitStats.rev = 2; // the recent view's history import landed
        s.def().activate();
        expect(s.chrome.bookmarks.getTreeCalls).toBe(2);
    });
});
