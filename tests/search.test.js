import { describe, it, expect, beforeAll } from 'vitest';

// search.js touches page globals (document/window/chrome) only inside
// initSearch, so the real module imports cleanly in node once the globals
// are stubbed. DOM behavior is driven through the same listeners the page
// uses; the ctx helpers (generateBookmarkHTML / highlightTitlePositions /
// switchBookmarkMenu / separatorManager) are test doubles recording their
// calls — no implementation copied from neat.js.

const makeClassList = () => {
    const set = new Set();
    return {
        add: (...cs) => cs.forEach(c => set.add(c)),
        remove: (...cs) => cs.forEach(c => set.delete(c)),
        toggle(c, force) {
            const on = force === undefined ? !set.has(c) : !!force;
            if (on) set.add(c); else set.delete(c);
            return on;
        },
        contains: c => set.has(c),
        _set: set
    };
};

const makeEl = () => ({
    innerHTML: '',
    value: '',
    style: {},
    dataset: {},
    scrollLeft: 0,
    scrollTop: 0,
    selectionEnd: 0,
    offsetTop: 0,
    offsetHeight: 0,
    parentElement: null,
    parentNode: null,
    firstElementChild: null,
    focused: false,
    selected: false,
    listeners: {},
    _qs: {},
    _qsa: {},
    classList: makeClassList(),
    setAttribute(k, v) {
        (this._attrs = this._attrs || {})[k] = v;
    },
    getAttribute(k) {
        const a = this._attrs || {};
        return k in a ? a[k] : null;
    },
    addEventListener(type, fn) {
        (this.listeners[type] = this.listeners[type] || []).push(fn);
    },
    trigger(type, event = {}) {
        event.preventDefault = event.preventDefault || (() => {
            event.defaultPrevented = true;
        });
        (this.listeners[type] || []).forEach(fn => fn(event));
    },
    focus() {
        this.focused = true;
    },
    select() {
        this.selected = true;
    },
    dispatchEvent(ev) {
        this.dispatched = (this.dispatched || []).concat(ev);
        return true;
    },
    querySelector(sel) {
        return this._qs[sel] || null;
    },
    querySelectorAll(sel) {
        return this._qsa[sel] || [];
    }
});

// Root node has no parentId (skipped); 'sep' is a separator (excluded);
// Folder A is a folder (included with isFolder).
const TREE = [{
    id: '0',
    title: '',
    children: [
        {
            id: '1', parentId: '0', title: 'Folder A', dateAdded: 5, children: [
                { id: '11', parentId: '1', title: 'GitHub', url: 'https://github.com/', dateAdded: 10 },
                { id: '12', parentId: '1', title: 'sep', url: 'http://separatethis.com/x', dateAdded: 11 }
            ]
        },
        { id: '2', parentId: '0', title: 'HN', url: 'https://news.ycombinator.com/', dateAdded: 6 }
    ]
}];

const makeStore = (data = {}) => ({
    _data: { ...data },
    get(key) {
        return this._data[key];
    },
    set(key, v) {
        this._data[key] = v;
    },
    getSyncSetting(key, dflt) {
        return key in this._data ? this._data[key] : dflt;
    }
});

const makeChrome = () => {
    const dirtyListeners = { onCreated: [], onRemoved: [], onChanged: [], onMoved: [] };
    return {
        i18n: { getMessage: (key, subs) => subs ? `${key}[${[].concat(subs).join('|')}]` : key },
        bookmarks: {
            getTreeCalls: 0,
            getCalls: [],
            getTree(cb) {
                this.getTreeCalls++;
                cb(TREE);
            },
            get(id, cb) {
                this.getCalls.push(id);
                cb([{ title: `parent-of-${id}` }]);
            },
            onCreated: { addListener: fn => dirtyListeners.onCreated.push(fn) },
            onRemoved: { addListener: fn => dirtyListeners.onRemoved.push(fn) },
            onChanged: { addListener: fn => dirtyListeners.onChanged.push(fn) },
            onMoved: { addListener: fn => dirtyListeners.onMoved.push(fn) }
        },
        fireDirty(name = 'onCreated') {
            dirtyListeners[name].forEach(fn => fn());
        }
    };
};

let initSearch;

beforeAll(async () => {
    globalThis.MouseEvent = class {
        constructor(type, opts) {
            this.type = type;
            Object.assign(this, opts);
        }
    };
    ({ initSearch } = await import('../src/search.js'));
});

const setup = (opts = {}) => {
    const els = {
        tree: makeEl(),
        results: makeEl(),
        search: makeEl(),
        'search-input': makeEl(),
        'search-clear': makeEl(),
        ...(opts.extraEls || {})
    };
    // search.js reaches the row through the clear button's parentNode
    els['search-clear'].parentNode = els.search;
    const bodyClasses = makeClassList();
    globalThis.document = {
        getElementById: id => els[id] || null,
        body: { classList: bodyClasses }
    };
    const fuzzy = {
        calls: [],
        results: opts.fuzzyResults || [],
        rank(query, index) {
            this.calls.push({ query, index });
            return this.results;
        }
    };
    globalThis.window = { VBMFuzzy: fuzzy, addEventListener: () => {} };
    if (opts.syncManager)
        globalThis.window.syncManager = opts.syncManager;
    const chromeStub = makeChrome();
    globalThis.chrome = chromeStub;
    const store = makeStore(opts.storeData || {});
    const calls = { switchBookmarkMenu: [], generateBookmarkHTML: [], highlightTitlePositions: [] };
    // v4 task-2: the display swap is replaced by the view layer. The double
    // records activate() calls and captures the hooks search.js attaches to
    // the structural 'search' view.
    const viewCalls = [];
    const viewHooks = {};
    const views = {
        activate: (id, o) => viewCalls.push([id, o]),
        activeId: () => opts.activeView || 'tree',
        isActive: id => (opts.activeView || 'tree') === id,
        attach: (id, hooks) => {
            viewHooks[id] = hooks;
        },
        pathOf: opts.pathOf || (() => '')
    };
    const s = initSearch({
        store,
        separatorManager: { isSeparator: (title, url) => url.includes('separatethis') },
        switchBookmarkMenu: disable => calls.switchBookmarkMenu.push(disable),
        generateBookmarkHTML: (title, url, extras, id, positions, meta) => {
            calls.generateBookmarkHTML.push({ title, url, extras, id, positions, meta });
            return `<a href="${url}" data-id="${id}">${title}</a>`;
        },
        highlightTitlePositions: (title, positions) => {
            calls.highlightTitlePositions.push({ title, positions });
            return positions && positions.length ? `<mark>${title}</mark>` : title;
        },
        rememberState: !!opts.rememberState,
        views
    });
    return { s, els, store, chrome: chromeStub, fuzzy, calls, bodyClasses, viewCalls, viewHooks };
};

const type = (els, value) => {
    els['search-input'].value = value;
    els['search-input'].trigger('input');
};

describe('search execution + rendering', () => {
    it('ranks the flat index and renders bookmark + folder rows', () => {
        const { s, els, fuzzy, calls, store, viewCalls } = setup({
            fuzzyResults: [
                { id: '11', parentId: '1', title: 'GitHub', url: 'https://github.com/', isFolder: false, positions: [0, 1] },
                { id: '1', parentId: '0', title: 'Folder A', isFolder: true, positions: [] }
            ]
        });
        type(els, 'git');
        expect(s.isActive()).toBe(true);
        expect(fuzzy.calls).toHaveLength(1);
        expect(fuzzy.calls[0].query).toBe('git');
        // index: invisible root skipped, separator excluded, folder included
        expect(fuzzy.calls[0].index).toEqual([
            { id: '1', parentId: '0', title: 'Folder A', url: '', dateAdded: 5, isFolder: true },
            { id: '11', parentId: '1', title: 'GitHub', url: 'https://github.com/', dateAdded: 10, isFolder: false },
            { id: '2', parentId: '0', title: 'HN', url: 'https://news.ycombinator.com/', dateAdded: 6, isFolder: false }
        ]);
        const html = els.results.innerHTML;
        expect(html).toContain('<ul role="list">');
        expect(html).toContain('id="results-item-11"');
        expect(html).toContain('<li class="vbm-row"'); // §3 row anatomy
        expect(html).toContain('href="https://github.com/"');
        expect(calls.generateBookmarkHTML[0]).toEqual({
            title: 'GitHub', url: 'https://github.com/', extras: '', id: '11',
            positions: [0, 1], meta: { path: '' }
        });
        expect(html).toContain('class="link-folder tree-item-link"');
        expect(html).toContain('id="results-item-1"');
        expect(calls.highlightTitlePositions).toEqual([{ title: 'Folder A', positions: [] }]);
        // v4 task-2: typing drives the search view active (keepFocus — the
        // keystroke owns the input); the old #tree/#results display swap is gone
        expect(viewCalls).toEqual([['search', { keepFocus: true }]]);
        expect(calls.switchBookmarkMenu).toEqual([true]);
        expect(store.get('searchQuery')).toBe('git');
    });

    it('trims the query before persisting and ranking', () => {
        const { els, store, fuzzy } = setup({});
        type(els, '  git  ');
        expect(store.get('searchQuery')).toBe('git');
        expect(fuzzy.calls[0].query).toBe('git');
    });

    it('renders the empty-state row when nothing matches', () => {
        const { els } = setup({ fuzzyResults: [] });
        type(els, 'zzz');
        expect(els.results.innerHTML).toContain(
            '<li class="empty-state" role="listitem"><i>searchNoResults</i></li>');
    });

    it('falls back to the noTitle message for untitled folders', () => {
        const { els, calls } = setup({
            fuzzyResults: [{ id: '3', parentId: '0', title: '', isFolder: true, positions: [] }]
        });
        type(els, 'x');
        expect(els.results.innerHTML).toContain('<i>noTitle</i>');
        expect(calls.highlightTitlePositions).toEqual([]);
    });

    it('renders the sync indicator on folder rows when syncManager is present', () => {
        const { els } = setup({
            storeData: { showSyncStatus: 'true' },
            syncManager: { getSyncStatusIndicator: () => 'synced', getSyncTooltip: () => 'tip' },
            fuzzyResults: [{ id: '1', parentId: '0', title: 'Folder A', isFolder: true, positions: [] }]
        });
        type(els, 'fol');
        expect(els.results.innerHTML).toContain('sync-indicator synced');
        expect(els.results.innerHTML).toContain('sync-tooltip');
    });

    it('feeds row path labels + unified tooltips from views.pathOf (§3.6)', () => {
        const { els, calls, chrome } = setup({
            pathOf: id => `path-of-${id}`,
            fuzzyResults: [
                { id: '11', parentId: '1', title: 'GitHub', url: 'https://github.com/', isFolder: false, positions: [] },
                { id: '1', parentId: '0', title: 'Folder A', isFolder: true, positions: [] }
            ]
        });
        type(els, 'git');
        // bookmark rows: the path flows into the row meta (tooltip + label
        // are rendered inside tree-render's generateBookmarkHTML)
        expect(calls.generateBookmarkHTML[0].meta).toEqual({ path: 'path-of-11' });
        // folder rows: tooltip unifies to 标题 + 路径
        expect(els.results.innerHTML).toContain('title="Folder A\npath-of-1"');
        // the async per-row parent-folder tooltip fetch is retired — the
        // path map covers it in one tree walk
        expect(chrome.bookmarks.getCalls).toEqual([]);
    });

    it('renders the empty-query hint when the search view activates without a query', () => {
        const { els, viewHooks } = setup({});
        viewHooks.search.activate();
        expect(els.results.innerHTML).toContain(
            '<li class="empty-state" role="listitem"><i>searchViewHint</i></li>');
        // a filled input keeps its current results instead
        els.results.innerHTML = 'x';
        els['search-input'].value = 'git';
        viewHooks.search.activate();
        expect(els.results.innerHTML).toBe('x');
    });

    it('the search view focus hook focuses the input', () => {
        const { els, viewHooks } = setup({});
        viewHooks.search.focus();
        expect(els['search-input'].focused).toBe(true);
    });
});

describe('flat index lifecycle', () => {
    it('builds lazily, reuses the cache, rebuilds on bookmark events', () => {
        const { els, chrome, s } = setup({});
        type(els, 'a');
        expect(chrome.bookmarks.getTreeCalls).toBe(1);
        type(els, 'ab'); // cached
        expect(chrome.bookmarks.getTreeCalls).toBe(1);
        chrome.fireDirty('onRemoved');
        type(els, 'abc'); // dirty → rebuild
        expect(chrome.bookmarks.getTreeCalls).toBe(2);
        type(els, 'abcd'); // fresh again
        expect(chrome.bookmarks.getTreeCalls).toBe(2);
        expect(s.isActive()).toBe(true);
    });

    it('updateIndex feeds a fresh index and clears the dirty flag', () => {
        const { els, chrome, fuzzy, s } = setup({});
        type(els, 'a');
        expect(chrome.bookmarks.getTreeCalls).toBe(1);
        chrome.fireDirty('onChanged');
        s.updateIndex([{ id: '9', title: 'rootless' }]); // no parentId → empty index
        type(els, 'ab');
        expect(chrome.bookmarks.getTreeCalls).toBe(1); // no rebuild despite the event
        expect(fuzzy.calls[fuzzy.calls.length - 1].index).toEqual([]);
    });

    it('skips identical consecutive queries; quit() resets the dedupe', () => {
        const { els, fuzzy, s } = setup({});
        type(els, 'git');
        type(els, 'git');
        expect(fuzzy.calls).toHaveLength(1);
        s.quit();
        type(els, 'git');
        expect(fuzzy.calls).toHaveLength(2);
    });
});

describe('quit / reset semantics', () => {
    it('quit() clears input + persisted query, restores the menu and returns to the source view', () => {
        const { s, els, store, calls, viewCalls } = setup({});
        type(els, 'git');
        s.quit();
        expect(s.isActive()).toBe(false);
        expect(els['search-input'].value).toBe('');
        expect(store.get('searchQuery')).toBe('');
        expect(calls.switchBookmarkMenu).toEqual([true, false]);
        // the focus restore itself lives in view-manager's focusDefault
        expect(viewCalls).toEqual([
            ['search', { keepFocus: true }],
            ['tree', { keepFocus: false }]
        ]);
    });

    it('quit() returns to the view the search was started from', () => {
        const { s, els, viewCalls } = setup({ activeView: 'recent' });
        type(els, 'git');
        expect(viewCalls).toEqual([['search', { keepFocus: true }]]);
        s.quit();
        expect(viewCalls[1]).toEqual(['recent', { keepFocus: false }]);
    });

    it('quit(true) returns with keepFocus (the input keeps the focus)', () => {
        const { s, els, viewCalls } = setup({});
        type(els, 'x');
        s.quit(true);
        expect(s.isActive()).toBe(false);
        expect(viewCalls[1]).toEqual(['tree', { keepFocus: true }]);
    });

    it('quit() while inactive is a no-op', () => {
        const { s, els, store, calls, viewCalls } = setup({});
        els['search-input'].value = 'draft';
        s.quit();
        expect(els['search-input'].value).toBe('draft');
        expect(store.get('searchQuery')).toBeUndefined();
        expect(calls.switchBookmarkMenu).toEqual([]);
        expect(viewCalls).toEqual([]);
    });

    it('reset() drops query state without leaving the search view', () => {
        const { s, els, store, calls, fuzzy, viewCalls } = setup({});
        type(els, 'git');
        s.reset();
        expect(s.isActive()).toBe(false);
        expect(els['search-input'].value).toBe('');
        expect(store.get('searchQuery')).toBe('');
        expect(calls.switchBookmarkMenu).toEqual([true, false]);
        // unlike quit(): no return activation, the popup stays where it is
        expect(viewCalls).toEqual([['search', { keepFocus: true }]]);
        // prevValue was cleared, so the same query runs again
        type(els, 'git');
        expect(fuzzy.calls).toHaveLength(2);
        expect(s.isActive()).toBe(true);
    });

    it('reset() while inactive is a no-op', () => {
        const { s, els, store, calls } = setup({});
        els['search-input'].value = 'draft';
        s.reset();
        expect(els['search-input'].value).toBe('draft');
        expect(store.get('searchQuery')).toBeUndefined();
        expect(calls.switchBookmarkMenu).toEqual([]);
    });
});

describe('input listeners', () => {
    it('clearing the input exits search mode keeping the focus on the input', () => {
        const { s, els, store, calls, viewCalls } = setup({});
        type(els, 'git');
        expect(s.isActive()).toBe(true);
        type(els, '');
        expect(s.isActive()).toBe(false);
        expect(store.get('searchQuery')).toBe('');
        expect(viewCalls).toEqual([
            ['search', { keepFocus: true }],
            ['tree', { keepFocus: true }] // quit(true): keep focus on input
        ]);
        expect(calls.switchBookmarkMenu).toEqual([true, false]);
    });

    it('clear button wipes the query, exits search mode and refocuses the input', () => {
        const { s, els, store, viewCalls } = setup({});
        type(els, 'git');
        expect(s.isActive()).toBe(true);
        expect(els.search.classList.contains('has-query')).toBe(true);
        els['search-clear'].trigger('click');
        expect(els['search-input'].value).toBe('');
        expect(store.get('searchQuery')).toBe('');
        expect(s.isActive()).toBe(false);
        expect(els.search.classList.contains('has-query')).toBe(false);
        expect(viewCalls).toEqual([
            ['search', { keepFocus: true }],
            ['tree', { keepFocus: true }]
        ]);
        expect(els['search-input'].focused).toBe(true);
    });

    it('a whitespace-only input persists an empty query and quits with the focus restore', () => {
        const { s, els, store, fuzzy, viewCalls } = setup({});
        type(els, 'git');
        type(els, '   ');
        expect(s.isActive()).toBe(false);
        expect(store.get('searchQuery')).toBe('');
        expect(fuzzy.calls).toHaveLength(1); // no second ranking run
        expect(viewCalls[1]).toEqual(['tree', { keepFocus: false }]); // search() path: plain quit()
    });

    it('searchAfterEnter defers ranking until Enter is pressed', () => {
        const { s, els, fuzzy, store } = setup({ storeData: { searchAfterEnter: '1' } });
        type(els, 'git');
        expect(fuzzy.calls).toHaveLength(0);
        expect(s.isActive()).toBe(false);
        expect(store.get('searchQuery')).toBe('git'); // still persisted
        els['search-input'].trigger('keydown', { key: 'Enter' });
        expect(fuzzy.calls).toHaveLength(1);
        expect(s.isActive()).toBe(true);
    });

    it('Escape with a query quits keeping the focus; with empty input it is a no-op', () => {
        const { s, els, viewCalls } = setup({});
        type(els, 'git');
        let prevented = 0;
        els['search-input'].trigger('keydown', { key: 'Escape', preventDefault: () => prevented++ });
        expect(prevented).toBe(1);
        expect(s.isActive()).toBe(false);
        expect(viewCalls[1]).toEqual(['tree', { keepFocus: true }]); // quit(true)
        els['search-input'].trigger('keydown', { key: 'Escape', preventDefault: () => prevented++ });
        expect(prevented).toBe(1); // input empty: popup is allowed to close
    });

    it('ArrowDown focuses the first result in search mode, the first tree row otherwise', () => {
        const { s, els } = setup({});
        const input = els['search-input'];
        input.value = 'git';
        input.selectionEnd = 3;
        const treeLink = makeEl();
        const firstLi = makeEl();
        firstLi._qs['span, a'] = treeLink;
        els.tree._qs['ul>li:first-child'] = firstLi;
        let prevented = 0;
        input.trigger('keydown', { key: 'ArrowDown', preventDefault: () => prevented++ });
        expect(prevented).toBe(1);
        expect(treeLink.focused).toBe(true);
        type(els, 'git');
        expect(s.isActive()).toBe(true);
        const resultLink = makeEl();
        els.results._qs['ul>li:first-child a'] = resultLink;
        input.trigger('keydown', { key: 'ArrowDown', preventDefault: () => prevented++ });
        expect(prevented).toBe(2);
        expect(resultLink.focused).toBe(true);
        // cursor not at the end: ArrowDown is left alone
        input.selectionEnd = 0;
        input.trigger('keydown', { key: 'ArrowDown', preventDefault: () => prevented++ });
        expect(prevented).toBe(2);
    });

    it('Tab jumps to the stored focusID row when set', () => {
        const focusRow = makeEl();
        focusRow.firstElementChild = makeEl();
        const { els } = setup({
            storeData: { focusID: '42' },
            extraEls: { 'neat-tree-item-42': focusRow }
        });
        let prevented = 0;
        els['search-input'].trigger('keydown', { key: 'Tab', preventDefault: () => prevented++ });
        expect(prevented).toBe(1);
        expect(focusRow.firstElementChild.focused).toBe(true);
    });

    it('Tab without focusID focuses the first visible tree item', () => {
        const { els } = setup({});
        const hidden = makeEl();
        hidden.parentElement = { offsetHeight: 0 };
        const visible = makeEl();
        visible.offsetTop = 20;
        visible.offsetHeight = 20;
        visible.parentElement = { offsetHeight: 100 };
        els.tree._qsa['a, span'] = [hidden, visible];
        els.tree.scrollTop = 0;
        els['search-input'].trigger('keydown', { key: 'Tab', preventDefault: () => {} });
        expect(hidden.focused).toBe(false);
        expect(visible.focused).toBe(true);
    });

    it('focus/blur toggles the searchFocus body class', () => {
        const { els, bodyClasses } = setup({});
        els['search-input'].trigger('focus');
        expect(bodyClasses.contains('searchFocus')).toBe(true);
        els['search-input'].trigger('blur');
        expect(bodyClasses.contains('searchFocus')).toBe(false);
    });
});

describe('saved query restore', () => {
    it('restores and searches the persisted query when rememberState is on', () => {
        const { s, els, fuzzy } = setup({ storeData: { searchQuery: 'git' }, rememberState: true });
        expect(els['search-input'].value).toBe('git');
        expect(fuzzy.calls).toHaveLength(1);
        expect(fuzzy.calls[0].query).toBe('git');
        expect(s.isActive()).toBe(true);
        expect(els['search-input'].selected).toBe(true);
        expect(els['search-input'].scrollLeft).toBe(0);
    });

    it('does not restore when rememberState is off', () => {
        const { s, els, fuzzy } = setup({ storeData: { searchQuery: 'git' }, rememberState: false });
        expect(els['search-input'].value).toBe('');
        expect(fuzzy.calls).toHaveLength(0);
        expect(s.isActive()).toBe(false);
    });

    it('restore with searchAfterEnter fills the query but does not search', () => {
        const { s, els, fuzzy } = setup({
            storeData: { searchQuery: 'git', searchAfterEnter: '1' },
            rememberState: true
        });
        expect(els['search-input'].value).toBe('git');
        expect(fuzzy.calls).toHaveLength(0);
        expect(s.isActive()).toBe(false);
        expect(els['search-input'].selected).toBe(true);
    });
});
