import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initViewManager } from '../src/view-manager.js';

// view-manager.js uses real DOM APIs (createElement/appendChild/classList/
// querySelector…), so the tests run it against a small hand-rolled DOM: the
// elements record listeners/children and implement the handful of selectors
// the module queries ('.tab-indicator', '.tab-badge', '.focus',
// 'li a, li span'). Assertions target the ViewDef contract of
// docs/plan-4.0.0/v4task-2.md §3 — tab strip ARIA + roving tabindex, activation
// lifecycle (hooks, scroll persistence, focus restore), the Escape levels,
// the tab-strip keyboard model and the Ctrl/Cmd+number jump.

const MESSAGES = {
    viewTree: 'Tree',
    viewSearch: 'Search',
    viewRecent: 'Recent'
};

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

// Minimal selector matching: '.class' or a (compound) tag selector like
// 'li a, li span' — the last segment decides, comma = OR.
const matchSimple = (el, part) => {
    const last = part.trim().split(/\s+/).pop();
    if (last.startsWith('.'))
        return el.classList.contains(last.slice(1));
    return el.tagName === last.toUpperCase();
};
const queryIn = (root, sel) => {
    const parts = sel.split(',');
    let found = null;
    const walk = node => {
        for (const child of node.children) {
            if (parts.some(p => matchSimple(child, p))) {
                found = child;
                return true;
            }
            if (walk(child))
                return true;
        }
        return false;
    };
    walk(root);
    return found;
};

const setup = (opts = {}) => {
    let doc; // forward ref for element focus()
    const makeEl = (tagName = 'div') => {
        const el = {
            tagName: tagName.toUpperCase(),
            children: [],
            parentNode: null,
            style: {},
            dataset: {},
            _attrs: {},
            _listeners: {},
            _dispatched: [],
            hidden: false,
            tabIndex: 0,
            focused: false,
            focusCount: 0,
            offsetWidth: 0,
            offsetLeft: 0,
            scrollTop: 0,
            textContent: '',
            value: '',
            classList: makeClassList(),
            get className() {
                return [...this.classList._set].join(' ');
            },
            set className(v) {
                this.classList._set.clear();
                String(v).split(/\s+/).filter(Boolean).forEach(c => this.classList._set.add(c));
            },
            get innerHTML() {
                return this._html || '';
            },
            set innerHTML(v) {
                this._html = v;
                this.children = [];
            },
            setAttribute(k, v) {
                this._attrs[k] = String(v);
            },
            getAttribute(k) {
                return k in this._attrs ? this._attrs[k] : null;
            },
            appendChild(child) {
                this.children.push(child);
                child.parentNode = this;
                return child;
            },
            get firstElementChild() {
                return this.children[0] || null;
            },
            addEventListener(type, fn) {
                (this._listeners[type] = this._listeners[type] || []).push(fn);
            },
            trigger(type, ev = {}) {
                ev.preventDefault = ev.preventDefault || (() => {
                    ev.defaultPrevented = true;
                });
                (this._listeners[type] || []).slice().forEach(fn => fn.call(this, ev));
            },
            click() {
                this.trigger('click');
            },
            dispatchEvent(ev) {
                this._dispatched.push(ev);
                return true;
            },
            getBoundingClientRect() {
                return this._rect || {
                    left: this.offsetLeft,
                    right: this.offsetLeft + this.offsetWidth,
                    top: 0,
                    bottom: 20,
                    width: this.offsetWidth
                };
            },
            focus() {
                this.focused = true;
                this.focusCount++;
                doc.activeElement = this;
            },
            // Minimal Element.closest: tag selectors plus the leading-dot
            // class form ('.vbm-dropdown-list' — the marker guard asks for it).
            closest(sel) {
                for (let n = this; n; n = n.parentNode) {
                    if (sel.startsWith('.')) {
                        if (n.classList.contains(sel.slice(1)))
                            return n;
                    } else if (sel.startsWith('#')) {
                        if (n.id === sel.slice(1))
                            return n;
                    } else if (n.tagName === sel.toUpperCase()) {
                        return n;
                    }
                }
                return null;
            },
            querySelector(sel) {
                return queryIn(this, sel);
            },
            querySelectorAll(sel) {
                const out = [];
                const parts = sel.split(',');
                const walk = node => {
                    for (const child of node.children) {
                        if (parts.some(p => matchSimple(child, p)))
                            out.push(child);
                        walk(child);
                    }
                };
                walk(this);
                return out;
            }
        };
        return el;
    };

    const byId = {};
    for (const id of ['view-tabs', 'view-announce', 'view-tree', 'tree', 'view-search', 'results'])
        byId[id] = makeEl('div');
    byId['search-input'] = makeEl('input');
    for (const id of Object.keys(byId))
        byId[id].id = id;

    doc = {
        _listeners: [],
        activeElement: null,
        body: makeEl('body'),
        createElement: tag => makeEl(tag),
        getElementById: id => byId[id] || null,
        addEventListener(type, fn, capture) {
            this._listeners.push({ type, fn, capture: !!capture });
        },
        removeEventListener(type, fn) {
            this._listeners = this._listeners.filter(l => !(l.type === type && l.fn === fn));
        }
    };
    globalThis.document = doc;
    globalThis.window = {};
    // view-manager.js's tab-strip ContextMenu/F10 path constructs a
    // synthetic contextmenu MouseEvent (the same recipe keyboard.js uses).
    globalThis.MouseEvent = class {
        constructor(type, init = {}) {
            this.type = type;
            Object.assign(this, init);
        }
    };
    globalThis.chrome = {
        i18n: {
            getMessage: (key, subs) =>
                subs ? `${key}[${[].concat(subs).join('|')}]` : (MESSAGES[key] || key)
        }
    };

    const store = {
        _data: { ...(opts.storeData || {}) },
        setCalls: [],
        get(key, dflt) {
            return key in this._data ? this._data[key] : dflt;
        },
        set(key, v) {
            this.setCalls.push([key, v]);
            this._data[key] = v;
        }
    };

    const clearMenuCalls = [];
    const views = initViewManager({
        store,
        isPanel: !!opts.isPanel,
        rtl: !!opts.rtl,
        clearMenu: opts.noClearMenu ? undefined : () => clearMenuCalls.push(1),
        getRememberState: opts.getRememberState,
        toastAction: opts.toastAction
    });

    const fireDoc = (type, ev) => {
        for (const l of doc._listeners.filter(l => l.type === type))
            l.fn.call(doc, ev);
    };
    const tabs = () => byId['view-tabs'].children.filter(c => c.classList.contains('view-tab'));
    const indicator = () => byId['view-tabs'].querySelector('.tab-indicator');
    // A third feature-view registration used by several tests.
    const addRecent = (extra = {}) => views.register({
        id: 'recent', titleKey: 'viewRecent', icon: '<svg/>',
        container: makeEl(), listEl: makeEl(), ...extra
    });

    return { views, doc, store, byId, makeEl, fireDoc, tabs, indicator, addRecent, clearMenuCalls };
};

describe('startup + tab rendering', () => {
    it('registers the two structural views and renders their tabs', () => {
        const { tabs, indicator, byId } = setup({});
        expect(tabs().map(t => t.id)).toEqual(['view-tab-tree', 'view-tab-search']);
        const [treeTab, searchTab] = tabs();
        expect(treeTab.getAttribute('role')).toBe('tab');
        expect(treeTab.getAttribute('aria-selected')).toBe('true');
        expect(searchTab.getAttribute('aria-selected')).toBe('false');
        // roving tabindex: only the active tab is in the tab order
        expect(treeTab.tabIndex).toBe(0);
        expect(searchTab.tabIndex).toBe(-1);
        expect(treeTab.getAttribute('aria-label')).toBe('Tree');
        expect(searchTab.getAttribute('aria-label')).toBe('Search');
        expect(indicator()).not.toBeNull();
        // startup: tree shown, search hidden
        expect(byId['view-tree'].hidden).toBe(false);
        expect(byId['view-search'].hidden).toBe(true);
    });

    it('the popup restores the stored view by default (rememberView on, v4 task-3 #6)', () => {
        const { views, store } = setup({ isPanel: false, storeData: { activeView: 'search' } });
        expect(views.activeId()).toBe('search');
        expect(store.get('activeView')).toBe('search');
    });

    it('rememberView off: the popup always lands on the tree', () => {
        const { views } = setup({ isPanel: false, storeData: { activeView: 'search', rememberView: '' } });
        expect(views.activeId()).toBe('tree');
    });

    it('the popup falls back to the tree when the stored view is hidden/gone', () => {
        const { views } = setup({ isPanel: false, storeData: { activeView: 'nope' } });
        expect(views.activeId()).toBe('tree');
    });

    it('a stored feature view restores when it registers late (real init order)', () => {
        const { views, addRecent } = setup({ isPanel: false, storeData: { activeView: 'recent' } });
        expect(views.activeId()).toBe('tree'); // not registered yet at startup
        addRecent();
        expect(views.activeId()).toBe('recent'); // pending restore fired
    });

    it('a late-registered hidden view does not restore', () => {
        const { views, addRecent } = setup({ isPanel: false, storeData: { activeView: 'recent' } });
        addRecent({ hidden: true });
        expect(views.activeId()).toBe('tree');
    });

    it('the panel restores the stored active view', () => {
        const { views, byId } = setup({ isPanel: true, storeData: { activeView: 'search' } });
        expect(views.activeId()).toBe('search');
        expect(byId['view-tree'].hidden).toBe(true);
        expect(byId['view-search'].hidden).toBe(false);
    });

    it('the panel falls back to the tree for an unknown or hidden stored view', () => {
        const unknown = setup({ isPanel: true, storeData: { activeView: 'nope' } });
        expect(unknown.views.activeId()).toBe('tree');
        const { views, addRecent } = setup({ isPanel: true, storeData: { activeView: 'recent' } });
        // registered after startup as hidden: still not restorable
        addRecent({ hidden: true });
        expect(views.activeId()).toBe('tree');
    });
});

describe('hide and disable (tab context menu backing)', () => {
    it('a feature view with a showKey hides when the show setting is off', () => {
        const { views, addRecent, tabs } = setup({});
        addRecent({ showKey: 'showRecentBookmarks' });
        expect(views.isAvailable('recent')).toBe(true);
        expect(tabs().map(t => t.id)).toContain('view-tab-recent');
    });

    it('hideViewTab writes the show setting off but keeps the view palette-available', () => {
        const { views, addRecent, store, tabs } = setup({});
        addRecent({ showKey: 'showRecentBookmarks', disableKey: 'disableRecentView' });
        expect(tabs()).toHaveLength(3);
        expect(views.hideViewTab('recent')).toBe(true);
        expect(store.get('showRecentBookmarks')).toBe('');
        expect(views.isAvailable('recent')).toBe(true);
        expect(views.activate('recent')).toBe(true);
        expect(tabs().map(t => t.id)).not.toContain('view-tab-recent');
    });

    it('disableView makes a feature view hidden even while its show option stays on', () => {
        const { views, addRecent, store, tabs } = setup({});
        addRecent({ showKey: 'showRecentBookmarks', disableKey: 'disableRecentView' });
        expect(views.disableView('recent')).toBe(true);
        expect(store.get('disableRecentView')).toBe('1');
        expect(views.isAvailable('recent')).toBe(false);
        expect(tabs().map(t => t.id)).not.toContain('view-tab-recent');
        // show option remains on: re-enabling would bring the tab straight back
        expect(store.get('showRecentBookmarks', '1')).toBe('1');
    });

    it('tree/search Hide becomes the hide-tab-bar shortcut only when they are the last two tabs', () => {
        const { views, tabs, store, byId } = setup({});
        expect(tabs()).toHaveLength(2);
        expect(views.viewMenuState('tree')).toEqual({ canHide: true, canDisable: false });
        expect(views.viewMenuState('search')).toEqual({ canHide: true, canDisable: false });
        expect(views.hideViewTab('tree')).toBe(true);
        expect(store.get('showViewTabs')).toBe('');
        expect(byId['view-tabs'].classList.contains('no-view-tabs')).toBe(false); // class lives on body
        expect(document.body.classList.contains('no-view-tabs')).toBe(true);
        expect(views.disableView('tree')).toBe(false);
        expect(tabs()).toHaveLength(2); // tabs stay rendered; the strip is CSS-hidden
    });

    it('viewMenuState: feature views hide/disable; tree Hide disabled once other tabs exist', () => {
        const { views, addRecent, tabs } = setup({});
        addRecent({ showKey: 'showRecentBookmarks', disableKey: 'disableRecentView' });
        expect(tabs()).toHaveLength(3);
        expect(views.viewMenuState('tree')).toEqual({ canHide: false, canDisable: false });
        expect(views.viewMenuState('search')).toEqual({ canHide: false, canDisable: false });
        expect(views.viewMenuState('recent')).toEqual({ canHide: true, canDisable: true });
    });

    it('opens the tab context menu from the dedicated ContextMenu / Shift+F10 keys', () => {
        const { byId, tabs, addRecent } = setup({});
        addRecent({ showKey: 'showRecentBookmarks', disableKey: 'disableRecentView' });
        const treeTab = tabs()[0];
        byId['view-tabs'].trigger('keydown', { key: 'ContextMenu' });
        expect(treeTab._dispatched.map(e => e.type)).toContain('contextmenu');
        treeTab._dispatched.length = 0;
        byId['view-tabs'].trigger('keydown', { key: 'F10', shiftKey: true });
        expect(treeTab._dispatched.map(e => e.type)).toContain('contextmenu');
        treeTab._dispatched.length = 0;
        byId['view-tabs'].trigger('keydown', { key: 'F10' });
        expect(treeTab._dispatched).toHaveLength(0);
    });

    it('toasts a return hint when entering a hidden view via palette (strip visible)', () => {
        const toasts = [];
        const { views, addRecent } = setup({ toastAction: msg => toasts.push(msg) });
        addRecent({ showKey: 'showRecentBookmarks', disableKey: 'disableRecentView' });
        views.hideViewTab('recent');
        expect(toasts).toHaveLength(0);
        views.activate('recent');
        expect(toasts).toHaveLength(1);
        expect(toasts[0]).toContain('viewHiddenTabsHint');
        expect(toasts[0]).toContain('Recent');
        expect(toasts[0]).toContain('Esc');
        views.activate('tree');
        expect(toasts).toHaveLength(1); // returning to tree never toasts
    });

    it('toasts a return hint when entering a non-tree view with the tab strip hidden', () => {
        const toasts = [];
        const { views } = setup({ storeData: { showViewTabs: '' }, toastAction: msg => toasts.push(msg) });
        expect(views.activate('search')).toBe(true);
        expect(toasts).toHaveLength(1);
        expect(toasts[0]).toContain('viewHiddenTabsHint');
        expect(toasts[0]).toContain('Search');
        expect(toasts[0]).toContain('Esc');
        views.activate('tree');
        expect(toasts).toHaveLength(1); // returning to tree never toasts
    });
});

describe('activate', () => {
    it('switches containers, tab ARIA, the indicator and the persisted activeView', () => {
        const { views, store, byId, tabs, indicator } = setup({});
        const searchTab = tabs()[1];
        searchTab.offsetWidth = 64;
        searchTab.offsetLeft = 100;
        expect(views.activate('search')).toBe(true);
        expect(views.activeId()).toBe('search');
        expect(byId['view-tree'].hidden).toBe(true);
        expect(byId['view-search'].hidden).toBe(false);
        expect(store.get('activeView')).toBe('search');
        expect(tabs()[0].getAttribute('aria-selected')).toBe('false');
        expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
        expect(tabs()[0].tabIndex).toBe(-1);
        expect(tabs()[1].tabIndex).toBe(0);
        expect(indicator().style.opacity).toBe('1');
        expect(indicator().style.width).toBe('64px');
        expect(indicator().style.transform).toBe('translateX(100px)');
    });

    it('activating the current view is a no-op returning true', () => {
        const { views, store } = setup({});
        const calls = [];
        views.attach('tree', { deactivate: () => calls.push('deactivate') });
        store.setCalls = [];
        expect(views.activate('tree')).toBe(true);
        expect(calls).toEqual([]);
        expect(store.setCalls).toEqual([]);
    });

    it('refuses unknown and disabled views, but hidden views stay activatable', () => {
        const hidden = setup({});
        expect(hidden.views.activate('nope')).toBe(false);
        hidden.addRecent({ hidden: true });
        expect(hidden.views.activate('recent')).toBe(true); // hidden ≠ disabled

        const disabled = setup({ storeData: { disableRecentView: '1' } });
        disabled.addRecent({ showKey: 'showRecentBookmarks', disableKey: 'disableRecentView' });
        expect(disabled.views.activate('recent')).toBe(false);
        expect(disabled.views.activeId()).toBe('tree');
    });

    it('re-registering an existing id merges the definition', () => {
        const { views, tabs } = setup({});
        const tree = views.views().find(v => v.id === 'tree');
        views.register({
            id: 'tree', titleKey: 'viewTree', icon: '<svg/>',
            container: tree.container, listEl: tree.listEl, typeAhead: true
        });
        expect(tabs()).toHaveLength(2); // no duplicate tab
        expect(views.views().filter(v => v.id === 'tree')).toHaveLength(1);
        expect(views.views().find(v => v.id === 'tree').typeAhead).toBe(true);
    });

    it('persists scroll positions of persistScroll views into viewState and restores them', () => {
        const { views, store, addRecent } = setup({});
        const recent = addRecent({ persistScroll: true });
        views.activate('recent', { keepFocus: true });
        recent.listEl.scrollTop = 42;
        views.activate('tree', { keepFocus: true });
        // v4 task-3 #7: viewState entries are { scroll, focus } objects now —
        // scroll for persistScroll views, focus for the remembered row (§2.1).
        expect(JSON.parse(store.get('viewState'))).toEqual({
            tree: { scroll: 0, focus: null },
            recent: { scroll: 42, focus: null }
        });
        recent.listEl.scrollTop = 0;
        views.activate('recent', { keepFocus: true });
        expect(recent.listEl.scrollTop).toBe(42);
    });

    it('runs the deactivate/activate hooks in order with the keepFocus flag', () => {
        const { views, addRecent } = setup({});
        const calls = [];
        views.attach('tree', { deactivate: () => calls.push(['deactivate', 'tree']) });
        addRecent({ activate: o => calls.push(['activate', 'recent', o]) });
        views.activate('recent', { keepFocus: true });
        expect(calls).toEqual([
            ['deactivate', 'tree'],
            ['activate', 'recent', { keepFocus: true }]
        ]);
    });

    it('passes opts.preset through to the view activate hook (v4 task-4 #6)', () => {
        const { views, addRecent } = setup({});
        const calls = [];
        addRecent({ activate: o => calls.push(o) });
        views.activate('recent', { preset: { scan: true } });
        expect(calls).toEqual([{ keepFocus: false, preset: { scan: true } }]);
        calls.length = 0;
        views.activate('tree');
        views.activate('recent'); // no preset: the hook still gets the shape
        expect(calls).toEqual([{ keepFocus: false, preset: undefined }]);
    });

    it('moves focus to the view focus hook by default', () => {
        const { views, addRecent } = setup({});
        const calls = [];
        addRecent({ focus: () => calls.push('focus') });
        views.activate('recent');
        expect(calls).toEqual(['focus']);
    });

    it('falls back to the .focus row, then the first list row', () => {
        const { views, addRecent, makeEl } = setup({});
        const recent = addRecent();
        const row = makeEl('a');
        const li = makeEl('li');
        li.appendChild(row);
        recent.listEl.appendChild(li);
        views.activate('recent');
        expect(row.focused).toBe(true);
        // a .focus element wins over the first row
        const marked = makeEl('a');
        marked.classList.add('focus');
        const li2 = makeEl('li');
        li2.appendChild(marked);
        recent.listEl.appendChild(li2);
        views.activate('tree');
        views.activate('recent');
        expect(marked.focusCount).toBe(1);
        expect(row.focusCount).toBe(1);
    });

    it('keepFocus leaves the focus alone; focusTab focuses the tab', () => {
        const { views, addRecent, doc, tabs } = setup({});
        const calls = [];
        addRecent({ focus: () => calls.push('focus') });
        views.activate('recent', { keepFocus: true });
        expect(calls).toEqual([]);
        expect(doc.activeElement).toBeNull();
        views.activate('tree', { focusTab: true });
        expect(tabs()[0].focused).toBe(true);
    });

    it('remembers the focused row and re-marks it when the view is re-entered (§2.1)', () => {
        const { views, store, addRecent, makeEl } = setup({});
        const recent = addRecent();
        const li1 = makeEl('li');
        li1.id = 'recent-item-1';
        const a1 = makeEl('a');
        li1.appendChild(a1);
        const li2 = makeEl('li');
        li2.id = 'recent-item-2';
        const a2 = makeEl('a');
        li2.appendChild(a2);
        recent.listEl.appendChild(li1);
        recent.listEl.appendChild(li2);
        views.activate('recent', { keepFocus: true });
        a2.focus(); // the user arrows onto row 2
        views.activate('tree', { keepFocus: true });
        expect(JSON.parse(store.get('viewState')).recent.focus).toBe('recent-item-2');
        views.activate('recent', { keepFocus: true });
        expect(a2.classList.contains('focus')).toBe(true);
        expect(a1.classList.contains('focus')).toBe(false);
    });

    it('falls back to the .focus-marked row when remembering', () => {
        const { views, store, addRecent, makeEl } = setup({});
        const recent = addRecent();
        const li = makeEl('li');
        li.id = 'recent-item-9';
        const a = makeEl('a');
        a.classList.add('focus');
        li.appendChild(a);
        recent.listEl.appendChild(li);
        views.activate('recent', { keepFocus: true });
        views.activate('tree', { keepFocus: true });
        expect(JSON.parse(store.get('viewState')).recent.focus).toBe('recent-item-9');
    });

    it('drops the memory silently when the remembered row no longer exists', () => {
        const { views, addRecent, makeEl } = setup({});
        const recent = addRecent();
        const li = makeEl('li');
        li.id = 'recent-item-5';
        const a = makeEl('a');
        li.appendChild(a);
        recent.listEl.appendChild(li);
        views.activate('recent', { keepFocus: true });
        a.focus();
        views.activate('tree', { keepFocus: true });
        recent.listEl.innerHTML = ''; // a re-render wiped the rows
        views.activate('recent', { keepFocus: true });
        expect(recent.listEl.querySelector('.focus')).toBeNull();
    });

    it('marks the row container itself when it has no inner a/span (dead-start model)', () => {
        const { views, addRecent, makeEl } = setup({});
        const recent = addRecent();
        const li = makeEl('li');
        li.id = 'dead-start';
        li.appendChild(makeEl('i'));
        recent.listEl.appendChild(li);
        views.activate('recent', { keepFocus: true });
        li.focus(); // the tabindex row itself held focus
        views.activate('tree', { keepFocus: true });
        views.activate('recent', { keepFocus: true });
        expect(li.classList.contains('focus')).toBe(true);
    });

    it('marks the anchor of a button-led row, never the bare li (dupes member shape)', () => {
        // Regression: the dupes member rows lead with <button.keeper-radio>,
        // so a firstElementChild heuristic resolves the row target to the
        // tabindex-less li — the marker landed where no focus walk ever
        // looks. The shared contract (list-focus.js) finds the anchor.
        const { views, addRecent, makeEl } = setup({});
        const recent = addRecent();
        const li = makeEl('li');
        li.id = 'dupes-item-5';
        li.appendChild(makeEl('button')); // the keeper radio leads the row
        const a = makeEl('a');
        li.appendChild(a);
        recent.listEl.appendChild(li);
        views.activate('recent', { keepFocus: true });
        a.focus(); // the user arrows onto the row
        views.activate('tree', { keepFocus: true });
        views.activate('recent', { keepFocus: true });
        expect(a.classList.contains('focus')).toBe(true);
        expect(li.classList.contains('focus')).toBe(false);
    });

    it('remember off: viewState is neither written nor restored (stale key cleared)', () => {
        // The same gate the focusSpot memory and the tree's focusID/scroll
        // restore live under: with 记住之前的状态 off, the per-view scroll +
        // remembered row must not cross sessions — nor be written mid-session.
        const { views, store, addRecent, makeEl } = setup({
            getRememberState: () => false,
            storeData: { viewState: '{"recent":{"scroll":30,"focus":"recent-item-2"}}' }
        });
        expect(store.get('viewState')).toBe(null); // stale record dropped at startup
        const recent = addRecent({ persistScroll: true });
        const li = makeEl('li');
        li.id = 'recent-item-2';
        const a = makeEl('a');
        li.appendChild(a);
        recent.listEl.appendChild(li);
        views.activate('recent', { keepFocus: true });
        expect(recent.listEl.scrollTop).toBe(0); // no scroll restore
        expect(a.classList.contains('focus')).toBe(false); // no row re-mark
        a.focus();
        recent.listEl.scrollTop = 42;
        views.activate('tree', { keepFocus: true });
        expect(store.get('viewState')).toBe(null); // nothing written on switch-away
        views.activate('recent', { keepFocus: true });
        expect(recent.listEl.scrollTop).toBe(42); // untouched — nothing was persisted to restore
        expect(a.classList.contains('focus')).toBe(false);
    });

    it('a .focus marker inside a dropdown listbox is skipped by focusDefault (5421968)', () => {
        // keyboard.js's toolbar ↓ path carries the same guard: a marker
        // parked on a hidden listbox option is not a row — focusing it
        // silently dead-ends; fall through to the first real row.
        const { views, addRecent, makeEl } = setup({});
        const recent = addRecent();
        const dropdown = makeEl('div');
        dropdown.classList.add('vbm-dropdown');
        const listbox = makeEl('ul');
        listbox.classList.add('vbm-dropdown-list');
        const option = makeEl('li');
        option.classList.add('focus'); // the stale marker parked on the option
        dropdown.appendChild(listbox);
        listbox.appendChild(option);
        recent.listEl.appendChild(dropdown);
        const li = makeEl('li');
        const a = makeEl('a');
        li.appendChild(a);
        recent.listEl.appendChild(li);
        views.activate('recent');
        expect(option.focused).toBe(false); // never the hidden option
        expect(a.focused).toBe(true); // the first real row instead
    });

    it('reads legacy numeric viewState entries as scroll-only', () => {
        const { views, addRecent } = setup({ storeData: { viewState: '{"recent": 30}' } });
        const recent = addRecent({ persistScroll: true });
        views.activate('recent', { keepFocus: true });
        expect(recent.listEl.scrollTop).toBe(30);
    });

    it('tracks the focused row with a live .focus marker (focusin)', () => {
        const { views, addRecent, makeEl } = setup({});
        const recent = addRecent();
        const li1 = makeEl('li');
        const a1 = makeEl('a');
        li1.appendChild(a1);
        const li2 = makeEl('li');
        const a2 = makeEl('a');
        li2.appendChild(a2);
        recent.listEl.appendChild(li1);
        recent.listEl.appendChild(li2);
        recent.listEl.trigger('focusin', { target: a1 });
        expect(a1.classList.contains('focus')).toBe(true);
        recent.listEl.trigger('focusin', { target: a2 });
        expect(a1.classList.contains('focus')).toBe(false);
        expect(a2.classList.contains('focus')).toBe(true);
        // in-list toolbar controls never take the marker
        const btn = makeEl('button');
        recent.listEl.appendChild(btn);
        recent.listEl.trigger('focusin', { target: btn });
        expect(btn.classList.contains('focus')).toBe(false);
        expect(a2.classList.contains('focus')).toBe(true);
    });

    it('a dropdown listbox option never takes the .focus marker (4.0.1 regressions gate)', () => {
        // The dupes toolbar's custom dropdowns render <li role="option"
        // tabindex="-1"> inside #dupes-list. Before the guard, opening the
        // listbox focused such an option, which matched the LI[tabindex] row
        // heuristic and STOLE the remembered-row marker — the toolbar rung's
        // ↓ then targeted the hidden option (querySelector('.focus')) and the
        // crossing into the rows silently died.
        const { views, addRecent, makeEl } = setup({});
        const recent = addRecent();
        const li1 = makeEl('li');
        const a1 = makeEl('a');
        li1.appendChild(a1);
        recent.listEl.appendChild(li1);
        recent.listEl.trigger('focusin', { target: a1 });
        expect(a1.classList.contains('focus')).toBe(true);
        // a dropdown: <div.vbm-dropdown><ul.vbm-dropdown-list><li[tabindex]>
        const dropdown = makeEl('div');
        dropdown.classList.add('vbm-dropdown');
        const listbox = makeEl('ul');
        listbox.classList.add('vbm-dropdown-list');
        const option = makeEl('li');
        option.setAttribute('tabindex', '-1');
        option.classList.add('vbm-dropdown-option');
        dropdown.appendChild(listbox);
        listbox.appendChild(option);
        recent.listEl.appendChild(dropdown);
        // focusing the option must NOT displace the row marker
        recent.listEl.trigger('focusin', { target: option });
        expect(option.classList.contains('focus')).toBe(false);
        expect(a1.classList.contains('focus')).toBe(true);
    });

    it('remembers the row via the live marker when a mouse switch moved focus first', () => {
        // Real-mouse path: clicking a view tab focuses the BUTTON before the
        // click handler runs activate(), so document.activeElement no longer
        // points at the row — only the focusin-maintained marker survives.
        const { views, store, addRecent, makeEl, tabs } = setup({});
        const recent = addRecent();
        const li1 = makeEl('li');
        li1.id = 'recent-item-1';
        const a1 = makeEl('a');
        li1.appendChild(a1);
        const li2 = makeEl('li');
        li2.id = 'recent-item-2';
        const a2 = makeEl('a');
        li2.appendChild(a2);
        recent.listEl.appendChild(li1);
        recent.listEl.appendChild(li2);
        views.activate('recent', { keepFocus: true });
        recent.listEl.trigger('focusin', { target: a2 }); // user arrowed to row 2
        tabs()[0].focus(); // the tree tab click grabs focus first…
        views.activate('tree', { keepFocus: true }); // …then activate runs
        expect(JSON.parse(store.get('viewState')).recent.focus).toBe('recent-item-2');
        views.activate('recent', { keepFocus: true });
        expect(a2.classList.contains('focus')).toBe(true);
    });

    it('re-marks the remembered row after the view async re-renders (real timers)', async () => {
        // The real views fetch + innerHTML-render inside/after their activate
        // hook (recent: probePermission → refresh → render), wiping a marker
        // restored synchronously. restoreFocusRow watches briefly and re-marks.
        const { views, store, addRecent, makeEl } = setup({});
        const recent = addRecent({
            activate: () => {
                setTimeout(() => {
                    recent.listEl.innerHTML = ''; // wipe, like a real re-render
                    const li = makeEl('li');
                    li.id = 'recent-item-7';
                    li.appendChild(makeEl('a'));
                    recent.listEl.appendChild(li);
                }, 20);
            }
        });
        store.set('viewState', JSON.stringify({ recent: { scroll: 0, focus: 'recent-item-7' } }));
        views.activate('recent', { keepFocus: true });
        await new Promise(r => setTimeout(r, 250));
        const li = recent.listEl.children[0];
        expect(li && li.firstElementChild.classList.contains('focus')).toBe(true);
    });

    it('announces switches through the aria-live region, silently at startup', () => {
        const { views, byId } = setup({});
        expect(byId['view-announce'].textContent).toBe(''); // startup stayed quiet
        views.activate('search', { keepFocus: true });
        expect(byId['view-announce'].textContent).toBe('viewSwitchAnnounce[Search]');
        views.activate('tree', { keepFocus: true });
        expect(byId['view-announce'].textContent).toBe('viewSwitchAnnounce[Tree]');
    });

    it('restarts the view-enter fade on every switch', () => {
        const { views, byId } = setup({});
        byId['view-tree'].classList.remove('view-enter'); // clear the startup state
        views.activate('search', { keepFocus: true });
        expect(byId['view-search'].classList.contains('view-enter')).toBe(true);
        views.activate('tree', { keepFocus: true });
        expect(byId['view-tree'].classList.contains('view-enter')).toBe(true);
    });
});

describe('Escape levels (§3.4)', () => {
    it('onEscapeActive forwards to the active view hook', () => {
        const { views, addRecent } = setup({});
        expect(views.onEscapeActive()).toBe(false); // tree has no hook
        addRecent({ onEscape: () => true });
        views.activate('recent', { keepFocus: true });
        expect(views.onEscapeActive()).toBe(true);
    });

    it('escapeToTree activates the first view, or returns false when already there', () => {
        const { views } = setup({});
        expect(views.escapeToTree()).toBe(false);
        views.activate('search', { keepFocus: true });
        expect(views.escapeToTree()).toBe(true);
        expect(views.activeId()).toBe('tree');
    });
});

describe('menu dismissal on view switches (round-3 item 3)', () => {
    it('activate clears any open context menu before switching', () => {
        const { views, clearMenuCalls } = setup({});
        clearMenuCalls.length = 0; // startup activation already ran
        views.activate('search', { keepFocus: true });
        expect(clearMenuCalls).toEqual([1]);
        // re-activating the same view is a no-op (no extra clear)
        views.activate('search', { keepFocus: true });
        expect(clearMenuCalls).toEqual([1]);
    });

    it('the Ctrl/Cmd+number jump clears menus through the same path', () => {
        const ctx = setup({});
        ctx.clearMenuCalls.length = 0;
        const ev = {
            key: '2', ctrlKey: true, altKey: false, shiftKey: false,
            defaultPrevented: false,
            preventDefault() { this.defaultPrevented = true; }
        };
        ctx.fireDoc('keydown', ev);
        expect(ctx.views.activeId()).toBe('search');
        expect(ctx.clearMenuCalls).toEqual([1]);
    });
});

describe('keyboard registration (lists/listOf)', () => {
    it('exposes the list containers of visible views with their type-ahead flag', () => {
        const { views, byId, addRecent, makeEl } = setup({});
        const recent = addRecent({ typeAhead: false });
        views.register({ // hidden view: no tab, but its list keeps a binding
            id: 'dead', titleKey: 'viewDead', icon: '<svg/>',
            container: makeEl(), listEl: makeEl(), hidden: true, typeAhead: false
        });
        expect(views.lists()).toEqual([
            { id: 'tree', el: byId.tree, typeAhead: true, onKey: null },
            { id: 'search', el: byId.results, typeAhead: true, onKey: null },
            { id: 'recent', el: recent.listEl, typeAhead: false, onKey: null },
            { id: 'dead', el: views.views().find(v => v.id === 'dead').listEl, typeAhead: false, onKey: null }
        ]);
        expect(views.listOf(byId.tree).id).toBe('tree');
        expect(views.listOf(byId.results).id).toBe('search');
        expect(views.listOf(recent.listEl)).toEqual({ id: 'recent', el: recent.listEl, typeAhead: false, onKey: null });
        expect(views.listOf({})).toBeNull();
    });

    it('passes a view onKey hook through to its lists() entry', () => {
        const { views, addRecent } = setup({});
        const onKey = () => true;
        addRecent({ typeAhead: false, onKey });
        expect(views.lists()[2].onKey).toBe(onKey);
    });
});

describe('focusTop (§2.1 region crossing)', () => {
    it('focuses the active tab when the strip is visible', () => {
        const { views, tabs } = setup({});
        views.focusTop();
        expect(tabs()[0].focused).toBe(true);
    });

    it('focuses the search input when the strip is hidden', () => {
        const { views, byId, doc } = setup({ storeData: { showViewTabs: '' } });
        expect(doc.body.classList.contains('no-view-tabs')).toBe(true);
        views.focusTop();
        expect(byId['search-input'].focused).toBe(true);
    });
});

describe('focusDown (final polish: header ↓ zone chain)', () => {
    it('focuses the active tab when the strip is visible', () => {
        const { views, tabs } = setup({});
        views.focusDown();
        expect(tabs()[0].focused).toBe(true);
    });

    it('enters the active list directly when the strip is hidden (never the box)', () => {
        const { views, byId, doc } = setup({ storeData: { showViewTabs: '' } });
        expect(doc.body.classList.contains('no-view-tabs')).toBe(true);
        const li = doc.createElement('li');
        const a = doc.createElement('a');
        li.children.push(a);
        byId['tree'].children.push(li);
        views.focusDown();
        expect(a.focused).toBe(true);
        expect(byId['search-input'].focused).toBe(false);
    });
});

describe('in-list toolbar rung (§2.5, final-polish revision)', () => {
    const addStats = (ctx, { disabledFirst = false } = {}) => {
        const container = ctx.makeEl();
        const toolbar = ctx.makeEl('div');
        toolbar.classList.add('vbm-toolbar');
        const b1 = ctx.makeEl('button');
        const b2 = ctx.makeEl('button');
        if (disabledFirst)
            b1.disabled = true;
        toolbar.appendChild(b1);
        toolbar.appendChild(b2);
        container.appendChild(toolbar);
        const listEl = ctx.makeEl();
        container.appendChild(listEl);
        ctx.views.register({
            id: 'stats', titleKey: 'viewStats', icon: '<svg/>', container, listEl
        });
        return { container, toolbar, b1, b2, listEl };
    };
    const fireTabs = (ctx, key) => {
        const ev = { key, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
        ctx.byId['view-tabs'].trigger('keydown', ev);
        return ev;
    };

    it('focusToolbar lands on the first enabled control of the active view', () => {
        const ctx = setup({});
        const { b1 } = addStats(ctx);
        ctx.views.activate('stats');
        expect(ctx.views.focusToolbar()).toBe(true);
        expect(b1.focused).toBe(true);
    });

    it('focusToolbar skips disabled controls and reports false without a toolbar', () => {
        const ctx = setup({});
        const { b2 } = addStats(ctx, { disabledFirst: true });
        ctx.views.activate('stats');
        ctx.views.focusToolbar();
        expect(b2.focused).toBe(true);
        ctx.views.activate('tree'); // the tree has no .vbm-toolbar
        expect(ctx.views.focusToolbar()).toBe(false);
    });

    it('strip ↓ lands on the toolbar rung before the rows', () => {
        const ctx = setup({});
        const { b1, listEl } = addStats(ctx);
        const li = ctx.makeEl('li');
        const a = ctx.makeEl('a');
        li.appendChild(a);
        listEl.appendChild(li);
        ctx.views.activate('stats');
        a.focused = false; // activation's focusDefault already proved itself
        const down = fireTabs(ctx, 'ArrowDown');
        expect(down.defaultPrevented).toBe(true);
        expect(b1.focused).toBe(true);
        expect(a.focused).toBe(false);
    });

    it('strip ↓ still enters the rows directly for toolbar-less views', () => {
        const ctx = setup({});
        const li = ctx.makeEl('li');
        const a = ctx.makeEl('a');
        li.appendChild(a);
        ctx.byId.tree.appendChild(li);
        fireTabs(ctx, 'ArrowDown'); // the tree is active: no toolbar rung
        expect(a.focused).toBe(true);
    });

    it('focusDown (header ↓) with the strip hidden enters the toolbar rung', () => {
        const ctx = setup({ storeData: { showViewTabs: '' } });
        const { b1 } = addStats(ctx);
        ctx.views.activate('stats');
        ctx.views.focusDown();
        expect(b1.focused).toBe(true);
    });

    it('focusListExit prefers the toolbar, falls back to focusTop without one', () => {
        const ctx = setup({});
        const { b1 } = addStats(ctx);
        ctx.views.activate('stats');
        ctx.views.focusListExit();
        expect(b1.focused).toBe(true);
        ctx.views.activate('tree');
        ctx.views.focusListExit();
        expect(ctx.tabs()[0].focused).toBe(true); // focusTop: the active tab
    });

    it('two stacked toolbars: strip ↓ takes the top rung, ↑ from rows the lowest (v4 task-4 #13)', () => {
        const ctx = setup({});
        const { container, toolbar, b1, b2 } = addStats(ctx);
        // a second rung BELOW the first (dead view: proxy strip over scan bar)
        const bar2 = ctx.makeEl('div');
        bar2.classList.add('vbm-toolbar');
        const c1 = ctx.makeEl('button');
        const c2 = ctx.makeEl('button');
        bar2.appendChild(c1);
        bar2.appendChild(c2);
        container.appendChild(bar2);
        ctx.views.activate('stats');
        ctx.views.focusToolbar(); // strip-↓ landing: the TOPMOST rung
        expect(b1.focused).toBe(true);
        expect(c1.focused).toBe(false);
        ctx.views.focusListExit(); // ↑-from-rows landing: the LOWEST rung
        expect(c1.focused).toBe(true);
        // a disabled-only rung is skipped on both landings
        c1.disabled = true;
        c2.disabled = true;
        ctx.views.focusListExit();
        expect(b1.focused).toBe(true);
        // disable the top rung too → no rung at all
        b1.disabled = true;
        b2.disabled = true;
        expect(ctx.views.focusToolbar()).toBe(false);
        expect(ctx.views.focusToolbar(true)).toBe(false);
    });
});

describe('tab strip keyboard model (§2.2)', () => {
    const fireTabs = (ctx, key) => {
        const ev = { key, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
        ctx.byId['view-tabs'].trigger('keydown', ev);
        return ev;
    };

    it('ArrowRight/ArrowLeft move across tabs with auto-activation and wrap-around', () => {
        const ctx = setup({});
        ctx.addRecent();
        let ev = fireTabs(ctx, 'ArrowRight');
        expect(ev.defaultPrevented).toBe(true);
        expect(ctx.views.activeId()).toBe('search');
        expect(ctx.tabs()[1].focused).toBe(true); // focusTab
        fireTabs(ctx, 'ArrowRight');
        expect(ctx.views.activeId()).toBe('recent');
        fireTabs(ctx, 'ArrowRight'); // wraps to the first
        expect(ctx.views.activeId()).toBe('tree');
        fireTabs(ctx, 'ArrowLeft'); // wraps to the last
        expect(ctx.views.activeId()).toBe('recent');
    });

    it('flips the arrow semantics in RTL', () => {
        const ctx = setup({ rtl: true });
        ctx.addRecent();
        fireTabs(ctx, 'ArrowRight'); // visually leftwards: previous
        expect(ctx.views.activeId()).toBe('recent');
        fireTabs(ctx, 'ArrowLeft');
        expect(ctx.views.activeId()).toBe('tree');
    });

    it('Home/End are view-scoped: the CURRENT view\'s first/last row, never a view switch (4.0.1 P4)', () => {
        const ctx = setup({});
        ctx.addRecent();
        // two rows in the tree view's list (the ACTIVE view)
        const mkRow = () => {
            const li = ctx.makeEl('li');
            const a = ctx.makeEl('a');
            li.appendChild(a);
            ctx.byId.tree.appendChild(li);
            return a;
        };
        const first = mkRow();
        const last = mkRow();
        const end = fireTabs(ctx, 'End');
        expect(end.defaultPrevented).toBe(true);
        expect(last.focused).toBe(true);
        expect(ctx.views.activeId()).toBe('tree'); // no view switch
        ctx.tabs()[0].focus(); // back on the strip
        const home = fireTabs(ctx, 'Home');
        expect(home.defaultPrevented).toBe(true);
        expect(first.focused).toBe(true);
        expect(ctx.views.activeId()).toBe('tree'); // still no view switch
    });

    it('strip Home/End with NO rows keep focus on the current tab (and never switch)', () => {
        const ctx = setup({});
        ctx.addRecent();
        const tab = ctx.tabs()[0];
        tab.focus();
        const home = fireTabs(ctx, 'Home');
        expect(home.defaultPrevented).toBe(true);
        expect(ctx.doc.activeElement).toBe(tab); // focus simply stayed on the tab
        expect(ctx.views.activeId()).toBe('tree');
        fireTabs(ctx, 'End');
        expect(ctx.doc.activeElement).toBe(tab);
        expect(ctx.views.activeId()).toBe('tree');
    });

    it('strip Home/End never reach into another view\'s rows', () => {
        const ctx = setup({});
        // rows only in the (inactive) search view — the active tree has none
        const li = ctx.makeEl('li');
        const a = ctx.makeEl('a');
        li.appendChild(a);
        ctx.byId.results.appendChild(li);
        const tab = ctx.tabs()[0];
        tab.focus();
        fireTabs(ctx, 'End');
        expect(a.focused).toBe(false);
        expect(ctx.doc.activeElement).toBe(tab);
        expect(ctx.views.activeId()).toBe('tree');
    });

    it('ArrowUp reaches the search input, ArrowDown enters the list', () => {
        const ctx = setup({});
        const row = ctx.makeEl('a');
        const li = ctx.makeEl('li');
        li.appendChild(row);
        ctx.byId.tree.appendChild(li);
        const up = fireTabs(ctx, 'ArrowUp');
        expect(up.defaultPrevented).toBe(true);
        expect(ctx.byId['search-input'].focused).toBe(true);
        const down = fireTabs(ctx, 'ArrowDown');
        expect(down.defaultPrevented).toBe(true);
        expect(row.focused).toBe(true);
    });
});

describe('Ctrl/Cmd/Alt+number direct jump (§3.4, v4 task-4 #10)', () => {
    const key = (ctx, k, mods = {}) => {
        const ev = {
            key: k, code: mods.code, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta,
            altKey: !!mods.alt, shiftKey: !!mods.shift, defaultPrevented: false,
            preventDefault() { this.defaultPrevented = true; }
        };
        ctx.fireDoc('keydown', ev);
        return ev;
    };

    it('activates the nth visible view', () => {
        const ctx = setup({});
        const ev = key(ctx, '2', { ctrl: true });
        expect(ev.defaultPrevented).toBe(true);
        expect(ctx.views.activeId()).toBe('search');
        key(ctx, '1', { meta: true });
        expect(ctx.views.activeId()).toBe('tree');
    });

    it('Alt+digit is the portable twin (Edge reserves Ctrl+1…8 for browser tabs)', () => {
        const ctx = setup({});
        const ev = key(ctx, '2', { alt: true });
        expect(ev.defaultPrevented).toBe(true);
        expect(ctx.views.activeId()).toBe('search');
        key(ctx, '1', { alt: true });
        expect(ctx.views.activeId()).toBe('tree');
    });

    it('ignores out-of-range digits, modifier combos and plain digits', () => {
        const ctx = setup({});
        expect(key(ctx, '9', { ctrl: true }).defaultPrevented).toBe(false);
        expect(key(ctx, '9', { alt: true }).defaultPrevented).toBe(false);
        expect(key(ctx, '1', { ctrl: true, shift: true }).defaultPrevented).toBe(false);
        expect(key(ctx, '1', { alt: true, shift: true }).defaultPrevented).toBe(false);
        // Ctrl+Alt = AltGr on several layouts (types characters): never a jump
        expect(key(ctx, '1', { ctrl: true, alt: true }).defaultPrevented).toBe(false);
        expect(key(ctx, '1').defaultPrevented).toBe(false);
        expect(ctx.views.activeId()).toBe('tree');
    });

    it('switches even from the search box (the Ctrl+2 landing spot), so Ctrl+1/3… can get back out', () => {
        const ctx = setup({});
        ctx.doc.activeElement = ctx.byId['search-input']; // Ctrl+2 lands here
        const ev = key(ctx, '2', { ctrl: true });
        expect(ev.defaultPrevented).toBe(true);
        expect(ctx.views.activeId()).toBe('search');
        // and back out again — the regression: the old input-owns guard
        // swallowed every further Ctrl+digit once focus was in the box
        expect(key(ctx, '1', { ctrl: true }).defaultPrevented).toBe(true);
        expect(ctx.views.activeId()).toBe('tree');
    });

    it('a modal dialog (body need* class) keeps the shortcut off — no form yank', () => {
        const ctx = setup({});
        ctx.doc.body.classList.add('needEdit');
        ctx.doc.activeElement = ctx.byId['search-input'];
        expect(key(ctx, '2', { ctrl: true }).defaultPrevented).toBe(false);
        expect(ctx.views.activeId()).toBe('tree');
    });

    it('the open command palette keeps the shortcut off (its input owns the key)', () => {
        const ctx = setup({});
        const palette = ctx.makeEl('div');
        palette.hidden = false;
        ctx.byId['command-palette'] = palette;
        ctx.doc.activeElement = ctx.byId['search-input'];
        expect(key(ctx, '2', { ctrl: true }).defaultPrevented).toBe(false);
        expect(ctx.views.activeId()).toBe('tree');
    });

    it('numpad digits are never a jump (Windows Alt-code input types characters) — K19', () => {
        const ctx = setup({});
        expect(key(ctx, '1', { alt: true, code: 'Numpad1' }).defaultPrevented).toBe(false);
        expect(key(ctx, '2', { ctrl: true, code: 'Numpad2' }).defaultPrevented).toBe(false);
        expect(ctx.views.activeId()).toBe('tree');
        // sanity: the top-row digit still jumps — only the numpad is excluded
        expect(key(ctx, '2', { ctrl: true, code: 'Digit2' }).defaultPrevented).toBe(true);
        expect(ctx.views.activeId()).toBe('search');
    });
});

describe('tab badges', () => {
    it('renders the badge count and hides it at zero', () => {
        const ctx = setup({});
        let n = 0;
        const recent = ctx.addRecent({ badge: () => n });
        const badge = () => recent.tabEl.querySelector('.tab-badge');
        expect(badge().hidden).toBe(true);
        n = 7;
        ctx.views.updateBadges();
        expect(badge().hidden).toBe(false);
        expect(badge().textContent).toBe('7');
        n = 0;
        ctx.views.updateBadges();
        expect(badge().hidden).toBe(true);
    });

    it('re-evaluates every badge on each activation (counts computed in activate hooks surface immediately)', () => {
        const ctx = setup({});
        let n = 0;
        const recent = ctx.addRecent({ badge: () => n });
        const badge = () => recent.tabEl.querySelector('.tab-badge');
        n = 5;
        ctx.views.activate('recent');
        expect(badge().hidden).toBe(false);
        expect(badge().textContent).toBe('5');
        n = 0;
        ctx.views.activate('tree');
        expect(badge().hidden).toBe(true);
    });

    it('showTabBadges off hides every badge regardless of counts (v4 task-3 #18)', () => {
        const ctx = setup({ storeData: { showTabBadges: '' } });
        const recent = ctx.addRecent({ badge: () => 9 });
        const badge = () => recent.tabEl.querySelector('.tab-badge');
        ctx.views.updateBadges();
        expect(badge().hidden).toBe(true);
        ctx.views.activate('recent');
        expect(badge().hidden).toBe(true);
    });
});

describe('shared parent-path map (§3.6)', () => {
    it('pathOf reads the map rebuilt by buildPathMap', () => {
        const { views } = setup({});
        views.buildPathMap([{
            id: '0', title: '', children: [
                {
                    id: '1', parentId: '0', title: 'Folder A', children: [
                        { id: '11', parentId: '1', title: 'GitHub', url: 'https://github.com/' }
                    ]
                },
                { id: '2', parentId: '0', title: 'Top', url: 'https://x.com/' }
            ]
        }]);
        expect(views.pathOf('11')).toBe('Folder A');
        expect(views.pathOf('1')).toBe('');
        expect(views.pathOf('2')).toBe('');
        expect(views.pathOf('unknown')).toBe('');
    });
});

describe('settings', () => {
    it('showItemPath defaults to on', () => {
        expect(setup({}).views.showItemPath()).toBe(true);
        expect(setup({ storeData: { showItemPath: '' } }).views.showItemPath()).toBe(false);
    });
});

// FocusSpot — the unified "where I was" popup-reopen memory: one classifier
// tags the current keyboard location, persists it under `focusSpot` (deduped,
// gated by the remember option), and restoreFocusSpot() returns focus there
// once at startup. Rows / header buttons / view tabs restore exactly; toolbar
// controls restore by (bar, class, position-within-class), degrading to the
// bar's first enabled control when the exact one is gone. Scope: popup reopen
// only — intra-session view switches keep the per-view `.focus` row memory.
describe('focusSpot — unified popup-reopen focus memory', () => {
    describe('capture + persist', () => {
        it('classifies and persists a header button focus', () => {
            const { store, makeEl, fireDoc } = setup({});
            const tool = makeEl('button');
            tool.id = 'tool-btn';
            fireDoc('focusin', { target: tool });
            expect(store._data.focusSpot).toBe(JSON.stringify({ zone: 'header', key: 'tool-btn' }));
        });

        it('classifies and persists a view tab focus', () => {
            const { store, makeEl, fireDoc } = setup({});
            const tab = makeEl('button');
            tab.id = 'view-tab-tree'; // the tree view is active at startup
            tab.classList.add('view-tab');
            fireDoc('focusin', { target: tab });
            expect(store._data.focusSpot).toBe(JSON.stringify({ zone: 'tab', view: 'tree', key: 'tree' }));
        });

        it('classifies and persists a toolbar control by (bar, class, position)', () => {
            const { views, store, makeEl, fireDoc, addRecent } = setup({});
            const container = makeEl('div');
            const bar = makeEl('div');
            bar.className = 'stats-toolbar vbm-toolbar';
            const b1 = makeEl('button');
            b1.className = 'seg-btn';
            const b2 = makeEl('button');
            b2.className = 'seg-btn';
            bar.appendChild(b1);
            bar.appendChild(b2);
            container.appendChild(bar);
            addRecent({ container, listEl: makeEl() });
            views.activate('recent', { keepFocus: true });
            fireDoc('focusin', { target: b2 }); // the second same-class control
            expect(store._data.focusSpot).toBe(JSON.stringify({
                zone: 'toolbar', view: 'recent', bar: 'stats-toolbar', cls: 'seg-btn', idx: 1
            }));
        });

        it('classifies and persists a list row in the active view', () => {
            const { views, store, makeEl, fireDoc, addRecent } = setup({});
            const listEl = makeEl('ul');
            const li = makeEl('li');
            li.id = 'recent-item-5';
            const a = makeEl('a');
            li.appendChild(a);
            listEl.appendChild(li);
            addRecent({ container: makeEl(), listEl });
            views.activate('recent', { keepFocus: true });
            fireDoc('focusin', { target: a });
            expect(store._data.focusSpot).toBe(JSON.stringify({ zone: 'row', view: 'recent', key: 'recent-item-5' }));
        });

        it('a transient location (body / palette / plain element) never displaces the remembered spot', () => {
            const { store, doc, makeEl, fireDoc } = setup({});
            const tool = makeEl('button');
            tool.id = 'tool-btn';
            fireDoc('focusin', { target: tool });
            const before = store._data.focusSpot;
            fireDoc('focusin', { target: doc.body });
            fireDoc('focusin', { target: makeEl('span') });
            const palette = makeEl('div');
            palette.id = 'command-palette';
            const input = makeEl('input');
            palette.appendChild(input);
            fireDoc('focusin', { target: input });
            expect(store._data.focusSpot).toBe(before); // unchanged
        });

        it('dedupes store writes when the spot identity is unchanged', () => {
            const { store, makeEl, fireDoc } = setup({});
            const tool = makeEl('button');
            tool.id = 'tool-btn';
            fireDoc('focusin', { target: tool });
            fireDoc('focusin', { target: tool });
            expect(store.setCalls.filter(([k]) => k === 'focusSpot')).toHaveLength(1);
        });

        it('does not persist when the remember option is off', () => {
            const { store, makeEl, fireDoc } = setup({ getRememberState: () => false });
            const tool = makeEl('button');
            tool.id = 'tool-btn';
            fireDoc('focusin', { target: tool });
            expect(store._data.focusSpot).toBeUndefined();
        });
    });

    describe('restore', () => {
        it('returns focus to a remembered header button', () => {
            const { views, doc, byId, makeEl } = setup({
                storeData: { focusSpot: JSON.stringify({ zone: 'header', key: 'tool-btn' }) }
            });
            const tool = makeEl('button');
            tool.id = 'tool-btn';
            byId['tool-btn'] = tool;
            views.restoreFocusSpot();
            expect(doc.activeElement).toBe(tool);
        });

        it('returns focus to the exact remembered toolbar control', () => {
            const { views, doc, makeEl, addRecent } = setup({
                storeData: {
                    focusSpot: JSON.stringify({
                        zone: 'toolbar', view: 'recent', bar: 'stats-toolbar', cls: 'seg-btn', idx: 1
                    })
                }
            });
            const container = makeEl('div');
            const bar = makeEl('div');
            bar.className = 'stats-toolbar vbm-toolbar';
            const b1 = makeEl('button');
            b1.className = 'seg-btn';
            const b2 = makeEl('button');
            b2.className = 'seg-btn';
            bar.appendChild(b1);
            bar.appendChild(b2);
            container.appendChild(bar);
            addRecent({ container, listEl: makeEl() });
            views.activate('recent', { keepFocus: true });
            views.restoreFocusSpot();
            expect(doc.activeElement).toBe(b2);
        });

        it('degrades to the bar\'s first enabled control when the exact one is disabled', () => {
            const { views, doc, makeEl, addRecent } = setup({
                storeData: {
                    focusSpot: JSON.stringify({
                        zone: 'toolbar', view: 'recent', bar: 'stats-toolbar', cls: 'seg-btn', idx: 1
                    })
                }
            });
            const container = makeEl('div');
            const bar = makeEl('div');
            bar.className = 'stats-toolbar vbm-toolbar';
            const b1 = makeEl('button');
            b1.className = 'seg-btn';
            const b2 = makeEl('button');
            b2.className = 'seg-btn';
            b2.disabled = true;
            bar.appendChild(b1);
            bar.appendChild(b2);
            container.appendChild(bar);
            addRecent({ container, listEl: makeEl() });
            views.activate('recent', { keepFocus: true });
            views.restoreFocusSpot();
            expect(doc.activeElement).toBe(b1);
        });

        it('returns focus to a remembered view tab', () => {
            const { views, doc, byId, makeEl, addRecent } = setup({
                storeData: { focusSpot: JSON.stringify({ zone: 'tab', view: 'recent', key: 'recent' }) }
            });
            addRecent({ container: makeEl(), listEl: makeEl() });
            views.activate('recent', { keepFocus: true }); // the tab's view is active
            const tab = makeEl('button');
            tab.id = 'view-tab-recent';
            tab.classList.add('view-tab');
            byId['view-tab-recent'] = tab;
            views.restoreFocusSpot();
            expect(doc.activeElement).toBe(tab);
        });

        it('returns focus to a remembered list row', () => {
            const { views, doc, makeEl, addRecent } = setup({
                storeData: { focusSpot: JSON.stringify({ zone: 'row', view: 'recent', key: 'recent-item-5' }) }
            });
            const listEl = makeEl('ul');
            const li = makeEl('li');
            li.id = 'recent-item-5';
            const a = makeEl('a');
            li.appendChild(a);
            listEl.appendChild(li);
            addRecent({ container: makeEl(), listEl });
            views.activate('recent', { keepFocus: true });
            views.restoreFocusSpot();
            expect(doc.activeElement).toBe(a);
        });

        it('restores the anchor of a button-led row (the dupes member shape)', () => {
            // Regression: the dupes member row leads with <button.keeper-radio>;
            // resolving the spot to the bare li made .focus() a silent no-op
            // while restoreFocusSpot believed it had succeeded.
            const { views, doc, makeEl, addRecent } = setup({
                storeData: { focusSpot: JSON.stringify({ zone: 'row', view: 'recent', key: 'dupes-item-7' }) }
            });
            const listEl = makeEl('ul');
            const li = makeEl('li');
            li.id = 'dupes-item-7';
            li.appendChild(makeEl('button')); // the keeper radio leads the row
            const a = makeEl('a');
            li.appendChild(a);
            listEl.appendChild(li);
            addRecent({ container: makeEl(), listEl });
            views.activate('recent', { keepFocus: true });
            views.restoreFocusSpot();
            expect(doc.activeElement).toBe(a);
        });

        it('skips a spot whose view did not come up (rememberView off)', () => {
            const { views, doc } = setup({
                storeData: {
                    focusSpot: JSON.stringify({
                        zone: 'toolbar', view: 'stats', bar: 'stats-toolbar', cls: 'x', idx: 0
                    })
                }
            });
            views.restoreFocusSpot();
            expect(doc.activeElement).toBe(null); // active view is the tree — no restore
        });

        it('clears the spot and does nothing when the remember option is off', () => {
            const { views, store } = setup({
                getRememberState: () => false,
                storeData: { focusSpot: JSON.stringify({ zone: 'header', key: 'search-input' }) }
            });
            views.restoreFocusSpot();
            expect(store.get('focusSpot')).toBe(null);
        });

        it('gives up on a phantom target and lands on the view default', async () => {
            vi.useFakeTimers();
            try {
                const { views, doc, byId } = setup({
                    storeData: { focusSpot: JSON.stringify({ zone: 'header', key: 'no-such-id' }) }
                });
                views.restoreFocusSpot();
                await vi.advanceTimersByTimeAsync(2200); // the 20×100ms retry window
                expect(doc.activeElement).toBe(byId['tree']); // focusDefault → the tree container
            } finally {
                vi.useRealTimers();
            }
        });

        it('never steals focus from a user who starts interacting mid-retry', async () => {
            vi.useFakeTimers();
            try {
                const { views, doc, fireDoc } = setup({
                    storeData: { focusSpot: JSON.stringify({ zone: 'header', key: 'no-such-id' }) }
                });
                views.restoreFocusSpot();
                fireDoc('keydown', {}); // the user presses a key during the retry window
                await vi.advanceTimersByTimeAsync(2200);
                expect(doc.activeElement).toBe(null); // no phantom got focused
            } finally {
                vi.useRealTimers();
            }
        });
    });
});
