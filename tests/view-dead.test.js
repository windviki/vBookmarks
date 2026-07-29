import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';

// view-dead.js touches page globals (document/window/chrome/fetch/setTimeout)
// only inside initViewDead and its handlers, so the real module imports
// cleanly in node once the globals are stubbed. store/views/treeRender/
// separatorManager/treeView/actions/dialogs/undo are injected recording
// doubles; the registered ViewDef is captured and driven by hand
// (activate/onKey/onEscape/badge). globalThis.fetch is doubled per case for
// the scan flow (the dual-channel checker included); setTimeout is a
// record-only stub advanced by hand (tick) for the 300ms repaint debounce;
// the scan's promise chain flushes through the saved real setTimeout.
// All assertions go through the doubles' records and the list's innerHTML —
// nothing is copied from the module body.

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

const PROXY = 'https://relay.example/fetch?target={url}';

// fetch double: fine → 200; gone → 404 everywhere; blocked → 404 direct but
// 200 through the relay; separators must never appear.
const dualFetch = () => {
    const calls = [];
    globalThis.fetch = (url, opts) => {
        calls.push(url);
        if (url.startsWith('https://relay.example/'))
            return Promise.resolve({ status: 200 });
        if (url.includes('fine'))
            return Promise.resolve({ status: 200 });
        return Promise.resolve({ status: 404 });
    };
    return calls;
};

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
            innerHTML: '',
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
        bookmarks: {
            getTreeCalls: 0,
            getTree(cb) {
                this.getTreeCalls++;
                cb(treeData);
            },
            onRemoved: { addListener(fn) { (this.fns = this.fns || []).push(fn); } },
            onChanged: { addListener(fn) { (this.fns = this.fns || []).push(fn); } },
            onMoved: { addListener(fn) { (this.fns = this.fns || []).push(fn); } },
            fire(name, ...args) {
                (this[name].fns || []).forEach(fn => fn(...args));
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
        bookmarkHandler: () => { treeView.handlerCalls++; }
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
        toastCalls: [],
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
        expect(typeof def().onKey).toBe('function');
    });

    it('badge() tracks the persisted deadMarks size', () => {
        const { def } = setup({ storeData: { deadMarks: '["11","12"]' } });
        expect(def().badge()).toBe(2);
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

    it('the start row runs the scan on click and on Enter', async () => {
        dualFetch();
        const ctx = setup({});
        ctx.def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-start' ? {} : null) });
        await flush();
        expect(ctx.store.get('deadLastScan')).toBeTruthy();
        // Enter path on a fresh view
        globalThis.fetch = () => Promise.resolve({ status: 200 });
        const ctx2 = setup({});
        ctx2.def().activate();
        ctx2.fire('keydown', {
            key: 'Enter',
            target: { classList: { contains: c => c === 'dead-start' } },
            preventDefault() {}, stopPropagation() {}
        });
        await flush();
        expect(JSON.parse(ctx2.store.get('deadLastScan')).scannedCount).toBe(3);
    });

    it('a cached scan renders the info row and skips auto-scanning', () => {
        const cache = JSON.stringify({
            ts: 1700000000000, scannedCount: 3,
            results: { '12': { status: 'dead', code: 404 } }
        });
        const calls = [];
        globalThis.fetch = url => { calls.push(url); return Promise.resolve({ status: 200 }); };
        const { $list, treeRender, def } = setup({ storeData: { deadLastScan: cache } });
        def().activate();
        expect(calls).toEqual([]); // no rescan on entry
        const html = $list.innerHTML;
        expect(html).toContain(`deadLastScanAt[${new Date(1700000000000).toLocaleString()}]`);
        expect(html).toContain('deadRescan');
        expect(html).toContain('id="dead-item-12"');
        // the badge rides the meta slot (the treeRender double renders no pills)
        expect(treeRender.calls.find(c => c.id === '12').meta.badge)
            .toEqual({ text: '404', cls: 'dead' });
    });
});

describe('scan flow (§5.5b/§5.5d)', () => {
    it('scans with the dual checker, persists the cache and renders badged rows', async () => {
        const calls = dualFetch();
        const ctx = setup({ storeData: { deadProxyTemplate: PROXY } });
        const { $list, store, treeRender, def } = ctx;
        def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-start' ? {} : null) });
        await flush();
        // the separator never went near fetch; the relay saw only the failures
        expect(calls.filter(u => u.includes('separatethis'))).toEqual([]);
        expect(calls).toContain('https://relay.example/fetch?target=' +
            encodeURIComponent('https://gone.example/page'));
        const cache = JSON.parse(store.get('deadLastScan'));
        expect(cache.scannedCount).toBe(3);
        expect(cache.results['11'].status).toBe('ok');
        // the relay answers 200 for everything here, so both failures read
        // blocked (dual-channel: direct fail + proxy ok)
        expect(cache.results['12'].status).toBe('blocked');
        expect(cache.results['13'].status).toBe('blocked');
        const html = $list.innerHTML;
        expect(html).toContain('id="dead-item-12"');
        expect(html).toContain('id="dead-item-13"');
        expect(html).not.toContain('id="dead-item-11"'); // healthy rows stay out
        expect(treeRender.calls.find(c => c.id === '13').meta.badge)
            .toEqual({ text: 'deadStatusBlocked', cls: 'blocked' });
    });

    it('gone.example fails on both channels and renders the dead badge', async () => {
        // direct fails everywhere; the relay reaches everything but gone
        globalThis.fetch = url => {
            if (url.includes('fine'))
                return Promise.resolve({ status: 200 });
            if (url.startsWith('https://relay.example/'))
                return Promise.resolve({ status: url.includes('gone') ? 404 : 200 });
            return Promise.resolve({ status: 404 });
        };
        const ctx = setup({ storeData: { deadProxyTemplate: PROXY } });
        const { treeRender } = ctx;
        ctx.def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-start' ? {} : null) });
        await flush();
        expect(treeRender.calls.find(c => c.id === '12').meta.badge)
            .toEqual({ text: '404', cls: 'dead' }); // both channels agree: dead
        expect(treeRender.calls.find(c => c.id === '13').meta.badge)
            .toEqual({ text: 'deadStatusBlocked', cls: 'blocked' });
    });

    it('shows the progress line while scanning and never aborts on view switch', async () => {
        const gates = {};
        globalThis.fetch = url => new Promise(resolve => { gates[url] = resolve; });
        const ctx = setup({});
        const { $list, views, def } = ctx;
        def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-start' ? {} : null) });
        expect($list.innerHTML).toContain('deadChecking[0|3]');
        expect($list.innerHTML).toContain('<progress');
        // switch away mid-scan: no abort, the closure keeps the progress
        views.active = false;
        gates['https://fine.example/']({ status: 200 });
        await flush();
        views.active = true;
        def().activate(); // back again: progress row, not the start hint
        expect($list.innerHTML).toContain('deadChecking');
        gates['https://gone.example/page']({ status: 404 });
        gates['https://blocked.example/']({ status: 404 });
        await flush();
        expect($list.innerHTML).toContain('id="dead-item-12"');
    });

    it('Escape toggles pause ⇄ resume (consumed both ways); pagehide cancels', async () => {
        const signals = [];
        globalThis.fetch = (url, opts) => {
            signals.push(opts.signal);
            return new Promise(() => {});
        };
        const ctx = setup({});
        const { def, winListeners, $list } = ctx;
        def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-start' ? {} : null) });
        expect(def().onEscape()).toBe(true); // first Esc: pause (consumed)
        expect(signals.every(s => s.aborted)).toBe(false); // pause keeps in-flight probes
        expect($list.innerHTML).toContain('deadResume');
        expect(def().onEscape()).toBe(true); // second Esc: resume (consumed)
        expect($list.innerHTML).toContain('deadPause');
        // the explicit Cancel is what aborts; then Esc falls through again
        ctx.clickOn({ closest: sel => (sel === '.dead-cancel' ? {} : null) });
        expect(signals.every(s => s.aborted)).toBe(true);
        expect(def().onEscape()).toBe(false);
        // pagehide path
        globalThis.fetch = (url, opts) => {
            signals.push(opts.signal);
            return new Promise(() => {});
        };
        ctx.clickOn({ closest: sel => (sel === '.dead-start' ? {} : null) });
        expect(winListeners.pagehide).toHaveLength(1);
        winListeners.pagehide[0]();
        expect(signals[signals.length - 1].aborted).toBe(true);
        expect(def().onEscape()).toBe(false); // session gone: not consumed
    });
});

describe('item 10: progressive render + pause/resume/cancel', () => {
    it('renders dead rows incrementally as checks settle, healthy rows never listed', async () => {
        const gates = {};
        globalThis.fetch = url => new Promise(resolve => { gates[url] = resolve; });
        const ctx = setup({});
        const { $list } = ctx;
        ctx.def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-start' ? {} : null) });
        expect($list.innerHTML).not.toContain('dead-item-');
        gates['https://gone.example/page']({ status: 404 });
        await flush();
        // mid-scan: the settled dead row is already a row, scan still runs
        expect($list.innerHTML).toContain('id="dead-item-12"');
        expect($list.innerHTML).toContain('deadChecking[1|3]');
        expect($list.innerHTML).toContain('deadPause');
        expect($list.innerHTML).not.toContain('id="dead-item-13"'); // unsettled stays out
        gates['https://fine.example/']({ status: 200 });
        await flush();
        expect($list.innerHTML).not.toContain('id="dead-item-11"'); // healthy never listed
        gates['https://blocked.example/']({ status: 404 });
        await flush();
        expect($list.innerHTML).toContain('id="dead-item-13"');
        expect(ctx.store.get('deadLastScan')).toBeTruthy(); // finished → persisted
    });

    it('pause holds new dispatches, in-flight checks still record, resume continues at the breakpoint', async () => {
        const calls = [];
        const gates = {};
        globalThis.fetch = url => {
            calls.push(url);
            return new Promise(resolve => { gates[url] = resolve; });
        };
        const ctx = setup({ storeData: { deadScanConcurrency: '1' } });
        const { $list, def } = ctx;
        def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-start' ? {} : null) });
        expect(calls).toEqual(['https://fine.example/']); // concurrency 1
        ctx.clickOn({ closest: sel => (sel === '.dead-pause' ? {} : null) });
        expect($list.innerHTML).toContain('deadResume'); // button flipped
        expect($list.innerHTML).toContain('deadPaused'); // state tag
        gates['https://fine.example/']({ status: 200 });
        await flush();
        expect(calls).toHaveLength(1); // paused: no new dispatch
        expect($list.innerHTML).toContain('deadChecking[1|3]'); // in-flight recorded
        ctx.clickOn({ closest: sel => (sel === '.dead-pause' ? {} : null) }); // resume
        expect(calls).toEqual(['https://fine.example/', 'https://gone.example/page']); // no re-probe
        gates['https://gone.example/page']({ status: 404 });
        await flush();
        expect(calls).toHaveLength(3);
        gates['https://blocked.example/']({ status: 404 });
        await flush();
        expect(JSON.parse(ctx.store.get('deadLastScan')).results['12'].status).toBe('dead');
    });

    it('cancel stops the scheduler, aborts in-flight probes and discards the run', async () => {
        const signals = [];
        const gates = {};
        globalThis.fetch = (url, opts) => {
            signals.push(opts.signal);
            return new Promise(resolve => { gates[url] = resolve; });
        };
        const ctx = setup({ storeData: { deadScanConcurrency: '1' } });
        const { $list, store } = ctx;
        ctx.def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-start' ? {} : null) });
        gates['https://fine.example/']({ status: 200 });
        await flush();
        expect($list.innerHTML).toContain('deadChecking[1|3]');
        ctx.clickOn({ closest: sel => (sel === '.dead-cancel' ? {} : null) });
        expect(signals.every(s => s.aborted)).toBe(true); // in-flight probe aborted
        // state reset: back to the executable start hint, no cache written
        expect($list.innerHTML).toContain('class="empty-state dead-start"');
        expect(store.get('deadLastScan', '')).toBe('');
        // the late completion of the aborted probe changes nothing
        gates['https://gone.example/page']({ status: 404 });
        await flush();
        expect(store.get('deadLastScan', '')).toBe('');
        expect($list.innerHTML).toContain('dead-start');
    });

    it('cancel with a previous cache restores the cached view (the run never happened)', async () => {
        const CACHE = JSON.stringify({
            ts: 1700000000000, scannedCount: 3,
            results: { '12': { status: 'dead', code: 404 } }
        });
        globalThis.fetch = () => new Promise(() => {});
        const ctx = setup({ storeData: { deadLastScan: CACHE } });
        const { $list, store } = ctx;
        ctx.def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-rescan' ? {} : null) });
        expect($list.innerHTML).toContain('deadPause');
        ctx.clickOn({ closest: sel => (sel === '.dead-cancel' ? {} : null) });
        expect($list.innerHTML).toContain('deadLastScanAt');
        expect($list.innerHTML).toContain('id="dead-item-12"');
        expect(store.get('deadLastScan')).toBe(CACHE); // untouched
    });

    it('re-entering the view mid-scan (even paused) renders the live session state', async () => {
        const gates = {};
        globalThis.fetch = url => new Promise(resolve => { gates[url] = resolve; });
        const ctx = setup({});
        const { $list, views, def } = ctx;
        def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-start' ? {} : null) });
        ctx.clickOn({ closest: sel => (sel === '.dead-pause' ? {} : null) }); // pause
        views.active = false; // switch away mid-scan
        gates['https://gone.example/page']({ status: 404 });
        await flush();
        views.active = true;
        def().activate(); // back: live paused state, not a fake idle
        const html = $list.innerHTML;
        expect(html).toContain('deadResume');
        expect(html).toContain('deadChecking[1|3]');
        expect(html).toContain('id="dead-item-12"'); // progressive row survived the switch
        expect(html).not.toContain('dead-start');
        // and the paused session is still resumable afterwards
        def().onEscape(); // Esc = resume
        gates['https://fine.example/']({ status: 200 });
        gates['https://blocked.example/']({ status: 404 });
        await flush();
        expect(ctx.store.get('deadLastScan')).toBeTruthy();
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
        // 第五轮项1: two-line (wide/panel) rows pin the buttons to the TITLE
        // line — center alignment parked them on the seam between the lines.
        expect(body).toContain('align-items: flex-start');
    });

    it('the row anchor flexes with min-width:0, buttons pin to the inline end', () => {
        const body = ruleBody(neatCss, '#dead-list ul li.vbm-row > a {');
        expect(body).toContain('flex: 1');
        expect(body).toContain('min-width: 0');
        // badge + favicon inside the anchor join the buttons on the title line
        expect(body).toContain('align-items: flex-start');
    });

    it('the icon slot tracks the title-line height so the icon stays centered on it', () => {
        const body = ruleBody(neatCss, '#dead-list ul li.vbm-row > a .favicon-container {');
        expect(body).toContain('min-height: 1.67em');
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
        expect(ctx.def().badge()).toBe(0);
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

    it('a healthy rescan prunes the mark automatically', async () => {
        globalThis.fetch = () => Promise.resolve({ status: 200 }); // all healthy now
        const ctx = setup({ storeData: { deadMarks: '["11","12"]' } });
        const { store, def } = ctx;
        def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-start' ? {} : null) });
        await flush();
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

    it('rescan restarts the scan from the info row', async () => {
        const calls = [];
        globalThis.fetch = url => { calls.push(url); return Promise.resolve({ status: 200 }); };
        const ctx = setup({ storeData: { deadLastScan: CACHE } });
        const { $list } = ctx;
        ctx.def().activate();
        ctx.clickOn({ closest: sel => (sel === '.dead-rescan' ? {} : null) });
        await flush();
        expect(calls).toHaveLength(3); // the three scannable bookmarks
        expect($list.innerHTML).toContain('deadNone'); // all healthy now
    });
});
