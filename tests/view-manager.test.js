import { describe, it, expect, beforeEach } from 'vitest';
import { initViewManager } from '../src/view-manager.js';

// view-manager.js uses real DOM APIs (createElement/appendChild/classList/
// querySelector…), so the tests run it against a small hand-rolled DOM: the
// elements record listeners/children and implement the handful of selectors
// the module queries ('.tab-indicator', '.tab-badge', '.focus',
// 'li a, li span'). Assertions target the ViewDef contract of
// docs/v4task-2.md §3 — tab strip ARIA + roving tabindex, activation
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
            focus() {
                this.focused = true;
                this.focusCount++;
                doc.activeElement = this;
            },
            // Minimal Element.closest: tag selectors only ('li' is what the
            // view-manager's focus-memory path asks for).
            closest(sel) {
                for (let n = this; n; n = n.parentNode) {
                    if (n.tagName === sel.toUpperCase())
                        return n;
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
        }
    };
    globalThis.document = doc;
    globalThis.window = {};
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
        clearMenu: opts.noClearMenu ? undefined : () => clearMenuCalls.push(1)
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

    it('refuses unknown and hidden views', () => {
        const { views, addRecent } = setup({});
        expect(views.activate('nope')).toBe(false);
        addRecent({ hidden: true });
        expect(views.activate('recent')).toBe(false);
        expect(views.activeId()).toBe('tree');
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
        views.register({ // hidden view: registered but no tab, no list binding
            id: 'dead', titleKey: 'viewDead', icon: '<svg/>',
            container: makeEl(), listEl: makeEl(), hidden: true
        });
        expect(views.lists()).toEqual([
            { id: 'tree', el: byId.tree, typeAhead: true, onKey: null },
            { id: 'search', el: byId.results, typeAhead: true, onKey: null },
            { id: 'recent', el: recent.listEl, typeAhead: false, onKey: null }
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

    it('Home/End jump to the first/last tab', () => {
        const ctx = setup({});
        ctx.addRecent();
        fireTabs(ctx, 'End');
        expect(ctx.views.activeId()).toBe('recent');
        fireTabs(ctx, 'Home');
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

describe('Ctrl/Cmd+number direct jump (§3.4)', () => {
    const key = (ctx, k, mods = {}) => {
        const ev = {
            key: k, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta,
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

    it('ignores out-of-range digits, other modifiers and plain digits', () => {
        const ctx = setup({});
        expect(key(ctx, '9', { ctrl: true }).defaultPrevented).toBe(false);
        expect(key(ctx, '1', { ctrl: true, shift: true }).defaultPrevented).toBe(false);
        expect(key(ctx, '1', { ctrl: true, alt: true }).defaultPrevented).toBe(false);
        expect(key(ctx, '1').defaultPrevented).toBe(false);
        expect(ctx.views.activeId()).toBe('tree');
    });

    it('never fires while an input owns the keystroke', () => {
        const ctx = setup({});
        ctx.doc.activeElement = ctx.byId['search-input']; // tagName INPUT
        const ev = key(ctx, '2', { ctrl: true });
        expect(ev.defaultPrevented).toBe(false);
        expect(ctx.views.activeId()).toBe('tree');
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
