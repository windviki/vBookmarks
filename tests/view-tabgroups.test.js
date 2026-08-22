import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { htmlspecialchars } from '../src/escape.js';

// view-tabgroups.js touches page globals only inside initViewTabGroups and
// its handlers, so the real module imports cleanly once chrome/document are
// stubbed. The double below follows the view-dupes recipe: DOM elements are
// record-only, chrome.tabs/tabGroups callbacks fire synchronously, and every
// assertion goes through the doubles' records plus the list innerHTML.

let initViewTabGroups;
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

beforeAll(async () => {
    ({ initViewTabGroups } = await import('../src/view-tabgroups.js'));
});

afterAll(() => {
    delete globalThis.chrome;
    delete globalThis.document;
});

const makeClassList = initial => {
    const set = new Set(initial || []);
    return {
        add: (...cs) => cs.forEach(c => set.add(c)),
        remove: (...cs) => cs.forEach(c => set.delete(c)),
        contains: c => set.has(c),
        toString: () => [...set].join(' ')
    };
};

const makeEl = id => {
    const el = {
        id,
        tagName: 'DIV',
        _innerHTML: '',
        get innerHTML() { return this._innerHTML; },
        set innerHTML(v) {
            this._innerHTML = v;
            if (v === '')
                this.children = [];
        },
        textContent: '',
        value: '',
        checked: false,
        hidden: false,
        disabled: false,
        focused: false,
        scrollLeft: 0,
        style: {},
        className: '',
        dataset: {},
        attributes: {},
        classList: makeClassList(),
        children: [],
        parentNode: null,
        listeners: {},
        setAttribute(name, value) { this.attributes[name] = String(value); },
        getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; },
        addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
        trigger(type, event = {}) { for (const fn of (this.listeners[type] || [])) fn(event); return event; },
        focus() { this.focused = true; },
        select() {},
        appendChild(child) { this.children.push(child); child.parentNode = this; },
        querySelector(sel) {
            if (sel === 'a, span') {
                const a = this.children.find(c => c.tagName === 'A');
                if (a)
                    return a;
                const span = this.children.find(c => c.tagName === 'SPAN');
                return span || null;
            }
            return this.children.find(c => c.tagName === sel.toUpperCase()) || null;
        },
        querySelectorAll(sel) {
            // The focus-park helpers only need a list; no live DOM rows.
            return [];
        }
    };
    return el;
};

const flush = () => new Promise(resolve => realSetTimeout(resolve, 0));

const makeTab = (id, index, props = {}) => ({
    id,
    index,
    windowId: props.windowId || 1,
    title: props.title || `Tab ${id}`,
    url: props.url || `https://t${id}.example/`,
    active: !!props.active,
    groupId: props.groupId || -1,
    pinned: !!props.pinned,
    discarded: !!props.discarded,
    ...props
});

const makeGroup = (id, title, color, props = {}) => ({ id, title, color, windowId: 1, ...props });

const setup = (opts = {}) => {
    const byId = {};
    const ids = ['tabgroups-list', 'view-tabgroups'];
    for (const id of ids) {
        const el = makeEl(id);
        byId[id] = el;
    }
    const doc = {
        getElementById: id => byId[id] || null,
        activeElement: null,
        body: { classList: makeClassList(['rtl']) }
    };
    globalThis.document = doc;

    // Per-event listener capture for the throttling tests (H9 follow-up).
    const tabsListeners = {};
    const tabGroupsListeners = {};
    const bookmarksListeners = {};

    const chromeStub = {
        i18n: {
            getMessage: (key, subs) => {
                if (subs === undefined)
                    return key;
                const arr = [].concat(subs);
                return `${key}[${arr.join('|')}]`;
            }
        },
        tabs: {
            queryCalls: [],
            updateCalls: [],
            moveCalls: [],
            removeCalls: [],
            discardCalls: [],
            ungroupCalls: [],
            _tabs: opts.tabs || [
                makeTab(1, 0, { active: true }),
                makeTab(2, 1, { groupId: 'g1' }),
                makeTab(3, 2, { groupId: 'g1' }),
                makeTab(4, 3)
            ],
            query(queryInfo, cb) {
                this.queryCalls.push(queryInfo);
                cb(this._tabs.slice());
            },
            update(id, props, cb) {
                this.updateCalls.push([id, props]);
                if (cb)
                    cb({ id, ...props });
            },
            move(id, props, cb) {
                this.moveCalls.push([id, props]);
                if (cb)
                    cb({ id, ...props });
            },
            remove(ids, cb) {
                this.removeCalls.push(ids);
                if (cb)
                    cb();
            },
            createCalls: [],
            create(props, cb) {
                this.createCalls.push(props);
                if (cb)
                    cb({ id: 100 + this.createCalls.length, ...props });
            },
            discard(id, cb) {
                this.discardCalls.push(id);
                if (cb)
                    cb({ id, discarded: true });
            },
            ungroup(id, cb) {
                this.ungroupCalls.push(id);
                if (cb)
                    cb();
            },
            onCreated: { addListener(fn) { (tabsListeners.onCreated = tabsListeners.onCreated || []).push(fn); } },
            onRemoved: { addListener(fn) { (tabsListeners.onRemoved = tabsListeners.onRemoved || []).push(fn); } },
            onMoved: { addListener(fn) { (tabsListeners.onMoved = tabsListeners.onMoved || []).push(fn); } },
            onUpdated: { addListener(fn) { (tabsListeners.onUpdated = tabsListeners.onUpdated || []).push(fn); } },
            onActivated: { addListener(fn) { (tabsListeners.onActivated = tabsListeners.onActivated || []).push(fn); } },
            onAttached: { addListener(fn) { (tabsListeners.onAttached = tabsListeners.onAttached || []).push(fn); } },
            onDetached: { addListener(fn) { (tabsListeners.onDetached = tabsListeners.onDetached || []).push(fn); } }
        },
        tabGroups: {
            queryCalls: [],
            updateCalls: [],
            _groups: opts.groups || [
                makeGroup('g1', 'Dev', 'blue')
            ],
            query(queryInfo, cb) {
                this.queryCalls.push(queryInfo);
                if (cb)
                    cb(this._groups.slice());
            },
            update(id, props, cb) {
                this.updateCalls.push([id, props]);
                if (cb)
                    cb({ id, ...props });
            },
            onCreated: { addListener(fn) { (tabGroupsListeners.onCreated = tabGroupsListeners.onCreated || []).push(fn); } },
            onRemoved: { addListener(fn) { (tabGroupsListeners.onRemoved = tabGroupsListeners.onRemoved || []).push(fn); } },
            onUpdated: { addListener(fn) { (tabGroupsListeners.onUpdated = tabGroupsListeners.onUpdated || []).push(fn); } },
            onMoved: { addListener(fn) { (tabGroupsListeners.onMoved = tabGroupsListeners.onMoved || []).push(fn); } }
        },
        runtime: {
            sendMessageCalls: [],
            sendMessage(msg) { this.sendMessageCalls.push(msg); }
        },
        bookmarks: {
            searchCalls: [],
            createCalls: [],
            getCalls: [],
            getTreeCalls: 0,
            _existing: opts.existingBookmarks || [],
            getTree(cb) {
                this.getTreeCalls++;
                cb(opts.bookmarkTree || []);
            },
            search(query, cb) {
                this.searchCalls.push(query);
                cb(this._existing.slice());
            },
            create(props, cb) {
                this.createCalls.push(props);
                const node = { id: `bm_${this.createCalls.length}`, ...props };
                if (cb)
                    cb(node);
            },
            get(id, cb) {
                this.getCalls.push(id);
                if (cb)
                    cb([{ id, title: `folder-${id}` }]);
            },
            removeCalls: [],
            remove(id, cb) {
                this.removeCalls.push(id);
                if (cb)
                    cb();
            },
            onCreated: { addListener(fn) { (bookmarksListeners.onCreated = bookmarksListeners.onCreated || []).push(fn); } },
            onRemoved: { addListener(fn) { (bookmarksListeners.onRemoved = bookmarksListeners.onRemoved || []).push(fn); } },
            onChanged: { addListener(fn) { (bookmarksListeners.onChanged = bookmarksListeners.onChanged || []).push(fn); } }
        },
        windows: {
            WINDOW_ID_CURRENT: 1,
            getAllCalls: [],
            updateCalls: [],
            removeCalls: [],
            remove(id, cb) {
                this.removeCalls.push(id);
                if (cb)
                    cb();
            },
            update(id, props, cb) {
                this.updateCalls.push([id, props]);
                if (cb)
                    cb({ id, ...props });
            },
            getAll(queryInfo, cb) {
                this.getAllCalls.push(queryInfo);
                const defaultTabs = opts.tabs || [
                    makeTab(1, 0, { active: true }),
                    makeTab(2, 1, { groupId: 'g1' }),
                    makeTab(3, 2, { groupId: 'g1' }),
                    makeTab(4, 3)
                ];
                const wins = opts.windows || [{ id: 1, focused: true, tabs: defaultTabs }];
                cb(wins.map(w => ({ ...w, tabs: (w.tabs || []).slice() })));
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
        active: opts.active !== undefined ? opts.active : true,
        register(def) { this.def = def; },
        isActive(id) { return id === 'tabgroups' && this.active; },
        pathOf: opts.pathOf || (() => ''),
        showItemPath: opts.showItemPath || (() => true),
        updateBadgesCalls: 0,
        updateBadges() { this.updateBadgesCalls++; }
    };

    const treeRender = {
        generateBookmarkHTML(title, url, extras, id, positions, meta) {
            if (opts.metaSink)
                opts.metaSink.push(meta);
            const badges = (meta && meta.badge || [])
                .filter(b => b && b.text)
                .map(b => `<span class="row-badge ${b.cls}">${b.text}</span>`).join('');
            // The real tree-render escapes title + url — the double models
            // that contract so escaping regressions stay visible here.
            return `<a href="${htmlspecialchars(url)}" ${extras} class="tree-item-link">${htmlspecialchars(title)}${badges}</a>`;
        }
    };

    const dialogs = {
        ConfirmDialog: {
            openCalls: [],
            open(opts) { this.openCalls.push(opts); }
        },
        AlertDialog: {
            openCalls: [],
            open(msg) { this.openCalls.push(msg); }
        },
        GroupDialog: {
            openCalls: [],
            open(opts) { this.openCalls.push(opts); }
        },
        GroupPickDialog: {
            openCalls: [],
            open(opts) { this.openCalls.push(opts); }
        },
        CopyMoveDialog: {
            openCalls: [],
            open(opts) { this.openCalls.push(opts); }
        },
        BookmarkFolderPickDialog: {
            openCalls: [],
            open(opts) { this.openCalls.push(opts); }
        }
    };
    const undo = {
        toastCalls: [],
        toastActionCalls: [],
        captureCalls: [],
        showToast(msg) { this.toastCalls.push(msg); },
        toastAction(message, buttonLabel, onAction) {
            this.toastActionCalls.push({ message, buttonLabel, onAction });
        },
        capture(id) { this.captureCalls.push(id); }
    };

    const viewTabGroups = initViewTabGroups({
        store,
        views,
        treeRender,
        dialogs,
        undo,
        ...(opts.rememberState === undefined ? {} : { getRememberState: () => !!opts.rememberState }),
        ...(opts.onChanged ? { onChanged: opts.onChanged } : {}),
        ...(opts.stagingApi ? { staging: opts.stagingApi } : {}),
        ...(opts.onRowsRendered ? { onRowsRendered: opts.onRowsRendered } : {})
    });

    const $list = byId['tabgroups-list'];
    const fire = (type, ev) => {
        for (const fn of ($list.listeners[type] || []))
            fn(ev);
        return ev;
    };
    const clickOn = target => fire('click', {
        target,
        preventDefault() { this.prevented = (this.prevented || 0) + 1; },
        stopPropagation() { this.stopped = (this.stopped || 0) + 1; }
    });

    const closestOf = result => sel => {
        if (sel === 'li')
            return result.li || null;
        if (result[sel])
            return result[sel];
        return null;
    };

    return {
        viewTabGroups, $list, byId, doc, chrome: chromeStub, store, views,
        treeRender, dialogs, undo,
        def: () => views.def, fire, clickOn, closestOf,
        tabsListeners, tabGroupsListeners, bookmarksListeners
    };
};

describe('view registration', () => {
    it('registers the tabgroups view after search (metadata, typeAhead off)', () => {
        const { def, $list, byId } = setup({});
        expect(def().id).toBe('tabgroups');
        expect(def().titleKey).toBe('viewTabGroups');
        expect(def().icon).toContain('<svg');
        expect(def().container).toBe(byId['view-tabgroups']);
        expect(def().listEl).toBe($list);
        expect(def().typeAhead).toBe(false);
        expect(def().showKey).toBe('showTabGroupsView');
        expect(def().disableKey).toBe('disableTabGroupsView');
    });

    it('maps showTabGroupsView onto tab visibility', () => {
        expect(setup({}).def().hidden).toBe(false);
        expect(setup({ storeData: { showTabGroupsView: '' } }).def().hidden).toBe(true);
    });

    it('badge() tracks the current window tab count after refresh', () => {
        const { def } = setup({});
        expect(def().badge()).toBe(0);
        def().activate();
        expect(def().badge()).toBe(4);
    });

    it('inactive refresh is count-only: badge updates, heavy queries skipped (H9)', () => {
        const ctx = setup({ active: false, tabs: [makeTab(1, 0, { active: true }), makeTab(2, 1)] });
        const { def, chrome, viewTabGroups } = ctx;
        viewTabGroups.refresh();
        // the stub's query callback is synchronous — badge already updated
        expect(def().badge()).toBe(2);
        expect(chrome.tabs.queryCalls).toEqual([{}]);
        expect(chrome.tabGroups.queryCalls).toEqual([]);   // no group query
        expect(chrome.windows.getAllCalls).toEqual([]);    // no window read
        expect(chrome.bookmarks.getTreeCalls).toBe(0);     // no tree/render
    });

    it('inactive: title/order events never touch the badge (H9 follow-up)', () => {
        vi.useFakeTimers();
        try {
            const ctx = setup({ active: false });
            for (const ev of ['onUpdated', 'onMoved', 'onActivated', 'onAttached', 'onDetached'])
                for (const fn of (ctx.tabsListeners[ev] || []))
                    fn();
            for (const ev of ['onCreated', 'onRemoved', 'onUpdated', 'onMoved'])
                for (const fn of (ctx.tabGroupsListeners[ev] || []))
                    fn();
            for (const ev of ['onCreated', 'onRemoved', 'onChanged'])
                for (const fn of (ctx.bookmarksListeners[ev] || []))
                    fn();
            vi.advanceTimersByTime(3000);
            expect(ctx.chrome.tabs.queryCalls).toHaveLength(0);
            expect(ctx.views.updateBadgesCalls).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('inactive: only count-affecting tab events refresh, at the 1 s cadence (H9 follow-up)', () => {
        vi.useFakeTimers();
        try {
            const ctx = setup({ active: false, tabs: [makeTab(1, 0, { active: true })] });
            ctx.tabsListeners.onCreated[0]();
            vi.advanceTimersByTime(999);
            expect(ctx.chrome.tabs.queryCalls).toHaveLength(0); // still inside the 1 s window
            vi.advanceTimersByTime(1);
            expect(ctx.chrome.tabs.queryCalls).toEqual([{}]);  // count-only query
            expect(ctx.chrome.windows.getAllCalls).toEqual([]);
            expect(ctx.views.updateBadgesCalls).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('active: render-input events keep the 300 ms refresh cadence (H9 follow-up)', () => {
        vi.useFakeTimers();
        try {
            const ctx = setup({ active: true });
            ctx.tabsListeners.onUpdated[0]();
            vi.advanceTimersByTime(299);
            expect(ctx.chrome.windows.getAllCalls).toHaveLength(0);
            vi.advanceTimersByTime(1);
            // active refresh is a FULL refresh (windows + groups + tree)
            expect(ctx.chrome.windows.getAllCalls.length).toBeGreaterThan(0);
            expect(ctx.chrome.tabGroups.queryCalls.length).toBeGreaterThan(0);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('render', () => {
    it('renders ungrouped tabs and open groups in actual tab order', () => {
        const { def, $list } = setup({});
        def().activate();
        const html = $list.innerHTML;
        // Open groups and ungrouped tabs are interleaved in browser order:
        // tab1 (ungrouped) before group g1, group members 2/3, then tab4.
        expect(html.indexOf('tabgroups-item-1')).toBeLessThan(html.indexOf('data-group-id="g1"'));
        expect(html.indexOf('data-group-id="g1"')).toBeLessThan(html.indexOf('tabgroups-item-2'));
        expect(html.indexOf('tabgroups-item-2')).toBeLessThan(html.indexOf('tabgroups-item-3'));
        expect(html.indexOf('tabgroups-item-3')).toBeLessThan(html.indexOf('tabgroups-item-4'));
        // no open/ungrouped section headings in the inline flow
        expect(html).not.toContain('tabGroupsOpenGroups');
        expect(html).not.toContain('tabGroupsUngroupedTabs');
        // group header content: title, color, count, save action
        expect(html).toContain('Dev');
        expect(html).toContain('tg-blue');
        expect(html).toContain('tabGroupsGroupCount[2]');
        expect(html).toContain('tabgroups-group-save');
        // button order (4.1.0 alignment pass): the shared tail reads
        // sleep → save → close left-to-right, mirroring the member rows'
        // [sleep][star][close] columns; go-to/rename sit left of the tail.
        const order = [
            html.indexOf('tabgroups-group-activate'),
            html.indexOf('tabgroups-group-rename'),
            html.indexOf('tabgroups-group-sleep'),
            html.indexOf('tabgroups-group-save'),
            html.indexOf('tabgroups-group-close')
        ];
        expect(order.every(i => i >= 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        // the save action reads as "favorite this folder": folder + star
        expect(html).toContain('vbm-icon-folder-star');
        // current tab marker
        expect(html).toContain('tabgroups-current');
        expect(html).toContain('row-badge current');
    });

    it('renders an empty state when the window has no tabs', () => {
        const { def, $list } = setup({ tabs: [] });
        def().activate();
        expect($list.innerHTML).toContain('tabGroupsViewEmpty');
    });
});

describe('closed groups and window folding', () => {
    it('close group saves a closed record before closing its tabs (no confirm, toast regrets)', () => {
        const { def, chrome, dialogs, store, clickOn, closestOf, undo } = setup({});
        def().activate();
        const li = { dataset: { groupId: 'g1' }, classList: makeClassList() };
        const btn = { classList: makeClassList(), closest: sel => sel === 'li' ? li : (sel === '.tabgroups-group-close' ? btn : null) };
        clickOn(btn);
        // single-group close runs immediately — no dialog tax (4.1.0 UX pass)
        expect(dialogs.ConfirmDialog.openCalls).toHaveLength(0);
        expect(store._data.tabGroupsClosed).toBeDefined();
        const records = JSON.parse(store._data.tabGroupsClosed);
        expect(records).toHaveLength(1);
        expect(records[0].title).toBe('Dev');
        expect(records[0].tabs).toHaveLength(2);
        expect(chrome.runtime.sendMessageCalls).toEqual([{ type: 'vbm-tabs-close', tabIds: [2, 3] }]);
        // the toast carries the reopen regret action
        expect(undo.toastActionCalls).toHaveLength(1);
        expect(undo.toastActionCalls[0].message).toBe('tabGroupsClosedToast[2]');
        expect(undo.toastActionCalls[0].buttonLabel).toBe('tabGroupsReopenAction');
        undo.toastActionCalls[0].onAction();
        expect(chrome.runtime.sendMessageCalls[1]).toEqual({
            type: 'vbm-tab-group-open-new',
            urls: ['https://t2.example/', 'https://t3.example/'],
            title: 'Dev',
            color: 'blue',
            windowId: 1
        });
    });

    it('restore closed group sends openNew (with the record window) and drops the saved record', () => {
        const record = { id: 'cg_1', title: 'Dev', color: 'blue', windowId: 7, tabs: [{ url: 'https://a/', title: 'A' }, { url: 'https://b/', title: 'B' }] };
        const { def, chrome, store, viewTabGroups } = setup({ storeData: { tabGroupsClosed: JSON.stringify([record]) } });
        def().activate();
        viewTabGroups.restoreClosedGroup('cg_1');
        expect(chrome.runtime.sendMessageCalls).toEqual([
            { type: 'vbm-tab-group-open-new', urls: ['https://a/', 'https://b/'], title: 'Dev', color: 'blue', windowId: 7 }
        ]);
        expect(store._data.tabGroupsClosed).toBe('[]');
    });

    it('clearClosedGroups confirms first (the records are the only reopen path)', () => {
        const record = { id: 'cg_1', title: 'Dev', color: 'blue', savedAt: Date.now(), tabs: [{ url: 'https://a/', title: 'A' }] };
        const { def, $list, store, viewTabGroups, dialogs } = setup({ storeData: { tabGroupsClosed: JSON.stringify([record]) } });
        def().activate();
        expect($list.innerHTML).toContain('tabgroups-closed-group');
        viewTabGroups.clearClosedGroups();
        // nothing happens before the confirm
        expect(store._data.tabGroupsClosed).not.toBe('[]');
        expect(dialogs.ConfirmDialog.openCalls).toHaveLength(1);
        expect(dialogs.ConfirmDialog.openCalls[0].dialog).toBe('tabGroupsConfirmClearClosed');
        dialogs.ConfirmDialog.openCalls[0].fn1();
        expect(store._data.tabGroupsClosed).toBe('[]');
        expect($list.innerHTML).not.toContain('tabgroups-closed-group');
    });

    it('window head row (the whole row) folds and unfolds that window section', () => {
        const { def, $list, clickOn } = setup({
            windows: [
                { id: 1, focused: true, tabs: [makeTab(1, 0, { active: true })] },
                { id: 2, focused: false, tabs: [makeTab(10, 0)] }
            ]
        });
        def().activate();
        // Non-current windows fold by default; the current one stays open.
        expect($list.innerHTML).toContain('id="tabgroups-item-1"');
        expect($list.innerHTML).not.toContain('id="tabgroups-item-10"');
        // The fold control is the head ROW, not a chevron button.
        expect($list.innerHTML).toContain('tabgroups-window-head-row');
        expect($list.innerHTML).toContain('role="button"');
        expect($list.innerHTML).not.toContain('tabgroups-window-collapse');
        const winHead = { dataset: { windowId: '1' }, classList: makeClassList() };
        const row = {
            classList: makeClassList(['tabgroups-window-head-row']),
            closest: sel => sel === '.tabgroups-window-head-row' ? row : (sel === 'li' ? winHead : null)
        };
        clickOn(row);
        expect($list.innerHTML).not.toContain('id="tabgroups-item-1"');
        clickOn(row);
        expect($list.innerHTML).toContain('id="tabgroups-item-1"');
    });

    it('the current window stays expanded even when a stale fold choice names it', () => {
        // A previous session folded window 2 only. Window ids are reused
        // across sessions, so a flat "collapsed" list used to fold whatever
        // window inherited the id — including the current one.
        const ui = JSON.stringify({ windowChoices: { 2: true } });
        const { def, $list } = setup({
            storeData: { tabGroupsViewState: ui },
            windows: [
                { id: 2, focused: true, tabs: [makeTab(20, 0, { active: true, windowId: 2 })] },
                { id: 3, focused: false, tabs: [makeTab(30, 0, { windowId: 3 })] }
            ]
        });
        def().activate();
        // The explicit choice still folds window 2 — that is what the user did.
        expect($list.innerHTML).not.toContain('id="tabgroups-item-20"');
    });

    it('an explicit unfold of a non-current window survives a refresh', () => {
        const ui = JSON.stringify({ windowChoices: { 2: false } });
        const { def, $list } = setup({
            storeData: { tabGroupsViewState: ui },
            windows: [
                { id: 1, focused: true, tabs: [makeTab(1, 0, { active: true })] },
                { id: 2, focused: false, tabs: [makeTab(10, 0, { windowId: 2 })] }
            ]
        });
        def().activate();
        expect($list.innerHTML).toContain('id="tabgroups-item-10"');
    });

    it('an in-session window fold survives a refresh with remember-state off', () => {
        const { def, $list, viewTabGroups, clickOn } = setup({
            rememberState: false,
            windows: [
                { id: 1, focused: true, tabs: [makeTab(1, 0, { active: true })] }
            ]
        });
        def().activate();
        const winHead = { dataset: { windowId: '1' }, classList: makeClassList() };
        const row = {
            classList: makeClassList(['tabgroups-window-head-row']),
            closest: sel => sel === '.tabgroups-window-head-row' ? row : (sel === 'li' ? winHead : null)
        };
        clickOn(row);
        expect($list.innerHTML).not.toContain('id="tabgroups-item-1"');
        // a tab event refreshes every 300ms — the fold must not spring back
        viewTabGroups.refresh();
        expect($list.innerHTML).not.toContain('id="tabgroups-item-1"');
    });

    it('window fold choices persist as an explicit map, never as a default snapshot', () => {
        const { def, store, clickOn } = setup({
            windows: [
                { id: 1, focused: true, tabs: [makeTab(1, 0, { active: true })] },
                { id: 2, focused: false, tabs: [makeTab(10, 0, { windowId: 2 })] }
            ]
        });
        def().activate();
        // Nothing folded by hand yet → no window choice recorded.
        const winHead = { dataset: { windowId: '1' }, classList: makeClassList() };
        const row = {
            classList: makeClassList(['tabgroups-window-head-row']),
            closest: sel => sel === '.tabgroups-window-head-row' ? row : (sel === 'li' ? winHead : null)
        };
        clickOn(row);
        const ui = JSON.parse(store._data.tabGroupsViewState || '{}');
        expect(ui.windowChoices).toEqual({ 1: true });
    });
});

describe('multi-window rendering', () => {
    it('renders a window section per window with current window first', () => {
        const { def, $list } = setup({
            windows: [
                { id: 2, focused: false, tabs: [makeTab(10, 0)] },
                { id: 1, focused: true, tabs: [makeTab(1, 0, { active: true, groupId: 'g1' }), makeTab(2, 1, { groupId: 'g1' })] }
            ],
            groups: [makeGroup('g1', 'Dev', 'blue', { windowId: 1 })]
        });
        def().activate();
        const html = $list.innerHTML;
        expect(html).toContain('tabgroups-window-head');
        expect(html).toContain('tabGroupsCurrentWindow');
        expect(html).toContain('tabGroupsWindow[1]');
        expect(html).toContain('tabGroupsWindow[2]');
        expect(html.indexOf('tabGroupsWindow[1]')).toBeLessThan(html.indexOf('tabGroupsWindow[2]'));
        // Non-current window 2 folds by default; its tab is hidden until it
        // is expanded through its window-head toggle.
        expect(html).toContain('id="tabgroups-group-g1"');
        expect(html).not.toContain('id="tabgroups-item-10"');
    });

    it('the window head close button confirms, records ONE merged entry, closes the window and toasts Reopen', () => {
        const { def, chrome, dialogs, store, undo, clickOn } = setup({
            windows: [
                { id: 1, focused: true, tabs: [makeTab(1, 0, { active: true })] },
                { id: 2, focused: false, tabs: [makeTab(10, 0), makeTab(11, 1, { windowId: 2 })] }
            ]
        });
        def().activate();
        const li = { dataset: { windowId: '2' }, classList: makeClassList() };
        const btn = {
            classList: makeClassList(['tabgroups-window-close']),
            closest: sel => sel === 'li' ? li : (sel === '.tabgroups-window-close' ? btn : null)
        };
        clickOn(btn);
        // confirm names the window's tab count
        expect(dialogs.ConfirmDialog.openCalls).toHaveLength(1);
        expect(dialogs.ConfirmDialog.openCalls[0].dialog).toBe('tabGroupsConfirmClose[2]');
        dialogs.ConfirmDialog.openCalls[0].fn1();
        expect(chrome.windows.removeCalls).toEqual([2]);
        // ONE merged record for the whole window
        const records = JSON.parse(store._data.tabGroupsClosed);
        expect(records).toHaveLength(1);
        expect(records[0].title).toBe('tabGroupsWindowClosedTitle');
        expect(records[0].tabs).toHaveLength(2);
        // toast Reopen brings the window's tabs back as one group
        expect(undo.toastActionCalls).toHaveLength(1);
        undo.toastActionCalls[0].onAction();
        expect(chrome.runtime.sendMessageCalls[0].type).toBe('vbm-tab-group-open-new');
        expect(chrome.runtime.sendMessageCalls[0].urls).toHaveLength(2);
    });

    it('exactly one window carries the current pill even when none reports focused', () => {
        // No focused window (another app holds the OS focus, side-panel
        // usage): currentWindowId falls back to windows[0], and the pill
        // keys on that — win.focused alone used to make the badge vanish.
        const { def, $list } = setup({
            windows: [
                { id: 3, focused: false, tabs: [makeTab(1, 0, { active: true })] },
                { id: 4, focused: false, tabs: [makeTab(9, 0, { windowId: 4 })] }
            ]
        });
        def().activate();
        const html = $list.innerHTML;
        expect((html.match(/tabgroups-window-current/g) || [])).toHaveLength(1);
        const pillAt = html.indexOf('tabgroups-window-current');
        expect(html.indexOf('data-window-id="3"')).toBeLessThan(pillAt);
        expect(pillAt).toBeLessThan(html.indexOf('data-window-id="4"'));
    });
});

describe('pinned and sleeping tab state', () => {
    it('renders status icons and classes for pinned and discarded tabs', () => {
        const { def, $list } = setup({
            tabs: [
                makeTab(1, 0, { active: true, pinned: true }),
                makeTab(2, 1, { discarded: true }),
                makeTab(3, 2)
            ]
        });
        def().activate();
        const html = $list.innerHTML;
        expect(html).toMatch(/tabgroups-row[^"]*pinned/);
        expect(html).toMatch(/tabgroups-row[^"]*discarded/);
        // The state glyphs ARE their own controls: the pinned pin unpins and
        // the filled crescent wakes (both always visible), while an awake tab
        // shows the hollow crescent and an unpinned row gets the hover pin
        // button in the same column (4.1.0 parity with sleep/star hovers).
        expect(html).toContain('tabgroups-unpin always-on');
        expect(html).toContain('tabGroupsUnpinTab');
        expect(html).toContain('tabgroups-sleep-tab asleep always-on');
        expect(html).toContain('tabGroupsWakeTab');
        expect(html).toContain('tabGroupsSleepTab');
        expect(html).toContain('tabgroups-pin-tab');
        expect(html).toContain('tabGroupsPinTab');
        expect(html).toContain('vbm-icon-sleep-filled');
    });

    it('every row renders the same four icon columns (pin / sleep / star / close)', () => {
        const { def, $list } = setup({
            tabs: [
                makeTab(1, 0, { active: true, pinned: true }),
                makeTab(2, 1)
            ]
        });
        def().activate();
        const html = $list.innerHTML;
        const rowOf = id => {
            const start = html.indexOf(`id="tabgroups-item-${id}"`);
            return html.slice(start, html.indexOf('</li>', start));
        };
        for (const id of [1, 2]) {
            const row = rowOf(id);
            const slots = (row.match(/tabgroups-slot|tabgroups-unpin|tabgroups-pin-tab|tabgroups-sleep-tab|tabgroups-add-bookmark|tabgroups-remove-bookmark|tabgroups-close-tab/g) || []);
            expect(slots).toHaveLength(4);
        }
    });

    it('the row sleep control toggles: hollow sleeps (direct + toast), filled wakes', () => {
        const { def, chrome, dialogs, undo, clickOn } = setup({
            tabs: [
                makeTab(1, 0, { active: true }),
                makeTab(2, 1, { discarded: true })
            ]
        });
        def().activate();
        const press = tabId => {
            const li = { dataset: { tabId }, classList: makeClassList() };
            const btn = {
                classList: makeClassList(['tabgroups-sleep-tab']),
                closest: sel => sel === 'li' ? li : (sel === '.tabgroups-sleep-tab' ? btn : null)
            };
            clickOn(btn);
        };
        press('1');
        expect(dialogs.ConfirmDialog.openCalls).toHaveLength(0);
        expect(chrome.runtime.sendMessageCalls).toEqual([{ type: 'vbm-tabs-discard', tabIds: [1] }]);
        expect(undo.toastActionCalls).toHaveLength(1);
        expect(undo.toastActionCalls[0].buttonLabel).toBe('tabGroupsWakeAction');
        // the toast's Wake button wakes the just-slept tab
        undo.toastActionCalls[0].onAction();
        expect(chrome.runtime.sendMessageCalls[1]).toEqual({ type: 'vbm-tabs-wake', tabIds: [1] });
        // waking is non-destructive: no confirmation, straight to the SW
        press('2');
        expect(dialogs.ConfirmDialog.openCalls).toHaveLength(0);
        expect(chrome.runtime.sendMessageCalls[2]).toEqual({ type: 'vbm-tabs-wake', tabIds: [2] });
    });

    it('clicking the pinned glyph unpins that tab', () => {
        const { def, chrome, clickOn } = setup({
            tabs: [makeTab(1, 0, { active: true, pinned: true })]
        });
        def().activate();
        const li = { dataset: { tabId: '1' }, classList: makeClassList() };
        const btn = {
            classList: makeClassList(['tabgroups-unpin']),
            closest: sel => sel === 'li' ? li : (sel === '.tabgroups-unpin' ? btn : null)
        };
        clickOn(btn);
        expect(chrome.tabs.updateCalls).toEqual([[1, { pinned: false }]]);
    });

    it('the hover pin button pins an unpinned tab from the row itself', () => {
        const { def, $list, chrome, clickOn } = setup({
            tabs: [makeTab(1, 0, { active: true })]
        });
        def().activate();
        // an unpinned row renders the hover pin button in the pin column
        expect($list.innerHTML).toContain('tabgroups-pin-tab');
        const li = { dataset: { tabId: '1' }, classList: makeClassList() };
        const btn = {
            classList: makeClassList(['tabgroups-pin-tab']),
            closest: sel => sel === 'li' ? li : (sel === '.tabgroups-pin-tab' ? btn : null)
        };
        clickOn(btn);
        expect(chrome.tabs.updateCalls).toEqual([[1, { pinned: true }]]);
    });

    it('the group head sleep control follows the members state and toggles', () => {
        const { def, $list, chrome, viewTabGroups } = setup({
            tabs: [
                makeTab(1, 0, { active: true }),
                makeTab(2, 1, { groupId: 'g1', discarded: true }),
                makeTab(3, 2, { groupId: 'g1', discarded: true })
            ]
        });
        def().activate();
        expect($list.innerHTML).toContain('tabgroups-group-sleep asleep');
        expect($list.innerHTML).toContain('tabGroupsWakeGroup');
        expect(viewTabGroups.isGroupAsleep('g1')).toBe(true);
        viewTabGroups.wakeGroup('g1');
        expect(chrome.runtime.sendMessageCalls).toEqual([{ type: 'vbm-tabs-wake', tabIds: [2, 3] }]);
    });

    it('pinning a grouped tab toasts that it left its group', () => {
        const { def, chrome, undo, clickOn } = setup({});
        def().activate();
        const li = { dataset: { tabId: '2' }, classList: makeClassList() };
        const btn = {
            classList: makeClassList(['tabgroups-pin-tab']),
            closest: sel => sel === 'li' ? li : (sel === '.tabgroups-pin-tab' ? btn : null)
        };
        clickOn(btn);
        expect(chrome.tabs.ungroupCalls).toEqual([2]);
        expect(chrome.tabs.updateCalls).toEqual([[2, { pinned: true }]]);
        expect(undo.toastCalls).toEqual(['tabGroupsPinnedUngroupedToast']);
    });

    it('togglePinned updates the browser tab pinned state', () => {
        const { def, chrome, viewTabGroups } = setup({});
        def().activate();
        viewTabGroups.togglePinned('1');
        expect(chrome.tabs.updateCalls).toEqual([[1, { pinned: true }]]);
    });

    it('pinning a grouped tab removes it from its group first', () => {
        const { def, chrome, viewTabGroups } = setup({});
        def().activate();
        viewTabGroups.togglePinned('2');
        expect(chrome.tabs.ungroupCalls).toEqual([2]);
        expect(chrome.tabs.updateCalls).toEqual([[2, { pinned: true }]]);
    });

    it('grouping a pinned tab unpins it before the group action', async () => {
        const { def, chrome, dialogs, clickOn, closestOf } = setup({
            tabs: [
                makeTab(1, 0, { active: true }),
                makeTab(2, 1, { pinned: true }),
                makeTab(3, 2)
            ]
        });
        def().activate();
        clickOn({ closest: closestOf({ '.tabgroups-select-mode': { classList: makeClassList() } }) });
        clickOn({ closest: closestOf({ li: { dataset: { tabId: '2' }, classList: makeClassList() } }) });
        clickOn({ closest: closestOf({ '.tabgroups-new-group': { classList: makeClassList() } }) });
        dialogs.GroupDialog.openCalls[0].onConfirm('PinnedGroup', 'blue');
        await flush();
        // pinned tab was unpinned before the SW group message went out
        expect(chrome.tabs.updateCalls).toEqual([[2, { pinned: false }]]);
        expect(chrome.runtime.sendMessageCalls).toHaveLength(1);
        expect(chrome.runtime.sendMessageCalls[0].moveIds).toEqual([2]);
    });
});

describe('idle toolbar', () => {
    it('renders two rows with summary, icon buttons and the sync option', () => {
        const { def, $list } = setup({});
        def().activate();
        const html = $list.innerHTML;
        expect(html).toContain('tabgroups-controls-toolbar');
        expect(html).toContain('tabgroups-actions-toolbar');
        expect(html).toContain('tabgroups-summary');
        expect(html).toContain('tabgroups-refresh tabgroups-icon-btn');
        expect(html).toContain('tabgroups-collapse-all tabgroups-icon-btn');
        expect(html).toContain('tabgroups-expand-all tabgroups-icon-btn');
        expect(html).toContain('tabgroups-sync-collapse-input');
        expect(html).not.toContain('checked');
        expect(html).toContain('selectModeEnter');
    });

    it('sync checkbox change persists the setting', () => {
        const { def, $list, store, fire } = setup({});
        def().activate();
        const target = { classList: { contains: c => c === 'tabgroups-sync-collapse-input' }, checked: true };
        fire('change', { target });
        expect(store._data.tabGroupsSyncCollapse).toBe('1');
    });

    it('collapse-all / expand-all only sync browser groups when the option is on', () => {
        const off = setup({});
        off.def().activate();
        off.clickOn({ closest: off.closestOf({ '.tabgroups-collapse-all': { classList: makeClassList() } }) });
        expect(off.chrome.tabGroups.updateCalls).toEqual([]);
        off.clickOn({ closest: off.closestOf({ '.tabgroups-expand-all': { classList: makeClassList() } }) });
        expect(off.chrome.tabGroups.updateCalls).toEqual([]);

        const on = setup({ storeData: { tabGroupsSyncCollapse: '1' } });
        on.def().activate();
        on.clickOn({ closest: on.closestOf({ '.tabgroups-collapse-all': { classList: makeClassList() } }) });
        expect(on.chrome.tabGroups.updateCalls).toEqual([['g1', { collapsed: true }]]);
        on.clickOn({ closest: on.closestOf({ '.tabgroups-expand-all': { classList: makeClassList() } }) });
        expect(on.chrome.tabGroups.updateCalls).toEqual([['g1', { collapsed: true }], ['g1', { collapsed: false }]]);
    });
});

describe('group color edge option', () => {
    it('keeps the group color option out of the toolbar (it lives in options)', () => {
        const { def, $list } = setup({});
        def().activate();
        const html = $list.innerHTML;
        expect(html).not.toContain('tabgroups-color-border-input');
        expect(html).not.toContain('tabGroupsColorBorder');
        expect(html).not.toContain('color-enhanced');
    });

    it('adds the colored edge to group rows only when the option is on', () => {
        const { def, $list } = setup({ storeData: { tabGroupsColorBorder: '1' } });
        def().activate();
        const html = $list.innerHTML;
        expect(html).toContain('class="color-enhanced"');
        expect(html).toContain('tabgroups-group tg-blue');
        expect(html).toContain('grouped tg-blue');
        // ungrouped tab 1 carries no tg-* group color class
        expect(html).not.toMatch(/tabgroups-item-1[^>]*grouped tg-/);
    });
});

describe('selection mode', () => {
    it('enters and exits through toolbar buttons and Esc', () => {
        const { def, $list, fire, clickOn, closestOf } = setup({});
        def().activate();
        const target = { closest: closestOf({ '.tabgroups-select-mode': { classList: makeClassList() } }) };
        clickOn(target);
        expect($list.innerHTML).toContain('selecting-bar');
        expect($list.innerHTML).toContain('tabgroups-new-group');
        // Esc exits
        expect(def().onEscape()).toBe(true);
        expect($list.innerHTML).not.toContain('selecting-bar');
        // outside selection mode Esc is not consumed
        expect(def().onEscape()).toBe(false);
    });

    it('row click toggles selection and toolbar count updates', () => {
        const { def, $list, clickOn, closestOf } = setup({});
        def().activate();
        clickOn({ closest: closestOf({ '.tabgroups-select-mode': { classList: makeClassList() } }) });
        const li = { dataset: { tabId: '1' }, classList: makeClassList() };
        clickOn({ closest: closestOf({ li }) });
        expect($list.innerHTML).toContain('selectCount[1]');
        clickOn({ closest: closestOf({ li }) });
        expect($list.innerHTML).toContain('selectCount[0]');
    });

    it('group head click toggles every member tab', () => {
        const { def, $list, clickOn, closestOf } = setup({});
        def().activate();
        clickOn({ closest: closestOf({ '.tabgroups-select-mode': { classList: makeClassList() } }) });
        const li = { dataset: { groupId: 'g1' }, classList: makeClassList() };
        clickOn({ closest: closestOf({ li }) });
        expect($list.innerHTML).toContain('selectCount[2]');
        clickOn({ closest: closestOf({ li }) });
        expect($list.innerHTML).toContain('selectCount[0]');
    });

    it('group head checkbox selects all members when partial, and clears when all selected', () => {
        const { def, $list, clickOn, closestOf } = setup({});
        def().activate();
        clickOn({ closest: closestOf({ '.tabgroups-select-mode': { classList: makeClassList() } }) });
        // select one member only (partial)
        clickOn({ closest: closestOf({ li: { dataset: { tabId: '2' }, classList: makeClassList() } }) });
        expect($list.innerHTML).toContain('selectCount[1]');
        // group head click with a partial selection selects the whole group
        const groupLi = { dataset: { groupId: 'g1' }, classList: makeClassList() };
        clickOn({ closest: closestOf({ li: groupLi }) });
        expect($list.innerHTML).toContain('selectCount[2]');
        // clicking again clears the whole group (all-selected -> none)
        clickOn({ closest: closestOf({ li: groupLi }) });
        expect($list.innerHTML).toContain('selectCount[0]');
    });
});

describe('tab batch actions', () => {
    it('new group sends vbm-tabs-new-group with ungrouped tabs moved', async () => {
        const { def, chrome, dialogs, clickOn, closestOf } = setup({});
        def().activate();
        clickOn({ closest: closestOf({ '.tabgroups-select-mode': { classList: makeClassList() } }) });
        clickOn({ closest: closestOf({ li: { dataset: { tabId: '4' }, classList: makeClassList() } }) });
        clickOn({ closest: closestOf({ '.tabgroups-new-group': { classList: makeClassList() } }) });
        expect(dialogs.GroupDialog.openCalls).toHaveLength(1);
        const openOpts = dialogs.GroupDialog.openCalls[0];
        expect(openOpts.title).toBe('tabGroupUntitled');
        openOpts.onConfirm('Work', 'red');
        await flush();
        expect(chrome.runtime.sendMessageCalls).toHaveLength(1);
        expect(chrome.runtime.sendMessageCalls[0]).toEqual({
            type: 'vbm-tabs-new-group',
            moveIds: [4],
            copyTabs: [],
            title: 'Work',
            color: 'red',
            windowId: 1
        });
    });

    it('new group with a grouped selected tab asks copy-or-move, then sends copy specs', async () => {
        const { def, chrome, dialogs, clickOn, closestOf } = setup({});
        def().activate();
        clickOn({ closest: closestOf({ '.tabgroups-select-mode': { classList: makeClassList() } }) });
        clickOn({ closest: closestOf({ li: { dataset: { tabId: '2' }, classList: makeClassList() } }) });
        clickOn({ closest: closestOf({ '.tabgroups-new-group': { classList: makeClassList() } }) });
        expect(dialogs.CopyMoveDialog.openCalls).toHaveLength(1);
        expect(dialogs.GroupDialog.openCalls).toHaveLength(0);
        dialogs.CopyMoveDialog.openCalls[0].onCopy();
        expect(dialogs.GroupDialog.openCalls).toHaveLength(1);
        dialogs.GroupDialog.openCalls[0].onConfirm('CopyGroup', 'green');
        await flush();
        expect(chrome.runtime.sendMessageCalls).toHaveLength(1);
        expect(chrome.runtime.sendMessageCalls[0]).toEqual({
            type: 'vbm-tabs-new-group',
            moveIds: [],
            copyTabs: [{ url: 'https://t2.example/', title: 'Tab 2' }],
            title: 'CopyGroup',
            color: 'green',
            windowId: 1
        });
    });

    it('close selected (many) confirms, writes ONE merged record and toasts Reopen', () => {
        const { def, chrome, store, dialogs, undo, clickOn, closestOf } = setup({});
        def().activate();
        clickOn({ closest: closestOf({ '.tabgroups-select-mode': { classList: makeClassList() } }) });
        clickOn({ closest: closestOf({ li: { dataset: { tabId: '1' }, classList: makeClassList() } }) });
        clickOn({ closest: closestOf({ li: { dataset: { tabId: '4' }, classList: makeClassList() } }) });
        clickOn({ closest: closestOf({ '.tabgroups-close-selected': { classList: makeClassList() } }) });
        expect(dialogs.ConfirmDialog.openCalls).toHaveLength(1);
        dialogs.ConfirmDialog.openCalls[0].fn1();
        expect(chrome.runtime.sendMessageCalls[0]).toEqual({ type: 'vbm-tabs-close', tabIds: [1, 4] });
        // ONE merged record for the whole batch (not N singles)
        const records = JSON.parse(store._data.tabGroupsClosed);
        expect(records).toHaveLength(1);
        expect(records[0].type).toBe('group');
        expect(records[0].tabs).toHaveLength(2);
        expect(undo.toastActionCalls).toHaveLength(1);
        expect(undo.toastActionCalls[0].buttonLabel).toBe('tabGroupsReopenAction');
        // Reopen brings the whole batch back as one group
        undo.toastActionCalls[0].onAction();
        expect(chrome.runtime.sendMessageCalls[1].type).toBe('vbm-tab-group-open-new');
        expect(chrome.runtime.sendMessageCalls[1].urls).toHaveLength(2);
    });

    it('close selected with ONE tab skips the confirm and runs the single-op path', () => {
        const { def, chrome, dialogs, undo, clickOn, closestOf } = setup({});
        def().activate();
        clickOn({ closest: closestOf({ '.tabgroups-select-mode': { classList: makeClassList() } }) });
        clickOn({ closest: closestOf({ li: { dataset: { tabId: '1' }, classList: makeClassList() } }) });
        clickOn({ closest: closestOf({ '.tabgroups-close-selected': { classList: makeClassList() } }) });
        expect(dialogs.ConfirmDialog.openCalls).toHaveLength(0);
        expect(chrome.runtime.sendMessageCalls[0]).toEqual({ type: 'vbm-tabs-close', tabIds: [1] });
        // the record + toast regret come from the single-tab close path
        expect(undo.toastActionCalls).toHaveLength(1);
        expect(undo.toastActionCalls[0].buttonLabel).toBe('tabGroupsReopenAction');
    });

    it('sleep selected (many) confirms then sends vbm-tabs-discard', () => {
        const { def, chrome, dialogs, clickOn, closestOf } = setup({});
        def().activate();
        clickOn({ closest: closestOf({ '.tabgroups-select-mode': { classList: makeClassList() } }) });
        clickOn({ closest: closestOf({ li: { dataset: { tabId: '1' }, classList: makeClassList() } }) });
        clickOn({ closest: closestOf({ li: { dataset: { tabId: '4' }, classList: makeClassList() } }) });
        clickOn({ closest: closestOf({ '.tabgroups-sleep-selected': { classList: makeClassList() } }) });
        dialogs.ConfirmDialog.openCalls[0].fn1();
        expect(chrome.runtime.sendMessageCalls[0]).toEqual({ type: 'vbm-tabs-discard', tabIds: [1, 4] });
    });
});

describe('bookmark integration', () => {
    it('hover add-bookmark button creates a bookmark in quickAddFolderId and toasts', () => {
        const { def, chrome, undo, clickOn, closestOf } = setup({ storeData: { quickAddFolderId: '2' } });
        def().activate();
        const li = { dataset: { tabId: '1' }, classList: makeClassList() };
        const btn = { classList: makeClassList(), closest: sel => sel === 'li' ? li : (sel === '.tabgroups-add-bookmark' ? btn : null) };
        clickOn(btn);
        expect(chrome.bookmarks.searchCalls).toHaveLength(1);
        expect(chrome.bookmarks.createCalls).toHaveLength(1);
        expect(chrome.bookmarks.createCalls[0].parentId).toBe('2');
        expect(chrome.bookmarks.createCalls[0].url).toBe('https://t1.example/');
        expect(undo.toastCalls).toHaveLength(1);
        expect(undo.toastCalls[0]).toBe('quickAddedTo[folder-2]');
    });

    it('renders a filled always-visible star for already-bookmarked tabs', () => {
        const { def, $list } = setup({
            bookmarkTree: [{ id: '0', title: '', children: [{ id: '1', title: 'Bar', children: [
                { id: '11', title: 'T1', url: 'https://t1.example/' }
            ] }] }]
        });
        def().activate();
        const html = $list.innerHTML;
        expect(html).toContain('tabgroups-remove-bookmark always-on');
        expect(html).toContain('tabGroupsRemoveBookmark');
        expect(html).toContain('vbm-icon-star-filled');
        // unbookmarked tab 4 keeps the hover-revealed add button
        expect(html).toContain('tabgroups-add-btn');
        expect(html).toContain('vbm-icon-star');
    });

    it('clicking the filled star removes the bookmark (undo-captured) and toasts', () => {
        const { def, chrome, undo, clickOn } = setup({
            bookmarkTree: [{ id: '0', title: '', children: [{ id: '1', title: 'Bar', children: [
                { id: '11', title: 'T1', url: 'https://t1.example/' }
            ] }] }],
            existingBookmarks: [{ id: '11', title: 'T1', url: 'https://t1.example/' }]
        });
        def().activate();
        const li = { dataset: { tabId: '1' }, classList: makeClassList() };
        const btn = {
            classList: makeClassList(['tabgroups-remove-bookmark']),
            closest: sel => sel === 'li' ? li : (sel === '.tabgroups-remove-bookmark' ? btn : null)
        };
        clickOn(btn);
        expect(undo.captureCalls).toEqual(['11']);
        expect(chrome.bookmarks.removeCalls).toEqual(['11']);
        expect(undo.toastCalls[0]).toBe('tabGroupsBookmarkRemoved[1]');
        // the row falls back to the hover-revealed hollow ☆
        expect(chrome.bookmarks.removeCalls).toHaveLength(1);
    });

    it('flips an unbookmarked row to the filled star after quick-add', () => {
        const { def, $list, clickOn, closestOf } = setup({});
        def().activate();
        expect($list.innerHTML).not.toContain('tabgroups-remove-bookmark');
        const li = { dataset: { tabId: '1' }, classList: makeClassList() };
        const btn = { classList: makeClassList(), closest: sel => sel === 'li' ? li : (sel === '.tabgroups-add-bookmark' ? btn : null) };
        clickOn(btn);
        const html = $list.innerHTML;
        const rowStart = html.indexOf('id="tabgroups-item-1"');
        const row1 = html.slice(rowStart, html.indexOf('</li>', rowStart));
        expect(row1).toContain('tabgroups-remove-bookmark');
        expect(row1).not.toContain('tabgroups-add-btn');
        // other unbookmarked rows keep the add button
        expect(html).toContain('tabgroups-add-btn');
    });

    it('add selected to bookmark folder opens the folder picker and creates in the picked folder', async () => {
        const { def, chrome, dialogs, undo, clickOn, closestOf } = setup({});
        def().activate();
        clickOn({ closest: closestOf({ '.tabgroups-select-mode': { classList: makeClassList() } }) });
        clickOn({ closest: closestOf({ li: { dataset: { tabId: '1' }, classList: makeClassList() } }) });
        clickOn({ closest: closestOf({ '.tabgroups-add-bookmarks': { classList: makeClassList() } }) });
        expect(dialogs.BookmarkFolderPickDialog.openCalls).toHaveLength(1);
        dialogs.BookmarkFolderPickDialog.openCalls[0].onPick('9');
        // let the create promise chain settle
        await flush();
        expect(chrome.bookmarks.createCalls).toHaveLength(1);
        expect(chrome.bookmarks.createCalls[0].parentId).toBe('9');
        expect(undo.toastCalls[0]).toBe('tabGroupsBookmarksAdded[1|folder-9]');
    });

    it('save group to bookmarks creates a folder via saveSession and writes folder meta', async () => {
        const { def, chrome, store, undo, clickOn, closestOf } = setup({});
        def().activate();
        const li = { dataset: { groupId: 'g1' }, classList: makeClassList() };
        const btn = { classList: makeClassList(), closest: sel => sel === 'li' ? li : (sel === '.tabgroups-group-save' ? btn : null) };
        clickOn(btn);
        await flush();
        expect(chrome.bookmarks.createCalls.length).toBeGreaterThanOrEqual(2); // folder + tabs
        const meta = JSON.parse(store._data.tabGroupFolderMeta || '{}');
        expect(meta.bm_1 && meta.bm_1.color).toBe('blue');
        // 4.1.0: the toast carries an Undo that removes the fresh folder
        // (captured first, so the bookmark undo stack can restore it again)
        expect(undo.toastActionCalls).toHaveLength(1);
        expect(undo.toastActionCalls[0].message).toBe('tabGroupsGroupSavedToFolder[2|Dev]');
        expect(undo.toastActionCalls[0].buttonLabel).toBe('undoAction');
        const removed = [];
        chrome.bookmarks.removeTree = (id, cb) => { removed.push(id); cb && cb(); };
        undo.toastActionCalls[0].onAction();
        expect(undo.captureCalls).toContain('bm_1');
        expect(removed).toEqual(['bm_1']);
    });
});

describe('keyboard safety (tab rows are not bookmarks)', () => {
    it('Space/Enter and the fold arrows answer on a closed-record head (4.1.0 keyboard gap)', () => {
        const record = {
            id: 'cg_1', type: 'group', title: 'Dev', color: 'blue',
            savedAt: Date.now(), tabs: [{ title: 'A', url: 'https://a/' }]
        };
        const { def, viewTabGroups, fire } = setup({
            storeData: { tabGroupsClosed: JSON.stringify([record]) }
        });
        def().activate();
        const head = { classList: makeClassList(['tabgroups-closed-head']) };
        const li = { dataset: { closedId: 'cg_1' }, classList: makeClassList() };
        head.closest = sel => sel === 'li' ? li : (sel === '.tabgroups-closed-head' ? head : null);
        const press = key => fire('keydown', {
            key,
            target: head,
            preventDefault() { this.pd = true; },
            stopPropagation() {}
        });
        expect(viewTabGroups.isClosedExpanded('cg_1')).toBe(false);
        press('Enter');
        expect(viewTabGroups.isClosedExpanded('cg_1')).toBe(true);
        press(' ');
        expect(viewTabGroups.isClosedExpanded('cg_1')).toBe(false);
        // the fold arrows follow the tree-folder rule (this double's body is
        // rtl: forward = ArrowLeft, back = ArrowRight)
        press('ArrowLeft');
        expect(viewTabGroups.isClosedExpanded('cg_1')).toBe(true);
        press('ArrowRight');
        expect(viewTabGroups.isClosedExpanded('cg_1')).toBe(false);
    });

    it('group head li carries an id for focus memory', () => {
        const { def, $list } = setup({});
        def().activate();
        expect($list.innerHTML).toContain('id="tabgroups-group-g1"');
    });

    it('F2 on a tab row stops propagation and never reaches the bookmark rename path', () => {
        const { def, fire, closestOf } = setup({});
        def().activate();
        const li = { dataset: { tabId: '1' }, classList: makeClassList() };
        const ev = {
            key: 'F2',
            target: { closest: closestOf({ li }) },
            prevented: 0,
            stoppedImmediate: 0,
            preventDefault() { this.prevented++; },
            stopImmediatePropagation() { this.stoppedImmediate++; }
        };
        fire('keydown', ev);
        expect(ev.prevented).toBe(1);
        expect(ev.stoppedImmediate).toBe(1);
    });

    it('F2 on a group head opens the rename dialog', () => {
        const { def, dialogs, fire, closestOf } = setup({});
        def().activate();
        const li = { dataset: { groupId: 'g1' }, classList: makeClassList() };
        const head = { classList: makeClassList(), closest: sel => sel === 'li' ? li : (sel === '.tabgroups-group-head' ? head : null) };
        fire('keydown', {
            key: 'F2',
            target: head,
            preventDefault() {},
            stopImmediatePropagation() {}
        });
        expect(dialogs.GroupDialog.openCalls).toHaveLength(1);
        expect(dialogs.GroupDialog.openCalls[0].dialog).toBe('tabGroupsRenameDialog');
    });

    it('Delete on a tab row closes it directly (record + toast regret)', () => {
        const { def, chrome, dialogs, undo, fire, closestOf } = setup({});
        def().activate();
        const li = { dataset: { tabId: '1' }, classList: makeClassList() };
        fire('keyup', {
            key: 'Delete',
            target: { closest: closestOf({ 'li.tabgroups-row': li }) },
            preventDefault() {},
            stopImmediatePropagation() {}
        });
        expect(dialogs.ConfirmDialog.openCalls).toHaveLength(0);
        expect(chrome.runtime.sendMessageCalls).toEqual([{ type: 'vbm-tabs-close', tabIds: [1] }]);
        expect(undo.toastActionCalls).toHaveLength(1);
        expect(undo.toastActionCalls[0].buttonLabel).toBe('tabGroupsReopenAction');
        // the Reopen of a SINGLE-tab record opens a plain background tab —
        // never a one-member titled tab group (the openNew trap)
        undo.toastActionCalls[0].onAction();
        expect(chrome.runtime.sendMessageCalls).toHaveLength(1); // no vbm-tab-group-open-new
        expect(chrome.tabs.createCalls).toEqual([{ url: 'https://t1.example/', active: false }]);
    });
});

describe('row click/auxclick', () => {
    it('middle-click activates the tab, right-click does not', () => {
        const { def, chrome, fire, closestOf } = setup({});
        def().activate();
        const anchor = { dataset: { tabId: '1' }, classList: makeClassList() };
        const target = { closest: closestOf({ a: anchor }) };
        // right-click must be ignored (the context menu owns that button)
        fire('auxclick', { button: 2, target, preventDefault() {}, stopPropagation() {} });
        expect(chrome.tabs.updateCalls).toEqual([]);
        // middle-click still activates
        fire('auxclick', { button: 1, target, preventDefault() {}, stopPropagation() {} });
        expect(chrome.tabs.updateCalls).toEqual([[1, { active: true }]]);
    });
});

describe('cross-window activation', () => {
    it('clicking a tab in ANOTHER window also focuses that window', () => {
        const { def, chrome, fire, closestOf } = setup({
            windows: [
                { id: 1, focused: true, tabs: [makeTab(1, 0, { active: true })] },
                { id: 2, focused: false, tabs: [makeTab(9, 0, { windowId: 2 })] }
            ]
        });
        def().activate();
        const anchor = { dataset: { tabId: '9' }, classList: makeClassList() };
        fire('click', { target: { closest: closestOf({ a: anchor }) }, preventDefault() {}, stopPropagation() {} });
        expect(chrome.tabs.updateCalls).toEqual([[9, { active: true }]]);
        expect(chrome.windows.updateCalls).toEqual([[2, { focused: true }]]);
    });

    it('clicking a tab in the CURRENT window never refocuses the window', () => {
        const { def, chrome, fire, closestOf } = setup({});
        def().activate();
        const anchor = { dataset: { tabId: '4' }, classList: makeClassList() };
        fire('click', { target: { closest: closestOf({ a: anchor }) }, preventDefault() {}, stopPropagation() {} });
        expect(chrome.tabs.updateCalls).toEqual([[4, { active: true }]]);
        expect(chrome.windows.updateCalls).toEqual([]);
    });

    it('activateGroup focuses the owning window when it is not current', () => {
        const { def, viewTabGroups, chrome } = setup({
            windows: [
                { id: 1, focused: true, tabs: [makeTab(1, 0, { active: true })] },
                { id: 2, focused: false, tabs: [makeTab(9, 0, { windowId: 2, groupId: 'g9' })] }
            ],
            groups: [makeGroup('g9', 'Far', 'red', { windowId: 2 })]
        });
        def().activate();
        viewTabGroups.activateGroup('g9');
        expect(chrome.tabs.updateCalls).toEqual([[9, { active: true }]]);
        expect(chrome.windows.updateCalls).toEqual([[2, { focused: true }]]);
    });
});

describe('first-activation scroll to the current tab (design §7)', () => {
    it('scrolls the current row into view once, then leaves scroll memory alone', () => {
        const { def, $list } = setup({});
        const fakeRow = { scrolled: 0, scrollIntoView() { this.scrolled++; } };
        $list.querySelector = sel => sel === '.tabgroups-current' ? fakeRow : null;
        def().activate();
        expect(fakeRow.scrolled).toBe(1);
        def().activate();
        expect(fakeRow.scrolled).toBe(1);
    });

    it('does nothing when no current row exists', () => {
        const { def, $list } = setup({});
        $list.querySelector = () => null;
        expect(() => def().activate()).not.toThrow();
    });
});

describe('Delete key guarding', () => {
    it('Delete on a group head is swallowed (never reaches the bookmark delete path)', () => {
        const { def, fire } = setup({});
        def().activate();
        const head = {
            classList: makeClassList(['tabgroups-group-head']),
            closest: sel => sel === 'li' ? { dataset: { groupId: 'g1' } } : null
        };
        const ev = fire('keyup', {
            key: 'Delete',
            target: head,
            preventDefault() { this.pd = (this.pd || 0) + 1; },
            stopImmediatePropagation() { this.sip = (this.sip || 0) + 1; },
            stopPropagation() {}
        });
        expect(ev.pd).toBe(1);
        expect(ev.sip).toBe(1);
    });

    it('Delete inside a text input is left alone (caret editing)', () => {
        const { def, fire } = setup({});
        def().activate();
        const ev = fire('keyup', {
            key: 'Delete',
            target: { tagName: 'INPUT', closest: () => null },
            preventDefault() { this.pd = (this.pd || 0) + 1; },
            stopImmediatePropagation() { this.sip = (this.sip || 0) + 1; },
            stopPropagation() {}
        });
        expect(ev.pd).toBeUndefined();
        expect(ev.sip).toBeUndefined();
    });
});

describe('toolbar instant filter (4.1.0 audit P1)', () => {
    const typeFilter = (fire, text) => fire('input', {
        target: { classList: { contains: c => c === 'tabgroups-filter-input' }, value: text }
    });

    it('narrows rows by title/URL substring and updates the window pill', () => {
        const { def, $list, fire } = setup({
            tabs: [
                makeTab(1, 0, { title: 'GitHub', active: true }),
                makeTab(2, 1, { title: 'Mail' }),
                makeTab(3, 2, { title: 'git cheatsheet' })
            ]
        });
        def().activate();
        expect($list.innerHTML).toContain('tabgroups-filter-input');
        typeFilter(fire, 'git');
        expect($list.innerHTML).toContain('GitHub');
        expect($list.innerHTML).toContain('git cheatsheet');
        expect($list.innerHTML).not.toContain('>Mail<');
        // the window head pill counts the VISIBLE tabs while filtering
        expect($list.innerHTML).toMatch(/count-pill[^>]*>2<\/span>/);
    });

    it('a filter hit on the GROUP TITLE shows the whole group', () => {
        const { def, $list, fire } = setup({
            tabs: [
                makeTab(1, 0, { title: 'GitHub', active: true }),
                makeTab(2, 1, { groupId: 'g1', title: ' totally unrelated ' }),
                makeTab(3, 2, { groupId: 'g1', title: 'also unrelated' })
            ]
        });
        def().activate();
        typeFilter(fire, 'dev');
        const html = $list.innerHTML;
        expect(html).toContain('totally unrelated');
        expect(html).toContain('also unrelated');
        // the non-matching ungrouped tab stays hidden
        expect(html).not.toContain('>GitHub<');
    });

    it('hides a window section with no matching tab at all', () => {
        const { def, $list, fire } = setup({
            windows: [
                { id: 1, focused: true, tabs: [makeTab(1, 0, { title: 'GitHub', active: true })] },
                { id: 2, focused: false, tabs: [makeTab(9, 0, { title: 'Mail', windowId: 2 })] }
            ]
        });
        def().activate();
        typeFilter(fire, 'github');
        expect($list.innerHTML).toContain('GitHub');
        // window 2's head leaves the flow entirely
        expect($list.innerHTML).not.toContain('data-window-id="2"');
    });

    it('force-expands folded groups and windows while filtering', () => {
        const { def, $list, fire } = setup({
            groups: [makeGroup('g1', 'Dev', 'blue', { collapsed: true })],
            tabs: [
                makeTab(1, 0, { title: 'Home', active: true }),
                makeTab(2, 1, { title: 'GitHub', groupId: 'g1' })
            ]
        });
        def().activate();
        // collapsed group: member row hidden without a filter
        expect($list.innerHTML).not.toContain('tabgroups-item-2');
        typeFilter(fire, 'github');
        expect($list.innerHTML).toContain('tabgroups-item-2');
    });

    it('shows an empty state when nothing matches', () => {
        const { def, $list, fire } = setup({});
        def().activate();
        typeFilter(fire, 'zzz-no-such-tab');
        expect($list.innerHTML).toContain('tabGroupsNoMatchingTabs');
        expect($list.innerHTML).not.toContain('tabgroups-item-');
    });

    it('Esc (the view Esc layer) clears the filter before anything else', () => {
        const { def, $list, fire } = setup({});
        def().activate();
        typeFilter(fire, 'tab 1');
        expect($list.innerHTML).not.toContain('tabgroups-item-2');
        // the document Esc chain owns the key — the view's onEscape is its
        // consumer, and the filter is the innermost level
        expect(def().onEscape()).toBe(true);
        expect($list.innerHTML).toContain('tabgroups-item-2');
        // with no filter and no selection the view does not consume Esc
        expect(def().onEscape()).toBe(false);
    });

    it('entering selection mode clears the filter (batch bar shows every candidate)', () => {
        const { def, $list, fire, clickOn, closestOf } = setup({});
        def().activate();
        typeFilter(fire, 'tab 1');
        expect($list.innerHTML).not.toContain('tabgroups-item-2');
        clickOn({ closest: closestOf({ '.tabgroups-select-mode': { classList: makeClassList() } }) });
        expect($list.innerHTML).toContain('tabgroups-item-2');
        // the batch bar replaces the idle toolbar — the filter input leaves
        // with it, and the filter itself is cleared
        expect($list.innerHTML).not.toContain('tabgroups-filter-input');
        // exiting selection brings the idle toolbar (and the empty filter
        // input) back
        clickOn({ closest: closestOf({ '.tabgroups-select-exit': { classList: makeClassList() } }) });
        expect($list.innerHTML).toContain('tabgroups-filter-input');
        expect($list.innerHTML).toContain('tabgroups-item-2');
    });

    it('disables the fold buttons while a filter is active', () => {
        const { def, $list, fire } = setup({});
        def().activate();
        typeFilter(fire, 'tab');
        expect($list.innerHTML).toContain('class="tabgroups-collapse-all tabgroups-icon-btn" title="tabGroupsCollapseAll" aria-label="tabGroupsCollapseAll" disabled');
        expect($list.innerHTML).toContain('class="tabgroups-expand-all tabgroups-icon-btn" title="tabGroupsExpandAll" aria-label="tabGroupsExpandAll" disabled');
    });

    it('renders the clear-closed icon on the section heading only while records exist', () => {
        const record = { id: 'cg_1', title: 'Dev', color: 'blue', savedAt: Date.now(), tabs: [{ url: 'https://a/', title: 'A' }] };
        const withRec = setup({ storeData: { tabGroupsClosed: JSON.stringify([record]) } });
        withRec.def().activate();
        expect(withRec.$list.innerHTML).toContain('tabgroups-closed-clear');
        // the action moved to the "recently closed" heading row (4.1.0: the
        // toolbar placement read as "clear the filter")
        expect(withRec.$list.innerHTML).toContain('vbm-section-head');
        const without = setup({});
        without.def().activate();
        expect(without.$list.innerHTML).not.toContain('tabgroups-closed-clear');
    });

    it('the filter gets a trailing-edge clear × once it holds text; clicking it clears the filter', () => {
        const { def, $list, fire, clickOn } = setup({});
        def().activate();
        expect($list.innerHTML).not.toContain('tabgroups-filter-clear');
        typeFilter(fire, 'git');
        expect($list.innerHTML).toContain('tabgroups-filter-clear');
        const btn = { classList: makeClassList(), closest: sel => sel === '.tabgroups-filter-clear' ? btn : null };
        clickOn(btn);
        expect($list.innerHTML).not.toContain('tabgroups-filter-clear');
        expect($list.innerHTML).toContain('tabgroups-filter-input');
        // every tab is back in the flow — the filter text is gone
        expect($list.innerHTML).toContain('>Tab 4<');
    });
});

describe('keyboard arrows on group heads and grouped rows', () => {
    it('forward arrow expands a collapsed group; back arrow collapses an open group', () => {
        const { def, $list, fire, doc } = setup({
            groups: [makeGroup('g1', 'Dev', 'blue', { collapsed: true })]
        });
        doc.body.classList.remove('rtl');
        def().activate();
        expect($list.innerHTML).not.toContain('tabgroups-item-2');
        const head = {
            classList: makeClassList(['tabgroups-group-head']),
            closest: sel => sel === 'li' ? { dataset: { groupId: 'g1' } } : null,
            dispatchEvent() {},
            getBoundingClientRect() { return { right: 10, bottom: 20 }; }
        };
        fire('keydown', { key: 'ArrowRight', target: head, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
        expect($list.innerHTML).toContain('tabgroups-item-2');
        fire('keydown', { key: 'ArrowLeft', target: head, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
        expect($list.innerHTML).not.toContain('tabgroups-item-2');
    });

    it('forward arrow on an open group opens the group context menu', () => {
        const { def, fire, doc } = setup({});
        doc.body.classList.remove('rtl');
        def().activate();
        const RealMouseEvent = globalThis.MouseEvent;
        globalThis.MouseEvent = class {
            constructor(type, opts) { this.type = type; Object.assign(this, opts); }
        };
        let dispatched = null;
        const head = {
            classList: makeClassList(['tabgroups-group-head']),
            closest: sel => sel === 'li' ? { dataset: { groupId: 'g1' } } : null,
            dispatchEvent(ev) { dispatched = ev; },
            getBoundingClientRect() { return { right: 10, bottom: 20 }; }
        };
        fire('keydown', { key: 'ArrowRight', target: head, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
        globalThis.MouseEvent = RealMouseEvent;
        expect(dispatched && dispatched.type).toBe('contextmenu');
    });

    it('Space/Enter on the window head row folds and unfolds it', () => {
        const { def, $list, fire, doc } = setup({
            windows: [
                { id: 1, focused: true, tabs: [makeTab(1, 0, { active: true })] }
            ]
        });
        doc.body.classList.remove('rtl');
        def().activate();
        const winHead = { dataset: { windowId: '1' }, classList: makeClassList() };
        const row = {
            classList: makeClassList(['tabgroups-window-head-row']),
            closest: sel => sel === '.tabgroups-window-head-row' ? row : (sel === 'li' ? winHead : null)
        };
        const key = k => fire('keydown', {
            key: k, target: row,
            preventDefault() { this.prevented = true; },
            stopPropagation() {},
            stopImmediatePropagation() {}
        });
        key(' ');
        expect($list.innerHTML).not.toContain('id="tabgroups-item-1"');
        key('Enter');
        expect($list.innerHTML).toContain('id="tabgroups-item-1"');
        // folded + forward opens, open + back folds (the group-head protocol)
        key('ArrowLeft');
        expect($list.innerHTML).not.toContain('id="tabgroups-item-1"');
        key('ArrowRight');
        expect($list.innerHTML).toContain('id="tabgroups-item-1"');
        // …and the swallowed combination never falls through to a menu
        const ev = key('ArrowRight');
        expect(ev.prevented).toBe(true);
    });

    it('Space on a window head toggles the window selection while selecting', () => {
        const { def, $list, fire, clickOn, closestOf, doc } = setup({
            windows: [
                { id: 1, focused: true, tabs: [makeTab(1, 0, { active: true }), makeTab(2, 1)] }
            ]
        });
        doc.body.classList.remove('rtl');
        def().activate();
        clickOn({ closest: closestOf({ '.tabgroups-select-mode': { classList: makeClassList() } }) });
        const winHead = { dataset: { windowId: '1' }, classList: makeClassList() };
        const row = {
            classList: makeClassList(['tabgroups-window-head-row']),
            closest: sel => sel === '.tabgroups-window-head-row' ? row : (sel === 'li' ? winHead : null)
        };
        fire('keydown', {
            key: ' ', target: row,
            preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}
        });
        expect($list.innerHTML).toContain('selectCount[2]');
    });

    it('back arrow on an ungrouped row focuses its window head', () => {
        const { def, $list, fire, doc } = setup({});
        doc.body.classList.remove('rtl');
        def().activate();
        const fakeRow = { focused: false, focus() { this.focused = true; } };
        const headLi = { dataset: { windowId: '1' }, querySelector: sel => sel === '.tabgroups-window-head-row' ? fakeRow : null };
        $list.querySelectorAll = sel => sel === 'li.tabgroups-window-head' ? [headLi] : [];
        const rowLi = { dataset: { tabId: '1', windowId: '1' }, classList: makeClassList() };
        fire('keydown', {
            key: 'ArrowLeft',
            target: { closest: sel => sel === 'li.tabgroups-row' ? rowLi : null },
            preventDefault() {},
            stopPropagation() {},
            stopImmediatePropagation() {}
        });
        expect(fakeRow.focused).toBe(true);
    });

    it('back arrow on a grouped member row focuses its group head', () => {
        const { def, $list, fire, doc } = setup({});
        doc.body.classList.remove('rtl');
        def().activate();
        const fakeHead = { focused: false, focus() { this.focused = true; } };
        $list.querySelector = sel => sel === '#tabgroups-group-g1 .tabgroups-group-head' ? fakeHead : null;
        const rowLi = { dataset: { tabId: '2', groupId: 'g1' }, classList: makeClassList() };
        fire('keydown', {
            key: 'ArrowLeft',
            target: { closest: sel => sel === 'li.tabgroups-row' ? rowLi : null },
            preventDefault() {},
            stopPropagation() {},
            stopImmediatePropagation() {}
        });
        expect(fakeHead.focused).toBe(true);
    });
});

describe('group management (browser-synced)', () => {
    it('group head renders activate/rename/save/sleep/close actions', () => {
        const { def, $list } = setup({});
        def().activate();
        const html = $list.innerHTML;
        expect(html).toContain('tabgroups-group-activate');
        expect(html).toContain('tabgroups-group-rename');
        expect(html).toContain('tabgroups-group-save');
        expect(html).toContain('tabgroups-group-sleep');
        expect(html).toContain('tabgroups-group-close');
        expect(html).toContain('tabGroupsActivateGroup');
        expect(html).toContain('tabGroupsCloseGroup');
    });

    it('activate group focuses the first member tab', () => {
        const { def, chrome, clickOn, closestOf } = setup({});
        def().activate();
        const li = { dataset: { groupId: 'g1' }, classList: makeClassList() };
        const btn = { classList: makeClassList(), closest: sel => sel === 'li' ? li : (sel === '.tabgroups-group-activate' ? btn : null) };
        clickOn(btn);
        expect(chrome.tabs.updateCalls).toEqual([[2, { active: true }]]);
    });

    it('rename group opens the group dialog and updates the browser group', () => {
        const { def, chrome, dialogs, clickOn, closestOf } = setup({});
        def().activate();
        const li = { dataset: { groupId: 'g1' }, classList: makeClassList() };
        const btn = { classList: makeClassList(), closest: sel => sel === 'li' ? li : (sel === '.tabgroups-group-rename' ? btn : null) };
        clickOn(btn);
        expect(dialogs.GroupDialog.openCalls).toHaveLength(1);
        expect(dialogs.GroupDialog.openCalls[0].dialog).toBe('tabGroupsRenameDialog');
        expect(dialogs.GroupDialog.openCalls[0].title).toBe('Dev');
        expect(dialogs.GroupDialog.openCalls[0].color).toBe('blue');
        dialogs.GroupDialog.openCalls[0].onConfirm('Renamed', 'red');
        expect(chrome.tabGroups.updateCalls).toEqual([['g1', { title: 'Renamed', color: 'red' }]]);
    });

    it('close group (single) sends vbm-tabs-close directly with every member id', () => {
        const { def, chrome, dialogs, undo, clickOn, closestOf } = setup({});
        def().activate();
        const li = { dataset: { groupId: 'g1' }, classList: makeClassList() };
        const btn = { classList: makeClassList(), closest: sel => sel === 'li' ? li : (sel === '.tabgroups-group-close' ? btn : null) };
        clickOn(btn);
        expect(dialogs.ConfirmDialog.openCalls).toHaveLength(0);
        expect(chrome.runtime.sendMessageCalls).toEqual([{ type: 'vbm-tabs-close', tabIds: [2, 3] }]);
        expect(undo.toastActionCalls).toHaveLength(1);
        expect(undo.toastActionCalls[0].buttonLabel).toBe('tabGroupsReopenAction');
    });

    it('sleep group (single) sends vbm-tabs-discard directly with every member id', () => {
        const { def, chrome, dialogs, undo, clickOn, closestOf } = setup({});
        def().activate();
        const li = { dataset: { groupId: 'g1' }, classList: makeClassList() };
        const btn = { classList: makeClassList(), closest: sel => sel === 'li' ? li : (sel === '.tabgroups-group-sleep' ? btn : null) };
        clickOn(btn);
        expect(dialogs.ConfirmDialog.openCalls).toHaveLength(0);
        expect(chrome.runtime.sendMessageCalls).toEqual([{ type: 'vbm-tabs-discard', tabIds: [2, 3] }]);
        expect(undo.toastActionCalls).toHaveLength(1);
        expect(undo.toastActionCalls[0].buttonLabel).toBe('tabGroupsWakeAction');
    });

    it('collapse/expand is local-only by default (sync option off)', () => {
        const { def, chrome, clickOn, closestOf } = setup({});
        def().activate();
        const li = { dataset: { groupId: 'g1' }, classList: makeClassList() };
        const head = { classList: makeClassList(), closest: sel => sel === 'li' ? li : (sel === '.tabgroups-group-head' ? head : null) };
        clickOn(head);
        expect(chrome.tabGroups.updateCalls).toEqual([]);
    });

    it('collapse/expand syncs to the browser when the sync option is on', () => {
        const { def, chrome, clickOn, closestOf } = setup({ storeData: { tabGroupsSyncCollapse: '1' } });
        def().activate();
        const li = { dataset: { groupId: 'g1' }, classList: makeClassList() };
        const head = { classList: makeClassList(), closest: sel => sel === 'li' ? li : (sel === '.tabgroups-group-head' ? head : null) };
        clickOn(head);
        expect(chrome.tabGroups.updateCalls).toEqual([['g1', { collapsed: true }]]);
    });

    it('moveGroupToNewWindow sends every member to a new window via SW', () => {
        const { def, chrome, viewTabGroups } = setup({});
        def().activate();
        viewTabGroups.moveGroupToNewWindow('g1');
        expect(chrome.runtime.sendMessageCalls).toEqual([
            { type: 'vbm-tabs-move-new-window', tabIds: [2, 3] }
        ]);
    });

    it('ungroupGroup removes the group but keeps the tabs', () => {
        const { def, chrome, viewTabGroups } = setup({});
        def().activate();
        viewTabGroups.ungroupGroup('g1');
        expect(chrome.tabs.ungroupCalls).toEqual([2, 3]);
    });

    it('refresh seeds collapsed state from the browser groups', () => {
        const { def, $list } = setup({ groups: [makeGroup('g1', 'Dev', 'blue', { collapsed: true })] });
        def().activate();
        // collapsed group hides its member rows
        expect($list.innerHTML).not.toContain('tabgroups-item-2');
        expect($list.innerHTML).toContain('collapsed');
    });
});

describe('drag sorting', () => {
    it('drop on another row calls chrome.tabs.move with the target index', () => {
        const { def, chrome, $list, fire, closestOf } = setup({});
        def().activate();
        const sourceLi = { dataset: { tabId: '1' }, classList: makeClassList() };
        fire('dragstart', {
            target: { closest: closestOf({ 'li.tabgroups-row': sourceLi }) },
            dataTransfer: { setData() {} }
        });
        const targetTab = { id: 4, index: 3 };
        const targetLi = { dataset: { tabId: '4' }, classList: makeClassList() };
        fire('drop', {
            preventDefault() {},
            target: { closest: closestOf({ 'li.tabgroups-row': targetLi }) },
            dataTransfer: {}
        });
        expect(chrome.tabs.moveCalls).toHaveLength(1);
        expect(chrome.tabs.moveCalls[0]).toEqual([1, { windowId: 1, index: 3 }]);
        // no move when dropping on itself
        fire('dragstart', {
            target: { closest: closestOf({ 'li.tabgroups-row': sourceLi }) },
            dataTransfer: { setData() {} }
        });
        fire('drop', {
            preventDefault() {},
            target: { closest: closestOf({ 'li.tabgroups-row': sourceLi }) },
            dataTransfer: {}
        });
        expect(chrome.tabs.moveCalls).toHaveLength(1);
    });
});

describe('selection mode folding + row icon parity', () => {
    it('entering selection mode opens every fold and leaving restores them', () => {
        const { def, $list, clickOn, closestOf, store } = setup({
            storeData: { tabGroupsViewState: JSON.stringify({ windowChoices: { 2: true }, collapsedGroups: ['g1'] }) },
            windows: [
                { id: 1, focused: true, tabs: [makeTab(1, 0, { active: true, groupId: 'g1' }), makeTab(2, 1, { groupId: 'g1' })] },
                { id: 2, focused: false, tabs: [makeTab(10, 0, { windowId: 2 })] }
            ],
            groups: [makeGroup('g1', 'Dev', 'blue', { windowId: 1 })]
        });
        def().activate();
        // folded group + folded window 2
        expect($list.innerHTML).not.toContain('id="tabgroups-item-1"');
        expect($list.innerHTML).not.toContain('id="tabgroups-item-10"');
        clickOn({ closest: closestOf({ '.tabgroups-select-mode': { classList: makeClassList() } }) });
        // everything is visible: a batch bar must show its candidates
        expect($list.innerHTML).toContain('id="tabgroups-item-1"');
        expect($list.innerHTML).toContain('id="tabgroups-item-10"');
        // …and the transient all-open state is never persisted
        const ui = JSON.parse(store._data.tabGroupsViewState || '{}');
        expect(ui.collapsedGroups).toEqual(['g1']);
        expect(ui.windowChoices).toEqual({ 2: true });
        clickOn({ closest: closestOf({ '.tabgroups-select-exit': { classList: makeClassList() } }) });
        expect($list.innerHTML).not.toContain('id="tabgroups-item-1"');
        expect($list.innerHTML).not.toContain('id="tabgroups-item-10"');
    });

    it('a refresh during selection mode keeps the folds open', () => {
        const { def, $list, clickOn, closestOf, viewTabGroups } = setup({
            storeData: { tabGroupsViewState: JSON.stringify({ collapsedGroups: ['g1'] }) }
        });
        def().activate();
        clickOn({ closest: closestOf({ '.tabgroups-select-mode': { classList: makeClassList() } }) });
        expect($list.innerHTML).toContain('id="tabgroups-item-2"');
        viewTabGroups.refresh();
        expect($list.innerHTML).toContain('id="tabgroups-item-2"');
    });

    it('selection-mode rows keep the four icon columns as inert state markers', () => {
        const { def, $list, clickOn, closestOf } = setup({
            tabs: [
                makeTab(1, 0, { active: true, pinned: true }),
                makeTab(2, 1, { discarded: true })
            ],
            bookmarkTree: [{ id: '0', title: '', children: [{ id: '1', title: 'Bar', children: [
                { id: '11', title: 'T1', url: 'https://t1.example/' }
            ] }] }]
        });
        def().activate();
        clickOn({ closest: closestOf({ '.tabgroups-select-mode': { classList: makeClassList() } }) });
        const html = $list.innerHTML;
        // no live row controls…
        expect(html).not.toContain('row-btn');
        // …but the same four columns per row (markers + reserved slots), so
        // the bookmarked ★ column cannot shift its neighbours' glyphs
        const rowOf = id => {
            const start = html.indexOf(`id="tabgroups-item-${id}"`);
            return html.slice(start, html.indexOf('</li>', start));
        };
        for (const id of [1, 2]) {
            const row = rowOf(id);
            const slots = (row.match(/tabgroups-slot|tabgroups-status-icon|tabgroups-star/g) || []);
            expect(slots).toHaveLength(4);
        }
        expect(rowOf(1)).toContain('tabgroups-status-icon pinned');
        expect(rowOf(1)).toContain('tabgroups-star');
        expect(rowOf(2)).toContain('tabgroups-status-icon discarded');
    });
});

describe('group color style', () => {
    it('defaults to the connector line (4.1.0 polish: line reads best and makes membership unambiguous)', () => {
        const { def, $list } = setup({});
        def().activate();
        expect($list.innerHTML).not.toContain('color-enhanced');
        expect($list.innerHTML).toContain('class="color-line"');
        expect($list.innerHTML).toContain('tg-connector');
    });

    it('edge style marks the list color-enhanced', () => {
        const { def, $list } = setup({ storeData: { tabGroupsColorStyle: 'edge' } });
        def().activate();
        expect($list.innerHTML).toContain('class="color-enhanced"');
        expect($list.innerHTML).not.toContain('tg-connector');
    });

    it('the legacy boolean key still reads as the edge style', () => {
        const { def, $list } = setup({ storeData: { tabGroupsColorBorder: '1' } });
        def().activate();
        expect($list.innerHTML).toContain('color-enhanced');
    });

    it('line style adds a connector per member row and marks the last one', () => {
        const { def, $list } = setup({ storeData: { tabGroupsColorStyle: 'line' } });
        def().activate();
        const html = $list.innerHTML;
        expect(html).toContain('class="color-line"');
        // two members in group g1 → two connectors, the second one closing
        expect((html.match(/tg-connector/g) || [])).toHaveLength(2);
        expect(html).toContain('tg-last');
        // ungrouped rows never carry one
        const start = html.indexOf('id="tabgroups-item-4"');
        expect(html.slice(start, html.indexOf('</li>', start))).not.toContain('tg-connector');
    });
});

describe('recently closed records', () => {
    const record = () => ({
        id: 'ct_1',
        type: 'tab',
        title: 'Closed one',
        url: 'https://closed.example/',
        windowId: 1,
        savedAt: Date.UTC(2024, 0, 2, 3, 4, 5),
        tabs: [{ title: 'Closed one', url: 'https://closed.example/' }]
    });

    it('renders the relative close time inline; the absolute time lives in the tooltip (single-line history strip)', () => {
        const metas = [];
        const { def } = setup({
            storeData: { tabGroupsClosed: JSON.stringify([record()]) },
            metaSink: metas
        });
        def().activate();
        const closedMeta = metas.find(m => m && m.rightText);
        expect(closedMeta).toBeTruthy();
        expect(typeof closedMeta.rightText).toBe('string');
        // 4.1.0 coordination pass: the wide-mode second line is gone — a
        // standalone record stays single-line next to the closed heads
        // (the absolute time rides the tooltip instead)
        expect(closedMeta.subRight).toBeUndefined();
        expect(closedMeta.tooltipAppend).toContain('tabGroupsClosedTimeLabel');
        expect(closedMeta.tooltipAppend).toContain(new Date(Date.UTC(2024, 0, 2, 3, 4, 5)).toLocaleString());
    });

    it('openClosedTab prefers the window the tab was closed in', () => {
        const { def, chrome, viewTabGroups } = setup({
            storeData: { tabGroupsClosed: JSON.stringify([record()]) }
        });
        def().activate();
        chrome.windows.get = (id, cb) => cb({ id });
        const created = [];
        chrome.tabs.create = props => created.push(props);
        viewTabGroups.openClosedTab('ct_1', 0);
        expect(created).toEqual([{ url: 'https://closed.example/', active: false, windowId: 1 }]);
    });

    it('exposes the record state the closed context menus need', () => {
        const { def, viewTabGroups } = setup({
            storeData: { tabGroupsClosed: JSON.stringify([record()]) }
        });
        def().activate();
        expect(viewTabGroups.closedRecordType('ct_1')).toBe('tab');
        expect(viewTabGroups.closedTabCount('ct_1')).toBe(1);
        expect(viewTabGroups.isClosedExpanded('ct_1')).toBe(false);
        viewTabGroups.toggleClosedExpanded('ct_1');
        expect(viewTabGroups.isClosedExpanded('ct_1')).toBe(true);
        expect(viewTabGroups.closedRecordType('nope')).toBe(null);
    });

    it('expanded closed-group members carry the member indent class; standalone records do not', () => {
        const groupRec = {
            id: 'cg_9', type: 'group', title: 'Old group', color: 'grey',
            savedAt: Date.now(),
            tabs: [{ title: 'A', url: 'https://a.example/' }]
        };
        const { def, $list, viewTabGroups } = setup({
            storeData: { tabGroupsClosed: JSON.stringify([groupRec, record()]) }
        });
        def().activate();
        // collapsed by default: no member rows yet
        expect($list.innerHTML).not.toContain('tabgroups-closed-member');
        viewTabGroups.toggleClosedExpanded('cg_9');
        const html = $list.innerHTML;
        // the group's member row indents like a live grouped row…
        expect(html).toContain('tabgroups-closed-member');
        // …while the standalone closed-tab record stays level with the heads
        const standaloneStart = html.indexOf('data-closed-id="ct_1"');
        const standaloneRow = html.lastIndexOf('<li', standaloneStart);
        expect(html.slice(standaloneRow, standaloneStart)).not.toContain('tabgroups-closed-member');
    });

    it('the standalone record leads with a reopen button (not the ☆); members keep the ☆', () => {
        const groupRec = {
            id: 'cg_9', type: 'group', title: 'Old group', color: 'grey',
            savedAt: Date.now(),
            tabs: [{ title: 'A', url: 'https://a.example/' }]
        };
        const { def, $list, chrome, store, clickOn, viewTabGroups } = setup({
            storeData: { tabGroupsClosed: JSON.stringify([groupRec, record()]) }
        });
        def().activate();
        viewTabGroups.toggleClosedExpanded('cg_9');
        const html = $list.innerHTML;
        const standaloneRow = html.slice(html.lastIndexOf('<li', html.indexOf('data-closed-id="ct_1"')),
            html.indexOf('</li>', html.indexOf('data-closed-id="ct_1"')));
        expect(standaloneRow).toContain('tabgroups-closed-reopen');
        expect(standaloneRow).not.toContain('tabgroups-closed-add-bookmark');
        // the expanded group's MEMBER row keeps the hover ☆ pair
        expect(html).toContain('tabgroups-closed-add-bookmark');
        // clicking reopen opens the tab in the background and drops the record
        const li = { dataset: { closedId: 'ct_1' }, classList: makeClassList() };
        const btn = {
            classList: makeClassList(['tabgroups-closed-reopen']),
            closest: sel => sel === 'li' ? li : (sel === '.tabgroups-closed-reopen' ? btn : null)
        };
        clickOn(btn);
        expect(chrome.tabs.createCalls).toEqual([{ url: 'https://closed.example/', active: false }]);
        expect(JSON.parse(store._data.tabGroupsClosed).map(r => r.id)).toEqual(['cg_9']);
    });
});

describe('escaping + stale-tab guards (4.1.0 merge review)', () => {
    it('escapes tab and group titles/URLs in the rendered HTML', () => {
        const { def, $list } = setup({
            tabs: [
                makeTab(1, 0, { title: '<img src=x onerror=alert(1)> "quoted"', url: 'https://evil.example/?a=<b>&c="d"' }),
                makeTab(2, 1, { groupId: 'g1', title: '<script>alert(2)</script>' })
            ],
            groups: [makeGroup('g1', '<b>Dev</b> & "friends"', 'blue')]
        });
        def().activate();
        const html = $list.innerHTML;
        // No raw markup from tab/group data may survive into innerHTML.
        expect(html).not.toContain('<img src=x');
        expect(html).not.toContain('<script>alert(2)');
        expect(html).not.toContain('<b>Dev</b>');
        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
        expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
        expect(html).toContain('&lt;b&gt;Dev&lt;/b&gt; &amp; &quot;friends&quot;');
    });

    it('passes a lastError-swallowing callback on every chrome.tabs.update/move of a snapshot id', () => {
        const { def, viewTabGroups, chrome } = setup({});
        def().activate();
        const seen = [];
        const origUpdate = chrome.tabs.update.bind(chrome.tabs);
        chrome.tabs.update = (id, props, cb) => { seen.push(cb); origUpdate(id, props, cb); };
        // activateTab goes through the snapshot — the callback must exist so a
        // vanished tab never logs an unchecked runtime.lastError.
        viewTabGroups.activateTab(1);
        expect(seen.length).toBe(1);
        expect(typeof seen[0]).toBe('function');
    });
});

describe('narrow-width de-crowding contracts (4.1.0 P1, CSS)', () => {
    it('the current-tab text pill hides below a 400px container — the row tint carries the meaning', async () => {
        const fs = (await import('node:fs')).default;
        const neatCss = fs.readFileSync(new URL('../css/neat.css', import.meta.url), 'utf8');
        // one nesting level of inner rules inside the container query block
        const query = neatCss.match(/@container \(max-width: 400px\) \{((?:[^{}]|\{[^{}]*\})*)\}/);
        expect(query, '400px container query exists').toBeTruthy();
        expect(query[1]).toContain('#tabgroups-list .row-badge.current');
        expect(query[1]).toContain('display: none');
        // …and the compensating tint exists on the row itself
        expect(neatCss).toContain('li.tabgroups-row.tabgroups-current {');
        expect(neatCss).toContain('color-mix(in srgb, var(--vbm-accent) 8%, transparent)');
        // 4.1.0 polish E: the group head's group-specific buttons (activate /
        // rename) collapse under the same threshold — F2 rename and the →
        // context menu keep them reachable; the row-aligned tail stays
        expect(query[1]).toContain('#tabgroups-list .tabgroups-group-head .tabgroups-group-activate,');
        expect(query[1]).toContain('#tabgroups-list .tabgroups-group-head .tabgroups-group-rename');
    });

    it('the window label (em) stretches, so the pill cluster right-aligns on EVERY window head', async () => {
        // regression guard: an auto margin living only on the current-window
        // pill used to pull NON-current windows' count pills onto the label.
        const fs = (await import('node:fs')).default;
        const neatCss = fs.readFileSync(new URL('../css/neat.css', import.meta.url), 'utf8');
        const body = neatCss.slice(
            neatCss.indexOf('#tabgroups-list ul li.tabgroups-window-head em {'));
        expect(body.slice(0, body.indexOf('}'))).toContain('flex: 1');
    });
});

describe('staging interop (velvet staging §2.5)', () => {
    const stagingApi = () => {
        const calls = [];
        return {
            calls,
            addItems: (entries, opts) => {
                calls.push(['add', entries, opts]);
                return { full: false, added: entries, dupes: [] };
            },
            isStaged: () => false,
            state: () => ({ items: [], groups: [] })
        };
    };

    it('stageTabById resolves or creates the tree anchor, then stages it', () => {
        const staging = stagingApi();
        const ctx = setup({ stagingApi: staging });
        const found = [{ id: '77', url: 'https://t1.example/' }]; // tab 1's URL
        const creates = [];
        ctx.chrome.bookmarks.search = (q, cb) => cb(found.splice(0, 1).length ? [{ id: '77', url: q.url }] : []);
        ctx.chrome.bookmarks.create = (props, cb) => { creates.push(props); cb({ id: 'n1', ...props }); };
        ctx.viewTabGroups.refresh(); // seed tabs
        // tab 1's URL exists in the tree → anchored, no create
        ctx.viewTabGroups.stageTabById('1');
        expect(staging.calls).toEqual([['add', [{ id: '77', url: 'https://t1.example/', title: 'Tab 1' }], undefined]]);
        expect(ctx.chrome.bookmarks.createCalls.length).toBe(0);
        // tab 4's URL is nowhere → create into the quick-add folder, then stage
        ctx.viewTabGroups.stageTabById('4');
        expect(staging.calls).toHaveLength(2);
        expect(staging.calls[1][1][0].id).toBe('n1');
        expect(staging.calls[1][1][0].url).toBe('https://t4.example/');
        expect(creates).toEqual([{ title: 'Tab 4', url: 'https://t4.example/', parentId: '1' }]);
    });

    it('stageTabGroup collects bookmarkable members into a sourceTabGroup group', () => {
        const staging = stagingApi();
        const ctx = setup({ stagingApi: staging });
        ctx.chrome.bookmarks.search = (q, cb) => cb([]);
        ctx.chrome.bookmarks.create = (props, cb) => cb({ id: 'c' + Math.random(), ...props });
        ctx.viewTabGroups.refresh();
        // group g1 holds tabs 2+3 (both bookmarkable)
        ctx.viewTabGroups.stageTabGroup('g1', 'Work');
        expect(staging.calls).toHaveLength(1);
        const [tag, entries, opts] = staging.calls[0];
        expect(tag).toBe('add');
        expect(entries.map(e => e.url).sort()).toEqual(['https://t2.example/', 'https://t3.example/']);
        expect(entries.every(e => e.id)).toBe(true); // all created + anchored
        void opts;
    });

    it('resolveTabBookmark keeps the classic addTabToBookmarks flow intact (id-return compat)', () => {
        const ctx = setup({});
        const creates = [];
        ctx.chrome.bookmarks.search = (q, cb) => cb([]);
        ctx.chrome.bookmarks.create = (props, cb) => { creates.push(props); cb({ id: 'n9', ...props }); };
        ctx.viewTabGroups.refresh();
        // the ★ path (addTabToBookmarks) still works — it toasts the folder
        ctx.viewTabGroups.addBookmark('2');
        expect(creates).toHaveLength(1);
        expect(creates[0].url).toBe('https://t2.example/');
    });
});
