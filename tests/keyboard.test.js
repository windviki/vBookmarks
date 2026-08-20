import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// keyboard.js touches page globals (document/window/chrome/MouseEvent/
// setTimeout) only inside initKeyboard, so the real module imports cleanly in
// node once the globals are stubbed. ctx.tree/results/menus are element stubs
// wired into a small fake tree (open/closed folders, an "(Empty)" marker row,
// a results list); actions/menus/dialogs/search are recording doubles.
// Listeners are invoked with `this` bound to the element they were registered
// on — the DOM contract treeKeyDown/contextKeyDown rely on. Assertions target
// that event contract (what gets focused, what gets dispatched, which action
// runs) — nothing is copied from the module body.

const makeEvent = (props = {}) => {
    const ev = {
        defaultPrevented: false,
        propagationStopped: false,
        immediatePropagationStopped: false,
        preventDefault() {
            ev.defaultPrevented = true;
        },
        stopPropagation() {
            ev.propagationStopped = true;
        },
        stopImmediatePropagation() {
            ev.propagationStopped = true;
            ev.immediatePropagationStopped = true;
        },
        ...props
    };
    return ev;
};

const fire = (el, type, ev) => {
    for (const fn of (el._listeners[type] || [])) {
        ev.currentTarget = el; // mirrors a real dispatch on the bound element
        fn.call(el, ev); // a listener's `this` is the element it is bound to
    }
};

let initKeyboard;
let timeouts;
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

beforeAll(async () => {
    globalThis.setTimeout = (fn, ms) => {
        timeouts.push([fn, ms]);
        return timeouts.length;
    };
    globalThis.clearTimeout = () => {};
    globalThis.MouseEvent = class {
        constructor(type, opts = {}) {
            this.type = type;
            Object.assign(this, opts);
        }
    };
    ({ initKeyboard } = await import('../src/keyboard.js'));
});

beforeEach(() => {
    timeouts = [];
});

afterAll(() => {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
    delete globalThis.MouseEvent;
});

const setup = (opts = {}) => {
    const allEls = [];
    const byId = {};
    const el = (tagName = 'DIV', id = '') => {
        const classes = new Set();
        const node = {
            tagName,
            id,
            style: {},
            dataset: {},
            parentNode: null,
            parentElement: null,
            nextElementSibling: null,
            previousElementSibling: null,
            firstElementChild: null,
            lastElementChild: null,
            textContent: '',
            value: '',
            focused: false,
            focusCount: 0,
            selected: false,
            offsetTop: 0,
            offsetHeight: 0,
            offsetWidth: 0,
            scrollTop: 0,
            _qs: {},
            _qsa: {},
            _listeners: {},
            _dispatched: [],
            classList: {
                add: (...cs) => cs.forEach(c => classes.add(c)),
                remove: (...cs) => cs.forEach(c => classes.delete(c)),
                contains: c => classes.has(c)
            },
            addEventListener(type, fn) {
                (this._listeners[type] = this._listeners[type] || []).push(fn);
            },
            dispatchEvent(ev) {
                this._dispatched.push(ev);
            },
            querySelector(sel) {
                return sel in this._qs ? this._qs[sel] : null;
            },
            querySelectorAll(sel) {
                return this._qsa[sel] || [];
            },
            getBoundingClientRect() {
                return this._rect || { left: 0, right: 0, top: 0, bottom: 0 };
            },
            focus() {
                this.focused = true;
                this.focusCount++;
                doc.activeElement = this;
            },
            select() {
                this.selected = true;
            }
        };
        allEls.push(node);
        if (id)
            byId[id] = node;
        return node;
    };

    const tree = el('DIV', 'tree');
    const results = el('DIV', 'results');
    const body = el('BODY', 'body');
    body.querySelector = sel =>
        sel === '.active' ? (allEls.find(n => n.classList.contains('active')) || null) : null;
    const searchInput = el('INPUT', 'search-input');
    // final polish: header-row buttons — created before initKeyboard so the
    // header-arrow binding lands on them (absent unless opts.headerEls)
    let quickAddBtn = null;
    let toolBtn = null;
    if (opts.headerEls) {
        quickAddBtn = el('BUTTON', 'quick-add-btn');
        toolBtn = el('BUTTON', 'tool-btn');
    }
    const bookmarkMenu = el('MENU', 'bookmark-context-menu');
    const folderMenu = el('MENU', 'folder-context-menu');
    const separatorMenu = el('MENU', 'separator-context-menu');

    const doc = {
        _listeners: {},
        activeElement: body,
        body,
        getElementById: id => byId[id] || null,
        addEventListener(type, fn) {
            (this._listeners[type] = this._listeners[type] || []).push(fn);
        }
    };
    globalThis.document = doc;
    const windowCloseCalls = [];
    globalThis.window = { close: () => windowCloseCalls.push('close') };
    const chromeStub = {
        runtime: { lastError: null },
        bookmarks: {
            childNodes: {},
            getChildren(id, cb) {
                cb(this.childNodes[id] || []);
            }
        }
    };
    Object.assign(chromeStub.bookmarks.childNodes, opts.children || {});
    globalThis.chrome = chromeStub;

    // A tree row: <li id="...-item-N" data-parentid><a|span></a|span></li>
    const row = (focusTag, id, parentid = '0') => {
        const li = el('LI', id);
        li.dataset.parentid = parentid;
        const link = el(focusTag);
        link.parentNode = li;
        link.parentElement = li;
        li.firstElementChild = link;
        li._qs['a, span'] = link;
        li._qs['span, a'] = link;
        li._qs['span'] = link;
        return { li, link };
    };

    // The fake tree:
    //   treeUl
    //    ├─ li#neat-tree-item-1 .parent.open <span Folder>
    //    │     └─ ul ─ li#...-11 <a Alpha>, li#...-12 <a Beta>
    //    ├─ li#neat-tree-item-2 <a Gamma>
    //    ├─ li#neat-tree-item-3 .parent.open <span Empty>
    //    │     └─ ul ─ li (Empty marker, no focusable), li#...-31 <a Inside-empty>
    //    └─ li#neat-tree-item-4 <a Last>
    const treeUl = el('UL');
    treeUl.parentNode = tree;
    treeUl.offsetHeight = 500;
    tree.firstElementChild = treeUl;

    const f1 = row('SPAN', 'neat-tree-item-1');
    f1.li.classList.add('parent');
    f1.li.classList.add('open');
    const ul1 = el('UL');
    ul1.parentNode = f1.li;
    ul1.offsetHeight = 100;
    const b11 = row('A', 'neat-tree-item-11', '1');
    b11.link.textContent = 'Alpha';
    const b12 = row('A', 'neat-tree-item-12', '1');
    b12.link.textContent = 'Beta';
    for (const b of [b11, b12]) {
        b.li.parentNode = ul1;
        b.li.parentElement = ul1;
    }
    b11.li.nextElementSibling = b12.li;
    b12.li.previousElementSibling = b11.li;
    ul1.firstElementChild = b11.li;
    ul1.lastElementChild = b12.li;
    f1.li._qs['ul>li:first-child'] = b11.li;
    f1.li._qs['ul>li:last-child'] = b12.li;
    f1.li._qsa['ul>li:last-child'] = [b12.li];

    const b2 = row('A', 'neat-tree-item-2');
    b2.link.textContent = 'Gamma';

    const f3 = row('SPAN', 'neat-tree-item-3');
    f3.li.classList.add('parent');
    f3.li.classList.add('open');
    const ul3 = el('UL');
    ul3.parentNode = f3.li;
    ul3.offsetHeight = 60;
    const marker = el('LI'); // the "(Empty)" row: no a/span inside
    marker.parentNode = ul3;
    const b31 = row('A', 'neat-tree-item-31', '3');
    b31.link.textContent = 'Inside-empty';
    b31.li.parentNode = ul3;
    marker.nextElementSibling = b31.li;
    b31.li.previousElementSibling = marker;
    ul3.firstElementChild = marker;
    ul3.lastElementChild = b31.li;
    f3.li._qs['ul>li:first-child'] = marker;

    const b4 = row('A', 'neat-tree-item-4');
    b4.link.textContent = 'Last';

    for (const r of [f1, b2, f3, b4])
        r.li.parentNode = treeUl;
    f1.li.nextElementSibling = b2.li;
    b2.li.previousElementSibling = f1.li;
    b2.li.nextElementSibling = f3.li;
    f3.li.previousElementSibling = b2.li;
    f3.li.nextElementSibling = b4.li;
    b4.li.previousElementSibling = f3.li;
    treeUl.firstElementChild = f1.li;
    treeUl.lastElementChild = b4.li;

    tree._qs['ul:not(.vbm-dropdown-list)>li:first-child'] = f1.li; // Home
    tree._qs['li:first-child>span'] = f1.link; // activeElement fallback
    tree._qsa['ul:not(.vbm-dropdown-list)>li:last-child'] = [b12.li, b31.li, b4.li]; // End

    // a closed folder, for the open-on-arrow tests (non-root parent — the
    // root-folder delete guard keys off parentid '0')
    const f5 = row('SPAN', 'neat-tree-item-5', '1');
    f5.li.classList.add('parent');
    f5.li.parentNode = treeUl;

    // two search result rows
    const r1 = row('A', 'results-item-91');
    const r2 = row('A', 'results-item-92');
    results._qs['ul>li:first-child a'] = r1.link;
    results._qs['li:last-child a'] = r2.link;

    // a context menu: item1 <hr> item2
    const item1 = el('DIV', 'mi-1');
    item1.classList.add('menu-item');
    const hr = el('HR');
    const item2 = el('DIV', 'mi-2');
    item2.classList.add('menu-item');
    item1.nextElementSibling = hr;
    hr.previousElementSibling = item1;
    hr.nextElementSibling = item2;
    item2.previousElementSibling = hr;
    for (const n of [item1, hr, item2])
        n.parentNode = bookmarkMenu;
    bookmarkMenu.firstElementChild = item1;
    bookmarkMenu.lastElementChild = item2;

    // fourth-round item 7: the search-history menu gets the same contextKeyDown
    // binding; omitted entirely when opts.noSearchHistoryMenu (guard coverage)
    let searchHistoryMenu = null;
    let shmItem1 = null;
    let shmItem2 = null;
    if (!opts.noSearchHistoryMenu) {
        searchHistoryMenu = el('MENU', 'search-history-context-menu');
        shmItem1 = el('DIV', 'shm-1');
        shmItem1.classList.add('menu-item');
        shmItem2 = el('DIV', 'shm-2');
        shmItem2.classList.add('menu-item');
        shmItem1.nextElementSibling = shmItem2;
        shmItem2.previousElementSibling = shmItem1;
        for (const n of [shmItem1, shmItem2])
            n.parentNode = searchHistoryMenu;
        searchHistoryMenu.firstElementChild = shmItem1;
        searchHistoryMenu.lastElementChild = shmItem2;
    }

    // v4 task-4 #6's palette custom-command menu (K7): same binding; omitted
    // entirely when opts.noPaletteCmdMenu (guard coverage)
    let paletteCmdMenu = null;
    let pcmItem1 = null;
    let pcmItem2 = null;
    if (!opts.noPaletteCmdMenu) {
        paletteCmdMenu = el('MENU', 'palette-cmd-context-menu');
        pcmItem1 = el('DIV', 'palette-cmd-edit');
        pcmItem1.classList.add('menu-item');
        pcmItem2 = el('DIV', 'palette-cmd-delete');
        pcmItem2.classList.add('menu-item');
        pcmItem1.nextElementSibling = pcmItem2;
        pcmItem2.previousElementSibling = pcmItem1;
        for (const n of [pcmItem1, pcmItem2])
            n.parentNode = paletteCmdMenu;
        paletteCmdMenu.firstElementChild = pcmItem1;
        paletteCmdMenu.lastElementChild = pcmItem2;
    }

    // 4.0.8: the view-tab right-click menu gets the same contextKeyDown
    // binding; omitted entirely when opts.noViewTabMenu (guard coverage)
    let viewTabMenu = null;
    let vtmItem1 = null;
    let vtmItem2 = null;
    if (!opts.noViewTabMenu) {
        viewTabMenu = el('MENU', 'view-tab-context-menu');
        vtmItem1 = el('DIV', 'view-tab-hide');
        vtmItem1.classList.add('menu-item');
        vtmItem2 = el('DIV', 'view-tab-disable');
        vtmItem2.classList.add('menu-item');
        vtmItem1.nextElementSibling = vtmItem2;
        vtmItem2.previousElementSibling = vtmItem1;
        for (const n of [vtmItem1, vtmItem2])
            n.parentNode = viewTabMenu;
        viewTabMenu.firstElementChild = vtmItem1;
        viewTabMenu.lastElementChild = vtmItem2;
    }

    // Tab-groups view (4.0.9): its four menus (tab row / group head / closed
    // record / closed record tab) get the same contextKeyDown binding —
    // without it a keyboard-opened menu took focus and answered nothing.
    const tabGroupsMenus = {};
    if (!opts.noTabGroupsMenus) {
        for (const [key, id, itemIds] of [
            ['tabRowMenu', 'tab-row-context-menu', ['tab-row-activate', 'tab-row-close']],
            ['tabGroupMenu', 'tabgroup-context-menu', ['tabgroup-activate', 'tabgroup-close']],
            ['tabClosedMenu', 'tabgroups-closed-context-menu', ['tabgroups-closed-reopen', 'tabgroups-closed-forget']],
            ['tabClosedTabMenu', 'tabgroups-closed-tab-context-menu', ['tabgroups-closed-tab-open', 'tabgroups-closed-tab-remove']]
        ]) {
            const menu = el('MENU', id);
            const first = el('DIV', itemIds[0]);
            first.classList.add('menu-item');
            const last = el('DIV', itemIds[1]);
            last.classList.add('menu-item');
            first.nextElementSibling = last;
            last.previousElementSibling = first;
            for (const n of [first, last])
                n.parentNode = menu;
            menu.firstElementChild = first;
            menu.lastElementChild = last;
            tabGroupsMenus[key] = { menu, first, last };
        }
    }

    const actionCalls = [];
    const actions = {};
    for (const name of ['editBookmarkFolder', 'deleteBookmark', 'deleteBookmarks'])
        actions[name] = (...args) => actionCalls.push([name, ...args]);
    const flags = { searchActive: !!opts.searchActive, dialogOpen: !!opts.dialogOpen };
    const searchCalls = [];
    const search = {
        results,
        input: searchInput,
        isActive: () => flags.searchActive,
        quit: () => {
            searchCalls.push('quit');
            flags.searchActive = false;
            searchInput.value = '';
        },
        // v4 task-2 slice B: two-level Esc — records + clears a live query
        // and stays in the view; declines (false) with an empty box.
        escape: () => {
            if (!searchInput.value)
                return false;
            searchCalls.push('escape');
            flags.searchActive = false;
            searchInput.value = '';
            return true;
        }
    };
    const clearMenuCalls = [];
    const closeMenuCalls = [];
    const menus = {
        clearMenu: () => clearMenuCalls.push('clear'),
        // 4.0.1 cancel semantics: the double mirrors the real closeMenu's
        // marker-off + owner refocus, so the keyboard cancel paths (menu
        // ←/Esc, document Esc) can assert the focus law. (Menu hiding is
        // not modeled by the doubles — opacity is poked directly.)
        closeMenu: () => {
            closeMenuCalls.push('close');
            const active = body.querySelector('.active');
            if (active) {
                active.classList.remove('active');
                active.focus();
            }
        },
        bookmarkMenu,
        folderMenu,
        separatorMenu
    };
    if (searchHistoryMenu)
        menus.searchHistoryMenu = searchHistoryMenu;
    if (paletteCmdMenu)
        menus.paletteCmdMenu = paletteCmdMenu;
    if (viewTabMenu)
        menus.viewTabMenu = viewTabMenu;
    for (const key of Object.keys(tabGroupsMenus))
        menus[key] = tabGroupsMenus[key].menu;
    // issue #48 follow-up: the collapsed-flyout API for the keyboard branches.
    // Recording double — openSubmenuFor returns a settable flyout element
    // (each entry may carry `_submenu`), closeSubmenu parks it, submenuOpen
    // reflects the state. `opts.submenu` pre-creates a stub flyout.
    let openSubmenuDouble = null;
    let openSubmenuParentId = null;
    const submenuCalls = [];
    const submenuEl = opts.submenu ? el('MENU', 'sub-flyout') : null;
    if (submenuEl) {
        submenuEl.classList.add('submenu');
        // Register it as the collapsed flyouts so initKeyboard binds the menu
        // walker to it (the real menus object exposes the three submenu keys).
        menus.folderTabGroupSubmenu = submenuEl;
        menus.folderSortSubmenu = submenuEl;
        menus.bookmarkTabGroupSubmenu = submenuEl;
    }
    menus.openSubmenuFor = entry => {
        submenuCalls.push(['open', entry && entry.id]);
        openSubmenuDouble = (entry && entry._submenu) || submenuEl;
        openSubmenuParentId = entry && entry.id;
        return openSubmenuDouble;
    };
    menus.closeSubmenu = refocus => {
        submenuCalls.push(['close', !!refocus]);
        openSubmenuDouble = null;
        openSubmenuParentId = null;
    };
    menus.submenuOpen = () => !!openSubmenuDouble;
    menus.submenuParentEntry = () => openSubmenuParentId;
    menus.toggleSubmenuFor = entry => {
        if (openSubmenuDouble)
            menus.closeSubmenu(true);
        else
            menus.openSubmenuFor(entry);
    };
    const closeDialogsCalls = [];
    const dialogs = {
        anyOpen: () => flags.dialogOpen,
        closeDialogs: () => closeDialogsCalls.push('close')
    };
    // Final polish: the modal Tab trap asks the dialogs module which dialog
    // element is open; tests inject it lazily (built inside the views
    // factory, which runs during initKeyboard below).
    if (opts.dialogActiveEl)
        dialogs.activeEl = opts.dialogActiveEl;

    const keyboard = initKeyboard({
        tree,
        search,
        actions,
        menus,
        dialogs,
        body,
        os: opts.os || 'linux',
        rtl: !!opts.rtl,
        palette: opts.palette, // ESC layering: closes before the view rungs
        // v4 task-2: absent → the pre-view fallback wiring; a function gets
        // the internal elements first so the registry can reference them
        views: typeof opts.views === 'function'
            ? opts.views({ tree, results, searchInput, el })
            : opts.views
    });

    const fireDoc = (type, ev) => {
        for (const fn of (doc._listeners[type] || []))
            fn.call(doc, ev);
    };
    // Rows for the type-ahead tests: visible list + one hidden row.
    const buildTypeRows = () => {
        const visUl = el('UL');
        visUl.offsetHeight = 100;
        const hidUl = el('UL');
        hidUl.offsetHeight = 0;
        const mk = (text, ul = visUl) => {
            const li = el('LI');
            li.parentNode = ul;
            const a = el('A');
            a.textContent = text;
            a.parentNode = li;
            li.firstElementChild = a;
            return { li, a };
        };
        const rows = {
            alpha: mk('Alpha'),
            beta: mk('Beta'),
            bravo: mk('Bravo'),
            dot: mk('.dot'),
            hidden: mk('Hidden', hidUl)
        };
        tree._qsa['ul>li'] = [rows.alpha.li, rows.beta.li, rows.bravo.li,
            rows.dot.li, rows.hidden.li];
        return rows;
    };
    // A row with a laid-out position for the PageUp/PageDown tests.
    const pageRow = top => {
        const li = el('LI');
        li.offsetHeight = 20;
        const a = el('A');
        a.parentNode = li;
        a.parentElement = li;
        a.offsetTop = top;
        a.offsetHeight = 20;
        li.firstElementChild = a;
        return { li, a };
    };

    return {
        keyboard, doc, fireDoc, el, row, buildTypeRows, pageRow,
        tree, results, body, searchInput, search,
        bookmarkMenu, folderMenu, separatorMenu, menus,
        searchHistoryMenu, shmItem1, shmItem2,
        paletteCmdMenu, pcmItem1, pcmItem2,
        viewTabMenu, vtmItem1, vtmItem2, tabGroupsMenus,
        quickAddBtn, toolBtn,
        treeUl, f1, b11, b12, b2, f3, b31, b4, f5, r1, r2,
        item1, hr, item2, marker,
        chrome: chromeStub, actionCalls, searchCalls, clearMenuCalls, closeMenuCalls,
        closeDialogsCalls, flags, windowCloseCalls,
        submenuEl, submenuCalls
    };
};

describe('module API', () => {
    it('returns the four handlers and binds every listener', () => {
        const { keyboard, tree, results, bookmarkMenu, folderMenu, separatorMenu, paletteCmdMenu, viewTabMenu, doc } = setup({});
        expect(typeof keyboard.treeKeyDown).toBe('function');
        expect(typeof keyboard.treeKeyUp).toBe('function');
        expect(typeof keyboard.contextKeyDown).toBe('function');
        expect(typeof keyboard.tabCycle).toBe('function');
        expect(Object.keys(keyboard).sort()).toEqual(['contextKeyDown', 'tabCycle', 'treeKeyDown', 'treeKeyUp']);
        expect(tree._listeners.keydown).toHaveLength(1);
        expect(tree._listeners.keyup).toHaveLength(1);
        expect(results._listeners.keydown).toHaveLength(1);
        expect(results._listeners.keyup).toHaveLength(1);
        expect(bookmarkMenu._listeners.keydown).toHaveLength(1);
        expect(folderMenu._listeners.keydown).toHaveLength(1);
        expect(separatorMenu._listeners.keydown).toHaveLength(1); // 4.0.1: bound like every other menu
        expect(paletteCmdMenu._listeners.keydown).toHaveLength(1); // K7: bound like the other menus
        expect(viewTabMenu._listeners.keydown).toHaveLength(1); // 4.0.8: view-tab menu ↑↓/Enter/Esc
        expect(doc._listeners.keydown).toHaveLength(3); // capture ESC + bubbling Ctrl+F + Tab cycle
    });

    // 4.0.9 bug fix: the tab-groups view's menus opened by keyboard (→ /
    // ContextMenu / Shift+F10) took focus but answered no key, because they
    // were never bound here. All four are bound now, and Tab stays trapped
    // inside an open one (menuContainers).
    it('binds the four tab-groups menus and traps Tab inside them', () => {
        const s = setup({});
        for (const key of ['tabRowMenu', 'tabGroupMenu', 'tabClosedMenu', 'tabClosedTabMenu']) {
            const { menu, first, last } = s.tabGroupsMenus[key];
            expect(menu._listeners.keydown, key).toHaveLength(1);
            // ↓ from the freshly opened container walks to the first item…
            // (a freshly opened menu holds focus itself — the K7 entry state)
            s.doc.activeElement = menu;
            fire(menu, 'keydown', makeEvent({ key: 'ArrowDown', target: menu }));
            expect(first.focused, key).toBe(true);
            // …↑ wraps to the last one (the bounded-set rule)
            fire(menu, 'keydown', makeEvent({ key: 'ArrowUp', target: first }));
            expect(last.focused, key).toBe(true);
            // Esc cancels through closeMenu (the menu focus law)
            const before = s.closeMenuCalls.length;
            fire(menu, 'keydown', makeEvent({ key: 'Escape', target: last }));
            expect(s.closeMenuCalls.length, key).toBe(before + 1);
            // Tab inside the open menu never leaves for the zone ring
            const ev = makeEvent({ key: 'Tab', target: first });
            s.doc.activeElement = first;
            s.keyboard.tabCycle(ev);
            expect(ev.defaultPrevented, key).toBeFalsy();
        }
    });

    it('tolerates a page without the tab-groups menus (minimal setups)', () => {
        const s = setup({ noTabGroupsMenus: true });
        expect(typeof s.keyboard.contextKeyDown).toBe('function');
    });
});

// v4 task-3 #7 (docs/plan-4.0.0/v4task-2-list.md §2.1): Tab / Shift+Tab cycles the three
// regions — header controls → tab strip (one stop) → the active view's list
// (its `.focus` row, else first row). Rows are tabindex="-1"; the cycle is
// the only Tab path. Dialogs, open menus and the palette keep local Tab.
describe('Tab region cycle (§2.1)', () => {
    const ROW_SEL = 'li a, li span, li[tabindex]';
    // Header controls + tab strip elements must exist before initKeyboard so
    // the views double can reference them; doc.getElementById resolves them
    // at event time through the el factory's byId registry.
    const tabEnv = (opts = {}) => {
        const refs = {};
        const env = setup({
            ...opts,
            views: ({ tree, el }) => {
                refs.quickAdd = el('BUTTON', 'quick-add-btn');
                refs.tool = el('BUTTON', 'tool-btn');
                refs.tabs = el('DIV', 'view-tabs');
                refs.tabBtn = el('BUTTON', 'view-tab-tree');
                refs.tabBtn.parentNode = refs.tabs;
                return {
                    lists: () => [{ id: 'tree', el: tree, typeAhead: true }],
                    activeDef: () => ({ listEl: tree, tabEl: refs.tabBtn }),
                    onEscapeActive: () => false,
                    escapeToTree: () => false,
                    focusTop: () => {},
                    activate: () => {}
                };
            }
        });
        return { ...env, ...refs };
    };

    it('cycles header → tab strip → list and wraps around', () => {
        const { doc, fireDoc, searchInput, quickAdd, tool, tabBtn, tree, f1 } = tabEnv();
        tree._qs[ROW_SEL] = f1.link;
        searchInput.focus();
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(quickAdd);
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(tool);
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(tabBtn);
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(f1.link);
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(searchInput); // wrap-around
    });

    it('Shift+Tab walks the ring backwards', () => {
        const { doc, fireDoc, searchInput, tabBtn, tree, f1 } = tabEnv();
        tree._qs[ROW_SEL] = f1.link;
        searchInput.focus();
        fireDoc('keydown', makeEvent({ key: 'Tab', shiftKey: true }));
        expect(doc.activeElement).toBe(f1.link); // backwards: the last stop
        fireDoc('keydown', makeEvent({ key: 'Tab', shiftKey: true }));
        expect(doc.activeElement).toBe(tabBtn);
    });

    it('enters at the near edge when focus is nowhere (body)', () => {
        const { doc, fireDoc, body, searchInput, tree, f1 } = tabEnv();
        tree._qs[ROW_SEL] = f1.link;
        doc.activeElement = body;
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(searchInput);
        doc.activeElement = body;
        fireDoc('keydown', makeEvent({ key: 'Tab', shiftKey: true }));
        expect(doc.activeElement).toBe(f1.link);
    });

    it('skips hidden header buttons and a hidden tab strip', () => {
        const { doc, fireDoc, searchInput, quickAdd, tool, tabs, tree, f1 } = tabEnv();
        quickAdd.classList.add('hidden');
        tabs.classList.add('hidden');
        tree._qs[ROW_SEL] = f1.link;
        searchInput.focus();
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(tool); // quick-add skipped
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(f1.link); // no tab-strip stop
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(searchInput);
    });

    it('lands on the .focus row when the list has one', () => {
        const { doc, fireDoc, tabBtn, tree, f1, b2 } = tabEnv();
        tree._qs['.focus'] = b2.link;
        tree._qs[ROW_SEL] = f1.link;
        tabBtn.focus();
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(b2.link);
    });

    // keyboard-model §7: the transient donation/what's-new banner joins the
    // ring at its visual spot (header ⇄ strip) whenever it is up — and is
    // skipped entirely when display:none.
    const bannerEnv = display => {
        const refs = {};
        const env = setup({
            views: ({ tree, el }) => {
                refs.quickAdd = el('BUTTON', 'quick-add-btn');
                refs.tool = el('BUTTON', 'tool-btn');
                const banner = el('DIV', 'donation');
                banner.style.display = display;
                refs.go = el('BUTTON', 'donation-go');
                refs.later = el('BUTTON', 'donation-later');
                refs.never = el('BUTTON', 'donation-never');
                banner._qsa['button, a[href]'] = [refs.go, refs.later, refs.never];
                refs.tabs = el('DIV', 'view-tabs');
                refs.tabBtn = el('BUTTON', 'view-tab-tree');
                refs.tabBtn.parentNode = refs.tabs;
                return {
                    lists: () => [{ id: 'tree', el: tree, typeAhead: true }],
                    activeDef: () => ({ listEl: tree, tabEl: refs.tabBtn }),
                    onEscapeActive: () => false,
                    escapeToTree: () => false,
                    focusTop: () => {},
                    activate: () => {}
                };
            }
        });
        return { ...env, ...refs };
    };

    it('a visible banner contributes its controls between the header and the strip', () => {
        const { doc, fireDoc, tool, go, later, never, tabBtn, tree, f1 } = bannerEnv('block');
        tree._qs[ROW_SEL] = f1.link;
        tool.focus();
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(go);
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(later);
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(never);
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(tabBtn); // the ring continues below
    });

    it('a hidden (display:none) banner is skipped by the ring', () => {
        const { doc, fireDoc, tool, tabBtn, tree, f1 } = bannerEnv('none');
        tree._qs[ROW_SEL] = f1.link;
        tool.focus();
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(tabBtn);
    });

    // keyboard-model §7 (4.0.8): the local what's-new strip and the remote
    // announce banner sit between #donation and the tab strip and join the
    // ring the same way. whats-new carries two links; announce carries its
    // link(s) plus the dismiss × button — the dismiss must be keyboard
    // reachable, otherwise mouse-only users could clear the banner.
    const multiBannerEnv = ({ donation = 'none', whatsNew = 'none', announce = 'none' } = {}) => {
        const refs = {};
        const env = setup({
            views: ({ tree, el }) => {
                refs.quickAdd = el('BUTTON', 'quick-add-btn');
                refs.tool = el('BUTTON', 'tool-btn');
                const donationEl = el('DIV', 'donation');
                donationEl.style.display = donation;
                donationEl._qsa['button, a[href]'] = [];
                const whatsNewEl = el('DIV', 'whats-new');
                whatsNewEl.style.display = whatsNew;
                refs.guide = el('A', 'whats-new-guide');
                refs.changelog = el('A', 'whats-new-changelog');
                whatsNewEl._qsa['button, a[href]'] = [refs.guide, refs.changelog];
                const announceEl = el('DIV', 'announce');
                announceEl.style.display = announce;
                refs.annLink = el('A', 'announce-link');
                refs.annDismiss = el('BUTTON', 'announce-dismiss');
                announceEl._qsa['button, a[href]'] = [refs.annLink, refs.annDismiss];
                refs.tabs = el('DIV', 'view-tabs');
                refs.tabBtn = el('BUTTON', 'view-tab-tree');
                refs.tabBtn.parentNode = refs.tabs;
                return {
                    lists: () => [{ id: 'tree', el: tree, typeAhead: true }],
                    activeDef: () => ({ listEl: tree, tabEl: refs.tabBtn }),
                    onEscapeActive: () => false,
                    escapeToTree: () => false,
                    focusTop: () => {},
                    activate: () => {}
                };
            }
        });
        return { ...env, ...refs };
    };

    it('a visible what\'s-new strip contributes its links between header and strip', () => {
        const { doc, fireDoc, tool, guide, changelog, tabBtn, tree, f1 } = multiBannerEnv({ whatsNew: 'block' });
        tree._qs[ROW_SEL] = f1.link;
        tool.focus();
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(guide);
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(changelog);
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(tabBtn);
    });

    it('a visible announce banner contributes link and dismiss button', () => {
        const { doc, fireDoc, tool, annLink, annDismiss, tabBtn, tree, f1 } = multiBannerEnv({ announce: 'block' });
        tree._qs[ROW_SEL] = f1.link;
        tool.focus();
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(annLink);
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(annDismiss); // dismiss is keyboard reachable
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(tabBtn);
    });

    it('hidden banners are skipped while visible ones keep their spot', () => {
        const { doc, fireDoc, tool, annLink, annDismiss, tabBtn, tree, f1 } = multiBannerEnv({ announce: 'block' });
        tree._qs[ROW_SEL] = f1.link;
        tool.focus();
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(annLink); // donation + whats-new skipped
        fireDoc('keydown', makeEvent({ key: 'Tab', shiftKey: true }));
        expect(doc.activeElement).toBe(tool); // backwards skips them too
    });

    // keyboard-model §7: the transient undo toast (undo.js showToast/
    // toastAction) joins the ring at its visual spot — the fixed bottom bar,
    // after the list rows — whenever it is up (`hidden` off is the visibility
    // signal; the 8s auto-hide drops the stop again).
    const toastEnv = hidden => {
        const refs = {};
        const env = setup({
            views: ({ tree, el }) => {
                refs.quickAdd = el('BUTTON', 'quick-add-btn');
                refs.tool = el('BUTTON', 'tool-btn');
                const toast = el('DIV', 'undo-toast');
                toast.hidden = hidden;
                refs.toastBtn = el('BUTTON', 'undo-toast-button');
                refs.tabs = el('DIV', 'view-tabs');
                refs.tabBtn = el('BUTTON', 'view-tab-tree');
                refs.tabBtn.parentNode = refs.tabs;
                return {
                    lists: () => [{ id: 'tree', el: tree, typeAhead: true }],
                    activeDef: () => ({ listEl: tree, tabEl: refs.tabBtn }),
                    onEscapeActive: () => false,
                    escapeToTree: () => false,
                    focusTop: () => {},
                    activate: () => {}
                };
            }
        });
        return { ...env, ...refs };
    };

    it('a visible undo toast contributes its button as the ring\'s last stop', () => {
        const { doc, fireDoc, searchInput, toastBtn, tree, f1 } = toastEnv(false);
        tree._qs[ROW_SEL] = f1.link;
        f1.link.focus();
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(toastBtn); // after the list rows
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(searchInput); // wraps to the header
        fireDoc('keydown', makeEvent({ key: 'Tab', shiftKey: true }));
        expect(doc.activeElement).toBe(toastBtn); // backwards: the last stop
    });

    it('a hidden undo toast stays out of the ring', () => {
        const { doc, fireDoc, searchInput, tree, f1 } = toastEnv(true);
        tree._qs[ROW_SEL] = f1.link;
        f1.link.focus();
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(searchInput); // straight wrap-around
    });

    it('a .focus marker inside a dropdown listbox is never the row stop (5421968)', () => {
        // The same guard the toolbar ↓ path carries: a marker parked on a
        // hidden listbox option is not a row — the ring stop falls through
        // to the first real row instead of dead-ending on the option.
        const refs = {};
        const env = setup({
            views: ({ el }) => {
                refs.quickAdd = el('BUTTON', 'quick-add-btn');
                refs.tool = el('BUTTON', 'tool-btn');
                refs.tabs = el('DIV', 'view-tabs');
                refs.tabBtn = el('BUTTON', 'view-tab-dupes');
                refs.tabBtn.parentNode = refs.tabs;
                const listEl = el('DIV', 'dupes-list');
                // the custom dropdown's hidden listbox holds the stale marker
                const listbox = el('UL');
                listbox.classList.add('vbm-dropdown-list');
                const option = el('LI');
                option.parentNode = listbox;
                option.closest = sel => (sel === '.vbm-dropdown-list' ? listbox : null);
                listEl._qs['.focus'] = option;
                const li = el('LI', 'dupes-item-1');
                const a = el('A');
                a.parentNode = li;
                li.parentNode = listEl;
                listEl._qs['li a, li span, li[tabindex]'] = a;
                Object.assign(refs, { listEl, option, rowA: a });
                return {
                    lists: () => [{ id: 'dupes', el: listEl, typeAhead: false }],
                    activeDef: () => ({ listEl, tabEl: refs.tabBtn }),
                    onEscapeActive: () => false,
                    escapeToTree: () => false,
                    focusTop: () => {},
                    activate: () => {}
                };
            }
        });
        refs.tabBtn.focus();
        env.fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(env.doc.activeElement).toBe(refs.rowA); // the real row, not the option
    });

    it('continues from the list region when focus is inside the list but not on its stop', () => {
        const { doc, fireDoc, searchInput, tabBtn, tree, f1, b11 } = tabEnv();
        tree._qs[ROW_SEL] = f1.link;
        b11.link.focus(); // some other row than the landing stop
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(searchInput); // past the list → wrap
        // the list container itself also counts as the list region
        tree.focus();
        fireDoc('keydown', makeEvent({ key: 'Tab', shiftKey: true }));
        expect(doc.activeElement).toBe(tabBtn); // backwards out of the list
    });

    it('does nothing while a dialog is open', () => {
        const { doc, fireDoc, searchInput } = tabEnv({ dialogOpen: true });
        searchInput.focus();
        const ev = makeEvent({ key: 'Tab' });
        fireDoc('keydown', ev);
        expect(ev.defaultPrevented).toBe(false);
        expect(doc.activeElement).toBe(searchInput);
    });

    // Final polish (aria-modal): an open dialog traps Tab within its own
    // controls — focus must never leak into the page behind the cover. The
    // dialogs module reports the open element via activeEl().
    const dialogTrapEnv = extra => {
        const refs = {};
        const env = setup({
            dialogOpen: true,
            dialogActiveEl: () => refs.dlg,
            views: ({ tree, el }) => {
                const dlg = el('DIV', 'confirm-dialog');
                refs.btn1 = el('BUTTON', 'confirm-dialog-button-1');
                refs.btn2 = el('BUTTON', 'confirm-dialog-button-2');
                refs.btn1.parentNode = dlg;
                refs.btn2.parentNode = dlg;
                dlg._qsa['button, input'] = [refs.btn1, refs.btn2];
                refs.dlg = dlg;
                return {
                    lists: () => [{ id: 'tree', el: tree, typeAhead: true }],
                    activeDef: () => ({ listEl: tree }),
                    onEscapeActive: () => false,
                    escapeToTree: () => false,
                    focusTop: () => {},
                    activate: () => {}
                };
            },
            ...extra
        });
        return { ...env, ...refs };
    };

    it('traps Tab inside the open dialog and wraps around its controls', () => {
        const { doc, fireDoc, btn1, btn2 } = dialogTrapEnv();
        btn1.focus();
        const ev = makeEvent({ key: 'Tab' });
        fireDoc('keydown', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(doc.activeElement).toBe(btn2);
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(btn1); // wraps — never leaves the dialog
    });

    it('walks backwards on Shift+Tab and enters at the near edge from outside', () => {
        const { doc, fireDoc, body, btn1, btn2 } = dialogTrapEnv();
        btn1.focus();
        fireDoc('keydown', makeEvent({ key: 'Tab', shiftKey: true }));
        expect(doc.activeElement).toBe(btn2); // wraps backwards
        body.focus();
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(btn1); // forward entry: first control
        body.focus();
        fireDoc('keydown', makeEvent({ key: 'Tab', shiftKey: true }));
        expect(doc.activeElement).toBe(btn2); // backward entry: last control
    });

    it('skips disabled dialog controls', () => {
        const { doc, fireDoc, btn1, btn2 } = dialogTrapEnv();
        btn2.disabled = true;
        btn1.focus();
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(btn1); // only enabled control: stay
    });

    it('swallows Tab when the dialog has no focusable control (alert)', () => {
        const { doc, fireDoc, body, dlg } = dialogTrapEnv();
        dlg._qsa['button, input'] = [];
        body.focus();
        const ev = makeEvent({ key: 'Tab' });
        fireDoc('keydown', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(doc.activeElement).toBe(body); // nowhere to go — stay put
    });

    it('does nothing while a context menu owns focus', () => {
        const { doc, fireDoc, item1 } = tabEnv();
        item1.focus(); // a menu item inside the bookmark context menu
        const ev = makeEvent({ key: 'Tab' });
        fireDoc('keydown', ev);
        expect(ev.defaultPrevented).toBe(false);
        expect(doc.activeElement).toBe(item1);
    });

    it('does nothing inside the palette-cmd menu either (K7: it joined menuContainers)', () => {
        const { doc, fireDoc, pcmItem1 } = tabEnv();
        pcmItem1.focus();
        const ev = makeEvent({ key: 'Tab' });
        fireDoc('keydown', ev);
        expect(ev.defaultPrevented).toBe(false);
        expect(doc.activeElement).toBe(pcmItem1);
    });

    it('does nothing while the palette is open', () => {
        const { doc, fireDoc, searchInput } = tabEnv({
            palette: { isOpen: () => true, open: () => {}, close: () => {} }
        });
        searchInput.focus();
        const ev = makeEvent({ key: 'Tab' });
        fireDoc('keydown', ev);
        expect(ev.defaultPrevented).toBe(false);
        expect(doc.activeElement).toBe(searchInput);
    });

    it('leaves the list out when it has no focusable row', () => {
        const { doc, fireDoc, searchInput, tabBtn, tool } = tabEnv();
        // no ROW_SEL seed → the empty list contributes no stop
        tool.focus();
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(tabBtn);
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(searchInput); // wraps past the empty list
    });

    // Final polish: the active view's in-list toolbar controls (stats sort
    // seg, dead rescan/filter, dupes strategy/apply) join the cycle between
    // the tab strip and the list rows.
    const toolbarEnv = () => {
        const refs = {};
        const env = setup({
            views: ({ tree, el }) => {
                refs.quickAdd = el('BUTTON', 'quick-add-btn');
                refs.tool = el('BUTTON', 'tool-btn');
                refs.tabs = el('DIV', 'view-tabs');
                refs.tabBtn = el('BUTTON', 'view-tab-stats');
                refs.tabBtn.parentNode = refs.tabs;
                const container = el('DIV', 'stats-list');
                refs.segCount = el('BUTTON');
                refs.segRecent = el('BUTTON');
                refs.clearBtn = el('BUTTON');
                container._qsa['.vbm-toolbar button, .vbm-toolbar select, .vbm-toolbar input'] =
                    [refs.segCount, refs.segRecent, refs.clearBtn];
                return {
                    lists: () => [{ id: 'tree', el: tree, typeAhead: true }],
                    activeDef: () => ({ listEl: tree, tabEl: refs.tabBtn, container }),
                    onEscapeActive: () => false,
                    escapeToTree: () => false,
                    focusTop: () => {},
                    activate: () => {}
                };
            }
        });
        return { ...env, ...refs };
    };

    it('inserts the active view\'s toolbar controls between the tab strip and the list', () => {
        const { doc, fireDoc, tabBtn, segCount, segRecent, clearBtn, tree, f1, searchInput } = toolbarEnv();
        tree._qs[ROW_SEL] = f1.link;
        tabBtn.focus();
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(segCount);
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(segRecent);
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(clearBtn);
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(f1.link); // list stop after the toolbar
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(searchInput); // wrap-around
    });

    it('skips disabled and hidden toolbar controls', () => {
        const { doc, fireDoc, tabBtn, segCount, segRecent, clearBtn, tree, f1 } = toolbarEnv();
        tree._qs[ROW_SEL] = f1.link;
        segCount.disabled = true;
        segRecent.classList.add('hidden');
        tabBtn.focus();
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(clearBtn); // only enabled+visible control
        fireDoc('keydown', makeEvent({ key: 'Tab' }));
        expect(doc.activeElement).toBe(f1.link);
    });

    it('Shift+Tab from the list row lands on the last toolbar control', () => {
        const { doc, fireDoc, clearBtn, tree, f1 } = toolbarEnv();
        tree._qs[ROW_SEL] = f1.link;
        f1.link.focus();
        fireDoc('keydown', makeEvent({ key: 'Tab', shiftKey: true }));
        expect(doc.activeElement).toBe(clearBtn);
    });
});

describe('treeKeyDown — ArrowDown', () => {
    it('moves into an open folder: focuses its first child row', () => {
        const { tree, f1, b11, doc } = setup({});
        doc.activeElement = f1.link;
        const ev = makeEvent({ key: 'ArrowDown' });
        fire(tree, 'keydown', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(b11.link.focused).toBe(true);
    });

    it('moves to the next sibling on a plain row', () => {
        const { tree, b11, b12, doc } = setup({});
        doc.activeElement = b11.link;
        fire(tree, 'keydown', makeEvent({ key: 'ArrowDown' }));
        expect(b12.link.focused).toBe(true);
    });

    it('skips an "(Empty)" marker row (no focusable child) and lands on the next sibling', () => {
        const { tree, f3, b4, doc } = setup({});
        doc.activeElement = f3.link;
        fire(tree, 'keydown', makeEvent({ key: 'ArrowDown' }));
        expect(b4.link.focused).toBe(true);
    });

    it('climbs out of a folder at its last child to the folder\'s next sibling', () => {
        const { tree, b12, b2, doc } = setup({});
        doc.activeElement = b12.link;
        fire(tree, 'keydown', makeEvent({ key: 'ArrowDown' }));
        expect(b2.link.focused).toBe(true);
    });

    it('does not climb out of the list while search is active', () => {
        const { tree, b12, b2, doc } = setup({ searchActive: true });
        doc.activeElement = b12.link;
        fire(tree, 'keydown', makeEvent({ key: 'ArrowDown' }));
        expect(b2.link.focused).toBe(false);
    });
});

describe('treeKeyDown — ArrowUp', () => {
    it('moves to the previous sibling', () => {
        const { tree, b11, b12, doc } = setup({});
        doc.activeElement = b12.link;
        const ev = makeEvent({ key: 'ArrowUp' });
        fire(tree, 'keydown', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(b11.link.focused).toBe(true);
    });

    it('drills into an open previous folder down to its last visible child', () => {
        const { tree, b2, b12, doc } = setup({});
        doc.activeElement = b2.link;
        fire(tree, 'keydown', makeEvent({ key: 'ArrowUp' }));
        expect(b12.link.focused).toBe(true);
    });

    it('lands on the folder when the previous row is an "(Empty)" marker', () => {
        const { tree, b31, f3, doc } = setup({});
        doc.activeElement = b31.link;
        fire(tree, 'keydown', makeEvent({ key: 'ArrowUp' }));
        expect(f3.link.focused).toBe(true);
    });

    it('moves from a folder\'s first child up to the folder row', () => {
        const { tree, b11, f1, doc } = setup({});
        doc.activeElement = b11.link;
        fire(tree, 'keydown', makeEvent({ key: 'ArrowUp' }));
        expect(f1.link.focused).toBe(true);
    });

    it('returns focus to the search input at the very top of the tree', () => {
        const { tree, f1, searchInput, doc } = setup({});
        doc.activeElement = f1.link;
        fire(tree, 'keydown', makeEvent({ key: 'ArrowUp' }));
        expect(searchInput.focused).toBe(true);
    });
});

describe('treeKeyDown — Meta+Arrow (Mac home/end)', () => {
    it('Meta+ArrowDown acts as End: focuses the last visible row', () => {
        const { tree, f1, b4, doc } = setup({});
        doc.activeElement = f1.link;
        fire(tree, 'keydown', makeEvent({ key: 'ArrowDown', metaKey: true }));
        expect(b4.link.focused).toBe(true);
    });

    it('Meta+ArrowUp acts as Home: focuses the first row', () => {
        const { tree, b2, f1, doc } = setup({});
        doc.activeElement = b2.link;
        fire(tree, 'keydown', makeEvent({ key: 'ArrowUp', metaKey: true }));
        expect(f1.link.focused).toBe(true);
    });
});

describe('treeKeyDown — ArrowRight/ArrowLeft', () => {
    it('ArrowRight on a closed folder dispatches a click on its row link', () => {
        const { tree, f5, doc } = setup({});
        doc.activeElement = f5.link;
        const ev = makeEvent({ key: 'ArrowRight' });
        fire(tree, 'keydown', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(f5.link._dispatched).toHaveLength(1);
        expect(f5.link._dispatched[0].type).toBe('click');
    });

    it('ArrowLeft on an open folder dispatches a click on its row link', () => {
        const { tree, f1, doc } = setup({});
        doc.activeElement = f1.link;
        fire(tree, 'keydown', makeEvent({ key: 'ArrowLeft' }));
        expect(f1.link._dispatched).toHaveLength(1);
        expect(f1.link._dispatched[0].type).toBe('click');
    });

    it('ArrowLeft on a child row focuses the parent folder looked up by id', () => {
        const { tree, b11, f1, doc } = setup({});
        doc.activeElement = b11.link;
        fire(tree, 'keydown', makeEvent({ key: 'ArrowLeft' }));
        expect(f1.link.focused).toBe(true);
    });

    it('ArrowLeft on a root row (parentid 0) goes nowhere', () => {
        const { tree, b2, f1, doc } = setup({});
        doc.activeElement = b2.link;
        const ev = makeEvent({ key: 'ArrowLeft' });
        fire(tree, 'keydown', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(f1.link.focused).toBe(false);
        expect(b2.link._dispatched).toHaveLength(0);
    });

    it('ArrowRight on a leaf row (ltr) dispatches a contextmenu at its right edge', () => {
        const { tree, b2, doc } = setup({});
        b2.link._rect = { left: 20, right: 120, top: 10, bottom: 30 };
        doc.activeElement = b2.link;
        fire(tree, 'keydown', makeEvent({ key: 'ArrowRight', target: b2.link }));
        expect(b2.link._dispatched).toHaveLength(1);
        expect(b2.link._dispatched[0].type).toBe('contextmenu');
        expect(b2.link._dispatched[0].clientX).toBe(120);
        expect(b2.link._dispatched[0].clientY).toBe(30);
    });

    it('ContextMenu key on a leaf row dispatches a contextmenu at its right edge', () => {
        const { tree, b2, doc } = setup({});
        b2.link._rect = { left: 20, right: 120, top: 10, bottom: 30 };
        doc.activeElement = b2.link;
        const ev = makeEvent({ key: 'ContextMenu', target: b2.link });
        fire(tree, 'keydown', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(b2.link._dispatched).toHaveLength(1);
        expect(b2.link._dispatched[0].type).toBe('contextmenu');
        expect(b2.link._dispatched[0].clientX).toBe(120);
        expect(b2.link._dispatched[0].clientY).toBe(30);
    });

    it('Shift+F10 on a leaf row dispatches a contextmenu; plain F10 does not', () => {
        const { tree, b2, doc } = setup({});
        b2.link._rect = { left: 20, right: 120, top: 10, bottom: 30 };
        doc.activeElement = b2.link;
        const evShift = makeEvent({ key: 'F10', shiftKey: true, target: b2.link });
        fire(tree, 'keydown', evShift);
        expect(evShift.defaultPrevented).toBe(true);
        expect(b2.link._dispatched).toHaveLength(1);
        expect(b2.link._dispatched[0].type).toBe('contextmenu');
        b2.link._dispatched.length = 0;
        const evPlain = makeEvent({ key: 'F10', target: b2.link });
        fire(tree, 'keydown', evPlain);
        expect(evPlain.defaultPrevented).toBe(false);
        expect(b2.link._dispatched).toHaveLength(0);
    });

    it('ArrowLeft on a leaf row (rtl) dispatches a contextmenu at its left edge', () => {
        const { tree, b2, doc } = setup({ rtl: true });
        b2.link._rect = { left: 20, right: 120, top: 10, bottom: 30 };
        doc.activeElement = b2.link;
        fire(tree, 'keydown', makeEvent({ key: 'ArrowLeft', target: b2.link }));
        expect(b2.link._dispatched).toHaveLength(1);
        expect(b2.link._dispatched[0].type).toBe('contextmenu');
        expect(b2.link._dispatched[0].clientX).toBe(20);
    });

    it('ArrowRight on a child row (rtl) focuses the parent folder', () => {
        const { tree, b11, f1, doc } = setup({ rtl: true });
        doc.activeElement = b11.link;
        fire(tree, 'keydown', makeEvent({ key: 'ArrowRight' }));
        expect(f1.link.focused).toBe(true);
        expect(b11.link._dispatched).toHaveLength(0);
    });

    it('ArrowLeft on a closed folder (rtl) dispatches a click', () => {
        const { tree, f5, doc } = setup({ rtl: true });
        doc.activeElement = f5.link;
        fire(tree, 'keydown', makeEvent({ key: 'ArrowLeft' }));
        expect(f5.link._dispatched).toHaveLength(1);
        expect(f5.link._dispatched[0].type).toBe('click');
    });
});

describe('treeKeyDown — Enter/Space', () => {
    it('Enter dispatches a click carrying the modifier keys', () => {
        const { tree, b2, doc } = setup({});
        doc.activeElement = b2.link;
        const ev = makeEvent({ key: 'Enter', ctrlKey: true, metaKey: true });
        fire(tree, 'keydown', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(b2.link._dispatched).toHaveLength(1);
        expect(b2.link._dispatched[0].type).toBe('click');
        expect(b2.link._dispatched[0].ctrlKey).toBe(true);
        expect(b2.link._dispatched[0].metaKey).toBe(true);
        expect(b2.link._dispatched[0].shiftKey).toBeFalsy();
    });

    it('Space dispatches the same click', () => {
        const { tree, b2, doc } = setup({});
        doc.activeElement = b2.link;
        fire(tree, 'keydown', makeEvent({ key: ' ' }));
        expect(b2.link._dispatched).toHaveLength(1);
        expect(b2.link._dispatched[0].type).toBe('click');
    });
});

describe('treeKeyDown — End/Home', () => {
    it('End focuses the last visible row of the tree', () => {
        const { tree, f1, b4, doc } = setup({});
        doc.activeElement = f1.link;
        fire(tree, 'keydown', makeEvent({ key: 'End' }));
        expect(b4.link.focused).toBe(true);
    });

    it('Home focuses the first row of the tree', () => {
        const { tree, b2, f1, doc } = setup({});
        doc.activeElement = b2.link;
        fire(tree, 'keydown', makeEvent({ key: 'Home' }));
        expect(f1.link.focused).toBe(true);
    });

    it('End on the results pane focuses the last result', () => {
        const { results, r1, r2, doc } = setup({ searchActive: true });
        doc.activeElement = r1.link;
        fire(results, 'keydown', makeEvent({ key: 'End' }));
        expect(r2.link.focused).toBe(true);
    });

    it('End on an empty results pane (no rows) does nothing', () => {
        const { results, r1, r2, doc } = setup({ searchActive: true });
        delete results._qs['li:last-child a'];
        doc.activeElement = r1.link;
        fire(results, 'keydown', makeEvent({ key: 'End' }));
        // r2 is a deleted target — its not-being-focused is trivially true.
        // "does nothing" must mean the focus is left completely untouched.
        expect(r2.link.focused).toBe(false);
        expect(doc.activeElement).toBe(r1.link);
        expect(r1.link.focusCount).toBe(0);
    });

    it('Home on the results pane focuses the first result', () => {
        const { results, r1, r2, doc } = setup({ searchActive: true });
        doc.activeElement = r2.link;
        fire(results, 'keydown', makeEvent({ key: 'Home' }));
        expect(r1.link.focused).toBe(true);
    });
});

describe('treeKeyDown — PageDown/PageUp', () => {
    const pageSetup = opts => {
        const ctx = setup(opts);
        const p1 = ctx.pageRow(0);
        const p2 = ctx.pageRow(90);
        const p3 = ctx.pageRow(150);
        const p4 = ctx.pageRow(250);
        ctx.tree._qsa['a, span'] = [p1.a, p2.a, p3.a, p4.a];
        return { ...ctx, p1, p2, p3, p4 };
    };

    it('PageDown focuses the last row inside the viewport and eats the event', () => {
        const { tree, doc, p1, p3 } = pageSetup({});
        tree.offsetHeight = 200;
        tree.scrollTop = 0;
        doc.activeElement = p1.a;
        const ev = makeEvent({ key: 'PageDown' });
        fire(tree, 'keydown', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(p3.a.focused).toBe(true); // p4 (offsetTop 250) is below bound 200
    });

    it('PageDown on the last visible row defers the refocus via setTimeout', () => {
        const { tree, doc, p3 } = pageSetup({});
        tree.offsetHeight = 200;
        tree.scrollTop = 0;
        doc.activeElement = p3.a;
        const ev = makeEvent({ key: 'PageDown' });
        fire(tree, 'keydown', ev);
        expect(ev.defaultPrevented).toBe(false);
        expect(timeouts).toHaveLength(1);
        expect(timeouts[0][1]).toBe(0);
        expect(p3.a.focusCount).toBe(0);
        timeouts[0][0]();
        expect(p3.a.focusCount).toBe(1);
    });

    it('PageUp focuses the first row intersecting the viewport', () => {
        const { tree, doc, p2, p3 } = pageSetup({});
        tree.scrollTop = 100; // p1 ends at 20 (above), p2 spans 90–110
        doc.activeElement = p3.a;
        const ev = makeEvent({ key: 'PageUp' });
        fire(tree, 'keydown', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(p2.a.focused).toBe(true);
    });

    it('PageUp on the first visible row defers the refocus via setTimeout', () => {
        const { tree, doc, p2 } = pageSetup({});
        tree.scrollTop = 100;
        doc.activeElement = p2.a;
        const ev = makeEvent({ key: 'PageUp' });
        fire(tree, 'keydown', ev);
        expect(ev.defaultPrevented).toBe(false);
        expect(timeouts).toHaveLength(1);
        timeouts[0][0]();
        expect(p2.a.focusCount).toBe(1);
    });
});

describe('treeKeyDown — F2 / Delete', () => {
    it('F2 edits the focused tree row, stripping the neat-tree-item- prefix', () => {
        const { tree, b11, doc, actionCalls } = setup({});
        doc.activeElement = b11.link;
        fire(tree, 'keydown', makeEvent({ key: 'F2' }));
        expect(actionCalls).toEqual([['editBookmarkFolder', '11']]);
    });

    it('F2 strips the neat-recent-item- and results-item- prefixes too', () => {
        const ctx = setup({});
        const recent = ctx.row('A', 'neat-recent-item-7');
        ctx.doc.activeElement = recent.link;
        fire(ctx.tree, 'keydown', makeEvent({ key: 'F2' }));
        ctx.doc.activeElement = ctx.r1.link;
        fire(ctx.results, 'keydown', makeEvent({ key: 'F2' }));
        expect(ctx.actionCalls).toEqual([
            ['editBookmarkFolder', '7'],
            ['editBookmarkFolder', '91']
        ]);
    });

    it('F2 does nothing on Mac', () => {
        const { tree, b11, doc, actionCalls } = setup({ os: 'mac' });
        doc.activeElement = b11.link;
        fire(tree, 'keydown', makeEvent({ key: 'F2' }));
        expect(actionCalls).toEqual([]);
    });

    it('F2 prefers the data-node-id row id over the element id prefix', () => {
        const ctx = setup({});
        const r = ctx.row('A', 'recent-item-3'); // prefix would strip to 3
        r.li.dataset.nodeId = '77';
        ctx.doc.activeElement = r.link;
        fire(ctx.tree, 'keydown', makeEvent({ key: 'F2' }));
        expect(ctx.actionCalls).toEqual([['editBookmarkFolder', '77']]);
    });

    it('F2 does nothing on a root folder (K3 — the same parentid 0 guard as Delete)', () => {
        const { tree, f1, f5, doc, actionCalls } = setup({});
        doc.activeElement = f1.link; // root folder (parentid '0')
        fire(tree, 'keydown', makeEvent({ key: 'F2' }));
        expect(actionCalls).toEqual([]); // Chrome would reject update() on it
        // a NON-root folder still reaches the edit action
        doc.activeElement = f5.link; // parentid '1'
        fire(tree, 'keydown', makeEvent({ key: 'F2' }));
        expect(actionCalls).toEqual([['editBookmarkFolder', '5']]);
    });

    it('Delete on keydown is swallowed (the delete action fires on keyup)', () => {
        const { tree, b11, doc, actionCalls } = setup({});
        doc.activeElement = b11.link;
        const ev = makeEvent({ key: 'Delete' });
        fire(tree, 'keydown', ev);
        expect(actionCalls).toEqual([]);
        expect(ev.defaultPrevented).toBe(false);
        expect(timeouts).toEqual([]); // not treated as type-ahead either
    });
});

describe('treeKeyDown — type-ahead', () => {
    it('focuses the next row whose text starts with the typed letter', () => {
        const { tree, doc, buildTypeRows } = setup({});
        const rows = buildTypeRows();
        doc.activeElement = rows.alpha.a;
        const ev = makeEvent({ key: 'b' });
        fire(tree, 'keydown', ev);
        expect(rows.beta.a.focused).toBe(true);
        expect(ev.defaultPrevented).toBe(false);
        expect(timeouts[0][1]).toBe(500); // the keyBuffer reset timer
    });

    it('repeating the same letter cycles and wraps around the matches', () => {
        const { tree, doc, buildTypeRows } = setup({});
        const rows = buildTypeRows();
        doc.activeElement = rows.alpha.a;
        fire(tree, 'keydown', makeEvent({ key: 'b' }));
        expect(rows.beta.a.focused).toBe(true);
        fire(tree, 'keydown', makeEvent({ key: 'b' }));
        expect(rows.bravo.a.focused).toBe(true);
        fire(tree, 'keydown', makeEvent({ key: 'b' })); // no match after Bravo: wraps
        expect(rows.beta.a.focusCount).toBe(2);
    });

    it('accumulates keystrokes into a multi-char prefix', () => {
        const { tree, doc, buildTypeRows } = setup({});
        const rows = buildTypeRows();
        doc.activeElement = rows.alpha.a;
        fire(tree, 'keydown', makeEvent({ key: 'b' }));
        fire(tree, 'keydown', makeEvent({ key: 'r' })); // buffer "br"
        expect(rows.bravo.a.focused).toBe(true);
        expect(rows.beta.a.focusCount).toBe(1); // only the first 'b' landed there
    });

    it('the 500ms timer clears the buffer, restarting the prefix', () => {
        const { tree, doc, buildTypeRows } = setup({});
        const rows = buildTypeRows();
        doc.activeElement = rows.alpha.a;
        fire(tree, 'keydown', makeEvent({ key: 'b' }));
        fire(tree, 'keydown', makeEvent({ key: 'r' })); // "br" → Bravo
        expect(rows.bravo.a.focused).toBe(true);
        timeouts[1][0](); // let the buffer expire
        doc.activeElement = rows.alpha.a;
        fire(tree, 'keydown', makeEvent({ key: 'b' }));
        // cleared: a fresh 'b' matches Beta again (a kept buffer "brb" would match nothing)
        expect(rows.beta.a.focusCount).toBe(2);
    });

    it('ignores multi-character keys without scheduling the timer', () => {
        const { tree, doc, buildTypeRows } = setup({});
        const rows = buildTypeRows();
        doc.activeElement = rows.alpha.a;
        fire(tree, 'keydown', makeEvent({ key: 'Shift' }));
        expect(rows.beta.a.focused).toBe(false);
        expect(timeouts).toEqual([]);
    });

    it('escapes regexp metacharacters in the typed prefix', () => {
        const { tree, doc, buildTypeRows } = setup({});
        const rows = buildTypeRows();
        doc.activeElement = rows.alpha.a;
        fire(tree, 'keydown', makeEvent({ key: '.' }));
        expect(rows.dot.a.focused).toBe(true); // literal '.', not /^./ matching Beta
        expect(rows.beta.a.focused).toBe(false);
    });

    it('skips rows in collapsed (zero-height) containers', () => {
        const { tree, doc, buildTypeRows } = setup({});
        const rows = buildTypeRows();
        doc.activeElement = rows.bravo.a;
        fire(tree, 'keydown', makeEvent({ key: 'h' }));
        expect(rows.hidden.a.focused).toBe(false);
    });
});

describe('treeKeyUp — Delete', () => {
    it('deletes the focused bookmark row', () => {
        const { tree, b11, doc, actionCalls } = setup({});
        doc.activeElement = b11.link;
        const ev = makeEvent({ key: 'Delete' });
        fire(tree, 'keyup', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(actionCalls).toEqual([['deleteBookmark', '11']]);
    });

    it('deletes a folder with its bookmark/subfolder counts from getChildren', () => {
        const children = [
            { id: 'a', url: 'http://a/' },
            { id: 'b' }, // subfolder: no url
            { id: 'c', url: 'http://c/' }
        ];
        const { tree, f5, doc, actionCalls } = setup({ children: { '5': children } });
        doc.activeElement = f5.link;
        fire(tree, 'keyup', makeEvent({ key: 'Delete' }));
        expect(actionCalls).toEqual([['deleteBookmarks', '5', 2, 1]]);
    });

    it('works on the results pane, stripping the results-item- prefix', () => {
        const { results, r1, doc, actionCalls } = setup({ searchActive: true });
        doc.activeElement = r1.link;
        fire(results, 'keyup', makeEvent({ key: 'Delete' }));
        expect(actionCalls).toEqual([['deleteBookmark', '91']]);
    });

    it('ignores other keys', () => {
        const { tree, b11, doc, actionCalls } = setup({});
        doc.activeElement = b11.link;
        const ev = makeEvent({ key: 'Enter' });
        fire(tree, 'keyup', ev);
        expect(actionCalls).toEqual([]);
        expect(ev.defaultPrevented).toBe(false);
    });

    it('prefers the data-node-id row id; skips rows with no resolvable id', () => {
        const ctx = setup({});
        const r = ctx.row('A', 'recent-item-3'); // prefix would strip to 3
        r.li.dataset.nodeId = '77';
        ctx.doc.activeElement = r.link;
        fire(ctx.tree, 'keyup', makeEvent({ key: 'Delete' }));
        expect(ctx.actionCalls).toEqual([['deleteBookmark', '77']]);
        const bare = ctx.row('A', 'recent-item-'); // strips to '' → no id
        ctx.doc.activeElement = bare.link;
        fire(ctx.tree, 'keyup', makeEvent({ key: 'Delete' }));
        expect(ctx.actionCalls).toEqual([['deleteBookmark', '77']]); // unchanged
    });

    it('does not delete a root folder (parentid 0 — same guard as the menu)', () => {
        const ctx = setup({}); // f1 is the parentid '0' root
        ctx.doc.activeElement = ctx.f1.link;
        fire(ctx.tree, 'keyup', makeEvent({ key: 'Delete' }));
        expect(ctx.actionCalls).toEqual([]); // no deleteBookmarks fires
        // a NON-root folder still reaches the delete action
        const { tree: t2, doc: d2, actionCalls: calls2, f5: sub } = setup({});
        d2.activeElement = sub.link; // f5 is now parentid '1'
        fire(t2, 'keyup', makeEvent({ key: 'Delete' }));
        expect(calls2).toEqual([['deleteBookmarks', '5', 0, 0]]); // empty folder → 0/0
    });
});

describe('contextKeyDown', () => {
    it('binds ArrowDown navigation on the search-history menu too', () => {
        const { searchHistoryMenu, shmItem1, shmItem2, doc } = setup({});
        expect(searchHistoryMenu._listeners.keydown).toHaveLength(1);
        doc.activeElement = shmItem1;
        fire(searchHistoryMenu, 'keydown', makeEvent({ key: 'ArrowDown' }));
        expect(shmItem2.focused).toBe(true);
    });

    it('init does not throw when the search-history menu is absent', () => {
        const { bookmarkMenu, item1, item2, doc } = setup({ noSearchHistoryMenu: true });
        doc.activeElement = item1;
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowDown' }));
        expect(item2.focused).toBe(true);
    });

    it('ArrowDown moves to the next menu item, skipping <hr> separators', () => {
        const { bookmarkMenu, item1, item2, doc } = setup({});
        doc.activeElement = item1;
        const ev = makeEvent({ key: 'ArrowDown' });
        fire(bookmarkMenu, 'keydown', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(item2.focused).toBe(true);
    });

    it('ArrowDown past the last item wraps to the first', () => {
        const { bookmarkMenu, item1, item2, doc } = setup({});
        doc.activeElement = item2;
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowDown' }));
        expect(item1.focused).toBe(true);
    });

    it('ArrowDown past the last item wraps on Mac too (4.0.1 P1: no platform exception)', () => {
        const { bookmarkMenu, item1, item2, doc } = setup({ os: 'mac' });
        doc.activeElement = item2;
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowDown' }));
        expect(item1.focused).toBe(true);
    });

    it('ArrowUp moves to the previous menu item, skipping <hr> separators', () => {
        const { bookmarkMenu, item1, item2, doc } = setup({});
        doc.activeElement = item2;
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowUp' }));
        expect(item1.focused).toBe(true);
    });

    it('ArrowUp past the first item wraps to the last', () => {
        const { bookmarkMenu, item1, item2, doc } = setup({});
        doc.activeElement = item1;
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowUp' }));
        expect(item2.focused).toBe(true);
    });

    it('ArrowUp past the first item wraps on Mac too (4.0.1 P1: no platform exception)', () => {
        const { bookmarkMenu, item1, item2, doc } = setup({ os: 'mac' });
        doc.activeElement = item1;
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowUp' }));
        expect(item2.focused).toBe(true);
    });

    it('Meta+ArrowDown/ArrowUp jump to the last/first menu item', () => {
        const { bookmarkMenu, item1, item2, doc } = setup({});
        doc.activeElement = item1;
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowDown', metaKey: true }));
        expect(item2.focused).toBe(true);
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowUp', metaKey: true }));
        expect(item1.focusCount).toBe(1);
        expect(item1.focused).toBe(true);
    });

    it('ArrowDown skips a disabled menu item (root-folder greys)', () => {
        // menu: item1 (disabled) <hr> item2 — walking down from item1 must
        // land on item2, never on the disabled item.
        const ctx = setup({});
        const { bookmarkMenu, item1, item2, doc } = ctx;
        item1.classList.add('disabled');
        doc.activeElement = item1;
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowDown' }));
        expect(item2.focused).toBe(true); // the disabled item was skipped
    });

    it('ArrowUp skips a disabled menu item', () => {
        const { bookmarkMenu, item1, item2, doc, el } = setup({});
        const d = el('DIV', 'mi-disabled');
        d.classList.add('menu-item');
        d.classList.add('disabled');
        // item1 <hr> disabled <hr> item2
        item1.nextElementSibling = d;
        d.previousElementSibling = item1;
        d.nextElementSibling = item2;
        item2.previousElementSibling = d;
        doc.activeElement = item2;
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowUp' }));
        expect(item1.focused).toBe(true); // skipped both the disabled item and hr
    });

    it('Meta+ArrowDown skips a disabled last item (lands on the last enabled)', () => {
        const { bookmarkMenu, item1, item2, doc } = setup({});
        // item1 <hr> item2, and item2 is disabled — Meta+↓ must walk back to
        // item1 (the last enabled item), never focus the disabled last.
        item2.classList.add('disabled');
        doc.activeElement = item1;
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowDown', metaKey: true }));
        expect(item1.focused).toBe(true); // item2 (disabled) never focused
    });

    it('ArrowDown walks the whole root-folder menu landing only on enabled, visible items', () => {
        // Mirror the REAL root-folder menu (pages/popup.html folder-context-menu):
        // 4 open items, then the disabled edit, the CSS-hidden sort item, the
        // three in-root adds, then the disabled before/after/separator cluster
        // and the disabled delete. Walking down from the top must never land on
        // a disabled or display:none item.
        const { bookmarkMenu, el, doc } = setup({});
        const mk = (id, extra) => {
            const n = el('DIV', id);
            n.classList.add('menu-item');
            if (extra === 'disabled') n.classList.add('disabled');
            if (extra === 'hidden') n.style.display = 'none';
            return n;
        };
        const items = [
            mk('folder-window'),
            mk('open-bookmarks-in-group'),
            mk('folder-new-window'),
            mk('folder-new-incognito-window'),
            el('HR'), mk('folder-edit', 'disabled'),
            el('HR'), mk('sort-folder-contents', 'hidden'),
            el('HR'),
            mk('add-bookmark-top'), mk('add-bookmark-bottom'), mk('add-new-folder'),
            el('HR'),
            mk('add-bookmark-before-folder', 'disabled'), mk('add-bookmark-after-folder', 'disabled'),
            mk('add-folder-before-folder', 'disabled'), mk('add-folder-after-folder', 'disabled'),
            mk('add-folder-separator', 'disabled'),
            el('HR'), mk('folder-delete', 'disabled')
        ];
        for (let i = 0; i < items.length; i++) {
            items[i].previousElementSibling = items[i - 1] || null;
            items[i].nextElementSibling = items[i + 1] || null;
        }
        bookmarkMenu.firstElementChild = items[0];
        bookmarkMenu.lastElementChild = items[items.length - 1];
        // Walk down from the first open item across the whole menu. The double's
        // focus() does not update doc.activeElement, so advance it by hand to
        // simulate a real browser — each step asserts the NEXT focused item is
        // enabled AND visible (never a disabled edit or the hidden sort row).
        const enabledVisible = items.filter(n =>
            n.tagName !== 'HR' && !n.classList.contains('disabled') && n.style.display !== 'none');
        doc.activeElement = items[0];
        for (let step = 0; step < enabledVisible.length - 1; step++) {
            fire(bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowDown' }));
            // the walk must land on the NEXT enabled-visible item (the disabled
            // edit, the hidden sort row and the disabled cluster are excluded
            // from enabledVisible, so stepping on any of them would fail here)
            const focused = enabledVisible[step + 1];
            expect(focused.focused, `step ${step} should focus ${focused.id}`).toBe(true);
            doc.activeElement = focused; // the next walk starts from here
        }
    });

    it('ArrowDown crosses the root-folder menu: skips the disabled edit AND the CSS-hidden sort item', () => {
        // Reproduces the reported gap: the ROOT folder menu has folder-edit
        // disabled AND #sort-folder-contents display:none (hide-sort). Walking
        // down from the last enabled open item must clear BOTH — focusing the
        // hidden sort item would make the walk look dead (invisible focus ring).
        // Chain: item1(enabled) <hr> edit(disabled) <hr> sort(display:none) <hr> item2(enabled)
        const { bookmarkMenu, item1, item2, doc, el } = setup({});
        const edit = el('DIV', 'folder-edit');
        edit.classList.add('menu-item');
        edit.classList.add('disabled');
        const hr1 = el('HR');
        const sort = el('DIV', 'sort-folder-contents');
        sort.classList.add('menu-item');
        sort.style.display = 'none'; // the CSS hide-sort rule, mirrored in the double
        const hr2 = el('HR');
        // re-wire: item1 <hr1> edit <hr1> sort <hr2> item2
        item1.nextElementSibling = hr1;
        hr1.previousElementSibling = item1;
        hr1.nextElementSibling = edit;
        edit.previousElementSibling = hr1;
        edit.nextElementSibling = sort;
        sort.previousElementSibling = edit;
        sort.nextElementSibling = hr2;
        hr2.previousElementSibling = sort;
        hr2.nextElementSibling = item2;
        item2.previousElementSibling = hr2;
        doc.activeElement = item1;
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowDown' }));
        // one step: past the disabled edit and the hidden sort → lands on item2
        expect(item2.focused).toBe(true);
        expect(edit.focused).toBe(false); // disabled edit never focused
        expect(sort.focused).toBe(false); // hidden sort never focused
    });

    it('focuses the first/last item when the menu itself holds focus', () => {
        const { bookmarkMenu, item1, item2, doc } = setup({});
        doc.activeElement = bookmarkMenu; // not a .menu-item
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowDown' }));
        expect(item1.focused).toBe(true);
        doc.activeElement = bookmarkMenu;
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowUp' }));
        expect(item2.focused).toBe(true);
    });

    it('container-held ↓ enters at the first VISIBLE enabled item (K1: bookmark menu on a tree row)', () => {
        // Mirror the real bookmark menu opened on a tree row (pages/popup.html):
        // reveal-in-tree / its separator / dead-mark-toggle / dupes-set-keeper
        // are all display:none — the first WALKABLE item is bookmark-new-tab.
        // The old entry branch focused firstElementChild (display:none →
        // unfocusable), deadlocking ↓ on the container.
        const { bookmarkMenu, item2, el, doc } = setup({});
        const hiddenItem = id => {
            const n = el('DIV', id);
            n.classList.add('menu-item');
            n.style.display = 'none';
            return n;
        };
        const reveal = hiddenItem('reveal-in-tree');
        const sep = el('HR');
        sep.style.display = 'none';
        const mark = hiddenItem('dead-mark-toggle');
        const keeper = hiddenItem('dupes-set-keeper');
        const newTab = el('DIV', 'bookmark-new-tab');
        newTab.classList.add('menu-item');
        const nodes = [reveal, sep, mark, keeper, newTab, item2];
        for (let i = 0; i < nodes.length; i++) {
            nodes[i].previousElementSibling = nodes[i - 1] || null;
            nodes[i].nextElementSibling = nodes[i + 1] || null;
        }
        bookmarkMenu.firstElementChild = reveal;
        bookmarkMenu.lastElementChild = item2;
        doc.activeElement = bookmarkMenu;
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowDown' }));
        expect(newTab.focused).toBe(true);
        expect(reveal.focused).toBe(false);
        expect(mark.focused).toBe(false);
    });

    it('container-held ↑ enters at the last ENABLED item (K9: root-folder delete greys out)', () => {
        const { bookmarkMenu, item1, item2, doc } = setup({});
        item2.classList.add('disabled'); // folder-delete on a root folder
        doc.activeElement = bookmarkMenu;
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowUp' }));
        expect(item1.focused).toBe(true);
        expect(item2.focused).toBe(false); // the disabled tail never takes focus
    });

    it('Enter confirms: a bubbling button-0 mouseup on the focused menu item', () => {
        const { bookmarkMenu, item1, doc } = setup({});
        doc.activeElement = item1;
        const ev = makeEvent({ key: 'Enter' });
        fire(bookmarkMenu, 'keydown', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(item1._dispatched).toHaveLength(1);
        expect(item1._dispatched[0].type).toBe('mouseup');
        expect(item1._dispatched[0].button).toBe(0);
        expect(item1._dispatched[0].bubbles).toBe(true);
    });

    it('Space confirms with the same mouseup', () => {
        const { bookmarkMenu, item2, doc } = setup({});
        doc.activeElement = item2;
        fire(bookmarkMenu, 'keydown', makeEvent({ key: ' ' }));
        expect(item2._dispatched).toHaveLength(1);
        expect(item2._dispatched[0].type).toBe('mouseup');
        expect(item2._dispatched[0].button).toBe(0);
    });

    it('confirm keys are a no-op (besides preventDefault) when the menu container holds focus', () => {
        const { bookmarkMenu, item1, doc } = setup({});
        doc.activeElement = bookmarkMenu; // freshly opened: no item focused
        for (const key of ['ArrowRight', 'Enter', ' ']) { // LTR: → confirms too
            const ev = makeEvent({ key });
            fire(bookmarkMenu, 'keydown', ev);
            expect(ev.defaultPrevented).toBe(true);
        }
        expect(item1._dispatched).toEqual([]);
        expect(bookmarkMenu._dispatched).toEqual([]); // never dispatched on the container
    });

    it('confirm keys are a no-op on a DISABLED menu item', () => {
        const { bookmarkMenu, item1, doc } = setup({});
        item1.classList.add('disabled');
        doc.activeElement = item1;
        for (const key of ['ArrowRight', 'Enter', ' ']) {
            const ev = makeEvent({ key });
            fire(bookmarkMenu, 'keydown', ev);
            expect(ev.defaultPrevented).toBe(true);
        }
        expect(item1._dispatched).toEqual([]);
    });

    it('Home/End jump to the first/last menu item (P2)', () => {
        const { bookmarkMenu, item1, item2, doc } = setup({});
        doc.activeElement = item2;
        const home = makeEvent({ key: 'Home' });
        fire(bookmarkMenu, 'keydown', home);
        expect(home.defaultPrevented).toBe(true);
        expect(item1.focused).toBe(true);
        doc.activeElement = item1;
        const end = makeEvent({ key: 'End' });
        fire(bookmarkMenu, 'keydown', end);
        expect(end.defaultPrevented).toBe(true);
        expect(item2.focused).toBe(true);
    });

    it('Home/End land on the first/last ENABLED item, skipping a disabled edge', () => {
        const { bookmarkMenu, item1, item2, doc } = setup({});
        item2.classList.add('disabled'); // the tail greys out (root-folder delete)
        doc.activeElement = bookmarkMenu;
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'End' }));
        expect(item1.focused).toBe(true);
        expect(item2.focused).toBe(false);
        item2.classList.remove('disabled');
        item1.classList.add('disabled'); // now the HEAD is disabled
        item1.focused = false;
        doc.activeElement = bookmarkMenu;
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'Home' }));
        expect(item2.focused).toBe(true);
        expect(item1.focused).toBe(false);
    });

    it('Escape cancels the menu: closeMenu unmarks and refocuses the active row', () => {
        const { bookmarkMenu, item1, doc, closeMenuCalls, clearMenuCalls, row } = setup({});
        const active = row('A', 'neat-tree-item-42');
        active.link.classList.add('active');
        doc.activeElement = item1;
        const ev = makeEvent({ key: 'Escape' });
        fire(bookmarkMenu, 'keydown', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(closeMenuCalls).toEqual(['close']);
        expect(clearMenuCalls).toEqual([]); // routed through closeMenu now
        expect(active.link.classList.contains('active')).toBe(false); // the double mirrors it
        expect(active.link.focused).toBe(true);
    });

    it('Escape still cancels the menu when no row is active', () => {
        const { bookmarkMenu, item1, doc, closeMenuCalls } = setup({});
        doc.activeElement = item1;
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'Escape' }));
        expect(closeMenuCalls).toEqual(['close']);
    });

    it('cancel falls back to the inline close when the menus double lacks closeMenu', () => {
        const { bookmarkMenu, item1, doc, menus, clearMenuCalls, closeMenuCalls, row } = setup({});
        delete menus.closeMenu; // minimal setup: the pre-4.0.1 inline path
        const active = row('A', 'neat-tree-item-42');
        active.link.classList.add('active');
        doc.activeElement = item1;
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'Escape' }));
        expect(closeMenuCalls).toEqual([]);
        expect(clearMenuCalls).toEqual(['clear']);
        expect(active.link.classList.contains('active')).toBe(false);
        expect(active.link.focused).toBe(true);
    });

    it('ArrowLeft cancels in ltr (closeMenu) but confirms in rtl (mouseup dispatch)', () => {
        const ltr = setup({});
        const activeLtr = ltr.row('A', 'neat-tree-item-42');
        activeLtr.link.classList.add('active');
        ltr.doc.activeElement = ltr.item1;
        const evLtr = makeEvent({ key: 'ArrowLeft' });
        fire(ltr.bookmarkMenu, 'keydown', evLtr);
        expect(evLtr.defaultPrevented).toBe(true);
        expect(ltr.closeMenuCalls).toEqual(['close']);
        expect(activeLtr.link.classList.contains('active')).toBe(false);
        expect(activeLtr.link.focused).toBe(true);
        expect(ltr.item1._dispatched).toEqual([]); // cancel never dispatches

        const rtl = setup({ rtl: true });
        rtl.doc.activeElement = rtl.item1;
        const ev = makeEvent({ key: 'ArrowLeft' });
        fire(rtl.bookmarkMenu, 'keydown', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(rtl.closeMenuCalls).toEqual([]);
        // confirm = the focused enabled item's own mouseup (button 0, bubbling)
        expect(rtl.item1._dispatched).toHaveLength(1);
        expect(rtl.item1._dispatched[0].type).toBe('mouseup');
        expect(rtl.item1._dispatched[0].button).toBe(0);
    });

    it('ArrowRight confirms in ltr (mouseup dispatch) but cancels in rtl (closeMenu)', () => {
        const ltr = setup({});
        ltr.doc.activeElement = ltr.item1;
        const evLtr = makeEvent({ key: 'ArrowRight' });
        fire(ltr.bookmarkMenu, 'keydown', evLtr);
        expect(evLtr.defaultPrevented).toBe(true);
        expect(ltr.closeMenuCalls).toEqual([]);
        expect(ltr.item1._dispatched).toHaveLength(1);
        expect(ltr.item1._dispatched[0].type).toBe('mouseup');
        expect(ltr.item1._dispatched[0].button).toBe(0);
        expect(ltr.item1._dispatched[0].bubbles).toBe(true);

        const rtl = setup({ rtl: true });
        const activeRtl = rtl.row('A', 'neat-tree-item-42');
        activeRtl.link.classList.add('active');
        rtl.doc.activeElement = rtl.item1;
        fire(rtl.bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowRight' }));
        expect(rtl.closeMenuCalls).toEqual(['close']);
        expect(activeRtl.link.classList.contains('active')).toBe(false);
        expect(rtl.item1._dispatched).toEqual([]); // cancel never dispatches
    });

    it('is also bound on the folder menu', () => {
        const { folderMenu, item1, doc, closeMenuCalls } = setup({});
        doc.activeElement = item1;
        fire(folderMenu, 'keydown', makeEvent({ key: 'Escape' }));
        expect(closeMenuCalls).toEqual(['close']);
    });

    it('is bound on the separator menu too (4.0.1: remove-separator was unreachable by keys)', () => {
        const { separatorMenu, doc, el } = setup({});
        expect(separatorMenu._listeners.keydown).toHaveLength(1);
        // the real menu's single entry
        const rm = el('DIV', 'remove-separator');
        rm.classList.add('menu-item');
        rm.parentNode = separatorMenu;
        separatorMenu.firstElementChild = rm;
        separatorMenu.lastElementChild = rm;
        doc.activeElement = separatorMenu; // freshly opened: container focus
        fire(separatorMenu, 'keydown', makeEvent({ key: 'ArrowDown' }));
        expect(rm.focused).toBe(true); // ↓ enters the only item
        fire(separatorMenu, 'keydown', makeEvent({ key: 'Enter' }));
        expect(rm._dispatched).toHaveLength(1);
        expect(rm._dispatched[0].type).toBe('mouseup'); // confirm runs it
    });

    it('binds the full walk on the palette custom-command menu too (K7)', () => {
        const { paletteCmdMenu, pcmItem1, pcmItem2, doc } = setup({});
        expect(paletteCmdMenu._listeners.keydown).toHaveLength(1);
        doc.activeElement = pcmItem1;
        fire(paletteCmdMenu, 'keydown', makeEvent({ key: 'ArrowDown' }));
        expect(pcmItem2.focused).toBe(true);
        // Enter dispatches the item's mouseup, same as every other menu
        fire(paletteCmdMenu, 'keydown', makeEvent({ key: 'Enter' }));
        expect(pcmItem2._dispatched).toHaveLength(1);
        expect(pcmItem2._dispatched[0].type).toBe('mouseup');
    });

    it('init does not throw when the palette-cmd menu is absent', () => {
        // setup() runs initKeyboard — if the missing-menu guard crashed, this
        // whole test would throw. The assertion must verify real behavior, not
        // setup's own stub output (paletteCmdMenu is null by construction):
        // the OTHER menus stay keyboard-bound when the palette menu is gone.
        const { bookmarkMenu, doc, el } = setup({ noPaletteCmdMenu: true });
        const bmItem = el('DIV', 'bookmark-new-tab');
        bmItem.classList.add('menu-item');
        bmItem.parentNode = bookmarkMenu;
        bookmarkMenu.firstElementChild = bmItem;
        bookmarkMenu.lastElementChild = bmItem;
        doc.activeElement = bookmarkMenu; // freshly opened: container focus
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowDown' }));
        expect(bmItem.focused).toBe(true);
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'Enter' }));
        expect(bmItem._dispatched).toHaveLength(1);
    });

    // issue #48 follow-up: the collapsed-group flyouts (→ opens + steps in,
    // ← closes only the flyout, ↑/↓ walk the flyout, Enter toggles, and the
    // two-level document Esc).
    it('→ on a collapse entry opens the flyout and focuses its first item', () => {
        const { bookmarkMenu, submenuEl, submenuCalls, el, doc } = setup({ submenu: true });
        const entry = el('DIV', 'bookmark-tab-group-collapse');
        entry.classList.add('menu-item', 'has-submenu');
        const s1 = el('DIV', 'sub-bookmark-open-in-new-group');
        s1.classList.add('menu-item');
        submenuEl.firstElementChild = s1;
        doc.activeElement = entry;
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowRight' }));
        expect(submenuCalls).toEqual([['open', 'bookmark-tab-group-collapse']]);
        expect(s1.focused).toBe(true);
    });

    it('← inside a flyout closes only the flyout (no full-menu cancel)', () => {
        const { submenuEl, submenuCalls, closeMenuCalls, menus, el, doc } = setup({ submenu: true });
        const s1 = el('DIV', 'sub-s1');
        s1.classList.add('menu-item');
        submenuEl.firstElementChild = s1;
        doc.activeElement = s1;
        menus.openSubmenuFor({ id: 'folder-sort-collapse', _submenu: submenuEl });
        fire(submenuEl, 'keydown', makeEvent({ key: 'ArrowLeft' }));
        expect(submenuCalls).toContainEqual(['close', true]);
        expect(closeMenuCalls).toEqual([]);
    });

    it('← on a collapse entry closes the flyout first, then cancels the menu', () => {
        const { bookmarkMenu, submenuEl, submenuCalls, closeMenuCalls, menus, el, doc } = setup({ submenu: true });
        const entry = el('DIV', 'folder-sort-collapse');
        entry.classList.add('menu-item', 'has-submenu');
        doc.activeElement = entry;
        menus.openSubmenuFor({ id: entry.id, _submenu: submenuEl });
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowLeft' }));
        expect(submenuCalls).toContainEqual(['close', true]);
        expect(closeMenuCalls).toEqual([]);
        // no flyout open now → back cancels the whole menu
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowLeft' }));
        expect(closeMenuCalls).toEqual(['close']);
    });

    it('↑/↓ inside a flyout walk its items', () => {
        const { submenuEl, el, doc } = setup({ submenu: true });
        const s1 = el('DIV', 's1');
        s1.classList.add('menu-item');
        const s2 = el('DIV', 's2');
        s2.classList.add('menu-item');
        s1.nextElementSibling = s2;
        s2.previousElementSibling = s1;
        submenuEl.firstElementChild = s1;
        submenuEl.lastElementChild = s2;
        doc.activeElement = s1;
        fire(submenuEl, 'keydown', makeEvent({ key: 'ArrowDown' }));
        expect(s2.focused).toBe(true);
        doc.activeElement = s2;
        fire(submenuEl, 'keydown', makeEvent({ key: 'ArrowUp' }));
        expect(s1.focused).toBe(true);
    });

    it('Enter on a collapse entry toggles the flyout (open, then close)', () => {
        const { bookmarkMenu, submenuEl, submenuCalls, menus, el, doc } = setup({ submenu: true });
        const entry = el('DIV', 'folder-sort-collapse');
        entry.classList.add('menu-item', 'has-submenu');
        doc.activeElement = entry;
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'Enter' }));
        expect(submenuCalls).toContainEqual(['open', 'folder-sort-collapse']);
        expect(menus.submenuOpen()).toBe(true);
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'Enter' }));
        expect(submenuCalls).toContainEqual(['close', true]);
        expect(menus.submenuOpen()).toBe(false);
    });

    it('document Esc closes the flyout first, then the whole menu', () => {
        const { bookmarkMenu, submenuEl, submenuCalls, closeMenuCalls, menus, row, fireDoc } = setup({ submenu: true });
        const active = row('A', 'neat-tree-item-42');
        active.link.classList.add('active');
        bookmarkMenu.style.opacity = '1'; // a menu really is open
        menus.openSubmenuFor({ id: 'folder-sort-collapse', _submenu: submenuEl });
        fireDoc('keydown', makeEvent({ key: 'Escape' }));
        expect(submenuCalls).toContainEqual(['close', true]);
        expect(closeMenuCalls).toEqual([]);
        fireDoc('keydown', makeEvent({ key: 'Escape' }));
        expect(closeMenuCalls).toEqual(['close']);
    });

    it('↑/↓ wrap inside a flyout (P1 all-platform wrap, same as any menu)', () => {
        const { submenuEl, el, doc } = setup({ submenu: true });
        const s1 = el('DIV', 's1');
        s1.classList.add('menu-item');
        const s2 = el('DIV', 's2');
        s2.classList.add('menu-item');
        s1.nextElementSibling = s2;
        s2.previousElementSibling = s1;
        submenuEl.firstElementChild = s1;
        submenuEl.lastElementChild = s2;
        doc.activeElement = s1;
        fire(submenuEl, 'keydown', makeEvent({ key: 'ArrowUp' }));
        expect(s2.focused).toBe(true); // ↑ at the top wraps to the last
        doc.activeElement = s2;
        fire(submenuEl, 'keydown', makeEvent({ key: 'ArrowDown' }));
        expect(s1.focused).toBe(true); // ↓ at the bottom wraps to the first
    });

    it('arrowing away from a collapse entry closes its flyout (no stale flyout)', () => {
        const { bookmarkMenu, submenuCalls, menus, el, doc } = setup({ submenu: true });
        const entry = el('DIV', 'folder-sort-collapse');
        entry.classList.add('menu-item', 'has-submenu');
        const next = el('DIV', 'folder-new-window');
        next.classList.add('menu-item');
        entry.nextElementSibling = next;
        next.previousElementSibling = entry;
        bookmarkMenu.firstElementChild = entry;
        bookmarkMenu.lastElementChild = next;
        doc.activeElement = entry;
        // hover-like state: flyout open, focus parked on the entry.
        menus.openSubmenuFor(entry);
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowDown' }));
        expect(next.focused).toBe(true);
        expect(submenuCalls).toContainEqual(['close', false]);
        expect(menus.submenuOpen()).toBe(false);
        // End jumps to the last item (away from the entry) — closes too.
        menus.openSubmenuFor(entry);
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'End' }));
        expect(next.focused).toBe(true);
        expect(menus.submenuOpen()).toBe(false);
        // Home focuses the FIRST item — the entry itself, which owns the
        // flyout → the flyout correctly STAYS open.
        menus.openSubmenuFor(entry);
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'Home' }));
        expect(entry.focused).toBe(true);
        expect(menus.submenuOpen()).toBe(true);
    });

    it('← on a plain parent item peels the flyout first, then cancels the menu', () => {
        const { bookmarkMenu, submenuEl, submenuCalls, closeMenuCalls, menus, el, doc } = setup({ submenu: true });
        const entry = el('DIV', 'folder-sort-collapse');
        entry.classList.add('menu-item', 'has-submenu');
        const plain = el('DIV', 'folder-new-window');
        plain.classList.add('menu-item');
        entry.nextElementSibling = plain;
        plain.previousElementSibling = entry;
        bookmarkMenu.firstElementChild = entry;
        bookmarkMenu.lastElementChild = plain;
        doc.activeElement = plain;
        menus.openSubmenuFor({ id: entry.id, _submenu: submenuEl });
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowLeft' }));
        expect(submenuCalls).toContainEqual(['close', true]);
        expect(closeMenuCalls).toEqual([]); // the menu itself stays open
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowLeft' }));
        expect(closeMenuCalls).toEqual(['close']);
    });
});

describe('document Escape / Ctrl+F', () => {
    it('Escape closes an open dialog and touches nothing else', () => {
        const { fireDoc, searchInput, closeDialogsCalls, searchCalls } = setup({ dialogOpen: true });
        searchInput.value = 'query';
        const ev = makeEvent({ key: 'Escape' });
        fireDoc('keydown', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(closeDialogsCalls).toEqual(['close']);
        expect(searchCalls).toEqual([]);
        expect(searchInput.value).toBe('query');
    });

    it('Escape routes an active search through the two-level search.escape', () => {
        const { fireDoc, searchInput, searchCalls } = setup({ searchActive: true });
        searchInput.value = 'query';
        const ev = makeEvent({ key: 'Escape' });
        fireDoc('keydown', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(searchCalls).toEqual(['escape']);
        expect(searchInput.value).toBe('');
    });

    it('Escape with text in the input lets search.escape clear it (no quit)', () => {
        const { fireDoc, searchInput, searchCalls } = setup({});
        searchInput.value = 'query';
        const ev = makeEvent({ key: 'Escape' });
        fireDoc('keydown', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(searchCalls).toEqual(['escape']);
        expect(searchInput.value).toBe('');
    });

    it('Escape falls back to quit/clear for a pre-slice-B search API without escape()', () => {
        const { fireDoc, searchInput, search, searchCalls } = setup({ searchActive: true });
        delete search.escape; // legacy double: keyboard.js mirrors the old wiring
        searchInput.value = 'query';
        fireDoc('keydown', makeEvent({ key: 'Escape' }));
        expect(searchCalls).toEqual(['quit']);
        expect(searchInput.value).toBe('');
        // inactive with leftover text: cleared inline
        searchInput.value = 'draft';
        fireDoc('keydown', makeEvent({ key: 'Escape' }));
        expect(searchCalls).toEqual(['quit']);
        expect(searchInput.value).toBe('');
    });

    it('Escape with nothing to do prevents default (we manage popup close ourselves)', () => {
        const { fireDoc, searchCalls, closeDialogsCalls } = setup({});
        const ev = makeEvent({ key: 'Escape' });
        fireDoc('keydown', ev);
        // We always preventDefault to stop Chrome's built-in popup-close.
        // When there's nothing left to dismiss, window.close() is called explicitly.
        expect(ev.defaultPrevented).toBe(true);
        expect(searchCalls).toEqual([]);
        expect(closeDialogsCalls).toEqual([]);
    });

    it('Ctrl+F focuses and selects the search input', () => {
        const { fireDoc, searchInput } = setup({});
        const ev = makeEvent({ key: 'f', ctrlKey: true });
        fireDoc('keydown', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(searchInput.focused).toBe(true);
        expect(searchInput.selected).toBe(true);
    });

    it('Cmd+F does the same on Mac', () => {
        const { fireDoc, searchInput } = setup({ os: 'mac' });
        const ev = makeEvent({ key: 'F', metaKey: true });
        fireDoc('keydown', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(searchInput.focused).toBe(true);
        expect(searchInput.selected).toBe(true);
    });

    it('Ctrl+F is a no-op while a dialog is open (K5)', () => {
        const { fireDoc, searchInput } = setup({ dialogOpen: true });
        const ev = makeEvent({ key: 'f', ctrlKey: true });
        fireDoc('keydown', ev);
        expect(ev.defaultPrevented).toBe(false); // the dialog keeps its keys
        expect(searchInput.focused).toBe(false); // focus is not yanked out
        expect(searchInput.selected).toBe(false);
    });

    it('Ctrl+F with a dialog open never activates the search view either', () => {
        const activateCalls = [];
        const views = {
            lists: () => [],
            listOf: () => null,
            onEscapeActive: () => false,
            escapeToTree: () => false,
            focusTop: () => {},
            activate: id => activateCalls.push(id)
        };
        const { fireDoc } = setup({ dialogOpen: true, views });
        fireDoc('keydown', makeEvent({ key: 'f', ctrlKey: true }));
        expect(activateCalls).toEqual([]);
    });
});

// v4 task-2: with a view manager injected, the list bindings, the Escape
// chain levels, the ↑-region crossing and Ctrl+F all route through it.
describe('view-manager integration (v4 task-2)', () => {
    const makeViews = (overrides = {}) => {
        const calls = { activate: [], focusTop: 0 };
        const views = {
            lists: () => [],
            listOf: () => null,
            onEscapeActive: () => false,
            escapeToTree: () => false,
            focusTop: () => { calls.focusTop++; },
            activate: (...args) => calls.activate.push(args),
            ...overrides
        };
        return { views, calls };
    };

    it('binds the nav handlers to the registry lists instead of tree/results', () => {
        let listEl;
        const ctx = setup({
            views: ({ el }) => {
                listEl = el('DIV', 'view-recent-list');
                return makeViews({
                    lists: () => [{ id: 'recent', el: listEl, typeAhead: true }]
                }).views;
            }
        });
        expect(listEl._listeners.keydown).toHaveLength(1);
        expect(listEl._listeners.keyup).toHaveLength(1);
        // the hardcoded pair is no longer bound by keyboard.js itself
        expect(ctx.tree._listeners.keydown).toBeUndefined();
        expect(ctx.results._listeners.keydown).toBeUndefined();
    });

    it('Escape runs the view consumer before the search clear', () => {
        const { views } = makeViews({ onEscapeActive: () => true });
        const { fireDoc, searchInput, searchCalls } = setup({ views, searchActive: true });
        searchInput.value = 'query';
        fireDoc('keydown', makeEvent({ key: 'Escape' }));
        expect(searchCalls).toEqual([]); // consumed by the view
        expect(searchInput.value).toBe('query');
    });

    it('Escape after the search clear falls through to escapeToTree, then window.close', () => {
        const order = [];
        const { views } = makeViews({
            onEscapeActive: () => { order.push('view'); return false; },
            escapeToTree: () => { order.push('tree'); return true; }
        });
        const { fireDoc, windowCloseCalls } = setup({ views });
        fireDoc('keydown', makeEvent({ key: 'Escape' }));
        expect(order).toEqual(['view', 'tree']);
        expect(windowCloseCalls).toEqual([]); // escapeToTree consumed it

        const none = makeViews(); // everything declines → popup closes
        const ctx2 = setup({ views: none.views });
        ctx2.fireDoc('keydown', makeEvent({ key: 'Escape' }));
        expect(ctx2.windowCloseCalls).toEqual(['close']);
    });

    it('Ctrl+F activates the search view before focusing the input', () => {
        const { views, calls } = makeViews();
        const { fireDoc, searchInput } = setup({ views });
        fireDoc('keydown', makeEvent({ key: 'f', ctrlKey: true }));
        expect(calls.activate).toEqual([['search']]);
        expect(searchInput.focused).toBe(true);
        expect(searchInput.selected).toBe(true);
    });

    it('ArrowUp past the first row crosses out through views.focusTop', () => {
        const { views, calls } = makeViews();
        const ctx = setup({
            views: ({ tree, results }) => {
                views.lists = () => [
                    { id: 'tree', el: tree, typeAhead: true },
                    { id: 'search', el: results, typeAhead: true }
                ];
                return views;
            }
        });
        ctx.doc.activeElement = ctx.f1.link;
        fire(ctx.tree, 'keydown', makeEvent({ key: 'ArrowUp' }));
        expect(calls.focusTop).toBe(1);
    });

    it('type-ahead stays off for lists registered with typeAhead: false', () => {
        const mk = flag => ({ tree }) => {
            const entry = { id: 'dead', el: tree, typeAhead: flag };
            return makeViews({
                lists: () => [entry],
                listOf: el => (el === tree ? entry : null)
            }).views;
        };
        const ctx = setup({ views: mk(false) });
        const rows = ctx.buildTypeRows();
        ctx.doc.activeElement = rows.alpha.a;
        fire(ctx.tree, 'keydown', makeEvent({ key: 'b' }));
        expect(rows.beta.a.focused).toBe(false);
        expect(timeouts).toEqual([]); // not even the keyBuffer timer
        // a typeAhead list on the same key behaves normally
        const ctx2 = setup({ views: mk(true) });
        const rows2 = ctx2.buildTypeRows();
        ctx2.doc.activeElement = rows2.alpha.a;
        fire(ctx2.tree, 'keydown', makeEvent({ key: 'b' }));
        expect(rows2.beta.a.focused).toBe(true);
    });

    it('view onKey hooks consume letters before the type-ahead gate (§2.3)', () => {
        const mk = onKey => ({ tree }) => {
            const entry = { id: 'recent', el: tree, typeAhead: true, onKey };
            return makeViews({
                lists: () => [entry],
                listOf: el => (el === tree ? entry : null)
            }).views;
        };
        // consumed: no type-ahead, not even the keyBuffer timer
        const seen = [];
        const ctx = setup({ views: mk(e => { seen.push(e.key); return true; }) });
        const rows = ctx.buildTypeRows();
        ctx.doc.activeElement = rows.alpha.a;
        fire(ctx.tree, 'keydown', makeEvent({ key: 'r' }));
        expect(seen).toEqual(['r']);
        expect(rows.beta.a.focused).toBe(false);
        expect(timeouts).toEqual([]);
        // declined: type-ahead proceeds as usual
        const ctx2 = setup({ views: mk(() => false) });
        const rows2 = ctx2.buildTypeRows();
        ctx2.doc.activeElement = rows2.alpha.a;
        fire(ctx2.tree, 'keydown', makeEvent({ key: 'b' }));
        expect(rows2.beta.a.focused).toBe(true);
    });
});

// --- Item 7b: in-list toolbar controls --------------------------------------
// The stats/dead/dupes toolbars render INSIDE their list containers, so a
// keydown on a toolbar button bubbles to treeKeyDown/treeKeyUp. Before the
// item-7b guard, the not-a-row fallback walked the (hidden) TREE: Enter on a
// stats seg button dispatched a synthetic click to a tree row and Delete
// deleted one. The guard: action keys stay with the control, navigation keys
// walk this list only, the container itself keeps the .focus-row fallback.
//
// Final polish (keyboard-model §2.5): the toolbar is a RUNG of the vertical
// chain — ↓ enters the rows (remembered first), ↑ crosses to the strip/box,
// ←/→ walk the rung's controls in reading order and WRAP at the edges
// (4.0.1 P1: a bounded fixed set cycles, the tab strip's ←/→ rule).
describe('in-list toolbar controls (item 7b + §2.5 rung)', () => {
    // A stats-like view: #stats-list containing a .vbm-toolbar with TWO
    // buttons and two bookmark rows, registered next to the tree in the view
    // registry.
    const setupStatsList = () => {
        const bag = { rec: { focusTopCalls: 0 } };
        const ctx = setup({
            views: ({ tree, el }) => {
                const listEl = el('DIV', 'stats-list');
                const toolbar = el('DIV');
                toolbar.classList.add('vbm-toolbar');
                const btn = el('BUTTON', 'seg-btn');
                const btn2 = el('BUTTON', 'stats-clear');
                toolbar._qsa['button, select, input'] = [btn, btn2];
                // minimal closest(): the buttons live in the toolbar, the
                // rows in plain lis
                const btnClosest = sel => sel === '.vbm-toolbar' ? toolbar : null;
                btn.closest = btnClosest;
                btn2.closest = btnClosest;
                toolbar.parentNode = listEl;
                const mkRow = id => {
                    const li = el('LI', `stats-item-${id}`);
                    li.dataset.nodeId = id;
                    const a = el('A');
                    a.parentNode = li;
                    a.parentElement = li;
                    li.firstElementChild = a;
                    li._qs['a, span'] = a;
                    li._qs['span, a'] = a;
                    li.parentNode = listEl;
                    return { li, a };
                };
                const r1 = mkRow('s1');
                const r2 = mkRow('s2');
                r1.li.nextElementSibling = r2.li;
                r2.li.previousElementSibling = r1.li;
                listEl._qs['li a, li span'] = r1.a;
                listEl._qs['li:last-child a, li:last-child span'] = r2.a;
                listEl._qs['.focus'] = r1.a;
                listEl._qs['ul:not(.vbm-dropdown-list)>li:first-child'] = r1.li;
                Object.assign(bag, { listEl, toolbar, btn, btn2, r1, r2 });
                const statsEntry = { id: 'stats', el: listEl, typeAhead: false };
                return {
                    lists: () => [
                        { id: 'tree', el: tree, typeAhead: true },
                        statsEntry
                    ],
                    listOf: el2 => (el2 === listEl ? statsEntry : null),
                    onEscapeActive: () => false,
                    escapeToTree: () => false,
                    focusTop: () => { bag.rec.focusTopCalls++; },
                    activate: () => {}
                };
            }
        });
        return { ctx, ...bag };
    };

    it('Enter on a toolbar button stays with the button — no row click, no preventDefault', () => {
        const { ctx, listEl, btn, r1 } = setupStatsList();
        ctx.doc.activeElement = btn;
        const ev = makeEvent({ key: 'Enter' });
        fire(listEl, 'keydown', ev);
        expect(ev.defaultPrevented).toBe(false); // the button keeps its native activation
        expect(r1.a._dispatched).toEqual([]);
        expect(ctx.f1.link._dispatched).toEqual([]); // the hidden tree is never touched
        expect(ctx.actionCalls).toEqual([]);
    });

    it('Delete (keyup) on a toolbar button deletes nothing', () => {
        const { ctx, listEl, btn } = setupStatsList();
        ctx.doc.activeElement = btn;
        fire(listEl, 'keyup', makeEvent({ key: 'Delete' }));
        expect(ctx.actionCalls).toEqual([]);
    });

    it('F2 and letter keys on a toolbar control are left alone (no type-ahead timer)', () => {
        const { ctx, listEl, btn, r1 } = setupStatsList();
        ctx.doc.activeElement = btn;
        fire(listEl, 'keydown', makeEvent({ key: 'F2' }));
        expect(ctx.actionCalls).toEqual([]);
        fire(listEl, 'keydown', makeEvent({ key: 'x' }));
        expect(timeouts).toEqual([]); // no keyBuffer timer
        expect(r1.a.focused).toBe(false);
    });

    it('ArrowDown on a toolbar button enters THIS list\'s remembered row, never the tree\'s', () => {
        const { ctx, listEl, btn, r1 } = setupStatsList();
        ctx.doc.activeElement = btn;
        const ev = makeEvent({ key: 'ArrowDown' });
        fire(listEl, 'keydown', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(r1.a.focused).toBe(true); // the .focus-marked (remembered) row
        expect(ctx.f1.link.focused).toBe(false);
    });

    it('ArrowUp on a toolbar button crosses to the strip/box (focusTop), not the last row', () => {
        const { ctx, listEl, btn, r2, rec } = setupStatsList();
        ctx.doc.activeElement = btn;
        const ev = makeEvent({ key: 'ArrowUp' });
        fire(listEl, 'keydown', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(rec.focusTopCalls).toBe(1);
        expect(r2.a.focused).toBe(false);
        expect(ctx.f1.link.focused).toBe(false);
    });

    it('ArrowUp/Down on a toolbar SELECT keep the native option change (not hijacked)', () => {
        const { ctx, listEl, btn } = setupStatsList();
        btn.tagName = 'SELECT';
        ctx.doc.activeElement = btn;
        const down = makeEvent({ key: 'ArrowDown' });
        fire(listEl, 'keydown', down);
        expect(down.defaultPrevented).toBe(false);
        const up = makeEvent({ key: 'ArrowUp' });
        fire(listEl, 'keydown', up);
        expect(up.defaultPrevented).toBe(false);
    });

    it('←/→ walk the rung\'s controls in reading order and wrap at the edges (4.0.1 P1)', () => {
        const { ctx, listEl, btn, btn2 } = setupStatsList();
        ctx.doc.activeElement = btn;
        const right = makeEvent({ key: 'ArrowRight' });
        fire(listEl, 'keydown', right);
        expect(right.defaultPrevented).toBe(true);
        expect(btn2.focused).toBe(true);
        // btn2 is the last control: another → WRAPS to the first (bounded set)
        const right2 = makeEvent({ key: 'ArrowRight' });
        fire(listEl, 'keydown', right2);
        expect(right2.defaultPrevented).toBe(true);
        expect(btn.focused).toBe(true);
        // ← from the first wraps to the last
        const left = makeEvent({ key: 'ArrowLeft' });
        fire(listEl, 'keydown', left);
        expect(left.defaultPrevented).toBe(true);
        expect(btn2.focused).toBe(true);
    });

    it('←/→ mirror in RTL', () => {
        const bag = {};
        const ctx = setup({
            rtl: true,
            views: ({ tree, el }) => {
                const listEl = el('DIV', 'stats-list');
                const toolbar = el('DIV');
                toolbar.classList.add('vbm-toolbar');
                const btn = el('BUTTON', 'seg-btn');
                const btn2 = el('BUTTON', 'stats-clear');
                toolbar._qsa['button, select, input'] = [btn, btn2];
                const btnClosest = sel => sel === '.vbm-toolbar' ? toolbar : null;
                btn.closest = btnClosest;
                btn2.closest = btnClosest;
                toolbar.parentNode = listEl;
                const li = el('LI', 'stats-item-s1');
                li.dataset.nodeId = 's1';
                const a = el('A');
                a.parentNode = li;
                a.parentElement = li;
                li.firstElementChild = a;
                li.parentNode = listEl;
                listEl._qs['li a, li span'] = a;
                listEl._qs['.focus'] = a;
                Object.assign(bag, { listEl, btn, btn2 });
                const statsEntry = { id: 'stats', el: listEl, typeAhead: false };
                return {
                    lists: () => [{ id: 'tree', el: tree, typeAhead: true }, statsEntry],
                    listOf: el2 => (el2 === listEl ? statsEntry : null),
                    onEscapeActive: () => false,
                    escapeToTree: () => false,
                    focusTop: () => {},
                    activate: () => {}
                };
            }
        });
        ctx.doc.activeElement = bag.btn;
        // physical ArrowLeft in RTL reads as "forward" → the next control
        fire(bag.listEl, 'keydown', makeEvent({ key: 'ArrowLeft' }));
        expect(bag.btn2.focused).toBe(true);
        fire(bag.listEl, 'keydown', makeEvent({ key: 'ArrowRight' }));
        expect(bag.btn.focused).toBe(true);
    });

    it('Home on a toolbar button falls through to the container case (first row)', () => {
        const { ctx, listEl, btn, r1 } = setupStatsList();
        ctx.doc.activeElement = btn;
        fire(listEl, 'keydown', makeEvent({ key: 'Home' }));
        expect(r1.a.focused).toBe(true);
        expect(ctx.f1.link.focused).toBe(false);
    });

    it('Home/End with no row-list match take the top crossing (D1: a bare listbox ul cannot crash them)', () => {
        // The dupes toolbar's strategy listbox is a ul inside the list
        // container whose option rows carry no span/a — the row-list selectors
        // exclude it (ul:not(.vbm-dropdown-list)) and the guards absorb an
        // empty result; 4.0.1 P4 then falls back to views.focusTop().
        const { ctx, listEl, btn, r1, rec } = setupStatsList();
        delete listEl._qs['ul:not(.vbm-dropdown-list)>li:first-child'];
        ctx.doc.activeElement = btn;
        expect(() => fire(listEl, 'keydown', makeEvent({ key: 'Home' }))).not.toThrow();
        expect(r1.a.focused).toBe(false);
        expect(rec.focusTopCalls).toBe(1);
        expect(() => fire(listEl, 'keydown', makeEvent({ key: 'End' }))).not.toThrow();
        expect(rec.focusTopCalls).toBe(2);
    });

    it('Home/End focus a focusable row CONTAINER itself (li[tabindex] — the dead start row)', () => {
        // The dead view's li.dead-start is a row with no inner span/a that is
        // itself focusable; 4.0.1 P4 lands Home/End on the li. (The plain
        // doubles lack getAttribute — the source guards for that; add it here.)
        const { ctx, listEl, r1 } = setupStatsList();
        const start = ctx.el('LI', 'dead-start');
        start.getAttribute = k => (k === 'tabindex' ? '-1' : null);
        listEl._qs['ul:not(.vbm-dropdown-list)>li:first-child'] = start;
        ctx.doc.activeElement = r1.a;
        fire(listEl, 'keydown', makeEvent({ key: 'Home' }));
        expect(start.focused).toBe(true); // the li itself, never a null inner row
        // End: the same rule through the visible-last-row walk
        start.parentNode = { offsetHeight: 40 }; // the doubles' visibility probe
        listEl._qsa['ul:not(.vbm-dropdown-list)>li:last-child'] = [start];
        ctx.doc.activeElement = r1.a;
        fire(listEl, 'keydown', makeEvent({ key: 'End' }));
        expect(start.focusCount).toBe(2);
    });

    it('inline row controls walk rows relative to the OWNING row (↑ past the top crosses)', () => {
        const { ctx, listEl, r1, r2, rec } = setupStatsList();
        // a keeper-radio-like button inside the first row
        const radio = { ...r1.a, tagName: 'BUTTON', closest: sel => (sel === 'li' ? r1.li : null) };
        ctx.doc.activeElement = radio;
        fire(listEl, 'keydown', makeEvent({ key: 'ArrowDown' }));
        expect(r2.a.focused).toBe(true); // next row, not the first row
        // ↑ from the top row's control takes the toolbar/strip crossing
        ctx.doc.activeElement = radio;
        fire(listEl, 'keydown', makeEvent({ key: 'ArrowUp' }));
        expect(rec.focusTopCalls).toBe(1);
    });

    it('focus on the list container itself keeps the .focus-row walk (ArrowDown)', () => {
        const { ctx, listEl, r2 } = setupStatsList();
        ctx.doc.activeElement = listEl;
        fire(listEl, 'keydown', makeEvent({ key: 'ArrowDown' }));
        expect(r2.a.focused).toBe(true); // walked from the .focus row (r1)
        expect(ctx.f1.link.focused).toBe(false);
    });

    it('Delete (keyup) on the list container falls back to its .focus row', () => {
        const { ctx, listEl } = setupStatsList();
        ctx.doc.activeElement = listEl;
        fire(listEl, 'keyup', makeEvent({ key: 'Delete' }));
        expect(ctx.actionCalls).toEqual([['deleteBookmark', 's1']]);
    });

    it('Delete (keyup) on the list container with NO .focus marker deletes nothing (K4)', () => {
        // f5903c8 parks focus on the container while an async view renders —
        // rows exist but none is marked; the old `|| first row` fallback would
        // delete an invisible target.
        const { ctx, listEl } = setupStatsList();
        delete listEl._qs['.focus']; // rows rendered, nothing marked
        ctx.doc.activeElement = listEl;
        const ev = makeEvent({ key: 'Delete' });
        fire(listEl, 'keyup', ev);
        expect(ctx.actionCalls).toEqual([]);
        expect(ev.defaultPrevented).toBe(false);
    });

    // v4 task-4 #13: the dead view stacks two toolbars (proxy strip above
    // the scan toolbar) — each is its own rung of the vertical chain.
    const setupTwoRungs = () => {
        const bag = { rec: { focusTopCalls: 0 } };
        const ctx = setup({
            views: ({ tree, el }) => {
                const listEl = el('DIV', 'dead-list');
                const bar1 = el('DIV');
                bar1.classList.add('vbm-toolbar');
                const bar2 = el('DIV');
                bar2.classList.add('vbm-toolbar');
                const b1 = el('BUTTON', 'dead-proxy-add');
                const b2 = el('BUTTON', 'dead-rescan');
                const b3 = el('BUTTON', 'dead-filter-btn');
                bar1._qsa['button, select, input'] = [b1];
                bar2._qsa['button, select, input'] = [b2, b3];
                b1.closest = sel => (sel === '.vbm-toolbar' ? bar1 : null);
                b2.closest = b3.closest = sel => (sel === '.vbm-toolbar' ? bar2 : null);
                listEl._qsa['.vbm-toolbar'] = [bar1, bar2];
                const li = el('LI', 'dead-item-d1');
                li.dataset.nodeId = 'd1';
                const a = el('A');
                a.parentNode = li;
                a.parentElement = li;
                li.firstElementChild = a;
                li.parentNode = listEl;
                listEl._qs['li a, li span'] = a;
                listEl._qs['.focus'] = a;
                Object.assign(bag, { listEl, bar1, bar2, b1, b2, b3, a });
                const deadEntry = { id: 'dead', el: listEl, typeAhead: false };
                return {
                    lists: () => [{ id: 'tree', el: tree, typeAhead: true }, deadEntry],
                    listOf: el2 => (el2 === listEl ? deadEntry : null),
                    onEscapeActive: () => false,
                    escapeToTree: () => false,
                    focusTop: () => { bag.rec.focusTopCalls++; },
                    activate: () => {}
                };
            }
        });
        return { ctx, ...bag };
    };

    it('two stacked toolbars: ↓/↑ hop rungs, ends cross to rows / strip (v4 task-4 #13)', () => {
        const { ctx, listEl, b1, b2, a, rec } = setupTwoRungs();
        // ↓ from the TOP rung lands on the lower rung's first control —
        // not straight into the rows.
        ctx.doc.activeElement = b1;
        const down1 = makeEvent({ key: 'ArrowDown' });
        fire(listEl, 'keydown', down1);
        expect(down1.defaultPrevented).toBe(true);
        expect(b2.focused).toBe(true);
        expect(a.focused).toBe(false);
        // ↓ from the LOWEST rung crosses into the rows.
        ctx.doc.activeElement = b2;
        fire(listEl, 'keydown', makeEvent({ key: 'ArrowDown' }));
        expect(a.focused).toBe(true);
        // ↑ from the lowest rung hops back to the top rung.
        ctx.doc.activeElement = b2;
        fire(listEl, 'keydown', makeEvent({ key: 'ArrowUp' }));
        expect(b1.focused).toBe(true);
        // ↑ from the TOP rung crosses out to the strip/box.
        ctx.doc.activeElement = b1;
        fire(listEl, 'keydown', makeEvent({ key: 'ArrowUp' }));
        expect(rec.focusTopCalls).toBe(1);
    });

    it('a rung without an enabled control is skipped (scan-disabled proxy strip)', () => {
        const { ctx, listEl, bar1, b1, b2, a } = setupTwoRungs();
        b1.disabled = true; // the whole top rung is disabled mid-scan
        ctx.doc.activeElement = b2;
        // ↑ from the lowest rung skips the disabled rung → strip/box
        // (focusTop is not recorded here — assert no rung landing instead)
        fire(listEl, 'keydown', makeEvent({ key: 'ArrowDown' }));
        expect(a.focused).toBe(true); // ↓ still crosses into the rows
        bar1._qsa['button, select, input'] = []; // empty rung
        ctx.doc.activeElement = b2;
        const up = makeEvent({ key: 'ArrowUp' });
        fire(listEl, 'keydown', up);
        expect(b1.focused).toBe(false);
    });

    it('↓ from the lowest rung lands on a focusable row CONTAINER (the dead-start pill)', () => {
        // The dead view's fresh/empty state shows the executable dead-start
        // row — an <li class="empty-state dead-start" tabindex="-1"> with no
        // inner span/a. The rung's ↓-into-rows crossing must land on the
        // li[tabindex] itself; the old 'li a, li span' query matched nothing
        // and the crossing silently dead-ended (start scan unreachable).
        const bag = { rec: { focusTopCalls: 0 } };
        const ctx = setup({
            views: ({ tree, el }) => {
                const listEl = el('DIV', 'dead-list');
                const bar = el('DIV');
                bar.classList.add('vbm-toolbar');
                const b = el('BUTTON', 'dead-proxy-add');
                bar._qsa['button, select, input'] = [b];
                b.closest = sel => (sel === '.vbm-toolbar' ? bar : null);
                listEl._qsa['.vbm-toolbar'] = [bar];
                const start = el('LI', 'dead-start');
                start.classList.add('empty-state', 'dead-start');
                start.getAttribute = k => (k === 'tabindex' ? '-1' : null);
                start.parentNode = listEl;
                listEl._qs['li a, li span, li[tabindex]'] = start;
                Object.assign(bag, { listEl, b, start });
                const deadEntry = { id: 'dead', el: listEl, typeAhead: false };
                return {
                    lists: () => [{ id: 'tree', el: tree, typeAhead: true }, deadEntry],
                    listOf: el2 => (el2 === listEl ? deadEntry : null),
                    onEscapeActive: () => false,
                    escapeToTree: () => false,
                    focusTop: () => { bag.rec.focusTopCalls++; },
                    activate: () => {}
                };
            }
        });
        ctx.doc.activeElement = bag.b;
        const down = makeEvent({ key: 'ArrowDown' });
        fire(bag.listEl, 'keydown', down);
        expect(down.defaultPrevented).toBe(true);
        expect(bag.start.focused).toBe(true); // the li[tabindex] pill itself
    });

    // K17: f5903c8 parks focus on the container while an async view renders —
    // with no .focus marker and no rows at all the old early-return killed ↑
    // too. ↑ takes the §2.1/§2.5 crossing; 4.0.1 P4 gives Home/End the same
    // crossing (the view has no rows to jump to); ↓ stays put until rows exist.
    it('container-focused with NO rows: ↑/Home/End cross out via focusTop, ↓ stays put (K17)', () => {
        const { ctx, listEl, rec } = setupStatsList();
        delete listEl._qs['.focus'];
        delete listEl._qs['li a, li span']; // rows not rendered yet
        ctx.doc.activeElement = listEl;
        const up = makeEvent({ key: 'ArrowUp' });
        fire(listEl, 'keydown', up);
        expect(up.defaultPrevented).toBe(true);
        expect(rec.focusTopCalls).toBe(1); // no focusListExit on this double
        ctx.doc.activeElement = listEl;
        const down = makeEvent({ key: 'ArrowDown' });
        fire(listEl, 'keydown', down);
        expect(ctx.doc.activeElement).toBe(listEl); // ↓ stayed put
        expect(rec.focusTopCalls).toBe(1);
        for (const k of ['Home', 'End']) {
            ctx.doc.activeElement = listEl;
            const ev = makeEvent({ key: k });
            fire(listEl, 'keydown', ev);
            expect(ev.defaultPrevented).toBe(true);
        }
        expect(rec.focusTopCalls).toBe(3); // Home + End took the top crossing
    });

    // --- Dupes-specific rung surface (4.0.1 regressions gate) --------------
    // The dupes toolbar (strategy/scope custom dropdowns + scheme checkbox +
    // apply-all / select-mode buttons) is the richest rung. The user-facing
    // contract (keyboard-model §2.5): the dropdown trigger's ↓ opens its
    // listbox (dropdown.js — tested there) and its ↑ walks the rung up; every
    // OTHER control's ↓ crosses into the rows (remembered first) and ↑ crosses
    // to the strip/box. A `.focus` marker that somehow sits inside a hidden
    // listbox (the 4.0.1 marker-steal regression: view-manager's focusin
    // guard now keeps it off dropdown options) must not dead-end that crossing.
    const setupDupesBar = () => {
        const bag = { rec: { focusTopCalls: 0 } };
        const ctx = setup({
            views: ({ tree, el }) => {
                const listEl = el('DIV', 'dupes-list');
                const bar = el('DIV');
                bar.classList.add('dupes-toolbar');
                bar.classList.add('vbm-toolbar');
                // the custom dropdown: trigger button + hidden listbox option
                const dropdown = el('DIV');
                dropdown.classList.add('vbm-dropdown');
                dropdown.classList.add('dupes-strategy');
                const trigger = el('BUTTON', 'dupes-strategy-trigger');
                trigger.classList.add('vbm-dropdown-trigger');
                const listbox = el('UL');
                listbox.classList.add('vbm-dropdown-list');
                listbox.hidden = true;
                const option = el('LI', 'dupes-strategy-opt');
                option.parentNode = listbox;
                listbox.parentNode = dropdown;
                trigger.parentNode = dropdown;
                dropdown.parentNode = bar;
                const checkbox = el('INPUT', 'dupes-scheme-input');
                checkbox.type = 'checkbox';
                checkbox.parentNode = bar;
                const applyAll = el('BUTTON', 'dupes-apply-all');
                applyAll.classList.add('dupes-apply-all');
                applyAll.parentNode = bar;
                bar.parentNode = listEl;
                bar._qsa['button, select, input'] = [trigger, checkbox, applyAll];
                listEl._qsa['.vbm-toolbar'] = [bar];
                // closest(): the controls live in the rung, the option in the
                // hidden listbox (the stale-marker defense keys off that)
                const inBar = sel => (sel === '.vbm-toolbar' ? bar : null);
                trigger.closest = inBar;
                checkbox.closest = inBar;
                applyAll.closest = inBar;
                option.closest = sel =>
                    sel === '.vbm-dropdown-list' ? listbox : inBar(sel);
                const mkRow = id => {
                    const li = el('LI', id);
                    li.dataset.nodeId = id;
                    const a = el('A');
                    a.parentNode = li;
                    a.parentElement = li;
                    li.firstElementChild = a;
                    li.parentNode = listEl;
                    return { li, a };
                };
                const r1 = mkRow('dupes-item-11');
                const r2 = mkRow('dupes-item-12');
                r1.li.nextElementSibling = r2.li;
                r2.li.previousElementSibling = r1.li;
                listEl._qs['li a, li span'] = r1.a;
                Object.assign(bag, { listEl, bar, trigger, listbox, option, checkbox, applyAll, r1, r2 });
                const dupesEntry = { id: 'dupes', el: listEl, typeAhead: false };
                return {
                    lists: () => [{ id: 'tree', el: tree, typeAhead: true }, dupesEntry],
                    listOf: el2 => (el2 === listEl ? dupesEntry : null),
                    onEscapeActive: () => false,
                    escapeToTree: () => false,
                    focusTop: () => { bag.rec.focusTopCalls++; },
                    activate: () => {}
                };
            }
        });
        return { ctx, ...bag };
    };

    it('dupes rung: ↓ from the checkbox / apply-all crosses into the rows', () => {
        const { ctx, listEl, checkbox, applyAll, r1 } = setupDupesBar();
        listEl._qs['.focus'] = r1.a; // the remembered row
        for (const ctl of [checkbox, applyAll]) {
            ctx.doc.activeElement = ctl;
            const ev = makeEvent({ key: 'ArrowDown' });
            fire(listEl, 'keydown', ev);
            expect(ev.defaultPrevented).toBe(true);
            expect(r1.a.focused).toBe(true);
        }
    });

    it('dupes rung: ↑ from the checkbox / apply-all crosses to the strip/box', () => {
        const { ctx, listEl, checkbox, applyAll, rec } = setupDupesBar();
        for (const ctl of [checkbox, applyAll]) {
            ctx.doc.activeElement = ctl;
            const ev = makeEvent({ key: 'ArrowUp' });
            fire(listEl, 'keydown', ev);
            expect(ev.defaultPrevented).toBe(true);
        }
        expect(rec.focusTopCalls).toBe(2);
    });

    it('dupes rung: ↑ from the closed dropdown trigger walks the rung up (no listbox interception)', () => {
        const { ctx, listEl, trigger, rec } = setupDupesBar();
        ctx.doc.activeElement = trigger;
        const up = makeEvent({ key: 'ArrowUp' });
        fire(listEl, 'keydown', up);
        expect(up.defaultPrevented).toBe(true);
        expect(rec.focusTopCalls).toBe(1);
    });

    it('dupes rung: ←/→ walk trigger → checkbox → apply-all in reading order', () => {
        const { ctx, listEl, trigger, checkbox, applyAll } = setupDupesBar();
        ctx.doc.activeElement = trigger;
        fire(listEl, 'keydown', makeEvent({ key: 'ArrowRight' }));
        expect(checkbox.focused).toBe(true);
        fire(listEl, 'keydown', makeEvent({ key: 'ArrowRight' }));
        expect(applyAll.focused).toBe(true);
        fire(listEl, 'keydown', makeEvent({ key: 'ArrowLeft' }));
        expect(checkbox.focused).toBe(true);
    });

    it('dupes rung: a stale .focus inside the hidden listbox does NOT dead-end ↓ (marker-steal regression)', () => {
        // Regression gate for the reported 4.0.1 bug: opening the strategy
        // dropdown used to focus the listbox option, which (pre-guard) stole
        // the `.focus` row marker. The toolbar's ↓ then targeted the HIDDEN
        // option (querySelector('.focus')) and .focus() silently failed — the
        // button area could no longer enter the rows. The rung must skip a
        // listbox-resident marker and fall through to the real row.
        const { ctx, listEl, applyAll, option, r1 } = setupDupesBar();
        listEl._qs['.focus'] = option; // the marker was parked on the option
        ctx.doc.activeElement = applyAll;
        const ev = makeEvent({ key: 'ArrowDown' });
        fire(listEl, 'keydown', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(option.focused).toBe(false); // never the hidden option
        expect(r1.a.focused).toBe(true);    // the crossing lands on a real row
    });
});

// --- K14: a toolbar text input owns its caret keys ---------------------------
// The dead view's proxy URL/test-URL inputs live in a .vbm-toolbar — the rung
// walk must not hijack ←/→/Home/End (caret movement) the way it walks buttons
// and selects; the passthrough mirrors the SELECT's native ↑/↓. ↑/↓ still
// leave the field through the rung walk.
describe('K14: toolbar text input keeps ←/→/Home/End (caret, not the rung)', () => {
    const setupProxyBar = () => {
        const bag = { rec: { focusTopCalls: 0 } };
        const ctx = setup({
            views: ({ tree, el }) => {
                const listEl = el('DIV', 'dead-list');
                const bar = el('DIV');
                bar.classList.add('vbm-toolbar');
                const input = el('INPUT', 'dead-proxy-input');
                input.type = 'text';
                const btn = el('BUTTON', 'dead-proxy-add');
                bar._qsa['button, select, input'] = [input, btn];
                input.closest = btn.closest = sel => (sel === '.vbm-toolbar' ? bar : null);
                bar.parentNode = listEl;
                const li = el('LI', 'dead-item-d1');
                li.dataset.nodeId = 'd1';
                const a = el('A');
                a.parentNode = li;
                a.parentElement = li;
                li.firstElementChild = a;
                li._qs['span, a'] = a;
                li.parentNode = listEl;
                listEl._qsa['.vbm-toolbar'] = [bar];
                listEl._qs['li a, li span'] = a;
                listEl._qs['ul:not(.vbm-dropdown-list)>li:first-child'] = li;
                listEl._qs['ul:not(.vbm-dropdown-list)>li:last-child'] = li;
                Object.assign(bag, { listEl, input, btn, a });
                const deadEntry = { id: 'dead', el: listEl, typeAhead: false };
                return {
                    lists: () => [{ id: 'tree', el: tree, typeAhead: true }, deadEntry],
                    listOf: el2 => (el2 === listEl ? deadEntry : null),
                    onEscapeActive: () => false,
                    escapeToTree: () => false,
                    focusTop: () => { bag.rec.focusTopCalls++; },
                    activate: () => {}
                };
            }
        });
        return { ctx, ...bag };
    };

    it('←/→/Home/End are not hijacked — the field keeps its caret keys', () => {
        const { ctx, listEl, input, btn, a } = setupProxyBar();
        for (const k of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
            ctx.doc.activeElement = input;
            const ev = makeEvent({ key: k });
            fire(listEl, 'keydown', ev);
            expect(ev.defaultPrevented).toBe(false); // native caret movement
            expect(btn.focused).toBe(false); // no rung walk
            expect(a.focused).toBe(false);   // no first/last-row jump
        }
    });

    it('↑/↓ still leave the field through the rung walk', () => {
        const { ctx, listEl, input, a, rec } = setupProxyBar();
        ctx.doc.activeElement = input;
        const down = makeEvent({ key: 'ArrowDown' });
        fire(listEl, 'keydown', down);
        expect(down.defaultPrevented).toBe(true);
        expect(a.focused).toBe(true); // the single rung → crosses into the rows
        ctx.doc.activeElement = input;
        const up = makeEvent({ key: 'ArrowUp' });
        fire(listEl, 'keydown', up);
        expect(up.defaultPrevented).toBe(true);
        expect(rec.focusTopCalls).toBe(1); // the top rung → strip/box
    });

    it('← from a sibling control still walks INTO the input', () => {
        const { ctx, listEl, input, btn } = setupProxyBar();
        ctx.doc.activeElement = btn;
        const left = makeEvent({ key: 'ArrowLeft' });
        fire(listEl, 'keydown', left);
        expect(left.defaultPrevented).toBe(true);
        expect(input.focused).toBe(true);
    });
});

// --- Item 2: Esc layering — the full document chain -------------------------
// The contract order (keyboard.js document capture): dialogs → context menu
// (a row marked .active) → palette → the active view's own consumer → the
// search two-level clear → back-to-tree → window.close. The menu rung is
// exercised through its own contextKeyDown elsewhere; here the whole chain is
// peeled one Esc press at a time, plus the always-on keyup safety net.
describe('Esc layering — full document chain (item 2)', () => {
    it('the menu rung dismisses at document level before any lower rung', () => {
        const ctx = setup({ searchActive: true });
        const active = ctx.row('A', 'neat-tree-item-42');
        active.link.classList.add('active');
        ctx.bookmarkMenu.style.opacity = '1'; // the menu is actually shown
        ctx.searchInput.value = 'query';
        const ev = makeEvent({ key: 'Escape' });
        ctx.fireDoc('keydown', ev);
        // 4.0.1 P2: the document-level dismiss is the same cancel semantics
        // as the menu's own ←/Esc — routed through menus.closeMenu.
        expect(ctx.closeMenuCalls).toEqual(['close']);
        expect(ctx.clearMenuCalls).toEqual([]);
        expect(active.link.classList.contains('active')).toBe(false); // the double mirrors it
        expect(active.link.focused).toBe(true);
        expect(ctx.searchCalls).toEqual([]); // the search clear is not reached
        expect(ctx.searchInput.value).toBe('query');
        expect(ctx.windowCloseCalls).toEqual([]);
    });

    it('the document-level menu rung falls back to the inline close without closeMenu', () => {
        const ctx = setup({});
        delete ctx.menus.closeMenu; // minimal setup: the pre-4.0.1 inline path
        const active = ctx.row('A', 'neat-tree-item-42');
        active.link.classList.add('active');
        ctx.bookmarkMenu.style.opacity = '1';
        ctx.fireDoc('keydown', makeEvent({ key: 'Escape' }));
        expect(ctx.closeMenuCalls).toEqual([]);
        expect(ctx.clearMenuCalls).toEqual(['clear']);
        expect(active.link.classList.contains('active')).toBe(false);
        expect(active.link.focused).toBe(true);
    });

    it('the palette rung closes the panel before the view/search rungs', () => {
        const calls = [];
        const palette = { isOpen: () => true, close: (opts) => calls.push(['close', opts]) };
        const ctx = setup({ palette, searchActive: true });
        ctx.searchInput.value = 'query';
        const ev = makeEvent({ key: 'Escape' });
        ctx.fireDoc('keydown', ev);
        // Esc is the keyboard dismiss: the panel closes with back:true so its
        // own close() returns focus to the element that owned it before open.
        expect(calls).toEqual([['close', { back: true }]]);
        expect(ctx.searchCalls).toEqual([]);
        expect(ctx.searchInput.value).toBe('query');
        expect(ctx.windowCloseCalls).toEqual([]);
    });

    it('a stale .active marker (menu hidden) does not consume Esc (K6)', () => {
        // clearMenu() (no arg — view switch / palette open) keeps the .active
        // marker while hiding every menu; the marker alone must not count as
        // "menu open" or Esc (and the row refocus) get stolen.
        const ctx = setup({ searchActive: true });
        const active = ctx.row('A', 'neat-tree-item-42');
        active.link.classList.add('active'); // every menu double has opacity ''
        ctx.searchInput.value = 'query';
        const ev = makeEvent({ key: 'Escape' });
        ctx.fireDoc('keydown', ev);
        expect(ctx.clearMenuCalls).toEqual([]); // no visible menu to dismiss
        expect(active.link.classList.contains('active')).toBe(true); // marker untouched
        expect(active.link.focused).toBe(false); // focus not stolen
        expect(ctx.searchCalls).toEqual(['escape']); // fell through to the next rung
    });

    it('a stale .active with the palette open lets Esc close the panel (the K6 sequence)', () => {
        const calls = [];
        const palette = { isOpen: () => true, close: () => calls.push('close') };
        const ctx = setup({ palette });
        const active = ctx.row('A', 'neat-tree-item-42');
        active.link.classList.add('active'); // left over from the pre-palette menu
        ctx.fireDoc('keydown', makeEvent({ key: 'Escape' }));
        expect(calls).toEqual(['close']);
        expect(active.link.focused).toBe(false); // the palette input is not robbed
    });

    it('a menu over the palette delegates Esc to palette.refocus (K2)', () => {
        const calls = [];
        const palette = {
            isOpen: () => true,
            close: () => calls.push('close'),
            refocus: () => calls.push('refocus')
        };
        const ctx = setup({ palette });
        const active = ctx.row('A', 'results-item-42');
        active.link.classList.add('active');
        ctx.bookmarkMenu.style.opacity = '1'; // the menu really is open over the panel
        const ev = makeEvent({ key: 'Escape' });
        ctx.fireDoc('keydown', ev);
        expect(calls).toEqual(['refocus']); // one layer peeled — the panel stays
        expect(ctx.clearMenuCalls).toEqual([]); // refocus owns the menu close
        expect(active.link.classList.contains('active')).toBe(true); // and the marker
        expect(active.link.focused).toBe(false); // focus never lands on the row
    });

    // keyboard-model §4 layer 3: a visible donation/what's-new banner is
    // dismissed through its own Later button (snoozed, never unsubscribed);
    // a hidden banner is skipped and the chain falls through.
    it('the banner rung dismisses the card via its Later button', () => {
        const ctx = setup({ searchActive: true });
        const banner = ctx.el('DIV', 'donation');
        banner.style.display = 'block';
        const later = ctx.el('BUTTON', 'donation-later');
        const clicks = [];
        later.click = () => clicks.push('later');
        ctx.searchInput.value = 'query';
        const ev = makeEvent({ key: 'Escape' });
        ctx.fireDoc('keydown', ev);
        expect(clicks).toEqual(['later']);
        expect(ctx.searchCalls).toEqual([]); // lower rungs untouched
        expect(ctx.searchInput.value).toBe('query');
        expect(ctx.windowCloseCalls).toEqual([]);
    });

    it('a hidden banner is skipped — Esc falls through to the search rung', () => {
        const ctx = setup({ searchActive: true });
        const banner = ctx.el('DIV', 'donation');
        banner.style.display = 'none';
        const later = ctx.el('BUTTON', 'donation-later');
        const clicks = [];
        later.click = () => clicks.push('later');
        ctx.searchInput.value = 'query'; // arm the search rung below
        const ev = makeEvent({ key: 'Escape' });
        ctx.fireDoc('keydown', ev);
        expect(clicks).toEqual([]);
        expect(ctx.searchCalls).toEqual(['escape']);
    });

    // keyboard-model §4 layer 3 (4.0.8): the remote announce banner shares the
    // rung — Esc dispatches its own × so the mark-seen once-semantics stay in
    // announce.js. Its visibility signal is the `hidden` attribute.
    it('a visible announce banner dismisses via its × at the banner rung', () => {
        const ctx = setup({ searchActive: true });
        const ann = ctx.el('DIV', 'announce');
        ann.hidden = false;
        const dismiss = ctx.el('BUTTON', 'announce-dismiss-x');
        const clicks = [];
        dismiss.click = () => clicks.push('dismiss');
        ann._qs['.announce-dismiss'] = dismiss;
        ctx.searchInput.value = 'query';
        const ev = makeEvent({ key: 'Escape' });
        ctx.fireDoc('keydown', ev);
        expect(clicks).toEqual(['dismiss']);
        expect(ctx.searchCalls).toEqual([]); // lower rungs untouched
        expect(ctx.windowCloseCalls).toEqual([]);
    });

    it('a hidden announce banner is skipped — Esc falls through', () => {
        const ctx = setup({ searchActive: true });
        const ann = ctx.el('DIV', 'announce');
        ann.hidden = true;
        const dismiss = ctx.el('BUTTON', 'announce-dismiss-x');
        const clicks = [];
        dismiss.click = () => clicks.push('dismiss');
        ann._qs['.announce-dismiss'] = dismiss;
        ctx.searchInput.value = 'query';
        const ev = makeEvent({ key: 'Escape' });
        ctx.fireDoc('keydown', ev);
        expect(clicks).toEqual([]);
        expect(ctx.searchCalls).toEqual(['escape']);
    });

    it('a visible risk banner dismisses via its × at the same layer (v4 task-4 #14)', () => {
        const clicks = [];
        const ctx = setup({
            searchActive: true,
            views: ({ tree, el }) => {
                const container = el('DIV', 'view-dead');
                const banner = el('DIV');
                banner.classList.add('risk-banner');
                const dismiss = el('BUTTON');
                dismiss.classList.add('risk-banner-dismiss');
                dismiss.click = () => clicks.push('dismiss');
                banner._qs['.risk-banner-dismiss'] = dismiss;
                container._qs['.risk-banner'] = banner;
                return {
                    lists: () => [{ id: 'tree', el: tree, typeAhead: true }],
                    listOf: () => null,
                    activeDef: () => ({ listEl: tree, container }),
                    onEscapeActive: () => false,
                    escapeToTree: () => false,
                    focusTop: () => {},
                    activate: () => {}
                };
            }
        });
        ctx.searchInput.value = 'query';
        const ev = makeEvent({ key: 'Escape' });
        ctx.fireDoc('keydown', ev);
        expect(clicks).toEqual(['dismiss']);
        expect(ctx.searchCalls).toEqual([]); // lower rungs untouched
        expect(ctx.searchInput.value).toBe('query');
        expect(ctx.windowCloseCalls).toEqual([]);
    });

    it('a fully-armed popup peels one layer per press in the contract order', () => {
        const order = [];
        let paletteOpen = true;
        let viewConsumes = true;
        let toTreeConsumes = true;
        let viewRuns = 0;
        const palette = {
            isOpen: () => paletteOpen,
            close: () => { paletteOpen = false; order.push('palette'); }
        };
        const views = {
            lists: () => [],
            listOf: () => null,
            onEscapeActive: () => {
                viewRuns++;
                if (viewConsumes) {
                    order.push('view');
                    return true;
                }
                return false;
            },
            escapeToTree: () => {
                if (toTreeConsumes) {
                    order.push('toTree');
                    return true;
                }
                return false;
            },
            focusTop: () => {},
            activate: () => {}
        };
        const ctx = setup({ dialogOpen: true, palette, views, searchActive: true });
        const active = ctx.row('A', 'neat-tree-item-42');
        active.link.classList.add('active');
        ctx.bookmarkMenu.style.opacity = '1'; // the menu is actually shown
        ctx.searchInput.value = 'query';
        const esc = () => {
            const ev = makeEvent({ key: 'Escape' });
            ctx.fireDoc('keydown', ev);
            expect(ev.defaultPrevented).toBe(true); // Chrome never sees a raw Esc
            expect(ev.immediatePropagationStopped).toBe(true);
        };

        esc(); // 1 — the dialog layer
        expect(ctx.closeDialogsCalls).toEqual(['close']);
        expect(order).toEqual([]);
        ctx.flags.dialogOpen = false;

        esc(); // 2 — the context-menu layer
        expect(ctx.closeMenuCalls).toEqual(['close']);
        expect(order).toEqual([]);

        esc(); // 3 — the palette layer
        expect(order).toEqual(['palette']);

        esc(); // 4 — the active view's own consumer (e.g. aborting a scan)
        expect(order).toEqual(['palette', 'view']);
        expect(ctx.searchCalls).toEqual([]);
        viewConsumes = false;

        esc(); // 5 — the search two-level clear (records + empties the box)
        expect(ctx.searchCalls).toEqual(['escape']);
        expect(ctx.searchInput.value).toBe('');
        expect(order).toEqual(['palette', 'view']);
        expect(viewRuns).toBe(2); // the view is consulted on every press

        esc(); // 6 — back to the tree
        expect(order).toEqual(['palette', 'view', 'toTree']);
        expect(ctx.windowCloseCalls).toEqual([]);
        toTreeConsumes = false;

        esc(); // 7 — nothing left: the popup closes
        expect(ctx.windowCloseCalls).toEqual(['close']);
    });

    it('the keyup safety net always swallows Escape without running the chain', () => {
        const ctx = setup({ searchActive: true });
        ctx.searchInput.value = 'query';
        const ev = makeEvent({ key: 'Escape' });
        ctx.fireDoc('keyup', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(ev.immediatePropagationStopped).toBe(true);
        expect(ctx.searchCalls).toEqual([]); // the chain is keydown-only
        expect(ctx.windowCloseCalls).toEqual([]);
    });

    it('non-Escape keys pass through both capture handlers untouched', () => {
        const ctx = setup({});
        const kd = makeEvent({ key: 'a' });
        ctx.fireDoc('keydown', kd);
        expect(kd.defaultPrevented).toBe(false);
        expect(kd.propagationStopped).toBe(false);
        const ku = makeEvent({ key: 'a' });
        ctx.fireDoc('keyup', ku);
        expect(ku.defaultPrevented).toBe(false);
        expect(ku.propagationStopped).toBe(false);
    });
});

describe('header-row arrows (final polish)', () => {
    const fireKey = (btn, key, ev = {}) =>
        btn._listeners.keydown[0]({
            key,
            currentTarget: btn,
            preventDefault: () => { ev.defaultPrevented = true; },
            ...ev
        });

    it('binds keydown on the quick-add and tool buttons when present', () => {
        const { quickAddBtn, toolBtn } = setup({ headerEls: true });
        expect(quickAddBtn._listeners.keydown).toHaveLength(1);
        expect(toolBtn._listeners.keydown).toHaveLength(1);
    });

    it('quick-add ← returns to the search box with the caret parked at the end', () => {
        const { quickAddBtn, searchInput } = setup({ headerEls: true });
        searchInput.value = 'abc';
        searchInput.setSelectionRange = (a, b) => { searchInput._sel = [a, b]; };
        const ev = {};
        fireKey(quickAddBtn, 'ArrowLeft', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(searchInput.focused).toBe(true);
        expect(searchInput._sel).toEqual([3, 3]);
    });

    it('quick-add → moves to the tool button; tool → stays put', () => {
        const { quickAddBtn, toolBtn } = setup({ headerEls: true });
        fireKey(quickAddBtn, 'ArrowRight');
        expect(toolBtn.focused).toBe(true);
        const ev = {};
        fireKey(toolBtn, 'ArrowRight', ev);
        expect(ev.defaultPrevented).toBeUndefined();
    });

    it('tool ← moves back to quick-add; a hidden quick-add is skipped to the box', () => {
        const { quickAddBtn, toolBtn, searchInput } = setup({ headerEls: true });
        fireKey(toolBtn, 'ArrowLeft');
        expect(quickAddBtn.focused).toBe(true);
        const s2 = setup({ headerEls: true });
        s2.quickAddBtn.getClientRects = () => [];
        fireKey(s2.toolBtn, 'ArrowLeft');
        expect(s2.searchInput.focused).toBe(true);
    });

    it('↓ from a header button walks the zone chain via views.focusDown', () => {
        const calls = [];
        const views = {
            lists: () => [],
            listOf: () => null,
            activeDef: () => ({}),
            onEscapeActive: () => false,
            escapeToTree: () => false,
            focusTop: () => {},
            focusDown: () => calls.push('down'),
            activate: () => {}
        };
        const { quickAddBtn, toolBtn } = setup({ headerEls: true, views });
        const ev = {};
        fireKey(quickAddBtn, 'ArrowDown', ev);
        expect(ev.defaultPrevented).toBe(true);
        fireKey(toolBtn, 'ArrowDown');
        expect(calls).toEqual(['down', 'down']);
    });

    it('rtl mirrors the walk (← is the forward direction)', () => {
        const { quickAddBtn, toolBtn, searchInput } = setup({ headerEls: true, rtl: true });
        fireKey(quickAddBtn, 'ArrowLeft');
        expect(toolBtn.focused).toBe(true);
        // the physical chain in rtl: tool → quick-add → search box
        fireKey(toolBtn, 'ArrowRight');
        expect(quickAddBtn.focused).toBe(true);
        fireKey(quickAddBtn, 'ArrowRight');
        expect(searchInput.focused).toBe(true);
    });
});

// 死链视图堆叠两个兄弟 <ul>（结果列表 + 残留标注，中间夹 .dead-marked-head
// 分隔 div）：同 <ul> 的 sibling walk 与 tree up-walk 都跨不过兄弟 <ul>，所以
// crossRowUl 沿当前行所在 <ul> 的 element sibling 走（跳过非 <ul> 分隔与下拉
// listbox），落在相邻列表首/末行（view-dead 导入历史 + 已标注后 ↑/↓ 无法跨区
// 的修复）。单一顶层 <ul> 的视图（树/搜索/最近/统计/去重）不受影响。
describe('dead view cross-<ul> navigation (跨区修复)', () => {
    // #dead-list: 一个 .vbm-toolbar rung + 结果列表 <ul>（两行 r1,r2）→
    // .dead-marked-head div → <ul class="dead-marked-list">（残留一行 m1）。
    // opts.noMarks 不建残留 <ul>/分隔 div；opts.dropdown 在分隔与残留之间插一个
    // .vbm-dropdown-list（跨区必须跳过它）。
    const setupDeadCross = (opts = {}) => {
        const bag = { rec: { focusTopCalls: 0 } };
        const ctx = setup({
            views: ({ tree, el }) => {
                const listEl = el('DIV', 'dead-list');
                const toolbar = el('DIV');
                toolbar.classList.add('vbm-toolbar');
                const btn = el('BUTTON', 'dead-rescan');
                toolbar._qsa['button, select, input'] = [btn];
                btn.closest = sel => (sel === '.vbm-toolbar' ? toolbar : null);
                listEl._qsa['.vbm-toolbar'] = [toolbar];
                const resultUl = el('UL');
                const mkRow = (id, ul, withBtn) => {
                    const li = el('LI', `dead-item-${id}`);
                    li.dataset.nodeId = id;
                    const a = el('A');
                    a.parentNode = li;
                    a.parentElement = li;
                    li.firstElementChild = a;
                    li._qs['a, span'] = a;
                    li._qs['span, a'] = a;
                    li.parentNode = ul;
                    li.parentElement = ul;
                    let inner = { li, a };
                    if (withBtn) {
                        const rowBtn = el('BUTTON');
                        rowBtn.parentNode = li;
                        rowBtn.closest = sel => (sel === 'li' ? li : null);
                        inner = { li, a, btn: rowBtn };
                    }
                    return inner;
                };
                const r1 = mkRow('r1', resultUl);
                const r2 = mkRow('r2', resultUl, true);
                r1.li.nextElementSibling = r2.li;
                r2.li.previousElementSibling = r1.li;
                resultUl.firstElementChild = r1.li;
                resultUl.lastElementChild = r2.li;
                resultUl._qs['li:first-child'] = r1.li;
                resultUl._qs['li:last-child'] = r2.li;
                toolbar.parentNode = listEl;
                resultUl.parentNode = listEl;
                toolbar.nextElementSibling = resultUl;
                resultUl.previousElementSibling = toolbar;
                const pieces = [toolbar, resultUl];
                if (!opts.noMarks) {
                    const head = el('DIV');
                    head.classList.add('dead-marked-head');
                    head.parentNode = listEl;
                    resultUl.nextElementSibling = head;
                    head.previousElementSibling = resultUl;
                    pieces.push(head);
                    let nextUl = head;
                    if (opts.dropdown) {
                        const ddUl = el('UL');
                        ddUl.classList.add('vbm-dropdown-list');
                        ddUl.parentNode = listEl;
                        nextUl.nextElementSibling = ddUl;
                        ddUl.previousElementSibling = nextUl;
                        nextUl = ddUl;
                    }
                    const markUl = el('UL');
                    markUl.classList.add('dead-marked-list');
                    const m1 = mkRow('m1', markUl, true);
                    markUl._qs['li:first-child'] = m1.li;
                    markUl._qs['li:last-child'] = m1.li;
                    markUl.parentNode = listEl;
                    nextUl.nextElementSibling = markUl;
                    markUl.previousElementSibling = nextUl;
                    pieces.push(markUl);
                    Object.assign(bag, { head, markUl, m1 });
                }
                // parent 链在 listEl 处终止（listEl.parentNode 恒 null，与 tree/stats
                // 夹具一致）：up-walk 双跳在顶层判空归 null，安全结束，不踩 null。
                Object.assign(bag, { listEl, toolbar, resultUl, r1, r2 });
                const deadEntry = { id: 'dead', el: listEl, typeAhead: false };
                return {
                    lists: () => [{ id: 'tree', el: tree, typeAhead: true }, deadEntry],
                    listOf: el2 => (el2 === listEl ? deadEntry : null),
                    onEscapeActive: () => false,
                    escapeToTree: () => false,
                    focusTop: () => { bag.rec.focusTopCalls++; },
                    activate: () => {}
                };
            }
        });
        return { ctx, ...bag };
    };

    it('↓ 结果末行跨过 .dead-marked-head → 残留首行', () => {
        const { ctx, listEl, r2, m1 } = setupDeadCross();
        ctx.doc.activeElement = r2.a;
        const ev = makeEvent({ key: 'ArrowDown' });
        fire(listEl, 'keydown', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(m1.a.focused).toBe(true);
        expect(r2.a.focused).toBe(false);
    });

    it('↑ 残留首行 → 结果末行', () => {
        const { ctx, listEl, r2, m1 } = setupDeadCross();
        ctx.doc.activeElement = m1.a;
        const ev = makeEvent({ key: 'ArrowUp' });
        fire(listEl, 'keydown', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(r2.a.focused).toBe(true);
        expect(m1.a.focused).toBe(false);
    });

    it('结果末行行内控件 ↓ → 残留首行；残留首行行内控件 ↑ → 结果末行', () => {
        const { ctx, listEl, r2, m1 } = setupDeadCross();
        ctx.doc.activeElement = r2.btn;
        fire(listEl, 'keydown', makeEvent({ key: 'ArrowDown' }));
        expect(m1.a.focused).toBe(true);
        ctx.doc.activeElement = m1.btn;
        fire(listEl, 'keydown', makeEvent({ key: 'ArrowUp' }));
        expect(r2.a.focused).toBe(true);
    });

    it('跨区跳过 .vbm-dropdown-list（排序下拉的隐藏 listbox 不是行）', () => {
        const { ctx, listEl, r2, m1 } = setupDeadCross({ dropdown: true });
        ctx.doc.activeElement = r2.a;
        fire(listEl, 'keydown', makeEvent({ key: 'ArrowDown' }));
        expect(m1.a.focused).toBe(true);
    });

    it('无残留 <ul> 时末行 ↓ 不抛错（crossRowUl null → up-walk no-op）', () => {
        const { ctx, listEl, r2 } = setupDeadCross({ noMarks: true });
        ctx.doc.activeElement = r2.a;
        const ev = makeEvent({ key: 'ArrowDown' });
        expect(() => fire(listEl, 'keydown', ev)).not.toThrow();
        expect(ev.defaultPrevented).toBe(true);
        // 无相邻列表可跨：焦点留在原行，不进树、不越出
        expect(ctx.doc.activeElement).toBe(r2.a);
        expect(ctx.f1.link.focused).toBe(false);
    });
});
