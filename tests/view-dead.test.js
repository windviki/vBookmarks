import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';

// view-dead.js touches page globals (document/window/chrome/fetch/setTimeout)
// only inside initViewDead and its handlers, so the real module imports
// cleanly in node once the globals are stubbed. store/views/treeRender/
// separatorManager/treeView/actions/dialogs/undo are injected recording
// doubles; the registered ViewDef is captured and driven by hand
// (activate/onKey/onEscape/badge). The scan itself runs in the service
// worker (v4 task-4 #16 — engine coverage lives in dead-scan-sw.test.js /
// dead-links.test.js): this suite drives the view as a MIRROR — the chrome
// double records runtime.sendMessage and fires storage.onChanged with the
// vbmDeadScan blob / deadLastScan cache exactly like the SW publishes them.
// setTimeout is a record-only stub advanced by hand (tick) for the 300ms
// repaint debounce. All assertions go through the doubles' records and the
// list's innerHTML — nothing is copied from the module body.

let initViewDead;
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
    ({ initViewDead } = await import('../src/view-dead.js'));
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
    delete globalThis.window;
});

const realFetch = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = realFetch;
});

const tick = ms => {
    const due = timeouts.filter(t => t[1] === ms);
    timeouts = timeouts.filter(t => t[1] !== ms);
    due.forEach(t => t[0]());
};

const flush = () => new Promise(resolve => realSetTimeout(resolve, 0));

// One fine bookmark, one dead, one only reachable through the relay, one
// separator (never probed). deadMarks presets land via opts.storeData.
const makeTree = () => [{
    id: '0', title: '', children: [
        {
            id: '1', title: 'Bar', children: [
                { id: '11', parentId: '1', title: 'Fine', url: 'https://fine.example/', dateAdded: 100 },
                { id: '12', parentId: '1', title: 'Gone', url: 'https://gone.example/page', dateAdded: 200 },
                { id: '13', parentId: '1', title: 'Blocked', url: 'https://blocked.example/', dateAdded: 300 },
                { id: '14', parentId: '1', title: 'Sep', url: 'http://separatethis.com/#1', dateAdded: 400 }
            ]
        }
    ]
}];


// li stub for the overlay assertions: dataset/id + a favicon-container that
// accepts and removes the .dead-indicator span.
const makeLi = (id, nodeId) => {
    const fav = {
        children: [],
        querySelector(sel) {
            return this.children.filter(c => c.className === sel.slice(1))[0] || null;
        },
        appendChild(c) {
            this.children.push(c);
            c.parentNode = this;
        },
        removeChild(c) {
            this.children = this.children.filter(x => x !== c);
            c.parentNode = null;
        }
    };
    return {
        id,
        dataset: nodeId ? { nodeId } : {},
        querySelector(sel) {
            return sel === '.favicon-container' ? fav : null;
        },
        _fav: fav
    };
};

const setup = (opts = {}) => {
    const byId = {};
    const makeEl = id => {
        const el = {
            id,
            _innerHTML: '',
            // a real innerHTML swap resets the scroll position — model it so
            // the #17 scroll-preservation path has something to prove against
            get innerHTML() { return this._innerHTML; },
            set innerHTML(v) { this._innerHTML = v; this.scrollTop = 0; },
            scrollTop: 0,
            _listeners: {},
            _lis: null, // overlay lists: fixed li set
            addEventListener(type, fn) {
                (this._listeners[type] = this._listeners[type] || []).push(fn);
            },
            querySelectorAll(sel) {
                return sel === 'li' && this._lis ? this._lis : [];
            }
        };
        byId[id] = el;
        return el;
    };
    const $list = makeEl('dead-list');
    const $container = makeEl('view-dead');
    const $tree = makeEl('tree');
    const $results = makeEl('results');
    const $recent = makeEl('recent-list');
    const $dupes = makeEl('dupes-list');
    const $stats = makeEl('stats-list');
    if (opts.treeLis)
        $tree._lis = opts.treeLis;

    const doc = {
        getElementById: id => byId[id] || null,
        activeElement: null,
        createElement: tag => ({ tagName: tag.toUpperCase(), className: '', textContent: '', parentNode: null })
    };
    globalThis.document = doc;
    const winListeners = {};
    globalThis.window = {
        addEventListener(type, fn) {
            (winListeners[type] = winListeners[type] || []).push(fn);
        }
    };

    const treeData = opts.tree || makeTree();
    const chromeStub = {
        i18n: {
            getMessage: (key, subs) =>
                subs ? `${key}[${[].concat(subs).join('|')}]` : key
        },
        // v4 task-4 #16: the view talks to the SW scan runner — sendMessage
        // records, storage.onChanged carries the runner's publications back.
        runtime: {
            sent: [],
            sendMessage(msg) { this.sent.push(msg); }
        },
        bookmarks: {
            getTreeCalls: 0,
            removeCalls: [],
            getTree(cb) {
                this.getTreeCalls++;
                cb(treeData);
            },
            // batch deletion: the serial removeSequentially chain calls remove
            // with a per-item callback — the double records and resolves
            remove(id, cb) {
                this.removeCalls.push(id);
                cb();
            },
            onCreated: { addListener(fn) { (this.fns = this.fns || []).push(fn); } },
            onRemoved: { addListener(fn) { (this.fns = this.fns || []).push(fn); } },
            onChanged: { addListener(fn) { (this.fns = this.fns || []).push(fn); } },
            onMoved: { addListener(fn) { (this.fns = this.fns || []).push(fn); } },
            fire(name, ...args) {
                (this[name].fns || []).forEach(fn => fn(...args));
            }
        },
        storage: {
            local: {
                // seeded like the store double — the SW's deadLastScan and a
                // live vbmDeadScan blob (opts.scanStorage) land here
                _data: { ...(opts.storeData || {}), ...(opts.scanStorage || {}) },
                get(keys, cb) {
                    const out = {};
                    for (const k of [].concat(keys))
                        if (k in this._data)
                            out[k] = this._data[k];
                    cb(out);
                }
            },
            onChanged: {
                fns: [],
                addListener(fn) { this.fns.push(fn); },
                fire(changes, area) { (this.fns || []).forEach(fn => fn(changes, area)); }
            }
        }
    };
    globalThis.chrome = chromeStub;

    const store = {
        _data: { ...(opts.storeData || {}) },
        get(key, dflt) {
            return key in this._data ? this._data[key] : dflt;
        },
        set(key, v) {
            this._data[key] = v;
        },
        remove(key) {
            delete this._data[key];
        }
    };

    const views = {
        def: null,
        active: 'active' in opts ? opts.active : true,
        register(def) { this.def = def; },
        isActive(id) { return id === 'dead' && this.active; },
        pathOf: opts.pathOf || (() => ''),
        showItemPath: () => true,
        badgeCalls: 0,
        updateBadges() { this.badgeCalls++; }
    };

    const treeRender = {
        calls: [],
        generateBookmarkHTML(title, url, extras, id, positions, meta) {
            this.calls.push({ title, url, extras, id, positions, meta });
            return `<a data-id="${id}">${title}</a>`;
        }
    };
    const separatorManager = {
        isSeparator: (title, url) => url.indexOf('separatethis') !== -1
    };
    const treeView = {
        revealCalls: [],
        revealInTree(id) { this.revealCalls.push(id); },
        handlerCalls: 0,
        bookmarkHandler: () => { treeView.handlerCalls++; },
        generateTreeCalls: 0,
        generateTree: () => { treeView.generateTreeCalls++; }
    };
    const actions = {
        deleteCalls: [],
        deleteBookmark(id) { this.deleteCalls.push(id); }
    };
    const dialogs = {
        ConfirmDialog: {
            openCalls: [],
            open(opts) { this.openCalls.push(opts); }
        }
    };
    const undo = {
        captureCalls: [],
        toastCalls: [],
        capture(id) { this.captureCalls.push(id); },
        showToast(msg) { this.toastCalls.push(msg); }
    };

    const viewDead = initViewDead({
        store, views, treeRender, separatorManager, treeView, actions, dialogs, undo
    });

    const fire = (type, ev) => {
        for (const fn of ($list._listeners[type] || []))
            fn(ev);
        return ev;
    };
    const clickOn = target => fire('click', {
        target,
        preventDefault() { this.prevented = (this.prevented || 0) + 1; },
        stopPropagation() { this.stopped = (this.stopped || 0) + 1; }
    });

    return {
        viewDead, $list, $container, $tree, $results, $recent, $dupes, $stats, doc, chrome: chromeStub,
        store, views, treeRender, separatorManager, treeView, actions, dialogs, undo,
        treeData, winListeners, def: () => views.def, fire, clickOn
    };
};

// --- SW scan-runner simulators (v4 task-4 #16) ------------------------------
// The view is a mirror of chrome.storage.local: these fire the exact
// storage.onChanged payloads the SW runner publishes (src/dead-scan-sw.js —
// the engine itself is covered by dead-scan-sw.test.js / dead-links.test.js).
const publishBlob = (ctx, blob) =>
    ctx.chrome.storage.onChanged.fire(
        { vbmDeadScan: { newValue: blob ? JSON.stringify(blob) : undefined } }, 'local');
const finishScan = (ctx, results) => {
    ctx.chrome.storage.onChanged.fire({
        deadLastScan: {
            newValue: JSON.stringify({ ts: 1700000000000, scannedCount: Object.keys(results).length, results })
        }
    }, 'local');
    publishBlob(ctx, null); // the runner deletes the live blob at finish
};
const blobOf = (over = {}) => ({
    state: 'scanning', done: 0, total: 3, ts: 1700000000000,
    items: ['11', '12', '13'], results: {}, proxy: { active: false, gate: '' },
    ...over
});

describe('view registration (§5.5)', () => {
    it('registers the dead view with tab metadata, badge and escape hook', () => {
        const { def, $list, $container } = setup({});
        expect(def().id).toBe('dead');
        expect(def().titleKey).toBe('viewDead');
        expect(def().icon).toContain('<svg');
        expect(def().container).toBe($container);
        expect(def().listEl).toBe($list);
        expect(def().typeAhead).toBe(false);
        expect(def().badge()).toBe(0);
        expect(def().onEscape()).toBe(false); // no scan running
    });

    it("badge() counts the last scan's dead+blocked rows (marks are not the badge)", () => {
        // marks alone (no scan cache) → 0: the badge is scan-derived
        const noScan = setup({ storeData: { deadMarks: '["11","12"]' } });
        noScan.def().activate(); // no deadLastScan in storage → lastScan stays null
        expect(noScan.def().badge()).toBe(0);
        // a cached scan with 1 dead + 1 blocked → 2, independent of marks
        const cache = JSON.stringify({
            ts: 1, scannedCount: 2,
            results: {
                '12': { status: 'dead', code: 404 },
                '13': { status: 'blocked', code: 404 }
            }
        });
        const withScan = setup({ storeData: { deadLastScan: cache } });
        withScan.def().activate();
        expect(withScan.def().badge()).toBe(2);
        // ok/skipped rows count for nothing
        const healthy = JSON.stringify({
            ts: 1, scannedCount: 2,
            results: {
                '11': { status: 'ok', code: 200 },
                '12': { status: 'skipped', code: 0 }
            }
        });
        const h = setup({ storeData: { deadLastScan: healthy } });
        h.def().activate();
        expect(h.def().badge()).toBe(0);
    });

    it('activate refreshes the tab badge after the async lastScan read — a stored scan shows on first open', () => {
        const cache = JSON.stringify({
            ts: 1, scannedCount: 1,
            results: { '11': { status: 'dead', code: 404 } }
        });
        const ctx = setup({ storeData: { deadLastScan: cache } });
        const bumps = ctx.views.badgeCalls;
        ctx.def().activate();
        // the activation-time updateBadges ran BEFORE the storage read, so the
        // read-then-render path must bump it again — otherwise the badge stays
        // hidden until a later event (regression: dead tab badge missing on open).
        expect(ctx.def().badge()).toBe(1);
        expect(ctx.views.badgeCalls).toBeGreaterThan(bumps);
    });

    it('the badge derives from the tree-joined rows — a stale cache cannot revive it', () => {
        // Popup reopened after dead bookmarks were deleted elsewhere: the
        // persisted cache still holds their verdicts, but the badge counts
        // the tree-JOINED row set (allResultRows), not the raw cache. Before
        // any activation there is no join at all → the badge stays dark
        // instead of lighting the stale count (the revival regression).
        const cache = JSON.stringify({
            ts: 1, scannedCount: 3,
            results: {
                '11': { status: 'dead', code: 404 },
                '12': { status: 'blocked', code: 404 },
                '99': { status: 'dead', code: 404 } // deleted while the popup was closed
            }
        });
        const ctx = setup({ storeData: { deadLastScan: cache } });
        expect(ctx.def().badge()).toBe(0); // no tree join yet → dark
        ctx.def().activate();
        // after the join the badge tracks the rows the list shows: 99's
        // bookmark is gone from the tree, so it drops out of the count
        expect(ctx.def().badge()).toBe(2);
        expect(ctx.$list.innerHTML).toContain('id="dead-item-11"');
        expect(ctx.$list.innerHTML).toContain('id="dead-item-12"');
        expect(ctx.$list.innerHTML).not.toContain('dead-item-99');
        // without a stored scan the badge stays hidden (0)
        const none = setup({});
        expect(none.def().badge()).toBe(0);
    });

    it('exposes refresh/refreshOverlays/isMarked/toggleMark on the module API', () => {
        const { viewDead } = setup({});
        expect(Object.keys(viewDead).sort())
            .toEqual(['isMarked', 'refresh', 'refreshOverlays', 'toggleMark']);
    });
});

describe('empty state + cached results (§5.5a)', () => {
    it('renders the executable start hint with the scannable count (separators excluded)', () => {
        const { $list, def } = setup({});
        def().activate();
        expect($list.innerHTML).toContain('class="empty-state dead-start"');
        expect($list.innerHTML).toContain('deadStartHint[3]'); // 3 scannable, sep out
    });

    it('no scan yet but marks exist: the marked rows stay listable and individually unmarkable', () => {
        // A first scan cancelled before finishing leaves deadMarks with no
        // result list to host them — they must still render (joined to the
        // tree), each with its own unmark toggle, so the user is never
        // stranded with no way to clear a single mark.
        const ctx = setup({ storeData: { deadMarks: '["12","13"]' } });
        const { $list, store } = ctx;
        ctx.def().activate(); // no deadLastScan → lastScan null
        const html = $list.innerHTML;
        // the marked rows are listable with their marks
        expect(html).toContain('deadMarkedCount[2]');
        expect(html).toContain('id="dead-item-12"');
        expect(html).toContain('id="dead-item-13"');
        expect(html).toContain('deadMarked'); // the per-row badge
        // each row carries the marked-state toggle (unmark just that one)
        expect(html).toContain('class="row-btn dead-mark-btn marked"');
        // …and the executable start row still offers the way back into a scan
        expect(html).toContain('class="empty-state dead-start"');
        // toggling one row's mark unmarks ONLY that id
        ctx.clickOn({
            closest: sel => (sel === '.dead-mark-btn'
                ? { closest: () => ({ dataset: { nodeId: '12' } }) }
                : null)
        });
        expect(JSON.parse(store.get('deadMarks', '[]'))).toEqual(['13']);
    });


    it('the start row sends the start message on click and on Enter', () => {
        const ctx = setup({});
        ctx.def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-start' ? {} : null) });
        expect(ctx.chrome.runtime.sent).toEqual([{ type: 'vbm-dead-scan-start' }]);
        // Enter path on a fresh view
        const ctx2 = setup({});
        ctx2.def().activate();
        ctx2.fire('keydown', {
            key: 'Enter',
            target: { classList: { contains: c => c === 'dead-start' } },
            preventDefault() {}, stopPropagation() {}
        });
        expect(ctx2.chrome.runtime.sent).toEqual([{ type: 'vbm-dead-scan-start' }]);
    });

    it('a cached scan renders the info row and skips auto-scanning', () => {
        const cache = JSON.stringify({
            ts: 1700000000000, scannedCount: 3,
            results: { '12': { status: 'dead', code: 404 } }
        });
        const { $list, treeRender, def, chrome } = setup({ storeData: { deadLastScan: cache } });
        def().activate();
        expect(chrome.runtime.sent).toEqual([]); // no rescan on entry
        const html = $list.innerHTML;
        expect(html).toContain(`deadLastScanAt[${new Date(1700000000000).toLocaleString()}]`);
        expect(html).toContain('deadRescan');
        expect(html).toContain('id="dead-item-12"');
        // the badge rides the meta slot (the treeRender double renders no pills)
        expect(treeRender.calls.find(c => c.id === '12').meta.badge)
            .toEqual({ text: '404', cls: 'dead' });
        // the row actions are SVG icons now (flag mark toggle + trash delete),
        // on the same 16px line grid as the folder/tab icons
        expect(html).toContain('vbm-icon-flag');
        expect(html).toContain('vbm-icon-trash');
        expect(html).not.toMatch(/dead-mark-btn"[^>]*>⚑/);
        expect(html).not.toMatch(/dead-del-btn"[^>]*>×/);
    });

    it('a cached scan + marks: uncovered marks render as their own list, each unmarkable', () => {
        // The cancelled-rescan scenario: lastScan holds id 12 (dead), and the
        // user ALSO marked ids 11 and 13 — 12 is covered by the result rows,
        // but 11/13 were never probed by that cached run. 12 must stay in the
        // result list (not duplicated), while 11/13 need a list of their own
        // or they'd have no per-mark clear entry at all.
        const cache = JSON.stringify({
            ts: 1700000000000, scannedCount: 1,
            results: { '12': { status: 'dead', code: 404 } }
        });
        const ctx = setup({
            storeData: { deadLastScan: cache, deadMarks: '["11","12","13"]' }
        });
        const { $list, store } = ctx;
        ctx.def().activate();
        const html = $list.innerHTML;
        // the covered mark rides the result row only (no duplicate row id)
        expect(html).toContain('id="dead-item-12"');
        expect(html.match(/id="dead-item-12"/g)).toHaveLength(1);
        // the uncovered marks get their own list with the count header
        expect(html).toContain('deadMarkedCount[2]'); // 11 + 13
        expect(html).toContain('id="dead-item-11"');
        expect(html).toContain('id="dead-item-13"');
        // unmarking ONE uncovered mark clears just that id
        ctx.clickOn({
            closest: sel => (sel === '.dead-mark-btn'
                ? { closest: () => ({ dataset: { nodeId: '13' } }) }
                : null)
        });
        expect(JSON.parse(store.get('deadMarks', '[]')).sort()).toEqual(['11', '12']);
    });

    it('activate({ preset: { scan:true } }) kicks the scan off on entry (v4 task-4 #6)', () => {
        const ctx = setup({});
        ctx.def().activate({ preset: { scan: true } });
        expect(ctx.chrome.runtime.sent).toEqual([{ type: 'vbm-dead-scan-start' }]);
    });

    it('the scan preset does not restart a live scan (the stored blob guards re-entry)', () => {
        // Mid-scan, the SW's live blob sits in chrome.storage.local — the
        // activate-time sync folds it in and startScan's guard holds.
        const ctx = setup({ scanStorage: { vbmDeadScan: JSON.stringify(blobOf({ done: 1 })) } });
        ctx.def().activate({ preset: { scan: true } });
        expect(ctx.chrome.runtime.sent).toEqual([]); // a live run: no second start
    });

    it('a clean scan (zero dead rows) still offers rescan next to the timestamp', () => {
        // f5bc7cb regression: the rescan button had moved inside the
        // rows-non-empty branch, so a fully healthy result left no in-view
        // way to scan again.
        const clean = JSON.stringify({
            ts: 1700000000000, scannedCount: 3,
            results: {
                '11': { status: 'ok', code: 200 },
                '12': { status: 'ok', code: 200 },
                '13': { status: 'ok', code: 200 }
            }
        });
        const ctx = setup({ storeData: { deadLastScan: clean } });
        const { $list, chrome } = ctx;
        ctx.def().activate();
        expect($list.innerHTML).toContain('deadNone'); // the clean empty state
        expect($list.innerHTML).not.toContain('dead-delete-all'); // nothing to delete
        expect($list.innerHTML).toContain('class="dead-rescan"'); // …but rescan stays
        ctx.clickOn({ closest: sel => (sel === '.dead-rescan' ? {} : null) });
        expect(chrome.runtime.sent).toEqual([{ type: 'vbm-dead-scan-start' }]);
    });
});

describe('scan mirror — the SW runs the scan (v4 task-4 #16 + #17)', () => {
    it('a published blob renders the progress toolbar and the settled rows', () => {
        const ctx = setup({});
        const { $list, def } = ctx;
        def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-start' ? {} : null) });
        expect(ctx.chrome.runtime.sent).toEqual([{ type: 'vbm-dead-scan-start' }]);
        publishBlob(ctx, blobOf({
            done: 1, results: { '12': { status: 'dead', code: 404 } }
        }));
        const html = $list.innerHTML;
        expect(html).toContain('<progress');
        // #17: the label is the bare counter; the full sentence moved to
        // the title/aria-label
        expect(html).toContain('>1/3<');
        expect(html).toContain('title="deadChecking[1|3]"');
        expect(html).toContain('deadPause');
        expect(html).toContain('id="dead-item-12"');
        expect(html).not.toContain('id="dead-item-11"'); // healthy stays out
        expect(html).not.toContain('id="dead-item-13"'); // unsettled stays out
        // a second start click while the blob lives sends nothing
        ctx.clickOn({ closest: sel => (sel === '.dead-start' ? {} : null) });
        expect(ctx.chrome.runtime.sent).toHaveLength(1);
    });

    it('pause/resume send messages and flip the toolbar optimistically; Esc toggles too', () => {
        const ctx = setup({});
        const { $list, def, chrome } = ctx;
        def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-start' ? {} : null) });
        publishBlob(ctx, blobOf({ done: 1 }));
        ctx.clickOn({ closest: sel => (sel === '.dead-pause' ? {} : null) });
        expect(chrome.runtime.sent.map(m => m.type)).toEqual(
            ['vbm-dead-scan-start', 'vbm-dead-scan-pause']);
        expect($list.innerHTML).toContain('deadResume'); // optimistic flip
        expect($list.innerHTML).toContain('deadPaused'); // state tag
        expect(def().onEscape()).toBe(true); // Esc while paused: resume
        expect(chrome.runtime.sent.map(m => m.type)[2]).toBe('vbm-dead-scan-resume');
        expect($list.innerHTML).toContain('deadPause');
        expect(def().onEscape()).toBe(true); // and back to paused
        expect(chrome.runtime.sent.map(m => m.type)[3]).toBe('vbm-dead-scan-pause');
        // the SW's published transition re-syncs the optimistic mirror
        publishBlob(ctx, blobOf({ state: 'paused', done: 1 }));
        expect($list.innerHTML).toContain('deadResume');
    });

    it('cancel sends the message and drops the mirror (the run never happened)', () => {
        const ctx = setup({});
        const { $list, def, chrome } = ctx;
        def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-start' ? {} : null) });
        publishBlob(ctx, blobOf({ done: 1, results: { '12': { status: 'dead', code: 404 } } }));
        ctx.clickOn({ closest: sel => (sel === '.dead-cancel' ? {} : null) });
        expect(chrome.runtime.sent.map(m => m.type)[1]).toBe('vbm-dead-scan-cancel');
        // state reset: back to the executable start hint, no cache written
        expect($list.innerHTML).toContain('class="empty-state dead-start"');
        expect(def().onEscape()).toBe(false); // no live run: Esc falls through
        publishBlob(ctx, null); // the SW's blob deletion changes nothing more
        expect($list.innerHTML).toContain('dead-start');
    });

    it('a finish (cache write + blob removal) renders the cache and prunes healthy marks', () => {
        const ctx = setup({ storeData: { deadMarks: '["11","12"]' } });
        const { $list, store, def, views } = ctx;
        def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-start' ? {} : null) });
        publishBlob(ctx, blobOf({
            done: 2, results: { '12': { status: 'dead', code: 404 } }
        }));
        expect($list.innerHTML).toContain('deadChecking'); // mid-scan render
        // a finish ALWAYS re-evaluates the scan-count badge, even when no
        // mark was pruned (id 11 is healthy but NOT marked)
        const badgeBumps = views.badgeCalls;
        finishScan(ctx, {
            '11': { status: 'ok', code: 200 },
            '12': { status: 'dead', code: 404 },
            '13': { status: 'blocked', code: 404 }
        });
        expect(views.badgeCalls).toBeGreaterThan(badgeBumps);
        const html = $list.innerHTML;
        expect(html).toContain('deadLastScanAt');
        expect(html).toContain('id="dead-item-12"');
        expect(html).toContain('id="dead-item-13"');
        expect(html).not.toContain('id="dead-item-11"');
        // §5.5c: ids that came back healthy lose their mark
        expect(JSON.parse(store.get('deadMarks'))).toEqual(['12']);
        // the badge is the scan's dead+blocked count (12 dead + 13 blocked),
        // not the marks — unchanged by the prune
        expect(def().badge()).toBe(2);
    });

    it('cancel with a previous cache restores the cached view', () => {
        const CACHE = JSON.stringify({
            ts: 1700000000000, scannedCount: 3,
            results: { '12': { status: 'dead', code: 404 } }
        });
        const ctx = setup({ storeData: { deadLastScan: CACHE } });
        const { $list, chrome } = ctx;
        ctx.def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-rescan' ? {} : null) });
        publishBlob(ctx, blobOf({ done: 1 }));
        expect($list.innerHTML).toContain('deadPause');
        ctx.clickOn({ closest: sel => (sel === '.dead-cancel' ? {} : null) });
        expect(chrome.runtime.sent.map(m => m.type)).toEqual(
            ['vbm-dead-scan-start', 'vbm-dead-scan-cancel']);
        expect($list.innerHTML).toContain('deadLastScanAt');
        expect($list.innerHTML).toContain('id="dead-item-12"');
    });

    it('re-entering the view mid-scan renders the blob from storage (even paused)', () => {
        const ctx = setup({
            scanStorage: {
                vbmDeadScan: JSON.stringify(blobOf({
                    state: 'paused', done: 1,
                    results: { '12': { status: 'dead', code: 404 } }
                }))
            }
        });
        const { $list, chrome } = ctx;
        ctx.def().activate(); // the blob is read straight from storage
        const html = $list.innerHTML;
        expect(html).toContain('deadResume');
        expect(html).toContain('>1/3<');
        expect(html).toContain('id="dead-item-12"');
        expect(html).not.toContain('dead-start');
        expect(chrome.runtime.sent).toEqual([]); // a re-entry never restarts
    });

    it('mid-scan ticks keep the list scroll position (#17)', () => {
        const ctx = setup({});
        const { $list } = ctx;
        ctx.def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-start' ? {} : null) });
        publishBlob(ctx, blobOf({ done: 1, results: { '12': { status: 'dead', code: 404 } } }));
        $list.scrollTop = 42; // the user scrolled the progressive list
        publishBlob(ctx, blobOf({
            done: 2,
            results: { '12': { status: 'dead', code: 404 }, '13': { status: 'blocked', code: 404 } }
        }));
        expect($list.scrollTop).toBe(42); // the double resets it on swap — the view restored it
    });
});

describe('item 10: row layout CSS contract', () => {
    // jsdom has no layout engine — pin the flex recipe in the CSS text
    // (same ruleBody pattern as tests/tree-alignment.test.js).
    const neatCss = fs.readFileSync(new URL('../css/neat.css', import.meta.url), 'utf8');
    const ruleBody = (css, selector) => {
        const i = css.indexOf(selector);
        expect(i, `rule for ${selector} exists`).toBeGreaterThanOrEqual(0);
        const open = css.indexOf('{', i);
        const close = css.indexOf('}', open);
        return css.slice(open + 1, close);
    };

    it('dead result rows go flex so the row buttons stay on the row line', () => {
        const body = ruleBody(neatCss, '#dead-list ul li.vbm-row {');
        expect(body).toContain('display: flex');
        // v4 task-3 #3: two-line (wide/panel) rows center the mark/delete
        // buttons vertically against the whole row height.
        expect(body).toContain('align-items: center');
    });

    it('the row anchor flexes with min-width:0 and centers its favicon', () => {
        const body = ruleBody(neatCss, '#dead-list ul li.vbm-row > a {');
        expect(body).toContain('flex: 1');
        expect(body).toContain('min-width: 0');
        // the anchor centers the favicon against the two-line row (the old
        // flex-start pinned it to the title line — off-center on wide rows)
        expect(body).toContain('align-items: center');
    });

    it('no favicon-container min-height override remains (the anchor centers it)', () => {
        expect(neatCss).not.toMatch(
            /#dead-list ul li\.vbm-row > a \.favicon-container \{[^}]*min-height/);
    });
});

describe('filter + batch marks (§5.5c)', () => {
    const CACHE = JSON.stringify({
        ts: 1700000000000, scannedCount: 3,
        results: {
            '11': { status: 'ok', code: 200 },
            '12': { status: 'dead', code: 404 },
            '13': { status: 'blocked', code: 404 }
        }
    });

    it('the three-state filter switches the rendered rows, defaulting to all', () => {
        const ctx = setup({ storeData: { deadLastScan: CACHE } });
        const { $list, def } = ctx;
        def().activate();
        expect($list.innerHTML).toContain('id="dead-item-12"');
        expect($list.innerHTML).toContain('id="dead-item-13"');
        expect($list.innerHTML).toContain('deadFilterAll');
        ctx.clickOn({ closest: sel => (sel === '.dead-filter-btn' ? { dataset: { filter: 'blocked' } } : null) });
        expect($list.innerHTML).not.toContain('id="dead-item-12"');
        expect($list.innerHTML).toContain('id="dead-item-13"');
        ctx.clickOn({ closest: sel => (sel === '.dead-filter-btn' ? { dataset: { filter: 'dead' } } : null) });
        expect($list.innerHTML).toContain('id="dead-item-12"');
        expect($list.innerHTML).not.toContain('id="dead-item-13"');
    });

    it('a filter matching nothing keeps the segment bar reachable (item: filter lock-up)', () => {
        // Only a dead row in the cache — "blocked only" matches nothing.
        // The segment buttons must stay rendered off the UNFILTERED count,
        // otherwise there is no way back short of reopening the popup.
        const cache = JSON.stringify({
            ts: 1700000000000, scannedCount: 2,
            results: {
                '11': { status: 'ok', code: 200 },
                '12': { status: 'dead', code: 404 }
            }
        });
        const ctx = setup({ storeData: { deadLastScan: cache } });
        const { $list } = ctx;
        ctx.def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-filter-btn' ? { dataset: { filter: 'blocked' } } : null) });
        expect($list.innerHTML).not.toContain('id="dead-item-12"');
        expect($list.innerHTML).toContain('deadFilterAll');
        expect($list.innerHTML).toContain('deadFilterBlocked');
        // the empty line names the filter, not the plain "no dead links"
        expect($list.innerHTML).toContain('deadNoneFiltered');
        expect($list.innerHTML).not.toContain('deadNone"');
        // …and switching back to all brings the rows back
        ctx.clickOn({ closest: sel => (sel === '.dead-filter-btn' ? { dataset: { filter: 'all' } } : null) });
        expect($list.innerHTML).toContain('id="dead-item-12"');
    });

    it('mark-all marks every dead+blocked row after confirmation and toasts', () => {
        const ctx = setup({ storeData: { deadLastScan: CACHE } });
        const { store, dialogs, undo, viewDead } = ctx;
        ctx.def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-mark-all' ? {} : null) });
        expect(dialogs.ConfirmDialog.openCalls).toHaveLength(1);
        expect(JSON.parse(store.get('deadMarks', '[]'))).toEqual([]); // still gated
        dialogs.ConfirmDialog.openCalls[0].fn1();
        expect(JSON.parse(store.get('deadMarks')).sort()).toEqual(['12', '13']);
        expect(undo.toastCalls).toEqual(['deadMarked']);
        expect(viewDead.isMarked('12')).toBe(true);
    });

    it('clear-all-marks empties the set after confirmation', () => {
        const ctx = setup({ storeData: { deadLastScan: CACHE, deadMarks: '["12","13"]' } });
        const { store, dialogs, viewDead } = ctx;
        ctx.def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-unmark-all' ? {} : null) });
        dialogs.ConfirmDialog.openCalls[0].fn1();
        expect(JSON.parse(store.get('deadMarks'))).toEqual([]);
        expect(viewDead.isMarked('12')).toBe(false);
        // clearing the marks does not touch the scan-derived badge (12+13)
        expect(ctx.def().badge()).toBe(2);
    });

    it('cancelling the batch dialog leaves the marks untouched', () => {
        const ctx = setup({ storeData: { deadLastScan: CACHE, deadMarks: '["12"]' } });
        const { store, dialogs } = ctx;
        ctx.def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-unmark-all' ? {} : null) });
        expect(JSON.parse(store.get('deadMarks'))).toEqual(['12']);
        expect(dialogs.ConfirmDialog.openCalls).toHaveLength(1);
    });
});

describe('batch deletion (delete all / delete selected)', () => {
    const CACHE = JSON.stringify({
        ts: 1700000000000, scannedCount: 3,
        results: {
            '11': { status: 'ok', code: 200 },
            '12': { status: 'dead', code: 404 },
            '13': { status: 'blocked', code: 404 }
        }
    });
    const clickDeleteAll = ctx =>
        ctx.clickOn({ closest: sel => (sel === '.dead-delete-all' ? {} : null) });
    const rowClick = (ctx, id) => ctx.clickOn({
        closest: sel => (sel === 'li' ? { dataset: { nodeId: id } } : null)
    });

    it('the delete-all button only renders with rows on screen', () => {
        const empty = setup({});
        empty.def().activate();
        expect(empty.$list.innerHTML).not.toContain('dead-delete-all'); // no cache yet
        // a cache whose only rows came back healthy → no button either
        const healthy = JSON.stringify({
            ts: 1, scannedCount: 1,
            results: { '11': { status: 'ok', code: 200 } }
        });
        const ctx = setup({ storeData: { deadLastScan: healthy } });
        ctx.def().activate();
        expect(ctx.$list.innerHTML).not.toContain('dead-delete-all');
    });

    it('delete-all gates behind a confirm carrying the running count', () => {
        const ctx = setup({ storeData: { deadLastScan: CACHE } });
        const { dialogs, chrome, undo } = ctx;
        ctx.def().activate();
        clickDeleteAll(ctx);
        expect(dialogs.ConfirmDialog.openCalls).toHaveLength(1);
        expect(dialogs.ConfirmDialog.openCalls[0].dialog).toBe('deadDeleteAll[2]<br>deadDeleteAllNote undoSingleStepNote');
        expect(dialogs.ConfirmDialog.openCalls[0].button1).toBe('<strong>delete</strong>');
        expect(chrome.bookmarks.removeCalls).toEqual([]); // gated until fn1
        expect(undo.captureCalls).toEqual([]);
    });

    it('confirming delete-all removes every filtered row serially, then toasts once', async () => {
        const ctx = setup({ storeData: { deadLastScan: CACHE } });
        const { dialogs, chrome, undo, treeView } = ctx;
        ctx.def().activate();
        clickDeleteAll(ctx);
        dialogs.ConfirmDialog.openCalls[0].fn1();
        await flush();
        // capture lands BEFORE each remove (chrome applies calls in issue
        // order, so the undo snapshot still sees the node); one deletion at
        // a time; a single toast reports the batch
        expect(undo.captureCalls).toEqual(['12', '13']);
        expect(chrome.bookmarks.removeCalls).toEqual(['12', '13']);
        expect(undo.toastCalls).toEqual(['deadDeleted[2]']);
        // the batch removal must rebuild the tree — it bypasses the tree's
        // (absent) onRemoved listener, so the rows would linger until the
        // popup reopens otherwise (the reported dupes bug's twin)
        expect(chrome.bookmarks.getTreeCalls).toBeGreaterThan(0);
        expect(treeView.generateTreeCalls).toBeGreaterThan(0);
    });

    it('delete-all hides when the active filter matches no rows (no inert danger button)', () => {
        // A cache with only a blocked row: under filter=dead the segment bar
        // stays (filter lock-up), but the destructive delete-all must not
        // render — a red button that clicks into nothing is a trap.
        const blockedOnly = JSON.stringify({
            ts: 1, scannedCount: 1,
            results: { '13': { status: 'blocked', code: 404 } }
        });
        const ctx = setup({ storeData: { deadLastScan: blockedOnly } });
        const { $list } = ctx;
        ctx.def().activate();
        expect($list.innerHTML).toContain('dead-delete-all'); // filter=all → shows
        ctx.clickOn({ closest: sel => (sel === '.dead-filter-btn' ? { dataset: { filter: 'dead' } } : null) });
        expect($list.innerHTML).not.toContain('dead-delete-all'); // dead filter → hides
        expect($list.innerHTML).toContain('deadFilterAll'); // segment still reachable
    });

    it('mark-all / select-mode hide with the empty filtered segment too (no inert buttons)', () => {
        // markAll() and the selection mode both act on the FILTERED
        // resultRows() — under a segment matching nothing they would click
        // into nothing, so they follow delete-all's visibility gate while
        // the filter segment itself stays reachable.
        const blockedOnly = JSON.stringify({
            ts: 1, scannedCount: 1,
            results: { '13': { status: 'blocked', code: 404 } }
        });
        const ctx = setup({ storeData: { deadLastScan: blockedOnly } });
        const { $list } = ctx;
        ctx.def().activate();
        expect($list.innerHTML).toContain('dead-mark-all'); // filter=all → shown
        expect($list.innerHTML).toContain('dead-select-mode');
        ctx.clickOn({ closest: sel => (sel === '.dead-filter-btn' ? { dataset: { filter: 'dead' } } : null) });
        expect($list.innerHTML).not.toContain('dead-mark-all');
        expect($list.innerHTML).not.toContain('dead-delete-all');
        expect($list.innerHTML).not.toContain('dead-select-mode');
        expect($list.innerHTML).toContain('deadFilterAll'); // the way back stays
        // …and switching back to all restores them
        ctx.clickOn({ closest: sel => (sel === '.dead-filter-btn' ? { dataset: { filter: 'all' } } : null) });
        expect($list.innerHTML).toContain('dead-mark-all');
        expect($list.innerHTML).toContain('dead-select-mode');
    });

    it('delete-all follows the active filter: 仅死链 deletes only the dead row', async () => {
        const ctx = setup({ storeData: { deadLastScan: CACHE } });
        const { dialogs, chrome } = ctx;
        ctx.def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-filter-btn' ? { dataset: { filter: 'dead' } } : null) });
        clickDeleteAll(ctx);
        expect(dialogs.ConfirmDialog.openCalls[0].dialog).toBe('deadDeleteAll[1]<br>deadDeleteAllNote undoSingleStepNote');
        dialogs.ConfirmDialog.openCalls[0].fn1();
        await flush();
        expect(chrome.bookmarks.removeCalls).toEqual(['12']); // blocked 13 stays
    });

    it('filter=all: the doomed set includes blocked rows but never ok/skipped ones', async () => {
        // X3 semantics: under All the batch covers blocked rows (the dialog's
        // note says so), while healthy/skipped verdicts stay out.
        const cache = JSON.stringify({
            ts: 1700000000000, scannedCount: 3,
            results: {
                '11': { status: 'skipped', code: 0 },
                '12': { status: 'dead', code: 404 },
                '13': { status: 'blocked', code: 404 }
            }
        });
        const ctx = setup({ storeData: { deadLastScan: cache } });
        const { dialogs, chrome, undo } = ctx;
        ctx.def().activate(); // default filter is all
        clickDeleteAll(ctx);
        expect(dialogs.ConfirmDialog.openCalls[0].dialog).toBe('deadDeleteAll[2]<br>deadDeleteAllNote undoSingleStepNote');
        dialogs.ConfirmDialog.openCalls[0].fn1();
        await flush();
        expect(chrome.bookmarks.removeCalls).toEqual(['12', '13']); // blocked included
        expect(chrome.bookmarks.removeCalls).not.toContain('11'); // skipped stays
        expect(undo.toastCalls).toEqual(['deadDeleted[2]']);
    });

    it('a removal failing mid-batch is skipped and the toast counts only real deletions', async () => {
        // X4: a doomed id vanishing mid-batch (sync / another page) sets
        // runtime.lastError in the remove callback — read it, skip the
        // count, and let the toast report the actual deletions.
        const ctx = setup({ storeData: { deadLastScan: CACHE } });
        const { dialogs, chrome, undo } = ctx;
        ctx.def().activate();
        const stub = chrome.bookmarks;
        const realRemove = stub.remove.bind(stub);
        stub.remove = (id, cb) => {
            if (id === '13') {
                stub.removeCalls.push(id); // attempted, but already gone
                chrome.runtime.lastError = { message: 'Bookmark id is invalid' };
                cb();
                chrome.runtime.lastError = undefined;
                return;
            }
            realRemove(id, cb);
        };
        clickDeleteAll(ctx);
        dialogs.ConfirmDialog.openCalls[0].fn1();
        await flush();
        expect(chrome.bookmarks.removeCalls).toEqual(['12', '13']); // both attempted in order
        expect(undo.toastCalls).toEqual(['deadDeleted[1]']); // only one really deleted
    });

    it('deleting rows drops them from the list through the onRemoved re-join', async () => {
        const ctx = setup({ storeData: { deadLastScan: CACHE, deadMarks: '["12","13"]' } });
        const { dialogs, chrome, $list, treeData, store } = ctx;
        ctx.def().activate();
        clickDeleteAll(ctx);
        dialogs.ConfirmDialog.openCalls[0].fn1();
        await flush();
        // backend truth after the deletion, then the onRemoved replay
        const bar = treeData[0].children[0];
        bar.children = bar.children.filter(n => n.id !== '12' && n.id !== '13');
        chrome.bookmarks.fire('onRemoved', '12');
        chrome.bookmarks.fire('onRemoved', '13');
        tick(300);
        expect($list.innerHTML).not.toContain('id="dead-item-12"');
        expect($list.innerHTML).not.toContain('id="dead-item-13"');
        expect($list.innerHTML).toContain('deadNone'); // no rows left
        // the deletions pruned their marks through the onRemoved listener
        expect(JSON.parse(store.get('deadMarks'))).toEqual([]);
    });

    it('selection mode: delete-selected disables on an empty selection', () => {
        const ctx = setup({ storeData: { deadLastScan: CACHE } });
        const { $list } = ctx;
        ctx.def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-select-mode' ? {} : null) });
        expect($list.innerHTML).toContain('class="dead-delete-selected" disabled');
    });

    it('delete-selected confirms, deletes the selected rows, toasts once and leaves the mode', async () => {
        const ctx = setup({ storeData: { deadLastScan: CACHE } });
        const { $list, dialogs, chrome, undo } = ctx;
        ctx.def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-select-mode' ? {} : null) });
        rowClick(ctx, '12');
        rowClick(ctx, '13');
        expect($list.innerHTML).not.toContain('class="dead-delete-selected" disabled');
        ctx.clickOn({ closest: sel => (sel === '.dead-delete-selected' ? {} : null) });
        expect(dialogs.ConfirmDialog.openCalls[0].dialog).toBe('deadConfirmDeleteSelected[2]<br>undoSingleStepNote');
        expect(chrome.bookmarks.removeCalls).toEqual([]); // gated until fn1
        dialogs.ConfirmDialog.openCalls[0].fn1();
        await flush();
        expect(undo.captureCalls).toEqual(['12', '13']);
        expect(chrome.bookmarks.removeCalls).toEqual(['12', '13']);
        expect(undo.toastCalls).toEqual(['deadDeleted[2]']);
        // the selected rows are gone — the mode exits AND the deleted rows
        // vanish immediately (pruned from treeItems, no 300ms stale window)
        expect($list.innerHTML).not.toContain('class="selecting"');
        expect($list.innerHTML).not.toContain('id="dead-item-12"');
        expect($list.innerHTML).not.toContain('id="dead-item-13"');
        expect($list.innerHTML).toContain('deadNone'); // immediate empty state
    });
});

describe('marks + overlay (§5.5c)', () => {
    it('toggleMark flips membership, persists and repaints the row button', () => {
        const cache = JSON.stringify({
            ts: 1, scannedCount: 1, results: { '12': { status: 'dead', code: 404 } }
        });
        const ctx = setup({ storeData: { deadLastScan: cache } });
        const { store, $list, viewDead, def, views } = ctx;
        def().activate();
        expect(viewDead.isMarked('12')).toBe(false);
        ctx.clickOn({
            closest: sel => (sel === '.dead-mark-btn'
                ? { closest: () => ({ dataset: { nodeId: '12' } }) }
                : null)
        });
        expect(JSON.parse(store.get('deadMarks'))).toEqual(['12']);
        expect($list.innerHTML).toContain('aria-label="deadUnmark"');
        expect(def().badge()).toBe(1);
        // every marks mutation keeps the tab badge in sync (item 3 fix)
        expect(views.badgeCalls).toBeGreaterThan(0);
        const bumps = views.badgeCalls;
        viewDead.toggleMark('12');
        expect(JSON.parse(store.get('deadMarks'))).toEqual([]);
        expect(views.badgeCalls).toBe(bumps + 1);
    });

    it('refreshOverlays adds and removes the × on every list, idempotently', () => {
        const liMarked = makeLi('neat-tree-item-12', '12');
        const liPlain = makeLi('neat-tree-item-11', '11');
        const liLegacy = makeLi('results-item-13', ''); // prefix-strip fallback
        const ctx = setup({ treeLis: [liMarked, liPlain], storeData: { deadMarks: '["12","13"]' } });
        ctx.$results._lis = [liLegacy];
        // 第五轮项3: dupes/stats lists joined the overlay set
        const liDupes = makeLi('dupes-item-12', '12');
        const liStats = makeLi('stats-item-13', '13');
        ctx.$dupes._lis = [liDupes];
        ctx.$stats._lis = [liStats];
        ctx.viewDead.refreshOverlays();
        expect(liMarked._fav.children.map(c => c.className)).toEqual(['dead-indicator']);
        expect(liPlain._fav.children).toEqual([]);
        expect(liLegacy._fav.children.map(c => c.className)).toEqual(['dead-indicator']);
        expect(liDupes._fav.children.map(c => c.className)).toEqual(['dead-indicator']);
        expect(liStats._fav.children.map(c => c.className)).toEqual(['dead-indicator']);
        // second run: no duplicates
        ctx.viewDead.refreshOverlays();
        expect(liMarked._fav.children).toHaveLength(1);
        // unmark → the span disappears again
        ctx.viewDead.toggleMark('12');
        expect(liMarked._fav.children).toEqual([]);
        expect(liDupes._fav.children).toEqual([]);
    });

    it('a healthy rescan prunes the mark automatically', () => {
        const ctx = setup({ storeData: { deadMarks: '["11","12"]' } });
        const { store, def } = ctx;
        def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-start' ? {} : null) });
        finishScan(ctx, { // the SW comes back with an all-healthy verdict
            '11': { status: 'ok', code: 200 },
            '12': { status: 'ok', code: 200 },
            '13': { status: 'ok', code: 200 }
        });
        expect(JSON.parse(store.get('deadMarks'))).toEqual([]);
        expect(def().badge()).toBe(0);
    });

    it('maps the showDeadView setting onto tab visibility', () => {
        expect(setup({}).def().hidden).toBe(false); // default: visible
        expect(setup({ storeData: { showDeadView: '' } }).def().hidden).toBe(true);
    });

    it('removing a bookmark prunes its mark', () => {
        const ctx = setup({ storeData: { deadMarks: '["12","13"]' } });
        const { chrome, store } = ctx;
        chrome.bookmarks.fire('onRemoved', '12');
        expect(JSON.parse(store.get('deadMarks'))).toEqual(['13']);
    });

    it('removing a bookmark prunes its scan verdict too — the badge stays in step with the rows', () => {
        // badge() derives from the tree-joined rows, so onRemoved drops the
        // cached verdict immediately (in-memory only — the persisted
        // deadLastScan is the SW's to rewrite on the next scan): neither the
        // row nor the badge outlives the bookmark until the debounced
        // re-join prunes treeItems.
        const cache = JSON.stringify({
            ts: 1700000000000, scannedCount: 3,
            results: {
                '11': { status: 'ok', code: 200 },
                '12': { status: 'dead', code: 404 },
                '13': { status: 'blocked', code: 404 }
            }
        });
        const ctx = setup({ storeData: { deadLastScan: cache } });
        const { chrome, def, store } = ctx;
        ctx.def().activate();
        expect(def().badge()).toBe(2); // 12 dead + 13 blocked
        chrome.bookmarks.fire('onRemoved', '12');
        expect(def().badge()).toBe(1);
        chrome.bookmarks.fire('onRemoved', '11'); // a healthy row: no-op
        expect(def().badge()).toBe(1);
        expect(store.get('deadLastScan')).toBe(cache); // storage untouched
    });

    it('a bookmark created mid-session re-joins the rows (onCreated listener)', () => {
        // The dupes view listens to all four bookmark events; the dead view
        // missed onCreated — a mid-session add (e.g. an undo restore) left
        // the rows' tree join stale until the popup reopened.
        const cache = JSON.stringify({
            ts: 1700000000000, scannedCount: 1,
            results: { '12': { status: 'dead', code: 404 } }
        });
        const ctx = setup({ storeData: { deadLastScan: cache } });
        const { chrome, $list } = ctx;
        ctx.def().activate();
        expect($list.innerHTML).toContain('id="dead-item-12"');
        // backend truth changes (the bookmark re-created with a new title);
        // the onCreated debounce re-joins treeItems and repaints
        ctx.treeData[0].children[0].children[1] =
            { id: '12', parentId: '1', title: 'Gone (restored)', url: 'https://gone.example/page', dateAdded: 500 };
        const getTreeCalls = chrome.bookmarks.getTreeCalls;
        chrome.bookmarks.fire('onCreated', { id: '12', title: 'Gone (restored)' });
        tick(300);
        expect(chrome.bookmarks.getTreeCalls).toBeGreaterThan(getTreeCalls);
        expect($list.innerHTML).toContain('Gone (restored)');
    });
});

describe('row interactions (§3.5)', () => {
    const CACHE = JSON.stringify({
        ts: 1700000000000, scannedCount: 1,
        results: { '12': { status: 'dead', code: 404 } }
    });

    it('the delete button rides actions.deleteBookmark (the undo chain)', () => {
        const ctx = setup({ storeData: { deadLastScan: CACHE } });
        const { actions } = ctx;
        ctx.def().activate();
        ctx.clickOn({
            closest: sel => (sel === '.dead-del-btn'
                ? { closest: () => ({ dataset: { nodeId: '12' } }) }
                : null)
        });
        expect(actions.deleteCalls).toEqual(['12']);
    });

    it('plain row clicks fall through to treeView.bookmarkHandler', () => {
        const ctx = setup({ storeData: { deadLastScan: CACHE } });
        const { treeView } = ctx;
        ctx.def().activate();
        ctx.clickOn({ closest: () => null });
        expect(treeView.handlerCalls).toBe(1);
    });

    it('M toggles the focused row mark; R reveals it in the tree', () => {
        const ctx = setup({ storeData: { deadLastScan: CACHE } });
        const { def, doc, treeView, store } = ctx;
        def().activate();
        doc.activeElement = {
            closest: sel => (sel === '[data-node-id]' ? { dataset: { nodeId: '12' } } : null)
        };
        let prevented = 0;
        expect(def().onKey({ key: 'm', preventDefault: () => prevented++ })).toBe(true);
        expect(prevented).toBe(1);
        expect(JSON.parse(store.get('deadMarks'))).toEqual(['12']);
        expect(def().onKey({ key: 'M', preventDefault: () => {} })).toBe(true);
        expect(JSON.parse(store.get('deadMarks'))).toEqual([]);
        expect(def().onKey({ key: 'r', preventDefault: () => {} })).toBe(true);
        expect(treeView.revealCalls).toEqual(['12']);
        expect(def().onKey({ key: 'x', preventDefault: () => {} })).toBe(false);
        doc.activeElement = null;
        expect(def().onKey({ key: 'm', preventDefault: () => {} })).toBe(false);
    });

    it('rescan sends a fresh start message from the info row', () => {
        const ctx = setup({ storeData: { deadLastScan: CACHE } });
        const { chrome } = ctx;
        ctx.def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-rescan' ? {} : null) });
        expect(chrome.runtime.sent).toEqual([{ type: 'vbm-dead-scan-start' }]);
    });
});

describe('selection mode (v4 task-3 #4)', () => {
    const CACHE = JSON.stringify({
        ts: 1700000000000, scannedCount: 3,
        results: {
            '11': { status: 'ok', code: 200 },
            '12': { status: 'dead', code: 404 },
            '13': { status: 'blocked', code: 404 }
        }
    });
    // the selection-mode row click: target.closest('li') hands back the row
    const rowClick = (ctx, id) => ctx.clickOn({
        closest: sel => (sel === 'li' ? { dataset: { nodeId: id } } : null)
    });

    it('the select button only shows with results and swaps the toolbar for the batch bar', () => {
        const empty = setup({});
        empty.def().activate();
        expect(empty.$list.innerHTML).not.toContain('dead-select-mode');
        const ctx = setup({ storeData: { deadLastScan: CACHE } });
        const { $list } = ctx;
        ctx.def().activate();
        expect($list.innerHTML).toContain('dead-select-mode');
        ctx.clickOn({ closest: sel => (sel === '.dead-select-mode' ? {} : null) });
        expect($list.innerHTML).toContain('selectCount[0]');
        expect($list.innerHTML).toContain('dead-mark-selected');
        expect($list.innerHTML).toContain('dead-unmark-selected');
        // the idle controls are gone while the mode is on
        expect($list.innerHTML).not.toContain('dead-filter-btn');
        expect($list.innerHTML).not.toContain('dead-rescan');
        // the ul carries the mode class (CSS draws the checkboxes)
        expect($list.innerHTML).toContain('<ul role="list" class="selecting">');
        // empty selection → both batch buttons disabled
        expect($list.innerHTML).toContain('class="dead-mark-selected" disabled');
    });

    it('row clicks toggle membership instead of opening the bookmark', () => {
        const ctx = setup({ storeData: { deadLastScan: CACHE } });
        const { $list, treeView } = ctx;
        ctx.def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-select-mode' ? {} : null) });
        const handlerCalls = treeView.handlerCalls;
        rowClick(ctx, '12');
        expect($list.innerHTML).toContain('class="vbm-row sel" id="dead-item-12"');
        expect($list.innerHTML).toContain('selectCount[1]');
        expect($list.innerHTML).not.toContain('class="dead-mark-selected" disabled');
        rowClick(ctx, '12'); // toggle off
        expect($list.innerHTML).toContain('selectCount[0]');
        expect($list.innerHTML).not.toContain('class="vbm-row sel" id="dead-item-12"');
        expect(treeView.handlerCalls).toBe(handlerCalls); // nothing opened
    });

    it('Space on a row toggles membership instead of paging (v4 task-4 #8)', () => {
        const ctx = setup({ storeData: { deadLastScan: CACHE } });
        const { $list, fire, treeView } = ctx;
        ctx.def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-select-mode' ? {} : null) });
        const target = {
            classList: { contains: () => false },
            closest: sel => (sel === 'li.vbm-row' ? { dataset: { nodeId: '12' } } : null)
        };
        const keyEv = key => ({
            key, target,
            preventDefault() { this.prevented = true; },
            stopPropagation() { this.stopped = true; }
        });
        const handlerCalls = treeView.handlerCalls;
        const ev = keyEv(' ');
        fire('keydown', ev);
        expect(ev.stopped).toBe(true); // keyboard.js never turns it into a click
        expect($list.innerHTML).toContain('class="vbm-row sel" id="dead-item-12"');
        expect($list.innerHTML).toContain('selectCount[1]');
        fire('keydown', keyEv(' ')); // toggle off
        expect($list.innerHTML).toContain('selectCount[0]');
        expect(treeView.handlerCalls).toBe(handlerCalls); // nothing opened
    });

    it('all / invert / clear operate on the filtered rows', () => {
        const ctx = setup({ storeData: { deadLastScan: CACHE } });
        const { $list } = ctx;
        ctx.def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-select-mode' ? {} : null) });
        ctx.clickOn({ closest: sel => (sel === '.dead-select-all' ? {} : null) });
        expect($list.innerHTML).toContain('selectCount[2]'); // 12 + 13
        ctx.clickOn({ closest: sel => (sel === '.dead-select-invert' ? {} : null) });
        expect($list.innerHTML).toContain('selectCount[0]');
        ctx.clickOn({ closest: sel => (sel === '.dead-select-invert' ? {} : null) });
        expect($list.innerHTML).toContain('selectCount[2]');
        rowClick(ctx, '12');
        ctx.clickOn({ closest: sel => (sel === '.dead-select-clear' ? {} : null) });
        expect($list.innerHTML).toContain('selectCount[0]');
    });

    it('mark-selected / unmark-selected batch the marks without a confirm dialog', () => {
        const ctx = setup({ storeData: { deadLastScan: CACHE } });
        const { store, dialogs, undo, viewDead } = ctx;
        ctx.def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-select-mode' ? {} : null) });
        rowClick(ctx, '12');
        ctx.clickOn({ closest: sel => (sel === '.dead-mark-selected' ? {} : null) });
        expect(dialogs.ConfirmDialog.openCalls).toEqual([]); // selection is the confirmation
        expect(JSON.parse(store.get('deadMarks'))).toEqual(['12']);
        expect(viewDead.isMarked('13')).toBe(false);
        expect(undo.toastCalls).toEqual(['deadMarked']);
        ctx.clickOn({ closest: sel => (sel === '.dead-unmark-selected' ? {} : null) });
        expect(JSON.parse(store.get('deadMarks'))).toEqual([]);
    });

    it('Esc exits the mode (selection cleared, idle toolbar back)', () => {
        const ctx = setup({ storeData: { deadLastScan: CACHE } });
        const { $list } = ctx;
        ctx.def().activate();
        expect(ctx.def().onEscape()).toBe(false); // no scan, no selection: falls through
        ctx.clickOn({ closest: sel => (sel === '.dead-select-mode' ? {} : null) });
        rowClick(ctx, '12');
        expect(ctx.def().onEscape()).toBe(true);
        expect($list.innerHTML).toContain('dead-select-mode'); // idle toolbar restored
        expect($list.innerHTML).not.toContain('class="selecting"');
        // the exit cleared the membership: re-entering starts at zero
        ctx.clickOn({ closest: sel => (sel === '.dead-select-mode' ? {} : null) });
        expect($list.innerHTML).toContain('selectCount[0]');
    });

    it('the exit button leaves the mode like Esc does', () => {
        const ctx = setup({ storeData: { deadLastScan: CACHE } });
        const { $list } = ctx;
        ctx.def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-select-mode' ? {} : null) });
        rowClick(ctx, '13');
        ctx.clickOn({ closest: sel => (sel === '.dead-select-exit' ? {} : null) });
        expect($list.innerHTML).toContain('dead-select-mode');
        expect($list.innerHTML).not.toContain('class="selecting"');
    });

    it('members whose rows vanish are pruned at render', () => {
        const ctx = setup({ storeData: { deadLastScan: CACHE } });
        const { $list, treeData } = ctx;
        ctx.def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-select-mode' ? {} : null) });
        ctx.clickOn({ closest: sel => (sel === '.dead-select-all' ? {} : null) });
        expect($list.innerHTML).toContain('selectCount[2]');
        // bookmark 12 gets removed: the onRemoved → 300ms debounce re-joins
        treeData[0].children[0].children =
            treeData[0].children[0].children.filter(n => n.id !== '12');
        ctx.chrome.bookmarks.fire('onRemoved', '12');
        tick(300);
        expect($list.innerHTML).toContain('selectCount[1]');
        expect($list.innerHTML).toContain('id="dead-item-13"');
    });

    it('the CSS contract: selecting rows get checkboxes, action buttons hide', () => {
        const neatCss = fs.readFileSync(new URL('../css/neat.css', import.meta.url), 'utf8');
        expect(neatCss).toContain('#dead-list ul.selecting li.vbm-row::before');
        expect(neatCss).toContain('#dead-list ul.selecting li.vbm-row.sel::before');
        expect(neatCss).toContain('#dead-list ul.selecting .row-btn');
        expect(neatCss).toContain('#dead-list ul.selecting li.vbm-row.sel,');
    });
});

// Final polish (keyboard-model §2.5): the view no longer walks the filter
// seg locally — ←/→ on toolbar controls are walked by keyboard.js's non-row
// branch across the whole toolbar rung (a view-local handler would
// double-step). The list's remaining keydown listener (the dead-start
// Enter/Space runner) leaves arrows unconsumed.
describe('filter seg arrow keys (§2.5 — owned by the toolbar rung)', () => {
    it('the view consumes no ←/→/↑/↓ on filter buttons', () => {
        const { fire } = setup({});
        const btn = { classList: { contains: c => c === 'dead-filter-btn' } };
        for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp']) {
            const ev = {
                key,
                target: btn,
                prevented: 0,
                preventDefault() { this.prevented++; }
            };
            fire('keydown', ev);
            expect(ev.prevented).toBe(0);
        }
    });
});

// --- dead-proxy.js integration ----------------------------------------------
// The proxy strip/panel and the proxy-gated scan. The view reads chrome.* at
// call time, so the permission/proxy/storage doubles are patched onto the
// setup's chrome stub per case; the i18n double renders _m('key', subs) as
// 'key[sub1|sub2]', which the assertions lean on.
const addProxyChrome = (ctx, opts = {}) => {
    const calls = [];
    const c = ctx.chrome;
    c.runtime = {};
    c.permissions = {
        contains(perms, cb) { calls.push(['contains', perms]); cb('contains' in opts ? opts.contains : true); },
        request(perms, cb) { calls.push(['request', perms]); cb('request' in opts ? opts.request : true); }
    };
    c.proxy = {
        settings: {
            get(details, cb) {
                calls.push(['get']);
                cb({ levelOfControl: opts.levelOfControl || 'controllable_by_this_extension' });
            },
            set(details, cb) { calls.push(['set', details]); cb(); },
            clear(details, cb) { calls.push(['clear']); cb(); }
        }
    };
    const sessionData = {};
    c.storage = {
        session: {
            set(obj) { Object.assign(sessionData, obj); calls.push(['sessionSet']); },
            remove(key) { delete sessionData[key]; calls.push(['sessionRemove']); },
            data: sessionData
        }
    };
    return calls;
};

const typeProxyAddr = (ctx, value) => ctx.fire('input', {
    target: { classList: { contains: c => c === 'dead-proxy-input' }, value }
});

describe('proxy strip + add panel (dead-proxy.js)', () => {
    it('no proxy: add button renders; a finished scan with dead rows shows nudge + summary', () => {
        const cache = JSON.stringify({
            ts: 1700000000000, scannedCount: 3,
            results: {
                '11': { status: 'ok', code: 200 },
                '12': { status: 'dead', code: 404 },
                '13': { status: 'blocked', code: 404 }
            }
        });
        const { $list, def } = setup({ storeData: { deadLastScan: cache } });
        def().activate();
        const html = $list.innerHTML;
        expect(html).toContain('dead-proxy-add');
        // the nudge no longer takes the dead-row count — one direct-dead row
        // still gates its visibility
        expect(html).toContain('class="dead-proxy-nudge">deadProxyNudge</span>');
        expect(html).not.toContain('deadProxyNudge[');
        // strip order (4.0.1): add button → dismiss × → nudge LAST (the CSS
        // flex-basis:100% wraps the nudge onto its own second row while
        // margin-inline-start:auto pins the × to the first row's right end)
        const at = s => html.indexOf(s);
        expect(at('class="dead-proxy-add"')).toBeLessThan(at('class="dead-proxy-hide"'));
        expect(at('class="dead-proxy-hide"')).toBeLessThan(at('class="dead-proxy-nudge"'));
        // the summary merged into the filter segments' counts (1 dead · 1 blocked)
        expect(html).toContain('deadFilterDead 1');
        expect(html).toContain('deadFilterBlocked 1');
        expect(html).not.toContain('dead-summary');
    });

    it('no server: the add strip carries a small dismiss ×; clicking it hides the strip', () => {
        const ctx = setup({});
        ctx.def().activate();
        expect(ctx.$list.innerHTML).toContain('dead-proxy-hide');
        ctx.clickOn({ closest: sel => (sel === '.dead-proxy-hide' ? {} : null) });
        expect(ctx.store.get('hideDeadProxyStrip')).toBe('1');
        expect(ctx.$list.innerHTML).not.toContain('dead-proxy-strip');
    });

    it('a hidden no-server strip stays hidden, but a saved server keeps its manage row', () => {
        // hidden + no server → the whole strip is gone (options has the entry)
        const hidden = setup({ storeData: { hideDeadProxyStrip: '1' } });
        hidden.def().activate();
        expect(hidden.$list.innerHTML).not.toContain('dead-proxy-strip');
        // hidden + a saved server → the manage row still shows (never dismissable)
        const withServer = setup({
            storeData: { hideDeadProxyStrip: '1', deadProxyServer: 'http://127.0.0.1:7890' }
        });
        withServer.def().activate();
        const html = withServer.$list.innerHTML;
        expect(html).toContain('dead-proxy-strip');
        expect(html).toContain('dead-proxy-change');
        expect(html).toContain('dead-proxy-remove');
        expect(html).not.toContain('dead-proxy-hide');
    });

    it('a configured server renders the chip with change/remove buttons', () => {
        const { $list, def } = setup({ storeData: { deadProxyServer: 'http://127.0.0.1:7890' } });
        def().activate();
        const html = $list.innerHTML;
        expect(html).toContain('deadProxyLabel[http://127.0.0.1:7890]');
        expect(html).toContain('dead-proxy-change');
        expect(html).toContain('dead-proxy-remove');
        expect(html).not.toContain('dead-proxy-add');
    });

    it('add flow: grant + reachable → the normalized server is saved and toasted', async () => {
        const ctx = setup({});
        const calls = addProxyChrome(ctx);
        const seen = [];
        globalThis.fetch = url => { seen.push(url); return Promise.resolve({ status: 204 }); };
        const { $list, def, store, undo } = ctx;
        def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-proxy-add' ? {} : null) });
        expect($list.innerHTML).toContain('dead-proxy-input');
        typeProxyAddr(ctx, '127.0.0.1:7890');
        ctx.clickOn({ closest: sel => (sel === '.dead-proxy-save' ? {} : null) });
        await flush();
        await flush();
        expect(store.get('deadProxyServer')).toBe('http://127.0.0.1:7890');
        expect(undo.toastCalls).toContain('deadProxySaved');
        expect(seen).toEqual(['https://www.gstatic.com/generate_204?__vbm_px=1']);
        // permission already held (required install-time permission):
        // contains verifies it, request never fires; the PAC write carried
        // the proxy
        expect(calls).toContainEqual(['contains', { permissions: ['proxy'] }]);
        expect(calls.filter(c => c[0] === 'request')).toEqual([]);
        expect(calls.find(c => c[0] === 'set')[1].value.pacScript.data)
            .toContain('"PROXY 127.0.0.1:7890"');
        expect(calls.map(c => c[0])).toContain('clear'); // test session torn down
        expect($list.innerHTML).toContain('deadProxyLabel[http://127.0.0.1:7890]');
    });

    it('invalid input stops before any permission ask', async () => {
        const ctx = setup({});
        const calls = addProxyChrome(ctx);
        const { $list, def, store } = ctx;
        def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-proxy-add' ? {} : null) });
        typeProxyAddr(ctx, 'nope');
        ctx.clickOn({ closest: sel => (sel === '.dead-proxy-save' ? {} : null) });
        await flush();
        expect($list.innerHTML).toContain('deadProxyInvalid');
        expect(calls.filter(c => c[0] === 'request')).toEqual([]);
        expect(store.get('deadProxyServer', '')).toBe('');
    });

    it('a missing permission falls back to request; a denial is an error, nothing saved', async () => {
        const ctx = setup({});
        const calls = addProxyChrome(ctx, { contains: false, request: false });
        const { $list, def, store } = ctx;
        def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-proxy-add' ? {} : null) });
        typeProxyAddr(ctx, '127.0.0.1:7890');
        ctx.clickOn({ closest: sel => (sel === '.dead-proxy-save' ? {} : null) });
        await flush();
        await flush();
        expect(calls).toContainEqual(['request', { permissions: ['proxy'] }]);
        expect($list.innerHTML).toContain('deadProxyDenied');
        expect(store.get('deadProxyServer', '')).toBe('');
    });

    it('an unreachable proxy is rejected, nothing saved', async () => {
        const ctx = setup({});
        addProxyChrome(ctx);
        globalThis.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
        const { $list, def, store } = ctx;
        def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-proxy-add' ? {} : null) });
        typeProxyAddr(ctx, '127.0.0.1:7890');
        ctx.clickOn({ closest: sel => (sel === '.dead-proxy-save' ? {} : null) });
        await flush();
        await flush();
        expect($list.innerHTML).toContain('deadProxyUnreachable');
        expect(store.get('deadProxyServer', '')).toBe('');
    });

    it('proxy settings owned by another extension are rejected', async () => {
        const ctx = setup({});
        addProxyChrome(ctx, { levelOfControl: 'controlled_by_other_extensions' });
        const { $list, def, store } = ctx;
        def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-proxy-add' ? {} : null) });
        typeProxyAddr(ctx, '127.0.0.1:7890');
        ctx.clickOn({ closest: sel => (sel === '.dead-proxy-save' ? {} : null) });
        await flush();
        await flush();
        expect($list.innerHTML).toContain('deadProxyControlled');
        expect(store.get('deadProxyServer', '')).toBe('');
    });

    it('remove clears the saved server with a toast', () => {
        const ctx = setup({ storeData: { deadProxyServer: 'http://127.0.0.1:7890' } });
        const { $list, def, store, undo } = ctx;
        def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-proxy-remove' ? {} : null) });
        expect(store.get('deadProxyServer', '')).toBe('');
        expect(undo.toastCalls).toContain('deadProxyRemoved');
        expect($list.innerHTML).toContain('dead-proxy-add');
    });

    it('Esc closes the panel before any scan/selection layer', () => {
        const ctx = setup({});
        const { $list, def } = ctx;
        def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-proxy-add' ? {} : null) });
        expect($list.innerHTML).toContain('dead-proxy-input');
        expect(def().onEscape()).toBe(true);
        expect($list.innerHTML).not.toContain('dead-proxy-input');
    });
});

describe('proxy-gated scan (v4 task-4 #16: the SW owns the PAC)', () => {
    // The PAC install/teardown and the permission/controllability gate moved
    // to the service worker with the scan engine (covered by
    // dead-scan-sw.test.js). What stays here is the view's mirror of the
    // gate outcome: the blob's proxy.gate surfaces on the proxy chip.
    it("a blob's proxy.gate renders on the chip as the gate error", () => {
        const ctx = setup({ storeData: { deadProxyServer: 'http://127.0.0.1:7890' } });
        const { $list } = ctx;
        ctx.def().activate();
        publishBlob(ctx, blobOf({ proxy: { active: false, gate: 'deadProxyDenied' } }));
        expect($list.innerHTML).toContain('deadProxyDenied');
        // …and a later blob without a gate clears it again
        publishBlob(ctx, blobOf({ done: 1 }));
        expect($list.innerHTML).not.toContain('deadProxyDenied');
    });

    it('the strip controls disable while a run lives', () => {
        const ctx = setup({ storeData: { deadProxyServer: 'http://127.0.0.1:7890' } });
        const { $list } = ctx;
        ctx.def().activate();
        expect($list.innerHTML).toContain('dead-proxy-change');
        expect($list.innerHTML).not.toContain('dead-proxy-change" disabled');
        publishBlob(ctx, blobOf({ done: 1 }));
        expect($list.innerHTML).toContain('dead-proxy-change" disabled');
        expect($list.innerHTML).toContain('dead-proxy-remove" disabled');
    });
});

describe('risk banner (v4 task-4 #14)', () => {
    it('shows until acked; ack records the current version', () => {
        const ctx = setup({});
        const { $list, store } = ctx;
        ctx.def().activate();
        expect($list.innerHTML).toContain('class="risk-banner"');
        expect($list.innerHTML).toContain('deadRiskBanner');
        expect($list.innerHTML).toContain('risk-banner-help');
        ctx.chrome.runtime = { getManifest: () => ({ version: '4.2.0' }) };
        ctx.clickOn({ closest: sel => (sel === '.risk-banner-never' ? {} : null) });
        expect(store.get('deadRiskAck')).toBe('4.2.0');
        expect($list.innerHTML).not.toContain('class="risk-banner"');
    });

    it('the × dismisses for the session without writing storage', () => {
        const ctx = setup({});
        const { $list, store } = ctx;
        ctx.def().activate();
        ctx.clickOn({ closest: sel => (sel === '.risk-banner-dismiss' ? {} : null) });
        expect($list.innerHTML).not.toContain('class="risk-banner"');
        expect(store.get('deadRiskAck')).toBeUndefined();
    });

    it('the help link rides actions.openBookmarkNewTab (popup-respecting open)', () => {
        const ctx = setup({});
        const opened = [];
        ctx.actions.openBookmarkNewTab = (url, active, closePopup) => opened.push([url, active, closePopup]);
        ctx.def().activate();
        ctx.clickOn({ closest: sel => (sel === '.risk-banner-help' ? {} : null) });
        expect(opened).toEqual([['https://support.google.com/chrome/answer/96816', true, true]]);
    });
});

describe('row focus park/restore (4.0.1 focus law)', () => {
    // The list-row twin of the toolbar park/restore: every render's
    // innerHTML swap replaces the focused row (filter clicks, mark toggles,
    // scan ticks) and the ↓ walk used to die on <body>. The doubles model
    // the swap the way the real DOM behaves: assigning innerHTML replaces
    // the li set querySelectorAll('li') hands out ($list._lis), and the
    // hand-written focus() lands on doc.activeElement.
    const CACHE = JSON.stringify({
        ts: 1700000000000, scannedCount: 3,
        results: {
            '11': { status: 'ok', code: 200 },
            '12': { status: 'dead', code: 404 },
            '13': { status: 'blocked', code: 404 }
        }
    });
    const wireSwap = ($list, doc) => {
        const swap = { next: null };
        let html = $list.innerHTML;
        Object.defineProperty($list, 'innerHTML', {
            get() { return html; },
            set(v) {
                html = v;
                this.scrollTop = 0; // keep the harness's #17 reset model
                if (swap.next) {
                    $list._lis = swap.next;
                    swap.next = null;
                }
            }
        });
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

    it('a focused result row regains focus on its same-id replacement after a re-render', () => {
        const ctx = setup({ storeData: { deadLastScan: CACHE } });
        const { $list, doc, def, viewDead } = ctx;
        def().activate();
        const swap = wireSwap($list, doc);
        const ul = ulOf($list);
        const oldRow = row(doc, ul, 'dead-item-12');
        $list._lis = [oldRow.li];
        doc.activeElement = oldRow.a;
        // the post-swap replacement row: same id, new element
        const newRow = row(doc, ul, 'dead-item-12');
        swap.next = [newRow.li];
        const origGet = doc.getElementById;
        doc.getElementById = id => (id === 'dead-item-12' ? newRow.li : origGet(id));
        viewDead.refresh(); // the mark toggle / filter click repaint
        expect(doc.activeElement).toBe(newRow.a);
    });

    it('a vanished row id falls back to the index-clamped row', () => {
        const ctx = setup({ storeData: { deadLastScan: CACHE } });
        const { $list, doc, def, viewDead } = ctx;
        def().activate();
        const swap = wireSwap($list, doc);
        const ul = ulOf($list);
        const r1 = row(doc, ul, 'dead-item-12');
        const r2 = row(doc, ul, 'dead-item-13');
        const r3 = row(doc, ul, 'dead-item-14');
        $list._lis = [r1.li, r2.li, r3.li]; // focus sits on the third row
        doc.activeElement = r3.a;
        // row 14 is gone after the repaint — no getElementById hit — and the
        // list shrank to two rows
        const n1 = row(doc, ul, 'dead-item-12');
        const n2 = row(doc, ul, 'dead-item-13');
        swap.next = [n1.li, n2.li];
        viewDead.refresh();
        expect(doc.activeElement).toBe(n2.a); // min(2, 1) → the second row
    });

    it('with no rows at all after the swap, focus parks on the list container', () => {
        const ctx = setup({ storeData: { deadLastScan: CACHE } });
        const { $list, doc, def, viewDead } = ctx;
        def().activate();
        const swap = wireSwap($list, doc);
        const ul = ulOf($list);
        const oldRow = row(doc, ul, 'dead-item-12');
        $list._lis = [oldRow.li];
        doc.activeElement = oldRow.a;
        swap.next = []; // nothing left to focus
        viewDead.refresh();
        expect(doc.activeElement).toBe($list);
    });

    it('focus outside the list (a proxy-panel input) is left untouched by the render', () => {
        const ctx = setup({ storeData: { deadLastScan: CACHE } });
        const { doc, def, viewDead } = ctx;
        def().activate();
        const outside = { tagName: 'INPUT' }; // no LI anywhere up the chain
        doc.activeElement = outside;
        viewDead.refresh();
        expect(doc.activeElement).toBe(outside);
    });
});
