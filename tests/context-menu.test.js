import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';

// context-menu.js touches page globals (document/window/chrome/setTimeout)
// only inside initContextMenu, so the real module imports cleanly in node
// once the globals are stubbed. ctx.tree is an element stub; ctx.actions and
// ctx.dialogs are injected recording doubles reached through the same getter
// wiring neat.js uses; chrome.bookmarks/tabs are test doubles. Assertions
// target the DOM-event contract (which menu opens, which classes/styles get
// written, which action runs) — nothing is copied from the module body.

const makeEvent = (props = {}) => {
    const ev = {
        defaultPrevented: false,
        propagationStopped: false,
        preventDefault() {
            ev.defaultPrevented = true;
        },
        stopPropagation() {
            ev.propagationStopped = true;
        },
        ...props
    };
    return ev;
};

const fire = (el, type, ev) => {
    for (const fn of (el._listeners[type] || []))
        fn(ev);
};

let initContextMenu;
let timeouts;
const realSetTimeout = globalThis.setTimeout;

beforeAll(async () => {
    globalThis.setTimeout = (fn, ms) => {
        timeouts.push([fn, ms]);
        return 0;
    };
    ({ initContextMenu } = await import('../src/context-menu.js'));
});

beforeEach(() => {
    timeouts = [];
});

afterAll(() => {
    globalThis.setTimeout = realSetTimeout;
});

const setup = (opts = {}) => {
    const allEls = [];
    const byId = {};
    const el = (tagName = 'DIV', id = '') => {
        const classes = new Set();
        const node = {
            tagName,
            id,
            href: '',
            style: {},
            dataset: {},
            parentNode: null,
            focused: false,
            offsetWidth: 0,
            offsetHeight: 0,
            scrollTop: 0,
            _qs: {},
            _listeners: {},
            classList: {
                add: (...cs) => cs.forEach(c => classes.add(c)),
                remove: (...cs) => cs.forEach(c => classes.delete(c)),
                contains: c => classes.has(c),
                toggle: (c, force) => {
                    const on = force === undefined ? !classes.has(c) : !!force;
                    if (on) classes.add(c);
                    else classes.delete(c);
                    return on;
                }
            },
            addEventListener(type, fn) {
                (this._listeners[type] = this._listeners[type] || []).push(fn);
            },
            querySelector(sel) {
                return sel in this._qs ? this._qs[sel] : null;
            },
            // issue #48 follow-up: the collapsed submenus filter their items
            // with querySelectorAll('.menu-item') (applyCollapseState targets).
            querySelectorAll(sel) {
                if (sel === '.menu-item')
                    return (this._children || []).filter(c => c.classList.contains('menu-item'));
                return [];
            },
            getBoundingClientRect() {
                // Tests configure the flyout-entry geometry via `rect`.
                return this.rect || { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
            },
            // Minimal Element.closest: walks parentNode, matches tag names,
            // .classes and comma lists thereof ('li', 'a, span', '.active').
            closest(sel) {
                const sels = sel.split(',').map(s => s.trim());
                let n = this;
                while (n) {
                    for (const s of sels) {
                        if (s.startsWith('.')) {
                            if (n.classList && n.classList.contains(s.slice(1)))
                                return n;
                        } else if (n.tagName && n.tagName.toLowerCase() === s) {
                            return n;
                        }
                    }
                    n = n.parentNode;
                }
                return null;
            },
            focus() {
                this.focused = true;
            }
        };
        allEls.push(node);
        if (id)
            byId[id] = node;
        return node;
    };

    const bookmarkMenu = el('MENU', 'bookmark-context-menu');
    const folderMenu = el('MENU', 'folder-context-menu');
    const separatorMenu = el('MENU', 'separator-context-menu');
    const searchHistoryMenu = el('MENU', 'search-history-context-menu');
    // v4 task-3 #10/#16: the two new dedicated menus
    const histRowMenu = el('MENU', 'hist-row-context-menu');
    const dupesGroupMenu = el('MENU', 'dupes-group-context-menu');
    // v4 task-4 #6: the palette custom-command row menu + its items (init labels)
    const paletteCmdMenu = el('MENU', 'palette-cmd-context-menu');
    el('DIV', 'palette-cmd-edit');
    el('DIV', 'palette-cmd-delete');
    // issue #48 follow-up: the collapsed tab-group / sort submenus + entries.
    // Mirror the pages' markup: entries are .menu-item.has-submenu carrying a
    // data-submenu id; the flyouts are sibling <menu class="submenu"> whose
    // items use `sub-` prefixed ids (normalized at dispatch time).
    const submenu = id => {
        const m = el('MENU', id);
        m.classList.add('submenu');
        m.dataset.parentEntry = id === 'folder-tab-group-submenu' ? 'folder-tab-group-collapse'
            : id === 'folder-sort-submenu' ? 'folder-sort-collapse'
            : 'bookmark-tab-group-collapse';
        return m;
    };
    const subEntry = (id, subId) => {
        const e = el('DIV', id);
        e.classList.add('menu-item', 'has-submenu');
        e.dataset.submenu = subId;
        return e;
    };
    const folderTabGroupSubmenu = submenu('folder-tab-group-submenu');
    const folderSortSubmenu = submenu('folder-sort-submenu');
    const bookmarkTabGroupSubmenu = submenu('bookmark-tab-group-submenu');
    const folderTabGroupEntry = subEntry('folder-tab-group-collapse', 'folder-tab-group-submenu');
    const folderSortEntry = subEntry('folder-sort-collapse', 'folder-sort-submenu');
    const bookmarkTabGroupEntry = subEntry('bookmark-tab-group-collapse', 'bookmark-tab-group-submenu');
    const subItems = {
        'folder-tab-group-submenu': ['sub-open-bookmarks-in-group', 'sub-open-bookmarks-in-group-setup', 'sub-folder-open-in-existing-group'],
        'folder-sort-submenu': ['sub-sort-folder-by-name', 'sub-sort-folder-by-date', 'sub-sort-folder-contents'],
        'bookmark-tab-group-submenu': ['sub-bookmark-open-in-new-group', 'sub-bookmark-open-in-new-group-setup', 'sub-bookmark-open-in-existing-group']
    };
    for (const [menuId, ids] of Object.entries(subItems)) {
        const m = byId[menuId];
        m._children = ids.map(id => {
            const it = el('DIV', id);
            it.classList.add('menu-item');
            it.parentNode = m;
            return it;
        });
    }
    const results = el('DIV', 'results');
    for (const id of ['add-bookmark-before-bookmark', 'add-bookmark-after-bookmark',
        'bookmark-context-menu-sep1', 'add-folder-before-bookmark',
        'add-folder-after-bookmark', 'bookmark-context-menu-sep2',
        'add-separator', 'bookmark-context-menu-sep3'])
        el('DIV', id);
    // v4 task-2: the "Reveal in tree" entry + its separator (hidden on tree
    // rows, shown on recent/results rows)
    el('DIV', 'reveal-in-tree');
    el('HR', 'reveal-in-tree-sep');
    // Root-folder delete disabling: context-menu.js toggles a .disabled class
    // on #folder-delete (present in the pages' markup, absent in the old stub).
    // It is a menu-item like the real page HTML, so dispatch rules apply.
    const folderDelete = el('DIV', 'folder-delete');
    folderDelete.classList.add('menu-item');
    // The other root-disabled folder entries (edit + before/after adds + the
    // separator insert) get the same treatment — the full ROOT_DISABLED_IDS set.
    for (const id of ['folder-edit', 'add-bookmark-before-folder',
        'add-bookmark-after-folder', 'add-folder-before-folder',
        'add-folder-after-folder', 'add-folder-separator']) {
        const item = el('DIV', id);
        item.classList.add('menu-item');
    }
    // v4 task-2 slice C: dead-view mark toggle + dupes-view keeper pin
    el('DIV', 'dead-mark-toggle');
    el('DIV', 'dupes-set-keeper');
    // round-4 item 7: the search-history menu items (labels assigned at init)
    el('DIV', 'search-history-menu-rerun');
    el('DIV', 'search-history-menu-remove');
    el('DIV', 'search-history-menu-clear');
    // v4 task-3 #10: the unbookmarked stats-history menu items (init labels)
    el('DIV', 'hist-open-new-tab');
    el('DIV', 'hist-open-new-window');
    el('DIV', 'hist-open-incognito');
    el('DIV', 'hist-add-bookmark');
    // v4 task-3 #16: the dupes group-head menu items (open-time labels)
    el('DIV', 'dupes-group-clean');
    el('HR', 'dupes-group-menu-sep1');
    el('DIV', 'dupes-group-toggle');
    const tree = el('DIV', 'tree');
    // round-3 item 3: the feature-view lists get the same scroll/focus
    // menu-dismissal wiring as the tree/results panes
    const viewLists = {};
    for (const id of ['recent-list', 'stats-list', 'dead-list', 'dupes-list', 'search-history-area'])
        viewLists[id] = el('DIV', id);
    const body = el('BODY', 'body');
    body.offsetWidth = opts.bodyWidth === undefined ? 500 : opts.bodyWidth;
    body.querySelector = sel =>
        sel === '.active' ? (allEls.find(n => n.classList.contains('active')) || null) : null;

    globalThis.document = {
        getElementById: id => byId[id] || null,
        body
    };
    const windowListeners = {};
    globalThis.window = {
        innerHeight: opts.innerHeight === undefined ? 600 : opts.innerHeight,
        // issue #48 follow-up: the flyout's horizontal flip/clamp uses the
        // VIEWPORT width (window.innerWidth), not body.offsetWidth.
        innerWidth: opts.innerWidth === undefined ? 500 : opts.innerWidth,
        scrollX: 0,
        scrollY: 0,
        addEventListener(type, fn) {
            (windowListeners[type] = windowListeners[type] || []).push(fn);
        }
    };
    const chromeStub = {
        i18n: { getMessage: opts.i18n || (key => key) },
        runtime: { lastError: undefined },
        windows: { WINDOW_ID_CURRENT: -1 },
        tabs: {
            current: { id: 7, url: 'https://current.example/page', title: 'Current Tab' },
            queried: [],
            query(q, cb) {
                this.queried.push(q);
                cb([this.current]);
            }
        },
        bookmarks: {
            childNodes: {},
            getChildren(id, cb) {
                cb(this.childNodes[id] || []);
            }
        },
        // P3.4: the existing-group pickers query the browser's tab groups
        tabGroups: {
            queried: [],
            _groups: [],
            query(q, cb) {
                this.queried.push(q);
                cb(this._groups);
            }
        }
    };
    Object.assign(chromeStub.bookmarks.childNodes, opts.children || {});
    Object.assign(chromeStub.tabGroups._groups, opts.tabGroups || []);
    globalThis.chrome = chromeStub;

    const actionCalls = [];
    const actions = {};
    for (const name of ['openBookmark', 'openBookmarkNewTab', 'openBookmarkNewWindow',
        'addNewBookmarkNode', 'copyAllTitlesAndUrls', 'replaceUrl', 'openBookmarks',
        'openBookmarksInGroup', 'openInExistingTabGroup', 'openBookmarksNewWindow',
        'editBookmarkFolder', 'deleteBookmark',
        'deleteBookmarks', 'addSeparator', 'deleteSeparator'])
        actions[name] = (...args) => {
            actionCalls.push([name, ...args]);
            // 4.0.1: lets a test observe the menu/focus state DURING the action
            if (opts.onAction)
                opts.onAction(name, args);
        };
    const sortCalls = [];
    // P3.4: GroupDialog (title+color before opening a new group) and
    // GroupPickDialog (existing-group picker) are recorded doubles.
    const groupDialogCalls = [];
    const groupPickCalls = [];
    const dialogs = {
        SortDialog: { open: id => sortCalls.push(id) },
        GroupDialog: { open: o => groupDialogCalls.push(o) },
        GroupPickDialog: { open: o => groupPickCalls.push(o) }
    };
    // issue #33: direct sort dispatch + the persisted sort options (recursive
    // suffix on the labels), injected lazily exactly like the views above.
    const sortFolderCalls = [];
    const revealCalls = [];

    const menus = initContextMenu({
        tree,
        os: opts.os || 'linux',
        rtl: !!opts.rtl,
        get actions() { return actions; },
        get dialogs() { return dialogs; },
        revealInTree: id => revealCalls.push(id),
        // Slice C view menus are read lazily, exactly like in neat.js
        get deadMenu() { return opts.deadMenu; },
        get dupesMenu() { return opts.dupesMenu; },
        get sortOptions() { return opts.sortOptions; },
        get sortFolder() { return (id, o) => sortFolderCalls.push([id, o]); },
        // issue #48 follow-up: collapse settings (defaults match production —
        // tab-group off, sort on).
        get collapseTabGroupMenu() { return !!opts.collapseTabGroupMenu; },
        get collapseSortMenu() { return opts.collapseSortMenu === undefined ? true : !!opts.collapseSortMenu; },
        get zoomLevel() { return opts.zoomLevel || 1; }
    });

    // A bookmark row: <li id="neat-tree-item-42" data-parentid="1"><a href><i>title</i></a></li>
    // (the <i> carries the displayed title, so the P3.4 group-title probe
    // has a node to read)
    const makeBookmarkRow = (id = '42', parentid = '1', title = '') => {
        const li = el('LI', `neat-tree-item-${id}`);
        li.dataset.parentid = parentid;
        const a = el('A');
        a.href = `https://bm-${id}.example/`;
        a.parentNode = li;
        const i = el('I');
        i.textContent = title;
        a._qs.i = i;
        return { li, a, i };
    };
    // A folder row: <li id="neat-tree-item-7" data-parentid="1"><span><i>title</i></span></li>
    // (the <i> carries the displayed folder title, mirrored from generateFolderHTML)
    const makeFolderRow = (id = '7', parentid = '1', title = '') => {
        const li = el('LI', `neat-tree-item-${id}`);
        li.dataset.parentid = parentid;
        const span = el('SPAN');
        span.parentNode = li;
        const i = el('I');
        i.textContent = title;
        span._qs.i = i;
        return { li, span };
    };
    // A separator row: a bookmark <a> that contains an <hr>
    const makeSeparatorRow = (id = '30', parentid = '1') => {
        const row = makeBookmarkRow(id, parentid);
        row.a._qs.hr = el('HR');
        return row;
    };
    // A search/palette folder-result row:
    // <li id="results-item-7" data-node-id="7"><a class="link-folder"><i>title</i></a></li>
    const makeLinkFolderRow = (id = '7', title = '') => {
        const li = el('LI', `results-item-${id}`);
        li.dataset.nodeId = id;
        const a = el('A');
        a.classList.add('link-folder');
        a.parentNode = li;
        const i = el('I');
        i.textContent = title;
        a._qs.i = i;
        return { li, a, i };
    };
    // A search-history row: <li class="search-history-row"><a href data-q="q">…</a></li>
    const makeHistoryRow = (q = 'git') => {
        const li = el('LI');
        li.classList.add('search-history-row');
        const a = el('A');
        a.dataset.q = q;
        a.parentNode = li;
        return { li, a };
    };
    // An unbookmarked stats-history row (v4 task-3 #10):
    // <li class="stats-hist-row"><a href></a><button class="stats-add-btn">☆</button></li>
    const makeStatsHistRow = (url = 'https://elsewhere.example/') => {
        const li = el('LI');
        li.classList.add('stats-hist-row');
        const a = el('A');
        a.href = url;
        a.parentNode = li;
        li._qs.a = a;
        const addBtn = el('BUTTON');
        addBtn.classList.add('stats-add-btn');
        addBtn.parentNode = li;
        li._qs['.stats-add-btn'] = addBtn;
        return { li, a, addBtn };
    };
    // A dupes group head (v4 task-3 #16):
    // <li class="dupes-group" data-key="k"><span class="group-head"><span class="dupes-key"></span></span></li>
    const makeDupesGroupHead = (key = 'https://x.example/') => {
        const li = el('LI');
        li.classList.add('dupes-group');
        li.dataset.key = key;
        const head = el('SPAN');
        head.classList.add('group-head');
        head.parentNode = li;
        const keySpan = el('SPAN');
        keySpan.classList.add('dupes-key');
        keySpan.parentNode = head;
        return { li, head, keySpan };
    };
    const menuItem = id => {
        const item = el('DIV', id);
        item.classList.add('menu-item');
        return item;
    };
    const openOn = (target, evProps = {}) =>
        fire(body, 'contextmenu', makeEvent({ target, pageX: 50, pageY: 60, clientY: 60, ...evProps }));

    return {
        menus, byId, el, body, tree, results, viewLists,
        bookmarkMenu, folderMenu, separatorMenu, searchHistoryMenu, histRowMenu, dupesGroupMenu,
        paletteCmdMenu,
        folderTabGroupSubmenu, folderSortSubmenu, bookmarkTabGroupSubmenu,
        folderTabGroupEntry, folderSortEntry, bookmarkTabGroupEntry,
        chrome: chromeStub, actionCalls, sortCalls, sortFolderCalls, revealCalls,
        groupDialogCalls, groupPickCalls,
        makeBookmarkRow, makeFolderRow, makeSeparatorRow, makeHistoryRow,
        makeStatsHistRow, makeDupesGroupHead, makeLinkFolderRow, menuItem, openOn,
        fireWindow: (type, ev) => {
            for (const fn of (windowListeners[type] || []))
                fn(ev);
        }
    };
};

describe('module API', () => {
    it('returns clearMenu/switchBookmarkMenu plus the seven menu elements', () => {
        const { menus, bookmarkMenu, folderMenu, separatorMenu, searchHistoryMenu,
            histRowMenu, dupesGroupMenu, paletteCmdMenu } = setup({});
        expect(typeof menus.clearMenu).toBe('function');
        // 4.0.1 menu focus law: cancel-semantics close for the keyboard layer
        expect(typeof menus.closeMenu).toBe('function');
        expect(typeof menus.switchBookmarkMenu).toBe('function');
        expect(menus.bookmarkMenu).toBe(bookmarkMenu);
        expect(menus.folderMenu).toBe(folderMenu);
        expect(menus.separatorMenu).toBe(separatorMenu);
        expect(menus.searchHistoryMenu).toBe(searchHistoryMenu);
        expect(menus.histRowMenu).toBe(histRowMenu);
        expect(menus.dupesGroupMenu).toBe(dupesGroupMenu);
        // v4 task-4 #6: the palette custom-command row menu (edit/delete)
        expect(menus.paletteCmdMenu).toBe(paletteCmdMenu);
        expect(Object.keys(menus).sort()).toEqual(
            ['bookmarkMenu', 'bookmarkTabGroupSubmenu', 'clearMenu', 'closeMenu', 'closeSubmenu',
                'dupesGroupMenu', 'folderMenu', 'folderSortSubmenu', 'folderTabGroupSubmenu',
                'histRowMenu', 'openSubmenuFor', 'paletteCmdMenu', 'searchHistoryMenu',
                'separatorMenu', 'submenuOpen', 'submenuParentEntry', 'switchBookmarkMenu',
                'toggleSubmenuFor']);
        // issue #48 follow-up: the flyout API is callable
        expect(typeof menus.openSubmenuFor).toBe('function');
        expect(typeof menus.closeSubmenu).toBe('function');
        expect(typeof menus.toggleSubmenuFor).toBe('function');
        expect(typeof menus.submenuOpen).toBe('function');
        expect(menus.submenuOpen()).toBe(false);
    });
});

describe('clearMenu', () => {
    it('hides all three menus and drops the menu context', () => {
        const { menus, bookmarkMenu, folderMenu, separatorMenu, actionCalls,
            makeBookmarkRow, menuItem, openOn } = setup({});
        const { a } = makeBookmarkRow();
        openOn(a);
        expect(bookmarkMenu.style.opacity).toBe('1');
        menus.clearMenu();
        for (const menu of [bookmarkMenu, folderMenu, separatorMenu]) {
            expect(menu.style.left).toBe('-999px');
            expect(menu.style.opacity).toBe('0');
        }
        // the context is gone: a menu-item click now dispatches nothing
        fire(bookmarkMenu, 'mouseup', makeEvent({ button: 0, target: menuItem('bookmark-new-tab') }));
        expect(actionCalls).toEqual([]);
    });

    it('without an event keeps the row marked active and refocuses it', () => {
        const { menus, makeBookmarkRow, openOn } = setup({});
        const { a } = makeBookmarkRow();
        openOn(a);
        menus.clearMenu();
        expect(a.classList.contains('active')).toBe(true);
        expect(a.focused).toBe(true);
    });

    it('with an event on the tree, unmarks the row and returns focus to it', () => {
        const { menus, tree, makeBookmarkRow, openOn } = setup({});
        const { a } = makeBookmarkRow();
        openOn(a);
        menus.clearMenu(makeEvent({ target: tree }));
        expect(a.classList.contains('active')).toBe(false);
        expect(a.focused).toBe(true);
    });

    it('with an event on the results pane, also returns focus to the row', () => {
        const { menus, results, makeBookmarkRow, openOn } = setup({});
        const { a } = makeBookmarkRow();
        openOn(a);
        menus.clearMenu(makeEvent({ target: results }));
        expect(a.classList.contains('active')).toBe(false);
        expect(a.focused).toBe(true);
    });

    it('with an event anywhere else, unmarks the row without touching focus', () => {
        const { menus, body, makeBookmarkRow, openOn } = setup({});
        const { a } = makeBookmarkRow();
        openOn(a);
        menus.clearMenu(makeEvent({ target: body }));
        expect(a.classList.contains('active')).toBe(false);
        expect(a.focused).toBe(false);
    });

    it('only hides the menus when no row is active', () => {
        const { menus, bookmarkMenu } = setup({});
        menus.clearMenu();
        expect(bookmarkMenu.style.left).toBe('-999px');
        expect(bookmarkMenu.style.opacity).toBe('0');
    });

    it('is wired to outside clicks, scrolls and focus moves', () => {
        const { body, tree, results, bookmarkMenu, fireWindow } = setup({});
        const triggers = [
            ['body click', () => fire(body, 'click', makeEvent({ target: body }))],
            ['tree scroll', () => fire(tree, 'scroll', makeEvent({ target: tree }))],
            ['results scroll', () => fire(results, 'scroll', makeEvent({ target: results }))],
            ['window scroll', () => fireWindow('scroll', makeEvent({}))],
            ['tree focus', () => fire(tree, 'focus', makeEvent({ target: tree }))],
            ['results focus', () => fire(results, 'focus', makeEvent({ target: results }))]
        ];
        for (const [name, trigger] of triggers) {
            bookmarkMenu.style.left = '10px';
            bookmarkMenu.style.opacity = '1';
            trigger();
            expect(bookmarkMenu.style.opacity, name).toBe('0');
            expect(bookmarkMenu.style.left, name).toBe('-999px');
        }
    });

    it('every feature-view list dismisses the menu on scroll and focus (round-3 item 3)', () => {
        const { viewLists, bookmarkMenu } = setup({});
        for (const [id, listEl] of Object.entries(viewLists)) {
            for (const type of ['scroll', 'focus']) {
                bookmarkMenu.style.left = '10px';
                bookmarkMenu.style.opacity = '1';
                fire(listEl, type, makeEvent({ target: listEl }));
                expect(bookmarkMenu.style.opacity, `${id} ${type}`).toBe('0');
                expect(bookmarkMenu.style.left, `${id} ${type}`).toBe('-999px');
            }
        }
    });
});

// 4.0.1 menu focus law: a menu close must never drop focus to <body> or
// strand it on the hidden menu — closeMenu() (cancel semantics for the
// keyboard layer's ←/Esc) drops the marker AND refocuses the owner row;
// no-arg clearMenu() (programmatic close) keeps the marker but refocuses
// too; a re-rendered owner is found through its same-id replacement row.
describe('closeMenu (4.0.1 menu focus law)', () => {
    it('removes the .active marker, refocuses the owner row and hides every menu', () => {
        const { menus, bookmarkMenu, folderMenu, separatorMenu, makeBookmarkRow, openOn } = setup({});
        const { a } = makeBookmarkRow('42');
        openOn(a);
        expect(a.classList.contains('active')).toBe(true);
        expect(bookmarkMenu.style.opacity).toBe('1');
        menus.closeMenu();
        expect(a.classList.contains('active')).toBe(false); // cancel: marker OFF
        expect(a.focused).toBe(true); // focus back on the owning row
        for (const menu of [bookmarkMenu, folderMenu, separatorMenu]) {
            expect(menu.style.left).toBe('-999px');
            expect(menu.style.opacity).toBe('0');
        }
    });

    it('no-arg clearMenu refocuses the owner too (marker kept — the K6 contract)', () => {
        const { menus, makeBookmarkRow, openOn } = setup({});
        const { a } = makeBookmarkRow('42');
        openOn(a);
        menus.clearMenu();
        expect(a.classList.contains('active')).toBe(true); // marker STAYS
        expect(a.focused).toBe(true); // but the focus law holds
    });

    it('refocuses the same-id replacement row when the owner element was re-rendered away', () => {
        const ctx = setup({});
        const { a } = ctx.makeBookmarkRow('42'); // owner li id: neat-tree-item-42
        ctx.openOn(a);
        // A view re-render swaps the list's innerHTML under the open menu:
        // the owner anchor detaches, a fresh same-id li + anchor replace it.
        a.isConnected = false;
        const li = ctx.el('LI', 'neat-tree-item-42');
        const a2 = ctx.el('A');
        li._qs['a, span'] = a2;
        ctx.menus.closeMenu();
        expect(a.focused).toBe(false); // the detached owner is never focused
        expect(a2.focused).toBe(true); // its replacement's a/span child is
    });

    it('focuses the replacement li itself when it is a tabindex row container', () => {
        const ctx = setup({});
        const { a } = ctx.makeBookmarkRow('42');
        ctx.openOn(a);
        a.isConnected = false;
        // The dead view's start-row shape: a focusable li without a/span
        // (the plain doubles lack getAttribute — add it for this row only).
        const li = ctx.el('LI', 'neat-tree-item-42');
        li.getAttribute = k => (k === 'tabindex' ? '0' : null);
        ctx.menus.closeMenu();
        expect(li.focused).toBe(true);
    });

    it('a menu-item dispatch closes the menu BEFORE the action runs', () => {
        let during = null;
        let rowA = null;
        const ctx = setup({
            onAction: () => {
                during = {
                    opacity: ctx.bookmarkMenu.style.opacity,
                    rowFocused: rowA.focused
                };
            }
        });
        ({ a: rowA } = ctx.makeBookmarkRow('42'));
        ctx.openOn(rowA);
        fire(ctx.bookmarkMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('bookmark-new-tab') }));
        expect(ctx.actionCalls).toEqual([['openBookmarkNewTab', 'https://bm-42.example/']]);
        // inside the action the menu was already hidden and focus already
        // back on the owning row (close-first, not close-last)
        expect(during).toEqual({ opacity: '0', rowFocused: true });
    });
});

describe('contextmenu handler (opening a menu)', () => {
    it('opens the bookmark menu on a bookmark row, positioned at the cursor', () => {
        const { body, bookmarkMenu, folderMenu, separatorMenu, makeBookmarkRow } = setup({});
        bookmarkMenu.offsetWidth = 100;
        bookmarkMenu.offsetHeight = 200;
        const { a } = makeBookmarkRow();
        const ev = makeEvent({ target: a, pageX: 450, pageY: 60, clientY: 60 });
        fire(body, 'contextmenu', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(a.classList.contains('active')).toBe(true);
        expect(bookmarkMenu.style.opacity).toBe('1');
        // 450 would overflow (body 500 - menu 100), so it clamps to 400
        expect(bookmarkMenu.style.left).toBe('400px');
        expect(bookmarkMenu.style.top).toBe('60px');
        expect(bookmarkMenu.focused).toBe(true);
        expect(folderMenu.style.opacity).not.toBe('1');
        expect(separatorMenu.style.opacity).not.toBe('1');
    });

    it('anchors the menu to the left of the cursor in rtl', () => {
        const { bookmarkMenu, makeBookmarkRow, openOn } = setup({ rtl: true });
        bookmarkMenu.offsetWidth = 100;
        const { a } = makeBookmarkRow();
        openOn(a, { pageX: 450 });
        expect(bookmarkMenu.style.left).toBe('350px');
    });

    it('flips the menu upwards when it would overflow the bottom', () => {
        const { bookmarkMenu, makeBookmarkRow, openOn } = setup({});
        bookmarkMenu.offsetHeight = 200;
        const { a } = makeBookmarkRow();
        // 10px free below the cursor (600 - 590) < menu height 200
        openOn(a, { pageY: 590, clientY: 590 });
        expect(bookmarkMenu.style.top).toBe('390px');
        // and it never goes above the top edge
        openOn(a, { pageY: 100, clientY: 590 });
        expect(bookmarkMenu.style.top).toBe('0px');
    });

    it('clamps a menu taller than the popup viewport (issue #48: overflow → scroll-dismiss)', () => {
        const { bookmarkMenu, makeBookmarkRow, openOn } = setup({ innerHeight: 600 });
        bookmarkMenu.offsetWidth = 100;
        // The 19-entry folder menu can exceed the popup height at Windows 150%
        // scaling / page zoom ≥ ~90%. Before the clamp, menu.focus() scrolled
        // the document to reveal the overflow, that scroll fired the
        // scroll-dismiss listeners and the menu closed the instant it opened.
        bookmarkMenu.offsetHeight = 700; // > 600-8 available
        const { a } = makeBookmarkRow();
        openOn(a, { pageY: 60, clientY: 60 });
        expect(bookmarkMenu.style.maxHeight).toBe('592px'); // 600 - 8 margin
        expect(bookmarkMenu.style.overflowY).toBe('auto');
        expect(bookmarkMenu.style.opacity).toBe('1');
    });

    it('leaves a menu that fits the viewport unclamped', () => {
        const { bookmarkMenu, makeBookmarkRow, openOn } = setup({ innerHeight: 600 });
        bookmarkMenu.offsetWidth = 100;
        bookmarkMenu.offsetHeight = 200; // fits comfortably
        const { a } = makeBookmarkRow();
        openOn(a, { pageY: 60, clientY: 60 });
        expect(bookmarkMenu.style.maxHeight).toBe('');
        expect(bookmarkMenu.style.overflowY).toBe('');
    });

    it('drops a too-tall menu below the triggered row instead of covering it (zoom alternation)', () => {
        // zoom 放大时菜单项被 body[data-zoom] 缩放, 菜单整体变高 —— 这里模拟
        // 菜单 560 高, 小于视口级 clamp 上限 (600-0-8=592, 不触发开头 maxHeight,
        // 即未 scrollable), 但触发点下方空间 (600-100=500) 不够、上方空间
        // (100-0=100) 也不够 —— 翻上去会顶到 menuMinY 覆盖用户右键的那一行,
        // 后续右键落在菜单上被分发到菜单而只关闭不重开 (zoom 交替 bug)。
        // 修复: clamp 到触发点下方 (500-20-8=472) 并把顶部放到触发行下方
        // (pageY 100 + ROW_GUESS 20 = 120), 使菜单不覆盖触发行。
        const { bookmarkMenu, makeBookmarkRow, openOn } = setup({ innerHeight: 600 });
        bookmarkMenu.offsetHeight = 560; // > boundY(500), < maxMenuH(592)
        const { a } = makeBookmarkRow();
        openOn(a, { pageY: 100, clientY: 100 });
        expect(bookmarkMenu.style.maxHeight).toBe('472px'); // 500 - 20 row - 8 margin
        expect(bookmarkMenu.style.overflowY).toBe('auto');
        expect(bookmarkMenu.style.top).toBe('120px'); // pageY 100 + ROW_GUESS 20
        expect(bookmarkMenu.style.opacity).toBe('1');
    });

    it('opens the separator menu on a separator row (and never the bookmark menu)', () => {
        const { bookmarkMenu, separatorMenu, makeSeparatorRow, openOn } = setup({});
        const { a } = makeSeparatorRow('30', '0'); // root folder (parentid '0')
        openOn(a);
        expect(separatorMenu.style.opacity).toBe('1');
        expect(bookmarkMenu.style.opacity).not.toBe('1');
    });

    it('opens the folder menu on a folder row and hides sort at root only', () => {
        const { folderMenu, makeFolderRow, openOn } = setup({});
        const rootRow = makeFolderRow('7', '0');
        openOn(rootRow.span);
        expect(folderMenu.style.opacity).toBe('1');
        expect(folderMenu.classList.contains('hide-sort')).toBe(true);
        const innerRow = makeFolderRow('8', '1');
        openOn(innerRow.span);
        expect(folderMenu.classList.contains('hide-sort')).toBe(false);
    });

    it('treats a right-click on the separator <hr> as a click on its row link', () => {
        const { bookmarkMenu, makeBookmarkRow, el, openOn } = setup({});
        const { a } = makeBookmarkRow();
        const hr = el('HR');
        hr.parentNode = a;
        openOn(hr);
        expect(a.classList.contains('active')).toBe(true);
        expect(bookmarkMenu.style.opacity).toBe('1');
    });

    it('moves the active mark from the previous row to the new one', () => {
        const { makeBookmarkRow, openOn } = setup({});
        const first = makeBookmarkRow('41');
        const second = makeBookmarkRow('42');
        openOn(first.a);
        openOn(second.a);
        expect(first.a.classList.contains('active')).toBe(false);
        expect(second.a.classList.contains('active')).toBe(true);
    });

    it('right-click right after a left click still opens the menu (4.0.5 regression)', () => {
        // 4.0.5 回归: 左键点击展开一个文件夹后立即右键, 首次右键不弹菜单
        // (需再右击一次). 这里模拟「左键点击(body click → clearMenu) → 右键」,
        // 验证首次右键仍能打开菜单。
        const { body, bookmarkMenu, folderMenu, makeFolderRow } = setup({});
        const row = makeFolderRow('7', '1'); // 非 root 文件夹
        // 左键点击(冒泡到 body → clearMenu)
        fire(body, 'click', makeEvent({ target: row.span }));
        // 立即右键
        fire(body, 'contextmenu', makeEvent({ target: row.span, pageX: 50, pageY: 60, clientY: 60 }));
        expect(row.span.classList.contains('active')).toBe(true);
        expect(folderMenu.style.opacity).toBe('1');
    });

    it('opens nothing on a non-row target but still eats the event', () => {
        const { body, bookmarkMenu, folderMenu, separatorMenu, actionCalls,
            menuItem } = setup({});
        const ev = makeEvent({ target: body, pageX: 50, pageY: 60, clientY: 60 });
        fire(body, 'contextmenu', ev);
        expect(ev.defaultPrevented).toBe(true);
        for (const menu of [bookmarkMenu, folderMenu, separatorMenu])
            expect(menu.style.opacity).not.toBe('1');
        // no context was set: dispatching does nothing
        fire(bookmarkMenu, 'mouseup', makeEvent({ button: 0, target: menuItem('bookmark-new-tab') }));
        expect(actionCalls).toEqual([]);
    });

    it('opens nothing on the view-tab strip (round-6 regression: span walk-up without a row)', () => {
        const { body, bookmarkMenu, folderMenu, separatorMenu, searchHistoryMenu,
            el } = setup({});
        // <button class="view-tab"><span class="tab-icon"></span></button> — the
        // icon span matches the 'a, span' walk-up but has no <li> ancestor.
        const tab = el('BUTTON');
        tab.classList.add('view-tab');
        const icon = el('SPAN');
        icon.classList.add('tab-icon');
        icon.parentNode = tab;
        const ev = makeEvent({ target: icon, pageX: 50, pageY: 60, clientY: 60 });
        fire(body, 'contextmenu', ev);
        expect(ev.defaultPrevented).toBe(true); // default menu still suppressed
        for (const menu of [bookmarkMenu, folderMenu, separatorMenu, searchHistoryMenu])
            expect(menu.style.opacity).not.toBe('1');
        expect(icon.classList.contains('active')).toBe(false);
    });
});

describe('empty-folder menu greying (content-dependent items)', () => {
    // applyContentDisabled: open / tab-group entries need URL children, the
    // sort entries need any child; only the add-type entries stay enabled
    // for an empty folder (root greying is a separate ROOT_DISABLED_IDS rule).
    // The menu items are created on demand (menuItem), so a test ensures the
    // ones applyContentDisabled toggles exist before the folder menu opens.
    const CONTENT_IDS = ['folder-window', 'open-bookmarks-in-group',
        'open-bookmarks-in-group-setup', 'folder-open-in-existing-group',
        'folder-new-window', 'folder-new-incognito-window',
        'sort-folder-by-name', 'sort-folder-by-date', 'sort-folder-contents',
        'add-bookmark-top', 'add-bookmark-bottom', 'add-new-folder', 'add-folder-separator'];

    const ensureItems = menuItem => {
        for (const id of CONTENT_IDS)
            menuItem(id);
    };

    it('an empty folder disables every open/tab-group/sort entry and keeps the add-type ones', () => {
        const { byId, menuItem, makeFolderRow, openOn } = setup({ children: { 7: [] } });
        ensureItems(menuItem);
        openOn(makeFolderRow().span); // folder 7, empty
        for (const id of ['folder-window', 'open-bookmarks-in-group',
            'open-bookmarks-in-group-setup', 'folder-open-in-existing-group',
            'folder-new-window', 'folder-new-incognito-window'])
            expect(byId[id].classList.contains('disabled'), id).toBe(true);
        for (const id of ['sort-folder-by-name', 'sort-folder-by-date', 'sort-folder-contents'])
            expect(byId[id].classList.contains('disabled'), id).toBe(true);
        // add-type entries stay usable
        for (const id of ['add-bookmark-top', 'add-bookmark-bottom', 'add-new-folder', 'add-folder-separator'])
            expect(byId[id].classList.contains('disabled'), id).toBe(false);
    });

    it('a folder with only subfolders (no URL children) disables the open entries but keeps sort', () => {
        const { byId, menuItem, makeFolderRow, openOn } = setup({ children: { 7: [{ id: '8', title: 'sub' }] } });
        ensureItems(menuItem);
        openOn(makeFolderRow().span);
        expect(byId['folder-window'].classList.contains('disabled')).toBe(true);   // no URL → open dead
        expect(byId['sort-folder-by-name'].classList.contains('disabled')).toBe(false); // has children → sort alive
    });

    it('a folder with bookmarks keeps everything enabled', () => {
        const { byId, menuItem, makeFolderRow, openOn } =
            setup({ children: { 7: [{ id: '8', title: 'GitHub', url: 'https://github.com' }] } });
        ensureItems(menuItem);
        openOn(makeFolderRow().span);
        for (const id of ['folder-window', 'open-bookmarks-in-group',
            'folder-new-window', 'sort-folder-by-name', 'sort-folder-contents'])
            expect(byId[id].classList.contains('disabled'), id).toBe(false);
    });

    it('the collapsed tab-group submenu greys too when the folder has no URL children', () => {
        const { folderTabGroupSubmenu, makeFolderRow, openOn } =
            setup({ collapseTabGroupMenu: true, children: { 7: [{ id: '8', title: 'sub' }] } });
        openOn(makeFolderRow().span);
        const subItems = folderTabGroupSubmenu.querySelectorAll('.menu-item');
        for (const item of subItems)
            expect(item.classList.contains('disabled')).toBe(true);
    });

    it('a disabled open entry refuses to dispatch (the shared .disabled guard)', () => {
        const { folderMenu, byId, menuItem, makeFolderRow, openOn, actionCalls } =
            setup({ children: { 7: [] } });
        ensureItems(menuItem);
        openOn(makeFolderRow().span);
        expect(byId['folder-window'].classList.contains('disabled')).toBe(true);
        fire(folderMenu, 'mouseup', makeEvent({ target: byId['folder-window'], button: 0 }));
        expect(actionCalls.filter(c => c[0] === 'openBookmarks')).toHaveLength(0);
    });

    it('the link-folder (search/palette) branch applies the same content greying', () => {
        const { byId, menuItem, makeLinkFolderRow, openOn } = setup({
            children: { 7: [], 8: [{ id: '9', title: 'GitHub', url: 'https://github.com' }] }
        });
        ensureItems(menuItem);
        openOn(makeLinkFolderRow('7').a); // an empty folder's result row
        expect(byId['folder-window'].classList.contains('disabled')).toBe(true);
        expect(byId['sort-folder-by-name'].classList.contains('disabled')).toBe(true);
        // …then a folder WITH content: the greying must flip back (the
        // reported leak — this branch used to skip applyContentDisabled, so
        // the empty folder's disabled classes lingered).
        openOn(makeLinkFolderRow('8').a);
        expect(byId['folder-window'].classList.contains('disabled')).toBe(false);
        expect(byId['sort-folder-by-name'].classList.contains('disabled')).toBe(false);
    });

    it('greying from a tree-folder open does not leak into a link-folder menu', () => {
        const { byId, menuItem, makeFolderRow, makeLinkFolderRow, openOn } = setup({
            children: { 7: [], 8: [{ id: '9', title: 'GitHub', url: 'https://github.com' }] }
        });
        ensureItems(menuItem);
        openOn(makeFolderRow('7').span); // empty tree folder → greys out
        expect(byId['folder-window'].classList.contains('disabled')).toBe(true);
        openOn(makeLinkFolderRow('8').a); // search-result folder with bookmarks
        expect(byId['folder-window'].classList.contains('disabled')).toBe(false);
    });

    it('closing the menu resets the content greying (no stale state on the next open)', () => {
        const { byId, menuItem, makeFolderRow, openOn, menus } = setup({ children: { 7: [] } });
        ensureItems(menuItem);
        openOn(makeFolderRow('7').span);
        expect(byId['folder-window'].classList.contains('disabled')).toBe(true);
        menus.clearMenu();
        expect(byId['folder-window'].classList.contains('disabled')).toBe(false);
        expect(byId['sort-folder-by-name'].classList.contains('disabled')).toBe(false);
    });

    it('a failed getChildren (lastError) keeps the all-enabled state without throwing', () => {
        const ctx = setup({});
        const { byId, menuItem, makeFolderRow, openOn, chrome } = ctx;
        ensureItems(menuItem);
        // A folder deleted/synced away between right-click and the callback:
        // getChildren fails with lastError (same guard as tree-view's lazy
        // expand) — no greying applied, no "unchecked lastError" log.
        chrome.bookmarks.getChildren = (id, cb) => {
            chrome.runtime.lastError = { message: 'Bookmark id is invalid' };
            cb(undefined);
            chrome.runtime.lastError = undefined;
        };
        openOn(makeFolderRow('7').span);
        expect(byId['folder-window'].classList.contains('disabled')).toBe(false);
        expect(byId['sort-folder-by-name'].classList.contains('disabled')).toBe(false);
    });
});

describe('collapsed-group submenus (issue #48 follow-up)', () => {
    it('applies collapse-sort to the folder menu by default and collapse-tab-group when enabled', () => {
        const { folderMenu, bookmarkMenu, makeFolderRow, openOn } = setup({});
        openOn(makeFolderRow().span);
        expect(folderMenu.classList.contains('collapse-sort')).toBe(true); // default ON
        expect(folderMenu.classList.contains('collapse-tab-group')).toBe(false); // default OFF
        expect(bookmarkMenu.classList.contains('collapse-tab-group')).toBe(false);
    });

    it('collapse-sort off leaves the raw sort items visible', () => {
        const { folderMenu, makeFolderRow, openOn } = setup({ collapseSortMenu: false });
        openOn(makeFolderRow().span);
        expect(folderMenu.classList.contains('collapse-sort')).toBe(false);
    });

    it('collapse-tab-group applies to BOTH the folder and bookmark menus', () => {
        const { folderMenu, bookmarkMenu, makeFolderRow, makeBookmarkRow, openOn } =
            setup({ collapseTabGroupMenu: true });
        openOn(makeFolderRow().span);
        expect(folderMenu.classList.contains('collapse-tab-group')).toBe(true);
        openOn(makeBookmarkRow().a);
        expect(bookmarkMenu.classList.contains('collapse-tab-group')).toBe(true);
    });

    it('a root folder keeps hide-sort while collapse-sort is on', () => {
        const { folderMenu, makeFolderRow, openOn } = setup({});
        openOn(makeFolderRow('7', '0').span); // parentid '0' = root folder
        expect(folderMenu.classList.contains('hide-sort')).toBe(true);
        expect(folderMenu.classList.contains('collapse-sort')).toBe(true);
    });

    it('disables the collapsed tab-group entry when the folder has no bookmark children', () => {
        // getChildren resolves synchronously in the stub; a URL-less subfolder
        // means there is nothing to tab-group.
        const children = { 7: [{ id: '8', title: 'sub', url: undefined }] };
        const { folderTabGroupEntry, makeFolderRow, openOn } =
            setup({ collapseTabGroupMenu: true, children });
        openOn(makeFolderRow().span);
        expect(folderTabGroupEntry.classList.contains('disabled')).toBe(true);
    });

    it('keeps the collapsed tab-group entry enabled when the folder has bookmarks', () => {
        const children = { 7: [{ id: '8', title: 'GitHub', url: 'https://github.com' }] };
        const { folderTabGroupEntry, makeFolderRow, openOn } =
            setup({ collapseTabGroupMenu: true, children });
        openOn(makeFolderRow().span);
        expect(folderTabGroupEntry.classList.contains('disabled')).toBe(false);
    });

    it('openSubmenuFor shows the linked flyout and closeSubmenu parks it', () => {
        const { menus, folderSortEntry, folderSortSubmenu, makeFolderRow, openOn } =
            setup({ children: { 7: [{ id: '8', title: 'X', url: 'https://x.example' }] } });
        openOn(makeFolderRow().span);
        folderSortEntry.rect = { left: 100, top: 100, width: 120, height: 26, right: 220, bottom: 126 };
        expect(menus.openSubmenuFor(folderSortEntry)).toBe(folderSortSubmenu);
        expect(folderSortSubmenu.style.opacity).toBe('1');
        expect(menus.submenuOpen()).toBe(true);
        menus.closeSubmenu(true);
        expect(folderSortSubmenu.style.opacity).toBe('0');
        expect(menus.submenuOpen()).toBe(false);
    });

    it('only one flyout is open at a time', () => {
        const { menus, folderSortEntry, folderTabGroupEntry, folderSortSubmenu,
            folderTabGroupSubmenu, makeFolderRow, openOn } =
            setup({ collapseTabGroupMenu: true, children: { 7: [{ id: '8', title: 'X', url: 'https://x.example' }] } });
        openOn(makeFolderRow().span);
        menus.openSubmenuFor(folderSortEntry);
        menus.openSubmenuFor(folderTabGroupEntry);
        expect(folderSortSubmenu.style.opacity).toBe('0');
        expect(folderTabGroupSubmenu.style.opacity).toBe('1');
        expect(menus.submenuOpen()).toBe(true);
    });

    it('a disabled entry refuses to open its flyout', () => {
        const { menus, folderSortEntry, makeFolderRow, openOn } = setup({});
        openOn(makeFolderRow().span);
        folderSortEntry.classList.add('disabled');
        expect(menus.openSubmenuFor(folderSortEntry)).toBe(null);
        expect(menus.submenuOpen()).toBe(false);
    });

    it('dispatches a collapsed sort submenu item through the folder handler and closes the menu', () => {
        const { menus, folderSortEntry, folderMenu, folderSortSubmenu, byId, makeFolderRow, openOn, sortFolderCalls } =
            setup({ children: { 7: [{ id: '8', title: 'X', url: 'https://x.example' }] } });
        const { span } = makeFolderRow();
        openOn(span);
        menus.openSubmenuFor(folderSortEntry);
        const item = byId['sub-sort-folder-by-name'];
        fire(folderSortSubmenu, 'mouseup', makeEvent({ target: item, button: 0 }));
        expect(sortFolderCalls[0][0]).toBe('7');
        expect(sortFolderCalls[0][1]).toEqual(expect.objectContaining({ by: 'title' }));
        expect(folderMenu.style.opacity).toBe('0'); // menu closed first (focus law)
        expect(menus.submenuOpen()).toBe(false);
    });

    it('dispatches a collapsed tab-group submenu item (sub- id normalize)', () => {
        const { menus, folderTabGroupEntry, folderTabGroupSubmenu, byId, makeFolderRow, openOn, actionCalls } =
            setup({ collapseTabGroupMenu: true, children: { 7: [{ id: '8', title: 'X', url: 'https://x.example' }] } });
        const { span } = makeFolderRow();
        openOn(span);
        menus.openSubmenuFor(folderTabGroupEntry);
        const item = byId['sub-open-bookmarks-in-group'];
        fire(folderTabGroupSubmenu, 'mouseup', makeEvent({ target: item, button: 0 }));
        // folder menu open → groupTitle '' → openBookmarksInGroup(urls, '')
        // a bare "was called at all" check would pass with wrong urls or a
        // stale groupTitle — pin the exact arguments
        expect(actionCalls).toEqual([
            ['openBookmarksInGroup', ['https://x.example'], '']
        ]);
    });

    it('flips the flyout to the left when it would overflow the right edge', () => {
        const { menus, folderSortEntry, folderSortSubmenu, makeFolderRow, openOn } =
            setup({ children: { 7: [{ id: '8', title: 'X', url: 'https://x.example' }] } });
        folderSortSubmenu.offsetWidth = 200;
        folderSortSubmenu.offsetHeight = 100;
        openOn(makeFolderRow().span);
        folderSortEntry.rect = { left: 400, top: 100, width: 120, height: 26, right: 520, bottom: 126 };
        menus.openSubmenuFor(folderSortEntry);
        // 400+120+200=720 > body 500 → flips to 400-200=200
        expect(folderSortSubmenu.style.left).toBe('200px');
        expect(folderSortSubmenu.style.top).toBe('100px');
    });

    it('flips the flyout to the right at the left edge under rtl', () => {
        const { menus, folderSortEntry, folderSortSubmenu, makeFolderRow, openOn } =
            setup({ rtl: true, children: { 7: [{ id: '8', title: 'X', url: 'https://x.example' }] } });
        folderSortSubmenu.offsetWidth = 200;
        folderSortSubmenu.offsetHeight = 100;
        openOn(makeFolderRow().span);
        folderSortEntry.rect = { left: 100, top: 100, width: 120, height: 26, right: 220, bottom: 126 };
        menus.openSubmenuFor(folderSortEntry);
        // rtl: 100-200=-100 < 0 → flips to 100+120=220
        expect(folderSortSubmenu.style.left).toBe('220px');
    });

    it('a click on the collapse entry toggles its flyout without closing the menu', () => {
        const { menus, folderSortEntry, folderSortSubmenu, folderMenu, makeFolderRow, openOn } =
            setup({ children: { 7: [{ id: '8', title: 'X', url: 'https://x.example' }] } });
        const { span } = makeFolderRow();
        openOn(span);
        fire(folderMenu, 'mouseup', makeEvent({ target: folderSortEntry, button: 0 }));
        expect(folderSortSubmenu.style.opacity).toBe('1'); // opened
        expect(folderMenu.style.opacity).toBe('1'); // parent still open
        fire(folderMenu, 'mouseup', makeEvent({ target: folderSortEntry, button: 0 }));
        expect(folderSortSubmenu.style.opacity).toBe('0'); // toggled closed
        expect(folderMenu.style.opacity).toBe('1');
    });
});

describe('mac right-click hold', () => {
    it('closes the menu when the right button is released after 500ms', () => {
        const { body, bookmarkMenu, makeBookmarkRow, openOn } = setup({ os: 'mac' });
        const { a } = makeBookmarkRow();
        openOn(a);
        expect(timeouts).toHaveLength(1);
        expect(timeouts[0][1]).toBe(500);
        // released too early: menu stays open
        fire(body, 'mouseup', makeEvent({ button: 2 }));
        expect(bookmarkMenu.style.opacity).toBe('1');
        // held past the timeout: menu closes
        timeouts[0][0]();
        fire(body, 'mouseup', makeEvent({ button: 2 }));
        expect(bookmarkMenu.style.opacity).toBe('0');
    });

    it('never arms the hold-to-close timer on other platforms', () => {
        const { body, bookmarkMenu, makeBookmarkRow, openOn } = setup({ os: 'linux' });
        const { a } = makeBookmarkRow();
        openOn(a);
        expect(timeouts).toEqual([]);
        fire(body, 'mouseup', makeEvent({ button: 2 }));
        expect(bookmarkMenu.style.opacity).toBe('1');
    });
});

// The Mac right-click jitter guard: a macOS right-click is often a trackpad
// two-finger / Magic Mouse corner click whose tiny slide the OS reports as a
// scroll gesture in the same instant the menu opens. The guard (in
// context-menu.js) ignores SCROLL-driven dismissals for a short grace window
// after open while the scrolling container has moved less than a small
// threshold — a click's fingerprint scrolls a few px, a deliberate scroll
// moves further. Clicks and focus moves are never guarded (a right-click
// fires no click and a slide moves no focus). The window is time-based, so
// these tests drive a fake clock by stubbing Date.now (the same
// global-stub pattern as setTimeout above).
describe('Mac right-click jitter scroll guard', () => {
    const realDateNow = Date.now;
    let now;
    beforeAll(() => { globalThis.Date.now = () => now; });
    afterAll(() => { globalThis.Date.now = realDateNow; });
    beforeEach(() => { now = 1000; });

    it('keeps a menu open through the tiny scroll a right-click slide produces', () => {
        const ctx = setup({});
        const { a } = ctx.makeBookmarkRow('42');
        ctx.openOn(a); // now = 1000, inside the 500ms grace window
        ctx.tree.scrollTop = 8; // the slide's scroll: a few px
        fire(ctx.tree, 'scroll', makeEvent({ target: ctx.tree }));
        expect(ctx.bookmarkMenu.style.opacity).toBe('1'); // still open
        expect(ctx.bookmarkMenu.style.left).toBe('50px'); // positioned, not parked
    });

    it('closes the menu once the grace window has passed', () => {
        const ctx = setup({});
        const { a } = ctx.makeBookmarkRow('42');
        ctx.openOn(a); // now = 1000
        now = 2000; // 1000ms later — the window expired
        ctx.tree.scrollTop = 8;
        fire(ctx.tree, 'scroll', makeEvent({ target: ctx.tree }));
        expect(ctx.bookmarkMenu.style.opacity).toBe('0');
    });

    it('closes the menu even within the window when the scroll is too large to be jitter', () => {
        const ctx = setup({});
        const { a } = ctx.makeBookmarkRow('42');
        ctx.openOn(a); // now = 1000, inside the window
        ctx.tree.scrollTop = 200; // a deliberate scroll, not a fingerprint
        fire(ctx.tree, 'scroll', makeEvent({ target: ctx.tree }));
        expect(ctx.bookmarkMenu.style.opacity).toBe('0');
    });

    it('guards a small page scroll and passes a large one through', () => {
        const ctx = setup({});
        const { a } = ctx.makeBookmarkRow('42');
        ctx.openOn(a); // now = 1000
        globalThis.window.scrollY = 5; // the slide scrolled the page a hair
        ctx.fireWindow('scroll', makeEvent({ target: globalThis.window }));
        expect(ctx.bookmarkMenu.style.opacity).toBe('1');
        globalThis.window.scrollY = 100; // the page scrolled meaningfully
        ctx.fireWindow('scroll', makeEvent({ target: globalThis.window }));
        expect(ctx.bookmarkMenu.style.opacity).toBe('0');
    });

    it('does not guard clicks or focus moves — those are never jitter', () => {
        const ctx = setup({});
        const { a } = ctx.makeBookmarkRow('42');
        ctx.openOn(a); // now = 1000
        fire(ctx.body, 'click', makeEvent({ target: ctx.body }));
        expect(ctx.bookmarkMenu.style.opacity).toBe('0');
        // the focus-move path: reopen, then move focus into the tree
        ctx.openOn(a);
        fire(ctx.tree, 'focus', makeEvent({ target: ctx.tree }));
        expect(ctx.bookmarkMenu.style.opacity).toBe('0');
    });
});

describe('bookmarkContextHandler', () => {
    const openBookmarkMenu = ctx => {
        const { a } = ctx.makeBookmarkRow('42');
        ctx.openOn(a);
        return a;
    };

    it('add-bookmark-before-bookmark queries the current tab and adds before the row', () => {
        const ctx = setup({});
        openBookmarkMenu(ctx);
        const ev = makeEvent({ button: 0, target: ctx.menuItem('add-bookmark-before-bookmark') });
        fire(ctx.bookmarkMenu, 'mouseup', ev);
        expect(ev.propagationStopped).toBe(true);
        expect(ctx.chrome.tabs.queried).toEqual([{ active: true, windowId: -1 }]);
        expect(ctx.actionCalls).toEqual([
            ['addNewBookmarkNode', '42', 'before', 'https://current.example/page', 'Current Tab']
        ]);
        expect(ctx.bookmarkMenu.style.opacity).toBe('0'); // closed after dispatch
    });

    it('add-bookmark-after-bookmark adds after the row', () => {
        const ctx = setup({});
        openBookmarkMenu(ctx);
        fire(ctx.bookmarkMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('add-bookmark-after-bookmark') }));
        expect(ctx.actionCalls).toEqual([
            ['addNewBookmarkNode', '42', 'after', 'https://current.example/page', 'Current Tab']
        ]);
    });

    it('bookmark-new-tab opens the row url in a new tab', () => {
        const ctx = setup({});
        openBookmarkMenu(ctx);
        fire(ctx.bookmarkMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('bookmark-new-tab') }));
        expect(ctx.actionCalls).toEqual([['openBookmarkNewTab', 'https://bm-42.example/']]);
        expect(ctx.chrome.tabs.queried).toEqual([]); // the menu itself never queries tabs
    });

    it('bookmark-new-incognito-window opens the row url incognito', () => {
        const ctx = setup({});
        openBookmarkMenu(ctx);
        fire(ctx.bookmarkMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('bookmark-new-incognito-window') }));
        expect(ctx.actionCalls).toEqual([['openBookmarkNewWindow', 'https://bm-42.example/', true]]);
    });

    it('replace-url replaces the row url with the current tab url', () => {
        const ctx = setup({});
        openBookmarkMenu(ctx);
        fire(ctx.bookmarkMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('replace-url') }));
        expect(ctx.chrome.tabs.queried).toHaveLength(1);
        expect(ctx.actionCalls).toEqual([['replaceUrl', '42', 'https://current.example/page']]);
    });

    it('ignores clicks that did not land on a menu-item and keeps the menu open', () => {
        const ctx = setup({});
        openBookmarkMenu(ctx);
        fire(ctx.bookmarkMenu, 'mouseup', makeEvent({ button: 0, target: ctx.el('DIV') }));
        expect(ctx.actionCalls).toEqual([]);
        expect(ctx.bookmarkMenu.style.opacity).toBe('1');
    });

    it('does nothing when no menu is open (no context row)', () => {
        const ctx = setup({});
        fire(ctx.bookmarkMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('bookmark-new-tab') }));
        expect(ctx.actionCalls).toEqual([]);
        expect(ctx.chrome.tabs.queried).toEqual([]);
    });

    it('ignores middle-click on Windows/Linux but dispatches it on Mac', () => {
        const linux = setup({ os: 'linux' });
        openBookmarkMenu(linux);
        fire(linux.bookmarkMenu, 'mouseup',
            makeEvent({ button: 1, target: linux.menuItem('bookmark-new-tab') }));
        expect(linux.actionCalls).toEqual([]);

        const mac = setup({ os: 'mac' });
        openBookmarkMenu(mac);
        fire(mac.bookmarkMenu, 'mouseup',
            makeEvent({ button: 1, target: mac.menuItem('bookmark-new-tab') }));
        expect(mac.actionCalls).toEqual([['openBookmarkNewTab', 'https://bm-42.example/']]);
    });

    it('also dispatches on a contextmenu event over the menu', () => {
        const ctx = setup({});
        openBookmarkMenu(ctx);
        const ev = makeEvent({ target: ctx.menuItem('bookmark-new-tab') });
        fire(ctx.bookmarkMenu, 'contextmenu', ev);
        expect(ev.propagationStopped).toBe(true);
        expect(ctx.actionCalls).toEqual([['openBookmarkNewTab', 'https://bm-42.example/']]);
    });

    it('a plain click on the menu only stops propagation', () => {
        const ctx = setup({});
        openBookmarkMenu(ctx);
        const ev = makeEvent({ target: ctx.menuItem('bookmark-new-tab') });
        fire(ctx.bookmarkMenu, 'click', ev);
        expect(ev.propagationStopped).toBe(true);
        expect(ctx.actionCalls).toEqual([]);
    });
});

describe('folderContextHandler', () => {
    const folderChildren = [
        { id: 'a', url: 'http://a/' },
        { id: 'b' }, // subfolder: no url
        { id: 'c', url: 'http://c/' }
    ];
    const openFolderMenu = (ctx, id = '7') => {
        const { span } = ctx.makeFolderRow(id);
        ctx.openOn(span);
    };

    it('folder-window opens every child url, skipping subfolders', () => {
        const ctx = setup({ children: { '7': folderChildren } });
        openFolderMenu(ctx);
        fire(ctx.folderMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('folder-window') }));
        expect(ctx.actionCalls).toEqual([['openBookmarks', ['http://a/', 'http://c/']]]);
        expect(ctx.folderMenu.style.opacity).toBe('0');
    });

    it('hands the full url list to openBookmarks even above the confirm limit', () => {
        // The >10 ConfirmDialog gate lives in actions.openBookmarks and is
        // covered by tests/actions.test.js; the menu always passes the whole
        // cleaned list through.
        const children = Array.from({ length: 11 }, (_, i) => ({ id: `${i}`, url: `http://x/${i}` }));
        const ctx = setup({ children: { '8': children } });
        openFolderMenu(ctx, '8');
        fire(ctx.folderMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('folder-window') }));
        expect(ctx.actionCalls).toEqual([['openBookmarks', children.map(c => c.url)]]);
    });

    it('does not offer open-all for a folder with only subfolders', () => {
        const ctx = setup({ children: { '9': [{ id: 'a' }, { id: 'b' }] } });
        openFolderMenu(ctx, '9');
        fire(ctx.folderMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('folder-window') }));
        expect(ctx.actionCalls).toEqual([]);
        expect(ctx.folderMenu.style.opacity).toBe('0'); // still closed afterwards
    });

    it('sort-folder-contents opens the sort dialog for the folder', () => {
        const ctx = setup({ children: { '7': folderChildren } });
        openFolderMenu(ctx);
        fire(ctx.folderMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('sort-folder-contents') }));
        expect(ctx.sortCalls).toEqual(['7']);
        expect(ctx.actionCalls).toEqual([]);
    });

    // issue #33: the direct sort items dispatch with the persisted sortOptions
    // and only flip the sort key.
    it('sort-folder-by-name dispatches the direct title sort with the saved options', () => {
        const ctx = setup({
            children: { '7': folderChildren },
            sortOptions: { by: 'dateAdded', foldersFirst: false, recursive: true }
        });
        openFolderMenu(ctx);
        fire(ctx.folderMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('sort-folder-by-name') }));
        expect(ctx.sortFolderCalls).toEqual([['7', { by: 'title', foldersFirst: false, recursive: true }]]);
        expect(ctx.sortCalls).toEqual([]); // no dialog
    });

    it('sort-folder-by-date dispatches the direct date sort with the saved options', () => {
        const ctx = setup({ children: { '7': folderChildren }, sortOptions: { by: 'title', recursive: false } });
        openFolderMenu(ctx);
        fire(ctx.folderMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('sort-folder-by-date') }));
        expect(ctx.sortFolderCalls).toEqual([['7', { by: 'dateAdded', recursive: false }]]);
        expect(ctx.sortCalls).toEqual([]);
    });

    it('the direct sort item labels carry the recursive suffix when the option is on', () => {
        const ctx = setup({
            children: { '7': folderChildren },
            sortOptions: { by: 'title', foldersFirst: true, recursive: true }
        });
        const nameItem = ctx.el('DIV', 'sort-folder-by-name');
        const dateItem = ctx.el('DIV', 'sort-folder-by-date');
        openFolderMenu(ctx);
        // i18n stub echoes keys: 'sortByName' + ' sortRecursiveSuffix'
        expect(nameItem.textContent).toBe('sortByName sortRecursiveSuffix');
        expect(dateItem.textContent).toBe('sortByDate sortRecursiveSuffix');
    });

    it('the direct sort item labels stay bare when recursive is off', () => {
        const ctx = setup({
            children: { '7': folderChildren },
            sortOptions: { by: 'title', foldersFirst: true, recursive: false }
        });
        const nameItem = ctx.el('DIV', 'sort-folder-by-name');
        openFolderMenu(ctx);
        expect(nameItem.textContent).toBe('sortByName');
    });

    it('add-bookmark-top queries the current tab and adds at the top', () => {
        const ctx = setup({ children: { '7': folderChildren } });
        openFolderMenu(ctx);
        fire(ctx.folderMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('add-bookmark-top') }));
        expect(ctx.chrome.tabs.queried).toEqual([{ active: true, windowId: -1 }]);
        expect(ctx.actionCalls).toEqual([
            ['addNewBookmarkNode', '7', 'top', 'https://current.example/page', 'Current Tab']
        ]);
    });

    it('add-new-folder adds at the top without querying tabs', () => {
        const ctx = setup({ children: { '7': folderChildren } });
        openFolderMenu(ctx);
        fire(ctx.folderMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('add-new-folder') }));
        expect(ctx.actionCalls).toEqual([['addNewBookmarkNode', '7', 'top', '', '']]);
        expect(ctx.chrome.tabs.queried).toEqual([]);
    });

    it('folder-delete passes the bookmark/subfolder counts', () => {
        const ctx = setup({ children: { '7': folderChildren } });
        openFolderMenu(ctx);
        fire(ctx.folderMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('folder-delete') }));
        expect(ctx.actionCalls).toEqual([['deleteBookmarks', '7', 2, 1]]);
    });

    it('root folders disable the whole invalid set (edit/delete/before/after adds) and dispatch nothing', () => {
        const ctx = setup({ children: { '7': folderChildren } });
        // parentid '0' = one of the three root folders (bar / other / mobile)
        const rootRow = ctx.makeFolderRow('7', '0', 'Bookmarks Bar');
        ctx.openOn(rootRow.span);
        // Chrome refuses removeTree / title-update / root-level inserts on a
        // root folder — every such entry greys out; the sort entry hides
        expect(ctx.folderMenu.classList.contains('hide-sort')).toBe(true);
        const DISABLED = ['folder-delete', 'folder-edit',
            'add-bookmark-before-folder', 'add-bookmark-after-folder',
            'add-folder-before-folder', 'add-folder-after-folder',
            'add-folder-separator'];
        for (const id of DISABLED)
            expect(ctx.byId[id].classList.contains('disabled'), id).toBe(true);
        // a greyed item is the click target — dispatch is swallowed
        fire(ctx.folderMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.byId['folder-edit'] }));
        expect(ctx.actionCalls).toEqual([]);
        // but an IN-ROOT insert (top) still dispatches on a root folder
        fire(ctx.folderMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('add-bookmark-top') }));
        expect(ctx.actionCalls).toEqual([['addNewBookmarkNode', '7', 'top',
            'https://current.example/page', 'Current Tab']]);
        // the disabled states do not linger onto the next non-root open
        const plainRow = ctx.makeFolderRow('7', '1', 'My Folder');
        ctx.openOn(plainRow.span);
        for (const id of DISABLED)
            expect(ctx.byId[id].classList.contains('disabled'), id).toBe(false);
        // and clearMenu resets them too (a menu close without a folder reopen)
        ctx.openOn(rootRow.span);
        for (const id of DISABLED)
            expect(ctx.byId[id].classList.contains('disabled'), id).toBe(true);
        ctx.menus.clearMenu();
        for (const id of DISABLED)
            expect(ctx.byId[id].classList.contains('disabled'), id).toBe(false);
    });

    it('add-folder-separator adds a separator after the folder', () => {
        const ctx = setup({ children: { '7': folderChildren } });
        openFolderMenu(ctx);
        fire(ctx.folderMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('add-folder-separator') }));
        expect(ctx.actionCalls).toEqual([['addSeparator', '7', 'after']]);
    });

    it('ignores clicks outside menu-items without fetching children', () => {
        const ctx = setup({ children: { '7': folderChildren } });
        openFolderMenu(ctx);
        fire(ctx.folderMenu, 'mouseup', makeEvent({ button: 0, target: ctx.el('DIV') }));
        expect(ctx.actionCalls).toEqual([]);
        expect(ctx.folderMenu.style.opacity).toBe('1'); // menu stays open
    });

    it('does nothing when no menu is open (no context row)', () => {
        const ctx = setup({ children: { '7': folderChildren } });
        fire(ctx.folderMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('folder-window') }));
        expect(ctx.actionCalls).toEqual([]);
    });
});

describe('open-bookmarks-in-group menu item (P3.4)', () => {
    const folderChildren = [
        { id: 'a', url: 'http://a/' },
        { id: 'b' }, // subfolder: no url
        { id: 'c', url: 'http://c/' }
    ];
    const openFolderMenu = (ctx, id = '7', parentid = '1', title = 'My Folder') => {
        const { span } = ctx.makeFolderRow(id, parentid, title);
        ctx.openOn(span);
    };

    it('dispatches openBookmarksInGroup with the child urls and the trimmed folder title', () => {
        const ctx = setup({ children: { '7': folderChildren } });
        openFolderMenu(ctx, '7', '1', '  My Folder  ');
        fire(ctx.folderMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('open-bookmarks-in-group') }));
        expect(ctx.actionCalls).toEqual([
            ['openBookmarksInGroup', ['http://a/', 'http://c/'], 'My Folder']
        ]);
        expect(ctx.folderMenu.style.opacity).toBe('0'); // closed after dispatch
    });

    it('does nothing for a folder with only subfolders', () => {
        const ctx = setup({ children: { '9': [{ id: 'a' }, { id: 'b' }] } });
        openFolderMenu(ctx, '9');
        fire(ctx.folderMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('open-bookmarks-in-group') }));
        expect(ctx.actionCalls).toEqual([]);
        expect(ctx.folderMenu.style.opacity).toBe('0'); // still closed afterwards
    });

    it('falls back to an empty group title when the row has no <i> title node', () => {
        const ctx = setup({ children: { '7': folderChildren } });
        const { span } = ctx.makeFolderRow('7', '1', 'My Folder');
        span._qs.i = null;
        ctx.openOn(span);
        fire(ctx.folderMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('open-bookmarks-in-group') }));
        expect(ctx.actionCalls).toEqual([
            ['openBookmarksInGroup', ['http://a/', 'http://c/'], '']
        ]);
    });

    it('also dispatches on a root folder row (same root rule as folder-window: no hiding)', () => {
        const ctx = setup({ children: { '7': folderChildren } });
        openFolderMenu(ctx, '7', '0', 'Bookmarks Bar');
        // the only root-driven tweak is hide-sort, which never covers this item
        expect(ctx.folderMenu.classList.contains('hide-sort')).toBe(true);
        fire(ctx.folderMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('open-bookmarks-in-group') }));
        expect(ctx.actionCalls).toEqual([
            ['openBookmarksInGroup', ['http://a/', 'http://c/'], 'Bookmarks Bar']
        ]);
    });

    it('does nothing when no menu is open (no context row)', () => {
        const ctx = setup({ children: { '7': folderChildren } });
        fire(ctx.folderMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('open-bookmarks-in-group') }));
        expect(ctx.actionCalls).toEqual([]);
    });

    // Wiring contract: the item lives in the folder menu of both pages
    // (parity), right after folder-window, and neat.js assigns its text from
    // the openBookmarksInGroup message (the id→msg map every menu item uses).
    it('exists in popup.html and sidepanel.html right after folder-window, with a neat.js text mapping', () => {
        const item = '<div id="open-bookmarks-in-group" class="menu-item" role="menuitem" tabindex="-1"></div>';
        const anchor = '<div id="folder-window" class="menu-item" role="menuitem" tabindex="-1"></div>';
        for (const page of ['popup.html', 'sidepanel.html']) {
            const html = fs.readFileSync(new URL(`../pages/${page}`, import.meta.url), 'utf8');
            const anchorAt = html.indexOf(anchor);
            expect(anchorAt, page).toBeGreaterThan(-1);
            // the item immediately follows the anchor (modulo line indent)
            const after = html.slice(anchorAt + anchor.length).replace(/^\s+/, '');
            expect(after.startsWith(item), page).toBe(true);
        }
        const neatSource = fs.readFileSync(new URL('../src/neat.js', import.meta.url), 'utf8');
        expect(neatSource).toContain("'open-bookmarks-in-group': 'openBookmarksInGroup'");
        const enMessages = JSON.parse(fs.readFileSync(new URL('../_locales/en/messages.json', import.meta.url), 'utf8'));
        expect(enMessages.openBookmarksInGroup.message).toBeTruthy();
    });
});

describe('tab-group menu items (P3.4 hardening)', () => {
    const folderChildren = [
        { id: 'a', url: 'http://a/' },
        { id: 'b' }, // subfolder: no url
        { id: 'c', url: 'http://c/' }
    ];
    const openFolderMenu = (ctx, id = '7', parentid = '1', title = 'My Folder') => {
        const { span } = ctx.makeFolderRow(id, parentid, title);
        ctx.openOn(span);
    };
    const openBookmarkMenu = (ctx, id = '42', title = 'Dev Docs') => {
        const { a } = ctx.makeBookmarkRow(id, '1', title);
        ctx.openOn(a);
    };

    it('captures the folder group title before the async getChildren resolves (real-Chrome timing)', async () => {
        // The real chrome.bookmarks.getChildren defers its callback, so by
        // the time the switch runs, clearMenu() has already nulled
        // currentContext. The proposed group title must be read synchronously
        // before the async hop, or the group silently forms untitled.
        const ctx = setup({ children: { '7': folderChildren } });
        ctx.chrome.bookmarks.getChildren = (id, cb) =>
            Promise.resolve().then(() => cb(ctx.chrome.bookmarks.childNodes[id] || []));
        openFolderMenu(ctx, '7', '1', 'My Folder');
        fire(ctx.folderMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('open-bookmarks-in-group') }));
        await Promise.resolve();
        await Promise.resolve();
        expect(ctx.actionCalls).toEqual([
            ['openBookmarksInGroup', ['http://a/', 'http://c/'], 'My Folder']
        ]);
    });

    it('strips the localized sync suffix from the folder group title (one-click path)', () => {
        const ctx = setup({
            children: { '7': folderChildren },
            i18n: key => key === 'syncSuffixLocal' ? '(Local)' : key === 'syncSuffixSynced' ? '(Synced)' : key
        });
        openFolderMenu(ctx, '7', '1', 'My Folder (Local)');
        fire(ctx.folderMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('open-bookmarks-in-group') }));
        expect(ctx.actionCalls).toEqual([
            ['openBookmarksInGroup', ['http://a/', 'http://c/'], 'My Folder']
        ]);
    });

    it('folder setup item opens the GroupDialog prefilled, then dispatches on confirm', () => {
        const ctx = setup({ children: { '7': folderChildren } });
        openFolderMenu(ctx, '7', '1', 'My Folder');
        fire(ctx.folderMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('open-bookmarks-in-group-setup') }));
        expect(ctx.groupDialogCalls).toHaveLength(1);
        const dlg = ctx.groupDialogCalls[0];
        expect(dlg.title).toBe('My Folder');
        expect(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'])
            .toContain(dlg.color);
        dlg.onConfirm('Renamed', 'orange');
        expect(ctx.actionCalls).toEqual([
            ['openBookmarksInGroup', ['http://a/', 'http://c/'], 'Renamed', 'orange']
        ]);
    });

    it('folder existing-group item queries the tab groups and opens the picker, then dispatches on pick', () => {
        const ctx = setup({ children: { '7': folderChildren }, tabGroups: [{ id: 'g1', title: 'Work' }] });
        openFolderMenu(ctx, '7');
        fire(ctx.folderMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('folder-open-in-existing-group') }));
        expect(ctx.chrome.tabGroups.queried).toEqual([{}]);
        expect(ctx.groupPickCalls).toHaveLength(1);
        expect(ctx.groupPickCalls[0].groups).toEqual([{ id: 'g1', title: 'Work' }]);
        ctx.groupPickCalls[0].onPick('g1');
        expect(ctx.actionCalls).toEqual([
            ['openInExistingTabGroup', ['http://a/', 'http://c/'], 'g1']
        ]);
    });

    it('does nothing for the folder group items on a subfolder-only folder', () => {
        const ctx = setup({ children: { '9': [{ id: 'a' }] } });
        openFolderMenu(ctx, '9');
        fire(ctx.folderMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('open-bookmarks-in-group-setup') }));
        fire(ctx.folderMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('folder-open-in-existing-group') }));
        expect(ctx.actionCalls).toEqual([]);
        expect(ctx.groupDialogCalls).toEqual([]);
        expect(ctx.groupPickCalls).toEqual([]);
    });

    it('bookmark new-group item dispatches openBookmarksInGroup with the single url and its title', () => {
        const ctx = setup({});
        openBookmarkMenu(ctx, '42', 'Dev Docs');
        fire(ctx.bookmarkMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('bookmark-open-in-new-group') }));
        expect(ctx.actionCalls).toEqual([
            ['openBookmarksInGroup', ['https://bm-42.example/'], 'Dev Docs']
        ]);
    });

    it('bookmark setup item opens the GroupDialog and dispatches the chosen title/color', () => {
        const ctx = setup({});
        openBookmarkMenu(ctx, '42', 'Dev Docs');
        fire(ctx.bookmarkMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('bookmark-open-in-new-group-setup') }));
        expect(ctx.groupDialogCalls).toHaveLength(1);
        expect(ctx.groupDialogCalls[0].title).toBe('Dev Docs');
        ctx.groupDialogCalls[0].onConfirm('Docs', 'green');
        expect(ctx.actionCalls).toEqual([
            ['openBookmarksInGroup', ['https://bm-42.example/'], 'Docs', 'green']
        ]);
    });

    it('bookmark existing-group item queries the tab groups, opens the picker and dispatches on pick', () => {
        const ctx = setup({ tabGroups: [{ id: 'g2', title: '' }] });
        openBookmarkMenu(ctx, '42');
        fire(ctx.bookmarkMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('bookmark-open-in-existing-group') }));
        expect(ctx.chrome.tabGroups.queried).toEqual([{}]);
        expect(ctx.groupPickCalls).toHaveLength(1);
        expect(ctx.groupPickCalls[0].groups).toEqual([{ id: 'g2', title: '' }]);
        ctx.groupPickCalls[0].onPick('g2');
        expect(ctx.actionCalls).toEqual([
            ['openInExistingTabGroup', ['https://bm-42.example/'], 'g2']
        ]);
    });

    it('bookmark group items still dispatch with a missing <i> title node (empty title)', () => {
        const ctx = setup({});
        const { a } = ctx.makeBookmarkRow('42', '1', '');
        a._qs.i = null;
        ctx.openOn(a);
        fire(ctx.bookmarkMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('bookmark-open-in-new-group') }));
        expect(ctx.actionCalls).toEqual([
            ['openBookmarksInGroup', ['https://bm-42.example/'], '']
        ]);
    });

    it('new group items live in both pages with neat.js text mappings and en messages', () => {
        const pairs = [
            ['open-bookmarks-in-group-setup', 'openBookmarksInGroupSetup'],
            ['folder-open-in-existing-group', 'openBookmarksInExistingGroup'],
            ['bookmark-open-in-new-group', 'bookmarkOpenInNewGroup'],
            ['bookmark-open-in-new-group-setup', 'bookmarkOpenInNewGroupSetup'],
            ['bookmark-open-in-existing-group', 'bookmarkOpenInExistingGroup']
        ];
        for (const page of ['popup.html', 'sidepanel.html']) {
            const html = fs.readFileSync(new URL(`../pages/${page}`, import.meta.url), 'utf8');
            for (const [id] of pairs)
                expect(html, `${page}#${id}`).toContain(
                    `<div id="${id}" class="menu-item" role="menuitem" tabindex="-1"></div>`);
        }
        const neatSource = fs.readFileSync(new URL('../src/neat.js', import.meta.url), 'utf8');
        const enMessages = JSON.parse(fs.readFileSync(new URL('../_locales/en/messages.json', import.meta.url), 'utf8'));
        for (const [id, msgKey] of pairs) {
            expect(neatSource).toContain(`'${id}': '${msgKey}'`);
            expect(enMessages[msgKey].message).toBeTruthy();
        }
    });
});

describe('separatorContextHandler', () => {
    it('remove-separator deletes the separator row and closes the menu', () => {
        const ctx = setup({});
        const { a } = ctx.makeSeparatorRow('30');
        ctx.openOn(a);
        fire(ctx.separatorMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('remove-separator') }));
        expect(ctx.actionCalls).toEqual([['deleteSeparator', '30']]);
        expect(ctx.separatorMenu.style.opacity).toBe('0');
    });

    it('does nothing when no menu is open (no context row)', () => {
        const ctx = setup({});
        fire(ctx.separatorMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('remove-separator') }));
        expect(ctx.actionCalls).toEqual([]);
    });
});

describe('switchBookmarkMenu', () => {
    it('hides the add-* items and their separators while searching, then restores them', () => {
        const { menus, byId } = setup({});
        const ids = ['add-bookmark-before-bookmark', 'add-bookmark-after-bookmark',
            'add-folder-before-bookmark', 'add-folder-after-bookmark', 'add-separator',
            'bookmark-context-menu-sep1', 'bookmark-context-menu-sep2',
            'bookmark-context-menu-sep3'];
        menus.switchBookmarkMenu(true);
        for (const id of ids)
            expect(byId[id].style.display, id).toBe('none');
        menus.switchBookmarkMenu(false);
        for (const id of ids)
            expect(byId[id].style.display, id).toBe('block');
    });
});

describe('reveal-in-tree menu item (v4 task-2 §2.4)', () => {
    it('stays hidden on tree rows, shows on recent and results rows', () => {
        const { openOn, makeBookmarkRow, byId } = setup({});
        const treeRow = makeBookmarkRow('42');
        openOn(treeRow.a);
        expect(byId['reveal-in-tree'].style.display).toBe('none');
        expect(byId['reveal-in-tree-sep'].style.display).toBe('none');
        const recentRow = makeBookmarkRow('43');
        recentRow.li.id = 'recent-item-43';
        openOn(recentRow.a);
        expect(byId['reveal-in-tree'].style.display).toBe('block');
        expect(byId['reveal-in-tree-sep'].style.display).toBe('block');
        const resultsRow = makeBookmarkRow('44');
        resultsRow.li.id = 'results-item-44';
        openOn(resultsRow.a);
        expect(byId['reveal-in-tree'].style.display).toBe('block');
    });

    it('dispatches ctx.revealInTree with the data-node-id row id', () => {
        const { openOn, makeBookmarkRow, menuItem, bookmarkMenu, revealCalls } = setup({});
        const row = makeBookmarkRow('42');
        row.li.id = 'recent-item-42'; // prefix would strip to 42
        row.li.dataset.nodeId = '99';
        openOn(row.a);
        fire(bookmarkMenu, 'mouseup', makeEvent({ button: 0, target: menuItem('reveal-in-tree') }));
        expect(revealCalls).toEqual(['99']);
    });

    it('falls back to the id prefix when data-node-id is absent', () => {
        const { openOn, makeBookmarkRow, menuItem, bookmarkMenu, revealCalls } = setup({});
        const row = makeBookmarkRow('42');
        row.li.id = 'results-item-42';
        openOn(row.a);
        fire(bookmarkMenu, 'mouseup', makeEvent({ button: 0, target: menuItem('reveal-in-tree') }));
        expect(revealCalls).toEqual(['42']);
    });

    it('does nothing when no menu is open (no context row)', () => {
        const { menuItem, bookmarkMenu, revealCalls } = setup({});
        fire(bookmarkMenu, 'mouseup', makeEvent({ button: 0, target: menuItem('reveal-in-tree') }));
        expect(revealCalls).toEqual([]);
    });
});

describe('dead/dupes view menu items (v4 task-2 slice C)', () => {
    const deadMenuStub = (marked = false) => {
        const calls = [];
        return {
            calls,
            isMarked: () => marked,
            toggle: id => calls.push(['toggle', id])
        };
    };
    const dupesMenuStub = () => {
        const calls = [];
        return { calls, setKeeper: id => calls.push(['setKeeper', id]) };
    };
    const makeViewRow = (s, prefix, id) => {
        const row = s.makeBookmarkRow(id);
        row.li.id = `${prefix}-item-${id}`;
        row.li.dataset.nodeId = id;
        return row;
    };

    it('hides both entries on plain tree rows', () => {
        const s = setup({ deadMenu: deadMenuStub(), dupesMenu: dupesMenuStub() });
        const row = s.makeBookmarkRow('42');
        s.openOn(row.a);
        expect(s.byId['dead-mark-toggle'].style.display).toBe('none');
        expect(s.byId['dupes-set-keeper'].style.display).toBe('none');
    });

    it('shows the mark toggle only on dead rows, label follows mark state', () => {
        const unmarked = setup({ deadMenu: deadMenuStub(false) });
        unmarked.openOn(makeViewRow(unmarked, 'dead', '9').a);
        expect(unmarked.byId['dead-mark-toggle'].style.display).toBe('block');
        expect(unmarked.byId['dead-mark-toggle'].textContent).toBe('deadMark');
        expect(unmarked.byId['dupes-set-keeper'].style.display).toBe('none');
        const marked = setup({ deadMenu: deadMenuStub(true) });
        marked.openOn(makeViewRow(marked, 'dead', '9').a);
        expect(marked.byId['dead-mark-toggle'].textContent).toBe('deadUnmark');
    });

    it('hides the mark toggle on dead rows when the view API is absent', () => {
        const s = setup({});
        s.openOn(makeViewRow(s, 'dead', '9').a);
        expect(s.byId['dead-mark-toggle'].style.display).toBe('none');
    });

    it('dispatches deadMenu.toggle with the row id', () => {
        const deadMenu = deadMenuStub();
        const s = setup({ deadMenu });
        s.openOn(makeViewRow(s, 'dead', '9').a);
        fire(s.bookmarkMenu, 'mouseup',
            makeEvent({ button: 0, target: s.menuItem('dead-mark-toggle') }));
        expect(deadMenu.calls).toEqual([['toggle', '9']]);
    });

    it('shows the keeper pin only on dupes rows and dispatches setKeeper', () => {
        const dupesMenu = dupesMenuStub();
        const s = setup({ dupesMenu });
        s.openOn(makeViewRow(s, 'dupes', '5').a);
        expect(s.byId['dupes-set-keeper'].style.display).toBe('block');
        expect(s.byId['dead-mark-toggle'].style.display).toBe('none');
        fire(s.bookmarkMenu, 'mouseup',
            makeEvent({ button: 0, target: s.menuItem('dupes-set-keeper') }));
        expect(dupesMenu.calls).toEqual([['setKeeper', '5']]);
    });
});

describe('search-history context menu (round-4 item 7)', () => {
    it('opens the dedicated minimal menu on a history row, not the bookmark menu', () => {
        const { openOn, makeHistoryRow, searchHistoryMenu, bookmarkMenu, folderMenu, separatorMenu } = setup({});
        const { a } = makeHistoryRow('git');
        openOn(a);
        expect(a.classList.contains('active')).toBe(true);
        expect(searchHistoryMenu.style.opacity).toBe('1');
        for (const menu of [bookmarkMenu, folderMenu, separatorMenu])
            expect(menu.style.opacity).not.toBe('1');
    });

    it('assigns the item labels at init from the i18n messages', () => {
        const { byId } = setup({});
        expect(byId['search-history-menu-rerun'].textContent).toBe('searchHistoryRerun');
        expect(byId['search-history-menu-remove'].textContent).toBe('searchHistoryRemove');
        expect(byId['search-history-menu-clear'].textContent).toBe('searchHistoryClear');
    });

    it('opens nothing on the history area head / clear button', () => {
        const { openOn, el, searchHistoryMenu, bookmarkMenu } = setup({});
        openOn(el('BUTTON', 'search-history-clear'));
        expect(searchHistoryMenu.style.opacity).not.toBe('1');
        expect(bookmarkMenu.style.opacity).not.toBe('1');
    });

    it('search-history-menu-rerun reruns the query by activating the row anchor', () => {
        const ctx = setup({});
        const { a } = ctx.makeHistoryRow('git');
        let clicks = 0;
        a.click = () => clicks++;
        ctx.openOn(a);
        fire(ctx.searchHistoryMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('search-history-menu-rerun') }));
        expect(clicks).toBe(1);
        expect(ctx.searchHistoryMenu.style.opacity).toBe('0'); // closed after dispatch
    });

    it('search-history-menu-remove clicks the row remove button', () => {
        const ctx = setup({});
        const { li, a } = ctx.makeHistoryRow('git');
        let clicks = 0;
        const btn = ctx.el('BUTTON');
        btn.click = () => clicks++;
        li._qs['.search-history-remove'] = btn;
        ctx.openOn(a);
        fire(ctx.searchHistoryMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('search-history-menu-remove') }));
        expect(clicks).toBe(1);
        expect(ctx.searchHistoryMenu.style.opacity).toBe('0');
    });

    it('search-history-menu-remove survives a row re-render (detached currentContext)', () => {
        // The menu opened on a row that was re-rendered away before the click:
        // currentContext keeps the detached anchor (parentNode === null), and
        // the remove handler must not crash on it.
        const ctx = setup({});
        const { a } = ctx.makeHistoryRow('git');
        ctx.openOn(a); // menu opens, currentContext = the history anchor
        a.parentNode = null; // the row is gone from the DOM
        expect(() => {
            fire(ctx.searchHistoryMenu, 'mouseup',
                makeEvent({ button: 0, target: ctx.menuItem('search-history-menu-remove') }));
        }).not.toThrow();
        expect(ctx.searchHistoryMenu.style.opacity).toBe('0'); // still closes
    });

    it('search-history-menu-clear clicks the history area clear-all button', () => {
        const ctx = setup({});
        let clicks = 0;
        const clearBtn = ctx.el('BUTTON', 'search-history-clear');
        clearBtn.click = () => clicks++;
        const { a } = ctx.makeHistoryRow('git');
        ctx.openOn(a);
        fire(ctx.searchHistoryMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('search-history-menu-clear') }));
        expect(clicks).toBe(1);
        expect(ctx.searchHistoryMenu.style.opacity).toBe('0');
    });

    it('ignores clicks outside menu-items and keeps the menu open', () => {
        const ctx = setup({});
        const { a } = ctx.makeHistoryRow('git');
        ctx.openOn(a);
        fire(ctx.searchHistoryMenu, 'mouseup', makeEvent({ button: 0, target: ctx.el('DIV') }));
        expect(ctx.searchHistoryMenu.style.opacity).toBe('1');
    });

    it('does nothing when no menu is open (no context row)', () => {
        const ctx = setup({});
        const { a } = ctx.makeHistoryRow('git');
        let clicks = 0;
        a.click = () => clicks++;
        fire(ctx.searchHistoryMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('search-history-menu-rerun') }));
        expect(clicks).toBe(0);
    });

    it('is dismissed by the same history-area scroll/focus clearMenu path', () => {
        const { openOn, makeHistoryRow, searchHistoryMenu, viewLists } = setup({});
        const { a } = makeHistoryRow('git');
        openOn(a);
        expect(searchHistoryMenu.style.opacity).toBe('1');
        // A real dismissal scroll moves the list (a bare 0px scroll inside the
        // right-click jitter grace window is tolerated — that is the guard).
        viewLists['search-history-area'].scrollTop = 100;
        fire(viewLists['search-history-area'], 'scroll', makeEvent({ target: viewLists['search-history-area'] }));
        expect(searchHistoryMenu.style.opacity).toBe('0');
        expect(searchHistoryMenu.style.left).toBe('-999px');
    });

    it('plain bookmark rows still open the bookmark menu (regression)', () => {
        const { openOn, makeBookmarkRow, searchHistoryMenu, bookmarkMenu } = setup({});
        const { a } = makeBookmarkRow('42');
        openOn(a);
        expect(bookmarkMenu.style.opacity).toBe('1');
        expect(searchHistoryMenu.style.opacity).not.toBe('1');
    });

    // Wiring contract: the menu lives in both pages (parity), right after
    // the separator menu, with the three item ids the module assigns labels to.
    it('exists in popup.html and sidepanel.html right after the separator menu', () => {
        const anchor = '</menu>\n<menu id="search-history-context-menu" type="context" role="menu" tabindex="-1">';
        for (const page of ['popup.html', 'sidepanel.html']) {
            const html = fs.readFileSync(new URL(`../pages/${page}`, import.meta.url), 'utf8');
            expect(html.includes(anchor), page).toBe(true);
            for (const id of ['search-history-menu-rerun', 'search-history-menu-remove', 'search-history-menu-clear'])
                expect(html.includes(`id="${id}"`), `${page} ${id}`).toBe(true);
        }
    });
});

describe('flat bookmark menu outside the tree view (v4 task-3 #11)', () => {
    const POSITIONAL = ['add-bookmark-before-bookmark', 'add-bookmark-after-bookmark',
        'add-folder-before-bookmark', 'add-folder-after-bookmark', 'add-separator',
        'bookmark-context-menu-sep1', 'bookmark-context-menu-sep2', 'bookmark-context-menu-sep3'];

    it('hides the positional entries on non-tree rows and restores them on tree rows', () => {
        const { openOn, makeBookmarkRow, byId } = setup({});
        const recent = makeBookmarkRow('43');
        recent.li.id = 'neat-recent-item-43';
        openOn(recent.a);
        for (const id of POSITIONAL)
            expect(byId[id].style.display, id).toBe('none');
        const treeRow = makeBookmarkRow('42');
        openOn(treeRow.a);
        for (const id of POSITIONAL)
            expect(byId[id].style.display, id).toBe('block');
    });

    it('flattens dead/dupes/stats/results view rows as well', () => {
        const { openOn, makeBookmarkRow, byId } = setup({});
        for (const liId of ['dead-item-9', 'dupes-item-5', 'stats-hist-7', 'results-item-3']) {
            const row = makeBookmarkRow('9');
            row.li.id = liId;
            openOn(row.a);
            for (const id of POSITIONAL)
                expect(byId[id].style.display, `${liId} ${id}`).toBe('none');
        }
    });

    it('a tree row re-shows the entries even after switchBookmarkMenu(true) hid them', () => {
        const { menus, openOn, makeBookmarkRow, byId } = setup({});
        menus.switchBookmarkMenu(true); // the search-era global hide
        const treeRow = makeBookmarkRow('42');
        openOn(treeRow.a);
        for (const id of POSITIONAL)
            expect(byId[id].style.display, id).toBe('block');
    });
});

describe('hist-row context menu (v4 task-3 #10)', () => {
    it('opens the slim menu on an unbookmarked stats-history row, not the bookmark menu', () => {
        const { openOn, makeStatsHistRow, histRowMenu, bookmarkMenu, folderMenu } = setup({});
        const { a } = makeStatsHistRow();
        openOn(a);
        expect(a.classList.contains('active')).toBe(true);
        expect(histRowMenu.style.opacity).toBe('1');
        for (const menu of [bookmarkMenu, folderMenu])
            expect(menu.style.opacity).not.toBe('1');
    });

    it('assigns the item labels at init from the i18n messages', () => {
        const { byId } = setup({});
        expect(byId['hist-open-new-tab'].textContent).toBe('openNewTab');
        expect(byId['hist-open-new-window'].textContent).toBe('openNewWindow');
        expect(byId['hist-open-incognito'].textContent).toBe('openIncognitoWindow');
        expect(byId['hist-add-bookmark'].textContent).toBe('statsHistoryAdd');
    });

    it('resolves the row anchor when a non-anchor element of the row is right-clicked', () => {
        const { openOn, makeStatsHistRow, histRowMenu } = setup({});
        const { a, addBtn } = makeStatsHistRow();
        openOn(addBtn); // the ☆ button is a BUTTON — no a/span walk-up target
        expect(a.classList.contains('active')).toBe(true);
        expect(histRowMenu.style.opacity).toBe('1');
    });

    it('bookmarked history rows still get the (flat) bookmark menu', () => {
        const { openOn, makeStatsHistRow, histRowMenu, bookmarkMenu, byId } = setup({});
        const { li, a } = makeStatsHistRow();
        li.dataset.nodeId = '7';
        li.id = 'stats-hist-7';
        openOn(a);
        expect(bookmarkMenu.style.opacity).toBe('1');
        expect(histRowMenu.style.opacity).not.toBe('1');
        // … and the flat rule hides the positional entries on it
        expect(byId['add-bookmark-before-bookmark'].style.display).toBe('none');
    });

    it('hist-open-new-tab / new-window / incognito open the row url via the shared actions', () => {
        const ctx = setup({});
        const { a } = ctx.makeStatsHistRow('https://elsewhere.example/page');
        ctx.openOn(a);
        fire(ctx.histRowMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('hist-open-new-tab') }));
        expect(ctx.actionCalls).toEqual([['openBookmarkNewTab', 'https://elsewhere.example/page']]);
        expect(ctx.histRowMenu.style.opacity).toBe('0'); // closed after dispatch

        ctx.openOn(a);
        fire(ctx.histRowMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('hist-open-incognito') }));
        expect(ctx.actionCalls).toEqual([
            ['openBookmarkNewTab', 'https://elsewhere.example/page'],
            ['openBookmarkNewWindow', 'https://elsewhere.example/page', true]
        ]);
    });

    it('hist-add-bookmark clicks the row ☆ button (view-stats owns the add logic)', () => {
        const ctx = setup({});
        const { a, addBtn } = ctx.makeStatsHistRow();
        let clicks = 0;
        addBtn.click = () => clicks++;
        ctx.openOn(a);
        fire(ctx.histRowMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('hist-add-bookmark') }));
        expect(clicks).toBe(1);
        expect(ctx.histRowMenu.style.opacity).toBe('0');
    });

    it('hist-add-bookmark survives a row re-render (detached currentContext)', () => {
        // stats view re-renders its list on every refresh — a menu opened on a
        // row can outlive it. The detached anchor's parentNode is null; the
        // add handler must not crash looking for the ☆ button.
        const ctx = setup({});
        const { a } = ctx.makeStatsHistRow();
        ctx.openOn(a);
        a.parentNode = null; // the row is gone from the DOM
        expect(() => {
            fire(ctx.histRowMenu, 'mouseup',
                makeEvent({ button: 0, target: ctx.menuItem('hist-add-bookmark') }));
        }).not.toThrow();
        expect(ctx.histRowMenu.style.opacity).toBe('0');
    });

    it('does nothing when no menu is open (no context row)', () => {
        const ctx = setup({});
        fire(ctx.histRowMenu, 'mouseup',
            makeEvent({ button: 0, target: ctx.menuItem('hist-open-new-tab') }));
        expect(ctx.actionCalls).toEqual([]);
    });

    // Wiring contract: the menu lives in both pages (parity), right after the
    // search-history menu, with the four item ids the module assigns labels to.
    it('exists in popup.html and sidepanel.html right after the search-history menu', () => {
        const anchor = '</menu>\n<menu id="hist-row-context-menu" type="context" role="menu" tabindex="-1">';
        for (const page of ['popup.html', 'sidepanel.html']) {
            const html = fs.readFileSync(new URL(`../pages/${page}`, import.meta.url), 'utf8');
            expect(html.includes(anchor), page).toBe(true);
            for (const id of ['hist-open-new-tab', 'hist-open-new-window', 'hist-open-incognito', 'hist-add-bookmark'])
                expect(html.includes(`id="${id}"`), `${page} ${id}`).toBe(true);
        }
    });
});

describe('dupes group-head context menu (v4 task-3 #16)', () => {
    const dupesMenuStub = (hint = 'Keep «X», remove the other 2', collapsed = false) => {
        const calls = [];
        return {
            calls,
            cleanHint: key => (key === 'https://x.example/' ? hint : ''),
            isCollapsed: () => collapsed,
            cleanGroup: key => calls.push(['cleanGroup', key]),
            toggleGroup: key => calls.push(['toggleGroup', key])
        };
    };

    it('opens the group menu on the group head, not the folder menu', () => {
        const { openOn, makeDupesGroupHead, dupesGroupMenu, folderMenu, bookmarkMenu } =
            setup({ dupesMenu: dupesMenuStub() });
        const { head } = makeDupesGroupHead();
        openOn(head);
        expect(head.classList.contains('active')).toBe(true);
        expect(dupesGroupMenu.style.opacity).toBe('1');
        for (const menu of [folderMenu, bookmarkMenu])
            expect(menu.style.opacity).not.toBe('1');
    });

    it('also opens from a child span of the group head (walk-up)', () => {
        const { openOn, makeDupesGroupHead, dupesGroupMenu } = setup({ dupesMenu: dupesMenuStub() });
        const { head, keySpan } = makeDupesGroupHead();
        openOn(keySpan);
        expect(head.classList.contains('active')).toBe(true);
        expect(dupesGroupMenu.style.opacity).toBe('1');
    });

    it('resolves the labels at open time (clean hint + expand/collapse state)', () => {
        const s = setup({ dupesMenu: dupesMenuStub('Keep «A», remove the other 3', false) });
        const { head } = s.makeDupesGroupHead();
        s.openOn(head);
        expect(s.byId['dupes-group-clean'].textContent).toBe('Keep «A», remove the other 3');
        expect(s.byId['dupes-group-toggle'].textContent).toBe('dupesGroupCollapse');
        const collapsed = setup({ dupesMenu: dupesMenuStub('Keep «A», remove the other 3', true) });
        collapsed.openOn(collapsed.makeDupesGroupHead().head);
        expect(collapsed.byId['dupes-group-toggle'].textContent).toBe('dupesGroupExpand');
    });

    it('hides the clean entry (and its separator) when the hint resolves empty', () => {
        const s = setup({ dupesMenu: dupesMenuStub('') });
        s.openOn(s.makeDupesGroupHead('https://unknown.example/').head);
        expect(s.byId['dupes-group-clean'].style.display).toBe('none');
        expect(s.byId['dupes-group-menu-sep1'].style.display).toBe('none');
        expect(s.byId['dupes-group-toggle'].style.display).not.toBe('none');
    });

    it('dispatches cleanGroup / toggleGroup with the group key', () => {
        const dupesMenu = dupesMenuStub();
        const s = setup({ dupesMenu });
        s.openOn(s.makeDupesGroupHead().head);
        fire(s.dupesGroupMenu, 'mouseup',
            makeEvent({ button: 0, target: s.menuItem('dupes-group-clean') }));
        expect(dupesMenu.calls).toEqual([['cleanGroup', 'https://x.example/']]);
        expect(s.dupesGroupMenu.style.opacity).toBe('0'); // closed after dispatch
        s.openOn(s.makeDupesGroupHead().head);
        fire(s.dupesGroupMenu, 'mouseup',
            makeEvent({ button: 0, target: s.menuItem('dupes-group-toggle') }));
        expect(dupesMenu.calls).toEqual([
            ['cleanGroup', 'https://x.example/'],
            ['toggleGroup', 'https://x.example/']
        ]);
    });

    it('falls back to the legacy folder-menu branch when the dupes API is absent', () => {
        const { openOn, makeDupesGroupHead, dupesGroupMenu, folderMenu } = setup({});
        const { head } = makeDupesGroupHead();
        openOn(head);
        expect(dupesGroupMenu.style.opacity).not.toBe('1');
        expect(folderMenu.style.opacity).toBe('1');
    });

    it('does nothing when no menu is open (no context row)', () => {
        const dupesMenu = dupesMenuStub();
        const s = setup({ dupesMenu });
        fire(s.dupesGroupMenu, 'mouseup',
            makeEvent({ button: 0, target: s.menuItem('dupes-group-clean') }));
        expect(dupesMenu.calls).toEqual([]);
    });

    // Wiring contract: the menu lives in both pages (parity), right after the
    // hist-row menu, with the two item ids + separator the module resolves.
    it('exists in popup.html and sidepanel.html right after the hist-row menu', () => {
        const anchor = '</menu>\n<menu id="dupes-group-context-menu" type="context" role="menu" tabindex="-1">';
        for (const page of ['popup.html', 'sidepanel.html']) {
            const html = fs.readFileSync(new URL(`../pages/${page}`, import.meta.url), 'utf8');
            expect(html.includes(anchor), page).toBe(true);
            for (const id of ['dupes-group-clean', 'dupes-group-menu-sep1', 'dupes-group-toggle'])
                expect(html.includes(`id="${id}"`), `${page} ${id}`).toBe(true);
        }
    });
});

describe('zoom-clamped menu under the search bar (issue #59 audit)', () => {
    it('scales the search-bar clamp to viewport space', () => {
        const { bookmarkMenu, byId, el, makeBookmarkRow, openOn } = setup({ innerHeight: 600, zoomLevel: 1.2 });
        const search = el('DIV', 'search');
        search.offsetTop = 0;
        search.offsetHeight = 40; // layout 40 → viewport 48 at zoom 1.2
        byId.search = search;
        bookmarkMenu.offsetHeight = 700;
        openOn(makeBookmarkRow().a);
        // 600 - (40*1.2) - 8 margin = 544, not the raw layout 40 → 552
        expect(bookmarkMenu.style.maxHeight).toBe('544px');
    });
});
