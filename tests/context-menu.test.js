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
            _qs: {},
            _listeners: {},
            classList: {
                add: c => classes.add(c),
                remove: c => classes.delete(c),
                contains: c => classes.has(c)
            },
            addEventListener(type, fn) {
                (this._listeners[type] = this._listeners[type] || []).push(fn);
            },
            querySelector(sel) {
                return sel in this._qs ? this._qs[sel] : null;
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
    // v4 task-2 slice C: dead-view mark toggle + dupes-view keeper pin
    el('DIV', 'dead-mark-toggle');
    el('DIV', 'dupes-set-keeper');
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
        addEventListener(type, fn) {
            (windowListeners[type] = windowListeners[type] || []).push(fn);
        }
    };
    const chromeStub = {
        i18n: { getMessage: key => key },
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
        }
    };
    Object.assign(chromeStub.bookmarks.childNodes, opts.children || {});
    globalThis.chrome = chromeStub;

    const actionCalls = [];
    const actions = {};
    for (const name of ['openBookmark', 'openBookmarkNewTab', 'openBookmarkNewWindow',
        'addNewBookmarkNode', 'copyAllTitlesAndUrls', 'replaceUrl', 'openBookmarks',
        'openBookmarksInGroup', 'openBookmarksNewWindow', 'editBookmarkFolder', 'deleteBookmark',
        'deleteBookmarks', 'addSeparator', 'deleteSeparator'])
        actions[name] = (...args) => actionCalls.push([name, ...args]);
    const sortCalls = [];
    const dialogs = { SortDialog: { open: id => sortCalls.push(id) } };
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
        get dupesMenu() { return opts.dupesMenu; }
    });

    // A bookmark row: <li id="neat-tree-item-42" data-parentid="1"><a href></a></li>
    const makeBookmarkRow = (id = '42', parentid = '1') => {
        const li = el('LI', `neat-tree-item-${id}`);
        li.dataset.parentid = parentid;
        const a = el('A');
        a.href = `https://bm-${id}.example/`;
        a.parentNode = li;
        return { li, a };
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
    const menuItem = id => {
        const item = el('DIV', id);
        item.classList.add('menu-item');
        return item;
    };
    const openOn = (target, evProps = {}) =>
        fire(body, 'contextmenu', makeEvent({ target, pageX: 50, pageY: 60, clientY: 60, ...evProps }));

    return {
        menus, byId, el, body, tree, results, viewLists,
        bookmarkMenu, folderMenu, separatorMenu,
        chrome: chromeStub, actionCalls, sortCalls, revealCalls,
        makeBookmarkRow, makeFolderRow, makeSeparatorRow, menuItem, openOn,
        fireWindow: (type, ev) => {
            for (const fn of (windowListeners[type] || []))
                fn(ev);
        }
    };
};

describe('module API', () => {
    it('returns clearMenu/switchBookmarkMenu plus the three menu elements', () => {
        const { menus, bookmarkMenu, folderMenu, separatorMenu } = setup({});
        expect(typeof menus.clearMenu).toBe('function');
        expect(typeof menus.switchBookmarkMenu).toBe('function');
        expect(menus.bookmarkMenu).toBe(bookmarkMenu);
        expect(menus.folderMenu).toBe(folderMenu);
        expect(menus.separatorMenu).toBe(separatorMenu);
        expect(Object.keys(menus).sort()).toEqual(
            ['bookmarkMenu', 'clearMenu', 'folderMenu', 'separatorMenu', 'switchBookmarkMenu']);
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

    it('opens the separator menu on a separator row and hides editables at root', () => {
        const { bookmarkMenu, separatorMenu, makeSeparatorRow, openOn } = setup({});
        const { a } = makeSeparatorRow('30', '0'); // root folder (parentid '0')
        openOn(a);
        expect(separatorMenu.style.opacity).toBe('1');
        expect(separatorMenu.classList.contains('hide-editables')).toBe(true);
        expect(bookmarkMenu.style.opacity).not.toBe('1');
    });

    it('restores editables on a separator row inside a regular folder', () => {
        const { separatorMenu, makeSeparatorRow, openOn } = setup({});
        const { a } = makeSeparatorRow('30', '1');
        separatorMenu.classList.add('hide-editables');
        openOn(a);
        expect(separatorMenu.classList.contains('hide-editables')).toBe(false);
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
        const item = '<div id="open-bookmarks-in-group" class="menu-item" tabindex="-1"></div>';
        const anchor = '<div id="folder-window" class="menu-item" tabindex="-1"></div>';
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
