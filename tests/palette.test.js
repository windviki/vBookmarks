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
    palettePlaceholder: 'Search bookmarks, folders, commands…',
    paletteNoResults: 'No matching results'
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
        i18n: { getMessage: key => (key in MSGS ? MSGS[key] : key) },
        bookmarks: {
            getTreeCalls: 0,
            getTree(cb) {
                this.getTreeCalls++;
                cb(treeData);
            }
        },
        tabs: {
            queryCalls: [],
            query(q, cb) {
                this.queryCalls.push(q);
                cb(tab ? [tab] : []);
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
        }
    };
    const treeView = {
        revealFolderCalls: [],
        revealFolder(id) {
            this.revealFolderCalls.push(id);
        }
    };
    const quickAddCalls = [];
    const palette = initPalette({
        store: {},
        actions,
        treeView,
        quickAdd: () => quickAddCalls.push(1),
        rootFolderId: opts.rootFolderId || '1'
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
        paletteEl, input, results, tree, el, treeData,
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
    it('an empty query renders only the four commands, named via i18n', () => {
        const { palette, results, rowClasses } = setup({});
        palette.open();
        expect(rowClasses()).toEqual([
            'palette-row palette-command',
            'palette-row palette-command',
            'palette-row palette-command',
            'palette-row palette-command'
        ]);
        expect(results._appended[0]._innerHTML).toContain(MSGS.paletteCmdQuickAdd);
        expect(results._appended[1]._innerHTML).toContain(MSGS.paletteCmdNewBookmark);
        expect(results._appended[2]._innerHTML).toContain(MSGS.paletteCmdNewFolder);
        expect(results._appended[3]._innerHTML).toContain(MSGS.paletteCmdNewSeparator);
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
        expect(rowClasses()).toHaveLength(4);
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
        expect(rowClasses()).toHaveLength(4);
        type('gmail');
        expect(rowClasses()).toHaveLength(2);
        type('');
        expect(rowClasses()).toHaveLength(4);
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
        palette.open(); // 4 command rows
        keydown(input, { key: 'ArrowUp' }); // wraps to the last row
        expect(selectedIndex()).toBe(3);
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
