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
                add: c => classes.add(c),
                remove: c => classes.delete(c),
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

    tree._qs['ul>li:first-child'] = f1.li; // Home
    tree._qs['li:first-child>span'] = f1.link; // activeElement fallback
    tree._qsa['ul>li:last-child'] = [b12.li, b31.li, b4.li]; // End

    // a closed folder, for the open-on-arrow tests
    const f5 = row('SPAN', 'neat-tree-item-5');
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
    const menus = {
        clearMenu: () => clearMenuCalls.push('clear'),
        bookmarkMenu,
        folderMenu,
        separatorMenu
    };
    if (searchHistoryMenu)
        menus.searchHistoryMenu = searchHistoryMenu;
    const closeDialogsCalls = [];
    const dialogs = {
        anyOpen: () => flags.dialogOpen,
        closeDialogs: () => closeDialogsCalls.push('close')
    };

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
        treeUl, f1, b11, b12, b2, f3, b31, b4, f5, r1, r2,
        item1, hr, item2, marker,
        chrome: chromeStub, actionCalls, searchCalls, clearMenuCalls,
        closeDialogsCalls, flags, windowCloseCalls
    };
};

describe('module API', () => {
    it('returns the three handlers and binds every listener', () => {
        const { keyboard, tree, results, bookmarkMenu, folderMenu, separatorMenu, doc } = setup({});
        expect(typeof keyboard.treeKeyDown).toBe('function');
        expect(typeof keyboard.treeKeyUp).toBe('function');
        expect(typeof keyboard.contextKeyDown).toBe('function');
        expect(Object.keys(keyboard).sort()).toEqual(['contextKeyDown', 'treeKeyDown', 'treeKeyUp']);
        expect(tree._listeners.keydown).toHaveLength(1);
        expect(tree._listeners.keyup).toHaveLength(1);
        expect(results._listeners.keydown).toHaveLength(1);
        expect(results._listeners.keyup).toHaveLength(1);
        expect(bookmarkMenu._listeners.keydown).toHaveLength(1);
        expect(folderMenu._listeners.keydown).toHaveLength(1);
        expect(separatorMenu._listeners.keydown).toBeUndefined(); // binding stays commented out
        expect(doc._listeners.keydown).toHaveLength(2); // capture ESC + bubbling Ctrl+F
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
        expect(r2.link.focused).toBe(false);
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

    it('ArrowDown past the last item wraps to the first (off Mac)', () => {
        const { bookmarkMenu, item1, item2, doc } = setup({});
        doc.activeElement = item2;
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowDown' }));
        expect(item1.focused).toBe(true);
    });

    it('ArrowDown past the last item does not wrap on Mac', () => {
        const { bookmarkMenu, item1, item2, doc } = setup({ os: 'mac' });
        doc.activeElement = item2;
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowDown' }));
        expect(item1.focused).toBe(false);
    });

    it('ArrowUp moves to the previous menu item, skipping <hr> separators', () => {
        const { bookmarkMenu, item1, item2, doc } = setup({});
        doc.activeElement = item2;
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowUp' }));
        expect(item1.focused).toBe(true);
    });

    it('ArrowUp past the first item wraps to the last (off Mac)', () => {
        const { bookmarkMenu, item1, item2, doc } = setup({});
        doc.activeElement = item1;
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowUp' }));
        expect(item2.focused).toBe(true);
    });

    it('ArrowUp past the first item does not wrap on Mac', () => {
        const { bookmarkMenu, item1, item2, doc } = setup({ os: 'mac' });
        doc.activeElement = item1;
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowUp' }));
        expect(item2.focused).toBe(false);
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

    it('focuses the first/last item when the menu itself holds focus', () => {
        const { bookmarkMenu, item1, item2, doc } = setup({});
        doc.activeElement = bookmarkMenu; // not a .menu-item
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowDown' }));
        expect(item1.focused).toBe(true);
        doc.activeElement = bookmarkMenu;
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowUp' }));
        expect(item2.focused).toBe(true);
    });

    it('Enter dispatches a mouseup on the focused menu item', () => {
        const { bookmarkMenu, item1, doc } = setup({});
        doc.activeElement = item1;
        const ev = makeEvent({ key: 'Enter' });
        fire(bookmarkMenu, 'keydown', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(item1._dispatched).toHaveLength(1);
        expect(item1._dispatched[0].type).toBe('mouseup');
    });

    it('Space dispatches the same mouseup', () => {
        const { bookmarkMenu, item2, doc } = setup({});
        doc.activeElement = item2;
        fire(bookmarkMenu, 'keydown', makeEvent({ key: ' ' }));
        expect(item2._dispatched).toHaveLength(1);
        expect(item2._dispatched[0].type).toBe('mouseup');
    });

    it('Escape unmarks and refocuses the active row, then clears the menu', () => {
        const { bookmarkMenu, item1, doc, clearMenuCalls, row } = setup({});
        const active = row('A', 'neat-tree-item-42');
        active.link.classList.add('active');
        doc.activeElement = item1;
        const ev = makeEvent({ key: 'Escape' });
        fire(bookmarkMenu, 'keydown', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(active.link.classList.contains('active')).toBe(false);
        expect(active.link.focused).toBe(true);
        expect(clearMenuCalls).toEqual(['clear']);
    });

    it('Escape still clears the menu when no row is active', () => {
        const { bookmarkMenu, item1, doc, clearMenuCalls } = setup({});
        doc.activeElement = item1;
        fire(bookmarkMenu, 'keydown', makeEvent({ key: 'Escape' }));
        expect(clearMenuCalls).toEqual(['clear']);
    });

    it('ArrowLeft closes the menu in ltr but not in rtl', () => {
        const ltr = setup({});
        const activeLtr = ltr.row('A', 'neat-tree-item-42');
        activeLtr.link.classList.add('active');
        ltr.doc.activeElement = ltr.item1;
        fire(ltr.bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowLeft' }));
        expect(ltr.clearMenuCalls).toEqual(['clear']);
        expect(activeLtr.link.classList.contains('active')).toBe(false);

        const rtl = setup({ rtl: true });
        rtl.doc.activeElement = rtl.item1;
        const ev = makeEvent({ key: 'ArrowLeft' });
        fire(rtl.bookmarkMenu, 'keydown', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(rtl.clearMenuCalls).toEqual([]);
    });

    it('ArrowRight closes the menu in rtl but not in ltr', () => {
        const rtl = setup({ rtl: true });
        const activeRtl = rtl.row('A', 'neat-tree-item-42');
        activeRtl.link.classList.add('active');
        rtl.doc.activeElement = rtl.item1;
        fire(rtl.bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowRight' }));
        expect(rtl.clearMenuCalls).toEqual(['clear']);
        expect(activeRtl.link.classList.contains('active')).toBe(false);

        const ltr = setup({});
        ltr.doc.activeElement = ltr.item1;
        fire(ltr.bookmarkMenu, 'keydown', makeEvent({ key: 'ArrowRight' }));
        expect(ltr.clearMenuCalls).toEqual([]);
    });

    it('is also bound on the folder menu', () => {
        const { folderMenu, item1, doc, clearMenuCalls } = setup({});
        doc.activeElement = item1;
        fire(folderMenu, 'keydown', makeEvent({ key: 'Escape' }));
        expect(clearMenuCalls).toEqual(['clear']);
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
describe('in-list toolbar controls (item 7b)', () => {
    // A stats-like view: #stats-list containing a toolbar BUTTON and two
    // bookmark rows, registered next to the tree in the view registry.
    const setupStatsList = () => {
        const bag = {};
        const ctx = setup({
            views: ({ tree, el }) => {
                const listEl = el('DIV', 'stats-list');
                const btn = el('BUTTON', 'seg-btn');
                btn.parentNode = listEl;
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
                listEl._qs['ul>li:first-child'] = r1.li;
                Object.assign(bag, { listEl, btn, r1, r2 });
                const statsEntry = { id: 'stats', el: listEl, typeAhead: false };
                return {
                    lists: () => [
                        { id: 'tree', el: tree, typeAhead: true },
                        statsEntry
                    ],
                    listOf: el2 => (el2 === listEl ? statsEntry : null),
                    onEscapeActive: () => false,
                    escapeToTree: () => false,
                    focusTop: () => {},
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

    it('ArrowDown on a toolbar button jumps into THIS list\'s first row, never the tree\'s', () => {
        const { ctx, listEl, btn, r1 } = setupStatsList();
        ctx.doc.activeElement = btn;
        const ev = makeEvent({ key: 'ArrowDown' });
        fire(listEl, 'keydown', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(r1.a.focused).toBe(true);
        expect(ctx.f1.link.focused).toBe(false);
    });

    it('ArrowUp on a toolbar button jumps to this list\'s last row', () => {
        const { ctx, listEl, btn, r2 } = setupStatsList();
        ctx.doc.activeElement = btn;
        fire(listEl, 'keydown', makeEvent({ key: 'ArrowUp' }));
        expect(r2.a.focused).toBe(true);
        expect(ctx.f1.link.focused).toBe(false);
    });

    it('Home on a toolbar button falls through to the container case (first row)', () => {
        const { ctx, listEl, btn, r1 } = setupStatsList();
        ctx.doc.activeElement = btn;
        fire(listEl, 'keydown', makeEvent({ key: 'Home' }));
        expect(r1.a.focused).toBe(true);
        expect(ctx.f1.link.focused).toBe(false);
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
        ctx.searchInput.value = 'query';
        const ev = makeEvent({ key: 'Escape' });
        ctx.fireDoc('keydown', ev);
        expect(active.link.classList.contains('active')).toBe(false);
        expect(active.link.focused).toBe(true);
        expect(ctx.clearMenuCalls).toEqual(['clear']);
        expect(ctx.searchCalls).toEqual([]); // the search clear is not reached
        expect(ctx.searchInput.value).toBe('query');
        expect(ctx.windowCloseCalls).toEqual([]);
    });

    it('the palette rung closes the panel before the view/search rungs', () => {
        const calls = [];
        const palette = { isOpen: () => true, close: () => calls.push('close') };
        const ctx = setup({ palette, searchActive: true });
        ctx.searchInput.value = 'query';
        const ev = makeEvent({ key: 'Escape' });
        ctx.fireDoc('keydown', ev);
        expect(calls).toEqual(['close']);
        expect(ctx.searchCalls).toEqual([]);
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
        expect(ctx.clearMenuCalls).toEqual(['clear']);
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
