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
    const chromeStub = {
        i18n: { getMessage: key => (key in messages ? messages[key] : `MSG:${key}`) },
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
                cb(childrenMap[id] || []);
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
            return opts.parentPath || [id];
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
        leftClickNewTab: !!opts.leftClickNewTab
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
    it('returns { generateTree, adaptBookmarkTooltips, revealFolder } and wires the startup getTree to generateTree', () => {
        const { treeView, chrome } = setup({});
        expect(Object.keys(treeView).sort()).toEqual(['adaptBookmarkTooltips', 'generateTree', 'revealFolder']);
        expect(chrome.bookmarks.getTreeCalls).toHaveLength(1);
        expect(chrome.bookmarks.getTreeCalls[0]).toBe(treeView.generateTree);
    });

    it('registers recent-section refresh on onCreated and onRemoved', () => {
        const { chrome } = setup({});
        expect(typeof chrome.bookmarks.onCreated.fn).toBe('function');
        expect(typeof chrome.bookmarks.onRemoved.fn).toBe('function');
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

    it('writes the recent section (escaped header) plus the tree HTML into $tree.innerHTML', () => {
        const { treeView, tree } = setup({
            storeData: { showRecentBookmarks: '1' },
            messages: { recentBookmarks: 'R>"<' }
        });
        treeView.generateTree(['ROOT']);
        expect(tree.innerHTML).toContain('<div id="recent-section">');
        expect(tree.innerHTML).toContain('R&gt;&quot;&lt;'); // > then < then " escape order
        expect(tree.innerHTML).toContain('HTML');
        expect(tree.innerHTML.indexOf('recent-section')).toBeLessThan(tree.innerHTML.indexOf('HTML'));
    });

    it('omits the recent section entirely when disabled', () => {
        const { treeView, tree, chrome } = setup({ storeData: { showRecentBookmarks: '' } });
        treeView.generateTree(['ROOT']);
        expect(tree.innerHTML).not.toContain('recent-section');
        expect(tree.innerHTML).toBe('HTML');
        expect(chrome.bookmarks.getRecentCalls).toEqual([]);
    });

    it('renders the recent section collapsed by default when recentBookmarksCollapsed is set, skipping the fetch', () => {
        const { treeView, tree, chrome } = setup({
            storeData: { showRecentBookmarks: '1', recentBookmarksCollapsed: '1' }
        });
        treeView.generateTree(['ROOT']);
        expect(tree.innerHTML).toContain('id="recent-section" class="collapsed"');
        expect(tree.innerHTML).toContain('aria-expanded="false"');
        expect(chrome.bookmarks.getRecentCalls).toEqual([]);
    });

    it('toggles the recent section via header click and persists the preference', () => {
        const { treeView, tree, store, chrome, el } = setup({ storeData: { showRecentBookmarks: '1' } });
        el('UL', 'recent-list'); // present so the initial fetch is not skipped
        treeView.generateTree(['ROOT']);
        expect(chrome.bookmarks.getRecentCalls).toEqual([20]); // initial fetch
        // The header lives inside $tree.innerHTML in the page; register the
        // section/header stubs the delegated handler resolves by id.
        const section = el('DIV', 'recent-section');
        const header = el('DIV', 'recent-header');
        const ev = () => ({
            button: 0,
            target: { closest: sel => (sel === '#recent-header' ? header : null) },
            preventDefault() {},
            stopImmediatePropagation() {}
        });

        fire(tree, 'click', ev());
        expect(section.classList.contains('collapsed')).toBe(true);
        expect(store.sets).toContainEqual(['recentBookmarksCollapsed', '1']);
        expect(header._attrs['aria-expanded']).toBe('false');

        fire(tree, 'click', ev());
        expect(section.classList.contains('collapsed')).toBe(false);
        expect(store.sets).toContainEqual(['recentBookmarksCollapsed', '']);
        expect(header._attrs['aria-expanded']).toBe('true');
        expect(chrome.bookmarks.getRecentCalls).toEqual([20, 20]); // expand re-fetches
    });

    it('toggles the recent section via Enter/Space on the focused header', () => {
        const { treeView, tree, store, el } = setup({ storeData: { showRecentBookmarks: '1' } });
        treeView.generateTree(['ROOT']);
        const section = el('DIV', 'recent-section');
        const header = el('DIV', 'recent-header');
        fire(tree, 'keydown', {
            key: 'Enter',
            target: header,
            preventDefault() {},
            stopImmediatePropagation() {}
        });
        expect(section.classList.contains('collapsed')).toBe(true);
        expect(store.sets).toContainEqual(['recentBookmarksCollapsed', '1']);
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
        const ctx = setup({ storeData: { focusID: '5' } });
        const { li, span } = ctx.makeFolder('5');
        ctx.tree.style.overflow = 'auto';
        ctx.treeView.generateTree(['ROOT']);
        expect(span.classList.contains('focus')).toBe(true);
        expect(li.style.width).toBe('100%');
        expect(ctx.tree.style.overflow).toBe('hidden');
        expect(ctx.store.removes).toEqual([]);
        tick(1);
        expect(ctx.tree.style.overflow).toBe('auto');
        expect(ctx.store.removes).toEqual([]); // not yet
        tick(4000);
        expect(ctx.store.removes).toEqual(['focusID']);
    });

    it('schedules no focus timers when the focusID row is missing', () => {
        const { treeView, store } = setup({ storeData: { focusID: '5' } });
        treeView.generateTree(['ROOT']);
        expect(timeouts.filter(t => t[1] === 1 || t[1] === 4000)).toEqual([]);
        tickAll();
        expect(store.removes).toEqual([]);
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

    it('is also bound to the search results pane', () => {
        const ctx = setup({});
        const { a } = ctx.makeBookmark('3');
        fire(ctx.search.results, 'click', makeEvent({ button: 0, target: a }));
        expect(ctx.actions.openBookmarkCalls).toEqual([['http://bm-3/']]);
    });
});

describe('recent bookmarks section', () => {
    const recentItems = [
        { id: '101', parentId: '1', title: 'A', url: 'http://a/' },
        { id: '102', parentId: '1', title: 'sep', url: 'http://sep/' },
        { id: '103', parentId: '1', title: 'no url yet' }
    ];

    it('renders getRecent(20) entries into #recent-list, skipping separators and url-less items', () => {
        const ctx = setup({
            storeData: { showRecentBookmarks: '1' },
            recentItems,
            separatorUrls: ['http://sep/']
        });
        const list = ctx.el('UL', 'recent-list');
        ctx.treeView.generateTree(['ROOT']);
        expect(ctx.chrome.bookmarks.getRecentCalls).toEqual([20]);
        expect(list.innerHTML).toContain('id="neat-recent-item-101"');
        expect(list.innerHTML).toContain('data-parentid="1"');
        expect(list.innerHTML).toContain('<a>101</a>');
        expect(list.innerHTML).not.toContain('102'); // separator filtered out
        expect(list.innerHTML).not.toContain('103'); // no url
        expect(ctx.separatorChecks).toContainEqual(['sep', 'http://sep/']);
        // virtual-entry extras are forwarded to the row template
        expect(ctx.treeRender.calls.generateBookmarkHTML[0]).toEqual(
            ['A', 'http://a/', 'style="-webkit-padding-start: 0px" data-virtual="1"', '101']);
    });

    it('debounces onCreated: a single event refreshes the list once after 300ms', () => {
        const ctx = setup({ storeData: { showRecentBookmarks: '1' }, recentItems });
        ctx.el('UL', 'recent-list');
        ctx.chrome.bookmarks.onCreated.fn();
        expect(ctx.chrome.bookmarks.getRecentCalls).toEqual([]); // debounced
        expect(timeouts.filter(t => t[1] === 300)).toHaveLength(1);
        tick(300);
        expect(ctx.chrome.bookmarks.getRecentCalls).toEqual([20]);
    });

    it('debounces a burst of onCreated/onRemoved events into one refresh', () => {
        const ctx = setup({ storeData: { showRecentBookmarks: '1' }, recentItems });
        ctx.el('UL', 'recent-list');
        ctx.chrome.bookmarks.onCreated.fn();
        ctx.chrome.bookmarks.onRemoved.fn();
        expect(clearedTimeouts).toContain(1); // the first timer got cancelled
        expect(timeouts.filter(t => t[1] === 300)).toHaveLength(1);
        tick(300);
        expect(ctx.chrome.bookmarks.getRecentCalls).toEqual([20]); // exactly one refresh
    });

    it('schedules no refresh when the section is disabled', () => {
        const ctx = setup({ storeData: { showRecentBookmarks: '' }, recentItems });
        ctx.chrome.bookmarks.onCreated.fn();
        ctx.chrome.bookmarks.onRemoved.fn();
        expect(timeouts.filter(t => t[1] === 300)).toEqual([]);
        tickAll();
        expect(ctx.chrome.bookmarks.getRecentCalls).toEqual([]);
    });

    it('does nothing when the section element is absent from the page', () => {
        const ctx = setup({ storeData: { showRecentBookmarks: '1' }, recentItems });
        ctx.chrome.bookmarks.onCreated.fn();
        tick(300);
        expect(ctx.chrome.bookmarks.getRecentCalls).toEqual([]); // no #recent-list registered
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
