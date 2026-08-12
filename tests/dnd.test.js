import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// dnd.js touches page globals (document/window/chrome/getComputedStyle/
// setInterval) only inside initDnd, so the real module imports cleanly in
// node once the globals are stubbed. Blocked drops surface through the
// on-demand #notice-toast element appended to body (no more alert()). ctx.tree is an element stub wired into a
// small fake tree (a plain bookmark, a folder with a <ul> child list, a root
// folder, a recent-section virtual entry); store/resetSeparator are injected
// doubles; chrome.bookmarks.get/move is a recording double fed from a node
// table. Assertions target the DOM-event contract (which listeners fire, what
// the clone/overlay show, which chrome calls land) and the returned
// { isDragging, consumeNoOpen } API — nothing is copied from the module body.

const makeEvent = (props = {}) => {
    const ev = {
        defaultPrevented: false,
        preventDefault() {
            ev.defaultPrevented = true;
        },
        ...props
    };
    return ev;
};

const fire = (el, type, ev) => {
    for (const fn of (el._listeners[type] || []))
        fn.call(el, ev); // a listener's `this` is the element it is bound to
};

let initDnd;
let intervals;
let clearedIntervals;
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;

beforeAll(async () => {
    globalThis.setInterval = (fn, ms) => {
        intervals.push([fn, ms]);
        return intervals.length;
    };
    globalThis.clearInterval = id => {
        clearedIntervals.push(id);
    };
    globalThis.getComputedStyle = el => el._computed || { width: '0px' };
    ({ initDnd } = await import('../src/dnd.js'));
});

beforeEach(() => {
    intervals = [];
    clearedIntervals = [];
});

afterAll(() => {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
    delete globalThis.getComputedStyle;
});

const setup = (opts = {}) => {
    const byId = {};
    const el = (tagName = 'DIV', id = '') => {
        const classes = new Set();
        const node = {
            tagName,
            id,
            className: '',
            innerHTML: '',
            textContent: '',
            style: {},
            dataset: {},
            parentNode: null,
            focused: false,
            removed: false,
            offsetTop: 0,
            offsetWidth: 0,
            offsetHeight: 0,
            scrollTop: 0,
            scrollHeight: 0,
            _attrs: {},
            _qs: {},
            _listeners: {},
            _appended: [],
            _inserted: [],
            _scrolled: [],
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
            getBoundingClientRect() {
                return this._rect || { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
            },
            setAttribute(k, v) {
                this._attrs[k] = v;
            },
            getAttribute(k) {
                return k in this._attrs ? this._attrs[k] : null;
            },
            insertAdjacentElement(position, element) {
                this._inserted.push([position, element]);
            },
            appendChild(child) {
                this._appended.push(child);
            },
            remove() {
                this.removed = true;
            },
            scrollBy(x, y) {
                this._scrolled.push([x, y]);
            },
            focus() {
                this.focused = true;
            }
        };
        if (id)
            byId[id] = node;
        return node;
    };

    const body = el('BODY', 'body');
    body.scrollTop = 0;
    const tree = el('DIV', 'tree');
    tree.offsetTop = 0;
    tree.offsetWidth = 300;
    const bookmarkClone = el('DIV', 'bookmark-clone');
    const dropOverlay = el('DIV', 'drop-overlay');

    const doc = {
        _listeners: {},
        body,
        getElementById: id => byId[id] || null,
        createElement: tag => el(tag.toUpperCase()),
        addEventListener(type, fn) {
            (this._listeners[type] = this._listeners[type] || []).push(fn);
        }
    };
    globalThis.document = doc;
    globalThis.window = {
        innerHeight: opts.innerHeight === undefined ? 600 : opts.innerHeight
    };

    // chrome.bookmarks node table: id -> { parentId, index, syncing }
    const nodes = opts.nodes || {};
    const chromeStub = {
        i18n: { getMessage: () => opts.i18nMessage || '' },
        bookmarks: {
            getCalls: [],
            moveCalls: [],
            get(id, cb) {
                this.getCalls.push(id);
                cb(nodes[id] ? [nodes[id]] : []);
            },
            move(id, destination, cb) {
                this.moveCalls.push([id, destination]);
                if (cb)
                    cb();
            }
        }
    };
    globalThis.chrome = chromeStub;

    const sepCalls = [];
    const resetSeparator = () => sepCalls.push(1);
    const store = {
        _zoom: opts.zoom,
        get: k => (k === 'zoom' ? store._zoom : undefined),
        set: (k, v) => {
            if (k === 'zoom') store._zoom = v;
        }
    };

    const dnd = initDnd({ tree, store, rtl: !!opts.rtl, resetSeparator });

    // A bookmark row: <li id="neat-tree-item-N" class="child"><a></a></li>
    const makeBookmark = (id, parentid = '1') => {
        const li = el('LI', `neat-tree-item-${id}`);
        li.classList.add('child');
        li.dataset.parentid = parentid;
        const a = el('A');
        a.parentNode = li;
        a.innerHTML = `bm-${id}`;
        return { li, a };
    };
    // A folder row: <li id="neat-tree-item-N" class="parent"><span></span></li>
    const makeFolder = (id, parentid = '1', folderOpts = {}) => {
        const li = el('LI', `neat-tree-item-${id}`);
        li.classList.add('parent');
        li.dataset.parentid = parentid;
        if (folderOpts.root)
            li.dataset.parentid = '0';
        if (folderOpts.folderType)
            li.dataset.foldertype = folderOpts.folderType;
        if (folderOpts.open)
            li.classList.add('open');
        const span = el('SPAN');
        span.parentNode = li;
        span.innerHTML = `folder-${id}`;
        return { li, span };
    };

    // Event helpers: drags always go mousedown (tree) -> mousemove/mouseup (document)
    const startDrag = (target, evProps = {}) =>
        fire(tree, 'mousedown', makeEvent({ button: 0, target, ...evProps }));
    const move = (target, clientX, clientY, evProps = {}) =>
        fire(doc, 'mousemove', makeEvent({ button: 0, target, clientX, clientY, ...evProps }));
    const up = (target, clientX, clientY, evProps = {}) =>
        fire(doc, 'mouseup', makeEvent({ button: 0, target, clientX, clientY, ...evProps }));

    return {
        dnd, el, byId, doc, body, tree, bookmarkClone, dropOverlay,
        chrome: chromeStub, sepCalls, resetSeparator, store,
        makeBookmark, makeFolder, startDrag, move, up
    };
};

// The blocked-drop toast is created on demand and appended to <body>;
// null means no toast was shown.
const toastText = ctx => {
    const toast = ctx.body._appended.find(n => n.id === 'notice-toast');
    return toast ? toast.textContent : null;
};

describe('module API', () => {
    it('returns isDragging/consumeNoOpen, both idle before any drag', () => {
        const { dnd } = setup({});
        expect(Object.keys(dnd).sort()).toEqual(['consumeNoOpen', 'isDragging']);
        expect(dnd.isDragging()).toBe(false);
        expect(dnd.consumeNoOpen()).toBe(false);
    });
});

describe('mousedown (drag start)', () => {
    it('starts a drag on a bookmark link: clone filled, link focused, event eaten', () => {
        const { dnd, tree, bookmarkClone, makeBookmark } = setup({});
        const { a } = makeBookmark('11');
        const ev = makeEvent({ button: 0, target: a });
        fire(tree, 'mousedown', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(dnd.isDragging()).toBe(true);
        expect(bookmarkClone.innerHTML).toBe('bm-11');
        expect(a.focused).toBe(true);
    });

    it('only the left button starts a drag', () => {
        const { dnd, makeBookmark, startDrag } = setup({});
        const { a } = makeBookmark('11');
        startDrag(a, { button: 2 });
        expect(dnd.isDragging()).toBe(false);
    });

    it('starts a drag on a non-root folder span', () => {
        const { dnd, bookmarkClone, makeFolder, startDrag } = setup({});
        const { span } = makeFolder('7');
        startDrag(span);
        expect(dnd.isDragging()).toBe(true);
        expect(bookmarkClone.innerHTML).toBe('folder-7');
    });

    it('refuses to drag a root folder (data-parentid="0")', () => {
        const { dnd, makeFolder, startDrag } = setup({});
        const { span } = makeFolder('7', '1', { root: true });
        startDrag(span);
        expect(dnd.isDragging()).toBe(false);
    });

    it('refuses to drag a root folder tagged via data-foldertype', () => {
        const { dnd, makeFolder, startDrag } = setup({});
        const { span } = makeFolder('7', '1', { folderType: 'bookmarks-bar' });
        startDrag(span);
        expect(dnd.isDragging()).toBe(false);
    });

    it('refuses to drag recent-section virtual entries', () => {
        const { dnd, makeBookmark, startDrag } = setup({});
        const { a } = makeBookmark('11');
        a.dataset.virtual = '1';
        startDrag(a);
        expect(dnd.isDragging()).toBe(false);
    });

    it('normalizes an <hr> target to its parent <a>', () => {
        const { dnd, bookmarkClone, el, makeBookmark, startDrag } = setup({});
        const { a } = makeBookmark('30');
        const hr = el('HR');
        hr.parentNode = a;
        startDrag(hr);
        expect(dnd.isDragging()).toBe(true);
        expect(bookmarkClone.innerHTML).toBe('bm-30'); // the <a>, not the <hr>
    });

    it('ignores mousedown on a non-row target', () => {
        const { dnd, tree, startDrag } = setup({});
        startDrag(tree);
        expect(dnd.isDragging()).toBe(false);
    });
});

describe('mousemove (drop-target tracking)', () => {
    it('does nothing when no drag is in progress', () => {
        const { doc, bookmarkClone, dropOverlay, makeBookmark } = setup({});
        const { a } = makeBookmark('2');
        const ev = makeEvent({ button: 0, target: a, clientX: 50, clientY: 50 });
        fire(doc, 'mousemove', ev);
        expect(ev.defaultPrevented).toBe(false);
        expect(bookmarkClone.style.left).toBe(undefined);
        expect(dropOverlay.style.left).toBe(undefined);
    });

    it('hides clone and overlay while hovering the dragged element itself', () => {
        const { dnd, bookmarkClone, dropOverlay, makeBookmark, startDrag, move } = setup({});
        const { a } = makeBookmark('11');
        startDrag(a);
        move(a, 50, 50);
        expect(bookmarkClone.style.left).toBe('-999px');
        expect(dropOverlay.style.left).toBe('-999px');
        expect(dnd.isDragging()).toBe(true); // drag still on
    });

    it('marks the drop invalid when the cursor leaves the tree bounds', () => {
        const { tree, dropOverlay, makeBookmark, startDrag, move } = setup({});
        const { a } = makeBookmark('11');
        startDrag(a);
        move(tree, 50, 700); // below window.innerHeight 600, over no row
        expect(dropOverlay.style.left).toBe('-999px');
    });

    it('shows a bookmark insert line above the target on the top half', () => {
        const { dropOverlay, makeBookmark, startDrag, move } = setup({});
        const dragged = makeBookmark('11');
        const target = makeBookmark('2');
        target.a._rect = { top: 100, bottom: 120, height: 20, width: 200 };
        target.a.style.webkitPaddingStart = '16px';
        target.a._computed = { width: '200px' };
        startDrag(dragged.a);
        move(target.a, 50, 105); // < 100 + 20/2
        expect(dropOverlay.className).toBe('bookmark');
        expect(dropOverlay.style.top).toBe('100px');
        expect(dropOverlay.style.left).toBe('32px'); // 16 + 16
        expect(dropOverlay.style.width).toBe('188px'); // 200 - 12
        expect(dropOverlay.style.height).toBe(null);
    });

    it('shows a bookmark insert line below the target on the bottom half', () => {
        const { dropOverlay, makeBookmark, startDrag, move } = setup({});
        const dragged = makeBookmark('11');
        const target = makeBookmark('2');
        target.a._rect = { top: 100, bottom: 120, height: 20, width: 200 };
        startDrag(dragged.a);
        move(target.a, 50, 115); // >= 100 + 20/2
        expect(dropOverlay.className).toBe('bookmark');
        expect(dropOverlay.style.top).toBe('120px');
    });

    it('anchors the overlay to the left edge and the clone left of the cursor in rtl', () => {
        const { bookmarkClone, dropOverlay, makeBookmark, startDrag, move } = setup({ rtl: true });
        bookmarkClone.offsetWidth = 30;
        const dragged = makeBookmark('11');
        const target = makeBookmark('2');
        target.a._rect = { top: 100, bottom: 120, height: 20, width: 200 };
        startDrag(dragged.a);
        move(target.a, 50, 115);
        expect(dropOverlay.style.left).toBe('0px');
        expect(bookmarkClone.style.left).toBe('20px'); // 50 - 30
    });

    it('highlights a folder when hovering its middle zone', () => {
        const { dropOverlay, makeBookmark, makeFolder, startDrag, move } = setup({});
        const dragged = makeBookmark('11');
        const folder = makeFolder('7');
        folder.span._rect = { top: 200, bottom: 220, height: 20, width: 250 };
        startDrag(dragged.a);
        move(folder.span, 50, 210); // between 30% and 70%
        expect(dropOverlay.className).toBe('folder');
        expect(dropOverlay.style.top).toBe('200px');
        expect(dropOverlay.style.left).toBe('0px');
        expect(dropOverlay.style.width).toBe('250px');
        expect(dropOverlay.style.height).toBe('20px');
    });

    it('shows an insert line above a folder in its top 30%', () => {
        const { dropOverlay, makeBookmark, makeFolder, startDrag, move } = setup({});
        const dragged = makeBookmark('11');
        const folder = makeFolder('7');
        folder.span._rect = { top: 200, bottom: 220, height: 20, width: 250 };
        startDrag(dragged.a);
        move(folder.span, 50, 205); // < 200 + 20*0.3
        expect(dropOverlay.className).toBe('bookmark');
        expect(dropOverlay.style.top).toBe('200px');
    });

    it('shows an insert line below a closed folder in its bottom 30%', () => {
        const { dropOverlay, makeBookmark, makeFolder, startDrag, move } = setup({});
        const dragged = makeBookmark('11');
        const folder = makeFolder('7');
        folder.span._rect = { top: 200, bottom: 220, height: 20, width: 250 };
        startDrag(dragged.a);
        move(folder.span, 50, 215); // > 200 + 20*0.7
        expect(dropOverlay.className).toBe('bookmark');
        expect(dropOverlay.style.top).toBe('220px');
    });

    it('keeps the folder highlight in the bottom 30% when the folder is open', () => {
        const { dropOverlay, makeBookmark, makeFolder, startDrag, move } = setup({});
        const dragged = makeBookmark('11');
        const folder = makeFolder('7', '1', { open: true });
        folder.span._rect = { top: 200, bottom: 220, height: 20, width: 250 };
        startDrag(dragged.a);
        move(folder.span, 50, 215);
        expect(dropOverlay.className).toBe('folder');
    });

    it('always highlights a root folder, never an insert line', () => {
        const { dropOverlay, makeBookmark, makeFolder, startDrag, move } = setup({});
        const dragged = makeBookmark('11');
        const root = makeFolder('1', '1', { root: true });
        root.span._rect = { top: 200, bottom: 220, height: 20, width: 250 };
        startDrag(dragged.a);
        move(root.span, 50, 205); // top zone, but root skips the zone math
        expect(dropOverlay.className).toBe('folder');
    });

    it('collapses an open folder as soon as it starts moving', () => {
        const { makeBookmark, makeFolder, startDrag, move } = setup({});
        const folder = makeFolder('7', '1', { open: true });
        const target = makeBookmark('2');
        target.a._rect = { top: 100, bottom: 120, height: 20, width: 200 };
        startDrag(folder.span);
        move(target.a, 50, 105);
        expect(folder.li.classList.contains('open')).toBe(false);
        expect(folder.li._attrs['aria-expanded']).toBe(false);
    });

    it('rejects recent-section entries as drop targets', () => {
        const { dropOverlay, makeBookmark, startDrag, move } = setup({});
        const dragged = makeBookmark('11');
        const virtual = makeBookmark('2');
        virtual.a.dataset.virtual = '1';
        startDrag(dragged.a);
        move(virtual.a, 50, 100);
        expect(dropOverlay.style.left).toBe('-999px');
    });

    it('auto-scrolls up near the top edge and stops the scroll on mouseup', () => {
        const ctx = setup({});
        ctx.tree.scrollHeight = 1000;
        ctx.tree.offsetHeight = 200;
        ctx.tree.scrollTop = 50;
        const dragged = ctx.makeBookmark('11');
        const target = ctx.makeBookmark('2');
        target.a._rect = { top: 100, bottom: 120, height: 20, width: 200 };
        ctx.startDrag(dragged.a);
        ctx.move(target.a, 50, 5); // <= treeTop + 10
        expect(intervals).toHaveLength(1);
        expect(intervals[0][1]).toBe(100);
        intervals[0][0](); // one scroll tick
        expect(ctx.tree._scrolled).toEqual([[0, -10]]);
        expect(ctx.dropOverlay.style.left).toBe('-999px');
        ctx.up(target.a, 50, 105);
        expect(clearedIntervals).toEqual([1]);
    });

    it('auto-scrolls down near the bottom edge', () => {
        const ctx = setup({});
        ctx.tree.scrollHeight = 1000;
        ctx.tree.offsetHeight = 200;
        ctx.tree.scrollTop = 50; // < 1000 - 200, so scrolling can continue
        const dragged = ctx.makeBookmark('11');
        const target = ctx.makeBookmark('2');
        target.a._rect = { top: 100, bottom: 120, height: 20, width: 200 };
        ctx.startDrag(dragged.a);
        ctx.move(target.a, 50, 595); // >= innerHeight 600 - 10
        expect(intervals).toHaveLength(1);
        intervals[0][0]();
        expect(ctx.tree._scrolled).toEqual([[0, 10]]);
    });

    it('divides the cursor coordinates by the zoom level', () => {
        const ctx = setup({ zoom: '120' });
        const dragged = ctx.makeBookmark('11');
        const target = ctx.makeBookmark('2');
        target.a._rect = { top: 100, bottom: 120, height: 20, width: 200 };
        ctx.startDrag(dragged.a); // zoom is read at drag start
        ctx.move(target.a, 120, 240);
        expect(ctx.bookmarkClone.style.left).toBe('100px'); // 120 / 1.2
        expect(ctx.bookmarkClone.style.top).toBe('200px'); // 240 / 1.2
    });
});

describe('mouseup (drop on a bookmark)', () => {
    // dragged '11' lives in folder '1' (synced); target '2' sits at index 3
    // in the same folder.
    const nodes = {
        '11': { id: '11', parentId: '1', index: 0 },
        '1': { id: '1', syncing: true },
        '2': { id: '2', parentId: '1', index: 3 }
    };

    it('moves before the target on the top half and re-inserts the row before it', () => {
        const ctx = setup({ nodes });
        const dragged = ctx.makeBookmark('11');
        const target = ctx.makeBookmark('2');
        target.a._rect = { top: 100, bottom: 120, height: 20, width: 200 };
        target.a.style.webkitPaddingStart = '28px';
        target.li._attrs.level = '2';
        target.li._attrs['data-parentid'] = '1';
        ctx.startDrag(dragged.a);
        ctx.move(target.a, 50, 105);
        ctx.up(target.a, 50, 105);
        expect(ctx.chrome.bookmarks.moveCalls).toEqual([['11', { parentId: '1', index: 3 }]]);
        expect(target.li._inserted).toEqual([['beforebegin', dragged.li]]);
        expect(dragged.a.style.webkitPaddingStart).toBe('28px'); // copied from target
        expect(dragged.li._attrs.level).toBe('2');
        expect(dragged.li._attrs['data-parentid']).toBe('1');
        expect(dragged.a.focused).toBe(true);
        expect(ctx.sepCalls).toHaveLength(1);
        expect(ctx.dnd.isDragging()).toBe(false);
    });

    it('moves after the target on the bottom half (index + 1)', () => {
        const ctx = setup({ nodes });
        const dragged = ctx.makeBookmark('11');
        const target = ctx.makeBookmark('2');
        target.a._rect = { top: 100, bottom: 120, height: 20, width: 200 };
        ctx.startDrag(dragged.a);
        ctx.move(target.a, 50, 115);
        ctx.up(target.a, 50, 115);
        expect(ctx.chrome.bookmarks.moveCalls).toEqual([['11', { parentId: '1', index: 4 }]]);
        expect(target.li._inserted).toEqual([['afterend', dragged.li]]);
    });

    it('looks the target up through chrome.bookmarks.get before moving', () => {
        const ctx = setup({ nodes });
        const dragged = ctx.makeBookmark('11');
        const target = ctx.makeBookmark('2');
        target.a._rect = { top: 100, bottom: 120, height: 20, width: 200 };
        ctx.startDrag(dragged.a);
        ctx.move(target.a, 50, 105);
        ctx.up(target.a, 50, 105);
        // target, then the canMoveBetweenStorage chain: dragged, its parent, target parent
        expect(ctx.chrome.bookmarks.getCalls).toEqual(['2', '11', '1', '1']);
    });

    it('normalizes an <hr> drop target to its parent <a>', () => {
        const ctx = setup({ nodes });
        const dragged = ctx.makeBookmark('11');
        const target = ctx.makeBookmark('2');
        target.a._rect = { top: 100, bottom: 120, height: 20, width: 200 };
        const hr = ctx.el('HR');
        hr.parentNode = target.a;
        ctx.startDrag(dragged.a);
        ctx.move(target.a, 50, 105);
        ctx.up(hr, 50, 105);
        expect(ctx.chrome.bookmarks.moveCalls).toEqual([['11', { parentId: '1', index: 3 }]]);
    });

    it('does not move when the target id is unknown to chrome.bookmarks', () => {
        const ctx = setup({ nodes });
        const dragged = ctx.makeBookmark('11');
        const target = ctx.makeBookmark('99'); // not in the node table
        target.a._rect = { top: 100, bottom: 120, height: 20, width: 200 };
        ctx.startDrag(dragged.a);
        ctx.move(target.a, 50, 105);
        ctx.up(target.a, 50, 105);
        expect(ctx.chrome.bookmarks.moveCalls).toEqual([]);
    });
});

describe('mouseup (drop on a folder)', () => {
    // dragged '11' from synced folder '1'; folder '7' (also synced) has a <ul>
    // with a stale "(Empty)" marker row.
    const nodes = {
        '11': { id: '11', parentId: '1', index: 0 },
        '1': { id: '1', syncing: true },
        '7': { id: '7', parentId: '1', index: 2, syncing: true }
    };
    const folderSetup = ctx => {
        const dragged = ctx.makeBookmark('11');
        const folder = ctx.makeFolder('7');
        folder.span._rect = { top: 200, bottom: 220, height: 20, width: 250 };
        const wrapUl = ctx.el('UL'); // the list the folder row sits in
        wrapUl.dataset.level = '0';
        folder.li.parentNode = wrapUl;
        folder.li._attrs.level = '1';
        const ul = ctx.el('UL'); // the folder's own child list
        const emptyRow = ctx.el('LI');
        emptyRow.classList.add('empty-folder');
        ul._qs[':scope > li.empty-folder'] = emptyRow;
        folder.li._qs['ul'] = ul;
        return { dragged, folder, ul, emptyRow };
    };

    it('drop in the middle moves into the folder and appends the row to its list', () => {
        const ctx = setup({ nodes });
        const { dragged, folder, ul, emptyRow } = folderSetup(ctx);
        ctx.startDrag(dragged.a);
        ctx.move(folder.span, 50, 210);
        ctx.up(folder.span, 50, 210);
        expect(ctx.chrome.bookmarks.moveCalls).toEqual([['11', { parentId: '7' }]]);
        expect(emptyRow.removed).toBe(true); // stale "(Empty)" marker dropped
        expect(ul._appended).toEqual([dragged.li]);
        expect(dragged.a.style.webkitPaddingStart).toBe('24px'); // TREE_INDENT * (0 + 1)
        expect(dragged.li._attrs.level).toBe(2); // folder level 1 + 1
        expect(dragged.li._attrs['data-parentid']).toBe('7');
        expect(folder.span.focused).toBe(true);
        expect(ctx.sepCalls).toHaveLength(1);
    });

    it('drop in the middle removes the row outright when the folder has no list', () => {
        const ctx = setup({ nodes });
        const { dragged, folder } = folderSetup(ctx);
        folder.li._qs['ul'] = null;
        ctx.startDrag(dragged.a);
        ctx.move(folder.span, 50, 210);
        ctx.up(folder.span, 50, 210);
        expect(ctx.chrome.bookmarks.moveCalls).toEqual([['11', { parentId: '7' }]]);
        expect(dragged.li.removed).toBe(true);
    });

    it('drop in the top zone moves next to the folder instead of into it', () => {
        const ctx = setup({ nodes });
        const { dragged, folder } = folderSetup(ctx);
        ctx.startDrag(dragged.a);
        ctx.move(folder.span, 50, 205);
        ctx.up(folder.span, 50, 205);
        // folder '7' sits at index 2 in folder '1': insert before it
        expect(ctx.chrome.bookmarks.moveCalls).toEqual([['11', { parentId: '1', index: 2 }]]);
        expect(folder.li._inserted).toEqual([['beforebegin', dragged.li]]);
    });

    it('drop in the bottom zone of a closed folder moves after it', () => {
        const ctx = setup({ nodes });
        const { dragged, folder } = folderSetup(ctx);
        ctx.startDrag(dragged.a);
        ctx.move(folder.span, 50, 215);
        ctx.up(folder.span, 50, 215);
        expect(ctx.chrome.bookmarks.moveCalls).toEqual([['11', { parentId: '1', index: 3 }]]);
        expect(folder.li._inserted).toEqual([['afterend', dragged.li]]);
    });
});

describe('cross-storage moves', () => {
    it('shows a toast and does not move when dropping next to an unsynced bookmark', () => {
        const ctx = setup({
            nodes: {
                '11': { id: '11', parentId: '1', index: 0 },
                '1': { id: '1', syncing: true },
                '5': { id: '5', parentId: '9', index: 0 },
                '9': { id: '9', syncing: false } // local storage vs synced source
            }
        });
        const dragged = ctx.makeBookmark('11');
        const target = ctx.makeBookmark('5');
        target.a._rect = { top: 100, bottom: 120, height: 20, width: 200 };
        ctx.startDrag(dragged.a);
        ctx.move(target.a, 50, 105);
        ctx.up(target.a, 50, 105);
        expect(toastText(ctx)).toBe('Cannot move bookmarks between synced and local storage.');
        expect(ctx.chrome.bookmarks.moveCalls).toEqual([]);
        expect(ctx.sepCalls).toHaveLength(1); // onDrop still cleans up
        expect(ctx.dnd.isDragging()).toBe(false);
    });

    it('toasts with the i18n message when dropping into an unsynced folder', () => {
        const ctx = setup({
            i18nMessage: '不能跨存储移动书签',
            nodes: {
                '11': { id: '11', parentId: '1', index: 0 },
                '1': { id: '1', syncing: true },
                '8': { id: '8', parentId: '9', index: 0, syncing: false }
            }
        });
        const dragged = ctx.makeBookmark('11');
        const folder = ctx.makeFolder('8');
        folder.span._rect = { top: 200, bottom: 220, height: 20, width: 250 };
        const wrapUl = ctx.el('UL');
        wrapUl.dataset.level = '0';
        folder.li.parentNode = wrapUl;
        ctx.startDrag(dragged.a);
        ctx.move(folder.span, 50, 210);
        ctx.up(folder.span, 50, 210);
        expect(toastText(ctx)).toBe('不能跨存储移动书签');
        expect(ctx.chrome.bookmarks.moveCalls).toEqual([]);
    });

    it('allows the move when either side carries no sync info', () => {
        const ctx = setup({
            nodes: {
                '11': { id: '11', parentId: '1', index: 0 },
                '1': { id: '1' }, // no syncing field: old Chrome / no sync
                '2': { id: '2', parentId: '1', index: 3 }
            }
        });
        const dragged = ctx.makeBookmark('11');
        const target = ctx.makeBookmark('2');
        target.a._rect = { top: 100, bottom: 120, height: 20, width: 200 };
        ctx.startDrag(dragged.a);
        ctx.move(target.a, 50, 105);
        ctx.up(target.a, 50, 105);
        expect(toastText(ctx)).toBe(null);
        expect(ctx.chrome.bookmarks.moveCalls).toEqual([['11', { parentId: '1', index: 3 }]]);
    });
});

describe('drop bail-out and the no-open flag', () => {
    it('mouseup without a drag does nothing at all', () => {
        const ctx = setup({});
        const target = ctx.makeBookmark('2');
        ctx.up(target.a, 50, 50);
        expect(ctx.sepCalls).toEqual([]);
        expect(ctx.chrome.bookmarks.getCalls).toEqual([]);
        expect(ctx.dnd.consumeNoOpen()).toBe(false);
    });

    it('a right-button mouseup does not end the drag', () => {
        const ctx = setup({});
        const dragged = ctx.makeBookmark('11');
        ctx.startDrag(dragged.a);
        ctx.up(dragged.a, 50, 50, { button: 2 });
        expect(ctx.dnd.isDragging()).toBe(true);
        expect(ctx.sepCalls).toEqual([]);
    });

    it('an invalid drop after dragging out swallows exactly one click', () => {
        const ctx = setup({});
        const dragged = ctx.makeBookmark('11');
        ctx.startDrag(dragged.a);
        ctx.move(ctx.tree, 50, 700); // out of bounds: canDrop false, draggedOut true
        ctx.up(ctx.tree, 50, 700);
        expect(ctx.chrome.bookmarks.getCalls).toEqual([]);
        expect(ctx.sepCalls).toHaveLength(1); // onDrop ran
        expect(ctx.dnd.isDragging()).toBe(false);
        expect(ctx.dnd.consumeNoOpen()).toBe(true); // the click after the drag is eaten
        expect(ctx.dnd.consumeNoOpen()).toBe(false); // ... but only once
        expect(ctx.dnd.consumeNoOpen()).toBe(false);
    });

    it('an invalid drop without dragging out does not swallow the click', () => {
        const ctx = setup({});
        const dragged = ctx.makeBookmark('11');
        ctx.startDrag(dragged.a);
        ctx.up(dragged.a, 50, 50); // released over itself, never dragged out
        expect(ctx.sepCalls).toHaveLength(1);
        expect(ctx.dnd.consumeNoOpen()).toBe(false);
    });
});

describe('zoom-level drag positioning (issue #59)', () => {
    it('positions the bookmark insert line in layout coords under zoom', () => {
        const ctx = setup({ zoom: '120' });
        const dragged = ctx.makeBookmark('11');
        const target = ctx.makeBookmark('2');
        // _rect is a viewport (post-zoom) rect; layout = _rect / 1.2
        target.a._rect = { top: 120, bottom: 144, height: 24, width: 200 };
        ctx.startDrag(dragged.a);
        ctx.move(target.a, 60, 240); // layout cursor 50, 200 → past the row's layout midpoint
        // layout midpoint = 100 + (24/1.2)/2 = 110 → line at the row bottom (layout 120),
        // NOT the raw viewport bottom (144) a non-scaled elRect would produce
        expect(ctx.dropOverlay.style.top).toBe('120px');
        expect(ctx.dropOverlay.className).toBe('bookmark');
    });

    it('drops below a bookmark under zoom, matching the unzoomed behavior', () => {
        const nodes = {
            '11': { id: '11', parentId: '1', index: 0 },
            '1': { id: '1', syncing: true },
            '2': { id: '2', parentId: '1', index: 3 }
        };
        const ctx = setup({ zoom: '120', nodes });
        const dragged = ctx.makeBookmark('11');
        const target = ctx.makeBookmark('2');
        target.a._rect = { top: 120, bottom: 144, height: 24, width: 200 };
        ctx.startDrag(dragged.a);
        // layout cursor 115 → bottom half (>= 100 + 24/1.2/2 = 110) → after the target
        ctx.move(target.a, 60, 138);
        ctx.up(target.a, 60, 138);
        expect(ctx.chrome.bookmarks.moveCalls).toEqual([['11', { parentId: '1', index: 4 }]]);
        expect(target.li._inserted).toEqual([['afterend', dragged.li]]);
    });

    it('sizes the folder drop overlay in layout coords and drops inside under zoom', () => {
        const nodes = {
            '11': { id: '11', parentId: '1', index: 0 },
            '1': { id: '1', syncing: true },
            '5': { id: '5', parentId: '1', index: 2 }
        };
        const ctx = setup({ zoom: '120', nodes });
        const dragged = ctx.makeBookmark('11');
        const folder = ctx.makeFolder('5');
        folder.span._rect = { top: 120, bottom: 144, height: 24, width: 200 };
        const wrapUl = ctx.el('UL'); // the list the folder row sits in
        wrapUl.dataset.level = '0';
        folder.li.parentNode = wrapUl;
        ctx.startDrag(dragged.a);
        ctx.move(folder.span, 60, 132); // layout cursor 110 → folder middle zone
        // overlay covers the folder row in layout coords (viewport 200×24 → /1.2)
        expect(ctx.dropOverlay.className).toBe('folder');
        expect(ctx.dropOverlay.style.top).toBe('100px');
        expect(ctx.dropOverlay.style.width).toBe(`${200 / 1.2}px`);
        expect(ctx.dropOverlay.style.height).toBe('20px');
        ctx.up(folder.span, 60, 132); // middle → move into the folder
        expect(ctx.chrome.bookmarks.moveCalls).toEqual([['11', { parentId: '5' }]]);
    });

    it('re-reads the zoom level on every drag start (clearing zoom resets to 1)', () => {
        const ctx = setup({ zoom: '120' });
        const dragged = ctx.makeBookmark('11');
        const target = ctx.makeBookmark('2');
        target.a._rect = { top: 120, bottom: 144, height: 24, width: 200 };
        ctx.startDrag(dragged.a);
        ctx.move(target.a, 120, 240);
        expect(ctx.bookmarkClone.style.left).toBe('100px'); // 120 / 1.2

        // zoom cleared mid-session → the next drag must not reuse 1.2
        ctx.store.set('zoom', undefined);
        const dragged2 = ctx.makeBookmark('12');
        const target2 = ctx.makeBookmark('3');
        target2.a._rect = { top: 100, bottom: 120, height: 20, width: 200 };
        ctx.startDrag(dragged2.a);
        ctx.move(target2.a, 120, 240);
        expect(ctx.bookmarkClone.style.left).toBe('120px'); // 120 / 1
        expect(ctx.bookmarkClone.style.top).toBe('240px');
    });
});

describe('zoom tree-edge checks (issue #59 audit)', () => {
    it('judges the tree-edge check in layout coords under zoom', () => {
        const ctx = setup({ zoom: '120' });
        ctx.tree.offsetTop = 50; // layout offset — shown at 50*1.2 = 60 (viewport)
        const dragged = ctx.makeBookmark('11');
        ctx.startDrag(dragged.a);
        // hover the tree itself ABOVE its layout top: viewport 55 → layout
        // 45.8 < 50 — the drag must be invalidated (a row target would mask
        // the check, exactly as in the unzoomed case)
        ctx.move(ctx.tree, 30, 55);
        expect(ctx.dropOverlay.style.left).toBe('-999px'); // invalidated
    });

    it('auto-scrolls at the tree bottom edge in layout coords under zoom', () => {
        const ctx = setup({ zoom: '120' });
        ctx.tree.scrollHeight = 1000;
        ctx.tree.offsetHeight = 200;
        ctx.tree.scrollTop = 50;
        const dragged = ctx.makeBookmark('11');
        const target = ctx.makeBookmark('2');
        target.a._rect = { top: 100, bottom: 120, height: 20, width: 200 };
        ctx.startDrag(dragged.a);
        // viewport 590 → layout 491.7 → inside the bottom band (layout 490..500)
        ctx.move(target.a, 50, 590);
        expect(intervals).toHaveLength(1);
        expect(intervals[0][1]).toBe(100);
    });
});
