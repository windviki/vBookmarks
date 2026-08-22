import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';

// dialogs.js touches page globals (document/window/chrome) only inside
// initDialogs, so the real module imports cleanly in node once the globals
// are stubbed. ESM direct import — no copied implementation. The sort dialog
// reads persisted options through window.VBMSort.parseSortOptions, so the
// REAL sort-utils.js classic script is evaluated onto the window stub.

const makeEl = () => ({
    _innerHTML: '',
    // setting innerHTML replaces the element's children (the picker rebuilds
    // its <ul> this way); reading it returns the last value written.
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) {
        this._innerHTML = v;
        if (v === '')
            this.children = [];
    },
    textContent: '',
    value: '',
    checked: false,
    hidden: false,
    disabled: false,
    focused: false,
    scrollLeft: 0,
    style: {},
    tagName: 'DIV',
    className: '',
    dataset: {},
    attributes: {},
    setAttribute(name, value) {
        this.attributes[name] = String(value);
    },
    getAttribute(name) {
        return name in this.attributes ? this.attributes[name] : null;
    },
    children: [],
    parentNode: null,
    // model input[type=url] validity: tracks the current value like a browser
    get validity() {
        return { valid: /^https?:\/\/.+/.test(this.value) };
    },
    listeners: {},
    addEventListener(type, fn) {
        (this.listeners[type] = this.listeners[type] || []).push(fn);
    },
    trigger(type, event = {}) {
        (this.listeners[type] || []).map(fn => fn(event));
    },
    focus() {
        this.focused = true;
    },
    select() {},
    remove() {},
    appendChild(child) {
        this.children.push(child);
        child.parentNode = this;
    },
    querySelector(sel) {
        const want = sel.toUpperCase();
        for (const c of this.children)
            if (c.tagName === want)
                return c;
        return null;
    },
    // Tag-name descendant walk (the folder picker's ↑/↓ navigation reads its
    // row buttons this way).
    querySelectorAll(sel) {
        const want = sel.toUpperCase();
        const out = [];
        const walk = n => {
            for (const c of n.children || []) {
                if (c.tagName === want)
                    out.push(c);
                walk(c);
            }
        };
        walk(this);
        return out;
    }
});

const IDS = [
    'alert-dialog', 'confirm-dialog', 'edit-dialog', 'new-folder-dialog', 'sort-dialog',
    'alert-dialog-text',
    'confirm-dialog-text', 'confirm-dialog-button-1', 'confirm-dialog-button-2',
    'edit-dialog-text', 'edit-dialog-name', 'edit-dialog-url', 'edit-dialog-form', 'edit-dialog-cancel-button',
    'new-folder-dialog-text', 'new-folder-dialog-name', 'new-folder-dialog-form', 'new-folder-dialog-cancel-button',
    'sort-by-title', 'sort-by-date', 'sort-folders-first', 'sort-recursive', 'sort-recursive-warning',
    'sort-dialog-ok-button', 'sort-dialog-cancel-button',
    // P3.4: the new-tab-group dialog (title input + 9 color radios) and the
    // existing-group picker (its list + cancel button)
    'tab-group-dialog', 'tab-group-dialog-text', 'tab-group-name',
    'tab-group-dialog-button', 'tab-group-dialog-cancel-button',
    'tab-group-pick-dialog', 'tab-group-pick-text', 'tab-group-pick-list', 'tab-group-pick-cancel-button',
    'version-dialog', 'version-dialog-text', 'version-dialog-meta', 'version-dialog-copy', 'version-dialog-close',
    // 4.1.0: the tab-groups view's copy/move choice + bookmark-folder picker
    'copy-move-dialog', 'copy-move-dialog-text', 'copy-move-move-button', 'copy-move-copy-button', 'copy-move-cancel-button',
    'bookmark-folder-pick-dialog', 'bookmark-folder-pick-text', 'bookmark-folder-pick-list',
    'bookmark-folder-pick-cancel-button',
    // velvet staging §4.1: picker action buttons + quick-pick chrome
    'bookmark-folder-pick-move-button', 'bookmark-folder-pick-copy-button',
    'bookmark-folder-pick-chips', 'bookmark-folder-pick-filter', 'bookmark-folder-pick-note',
    // velvet staging §3.3: the group-assign dialog
    'staging-group-assign-dialog', 'staging-group-assign-text', 'staging-group-assign-list',
    'staging-group-assign-name', 'staging-group-assign-button', 'staging-group-assign-cancel-button',
    'cover'
];

const makeClassList = () => {
    const set = new Set();
    return {
        add: (...cs) => cs.forEach(c => set.add(c)),
        remove: (...cs) => cs.forEach(c => set.delete(c)),
        contains: c => set.has(c),
        _set: set
    };
};

let widont, initDialogs, els, bodyClasses, sorts, colorRadios, viewSections;

// The GroupDialog renders its 9 color swatches as hidden radio inputs; the
// dialog code reads them via document.querySelectorAll/querySelector.
const PALETTE = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

beforeAll(async () => {
    els = Object.fromEntries(IDS.map(id => [id, makeEl()]));
    colorRadios = PALETTE.map(color => {
        const r = makeEl();
        r.tagName = 'INPUT';
        r.type = 'radio';
        r.name = 'tab-group-color';
        r.value = color;
        return r;
    });
    bodyClasses = makeClassList();
    viewSections = [];
    globalThis.document = {
        getElementById: id => els[id] || null,
        body: { classList: bodyClasses, appendChild() {} },
        activeElement: null,
        execCommand() {
            this._execCommands = this._execCommands || [];
            this._execCommands.push('copy');
            return true;
        },
        createElement: tag => {
            const el = makeEl();
            el.tagName = tag.toUpperCase();
            return el;
        },
        querySelectorAll: sel => {
            if (sel === 'input[name="tab-group-color"]')
                return colorRadios;
            if (sel === '#views > section') // K15's disconnected-invoker fallback
                return viewSections;
            return [];
        },
        querySelector: sel =>
            sel === 'input[name="tab-group-color"]:checked'
                ? (colorRadios.find(r => r.checked) || null)
                : null
    };
    globalThis.window = { addEventListener: () => {} };
    globalThis.chrome = {
        i18n: { getMessage: key => key },
        // the bookmark-folder picker walks the whole tree at open time
        bookmarks: {
            getTree: cb => cb([{ id: '0', title: '', children: [
                { id: '1', title: 'Bar', children: [{ id: '11', title: 'Dev', children: [] }] },
                { id: '2', title: 'Other', children: [] }
            ] }])
        }
    };
    new Function('window', fs.readFileSync(new URL('../src/sort-utils.js', import.meta.url), 'utf8'))(globalThis.window);
    ({ widont, initDialogs } = await import('../src/dialogs.js'));
});

const freshDialogs = (store) => {
    bodyClasses._set.clear();
    sorts = [];
    viewSections = [];
    globalThis.document.activeElement = null;
    for (const r of colorRadios)
        r.checked = false;
    // els are shared across tests: drop every previously registered listener
    // so a trigger fires only THIS instance's handlers (the real popup runs
    // exactly one initDialogs) — accumulated handlers share the body classes
    // and race the K15 focus restore to a stale invoker.
    for (const id of IDS)
        els[id].listeners = {};
    return initDialogs({
        onSort: (folderId, opts) => sorts.push([folderId, opts]),
        store
    });
};

describe('widont', () => {
    it('replaces the last whitespace before the final word with &nbsp;', () => {
        expect(widont('hello world')).toBe('hello&nbsp;world');
        expect(widont('a b c')).toBe('a b&nbsp;c');
        expect(widont('single')).toBe('single');
        expect(widont('')).toBe('');
    });
});

describe('ConfirmDialog', () => {
    it('open fills text/buttons, widonts the message, focuses button 1, sets the class', () => {
        const d = freshDialogs();
        const fn1 = () => 'one';
        d.ConfirmDialog.open({ dialog: 'really delete this?', button1: 'yes', button2: 'no', fn1 });
        expect(els['confirm-dialog-text'].innerHTML).toBe('really delete&nbsp;this?');
        expect(els['confirm-dialog-button-1'].innerHTML).toBe('yes');
        expect(els['confirm-dialog-button-2'].innerHTML).toBe('no');
        expect(els['confirm-dialog-button-1'].focused).toBe(true);
        expect(bodyClasses.contains('needConfirm')).toBe(true);
        expect(d.ConfirmDialog.fn1).toBe(fn1);
    });

    it('button clicks invoke fn1/fn2 and close', () => {
        const d = freshDialogs();
        let called = '';
        d.ConfirmDialog.open({ dialog: 'x', button1: 'b1', button2: 'b2', fn1: () => called = 'fn1', fn2: () => called = 'fn2' });
        els['confirm-dialog-button-1'].trigger('click');
        expect(called).toBe('fn1');
        expect(bodyClasses.contains('needConfirm')).toBe(false);

        d.ConfirmDialog.open({ dialog: 'x', button1: 'b1', button2: 'b2' });
        els['confirm-dialog-button-2'].trigger('click');
        expect(called).toBe('fn2');
        expect(bodyClasses.contains('needConfirm')).toBe(false);
    });
});

describe('EditDialog', () => {
    it('bookmark type shows the url input; folder type hides and disables it', () => {
        const d = freshDialogs();
        d.EditDialog.open({ dialog: 'edit', type: 'bookmark', name: 'n', url: 'http://a.test/' });
        expect(els['edit-dialog-url'].disabled).toBe(false);
        expect(els['edit-dialog-url'].value).toBe('http://a.test/');
        expect(els['edit-dialog-name'].focused).toBe(true);
        expect(bodyClasses.contains('needEdit')).toBe(true);

        d.EditDialog.open({ dialog: 'edit', type: 'folder', name: 'f' });
        expect(els['edit-dialog-url'].style.display).toBe('none');
        expect(els['edit-dialog-url'].disabled).toBe(true);
        expect(els['edit-dialog-url'].value).toBe('');
    });

    it('close() prefixes an invalid url with http:// and passes name+url to fn', () => {
        const d = freshDialogs();
        let got = null;
        d.EditDialog.open({ dialog: 'edit', name: 'n', url: 'example.com', fn: (name, url) => got = [name, url] });
        els['edit-dialog-name'].value = 'renamed';
        els['edit-dialog-form'].trigger('submit');
        expect(got).toEqual(['renamed', 'http://example.com']);
        expect(bodyClasses.contains('needEdit')).toBe(false);
    });

    it('close(false) discards without calling fn', () => {
        const d = freshDialogs();
        let called = false;
        d.EditDialog.open({ dialog: 'edit', name: 'n', url: 'http://a.test/', fn: () => called = true });
        els['edit-dialog-cancel-button'].trigger('click');
        expect(called).toBe(false);
        expect(bodyClasses.contains('needEdit')).toBe(false);
    });
});

describe('NewFolderDialog', () => {
    it('close() passes the entered name; close(false) cancels', () => {
        const d = freshDialogs();
        let got = null;
        d.NewFolderDialog.open('NewFolder', name => got = name);
        expect(els['new-folder-dialog-text'].innerHTML).toBe('editFolder');
        expect(bodyClasses.contains('needInputName')).toBe(true);
        els['new-folder-dialog-name'].value = 'Docs';
        els['new-folder-dialog-form'].trigger('submit');
        expect(got).toBe('Docs');

        d.NewFolderDialog.open('NewFolder', name => got = name);
        els['new-folder-dialog-cancel-button'].trigger('click');
        expect(got).toBe('Docs');
        expect(bodyClasses.contains('needInputName')).toBe(false);
    });
});

describe('SortDialog', () => {
    it('open resets the options; ok confirms via onSort with parsed options', () => {
        const d = freshDialogs();
        d.SortDialog.open('42');
        expect(d.SortDialog.folderId).toBe('42');
        expect(els['sort-by-title'].checked).toBe(true);
        expect(bodyClasses.contains('needSort')).toBe(true);

        els['sort-by-date'].checked = true;
        els['sort-recursive'].checked = true;
        els['sort-dialog-ok-button'].trigger('click');
        expect(sorts).toEqual([['42', { by: 'dateAdded', foldersFirst: true, recursive: true }]]);
        expect(d.SortDialog.folderId).toBeNull();
        expect(bodyClasses.contains('needSort')).toBe(false);
    });

    it('prefills from persisted sortOptions (issue #33) instead of hardcoded defaults', () => {
        const store = {
            data: { sortOptions: '{"by":"dateAdded","foldersFirst":false,"recursive":true}' },
            get: k => store.data[k],
            set: (k, v) => { store.data[k] = v; }
        };
        const d = freshDialogs(store);
        d.SortDialog.open('42');
        expect(els['sort-by-title'].checked).toBe(false);
        expect(els['sort-by-date'].checked).toBe(true);
        expect(els['sort-folders-first'].checked).toBe(false);
        expect(els['sort-recursive'].checked).toBe(true);
        expect(els['sort-recursive-warning'].hidden).toBe(false);
    });

    it('confirm writes the chosen options back to sortOptions (last-used wins)', () => {
        const store = {
            data: { sortOptions: '{"by":"title","foldersFirst":true,"recursive":false}' },
            get: k => store.data[k],
            set: (k, v) => { store.data[k] = v; }
        };
        const d = freshDialogs(store);
        d.SortDialog.open('42');
        els['sort-by-date'].checked = true;
        els['sort-folders-first'].checked = false;
        els['sort-recursive'].checked = true;
        els['sort-dialog-ok-button'].trigger('click');
        expect(store.data.sortOptions)
            .toBe('{"by":"dateAdded","foldersFirst":false,"recursive":true}');
    });

    it('a corrupted sortOptions falls back to the defaults', () => {
        const store = {
            data: { sortOptions: 'not-json{[' },
            get: k => store.data[k],
            set: (k, v) => { store.data[k] = v; }
        };
        const d = freshDialogs(store);
        d.SortDialog.open('42');
        expect(els['sort-by-title'].checked).toBe(true);
        expect(els['sort-folders-first'].checked).toBe(true);
        expect(els['sort-recursive'].checked).toBe(false);
    });

    it('recursive checkbox toggles the warning row', () => {
        const d = freshDialogs();
        d.SortDialog.open('42');
        els['sort-recursive'].checked = true;
        els['sort-recursive'].trigger('change');
        expect(els['sort-recursive-warning'].hidden).toBe(false);
    });
});

describe('closeDialogs / anyOpen', () => {
    it('anyOpen reflects dialog body classes; closeDialogs cancels confirm via fn2 and closes all', () => {
        const d = freshDialogs();
        expect(d.anyOpen()).toBe(false);

        let fn2Called = false;
        d.ConfirmDialog.open({ dialog: 'x', button1: 'b1', button2: 'b2', fn2: () => fn2Called = true });
        d.EditDialog.open({ dialog: 'e', name: 'n', url: 'http://a.test/' });
        expect(d.anyOpen()).toBe(true);

        d.closeDialogs();
        expect(fn2Called).toBe(true);
        expect(d.anyOpen()).toBe(false);
    });

    it('cover click closes dialogs', () => {
        const d = freshDialogs();
        d.AlertDialog.open('boom');
        expect(bodyClasses.contains('needAlert')).toBe(true);
        els['cover'].trigger('click');
        expect(bodyClasses.contains('needAlert')).toBe(false);
    });

    it('activeEl maps the open dialog\'s body class to its element (final polish)', () => {
        const d = freshDialogs();
        expect(d.activeEl()).toBeNull();
        d.AlertDialog.open('boom');
        expect(d.activeEl()).toBe(els['alert-dialog']);
        d.AlertDialog.close();
        d.ConfirmDialog.open({ dialog: 'x', button1: 'b1', button2: 'b2' });
        expect(d.activeEl()).toBe(els['confirm-dialog']);
        d.closeDialogs();
        expect(d.activeEl()).toBeNull();
        d.SortDialog.open('42');
        expect(d.activeEl()).toBe(els['sort-dialog']);
        d.NewFolderDialog.open('n', () => {});
        expect(d.activeEl()).toBe(els['new-folder-dialog']); // stacked: input-name outranks sort
    });

    it('VersionDialog opens/renders/closes as a body-class dialog', () => {
        const d = freshDialogs();
        d.VersionDialog.open({
            app: 'vBookmarks', version: '4.0.8', manifestVersion: 3,
            channel: 'popup', announce: 'favicon-enhanced release',
            browser: 'Chrome', browserVersion: '124.0.0.0',
            os: 'macOS', language: 'en', userAgent: 'Mozilla/5.0 Chrome/124.0.0.0'
        });
        expect(bodyClasses.contains('needVersion')).toBe(true);
        expect(d.anyOpen()).toBe(true);
        expect(d.activeEl()).toBe(els['version-dialog']);
        expect(els['version-dialog-text'].textContent).toBe('versionDialogTitle');
        expect(els['version-dialog-meta'].innerHTML).toContain('Chrome 124.0.0.0');
        expect(els['version-dialog-copy'].textContent).toBe('versionDialogCopy');
        expect(els['version-dialog-copy'].focused).toBe(true);

        els['version-dialog-close'].trigger('click');
        expect(bodyClasses.contains('needVersion')).toBe(false);
        expect(d.anyOpen()).toBe(false);
        expect(d.activeEl()).toBeNull();
    });

    it('VersionDialog escapes every interpolated meta value', () => {
        const d = freshDialogs();
        d.VersionDialog.open({
            app: 'vBookmarks', version: '4.0.8', manifestVersion: 3,
            channel: 'popup', announce: '<script>alert(1)</script>',
            browser: 'Chrome', browserVersion: '124',
            os: '<img src=x onerror=alert(1)>', language: 'en',
            userAgent: '"><script>x</script>'
        });
        const html = els['version-dialog-meta'].innerHTML;
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
        d.VersionDialog.close();
    });

    it('VersionDialog close button fills the label span and keeps the kbd markup', () => {
        const d = freshDialogs();
        // the stub's querySelector matches children by uppercased "tag"
        const label = makeEl();
        label.tagName = '.VERSION-CLOSE-LABEL';
        els['version-dialog-close'].appendChild(label);
        d.VersionDialog.open({
            app: 'vBookmarks', version: '4.0.8', manifestVersion: 3,
            channel: 'popup', announce: '', browser: 'Chrome',
            browserVersion: '', os: '', language: 'en', userAgent: ''
        });
        expect(label.textContent).toBe('paletteClose');
        expect(els['version-dialog-close'].getAttribute('aria-label')).toBe('paletteClose');
        // no wholesale innerHTML rewrite — the markup's <kbd>Esc</kbd> survives
        expect(els['version-dialog-close'].innerHTML).toBe('');
        d.VersionDialog.close();
    });

    it('VersionDialog copy falls back to execCommand when writeText rejects', async () => {
        const d = freshDialogs();
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: { clipboard: { writeText: async () => { throw new Error('denied'); } } }
        });
        globalThis.document._execCommands = [];
        d.VersionDialog.open({
            app: 'vBookmarks', version: '4.0.8', manifestVersion: 3,
            channel: 'popup', announce: '', browser: 'Chrome',
            browserVersion: '', os: '', language: 'en', userAgent: ''
        });
        await d.VersionDialog.copy();
        expect(globalThis.document._execCommands).toEqual(['copy']);
        expect(els['version-dialog-copy'].textContent).toBe('versionDialogCopied');
        d.VersionDialog.close();
    });

    it('VersionDialog copy keeps the label when every clipboard path fails', async () => {
        const d = freshDialogs();
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: { clipboard: { writeText: async () => { throw new Error('denied'); } } }
        });
        const realExec = globalThis.document.execCommand;
        globalThis.document.execCommand = () => { throw new Error('no'); };
        d.VersionDialog.open({
            app: 'vBookmarks', version: '4.0.8', manifestVersion: 3,
            channel: 'popup', announce: '', browser: 'Chrome',
            browserVersion: '', os: '', language: 'en', userAgent: ''
        });
        await d.VersionDialog.copy();
        expect(els['version-dialog-copy'].textContent).toBe('versionDialogCopy');
        globalThis.document.execCommand = realExec;
        d.VersionDialog.close();
    });
});

describe('GroupDialog (P3.4: new tab group title + color)', () => {
    const checkedColor = () => colorRadios.find(r => r.checked);

    it('open prefills the title, selects the given color, focuses the input and sets the class', () => {
        const d = freshDialogs();
        d.GroupDialog.open({ title: 'My Folder', color: 'blue', onConfirm: () => {} });
        expect(els['tab-group-dialog-text'].innerHTML).toBe('tabGroupDialogTitle');
        expect(els['tab-group-name'].value).toBe('My Folder');
        expect(els['tab-group-name'].focused).toBe(true);
        expect(checkedColor().value).toBe('blue');
        expect(bodyClasses.contains('needTabGroup')).toBe(true);
    });

    it('derives a default color from the title via the hash picker when none is passed', () => {
        const d = freshDialogs();
        d.GroupDialog.open({ title: 'Dev Stuff', onConfirm: () => {} });
        // pickGroupColor('Dev Stuff') = charCode sum 839 % 9 = index 2 = 'red'.
        // A palette-membership assertion would pass even if the picker
        // degenerated to a constant color — pin the deterministic result.
        expect(checkedColor().value).toBe('red');
        // same title → same color across reopens (stable, not a random pick)
        const d2 = freshDialogs();
        d2.GroupDialog.open({ title: 'Dev Stuff', onConfirm: () => {} });
        expect(checkedColor().value).toBe('red');
    });

    it('falls back to the first radio when no title-derived color exists (empty title)', () => {
        const d = freshDialogs();
        d.GroupDialog.open({ title: '', onConfirm: () => {} });
        expect(checkedColor().value).toBe('grey');
    });

    it('close confirms with the trimmed title and the selected color', () => {
        const d = freshDialogs();
        let confirmed = null;
        d.GroupDialog.open({ title: '  My Folder  ', color: 'purple', onConfirm: (t, c) => confirmed = [t, c] });
        d.GroupDialog.close();
        expect(confirmed).toEqual(['My Folder', 'purple']);
        expect(bodyClasses.contains('needTabGroup')).toBe(false);
    });

    it('close(false) cancels without confirming', () => {
        const d = freshDialogs();
        let confirmed = false;
        d.GroupDialog.open({ title: 'x', color: 'red', onConfirm: () => confirmed = true });
        d.GroupDialog.close(false);
        expect(confirmed).toBe(false);
        expect(bodyClasses.contains('needTabGroup')).toBe(false);
    });

    it('the OK button confirms and the cancel button cancels', () => {
        const d = freshDialogs();
        let confirmed = null;
        d.GroupDialog.open({ title: 'A', color: 'green', onConfirm: (t, c) => confirmed = [t, c] });
        els['tab-group-name'].value = 'B';
        els['tab-group-dialog-button'].trigger('click');
        expect(confirmed).toEqual(['B', 'green']);
        expect(bodyClasses.contains('needTabGroup')).toBe(false);

        d.GroupDialog.open({ title: 'A', color: 'green', onConfirm: () => confirmed = 'again' });
        els['tab-group-dialog-cancel-button'].trigger('click');
        expect(confirmed).toEqual(['B', 'green']); // untouched: cancel does not confirm
        expect(bodyClasses.contains('needTabGroup')).toBe(false);
    });

    it('the closeDialogs escape path cancels without confirming', () => {
        const d = freshDialogs();
        let confirmed = false;
        d.GroupDialog.open({ title: 'x', color: 'red', onConfirm: () => confirmed = true });
        d.closeDialogs();
        expect(confirmed).toBe(false);
        expect(d.anyOpen()).toBe(false);
    });

    it('open without onConfirm resets the handler (no sticky callback)', () => {
        const d = freshDialogs();
        let first = 0;
        d.GroupDialog.open({ title: 'A', color: 'blue', onConfirm: () => first++ });
        d.GroupDialog.close(false); // cancel: the armed handler stays unused
        d.GroupDialog.open({ title: 'B' }); // no callback this time
        d.GroupDialog.close();
        expect(first).toBe(0); // the previous handler must not leak into this open
    });

    it('Enter in the title input saves (same path as the Save button)', () => {
        const d = freshDialogs();
        let confirmed = null;
        d.GroupDialog.open({ title: 'A', color: 'cyan', onConfirm: (t, c) => confirmed = [t, c] });
        els['tab-group-name'].value = 'B';
        const ev = { key: 'Enter', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
        els['tab-group-name'].trigger('keydown', ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(confirmed).toEqual(['B', 'cyan']);
        expect(bodyClasses.contains('needTabGroup')).toBe(false);
    });

    it('other keys in the title input do not save (Escape is left to the Esc layer)', () => {
        const d = freshDialogs();
        let confirmed = null;
        d.GroupDialog.open({ title: 'A', color: 'cyan', onConfirm: (t, c) => confirmed = [t, c] });
        els['tab-group-name'].trigger('keydown', { key: 'a' });
        els['tab-group-name'].trigger('keydown', { key: 'Escape' });
        expect(confirmed).toBeNull();
        expect(bodyClasses.contains('needTabGroup')).toBe(true);
    });

    it('every color radio gets a localized accessible name (aria-label from its color key)', () => {
        freshDialogs();
        // the i18n stub echoes the key back, so each radio must carry
        // tabGroupColor<Color> for its palette entry
        expect(colorRadios.map(r => r.getAttribute('aria-label')))
            .toEqual(PALETTE.map(c => `tabGroupColor${c[0].toUpperCase()}${c.slice(1)}`));
    });
});

describe('GroupPickDialog (P3.4: pick an existing tab group)', () => {
    it('open renders one button per group (sorted) and a pick dispatches the group id', () => {
        const d = freshDialogs();
        let picked = null;
        d.GroupPickDialog.open({
            groups: [
                { id: 'g2', title: 'Zeta', color: 'blue' },
                { id: 'g1', title: 'Alpha', color: 'red' }
            ],
            onPick: id => picked = id
        });
        expect(els['tab-group-pick-text'].innerHTML).toBe('tabGroupPickDialogTitle');
        expect(bodyClasses.contains('needGroupPick')).toBe(true);
        const list = els['tab-group-pick-list'];
        expect(list.children).toHaveLength(2);
        // sorted by title: Alpha first
        expect(list.children[0].children[0].innerHTML).toContain('Alpha');
        expect(list.children[1].children[0].innerHTML).toContain('Zeta');
        // clicking the Alpha row picks g1 and closes
        list.children[0].children[0].trigger('click');
        expect(picked).toBe('g1');
        expect(bodyClasses.contains('needGroupPick')).toBe(false);
    });

    it('shows an untitled label for groups without a title', () => {
        const d = freshDialogs();
        d.GroupPickDialog.open({ groups: [{ id: 'g1', title: '', color: 'grey' }], onPick: () => {} });
        expect(els['tab-group-pick-list'].children[0].children[0].innerHTML).toContain('tabGroupUntitled');
    });

    it('renders an empty state when there are no groups and focuses the cancel button', () => {
        const d = freshDialogs();
        d.GroupPickDialog.open({ groups: [], onPick: () => {} });
        const list = els['tab-group-pick-list'];
        expect(list.children).toHaveLength(1);
        expect(list.children[0].className).toBe('tab-group-pick-empty');
        expect(list.children[0].textContent).toBe('tabGroupNoGroups');
        expect(els['tab-group-pick-cancel-button'].focused).toBe(true);
    });

    it('cancel closes the picker without dispatching', () => {
        const d = freshDialogs();
        let picked = false;
        d.GroupPickDialog.open({ groups: [{ id: 'g1', title: 'X' }], onPick: () => picked = true });
        els['tab-group-pick-cancel-button'].trigger('click');
        expect(picked).toBe(false);
        expect(bodyClasses.contains('needGroupPick')).toBe(false);
    });

    it('activeEl + closeDialogs cover the picker', () => {
        const d = freshDialogs();
        d.GroupPickDialog.open({ groups: [], onPick: () => {} });
        expect(d.activeEl()).toBe(els['tab-group-pick-dialog']);
        expect(d.anyOpen()).toBe(true);
        d.closeDialogs();
        expect(d.anyOpen()).toBe(false);
    });

    it('color dots use the tg-<color> class (the --tg-color token lives there, tg-color-* matches no rule)', () => {
        const d = freshDialogs();
        d.GroupPickDialog.open({ groups: [{ id: 'g1', title: 'A', color: 'purple' }], onPick: () => {} });
        expect(els['tab-group-pick-list'].children[0].children[0].innerHTML)
            .toContain('tab-group-dot tg-purple');
    });

    it('rows carry the full group title as a tooltip (long titles truncate in the row)', () => {
        const d = freshDialogs();
        d.GroupPickDialog.open({
            groups: [{ id: 'g1', title: 'A very long group title', color: 'grey' }],
            onPick: () => {}
        });
        expect(els['tab-group-pick-list'].children[0].children[0].title).toBe('A very long group title');
    });

    it('open without onPick resets the handler (no sticky callback)', () => {
        const d = freshDialogs();
        let first = 0;
        d.GroupPickDialog.open({ groups: [{ id: 'g1', title: 'A', color: 'red' }], onPick: () => first++ });
        d.GroupPickDialog.close();
        d.GroupPickDialog.open({ groups: [{ id: 'g2', title: 'B', color: 'blue' }] }); // no callback
        els['tab-group-pick-list'].children[0].children[0].trigger('click');
        expect(first).toBe(0); // the previous handler must not leak into this open
    });
});

describe('K15: closing a dialog hands focus back to its invoker', () => {
    // The element the dialog is opened from — a tree row in the real popup.
    const invoker = () => {
        const el = makeEl();
        globalThis.document.activeElement = el;
        return el;
    };
    // Every dialog's natural cancel/close trigger — the unified close path
    // must restore focus no matter which dialog was up.
    const cases = [
        ['alert (cover-click close-all)',
            d => d.AlertDialog.open('boom'),
            () => els['cover'].trigger('click')],
        ['confirm (cancel button)',
            d => d.ConfirmDialog.open({ dialog: 'x', button1: 'b1', button2: 'b2' }),
            () => els['confirm-dialog-button-2'].trigger('click')],
        ['edit (cancel button)',
            d => d.EditDialog.open({ dialog: 'e', name: 'n', url: 'http://a.test/' }),
            () => els['edit-dialog-cancel-button'].trigger('click')],
        ['new-folder (cancel button)',
            d => d.NewFolderDialog.open('NF', () => {}),
            () => els['new-folder-dialog-cancel-button'].trigger('click')],
        ['sort (cancel button)',
            d => d.SortDialog.open('42'),
            () => els['sort-dialog-cancel-button'].trigger('click')],
        ['tab-group (cancel button)',
            d => d.GroupDialog.open({}),
            () => els['tab-group-dialog-cancel-button'].trigger('click')],
        ['group-pick (cancel button)',
            d => d.GroupPickDialog.open({ groups: [] }),
            () => els['tab-group-pick-cancel-button'].trigger('click')]
    ];
    it.each(cases)('%s', (label, open, cancel) => {
        const d = freshDialogs();
        const from = invoker();
        open(d);
        expect(d.anyOpen()).toBe(true);
        expect(from.focused).toBe(false); // the dialog's control owns focus now
        cancel();
        expect(d.anyOpen()).toBe(false);
        expect(from.focused).toBe(true); // handed back — arrows live again
    });

    it('closeDialogs (the Esc layer\'s path) restores focus too', () => {
        const d = freshDialogs();
        const from = invoker();
        d.EditDialog.open({ dialog: 'e', name: 'n', url: 'http://a.test/' });
        d.closeDialogs();
        expect(d.anyOpen()).toBe(false);
        expect(from.focused).toBe(true);
    });

    it('a disconnected invoker falls back to the visible view\'s anchor', () => {
        const d = freshDialogs();
        const from = invoker();
        from.isConnected = false; // a re-render swapped the row out mid-dialog
        const anchorRow = makeEl();
        const list = {
            focused: false,
            querySelector: sel => (sel === '.focus' ? anchorRow : null),
            focus() { this.focused = true; }
        };
        viewSections = [
            { hidden: true, querySelector: () => null }, // the inactive views are skipped
            { hidden: false, querySelector: sel => (sel === 'div[tabindex]' ? list : null) }
        ];
        d.ConfirmDialog.open({ dialog: 'x', button1: 'b1', button2: 'b2' });
        els['confirm-dialog-button-1'].trigger('click');
        expect(from.focused).toBe(false);
        expect(anchorRow.focused).toBe(true); // the visible view's .focus row
    });

    it('a follow-up dialog opened from a close handler keeps the modal focus (no steal)', () => {
        const d = freshDialogs();
        const from = invoker();
        d.EditDialog.open({
            dialog: 'e', name: 'n', url: 'http://a.test/',
            fn: () => d.AlertDialog.open('saved') // edit → save chains an alert
        });
        els['edit-dialog-form'].trigger('submit');
        expect(bodyClasses.contains('needEdit')).toBe(false);
        expect(bodyClasses.contains('needAlert')).toBe(true);
        expect(from.focused).toBe(false); // never yanked out of the follow-up dialog
        els['cover'].trigger('click'); // closing the alert returns the invoker at last
        expect(from.focused).toBe(true);
    });

    it('closeDialogs with nothing open never steals focus (the was-open guard)', () => {
        const d = freshDialogs();
        const somewhere = makeEl();
        globalThis.document.activeElement = somewhere;
        d.closeDialogs(); // ConfirmDialog.close runs unconditionally inside
        expect(somewhere.focused).toBe(false);
    });
});

describe('Ctrl/Cmd+D quick-add guard (quick-add.js)', () => {
    // The Ctrl/Cmd+D capture handler lives in src/quick-add.js (extracted
    // from neat.js); its dialog-open guard list is asserted on the source —
    // the behavioral side (suppression while a dialog is open) is covered by
    // tests/quick-add.test.js's bindQuickAddKey cases.
    it('skips quick-add while either tab-group dialog is open', () => {
        const src = fs.readFileSync(new URL('../src/quick-add.js', import.meta.url), 'utf8');
        const start = src.indexOf('if (!(e.metaKey || e.ctrlKey)');
        const end = src.indexOf('quickAddCurrentTab();', start);
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);
        const guardBlock = src.slice(start, end);
        expect(guardBlock).toContain("body.classList.contains('needTabGroup')");
        expect(guardBlock).toContain("body.classList.contains('needGroupPick')");
    });
});

describe('BookmarkFolderPickDialog (4.1.0 + velvet staging §4.1)', () => {
    // row buttons only (every li now also carries an inline pin toggle)
    const rowBtns = () => els['bookmark-folder-pick-list']
        .querySelectorAll('button')
        .filter(b => (b.className || '').indexOf('bookmark-folder-pick-row') >= 0);
    const pinBtns = () => els['bookmark-folder-pick-list']
        .querySelectorAll('button')
        .filter(b => (b.className || '').indexOf('folder-pick-pin-btn') >= 0);
    const miniStore = (data = {}) => ({
        data,
        get(k, def) { return k in this.data ? this.data[k] : def; },
        set(k, v) { this.data[k] = v; }
    });

    it('renders the folder tree as indented rows and picks on click (legacy mode)', () => {
        const d = freshDialogs();
        const picks = [];
        d.BookmarkFolderPickDialog.open({ dialog: 'Pick one', onPick: (id, action) => picks.push([id, action]) });
        expect(bodyClasses.contains('needFolderPick')).toBe(true);
        const btns = rowBtns();
        expect(btns).toHaveLength(3); // Bar, Dev (child), Other
        expect(btns[0].textContent).toBe('Bar');
        expect(btns[1].textContent).toBe('Dev');
        expect(btns[1].style.paddingInlineStart).toBe('24px'); // 8 + depth*16
        // legacy: no mode key → single-select form, move/copy buttons hidden
        expect(els['bookmark-folder-pick-move-button'].hidden).toBe(true);
        expect(els['bookmark-folder-pick-copy-button'].hidden).toBe(true);
        btns[1].trigger('click');
        expect(picks).toEqual([['11', 'pick']]);
        expect(bodyClasses.contains('needFolderPick')).toBe(false);
    });

    it('legacy picks record the target into folderPickRecents', () => {
        const store = miniStore();
        const d = freshDialogs(store);
        d.BookmarkFolderPickDialog.open({ dialog: 'x', onPick: () => {} });
        rowBtns()[2].trigger('click'); // Other = '2'
        d.BookmarkFolderPickDialog.open({ dialog: 'x', onPick: () => {} });
        rowBtns()[1].trigger('click'); // Dev = '11' — LRU, newest first
        expect(JSON.parse(store.data.folderPickRecents)).toEqual(['11', '2']);
    });

    it('three-button mode: row click selects, action button commits with the action', () => {
        const store = miniStore();
        const d = freshDialogs(store);
        const picks = [];
        d.BookmarkFolderPickDialog.open({ dialog: 'Move or copy?', mode: null, onPick: (id, action) => picks.push([id, action]) });
        const move = els['bookmark-folder-pick-move-button'];
        const copy = els['bookmark-folder-pick-copy-button'];
        expect(move.hidden).toBe(false);
        expect(copy.hidden).toBe(false);
        expect(move.disabled).toBe(true); // armed only after a selection
        rowBtns()[1].trigger('click'); // Dev
        expect(move.disabled).toBe(false);
        expect(rowBtns()[1].className).toContain('selected');
        move.trigger('click');
        expect(picks).toEqual([['11', 'move']]);
        expect(bodyClasses.contains('needFolderPick')).toBe(false);
        // selection recorded as a recent
        expect(JSON.parse(store.data.folderPickRecents)).toEqual(['11']);
    });

    it('locked mode shows only the matching action button', () => {
        const d = freshDialogs();
        d.BookmarkFolderPickDialog.open({ dialog: 'x', mode: 'copy', onPick: () => {} });
        expect(els['bookmark-folder-pick-move-button'].hidden).toBe(true);
        expect(els['bookmark-folder-pick-copy-button'].hidden).toBe(false);
        rowBtns()[0].trigger('click');
        const picks = [];
        d.BookmarkFolderPickDialog.onPick = (id, action) => picks.push([id, action]);
        els['bookmark-folder-pick-copy-button'].trigger('click');
        expect(picks).toEqual([['1', 'copy']]);
    });

    it('hasUnfav reveals the dual-state note', () => {
        const d = freshDialogs();
        d.BookmarkFolderPickDialog.open({ dialog: 'x', mode: 'move', onPick: () => {} });
        expect(els['bookmark-folder-pick-note'].hidden).toBe(true);
        d.BookmarkFolderPickDialog.open({ dialog: 'x', mode: 'move', hasUnfav: true, onPick: () => {} });
        expect(els['bookmark-folder-pick-note'].hidden).toBe(false);
        expect(els['bookmark-folder-pick-note'].innerHTML).toBe('folderPickFavNote');
    });

    it('filter input hides non-matching rows', () => {
        const d = freshDialogs();
        d.BookmarkFolderPickDialog.open({ dialog: 'x', onPick: () => {} });
        const filter = els['bookmark-folder-pick-filter'];
        filter.value = 'dev';
        filter.trigger('input');
        const btns = rowBtns();
        expect(btns[0].style.display).toBe('none'); // Bar
        expect(btns[1].style.display).toBe('');     // Dev
        expect(btns[2].style.display).toBe('none'); // Other
    });

    it('inline pin toggle flips the pin roster, chip row and aria state', () => {
        const store = miniStore();
        const d = freshDialogs(store);
        d.BookmarkFolderPickDialog.open({ dialog: 'x', onPick: () => {} });
        const pins = pinBtns();
        expect(pins).toHaveLength(3);
        expect(pins[1].getAttribute('aria-pressed')).toBe('false');
        pins[1].trigger('click'); // pin Dev
        expect(JSON.parse(store.data.folderPickPins)).toEqual(['11']);
        expect(pins[1].getAttribute('aria-pressed')).toBe('true');
        expect((pins[1].className || '').indexOf('pinned') >= 0).toBe(true);
        // chips row: one pinned chip labeled with the full path
        const chips = els['bookmark-folder-pick-chips'];
        expect(chips.hidden).toBe(false);
        expect(chips.innerHTML).toContain('folder-pick-chip-label');
        expect(chips.innerHTML).toContain('Bar / Dev');
        pins[1].trigger('click'); // unpin → chips row empty again
        expect(JSON.parse(store.data.folderPickPins)).toEqual([]);
        expect(chips.hidden).toBe(true);
    });

    it('chips render recents (LRU, pinned folders not repeated) and click selects', () => {
        const store = miniStore({
            folderPickPins: JSON.stringify(['2']),
            folderPickRecents: JSON.stringify(['11', '2', '1'])
        });
        const d = freshDialogs(store);
        d.BookmarkFolderPickDialog.open({ dialog: 'x', mode: null, onPick: () => {} });
        const chips = els['bookmark-folder-pick-chips'];
        // pinned '2' first; recents follow in LRU order with '2' deduped out
        const order = [...chips.innerHTML.matchAll(/data-folder-id="([^"]+)"/g)].map(m => m[1]);
        expect(order).toEqual(['2', '11', '1']);
        // chip click behaves like a row click: select (armed action buttons)
        const move = els['bookmark-folder-pick-move-button'];
        chips.trigger('click', { target: { closest: sel => (sel === '.folder-pick-chip' ? { dataset: { folderId: '11' } } : null) } });
        expect(move.disabled).toBe(false);
        expect(d.BookmarkFolderPickDialog.selectedFolderId).toBe('11');
    });

    it('lazy roster pruning drops dead ids at open and writes back', () => {
        const store = miniStore({
            folderPickPins: JSON.stringify(['99', '1']),
            folderPickRecents: JSON.stringify(['42', '2'])
        });
        const d = freshDialogs(store);
        d.BookmarkFolderPickDialog.open({ dialog: 'x', onPick: () => {} });
        expect(JSON.parse(store.data.folderPickPins)).toEqual(['1']); // '99' dead
        expect(JSON.parse(store.data.folderPickRecents)).toEqual(['2']); // '42' dead
    });

    it('close() restores the invoker focus by default; {restoreFocus:false} does not', () => {
        const d = freshDialogs();
        const invoker = els['cover'];
        globalThis.document.activeElement = invoker;
        d.BookmarkFolderPickDialog.open({ dialog: 'x', onPick: () => {} });
        d.BookmarkFolderPickDialog.close();
        expect(invoker.focused).toBe(true); // regularized default
        invoker.focused = false;
        globalThis.document.activeElement = invoker;
        d.BookmarkFolderPickDialog.open({ dialog: 'x', onPick: () => {} });
        d.BookmarkFolderPickDialog.close({ restoreFocus: false });
        expect(invoker.focused).toBe(false);
    });

    it('↑/↓/Home/End walk the folder rows (audit L3: Tab alone is a trap)', () => {
        const d = freshDialogs();
        d.BookmarkFolderPickDialog.open({ dialog: 'Pick one', onPick: () => {} });
        const list = els['bookmark-folder-pick-list'];
        const btns = rowBtns();
        const key = k => {
            const ev = { key: k, prevented: false, preventDefault() { this.prevented = true; } };
            list.trigger('keydown', ev);
            return ev;
        };
        // starting from the cancel button (open focuses it): ↑ climbs into
        // the list's last row, then the walk is positional
        globalThis.document.activeElement = btns[0];
        key('ArrowDown');
        expect(btns[1].focused).toBe(true);
        key('ArrowDown'); // clamps at the last row
        key('End');
        expect(btns[2].focused).toBe(true);
        key('Home');
        expect(btns[0].focused).toBe(true);
        globalThis.document.activeElement = btns[2];
        const ev = key('ArrowUp');
        expect(btns[1].focused).toBe(true);
        expect(ev.prevented).toBe(true);
        // pin toggles never join the walk (Tab reaches them instead)
        expect(pinBtns().every(b => !b.focused)).toBe(true);
        // unrelated keys pass through untouched
        const other = { key: 'a', preventDefault() { this.prevented = true; } };
        list.trigger('keydown', other);
        expect(other.prevented).toBeUndefined();
    });
});

describe('StagingGroupAssignDialog (velvet staging §3.3)', () => {
    it('lists existing groups with counts; clicking one assigns and closes', () => {
        const d = freshDialogs();
        const assigned = [];
        d.StagingGroupAssignDialog.open({
            groups: [{ id: 'g1', name: 'Tools', count: 3 }, { id: 'g2', name: '阅读', count: 1 }],
            onAssign: (gid, name) => assigned.push([gid, name])
        });
        expect(bodyClasses.contains('needStagingGroupAssign')).toBe(true);
        const list = els['staging-group-assign-list'];
        expect(list.children.length).toBe(2);
        expect(list.children[0].children[0].innerHTML).toContain('Tools');
        expect(list.children[0].children[0].innerHTML).toContain('>3<');
        list.children[1].children[0].trigger('click');
        expect(assigned).toEqual([['g2', '阅读']]);
        expect(bodyClasses.contains('needStagingGroupAssign')).toBe(false);
    });

    it('confirm creates a NEW group from the name input (button + Enter)', () => {
        const d = freshDialogs();
        const assigned = [];
        d.StagingGroupAssignDialog.open({ groups: [], onAssign: (gid, name) => assigned.push([gid, name]) });
        // no groups → the empty hint row
        expect(els['staging-group-assign-list'].children[0].className).toBe('staging-group-assign-empty');
        els['staging-group-assign-name'].value = '新组';
        els['staging-group-assign-button'].trigger('click');
        expect(assigned).toEqual([[null, '新组']]);
        // Enter in the input does the same; empty name is a no-op
        d.StagingGroupAssignDialog.open({ groups: [], onAssign: (gid, name) => assigned.push([gid, name]) });
        els['staging-group-assign-name'].value = '   ';
        els['staging-group-assign-name'].trigger('keydown', { key: 'Enter', preventDefault() {} });
        expect(assigned).toHaveLength(1);
        els['staging-group-assign-name'].value = 'Enter组';
        els['staging-group-assign-name'].trigger('keydown', { key: 'Enter', preventDefault() {} });
        expect(assigned[1]).toEqual([null, 'Enter组']);
    });

    it('cancel closes without assigning; closeDialogs covers it', () => {
        const d = freshDialogs();
        const assigned = [];
        d.StagingGroupAssignDialog.open({ groups: [], onAssign: (gid, name) => assigned.push([gid, name]) });
        els['staging-group-assign-cancel-button'].trigger('click');
        expect(bodyClasses.contains('needStagingGroupAssign')).toBe(false);
        expect(assigned).toHaveLength(0);
        // the Esc-layer path
        d.StagingGroupAssignDialog.open({ groups: [], onAssign: () => {} });
        expect(d.activeEl()).toBe(els['staging-group-assign-dialog']);
        d.closeDialogs();
        expect(bodyClasses.contains('needStagingGroupAssign')).toBe(false);
    });
});
