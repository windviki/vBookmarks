import { describe, it, expect, beforeAll, afterAll } from 'vitest';

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

beforeAll(async () => {
    globalThis.window = globalThis; // fuzzy.js is a classic script: window = page global
    await import('../src/fuzzy.js');
    VBMFuzzy = globalThis.VBMFuzzy;
    ({ initPalette } = await import('../src/palette.js'));
});

afterAll(() => {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.chrome;
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
    paletteCmdGoRecent: 'Go to Recent view',
    paletteCmdGoStats: 'Go to Stats view',
    paletteCmdGoDead: 'Go to Dead links view',
    paletteCmdGoDupes: 'Go to Duplicates view',
    paletteCmdOptions: 'Open options page',
    paletteCmdSearchInView: "Search '$1' in Search view",
    sessionFolderName: 'Session $date$',
    sessionSaved: 'Saved $1 tabs to a new folder',
    sessionEmpty: 'No tabs to save',
    palettePlaceholder: 'Search bookmarks, folders, commands…',
    paletteNoResults: 'No matching results'
};

// The full command table in order (v4 task-2 §3.5): create-style commands,
// session, one Go command per registered view, /options last.
const COMMAND_MSGS = [
    MSGS.paletteCmdQuickAdd, MSGS.paletteCmdNewBookmark, MSGS.paletteCmdNewFolder,
    MSGS.paletteCmdNewSeparator, MSGS.paletteCmdSaveSession, MSGS.paletteCmdGoTree,
    MSGS.paletteCmdGoSearch, MSGS.paletteCmdGoRecent, MSGS.paletteCmdGoStats,
    MSGS.paletteCmdGoDead, MSGS.paletteCmdGoDupes, MSGS.paletteCmdOptions
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
                contains: c => classes.has(c)
            },
            addEventListener(type, fn) {
                (this._listeners[type] = this._listeners[type] || []).push(fn);
            },
            appendChild(child) {
                this._appended.push(child);
                child.parentNode = this;
            },
            focus() {
                this.focused = true;
            },
            blur() {
                this.blurred = true;
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
        return node;
    };

    const body = el('BODY', 'body');
    for (const cls of (opts.bodyClasses || []))
        body.classList.add(cls);
    const paletteEl = el('DIV', 'command-palette');
    paletteEl.hidden = true;
    const input = el('INPUT', 'palette-input');
    const results = el('UL', 'palette-results');
    const tree = el('DIV', 'tree');

    const qsTable = opts.qs || {};
    const doc = {
        _listeners: {},
        body,
        getElementById: id => byId[id] || null,
        createElement: tag => el(tag.toUpperCase()),
        querySelector: sel => (sel in qsTable ? qsTable[sel] : null),
        addEventListener(type, fn) {
            (this._listeners[type] = this._listeners[type] || []).push(fn);
        }
    };
    globalThis.document = doc;

    const treeData = opts.tree || makeTree();
    const tab = 'tab' in opts ? opts.tab : { id: 7, url: 'https://tab.example/', title: 'Tab Title' };
    const chromeStub = {
        i18n: { getMessage },
        bookmarks: {
            getTreeCalls: 0,
            createCalls: [],
            getTree(cb) {
                this.getTreeCalls++;
                cb(treeData);
            },
            create(props, cb) {
                this.createCalls.push(props);
                cb({ id: `n${this.createCalls.length}`, ...props });
            }
        },
        tabs: {
            queryCalls: [],
            query(q, cb) {
                this.queryCalls.push(q);
                // opts.tabs (array) serves the multi-tab session flow;
                // opts.tab keeps the single-active-tab command working.
                cb('tabs' in opts ? opts.tabs : (tab ? [tab] : []));
            }
        },
        windows: { WINDOW_ID_CURRENT: -1 },
        runtime: {
            getURL: p => `chrome-extension://test${p}`,
            openOptionsPageCalls: 0,
            openOptionsPage() {
                this.openOptionsPageCalls++;
            }
        }
    };
    globalThis.chrome = chromeStub;

    const actions = {
        openBookmarkCalls: [],
        openBookmarkNewTabCalls: [],
        addNewBookmarkNodeCalls: [],
        addSeparatorCalls: [],
        deleteBookmarkCalls: [],
        openBookmark(url) {
            this.openBookmarkCalls.push(url);
        },
        openBookmarkNewTab(url, selected) {
            this.openBookmarkNewTabCalls.push([url, selected]);
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
        }
    };
    const search = {
        runCalls: [],
        run(q) {
            this.runCalls.push(q);
        }
    };
    const quickAddCalls = [];
    const dialogs = {
        AlertDialog: {
            openCalls: [],
            open(msg) {
                this.openCalls.push(msg);
            }
        }
    };
    const onChangedCalls = [];
    const palette = initPalette({
        store: {},
        actions,
        treeView,
        views,
        search,
        quickAdd: () => quickAddCalls.push(1),
        rootFolderId: opts.rootFolderId || '1',
        dialogs,
        onChanged: () => onChangedCalls.push(1)
    });

    const keydown = (target, props) => {
        const ev = makeEvent(props);
        fire(target, 'keydown', ev);
        return ev;
    };
    const type = q => {
        input.value = q;
        fire(input, 'input', makeEvent({}));
    };
    const rowClasses = () => results._appended.map(li => li.className);
    const selectedIndex = () => results._appended.findIndex(li => li.classList.contains('selected'));

    return {
        palette, doc, body, chrome: chromeStub, actions, treeView, views, search,
        quickAddCalls, paletteEl, input, results, tree, el, treeData, dialogs,
        onChangedCalls, keydown, type, rowClasses, selectedIndex
    };
};

describe('module API + open/close state machine', () => {
    it('returns { open, close, isOpen } and starts closed', () => {
        const { palette, paletteEl } = setup({});
        expect(Object.keys(palette).sort()).toEqual(['close', 'isOpen', 'open']);
        expect(palette.isOpen()).toBe(false);
        expect(paletteEl.hidden).toBe(true);
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
        for (const cls of ['needConfirm', 'needEdit', 'needAlert', 'needInputName', 'needSort']) {
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

    it('close blurs the input when no tree row is available', () => {
        const { palette, input } = setup({});
        palette.open();
        palette.close();
        expect(input.blurred).toBe(true);
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
        // the three New-* commands first, the "New bookmark ideas" bookmark
        // hit, then the §4.4 bridge row — every fuzzy command hit (if any)
        // still lands ahead of the bookmark rows.
        const firstBookmark = classes.indexOf('palette-row palette-bookmark');
        expect(firstBookmark).toBeGreaterThanOrEqual(3);
        expect(results._appended[firstBookmark]._innerHTML).toContain('New bookmark ideas');
        const last = results._appended[results._appended.length - 1]._innerHTML;
        expect(last).toContain("Search 'new' in Search view");
    });

    it('a leading slash restricts results to commands even when bookmarks match', () => {
        const { palette, results, rowClasses, type } = setup({});
        palette.open();
        type('/new');
        // commands only — the three New-* rows via name/score, never the
        // "New bookmark ideas" bookmark hit
        expect(rowClasses().length).toBeGreaterThanOrEqual(3);
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
        // bookmark rows now use <a> + <i> structure matching search results
        expect(results._appended[0]._innerHTML).toContain('<i>Gmail</i>');
        expect(results._appended[1]._innerHTML).toContain('<i>mail archive</i>');
        expect(results._appended[2]._innerHTML).toContain("Search 'gmail' in Search view");
        // sanity: the double really is the implementation under test
        expect(VBMFuzzy.score('gmail', 'Gmail')).not.toBeNull();
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

    it('a plain query never renders the no-results row: the bridge row is the fallback', () => {
        const { palette, results, type } = setup({});
        palette.open();
        type('zzzz');
        expect(results._appended).toHaveLength(1);
        expect(results._appended[0].className).toBe('palette-row palette-command');
        expect(results._appended[0]._innerHTML).toContain("Search 'zzzz' in Search view");
    });

    it('a slash query with no matching command renders the no-results row', () => {
        const { palette, results, type } = setup({});
        palette.open();
        type('/zzzz');
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
});

describe('execution', () => {
    it('Enter without a selection executes the first row', () => {
        const { palette, input, actions, keydown, type } = setup({});
        palette.open();
        type('gmail');
        keydown(input, { key: 'Enter' });
        expect(actions.openBookmarkCalls).toEqual(['https://mail.google.com/']);
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

    it('Enter on a slash query with no matching command does nothing', () => {
        const { palette, input, actions, keydown, type } = setup({});
        palette.open();
        type('/zzzz');
        keydown(input, { key: 'Enter' });
        expect(actions.openBookmarkCalls).toEqual([]);
        expect(palette.isOpen()).toBe(true); // still open
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

    it('"New separator" adds one at the bottom of the root folder', () => {
        const ctx = setup({});
        runCommand(ctx, 3);
        expect(ctx.actions.addSeparatorCalls).toEqual([['1', 'bottom']]);
    });

    it('every create-style command carries its slash alias', () => {
        const { palette, results, type } = setup({});
        const cases = [
            ['/add', MSGS.paletteCmdQuickAdd],
            ['/new', MSGS.paletteCmdNewBookmark],
            ['/folder', MSGS.paletteCmdNewFolder],
            ['/sep', MSGS.paletteCmdNewSeparator]
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
        const last = results._appended[results._appended.length - 1];
        expect(last._innerHTML).toContain('&lt;b&gt;');
        expect(last._innerHTML).not.toContain('<b>');
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

// --- P3.2: save window tabs as folder --------------------------------------
// The command sits at index 4 in the command table (after the four
// create-style commands). The chrome double's tabs.query fires synchronously
// but saveSession resolves through a promise chain, so the assertions after
// a run await flush().
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const makeSessionTabs = () => [
    { id: 1, url: 'https://a.com/', title: 'A' },
    { id: 2, url: 'chrome://extensions/', title: 'Extensions' }, // unbookmarkable
    { id: 3, url: 'https://b.com/page', title: '' },             // title -> url
    { id: 4, url: 'https://a.com/', title: 'A dupe' }            // same-window dupe
];

const runSessionCommand = ctx => {
    ctx.palette.open();
    // first ArrowDown selects row 0; the session command is row 4
    for (let n = 0; n < 5; n++)
        ctx.keydown(ctx.input, { key: 'ArrowDown' });
    ctx.keydown(ctx.input, { key: 'Enter' });
};

describe('session save command (P3.2)', () => {
    it('lists the save-session command after the create-style commands, named via i18n', () => {
        const { palette, results, rowClasses } = setup({});
        palette.open();
        expect(rowClasses()[4]).toBe('palette-row palette-command');
        expect(results._appended[4]._innerHTML).toContain(MSGS.paletteCmdSaveSession);
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
