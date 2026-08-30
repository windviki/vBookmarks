// Standalone custom-CSS editor page (4.1.1): pure model helpers + the tab
// workbench wiring. The multi-style model: userstyles (JSON array, source of
// truth) + userstyle (materialized concatenation of enabled styles — the
// apply side src/userstyle.js and downgrades keep reading the legacy key).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    parseStyles, migrateLegacy, materialize, newStyleId, moveStyle, pickNeighborId,
    initCustomCss
} from '../src/custom-css.js';

// ---- minimal DOM double -----------------------------------------------------
const PAGE_IDS = ['custom-css-title', 'custom-css-desc', 'custom-css-order-note', 'custom-css-back',
    'custom-css-empty', 'custom-css-new', 'custom-css-tabs', 'custom-css-editor',
    'custom-css-enabled', 'custom-css-enabled-text', 'custom-css-name', 'custom-css-desc-input',
    'custom-css-css', 'custom-css-status', 'custom-css-move-left', 'custom-css-move-right',
    'custom-css-del'];
const makeDoc = () => {
    const els = {};
    const make = id => {
        const listeners = {};
        return {
            id, hidden: false, value: '', placeholder: '', checked: false, type: '',
            disabled: false, title: '',
            _text: '', innerHTML: '', dataset: { styleId: '' }, children: [],
            set textContent(v) { this._text = v; }, get textContent() { return this._text; },
            setAttribute() {}, appendChild(c) { this.children.push(c); return c; },
            addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
            fire(t, ev = {}) { for (const fn of listeners[t] || []) fn.call(this, { stopPropagation() {}, preventDefault() {}, ...ev }); },
            focus() {}, click() { for (const fn of listeners.click || []) fn.call(this, { stopPropagation() {} }); }
        };
    };
    for (const id of PAGE_IDS)
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

// the tab strip's current buttons: [dot, name] children in list order
const tabsOf = doc => doc.els['custom-css-tabs'].children;
const tabName = tab => tab.children[1].textContent;

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

    it('moveStyle swaps neighbors and refuses to fall off the ends', () => {
        const styles = [
            { id: 'a', css: 'a', enabled: true },
            { id: 'b', css: 'b', enabled: true },
            { id: 'c', css: 'c', enabled: true }
        ];
        expect(moveStyle(styles, 'a', -1)).toBeNull(); // already first
        expect(moveStyle(styles, 'c', 1)).toBeNull(); // already last
        expect(moveStyle(styles, 'zzz', 1)).toBeNull(); // unknown id
        const moved = moveStyle(styles, 'a', 1);
        expect(moved.map(s => s.id)).toEqual(['b', 'a', 'c']);
        expect(styles.map(s => s.id)).toEqual(['a', 'b', 'c']); // pure: input untouched
    });

    it('pickNeighborId hands the editor to the sliding-in style, then the tail', () => {
        const ids = styles => styles.map(s => s.id);
        expect(pickNeighborId([{ id: 'b' }, { id: 'c' }], 0)).toBe('b'); // slid into the slot
        expect(pickNeighborId([{ id: 'a' }], 1)).toBe('a'); // deleted the tail → previous
        expect(pickNeighborId([], 0)).toBe(null);
    });
});

describe('custom-css tab workbench wiring', () => {
    beforeEach(() => {
        globalThis.chrome = { i18n: { getMessage: (k) => `M:${k}` } };
    });
    afterEach(() => {
        delete globalThis.chrome;
    });

    it('migrates a legacy userstyle into one enabled entry, tab and editor both filled', () => {
        const doc = makeDoc();
        const store = makeStore({ userstyle: 'body { color: red; }' });
        initCustomCss({ document: doc, store });
        const styles = parseStyles(store.get('userstyles'));
        expect(styles).toHaveLength(1);
        expect(styles[0].css).toBe('body { color: red; }');
        expect(styles[0].enabled).toBe(true);
        expect(store.get('userstyle')).toBe('body { color: red; }');
        expect(tabsOf(doc)).toHaveLength(1);
        expect(tabName(tabsOf(doc)[0])).toBe('M:customCssUntitled'); // empty name → untitled label
        expect(doc.els['custom-css-css'].value).toBe('body { color: red; }');
        expect(doc.els['custom-css-enabled'].checked).toBe(true);
        // one style: move-left/right both disabled at the boundaries
        expect(doc.els['custom-css-move-left'].disabled).toBe(true);
        expect(doc.els['custom-css-move-right'].disabled).toBe(true);
    });

    it('the ＋ button mints a selected enabled entry and persists both keys', () => {
        const doc = makeDoc();
        const store = makeStore({ userstyles: '[]' });
        initCustomCss({ document: doc, store });
        expect(doc.els['custom-css-empty'].hidden).toBe(false); // no styles → the empty note shows
        doc.els['custom-css-new'].click();
        expect(doc.els['custom-css-empty'].hidden).toBe(true); // …and hides once one exists
        const styles = parseStyles(store.get('userstyles'));
        expect(styles).toHaveLength(1);
        expect(styles[0].enabled).toBe(true);
        expect(styles[0].name).toBe('M:customCssNewStyle 1');
        expect(store.get('userstyle')).toBe(''); // empty css → empty materialization
        expect(tabsOf(doc)).toHaveLength(1);
    });

    it('switching tabs swaps the editor content without touching enable flags', () => {
        const doc = makeDoc();
        const store = makeStore({
            userstyles: JSON.stringify([
                { id: 'a', name: 'A', css: 'a{}', enabled: true },
                { id: 'b', name: 'B', css: 'b{}', enabled: false }
            ])
        });
        initCustomCss({ document: doc, store });
        expect(doc.els['custom-css-css'].value).toBe('a{}');
        expect(doc.els['custom-css-enabled'].checked).toBe(true);
        // click tab b — select only; enable flags are the tabs' own concern
        tabsOf(doc)[1].click();
        expect(doc.els['custom-css-css'].value).toBe('b{}');
        expect(doc.els['custom-css-enabled'].checked).toBe(false);
        expect(parseStyles(store.get('userstyles'))[0].enabled).toBe(true);
        expect(parseStyles(store.get('userstyles'))[1].enabled).toBe(false);
        // and back: the editor is a pure view of the selected style
        tabsOf(doc)[0].click();
        expect(doc.els['custom-css-css'].value).toBe('a{}');
        expect(store.get('userstyle')).toBe('a{}'); // b disabled → not materialized
    });

    it('regression (user report): the enable checkbox unchecks cleanly and drops the style from the cascade', () => {
        const doc = makeDoc();
        const store = makeStore({
            userstyles: JSON.stringify([
                { id: 'a', name: 'A', css: 'a{}', enabled: true },
                { id: 'b', name: 'B', css: 'b{}', enabled: true }
            ])
        });
        initCustomCss({ document: doc, store });
        expect(store.get('userstyle')).toBe('a{}\n\nb{}');
        doc.els['custom-css-enabled'].checked = false;
        doc.els['custom-css-enabled'].fire('change');
        expect(store.get('userstyle')).toBe('b{}');
        expect(parseStyles(store.get('userstyles'))[0].enabled).toBe(false);
        // the tab strip re-rendered (dot state) but the checkbox kept its value
        expect(doc.els['custom-css-enabled'].checked).toBe(false);
        // re-enable restores the concatenation
        doc.els['custom-css-enabled'].checked = true;
        doc.els['custom-css-enabled'].fire('change');
        expect(store.get('userstyle')).toBe('a{}\n\nb{}');
    });

    it('name/desc edits persist; the active tab label follows the name in place', () => {
        const doc = makeDoc();
        const store = makeStore({
            userstyles: JSON.stringify([{ id: 'a', name: 'A', desc: '', css: '', enabled: true }])
        });
        initCustomCss({ document: doc, store });
        doc.els['custom-css-name'].value = 'A2';
        doc.els['custom-css-name'].fire('input');
        expect(parseStyles(store.get('userstyles'))[0].name).toBe('A2');
        doc.els['custom-css-desc-input'].value = 'tweaks';
        doc.els['custom-css-desc-input'].fire('input');
        expect(parseStyles(store.get('userstyles'))[0].desc).toBe('tweaks');
    });

    it('css edits via the native textarea persist and materialize', () => {
        const doc = makeDoc();
        const store = makeStore({ userstyles: JSON.stringify([{ id: 'a', name: 'A', css: '', enabled: true }]) });
        initCustomCss({ document: doc, store });
        doc.els['custom-css-css'].value = 'body{}';
        doc.els['custom-css-css'].fire('change');
        expect(store.get('userstyle')).toBe('body{}');
        expect(parseStyles(store.get('userstyles'))[0].css).toBe('body{}');
    });

    it('◀/▶ reorder the cascade (materialization follows the new tab order)', () => {
        const doc = makeDoc();
        const store = makeStore({
            userstyles: JSON.stringify([
                { id: 'a', name: 'A', css: 'a{}', enabled: true },
                { id: 'b', name: 'B', css: 'b{}', enabled: true }
            ])
        });
        initCustomCss({ document: doc, store });
        expect(doc.els['custom-css-move-left'].disabled).toBe(true);
        expect(doc.els['custom-css-move-right'].disabled).toBe(false);
        doc.els['custom-css-move-right'].click();
        expect(parseStyles(store.get('userstyles')).map(s => s.id)).toEqual(['b', 'a']);
        expect(store.get('userstyle')).toBe('b{}\n\na{}'); // later tab wins the cascade
        expect(doc.els['custom-css-move-right'].disabled).toBe(true); // now last
        expect(doc.els['custom-css-move-left'].disabled).toBe(false);
        doc.els['custom-css-move-left'].click();
        expect(store.get('userstyle')).toBe('a{}\n\nb{}');
    });

    it('arrow keys walk the tab strip; delete hands the editor to the neighbor', async () => {
        const doc = makeDoc();
        const store = makeStore({
            userstyles: JSON.stringify([
                { id: 'a', name: 'A', css: 'a{}', enabled: true },
                { id: 'b', name: 'B', css: 'b{}', enabled: true }
            ])
        });
        const api = initCustomCss({ document: doc, store });
        doc.els['custom-css-tabs'].fire('keydown', { key: 'ArrowRight' });
        expect(api.selectedId).toBe('b');
        expect(doc.els['custom-css-css'].value).toBe('b{}');
        doc.els['custom-css-tabs'].fire('keydown', { key: 'Home' });
        expect(api.selectedId).toBe('a');
        // delete the first → the second slides into the editor
        globalThis.confirm = () => true;
        doc.els['custom-css-del'].click();
        expect(parseStyles(store.get('userstyles')).map(s => s.id)).toEqual(['b']);
        expect(api.selectedId).toBe('b');
        expect(store.get('userstyle')).toBe('b{}');
        delete globalThis.confirm;
    });
});
