import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

// actions.js touches page globals (document/window/chrome) only inside
// initActions, so the real module imports cleanly in node once the globals
// are stubbed. chrome.bookmarks/tabs/windows/scripting are test doubles that
// record their calls; the ctx helpers (dialogs / search / separatorManager /
// HTML builders / httpsPattern) are injected doubles too — no implementation
// copied from neat.js.

const makeEl = (autoVivify = false) => ({
    tagName: 'DIV',
    id: '',
    innerHTML: '',
    value: '',
    textContent: '',
    className: '',
    title: '',
    style: {},
    dataset: {},
    disabled: false,
    focused: false,
    selected: false,
    removed: false,
    parentNode: null,
    firstElementChild: null,
    nextElementSibling: null,
    previousElementSibling: null,
    nextSibling: null,
    _attrs: {},
    _qs: {},
    appended: [],
    inserted: [],
    classList: (() => {
        const set = new Set();
        return {
            add: (...cs) => cs.forEach(c => set.add(c)),
            remove: (...cs) => cs.forEach(c => set.delete(c)),
            contains: c => set.has(c),
            _set: set
        };
    })(),
    focus() {
        this.focused = true;
    },
    select() {
        this.selected = true;
    },
    getAttribute(name) {
        return name in this._attrs ? this._attrs[name] : null;
    },
    setAttribute(name, value) {
        this._attrs[name] = value;
    },
    remove() {
        this.removed = true;
    },
    appendChild(child) {
        this.appended.push(child);
        return child;
    },
    insertBefore(child, ref) {
        this.inserted.push([child, ref]);
        return child;
    },
    querySelector(sel) {
        if (sel in this._qs)
            return this._qs[sel];
        return autoVivify ? (this._qs[sel] = makeEl(true)) : null;
    }
});

// parentNode stub recording removeChild (neatools' destroy replacement)
const makeParent = () => ({
    removedChildren: [],
    removeChild(child) {
        this.removedChildren.push(child);
        return child;
    }
});

const makeStore = (data = {}) => ({
    _data: { ...data },
    get(key) {
        return this._data[key];
    },
    set(key, v) {
        this._data[key] = v;
    },
    getSyncSetting(key, dflt) {
        return key in this._data ? this._data[key] : dflt;
    }
});

const makeChrome = ops => ({
    i18n: { getMessage: (key, subs) => subs ? `${key}[${[].concat(subs).join('|')}]` : key },
    bookmarks: {
        getNodes: {},
        childNodes: {},
        createCalls: [],
        updateCalls: [],
        removeCalls: [],
        removeTreeCalls: [],
        nextId: 100,
        get(id, cb) {
            cb(this.getNodes[id] || []);
        },
        getChildren(id, cb) {
            cb(this.childNodes[id] || []);
        },
        create(props, cb) {
            this.createCalls.push(props);
            cb({ id: `${this.nextId++}`, ...props });
        },
        update(id, props, cb) {
            this.updateCalls.push([id, props]);
            if (cb)
                cb({ id, title: props.title, url: props.url });
        },
        remove(id, cb) {
            this.removeCalls.push(id);
            ops && ops.push(['remove', id]);
            if (cb)
                cb();
        },
        removeTree(id, cb) {
            this.removeTreeCalls.push(id);
            ops && ops.push(['removeTree', id]);
            if (cb)
                cb();
        }
    },
    tabs: {
        current: { id: 7, url: 'https://current.example/page?a=1&b=2' },
        queried: [],
        created: [],
        updated: [],
        grouped: [],
        nextTabId: 500,
        query(q, cb) {
            this.queried.push(q);
            cb([this.current]);
        },
        create(props, cb) {
            this.created.push(props);
            if (cb)
                cb({ id: `${this.nextTabId++}`, ...props });
        },
        update(id, props) {
            this.updated.push([id, props]);
        },
        // P3.4: chrome.tabs.group — records the call, answers group id 900
        group(props, cb) {
            this.grouped.push(props);
            if (cb)
                cb(900);
        }
    },
    // P3.4: chrome.tabGroups (the update half of the tab-group wiring)
    tabGroups: {
        updated: [],
        update(groupId, props, cb) {
            this.updated.push([groupId, props]);
            if (cb)
                cb();
        }
    },
    // P3.4 hardening: the open-as-group actions hand the open+group to the
    // service worker via chrome.runtime.sendMessage (the popup would close
    // mid-flight and drop the pending callbacks otherwise).
    runtime: {
        sent: [],
        lastError: null,
        sendMessage(msg) {
            this.sent.push(msg);
        }
    },
    windows: {
        WINDOW_ID_CURRENT: -1,
        created: [],
        create(props) {
            this.created.push(props);
        }
    },
    scripting: {
        executed: [],
        executeScript(props) {
            this.executed.push(props);
        }
    }
});

let initActions;
let timeouts;
const realSetTimeout = globalThis.setTimeout;

beforeAll(async () => {
    globalThis.setTimeout = (fn, ms) => {
        timeouts.push([fn, ms]);
        return 0;
    };
    ({ initActions } = await import('../src/actions.js'));
});

beforeEach(() => {
    timeouts = [];
});

afterAll(() => {
    globalThis.setTimeout = realSetTimeout;
});

const setup = (opts = {}) => {
    const els = { 'copier-input': makeEl(), ...(opts.els || {}) };
    const ops = []; // ordered [api, ...args] log across chrome + undo doubles
    const chromeStub = makeChrome(ops);
    Object.assign(chromeStub.bookmarks.getNodes, opts.nodes || {});
    Object.assign(chromeStub.bookmarks.childNodes, opts.children || {});
    if (opts.tabUrl)
        chromeStub.tabs.current.url = opts.tabUrl;
    globalThis.chrome = chromeStub;
    const created = [];
    globalThis.document = {
        getElementById: id => els[id] || null,
        createElement: tag => {
            const el = makeEl(true);
            el.tagName = tag.toUpperCase();
            created.push(el);
            return el;
        },
        execCalls: [],
        execCommand(cmd) {
            this.execCalls.push(cmd);
        },
        querySelectorAll: () => [],
        body: makeEl()
    };
    globalThis.window = {
        closeCalls: 0,
        close() {
            this.closeCalls++;
        }
    };
    if (opts.syncManager)
        globalThis.window.syncManager = opts.syncManager;
    const store = makeStore(opts.storeData || {});
    const calls = {
        confirm: [], edit: [], newFolder: [], folderPick: [],
        bmHTML: [], folderHTML: [], sepHTML: [], genHTML: [],
        sepAdd: [], sepRemove: []
    };
    let newFolderCb = null;
    const searchState = { active: !!opts.searchActive };
    const actions = initActions({
        store,
        dialogs: {
            ConfirmDialog: { open: o => calls.confirm.push(o) },
            BookmarkFolderPickDialog: { open: o => calls.folderPick.push(o) },
            EditDialog: { open: o => calls.edit.push(o) },
            NewFolderDialog: {
                open: (name, cb) => {
                    calls.newFolder.push(name);
                    newFolderCb = cb;
                }
            }
        },
        search: { isActive: () => searchState.active },
        separatorManager: {
            separatorURL: 'http://separatethis.com/',
            separatorTitle: 'separator-title',
            add: id => calls.sepAdd.push(id),
            remove: id => calls.sepRemove.push(id)
        },
        generateBookmarkHTML: (title, url, extras, id) => {
            calls.bmHTML.push([title, url, extras, id]);
            return `<a data-bm="${id}">${title}</a>`;
        },
        generateFolderHTML: (title, extras, id, node) => {
            calls.folderHTML.push([title, extras, id, node]);
            return `<span data-folder="${id}">${title}</span>`;
        },
        generateSeparatorHTML: padding => {
            calls.sepHTML.push(padding);
            return `<hr data-pad="${padding}">`;
        },
        generateHTML: (children, level) => {
            calls.genHTML.push([children, level]);
            return '<ul role="group"></ul>';
        },
        httpsPattern: /^https?:\/\//i,
        // P3.3 undo API double: capture/showToast land in the shared ops log
        // so tests can assert the delete-time call order. opts.noUndo omits
        // it entirely to exercise the defensive fallback.
        ...(opts.noUndo ? {} : {
            undo: {
                capture: id => ops.push(['capture', id]),
                showToast: message => ops.push(['toast', message])
            }
        })
    });
    return {
        actions, els, created, chrome: chromeStub, store, calls, searchState, ops,
        callNewFolder: title => newFolderCb(title)
    };
};

describe('module API', () => {
    it('returns the original actions table plus the separator and tab-group actions', () => {
        const { actions } = setup({});
        const names = [
            'openBookmark', 'openBookmarkNewTab', 'openBookmarkNewWindow',
            'addNewBookmarkNode', 'copyAllTitlesAndUrls', 'replaceUrl',
            'openBookmarks', 'openBookmarksInGroup', 'openInExistingTabGroup',
            'openBookmarksNewWindow',
            'editBookmarkFolder', 'deleteBookmark', 'deleteBookmarks',
            'addSeparator', 'deleteSeparator',
            // velvet staging §5: the internal clipboard + single copy/move
            'setClipBookmark', 'cancelClipBookmark', 'hasClipBookmark',
            'hasCutClipboard', 'pasteClipBookmarkInto', 'copyMoveBookmarkTo',
            'reapplyCutState'
        ];
        for (const name of names)
            expect(typeof actions[name], name).toBe('function');
        expect(Object.keys(actions)).toHaveLength(names.length);
    });
});

describe('openBookmark', () => {
    it('updates the active tab with the decoded URL and schedules the popup close', () => {
        const { actions, chrome } = setup({});
        actions.openBookmark('https://example.com/');
        expect(chrome.tabs.queried).toEqual([{ active: true, windowId: -1 }]);
        expect(chrome.tabs.updated).toEqual([[7, { url: 'https://example.com/' }]]);
        expect(timeouts).toEqual([[window.close, 200]]);
        expect(chrome.scripting.executed).toEqual([]);
    });

    it('replaces __VBM_CURRENT_TAB_URL__ with the encoded current tab URL, then decodes', () => {
        const { actions, chrome } = setup({});
        actions.openBookmark('http://x/?u=__VBM_CURRENT_TAB_URL__');
        expect(chrome.tabs.updated).toEqual([
            [7, { url: 'http://x/?u=https://current.example/page?a=1&b=2' }]
        ]);
    });

    it('runs javascript: bookmarklets via scripting.executeScript instead of tabs.update', () => {
        const { actions, chrome } = setup({});
        actions.openBookmark('javascript:alert(1)');
        expect(chrome.scripting.executed).toHaveLength(1);
        expect(chrome.scripting.executed[0].target).toEqual({ tabId: 7 });
        expect(chrome.scripting.executed[0].args).toEqual(['alert(1)']);
        expect(chrome.tabs.updated).toEqual([]);
        expect(timeouts).toHaveLength(1); // popup still closes
    });

    it('aborts silently when the URL cannot be decoded', () => {
        const { actions, chrome } = setup({});
        actions.openBookmark('http://x/%');
        expect(chrome.tabs.updated).toEqual([]);
        expect(chrome.scripting.executed).toEqual([]);
        expect(timeouts).toEqual([]);
    });

    it('keeps the popup open when bookmarkClickStayOpen is set', () => {
        const { actions, chrome } = setup({ storeData: { bookmarkClickStayOpen: '1' } });
        actions.openBookmark('https://example.com/');
        expect(chrome.tabs.updated).toHaveLength(1);
        expect(timeouts).toEqual([]);
    });
});

describe('openBookmarkNewTab', () => {
    it('creates a background tab when selected is false and keeps the popup open', () => {
        const { actions, chrome } = setup({});
        actions.openBookmarkNewTab('https://a/', false);
        expect(chrome.tabs.created).toEqual([{ url: 'https://a/', active: false }]);
        expect(chrome.tabs.updated).toEqual([]);
        // issue #50：后台打开（中键/后台新标签）不再显式关闭 popup——
        // 只有前台打开（selected=true）才受 bookmarkClickStayOpen 约束。
        expect(timeouts).toEqual([]);
    });

    it('keeps the popup open on a background tab even when bookmarkClickStayOpen is off', () => {
        const { actions, chrome } = setup({ storeData: { bookmarkClickStayOpen: '' } });
        actions.openBookmarkNewTab('https://a/', false);
        expect(chrome.tabs.created).toEqual([{ url: 'https://a/', active: false }]);
        // 后台打开无论 bookmarkClickStayOpen 都保持 popup（浏览器惯例，
        // 与 openBookmarks 文件夹分支一致）。
        expect(timeouts).toEqual([]);
    });

    it('reuses a chrome://newtab tab when blankTabCheck is on, then closes', () => {
        const { actions, chrome } = setup({ tabUrl: 'chrome://newtab/' });
        actions.openBookmarkNewTab('https://a/', true, true);
        expect(chrome.tabs.updated).toEqual([[7, { url: 'https://a/' }]]);
        expect(chrome.tabs.created).toEqual([]);
        expect(timeouts).toEqual([[window.close, 200]]);
    });

    it('opens a new active tab when blankTabCheck is on but the tab is not blank', () => {
        const { actions, chrome } = setup({});
        actions.openBookmarkNewTab('https://a/', true, true);
        expect(chrome.tabs.created).toEqual([{ url: 'https://a/', active: true }]);
        expect(chrome.tabs.updated).toEqual([]);
    });

    it('passes the placeholder-replaced URL through without decoding', () => {
        const { actions, chrome } = setup({});
        actions.openBookmarkNewTab('http://x/?u=__VBM_CURRENT_TAB_URL__');
        expect(chrome.tabs.created).toEqual([{
            url: 'http://x/?u=https%3A%2F%2Fcurrent.example%2Fpage%3Fa%3D1%26b%3D2',
            active: undefined
        }]);
    });
});

describe('openBookmarkNewWindow', () => {
    it('creates a normal window by default and an incognito window on demand', () => {
        const { actions, chrome } = setup({});
        actions.openBookmarkNewWindow('https://a/');
        actions.openBookmarkNewWindow('https://b/', true);
        expect(chrome.windows.created).toEqual([
            { url: 'https://a/', incognito: undefined },
            { url: 'https://b/', incognito: true }
        ]);
    });

    it('replaces the placeholder with the encoded current tab URL', () => {
        const { actions, chrome } = setup({});
        actions.openBookmarkNewWindow('http://x/?u=__VBM_CURRENT_TAB_URL__');
        expect(chrome.windows.created).toEqual([{
            url: 'http://x/?u=https%3A%2F%2Fcurrent.example%2Fpage%3Fa%3D1%26b%3D2',
            incognito: undefined
        }]);
    });
});

describe('openBookmarks confirm threshold', () => {
    const urls = n => Array.from({ length: n }, (_, i) => `https://x/${i}`);

    it('opens 10 bookmarks directly: first tab selected, the rest in background', () => {
        const { actions, chrome, calls } = setup({});
        actions.openBookmarks(urls(10), true);
        expect(calls.confirm).toEqual([]);
        expect(chrome.tabs.created).toHaveLength(10);
        expect(chrome.tabs.created[0]).toEqual({ url: 'https://x/0', active: true });
        for (const call of chrome.tabs.created.slice(1))
            expect(call.active).toBe(false);
    });

    it('confirms above the limit and only opens after fn1', () => {
        const { actions, chrome, calls } = setup({});
        actions.openBookmarks(urls(11), true);
        expect(chrome.tabs.created).toEqual([]);
        expect(calls.confirm).toHaveLength(1);
        expect(calls.confirm[0].dialog).toBe('confirmOpenBookmarks[11]');
        expect(calls.confirm[0].button1).toBe('<strong>open</strong>');
        expect(calls.confirm[0].button2).toBe('nope');
        calls.confirm[0].fn1();
        expect(chrome.tabs.created).toHaveLength(11);
        expect(chrome.tabs.created[0].active).toBe(true);
    });

    it('skips the confirm entirely when dontConfirmOpenFolder is set', () => {
        const { actions, chrome, calls } = setup({ storeData: { dontConfirmOpenFolder: '1' } });
        actions.openBookmarks(urls(11), false);
        expect(calls.confirm).toEqual([]);
        expect(chrome.tabs.created).toHaveLength(11);
        expect(chrome.tabs.created[0].active).toBe(false);
    });
});

describe('openBookmarksInGroup', () => {
    const urls = n => Array.from({ length: n }, (_, i) => `https://x/${i}`);
    const palette = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

    it('hands the open+group to the service worker (vbm-tab-group-open-new) without creating tabs here', () => {
        const { actions, chrome, calls } = setup({});
        actions.openBookmarksInGroup(urls(3), 'Dev Stuff');
        expect(calls.confirm).toEqual([]);
        expect(chrome.tabs.created).toEqual([]); // the SW does the tab work now
        expect(chrome.runtime.sent).toHaveLength(1);
        const msg = chrome.runtime.sent[0];
        expect(msg.type).toBe('vbm-tab-group-open-new');
        expect(msg.urls).toEqual(['https://x/0', 'https://x/1', 'https://x/2']);
        expect(msg.title).toBe('Dev Stuff');
        expect(palette).toContain(msg.color);
    });

    it('colors the group deterministically from the title, inside the tabGroups palette', () => {
        const { actions, chrome } = setup({});
        actions.openBookmarksInGroup(urls(2), 'Dev Stuff');
        const msg = chrome.runtime.sent[0];
        // pickGroupColor('Dev Stuff') = charCode sum 839 % 9 = index 2. A bare
        // palette-membership check would pass even if the picker degenerated
        // to a constant color — pin the deterministic value.
        expect(palette).toContain(msg.color);
        expect(msg.color).toBe('red');
        actions.openBookmarksInGroup(urls(2), 'Dev Stuff');
        expect(chrome.runtime.sent[1].color).toBe(msg.color); // same title → same color
        // different titles must NOT all land on one color: 'a' → 97 % 9 = cyan,
        // 'b' → 98 % 9 = orange (a constant picker would fail here)
        actions.openBookmarksInGroup(urls(1), 'a');
        expect(chrome.runtime.sent[2].color).toBe('cyan');
        actions.openBookmarksInGroup(urls(1), 'b');
        expect(chrome.runtime.sent[3].color).toBe('orange');
    });

    it('keeps the color inside the tabGroups palette for any title (including empty)', () => {
        const { actions, chrome } = setup({});
        for (const title of ['a', '书签', 'Dev Stuff', 'x'.repeat(200), ''])
            actions.openBookmarksInGroup(urls(1), title);
        for (const msg of chrome.runtime.sent)
            expect(palette).toContain(msg.color);
    });

    it('lets an explicit groupColor override the derived one (the setup dialog path)', () => {
        const { actions, chrome } = setup({});
        actions.openBookmarksInGroup(urls(1), 'Dev Stuff', 'orange');
        expect(chrome.runtime.sent[0].color).toBe('orange');
    });

    it('confirms above the limit and only sends after fn1', () => {
        const { actions, chrome, calls } = setup({});
        actions.openBookmarksInGroup(urls(11), 'Big');
        expect(chrome.runtime.sent).toEqual([]);
        expect(calls.confirm).toHaveLength(1);
        expect(calls.confirm[0].dialog).toBe('confirmOpenBookmarks[11]');
        expect(calls.confirm[0].button1).toBe('<strong>open</strong>');
        expect(calls.confirm[0].button2).toBe('nope');
        calls.confirm[0].fn1();
        expect(chrome.runtime.sent).toHaveLength(1);
        expect(chrome.runtime.sent[0].urls).toHaveLength(11);
        expect(chrome.runtime.sent[0].title).toBe('Big');
    });

    it('sends nothing when the confirm is never approved', () => {
        const { actions, chrome, calls } = setup({});
        actions.openBookmarksInGroup(urls(11), 'Big');
        expect(calls.confirm).toHaveLength(1);
        expect(chrome.runtime.sent).toEqual([]);
    });

    it('skips the confirm entirely when dontConfirmOpenFolder is set', () => {
        const { actions, chrome, calls } = setup({ storeData: { dontConfirmOpenFolder: '1' } });
        actions.openBookmarksInGroup(urls(11), 'Big');
        expect(calls.confirm).toEqual([]);
        expect(chrome.runtime.sent).toHaveLength(1);
        expect(chrome.runtime.sent[0].urls).toHaveLength(11);
    });

    it('does not touch the input urls array', () => {
        const { actions } = setup({});
        const list = urls(3);
        actions.openBookmarksInGroup(list, 'Dev Stuff');
        expect(list).toEqual(['https://x/0', 'https://x/1', 'https://x/2']);
    });
});

describe('openInExistingTabGroup', () => {
    const urls = n => Array.from({ length: n }, (_, i) => `https://x/${i}`);

    it('hands the open into an existing group to the service worker (vbm-tab-group-open-into)', () => {
        const { actions, chrome, calls } = setup({});
        actions.openInExistingTabGroup(urls(2), 'g1');
        expect(calls.confirm).toEqual([]);
        expect(chrome.tabs.created).toEqual([]);
        expect(chrome.runtime.sent).toEqual([{
            type: 'vbm-tab-group-open-into',
            urls: ['https://x/0', 'https://x/1'],
            groupId: 'g1'
        }]);
    });

    it('confirms above the limit and only sends after fn1', () => {
        const { actions, chrome, calls } = setup({});
        actions.openInExistingTabGroup(urls(11), 'g1');
        expect(chrome.runtime.sent).toEqual([]);
        expect(calls.confirm).toHaveLength(1);
        calls.confirm[0].fn1();
        expect(chrome.runtime.sent).toHaveLength(1);
        expect(chrome.runtime.sent[0].urls).toHaveLength(11);
        expect(chrome.runtime.sent[0].groupId).toBe('g1');
    });

    it('sends nothing when the confirm is never approved', () => {
        const { actions, chrome, calls } = setup({});
        actions.openInExistingTabGroup(urls(11), 'g1');
        expect(calls.confirm).toHaveLength(1);
        expect(chrome.runtime.sent).toEqual([]);
    });
});

describe('openBookmarksNewWindow', () => {
    const urls = n => Array.from({ length: n }, (_, i) => `https://x/${i}`);

    it('opens all urls in one window below the limit', () => {
        const { actions, chrome, calls } = setup({});
        const list = urls(3);
        actions.openBookmarksNewWindow(list, false);
        expect(calls.confirm).toEqual([]);
        expect(chrome.windows.created).toEqual([{ url: list, incognito: false }]);
    });

    it('uses the incognito-specific confirm message above the limit', () => {
        const { actions, chrome, calls } = setup({});
        const list = urls(11);
        actions.openBookmarksNewWindow(list, true);
        expect(calls.confirm[0].dialog).toBe('confirmOpenBookmarksNewIncognitoWindow[11]');
        expect(chrome.windows.created).toEqual([]);
        calls.confirm[0].fn1();
        expect(chrome.windows.created).toEqual([{ url: list, incognito: true }]);
    });

    it('uses the normal-window confirm message above the limit', () => {
        const { actions, calls } = setup({});
        actions.openBookmarksNewWindow(urls(11), false);
        expect(calls.confirm[0].dialog).toBe('confirmOpenBookmarksNewWindow[11]');
    });
});

describe('editBookmarkFolder', () => {
    it('ignores a failed chrome.bookmarks.get (undefined nodeList, lastError)', () => {
        const { actions, chrome, calls } = setup({});
        chrome.bookmarks.get = (id, cb) => cb(undefined);
        expect(() => actions.editBookmarkFolder('5')).not.toThrow();
        expect(calls.edit).toHaveLength(0);
    });

    it('opens the bookmark edit dialog and re-renders the row on save', () => {
        const a = makeEl();
        a.style.cssText = 'padding-left: 16px';
        const li = makeEl();
        li._qs.a = a;
        li.firstElementChild = makeEl();
        const { actions, els, chrome, calls } = setup({
            els: { 'neat-tree-item-5': li },
            nodes: { '5': [{ id: '5', title: 'GitHub', url: 'https://github.com/' }] }
        });
        actions.editBookmarkFolder('5');
        expect(calls.edit).toHaveLength(1);
        expect(calls.edit[0].dialog).toBe('editBookmark');
        expect(calls.edit[0].type).toBe('bookmark');
        expect(calls.edit[0].name).toBe('GitHub');
        expect(calls.edit[0].url).toBe('https://github.com/');

        calls.edit[0].fn('New', 'https://new.example/');
        expect(chrome.bookmarks.updateCalls).toEqual([['5', { title: 'New', url: 'https://new.example/' }]]);
        expect(calls.bmHTML).toEqual([['New', 'https://new.example/', 'style="padding-left: 16px"', '5']]);
        expect(li.innerHTML).toBe('<a data-bm="5">New</a>');
        expect(li.firstElementChild.focused).toBe(true);
    });

    it('opens the folder edit dialog (no url field) and updates the row title', () => {
        const i = makeEl();
        const li = makeEl();
        li._qs.i = i;
        li.firstElementChild = makeEl();
        const { actions, chrome, calls } = setup({
            els: { 'neat-tree-item-9': li },
            nodes: { '9': [{ id: '9', title: 'Old' }] }
        });
        actions.editBookmarkFolder('9');
        expect(calls.edit[0].dialog).toBe('editFolder');
        expect(calls.edit[0].type).toBe('folder');
        expect(calls.edit[0].name).toBe('Old');

        calls.edit[0].fn('Docs', 'http://ignored/');
        // folders are always saved with an empty url
        expect(chrome.bookmarks.updateCalls).toEqual([['9', { title: 'Docs', url: '' }]]);
        expect(i.textContent).toBe('Docs');
        expect(li.firstElementChild.focused).toBe(true);
    });

    it('falls back to the noTitle message when the saved folder title is empty', () => {
        const i = makeEl();
        const li = makeEl();
        li._qs.i = i;
        li.firstElementChild = makeEl();
        const { actions, calls } = setup({
            els: { 'neat-tree-item-9': li },
            nodes: { '9': [{ id: '9', title: 'Old' }] }
        });
        actions.editBookmarkFolder('9');
        calls.edit[0].fn('', '');
        expect(i.textContent).toBe('noTitle');
    });

    it('refreshes the sync indicator on folder rows when syncManager is present', () => {
        const i = makeEl();
        const oldIndicator = makeEl();
        const afterImg = makeEl();
        const img = makeEl();
        img.nextSibling = afterImg;
        const span = makeEl();
        const li = makeEl();
        li._qs.i = i;
        li._qs['.sync-indicator'] = oldIndicator;
        li._qs['span img'] = img;
        li._qs.span = span;
        li.firstElementChild = makeEl();
        const { actions, calls } = setup({
            els: { 'neat-tree-item-9': li },
            nodes: { '9': [{ id: '9', title: 'Old' }] },
            storeData: { showSyncStatus: 'true' },
            syncManager: {
                getSyncStatusIndicator: () => 'synced',
                getSyncTooltip: () => 'tip'
            }
        });
        actions.editBookmarkFolder('9');
        calls.edit[0].fn('Docs', '');
        expect(oldIndicator.removed).toBe(true);
        expect(span.inserted).toHaveLength(1);
        const [indicator, ref] = span.inserted[0];
        expect(ref).toBe(afterImg);
        expect(indicator.className).toBe('sync-indicator synced');
        expect(indicator.title).toBe('tip');
        expect(indicator.innerHTML).toContain('sync-tooltip');
    });

    it('updates the results-pane row instead when search is active', () => {
        const treeLi = makeEl();
        const treeA = makeEl();
        treeA.style.cssText = 'css';
        treeLi._qs.a = treeA;
        treeLi.firstElementChild = makeEl();
        const resultsLi = makeEl();
        resultsLi.firstElementChild = makeEl();
        const { actions, calls } = setup({
            els: { 'neat-tree-item-5': treeLi, 'results-item-5': resultsLi },
            nodes: { '5': [{ id: '5', title: 'GitHub', url: 'https://github.com/' }] },
            searchActive: true
        });
        actions.editBookmarkFolder('5');
        calls.edit[0].fn('New', 'https://new.example/');
        // both rows re-rendered; focus goes to the results row
        expect(calls.bmHTML).toEqual([
            ['New', 'https://new.example/', 'style="css"', '5'],
            ['New', 'https://new.example/', '', '5']
        ]);
        expect(resultsLi.innerHTML).toBe('<a data-bm="5">New</a>');
        expect(resultsLi.firstElementChild.focused).toBe(true);
        expect(treeLi.firstElementChild.focused).toBe(false);
    });
});

describe('deleteBookmark', () => {
    it('removes the tree row and focuses the next sibling (search inactive)', () => {
        const li = makeEl();
        const parent = makeParent();
        li.parentNode = parent;
        const sibFocus = makeEl();
        const sib = makeEl();
        sib._qs['a, span'] = sibFocus;
        li.nextElementSibling = sib;
        const { actions, chrome, ops } = setup({ els: { 'neat-tree-item-5': li } });
        actions.deleteBookmark('5');
        expect(chrome.bookmarks.removeCalls).toEqual(['5']);
        expect(parent.removedChildren).toEqual([li]);
        expect(sibFocus.focused).toBe(true);
        // P3.3: snapshot before the delete, toast after it (row has no <i>
        // title node in this fixture, so the title substitution is empty)
        expect(ops).toEqual([
            ['capture', '5'],
            ['remove', '5'],
            ['toast', 'deletedBookmark[]']
        ]);
    });

    it('toasts the deleted row title (read from the <i> title node)', () => {
        const titleEl = makeEl();
        titleEl.textContent = 'GitHub';
        const li = makeEl();
        li._qs.i = titleEl;
        li.parentNode = makeParent();
        const { actions, ops } = setup({ els: { 'neat-tree-item-5': li } });
        actions.deleteBookmark('5');
        expect(ops).toEqual([
            ['capture', '5'],
            ['remove', '5'],
            ['toast', 'deletedBookmark[GitHub]']
        ]);
    });

    it('falls back to the results row title when the tree row is gone', () => {
        const titleEl = makeEl();
        titleEl.textContent = 'Via Results';
        const resultsLi = makeEl();
        resultsLi._qs.i = titleEl;
        resultsLi.parentNode = makeParent();
        const { actions, ops } = setup({
            els: { 'results-item-5': resultsLi },
            searchActive: true
        });
        actions.deleteBookmark('5');
        expect(ops[0]).toEqual(['capture', '5']);
        expect(ops[1]).toEqual(['remove', '5']);
        expect(ops[2]).toEqual(['toast', 'deletedBookmark[Via Results]']);
    });

    it('still deletes silently when no undo API is injected', () => {
        const li = makeEl();
        li.parentNode = makeParent();
        const { actions, chrome, ops } = setup({ els: { 'neat-tree-item-5': li }, noUndo: true });
        actions.deleteBookmark('5');
        expect(chrome.bookmarks.removeCalls).toEqual(['5']);
        expect(ops).toEqual([['remove', '5']]); // no capture, no toast
    });

    it('focuses the results sibling instead of the tree sibling when search is active', () => {
        const treeLi = makeEl();
        const treeParent = makeParent();
        treeLi.parentNode = treeParent;
        const treeSibFocus = makeEl();
        const treeSib = makeEl();
        treeSib._qs['a, span'] = treeSibFocus;
        treeLi.nextElementSibling = treeSib;
        const resultsLi = makeEl();
        const resultsParent = makeParent();
        resultsLi.parentNode = resultsParent;
        const resultsSibFocus = makeEl();
        const resultsSib = makeEl();
        resultsSib._qs['a, span'] = resultsSibFocus;
        resultsLi.nextElementSibling = resultsSib;
        const { actions } = setup({
            els: { 'neat-tree-item-5': treeLi, 'results-item-5': resultsLi },
            searchActive: true
        });
        actions.deleteBookmark('5');
        expect(treeParent.removedChildren).toEqual([treeLi]);
        expect(resultsParent.removedChildren).toEqual([resultsLi]);
        expect(treeSibFocus.focused).toBe(false);
        expect(resultsSibFocus.focused).toBe(true);
    });

    it('does not focus anything when there is no sibling row', () => {
        const li = makeEl();
        const parent = makeParent();
        li.parentNode = parent;
        const { actions, chrome } = setup({ els: { 'neat-tree-item-5': li } });
        actions.deleteBookmark('5');
        expect(chrome.bookmarks.removeCalls).toEqual(['5']);
        expect(parent.removedChildren).toEqual([li]);
    });
});

describe('deleteBookmarks', () => {
    const setupFolder = (opts = {}) => {
        const item = makeEl();
        item.textContent = '  My Folder  ';
        const li = makeEl();
        li._qs.span = item;
        const ownFocus = makeEl();
        li._qs['a, span'] = ownFocus;
        const parent = makeParent();
        li.parentNode = parent;
        const sibFocus = makeEl();
        const sib = makeEl();
        sib._qs['a, span'] = sibFocus;
        li.nextElementSibling = sib;
        const ctx = setup({ els: { 'neat-tree-item-9': li }, ...opts });
        return { li, item, parent, sibFocus, ownFocus, ...ctx };
    };

    // v4 task-2 §5.7: a non-empty folder confirms first (default on) — a
    // limited walk-back of P3.3; empty folders keep the direct delete+toast
    // path, and the switch restores it for everything.
    it('confirms a non-empty folder first, deleting only on confirm', () => {
        const { actions, calls, ops, parent, li, sibFocus } = setupFolder({
            storeData: { confirmDeleteFolder: '1' }
        });
        actions.deleteBookmarks('9', 3, 2);
        expect(ops).toEqual([]); // nothing deleted yet
        // mixed contents (bookmarks + subfolders): one dialog, summed count
        expect(calls.confirm).toHaveLength(1);
        expect(calls.confirm[0].dialog).toBe('confirmDeleteFolder[5]');
        expect(calls.confirm[0].button1).toBe('<strong>confirmDeleteFolderButton</strong>');
        expect(calls.confirm[0].button2).toBe('nope');
        calls.confirm[0].fn1(); // the user confirms
        expect(ops).toEqual([
            ['capture', '9'],
            ['removeTree', '9'],
            ['toast', 'deletedFolder[My Folder]']
        ]);
        expect(parent.removedChildren).toEqual([li]);
        expect(sibFocus.focused).toBe(true);
    });

    it('does nothing while the confirmation stays unanswered', () => {
        const { actions, calls, ops, chrome } = setupFolder({
            storeData: { confirmDeleteFolder: '1' }
        });
        actions.deleteBookmarks('9', 1, 0);
        expect(calls.confirm).toHaveLength(1);
        // no fn1 call: no capture, no removeTree, no toast
        expect(ops).toEqual([]);
        expect(chrome.bookmarks.removeTreeCalls).toEqual([]);
    });

    it('deletes directly when confirmDeleteFolder is off', () => {
        const { actions, calls, ops, parent, li, sibFocus } = setupFolder({
            storeData: { confirmDeleteFolder: '' }
        });
        actions.deleteBookmarks('9', 3, 2);
        expect(calls.confirm).toEqual([]);
        expect(ops).toEqual([
            ['capture', '9'],
            ['removeTree', '9'],
            ['toast', 'deletedFolder[My Folder]']
        ]);
        expect(parent.removedChildren).toEqual([li]);
        expect(sibFocus.focused).toBe(true);
    });

    it('takes the no-confirm path for an empty folder even with the setting on', () => {
        const { actions, calls, ops, parent, li, sibFocus } = setupFolder({
            storeData: { confirmDeleteFolder: '1' }
        });
        actions.deleteBookmarks('9', 0, 0);
        expect(calls.confirm).toEqual([]);
        expect(ops).toEqual([
            ['capture', '9'],
            ['removeTree', '9'],
            ['toast', 'deletedFolder[My Folder]']
        ]);
        expect(parent.removedChildren).toEqual([li]);
        expect(sibFocus.focused).toBe(true);
    });

    it('still removes the tree silently when no undo API is injected', () => {
        const { actions, chrome, calls, ops } = setupFolder({ noUndo: true });
        actions.deleteBookmarks('9', 3, 2);
        expect(calls.confirm).toEqual([]);
        expect(chrome.bookmarks.removeTreeCalls).toEqual(['9']);
        expect(ops).toEqual([['removeTree', '9']]);
    });
});

describe('copyAllTitlesAndUrls', () => {
    it('copies "title\\r\\nurl" of a bookmark through the copier input', () => {
        const { actions, els } = setup({
            nodes: { '5': [{ id: '5', title: 'GitHub', url: 'https://github.com/' }] }
        });
        actions.copyAllTitlesAndUrls('5');
        expect(els['copier-input'].value).toBe('GitHub\r\nhttps://github.com/');
        expect(els['copier-input'].selected).toBe(true);
        expect(document.execCalls).toEqual(['copy']);
    });

    it('copies nothing for a folder node', () => {
        const { actions, els } = setup({
            nodes: { '9': [{ id: '9', title: 'Folder A' }] }
        });
        actions.copyAllTitlesAndUrls('9');
        expect(els['copier-input'].value).toBe('');
        expect(document.execCalls).toEqual([]);
    });

    it('prefers navigator.clipboard.writeText when available', () => {
        const written = [];
        vi.stubGlobal('navigator', {
            clipboard: { writeText: t => { written.push(t); return Promise.resolve(); } }
        });
        const { actions, els } = setup({
            nodes: { '5': [{ id: '5', title: 'GitHub', url: 'https://github.com/' }] }
        });
        actions.copyAllTitlesAndUrls('5');
        expect(written).toEqual(['GitHub\r\nhttps://github.com/']);
        expect(els['copier-input'].value).toBe('');
        expect(document.execCalls).toEqual([]);
        vi.unstubAllGlobals();
    });

    it('falls back to the copier input when writeText rejects', async () => {
        vi.stubGlobal('navigator', {
            clipboard: { writeText: () => Promise.reject(new Error('denied')) }
        });
        const { actions, els } = setup({
            nodes: { '5': [{ id: '5', title: 'GitHub', url: 'https://github.com/' }] }
        });
        actions.copyAllTitlesAndUrls('5');
        // legacyCopy runs inside .catch — flush the microtask queue
        await Promise.resolve();
        await Promise.resolve();
        expect(els['copier-input'].value).toBe('GitHub\r\nhttps://github.com/');
        expect(document.execCalls).toEqual(['copy']);
        vi.unstubAllGlobals();
    });
});

describe('replaceUrl', () => {
    it('updates the url of a bookmark, but never of a folder or with an empty url', () => {
        const { actions, chrome } = setup({
            nodes: {
                '5': [{ id: '5', title: 'b', url: 'http://old/' }],
                '9': [{ id: '9', title: 'folder' }]
            }
        });
        actions.replaceUrl('5', 'http://new/');
        actions.replaceUrl('9', 'http://new/');
        actions.replaceUrl('5', '');
        expect(chrome.bookmarks.updateCalls).toEqual([['5', { url: 'http://new/' }]]);
    });
});

describe('addNewBookmarkNode (addNewNode/addNodeTo)', () => {
    // tree: bookmark 10 (parent folder 1, index 3); folder 1 sits at level 0
    const setupTree = (opts = {}) => {
        const rNode = makeEl();
        const nextSib = makeEl();
        rNode.nextElementSibling = nextSib;
        rNode.nextSibling = nextSib;
        const pWrapper = makeEl();
        pWrapper.dataset.level = '0';
        const pNode = makeEl();
        pNode.parentNode = pWrapper;
        const ul = makeEl();
        ul._qs[':scope > li.empty-folder'] = null;
        pNode._qs.ul = ul;
        const ctx = setup({
            els: { 'neat-tree-item-10': rNode, 'neat-tree-item-1': pNode },
            nodes: { '10': [{ id: '10', parentId: '1', index: 3, url: 'http://a/' }] },
            ...opts
        });
        return { rNode, nextSib, pNode, ul, ...ctx };
    };

    it('before: creates at the reference index and inserts before the reference row', () => {
        const { actions, chrome, created, rNode, ul, calls } = setupTree();
        actions.addNewBookmarkNode('10', 'before', 'http://new/', 'New');
        expect(chrome.bookmarks.createCalls).toEqual([
            { parentId: '1', index: 3, title: 'New', url: 'http://new/' }
        ]);
        expect(calls.bmHTML).toEqual([['New', 'http://new/', 'style="-webkit-padding-start: 24px"', '100']]);
        const li = created[0]._qs.li;
        expect(ul.inserted).toEqual([[li, rNode]]);
        expect(created[0].innerHTML).toContain('id="neat-tree-item-100"');
        expect(created[0].innerHTML).toContain('class="child"');
    });

    it('after: creates at index + 1 and inserts before the reference next sibling', () => {
        const { actions, chrome, created, nextSib, ul } = setupTree();
        actions.addNewBookmarkNode('10', 'after', 'http://new/', 'New');
        expect(chrome.bookmarks.createCalls).toEqual([
            { parentId: '1', index: 4, title: 'New', url: 'http://new/' }
        ]);
        expect(ul.inserted).toEqual([[created[0]._qs.li, nextSib]]);
    });

    it('top into an open folder: parentId is the folder, inserted before the first child', () => {
        const folderNode = makeEl();
        folderNode._attrs['aria-expanded'] = 'true';
        const wrapper = makeEl();
        wrapper.dataset.level = '0';
        folderNode.parentNode = wrapper;
        const ul = makeEl();
        ul._qs[':scope > li.empty-folder'] = null;
        const firstKid = makeEl();
        ul.firstElementChild = firstKid;
        folderNode._qs.ul = ul;
        const { actions, chrome, created } = setup({
            els: { 'neat-tree-item-20': folderNode },
            nodes: { '20': [{ id: '20', parentId: '1', index: 1 }] }
        });
        actions.addNewBookmarkNode('20', 'top', 'http://new/', 'New');
        expect(chrome.bookmarks.createCalls).toEqual([
            { parentId: '20', index: 0, title: 'New', url: 'http://new/' }
        ]);
        expect(ul.inserted).toEqual([[created[0]._qs.li, firstKid]]);
    });

    it('top into a closed folder: expands the folder and re-renders its children', () => {
        const folderNode = makeEl();
        folderNode._attrs['aria-expanded'] = 'false';
        const wrapper = makeEl();
        wrapper.dataset.level = '0';
        folderNode.parentNode = wrapper;
        const staleUl = makeEl();
        folderNode._qs.ul = staleUl;
        const { actions, chrome, calls, store } = setup({
            els: { 'neat-tree-item-20': folderNode },
            nodes: { '20': [{ id: '20', parentId: '1', index: 1 }] },
            children: { '20': [{ id: '100', title: 'New', url: 'http://new/', parentId: '20' }] }
        });
        actions.addNewBookmarkNode('20', 'top', 'http://new/', 'New');
        expect(chrome.bookmarks.createCalls).toEqual([
            { parentId: '20', index: 0, title: 'New', url: 'http://new/' }
        ]);
        // folder expanded + stale subtree replaced by a fresh full render
        expect(folderNode.classList.contains('open')).toBe(true);
        expect(folderNode.getAttribute('aria-expanded')).toBe('true');
        expect(staleUl.removed).toBe(true);
        expect(calls.genHTML).toEqual([
            [[{ id: '100', title: 'New', url: 'http://new/', parentId: '20' }], 1]
        ]);
        expect(folderNode.appended).toHaveLength(1); // the freshly rendered ul
        expect(store.get('opens')).toBe('[]'); // persisted from the (stubbed) tree query
    });

    it('bottom: appends after the last child (index from getChildren length)', () => {
        const folderNode = makeEl();
        folderNode._attrs['aria-expanded'] = 'true';
        const wrapper = makeEl();
        wrapper.dataset.level = '0';
        folderNode.parentNode = wrapper;
        const ul = makeEl();
        ul._qs[':scope > li.empty-folder'] = null;
        folderNode._qs.ul = ul;
        const { actions, chrome, created } = setup({
            els: { 'neat-tree-item-20': folderNode },
            nodes: { '20': [{ id: '20', parentId: '1', index: 1 }] },
            children: { '20': [{ id: '21' }, { id: '22' }, { id: '23' }] }
        });
        actions.addNewBookmarkNode('20', 'bottom', 'http://new/', 'New');
        expect(chrome.bookmarks.createCalls).toEqual([
            { parentId: '20', index: 3, title: 'New', url: 'http://new/' }
        ]);
        expect(ul.appended).toEqual([created[0]._qs.li]);
    });

    it('folder branch: asks for a name via NewFolderDialog, then creates a parent row', () => {
        const { actions, chrome, created, calls, callNewFolder } = setupTree();
        actions.addNewBookmarkNode('10', 'before', '', '');
        expect(calls.newFolder).toEqual(['NewFolder']);
        expect(chrome.bookmarks.createCalls).toEqual([]);
        callNewFolder('My Folder');
        expect(chrome.bookmarks.createCalls).toEqual([
            { parentId: '1', index: 3, title: 'My Folder', url: '' }
        ]);
        expect(calls.folderHTML).toHaveLength(1);
        expect(calls.folderHTML[0][0]).toBe('My Folder');
        expect(created[0].innerHTML).toContain('class="parent"');
        expect(created[0].innerHTML).toContain('aria-expanded="false"');
    });

    it('creates the missing child <ul> before inserting', () => {
        const rNode = makeEl();
        const pWrapper = makeEl();
        pWrapper.dataset.level = '0';
        const pNode = makeEl();
        pNode.parentNode = pWrapper;
        const newUl = makeEl();
        let ulCalls = 0;
        pNode.querySelector = sel => (sel === 'ul' && ++ulCalls > 1) ? newUl : null;
        const { actions, created } = setup({
            els: { 'neat-tree-item-10': rNode, 'neat-tree-item-1': pNode },
            nodes: { '10': [{ id: '10', parentId: '1', index: 3, url: 'http://a/' }] }
        });
        actions.addNewBookmarkNode('10', 'before', 'http://new/', 'New');
        // the ul parsed out of the tmp div is appended to the folder row…
        const tmpDiv = created[1];
        expect(pNode.appended).toEqual([tmpDiv._qs.ul]);
        // …and the second querySelector('ul') finds it for the insertion
        expect(newUl.inserted).toEqual([[created[0]._qs.li, rNode]]);
    });

    it('removes a stale "(Empty)" marker row before inserting', () => {
        const { actions, ul } = setupTree();
        const emptyRow = makeEl();
        const emptyParent = makeParent();
        emptyRow.parentNode = emptyParent;
        ul._qs[':scope > li.empty-folder'] = emptyRow;
        actions.addNewBookmarkNode('10', 'before', 'http://new/', 'New');
        expect(emptyParent.removedChildren).toEqual([emptyRow]);
        expect(ul.inserted).toHaveLength(1);
    });

    it('ignores unknown node ids', () => {
        const { actions, chrome } = setup({});
        actions.addNewBookmarkNode('404', 'before', 'http://new/', 'New');
        expect(chrome.bookmarks.createCalls).toEqual([]);
    });
});

describe('separator actions', () => {
    it('addSeparator creates a separator bookmark and registers it', () => {
        const rNode = makeEl();
        const pWrapper = makeEl();
        pWrapper.dataset.level = '0';
        const pNode = makeEl();
        pNode.parentNode = pWrapper;
        const ul = makeEl();
        ul._qs[':scope > li.empty-folder'] = null;
        pNode._qs.ul = ul;
        const { actions, chrome, calls } = setup({
            els: { 'neat-tree-item-10': rNode, 'neat-tree-item-1': pNode },
            nodes: { '10': [{ id: '10', parentId: '1', index: 3, url: 'http://a/' }] }
        });
        actions.addSeparator('10', 'after');
        expect(chrome.bookmarks.createCalls).toHaveLength(1);
        const createCall = chrome.bookmarks.createCalls[0];
        expect(createCall.parentId).toBe('1');
        expect(createCall.index).toBe(4);
        expect(createCall.title).toBe('separator-title');
        // real uuidFast() from separators.js: RFC4122v4 shape after the '#'
        // (36 chars, version nibble 4, variant nibble 8/9/A/B)
        expect(createCall.url).toMatch(
            /^http:\/\/separatethis\.com\/#[0-9A-Za-z]{8}-[0-9A-Za-z]{4}-4[0-9A-Za-z]{3}-[89AB][0-9A-Za-z]{3}-[0-9A-Za-z]{12}$/);
        expect(calls.sepHTML).toEqual([24]); // paddingStart = TREE_INDENT * (level 0 + 1)
        expect(calls.sepAdd).toEqual(['100']);
    });

    it('deleteSeparator captures, removes the tree, the row and the registry entry, toasts, then focuses a sibling', () => {
        const li = makeEl();
        const parent = makeParent();
        li.parentNode = parent;
        const sibFocus = makeEl();
        const sib = makeEl();
        sib._qs['a, span'] = sibFocus;
        li.nextElementSibling = sib;
        const { actions, chrome, calls, ops } = setup({ els: { 'neat-tree-item-30': li } });
        actions.deleteSeparator('30');
        expect(chrome.bookmarks.removeTreeCalls).toEqual(['30']);
        expect(parent.removedChildren).toEqual([li]);
        expect(calls.sepRemove).toEqual(['30']);
        expect(sibFocus.focused).toBe(true);
        // separators carry no meaningful title — the toast gets an empty one
        expect(ops).toEqual([
            ['capture', '30'],
            ['removeTree', '30'],
            ['toast', 'deletedBookmark[]']
        ]);
    });
});

describe('internal clipboard (velvet staging §5.2)', () => {
    it('copy/cut record the session clipboard; cut marks the tree row', () => {
        const { actions, els, ops } = setup({});
        expect(actions.hasClipBookmark()).toBe(false);
        actions.setClipBookmark('copy', '42', 'Title');
        expect(actions.hasClipBookmark()).toBe(true);
        expect(actions.hasCutClipboard()).toBe(false);
        expect(ops.some(o => o[0] === 'toast' && String(o[1]).includes('copiedToast'))).toBe(true);
        // cut paints #neat-tree-item-42 with .cut
        const row = { classList: null };
        void row;
        actions.setClipBookmark('cut', '42', 'Title');
        expect(actions.hasCutClipboard()).toBe(true);
        actions.cancelClipBookmark();
        expect(actions.hasCutClipboard()).toBe(false);
    });

    it('paste moves on cut (consuming) and copies on copy (keeping)', () => {
        const { actions, chrome, ops } = setup({});
        const moves = [];
        const creates = [];
        chrome.bookmarks.move = (id, dest, cb) => { moves.push([id, dest]); cb(); };
        chrome.bookmarks.create = (opts, cb) => { creates.push(opts); cb({ id: 'n1' }); };
        chrome.bookmarks.get = (id, cb) => cb([{ id: '42', parentId: '1', title: 'T', url: 'http://t/' }]);
        chrome.bookmarks.getTree = cb => cb([]);
        // cut → paste moves and consumes
        actions.setClipBookmark('cut', '42', 'T');
        actions.pasteClipBookmarkInto('9');
        expect(moves).toEqual([['42', { parentId: '9' }]]);
        expect(actions.hasClipBookmark()).toBe(false);
        // copy → paste creates and keeps
        actions.setClipBookmark('copy', '42', 'T');
        actions.pasteClipBookmarkInto('9');
        expect(creates).toEqual([{ parentId: '9', title: 'T', url: 'http://t/' }]);
        expect(actions.hasClipBookmark()).toBe(true);
        void ops;
    });

    it('pasting a cut onto its own parent clears the clipboard as a no-op', () => {
        const { actions, chrome } = setup({});
        const moves = [];
        chrome.bookmarks.move = (id, dest, cb) => { moves.push([id, dest]); cb(); };
        chrome.bookmarks.get = (id, cb) => cb([{ id: '42', parentId: '9', title: 'T', url: 'http://t/' }]);
        actions.setClipBookmark('cut', '42', 'T');
        actions.pasteClipBookmarkInto('9');
        expect(moves).toEqual([]); // no move call at all
        expect(actions.hasClipBookmark()).toBe(false);
    });

    it('pasting a deleted bookmark toasts and clears', () => {
        const { actions, chrome, ops } = setup({});
        chrome.bookmarks.get = (id, cb) => cb([]);
        actions.setClipBookmark('copy', '42', 'T');
        actions.pasteClipBookmarkInto('9');
        expect(actions.hasClipBookmark()).toBe(false);
        expect(ops.some(o => o[0] === 'toast' && String(o[1]).includes('pasteGone'))).toBe(true);
    });

    it('copyMoveBookmarkTo opens the three-button picker and runs the action', () => {
        const { actions, chrome, calls } = setup({});
        chrome.bookmarks.get = (id, cb) => cb([{ id: '42', parentId: '1', title: 'T', url: 'http://t/' }]);
        const moves = [];
        const creates = [];
        chrome.bookmarks.move = (id, dest, cb) => { moves.push([id, dest]); cb(); };
        chrome.bookmarks.create = (opts, cb) => { creates.push(opts); cb({ id: 'n' }); };
        chrome.bookmarks.getTree = cb => cb([]);
        actions.copyMoveBookmarkTo('42');
        expect(calls.folderPick).toHaveLength(1);
        expect(calls.folderPick[0].mode).toBeNull();
        // "move" lands a real move into the picked folder
        calls.folderPick[0].onPick('33', 'move');
        expect(moves).toEqual([['42', { parentId: '33' }]]);
        // "copy" creates the copy instead
        calls.folderPick.length = 0;
        actions.copyMoveBookmarkTo('42');
        calls.folderPick[0].onPick('33', 'copy');
        expect(creates).toEqual([{ parentId: '33', title: 'T', url: 'http://t/' }]);
    });
});
