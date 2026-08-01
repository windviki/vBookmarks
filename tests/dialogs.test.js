import { describe, it, expect, beforeAll } from 'vitest';

// dialogs.js touches page globals (document/window/chrome) only inside
// initDialogs, so the real module imports cleanly in node once the globals
// are stubbed. ESM direct import — no copied implementation.

const makeEl = () => ({
    innerHTML: '',
    value: '',
    checked: false,
    hidden: false,
    disabled: false,
    focused: false,
    scrollLeft: 0,
    style: {},
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
    select() {}
});

const IDS = [
    'alert-dialog', 'confirm-dialog', 'edit-dialog', 'new-folder-dialog', 'sort-dialog',
    'alert-dialog-text',
    'confirm-dialog-text', 'confirm-dialog-button-1', 'confirm-dialog-button-2',
    'edit-dialog-text', 'edit-dialog-name', 'edit-dialog-url', 'edit-dialog-form', 'edit-dialog-cancel-button',
    'new-folder-dialog-text', 'new-folder-dialog-name', 'new-folder-dialog-form', 'new-folder-dialog-cancel-button',
    'sort-by-title', 'sort-by-date', 'sort-folders-first', 'sort-recursive', 'sort-recursive-warning',
    'sort-dialog-ok-button', 'sort-dialog-cancel-button',
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

let widont, initDialogs, els, bodyClasses, sorts;

beforeAll(async () => {
    els = Object.fromEntries(IDS.map(id => [id, makeEl()]));
    bodyClasses = makeClassList();
    globalThis.document = {
        getElementById: id => els[id] || null,
        body: { classList: bodyClasses }
    };
    globalThis.window = { addEventListener: () => {} };
    globalThis.chrome = { i18n: { getMessage: key => key } };
    ({ widont, initDialogs } = await import('../src/dialogs.js'));
});

const freshDialogs = () => {
    bodyClasses._set.clear();
    sorts = [];
    return initDialogs({ onSort: (folderId, opts) => sorts.push([folderId, opts]) });
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
});
