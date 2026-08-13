import { describe, it, expect, beforeAll } from 'vitest';
import { initViewManager } from '../src/view-manager.js';
import { initSearch } from '../src/search.js';

// End-to-end record-timing gate: wires the REAL view-manager + the REAL
// search module so a view switch (the R-back-to-tree path) is proven to record
// the live query into history through view-manager's prev.deactivate() hook.
// The per-module suites mock each other; this pins the actual chain.

const makeClassList = () => {
    const set = new Set();
    return {
        add: (...cs) => cs.forEach(c => set.add(c)),
        remove: (...cs) => cs.forEach(c => set.delete(c)),
        contains: c => set.has(c),
        toggle: (c, on) => (on ? set.add(c) : set.delete(c)),
        _set: set
    };
};

const makeEl = (id = '', tagName = 'DIV') => {
    const classes = makeClassList();
    const node = {
        id, tagName: tagName.toUpperCase(), style: {}, dataset: {}, hidden: false,
        value: '', textContent: '', title: '', href: '', checked: false, tabIndex: 0,
        type: '', parentNode: null, children: [], _listeners: {}, _qs: {}, _qsa: {},
        _attrs: {},
        classList: classes,
        addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
        trigger(type, ev = {}) { (this._listeners[type] || []).forEach(fn => fn.call(this, ev)); },
        appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
        focus() { this.focused = true; },
        setAttribute(k, v) { this._attrs[k] = String(v); },
        getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
        querySelector(sel) {
            const want = sel.replace(/^\./, '').toUpperCase();
            for (const c of this.children)
                if (c.classList && c.classList.contains(sel.replace(/^\./, ''))) return c;
            for (const c of this.children)
                if (c.tagName === want) return c;
            return sel in this._qs ? this._qs[sel] : null;
        },
        querySelectorAll(sel) { return this._qsa[sel] || []; },
        get className() { return [...classes._set].join(' '); },
        set className(v) {
            classes._set.clear();
            String(v).split(/\s+/).filter(Boolean).forEach(c => classes._set.add(c));
        }
    };
    Object.defineProperty(node, 'innerHTML', {
        get() { return node._html; },
        set(v) { node._html = v; if (v === '') node.children = []; }
    });
    return node;
};

const makeStore = (data = {}) => {
    const d = { ...data };
    return {
        get(k, dflt) { return k in d ? d[k] : dflt; },
        set(k, v) { d[k] = v; },
        getSyncSetting(k, dflt) { return k in d ? d[k] : dflt; },
        _data: d
    };
};

let setup;

beforeAll(async () => {
    const vmm = (await import('../src/view-manager.js')).initViewManager;
    const sm = (await import('../src/search.js')).initSearch;
    setup = (storeData = {}) => {
        const byId = {};
        const el = (id, tag = 'DIV') => byId[id] || (byId[id] = makeEl(id, tag));
        for (const id of ['view-tabs', 'view-announce', 'view-tree', 'view-search',
            'tree', 'results', 'search-input', 'search-clear', 'search-history-area',
            'search', 'search-field', 'body'])
            el(id);
        const body = byId.body;
        body.querySelector = () => null;
        body.classList.add('panel-mode') === undefined; // noop

        const store = makeStore(storeData);
        const chrome = {
            i18n: { getMessage: k => k },
            bookmarks: {
                getTree: cb => cb([]),
                onCreated: { addListener() {} }, onRemoved: { addListener() {} },
                onChanged: { addListener() {} }, onMoved: { addListener() {} },
                onChildrenReordered: { addListener() {} },
                onImportBegan: { addListener() {} }, onImportEnded: { addListener() {} }
            }
        };
        globalThis.chrome = chrome;
        globalThis.document = {
            getElementById: id => byId[id] || null,
            body,
            addEventListener() {},
            createElement: tag => makeEl('', tag)
        };
        globalThis.window = { VBMFuzzy: { rank: () => [] }, addEventListener() {} };

        const views = vmm({ store, isPanel: false, rtl: false, clearMenu: () => {} });
        views.register({ id: 'tree', titleKey: 'viewTree', icon: '<svg/>', container: byId['view-tree'], listEl: byId.tree });
        const searchView = views.register({ id: 'search', titleKey: 'viewSearch', icon: '<svg/>', container: byId['view-search'], listEl: byId.results });

        const search = sm({
            store,
            separatorManager: { isSeparator: (t, u) => false },
            switchBookmarkMenu: () => {},
            generateBookmarkHTML: (t, u, e, id) => `<a href="${u}" data-id="${id}">${t}</a>`,
            highlightTitlePositions: (t) => t,
            rememberState: true,
            views
        });

        const cleanup = () => {
            delete globalThis.chrome;
            delete globalThis.document;
            delete globalThis.window;
        };
        return { views, search, store, byId, searchView, cleanup };
    };
});

describe('search-history record timing — REAL view-manager + search wiring', () => {
    it('R-back-to-tree (a view switch) records the live query into history', () => {
        const ctx = setup();
        try {
            const { views, store, byId } = ctx;
            views.activate('search');
            byId['search-input'].value = 'git';
            byId['search-input'].trigger('input');
            // the user presses R (reveal in tree) → tree view activates →
            // view-manager calls the outgoing search view's deactivate hook
            views.activate('tree');
            const history = JSON.parse(store.get('searchHistory') || '[]');
            expect(history.map(h => h.q)).toContain('git');
        } finally {
            ctx.cleanup();
        }
    });

    it('re-entering the search view renders the recorded entry in the history area', () => {
        const ctx = setup();
        try {
            const { views, store, byId } = ctx;
            views.activate('search');
            byId['search-input'].value = 'github';
            byId['search-input'].trigger('input');
            views.activate('tree');   // records
            views.activate('search'); // re-enter → renderHistoryArea
            expect(byId['search-history-area'].innerHTML).toContain('data-q="github"');
        } finally {
            ctx.cleanup();
        }
    });

    it('searchHistoryEnabled off → the view switch does NOT record', () => {
        const ctx = setup({ searchHistoryEnabled: '' });
        try {
            const { views, store, byId } = ctx;
            views.activate('search');
            byId['search-input'].value = 'git';
            byId['search-input'].trigger('input');
            views.activate('tree');
            expect(store.get('searchHistory') || '[]').toBe('[]');
        } finally {
            ctx.cleanup();
        }
    });

    it('the × button ABANDONS the search — clears the results pane, records nothing (no ghost list)', () => {
        const ctx = setup();
        try {
            const { views, store, byId } = ctx;
            views.activate('search');
            byId['search-input'].value = 'git';
            byId['search-input'].trigger('input');
            // the unconsumed query rendered into the results pane
            byId['search-clear'].trigger('click');
            expect(byId.results.innerHTML).toBe('');          // pane cleared
            expect(store.get('searchHistory') || '[]').toBe('[]'); // never consumed
            // re-entering the view shows NO ghost: empty pane + no history row
            views.activate('tree');
            views.activate('search');
            expect(byId.results.innerHTML).toBe('');
            expect(byId['search-history-area'].innerHTML).not.toContain('data-q="git"');
        } finally {
            ctx.cleanup();
        }
    });
});
