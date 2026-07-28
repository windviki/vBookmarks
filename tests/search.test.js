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
    get(key, dflt) {
        return key in this._data ? this._data[key] : dflt;
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
let pushSearchHistory;

beforeAll(async () => {
    globalThis.MouseEvent = class {
        constructor(type, opts) {
            this.type = type;
            Object.assign(this, opts);
        }
    };
    ({ initSearch, pushSearchHistory } = await import('../src/search.js'));
});

const setup = (opts = {}) => {
    const els = {
        tree: makeEl(),
        results: makeEl(),
        search: makeEl(),
        'search-input': makeEl(),
        'search-clear': makeEl(),
        'search-history-area': makeEl(),
        ...(opts.extraEls || {})
    };
    // search.js reaches the row through the clear button's parentNode
    els['search-clear'].parentNode = els.search;
    const bodyClasses = makeClassList();
    globalThis.document = {
        getElementById: id => els[id] || null,
        body: { classList: bodyClasses },
        activeElement: null
    };
    const fuzzy = {
        calls: [],
        results: opts.fuzzyResults || [],
        rank(query, index) {
            this.calls.push({ query, index });
            return this.results;
        }
    };
    const winListeners = {};
    globalThis.window = {
        VBMFuzzy: fuzzy,
        addEventListener: (type, fn) => {
            (winListeners[type] = winListeners[type] || []).push(fn);
        }
    };
    if (opts.syncManager)
        globalThis.window.syncManager = opts.syncManager;
    const chromeStub = makeChrome();
    globalThis.chrome = chromeStub;
    const store = makeStore(opts.storeData || {});
    const calls = { switchBookmarkMenu: [], generateBookmarkHTML: [], highlightTitlePositions: [] };
    // v4 task-2: the display swap is replaced by the view layer. The double
    // records activate() calls, tracks the active view like the real manager
    // and captures the hooks search.js attaches to the structural 'search'
    // view.
    const viewCalls = [];
    const viewHooks = {};
    let currentView = opts.activeView || 'tree';
    const views = {
        activate: (id, o) => {
            viewCalls.push([id, o]);
            currentView = id;
        },
        activeId: () => currentView,
        isActive: id => currentView === id,
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
        views,
        revealInTree: opts.revealInTree
    });
    return { s, els, store, chrome: chromeStub, fuzzy, calls, bodyClasses, viewCalls, viewHooks, winListeners };
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
        expect(html).toContain('data-node-id="11"'); // unified row id (v4 task-2)
        expect(html).toContain('data-node-id="1"'); // folder rows too
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

    it('renders the empty-query hint into the history area when the search view activates without a query', () => {
        const { els, viewHooks } = setup({});
        viewHooks.search.activate();
        // §3.2: the hint lives in the upper history area; results stay untouched
        expect(els['search-history-area'].innerHTML).toContain(
            '<li class="empty-state" role="listitem"><i>searchViewHint</i></li>');
        expect(els.results.innerHTML).toBe('');
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

    // §2.3: R on a focused result row reveals it in the tree.
    it('R reveals the focused result row in the tree; other keys and id-less rows decline', () => {
        const revealCalls = [];
        const { viewHooks } = setup({ revealInTree: id => revealCalls.push(id) });
        // data-node-id path (both bookmark and folder rows carry it)
        globalThis.document.activeElement = { parentNode: { dataset: { nodeId: '11' }, id: 'results-item-11' } };
        let prevented = false;
        expect(viewHooks.search.onKey({ key: 'r', preventDefault: () => { prevented = true; } })).toBe(true);
        expect(prevented).toBe(true);
        expect(revealCalls).toEqual(['11']);
        // id-prefix fallback path
        globalThis.document.activeElement = { parentNode: { dataset: {}, id: 'results-item-7' } };
        expect(viewHooks.search.onKey({ key: 'R', preventDefault: () => {} })).toBe(true);
        expect(revealCalls).toEqual(['11', '7']);
        // non-R keys and rows without an id stay out of the way
        expect(viewHooks.search.onKey({ key: 'x', preventDefault: () => {} })).toBe(false);
        globalThis.document.activeElement = { parentNode: { dataset: {}, id: '' } };
        expect(viewHooks.search.onKey({ key: 'r', preventDefault: () => {} })).toBe(false);
        globalThis.document.activeElement = null;
        expect(viewHooks.search.onKey({ key: 'r', preventDefault: () => {} })).toBe(false);
        expect(revealCalls).toEqual(['11', '7']);
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

    it('Escape with a query records + clears the box but keeps the results and the view (two-level, §3.2)', () => {
        const { s, els, store, viewCalls } = setup({});
        type(els, 'git');
        const keptResults = els.results.innerHTML;
        let prevented = 0;
        els['search-input'].trigger('keydown', { key: 'Escape', preventDefault: () => prevented++ });
        expect(prevented).toBe(1);
        expect(s.isActive()).toBe(false);
        expect(els['search-input'].value).toBe('');
        expect(store.get('searchQuery')).toBe('');
        // the query landed in the history, the results stay in place and no
        // return activation fires — the search view stays put
        expect(JSON.parse(store.get('searchHistory')).map(e => e.q)).toEqual(['git']);
        expect(els.results.innerHTML).toBe(keptResults);
        expect(viewCalls).toEqual([['search', { keepFocus: true }]]);
        // the history area now shows the recorded entry instead of the hint
        expect(els['search-history-area'].innerHTML).toContain('data-q="git"');
        // second Esc on the empty box declines: the document chain walks back
        els['search-input'].trigger('keydown', { key: 'Escape', preventDefault: () => prevented++ });
        expect(prevented).toBe(1);
        expect(s.escape()).toBe(false);
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

describe('pushSearchHistory (§4.3 pure MRU)', () => {
    it('trims the query, newest first, entries normalized to {q, ts, n}', () => {
        expect(pushSearchHistory([], { q: '  git  ', ts: 5, n: 3 }))
            .toEqual([{ q: 'git', ts: 5, n: 3 }]);
        expect(pushSearchHistory(null, { q: 'a' }))
            .toEqual([{ q: 'a', ts: 0, n: 0 }]);
    });

    it('drops empty/blank queries, keeping the list untouched', () => {
        const list = [{ q: 'x', ts: 1, n: 0 }];
        expect(pushSearchHistory(list, { q: '   ' })).toEqual(list);
        expect(pushSearchHistory(list, null)).toEqual(list);
        expect(pushSearchHistory(list, {})).toEqual(list);
    });

    it('dedupes by exact query: the re-searched entry moves to the front', () => {
        const list = [{ q: 'a', ts: 1, n: 1 }, { q: 'b', ts: 2, n: 2 }];
        expect(pushSearchHistory(list, { q: 'a', ts: 3, n: 4 }))
            .toEqual([{ q: 'a', ts: 3, n: 4 }, { q: 'b', ts: 2, n: 2 }]);
        // case differs → a distinct entry
        expect(pushSearchHistory(list, { q: 'A', ts: 3, n: 0 })[1].q).toBe('a');
    });

    it('caps the list at the limit (default 10)', () => {
        let list = [];
        for (let i = 0; i < 12; i++)
            list = pushSearchHistory(list, { q: `q${i}`, ts: i, n: 0 });
        expect(list).toHaveLength(10);
        expect(list[0].q).toBe('q11');
        expect(list[9].q).toBe('q2');
        expect(pushSearchHistory([{ q: 'a' }, { q: 'b' }], { q: 'c' }, 2)).toHaveLength(2);
    });

    it('tolerates malformed stored entries', () => {
        const list = [null, { q: 1 }, 'junk', { q: 'ok', ts: 2 }];
        expect(pushSearchHistory(list, { q: 'new', ts: 9, n: 1 }))
            .toEqual([{ q: 'new', ts: 9, n: 1 }, { q: 'ok', ts: 2, n: 0 }]);
    });
});

describe('search history area (§3.2/§4.3)', () => {
    const HISTORY = JSON.stringify([{ q: 'old query', ts: Date.now(), n: 3 }]);

    it('renders history rows (clock + query + count + time) with a clear-all head', () => {
        const { els, viewHooks } = setup({ storeData: { searchHistory: HISTORY } });
        viewHooks.search.activate();
        const html = els['search-history-area'].innerHTML;
        expect(html).toContain('class="search-history-head"');
        expect(html).toContain('id="search-history-clear"');
        expect(html).toContain('class="vbm-row search-history-row"');
        expect(html).toContain('data-q="old query"');
        expect(html).toContain('class="history-clock"');
        expect(html).toContain('<span class="history-meta">searchHistoryResultCount[3]</span>');
        expect(html).toContain('<span class="history-time">timeJustNow</span>');
        expect(html).toContain('class="row-btn search-history-remove"');
    });

    it('escapes queries in the row markup', () => {
        const { els, viewHooks } = setup({
            storeData: { searchHistory: JSON.stringify([{ q: '<b>"x"', ts: 1, n: 0 }]) }
        });
        viewHooks.search.activate();
        expect(els['search-history-area'].innerHTML).toContain('data-q="&lt;b&gt;&quot;x&quot;"');
    });

    it('shows only the hint when history is disabled (entries stay stored but hidden)', () => {
        const { els, viewHooks } = setup({
            storeData: { searchHistoryEnabled: '', searchHistory: HISTORY }
        });
        viewHooks.search.activate();
        const html = els['search-history-area'].innerHTML;
        expect(html).toContain('searchViewHint');
        expect(html).not.toContain('data-q=');
    });

    it('clicking a history row reruns the query immediately — even in searchAfterEnter mode', () => {
        const { els, viewHooks, fuzzy, store } = setup({
            storeData: { searchHistory: HISTORY, searchAfterEnter: '1' }
        });
        viewHooks.search.activate();
        const anchor = { dataset: { q: 'old query' } };
        els['search-history-area'].trigger('click', {
            target: { closest: sel => (sel === 'a[data-q]' ? anchor : null) }
        });
        expect(els['search-input'].value).toBe('old query');
        expect(fuzzy.calls).toHaveLength(1); // explicit pick bypasses searchAfterEnter
        expect(fuzzy.calls[0].query).toBe('old query');
        expect(els['search-input'].focused).toBe(true);
        expect(store.get('searchQuery')).toBe('old query');
    });

    it('the × button removes a single entry; the head button clears them all', () => {
        const { els, viewHooks, store } = setup({
            storeData: { searchHistory: JSON.stringify([{ q: 'a', ts: 1, n: 0 }, { q: 'b', ts: 2, n: 0 }]) }
        });
        viewHooks.search.activate();
        els['search-history-area'].trigger('click', {
            target: { closest: sel => (sel === '.search-history-remove' ? { dataset: { q: 'a' } } : null) }
        });
        expect(JSON.parse(store.get('searchHistory')).map(e => e.q)).toEqual(['b']);
        els['search-history-area'].trigger('click', {
            target: { closest: sel => (sel === '#search-history-clear' ? {} : null) }
        });
        expect(store.get('searchHistory')).toBe('[]');
        expect(els['search-history-area'].innerHTML).toContain('searchViewHint');
    });

    it('Enter on a focused row reruns it, Delete removes it', () => {
        const { els, viewHooks, store } = setup({ storeData: { searchHistory: HISTORY } });
        viewHooks.search.activate();
        globalThis.document.activeElement = { dataset: { q: 'old query' } };
        els['search-history-area'].trigger('keydown', { key: 'Enter' });
        expect(els['search-input'].value).toBe('old query');
        els['search-history-area'].trigger('keydown', { key: 'Delete' });
        expect(store.get('searchHistory')).toBe('[]');
        // unrelated focus: the handler stays out of the way
        globalThis.document.activeElement = null;
        els['search-history-area'].trigger('keydown', { key: 'Enter' });
        expect(els['search-input'].value).toBe('old query'); // unchanged
    });

    it('ArrowDown on an empty query in the search view lands on the first history row, else the first result', () => {
        const { els } = setup({ activeView: 'search', storeData: { searchHistory: HISTORY } });
        const input = els['search-input'];
        input.value = '';
        input.selectionEnd = 0;
        const historyLink = makeEl();
        els['search-history-area']._qs['a[data-q]'] = historyLink;
        input.trigger('keydown', { key: 'ArrowDown' });
        expect(historyLink.focused).toBe(true);
        // no history row → falls through to the first kept result
        const ctx = setup({ activeView: 'search' });
        ctx.els['search-input'].value = '';
        ctx.els['search-input'].selectionEnd = 0;
        const resultLink = makeEl();
        ctx.els.results._qs['ul>li:first-child a'] = resultLink;
        ctx.els['search-input'].trigger('keydown', { key: 'ArrowDown' });
        expect(resultLink.focused).toBe(true);
    });
});

describe('search history record timings (§4.3)', () => {
    it('records on result open (reset), with the last result count', () => {
        const { s, els, store } = setup({
            fuzzyResults: [
                { id: '11', parentId: '1', title: 'GitHub', url: 'https://github.com/', isFolder: false, positions: [] },
                { id: '2', parentId: '0', title: 'HN', url: 'https://news.ycombinator.com/', isFolder: false, positions: [] }
            ]
        });
        type(els, 'git');
        s.reset(); // tree-view's bookmarkHandler calls this after opening a result
        const history = JSON.parse(store.get('searchHistory'));
        expect(history.map(e => e.q)).toEqual(['git']);
        expect(history[0].n).toBe(2);
    });

    it('records on view leave (deactivate) and on popup close (pagehide)', () => {
        const { els, viewHooks, store, winListeners } = setup({});
        type(els, 'git');
        viewHooks.search.deactivate();
        expect(JSON.parse(store.get('searchHistory')).map(e => e.q)).toEqual(['git']);
        expect(winListeners.pagehide).toHaveLength(1);
        els['search-input'].value = 'second';
        winListeners.pagehide[0]();
        expect(JSON.parse(store.get('searchHistory')).map(e => e.q)).toEqual(['second', 'git']);
    });

    it('records on Enter in searchAfterEnter mode', () => {
        const { els, store } = setup({ storeData: { searchAfterEnter: '1' } });
        type(els, 'git');
        expect(store.get('searchHistory')).toBeUndefined(); // nothing yet
        els['search-input'].trigger('keydown', { key: 'Enter' });
        expect(JSON.parse(store.get('searchHistory')).map(e => e.q)).toEqual(['git']);
    });

    it('never records when the history switch is off', () => {
        const { s, els, store, viewHooks } = setup({ storeData: { searchHistoryEnabled: '' } });
        type(els, 'git');
        s.reset();
        viewHooks.search.deactivate();
        expect(store.get('searchHistory')).toBeUndefined();
    });
});

describe('search-view re-entry contract (2026-07-25 spec)', () => {
    it('activate never refills or reruns: box and results survive view switches as they are', () => {
        const { els, viewHooks, fuzzy } = setup({});
        type(els, 'git'); // live search: results rendered, not yet in history
        expect(fuzzy.calls).toHaveLength(1);
        const resultsHtml = els.results.innerHTML;
        // leave with a live query (record timing ③) and come back: nothing moves
        viewHooks.search.deactivate();
        viewHooks.search.activate();
        expect(els['search-input'].value).toBe('git');
        expect(fuzzy.calls).toHaveLength(1);
        expect(els.results.innerHTML).toBe(resultsHtml);
        // after an explicit clear, re-entry keeps the box empty + renders history
        els['search-input'].value = '';
        viewHooks.search.activate();
        expect(els['search-input'].value).toBe('');
        expect(els['search-history-area'].innerHTML).toContain('data-q="git"');
        expect(els.results.innerHTML).toBe(resultsHtml);
    });

    it('ignores a leftover persisted searchLastQuery (the refill is retired)', () => {
        const { els, viewHooks, fuzzy } = setup({
            rememberState: true,
            storeData: { searchLastQuery: 'git' }
        });
        viewHooks.search.activate();
        expect(els['search-input'].value).toBe('');
        expect(fuzzy.calls).toHaveLength(0);
    });

    it('two-level Esc then re-entry: cleared box, recorded history, kept results', () => {
        const { s, els, viewHooks } = setup({});
        type(els, 'git');
        const resultsHtml = els.results.innerHTML;
        expect(s.escape()).toBe(true); // first Esc: clear + record + stay
        expect(els['search-input'].value).toBe('');
        expect(els['search-history-area'].innerHTML).toContain('data-q="git"');
        expect(els.results.innerHTML).toBe(resultsHtml);
        expect(s.escape()).toBe(false); // second Esc: falls through to the view layer
        // back in the search view: empty box, history above, same results below
        viewHooks.search.activate();
        expect(els['search-input'].value).toBe('');
        expect(els['search-history-area'].innerHTML).toContain('data-q="git"');
        expect(els.results.innerHTML).toBe(resultsHtml);
    });
});

// v4 task-2 §4.4: the palette bridge row calls s.run(q) to jump into the
// search view with its query — the same refill+rerun path history rows use.
describe('palette bridge run() (§4.4)', () => {
    it('refills the box, reruns immediately (even in searchAfterEnter mode) and focuses', () => {
        const { s, els, fuzzy, store } = setup({ storeData: { searchAfterEnter: '1' } });
        s.run('palette query');
        expect(els['search-input'].value).toBe('palette query');
        expect(fuzzy.calls).toHaveLength(1);
        expect(fuzzy.calls[0].query).toBe('palette query');
        expect(els['search-input'].focused).toBe(true);
        expect(store.get('searchQuery')).toBe('palette query');
    });

    it('replaces an in-progress query wholesale', () => {
        const { s, els, fuzzy } = setup({});
        type(els, 'old');
        s.run('new');
        expect(els['search-input'].value).toBe('new');
        expect(fuzzy.calls).toHaveLength(2);
        expect(fuzzy.calls[1].query).toBe('new');
    });
});
