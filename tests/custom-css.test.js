// Standalone custom-CSS editor page (4.1.1): pure model helpers + the page
// wiring. The multi-style model: userstyles (JSON array, source of truth) +
// userstyle (materialized concatenation of enabled styles — the apply side
// src/userstyle.js and downgrades keep reading the legacy key).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseStyles, migrateLegacy, materialize, newStyleId, initCustomCss } from '../src/custom-css.js';

// ---- minimal DOM double -----------------------------------------------------
const makeDoc = () => {
    const els = {};
    const make = id => {
        const listeners = {};
        return {
            id, hidden: false, value: '', placeholder: '', checked: false, type: '',
            _text: '', innerHTML: '', dataset: { styleId: '' }, children: [],
            set textContent(v) { this._text = v; }, get textContent() { return this._text; },
            setAttribute() {}, appendChild(c) { this.children.push(c); return c; },
            addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
            fire(t, ev = {}) { for (const fn of listeners[t] || []) fn.call(this, { stopPropagation() {}, ...ev }); },
            focus() {}, click() { for (const fn of listeners.click || []) fn.call(this, { stopPropagation() {} }); }
        };
    };
    for (const id of ['custom-css-title', 'custom-css-desc', 'custom-css-order-note', 'custom-css-back',
        'custom-css-empty', 'custom-css-new', 'custom-css-list', 'custom-css-editor',
        'custom-css-name', 'custom-css-desc-input', 'custom-css-css', 'custom-css-status'])
        els[id] = make(id);
    return {
        getElementById: id => els[id] || null,
        createElement: () => make('dyn'),
        title: '',
        readyState: 'complete',
        body: { dataset: {} },
        addEventListener() {},
        els
    };
};

const makeStore = (data = {}) => {
    const sets = [];
    return {
        _data: { ...data }, sets,
        get(key, dflt) { return key in this._data ? this._data[key] : dflt; },
        set(key, v) { this._data[key] = v; sets.push([key, v]); }
    };
};

describe('custom-css pure model', () => {
    it('parseStyles normalizes entries and survives garbage', () => {
        const good = parseStyles('[{"id":"a","name":"A","desc":"d","css":"x","enabled":false},{"bad":1}]');
        expect(good).toHaveLength(2); // the malformed entry still normalizes (id minted)
        expect(good[0]).toEqual({ id: 'a', name: 'A', desc: 'd', css: 'x', enabled: false });
        expect(parseStyles('not json')).toEqual([]);
        expect(parseStyles('')).toEqual([]);
    });

    it('materialize concatenates enabled non-empty styles in list order', () => {
        const out = materialize([
            { css: 'a', enabled: true },
            { css: 'b', enabled: false },
            { css: '   ', enabled: true },
            { css: 'c', enabled: true }
        ]);
        expect(out).toBe('a\n\nc');
    });

    it('migrateLegacy wraps the pre-4.1.1 single string once, then stands down', () => {
        const migrated = migrateLegacy(undefined, 'body{}', '我的样式');
        expect(migrated).toHaveLength(1);
        expect(migrated[0]).toMatchObject({ css: 'body{}', enabled: true, name: '我的样式' });
        // an existing list (even empty) means no migration
        expect(migrateLegacy('[]', 'body{}')).toBeNull();
        expect(migrateLegacy(undefined, '', 'x')).toEqual([]);
    });

    it('newStyleId mints unique ids', () => {
        expect(newStyleId()).not.toBe(newStyleId());
    });
});

describe('custom-css page wiring', () => {
    beforeEach(() => {
        globalThis.chrome = { i18n: { getMessage: (k) => `M:${k}` } };
    });
    afterEach(() => {
        delete globalThis.chrome;
    });

    it('migrates a legacy userstyle into one enabled entry and materializes it back', () => {
        const doc = makeDoc();
        const store = makeStore({ userstyle: 'body { color: red; }' });
        initCustomCss({ document: doc, store });
        const styles = parseStyles(store.get('userstyles'));
        expect(styles).toHaveLength(1);
        expect(styles[0].css).toBe('body { color: red; }');
        expect(styles[0].enabled).toBe(true);
        expect(store.get('userstyle')).toBe('body { color: red; }');
        // the editor area holds the migrated css
        expect(doc.els['custom-css-css'].value).toBe('body { color: red; }');
    });

    it('new style button creates a selected enabled entry and persists both keys', () => {
        const doc = makeDoc();
        const store = makeStore({ userstyles: '[]' });
        initCustomCss({ document: doc, store });
        doc.els['custom-css-new'].click();
        const styles = parseStyles(store.get('userstyles'));
        expect(styles).toHaveLength(1);
        expect(styles[0].enabled).toBe(true);
        expect(store.get('userstyle')).toBe(''); // empty css → empty materialization
    });

    it('editing css via the native textarea persists and materializes', () => {
        const doc = makeDoc();
        const store = makeStore({ userstyles: JSON.stringify([{ id: 'a', name: 'A', css: '', enabled: true }]) });
        initCustomCss({ document: doc, store });
        doc.els['custom-css-css'].value = 'body{}';
        doc.els['custom-css-css'].fire('change');
        expect(store.get('userstyle')).toBe('body{}');
        expect(parseStyles(store.get('userstyles'))[0].css).toBe('body{}');
    });

    it('name/desc inputs update the entry; enable toggles drive the materialization', () => {
        const doc = makeDoc();
        const store = makeStore({
            userstyles: JSON.stringify([
                { id: 'a', name: 'A', css: 'a', enabled: true },
                { id: 'b', name: 'B', css: 'b', enabled: true }
            ])
        });
        initCustomCss({ document: doc, store });
        expect(store.get('userstyle')).toBe('a\n\nb');
        // the first row is selected; renaming rewrites the list entry
        doc.els['custom-css-name'].value = 'A2';
        doc.els['custom-css-name'].fire('input');
        expect(parseStyles(store.get('userstyles'))[0].name).toBe('A2');
        // toggle the first row's enable checkbox off (the row li carries it)
        const firstLi = doc.els['custom-css-list'].children[0];
        const label = firstLi.children[0];
        const cb = label.children[0];
        cb.checked = false;
        cb.fire('change');
        expect(store.get('userstyle')).toBe('b');
    });
});
