import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// The secret path hashes two internal passphrases through src/md5.js. The md5
// CONTRACT is covered by tests/md5.test.js; here the dependency is mocked so
// the positive palette path can be exercised without publishing the real
// passphrases in the test suite (audit T6).
vi.mock('../src/md5.js', () => ({
    md5: vi.fn(input => {
        if (input === 'button-alt-on')
            return 'bf285bb57eb641398ac4ed966f36bec7';
        if (input === 'button-alt-off')
            return '6b8a47190afe19339577578962fa9f6c';
        return '00000000000000000000000000000000';
    })
}));

// palette.js touches page globals (document/window/chrome) only inside
// initPalette and its handlers, so the real module imports cleanly in node
// once the globals are stubbed. The element stubs wire `_listeners` +
// `fn.call(el, ev)` dispatch; innerHTML='' resets the appendChild record the
// way the real DOM drops children. chrome.bookmarks.getTree / chrome.tabs.query
// are recording doubles fed from per-test tables; chrome.i18n.getMessage is a
// message-table double. window.VBMFuzzy is the REAL implementation (fuzzy.js
// evaluated with window = globalThis), so ranking assertions exercise the
// actual fzf-style scoring. Nothing is copied from the module body.
//
// v4 task-2 §3.5/§4.4: the dupes/dead sub-modes are retired (that UI moved
// to src/view-dupes.js / src/view-dead.js with their own suites); the
// palette is a flat command list again — every view a Go command, every
// command a slash alias, plus the search-view bridge row on plain queries.

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
    for (const fn of (el._listeners[type] || []))
        fn.call(el, ev); // a listener's `this` is the element it is bound to
};

let initPalette;
let VBMFuzzy;
let PALETTE_RESERVED;

beforeAll(async () => {
    globalThis.window = globalThis; // fuzzy.js is a classic script: window = page global
    await import('../src/fuzzy.js');
    VBMFuzzy = globalThis.VBMFuzzy;
    ({ initPalette } = await import('../src/palette.js'));
    ({ PALETTE_RESERVED } = await import('../src/palette-commands.js'));
});

afterAll(() => {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.chrome;
    delete globalThis.localStorage;
    delete globalThis.VBMFuzzy;
});

const MSGS = {
    paletteCmdQuickAdd: 'Bookmark current tab',
    paletteCmdNewBookmark: 'New bookmark…',
    paletteCmdNewFolder: 'New folder…',
    paletteCmdNewSeparator: 'New separator',
    paletteCmdSaveSession: 'Save window tabs as folder',
    paletteCmdGoTree: 'Go to Tree view',
    paletteCmdGoSearch: 'Go to Search view',
    paletteCmdGoTabGroups: 'Go to Tab groups view',
    paletteCmdGoRecent: 'Go to Recent view',
    paletteCmdGoStats: 'Go to Stats view',
    paletteCmdGoDead: 'Go to Dead links view',
    paletteCmdGoDupes: 'Go to Duplicates view',
    paletteCmdTheme: 'Set theme…',
    paletteCmdThemeUsage: 'Usage: /theme auto|light|dark|ink|paper',
    optionThemeDark: 'Dark',
    optionThemeLight: 'Light',
    optionThemeInk: 'Ink (dark)',
    optionThemePaper: 'Paper (light)',
    paletteCmdToggleViewTabs: 'Toggle view tabs',
    paletteCmdVersion: 'Version info',
    paletteCmdLang: 'Switch language…',
    paletteCmdOptions: 'Open options page',
    paletteCmdSearchInView: "Search '$1' in Search view",
    paletteCmdSaveAsCommand: "Save '$1' as a custom command",
    paletteCustomTag: 'custom',
    paletteCustomDeleteConfirm: "Delete the custom command '$1'? It syncs to every device.",
    paletteCustomBroken: "The bookmark folder of '$1' no longer exists. Delete the command?",
    delete: 'Delete',
    nope: 'Nope',
    sessionFolderName: 'Session $date$',
    sessionSaved: 'Saved $1 tabs to a new folder',
    sessionEmpty: 'No tabs to save',
    palettePlaceholder: 'Search bookmarks, folders, commands…',
    paletteNoResults: 'No matching results',
    noTitle: '(no title)'
};

// The full command table in order (v4 task-4 #5's cleanup — 19 entries after
// round-5's four direct theme switches and 4.0.8's /version + /lang, one
// slash name plus at most one alias each): create-style commands, session,
// one Go command per registered view, the parameterized /theme, the four
// direct theme switches, the /tabs toggle, /version, /lang, /options last.
// The retired /sep (round-4 item 2) and the retired five theme commands +
// /path (v4 task-4 #5) are gone from the table; the /sep message stays in
// MSGS so the absence test can assert against it.
const COMMAND_MSGS = [
    MSGS.paletteCmdQuickAdd, MSGS.paletteCmdNewBookmark, MSGS.paletteCmdNewFolder,
    MSGS.paletteCmdSaveSession, MSGS.paletteCmdGoTree,
    MSGS.paletteCmdGoSearch, MSGS.paletteCmdGoTabGroups, MSGS.paletteCmdGoRecent, MSGS.paletteCmdGoStats,
    MSGS.paletteCmdGoDead, MSGS.paletteCmdGoDupes,
    MSGS.paletteCmdTheme,
    MSGS.optionThemeDark, MSGS.optionThemeLight, MSGS.optionThemeInk, MSGS.optionThemePaper,
    MSGS.paletteCmdToggleViewTabs, MSGS.paletteCmdVersion, MSGS.paletteCmdLang, MSGS.paletteCmdOptions
];

// chrome.i18n.getMessage double: $1/$2 substitution on top of the table.
const getMessage = (key, subs) => {
    let msg = key in MSGS ? MSGS[key] : key;
    if (subs !== undefined) {
        const arr = Array.isArray(subs) ? subs : [subs];
        msg = msg.replace(/\$(\d+)/g, (m, n) => (arr[n - 1] !== undefined ? arr[n - 1] : m));
    }
    return msg;
};

// Root '0' (synthetic), two root folders, one nested folder with a bookmark.
const makeTree = () => [{
    id: '0',
    title: '',
    children: [
        {
            id: '1', title: 'Bookmarks bar', dateAdded: 10,
            children: [
                { id: '11', title: 'Gmail', url: 'https://mail.google.com/', dateAdded: 100 },
                { id: '12', title: 'mail archive', url: 'https://gmail.com/inbox', dateAdded: 200 },
                { id: '13', title: 'New bookmark ideas', url: 'https://example.com/ideas', dateAdded: 300 },
                {
                    id: '14', title: 'Dev', dateAdded: 400,
                    children: [
                        { id: '15', title: 'GitHub', url: 'https://github.com/', dateAdded: 500 }
                    ]
                }
            ]
        },
        { id: '2', title: 'Other bookmarks', dateAdded: 20, children: [] }
    ]
}];

const setup = (opts = {}) => {
    const byId = {};
    const allEls = [];
    const el = (tagName = 'DIV', id = '') => {
        const classes = new Set();
        const node = {
            tagName,
            id,
            style: {},
            dataset: {},
            parentNode: null,
            focused: false,
            blurred: false,
            value: '',
            placeholder: '',
            hidden: false,
            textContent: '',
            _attrs: {},
            _listeners: {},
            _appended: [],
            _innerHTML: '',
            classList: {
                add: c => classes.add(c),
                remove: c => classes.delete(c),
                contains: c => classes.has(c),
                toggle: (c, force) => {
                    const want = force === undefined ? !classes.has(c) : !!force;
                    if (want) classes.add(c); else classes.delete(c);
                    return want;
                }
            },
            addEventListener(type, fn) {
                (this._listeners[type] = this._listeners[type] || []).push(fn);
            },
            appendChild(child) {
                this._appended.push(child);
                child.parentNode = this;
            },
            contains(node2) {
                for (let n = node2; n; n = n.parentNode)
                    if (n === this) return true;
                return false;
            },
            focus() {
                this.focused = true;
                if (doc)
                    doc.activeElement = this;
            },
            blur() {
                this.blurred = true;
                if (doc && doc.activeElement === this)
                    doc.activeElement = null;
            },
            scrollIntoView(arg) {
                this._scrolledIntoView = (this._scrolledIntoView || 0) + 1;
                this._lastScrollArg = arg;
            },
            setAttribute(k, v) {
                this._attrs[k] = v;
            },
            getAttribute(k) {
                return k in this._attrs ? this._attrs[k] : null;
            }
        };
        // innerHTML='' drops the children, like the real DOM
        Object.defineProperty(node, 'innerHTML', {
            get() {
                return node._innerHTML;
            },
            set(v) {
                node._innerHTML = v;
                if (v === '')
                    node._appended = [];
            }
        });
        if (id)
            byId[id] = node;
        allEls.push(node);
        return node;
    };

    const body = el('BODY', 'body');
    for (const cls of (opts.bodyClasses || []))
        body.classList.add(cls);
    // the .active-row lookup the menu-open guards (Escape/focusout) rely on
    body.querySelector = sel =>
        sel === '.active' ? (allEls.find(n => n.classList.contains('active')) || null) : null;
    const paletteEl = el('DIV', 'command-palette');
    paletteEl.hidden = true;
    const input = el('INPUT', 'palette-input');
    const results = el('UL', 'palette-results');
    // Final polish: the × affordance and the footer close button (markup in
    // popup.html/sidepanel.html mirrors this).
    const clearBtn = el('BUTTON', 'palette-clear');
    const closeBtn = el('BUTTON', 'palette-close');
    closeBtn.querySelector = () => null; // the .palette-close-label span is markup-only here
    const tree = el('DIV', 'tree');

    const qsTable = opts.qs || {};
    const doc = {
        _listeners: {},
        activeElement: null, // tracked by the el() stub's focus()/blur()
        body,
        getElementById: id => byId[id] || null,
        createElement: tag => el(tag.toUpperCase()),
        querySelector: sel => (sel in qsTable ? qsTable[sel] : null),
        // context-menu.js's menus are the menu[type=context] elements; the
        // palette's menu-visibility check (the K6 contract) scans them
        querySelectorAll: sel =>
            sel === 'menu[type=context]'
                ? allEls.filter(n => n.tagName === 'MENU' && n.getAttribute('type') === 'context')
                : [],
        addEventListener(type, fn) {
            (this._listeners[type] = this._listeners[type] || []).push(fn);
        },
        removeEventListener(type, fn) {
            const arr = this._listeners[type];
            if (arr) {
                const i = arr.indexOf(fn);
                if (i >= 0)
                    arr.splice(i, 1);
            }
        }
    };
    globalThis.document = doc;

    const treeData = opts.tree || makeTree();
    const tab = 'tab' in opts ? opts.tab : { id: 7, url: 'https://tab.example/', title: 'Tab Title' };
    const chromeStub = {
        i18n: { getMessage, getUILanguage: () => 'en' },
        bookmarks: {
            getTreeCalls: 0,
            createCalls: [],
            getChildrenCalls: [],
            getTree(cb) {
                this.getTreeCalls++;
                cb(treeData);
            },
            create(props, cb) {
                this.createCalls.push(props);
                cb({ id: `n${this.createCalls.length}`, ...props });
            },
            // v4 task-4 #6: open-url-group custom commands list a folder's
            // children; an id missing from opts.children reports lastError
            // (the gone-folder path, design §8).
            getChildren(id, cb) {
                this.getChildrenCalls.push(id);
                const kids = (opts.children || {})[id];
                if (!kids) {
                    chromeStub.runtime.lastError = { message: "Can't find folder" };
                    cb(undefined);
                } else {
                    chromeStub.runtime.lastError = null;
                    cb(kids);
                }
            }
        },
        tabs: {
            queryCalls: [],
            createCalls: [],
            query(q, cb) {
                this.queryCalls.push(q);
                // opts.tabs (array) serves the multi-tab session flow;
                // opts.tab keeps the single-active-tab command working.
                cb('tabs' in opts ? opts.tabs : (tab ? [tab] : []));
            },
            // v4 task-4 #6: the custom-command hand-off opens the options
            // page in a new tab (create prefill / edit by id via the hash).
            create(props) {
                this.createCalls.push(props);
            }
        },
        windows: { WINDOW_ID_CURRENT: -1 },
        runtime: {
            lastError: null,
            getURL: p => `chrome-extension://test${p}`,
            getManifest: () => ({ version: '4.0.8', manifest_version: 3 }),
            openOptionsPageCalls: 0,
            openOptionsPage() {
                this.openOptionsPageCalls++;
            }
        }
    };
    globalThis.chrome = chromeStub;

    // The theme commands read/flip settings through ctx.store (an in-memory
    // double). Since the 2026-08 storage audit the theme's localStorage boot
    // copy is maintained inside store.js, so palette.js never touches
    // localStorage and no double is installed for it.
    const storeData = { ...(opts.storeSeed || {}) };
    const store = {
        setCalls: [],
        syncSetCalls: [],
        get(key, defaultValue) {
            return key in storeData ? storeData[key] : defaultValue;
        },
        set(key, value) {
            storeData[key] = value;
            this.setCalls.push([key, value]);
        },
        // v4 task-4 #6: paletteCustomCommands lives in the sync mirror.
        getSyncSetting(key, defaultValue) {
            return key in storeData ? storeData[key] : defaultValue;
        },
        setSyncSetting(key, value) {
            storeData[key] = String(value);
            this.syncSetCalls.push([key, value]);
        }
    };

    const actions = {
        openBookmarkCalls: [],
        openBookmarkNewTabCalls: [],
        openBookmarkNewWindowCalls: [],
        openBookmarksCalls: [],
        openBookmarksNewWindowCalls: [],
        addNewBookmarkNodeCalls: [],
        addSeparatorCalls: [],
        deleteBookmarkCalls: [],
        openBookmark(url) {
            this.openBookmarkCalls.push(url);
        },
        openBookmarkNewTab(url, selected) {
            this.openBookmarkNewTabCalls.push([url, selected]);
        },
        openBookmarkNewWindow(url) {
            this.openBookmarkNewWindowCalls.push(url);
        },
        openBookmarks(urls, selected) {
            this.openBookmarksCalls.push([urls, selected]);
        },
        openBookmarksNewWindow(urls) {
            this.openBookmarksNewWindowCalls.push(urls);
        },
        addNewBookmarkNode(nodeId, where, url, title) {
            this.addNewBookmarkNodeCalls.push([nodeId, where, url, title]);
        },
        addSeparator(nodeId, where) {
            this.addSeparatorCalls.push([nodeId, where]);
        },
        deleteBookmark(id) {
            this.deleteBookmarkCalls.push(id);
        }
    };
    const treeView = {
        revealFolderCalls: [],
        revealFolder(id) {
            this.revealFolderCalls.push(id);
        }
    };
    // v4 task-2: the Go commands ride view-manager's activate; the search
    // command and bridge row ride search.run (it activates the search view
    // itself, so the double only records the query).
    const views = {
        activateCalls: [],
        activate(id) {
            this.activateCalls.push(id);
            return true;
        },
        // 4.0.8: hidden/disabled views report false here; palette commands
        // for them never render.
        isAvailable: () => true,
        // K13: opt-in focusActive recorder — close()'s focus handback falls
        // back to the ACTIVE view's anchor when the tree row is hidden.
        ...(opts.withFocusActive ? {
            focusActiveCalls: 0,
            focusActive() { this.focusActiveCalls++; }
        } : {}),
        ...(opts.views || {})
    };
    const search = {
        runCalls: [],
        recordCalls: [],
        run(q) {
            this.runCalls.push(q);
        },
        // v4 task-4 #3: palette-driven plain-query bookmark opens record here
        record(q, n) {
            this.recordCalls.push([q, n]);
        }
    };
    const quickAddCalls = [];
    const dialogs = {
        // dialogs.js's anyOpen() contract over the body class set — the
        // palette delegates the modal-layer question to it (no local copy).
        anyOpen: () => ['needConfirm', 'needEdit', 'needAlert', 'needInputName', 'needSort',
            'needTabGroup', 'needGroupPick', 'needCopyMove', 'needFolderPick'].some(c => body.classList.contains(c)),
        AlertDialog: {
            openCalls: [],
            open(msg) {
                this.openCalls.push(msg);
            }
        },
        // v4 task-4 #6: the custom-command delete confirm + the gone-folder
        // prompt record their config; tests invoke cfg.fn1() to confirm.
        ConfirmDialog: {
            openCalls: [],
            open(cfg) {
                this.openCalls.push(cfg);
            }
        },
        // 4.0.8: the /version command's metadata dialog records its meta.
        VersionDialog: {
            openCalls: [],
            open(meta) {
                this.openCalls.push(meta);
            }
        }
    };
    const onChangedCalls = [];
    const palette = initPalette({
        store,
        actions,
        treeView,
        views,
        search,
        quickAdd: () => quickAddCalls.push(1),
        rootFolderId: opts.rootFolderId || '1',
        dialogs,
        clearMenu: opts.clearMenu,
        onChanged: () => onChangedCalls.push(1)
    });

    const keydown = (target, props) => {
        const ev = makeEvent(props);
        fire(target, 'keydown', ev);
        return ev;
    };
    // A visible context menu: context-menu.js shows a menu by setting inline
    // opacity '1' on its menu[type=context] element — the K6 visibility
    // contract the palette's menu guards key off (a bare .active marker is
    // stale state once the menu is gone).
    const showMenu = () => {
        const m = el('MENU');
        m.setAttribute('type', 'context');
        m.style.opacity = '1';
        return m;
    };
    const type = q => {
        input.value = q;
        fire(input, 'input', makeEvent({}));
    };
    const rowClasses = () => results._appended.map(li => li.className);
    const selectedIndex = () => results._appended.findIndex(li => li.classList.contains('selected'));

    return {
        palette, doc, body, chrome: chromeStub, actions, treeView, views, search,
        quickAddCalls, paletteEl, input, results, clearBtn, closeBtn, tree, el, treeData, dialogs,
        onChangedCalls, keydown, type, rowClasses, selectedIndex, store, showMenu
    };
};

describe('module API + open/close state machine', () => {
    it('returns { open, close, isOpen, refocus, customMenu } and starts closed', () => {
        const { palette, paletteEl } = setup({});
        expect(Object.keys(palette).sort()).toEqual(['close', 'customMenu', 'isOpen', 'open', 'refocus']);
        expect(palette.isOpen()).toBe(false);
        expect(paletteEl.hidden).toBe(true);
    });

    it('paletteEnabled off blocks every open path (v4 task-3 #20)', () => {
        const { palette, paletteEl, input, doc, keydown } = setup({ storeSeed: { paletteEnabled: '' } });
        palette.open();
        expect(palette.isOpen()).toBe(false);
        expect(paletteEl.hidden).toBe(true);
        expect(input.focused).toBe(false);
        keydown(doc, { key: 'k', ctrlKey: true }); // the Ctrl/Cmd+K binding too
        expect(palette.isOpen()).toBe(false);
    });

    it('open shows the panel, clears and focuses the input, sets the placeholder via i18n', () => {
        const { palette, paletteEl, input } = setup({});
        input.value = 'stale';
        palette.open();
        expect(palette.isOpen()).toBe(true);
        expect(paletteEl.hidden).toBe(false);
        expect(input.value).toBe('');
        expect(input.focused).toBe(true);
        expect(input.placeholder).toBe(MSGS.palettePlaceholder);
    });

    it('open dismisses an open context menu first (round-3 item 3)', () => {
        const clearMenuCalls = [];
        const { palette } = setup({ clearMenu: () => clearMenuCalls.push(1) });
        palette.open();
        expect(clearMenuCalls).toEqual([1]);
        expect(palette.isOpen()).toBe(true);
    });

    it('close hides the panel and flips isOpen back', () => {
        const { palette, paletteEl } = setup({});
        palette.open();
        palette.close();
        expect(palette.isOpen()).toBe(false);
        expect(paletteEl.hidden).toBe(true);
    });

    it('rebuilds the index through chrome.bookmarks.getTree on every open', () => {
        const { palette, chrome } = setup({});
        palette.open();
        palette.open(); // already open: no-op, no second getTree
        expect(chrome.bookmarks.getTreeCalls).toBe(1);
        palette.close();
        palette.open();
        expect(chrome.bookmarks.getTreeCalls).toBe(2);
    });

    it('refuses to open while any dialog class sits on body', () => {
        for (const cls of ['needConfirm', 'needEdit', 'needAlert', 'needInputName', 'needSort', 'needTabGroup', 'needGroupPick', 'needCopyMove', 'needFolderPick']) {
            const { palette, chrome, body } = setup({});
            body.classList.add(cls);
            palette.open();
            expect(palette.isOpen()).toBe(false);
            expect(chrome.bookmarks.getTreeCalls).toBe(0);
            body.classList.remove(cls);
            palette.open();
            expect(palette.isOpen()).toBe(true);
        }
    });

    it('close hands focus back to the tree row carrying .focus', () => {
        const row = setup({}).el('A');
        const { palette, input } = setup({ qs: { '#tree .focus': row } });
        palette.open();
        palette.close();
        expect(row.focused).toBe(true);
        expect(input.blurred).toBe(false);
    });

    it('close over a NON-tree view lands on the active view\'s anchor, never the hidden tree row (K13)', () => {
        // The palette opens over any view; outside the tree view #tree's
        // section is hidden and focusing its row is a no-op that strands the
        // keys on the hidden input — the handback must skip invisible targets.
        const hiddenSection = setup({}).el('SECTION', 'view-tree');
        hiddenSection.hidden = true; // view-manager sets this on the inactive view
        const row = setup({}).el('A');
        row.parentNode = hiddenSection;
        const { palette, input, views } = setup({ qs: { '#tree .focus': row }, withFocusActive: true });
        palette.open();
        palette.close();
        expect(row.focused).toBe(false); // focus() into the hidden section would strand
        expect(views.focusActiveCalls).toBe(1); // the active view's own anchor instead
        expect(input.blurred).toBe(false);
    });

    it('close blurs the input when no tree row is available', () => {
        const { palette, input } = setup({});
        palette.open();
        palette.close();
        expect(input.blurred).toBe(true);
    });
});

// Opener restore — the keyboard-only continuity contract: a keyboard dismiss
// (Esc / Ctrl+K toggle / the footer close button) hands focus back to the
// element that owned it before the panel opened — the search box or a header
// tool button — so the keys resume there instead of the view's
// first/remembered row. Plain close() (command execution, pointer paths)
// keeps the tree/view handback: the running action or the click target
// decides where focus goes.
describe('dismiss hands focus back to the opener', () => {
    it('Esc on the input returns focus to the element that owned it before the open', () => {
        const { palette, input, doc, keydown, el } = setup({});
        const searchBox = el('INPUT', 'search-input');
        searchBox.focus(); // the user was typing in the search box
        palette.open();
        expect(doc.activeElement).toBe(input); // the panel owns the keys now
        keydown(input, { key: 'Escape' });
        expect(palette.isOpen()).toBe(false);
        expect(doc.activeElement).toBe(searchBox); // back where the user was
    });

    it('the footer close button (click) hands focus back to the opener', () => {
        const { palette, closeBtn, doc, el } = setup({});
        const toolBtn = el('BUTTON', 'tool-btn');
        toolBtn.focus();
        palette.open();
        fire(closeBtn, 'click', makeEvent({}));
        expect(palette.isOpen()).toBe(false);
        expect(doc.activeElement).toBe(toolBtn);
    });

    it('Ctrl+K while open (toggle-back) returns focus to the opener', () => {
        const { palette, doc, keydown, el } = setup({});
        const searchBox = el('INPUT', 'search-input');
        searchBox.focus();
        keydown(doc, { ctrlKey: true, key: 'k' }); // open
        expect(palette.isOpen()).toBe(true);
        keydown(doc, { ctrlKey: true, key: 'k' }); // close — toggle-back
        expect(palette.isOpen()).toBe(false);
        expect(doc.activeElement).toBe(searchBox);
    });

    it('a gone opener (removed from the DOM) falls back to the tree handback', () => {
        const row = setup({}).el('A');
        const { palette, doc, el } = setup({ qs: { '#tree .focus': row } });
        const searchBox = el('INPUT', 'search-input');
        searchBox.focus();
        palette.open();
        searchBox.isConnected = false; // the element vanished while the panel was up
        palette.close({ back: true });
        expect(doc.activeElement).not.toBe(searchBox);
        expect(row.focused).toBe(true); // the tree handback ran instead
    });

    it('a hidden opener falls back to the ACTIVE view anchor (K13)', () => {
        const { palette, doc, el, views } = setup({ withFocusActive: true });
        const toolBtn = el('BUTTON', 'tool-btn');
        toolBtn.hidden = true;
        toolBtn.focus();
        palette.open();
        palette.close({ back: true });
        expect(doc.activeElement).not.toBe(toolBtn); // invisible targets are never focused
        expect(views.focusActiveCalls).toBe(1);
    });

    it('plain close() — command/pointer paths — keeps the tree handback, never the opener', () => {
        const { palette, input, doc, el } = setup({});
        const searchBox = el('INPUT', 'search-input');
        searchBox.focus();
        palette.open();
        palette.close(); // no `back`: a command executed / a click landed elsewhere
        expect(palette.isOpen()).toBe(false);
        expect(doc.activeElement).not.toBe(searchBox); // the opener is NOT yanked back
        expect(input.blurred).toBe(true); // no tree row in the stub: blur fallback
    });
});

describe('Ctrl/Cmd+K toggle', () => {
    it('Ctrl+K opens then closes, eating the event both times', () => {
        const { palette, doc, keydown } = setup({});
        const ev1 = keydown(doc, { ctrlKey: true, key: 'k' });
        expect(ev1.defaultPrevented).toBe(true);
        expect(palette.isOpen()).toBe(true);
        const ev2 = keydown(doc, { ctrlKey: true, key: 'k' });
        expect(ev2.defaultPrevented).toBe(true);
        expect(palette.isOpen()).toBe(false);
    });

    it('Cmd+K (metaKey, uppercase) toggles too', () => {
        const { palette, doc, keydown } = setup({});
        keydown(doc, { metaKey: true, key: 'K' });
        expect(palette.isOpen()).toBe(true);
    });

    it('an unmodified k does nothing', () => {
        const { palette, doc, keydown } = setup({});
        const ev = keydown(doc, { key: 'k' });
        expect(ev.defaultPrevented).toBe(false);
        expect(palette.isOpen()).toBe(false);
    });

    it('Ctrl+K is a no-op while a dialog is open', () => {
        const { palette, doc, body, keydown } = setup({});
        body.classList.add('needEdit');
        const ev = keydown(doc, { ctrlKey: true, key: 'k' });
        expect(ev.defaultPrevented).toBe(false);
        expect(palette.isOpen()).toBe(false);
    });
});

// Round-3: the panel dismisses when keyboard focus leaves it (the pointer
// path is the outside-mousedown guard; this is the Tab/arrow path).
describe('focusout dismissal (round-3 item 1)', () => {
    const fireFocusout = (paletteEl, relatedTarget) => {
        for (const fn of (paletteEl._listeners.focusout || []))
            fn.call(paletteEl, { relatedTarget });
    };

    it('focus moving outside the panel closes it', () => {
        const { palette, paletteEl, input, el } = setup({});
        palette.open();
        const outside = el('DIV', 'view-tabs');
        fireFocusout(paletteEl, outside);
        expect(palette.isOpen()).toBe(false);
        expect(input.blurred).toBe(true); // no tree row in the stub: blur fallback
    });

    it('focus moving into a palette row keeps the panel open', () => {
        const { palette, paletteEl, el } = setup({});
        palette.open();
        const row = el('LI');
        paletteEl.appendChild(row); // inside the panel
        fireFocusout(paletteEl, row);
        expect(palette.isOpen()).toBe(true);
    });

    it('a context menu open over the panel holds it (focus went to the menu)', () => {
        const clearMenuCalls = [];
        const { palette, paletteEl, el, showMenu } = setup({ clearMenu: () => clearMenuCalls.push(1) });
        palette.open();
        clearMenuCalls.length = 0; // open() itself clears menus first
        const menuRow = el('A');
        menuRow.classList.add('active'); // the menu-open marker…
        showMenu(); // …plus a VISIBLE menu — both halves of the K6 contract
        fireFocusout(paletteEl, menuRow);
        expect(palette.isOpen()).toBe(true);
        expect(clearMenuCalls).toEqual([]); // the menu is left alone
    });

    it('a stale .active marker (menu already gone) no longer holds the panel (K6 parity)', () => {
        // Regression: clearMenu() (no arg) keeps the .active marker while
        // hiding every menu — the marker alone must not read as "menu open".
        const { palette, paletteEl, el } = setup({ clearMenu: () => {} });
        palette.open();
        const row = el('A');
        row.classList.add('active'); // stale marker, no visible menu
        fireFocusout(paletteEl, el('DIV')); // focus left for real
        expect(palette.isOpen()).toBe(false);
    });

    it('a dialog owning the modal layer holds the panel', () => {
        const { palette, paletteEl, body, el } = setup({});
        palette.open();
        body.classList.add('needConfirm');
        fireFocusout(paletteEl, el('BUTTON'));
        expect(palette.isOpen()).toBe(true);
    });

    it('focusout while closed is a no-op', () => {
        const { palette, paletteEl, el } = setup({});
        fireFocusout(paletteEl, el('DIV'));
        expect(palette.isOpen()).toBe(false);
    });
});

describe('result composition', () => {
    it('an empty query renders the whole command table, named via i18n', () => {
        const { palette, results, rowClasses } = setup({});
        palette.open();
        expect(rowClasses()).toEqual(COMMAND_MSGS.map(() => 'palette-row palette-command'));
        COMMAND_MSGS.forEach((msg, i) =>
            expect(results._appended[i]._innerHTML).toContain(msg));
    });

    it('a non-empty query lists matching commands before bookmarks/folders, bridge row last', () => {
        const { palette, results, type } = setup({});
        palette.open();
        type('new');
        const classes = results._appended.map(li => li.className);
        // the two New-* commands first (round-4 retired the New separator
        // one), the "New bookmark ideas" bookmark hit, then the §4.4 bridge
        // row — every fuzzy command hit (if any) still lands ahead of the
        // bookmark rows.
        const firstBookmark = classes.indexOf('palette-row palette-bookmark');
        expect(firstBookmark).toBeGreaterThanOrEqual(2);
        expect(results._appended[firstBookmark]._innerHTML).toContain('<mark>New</mark> bookmark ideas');
        const last = results._appended[results._appended.length - 1]._innerHTML;
        expect(last).toContain("Search 'new' in Search view");
    });

    it('a leading slash restricts results to commands even when bookmarks match', () => {
        const { palette, results, rowClasses, type } = setup({});
        palette.open();
        type('/new');
        // commands only — the two New-* rows first (round-4 retired the New
        // separator one), plus the fuzzy name hits on "Go to Recent/Dead
        // links view" (…view); never the "New bookmark ideas" bookmark hit
        expect(rowClasses().length).toBeGreaterThanOrEqual(2);
        expect(results._appended[0]._innerHTML).toContain(MSGS.paletteCmdNewBookmark);
        expect(results._appended[1]._innerHTML).toContain(MSGS.paletteCmdNewFolder);
        expect(rowClasses().every(c => c === 'palette-row palette-command')).toBe(true);
        expect(results._appended.every(li => !li._innerHTML.includes('New bookmark ideas'))).toBe(true);
    });

    it('a bare slash lists every command', () => {
        const { palette, rowClasses, type } = setup({});
        palette.open();
        type('/');
        expect(rowClasses()).toHaveLength(COMMAND_MSGS.length);
    });

    it('ranks real fuzzy title hits above url-only hits', () => {
        const { palette, results, type } = setup({});
        palette.open();
        type('gmail');
        // two bookmark hits + the bridge row
        expect(results._appended).toHaveLength(3);
        // bookmark rows now use <a> + <i> structure matching search results,
        // with the matched chars wrapped in <mark> (same as the search view)
        expect(results._appended[0]._innerHTML).toContain('<i><mark>Gmail</mark></i>');
        expect(results._appended[1]._innerHTML).toContain('<i>mail archive</i>');
        expect(results._appended[2]._innerHTML).toContain("Search 'gmail' in Search view");
    });

    it('flattens nested folders and their bookmarks into the index', () => {
        const { palette, results, rowClasses, type } = setup({});
        palette.open();
        type('github'); // nested inside folder 14
        expect(rowClasses()).toEqual(['palette-row palette-bookmark', 'palette-row palette-command']);
        expect(results._appended[0]._innerHTML).toContain('GitHub');
        type('dev'); // the nested folder itself
        expect(rowClasses()).toContain('palette-row palette-folder');
        const folderRow = results._appended.find(li => li.className === 'palette-row palette-folder');
        expect(folderRow._innerHTML).toContain('Dev');
    });

    it('keeps real root folders in the index (the synthetic root is skipped)', () => {
        const { palette, results, rowClasses, type } = setup({});
        palette.open();
        type('bookmarks bar'); // matches only the "Bookmarks bar" root folder
        expect(rowClasses()).toContain('palette-row palette-folder');
        const folderRow = results._appended.find(li => li.className === 'palette-row palette-folder');
        expect(folderRow._innerHTML).toContain('Bookmarks bar');
        expect(folderRow._innerHTML).not.toContain('Other bookmarks');
    });

    it('an untitled folder row falls back to the noTitle label (search-view parity)', () => {
        // A folder hit with an empty title is unreachable through the real
        // rank() (no title and no url never matches a query), so a one-shot
        // rank double stands in for this render pass — the row must not
        // render an empty <i></i>.
        const { palette, results, type } = setup({});
        palette.open();
        const realRank = VBMFuzzy.rank;
        VBMFuzzy.rank = () => [
            { id: '14', title: '', url: '', dateAdded: 1, isFolder: true, score: 1, tier: 3, positions: null }
        ];
        try {
            type('zz');
        } finally {
            VBMFuzzy.rank = realRank;
        }
        const folderRow = results._appended.find(li => li.className === 'palette-row palette-folder');
        expect(folderRow._innerHTML).toContain(`<i>${MSGS.noTitle}</i>`);
    });

    it('keeps separator bookmarks out of the fuzzy index (search.js parity)', () => {
        const { palette, results, treeData, type } = setup({});
        // default separator settings: the http://separatethis.com/ url prefix
        treeData[0].children[0].children.push(
            { id: '16', title: 'gmail separator', url: 'http://separatethis.com/?---', dateAdded: 600 });
        palette.open();
        type('gmail'); // the separator's TITLE would match if it were indexed
        const bookmarkRows = results._appended.filter(li => li.className === 'palette-row palette-bookmark');
        expect(bookmarkRows).toHaveLength(2); // the two real gmail hits only
        expect(bookmarkRows.every(li => !li._innerHTML.includes('separatethis'))).toBe(true);
    });

    it('a hitless plain query ends with the bridge row + the save-as-command closure (v4 task-4 #6)', () => {
        const { palette, results, type } = setup({});
        palette.open();
        type('zzzz');
        expect(results._appended).toHaveLength(2);
        expect(results._appended[0].className).toBe('palette-row palette-command');
        expect(results._appended[0]._innerHTML).toContain("Search 'zzzz' in Search view");
        expect(results._appended[1].className).toBe('palette-row palette-command');
        expect(results._appended[1]._innerHTML).toContain("Save 'zzzz' as a custom command");
    });

    it('a slash query with no matching command offers the save-as-command closure', () => {
        const { palette, results, type } = setup({});
        palette.open();
        type('/zzzz');
        expect(results._appended).toHaveLength(1);
        expect(results._appended[0].className).toBe('palette-row palette-command');
        expect(results._appended[0]._innerHTML).toContain("Save '/zzzz' as a custom command");
    });

    it('a slash word that cannot be a command name still renders the no-results row', () => {
        const { palette, results, type } = setup({});
        palette.open();
        type('/?'); // '?' fails the slash-name pattern — nothing to save
        expect(results._appended).toHaveLength(1);
        expect(results._appended[0].className).toBe('palette-empty');
        expect(results._appended[0].textContent).toBe(MSGS.paletteNoResults);
    });

    it('re-renders on every input event', () => {
        const { palette, rowClasses, type } = setup({});
        palette.open();
        expect(rowClasses()).toHaveLength(COMMAND_MSGS.length);
        type('gmail');
        expect(rowClasses()).toHaveLength(3); // two hits + bridge row
        type('');
        expect(rowClasses()).toHaveLength(COMMAND_MSGS.length);
    });

    it('rebuilds a fresh index on the next open', () => {
        const { palette, treeData, rowClasses, type } = setup({});
        palette.open();
        treeData[0].children[0].children.push({
            id: '16', title: 'Freshly added', url: 'https://fresh.example/', dateAdded: 600
        });
        palette.close();
        palette.open();
        type('freshly');
        expect(rowClasses()).toEqual(['palette-row palette-bookmark', 'palette-row palette-command']);
    });
});

describe('keyboard navigation', () => {
    it('ArrowDown/ArrowUp move the selection, starting at the first row', () => {
        const { palette, input, keydown, selectedIndex } = setup({});
        palette.open();
        expect(selectedIndex()).toBe(-1);
        keydown(input, { key: 'ArrowDown' });
        expect(selectedIndex()).toBe(0);
        keydown(input, { key: 'ArrowDown' });
        expect(selectedIndex()).toBe(1);
        keydown(input, { key: 'ArrowUp' });
        expect(selectedIndex()).toBe(0);
    });

    it('rolls over at both ends', () => {
        const { palette, input, keydown, selectedIndex } = setup({});
        palette.open(); // the full command table
        keydown(input, { key: 'ArrowUp' }); // wraps to the last row
        expect(selectedIndex()).toBe(COMMAND_MSGS.length - 1);
        keydown(input, { key: 'ArrowDown' }); // wraps back to the first
        expect(selectedIndex()).toBe(0);
    });

    it('resets the selection when the results re-render', () => {
        const { palette, input, keydown, selectedIndex, type } = setup({});
        palette.open();
        keydown(input, { key: 'ArrowDown' });
        keydown(input, { key: 'ArrowDown' });
        expect(selectedIndex()).toBe(1);
        type('g');
        expect(selectedIndex()).toBe(-1);
    });

    it('arrow keys eat the event so the cursor never leaves the input', () => {
        const { palette, input, keydown } = setup({});
        palette.open();
        expect(keydown(input, { key: 'ArrowDown' }).defaultPrevented).toBe(true);
        expect(keydown(input, { key: 'ArrowUp' }).defaultPrevented).toBe(true);
    });

    // Final polish: the list scrolls to follow the highlight (it used to move
    // off-screen silently).
    it('the selected row is scrolled into view ({ block: nearest })', () => {
        const { palette, input, results, keydown } = setup({});
        palette.open();
        keydown(input, { key: 'ArrowDown' });
        const first = results._appended[0];
        expect(first._scrolledIntoView).toBe(1);
        expect(first._lastScrollArg).toEqual({ block: 'nearest' });
        keydown(input, { key: 'ArrowDown' });
        expect(results._appended[1]._scrolledIntoView).toBe(1);
        keydown(input, { key: 'End' });
        expect(results._appended[results._appended.length - 1]._scrolledIntoView).toBe(1);
    });
});

describe('clear / close affordances (final polish)', () => {
    it('typing tags the panel has-query; the × clears the query and keeps focus', () => {
        const { palette, paletteEl, input, clearBtn, type } = setup({});
        palette.open();
        expect(paletteEl.classList.contains('has-query')).toBe(false);
        type('gmail');
        expect(paletteEl.classList.contains('has-query')).toBe(true);
        clearBtn._listeners.click[0](makeEvent({}));
        expect(input.value).toBe('');
        expect(paletteEl.classList.contains('has-query')).toBe(false);
        expect(input.focused).toBe(true); // typing can restart immediately
    });

    it('the × labels resolve from i18n at init', () => {
        const { clearBtn } = setup({});
        expect(clearBtn._attrs['aria-label']).toBe(getMessage('searchClear'));
        expect(clearBtn.title).toBe(getMessage('searchClear'));
    });

    it('the footer close button closes the panel like Esc', () => {
        const { palette, paletteEl, closeBtn } = setup({});
        palette.open();
        closeBtn._listeners.click[0](makeEvent({}));
        expect(palette.isOpen()).toBe(false);
        expect(paletteEl.hidden).toBe(true);
    });

    it('open() resets the has-query tag from a previous session', () => {
        const { palette, paletteEl, input, type } = setup({});
        palette.open();
        type('abc');
        palette.close();
        palette.open();
        expect(paletteEl.classList.contains('has-query')).toBe(false);
        expect(input.value).toBe('');
    });
});

describe('execution', () => {
    it('Enter without a selection executes the first row', () => {
        const { palette, input, actions, keydown, type } = setup({});
        palette.open();
        type('gmail');
        keydown(input, { key: 'Enter' });
        expect(actions.openBookmarkCalls).toEqual(['https://mail.google.com/']);
    });

    it('ignores IME composition keys (isComposing / keyCode 229) — Enter never executes, arrows never move', () => {
        // Same guard as search.js: the committing Enter and the candidate-
        // picking arrows belong to the IME, not to the palette.
        const { palette, input, actions, keydown, type, selectedIndex } = setup({});
        palette.open();
        type('gmail');
        const before = selectedIndex();
        const ev = keydown(input, { key: 'Enter', isComposing: true, keyCode: 229 });
        expect(actions.openBookmarkCalls).toEqual([]);
        expect(palette.isOpen()).toBe(true); // the Enter stayed with the IME
        expect(ev.defaultPrevented).toBe(false); // not even swallowed
        keydown(input, { key: 'ArrowDown', isComposing: true, keyCode: 229 });
        expect(selectedIndex()).toBe(before);
    });

    it('Enter on a bookmark opens it in the current tab and closes', () => {
        const { palette, input, actions, keydown, type } = setup({});
        palette.open();
        type('gmail');
        keydown(input, { key: 'ArrowDown' });
        keydown(input, { key: 'ArrowDown' }); // second row: mail archive
        keydown(input, { key: 'Enter' });
        expect(actions.openBookmarkCalls).toEqual(['https://gmail.com/inbox']);
        expect(palette.isOpen()).toBe(false);
    });

    it('Ctrl+Enter on a bookmark opens a new foreground tab instead', () => {
        const { palette, input, actions, keydown, type } = setup({});
        palette.open();
        type('gmail');
        keydown(input, { key: 'Enter', ctrlKey: true });
        expect(actions.openBookmarkNewTabCalls).toEqual([['https://mail.google.com/', true]]);
        expect(actions.openBookmarkCalls).toEqual([]);
    });

    it('Cmd+Enter works like Ctrl+Enter', () => {
        const { palette, input, actions, keydown, type } = setup({});
        palette.open();
        type('gmail');
        keydown(input, { key: 'Enter', metaKey: true });
        expect(actions.openBookmarkNewTabCalls).toEqual([['https://mail.google.com/', true]]);
    });

    it('Enter on a folder reveals it in the tree and closes', () => {
        const { palette, results, treeView, type } = setup({});
        palette.open();
        type('dev');
        // fuzzy name hits may interleave commands ahead of the folder row —
        // click the folder row itself (click = Enter)
        const folderRow = results._appended.find(li => li.className === 'palette-row palette-folder');
        fire(folderRow, 'click', makeEvent({}));
        expect(treeView.revealFolderCalls).toEqual(['14']);
        expect(palette.isOpen()).toBe(false);
    });

    it('Enter on a command runs its fn and closes', () => {
        const { palette, input, quickAddCalls, keydown } = setup({});
        palette.open(); // first command row = quick add
        keydown(input, { key: 'Enter' });
        expect(quickAddCalls).toHaveLength(1);
        expect(palette.isOpen()).toBe(false);
    });

    it('clicking a row executes it like Enter', () => {
        const { palette, results, actions, type } = setup({});
        palette.open();
        type('gmail');
        fire(results._appended[1], 'click', makeEvent({}));
        expect(actions.openBookmarkCalls).toEqual(['https://gmail.com/inbox']);
        expect(palette.isOpen()).toBe(false);
    });

    it('mousedown on a row is default-prevented so the input never blurs (mouse-click fix)', () => {
        // The round-3 focusout guard reads an input blur as "focus lost →
        // close"; preventing the mousedown default keeps focus on the input
        // and the following click lands (Enter always worked).
        const { palette, results, type } = setup({});
        palette.open();
        type('gmail');
        const ev = makeEvent({});
        fire(results._appended[1], 'mousedown', ev);
        expect(ev.defaultPrevented).toBe(true);
    });

    it('Enter on the save-as-command row hands over to the options editor with the slash prefilled', () => {
        const { palette, input, chrome, keydown, type } = setup({});
        palette.open();
        type('/zzzz');
        keydown(input, { key: 'Enter' });
        expect(chrome.tabs.createCalls).toHaveLength(1);
        const url = chrome.tabs.createCalls[0].url;
        expect(url).toContain('pages/options.html#palette-cmd=');
        expect(JSON.parse(decodeURIComponent(url.split('#palette-cmd=')[1]))).toEqual({ slash: 'zzzz' });
        expect(palette.isOpen()).toBe(false); // the panel closes behind the hand-off
    });

    it('Escape closes the palette, eating and stopping the event', () => {
        const { palette, input, keydown } = setup({});
        palette.open();
        const ev = keydown(input, { key: 'Escape' });
        expect(ev.defaultPrevented).toBe(true);
        expect(ev.propagationStopped).toBe(true);
        expect(palette.isOpen()).toBe(false);
    });
});

describe('command set (v4 task-2 §3.5)', () => {
    const runCommand = (ctx, i) => {
        ctx.palette.open();
        ctx.keydown(ctx.input, { key: 'ArrowDown' }); // select row 0
        for (let n = 0; n < i; n++)
            ctx.keydown(ctx.input, { key: 'ArrowDown' });
        ctx.keydown(ctx.input, { key: 'Enter' });
    };

    it('"New bookmark…" bookmarks the current tab at the bottom of the root folder', () => {
        const ctx = setup({});
        runCommand(ctx, 1);
        expect(ctx.chrome.tabs.queryCalls).toEqual([{ active: true, windowId: -1 }]);
        expect(ctx.actions.addNewBookmarkNodeCalls).toEqual([
            ['1', 'bottom', 'https://tab.example/', 'Tab Title']
        ]);
    });

    it('"New bookmark…" silently does nothing without a current tab', () => {
        const ctx = setup({ tab: null });
        runCommand(ctx, 1);
        expect(ctx.actions.addNewBookmarkNodeCalls).toEqual([]);
    });

    it('"New folder…" goes through addNewBookmarkNode with empty strings (the folder-flow idiom)', () => {
        const ctx = setup({ rootFolderId: '42' });
        runCommand(ctx, 2);
        expect(ctx.actions.addNewBookmarkNodeCalls).toEqual([['42', 'bottom', '', '']]);
    });

    // Round-4 item 2: the position-dependent separator command is retired
    // from the panel; adding separators stays in the tree's context menu.
    it('the retired separator command no longer appears, in any slash form', () => {
        const { palette, results, type } = setup({});
        palette.open(); // the full table on an empty query
        expect(results._appended.every(li => !li._innerHTML.includes(MSGS.paletteCmdNewSeparator))).toBe(true);
        for (const slash of ['/sep', '/separator', '/divider']) {
            type(slash);
            expect(results._appended.every(li => !li._innerHTML.includes(MSGS.paletteCmdNewSeparator)),
                `${slash} surfaces no separator command`).toBe(true);
        }
    });

    it('every create-style command carries its slash alias', () => {
        const { palette, results, type } = setup({});
        const cases = [
            ['/add', MSGS.paletteCmdQuickAdd],
            ['/new', MSGS.paletteCmdNewBookmark],
            ['/folder', MSGS.paletteCmdNewFolder]
        ];
        for (const [slash, msg] of cases) {
            palette.open();
            type(slash);
            const hits = results._appended.filter(li => li._innerHTML.includes(msg));
            expect(hits.length, `${slash} surfaces ${msg}`).toBe(1);
            palette.close();
        }
    });
});

describe('view Go commands (v4 task-2 §3.5)', () => {
    const GO = [
        ['tree', MSGS.paletteCmdGoTree],
        ['search', MSGS.paletteCmdGoSearch],
        ['recent', MSGS.paletteCmdGoRecent],
        ['stats', MSGS.paletteCmdGoStats],
        ['dead', MSGS.paletteCmdGoDead],
        ['dupes', MSGS.paletteCmdGoDupes]
    ];

    it('each Go command executes as close + views.activate(id)', () => {
        for (const [id] of GO) {
            const ctx = setup({});
            ctx.palette.open();
            ctx.type(`/${id}`);
            ctx.keydown(ctx.input, { key: 'Enter' });
            expect(ctx.views.activateCalls).toEqual([id]);
            expect(ctx.palette.isOpen()).toBe(false);
        }
    });

    it('the slash alias of every Go command is the view id, prefix-matched', () => {
        const { palette, results, type } = setup({});
        palette.open();
        type('/rec');
        expect(results._appended).toHaveLength(1);
        expect(results._appended[0]._innerHTML).toContain(MSGS.paletteCmdGoRecent);
    });

    it("the '/d' prefix still lists both /dead and /dupes, dead first (command-table order)", () => {
        const { palette, results, type } = setup({});
        palette.open();
        type('/d');
        const html = results._appended.map(li => li._innerHTML);
        const iDead = html.findIndex(h => h.includes(MSGS.paletteCmdGoDead));
        const iDupes = html.findIndex(h => h.includes(MSGS.paletteCmdGoDupes));
        expect(iDead).toBeGreaterThanOrEqual(0);
        expect(iDupes).toBeGreaterThan(iDead);
    });

    it('/options opens the extension options page and closes', () => {
        const ctx = setup({});
        ctx.palette.open();
        ctx.type('/opt');
        // other command names fuzzy-match 'opt' too; click the options row
        const row = ctx.results._appended.find(li => li._innerHTML.includes(MSGS.paletteCmdOptions));
        fire(row, 'click', makeEvent({}));
        expect(ctx.chrome.runtime.openOptionsPageCalls).toBe(1);
        expect(ctx.palette.isOpen()).toBe(false);
    });

    it('/search without words just activates the search view', () => {
        const ctx = setup({});
        ctx.palette.open();
        ctx.type('/search');
        ctx.keydown(ctx.input, { key: 'Enter' });
        expect(ctx.views.activateCalls).toEqual(['search']);
        expect(ctx.search.runCalls).toEqual([]);
        expect(ctx.palette.isOpen()).toBe(false);
    });

    it('/search foo carries the words into the search view (§4.4)', () => {
        const ctx = setup({});
        ctx.palette.open();
        ctx.type('/search foo bar');
        ctx.keydown(ctx.input, { key: 'Enter' });
        expect(ctx.search.runCalls).toEqual(['foo bar']);
        expect(ctx.palette.isOpen()).toBe(false);
    });
});

describe('command aliases (v4 task-4 #5 cleanup)', () => {
    it('/dedup lands on the duplicates view (the surviving alias)', () => {
        const ctx = setup({});
        ctx.palette.open();
        ctx.type('/dedup');
        ctx.keydown(ctx.input, { key: 'Enter' });
        expect(ctx.views.activateCalls).toEqual(['dupes']);
        expect(ctx.palette.isOpen()).toBe(false);
    });

    it('the retired /clear alias matches nothing — the save-as closure appears instead', () => {
        // ('/dups' still resolves, but only because "dups" is a prefix of the
        // canonical "dupes" — no alias carries it anymore.)
        const { palette, results, type } = setup({});
        palette.open();
        type('/clear');
        expect(results._appended).toHaveLength(1);
        expect(results._appended[0]._innerHTML).toContain("Save '/clear' as a custom command");
        palette.close();
    });

    it('aliases match by prefix too (/ded already hits /dedup)', () => {
        const { palette, results, type } = setup({});
        palette.open();
        type('/ded');
        const hits = results._appended.filter(li => li._innerHTML.includes(MSGS.paletteCmdGoDupes));
        expect(hits).toHaveLength(1);
        palette.close();
    });

    it('create-style and view commands both answer to their alternates', () => {
        const cases = [
            ['/star', MSGS.paletteCmdQuickAdd],
            ['/mkdir', MSGS.paletteCmdNewFolder],
            ['/save', MSGS.paletteCmdSaveSession],
            ['/home', MSGS.paletteCmdGoTree],
            ['/find', MSGS.paletteCmdGoSearch],
            ['/latest', MSGS.paletteCmdGoRecent],
            ['/visits', MSGS.paletteCmdGoStats],
            ['/broken', MSGS.paletteCmdGoDead],
            ['/dedup', MSGS.paletteCmdGoDupes],
            ['/settings', MSGS.paletteCmdOptions]
        ];
        for (const [alias, msg] of cases) {
            const { palette, results, type } = setup({});
            palette.open();
            type(alias);
            const hits = results._appended.filter(li => li._innerHTML.includes(msg));
            expect(hits.length, `${alias} surfaces ${msg}`).toBe(1);
            palette.close();
        }
    });

    it('a command row renders every slash form as the muted suffix', () => {
        const { palette, results, type } = setup({});
        palette.open();
        type('/dupes');
        const row = results._appended.find(li => li._innerHTML.includes(MSGS.paletteCmdGoDupes));
        expect(row._innerHTML).toContain('class="palette-slash"');
        expect(row._innerHTML).toContain('/dupes /dedup');
        palette.close();
    });

    it('an alias query still shows the canonical form first in the suffix', () => {
        const { palette, results, type } = setup({});
        palette.open();
        type('/dedup');
        const row = results._appended.find(li => li._innerHTML.includes(MSGS.paletteCmdGoDupes));
        expect(row._innerHTML).toContain('/dupes /dedup');
        palette.close();
    });
});

describe('search-view bridge row (v4 task-2 §4.4)', () => {
    it('a plain query appends the bridge row after the bookmark hits', () => {
        const { palette, results, type } = setup({});
        palette.open();
        type('gmail');
        const last = results._appended[results._appended.length - 1];
        expect(last.className).toBe('palette-row palette-command');
        expect(last._innerHTML).toContain("Search 'gmail' in Search view");
    });

    it('the bridge row query is escaped in the markup', () => {
        const { palette, results, type } = setup({});
        palette.open();
        type('<b>');
        // row 0 = the bridge row (a hitless query appends save-as after it)
        const bridge = results._appended[0];
        expect(bridge._innerHTML).toContain('&lt;b&gt;');
        expect(bridge._innerHTML).not.toContain('<b>');
    });

    it('executing the bridge row closes the panel and runs the search view query', () => {
        const ctx = setup({});
        ctx.palette.open();
        ctx.type('gmail');
        // last row = bridge; select it from the end with ArrowUp
        ctx.keydown(ctx.input, { key: 'ArrowUp' });
        ctx.keydown(ctx.input, { key: 'Enter' });
        expect(ctx.search.runCalls).toEqual(['gmail']);
        expect(ctx.palette.isOpen()).toBe(false);
    });

    it('no bridge row on an empty query or in slash mode', () => {
        const { palette, results, type } = setup({});
        palette.open();
        expect(results._appended.every(li => !li._innerHTML.includes('Search \''))).toBe(true);
        type('/gmail');
        expect(results._appended.every(li => !li._innerHTML.includes('Search \''))).toBe(true);
    });
});

// v4 task-4 #3: a plain-query palette search that opens a bookmark records
// the query into the search history (search.record) — it used to vanish with
// the panel. Folder jumps and command runs mirror the search view's own
// timings and never record from the palette.
describe('plain-query search recording (v4 task-4 #3)', () => {
    it('opening a bookmark hit records the query with its hit count', () => {
        const ctx = setup({});
        ctx.palette.open();
        ctx.type('gmail'); // two bookmark hits + bridge row
        ctx.keydown(ctx.input, { key: 'ArrowDown' }); // select the first hit
        ctx.keydown(ctx.input, { key: 'Enter' });
        expect(ctx.actions.openBookmarkCalls).toEqual(['https://mail.google.com/']);
        expect(ctx.search.recordCalls).toEqual([['gmail', 2]]);
        expect(ctx.palette.isOpen()).toBe(false);
    });

    it('Ctrl+Enter on a hit records too (new-tab open is still a finished search)', () => {
        const ctx = setup({});
        ctx.palette.open();
        ctx.type('gmail');
        ctx.keydown(ctx.input, { key: 'ArrowDown' });
        ctx.keydown(ctx.input, { key: 'Enter', ctrlKey: true });
        expect(ctx.search.recordCalls).toEqual([['gmail', 2]]);
    });

    it('folder jumps never record (the search view quits without recording too)', () => {
        const ctx = setup({});
        ctx.palette.open();
        ctx.type('bookmarks bar');
        ctx.keydown(ctx.input, { key: 'ArrowDown' });
        ctx.keydown(ctx.input, { key: 'Enter' });
        expect(ctx.treeView.revealFolderCalls).toHaveLength(1);
        expect(ctx.search.recordCalls).toEqual([]);
    });

    it('command rows and the bridge row never record from the palette', () => {
        const ctx = setup({});
        ctx.palette.open();
        ctx.type('gmail');
        ctx.keydown(ctx.input, { key: 'ArrowUp' }); // bridge row
        ctx.keydown(ctx.input, { key: 'Enter' });
        expect(ctx.search.runCalls).toEqual(['gmail']);
        expect(ctx.search.recordCalls).toEqual([]);
    });

    it('slash-mode executions have no plain query to record', () => {
        const ctx = setup({});
        ctx.palette.open();
        ctx.type('/dead');
        ctx.keydown(ctx.input, { key: 'ArrowDown' });
        ctx.keydown(ctx.input, { key: 'Enter' });
        expect(ctx.views.activateCalls).toEqual(['dead']);
        expect(ctx.search.recordCalls).toEqual([]);
    });
});

// --- P3.2: save window tabs as folder --------------------------------------
// The command sits at index 3 in the command table (after the three
// create-style commands; round-4 item 2 retired the fourth, /sep). The
// chrome double's tabs.query fires synchronously but saveSession resolves
// through a promise chain, so the assertions after a run await flush().
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const makeSessionTabs = () => [
    { id: 1, url: 'https://a.com/', title: 'A' },
    { id: 2, url: 'chrome://extensions/', title: 'Extensions' }, // unbookmarkable
    { id: 3, url: 'https://b.com/page', title: '' },             // title -> url
    { id: 4, url: 'https://a.com/', title: 'A dupe' }            // same-window dupe
];

const runSessionCommand = ctx => {
    ctx.palette.open();
    // first ArrowDown selects row 0; the session command is row 3
    for (let n = 0; n < 4; n++)
        ctx.keydown(ctx.input, { key: 'ArrowDown' });
    ctx.keydown(ctx.input, { key: 'Enter' });
};

describe('session save command (P3.2)', () => {
    it('lists the save-session command after the create-style commands, named via i18n', () => {
        const { palette, results, rowClasses } = setup({});
        palette.open();
        expect(rowClasses()[3]).toBe('palette-row palette-command');
        expect(results._appended[3]._innerHTML).toContain(MSGS.paletteCmdSaveSession);
    });

    it("the slash alias matches by prefix: '/sess' already lists it", () => {
        const { palette, results, rowClasses, type } = setup({});
        palette.open();
        type('/sess');
        expect(rowClasses()).toEqual(['palette-row palette-command']);
        expect(results._appended[0]._innerHTML).toContain(MSGS.paletteCmdSaveSession);
    });

    it('queries the current window and creates the folder plus filtered bookmarks in order', async () => {
        const ctx = setup({ tabs: makeSessionTabs(), rootFolderId: '7' });
        runSessionCommand(ctx);
        await flush();
        expect(ctx.chrome.tabs.queryCalls).toEqual([{ currentWindow: true }]);
        const calls = ctx.chrome.bookmarks.createCalls;
        expect(calls).toHaveLength(3); // folder + 2 bookmarks (dupe and chrome:// dropped)
        expect(calls[0].parentId).toBe('7');
        // the create double hands out ids n1, n2, … in call order: n1 = the folder
        expect(calls[1]).toEqual({ parentId: 'n1', title: 'A', url: 'https://a.com/' });
        expect(calls[2]).toEqual({ parentId: 'n1', title: 'https://b.com/page', url: 'https://b.com/page' });
    });

    it('names the folder from the sessionFolderName template with a YYYY-MM-DD HH:mm stamp', async () => {
        const ctx = setup({ tabs: makeSessionTabs() });
        runSessionCommand(ctx);
        await flush();
        expect(ctx.chrome.bookmarks.createCalls[0].title)
            .toMatch(/^Session \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    });

    it('closes the panel, alerts the saved count and refreshes the tree on success', async () => {
        const ctx = setup({ tabs: makeSessionTabs() });
        runSessionCommand(ctx);
        expect(ctx.palette.isOpen()).toBe(true); // keepOpen across the async save
        await flush();
        expect(ctx.palette.isOpen()).toBe(false);
        expect(ctx.dialogs.AlertDialog.openCalls).toEqual(['Saved 2 tabs to a new folder']);
        expect(ctx.onChangedCalls).toHaveLength(1);
    });

    it('runs through the slash alias too', async () => {
        const ctx = setup({ tabs: makeSessionTabs() });
        ctx.palette.open();
        ctx.type('/session');
        ctx.keydown(ctx.input, { key: 'Enter' });
        await flush();
        expect(ctx.chrome.bookmarks.createCalls).toHaveLength(3);
        expect(ctx.dialogs.AlertDialog.openCalls).toEqual(['Saved 2 tabs to a new folder']);
    });

    it('alerts sessionEmpty and keeps the panel open when the window has no tabs', async () => {
        const ctx = setup({ tabs: [] });
        runSessionCommand(ctx);
        await flush();
        expect(ctx.dialogs.AlertDialog.openCalls).toEqual(['No tabs to save']);
        expect(ctx.palette.isOpen()).toBe(true);
        expect(ctx.chrome.bookmarks.createCalls).toEqual([]);
        expect(ctx.onChangedCalls).toEqual([]);
    });

    it('treats a window of only unbookmarkable tabs as empty', async () => {
        const ctx = setup({
            tabs: [
                { id: 1, url: 'chrome://extensions/', title: 'Extensions' },
                { id: 2, url: 'about:blank', title: '' }
            ]
        });
        runSessionCommand(ctx);
        await flush();
        expect(ctx.dialogs.AlertDialog.openCalls).toEqual(['No tabs to save']);
        expect(ctx.palette.isOpen()).toBe(true);
        expect(ctx.chrome.bookmarks.createCalls).toEqual([]);
    });
});

// --- v4 task-4 #5: the parameterized /theme command -------------------------
// One '/theme <name>' command replaced the round-4 themeauto…themepaper
// five-pack: the rest words pick the theme by unique prefix ('/theme d' =
// dark); a bare or unknown rest shows the usage alert (keepOpen, so the
// panel survives it like /search does). A resolved theme mirrors the options
// page's theme <select>: store.set (theme is sync-routed since the 2026-08
// storage audit — store.js refreshes the localStorage boot copy internally,
// so feature code never writes localStorage) + an immediate
// body[data-theme] apply, then closes the panel itself.
describe('the parameterized /theme command (v4 task-4 #5)', () => {
    it("'/theme dark' writes the store and body[data-theme]", () => {
        const ctx = setup({});
        ctx.palette.open();
        ctx.type('/theme dark');
        ctx.keydown(ctx.input, { key: 'Enter' });
        expect(ctx.store.setCalls).toEqual([['theme', 'dark']]);
        expect(ctx.body.dataset.theme).toBe('dark');
        expect(ctx.palette.isOpen()).toBe(false); // a resolved theme closes the panel
    });

    it('every theme resolves from any unique prefix of its name', () => {
        const cases = [
            ['auto', 'a'], ['light', 'l'], ['dark', 'd'], ['ink', 'i'], ['paper', 'p']
        ];
        for (const [theme, prefix] of cases) {
            const ctx = setup({});
            ctx.palette.open();
            ctx.type(`/theme ${prefix}`);
            ctx.keydown(ctx.input, { key: 'Enter' });
            expect(ctx.store.setCalls, theme).toEqual([['theme', theme]]);
            expect(ctx.body.dataset.theme, theme).toBe(theme);
        }
    });

    it('a bare /theme shows the usage alert and keeps the panel open', () => {
        const ctx = setup({});
        ctx.palette.open();
        ctx.type('/theme');
        ctx.keydown(ctx.input, { key: 'Enter' });
        expect(ctx.dialogs.AlertDialog.openCalls).toEqual([MSGS.paletteCmdThemeUsage]);
        expect(ctx.store.setCalls).toEqual([]);
        expect(ctx.palette.isOpen()).toBe(true); // keepOpen across the alert
    });

    it('an unknown theme rest shows the usage alert too', () => {
        const ctx = setup({});
        ctx.palette.open();
        ctx.type('/theme neon');
        ctx.keydown(ctx.input, { key: 'Enter' });
        expect(ctx.dialogs.AlertDialog.openCalls).toEqual([MSGS.paletteCmdThemeUsage]);
        expect(ctx.store.setCalls).toEqual([]);
    });

    it('the retired five-pack (/themedark & co.) no longer matches any command', () => {
        const ctx = setup({});
        ctx.palette.open();
        ctx.type('/themedark');
        expect(ctx.results._appended).toHaveLength(1);
        expect(ctx.results._appended[0]._innerHTML).toContain("Save '/themedark' as a custom command");
        expect(ctx.store.setCalls).toEqual([]);
    });

    it('the /theme row renders its single slash form', () => {
        const { palette, results, type } = setup({});
        palette.open();
        type('/theme');
        const row = results._appended.find(li => li._innerHTML.includes(MSGS.paletteCmdTheme));
        expect(row._innerHTML).toContain('<span class="palette-slash">/theme</span>');
    });
});

// --- Round-5: the four direct theme commands --------------------------------
// '/dark' '/light' '/ink' '/paper' sit next to the parameterized /theme as
// no-rest-word shortcuts: Enter applies the theme through the same
// store/body[data-theme] path and closes the panel (a resolved /theme does
// the same). Names reuse the options page's optionTheme* labels.
describe('the direct theme commands (round-5)', () => {
    const CASES = [
        ['/dark', 'dark'], ['/light', 'light'], ['/ink', 'ink'], ['/paper', 'paper']
    ];

    it('each direct command applies its theme and closes the panel', () => {
        for (const [slash, theme] of CASES) {
            const ctx = setup({});
            ctx.palette.open();
            ctx.type(slash);
            ctx.keydown(ctx.input, { key: 'Enter' });
            expect(ctx.store.setCalls, slash).toEqual([['theme', theme]]);
            expect(ctx.body.dataset.theme, slash).toBe(theme);
            expect(ctx.palette.isOpen(), slash).toBe(false);
        }
    });

    it('a direct theme row renders its single slash form + the localized label', () => {
        const { palette, results, type } = setup({});
        palette.open();
        for (const [slash, msg] of [
            ['/dark', MSGS.optionThemeDark], ['/light', MSGS.optionThemeLight],
            ['/ink', MSGS.optionThemeInk], ['/paper', MSGS.optionThemePaper]
        ]) {
            type(slash);
            const row = results._appended.find(li => li._innerHTML.includes(msg));
            expect(row, slash).toBeTruthy();
            expect(row._innerHTML, slash).toContain(`<span class="palette-slash">${slash}</span>`);
        }
    });

    it('the direct commands join the parameterized /theme in the full table', () => {
        const { palette, results, type } = setup({});
        palette.open();
        type('/');
        for (const [slash, msg] of [
            ['/dark', MSGS.optionThemeDark], ['/light', MSGS.optionThemeLight],
            ['/ink', MSGS.optionThemeInk], ['/paper', MSGS.optionThemePaper]
        ]) {
            const row = results._appended.find(li => li._innerHTML.includes(msg));
            expect(row, slash).toBeTruthy();
            expect(row._innerHTML, slash).toContain(slash);
        }
    });
});

// --- Settings toggle commands ------------------------------------------------
// The one surviving toggle, /tabs (round-4 item 2), flips a '1'/'' setting
// and re-applies it the way view-manager.js does — the no-view-tabs body
// class. Command rows are clicked by their i18n name rather than Entered —
// Enter would land on the first slash match (round-5's two-pass ordering
// makes that /tabs itself), but clicking keeps the assertion explicit.
const clickCommandRow = (ctx, msg) => {
    const row = ctx.results._appended.find(li => li._innerHTML.includes(msg));
    expect(row, `a row containing "${msg}"`).toBeTruthy();
    fire(row, 'click', makeEvent({}));
};

describe('settings toggle commands (round-4 item 2)', () => {
    it('/tabs flips showViewTabs off and mirrors view-manager\'s no-view-tabs class', () => {
        const ctx = setup({ storeSeed: { showViewTabs: '1' } });
        ctx.palette.open();
        ctx.type('/tabs');
        clickCommandRow(ctx, MSGS.paletteCmdToggleViewTabs);
        expect(ctx.store.setCalls).toEqual([['showViewTabs', '']]);
        expect(ctx.body.classList.contains('no-view-tabs')).toBe(true);
        expect(ctx.palette.isOpen()).toBe(false);
    });

    it('/tabs toggles back on and drops the class', () => {
        const ctx = setup({ storeSeed: { showViewTabs: '' } });
        ctx.palette.open();
        ctx.type('/tabs');
        clickCommandRow(ctx, MSGS.paletteCmdToggleViewTabs);
        expect(ctx.store.setCalls).toEqual([['showViewTabs', '1']]);
        expect(ctx.body.classList.contains('no-view-tabs')).toBe(false);
    });

    it('/tabs defaults to on when the setting was never written', () => {
        const ctx = setup({});
        ctx.palette.open();
        ctx.type('/tabs');
        clickCommandRow(ctx, MSGS.paletteCmdToggleViewTabs);
        expect(ctx.store.setCalls).toEqual([['showViewTabs', '']]);
        expect(ctx.body.classList.contains('no-view-tabs')).toBe(true);
    });

    it('the retired /path toggle matches nothing — the save-as closure appears instead', () => {
        // v4 task-4 #5: showItemPath confused more than it helped; the toggle
        // lives on the options page only. Same for the /itempath alias.
        for (const q of ['/path', '/itempath']) {
            const { palette, results, type } = setup({});
            palette.open();
            type(q);
            expect(results._appended, q).toHaveLength(1);
            expect(results._appended[0]._innerHTML, q).toContain(`Save '${q}' as a custom command`);
            palette.close();
        }
    });

    it('/tabs lost its /viewtabs alias — the row renders the single slash form', () => {
        const { palette, results, type } = setup({});
        palette.open();
        type('/tabs');
        const row = results._appended.find(li => li._innerHTML.includes(MSGS.paletteCmdToggleViewTabs));
        expect(row._innerHTML).toContain('<span class="palette-slash">/tabs</span>');
    });
});

// --- /version metadata dialog (4.0.8) -----------------------------------------
// The command closes the palette, collects live metadata (manifest, channel,
// the first matching announcement from the vbmAnnounce cache) and opens
// dialogs.js's VersionDialog. The announce text mirrors the banner's
// fallback: a textKey that translates empty yields the English fallback.
describe('/version command (4.0.8)', () => {
    const announceMsg = over => ({
        id: 'v408', version: '>=4.0.8', channel: 'all', once: true,
        display: 'banner', textKey: 'announceV408Text',
        textFallback: { en: 'EN fallback text' }, ...over
    });
    const seedCache = msg => ({ ts: 1, data: { version: 1, messages: [msg] } });
    const run = storeSeed => {
        const ctx = setup({ storeSeed });
        ctx.palette.open();
        ctx.type('/version');
        clickCommandRow(ctx, MSGS.paletteCmdVersion);
        return ctx;
    };

    it('opens the dialog with manifest version + the matching announcement text', () => {
        const ctx = run({ vbmAnnounce: seedCache(announceMsg({})) });
        expect(ctx.palette.isOpen()).toBe(false);
        expect(ctx.dialogs.VersionDialog.openCalls).toHaveLength(1);
        const meta = ctx.dialogs.VersionDialog.openCalls[0];
        expect(meta.version).toBe('4.0.8');
        expect(meta.channel).toBe('popup');
        expect(meta.language).toBe('en');
        // the textKey resolves through the i18n table (key-echo here)
        expect(meta.announce).toBe('announceV408Text');
    });

    it('falls back to the English text when the locale key translates empty', () => {
        MSGS.announceUntranslated = ''; // a locale missing this key returns ''
        const ctx = run({ vbmAnnounce: seedCache(announceMsg({ textKey: 'announceUntranslated' })) });
        expect(ctx.dialogs.VersionDialog.openCalls[0].announce).toBe('EN fallback text');
        delete MSGS.announceUntranslated;
    });

    it('no matching announcement yields an empty announce field', () => {
        const ctx = run({ vbmAnnounce: seedCache(announceMsg({ version: '>=9.0.0' })) });
        expect(ctx.dialogs.VersionDialog.openCalls[0].announce).toBe('');
    });
});

// --- v4 task-4 #6: custom commands (docs/palette-commands-design.md) --------
// User-defined entries of paletteCustomCommands merge into the command area
// after the built-ins. The palette tests here cover the integration (render,
// execute, save-as closure, gone-folder prompt, customMenu hand-off); the
// pure logic (validation, storage, matching, execution dispatch) has its own
// suite in palette-commands.test.js.
describe('view availability filters Go commands (4.0.8)', () => {
    it('hides the slash command of a disabled feature view', () => {
        const { type, rowClasses, results } = setup({
            views: { isAvailable: id => id !== 'recent' }
        });
        type('/recent');
        expect(rowClasses()).toEqual(['palette-empty']);
        expect(results._appended.some(li => String(li._innerHTML).includes('Go to Recent'))).toBe(false);
    });

    it('keeps structural tree/search commands available even when only their tab is hidden', () => {
        const { type, rowClasses } = setup({
            views: { isAvailable: id => id === 'tree' || id === 'search' }
        });
        type('/tree');
        expect(rowClasses().length).toBeGreaterThan(0);
        expect(rowClasses()[0]).toContain('palette-command');
    });

    it('does not offer the save-as-command closure for a hidden view slash', () => {
        const { type, results } = setup({
            views: { isAvailable: id => id !== 'dead' }
        });
        type('/dead');
        expect(results._appended.some(li => String(li._innerHTML).includes('Save'))).toBe(false);
    });

    it('still offers the save-as-command closure for an unknown slash', () => {
        const { type, results } = setup({});
        type('/newcmd');
        expect(results._appended.some(li => String(li._innerHTML).includes('Save'))).toBe(true);
    });

    it('hides custom view-preset commands for unavailable views', () => {
        const cmd = {
            id: 'c1', name: 'Clean dead', slash: 'clean', aliases: [],
            action: { type: 'view-preset', view: 'dead' }
        };
        const { type, results } = setup({
            storeSeed: { paletteCustomCommands: JSON.stringify([cmd]) },
            views: { isAvailable: id => id !== 'dead' }
        });
        type('/clean');
        expect(results._appended.some(li => String(li._innerHTML).includes('Clean dead'))).toBe(false);
    });
});

describe('custom commands (v4 task-4 #6)', () => {
    const CUSTOMS = [
        {
            id: 'cc_1', name: 'Work apps', slash: 'work', aliases: ['wo'],
            action: { type: 'open-url-group', folderId: '50', where: 'tab' },
            useCount: 3, lastUsedAt: 100
        },
        {
            id: 'cc_2', name: 'Kimi search', slash: 'g', aliases: [],
            action: { type: 'url-template', template: 'https://kimi.com/search?q=%s', where: 'tab' },
            useCount: 1, lastUsedAt: 200
        }
    ];
    const setupCustoms = (opts = {}) => setup({
        storeSeed: { paletteCustomCommands: JSON.stringify(CUSTOMS) },
        ...opts
    });

    it('PALETTE_RESERVED lists the built-in slash names + aliases plus the invisible /secret', () => {
        const { palette, results, type } = setup({});
        palette.open();
        type('/'); // every rendered command row
        const forms = results._appended
            .map(li => (li._innerHTML.match(/palette-slash">([^<]+)</) || [])[1])
            .filter(Boolean)
            .flatMap(s => s.split(' ').map(w => w.slice(1)))
            .sort();
        // /secret is reserved but never rendered (invisible built-in entry)
        expect(forms).not.toContain('secret');
        expect([...forms, 'secret'].sort()).toEqual([...PALETTE_RESERVED].sort());
    });

    it('custom rows render after the built-ins, tagged, ordered by usage', () => {
        const { palette, results, type } = setupCustoms({});
        palette.open();
        type('/'); // built-ins + customs, no bookmarks in slash mode
        const customs = results._appended.filter(li => li.className.includes('palette-command-custom'));
        expect(customs).toHaveLength(2);
        expect(results._appended.indexOf(customs[0])).toBe(COMMAND_MSGS.length);
        // useCount 3 > 1: Work apps first among the customs
        expect(customs[0]._innerHTML).toContain('Work apps');
        expect(customs[0]._innerHTML).toContain('palette-custom-tag');
        expect(customs[0]._innerHTML).toContain(MSGS.paletteCustomTag);
        expect(customs[0].dataset.ccId).toBe('cc_1');
        expect(customs[1]._innerHTML).toContain('Kimi search');
        expect(customs[1]._innerHTML).toContain('/g');
    });

    it('custom row slash markup never renders raw (load filter + row escape)', () => {
        // Two layers: loadCustomCommands drops the invalid alias, and the
        // row template escapes row.slash anyway (defense in depth — the
        // same injection face 43442a6 closed for cmd.name). Either way the
        // payload must not reach the palette DOM.
        const { palette, results, type } = setupCustoms({
            storeSeed: {
                paletteCustomCommands: JSON.stringify([{
                    id: 'cc_x', name: 'Esc', slash: 'esc',
                    aliases: ['</span><img src=x onerror=alert(1)>'],
                    action: { type: 'open-url', url: 'https://example.com/', where: 'tab' }
                }])
            }
        });
        palette.open();
        type('/esc');
        const customs = results._appended.filter(li => li.className.includes('palette-command-custom'));
        expect(customs).toHaveLength(1);
        expect(customs[0]._innerHTML).not.toContain('<img ');
        expect(customs[0]._innerHTML).not.toContain('onerror');
        expect(customs[0]._innerHTML).toContain('<span class="palette-slash">/esc</span>');
        palette.close();
    });

    it('slash mode prefix-matches a custom slash name and its aliases', () => {
        const { palette, results, type } = setupCustoms({});
        palette.open();
        type('/wo');
        const customs = results._appended.filter(li => li.className.includes('palette-command-custom'));
        expect(customs).toHaveLength(1);
        expect(customs[0]._innerHTML).toContain('Work apps');
        palette.close();
    });

    it('executing an open-url-group command opens the folder children and bumps useCount', () => {
        const ctx = setupCustoms({
            children: {
                '50': [
                    { id: '51', url: 'https://a.example/' },
                    { id: '52', url: 'https://b.example/' },
                    { id: '53', title: 'sub folder', children: [] } // folders are skipped
                ]
            }
        });
        ctx.palette.open();
        ctx.type('/work apps'); // rest words ride along; the group ignores them
        clickCommandRow(ctx, 'Work apps');
        expect(ctx.chrome.bookmarks.getChildrenCalls).toEqual(['50']);
        // where 'tab' → foreground tabs
        expect(ctx.actions.openBookmarksCalls).toEqual([[['https://a.example/', 'https://b.example/'], true]]);
        expect(ctx.palette.isOpen()).toBe(false);
        // useCount 3 → 4, persisted through the sync mirror
        const lastSave = ctx.store.syncSetCalls[ctx.store.syncSetCalls.length - 1];
        expect(lastSave[0]).toBe('paletteCustomCommands');
        const saved = JSON.parse(lastSave[1]);
        expect(saved.find(c => c.id === 'cc_1').useCount).toBe(4);
        expect(saved.find(c => c.id === 'cc_1').lastUsedAt).toBeGreaterThan(0);
    });

    it('a gone folder prompts the delete confirm; confirming removes the command', () => {
        const ctx = setupCustoms({}); // no children seeded for folder 50 → lastError
        ctx.palette.open();
        ctx.type('/work');
        clickCommandRow(ctx, 'Work apps');
        expect(ctx.actions.openBookmarksCalls).toEqual([]);
        expect(ctx.dialogs.ConfirmDialog.openCalls).toHaveLength(1);
        const cfg = ctx.dialogs.ConfirmDialog.openCalls[0];
        expect(cfg.dialog).toBe("The bookmark folder of 'Work apps' no longer exists. Delete the command?");
        cfg.fn1(); // user confirms the delete
        const lastSave = ctx.store.syncSetCalls[ctx.store.syncSetCalls.length - 1];
        expect(JSON.parse(lastSave[1]).map(c => c.id)).toEqual(['cc_2']);
    });

    it('a url-template command fills %s with the slash rest words', () => {
        const ctx = setupCustoms({});
        ctx.palette.open();
        ctx.type('/g kimi code');
        ctx.keydown(ctx.input, { key: 'Enter' }); // the only row: the template
        expect(ctx.actions.openBookmarkNewTabCalls).toEqual([['https://kimi.com/search?q=kimi%20code', true]]);
        expect(ctx.palette.isOpen()).toBe(false);
    });

    it('a url-template without rest words opens the template origin', () => {
        const ctx = setupCustoms({});
        ctx.palette.open();
        ctx.type('/g');
        clickCommandRow(ctx, 'Kimi search'); // fuzzy 'g' also hits the Go rows
        expect(ctx.actions.openBookmarkNewTabCalls).toEqual([['https://kimi.com', true]]);
    });

    it('plain mode fuzzy-matches a custom command by its display name', () => {
        const ctx = setupCustoms({});
        ctx.palette.open();
        ctx.type('kimi');
        const customs = ctx.results._appended.filter(li => li.className.includes('palette-command-custom'));
        expect(customs).toHaveLength(1);
        expect(customs[0]._innerHTML).toContain('Kimi search');
    });

    it('the save-as row on a hitless plain query prefills name and slash', () => {
        const ctx = setup({});
        ctx.palette.open();
        ctx.type('workless');
        const row = ctx.results._appended[ctx.results._appended.length - 1];
        expect(row._innerHTML).toContain("Save 'workless' as a custom command");
        fire(row, 'click', makeEvent({}));
        expect(ctx.chrome.tabs.createCalls).toHaveLength(1);
        const hash = decodeURIComponent(ctx.chrome.tabs.createCalls[0].url.split('#palette-cmd=')[1]);
        expect(JSON.parse(hash)).toEqual({ name: 'workless', slash: 'workless' });
    });

    it('a query that cannot be a slash name prefills the name only', () => {
        const ctx = setup({});
        ctx.palette.open();
        ctx.type('hello world');
        const row = ctx.results._appended[ctx.results._appended.length - 1];
        fire(row, 'click', makeEvent({}));
        const hash = decodeURIComponent(ctx.chrome.tabs.createCalls[0].url.split('#palette-cmd=')[1]);
        expect(JSON.parse(hash)).toEqual({ name: 'hello world', slash: '' });
    });

    it('customMenu.edit opens the options editor addressed at the command id', () => {
        const ctx = setupCustoms({});
        ctx.palette.customMenu.edit('cc_2');
        expect(ctx.chrome.tabs.createCalls).toHaveLength(1);
        const hash = decodeURIComponent(ctx.chrome.tabs.createCalls[0].url.split('#palette-cmd=')[1]);
        expect(JSON.parse(hash)).toEqual({ edit: 'cc_2' });
    });

    it('customMenu.remove asks once, then deletes and re-renders the open panel', () => {
        const ctx = setupCustoms({});
        ctx.palette.open();
        ctx.palette.customMenu.remove('cc_1');
        expect(ctx.dialogs.ConfirmDialog.openCalls).toHaveLength(1);
        const cfg = ctx.dialogs.ConfirmDialog.openCalls[0];
        expect(cfg.dialog).toBe("Delete the custom command 'Work apps'? It syncs to every device.");
        cfg.fn1();
        const lastSave = ctx.store.syncSetCalls[ctx.store.syncSetCalls.length - 1];
        expect(JSON.parse(lastSave[1]).map(c => c.id)).toEqual(['cc_2']);
        // the open panel re-rendered without the deleted row
        const customs = ctx.results._appended.filter(li => li.className.includes('palette-command-custom'));
        expect(customs).toHaveLength(1);
        expect(customs[0]._innerHTML).toContain('Kimi search');
    });
});

describe('closing a context menu over the palette (← / Esc) — focus returns to the input', () => {
    // Regression: ArrowRight opened a bookmark menu (focus moves to it);
    // closing it used to drop focus on the .active result row, and because
    // palette ↑↓ handlers live on the input, every further arrow key died
    // (visual selection stayed, keyboard did not).
    it('ArrowLeft closes the menu, clears the active marker and refocuses the input', () => {
        const clearCalls = [];
        const ctx = setup({ clearMenu: () => clearCalls.push(1) });
        ctx.palette.open();
        ctx.body.classList.add('active'); // a context menu is open on a result row
        ctx.showMenu(); // …and the menu element is actually visible (K6)
        const ev = ctx.keydown(ctx.doc, { key: 'ArrowLeft' });
        expect(ev.defaultPrevented).toBe(true);
        expect(ctx.body.classList.contains('active')).toBe(false); // marker dropped
        expect(ctx.input.focused).toBe(true); // ↑↓ keep working (they live on the input)
        expect(clearCalls).toHaveLength(2); // open() cleared once + this close
        expect(ctx.palette.isOpen()).toBe(true);
    });

    it('Escape closes the menu, keeps the panel open and refocuses the input', () => {
        const clearCalls = [];
        const ctx = setup({ clearMenu: () => clearCalls.push(1) });
        ctx.palette.open();
        ctx.body.classList.add('active');
        ctx.showMenu(); // the menu element is actually visible (K6)
        const ev = ctx.keydown(ctx.doc, { key: 'Escape' });
        expect(ev.defaultPrevented).toBe(true);
        expect(ctx.body.classList.contains('active')).toBe(false);
        expect(ctx.input.focused).toBe(true);
        expect(ctx.palette.isOpen()).toBe(true); // the menu closed, not the panel
    });

    it('leaves ArrowLeft alone when no menu is open over the palette', () => {
        const clearCalls = [];
        const ctx = setup({ clearMenu: () => clearCalls.push(1) });
        ctx.palette.open();
        const ev = ctx.keydown(ctx.doc, { key: 'ArrowLeft' });
        expect(ev.defaultPrevented).toBe(false);
        expect(ctx.palette.isOpen()).toBe(true);
        expect(clearCalls).toHaveLength(1); // only the open() clear
    });

    it('a stale .active marker without a VISIBLE menu does not swallow ← (K6 parity)', () => {
        // Regression: a menu-item pick / view switch ends in clearMenu()
        // (no arg), which keeps the .active marker while hiding every menu.
        // The next Ctrl+K open then ate the first ← (preventDefault +
        // stopImmediatePropagation on the capture handler) for a menu that
        // was not there.
        const clearCalls = [];
        const ctx = setup({ clearMenu: () => clearCalls.push(1) });
        ctx.palette.open();
        ctx.body.classList.add('active'); // stale marker, no menu visible
        const ev = ctx.keydown(ctx.doc, { key: 'ArrowLeft' });
        expect(ev.defaultPrevented).toBe(false);
        expect(ev.immediatePropagationStopped).toBe(false);
        expect(clearCalls).toHaveLength(1); // only the open() clear
        expect(ctx.palette.isOpen()).toBe(true);
    });

    it('a stale .active marker without a VISIBLE menu does not swallow Esc either', () => {
        const clearCalls = [];
        const ctx = setup({ clearMenu: () => clearCalls.push(1) });
        ctx.palette.open();
        ctx.body.classList.add('active'); // stale marker, no menu visible
        const ev = ctx.keydown(ctx.doc, { key: 'Escape' });
        expect(ev.defaultPrevented).toBe(false);
        expect(clearCalls).toHaveLength(1); // only the open() clear
        expect(ctx.palette.isOpen()).toBe(true); // onDocKey bowed out
    });

    it('input ← with a stale marker does not clear a menu that is not there', () => {
        const clearCalls = [];
        const ctx = setup({ clearMenu: () => clearCalls.push(1) });
        ctx.palette.open();
        ctx.body.classList.add('active'); // stale marker, no menu visible
        const ev = ctx.keydown(ctx.input, { key: 'ArrowLeft' });
        expect(ev.defaultPrevented).toBe(true); // the input's own ← handling stays
        expect(clearCalls).toHaveLength(1); // no phantom menu close
    });

    it('input Esc with a stale marker closes the panel (no menu to dismiss)', () => {
        const clearCalls = [];
        const ctx = setup({ clearMenu: () => clearCalls.push(1) });
        ctx.palette.open();
        ctx.body.classList.add('active'); // stale marker, no menu visible
        const ev = ctx.keydown(ctx.input, { key: 'Escape' });
        expect(ev.defaultPrevented).toBe(true);
        expect(clearCalls).toHaveLength(1); // no menu was cleared…
        expect(ctx.palette.isOpen()).toBe(false); // …so Esc reaches the panel close
    });

    it('unbinds the guard when the palette closes', () => {
        const clearCalls = [];
        const ctx = setup({ clearMenu: () => clearCalls.push(1) });
        ctx.palette.open();
        ctx.palette.close();
        ctx.body.classList.add('active');
        const ev = ctx.keydown(ctx.doc, { key: 'ArrowLeft' });
        expect(ev.defaultPrevented).toBe(false); // guard removed — no swallow
    });
});

describe('refocus() — keyboard.js Esc-chain delegation (K2)', () => {
    // Regression: Esc over a context menu that floats on the open palette is
    // captured by keyboard.js's document chain before the palette's own
    // open-time guard can run; keyboard.js delegates to palette.refocus(),
    // which must drop the .active marker, clear the menu and hand focus back
    // to the input without closing the panel.
    it('drops the .active marker, clears the menu and refocuses the input', () => {
        const clearCalls = [];
        const ctx = setup({ clearMenu: () => clearCalls.push(1) });
        ctx.palette.open();
        ctx.input.focused = false; // focus sits on the open menu
        ctx.body.classList.add('active');
        ctx.palette.refocus();
        expect(ctx.body.classList.contains('active')).toBe(false); // marker dropped BEFORE clearMenu
        expect(clearCalls).toHaveLength(2); // open() cleared once + refocus
        expect(ctx.input.focused).toBe(true);
        expect(ctx.palette.isOpen()).toBe(true); // the panel stays open
    });

    it('still refocuses the input when no clearMenu was injected', () => {
        const ctx = setup({});
        ctx.palette.open();
        ctx.input.focused = false;
        ctx.body.classList.add('active');
        expect(() => ctx.palette.refocus()).not.toThrow();
        expect(ctx.body.classList.contains('active')).toBe(false);
        expect(ctx.input.focused).toBe(true);
    });

    it('is a no-op marker-wise when no menu is open (just refocuses)', () => {
        const clearCalls = [];
        const ctx = setup({ clearMenu: () => clearCalls.push(1) });
        ctx.palette.open();
        clearCalls.length = 0; // ignore the open()-time clear
        ctx.palette.refocus();
        expect(clearCalls).toHaveLength(1); // clearMenu still runs, harmlessly
        expect(ctx.input.focused).toBe(true);
    });
});

describe('focused result row — keyboard still works (focus-ownership regression)', () => {
    // Regression: a Tab-focusable row (pre-tabindex) or a context-menu
    // refocus can leave REAL focus on a result row while the palette's
    // keyboard model (moveSelection/.selected) stays wired to the input.
    // An unguarded row then degrades ↑↓/Home/End/Space to Chrome's native
    // link defaults: Space scrolls the list, the CSS :hover follows the mouse
    // and the .selected highlight stays frozen. The $results keydown guard
    // must keep the input's contract reachable from a focused row.
    it('bookmark and folder row links are tabindex="-1", out of the Tab order', () => {
        const { palette, results, type } = setup({});
        palette.open();
        type('gmail');
        expect(results._appended[0]._innerHTML)
            .toMatch(/<a href="https:\/\/mail\.google\.com\/" tabindex="-1"/);
        type('dev');
        const folderRow = results._appended.find(li => li.className === 'palette-row palette-folder');
        expect(folderRow._innerHTML).toMatch(/<a href="" tabindex="-1"/);
    });

    it('↑↓ on a focused row still drive the .selected highlight', () => {
        const { palette, results, doc, keydown, type, selectedIndex } = setup({});
        palette.open();
        type('gmail');
        const row = results._appended[0];
        doc.activeElement = row; // stray Tab / menu refocus landed focus on a row
        keydown(results, { key: 'ArrowDown', target: row });
        expect(selectedIndex()).toBe(0);
        keydown(results, { key: 'ArrowDown', target: row });
        expect(selectedIndex()).toBe(1);
        keydown(results, { key: 'ArrowUp', target: row });
        expect(selectedIndex()).toBe(0);
    });

    it('Home/End on a focused row jump the selection to the list edges', () => {
        const { palette, results, doc, keydown, type, selectedIndex } = setup({});
        palette.open();
        type('gmail');
        const row = results._appended[1];
        doc.activeElement = row;
        keydown(results, { key: 'End', target: row });
        expect(selectedIndex()).toBe(results._appended.length - 1);
        keydown(results, { key: 'Home', target: row });
        expect(selectedIndex()).toBe(0);
    });

    it('Enter on a focused row executes THAT row (not the popup link navigation)', () => {
        const { palette, results, doc, actions, keydown, type } = setup({});
        palette.open();
        type('gmail');
        const row = results._appended[1]; // mail archive
        doc.activeElement = row;
        const ev = keydown(results, { key: 'Enter', target: row });
        expect(ev.defaultPrevented).toBe(true);
        expect(actions.openBookmarkCalls).toEqual(['https://gmail.com/inbox']);
        expect(palette.isOpen()).toBe(false);
    });

    it('Space on a focused row is preventDefaulted (no native scroll) and executes', () => {
        const { palette, results, doc, actions, keydown, type } = setup({});
        palette.open();
        type('gmail');
        const row = results._appended[0];
        doc.activeElement = row;
        const ev = keydown(results, { key: ' ', target: row });
        expect(ev.defaultPrevented).toBe(true);
        expect(actions.openBookmarkCalls).toEqual(['https://mail.google.com/']);
    });

    it('Ctrl+Enter on a focused row opens a new foreground tab, like the input path', () => {
        const { palette, results, doc, actions, keydown, type } = setup({});
        palette.open();
        type('gmail');
        const row = results._appended[0];
        doc.activeElement = row;
        keydown(results, { key: 'Enter', ctrlKey: true, target: row });
        expect(actions.openBookmarkNewTabCalls).toEqual([['https://mail.google.com/', true]]);
        expect(actions.openBookmarkCalls).toEqual([]);
    });

    it('a keydown on a non-row (the input) is left alone — no interference', () => {
        const { palette, input, keydown, type, selectedIndex } = setup({});
        palette.open();
        type('gmail');
        // focus on the input, as normal: ↑↓ still move the selection, Enter
        // still executes, and the row guard must not double-handle.
        keydown(input, { key: 'ArrowDown' });
        expect(selectedIndex()).toBe(0);
        keydown(input, { key: 'ArrowDown' });
        expect(selectedIndex()).toBe(1);
    });
});

describe('Tab ring: input ↔ Esc/close button', () => {
    it('Tab from the input moves focus to the close button, then back', () => {
        const { palette, paletteEl, input, closeBtn, doc, keydown } = setup({});
        palette.open();
        expect(doc.activeElement).toBe(input);
        keydown(paletteEl, { key: 'Tab' });
        expect(doc.activeElement).toBe(closeBtn);
        expect(palette.isOpen()).toBe(true); // both stops inside the panel
        keydown(paletteEl, { key: 'Tab' });
        expect(doc.activeElement).toBe(input);
    });

    it('Shift+Tab walks the same two-stop ring backwards', () => {
        const { palette, paletteEl, input, closeBtn, doc, keydown } = setup({});
        palette.open();
        keydown(paletteEl, { key: 'Tab', shiftKey: true });
        expect(doc.activeElement).toBe(closeBtn);
        keydown(paletteEl, { key: 'Tab', shiftKey: true });
        expect(doc.activeElement).toBe(input);
    });

    it('result rows and the × stay out of the ring', () => {
        const { palette, paletteEl, input, closeBtn, type, doc, keydown } = setup({});
        palette.open();
        type('gmail'); // rows render — they must not join the Tab order
        input.focus();
        keydown(paletteEl, { key: 'Tab' });
        expect(doc.activeElement).toBe(closeBtn); // straight to the close, never a row
    });

    it('non-Tab keys are left alone', () => {
        const { palette, paletteEl, keydown } = setup({});
        palette.open();
        const ev = keydown(paletteEl, { key: 'a' });
        expect(ev.defaultPrevented).toBe(false);
    });

    it('Tab does nothing while the palette is closed', () => {
        const { paletteEl, keydown } = setup({});
        const ev = keydown(paletteEl, { key: 'Tab' });
        expect(ev.defaultPrevented).toBe(false);
    });
});

describe('internal reserved entry', () => {
    it('the correct passphrases toggle the button-alt class and persist it (audit T6)', () => {
        const { palette, input, keydown, type, body, store } = setup({});
        palette.open();
        type('/secret button-alt-on');
        keydown(input, { key: 'Enter' });
        expect(palette.isOpen()).toBe(false);
        expect(body.classList.contains('vbm-btn-alt')).toBe(true);
        expect(store.setCalls).toEqual([['vbmBtnAlt', '1']]);

        palette.open();
        type('/secret button-alt-off');
        keydown(input, { key: 'Enter' });
        expect(palette.isOpen()).toBe(false);
        expect(body.classList.contains('vbm-btn-alt')).toBe(false);
        expect(store.setCalls).toEqual([['vbmBtnAlt', '1'], ['vbmBtnAlt', '']]);
    });

    it('an unmatched /secret param closes silently without toggling', () => {
        const { palette, input, keydown, type, body, store } = setup({});
        palette.open();
        type('/secret nope');
        keydown(input, { key: 'Enter' });
        expect(palette.isOpen()).toBe(false);
        expect(body.classList.contains('vbm-btn-alt')).toBe(false);
        expect(store.setCalls).toEqual([]);
    });

    it('a bare /secret is not consumed by the reserved path', () => {
        const { palette, input, results, type } = setup({});
        palette.open();
        type('/secret');
        // renders the generic save-as-command closure, never an invisible row
        expect(results._appended.some(li => li._innerHTML.includes("Save '"))).toBe(true);
        expect(results._appended.every(li => !li._innerHTML.includes('vbm-btn-alt'))).toBe(true);
    });
});
