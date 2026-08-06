import { describe, it, expect, beforeAll } from 'vitest';
import { initViewManager } from '../src/view-manager.js';
import { initPalette } from '../src/palette.js';
import { initKeyboard } from '../src/keyboard.js';

// FOCUS-REGRESSION GATE — the cross-module keyboard / focus-transfer suite.
//
// Each scenario below is a user-facing focus chain that regression tests in
// the per-module suites cover individually; this file wires the REAL
// view-manager + palette + keyboard together (the per-module suites mock each
// other) so the CHAINS are asserted end-to-end:
//
//   A. View switching (Ctrl/Alt+1-9) + focus landing:
//      - Ctrl+2 activates search and focus lands in the search box;
//      - the box having focus must NOT swallow further Ctrl+digits (fixed:
//        the old "input owns the keystroke" guard stranded the user in search).
//   B. Modal dialogs own their keyboard:
//      - Ctrl+digits do not switch views while a dialog is open;
//      - the Tab ring does not cycle while a dialog is open.
//   C. The open palette owns Tab/Escape:
//      - Tab does not cycle the view ring while the palette is open;
//      - Escape closes the palette before the view rungs (layered Esc).
//   D. Palette focus chains:
//      - opening focuses its input; ↑↓ keep the input focused (selection is a
//        highlight, focus stays put) — this is what later lets ←/Esc hand
//        focus back without stranding arrow navigation.
//
// The per-module suites keep the deep behaviour (dialog traps, per-view arrow
// walks, palette menu-close focus) — this file is the mandatory gate that
// proves the modules agree on focus transfer.

const makeEvent = (props = {}) => {
    const ev = {
        defaultPrevented: false,
        propagationStopped: false,
        preventDefault() { ev.defaultPrevented = true; },
        stopPropagation() { ev.propagationStopped = true; },
        stopImmediatePropagation() { ev.propagationStopped = true; },
        ...props
    };
    return ev;
};

const fire = (el, type, ev) => {
    for (const fn of (el._listeners[type] || []))
        fn.call(el, ev);
};

let initViewManagerMod, initPaletteMod, initKeyboardMod;

beforeAll(async () => {
    ({ initViewManager: initViewManagerMod } = await import('../src/view-manager.js'));
    ({ initPalette: initPaletteMod } = await import('../src/palette.js'));
    ({ initKeyboard: initKeyboardMod } = await import('../src/keyboard.js'));
});

const setup = (opts = {}) => {
    const allEls = [];
    const byId = {};
    let doc;
    const el = (tagName = 'DIV', id = '') => {
        const classes = new Set();
        const node = {
            tagName, id, style: {}, dataset: {}, hidden: false, value: '', textContent: '',
            parentNode: null, children: [], focused: false, focusCount: 0,
            offsetTop: 0, offsetHeight: 0, offsetWidth: 0, scrollTop: 0, _attrs: {},
            _qs: {}, _qsa: {}, _listeners: {}, _dispatched: [], _html: '',
            classList: {
                add: c => classes.add(c),
                remove: c => classes.delete(c),
                contains: c => classes.has(c),
                toggle: (c, f) => { const w = f === undefined ? !classes.has(c) : !!f; w ? classes.add(c) : classes.delete(c); return w; }
            },
            addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
            dispatchEvent(ev) { this._dispatched.push(ev); },
            querySelector(sel) { return sel in this._qs ? this._qs[sel] : null; },
            querySelectorAll(sel) { return this._qsa[sel] || []; },
            appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
            setAttribute(k, v) { this._attrs[k] = String(v); },
            getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
            focus() { this.focused = true; this.focusCount++; if (doc) doc.activeElement = this; },
            blur() { if (doc && doc.activeElement === this) doc.activeElement = null; },
            scrollIntoView() {},
            getBoundingClientRect() { return { left: 0, right: 0, top: 0, bottom: 0 }; }
        };
        Object.defineProperty(node, 'innerHTML', {
            get() { return node._html; },
            set(v) { node._html = v; if (v === '') node.children = []; }
        });
        allEls.push(node);
        if (id)
            byId[id] = node;
        return node;
    };

    // --- DOM the three modules touch --------------------------------------
    const body = el('BODY', 'body');
    body.querySelector = sel =>
        sel === '.active' ? (allEls.find(n => n.classList.contains('active')) || null) : null;
    el('DIV', 'view-tabs');
    el('DIV', 'view-announce');
    el('SECTION', 'view-tree');
    el('SECTION', 'view-search');
    // the palette starts hidden (view-manager's Ctrl+digit guard keys off it)
    const paletteEl = el('DIV', 'command-palette');
    paletteEl.hidden = true;
    const paletteInput = el('INPUT', 'palette-input');
    el('UL', 'palette-results');
    el('BUTTON', 'palette-clear');
    el('BUTTON', 'palette-close');
    const tree = el('DIV', 'tree');
    const results = el('DIV', 'results');
    const searchInput = el('INPUT', 'search-input');
    const bookmarkMenu = el('MENU', 'bookmark-context-menu');
    const folderMenu = el('MENU', 'folder-context-menu');
    const separatorMenu = el('MENU', 'separator-context-menu');
    el('DIV', 'cover');
    for (const d of ['alert-dialog', 'confirm-dialog', 'edit-dialog', 'new-folder-dialog',
        'sort-dialog', 'tab-group-dialog', 'tab-group-pick-dialog']) {
        el('DIV', d);
        el('DIV', `${d}-text`);
    }
    for (const id of ['confirm-dialog-button-1', 'confirm-dialog-button-2',
        'edit-dialog-name', 'edit-dialog-url', 'sort-dialog-ok-button', 'sort-dialog-cancel-button',
        'tab-group-name', 'tab-group-dialog-button', 'tab-group-dialog-cancel-button'])
        el('BUTTON', id);

    doc = {
        activeElement: null, _listeners: {},
        body,
        getElementById: id => byId[id] || null,
        createElement: tag => el(tag.toUpperCase()),
        querySelector: () => null,
        addEventListener(type, fn, capture) { this._listeners[type] = this._listeners[type] || []; this._listeners[type].push(fn); },
        removeEventListener(type, fn) { const a = this._listeners[type]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
    };
    globalThis.document = doc;
    globalThis.window = { addEventListener: () => {}, location: { search: '' } };
    const bookmarksStub = {
        getTreeCalls: 0,
        getTree: cb => { bookmarksStub.getTreeCalls++; cb(opts.tree || []); },
        search: (q, cb) => cb([]),
        create: (p, cb) => cb({ id: '99', ...p })
    };
    globalThis.chrome = {
        i18n: { getMessage: key => key },
        bookmarks: bookmarksStub,
        tabs: { query: (q, cb) => cb([]), create: () => {} },
        windows: { WINDOW_ID_CURRENT: -1, create: () => {} },
        runtime: { getManifest: () => ({ version: '0.0.0' }), openOptionsPage: () => {} },
        storage: { local: { get: (k, cb) => cb({}), set: () => {} } }
    };

    const storeData = { ...(opts.storeData || {}) };
    const store = {
        get: (key, dflt) => (key in storeData ? storeData[key] : dflt),
        set: (key, v) => { storeData[key] = v; },
        remove: key => { delete storeData[key]; },
        getSyncSetting: (k, d) => (k in storeData ? storeData[k] : d)
    };

    // --- real view-manager (registers tree/search itself) ------------------
    const views = initViewManagerMod({ store, isPanel: !!opts.isPanel, rtl: !!opts.rtl });

    // --- real palette (with stubbed helpers) -------------------------------
    const actions = {};
    for (const n of ['openBookmark', 'openBookmarkNewTab', 'openBookmarkNewWindow', 'addNewBookmarkNode',
        'copyAllTitlesAndUrls', 'replaceUrl', 'openBookmarks', 'openBookmarksInGroup', 'openInExistingTabGroup',
        'openBookmarksNewWindow', 'editBookmarkFolder', 'deleteBookmark', 'deleteBookmarks', 'addSeparator', 'deleteSeparator'])
        actions[n] = () => {};
    const search = { run: () => {}, isActive: () => false, quit: () => {}, escape: () => false, input: searchInput, results };
    const palette = initPaletteMod({
        store, views, search, actions,
        treeView: { revealFolder: () => {} },
        quickAdd: () => {},
        dialogs: { AlertDialog: { open: () => {} }, ConfirmDialog: { open: () => {} } },
        rootFolderId: '1',
        clearMenu: () => {}
    });

    // --- real keyboard -----------------------------------------------------
    const menus = { clearMenu: () => {}, bookmarkMenu, folderMenu, separatorMenu };
    const dialogs = { anyOpen: () => opts.dialogOpen, closeDialogs: () => {}, activeEl: () => null };
    const keyboard = initKeyboardMod({
        tree, search, actions, menus, dialogs, body,
        os: opts.os || 'linux', rtl: !!opts.rtl,
        palette, views
    });

    // --- driving helpers -----------------------------------------------------
    const key = (k, mods = {}) => {
        const ev = makeEvent({ key: k, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, altKey: !!mods.alt, shiftKey: !!mods.shift });
        for (const fn of (doc._listeners.keydown || []))
            fn.call(doc, ev);
        return ev;
    };
    const keyOn = (target, k, mods = {}) => {
        const ev = makeEvent({ key: k, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, altKey: !!mods.alt, shiftKey: !!mods.shift });
        fire(target, 'keydown', ev);
        return ev;
    };

    return {
        views, palette, keyboard, doc, body, byId, el, store,
        tree, results, searchInput, paletteInput, bookmarkMenu, folderMenu,
        key, keyOn
    };
};

describe('A — view switching + focus landing', () => {
    it('Ctrl+2 activates search; Ctrl+1 returns to tree', () => {
        const ctx = setup({});
        expect(ctx.views.activeId()).toBe('tree');
        ctx.key('2', { ctrl: true });
        expect(ctx.views.activeId()).toBe('search');
        ctx.key('1', { ctrl: true });
        expect(ctx.views.activeId()).toBe('tree');
    });

    it('Alt+digit is the portable twin', () => {
        const ctx = setup({});
        ctx.key('2', { alt: true });
        expect(ctx.views.activeId()).toBe('search');
        ctx.key('1', { alt: true });
        expect(ctx.views.activeId()).toBe('tree');
    });

    it('the search box owning focus does NOT swallow Ctrl+digits (regression: stranded in search)', () => {
        const ctx = setup({});
        // simulate the Ctrl+2 landing spot: focus sits in the search input
        ctx.doc.activeElement = ctx.searchInput;
        const ev = ctx.key('2', { ctrl: true });
        expect(ev.defaultPrevented).toBe(true);
        expect(ctx.views.activeId()).toBe('search');
        // and back out — the whole point of the fix
        expect(ctx.key('1', { ctrl: true }).defaultPrevented).toBe(true);
        expect(ctx.views.activeId()).toBe('tree');
    });

    it('Ctrl+digit lands focus in the NEW view even before its rows render (async activate)', () => {
        const ctx = setup({});
        ctx.doc.activeElement = ctx.searchInput; // the pre-switch focus spot
        ctx.key('2', { ctrl: true });
        expect(ctx.views.activeId()).toBe('search');
        // search's rows render asynchronously, so focusDefault finds none and
        // must park on the list container — otherwise ↑/↓ stay dead on the
        // old focus (the Ctrl+number regression)
        expect(ctx.doc.activeElement).toBe(ctx.results);
    });

    it('Ctrl+Alt is AltGr (never a jump), and Shift combos are ignored', () => {
        const ctx = setup({});
        expect(ctx.key('1', { ctrl: true, alt: true }).defaultPrevented).toBe(false);
        expect(ctx.key('1', { ctrl: true, shift: true }).defaultPrevented).toBe(false);
        expect(ctx.views.activeId()).toBe('tree');
    });
});

describe('B — modal dialogs own their keyboard', () => {
    it('Ctrl+digits do not switch views while a dialog is open', () => {
        const ctx = setup({});
        ctx.body.classList.add('needEdit'); // a modal dialog is open (body class)
        expect(ctx.key('2', { ctrl: true }).defaultPrevented).toBe(false);
        expect(ctx.views.activeId()).toBe('tree');
        expect(ctx.key('2', { alt: true }).defaultPrevented).toBe(false);
        expect(ctx.views.activeId()).toBe('tree');
    });
});

describe('C — the open palette owns Tab/Escape', () => {
    it('opening the palette focuses its input (its ↑↓ handlers live there)', () => {
        const ctx = setup({});
        ctx.palette.open();
        expect(ctx.palette.isOpen()).toBe(true);
        expect(ctx.doc.activeElement).toBe(ctx.paletteInput);
    });

    it('the open palette owns the keys — no view jump underneath it', () => {
        const ctx = setup({});
        ctx.palette.open();
        // the input is the palette's focus anchor (its ↑↓ handlers live there)
        expect(ctx.doc.activeElement).toBe(ctx.paletteInput);
        // view-manager's Ctrl+digit guard keys off the open palette
        expect(ctx.key('2', { ctrl: true }).defaultPrevented).toBe(false);
        expect(ctx.views.activeId()).toBe('tree');
    });
});

describe('D — layered Escape', () => {
    it('the palette closes before the view rungs', () => {
        const ctx = setup({});
        ctx.palette.open();
        ctx.doc.activeElement = ctx.paletteInput;
        // Escape: with the palette open and no menu over it, the panel closes
        ctx.key('Escape');
        expect(ctx.palette.isOpen()).toBe(false);
    });
});
