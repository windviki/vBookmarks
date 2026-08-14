import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// tree-view.js touches page globals (document/chrome/setTimeout) only inside
// initTreeView and its handlers, so the real module imports cleanly in node
// once the globals are stubbed. ctx.tree/search.results are element stubs
// wired with `_listeners` (fire() dispatches with `fn.call(el, ev)`);
// treeRender/search/actions/dnd/separatorManager/SeparatorManager are
// injected recording doubles; chrome.bookmarks.{getTree,getChildren,getRecent,
// onCreated,onRemoved} are recording doubles fed from per-test tables;
// setTimeout/clearTimeout are record-only stubs advanced by hand (tick). All
// assertions go through the DOM-event contract and the doubles' records —
// nothing is copied from the module body.

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

let initTreeView;
let timeouts;         // [[fn, ms, id], ...] in scheduling order
let clearedTimeouts;  // ids passed to clearTimeout
let timerSeq = 1;     // ids handed out by the setTimeout stub
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

beforeAll(async () => {
    globalThis.setTimeout = (fn, ms) => {
        const id = timerSeq++;
        timeouts.push([fn, ms, id]);
        return id;
    };
    globalThis.clearTimeout = id => {
        clearedTimeouts.push(id);
        timeouts = timeouts.filter(t => t[2] !== id); // a cancelled timer never fires
    };
    ({ initTreeView } = await import('../src/tree-view.js'));
});

beforeEach(() => {
    timeouts = [];
    clearedTimeouts = [];
    timerSeq = 1;
});

afterAll(() => {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
    delete globalThis.chrome;
    delete globalThis.document;
});

// Fire every scheduled timeout with the given delay, in order.
const tick = ms => {
    const due = timeouts.filter(t => t[1] === ms);
    timeouts = timeouts.filter(t => t[1] !== ms);
    due.forEach(t => t[0]());
};
// Fire everything that is pending (used to prove nothing else happens).
const tickAll = () => {
    const due = timeouts;
    timeouts = [];
    due.forEach(t => t[0]());
};

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
            title: '',
            href: '',
            style: {},
            dataset: {},
            parentNode: null,
            firstElementChild: null,
            children: [],
            focused: false,
            removed: false,
            scrollTop: 0,
            scrollWidth: 0,
            offsetWidth: 0,
            _attrs: {},
            _qs: {},
            _qsa: {},
            _listeners: {},
            _appended: [],
            _scrolledIntoView: 0,
            classList: {
                add: c => classes.add(c),
                remove: c => classes.delete(c),
                contains: c => classes.has(c),
                toggle: c => {
                    // DOMTokenList.toggle returns the new presence state
                    if (classes.has(c)) {
                        classes.delete(c);
                        return false;
                    }
                    classes.add(c);
                    return true;
                }
            },
            addEventListener(type, fn) {
                (this._listeners[type] = this._listeners[type] || []).push(fn);
            },
            querySelector(sel) {
                return sel in this._qs ? this._qs[sel] : null;
            },
            querySelectorAll(sel) {
                return this._qsa[sel] || [];
            },
            setAttribute(k, v) {
                this._attrs[k] = v;
            },
            getAttribute(k) {
                return k in this._attrs ? this._attrs[k] : null;
            },
            appendChild(child) {
                this._appended.push(child);
            },
            remove() {
                this.removed = true;
            },
            focus() {
                this.focused = true;
            },
            scrollIntoView() {
                this._scrolledIntoView++;
            }
        };
        // Real-DOM parity: className and classList are two views of the same
        // token list. Assigning className must populate the classList set
        // (bookmarkHandler's link-folder branch reads classList.contains).
        Object.defineProperty(node, 'className', {
            get: () => [...classes].join(' '),
            set: v => {
                classes.clear();
                (v || '').split(/\s+/).filter(Boolean).forEach(c => classes.add(c));
            }
        });
        if (id)
            byId[id] = node;
        return node;
    };

    let lastDiv = null;
    const doc = {
        _qsa: {},
        getElementById: id => byId[id] || null,
        querySelectorAll(sel) {
            return this._qsa[sel] || [];
        },
        createElement: () => {
            const div = {
                innerHTML: '',
                removed: false,
                _ul: el('UL'),
                querySelector(sel) {
                    return sel === 'ul' ? this._ul : null;
                },
                remove() {
                    this.removed = true;
                }
            };
            lastDiv = div;
            return div;
        }
    };
    globalThis.document = doc;

    const messages = opts.messages || {};
    const childrenMap = opts.childrenMap || {};
    // Ids whose getChildren call resolves to undefined — the real Chrome API
    // does this for an invalid/missing folder id (plus a runtime.lastError),
    // and the callers must not crash on it.
    const undefinedChildren = opts.undefinedChildren || [];
    const chromeStub = {
        i18n: { getMessage: key => (key in messages ? messages[key] : `MSG:${key}`) },
        runtime: { lastError: null },
        bookmarks: {
            getTreeCalls: [],
            getChildrenCalls: [],
            getRecentCalls: [],
            recentItems: opts.recentItems || [],
            getTree(cb) {
                this.getTreeCalls.push(cb);
            },
            getChildren(id, cb) {
                this.getChildrenCalls.push(id);
                const stale = undefinedChildren.includes(String(id));
                // Mirror the real API: an invalid id sets runtime.lastError AND
                // calls back with undefined — callers must read lastError (to
                // suppress the Unchecked warning) and not crash on undefined.
                chromeStub.runtime.lastError = stale ? { message: 'Bookmark id is invalid' } : null;
                cb(stale ? undefined : (childrenMap[id] || []));
            },
            getRecent(n, cb) {
                this.getRecentCalls.push(n);
                cb(this.recentItems);
            },
            onCreated: { addListener(fn) { this.fn = fn; } },
            onRemoved: { addListener(fn) { this.fn = fn; } }
        }
    };
    globalThis.chrome = chromeStub;

    const storeData = Object.assign({ showRecentBookmarks: '' }, opts.storeData || {});
    const syncData = Object.assign({ showSyncStatus: 'false' }, opts.sync || {});
    const store = {
        sets: [],
        removes: [],
        get: (k, def) => (k in storeData ? storeData[k] : def),
        set(k, v) {
            this.sets.push([k, v]);
            storeData[k] = v;
        },
        remove(k) {
            this.removes.push(k);
            delete storeData[k];
        },
        getSyncSetting: (k, def) => (k in syncData ? syncData[k] : def)
    };

    const tree = el('DIV', 'tree');
    const separatorChecks = [];
    const separatorManager = {
        isSeparator(title, url) {
            separatorChecks.push([title, url]);
            return !!(opts.separatorUrls && opts.separatorUrls.includes(url));
        }
    };
    const smInstances = [];
    class SMDouble {
        constructor(storeRef) {
            this.storeRef = storeRef;
            this.loaded = false;
            this.cleared = false;
            this.saved = false;
            smInstances.push(this);
        }
        load() { this.loaded = true; }
        getAll() { return opts.legacySeps || []; }
        clear() { this.cleared = true; }
        save() { this.saved = true; }
    }

    const treeRender = {
        calls: {
            findFolderByType: [],
            getEffectiveSubTree: [],
            generateHTML: [],
            generateNodeTrees: [],
            generateBookmarkHTML: [],
            getParentPath: []
        },
        findFolderByType(treeArg, type) {
            this.calls.findFolderByType.push([treeArg, type]);
            return opts.bookmarksBarFolder || null;
        },
        getEffectiveSubTree(treeArg) {
            this.calls.getEffectiveSubTree.push(treeArg);
            return opts.effectiveSubTree || [];
        },
        generateHTML(data, level) {
            this.calls.generateHTML.push([data, level]);
            return 'HTML';
        },
        generateNodeTrees(data, list) {
            this.calls.generateNodeTrees.push([data, list]);
            if (opts.parentMap)
                Object.assign(list, opts.parentMap);
        },
        generateBookmarkHTML(title, url, extras, id) {
            this.calls.generateBookmarkHTML.push([title, url, extras, id]);
            return `<a>${id}</a>`;
        },
        getParentPath(id, list) {
            this.calls.getParentPath.push([id, list]);
            if (opts.parentPath)
                return opts.parentPath;
            // Same walk as tree-render.js's real getParentPath: follow the
            // id→parent map up to the root, target id last.
            const path = [id];
            let cur = id;
            while (cur in list && list[cur] !== cur) {
                path.push(list[cur]);
                cur = list[cur];
            }
            return path.reverse();
        }
    };

    const search = {
        results: el('DIV', 'results'),
        quitCalls: 0,
        resetCalls: 0,
        updateIndexCalls: [],
        quit() { this.quitCalls++; },
        reset() { this.resetCalls++; },
        updateIndex(treeArg) { this.updateIndexCalls.push(treeArg); }
    };
    const actions = {
        openBookmarkCalls: [],
        openBookmarkNewTabCalls: [],
        openBookmarkNewWindowCalls: [],
        openBookmarksCalls: [],
        openBookmarksNewWindowCalls: [],
        addSeparatorCalls: [],
        openBookmark(url) { this.openBookmarkCalls.push([url]); },
        openBookmarkNewTab(url, bg, active) { this.openBookmarkNewTabCalls.push([url, bg, active]); },
        openBookmarkNewWindow(url) { this.openBookmarkNewWindowCalls.push([url]); },
        openBookmarks(urls, bg) { this.openBookmarksCalls.push([urls, bg]); },
        openBookmarksNewWindow(urls) { this.openBookmarksNewWindowCalls.push([urls]); },
        addSeparator(id, where) { this.addSeparatorCalls.push([id, where]); }
    };
    const dnd = {
        noOpen: !!opts.noOpen,
        consumeCalls: 0,
        consumeNoOpen() {
            this.consumeCalls++;
            const flag = this.noOpen;
            this.noOpen = false;
            return flag;
        }
    };
    const state = {
        opens: opts.opens || [],
        rememberState: !!opts.rememberState
    };
    let refreshSyncCalls = 0;

    const treeView = initTreeView({
        store,
        tree,
        separatorManager,
        SeparatorManager: SMDouble,
        treeRender,
        search,
        actions,
        dnd,
        refreshSyncIndicators: () => { refreshSyncCalls++; },
        getOpens: () => state.opens,
        getRememberState: () => state.rememberState,
        setOpens: v => { state.opens = v; },
        setRememberState: v => { state.rememberState = v; },
        middleClickBgTab: !!opts.middleClickBgTab,
        leftClickNewTab: !!opts.leftClickNewTab,
        views: opts.views,
        onTreeGenerated: opts.onTreeGenerated,
        onRowsRendered: opts.onRowsRendered,
        toastAction: opts.toastAction
    });

    // A folder row <li id="neat-tree-item-N" class="parent"><span></span></li>
    // sitting inside a wrapping <ul data-level="L">.
    const makeFolder = (id, folderOpts = {}) => {
        const li = el('LI', `neat-tree-item-${id}`);
        li.classList.add('parent');
        if (folderOpts.open)
            li.classList.add('open');
        const wrapUl = el('UL');
        wrapUl.dataset.level = folderOpts.level === undefined ? '0' : `${folderOpts.level}`;
        wrapUl.children = [li];
        li.parentNode = wrapUl;
        const span = el('SPAN');
        span.parentNode = li;
        li.firstElementChild = span;
        if (folderOpts.withUl)
            li._qs['ul'] = el('UL');
        return { li, span, wrapUl };
    };
    // A bookmark row <li id="neat-tree-item-N" class="child"><a></a></li>
    const makeBookmark = (id, anchorOpts = {}) => {
        const li = el('LI', `neat-tree-item-${id}`);
        li.classList.add('child');
        const a = el('A');
        a.parentNode = li;
        li.firstElementChild = a;
        a.href = anchorOpts.href || `http://bm-${id}/`;
        if (anchorOpts.linkFolder)
            a.className = 'link-folder';
        if (anchorOpts.withHr)
            a._qs['hr'] = el('HR');
        return { li, a };
    };

    return {
        treeView, tree, store, chrome: chromeStub, treeRender, search, actions, dnd,
        state, smInstances, separatorChecks, doc, byId, el, makeFolder, makeBookmark,
        getLastDiv: () => lastDiv,
        refreshSyncCalls: () => refreshSyncCalls
    };
};

describe('module API + startup wiring', () => {
    it('returns { generateTree, adaptBookmarkTooltips, revealFolder, revealInTree, bookmarkHandler } and wires the startup getTree to generateTree', () => {
        const { treeView, chrome } = setup({});
        expect(Object.keys(treeView).sort()).toEqual(
            ['adaptBookmarkTooltips', 'bookmarkHandler', 'generateTree', 'revealFolder', 'revealInTree']);
        expect(chrome.bookmarks.getTreeCalls).toHaveLength(1);
        expect(chrome.bookmarks.getTreeCalls[0]).toBe(treeView.generateTree);
    });
});

describe('generateTree', () => {
    it('uses the bookmarks-bar folder children when onlyShowBMBar is on and folderType matches', () => {
        const { treeView, treeRender } = setup({
            storeData: { onlyShowBMBar: '1' },
            bookmarksBarFolder: { id: '1', children: ['K1', 'K2'] }
        });
        treeView.generateTree(['ROOT']);
        expect(treeRender.calls.findFolderByType).toEqual([[['ROOT'], 'bookmarks-bar']]);
        expect(treeRender.calls.getEffectiveSubTree).toEqual([]);
        expect(treeRender.calls.generateHTML[0][0]).toEqual(['K1', 'K2']);
    });

    it('falls back to tree[0].children[0].children when onlyShowBMBar is on but folderType misses', () => {
        const { treeView, treeRender } = setup({ storeData: { onlyShowBMBar: '1' } });
        const legacyTree = [{ children: [{ children: ['FB'] }] }];
        treeView.generateTree(legacyTree);
        expect(treeRender.calls.generateHTML[0][0]).toEqual(['FB']);
    });

    it('uses getEffectiveSubTree when onlyShowBMBar is off', () => {
        const { treeView, treeRender } = setup({ effectiveSubTree: ['E1'] });
        treeView.generateTree(['ROOT']);
        expect(treeRender.calls.findFolderByType).toEqual([]);
        expect(treeRender.calls.getEffectiveSubTree).toEqual([['ROOT']]);
        expect(treeRender.calls.generateHTML[0][0]).toEqual(['E1']);
    });

    it('refreshes the fuzzy-search index with the full tree', () => {
        const { treeView, search } = setup({});
        treeView.generateTree(['ROOT']);
        expect(search.updateIndexCalls).toEqual([['ROOT']]);
    });

    it('writes the tree HTML directly into $tree.innerHTML (the recent section moved to view-recent.js)', () => {
        const { treeView, tree, chrome } = setup({ storeData: { showRecentBookmarks: '1' } });
        treeView.generateTree(['ROOT']);
        expect(tree.innerHTML).toBe('HTML');
        expect(tree.innerHTML).not.toContain('recent-section');
        expect(chrome.bookmarks.getRecentCalls).toEqual([]); // tree-view no longer fetches recents
    });

    it('fires onTreeGenerated AFTER the innerHTML swap (item: overlay first paint)', () => {
        // The dead-mark × overlays re-lay from this hook; firing before the
        // swap meant the fresh rows never got them until the next rebuild.
        const seen = [];
        const { treeView } = setup({
            onTreeGenerated(t) {
                seen.push({ tree: t, html: document.getElementById('tree').innerHTML });
            }
        });
        treeView.generateTree(['ROOT']);
        expect(seen).toHaveLength(1);
        expect(seen[0].tree).toEqual(['ROOT']);
        expect(seen[0].html).toBe('HTML'); // rows already in the DOM
    });

    it('restores the persisted scrollTop when rememberState is on', () => {
        const { treeView, tree } = setup({ rememberState: true, storeData: { scrollTop: 66 } });
        treeView.generateTree(['ROOT']);
        expect(tree.scrollTop).toBe(66);
    });

    it('leaves scrollTop alone when rememberState is off', () => {
        const { treeView, tree } = setup({ rememberState: false, storeData: { scrollTop: 66 } });
        tree.scrollTop = 5;
        treeView.generateTree(['ROOT']);
        expect(tree.scrollTop).toBe(5);
    });

    it('focuses the stored focusID row, restores overflow after 1ms and clears focusID after 4s', () => {
        const ctx = setup({ storeData: { focusID: '5' }, rememberState: true });
        const { li, span } = ctx.makeFolder('5');
        ctx.tree.style.overflow = 'auto';
        ctx.treeView.generateTree(['ROOT']);
        expect(span.classList.contains('focus')).toBe(true);
        // the reveal must ALSO take keyboard focus — the blueFade class alone
        // strands the user (arrow keys do nothing until they click)
        expect(span.focused).toBe(true);
        expect(li.style.width).toBe('100%');
        expect(ctx.tree.style.overflow).toBe('hidden');
        expect(ctx.store.removes).toEqual([]);
        tick(1);
        expect(ctx.tree.style.overflow).toBe('auto');
        expect(ctx.store.removes).toEqual([]); // not yet
        tick(4000);
        expect(ctx.store.removes).toEqual(['focusID']);
    });

    it('skips the whole focus restore when rememberState is off (issue #58)', () => {
        // issue #58: with "remember previous state" unchecked, the last-focused
        // row must NOT be refocused/re-highlighted on open — no .focus class,
        // no focus(), no overflow pinning, no focusID cleanup timers.
        const ctx = setup({ storeData: { focusID: '5' }, rememberState: false });
        const { span } = ctx.makeFolder('5');
        ctx.tree.style.overflow = 'auto';
        ctx.treeView.generateTree(['ROOT']);
        expect(span.classList.contains('focus')).toBe(false);
        expect(span.focused).toBe(false);
        expect(ctx.tree.style.overflow).toBe('auto');
        expect(timeouts.filter(t => t[1] === 1 || t[1] === 4000)).toEqual([]);
        tickAll();
        expect(ctx.store.removes).toEqual([]);
    });

    it('schedules no focus timers when the focusID row is missing', () => {
        const { treeView, store } = setup({ storeData: { focusID: '5' }, rememberState: true });
        treeView.generateTree(['ROOT']);
        expect(timeouts.filter(t => t[1] === 1 || t[1] === 4000)).toEqual([]);
        tickAll();
        expect(store.removes).toEqual([]);
    });

    it('a focusID row without a focusable child skips the highlight but keeps the cleanup timers (K12)', () => {
        // A detached/mid-render row has firstElementChild === null — the reveal
        // must not throw, and the overflow/focusID cleanup must still run.
        const ctx = setup({ storeData: { focusID: '5' }, rememberState: true });
        const { li } = ctx.makeFolder('5');
        li.firstElementChild = null;
        ctx.tree.style.overflow = 'auto';
        expect(() => ctx.treeView.generateTree(['ROOT'])).not.toThrow();
        expect(ctx.tree.style.overflow).toBe('hidden');
        tick(1);
        expect(ctx.tree.style.overflow).toBe('auto');
        tick(4000);
        expect(ctx.store.removes).toEqual(['focusID']);
    });

    // --- live focus law (A4): an in-page re-render parks/restores the
    // focused row like every list view; the focusID reveal stays a
    // reopen-only mechanism. -------------------------------------------
    const focusRowInTree = (ctx, bm) => {
        bm.li._qs['a, span'] = bm.a;   // unpark's querySelector('a, span')
        bm.li.parentNode = ctx.tree;
        ctx.tree._qsa['li'] = [bm.li]; // park's membership check
        ctx.doc.activeElement = bm.a;
    };

    it('re-renders keep the focused tree row even with rememberState off (A4)', () => {
        const ctx = setup({ rememberState: false });
        const bm = ctx.makeBookmark('7');
        focusRowInTree(ctx, bm);
        ctx.treeView.generateTree(['ROOT']);
        // the surviving row is re-focused by id — no focusID, no reveal
        expect(bm.a.focused).toBe(true);
        expect(bm.li.style.width).toBeUndefined();
        expect(timeouts.filter(t => t[1] === 1 || t[1] === 4000)).toEqual([]);
    });

    it('a live restored row skips the reopen reveal (no width/overflow flash)', () => {
        const ctx = setup({
            rememberState: true,
            storeData: { focusID: '7', scrollTop: 10 }
        });
        const bm = ctx.makeBookmark('7');
        focusRowInTree(ctx, bm);
        ctx.tree.style.overflow = 'auto';
        ctx.treeView.generateTree(['ROOT']);
        expect(bm.a.focused).toBe(true);
        // the reveal treatment belongs to the REOPEN path only
        expect(bm.li.style.width).toBeUndefined();
        expect(ctx.tree.style.overflow).toBe('auto');
        expect(timeouts.filter(t => t[1] === 1 || t[1] === 4000)).toEqual([]);
        tickAll();
        expect(ctx.store.removes).toEqual([]); // focusID left alone
    });

    it('an explicit reveal target still wins over the restored live row', () => {
        // revealFolder can run while a tree row still holds focus — the
        // focusID it stamps must take the reveal, not the parked row.
        const ctx = setup({ rememberState: true, storeData: { focusID: '9' } });
        const bm = ctx.makeBookmark('7');
        focusRowInTree(ctx, bm);
        const target = ctx.makeFolder('9');
        ctx.treeView.generateTree(['ROOT']);
        expect(target.span.classList.contains('focus')).toBe(true);
        expect(target.span.focused).toBe(true);
        expect(bm.a.focused).toBe(true); // unpark ran first, reveal re-focused
        tick(4000);
        expect(ctx.store.removes).toEqual(['focusID']);
    });

    it('focus outside the tree parks nothing and changes nothing', () => {
        const ctx = setup({ rememberState: false });
        const outside = ctx.el('INPUT', 'search-input');
        ctx.doc.activeElement = outside;
        expect(() => ctx.treeView.generateTree(['ROOT'])).not.toThrow();
        expect(outside.focused).toBe(false); // unpark must not steal focus
    });

    it('migrates legacy local separators through actions.addSeparator, then clears and saves', () => {
        const { treeView, actions, smInstances, store } = setup({ legacySeps: ['s1', null, 's2'] });
        treeView.generateTree(['ROOT']);
        expect(actions.addSeparatorCalls).toEqual([['s1', 'after'], ['s2', 'after']]);
        expect(smInstances).toHaveLength(1);
        expect(smInstances[0].storeRef).toBe(store);
        expect(smInstances[0].loaded).toBe(true);
        expect(smInstances[0].cleared).toBe(true);
        expect(smInstances[0].saved).toBe(true);
    });

    it('refreshes sync indicators via a 100ms timeout when showSyncStatus is true', () => {
        const ctx = setup({ sync: { showSyncStatus: 'true' } });
        ctx.treeView.generateTree(['ROOT']);
        expect(ctx.refreshSyncCalls()).toBe(0); // deferred, not synchronous
        tick(100);
        expect(ctx.refreshSyncCalls()).toBe(1);
    });

    it('does not schedule the sync refresh when showSyncStatus is false', () => {
        const ctx = setup({ sync: { showSyncStatus: 'false' } });
        ctx.treeView.generateTree(['ROOT']);
        tickAll();
        expect(ctx.refreshSyncCalls()).toBe(0);
    });

    it('re-fits bookmark tooltips via a 100ms timeout', () => {
        const ctx = setup({});
        const bm = ctx.el('A');
        bm.scrollWidth = 200;
        bm.offsetWidth = 100;
        bm.title = 'http://t/';
        bm._qs['i'] = { textContent: 'Long title' };
        ctx.doc._qsa['li.child a'] = [bm];
        ctx.treeView.generateTree(['ROOT']);
        expect(bm.title).toBe('http://t/'); // deferred
        tick(100);
        expect(bm.title).toBe('Long title\nhttp://t/');
        expect(bm.classList.contains('titled')).toBe(true);
    });
});

describe('tree events', () => {
    it('persists scrollTop on scroll', () => {
        const { tree, store } = setup({});
        tree.scrollTop = 42;
        fire(tree, 'scroll', makeEvent());
        expect(store.sets).toContainEqual(['scrollTop', 42]);
    });

    it('tracks focus on a row: clears the old .focus element and stores focusID', () => {
        const { tree, store, el, makeBookmark } = setup({});
        const old = el('SPAN');
        old.classList.add('focus');
        tree._qs['.focus'] = old;
        const { a } = makeBookmark('8');
        fire(tree, 'focus', makeEvent({ target: a }));
        expect(old.classList.contains('focus')).toBe(false);
        expect(store.sets).toContainEqual(['focusID', '8']);
    });

    it('stores a null focusID when a non-row element gets focus', () => {
        const { tree, store } = setup({});
        fire(tree, 'focus', makeEvent({ target: tree }));
        expect(store.sets).toContainEqual(['focusID', null]);
    });

    it('ignores non-left clicks, non-SPAN targets and shift/ctrl clicks for toggling', () => {
        const ctx = setup({});
        const { li, span } = ctx.makeFolder('9', { withUl: true });
        fire(ctx.tree, 'click', makeEvent({ button: 2, target: span }));
        fire(ctx.tree, 'click', makeEvent({ button: 0, target: span, shiftKey: true }));
        fire(ctx.tree, 'click', makeEvent({ button: 0, target: span, ctrlKey: true }));
        const { a } = ctx.makeBookmark('2');
        fire(ctx.tree, 'click', makeEvent({ button: 0, target: a }));
        expect(li.classList.contains('open')).toBe(false);
    });

    it('toggles open class + aria-expanded on folder click and persists the open id list', () => {
        const ctx = setup({});
        const { li, span } = ctx.makeFolder('9', { withUl: true });
        const other = ctx.makeFolder('4', { open: true }).li;
        ctx.tree._qsa['li.open'] = [li, other];
        fire(ctx.tree, 'click', makeEvent({ button: 0, target: span }));
        expect(li.classList.contains('open')).toBe(true);
        expect(li._attrs['aria-expanded']).toBe(true);
        expect(ctx.store.sets).toContainEqual(['opens', '["9","4"]']);
        // second click collapses again
        ctx.tree._qsa['li.open'] = [];
        fire(ctx.tree, 'click', makeEvent({ button: 0, target: span }));
        expect(li.classList.contains('open')).toBe(false);
        expect(li._attrs['aria-expanded']).toBe(false);
        expect(ctx.store.sets).toContainEqual(['opens', '[]']);
    });

    it('lazy-loads children of an unexpanded folder: getChildren -> generated ul appended, div dropped', () => {
        const ctx = setup({ childrenMap: { 9: [{ id: '91', url: 'http://a/' }] } });
        const { li, span, wrapUl } = ctx.makeFolder('9', { level: 1 });
        const bm = ctx.el('A'); // proves the deferred tooltip pass runs
        bm.scrollWidth = 200;
        bm.offsetWidth = 100;
        bm.title = 'http://t/';
        bm._qs['i'] = { textContent: 'T' };
        ctx.doc._qsa['li.child a'] = [bm];
        fire(ctx.tree, 'click', makeEvent({ button: 0, target: span }));
        // expand handler + bookmarkHandler both look the children up
        expect(ctx.chrome.bookmarks.getChildrenCalls).toEqual(['9', '9']);
        expect(ctx.treeRender.calls.generateHTML).toEqual([[[{ id: '91', url: 'http://a/' }], 2]]); // level 1 + 1
        const div = ctx.getLastDiv();
        expect(div.innerHTML).toBe('HTML');
        expect(li._appended).toEqual([div._ul]);
        expect(div.removed).toBe(true);
        expect(wrapUl.dataset.level).toBe('1');
        tick(100);
        expect(bm.classList.contains('titled')).toBe(true); // adaptBookmarkTooltips ran
    });

    it('lazy expand fires onRowsRendered after the fresh rows land (item: dead-mark overlays)', () => {
        // The expand path renders outside generateTree — without the hook,
        // marked bookmarks inside a collapsed folder never got their ×.
        const calls = [];
        const ctx = setup({
            childrenMap: { 9: [{ id: '91', url: 'http://a/' }] },
            onRowsRendered: () => calls.push(1)
        });
        const { span } = ctx.makeFolder('9', { level: 1 });
        fire(ctx.tree, 'click', makeEvent({ button: 0, target: span }));
        expect(calls).toEqual([1]);
    });

    it('collapses open sibling folders when closeUnusedFolders is on and the folder expands', () => {
        const ctx = setup({ storeData: { closeUnusedFolders: '1' } });
        const sibling = ctx.makeFolder('7', { open: true, withUl: true }).li;
        const plainLi = ctx.el('LI');
        plainLi.classList.add('child');
        plainLi.classList.add('open'); // non-parent rows are left alone
        const { li, span, wrapUl } = ctx.makeFolder('9', { withUl: true });
        wrapUl.children = [sibling, li, plainLi];
        fire(ctx.tree, 'click', makeEvent({ button: 0, target: span }));
        expect(li.classList.contains('open')).toBe(true);
        expect(sibling.classList.contains('open')).toBe(false);
        expect(sibling._attrs['aria-expanded']).toBe(false);
        expect(plainLi.classList.contains('open')).toBe(true);
    });

    it('leaves siblings alone when closeUnusedFolders is off', () => {
        const ctx = setup({});
        const sibling = ctx.makeFolder('7', { open: true, withUl: true }).li;
        const { li, span, wrapUl } = ctx.makeFolder('9', { withUl: true });
        wrapUl.children = [sibling, li];
        fire(ctx.tree, 'click', makeEvent({ button: 0, target: span }));
        expect(li.classList.contains('open')).toBe(true);
        expect(sibling.classList.contains('open')).toBe(true);
    });

    it('does not touch siblings when the click collapses the folder', () => {
        const ctx = setup({ storeData: { closeUnusedFolders: '1' } });
        const sibling = ctx.makeFolder('7', { open: true, withUl: true }).li;
        const { li, span, wrapUl } = ctx.makeFolder('9', { open: true, withUl: true });
        wrapUl.children = [sibling, li];
        fire(ctx.tree, 'click', makeEvent({ button: 0, target: span }));
        expect(li.classList.contains('open')).toBe(false); // it collapsed
        expect(sibling.classList.contains('open')).toBe(true);
    });

    it('forces focus on middle-click mouseup over A/SPAN only', () => {
        const ctx = setup({});
        const { a } = ctx.makeBookmark('3');
        const { span } = ctx.makeFolder('9', { withUl: true });
        fire(ctx.tree, 'mouseup', makeEvent({ button: 1, target: a }));
        expect(a.focused).toBe(true);
        fire(ctx.tree, 'mouseup', makeEvent({ button: 1, target: span }));
        expect(span.focused).toBe(true);
        const { a: a2 } = ctx.makeBookmark('4');
        fire(ctx.tree, 'mouseup', makeEvent({ button: 0, target: a2 })); // left: no
        fire(ctx.tree, 'mouseup', makeEvent({ button: 1, target: ctx.tree })); // non-row: no
        expect(a2.focused).toBe(false);
    });
});

describe('bookmarkHandler', () => {
    it('eats the event but does nothing for non-left/middle buttons', () => {
        const ctx = setup({});
        const { a } = ctx.makeBookmark('3');
        const ev = makeEvent({ button: 2, target: a });
        fire(ctx.tree, 'click', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(ctx.actions.openBookmarkCalls).toEqual([]);
        expect(ctx.search.resetCalls).toBe(0);
    });

    it('swallows the click that follows an invalid drag (dnd.consumeNoOpen)', () => {
        const ctx = setup({ noOpen: true });
        const { a } = ctx.makeBookmark('3');
        const ev = makeEvent({ button: 0, target: a });
        fire(ctx.tree, 'click', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(ctx.dnd.consumeCalls).toBe(1);
        expect(ctx.actions.openBookmarkCalls).toEqual([]);
        // the flag is consumed: the next click opens normally
        fire(ctx.tree, 'click', makeEvent({ button: 0, target: a }));
        expect(ctx.actions.openBookmarkCalls).toEqual([['http://bm-3/']]);
    });

    it('opens a bookmark in the current tab on a plain click and resets the search', () => {
        const ctx = setup({});
        const { a } = ctx.makeBookmark('3');
        fire(ctx.tree, 'click', makeEvent({ button: 0, target: a }));
        expect(ctx.actions.openBookmarkCalls).toEqual([['http://bm-3/']]);
        expect(ctx.search.resetCalls).toBe(1);
    });

    it('opens a bookmark in a new active tab on a plain click when leftClickNewTab is on', () => {
        const ctx = setup({ leftClickNewTab: true });
        const { a } = ctx.makeBookmark('3');
        fire(ctx.tree, 'click', makeEvent({ button: 0, target: a }));
        expect(ctx.actions.openBookmarkNewTabCalls).toEqual([['http://bm-3/', true, true]]);
        expect(ctx.actions.openBookmarkCalls).toEqual([]);
    });

    it('opens a bookmark in a new window on shift+click', () => {
        const ctx = setup({});
        const { a } = ctx.makeBookmark('3');
        fire(ctx.tree, 'click', makeEvent({ button: 0, target: a, shiftKey: true }));
        expect(ctx.actions.openBookmarkNewWindowCalls).toEqual([['http://bm-3/']]);
        expect(ctx.search.resetCalls).toBe(1);
    });

    it('computes the background flag for ctrl/meta/middle clicks from middleClickBgTab and shift', () => {
        const rows = [
            [{}, true],                                  // bgTab off, no shift -> !shift
            [{ shiftKey: true }, false],                 // bgTab off, shift
            [{ middleClickBgTab: true }, false],         // bgTab on, no shift -> shift
            [{ middleClickBgTab: true, shiftKey: true }, true]
        ];
        for (const [rowOpts, expectedBg] of rows) {
            const { shiftKey, ...setupOpts } = rowOpts;
            const ctx = setup(setupOpts);
            const { a } = ctx.makeBookmark('3');
            fire(ctx.tree, 'click', makeEvent({ button: 0, target: a, ctrlKey: true, shiftKey: !!shiftKey }));
            expect(ctx.actions.openBookmarkNewTabCalls).toEqual([['http://bm-3/', expectedBg, undefined]]);
        }
    });

    it('treats metaKey like ctrlKey and middle-button auxclick like a ctrl-click', () => {
        const ctx = setup({});
        const { a } = ctx.makeBookmark('3');
        fire(ctx.tree, 'click', makeEvent({ button: 0, target: a, metaKey: true }));
        expect(ctx.actions.openBookmarkNewTabCalls).toEqual([['http://bm-3/', true, undefined]]);
        const { a: a2 } = ctx.makeBookmark('4');
        fire(ctx.tree, 'auxclick', makeEvent({ button: 1, target: a2 }));
        expect(ctx.actions.openBookmarkNewTabCalls).toContainEqual(['http://bm-4/', true, undefined]);
    });

    it('ignores separator rows (an <a> containing an <hr>)', () => {
        const ctx = setup({});
        const { a } = ctx.makeBookmark('3', { withHr: true });
        fire(ctx.tree, 'click', makeEvent({ button: 0, target: a }));
        expect(ctx.actions.openBookmarkCalls).toEqual([]);
        expect(ctx.actions.openBookmarkNewTabCalls).toEqual([]);
        expect(ctx.search.resetCalls).toBe(0);
    });

    it('jumps to a search-result folder: quit search, set opens/rememberState/focusID, re-render via getTree', () => {
        const ctx = setup({ parentPath: ['1', '7'], rememberState: false });
        const { li, a } = ctx.makeBookmark('70', { linkFolder: true });
        li.id = 'results-item-7';
        fire(ctx.tree, 'click', makeEvent({ button: 0, target: a }));
        expect(ctx.search.quitCalls).toBe(1);
        expect(ctx.search.resetCalls).toBe(0); // jump quits instead of resetting
        expect(ctx.treeRender.calls.getParentPath).toHaveLength(1);
        expect(ctx.treeRender.calls.getParentPath[0][0]).toBe('7'); // prefix stripped
        expect(ctx.state.opens).toEqual(['1', '7']);
        expect(ctx.store.sets).toContainEqual(['opens', '["1","7"]']);
        expect(ctx.state.rememberState).toBe(true);
        expect(ctx.store.sets).toContainEqual(['focusID', '7']);
        expect(ctx.chrome.bookmarks.getTreeCalls).toHaveLength(2); // startup + this jump
    });

    it('generateTreeForTarget re-renders, scrolls the focus row into view and persists scrollTop', () => {
        const ctx = setup({ parentPath: ['1', '7'], storeData: { scrollTop: 33 } });
        const { li, a } = ctx.makeBookmark('70', { linkFolder: true });
        li.id = 'results-item-7';
        fire(ctx.tree, 'click', makeEvent({ button: 0, target: a }));
        const target = ctx.el('LI');
        ctx.tree._qs['#neat-tree-item-7'] = target;
        ctx.chrome.bookmarks.getTreeCalls[1](['ROOT2']);
        expect(ctx.treeRender.calls.getEffectiveSubTree).toEqual([['ROOT2']]); // re-rendered
        // the jump forced rememberState on, so generateTree restored scrollTop first
        expect(ctx.tree.scrollTop).toBe(33);
        expect(target._scrolledIntoView).toBe(1);
        expect(ctx.store.sets).toContainEqual(['scrollTop', 33]);
    });

    it('opens all child bookmarks of a folder on ctrl+click, dropping url-less children', () => {
        const ctx = setup({
            childrenMap: { 3: [{ url: 'http://a/' }, { title: 'folder' }, { url: '' }, { url: 'http://b/' }] }
        });
        const { span } = ctx.makeFolder('3', { withUl: true });
        fire(ctx.tree, 'click', makeEvent({ button: 0, target: span, ctrlKey: true }));
        expect(ctx.chrome.bookmarks.getChildrenCalls).toEqual(['3']);
        expect(ctx.actions.openBookmarksCalls).toEqual([[['http://a/', 'http://b/'], true]]);
    });

    it('opens all child bookmarks of a folder in a new window on shift+click', () => {
        const ctx = setup({ childrenMap: { 3: [{ url: 'http://a/' }] } });
        const { span } = ctx.makeFolder('3', { withUl: true });
        fire(ctx.tree, 'click', makeEvent({ button: 0, target: span, shiftKey: true }));
        expect(ctx.actions.openBookmarksNewWindowCalls).toEqual([[['http://a/']]]);
        expect(ctx.actions.openBookmarksCalls).toEqual([]);
    });

    it('does nothing for a plain folder click or a folder with no bookmark children', () => {
        const ctx = setup({ childrenMap: { 3: [{ title: 'subfolder' }], 4: [{ url: 'http://a/' }] } });
        const f3 = ctx.makeFolder('3', { withUl: true });
        fire(ctx.tree, 'click', makeEvent({ button: 0, target: f3.span })); // plain click
        const f4 = ctx.makeFolder('4', { withUl: true });
        fire(ctx.tree, 'click', makeEvent({ button: 0, target: f4.span, ctrlKey: true })); // has urls
        expect(ctx.actions.openBookmarksCalls).toEqual([[['http://a/'], true]]);
        expect(ctx.actions.openBookmarksNewWindowCalls).toEqual([]);
    });

    // A stale/ghost folder row (folder deleted meanwhile, or a row whose id
    // never resolves) makes chrome.bookmarks.getChildren call back with
    // undefined + lastError — the SPAN branch must read lastError (so Chrome
    // never surfaces the Unchecked warning) and not crash. The stub mirrors
    // the real API: an invalid id sets runtime.lastError AND returns undefined.
    it('survives a getChildren(undefined + lastError) for a stale folder row on ctrl+click', () => {
        const ctx = setup({ undefinedChildren: ['3'] });
        const { span } = ctx.makeFolder('3', { withUl: true });
        expect(() =>
            fire(ctx.tree, 'click', makeEvent({ button: 0, target: span, ctrlKey: true }))
        ).not.toThrow();
        expect(ctx.actions.openBookmarksCalls).toEqual([]);
        expect(ctx.actions.openBookmarksNewWindowCalls).toEqual([]);
    });

    it('is also bound to the search results pane', () => {
        const ctx = setup({});
        const { a } = ctx.makeBookmark('3');
        fire(ctx.search.results, 'click', makeEvent({ button: 0, target: a }));
        expect(ctx.actions.openBookmarkCalls).toEqual([['http://bm-3/']]);
    });

    it('binds middle-button auxclick on the search results pane too', () => {
        const ctx = setup({});
        const { a } = ctx.makeBookmark('3');
        fire(ctx.search.results, 'auxclick', makeEvent({ button: 1, target: a }));
        expect(ctx.actions.openBookmarkNewTabCalls).toEqual([['http://bm-3/', true, undefined]]);
    });
});

describe('revealInTree (v4 task-2 §2.3)', () => {
    it('runs the revealFolder chain and activates the tree view', () => {
        const activateCalls = [];
        const views = { activate: (...args) => activateCalls.push(args) };
        const ctx = setup({ parentPath: ['1', '7'], rememberState: false, views });
        ctx.treeView.revealInTree('7');
        expect(ctx.search.quitCalls).toBe(1);
        expect(ctx.treeRender.calls.getParentPath[0][0]).toBe('7');
        expect(ctx.state.opens).toEqual(['1', '7']);
        expect(ctx.state.rememberState).toBe(true);
        expect(ctx.store.sets).toContainEqual(['focusID', '7']);
        expect(ctx.chrome.bookmarks.getTreeCalls).toHaveLength(2); // startup + reveal
        expect(activateCalls).toEqual([['tree', { keepFocus: true }]]);
    });

    it('still reveals when no views API is injected (minimal setups)', () => {
        const ctx = setup({ parentPath: ['7'], rememberState: false });
        ctx.treeView.revealInTree('7');
        expect(ctx.store.sets).toContainEqual(['focusID', '7']);
        expect(ctx.chrome.bookmarks.getTreeCalls).toHaveLength(2);
    });

    it('the link-folder click branch prefers data-node-id over the id prefix', () => {
        const ctx = setup({ parentPath: ['7'] });
        const { li, a } = ctx.makeBookmark('70', { linkFolder: true });
        li.id = 'results-item-70';
        li.dataset.nodeId = '7';
        fire(ctx.tree, 'click', makeEvent({ button: 0, target: a }));
        expect(ctx.treeRender.calls.getParentPath[0][0]).toBe('7');
    });

    // Issue #46: search.js/palette.js render folder rows with TWO classes
    // (`link-folder tree-item-link`), so an exact className match silently
    // fell through to the bookmark-open branch and opened the popup page's
    // own URL in a new tab. The folder branch must key on classList
    // membership, not a whole-string className equality.
    it('a multi-class link-folder row (real search output) still reveals the folder', () => {
        const ctx = setup({ parentPath: ['7'] });
        const { li, a } = ctx.makeBookmark('70');
        a.className = 'link-folder tree-item-link'; // real search.js/palette.js output
        li.id = 'results-item-70';
        li.dataset.nodeId = '7';
        fire(ctx.tree, 'click', makeEvent({ button: 0, target: a }));
        // The folder branch ran (revealFolder) instead of opening `a.href`.
        expect(ctx.treeRender.calls.getParentPath[0][0]).toBe('7');
        expect(ctx.actions.openBookmarkCalls).toHaveLength(0);
        expect(ctx.actions.openBookmarkNewTabCalls).toHaveLength(0);
        // The click did not trigger the bookmark-open reset path.
        expect(ctx.search.resetCalls).toBe(0);
    });

    // Round-4 item 4: "在树中定位" on a bookmark row did nothing visible —
    // nodeTrees maps folders only, so a bookmark id resolved to a path of
    // just itself, no ancestor folder opened and the target row was never
    // rendered into the collapsed tree (no focus, no scroll).
    it('a bookmark id opens its ancestor folders so the row renders and scrolls into view', () => {
        const ctx = setup({
            // what the real generateNodeTrees records: folders only
            parentMap: { '7': '1' },
            effectiveSubTree: [
                { id: '7', parentId: '1', children: [{ id: '42', parentId: '7', url: 'http://bm-42/' }] }
            ]
        });
        ctx.treeView.generateTree(['ROOT']);
        ctx.treeView.revealInTree('42');
        // the opens list holds the ancestor folders, never the bookmark itself
        expect(ctx.state.opens).toEqual(['1', '7']);
        expect(ctx.store.sets).toContainEqual(['opens', '["1","7"]']);
        expect(ctx.store.sets).toContainEqual(['focusID', '42']);
        // …so generateTreeForTarget finds the rendered row and reveals it
        const target = ctx.el('LI');
        ctx.tree._qs['#neat-tree-item-42'] = target;
        ctx.chrome.bookmarks.getTreeCalls[1](['ROOT2']);
        expect(target._scrolledIntoView).toBe(1);
    });

    it('a folder id still opens the folder itself along with its ancestors', () => {
        const ctx = setup({
            parentMap: { '7': '1' },
            effectiveSubTree: [
                { id: '7', parentId: '1', children: [{ id: '42', parentId: '7', url: 'http://bm-42/' }] }
            ]
        });
        ctx.treeView.generateTree(['ROOT']);
        ctx.treeView.revealInTree('7');
        expect(ctx.state.opens).toEqual(['1', '7']);
        expect(ctx.store.sets).toContainEqual(['focusID', '7']);
    });
});

describe('revealInTree + onlyShowBMBar (v4 task-3 #14)', () => {
    // The bar subtree holds folder 7 with bookmark 42; bookmark 99 lives in
    // some other folder outside the bar, so the bar-only render has no
    // nodeTrees entry for it.
    const barSetup = (extra = {}) => {
        const toastCalls = [];
        const activateCalls = [];
        const ctx = setup({
            storeData: { onlyShowBMBar: '1' },
            bookmarksBarFolder: {
                id: '1',
                children: [{ id: '7', parentId: '1', children: [{ id: '42', parentId: '7', url: 'http://in-bar/' }] }]
            },
            parentMap: { '7': '1' }, // folders; addBookmarkParents adds 42→7
            toastAction: (...args) => toastCalls.push(args),
            views: { activate: (...args) => activateCalls.push(args) },
            ...extra
        });
        ctx.treeView.generateTree(['ROOT']);
        return { ctx, toastCalls, activateCalls };
    };

    it('a target inside the bar reveals normally, no toast', () => {
        const { ctx, toastCalls, activateCalls } = barSetup();
        ctx.treeView.revealInTree('42');
        expect(toastCalls).toEqual([]);
        expect(ctx.store.sets).toContainEqual(['focusID', '42']);
        expect(activateCalls).toEqual([['tree', { keepFocus: true }]]);
    });

    it('a target outside the bar toasts the hint and reveals nothing', () => {
        const { ctx, toastCalls, activateCalls } = barSetup();
        ctx.treeView.revealInTree('99');
        expect(toastCalls).toHaveLength(1);
        const [message, label, action] = toastCalls[0];
        expect(message).toBe('MSG:revealOutsideBarHint');
        expect(label).toBe('MSG:revealOutsideBarAction');
        expect(typeof action).toBe('function');
        // no reveal side effects: user stays put until they pick the action
        expect(ctx.store.sets.some(([k]) => k === 'focusID')).toBe(false);
        expect(ctx.chrome.bookmarks.getTreeCalls).toHaveLength(1); // startup only
        expect(activateCalls).toEqual([]);
    });

    it('the toast action shows the full tree (session only) and completes the reveal', () => {
        const { ctx, toastCalls, activateCalls } = barSetup({
            // what the full-tree fetch returns for the override regenerate:
            // the bar plus folder 80 holding bookmark 99
            effectiveSubTree: [
                { id: '1', parentId: '0', children: [{ id: '7', parentId: '1', children: [{ id: '42', parentId: '7', url: 'http://in-bar/' }] }] },
                { id: '80', parentId: '0', children: [{ id: '99', parentId: '80', url: 'http://outside/' }] }
            ]
        });
        ctx.treeRender.calls.getEffectiveSubTree.length = 0;
        ctx.treeView.revealInTree('99');
        expect(toastCalls).toHaveLength(1);
        toastCalls[0][2](); // the user picks "show all and reveal"
        // the override fetches the full tree, then its callback regenerates
        // and runs the reveal chain (the getTree double fires by hand)
        expect(ctx.chrome.bookmarks.getTreeCalls).toHaveLength(2); // startup + override fetch
        ctx.chrome.bookmarks.getTreeCalls[1](['ROOT2']);
        // regenerate ran over the FULL tree (override bypasses the bar filter)
        expect(ctx.treeRender.calls.getEffectiveSubTree).toHaveLength(1);
        // …which mapped 99→80→root, so revealFolder opens the real ancestors
        expect(ctx.state.opens).toContain('80');
        expect(ctx.store.sets).toContainEqual(['focusID', '99']);
        expect(activateCalls).toEqual([['tree', { keepFocus: true }]]);
        // the setting itself is never rewritten
        expect(ctx.store.sets.some(([k]) => k === 'onlyShowBMBar')).toBe(false);
    });

    it('once overridden, later outside reveals go straight through without a toast', () => {
        const { ctx, toastCalls } = barSetup();
        ctx.treeView.revealInTree('99');
        toastCalls[0][2]();
        toastCalls.length = 0;
        ctx.treeView.revealInTree('42'); // any id — override is already on
        expect(toastCalls).toEqual([]);
        expect(ctx.store.sets).toContainEqual(['focusID', '42']);
    });

    it('without a toastAction hook the guard falls back to the plain reveal (minimal setups)', () => {
        const ctx = setup({
            storeData: { onlyShowBMBar: '1' },
            bookmarksBarFolder: { id: '1', children: [] },
            parentPath: ['99']
        });
        ctx.treeView.generateTree(['ROOT']);
        ctx.treeView.revealInTree('99');
        expect(ctx.store.sets).toContainEqual(['focusID', '99']);
    });
});

describe('adaptBookmarkTooltips', () => {
    it('clears the title of separator rows (an <a> containing an <hr>)', () => {
        const ctx = setup({});
        const a = ctx.el('A');
        a.title = 'keep?';
        a._qs['hr'] = ctx.el('HR');
        ctx.doc._qsa['li.child a'] = [a];
        ctx.treeView.adaptBookmarkTooltips();
        expect(a.title).toBe('');
    });

    it('adds a combined title and the titled class when the text overflows', () => {
        const ctx = setup({});
        const a = ctx.el('A');
        a.scrollWidth = 200;
        a.offsetWidth = 100;
        a.title = 'http://t/';
        a._qs['i'] = { textContent: 'Long title' };
        ctx.doc._qsa['li.child a'] = [a];
        ctx.treeView.adaptBookmarkTooltips();
        expect(a.title).toBe('Long title\nhttp://t/');
        expect(a.classList.contains('titled')).toBe(true);
    });

    it('restores title=href and drops the titled class once the row fits again', () => {
        const ctx = setup({});
        const a = ctx.el('A');
        a.classList.add('titled');
        a.scrollWidth = 50;
        a.offsetWidth = 100;
        a.title = 'Long title\nhttp://t/';
        a.href = 'http://t/';
        ctx.doc._qsa['li.child a'] = [a];
        ctx.treeView.adaptBookmarkTooltips();
        expect(a.title).toBe('http://t/');
        expect(a.classList.contains('titled')).toBe(false);
    });

    it('keeps a titled row untouched while it still overflows', () => {
        const ctx = setup({});
        const a = ctx.el('A');
        a.classList.add('titled');
        a.scrollWidth = 200;
        a.offsetWidth = 100;
        a.title = 'Long title\nhttp://t/';
        ctx.doc._qsa['li.child a'] = [a];
        ctx.treeView.adaptBookmarkTooltips();
        expect(a.title).toBe('Long title\nhttp://t/');
        expect(a.classList.contains('titled')).toBe(true);
    });

    it('does not add a title when the visible text already equals the title', () => {
        const ctx = setup({});
        const a = ctx.el('A');
        a.scrollWidth = 200;
        a.offsetWidth = 100;
        a.title = 'Same';
        a._qs['i'] = { textContent: 'Same' };
        ctx.doc._qsa['li.child a'] = [a];
        ctx.treeView.adaptBookmarkTooltips();
        expect(a.title).toBe('Same');
        expect(a.classList.contains('titled')).toBe(false);
    });
});
