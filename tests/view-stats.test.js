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
            searchCalls: [],
            search(q, cb) {
                this.searchCalls.push(q);
                cb(opts.urlSearchResults || []);
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
        undo, onChanged: onChanged.fn,
        ...(opts.onRowsRendered ? { onRowsRendered: opts.onRowsRendered } : {})
    });
    return {
        viewStats, $list, $container, chrome: chromeStub, store, views,
        treeRender, treeView, dialogs, visitStats, undo, onChanged,
        def: () => views.def,
        click: ev => $list._listeners.click[0](ev),
        contextmenu: ev => $list._listeners.contextmenu[0](ev),
        keydown: ev => ($list._listeners.keydown || []).forEach(fn => fn(ev))
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

describe('render hooks (fifth round, item: dead-mark overlays)', () => {
    it('calls onRowsRendered after every render with the rows in the DOM', () => {
        const seen = [];
        const s = setup({
            statsData: { '7': { c: 2, t: NOW - 1000 } },
            onRowsRendered: () => seen.push(document.getElementById('stats-list').innerHTML)
        });
        s.def().activate();
        expect(seen.length).toBeGreaterThan(0);
        expect(seen[seen.length - 1]).toContain('stats-item-7');
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
        // meta slot = time → count; the path rides rightText (CSS order puts
        // it left of the time in the narrow row: path → time → count → icon)
        expect(first.badge[0]).toEqual({ text: 'timeJustNow', cls: 'time' });
        expect(first.badge[1]).toEqual({ text: '×5', cls: 'count', aria: 'statsVisitCount[5]' });
        expect(first.rightText).toBe(''); // 8 lives at root — pathOf gives ''
        expect(first.subText).toBe(new Date(NOW - 2000).toLocaleString()); // abs time, no path
        const second = s.treeRender.calls[1].meta;
        expect(second.subText).toBe(`bar · ${new Date(NOW - 1000).toLocaleString()}`); // path · time
        expect(second.rightText).toBe('bar');
        expect(s.$list.innerHTML).toContain('id="stats-item-8"');
        expect(s.$list.innerHTML).toContain('data-node-id="7"');
        // the ★ rides the line end as a non-interactive marker (aligned with
        // ☆) — rendered as the filled STAR_ICON_FILLED svg, not a text glyph
        expect(s.$list.innerHTML).toContain('class="stats-star"');
        expect(s.$list.innerHTML).toContain('vbm-icon-star-filled');
        expect(s.$list.innerHTML).not.toContain('row-badge starred');
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
        // fixed meta order regardless of sort: time → count (★ at line end)
        expect(first.badge[0]).toEqual({ text: 'timeJustNow', cls: 'time' });
        expect(first.badge[1]).toEqual({ text: '×2', cls: 'count', aria: 'statsVisitCount[2]' });
        expect(first.rightText).toBe('bar'); // 7's parent path in the narrow slot
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
    it('shows statsEmpty when nothing has been recorded (granted but empty history)', () => {
        // with the history permission granted (empty) the merged list has no
        // rows and no guide row → the standalone statsEmpty state
        const s = setup({ hasHistoryPermission: true, historyItems: [] });
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
        // history granted-but-empty so the cleared merged list lands on the
        // standalone statsEmpty state (no guide row to hold it)
        const s = setup({
            hasHistoryPermission: true,
            historyItems: [],
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

describe('merged list (统计合并)', () => {
    const toggleOff = s => s.$list._listeners.change[0]({
        target: { classList: { contains: c => c === 'stats-unbookmarked-input' }, checked: false }
    });
    const clickSort = (s, value) => s.click({
        preventDefault() {},
        target: { closest: sel => (sel === '.seg-btn' ? { dataset: { sort: value } } : null) }
    });

    it('merges bookmarked stats rows and unbookmarked history rows into one list', () => {
        const s = setup({
            hasHistoryPermission: true,
            historyItems: HISTORY,
            statsData: { '7': { c: 5, t: NOW } } // Alpha: 5 popup opens
        });
        s.def().activate();
        expect(s.chrome.history.searchCalls).toEqual([{ text: '', startTime: 0, maxResults: 200 }]);
        const html = s.$list.innerHTML;
        // toolbar checkbox rides next to the sort segment, default on
        expect(html).toContain('class="stats-unbookmarked-input" checked');
        // ONE list: no section heads any more
        expect(html).not.toContain('stats-section-head');
        // bookmarked row: time + count pill in the meta slot, ★ at line end
        expect(html).toContain('id="stats-item-7"');
        expect(html).toContain('data-node-id="7"');
        const bmCall = s.treeRender.calls.find(c => c.url === 'http://a/');
        expect(bmCall.id).toBe('7');
        expect(bmCall.meta.badge).toEqual([
            { text: 'timeJustNow', cls: 'time' },
            { text: '×5', cls: 'count', aria: 'statsVisitCount[5]' }
        ]);
        expect(html).toContain('class="stats-star"'); // ★ line-end marker
        expect(html).toContain('vbm-icon-star-filled'); // filled STAR_ICON
        expect(html).not.toContain('row-badge starred');
        // unbookmarked row: no row id, count comes from history visitCount,
        // ☆ one-click-add button preserved (hollow-outline line-end) — the
        // hollow STAR_ICON, same path as the filled marker, danger-red
        const unCall = s.treeRender.calls.find(c => c.url === 'http://elsewhere/');
        expect(unCall.id).toBe(null);
        expect(unCall.meta.badge).toEqual([
            { text: 'timeJustNow', cls: 'time' },
            { text: '×1', cls: 'count', aria: 'statsVisitCount[1]' }
        ]);
        expect(html).toContain('class="row-btn stats-add-btn" data-hist-idx="1"');
        expect(html).toContain('vbm-icon-star'); // hollow STAR_ICON
        expect(html).toContain('statsHistoryAdd');
        // count order interleaves them: 5 > 1
        expect(html.indexOf('stats-item-7')).toBeLessThan(html.indexOf('stats-hist-row'));
    });

    it('unbookmarked rows sort to the bottom when history carries no visitCount', () => {
        const s = setup({
            hasHistoryPermission: true,
            statsData: { '7': { c: 2, t: NOW } },
            historyItems: [{ url: 'http://elsewhere/', title: 'Elsewhere', lastVisitTime: NOW - 500 }]
        });
        s.def().activate();
        const html = s.$list.innerHTML;
        expect(html.indexOf('stats-item-7')).toBeLessThan(html.indexOf('stats-hist-row'));
    });

    it('recent sort interleaves bookmarked and unbookmarked rows by last visit time', () => {
        const s = setup({
            hasHistoryPermission: true,
            statsData: { '7': { c: 3, t: NOW - 5000 } }, // bookmarked, older
            historyItems: [
                { url: 'http://a/', title: 'Alpha', visitCount: 1, lastVisitTime: NOW - 5000 },
                { url: 'http://elsewhere/', title: 'Elsewhere', visitCount: 9, lastVisitTime: NOW - 1000 } // newer
            ]
        });
        s.def().activate();
        clickSort(s, 'recent');
        const html = s.$list.innerHTML;
        // the newer unbookmarked row leads the older bookmarked row
        expect(html.indexOf('stats-hist-row')).toBeLessThan(html.indexOf('stats-item-7'));
        // the meta slot is fixed time→count regardless of sort — the count
        // pill is the SECOND badge (left of ★/☆), not the row-path
        const unCall = [...s.treeRender.calls].reverse().find(c => c.url === 'http://elsewhere/');
        expect(unCall.meta.badge[1]).toEqual({ text: '×9', cls: 'count', aria: 'statsVisitCount[9]' });
        expect(unCall.meta.badge[0]).toEqual({ text: 'timeJustNow', cls: 'time' });
        expect(unCall.meta.rightText).toBeUndefined();
    });

    it('a bookmarked history row with no stats entry joins as a count-from-history row', () => {
        const s = setup({ hasHistoryPermission: true, historyItems: HISTORY }); // no statsData
        s.def().activate();
        const bmCall = s.treeRender.calls.find(c => c.url === 'http://a/');
        expect(bmCall.id).toBe('7');
        expect(bmCall.meta.path).toBe('bar');
        // showItemPath on: wide second line = path · absTime, narrow slot = path
        expect(bmCall.meta.subText)
            .toBe(`bar · ${new Date(HISTORY[0].lastVisitTime).toLocaleString()}`);
        expect(bmCall.meta.rightText).toBe('bar');
        // the live tree supplies the row's parent id even though the stats
        // dataset never saw this bookmark
        expect(s.$list.innerHTML).toContain('data-node-id="7" data-parentid="1"');
        expect(bmCall.meta.badge).toEqual([
            { text: 'timeJustNow', cls: 'time' },
            { text: '×3', cls: 'count', aria: 'statsVisitCount[3]' } // history visitCount
        ]);
        expect(s.$list.innerHTML).toContain('class="stats-star"');
        const unCall = s.treeRender.calls.find(c => c.url === 'http://elsewhere/');
        expect(unCall.meta.subText).toBe(new Date(HISTORY[1].lastVisitTime).toLocaleString());
        expect(unCall.meta.badge[1]).toEqual({ text: '×1', cls: 'count', aria: 'statsVisitCount[1]' });
    });

    it('a newer history visit bumps the merged row t (recent order follows history)', () => {
        // id 7 has a stats entry with an old t; history shows a newer visit.
        // The merged row's t must come from the fresher of the two.
        const s = setup({
            hasHistoryPermission: true,
            statsData: { '7': { c: 2, t: NOW - 5000 } }, // stats t is old
            historyItems: [
                { url: 'http://a/', title: 'Alpha', visitCount: 1, lastVisitTime: NOW - 1000 } // history t newer
            ]
        });
        s.def().activate();
        const bmCall = s.treeRender.calls.find(c => c.url === 'http://a/');
        // the time badge reflects the bumped t (NOW-1000 → just now, not 5s ago)
        expect(bmCall.meta.badge[0]).toEqual({ text: 'timeJustNow', cls: 'time' });
        // recent sort leads by the bumped t
        s.click({
            preventDefault() {},
            target: { closest: sel => (sel === '.seg-btn' ? { dataset: { sort: 'recent' } } : null) }
        });
        expect(s.$list.innerHTML).toContain('id="stats-item-7"');
    });

    it('a bookmarked history row with a stats entry keeps the stats count (not history visitCount)', () => {
        const s = setup({
            hasHistoryPermission: true,
            statsData: { '7': { c: 5, t: NOW - 5000 } }, // 5 popup opens
            historyItems: [{ url: 'http://a/', title: 'Alpha', visitCount: 40, lastVisitTime: NOW - 1000 }]
        });
        s.def().activate();
        const bmCall = s.treeRender.calls.find(c => c.url === 'http://a/');
        // the ★ + stats count pill, NOT the history's 40
        expect(bmCall.meta.badge[1])
            .toEqual({ text: '×5', cls: 'count', aria: 'statsVisitCount[5]' });
    });

    it('unchecking the toggle drops the unbookmarked rows and persists the choice', () => {
        const s = setup({
            hasHistoryPermission: true,
            historyItems: HISTORY,
            statsData: { '7': { c: 5, t: NOW } }
        });
        s.def().activate();
        expect(s.$list.innerHTML).toContain('stats-hist-row');
        toggleOff(s);
        expect(s.store._data.statsShowUnbookmarked).toBe('');
        const html = s.$list.innerHTML;
        expect(html).not.toContain('stats-hist-row');
        expect(html).toContain('id="stats-item-7"'); // bookmarked rows stay
        // re-checking the box brings the unbookmarked rows back (the change
        // handler flips the flag and repaints)
        s.$list._listeners.change[0]({
            target: { classList: { contains: c => c === 'stats-unbookmarked-input' }, checked: true }
        });
        expect(s.store._data.statsShowUnbookmarked).toBe('1');
        expect(s.$list.innerHTML).toContain('stats-hist-row');
    });

    it('a persisted off flag reopens unchecked (popup survives reopen)', () => {
        // a fresh view seeded with the stored off-flag renders the checkbox
        // UNchecked and no unbookmarked rows, without any toggle click
        const s = setup({
            hasHistoryPermission: true,
            historyItems: HISTORY,
            storeData: { statsShowUnbookmarked: '' }
        });
        s.def().activate();
        expect(s.$list.innerHTML).toContain('class="stats-unbookmarked-input"'); // no checked attr
        expect(s.$list.innerHTML).not.toContain('checked');
        expect(s.$list.innerHTML).not.toContain('stats-hist-row');
    });

    it('clicking the toolbar checkbox never falls through to bookmarkHandler', () => {
        const s = setup({ hasHistoryPermission: true, historyItems: HISTORY });
        s.def().activate();
        const ev = {
            preventDefault() { this.prevented = true; },
            target: { closest: sel => (sel === '.stats-unbookmarked' ? {} : null) }
        };
        s.click(ev);
        expect(s.treeView.handlerCalls).toEqual([]); // swallowed, no bookmark open
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

    it('shows statsEmpty when granted but both datasets are empty', () => {
        const s = setup({ hasHistoryPermission: true, historyItems: [] });
        s.def().activate();
        expect(s.$list.innerHTML).not.toContain('stats-hist-row');
        expect(s.$list.innerHTML).not.toContain('stats-history-guide');
        expect(s.$list.innerHTML).toContain('<i>statsEmpty</i>');
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
    it('shows the compact guide (sentence + Enable) while permission is missing', () => {
        const s = setup({}); // hasHistoryPermission defaults to false
        s.def().activate();
        expect(s.chrome.permissions.containsCalls).toEqual([{ permissions: ['history'] }]);
        expect(s.chrome.history.searchCalls).toEqual([]); // no fetch without a grant
        const html = s.$list.innerHTML;
        expect(html).toContain('stats-history-guide');
        expect(html).toContain('statsHistoryGuide');
        expect(html).not.toContain('stats-section-head'); // no section heads in the merge
        // the enable link is the row's firstElementChild (keyboard Enter contract)
        expect(html).toContain(
            '<li class="stats-history-guide" role="listitem"><a href="" class="stats-history-enable"');
    });

    it('the guide row trails the bookmarked stats rows while permission is missing', () => {
        // permission missing BUT stats rows exist: the merged list renders the
        // stats rows, then the trailing guide row — never replaces them
        const s = setup({ statsData: { '7': { c: 2, t: NOW } } }); // no hasHistoryPermission
        s.def().activate();
        const html = s.$list.innerHTML;
        expect(html).toContain('id="stats-item-7"');
        expect(html).toContain('stats-history-guide');
        expect(html.indexOf('stats-item-7')).toBeLessThan(html.indexOf('stats-history-guide'));
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
        // flipped: ★ line-end marker + real id, the ☆ button is gone
        expect(s.$list.innerHTML).not.toContain('stats-add-btn');
        expect(s.$list.innerHTML).toContain('id="stats-item-99"');
        expect(s.$list.innerHTML).toContain('data-node-id="99"');
        expect(s.$list.innerHTML).toContain('class="stats-star"');
        const flipped = s.treeRender.calls[s.treeRender.calls.length - 1];
        expect(flipped.id).toBe('99');
        expect(flipped.meta.badge[0]).toEqual({ text: 'timeJustNow', cls: 'time' });
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

    // review 05-S6: a bookmark created mid-session (quick-add star, tree add)
    // doesn't flip the stale history row — the ☆ must not mint a duplicate.
    it('a URL already bookmarked mid-session flips the row instead of creating a dupe', () => {
        const s = setup({
            hasHistoryPermission: true,
            historyItems: HISTORY,
            urlSearchResults: [{ id: '42', title: 'Elsewhere', url: 'http://elsewhere/' }]
        });
        s.def().activate();
        starClick(s, 1); // the unbookmarked row
        expect(s.chrome.bookmarks.searchCalls).toEqual([{ url: 'http://elsewhere/' }]);
        expect(s.chrome.bookmarks.createCalls).toHaveLength(0); // no duplicate
        expect(s.undo.toasts).toEqual([]); // nothing was added — no quick-add toast
        expect(s.onChanged.calls).toBe(1);
        expect(s.$list.innerHTML).not.toContain('stats-add-btn');
        expect(s.$list.innerHTML).toContain('id="stats-item-42"');
        expect(s.$list.innerHTML).toContain('class="stats-star"');
    });

    it('checks the URL before creating (search precedes create)', () => {
        const s = setup({ hasHistoryPermission: true, historyItems: HISTORY });
        s.def().activate();
        starClick(s, 1);
        expect(s.chrome.bookmarks.searchCalls).toEqual([{ url: 'http://elsewhere/' }]);
        expect(s.chrome.bookmarks.createCalls).toHaveLength(1);
    });
});

describe('contextmenu on rows without a bookmark id', () => {
    it('bubbles on unbookmarked history rows (slim menu, #10), stays swallowed on the guide row', () => {
        const s = setup({ hasHistoryPermission: true, historyItems: HISTORY });
        s.def().activate();
        const calls = { prevent: 0, stop: 0 };
        const li = (cls, dataset) => ({
            dataset,
            classList: { contains: c => cls.indexOf(c) !== -1 }
        });
        const ev = row => ({
            target: { closest: sel => (sel === 'li' ? row : null) },
            preventDefault() { calls.prevent++; },
            stopPropagation() { calls.stop++; }
        });
        // unbookmarked history row → bubbles so context-menu.js opens its slim menu
        s.contextmenu(ev(li(['vbm-row', 'stats-hist-row'], {})));
        expect(calls).toEqual({ prevent: 0, stop: 0 });
        // the permission guide row must still be swallowed (Enable anchor, bogus id)
        s.contextmenu(ev(li(['stats-history-guide'], {})));
        expect(calls).toEqual({ prevent: 1, stop: 1 });
        // bookmarked row → menu chain intact
        s.contextmenu(ev(li(['vbm-row', 'stats-hist-row'], { nodeId: '7' })));
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
        expect(s.$list.innerHTML).not.toContain('stats-hist-row'); // no history data
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

// Final polish (keyboard-model §2.5): the view no longer walks the seg
// locally — ←/→ on toolbar controls are walked by keyboard.js's non-row
// branch across the whole toolbar rung (a view-local handler would
// double-step). The view binds no keydown of its own; even fed directly,
// the keys pass through unconsumed.
describe('sort seg arrow keys (§2.5 — owned by the toolbar rung)', () => {
    it('the view consumes no ←/→ on seg buttons', () => {
        const s = setup({});
        const btn = { classList: { contains: c => c === 'seg-btn' } };
        const ev = {
            key: 'ArrowRight',
            target: btn,
            prevented: 0,
            preventDefault() { this.prevented++; }
        };
        s.keydown(ev); // no view-local listener → a no-op pass-through
        expect(ev.prevented).toBe(0);
    });
});

describe('row focus park/restore (4.0.2 focus law)', () => {
    // The list-row twin of the toolbar park/restore above: every render's
    // innerHTML swap replaces the focused row (a sort switch, a star-add
    // flip, a clear) and the ↓ walk used to die on <body>. The doubles
    // model the swap the way the real DOM behaves: assigning innerHTML
    // replaces the li set querySelectorAll('li') hands out, and the
    // hand-written focus() lands on document.activeElement.
    const STATS = {
        '7': { c: 2, t: NOW - 1000 },
        '8': { c: 5, t: NOW - 2000 }
    };
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
    const statsSetup = () => {
        const s = setup({
            hasHistoryPermission: true, historyItems: [],
            statsData: STATS
        });
        s.def().activate();
        return s;
    };

    it('a focused stats row regains focus on its same-id replacement after a re-render', () => {
        const s = statsSetup();
        const doc = globalThis.document;
        const swap = wireSwap(s.$list, doc);
        const ul = ulOf(s.$list);
        const oldRow = row(doc, ul, 'stats-item-8');
        swap.current = [oldRow.li];
        doc.activeElement = oldRow.a;
        // the post-swap replacement row: same id, new element
        const newRow = row(doc, ul, 'stats-item-8');
        swap.next = [newRow.li];
        const origGet = doc.getElementById;
        doc.getElementById = id => (id === 'stats-item-8' ? newRow.li : origGet(id));
        s.viewStats.refresh(); // the sort switch's repaint
        expect(doc.activeElement).toBe(newRow.a);
    });

    it('a vanished row id falls back to the index-clamped row', () => {
        const s = statsSetup();
        const doc = globalThis.document;
        const swap = wireSwap(s.$list, doc);
        const ul = ulOf(s.$list);
        const r1 = row(doc, ul, 'stats-item-8');
        const r2 = row(doc, ul, 'stats-item-7');
        const r3 = row(doc, ul, 'stats-item-42');
        swap.current = [r1.li, r2.li, r3.li]; // focus sits on the third row
        doc.activeElement = r3.a;
        // row 42 is gone after the repaint — no getElementById hit — and the
        // list shrank to two rows
        const n1 = row(doc, ul, 'stats-item-8');
        const n2 = row(doc, ul, 'stats-item-7');
        swap.next = [n1.li, n2.li];
        s.viewStats.refresh();
        expect(doc.activeElement).toBe(n2.a); // min(2, 1) → the second row
    });

    it('with no rows at all after the swap, focus parks on the list container', () => {
        const s = statsSetup();
        const doc = globalThis.document;
        const swap = wireSwap(s.$list, doc);
        const ul = ulOf(s.$list);
        const oldRow = row(doc, ul, 'stats-item-8');
        swap.current = [oldRow.li];
        doc.activeElement = oldRow.a;
        swap.next = []; // nothing left to focus
        s.viewStats.refresh();
        expect(doc.activeElement).toBe(s.$list);
    });

    it('focus outside the list is left untouched by the render', () => {
        const s = statsSetup();
        const doc = globalThis.document;
        const outside = { tagName: 'BUTTON' }; // no LI anywhere up the chain
        doc.activeElement = outside;
        s.viewStats.refresh();
        expect(doc.activeElement).toBe(outside);
    });
});
