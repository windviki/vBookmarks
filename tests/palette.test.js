import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';

// palette.js touches page globals (document/window/chrome) only inside
// initPalette and its handlers, so the real module imports cleanly in node
// once the globals are stubbed. The element stubs wire `_listeners` +
// `fn.call(el, ev)` dispatch; innerHTML='' resets the appendChild record the
// way the real DOM drops children. chrome.bookmarks.getTree / chrome.tabs.query
// are recording doubles fed from per-test tables; chrome.i18n.getMessage is a
// message-table double. window.VBMFuzzy is the REAL implementation (fuzzy.js
// evaluated with window = globalThis), so ranking assertions exercise the
// actual fzf-style scoring. Nothing is copied from the module body.

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
    paletteCmdDupes: 'Clean duplicate bookmarks',
    paletteCmdSaveSession: 'Save window tabs as folder',
    paletteCmdDead: 'Find dead links',
    deadChecking: 'Checking $1 / $2…',
    deadNone: 'No dead links found',
    deadRescan: 'Rescan',
    deadConfirmDelete: 'Remove this bookmark?',
    deadConfirmAll: 'Delete all $1 dead bookmarks? This cannot be undone in one step.',
    deadDeleteAll: 'Delete all $1 dead bookmarks',
    sessionFolderName: 'Session $date$',
    sessionSaved: 'Saved $1 tabs to a new folder',
    sessionEmpty: 'No tabs to save',
    palettePlaceholder: 'Search bookmarks, folders, commands…',
    paletteNoResults: 'No matching results',
    dupesGroupCount: '$1 duplicates',
    dupesCleanAll: 'Clean all: $1 groups, $2 extra copies',
    dupesConfirmGroup: 'Keep the oldest and remove the other $1 copies?',
    dupesConfirmAll: 'Remove $1 extra copies across $2 groups? Oldest entries are kept.',
    dupesNone: 'No duplicates found',
    dupesDone: 'Removed $1 duplicate bookmarks',
    delete: 'Delete',
    nope: 'Nope'
};

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
            removeCalls: [],
            createCalls: [],
            getTree(cb) {
                this.getTreeCalls++;
                cb(treeData);
            },
            remove(id, cb) {
                this.removeCalls.push(id);
                cb();
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
        runtime: { getURL: p => `chrome-extension://test${p}` }
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
    const quickAddCalls = [];
    const dialogs = {
        ConfirmDialog: {
            openCalls: [],
            open(opts) {
                this.openCalls.push(opts);
            }
        },
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
        quickAdd: () => quickAddCalls.push(1),
        rootFolderId: opts.rootFolderId || '1',
        dialogs,
        onChanged: () => onChangedCalls.push(1),
        separatorManager: opts.separatorManager || null
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
        palette, doc, body, chrome: chromeStub, actions, treeView, quickAddCalls,
        paletteEl, input, results, tree, el, treeData, dialogs, onChangedCalls,
        keydown, type, rowClasses, selectedIndex
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
    it('an empty query renders only the seven commands, named via i18n', () => {
        const { palette, results, rowClasses } = setup({});
        palette.open();
        expect(rowClasses()).toEqual([
            'palette-row palette-command',
            'palette-row palette-command',
            'palette-row palette-command',
            'palette-row palette-command',
            'palette-row palette-command',
            'palette-row palette-command',
            'palette-row palette-command'
        ]);
        expect(results._appended[0]._innerHTML).toContain(MSGS.paletteCmdQuickAdd);
        expect(results._appended[1]._innerHTML).toContain(MSGS.paletteCmdNewBookmark);
        expect(results._appended[2]._innerHTML).toContain(MSGS.paletteCmdNewFolder);
        expect(results._appended[3]._innerHTML).toContain(MSGS.paletteCmdNewSeparator);
        expect(results._appended[4]._innerHTML).toContain(MSGS.paletteCmdDupes);
        expect(results._appended[5]._innerHTML).toContain(MSGS.paletteCmdDead);
        expect(results._appended[6]._innerHTML).toContain(MSGS.paletteCmdSaveSession);
    });

    it('a non-empty query lists matching commands before bookmarks/folders', () => {
        const { palette, results, rowClasses, type } = setup({});
        palette.open();
        type('new');
        expect(rowClasses()).toEqual([
            'palette-row palette-command', // New bookmark…
            'palette-row palette-command', // New folder…
            'palette-row palette-command', // New separator
            'palette-row palette-bookmark' // New bookmark ideas
        ]);
        expect(results._appended[3]._innerHTML).toContain('New bookmark ideas');
    });

    it('a leading slash restricts results to commands even when bookmarks match', () => {
        const { palette, rowClasses, type } = setup({});
        palette.open();
        type('/new');
        expect(rowClasses()).toEqual([
            'palette-row palette-command',
            'palette-row palette-command',
            'palette-row palette-command'
        ]);
    });

    it('a bare slash lists every command', () => {
        const { palette, rowClasses, type } = setup({});
        palette.open();
        type('/');
        expect(rowClasses()).toHaveLength(7);
    });

    it('ranks real fuzzy title hits above url-only hits', () => {
        const { palette, results, type } = setup({});
        palette.open();
        type('gmail');
        expect(results._appended).toHaveLength(2);
        expect(results._appended[0]._innerHTML).toContain('<span class="palette-title">Gmail</span>');
        expect(results._appended[1]._innerHTML).toContain('<span class="palette-title">mail archive</span>');
        // sanity: the double really is the implementation under test
        expect(VBMFuzzy.score('gmail', 'Gmail')).not.toBeNull();
    });

    it('flattens nested folders and their bookmarks into the index', () => {
        const { palette, results, rowClasses, type } = setup({});
        palette.open();
        type('github'); // nested inside folder 14
        expect(rowClasses()).toEqual(['palette-row palette-bookmark']);
        expect(results._appended[0]._innerHTML).toContain('GitHub');
        type('dev'); // the nested folder itself
        expect(rowClasses()).toEqual(['palette-row palette-folder']);
        expect(results._appended[0]._innerHTML).toContain('Dev');
    });

    it('keeps real root folders in the index (the synthetic root is skipped)', () => {
        const { palette, results, rowClasses, type } = setup({});
        palette.open();
        type('bookmarks bar'); // matches only the "Bookmarks bar" root folder
        expect(rowClasses()).toEqual(['palette-row palette-folder']);
        expect(results._appended[0]._innerHTML).toContain('Bookmarks bar');
    });

    it('renders the no-results row with the i18n message when nothing matches', () => {
        const { palette, results, type } = setup({});
        palette.open();
        type('zzzz');
        expect(results._appended).toHaveLength(1);
        expect(results._appended[0].className).toBe('palette-empty');
        expect(results._appended[0].textContent).toBe(MSGS.paletteNoResults);
    });

    it('re-renders on every input event', () => {
        const { palette, rowClasses, type } = setup({});
        palette.open();
        expect(rowClasses()).toHaveLength(7);
        type('gmail');
        expect(rowClasses()).toHaveLength(2);
        type('');
        expect(rowClasses()).toHaveLength(7);
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
        expect(rowClasses()).toEqual(['palette-row palette-bookmark']);
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
        palette.open(); // 7 command rows
        keydown(input, { key: 'ArrowUp' }); // wraps to the last row
        expect(selectedIndex()).toBe(6);
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
        const { palette, input, treeView, keydown, type } = setup({});
        palette.open();
        type('dev');
        keydown(input, { key: 'Enter' });
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

    it('Enter on an empty result list does nothing', () => {
        const { palette, input, actions, keydown, type } = setup({});
        palette.open();
        type('zzzz');
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

describe('command set v1', () => {
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
});

// --- P3.1: /dupes mode -------------------------------------------------------
// A tree where two URLs collide after normalization: group a.com has three
// copies (hash/utm variants), group b.com/page has two, plus one unique
// bookmark. getTree hands out `treeData` by reference, so tests mutate it
// between calls to simulate the deletions landing in the real backend.
const makeDupeTree = () => [{
    id: '0',
    title: '',
    children: [
        {
            id: '1', title: 'Bookmarks bar', dateAdded: 10,
            children: [
                { id: '11', title: 'A oldest', url: 'https://a.com/', dateAdded: 100 },
                { id: '12', title: 'A mid', url: 'https://a.com/#frag', dateAdded: 200 },
                { id: '13', title: 'A newest', url: 'https://a.com/?utm_source=x', dateAdded: 300 },
                { id: '14', title: 'B oldest', url: 'https://b.com/page', dateAdded: 150 },
                { id: '15', title: 'B newest', url: 'https://b.com/page#x', dateAdded: 250 },
                { id: '16', title: 'Unique', url: 'https://c.com/', dateAdded: 50 }
            ]
        }
    ]
}];

const dropIds = (tree, ids) => {
    const bar = tree[0].children[0];
    bar.children = bar.children.filter(n => !ids.includes(n.id));
};

// removeSequentially resolves through a promise chain even with a synchronous
// chrome.bookmarks.remove double — flush the microtask queue to observe it.
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const enterDupesMode = ctx => {
    ctx.palette.open();
    ctx.type('/dupes');
    ctx.keydown(ctx.input, { key: 'Enter' });
};

describe('dupes mode (P3.1)', () => {
    it("typing '/dupes' surfaces the dupes command alone, via its slash alias", () => {
        const { palette, results, rowClasses, type } = setup({});
        palette.open();
        type('/dupes');
        expect(rowClasses()).toEqual(['palette-row palette-command']);
        expect(results._appended[0]._innerHTML).toContain(MSGS.paletteCmdDupes);
    });

    it("the slash alias matches by prefix: '/d' already lists it", () => {
        const { palette, results, rowClasses, type } = setup({});
        palette.open();
        type('/dup');
        expect(rowClasses()).toContain('palette-row palette-command');
        expect(results._appended.some(li => li._innerHTML.includes(MSGS.paletteCmdDupes))).toBe(true);
    });

    it('executing the command switches into dupes mode without closing the panel', () => {
        const ctx = setup({ tree: makeDupeTree() });
        enterDupesMode(ctx);
        expect(ctx.palette.isOpen()).toBe(true);
        expect(ctx.rowClasses()).toEqual([
            'palette-row palette-dupes-all',
            'palette-row palette-dupe',
            'palette-row palette-dupe'
        ]);
    });

    it('the clean-all row spells out the group and extra-copy totals', () => {
        const ctx = setup({ tree: makeDupeTree() });
        enterDupesMode(ctx);
        expect(ctx.results._appended[0]._innerHTML)
            .toContain('Clean all: 2 groups, 3 extra copies');
    });

    it('group rows render the oldest title, the dupe count and the normalized URL', () => {
        const ctx = setup({ tree: makeDupeTree() });
        enterDupesMode(ctx);
        const rowA = ctx.results._appended[1]._innerHTML;
        expect(rowA).toContain('A oldest');      // title from the earliest entry
        expect(rowA).toContain('3 duplicates');  // dupesGroupCount
        expect(rowA).toContain('https://a.com'); // normalized key
        expect(rowA).not.toContain('utm_source');
        const rowB = ctx.results._appended[2]._innerHTML;
        expect(rowB).toContain('B oldest');
        expect(rowB).toContain('2 duplicates');
        expect(rowB).toContain('https://b.com/page');
    });

    it('shows the dupesNone empty-state when nothing collides', () => {
        const ctx = setup({}); // default tree has no duplicates
        enterDupesMode(ctx);
        expect(ctx.results._appended).toHaveLength(1);
        expect(ctx.results._appended[0].className).toBe('palette-empty');
        expect(ctx.results._appended[0].textContent).toBe(MSGS.dupesNone);
    });

    it('Enter on a group row opens a keep-oldest ConfirmDialog and keeps the panel open', () => {
        const ctx = setup({ tree: makeDupeTree() });
        enterDupesMode(ctx);
        ctx.keydown(ctx.input, { key: 'ArrowDown' });
        ctx.keydown(ctx.input, { key: 'ArrowDown' }); // row 1 = group a.com
        ctx.keydown(ctx.input, { key: 'Enter' });
        expect(ctx.dialogs.ConfirmDialog.openCalls).toHaveLength(1);
        const opts = ctx.dialogs.ConfirmDialog.openCalls[0];
        expect(opts.dialog).toBe('Keep the oldest and remove the other 2 copies?');
        expect(opts.button1).toContain(MSGS.delete);
        expect(opts.button2).toBe(MSGS.nope);
        expect(ctx.palette.isOpen()).toBe(true);
    });

    it('confirming a group removes the newer copies in order, refreshes and stays in dupes mode', async () => {
        const ctx = setup({ tree: makeDupeTree() });
        enterDupesMode(ctx);
        fire(ctx.results._appended[1], 'click', makeEvent({})); // group a.com
        // the backend lost ids 12+13 by the time fn1's refresh re-reads it
        dropIds(ctx.treeData, ['12', '13']);
        ctx.dialogs.ConfirmDialog.openCalls[0].fn1();
        await flush();
        expect(ctx.chrome.bookmarks.removeCalls).toEqual(['12', '13']); // oldest kept
        expect(ctx.onChangedCalls).toHaveLength(1);
        expect(ctx.palette.isOpen()).toBe(true);
        // rebuilt from the fresh tree: only group b.com remains
        expect(ctx.rowClasses()).toEqual([
            'palette-row palette-dupes-all',
            'palette-row palette-dupe'
        ]);
        expect(ctx.results._appended[0]._innerHTML)
            .toContain('Clean all: 1 groups, 1 extra copies');
    });

    it('cancelling the group dialog removes nothing', async () => {
        const ctx = setup({ tree: makeDupeTree() });
        enterDupesMode(ctx);
        fire(ctx.results._appended[1], 'click', makeEvent({}));
        // cancelling = fn1 never runs (ConfirmDialog's own fn2 is a no-op)
        await flush();
        expect(ctx.chrome.bookmarks.removeCalls).toEqual([]);
        expect(ctx.onChangedCalls).toEqual([]);
    });

    it('Enter on the clean-all row confirms with the cross-group totals', () => {
        const ctx = setup({ tree: makeDupeTree() });
        enterDupesMode(ctx);
        ctx.keydown(ctx.input, { key: 'Enter' }); // no selection: row 0 = clean-all
        const opts = ctx.dialogs.ConfirmDialog.openCalls[0];
        expect(opts.dialog).toBe('Remove 3 extra copies across 2 groups? Oldest entries are kept.');
        expect(ctx.palette.isOpen()).toBe(true);
    });

    it('confirming clean-all removes every doomed copy, alerts the count and closes to normal mode', async () => {
        const ctx = setup({ tree: makeDupeTree() });
        enterDupesMode(ctx);
        ctx.keydown(ctx.input, { key: 'Enter' });
        ctx.dialogs.ConfirmDialog.openCalls[0].fn1();
        await flush();
        expect(ctx.chrome.bookmarks.removeCalls).toEqual(['12', '13', '15']);
        expect(ctx.onChangedCalls).toHaveLength(1);
        expect(ctx.dialogs.AlertDialog.openCalls).toEqual(['Removed 3 duplicate bookmarks']);
        expect(ctx.palette.isOpen()).toBe(false);
        // next open is plain normal mode again
        ctx.palette.open();
        expect(ctx.rowClasses()).toHaveLength(7);
        expect(ctx.rowClasses().every(c => c === 'palette-row palette-command')).toBe(true);
    });

    it('Escape closes straight out of dupes mode; the next open starts in normal mode', () => {
        const ctx = setup({ tree: makeDupeTree() });
        enterDupesMode(ctx);
        expect(ctx.rowClasses()[0]).toBe('palette-row palette-dupes-all');
        ctx.keydown(ctx.input, { key: 'Escape' });
        expect(ctx.palette.isOpen()).toBe(false);
        ctx.palette.open();
        expect(ctx.rowClasses()).toHaveLength(7);
        expect(ctx.rowClasses()[0]).toBe('palette-row palette-command');
    });
});

// --- P3.2: save window tabs as folder --------------------------------------
// The command sits at index 6 in the command set (after /dupes and /dead).
// The chrome double's tabs.query fires synchronously but saveSession resolves
// through a promise chain, so the assertions after a run await flush().
const makeSessionTabs = () => [
    { id: 1, url: 'https://a.com/', title: 'A' },
    { id: 2, url: 'chrome://extensions/', title: 'Extensions' }, // unbookmarkable
    { id: 3, url: 'https://b.com/page', title: '' },             // title -> url
    { id: 4, url: 'https://a.com/', title: 'A dupe' }            // same-window dupe
];

const runSessionCommand = ctx => {
    ctx.palette.open();
    // first ArrowDown selects row 0; the session command is row 6
    for (let n = 0; n < 7; n++)
        ctx.keydown(ctx.input, { key: 'ArrowDown' });
    ctx.keydown(ctx.input, { key: 'Enter' });
};

describe('session save command (P3.2)', () => {
    it('lists the save-session command last, named via i18n', () => {
        const { palette, results, rowClasses } = setup({});
        palette.open();
        expect(rowClasses()).toHaveLength(7);
        expect(rowClasses()[6]).toBe('palette-row palette-command');
        expect(results._appended[6]._innerHTML).toContain(MSGS.paletteCmdSaveSession);
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

// --- P3.5: /dead mode -------------------------------------------------------
// dead-links.js does the fetching through the global fetch, so these tests
// double globalThis.fetch per case (restored after each). The tree holds two
// checkable bookmarks plus one separator; the separatorManager double marks
// separatethis.com URLs, and the scan must never probe them.
const makeDeadTree = () => [{
    id: '0',
    title: '',
    children: [
        {
            id: '1', title: 'Bookmarks bar', dateAdded: 10,
            children: [
                { id: '11', title: 'Fine', url: 'https://fine.example/', dateAdded: 100 },
                { id: '12', title: 'Gone', url: 'https://gone.example/page', dateAdded: 200 },
                { id: '13', title: 'Sep', url: 'http://separatethis.com/#7', dateAdded: 300 }
            ]
        }
    ]
}];

const sepManager = { isSeparator: (title, url) => url.indexOf('separatethis.com') !== -1 };

const enterDeadMode = ctx => {
    ctx.palette.open();
    ctx.type('/dead');
    ctx.keydown(ctx.input, { key: 'Enter' });
};

describe('dead-link scan mode (P3.5)', () => {
    const realFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = realFetch;
    });

    it("typing '/dead' surfaces the dead command alone, via its slash alias", () => {
        const { palette, results, rowClasses, type } = setup({});
        palette.open();
        type('/dead');
        expect(rowClasses()).toEqual(['palette-row palette-command']);
        expect(results._appended[0]._innerHTML).toContain(MSGS.paletteCmdDead);
    });

    it("the '/d' prefix lists both /dupes and /dead, dupes first", () => {
        const { palette, results, type } = setup({});
        palette.open();
        type('/d');
        const html = results._appended.map(li => li._innerHTML);
        const iDupes = html.findIndex(h => h.includes(MSGS.paletteCmdDupes));
        const iDead = html.findIndex(h => h.includes(MSGS.paletteCmdDead));
        expect(iDupes).toBeGreaterThanOrEqual(0);
        expect(iDead).toBeGreaterThan(iDupes); // command-table order wins
    });

    it('executing the command shows a 0/total progress line without closing', () => {
        globalThis.fetch = () => new Promise(() => {}); // hang: still scanning
        const ctx = setup({ tree: makeDeadTree(), separatorManager: sepManager });
        enterDeadMode(ctx);
        expect(ctx.palette.isOpen()).toBe(true);
        expect(ctx.results._appended).toHaveLength(1);
        expect(ctx.results._appended[0].className).toBe('palette-empty');
        expect(ctx.results._appended[0].textContent).toBe('Checking 0 / 2…');
    });

    it('never probes separators: filtered out of both the fetches and the total', () => {
        const calls = [];
        globalThis.fetch = url => {
            calls.push(url);
            return new Promise(() => {});
        };
        const ctx = setup({ tree: makeDeadTree(), separatorManager: sepManager });
        enterDeadMode(ctx);
        expect(calls).toEqual(['https://fine.example/', 'https://gone.example/page']);
        expect(ctx.results._appended[0].textContent).toBe('Checking 0 / 2…');
    });

    it('updates the progress line as checks settle, then renders the results', async () => {
        const gates = {};
        globalThis.fetch = url => new Promise(resolve => {
            gates[url] = status => resolve({ status });
        });
        const ctx = setup({ tree: makeDeadTree(), separatorManager: sepManager });
        enterDeadMode(ctx);
        expect(ctx.results._appended[0].textContent).toBe('Checking 0 / 2…');
        gates['https://fine.example/'](200);
        await flush();
        expect(ctx.results._appended[0].textContent).toBe('Checking 1 / 2…');
        gates['https://gone.example/page'](404);
        await flush();
        expect(ctx.rowClasses()).toEqual([
            'palette-row palette-dead-all',
            'palette-row palette-dead-rescan',
            'palette-row palette-dead'
        ]);
    });

    it('renders the rescan row and a status-badged row per dead bookmark', async () => {
        globalThis.fetch = url =>
            Promise.resolve({ status: url.indexOf('gone') !== -1 ? 404 : 200 });
        const ctx = setup({ tree: makeDeadTree(), separatorManager: sepManager });
        enterDeadMode(ctx);
        await flush();
        expect(ctx.results._appended[1]._innerHTML).toContain(MSGS.deadRescan);
        const row = ctx.results._appended[2]._innerHTML;
        expect(row).toContain('Gone');
        expect(row).toContain('https://gone.example/page');
        expect(row).toContain('<span class="palette-badge">404</span>');
    });

    it('shows the deadNone empty-state when every link checks out', async () => {
        globalThis.fetch = () => Promise.resolve({ status: 200 });
        const ctx = setup({ tree: makeDeadTree(), separatorManager: sepManager });
        enterDeadMode(ctx);
        await flush();
        expect(ctx.results._appended).toHaveLength(1);
        expect(ctx.results._appended[0].className).toBe('palette-empty');
        expect(ctx.results._appended[0].textContent).toBe(MSGS.deadNone);
    });

    it('Enter on a dead row deletes instantly via actions.deleteBookmark and drops the row', async () => {
        globalThis.fetch = url =>
            Promise.resolve({ status: url.indexOf('gone') !== -1 ? 404 : 200 });
        const ctx = setup({ tree: makeDeadTree(), separatorManager: sepManager });
        enterDeadMode(ctx);
        await flush();
        // Rows: delete-all, rescan, dead1. Skip past first two to reach the dead row.
        ctx.keydown(ctx.input, { key: 'ArrowDown' });
        ctx.keydown(ctx.input, { key: 'ArrowDown' });
        ctx.keydown(ctx.input, { key: 'ArrowDown' }); // row 2 = the dead row
        ctx.keydown(ctx.input, { key: 'Enter' });
        // v4.1: individual dead-row deletes are instant (no ConfirmDialog).
        // deleteBookmark carries undo toast + tree-row removal internally.
        expect(ctx.actions.deleteBookmarkCalls).toEqual(['12']);
        // The dead-all row and rescan row remain; the only dead row is gone → empty state
        expect(ctx.results._appended).toHaveLength(1);
        expect(ctx.results._appended[0].className).toBe('palette-empty');
    });

    it('the rescan row starts the scan over', async () => {
        globalThis.fetch = url =>
            Promise.resolve({ status: url.indexOf('gone') !== -1 ? 404 : 200 });
        const ctx = setup({ tree: makeDeadTree(), separatorManager: sepManager });
        enterDeadMode(ctx);
        await flush();
        expect(ctx.rowClasses()).toEqual([
            'palette-row palette-dead-all',
            'palette-row palette-dead-rescan',
            'palette-row palette-dead'
        ]);
        // Execute the rescan row and verify results reappear (re-scanned)
        ctx.keydown(ctx.input, { key: 'ArrowDown' }); // row 1 = rescan
        ctx.keydown(ctx.input, { key: 'Enter' });
        await flush();
        // After rescan, results are rendered again
        expect(ctx.rowClasses()).toEqual([
            'palette-row palette-dead-all',
            'palette-row palette-dead-rescan',
            'palette-row palette-dead'
        ]);
    });

    it('Escape aborts the in-flight scan and closes; the next open is normal mode', () => {
        const signals = [];
        globalThis.fetch = (url, opts) => {
            signals.push(opts.signal);
            return new Promise(() => {});
        };
        const ctx = setup({ tree: makeDeadTree(), separatorManager: sepManager });
        enterDeadMode(ctx);
        expect(signals).toHaveLength(2);
        const ev = ctx.keydown(ctx.input, { key: 'Escape' });
        expect(ev.propagationStopped).toBe(true);
        expect(ctx.palette.isOpen()).toBe(false);
        expect(signals.every(s => s.aborted)).toBe(true);
        ctx.palette.open();
        expect(ctx.rowClasses()).toHaveLength(7);
        expect(ctx.rowClasses().every(c => c === 'palette-row palette-command')).toBe(true);
    });
});
