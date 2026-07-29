import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// view-dupes.js touches page globals (document/chrome/setTimeout) only
// inside initViewDupes and its handlers, so the real module imports cleanly
// in node once the globals are stubbed. store/views/treeRender/
// separatorManager/treeView/dialogs/undo are injected recording doubles;
// the registered ViewDef is captured and driven by hand (activate/onKey/
// badge). setTimeout is a record-only stub advanced by hand (tick) for the
// 300ms regroup debounce; the serial deletion chain flushes through the
// saved real setTimeout. All assertions go through the doubles' records
// and the list's innerHTML — nothing is copied from the module body.

let initViewDupes;
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
    ({ initViewDupes } = await import('../src/view-dupes.js'));
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

const flush = () => new Promise(resolve => realSetTimeout(resolve, 0));

// Dupe landscape (docs/v4task-2.md §5.6): a.com has three copies — the
// oldest in the bar root, one in a bar subfolder, the newest in Other;
// c.com exists as an http and an https copy (ignoreScheme terrain); b.com
// is unique. getTree hands out `treeData` by reference so tests can mutate
// it between calls like the real backend would after a deletion.
const makeTree = () => [{
    id: '0', title: '', children: [
        {
            id: '1', title: 'Bar', children: [
                { id: '11', parentId: '1', title: 'A oldest', url: 'https://a.com/', dateAdded: 100 },
                {
                    id: '14', parentId: '1', title: 'Folder', children: [
                        { id: '15', parentId: '14', title: 'A mid', url: 'https://a.com/#x', dateAdded: 200 }
                    ]
                }
            ]
        },
        {
            id: '2', title: 'Other', children: [
                { id: '21', parentId: '2', title: 'A newest', url: 'https://a.com/?utm_source=t', dateAdded: 300 },
                { id: '22', parentId: '2', title: 'B only', url: 'https://b.com/', dateAdded: 150 },
                { id: '23', parentId: '2', title: 'C http', url: 'http://c.com/', dateAdded: 160 },
                { id: '24', parentId: '2', title: 'C https', url: 'https://c.com/', dateAdded: 170 }
            ]
        }
    ]
}];

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
    const $list = makeEl('dupes-list');
    const $container = makeEl('view-dupes');
    const doc = { getElementById: id => byId[id] || null, activeElement: null };
    globalThis.document = doc;

    const treeData = opts.tree || makeTree();
    const chromeStub = {
        i18n: {
            getMessage: (key, subs) =>
                subs ? `${key}[${[].concat(subs).join('|')}]` : key
        },
        bookmarks: {
            getTreeCalls: 0,
            removeCalls: [],
            getTree(cb) {
                this.getTreeCalls++;
                cb(treeData);
            },
            remove(id, cb) {
                this.removeCalls.push(id);
                cb();
            },
            onCreated: { addListener(fn) { this.fn = fn; } },
            onRemoved: { addListener(fn) { this.fn = fn; } },
            onChanged: { addListener(fn) { this.fn = fn; } },
            onMoved: { addListener(fn) { this.fn = fn; } }
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
        isActive(id) { return id === 'dupes' && this.active; },
        pathOf: opts.pathOf || (() => ''),
        showItemPath: opts.showItemPath || (() => true),
        activateCalls: [],
        activate(id) { this.activateCalls.push(id); },
        badgeCalls: 0,
        updateBadges() { this.badgeCalls++; }
    };

    const treeRender = {
        calls: [],
        // §3.6's "members never repeat the URL": the double deliberately
        // omits the href so innerHTML assertions can count URL occurrences.
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

    const viewDupes = initViewDupes({
        store, views, treeRender, separatorManager, treeView, dialogs, undo,
        // Slice D: counts come from the visit-stats store; statsOff doubles
        // as the statsEnabled-off switch (most-visited greys out).
        visitStats: opts.visitStats || {
            countOf: id => (opts.visitCounts || {})[id] || 0,
            enabled: () => !opts.statsOff
        },
        ...(opts.onRowsRendered ? { onRowsRendered: opts.onRowsRendered } : {})
    });

    // Event helpers over the list's recorded listeners.
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
        viewDupes, $list, $container, doc, chrome: chromeStub, store, views,
        treeRender, separatorManager, treeView, dialogs, undo, treeData,
        def: () => views.def, fire, clickOn
    };
};

describe('view registration (§5.6)', () => {
    it('registers the dupes view with tab metadata and type-ahead off', () => {
        const { def, $list, $container } = setup({});
        expect(def().id).toBe('dupes');
        expect(def().titleKey).toBe('viewDupes');
        expect(def().icon).toContain('<svg');
        expect(def().container).toBe($container);
        expect(def().listEl).toBe($list);
        expect(def().typeAhead).toBe(false);
        expect(typeof def().badge).toBe('function');
        expect(typeof def().activate).toBe('function');
        expect(typeof def().onKey).toBe('function');
    });

    it('maps the showDupesView setting onto tab visibility', () => {
        expect(setup({}).def().hidden).toBe(false); // default: visible
        expect(setup({ storeData: { showDupesView: '' } }).def().hidden).toBe(true);
    });

    it('exposes refresh + setKeeper on the module API', () => {
        const { viewDupes } = setup({});
        expect(Object.keys(viewDupes).sort()).toEqual(['refresh', 'setKeeper']);
    });

    it('badge() tracks the group count (0 hides the tab badge)', () => {
        const { def } = setup({});
        expect(def().badge()).toBe(0); // no regroup yet
        def().activate();
        expect(def().badge()).toBe(1); // the a.com group
        const ctx2 = setup({ tree: [{ id: '0', title: '', children: [] }] });
        ctx2.def().activate();
        expect(ctx2.def().badge()).toBe(0);
    });
});

describe('render (docs/v4task-2-list.md §3.6)', () => {
    it('calls onRowsRendered after every render with the rows in the DOM (item: dead-mark overlays)', () => {
        const seen = [];
        const { def, $list } = setup({
            onRowsRendered: () => seen.push($list.innerHTML)
        });
        def().activate();
        expect(seen).toHaveLength(1);
        expect(seen[0]).toContain('dupes-item-11');
    });

    it('renders the group header once and member rows without any visible URL', () => {
        const { $list, treeRender, def } = setup({ pathOf: id => `path-of-${id}` });
        def().activate();
        const html = $list.innerHTML;
        // the normalized key's visible rendering lives exactly once, on the
        // group head (data-key attributes are behavioral, not display)
        expect(html.match(/<span class="dupes-key"/g)).toHaveLength(1);
        expect(html).toContain('class="dupes-key"');
        expect(html).toContain('<span class="count-pill" aria-label="dupesGroupCount[3]">3</span>');
        // the per-group quick action names the strategy's keeper pick and
        // the doomed count up front (item 4: one click keeps one per setting)
        expect(html).toContain('aria-label="dupesCleanRestHint[A oldest|2]"');
        // member rows: keeper oldest first; the other two will-delete
        expect(html).toContain('id="dupes-item-11"');
        expect(html).toContain('id="dupes-item-15"');
        expect(html).toContain('id="dupes-item-21"');
        expect(html).toContain('data-key="https://a.com"');
        const willDelete = html.match(/will-delete/g);
        expect(willDelete).toHaveLength(2);
        // the keeper radio: exactly one checked, all labelled
        expect(html.match(/keeper-radio checked/g)).toHaveLength(1);
        expect(html.match(/aria-label="dupesKeepThis"/g)).toHaveLength(3);
        // member meta: path + dateAdded slots, never the URL (§3.6)
        expect(treeRender.calls).toHaveLength(3);
        expect(treeRender.calls[0].meta.path).toBe('path-of-11');
        expect(treeRender.calls[0].meta.rightText)
            .toBe(`path-of-11 · ${new Date(100).toLocaleDateString()}`);
        expect(treeRender.calls[0].meta.subText)
            .toBe(`path-of-11 · ${new Date(100).toLocaleString()}`);
        expect(treeRender.calls[0].extras).toBe('data-virtual="1"');
    });

    it('renders the toolbar: strategy/scope/scheme controls, summary, apply-all', () => {
        const { $list, def } = setup({});
        def().activate();
        const html = $list.innerHTML;
        expect(html).toContain('<select class="dupes-strategy"');
        expect(html).toContain('<option value="keep-oldest" selected>');
        expect(html).toContain('<option value="keep-most-visited">');
        expect(html).toContain('<select class="dupes-scope"');
        expect(html).toContain('dupesIgnoreScheme');
        expect(html).toContain('dupesPreviewSummary[1|2]'); // 1 group, 2 doomed
        expect(html).toContain('dupesApplyAll[2]');
    });

    it('disables apply-all and renders the empty state when nothing collides', () => {
        const { $list, def } = setup({ tree: [{ id: '0', title: '', children: [
            { id: '1', title: 'Bar', children: [
                { id: '11', parentId: '1', title: 'Solo', url: 'https://solo.example/', dateAdded: 1 }
            ] }
        ] }] });
        def().activate();
        expect($list.innerHTML).toContain('<li class="empty-state" role="listitem"><i>dupesNone</i></li>');
        expect($list.innerHTML).toContain('disabled');
        expect($list.innerHTML).toContain('dupesApplyAll[0]');
    });
});

describe('keeper strategies (§5.6b)', () => {
    it('keep-newest keeps the latest copy', () => {
        const { $list, def } = setup({ storeData: { dupesStrategy: 'keep-newest' } });
        def().activate();
        const html = $list.innerHTML;
        const keeperRow = html.match(/id="dupes-item-(\d+)"[^>]*>(?:(?!will-delete)[\s\S])*?keeper-radio checked/);
        // simpler: the checked radio's row id
        const rowOfChecked = html.split('keeper-radio checked')[0].match(/dupes-item-(\d+)(?!.*dupes-item)/);
        expect(rowOfChecked[1]).toBe('21');
    });

    it('keep-bookmark-bar keeps the in-bar copy even when a newer one exists elsewhere', () => {
        const { $list, def } = setup({ storeData: { dupesStrategy: 'keep-bookmark-bar' } });
        def().activate();
        const html = $list.innerHTML;
        const rowOfChecked = html.split('keeper-radio checked')[0].match(/dupes-item-(\d+)(?!.*dupes-item)/);
        expect(rowOfChecked[1]).toBe('11'); // oldest in-bar wins
    });

    // Slice D (§5.4 联动): keep-most-visited reads the real visit-stats store.
    it('keep-most-visited keeps the copy with the highest visit count', () => {
        const { $list, def } = setup({
            storeData: { dupesStrategy: 'keep-most-visited' },
            visitCounts: { '15': 9, '11': 3 }
        });
        def().activate();
        const html = $list.innerHTML;
        const rowOfChecked = html.split('keeper-radio checked')[0].match(/dupes-item-(\d+)(?!.*dupes-item)/);
        expect(rowOfChecked[1]).toBe('15');
    });

    it('keep-most-visited falls back to oldest when no counts exist', () => {
        const { $list, def } = setup({ storeData: { dupesStrategy: 'keep-most-visited' } });
        def().activate();
        const html = $list.innerHTML;
        const rowOfChecked = html.split('keeper-radio checked')[0].match(/dupes-item-(\d+)(?!.*dupes-item)/);
        expect(rowOfChecked[1]).toBe('11');
    });

    it('greys out keep-most-visited while statsEnabled is off', () => {
        const { $list, def } = setup({ statsOff: true });
        def().activate();
        expect($list.innerHTML).toContain('<option value="keep-most-visited" disabled>');
    });

    it('a manual radio pick overrides the strategy and survives a strategy switch', () => {
        const ctx = setup({ storeData: { dupesStrategy: 'keep-newest' } });
        const { $list, def, clickOn, store } = ctx;
        def().activate();
        // pin 15 by hand
        clickOn({
            closest: sel => (sel === '.keeper-radio'
                ? { closest: () => ({ dataset: { nodeId: '15', key: 'https://a.com' } }) }
                : null)
        });
        let html = $list.innerHTML;
        let rowOfChecked = html.split('keeper-radio checked')[0].match(/dupes-item-(\d+)(?!.*dupes-item)/);
        expect(rowOfChecked[1]).toBe('15');
        // switching the strategy regroups but keeps the manual pin (still in group)
        store.set('dupesStrategy', 'keep-oldest');
        ctx.fire('change', { target: { classList: { contains: c => c === 'dupes-strategy' }, value: 'keep-oldest', closest: () => null } });
        html = $list.innerHTML;
        rowOfChecked = html.split('keeper-radio checked')[0].match(/dupes-item-(\d+)(?!.*dupes-item)/);
        expect(rowOfChecked[1]).toBe('15'); // the pin, not the strategy default 11
    });
});

describe('scope + ignoreScheme (§5.6c)', () => {
    it("scope='bar' keeps only the bookmarks-bar subtree", () => {
        const { $list, treeRender, def } = setup({ storeData: { dupesScope: 'bar' } });
        def().activate();
        const ids = treeRender.calls.map(c => c.id);
        expect(ids).toEqual(['11', '15']); // 21 sits in Other, c.com outside the bar
        expect($list.innerHTML).toContain('dupesPreviewSummary[1|1]');
    });

    it('ignoreScheme folds the http/https pair into one group', () => {
        const { $list, def } = setup({ storeData: { dupesIgnoreScheme: '1' } });
        def().activate();
        const html = $list.innerHTML;
        expect(html).toContain('id="dupes-item-23"');
        expect(html).toContain('id="dupes-item-24"');
        expect(html).toContain('//c.com'); // scheme-folded key on the group head
        expect(html).toContain('dupesPreviewSummary[2|3]'); // two groups now
    });

    it('toolbar changes persist and regroup immediately', () => {
        const ctx = setup({});
        const { $list, def, store, fire } = ctx;
        def().activate();
        fire('change', { target: { classList: { contains: () => false }, value: 'bar', closest: sel => sel === '.dupes-scope' } });
        // not the scope select: closest('.dupes-scheme') was null and classList
        // contains false — nothing should change
        expect(store.get('dupesScope', 'all')).toBe('all');
        // ignoreScheme first (full tree): the c.com pair folds into one group
        fire('change', { target: { classList: { contains: () => false }, checked: true, closest: sel => sel === '.dupes-scheme' } });
        expect(store.get('dupesIgnoreScheme')).toBe('1');
        expect($list.innerHTML).toContain('//c.com');
        // then the scope switch: bar-only regroup drops everything outside '1'
        fire('change', { target: { classList: { contains: c => c === 'dupes-scope' }, value: 'bar', closest: () => null } });
        expect(store.get('dupesScope')).toBe('bar');
        expect($list.innerHTML).toContain('dupesPreviewSummary[1|1]');
        expect($list.innerHTML).not.toContain('//c.com');
    });
});

describe('group collapse (§3.6)', () => {
    const headClick = (ctx, key = 'https://a.com') => ctx.clickOn({
        closest: sel => (sel === '.group-head'
            ? { closest: () => ({ dataset: { key } }) }
            : null)
    });

    it('clicking the group head folds and unfolds its members', () => {
        const ctx = setup({});
        const { $list, def } = ctx;
        def().activate();
        headClick(ctx);
        let html = $list.innerHTML;
        expect(html).not.toContain('id="dupes-item-11"'); // members hidden
        expect(html).toContain('https://a.com'); // head stays
        expect(html).toContain('chevron collapsed');
        headClick(ctx);
        html = $list.innerHTML;
        expect(html).toContain('id="dupes-item-11"');
        expect(html).toContain('aria-expanded="true"');
    });

    it('capture-phase keys on a focused head: →/Space/Enter expand, ← collapses, all stopped', () => {
        const ctx = setup({});
        const { $list, def, fire } = ctx;
        def().activate();
        const head = {
            classList: { contains: c => c === 'group-head' },
            closest: sel => (sel === 'li' ? { dataset: { key: 'https://a.com' } } : null)
        };
        const keyEv = key => ({
            key, target: head,
            preventDefault() { this.prevented = true; },
            stopPropagation() { this.stopped = true; }
        });
        fire('keydown', keyEv('ArrowLeft')); // collapse
        expect($list.innerHTML).not.toContain('id="dupes-item-11"');
        const ev = keyEv('ArrowRight');
        fire('keydown', ev);
        expect(ev.stopped).toBe(true); // keyboard.js never sees it
        expect($list.innerHTML).toContain('id="dupes-item-11"');
        fire('keydown', keyEv(' ')); // Space toggles too (collapse again)
        expect($list.innerHTML).not.toContain('id="dupes-item-11"');
        fire('keydown', keyEv('Enter'));
        expect($list.innerHTML).toContain('id="dupes-item-11"');
        // an already-expanded → falls through (context-menu path upstream)
        const passthrough = keyEv('ArrowRight');
        fire('keydown', passthrough);
        expect(passthrough.stopped).toBeUndefined();
    });
});

describe('batch deletion (§5.6a)', () => {
    it('clean-the-rest confirms, captures+removes the doomed copies serially and toasts once', async () => {
        const ctx = setup({});
        const { chrome, dialogs, undo, clickOn } = ctx;
        ctx.def().activate();
        clickOn({
            closest: sel => (sel === '.dupes-clean-rest'
                ? { closest: () => ({ dataset: { key: 'https://a.com' } }) }
                : null)
        });
        expect(dialogs.ConfirmDialog.openCalls).toHaveLength(1);
        expect(dialogs.ConfirmDialog.openCalls[0].dialog).toBe('dupesConfirmGroup[2]');
        expect(chrome.bookmarks.removeCalls).toEqual([]); // gated until fn1
        dialogs.ConfirmDialog.openCalls[0].fn1();
        await flush();
        expect(undo.captureCalls).toEqual(['15', '21']); // capture before remove
        expect(chrome.bookmarks.removeCalls).toEqual(['15', '21']); // keeper 11 stays
        expect(undo.toastCalls).toEqual(['dupesDone[2]']); // one toast, not two
    });

    it('apply-all confirms with the cross-group totals and removes every doomed copy', async () => {
        const ctx = setup({ storeData: { dupesIgnoreScheme: '1' } });
        const { chrome, dialogs, undo, clickOn } = ctx;
        ctx.def().activate();
        clickOn({ closest: sel => (sel === '.dupes-apply-all' ? {} : null) });
        expect(dialogs.ConfirmDialog.openCalls[0].dialog).toBe('dupesConfirmAll[3|2]');
        dialogs.ConfirmDialog.openCalls[0].fn1();
        await flush();
        expect(chrome.bookmarks.removeCalls).toEqual(['15', '21', '24']);
        expect(undo.toastCalls).toEqual(['dupesDone[3]']);
    });

    it('cancelling the dialog removes nothing', async () => {
        const ctx = setup({});
        const { chrome, dialogs, undo, clickOn } = ctx;
        ctx.def().activate();
        clickOn({ closest: sel => (sel === '.dupes-apply-all' ? {} : null) });
        await flush(); // fn1 never ran
        expect(chrome.bookmarks.removeCalls).toEqual([]);
        expect(undo.captureCalls).toEqual([]);
        expect(undo.toastCalls).toEqual([]);
    });

    it('the regroup replays itself through the debounced onRemoved listener', async () => {
        const ctx = setup({});
        const { chrome, dialogs, clickOn, $list } = ctx;
        ctx.def().activate();
        clickOn({ closest: sel => (sel === '.dupes-apply-all' ? {} : null) });
        dialogs.ConfirmDialog.openCalls[0].fn1();
        await flush();
        // backend truth after the deletion
        ctx.treeData[0].children[0].children[0] = ctx.treeData[0].children[0].children[0]; // noop guard
        const bar = ctx.treeData[0].children[0];
        bar.children[1].children = []; // folder 14 emptied
        ctx.treeData[0].children[1].children =
            ctx.treeData[0].children[1].children.filter(n => n.id !== '21');
        chrome.bookmarks.onRemoved.fn();
        tick(300);
        expect($list.innerHTML).toContain('<li class="empty-state" role="listitem"><i>dupesNone</i></li>');
    });
});

describe('interactions (§3.6)', () => {
    it('plain member clicks fall through to treeView.bookmarkHandler', () => {
        const ctx = setup({});
        const { treeView, clickOn } = ctx;
        ctx.def().activate();
        clickOn({ closest: () => null }); // hits nothing special
        expect(treeView.handlerCalls).toBe(1);
    });

    it('K on a focused member pins it as keeper; R reveals it in the tree', () => {
        const ctx = setup({});
        const { def, doc, treeView, $list } = ctx;
        def().activate();
        doc.activeElement = {
            closest: sel => (sel === '[data-node-id]' ? { dataset: { nodeId: '15', key: 'https://a.com' } } : null)
        };
        let prevented = 0;
        const consumed = def().onKey({ key: 'k', preventDefault: () => prevented++ });
        expect(consumed).toBe(true);
        expect(prevented).toBe(1);
        const rowOfChecked = $list.innerHTML.split('keeper-radio checked')[0]
            .match(/dupes-item-(\d+)(?!.*dupes-item)/);
        expect(rowOfChecked[1]).toBe('15');
        expect(def().onKey({ key: 'r', preventDefault: () => {} })).toBe(true);
        expect(treeView.revealCalls).toEqual(['15']);
        expect(def().onKey({ key: 'x', preventDefault: () => {} })).toBe(false);
    });

    it('K/R decline rows without a node id', () => {
        const { def, doc } = setup({});
        doc.activeElement = { closest: () => null };
        expect(def().onKey({ key: 'k', preventDefault: () => {} })).toBe(false);
        expect(def().onKey({ key: 'r', preventDefault: () => {} })).toBe(false);
        doc.activeElement = null;
        expect(def().onKey({ key: 'k', preventDefault: () => {} })).toBe(false);
    });

    it('setKeeper (context-menu path) pins the keeper and activates the view', () => {
        const ctx = setup({ active: false });
        const { viewDupes, views, $list } = ctx;
        viewDupes.refresh(); // builds the group index even while inactive? no —
        // inactive refresh only flags dirty, so drive activate directly
        views.active = true;
        ctx.def().activate();
        views.active = false;
        viewDupes.setKeeper('21');
        expect(views.activateCalls).toEqual(['dupes']); // jumped back into the tab
        // the dirty replay renders with 21 as the keeper
        views.active = true;
        ctx.def().activate();
        const rowOfChecked = $list.innerHTML.split('keeper-radio checked')[0]
            .match(/dupes-item-(\d+)(?!.*dupes-item)/);
        expect(rowOfChecked[1]).toBe('21');
    });
});

describe('refresh lifecycle', () => {
    it('recomputes in the background while inactive (tab badge stays fresh) and repaints on activation', () => {
        const { views, chrome, def, $list } = setup({ active: false });
        expect(chrome.bookmarks.getTreeCalls).toBe(0);
        // background recompute: groups rebuild + badge bump, no paint
        chrome.bookmarks.onCreated.fn();
        tick(300);
        expect(chrome.bookmarks.getTreeCalls).toBe(1);
        expect(views.badgeCalls).toBe(1);
        expect($list.innerHTML).toBe('');
        views.active = true;
        def().activate(); // dirty → replay + paint
        expect(chrome.bookmarks.getTreeCalls).toBe(2);
        expect($list.innerHTML).toContain('dupes-group');
    });

    it('debounces a burst of bookmark events into one 300ms regroup', () => {
        const { chrome, def } = setup({});
        def().activate();
        expect(chrome.bookmarks.getTreeCalls).toBe(1);
        chrome.bookmarks.onCreated.fn();
        chrome.bookmarks.onRemoved.fn();
        chrome.bookmarks.onChanged.fn();
        chrome.bookmarks.onMoved.fn();
        expect(timeouts.filter(t => t[1] === 300)).toHaveLength(1);
        tick(300);
        expect(chrome.bookmarks.getTreeCalls).toBe(2);
    });
});


describe('snapshot persistence (round-6 item 6)', () => {
    // A previous regroup: the a.com group with two of its three copies
    // (the live makeTree() has three — revalidation must discover 15).
    const SNAPSHOT = JSON.stringify({
        ts: 1234567890,
        scope: 'all',
        ignoreScheme: false,
        groups: [
            { key: 'https://a.com', items: [
                { id: '11', title: 'A oldest', url: 'https://a.com/', dateAdded: 100, parentId: '1', inBar: true },
                { id: '21', title: 'A newest', url: 'https://a.com/?utm_source=t', dateAdded: 300, parentId: '2', inBar: false }
            ] }
        ]
    });

    it('persists every regroup into dupesLastResult', () => {
        const { def, store } = setup({});
        def().activate();
        const snap = JSON.parse(store.get('dupesLastResult', ''));
        expect(snap.scope).toBe('all');
        expect(snap.ignoreScheme).toBe(false);
        expect(snap.ts).toEqual(expect.any(Number));
        expect(snap.groups).toHaveLength(1);
        expect(snap.groups[0].key).toBe('https://a.com');
        expect(snap.groups[0].items.map(i => i.id)).toEqual(['11', '15', '21']);
    });

    it('hydrates at init — activate paints the snapshot without getTree', () => {
        const { def, $list, chrome } = setup({ storeData: { dupesLastResult: SNAPSHOT } });
        expect(def().badge()).toBe(1); // badge reflects the snapshot at once
        expect(chrome.bookmarks.getTreeCalls).toBe(0);
        def().activate();
        expect(chrome.bookmarks.getTreeCalls).toBe(0); // instant paint, no recompute
        expect($list.innerHTML).toContain('dupes-item-11');
        expect($list.innerHTML).toContain('dupes-item-21');
    });

    it('revalidates the hydrated snapshot against the live tree (300ms debounce)', () => {
        const { def, $list, chrome } = setup({ storeData: { dupesLastResult: SNAPSHOT } });
        def().activate();
        expect($list.innerHTML).not.toContain('dupes-item-15'); // not in the snapshot
        tick(300); // the scheduled revalidation
        expect(chrome.bookmarks.getTreeCalls).toBe(1);
        expect($list.innerHTML).toContain('dupes-item-15'); // live tree has 3 copies
    });

    it('drops stale rows after revalidation when the dupe vanished while closed', () => {
        const tree = [{ id: '0', title: '', children: [
            { id: '2', title: 'Other', children: [
                { id: '22', parentId: '2', title: 'B only', url: 'https://b.com/', dateAdded: 150 }
            ] }
        ] }];
        const { def, $list } = setup({ tree, storeData: { dupesLastResult: SNAPSHOT } });
        def().activate();
        expect($list.innerHTML).toContain('dupes-item-11'); // stale paint first
        tick(300);
        expect($list.innerHTML).toContain('dupesNone'); // corrected by the live tree
    });

    it('skips the snapshot when the scope changed since it was taken', () => {
        const { def, chrome } = setup({
            storeData: { dupesLastResult: SNAPSHOT, dupesScope: 'bar' }
        });
        def().activate();
        expect(chrome.bookmarks.getTreeCalls).toBe(1); // recomputed, not hydrated
    });

    it('skips the snapshot when ignoreScheme changed since it was taken', () => {
        const { def, chrome } = setup({
            storeData: { dupesLastResult: SNAPSHOT, dupesIgnoreScheme: '1' }
        });
        def().activate();
        expect(chrome.bookmarks.getTreeCalls).toBe(1);
    });

    it('skips a corrupt snapshot blob and recomputes', () => {
        const { def, chrome, $list } = setup({ storeData: { dupesLastResult: '{oops' } });
        def().activate();
        expect(chrome.bookmarks.getTreeCalls).toBe(1);
        expect($list.innerHTML).toContain('dupes-group');
    });

    it('skips a snapshot whose groups no longer hold a real group', () => {
        const thin = JSON.stringify({
            ts: 1, scope: 'all', ignoreScheme: false,
            groups: [{ key: 'https://a.com', items: [
                { id: '11', title: 'A oldest', url: 'https://a.com/', dateAdded: 100, parentId: '1', inBar: true }
            ] }]
        });
        const { def, chrome } = setup({ storeData: { dupesLastResult: thin } });
        def().activate();
        expect(chrome.bookmarks.getTreeCalls).toBe(1); // single-member groups are no groups
    });
});
